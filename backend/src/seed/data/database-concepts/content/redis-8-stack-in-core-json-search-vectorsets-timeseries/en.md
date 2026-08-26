---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what changed in **Redis 8** (GA May 2025): five things that used to be separate, separately-licensed Redis Stack modules — native **JSON**, full-text and vector **search** (the Redis Query Engine, formerly RediSearch), **Time Series**, and five **probabilistic data structures** beyond HyperLogLog — are now bundled directly into core "Redis Open Source," plus a genuinely new native data type, **Vector Sets**, that shipped for the first time in 8.0. This concept has no book source at all: the two books behind this batch's other Redis concepts (2013 and 2015) predate every one of these features by roughly a decade, and RediSearch, RedisJSON, and RedisTimeSeries didn't exist as products yet. Everything here is verified directly against current redis.io documentation rather than assumed from training knowledge, because the exact command surfaces and version numbers are recent enough (some as late as Redis 8.6 and 8.8) to be easy to get wrong.

## Use Cases

- **Session and profile data as a real document, not a serialized blob.** A user session with nested arrays and objects — cart items, preferences, recent actions — can live as one native JSON document with atomic sub-path updates, instead of a String key holding a JSON-encoded string that has to be fully read, deserialized, mutated, and rewritten on every change.
- **Product search without a bolted-on Elasticsearch cluster.** `FT.CREATE`/`FT.SEARCH` build a secondary index over Hash or JSON documents already living in Redis — full-text matching, tag filters, numeric ranges, geo radius, and highlighting — so "search" doesn't require syncing data into a second system.
- **RAG retrieval and semantic search over embeddings**, the same problem MongoDB addresses with `$vectorSearch`/Atlas Vector Search (covered in the sibling `mongodb-atlas-search-and-vector-search` concept) and Postgres addresses with `pgvector`. Redis 8 answers it two ways at once: a `VECTOR` field inside a Query Engine index (`FT.CREATE ... SCHEMA embedding VECTOR ...`), and the new standalone **Vector Sets** data type (`VADD`/`VSIM`) — the same underlying AI/RAG need, met by a different product's native answer, and in Redis's case by two different native answers within the same product.
- **Time-stamped metrics — IoT sensors, system telemetry, stock/FX ticks** — stored with automatic retention and downsampling instead of hand-rolled sorted sets of timestamp/value pairs. `TS.CREATERULE` keeps a pre-aggregated hourly or daily rollup in sync with raw data as it arrives.
- **"Have I seen this before" and "how many times" at a fixed memory cost**, beyond what HyperLogLog answers. A Bloom or Cuckoo filter answers "has this exact item appeared before" (duplicate model names, used discount codes, seen ad impressions); a Count-min sketch answers "roughly how many times has this item appeared"; Top-K answers "what are the K most frequent items right now" (trending hashtags, DDoS source IPs); t-digest answers "what fraction of values fall below X" (p50/p90/p99 latency dashboards) — five different questions HyperLogLog (which only answers "how many *distinct* things") cannot answer at all.

## Deep Dive

### Native JSON: a real document type, not a String holding text

Redis JSON is not a convention on top of the String type — it is its own reply/complexity profile with its own storage: "Documents stored as binary data in a tree structure, allowing fast access to sub-elements," with "full support for the JSON standard" and "typed atomic operations for all JSON value types." Values are addressed by **JSONPath** (`$` for root, `$.field`, `$[1].crashes`, `$..val` for recursive descent), not by re-sending the whole document.

The command surface is 26 commands wide and split by JSON value type:

| Group | Commands |
|---|---|
| Whole-document | `JSON.SET`, `JSON.GET`, `JSON.MGET`, `JSON.MSET`, `JSON.DEL`, `JSON.FORGET`, `JSON.TYPE`, `JSON.CLEAR`, `JSON.MERGE` |
| Strings | `JSON.STRLEN`, `JSON.STRAPPEND` |
| Numbers | `JSON.NUMINCRBY`, `JSON.NUMMULTBY` |
| Arrays | `JSON.ARRAPPEND`, `JSON.ARRINDEX`, `JSON.ARRINSERT`, `JSON.ARRLEN`, `JSON.ARRPOP`, `JSON.ARRTRIM` |
| Objects | `JSON.OBJKEYS`, `JSON.OBJLEN` |
| Booleans / misc | `JSON.TOGGLE`, `JSON.RESP`, `JSON.DEBUG` |

