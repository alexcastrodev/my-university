---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A major upgrade has two kinds of breakage. The first announces itself: a compile error,
a missing API, a package that does not restore. The second does not: the project builds,
the tests that existed still pass, and some answers are different. The .NET 10 to 11
upgrade has both, and the second kind is the dangerous one, because it needs no
retarget to show up.

This concept is a method for reading the breaking changes page and then a worked case. The case is
the 10 to 11 upgrade, with each change run before and after: on the 10.0.100 SDK
and the 10 runtime, and on the 11.0.100 SDK and the 11 runtime (macOS arm64). A companion lab starts
from a project written for .NET 10 and has you fix what breaks, guided by tests. What the
release adds is in `whats-new-in-dotnet-11`. Items that came only from Microsoft's pages
are marked "doc only".

## Use Cases

- Planning the move of a service from the .NET 10 LTS to .NET 11 and deciding what to test first.
- Reviewing a pull request that changes `net10.0` to `net11.0` and has a green build.
- Upgrading the SDK of a build server before the target framework, and knowing what that alone breaks.
- Explaining why a `net10.0` application behaved differently after a base image changed.

## Deep Dive

### Reading the breaking changes page

Microsoft keeps a page of breaking changes per release, grouped by area (core libraries,
JIT, SDK, extensions, deployment and others), and one page per change. Three questions
sort every entry:

1. **Binary, source or behavioral?** A binary change breaks an already compiled assembly.
   A source change breaks the build when you recompile. A behavioral change breaks
   nothing at all, and only the output differs. Behavioral entries are the ones that
   need a test.
2. **Where does it apply?** Some entries depend on the runtime (the base library, the JIT),
   some on the SDK (build and publish), some on the compiler version, and some only on the
   language version that a target framework selects. The same upgrade can break at
   different moments for each.
3. **Is there a switch?** Several entries name a property or a setting that restores the old
   behavior. A switch is a bridge for a deadline, and it should not be where the fix ends.

The list is also a draft for a while after release: the pages are edited, and an item
that was true in a release candidate can differ in the GA build. The default for the
optimized Native AOT publish below is an example.

### A safe order

1. Read the list for your areas and mark the behavioral entries.
2. Install the 11 SDK and build with the project still on `net10.0`. This isolates the compiler
   and the SDK from the runtime.
3. Retarget to `net11.0` on a branch, and read the warnings as well as the errors.
4. Write characterization tests for what your code relies on: rounding, conversions, file
   formats, command line parsing. A test that records today's answer is cheap and catches
   exactly the entries of the second kind.
5. Run the suite on both runtimes if you can. Then update the base image.

### Silent changes: the runtime decides

The same source was run on the SDK 10 with `net10.0` (10 runtime), and on the SDK 11 with
`net11.0` and with `net10.0` (11 runtime in both). The third run, a `net10.0` project
executed by the 11 runtime through `DOTNET_ROLL_FORWARD=Major`, printed exactly what the
`net11.0` one did.

```csharp
double d = double.Parse("300.0"), n5 = double.Parse("-5.0"), big = double.Parse("1e10");
Console.WriteLine($"byte 300.0={(byte)d} byte -5.0={(byte)n5} sbyte 1e10={(sbyte)big} short 1e10={(short)big}");
Console.WriteLine($"decimal(0.1f)={(decimal)0.1f} decimal(0.1+0.2)={(decimal)(0.1 + double.Parse("0.2"))}");
Console.WriteLine($"Round(2.675,2)={Math.Round(double.Parse("2.675"), 2)} Round(2.675m,2)={Math.Round(2.675m, 2)}");
```

The values come through `double.Parse` because the compiler folds constant expressions at
build time with its own rules, and the table lists the expressions as shorthand.

| Expression | 10 runtime | 11 runtime |
|---|---|---|
| `(byte)300.0` | `44` | `255` |
| `(byte)-5.0` | `251` | `0` |
| `(sbyte)1e10` | `-1` | `127` |
| `(short)1e10` | `-1` | `32767` |
| `(decimal)(0.1 + 0.2)` | `0.3` | `0.3000000000000000444089209850` |
| `(decimal)0.1f` | `0.1` | `0.100000001490116119384765625` |
| `Math.Round(2.675, 2)` | `2.68` | `2.67` |
| `Math.Round(1.15, 1)` | `1.2` | `1.1` |
| `Math.Round(2.675m, 2)` | `2.68` | `2.68` |

