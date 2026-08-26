---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Go past the general-purpose B-tree index covered in [MongoDB Indexes: B-Trees, Compound Prefixes, and the Query Planner](mongodb-indexing-fundamentals) into the five special-purpose tools the book groups under one chapter because none of them behaves like a normal index or a normal collection: **2dsphere/2d geospatial indexes** for location queries, **text indexes** for basic keyword search, **TTL indexes** for automatic document expiry, **capped collections** for fixed-size insertion-ordered data, and **GridFS** for files too large for a single 16 MB document. Each solves a real problem the ordinary compound index can't, and each comes with its own sharp edges.

## Use Cases

- A restaurant-finder app that needs to answer "what neighborhood am I in," "how many restaurants are near me," and "find restaurants within 5 miles, sorted by distance" — the book's running example, solved with a `2dsphere` index and `$geoIntersects`, `$geoWithin`, and `$nearSphere`.
- A session store or cache where documents should vanish on their own 24 hours after `lastUpdated`, without a cron job or application-level cleanup — a TTL index.
- A capped, fixed-size collection used as a work queue or a rolling log buffer, where old entries should silently age out as new ones arrive and a worker tails the collection for new inserts.
- A collection of articles or blog posts where users need simple keyword search across `title` and `body` — a `text` index, with the explicit caveat below that this is not where production full-text search lives anymore.
- Storing user-uploaded videos, PDFs, or images that exceed MongoDB's 16 MB document limit, while staying inside MongoDB instead of standing up a separate object store — GridFS.

## Deep Dive

### Geospatial indexes: 2dsphere and 2d

MongoDB has two geospatial index types. `2dsphere` "work[s] with spherical geometries that model the surface of the earth based on the WGS84 datum" — the same oblate-spheroid model that makes distance between two cities accurate. `2d` indexes assume "a perfectly flat surface, instead of a sphere," and are for things like game maps or other genuinely two-dimensional data, not GeoJSON.

`2dsphere` indexes GeoJSON geometries — points, lines, and polygons — stored under a field you name yourself, though the embedded shape fields (`type`, `coordinates`) are fixed by the GeoJSON spec:

```js
{
  "name": "New York City",
  "loc": { "type": "Point", "coordinates": [50, 2] }
}
db.openStreetMap.createIndex({ "loc": "2dsphere" })
```

Three query operators cover the useful cases, each taking a `{"$geometry": geoJsonDesc}` argument:

- **`$geoIntersects`** — anything that touches the query shape. "This would find all point-, line-, and polygon-containing documents that had a point in the East Village."
- **`$geoWithin`** — anything fully contained. Unlike `$geoIntersects`, this "will not return things that merely pass through the East Village (such as streets) or partially overlap it."
- **`$near`** — the only geospatial operator that implies a sort: "results from `$near` are always returned in order of distance, from closest to farthest."

The book builds a full restaurant-finder example from this: find the user's current neighborhood with `$geoIntersects` on a point, then find every restaurant `$geoWithin` that neighborhood's polygon. For a radius search, two options trade off order guarantees against index requirements:

```js
// unordered, radius in radians (miles / 3963.2)
db.restaurants.find({
  location: { $geoWithin: { $centerSphere: [[-73.93414657, 40.82302903], 5/3963.2] } }
})

// ordered nearest-to-farthest, $maxDistance in meters
db.restaurants.find({
  location: {
    $nearSphere: {
      $geometry: { type: "Point", coordinates: [-73.93414657, 40.82302903] },
      $maxDistance: 5 * 1609.34
    }
  }
})
```

Geospatial indexes compound with ordinary fields exactly like any other index, which is how you narrow "restaurants in Hell's Kitchen" down to "**pizza** in Hell's Kitchen":

```js
db.openStreetMap.createIndex({ "tags": 1, "location": "2dsphere" })
```

