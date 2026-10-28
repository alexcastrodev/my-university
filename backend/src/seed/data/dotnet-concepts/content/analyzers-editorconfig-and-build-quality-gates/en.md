---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

The C# compiler can do much more than check syntax: the .NET SDK ships Roslyn analyzers that flag culture bugs, lost stack traces, ignored cancellation tokens and hundreds of other problems, and the compiler can turn any of them into a build failure. The hard part is not enabling them but knowing which knob does what. `AnalysisMode` and `AnalysisLevel` choose which code-quality (CAxxxx) rules are on, `EnforceCodeStyleInBuild` decides whether code-style (IDExxxx) rules run on the command line at all, `.editorconfig` and `.globalconfig` set the severity per rule or per category with their own precedence rules, and `TreatWarningsAsErrors`, `WarningsAsErrors`, `WarningsNotAsErrors` and `NoWarn` decide what breaks the build, including NuGet audit warnings you may not expect. This concept builds the same small files under each setting and shows the exact warning and error lines, the warning counts and the exit codes, then puts the gate in `Directory.Build.props` and adds `dotnet format` for CI. Versions used: SDK 10.0.100 (built-in `Microsoft.CodeAnalysis.NetAnalyzers`, file version 10.1.25.52411, and `dotnet format` 10.0.100), `Meziantou.Analyzer` 3.0.317.

## Use Cases

- Making a whole solution fail CI on real bugs (lost stack traces, culture-dependent parsing, null dereferences) while developers still build locally with warnings.
- Raising the rule set of a new service to `Recommended` or `All` and silencing, per folder, generated or legacy code that cannot be fixed now.
- Enforcing a team code style (file-scoped namespaces, accessibility modifiers, braces) in the pull request instead of in code review comments.
- Adding a third-party analyzer package to a library without leaking it to every project and package that consumes the library.

## Deep Dive

### Two families of rules, and what a plain build runs

Code-quality rules (CA prefix) live in `Microsoft.CodeAnalysis.NetAnalyzers`, which the SDK adds as an implicit analyzer; code-style rules (IDE prefix) live in a separate code-style analyzer. `dotnet msbuild -getProperty` on a fresh `net10.0` console project returned `EnableNETAnalyzers` `true`, `AnalysisLevel` `10.0`, `AnalysisMode` empty, `EnforceCodeStyleInBuild` `false` and `TreatWarningsAsErrors` `false`. Then I built this file (paths and help links are trimmed in every output below):

```csharp
var o = new Orders();
Console.WriteLine(o.Total(new[] { 1, 2, 3 }));
await o.SaveAsync(CancellationToken.None);

public class Orders
{
    private int _unused;
    public int Total(int[] items) => items.Sum();
    public string Format(decimal value) => value.ToString();
    public bool IsAdmin(string role) => role.ToLower() == "admin";
    public async Task SaveAsync(CancellationToken ct)
    {
        await Task.Delay(10);
        try { int.Parse("x"); }
        catch (Exception ex) { throw ex; }
    }
}
```

```text
Program.cs(7,17): warning CS0169: The field 'Orders._unused' is never used
Program.cs(15,32): warning CA2200: Re-throwing caught exception changes stack information
```

One CA warning and exit code 0. The other rules that apply here (static members, culture, the ignored `ct`) are enabled as suggestions or disabled, and suggestions never reach `dotnet build`. The docs list the rules enabled as warnings in .NET 10; `CA2024` (`EndOfStream` in an async method) is not in that table, yet it fired as a warning by default in my build.

### AnalysisMode: the same code under five modes

```xml
<AnalysisMode>Recommended</AnalysisMode>  <!-- None, Default, Minimum, Recommended, All -->
```

```text
None:        0 CA warnings
Default:     1  CA2200
Minimum:     9  CA1050 CA1822x4 CA1861 CA1862 CA2016 CA2200
Recommended: 13 + CA1304 CA1305x2 CA1311
All:         18 + CA1062 CA1515 CA1823 CA2007x2
```

