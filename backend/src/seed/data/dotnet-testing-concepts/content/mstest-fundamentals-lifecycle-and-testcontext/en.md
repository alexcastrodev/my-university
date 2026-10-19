---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

MSTest looks simple: a class with `[TestClass]`, methods with `[TestMethod]`,
and `Assert` calls. Most of the surprises come from what the framework does
around those methods: it creates a new instance of the class for every test,
runs a fixed sequence of hooks, hands each test a `TestContext`, and, once the
assembly opts in, runs tests from many classes at the same time. The goal is to
know that machinery well enough to predict it: which hook runs when, where
per-test state must live, which assertion says exactly what you mean, and why a
`static` field turns a green suite into a flaky one. Everything here targets
MSTest 4 on .NET 10.

## Use Cases

- Choosing where a fixture goes: a `readonly` field set by the constructor, an
  async `[TestInitialize]`, or a `static` resource created once in
  `[ClassInitialize]`.
- Writing exception tests that fail when the code throws the wrong thing, not
  only when it throws nothing.
- Turning on parallel execution in an existing suite and finding the tests that
  share state.
- Upgrading a project from MSTest 3 and knowing which APIs are gone.
- Reading an xUnit suite or moving one to MSTest: isolation works the same way,
  shared setup does not.

## Deep Dive

### The project, and what MSTest 4 removed

A test project is one package reference. `MSTest` is a metapackage: the
framework, the adapter that `dotnet test` uses to find the tests, the test SDK
and the analyzers. The current stable version on NuGet is 4.5.1:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
```

MSTest 4 is not binary compatible with MSTest 3, and its migration guide lists
source-breaking changes. The ones that hit ordinary test code:

| Gone in MSTest 4 | Use instead |
| --- | --- |
| `[ExpectedException]` | `Assert.Throws` / `Assert.ThrowsExactly` (and their `Async` forms) |
| `Assert.ThrowsException` | `Assert.ThrowsExactly` |
| `ClassCleanupBehavior` (cleanup at end of assembly) | `[ClassCleanup]` now always runs at the end of its class; assembly-wide cleanup goes in `[AssemblyCleanup]` |
| `TestTimeout.Infinite` | `[Timeout(int.MaxValue)]` |
| `TestContext.ManagedType` | `TestContext.FullyQualifiedTestClassName` |
| `Assert` overloads with `message` plus `object[]` | an interpolated `message` |
| `Assert.IsInstanceOfType<T>(x, out var t)` | `var t = Assert.IsInstanceOfType<T>(x)` |

The minimum .NET version is now .NET 8 (.NET Framework 4.6.2 is still
supported), and reading `TestContext.TestName` inside `[ClassInitialize]` or
`[AssemblyInitialize]` now throws instead of returning nothing.

### One instance per test

MSTest creates a new instance of the test class for every test method, and for
every data row of a data-driven test. An instance field is therefore private to
one test. A test that expects a field to keep what an earlier test put there
fails, and that is the framework protecting you:

```csharp
[TestClass]
public sealed class InventoryTests
{
    private readonly Inventory _inventory = new(); // a new inventory for every test

    public InventoryTests() => _inventory.Restock("apple", 10, 0.50m);

    [TestMethod]
    public void ReservingTakesUnitsOutOfStock()
    {
        _inventory.Reserve("apple", 4);

        Assert.AreEqual(6, _inventory.Available("apple"));
    }
}
```

A constructor can assign `readonly` fields, which is why Microsoft's lifecycle
guide prefers it. `[TestInitialize]` is the other place for per-test setup: it
runs after the constructor and can be `async` and carry `[Timeout]`, which a
constructor cannot. There is one more difference that matters when setup fails:
if the constructor throws there is no instance, so `[TestCleanup]` and
`Dispose` do not run; if `[TestInitialize]` throws, they still do. The analyzers
MSTEST0019 and MSTEST0020 can enforce one style per project.

xUnit makes the same promise (a new instance per test, setup in the
constructor, cleanup in `Dispose`), so this habit carries over. What differs is
shared setup: MSTest uses static `[ClassInitialize]` and `[AssemblyInitialize]`
methods, xUnit injects an `IClassFixture<T>` or, in v3, an assembly fixture.

### The lifecycle, proved by a test

Here is the whole sequence for one test, from a class that writes every hook to
a log. The test asserts what ran before it, and `[AssemblyCleanup]`, the last
hook, asserts everything:

```csharp
[TestClass]
public sealed class LifecycleOrderTests : IDisposable
{
    private static readonly List<string> Log = [];
    private readonly TestContext _testContext;

