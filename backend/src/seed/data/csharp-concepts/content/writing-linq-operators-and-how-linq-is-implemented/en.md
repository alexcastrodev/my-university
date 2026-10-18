---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

LINQ to Objects is ordinary C# in `System.Linq.dll`: extension methods on
`IEnumerable<T>`, iterator classes, and a long list of type checks that pick a
faster path when the source is an array, a `List<T>`, or another LINQ
iterator. Knowing that code explains why `Count()` is instant on a list and
slow on a query, why `OrderBy(...).First()` does not sort, and what a pipeline
costs in allocations. This concept shows how to write your own operator in the
same style and then walks through how the .NET 10 implementation works,
using the runtime source and measurements.

## Use Cases

- Adding a domain operator (`EveryNth`, `WhereNotNull`, `Batch` with a
  custom rule) that behaves like the built-in ones.
- Writing a numeric aggregate once for every number type.
- Understanding a profiler trace that shows `ArrayWhereSelectIterator` or
  `TryGetSpan`.
- Deciding whether to return `IEnumerable<T>`, an array, or a list from an
  API that feeds LINQ.

## Deep Dive

### Writing an operator: validate now, iterate later

A custom operator is an extension method on `IEnumerable<T>`. Put the argument
checks in the public method and the `yield` loop in a separate iterator, so
bad arguments fail at the call and not at the first `MoveNext()`. LINQ,
Deferred Execution, and Iterators explains why the split is needed:

```csharp
public static class MyLinq
{
    public static IEnumerable<T> EveryNth<T>(this IEnumerable<T> source, int n)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(n);
        return Iterate(source, n);

        static IEnumerable<T> Iterate(IEnumerable<T> source, int n)
        {
            int i = 0;
            foreach (var item in source)
                if (i++ % n == 0) yield return item;
        }
    }
}

Enumerable.Range(1, 10).EveryNth(3);   // 1,4,7,10
MyLinq.EveryNth<int>(null!, 3);        // ArgumentNullException at the call
```

The compiler turns `Iterate` into a class that is both the enumerable and its
first enumerator. Calling `GetEnumerator()` on it returned the same object the
first time on the creating thread, and a fresh copy while that first
enumerator was still in use or when called from another thread. LINQ's own
iterators follow the same rule, so one allocation serves the common
"build and `foreach` once" case.

### A numeric aggregate with generic math

Since .NET 7 an aggregate can be written once for every number type with the
`INumber<T>` interfaces from Generic Math and static abstract Interface
Members. A second type parameter lets the accumulator be wider than the
elements, which is exactly how `Enumerable.Sum` is built:

```csharp
public static TResult SumChecked<T, TResult>(this IEnumerable<T> source)
    where T : INumber<T> where TResult : INumber<TResult>
{
    ArgumentNullException.ThrowIfNull(source);
    TResult sum = TResult.Zero;
    foreach (var v in source) sum = checked(sum + TResult.CreateChecked(v));
    return sum;
}

new byte[] { 200, 100 }.SumChecked<byte, int>();   // 300
new[] { 1.5, 2.5 }.SumChecked<double, double>();   // 4
new[] { int.MaxValue, 1 }.SumChecked<int, int>();  // OverflowException
```

### What a pipeline really builds

`Where` does not return one generic iterator. In the .NET 10 source it checks
the source type and picks a specialized class, and every LINQ iterator derives
from an internal `Iterator<T>` that can override `Select`, `Where`, `Skip`,
`Count`, and `First` for its own shape:

```csharp
int[] arr = Enumerable.Range(1, 10).ToArray();
arr.Where(x => x > 2);                        // ArrayWhereIterator`1
arr.ToList().Where(x => x > 2);               // ListWhereIterator`1
Gen().Where(x => x > 2);                      // IEnumerableWhereIterator`1 (a yield method)
arr.Where(x => x > 2).Select(x => x * 2);     // ArrayWhereSelectIterator`2: one fused stage
arr.Where(x => x > 2).Where(x => x < 8);      // ArrayWhereIterator`1: predicates combined
Enumerable.Range(0, 5).Select(x => x);        // RangeSelectIterator`2
```

The array and list versions index the storage directly instead of going
through `IEnumerator<T>`, and a `Where` followed by `Select` becomes a single
iterator that filters and projects in one loop.

### Counting without enumerating

`Count()` checks for `ICollection<T>` first and reads its `Count`. Then it asks
a LINQ iterator for its count, and only then enumerates.
`TryGetNonEnumeratedCount` (.NET 6) runs the same checks but never
enumerates:

| Source | `TryGetNonEnumeratedCount` |
|---|---|
| `List<int>` with 10 items | 10 |
| `arr.Select(...)` | 10 |
| `Enumerable.Range(0, 5).Select(...)` | 5 |
| `arr.Select(...).Skip(3)` | 7 |
| `arr.Where(...)` | unknown (`false`) |
| a `yield` method | unknown (`false`) |

`Where` cannot know its count without running the predicate, and an iterator
method is opaque. There is a subtlety on projections: `Select` is expected to
run its selector for every element when `Count()` forces it, so
`arr.Select(f).Count()` ran `f` ten times, while `TryGetNonEnumeratedCount` ran
it zero times and still answered 10.

### Fast paths: spans, and `OrderBy` without sorting

Many operators (`Sum`, `Count(predicate)`, `Any(predicate)`, `Min`, `Max`)
first call an internal `TryGetSpan`, which succeeds only when the exact runtime
type is `T[]` or `List<T>` (it compares `GetType()`, not `is`). Then the loop
runs over a `ReadOnlySpan<T>` with no enumerator at all.

Ordered queries also look ahead. `OrderBy(...).First()` is answered by a
single scan that keeps the smallest element, and `ElementAt` uses a partial
selection instead of a full sort:

```csharp
// 1,000 shuffled ints, comparer counts its calls
data.OrderBy(x => x, counting).First();    // 999 comparisons
data.OrderBy(x => x, counting).ToList();   // 10,917 comparisons
```

### `Sum`: generic math plus vectorization

`Enumerable.Sum` is a thin wrapper over one generic method,
`Sum<TSource, TResult>` constrained to `INumber<T>`; `Sum(IEnumerable<float>)`
calls it with `TResult = double`. When the source is a span and the element
and result types match, it vectorizes `int` and `long` with `Vector<T>`,
checking overflow on whole vectors through sign bits. The source requires
`Vector<T>.Count > 2`, so on 128-bit vectors only `int` (4 lanes) qualifies;
`long` (2 lanes) takes the scalar loop. On Apple M4 (Arm64, 128-bit), over
10 million elements in Release:

| Call | Time |
|---|---|
| `int[].Sum()` | 2 ms, same as a hand-written unchecked `for` loop |
| `long[].Sum()` | 10 ms |
| `IEnumerable<int>` (a `Select` over the array) `.Sum()` | 19 ms |

The array path is fast and checked; hiding the array behind a projection or a
custom `IEnumerable<T>` loses both the span and the vectors.

### What a pipeline allocates

Measured per call with `GC.GetAllocatedBytesForCurrentThread()` after warm-up
on .NET 10:

| Code over a 10-element `int[]` | Bytes |
|---|---|
| `arr.Sum()` | 0 |
| `arr.Count(x => x > 2)` | 0 |
| `arr.Where(x => x > 2).Sum()` | 48: one `ArrayWhereIterator` |
| `foreach` over `arr.Where(...).Select(...)` | 104: the `Where` iterator plus the fused `WhereSelect` iterator |
| `foreach` over `arr.EveryNth(2)` | 96 |

The lambdas capture nothing, so the compiler caches their delegates and they
do not show up. A capturing lambda adds a closure and a delegate per call, as
Value Types, Reference Types and Boxing measured.

## Trade-offs

- **Iterator method versus hand-written enumerator.** `yield return` is short
  and correct; a hand-written `IEnumerator<T>` class can add the fast paths
  LINQ uses (a known count, indexing) but is far more code to get right.
  Write one only after a profiler points at it.
- **Exposing `IEnumerable<T>` versus a concrete type.** Returning
  `IEnumerable<T>` keeps an API flexible, but if the caller then runs LINQ,
  the span and `ICollection<T>` fast paths only apply when the runtime object
  really is an array or a list.
  ```csharp
  IEnumerable<int> Ids() => _ids;                    // still int[]: Sum vectorizes
  IEnumerable<int> Ids() => _ids.Select(x => x);     // opaque: scalar loop, iterator allocated
  ```
- **Relying on internal optimizations.** `OrderBy().First()` and the fused
  iterators are implementation details of .NET 10, not documented contracts.
  Write the clear form (`MinBy`) when it exists, and treat the rest as a bonus.
- **LINQ versus a loop in a hot path.** On arrays and lists, `Sum`, `Count`,
  and `Any` with a predicate allocate nothing and can beat a naive loop;
  longer pipelines allocate an iterator per stage on every run.

## Lab

In this lab you get `MyLinq`, a static class with six LINQ operators that have no body. Your job is to write them as iterator methods, validate arguments eagerly, release the source when a consumer stops early and special-case `ICollection<T>` and `IList<T>` the way `System.Linq` does. The core idea is that laziness and fast paths are observed through counters, never through timing: the tests count how many items were pulled and how many enumerators were created and disposed.

**The scenario**

The tests feed your operators from two spy classes, in `Spies.cs`.

- `TrackedSource`: an iterator that records how many items were pulled (`Pulled`), how many enumerations started (`Enumerations`) and how many enumerators were disposed (`Disposed`).
- `ListSpy`: an `IList<int>` that counts the enumerators requested (`EnumeratorsCreated`).
- `MyLinq.cs`: `MyWhere`, `MySelect`, `MyTake`, `MyDistinctBy`, `MyChunk`, `MyCount` and `MyElementAt`.

A method containing `yield` cannot validate eagerly, so the recipe is to split it in two.

**What you will do, step by step**

1. **Validate now, iterate later (TODO-00).** In `MyWhere` and `MySelect`, validate `source` and `predicate` or `selector` in the public method (the `ArgumentNullException` must fire at the call, not at the first `MoveNext`) and return a private iterator method that does the `yield return`. The predicate and selector run once per element, only when the item is pulled, and are re-evaluated on each enumeration.
2. **Stop without an extra MoveNext (TODO-01).** `MyTake` validates eagerly (null source, negative count) and then yields at most `count` items. Stop right after the last one: do not call `MoveNext` on the source once you have enough, and do not touch the source at all when `count` is 0. Leaving the iterator early must dispose the source enumerator (`foreach`/`finally` does it for you).
3. **Streaming with a "seen" set (TODO-02).** `MyDistinctBy` yields each element whose key has not been seen yet, without buffering the whole source, running `keySelector` once per element. Keep the set of seen keys **inside** the iterator, so every enumeration starts empty. Validate the arguments eagerly.
4. **Split into chunks (TODO-03).** `MyChunk` yields arrays of `size` items, and the last one may be shorter. Pull from the source only as far as the consumer asks (the first chunk pulls exactly `size` items). Throw `ArgumentOutOfRangeException` eagerly when `size < 1`, do not yield an empty trailing chunk and dispose the enumerator when the consumer stops early. The arrays must be independent.
5. **Interface fast paths (TODO-04).** `MyCount`: if the source is an `ICollection<T>`, return `Count` without creating an enumerator; otherwise enumerate and count. `MyElementAt`: if the source is an `IList<T>`, use the indexer; otherwise enumerate until the index. A negative or too large index throws `ArgumentOutOfRangeException` on both paths, and the enumerator must be disposed.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why validation cannot live in the method with `yield`, why `source.MyWhere(...).MySelect(...).First()` pulls only three items out of 100 and why the source's `finally` runs even on a `break`.

**Optional challenges**

- **TODO-05:** write `MyZip` that stops at the shorter sequence. When the first sequence ends, it must not pull from the second one, and both enumerators must be disposed.
- **TODO-06:** write `MyTryGetNonEnumeratedCount` that answers for `ICollection<T>` and returns `false` for iterators, like `Enumerable.TryGetNonEnumeratedCount`. Why can `MyWhere` never answer?

**Prerequisites:** extension methods and generics, `yield return` and `IEnumerable<T>`/`IEnumerator<T>`, deferred execution (see the deferred execution lab) and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment with the hint, so the red tests are your checklist.

## Documentation Links

- [How to extend LINQ, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/how-to-extend-linq) (doc)
- [Iterators, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/iterators) (doc)
- [Enumerable.TryGetNonEnumeratedCount method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.trygetnonenumeratedcount) (doc)
- [Enumerable.Sum method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.sum) (doc)
- [Generic math, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
- [Enumerable.Sum source, dotnet/runtime (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Linq/src/System/Linq/Sum.cs) (doc)
