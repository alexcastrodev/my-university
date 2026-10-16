---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

EF Core is usually taught through relational databases, but the same `DbContext`,
LINQ and change tracker also front two document stores: Azure Cosmos DB for NoSQL
(provider from the EF Core team) and MongoDB (provider from MongoDB). The API looks
familiar, and that is the trap: a document database has no joins, no migrations and
no foreign keys, so the model you write and the queries that are cheap are very
different from SQL Server. This concept shows what carries over, what is removed,
and how to model a partition key, an embedded document and a transaction boundary
so the provider helps instead of hiding costs.

## Use Cases

- A service already built on EF Core that has one aggregate, such as an order with
  its lines and address, which fits naturally as a single JSON document.
- Choosing between the EF provider and the vendor's native driver for a new
  document-store service.
- Reviewing a Cosmos DB code base where every query fans out to all partitions.
- Explaining to a team why `Include`, `Migrate()` and `GroupBy` do not exist there.

## Deep Dive

### What survives and what does not

Both providers keep the parts of EF Core that do not depend on SQL: `DbContext`,
`DbSet<T>`, the change tracker, LINQ translation, value converters, owned types and
`SaveChanges`. They drop what only makes sense for tables. I checked this by
referencing `MongoDB.EntityFrameworkCore` 10.0.4: `db.Database.Migrate()` does not
even compile, because the relational extension methods are not there, and
`ToQueryString()` throws `The given 'IQueryable' does not support generation of
query strings`. The Mongo provider's documentation lists the rest: no migrations, no
database-first, no foreign keys, no table splitting, no spatial data.

Because there are no joins, the relationship story is different. Owned types and
collections become embedded subdocuments and arrays. The Cosmos documentation says
related types are owned by default there, and the Mongo documentation shows
`OwnsOne`, `OwnsMany` or `[Owned]` for the same purpose; I configure it explicitly in
both so the intent is visible. Anything that lives in another document is a plain id
field that you resolve with a second query.

### Cosmos DB: model around the partition key

Cosmos stores JSON documents in containers, and every container is split by a
partition key. EF Core maps all entity types to one container by default, named
after the context class (I printed `container: CtxA` for a context named `CtxA`);
`HasDefaultContainer` and `ToContainer` change that.

```csharp
modelBuilder.HasDefaultContainer("store");
modelBuilder.Entity<Order>(e =>
{
    e.HasPartitionKey(x => new { x.TenantId, x.UserId }); // hierarchical, up to 3 properties
    e.OwnsOne(x => x.Customer);                           // embedded object
    e.OwnsMany(x => x.Lines);                             // embedded array
});
```

Running `ToDebugString()` on that model shows what the provider derived. The key
property `Id` is the JSON `id`, and the EF primary key is `Id, TenantId, UserId`
together, because Cosmos only guarantees `id` is unique inside one partition. A
`$type` discriminator is added to every document so several entity types can share a
container. Cosmos does not generate keys, so you set `Id` yourself (a GUID value
generator is the usual choice).

If you forget `HasPartitionKey`, the model still builds but EF logs warning
`CosmosEventId.NoPartitionKeyDefined` (30600, which I reproduced), and the primary
key shrinks to `Id` alone. According to the documentation the container is then
created with a default partition path that caps it at one 20 GB logical partition.
Treat that warning as an error.

### Cosmos DB: queries that stay on one partition

The cost of a Cosmos query is request units, and it is lowest when the query is
routed to the partition that holds the data. Since EF Core 9 the provider pulls
partition key equality comparisons out of your `Where`:

```csharp
db.Orders.Where(o => o.TenantId == tenant && o.UserId == userId && o.Total > 100)
```
```
SELECT VALUE c
FROM root c
WHERE (c["Total"] > 100.0)
```

Both key comparisons disappeared from the SQL because they became the request's
partition. Add the `id` and the full key and EF skips SQL entirely:
`ToQueryString()` for `Where(o => o.Id == "o1" && o.TenantId == tenant && o.UserId ==
userId)` answers that there is no string form because the query is executed using
`ReadItemQueryAsync(o1, ["acme","u42"])`. That is a point read, the cheapest
operation Cosmos has. `WithPartitionKey(tenant, userId)`
states the same intent explicitly.

Embedded data translates into path expressions
(`STARTSWITH(c["Customer"]["City"], "Lon")`, `ARRAY_CONTAINS(c["Notes"], "fragile")`).
What does not translate fails loudly at runtime. In my run `GroupBy` and
`EF.Functions.Like` both threw `could not be translated`, and the documentation states
that `Include` is not supported because cross-document queries do not exist. The Cosmos function list has its own
vocabulary: `EF.Functions.Random()` becomes `RAND()`, `Contains`, `StartsWith` and
`Regex.IsMatch` have equivalents, and EF Core 10 added full-text search
(`FullTextContains`, `FullTextScore`), hybrid search with `Rrf`, and vector search out
of preview. Paging should use `ToPageAsync` with a continuation token rather than
`Skip`/`Take`, which the documentation says is much more expensive.

