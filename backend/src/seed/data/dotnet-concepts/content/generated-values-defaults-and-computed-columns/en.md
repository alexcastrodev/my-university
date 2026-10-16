---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Some columns get their value from the database instead of from your code: an
auto-increment key, a `DEFAULT`, a computed column, a trigger. EF Core has to know
two things about each of them: when not to send a value, and when to read one
back. This concept shows how `HasDefaultValue`, `HasDefaultValueSql`,
`HasComputedColumnSql`, `ValueGeneratedOnAdd` and `ValueGeneratedOnAddOrUpdate`
answer those questions, with the real `INSERT` and `UPDATE` statements from EF
Core 10 on SQLite and the SQL Server DDL generated for the same model. Row
versions for concurrency are covered in the transactions concept and are not
repeated here.

## Use Cases

- A `CreatedAt` column the database fills, so every writer (app, script, import
  job) agrees on the clock.
- A `Status` with a default that a migration also applies to existing rows when
  the column is added.
- A display name or total computed in the database and always consistent.
- An `UpdatedAt` maintained by a trigger.
- Order numbers drawn from a sequence shared by several tables.

## Deep Dive

### The model

```csharp
var e = modelBuilder.Entity<Account>();
e.Property(x => x.Status).HasDefaultValue("Active");
e.Property(x => x.Credits).HasDefaultValue(10);
e.Property(x => x.Bonus).HasDefaultValue(5).HasSentinel(-1);      // public int Bonus { get; set; } = -1;
e.Property(x => x.IsActive).HasDefaultValue(true);
e.Property(x => x.CreatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");
e.Property(x => x.UpdatedAt).ValueGeneratedOnAddOrUpdate();      // set by a trigger
e.Property(x => x.FullName).HasComputedColumnSql("FirstName || ' ' || LastName", stored: true);
```

Saving `new Account { FirstName = "Ana", LastName = "Silva" }` sends only the
columns EF Core thinks you set, and asks for the rest back in the same statement:

```sql
INSERT INTO "Accounts" ("FirstName", "IsActive", "LastName", "OrderNo")
VALUES (@p0, @p1, @p2, @p3)
RETURNING "Id", "Bonus", "CreatedAt", "Credits", "FullName", "Status", "UpdatedAt";
-- after save: Id=1 Status=Active Credits=10 IsActive=False Full=Ana Silva Created=2026-10-15
```

The `RETURNING` clause (SQL Server uses `OUTPUT`) is how generated values reach
your object without a second query.

### The CLR default is the "not set" signal

EF Core cannot tell "I did not set `Credits`" from "I set `Credits` to 0": both
are `0`. By default it uses the CLR default of the type as a sentinel and leaves
the column out of the `INSERT` when the property holds it. Inserting
`Credits = 0, Bonus = 0, IsActive = false`:

```sql
INSERT INTO "Accounts" ("Bonus", "FirstName", "IsActive", "LastName", "OrderNo") ...
-- after save: Credits=10 IsActive=False Bonus=0
```

`Credits` was omitted, so the database wrote 10 over an intentional zero. `Bonus`
has `HasSentinel(-1)` (EF Core 8 and later) and an initializer of `-1`, so zero is
an ordinary value and only `-1` means "use the default". The EF Core 8 notes also
describe the `bool` case: with a default of `true`, the CLR default `false` would
always be replaced, so EF Core 8 sets a bool's sentinel to the database default.
That is why `IsActive` is always sent: an unset `bool` is stored as `false`, and
the `DEFAULT 1` only matters to other writers. A nullable backing field is the
general fix when no sentinel value is free.

### Who generates, not how

`ValueGeneratedOnAdd` tells EF Core that something else produces the value; it
does not produce one. A `Guid` key gets a client-side generator by convention,
but a non-key `Guid` marked `ValueGeneratedOnAdd` does not:

```csharp
db.Add(new Ticket());   // after Add: Id=85bd2ff5-... Ref=00000000-0000-0000-0000-000000000000
db.SaveChanges();
// INSERT INTO "Ticket" ("Id") VALUES (@p0) RETURNING "Ref";
// DbUpdateException: SQLite Error 19: 'NOT NULL constraint failed: Ticket.Ref'.
```

EF Core expected the database to fill `Ref`, and nothing in the schema does. Either
give the column a default, or attach a client generator, as the SQL Server page
shows for non-key GUIDs:

```csharp
b.Entity<Ticket>().Property(t => t.Ref).HasValueGenerator<SequentialGuidValueGenerator>();
// INSERT INTO "Ticket" ("Id", "Ref") VALUES (@p0, @p1);
```

