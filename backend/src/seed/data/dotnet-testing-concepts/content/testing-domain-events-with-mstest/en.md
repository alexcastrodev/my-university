---
version: 1.0
updatedAt: 2026-10-07
---
## Objective

Domain events come with four rules: the aggregate only records events, the
interceptor dispatches them before the commit, a handler that fails leaves
nothing behind, and a consumer that receives the same message twice acts once.
Each rule lives in a different place, so each one needs a different kind of
test. The goal is an MSTest suite that checks every rule at the cheapest layer
that can see it, runs in milliseconds, and turns red when someone breaks the
rule (dispatching after the commit, forgetting to clear the events), not when
someone renames a method.

## Use Cases

- Proving that placing an order raises exactly one `OrderPlaced` with the right
  values, with no database and no setup.
- Proving that a handler that throws leaves no order and no outbox row behind,
  which is the promise of dispatching before the commit.
- Proving that a consumer survives at-least-once delivery without awarding
  loyalty points twice.
- Moving a team from xUnit habits to MSTest (or starting a new project on it)
  without losing the testing strategy.
- Catching a refactor that moves the dispatch to `SavedChangesAsync` before it
  reaches production.

## Deep Dive

### One rule, one layer

Do not test everything through `SaveChanges`. Put each rule where the test is
smallest:

| Rule | Where it can be seen | Kind of test |
| --- | --- | --- |
| `Order.Place` raises `OrderPlaced` and rejects bad totals | the aggregate | plain unit test, no infrastructure |
| The interceptor dispatches and clears events | EF Core's save pipeline | integration test on SQLite in memory |
| A failing handler rolls back the order and the outbox row | the transaction | integration test, read back with another context |
| A repeated message awards points once | the consumer's own transaction | integration test, call the consumer directly |

The project is one test project next to the module, with four test classes:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.4.1" />
  <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.10.0" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
```

`MSTest` is the metapackage: the framework, the adapter that lets `dotnet test`
find the tests, and the test SDK. The `Using` item removes `using Microsoft.VisualStudio.TestTools.UnitTesting;` from
every file. `dotnet new mstest` creates the same layout.

### MSTest in four lines

A class marked `[TestClass]` holds methods marked `[TestMethod]`. MSTest creates
a new instance of the class for every test method, so instance fields are
private to one test. Per-test setup can be a constructor or a
`[TestInitialize]` method, and cleanup can be `IDisposable` or a
`[TestCleanup]` method:

```csharp
[TestClass]
public sealed class OutboxTests : IDisposable
{
    private readonly TestDatabase _database = new(); // one per test

    public void Dispose() => _database.Dispose();    // runs after the test
}
```

A constructor can set a `readonly` field, which is why Microsoft's guidance
leans on it. `[TestInitialize]` and `[TestCleanup]` can be `async` and accept `[Timeout]`,
which a constructor cannot, so use them when the setup has to await (an
`IAsyncDisposable` test class covers async cleanup too). Pick one style per
project; the analyzers MSTEST0019 and MSTEST0020 can enforce it.

One more default matters: MSTest runs tests one at a time until the assembly
opts in. `dotnet new mstest` adds this file, and it is what makes the instance
rule above important:

```csharp
// MSTestSettings.cs
[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]
```

### Test the aggregate with no infrastructure

The aggregate records events in a list, so the test constructs, acts and reads
the list. `Assert.ContainsSingle` returns the only element and
`Assert.IsInstanceOfType<T>` returns it typed, so the next lines read like the
specification:

```csharp
[TestMethod]
public void PlacingAnOrderRaisesOneOrderPlacedEvent()
{
    var order = Order.Place(CustomerId, 50m, TimeProvider.System);

    var raised = Assert.ContainsSingle(order.DomainEvents);
    var placed = Assert.IsInstanceOfType<OrderPlaced>(raised);
    Assert.AreEqual(order.Id, placed.OrderId);
    Assert.AreEqual(50m, placed.Total);
}
```

Time is an input. `Order.Place` takes a `TimeProvider`, so the test hands it a
`FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing` and the
expected timestamp is exact, not "close to now":

```csharp
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 10, 7, 9, 30, 0, TimeSpan.Zero));
var order = Order.Place(CustomerId, 10m, clock);
var placed = Assert.IsInstanceOfType<OrderPlaced>(Assert.ContainsSingle(order.DomainEvents));
Assert.AreEqual(clock.GetUtcNow(), placed.At);
```

The invalid totals are one test with two `[DataRow]` rows, and each row is
reported on its own:

```csharp
[TestMethod]
[DataRow(0)]
[DataRow(-5)]
public void AnOrderWithoutAPositiveTotalIsRejected(int total) =>
    Assert.ThrowsExactly<ArgumentOutOfRangeException>(
        () => Order.Place(CustomerId, total, TimeProvider.System));
