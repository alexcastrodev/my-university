---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the five words the rest of DynamoDB is built out of — table, item, attribute, primary key, secondary index — and then go one level deeper on the two that actually decide whether your model works: the primary key (simple vs. composite, partition key vs. sort key) and the **item collection**, which the book calls "one of the most important yet underdiscussed concepts in DynamoDB." The through-line is a single sentence from the chapter's conclusion: "Almost all of your data modeling will be focused on designing the right primary key and secondary indexes so that you're building the item collections to handle your needs."

## Use Cases

- Onboarding an engineer whose mental model is `CREATE TABLE` + `JOIN`, and needing the precise points where the vocabulary lines up (item ≈ row, attribute ≈ column value) and where it deliberately doesn't (one table holds several entity types; no schema is declared; there is no join).
- Deciding, for a new table, whether the primary key should be **simple** or **composite** — the book's rule is mechanical, not aesthetic: a simple key gets you exactly one item at a time, a composite key gets you the `Query` API and therefore "fetch many."
- Choosing between a local and a global secondary index on a table you're about to create, when the LSI decision is irreversible after `CreateTable` and the GSI decision isn't.
- Debugging a `Query` that "should" work but returns nothing or throws — usually because the caller supplied a sort-key condition without an exact partition key, which is not a thing `Query` can do.
- Explaining to a team why a `Scan` that filters on `Status = 'ACTIVE'` is not the DynamoDB equivalent of a `WHERE` clause, and why the fix is a different item collection rather than a better filter.
- Reviewing a design where one partition key value is about to receive most of the traffic (a `TENANT#` key for your one enormous customer, a `DAY#2026-08-20` key for today's writes) and needing the partition-level vocabulary to make the risk concrete.

## Deep Dive

### The five basic concepts

**Table.** "A grouping of records that conceptually belong together" — similar in spirit to a relational table or a MongoDB collection, and different in two specific ways. First, a relational table holds a single entity type; Customers, Orders, and Inventory Items each get their own table, and a join reassembles them. In DynamoDB "you often include multiple entity types in the same DynamoDB table," precisely to avoid that join. Second, there is no declared schema: "At the database level, DynamoDB is schemaless, meaning the table itself won't ensure your records conform to a given schema." The book immediately closes the door that opens: "The fact that DynamoDB (and other NoSQL databases) are schemaless does not mean that your data should not have a schema — that way leads to madness." The schema still exists; it is enforced in your application code instead of by the database.

**Item.** A single record. Comparable to a row, or to a MongoDB document.

**Attribute.** A typed data value on an item — `Username` with value `alexdebrie`. Like a relational column value, "with the caveat that attributes are not required on every item like they are in a relational database." Every attribute gets a type on write, and there are **ten** of them, which the book groups into three families:

| Family | Types | Notes |
|---|---|---|
| Scalars | string, number, binary, boolean, null | A single simple value. What most of your attributes will be. |
| Complex | list, map | Arbitrary nested structure. The book uses a list for Featured Deals on a front page (Ch. 20) and a map to hold an Organization's whole Payment Plan (Ch. 21). |
| Sets | string set, number set, binary set | Multiple unique values, all the same type. Used in Ch. 21 to track which reactions a User has attached to an issue or pull request. |

The type is not cosmetic — it decides which operations are legal later. A number attribute can be atomically incremented or decremented by an `UpdateItem`; a set attribute lets you check for the existence of a particular value before updating the item. Sets in particular let you "keep track of unique items, making it easy to track the number of distinct elements without needing to make multiple round trips to the database," and the document types earn their keep when you denormalize.

**Primary key.** The one piece of structure you *must* declare at table creation. It is either **simple** (one value) or **composite** (two). Three rules follow from it, and all three are enforced by the service: every item must include the primary key or the write is rejected; every item is uniquely identifiable by it; and writing an item with an existing primary key **overwrites** the existing item unless you explicitly say it shouldn't (in which case the write is rejected instead). The book's verdict on how much this matters: "Primary key selection and design is the most important part of data modeling with DynamoDB. Almost all of your data access will be driven off primary keys, so you need to choose them wisely."

**Secondary index.** The escape valve. "The way you configure your primary keys may allow for one read or write access pattern but may prevent you from handling a second access pattern." A secondary index lets you "reshape your data into another format for querying" — you declare a key schema for the index just as you did for the table, AWS copies items from the base table into the index in the reshaped form, and you `Query` the index.

### Simple vs. composite: partition key and sort key

There are exactly two kinds of primary key:

- **Simple** — a single element, the **partition key**.
- **Composite** — two elements, a **partition key** and a **sort key**.

A terminology note worth carrying around: "You may occasionally see a partition key called a 'hash key' and a sort key called a 'range key'." The book standardizes on partition/sort, and so does current AWS documentation — but the *API* never did. `KeySchemaElement.KeyType` still takes the literal values `HASH` and `RANGE` today, so the legacy vocabulary is what you actually type in CloudFormation, CDK, and the SDKs.

Which one you pick is decided by the access patterns, and the consequence is stark:

- A **simple** primary key "allows you to fetch only a single item at a time. It works well for one-to-one operations where you are only operating on individual items."
- A **composite** primary key "enable[s] a 'fetch many' access pattern. With a composite primary key, you can use the `Query` API to grab all items with the same partition key. You can even specify conditions on the sort key to narrow down your query space."

That asymmetry is the whole reason composite keys dominate real models: they are "great for handling relations between items in your data and for retrieving multiple items at once." Note the shape of the `Query` contract implied here — the partition key is supplied as an **exact equality**, and only the sort key accepts a condition (`begins_with`, `between`, `>`, and so on). There is no such thing as querying a range of partition keys.

### Local vs. global secondary indexes

Both index kinds take a key schema — a partition key and, if you want one, a sort key. What separates them is how much freedom you get and what you pay for it.

A **local secondary index** must reuse the base table's partition key and can only change the sort key. The book frames the fit precisely: "This can be a nice fit when you are often filtering your data by the same top-level property but have access patterns to filter your dataset further. The partition key can act as the top-level property, and the different sort key arrangements will act as your more granular filters."

A **global secondary index** lets you "choose any attributes you want for your partition key and your sort key," and is "used much more frequently with DynamoDB due to their flexibility."

| | Key schema | Creation time | Consistency | Throughput |
|---|---|---|---|---|
| Local secondary index | Must use the same partition key as the base table | Must be created when the table is created | Eventual by default; can opt into strongly-consistent reads at the cost of higher throughput usage | Uses the base table's throughput |
| Global secondary index | May use any attribute from the table as partition and sort keys | Can be created after the table exists | Eventual consistency only | Provisioned separately from the base table |

On the consistency column, the book gives the one-line version — "'strong consistency' means you will get the same answer from different nodes when querying them," while "'eventual consistency' means you could get slightly different answers from different nodes as data is replicated" — and then flags its own simplification in a sidebar, pointing at Kleppmann for the real treatment. The operational upshot for GSIs: "Data is replicated from the core table to global secondary indexes in an asynchronous manner. This means it's possible that the data returned in your global secondary index does not reflect the latest writes in your main table. The delay in replication from the main table to the global secondary indexes isn't large, but it may be something you need to account for in your application."

The book's own default is unambiguous, and it sets the convention for the remaining 20 chapters: "In general, I opt for global secondary indexes. They're more flexible, you don't need to add them at table-creation time, and you can delete them if you need to. In the remainder of this book, you can assume all secondary indexes are global secondary indexes."

The chapter's introduction also promises **projection** — how much of each item gets copied into the index — but defers the mechanics. Current AWS documentation is where to get it: an index projection is `KEYS_ONLY`, `INCLUDE` (a named subset), or `ALL`, chosen at index creation and *not* changeable afterward without rebuilding the index. The book returns to it later in a performance context: if you are fetching many items and each carries a large attribute you don't need, "you may need to create a secondary index with a custom projection that only copies certain attributes into the index," because a projection expression on the base table is applied *after* the 1MB read limit, not before.

### How a partition key becomes a physical partition

Item collections only make sense once you know what happens to a partition key on the way in. The mechanism, from the following chapter: "When a request comes into DynamoDB, the request router looks at the partition key in the request and applies a hash function to it. The result of that hash function indicates the server where that data will be stored, and the request is forwarded to that server to read or write the data as requested." That is what makes the storage layer horizontally scalable — "DynamoDB can add additional storage nodes infinitely as your data scales up."

The animation below shows that mechanism with six partition-key values and four partitions. **The hash function here is illustrative — it shows the mechanism, not DynamoDB's real one.** AWS has never published DynamoDB's internal hashing algorithm, so this uses the visualization engine's built-in `hash()` (Java's `String.hashCode()`) purely to make "one key in, one deterministic slot out" visible. Do not read the specific slot assignments as anything DynamoDB would produce; read the *shape* of the result.

