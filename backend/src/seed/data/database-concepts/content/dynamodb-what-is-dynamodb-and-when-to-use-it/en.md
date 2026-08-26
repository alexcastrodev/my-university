---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Get oriented before going deep. Everything else in this category — primary keys and item collections, single-table design, one-to-many and many-to-many strategies, streams and TTL — assumes you already believe DynamoDB is worth the trouble. This concept is the argument for that belief, and the honest caveats that come with it.

Alex DeBrie opens The DynamoDB Book with a one-line definition: "DynamoDB is a fully-managed, NoSQL database provided by Amazon Web Services." He then spends the rest of the chapter arguing that the sentence is "more than just a bunch of buzzwords" — each word is doing real work, and the rest of this concept walks through what that work is: what kind of database DynamoDB is, the two use cases that actually drive people to it, how it stacks up against the alternatives you already know, and — because a landing page that only sells is not orienting you — where the book itself says DynamoDB is the wrong tool.

## Use Cases

- Choosing a database for a new AWS Lambda / serverless service, where DynamoDB's HTTP connection model and IAM auth mean no connection pools to manage and no VPC networking to wire up before the first request works.
- Building a session store or any simple key-value lookup — "a typical example here is a session store where you're saving session tokens that are used for authentication."
- Adding a cache in front of an expensive, frequently-repeated query from another database, when a fully in-memory cache like Redis is more operational overhead than the use case justifies.
- Sizing up whether a new product will hit hyperscale traffic (the shopping-cart, IAM, EC2 kind of load) before you commit to a relational database you'll need to shard or migrate off later.
- Pushing back on team folklore about DynamoDB — "it's just a key-value store," "it doesn't scale," "it's only for huge companies" — with the book's actual answers, before those myths steer a real architecture decision.
- Deciding between DynamoDB, MongoDB, and Cassandra for a new wide-column or document workload, when the real fork in the road is operations burden and cloud lock-in, not raw capability.

## Deep Dive

### Five misconceptions, dispatched up front

DeBrie opens by naming the folklore he wants to clear away before teaching the real model, because each one, left standing, produces a bad architecture decision:

1. **"DynamoDB is just a key-value store."** False — it handles relationships and complex filtering; "if you can model it in an RDBMS, you can probably model it in DynamoDB." The technique differs, not the ceiling.
2. **"DynamoDB doesn't scale."** "This is poppycock." AWS requires DynamoDB for every Tier 1 service — one that "would lose money if it went down" — including the shopping cart, IAM, and EC2. Lyft runs its live ride-location data on it. The misconception, DeBrie argues, comes from people who scan instead of query, or who cram everything into one partition — misuse, not a limit of the tool.
3. **"DynamoDB is only for enormous scale."** Also false — it's a default choice in the serverless community precisely because of easy provisioning and pay-per-use billing, independent of how big the app is.
4. **"You can't use DynamoDB if your data model will change."** You must know your access patterns *before* you model, but that's not the same as never changing them — "many changes are additive to your existing model," and the book devotes a chapter to migration strategies.
5. **"You don't need a schema when using DynamoDB."** "Truly schemaless data is madness." DynamoDB won't enforce a schema at the database level, but "you will still need a schema somewhere in your application" — the enforcement point moves, it doesn't disappear.

### What kind of database it is

DynamoDB supports two overlapping data models. As a **key-value store**, it behaves "like a giant, distributed hash table" — fast, uniform performance regardless of size, but you can only fetch one record at a time by its key. To handle "fetch many" access patterns, DynamoDB is also a **wide-column store**: think of the hash table as a bookshelf and each value as a B-tree, so that a query like "give me all entries between Buffett, Warren and DeBrie, Alex in Omaha, NE" resolves to one shelf lookup plus one ordered scan of that shelf's book — not a table scan. That two-part shape — hash table for locating the right group, B-tree-like ordering inside it — is the mechanism the rest of the category calls the primary key and the item collection.

Beyond the data model, DeBrie lists the properties that distinguish DynamoDB operationally from both relational databases and most other NoSQL stores:

- **Infinite scaling with no performance degradation.** Most operations run in single-digit milliseconds "no matter the size of the data set," a pattern relational databases don't share as they grow. DAX (DynamoDB Accelerator) exists as a managed cache for teams that need faster still.
- **HTTP connection model.** Every request is an HTTP call to the DynamoDB API rather than a persistent TCP connection. That trades a small per-request cost for no connection pool, no pool-size limit (PostgreSQL, for comparison, defaults to 100 max connections), and compatibility with compute that starts cold on every invocation.
- **IAM authentication.** Access control is granular AWS IAM policy, not a database-specific username/password system — you can scope a role down to `GetItem` on one table, or even to specific keys and attributes.
- **Infrastructure-as-code friendly.** Table creation, primary keys, and secondary indexes are all declarable in Terraform or CloudFormation, with none of the out-of-band admin tasks (user creation, migrations) that make most databases awkward to manage as code.
- **Flexible, workload-based pricing.** Instead of provisioning a server by CPU/RAM/disk, you provision **Read Capacity Units** and **Write Capacity Units** — throughput, tuned independently for reads and writes, scalable up and down as traffic changes. If you don't want to capacity-plan at all, **On-Demand Pricing** charges per request instead. DeBrie's own advice: "start with On-Demand Pricing as you develop a baseline traffic level... [then] switch to defining your Provisioned Throughput to lower costs" once you understand your traffic.
- **Change data capture via DynamoDB Streams.** A built-in transactional log of every write, usable for event-driven architectures without bolting on external change-data-capture infrastructure.
- **Fully managed.** No servers to provision, no failover, backup, or patching to run yourself — at the cost of the low-level control (no SSH, no config tuning) that a self-hosted database gives you.

### When to use it

The book's short answer: two forces have driven DynamoDB adoption, and it's worth knowing the history behind each, because the history is also the argument.

**Hyperscale.** Relational databases were built for an era when storage, not traffic, was the constraint — normalize aggressively, join to reassemble. That stopped being the binding constraint once storage got cheap and the internet made every app's addressable market the whole planet. Amazon's own 2004 Cyber Monday scaling crisis pushed its engineers to publish the 2007 Dynamo Paper, which found that "over 90% of all queries did not use joins" at Amazon's scale, and that relational strong consistency was expensive precisely where it wasn't needed everywhere. Relaxing both — joins and strict consistency — let Amazon shard data across many small, cheap machines instead of one large, expensive one. DynamoDB, released in 2012, is the fully-managed descendant of that internal database.

**Hyper-ephemeral compute (serverless).** AWS Lambda inverted the compute model from "provision instances ahead of expected traffic" to "run code on-demand when an event arrives." That kills two assumptions long-running servers relied on: time to warm up a persistent connection pool, and a fixed, known network location to lock down with VPC rules. DynamoDB's HTTP model and IAM auth fit this shape exactly — no connection pool to warm, no network topology to know in advance.

**Other situations.** Even without hyperscale or serverless in the picture, DeBrie recommends DynamoDB for most OLTP workloads (small reads/writes at high speed — "this describes most applications that you interact with as a user"), for caching, and for simple key-value data models like session stores. What it is *not* built for: OLAP — "giant analyses of data sets, usually for reporting purposes" belongs to a different kind of database entirely.

### How it compares

- **vs. relational databases.** Relational wins on team familiarity, tooling, framework integration, and query flexibility — you can iterate on the model without knowing every access pattern up front. DynamoDB wins on scale ceiling and fit with serverless compute. The hardest case is a startup that *might* hit hyperscale: move fast now on a relational database and risk a costly migration later, or pay the DynamoDB learning cost now and never need to migrate. DeBrie's own bias is DynamoDB "every time," but he calls it "a tough choice with no clear answer."
- **vs. MongoDB.** Same sharding-driven scalability story, but a genuinely different data model — MongoDB is document-oriented with richer index types (text search, geospatial, multi-key), which buys query flexibility at the cost of making it easier to write something that won't scale. DeBrie's framing: "the Swiss army knife is more adaptable to more situations, but the power saw can handle some jobs that a Swiss army knife never could." MongoDB is also the pick if cloud portability matters — it runs anywhere; DynamoDB doesn't leave AWS.
- **vs. Apache Cassandra.** The closest data-model relative — Cassandra is wide-column too, and most DynamoDB modeling advice transfers. Once you've accepted the wide-column model, the remaining question is purely operational: run a fully-managed service, or hire a team to operate a Cassandra cluster yourself. DeBrie: "it's the option I least recommend when considering alternatives to DynamoDB," precisely because it offers the same data model with strictly more operations burden (portability and avoiding lock-in being the one real argument the other way).

