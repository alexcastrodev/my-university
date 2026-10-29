---
version: 1.1
updatedAt: 2026-10-29
---
## Objective

C# has no macro preprocessor like C, but it keeps a small set of `#` directives
that the compiler handles while reading the file: conditional compilation with
`#define` and `#if`, diagnostics control with `#pragma warning` and
`#nullable`, source mapping with `#line`, user diagnostics with `#error` and
`#warning`, editor folding with `#region`, and, new with .NET 10, the `#!` and
`#:` lines of file-based apps. This concept shows each one on .NET 10 / C# 14,
the symbols the SDK defines (and does not), how to set your own, and when a
runtime check, an attribute or a feature switch beats `#if`.

## Use Cases

- A library targeting `net8.0` and `net10.0` that calls newer APIs only there.
- Diagnostics or test hooks that must not ship in a Release build.
- Silencing one known warning in generated or legacy code, not project-wide.
- Code generators that want errors to point at the template, not the `.cs`.

## Deep Dive

### #define, #undef and #if

A symbol is defined or not; it has no value. `#define` and `#undef` affect
only their own file and only at its top: after a statement they fail with
`CS1032: Cannot define/undefine preprocessor symbols after first token in
file`. A missing `#endif` is `CS1027: #endif directive expected`.

```csharp
#define FEATURE_A
#undef DEBUG                                       // only for this file
#if (FEATURE_A || FEATURE_B) && !DEBUG && NET10_0_OR_GREATER
Console.WriteLine("printed, even in a Debug build");
#endif
```

`#if` also takes `==`, `!=`, `#elif` and `true`/`false` (`#if false` skips
text that is not even C#). Symbols are case-sensitive, and `#if FEATURE_A` in
a second file of the project took its `#else` branch: `#define` does not leak.

### The symbols the SDK defines

```text
dotnet run              DEBUG TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
dotnet run -c Release   RELEASE TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
dotnet run -c Staging   TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
```

Those are the `#if` blocks that compiled in a `net10.0` console app. So
`RELEASE` exists in Release (the preprocessor page only names `DEBUG` and
`TRACE`), and a custom configuration defines its name: `dotnet msbuild
-getProperty:DefineConstants -p:Configuration=Staging` prints `TRACE;STAGING`,
so an `#if !DEBUG` meant as "production" is true in Staging. A `netstandard2.0`
target gets `NETSTANDARD;NETSTANDARD2_0;NETSTANDARD2_0_OR_GREATER` instead.

With `<TargetFrameworks>net8.0;net10.0</TargetFrameworks>`, an `#if
NET10_0_OR_GREATER ... #elif NET8_0` that prints its branch printed `NET8_0
branch, runtime 8.0.22` from `bin/Debug/net8.0` and `NET10_0_OR_GREATER branch,
runtime 10.0.0` from `bin/Debug/net10.0`. `dotnet run` alone asks to "Specify
which framework to run using '--framework'". Prefer `_OR_GREATER` checks.

### Your own symbols from MSBuild and the command line

```xml
<DefineConstants>$(DefineConstants);FEATURE_X</DefineConstants>
<DefineConstants Condition="'$(Foo)' == 'bar'">$(DefineConstants);FOO_BAR</DefineConstants>
```

```text
dotnet run                                DEBUG TRACE NET10_0 FEATURE_X
dotnet run -p:Foo=bar                     DEBUG TRACE NET10_0 FEATURE_X FOO_BAR
dotnet run -p:DefineConstants=FEATURE_X               NET10_0 FEATURE_X
```

The last line is the trap: a command-line `DefineConstants` is a global
property that replaces the project's value, so `DEBUG` and `TRACE` vanish (the
SDK appends framework symbols later, in `AddImplicitDefineConstants`). Several
symbols need `-p:DefineConstants=A%3BB` or `"A;B"`. A custom property mapped in
the project file, like `-p:Foo=bar`, is safer.

### Platform checks belong at runtime

A `net10.0` build has no `WINDOWS`, `LINUX` or `OSX` symbol (skipped on this
Mac); only the `net10.0-windows` target defines `WINDOWS`. One binary runs
everywhere, so check the OS at run time and let the analyzer check the guard:

```csharp
Console.WriteLine(OperatingSystem.IsMacOS());                          // True
Console.WriteLine(RuntimeInformation.IsOSPlatform(OSPlatform.Linux));  // False
WinOnly.ReadRegistry();  // CA1416: 'WinOnly.ReadRegistry()' is only supported on: 'windows'.
if (OperatingSystem.IsWindows())
    WinOnly.ReadRegistry();  // no warning: guarded
static class WinOnly { [SupportedOSPlatform("windows")] public static void ReadRegistry() { } }
```

### The cost of #if forests

Code in an inactive branch is not compiled, so nothing checks it:

```csharp
#if NET10_0_OR_GREATER
        return string.GetHashCode(s.AsSpan());
#else
        return s.GetHashCod();   // typo
#endif
```

`dotnet build -f net10.0` reports `Build succeeded.`; building all targets
fails on `net8.0` with `error CS1061: 'string' does not contain a definition
for 'GetHashCod'`. CI has to build every configuration and target.

### Alternatives to #if

- `[Conditional("DEBUG")]` removes the call and its argument evaluation (see
  Attributes: Custom and Compiler-Read). `Debug.Assert` is built on it: a
  failing `Debug.Assert(Probe(), "Probe failed")` printed `Process terminated.
  Assertion failed.` and exited with 134 in Debug; in Release `Probe()` never ran.
