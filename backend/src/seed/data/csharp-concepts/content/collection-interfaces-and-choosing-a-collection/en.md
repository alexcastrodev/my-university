---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Every method signature that takes or returns a sequence of items makes a
promise. `IEnumerable<T>` promises "you can walk this once", `IReadOnlyList<T>`
promises "you can index it and count it, but not change it through this
reference", and `List<T>` promises "you may change this". The common mistakes
are promising too much on input (forcing callers to build a `List<T>` to call
you), promising too little on output (returning `IEnumerable<T>` and making
callers enumerate twice to count), and confusing a read-only view with an
immutable collection. This concept covers the interface ladder, how to pick
parameter and return types, the C# 12 collection expressions, and how to choose
the concrete collection from the way you access it.

## Use Cases

- A method that only loops over its input, and should accept an array, a
  `List<T>`, a `HashSet<T>`, or a LINQ query.
- A repository method that returns a result the caller will count and index.
- A class that exposes its items without letting callers add to them behind its
  back.
- Building a short list of literals, or concatenating two lists and one extra
  item, without `new List<T> { ... }` ceremony.

## Deep Dive

### The interface ladder

Each interface adds capabilities on top of the previous one:

```csharp
IEnumerable<T>         // GetEnumerator(): walk forward, possibly lazily, no Count
IReadOnlyCollection<T> // + Count
IReadOnlyList<T>       // + this[int] indexer
ICollection<T>         // + Count, Add, Remove, Contains, Clear, CopyTo, IsReadOnly
IList<T>               // + this[int] get/set, IndexOf, Insert, RemoveAt
```

`IEnumerable<T>` can be a lazy query that touches a database or a file each
time you enumerate it, so it carries no `Count`. The read-only interfaces
(`IReadOnlyCollection<T>`, `IReadOnlyList<T>`) were added later, and they are
separate from `ICollection<T>` and `IList<T>`: the mutable interfaces do not
inherit from the read-only ones, which is why a type has to implement both.
`List<T>` and arrays implement all of them. `Dictionary<TKey, TValue>` has
`IReadOnlyDictionary<TKey, TValue>`, and `HashSet<T>` has `IReadOnlySet<T>`
(since .NET 5).

### A read-only view is not an immutable collection

An `IReadOnlyList<T>` only removes the mutating methods from the type you hold.
The object behind it may still change, and it may still be a `List<T>`:

```csharp
var items = new List<int> { 1, 2, 3 };
IReadOnlyList<int> view = items;

items.Add(4);
Console.WriteLine(view.Count);          // 4, the view sees the change
var list = (List<int>)view;             // works: nothing stops the cast
list.Clear();

var snapshot = items.ToImmutableArray(); // a real snapshot: nobody can change it
```

`ReadOnlyCollection<T>` (from `AsReadOnly()`) is a wrapper that blocks the cast
but is still a live view over the original list. `ImmutableArray<T>` and the
other types in `System.Collections.Immutable` cannot change after creation at
all. Use a view to stop accidental writes through one reference, and an
immutable type when the data itself must never change.

### Parameters: accept the most general type you need

Choose the weakest interface that lets the method do its job. If the method only
loops once, `IEnumerable<T>` accepts everything. If it needs the count up front
or indexes into the input, ask for `IReadOnlyList<T>` and say so in the
signature:

```csharp
// Only loops: any sequence works.
static decimal Total(IEnumerable<OrderLine> lines) => lines.Sum(l => l.Price * l.Quantity);

// Needs Count and indexing: callers know up front they must pass a materialized list.
static OrderLine? Median(IReadOnlyList<OrderLine> sorted) =>
    sorted.Count == 0 ? null : sorted[sorted.Count / 2];
```

Do not ask for `List<T>` or `IList<T>` just to read. It forces callers to copy
data into a list for no reason, and `IList<T>` rejects `IReadOnlyList<T>`
arguments, which are the more common type in modern code.

