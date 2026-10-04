---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A modular monolith only pays off if you can test one module without booting the
whole application. The goal is a test that starts a single module with its real
database, replaces every other module with a fake of its contract, and checks
behavior through the public endpoint or contract. That keeps the feedback loop
short, proves the module really is independent, and makes a hidden dependency
on another module fail loudly in the test instead of in production.

## Use Cases

- Verifying that Orders computes a checkout total correctly without starting
  Catalog, Payments, or Notifications.
- Running Orders' persistence tests against a real PostgreSQL schema instead of
  an in-memory provider that hides SQL differences.
- Checking that Orders publishes `OrderPlaced` when an order is committed, and
  that it handles a redelivered `ProductPriceChanged` safely.
- Keeping a small set of end-to-end tests that boot every module, so wiring
  mistakes (a missing registration, a wrong schema name) are still caught.

## Deep Dive

### Host one module, fake the rest

Each module exposes one registration method. A test host calls only that method
and registers fakes for the contracts the module consumes:

```csharp
public sealed class OrdersFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICatalogModule>();
            services.AddSingleton<ICatalogModule>(new FakeCatalog(
                (Guid.Parse("11111111-1111-1111-1111-111111111111"), "Keyboard", 49.90m)));
        });
}
```

The fake implements the contract, not the real module, so a test can only
depend on what Orders is allowed to depend on. If Orders secretly reads a
Catalog table, the fake cannot satisfy it and the test fails.

### A real database per test class

Use a throwaway container for the module's schema. The EF Core docs call the
in-memory provider highly discouraged for tests: it does not translate queries
to SQL, does not support transactions or raw SQL, so it can pass tests that
fail against PostgreSQL:

```csharp
public sealed class OrdersDb : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public string ConnectionString => _pg.GetConnectionString();

    public Task InitializeAsync() => _pg.StartAsync();
    public Task DisposeAsync() => _pg.DisposeAsync().AsTask();
}
```

Share the container across the tests of one class (xUnit's
`IClassFixture<T>`) and reset data between tests, rather than paying a container
start for every test. The `Task` return types above are for xUnit v2; in xUnit
v3, `InitializeAsync` and `DisposeAsync` return `ValueTask`.

### Testing events without sleeping

With an outbox, delivery happens on the dispatcher's next tick, so asserting
right after the request is racy. Do not `Task.Delay`. Either invoke the
dispatcher directly in the test, or poll the observable result with a deadline:

```csharp
await orders.PlaceOrderAsync(request);
await dispatcher.RunOnceAsync(CancellationToken.None); // drain the outbox now

var published = fakeBus.Published.OfType<OrderPlaced>().Single();
Assert.Equal(request.CustomerId, published.CustomerId);
```

For the receiving side, call the handler directly with the same event twice and
assert the state is identical, which covers at-least-once delivery.

### Keep a few full-application tests

Isolated tests cannot see wiring between modules. Keep a small suite that boots
the real host with every module and runs the main flows: place an order, change
a price, see the update arrive. Run it less often (on merge, not on every save)
and keep it small enough that nobody is tempted to skip it.

## Trade-offs

- **Fakes can drift from the real module.** A fake `ICatalogModule` that returns
  a product the real one would reject makes Orders' tests green for the wrong
  reason.
  ```csharp
  // The fake accepts any id. The real GetProductNamesAsync omits unknown ids,
  // so Orders must handle a missing key, and this fake never exercises that.
  public Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(Guid[] ids, CancellationToken ct) =>
      Task.FromResult<IReadOnlyDictionary<Guid, string>>(ids.ToDictionary(id => id, _ => "Any"));
  ```
  Add a few tests for the real contract implementation so the fake's behavior
  has something to be checked against.
- **Containers make tests honest and slower.** A PostgreSQL container adds
  seconds of startup and needs Docker in CI. The EF Core docs recommend
  testing against the real database system and call the in-memory provider
  highly discouraged, because it behaves differently exactly where it matters
  (query translation, transactions, raw SQL) and is not faster than a local
  database in practice.
- **Shared fixtures leak state between tests.** Reusing one container across a
  class is faster, but a test that leaves rows behind can break the next one in a
  way that depends on execution order.
  ```csharp
  public async Task InitializeAsync() =>
      await db.Database.ExecuteSqlRawAsync("TRUNCATE orders.orders, orders.order_lines CASCADE");
  // Reset in InitializeAsync (before each test), not only in Dispose.
  ```
- **Isolation hides integration bugs.** If every test uses fakes, a renamed
  event or a mismatched schema between publisher and subscriber ships green.
  The full-application suite exists for exactly this, and removing it to save
  CI time removes the only test that sees the seams.

## Documentation Links

- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Testcontainers for .NET](https://dotnet.testcontainers.org/) (doc)
- [Shared context between tests (class fixtures), xUnit.net](https://xunit.net/docs/shared-context) (doc)
- [Testing without your production database system, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
