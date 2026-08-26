---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the small set of Redis patterns that actually show up in production web applications — not the command reference, but the shapes people reach for over and over: a HASH plus a ZSET for session and login-cookie storage, a `GET`-then-`SET ... EX` cache-aside wrapper for database rows and rendered pages, and `INCR`/sorted sets for counters, analytics, and rate limiting. These are the patterns *Redis in Action* introduces before it ever gets to a full command reference, because — as the book puts it — "each of these pieces can actually be used with little modification directly in your applications." The goal is to understand not just how each pattern works, but the trade-off it is making: what it buys you over hitting the relational database directly, and what new problem (usually invalidation, or staleness) it hands you back.

## Use Cases

- Replacing a relational-database-backed session table with a Redis HASH so that login checks and "recently viewed" tracking survive at web scale — the book's own numbers: a token-cookie table that would cap out a relational database at "roughly 200–2,000 individual rows every second per database server" instead sustains "at least 20,000 item views every second" on a single Redis server.
- Caching a fully rendered web page for a fixed window (`cache:` + `SET ... EX 300`) when 95% of traffic hits pages that "change at most once per day," cutting a 20–50ms render down to "one round trip to Redis (under 1ms for a local connection)."
- Caching individual database rows — not whole pages — for content that changes too often to cache wholesale, like a live inventory count on a daily-deal item, using a background daemon that re-reads the row on a per-item schedule instead of on every request.
- Building request throttling or a login-attempt limiter with `INCR` + `EXPIRE` (fixed window) or a sorted set of timestamps (sliding window) instead of hand-rolling counters against a relational table.
- Tracking page-view popularity with a single ZSET (`ZINCRBY`) to decide *which* pages are hot enough to be worth caching at all, rather than caching everything and running out of memory.
- Deciding, when a login session or cache entry needs to disappear, whether `EXPIRE`/TTL is the right tool or whether an explicit size-bounded cleanup daemon is — these are not interchangeable, and the book is explicit about why.

## Deep Dive

### Session and login-cookie caching: the canonical Redis use case

*Redis in Action* opens its practical chapter with this pattern for a reason — it is the one nearly every web application needs, and it maps almost too well onto Redis's data types. The setup: Fake Web Retailer issues a random *token cookie* rather than a signed cookie ("more information to store on the server," but it avoids the failure mode where "it's easy to forget to sign and/or verify data, allowing security vulnerabilities"). The token is a key into a Redis HASH called `login:`, mapping token to user:

```
def check_token(conn, token):
    return conn.hget('login:', token)
```

Updating a session on every visit does three things at once, wrapped so it costs one round trip: record which user owns the token, timestamp the visit in a ZSET called `recent:` (score = timestamp, so the ZSET is always sorted oldest-to-newest), and — if the user viewed an item — push that item into a per-token `viewed:<token>` ZSET, trimmed to the most recent 25 entries with `ZREMRANGEBYRANK ... 0 -26`.

The interesting design decision is *how* old sessions get cleaned up, and this is where the book earns its "practical guide" label instead of just teaching commands. There are two ways to bound session storage:

