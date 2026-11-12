---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

.NET 11 reached general availability on November 10, 2026. It is a standard-term
support (STS) release, so it does not replace the .NET 10 LTS as the safe default,
and it still matters the day it ships: every project that targets `net11.0` gets C#
15, and every app that runs on the 11 runtime gets its behavior changes, even an app
that still says `net10.0`.

This concept is the hub for the release, not a tutorial. It covers the runtime, the
SDK and CLI and the base class library (BCL), and it points to the concepts that
cover C#, ASP.NET Core and EF Core, which have their own maps. What is on this page was
run on the 11.0.100 SDK (runtime 11.0.0, macOS arm64) and compared with the 10.0.100 SDK
where the difference was the point. Items taken only from Microsoft's pages are
marked "doc only", and what the pages still call preview is marked preview. The
upgrade side, what breaks and how to find it, is in
`upgrading-to-dotnet-11-and-reading-breaking-changes`.

## Use Cases

- Deciding whether to move a service from .NET 10 to .NET 11 now, or to wait.
- Finding the deep concept behind a headline of the release without reading the release notes.
- Reviewing a pull request that retargets to `net11.0` and knowing what else changed with it.
- Telling apart what is automatic (runtime and SDK behavior), what needs a switch, and what is still preview.

## Deep Dive

### Support and versions

.NET 11 is an STS release. The release index on the day of GA lists it as active until
November 14, 2028, which is the same end date as the .NET 10 LTS, so the practical
difference is that you chase patches on a newer baseline for the same period. .NET 8 and
.NET 9 left support on November 10, 2026. The calendar and the choice of target are in
`dotnet-support-lifecycle-and-choosing-a-target`. The pages used here do not say which
release is the next LTS, so this concept does not either.

### The runtime decides, not the target framework

The most useful fact for a migration is also the least visible. Behavior in the base
library comes from the runtime that executes the program, and the `TargetFramework`
only picks which runtime that is. The same source ran on three combinations: SDK 10
targeting `net10.0` on the 10 runtime, SDK 11 targeting `net11.0` on the 11 runtime, and
SDK 11 targeting `net10.0` but executed on the 11 runtime (with `DOTNET_ROLL_FORWARD=Major`,
because there was no 10 runtime to use):

```csharp
byte b = (byte)double.Parse("300.0");               // 10 runtime: 44    11 runtime: 255
decimal d = (decimal)(0.1 + double.Parse("0.2"));   // 0.3               0.3000000000000000444089209850
double r = Math.Round(double.Parse("2.675"), 2);    // 2.68              2.67
```

The `net10.0` app on the 11 runtime printed the 11 values. By default a `net10.0` app
does not roll forward to a newer major runtime, but a container image, a host with
`RollForward` set or a self-contained publish decides for you. The upgrade concept has the
full table and the other changes of this kind.

### Runtime

- **Runtime async.** In .NET 11 the runtime itself can suspend and resume `async`
  methods, so the compiler does not generate a state machine for them. The libraries of
  the platform are built that way, so every app on 11 already runs on it. Your own code
  opts in with `<Features>runtime-async=on</Features>`, and the documentation still
  classifies the feature as preview. Stack traces and profiles look different. The
  mechanics are in `task-and-async-await-internals`.
- **JIT and GC** (doc only). The runtime page lists more bounds check elimination, new
  devirtualization cases and specialized default comparers. None of it was measured
  here, so treat it as a reason to benchmark your own workload, not as a number.
- **Hardware floor** (doc only). The pages raise the minimum CPU instruction set, so a
  very old machine or emulator can refuse to start the runtime. Check this before moving
  a container fleet, not after.

### SDK and CLI

- **File-based apps** can span files. `#:include greeter.cs` pulled a second file into
  the build on SDK 11, and the same line fails with `Unrecognized directive 'include'` on
  SDK 10.0.100. `dotnet run -e FOO=bar app.cs` passed the variable to the program. Deep
  dive: `file-based-apps`.
- **Solutions.** `dotnet new sln` created `demo.slnx` on SDK 11 and `demo.sln` on
  10.0.100. Project files are covered in `sdk-style-projects-msbuild-and-directory-build-props`.
- **One-shot tools.** `dotnet tool exec` no longer asks for confirmation before running
  a downloaded tool, and the documentation says the same of `dnx`. In CI that means
  executing code with no gate, so pin the version. See `dotnet-cli-and-noun-first-commands`.
- **Native AOT publish.** The SDK has an optimized publish that skips the full build and
  its `AfterBuild` and `PostBuildEvent` hooks. On the GA SDK it is opt-in with
  `UseOptimizedPublish=true`; the default publish still runs those hooks. The RC builds
  behaved differently, so a note written before GA may say the opposite. Details are
  in the upgrade concept and in `native-aot-and-its-limits`.
