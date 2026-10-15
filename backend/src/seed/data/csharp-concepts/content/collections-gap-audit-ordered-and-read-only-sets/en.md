---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The collections concepts already cover interfaces, `List<T>`, `Dictionary<TKey, TValue>`,
sets, queues, sorted collections and the immutable and frozen families. This
concept closes the remaining gaps, found by auditing those five concepts against the
book's collections chapter: `OrderedDictionary<TKey, TValue>` (.NET 9, with
index-returning overloads in .NET 10), `ReadOnlySet<T>` (.NET 9), and
`EnsureCapacity` on `Queue<T>`, `Stack<T>` and `PriorityQueue<TElement, TPriority>`.
It also records the audit result, so you can see what was already covered and
which small patches were made to the older concepts.

## Use Cases

- A dictionary whose enumeration order must be the order of insertion: a form's
  fields, an ordered configuration, a JSON-like object that must round-trip in
  order.
- A cache that needs both "find by key" and "evict the entry that was inserted
  first" (position 0).
- Exposing a set from a class without letting callers mutate it.
- Pre-sizing a queue or stack that is filled in bulk, to avoid repeated growth.

## Deep Dive

### OrderedDictionary: key lookup plus a position

`OrderedDictionary<TKey, TValue>` (`System.Collections.Generic`, .NET 9) is a
dictionary that also keeps its entries in a list. The docs describe its
complexity this way: operations are similar to `List<T>`, except that lookups by
key are similar to `Dictionary<TKey, TValue>`. The book lists it under "auto-sorting"
collections, but it does not sort: it keeps insertion order, which we confirmed by
running it. If you need keys in sorted order, `SortedDictionary` is still the tool.

```csharp
var od = new OrderedDictionary<string, int>();
od["banana"] = 2; od["apple"] = 1; od.Add("cherry", 3);
Console.WriteLine(string.Join(",", od.Keys));        // banana,apple,cherry
od["banana"] = 20;                                    // update keeps the position
od.Remove("apple"); od.Add("apple", 9);
Console.WriteLine(string.Join(",", od.Keys));        // banana,cherry,apple: re-added goes last
Console.WriteLine(od.GetAt(0) + " " + od.IndexOf("cherry"));   // [banana, 20] 1
od.Insert(1, "date", 4);                              // put an entry at a position
od.SetAt(0, 777);                                     // change a value by position
od.RemoveAt(0);
```

A pitfall appears when the key type is `int`: the indexer is by key, not by position.
Position access is `GetAt` and `SetAt`, or the explicit `IList` implementation:

```csharp
var ints = new OrderedDictionary<int, string>();
ints.Add(10, "ten"); ints.Add(5, "five"); ints.Add(7, "seven");
Console.WriteLine(ints[5]);          // five   (key 5)
Console.WriteLine(ints.GetAt(0));    // [10, ten]   (position 0)
ints.Add(5, "again");                // ArgumentException: duplicate key
ints.GetAt(9);                       // ArgumentOutOfRangeException
```

Changing the dictionary during `foreach` throws `InvalidOperationException`, as with
the other collections. It implements both `IDictionary<TKey, TValue>` and
`IList<KeyValuePair<TKey, TValue>>`, plus the read-only versions of each, so you can
hand it to code that expects either shape. Per the docs, index-based operations
cost like `List<T>`, which means that inserting or removing early in a large
dictionary shifts the entries after it.

### The .NET 10 overloads that return an index

A frequent pattern is "add, or update if present", which would look the key up twice.
.NET 10 adds `TryAdd(key, value, out int index)` and
`TryGetValue(key, out value, out int index)`, so the second step can use the position:

```csharp
static void Increment(OrderedDictionary<string, int> d, string key)
{
    if (!d.TryAdd(key, 1, out int index))
    {
        int value = d.GetAt(index).Value;
        d.SetAt(index, value + 1);
    }
}
var counts = new OrderedDictionary<string, int>();
foreach (var w in "b a b c b a".Split(' ')) Increment(counts, w);
Console.WriteLine(string.Join(",", counts.Select(kv => $"{kv.Key}:{kv.Value}")));   // b:3,a:2,c:1
Console.WriteLine(counts.TryGetValue("c", out var cv, out int ci) + $" {cv} {ci}");  // True 1 2
```

The result also shows first-seen order (`b`, `a`, `c`), which is the point of the type.
The version matters, and we checked it by compiling: the same two calls fail with
`CS1501` when the project targets `net9.0`, and compile on `net10.0`. The API
reference page for `TryAdd` lists the index overload, but without saying in which
version it appeared, so rely on the compile check and the book, not on the page, when
you multi-target.

### ReadOnlySet: the set that was missing