```viz
type: formula
capacity = 4
slot = (capacity - 1) & spread(hash(item))
---
ACTOR#Tom Hanks
ACTOR#Natalie Portman
ACTOR#Julia Roberts
ACTOR#Meryl Streep
ACTOR#Tim Allen
ACTOR#Keanu Reeves
```

Walk the trace and three properties fall out, and all three are true of the real thing:

- **Every key lands somewhere, deterministically.** `ACTOR#Tom Hanks` resolves to partition 2 on this read, on the next read, and on every write. This is why the client must know the full partition key at read time — there is no way to search for the item without it, because there is no way to know which node to ask.
- **Different partition keys sharing a partition is normal, not a bug.** `ACTOR#Tom Hanks` and `ACTOR#Tim Allen` both land in slot 2; `ACTOR#Natalie Portman` and `ACTOR#Keanu Reeves` both land in slot 3. Unlike a hash map, DynamoDB is not trying to give each key its own bucket — a partition is a storage unit holding many unrelated keys, and co-tenancy is the point.
- **The distribution is only as even as your key space.** Four partitions, six keys, and the load already comes out 1/1/2/2 rather than a tidy 1.5 each. Add a key that every write in the system shares and no amount of hashing saves you — the hash of one value is one value, so it resolves to exactly one partition. That is the hot-partition failure mode, and it is a property of *your key choice*, not of the hash.