The same applies to dates. Providers do not set up generation for `DateTime` on
their own; you choose `HasDefaultValueSql` for creation time and something real,
usually a trigger, for "last updated".

### Computed columns and triggers

Changing `LastName` makes EF Core read the computed column back:

```sql
UPDATE "Accounts" SET "LastName" = @p0 WHERE "Id" = @p1
RETURNING "FullName", "UpdatedAt";
-- Full=Ana Souza Updated=null
```

`FullName` is correct, but `UpdatedAt` came back null, although a follow-up query
showed the trigger had set it (`in the database: 2026`). SQLite documents that
`RETURNING` emits the values computed before triggers run. The EF Core SQLite page
lists triggers among the limitations of `RETURNING` and offers an opt-out per
table:

```csharp
b.Entity<Account>().ToTable(tb => tb.UseSqlReturningClause(false));
// UPDATE "Accounts" SET "LastName" = @p0 WHERE "Id" = @p1;
// SELECT "FullName", "UpdatedAt" FROM "Accounts" WHERE changes() = 1 AND "Id" = @p1;
// Full=Ana Costa Updated=2026
```

SQL Server has the matching switch, `UseSqlOutputClause(false)`, for tables with
triggers. Assigning a computed property yourself is silently ignored:
`FullName = "Fake"` was left out of the `INSERT` and the object came back with
`Full=Caio Reis`.

### What other providers generate

SQLite has no sequences (listed in its provider limitations). Generating the SQL
Server script for the same model needs no server, only
`UseSqlServer(...)` and `Database.GenerateCreateScript()`:

```sql
CREATE SEQUENCE [OrderNumbers] START WITH 1000 INCREMENT BY 1 NO CYCLE;
CREATE TABLE [Accounts] (
    [Id] int NOT NULL IDENTITY,
    [FullName] AS [FirstName] + N' ' + [LastName] PERSISTED,
    [Status] nvarchar(max) NULL CONSTRAINT [DF_Accounts_Status] DEFAULT N'Active',
    [IsActive] bit NOT NULL DEFAULT CAST(1 AS bit),
    [CreatedAt] datetime2 NOT NULL DEFAULT (GETUTCDATE()),
    [OrderNo] bigint NOT NULL DEFAULT (NEXT VALUE FOR OrderNumbers), ...
```

The sequence came from `HasSequence<long>("OrderNumbers").StartsAt(1000)` plus
`HasDefaultValueSql("NEXT VALUE FOR OrderNumbers")`. The named default constraint
came from `HasDefaultValue("Active", "DF_Accounts_Status")`, an EF Core 10 option
for SQL Server; the EF Core 10 map lists the other changes of that release. The
SQL fragments are provider-specific: `CURRENT_TIMESTAMP` and `||` on SQLite,
`GETUTCDATE()` and `+` on SQL Server.

## Trade-offs

- **Database defaults versus C# initializers.** A default in the database holds
  for every writer and is applied to existing rows when a migration adds the
  column; a C# initializer only holds for your app but has no sentinel trap.
  ```csharp
  public string Status { get; set; } = "Active"; // always sent, no surprise on insert
  ```
- **Zero, false and empty can be swallowed.** Any default on a non-nullable value
  type needs a free sentinel or a nullable backing field, or an intentional `0`
  becomes the default.
- **Generated means EF Core waits for a value.** Mark a property generated without
  a database mechanism and the insert fails, or worse, stores a default silently.
- **Triggers and `RETURNING` disagree.** Values changed by a trigger are stale in
  memory unless you disable `RETURNING`/`OUTPUT` for that table, at the cost of an
  extra `SELECT` per row.
- **Computed SQL is not portable.** The expression is raw SQL. Tests on SQLite do
  not validate the SQL Server expression; generate the script for the real
  provider and review it.
- **Identity versus sequence versus client keys.** Identity is simplest; a sequence
  can feed several tables; client-generated GUIDs avoid a round trip when inserting
  a graph. Moving between them later is a data migration.

## Documentation Links

- [Generated values, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/generated-properties) (doc)
- [What's new in EF Core 8, sentinel values and database defaults, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#sentinel-values-and-database-defaults) (doc)
- [Sequences, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/sequences) (doc)
- [SQL Server value generation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/value-generation) (doc)
- [SQLite provider: SaveChanges and the RETURNING clause, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/misc) (doc)
- [SQLite EF Core database provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [The RETURNING clause, SQLite](https://sqlite.org/lang_returning.html) (doc)
