---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what MongoDB actually does when you pass `timeseries: { timeField, metaField, granularity }` to `createCollection` — it hands you a writable non-materialized view over an internal collection that packs many measurements into compressed, columnar buckets keyed by `metaField` plus a rounded time window — and know precisely which normal MongoDB behaviors you give up in exchange, because the list is long and specific.

This is a **MongoDB 5.0 feature (2021)**. The third-edition book that sources the rest of this MongoDB batch predates it entirely: its newest-version notes stop at MongoDB 4.2, so there is no "what the book said" to contrast here. Every claim below is checked against MongoDB's current manual, and the version-gated details matter more than usual — `bucketMaxSpanSeconds`/`bucketRoundingSeconds` arrived in 6.3, the automatic `metaField`+`timeField` index arrived in 6.3, `$out` into a time series collection arrived in 7.0, resharding arrived in 8.0.10, and 8.3 tightened the `_id` and `timeField` rules.

## Use Cases

- **IoT / sensor telemetry** — thousands of devices each emitting a reading on a fixed interval, where `metaField` is the device identity and the metrics are the readings. MongoDB's own use-case table lists exactly this: "Sensor data (for example, smart home devices or fleet logistics)."
- **Financial tick and market data** — the docs list "High frequency trading", "Financial quantitative analysis", and "Stock market data", and the manual's worked aggregation examples run over a `dowJonesTickerData` collection computing average close per month with `$dateTrunc` and a 30-day rolling average with `$setWindowFields`.
- **Infrastructure and application monitoring** — the docs' DevOps row is "Application logging; Infrastructure and network monitoring": high-volume append-only series where you almost never update a past point and almost always query a time window for one source.
- **Any workload where old data should just evaporate** — set `expireAfterSeconds` at creation (or via `collMod` later) and MongoDB drops whole buckets once every document in them has aged out, which is far cheaper than deleting individual documents from a regular collection.
- **Retail/inventory and price history** — "Transaction, sales, and price analysis; Inventory management," per the docs' table.
- **When *not* to reach for one**, stated outright by the manual: "Time series collections are not intended for the following types of data: Unordered data; Data that is not time-dependent." If updates to existing points are routine, or if there's no natural series identity, a regular collection is the right shape.

## Deep Dive

### The shape of the data, and the four names MongoDB uses

The manual decomposes time series data into four parts, and the parameter names follow directly from them:

- **Time** — "Indicates when the data point was recorded." This is the `timeField`, and its value "must be a valid BSON date."
- **Metadata** — "A label or tag that identifies a data series and rarely changes. Metadata is stored in a `metaField`. Metadata is also known as `source`."
- **Metrics** — "Individual data points tracked at increments in time... Metrics are also known as values."
- **Measurements** — "Documents that contain data for all metrics at a specific point in time. A measurement includes the time, metadata, and all metrics recorded at that moment."

So one inserted document is one measurement, and the docs are explicit about that on the insert page: "Each document you insert should contain a single measurement." You are *not* meant to hand-roll the bucket — that is the server's job, and it is the whole point of the feature.

### Declaring one

```js
db.createCollection(
  "weather",
  {
    timeseries: {
      timeField: "time",
      metaField: "sensor",
      granularity: "seconds"
    },
    expireAfterSeconds: 86400
  }
)
```

The field reference, verbatim on the essentials:

| Field | Required | What the manual says |
|---|---|---|
| `timeseries.timeField` | **Yes** | "The name of the field which contains the date in each time series document." Must be a BSON date. |
| `timeseries.metaField` | No | "The metadata in the specified field should be data that is used to label a unique series of documents. The metadata should rarely, if ever, change." May not be `_id` or the same as `timeField`; any data type. "If you do not provide a value for this field, the data is bucketed solely based on time." |
| `timeseries.granularity` | No | `seconds` (default), `minutes`, `hours`. "Set `granularity` to the value that most closely matches the time between consecutive incoming timestamps." |
| `timeseries.bucketMaxSpanSeconds` | No | "Sets the maximum time between timestamps in the same bucket. Possible values are 1-31536000." **New in 6.3.** |
| `timeseries.bucketRoundingSeconds` | No | "Must be equal to `bucketMaxSpanSeconds`. When a document requires a new bucket, MongoDB rounds down the document's timestamp value by this interval to set the minimum time for the bucket." **New in 6.3.** |
| `expireAfterSeconds` | No | TTL: "the number of seconds after which documents expire." |

