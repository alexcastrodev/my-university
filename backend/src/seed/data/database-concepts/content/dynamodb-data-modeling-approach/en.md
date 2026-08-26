---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand why data modeling in DynamoDB runs in the opposite direction from relational modeling — you enumerate every access pattern *before* you design a key, rather than normalizing first and querying flexibly later — and learn the concrete five-step process the book prescribes: understand the application, draw an ERD, write out all access patterns, model the base table's primary key, then mop up whatever is left with secondary indexes and streams.

## Use Cases

- Starting a greenfield service on DynamoDB and needing a defensible sequence to follow, instead of translating an existing relational schema table-for-table — which the book calls out as the failure mode: "If you model the data in the same way, you not only won't get that benefit but you will also end up with a solution that's worse than using the relational database!"
- Running the requirements conversation with a PM, engineering manager, or business analyst before any table exists, because the access-pattern list is a product artifact as much as a technical one.
- Reviewing a design where the team "faked" joins in application code — one request to fetch a record, then a follow-up query for its related records — and explaining why that waterfall is the pattern DynamoDB exists to remove.
- Deciding whether a given model actually needs a composite primary key, using the book's rule of thumb rather than defaulting to one out of habit.
- Auditing a table that has grown one GSI per read pattern, and consolidating onto overloaded `GSI1PK`/`GSI1SK` attributes.

## Deep Dive

### Where DynamoDB diverges from relational modeling

The book opens with four specific divergences, and each one is a constraint that shapes the process that follows.

**Joins don't exist.** Joins need large amounts of CPU to combine disparate units of data, and they work best when all relevant data is co-located on a single machine so no network call is needed. That co-location requirement caps you at *vertical* scaling — a bigger instance — rather than horizontal scaling across many smaller ones. DeBrie's line is blunt: "You won't find information about joins in the DynamoDB documentation because there are no joins in DynamoDB." The replacement is to **preassemble your data in the exact shape that is needed for a read operation**, at write time, instead of reassembling it at read time. And the application-side workaround is explicitly ruled out: making an initial request to fetch a record and then a follow-up request for related records is the same expensive pattern, just moved into your own code.

**Normalization loses one of its two justifications.** The chapter walks a clothing-store table from denormalized to third normal form to make the cost visible: splitting the multi-valued `Categories` column into a `Categories` table plus an `ItemsCategories` linking table (1NF), moving `Size`/`Price` into an `ItemsPrices` table because `ManufacturerId`/`ManufacturerName` depend on `Item` alone and not on the `Item`+`Size` key (2NF), and finally splitting the two manufacturer columns out because they are transitively dependent on each other (3NF). What started as one table ends as **five tables**, linked by IDs, and retrieving one item with its categories now needs a two-join query:

```sql
SELECT *
FROM items
JOIN items_categories ON items.item = items_categories.item AND items.size = items_categories.size
JOIN categories ON items_categories.category_id = categories.category_id
WHERE items.item = "Nebraska hat"
```

| Form | Definition | Plain english |
|---|---|---|
| 1NF | Each column value is atomic | Don't include multiple values in a single attribute |
| 2NF | No partial dependencies | All non-key attributes must depend on the entirety of the primary key |
| 3NF | No transitive dependencies | All non-key attributes depend on only the primary key |

Normalization exists for two reasons, and the book evaluates them separately. The first — conserving storage — was a product of 1970s and 1980s hardware economics and is simply gone: "As of the time of writing, I can get a GB of SSD storage for $0.10 per month on AWS." With Moore's Law flattening, *compute* is the limiting factor, so the sensible trade is to optimize for compute by storing data pre-shaped for reads. The second reason — data integrity — has **not** gone away. It moves: "Data integrity is now an application concern rather than a database concern." You have to decide up front where and when duplicated data gets updated and how you will find every associated record when it does.