### Item collections: why `Query` is the operation the model is built around

"An item collection refers to a group of items that share the same partition key in either the base table or a secondary index." The book's running example is a table of actors and the movies they've played in, with a composite key of partition key `Actor` and sort key `Movie`. Four movie-role items, two of them with the partition key `Tom Hanks` — those two "are said to be in the same item collection." And the edge case is called out explicitly: "the single movie role for Natalie Portman is in an item collection, even though it only has one item in it." An item collection of size one is still an item collection.

Two reasons it matters, in the book's order:

**Partitioning.** "DynamoDB partitions your data across a number of nodes in a way that allows for consistent performance as you scale. However, all items with the same partition key will be kept on the same storage node." Follow that back through the animation above: identical partition keys hash to the same value, so they resolve to the same node — necessarily, not as an optimization. An item collection *is* the set of items the hash function put in the same place.

**Data modeling.** "The `Query` action can retrieve multiple items within a single item collection. It is an efficient yet flexible operation." Efficient because the router does one hash and reads contiguous, sort-key-ordered data off one node — no scatter-gather, no cross-node coordination, no discarding of rows. Flexible because the sort key condition slices the collection. That is the whole reason the sort key exists, and it's why the book's closing instruction for the following chapters is to "think about how you're working to build purpose-built item collections to satisfy your access patterns."

Put the pieces together and the design loop is small: an access pattern that needs many items becomes an item collection; an item collection is created by choosing a partition key that groups exactly those items; the sort key orders and filters within it; and a secondary index exists to create a *second* set of item collections over the same data when one grouping isn't enough.

### Book vs. today

The chapter has aged unusually well — the vocabulary, the two key types, the LSI/GSI table, and the item-collection concept are all still exactly right in current AWS documentation. Three notes:

> **The LSI/GSI comparison table is still accurate, verbatim.** LSIs still must be created with the table and still cannot be added later; GSIs still support eventual consistency only; LSIs still allow opting into strongly-consistent reads at higher throughput cost. Nothing here has been deprecated or softened since 2020, which is worth saying plainly rather than hedging.

> **"You need to provision additional throughput for the GSI" is now mode-dependent.** In provisioned-capacity mode this remains literally true — a GSI has its own RCU/WCU settings, separate from the base table. In on-demand mode (available when the book was written, and now the common default for new tables) there is nothing to provision on either the table or its indexes; you are billed per request and the index scales with the table. The underlying fact the sentence is protecting — **a GSI write is a second write you pay for** — is unchanged in both modes. Only the knob disappeared.

> **The partition mechanics are still undocumented on purpose.** "The request router... applies a hash function to it" is as specific as AWS has ever been in public, and it is as specific as anyone should be. Adaptive capacity (which the book notes arrived before it shipped) and later isolation work mean the partition layer moves around underneath you; the durable lesson is the one above — a single partition key value is a single point of concentration — not any particular hash, partition count, or key-to-node mapping.

## Trade-offs

