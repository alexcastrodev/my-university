---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

For years `dotnet test` meant VSTest: a host process called `testhost` loaded your
test assembly, and every option (`--logger`, `--collect`, a positional project
path) was a VSTest option. Microsoft.Testing.Platform (MTP) replaces that model.
The test project becomes an executable that runs its own tests, and the .NET 10
SDK adds a `dotnet test` mode built for it. The goal is to move an MSTest suite
to MTP on purpose, know which commands and exit codes change, collect coverage
in CI with a gate that fails the build, and keep in mind that a green coverage
gate says which code ran, not which code was checked.

## Use Cases

- Moving a solution from `dotnet test` on VSTest to the MTP mode of the .NET 10
  SDK, and fixing the CI scripts that break on the way.
- Running a test project directly (`dotnet run`, or the built executable) to
  debug a filter or a crash without the `dotnet test` orchestration.
- Making CI fail when a filter typo or a broken discovery runs zero tests,
  instead of reporting a silent success.
- Collecting coverage with Microsoft Code Coverage or coverlet, turning it into
  an HTML report and a job summary with ReportGenerator, and gating on a minimum.
- Explaining to a team why 100% branch coverage did not catch a boundary bug.

## Deep Dive

### Who runs the tests

| | VSTest | Microsoft.Testing.Platform |
| --- | --- | --- |
| Process that runs the tests | `testhost`, started by `vstest.console` | the test project itself (an executable) |
| How MSTest plugs in | adapter plus `Microsoft.NET.Test.Sdk` | the MSTest runner (MSTest 3.2+) |
| Options | fixed VSTest options (`--logger`, `--collect`, `--settings`) | the platform's options plus the ones each registered extension adds |
| Filter typo that matches nothing | warning, exit code 0 | exit code 8 |

You can see the difference from inside a test. Under VSTest the entry assembly is
the host; under MTP it is the test project. The lab uses this as a guard that the
runner switch really happened:

```csharp
[TestMethod]
public void TheSuiteRunsOnMicrosoftTestingPlatform() =>
    Assert.AreEqual(
        "Checkout.Tests",
        Assembly.GetEntryAssembly()?.GetName().Name,
        "TODO-00: the tests still run inside VSTest's testhost. Select the MTP runner (see the README).");
```

On VSTest the assertion reports `Actual:<testhost>`.

### Opting in: MSTest.Sdk and global.json

Two switches are involved, and they are independent. The project decides whether
it is an MTP application. `global.json` decides which mode `dotnet test` uses.

The project side is easiest with `MSTest.Sdk`, an MSBuild SDK that replaces
`Microsoft.NET.Sdk` and turns MTP on by default:

```xml
<Project Sdk="MSTest.Sdk/4.5.1">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Checkout\Checkout.csproj" />
  </ItemGroup>

</Project>
```

There is no `PackageReference` to MSTest and no `Using` item: the SDK brings the
framework, the adapter, the analyzers and the global using. Its `Default`
extension profile also adds the Code Coverage and TRX report extensions, which is
why `--coverage` and `--report-trx` work in the commands below.
`<TestingExtensionsProfile>None</TestingExtensionsProfile>` removes them, and
`<UseVSTest>true</UseVSTest>` sends the project back to VSTest. If a project
needs another top-level SDK (for example `Microsoft.NET.Sdk.Web`), keep it and
the `MSTest` package, and add `<EnableMSTestRunner>true</EnableMSTestRunner>` and
`<OutputType>Exe</OutputType>`; since MSTest 3.8 the metapackage already
references the coverage and TRX extensions.

The `dotnet test` side is one file next to the solution:

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

`dotnet new mstest --sdk --test-runner Microsoft.Testing.Platform` generates both.
The mode is all or nothing. With the `global.json` and one project still on
VSTest, `dotnet test` refuses to start:

```text
global.json defines test runner to be Microsoft.Testing.Platform. All projects must use that test runner.
The following test projects are using VSTest test runner:
Checkout.Tests.csproj
```

Before .NET 10, MTP projects ran under the VSTest mode through
`<TestingPlatformDotnetTestSupport>true</TestingPlatformDotnetTestSupport>`, with
MTP options after an extra `--`. The docs mark that path as legacy; in the MTP
mode neither the property nor the `--` is required.

