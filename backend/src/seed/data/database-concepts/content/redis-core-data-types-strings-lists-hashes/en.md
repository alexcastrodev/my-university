---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand Redis's three most common data types — **Strings**, **Lists**, and **Hashes** — not as three flavors of the same key-value idea, but as three distinct structures with their own command surface, their own Big-O behavior, and their own internal encoding. *Redis in Action* frames the whole point of having more than one type up front: "Redis allows us to store keys that map to any one of five different data structure types." *Redis Essentials* puts the same idea more bluntly — "The main reason for Redis to have many data types is very simple: one size does not fit all, and different problems require different solutions." This concept is about picking the right one and knowing the commands that make it work.

## Use Cases

- **Caching a page fragment, an API response, or a rendered value** — plain `SET`/`GET`, optionally with `SETEX`/`EXPIRE` so the cache self-expires: "Strings combined with automatic key expiration can make a robust cache system... very useful when database queries take a long time to run and can be cached for a given period of time."
- **A view counter, a like counter, a rate-limit counter** — `INCR`/`INCRBY` on a String, atomically, with no read-modify-write race: "Good examples of counters are page views, video views, and likes."
- **A work queue between a producer and a consumer process** — `LPUSH` on one end, a blocking `BRPOP` on the other, exactly the pattern *Redis Essentials* builds as a Node.js `Queue` class with `push`/`pop` methods backed by `LPUSH`/`BRPOP`.
- **A bounded list of recent items** — most-recent-N tweets, most-recent-N viewed products — pushed with `LPUSH`/`RPUSH` and trimmed with `LTRIM`, relying on O(1) push/pop at either end.
- **An object with several named fields that belong together** — an article's title, author, and vote count, or *Redis Essentials*'s own example, a movie's title/year/rating/watcher-count — stored as one Hash instead of several separate String keys, because "it is more semantic to use a Hash in that case because the two fields belong to the same object."
- **Memory-efficient storage of millions of small objects** — the Instagram case study *Redis Essentials* cites directly: back-referencing 300 million media IDs to user IDs "used one key per media ID and around 21 GB of memory" as Strings, versus "around 5 GB with some configuration tweaks" once switched to Hashes.

## Deep Dive

### Strings: the versatile primitive

A Redis String is not "just text." *Redis Essentials* is explicit that "A String can behave as an integer, float, text string, or bitmap based on its value and the commands used. It can store any kind of data: text (XML, JSON, HTML, or raw text), integers, floats, or binary data (videos, images, or audio files)." *Redis in Action*'s command-focused chapter is more precise about the same idea: "In Redis, STRINGs are used to store three types of values: Byte string values, Integer values, Floating-point values." The type Redis assigns internally depends on what you put in, not on a schema you declared. One limit both books' era shares with today: **"A value can't be bigger than 512 MB."**

The core commands:

| Command | What it does |
|---|---|
| `SET` / `GET` | "We can GET values, SET values, and DEL values" — the baseline read/write. |
| `MSET` / `MGET` | Set or fetch several keys in one round trip — "the arguments are key-value pairs separated by spaces" for `MSET`; `MGET` returns `nil` "for every key that does not hold a String value or does not exist." |
| `SETEX` / `EXPIRE` / `TTL` | Attach an expiration; `TTL` returns seconds left, `-1` if the key has no expiration, `-2` if it is gone. |
| `INCR` / `INCRBY` / `DECR` / `DECRBY` / `INCRBYFLOAT` | Atomic numeric mutation — "increments a key by 1 and returns the incremented value" — with `INCRBY`/`DECRBY`/`INCRBYFLOAT` taking an explicit amount. |
| `APPEND` / `GETRANGE` / `SETRANGE` | Byte-level manipulation of the string without a full read-modify-write round trip. |
| `GETBIT` / `SETBIT` / `BITCOUNT` / `BITOP` | Treat the same String as a bit array for bitmap-style problems. |