- **A poorly chosen partition key produces a hot partition, and the service cannot rescue you from it.** The per-partition ceiling is real and the book states it: a single partition maxes out at 3000 RCU or 1000 WCU per second, and "these limits apply to a single partition, not the table as a whole." A table provisioned for 40,000 WCU still throttles at 1000 WCU if every write shares one partition key, and adaptive capacity — which does redistribute throughput toward the items that need it — cannot split one partition-key value across nodes, because doing so would break the guarantee that item collections live together. The mitigations are all modeling work, not configuration: write-shard the key (`DAY#2026-08-20#3` across N suffixes) and pay for a scatter-gather read across every shard, or find a key that spreads naturally. The tell that you need this is a key whose cardinality is small or whose distribution is skewed — a status, a tenant id in a business with one whale, a date bucket.
- **400KB per item is the smallest item limit among comparable stores, and it bounds denormalization directly.** The book puts it in context deliberately — MongoDB allows 16MB documents, Cassandra a "whopping 2GB" — and then argues the limit is a feature: "Large item sizes mean larger reads from disk, resulting in slower response times and fewer concurrent requests." The modeling consequence is specific and it bites exactly where denormalization is most tempting: "When you have a one-to-many relationship, you may be tempted to store all the related items on the parent item rather than splitting this out. This works for many situations but can blow up if you have an unbounded number of related items." So the *good* pattern (a map or list attribute holding the children, one read to get parent and children) is only safe when the child count has a real, enforced upper bound. If it doesn't, the parent item eventually rejects writes in production, with data already in it — and the fix at that point is a migration to separate items plus a new item collection, not a config change. Decide bounded-vs-unbounded at design time, and prefer separate items whenever you can't defend the bound.
- **GSI eventual consistency is a correctness constraint, not a latency note.** The base table can serve strongly-consistent reads; a GSI cannot, ever, by design. Read-your-own-writes through a GSI is therefore not available: create an item and immediately query the index for it and you may legitimately get nothing back. That rules the GSI out for a whole class of use — most sharply for uniqueness enforcement, since a "check the index, then write" flow has a replication-lag-sized window in which two concurrent requests both see nothing and both write. Uniqueness has to live in the base table's primary key (or a dedicated item plus a transaction), where the constraint is atomic. LSIs can opt into strong consistency, but you pay in read throughput and you must have created the index with the table. The book's own guidance elsewhere follows from this: do as much as possible with the primary key.
- **Item collections can grow without bound, and with an LSI that becomes a hard write failure.** With a local secondary index present, "a single item collection cannot be larger than 10GB," counting the base table and all LSIs for that partition key. The book's warning is about *when* you find out: "If you have a data model that has many items with the same partition key, this could bite you at a bad time because your writes will suddenly get rejected once you run out of partition space." Nothing degrades first; a partition key that has accumulated for two years simply stops accepting writes. Without an LSI the limit doesn't apply — DynamoDB splits an oversized collection across partitions transparently — so the trade is legible: an LSI buys you strongly-consistent reads on an alternate sort key and a 10GB hard cap on every item collection in the table. Growth-shaped data (an event log per user, a message history per conversation) should either avoid LSIs or bound the collection deliberately with TTL or a time-bucketed partition key.
- **Even without an LSI, an unbounded item collection is a `Query` pagination problem.** `Query` and `Scan` read a maximum of 1MB per request, and that limit "is applied before any filter expressions are considered." A collection that grows forever means an access pattern that started as one request quietly becomes a paginated loop, with per-request latency that no longer reflects total latency. The book's framing is that this is the guardrail working — the 1MB cap is "crucial to keeping DynamoDB's promise of consistent single-digit response times" — but it does mean "all items for this partition key" is only a viable pattern while the collection is small, and "the most recent N" (a sort-key condition plus a limit) is the pattern that stays viable forever.
- **Schemaless at the database means schema enforcement is now your test suite's job.** The freedom is genuine: no migration to add an attribute, heterogeneous items in one table, a `Query` that returns three entity types at once. The cost is that nothing rejects a typo'd attribute name, a string where a number belonged, or an item written by an old deploy that lacks an attribute a new code path assumes. There is no `NOT NULL`, no type check, and no failing migration to catch it — the write succeeds and the bug surfaces later at read time, in code, often in a different service. The book's "that way leads to madness" is the right instinct; operationally it means the schema has to live somewhere real — a single-writer data access layer, a validated model class, or a stream consumer that alarms on malformed items — and that layer is now load-bearing infrastructure you own and maintain.
- **Overloading one table with several entity types is the correct default and it is genuinely worse to look at.** It's what buys the single-request multi-entity read, and it forces generic `PK`/`SK` attribute names, because a partition key holding an org name for one item and a username for another cannot be called either. The consequences are all human: the console view is unreadable at a glance, an exported dataset is heterogeneous, no attribute name documents what it holds, and a `DescribeTable` tells a newcomer almost nothing about the model. The entity chart and access-pattern chart stop being documentation and become the only map. Budget for maintaining them, because without them the model is undocumented by construction.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 2, "Core Concepts in DynamoDB", p. 40-50](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — DynamoDB Core Components (tables, items, attributes, primary keys, secondary indexes)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html) — doc
- [AWS Documentation — Partitions and Data Distribution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html) — doc
- [AWS Documentation — Improving Data Access with Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html) — doc
- [AWS Documentation — Service, Account, and Table Quotas in DynamoDB (400KB item limit, 10GB item collection limit)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotasHowItWorks.html) — doc
- [AWS Documentation — Designing Partition Keys to Distribute Your Workload Evenly](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — doc
- [AWS Documentation — Query API Reference (KeyConditionExpression)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html) — doc
