---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Read documents out of MongoDB with `find` — the query document that decides *which* documents come back, the projection document that decides *which keys* come back, the `$` conditionals that express ranges, sets and negation, and the cursor that the server hands you instead of a result set. The through-line is that a MongoDB query is itself a document, which makes it expressive in ways SQL isn't and quietly surprising in a handful of places (`null`, arrays, embedded documents) where "matches" doesn't mean what it looks like it means.

## Use Cases

- Trimming a hot read path: passing a projection so a user-list endpoint ships `username` and `email` instead of the entire user document, cutting bytes on the wire and BSON decode cost on the client.
- Building a date-range report — "everyone who registered before January 1, 2007" — where an exact-match query is useless because dates are stored with millisecond precision, so a `$lt`/`$gte` range is the only sane shape.
- Migrating a schema in place: matching *either* the old numeric `user_id` *or* the new string username in one query, because `$in` accepts values of mixed types.
- Diagnosing why a query for "x between 10 and 20" returns a document whose `x` is `[5, 25]`, and reaching for `$elemMatch` once you understand why.
- Paginating an online store's search results — 50 per page, sorted by price descending — and then rewriting that pagination when page 40 starts crawling.
- Auditing a codebase for `$where` clauses, which are both a performance drag and a code-execution surface if any part of the expression is user-influenced.

## Deep Dive

### `find`, and the projection you should almost always pass

The first argument to `find` is a document specifying the query criteria. An empty query document (`{}`) matches everything, and if `find` isn't given one it defaults to `{}` — so `db.c.find()` returns every document in `c`, in batches. Adding key/value pairs restricts the search, and multiple pairs are joined implicitly: `db.users.find({"username" : "joe", "age" : 27})` reads as "condition1 AND condition2 AND … AND conditionN."

The second argument is the projection — the keys you want back. The book's stated reason to use it is concrete: it "reduces both the amount of data sent over the wire and the time and memory used to decode documents on the client side."

```js
// inclusion: only these keys (plus _id)
db.users.find({}, {"username" : 1, "email" : 1})
// { "_id" : ObjectId("4ba0f0dfd22aa494fd523620"),
//   "username" : "joe", "email" : "joe@example.com" }

// _id comes back by default unless you explicitly suppress it
db.users.find({}, {"username" : 1, "_id" : 0})
// { "username" : "joe" }

// exclusion: everything except this key
db.users.find({}, {"fatal_weakness" : 0})
```

There's a hard limitation on the query document itself: its values must be constants *as far as the database is concerned* (they can be ordinary variables in your own code). A query can't refer to another key in the same document, so `db.stock.find({"in_stock" : "this.num_sold"})` simply doesn't work. The book's advice is to restructure rather than reach for `$where`: keep `initial_stock` and `in_stock`, decrement `in_stock` on each purchase, and answer the question with a plain `db.stock.find({"in_stock" : 0})`.

### Query conditionals

`$lt`, `$lte`, `$gt`, `$gte` map to `<`, `<=`, `>`, `>=` and combine inside one field's condition document to form a range:

```js
db.users.find({"age" : {"$gte" : 18, "$lte" : 30}})

start = new Date("01/01/2007")
db.users.find({"registered" : {"$lt" : start}})
```

`$ne` ("not equal") works with any type: `db.users.find({"username" : {"$ne" : "joe"}})`.

### OR three ways — and why `$in` beats `$or`

`$in` covers multiple candidate values for a *single* key; `$or` is the general form, spanning multiple keys.

```js
db.raffle.find({"ticket_no" : {"$in" : [725, 542, 390]}})
db.users.find({"user_id" : {"$in" : [12345, "joe"]}})     // mixed types are fine
db.raffle.find({"ticket_no" : {"$nin" : [725, 542, 390]}}) // the complement

db.raffle.find({"$or" : [{"ticket_no" : 725}, {"winner" : true}]})
db.raffle.find({"$or" : [{"ticket_no" : {"$in" : [725, 542, 390]}},
                         {"winner" : true}]})              // $or can nest conditionals
```

