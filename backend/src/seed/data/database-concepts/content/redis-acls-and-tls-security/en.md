---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand how Redis went from a single shared password and a bag of network-level workarounds to a real access-control system: named users with per-command, per-category, and per-key-pattern permissions (ACLs, Redis 6.0, 2020), and encryption built directly into `redis-server` instead of bolted on with an external proxy (native TLS, also Redis 6.0). This concept is explicitly "book vs today" — the only book source available (*Redis Essentials*, Da Silva et al., 2015) predates both mechanisms entirely, because Redis genuinely didn't have them yet. What the book teaches — `requirepass`, `rename-command`, firewalling, and `stunnel` — was the real state of the art in 2015, and understanding why it was inadequate is what makes the ACL/TLS design make sense.

## Use Cases

- Giving a metrics scraper or dashboard read-only access to a specific key prefix (`~metrics:*` with `+@read`) so a compromised or misconfigured scraper can't issue `FLUSHALL`, `CONFIG SET`, or write to unrelated keys — impossible under a single shared password, where every authenticated client is equally powerful.
- Running a multi-tenant Redis instance where each tenant's worker process is scoped to its own key prefix (`~tenant42:*`) and denied the whole-keyspace commands (`FLUSHALL`, `FLUSHDB`, `SWAPDB`) that ignore key patterns entirely — the exact gap Redis's own docs call out and fix with explicit `-flushall -flushdb -swapdb` rules.
- A managed/cloud Redis offering restricting customer connections from `CONFIG`, `DEBUG`, `SHUTDOWN`, and other `@admin`/`@dangerous` commands, while still letting them run every data command they need — the scenario Redis's own ACL documentation names as a primary motivation.
- Creating dedicated, minimally-privileged users for Sentinel and replica connections instead of trusting them with full access — Redis's docs publish the exact `ACL SETUSER` rule sets for both (Sentinel needs `+multi +slaveof +ping +exec +subscribe ...`; a replica needs only `+psync +replconf +ping`).
- Encrypting client-to-server traffic on a Redis instance that lives on a public cloud or crosses a network boundary, using `tls-port` and certificate directives built into `redis-server`, instead of standing up and operating a separate `stunnel` process pair as a workaround for Redis having no TLS of its own.
- Separating a background job worker's permissions to just the commands its job actually needs (`+@list +@connection`, nothing else) so a bug or injected command in that worker can't touch unrelated keys or issue admin commands — the operational-safety half of ACLs, not just the security half.

## Deep Dive

### The pre-ACL era: what the book teaches (2015)

*Redis Essentials* is explicit about the ceiling it's working under: "Redis was designed to be used in a trusted private network. It supports a very basic security system to protect the connection between the client and server via a plain-text password... Redis does not implement Access Control List (ACL). Therefore, it is not possible to have users with different permission levels." Everything in the chapter is a workaround for that one fact.

**A single shared password.** `requirepass` in `redis.conf` sets one password for the entire server; `AUTH <password>` authenticates a connection against it. The book's own security advice for this password is telling: "choose a complex password of at least 64 characters," because "Redis is superfast, [so] a malicious user could potentially guess thousands of passwords in a second." Once authenticated, a client can run *any* command against *any* key — there is no way to hand out a weaker credential to a client that only needs read access.

**Obfuscating commands by renaming them.** To blunt the risk of a client (or attacker) calling `FLUSHALL`, `CONFIG`, `KEYS`, `DEBUG`, or `SAVE`, the book has you rename them to random strings via `rename-command` in a `redis.conf` include file:

```
rename-command FLUSHDB e0cc96ad2eab73c2c347011806a76b73
rename-command FLUSHALL a31907b21c437f46808ea49322c91d23a
rename-command CONFIG ""
rename-command KEYS ""
```

The book flags its own limits honestly: "Renaming a command does not ensure security, because a malicious attacker can still use brute force to find the command name." It's obscurity, not access control — anyone authenticated with the one shared password can still eventually find and run the renamed command.

**Network-level containment.** The rest of the chapter is perimeter defense rather than anything Redis itself enforces: `iptables` firewall rules restricting which CIDR blocks can reach the server, binding `redis-server` to `127.0.0.1` (the loopback interface) when client and server share a machine, and running inside a cloud provider's VPC so only co-located machines can reach it at all.

