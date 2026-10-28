---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

EF Core gives every relational provider the same LINQ and the same model API, so it is easy to believe that a `DbContext` behaves the same on PostgreSQL, SQL Server and SQLite. It does not. The provider decides the column types, the SQL each operator becomes, which values it refuses to write, how keys are generated, what a migration can do and whether a concurrency token is real. This lesson keeps one model and one set of LINQ queries and runs them on PostgreSQL 18.6 (a throwaway local cluster) and on SQLite, then shows what changed: string matching and collations, `DateTime` and `DateTimeOffset`, `decimal`, keys and GUIDs, migrations, arrays, JSON and enums, concurrency tokens, and why a test suite on SQLite proves little about production on PostgreSQL. SQL Server was not available, so for it I only generated DDL and SQL with `UseSqlServer` configured and never opened, and everything about its runtime behavior is attributed to the docs. Versions used: SDK 10.0.100, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14, `Microsoft.EntityFrameworkCore.SqlServer` 10.0.14, `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 (with `Npgsql` 10.0.3), PostgreSQL 18.6.

## Use Cases

- Choosing a production database and wanting to know which parts of the model will need provider-specific configuration.
- Moving an application from SQL Server to PostgreSQL, where case-insensitive searches and local `DateTime` values suddenly break.
- Deciding whether integration tests can run on SQLite in-memory or must run on the real engine.
- Reviewing a pull request that adds a `decimal`, a `DateTimeOffset`, an array or a concurrency token, and predicting how each provider stores it.

## Deep Dive

### One model, three providers

The model has four entities: `Person` (strings), `Event` (`DateTime`, `DateTimeOffset`, `DateOnly`, `TimeOnly`), `Item` (`decimal`, `string[]`, an enum, a JSON complex type, a concurrency token) and `Doc` (a `Guid` key). The provider is picked in `OnConfiguring`, and a few lines of `OnModelCreating` are provider-specific on purpose, so the differences are visible:

```csharp
_ = prov switch
{
    "pg"     => o.UseNpgsql("Host=127.0.0.1;Port=5831;...", n => n.MapEnum<Mood>("mood")),
    "sqlite" => o.UseSqlite("Data Source=prov.db"),
    _        => o.UseSqlServer("Server=nowhere;..."),   // never opened
};
```

On version matching: NuGet lists `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.3 as the latest stable (11.0.0 is at rc.3), and its nuspec depends on `Microsoft.EntityFrameworkCore` `[10.0.0, 11.0.0)`. The Npgsql major version follows the EF Core major, so EF Core 10 needs Npgsql 10.x. `GenerateCreateScript()` needs no connection, so it produced the DDL for all three providers. I quote parts of it below.

### Strings: the same LINQ, different rows

I inserted `alice`, `Alice`, `élan` and `Élan` into a plain string column and ran the same five queries on both engines:

```text
LINQ                     PostgreSQL (text)        SQLite (TEXT)
== "ALICE"               []                       []
Contains("LIC")          []                       []
StartsWith("AL")         []                       [alice, Alice]
Like(Name, "al%")        [alice]                  [alice, Alice]
Like(Name, "él%")        [élan]                   [élan]
```

The SQL explains the split. Both providers turned `StartsWith("AL")` into `LIKE 'AL%'`, but SQLite's `LIKE` ignores ASCII case and PostgreSQL's does not. `Contains("LIC")` became `LIKE '%LIC%'` on Npgsql and `instr("p"."Name", 'LIC') > 0` on SQLite, and `instr` is case-sensitive. On SQLite the non-ASCII `É` was never folded: `Like("él%")` missed `Élan`. For SQL Server I only generated the SQL (`WHERE [p].[Name] = N'ALICE'`, `LIKE N'%LIC%'`); the EF docs say the default server collation for an English (United States) install is `SQL_Latin1_General_CP1_CI_AS`, case-insensitive and accent-sensitive, so on such a server the first query would find both spellings. I did not run it. The functions lesson covers `EF.Functions.Like`, `ILike` and `Collate` themselves; here the point is that the default answer is a property of the database.

### Collations per column, per database, and citext

