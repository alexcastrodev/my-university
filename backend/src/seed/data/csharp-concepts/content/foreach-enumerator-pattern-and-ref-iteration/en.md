---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`foreach` looks like a loop over an `IEnumerable<T>`, but the compiler does
not need the interface at all. It binds to a pattern (a `GetEnumerator`
method, a `Current` property and a `MoveNext` method), and for arrays, strings
and spans it does not create an enumerator either. That pattern explains why
`foreach` over a `List<T>` allocates nothing while the same loop over the list
typed as `IEnumerable<T>` allocates, why copying an enumerator breaks it, and
how `foreach (ref var x in span)` changes elements in place. This concept reads
the lowering in the IL and measures it. Changing a collection during the loop
is in `list-and-array-internals`, iterators and `yield` are in
`linq-deferred-execution-and-iterators`, and `await foreach` is in
`async-streams-iasyncenumerable`.

## Use Cases

- Making your own type usable in `foreach` without implementing
  `IEnumerable<T>`, or adding `foreach` to a type you do not own.
- Removing allocations from hot loops by keeping the concrete collection type.
- Updating structs stored in an array or a `List<T>` in place, without
  copying each element out and back.
- Understanding an `InvalidCastException` thrown by a line that has no cast.
- Reviewing code that stores or copies a `List<T>.Enumerator`.

## Deep Dive

Output is from .NET 10 (SDK 10.0.100) on arm64, Release build. IL was read
with `ilspycmd -il`.

### The pattern, not the interface

The documentation states the rule: the type needs a public parameterless
`GetEnumerator` method, and its return type needs a public `Current` property
and a public parameterless `MoveNext` that returns `bool`. Nothing has to
implement an interface:

```csharp
readonly struct Countdown(int from)
{
    public Enumerator GetEnumerator() => new(from);
    public struct Enumerator(int from)
    {
        int _cur = from + 1;
        public int Current => _cur;
        public bool MoveNext() => --_cur > 0;
    }
}

foreach (var x in new Countdown(3)) Console.Write(x + " ");   // 3 2 1
```