That is the concrete difference from "just storing a JSON string in a regular String key." With a String, incrementing a nested counter means `GET`, parse client-side, mutate, serialize, `SET` the entire blob back — not atomic, and a second writer racing the same read-modify-write silently loses an update. With native JSON, `JSON.NUMINCRBY crashes $ 1` mutates one path in place, atomically, without ever transferring the rest of the document:

```
> JSON.SET crashes $ 0
OK
> JSON.NUMINCRBY crashes $ 1
"[1]"
> JSON.NUMINCRBY crashes $ 1.5
"[2.5]"
```

Array surgery works the same way — `JSON.ARRINSERT riders $ 1 '"Prickett"' '"Royce"'` splices into an array at an index, and `JSON.ARRTRIM`/`JSON.ARRPOP` remove without ever fetching the array back to the client first. And critically for the search half of this concept: "Redis JSON also works seamlessly with Redis Search to let you index and query JSON documents" — a `FT.CREATE ... ON JSON` index can target a JSONPath expression directly, something a String-typed JSON blob cannot offer at all, because there is nothing inside a String for a secondary index to address.

One recent, narrow addition worth flagging precisely because it's easy to get the version wrong: "Beginning with Redis 8.8, the JSON data type supports the ability to force a particular type when storing floating point homogeneous arrays (FPHAs) using the `FPHA BF16|FP16|FP32|FP64` option to the `JSON.SET` command" — a storage-format control aimed squarely at embedding arrays, tying this feature back to the vector/AI use cases below.

### Full-text and secondary search: `FT.CREATE` / `FT.SEARCH`, now called the Redis Query Engine

RediSearch is the module; **Redis Query Engine** is the current product name for what it does, and the rename matters for anyone reading older material: "With Redis 8 you can create a secondary index of data that resides in hashes and JSON data structures. Some of the most common ways to use the Redis Query Engine include for vector search, data queries that return exact matches by a criteria or tag, and search queries that return the best matches by keywords or semantic meaning."

`FT.CREATE` declares an index over existing Hash or JSON keys — it does not create a new document store, it indexes what's already there:

```
FT.CREATE index [ON HASH|JSON] [PREFIX count prefix ...]
  SCHEMA field_name [AS alias] <TEXT|TAG|NUMERIC|GEO|GEOSHAPE|VECTOR> [options...]
```

Field types map directly to query capability: `TEXT` for full-text (with per-field `WEIGHT`, `NOSTEM`, `PHONETIC` matching, and suffix-trie support for `*foo*` queries), `TAG` for exact-match categorical values (comma-separated by default, `CASESENSITIVE` optional), `NUMERIC` for range queries, `GEO`/`GEOSHAPE` for radius and polygon queries, and `VECTOR` for similarity search embedded inside an otherwise-ordinary index. For JSON, the identifier is a JSONPath expression rather than a flat field name — `FT.CREATE idx ON JSON SCHEMA $.title AS title TEXT $.categories AS categories TAG` indexes straight into nested structure.

`FT.SEARCH` is the read side, and its option surface is large: `NOCONTENT` to return only IDs, `WITHSCORES`/`EXPLAINSCORE` for relevance debugging, `HIGHLIGHT`/`SUMMARIZE` for marking up matched text, `SORTBY`, `LIMIT`, `RETURN` to project specific fields (or JSON paths, aliased with `AS`), and `SLOP`/`INORDER` for proximity-sensitive phrase queries. A representative query:

```
FT.SEARCH books-idx "@title:space @categories:{science}" LIMIT 0 10 RETURN 2 title price
```

Vector similarity search rides inside the *same* command as a `KNN` clause rather than a separate stage:

```
FT.SEARCH books-idx "*=>[KNN 10 @title_embedding $query_vec AS title_score]"
  PARAMS 2 query_vec <embedding-blob> SORTBY title_score DIALECT 2
```