**TLS via `stunnel`, because Redis had none.** "By default, Redis does not support any encryption... The tool we will use to encrypt Redis communication is called `stunnel`. It is an SSL encryption wrapper between a local client and a local or remote server." The book walks through generating an SSL keypair with `openssl`, then either running `stunnel` as a matched pair of processes on both client and server machines (server `stunnel` accepting on `0.0.0.0:6666` and forwarding to `127.0.0.1:6379`; client `stunnel` accepting locally on `127.0.0.1:5555` and tunneling to the server's `stunnel`), or running `stunnel` only on the server and pointing an SSL-capable client library (the book uses `redis-py`'s `SSLConnection`) directly at it. Either way, TLS is an entirely separate process from `redis-server`, with its own config file, its own port, and its own failure modes — Redis itself never sees the encryption layer.

Every one of these techniques was genuinely reasonable advice in 2015. The problem the book never solves — because the tool to solve it didn't exist yet — is granularity: one password means one trust level for every client, `rename-command` is obscurity rather than enforcement, and firewalls/VPCs protect the network path but say nothing about what an already-connected client is allowed to do once it's in.

### ACLs since Redis 6.0: named users with real permission boundaries

Redis 6.0 (2020) added a genuine Access Control List system. Every connection authenticates as a specific user (a `default` user exists automatically), and each user carries its own rules for which commands, key patterns, and Pub/Sub channels it may touch. `AUTH` was extended to a two-argument form, `AUTH <username> <password>`, with the old single-argument `AUTH <password>` still working exactly as before by implicitly targeting `default` — so `requirepass` isn't gone, it just now sets the password *for the default user specifically*, which is what makes ACLs backward compatible with pre-6.0 clients and configs.

A fresh instance looks like this:

```
> ACL LIST
1) "user default on nopass ~* &* +@all"
```

`on` (enabled), `nopass` (no password required — so an unauthenticated connection is automatically the default user), `~*` (every key), `&*` (every Pub/Sub channel), `+@all` (every command). That's the "every client is equally powerful" world the book lived in, kept as the default for compatibility.

Creating a scoped user looks like this:

```
> ACL SETUSER alice on >p1pp0 ~cached:* +get
OK
> AUTH alice p1pp0
OK
> GET foo
(error) NOPERM this user has no permissions to access one of the keys used as arguments
> GET cached:1234
(nil)
> SET cached:1234 zap
(error) NOPERM this user has no permissions to run the 'set' command
```

The rule vocabulary, all composed onto one `ACL SETUSER <username> ...` call:

- **Enable/disable**: `on` / `off` — a newly created user defaults to `off`, `-@all`, no key or channel patterns; ACLs fail closed, not open.
- **Commands**: `+<command>` / `-<command>` allow or remove a single command (`+config|get` / `-config|set` target subcommands specifically, Redis 7.0+); `+@<category>` / `-@<category>` operate on a whole command category at once — `@admin`, `@dangerous`, `@read`, `@write`, `@fast`, `@slow`, and roughly two dozen others, enumerable with `ACL CAT`. `allcommands`/`nocommands` are aliases for `+@all`/`-@all`.
- **Keys**: `~<pattern>` is a glob pattern (`KEYS`-style) of accessible key names — multiple patterns can be added; `allkeys` aliases `~*`; `resetkeys` clears the list. Redis 7.0 added read/write-scoped patterns, `%R~<pattern>` and `%W~<pattern>`, so a user can be granted read-only access to one prefix and write access to another without granting full read-write on either.
- **Pub/Sub channels**: `&<pattern>` (Redis 6.2+), `allchannels`, `resetchannels`.
- **Passwords**: `><password>` adds a valid password (a user can have several); `<<password>` removes one; `nopass` accepts any password; `resetpass` clears all passwords and the `nopass` flag. `ACL GENPASS` generates a strong random password so nobody has to invent one.
- **Selectors** (Redis 7.0+): `(<rule list>)` attaches an independent, alternative rule set to the user — a command is allowed if it matches *either* the root rules *or* any selector. This is how a user gets two unrelated capability sets at once, e.g. `+GET ~key1 (+SET ~key2)` lets that user `GET key1` or `SET key2 ...` but not `GET key2` or `SET key1 ...`.
- **`reset`**: returns the user to its just-created state (off, no password, no keys, no channels, no commands).