A type with no `GetEnumerator` gives CS1579 ("does not contain a public
instance or extension definition for 'GetEnumerator'"). The message mentions
extensions because C# 9 lets an extension method supply the method, which adds
`foreach` to types you cannot change:

```csharp
static class RangeExt
{
    public static IEnumerator<int> GetEnumerator(this Range r)
    {
        for (int i = r.Start.Value; i < r.End.Value; i++) yield return i;
    }
}

foreach (var i in 1..4) Console.Write(i + " ");   // 1 2 3
```

When a type has both a public `GetEnumerator` and an interface
implementation, the public method wins. `List<T>`, `Dictionary<TKey,TValue>`,
`HashSet<T>` and the other BCL collections use this on purpose: their public
`GetEnumerator` returns a struct, while the `IEnumerable<T>.GetEnumerator`
implementation has to return an object.

### What the compiler emits

For a `List<int>`, the IL of `foreach (var v in list) total += v;` is this
(trimmed):

```text
callvirt  List`1<int32>::GetEnumerator()          // returns List`1/Enumerator, a struct
stloc.1
.try {
    ldloca.s 1
    call      List`1/Enumerator<int32>::get_Current()
    ...
    ldloca.s 1
    call      List`1/Enumerator<int32>::MoveNext()
    brtrue.s  ...
}
finally {
    ldloca.s 1
    constrained. List`1/Enumerator<int32>
    callvirt  IDisposable::Dispose()
}
```

Three details matter. The enumerator lives in a local of the struct type, so
there is no heap object. `Current` and `MoveNext` are direct `call`s on the
struct address (`ldloca`), so the JIT can inline them. And `Dispose` runs in a
`finally`, through a `constrained.` call that does not box. The `finally`
means `break`, `return` or an exception in the body still dispose the
enumerator:

```csharp
foreach (var x in new Tracked()) { Console.WriteLine($"got {x}"); break; }
// got 1
// Dispose called
```

The `try/finally` is only emitted when the enumerator is disposable; the
`Countdown` enumerator above has no `Dispose`, so its loop is a plain
`while (e.MoveNext())`.

Arrays, strings and spans do not get an enumerator at all. The same loop over
an `int[]` compiles to an index loop with `ldelem.i4` and `ldlen`; over a
`string`, to `get_Chars(i)` and `get_Length()`; over a `Span<int>`, to
`get_Item(i)` and `get_Length()`. Decompiled, the span method reads as a
`for` loop.

### Struct enumerators and boxing

Because the enumerator is a struct, the static type of the collection decides
the cost. Measured with `GC.GetAllocatedBytesForCurrentThread` around one call,
after a warm-up call:

```csharp
long Sum(List<int> l)         { long t = 0; foreach (var v in l) t += v; return t; }
long SumI(IEnumerable<int> l) { long t = 0; foreach (var v in l) t += v; return t; }

Sum(list)      // 0 bytes
SumI(list)     // 40 bytes: the struct enumerator boxed as IEnumerator<int>
foreach over int[100]   // 0 bytes
```

Through the interface, `GetEnumerator` returns `IEnumerator<int>`, so the
struct is boxed and every `MoveNext` and `Current` is an interface call. The
40 bytes are per loop, not per element, which is why it only matters on hot
paths. `value-types-reference-types-and-boxing` shows the same row and how
dynamic PGO can remove the box once the method is optimized.

### A copied enumerator is a different enumerator

A struct enumerator is a mutable value, so every copy carries its own
position:

```csharp
var e1 = list.GetEnumerator();
e1.MoveNext();
var e2 = e1;       // copy
e2.MoveNext();
// e1.Current = 0, e2.Current = 1
```

The worst form of this is a `readonly` field. Each call on a `readonly` struct
field works on a defensive copy, so the stored enumerator never moves:

```csharp
class Holder(List<int> list)
{
    readonly List<int>.Enumerator _e = list.GetEnumerator();
    public string Next() => _e.MoveNext() ? _e.Current.ToString() : "end";
}
// list is { 10, 20, 30 }; four calls print: 0 0 0 0
```

`MoveNext` advanced a copy and returned `true`, then `Current` read another
fresh copy. Use `foreach`, or keep enumerators in non-`readonly` locals.

### The iteration variable is read-only

The loop variable is a copy of `Current` and cannot be assigned. For an array
of mutable structs, even a field write is rejected:

```csharp
struct P { public int X, Y; }
foreach (var p in pts) p.X = 10;   // CS1654: Cannot modify members of 'p' because it is a 'foreach iteration variable'
```

### `ref` iteration

When `Current` returns by reference (`ref T`), the variable can be declared
`ref` or `ref readonly`, and then it is an alias to the element itself.
`Span<T>.Enumerator.Current` is `ref T`, so a span is the gateway:

```csharp
var pts = new P[] { new(1, 1), new(2, 2) };
foreach (ref var p in pts.AsSpan()) p.X *= 10;
// (10,1),(20,2)

foreach (ref readonly var p in (ReadOnlySpan<P>)pts) Console.Write(p.X + " ");
// 10 20   (no copy of each P, and no writes allowed)
```

The array and the list themselves do not qualify: `foreach (ref var p in pts)`
and `foreach (ref var p in list)` both give CS1510 ("A ref or out value must be
an assignable variable"), because their `Current` returns a value.

For a `List<T>`, `CollectionsMarshal.AsSpan` (since .NET 5) returns a span
over the list's internal array:

```csharp
var lp = new List<P> { new(1, 1), new(2, 2) };
foreach (ref var p in CollectionsMarshal.AsSpan(lp)) p.Y += 100;
// (1,101),(2,102)
```

The documentation adds the condition: items should not be added or removed
while the span is in use. The span does not know the list version, so there is
no `InvalidOperationException` to save you. When `Add` grows the list, the
span keeps pointing at the old array:

```csharp
var nums = new List<int> { 1, 2, 3 };   // Capacity 3
var span = CollectionsMarshal.AsSpan(nums);
nums.Add(4);                           // reallocates the internal array
span[0] = 99;
// span[0] = 99, list[0] = 1           the write went to the old array
```

### Casts you did not write

With an explicit type, `foreach (V item in collection)` inserts a conversion
from the element type to `V`. If it is an explicit conversion, it can fail at
run time:

```csharp
object[] objs = { "a", 1 };
foreach (string s in objs) Console.WriteLine(s);
// a
// InvalidCastException: Unable to cast object of type 'System.Int32' to type 'System.String'.
```

This is a leftover from collections of `object`. With `var` the variable takes
the element type and no cast exists. Use `OfType<string>()` when the source
really is mixed. `foreach` over a `null` collection throws
`NullReferenceException`; it is not treated as empty.

### Fresh variable per iteration

Each iteration has its own copy of the loop variable, so lambdas created in
the body capture different variables:

```csharp
foreach (var i in new[] { 1, 2, 3 }) actions.Add(() => Console.Write(i + " "));
// running the actions prints: 1 2 3
```

A `for` loop declares one variable for the whole loop. The same lambdas built
in `for (var i = 1; i <= 3; i++)` print `4 4 4`: all of them see the value
that ended the loop. `local-functions-lambdas-and-closures` explains why.

## Trade-offs

- **Concrete type versus interface parameter.** `Sum(List<int>)` iterates with
  zero allocations; `Sum(IEnumerable<int>)` accepts any sequence and pays one
  box per loop plus interface calls. Take the interface at API boundaries and
  the concrete type (or a `ReadOnlySpan<T>`) in measured hot loops.
- **Pattern-based enumerator versus `IEnumerable<T>`.** A custom struct
  enumerator gives zero-allocation `foreach`, but LINQ, `string.Join` and every
  method that takes `IEnumerable<T>` still need the interface. Libraries
  implement both, like `List<T>`.
- **`ref` iteration versus readability.** `foreach (ref var p in span)` avoids
  copying large structs and allows in-place updates. A `for` loop with
  `span[i].X += 1` does the same and is more familiar; pick the one the team
  reads faster.
- **`CollectionsMarshal.AsSpan` is fast and unchecked.** It removes the
  version check that protects `List<T>`. Keep the span short-lived and never
  call `Add`, `Insert`, `Remove` or `Clear` while it is alive.
- **Extension `GetEnumerator` is convenient and surprising.** `foreach (var i
  in 1..4)` reads well, but a reader must find the extension to know it works.
  Use it for types you cannot change, not as a trick.

## Documentation Links

- [Iteration statements: for, foreach, do, and while, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) (doc)
- [The foreach statement, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/statements#1395-the-foreach-statement) (doc)
- [CollectionsMarshal.AsSpan method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.asspan) (doc)
- [List<T>.Enumerator struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.enumerator) (doc)
- [Span<T>.Enumerator struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.span-1.enumerator) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