```

`Assert.ThrowsExactly<T>` accepts only `T`. `Assert.Throws<T>` also accepts a
type derived from `T`. `Place` throws `ArgumentOutOfRangeException`, so asking
for `ThrowsExactly<ArgumentException>` fails even though the exception is an
`ArgumentException`. Name the type the code really throws.

### Test the interceptor with a real pipeline

An interceptor only runs inside EF Core's save pipeline, and a mocked
`DbContext` never runs it. Use a real context on SQLite in memory. An in-memory
SQLite database is deleted when its connection closes, and each `:memory:`
connection gets its own database, so the test opens one connection and shares
it between every context it creates:

```csharp
internal sealed class TestDatabase : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public TestDatabase()
    {
        _connection.Open();
        using var db = Plain();
        db.Database.EnsureCreated();
    }

    public OrdersDbContext NewContext(DomainEventDispatcher dispatcher) =>
        new(new DbContextOptionsBuilder<OrdersDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(new DomainEventsInterceptor(dispatcher))
            .Options);

    public OrdersDbContext Plain() => NewContext(new DomainEventDispatcher());

    public void Dispose() => _connection.Dispose();
}
```

The handlers are hand-written fakes. A recording handler is two lines and the
test reads without a mocking library:

```csharp
internal sealed class RecordingHandler : IDomainEventHandler<OrderPlaced>
{
    public List<OrderPlaced> Seen { get; } = [];

