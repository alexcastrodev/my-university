---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A CI job that fails "sometimes" has three different causes, and each one looks
different from the outside. A test that passes alone and fails in the full run
is flaky. A test that never returns is a hang, and the job dies at its time
limit with no name. A test that kills the process is a crash, and the summary
says `total: 0`. Microsoft.Testing.Platform (MTP) ships one extension for each,
and they only help when they are switched on before the failure. The goal:
turn on retry, hang dump, crash dump and the reports, read exactly what each
one prints and writes, and know what a retry hides. Versions: `MSTest.Sdk`
4.5.2 (extensions 2.5.2), run on the .NET 11.0.100 SDK (the `net10.0` project
on the .NET 11 runtime, with roll forward) and, for the retry, also on SDK
10.0.100. No Docker was used.

## Use Cases

- Keeping a build green while a flaky test is fixed, without losing the record that it failed.
- Finding which test hung a job that was killed after an hour.
- Getting the name of the test that crashed the process, and a dump to open.
- Publishing TRX, HTML or JUnit files that CI can show next to the build.

## Deep Dive

### Three suspects

The lab has a ticket counter shared by the whole process, an inbox fed from
another thread, and a route made of linked stops:

```csharp
public static int Next() => ++_last;                       // TicketCounter

public string Receive() => _messages.Take();               // Inbox, waits forever

public static int Length(Stop? start) =>                   // Route
    start is null ? 0 : 1 + Length(start.Next);
```

and four tests, switched on with `DISPATCH_SUSPECTS=1`. `TicketsAreSequential`
takes two tickets; `TheFirstTicketOfTheDayIsOne` asserts the next ticket is 1
and runs after it. `TheDepotAnswers` calls `Receive()` on an inbox nobody posts
to. `ARouteCanBeCounted` calls `Length` on two stops that point at each other.

### Turning the extensions on

The `MSTest.Sdk` `Default` profile loads code coverage and the TRX report, and
nothing else. Retry, hang dump, crash dump and the HTML report are separate
packages. Either name a profile, or switch each one on with a property
(`MSTest.Sdk` adds the package):

```xml
<Project Sdk="MSTest.Sdk/4.5.2">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <EnableMicrosoftTestingExtensionsRetry>true</EnableMicrosoftTestingExtensionsRetry>
    <EnableMicrosoftTestingExtensionsHangDump>true</EnableMicrosoftTestingExtensionsHangDump>
    <EnableMicrosoftTestingExtensionsCrashDump>true</EnableMicrosoftTestingExtensionsCrashDump>
    <EnableMicrosoftTestingExtensionsHtmlReport>true</EnableMicrosoftTestingExtensionsHtmlReport>
  </PropertyGroup>
</Project>
```

`<TestingExtensionsProfile>AllMicrosoft</TestingExtensionsProfile>` also works
and loads more (Azure DevOps and GitHub Actions reports, hot reload). A test
can check the setup: the four extension assemblies appear in
`AppDomain.CurrentDomain.GetAssemblies()` when they are loaded, which is what
the lab's `RunnerTests` do.

### Retry: what passes, and what it hides

`TheFirstTicketOfTheDayIsOne` ran after `TicketsAreSequential` and saw ticket
3. Alone it passes. With `--retry-failed-tests 3`:

```text
(try 1) Running tests from ...Dispatch.Tests.dll (net11.0|arm64)
failed (try 1) TheFirstTicketOfTheDayIsOne (9ms)
  expected: 1
  actual:   3
(try 2) Running tests from ...Dispatch.Tests.dll (net11.0|arm64)

Test run summary: Passed!
  total: 2
  succeeded: 2
  flaky: 1 (passed after retry)
  retried: 1 test(s), 1 extra run(s)

Flaky tests:
  TheFirstTicketOfTheDayIsOne failed -> passed (2 attempts)
```

