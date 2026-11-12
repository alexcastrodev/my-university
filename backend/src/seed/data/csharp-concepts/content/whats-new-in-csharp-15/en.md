---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

C# 15 ships with .NET 11, which reached general availability on 10 November 2026,
and it is the default language version for projects that target `net11.0`. The
official "What's new in C# 15" page lists six features that need no preview
switch, plus a memory safety model that is still preview. This concept is a map,
not a tutorial: each feature gets a short summary, a snippet that was compiled and
run on the 11.0.100 SDK, the error you get on C# 14, and a pointer to the concept
that goes deep. Use it to decide what to read next and what to look for when you
move a code base to the .NET 11 SDK. It follows the format of
`whats-new-in-csharp-14`.

## Use Cases

- Getting the whole C# 15 picture in one sitting before reading the deep concepts.
- Planning an upgrade to the .NET 11 SDK and knowing which features also work on
  an older target framework and which ones need the new runtime.
- Reviewing a pull request that uses `union`, `closed` or `with(...)` and you have
  not seen the syntax before.
- Answering "is X in C# 15?" for features that were announced but did not ship
  (dictionary expressions, `await?`, closed enums).

## Deep Dive

Every snippet below was compiled with the 11.0.100 SDK. The language version
rules (which feature needs which target framework, and what `LangVersion` does)
are in `csharp-language-versions-and-preview-features`. Two facts first. A project
that targets `net11.0` compiles with C# 15 by default, and `LangVersion` `16` is
rejected with CS1617. A project that targets `net10.0` stays on C# 14 even when
you build it with the .NET 11 SDK.

### Collection expression arguments

A collection expression can now start with a `with(...)` element that passes
arguments to the constructor or factory the compiler picks. It must be the first
element.

```csharp
string[] values = ["a", "b", "c"];
List<string> names = [with(capacity: values.Length * 2), .. values];
// names.Count is 3 and names.Capacity is 6

HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"];
// set.Count is 1
```

On C# 14 the compiler reports `CS9327: Feature 'collection expression arguments'
is not available in C# 14.0`. It is a compiler-only feature, so it also works on
older target frameworks when you set `LangVersion` to 15. One side effect: a
method named `with` called inside a collection expression is now read as the new
element, and `@with(...)` keeps the old meaning.

Deep dive: the subsection on collection expressions in
`collection-interfaces-and-choosing-a-collection`.

### Union types

The `union` keyword declares a type whose value is exactly one of a closed list of
case types. The compiler generates a struct with an implicit conversion from each
case type, and a `switch` that handles every case type needs no discard arm.

```csharp
record class Cat(string Name);
record class Dog(string Name);
record class Bird(string Name);
union Pet(Cat, Dog, Bird);

Pet p = new Dog("Rex");
p switch { Dog d => $"dog {d.Name}", Cat c => $"cat {c.Name}", Bird b => $"bird {b.Name}" };
// "dog Rex"; leaving Bird out gives CS8509, "the pattern 'Bird' is not covered"
```

A struct union holds its case in an `object?`, so a value-type case such as `int`
is boxed, and `default(Pet)` holds `null`: a switch with no `null` arm throws
`SwitchExpressionException` for it. On C# 14 the `union` line is a syntax error
(CS1001 and CS8803 in this file). The feature needs `UnionAttribute` and `IUnion`
from the .NET 11 runtime: on `net10.0` the declaration fails with CS0518 and
CS0656 until you add those two types yourself.

Deep dive: `union-types-in-csharp-15`. It also changes the answer in
`result-types-versus-exceptions`.

### Closed classes

A `closed` class is implicitly abstract, and only code in the same assembly can
derive from it. Because the compiler then knows every direct subclass, a switch
that handles them all is exhaustive, even though the base is `abstract`-like.

```csharp
closed record class GateState;
record class Closed : GateState;
record class Open(float Percent) : GateState;

GateState g = new Open(40f);
g switch { Closed => "closed", Open(var pct) => $"open {pct}%" };
// "open 40%", no CS8509 and no discard arm
```

The same hierarchy with `abstract` on the base and `sealed` on the children still
reports CS8509 with the pattern `'_'`, because another assembly could add a
subclass. On C# 14 the error is `CS9327: Feature 'closed classes' is not available`.
Like `union`, it relies on a type that only the .NET 11 runtime ships
(`IsClosedTypeAttribute`), so `net10.0` fails with CS0656 without a polyfill.

Deep dive: `closed-classes-and-exhaustive-hierarchies`. Related:
`type-constant-and-relational-patterns` for exhaustiveness in general.

### Extension indexers

An `extension` block, introduced in C# 14, can now declare an indexer.