Float to small integer casts now saturate and `NaN` becomes zero. Double to decimal keeps the
exact binary value instead of about 15 significant digits. `Math.Round` on a `double`
rounds the exact binary value, so 2.675, which is really 2.67499999..., goes down. The `decimal`
overload is unchanged, which is the fix: keep money as `decimal` from the source and never
convert it from a `double`. The concepts `numeric-conversions-rounding-and-overflow` and
`numeric-types-and-binary-representation` explain the representation.

Two library changes turn a latent problem into an exception or a size:

```csharp
// a ZIP entry stored without compression, one byte flipped
using var rs = zip.Entries[0].Open();
new StreamReader(rs).ReadToEnd();
// 10 runtime: returns "hel�o world hello world", no error
// 11 runtime: InvalidDataException: The CRC32 checksum of the extracted data does not match
//             the expected value from the archive.

using (new GZipStream(ms, CompressionMode.Compress, true)) { }   // nothing written
// ms.Length: 10 runtime 0, 11 runtime 20      (DeflateStream: 0 and 2, BrotliStream: 1 and 1)
```

The first is a fix that surfaces data you were already getting wrong, so an upload
path should catch `InvalidDataException`. The second breaks any code that decides "is this
payload empty" from the length of the compressed bytes. See `compression-zip-gzip-brotli-and-tar`.

One more depends on how the program starts:

```csharp
Console.WriteLine(Environment.GetCommandLineArgs()[0]);
```

Started through the apphost (`./out/t`), the 10 runtime printed the full path of `t.dll`,
and the 11 runtime printed `./out/t`. Through a symlink named `special_name` that points at the
apphost, it printed the `.dll` path on 10 and `./special_name` on 11. With `dotnet out/t.dll`
both print the `.dll` path. `Environment.ProcessPath` is the path of the executable and did not change.
Code that builds a program name from element zero should use it. The console concept is
`console-apps-exit-codes-and-system-commandline`.

### The Native AOT publish: what the GA SDK does

The 11 SDK has an optimized publish for Native AOT that compiles but skips the full build,
so targets after `Build` and the `PostBuildEvent` do not run and `bin/` stays small. The
release candidates were reported to do this by default. The GA SDK does not: its targets
say "This optimization is opt-in in .NET 11", and `UseOptimizedPublish` defaults to `false`
for `PublishAot`. Three marker targets (before `CoreCompile`, after `Build`, and a post-build
event) were run with `dotnet publish`:

| Publish | `CoreCompile` marker | `AfterBuild` marker | `PostBuildEvent` | Files under `bin/` |
|---|---|---|---|---|
| SDK 10 | ran | ran | ran | 198 |
| SDK 11, default | ran | ran | ran | 207 |
| SDK 11, `-p:UseOptimizedPublish=true` | ran | did not run | did not run | 8 |

So today nothing breaks by default, and a pipeline that signs or copies files from a hook
will break the day someone turns the switch on. See `native-aot-and-its-limits`.

### Compiler breaks of the SDK 11

