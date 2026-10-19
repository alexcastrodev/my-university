---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

A price table, a validation rule or a parser is a function with many inputs
and a few interesting ones. A data-driven test writes the check once and feeds
it rows, and MSTest reports every row as its own test. The hard part is not the
attributes: it is choosing rows that would catch a bug (the edges, not the
middle), keeping each row honest about why it passes, and not letting the
number of rows explode. The goal is to know every data source MSTest 4 offers
(`[DataRow]`, `[DynamicData]`, `TestDataRow<T>`, a custom `ITestDataSource`,
`[CombinatorialData]`), what each one can and cannot carry, and how to pick
rows that make the suite fail when the rule breaks.

## Use Cases

- Pinning down a table of prices, fees or limits on both sides of every edge.
- Testing input validation with one test and a row per invalid value, each one
  named in the report.
- Sharing a set of cases between several test classes.
- Generating rows from a definition (every band, every enum value) so a new
  entry gets tested without a new test.
- Replacing a `foreach` inside a test, which stops at the first failure, with
  rows that are all reported.

## Deep Dive

### DataRow: what fits in an attribute

`[DataRow]` puts the values inline. The number and types of the arguments must
match the parameters, and each row runs the whole test lifecycle (a new
instance, `[TestInitialize]`, the test, `[TestCleanup]`):

```csharp
[TestMethod]
[DataRow(0, DisplayName = "zero grams")]
[DataRow(-1, DisplayName = "a negative weight")]
[DataRow(30_001, DisplayName = "one gram over the limit")]
[DataRow(int.MaxValue)]
public void AWeightOutsideTheLimitsIsRejected(int grams)
{
    var error = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ShippingCalculator.Quote(grams, Zone.Domestic));

    Assert.AreEqual("weightGrams", error.ParamName);
}
```

A row without a `DisplayName` is named after its values, as in
`AWeightOutsideTheLimitsIsRejected (2147483647)`. Attribute arguments are
limited by C#, not by MSTest: constants, `typeof`, enums and one-dimensional
arrays. That covers more than it seems:

```csharp
[DataRow(null)]                       // a string? parameter
[DataRow((Zone)99)]                   // an enum value, even an undefined one
[DataRow(new[] { 500, 0 })]           // an int[] parameter
[DataRow(1_450, 500, 1_500)]          // (int expectedCents, params int[] parcelGrams)
[DataRow(2, IgnoreMessage = "bug #123")] // this row is reported as skipped
```

`decimal` is the gap, and money is usually `decimal`: the C# specification
does not list it among the attribute parameter types. `[DataRow(1_000, 5.00)]`
passes a `double`. The build warns (MSTEST0014, "DataRow should be valid": the
argument is a `double` where the parameter is a `decimal`), and the row fails
at run time with "Test data doesn't match method parameters", because MSTest
does not convert it. A string such as `"5.00"` fails the same way. Either carry
the value as an `int` in minor units (cents, as above) or move the rows to
`[DynamicData]`.

### Edges, not the middle

This test passes, and it looks thorough:

```csharp
// Broken: one test, four values, all in the middle of a band.
foreach (var (grams, expected) in new[] { (500, 5.00m), (3_000, 9.50m), (12_000, 18.00m), (25_000, 32.00m) })
{
    Assert.AreEqual(expected, ShippingCalculator.Quote(grams, Zone.Domestic));
}
```

It has two problems. Changing `weightGrams <= band.UpToGrams` to `<` in the band
lookup, the classic off-by-one, leaves it green, because no value sits on an
edge. And when a value is wrong, the first failing `Assert` ends the test:
swapping the prices of two bands produced one message (`expected: 9.50,
actual: 18.000`), and the second wrong value was never reported. Boundary value
analysis says where to look: the last value inside each band and the first one
outside it, plus the smallest and largest valid inputs. The weight bands end at
1, 5, 20 and 30 kg, which gives these rows:

```csharp
public static IEnumerable<(int Grams, decimal Expected)> BandEdges =>
[
    (1, 5.00m),
    (1_000, 5.00m),
    (1_001, 9.50m),
    (5_000, 9.50m),
    (5_001, 18.00m),
    (20_000, 18.00m),
    (20_001, 32.00m),
    (30_000, 32.00m),
];

[TestMethod]
[DynamicData(nameof(BandEdges))]
public void ADomesticParcelIsPricedByItsWeightBand(int grams, decimal expected) =>
    Assert.AreEqual(expected, ShippingCalculator.Quote(grams, Zone.Domestic));
```

With `<` instead of `<=`, four of these rows fail, each named by its weight. The
invalid side of the edges (0 g, 30 001 g) belongs to the validation test above.

### DynamicData: properties, methods, fields and other classes

`[DynamicData]` reads rows from a `public static` member that returns an
`IEnumerable` of tuples, `TestDataRow<T>` or `object[]`. Since MSTest 3.8 it
detects whether the member is a property, a method or (3.11+) a field.
`DynamicDataSourceType` still compiles, but the MSTEST0052 analyzer tells you to
remove it. A source in another class takes the type as a second argument, which
is how several test classes share one set of cases:

```csharp
[TestMethod]
[DynamicData(nameof(ShippingCases.Thresholds), typeof(ShippingCases))]
public void FreeShippingStartsAtTheThresholdForDomesticOrdersOnly(decimal orderTotal, Zone zone, decimal expected) =>
    Assert.AreEqual(expected, ShippingCalculator.Quote(500, zone, orderTotal));
```

The docs recommend value tuples for simple rows (types checked at compile time,
each element becomes a parameter) and warn against `object[]`, where a wrong
type only shows up at run time. Data sources are evaluated during discovery,
before `[AssemblyInitialize]` or `[ClassInitialize]` run, so a source cannot
depend on state those hooks create.

### Tuples, records and TestDataRow<T>

A tuple spreads into parameters. A record arrives as one parameter, and the row
is named after its `ToString()`, as in `RecordSource (Case { In = 1, Out = 2 })`:
readable for small records, noisy for big ones. When a row needs a name of its
own, wrap it in `TestDataRow<T>` (MSTest 3.8+), which also carries
`TestCategories` and an `IgnoreMessage` per row:

```csharp
public static class ShippingCases
{
    public static IEnumerable<TestDataRow<(decimal OrderTotal, Zone Zone, decimal Expected)>> Thresholds =>
    [
        new((99.99m, Zone.Domestic, 5.00m)) { DisplayName = "one cent below the threshold pays" },
        new((100.00m, Zone.Domestic, 0m)) { DisplayName = "exactly the threshold ships free" },
        new((100.00m, Zone.Neighbor, 7.50m)) { DisplayName = "the threshold does not apply to neighbors" },
        new((250.00m, Zone.International, 12.50m)) { DisplayName = "nor to international orders" },
    ];
}
```

The report then says "exactly the threshold ships free" instead of
`(100,00, Domestic, 0)`, and a failure explains itself. `DynamicDataDisplayName`
(a static method that builds the name from the row) is the older way to do the
same; the Testing Clean Architecture concept uses it.

### A custom ITestDataSource

When the rows come from a definition, an attribute that implements
`ITestDataSource` generates them. This one reads the band table of the code
under test and yields one row per edge and zone:

```csharp
[AttributeUsage(AttributeTargets.Method)]
public sealed class BandEdgesAttribute : Attribute, ITestDataSource
{
    public IEnumerable<object?[]> GetData(MethodInfo methodInfo) =>
        from band in ShippingCalculator.Bands
        where band.UpToGrams < ShippingCalculator.MaxWeightGrams
        from zone in Enum.GetValues<Zone>()
        select new object?[] { band.UpToGrams, zone };

    public string? GetDisplayName(MethodInfo methodInfo, object?[]? data) =>
        data is null ? null : $"{data[0]} g to {(int)data[0]! + 1} g, {data[1]}";
}

[TestMethod]
[BandEdges]
public void OneGramPastABandEdgeCostsMore(int lastGramOfBand, Zone zone) =>
    Assert.IsGreaterThan(
        ShippingCalculator.Quote(lastGramOfBand, zone),
        ShippingCalculator.Quote(lastGramOfBand + 1, zone));
```

A new band gets its rows without a new test. The trap is to take the expected
prices from the same table: a test that asks the code under test for its own
expectation agrees with any bug in it. Take only the inputs from the
definition, and assert a property that does not depend on it (here, one more
gram never costs less). Note the order of `Assert.IsGreaterThan(lowerBound,
value)`: the bound comes first.

### Assert the rule that fired

Validation tests have their own way of passing for the wrong reason. Every check
in `Quote` throws `ArgumentOutOfRangeException`, and they run in order:

```csharp
// Broken: weight 0 is rejected first. Green even with the order total check deleted.
Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ShippingCalculator.Quote(0, Zone.Domestic, -1m));

// Fixed: only the order total is invalid, and ParamName says which check fired.
var error = Assert.ThrowsExactly<ArgumentOutOfRangeException>(
    () => ShippingCalculator.Quote(500, Zone.Domestic, orderTotal: -0.01m));
Assert.AreEqual("orderTotal", error.ParamName);
```

One invalid value per row, everything else valid, and an assertion on what
identifies the rule (`ParamName`, an error code, the message key).

### Combinatorial explosion

Rows multiply. Three zones times eight weights times three order totals times
four promo codes is 288 cases, and most of them test the same thing. MSTest 4.4
added `[CombinatorialData]`, which generates the Cartesian product: it infers
all values of an enum (and `true`/`false` for a `bool`), and takes explicit
values for the rest:

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting.Combinatorial;

[TestMethod]
[CombinatorialData]
public void EveryValidParcelPaysSomethingBelowTheThreshold(
    Zone zone,
    [CombinatorialValues(1, 1_000, 1_001, 30_000)] int grams) =>
    Assert.IsPositive(ShippingCalculator.Quote(grams, zone));
