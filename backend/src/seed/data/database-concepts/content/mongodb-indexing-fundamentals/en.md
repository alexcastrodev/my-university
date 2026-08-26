---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand what a MongoDB index actually is — a real on-disk B-tree maintained by the WiredTiger storage engine, not a metaphor — why `_id` gets one for free and every other one costs you writes, how a compound index serves any *prefix* of its keys and nothing else, and how to read `explain("executionStats")` well enough to tell a good index from a bad one instead of guessing.

## Use Cases

- Diagnosing a query that "suddenly got slow" by running `explain("executionStats")` and finding a `COLLSCAN` stage — the book's own opening example queries one username out of a million documents and reports `totalDocsExamined: 1000000` and `executionTimeMillis: 419`, versus `totalDocsExamined: 1` and `executionTimeMillis: 1` once `createIndex({"username": 1})` exists.
- Deciding the *order* of fields in a compound index for a query that filters on one field, ranges on another, and sorts on a third — the difference in the book's student-dataset example between a 4,325 ms plan and a 42 ms plan is purely key order, not the number of indexes.
- Auditing a collection whose write throughput has degraded, by running `db.collection.getIndexes()` and dropping indexes no query shape actually uses — every index on the collection has to be updated on every insert, update, and delete that touches its fields.
- Enforcing "unique when present" on an optional field (an email address that may be absent but must never collide) using `unique` combined with `partialFilterExpression`, instead of a plain unique index that would reject the second document missing the field.
- Recognizing the cases where an index makes things *worse* — a reporting query that returns most of the collection is faster as a collection scan, because an index lookup costs two reads (index entry, then the document) where a scan costs one.

## Deep Dive

### An index is an ordered list — and on disk, it is a B-tree

The book's framing is deliberately plain: "A database index is similar to a book's index. Instead of looking through the whole book, the database takes a shortcut and just looks at an ordered list with references to the content." A query that can't use one is a **collection scan**, which the `explain` output labels `COLLSCAN` — the server reading the whole book from page one.

What that "ordered list" is physically is a B-tree. MongoDB's default storage engine, WiredTiger, stores both collections and indexes as B-trees on disk; the index created automatically on `_id` and every index you create with `createIndex` is one. This is not an analogy borrowed from relational databases — it is the same structure, for the same reason, which is why the book can say outright that "MongoDB's indexes work almost identically to typical relational database indexes." A B-tree keeps its keys sorted, keeps every leaf at the same depth, and packs many keys into each node so that one disk page read buys a wide branching decision. That is exactly what lets an index answer "which document has username `user101`" in one key lookup instead of a million document reads.

Each entry in the index holds the indexed value (or values, for a compound index) plus a **record identifier** — "used internally by the storage engine to locate the data for a document." So an index hit is two steps: find the key, then follow the record identifier to fetch the document. In `explain` terms, that is an `IXSCAN` stage feeding a `FETCH` stage.

### Watch the B-tree get built: what `createIndex` is actually doing

Below is a hand-traced insert of seven `age` values — `42, 17, 63, 8, 55, 91, 70`, arriving in that non-sorted order, the way real documents arrive — into an initially empty index. The tree has minimum degree `t = 2`, so every node holds 1 to 3 keys and a node is **full** at `2t - 1 = 3`. Following the standard proactive discipline, a full node is split *before* the algorithm descends into it, so insertion is a single downward pass with no backtracking:

```viz
type: btree
node root keys=42 | insert(42): the index is empty, so 42 becomes the root -- one B-tree node, one WiredTiger page.
node root keys=17,42 | insert(17): 17 sorts before 42 and the root has room (2 of 3 keys), so it just slots in, in order.
node root keys=17,42,63 | insert(63): root = [17, 42, 63] -- now FULL at 2t-1 = 3 keys.
remove root | insert(8): the root is FULL, so split it BEFORE descending into it.
node root2 keys=42 | Median 42 is promoted into a brand-new root. This is the only way the index gets taller -- at the top, never at the leaves, which is why every leaf stays at the same depth.
node n17 keys=17 parent=root2 index=0 | The keys below the median become the left child.
node n63 keys=63 parent=root2 index=1 | The keys above the median become the right child.
node n17 keys=8,17 parent=root2 index=0 | Now finish insert(8): 8 is less than 42, so descend left into [17], which has room -> insert 8.
node n63 keys=55,63 parent=root2 index=1 | insert(55): 55 is greater than 42, so descend right into [63], which has room -> insert 55.
node n63 keys=55,63,91 parent=root2 index=1 | insert(91): descend right into [55, 63] -> insert 91. That leaf is now FULL.
remove n63 | insert(70): 70 would descend right, but [55, 63, 91] is FULL. Split it first.
node root2 keys=42,63 | Median 63 promotes into the root, which held only 1 key and so has room -- the split stops here instead of propagating further up.
node n55 keys=55 parent=root2 index=1 | [55] stays as the middle child, covering keys strictly between 42 and 63.
node n91 keys=91 parent=root2 index=2 | [91] becomes the new rightmost child, covering keys above 63.
node n91 keys=70,91 parent=root2 index=2 | Now finish insert(70): 70 is greater than 63, so descend into the rightmost child -> insert 70.
```

Two splits, two different outcomes. `insert(8)` splits the *root*, which is the only event that makes the tree taller. `insert(70)` splits a leaf whose promoted median lands in a parent that happened to have room, so the propagation stops after one level — in a deeper index that same promotion would keep climbing. The finished tree is root `[42, 63]` over leaves `[8, 17]`, `[55]`, `[70, 91]`: every leaf at depth 1, no node over 3 keys, keys correctly separated at every level.

This is the machinery `createIndex` runs, one document at a time, over the whole collection — and it is why the book warns that "building new indexes is time-consuming and resource-intensive," and why an index build on a large collection is something you watch with `db.currentOp()`. It also explains a small, easily-missed line at the end of the chapter: "If you have the choice, creating indexes on existing documents is slightly faster than creating the index first and then inserting all documents." Building the index afterward lets the engine construct the tree from data it can process in bulk; building it first means every single insert pays the descend-and-maybe-split cost you just watched, transaction by transaction.

### Compound indexes and the prefix rule

An index keeps its values sorted, which makes it useful for sorting as well as matching — "but an index can only help with sorting if it is a prefix of the sort." An index on `{"username": 1}` does nothing for `.sort({"age": 1, "username": 1})`; you need `createIndex({"age": 1, "username": 1})`, a **compound index**.

The book represents that index concretely as sorted key pairs pointing at record identifiers:

```
[0, "user100020"] -> 8623513776
[0, "user1002"]   -> 8599246768
...
[1, "user100113"] -> 8623525680
[2, "user100191"] -> 8623535664
```

Ages strictly ascending; within each age, usernames ascending. That layout is the whole explanation of what such an index can and cannot do:

- **Equality query** — `find({"age": 21}).sort({"username": -1})` jumps straight to the first `21` and walks the index; no sort step is needed, because the index already holds usernames in order within an age. Direction doesn't matter, since MongoDB can traverse an index either way.
- **Range query** — `find({"age": {"$gte": 21, "$lte": 30}})` uses the leading `age` key to bound the scan, and returns documents in index order.
- **Range plus a sort on the second key** — `find({"age": {"$gte": 21, "$lte": 30}}).sort({"username": 1})` cannot use the index for the sort, because usernames are only ordered *within* an age. MongoDB sorts in memory, and if the result exceeds 32 MB it errors out entirely: `"Sort operation used more than the maximum 33554432 bytes of RAM. Add an index, or specify a smaller limit."`

The general rule the book calls **implicit indexes**: "if an index has N keys, you get a 'free' index on any prefix of those keys." An index on `{a, b, c, ..., z}` is simultaneously an index on `{a}`, on `{a, b}`, on `{a, b, c}`, and so on. And the flip side, which is where most compound-index mistakes live: "this doesn't hold for any subset of keys: queries that would use the index `{"b": 1}` or `{"a": 1, "c": 1}` will not be optimized. Only queries that can use a prefix of the index can take advantage of it."