    public Task HandleAsync(OrderPlaced e, OrdersDbContext db, CancellationToken ct)
    {
        Seen.Add(e);
        return Task.CompletedTask;
    }
}
```

Two tests then pin the interceptor down: it dispatches the events of the
tracked aggregates, and it clears them so a second save does not dispatch them
again:

```csharp
[TestMethod]
[TestCategory("Integration")]
public async Task EventsAreClearedSoASecondSaveDoesNotDispatchThemAgain()
{
    var recorder = new RecordingHandler();
    await using var db = _database.NewContext(new DomainEventDispatcher().Register(recorder));
    var order = Order.Place(CustomerId, 10m, TimeProvider.System);
    db.Orders.Add(order);

    await db.SaveChangesAsync();
    await db.SaveChangesAsync();

    Assert.HasCount(1, recorder.Seen);
    Assert.IsEmpty(order.DomainEvents);
}
```

### Assert what was committed, not what the context holds

A context that failed to save still tracks the order it tried to save.
Asserting through it can pass for the wrong reason. Read the result back with a
different context over the same connection:

```csharp
[TestMethod]
[TestCategory("Integration")]
public async Task AHandlerThatThrowsRollsBackTheOrder()
{
    await using (var db = _database.NewContext(new DomainEventDispatcher().Register(new ExplodingHandler())))
    {
        db.Orders.Add(Order.Place(CustomerId, 10m, TimeProvider.System));
        await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    await using var check = _database.Plain(); // a fresh context reads the database
    Assert.AreEqual(0, await check.Orders.CountAsync());
}
```

The outbox rule is the same shape, with the order of the handlers doing the
work. The outbox handler runs first and adds its row, then the exploding handler
aborts the save, and neither the order nor the row may exist afterwards:

```csharp
var dispatcher = new DomainEventDispatcher().Register(new OrderPlacedHandler()).Register(new ExplodingHandler());
// ... save, expect InvalidOperationException, then on a fresh context:
Assert.AreEqual(0, await check.OutboxMessages.CountAsync());
Assert.AreEqual(0, await check.Orders.CountAsync());
```

### Test the consumer without waiting

The consumer runs after the commit, in its own transaction. The test does not
start a worker or poll the outbox: it builds the message and calls the consumer.
That removes `Thread.Sleep` and the flakiness that comes with it:

```csharp
public LoyaltyConsumerTests(TestContext testContext)
{
    _testContext = testContext;
    _consumer = new LoyaltyConsumer(_database.Plain);
}

[TestMethod]
public async Task ADuplicateDeliveryOfTheSameMessageAwardsPointsOnlyOnce()
{
    var message = Message(42m);

    await _consumer.HandleAsync(message, _testContext.CancellationToken);
    await _consumer.HandleAsync(message, _testContext.CancellationToken);

    await using var check = _database.Plain();
    Assert.AreEqual(42, (await check.Customers.SingleAsync()).Points);
    Assert.AreEqual(1, await check.ProcessedMessages.CountAsync());
}
```

MSTest passes the `TestContext` of the running test to the constructor. Its
`CancellationToken` is signaled when the test times out or the run is aborted,
so passing it to the code under test, instead of `CancellationToken.None`, stops
the work the test started.

### Do the tests protect the rules?

A green suite says the tests agree with the code, not that they would notice a
bug. Break the production code on purpose, one change at a time, and see what
turns red. These are the results for this suite:

| Change to the production code | Tests that fail |
| --- | --- |
| The interceptor stops clearing the events | the "second save" test |
| `Order.Place` does not validate the total | both `[DataRow]` rows |
| The dispatch moves to `SavedChangesAsync` (after the commit) | the rollback test and both outbox tests |
| `OrderPlacedHandler` calls `SaveChangesAsync` itself | the "no outbox row when the save fails" test |
| `LoyaltyConsumer` ignores the inbox | the duplicate delivery test |

A change that leaves everything green is a missing test. The
`[TestCategory("Integration")]` tag also lets you run a slice:
`dotnet test --filter "TestCategory=Integration"` runs the database tests, and
`--filter "TestCategory!=Integration"` runs only the aggregate tests.

## Trade-offs

- **SQLite in memory is a fake, not your database.** EF Core's own guidance is
  that providers behave differently (for example, SQLite compares strings
  case-sensitively and SQL Server by default does not), so a test can pass on SQLite and
  fail in production. It recommends testing against the real database system
  where possible, using containers such as Testcontainers. Here the only line
  that changes is the provider inside `TestDatabase`, but each test then needs
  its own isolated database, which costs time.
  ```csharp
  .UseNpgsql(connectionString) // same tests, a real PostgreSQL started by Testcontainers
  ```
- **Hand-written fakes cost lines; mocks cost stability.** A fake needs an update
  when the interface changes. A mock that verifies calls ties the test to how the
  code works, so a harmless refactor breaks it. Assert on outcomes you can see
  (what the recorder received, what the database holds), as in the Java
  concept on observable behavior.
- **Parallel by opt-in is fast until something is shared.** Method-level
  parallelism is safe while state lives in instance fields. One `static`
  database turns the suite into a flaky one. Use `[DoNotParallelize]` for the
  rare test that must run alone.
  ```csharp
  private static readonly TestDatabase Shared = new(); // shared by tests that run at the same time
  ```
- **Reading back with a second context is more code.** It is also the only way
  to know what was committed. A helper like `Plain()` keeps it to one line.
- **Constructor or `[TestInitialize]` is a style choice.** Constructors give you
  `readonly` fields; `[TestInitialize]` gives you `async` and `[Timeout]`. Mixed
  styles in one project make the lifecycle harder to read.
- **MSTest and xUnit teach the same strategy.** `[TestMethod]` is `[Fact]`,
  `[DataRow]` is `[InlineData]`, and both create one instance per test. The
  strategy here (one rule, one layer, read back what was committed) carries over
  when a team uses xUnit, as in the Testing Modules in Isolation concept.
- **No test can see a crash.** The window between the commit and an after-commit
  dispatch cannot be reproduced by a unit test. The tests above show that the
  design without that window (dispatch before the commit, outbox row in the same
  transaction) behaves as promised.

## Documentation Links

- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [In-memory databases, Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/in-memory-databases) (doc)