The book's own table of which operators use spherical versus flat geometry is worth internalizing, since a `2d` index silently gives you flat-plane math: `$near`/`$geoNear`/`$nearSphere` are spherical when given a GeoJSON point and a `2dsphere` index, flat when given legacy coordinates and a `2d` index; `$geoWithin: {$box/$polygon/$center}` are always flat; `$geoWithin: {$centerSphere}` and `$geoIntersects` are always spherical. Mixing a `2d` index with spherical assumptions, or vice versa, produces geometrically wrong answers rather than an error — "do not use a 2d index if you plan to store GeoJSON data — they can only index points."

One more restriction worth knowing before it surprises you in production: **`$near` will not work on a sharded collection**, and the `geoNear` command / `$geoNear` aggregation stage require a collection to have *at most one* `2dsphere` and *at most one* `2d` index, because neither syntax includes the location field — ambiguous otherwise. Plain query operators like `$near` and `$geoWithin` do take a location field, so they permit multiple geospatial indexes on one collection.

**Book vs. today.** This part of the chapter has aged well — `2dsphere` remains MongoDB's recommended geospatial index today, and current docs go further than the book did: "you can use the `2dsphere` index for both spherical queries *and* two-dimensional queries" by converting legacy coordinate pairs to GeoJSON points internally, making `2dsphere` the safer default even for some flat-plane cases. Two constraints current docs state explicitly that the book doesn't dwell on: geospatial indexes **can't cover a query** (a `FETCH` is always required), and a geospatial index **can't be used as a shard key**.

### Full-text search with text indexes

`text` indexes let you search string fields "quickly and provide support for common search engine requirements such as language-appropriate tokenization, stop words, and stemming" — a real step up from a `LIKE`-style regex scan. Creating one is ordinary `createIndex` syntax, optionally with per-field weights that bias relevance scoring:

```js
db.articles.createIndex({ "title": "text", "body": "text" })
db.articles.createIndex(
  { "title": "text", "body": "text" },
  { "weights": { "title": 3, "body": 2 } }
)
```

Weights can't be changed without dropping and recreating the index, so the book's advice is to tune them on a sample dataset first. A wildcard form indexes every string field, including nested documents and arrays: `db.articles.createIndex({"$**": "text"})`.

`$text` tokenizes the query string on whitespace/punctuation and, by default, ORs the tokens. Quoting a phrase makes it a required AND term, and the semantics compound: `{"$search": "\"impact crater\" lunar meteor"}` means `"impact crater" AND ("lunar" OR "meteor")`. To get a logical AND between individual words, quote each one separately. Results are **not sorted by relevance by default** — you have to project and sort on the `textScore` metadata explicitly:

```js
db.articles.find(
  { $text: { $search: "\"impact crater\" lunar" } },
  { title: 1, score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } }).limit(10)
```

Because a text index has "a number of keys proportional to the words in the fields being indexed," it's expensive to build and expensive to maintain: every write to an indexed field re-tokenizes and re-stems, so text-indexed collections see measurably worse write throughput than collections with only scalar or compound indexes, and sharding a text-indexed collection means reindexing text on every document migrated to a new shard. You can optimize a specific access pattern by partitioning the index with a prefix field (`{"date": 1, "post": "text"}`, faster for date-scoped searches) or covering extra projected fields with a postfix (`{"post": "text", "author": 1}`) — the two can combine.

**Book vs. today — this is the important correction.** MongoDB's own current documentation now states plainly: *"We recommend using MongoDB Search indexes or MongoDB Vector Search indexes instead of text indexes."* `text` indexes are not removed and still work exactly as described above, but they are no longer where production full-text search should live — see [MongoDB Search and Vector Search: $search, $vectorSearch, and RAG Retrieval](mongodb-atlas-search-and-vector-search) for the Lucene-backed replacement (formerly branded Atlas Search), which supports fuzzy matching, autocomplete, faceting, and semantic/vector search that basic `text` indexes never will. Three constraints current docs are more explicit about than the book was: a collection can have **only one** text index (though it may cover multiple fields), text indexes **always** behave as sparse indexes (the `sparse` option is ignored), and a text index **can't cover a query** — it always requires a document fetch. If you're building a new keyword-search feature today, start with MongoDB Search, not `text`.

