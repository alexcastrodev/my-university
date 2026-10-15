---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

A C# project has two separate version numbers that people constantly mix up:
the language version (what syntax the compiler accepts) and the target
framework (which runtime and libraries your code runs on). The compiler ships
with the SDK, so a .NET 10 SDK can compile C# 14 code that targets .NET 8. But
only some C# features are pure compiler work. Others need a type or a runtime
capability that older frameworks do not have. This concept explains how the
default language version is chosen, how to override and inspect it, which C# 14
features survive on an old target framework (checked by compiling, not
guessed), and how preview features are opted into.

## Use Cases

- Upgrading to the .NET 10 SDK while the application still targets .NET 8, and
  wanting `field` or null-conditional assignment today.
- Reading a compile error such as "Feature 'x' is not available in C# 12.0" and
  knowing whether to change `LangVersion` or the target framework.
- Finding out which language version a build is really using on a CI machine.
- Trying a preview compiler feature in a throwaway project without leaking it
  into production code.

## Deep Dive

### The default follows the target framework, not the SDK

When you do not set `LangVersion`, the compiler picks a default from the target
framework, so that a project compiled by a newer SDK keeps the language it was
designed with. This is easy to observe with the same source file:

```xml
<!-- p.csproj, only TargetFramework changes -->
<TargetFramework>net8.0</TargetFramework>  <!-- default C# 12 -->
<TargetFramework>net9.0</TargetFramework>  <!-- default C# 13 -->
<TargetFramework>net10.0</TargetFramework> <!-- default C# 14 -->
```

Asking MSBuild for the property on a `net8.0` project with the 10.0.100 SDK
returns the effective value:

```
$ dotnet msbuild -getProperty:LangVersion
12.0        (net10.0 project: 14.0)
```

Another trick is to force a diagnostic that prints the compiler and language
version. A file that contains only `#error version` fails with:

```
error CS8304: Compiler version: '5.0.0-2.25523.111 (b0f34d51)'. Language version: 12.0.
```

(`net8.0` project, default settings; the same file in a `net10.0` project reports
14.0.) The compiler version belongs to the SDK, the language version belongs to
the project. Microsoft recommends not setting `LangVersion` at all and raising
the target framework instead, because the default is the combination the
language and the libraries were tested together.

### Overriding LangVersion

`LangVersion` accepts a number (`13.0`, `14`), `default`/`latestMajor` (newest
major version this compiler supports, ignoring the target framework),
`latest` (newest released version, including minor ones) and `preview`. Two
rules matter in practice:

- The value is capped by the compiler. With the 10.0.100 SDK, setting `LangVersion` to `15` fails with `CS1617: Invalid option '15'`, and a .NET 9 SDK
  (9.0.307) rejects `14` the same way. A newer language needs a newer SDK.
- `latest` and `default` are machine-dependent. The documentation warns against
  `latest` because two machines with different SDKs build different languages.
  Pin an explicit number if you must override, or better, pin the SDK with
  `global.json`.

### What works on an old target framework

Setting `<LangVersion>14</LangVersion>` on `net8.0` and `net9.0` projects and
compiling one small program per feature, with the 10.0.100 SDK, gave this
result (without `LangVersion` each of the C# 14 rows fails with `CS9202` or
`CS9260`, "not available in C# 12.0/13.0"):