This is one of two distinct vector-search paths Redis 8 now ships — the other is Vector Sets, covered next — and the difference is architectural: a `VECTOR` field lives inside a Query Engine index alongside `TEXT`/`TAG`/`NUMERIC` fields on the same Hash or JSON documents, so a single query can combine lexical filtering and vector similarity in one pass. `FT.SEARCH` complexity is documented as "O(n) for single word queries," where `n` is the result-set size — finding matching term postings is O(1), but loading and returning the matched documents scans them.

### Vector Sets: a new native data type, not a field inside another index

Vector Sets are Redis 8's second, independent answer to vector similarity, and they are a genuinely new primitive rather than a repackaging of the Query Engine's `VECTOR` field type: "Vector sets are a data type similar to sorted sets, but instead of a score, vector set elements have a string representation of a vector." The `TYPE` command returns `vectorset` for these keys, confirming first-class data-type status alongside String, Hash, Set, Sorted Set, and the rest. Per Redis's own announcement, it was "developed by Salvatore Sanfilippo, the original creator of Redis," takes "inspiration from sorted set," and "complements the existing vector search capability in the Redis Query Engine" rather than replacing it — and it shipped explicitly as **beta**: "We may change, or even break, the features and the API in future versions."

The command surface, all introduced at 8.0.0 unless noted:

| Command | Does |
|---|---|
| `VADD key [REDUCE dim] VALUES num val [val...] element` (or `FP32` blob) | Adds/updates an element's vector |
| `VSIM key (ELE element \| VALUES num val...) [WITHSCORES] [COUNT n] [FILTER expr]` | Similarity search, by element or by raw vector |
| `VREM` / `VCARD` / `VDIM` | Remove an element / count elements / read vector dimensionality |
| `VEMB key element` | Return the (quantized) stored vector for an element |
| `VSETATTR` / `VGETATTR` | Attach or read a JSON attribute blob per element, for filtering |
| `VLINKS` | Return an element's neighbors at each layer of the HNSW graph |
| `VINFO` | Metadata about the set |
| `VISMEMBER` (8.2.0), `VRANGE` (8.4.0) | Membership check; lexicographic-range read |

The indexing algorithm is HNSW, confirmed directly by `VLINKS`'s own description ("neighbors of an element at each layer in the HNSW graph") and by debug commands like `DEBUG DUMP_HNSW`. Quantization is on by default for storage efficiency, and it is lossy in a way the docs are explicit about: adding `VALUES 2 1.0 1.0` and reading it back with `VEMB` returns `0.9999999403953552, 0.9999999403953552` — "the values will not typically be the exact values you supplied... because quantization is applied to improve performance." Filtered similarity search works by attaching a JSON attribute blob to elements and expressing a predicate at query time: `VSIM points ELE pt:A FILTER '.size == "large" && .price > 20.00'`.

Set against the MongoDB sibling concept, the contrast is structural, not just cosmetic. MongoDB's Atlas/MongoDB Vector Search runs `mongot`, a **separate Apache Lucene process** synced from `mongod` via change streams, with its own storage, its own memory budget, and eventually-consistent indexing. Redis's Vector Set is an **in-core native data type** — no second process, no separate storage tier, no sync lag, updated and queried in the same request path as every other Redis command. That buys immediacy at the cost of Redis's usual constraint: everything lives in the same process's memory as the rest of the dataset, with no dedicated-node isolation option the way MongoDB's dedicated search nodes provide.

### Time Series: `TS.*` for timestamped numeric data

"The Redis time series data type lets you store real-valued data points along with the time they were collected. You can combine the values from a selection of time series and query them by time or value range. You can also compute aggregators of the data over periods of time and create new time series from the results." Seventeen `TS.*` commands split cleanly into write, read, and rollup management:

| Group | Commands |
|---|---|
| Write | `TS.CREATE`, `TS.ADD`, `TS.MADD`, `TS.INCRBY`, `TS.DECRBY`, `TS.ALTER`, `TS.DEL` |
| Read | `TS.GET`, `TS.RANGE`, `TS.REVRANGE`, `TS.MGET`, `TS.MRANGE`, `TS.MREVRANGE`, `TS.QUERYINDEX`, `TS.INFO` |
| Rollups | `TS.CREATERULE`, `TS.DELETERULE` |

