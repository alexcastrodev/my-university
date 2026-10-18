---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Native AOT compiles the whole application, the framework code it reaches and a
stripped-down runtime into one native executable at publish time. There is no
IL to interpret and no JIT at run time, so the process starts in milliseconds
and uses a fraction of the memory. The price is a **closed world**: everything
the program will ever execute must be visible to the compiler when you publish.
This concept measures what Native AOT buys, shows exactly what breaks and why,
and maps where ASP.NET Core and EF Core stand in .NET 10. It builds on the
trimming concept, because Native AOT always trims.

Environment: SDK 10.0.100, runtime 10.0.0, Release, `osx-arm64`, Apple M4 Max,
macOS 27, Xcode installed (`xcode-select -p` pointing to
`/Applications/Xcode.app/Contents/Developer`). Times are medians of repeated
runs on a machine shared with other builds.

## Use Cases

- Command-line tools that are launched thousands of times, where 40 ms of
  runtime startup per call adds up.
- Serverless functions and scale-to-zero containers, where cold start and memory
  are billed.
- High-density hosting: many small services per node, each with a smaller
  working set.
- Environments that forbid generating executable memory at run time, where a
  JIT cannot run at all.

## Deep Dive

### What PublishAot does

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
</PropertyGroup>
```

```bash
dotnet publish -c Release -r osx-arm64
```

The property does two things. At **build** time it turns on the trim, AOT and
single-file analyzers, so `dotnet build` already reports `IL2026` and
`IL3050`. At **publish** time it trims the app and hands the result to
**ILC**, the AOT compiler, which emits object code that the platform linker
turns into an executable. The linker is why Native AOT needs a native toolchain:
Xcode Command Line Tools on macOS, `clang` and zlib headers on Linux, the C++
workload of Visual Studio on Windows.

`dotnet run` and the debugger still use the JIT, but with the AOT feature
switches already applied (`IsDynamicCodeSupported` is `False`). That is how a
file-based app, where `PublishAot` is the default, fails at `dotnet run` with
Dapper or EF Core (see the file-based apps concept). The emulation is partial:
with the program shown under "What breaks", `dotnet run` already failed on
`Reflection.Emit` and already interpreted expression trees, but the runtime
generic instantiation and `dynamic` still worked. Only the published binary
tells the whole truth.

Cross-compilation is limited by that linker. From this Mac, `-r osx-x64`
produced a working `Mach-O 64-bit executable x86_64` (1.28 MB), but `-r
linux-x64` compiled the code and then failed at the native step:

```text
Microsoft.NETCore.Native.Unix.targets(342,5): error : Symbol stripping tool
('llvm-objcopy' or 'objcopy') not found in PATH.
```

The documentation is explicit: Native AOT does not support cross-OS
compilation. Build Linux binaries on Linux, typically in a container.

### What it buys, measured

A console app that prints four lines:

| Publish | Ships | Launch to exit | Peak RSS |
|---|---|---|---|
| framework-dependent (JIT) | 0.14 MB + shared runtime | 39 ms | 40.3 MB |
| self-contained single file (JIT) | 76.4 MB | 40 ms | 36.7 MB |
| Native AOT | 1.2 MB | 4.9 ms | 7.3 MB |

The `webapiaot` template (minimal API, `CreateSlimBuilder`, a `Todo` endpoint),
measured from process start to the first `200 OK` on `GET /todos/` and RSS
after 200 requests:

| Publish | Ships | First 200 OK | RSS | Publish time |
|---|---|---|---|---|
| framework-dependent (JIT) | 0.8 MB + shared runtime | 169 ms | 92 MB | about 1 s |
| Native AOT | 10.2 MB executable | 68 ms | 30 MB | about 9 s |

Next to each executable sits a `.dSYM` folder (6 MB for the console app, 42 MB
for the API): the native debug symbols, kept outside the binary because
`StripSymbols` is on by default. Archive them with each release, or crash
dumps from production cannot be symbolized.

### What breaks, and why

Each call below is a separate `try` in one program, run first under the JIT
and then as a Native AOT binary:

```csharp
using System.Diagnostics;
using System.Linq.Expressions;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.CompilerServices;

Console.WriteLine($"IsDynamicCodeSupported: {RuntimeFeature.IsDynamicCodeSupported}");

