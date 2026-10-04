---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A collection that cannot change is easier to share: any thread can read it, it
can be a cache key, and no caller can break it behind your back. .NET has two
families for that, and they solve different problems. The immutable collections
in `System.Collections.Immutable` give you "modified copies" of a value: you
keep using them as data changes, and each change returns a new collection. The
frozen collections in `System.Collections.Frozen` (.NET 8) give you the fastest
possible reads of a lookup table you build once and never change. Neither is the
same thing as an `IReadOnlyList<T>`, which only restricts what one reference may
do.

## Use Cases

- A configuration or feature-flag snapshot that many threads read while another
  thread publishes a new version.
- A static lookup table, such as country codes or HTTP header names, built at
  startup and queried millions of times.
- A value object that holds a list and must stay equal to its previous state
  after other code runs.
- An undo history, where each state is a cheap modified copy of the previous one.

## Deep Dive

### Immutable collections return a new collection

Every "mutating" method of an immutable collection returns the new collection and
leaves the original untouched:

```csharp
using System.Collections.Immutable;

ImmutableList<int> a = [1, 2, 3];       // collection expression, C# 12
ImmutableList<int> b = a.Add(4);

Console.WriteLine(a.Count); // 3: unchanged
Console.WriteLine(b.Count); // 4
```

Forgetting to use the result is the classic bug: `a.Add(4);` on its own line
compiles and does nothing.

### ImmutableList versus ImmutableArray

They are built differently, so the cost profile is opposite:

```csharp
ImmutableList<int> list = ImmutableList.Create(1, 2, 3);   // balanced tree
ImmutableArray<int> array = ImmutableArray.Create(1, 2, 3); // wraps a plain array

var x = list[1];    // O(log n)
var y = array[1];   // O(1)

var l2 = list.Add(4);    // O(log n): shares most of the tree with `list`
var a2 = array.Add(4);   // O(n): copies the whole array
```

Use `ImmutableArray<T>` when the data is built once and read often, which is the
usual case: it is a struct with array-like speed and no extra allocation per
read. Use `ImmutableList<T>` when you really do apply many small changes to a
large collection and keep the older versions around, because the tree shares
structure instead of copying.

### Builders

When you build a collection from many items, adding one at a time to an
immutable instance allocates a new collection each time. A builder is a mutable
helper that you fill and then freeze:

```csharp
var builder = ImmutableArray.CreateBuilder<string>();
foreach (var line in File.ReadLines(path))
    builder.Add(line);

ImmutableArray<string> lines = builder.ToImmutable();
```

For a one-shot conversion from an existing sequence, `ToImmutableArray()`,
`ToImmutableList()`, and `ToImmutableDictionary(...)` do it directly.

### ImmutableDictionary and thread-safe updates

`ImmutableDictionary<TKey, TValue>` and `ImmutableHashSet<T>` follow the same
rule and are tree-based, so lookups are O(log n) rather than the near-constant
time of `Dictionary`. When several threads publish new versions of one shared
reference, `ImmutableInterlocked` applies a change with a compare-and-swap loop:

```csharp
private ImmutableDictionary<string, int> _counts = ImmutableDictionary<string, int>.Empty;

public void Increment(string key) =>
    ImmutableInterlocked.AddOrUpdate(ref _counts, key, 1, (_, old) => old + 1);
```

### Frozen collections: built once, read fast

`FrozenDictionary<TKey, TValue>` and `FrozenSet<T>` have no `Add` or `Remove`.
Creating one is deliberately expensive: it analyzes the keys and picks an
implementation tuned for them. In exchange, lookups are faster than in
`Dictionary` and `HashSet`:

```csharp
using System.Collections.Frozen;

private static readonly FrozenDictionary<string, string> Mime =
    new Dictionary<string, string>
    {
        [".html"] = "text/html",
        [".json"] = "application/json",
        [".png"]  = "image/png",
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

bool ok = Mime.TryGetValue(".JSON", out var type);
```

This fits tables created at startup in a `static readonly` field. It is the wrong
tool for a collection that is built and thrown away on every request.

### Read-only is not immutable

`IReadOnlyList<T>` is a view: whoever holds the underlying `List<T>` can still
change it, and the view sees the change. `ImmutableArray<T>` and
`FrozenSet<T>` have no such holder, so no one can change them after creation.

```csharp
var source = new List<int> { 1, 2 };
IReadOnlyList<int> view = source;
ImmutableArray<int> snapshot = [.. source];

source.Add(3);
Console.WriteLine(view.Count);     // 3: the view follows the list
Console.WriteLine(snapshot.Length); // 2: the snapshot does not
```

## Trade-offs

- **`default(ImmutableArray<T>)` is not an empty array.** It is an uninitialized
  struct, and reading `Length` or the indexer throws.
  ```csharp
  ImmutableArray<int> a = default;
  var empty = a.IsDefault;                 // true
  // a.Length -> NullReferenceException; use ImmutableArray<int>.Empty instead
  ```
- **`ImmutableArray<T>` equality compares the array reference, not the
  elements.** A record that holds one does not get value equality over the
  items.
  ```csharp
  record Tags(ImmutableArray<string> Items);
  new Tags(["a"]) == new Tags(["a"]);   // false: two different arrays
  // Compare with a.Items.SequenceEqual(b.Items) when you need element equality.
  ```
- **Frozen collections pay at creation.** `ToFrozenDictionary()` costs more than
  copying into a `Dictionary`, so it only wins when reads vastly outnumber the
  single build.
- **Immutable collections allocate on every change.** In a hot path that updates
  one large collection constantly, a `Dictionary` behind a lock can be cheaper
  than creating a new tree node chain per update.
- **Immutable collection, mutable items.** Neither family freezes the objects
  inside. A frozen set of mutable objects still lets someone change an object's
  fields, and changing a key's hash input breaks lookups.

## Documentation Links

- [Immutable collections, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable) (doc)
- [ImmutableArray<T> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablearray-1) (doc)
- [ImmutableList<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablelist-1) (doc)
- [ImmutableInterlocked class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutableinterlocked) (doc)
- [FrozenDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen.frozendictionary-2) (doc)
- [FrozenSet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen.frozenset-1) (doc)
- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