The exit code is 0. The extension restarts the test application with a filter
for the failed tests only, so the second attempt is a new process and the
counter starts at 0. That is why it passed, and it is the diagnosis: the test
depends on what other tests did in the same process. The `flaky` line and the
`Flaky tests` list are the signal to act on (`--show-flaky-tests off` hides
them). SDK 10.0.100 prints `total: 2 (+1 retried)` and no `flaky` line.

A test that is always red is rerun and still fails. `--retry-failed-tests 2`
gave three tries in all (`(try 1)` to `(try 3)`) and exit code 2. A retry
budget stops a mass failure from being retried: with
`--retry-failed-tests-max-tests 1` and two failed tests, the output was
`Failure threshold policy is enabled, failed tests will not be restarted.`
and `Maximum failed tests threshold is 1 and 2 tests failed`, and the exit
code was 2. `--retry-failed-tests-max-percentage` does the same by share, and
`--retry-failed-tests-delay` waits between attempts (both listed in `--help`).

### MSTest's `[Retry]` is not this

`[Retry(3)]` on a test retries inside the same process. On the same flaky test
the four attempts saw tickets 3, 4, 5 and 6, all failed, and the run exited
with 2: the shared counter kept growing, so a retry in the same process could
not fix it. On a different test the attribute passed on the third attempt
with exit code 0 while the summary still counted `failed: 2` (each attempt is
a result). The extension reruns in a fresh process and tells you which tests
were flaky; the attribute reruns in place and counts attempts as results.
Neither makes a test deterministic.

### Hang: the dump names the test

```bash
dotnet test --filter "Name=TheDepotAnswers" --hangdump --hangdump-timeout 5s --hangdump-type Mini
```

```text
Hang dump timeout of '00:00:05' expired
The following tests were still running when dump was taken (format: [<time-elapsed-since-start>] <name>):
[00:00:05] TheDepotAnswers
Creating dump file 'TestResults/Dispatch.Tests_73742_hang.dmp'
Test application process didn't exit gracefully, exit code is '137'
Exit code: 7
```

Exit code 7 means the test host exited unexpectedly. `TestResults/` holds the
`.dmp` (about 40 MB as a `Mini` dump; the documented default is `Full`) and a
`_hang.log` with the names of the running tests. Choose `--hangdump-timeout`
above your slowest legitimate test and below the CI job limit, and publish the
folder as an artifact. The dump is for a debugger or `dotnet-dump`, covered in
the Diagnosing Production concept. A cheaper guard is `[Timeout(2000)]` on the
test: a blocked test (a 20 second sleep) failed in 2 seconds with `Test
'TimeoutAttribute' timed out after 2000ms`, a normal red test (exit code 2), and
the process exited. The dump is for when no test has a timeout, or the hang is
in a fixture.

### Crash: the sequence log names the last test

A stack overflow cannot be caught. Without an extension the run printed
`Stack overflow.`, a trace that repeats `Dispatch.Route.Length` 32374 times,
and exited with 134. The summary had `error: 1` and `total: 0`, with no test
name. With `--crashdump --crashdump-type Mini`:

```text
Test host process with PID '74328' crashed, a dump file was generated
The following tests were still running when the test host crashed (...):
[00:00:00] ARouteCanBeCounted
Exit code: 7
    - TestResults/Dispatch.Tests_74328_crash.dmp
    - TestResults/Dispatch.Tests_2e509bb2_crash.sequence.log
```

The sequence log has a `STARTED` and an `ENDED` line, with the result, for each
test. In a run of 13 tests the last line was
`STARTED ... ARouteCanBeCounted` with no `ENDED`, after eleven passed tests and
one failed. The culprit is the last `STARTED` without an `ENDED`, even when the
console is only a page of stack trace.

### Reports: the retry changes what a TRX contains

`--report-trx` and `--report-html` write one file per test application. In a
retried run there are three places: the top-level `TestResults/` file, one pair
per attempt under `TestResults/Retries/<id>/1` and `/2`, and a merged pair
under `Retries/<id>/1/merged/`. The top-level TRX held one result for
`TheFirstTicketOfTheDayIsOne` (Passed): the failure is gone. The merged TRX
held three results, `total="3" passed="2" failed="1"`: the failed attempt too.
If the report feeds a flakiness dashboard, read the merged file.

