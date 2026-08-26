---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand why CouchDB has no ad-hoc query language for anything beyond the simplest lookups, and how it answers that gap instead: every non-trivial query is a pre-defined **map/reduce view**, written as JavaScript functions, saved into a design document, and materialized incrementally into a B-tree index as documents are written. Learn how `emit()` shapes the index, how built-in and custom reducers aggregate it, and how the resulting view is queried and sliced over HTTP with `key`, `startkey`, `endkey`, and `descending`.

## Use Cases

- Looking up documents by a field other than `_id` — for example finding an artist document by `name` rather than by its generated identifier — which `_all_docs` cannot do because it is keyed only by `_id`.
- Fanning a single document out into many index rows, such as emitting one row per album inside an artist document, so albums become independently queryable and sortable even though they only exist embedded in the parent document.
- Building a counted or summed aggregate — total plays per tag, total revenue per region — by pairing a map function's `emit()` calls with a reduce function (`_count`, `_sum`, `_stats`, or custom JS) instead of running a scan-and-aggregate query at read time.
- Paginating or range-scanning a large result set (10,000+ artists) using `limit`, `startkey`, and `endkey`, relying on the fact that CouchDB keeps view rows in alphanumeric key order by construction.
- Deciding, on a new project, whether a query is known and stable enough to deserve a permanent view versus being simple enough for a Mango `_find` selector (see Book vs. Today below) — the same up-front, know-your-questions discipline that DynamoDB access-pattern modeling requires, just enforced by a different mechanism.

## Deep Dive

### There is no `WHERE` clause

Day 1 CRUD in CouchDB only gets you documents by `_id`. The book is explicit that this is the norm, not a temporary limitation: "Views are the principal way that documents are accessed in all but trivial cases, such as those individual CRUD operations you saw on Day 1." Every database ships one view for free, `_all_docs`, which produces one row per document keyed by its `_id`:

```
$ curl "${COUCH_ROOT_URL}/music/_all_docs"
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    {
      "id": "2ac58771c197f70461056f7c7e0001f9",
      "key": "2ac58771c197f70461056f7c7e0001f9",
      "value": { "rev": "7-d37c47883f4d30913c6a38644410685d" }
    }
  ]
}
```

Every row has the same three fields — `id`, `key`, `value` — and for `_all_docs` the `id` and `key` happen to match. For a custom view, they almost never will, because the key is whatever the map function chose to emit, not the document's identity.

### `emit()` is the whole mapping language

A view's map function runs once per document and calls `emit(key, value)` zero, one, or many times. The book's running example is a `music` database of artist documents, each with a `name` and an `albums` array. The simplest possible mapper just echoes the document:

```js
function(doc) {
  emit(null, doc);
}
```

Reproducing `_all_docs` by hand means emitting the `_id` as the key and a small object as the value:

```js
function(doc) {
  emit(doc._id, { rev: doc._rev });
}
```

The first genuinely useful view answers "find an artist by name" — something `_all_docs` structurally cannot do:

```js
// couchdb/artistsByNameMapper.js
function(doc) {
  if ('name' in doc) {
    emit(doc.name, doc._id);
  }
}
```

Querying it returns rows keyed by name instead of by `_id`:

```
$ curl "${COUCH_ROOT_URL}/music/_design/artists/_view/by_name"
{
  "total_rows": 1,
  "offset": 0,
  "rows": [
    { "id": "2ac58771c197f70461056f7c7e0001f9", "key": "The Beatles", "value": "2ac58771c197f70461056f7c7e0001f9" }
  ]
}
```

`emit()` can also be called more than once per document, which is how embedded, nested data becomes independently indexable. This mapper produces one row per album, pulled out of each artist's `albums` array:

```js
// couchdb/albumsByNameMapper.js
function(doc) {
  if ('name' in doc && 'albums' in doc) {
    doc.albums.forEach(function(album){
      var
        key = album.title || album.name,
        value = { by: doc.name, album: album };
      emit(key, value);
    });
  }
}
```

One Beatles document with three albums produces three rows in the view, each independently keyed by album title and sortable alongside every other artist's albums:

```
$ curl "${COUCH_ROOT_URL}/music/_design/albums/_view/by_name"
{
  "total_rows": 3,
  "offset": 0,
  "rows": [
    { "id": "2ac...", "key": "Abbey Road", "value": { "by": "The Beatles", "album": { "title": "Abbey Road", "year": 1969 } } },
    { "id": "2ac...", "key": "Help!", "value": { "by": "The Beatles", "album": { "title": "Help!", "year": 1965 } } },
    { "id": "2ac...", "key": "Sgt. Pepper's Lonely Hearts Club Band", "value": { "by": "The Beatles", "album": { "title": "Sgt. Pepper's Lonely Hearts Club Band", "year": 1967 } } }
  ]
}
```

Going one level deeper, a mapper can walk arbitrarily nested arrays — albums containing tracks containing tags — and emit a row for each leaf:

```js
// couchdb/tagsByNameMapper.js
function(doc) {
  (doc.albums || []).forEach(function(album){
    (album.tracks || []).forEach(function(track){
      (track.tags || []).forEach(function(tag){
        emit(tag.idstr, 1);
      });
    });
  });
}
```

This is the setup step for reduction: each occurrence of a tag emits the value `1`, and a reducer (built-in `_count` or `_sum`, or custom JS) then collapses all rows sharing a key down to a single aggregate — the classic word-count pattern applied to tags instead of words.

### Views are saved documents, not runtime queries

