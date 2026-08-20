---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand MongoDB's write path — `insertOne`/`insertMany`, `deleteOne`/`deleteMany`/`drop`, and `updateOne`/`updateMany`/`replaceOne` — and, above all, the single distinction that causes the most damage in practice: whether the second argument to a write is a *replacement document* or a *modifier document* made of `$`-operators. Along the way: what an upsert actually does (it builds the new document out of your filter plus your modifiers), and why `findOneAndUpdate` exists at all instead of "query, then update."

## Use Cases

- Bulk-loading a few thousand documents in one round trip with `insertMany` instead of one insert per document, and choosing ordered vs. unordered so that one bad document doesn't silently discard the rest of the batch.
- Incrementing a counter (page views, score, karma, vote count) without a read-modify-write cycle in the application — `$inc` applies server-side and atomically, so concurrent requests don't lose updates.
- Idempotent "record this event, creating the row if it's the first one" writes — an upsert collapses `findOne` + branch + `insertOne`/`update` into one atomic statement and removes the race where two processes both decide the document doesn't exist yet.
- Schema migration on live data: `replaceOne` to restructure one document wholesale, `updateMany` with `$set` to roll a new field out to every document matching a filter.
- Job-queue / work-claiming: `findOneAndUpdate` with a `sort` atomically claims the highest-priority pending item and hands it back to exactly one worker.

## Deep Dive

### Inserting: `insertOne`, `insertMany`, and ordered vs. unordered batches

`insertOne` adds a single document and, if you did not supply one, adds an `_id` key before storing it:

```js
db.movies.insertOne({"title" : "Stand by Me"})
```

`insertMany` takes an array and inserts it in bulk — the book's point is round trips: your code makes one trip to the server instead of one per document, and "sending dozens, hundreds, or even thousands of documents at a time can make inserts significantly faster." The shell echoes back an `insertedIds` array of the generated `ObjectId`s.

The second parameter is an options document, and the interesting key is `ordered`. **Ordered is the default.** With ordered inserts, the array defines insertion order and *nothing past the first failure is inserted*. The book's example inserts four movies where the third reuses `"_id" : 1`:

```js
db.movies.insertMany([
  {"_id" : 0, "title" : "Top Gun"},
  {"_id" : 1, "title" : "Back to the Future"},
  {"_id" : 1, "title" : "Gremlins"},          // duplicate _id
  {"_id" : 2, "title" : "Aliens"}])
```

That throws a `BulkWriteError` with `code: 11000` (`E11000 duplicate key error`) at `"index" : 2`, and reports `"nInserted" : 2` — "Aliens" never made it in, even though nothing was wrong with it. Re-run the same shape with `{"ordered" : false}` and MongoDB attempts every document regardless: same duplicate-key write error at index 2, but `"nInserted" : 3`. Unordered also lets MongoDB reorder the inserts to increase performance.

The book notes the batch is size-capped: "Current versions of MongoDB do not accept messages longer than 48 MB," and many drivers split an oversized batch into multiple 48 MB batch inserts for you. It also points out that `insertMany` is insert-only — batching *different* operation types together is the separate Bulk Write API, out of scope for the chapter.

### Insert validation is minimal on purpose

MongoDB "does minimal checks on data being inserted: it checks the document's basic structure and adds an `_id` field if one does not exist." The main structural check is size — **every document must be smaller than 16 MB**, a limit the book calls "somewhat arbitrary," intended to prevent bad schema design and keep performance consistent. For scale, the book's yardstick is that the entire text of *War and Peace* is 3.14 MB. `Object.bsonsize(doc)` prints a document's BSON size in bytes from the shell.

The consequence the book draws from "minimal checks" is a security one, not a modelling one: it is easy to insert invalid data if you're trying to, so **only trusted sources — your application servers — should be able to connect to the database.** The drivers, not the server, are what reject oversized documents, non-UTF-8 strings, and unrecognized types before anything is sent.

### Removing: `deleteOne`, `deleteMany`, and `drop`

Both take a filter document as the first parameter. `deleteOne({"_id" : 4})` returns `{ "acknowledged" : true, "deletedCount" : 1 }`. The sharp edge is a filter that matches more than one document: `deleteOne` deletes *the first document found*, and which one that is "depends on several factors, including the order in which the documents were inserted, what updates were made to the documents (for some storage engines), and what indexes are specified" — i.e. it is not something you should reason about, only something you should avoid relying on.