    public LifecycleOrderTests(TestContext testContext)
    {
        _testContext = testContext;
        Log.Add("Constructor");
    }

    [AssemblyInitialize]
    public static void AssemblyInitialize(TestContext context) => Log.Add("AssemblyInitialize");

    [ClassInitialize]
    public static void ClassInitialize(TestContext context) => Log.Add("ClassInitialize");

    [TestInitialize]
    public void TestInitialize() => Log.Add("TestInitialize");

    [TestMethod]
    public void TheTestRunsAfterEverySetupStep()
    {
        Log.Add("Test");
        Assert.AreSequenceEqual(ExpectedOrder[..5], Log);
    }

    [TestCleanup]
    public void TestCleanup() => Log.Add("TestCleanup");

    public void Dispose() => Log.Add("Dispose");

    [ClassCleanup]
    public static void ClassCleanup() => Log.Add("ClassCleanup");

    [AssemblyCleanup]
    public static void AssemblyCleanup()
    {
        Log.Add("AssemblyCleanup");
        if (!Log.Contains("Test")) return; // a filter left this class out
        Assert.AreSequenceEqual(ExpectedOrder, Log);
    }
}
```

The order this run produces is `AssemblyInitialize > ClassInitialize >
Constructor > TestInitialize > Test > TestCleanup > Dispose > ClassCleanup >
AssemblyCleanup`. Swapping `Dispose` and `ClassCleanup` in `ExpectedOrder`
turns the run red: a failure in `[AssemblyCleanup]` is reported as an extra
failed result. With `dotnet test` on VSTest that result carries the name of
whichever test finished last, so read the message, not the name.

Two more facts came out of running it. The assembly hooks run even when a
`--filter` excludes the class that declares them, which is why the cleanup
returns early when the class's test never ran. And the signatures are strict:
assembly and class hooks are `public static`, the two initializers take a
`TestContext`, and the cleanups may take one or none.

### TestContext through the constructor

MSTest passes the `TestContext` of the running test to a constructor that asks
for it. That is the recommended form: it is available in the constructor, can
live in a `readonly` field, and is never null. Three members do most of the
work:

```csharp
[TestMethod]
public async Task AnApprovedPaymentProducesAReceiptAndEmptiesTheCart()
{
    var payments = new ApprovingGateway();
    _cart.Add("apple", 3);

    var receipt = await _cart.CheckoutAsync(payments, _testContext.CancellationToken);
    _testContext.WriteLine($"{_testContext.TestName}: {receipt}");

    Assert.AreEqual(1.50m, receipt.Total);
    Assert.AreEqual(1.50m, Assert.ContainsSingle(payments.Charged));
}
```

`CancellationToken` is signaled when the test times out or the run is aborted.
Passing it to the code under test, instead of `CancellationToken.None`, lets
that code stop; the MSTEST0049 analyzer flags calls that could take it.
`WriteLine` attaches text to the test result (run `dotnet test --logger
"console;verbosity=detailed"` to see it), and `TestName` is the method name.

### Throws, ThrowsExactly, and the reason a test passes

`Assert.ThrowsExactly<T>` passes only for `T`. `Assert.Throws<T>` also passes for
any type derived from `T`. Both return the exception, so the test can check its
properties. The difference decides whether a test can pass for the wrong reason.
In the lab, `UnknownProductException` derives from `ArgumentException`, and SKUs
are case-sensitive:

```csharp
// Broken: "Apple" is not "apple", so this catches UnknownProductException.
// It stays green with the quantity check deleted.
Assert.Throws<ArgumentException>(() => _cart.Add("Apple", 0));