Key *direction* only matters for multi-key sorts. `{"age": 1, "username": -1}` and `{"age": -1, "username": 1}` are equivalent (inverse indexes suit the same queries), and if you only ever sort on a single key, an ascending index serves a descending sort just as well — "so don't create both!"

### Ordering the keys: equality, sort, range

The chapter's best material is a worked example on a million-record `students` collection, running:

```js
db.students.find({ student_id: { $gt: 500000 }, class_id: 54 })
  .sort({ student_id: 1 })
  .explain("executionStats")
```

With an index on `{student_id: 1, class_id: 1}`, the winning plan examined **850,477 index keys to return 9,903 documents** in 4,325 ms. The index was usable but not *selective*: the leading key was the range filter, so the scan had to walk almost half the index. Flipping the order to `{class_id: 1, student_id: 1}` puts the equality filter first, and the same query returns in **37 ms with `totalKeysExamined` equal to `nReturned`** — 9,903 keys for 9,903 documents, the ideal ratio.

Change the sort to a third field (`.sort({final_grade: 1})`) and a `SORT` stage reappears in the winning plan — an in-memory sort, 136 ms. The fix is `{class_id: 1, final_grade: 1, student_id: 1}`: the sort key goes *after* the equality filter but *before* the range filter, so MongoDB can walk the index in final-grade order while the range filter narrows what it keeps. That version runs in 42 ms with no `SORT` stage, at the cost of examining slightly more keys than it returns (9,905 vs 9,903) — a trade the book makes explicitly: "in order to avoid an in-memory sort we need to examine more keys than the number of documents we return."

The chapter states the resulting rule as three lines:

> - Keys for equality filters should appear first.
> - Keys used for sorting should appear before multivalue fields.
> - Keys for multivalue filters should appear last.

That is the rule the MongoDB documentation now brands **ESR (Equality, Sort, Range)** — the book teaches it in full, just without the acronym.

### How MongoDB picks an index: the plan race