`deleteMany` removes everything matching, including `deleteMany({})` for the whole collection. But if the goal is an empty collection, `drop()` is faster — at the cost of having to recreate the collection's indexes afterward. Either way: "Once data has been removed, it is gone forever." There is no undo short of restoring a backup.

### Document replacement vs. update operators

Three update methods, and the difference is entirely in the second argument:

- `replaceOne(filter, doc)` — second argument is a **whole document** that replaces the match.
- `updateOne(filter, modifiers)` / `updateMany(filter, modifiers)` — second argument is a **modifier document** of `$`-operators describing changes.

Updating a document is atomic: if two updates arrive at once, whichever reaches the server first is applied, then the next — "the last update will 'win'," with no document corruption. (If last-write-wins isn't what you want, the book points to the Document Versioning schema-design pattern.)

`replaceOne` is the tool for a wholesale restructure — the book's example pulls a user document into the shell, moves `friends`/`enemies` into a `relationships` subdocument, renames `name` to `username`, and writes the reshaped object back. Its trap is worth memorizing:

```js
// three documents all have {"name" : "joe"}
joe = db.people.findOne({"name" : "joe", "age" : 20});
joe.age++;
db.people.replaceOne({"name" : "joe"}, joe);   // E11001 duplicate key on update
```

The filter matched the *65-year-old* Joe first, and MongoDB tried to overwrite him with a document carrying a different existing `_id`. The fix is to always filter on something unique — usually `_id`, which is also the most efficient filter since `_id` values back the collection's primary index.

For everything short of a full restructure, use update operators. `$inc` on a page-view counter is the canonical example:

```js
db.analytics.updateOne({"url" : "www.example.com"}, {"$inc" : {"pageviews" : 1}})
// { "acknowledged" : true, "matchedCount" : 1, "modifiedCount" : 1 }
```

The operators the chapter covers:

| Operator | Behavior worth remembering |
|---|---|
| `$set` | Sets a field, **creating it if absent**, and can change the field's *type* — the book turns a `"favorite book"` string into an array with a single `$set`. Reaches into subdocuments by dotted path (`"author.name"`). |
| `$unset` | Removes the key entirely: `{"$unset" : {"favorite book" : 1}}`. |
| `$inc` | Creates the key set to the increment if absent (`score` goes `0 → 50 → 10050` in the pinball example). Works **only** on integer, long, double, or decimal — applying it to a string `"1"` fails with code `16837`, "Cannot apply $inc to a value of non-numeric type", and the increment value itself must be a number. |
| `$push` | Appends to an array, creating the array if it doesn't exist. Modifiers: `$each` (push several), `$slice` with a negative value (cap the array — `-10` keeps a "top 10" queue), `$sort` (order before trimming). `$slice` and `$sort` require `$each`; you cannot use them alone. |
| `$addToSet` | Push-if-absent, treating the array as a set. Combines with `$each` to add several unique values at once — something the older `{"$ne" : ...}` filter plus `$push` idiom cannot do. |
| `$pop` | `{"$pop" : {"key" : 1}}` from the end, `-1` from the beginning. |
| `$pull` | Removes **every** matching element, not just the first — pulling `1` from `[1, 1, 2, 1]` leaves `[2]`. |
| `$setOnInsert` | Applies only when an upsert actually inserts (see below). |

Two rules that cover most beginner errors. First, **you must always use a `$`-modifier** for adding, changing, or removing keys — `updateOne({"author.name" : "joe"}, {"author.name" : "joe schmoe"})` is an error, and the book is explicit that this was the motivation for the current CRUD API: "Previous versions of the CRUD API did not catch this type of error. Earlier update methods would simply complete a whole document replacement in such situations." Second, array operators only work on array-valued keys; use `$set`/`$inc` for scalars.

For positional array edits there are three levels. A literal index works as a dotted path (`"comments.0.votes"`), but you rarely know the index without querying first. The positional operator `$` fills in the index the *filter* matched — and updates **only the first match**, so a user with two comments gets one of them renamed:

```js
db.blog.updateOne({"comments.author" : "John"}, {"$set" : {"comments.$.author" : "Jim"}})
```

MongoDB 3.6 added `arrayFilters` for "every element matching a predicate," which is what the positional operator can't express:

```js
db.blog.updateOne(
   {"post" : post_id },
   { $set: { "comments.$[elem].hidden" : true } },
   { arrayFilters: [ { "elem.votes": { $lte: -5 } } ] }
)
```

### Upserts: what they actually build

"If no document is found that matches the filter, a new document will be created by combining the criteria and updated documents. If a matching document is found, it will be updated normally." Upsert is the third parameter's `upsert: true`, and its value is that it removes both the round trip and the race in the check-then-act version:

```js
// the version an upsert replaces — one read, one write, and a race between processes
blog = db.analytics.findOne({url : "/blog"})
if (blog) { blog.pageviews++; db.analytics.save(blog); }
else      { db.analytics.insertOne({url : "/blog", pageviews : 1}) }

// the same thing, "faster and atomic"
db.analytics.updateOne({"url" : "/blog"}, {"$inc" : {"pageviews" : 1}}, {"upsert" : true})
```

The "combining the criteria and updated documents" part is not decoration — the new document is *built from the filter*, then the modifiers are applied on top. The book's example is unusually instructive: `db.users.updateOne({"rep" : 25}, {"$inc" : {"rep" : 3}}, {"upsert" : true})` on an empty collection creates a document with `rep: 25` from the filter and then increments it, leaving `rep: 28`. Run the identical command again and it inserts *another* document — because the filter `{"rep" : 25}` doesn't match the document it just made, whose `rep` is now 28.

`$setOnInsert` covers "set this field when created, never touch it again":

```js
db.users.updateOne({}, {"$setOnInsert" : {"createdAt" : new Date()}}, {"upsert" : true})
```

First run inserts and stamps `createdAt`. Second run matches (`matchedCount: 1`, `modifiedCount: 0`) and leaves the original timestamp alone. The book adds a caveat about its own example: you generally don't need a `createdAt` field at all, since `ObjectId`s already embed a creation timestamp — `$setOnInsert` earns its keep for padding, initializing counters, and collections that don't use `ObjectId`s.

### Updating many documents, and getting the document back

`updateOne` modifies only the first match; `updateMany` takes the same parameters with the same semantics and modifies all of them — the book frames it as the schema-migration and feature-rollout tool (`updateMany({"birthday" : "10/13/1978"}, {"$set" : {"gift" : "Happy Birthday!"}})` returning `matchedCount: 3, modifiedCount: 3`).

When you need the document back atomically, the point is a race the chapter walks through in detail. Claiming a job by "find the highest-priority `READY` process, then update it to `RUNNING`" lets two threads read the same document before either writes, so both run the same job. Guarding it by re-checking `"status" : "READY"` inside the update filter and looping works but "becomes complex," and can degenerate into one thread doing all the work while another uselessly trails it.

`findOneAndUpdate` does the whole thing in one operation:

```js
db.processes.findOneAndUpdate(
   {"status" : "READY"},
   {"$set" : {"status" : "RUNNING"}},
   {"sort" : {"priority" : -1}, "returnNewDocument": true})
```

Note the default: **`findOneAndUpdate` returns the document as it was *before* modification.** Without `returnNewDocument: true` the returned document still shows `"status" : "READY"`, which reads like the update silently failed. `findOneAndReplace` behaves the same way around a replacement; `findOneAndDelete` takes no update document and returns the deleted one.

MongoDB 3.2 introduced these three methods to replace `findAndModify`, which the book calls "prone to user error because it's a complex method combining the functionality of three different types of operations: delete, replace, and update (including upserts)." MongoDB 4.2 extended `findOneAndUpdate` to accept an aggregation pipeline as the update, limited to `$addFields` (alias `$set`), `$project` (alias `$unset`), and `$replaceRoot` (alias `$replaceWith`).

### Book vs. today: the shell changed, the operators didn't

The chapter's *semantics* have held up: `$set`, `$inc`, `$push`/`$each`/`$slice`/`$sort`, `$addToSet`, `$pop`, `$pull`, `$setOnInsert`, `arrayFilters`, `ordered`, and `upsert` all work exactly as written. The book was already steering readers away from the legacy names — it says explicitly that `insert` and `remove` predate the 3.0 CRUD API and "should not be used in applications going forward." Three deltas since 2019 are worth knowing:

> **The shell itself was replaced.** The book's transcripts (`WriteResult({...})` output, `db.collection.save()`) come from the legacy `mongo` shell, which was deprecated in MongoDB 5.0 and **removed in MongoDB 6.0** in favor of `mongosh`. `mongosh` still accepts `insert()`, `update()`, `remove()`, and `save()`, but MongoDB's own compatibility page now lists all four as **deprecated** with named replacements — so the `save` shell helper the book presents as a convenience is a method to read in old code, not one to write today. Its documented replacements are `insertOne`/`insertMany`/`updateOne`/`updateMany`/`findOneAndUpdate`; the book already shows the direct equivalent, `replaceOne({"_id" : x._id}, x)`.

> **`returnNewDocument` gained a clearer spelling.** The book's `{"returnNewDocument": true}` still works, but current MongoDB documents `returnDocument: "before" | "after"` as the alternative (added in `mongosh` 0.13.2, and the spelling the language drivers use). If both are set, `returnDocument` wins. This is a rename with a compatibility shim, not a deprecation — but new code should use `returnDocument`.

> **The batch limit is now documented as a write count, not a byte count.** The book's "48 MB messages" is still the wire-protocol ceiling, but the current *Operational Limits* page frames the user-facing rule as a maximum of **100,000 writes in a single batch**, with the driver splitting anything larger into smaller groups. The 16 MB per-document limit the book calls "somewhat arbitrary (and may be raised in the future)" has not moved — it is still 16 MB.

## Trade-offs

- **Upserts are idempotent only if the filter matches what the modifiers produce.** The `{"rep" : 25}` + `{"$inc" : {"rep" : 3}}` example is the whole hazard in three lines: re-running it doesn't update the document it created, it creates a second one, because the filter no longer matches the document after its own modification. An upsert whose filter keys are also mutated by the update is a duplicate-document generator, not an idempotent write. Upsert filters should be on stable identity fields only.
- **`upsert: true` silently converts "I meant to update an existing document" into "I created a new one."** A plain `updateOne` with a typo in the filter returns `matchedCount: 0` — a loud, checkable signal that something is wrong. Add `upsert: true` and the same typo inserts a fresh, half-populated document built out of the wrong filter, and the write reports success. The convenience of not seeding your collection is paid for with the loss of the "nothing matched" failure mode.
- **Replacement vs. modifier is a one-character difference with a whole-document blast radius.** `replaceOne(filter, doc)` drops every field not present in `doc`; `updateOne(filter, {$set: {...}})` touches only what you name. The book's own account of *why* the CRUD API was redesigned is that the earlier `update` method, handed a document with no `$`-operators, performed a full replacement instead of erroring — which is exactly how fields disappear. `updateOne` now rejects an operator-less update document; `replaceOne` will happily do what you literally asked.
- **Each write is atomic on one document; nothing here is atomic across documents.** `$inc` on a single counter is safe under concurrency without any application locking, and `findOneAndUpdate` genuinely eliminates the claim-a-job race. But `updateMany` across three documents is three separate atomic writes, not one transaction — a reader can observe the collection halfway through, and a failure partway leaves the earlier documents changed. Multi-document atomicity requires an explicit MongoDB transaction, which is a different feature with a different cost.
- **Ordered inserts fail safe; unordered inserts fail fast — and they lose different data.** Ordered stops at the first error, so a bad document at index 2 of 10,000 silently drops 9,997 good ones. Unordered inserts everything valid and reports the failures, but MongoDB may reorder the batch, so you cannot rely on insertion order for anything downstream. Either way, `insertMany` throws on partial failure — inspecting `nInserted` and the `writeErrors` array matters more than catching the exception.
- **`deleteOne` with a non-unique filter is undefined behavior in practice.** Which document goes depends on insertion order, prior updates, and the indexes available. The same reasoning applies to `updateOne` and `findOneAndUpdate` — a filter that matches multiple documents makes the *choice* an implementation detail, and only `_id` (or a genuinely unique key) makes the operation deterministic.
- **`drop()` is faster than `deleteMany({})`, and both are irreversible.** `drop` also takes the collection's indexes with it, so any index the workload depends on has to be recreated on the now-empty collection. There is no undo for either; recovery means restoring a backup.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 3, "Creating, Updating, and Deleting Documents", p. 29-51](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) — doc
- [MongoDB Documentation — Insert Documents](https://www.mongodb.com/docs/manual/tutorial/insert-documents/) — doc
- [MongoDB Documentation — Update Documents](https://www.mongodb.com/docs/manual/tutorial/update-documents/) — doc
- [MongoDB Documentation — db.collection.findOneAndUpdate() (returnDocument vs. returnNewDocument)](https://www.mongodb.com/docs/manual/reference/method/db.collection.findOneAndUpdate/) — doc
- [MongoDB Documentation — $setOnInsert](https://www.mongodb.com/docs/manual/reference/operator/update/setOnInsert/) — doc
- [mongosh Documentation — Compatibility Changes with Legacy mongo Shell (deprecated insert/update/remove/save)](https://www.mongodb.com/docs/mongodb-shell/reference/compatibility/) — doc
- [MongoDB Documentation — Operational Limits (16 MB BSON document, 100,000 writes per batch)](https://www.mongodb.com/docs/manual/reference/limits/) — doc