For lists there was `ReadOnlyCollection<T>`, for dictionaries `ReadOnlyDictionary<TKey, TValue>`,
and for sets nothing but the `IReadOnlySet<T>` interface (which a caller can cast
away). .NET 9 adds `ReadOnlySet<T>`, a wrapper around an `ISet<T>`:

```csharp
var hs = new HashSet<int> { 1, 2, 3 };
var ro = new ReadOnlySet<int>(hs);
Console.WriteLine(ro.Count + " " + ro.Contains(2));          // 3 True
hs.Add(4);
Console.WriteLine(ro.Count);                                  // 4: it is a live view, not a copy
Console.WriteLine((object)ro as HashSet<int> is null);        // True: the cast to HashSet fails
((ICollection<int>)ro).Add(9);                                // NotSupportedException
Console.WriteLine(ro.IsSubsetOf([1, 2, 3, 4, 5]));            // True
```

It implements `IReadOnlySet<T>` and also `ISet<T>` and `ICollection<T>`, with the mutating
members implemented explicitly so that they throw `NotSupportedException` (we checked
`Add` and `UnionWith`). That makes it a drop-in return type for an API that must
not let callers write, and it blocks the downcast that a bare `IReadOnlySet<T>` allows.
It is still a view: whoever holds the original `HashSet<T>` can change what readers see,
the same warning that applies to `ReadOnlyCollection<T>`. If the data must never change,
use `ImmutableHashSet<T>` or `FrozenSet<T>` from the immutable and frozen concept.

### EnsureCapacity beyond List and Dictionary

The earlier concepts show `EnsureCapacity` on `List<T>` and `Dictionary<TKey, TValue>`. The
same method exists on `Queue<T>` and `Stack<T>` (the docs list it since .NET 6) and on
`PriorityQueue<TElement, TPriority>`, and it returns the resulting capacity:

```csharp
var q = new Queue<int>();               Console.WriteLine(q.EnsureCapacity(100) >= 100);    // True
var st = new Stack<int>();              Console.WriteLine(st.EnsureCapacity(100) >= 100);   // True
var pq = new PriorityQueue<int, int>(); Console.WriteLine(pq.EnsureCapacity(50) >= 50);     // True
```

Call it once before a bulk fill when you know the size, for the same reason as with a list:
one allocation instead of several doublings.

### What the audit found

Each point from the chapter, against the five existing concepts:

| Chapter topic | Where it was covered |
|---|---|
| Interfaces, read-only views, collection expressions and spread | `collection-interfaces-and-choosing-a-collection` |
| `List<T>`, arrays, capacity and `EnsureCapacity` | `list-and-array-internals` |
| `Dictionary`, `HashSet`, equality, sets | `dictionary-hashset-and-equality` |
| `Queue`, `Stack`, `PriorityQueue` (including .NET 9 `Remove`), sorted collections | `specialized-collections` |
| Immutable and frozen collections | `immutable-and-frozen-collections` |
| `OrderedDictionary<TKey, TValue>`, index overloads, `ReadOnlySet<T>`, `EnsureCapacity` on queue and stack | not covered, written here |

Two small patches were applied to the older concepts: a sentence on `ReadOnlySet<T>` in the
interfaces concept, and a pointer to `OrderedDictionary` in the dictionary concept's
enumeration-order note. `PriorityQueue.Remove` was already covered, so the list of
gaps is the last row of the table.

## Trade-offs

- **`OrderedDictionary` costs more than `Dictionary`.** Per the docs its
  position-based operations behave like `List<T>`, so removing or inserting early
  shifts later entries, and it carries ordering information a plain `Dictionary`
  does not (we did not measure the memory difference). Use it when order is a
  requirement, not as a default.
- **Insertion order is not sorted order.** `OrderedDictionary` will not keep keys
  sorted. A `SortedDictionary` does, at a different cost profile.
- **A positional API next to a keyed one invites mistakes.** With `int` keys,
  `od[5]` and `od.GetAt(5)` mean different things, and neither is a compile error.
  Name keys with a distinct type when you can.
- **`ReadOnlySet<T>` is a view, not a snapshot.** Returning it from a method that
  hands out an internal set still lets the owner change it later, and callers can
  see the change. Return an immutable or frozen set when you need a snapshot.
- **A version-specific API breaks multi-targeting.** The index-returning overloads
  compile on `net10.0` and not on `net9.0`, so a library that targets both needs a
  conditional or the plain overloads.

## Documentation Links

- [OrderedDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.ordereddictionary-2) (doc)
- [ReadOnlySet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.objectmodel.readonlyset-1) (doc)
- [PriorityQueue<TElement,TPriority>.Remove method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2.remove) (doc)
- [Queue<T>.EnsureCapacity method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.queue-1.ensurecapacity) (doc)
- [Commonly used collection types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/commonly-used-collection-types) (doc)