**Multiple entity types live in one table.** With no joins, fetching a Customer and all of that Customer's Orders in one request means both entity types share a table and a deliberately designed key. Two consequences feel wrong coming from SQL. First, you can't give the key attributes descriptive names — a partition key that holds a `CustomerId` for one item and an `OrderId` for another can't be called `CustomerId`, hence the generic `PK`/`SK` convention. Second, items in the same table won't share the same attributes. The book is honest that this is mostly a non-issue for application code (the data access layer abstracts it) but genuinely annoying when browsing the console or exporting to an analytics system.

**Filtering moves from query time to model time.** "Data access is one large filtering problem." The relational `WHERE` clause is described as "supremely powerful" — filter on top-level properties, on joined nested objects, on dynamic values like the current time — and then as "a luxury you can't afford at scale," because a `WHERE` clause reads and discards a large number of records, and that's wasted compute. In DynamoDB, filtering is built into the data model itself: the primary keys of your table and your secondary indexes *are* the filtering mechanism, and reads are "precise, surgical requests." That's the deal the whole process is buying — "the sub-10 millisecond response times you get when you have 1 gigabyte of data is the same response time you get as you scale to a terabyte of data and beyond."

### The process, step by step

The book's high-level list:

- Understand your application
- Create an entity-relationship diagram (ERD)
- Write out all of your access patterns
- Model your primary key structure
- Satisfy additional access patterns with secondary indexes and streams

And the sentence that governs all five: **"Data modeling in DynamoDB is driven entirely by your access patterns. You will not be able to model your data in a generic way that allows for flexible access in the future. You must shape your data to fit the access patterns."**

**1. The ERD.** An ERD lists the entities in your application — usually the nouns you use when talking about it: Users, Notes, Orders, Organizations — with their attributes, and the relationships between them. The book's toy example is a Notes app: a `User` entity with username, email, and date created; a `Note` entity with title, date created, and body; one one-to-many relationship between them. The scaling argument for doing this at all is the GitHub model from Chapter 21: **eight entities with fourteen relationships between them, still modeled in a single DynamoDB table.** DeBrie recommends building an ERD even for a small data model, because it forces you to think about the data up front and leaves an artifact for people new to the application.

**2. Define your access patterns — all of them.** This is where the relational habit breaks. With a relational database "you can usually just ship your ERD straight to the database": entities become tables, relationships become foreign keys, and you design for flexible future queries. Not here. "You design your data to handle the specific access patterns you have, rather than designing for flexibility in the future." So the instruction is to be specific and thorough, and to go get the requirements from people — PM, engineering manager, business analyst, other stakeholders — before designing anything.

Two strategies for enumerating them:

- **API-centric** — natural when you're building a REST API. List every endpoint you want to support plus the expected response shape.
- **UI-centric** — better for server-side rendering or a backends-for-frontends API. Walk each screen and its URL, and write down every piece of information needed to assemble that screen.

Record them in a chart whose right-hand side stays empty until you design the model:

| Entity | Access Pattern | Index | Parameters | Notes |
|---|---|---|---|---|
| Sessions | Create Session | | | |
| Sessions | Get Session | | | |
| Sessions | Delete Session (time-based) | | | |
| Sessions | Delete Session (manual) | | | |

The left side is the requirement; the right side gets filled in with the DynamoDB API call, the table or index used, and the parameters. On the importance of this step the book does not hedge: "I cannot express strongly enough how important this step is. You can handle almost any data model with DynamoDB provided that you design for your access patterns up front. The biggest problem I see users face is failing to account for their patterns up front, then finding themselves stuck once their data model has solidified." The accompanying jab — that people then blame DynamoDB, the way you'd blame a screwdriver for being bad at raking leaves — is the book's framing of every "DynamoDB is inflexible" complaint.

**3. Model the primary key structure.** The primary key is the foundation of the table, so it comes first, and it's modeled in its own sub-process:

