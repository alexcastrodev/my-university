---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

EF Core 11.0.0 shipped on November 10, 2026, together with .NET 11. For someone
who already runs EF Core 10, the release is mostly invisible: the same queries
produce leaner SQL, a handful of operators that used to throw now translate, and
a few mappings gain provider-specific features for SQL Server 2025 and Cosmos DB.
The cost of the release is in the details that change behavior without a compile
error, and those are in `upgrading-from-ef-core-10-to-11-breaking-changes`.

This concept is the map for the feature side. Wherever the code could be run, the
text shows the real output of EF Core 11.0.0 beside EF Core 10.0.14 with the same
code. SQL for SQL Server was generated offline with `ToQueryString()` and
`GenerateCreateScript()`, with no server involved, so it proves what EF generates
and not that a server accepts it. Anything taken only from the documentation is
said to be so.

## Use Cases

- Deciding whether to leave the EF Core 10 LTS for the 11 STS, and what you gain.
- Reading generated SQL after an upgrade and recognizing why it got shorter.
- Replacing client-side workarounds (`List.Exists`, `byte[].Any()`, ordered
  `string.Join`) with queries that run in the database.
- Finding out which features need SQL Server 2025 or Cosmos DB before promising
  them to a team.

## Deep Dive

### Release basics

EF Core 11 requires .NET 11 and is a Standard Term Support release. EF Core 10 is
the LTS and stays supported until November 10, 2028, so staying on 10 is a valid
choice; `dotnet-support-lifecycle-and-choosing-a-target` explains how to choose.
The previous map is `whats-new-in-ef-core-10`.

Two details on the official "What's new" page do not match the shipped package.
It calls the new Cosmos transaction default `Auto`, but the enum members are
`WhenNeeded`, `Always` and `Never`. It names the bulk option
`BulkExecutionEnabled()`, but the method that compiles is
`BulkExecutionAllowed()`. When the docs and the compiler disagree, the compiler
is right.

### Leaner SQL, with no code change

The same LINQ, run on both versions, gives different SQL. The first example is a
split query over two reference and collection includes, executed on SQLite:

```csharp
db.Blogs.Include(b => b.BlogType).Include(b => b.Posts).AsSplitQuery().ToList();
```

```sql
-- EF Core 10, second command
SELECT "p"."Id", "p"."BlogId", "p"."Title", "b"."Id", "b0"."Id"
FROM "Blogs" AS "b"
INNER JOIN "BlogType" AS "b0" ON "b"."BlogTypeId" = "b0"."Id"
INNER JOIN "Posts" AS "p" ON "b"."Id" = "p"."BlogId"
ORDER BY "b"."Id", "b0"."Id"

-- EF Core 11, second command
SELECT "p"."Id", "p"."BlogId", "p"."Title", "b"."Id"
FROM "Blogs" AS "b"
INNER JOIN "Posts" AS "p" ON "b"."Id" = "p"."BlogId"
ORDER BY "b"."Id"
```

The join to the reference navigation is gone from the child command and the
`ORDER BY` no longer carries the key of the reference navigation. Fewer
columns to sort and a smaller join are the kind of change that helps without being
measurable in a toy database, so measure on yours.

A `GroupBy` that aggregates over a reference navigation lost its correlated
subquery (SQL Server, offline):

```sql
-- EF Core 10
SELECT [p].[BlogId] AS [Key], (
    SELECT MAX([b].[Name])
    FROM [Posts] AS [p0]
    INNER JOIN [Blogs] AS [b] ON [p0].[BlogId] = [b].[Id]
    WHERE [p].[BlogId] = [p0].[BlogId]) AS [Top]
FROM [Posts] AS [p]
GROUP BY [p].[BlogId]

-- EF Core 11
SELECT [p].[BlogId] AS [Key], MAX([b].[Name]) AS [Top]
FROM [Posts] AS [p]
INNER JOIN [Blogs] AS [b] ON [p].[BlogId] = [b].[Id]
GROUP BY [p].[BlogId]
```