Try("Reflection.Emit", () =>
    AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("Gen"), AssemblyBuilderAccess.Run).GetName().Name!);

Try("MakeGenericType(known)", () => typeof(List<>).MakeGenericType(typeof(Money)).Name);

object[] values = [new Money(1m), new Celsius(20), new Note("hi")];
Try("MakeGenericType(runtime)", () => NewList(values[1]));
Try("MakeGenericType(class)", () => NewList(values[2]));

Try("dynamic", () => { dynamic d = 41; return (d + 1).ToString(); });
Try("Assembly.LoadFrom", () => Assembly.LoadFrom("Plugin.dll").FullName!);
Try("Expression.Compile", () =>
{
    Expression<Func<int, int>> square = x => x * x;
    var f = square.Compile();
    var sw = Stopwatch.StartNew();
    long sum = 0;
    for (int i = 0; i < 10_000_000; i++) sum += f(i & 1023);
    return $"{f(7)}, 10M calls in {sw.ElapsedMilliseconds} ms";
});

static string NewList(object item)
{
    var listType = typeof(List<>).MakeGenericType(item.GetType());
    var list = (System.Collections.IList)Activator.CreateInstance(listType)!;
    list.Add(item);
    return $"{listType.Name}[{item.GetType().Name}] with {list.Count} item";
}

static void Try(string label, Func<string> action)
{
    try { Console.WriteLine($"{label,-24} ok: {action()}"); }
    catch (Exception ex) { Console.WriteLine($"{label,-24} {ex.GetType().Name}: {ex.Message.Split('\n')[0]}"); }
}

readonly record struct Money(decimal Amount);
readonly record struct Celsius(int Degrees);
record Note(string Text);
```

```text
// JIT (dotnet run -c Release -p:PublishAot=false)
IsDynamicCodeSupported: True
Reflection.Emit          ok: Gen
MakeGenericType(known)   ok: List`1
MakeGenericType(runtime) ok: List`1[Celsius] with 1 item
MakeGenericType(class)   ok: List`1[Note] with 1 item
dynamic                  ok: 42
Assembly.LoadFrom        FileNotFoundException: Could not load file or assembly '.../Plugin.dll'. ...
Expression.Compile       ok: 49, 10M calls in 19 ms

// Native AOT (./out/aot/Limits)
IsDynamicCodeSupported: False
Reflection.Emit          PlatformNotSupportedException: Dynamic code generation is not supported on this platform.
MakeGenericType(known)   ok: List`1
MakeGenericType(runtime) NotSupportedException: 'System.Collections.Generic.List`1[Celsius]' is missing
                         native code or metadata. This can happen for code that is not compatible with trimming or AOT. ...
MakeGenericType(class)   ok: List`1[Note] with 1 item
dynamic                  ArgumentNullException: Value cannot be null. (Parameter 'key')
Assembly.LoadFrom        PlatformNotSupportedException: Operation is not supported on this platform.
Expression.Compile       ok: 49, 10M calls in 411 ms
```

Every failure was announced at build time: `IL3050` (`RequiresDynamicCode`) on
`DefineDynamicAssembly`, on `MakeGenericType` and on the `dynamic` binder, and
`IL2026` on `LoadFrom` and the binder. The reasons:

- **No code generation.** `Reflection.Emit` has nothing to run on. The C#
  `dynamic` binder generates code too, and failed with an unhelpful message.
- **Generics over structs are compiled per instantiation.** The JIT creates
  `List<Celsius>` on demand; ILC has to generate it in advance, and it cannot
  for a struct that only appears at run time. With `typeof(Money)` written in
  the code, the analyzer could see the argument and raised no warning. Over
  reference types, instantiations share code, which is why `List<Note>` worked
  even though `Note` was also chosen at run time.
- **No loading of assemblies.** The binary cannot load new IL, so plugins must
  be compiled into it.
- **Expression trees are interpreted.** `Compile()` still works, but the
  delegate runs on the LINQ interpreter: 411 ms against 19 ms here (443 ms in
  an earlier run), more than 20 times slower. Libraries that compile
  expressions for speed (mappers, older ORMs, validation) degrade silently
  instead of failing.

### The failure that has no warning

Removing one line from the `webapiaot` template (the registration of the JSON
source-generated context) published with **zero** trim or AOT warnings and ran
normally until the first request:

```csharp
builder.Services.ConfigureHttpJsonOptions(options =>
{
    // options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});
```

```text
GET /todos/  -> HTTP/1.1 500 Internal Server Error
System.NotSupportedException: JsonTypeInfo metadata for type 'Todo[]' was not provided by
TypeInfoResolver of type '[Microsoft.AspNetCore.OpenApi.OpenApiJsonSchemaContext]'.
```

The serializer was configured; it just had no metadata for `Todo[]`. Analyzers
see calls to reflection APIs, not missing registrations, so an AOT app needs
tests that hit every endpoint of the published binary.

### ASP.NET Core and EF Core in .NET 10

`WebApplication.CreateSlimBuilder` is the AOT-friendly host: it keeps
`appsettings` configuration, user secrets and console logging, and leaves out
hosting startup assemblies, `UseStartup`, the EventLog, Debug and EventSource
logging providers, IIS integration, HTTPS endpoints, HTTP/3 (QUIC), and regex
and alpha route constraints. HTTPS and HTTP/3 can be added back with
`UseKestrelHttpsConfiguration` and `UseQuic`. Independently, .NET 10 strips
HTTP/3 from `HttpClient` in any trimmed or AOT app unless `Http3Support` is set.

The official compatibility table for ASP.NET Core 10 lists as **supported**:
gRPC, CORS, health checks, JWT authentication, output and response caching, rate
limiting, static files and WebSockets, among others. **Partial**: minimal APIs
(the request delegate generator replaces reflection, and every body type needs a
`JsonSerializerContext`) and SignalR. **Not supported**: MVC controllers,
Blazor Server, other authentication schemes, session, SPA and OData.

EF Core is the large gap. Its documentation labels NativeAOT and precompiled
queries **experimental** and recommends against production use: queries are
precompiled into C# interceptors at publish time, dynamically composed LINQ
queries are not supported, and publishing still reports trim and AOT warnings.
Without that setup, the context fails at first use with `Model building is not
supported when publishing with NativeAOT`. In practice, an AOT service talks to
the database through ADO.NET or a source-generated mapper.

### No JIT also means no dynamic PGO

The JIT recompiles hot methods using profiles gathered while the app runs
(dynamic PGO, on by default since .NET 8). A native binary is final. That does
not automatically make it slower: in a call-bound microbenchmark (an interface
call over 1,000 objects, 50,000 times, implementation chosen at run time) the
steady-state rounds took about 25 ms under the JIT with PGO, 63 ms with
`DOTNET_TieredPGO=0`, and 14 to 24 ms as Native AOT. Benchmark your own hot
paths in both modes before deciding on throughput grounds.

### Libraries

A library declares itself ready with `<IsAotCompatible>true</IsAotCompatible>`,
which turns on the trim, single-file and AOT analyzers for its own build. In
.NET 10 the flag is also stored as assembly metadata. The documentation describes
an opt-in check for projects that enable AOT analysis,
`<VerifyReferenceAotCompatibility>true</VerifyReferenceAotCompatibility>`, that
warns with `IL3058` about every referenced assembly without that metadata. It is
opt-in because libraries built for an earlier .NET never carry it, even when they
work fine, so expect noise.

## Trade-offs

- **Startup and memory against flexibility.** 4.9 ms and 7 MB instead of 40 ms
  and 40 MB for a console app, in exchange for no `Reflection.Emit`, no
  `dynamic`, no plugins and no runtime-only generic instantiations.
- **Warnings are the contract.** No AOT warnings means the binary should behave
  like the JIT app; any warning is a potential runtime exception. Make them
  errors (with this, the publish of the program above failed with
  `error IL3050` and `error IL2026`).
  ```xml
  <PublishAot>true</PublishAot>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  ```
- **Some failures have no warning.** A missing `JsonSerializerContext`
  registration published clean and returned 500. Test the published binary.
- **Expression-heavy libraries slow down instead of failing.** Interpreted
  expressions ran more than 20 times slower here.
- **Build cost and per-OS pipelines.** About 9 s instead of 1 s for the API, a
  native toolchain on every build agent, and one Linux build machine or
  container per Linux target.
- **Ecosystem limits.** MVC, Blazor Server and production EF Core are out;
  minimal APIs, gRPC and worker services are in.