- **Build an entity chart.** Copy every entity from the ERD into a table with `PK` and `SK` columns left blank — the GitHub example starts as nine bare rows: Repo, Issue, Pull Request, Fork, Comment, Reaction, User, Organization, Payment Plan. Expect the rows to change: entities disappear when you represent them as a list or map attribute on a parent item instead of separate items, and entities get *added* for many-to-many relationships or purely to enforce uniqueness on an attribute.
- **Decide simple vs. composite.** Most complex models use a composite key, and the rule of thumb is concrete: if any access pattern retrieves multiple entities (*Get all Orders for a User*) or multiple entity *types* (*Get a Sensor and the most recent SensorReadings for the Sensor*), you need a composite primary key.
- **Design the key format per entity type.** Satisfy uniqueness requirements first; use whatever flexibility remains to solve "fetch many" patterns.

Two principles for the key format itself. **Consider what your client will know at read time** — the client must know the primary key at read time or pay for extra queries to discover it. If the URL is `https://api.mydomain.com/users/alexdebrie`, then `username` is safe to put in the key because the request carries it. The named anti-pattern is stuffing a `CreatedAt` timestamp into the primary key: it guarantees uniqueness, but that timestamp won't be in hand when you later need to read or update the item. **Use prefixes to distinguish entity types**, both for legibility in the console and to prevent accidental key overlap between entity types with similar attributes:

| Entity | PK | SK |
|---|---|---|
| Customer | `CUSTOMER#<CustomerId>` | `METADATA#<CustomerId>` |
| CustomerOrder | `ORDER#<OrderId>` | `METADATA#<OrderId>` |

Keep those templates in the entity chart as you go. And on the feeling of not knowing where to begin: "Resist the urge to give up. Dive in somewhere and start modeling. It will take a few iterations, even for experienced DynamoDB users." With experience you learn which parts of the ERD are trickiest and start there — once those are modeled, the rest usually falls into place.

**4. Handle what's left with secondary indexes and streams.** After the primary key is modeled, a batch of access patterns should already be satisfied — and that's the goal, because "It's best to do as much as you can with your primary keys. You won't need to pay for additional throughput, and you won't need to consider eventual consistency issues that come with global secondary indexes." Whatever remains goes to secondary indexes, with one warning: "New users often want to add a secondary index for each read pattern. This is overkill and will cost more." Overload the index the same way you overload the primary key — generic `GSI1PK`/`GSI1SK` attribute names serving several access patterns from one index.

The chapter's closing instruction is unusually direct: **"You cannot skip these steps and expect to be successful."**

### Book vs. today: the method became AWS's own official advice, and tooling filled two gaps

The methodology itself has aged well — AWS's own *NoSQL Design for DynamoDB* guidance now makes the same argument in almost the same words, contrasting relational schema design (built before you know the queries) with DynamoDB (don't start designing until you know the questions the schema must answer), and lists identifying access patterns as the prerequisite step. Three additions since April 2020 are worth knowing:

> **PartiQL is not the flexibility escape hatch it looks like.** AWS added PartiQL support for DynamoDB in late 2020, after the book shipped, so the chapter never mentions it. It gives you SQL-*looking* `SELECT`/`INSERT`/`UPDATE`/`DELETE` statements — but it does not add joins, and it does not change any of the reasoning above. A PartiQL `SELECT` still resolves to a `GetItem`, `Query`, or `Scan` depending on whether your `WHERE` clause hits the key, so a statement that doesn't constrain the partition key is a full table scan wearing SQL syntax. The access-pattern-first process is unchanged.

> **The entity chart has a first-class tool now.** NoSQL Workbench for DynamoDB provides a data modeler and visualizer for exactly the artifacts this chapter describes by hand — entities, key templates, and sample items — and can commit a finished model to a real or local table. The book's paper charts are still the right thinking exercise; the tool is where they can live.