JUnit has no stable package yet. `Microsoft.Testing.Extensions.JUnitReport`
`1.0.0-alpha.26561.10` (preview) added `--report-junit`, and the run wrote a
`testsuites` file with `tests`, `failures` and one `testcase` per test, plus
the exit code as a property. A CTRF package exists in the same alpha line (not run here).

### Two options called `--timeout`

```bash
dotnet test --timeout 3s              # before the separator: the run
dotnet test -- --timeout 3s           # after it: each test application
```

On a test that sleeps 20 seconds, the first form did not stop it: the run took
20 seconds, the test passed, and the summary said `Aborted` with exit code 3.
With two test projects and `--max-parallel-test-modules 1`, the module that
had not started yet never ran (`total: 1`). So the run-level timeout acts
between modules, and does not interrupt a test host that is already running.
After `--` the platform killed the test host at 3 seconds, exit code 3 and
`total: 0`. For a stuck test, use the per-application form, a `[Timeout]`, or a
hang dump.

### Which tool for which symptom

| Symptom | Tool | What you get | Exit code |
| --- | --- | --- | --- |
| Fails in the full run, passes alone | `--retry-failed-tests` | `flaky` line, list, merged TRX | 0 if it passes |
| Job killed with no name | `--hangdump --hangdump-timeout` | running test names, `.dmp`, `.log` | 7 |
| `total: 0` and a stack trace | `--crashdump` | crashing test, `.dmp`, `crash.sequence.log` | 7 (134 without it) |
| Need a file for CI | `--report-trx`, `--report-html` | per application and per attempt | unchanged |

## Trade-offs

- **A retry is a bandage with a receipt.** It keeps the job green, and the
  `flaky` list is the receipt. If nobody reads it, the defect stays. Retry
  only the tests that fail, set a maximum, and fix what the list names.
- **The hang timeout is a guess.** Too short and it kills a slow but healthy
  run; too long and CI times out first. Measure the slowest test and add margin.
- **Dumps are big.** A `Mini` dump was about 40 MB for an empty test project; the
  default `Full` dump is larger. Keep them as short-lived artifacts.
- **A preview report is a risk.** JUnit and CTRF ship as `1.0.0-alpha` packages,
  so a format or option can change. TRX and HTML are stable (2.5.2).
- **Seeing the cause needs a rerun.** Crash and hang dumps only exist if the
  option was on when it failed, so turn them on in CI by default.

## Lab

The dispatch desk is already implemented, with the four suspect tests. Your job is to switch on the extensions, diagnose each suspect from what MTP prints, and write the fixed tests.

**What you will practice**

- Turning on retry, hang dump, crash dump and HTML with `MSTest.Sdk` properties.
- Reading the `flaky` summary and explaining why the retry passed.
- Reading a hang's running-test list and a crash's `crash.sequence.log`.
- Comparing a top-level TRX with the merged TRX of a retried run.
- Comparing the retry extension with MSTest's `[Retry]`, `[Timeout]` and the two `--timeout` forms.

**Prerequisites:** Microsoft.Testing.Platform, dotnet test and Code Coverage in CI, MSTest Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**How it works:** the suspects run only with `DISPATCH_SUSPECTS=1`, so `dotnet test` stays green. In the starter, three setup checks fail until the extensions load, and six tests fail with `TODO-NN` until you write them. The optional TODOs measure `[Retry]`, `[Timeout]` and `--timeout`.

## Documentation Links

- [Microsoft.Testing.Platform features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-features) (doc)
- [Retry, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-retry) (doc)
- [Crash and hang dumps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-crash-hang-dumps) (doc)
- [Test reports, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-test-reports) (doc)
- [MTP troubleshooting and exit codes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-troubleshooting) (doc)
- [MSTest SDK configuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-sdk) (doc)
- [dotnet test with Microsoft.Testing.Platform, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-mtp) (doc)