The two bucketing styles are mutually exclusive — the manual calls them **manual bucketing** (`granularity`) and **interval bucketing** (`bucketMaxSpanSeconds` + `bucketRoundingSeconds`), and if you set one of the custom pair you must set the other to the same value. Creating a time series collection at all requires `featureCompatibilityVersion` 5.0 or greater.

`timeField` and `metaField` are frozen at creation. You cannot redefine which field is the `metaField` later ("if you create time series documents with the `metaField` defined as field `A`, you cannot later convert a field `B` to be the `metaField`" — though if `A` is an object you can add subfields to it), and you cannot convert a regular collection into a time series collection or vice versa. Getting this wrong means a data migration, not a `collMod`.

### What's actually on disk: buckets, not documents

"MongoDB treats time series collections as writable non-materialized **views** backed by an internal collection. When you insert data, the internal collection automatically organizes time series data into an optimized storage format." That storage format is columnar: "MongoDB uses a specialized columnar format that groups documents from each time series together."

Grouping happens on two conditions, both required:

- **An identical `metaField` value.** "If a `metaField` is an object or array, MongoDB groups only if all object fields or array elements match."
- **`timeField` values that are close together**, where "close" is defined by `granularity` or the custom bucketing parameters.

The manual's own example makes the rule concrete. With `granularity: "seconds"`, a bucket holding `sensorA` at `2024-08-01T18:23:21Z` covers `18:00:00Z` through `18:59:59Z`; another `sensorA` reading joins that bucket only if it falls inside that window, and "an incoming document with a `metaField` of `sensorB` goes into a separate bucket regardless of time." With interval bucketing at `bucketRoundingSeconds: 14400`, a document timestamped `2023-03-27T16:24:35Z` opens a bucket with minimum time `2023-03-27T16:00:00Z` and maximum `2023-03-27T19:59:59Z` — the timestamp rounded *down* to the interval.

Granularity is not a free knob. It maps to a hard bucket span:

| `granularity` | Maximum time interval in one bucket |
|---|---|
| `seconds` (default) | 1 hour |
| `minutes` | 24 hours |
| `hours` | 30 days |

And the guidance for picking it cuts both ways: "Setting the `granularity` to `hours` groups up to a month's worth of data ingest events into a single bucket, resulting in longer traversal times and slower queries. Setting it to `seconds` leads to multiple buckets per polling interval, many of which might contain only a single document." The docs suggest matching it to your query shape too — if you fetch a day at a time, `minutes` is right, because `seconds` needs many buckets per day and `hours` makes every query pull 30 days and discard most of it.

One-way ratchet: you can *increase* the time span a bucket covers via `collMod`, never decrease it. And the increase is prospective only — "This updates the collection's view definition, but doesn't change how data is stored across existing buckets."

### The bucket catalog and what closes a bucket

Open buckets live in "a specialized in-memory cache in WiredTiger" called the **bucket catalog**, which "tracks buckets to minimize latency and coordinate concurrent writes" and holds, per open bucket, the `metaField`, active writers, covered time span, document count, size, and recent operations. Because buckets are per-`metaField`, many are typically open at once.

MongoDB closes a bucket when any of these happen:

- An incoming timestamp falls outside the bucket's bounds (forward *or* backward).
- The bucket hits the document limit (**default 1000**).
- It exceeds its storage size limit — size over the allowed maximum (**default 125 KiB**); or fewer than a minimum number of documents (**default 10**) with size under 12 MiB, "a set, internal limit that optimizes performance when data consists of fewer, larger documents"; or the set of active buckets no longer fits the storage engine cache size.
- The bucket catalog exceeds its total memory allocation — "by default, 2.5% of available system memory."
- A conflicting operation such as a chunk migration or an update changes a bucket's on-disk state.
- `mongod` restarts, which "closes all buckets and resets the bucket catalog."

The limitations page states the ceiling independent of configuration: "For any configuration of granularity parameters, the maximum size of a bucket is 1000 measurements or 125KB of data, whichever is lower. MongoDB may also enforce a lower maximum size for high cardinality data with many unique values, so that the working set of buckets fits within the WiredTiger cache."

### Why `metaField` choice is the whole ballgame

Because grouping requires exact `metaField` equality, **the number of buckets tracks the number of distinct `metaField` values**. The docs are blunt about the failure mode: "Collections with fine-grained or dynamic `metaField` values may generate more, sparsely packed, short-lived buckets... Fine-grained and dynamic `metaField` values typically decrease storage and query efficiency." Put a timestamp, a request id, or a rapidly-changing reading inside the `metaField` and you have built a collection of one-document buckets — all the restrictions, none of the compression.

