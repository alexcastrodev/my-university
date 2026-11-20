---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Every `dotnet build` is a program MSBuild runs in two phases, and the build logic you can add to it is small: a `Target` with hooks and incremental rules, a handful of built-in tasks (`Exec`, `Message`, `Warning`, `Error`, `WriteLinesToFile`), items with metadata, and, when that is not enough, a task of your own. This concept covers what the SDK-style projects concept does not: why a property read in the wrong place is empty, how to hook into `CoreCompile` or `Publish`, the exact rules of `Inputs` and `Outputs` (with the numbers), batching and transforms, inline and compiled tasks and the way they are loaded, and how to find out what a build did with the binary log read from a console program instead of the GUI viewer. The import order and `-getProperty`/`-pp` are not repeated, see [SDK-Style Projects, MSBuild and Directory.Build.props](/dotnet-concepts/sdk-style-projects-msbuild-and-directory-build-props).

Versions: SDK 10.0.100 (MSBuild 18.0.2.52411, `net10.0`) and SDK 11.0.100 GA (MSBuild 18.12.2.53018, `net11.0`), `Microsoft.Build.Utilities.Core` 17.14.28, `Humanizer.Core` 2.14.1, `MSBuild.StructuredLogger` 2.3.269. Everything ran on macOS arm64 (Apple M4 Max); timings are from that machine.

## Use Cases

- Generating a source file (build info, a manifest) before `CoreCompile` and recompiling only when its inputs change.
- Putting one shared target in `Directory.Build.targets` so that every project of a repository gets it.
- Writing a build task that is too big for an inline fragment, and shipping it without breaking the build that edits it.

## Deep Dive

### Two phases: evaluation, then execution

MSBuild first evaluates the project (all properties, then all items, imports included) and only then runs targets. A property outside a target is computed during evaluation, in file order, so it sees only what was defined above it, and an item list outside a target is not yet known when properties are computed:

```xml
<PropertyGroup>
  <Early>$(Late)</Early>   <Late>set-in-body</Late>   <Files>@(Compile)</Files>
</PropertyGroup>
<Target Name="Show">
  <Message Importance="high" Text="Early=[$(Early)] Late=[$(Late)] Files=[$(Files)]" />
  <PropertyGroup><Late>changed-by-target</Late></PropertyGroup>
</Target>
```

```text
$ dotnet msbuild -getProperty:Early -getProperty:Late -getProperty:Files   (one line here)
{"Early":"","Late":"set-in-body","Files":"@(Compile)"}
$ dotnet msbuild -t:Show
  Early=[] Late=[set-in-body] Files=[Program.cs]
```

`Early` is empty because `Late` did not exist yet. `Files` is the literal text `@(Compile)` after evaluation and becomes the list only when a task reads it at execution time. Properties set inside a target change the value for later targets, and `-getProperty:Late` combined with `-t:Show` printed `changed-by-target`, the value after the targets ran, which plain `-getProperty` cannot know.

The order is visible with a trace property appended in each file (`|DBprops|csproj-body|DBtargets`) and in the line numbers of `-pp` on SDK 10.0.100: `Sdk.props` (line 9), `Microsoft.Common.props` (57), `Directory.Build.props` (92), the project body (2095), `Microsoft.Common.targets` (4885), `Directory.Build.targets` (10977), then `Microsoft.NET.Sdk.targets` (11139) and `Microsoft.NET.Publish.targets` (14714). Consequence, measured: when two files define a target with the same name, the last definition wins, silently. `BeforeBuild`, an empty hook in `Microsoft.Common.targets`, was replaced by my `Directory.Build.targets`. `PrepareForPublish` defined in the csproj and in `Directory.Build.targets` was replaced by the SDK's own (defined after both): neither of my messages ran and no warning appeared. To change an SDK target, hook around it instead of redefining it.

### Targets: hooks, order and conditions

`BeforeTargets` and `AfterTargets` attach a target to an existing one without touching it (hooks stack, unlike the old `BeforeBuild` override), `DependsOnTargets` pulls others in first, and `Condition` can switch the target off:

