---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`dotnet publish` is not one operation but a set of independent switches: who
provides the runtime (the machine or your folder), how many files you ship
(a folder or one executable), how much of the framework you keep (all of it or
only what static analysis says you use), and whether code is precompiled
(ReadyToRun). Each switch changes size, startup and what can break. This concept
publishes the same apps in every combination and reports real sizes, startup
numbers and trim warnings, so the choice is made with data instead of habit.

Environment for every number below: SDK 10.0.100, runtime 10.0.0, Release,
`osx-arm64`, Apple M4 Max, macOS 27. The machine was shared with other builds,
so wall-clock times are medians of repeated runs and only differences that held
across rounds are reported.

## Use Cases

- Shipping a command-line tool to machines where you cannot install .NET.
- Choosing the publish mode for a container image or a serverless function, where
  image size and cold start are billed.
- Distributing one executable instead of a folder with 190 files.
- Understanding why a trimmed build passes the tests in Debug and fails in
  production with a `null` from reflection.

## Deep Dive

### Framework-dependent or self-contained

A **framework-dependent** publish ships your assemblies and expects a matching
shared runtime on the target; it is the default. By default it also writes an
**apphost** (a small native launcher named after the app) next to the portable
DLL, so `./Hello` and `dotnet Hello.dll` both work; `-p:UseAppHost=false`
drops it. A **self-contained** publish copies the runtime and the whole
framework into the folder, and must target a **runtime identifier** (RID) such
as `linux-x64`, `win-arm64` or `osx-arm64`: the runtime is native code, so one
publish runs on one OS and architecture.

```bash
dotnet publish -c Release                                   # framework-dependent
dotnet publish -c Release -r osx-arm64 --self-contained     # self-contained
```

The trade is servicing. A framework-dependent app rolls forward to the newest
patch of its major runtime installed on the machine, so `apt upgrade` fixes a
CVE for every app. A self-contained app keeps the runtime it was published
with until you publish again.

A console app that prints its runtime and RID, published both ways:

| Mode | Files | Size |
|---|---|---|
| framework-dependent | 5 | 0.14 MB (apphost 124 KB, `Hello.dll` 5.5 KB) |
| self-contained | 191 | 82.8 MB |

### Single file: one executable, with exceptions

`-p:PublishSingleFile=true` appends the managed assemblies, `deps.json` and
`runtimeconfig.json` to the apphost. It works in both modes:

| Mode | Files | Size |
|---|---|---|
| framework-dependent, single file | 2 (`Hello`, `Hello.pdb`) | 0.13 MB |
| self-contained, single file | 2 | 76.4 MB |

Managed assemblies are loaded from inside the bundle, without extraction. That
breaks code that assumes assemblies live on disk, and the analyzer says so at
build time:

```text
Program.cs(6,33): warning IL3000: 'System.Reflection.Assembly.Location.get' always returns
an empty string for assemblies embedded in a single-file app. If the path to the app
directory is needed, consider calling 'System.AppContext.BaseDirectory'.
```

The run confirmed it: `Location: ''`, while `AppContext.BaseDirectory` printed
the publish folder.

Native libraries are the exception. An app using `Microsoft.Data.Sqlite`
published as a single file still produced **three** files: `Pkg`, `Pkg.pdb`
and `libe_sqlite3.dylib` (1.5 MB) next to it. Adding
`-p:IncludeNativeLibrariesForSelfExtract=true` puts the library inside the
bundle, but the host must **extract** it to disk before loading it. Running
with `DOTNET_BUNDLE_EXTRACT_BASE_DIR` pointing to a scratch folder showed
`extract/Pkg/0UcDQXFeJ4aL/libe_sqlite3.dylib`. Without that variable the
documentation says the files go under `$HOME/.net` on Linux and macOS and
`%TEMP%\.net` on Windows, which fails under `systemd` units without `$HOME`.
(The runtime's own native code was already inside the bundle on macOS; the
documentation describes separate runtime files on Windows.)

`-p:EnableCompressionInSingleFile=true` compresses the embedded assemblies:
the self-contained `Hello` went from 76.4 MB to 34.8 MB, and its startup from
about 40 ms to about 75 ms, because everything is decompressed into memory at
launch (peak RSS 37 MB to 50 MB).