A crucial structural point: a view is not sent with each request the way a SQL query string is. It is saved once, as a JavaScript function, inside a **design document** — an ordinary document whose `_id` starts with `_design/` and which therefore replicates like any other document. "Design documents always have IDs that start with `_design/` and contain one or more views. The index name distinguishes this view from others housed in the same design document. Deciding which views belong in which design documents is largely application-specific and subject to taste." Querying it means hitting a fixed URL shape: `/<database>/_design/<design_doc>/_view/<view_name>`.

### The index is a B-tree, built incrementally

Once saved, CouchDB does not recompute a view from scratch on every request. Map output is stored as a **B-tree index**, and when a document changes, only that document's map function reruns — the rest of the index is untouched. That incremental-update model is also what guarantees ordering: "CouchDB will ensure that the records are presented in alphanumerical order by the emitted keys. In effect, this is the indexing that CouchDB offers. When designing your views, it's important to pick emitted keys that will make sense when ordered." Because the B-tree is already key-ordered, slicing a view is cheap and doesn't require a separate `ORDER BY` step: `key` returns exact matches, `startkey`/`endkey` bound a range, `limit` caps row count, and `descending=true` reverses traversal (with `startkey`/`endkey` swapped to match). Querying with `limit=5&startkey="C"` against a 10,000-artist import jumps straight into the middle of the alphabet without scanning everything before it — the response's `offset` field even reports how far into the full ordered set that jump landed.

### Reduce functions turn the map output into aggregates

A view's mapper alone gives you a filtered, re-keyed, ordered list. Adding a reducer turns it into an aggregate query. CouchDB's built-in reducers cover the common cases (`_count`, `_sum`, `_stats` for min/max/sum/count/sumsqr in one pass); a custom JavaScript reducer receives `(keys, values, rereduce)`, where `rereduce` distinguishes a first pass over raw map output from a later pass that combines already-reduced intermediate results from sibling B-tree nodes — the mechanism that lets reduction stay efficient as the tree grows. The one hard constraint: a reduce function must genuinely reduce — collapsing many values into a small, fixed-size scalar or object — because returning something like a growing list of uniques defeats the B-tree's incremental design and CouchDB will refuse it.

## Trade-offs

- **You must know your queries before you write your data model — there is no query-time escape hatch.** Every access path needs a view designed and saved in advance; there is no equivalent of typing an ad-hoc `WHERE name = ?` against a field nobody indexed. This is the same up-front-planning trade DynamoDB access-pattern modeling makes (see [DynamoDB Data Modeling Approach](/database-concepts/dynamodb-data-modeling-approach)) — both systems refuse to let you defer the "what will I query by?" decision to read time, in exchange for read paths that stay fast (a pre-built B-tree lookup, not a scan) as data grows.
- **A forgotten access pattern is a new view and an index rebuild, not a fast follow-up query.** Realizing after the fact that you also need artists by genre means writing and deploying a new map function, then waiting for CouchDB to build that index over every existing document — closer to a migration than to `CREATE INDEX`.
- **Fan-out mappers trade write-time simplicity for query flexibility.** Emitting one row per album, or one row per tag several levels deep, means a single document update touches many index rows on rebuild. That's the price of being able to query nested data independently of its parent document at all.
- **Reduce functions have a real ceiling.** The requirement that a reducer collapse to a small fixed-size result rules out some intuitively reasonable aggregates (e.g., "give me the list of every unique tag" as a reduce output) — those need a different view shape (group by key, no reduce) rather than a clever reducer.
- **Design documents are real documents, with real replication behavior.** That is a genuine convenience — views ship with the database and replicate automatically — but it also means a design document is versioned and merged like any other document, including facing update conflicts during replication.

### Book vs. today: Mango queries closed part of this gap in 2016

The book presents map/reduce views as *the* way to query CouchDB, full stop — accurate for the edition, but CouchDB 2.0 (2016) added a second path that the chapter never mentions: **Mango**, a MongoDB-style declarative JSON query language exposed through the `POST /_find` endpoint. Mango began life at Cloudant as "Cloudant Query," was donated to the CouchDB project, and shipped under its development codename. It genuinely closes part of the "you must know your queries in advance" trade-off this concept describes — a selector like `{"selector": {"name": "The Beatles"}}` answers a simple equality lookup without hand-writing and deploying a map function first.

It is not a replacement for views, though, and current Apache CouchDB documentation is explicit that Mango is built *on top of* the same infrastructure this concept covers: "Mango indexes, with index type `json`, are built using MapReduce views." A Mango selector picks the best matching index it can find (the primary index out of the box, or a Mango-created secondary index), and under the hood that index is still a map/reduce view with its own B-tree. So the accurate relationship today is: Mango covers straightforward filtering and equality/range lookups without writing JavaScript, while hand-written map/reduce views — as described in this concept — remain necessary for genuine aggregation (sums, counts, custom reducers) and for fan-out patterns like the nested-array `emit()` calls shown above, which a flat JSON selector cannot express. Choosing between them is itself a smaller version of the same "how well do I already know this query" judgment call.

## Documentation Links

- [Luc Perkins, Eric Redmond, Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018) — Chapter 5, "CouchDB", Day 2: "Creating and Querying Views", p. 145-158](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) — doc
- [Apache CouchDB Documentation — Views Introduction (map/reduce, emit, B-tree indexing)](https://docs.couchdb.org/en/stable/ddocs/views/intro.html) — doc
- [Apache CouchDB Documentation — View Functions Reference (built-in reducers: _sum, _count, _stats)](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#view-functions) — doc
- [Apache CouchDB Documentation — /{db}/_find (Mango queries)](https://docs.couchdb.org/en/stable/api/database/find.html) — doc
- [CouchDB Blog — "Feature: Mango Query" (August 2016, CouchDB 2.0)](https://blog.couchdb.org/2016/08/03/feature-mango-query/) — doc
