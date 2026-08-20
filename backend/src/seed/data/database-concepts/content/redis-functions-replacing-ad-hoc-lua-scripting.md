---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand how Redis moved server-side scripting from an ad hoc, client-owned convention — send a raw Lua string via `EVAL`, or cache it server-side under an opaque SHA1 hash via `SCRIPT LOAD`/`EVALSHA` — to a real, database-managed artifact: named libraries loaded with `FUNCTION LOAD`, made of one or more functions registered with `redis.register_function()`, invoked by name with `FCALL`. Both source books (*Redis Essentials*, Da Silva et al., 2015, and *Redis in Action*, Carlson, 2013) teach exactly the `EVAL`/`EVALSHA` world, because that was the only scripting Redis had — Redis Functions didn't exist until Redis 7.0 in 2022, years after both books were written. This concept is explicitly "book vs today": the books' scripting chapters aren't wrong, they're the full explanation for a problem Functions was built specifically to fix.

## Use Cases

- Turning a repeated cross-service operation — the books' own example is an `HSET`-like update that also stamps a `_last_modified_` field — into a named, listable server function (`my_hset`) instead of a Lua string every service has to embed, ship, and keep in sync independently.
- Exposing read-only helper functions (a filtered `HGETALL` that strips internal bookkeeping fields, a "last modified" lookup) tagged with the `no-writes` flag so they can run via `FCALL_RO` against a read-only replica — something a hand-cached `EVALSHA` script has no clean equivalent for, since Redis can't know a cached script's read/write behavior without being told.
- Reimplementing the books' own optimistic-locking replacement — an atomic `ZRANGE`-then-`ZREM` "pop the lowest-scored element" script, used instead of retrying a `WATCH`/`MULTI`/`EXEC` transaction under contention — as a durable library function that every client calls by name, rather than re-sending the same Lua string on every connection.
- Auditing exactly what server-side logic is running in production with `FUNCTION LIST`, instead of grepping application repositories for embedded Lua strings or trying to reverse-engineer behavior from an opaque SHA1 hash seen in a `MONITOR` session.
- Pre-loading a fresh, ephemeral cache-tier Redis instance with its full set of business-logic functions via `redis-cli --functions-rdb` before it accepts client traffic — a bootstrap problem raw `EVAL` scripts can't solve at all, since they were never persisted to begin with.

## Deep Dive

### The ad hoc scripting era: what the books teach (2012-2015)

Redis 2.6 (2012) introduced scripting, and both books teach it as the only way to extend Redis without touching its C source. *Redis in Action* frames the motivation directly: "Prior to Redis 2.6 (and the unsupported scripting branch of Redis 2.4), if we wanted higher-level functionality that didn't already exist in Redis, we'd either have to write client-side code... or we'd have to edit the C source code of Redis itself. Though editing Redis's source code isn't too difficult, supporting such code in a business environment... could be challenging." *Redis Essentials* adds why Lua specifically: "Lua was chosen because it is very small and simple, and its C API is very easy to integrate with other libraries."

