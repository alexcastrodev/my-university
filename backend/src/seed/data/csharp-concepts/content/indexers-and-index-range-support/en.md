---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An indexer is a property with parameters: it lets callers write `grid[1, 2]` or
`headers["Content-Type"]` instead of calling a method. On top of indexers, C# 8
added `Index` (`^1`, "one from the end") and `Range` (`1..^1`), and the
compiler can give any type that looks like a sequence support for both without
you writing a single `Index` or `Range` overload. This concept covers how
indexers are declared and compiled, `ref` returning indexers, the exact pattern
the compiler looks for to enable `^` and `..`, which slices copy and which do
not, and the edge cases (`^0`, reversed ranges, negative indices) that throw.

## Use Cases

- Collection-like types: a matrix, a ring buffer, a paged data set, a sparse
  array, a header bag keyed by name.
- Exposing elements of a struct buffer by reference, so callers can update a
  field in place.
- Giving a custom sequence `seq[^1]` and `seq[1..^1]` for free, by providing a
  count and a `Slice` method.
- Reading the tail of a buffer or trimming a prefix and suffix without index
  arithmetic.

## Deep Dive

### Indexers are properties named Item

```csharp
class Grid(int rows, int cols)
{
    private readonly int[] cells = new int[rows * cols];
    public int this[int row, int col]
    {
        get => cells[row * cols + col];
        set => cells[row * cols + col] = value;
    }
}

var g = new Grid(3, 4);
g[1, 2] = 7;
g[1, 2];                                    // 7
typeof(Grid).GetProperties();               // Item(2): a property with 2 index parameters
```

