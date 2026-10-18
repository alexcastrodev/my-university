---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The .NET 10 SDK can build and run a single `.cs` file with no `.csproj`:
`dotnet run app.cs`. Configuration that used to live in the project file moves
to `#:` directives at the top of the file, and the SDK generates a project in
memory to build it. That makes C# usable for scripts and small tools, but the
generated project is not a neutral one: it targets Native AOT by default, and
that default changes how the app behaves even under `dotnet run`. This concept
shows what the SDK generates, which directives exist, the AOT trap, and when to
convert the file into a real project. Everything below was run on SDK 10.0.100.

## Use Cases

- Replacing a Bash or Python script in a .NET repository with C#, using the same
  libraries the application uses.
- Trying a NuGet package or an API in seconds, without creating a project.
- Shipping a small command-line tool as one native executable.
- Starting a prototype as one file and converting it to a project when it grows.

## Deep Dive

### Running a file, with packages and properties

```csharp
#:package Humanizer@2.14.1
#:property PublishAot=false
using Humanizer;

Console.WriteLine($"Args: {string.Join(", ", args)}");
Console.WriteLine(TimeSpan.FromMinutes(90).Humanize(precision: 2));
Console.WriteLine("file based app".Pascalize());
```

```text
$ dotnet run hello.cs -- one two
Args: one, two
1 hour, 30 minutes
FileBasedApp
```

Arguments for the app go after `--`. `dotnet hello.cs a b` is a shorter form,
and `echo 'Console.WriteLine("hello from stdin");' | dotnet run -` reads the
program from standard input. The directives are:

- `#:package Name@Version` adds a `PackageReference`.
- `#:property Name=Value` sets an MSBuild property.
- `#:sdk Name` replaces the default `Microsoft.NET.Sdk`.
- `#:project path` references a project (documented; not exercised here).

Directives must come before any code; one placed after a statement fails with
`CS9297: '#:' directives cannot be after first token in file`. `#:sdk Microsoft.NET.Sdk.Web` is enough
for a minimal API:

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false

var app = WebApplication.Create(args);
app.MapGet("/ping", () => new { pong = true, at = "file-based app" });
app.Run("http://localhost:5240");
// curl http://localhost:5240/ping -> {"pong":true,"at":"file-based app"}
```

### The virtual project and the build cache

The SDK synthesizes a project from the file and builds it like any other. The
easiest way to see that project is to ask for it: `dotnet project convert
hello.cs` writes a folder `hello/` with a copy of the code, directives removed,
and this `.csproj` (the original file is left untouched):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PackAsTool>true</PackAsTool>
    <UserSecretsId>hello-fc9e4937...</UserSecretsId>
    <PublishAot>false</PublishAot>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Humanizer" Version="2.14.1" />
  </ItemGroup>
</Project>
```

The same command on a file without `#:property PublishAot=false` produces
`<PublishAot>true</PublishAot>`: that is the default. `PackAsTool` and a
`UserSecretsId` derived from the file are defaults too.

Build output does not land next to the file. On this macOS machine it went to
`~/Library/Application Support/dotnet/runfile/hello-<hash>/bin/debug/` (the
documentation describes a folder under the system temp directory, so the
location varies by platform). The SDK skips the build when nothing changed: the
first run after an edit took 0.79 s here and the next one 0.15 s.

### The AOT default reaches dotnet run

`dotnet run app.cs` still uses the JIT; it does not compile natively. But with
`PublishAot=true`, the build writes the Native AOT feature switches into the
generated `runtimeconfig.json`, among them:

```json
"System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported": false,
"System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": false,
"System.Diagnostics.Tracing.EventSource.IsSupported": false,
"System.Reflection.Metadata.MetadataUpdater.IsSupported": false
```

So code that generates code at run time fails during development, exactly as it
would in a native binary. Three runs on SDK 10.0.100 without `PublishAot=false`:

```text
// Dapper 2.1.66, db.Query<Row>("select 1 as Id, 'dapper' as Name")
IsDynamicCodeSupported: False
Unhandled exception. System.PlatformNotSupportedException: Dynamic code generation is not supported on this platform.
   at System.Reflection.Emit.DynamicMethod..ctor(...)

// EF Core 10.0.0 with SQLite, first use of the DbContext
Unhandled exception. System.InvalidOperationException: Model building is not supported when publishing with NativeAOT. Use a compiled model.

// JsonSerializer.Serialize(new Point(1, 2))
warning IL3050: Using member 'System.Text.Json.JsonSerializer.Serialize<TValue>(...)' which has 'RequiresDynamicCodeAttribute' can break functionality when AOT compiling.
Unhandled exception. System.InvalidOperationException: Reflection-based serialization has been disabled for this application.
```

With `#:property PublishAot=false` (or `dotnet run app.cs -p:PublishAot=false`)
the same three programs print `Dapper: 1 dapper`, `EF Core: 1 product(s)` and
`{"X":1,"Y":2}`. The build warnings `IL2026` and `IL3050` are the early signal:
when they appear in a file-based app, the run will probably hit a feature switch.

### Shebang: a C# file as an executable

On Unix, a shebang line and the executable bit make the file a command:

```csharp
#!/usr/bin/env -S dotnet --
// Counts non-empty lines of each file passed as argument.
foreach (var path in args)
{
    var lines = File.ReadLines(path).Count(l => l.Trim().Length > 0);
    Console.WriteLine($"{lines,6}  {path}");
}
```

```text
$ chmod +x count-lines.cs
$ ./count-lines.cs count-lines.cs ../fba/hello.cs
     8  count-lines.cs
     6  ../fba/hello.cs
```