Retention is a per-series setting evaluated relative to the newest sample: "you can specify a maximum retention period for the data, relative to the last reported timestamp. A retention period of zero means the data does not expire" — set via `TS.ADD key ts value RETENTION 100` (milliseconds) or `TS.CREATE`. **Labels** are name/value string pairs used purely for selection and grouping across series: `TS.ADD thermometer:3 1 10.4 LABELS location UK type Mercury`, then `TS.MGET FILTER location=us` reads the latest sample from every series tagged that way without naming each key individually.

Downsampling happens two ways. Ad hoc, `TS.RANGE key from to AGGREGATION avg bucketDuration` buckets a query result on the fly, with aggregators `avg`, `sum`, `min`, `max`, `range`, `count`, `first`, `last`, `std.p`, `std.s`, `var.p`, `var.s`, `twa` (time-weighted average), plus `countNaN` and `countAll` added in Redis 8.6. Standing, `TS.CREATERULE sourceKey destKey AGGREGATION aggregator bucketDuration` keeps a downsampled series continuously in sync: "compaction rules process data incrementally, computing aggregates for completed buckets when new data arrives" — so a raw high-frequency series and an hourly rollup stay consistent without an external cron job. NaN handling is itself a version-sensitive detail: "Starting from Redis 8.6, time series support NaN... values, which allow you to represent missing or invalid measurements," and from that version on, "all existing aggregators ignore NaN values when computing results" — a behavior change that did not exist in 8.0 through 8.5.

### Probabilistic structures beyond HyperLogLog

The sibling `redis-advanced-data-types-sets-sortedsets-bitmaps-hyperloglog` concept already covers HyperLogLog's cardinality-estimation trade (fixed ~12 KB, ~0.81% error, no membership recall) and flags that Redis 8.0 added five more probabilistic structures as former RedisBloom-module content folded into core. This concept goes one level deeper on what each one actually does and its real command surface, because "probabilistic" covers five genuinely different questions:

**Bloom filter** — "has this exact item appeared before," with false positives possible but false negatives impossible: "A Bloom filter can guarantee the absence of an item from a set, but it can only give an estimation about its presence." Sizing is explicit at creation: `BF.RESERVE key error_rate capacity [EXPANSION n] [NONSCALING]`. A 0.1% error rate costs 14.378 bits/item — against roughly 320 bits/item for the equivalent Redis Set of IP addresses. Core commands: `BF.ADD`, `BF.MADD`, `BF.EXISTS`, `BF.MEXISTS`, `BF.INSERT`, `BF.CARD`, `BF.INFO`, plus `BF.SCANDUMP`/`BF.LOADCHUNK` for incremental backup. **No deletion is possible** — a Bloom filter can only grow.

**Cuckoo filter** — the same membership question, answered differently: buckets of item fingerprints rather than a flipped-bit array, found via `CF.RESERVE key capacity [BUCKETSIZE n] [MAXITERATIONS n] [EXPANSION n]`, then `CF.ADD`/`CF.EXISTS`/`CF.DEL`/`CF.COUNT`/`CF.INSERT`. The one capability Bloom filters categorically lack: "Cuckoo filters are quicker on check operations and also allow deletions" — `CF.DEL` genuinely removes an item, which is why a "has this coupon been redeemed" workflow (add on issue, delete on redemption) needs Cuckoo, not Bloom.

**Count-min sketch** — not membership but frequency: "estimate the frequency of events/elements in a stream of data," sized via `CMS.INITBYDIM key width depth` or `CMS.INITBYPROB key error probability`, then updated with `CMS.INCRBY` and read with `CMS.QUERY`. The documented catch is sharp: results are only trustworthy above a computed `threshold = error * total_count` — "results... lower than a certain threshold... should be ignored and often even approximated to zero" — making CMS a tool for finding heavy hitters, not for accurate low counts.

