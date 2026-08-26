---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Move past "Redis has more commands than just GET/SET" and understand that Sets, Sorted Sets, Bitmaps, and HyperLogLog are four genuinely different **data structures**, each optimized for a different question. A Set answers "is X a member, and what's the overlap with other groups?" in O(1) with real set algebra. A Sorted Set answers "what's X's rank, and what falls in this range?" by keeping a skip list ordered by score — the same structure serving as both a live leaderboard and a range index. A Bitmap answers "did user N do this?" by spending one bit per possible ID instead of one Set entry per actual member. HyperLogLog answers "roughly how many distinct things happened?" by throwing away exactness in exchange for a fixed ~12 KB no matter how large the set gets. Picking the wrong one isn't a style mistake — it's the difference between a leaderboard query and a full table scan, or between 12 KB and multiple gigabytes for the same count.

## Use Cases

- **Set-algebra membership**: "filtering all flights that depart from a given city and arrive in another," "grouping all users who viewed similar products," "checking whether a user is on a blacklist" — the book's own list of Set use cases, all backed by `SINTER`/`SUNION`/`SDIFF` doing the join instead of application code.
- **A deal-tracking system** (the book's worked example): each deal is a Set of user IDs it was sent to, so "mark a deal as sent," "check whether a user received a group of deals," and "gather metrics from the sent deals" are `SADD`, `SISMEMBER`, and `SINTER`/`SUNION` across multiple deal Sets — no separate join table needed.
- **A game leaderboard** (the book's worked example): "show a leaderboard of a massive online game that displays the top players, users with similar scores, or the scores of your friends" — one Sorted Set, ordered by `ZADD`'s score, answers "top N," "this player's rank," and "players ranked near this player" without a separate ORDER BY query.
- **Real-time web analytics** (the book's worked example): "did user X perform action Y today?" and "how many users performed action Y this week?" — a Bitmap keyed by date, one bit per user ID, answers both with `SETBIT`/`GETBIT`/`BITCOUNT`, and `BITOP OR` across days answers "how many users visited on either day?" without touching a Set at all.
- **Unique-visitor counting at scale** (the book's worked example): counting how many distinct UUIDs hit a site per hour, per day, per month — a HyperLogLog per hour, merged with `PFMERGE` into daily and monthly totals, at a cost that stays flat regardless of how many visitors there actually were.
- **Autocomplete and range indexes**: Sorted Sets can "build an autocomplete system using millions of words" or a real-time waiting list, because `ZRANGEBYSCORE`/`ZRANGEBYLEX` turn the same structure into an ordered index, not just a ranking.

## Deep Dive

### Sets: unordered, unique, and built for algebra

"A Set in Redis is an unordered collection of distinct Strings—it's not possible to add repeated elements to a Set." That's the whole contract: no order, no duplicates. What makes it fast is the implementation, not the API: "Internally, a Set is implemented as a hash table, which is the reason that some operations are optimized: member addition, removal, and lookup run in O(1), constant time." A Set can hold up to 2³²−1 elements, and its memory footprint shrinks further when every member is an integer (governed by `set-max-intset-entries`).

The core commands, per *Redis in Action*'s command tables:

| Command | Does |
|---|---|
| `SADD key item [item ...]` | Adds items, "returns the number of items added that weren't already present" |
| `SREM key item [item ...]` | Removes items, returns the number actually removed |
| `SISMEMBER key item` | "Returns whether the item is in the SET" |
| `SCARD key` | Number of items in the Set |
| `SMEMBERS key` | All items, as a Set |
| `SRANDMEMBER key [count]` | One or more random items — positive `count` returns distinct items, negative allows repeats |
| `SPOP key` | Removes and returns a random item |
| `SMOVE source dest item` | Atomically moves an item between two Sets |

What separates a Set from a plain collection is the algebra layer — the reason the book calls it out as the type's "real power":

| Command | Does |
|---|---|
| `SDIFF key [key ...]` | Items in the first Set not present in any of the others |
| `SINTER key [key ...]` | Items present in *every* given Set |
| `SUNION key [key ...]` | Items present in *at least one* given Set |
| `SDIFFSTORE` / `SINTERSTORE` / `SUNIONSTORE` | Same three operations, but persist the result at `dest-key` instead of returning it |

*Redis Essentials* walks these with a music app where each user has a `favorite_artists` Set. Max and Hugo each `SADD` their favorites; `SINTER user:max:favorite_artists user:hugo:favorite_artists` returns only `"Arctic Monkeys"` — the one artist both like. `SDIFF` in one key order returns what Max likes that Hugo doesn't (`"Belle & Sebastian"`, `"Arcade Fire"`, `"Lenine"`); reversed, it returns Hugo's exclusives. `SUNION` returns all six artists combined, deduplicated for free. **Key order matters for `SDIFF`** — it isn't commutative the way `SINTER`/`SUNION` are.

The book's **deal-tracking system** turns this into an application: every deal is a Set of the user IDs it was sent to. `markDealAsSent(dealId, userId)` is just `SADD`. `sendDealIfNotSent` checks `SISMEMBER` before sending, so a deal is never resent. `showUsersThatReceivedAllDeals(dealIds)` is `SINTER` across every deal Set in the list — "a commercial partner might want a list of all users who received all of its deals in a given week." `showUsersThatReceivedAtLeastOneOfTheDeals` is the same query with `SUNION`. Neither needs a join table or an application-side loop; the set algebra runs inside Redis and returns the answer directly.

### Sorted Sets: the same structure serves as leaderboard *and* range index

"A Sorted Set is very similar to a Set, but each element of a Sorted Set has an associated score. In other words, a Sorted Set is a collection of nonrepeating Strings sorted by score." Members are still unique — no duplicate values — but ties on score are broken by "the lexicographical order of the element values," which is a real, observable ordering rule, not an implementation detail: `ZADD leaders 100 "Alice"` and `ZADD leaders 100 "Zed"` leaves Alice ranked below Zed purely because `"Alice" < "Zed"` alphabetically.

That ordering costs something: "Adding, removing, and updating an item in a Sorted Set runs in logarithmic time, O(log(N))" — slower than a Set's O(1), because "the scores need to be compared." Internally a Sorted Set is "implemented as two separate data structures: a skip list with a hash table" (for fast ordered search) "and a ziplist" for small sets under the `zset-max-ziplist-entries`/`-value` thresholds — the encoding itself changes as the set grows, which is worth knowing when a benchmark on a small ziplist-encoded set doesn't reproduce at production scale.

The commands split cleanly into "manage a member" and "read a range":

| Command | Does |
|---|---|
| `ZADD key score member [...]` | Adds/updates members with scores |
| `ZREM key member [...]` | Removes members |
| `ZCARD key` | Number of members |
| `ZINCRBY key incr member` | Adjusts a member's score |
| `ZSCORE key member` | A member's score |
| `ZRANK` / `ZREVRANK key member` | A member's position, low-to-high or high-to-low ("the member with the lowest score has rank 0") |
| `ZRANGE` / `ZREVRANGE key start stop [WITHSCORES]` | Members between two rank positions, ascending or descending |
| `ZRANGEBYSCORE` / `ZREVRANGEBYSCORE key min max [LIMIT offset count]` | Members between two **scores**, not ranks |
| `ZCOUNT key min max` | How many members fall in a score range, without fetching them |
| `ZREMRANGEBYRANK` / `ZREMRANGEBYSCORE` | Bulk-delete by rank window or score window |
| `ZINTERSTORE` / `ZUNIONSTORE dest numkeys key [...] [WEIGHTS ...] [AGGREGATE SUM\|MIN\|MAX]` | Set-like intersection/union across Sorted Sets (and plain Sets, which are treated "as though they were ZSETs with all scores equal to 1") |

That last row is the point worth sitting with: `ZRANGE`/`ZREVRANGE` treat the Sorted Set as a **leaderboard** (rank-based access), while `ZRANGEBYSCORE`/`ZCOUNT` treat the exact same structure as a **range index** (score-based access) — one data structure, two access patterns, no duplication.

The book's **leaderboard system** exercises both sides. `addUser`/`removeUser` wrap `ZADD`/`ZREM`. `showTopUsers(quantity)` calls `ZREVRANGE key 0 quantity-1 WITHSCORES` — highest score first. `getUserScoreAndRank(username)` combines `ZSCORE` with `ZREVRANK` to report both a value and a position: `"Details of Maxwell: Score: 10, Rank: #7"`. The more interesting method is `getUsersAroundUser(username, quantity)`, which first calls `ZREVRANK` to find where a player sits, computes a window centered on that rank, then calls `ZREVRANGE` over that window — producing "Users around Felipe: #2 Ana (60), #3 Renata (50), #4 Felipe (40), #5 Patrik (30), #6 KC (20)." That's a "players near me" leaderboard feature built entirely from two rank-based reads.

`ZINTERSTORE`/`ZUNIONSTORE` extend the leaderboard idea into aggregation: with two ZSETs `zset-1` (`a:1, b:2, c:3`) and `zset-2` (`b:4, c:1, d:0`), `ZINTERSTORE` with the default `SUM` aggregate produces `c:4, b:6` — scores of members present in both sets are added together. `ZUNIONSTORE` with `AGGREGATE MIN` instead keeps the lowest score seen for each member across both sets. Because a plain Set can be passed into either as if every member had score 1, these commands double as a way to fold a **membership** signal into a **ranking** signal — for example, boosting an item's combined score just for existing in a "featured" Set.

### Bitmaps: a String wearing a boolean-array costume

"A Bitmap is not a real data type in Redis. Under the hood, a Bitmap is a String... a set of bit operations on a String." Redis just provides commands "to manipulate Strings as Bitmaps" — bit arrays where each offset is a bit, addressable up to 2³² bits (over 4 billion).

| Command | Does |
|---|---|
| `SETBIT key offset 0\|1` | Sets one bit; creates the Bitmap if it doesn't exist |
| `GETBIT key offset` | Reads one bit |
| `BITCOUNT key` | Counts bits set to 1 |
| `BITOP OR\|AND\|XOR\|NOT dest key [key ...]` | Bitwise-combines Bitmaps into a destination key |

The book makes the "why not just use a Set" case with numbers, using a 5-million-user site where 2 million visit on a given day and each user ID would need 4 bytes (32 bits) as a Set member:

| Data type | Bits/user | Users stored | Total memory |
|---|---|---|---|
| Bitmap | 1 | 5,000,000 (worst case — allocates up to the highest user ID touched) | 625 kB |
| Set | 32 | 2,000,000 | 8 MB |

The Bitmap wins by more than 12x here — but the book is careful to show where that flips. Drop the visit count to 100 (worst case still touches the same 5-million-ID space): the Bitmap is still 625 kB, but the Set is now only 3.125 kB. **Bitmap memory cost is driven by the highest offset touched, not by how many bits are actually 1** — dense, ID-space-bounded data favors Bitmaps; sparse membership favors Sets.

The book's **web analytics** example makes `SETBIT`, `BITCOUNT`, and `BITOP` concrete: `storeDailyVisit(date, userId)` calls `SETBIT visits:daily:<date> userId 1`; `countVisits(date)` calls `BITCOUNT` on that key to answer "how many distinct users visited today"; and reading every offset back out with `GET` plus bit-shifting reconstructs the actual list of user IDs who visited (`showUserIdsFromVisit`) — something a raw `SMEMBERS` on a Set would do more directly, but at the Set's memory cost. `BITOP OR` across two days' keys answers "how many distinct users visited on either day" without materializing a union Set at all — a bitwise OR over two byte strings, then `BITCOUNT` the result. One caveat repeated from the book: a Bitmap only records that a visit happened, not how many times — a separate `INCR` counter is still needed for total-visit counts, not unique-visitor counts.

### HyperLogLog: trading exactness for a fixed, tiny memory budget

"A HyperLogLog is not actually a real data type in Redis. Conceptually, a HyperLogLog is an algorithm that uses randomization in order to provide a very good approximation of the number of unique elements that exist in a Set." Redis exposes it through String-backed commands the same way it does Bitmaps. The headline property: "it only runs in O(1), constant time, and uses a very small amount of memory—up to 12 kB of memory per key" — regardless of whether that key is tracking a hundred elements or a hundred million.

The catch is named plainly: "The HyperLogLog algorithm is probabilistic, which means that it does not ensure 100 percent accuracy. The Redis implementation of the HyperLogLog has a standard error of 0.81 percent." It was introduced in Redis 2.8.9, and has exactly three commands — `PFADD`, `PFCOUNT`, `PFMERGE` (the `PF` prefix honors Philippe Flajolet, the algorithm's co-author).

| Command | Does |
|---|---|
| `PFADD key element [...]` | Adds elements; returns 1 if the estimated cardinality changed |
| `PFCOUNT key [key ...]` | One key: its approximate cardinality. Multiple keys: the approximate cardinality of their **union** |
| `PFMERGE dest key [key ...]` | Merges HyperLogLogs into `dest`, preserving the union's cardinality estimate |

The book's memory comparison, counting 100,000 unique 32-byte UUID visitors per hour:

| Data type | Per hour | Per day (×24) | Per month (×30) |
|---|---|---|---|
| HyperLogLog | 12 kB | 288 kB | 8.4 MB |
| Set | 3.2 MB | 76.8 MB | 2.25 GB |

At a month's scale, that's 8.4 MB against 2.25 GB for the *same count* — a Set pays for every distinct UUID it stores; a HyperLogLog pays a flat fee no matter how many distinct values pass through it.

The worked example builds hourly buckets (`visits:2015-01-01T0` … `T23`) with `PFADD`, reads a single hour or a handful of hours with `PFCOUNT`, then rolls 24 hourly keys into one daily key with `PFMERGE` — "Aggregated date 2015-01-01" followed by a `PFCOUNT` on the merged key. Because `PFADD` silently ignores values it's already seen (`"HyperLogLog's cardinality is not changed, since HyperLogLogs only take unique values into consideration"`), the same simulation loop that calls `addVisit` with random repeats still produces a correct unique-visitor estimate. What a HyperLogLog can never do, by design, is give back *which* elements it counted — `PFCOUNT` returns a number, never a member list. That's the trade the structure makes explicit: give up membership and exactness, keep the count and the fixed memory bound.

### Book vs today

> Both books predate a real expansion of Redis's probabilistic toolkit. **Redis 8.0 (May 2025)** folded five previously-separate-module data structures directly into core Redis: "Five probabilistic data structures: Bloom filter, Cuckoo filter, Count-min sketch, Top-k, and t-digest... These nine components are included in all binary distributions" (the release notes count Bloom/Cuckoo/Count-min/Top-k/t-digest alongside Search, JSON, time series, and vector sets as the "8 new data structures" now standard). This isn't a replacement for HyperLogLog — HyperLogLog answers "how many distinct things," while a Bloom or Cuckoo filter answers a different question, "have I seen this exact thing before," in equally fixed, tiny memory. A Cuckoo filter adds what neither Bloom filters nor HyperLogLog offer: item deletion. Where the books had exactly one probabilistic tool for exactly one job, current Redis ships a family of them.

> **`SINTERCARD`** (added in Redis 7.0, after both books) is the more efficient modern answer to a question the book only solves with `SINTER key1 key2 | count the result`: "returns just the cardinality of the result" of an intersection without ever materializing the member list, and its optional `LIMIT` lets Redis stop counting early once a threshold is reached — useful for a yes/no "do these two groups overlap by at least N" check where `SINTER` would do needless work building an array you'd immediately discard.

## Trade-offs

- **Set algebra is O(1) per element but the join itself isn't free.** `SINTER`/`SUNION`/`SDIFF` push the join into Redis instead of the application, which is the whole appeal — but the cost scales with the size of the sets being combined, and by default the full result materializes and crosses the wire. When only the *count* of an intersection is needed (a "how much overlap" check, not the member list), `SINTERCARD` avoids building and returning that result set — a newer, narrower tool than what the book teaches with `SINTER`.
- **Sorted Sets buy two access patterns (rank and range) for one O(log N) write cost, but the internal encoding is not fixed.** A Sorted Set below the `zset-max-ziplist-entries`/`-value` thresholds is a ziplist; above it, a skip list plus hash table. Code and benchmarks validated on a small leaderboard can behave differently once real traffic pushes the set past that threshold — the O(log N) guarantee holds either way, but the constant factor and memory layout don't.
- **Score ties are broken lexicographically, silently.** Two members with identical scores are ordered alphabetically by value, not by insertion order or arbitrarily — as the book's Alice/Zed example shows. A leaderboard that expects insertion order as a tiebreaker will get alphabetical order instead unless scores are made unique (e.g., encoding a timestamp into the low bits of the score).
- **A Bitmap's efficiency depends entirely on ID density, not on how many bits are set.** The same 5-million-ID space costs 625 kB whether 2 million users visited or 100 did, because the worst case is driven by the highest offset touched. Bitmaps win decisively when the domain maps cleanly onto small, dense integer IDs (user IDs, day-of-year); they lose badly against a Set once IDs are sparse, non-sequential, or drawn from a space far larger than the actual membership (UUIDs, hashed IDs) — there, `SETBIT` at a huge offset just wastes memory a Set would never allocate.
- **HyperLogLog's fixed ~12 KB is the entire trade: exactness and membership are both gone, permanently.** `PFCOUNT` returns an estimate with roughly 0.81% standard error and can never answer "who was counted" — there's no way to enumerate members back out of a HyperLogLog, unlike a Set or Bitmap. That's the right trade for "roughly how many," and the wrong structure entirely the moment a feature needs "which ones."
- **Choosing among these four (plus a plain Set) is a modeling decision the books make you work through by hand, with a memory table, every time.** Both books repeat the same exercise — write out bits/bytes-per-member × expected cardinality for each candidate structure — because there's no single "always right" answer: unique membership with algebra wants a Set, ranked/range access wants a Sorted Set, dense boolean-per-ID wants a Bitmap, and approximate large-scale counting wants HyperLogLog (or, today, one of Redis 8's other probabilistic structures if the question is membership rather than cardinality).

## Documentation Links

- [Maxwell Dayvson Da Silva and Hugo Lopes Tavares, "Redis Essentials" (Packt Publishing, 2015) — Chapter 2, "Advanced Data Types (Earning a Black Belt)," p. 27-53](https://www.packtpub.com/product/redis-essentials/9781784392451) — doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013) — Chapter 3, "Commands in Redis," sections 3.3 Sets and 3.5 Sorted sets, p. 46-54](https://www.manning.com/books/redis-in-action) — doc
- [Redis Documentation — Sets](https://redis.io/docs/latest/develop/data-types/sets/) — doc
- [Redis Documentation — Sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) — doc
- [Redis Documentation — Bitmaps](https://redis.io/docs/latest/develop/data-types/bitmaps/) — doc
- [Redis Documentation — HyperLogLog](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/) — doc
- [Redis Documentation — SINTERCARD](https://redis.io/docs/latest/commands/sintercard/) — doc
- [Redis Documentation — Bloom filter](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/) — doc
- [Redis Documentation — Cuckoo filter](https://redis.io/docs/latest/develop/data-types/probabilistic/cuckoo-filter/) — doc
- [Redis Open Source 8.0 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.0-release-notes/) — doc
