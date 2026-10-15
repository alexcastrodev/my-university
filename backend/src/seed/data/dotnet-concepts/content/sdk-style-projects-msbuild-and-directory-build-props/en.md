---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A modern `.csproj` is often six lines long, yet `dotnet build` compiles every
`.cs` file under it, adds `System.Linq` to every file, references the whole
`Microsoft.NETCore.App` framework and writes generated code into `obj/`. All of
that comes from the SDK named in the first line, not from the file. This
concept opens the box: what `Sdk="Microsoft.NET.Sdk"` imports, how the implicit
globbing decides which files are compiled, how to ask MSBuild what it really
evaluated (`-getProperty`, `-getItem`, `-pp` and binary logs), how
`Directory.Build.props` and `.targets` share settings across a solution, why
evaluation order makes some of those settings silently do nothing, and how a
solution file and the `artifacts` folder fit in. Everything below was run on
SDK 10.0.100 (MSBuild 18.0.2) in throwaway projects.

## Use Cases

- Putting `Nullable`, `TreatWarningsAsErrors` and the target framework in one
  place instead of repeating them in twelve project files.
- Finding out why a stray `.cs` file broke the build, or why a file you wanted
  excluded is still compiled.
- Debugging "why does this property have this value" without guessing.
- Choosing between `Microsoft.NET.Sdk`, `.Web` and `.Worker` for a new project.
- Moving all build output out of the source tree so tools and CI know where to
  look.

## Deep Dive

### What the SDK attribute does

`<Project Sdk="Microsoft.NET.Sdk">` is shorthand for two imports: `Sdk.props`
at the very top of the file and `Sdk.targets` at the very bottom, both found
under `dotnet/sdk/10.0.100/Sdks/Microsoft.NET.Sdk/`. The properties file sets
defaults, your project body then overrides them, and the targets file defines
the build logic using the final values. Asking MSBuild for the fully expanded
project shows how much hides behind six lines:

```text
$ dotnet msbuild -pp:full.xml      # preprocess: inline every import
$ wc -l full.xml
   17147 full.xml
```

Each imported file appears in `full.xml` between comment banners with its full
path, so the file also answers "where does this value come from?". The
questions are cheaper to ask with `-getProperty` and `-getItem`, which print
the evaluated result as JSON without building:

```text
$ dotnet msbuild -getProperty:AssemblyName -getProperty:RootNamespace -getProperty:Version
{"Properties":{"AssemblyName":"c","RootNamespace":"c","Version":"1.0.0"}}
```

The assembly and namespace names come from the project file name, and
`Version` defaults to `1.0.0`. The three common SDKs differ in what they add
on top of that:

| SDK | Framework references | Extra implicit usings | Extra default items |
|---|---|---|---|
| `Microsoft.NET.Sdk` | `Microsoft.NETCore.App` | `System`, `System.IO`, `System.Linq`, `System.Net.Http`, `System.Threading`... | none |
| `Microsoft.NET.Sdk.Web` | `Microsoft.NETCore.App` and `Microsoft.AspNetCore.App` | `Microsoft.AspNetCore.*`, `Microsoft.Extensions.*`, `System.Net.Http.Json` | `appsettings*.json` as `Content` |
| `Microsoft.NET.Sdk.Worker` | `Microsoft.NETCore.App` | `Microsoft.Extensions.Hosting`, `Logging`, `Configuration`, `DependencyInjection` | none (the template adds a `Microsoft.Extensions.Hosting` package reference) |

The usings column is read from the generated `obj/Debug/net10.0/*.GlobalUsings.g.cs`
of a `dotnet new console`, `web` and `worker` project. `ImplicitUsings` is
just a switch that turns that file on, and `Nullable` is the compiler's
nullable context for the whole project.

### Implicit globbing: the file system is the project

Old project files listed every source file. SDK-style projects declare a glob
instead: the preprocessed output contains

```xml
<Compile Include="**/*$(DefaultLanguageSourceExtension)"
         Exclude="$(DefaultItemExcludes);$(DefaultExcludesInProjectFolder)"
         Condition=" '$(EnableDefaultCompileItems)' == 'true' " />
```