And a no-op `CAST` disappeared. With a value converter whose provider type is
already a string, `EF.Functions.Like(u.Name, "Name%")` used to produce
`WHERE CAST([u].[Name] AS nvarchar(max)) LIKE N'Name%'`, which blocks an index
seek; EF Core 11 emits `WHERE [u].[Name] LIKE N'Name%'`. Deeper reading of
generated SQL is in `query-translation-and-performance`.

### Translations that now work

These threw `InvalidOperationException` ("could not be translated") or did not
exist on EF Core 10. All ran on EF Core 11.0.0 with SQLite unless noted.

- **`List<T>.Exists`** over a navigation becomes `WHERE EXISTS (SELECT 1 FROM ...)`.
  On EF Core 10 it fails with the translation error.
- **`byte[].Any()`** becomes `DATALENGTH(...) > 0` on SQL Server (offline). Also a
  failure on EF Core 10.
- **`FullJoin`** translates to `FULL JOIN`, which SQLite 3.53.4 executed.
- **`MaxByAsync` and `MinByAsync`** run in one statement:
  `ORDER BY (SELECT COUNT(*) ...) DESC LIMIT 1`, with no client-side step.
- **Ordered `string.Join` over `GroupBy`** becomes
  `group_concat("p"."Title", '|' ORDER BY "p"."Id" DESC)` on SQLite. EF Core 10
  produced a `LEFT JOIN` and assembled the text in memory.
- **`DateTimeOffset` members** such as `UtcDateTime` become
  `CONVERT(datetime2, [p].[Created] AT TIME ZONE 'UTC')` on SQL Server (offline).

### Math.Max and Math.Min depend on the compatibility level

On SQL Server, EF Core 11 assumes compatibility level 160 (SQL Server 2022)
when you do not set one. At that level `Math.Max` and `Math.Min` map to `GREATEST`
and `LEAST`:

```csharp
db.Posts.Select(p => Math.Max(p.Rating, p.Views));
```

```sql
-- EF Core 10: SELECT [p].[Rating], [p].[Views]     (max computed in the client)
-- EF Core 11: SELECT GREATEST([p].[Rating], [p].[Views])
-- EF Core 11 with UseCompatibilityLevel(150): back to the client-side form
```

If the production server is older than 2022, set the level explicitly with
`UseSqlServer(cs, o => o.UseCompatibilityLevel(150))`. This one is also a breaking
change, covered in the upgrade concept, and `EF.Functions.Greatest` and `Least`
exist for explicit use.

### JSON and complex types

Indexes over a path inside a JSON column are now generated. Configure them with a
string path and the provider writes the right DDL:

```csharp
e.ComplexProperty(c => c.Contact, c => c.ToJson());
e.HasIndex("Contact.City");
```

```sql
-- SQLite, executed
CREATE INDEX "IX_Customers_Contact_City" ON "Customers" ("Contact" ->> 'City');

-- SQL Server, compatibility level 170 and a json column (offline)
CREATE JSON INDEX [IX_Customers_Contact_City] ON [Customers]([Contact]) FOR (N'$.City');
```

On SQLite a path over all elements of an array is refused when the model is built
(`SQLite does not support indexes over all elements of a JSON array`); a fixed
position such as `Items[0].Sku` is accepted. Complex types with JSON mapping also
work in a table-per-type hierarchy now (`EnsureCreated` succeeded in a test).
Mapping details are in `json-columns-and-complex-types`.

### Migrations: the snapshot knows the last migration

The model snapshot generated by `dotnet ef migrations add` in 11.0.0 contains

```csharp
// If you encounter a merge conflict in the line below, it means you need to
// discard one of the migration branches and recreate its migrations on top of
// the other branch.
public override string LastMigrationId => "20261112001413_Initial";
```

Two branches that each add a migration now conflict in this line when merged,
instead of merging without complaint and producing a broken chain. The conflict is
the intended warning. More on branches in `ef-core-migrations-workflow`.

### SQL Server 2025 (SQL generated offline)

Everything in this section was generated with `GenerateCreateScript()` and
`ToQueryString()` against `UseSqlServer` at compatibility level 170, with no
connection. Check the edition and the feature status of your server before
relying on it. A vector index, a full-text catalog and a full-text index can be
part of a migration:

```csharp
b.Entity<Article>().HasVectorIndex(a => a.Embedding, "IX_Articles_Embedding")
    .HasMetric("cosine").HasType("DiskANN");
b.HasFullTextCatalog("ftCatalog");
b.Entity<Article>().HasFullTextIndex(a => a.Title).UseKeyIndex("PK_Articles").UseCatalog("ftCatalog");
```

```sql
CREATE VECTOR INDEX [IX_Articles_Embedding] ON [Articles]([Embedding]) WITH (METRIC = 'cosine', TYPE = 'DiskANN');
CREATE FULLTEXT CATALOG [ftCatalog];
CREATE FULLTEXT INDEX ON [Articles]([Title]) KEY INDEX [PK_Articles] ON [ftCatalog];
```

Queries follow: `VectorSearch(...).WithApproximate()` becomes
`SELECT TOP(@p1) WITH APPROXIMATE ... FROM VECTOR_SEARCH(...)`, and
`FreeTextTable<Article, int>` returns rows with `Key` and `Rank` that you join
back to the entity. A `vector` column is no longer selected when you load the
entity (`SELECT [a].[Id], [a].[Title]`); only an explicit projection brings
`[a].[Embedding]`. `whats-new-in-ef-core-10` has the earlier vector support.

### Cosmos DB

Checked on 11.0.0 without an emulator: `Database.AutoTransactionBehavior`
returns `WhenNeeded` for the Cosmos provider, the options expose
`BulkExecutionAllowed()`, a complex type produces a nested path
(`WHERE (c["ShippingAddress"]["City"] = "Lisbon")`), and a synchronous `ToList()`
throws `InvalidOperationException` ("Azure Cosmos DB does not support synchronous
I/O"). That transactional batches group writes per partition and what bulk
execution does at runtime come from the documentation, not from a run. The
provider concept is `ef-core-nosql-cosmos-db-and-mongodb`.

### Smaller items

- `ChangeTracker.GetEntriesForState` does not call `DetectChanges`. editing a property
  gave `0` modified entries until `DetectChanges()` was called, and then `1`.
- `RemoveDbContext<T>()` and a parameterless `AddPooledDbContextFactory<T>()`
  worked in a test, which helps integration tests that swap the database.
- The SQLite provider round-trips `Half`, and passes a `UInt128` parameter as text.
- The `EF1004` analyzer warns in the 11.0.0 build when `ToAsyncEnumerable()` is called on an
  `IQueryable`, because that iterates synchronously. Use `AsAsyncEnumerable()`.
- Split queries throw `DbQueryConcurrencyException` when rows change between the
  commands, instead of returning wrong data. That comes from the release notes and
  its pull request; SQLite does not reproduce it, so it is not shown here.

## Trade-offs

- **STS against LTS.** EF Core 11 gets about two years of support, EF Core 10 gets
  three. A team that upgrades every year gains the new SQL; a team that wants one
  upgrade per three years stays on 10.
- **Leaner SQL is a free gain you cannot switch off.** Query text changes, so
  plan-cache keys, query hints in logs and snapshot tests over `ToQueryString()`
  all see new strings. Re-record them in the upgrade.
- **A new default can be a new requirement.** `GREATEST` needs SQL Server 2022.
  With an older server you must set the compatibility level yourself, or queries
  fail at runtime and not at build time.
  ```csharp
  o.UseSqlServer(cs, sql => sql.UseCompatibilityLevel(150));
  ```
- **Docs are ahead of the package.** Names such as `BulkExecutionEnabled()` did
  not survive to the release. Check the API in your editor.
- **Provider-only features reduce portability.** Vector and full-text indexes, JSON
  indexes and Cosmos batches do not exist on every database, so code that uses them
  ties the model to one provider.
- **Third-party providers lag.** A provider for MongoDB, MySQL or others may still
  target EF Core 10 on release day. Check NuGet before you commit to the upgrade.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [Vector search, SQL Server provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Migrations overview, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/) (doc)
- [.NET 11 release notes, GitHub](https://github.com/dotnet/core/tree/main/release-notes/11.0) (doc)