```xml
<Target Name="Before" BeforeTargets="CoreCompile"><Message Importance="high" Text="[Before]" /></Target>
<Target Name="After" AfterTargets="CoreCompile" DependsOnTargets="Prepare"><Message Importance="high" Text="[After] produced @(IntermediateAssembly)" /></Target>
<Target Name="Prepare"><Message Importance="high" Text="[Prepare] runs first" /></Target>
<Target Name="OnlyRelease" BeforeTargets="CoreCompile" Condition="'$(Configuration)' == 'Release'"> ... </Target>
```

```text
Debug:   [Before]  [Prepare] runs first  [After] produced obj/Debug/net10.0/Targets.dll
Release: [Before]  [OnlyRelease] only in Release  [Prepare] runs first  [After] produced obj/Release/net10.0/Targets.dll
```

An `AfterTargets` hook does not run when its target fails: with a compile error in the project only `[Before]` printed. To hook the publish step, `BeforeTargets="Publish"` ran after the build's `App -> .../bin/Release/net10.0/App.dll` line and before the copy to `publish/` (`publishing to bin/Release/net10.0/publish/`), and `$(PublishDir)` was already set there because evaluation had finished.

### Incremental builds: Inputs and Outputs

A target with `Inputs` and `Outputs` is skipped when every output is newer than every input. The log line is at normal verbosity (`-v:n`):

```xml
<Target Name="WithIO" BeforeTargets="CoreCompile" Inputs="@(Schema)" Outputs="$(IntermediateOutputPath)schemas.manifest">
  <WriteLinesToFile File="$(IntermediateOutputPath)schemas.manifest" Lines="@(Schema->'%(Filename)')" Overwrite="true" />
</Target>
```

| Situation (SDK 10.0.100; rows 1, 2, 6 and 7 repeated on 11.0.100 with the same result) | Result |
|---|---|
| first build | target runs |
| second build | `Skipping target "WithIO" because all output files are up-to-date with respect to the input files.` |
| `touch` an input, or add a new file | runs again |
| delete an input file | skipped: the manifest still lists the deleted file |
| `Inputs` without `Outputs` | `error MSB4058: The "InputsOnly" target is missing its output specification. If a target declares inputs, it must also declare outputs.` |
| `Outputs` without `Inputs`, or a target that never creates its declared output | runs on every build |
| `Inputs` is an empty list | `Skipping target "EmptyInputs" because it has no inputs.` |

So the missing-specification case is an error, not a warning, and the quiet failure is the deletion row: if removals matter, add the project file or a list file to `Inputs`. Per the incremental-builds documentation, a skipped target still evaluates its `ItemGroup` and `PropertyGroup` as if it had run (the generated source file below stays in `Compile` on the second build, which compiled), but tasks do not run, so a property set by a task `Output` is not set.

The gain, measured with a target that does `Exec sleep 1` before `CoreCompile`:

```text
                          SDK 10.0.100                 SDK 11.0.100
incremental, 1st build    BundleAssets 1047 ms         1020 ms
incremental, 2nd build    0 ms, Elapsed 00:00:00.23    0 ms, Elapsed 00:00:00.03
no Inputs/Outputs, any    1036 to 1047 ms              1018 ms
wall clock, 3 runs        0.31 to 0.32 s vs 1.35 to 1.40 s    0.18 s vs 1.18 to 1.21 s
```

### Items: Include, Remove, Update, batching and transforms

```xml
<ItemGroup>
  <Doc Include="docs/guide.md;docs/api.md;docs/old.md;notes/todo.md" />
  <Doc Remove="docs/old.md" />
  <Doc Update="docs/*.md" Kind="manual" />
  <Doc Update="notes/todo.md" Kind="note" Owner="ana" />
</ItemGroup>
<Target Name="Show">   <!-- each Message has Importance="high", omitted for width -->
  <Message Text="per file: %(Doc.Identity) kind=%(Doc.Kind) owner=[%(Doc.Owner)]" />
  <Message Text="batch: %(Doc.Kind) has @(Doc)" />
</Target>
```