Two rules the book states plainly. First, ordering intuition inverts between AND and OR: "With a normal AND-type query, you want to narrow down your results as far as possible in as few arguments as possible. OR-type queries are the opposite: they are most efficient if the first arguments match as many documents as possible." Second, "while `$or` will always work, use `$in` whenever possible as the query optimizer handles it more efficiently." A one-element `$in` degenerates to a plain equality match — `{ticket_no : {$in : [725]}}` matches exactly what `{ticket_no : 725}` matches.

### `$not` is a metaconditional

`$not` isn't a comparison of its own; it wraps any other criteria. The book demonstrates it against `$mod`, which matches values whose remainder after division by the first argument equals the second:

```js
db.users.find({"id_num" : {"$mod" : [5, 1]}})              // 1, 6, 11, 16, …
db.users.find({"id_num" : {"$not" : {"$mod" : [5, 1]}}})   // 2, 3, 4, 5, 7, 8, …
```

Its most useful pairing is with regular expressions — "find everything that doesn't match this pattern."

### `null` also means "missing"

This is the first place where "matches" isn't what it looks like. `null` matches itself, but it *also* matches "key does not exist," so querying a key nothing in the collection has returns the whole collection:

```js
db.c.find({"y" : null})   // documents whose y really is null
db.c.find({"z" : null})   // every document — none of them have a z at all

// only documents where the key exists AND holds null:
db.c.find({"z" : {"$eq" : null, "$exists" : true}})
```

### Regular expressions

`$regex` (or a bare `/pattern/` literal) does pattern matching on strings, with optional flags:

```js
db.users.find({"name" : {"$regex" : /joe/i}})
db.users.find({"name" : /joey?/i})
```

MongoDB uses the PCRE library, so any PCRE-legal syntax is legal here. The index behavior is the part worth memorizing: an index can be leveraged for **prefix** regular expressions — ones anchored with `^` or `\A`, like `/^joey/` — because the search collapses to the index range that prefix creates. Indexes **cannot** be used for case-insensitive searches such as `/^joey/i`. Regular expressions can also match themselves, if you ever store one as a value.

### Arrays behave like a bag of scalars, until they don't

Querying an array element works exactly like querying a scalar: `db.food.find({"fruit" : "banana"})` matches `{"fruit" : ["apple", "banana", "peach"]}`. On top of that:

- **`$all`** matches multiple elements regardless of order — `db.food.find({fruit : {$all : ["apple", "banana"]}})` returns both `["apple","banana","peach"]` and `["cherry","banana","apple"]`. A one-element `$all` is the same as a plain match.
- **Exact array match** is unforgiving in both directions: `{"fruit" : ["apple","banana","peach"]}` matches, `["apple","banana"]` (missing element) does not, and `["banana","apple","peach"]` (reordered) does not either.
- **Positional match** uses `key.index` — `db.food.find({"fruit.2" : "peach"})`, 0-indexed, so this is the third element.
- **`$size`** matches arrays of an exact length and *cannot be combined with another `$` conditional*. The book's workaround is to maintain the length yourself: change `{"$push" : {"fruit" : "strawberry"}}` to `{"$push" : {"fruit" : "strawberry"}, "$inc" : {"size" : 1}}`, then range-query `{"size" : {"$gt" : 3}}`. Incrementing is fast enough that the penalty is negligible — but the trick doesn't work well with `$addToSet`, which may or may not actually add.
- **`$slice`** is a *projection* operator: `{"comments" : {"$slice" : 10}}` for the first 10, `-10` for the last 10, `[23, 10]` to skip 23 and return the 24th through 33rd. Note the asymmetry — unlike every other projection specifier, `$slice` does not suppress unmentioned keys, so `title` and `content` still come back alongside the sliced `comments`.
- **`comments.$`** returns whichever array element matched the criteria — but only the *first* match per document.