The atomicity of `INCR` is the detail that makes counters safe without any application-level locking: "These commands are atomic, which means that they increment/decrement and return the new value as a single operation. It is not possible for two different clients to execute the same command at the same time and get the same result — no race conditions happen with those commands." *Redis Essentials* traces the mechanism to Redis's execution model: "Redis is single threaded, which means that it always executes one command at a time... a race condition will never happen when multiple clients try to perform operations on the same key at the same time." Two concurrent `INCR`s on a counter starting at 1 deterministically produce 2 and 3, never a lost update.

### Lists: linked lists with atomic push/pop

*Redis in Action* calls out what makes Redis unusual among key-value stores: "In the world of key-value stores, Redis is unique in that it supports a linked-list structure." *Redis Essentials* names three shapes a List can play: "Lists are a very flexible data type in Redis because they can act like a simple collection, stack, or queue." That flexibility comes from where a List lets you touch it — both ends, in constant time: "Redis's Lists are linked lists, therefore insertions and deletions from the beginning or the end of a List run in O(1), constant time. The task of accessing an element in a List runs in O(N), linear time, but accessing the first or last element always runs in constant time." A List is not a good fit for "give me item #500,000" — it is an excellent fit for "give me the newest item" or "give me the oldest item."

The core commands:

| Command | What it does |
|---|---|
| `LPUSH` / `RPUSH` | Push value(s) onto the left (head) or right (tail) end. `LPUSH` "inserts data at the beginning of a List (left push)," `RPUSH` "at the end (right push)." |
| `LPOP` / `RPOP` | Remove and return the leftmost or rightmost element — the operations that actually modify the list, unlike `LINDEX`. |
| `LRANGE` | "Returns an array with all elements from a given index range, including the elements in both the start and end indices," zero-based, negative indices counting from the tail (`-1` is the last element). |
| `LINDEX` | Fetch one element at a given position without modifying the list — O(N) to walk to that offset. |
| `LTRIM` | Trims the list down to only the elements between two indices, discarding the rest — the building block for a bounded "most recent N" list. |
| `BLPOP` / `BRPOP` | Blocking pop: "when a client executes a blocking command in an empty List, the client will wait for a new item to be added." |
| `RPOPLPUSH` / `BRPOPLPUSH` | Atomically pop from one list and push onto another in a single step — "it does a RPOP in a queue, then does a LPUSH in a different queue, and finally returns the element, all in a single step." |

The queue pattern is worth naming explicitly because it recurs everywhere Lists are used for work distribution: push with `LPUSH`, block-pop with `BRPOP`, and you have FIFO ordering — "items are inserted at the front of the queue and removed from the end of the queue... FIFO (First In, First Out) — we went from left to right." *Redis Essentials* builds exactly this as a small `Queue` class around `LLEN`/`LPUSH`/`BRPOP`, and flags its own limitation: a bare `BRPOP` consumer "is not reliable enough to deploy to production... if anything goes wrong with the callbacks that pop from the queue, items may be popped but not properly handled." The fix it points to is `RPOPLPUSH` into a second "processing" list you only remove from once work actually completes — a pattern later formalized as the reliable-queue idiom (and eventually superseded by Streams, outside the scope of this concept).

### Hashes: field-value maps

A Hash is where the "one key, several related fields" shape actually gets a first-class structure instead of a naming convention. *Redis in Action* draws the contrast directly: "Whereas LISTs and SETs in Redis hold sequences of items, Redis HASHes store a mapping of keys to values." *Redis Essentials* is precise about the types involved: "In a Hash, both the field name and the value are Strings. Therefore, a Hash is a mapping of a String to a String." Both books use the same before/after example to motivate reaching for a Hash: instead of two separate String keys (`article:<id>:headline`, `article:<id>:votes`) you get one Hash key (`article:<id>`) with two fields — "It is more semantic to use a Hash in that case because the two fields belong to the same object."

The core commands:

| Command | What it does |
|---|---|
| `HSET` / `HMSET` | Set one field, or several at once. "Both HSET and HMSET create a field if it does not exist, or overwrite its value if it already exists." |
| `HGET` / `HMGET` | Fetch one field, or several at once, by name. |
| `HGETALL` | "Fetches the entire hash" — every field/value pair as one array/dict. |
| `HDEL` | Remove a field — "returns whether the item was there before we tried to remove it." |
| `HKEYS` / `HVALS` | Fetch only the field names or only the values, useful "when you expect your values to be large" and don't want `HGETALL`'s full payload. |
| `HEXISTS` / `HLEN` | Check whether a field exists, or count how many fields a Hash has, without transferring any values. |
| `HINCRBY` / `HINCRBYFLOAT` | `INCR`/`INCRBY`'s Hash-field equivalent — "There is no HDECRBY command in Hash. The only way to decrement a Hash field is by using HINCRBY and a negative number." |
| `HSCAN` | Iterate a Hash's fields in cursor-based chunks instead of pulling everything with `HGETALL` — the documented fix for "a Hash [that] has many fields and uses a lot of memory," where `HGETALL` "may slow down Redis because it needs to transfer all of that data through the network." |

*Redis in Action* extends the analogy for readers coming from other databases: "we can consider a Redis HASH as being similar to a document in a document store, or a row in a relational database, in that we can access or change individual or multiple fields at a time." That is the practical reason to prefer a Hash over N separate String keys for the same logical object — one key to expire, one key to delete, one key whose fields you can update independently without ever touching the others.

### Choosing between them

The three types answer different questions about the same piece of data:

- **Is this one value, or a value with sub-parts I need atomic operations on individually?** A page-view counter is one value → String + `INCR`. A movie's title/year/rating/watcher-count are four related sub-parts of one object → Hash, so `HINCRBY` can bump `watchers` without touching `title`.
- **Does order matter, and do I only ever touch the ends?** A queue, a stack, or a "most recent N" feed → List, because push/pop at either end is O(1) and `LTRIM` bounds the size for free.
- **Am I about to store the same logical fields under many separate keys?** That is the Instagram signal — one String key per media ID cost 21 GB; collapsing related fields into Hashes cut it to roughly 5 GB. Whenever a naming convention like `entity:<id>:field1`, `entity:<id>:field2` shows up in String keys, that is usually a Hash trying to happen.

### Book vs today

> Both books describe a Hash's memory-optimized internal encoding as a **ziplist**: "Internally, a Hash can be a ziplist or a hash table... Although a ziplist has memory optimizations, lookups are not performed in constant time." That name is current only through Redis 6.2. **Redis 7.0 renamed the compact encoding from `ziplist` to `listpack`** for Hashes, Lists, and Sorted Sets alike — `OBJECT ENCODING` on a small Hash today reports `listpack`, not `ziplist`, and the tuning knobs the books mention as `hash-max-ziplist-entries`/`hash-max-ziplist-value` and `list-max-ziplist-size` are now `hash-max-listpack-entries`/`hash-max-listpack-value` and `list-max-listpack-size` (the old ziplist-named settings still work as aliases for backward compatibility). The mechanism the books describe — small collections stored compactly, promoted to a full hash table or linked structure once they cross a size threshold — is unchanged; only the name changed. Everything else in this concept — `SET`/`GET`/`INCR`, `LPUSH`/`RPUSH`/`LPOP`/`RPOP`/`LRANGE`, `HSET`/`HGET`/`HGETALL`, and their atomicity guarantees — is still exactly how current Redis behaves; this is one of the more durable corners of both books.

## Trade-offs