- A feature switch changes behavior without a rebuild. The item
  `<RuntimeHostConfigurationOption Include="MyApp.UseNewParser" Value="true"
  Trim="true" />` lands in `runtimeconfig.json`; `AppContext.TryGetSwitch`
  returned `true`, and `false` after editing the JSON. Per the docs,
  `[FeatureSwitchDefinition]` (.NET 9) lets "IL rewriters and compilers"
  substitute the switch value: that is how trimming and Native AOT drop code.
- `const bool On = false` makes the C# compiler drop the branch (`CS0162:
  Unreachable code detected`). A `static readonly bool` read from an
  environment variable stays in the IL, but `DOTNET_JitDisasm` (Release, arm64)
  showed the JIT folding it: 104 bytes with a load and a branch at Tier0, 20
  bytes at Tier1 (`mov w0, #2`); with the variable set, Tier1 kept the call and
  dropped the test. Both branches stay type-checked.

### #error and #warning

```csharp
#warning DEBUG build: the fake payment gateway is wired in
#error TODO: pick a serializer before shipping
// Program.cs(1,10): warning CS1030: #warning: 'DEBUG build: the fake payment gateway is wired in'
// Program.cs(2,8): error CS1029: #error: 'TODO: pick a serializer before shipping'
```

A `#warning` alone keeps `Build succeeded.`; `#error` fails the build (exit
code 1), so `#if !NET10_0_OR_GREATER` plus `#error` guards a target. `#error
version` also prints `CS8304` with the compiler and language versions.

### #pragma warning and #nullable

```csharp
int a = 1;                       // line 1: CS0219
#pragma warning disable CS0219   // "219" without the prefix also works
int b = 2;
#pragma warning restore CS0219
int c = 3;                       // line 5: CS0219 again
```

Only lines 1 and 5 warned. With no list, `disable` silences every warning
until a bare `restore`, which means "back to the project setting", not
"on": with `-p:NoWarn=CS0219` line 5 stayed silent, with
`-p:WarningsAsErrors=CS0219` it became an error. Analyzer ids work too
(`CA1416` above). The docs add that a `disable` lasts to the end of the file;
`#pragma warning enable` gives `CS1634: Expected 'disable' or 'restore'`.

`#nullable` is the neighbor for nullable analysis. In a `Nullable=enable`
project, `string a = null;` is silent after `#nullable disable` and warns
`CS8600` after `#nullable restore`. The flags split: under `#nullable enable
annotations`, `string? d` is legal and `d.Length` does not warn; under
`#nullable enable warnings`, `string? f` gives `CS8632` (annotation outside an
annotations context) and `f.Length` still gives `CS8602`.

### #line, #pragma checksum and #region

`#line` changes the file and line the compiler reports, in diagnostics and in
the PDB. Two lines (`int unused = 0;` and a call that throws) placed between
`#line 200 "Template.tt"` and `#line default` gave:

```text
Template.tt(200,13): warning CS0219: The variable 'unused' is assigned but its value is never used
   at Gen.Throw() in Program.cs:line 13
   at Gen.Run() in Template.tt:line 201
```

`#line hidden` hides lines from the debugger (a throw inside it was reported at
the method's `{`). The span form Razor uses, `#line (3, 5) - (3, 30) 7
"Page.razor"`, mapped a warning to `Page.razor(3,10)`. Per the docs, `#pragma
checksum` puts the original file's checksum in the PDB for the debugger.

`#region`/`#endregion` change nothing in the output, they only fold in editors,
and must nest with `#if` (crossing gave `CS1027` and `CS1038`). A region hiding
300 lines says the class should be split; StyleCop has `SA1124` against them.

### #! and #: in file-based apps

On SDK 10, `dotnet run tool.cs` builds one file; `#:` lines replace the
project file (details in File-Based Apps):

```csharp
#!/usr/bin/env -S dotnet --
#:package Humanizer.Core@2.14.1
#:property DefineConstants=$(DefineConstants);FROM_FILE
using Humanizer;
Console.WriteLine(TimeSpan.FromSeconds(4000).Humanize(2));   // 1 hour, 6 minutes
#if FROM_FILE && DEBUG
Console.WriteLine("FROM_FILE and DEBUG are defined");         // printed
#endif
```

With an empty NuGet folder the first run restored `humanizer.core` and the
ILCompiler packages (file-based apps default to `PublishAot`), built a virtual
project under `~/Library/Application Support/dotnet/runfile/` in about 2.7 s;
the next run reused it (about 0.15 s).

The preprocessor page says the compiler ignores `#!` and `#:` and project
builds warn. With SDK 10.0.100, in a normal project they are errors:

```text
error CS9314: '#!' directives can be only used in scripts or file-based programs
error CS9298: '#:' directives can be only used in file-based programs ('-features:FileBasedProgram')
```

## Trade-offs

- **`#if` is free at run time and expensive in maintenance.** Dead branches are
  never type-checked, so every symbol needs its own build in CI.
- **Runtime checks beat platform symbols.** `OperatingSystem.IsWindows()` plus
  CA1416 keeps one binary and one compiled code path; `#if WINDOWS` only works
  with OS-specific targets.
- **Suppress narrowly.** An id and a matching `restore` document one exception
  in place; a bare `disable` or a project-wide `NoWarn` hides future problems.

## Documentation Links

- [C# preprocessor directives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/preprocessor-directives) (doc)
- [Target frameworks in SDK-style projects (preprocessor symbols), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/frameworks) (doc)
- [C# compiler options for language features (DefineConstants), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) (doc)
- [File-based apps reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [Platform compatibility analyzer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/analyzers/platform-compat-analyzer) (doc)
- [FeatureSwitchDefinitionAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.codeanalysis.featureswitchdefinitionattribute) (doc)