**Top-K** — "the `K` highest-rank elements from a stream," built on the HeavyKeepers algorithm (a hash table of counts plus a min-heap of the current top K), via `TOPK.RESERVE key k [width depth decay]`, then `TOPK.ADD`/`TOPK.QUERY`/`TOPK.LIST`/`TOPK.COUNT`. `TOPK.ADD` returns the item evicted from the list when a new item displaces it — a live "who just fell out of trending" signal a Sorted Set can't give for free.

**t-digest** — percentiles and quantiles over a stream without storing every observation: "Which fraction of the values in the data stream are smaller/larger than a given value?" Built with `TDIGEST.CREATE key [COMPRESSION c]` (higher compression = more accuracy, more memory), fed with `TDIGEST.ADD`, and queried from either direction — `TDIGEST.QUANTILE key .5` returns the value at the 50th percentile, `TDIGEST.CDF key 50` returns what fraction of observations fall below 50, `TDIGEST.RANK`/`TDIGEST.BYRANK` convert between a value and its position, and `TDIGEST.TRIMMED_MEAN` returns a mean excluding outlier tails — the textbook tool for a p50/p90/p99 latency dashboard that can't afford to sort every sample.

### "One Redis": the licensing and bundling history

This is worth stating plainly because it is a real, verifiable history, not incidental trivia. RediSearch, RedisJSON, RedisTimeSeries, and RedisBloom began as independent modules, each versioned separately from Redis core and from each other — enough of a "matching the right module version to the Redis version" headache that Redis Inc. bundled them into a single **Redis Stack** distribution. Redis Stack, and — after March 2024 — Redis core itself, shipped under the **Redis Source Available License (RSALv2)** and the **Server Side Public License (SSPLv1)**, a dual-license move away from Redis's original BSD license that was "widely panned by the open-source community" and directly triggered the Linux Foundation-backed Valkey fork (and Redict) as BSD-licensed continuations.

Redis 8.0 (May 2025) changed two things at once, and the connection between them is real: "Today, we're combining our Redis Stack and community offerings into a single Redis Open Source distribution. All the modules are already included in this package" — and simultaneously, "Redis 8 is available in Redis Open Source under the open source AGPLv3 license in addition to the dual RSALv2 and SSPLv1 licenses we moved to last year. We heard from some customers that it is easier for them to operate under an OSI-approved license, so we've added that option." Salvatore Sanfilippo (antirez), the original Redis author, rejoined Redis Inc. in November 2024 and is credited with pushing for the AGPLv3 option. The practical result for this concept: JSON, the Query Engine, Time Series, and the probabilistic types are no longer separate paid-adjacent modules with their own release cadence — they ship in every Redis Open Source binary, under a choice of three licenses (RSALv2, SSPLv1, or AGPLv3), for free.

## Trade-offs