Then the sharp edge. Scalars must satisfy every clause of a criteria document, but an array satisfies the query if *some* element matches each clause — possibly a different element per clause:

```js
// documents: {"x":5} {"x":15} {"x":25} {"x":[5,25]}
db.test.find({"x" : {"$gt" : 10, "$lt" : 20}})
// {"x" : 15}
// {"x" : [5, 25]}   <-- 25 satisfies $gt:10, 5 satisfies $lt:20
```

The book's verdict: "This makes range queries against arrays essentially useless: a range will match any multielement array." Two fixes. `$elemMatch` forces both clauses onto a single array element — at the cost of no longer matching non-array fields, so `{"x" : 15}` drops out of the result. Or, if the field is indexed, bound the index scan explicitly:

```js
db.test.find({"x" : {"$gt" : 10, "$lt" : 20}}).min({"x" : 10}).max({"x" : 20})
// {"x" : 15}
```

`min`/`max` require an index on the queried field and you must pass *all* fields of that index. The reason this matters beyond correctness: "The index bounds for a `$gt`/`$lt` query over an array is inefficient. It basically accepts any value, so it will search every index entry, not just those in the range."

### Embedded documents: dot notation, not whole-document match

Matching a full subdocument requires an *exact* match — same keys, same order. `{"name" : {"first" : "Joe", "last" : "Schmoe"}}` breaks the moment Joe adds a middle name, and `{"last" : "Schmoe", "first" : "Joe"}` doesn't match at all, because the comparison is order-sensitive. Dot notation survives schema drift:

```js
db.people.find({"name.first" : "Joe", "name.last" : "Schmoe"})
```

Dot notation is the main structural difference between query documents and stored documents — and the reason inserted documents can't contain `.` in a key. (People hit this trying to use URLs as keys; the usual workaround is a global replace of `.` on the way in and out.)

For arrays of subdocuments, the two obvious queries are both wrong. `{"comments" : {"author" : "joe", "score" : {"$gte" : 5}}}` fails because whole-subdocument matching requires every key, including `comment`. `{"comments.author" : "joe", "comments.score" : {"$gte" : 5}}` fails differently — the author clause can match one comment while the score clause matches another. `$elemMatch` is the only correct grouping:

```js
db.blog.find({"comments" : {"$elemMatch" :
                            {"author" : "joe", "score" : {"$gte" : 5}}}})
```

`$elemMatch` is only needed when there's more than one key to match inside the embedded document.

### `$where`: arbitrary JavaScript, and why the book tells you to avoid it

`$where` runs a JavaScript function per document; return `true` and the document joins the result set. Its canonical use is the thing the query language structurally can't express — comparing two fields of the same document (the `in_stock` vs. `num_sold` problem from earlier).

The book flags it on both axes, unprompted. Security: "For security, use of `$where` clauses should be highly restricted or eliminated. End users should never be allowed to execute arbitrary `$where` clauses." Performance: "`$where` queries should not be used unless strictly necessary: they are much slower than regular queries. Each document has to be converted from BSON to a JavaScript object and then run through the `$where` expression. Indexes cannot be used to satisfy a `$where` either." If you're stuck with one, pair it with ordinary query filters so an index can pre-filter and the JavaScript only fine-tunes what survives.

The book also gives you the exit: MongoDB 3.6 added `$expr`, which brings aggregation expressions into the query language, runs no JavaScript, and is "recommended as a replacement to this operator where possible."

### Cursors are lazy, chainable, batched, and mortal

`find` returns a cursor, not a result set — and calling `find` doesn't even talk to the server yet. It waits until you start requesting results, which is what makes chaining work: nearly every cursor method returns the cursor itself, so these are all identical:

```js
var cursor = db.foo.find().sort({"x" : 1}).limit(1).skip(10);
var cursor = db.foo.find().limit(1).sort({"x" : 1}).skip(10);
var cursor = db.foo.find().skip(10).limit(1).sort({"x" : 1});
```