1. **A size-bounded cleanup daemon.** Keep the 10 million most recent sessions by loop: check `ZCARD('recent:')`, and once it exceeds the limit, pull the oldest 100 tokens off the front of the `recent:` ZSET (cheap, because it's already sorted by timestamp) and delete their HASH entries and `viewed:` ZSETs.
2. **`EXPIRE` on each key.** Simpler to write, and the book flags it explicitly as a real alternative: "we could omit the recent ZSET, store login tokens as plain key-value pairs, and use Redis EXPIRE to set a future date or time to clean out both sessions and our recently viewed ZSETs."

The book picks the daemon over `EXPIRE` for a reason worth internalizing, not just a stylistic preference: "using EXPIRE prevents us from explicitly limiting our session information to 10 million users, and prevents us from performing abandoned shopping cart analysis during session expiration, if necessary in the future." `EXPIRE` gives you *time-bounded* storage; a scored ZSET plus a cleanup loop gives you *count-bounded* storage, and only the second one lets you look at a session one last time before it disappears. That's the trade-off underneath a decision that looks, at first glance, like "which command do I call."

Shopping carts reuse the same session token as a key into a second HASH (`cart:<session>`, item ID to quantity) — deliberately simple, with validation left to the application layer: "we'll have the web application handle validation for item count, so we only need to update counts in the cart as they change." The payoff of colocating cart and session under one identifier is that the cleanup daemon that expires old sessions can delete the cart in the same pass, and — because both are already in Redis — the retailer can now compute "People who looked at this item ended up buying this item X% of the time" without a single extra database write.

### Cache-aside: pages, rows, and the invalidation problem you inherit

The web-page cache is close to the textbook definition of cache-aside: check the cache, and only do the expensive work on a miss.

```
def cache_request(conn, request, callback):
    if not can_cache(conn, request):
        return callback(request)
    page_key = 'cache:' + hash_request(request)
    content = conn.get(page_key)
    if not content:
        content = callback(request)
        conn.setex(page_key, content, 300)
    return content
```

(The book's `conn.setex(page_key, content, 300)` is the Python client's argument order; the equivalent raw command is `SETEX page_key 300 content` — key, seconds, value.) A flat 5-minute TTL is the whole invalidation strategy here, and it works precisely because the underlying data is one where staleness is cheap: "95% of the web pages that they serve change at most once per day." TTL-based expiry is the right tool exactly when you can bound how wrong a stale answer is allowed to be, and for how long.

Database row caching is the same cache-aside idea applied to something that *can't* tolerate five minutes of staleness — a daily-deal item's live inventory count, where showing a stale quantity risks overselling. Instead of caching on a request-triggered TTL, the book flips to a **push model**: a `schedule_row_cache()` call registers a row ID in two ZSETs — `delay:` (how often, in seconds, this row should be refreshed) and `schedule:` (when it's next due) — and a separate `cache_rows()` daemon continuously pulls the earliest-due row, re-reads it from the database, and writes `SET inv:<row_id> <json>`. Setting a row's delay to zero or less is the signal to stop caching it and delete the cached value outright.

This is the invalidation problem made concrete: a plain TTL cache answers "how long can this be stale?" with one global number, but a row whose write frequency varies — "it probably makes sense to update the cached row every few seconds if there are many buyers. But if the data doesn't change often... it may make sense to only update the cache every minute" — needs a *per-key* refresh schedule, not a per-cache one. The schedule/delay ZSET pair is a small, self-contained solution to "which entries are stale and need refreshing now," which is the harder half of any cache-aside design; the easy half (read cache, fall back to source) is one `GET`.

### Counters, analytics, and rate limiting

Chapter 2's simplest analytics addition is a single extra line in the session-update path: `conn.zincrby('viewed:', item, -1)`, turning `viewed:` into a global ZSET of every item ever seen, ranked by view count (negative increments so the most-viewed item lands at rank 0 — a ZSET-sorting trick worth noticing on its own). A daemon rescales it every five minutes — drop everything outside the top 20,000, then halve every remaining score with `ZINTERSTORE('viewed:', {'viewed:': .5})` — which keeps recently-popular items competitive against older items that racked up a big count once and then went cold. `can_cache()` then becomes a single `ZRANK` check: only cache a page if its item is in the top 10,000 by view count. That's the whole feedback loop that decides *which* pages earn a cache entry in the first place, built from one sorted set and one rescaling job.

Chapter 5's `update_counter()` generalizes this into real time-series metrics: for each of several precisions (1 second, 5 seconds, 1 minute, ... up to 1 day), it does a `ZADD('known:', hash, 0)` to register the counter's existence and an `HINCRBY` to bump the count for the current time bucket, all in one pipeline. The `known:` ZSET (every score fixed at 0, so Redis falls back to sorting by member name) exists purely so a cleanup daemon can enumerate every counter that's ever been written without a `KEYS` scan. The book is explicit about why this doesn't just use `EXPIRE` per bucket: "one limitation of the EXPIRE command is that it only applies to whole keys; we can't expire parts of keys" — and a counter here is one HASH holding *all* time buckets for a given precision, so expiring the whole key would throw away buckets that haven't aged out yet.

**Book vs today — rate limiting specifically.** Neither chapter builds a request-throttling rate limiter outright; the closest analogue is the time-bucketed HINCRBY counter above, which is a fixed-window counter in spirit. Checking that against current guidance: the [official Redis rate-limiter documentation](https://redis.io/docs/latest/develop/use-cases/rate-limiter/) confirms fixed-window counting is still a first-class, recommended pattern — "`INCR` and `EXPIRE` give you atomic fixed-window counters with automatic time-window cleanup" — so the book's instinct to reach for an incrementing counter with a time boundary was correct and remains current. What's added since 2013 is the **sliding-window log**, built on a sorted set rather than a hash: log every request's timestamp as a ZSET member, and on each new attempt, drop everything older than the window with `ZREMRANGEBYSCORE`, then check `ZCARD` against the limit before `ZADD`-ing the new entry. That structure is the same tool the book already uses for `recent:` and `viewed:` — a timestamp-scored ZSET — just aimed at a smaller, per-client key instead of a global one. Redis also now documents token-bucket rate limiting built with Lua/`EVAL` to keep the read-decide-update cycle atomic, which matters for exactly the same race-condition reason the book calls out for its own counter cleanup code. None of this contradicts the book — it's the same primitives (ZSET, `INCR`, `EXPIRE`) recombined for a stricter guarantee (no burst above N *in any* rolling window, not just per fixed bucket).

**Book vs today — `SETEX` and `SET ... EX`.** `SETEX key seconds value` still works exactly as the book uses it — it isn't deprecated. Current Redis docs describe it as simply equivalent to `SET key value EX seconds`, and that unification was already true in Redis 2.6.12 (2013), predating this book. There's no real gap here — `SETEX` remains fine to use, though `SET ... EX` is the more idiomatic modern form because the same command also composes with `NX`/`XX`/`GET`.

**Worth knowing — client-side caching.** The cache-aside pattern above (poll a TTL, accept staleness up to that TTL) is still exactly how most applications cache today. What's new since Redis 6.0 (2020) is **client-side caching over RESP3**: a client can ask Redis to *track* the keys it reads, and Redis pushes an invalidation message the moment another client modifies one of those keys — "each time the value of a cached key is modified in the database, Redis pushes an invalidation message to all the clients that are caching the key, telling the clients to flush the key's locally cached value." That's a genuinely different tool from anything in these chapters: instead of a client guessing a TTL, the server tells it exactly when its cached copy went stale. It doesn't replace the page/row cache-aside pattern above — that's still the right shape for cache *stored in Redis* — but it's worth knowing about for cache stored in application memory, which these chapters don't cover at all.

## Trade-offs

- **TTL-based expiry (`EXPIRE`/`SETEX`) trades precision for simplicity.** One number bounds staleness for every key it's applied to; it's trivial to reason about and free to implement, but it can't express "refresh this row every few seconds while demand is high, every minute otherwise" — that needs the schedule/delay ZSET pattern, which is more code for a real gain in freshness control on hot keys.
- **Count-bounded cleanup (a scored ZSET plus a daemon) trades simplicity for control.** It's strictly more code than `EXPIRE`, but it's the only one of the two that lets you bound *storage* directly ("keep the most recent 10 million sessions") and the only one that gives you a last look at data before deletion — the book's own reason for choosing it for session cleanup. Reach for `EXPIRE` when staleness is the thing you're bounding; reach for a ZSET-and-daemon when count or "do something on the way out" is the thing you're bounding.
- **Cache-aside pushes the invalidation decision onto you, permanently.** The read path (`GET`, fall back to source, `SET ... EX` on miss) is the easy half and looks the same for a page cache and a row cache. The hard half — deciding *when* a specific key's cached value is wrong — is different for every workload: a flat TTL for content that "changes at most once per day," a per-row refresh schedule for a live inventory count, a `DEL` on write for anything where staleness is unacceptable even briefly. Getting the read path right without ever deciding on an invalidation story is how caches go stale silently.
- **A fixed-window counter (`INCR` + `EXPIRE`, or the book's precision-bucketed `HINCRBY`) is cheap and can be gamed at the window boundary.** A client can send N requests in the last millisecond of one window and N more in the first millisecond of the next, doubling the effective rate right at the seam — acceptable for analytics dashboards, a real gap for anything security-sensitive like login-attempt throttling. The sliding-window-log pattern (sorted set of timestamps, pruned with `ZREMRANGEBYSCORE`) closes that gap at the cost of one sorted-set member per request instead of one integer per window — more memory and CPU for a real guarantee.
- **Colocating session, cart, and viewed-items under one token ID is convenient until it's a single point of blast radius.** The book leans on this deliberately — one cleanup pass deletes `login:`, `cart:<token>`, and `viewed:<token>` together — but it also means a bug in the cleanup daemon's key construction touches three data shapes at once instead of one. Worth naming as the flip side of the "small number of tightly coupled keys" design this whole chapter teaches.
- **Redis's speed here is a consequence of moving writes off the relational database, not a replacement for it.** Every pattern in this concept assumes the relational database (or another system of record) still exists somewhere for data that must survive a Redis restart without persistence tuned for durability, or that needs relational query flexibility. Redis is doing the parts of the job — session lookups, hot-path counters, short-lived caches — that a relational database is comparatively bad at under load, not replacing it as the source of truth.

## Documentation Links

- [Josiah Carlson, "Redis in Action" (Manning, 2013) — Chapter 2, "Anatomy of a Redis web application," p. 24-36](https://www.manning.com/books/redis-in-action) — doc
- [Josiah Carlson, "Redis in Action" (Manning, 2013) — Chapter 5, "Using Redis for application support," sections 5.1-5.2, p. 90-101](https://www.manning.com/books/redis-in-action) — doc
- [Redis Documentation — EXPIRE (TTL semantics, expire accuracy, replication behavior)](https://redis.io/docs/latest/commands/expire/) — doc
- [Redis Documentation — SETEX (equivalence to SET key value EX seconds)](https://redis.io/docs/latest/commands/setex/) — doc
- [Redis Documentation — SET (EX/PX/NX/XX/GET options)](https://redis.io/docs/latest/commands/set/) — doc
- [Redis Documentation — Sorted sets (ZADD, ZINCRBY, ZREMRANGEBYRANK, ZREMRANGEBYSCORE, ZINTERSTORE)](https://redis.io/docs/latest/develop/data-types/sorted-sets/) — doc
- [Redis Documentation — Redis rate limiter use case (fixed window, sliding window, token bucket)](https://redis.io/docs/latest/develop/use-cases/rate-limiter/) — doc
- [Redis Documentation — Client-side caching reference (RESP3 tracking and invalidation)](https://redis.io/docs/latest/develop/reference/client-side-caching/) — doc