The stated best practices: pick fields that rarely or never change; prefer identifiers and other stable values that appear in filter expressions; and "avoid selecting fields that are not used for filtering as part of your metaField. Instead, use those fields as measurements." Arrays are called out as risky — "using an array as a `metaField` may cause unexpected collection behavior because array equality depends on specific order."

There's a subtle query consequence of the internal representation: "MongoDB reorders the `metaField` of time-series collections, which may cause servers to store data in a different field order than applications." So when `metaField` is an object, query its **scalar sub-fields** (`{"metaField.sensorId": 5578, "metaField.type": "temperature"}`) rather than matching the whole object, which "may produce inconsistent results."

### Indexes and queries

Querying is deliberately unremarkable: "You query a time series collection the same way you query a standard MongoDB collection" — `find`, `findOne`, `aggregate`, all normal. Indexing is where the differences show.

- **Automatic index**: "Starting in MongoDB 6.3: if you create a new time series collection, MongoDB also generates a compound index on the metaField and timeField fields," and it "also uses the optimized storage format."
- **No `_id` index**: "MongoDB does not create an index on the `_id` field when you create a time series collection. This differs from regular collections." Consequently "documents do not require a unique `_id` field." A `hint` on `_id` errors unless you build that index yourself, and starting in **8.3** creating an index named `"_id_"` or hinting `"_id_"` returns an error outright.
- **Partially supported types**: multikey, 2d, and sparse indexes are allowed **only on the `metaField`**.
- **Unsupported types**: text indexes and **unique indexes**. There is no way to enforce uniqueness in a time series collection.
- **Extended dates**: if timestamps fall before `1970-01-01T00:00:00.000Z` or after `2038-01-19T03:14:07.000Z`, "create an index on the `timeField` to optimize queries."

Index strategy per the docs: "Use the metaField index for filtering and equality. Use the timeField and other indexed fields for range queries." Which is the ESR ordering from the indexing concept, specialized to this shape — equality on the series identity, range on time.

For analysis, the manual highlights `$dateAdd`, `$dateDiff`, `$dateTrunc`, and `$setWindowFields` as the operators "often used to analyze time series data" — window functions and date truncation are the real analytical surface, not new time-series-specific query syntax.

Two query-side gotchas. `distinct` is out: "Due to the unique data structure of time series collections, MongoDB can't efficiently index them for distinct values. Avoid using the `distinct` command"; use a `$group` aggregation instead. And geospatial support is narrow: only the `$geoNear` aggregation stage against 2dsphere indexes, no `$near`/`$nearSphere`, no `query` field on `$geoNear`, and `key` is mandatory.

### Writes: inserts are the happy path, updates are not

Insert best practices follow from the bucket model. Use one `insertMany()` rather than many `insertOne()` calls; "if possible, insert data that contains identical `metaField` values in the same batches"; and set `ordered: false`. The payoff the docs describe: a six-document batch sorted by sensor across two sensors "only incurs the cost of two inserts (one per `metaField` value), because the documents are ordered by sensor."

Compression is sensitive to document shape, in ways that would not matter at all in a regular collection:

- **Consistent field order** improves insert and compression performance, and "compression requires consistent nested field order." Two documents with the same fields in different order do not compress as well.
- **Omit empty objects, arrays, and strings.** A `coordinates: []` between two populated `coordinates` arrays "result[s] in a schema change for the compressor. The schema change causes the second and third documents in the sequence to remain uncompressed." Leaving the field out entirely avoids that.
- **Round numeric data** to the precision the application needs — "Rounding numeric data to fewer decimal places improves the compression ratio."
- Nested fields are fine: "MongoDB uses column compression on each nested field individually, which provides the same compression quality as flattening the fields to the top level." Flatten only if high cardinality makes it measurably necessary.

Updates are the sharp edge. The limitations page requires every update command to satisfy *all* of:

- "You can only match on the `metaField` field value."
- "You can only modify the `metaField` field value."
- "Your update document can only contain update operator expressions."
- It "must not limit the number of documents to be updated. Set `multi: true` or use the `updateMany()` method."
- It "must not set `upsert: true`."

In other words a recorded measurement is effectively immutable — you can relabel a series, not correct a reading. The manual's warning on the overview page says the same thing more plainly: "Match expressions in update commands can only specify the metaField. You can't update other fields in a time series document."