`Recommended` added the culture rules (`CA1305: The behavior of 'int.Parse(string)' could vary based on the current user's locale settings`) and `CA2016: Forward the 'ct' parameter to the 'Delay' method`. `All` added rules that are noise in an app: `CA2007: Consider calling ConfigureAwait` and `CA1515` (make public types internal). Each category has its own property: `AnalysisModeGlobalization=Recommended` alone gave the 4 culture warnings plus CA2200, and `AnalysisMode=Recommended` with `AnalysisModeGlobalization=None` gave 9. A compound `AnalysisLevel=10.0-recommended` with `AnalysisMode=All` gave 13: the compound value wins, as the docs say. `EnableNETAnalyzers=false` gave 0 even with `AnalysisMode=All`. Under the hood each mode is a `.globalconfig` shipped in the SDK (`analyzers/build/config/analysislevel_10_recommended.globalconfig`, with `global_level = -100`) that the targets add to the compilation. That level matters for precedence below.

### AnalysisLevel and the "latest" trap

`AnalysisLevel` pins the rule set of a .NET release, so an SDK upgrade does not add new warnings by surprise. The docs say the default is `latest`. On SDK 10.0.100 with `net10.0` the default was `10.0`, and `latest` was older. I built an async loop over `reader.EndOfStream`:

```text
AnalysisLevel (unset):  Program.cs(2,9): warning CA2024: Do not use 'reader.EndOfStream' in an async method
AnalysisLevel=10.0 or preview:  same warning
AnalysisLevel=latest:   (no warning)   EffectiveAnalysisLevel=9.0
AnalysisLevel=latest-all: (no warning)
```

`Microsoft.NET.Sdk.Analyzers.targets` in 10.0.100 hard-codes `_LatestAnalysisLevel` to `9.0`, so `latest` turns off the five rules new in .NET 10 (CA1873, CA1874, CA1875, CA2023, CA2024). Write `10.0-recommended`, not `latest-recommended`.

### IDE rules are not enforced on build by default

I configured three style rules in `.editorconfig` with the `option = value:severity` form (`dotnet_diagnostic.IDE0040.severity = warning` behaved the same):

```ini
[*.cs]
dotnet_style_require_accessibility_modifiers = always:warning
csharp_style_namespace_declarations = file_scoped:warning
csharp_prefer_braces = true:suggestion
```

The code had a block namespace, a `class Program` without `internal` and an `if` without braces. The docs say the IDE shows these as you type. `dotnet build` was silent (exit 0, no diagnostics); with `-p:EnforceCodeStyleInBuild=true` they appeared:

```text
Program.cs(1,11): warning IDE0161: Convert to file-scoped namespace
Program.cs(3,11): warning IDE0040: Accessibility modifiers required
Program.cs(5,21): warning IDE0040: Accessibility modifiers required
```

`IDE0011` (braces) stayed out of the build because its severity is `suggestion`. One more trap: with `dotnet_diagnostic.IDE0005.severity = warning` (unused usings) the build printed `CSC : warning EnableGenerateDocumentationFile: Set MSBuild property 'GenerateDocumentationFile' to 'true' in project file to enable IDE0005 (Remove unnecessary usings/imports) on build`, and only with that property did `warning IDE0005: Using directive is unnecessary.` appear.

### Severity in .editorconfig and who wins

The docs order the keys: a rule ID entry beats a category entry, which beats the all-rules entry:

```ini
dotnet_diagnostic.CA1822.severity = none                       # one rule
dotnet_analyzer_diagnostic.category-Globalization.severity = none   # one category
dotnet_analyzer_diagnostic.severity = warning                  # every enabled rule
```

With only the last line and no `AnalysisMode`, the sample produced 13 CA warnings, because suggestions became warnings. The bulk keys have a catch the docs mention: with `AnalysisMode=Recommended` or `All`, `category-Globalization.severity = none` was ignored (CA1304, CA1305 and CA1311 still fired) and so was `category-Performance.severity = error`, while `CA1822.severity = none` worked. The SDK mode file sets severities per rule ID, and an ID entry beats a category entry. Use `AnalysisMode<Category>` or per-ID entries instead.

Between files, I combined a root `.editorconfig` with `CA1822 = warning`, a `Legacy/.editorconfig` with `CA1822 = none` and a `.globalconfig` (`is_global = true`) with `CA1822 = error`. Result: `warning CA1822` four times in `Program.cs` and nothing in `Legacy/Old.cs`. With the `.globalconfig` alone: `error CA1822` five times, also under `AnalysisMode=Recommended`. The deeper `.editorconfig` won for its folder, any `.editorconfig` beat the `.globalconfig`, and my `.globalconfig` (default `global_level` 100) beat the SDK mode file (`-100`). A `.globalconfig` applies to every file of the project regardless of folder, which makes it the place for project-wide policy.

### Turning warnings into errors

On the sample with `Default` mode (CS0169 plus CA2200):