### Trimming: static analysis deletes the unused framework

`-p:PublishTrimmed=true` runs **ILLink** over the self-contained output. It
starts from `Main`, follows every static reference and removes assemblies,
types and members that are never reached. Trimming exists only for
self-contained apps (the shared framework of a framework-dependent app cannot
be cut per app).

| Mode | Files | Size |
|---|---|---|
| self-contained, trimmed | 29 | 20.2 MB |
| self-contained, single file, trimmed | 2 | 13.0 MB |

The analysis cannot see reflection driven by data. This program has all three
classic patterns:

```csharp
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using System.Text.Json;

// 1. A type chosen at run time from a string
var name = args.Length > 0 ? args[0] : "Plugin";
Console.WriteLine($"GetType(\"{name}\"): {Type.GetType(name)?.Name ?? "null"}");

// 2. Reflecting over a Type parameter, without and with annotation
Console.WriteLine($"Plain:     {string.Join(", ", Methods(typeof(InvoiceA)))}");
Console.WriteLine($"Annotated: {string.Join(", ", AnnotatedMethods(typeof(InvoiceB)))}");

// 3. Reflection-based JSON
try { Console.WriteLine(JsonSerializer.Serialize(new InvoiceA())); }
catch (Exception ex) { Console.WriteLine($"{ex.GetType().Name}: {ex.Message}"); }

static IEnumerable<string> Methods(Type t) =>
    t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => m.Name);

static IEnumerable<string> AnnotatedMethods(
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)] Type t) =>
    t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => m.Name);

class Plugin { }
class Exporter { }
class InvoiceA { public decimal Total { get; set; } = 10m; public void Print() { } }
class InvoiceB { public decimal Total { get; set; } = 10m; public void Print() { } }
```

The trimmed publish printed each warning twice: once from the Roslyn analyzer
(`warning IL2057`) and once from ILLink (`Trim analysis warning IL2057`):

```text
Program.cs(7,43): warning IL2057: Unrecognized value passed to the parameter 'typeName'
  of method 'System.Type.GetType(String)'. It's not possible to guarantee the availability of the target type.
Program.cs(18,5): warning IL2070: 'this' argument does not satisfy
  'DynamicallyAccessedMemberTypes.PublicMethods' in call to 'System.Type.GetMethods(BindingFlags)'.
Program.cs(14,25): warning IL2026: Using member 'System.Text.Json.JsonSerializer.Serialize<TValue>(...)'
  which has 'RequiresUnreferencedCodeAttribute' can break functionality when trimming application code.
```

Untrimmed versus trimmed, with `Exporter` as the argument:

```text
// dotnet run -c Release -- Exporter
GetType("Exporter"): Exporter
Plain:     get_Total, set_Total, Print
Annotated: get_Total, set_Total, Print
{"Total":10}

// ./out/trim/Trim Exporter
GetType("Exporter"): null
Plain:
Annotated: get_Total, set_Total, Print
InvalidOperationException: Reflection-based serialization has been disabled for this application. ...
```

Every warning became a real failure. `Exporter` was never referenced, so it
was deleted (the default `Plugin` survived, apparently because ILLink could see that
literal).
`InvoiceA` lost all its methods. The annotated parameter is the fix:
`[DynamicallyAccessedMembers]` tells ILLink that whatever `Type` flows into it
needs its public methods kept, and the analyzer then checks every caller.
`[RequiresUnreferencedCode]` is the other tool: it marks an API as
incompatible, so the warning moves to whoever calls it, as `JsonSerializer`
does. JSON was not trimmed away; it was **switched off** by a feature switch.

### Feature switches: trimming changes behavior, not only size

`PublishTrimmed` writes switches into `runtimeconfig.json`. Some, from the
trimmed app above:

```json
"System.Net.SocketsHttpHandler.Http3Support": false,
"System.StartupHookProvider.IsSupported": false,
"System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": false,
"System.Reflection.Metadata.MetadataUpdater.IsSupported": false,
"System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization": false
```

`Http3Support` is new in .NET 10: with `PublishTrimmed` or `PublishAot`,
`HttpClient` no longer carries HTTP/3 unless you set
`<Http3Support>true</Http3Support>`. `StartupHookProvider` off means
`DOTNET_STARTUP_HOOKS` is ignored, which is how some APM agents attach. Each
switch also has an MSBuild property (`EventSourceSupport`,
`InvariantGlobalization`, `UseSystemResourceKeys`) for cutting further.