The `--` in the shebang matters: it makes `dotnet` pass every argument to the
app. Running `./count-lines.cs --help` delivered `--help` to the program (which
then tried to open a file with that name) instead of printing the CLI help. The
documentation asks for LF line endings and no BOM in such files.

### Publishing and converting

`dotnet publish count-lines.cs` honors the AOT default and produces a native
executable in `artifacts/count-lines/` next to the file: here a 1.4 MB arm64
Mach-O binary that runs without `dotnet`, built in under 5 seconds.

`dotnet project convert` is the exit door. Use it when the script needs a second
source file, tests, or a place in a solution.

### One file, and outside project folders

In SDK 10.0.100 the app is exactly one file. A class in a sibling `greeter.cs`
is not compiled:

```text
app.cs(1,19): error CS0103: The name 'Greeter' does not exist in the current context
```

and `#:include greeter.cs` fails with `error: Unrecognized directive 'include'`.
The current documentation describes `#:include` for SDK 10.0.300 and later,
which was not available to test here.

The file also inherits its surroundings: the documentation lists
`Directory.Build.props`, `Directory.Packages.props`, `nuget.config` and
`global.json` from parent folders. A file placed in a folder that has a
`.csproj` is worse: `dotnet run side.cs` built the project instead, which
globbed `side.cs` into it and failed with `CS8802: Only one compilation unit
can have top-level statements`. Keep scripts in their own folder.

## Trade-offs

- **No project file means less ceremony and less visibility.** Defaults such as
  `PublishAot=true` and `PackAsTool=true` are invisible until you convert the
  file or read the generated `runtimeconfig.json`.
- **The AOT default protects the publish and surprises the script.** It keeps a
  file-based app publishable as a native binary, but reflection-heavy libraries
  fail under plain `dotnet run`.
  ```csharp
  #:property PublishAot=false   // first line to add before using Dapper, EF Core or reflection JSON
  ```
- **The build cache is fast but keyed on the file.** Changes to inherited build
  files can be missed; the documentation recommends `dotnet clean app.cs` when a
  build looks stale.
- **One file is a hard limit in SDK 10.0.100.** Shared helpers mean copying code
  or converting to a project; splitting needs a newer SDK.
- **A shebang ties the script to an installed SDK.** The target machine needs
  .NET 10 on `PATH`; for machines without it, publish the native binary instead.

## Lab

In this lab you learn to write C# programs that live in a single `.cs` file and run with `dotnet run app.cs`, with no project file. You receive the `Apps` class with five methods that throw `NotImplementedException`; each one must return the text of a single-file program. The tests save that text as `app.cs` in a temporary folder and run the real SDK. The core idea is to feel what the SDK does for you (it generates an implicit project) and what it hides by default (for example, that this project targets Native AOT).

**The scenario**

The problem is writing small C# scripts without project ceremony.

- `src/FileBasedAppsLab/Apps.cs`: five methods (`HelloApp`, `AppWithArgs`, `AppWithProperty`, `ShebangApp`, `AppWithCompileError`) that return source code as a string. Raw string literals (`"""`) keep the text readable.
- `FileBasedAppTests.cs`: saves the text as `app.cs`, runs `dotnet run app.cs` as a child process and checks the output and the exit code.

Each test starts the SDK, so it takes a few seconds (the whole suite takes 5 to 60 seconds, and the first run on a machine is the slowest). The lab never uses `#:package`, because that would need NuGet.

**What you will do, step by step**

1. **Hello without a project (TODO-00).** In `HelloApp`, return a program made only of top-level statements that prints exactly `hello from a file-based app`. No `Main`, no `.csproj`.
2. **Arguments and exit code (TODO-01).** In `AppWithArgs`, use the implicit `args` variable: print the arguments joined by `,` and return `args.Length` as the exit code. The test passes the arguments after `--`.
3. **Property directive (TODO-02).** In `AppWithProperty`, start with `#:property PublishAot=false` and print `RuntimeFeature.IsDynamicCodeSupported`. The test expects `True`. Notice that the fourth test runs the same probe without the directive and expects `False`: that is the Native AOT default of the generated project.
4. **Shebang (TODO-03).** In `ShebangApp`, the first line must be `#!/usr/bin/env dotnet`, followed by a program that prints `shebang ok`. The compiler accepts this as a first line (the test is skipped on Windows).
5. **Compile error (TODO-04).** In `AppWithCompileError`, return a program that does not compile (for example, using a name that does not exist). The run must exit with a non-zero code and print a `CSxxxx` error.

**How you know you are done**

`dotnet test` is green. You should be able to explain why the same line prints `False` without the directive and `True` with it, and what the SDK did so the program could run without a project.

**Optional challenges**

- **TODO-05:** the last test runs `dotnet project convert app.cs` on your `AppWithProperty`. Open the generated `app.csproj` and find `PackAsTool`, `UserSecretsId` and `PublishAot`: which did you write, and which did the SDK add?
- **TODO-06:** in a scratch folder, put a class `Greeter` in `greeter.cs` and use it from `app.cs`. On SDK 10.0.100 the build fails with `CS0103`, because the app is exactly one file. Check whether your SDK supports `#:include` before relying on it.

**Prerequisites:** C# top-level statements and raw string literals, and the .NET 10 SDK (10.0.100 or later) on your `PATH`.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Each method starts by throwing `NotImplementedException` with a `TODO-NN` comment explaining the expected program, so the red tests are your checklist.

## Documentation Links

- [File-based apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [dotnet run command, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-run) (doc)
- [Native AOT deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (doc)
- [Compilation config settings (dynamic code), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
