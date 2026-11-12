---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

This track is written in MSTest, and most repositories you will join are not.
xUnit is the framework you meet first in open source and in many companies, and
the Choosing a Test Framework concept already compares the four frameworks on
parallelism, runners and assertions. What it does not teach is how an xUnit
suite is put together: how the constructor replaces `[TestInitialize]`, what a
fixture is, how two classes share one object, and why the same `Assert.Throws`
name means something else. This lesson ports one MSTest 4.5.3 suite to xUnit
v3 4.0.3, keeps the test names, and measures what changes. The suite has 14
tests in both frameworks, 13 passing and one skipped, and it ran on the .NET
11.0.100 GA SDK (`net10.0` projects, with roll forward) under
Microsoft.Testing.Platform. It does not repeat the comparison tables of
Choosing a Test Framework, or the MSTest lifecycle of MSTest Fundamentals.

## Use Cases

- Reading and fixing tests in an xUnit codebase when your own habits are MSTest.
- Porting a suite in either direction without a rename that changes meaning.
- Sharing an expensive object (a catalog, a container, a database seed) across
  tests, and across classes, the xUnit way.
- Reading why a collection of classes runs serially while the rest runs in parallel.

## Deep Dive

### The project

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <UseMicrosoftTestingPlatformRunner>true</UseMicrosoftTestingPlatformRunner>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.3" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
</Project>
```

A v3 test project is an executable. The package `xunit.v3` depends on
`xunit.v3.mtp-v2` 4.0.3, so MTP v2 is the default, and `xunit.v3.mtp-off`
turns it off. Per the xUnit documentation, `UseMicrosoftTestingPlatformRunner`
is optional: it swaps xUnit's own command line (the "In-Process Runner") for the
MTP one. Without the property, running the executable printed the header
`xUnit.net v3 In-Process Runner v4.0.3`; with it, the MTP help (`--filter-uid`,
`--diagnostic`, and so on). And on SDK 10
and later, `dotnet test` uses MTP when `global.json` says so, which is the same
file the MSTest projects use:

```json
{ "test": { "runner": "Microsoft.Testing.Platform" } }
```

With it, the MSTest and xUnit projects ran in one `dotnet test` of the
solution, and the xUnit project also ran alone with
`dotnet test --project tests/Shop.XTests`.

### The equivalence table

Every row was exercised by one test in the lab, in both frameworks:

| Concern | MSTest 4.5.3 | xUnit v3 4.0.3 |
| --- | --- | --- |
| A test | `[TestClass]` + `[TestMethod]` | `[Fact]`, no class attribute |
| Per-test setup | constructor or `[TestInitialize]` | constructor, or `IAsyncLifetime.InitializeAsync` |
| Per-test cleanup | `[TestCleanup]`, `IDisposable` | `IDisposable`, or `IAsyncLifetime.DisposeAsync` |
| Once per class | static `[ClassInitialize]` | `IClassFixture<T>` |
| Shared across classes | `[AssemblyInitialize]` or a static field | `[CollectionDefinition]` + `ICollectionFixture<T>` + `[Collection]` |
| Data rows | `[DataRow(0)]` | `[Theory]` + `[InlineData(0)]` |
| Data from a member | `[DynamicData(nameof(X))]` | `[MemberData(nameof(X))]` over `TheoryData<...>` |
| Exact exception type | `Assert.ThrowsExactly<T>` | `Assert.Throws<T>` |
| Exception or subclass | `Assert.Throws<T>` | `Assert.ThrowsAny<T>` |
| Skip | `[Ignore("reason")]` | `[Fact(Skip = "reason")]` |
| Category | `[TestCategory("Fast")]` | `[Trait("Category", "Fast")]` |
| Test output | `TestContext.WriteLine` | `ITestOutputHelper.WriteLine` |
| Token and name | `TestContext.CancellationToken`, `.TestName` | `TestContext.Current.CancellationToken`, `.Test` |
| Parallel unit | whatever `[Parallelize]` says | the test collection, a class by default |
| Filter by category | `--filter "TestCategory=Fast"` | `--filter-trait "Category=Fast"` |

### One class, ported

The MSTest class keeps a `TestContext` property and builds the catalog in a
static `[ClassInitialize]`. The xUnit class asks for what it needs in the
constructor, and a small class carries the shared object:

```csharp
public sealed class CatalogFixture
{
    public PriceCatalog Catalog { get; } = new();
}

