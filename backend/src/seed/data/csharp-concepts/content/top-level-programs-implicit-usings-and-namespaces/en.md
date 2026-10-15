---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A new console project is one line of code, and `Console` resolves without a
`using`. Nothing is magic: the compiler wraps your statements in a generated
class and method, and the SDK writes a hidden file full of `global using`
directives. This concept shows what is generated, what the rules of a
top-level program are, how `ImplicitUsings`, `global using`, `using static` and
`using` aliases combine, how file-scoped namespaces work, and how to resolve a
name conflict with an alias or `global::`.

## Use Cases

- Reading a stack trace that mentions `Program.<Main>$` and knowing where it
  came from.
- Making the generated `Program` visible to a test project (integration tests
  that need the entry-point type).
- Fixing an "ambiguous reference" error caused by an implicit using.
- Keeping shared imports in one place with `global using` or `<Using>` items.
- Giving a tuple, an array or a long generic type a readable name.

## Deep Dive

### What a top-level program becomes

A file with top-level statements is compiled into an entry-point method inside
a class named `Program`, in the global namespace. The doc states the shape of
the generated method (shown as `Main` for convenience) depends on what your
code contains:

| Top-level code contains | Entry point |
|---|---|
| `await` and `return` | `static async Task<int> Main(string[] args)` |
| `await` | `static async Task Main(string[] args)` |
| `return` | `static int Main(string[] args)` |
| neither | `static void Main(string[] args)` |

That is why `args` exists without being declared, why `return 3;` sets the exit
code and why `await` works at the top. The real names are not `Main`. A program
that throws from a local function prints this stack trace in .NET 10:

```csharp
void Fail() => throw new InvalidOperationException("boom");
try { Fail(); } catch (Exception e) { Console.WriteLine(e.StackTrace); }
// at Program.<<Main>$>g__Fail|0_0()
// at Program.<Main>$(String[] args)
```