The query only goes to the server on the first `hasNext()`. At that point the shell fetches the first 100 results or first 4 MB, whichever is smaller, so subsequent `next()`/`hasNext()` calls are local; when that batch runs out the shell issues a `getMore` for the next one, repeating until the cursor is exhausted. You iterate with `hasNext()`/`next()`, or via the JavaScript iterator interface with `forEach`.

`limit` is an upper bound only (fewer matches just return fewer documents), `skip` discards from the front, and `sort` takes a key/direction document where `1` is ascending and `-1` descending, applied left to right: `db.c.find().sort({username : 1, age : -1})`. Combined, they give you the textbook pagination shape:

```js
db.stock.find({"desc" : "mp3"}).limit(50).sort({"price" : -1})           // page 1
db.stock.find({"desc" : "mp3"}).limit(50).skip(50).sort({"price" : -1})  // page 2
```

When a key holds mixed types, sorting falls back to a fixed cross-type ordering, least to greatest: minimum value, null, numbers (integers, longs, doubles, decimals), strings, object/document, array, binary data, object ID, boolean, date, timestamp, regular expression, maximum value.

**Avoiding large skips.** Small skips are fine; large ones are not, "since it has to find and then discard all the skipped results. Most databases keep more metadata in the index to help with skips, but MongoDB does not yet support this." The fix is keyset pagination — carry the last document's sort key into the next query instead of counting past rows:

```js
var page1 = db.foo.find().sort({"date" : -1}).limit(100)
// …iterate page1, remembering `latest`…
var page2 = db.foo.find({"date" : {"$lt" : latest.date}});
page2.sort({"date" : -1}).limit(100);
```

The same reasoning kills the naive "random document" recipe (`count()`, then `skip(Math.floor(Math.random()*total)).limit(1)`) — an expensive count plus a large skip. The book's alternative is to store a `random : Math.random()` field on insert and query `{"random" : {"$gt" : random}}`, falling back to `$lte` when the draw lands above every stored value, with `random` as the trailing field of a compound index (`{"profession" : 1, "state" : 1, "random" : 1}`) so it composes with real filters.

**Immortal cursors.** Server-side, a cursor holds memory and resources. It dies in one of three ways: it finishes iterating; the client-side cursor goes out of scope and the driver sends a kill message; or 10 minutes of inactivity pass and the database times it out. That last one is a safety net for crashed or buggy clients. Drivers expose an `immortal`-style option to disable the timeout for genuinely long-lived cursors — and if you use it, "you must iterate through all of its results or kill it to make sure it gets closed. Otherwise, it will sit around in the database hogging resources until the server is restarted."

### Book vs. today

The querying semantics in this chapter are stable — `$in`/`$or`/`$not`/`$elemMatch`, the `null`-matches-missing rule, the array range-query trap, the cross-type sort order, and the `$where` warnings all still read as current documentation. Three surface details have moved since the book (2019/2020, written against MongoDB 4.2), and none of them change the ideas above:

> The book's shell-side batch numbers ("first 100 results or first 4 MB") are now documented server-side as an initial batch of **101 documents**, with subsequent `getMore` batches bounded only by the 16 MB maximum message size. The mechanism — a lazy first round trip, then `getMore` until exhaustion — is unchanged.

> The `$size` workaround snippet uses `db.food.update(...)`, and the random-document section uses `db.people.ensureIndex(...)` and `db.foo.count()`. All three are legacy spellings today: `updateOne`/`updateMany`, `createIndex`, and `countDocuments`/`estimatedDocumentCount`. This is a rename, not a behavior change — and elsewhere the same chapter already uses the modern `insertOne`/`findOne`.

> For "give me a random document," the aggregation stage `{$sample : {size : 1}}` is the current idiom and does the job without the stored-random-key trick. That stage isn't mentioned anywhere in this chapter, so treat the book's recipe as an indexed-query pattern worth understanding rather than the first thing to reach for.