// Fixed: the exact type, and a SKU the inventory knows.
Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => _cart.Add("apple", 0));
```

The default should be `ThrowsExactly`. `Throws` is right when the contract
really is a family of types. Cancellation is the usual case: `Task.Delay`
throws `TaskCanceledException`, a subclass of `OperationCanceledException`, so
`ThrowsExactlyAsync<OperationCanceledException>` fails with "caught
TaskCanceledException" while the code is correct:

```csharp
[TestMethod]
[Timeout(5000, CooperativeCancellation = true)]
public async Task ACancelledCheckoutGivesTheStockBack()
{
    _cart.Add("apple", 3);
    using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_testContext.CancellationToken);
    cancellation.CancelAfter(TimeSpan.FromMilliseconds(50));

    await Assert.ThrowsAsync<OperationCanceledException>(
        () => _cart.CheckoutAsync(new HangingGateway(), cancellation.Token));

    Assert.AreEqual(10, _inventory.Available("apple"));
}
```

`CooperativeCancellation = true` makes the timeout signal the token instead of
abandoning the test on a background task, which the docs warn can keep mutating
state after the test is reported.

### Everything is on Assert now

MSTest 4 captures the argument expression of every `Assert` call and prints it
in the failure message. The collection, string and comparison checks that used
to live in `CollectionAssert` and `StringAssert` now have `Assert` versions:

```csharp
Assert.Contains("pear", skus);
Assert.DoesNotContain("plum", skus);
Assert.HasCount(2, skus);
Assert.AreSequenceEqual(["apple", "pear"], skus);   // MSTest 4.3+
Assert.IsExactInstanceOfType<ArgumentOutOfRangeException>(error); // MSTest 4.1+
```

The docs say `StringAssert` and `CollectionAssert` are kept for backward
compatibility, are likely to be deprecated, and split assertions across three
types, which hurts discoverability (MSTEST0046 migrates `StringAssert`).

### Timeout, Retry, Ignore and categories

```csharp
[TestMethod]
[Ignore("Waiting for the new payment provider")] // reported as skipped
public void IgnoredTest() { }

[TestMethod]
[Retry(3)] // retries a failed or timed-out test up to 3 times
public void PassesOnTheSecondAttempt() { }

[TestClass]
[TestCategory("Checkout")]
public sealed class CheckoutTests { }
```

In this run the `[Retry]` test failed once and was reported as passed. That is
what retry does, and why the docs say to fix the cause of a flaky test rather
than lean on it. Categories feed the filter:
`dotnet test --filter "TestCategory=Checkout"` runs 4 tests of the lab and
`--filter "TestCategory!=Checkout"` the other 15.

### Parallelism and static state

MSTest runs the tests of an assembly one at a time until the assembly opts in.
`dotnet new mstest` opts in with this line:

```csharp
// MSTestSettings.cs
[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]
```

`MethodLevel` lets any two test methods run at once; `ClassLevel` runs classes
in parallel and the methods of a class one after another. `Workers = 0` (the
default) means one worker per logical processor. Instance fields are safe under
both, because each test has its own instance. A `static` field is shared by
every test running at the same time:

```csharp
// Broken: one inventory for the whole class, stocked once.
private static readonly Inventory SharedInventory = new();