> **The analytics-export complaint has been addressed.** The book names "exporting your table to an external system for analytical processing" as a real cost of heterogeneous items in one table. Since then AWS has added table export to S3 (full and, later, incremental) and zero-ETL integrations to Amazon Redshift and Amazon OpenSearch, so getting a single-table dataset into an analytics engine no longer requires a hand-rolled pipeline. It doesn't make the exported data *shaped* nicely — the items are still heterogeneous — but the plumbing is no longer your problem.

## Trade-offs

- **The whole method assumes you already know your access patterns — and in discovery-phase work, you don't.** This is the honest cost, and it's not a small one. The book's own strongest claim ("You can handle almost any data model with DynamoDB provided that you design for your access patterns up front") is conditional on a prerequisite that a pre-product-market-fit team frequently cannot satisfy. A relational schema lets you defer that decision; DynamoDB makes you pay it at design time. When the requirements genuinely aren't knowable yet, the mature answer is that this is a reason to question the datastore choice for that service, not a reason to skip the step and hope.
- **A genuinely new access pattern discovered later is a migration, not an ALTER.** In SQL, "we now need to query by email" is usually one `CREATE INDEX` against data that already has the column. In DynamoDB, a new pattern that your existing `PK`/`SK` and GSI key attributes don't support means backfilling new attributes onto every existing item before the new index is usable — a data migration over the whole table, written and run by you, on live data. Adding a GSI is cheap; adding *the attribute the GSI indexes* to a hundred million existing items is not. This is what "finding themselves stuck once their data model has solidified" actually means in practice.
- **The mental-model tax on a relational team is real and lasts longer than one design session.** Generic `PK`/`SK` attribute names, `CUSTOMER#123` composite string keys, several entity types interleaved in one table, and no ad-hoc `WHERE` — every one of those reads as bad design to someone with a decade of relational instincts, and the console view actively reinforces that impression. The book acknowledges the friction ("it can be overwhelming to think about where to start", "It will take a few iterations, even for experienced DynamoDB users") but frames it as a learning curve; on a team it also shows up as slower code review, more onboarding time, and a persistent temptation for a new engineer to "clean it up" back into one table per entity. Budget for it explicitly.
- **Denormalization moves data integrity from the database to your application, permanently.** The book is straight about this: the storage justification for normalization is dead, but the integrity justification isn't — it just changes owner. Every duplicated attribute becomes a fan-out write you must design, test, and monitor, and "in most applications, this won't be a big problem, but it can add significant complexity in certain situations." There is no foreign key to catch you.
- **"Preassemble at write time" trades write-path cost and complexity for read-path speed.** The sub-10ms-at-any-scale promise is paid for on the write side: more items written, more attributes duplicated, more conditional writes to keep them consistent. For a read-heavy workload that's an excellent trade; for a write-heavy one with few reads, you're paying the modeling tax and collecting less of the benefit.
- **Doing as much as possible with the primary key is right, but it concentrates risk in the one thing you can't change.** Table primary key attributes are immutable after creation — a GSI can be added or dropped later, the base table's `PK`/`SK` cannot. So the advice to prefer the primary key (no extra throughput, strongly consistent reads available, no GSI eventual-consistency window) also means the least reversible decision in the design carries the most weight. That's an argument for spending disproportionate time on step 3, not for avoiding it.
- **Overloaded indexes are cheaper and harder to read.** Collapsing many access patterns onto one `GSI1PK`/`GSI1SK` pair avoids paying for and provisioning an index per pattern, which is the correct default. The cost is that no index name or attribute name tells you what any of it is for; the access-pattern chart and entity chart stop being nice-to-have documentation and become the only map of the system. If those artifacts aren't maintained, the model is effectively undocumented.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 7, "How to approach data modeling in DynamoDB", p. 127-149](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Best Practices for Designing and Architecting with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html) — doc
- [AWS Documentation — NoSQL Design for DynamoDB (identify access patterns first)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html) — doc
- [AWS Documentation — Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) — doc
- [AWS Documentation — PartiQL for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.html) — doc
- [AWS Documentation — NoSQL Workbench for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.html) — doc