Deletes exist but are not the intended retention mechanism. The bucketing page lists two ways a bucket is deleted: TTL expiry, and "a `delete` or `db.collection.deleteMany()` command deletes the last document in the bucket." For aging out history the docs point you at TTL: "To automatically delete old data, set up automatic removal (TTL)."

And you cannot write to a time series collection inside a transaction at all — "MongoDB supports reads from time series collections in transactions," writes are out.

### TTL semantics differ from a normal TTL index

`expireAfterSeconds` is set on the collection, not via a TTL index, and the threshold is "the `timeField` field value plus the specified number of seconds." Change it or turn it off with `collMod` (`expireAfterSeconds: "off"`). The timing is coarser than most people expect, and the docs say why: removal is per-bucket, so "once all documents in a bucket are expired, the background task that removes expired buckets removes the bucket during the next run," and "the background task that removes expired buckets runs every 60 seconds." With `granularity: "hours"` a bucket can span 30 days, so the newest measurement in a bucket gates the removal of every older measurement in it. "Expired data may exist for some time beyond the 60 second period."

### The full list of things that don't work

Straight from the limitations page — MongoDB does not support these with time series collections:

MongoDB Search (Atlas Search) · change streams · Client-Side Field Level Encryption · Atlas database triggers · schema validation rules · `reIndex` · `renameCollection`. Because change streams are unsupported, a time series collection also cannot be a source for Atlas Stream Processing.

Add to that: `$merge` cannot write *into* a time series collection (use `$out`, supported for this since **7.0**; `$merge` can move data *out* of one), maximum document size is **4 MB** rather than 16 MB, they cannot be capped, and they inherit the general limitations of views since they *are* views.

Sharding has its own set: shard keys may contain only the `metaField`, its sub-fields, and the `timeField` — "No other fields, including `_id`, are allowed in the shard key pattern." `timeField` must be ranged and last, and using it alone is warned against because it "increases monotonically" and lands all writes on one chunk. Starting in **8.0**, shard keys containing the `timeField` are *deprecated* and the server logs a warning every 12 hours telling you to reshard on the `metaField`. Resharding a time series collection became possible in **8.0.10** (all shards must be 8.0.10+). Zone sharding is not supported: "The balancer always distributes data in sharded time series collections evenly across all shards." You also "cannot run sharding administration commands on sharded time series collections."

Finally, adopting the feature is a one-way door across a downgrade boundary: "You must drop time series collections before downgrading: MongoDB 6.0 or later to MongoDB 5.0.7 or earlier; MongoDB 5.3 to MongoDB 5.0.5 or earlier."

### Versus a dedicated time-series database

Worth stating plainly: **MongoDB's manual never compares time series collections to InfluxDB, TimescaleDB, or any other dedicated TSDB.** There is no benchmark, no positioning claim, and no compression ratio anywhere in the documentation — the benefits are listed qualitatively ("Reduced storage and index sizes; Improved query efficiency; Reduced I/O for read operations; Increased usage of the WiredTiger in-memory cache; Reduced complexity"). So any competitive verdict is an inference from the documented capability surface, not a quote. From that surface:

What the feature genuinely delivers is the *storage-engine* half of a TSDB — columnar, time-ordered, per-series buckets with compression, plus TTL retention, plus window functions via `$setWindowFields` — inside a general-purpose database you may already be running, with the same drivers, the same aggregation framework, and no second system to operate or ETL pipeline to keep in sync. For an application whose telemetry is one workload among many, that is a real and often decisive advantage.

What it does not deliver, judging by what the docs *don't* document, is the operational tooling a mature TSDB is largely made of: there is no continuous-aggregate or automatic-downsampling feature (rolling raw data up into hourly summaries is a pipeline you write and schedule yourself, landing results via `$out`), no tiered-retention policy beyond a single `expireAfterSeconds`, no time-series-native query language, no streaming path out of the collection (change streams are unsupported), and no uniqueness or schema-validation guardrails at all. The honest read is the second option in the question: **a strong "good enough, and better than a regular collection" choice if you're already on MongoDB — not a reason to migrate onto MongoDB from a dedicated TSDB.**

## Trade-offs