All I/O is async. A synchronous `ToList()` throws immediately with the
`SyncNotSupported` warning turned into an error.

### Cosmos DB: writes and concurrency

In EF Core 10 `SaveChangesAsync` sends one request per document, sequentially. There
is no atomic multi-document save: if the third of five writes fails, the first two
stay. Transactional batches (single partition, up to 100 operations) are documented
as arriving with EF Core 11, which is in preview, so do not design around them yet.
For optimistic concurrency, `UseETagConcurrency()` maps the document `_etag` to a
shadow concurrency token. `HasShadowId()` and `HasDefaultTimeToLive()` also work; in
my run, a shadow id moved the key to a separate `__id` property mapped to JSON `id`,
while `Id` kept its own name in the document. EF Core 10 also added trigger support
and now fills a default for a new required property when an older document lacks it.

### MongoDB: the provider owned by MongoDB

`MongoDB.EntityFrameworkCore` is published by MongoDB, not Microsoft, and the
providers page lists it for EF Core 8, 9 and 10. The version that restored for me was
10.0.4, matching EF Core 10, and providers generally do not work across EF majors.

```csharp
modelBuilder.Entity<Order>(e =>
{
    e.ToCollection("orders");
    e.OwnsOne(x => x.Customer);   // subdocument
    e.OwnsMany(x => x.Items);     // array
});
// Order.Id is an ObjectId; the owned types get a shadow key for EF's internal tracking
```

The model printed by `ToDebugString()` confirms an `ObjectId` primary key marked
value-generated on add, and shadow keys on the owned types. The documentation says
an update to any property in an embedded entity rewrites the whole root document, so
deep, frequently written nesting is a poor fit; it recommends references (an
`ObjectId` field you resolve yourself) when the child is unbounded, queried on its
own or changes often, and the subset pattern for large one-to-many sets (see the
MongoDB schema design concept).

Transactions are implicit and conditional. `AutoTransactionBehavior.WhenNeeded` (the
default) wraps `SaveChanges` in a transaction only when more than one root document
is affected. That needs a replica set or sharded cluster; on a standalone server the
provider throws `NotSupportedException` unless you set `Never`, and then you lose
the atomicity and optimistic concurrency. `TransactionScope` is not supported, nested
transactions are not allowed, and the server aborts a transaction after 60 seconds
by default. Optimistic concurrency uses `[ConcurrencyCheck]` or a numeric
`[Timestamp]` version field.

### Choosing the provider or the driver

The EF provider is built on the MongoDB C# driver, and the documentation's own FAQ
frames the split: the driver exposes bulk operations, aggregation and richer
projections; the provider gives change tracking and a model. You can use both in one
app by calling the driver on the same `MongoClient`. For heavy analytics or Atlas
Search, which the provider does not support, drop to the driver for that query.

## Trade-offs

- **Familiar API, different cost model.** A LINQ query that compiles is not
  necessarily cheap. On Cosmos, the same predicate costs a point read with the full
  key and a cross-partition scan without it.
  ```csharp
  db.Orders.Where(o => o.Total > 100)   // fans out to every partition
  ```
- **Embedding is a bet on bounded, co-read data.** It removes joins but makes every
  write rewrite the document and lets a hot document grow without limit.
  ```csharp
  e.OwnsMany(x => x.Lines);   // fine for 20 lines, risky for 20,000
  ```
- **No cross-document atomicity on Cosmos in EF Core 10.** A multi-entity
  `SaveChangesAsync` is not all-or-nothing, so model one business invariant per
  document or accept compensating logic.
- **A third-party provider lags EF Core.** The Mongo provider ships on MongoDB's
  schedule, so an EF Core upgrade can wait for it.
- **You lose the relational toolbox.** No `Migrate()` and no scaffolding, so schema
  changes are your code's job, handled by tolerant reads and versioned documents.
- **Unexecuted claims here.** I could not run an emulator or a Mongo server, so the
  model, the SQL text and the failures above are real output, while request-unit
  costs, transaction behavior and server-side errors come from the official
  documentation.

## Documentation Links

- [Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/) (doc)
- [Modeling with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/modeling) (doc)
- [Querying with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/querying) (doc)
- [Saving data with the Azure Cosmos DB provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/saving) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Database providers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/) (doc)
- [Partitioning and horizontal scaling in Azure Cosmos DB, Microsoft Learn](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) (doc)
- [MongoDB Entity Framework Core Provider documentation](https://www.mongodb.com/docs/entity-framework/current/) (doc)
- [Feature limitations, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/limitations/) (doc)
- [Embedded relationships and manual references, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/model-data/relationships/) (doc)
- [Batch changes with transactions, MongoDB EF Core Provider](https://www.mongodb.com/docs/entity-framework/current/interact-data/transactions/) (doc)