A collation can be set per column with `UseCollation`. I gave a second column (`NameCi`, same data) a case-insensitive collation on each engine. On PostgreSQL that means an ICU nondeterministic collation, which Npgsql creates for you:

```csharp
mb.HasCollation("ci", locale: "en-u-ks-level2", provider: "icu", deterministic: false);
mb.Entity<Person>().Property(p => p.NameCi).UseCollation("ci");    // PostgreSQL
mb.Entity<Person>().Property(p => p.NameCi).UseCollation("NOCASE"); // SQLite
```
```text
CREATE COLLATION ci (LOCALE = 'en-u-ks-level2', PROVIDER = icu, DETERMINISTIC = False);
"NameCi" text COLLATE ci NOT NULL           -- PostgreSQL
"NameCi" TEXT COLLATE NOCASE NOT NULL       -- SQLite
```
```text
LINQ on NameCi           PostgreSQL ICU "ci"      SQLite NOCASE
== "ALICE"               [alice, Alice]           [alice, Alice]
== "ÉLAN"                [élan, Élan]             [Élan]
Contains("LIC")          [alice, Alice]           []
Like(NameCi, "ÉL%")      [élan, Élan]             [Élan]
```

`NOCASE` folds ASCII only, and `instr` ignores the column collation, so `Contains` still found nothing on SQLite. A frequently quoted limitation says `LIKE` does not work with nondeterministic collations. On PostgreSQL 18.6 it worked, and the Npgsql docs agree: PostgreSQL 18 supports case-insensitive collations well, while earlier versions could not pattern-match with `LIKE` on such a column. Per those docs, the same query would fail on PostgreSQL 17 or older; I only ran 18.6.

The database default collation is a different story. `modelBuilder.UseCollation("ci")` made `EnsureCreated` send `CREATE DATABASE prov LC_COLLATE ci`, which failed with `42809: invalid LC_COLLATE locale name: "ci"`: the database default must be a locale, and the ICU collation only exists inside the database after it is created. The Npgsql docs say database collations do not support nondeterministic collations and suggest `configurationBuilder.Properties<string>().UseCollation("ci")` in `ConfigureConventions` instead, which puts the collation on every string column. The older alternative is the `citext` type (`HasPostgresExtension("citext")` plus `HasColumnType("citext")`): on a third column it matched `ALICE`, `ÉLAN`, `Contains("LIC")` and `Like("AL%")` case-insensitively, `É` included, on a cluster whose default locale was `C.UTF-8`.

### DateTime, DateTimeOffset, DateOnly and TimeOnly

Npgsql maps `DateTime` to `timestamp with time zone` and only accepts UTC values. I saved the same instant with each `Kind`:

```text
Kind=Utc          => saved
Kind=Local        => ArgumentException: Cannot write DateTime with Kind=Local to PostgreSQL type 'timestamp with time zone', only UTC is supported. Note that it's not possible to mix DateTimes with different Kinds in an array, range, or multirange. (Parameter 'value')
Kind=Unspecified  => ArgumentException: Cannot write DateTime with Kind=Unspecified to PostgreSQL type 'timestamp with time zone', ...
DateTimeOffset +01:00 => ArgumentException: Cannot write DateTimeOffset with Offset=01:00:00 to PostgreSQL type 'timestamp with time zone', only offset 0 (UTC) is supported.
```

The exceptions arrive wrapped in a `DbUpdateException` from `SaveChanges`. The Npgsql date and time page documents this as the 6.0 behavior and the `Npgsql.EnableLegacyTimestampBehavior` switch that restores the old one. SQLite accepted all three kinds and stored the same text, `2026-10-28 12:00:00`, so the `Kind` is gone: every value read back as `Unspecified`, including the one saved as UTC. SQL Server's generated DDL uses `datetime2` for `DateTime` and `datetimeoffset` for `DateTimeOffset`, which keeps the offset.

`DateTimeOffset` on SQLite is stored as text with its offset. I saved `12:00+01:00` (11:00 UTC) and `11:30+00:00` and queried them:

