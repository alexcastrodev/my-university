---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

C# 14 ships with .NET 10 and is the default language version for projects that
target `net10.0`. The official "What's new in C# 14" page lists nine items.
This concept is a map, not a tutorial: each feature gets a short summary, a
minimal snippet where it helps, and a pointer to the concept that goes deep. Use
it to decide what to read next and what to look for when you upgrade a code base.

## Use Cases

- Getting the whole C# 14 picture in one sitting before reading the deep concepts.
- Planning an upgrade to the .NET 10 SDK and knowing which features can change
  behavior of existing code.
- Reviewing a pull request that uses new syntax you do not recognize yet.
- Choosing which feature to adopt first in a team style guide.

## Deep Dive

The list below follows the order of the official page. Version rules (which
features need a newer target framework) are in
`csharp-language-versions-and-preview-features`.

### Extension members

New `extension` blocks declare extension methods and also extension properties,
and extension members that look like static members of the extended type,
including user-defined operators. A block with a receiver name
(`extension(IEnumerable<int> s)`) adds instance-style members; a block with only a
type (`extension(IEnumerable<int>)`) adds static-style members. Classic `this`
extension methods keep working. A minimal check on the 10.0.100 SDK:

```csharp
static class E { extension(IEnumerable<int> s) { public int Count0 => s.Count(); } }
// new int[] { 1, 2, 3 }.Count0  prints 3
```

Deep dive: `extension-members-and-extension-blocks`.

### The field keyword

Inside a property accessor, `field` refers to a compiler-synthesized backing
field, so you can write a body for one or both accessors without declaring a
private field. It suits validation, lazy initialization (`get => field ??= ...`)
and change notification. The official page warns about one risk: a type that
already has a member called `field` can change meaning or confuse readers, and you
disambiguate with `@field` or `this.field`.

Deep dive: `properties-init-accessors-and-the-field-keyword`.

### Null-conditional assignment

`?.` and `?[]` can now be on the left side of `=` and of compound assignments. The
right side runs only when the target is not null, so `customer?.Order =
GetCurrentOrder()` never calls `GetCurrentOrder` for a null customer. Increment
and decrement (`++`, `--`) are not allowed there.

Deep dive: `operators-null-handling-and-null-conditional-assignment`.

### Implicit span conversions

The language now recognizes the relationship between `T[]`, `Span<T>` and
`ReadOnlySpan<T>` and adds implicit conversions among them. Span types can be
extension method receivers, compose with other conversions and take part in
generic type inference. Because conversions feed overload resolution, an upgrade
can pick a different overload than before; the deep concept shows the cases.

Deep dive: `span-memory-and-slicing-without-allocating`.

### Unbound generic types in nameof

`nameof` accepts an unbound generic type. `nameof(List<>)` evaluates to `List`,
and `nameof(Dictionary<,>)` to `Dictionary` (both printed on the 10.0.100 SDK).
Before C# 14 you had to close the type, as in `nameof(List<int>)`. This is the
only feature here without a dedicated concept; the small rule above is the whole
story, and the version table in
`csharp-language-versions-and-preview-features` shows it compiles on older target
frameworks.

### Simple lambda parameters with modifiers

You can put `ref`, `in`, `out`, `ref readonly` or `scoped` on a lambda parameter
without writing its type: `(text, out result) => int.TryParse(text, out result)`
now compiles when the target delegate type supplies the types. `params` still
needs an explicitly typed parameter list.

Deep dive: `local-functions-lambdas-and-closures`.

### Partial events and constructors

Instance constructors and events can be `partial`, with exactly one defining and
one implementing declaration. Only the implementing constructor declaration can
carry a `this()` or `base()` initializer, and only one partial declaration of the
type can use primary constructor syntax. The implementing declaration of an event
has `add` and `remove` accessors, while the defining one is field-like. This
mostly serves source generators.

Deep dive: `partial-types-and-partial-members`. Related:
`primary-constructors-for-classes-and-structs`.

### User-defined compound assignment operators

A type can now declare `+=`, `-=` and friends as instance methods that return
`void` and mutate the object in place, instead of relying on `x = x + y`. When the
operand is a variable and such an operator exists, the compiler uses it. A
quick run on the 10.0.100 SDK:

```csharp
class Acc {
    public int Total, Allocs;
    public void operator +=(int x) { Total += x; }
    public static Acc operator +(Acc a, int x) => new() { Total = a.Total + x, Allocs = a.Allocs + 1 };
}
// acc += 5; acc += 7;  gives Total 12 and Allocs 0: the + operator was never called
```

The motivation in the feature specification is avoiding allocation and copying
for large types. There is no dedicated concept for this feature yet; it is
described here only, and the checked-operator pairing rule lives in the
specification linked below.

### File-based app directives

The page also lists new preprocessor directives for file-based apps. The
reference says the C# compiler ignores any directive that starts with `#:` or `#!`,
while the build system reads them when you run a single file with `dotnet run
Program.cs`. They are not language syntax, so they are not part of the map above.

## Trade-offs

- **Adopting everything at once.** The features are independent, so a team can
  take them one by one. Start with ones that remove boilerplate and risk little
  (`field`, null-conditional assignment) and review the ones that change
  resolution rules (span conversions) with tests.
- **New syntax versus tooling.** Analyzers, formatters, code generators and older
  IDEs may lag. Pin the SDK with `global.json` so every machine compiles the same
  language.
- **In-place operators versus value semantics.** A `+=` that mutates is faster for
  big types but easy to misuse on shared references; keep immutable types on
  plain `+`.
- **A map is not the territory.** This page repeats only what the official page
  confirms. Behavior details, edge cases and measured output are in the linked
  concepts.

## Documentation Links

- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [The extension keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/extension) (doc)
- [Null-conditional assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/null-conditional-assignment) (doc)
- [First-class span types, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/first-class-span-types) (doc)
- [Partial members, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) (doc)
- [User-defined compound assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/user-defined-compound-assignment) (doc)
