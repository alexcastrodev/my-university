---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

An example-based test says "for this input, this output". It is only as good as
the inputs its author thought of, and the bugs that matter live in the inputs
nobody thought of. A property-based test says something that must be true for
every input of a kind ("the shares always add up to the amount"), and a library
generates the inputs: hundreds of them, including the awkward ones. When the
property fails, the library shrinks the failing input to a small one and prints
the seed that reproduces it. FsCheck is the library for .NET. The goal: write
properties for a method, build generators and shrinkers with `Arbitrary`, read a
failure and replay it by seed, run FsCheck from an MSTest 4 `[TestMethod]`, and
know when a property is not worth writing.
Versions measured: `FsCheck` 3.6.0, `MSTest` 4.5.3, on the .NET 10.0.100 SDK and the `net10.0` target.

## Use Cases

- Code with a rule that holds for a whole range of inputs: splitting money,
  rounding, sorting, parsing and formatting, merging, normalising.
- A method where the existing examples all pass and you do not trust them.
- A bug report that "only happens sometimes", with inputs you cannot guess.
- Code that must keep a relation between two operations (encode and decode,
  add and remove, a fast version and a slow obvious one).

## Deep Dive

### Four green examples and a bug

The lab has `MoneySplitter.Split(long cents, int parts)`: it splits an invoice,
or a refund, into shares. The rule is simple: the shares add up to the amount,
and no two shares differ by more than one cent. The first version:

```csharp
public static long[] Split(long cents, int parts)
{
    ArgumentOutOfRangeException.ThrowIfLessThan(parts, 1);

    var share = cents / parts;
    var remainder = cents % parts;

    var result = new long[parts];
    for (var i = 0; i < parts; i++)
    {
        result[i] = share + (i < remainder ? 1 : 0);
    }
    return result;
}
```

And the tests a developer writes first, with the techniques of the data-driven
concept:

```csharp
[TestMethod]
[DataRow(100L, 3, new long[] { 34, 33, 33 })]
[DataRow(100L, 4, new long[] { 25, 25, 25, 25 })]
[DataRow(1L, 3, new long[] { 1, 0, 0 })]
[DataRow(0L, 5, new long[] { 0, 0, 0, 0, 0 })]
public void AnInvoiceIsSplitInShares(long cents, int parts, long[] expected)
{
    CollectionAssert.AreEqual(expected, MoneySplitter.Split(cents, parts));
}
```

All four pass, and the code looks right. The examples chose their inputs the way
their author thinks about an invoice: positive. Nothing here is a mistake in the
tests. It is a blind spot of the person who wrote them, and a property has no
such blind spot, because the person does not choose the inputs.

### A property is a bool for every input

A property is a function from inputs to `bool`. FsCheck calls it 100 times by
default with generated values. In C# (the `FsCheck.Fluent` namespace) it is
written with `Prop.ForAll`, inside a normal test method:

```csharp
[TestMethod]
public void SharesAddUpToTheAmount()
{
    Prop.ForAll(Amounts, Parts, (cents, parts) =>
            MoneySplitter.Split(cents, parts).Sum() == cents)
        .QuickCheckThrowOnFailure();
}
```

`QuickCheckThrowOnFailure()` runs the property and throws when it is falsified.
MSTest reports the exception as the failure of the test, with FsCheck's message
as the text. There is no attribute and nothing to register. Run against the
`Split` above, the test fails within 1 to 12 generated cases:

```text
Falsifiable, after 6 tests (5 shrinks) (10200620173344671379,2271238073153152867).
Last step was invoked with size of 7 and seed of (6505255636827669415,5266466383858147523).
Replay directly at failing step with (6505255636827669415,5266466383858147523,7).
Original:
-7L
4
Shrunk:
-1L
2
with exception:
System.Exception: Expected true, got false.
```

`Original` is the first input that broke the property. `Shrunk` is the smallest
one FsCheck found that still breaks it: `Split(-1, 2)`. C# truncates division
toward zero and `%` takes the sign of the dividend, so for a negative amount the
remainder is negative, the loop `i < remainder` never runs, and `Split(-1, 2)`
returns `[0, 0]`: the refund lost a cent. Different runs of the same test gave
`(-7, 4)`, `(-5, 8)`, `(-1, 3)` and `(-1, 2)` as the original input, and `(-1, 2)`
as the shrunk input every time. The shrunk value is stable even when the random one is not,
and that is why a property failure is easy to act on.

The fix uses the floored remainder, and the extra cents still go to the first
shares:

```csharp
var remainder = ((cents % parts) + parts) % parts;
var share = (cents - remainder) / parts;
```

The same test then passes, and so do the properties below (the lab's solution
has 13 tests, 5 examples and 8 from the property class, and runs in about 80 ms).