MongoDB doesn't cost-estimate plans the way a relational optimizer does — it *races* them. When a query arrives, the server looks at the query's **shape** (which fields are filtered, whether there's a sort), identifies the candidate indexes, builds one query plan per candidate, and runs them in parallel threads for a trial period. "To win the race, a query thread must be the first to either return all the query results or return a trial number of results in sort order."

The winner is stored in a **plan cache** keyed by query shape, so subsequent queries of the same shape skip the race. Plans get evicted when the collection or its indexes change, when an index is rebuilt/added/dropped, when the cache is cleared explicitly — and the whole cache is lost on a `mongod` restart. One practical consequence for reading `explain`: `executionTimeMillis` "will reflect how long it took all of them to run, not the one chosen as the best" when multiple plans were tried.

The fields worth reading in `explain("executionStats")` are few:

| Field | What it tells you |
|---|---|
| `stage` | `IXSCAN` means an index was used; `COLLSCAN` means the whole collection was read |
| `nReturned` | Documents the query actually returned |
| `totalKeysExamined` | Index entries walked — compare against `nReturned` to measure selectivity |
| `totalDocsExamined` | Documents fetched via record identifiers; `0` means the query was **covered** |
| `indexBounds` | The exact range of the index that was traversed |
| `rejectedPlans` | The plans that lost the race |

A **covered query** is one whose requested fields are all in the index, so no document fetch is needed: "the result has an `IXSCAN` stage that is not a descendant of a `FETCH` stage, and in the `executionStats`, the value of `totalDocsExamined` is 0." Getting one usually means projecting away `_id` unless it's part of the index.

If the planner picks an index you don't want, `hint()` forces a specific one — with the book's caveat: run `explain` on the hinted query before deploying, because forcing an index MongoDB doesn't know how to use well can make the query slower than it was.

### When not to index, and what indexes are bad at

Not every field deserves an index, and not every query is better with one.

**Low cardinality kills selectivity.** Cardinality is how many distinct values a field has. `gender` or `newsletter_opt_out` have two; `username` or `email` have one per document. "In general, the greater the cardinality of a field, the more helpful an index on that field can be." An index on `gender` narrows a search for women named Susan by about 50% before it has to start reading documents; an index on `name` narrows it to a handful immediately. Rule of thumb: index high-cardinality keys, or at least put them before low-cardinality keys in a compound index.

**Large result sets are faster without an index.** An index lookup is two reads — the index entry, then the document. A collection scan is one. "In the worst case (returning all of the documents in a collection) using an index would take twice as many lookups and would generally be significantly slower than a collection scan." The book's rule of thumb is that an index often *stops* helping once the query returns 30% or more of the collection, while noting the real crossover ranges anywhere from 2% to 60% depending on document size and result set. Indexes suit large collections, large documents, and selective queries; collection scans suit small collections, small documents, and nonselective queries.

**Negation is inefficient.** `$ne` can use an index but must scan everything on both sides of the excluded value. `$not` can sometimes reverse a simple range or regex but usually falls back to a scan, and `$nin` always scans. Prefer `$in` over `$or`, since `$or` runs a separate `IXSCAN` per clause and then has to deduplicate the merged results.

### Unique and partial indexes

A **unique index** guarantees each value appears at most once; a duplicate insert fails with error code `11000`, `E11000 duplicate key error`. The `_id` index is exactly this — an ordinary unique index, except that it can't be dropped. Two things to know: building a unique index on a collection that already contains duplicates simply fails, and unique constraints are a correctness tool, not a filter — "use the unique constraint for the occasional duplicate, not to filter out zillions of duplicates a second."

The classic trap: a missing field is indexed as `null`, so a plain unique index rejects the *second* document that omits the field. **Partial indexes** are the fix — pass `partialFilterExpression` so only matching documents are indexed at all:

```js
db.users.createIndex(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true } } }
);
```

Partial indexes don't have to be unique — drop the `unique` option for a plain one. The book flags one genuinely surprising consequence: the same query can return *different results* depending on whether it uses the partial index, because documents excluded from the index are invisible to a plan that scans it. Their example: with a partial index on `x`, `find({"x": {"$ne": 2}})` stops returning the document that has no `x` field at all. If you need those documents, `hint` the query into a collection scan.

MongoDB's partial indexes are a superset of sparse indexes, and the book is careful to note they are *not* the same thing as an RDBMS sparse index: "Partial indexes in MongoDB are only created on a subset of the data. This is unlike sparse indexes on relational databases, which create fewer index entries pointing to a block of data — however, all blocks of data will have an associated sparse index entry in RDBMS."

### Index administration

`db.collection.getIndexes()` lists every index with its `key` (the field/direction spec, used for `hint`) and its `name` (the handle for `dropIndex`). Default names are `keyname1_dir1_keyname2_dir2_...`, which gets unwieldy fast, so `createIndex` accepts a `name` option. Field order is part of the identity: "an index on `{"class_id": 1, "student_id": 1}` is not the same as an index on `{"student_id": 1, "class_id": 1}`." Creating the same index twice is a no-op. `db.people.dropIndex("x_1_y_1")` removes one.

> **Book vs. today.** Two details in this chapter have aged, and both were already changing as it was written. (1) The book describes choosing between a *foreground* index build (fast, blocks all reads and writes on the database) and a `background: true` build (slower, yields periodically). MongoDB 4.2 replaced both with the **hybrid index build**, which holds an exclusive lock only at the start and end and interleaves reads and writes for the rest — the book mentions this as new; today it is the only build type, and the `background` option is gone. (2) The book says index metadata lives in a `system.indexes` collection. Direct access to `system.indexes` was deprecated back in MongoDB 3.0 in favor of the `listIndexes` command, and it isn't present under WiredTiger at all; `db.collection.getIndexes()` (which the book also shows, and which wraps `listIndexes`) and the `$indexStats` aggregation stage are the supported ways to inspect indexes today. A third detail did *not* change in the direction you might expect: the pre-4.2 1,024-byte index key length limit was lifted in 4.2, exactly as the book says, so oversized keys no longer silently drop out of an index.

## Trade-offs

- **Every index is a permanent tax on every write.** The book states it once, plainly, and it governs everything else: "write operations (inserts, updates, and deletes) that modify an indexed field will take longer... in addition to updating the document, MongoDB has to update indexes when your data changes." That cost is the B-tree maintenance you watched in the animation — descend, insert, possibly split — repeated per index, per write. Ten indexes on a hot collection means ten trees to keep balanced on every insert. Over-indexing is a real production failure mode, and it shows up as degraded write throughput long before anyone thinks to look at the index list.
- **Compound-index field order matters more than the number of indexes.** The 4,325 ms → 37 ms swing in the book's student example came from reordering two fields in a single index, not from adding one. Equality first, sort next, range last (the ESR ordering). Get it backwards and you get an index that is *used* — `explain` shows a happy `IXSCAN` — while scanning 86× more keys than it returns. `totalKeysExamined` vs. `nReturned` is the number that exposes this; `stage: "IXSCAN"` alone proves nothing.
- **A prefix is free; a non-prefix subset is nothing.** One compound index on `{a, b, c}` covers `{a}`, `{a, b}`, and `{a, b, c}` at no extra cost — genuinely three indexes for the price of one, and the main reason to consolidate. But a query on `{b}` or `{a, c}` gets no benefit at all and needs its own index. The temptation is to "just add another index" for each new query shape; the discipline is to check first whether reordering an existing compound index makes both shapes prefixes of one tree.
- **Avoiding an in-memory sort costs extra key scans, on purpose.** Putting the sort field before the range field means examining more index keys than you return (9,905 for 9,903 in the book's example). That is a deliberately bad-looking selectivity ratio bought in exchange for eliminating a `SORT` stage — worth it, because in-memory sorts scale with result size and hard-fail at 32 MB, while extra key scans scale gently.
- **Indexing a low-cardinality field usually buys nothing and still costs writes.** A boolean or two-value enum can't narrow a search meaningfully, so you pay the full write tax for roughly a 50% reduction in documents examined. If such a field must be indexed, put it after a high-cardinality key in a compound index rather than giving it one of its own.
- **Unique indexes trade write throughput for a correctness guarantee, and the null case will bite you.** Duplicate-key exceptions are expensive to throw, so a unique index is a constraint, not a dedup mechanism. And because a missing field indexes as `null`, "unique" silently means "at most one document may omit this field" unless you add a `partialFilterExpression` — which then introduces its own subtlety, since documents outside the partial filter become invisible to any plan that uses that index.
- **Building the index before a bulk load is slower than building it after.** The book's closing note — "creating indexes on existing documents is slightly faster than creating the index first and then inserting all documents" — falls straight out of the B-tree mechanics: a pre-existing index forces every one of those inserts through its own descend-and-split path, while a post-hoc build constructs the tree from data already on disk. On a large migration or import, the ordering is worth several minutes.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 5, "Indexes", p. 96-153](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) — doc
- [MongoDB Documentation — Indexes](https://www.mongodb.com/docs/manual/indexes/) — doc
- [MongoDB Documentation — Compound Indexes](https://www.mongodb.com/docs/manual/core/index-compound/) — doc
- [MongoDB Documentation — The ESR (Equality, Sort, Range) Rule](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/) — doc
- [MongoDB Documentation — Analyze Query Performance and explain Results](https://www.mongodb.com/docs/manual/reference/explain-results/) — doc
- [MongoDB Documentation — Partial Indexes](https://www.mongodb.com/docs/manual/core/index-partial/) — doc
- [MongoDB Documentation — WiredTiger Storage Engine](https://www.mongodb.com/docs/manual/core/wiredtiger/) — doc