- **The compression and query wins are real, but the documentation quantifies none of them.** The manual's mechanism is credible and specific — one bucket per (series, time window) instead of one document per reading, columnar per-field compression, buckets small enough (≤1000 measurements / ≤125 KB) to stay cache-resident — and its comparison to a regular collection is concrete: a regular collection needs an index entry per data point plus a second index on identifier-and-time, "and to read this data, MongoDB has to process all of the database and disk blocks that contain it, even if a block only contains a single relevant document." But every stated benefit is a direction, not a number. Budget for measuring your own workload rather than quoting a ratio.
- **Measurements are effectively immutable, by design and by restriction.** Updates can match and modify *only* the `metaField`, must be `multi`, cannot upsert, and cannot run in a transaction. That is a clean fit for the property the docs assume ("Update operations are rare, since each document represents a single point in time") and a hard blocker if your pipeline ever backfills corrections into recorded points. Combined with the absence of unique indexes, deduplicating a double-delivered reading is your application's problem, not the database's.
- **`metaField` cardinality is the single dominant design decision, and it is unfixable later.** Buckets exist per distinct `metaField` value, so a churning or over-specific `metaField` produces "many sparsely packed, short-lived buckets" — you keep the entire restriction list and lose the compression that justified it. And since the `metaField` cannot be redefined after creation, getting it wrong means migrating the data, not running `collMod`.
- **Granularity is a one-way ratchet with a real cost on both ends.** Too coarse and queries traverse up to a month of data per bucket (with `hours`) to answer a one-day question; too fine and you get many near-empty buckets per polling interval. You may only ever increase the span, the increase doesn't rewrite existing buckets, and `bucketMaxSpanSeconds`/`bucketRoundingSeconds` — the precise version of this knob — only exist from 6.3.
- **TTL is coarse-grained in a way a per-document TTL index is not.** Deletion happens per bucket, only after *every* document in the bucket has expired, checked by a task that runs every 60 seconds and may lag under load. With coarse granularity the newest measurement in a bucket pins all the older ones. Good enough for "keep roughly 30 days"; not a mechanism for precise data-deletion deadlines.
- **You give up a specific and load-bearing list of platform features.** No change streams (so no CDC, no Atlas Stream Processing source, no reactive pipeline off the collection), no Atlas Search, no CSFLE, no database triggers, no schema validation, no unique or text indexes, no `distinct`, no `renameCollection`, no `$merge` into the collection, 4 MB documents instead of 16 MB, and no writes in transactions. Any one of these can be the thing that disqualifies the feature for a given service — check the list against your requirements *before* creating the collection, because you cannot convert back.
- **Sharded deployments carry extra, still-shifting constraints.** Shard keys are limited to `metaField`/its sub-fields/`timeField`; `_id` is not allowed; zone sharding is unsupported and the balancer spreads data evenly whether or not that suits you; sharding administration commands cannot be run. The maturity is visibly improving rather than settled: resharding only arrived in 8.0.10, and `timeField`-containing shard keys were *deprecated* in 8.0 — meaning a cluster built on the originally-documented pattern now logs a warning telling you to reshard onto the `metaField`.
- **Optimal write performance asks your producer to change shape.** Batch by `metaField` within a single `insertMany`, set `ordered: false`, keep field order identical across documents (nested order included, since "compression requires consistent nested field order"), omit empty arrays/objects rather than sending them, and round floats. None of this matters in a regular collection; all of it matters here. It is cheap to do at the point of writing the ingest path and annoying to retrofit.
- **Adopting it is a version commitment.** FCV 5.0 minimum to create one at all, 6.3 for the automatic `metaField`+`timeField` index and custom bucketing parameters, 7.0 for `$out` into the collection, 8.0.10 for resharding — and downgrading across the documented boundaries requires *dropping* the collections first. On an older deployment, a well-modeled regular collection with a good compound index may simply be the pragmatic answer.

## Documentation Links

- [MongoDB Documentation — Time Series Collections](https://www.mongodb.com/docs/manual/core/timeseries-collections/) — doc
- [MongoDB Documentation — Time Series Collection Limitations](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/) — doc
- [MongoDB Documentation — Set Granularity for Time Series Data](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-granularity/) — doc
- [MongoDB Documentation — About Time Series Data (bucketing and the bucket catalog)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-bucketing/) — doc
- [MongoDB Documentation — Create and Query a Time Series Collection (field reference)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-procedures/) — doc
- [MongoDB Documentation — Time Series Collections Considerations (metaField, cardinality, granularity)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-considerations/) — doc
- [MongoDB Documentation — Best Practices for Time Series Collections](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-best-practices/) — doc
- [MongoDB Documentation — Set up Automatic Removal for Time Series Collections (TTL)](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-automatic-removal/) — doc
- [MongoDB Documentation — Aggregation and Operator Considerations for Time Series](https://www.mongodb.com/docs/manual/core/timeseries/timeseries-aggregations-operators/) — doc