**`EVAL`, `KEYS`/`ARGV`, and atomicity.** The core command's syntax, per *Redis Essentials*: `EVAL script numkeys key [key ...] arg [arg ...]` — the script as a string, a count of how many following arguments are key names, then the keys and any extra arguments. Inside the script, those become the `KEYS` and `ARGV` tables, and `redis.call`/`redis.pcall` execute Redis commands from within Lua (`pcall` returns errors as a Lua table instead of aborting the script). The book's own warning: "Avoid using hardcoded key names inside a Lua script; pass all key names as parameters to the commands EVAL/EVALSHA" — precisely so Redis Cluster can verify all touched keys live on the same shard before running the script. Execution is fully atomic: "Lua scripts are atomically executed, which means that the Redis server is blocked during script execution," with a default 5-second ceiling (`lua-time-limit`) after which Redis starts replying `BUSY` to every command until the script is killed with `SCRIPT KILL` (safe only if the script hasn't written yet) or the server itself is restarted with `SHUTDOWN NOSAVE`.

*Redis in Action* shows exactly why this mattered beyond convenience: the same `WATCH`/`MULTI`/`EXEC` "optimistic locking" retry loop used earlier in the book to pop the lowest-scored element from a sorted set could instead be written as one atomic Lua script — no retries needed, because "Redis will always guarantee that there are no parallel changes to the Sorted Set during script execution."

**`SCRIPT LOAD`/`EVALSHA`, and the caching problem the books hand-build.** Re-sending a full script string on every call wastes bandwidth and forces Redis to recompile it every time, so both books teach the two-step optimization: `SCRIPT LOAD` caches a script server-side and returns its SHA1 digest; `EVALSHA` then re-runs it by that digest alone. *Redis in Action* implements this as a small client-side wrapper — a `script_load()` closure that calls `SCRIPT LOAD` once, caches the returned SHA1 locally, and calls `EVALSHA` on every subsequent invocation. But the wrapper has to catch a specific failure: "if we discover that the script is missing" — because the server restarted, someone ran `SCRIPT FLUSH`, or a different, unwarmed server got this connection — "we execute the script directly with `EVAL`, which caches the script in addition to executing it." Every client, in every language, was expected to reimplement this exact cache-miss fallback by hand, because the cache was never guaranteed to survive.

### Why this got awkward once an application leaned on it heavily

Redis's own current documentation is blunt about the ceiling this approach hits at scale, in terms that echo precisely what the books' hand-written `EVALSHA` wrapper was working around:

> "All client application instances must maintain a copy of all scripts. That means having some mechanism that applies script updates to all of the application's instances."
> "Calling cached scripts within the context of a transaction increases the probability of the transaction failing because of a missing script."
> "SHA1 digests are meaningless, making debugging the system extremely hard (e.g., in a `MONITOR` session)."
> "Because they are ephemeral, a script can't call another script. This makes sharing and reusing code between scripts nearly impossible, short of client-side preprocessing."

None of this is a bug in `EVAL`/`EVALSHA` — it's the direct consequence of a design where, as Redis's docs put it, "scripts are a part of the application and not maintained by the Redis server." The books' careful cache-miss handling and their advice to keep scripts small and single-purpose are the correct engineering response to that design, not workarounds for a flaw.

### Redis Functions (Redis 7.0, 2022): scripts become database-managed artifacts

Redis Functions inverts the ownership: "Functions provide the same core functionality as scripts but are first-class software artifacts of the database. Redis manages functions as an integral part of the database and ensures their availability via data persistence and replication." Loading one looks like this:

```
FUNCTION LOAD "#!lua name=mylib
local function my_hset(keys, args)
  local hash = keys[1]
  local time = redis.call('TIME')[1]
  return redis.call('HSET', hash, '_last_modified_', time, unpack(args))
end
redis.register_function('my_hset', my_hset)"
```

The mandatory shebang line (`#!lua name=mylib`) names the library and its execution engine (only Lua ships today, by design left open to others later); every function inside it is registered by name via `redis.register_function()`. Calling it uses `FCALL` instead of `EVAL`/`EVALSHA`, with the same `numkeys key [key...] arg [arg...]` calling convention scripts already used:

```
FCALL my_hset 1 myhash myfield "some value"
```

That single change removes the entire class of problem the books' `EVALSHA` wrapper existed to patch:

- **Persistence and replication are automatic, not the application's job.** "Functions are also persisted to the AOF file and replicated from master to replicas, so they are as durable as the data itself" — the exact `NOSCRIPT`/cache-miss fallback the *Redis in Action* `script_load()` wrapper had to hand-implement for every client, in every language, simply has no equivalent failure mode for `FCALL`. There's no cache to go missing; the function is part of the database state.
- **A named, describable API instead of an opaque hash.** `FUNCTION LIST` returns every library's functions by name, with descriptions and flags — a direct answer to the docs' own complaint that "SHA1 digests are meaningless... in a `MONITOR` session."
- **Real code reuse.** Functions in the same library can call each other and share private helper functions (a `check_keys()` validator called from three different registered functions, for example) — solving the "a script can't call another script" gap the ad hoc model never closed.
- **A library updates as one atomic unit.** `FUNCTION LOAD REPLACE` swaps the whole library's code in one operation; there's no partial-update path, which trades fine-grained hot-patching for the guarantee that a library is never observed half-updated.
- **Flags declare behavior instead of leaving Redis to assume the worst.** By default Redis assumes any function might write, so `FCALL_RO` against a read-only replica is refused; adding the `no-writes` flag at registration time (via the named-arguments form of `redis.register_function`) is what makes `FCALL_RO myfunc ...` work against replicas at all.
- **Cluster propagation is still manual, same as the books' own script distribution problem.** Redis replicates functions automatically from a master to its own replicas, but across independent Redis Cluster masters, loading a library is still an explicit administrative step (`redis-cli --cluster-only-masters --cluster call host:port FUNCTION LOAD ...`) — Functions solves the replica-sync half of the books' "every client must keep a copy" problem, not the cross-shard half.

### Book vs today

> **`EVAL` isn't deprecated — Functions is what you reach for once a script stops being a one-off.** Both books' `EVAL`/`EVALSHA` material still runs unmodified on current Redis; nothing about it is removed or wrong. What changed is the recommended path once scripting logic becomes something an application actually depends on: Redis's own functions documentation states plainly that Functions "supersedes the use of `EVAL`... in prior versions of Redis" for that role, while `EVAL` remains fine for genuinely ephemeral, single-shot scripts a client renders and discards.
>
> **The books' hand-rolled `EVALSHA` cache-miss wrapper is exactly the problem Functions was designed around.** *Redis in Action*'s `script_load()` closure — cache a SHA1, catch `NOSCRIPT`, fall back to `EVAL` — is a correct and necessary pattern for the tool it targets, and Redis's own docs frame the entire Functions feature as a response to that exact class of fragility: a cache that "can become lost at any time," with the application responsible for noticing and recovering. A function loaded via `FUNCTION LOAD` has no analogous cache to lose — persistence and replication are the server's job, not the client library's.
>
> **The blocking, single-threaded execution model didn't change at all.** Every constraint the books teach about scripts — atomic, blocks the whole server for the duration, keep it fast, a runaway script needs `SCRIPT KILL` or `SHUTDOWN NOSAVE` — applies identically to Functions. Functions changed how logic is *distributed and managed*, not how it *executes*; a slow function is exactly as dangerous as a slow script.

## Trade-offs

- **Functions require Redis 7.0+ (2022).** Anything running an older Redis — including much of the install base both books targeted at publication — has to keep using `EVAL`/`EVALSHA`. Functions is additive, not a compatibility-breaking replacement, but it's genuinely unavailable below 7.0.
- **A library is immutable except as a whole.** `FUNCTION LOAD REPLACE` swaps every function in the library together; there's no way to patch one function in isolation the way a book-era application could `SCRIPT LOAD` a single revised script independently of every other script it used. That consistency guarantee is also a real deployment constraint — a one-line fix to one function still means re-loading the entire library.
- **Function flags are opt-in, and the safe default is the restrictive one.** A function has to be explicitly registered with `no-writes` (via the named-arguments form) before `FCALL_RO` will run it against a replica; forgetting the flag doesn't silently allow writes on a replica, but it does silently block a read-only function from running where it should — an easy first-deploy surprise migrating from ad hoc scripts, which had no such distinction to forget.
- **Cluster propagation is still a manual, out-of-band step.** Functions solves master-to-replica durability automatically, but loading a library onto every master in a Redis Cluster deployment is explicitly not automatic — Redis's own docs assign that to the cluster administrator, the same category of manual synchronization work the books' "every client must keep a copy" problem represented, just moved from application instances to cluster nodes.
- **It's still Lua, still atomic, still blocking.** Functions doesn't relax any of the execution constraints the books spend real space explaining — a function that runs long blocks every other client exactly as a script would, and the only language available today is the same Lua 5.1 dialect the books teach. The debugger available for ad hoc scripts (the Lua scripts debugger) explicitly doesn't extend to Functions, per Redis's own docs — one capability the books' `EVAL` workflow has that Functions currently doesn't.
- **For a genuinely single-use script, Functions is more ceremony than the job needs.** A one-off maintenance script run once during an incident doesn't benefit from a shebang line, a named library, and persistence to the AOF — `EVAL` (or even just `redis-cli --eval` against a `.lua` file) is still the right-sized tool for logic nobody needs Redis to remember after it runs.

## Documentation Links

- Maxwell Dayvson Da Silva et al., "Redis Essentials" (Packt, 2015) — Chapter 4, "Commands (Where the Wild Things Are)," "Scripting" and "Redis meets Lua," p. 86-90 — doc
- Josiah Carlson, "Redis in Action" (Manning, 2013) — Chapter 11, "Scripting Redis with Lua," section 11.1 "Adding functionality without writing C," p. 250-254 — doc
- [Redis Documentation — Introduction to Redis Functions (motivation, libraries, FUNCTION LOAD, flags, cluster propagation)](https://redis.io/docs/latest/develop/programmability/functions-intro/) — doc
- [Redis Documentation — FUNCTION LOAD command](https://redis.io/docs/latest/commands/function-load/) — doc
- [Redis Documentation — FCALL command](https://redis.io/docs/latest/commands/fcall/) — doc
- [Redis Documentation — FCALL_RO command](https://redis.io/docs/latest/commands/fcall_ro/) — doc
- [Redis Documentation — Introduction to Eval Scripts (EVAL, EVALSHA, SCRIPT LOAD)](https://redis.io/docs/latest/develop/programmability/eval-intro/) — doc
