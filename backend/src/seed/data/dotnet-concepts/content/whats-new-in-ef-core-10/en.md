---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

EF Core 10 shipped in November 2025 as a Long Term Support release, and the
"What's new" page lists dozens of items across providers, modeling, querying and
security. This concept is a map, not a tutorial: it groups the headline changes,
says in a few lines what each one does, and points to the concept in this track
that goes deep. Items that have no deep concept yet are only described here.

After reading it you should know which changes can affect an upgrade, which
ones are optional features, and where to read next.

## Use Cases

- Planning the move from EF Core 8 or 9 to 10 and deciding what to test first.
- Reviewing a pull request that uses a new API such as a named query filter.
- Explaining to a team which new features need SQL Server 2025 or Azure SQL and
  which work on any provider.
- Finding the right deep concept without reading the whole release page.

## Deep Dive

### Release basics

The official page states that EF Core 10 requires the .NET 10 SDK to build and
the .NET 10 runtime to run, and that it will not run on earlier .NET versions or
on .NET Framework. It is an LTS release supported until November 10, 2028. The
support model and how to choose a target is in
`dotnet-support-lifecycle-and-choosing-a-target`.

### Modeling: complex types and JSON

Complex types gained the most. They now support optional values (the type needs
at least one required property), mapping to a JSON column with `ToJson`, and
.NET structs (collections of structs are not supported yet). The page explains
why complex types are a better choice than owned entities for table splitting
and JSON: value semantics, comparison by content, assignment that copies.
Existing owned-type mappings are advised to move over.

On SQL Server 2025 and Azure SQL the native `json` type becomes the default when
you configure `UseAzureSql` or compatibility level 170 or higher. Existing
`nvarchar` JSON columns change to `json` in the next migration unless you opt
out. Read `json-columns-and-complex-types` for the details, and
`mapping-the-domain-with-ef-core` for value objects in general.

### Updates: ExecuteUpdate

Two changes touch `ExecuteUpdateAsync`. It can reference JSON columns and the
properties inside them, but only when the types are mapped as complex types. And
it now accepts a regular lambda instead of an expression tree, so a conditional
`SetProperty` is an ordinary `if`. The JSON side lives in
`json-columns-and-complex-types`, the set-based update in general in
`query-translation-and-performance` and `ef-core-crud-operations-and-seeding`.

### Querying

- **Named query filters.** `HasQueryFilter` takes a name, and
  `IgnoreQueryFilters` can disable only some filters per query. Soft delete and
  tenant filters can now coexist on one entity. See
  `global-and-named-query-filters`.
- **Parameterized collections.** The new default sends each element as its own
  scalar parameter and pads the list to limit distinct SQL texts. You can switch
  strategy globally with `UseParameterizedCollectionMode` or per query with
  `EF.Constant`. This is described on the page; the closest deep concept is
  `query-translation-and-performance`.
- **`LeftJoin` and `RightJoin`.** The .NET 10 LINQ operators are recognized by
  EF Core and translated to `LEFT JOIN` and `RIGHT JOIN`. Query syntax cannot
  express them yet. Also covered by `query-translation-and-performance`.
- **Split queries.** Ordering is now consistent between the queries of an
  `AsSplitQuery` call. See `loading-related-data-and-n-plus-one`.
- Smaller items include new translations such as `DateOnly.ToDateTime()` and
  simpler parameter names (`@city` instead of `@__city_0`).

### Security

Constants inlined into SQL, for example through `EF.Constant`, are redacted from
logs as `?` unless sensitive data logging is on. An analyzer warns when you
concatenate strings inside `FromSqlRaw`. Logging is in
`ef-core-logging-query-tags-and-diagnostics`, raw SQL in
`query-translation-and-performance`.

### SQL Server and Azure SQL

Besides the `json` type, EF Core 10 supports the `vector` type through
`SqlVector<float>` and the `VectorDistance` function, available on Azure SQL
Database and SQL Server 2025. `HasDefaultValueSql` accepts a constraint name, and
`UseNamedDefaultConstraints` names all of them; with existing migrations the
next one renames every default constraint. There is no deep concept for vector
search in this track yet.

### Cosmos DB

Full-text search (`EnableFullTextSearch`, `IsFullTextIndex`, `FullTextContains`
and related functions), hybrid search through `Rrf`, vector search leaving
preview with `IsVectorProperty` and `IsVectorIndex`, and required properties
that materialize a default when an old document lacks them. Choosing between
relational and document stores is in `ef-core-ado-net-dapper-and-nosql`.

### Migrations and other items

EF Core 10 stops wrapping all pending migrations in one transaction, reverting a
change from EF Core 9. See `applying-migrations-in-production` and
`ef-core-migrations-workflow`. SQLite also lets you disable AUTOINCREMENT.

## Trade-offs

- **A map is not a guide.** Each summary omits caveats the deep concept covers,
  such as JSON mapping limits. Follow the link before adopting a feature.
- **Defaults changed silently.** The `json` column type, parameter padding and
  per-migration transactions can alter behavior without a code edit. Check the
  breaking changes page and run your migrations on a copy.
- **Several features are provider specific.** Vector, native `json` and Cosmos
  search do not exist on every database, so code using them is less portable.
- **Choose complex types for new value objects.** Owned entities still work, but
  the page steers JSON and table splitting to complex types, and
  `ExecuteUpdate` over JSON needs them.
- **Named filters add rules to remember.** More filters means more places a query
  can be silently narrower than you expect.

## Documentation Links

- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Breaking changes in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/breaking-changes) (doc)
- [Vector search, SQL Server provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [Full-text search, Cosmos DB provider, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/cosmos/full-text-search) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
