---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Line coverage says which code the tests run. It does not say which code they
check. A mutation tool makes that difference visible: it changes the production
code one small step at a time (`<=` becomes `<`, `*` becomes `/`, a message
becomes an empty string), runs the tests against each change, and counts the
changes the suite did not notice. A mutant that survives is a weak test with a
line number. Stryker.NET is the tool for .NET. The goal: run it on an MSTest project
that uses Microsoft.Testing.Platform, read the score and the surviving mutants,
write the tests that kill them, and know when a survivor is not a missing test.
Versions measured: `dotnet-stryker` 5.1.0 (a local tool), `MSTest.Sdk` 4.5.3, on the .NET 10.0.100 SDK
and the .NET 11.0.100 SDK. No Docker was used.

## Use Cases

- Showing that a suite with full coverage is weak, with numbers.
- Finding the boundary and the exact value that no test asserts.
- Gating a pull request on the mutation score of the files it changed.
- Reviewing a test suite you did not write.

## Deep Dive

### A suite that covers everything and checks little

The lab has a `ShippingCalculator`: weight tiers (up to 1, 5 and 10 kg, then
0.80 per started kilogram), a zone multiplier, an express multiplier,
free shipping for domestic orders from 100, and a label. The starting suite
has six tests that pass, and they read well:

```csharp
[TestMethod]
public void AHeavyParcelCostsMoreThanALightOne()
{
    var light = _calculator.Quote(new Parcel(1m, Zone.Domestic, false, 20m));
    var heavy = _calculator.Quote(new Parcel(20m, Zone.Domestic, false, 20m));

    Assert.IsGreaterThan(light, heavy);
}
```

"Costs more than" is true for a hundred wrong tariffs. A negative weight is
rejected, but 0 and 30.01 are not tried. The label test checks that it is not
empty. Every line of the calculator runs, so a coverage report is happy.

### Running Stryker as a local tool

Stryker is a .NET tool. Put it in the repository's tool manifest, so everyone
who clones gets the same version, and never install it globally:

```bash
dotnet new tool-manifest
dotnet tool install --local dotnet-stryker --version 5.1.0
dotnet tool restore          # on a fresh clone or a CI agent
cd tests/Shipping.Tests
dotnet stryker
```

`dotnet stryker` reads `stryker-config.json` from the current directory. The
test project is the starting point, and `project` names the project to mutate:

```json
{
  "stryker-config": {
    "project": "Shipping.csproj",
    "test-runner": "mtp",
    "reporters": ["html", "json", "cleartext"],
    "thresholds": { "high": 95, "low": 90, "break": 0 }
  }
}
```

### The runner has to be `mtp`

Stryker's default runner is `vstest`. The lab's test project uses `MSTest.Sdk`
with `global.json` selecting Microsoft.Testing.Platform (see the MTP concept),
and `dotnet stryker --test-runner vstest` on it fails:

```text
[ERR] TestDiscoverer: Test discovery failed for ...Shipping.Tests.dll:
  ... Could not find testhost for test source '...Shipping.Tests.dll'.
Test discovery was aborted.
```

The exit code is 1. With `-t mtp` (or `"test-runner": "mtp"` in the config) it
runs, and prints a warning: `The Microsoft Test Platform testrunner is currently
in preview. Results should be verified since this feature is still being tested.`
So treat the MTP runner as preview, and compare a first run with what you expect.

### Reading the result

On the starting suite:

```text
40 mutants created
1 mutants got status CompileError.   Reason: Mutant caused compile errors
2 mutants got status NoCoverage.     Reason: Not covered by any test.
3 mutants got status Ignored.        Reason: Removed by block already covered filter
34 total mutants will be tested
The final mutation score is 38.89 %
```

The json report breaks it down: 14 killed, 20 survived, 2 `NoCoverage`. The score
is the killed mutants over the killed, survived and uncovered ones: 14 of 36,
which is 38.89%. `CompileError` and `Ignored` mutants are not counted. The run
took 5 to 6 seconds. It is cheap here because Stryker records which tests
reach each mutant and runs only those, and because the project is tiny.

The `html` report shows the source with each mutant in place. The survivors,
with what to do about each:

| Surviving mutant | Why the suite let it live |
| --- | --- |
| `WeightKg <= 0` to `< 0` | the only rejected weight is -1 |
| `WeightKg > MaxWeightKg` to `>=` | nothing tries exactly 30 kg |
| the exception message to `""` | no test reads the message |
| `OrderValue >= 100` to `> 100` | the free order is 150, not 100 |
| `if (parcel.Express)` negated | no express parcel anywhere |
| `weightKg <= 5` to `< 5` or `> 5` | "heavy costs more than light" |
| `Math.Ceiling(weightKg - 10) * 0.80m` to `/` or `weightKg + 10` | only 20 kg, only "more than" |
| the `"EXP"`/`"STD"` conditional | "the label is not empty" |