[Trait("Category", "Fast")]
public sealed class BasketTests : IClassFixture<CatalogFixture>
{
    private readonly PriceCatalog _catalog;
    private readonly Basket _basket;
    private readonly ITestOutputHelper _output;

    public BasketTests(CatalogFixture fixture, ITestOutputHelper output)
    {
        _catalog = fixture.Catalog;
        _basket = new Basket(_catalog);
        _output = output;
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void QuantitiesBelowOneAreRejected(int quantity) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => _basket.Add("apple", quantity));
}
```

The constructor is the per-test setup because every test gets its own instance,
as in MSTest. A `TheoryData<string, decimal>` replaced the tuple source and is
typed at compile time. The list of tests shows the row display names:

```text
Shop.XTests.BasketTests.QuantitiesBelowOneAreRejected(quantity: 0)
Shop.XTests.BasketTests.QuantitiesBelowOneAreRejected(quantity: -1)
MSTest: QuantitiesBelowOneAreRejected (0)
```

xUnit prints the fully qualified name with the parameter names; MSTest prints
the method name and the values.

### Lifecycle, proved by a log

A probe logged every hook of a class that implements `IClassFixture`,
`IAsyncLifetime` and `IDisposable`, with a collection fixture, and two tests.
The log of one run:

```text
collection fixture: constructor
collection fixture: InitializeAsync
class fixture: constructor
class fixture: InitializeAsync
  test class: constructor
  test class: InitializeAsync
  test: First
  test class: DisposeAsync
  test class: constructor
  test class: InitializeAsync
  test: Second
  test class: DisposeAsync
class fixture: DisposeAsync
collection fixture: DisposeAsync
```

Three facts to carry. The test class is constructed once per test (twice here).
The class fixture lives across the tests of the class, and the collection
fixture across the classes of the collection, and both are disposed after the
last test. And `Dispose` was never logged: with `DisposeAsync` present on the
same class, only `DisposeAsync` ran, so implement one of the two. In xUnit v3
`InitializeAsync` and `DisposeAsync` return `ValueTask`, not `Task`.

### Sharing across classes: the collection

MSTest shared a single-writer `ReportStore` through a static field and kept two
classes apart with `[DoNotParallelize]`. In xUnit the class that owns the
resource is a fixture, and the collection ties the classes to it:

```csharp
public sealed class ReportStoreFixture { public ReportStore Store { get; } = new(); }

[CollectionDefinition("report-store")]
public sealed class ReportStoreCollection : ICollectionFixture<ReportStoreFixture>;

[Collection("report-store")]
public sealed class ReportTests(ReportStoreFixture fixture) { /* ... */ }

[Collection("report-store")]
public sealed class ArchiveTests(ReportStoreFixture fixture) { /* ... */ }
```

Each report test holds the store for 100 ms and the store throws if two callers
overlap. With both classes in one collection, the three tests ran one after the
other, on one thread:

```text
ReportTests.A          thread  4      0 ms ->   100 ms
ReportTests.Another    thread  4    101 ms ->   202 ms
ArchiveTests.Read      thread  4    204 ms ->   305 ms
```

When each class had its own `IClassFixture` and no collection, the two classes
overlapped (each with its own store) and the run took 202 ms. In both runs the
two tests inside `ReportTests` ran sequentially: the default unit of parallelism
in xUnit is the collection, and a class without an attribute is a collection of
its own. Choosing a Test Framework measured the defaults and `parallelMode` in 4.x.

What happens when the attribute is forgotten is different in the two
frameworks. Removing `[DoNotParallelize]` from the MSTest classes failed at run
time, a race that depends on timing:

```text
System.InvalidOperationException: The report store is busy.
```

Removing `[Collection]` in xUnit warned at build time and failed every test of
the two classes in the run:

```text
warning xUnit1041: Fixture argument 'fixture' does not have a fixture source (if it comes from a
  collection definition, ensure the definition is in the same assembly as the test)