- **Strings are the most flexible type and the easiest to misuse as a substitute for structure.** A String can hold anything — but the moment you're storing `article:<id>:headline` and `article:<id>:votes` as two keys for one logical object, you've reinvented a Hash with worse ergonomics: two round trips to fetch both fields, two keys to expire in sync, and no way to update one field atomically relative to the other except via `INCR` tricks. The Instagram numbers in the Deep Dive aren't a corner case — per-key overhead on millions of small Strings is a real and sometimes dominant memory cost.
- **A List's O(1) guarantee only holds at the ends.** `LPUSH`/`RPUSH`/`LPOP`/`RPOP`/`BLPOP`/`BRPOP` are all O(1); `LINDEX` and any offset-based access are O(N), because it is a genuine linked structure, not an array. A List is the right tool for a queue or a bounded recent-items feed and the wrong tool for "give me element 40,000 of 100,000" — that access pattern wants a different structure (or a Sorted Set, which trades insertion cost for ordered range access by score).
- **Blocking pop commands (`BLPOP`/`BRPOP`) hold a client connection open while waiting.** That is the right behavior for a worker dedicated to consuming a queue, and the wrong behavior for a request-handling connection pool, where a stalled blocking call can quietly exhaust available connections under load.
- **A bare `LPUSH`/`BRPOP` queue is not delivery-safe on its own.** The book is explicit about this: an item can be popped by `BRPOP` and then lost if the consumer crashes or its callback throws before finishing the work. `RPOPLPUSH`/`BRPOPLPUSH` into a processing list is the mitigation the book shows — atomic pop-and-park so a crashed consumer's items are still findable — but it still requires the consumer to explicitly remove from the processing list on success; nothing does that automatically.
- **`HGETALL` on a large Hash is a bandwidth and latency risk, not just a style choice.** Every field and value crosses the network in one reply. `HSCAN`'s cursor-based iteration, or `HKEYS` followed by targeted `HGET`/`HMGET` calls, trade one round trip for several, but avoid blocking Redis's single command-processing thread on transferring a large payload and avoid pulling data the caller may not need yet.
- **`HINCRBY`'s missing `HDECRBY` is a real (if minor) API asymmetry.** There is no dedicated decrement command for Hash fields — `HINCRBY key field -N` is the only way — which is easy to get wrong once (a positive amount where a negative one was intended) compared to Strings, which do get dedicated `DECR`/`DECRBY` commands.
- **Choosing a type is a per-key design decision made once, and it's expensive to change later.** Unlike a relational column type, a Redis key's type is fixed by whichever write command created it — there's no in-place "convert this String into a Hash." Migrating from `article:<id>:votes` Strings to an `article:<id>` Hash later means a real data migration, not a schema alteration. The cost the book flags for choosing wrong is measured in gigabytes of RAM and an application rewrite, not query latency.

## Documentation Links

- [Carlos Da Silva, Marc Bächinger, "Redis Essentials" (Packt Publishing, 2015) — Chapter 1, "Getting Started" ("Redis data types": Strings, Lists, Hashes), p. 9-26](https://www.packtpub.com/en-us/product/redis-essentials-9781784392451) — doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013) — Section 1.2, "What Redis data structures look like", p. 7-15](https://www.manning.com/books/redis-in-action) — doc
- [Josiah L. Carlson, "Redis in Action" (Manning Publications, 2013) — Chapter 3, "Commands in Redis", Sections 3.1 Strings, 3.2 Lists, 3.4 Hashes, p. 40-51](https://www.manning.com/books/redis-in-action) — doc
- [Redis Documentation — Strings](https://redis.io/docs/latest/develop/data-types/strings/) — doc
- [Redis Documentation — Lists](https://redis.io/docs/latest/develop/data-types/lists/) — doc
- [Redis Documentation — Hashes](https://redis.io/docs/latest/develop/data-types/hashes/) — doc
- [Redis Documentation — OBJECT ENCODING (ziplist to listpack rename, Redis 7.0)](https://redis.io/docs/latest/commands/object-encoding/) — doc
- [Redis Documentation — SET / GET / INCR / INCRBY](https://redis.io/docs/latest/commands/set/) — doc
- [Redis Documentation — LPUSH / RPUSH / LPOP / RPOP / LRANGE](https://redis.io/docs/latest/commands/lrange/) — doc
- [Redis Documentation — HSET / HGET / HGETALL](https://redis.io/docs/latest/commands/hgetall/) — doc