### Book vs. today

The 2020 chapter's shape — what DynamoDB is, the two adoption drivers, the three comparisons — is still how AWS and the wider community frame the database in 2026. Two things have moved since:

> **On-demand is now the default AWS itself recommends, not just DeBrie's onboarding advice.** In 2020 the book nudges new users toward On-Demand Pricing as a starting point before "graduating" to provisioned capacity for savings. AWS cut on-demand throughput prices roughly 50% in November 2024, and current AWS documentation now states plainly: "On-demand mode is the default and recommended throughput option for most DynamoDB workloads." Provisioned capacity (especially with a multi-year commitment) still undercuts on-demand at high, steady utilization, so the underlying trade-off DeBrie describes hasn't changed — only the size of the on-demand tax has shrunk enough that AWS no longer frames provisioned as the mode most people should graduate to.
> **A managed Cassandra option matured.** The book mentions AWS's newly-announced Managed Cassandra Service (MCS) as a hosting option that "make[s] the decision a little closer" — that service is now Amazon Keyspaces, a stable, general-availability product. It narrows, without erasing, the operations-burden gap DeBrie describes in the Cassandra comparison.

## Trade-offs

- **No joins, ever — access patterns must be known before the table is designed.** This is the one trade-off the whole rest of this category exists to teach you to work around, and DeBrie is upfront that it's a real cost: "With a relational database, you often design your table based on your objects without thinking about how they'll be queried. With DynamoDB, you can't design your table until you know how you'll use your data." Get this wrong and the fix is a migration, not a new query. See `dynamodb-data-modeling-approach` for the access-patterns-first process this trade-off demands.
- **Schema enforcement moves from the database to your application.** DynamoDB won't reject a malformed item at write time the way a relational `NOT NULL` or foreign key would. The book's own words: "truly schemaless data is madness" — the schema still has to exist, it just becomes code you own and test, not a constraint the database enforces for free.
- **Not built for ad-hoc analytics or reporting.** DynamoDB is an OLTP tool; it does not compete with an OLAP or data-warehouse workload of "giant analyses of data sets... for reporting purposes." Reaching for DynamoDB there means either exporting to a purpose-built analytics store or accepting slow, expensive scans.
- **The HTTP connection model can be slower per-request than a warm TCP connection.** DeBrie concedes it directly: "The HTTP-based model can be a bit slower... than the persistent TCP connection model for some requests, since there isn't a readily-available connection to use." The trade is deliberate — you give up a small amount of best-case latency for zero connection-pool management and effectively unlimited concurrent callers.
- **A relational database is still the faster path for an unfamiliar team.** Developer familiarity, ecosystem tooling, and framework-native support all favor SQL, and a team without DynamoDB experience is more likely to make "a critical data-modeling error that will force a costly migration." DeBrie frames the choice as a real trade between moving fast now versus not needing to migrate later if the app succeeds at scale — not a decision with an obviously correct answer.
- **AWS lock-in is real and permanent.** Unlike MongoDB or Cassandra, DynamoDB does not run outside AWS. If cloud portability is a genuine requirement — regulatory, contractual, or strategic — that alone can be decisive against it, independent of every technical argument above.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 1, "What is DynamoDB?", p. 11-33](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — What Is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) — doc
- [AWS Documentation — DynamoDB Throughput Capacity: On-Demand vs. Provisioned Mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ProvisionedThroughput.html) — doc
- [AWS What's New — Amazon DynamoDB Reduces Prices for On-Demand Throughput and Global Tables (Nov 2024)](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-dynamo-db-reduces-prices-on-demand-throughput-global-tables/) — doc
- [AWS Documentation — Amazon Keyspaces (for Apache Cassandra)](https://docs.aws.amazon.com/keyspaces/latest/devguide/what-is-keyspaces.html) — doc
- [AWS Documentation — Best Practices for Designing and Architecting with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html) — doc