- **Vector Sets are explicitly beta.** Redis's own release language is unambiguous: "We may change, or even break, the features and the API in future versions." Building a production RAG pipeline on `VADD`/`VSIM` today means accepting that command syntax, default behavior, or even the data format could shift in a later 8.x release — a materially different risk posture than the `VECTOR` field type inside `FT.CREATE`, which builds on RediSearch's long-stable indexing code.
- **Redis 8 now ships two unrelated ways to do vector search, and picking wrong costs a redesign.** A `VECTOR` field inside a Query Engine index lets one query combine lexical/tag/numeric filtering with similarity search over Hash or JSON documents already carrying other indexed fields. A Vector Set is a standalone data type with its own key, its own `FILTER` mini-language over attached JSON attributes, and no ability to join against a `TEXT` or `TAG` field the way a Query Engine index can. Choosing the wrong one early — Vector Set for a workload that actually needed hybrid lexical+semantic search, or a Query Engine `VECTOR` field for what was really a simple, standalone embedding store — means migrating data types, not just tuning a query.
- **Version fragmentation inside "Redis 8" is real and easy to miss.** Several features referenced above did not ship simultaneously with 8.0.0: `VISMEMBER` (8.2.0), `VRANGE` (8.4.0), time-series NaN support and the `countNaN`/`countAll` aggregators (8.6), and the JSON `FPHA` option (8.8) all landed in later 8.x point releases. "Redis 8" in a blog post or a Docker tag is not a single, fixed feature set — the exact minor version in front of you determines what's actually callable.
- **In-core means no isolation, unlike MongoDB's dedicated search process.** Every feature here — JSON storage, Query Engine indexes, Vector Sets, time series, and every probabilistic sketch — lives inside the same Redis process and the same memory budget as ordinary keys. There is no `mongot`-style separate daemon to scale, secure, or restart independently, which removes an entire category of MongoDB's self-managed-search operational overhead (see the sibling concept's Trade-offs) — but it also means a runaway search index or an oversized vector set competes directly with cache and session data for the same RAM, with no dedicated-node option to move it out of the hot path.
- **Every probabilistic structure trades a specific kind of correctness away, permanently, and the five are not interchangeable.** Bloom filters can never delete; Cuckoo filters can, at a slightly higher per-item cost and a documented minimum ~0.78% false-positive floor even at the best bucket configuration. Count-min sketch results below a computed threshold must be discarded as noise — it is structurally unsuited to uniformly-distributed streams where no item is a clear "heavy hitter." Top-K's `HeavyKeepers` bias is deliberate: "biased against mouse (small) flows," so it is the wrong tool if small-but-real signals matter. t-digest trades exact ordering for a compact sketch of the distribution's shape, controlled by a single `COMPRESSION` value — too low, and both tails of a p99 latency estimate get less reliable. Reaching for "a probabilistic structure" without picking the one that matches the actual question is a modeling error just as concrete as the Set-vs-Bitmap-vs-HyperLogLog decision the sibling concept walks through.
- **The license bundle is friendlier, not simple.** Redis Open Source is now available under AGPLv3, an OSI-approved license — a real, verified improvement over RSAL/SSPL-only for anyone who needed that box checked. But it ships as one of *three* license options (RSALv2, SSPLv1, AGPLv3), and AGPLv3's network-copyleft terms carry their own obligations for anyone building a hosted service on top of Redis; picking "the free option" still means picking a specific license and understanding what it requires, not assuming Redis reverted to its original permissive BSD terms.
- **This is a broad, fast-moving surface — verify the exact command before shipping it.** Five feature areas, dozens of commands, several of them added in minor releases within the last year, is a lot to hold as settled knowledge. The specifics here — command names, "since" versions, default values like Bloom's `EXPANSION 2` or Cuckoo's minimum ~0.78% error floor — are exactly the kind of detail that goes stale fastest; treat this concept as a map of what exists and re-check the live docs before depending on a specific flag or default in production.

## Documentation Links

- [Redis Documentation — JSON](https://redis.io/docs/latest/develop/data-types/json/) — doc
- [Redis Documentation — Redis Query Engine (RediSearch)](https://redis.io/docs/latest/develop/ai/search-and-query/) — doc
- [Redis Documentation — FT.CREATE](https://redis.io/docs/latest/commands/ft.create/) — doc
- [Redis Documentation — FT.SEARCH](https://redis.io/docs/latest/commands/ft.search/) — doc
- [Redis Documentation — Vector sets](https://redis.io/docs/latest/develop/data-types/vector-sets/) — doc
- [Redis Documentation — Time series](https://redis.io/docs/latest/develop/data-types/timeseries/) — doc
- [Redis Documentation — Bloom filter](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/) — doc
- [Redis Documentation — Cuckoo filter](https://redis.io/docs/latest/develop/data-types/probabilistic/cuckoo-filter/) — doc
- [Redis Documentation — Count-min sketch](https://redis.io/docs/latest/develop/data-types/probabilistic/count-min-sketch/) — doc
- [Redis Documentation — Top-K](https://redis.io/docs/latest/develop/data-types/probabilistic/top-k/) — doc
- [Redis Documentation — t-digest](https://redis.io/docs/latest/develop/data-types/probabilistic/t-digest/) — doc
- [Redis Blog — Redis 8 is now GA, loaded with new features and more than 30 performance improvements](https://redis.io/blog/redis-8-ga/) — doc
- [Redis Blog — Redis is now available under the AGPLv3 open source license](https://redis.io/blog/agplv3/) — doc
- [Redis Open Source 8.0 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.0-release-notes/) — doc
