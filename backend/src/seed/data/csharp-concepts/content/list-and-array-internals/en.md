---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`List<T>` and arrays look interchangeable until you hit their edges. A list is
a thin wrapper around an array that grows by allocating a bigger one and
copying, so its capacity, not its count, decides how much memory it holds and
how often it copies. An array has a fixed length, but its reference-type
version is covariant, which moves a type error from compile time to a runtime
exception. Both throw or misbehave when changed during a `foreach`, and both can
be exposed as a `Span<T>` that avoids copies at the price of lifetime rules.
This concept covers growth and capacity, array covariance, modifying a
collection while enumerating it, and the span-based tools for slicing without
allocating.

## Use Cases

- Filling a list with a known number of items, such as rows from a query, without
  paying for repeated resizes.
- Understanding why `object[] a = new string[1]; a[0] = 1;` compiles and then
  fails.
- Removing items that match a condition while looping over a list.
- Processing part of an array or list in a hot path without copying it.

## Deep Dive

### Count, capacity, and growth

`List<T>` keeps an internal `T[]`. `Count` is how many items are in use, and
`Capacity` is the length of that array. A new empty list has capacity 0, the
first `Add` allocates an array of 4, and every time it is full the list doubles
the capacity: allocate a new array, copy every item, drop the old one. That
makes `Add` amortized O(1), but each growth step copies everything and leaves
garbage behind.

```csharp
var list = new List<int>();
Console.WriteLine(list.Capacity);        // 0
list.Add(1);
Console.WriteLine(list.Capacity);        // 4
for (var i = 0; i < 4; i++) list.Add(i);
Console.WriteLine(list.Capacity);        // 8, the fifth item forced a copy

var sized = new List<int>(10_000);       // one allocation up front
sized.EnsureCapacity(20_000);            // grows once if the capacity is lower (.NET 6+)
sized.TrimExcess();                      // shrinks the array to Count if it is mostly empty
```

When you know or can estimate the final size, pass it to the constructor. When
a list stays alive long after it was filled, `TrimExcess` gives back the unused
tail, but it reallocates, so call it once after the list stops growing and not
in a loop.

### Array covariance

Arrays of reference types are covariant: a `string[]` can be assigned to an
`object[]`. The compiler allows it, so the type check moves to runtime, where
every store into such an array checks the actual element type:

```csharp
object[] objects = new string[2];
objects[0] = "ok";
objects[1] = 42;      // compiles, then throws ArrayTypeMismatchException

IList<object> list = new List<string>(); // does not compile: List<T> is invariant
```

Covariance applies only to reference types: an `int[]` is not an `object[]`.
It exists for historical reasons (before generics), and it costs a type check on
stores into arrays whose element type is not sealed. Prefer `IReadOnlyList<T>`
when you need to pass "a sequence of derived items as a sequence of base
items", because the read-only interface is safely covariant and cannot be
written to.

### Changing a collection while enumerating it

`List<T>` carries an internal version number that `Add`, `Remove`, `Insert`,
`Clear`, and sorting increment. The enumerator remembers the version it started
with and checks it on every `MoveNext`:

```csharp
var numbers = new List<int> { 1, 2, 3, 4 };

foreach (var n in numbers)
    if (n % 2 == 0)
        numbers.Remove(n);   // InvalidOperationException: Collection was modified

numbers.RemoveAll(n => n % 2 == 0);          // the right tool: one pass, no exception
for (var i = numbers.Count - 1; i >= 0; i--) // or walk backwards so indexes stay valid
    if (numbers[i] % 2 == 0) numbers.RemoveAt(i);
```

Arrays have no version and cannot change length, so `foreach` over an array
never throws this exception. Assigning to elements while enumerating is allowed,
and the loop simply sees the new values. Since .NET Core 3.0, `Dictionary` also
allows `Remove` and `Clear` during enumeration without invalidating the
enumerator, which is a difference people forget when they move between types.

### Spans: slicing without copying

A `Span<T>` is a view over a contiguous region of memory (an array, part of a
list's array, stack memory) and slicing it allocates nothing. Range syntax on an
array, by contrast, copies:

```csharp
int[] data = [10, 20, 30, 40, 50];

int[] copy = data[1..4];            // new array with 20, 30, 40
Span<int> view = data.AsSpan(1, 3); // same memory, no allocation
Span<int> view2 = data.AsSpan()[1..4];
view[0] = 99;                       // data[1] is now 99

ReadOnlySpan<int> readOnly = view;  // read-only window over the same memory
```

For a `List<T>`, `CollectionsMarshal.AsSpan(list)` returns a span over the
backing array of the first `Count` items, with no copy. That is powerful for
tight loops and dangerous in general:

```csharp
var items = new List<int> { 1, 2, 3 };
Span<int> span = CollectionsMarshal.AsSpan(items);
items.Add(4);        // may reallocate the backing array
span[0] = 100;       // writes to the OLD array: items[0] is unchanged
```

Never add to or remove from the list while you hold the span, and do not store
the span in a field (a `Span<T>` is a `ref struct` and cannot live on the heap).
C# 14 adds more implicit conversions between arrays, `Span<T>`, and
`ReadOnlySpan<T>`, so extension methods written for spans can be called directly
on arrays.

## Trade-offs

- **Pre-sizing trades memory for speed only if the estimate is good.** An
  oversized capacity wastes memory for every list that stays alive, and
  `new List<T>(count)` is a promise about capacity, not about `Count`.
  ```csharp
  var list = new List<int>(100);
  list[0] = 1;   // ArgumentOutOfRangeException: Count is still 0
  ```
- **Doubling can overshoot.** A list that grows to 1,048,577 items has a
  capacity of 2,097,152, almost half of it unused. For a large, long-lived list built once, create
  it from an exact-size source (an array or `ToList()` on a sized sequence) or
  call `TrimExcess`.
- **Array covariance makes writes checked and slower.** A write into an array of
  a non-sealed reference type needs a runtime check, and a bug becomes an
  exception far from the cause. Sealed element types and value types skip the
  check.
- **`RemoveAll` and backward loops are not the same as filtering.** They mutate
  the list in place, which is wrong when another part of the code holds the same
  list. If the list is shared, produce a new list with `Where(...).ToList()`
  instead.
- **Spans are fast and strict.** They cannot be captured by lambdas, used across
  `await`, or stored in fields of normal classes. Use `Memory<T>` when the
  region must outlive the call or cross an `await`.
- **`CollectionsMarshal.AsSpan` bypasses the version check.** The list's own
  safety net, the `InvalidOperationException`, does not protect a span: you get
  silent writes to a stale array instead of an exception.

## Documentation Links

- [List<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1) (doc)
- [Arrays, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/arrays) (doc)
- [Covariance and contravariance in generics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) (doc)
- [Memory<T> and Span<T> usage guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
- [CollectionsMarshal.AsSpan, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.asspan) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
