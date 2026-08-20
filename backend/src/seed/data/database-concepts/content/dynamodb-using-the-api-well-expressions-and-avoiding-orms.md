---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the mechanism underneath every DynamoDB API call: expressions. "Expressions are statements that operate on your items. They're sort of like mini-SQL statements," and there are five of them — `KeyConditionExpression`, `FilterExpression`, `ProjectionExpression`, `ConditionExpression`, and `UpdateExpression` — each scoped to a specific operation and a specific job. Understand the two placeholder syntaxes that carry every expression (`#name` for attribute names, `:value` for attribute values) and *why* DynamoDB forces that split rather than letting you write values inline. Then take the book's sharpest opinion in this pair of chapters at face value: "I would not recommend using an ODM in DynamoDB" — and understand the two narrow exceptions it carves out, because those exceptions are where the field has moved the most since 2020.

## Use Cases

- Fetching a bounded range off a sort key — orders between two dates, movie titles starting with a letter — via a `KeyConditionExpression`, which is the only expression type restricted to primary-key attributes.
- Trimming payload size when the key condition alone would return items you don't need — filtering Tom Hanks' roles down to just the dramas with a `FilterExpression` — while accepting it doesn't reduce what DynamoDB reads or bills.
- Fetching items with a large or sensitive attribute (a binary image blob, a rarely-needed audit field) but excluding that attribute from the response using a `ProjectionExpression`.
- Enforcing a uniqueness constraint on write — "over 90% of my `PutItem` requests include condition expressions to assert there is not an existing item with the same primary key" — via `attribute_not_exists()` in a `ConditionExpression`.
- Guarding a business invariant at write time without a prior read — refusing to drop an account balance below zero, or capping an in-progress job counter at 10 with `size(#inprogress) <= 10` — instead of reading the item, checking in application code, and racing another request.
- Verifying permissions inline with a mutation — asserting a user is in an `Admins` set via `contains()` before allowing a subscription change — or across two different items at once, using a `ConditionCheck` inside a `TransactWriteItems` call.
- Incrementing or decrementing a counter atomically (`SET #views = #views + :inc`) or updating a single nested map field (`SET #phone.#mobile = :cell`) without a read-modify-write round trip, via `UpdateExpression`.
- Adding or removing a member of a set attribute — admins, tags, followers — idempotently with the `ADD`/`DELETE` verbs, so retries and duplicate requests don't corrupt the set.
- Deciding, before reaching for a client library, whether a thin type-marshaling wrapper (a Document Client) is enough, or whether an access-patterns-first modeling helper is warranted — and ruling out a relational-style ORM either way.

## Deep Dive

### The placeholder syntax: why `#name` and `:value` exist

Every expression in DynamoDB is a short string glued to two side-channel parameters. A `Query` for Tom Hanks' roles in movies between "A" and "M" looks like this:

```python
items = client.query(
    TableName='MoviesAndActors',
    KeyConditionExpression='#actor = :actor AND #movie BETWEEN :a AND :m',
    ExpressionAttributeNames={
        '#actor': 'Actor',
        '#movie': 'Movie'
    },
    ExpressionAttributeValues={
        ':actor': {'S': 'Tom Hanks'},
        ':a': {'S': 'A'},
        ':m': {'S': 'M'}
    }
)
```

The `:`-prefixed tokens are expression attribute *values*. They exist because "each attribute value in DynamoDB has a type. DynamoDB does not infer this type — you must explicitly provide it when you make a request." If you tried to inline the value instead — `KeyConditionExpression: "#actor = { 'S': 'Tom Hanks' }"` — the server would have to parse brackets out of a string, "a complicated operation, particularly if you are writing a nested object with multiple levels." Splitting values into their own parameter means DynamoDB never parses them out of the expression text, and your client code can validate their shape *before* the request leaves the process.

The `#`-prefixed tokens are expression attribute *names*, and unlike values, they're optional — attribute names aren't typed, so you can write `Actor = :actor` directly. Two situations make them necessary rather than stylistic:

- **Reserved words.** DynamoDB has 573 reserved words, and ordinary-looking attribute names collide with them constantly — `Name`, `Count`, `Timestamp`, `Year`, `Bucket`. The book's own habit: "Because the list of reserved names is so long, I prefer not to check every time I'm writing an expression. In most cases, I'll use `ExpressionAttributeNames` just to be safe."
- **Nested and dotted attributes.** DynamoDB interprets a literal `.` in an expression as descending into a nested map — so an attribute whose *name* happens to contain a period, or accessing a property inside a `Map` type, needs the name placeholder to avoid DynamoDB misreading your intent.

### The five expression types, and which operation each belongs to

| Expression | Used on | Scope |
|---|---|---|
| `KeyConditionExpression` | `Query` only | Primary key attributes only |
| `FilterExpression` | `Query`, `Scan` | Any attribute, applied after the read |
| `ProjectionExpression` | All read operations | Any attribute, controls what's returned |
| `ConditionExpression` | All write operations | Any attribute, asserted before the write |
| `UpdateExpression` | `UpdateItem` only | Any attribute, describes the mutation |

**`KeyConditionExpression`** is "the expression you'll use the most" and the only one restricted to the primary key. The sort-key half accepts a real condition — `>`, `<`, `=`, `begins_with()`, or `BETWEEN` — not just an exact match, which is what makes `Query` able to return a whole ordered slice ("all orders between January 10 and January 20") in one request. The book's own habit is telling: "every condition on the sort key can be expressed with the `BETWEEN` operator. Because of that, I almost always use it in my expressions" — one operator covers `=`, `<`, `>`, and ranges alike.

**`FilterExpression`** looks like a `WHERE` clause and is available on both `Query` and `Scan`, but it runs on the *output* of the read, not as part of it. DynamoDB's actual order of operations: "First, it reads items matching your Query or Scan from the database. Second, if a filter expression is present, it filters out items from the results that don't match the filter expression. Third, it returns any remaining items to the client." Crucially, the 1MB-per-request read cap is enforced at step 1, *before* the filter runs. The book's example: a 1GB table where all matching "Drama" items total only 100KB — you might expect one request back, but "since the filter expression is not applied until after the items are read, your client will need to page through 1000 requests to properly scan your table," most of them returning empty. The verdict: "A filter expression isn't a silver bullet that will save you from modeling your data properly... it won't help you find data more quickly." Its three legitimate jobs are trimming payload size, moving a trivial filter server-side for convenience, and tightening TTL-expiry checks (since AWS's actual deletion window after TTL expiry can run up to 48 hours).