### Capped collections and tailable cursors

A capped collection is fixed in size at creation and behaves like a circular queue: "if we're out of space, the oldest document will be deleted, and the new one will take its place." Documents can't be manually removed, and updates that would grow a document's size are disallowed — both restrictions exist specifically so insertion order is guaranteed without maintaining a free list.

```js
db.createCollection("my_collection", { "capped": true, "size": 100000 })
db.createCollection("my_collection2", { "capped": true, "size": 100000, "max": 100 })
db.runCommand({ "convertToCapped": "test", "size": 10000 })
```

If both `size` and `max` are set, whichever limit is hit first triggers age-out. A capped collection can't be resized after creation — drop and recreate it if requirements change — and there is no way to "uncap" one.

**Tailable cursors** — inspired by `tail -f` — stay open past exhaustion and keep returning newly inserted documents. They only work on capped collections, "since insert order is not tracked for normal collections," and they time out after 10 minutes without results, so client code needs to requery on death. The book is already forward-looking here: "for the vast majority of uses, change streams... are recommended over tailable cursors as they offer vastly more control and configuration plus they work with normal collections."

**Book vs. today.** Current MongoDB docs push this recommendation harder than the book does: *"Generally, TTL indexes offer better performance and more flexibility than capped collections,"* and further, *"capped collections serialize write operations and therefore have worse concurrent insert, update, and delete performance than non-capped collections. Before you create a capped collection, consider if you can use a TTL index instead."* The book already steered toward TTL indexes for the WiredTiger-performance reason; today's docs add the concurrency argument explicitly and list additional restrictions worth knowing: capped collections can't be written to inside multi-document transactions, and the `$out` aggregation stage can't write into one. Capped collections remain unsharded, unchanged since the book — still true today.

### TTL indexes

A TTL index expires documents automatically based on a date field, which is a much more flexible age-out mechanism than a capped collection's size limit — "useful for caching use cases such as session storage":

```js
// 24-hour timeout
db.sessions.createIndex({ "lastUpdated": 1 }, { "expireAfterSeconds": 60 * 60 * 24 })
```

Updating `lastUpdated` on activity resets the clock; once it's 24 hours stale, the document is removed. `expireAfterSeconds` can be changed later without dropping the index, via `collMod`:

```js
db.runCommand({
  "collMod": "someapp.cache",
  "index": { "keyPattern": { "lastUpdated": 1 }, "expireAfterSeconds": 3600 }
})
```

"MongoDB sweeps the TTL index once per minute, so you should not depend on to-the-second granularity" — current docs sharpen this: the background task runs every 60 seconds and, per index, stops after deleting 50,000 documents or spending one second on that index, whichever comes first, so a large backlog of expired documents is drained gradually across multiple sweeps rather than all at once. You can have multiple TTL indexes on one collection, but "they cannot be compound indexes" — this constraint hasn't changed since the book: current docs confirm "TTL indexes are single-field indexes. Compound indexes do not support TTL and ignore the `expireAfterSeconds` option." The `_id` field also can't carry a TTL index.

### Storing files with GridFS