### Return types: be specific enough to be useful

Return the most specific type that does not leak the implementation. A method
that has already built a list should say so, so callers can use `Count` and the
indexer without enumerating again:

```csharp
// Better than IEnumerable<Order>: callers can use Count and [i] without a second pass.
public IReadOnlyList<Order> GetOpenOrders() => _orders.Where(o => o.IsOpen).ToList();

// Fine when the result really is lazy and may be large:
public IEnumerable<Order> StreamOrders() { foreach (var o in _orders) yield return o; }
```

Never return `List<T>` from a public API of a library: callers can mutate it,
and you cannot change the internal storage later without breaking them
(analyzer CA1002 flags this, but it is off by default). Expose `IReadOnlyList<T>`, `ReadOnlyCollection<T>`,
or an immutable type.

### Collection expressions and spread (C# 12)

A collection expression `[ ... ]` builds a collection of whichever type the
target asks for, and `..` spreads another sequence into it:

```csharp
int[] a = [1, 2, 3];
List<int> b = [..a, 4, 5];            // 1 2 3 4 5
IReadOnlyList<int> c = [..b, ..a];    // the compiler picks the concrete type
ReadOnlySpan<int> d = [1, 2, 3];      // can avoid a heap allocation
IEnumerable<string> none = [];        // an empty sequence, no `new`
```

The expression works with arrays, `List<T>`, `Span<T>`, `ReadOnlySpan<T>`, the
collection interfaces above, and any type with a collection initializer or a
`[CollectionBuilder]`. When the target is an interface, do not rely on the
concrete type you get: it is chosen by the compiler.

### Params collections (C# 13)

From C# 13 the `params` modifier works with more than arrays. A
`params ReadOnlySpan<T>` parameter lets callers pass a list of values without
allocating an array:

```csharp
static int Sum(params ReadOnlySpan<int> values)
{
    var total = 0;
    foreach (var v in values) total += v;
    return total;
}

Sum(1, 2, 3);        // no array allocated
Sum([4, 5, 6]);      // collection expression works too
```

### Choose the concrete collection by access pattern

| You mostly do | Reach for |
|---|---|
| Append and loop, sometimes index | `List<T>` |
| Fixed size, tight loops, interop | `T[]` |
| "Is this value in the set?" | `HashSet<T>` |
| Look up by key | `Dictionary<TKey, TValue>` |
| Share without letting callers change it | `ImmutableArray<T>` or a read-only interface over a private list |

## Trade-offs

- **`IEnumerable<T>` hides the cost of enumeration.** The caller cannot tell
  whether it is an in-memory list or a query that runs again on each pass.
  ```csharp
  IEnumerable<Order> orders = db.Orders.Where(o => o.IsOpen);
  var count = orders.Count();        // query #1
  foreach (var o in orders) { }      // query #2
  ```
  Materialize with `ToList()` once if you will use the result more than once.
- **A read-only interface is a promise about the reference, not the object.**
  A caller that casts it back to `List<T>` can mutate your internal state, so
  expose a copy, `AsReadOnly()`, or an immutable type when that matters.
- **Asking for the weakest interface can cost performance.** `IEnumerable<T>`
  forces an interface call per item, while `List<T>`, `T[]`, or
  `ReadOnlySpan<T>` iterate faster. For hot loops, take a span or an array and
  keep the general overload as a convenience.
- **Returning a concrete type locks it in.** If `GetItems()` returns
  `List<T>`, every caller may depend on it, and switching to a set later is a
  breaking change. The read-only interfaces leave you room.
- **Collection expressions hide which type you got.** `IEnumerable<int> x = [1, 2]`
  may be an array or an internal type, so never cast it to `List<int>`.

## Documentation Links

- [Collections and data structures, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/) (doc)
- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
- [Collection expressions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions) (doc)
- [params keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/params) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [CA1002: Do not expose generic lists, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1002) (doc)