```text
raw At values    => [2026-10-28 12:00:00+01:00, 2026-10-28 11:30:00+00:00]
OrderBy(At)      => NotSupportedException: SQLite does not support expressions of type 'DateTimeOffset' in ORDER BY clauses. Convert the values to a supported type, or use LINQ to Objects to order the results on the client side.
Where(At > ...)  => InvalidOperationException: The LINQ expression '...' could not be translated. ...
Max(At)          => NotSupportedException: SQLite cannot apply aggregate operator 'Max' on expressions of type 'DateTimeOffset'. ...
At == ...        => WHERE "e"."At" = '2026-10-28 11:30:00+00:00'
```

EF Core 10 refuses rather than sorting text that would put 11:30 UTC before 11:00 UTC. Equality translates, but it compares text, so the same instant written with another offset is a different string. The SQLite limitations page lists `DateTimeOffset`, `TimeSpan` and `ulong` as types where only equality is translated and recommends UTC `DateTime` instead. `DateOnly` and `TimeOnly` were fine everywhere: `date`/`time without time zone` on PostgreSQL, ISO `TEXT` on SQLite (where `Day > 2026-01-01` worked because ISO text sorts correctly), `date`/`time` on SQL Server.

### Decimals

```text
                 PostgreSQL                         SQLite
column type      numeric; numeric(18,2) for Exact   TEXT for both
round trip       12345678901234567890.123456789     12345678901234567890.123456789
Exact = 1.005    1.01 (rounded by numeric(18,2))    1.005 (HasPrecision ignored)
Where(> 9.9m)    [10, 79228162514264337593543950335]  same rows
Sum(Precise)     12345678901234567890.423456789     12345678901234567890.423456789
Average(Exact)   6.8366666666666667                 6.835
```

I expected precision loss on SQLite and found none: the values were stored as `text` (checked with `typeof`) and came back exactly, including `decimal.MaxValue`. Comparison, ordering and aggregates also worked, through functions EF registers on the connection: `WHERE ef_compare("i"."Price", '9.9') > 0`, `ORDER BY "i"."Price" COLLATE EF_DECIMAL`, `SELECT COALESCE(ef_sum("i"."Price"), '0.0')`. The current SQLite limitations page says the same, so if you remember decimal ordering and aggregates as unsupported on SQLite, that is no longer true on EF Core 10. The real difference is `HasPrecision`: PostgreSQL rounded 1.005 to 1.01, SQLite kept 1.005, so the average differs. Without `HasPrecision`, Npgsql creates an unconstrained `numeric`. SQL Server creates `decimal(18,2)` and model validation logged, with no connection needed:

```text
warn: SqlServerEventId.DecimalTypeDefaultWarning[30000] No store type was specified for the decimal property 'Price' on entity type 'Item'. This will cause values to be silently truncated if they do not fit in the default precision and scale. ...
```

### Keys, GUIDs and batched inserts

```text
PostgreSQL  "Id" integer GENERATED BY DEFAULT AS IDENTITY
SQLite      "Id" INTEGER NOT NULL CONSTRAINT "PK_Events" PRIMARY KEY AUTOINCREMENT
SQL Server  [Id] int NOT NULL IDENTITY
```

For `Guid` keys all three generated the value on the client, but not the same kind of value. I printed three ids and `Guid.Version` per provider; for SQL Server the context only ran `Add`, which never touches the server:

```text
PostgreSQL  01a18365-8748-7cdb-ab9f-42f4f6de8ad8 v7   (time-ordered UUIDv7)
SQLite      dcae0beb-55fa-4c57-86ee-dca67e795492 v4   (random)
SQL Server  12235ace-48b6-4360-04ad-08df3512bb46 v4
            6411bdea-7ad5-4989-04ae-08df3512bb46      (fourth group counts up, last group fixed)
```

The SQL Server value generation docs say the provider generates "optimal sequential values, similar to SQL Server's NEWSEQUENTIALID". So ordering by the key means something different per provider: nothing on SQLite, and on PostgreSQL only time to the millisecond (my `b` and `c` shared a millisecond and their ids sorted the other way round). Saving three `Doc` and three `Person` rows showed the batching difference: Npgsql sent one `DbCommand` with six `INSERT` statements, the identity ones ending in `RETURNING "Id"`. SQLite sent six separate commands, also with `RETURNING "Id"` for identity rows.