### Where properties come from

Writing "the result equals what the code computes" is not a property: it repeats
the implementation. The useful ones are a few recurring shapes:

| Shape | In the lab | Elsewhere |
| --- | --- | --- |
| Invariant of the result | the shares add up to the amount; there are `parts` of them; none is more than one cent from another; the larger come first | a sorted list has the same elements as the input |
| Round trip | none | decode(encode(x)) equals x; parse(format(x)) equals x |
| Oracle | none | a fast algorithm gives the same answer as an obvious slow one |
| Idempotence | none | normalising twice is the same as normalising once |
| Failure contract | fewer than 1 part always throws `ArgumentOutOfRangeException` | invalid input is always rejected, never half-handled |

The lab writes five of them. Only the first one finds the bug. The other four
pass before and after, and they are not there to find it: they say what `Split`
promises, so a later change to it cannot break that promise silently, and each
one covers inputs nobody listed.

### Generators and Arbitrary

An `Arbitrary<T>` is a generator (`Gen<T>`) plus a shrinker. FsCheck has default
ones for `int`, `long`, `string`, arrays, lists, records and more, found with
`ArbMap.Default.ArbFor<T>()`, and the type-inferring overload
`Prop.ForAll<long, int>((cents, parts) => ...)` uses them. Defaults are rarely
the domain you want: `int` includes 0 and negatives, and `Split` rejects those.
There are two ways to narrow:

```csharp
// 1. filter the default: it keeps the default shrinker
private static readonly Arbitrary<int> Parts =
    ArbMap.Default.ArbFor<int>().Filter(parts => parts is >= 1 and <= 20);

// 2. build a generator, and give it a shrinker
private static readonly Arbitrary<int> Parts =
    Arb.From(Gen.Choose(1, 20), parts => Enumerable.Range(1, parts - 1));
```

The shrinker matters. `Gen.Choose(1, 20).ToArbitrary()`, with no shrinker, gives
a generator that cannot shrink, and the same failing property reported this
instead of `-1L, 2`:

```text
Falsifiable, after 1 test (0 shrinks) ...
Original:
-40509L
4
```

That was with both the amounts and the parts built from `Gen.Choose`. The
failure is true, and nearly useless: you now debug 40509 cents over 4 parts.
Filtering a default arbitrary or passing a shrinker to `Arb.From` keeps the
shrinking. Use `Gen.Choose`, `Gen.Elements`, `Select` and `SelectMany` to build
domain values (an order with 1 to 5 lines, a date range whose end is after its
start), and when the value is a composite type, shrink toward the empty or the
smallest one.

A filter throws generated values away until one passes. When most default
values would be rejected, prefer a generator that produces only valid values.

### Does the generator reach the case?

A property that passes over inputs that never reach the risky branch proves
little. `Classify` labels the runs, so you can look at the distribution:

```csharp
Prop.ForAll(Amounts, Parts, (cents, parts) =>
        (MoneySplitter.Split(cents, parts).Length == parts)
        .Classify(cents < 0, "refund")
        .Classify(cents % parts == 0, "divides evenly"))
    .Check(Config.Quick.WithMaxTest(100));
```

```text
Ok, passed 100 tests.
39% refund.
9% divides evenly, refund.
9% divides evenly.
```

Two runs printed 39% and 38% for refunds. The default `long` generator gives
negatives about as often as positives, which is why the bug showed up in a few
runs. A generator that only produced amounts from 0 to 10 000 would have
passed, forever.

### Seeds: reproducing a failure

Each run uses a new random seed, so a property that failed on CI may pass on
your machine. The failure message carries the way back: `Replay directly at
failing step with (seed1, seed2, size)`. Give the three values to the config:

```csharp
var config = Config.QuickThrowOnFailure.WithReplay(6505255636827669415UL, 5266466383858147523UL, 7);
prop.Check(config);
```

With the same generators the property sees the same values (in the lab, the
test that records the generated pairs twice with one seed gets two equal lists).
When I replayed the values of a failure on the starting code, the run reproduced
that failure's `Original` and `Shrunk`. A replay
depends on the generators and on the FsCheck version: change either and the same
seed gives other values. So treat the seed as a way to debug now, and turn the
shrunk counterexample into an ordinary example in the suite:

```csharp
[TestMethod]
[DataRow(-1L, 2, new long[] { 0, -1 })]
[DataRow(-7L, 3, new long[] { -2, -2, -3 })]
public void ARefundIsSplitToo(long cents, int parts, long[] expected)
{
    CollectionAssert.AreEqual(expected, MoneySplitter.Split(cents, parts));
}
```

That example fails with a one-line message, runs in no time and needs no
generator. The property keeps searching for the next one.

### FsCheck with MSTest 4