GridFS solves a specific problem: MongoDB documents (and therefore the file-holding document you'd otherwise want to write) are capped at 16 MB, and GridFS "is a specification for storing and retrieving files that exceed" that limit — "by splitting them up into chunks and storing each chunk as a separate document." The book frames the trade-off plainly: GridFS "can simplify your stack" if you're already on MongoDB and want to reuse its replication/sharding for file failover, but "performance is slower" than a filesystem, and because a file is split across many chunk documents, "MongoDB... cannot lock all of the chunks in a file at the same time" — updates mean delete-and-resave, not in-place edits.

The `mongofiles` CLI is the fastest way to try it:

```
$ mongofiles put foo.txt
$ mongofiles list
$ mongofiles get foo.txt
```

Under the hood, two collections do the work. `fs.chunks` (by default) holds the binary pieces:

```js
{ "_id": ObjectId("..."), "n": 0, "data": BinData("..."), "files_id": ObjectId("...") }
```

`fs.files` holds one metadata document per file, with `_id`, `length`, `chunkSize` (default 255 KiB), `uploadDate`, and historically `md5`. Any custom metadata — MIME type, download count, user rating — can live alongside these.

**Book vs. today.** The mechanics are unchanged — 255 KiB default chunk size and the 16 MB per-document limit that motivates GridFS in the first place are both still current. But the `md5` field the book calls out as required metadata is now **deprecated**: current docs state *"the MD5 algorithm is prohibited by FIPS 140-2. MongoDB drivers deprecate MD5 support and will remove MD5 generation in future releases. Applications that require a file digest should implement it outside of GridFS and store in `files.metadata`."* Two more `fs.files` fields the book doesn't flag as legacy are also now deprecated for the same "use `files.metadata` instead" reason: `contentType` and `aliases`. And one restriction current docs state explicitly that the book doesn't mention: GridFS does not support multi-document transactions.

## Trade-offs

- **Geospatial indexes buy real query power at the cost of coverage and sharding flexibility.** `2dsphere` makes "restaurants within 5 miles" a fast indexed lookup instead of an application-side distance calculation over every document, but the index can never cover a query — every result still costs a `FETCH` — and it cannot serve as a shard key, so a geo-heavy collection needs a separate shard-key strategy.
- **`text` indexes are a convenience feature, not a search engine, and MongoDB now says so directly.** They're fine for "find articles mentioning these words" on a small-to-medium collection where relevance quality doesn't matter much. They are not a substitute for the Lucene-backed MongoDB Search, and building new keyword-search functionality on top of `text` today means building something you'll likely have to migrate off later. The one-index-per-collection limit is itself a signal: MongoDB expects you to have exactly one, simple, secondary search need per collection, not a search product.
- **Capped collections trade flexibility for write throughput on spinning disks — a trade that mattered more in 2019 than it does with WiredTiger today.** You get zero control over *what* ages out (only size/count), can't shard them, and current docs confirm they now serialize writes and underperform normal collections concurrently. TTL indexes cover most of the same ground with per-document control and no such penalty; capped collections still make sense for genuinely fixed-size, tailable work queues, but they're the narrower tool now, not the default.
- **TTL indexes are flexible but not real-time.** A 60-second sweep interval, plus a per-sweep cap of 50,000 documents or one second of deletion work, means "expire this session" is a *soon*, not a *now* — fine for caches and sessions, wrong for anything needing precise-to-the-second removal (which needs application-level deletion instead).
- **GridFS trades a unified stack for a real performance and atomicity cost.** It saves you from running a second storage system, but every file read/write is at minimum two collections' worth of document operations, updates require full delete-and-resave since chunks can't be locked together, and — as current docs make explicit — it's off the table entirely inside a multi-document transaction. For files under 16 MB, storing them directly in a document (or just using an object store like S3) is usually simpler.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 6, "Special Index and Collection Types", p. 133-159](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) — doc
- [MongoDB Documentation — Geospatial Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-geospatial/) — doc
- [MongoDB Documentation — Geospatial Queries](https://www.mongodb.com/docs/manual/geospatial-queries/) — doc
- [MongoDB Documentation — Text Indexes](https://www.mongodb.com/docs/manual/core/index-text/) — doc
- [MongoDB Documentation — TTL Indexes](https://www.mongodb.com/docs/manual/core/index-ttl/) — doc
- [MongoDB Documentation — Capped Collections](https://www.mongodb.com/docs/manual/core/capped-collections/) — doc
- [MongoDB Documentation — GridFS](https://www.mongodb.com/docs/manual/core/gridfs/) — doc
- [MongoDB Documentation — MongoDB Search Overview](https://www.mongodb.com/docs/search/) — doc
