---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

EF Core's own documentation recommends testing against the database you run in
production, and it calls the InMemory provider "highly discouraged" as a test
double. This concept turns that advice into an MSTest suite: one PostgreSQL
container started by Testcontainers for the whole run, one database per test
class, and a reset strategy so tests never see each other's rows. The goal is a
suite that catches what only the real database checks (unique indexes, column
lengths, error codes), runs in seconds, and fails for the right reason.

## Use Cases

- Proving a unique index or a `varchar(20)` column really rejects bad data,
  which neither the InMemory provider nor SQLite does.
- Replacing a suite built on `UseInMemoryDatabase` that is green while
  production throws.
- Running database tests in CI on any runner that has Docker, with no shared
  test server to keep clean.
- Isolating tests that write data, whether the code accepts the test's
  transaction or commits on its own.
- Keeping a few seconds of container startup from turning into a few seconds
  per test.

## Deep Dive

### What EF Core recommends, and what it discourages

The EF Core testing guide compares the options. Its summary is short:

| Option | What the guide says |
| --- | --- |
| Your production database system | Recommended. Start there; tests can run "reliably and quickly". |
| Repository pattern with stubs | The reliable test double when you need one, at a real cost. |
| SQLite in memory | A fake. Providers behave differently, so passing on SQLite guarantees nothing. |
| EF Core InMemory provider | "Highly discouraged": no transactions, no raw SQL, fewer queries. |
| Mocking `DbSet` for queries | Avoid. |

The guide also names Testcontainers as the way to automate a containerized
database. The rest of this concept is how to do that well with MSTest. The
theory of which dependencies to test for real (managed versus unmanaged) is in
the Java testing concepts linked below; it applies unchanged to .NET.

### The fake says yes, the database says no

The inventory module has a product with a unique SKU of at most 20 characters:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    var product = modelBuilder.Entity<Product>();
    product.Property(p => p.Sku).HasMaxLength(Product.SkuMaxLength); // 20
    product.Property(p => p.Name).HasMaxLength(100);
    product.HasIndex(p => p.Sku).IsUnique();
}
```

Two learning tests pin down what the fakes let through. Both are green, and
each one describes a bug a fake-based suite would ship:

```csharp
[TestMethod]
public async Task TheInMemoryProviderAcceptsADuplicateSku()
{
    var options = new DbContextOptionsBuilder<InventoryDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        .Options;
    await using var db = new InventoryDbContext(options);
    var service = new StockService(db);

    await service.RegisterAsync("SKU-1", "Keyboard", testContext.CancellationToken);
    await service.RegisterAsync("SKU-1", "Another keyboard", testContext.CancellationToken);

    Assert.AreEqual(2, await db.Products.CountAsync(testContext.CancellationToken));
}
```

SQLite enforces the unique index, but not the length: a 21-character SKU is
stored whole. PostgreSQL refuses both, and the test checks the error by its
SQLSTATE, not by its message:

```csharp
var duplicate = await Assert.ThrowsExactlyAsync<DbUpdateException>(
    () => new StockService(db).RegisterAsync("SKU-1", "Another keyboard", Ct));
var postgres = Assert.IsInstanceOfType<PostgresException>(duplicate.InnerException);
Assert.AreEqual(PostgresErrorCodes.UniqueViolation, postgres.SqlState); // 23505
```

The too-long SKU fails the same way with
`PostgresErrorCodes.StringDataRightTruncation` (`22001`). The InMemory provider
has one more surprise: calling `BeginTransactionAsync` on it throws, because
the `TransactionIgnoredWarning` it raises is an error by default.

### One container per run

A container takes seconds to start, so start it once. MSTest's
`[AssemblyInitialize]` runs once before any test in the assembly; it must be
`public static`, take a `TestContext`, and may return `Task`. The matching
`[AssemblyCleanup]` disposes it:

```csharp
[TestClass]
public static class PostgresContainer
{
    private static PostgreSqlContainer? _container;

    [AssemblyInitialize]
    public static async Task StartAsync(TestContext testContext)
    {
        var stopwatch = Stopwatch.StartNew();
        _container = new PostgreSqlBuilder("postgres:18-alpine").Build();
        await _container.StartAsync(testContext.CancellationToken);
        testContext.WriteLine($"PostgreSQL container started in {stopwatch.ElapsedMilliseconds} ms");
    }