- **Also listed by the pages** (doc only): the CLI itself built with Native AOT, an MSBuild
  server on by default, new container options and the NuGet changes (a minimum
  package age for restore, a restore that stops using the global packages folder to pick
  the next best version).

### Libraries

Each line below was run on 11.0.100:

```csharp
var r = Process.RunAndCaptureText("sh", ["-c", "echo out; echo err 1>&2; exit 3"]);
// exit=3 stdout=out stderr=err

a.FullJoin(b, l => l.Item1, r => r.Item1, (l, r) => $"{l.Item1}:{l.Item2}/{r.Item1}:{r.Item2}");
// 1:a/0: | 2:b/2:x | 0:/3:y          (a missing side arrives as default)

using var z = new ZstandardStream(ms, CompressionMode.Compress, leaveOpen: true);
// 1000 bytes of 'a' -> 18 bytes, round trip 1000

JsonSerializer.SerializeAsyncEnumerable(stream, Numbers(), topLevelValues: true);
// 0\n1\n                              (JSON Lines)

int.TryParsePartial("123abc", NumberStyles.Integer, CultureInfo.InvariantCulture, out v, out consumed);
// True 123 consumed=3

"a\U0001F600b".Contains(new Rune(0x1F600));   // True, IndexOf gives 1
new Regex("^b$", RegexOptions.Multiline | RegexOptions.AnyNewLine).IsMatch("a\u0085b\u0085c");
// True with AnyNewLine, False without
```

Other additions that were checked to exist and run: `EqualityComparer<T>.Create` over a key
selector, `Random.Shared.NextInteger<byte>(10, 20)`, the memory-backed streams
`StringStream` (not seekable) and `ReadOnlyMemoryStream`, and the `Decimal32`, `Decimal64` and
`Decimal128` types in `System.Numerics`. The concepts that explain them are
`linq-sets-joins-grouping-and-lookups`, `compression-zip-gzip-brotli-and-tar`,
`stream-class-hierarchy-and-decorators`, `parsing-tryparse-and-the-try-pattern`,
`unicode-runes-and-text-encodings`, `regular-expressions-in-depth` and
`numeric-types-and-binary-representation`. `Process.Run*` has no concept of its own yet.

Cryptography and networking additions (new key exchange and key wrap algorithms,
post-quantum combinations, typed DNS and caller-driven TLS) are listed by the pages and were not run
here. A few of them are still marked preview there.

### C#, ASP.NET Core and EF Core

Each of the three has its own map, and this hub only says what to open:

- **C# 15** is the default language version in `net11.0`: arguments for collection
  expressions (`with(...)`), union types, closed classes, extension indexers and labeled
  `break` and `continue`, while the memory safety rules are still preview. Start at
  `whats-new-in-csharp-15`. The compiler also rejects a few things the 10 compiler
  accepted, and those are in the upgrade concept.
- **ASP.NET Core 11** groups its changes into automatic, opt-in, breaking and
  experimental. `whats-new-in-aspnet-core-11` is the map and
  `migrating-from-aspnet-core-10-to-11` is the checklist, with the NuGet restore error from
  OpenAPI, the OpenAPI 3.2 default and `RunAsync` throwing when a hosted service fails.
- **EF Core 11** brings leaner SQL, new translations, JSON path indexes and a
  `LastMigrationId` in the snapshot, with SQL Server 2025 and Cosmos DB additions.
  `whats-new-in-ef-core-11` is the map and
  `upgrading-from-ef-core-10-to-11-breaking-changes` is the checklist.

## Trade-offs

- **STS is a shorter promise, not a worse release.** The end date matches the LTS you may
  already run, so the question is how much change you want to carry now. A service with
  weak tests may sit on .NET 10 until its safety net improves.
- **Installing the runtime can change behavior before you retarget.** Anything that runs
  a `net10.0` app on the 11 runtime (a roll forward, a base image that moved) gives it the
  new base library.
  ```csharp
  (byte)double.Parse("300.0")  // 44 on the 10 runtime, 255 on the 11 runtime, same net10.0 app
  ```
- **Defaults and opt-ins moved between the RC and GA.** The optimized Native AOT publish
  was reported as the default in the release candidates and is opt-in in the GA SDK. Re-run
  your own checks on the GA build instead of trusting a preview write-up.
  ```xml
  <UseOptimizedPublish>true</UseOptimizedPublish>
  ```
- **A map hides depth.** Each bullet is a headline. The Microsoft pages keep being edited
  and this page records what was true on 11.0.100 on November 12, 2026.
- **Preview items are not a plan.** Runtime async for your own code and the memory safety
  rules can change before they are stable. Try them in a branch, not in a release.

## Documentation Links

- [What's new in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/overview) (doc)
- [What's new in the .NET 11 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [What's new in the SDK and tooling for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/sdk) (doc)
- [What's new in the .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [.NET 11 release notes, GitHub](https://github.com/dotnet/core/tree/main/release-notes/11.0) (doc)
- [.NET and .NET Core official support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
