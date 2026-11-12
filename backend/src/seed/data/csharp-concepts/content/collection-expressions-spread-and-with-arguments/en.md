---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A collection expression, `[1, 2, 3]`, builds whatever collection the target type
asks for, and `..` spreads another sequence into it. C# 12 introduced both;
C# 15 (the .NET 11 SDK) added a first element `with(...)` that passes arguments to
the constructor or to the builder method, so a capacity or a comparer no longer
forces you back to `new`. This concept goes deeper than the short subsection in
`collection-interfaces-and-choosing-a-collection`: which concrete type the
compiler picks for each target, what spread does, how `[CollectionBuilder]`
connects your own type, what `with(...)` accepts and rejects (with the real error
codes), and the one change that compiles silently, a method named `with` that
changes meaning when you move to C# 15. Every output below was produced on the
11.0.100 SDK.

## Use Cases

- Building a list with a known size, `List<T>` with capacity, without
  `new List<T>(n) { ... }`.
- A set or dictionary-like type that needs a comparer, such as
  `HashSet<string>` with `StringComparer.OrdinalIgnoreCase`.
- Concatenating several sequences and single items in one expression.
- Making your own collection type usable with `[...]`, including one that takes a
  label or an options argument.
- Reviewing a pull request that moves the project from C# 14 to C# 15 and
  contains helper methods named `with`.

## Deep Dive

### What the compiler builds for each target

The expression has no type of its own. The target decides, and for the interfaces
the choice is the compiler's:

```csharp
IEnumerable<int>         a = [1, 2];   // <>z__ReadOnlyArray<int>
IReadOnlyCollection<int> b = [1, 2];   // <>z__ReadOnlyArray<int>
IReadOnlyList<int>       c = [1, 2];   // <>z__ReadOnlyArray<int>
ICollection<int>         d = [1, 2];   // List<int>
IList<int>               e = [1, 2];   // List<int>
IEnumerable<int>         f = [];       // int[] (one shared empty instance)
```

The read-only interfaces get a compiler-generated read-only wrapper. It is not
mutable (`((IList<int>)c).Add(3)` throws `NotSupportedException`), although
`c is IList<int>` is `true`. The mutable ones, `ICollection<T>` and `IList<T>`, get
a real `List<T>`. Two rules follow: never cast the result back to a concrete type
you did not ask for, and choose the interface by what the caller may do, as
`collection-interfaces-and-choosing-a-collection` explains.

For concrete targets: arrays and `Span<T>`/`ReadOnlySpan<T>` are built directly,
`List<T>` is created and filled, and any type with a collection initializer
(an `IEnumerable` implementation plus a usable `Add`) works. That last rule has a
consequence worth knowing:

```csharp
Queue<int> q = [1];
// error CS1061: 'Queue<int>' does not contain a definition for 'Add'
```

`Queue<T>` and `Stack<T>` have no `Add`, so they are not valid targets. Use
`new Queue<int>([1, 2])` instead.

### Spread

`..x` evaluates the sequence and inserts its elements at that position. It works
with any `IEnumerable<T>`, an array, a span or a lazy query:

```csharp
int[] head = [1, 2, 3];
IEnumerable<int> lazy = Enumerable.Range(0, 5).Where(x => x > 0);
List<int> all = [..head, ..lazy, 9];   // 1 2 3 1 2 3 4 9
```

The lazy query is enumerated once. When the source has a known count (an array,
a `List<T>`), the compiler can size the result exactly: `[..head, 4, 5]` into a
`List<int>` has `Capacity` 5. With a lazy source it cannot, and the list grows by
doubling: `[..lazy, 9]` has `Count` 5 and `Capacity` 8. That is the situation where
`with(capacity: ...)` helps, and also the reason not to use spread on a huge
lazy sequence without thinking about the final size.

### `[CollectionBuilder]`: making your own type a target