    [AssemblyCleanup]
    public static async Task StopAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
        }
    }
}
```

The package is `Testcontainers.PostgreSql` (4.16.0 today). Pass the image to
the builder so an upgrade of the library never changes your database version
behind your back. `GetConnectionString()` returns the connection string of the
started container; nothing about the host, port or password is hard-coded.

In xUnit the same role is played by a fixture shared across classes (the EF
Core guide uses `IClassFixture` with a lock); in MSTest the assembly-level
methods are the natural place.

### One database per test class

A database inside a running container costs milliseconds. Give each test class
its own, and the classes can run in parallel without seeing each other:

```csharp
public static async Task<string> CreateDatabaseAsync(string name)
{
    var admin = Container.GetConnectionString();
    await using (var connection = new NpgsqlConnection(admin))
    {
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    return new NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString;
}
```

The class creates its database in `[ClassInitialize]` and the schema with
`EnsureCreatedAsync` (the next concept applies real migrations instead):

```csharp
[ClassInitialize]
public static async Task CreateDatabaseAsync(TestContext _) =>
    _database = await TestDatabase.CreateAsync("rollback_tests");
```

The methods of one class share that database, so they must not run at the same
time. MSTest's parallelism scope says exactly that:

```csharp
// MSTestSettings.cs: classes in parallel, methods of a class in sequence
[assembly: Parallelize(Scope = ExecutionScope.ClassLevel)]
```

`ExecutionScope.MethodLevel`, which `dotnet new mstest` suggests, would run two
tests of the same class against the same tables at once.

### Reset 1: a transaction per test

The cheapest isolation is a transaction that is never committed. The test gets
a context with the transaction already open, and disposing the context rolls it
back:

```csharp
[TestInitialize]
public async Task BeginTransactionAsync()
{
    _db = _database.NewContext();
    await _db.Database.BeginTransactionAsync(testContext.CancellationToken);
}

public ValueTask DisposeAsync() => _db.DisposeAsync(); // no commit: rollback
```

The test then has to read back through the same context, and that is the trap.
A query on a context returns the instance it already tracks, so a test that
never cleared the tracker passes even when nothing was saved:

```csharp
// Broken: green even if ReceiveAsync forgets SaveChangesAsync
await service.ReceiveAsync("SKU-1", 5, Ct);
var stored = await _db.Products.SingleAsync(p => p.Sku == "SKU-1", Ct);
Assert.AreEqual(5, stored.OnHand);

// Fixed: forget the tracked instances, then the query reads the row
await service.ReceiveAsync("SKU-1", 5, Ct);
_db.ChangeTracker.Clear();
var stored = await _db.Products.SingleAsync(p => p.Sku == "SKU-1", Ct);
Assert.AreEqual(5, stored.OnHand);
```

A failed save does not poison the test's transaction. When a transaction is
already open, EF Core's `SaveChanges` creates a savepoint first and rolls back
to it on error, so a test can expect a unique violation and keep querying.

This strategy breaks when the code under test does not use the test's context:
code that opens its own context, its own transaction, or runs inside a web host.

### Reset 2: let it commit, then Respawn

When the code must commit for real, reset the database before each test.
Respawn (7.0.0) reads the schema once and builds the cleanup statement:

```csharp
[ClassInitialize]
public static async Task CreateDatabaseAsync(TestContext _)
{
    _database = await TestDatabase.CreateAsync("respawn_tests");
    await using var connection = new NpgsqlConnection(_database.ConnectionString);
    await connection.OpenAsync();
    _respawner = await Respawner.CreateAsync(connection, new RespawnerOptions
    {
        DbAdapter = DbAdapter.Postgres,
        SchemasToInclude = ["public"],
    });
}

[TestInitialize]
public async Task ResetAsync()
{
    await using var connection = new NpgsqlConnection(_database.ConnectionString);
    await connection.OpenAsync(testContext.CancellationToken);
    await _respawner.ResetAsync(connection);
}
```

For PostgreSQL, Respawn needs an open connection and runs one
`truncate table ... cascade` over the tables it found. Version 7 can infer the
adapter from the connection, so `DbAdapter` is optional. It does not restart
identity sequences by default: ids keep growing across tests, which is fine as
long as no test asserts on an id. Every assertion here uses a new context, so
it reads what was committed:

```csharp
await using (var db = _database.NewContext())
{
    var service = new StockService(db);
    await service.RegisterAsync("SKU-1", "Keyboard", Ct);
    await service.ReceiveAsync("SKU-1", 5, Ct);
}

await using var check = _database.NewContext();
Assert.AreEqual(5, (await check.Products.SingleAsync(Ct)).OnHand);
```

### Reset 3: TRUNCATE it yourself

Respawn saves you from listing tables. For a small schema, one line of SQL does
the same and also restarts the sequences:

```csharp
await db.Database.ExecuteSqlRawAsync("""TRUNCATE "Products" RESTART IDENTITY CASCADE""", ct);
```

The price is a list of tables that you must update when the model grows.

| Strategy | Use it when | Watch out for |
| --- | --- | --- |
| Transaction per test | the code accepts the test's context | reading back without `ChangeTracker.Clear()` |
| Respawn before each test | the code commits on its own | ids are not reset by default |
| `TRUNCATE` before each test | the schema is small and stable | a new table you forgot to list |
| A new database per test | full isolation is worth the time | a `CREATE DATABASE` and a schema per test |

### Ryuk, CI and startup time

Testcontainers starts a second container, Ryuk (the resource reaper), next to
yours. If the test process dies before `[AssemblyCleanup]` runs, Ryuk removes
what the session created. The documentation asks you not to disable it, except
on CI nodes that clean up after themselves, with
`TESTCONTAINERS_RYUK_DISABLED=true`.

On CI the only requirement is Docker: GitHub-hosted runners and Azure Pipelines
Microsoft-hosted agents have it. Pull time is the first-run cost; after that, on
a laptop with the image cached, this concept's lab (container start, three
databases, eleven tests) runs in about 3 seconds.

One local gotcha is worth knowing. Testcontainers for Java may write
`~/.testcontainers.properties` with `docker.host=unix\:///var/run/docker.sock`.
The .NET library reads that backslash literally and fails with "This operation
is not supported for a relative URI". Setting `DOCKER_HOST` overrides it.

### Do the tests protect the rules?

Break the production code on purpose, one change at a time, and see what turns
red. These are the results for the lab's solution:

| Change | Tests that fail |
| --- | --- |
| `ReceiveAsync` does not call `SaveChangesAsync` | 4 tests, in both isolation classes |
| `.IsUnique()` removed from the SKU index | the PostgreSQL duplicate test |
| `Product.Reserve` skips the stock check | the reservation test |
| `HasMaxLength` removed from the SKU | the PostgreSQL length test |
| (test code) Respawn reset skipped | 2 tests, depending on the order they ran |

Two results matter more than the table. With the first change and the
`ChangeTracker.Clear()` line removed, the rollback test is green again. And the
InMemory and SQLite learning tests stay green under every change, because those
fakes never checked the constraint in the first place.

## Trade-offs

- **Real database tests need Docker.** A developer without Docker cannot run
  them, and the first run downloads an image. Tag them so the fast tests can
  still run alone:
  ```csharp
  [TestCategory("Integration")] // dotnet test --filter "TestCategory!=Integration"
  ```
- **A shared container is fast and shared.** One container for the run saves
  seconds per class, but any state outside a database (roles, extensions,
  settings) is shared by every class. Keep that state in the schema or in the
  per-class database.
- **Rollback isolation is the cheapest and the most limited.** It costs nothing
  per test, but only works while the code takes the test's context. The first
  service that opens its own transaction needs Respawn or `TRUNCATE`.
- **Class-level parallelism leaves speed on the table.** Methods of a class
  run in sequence. More classes (each with its own database) or a database per
  test buys more parallelism at the cost of more setup.
- **The fakes still have a use.** A repository stub is the right double for a
  use case test, and SQLite can stand in when Docker is impossible. Just do not
  count a fake-based test as proof that a constraint or a query works.
- **Pinning the image is a decision to revisit.** `postgres:18-alpine` keeps
  runs repeatable; upgrading production means upgrading the tag in the tests
  on the same day.

## Lab

A small inventory module on PostgreSQL is already implemented. Your job is to write the MSTest tests that run it against a real database started by Testcontainers, and to keep those tests isolated from each other.

**What you will practice**

- Starting one PostgreSQL container per run with `[AssemblyInitialize]` and disposing it in `[AssemblyCleanup]`.
- Creating one database per test class and running classes in parallel.
- Isolating tests with a transaction per test and with Respawn.
- Showing, with learning tests, what the InMemory provider and SQLite let through.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, basic EF Core, .NET 10 SDK, and Docker running locally.

**How it works:** every test and lifecycle method is declared with a hint and fails with `TODO-NN` until you write it. Some tests only prove something if you assert in the right place: after `ChangeTracker.Clear()` or with a new context, and with the whole class running, not one test alone. The optional TODOs add a `TRUNCATE` reset and a mutation check.

## Documentation Links

- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Testing against your production database system, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/testing-with-the-database) (doc)
- [Transactions and savepoints, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [PostgreSQL module, Testcontainers for .NET](https://dotnet.testcontainers.org/modules/postgres/) (doc)
- [Resource Reaper, Testcontainers for .NET](https://dotnet.testcontainers.org/api/resource_reaper/) (doc)
- [Custom configuration, Testcontainers for .NET](https://dotnet.testcontainers.org/custom_configuration/) (doc)
- [Respawn, GitHub](https://github.com/jbogard/Respawn) (doc)