Inspecting a user: `ACL LIST` prints every user in `redis.conf`-compatible syntax; `ACL GETUSER <user>` returns a structured (field/value) breakdown better suited to tooling; `ACL WHOAMI` reports the currently authenticated user; `ACL CAT [category]` lists categories, or the commands inside one.

One sharp edge the docs call out directly: key patterns only restrict commands that name specific keys as arguments. Whole-database commands like `FLUSHALL`, `FLUSHDB`, and `SWAPDB` take no key arguments, so a user scoped to `~tenant1:* +@all` can still `FLUSHALL` the entire instance — the pattern never applies. Those commands have to be denied explicitly (`-flushall -flushdb -swapdb`) regardless of how tight the key pattern looks.

Users can be defined directly in `redis.conf` (`user <username> ... rules ...`) or, for anything beyond a handful of users, in a separate `aclfile` referenced by the `aclfile` directive — the two are mutually exclusive. An external ACL file supports `ACL LOAD` (reload from disk after a manual edit) and `ACL SAVE` (persist the live in-memory ACL state back to the file), independent of `CONFIG REWRITE`.

### Native TLS since Redis 6.0: no more `stunnel`

The same 6.0 release that introduced ACLs also gave `redis-server` optional built-in TLS support (compiled in with `make BUILD_TLS=yes`, requiring OpenSSL). Where the book had to run an entirely separate `stunnel` process pair with its own ports and config files, TLS today is a handful of `redis.conf` directives on the server Redis process itself:

```
tls-port 6379
tls-cert-file /path/to/redis.crt
tls-key-file /path/to/redis.key
tls-ca-cert-file /path/to/ca.crt
tls-dh-params-file /path/to/redis.dh
```

`tls-port` is *additive* to the plaintext `port` — a server can accept both TLS and non-TLS connections on different ports simultaneously — or plaintext can be disabled outright with `port 0` to force TLS-only:

```
port 0
tls-port 6379
```

By default Redis uses **mutual TLS**: clients must present a certificate that validates against the configured CA, not just verify the server's certificate. That's a meaningfully stronger default than the book's `stunnel` setup, which only required a shared private key file. Client authentication can be disabled with `tls-auth-clients no` if only server-side encryption is wanted. `tls-replication yes` extends TLS to master-replica links, and `tls-cluster yes` extends it to the Redis Cluster bus and cross-node traffic — neither of which `stunnel` could easily reach, since it wraps one client-server connection at a time rather than Redis's own internal protocols.

Connecting with `redis-cli` over TLS:

```
./redis-cli --tls --cert ./redis.crt --key ./redis.key --cacert ./ca.crt
```

versus the book's approach of pointing a plain (non-TLS) `redis-cli` at a local `stunnel` port that did the encrypting on its behalf.

### Book vs today

> **The book's `stunnel` chapter isn't wrong, it's dated.** Everything the book says about `stunnel` was accurate and reasonable for a 2015 Redis instance, because `stunnel` genuinely was the only way to get TLS in front of Redis at the time. What's changed isn't that the book's technique stopped working — `stunnel` still functions as a generic TLS wrapper for any TCP service — it's that Redis absorbed the capability directly, removing an entire extra process, an extra config file, an extra port to firewall, and an extra thing that can crash or misconfigure independently of `redis-server` itself. `tls-cluster` and `tls-replication` also reach internal Redis traffic that a `stunnel` wrapper around the client-facing port never touched at all.
>
> **`rename-command` didn't get replaced so much as made unnecessary for its stated purpose.** The book uses renaming as a stand-in for real access control — hide `FLUSHALL` under a random string because there's no way to say "this client may not call `FLUSHALL`." ACLs say that directly: `-flushall` on a user's rule list is enforced, not obscured. `rename-command` still exists in modern Redis as a legitimate defense-in-depth directive (it still literally works, and pairs fine with ACLs), but the book's specific rationale for it — "we have no other way to restrict this command per-client" — is gone.
>
> **`requirepass` is not deprecated, it's absorbed.** A modern Redis instance using only `requirepass` and no other ACL configuration behaves exactly like the book describes: one password, full access once authenticated. That's not a legacy fallback bolted on for compatibility's sake — it's `requirepass` setting the password on the `default` user, which is just an ACL user with `+@all ~* &*` baked in. The book's entire security model is still fully expressible as one specific (very permissive) ACL configuration; it just isn't the only option anymore, and it isn't the safe default for a new, restricted user (which starts `off`, `-@all`, no keys).