A type that is not a `List<T>` and has no `Add` can still be a target by naming a
static factory with `[CollectionBuilder(typeof(Builder), nameof(Builder.Create))]`.
The factory takes a `ReadOnlySpan<T>` and returns the type:

```csharp
[CollectionBuilder(typeof(BagBuilder), nameof(BagBuilder.Create))]
public sealed class Bag<T> : IEnumerable<T> { /* ... */ }

public static class BagBuilder
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new("", items.ToArray());
}

Bag<int> bag = [1, 2, 3];
```

`ImmutableArray<T>` and `ImmutableList<T>` work this way, so
`ImmutableArray<int> ia = [1, 2, 3];` compiles. The span is a view over the
compiler's buffer; copy what you keep, because the buffer is not yours.

### `with(...)`: arguments for the constructor or the builder (C# 15)

A collection expression may start with one `with(...)` element. Its arguments go
to the constructor of the target, or to the builder method, before the elements:

```csharp
string[] values = ["one", "two", "three"];
List<string> names = [with(capacity: values.Length * 2), ..values];
// Count 3, Capacity 6

HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"];
// Count 1, and set.Comparer is StringComparer.OrdinalIgnoreCase

SortedSet<int> desc = [with(Comparer<int>.Create((x, y) => y.CompareTo(x))), 3, 1, 2];
// 3, 2, 1
```

Without the comparer the same set has `Count` 2 for `["Hello", "HELLO"]`.
`with()` with no arguments is allowed and means the default constructor.

For a `[CollectionBuilder]` type, the arguments go **before** the span, so you add
an overload:

```csharp
public static Bag<T> Create<T>(string label, ReadOnlySpan<T> items) => new(label, items.ToArray());

Bag<int> bag = [with("nums"), 1, 2];   // Create<int>("nums", [1, 2])
```

The compiler resolves the overload with the normal rules. A type whose only
constructor needs an argument can now be a target too: with a `NeedsArg(int n)`
constructor and an `Add`, `NeedsArg x = [with(7), 1, 2, 3];` works, while
`NeedsArg x = [1, 2, 3];` is `CS9214: Collection expression type must have an
applicable constructor that can be called with no arguments`.

What the compiler rejects, each one compiled:

| Code | When |
|---|---|
| `CS9354` | `with(...)` is not the first element: `[1, with(5)]` |
| `CS9355` | the target does not support it: arrays (`int[] a = [with(1), 1];`) and `Span<T>` |
| `CS9357` | a read-only interface with arguments: `IReadOnlyCollection<int> r = [with(1), 1];`. Only an empty `with()` is accepted |
| `CS9356` | an argument is `dynamic` |
| `CS9215` | `Dictionary<string, int> d = [with(comparer), new("a", 1)];` has no `Add` that takes one argument. Dictionary expressions (`["a": 1]`) do not exist in C# 15 |
| `CS0103` | `new List<int> { with(capacity: 5), 1 }`: it is only for collection expressions, not for collection initializers, even though one documentation page suggests otherwise |
| `CS9327` | the project is on `LangVersion` 14 |

An interface target accepts arguments when the compiler creates a mutable
collection: `IList<int> l = [with(capacity: 10), 1, 2, 3];` becomes a `List<int>`
with `Capacity` 10. For `IReadOnlyList<int>` and its siblings, only `with()` is
allowed because the generated type has nothing to configure.

### The silent change: a method named `with`

Before C# 15 a call to a method called `with` inside a collection expression was
an ordinary element. Now the same text is the arguments element. Both versions
compile, so nothing warns you:

```csharp
static int with(int x) => x * 2;
List<int> l = [with(10), 3];
```