```text
per file: docs/guide.md kind=manual owner=[]   (then api.md, then todo.md kind=note owner=[ana])
batch: manual has docs/guide.md;docs/api.md    (then: batch: note has notes/todo.md)
```

`@(Doc->'%(Filename)')` is a transform (one output per item, `guide;api;todo` here), and `%(Doc.Kind)` in a task parameter makes MSBuild run the task once per distinct value (batching). The same metadata notation works in an item `Condition`, `Update` sets metadata on items already in the list (globs match against their specs), and `-getItem:Doc` prints the result as JSON without building.

### Tasks you get for free: Exec, Message, Warning, Error

```text
Exec "echo hello from the shell; uname -s" ConsoleToMSBuild=true -> <Output ConsoleOutput> lines=[hello from the shell] [Darwin]
Exec "echo about to fail; exit 3"   -> error MSB3073: The command "echo about to fail; exit 3" exited with code 3.   (exit code 1, next task never ran)
Exec "exit 3" IgnoreExitCode="true" -> continued, exit=3
<Warning Code="DEMO001" Text="a custom warning" />        -> Tasks.proj(23,5): warning DEMO001: a custom warning
<Error Code="DEMO002" Condition="'$(Strict)' == 'true'" /> -> error DEMO002: a custom error   (exit code 1, later tasks skipped)
```

`Message` has `Importance` `low`, `normal` (default) and `high`. At `-v:m` only `high` showed; at `-v:n` normal and high did and `low` stayed hidden. Use `high` while debugging and `normal` for things you want in a CI log. `Exec` runs through `/bin/sh` here, so a cross-platform target needs `Condition="$([MSBuild]::IsOSPlatform('Windows'))"` (it evaluated `IsMac=True`, `IsWin=False` on this machine) or a task instead of a shell line.

### Directory.Build.targets, a generated source file and clean

Logic shared by every project belongs in `Directory.Build.targets`, which is imported after the project body (see the order above):

```xml
<Project>
  <Target Name="GenerateBuildInfo" BeforeTargets="CoreCompile" Inputs="$(MSBuildProjectFile)" Outputs="$(IntermediateOutputPath)BuildInfo.g.cs">
    <ItemGroup>
      <_Line Include="namespace Gen%3B" />
      <_Line Include="internal static class BuildInfo { public const string Project = &quot;$(MSBuildProjectName)&quot;%3B }" />
    </ItemGroup>
    <WriteLinesToFile File="$(IntermediateOutputPath)BuildInfo.g.cs" Lines="@(_Line)" Overwrite="true" />
    <ItemGroup>
      <Compile Include="$(IntermediateOutputPath)BuildInfo.g.cs" />
      <FileWrites Include="$(IntermediateOutputPath)BuildInfo.g.cs" />
    </ItemGroup>
  </Target>
</Project>
```

`%3B` is an escaped `;` (an unescaped one splits the line into two items). The class is `internal` because the target runs in both `App` and `Lib`: with `public` the build printed `warning CS0436: The type 'BuildInfo' in '.../App/obj/.../BuildInfo.g.cs' conflicts with the imported type 'BuildInfo' in 'Lib'`. `FileWrites` is what `dotnet clean` deletes: with the line, `dotnet clean` removed `obj/Debug/net10.0/BuildInfo.g.cs`, without it the file stayed. Every target in this file runs in every project that inherits it, so give the target a condition (`'$(GenerateBuildInfo)' == 'true'`) when only some projects want it. Analyzer-based gates in the same file are in [Analyzers, EditorConfig and Build Quality Gates](/dotnet-concepts/analyzers-editorconfig-and-build-quality-gates).

### Inline tasks with RoslynCodeTaskFactory