Compiler changes travel with the SDK, not with the runtime, and some also depend on the
language version of the target (C# 15 for `net11.0`). Each snippet below was built three ways:
SDK 10 with `net10.0`, SDK 11 with `net10.0` (C# 14) and SDK 11 with `net11.0` (C# 15).

**1. `with(...)` in a collection expression.** In C# 15 a first element written `with(...)`
is a list of arguments for the collection, not a call:

```csharp
List<int> xs = [with(10), 3];          // a local function named "with" returns n
Console.WriteLine($"Count={xs.Count} Capacity={xs.Capacity} first={xs[0]}");
// SDK 10 / net10.0:   Count=2 Capacity=2 first=10
// SDK 11 / net10.0:   error CS9327: Feature 'collection expression arguments' is not available in C# 14.0
// SDK 11 / net11.0:   Count=1 Capacity=10 first=3     (warning CS8321: 'with' is declared but never used)
```

That is a silent change of meaning, and the unused-function warning is the only clue. On a
type that takes no arguments it is a loud one:

```csharp
object[] xs = [with(1, 2), 3];
// SDK 11 / net11.0:   error CS9355: 'with(...)' elements are not supported for type 'object[]'
```

The fix is the verbatim identifier, `[@with(10), 3]`, which compiled on all three setups
with the original result.

**2. `CS8352`: a span that outlives its stack buffer.**

```csharp
scoped Span<int> keep = default;
foreach (var x in source)
{
    Span<int> items = [x];     // a stack buffer for this iteration
    keep = items;              // SDK 10 accepted this and printed keep.Length = 1
}
// SDK 11, both targets: error CS8352: Cannot use variable 'items' in this context because
//   it may expose referenced variables outside of their declaration scope
```

The old code was reading a buffer that no longer existed. Copy the data out inside the
iteration: `keep = items.ToArray();` with `int[] keep`.

**3. `CS7083`: `&&` between an interface and a `dynamic`.** With an interface `I1` that
declares `static operator true` and `false`, `I1 x = new C1(); dynamic y = new C1(); x && y;`
built on SDK 10 and threw at run time:

```text
RuntimeBinderException: Operator '&&' cannot be applied to operands of type 'I1' and 'C1'
```

On SDK 11 it is a compile error, on both targets: `CS7083: Expression must be implicitly
convertible to Boolean or its type 'I1' must not be an interface and must define operator
'false'.` Declaring `C1 x` fixes it: it built and printed `C1` everywhere.

**4. `CS9380`: a type named `closed`.**

```csharp
class closed { }
// SDK 10 and SDK 11 / net10.0:   warning CS8981: The type name 'closed' only contains lower-cased ascii characters
// SDK 11 / net11.0:              error CS9380: Types and aliases cannot be named 'closed'.
```

`closed` is a modifier in C# 15, so the break appears when the language version moves
to 15, not when the SDK does. `class @closed { }` keeps the CLR name `closed`, and that
name is what a serializer or a database mapping sees.

The same page lists `union` as a new contextual keyword, a `safe` modifier tied to the
preview memory safety rules, a change in `nameof(this.P)` inside attributes and a parsing
fix for a `switch` pattern. Those were not rebuilt here for this concept. The language side is in
`csharp-language-versions-and-preview-features` and `whats-new-in-csharp-15`.

### The doc-only entries

The pages list more that was not run for this concept: a named mutex that is
user-scoped by default on Unix, `IHost.RunAsync` throwing when a `BackgroundService` fails,
a restore that stops using the global packages folder to find the next best version,
new `PackageId` restrictions (`NU5052`) and changes in `Microsoft.Extensions` configuration
and options. The ASP.NET Core and EF Core ones have their own checklists:
`migrating-from-aspnet-core-10-to-11` and
`upgrading-from-ef-core-10-to-11-breaking-changes`. Run the ones that touch your code
before you trust any of them.

## Trade-offs

- **Retargeting is not the moment of risk.** The base image or the installed runtime is.
  A `net10.0` application executed by the 11 runtime printed every value of the table
  above. Pin the runtime in the image until the tests agree.
  ```csharp
  (byte)double.Parse("300.0")   // 44 on the 10 runtime, 255 on the 11 runtime
  ```
- **Compiler first, target later has a cost.** Upgrading only the SDK keeps C# 14 and still
  breaks `CS8352`, `CS7083` and `with` on `object[]`. It avoids the keyword changes of C# 15,
  so it is a useful step, and it needs a `global.json` so the build does not float.
- **A switch is not a fix.** `UseOptimizedPublish` or an `@` identifier makes the build
  green. Make sure the hook, the stored name or the rounding rule is something you decided.
- **Characterization tests pin today's behavior, including bugs.** A test that records
  the wrapped byte of the 10 runtime would be wrong on 11. Write the rule you want
  (`Math.Clamp`, a decimal parsed from text) and let the test fail on the version that
  disagrees.
  ```csharp
  (byte)Math.Clamp(300.0, 0, 255)   // 255 on every runtime
  ```
- **The list is a draft.** The optimized publish default changed between the release
  candidate and the GA build, so read the page of the build you ship and run the check
  yourself.

## Documentation Links

- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [Float to small integer conversions saturate, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/11/fp-to-small-integer) (doc)
- [Math.Round with digits, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/math-round-digits) (doc)
- [Decimal and BigInteger floating point conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/decimal-biginteger-floating-point-conversions) (doc)
- [Environment.GetCommandLineArgs and the apphost, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/environment-getcommandlineargs-apphost-invocation-name) (doc)
- [Compiler breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2011) (doc)