Packages get a different treatment. With `Newtonsoft.Json` 13.0.4 the calls
in your code are reported individually, but the warnings inside the package
collapse into one:

```text
Newtonsoft.Json.dll : warning IL2104: Assembly 'Newtonsoft.Json' produced trim warnings.
```

`<TrimmerSingleWarn>false</TrimmerSingleWarn>` expands them. That app still
worked trimmed, by luck: the record's constructor and getters were referenced
by its own code.

### Trimming and ReadyToRun: the startup surprise

ReadyToRun (R2R) stores native code next to the IL so the JIT has less to do at
startup (see the JIT concept). The framework already ships as R2R. The same
SQLite and Newtonsoft app, with a `Stopwatch` around `Main` (median of 11
runs) and the count of JIT-compiled methods (`DOTNET_JitStdOutFile=/dev/stdout
DOTNET_JitDisasmSummary=1`):

| Publish | Size | JIT'd methods | Time in `Main` | Peak RSS |
|---|---|---|---|---|
| framework-dependent | 0.96 MB of DLLs | 693 | 46 ms | 72.5 MB |
| framework-dependent, R2R | 2.7 MB of DLLs | 56 | 27 ms | 74.8 MB |
| self-contained single file | 77.3 MB | 693 | 46 ms | 68.7 MB |
| single file, trimmed | 19.3 MB | 3,021 | 101 ms | 29.1 MB |
| single file, trimmed, R2R | 44.0 MB | 153 | 19 ms | 53.0 MB |

`Newtonsoft.Json.dll` grew from 723 KB to 2.0 MB with R2R (2.9 times). The
trimmed row is the trap: the JIT compiled 3,021 methods instead of 693, a sign
that the trimmed copies of the framework assemblies no longer carried their
precompiled code, and the app spent twice as long in `Main`. Adding
`PublishReadyToRun` recompiles the trimmed set and wins on every axis except
size.

## Trade-offs

- **Framework-dependent is small and patched by the OS; self-contained is
  pinned.** A self-contained app keeps its runtime's CVEs until you republish.
  ```bash
  dotnet publish -r linux-x64 --self-contained   # rebuild on every runtime patch
  ```
- **Single file simplifies copying, not path logic.** `Assembly.Location` is
  empty, and native package libraries either sit next to the file or get
  extracted to a directory that must be writable and trusted.
- **Compression halves the file and doubles startup.** Measure before
  enabling it; it fits rarely-launched tools, not CLIs called in loops.
- **Trimming cut 82.8 MB to 20.2 MB but turns reflection bugs into production
  bugs.** Treat `IL2xxx` as errors and test the published binary, not
  `dotnet run`. With the line below, the publish of the program above stopped
  with `error IL2026`, `error IL2057` and `error IL2070`.
  ```xml
  <PublishTrimmed>true</PublishTrimmed>
  <WarningsAsErrors>$(WarningsAsErrors);IL2026;IL2057;IL2070;IL2104</WarningsAsErrors>
  ```
- **Trimmed without R2R can start slower than untrimmed.** Here, 101 ms against
  46 ms in `Main`; trimmed plus R2R was the fastest at 19 ms.
- **R2R trades disk for startup.** 2 to 3 times larger assemblies; little gain
  for an app whose own code is small, since the framework is already R2R.
- **Feature switches change runtime behavior.** HTTP/3, startup hooks and
  reflection JSON are off in trimmed .NET 10 apps unless re-enabled.

## Lab

In this lab you describe the publish switches in MSBuild (framework-dependent, self-contained with a `RuntimeIdentifier`, single file, trimming, feature switches, ReadyToRun) and watch the trim and single-file analyzers point at the code that would break in a published app, then fix that code. You receive the structure ready, with `ProjectFiles` and `AnalyzerFiles` throwing `NotImplementedException`, and your job is to return the text of `.csproj` files and of a small C# program. The core idea is to feel that publishing is a project decision that the SDK partly infers (for example, `PublishSingleFile` turns the analyzer on by itself), and that reflection-heavy code only shows its problem after publishing.

