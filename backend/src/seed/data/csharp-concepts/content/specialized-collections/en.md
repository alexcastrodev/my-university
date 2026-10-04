---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`List<T>`, `Dictionary<TKey, TValue>`, and `HashSet<T>` cover most code, and the
specialized collections exist for the cases where the access pattern is the
point: first in, first out; last in, first out; always the smallest item next;
or keys that must come back in order. Picking one is mostly about knowing what
each is built on, because the data structure decides which operations are cheap.
This concept covers `Queue<T>`, `Stack<T>`, `LinkedList<T>`, the sorted
collections, and `PriorityQueue<TElement, TPriority>`, with their costs and the
limits that surprise people.

## Use Cases

- Processing work items in arrival order, or undoing actions in reverse order.
- A scheduler that must always pick the task with the earliest deadline.
- Keeping a leaderboard or a time index that can be walked in key order and
  queried by range.
- A cache that moves entries to the front on every hit and evicts from the back.
- Merging or searching large inputs where a heap or a sorted structure avoids
  sorting the whole thing every time.

## Deep Dive

### Queue and Stack

`Queue<T>` is a circular array: `Enqueue` adds at the tail, `Dequeue` removes
from the head, and both are O(1) amortized. `Stack<T>` is an array too, with
`Push` and `Pop` at the top. Both throw `InvalidOperationException` when you
read from an empty collection, so use the `Try` methods when emptiness is normal:

```csharp
var queue = new Queue<string>();
queue.Enqueue("a");
queue.Enqueue("b");
while (queue.TryDequeue(out var item))
    Console.WriteLine(item);          // a, then b

var undo = new Stack<Action>();
undo.Push(() => Console.WriteLine("undo 1"));
if (undo.TryPop(out var action)) action();
```

There is no built-in double-ended queue. If you need to add and remove at both
ends (Java's `ArrayDeque`), `LinkedList<T>` offers `AddFirst`, `AddLast`,
`RemoveFirst`, and `RemoveLast`, and for producer and consumer scenarios across
threads `ConcurrentQueue<T>` and `System.Threading.Channels` are the tools, not
these types.

### LinkedList: rarely the right answer

`LinkedList<T>` is a doubly linked list of nodes. Inserting or removing next to
a node you already hold is O(1), but there is no index, finding an item is
O(n), and every item is a separate heap object, so traversal jumps around
memory:

```csharp
var lru = new LinkedList<string>();
var node = lru.AddFirst("page-1");
lru.AddFirst("page-2");

// O(1) because we hold the node: move a hit to the front.
lru.Remove(node);
lru.AddFirst(node);
```

It earns its place when you keep the nodes (an LRU cache is the classic case).
For most other uses, a `List<T>` is faster even for insertion in the middle,
because the shifting happens in contiguous memory.

### SortedDictionary, SortedList, and SortedSet

All three keep keys ordered and cost O(log n) for lookup, but they are built
differently:

```csharp
var tree = new SortedDictionary<int, string>();   // red-black tree
var array = new SortedList<int, string>();         // two parallel arrays
var set = new SortedSet<int> { 5, 1, 9, 3 };       // red-black tree, unique values

tree[10] = "ten";            // O(log n) insert
array[10] = "ten";           // O(n) insert in the middle, O(1) append if keys arrive in order
var between = set.GetViewBetween(2, 6);   // 3, 5: a live view of the range
```

`SortedDictionary` has faster inserts and removals for unsorted data, but it
uses more memory per entry. `SortedList` uses less memory, supports access by
index (`Keys[i]`, `Values[i]`), and is the better choice when the data is loaded
once, ideally already sorted, and then mostly read. `SortedSet<T>` adds
`Min`, `Max`, and `GetViewBetween` for range queries.

### PriorityQueue

`PriorityQueue<TElement, TPriority>` (.NET 6) is a heap: the item with the
lowest priority value comes out first, in O(log n), and peeking is O(1):

```csharp
var pq = new PriorityQueue<string, int>();
pq.Enqueue("low", 10);
pq.Enqueue("urgent", 1);
pq.Enqueue("medium", 5);

while (pq.TryDequeue(out var task, out var priority))
    Console.WriteLine($"{priority}: {task}");   // 1: urgent, 5: medium, 10: low

// Highest first: invert the comparison.
var max = new PriorityQueue<string, int>(Comparer<int>.Create((a, b) => b.CompareTo(a)));
```

`UnorderedItems` enumerates the elements together with their priorities in no
particular order, which is useful for inspection but not for processing in order.
Two limits matter: the queue is not stable, so items with equal priority may
come out in any order, and the priority of an element already inside cannot be
changed.

## Trade-offs

- **`PriorityQueue` is not stable.** Equal priorities do not keep insertion
  order, so a task queue that must be fair among equals needs a tiebreaker.
  ```csharp
  // Use a tuple priority: (priority, sequence number) to keep arrival order.
  var pq = new PriorityQueue<string, (int Priority, long Seq)>();
  pq.Enqueue("a", (1, seq++));
  pq.Enqueue("b", (1, seq++));   // "a" comes out before "b"
  ```
- **You cannot update a priority in place.** Dijkstra-style algorithms usually
  enqueue a duplicate with the better priority and skip stale entries when they
  come out, instead of lowering the old one. .NET 9 adds a `Remove` method,
  but it scans the heap, so it is O(n).
- **`LinkedList<T>` costs memory and speed.** Each node carries two references
  plus the object header, and traversal misses the CPU cache. Choose it for node
  handles, not because the operation is "insertion".
- **`SortedList` inserts are O(n).** Adding keys in random order shifts the
  arrays each time, which is why a `SortedDictionary` can beat it for write-heavy
  data and a `SortedList` wins for build-once, read-many data.
- **Changing a collection while enumerating throws.** `Queue<T>`, `Stack<T>`, and
  the sorted collections track a version, so adding inside a `foreach` over the
  same collection raises `InvalidOperationException`.
  ```csharp
  foreach (var x in queue) queue.Enqueue(x); // InvalidOperationException
  ```

## Documentation Links

- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
- [Queue<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.queue-1) (doc)
- [Stack<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.stack-1) (doc)
- [LinkedList<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.linkedlist-1) (doc)
- [SortedDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sorteddictionary-2) (doc)
- [SortedList<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sortedlist-2) (doc)
- [SortedSet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sortedset-1) (doc)
- [PriorityQueue<TElement,TPriority> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2) (doc)