Each row is a test to write: the exact price for every tier edge and one step
past it, 0 and 30.01 kg with the `ParamName` and the message, free shipping at
100 and 99.99, express in each zone, the whole label text. A data-driven test
with 16 rows takes care of most of the table:

```csharp
(1m, Zone.Domestic, false, 4.90m),
(1.01m, Zone.Domestic, false, 7.90m),
(10m, Zone.Domestic, false, 12.90m),
(10.01m, Zone.Domestic, false, 13.70m),
(1m, Zone.Europe, true, 11.03m), // 4.90 x 1.5 x 1.5 = 11.025, rounded away from zero
```

With the new tests (25 including the data rows) the same run says 40 mutants, 35
killed, 1 survived, score 97.22%, 5 to 6 seconds. The 2 `NoCoverage` mutants,
which no test reached, are gone because the express and label tests reach them.

### The survivor that is not a missing test

`weightKg <= 10` to `weightKg < 10` still survives. At exactly 10 kg the third
tier gives 12.90, and the fallback `12.90m + Math.Ceiling(10 - 10) * 0.80m` gives 12.90 too.
No input tells the two versions apart: it is an equivalent mutant. Do not write
a test for it. Options:

- Leave it and accept 97.22% (the lab's `high` threshold is 95).
- Rewrite the code so the redundant branch is gone, for example one formula with
  `Math.Max(0, Math.Ceiling(weightKg - 10))` (I did not run that variant).
- Silence it with `// Stryker disable once Equality : reason`. Careful: "once"
  covers the next statement, and `BasePrice` is one expression-bodied member.
  Putting the comment above it raised `Ignored` from 3 to 9 and the score to
  100%, because it also switched off 5 equality mutants that tests do kill. A
  100% that hides real mutants is worse than 97%.

### Making the score a gate

```bash
dotnet stryker --break-at 90
```

On the starting suite this exits with 2; on the new one, 0. Stryker validates the
thresholds against each other: with `low` at 80, `--break-at 90` stops with
`Threshold low must be more than or equal to threshold break`, so set `low` and
`break` together. `dotnet stryker --help` also lists `--since[:committish]` ("Only test changed
files", a diff against a Git commit or branch) and a dashboard baseline; neither
was run for this concept. They are what makes a mutation run affordable on a
pull request, because a full run costs one test run per mutant.

### What a surviving mutant tells you

Three kinds of survivor, three responses:

1. **A weak assertion** (`IsGreaterThan` where an exact value is known): tighten it.
2. **A missing input** (no express parcel, no 30 kg): add the case.
3. **An equivalent or irrelevant mutant** (the 10 kg tier, a log message): ignore it,
   with a reason next to the code or in the config (`--mutate` can exclude files
   and `ignore-mutations` can exclude a mutator).

The first two are the lesson. The third is why the target is not 100%.

## Trade-offs

- **It is slow where the code is big.** The lab takes seconds because there are
  36 mutants. A real project has thousands, and each one is a test run. Run it
  on the changed files in a pull request, or nightly on the whole project.
- **A coverage gate and a mutation score answer different questions.** The
  starting suite had every line covered and a score of 38.89%. Keep the cheap
  coverage gate and add the mutation score for the code that matters.
- **Not every survivor is a bug in the tests.** The 10 kg mutant is equivalent.
  A team that chases 100% writes tests for nothing, or silences too much (the
  `disable once` above hid 5 real mutants).
- **The MTP runner is preview.** It worked for the lab, and Stryker says so on
  every run. Pin the version in the tool manifest and check a first run by hand.
- **Strings and logs make noise.** An exception message mutant survives until a
  test reads the message. That is worth it for a message that is an API; for a
  log line, exclude it.

## Lab

The shipping calculator is already implemented, and the starting suite passes and covers every line. Your job is to run Stryker, read the surviving mutants, and write the tests that kill them, then decide what to do with the one that cannot be killed.

**What you will practice**

- Installing Stryker as a local tool from the manifest and running it with the `mtp` runner.
- Reading the score, the surviving mutants and the `NoCoverage` ones.
- Writing a data-driven test with exact values for every tier edge, and tests for the limits, the free-shipping edge and the label.
- Telling an equivalent mutant from a missing test, and checking what `// Stryker disable once` really switches off.

**Prerequisites:** Microsoft.Testing.Platform, dotnet test and Code Coverage in CI, MSTest Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**How it works:** the starter is green on purpose, because Stryker needs a passing suite: four `[Ignore]`d shells mark where your tests go. The score is 38.89% before and 97.22% in the solution, which documents the table of survivors and the equivalent mutant.

## Documentation Links

- [Stryker.NET introduction](https://stryker-mutator.io/docs/stryker-net/introduction/) (doc)
- [Stryker.NET configuration](https://stryker-mutator.io/docs/stryker-net/configuration/) (doc)
- [Stryker.NET mutations](https://stryker-mutator.io/docs/stryker-net/mutations/) (doc)
- [dotnet-stryker on NuGet](https://www.nuget.org/packages/dotnet-stryker) (doc)
- [Microsoft.Testing.Platform overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-intro) (doc)