- **Symbols live outside the binary.** Keep the `.dSYM`, `.dbg` or `.pdb` of every
  release, or production crash dumps are unreadable.

## Lab

In this lab you see what Native AOT demands of your code without ever running the native compiler. You receive the structure ready and `Snippets.cs` with code snippets already written, some deliberately hostile to AOT. In `AotFiles`, the methods throw `NotImplementedException` and return text: project files and small C# files. The core idea is to predict which warning (`IL2026` or `IL3050`) each risky snippet raises, replace the risky code with AOT-safe code, and realize that the analyzer is the day-to-day tool, while the real publish stays as a manual follow-up.

**The scenario**

The problem is finding out, at build time, what would break in a native binary.

- `AotFiles.cs`: the methods to implement (projects and C# snippets).
- `Snippets.cs` (given): `MakeGenericType`, `LoadFrom`, `JsonReflection` (AOT-hostile), `SlowFactory` (annotated with `[RequiresDynamicCode]`) and `Clean` (no problem).
- `AotTests.cs` and `AotSandbox.cs`: write your text into a throwaway folder and use the .NET CLI in two ways: `dotnet msbuild -getProperty` to evaluate a project and `dotnet build` of a library with the analyzers on, reading the warnings.

The tests refuse to build any project that sets `PublishAot`, because a native publish would download ILCompiler and need a native toolchain.

**What you will do, step by step**

1. **Project with PublishAot (TODO-00).** In `PublishAotProject`, write a `net10.0` console project with `OutputType` `Exe` and `PublishAot` true. The tests only evaluate it: the three analyzers and `PublishTrimmed` must follow from it, and `InvariantGlobalization` must not.
2. **Compatible library (TODO-01).** In `AotCompatibleLibrary`, use `IsAotCompatible` instead of `PublishAot`: analyzers on, nothing published.
3. **Predict the warnings (TODO-02).** In `WarningIdsForMakeGenericType`, `WarningIdsForLoadFrom` and `WarningIdsForJsonReflection`, return the ids you expect. The test builds the three snippets and compares with the real output.
4. **Safe JSON (TODO-03).** In `JsonSourceGeneratedSnippet`, write a `record Todo`, a `TodoJsonContext` with `[JsonSerializable]` and a `TodoJson` with `ToJson` and `FromJson` using `TodoJsonContext.Default.Todo`. No warnings, and the compiled library must round-trip.
5. **Generics the compiler can see (TODO-04).** In `GenericFactorySnippet`, replace `MakeGenericType` and `Array.CreateInstance` with `List<T> Create<T>()` and `T[] NewArray<T>(int)`.
6. **Be honest about dynamic code (TODO-05).** In `DynamicCodeWrapperSnippet`, keep `MakeGenericType` inside a method marked `[RequiresDynamicCode]`. The warning disappears from the body and shows up on the caller that does not repeat the annotation.

**How you know you are done**

`dotnet test` is green (about 15 to 30 seconds, no network). You should be able to explain why the warning "moves" to the callers in TODO-05 and why a clean analyzer does not guarantee that the published binary works (a forgotten JSON context registration passes with no warning).

**Optional challenges**

- **TODO-06:** `StrictAotLibrary` turns `IL2026` and `IL3050` into errors with `WarningsAsErrors`.
- **TODO-07:** `GuardedFactorySnippet` calls a `[RequiresDynamicCode]` method only inside `if (RuntimeFeature.IsDynamicCodeSupported)`, a guard the analyzer understands.

**Prerequisites:** the concept text on Native AOT, basic `.csproj` structure and what a NuGet-free class library looks like, and the .NET 10 SDK (10.0.100).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The methods in `src/NativeAotLab/AotFiles.cs` start by throwing `NotImplementedException` with a `TODO-NN` comment, so the red tests are your checklist. To see the analyzers on your own code, use `dotnet build -p:IsAotCompatible=true`.

## Documentation Links

- [Native AOT deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (doc)
- [Introduction to AOT warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings) (doc)
- [Native AOT cross-compilation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/cross-compile) (doc)
- [ASP.NET Core support for Native AOT, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot) (doc)
- [NativeAOT Support and Precompiled Queries (Experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [System.Text.Json source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) (doc)