## Trade-offs

- **`$where` is the one operator in this chapter with a security story, not just a performance one.** It executes arbitrary JavaScript server-side, per document, after a BSON-to-JavaScript conversion, and no index can satisfy it — so the cost scales with the whole candidate set. The book's own guidance is to restrict or eliminate it and to never let end users supply one. `$expr` covers the common motivation (comparing two fields of the same document) with no JavaScript at all; the residual cases where only `$where` works are rare enough that finding one in a code review is usually a schema smell — the `initial_stock`/`in_stock` restructuring is the real fix.
- **Large `skip()` degrades exactly the way SQL's `OFFSET` does, for exactly the same reason.** Both must produce and discard every skipped row before returning anything, so page 400 costs roughly 400 pages of work. The book is explicit that MongoDB doesn't keep the index metadata that would make this cheaper. This is the same trap covered on the relational side in [SQL: Pagination, Top-N, and Extremes per Group](/database-concepts/sql-pagination-top-n-and-extremes-per-group) — and the escape is the same in both worlds: keyset (seek) pagination on the sort key, carrying `$lt : latest.date` (or `WHERE date < :last_seen`) instead of an offset. The trade you accept is that keyset pagination can't jump to an arbitrary page number and needs a genuinely unique sort key to avoid skipped or duplicated rows at page boundaries.
- **The convenience of "arrays query like scalars" is paid for by range queries that silently over-match.** `{"x" : {"$gt" : 10, "$lt" : 20}}` returning `[5, 25]` isn't a bug, it's the documented per-clause element matching — but it means any multielement array matches almost any range. `$elemMatch` fixes correctness and *breaks* mixed scalar/array fields by excluding non-arrays; `min`/`max` fixes it without that side effect but demands an index and every one of its fields. The cheapest fix is usually upstream: don't mix scalars and arrays in the same field.
- **`null` conflating "is null" with "is absent" is a genuine modeling decision, not just a gotcha.** In a fixed relational schema, `NULL` and "no such column" can't be confused; in a dynamic schema they collapse into one query result. If the distinction matters to your domain — "we asked and they said nothing" versus "we never asked" — the `{"$eq" : null, "$exists" : true}` form has to be in the query, and every query written by someone who forgot it will quietly return the wrong set.
- **Everything in this chapter is written blind — there's no query planner visibility yet.** You can tell that `$in` is optimized better than `$or`, that prefix regexes can use an index and case-insensitive ones can't, and that `$gt`/`$lt` over arrays scans every index entry, only because the book tells you so. Nothing here shows you which index a query actually chose or how many documents it examined to return ten. That's what indexing and `explain()` are for — see [MongoDB Indexing Fundamentals and Compound Indexes](/database-concepts/mongodb-indexing-fundamentals) — and it's why the performance advice in this chapter should be treated as heuristics to verify, not as measurements.
- **Projections are nearly free to add and easy to forget.** The book's justification is bytes on the wire plus client-side decode time, both of which scale with document size — so the payoff is largest on exactly the wide documents a dynamic schema encourages. The one exception to "projections narrow the result" is `$slice`, which returns all other keys as well; mixing it with inclusion specifiers without knowing that produces documents fatter than intended.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 4, "Querying", p. 74-93](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) — doc
- [MongoDB Documentation — Query Documents](https://www.mongodb.com/docs/manual/tutorial/query-documents/) — doc
- [MongoDB Documentation — Query and Projection Operators](https://www.mongodb.com/docs/manual/reference/operator/query/) — doc
- [MongoDB Documentation — Iterate a Cursor](https://www.mongodb.com/docs/manual/tutorial/iterate-a-cursor/) — doc
- [MongoDB Documentation — BSON Comparison Order](https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/) — doc
- [MongoDB Documentation — $where](https://www.mongodb.com/docs/manual/reference/operator/query/where/) — doc