| Feature | net8.0 | net9.0 | net10.0 |
|---|---|---|---|
| `field` keyword in accessors | works | works | works |
| Null-conditional assignment `a?.B = x` | works | works | works |
| `nameof(List<>)` | works | works | works |
| Lambda parameter modifiers `(out x) => ...` | works | works | works |
| Extension blocks `extension(string s) { ... }` | works | works | works |
| Partial constructors | works | works | works |
| User-defined compound operators (`operator +=`) | works | works | works |
| `params ReadOnlySpan<int>` (C# 13) | works | works | works |
| `allows ref struct` (C# 13) | `CS9240` runtime lacks by-ref-like generics | works | works |
| `System.Threading.Lock` (type, .NET 9) | `CS0234`, type missing | works | works |

The pattern is the rule of thumb: syntax that the compiler can lower into code
that already runs on the old runtime works everywhere, while a feature that
depends on a new runtime capability (`allows ref struct` needs runtime support
for ref-like types as generic arguments) or a new library type (`Lock`) fails
on the older framework even with the newest `LangVersion`. The language
documentation says it directly: each feature has its own minimum API or runtime
requirement.

One feature deserves a note. The implicit span conversions of C# 14 are a
language change, so an extension method written for `ReadOnlySpan<int>` can be
called on an `int[]` in a `net9.0` project only after you raise the language
version:

```csharp
int[] arr = [1, 2, 3];
Console.WriteLine(arr.Twice());   // LangVersion 14: 6
// default C# 13: error CS1929, 'int[]' does not contain a definition for 'Twice'
static class E { public static int Twice(this ReadOnlySpan<int> s) => s.Length * 2; }
```

### Preview features and EnablePreviewFeatures

Two different mechanisms are both called "preview" and they do different
things:

- `<LangVersion>preview</LangVersion>` tells the compiler to accept syntax from
  the next, unreleased language version. It compiled fine on the 10.0.100 SDK
  for a program that used nothing new. Preview syntax can change or disappear
  and is not supported in production.
- `<EnablePreviewFeatures>true</EnablePreviewFeatures>` opts in to preview
  APIs and runtime features, the ones marked with
  `[RequiresPreviewFeatures]`. Without it, using such a type produces warning
  `CA2252` ("requires opting into preview features"); with it, the code runs.

```csharp
using System.Runtime.Versioning;
Foo.Bar();   // CA2252 warning unless EnablePreviewFeatures is true
[RequiresPreviewFeatures] static class Foo { public static void Bar() => Console.WriteLine("preview api"); }
```

You can also build with a newer SDK than the runtime you ship on: a project can
target `net10.0` and use a newer compiler through `LangVersion`, as long as the
features used are compiler-only, and the SDK is pinned in `global.json` so the
team agrees on it.

### Standard versus implementation

C# is specified separately from Roslyn, the compiler that implements it. The
ECMA-334 editions linked from Microsoft Learn stop at the C# 7 era, and later
versions are described by the Microsoft-maintained language specification and by
the feature proposals in the `csharplang` repository. In
practice Roslyn is the reference: a feature exists when Roslyn ships it, and
each "What's new in C# N" page is the proof for a version claim.

## Trade-offs

- **Raising `LangVersion` on an old target framework buys syntax, not
  libraries.** Most C# 14 syntax works on `net8.0`, but a feature that needs a
  runtime or library capability fails at compile time or, worse, only on some
  machines. Test with the lowest framework you support.
  ```csharp
  static T Id<T>(T t) where T : allows ref struct => t; // net8.0: CS9240
  ```
- **Leaving `LangVersion` unset is the safe default but feels slow.** You get
  C# 12 on a .NET 8 project even with the .NET 10 SDK, and you must raise the
  target framework to move on. The upside is that every contributor sees the same
  language regardless of installed SDK.
- **`latest` and `preview` make builds depend on the machine.** Two developers
  with different SDKs can disagree on whether the code compiles. Pin the SDK in
  `global.json` if you use them.
  ```json
  { "sdk": { "version": "10.0.100", "rollForward": "disable" } }
  ```
- **Preview syntax is a bet.** It can change before release, and code written
  for it may stop compiling. Keep it in exploration projects.
- **Multi-targeting multiplies the test matrix.** A library that targets
  `net8.0` and `net10.0` with a high `LangVersion` must be compiled and tested
  for each target, because a feature can compile for one target and fail for another.

## Documentation Links

- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [Compiler options for language feature rules (LangVersion), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [MSBuild properties for .NET SDK projects (EnablePreviewFeatures), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [CA2252: Opt in to preview features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2252) (doc)