```xml
<UsingTask TaskName="Slugify" TaskFactory="RoslynCodeTaskFactory" AssemblyFile="$(MSBuildToolsPath)/Microsoft.Build.Tasks.Core.dll">
  <ParameterGroup><Text ParameterType="System.String" Required="true" /><Slug ParameterType="System.String" Output="true" /></ParameterGroup>
  <Task>
    <Using Namespace="System.Text.RegularExpressions" />
    <Code Type="Fragment" Language="cs"><![CDATA[ Slug = Regex.Replace(Text.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-'); ]]></Code>
  </Task>
</UsingTask>
<Slugify Text="  Custom Targets, Tasks &amp; Binlogs!  "><Output TaskParameter="Slug" PropertyName="Result" /></Slugify>
```

It printed `slug = custom-targets-tasks-binlogs`. `Type="Fragment"` is the body of `Execute`, `Type="Class"` takes a whole `Task` subclass with `[Required]` and `[Output]`, and `Log` is available. Measured limits: LINQ, `Regex`, and C# 13 syntax (`is > 0 and < 5`, `[1, 2, 3]`) compiled; `System.Text.Json` did not (`Reference Include="System.Text.Json"` gave `MSB3755: Could not find reference`, a path to the runtime or the reference DLL gave `CS0012: The type 'Object' is defined in an assembly that is not referenced`), and NuGet packages cannot be referenced at all. An inline task cost 0.41 to 0.43 s per run on SDK 10 (0.12 s for the same project without it) and 0.40 s against 0.16 s on SDK 11. The documentation says debugging support is limited and that `CodeTaskFactory` is C# 4.0 only, so use `RoslynCodeTaskFactory`. Anything with dependencies or tests is a compiled task.

### A compiled task: netstandard2.0, dependencies and how it is loaded

```xml
<TargetFramework>netstandard2.0</TargetFramework>
<CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
<PackageReference Include="Microsoft.Build.Utilities.Core" Version="17.14.28" PrivateAssets="all" ExcludeAssets="runtime" />
```

```csharp
public sealed class LineCounter : Task
{
    [Required] public ITaskItem[] Files { get; set; } = [];
    public int WarnAbove { get; set; } = int.MaxValue;
    [Output] public int Total { get; set; }
    public override bool Execute()
    {
        foreach (var f in Files) {
            var lines = File.ReadLines(f.ItemSpec).Count(); Total += lines;
            if (lines > WarnAbove) Log.LogWarning(null, "LC001", null, f.ItemSpec, 0, 0, 0, 0, "File has {0} lines (limit {1})", lines, WarnAbove);
        }
        return !Log.HasLoggedErrors;
    }
}
```

The consumer builds the task project first without referencing its assembly, loads the DLL by path and calls it after the compile:

```xml
<ProjectReference Include="../Tasks/BuildTasks.csproj" ReferenceOutputAssembly="false" />
<UsingTask TaskName="BuildTasks.LineCounter" AssemblyFile="$(MSBuildThisFileDirectory)../Tasks/bin/$(Configuration)/netstandard2.0/BuildTasks.dll" />
<Target Name="CountLines" AfterTargets="CoreCompile"><LineCounter Files="@(Compile)" WarnAbove="2" /></Target>
```
```text
  Program.cs: 3 lines
Program.cs : warning LC001: File has 3 lines (limit 2)
  total=38 big=Program(3);Consumer.GlobalUsings.g(8);...AssemblyAttributes(4);Consumer.AssemblyInfo(22)
```

`@(Compile)` after `CoreCompile` already includes the generated files under `obj/`, which is why four files came back. Shipping the task as a NuGet package (the `build/` and `buildTransitive` folders) is in [Packaging and Publishing a NuGet Library](/dotnet-concepts/packaging-and-publishing-a-nuget-library). Three details are measured, not obvious:

- **`PrivateAssets="all"`** keeps MSBuild's own package out of the dependency list. `dotnet pack` wrote `<dependencies><group targetFramework=".NETStandard2.0" /></dependencies>` with it and `<dependency id="Microsoft.Build.Utilities.Core" version="17.14.28" exclude="Build,Analyzers" />` without it, which would drag MSBuild into every consumer of the package.
- **Your own dependencies must sit next to the DLL.** With `Humanizer.Core` the task failed with `error MSB4018: ... System.IO.FileNotFoundException: Could not load file or assembly 'Humanizer, Version=2.14.0.0 ...'` until `CopyLocalLockFileAssemblies` was set. That alone also copied 13 DLLs of MSBuild's own closure (`System.Collections.Immutable.dll`, `System.Memory.dll`, ...); `ExcludeAssets="runtime"` on the MSBuild package left only `Humanizer.dll`. A dependency that MSBuild itself ships can hide the mistake: `Newtonsoft.Json` loaded without being copied because the SDK folder contains it.
- **Loaded task DLLs are cached by the process.** Build the same project twice with `TaskFactory="TaskHostFactory"` on the `UsingTask` and the task ran out of process (the `Exec` showed `MSBuild pid 64841`, the task logged `task pid 64873`; without the attribute both were 64810). A task host starts and ends with the build, so the DLL is never held.

The classic failure (the rebuild of `BuildTasks.dll` refused because a node still has it open) is a Windows file lock and was not reproduced on macOS. The same cause with a quieter symptom was, and it is the default in .NET 11 (last section).

### Diagnosing a build: verbosity, binary log, performance summary

`-v:n` prints `Skipping target` lines and the `Building target "X" completely.` reasons, and `-v:d` adds property reassignments and, for every target, the SDK file it comes from and which target depends on it. A binary log has all of it: `dotnet build -bl:build.binlog` wrote 473,278 bytes here (504,221 on SDK 11), `;ProjectImports=None` 182,746 bytes (the project files are not embedded), and `;ProjectImports=ZipFile` 183,157 bytes plus a zip. `dotnet msbuild build.binlog -v:diag` replays it as text. The Structured Log Viewer is a GUI and was not used. To query the log from a terminal, the `MSBuild.StructuredLogger` package reads it as an object tree:

```csharp
var build = BinaryLog.ReadBuild(args[0]);
foreach (var t in build.FindChildrenRecursive<Target>().OrderByDescending(t => t.Duration).Take(3)) Console.WriteLine($"{t.Duration.TotalMilliseconds,8:F1} ms  {t.Name}");
foreach (var m in build.FindChildrenRecursive<Message>().Where(m => m.Text.Contains("BundleAssets")).Take(2)) Console.WriteLine(m.Text);
```

```text
first build :  1038.7 ms  BundleAssets (Perf.csproj)   /  Building target "BundleAssets" completely.
second build:    18.3 ms  ProcessFrameworkReferences   /  Skipping target "BundleAssets" because all output files are up-to-date with respect to the input files.
```

The same program also listed `projects=15 targets=488 tasks=250` for a two-project build and found why a target ran: `Output file "obj/Debug/net10.0/BuildInfo.g.cs" does not exist.` It read the logs of both SDKs. Without a log, `-clp:PerformanceSummary;NoSummary` prints time per target and task (`1047 ms BundleAssets`, `1046 ms Exec` in the measurement above). `-check` runs the BuildCheck analyzers: with two projects forced into one `OutputPath`, SDK 10.0.100 printed 8 `BC0101` (`have conflicting output paths`) and 8 `BC0102` (`write the same file`). `-graph` built the two projects with a pre-computed project graph and succeeded (docs say it is experimental). `-getTargetResult:Build` prints the target's items as JSON (the output DLL and its metadata). There is no `-timeline` switch: no match in `dotnet msbuild -h` on either SDK.

### Book vs today and what .NET 11 changed