## Trade-offs

- **ACLs trade a one-line password for real administrative surface.** `requirepass` is a single config line; a multi-user ACL deployment means maintaining an `aclfile` (or `redis.conf` user blocks), deciding what each role actually needs, and keeping it in sync as commands and categories change across Redis versions. For a single trusted internal service hitting one Redis instance, the book's `requirepass` model is still a defensible, low-overhead choice — ACLs earn their cost when multiple distinct clients need distinct trust levels.
- **Key patterns don't cover whole-database commands, and that gap is easy to miss.** `FLUSHALL`, `FLUSHDB`, and `SWAPDB` take no key arguments, so no `~pattern` restricts them — Redis's own docs give the exact failure case: a user scoped to `~tenant1:*` can still nuke the entire keyspace unless those commands are explicitly denied. A tightly scoped key pattern can create false confidence if the command-level denies aren't written just as explicitly.
- **Selectors add real power at the cost of readability.** `+GET ~key1 (+SET ~key2)` is precise, but a user with several selectors requires reading root rules *and* every selector to know what they can actually do, since a command is permitted if it matches *any* of them. It's the right tool for "this user genuinely needs two unrelated capability sets," and overkill for anything simpler than that.
- **`rename-command` is still security-through-obscurity, even post-ACL.** It's a legitimate defense-in-depth layer alongside ACLs (raising the bar for anyone who's compromised a low-privilege connection and is guessing at admin command names), but it was never real access control and still isn't — a determined attacker with an authenticated connection and enough attempts can still find a renamed command. ACL `-command`/`-@category` rules are the actual enforcement; renaming is a secondary hardening step, not a substitute.
- **Native TLS is a real throughput cost, paid directly by `redis-server` now instead of by a separate process.** Redis's own docs are explicit that TLS "results in a decrease of the achievable throughput per Redis instance" due to encryption, decryption, and integrity-check overhead on every connection. With `stunnel`, that cost sat in a separate process that could be scaled or moved independently; with native TLS it's inline in the same process serving commands, though Redis 8.0 added I/O-threading support for TLS specifically to claw some of that back.
- **TLS support has to be compiled in — it's not automatically present.** `BUILD_TLS=yes` at build time (plus OpenSSL dev libraries) is a prerequisite; a stock binary built without that flag has no `tls-port` to configure at all. Confirming TLS is actually available before designing around it is a real first step, unlike the book's `stunnel` approach, which layers on top of *any* Redis build since it never touches Redis's own binary.
- **Mutual TLS is the default, which is stricter than most teams expect on first setup.** Redis requires client certificates by default once `tls-port` is configured, not just a trusted server certificate — a meaningfully different failure mode than the book's shared-key `stunnel` setup or a plain `requirepass` password. Turning it off (`tls-auth-clients no`) is one directive, but it's easy to hit as a surprising connection failure the first time TLS is enabled without a client cert provisioned.

## Documentation Links

- Maxwell Dayvson Da Silva et al., "Redis Essentials" (Packt, 2015) — Chapter 7, "Security Techniques (Guard Your Data)," p. 131-140 — doc
- [Redis Documentation — ACL (rules, categories, selectors, external ACL files, Sentinel/replica user examples)](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/) — doc
- [Redis Documentation — TLS (build flags, tls-port, certificate directives, mutual TLS, cluster/replication TLS)](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/) — doc
- [Redis Documentation — ACL SETUSER command](https://redis.io/commands/acl-setuser/) — doc
- [Redis Documentation — AUTH command (username/password form)](https://redis.io/commands/auth/) — doc
- [Redis Documentation — ACL CAT command](https://redis.io/commands/acl-cat/) — doc
