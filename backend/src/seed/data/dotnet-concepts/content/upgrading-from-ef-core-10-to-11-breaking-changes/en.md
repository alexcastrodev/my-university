---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Moving from EF Core 10 to 11 is mostly a package bump, and that is the danger:
the project builds, and a few behaviors are different anyway. Three of the
changes below produce no compile error at all. One makes an application that
starts fine today throw on its first request, one makes a query stop translating,
and one swaps SQL on SQL Server without any exception.

This concept is the upgrade checklist for those changes. Each item was reproduced
with EF Core 11.0.0 on SQLite, or with SQL Server SQL generated offline by
`ToQueryString()` (no server involved), and compared with EF Core 10.0.14 where the
difference was the point. Items taken only from the documentation are marked. A
companion lab, which starts from EF Core 10 style code on 11.0.0 and has you fix
each break, is linked from this concept. The feature side of the release is in
`whats-new-in-ef-core-11`.

## Use Cases

- Planning the upgrade of a service that sits on the EF Core 10 LTS and deciding
  what to test first.
- Reviewing a pull request that bumps the EF packages and has a green build.
- Finding why a suite that calls `Migrate()` against a context without
  migrations started to fail after the bump.
- Checking whether a provider you depend on already has a release for EF Core 11.

## Deep Dive

### A safe order for the upgrade

1. Bump `Microsoft.EntityFrameworkCore.*` and the provider together, and the
   target framework to `net11.0`. EF Core 11 requires .NET 11.
2. Build and read the warnings, not only the errors. Obsolete mappings and the
   `EF1004` analyzer show up here.
3. Run the whole test suite, including the tests that call `EnsureCreated()` and
   `Migrate()`.
4. On a copy of a real database, run the queries that matter and diff the SQL.
   `ToQueryString()` or `LogTo` makes the diff cheap.
5. Only then touch production, with the usual migration discipline from
   `applying-migrations-in-production`.

### 1. Migrate() without migrations now throws

A project that never added a migration but calls `Database.Migrate()` at startup
returned quietly on EF Core 10. On EF Core 11 it throws:

```text
InvalidOperationException: An error was generated for warning
'Microsoft.EntityFrameworkCore.Migrations.MigrationsNotFound':
No migrations were found in assembly 'up'. A migration needs to be added before
the database can be updated. This exception can be suppressed or logged by passing
event ID 'RelationalEventId.MigrationsNotFound' ...
```

The check is "the assembly has zero migrations": `GetMigrations().Count()` was `0`
in the test. There are two honest fixes. If the project really has no
migrations, create the schema from the model with `EnsureCreated()`. If it should
have migrations, add the first one. Ignoring the event also works, and `Migrate()`
then returns without creating anything:

```csharp
options.ConfigureWarnings(w => w.Ignore(RelationalEventId.MigrationsNotFound));
// Migrate() returns, and the Things table does not exist: the schema is still empty
```

On SQLite, after the ignored `Migrate()` the `sqlite_master` table had no table
for the entity. Suppressing the warning hides
the mistake and keeps the bug. Test suites that migrate a database per test are
the most common victim; see `testing-ef-core-queries-concurrency-and-migrations`.

### 2. Property() no longer makes a primitive collection

On EF Core 10, `Property(c => c.Tags)` over a `List<string>` was enough, and
`c.Tags.Contains("a")` translated. On EF Core 11 the same mapping builds, saves and
loads, but the query fails at run time:

```csharp
modelBuilder.Entity<Customer>().Property(c => c.Tags);
db.Customers.Where(c => c.Tags.Contains("a")).ToList();
// InvalidOperationException: The LINQ expression 'DbSet<Customer>() ... Contains("a")'
//   could not be translated. ... Translation of method 'System.Linq.Enumerable.Contains' failed.
```

The fix is the explicit call:

```csharp
modelBuilder.Entity<Customer>().PrimitiveCollection(c => c.Tags);
```

```sql
-- SQLite
WHERE 'a' IN (SELECT "t"."value" FROM json_each("c"."Tags") AS "t")
-- SQL Server, offline
WHERE N'a' IN (SELECT [t0].[value] FROM OPENJSON([t].[Tags]) WITH ([value] nvarchar(max) '$') AS [t0])
```

On SQL Server the failure with `Property()` reproduced too (offline). At
compatibility level 170 with the `json` type, the same query becomes
`JSON_CONTAINS([t].[Tags], N'a') = 1`. Because the failure only appears when the
query runs, grep for `Property(` over `List<` and array members and cover each
with a test. The mapping rules are in `ef-core-model-building-conventions-and-fluent-api`.

### 3. OwnsMany(...).ToJson() is obsolete

An owned collection mapped to JSON without an explicit key still works, but the
model validation logs `RelationalEventId.OwnedEntityMappedToJsonCollectionWarning`:

```text
The entity type 'Note' is an owned entity type mapped to JSON as a collection, which
uses a synthesized ordinal key. Mapping owned entity collections to JSON is obsolete;
map it as a complex type collection or configure a non-shadow key instead.
```

