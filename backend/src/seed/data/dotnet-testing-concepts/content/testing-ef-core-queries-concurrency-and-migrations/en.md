---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

Some EF Core behavior only exists between your code and the database: how a
LINQ query becomes SQL, which rows a query filter hides, whether two writers
conflict, what a unique index violation looks like, and whether the migrations
build the schema the model expects. A fake provider runs your LINQ as C#, so it
sees none of this. The goal is an MSTest suite, on the real PostgreSQL from the
previous concept, that checks each of these rules and catches the bugs a
functional test misses: an N+1 query that returns the right numbers, a model
change without a migration, and a concurrency test that cannot fail.

## Use Cases

- Proving a search is case-insensitive on PostgreSQL, where `Contains` is not.
- Proving a tenant never sees another tenant's orders, even when a query
  switches off the soft-delete filter.
- Proving two users editing the same order get a `DbUpdateConcurrencyException`
  instead of a silent overwrite.
- Turning a unique index violation into a domain error the API can map to 409.
- Failing the build when someone changes the model and forgets
  `dotnet ef migrations add`.
- Keeping a list page at one SQL command as the data grows.

## Deep Dive

### What a fake cannot tell you

The InMemory provider evaluates queries as C# over lists. A query PostgreSQL
cannot translate still runs there:

```csharp
// Relational providers: InvalidOperationException, "could not be translated".
// InMemory provider: runs and returns the row.
await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => db.Orders
    .Where(o => o.CustomerName.Equals("acme corp", StringComparison.OrdinalIgnoreCase))
    .ToListAsync(testContext.CancellationToken));
```

That learning test is the first of many that need the real database. The lab
reuses the setup of the previous concept (one Testcontainers PostgreSQL per run,
one database per class, a `TRUNCATE` before each test), with one change: the
schema comes from the real migrations.

```csharp
public static async Task<TestDatabase> CreateAsync(string name)
{
    var database = new TestDatabase(await PostgresContainer.CreateDatabaseAsync(name));
    await using var db = database.NewContext("migrations");
    await db.Database.MigrateAsync();
    return database;
}
```

`EnsureCreated` builds the schema from the model and would hide a broken
migration. `MigrateAsync` builds it the way production gets it.

### Test the SQL behavior, not the LINQ

PostgreSQL compares strings case-sensitively. A search written with `Contains`
becomes `LIKE '%acme%'` and misses "ACME Corp". The module uses
`EF.Functions.ILike`, and the test is what keeps it that way:

```csharp
// OrderQueries
db.Orders
    .Where(o => EF.Functions.ILike(o.CustomerName, $"%{term}%"))
    .OrderBy(o => o.Number)
    .Select(o => o.Number)
    .ToListAsync(cancellationToken);

// Test
await _database.PlaceAsync(Seed.Acme, "A-1", "ACME Corp");
await _database.PlaceAsync(Seed.Acme, "A-2", "Initech");

await using var db = _database.NewContext(Seed.Acme);
var found = await new OrderQueries(db).SearchByCustomerAsync("acme", testContext.CancellationToken);

CollectionAssert.AreEqual(new[] { "A-1" }, found);
```

The summary query projects a count and a total per order. Its test includes an
order with no lines on purpose: EF Core translates the total to a correlated
subquery wrapped in `COALESCE(sum(...), 0.0)`, so that order gets `0`, not a
`NULL` that cannot become a `decimal`. `ToQueryString()` prints the SQL when you
want to see it.

### Query filters: test the filter you keep, not only the one you drop

EF Core 10 adds named query filters, so one entity can have several and a query
can switch off just one:

```csharp
order.HasQueryFilter(TenantFilter, o => o.TenantId == TenantId)
    .HasQueryFilter(SoftDeleteFilter, o => !o.IsDeleted);

// OrderQueries: deleted orders of the current tenant
db.Orders
    .IgnoreQueryFilters([OrdersDbContext.SoftDeleteFilter])
    .Where(o => o.IsDeleted)
```

The naive test deletes one order of the current tenant and expects it in the
list. It passes with `IgnoreQueryFilters()` too, which switches off every filter
and leaks other tenants' rows. The test only means something when the other
tenant has a deleted order as well:

```csharp
await _database.PlaceAsync(Seed.Acme, "A-1");
await _database.PlaceAsync(Seed.Globex, "G-1");
// ... delete A-1 as acme and G-1 as globex ...

await using var check = _database.NewContext(Seed.Acme);
var deleted = await new OrderQueries(check).DeletedNumbersAsync(Ct);

CollectionAssert.AreEqual(new[] { "A-1" }, deleted);
```

The tenant id is a property of the context (`new OrdersDbContext(options,
"acme")`), and EF Core reads it as a parameter each time the query runs, so one
model serves every tenant.

### Optimistic concurrency needs two contexts

Npgsql maps a `uint` property marked as row version to PostgreSQL's `xmin`
system column, which changes on every update of the row. No extra column, no
trigger:

```csharp
public uint Version { get; private set; }

order.Property(o => o.Version).IsRowVersion();
```

A conflict needs two readers of the same version. Two contexts are two users:

```csharp
await using var first = _database.NewContext(Seed.Acme);
await using var second = _database.NewContext(Seed.Acme);
var firstCopy = await first.Orders.SingleAsync(Ct);
var secondCopy = await second.Orders.SingleAsync(Ct);

firstCopy.ChangeCustomer("ACME Ltd");
await first.SaveChangesAsync(Ct);
secondCopy.ChangeCustomer("ACME Inc");

await Assert.ThrowsExactlyAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync(Ct));
await using var check = _database.NewContext(Seed.Acme);
Assert.AreEqual("ACME Ltd", (await check.Orders.SingleAsync(Ct)).CustomerName);
```

The tempting shortcut uses one context: load, change, save, change, save. It
never conflicts, because after each save the context refreshes the version it
tracks. The lab keeps that version as a learning test, and the mutation check
shows it stays green with the concurrency token removed.

### Map the unique violation to a domain error

The unique index on `(TenantId, Number)` is the guarantee; the service turns its
violation into something the caller can act on. The filter checks the SQLSTATE
and the index name, so an unrelated database error is not swallowed:

```csharp
catch (DbUpdateException e) when (e.InnerException is PostgresException
{
    SqlState: PostgresErrorCodes.UniqueViolation,
    ConstraintName: OrdersDbContext.UniqueOrderNumberIndex,
})
{
    db.Entry(order).State = EntityState.Detached;
    throw new DuplicateOrderNumberException(number, e);
}
```

The test expects the domain type exactly, and reads the count with a new
context. A second test proves the same number is free in another tenant, which
is what the composite index promises.

### Test the migrations themselves

Two tests cover the migrations. The first applies every migration to an empty
database and compares the lists:

```csharp
var connectionString = await PostgresContainer.CreateDatabaseAsync("empty_for_migrations");
var options = new DbContextOptionsBuilder<OrdersDbContext>().UseNpgsql(connectionString).Options;

await using (var db = new OrdersDbContext(options, Seed.Acme))
{
    await db.Database.MigrateAsync(testContext.CancellationToken);

    CollectionAssert.AreEqual(
        db.Database.GetMigrations().ToList(),
        (await db.Database.GetAppliedMigrationsAsync(testContext.CancellationToken)).ToList());
}
```

The second catches model drift: a change to the model with no migration for it.
`HasPendingModelChanges()` (EF Core 8 and later) compares the model with the
last migration's snapshot, and never opens the connection:

```csharp
var options = new DbContextOptionsBuilder<OrdersDbContext>().UseNpgsql("Host=unused").Options;
using var db = new OrdersDbContext(options, Seed.Acme);

Assert.IsFalse(db.Database.HasPendingModelChanges(), "Run `dotnet ef migrations add` for the model changes.");
```

Since EF Core 9, `Migrate` and `MigrateAsync` also throw when the model has
pending changes (`PendingModelChangesWarning`). In this suite every class
migrates its database, so a drifted model turns all tests red, and this test
tells you why in one line. `dotnet ef migrations has-pending-model-changes` does
the same check in a CI step.

### Count the commands to catch N+1

An N+1 returns the right data. The functional test cannot see it; a command
counter can. A `DbCommandInterceptor` records every query:

```csharp
internal sealed class CommandCounter : DbCommandInterceptor
{
    public List<string> Commands { get; } = [];

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        Commands.Add(command.CommandText);
        return result;
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Commands.Add(command.CommandText);
        return ValueTask.FromResult(result);
    }
}
```