**`ProjectionExpression`** is the attribute-level version of the same idea — instead of dropping whole non-matching *items* (`FilterExpression`'s job), it drops non-selected *attributes* from items you're already getting back, useful for skipping a large blob attribute you don't need on a given call. It's subject to the identical 1MB-before-filtering caveat: a large excluded attribute still gets read off disk and counted against the cap before it's stripped from the response.

**`ConditionExpression`** is the write-side counterpart: available on every action that alters an item (`PutItem`, `UpdateItem`, `DeleteItem`, and their batch/transactional forms), it asserts something about the item's *current* state and cancels the write if the assertion is false. Beyond the comparison operators, it adds functions built for this job — `attribute_exists()`, `attribute_not_exists()` (the standard uniqueness guard), `attribute_type()`, `begins_with()`, `contains()`, and `size()`. Because the item's key is already supplied separately, a condition expression can reference *any* attribute, not just key attributes — unlike `KeyConditionExpression`. The book's point about *why* this matters: without it, "you would need to add costly additional requests to fetch an item before manipulating it, and you would need to consider how to handle race conditions if another request tried to manipulate your item at the same time." A `ConditionCheck` item inside `TransactWriteItems` extends the same idea across *two different items* — asserting a fact on one item (an admin-list item) while writing another (a billing-delete) — succeeding or failing as a unit.

**`UpdateExpression`** is the only expression that mutates rather than reads or asserts, and it's built from four verbs: `SET` (overwrite or create an attribute, or add/subtract on a number), `REMOVE` (delete an attribute, or a nested list/map entry), `ADD` (increment a number, or insert into a set), and `DELETE` (remove an element from a set). Multiple clauses under one verb are comma-separated; multiple verbs in one expression need no separator beyond the verb keywords themselves — `SET Name = :name, UpdatedAt = :updatedAt REMOVE InProgress` is valid as written. Two patterns pull real weight here: `SET #views = #views + :inc` increments a counter server-side, atomically, with no read-then-write race window; and `SET #phone.#mobile = :cell` writes one field inside a nested map without overwriting the whole attribute. One note for readers of the book directly: its own text defines `DELETE` as the verb for "removing an element from a set attribute," but its worked example for removing an admin from a set writes `UpdateExpression="REMOVE #a :user"` — that's an inconsistency with the book's own definition just above it, not a variant syntax to copy (more in "Book vs today" below).

### "Don't use an ORM" — the book's argument, and where it still holds

The book's stance on object-relational (or, for a document store, object-*document*) mappers is unambiguous: "Regardless, I would not recommend using an ODM in DynamoDB... There's not a great term here." It gives two reasons, both worth quoting directly because they're the load-bearing part of this chapter:

> "First, ODMs push you to model data incorrectly. ORMs make some sense in a relational world because there's a single way to model data. Each object type will get its own table, and relations are handled via foreign keys... This isn't the case with DynamoDB. All of your object types are crammed into a single table, and sometimes you have multiple object types in a single DynamoDB item. Further, fetching an object and its related objects isn't straightforward like in SQL — it will depend heavily on the design of your primary key."

> "The second reason to avoid ODMs is that it doesn't really save you much time or code compared to the basic AWS SDK... DynamoDB is API-driven, so you'll have a native method for each API action you want to perform. Your ORM will mostly be replicating the same parameters as the AWS SDK, with no real gain in ease or readability."

Both arguments turn on the same fact this whole pair of chapters has been building toward: a relational ORM's job is to *hide* the schema behind object graphs and lazy-loaded relations, because in SQL that hiding is safe — the query planner picks a reasonable join strategy regardless of how the objects are shaped in code. In DynamoDB, the "schema" *is* the access pattern; a `Query` is only cheap because someone deliberately chose the primary key and item collection to match a specific read. An abstraction that hides that choice from the developer doesn't remove the cost, it just removes the visibility into it — the exact opposite of what a NoSQL data-modeling tool should do.

The book carves out two narrow exceptions, and this is precisely where "don't use an ORM" needs updating for today's ecosystem rather than restated verbatim:

1. **Thin type-marshaling wrappers.** The book points to the Node.js SDK's `AWS.DynamoDB.DocumentClient`, which converts `{Actor: {S: 'Tom Hanks'}}` boilerplate into plain `{Actor: 'Tom Hanks'}` — solving *only* the typed-value tedium, none of the modeling.
2. **Access-patterns-first helper libraries.** The book names Jeremy Daly's DynamoDB Toolbox — "explicitly not an ORM... it does help you define entity types in your application and map those to your DynamoDB table. It's not going to do all the work to query the table for you, but it does simplify a lot of the boilerplate." Its own summary of what makes this category acceptable where a relational-style ORM isn't: "You'll still need to model your database properly. You'll still need to understand how to translate application objects into database objects. And you'll still need to interact with the DynamoDB API yourself." A helper narrows friction; it doesn't hide the modeling decision.

### Book vs today: both exceptions have moved

Both of the book's exceptions look different in 2026, and both moves reinforce rather than undercut its argument:

- **The Document Client itself is gone.** `AWS.DynamoDB.DocumentClient` belongs to AWS SDK for JavaScript v2, which entered maintenance mode in September 2024 and reached full end-of-support in September 2025 — it's not just dated, it's unsupported. The direct successor is AWS SDK v3's modular `@aws-sdk/lib-dynamodb` package, whose `DynamoDBDocumentClient` (via `DynamoDBDocumentClient.from(ddbClient)`) provides the identical auto-marshaling behavior on top of the current `DynamoDBClient`. Same narrow job, current package — nothing about the underlying argument changes, only which import does it.
- **ElectroDB has emerged as the strongest example of category 2 the book couldn't have evaluated.** DynamoDB Toolbox itself is still active and widely used (its docs still describe a schema/query-builder layer, not a full ORM), but ElectroDB — largely built out *after* the book's 2020 release — has become the more commonly reached-for library in this exact niche, with weekly npm downloads that now exceed Toolbox's. Its own framing matches the book's test almost exactly: it compiles entity and access-pattern definitions down to "plain DynamoDB params — easy to log, inspect, and combine with whatever you already have" rather than hiding them behind an object graph. It doesn't do joins, doesn't lazy-load relations, and doesn't let you write an access pattern that wasn't modeled up front.

The test the book gives you still applies to any library in this space, old or new: does it make you *state* your access pattern, or does it let you pretend DynamoDB will figure one out for you the way a SQL planner would? The first kind is a helper; the second kind is the ORM this chapter is telling you not to use.

One more place today's tooling diverges from the book's text, worth flagging precisely because it contradicts the book's *own* definitions a few paragraphs earlier rather than just aging: current AWS documentation confirms `REMOVE` deletes an attribute entirely (or a specific list/map element) while `DELETE` is the only verb that removes elements from a set — "The DELETE action supports only Set data types." The book's set-removal example writing `UpdateExpression="REMOVE #a :user"` is a genuine inconsistency with both AWS's docs and the book's own verb table above it, not a stylistic choice to imitate.

## Trade-offs

- **`ExpressionAttributeNames` is optional but cheap insurance.** Skipping it saves a few characters when an attribute name happens not to collide with DynamoDB's 573 reserved words — until a future attribute named `Status`, `Data`, or `Year` breaks a call that worked fine for months. The book's own default ("I'll use `ExpressionAttributeNames` just to be safe") is the safer default for anyone maintaining a table over time, not just DynamoDB experts.
- **`FilterExpression` and `ProjectionExpression` reduce transfer, not cost or latency.** Both run after the 1MB read cap is already applied, so a highly selective filter over a large item collection still reads (and bills for) everything in that collection — the fix for "I need to find X" is a better key or a secondary index, not a filter bolted onto a broad `Scan` or `Query`.
- **`ConditionExpression` trades a read-then-write race window for a single atomic write, at the cost of a canceled-write error path.** Asserting `attribute_not_exists()` or a `size()` bound removes the need for a prior `GetItem` and the race condition that comes with it — but every caller must now handle "the condition failed" as a normal, expected outcome, not an exception.
- **`UpdateExpression`'s four verbs are compact but easy to reach for the wrong one.** `REMOVE` deletes an attribute outright; `DELETE` removes members from a set. The book's own worked example for removing a set member actually writes `REMOVE`, contradicting its own verb definitions a few pages earlier — a reminder to verify against current AWS documentation rather than pattern-match off a single book example, however authoritative the source.
- **The Document Client / `lib-dynamodb`-style wrapper is close to free — take it.** It solves exactly one problem (typed-value boilerplate) without touching how you model data, so there's little reason to write raw `{'S': ...}` objects by hand in 2026 any more than there was in 2020, just via the current SDK v3 package rather than the legacy v2 one.
- **An access-patterns-first helper (DynamoDB Toolbox, ElectroDB) buys real ergonomics but still requires doing the modeling work first.** These libraries remove boilerplate around entity definitions and marshaling, not the upfront decision of which item collections serve which access patterns — reaching for one before that design work is done just moves the same modeling mistakes into a nicer-looking API.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 5, "Using the DynamoDB API", p. 77-93, and Chapter 6, "Expressions", p. 95-119](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — DynamoDB Expressions Overview](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.html) — doc
- [AWS Documentation — Expression Attribute Names and Values](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ExpressionAttributeNames.html) — doc
- [AWS Documentation — Update Expressions (SET, REMOVE, ADD, DELETE)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html) — doc
- [AWS Documentation — Condition Expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) — doc
- [AWS Documentation — PartiQL for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.html) — doc
- [AWS SDK for JavaScript v3 — DynamoDBDocumentClient (lib-dynamodb)](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/lib-dynamodb/) — doc
- [ElectroDB — DynamoDB library documentation](https://electrodb.dev/) — doc
- [DynamoDB Toolbox — documentation](https://www.dynamodbtoolbox.com/) — doc