```text
-p:TreatWarningsAsErrors=true                            error CA2200, error CS0169   exit 1
-p:WarningsAsErrors=CA2200                               error CA2200, warning CS0169 exit 1
-p:TreatWarningsAsErrors=true -p:WarningsNotAsErrors=CS0169   error CA2200, warning CS0169 exit 1
-p:NoWarn=CA2200                                         warning CS0169               exit 0
-p:CodeAnalysisTreatWarningsAsErrors=true                error CA2200, warning CS0169 exit 1
-p:TreatWarningsAsErrors=true -p:CodeAnalysisTreatWarningsAsErrors=false   warning CA2200, error CS0169 exit 1
```

`CodeAnalysisTreatWarningsAsErrors` touches only CA rules (the SDK switches to the `_warnaserror` variant of the mode file). Two interactions with `.editorconfig`: `NoWarn=CA1822` silenced a rule that `.editorconfig` set to `error`, and `WarningsNotAsErrors=CA1822` did not downgrade it, because that property only stops the promotion of warnings and the rule was an error by its own severity.

### TreatWarningsAsErrors also fails restore

I referenced `Newtonsoft.Json` 12.0.1, which has a known advisory, and added a custom `<Warning Code="DEMO001" ...>` task to the project:

```text
(defaults)                  warning NU1903: Package 'Newtonsoft.Json' 12.0.1 has a known high severity vulnerability, ...
                            warning DEMO001: A custom MSBuild warning                                exit 0
TreatWarningsAsErrors=true  error NU1903: Warning As Error: Package 'Newtonsoft.Json' 12.0.1 has ...  exit 1
  + WarningsNotAsErrors=NU1903   both back to warnings                                              exit 0
NuGetAudit=false, TreatWarningsAsErrors=true          warning DEMO001                               exit 0
NuGetAudit=false, MSBuildTreatWarningsAsErrors=true   error DEMO001                                 exit 1
NuGetAudit=false, -warnaserror                        error DEMO001                                 exit 1
```

NuGet honors `TreatWarningsAsErrors`, so a vulnerability published tonight breaks tomorrow's build of unchanged code. That can be what you want; if not, exclude `NU1901;NU1902;NU1903;NU1904` with `WarningsNotAsErrors` and handle audit separately. Plain MSBuild warnings (`MSBxxxx`, custom tasks) ignore `TreatWarningsAsErrors`; they need `MSBuildTreatWarningsAsErrors` or the `-warnaserror` CLI switch, with `MSBuildWarningsNotAsErrors` as the exception list.

### Nullable reference types: the biggest gate

`<Nullable>enable</Nullable>` plus `<WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>`, on this class:

```csharp
public string Name { get; set; }
public string? Email { get; set; }
public int EmailLength() => Email.Length;
public static string NameOf(int id) => Find(id).Name;   // Find returns Customer?
```

```text
Nullable=disable:  warning CS8632: The annotation for nullable reference types should only be used in code within a '#nullable' annotations context. (x2)
Nullable=enable:   warning CS8618: Non-nullable property 'Name' must contain a non-null value when exiting constructor. ...
                   warning CS8602: Dereference of a possibly null reference. (x2)
+ WarningsAsErrors=nullable:  error CS8618, error CS8602 (x2)   exit 1
```

The `nullable` keyword covers the whole family of nullable warnings without listing IDs. `dotnet msbuild -getProperty:WarningsAsErrors` showed the SDK also appends `NU1605;SYSLIB0011`, which is why the snippet keeps `$(WarningsAsErrors)`.

### Suppressions, and which leave a trace

I suppressed CA1822 (under `Recommended`) four ways and wrote a SARIF log with `<ErrorLog>build.sarif,version=2.1</ErrorLog>`:

```csharp
#pragma warning disable CA1822 // stateless by design
    public int Pragma() => 1;
#pragma warning restore CA1822
    [SuppressMessage("Performance", "CA1822:Mark members as static", Justification = "Mocked in tests")]
    public int Attribute() => 2;
    public int Global() => 3;   // GlobalSuppressions.cs: [assembly: SuppressMessage(..., Scope = "member", Target = "~M:Shop.Prices.Global~System.Int32")]
```

The fourth was `dotnet_diagnostic.CA1822.severity = none` in `Legacy/.editorconfig`.