Replace it with a complex collection:

```csharp
// before
customer.OwnsMany(c => c.Notes, n => n.ToJson());
// after
customer.ComplexCollection(c => c.Notes, n => n.ToJson());
```

The stored shape did not change in a test: rows written with `OwnsMany(...).ToJson()`
held `[{"Text":"a"},{"Text":"b"}]`, and a context that maps the same property as a
complex collection read them back as `a` and `b`. That was one simple type on
SQLite, so compare the stored JSON on a copy before you ship. To keep the warning
from returning, make it fail the test run:

```csharp
options.ConfigureWarnings(w => w.Throw(RelationalEventId.OwnedEntityMappedToJsonCollectionWarning));
```

Complex types differ from owned entities in identity and tracking; see
`json-columns-and-complex-types`.

### 4. SQL Server: the default compatibility level moved

Without `UseCompatibilityLevel`, EF Core 11 assumes level 160 (SQL Server 2022).
Queries that used to run in the client move to the server:

```csharp
db.Scores.Select(s => Math.Max(s.Rating, s.Views)).ToQueryString();
// EF Core 10:  SELECT [s].[Rating], [s].[Views]
// EF Core 11:  SELECT GREATEST([s].[Rating], [s].[Views])
```

A SQL Server 2019 database has no `GREATEST`, so the query fails on the server, at
run time. Tell the provider the real level:

```csharp
options.UseSqlServer(cs, sql => sql.UseCompatibilityLevel(150));  // SQL Server 2019
```

With 150 the offline SQL went back to the client-side form. The `json` column type
needs level 170, as on EF Core 10, so nothing changes there. An integration test
that calls `ToQueryString()` and checks `DoesNotContain("GREATEST")` is cheap and
does not need a server.

### 5. Build tooling and analyzers

- **`EF1004`**: calling `ToAsyncEnumerable()` on an `IQueryable` iterates
  synchronously, and the 11.0.0 build warns about it. The fix is
  `AsAsyncEnumerable()`. If the build treats warnings as errors, expect new
  failures here.
- **`EFOptimizeContext`** (documentation only): the breaking changes page lists the
  MSBuild property as removed, replaced by `EFScaffoldModelStage` and
  `EFPrecompileQueriesStage`. Compiled models and precompiled queries remain
  experimental, so do not read the rename as stability. `native-aot-and-its-limits`
  covers where that matters.
- **Generated SQL in snapshots**: tests that compare `ToQueryString()` text to a
  stored string will fail wherever the SQL got leaner. Review each diff instead of
  accepting all of them.

### 6. Providers and tools you do not control

Whether the upgrade is possible at all depends on the provider. The NuGet listings
on November 12, 2026 showed the Microsoft providers (SQL Server, SQLite, Cosmos DB)
on 11.0.0; the MongoDB provider on 10.0.5; Pomelo MySQL still on 9.0.0, with no
release for 10 or 11; and `MySql.EntityFrameworkCore` stable at 10.0.12 with
11.0.0 in preview. Treat this as a snapshot from the registry, not something that
was run. For a provider with no EF Core 11 build, the answer is to stay on 10 until
there is one. `ef-core-ado-net-dapper-and-nosql` discusses choosing providers.

One more tooling note: keep the `dotnet ef` tool on the same major version as the
packages, and pin it in a tool manifest so the CLI is not older than the project.

### What did not break

Things that were checked and worked on 11.0.0: complex types mapped to JSON, and
`EnsureCreated()` creating a table-per-type hierarchy with a JSON complex property.
The generated SQL changes in `whats-new-in-ef-core-11` are improvements, not
regressions, but they are changes all the same, and the snapshot of a new migration
gains the `LastMigrationId` line described there.

## Trade-offs

- **Upgrading now or staying on the LTS.** EF Core 10 is supported until November
  10, 2028. The breaks above are small and each has a short fix, so the real cost is
  verification. A team with weak tests may prefer to stay on 10 until its safety net
  is better, and a team that wants the new SQL can go now.
- **Fixing the call or suppressing the warning.** `Ignore(MigrationsNotFound)`
  makes the symptom disappear and leaves an empty schema. Fix the cause: create the
  schema, or add the migration.
- **A test that throws on warnings makes upgrades loud.** Promoting
  `OwnedEntityMappedToJsonCollectionWarning` to an error is useful in CI, and it
  also fails the build of every model that still has the old mapping, which may be
  more than the upgrade branch can carry.
  ```csharp
  w.Throw(RelationalEventId.OwnedEntityMappedToJsonCollectionWarning)
  ```
- **Pin the compatibility level, even when the default is right.** Setting it
  explicitly turns a silent default into a visible decision that survives the next
  default change.
- **Offline SQL is evidence, not proof.** `ToQueryString()` shows what EF generates
  for SQL Server, and a server of an older level may still reject it. Keep one test
  against a real instance of the oldest version you support.

## Documentation Links

- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
- [Microsoft.EntityFrameworkCore, NuGet](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore) (doc)
- [SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/) (doc)
- [Applying migrations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying) (doc)