The method is `<Main>$` (a name no C# source can write) and your local
function became a compiler-named method of `Program`. In a
project with an `await`, reflection on `Program` listed `<Main>$` plus a
synthesized `<Main>` wrapper and the compiler-named local functions. The class
`Program` is `internal` by default: `typeof(Program).IsPublic` printed `False`
and `Namespace` printed an empty string.

### The rules

- Only one file in a project can have top-level statements. A second file
  fails with `CS8802: Only one compilation unit can have top-level statements`.
- You can write a method called `Main`, but it will not be the entry point, and
  the `-main` compiler option cannot select one.
- `using` directives come first. Namespaces and type declarations must come
  after the statements, and top-level statements are implicitly in the global
  namespace, so a namespace declared in the same file does not wrap them.

To make `Program` accessible from another assembly, declare a partial class in
any file:

```csharp
public partial class Program { }
```

That compiled and `typeof(Program).IsPublic` printed `True`. It is the
standard way to let a test project reference the entry-point type.

### Where `Console` comes from: ImplicitUsings

Since .NET 6, SDK-style C# projects can enable `<ImplicitUsings>enable</ImplicitUsings>`.
The SDK then generates a file in `obj/` with a `global using` for each
namespace of a default set that depends on the SDK:

- `Microsoft.NET.Sdk`: `System`, `System.Collections.Generic`, `System.IO`,
  `System.Linq`, `System.Net.Http`, `System.Threading`,
  `System.Threading.Tasks`.
- `Microsoft.NET.Sdk.Web`: that set plus `System.Net.Http.Json` and the
  ASP.NET Core and `Microsoft.Extensions` namespaces for hosting,
  configuration, dependency injection, routing and logging.
- `Microsoft.NET.Sdk.Worker`: the base set plus the `Microsoft.Extensions`
  configuration, dependency injection, hosting and logging namespaces.

The generated file in my run (`obj/Debug/net10.0/<name>.GlobalUsings.g.cs`)
held exactly the seven base namespaces as `global using System;` and so on.
You customize the set with MSBuild items:

```xml
<ItemGroup>
  <Using Include="System.Globalization" />
  <Using Include="System.Text.Json" Alias="Json" />
  <Using Include="System.Math" Static="true" />
  <Using Remove="System.Net.Http" />
</ItemGroup>
```

All four forms compiled and worked in a .NET 10 console project: a namespace,
an alias, a static import and a removal.

### global using, using static and aliases

`global using` has the effect of adding the same directive to every file of
the compilation. It must come before all non-global usings and before any
namespace or type declaration, and the order among global usings does not
matter. `using static` imports the static members and nested types of one
type, so `using static System.Console;` lets you write `WriteLine`. Both can
be combined (`global using static System.Math;`). Extension members declared
in a `using static` type become available for extension lookup, but their
names are not imported for unqualified use.

An alias names a namespace or a type. Since C# 12 the alias target can be any
type, including tuples and arrays (the doc lists pointer and other unsafe types
too):

```csharp
using Point = (int X, int Y);
using Matrix = int[,];
using Cache = System.Collections.Generic.Dictionary<string, int>;

Point p = (1, 2);
Matrix m = new int[2, 2];
Cache c = new() { ["a"] = 1 };
Console.WriteLine($"{p} {m.Length} {c.Count}");   // (1, 2) 4 1
```

An alias cannot be an open generic (`List<T>` is not allowed, `List<int>` is),
and the right-hand side of an alias must be fully qualified: it cannot use
another alias.

### File-scoped namespaces and conflicts

`namespace Acme.Billing;` (C# 10) puts the whole file in the namespace without
a nesting level. A file can have only one, and mixing it with a block
namespace fails with `CS8955`. Block namespaces remain necessary when one file
declares several namespaces.

An implicit using can create ambiguity. With `using System.Timers;` in a
project with implicit usings, this fails:

```csharp
using System.Timers;
Timer t = new(100);
// error CS0104: 'Timer' is an ambiguous reference between
// 'System.Timers.Timer' and 'System.Threading.Timer'
```

Fix it with an alias (`using Timer = System.Timers.Timer;`) or the full name.
When your own type hides a framework one, `global::` starts the lookup at the
root: with `Acme.Data.File` declared, `typeof(File)` still meant `System.IO.File`
in the top-level file, and `typeof(global::Acme.Data.File)` named yours. The
`alias::Name` form (for example `S::Socket`) works only when the left side is a
namespace alias.

## Trade-offs

- **Top-level statements remove ceremony, and hide the entry point.** Good for
  small tools and scripts; the compiler-generated `Program` surprises people
  who search for `static void Main`. Mitigation: know the `<Main>$` name in
  stack traces and use an explicit `Main` or a class when a team prefers it.
- **Implicit usings reduce noise and make the dependencies of a file invisible.**
  A reader cannot see where `Task` comes from, and a new implicit namespace
  can create ambiguity (the `Timer` example). Mitigation: keep the `<Using>`
  list short and disable `ImplicitUsings` for libraries that want explicit
  imports.
- **`global using` and `using static` shorten code and weaken it.** A static
  import of `Console` is fine in a script, while a `using static` of a type
  with common names (`Math`, `File`) makes calls ambiguous to read. Keep global
  usings in one file.
- **Aliases name shapes, not types.** `using Point = (int X, int Y);` is a
  readability tool: it creates no new type, so a `Point` and any other
  `(int, int)` are interchangeable and cannot carry behavior. Use a `record
  struct` when the name should mean something to the compiler.

## Documentation Links

- [Top-level statements, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/top-level-statements) (doc)
- [The using directive, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-directive) (doc)
- [.NET project SDK overview, implicit using directives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview#implicit-using-directives) (doc)
- [MSBuild properties for .NET SDK projects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [Namespaces, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/namespaces) (doc)
- [What's new in C# 12, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