An indexer compiles to a property called `Item` with `get_Item` and `set_Item`
accessors. Everything you know about properties applies (expression bodies,
different accessor accessibility, `virtual`, interface members, partial
indexers since C# 13), with two exceptions: there are no auto-implemented
indexers, and indexers cannot be `static` (CS0106). The parameter list is
yours: several parameters, any types, and overloads that differ by parameter
types.

```csharp
class Headers
{
    private readonly List<(string Name, string Value)> items = [];

    [IndexerName("Header")]
    public string? this[string name]
    {
        get => items.FirstOrDefault(i =>
            string.Equals(i.Name, name, StringComparison.OrdinalIgnoreCase)).Value;
        set => items.Add((name, value!));
    }

    [IndexerName("Header")]
    public string this[int i] => items[i].Value;
}

h["Content-Type"] = "text/plain";
h["content-type"];    // text/plain
h[0];                 // text/plain
h["x"];               // null
```

`[IndexerName]` renames the metadata property, which only matters for
languages without indexer syntax. All indexers in one type share one name: using
it on only one of them is CS0668.

A string indexer that returns `null` for a missing key is a design choice;
`Dictionary<TKey,TValue>` throws `KeyNotFoundException` instead and offers
`TryGetValue`. Pick one behavior and document it, because callers cannot tell
from the syntax.

### ref returning indexers

For a buffer of mutable structs, a normal indexer returns a copy, so assigning
to a field of the result does not compile:

```csharp
var list = new List<P> { new() };
list[0].X = 1;    // CS1612: Cannot modify the return value of 'List<P>.this[int]'
                  //         because it is not a variable
```

Arrays are different, because an array element is a variable. You can give your
own type the same behavior by returning a reference:

```csharp
class PointBuffer(int n)
{
    private readonly P[] items = new P[n];
    public ref P this[int i] => ref items[i];
}

pts[1].X = 42;
pts[1].X;         // 42: the element itself changed
```

A `ref` indexer has only a getter (adding a `set` is CS8147), and it hands out a reference to your
internal storage, so the caller can overwrite anything. Use it for
performance-oriented buffers, not for types that must protect invariants.
`Span<T>` exposes its elements the same way. Why struct copies bite is covered
in Value Types, Reference Types and Boxing.

### Index and Range: the values

```csharp
int[] a = [1, 2, 3, 4, 5];
Index last = ^1;
last.GetOffset(5);           // 4, so a[last] is 5
Range r = 1..^1;
r.GetOffsetAndLength(5);     // (1, 3)

a[^0..].Length;              // 0: an empty range at the end is fine
a[^0];                       // IndexOutOfRangeException: ^0 is one past the end
a[3..1];                     // ArgumentOutOfRangeException: start after end
Index bad = -1;              // ArgumentOutOfRangeException: offsets are never negative
```

`^n` means `Length - n`, so `^1` is the last element and `^0` is the position
after it, valid as the end of a range and invalid as an element. A range is
start inclusive, end exclusive, and both ends are optional (`..3`, `2..`, `..`).
`Index` and `Range` are plain structs, so you can store them, pass them, and
compare them for equality, but they are not ordered: whether `^2` comes before
`3` depends on the length.

### How a type gets ^ and .. for free

A type supports `Index` and `Range` explicitly when it declares an indexer that
takes them. Otherwise the language specification defines a pattern:

- **Countable**: an accessible `int` property named `Length` or `Count`
  (`Length` wins if both exist).
- **Implicit Index support**: countable plus an accessible indexer with a single
  `int` parameter. `x[^1]` becomes `x[x.Count - 1]`.
- **Implicit Range support**: countable plus a method `Slice(int start, int
  length)`. `x[1..^1]` becomes `x.Slice(1, x.Count - 2)`.

A type that logs its members shows the lowering:

```csharp
class LoggingSeq(int[] items)
{
    public int Count { get { Calls.Add("Count"); return items.Length; } }
    public int this[int i] { get { Calls.Add($"this[{i}]"); return items[i]; } }
    public LoggingSeq Slice(int start, int length) { /* logs, returns a copy */ }
}

log[^1];        // 50
log[1..^1];     // 20,30,40
// calls: Count this[4] Count Slice(1,3)
```

Without `Count` or `Length` the same expression is CS1503 (cannot convert
`Index` to `int`). The pattern is matched by name and shape only; the compiler
does not check that `Slice` returns what its name promises.

The same pattern is why `List<T>` now supports ranges. .NET 8 added
`List<T>.Slice(int, int)`, which returns a shallow copy, so on .NET 10
`list[1..3]` compiles and returns a new `List<int>`; writing to it leaves the
source unchanged. Some documentation pages still say `List<T>` supports indices
but not ranges: that was true before .NET 8.

Since C# 13 the implicit `^` also works in object initializers:
`new Buf3 { [^1] = 9 }` set the last of three elements.

### Copy or view: what a slice costs

| Source | `x[a..b]` returns | Cost |
|---|---|---|
| `T[]` | a new array | allocation + copy |
| `string` | a new string (`Substring`) | allocation + copy |
| `List<T>` (.NET 8+) | a new `List<T>` | allocation + copy |
| `Span<T>`, `ReadOnlySpan<T>`, `Memory<T>` | a view of the same memory | none |

```csharp
var copy = a[..3]; copy[0] = 11;              // a is still 1,2,3,4,5
Span<int> view = a.AsSpan()[..3]; view[0] = 11; // a is now 11,2,3,4,5
"hello"[1..^1];                                  // "ell", a new string
```

Ranges are readable, but on arrays and strings each one allocates. In a loop
or a parser, slice a span instead; the details are in Span, Memory and Slicing
Without Allocating.

Multi-dimensional arrays support neither: `m[^1, 0]` on an `int[,]` is CS0029,
because their indexer has several parameters. Jagged arrays (`int[][]`) work at
each level.

## Trade-offs

- **Indexers read like data access, so make them cheap.** Callers will put
  `x[i]` in a loop. An indexer that queries a database or scans a list hides a
  cost that a method name (`Find`, `Load`) would announce.
- **Missing keys need one clear rule.** Return `null`, throw, or return a
  default, and say which; a dictionary-like type should also offer `TryGet...`.
- **`ref` indexers trade safety for speed.** They avoid copies of large structs
  and allow in-place updates, but expose internal storage to every caller.
- **Implicit Range support costs whatever `Slice` costs.** A `Slice` that copies
  turns innocent-looking `x[1..]` into an allocation:
  ```csharp
  for (int i = 0; i < n; i++) Process(list[i..]);   // n list copies
  ```
- **Pattern matching is by shape.** Adding a `Count` property or a `Slice`
  method to an existing type silently enables `^` and `..` on it, with whatever
  semantics those members have.
- **`^0` and reversed ranges throw at run time.** The compiler cannot check
  offsets that depend on the length; validate input ranges at the boundary.

## Documentation Links

- [Indexers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/indexers/) (doc)
- [Explore ranges of data using indices and ranges, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/tutorials/ranges-indexes) (doc)
- [Indexes and ranges, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/ranges) (doc)
- [List<T>.Slice method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.slice) (doc)
- [The history of C# (indices and ranges in C# 8, implicit index in object initializers in C# 13), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