```text
console: only "warning CA1822: Member 'Unsuppressed' ..."
SARIF:   CA1822 Prices.cs:8  suppressions=[inSource, justification=None]
         CA1822 Prices.cs:12 suppressions=[inSource, justification='Mocked in tests']
         CA1822 Prices.cs:14 suppressions=[inSource, justification='Public API, cannot change']
         CA1822 Prices.cs:16 (not suppressed)
with -p:NoWarn=CA1822: 0 results in SARIF
```

The in-source suppressions stay visible to tooling, and `Justification` travels with the attribute; the pragma comment does not. `.editorconfig` `none` and `NoWarn` leave no trace in the log: the diagnostic simply does not exist.

### A third-party analyzer, private to its project

`dotnet add package Meziantou.Analyzer` wrote the reference with `<PrivateAssets>all</PrivateAssets>` on its own. I referenced the library from a console app, then removed `PrivateAssets`:

```text
PrivateAssets=all:  Lib/Codes.cs: warning MA0006: Use string.Equals instead of Equals operator
                    Lib/Codes.cs: warning MA0011: Use an overload of 'ToString' that has a 'System.IFormatProvider' parameter
no PrivateAssets:   the same 2, plus App/Program.cs(2,19): warning MA0006 and App/Program.cs(4,19): warning MA0011
```

Without it the analyzer flowed through the project reference into the app, and `dotnet pack` wrote `<dependency id="Meziantou.Analyzer" version="3.0.317" exclude="Build,Analyzers" />` into the nuspec, a dependency for every consumer (with `PrivateAssets=all` the group was empty).

### One gate for the whole solution

The SDK-style projects concept covers how `Directory.Build.props` is imported; here is the gate I put in it:

```xml
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <AnalysisMode>Recommended</AnalysisMode>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>
  </PropertyGroup>
  <PropertyGroup Condition="'$(CI)' == 'true'">
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

With a root `.editorconfig` (`CA1822 = suggestion`, file-scoped namespaces as warning) and a `Domain` project holding `amount.ToString()` in a block namespace:

```text
dotnet build Shop.sln          warning IDE0161, warning CA1305   exit 0
CI=true dotnet build Shop.sln  error IDE0161, error CA1305       exit 1
```

Environment variables are MSBuild properties. GitHub Actions sets `CI=true` (Azure Pipelines sets `TF_BUILD` instead, so adjust the condition), so developers see warnings locally and the pipeline fails.

### dotnet format as a CI gate

`dotnet format` runs the code-style and analyzer fixes outside the build, whatever `EnforceCodeStyleInBuild` says:

```text
dotnet format style --verify-no-changes                  IDE0040 x2, IDE0161          exit 2
dotnet format style --verify-no-changes --severity info  + info IDE0011, info IDE0130  exit 2
dotnet format analyzers --verify-no-changes              warning CA2200               exit 2
dotnet format analyzers (fix), then verify again         "throw ex;" -> "throw;"      exit 0
```

The default `--severity` is `warn`, as documented, so suggestion-level rules pass unless you lower it.

## Trade-offs

- **`Recommended` is a better default than `All`.** `All` added `CA2007` and `CA1515` on app code, rules meant for libraries. Start from `Recommended` and opt in per category.
- **Pin the level with a number.** `latest` was 9.0 on SDK 10.0.100 and hid five .NET 10 rules; `<AnalysisLevel>10.0-recommended</AnalysisLevel>` is explicit and an SDK upgrade does not move it.
- **`TreatWarningsAsErrors` is broad.** It also promotes NuGet audit warnings, so unchanged code can fail after an advisory is published. Prefer it only in CI, or carve out `NU190x` and run audit as its own step.
- **Code style on build costs time.** `EnforceCodeStyleInBuild` adds the IDE analyzers to every compilation; a separate `dotnet format --verify-no-changes` step keeps local builds fast and still blocks the merge.
- **Prefer suppressions that leave a trace.** `[SuppressMessage]` with `Justification` shows up in SARIF and code review; `NoWarn` and severity `none` erase the diagnostic for the whole scope.
- **Per-folder `.editorconfig` beats `.globalconfig`.** Good for legacy or generated folders, but a forgotten `none` deep in the tree silently disables a rule you think is enforced.

## Documentation Links

- [Code analysis in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview) (doc)
- [Configure code analysis rules, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-options) (doc)
- [Configuration files for code analysis rules, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-files) (doc)
- [Suppress code analysis warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/suppress-warnings) (doc)
- [MSBuild properties for Microsoft.NET.Sdk, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [dotnet format command, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format) (doc)