### What changes on the command line

| VSTest habit | MTP mode (.NET 10 SDK) |
| --- | --- |
| `dotnet test path/To.Tests.csproj` | `dotnet test --project path/To.Tests.csproj` |
| `dotnet test My.sln` | `dotnet test --solution My.sln` |
| `dotnet test path/To.Tests.dll` | `dotnet test --test-modules "**/bin/**/To.Tests.dll"` |
| `--logger trx` | `--report-trx` (TRX extension) |
| `--collect "XPlat Code Coverage"` | `--coverage` (Microsoft) or `--coverlet` (coverlet.MTP) |
| `--filter "TestCategory=Shipping"` | unchanged for MSTest |

The positional project path fails fast with `Specifying a project for 'dotnet
test' should be via '--project'.` A VSTest option fails differently: `dotnet test
--logger trx` builds, the module exits with code 5 (invalid command line), and the
run reports `Zero tests ran` with exit code 1. Options that `dotnet test` itself
does not know are forwarded to each test application. Put them after a literal
`--` when you want that to be explicit:

```bash
dotnet test --results-directory TestResults -- --report-trx --maximum-failed-tests 1
```

`--maximum-failed-tests` stops the run after that many failures and exits with
code 13. `--minimum-expected-tests` before `--` applies to the whole run (since
SDK 10.0.100); after `--` it applies to each test module.

### The test project is an executable

Because the project is the runner, you do not need `dotnet test` to run it. Every
option above works the same way:

```bash
dotnet run --project tests/Checkout.Tests -- --filter "TestCategory=Discounts"
./tests/Checkout.Tests/bin/Debug/net10.0/Checkout.Tests --list-tests
```

`--help` lists the options of the extensions this project registered, which is
the quickest way to see why an option is rejected.

### Filters, categories and exit codes

MSTest keeps its filter syntax under MTP. A category on the class tags every test
in it:

```csharp
[TestClass]
[TestCategory("Shipping")]
public sealed class ShippingTests
```

```bash
dotnet test --filter "TestCategory=Shipping"                          # 4 tests
dotnet test --filter "FullyQualifiedName~Discount"                    # 10 tests
dotnet test --filter "TestCategory!=Shipping&TestCategory!=Theater"   # 15 tests
```

The exit code is what CI reads, and MTP is strict about it:

| Exit code | Meaning |
| --- | --- |
| 0 | every selected test ran and passed |
| 2 | at least one test failed |
| 5 | invalid command-line arguments (often an option from an extension the project does not have) |
| 8 | zero tests ran |
| 9 | fewer tests ran than `--minimum-expected-tests` |
| 13 | stopped by `--maximum-failed-tests` |

The same typo behaves differently on the two platforms:

```bash
dotnet test --filter "TestCategory=Shiping"; echo $?
# VSTest: "No test matches the given testcase filter", exit code 0
# MTP:    total: 0, exit code 8
```

A green job that ran nothing is worse than a red one. `--minimum-expected-tests`
goes further and also catches a suite that lost tests. In the lab, asking for 21
tests when 20 exist exits with code 9. If a run with zero tests is legitimate
(an empty slice in a matrix), say so with `--ignore-exit-code 8`.

### Collecting coverage

| | Microsoft Code Coverage | coverlet |
| --- | --- | --- |
| VSTest | `--collect "Code Coverage"` | `coverlet.collector`, `--collect "XPlat Code Coverage"` |
| MTP | `Microsoft.Testing.Extensions.CodeCoverage`, `--coverage` | `coverlet.MTP`, `--coverlet` |
| Formats | `coverage` (default), `xml`, `cobertura` | `json`, `lcov`, `opencover`, `cobertura`, `teamcity` |

`coverlet.collector` is a VSTest data collector; on MTP its counterpart is the
`coverlet.MTP` package. With MSTest.Sdk the Microsoft extension is already there:

```bash
dotnet test --results-directory TestResults \
  --coverage --coverage-output-format cobertura --coverage-output coverage.cobertura.xml
```