**The scenario**

The problem is publishing a lean executable without breaking what depends on reflection.

- `ProjectFiles.cs`: methods that return `.csproj` text (`FrameworkDependentProject`, `SelfContainedSingleFileProject`, `TrimmedProject`, `SlimRuntimeProject`).
- `AnalyzerFiles.cs`: `AnalyzerProject` (a project with the analyzers on) and `FixedProgram` (the corrected version of the program).
- `SampleCode.cs`: `RiskyProgram`, already provided, with four classic problems: a type chosen from a string (IL2057), reflection over an unannotated `Type` (IL2070), reflection-based JSON (IL2026) and `Assembly.Location` (IL3000).

This lab does not run `dotnet publish`: that would download runtime packs of tens of MB. The tests evaluate the project with `dotnet msbuild -getProperty` and run `dotnet build` on a framework-dependent project, where the analyzers already emit the same `IL` warnings. Everything is offline.

**What you will do, step by step**

1. **Framework-dependent (TODO-00).** In `FrameworkDependentProject`, write a `net10.0` console project with no RID and with `SelfContained` and `UseAppHost` false. The test passes a RID only on the command line to prove it does not imply self-contained.
2. **Self-contained and single file (TODO-01).** In `SelfContainedSingleFileProject`, set the RID, `SelfContained`, `PublishSingleFile` and `IncludeNativeLibrariesForSelfExtract`. Do not write the analyzer property: `PublishSingleFile` already turns `EnableSingleFileAnalyzer` on.
3. **Trimming (TODO-02).** In `TrimmedProject`, turn on `PublishTrimmed`, set `TrimMode` and create one `TrimmerRootAssembly` per assembly that ILLink must never cut.
4. **Slim runtime (TODO-03).** In `SlimRuntimeProject`, turn off what the app does not use (`InvariantGlobalization`, `EventSourceSupport`, `UseSystemResourceKeys`), opt back in to `Http3Support` (trimming turns it off in .NET 10) and set `TrimmerSingleWarn` to false to see every warning.
5. **See the warnings (TODO-04).** In `AnalyzerProject`, turn on the trim and single-file analyzers (through `PublishTrimmed` and `PublishSingleFile` or directly) so that building `RiskyProgram` emits IL2026, IL2057, IL2070 and IL3000.
6. **Fix the code (TODO-05).** In `FixedProgram`, replace `Type.GetType` with `typeof(Plugin)`, annotate the parameter with `[DynamicallyAccessedMembers]`, use a source-generated `JsonSerializerContext` and replace `Assembly.Location` with `AppContext.BaseDirectory`. The program must print the same four lines with no IL warning. This step depends on TODO-04.

**How you know you are done**

`dotnet test` is green (it takes about 4 to 10 seconds). You should be able to explain which warning comes from which line of `RiskyProgram` and why the fixed version keeps working after trimming.

**Optional challenges**

- **TODO-06:** `ReadyToRunCompressedProject` combines `PublishReadyToRun` and `EnableCompressionInSingleFile`.
- **TODO-07:** `StrictAnalyzerProject` puts IL2026, IL2057 and IL2070 in `WarningsAsErrors`, so the build fails instead of warning.

**Prerequisites:** the concept text on self-contained, single-file and trimmed publishing, basic `.csproj` structure (`PropertyGroup`, `ItemGroup`) and the .NET 10 SDK (10.0.100).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Until you implement a TODO, its test fails with `NotImplementedException`. Afterwards, as a manual follow-up (it needs network the first time), run `dotnet publish -c Release -r linux-x64 --self-contained -p:PublishSingleFile=true -p:PublishTrimmed=true` on a console project and compare the output sizes.

## Documentation Links

- [.NET application publishing overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/) (doc)
- [Create a single file for application deployment, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview) (doc)
- [Trim self-contained applications, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-self-contained) (doc)
- [Trimming options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trimming-options) (doc)
- [Fixing trim warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/fixing-warnings) (doc)
- [ReadyToRun deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) (doc)
- [HTTP/3 disabled by default with PublishTrimmed (.NET 10 breaking change), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/networking/10.0/http3-disabled-with-publishtrimmed) (doc)
- [.NET RID catalog, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/rid-catalog) (doc)
