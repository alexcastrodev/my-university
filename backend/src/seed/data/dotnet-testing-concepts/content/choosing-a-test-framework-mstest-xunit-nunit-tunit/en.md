---
version: 1.0
updatedAt: 2026-10-29
---
## Objective

.NET has four test frameworks in real use: MSTest, xUnit.net, NUnit and TUnit.
The choice looks like a matter of attribute names, but the differences that
cost money are elsewhere: how many instances of the test class exist, what runs
in parallel when nobody configured anything, which runner each one needs, what
a failure looks like and which assertions behave differently under the same
name. This lesson writes the same eight tests in all four against one class
library and compares them by running them on .NET 10 with MSTest 4.5.2, xunit.v3
4.0.2, NUnit 5.0.0 (NUnit3TestAdapter 6.3.1) and TUnit 1.76.45, the latest
stable versions on NuGet on 2026-10-29. It ends with a migration from xUnit to
MSTest and a decision guide, without declaring a winner.

## Use Cases

- Picking a framework for a new solution with facts the team can rerun.
- Moving a suite between frameworks knowing which lines change meaning.
- Explaining why a suite got slower, or started failing at random, after a
  framework switch: the parallelism and instance defaults differ.
- Writing CI filters and exit-code checks for a mixed-framework solution.

## Deep Dive

### Versions and runners

Each test project is a Microsoft.Testing.Platform (MTP) executable, and
`global.json` selects the MTP mode of `dotnet test`:

| Framework | Packages | MTP | VSTest on SDK 10 |
| --- | --- | --- | --- |
| MSTest 4.5.2 | `MSTest` | `EnableMSTestRunner` | `-p:EnableMSTestRunner=false` |
| xUnit.net v3 4.0.2 | `xunit.v3`, plus `xunit.runner.visualstudio` 4.0.1 for VSTest | built in (MTP v2) | `-p:IsTestingPlatformApplication=false` |
| NUnit 5.0.0 | `NUnit`, `NUnit3TestAdapter` 6.3.1 | `EnableNUnitRunner` | `-p:EnableNUnitRunner=false` |
| TUnit 1.76.45 | `TUnit` | always | not supported |