so every `.cs` below the project folder is compiled, in any subfolder, and
`DefaultItemExcludes` removes only `bin/`, `obj/`, `*.user`, project and
solution files, and a few editor files. A file named `Old.cs.bak` or
`Skip.txt` is not matched; a `.cs` file in an arbitrary folder is. The
experiment: a library with `A.cs`, `sub/B.cs` and a leftover
`obj_ignored/Broken.cs`.

```text
$ dotnet build
obj_ignored/Broken.cs(1,14): error CS1040: Preprocessor directives must appear as the first non-whitespace character on a line
```

`dotnet msbuild -getItem:Compile` lists exactly what the glob picked up, which
is the first thing to run when a build compiles something unexpected. The fix
is an explicit `Remove`:

```xml
<ItemGroup>
  <Compile Remove="obj_ignored/**" />
</ItemGroup>
```

After that `-getItem:Compile` shows `A.cs` and `sub/B.cs` only. Adding a
file by name that the glob already includes is an error, not a no-op:

```text
error NETSDK1022: Duplicate 'Compile' items were included. The .NET SDK includes 'Compile' items from your project directory by default. You can either remove these items from your project file, or set the 'EnableDefaultCompileItems' property to 'false' ...
```

`EnableDefaultCompileItems=false` empties the list (verified: `Compile` becomes
`[]`), and `EnableDefaultItems=false` turns off the globs for all item types.
The `Web` SDK adds a similar glob for `Content`, which is how
`appsettings.json` ends up in the item list of a web project and not in a
console one.

### Conditions, labels and who wins

A `PropertyGroup` takes a `Condition`, and `Label` is a free-text tag for
tools:

```xml
<PropertyGroup Condition="'$(Configuration)' == 'Release'" Label="Release only">
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
</PropertyGroup>
```

```text
$ dotnet msbuild -getProperty:TreatWarningsAsErrors                          -> false
$ dotnet msbuild -p:Configuration=Release -getProperty:TreatWarningsAsErrors -> true
```

Command-line properties (`-p:`) are global properties and beat anything in
the files: with `<Greeting>from-file</Greeting>` in the project,
`-p:Greeting=from-cli` evaluates to `from-cli`. Among files, the last
assignment wins, which is why the import order in the next section matters.

### Directory.Build.props and Directory.Build.targets

When MSBuild evaluates a project it looks for `Directory.Build.props` in the
project folder and then in each parent folder, and imports the first one it
finds. `Directory.Build.targets` is found the same way and imported at the end.
A typical file at the repository root:

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

With that file, `Core.csproj` can be `<Project Sdk="Microsoft.NET.Sdk" />`.
The settings are enforced: a method with `name.ToUpper()` on a `string?` fails
the build with `error CS8602: Dereference of a possibly null reference`, which
without the file would have been a warning. A binary log confirms the file was
imported into each project (`Importing project ".../Directory.Build.props" into
project ".../Microsoft.Common.props"`), and `-pp` shows its properties inline,
right before the project body.

Two behaviors surprise people, both measured here.

**Only the nearest file is imported.** A second `tests/Directory.Build.props`
hides the one at the root; the tests project then evaluates with an empty
`TargetFramework` and `TreatWarningsAsErrors=false`:

```text
{"Nullable":"","TargetFramework":"","IsTestProject":"true","TreatWarningsAsErrors":"false"}
```

Chaining is explicit, from the nested file:

```xml
<Project>
  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />
  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>
</Project>
```

and now the same query returns `Nullable=enable`, `TargetFramework=net10.0`
and `TreatWarningsAsErrors=true`. `dotnet new buildprops --inherit` generates
this import line.

**A `.props` file cannot read what the project sets.** It is evaluated before
the project body. Given the same condition in both files, only the `.targets`
version fires:

```text
<PropertyGroup Condition="'$(OutputType)' == 'Exe'"><FromProps>...    -> FromProps: ""
(the same group in Directory.Build.targets)                           -> FromTargets: "exe-in-targets"
```

The rule from the MSBuild documentation: defaults go in `.props`, anything
derived from what a project chose goes in `.targets`, and items in `.props`
let a project `Remove` them later.

`Directory.Packages.props` is found the same way and holds package versions;
that is a separate topic, covered in the concept "Central Package Management
and Package Source Mapping".

### Solutions, generated folders and ArtifactsPath

A solution only lists projects for IDEs and for `dotnet build` at the root. The
XML format `.slnx` is smaller than the old GUID-based `.sln`:

```text
$ dotnet new sln -n Demo --format slnx && dotnet sln add src/Core src/App
<Solution>
  <Folder Name="/src/">
    <Project Path="src/Core/Core.csproj" />
    <Project Path="src/App/App.csproj" />
  </Folder>
</Solution>
```

The documentation says that "starting with .NET 10" the default format of
`dotnet new sln` is `slnx`. On SDK 10.0.100 here it was not: `dotnet new sln`
wrote `Demo.sln`, the help shows `Default: sln`, and `--format slnx` was
needed. Treat the default as version-dependent and pass `--format` in
scripts. `dotnet sln migrate` converts an existing `.sln` and wrote a
`Demo.slnx` next to it.

Beside each project, a build writes `bin/Debug/net10.0/` (the `.dll`,
`.pdb`, `.deps.json`, `.runtimeconfig.json` and the apphost) and `obj/`, which
holds NuGet's `project.assets.json`, the generated `AssemblyInfo.cs` and
`GlobalUsings.g.cs`, and a reference assembly under `obj/.../ref/`. The
`InternalsVisibleTo` item of the modular monolith concept ends up in that
generated file:

```csharp
[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Core.Tests")]
```

so `Core.csproj` needs no `AssemblyInfo.cs` (see the concept "Modular Monolith
Module Boundaries").

To keep output out of the source folders, set `ArtifactsPath` in
`Directory.Build.props` (or `UseArtifactsOutput=true` for the default
location). After adding `<ArtifactsPath>$(MSBuildThisFileDirectory)artifacts</ArtifactsPath>`,
the layout was `artifacts/bin/App/debug/`, `artifacts/obj/Core/debug/` and so
on, and `src/Core` held only `Core.csproj` and its sources. `publish` and
`package` get sibling folders per the documentation, and `dotnet new
buildprops --use-artifacts` generates the file.

### Binary logs

`dotnet build -bl:build.binlog` writes a 470 KB log of everything MSBuild did.
It can be replayed through the normal loggers without building again:

```text
$ dotnet msbuild build.binlog -v:diag > replay.txt     # 154,666 lines
```

and searched for imports, property values and task parameters (here the
`TreatWarningsAsErrors=true` task parameter passed to the compiler). The
MSBuild Structured Log Viewer reads the same file in a tree view; it is a
separate tool and was not used here.

## Trade-offs

- **Implicit globbing removes ceremony and hides the file set.** Nothing in the
  project says which files compile, so a stray file in any subfolder joins the
  build. `-getItem:Compile` and `Compile Remove` are the escape hatch, and
  `EnableDefaultCompileItems=false` is the nuclear option that makes you list
  every file again.
- **Shared defaults versus project autonomy.** A root `Directory.Build.props`
  gives uniform rules, but a library that needs `Nullable` off must override it
  in its own project, and a vendored project copied into the tree silently
  inherits your settings.
  ```xml
  <PropertyGroup><Nullable>disable</Nullable></PropertyGroup>  <!-- project body wins over Directory.Build.props -->
  ```
- **One file wins, not all of them.** Nested `Directory.Build.props` files
  replace each other instead of stacking. Chain them with `GetPathOfFileAbove`
  or keep exactly one per tree.
- **Evaluation order is the main source of "my setting does nothing".** Put
  defaults in `.props` and anything that depends on a project's choice in
  `.targets`; verify with `-getProperty` instead of reading files.
- **`TreatWarningsAsErrors` everywhere is strict.** It turns analyzer upgrades
  into build breaks. A narrower option is to list codes in `WarningsAsErrors`.
- **`.slnx` is smaller and diffs well, but not every tool reads it yet.** The
  default changes across SDK versions, so pin the format explicitly.
- **`ArtifactsPath` helps tooling and breaks hard-coded paths.** Scripts that
  look for `bin/Release` next to a project stop working.

## Documentation Links

- [Customize your build, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-your-build) (doc)
- [.NET project SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview) (doc)
- [MSBuild properties for .NET SDK projects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [Artifacts output layout, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output) (doc)
- [dotnet new sln and the default templates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-new-sdk-templates) (doc)
- [MSBuild binary log, MSBuild wiki](https://github.com/dotnet/msbuild/blob/main/documentation/wiki/Binary-Log.md) (doc)