```

That is 3 x 4 = 12 cases. The docs are explicit that it is exhaustive only: no
pairwise generation and no exclusions between values. Use it for a property
that must hold everywhere, keep each parameter to the values that matter, and
test the interactions that matter (free shipping only for domestic orders) as
explicit rows. Before 4.4, the community package Combinatorial.MSTest filled
this gap.

### Non-deterministic data breaks the names

A row's name comes from its values, and `dotnet test --list-tests` evaluates the
source. A source with `Guid.NewGuid()` or `DateTime.Now` produced different
names on every listing:

```text
NonDeterministic (fa4aa7e0-2358-4a8d-979a-a5846d42a067,18/10/2026 23:12:08)
NonDeterministic (3e1343f3-04b0-4e21-ae9e-cbc826a92c4f,18/10/2026 23:12:09)
```

A test whose name changes cannot be rerun by name, filtered, or tracked across
runs in Test Explorer or CI history. Make the data fixed (a constant `Guid`, a
`FakeTimeProvider` with a known instant) and generate anything random inside the
test. When a source truly cannot be stable, the docs recommend
`[TestMethod(UnfoldingStrategy = TestDataSourceUnfoldingStrategy.Fold)]`, which
reports all rows under one test node.

### DataSource in MSTest 4

`[DataSource]` (rows from CSV, XML or a database through a connection string) is
.NET Framework only, per the data-driven testing docs. On .NET 10 with MSTest
4.5.1 a `[DataSource]` test still compiles, and the run reports it as skipped:
it never runs. To keep cases in a file, read the file in a `[DynamicData]`
method, which keeps the rows typed.

### Do the tests protect the rules?

Break the production code on purpose, one change at a time, and see what turns
red. These are the results for the lab's solution (53 tests from 13 methods):

| Change to the production code | Tests that fail |
| --- | --- |
| Band lookup uses `<` instead of `<=` | 4 edge rows, all 9 `[BandEdges]` rows, 3 combinatorial rows |
| Free shipping uses `>` instead of `>=` | "exactly the threshold ships free" |
| Promo code compared case-sensitively | "the code is case-insensitive", "surrounding spaces are ignored" |
| Prices of two bands swapped | 4 edge rows, 3 `[BandEdges]` rows, 2 parcel rows |
| Maximum weight check deleted | "one gram over the limit", the `int.MaxValue` row, one parcel row |
| Free shipping applied to every zone | the promo code abroad test and two threshold rows |
| Order total check deleted | `ANegativeOrderTotalIsRejected` (the broken version above stays green) |

The middle-of-band loop survives the first row of this table. The rows on the
edges do not.

## Trade-offs

- **DataRow is the most readable, and the most limited.** The data sits next to
  the test, but only constants fit, so `decimal`, `DateTime` and objects need
  `[DynamicData]` or a value in minor units.
- **Rows hide duplication; too many rows hide intent.** Eight edge rows are a
  specification. Eighty rows that differ in nothing the rule cares about are
  noise that slows the suite and the reader. Each row should be there for a
  reason you could name.
- **Named rows cost a line each.** `TestDataRow<T>` with a `DisplayName` makes a
  failure explain itself, which pays off for business rules and is overkill for
  a list of invalid inputs that the values already describe.
- **Generated rows follow the code; generated expectations follow its bugs.** A
  custom source that reads a table keeps the tests complete as the table grows,
  as long as the assertion does not read the same table.
- **Combinatorial coverage is exhaustive, not smart.** It finds a combination
  nobody thought of, at the price of many cases. Explicit rows for the
  interactions that matter are cheaper and clearer.
  ```csharp
  [CombinatorialValues(1, 1_000, 1_001, 30_000)] int grams // the edges, not every weight
  ```
- **One test with a loop is faster to write.** It also stops at the first
  failure and gives every case the same name. Prefer rows, unless the cases are
  steps of one scenario rather than independent examples.
- **The idea is the same in every framework.** xUnit has `[InlineData]`,
  `[MemberData]` and, in v3, `TheoryDataRow<T>`; JUnit has parameterized tests.
  The Java concept on fixtures and parameterized tests covers the theory.

## Lab

A shipping calculator is already implemented: weight bands, three zones, free domestic shipping from 100.00 or with a promo code, and orders with several parcels. Your job is to write data-driven MSTest tests that prove its rules, and to find out where the bugs of a price table hide.

**What you will practice**

- Replacing a loop over middle-of-band values with rows on both sides of every edge.
- `[DataRow]` with display names, `null`, enums, arrays and `params`, and what to do about `decimal`.
- `[DynamicData]` from another class, with `TestDataRow<T>` names.
- A custom `ITestDataSource` that generates edges from the band table, and a test that asserts a property instead of a price.

**Prerequisites:** MSTest 4 Fundamentals (the concept and its lab), .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with a `TODO-NN` message until you write it. One test already passes, and keeps passing with a real bug in the band lookup: the first TODO asks you to prove it, then fix it. The optional TODOs add `[CombinatorialData]` and a mutation check.

## Documentation Links

- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTEST0014: DataRow should be valid, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/mstest-analyzers/mstest0014) (doc)
- [MSTEST0052: Avoid passing an explicit DynamicDataSourceType and use the default auto detect behavior, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/mstest-analyzers/mstest0052) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [MSTest migration from v3 to v4, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-migration-v3-v4) (doc)
- [Attributes (C# language specification), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/attributes) (doc)