With MTP on, the VSTest mode of `dotnet test` on SDK 10 refuses all four
(`Testing with VSTest target is no longer supported by Microsoft.Testing.Platform
on .NET 10 SDK and later`). With the property in the last column, MSTest, xUnit
and NUnit ran under VSTest; TUnit's build then fails with `CS5001: Program does
not contain a static 'Main' method`. Per its release notes, xUnit 4.0
(2026-08) dropped MTP v1 and added Native AOT and full parallelization.

### The same eight tests

A plain test, an exception test, inline data (3 rows), member data (2 rows), a
test that needs setup and teardown, an async test, a skipped test and a
categorized test: 11 cases, 10 passed and 1 skipped in each framework. The
table is copied from the four files that compiled:

| | MSTest | xUnit v3 | NUnit | TUnit |
| --- | --- | --- | --- | --- |
| Test | `[TestMethod]` in `[TestClass]` | `[Fact]` | `[Test]` | `[Test]` |
| Inline data | `[DataRow(1, 2, 3)]` | `[Theory]` + `[InlineData]` | `[TestCase(1, 2, 3)]` | `[Arguments(1, 2, 3)]` |
| Member data | `[DynamicData(nameof(Cases))]` | `[MemberData]` + `TheoryData<int, int, int>` | `[TestCaseSource]` | `[MethodDataSource]` |
| Per test | ctor or `[TestInitialize]`, `[TestCleanup]` | ctor, `Dispose` | `[SetUp]`, `[TearDown]` | `[Before(Test)]`, `[After(Test)]` |
| Per class | static `[ClassInitialize]`, `[ClassCleanup]` | `IClassFixture<T>` | `[OneTimeSetUp]`, `[OneTimeTearDown]` | static `[Before(Class)]`, `[After(Class)]` |
| Skip | `[Ignore("...")]` | `[Fact(Skip = "...")]` | `[Ignore("...")]` | `[Skip("...")]` |
| Category | `[TestCategory("Fast")]` | `[Trait("Category", "Fast")]` | `[Category("Fast")]` | `[Category("Fast")]` |
| Equality | `Assert.AreEqual(5, x)` | `Assert.Equal(5, x)` | `Assert.That(x, Is.EqualTo(5))` | `await Assert.That(x).IsEqualTo(5)` |
| Exact exception type | `Assert.ThrowsExactly<T>` | `Assert.Throws<T>` | `Assert.Throws<T>` | `.ThrowsExactly<T>()` |
| Subclass accepted | `Assert.Throws<T>` | `Assert.ThrowsAny<T>` | `Assert.Catch<T>` | `.Throws<T>()` |

The exception rows were checked by throwing `ArgumentNullException` where the
test expects `ArgumentException`: the second form passed, the first failed, in
all four. `Throws<T>` is exact in xUnit and NUnit and lenient in MSTest and TUnit.

### Lifecycle and isolation

Each class logs from a field initializer (an instance counter), its constructor
and its hooks. For the 11 cases of one class:

```text
MSTest  class init, 10 x (ctor #n, setup on #n, teardown on #n, dispose #n), class cleanup
xUnit   class fixture ctor, 10 x (ctor = setup #n, dispose = teardown on #n), fixture dispose
NUnit   ctor #1, one-time setup, 10 x (setup on #1, teardown on #1), one-time teardown
TUnit   before class, ctor #1..#10 on 10 threads, before/after test, dispose, after class
```

MSTest, xUnit and TUnit create one instance per test (10: the skipped test is
never constructed). NUnit creates one per fixture, so a field set by one test is
seen by the next; with `[assembly: Parallelizable(ParallelScope.All)]` the log
showed `setup on #1` from 10 threads, all writing the same `_ledger` field.
`[FixtureLifeCycle(LifeCycle.InstancePerTestCase)]` gives 10 instances, and
then an instance `[OneTimeSetUp]` fails every test at run time, with no build
warning: `Only static OneTimeSetUp and OneTimeTearDown are allowed for
InstancePerTestCase mode.`

### Parallelism by default

Two classes with four tests each, every test doing `Thread.Sleep(300)`. The span
runs from the first start to the last end in the log (startup excluded):

| | Nothing configured | Classes in parallel | Every test in parallel |
| --- | --- | --- | --- |
| MSTest | 2.45 s, 1 thread | 1.23 s: `[assembly: Parallelize(Workers = 0, Scope = ExecutionScope.ClassLevel)]` | 0.30 s: `Scope = ExecutionScope.MethodLevel` |
| xUnit | 1.23 s, 2 threads (one per class) | the default | 0.30 s: `"parallelMode": "all"` or `--parallel all` (new in 4.0) |
| NUnit | 2.44 s, 1 thread | 1.21 s: `[assembly: Parallelizable(ParallelScope.Fixtures)]` | 0.30 s: `ParallelScope.All` |
| TUnit | 0.30 s, 8 threads | | the default |

Turning it off: xUnit `"parallelizeTestCollections": false` or `--parallel none`
gave 2.44 s, TUnit `[assembly: NotInParallel]` 2.43 s. Only the defaults differ:
tests moved to TUnit overlap, tests moved from xUnit to MSTest or NUnit do not.

### Assertion style and failure messages

The same failing check, `Calculator.Add(2, 2)` expected to be 5:

```text
MSTest  Assertion failed. Expected values to be equal.
        expected: 5
        actual:   4
        Assert.AreEqual(5, Calculator.Add(2, 2))
xUnit   Assert.Equal() Failure: Values differ
        Expected: 5
        Actual:   4
NUnit   Assert.That(Calculator.Add(2, 2), Is.EqualTo(5))
        Expected: 5
        But was:  4
TUnit   AssertionException: Expected to be 5
        but found 4
        at Assert.That(Calculator.Add(2, 2)).IsEqualTo(5)
```

MSTest, NUnit and TUnit quote the source expression. TUnit assertions are
awaitable, so every asserting test is `async Task`, and a forgotten `await` is a
build error from the analyzers inside the TUnit package: `error
TUnitAssertions0002: Assert statements must be awaited - all TUnit assertions
return Task`.

### Filtering and exit codes

The one test in category `Fast`, through `dotnet test` in MTP mode; each run
reported `total: 1`:

```bash
dotnet test --project tests/MsTests --filter "TestCategory=Fast"
dotnet test --project tests/NTests  --filter "TestCategory=Fast"   # "Category=Fast" also works
dotnet test --project tests/XTests  --filter-trait "Category=Fast"
dotnet test --project tests/TTests  --treenode-filter "/*/*/*/*[Category=Fast]"
```

xunit.v3 4.0.2 also accepted `--filter "Category=Fast"`: its `--help` lists a
VSTest-syntax `--filter` next to `--filter-query`. TUnit rejects `--filter`
(`Unknown option '--filter'`, exit code 5) and xUnit rejects `--treenode-filter`
the same way. On MTP all four return 2 when a test fails and 8 when the filter
matches nothing. Under VSTest, `--filter` worked for MSTest and NUnit
(`TestCategory=Fast`) and xUnit (`Category=Fast`); an empty match in MSTest and
NUnit printed `No test matches the given testcase filter` and exited 0.

### Run time at 2,000 tests

One project per framework, 20 classes of 100 trivial tests, Release, default
settings, median of 3 runs on an Apple M4 Max laptop (14 cores). `dotnet test
--no-build` took about 0.5 s for MSTest, 0.65 s for NUnit and 0.7 s for xUnit
and TUnit; the executable alone took about 0.25 s to 0.4 s, and about 0.2 s to
0.25 s for a single test, so most of it is startup. TUnit's docs publish
benchmarks where it is faster; with trivial tests here it did not show up.

### Analyzers

The same mistake, a constant passed as the actual value, was caught by each:

```text
MSTEST0017: Assertion arguments should be passed in the correct order. 'actual' and 'expected'/'notExpected' arguments have been swapped.
xUnit2000: The literal or constant value 4 should be passed as the 'expected' argument in the call to 'Assert.Equal(expected, actual)'
NUnit2007: The actual value should not be a constant - perhaps the actual value and the expected value have switched places
TUnitAssertions0005: Assert.That(...) should not be used with a constant value
```

MSTest.Analyzers 4.5.2 and xunit.analyzers 2.2.0 come with the framework
package, NUnit.Analyzers 4.15.0 is a separate reference, and TUnit's ship in
TUnit.Core 1.76.45 (the standalone `TUnit.Analyzers` package stopped at 0.1.984).

### Migrating xUnit to MSTest

Three tests, before (xUnit) and after (MSTest); both versions ran green:

```csharp
// before
public static TheoryData<int, int, int> Cases => new() { { 2, 2, 4 }, { 10, -3, 7 } };
[Fact] public void Divide_ByZero_Throws() =>
    Assert.Throws<DivideByZeroException>(() => Calculator.Divide(1, 0));
[Theory, MemberData(nameof(Cases))] public void Add_FromMember(int a, int b, int expected) =>
    Assert.Equal(expected, Calculator.Add(a, b));
[Fact] public void Balance_SumsEntries() { _ledger.Record(5); _ledger.Record(-2); Assert.Equal(3, _ledger.Balance); }

// after: the class gets [TestClass]; the _ledger field and Dispose stay as they are
public static IEnumerable<(int, int, int)> Cases => [(2, 2, 4), (10, -3, 7)];
[TestMethod] public void Divide_ByZero_Throws() =>
    Assert.ThrowsExactly<DivideByZeroException>(() => Calculator.Divide(1, 0));
[TestMethod, DynamicData(nameof(Cases))] public void Add_FromMember(int a, int b, int expected) =>
    Assert.AreEqual(expected, Calculator.Add(a, b));
[TestMethod] public void Balance_SumsEntries() { _ledger.Record(5); _ledger.Record(-2); Assert.AreEqual(3, _ledger.Balance); }
```

What does not map one to one:

- **Constructor and `IDisposable`** carry over (MSTest called `Dispose` after
  `[TestCleanup]`); `IAsyncLifetime` becomes an async `[TestInitialize]`.
- **`Assert.Throws<T>`** must become `Assert.ThrowsExactly<T>`; a plain rename
  silently starts accepting subclasses. `TheoryData<...>` becomes tuples.
- **Fixtures**: `IClassFixture<T>` becomes static `[ClassInitialize]`; MSTest
  has no test collections, so a collection fixture becomes
  `[AssemblyInitialize]` plus `[DoNotParallelize]` on the classes involved.
- **Parallelism**: the suite runs serially until `[Parallelize]` is added.

### Decision guide

| Situation | What the runs and the docs say |
| --- | --- |
| Team already on one framework | All four ran the eight tests, reached every parallelism level and returned the same MTP exit codes; a move costs the traps above, so it needs a reason from a row below |
| Wants parallel by default | TUnit (every test), xUnit (classes; `parallelMode: all` since 4.0); MSTest and NUnit are serial until configured |
| Needs Native AOT (not published here) | The docs: MSTest supports it with a limited feature set; xUnit 4.0+ through `*.aot` packages (C#, .NET 9+); TUnit through its default source-generation mode; no NUnit page found |
| Heavy data-driven tests | All four have inline and member sources; `TheoryData<>` and the tuple sources of MSTest and TUnit are typed |
| Must keep VSTest (other adapters, older tooling) | MSTest, xUnit, NUnit; not TUnit |
| IDE support | The docs: Visual Studio, VS Code and Rider for MSTest (Microsoft) and xUnit (xunit.net); TUnit lists all three, each behind an opt-in MTP setting |

## Trade-offs

- **Instance per test vs per fixture.** Per test (MSTest, xUnit, TUnit) makes
  fields safe and costs a constructor call per test; NUnit's shared fixture
  lets tests reuse state built once, and turns every field into shared state.
- **Parallel by default.** TUnit surfaces coupling between tests as soon as
  they move to it, as failures that look random; MSTest and NUnit stay serial,
  and slower, until someone opts in.
- **Same names, different semantics.** `Assert.Throws<T>` and `--filter` vary
  per framework; a mechanical rename is not a migration.

## Documentation Links

- [Testing in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/) (doc)
- [Microsoft.Testing.Platform overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-intro) (doc)
- [Getting started with xUnit.net v3, xunit.net](https://xunit.net/docs/getting-started/v3/getting-started) (doc)
- [xUnit.net v3 4.0.0 release notes, xunit.net](https://xunit.net/releases/v3/4.0.0) (doc)
- [NUnit framework release notes, docs.nunit.org](https://docs.nunit.org/articles/nunit/release-notes/framework.html) (doc)
- [TUnit introduction, tunit.dev](https://tunit.dev/docs/intro/) (doc)