[ClassInitialize]
public static void StockTheShelves(TestContext context) => SharedInventory.Restock("apple", 10, 0.50m);
```

Two tests that each buy 6 of those 10 apples cannot both pass. Run four times,
the failing one was `AnotherCustomerCanAlsoBuySixApples` three times and
`ACustomerCanBuySixApples` once: the result depends on scheduling, which is
the definition of flaky. The fix is the instance field from the start of this
page. For the test that truly touches process-wide state (an environment
variable, the current directory), `[DoNotParallelize]` on the method or class
runs it alone (today, after the parallel ones; the docs call that order an implementation detail).

### Do the tests protect the rules?

A green suite says the tests agree with the code, not that they would notice a
bug. Break the production code on purpose, one change at a time. These are the
results for the lab's solution:

| Change to the production code | Tests that fail |
| --- | --- |
| `Inventory.Reserve` skips the stock check | the out-of-stock test and "a failed reservation leaves the stock unchanged" |
| `Inventory.Reserve` skips the quantity check | both `[DataRow]` rows of the quantity test, and `AddingZeroUnitsIsRejected` |
| `Inventory.Reserve` subtracts before checking | "a failed reservation leaves the stock unchanged" |
| `Cart.Add` overwrites instead of adding | "adding the same product twice" |
| `Cart.Remove` does not release the stock | "removing a line gives the stock back" |
| `CheckoutAsync` releases only on a declined payment | the cancelled checkout test |
| `CheckoutAsync` keeps the lines after paying | the approved payment test |

The second row is the one to remember: the `Assert.Throws<ArgumentException>`
version of the zero-quantity test stays green under that change.

## Trade-offs

- **Constructor or `[TestInitialize]`.** The constructor gives `readonly` fields
  and is the documented preference; `[TestInitialize]` gives `async`,
  `[Timeout]`, and cleanup that still runs when setup throws. Mixing both in one
  class makes the order harder to read.
- **`[ClassInitialize]` saves time and shares state.** A container or an HTTP
  host started once per class is a real saving, but everything it holds is
  shared by tests that may run at the same time. Keep shared fixtures
  read-only, or give each test its own data inside them (a unique key per test).
  ```csharp
  var sku = $"sku-{Guid.NewGuid():N}"; // unique per test inside a shared inventory
  ```
- **`ThrowsExactly` is stricter, and sometimes too strict.** It catches a test
  that passes for the wrong reason, but it also fails when the code throws a
  legitimate subtype, as with `TaskCanceledException`. Choose per contract.
- **Parallel by opt-in is fast until something is shared.** Method-level
  parallelism finds hidden coupling early, which is the point. `[DoNotParallelize]`
  is the escape hatch for process-wide state, and it makes those tests wait
  until the rest are done.
- **`[Retry]` turns red into green, not flaky into stable.** It is reasonable
  around a truly unreliable dependency in an integration test, and harmful on a
  unit test, where the flakiness is a bug in the test or the code.
- **Assertions in `[AssemblyCleanup]` are possible, and awkward.** They see what
  no test can, but their failure is attached to an unrelated test name and they
  run under every filter. Keep them for checks like the lifecycle proof.

## Lab

A small shop is already implemented: an `Inventory` that reserves stock and a `Cart` that checks out through a payment gateway. Your job is to write the MSTest tests that prove it works, and to find out how MSTest really runs them.

**What you will practice**

- Proving the lifecycle order with a log, including the hooks that run after the test.
- Per-test fixtures in `readonly` fields, and what a `static` fixture does under parallelism.
- `Assert.ThrowsExactly` versus `Assert.Throws`, on a test that passes for the wrong reason and on a cancellation that needs the looser one.
- `TestContext` through the constructor, its `CancellationToken`, `[Timeout]` and `[TestCategory]` filters.

**Prerequisites:** C# basics with `async`/`await`, .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with a `TODO-NN` message until you write it. One test class is broken by design (it shares a `static` inventory), and one test already passes for the wrong reason. The optional TODOs ask you to filter by category and to mutate the production code and check that your suite notices.

## Documentation Links

- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [Test execution and control in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [MSTest migration from v3 to v4, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-migration-v3-v4) (doc)
- [Shared context between tests, xUnit.net](https://xunit.net/docs/shared-context) (doc)