```csharp
static class Ext { extension(IEnumerable<int> s) { public int this[int i] => s.ElementAt(i); } }
// new[] { 1, 2, 3, 4 }.AsEnumerable()[2] prints 3
```

On C# 14 it is `CS9327: Feature 'extension indexers' is not available`. The other
members that extension blocks still reject (fields, auto-properties, events, and
constants) report CS9282; `extension(string) { public const int Max = 5; }` is
still an error on the GA compiler.

Deep dive: `extension-members-and-extension-blocks`.

### Labeled break and continue

A label before a loop or `switch` can now be the target of `break` and `continue`
from a nested statement, which replaces the boolean flag or the `goto` that nested
loops needed.

```csharp
int visited = 0;
int[][] grid = [[1, 0, 1], [2, 3, 9], [4, 5, 6]];
outer:
for (int r = 0; r < grid.Length; r++)
{
    for (int c = 0; c < grid[r].Length; c++)
    {
        visited++;
        if (grid[r][c] == 0) continue outer;   // next row
        if (grid[r][c] == 3) break outer;      // leave both loops
    }
}
// visited is 4
```

On C# 14 it is `CS9327: Feature 'labeled break and continue' is not available`.
It is compiler-only and works on any target framework with `LangVersion` 15. This
is the one feature here without a dedicated concept: the example above is the
whole story. The label must be on a loop or `switch` that encloses the jump, and
the jump cannot cross a lambda or a local function (CS1632 and CS9393).

### Static members in interfaces on older runtimes

Interfaces can declare non-virtual `static` members (methods, `static readonly`
fields, `private static` helpers) without runtime support for default interface
methods.

```csharp
public interface IVersioned { static string Describe() => "x"; private static int n = 1; }
```

This compiled for `netstandard2.0` with `LangVersion` 15 and failed with
`CS9327: Feature 'static members in interfaces' is not available` on 14. Instance
bodies, `static abstract` and `static virtual` still need the runtime: that
boundary is described in `interfaces-explicit-implementation-and-default-methods`.
Only compilation was checked here; I did not run the result on .NET Framework.

### Memory safety rules (preview)

This is the part of the page that is not a stable C# 15 feature. The updated
memory safety model (pointer relaxations, the `unsafe(expr)` expression and the
`safe` keyword) is behind `LangVersion` `preview`, and the rules that make
`unsafe` mean "requires unsafe" are behind a second opt-in,
`<Features>$(Features);updated-memory-safety-rules</Features>`. With `LangVersion`
15 the feature is rejected with `CS8652: The feature 'updated memory safety rules'
is currently in Preview and *unsupported*`. With `preview` and
`AllowUnsafeBlocks`, `int n = 5; int* p = &n; Console.WriteLine(unsafe(*p));`
printed 5. Treat it as "what is coming", never as the current default.

Deep dive: the memory safety section of `unsafe-code-pointers-and-function-pointers`.

### What is not in C# 15

These were discussed publicly and do not exist in the GA compiler, even with
`LangVersion` `preview`:

| Feature | What the compiler says |
|---|---|
| Dictionary expressions `["a": 1]` | CS1002, CS1003, CS1022 (syntax) |
| Null-conditional await `await? t` | CS1525 |
| Chained comparison `0 < x < 10` | CS0019 (`bool` and `int`) |
| Target-typed member `DayOfWeek d = .Monday;` | CS1525 |
| Closed enums `closed enum Color` | CS0106 |
| Constants in extension blocks | CS9282 |

`closed enum` being absent means the `CS8524` warning for a switch over an enum
stays; see `enums-and-flags-enums`.

## Trade-offs

- **Stable language, young ecosystem.** `union` and `closed` are GA, but libraries
  and tools adopt them over time. System.Text.Json understands unions in .NET 11;
  check the serializer, ORM and analyzers you use before putting a union in a
  public contract.
- **Compiler-only features versus runtime-dependent ones.** `with(...)`,
  extension indexers, labeled jumps and static interface members work on older
  target frameworks with `LangVersion` 15; `union` and `closed` need types from
  the .NET 11 runtime. Decide per feature, not per version number.
- **Adding a case is a breaking change.** A new case type in a public `union` or a
  new subclass in a public `closed` class makes every consumer switch
  non-exhaustive. That is the feature, and also a versioning cost.
- **New contextual keywords.** `closed` and `union` can no longer name a type
  (`class closed { }` is CS9380), so code with lowercase type names should be
  rebuilt with the SDK 11 before the target framework changes.
- **A map is not the territory.** This page repeats what was run. Edge cases and
  measured behavior are in the linked concepts.

## Documentation Links

- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [Closed hierarchies, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/closed-hierarchies) (doc)
- [Collection expression arguments, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments) (doc)
- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [Roslyn Language Feature Status, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/Language%20Feature%20Status.md) (doc)