### Migrations: ALTER COLUMN versus a table rebuild

I diffed two versions of the model (`Score` changed from `int` to `HasColumnType("bigint")`) with `IMigrationsModelDiffer` and fed the operations to each provider's `IMigrationsSqlGenerator`, which is what `migrations script` does:

```sql
-- PostgreSQL
ALTER TABLE "Items" ALTER COLUMN "Score" TYPE bigint;
-- SQL Server (generated only): drop any default constraint first, then
ALTER TABLE [Items] ALTER COLUMN [Score] bigint NOT NULL;
-- SQLite
CREATE TABLE "ef_temp_Items" ( ... "Score" bigint NOT NULL, ... );
INSERT INTO "ef_temp_Items" ("Id", "Address", ...) SELECT "Id", "Address", ... FROM "Items";
PRAGMA foreign_keys = 0;
DROP TABLE "Items";
ALTER TABLE "ef_temp_Items" RENAME TO "Items";
PRAGMA foreign_keys = 1;
```

SQLite has no `ALTER COLUMN`, so EF rebuilt the table: copy, drop, rename. The limitations page marks `AlterColumn`, `DropColumn`, foreign key, primary key, unique and check constraint changes as "rebuild", and says a `NotSupportedException` is still thrown for objects that are not part of the EF model, and that idempotent scripts are not possible on SQLite. A rebuild copies every row, so on a large SQLite table a one-word change becomes a full copy.

### Arrays, JSON and enums

```text
                   PostgreSQL                          SQLite
string[] Tags      text[]   {a,b}                       TEXT     ["a","b"]
Tags.Contains("a") WHERE 'a' = ANY (i."Tags")           WHERE 'a' IN (SELECT "t"."value" FROM json_each("i"."Tags") AS "t")
Address ToJson()   jsonb {"Zip": "1000", "City": "Lisbon"}  TEXT {"City":"Lisbon","Zip":"1000"}
Address.City       WHERE (i."Address" ->> 'City') = 'Lisbon'   WHERE "i"."Address" ->> 'City' = 'Lisbon'
Mood (MapEnum)     CREATE TYPE mood AS ENUM ('happy','sad'); = 'sad'::mood   INTEGER, = 1
```

I expected an "arrays unsupported" error on SQLite. EF Core 10 raised none: it maps a primitive collection such as `string[]` to a JSON text column on SQLite (and on SQL Server, where the generated SQL used `OPENJSON`), and `Contains` and `Count()` translated. PostgreSQL gets a real array type, and `jsonb` reordered the keys. Enums need `MapEnum<Mood>("mood")` on the Npgsql options to become a PostgreSQL enum type (the labels became lowercase); elsewhere they are integers. SQL Server's DDL used `nvarchar(max)` for the JSON columns by default and the native `json` type after `UseCompatibilityLevel(170)`.

### Concurrency tokens: real on PostgreSQL, silent on SQLite

On PostgreSQL a `uint` property with `IsRowVersion()` (or `[Timestamp]`) maps to the hidden system column `xmin`, so no DDL appears. The older `UseXminAsConcurrencyToken()` is gone: it gave `CS1061: 'EntityTypeBuilder<Doc>' does not contain a definition for 'UseXminAsConcurrencyToken'` with Npgsql 10.0.3. I loaded the same row in two contexts and saved both:

```text
Version after insert: 771
UPDATE "Items" SET "Price" = @p0 WHERE "Id" = @p1 AND xmin = @p2 RETURNING xmin;
Version after A: 772
B saves => DbUpdateConcurrencyException: The database operation was expected to affect 1 row(s), but actually affected 0 row(s); data may have been modified or deleted since entities were loaded. ...
final price 2
```

The same model on SQLite, with `IsRowVersion()` on a `byte[] Stamp`, created a `BLOB NULL` column that nothing ever fills:

```text
UPDATE "Items" SET "Price" = @p0 WHERE "Id" = @p1 AND "Stamp" IS NULL RETURNING "Stamp";
B saves => 1
final price 3.0
```

No exception, and the second writer silently overwrote the first: a lost update. The limitations page lists database-generated concurrency tokens as unsupported on SQLite. A token you set yourself works: with `IsConcurrencyToken()` and a new `Guid` written in `SaveChanges`, the update became `WHERE "Id" = @p2 AND "Stamp" = @p3` and the second save threw the same `DbUpdateConcurrencyException`. On SQL Server the generated DDL was `[Stamp] rowversion NULL`, which the docs say the server updates on every write.

### The testing trap

Every row above is a way for a test on SQLite to pass while PostgreSQL behaves differently: `StartsWith("AL")` found two rows on SQLite and none on PostgreSQL, a `DateTime.Now` saved fine on SQLite and threw on PostgreSQL, `HasPrecision` changed an average only on PostgreSQL, and the lost-update test passed on PostgreSQL but the bug went unnoticed on SQLite. SQLite in-memory (`Data Source=:memory:`) is the same engine with the same rules, so it inherits all of this. Use SQLite for fast tests of logic that does not depend on these behaviors, and run the queries, migrations and concurrency paths against the production engine, for example in a container started by the test suite.

### At a glance

| Behavior | PostgreSQL (measured) | SQLite (measured) | SQL Server (docs) |
|---|---|---|---|
| `==` and `LIKE` case | sensitive | `=` sensitive, `LIKE` ASCII-insensitive | insensitive by default collation (docs) |
| Case-insensitive column | ICU nondeterministic or `citext` | `NOCASE`, ASCII only | `_CI_` collation (docs) |
| `DateTime` | `timestamptz`, UTC only | TEXT, Kind lost | `datetime2` (docs) |
| `DateTimeOffset` | offset 0 only | TEXT, no ordering or comparison | `datetimeoffset`, keeps offset (docs) |
| `decimal` | `numeric`, precision enforced | TEXT, exact, `ef_compare` | `decimal(18,2)` default plus warning (docs) |
| `Guid` key | UUIDv7 | random v4 | sequential (docs) |
| Change column type | `ALTER COLUMN` | table rebuild | `ALTER COLUMN` (docs) |
| `string[]` | `text[]` | JSON text | JSON text or `json` (docs) |
| Concurrency token | `xmin` | manual only | `rowversion` (docs) |

## Trade-offs

- **Portability costs features.** Writing to the common subset (UTC `DateTime`, explicit `HasPrecision`, no arrays, a manual token) keeps the model portable, but gives up `text[]`, `jsonb`, PostgreSQL enums and `xmin`.
- **Case rules belong in the schema, not in queries.** A collation or `citext` on the column keeps indexes usable; `ToLower()` in every query does not, and a collation chosen per provider is configuration you must keep in sync.
  ```csharp
  configurationBuilder.Properties<string>().UseCollation("ci");   // Npgsql docs: instead of a database collation
  ```
- **UTC everywhere is the cheap fix.** Npgsql forces it, SQLite silently drops the `Kind`, so convert at the boundary and store UTC on every provider.
- **SQLite migrations rebuild tables.** Fine for a local file, slow for a big table, and objects created outside the model cannot be rebuilt.
- **A test on another engine tests that engine.** SQLite is fast and free, but collations, dates, precision and concurrency all diverged in this lesson; keep at least the data-access tests on the production database.
- **Not run here.** SQL Server was never contacted. Its DDL, SQL and warnings above were generated without a connection, and its runtime behavior comes from the docs.

## Documentation Links

- [Collations and case sensitivity, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/miscellaneous/collations-and-case-sensitivity) (doc)
- [SQLite database provider limitations, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [Microsoft SQL Server database provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/) (doc)
- [Collations and case sensitivity, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/misc/collations-and-case-sensitivity.html) (doc)
- [Date and time handling, Npgsql documentation](https://www.npgsql.org/doc/types/datetime.html) (doc)
- [Collation support, PostgreSQL documentation](https://www.postgresql.org/docs/current/collation.html) (doc)