On the 10.0.100 SDK (C# 14) this prints `2 [20,3]`: `Count` 2, a call to the
method. On the 11.0.100 SDK (C# 15) it prints `1 [3]` with `Capacity` 10: no call,
a capacity argument. Whether you get an error depends on the argument types; with
an `int` parameter and a `List<int>` target you just get different data. The fix is `@with`: `[@with(10), 3]` is `[20, 3]` again, because `@`
makes it an identifier. Rename the method if you can. With `LangVersion` 14 on the
new SDK the compiler says `CS9327` and does not guess.

New contextual keywords carry this kind of risk, as `whats-new-in-csharp-15`
explains for `closed` and `union`: search the codebase for `with(` inside
collection expressions before upgrading the SDK, not after.

### With records: do not confuse the two `with`

`record with { X = 1 }` (see `records-and-with-expressions`) is a nondestructive
mutation expression on an existing value. `[with(...), ...]` is the first element
of a collection expression and configures a new collection. They share a keyword
and nothing else.

## Trade-offs

- **The compiler picks the interface implementation.** `IEnumerable<int> x = [1,
  2];` is not a `List<int>`. Do not type-test the result, and do not expect to be
  able to add to it.
- **`with(...)` needs the C# 15 compiler, not the .NET 11 runtime.** It only
  changes what the compiler emits, so it compiles for `net8.0` to `net11.0` with
  `LangVersion` 15, but the SDK 11 is required to build. A library that still
  builds on the SDK 10 cannot use it.
- **A hidden behavior change on upgrade.** Code with a method named `with` keeps
  compiling and changes result. Grep first; use `@with` or rename.
- **Spread of a lazy sequence grows by doubling.** For a large known size, pass
  `with(capacity: n)`. For a small list it is noise: do not add capacity
  arguments everywhere.
- **Not every collection is a target.** `Queue<T>` and `Stack<T>` (no `Add`) and
  dictionaries are out. Dictionary expressions are not in C# 15, and the `with(...)`
  element is the groundwork, not the feature.
- **Builders copy.** A `[CollectionBuilder]` method receives a span over a
  temporary buffer, so a type that keeps the span must copy it.

## Lab

Build lists, sets and a custom `Bag<T>` only with collection expressions: spread, `with(capacity)`, `with(comparer)`, a builder overload that takes a label, and the `@with` fix for a method that changed meaning on C# 15.

**The scenario**

One library project (`Collections.cs`) with `Names`, `Tags`, `Sequences`, `Bag<T>` plus `BagBuilder`, and `Legacy`, and a test project. The starter has `NotImplementedException` stubs and a `Legacy.Build` that returns the wrong data on C# 15.

**What you will do, step by step**

1. **Capacity (TODO-00).** `Names.WithCapacity` with `[with(capacity: ...), ..values]`.
2. **Comparer (TODO-01).** `Tags.CaseInsensitive` with `StringComparer.OrdinalIgnoreCase`.
3. **Spread (TODO-02).** `Sequences.Combine` with two spreads and one element, and a lazy tail enumerated once.
4. **Interface with arguments (TODO-03).** `Sequences.Reserve` returns an `IList<int>` that is a `List<int>` with the capacity.
5. **Builder (TODO-04 and TODO-05).** Two `BagBuilder.Create` overloads, one of them with the `with(...)` label before the span.
6. **The silent change (TODO-06).** Fix `Legacy.Build` with `@with`.

**How you know you are done**

`dotnet test` is green with 9 tests. You should be able to explain why `IReadOnlyList<int>` rejects `with(5)` but `IList<int>` accepts it, and why `[with(10), 3]` printed `[20, 3]` before and prints `[3]` now.

**Optional challenges**

- Reproduce `CS9355`, `CS9357` and `CS9354` with one-line programs.
- Set `LangVersion` 14 in the library and read `CS9327`.

**Prerequisites:** collection expressions from C# 12, `List<T>`, `HashSet<T>` and the .NET 11 SDK (the projects target `net11.0`).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed method throws `NotImplementedException`, so red tests are your checklist.

## Documentation Links

- [Collection expressions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions) (doc)
- [Collection expression arguments, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments) (doc)
- [CollectionBuilderAttribute Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.collectionbuilderattribute) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