warning xUnit1073: Collection definition 'report-store' is never used. Fix a misspelled collection name in a ...
Xunit.MicrosoftTestingPlatform.XunitException: The following constructor parameters did not have matching fixture data: ReportStoreFixture fixture
```

That is a strength of the fixture model: a missing collection cannot silently
become a race, as long as the shared object comes from the fixture and not from
a static field.

### `Assert.Throws<T>` means exact

The line `Assert.Throws<ArgumentException>(...)` was the correct MSTest line for
`UnknownProductException`, which derives from `ArgumentException`. Typed as is
in xUnit it fails:

```text
Assert.Throws() Failure: Exception type was not an exact match
Expected: typeof(System.ArgumentException)
Actual:   typeof(Shop.UnknownProductException)
---- Shop.UnknownProductException : Unknown product 'plum'. (Parameter 'sku')
```

`Assert.ThrowsAny<ArgumentException>` accepts the subclass. The failure is loud
here, but the reverse port is silent: `Throws<T>` in xUnit becomes `Throws<T>` in
MSTest by a rename, and then accepts subclasses, so the test can pass for the
wrong reason. The rule from the other concept holds: port to `ThrowsExactly`.

### Output and the test context

`ITestOutputHelper` is injected through the constructor. In MTP mode its text
was shown for the failing test, under `Standard output`, and not for the
passing one until `--output Detailed`:

```text
failed Shop.XTests.Out.Fails (2ms)
  boom
  Standard output
    hello from a failing test
```

MSTest's `TestContext.WriteLine` appeared the same way, under `Standard output`
and `TestContext Messages:`, with `--output Detailed`. The per-test context is a
static in xUnit v3: `TestContext.Current.CancellationToken` and
`TestContext.Current.Test?.TestDisplayName`, which printed
`Shop.XTests.BasketTests.TheTestKnowsItsOwnNameAndItsCancellationToken` in the
run, the same display name as in the list above. The analyzer package has a rule that depends on
it: `await Task.Delay(1)` in a test gave `xUnit1051: Calls to methods which
accept CancellationToken should use TestContext.Current.CancellationToken to
allow test cancellation to be more responsive`.

### Filters, skips and exit codes

```bash
dotnet test --project tests/Shop.XTests --filter-trait "Category=Fast"
```

printed `total: 11` and `skipped: 1`, the class with its theory rows and its one
skipped test. A trait that matched nothing (`Category=Slow`) ended with `Test run
completed with non-success exit code: 8. No tests ran.`, the same exit code that
MSTest and the other frameworks return for an empty filter. A failed test gave
exit code 2 in both.

## Trade-offs

- **Constructor setup vs attributes.** Fewer attributes, and the setup is plain C#
  in the constructor. MSTest's `[TestInitialize]` is explicit and easier to find
  by name when a class has many members.
- **Fixtures are a type per shared object.** More files, but a missing collection
  fails the build or every test of the class, instead of racing. A static field
  shared through `[DoNotParallelize]` is shorter and fails by luck.
- **Collections serialize more than you think.** Every class in a collection runs
  one after the other. Three 100 ms tests went from 202 ms to 305 ms here.
  Put only the classes that really share the resource in the collection.
- **Same names, different meaning.** `Throws<T>` is exact in xUnit and lenient in
  MSTest. A mechanical port in either direction changes what a test accepts.
- **Two vocabularies in one repository costs.** If the suite already is MSTest,
  switching for taste is a rewrite of every attribute, assertion and fixture;
  learn xUnit to work in an xUnit repository, and let the repository decide.

## Lab

The shop is already implemented, with a finished MSTest suite next to an empty xUnit project. Your job is to port the suite to xUnit v3 and find out where a rename is not enough.

**What you will practice**

- Mapping `[TestMethod]`, `[DataRow]`, `[DynamicData]`, `[Ignore]` and `[TestCategory]` to xUnit.
- Turning a static `[ClassInitialize]` into an `IClassFixture<T>`.
- Sharing one single-writer resource across two classes with a collection fixture, and reading what happens without it.
- Replacing `Assert.ThrowsExactly` and `Assert.Throws` with the right xUnit pair, `ITestOutputHelper` and `TestContext.Current`.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, Choosing a Test Framework: MSTest, xUnit, NUnit and TUnit, .NET 10 SDK.

**How it works:** the MSTest project passes (13 tests and one skipped). In the xUnit project every test is a stub with a failing `TODO-NN` assertion and hints, and `dotnet test` runs both projects through the Microsoft.Testing.Platform mode selected in `global.json`.

## Documentation Links

- [Getting started with xUnit.net v3, xunit.net](https://xunit.net/docs/getting-started/v3/getting-started) (doc)
- [xUnit.net v3 and Microsoft.Testing.Platform, xunit.net](https://xunit.net/docs/getting-started/v3/microsoft-testing-platform) (doc)
- [Shared context between tests, xunit.net](https://xunit.net/docs/shared-context) (doc)
- [Running tests in parallel, xunit.net](https://xunit.net/docs/running-tests-in-parallel) (doc)
- [xUnit.net v3 4.0.0 release notes, xunit.net](https://xunit.net/releases/v3/4.0.0) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