The old project format, from the .NET Framework era and many books, had one `Compile Include` per file, `Reference` items with `HintPath` into `packages\`, a `packages.config`, and explicit `Import Project="$(MSBuildExtensionsPath)\...\Microsoft.Common.props"` and `Microsoft.CSharp.targets` lines. A 28-line `Old.csproj` evaluated as `Compile = Program.cs, Properties/AssemblyInfo.cs` (a `Forgot.cs` beside it was not part of the build), `TargetFramework` empty and `TargetFrameworkVersion = v4.8`, `dotnet restore` answered `Nothing to do. None of the projects specified contain packages to restore.` for the `packages.config`, and `dotnet build` stopped with `error : The BaseOutputPath/OutputPath property is not set for project 'Old.csproj'`. Today `Sdk="Microsoft.NET.Sdk"` is those two imports, the `Compile` glob replaces the list, `PackageReference` replaces `packages.config`, and the `BeforeBuild`/`AfterBuild` overrides of old books give way to `BeforeTargets`/`AfterTargets`.

What the .NET 11 SDK changed for this topic (checked against "What's new in the SDK and tooling for .NET 11" and run on 11.0.100):

- **MSBuild Server is on by default** for `dotnet build` and `dotnet msbuild` (opt out with `DOTNET_CLI_USE_MSBUILD_SERVER=false` or `MSBUILDUSESERVER=0`). One warm process (`/nodemode:8`, the same pid for every build I ran) now hosts the builds, an inline task logged `ran in MSBuild, runtime .NET 11.0.0` instead of `dotnet`, and a task DLL stays loaded between builds: I edited the task, `dotnet build` rebuilt `BuildTasks.dll` and still printed the old message; with `MSBUILDUSESERVER=0` the new code ran, and with `TaskHostFactory` it ran on every edit. Use `TaskHostFactory` on tasks you are developing.
- **`-check` printed nothing under the server** (0 `BC0101` and 0 `BC0102` for the same projects), and printed 8 and 8 with `MSBUILDUSESERVER=0`. Not documented as far as I found, so run checks with the server off in CI until it is confirmed.
- Wildcard matching in evaluation is faster (docs: 10 to 13 percent on Windows, not measured here). `UseOptimizedPublish` stays opt-in, which matters to custom targets after `Build` (see [Upgrading to .NET 11 and Reading the Breaking Changes](/dotnet-concepts/upgrading-to-dotnet-11-and-reading-breaking-changes)).
- Binary log event filtering (`-bl:out.binlog;Exclude=Message,...`) is in the MSBuild wiki on `main` but not in the shipped 18.12.2: `MSB1029: Invalid binary logger parameter(s)` (docs only for the feature).
- Targets, items, `Exec`, incremental skipping and the evaluation results above were identical on 10.0.100 and 11.0.100.

## Trade-offs

- **Hooks are cheap, redefinitions are silent.** `BeforeTargets`/`AfterTargets` stack with other hooks, but a second target with the same name replaces the first and gives no warning, and an SDK target defined later beats yours. Name your targets with a prefix and hook around SDK targets.
- **Incremental builds are only as good as `Inputs`.** `Inputs`/`Outputs` made a 1 s step cost 0 ms, but a deleted input does not invalidate the output and a target that never writes its output runs every time. List everything that changes the result, including the project file (`Inputs="@(Schema);$(MSBuildProjectFullPath)"`).
- **A shared `Directory.Build.targets` target runs everywhere.** Great for policy, dangerous for generated code (the `CS0436` clash). Condition it on a property.
- **Inline tasks are quick to write and slow to start.** They add about 0.3 s per invocation here, have no debugger, no packages and no tests. A compiled task costs a project and a packaging story, and it is the only form that can have dependencies.
- **Binary logs are complete, so they are sensitive.** They record properties and command lines, and the wiki says only the environment variables that influence MSBuild are logged unless `MSBUILDLOGALLENVIRONMENTVARIABLES=1`, which, in the wiki's words, "reduces, but does not eliminate, the likelihood of leaking sensitive information". Treat a binlog from CI as a secret before attaching it to an issue.

## Documentation Links

- [MSBuild targets, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-targets) (doc)
- [Build incrementally, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/incremental-builds) (doc)
- [MSBuild batching, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-batching) (doc)
- [MSBuild inline tasks, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-inline-tasks) (doc)
- [UsingTask element and task factories, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/usingtask-element-msbuild) (doc)
- [Tutorial: create a custom task, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/tutorial-custom-task-code-generation) (doc)
- [MSBuild binary log, MSBuild wiki](https://github.com/dotnet/msbuild/blob/main/documentation/wiki/Binary-Log.md) (doc)
- [MSBuild Server, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-server) (doc)
- [What's new in the SDK and tooling for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/sdk) (doc)