FsCheck's own integration packages are for xUnit (`FsCheck.Xunit`,
`FsCheck.Xunit.v3`) and NUnit (`FsCheck.NUnit`), both 3.6.0. There is no
`FsCheck.MSTest` from the FsCheck project. There is a community package,
`AndreasDorfer.FsCheck.MSTest` 3.0.0 (MIT, published in 2026-01), that gives a
`[Property]` attribute. It depends on `MSTest.TestFramework` 4.0.2 and FsCheck
3.3.2. I referenced it next to `MSTest` 4.5.3 and `FsCheck` 3.6.0 and wrote two
`[Property]` methods with arguments and a `bool` result. Discovery failed:

```text
UTA007: Method Reverse defined in class M.T does not have correct signature.
Test method marked with the [TestMethod] attribute must be non-static, public,
return-type as void and should not take any parameter.
```

The MSTest adapter treats `[Property]` as a test method and rejects its
signature, and the property method takes parameters. I did not look for a
configuration that changes it, so check the package's changelog before you try
it on a newer MSTest. What works, and is what the lab does, is to use the API
directly in a `[TestMethod]` with no parameters:
`Prop.ForAll(...).QuickCheckThrowOnFailure()`. It needs only the `FsCheck`
package, and its failure is a normal MSTest failure. I ran it with `dotnet test`
in VSTest mode; the test is an ordinary method, but I did not run it on
Microsoft.Testing.Platform. The cost is that each property is one test, not one per generated case,
and the number of runs is configured per call: `Config.QuickThrowOnFailure.WithMaxTest(1000)`,
then `Check.One(config, prop)`.

There is also no `Prop.Throws` in the C# API. A test that an invalid input
throws catches the exception inside the property and returns `true` for the
expected one and `false` for none.

### Properties and the other tools

Data-driven tests and properties are not rivals. Rows document the rules and the
edges you know (`ARefundIsSplitToo` above); a property searches for the ones you
do not. Mutation testing tells you the suite is weak, and a property is often the
cheapest way to strengthen it, because one property kills many mutants. A
generator for domain values and a Bogus or AutoFixture builder do different jobs:
Bogus makes realistic data from a seed, FsCheck makes hostile data and shrinks it.

## Trade-offs

- **A property is only as good as its generator.** A generator that never
  produces refunds, empty lists or the maximum value passes forever. Check the
  distribution with `Classify`, and add the rare case to the generator on
  purpose.
- **Random tests need a way back.** Without the replay values from the failure
  message, a CI failure is gone with the next run. Save the message, and promote
  the shrunk input to an example.
- **They cost more per test.** 100 runs by default, so a property over a slow
  call (a database, a file, a network) multiplies that cost. Use properties on
  pure code, or lower `WithMaxTest` and say why.
- **Finding the property is the hard part.** If the best property you can write
  is "the result equals what the code computes", skip it. A price table, a
  mapping from a status to a message, or a rule that is just a list of cases is
  better served by rows.
- **The tests are not named by case.** A property is one test in the report, so
  the number of passing tests no longer tells how many inputs were tried.
- **The MSTest 4 integration is DIY.** No package from the FsCheck project, and
  the community one did not discover in my run. Fine for the direct API, but
  you give up an attribute and per-property configuration by annotation.

## Lab

`MoneySplitter.Split` is already implemented, with four example tests that pass. Your job is to describe it with properties, make FsCheck find the bug they all missed, read the shrunk counterexample and the seed, fix `Split`, and keep the counterexample as an example.

**What you will practice**

- Writing properties with `Prop.ForAll` inside `[TestMethod]`s: sum, count, spread and order of the shares.
- Choosing and narrowing generators, and giving `Arb.From` a shrinker, and seeing what it costs to leave it out.
- Reading `Original`, `Shrunk` and the replay values in a failure message.
- Checking that a seed generates the same inputs, and turning a counterexample into a `[DataRow]` example.

**Prerequisites:** MSTest Data-Driven Tests: DataRow, DynamicData and Custom Sources, MSTest 4 Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**How it works:** the production code has a bug only a property finds, and it is the one place in `src/` you may edit, after TODO-00 fails. Seven test methods fail with `TODO-NN` until you write them, five examples pass from the start, and the solution passes 13 of 13.

## Documentation Links

- [FsCheck documentation](https://fscheck.github.io/FsCheck/) (doc)
- [FsCheck on GitHub](https://github.com/fscheck/FsCheck) (doc)
- [FsCheck 3.6.0 on NuGet](https://www.nuget.org/packages/FsCheck/3.6.0) (doc)
- [AndreasDorfer.FsCheck.MSTest on NuGet](https://www.nuget.org/packages/AndreasDorfer.FsCheck.MSTest) (doc)
- [Data-driven testing with MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