Command interceptors are registered per context instance, so each test passes a
new one to `AddInterceptors`. Two `[DataRow]` rows make the point: one command
for 1 order and for 5. A loop with a query per order sends 1 + N commands (2 for
one order, 6 for five), and the summaries it returns are still right:

```csharp
[TestMethod]
[DataRow(1)]
[DataRow(5)]
public async Task SummariesTakeOneCommandWhateverTheNumberOfOrders(int orders)
{
    for (var i = 1; i <= orders; i++)
    {
        await _database.PlaceAsync(Seed.Acme, $"A-{i}", "ACME Corp", new NewLine("KB", i, 1m));
    }

    var counter = new CommandCounter();
    await using var db = _database.NewContext(Seed.Acme, counter);
    var summaries = await new OrderQueries(db).SummariesAsync(testContext.CancellationToken);

    Assert.HasCount(orders, summaries);
    Assert.HasCount(1, counter.Commands, string.Join(Environment.NewLine, counter.Commands));
}
```

The message prints the SQL that ran, so a failure shows the N+1 directly.

### Do the tests protect the rules?

Each change below was made on its own to the lab's production code:

| Change | Tests that fail |
| --- | --- |
| `SummariesAsync` runs one query per order | both rows of the command count test (the summary test stays green) |
| `Tenant` filter removed | tenant isolation, deleted-orders listing |
| `IgnoreQueryFilters()` with no names | deleted-orders listing |
| unique violation not translated | the domain error test |
| `ILike` replaced by `Contains` | the case-insensitive search |
| new property, no migration | all 16 (`MigrateAsync` refuses), with `HasPendingModelChanges` naming the cause |
| row version removed, migration added | the two-context test and the version test; the one-context test stays green |

## Trade-offs

- **Migrating per class is slower than `EnsureCreated`.** It runs every
  migration for every test class. In return the suite runs on the schema
  production gets, and a broken migration fails here first.
- **Command counts are brittle on purpose.** An EF Core upgrade that splits or
  merges a query changes the number. Count only where the number is the
  requirement (a list page, a report), and print the SQL in the message.
- **`xmin` is free and PostgreSQL-only.** No column to maintain, but the token
  changes on any update of the row, including ones that did not touch the
  fields you care about, so unrelated writes to the same order also conflict.
- **Translating database errors couples the service to the provider.**
  `PostgresException` and the SQLSTATE live in the service. That is the price of
  a domain error; keep the translation in one place.
- **Named filters are easy to switch off by accident.** `IgnoreQueryFilters()`
  with no arguments still drops all of them. A test with data in two tenants is
  the cheapest guard.
- **These are integration tests.** Keep the rules that need no database (price
  rules, state transitions) in plain unit tests, and use this suite for what
  only the database knows.

## Lab

A multi-tenant ordering module with two real migrations is already implemented on PostgreSQL. Your job is to write the MSTest tests for what only the database can show: query translation, query filters, concurrency, unique violations, migrations and the number of SQL commands.

**What you will practice**

- Building the test schema with `MigrateAsync` and detecting model drift with `HasPendingModelChanges`.
- Testing named query filters with data in two tenants.
- Producing a real optimistic concurrency conflict with two contexts.
- Counting SQL commands with a `DbCommandInterceptor` to catch an N+1.

**Prerequisites:** Testing Against a Real Database with Testcontainers (concept and lab), EF Core query filters, concurrency tokens and migrations, .NET 10 SDK, and Docker running locally.

**How it works:** the container, the database per class and the reset are already set up. Every test is declared with a hint and fails with `TODO-NN` until you write it. Three traps wait for you: an N+1 that a functional test does not see, a model change without a migration, and a concurrency test with one context that proves nothing. The optional TODOs walk through a real drift and a mutation check.

## Documentation Links

- [Global query filters, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/filters) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Concurrency tokens, Npgsql EF Core provider](https://www.npgsql.org/efcore/modeling/concurrency.html) (doc)
- [Breaking changes in EF Core 9 (pending model changes), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes) (doc)
- [What's new in EF Core 8 (HasPendingModelChanges), Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Transactions and savepoints, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