The file lands in `TestResults/coverage.cobertura.xml`. Two defaults surprise
people. The test assembly is excluded (`IncludeTestAssembly` is `false` in the
MTP extension; it was `true` in VSTest), so a run on a test project with no
production reference reports an empty `<packages />`. And some lines can never
be covered: in the lab, the two `const decimal` lines show as uncovered because a
`const decimal` is compiled to a `static readonly` field with
`DecimalConstantAttribute`, set by a static constructor, while every use is
inlined. That constructor never runs, so the lab gates lines at 90% and branches
at 100%, instead of chasing a number no test can reach.

### From a Cobertura file to a gate

ReportGenerator turns the Cobertura file into HTML, a text summary or a GitHub
job summary, and its `minimumCoverageThresholds` settings make it exit with a
non-zero code below a limit. Install it as a local tool so CI and every developer
use the same version:

```bash
dotnet new tool-manifest
dotnet tool install dotnet-reportgenerator-globaltool --version 5.5.11
dotnet reportgenerator -reports:TestResults/coverage.cobertura.xml -targetdir:coverage-report \
  "-reporttypes:TextSummary;Html" \
  minimumCoverageThresholds:lineCoverage=90 minimumCoverageThresholds:branchCoverage=100
```

Gate on branches, not only lines. The lab's shipping rule has two conditions on
one line:

```csharp
var shipping = discounted >= FreeShippingThreshold || tier == Tier.Gold ? 0m : ShippingFee;
```

One test executes the line; branch coverage counts each way out of each condition.
With only the discount tests, the line is covered and two of 30 branches are not
(93.3%), and the gate fails.

### A GitHub Actions workflow

Every command in this job was run locally against the lab solution:

```yaml
name: tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore
      - run: dotnet build --no-restore -c Release
      - run: >
          dotnet test --no-build -c Release --results-directory TestResults
          --minimum-expected-tests 20 --report-trx
          --coverage --coverage-output-format cobertura --coverage-output coverage.cobertura.xml
      - run: dotnet tool restore
      - run: >
          dotnet reportgenerator -reports:TestResults/coverage.cobertura.xml -targetdir:coverage-report
          "-reporttypes:MarkdownSummaryGithub;Html"
          minimumCoverageThresholds:lineCoverage=90 minimumCoverageThresholds:branchCoverage=100
      - if: always()
        run: cat coverage-report/SummaryGithub.md >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: test-results
          path: |
            TestResults/*.trx
            coverage-report/
```

`--no-build` implies `--no-restore`, so `dotnet test` needs the `obj` folder from
the restore step in the same job; when only the built binaries reach the test
stage, run them with `--test-modules`. The `global.json` is in the repository, so
CI picks the MTP mode with no extra flag.

### Coverage is not a verdict

The solution of the lab reaches 93.9% of lines and 100% of branches in `coverage.sh`,
which builds in Debug. The Release build the workflow uses counts 27 coverable lines
instead of 33 and reports 92.5% of lines with the same 100% of branches, so both pass
the gate. This test, which asserts nothing, reaches the same numbers in `coverage.sh`:

```csharp
[TestMethod]
public void ExecutesEverythingAndChecksNothing()
{
    string?[] coupons = [null, "", "WELCOME10", "FLAT20", "NOPE"];
    decimal[] amounts = [10m, 49m, 60m, 120m];

    foreach (var tier in Enum.GetValues<Tier>())
    foreach (var coupon in coupons)
    foreach (var amount in amounts)
    {
        Try(() => PriceCalculator.Calculate([new("ITEM", 1, amount)], tier, coupon));
    }

    Try(() => PriceCalculator.Calculate([], Tier.Regular));
    Try(() => PriceCalculator.Calculate([new("ITEM", 0, 1m)], Tier.Regular));
}
```

`./coverage.sh --filter "TestCategory=Theater"` prints the same numbers and
`PASSED`, and a team asked for a percentage can write it. To learn what a suite
checks, break the code on purpose, one change at a time, and see what turns red:

| Change to the production code | Real suite | Theater test |
| --- | --- | --- |
| Free shipping `>=` becomes `>` | `AnOrderOfExactlyTheThresholdShipsFree` fails | green |
| `\|\| tier == Tier.Gold` deleted | `GoldShipsFreeEvenBelowTheThreshold` fails | green |
| `Math.Min` cap on the discount removed | `TheDiscountNeverExceedsTheSubtotal` fails | green |
| `.ToUpperInvariant()` removed from the coupon | `ACouponIgnoresCaseAndSurroundingSpaces` fails | green |
| `WELCOME10` limit `>= 50m` becomes `> 50m` | the 50 row of `Welcome10NeedsASubtotalOfAtLeast50` fails | green |
| Silver rate `0.05m` becomes `0.10m` | the Silver row and `TheTierDiscountAndTheCouponAddUp` fail | green |
| Quantity check `<= 0` becomes `< 0` | the 0 row of `ALineWithoutAPositiveQuantityIsRejected` fails | green |

