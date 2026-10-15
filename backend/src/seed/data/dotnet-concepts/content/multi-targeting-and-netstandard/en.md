---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A library on NuGet is consumed by projects you do not control: a .NET 10 web app,
a .NET 8 worker, maybe a legacy .NET Framework service. Multi-targeting builds
one project for several target frameworks and packs all outputs into a single
package, and NuGet picks the best match for each consumer. This concept shows
what that produces, how conditional compilation and polyfills fill the gaps
between targets, what `netstandard2.0` is still good for in 2026, and which C#
features do and do not follow you to an old target.

## Use Cases

- A library that must work for .NET Framework 4.8 customers and also use fast
  modern APIs on current .NET.
- Deciding between `netstandard2.0` alone and `netstandard2.0;net10.0`.
- Using a new BCL API on the modern target and a fallback on the old one.
- Using `init` setters or records in code that also compiles for
  `netstandard2.0`.
- Checking that a multi-targeted package exposes the same public API on every
  target.

## Deep Dive

### What multi-targeting produces

Replace `TargetFramework` with the plural `TargetFrameworks`. The SDK then runs
the build once per target, and `dotnet pack` puts each output in its own `lib`
folder. I packed this project with SDK 10.0.100:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>netstandard2.0;net10.0</TargetFrameworks>
    <LangVersion>latest</LangVersion>
    <PackageId>Contoso.Multi</PackageId>
    <Version>1.0.0</Version>
  </PropertyGroup>
</Project>
```

```text
lib/net10.0/Multi.dll
lib/netstandard2.0/Multi.dll
dependencies: group net10.0, group .NETStandard2.0
```

At restore time NuGet compares the consumer's target framework with those
folders and takes the nearest compatible one. To see it, the library below
exposes which branch of the code was compiled:

```csharp
public static string Describe(string text)
{
#if NET10_0_OR_GREATER
    return $"net10 path: {text.Contains('x')}";
#else
    return $"fallback path: {text.IndexOf('x') >= 0}";
#endif
}
```

Two consumers referenced the package from a local feed. The `net10.0` console
app printed `net10 path: True`. A `net8.0` console app has no `net8.0` folder in
the package, so NuGet fell back to `netstandard2.0`, and it printed
`NETSTANDARD2_0 | fallback path: True`. The first lesson: a consumer on a
version between your targets gets the older assembly, not an in-between
build. If .NET 8 users matter for performance, add `net8.0` to the list.

The SDK defines preprocessor symbols for each target (`NET10_0`,
`NETSTANDARD2_0`) and for ranges (`NET10_0_OR_GREATER`, `NET5_0_OR_GREATER`).
Prefer the `_OR_GREATER` form, because a new target you add later keeps
selecting the modern branch.

### Which targets to choose

The Microsoft guidance separates two goals. For modern APIs and features such as
trimming and Native AOT, include a recent `net` target. For breadth, add
`netstandard2.0`, which .NET Framework 4.6.1 and later and every .NET version
support. The docs also say .NET 5 and later make .NET Standard unnecessary in
most scenarios, that no new .NET Standard versions will ship, and that
`netstandard2.1` should be skipped in favor of a `net` target because .NET
Framework does not implement it. They list `netstandard2.0` as the right choice to
share code between .NET Framework and the rest of .NET. A pragmatic rule:

- Apps and internal libraries of one product: a single `net10.0`.
- Public library that .NET Framework users need: `netstandard2.0;net10.0`.
- Public library that does not need Framework: just `net10.0` (or the oldest
  supported LTS you want to reach).

The `netstandard2.0` target is not free. Its API surface is smaller (no
`Span<T>` in the box, for example), so code written for it often has to use older, less efficient
patterns than the same code on `net10.0`. The conditional
branch above is how you give modern consumers the better path.

### Polyfills and language version

Each target has a default C# version. My first build of the `netstandard2.0`
target failed on a file-scoped namespace:

```text
error CS8370: Feature 'file-scoped namespace' is not available in C# 7.3.
Please use language version 10.0 or greater.
```

`netstandard2.0` defaults to C# 7.3. The docs state that using a language
version newer than the one tied to the target framework is not supported, and
they advise against `LangVersion=latest`, since it changes with the installed
compiler. That is why the project above is a demonstration, not a
recommendation: in production, pin an explicit version such as `13.0`, and
test it. What I observed with the override: syntax-only features compile, while
features that need runtime types do not.

```csharp
public class Feat
{
    public string Name { get => field; set => field = value?.Trim() ?? ""; }
    public int Id { get; init; }
}
```

On `netstandard2.0` this compiled the `field` keyword (a C# 14 feature that is
pure compiler lowering) but failed on `init` with `CS0518: Predefined type
'System.Runtime.CompilerServices.IsExternalInit' is not defined or imported`.
The usual fix is a polyfill: declare the missing type yourself, internal and
only where the BCL lacks it.

```csharp
#if !NET5_0_OR_GREATER
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
#endif
```

With that file the project built for both targets. A type such as
`ReadOnlySpan<char>` is a different case: it failed with `CS0234` on
`netstandard2.0`, and the fix there is a package reference (`System.Memory`),
which you add conditionally with `Condition="'$(TargetFramework)' == 'netstandard2.0'"`.
I did not run that package here, so treat it as the usual direction, not a
measured result.

### Keeping the targets honest

Compiling is not the same as being compatible. A `netstandard2.0` assembly can
call an API that throws `PlatformNotSupportedException` on some runtime. Two
tools help. The platform compatibility analyzer flags such calls. And package
validation (from the previous concept) checks that a multi-targeted package
exposes consistent APIs across targets, and compares it with a baseline
version. Keep the assembly name identical across targets: the guidance warns
that different names per target can break consumers.

## Trade-offs

- **More targets, more reach**, but every extra `#if` is a code path that needs
  its own tests; run the test suite against each target with
  `dotnet test -f net10.0` and another framework you ship.
- **`netstandard2.0` as fallback** serves .NET Framework, but it caps the API
  surface; the modern target lets you use newer APIs where they exist.
- **Polyfills** let you use `init`, records or `Index` on old targets, but they
  are your own copies of BCL types, so keep them `internal` and compiled only
  where the BCL lacks them.
- **A forced `LangVersion`** gives new syntax on old targets, but the docs call
  it unsupported, and a feature that needs a runtime type breaks at compile
  time or, worse, only at run time.
- **Single `net10.0`** is simplest and enables trimming and AOT annotations,
  but excludes anyone on .NET Framework.

## Documentation Links

- [.NET Standard overview](https://learn.microsoft.com/en-us/dotnet/standard/net-standard)
- [Cross-platform targeting for .NET libraries](https://learn.microsoft.com/en-us/dotnet/standard/library-guidance/cross-platform-targeting)
- [Configure the C# language version](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version)
- [Target frameworks in SDK-style projects](https://learn.microsoft.com/en-us/dotnet/standard/frameworks)
- [Package validation overview](https://learn.microsoft.com/en-us/dotnet/fundamentals/apicompat/package-validation/overview)
