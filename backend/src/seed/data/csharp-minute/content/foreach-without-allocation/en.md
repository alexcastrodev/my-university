---
version: 1.0
updatedAt: 2026-09-25
---
## Question

# Why does `foreach` over a `List<T>` not allocate?

## Short Answer

Because `foreach` is **pattern-based**, not interface-based. `List<T>.GetEnumerator()` returns `List<T>.Enumerator`, which is a `struct`, so the enumerator lives on the stack. Iterate the same list through `IEnumerable<T>` and you get a boxed enumerator on the heap instead.

## What It Is

`foreach` does not require `IEnumerable`. The compiler only looks for a `GetEnumerator()` method whose return type has a `MoveNext()` method and a `Current` property. It's duck typing at compile time. (Since C# 9, `GetEnumerator` can even be an extension method.)

The BCL collections take advantage of that: `List<T>`, `Dictionary<TKey, TValue>`, `HashSet<T>` and others expose a public `GetEnumerator()` that returns a **struct enumerator**. The compiler calls it directly, with no interface dispatch and no allocation.

## The Interface Trap

When the static type of the variable is `IEnumerable<T>` (or `IList<T>`, `ICollection<T>`), the compiler can only see the interface method, which returns `IEnumerator<T>`. The struct is boxed to satisfy that return type, and every `MoveNext()` and `Current` becomes an interface call. In a hot loop, that's an allocation per loop plus slower calls.

The struct enumerator also carries a version check: if the list is modified during the loop, the next `MoveNext()` throws `InvalidOperationException`.

## Practical Example

```csharp
var numbers = new List<int> { 1, 2, 3 };

foreach (var n in numbers) { }          // List<int>.Enumerator, no allocation

IEnumerable<int> asInterface = numbers;
foreach (var n in asInterface) { }      // boxed IEnumerator<int>, 1 allocation

foreach (var n in numbers)
{
    if (n == 2) numbers.Add(4);         // InvalidOperationException on next MoveNext
}
```

## Solution and Conclusion

On performance-sensitive paths, keep the concrete collection type (or `IReadOnlyList<T>` with an index-based `for`) instead of passing everything around as `IEnumerable<T>`. For ordinary code, the difference is irrelevant, but it explains why profilers sometimes show enumerator allocations in a loop that "doesn't allocate anything".

## References

- [Iteration statements: the foreach statement](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements#the-foreach-statement) (doc)
- [List<T>.Enumerator struct: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.enumerator) (doc)