The middle ground is the dangerous one. Without the `Shipping` class the real
suite still passes the gate (15 tests, 100% branches), because the discount tests
execute both shipping branches, and the first two mutations survive. Coverage
finds code that no test runs; only assertions, and mutations against them, show
code that no test checks. Stryker.NET (`dotnet-stryker`) automates the table
above, at the cost of one test run per mutant.

## Trade-offs

- **MTP mode is all or nothing per `global.json`.** A solution that mixes MTP and
  VSTest projects cannot use it, and MSTest and xUnit projects in one run reject
  each other's filter options (MSTest `--filter`, xUnit.net `--filter-trait`),
  which ends in exit code 5. Route framework-specific options with
  `TestingPlatformCommandLineArguments` in `Directory.Build.props`, or migrate
  every project before adding the file.
- **Strict exit codes break pipelines that relied on silence.** A matrix leg whose
  filter matches nothing now fails with 8. Make the intent explicit instead of
  ignoring every code:
  ```bash
  dotnet test --filter "TestCategory=Slow" -- --ignore-exit-code 8
  ```
- **MSTest.Sdk is pinned in two places.** The version lives in the `Sdk`
  attribute (or in `global.json` under `msbuild-sdks`), and the docs note that
  NuGet update tools, Dependabot included, do not bump MSBuild SDKs. Someone has
  to update it by hand.
- **Microsoft Code Coverage vs coverlet.** The Microsoft extension comes with
  MSTest.Sdk and the MSTest metapackage and can also cover native code (off by
  default), under a closed-source free license. coverlet is open source and writes lcov and
  opencover too. Both write Cobertura, which is all ReportGenerator needs.
- **A coverage gate is cheap; a mutation run is not.** The gate costs seconds and
  catches untested code. Mutation testing runs the suite once per mutant, so it
  fits a nightly job or a review of a critical module, not every push.
- **xUnit and NUnit get the same platform.** xUnit.net v3 and NUnit also run on
  MTP, so the `global.json`, the exit codes and the coverage extensions carry
  over; only the filter syntax differs. The Testing Modules in Isolation concept
  shows the xUnit side.

## Lab

The checkout pricing module is already implemented. Your job is to move its test project from VSTest to Microsoft.Testing.Platform, write the tests, tag them with categories, and get the coverage gate to pass.

**What you will practice**

- Selecting the MTP runner with `MSTest.Sdk` and `global.json`, and reading the error when only half is done.
- Filtering by `TestCategory` and reading the exit code of a filter that matches nothing.
- Collecting Cobertura coverage with `dotnet test --coverage` and gating it with ReportGenerator.
- Running the test project as an executable.
- Proving with mutations that a passing coverage gate is not a passing review.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, basic `dotnet test`, .NET 10 SDK.

**How it works:** every test method is declared with a hint and fails with `TODO-NN: write this test` until you write it, and two setup checks fail until the runner and the categories are configured. `./coverage.sh` fails until the coverage reaches the limit. The optional TODOs ask you to break the production code and to write a test with no assertions, and compare what the coverage report says with what the tests catch.

## Documentation Links

- [Testing with dotnet test (VSTest and MTP modes), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-with-dotnet-test) (doc)
- [dotnet test with Microsoft.Testing.Platform, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-mtp) (doc)
- [MSTest SDK configuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-sdk) (doc)
- [Run tests with MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-running-tests) (doc)
- [MTP CLI options reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-cli-options) (doc)
- [MTP troubleshooting and exit codes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-troubleshooting) (doc)
- [MTP code coverage, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-code-coverage) (doc)
- [Use code coverage for unit testing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-code-coverage) (doc)
- [ReportGenerator settings (minimum coverage thresholds)](https://github.com/danielpalme/ReportGenerator/wiki/Settings) (doc)
