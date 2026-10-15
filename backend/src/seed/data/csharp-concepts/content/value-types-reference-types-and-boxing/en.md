---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The split between value types (`struct`, `enum`, the numeric types) and
reference types (`class`, `interface`, `delegate`, arrays, `string`) is about
what a variable holds and what an assignment copies. It is often explained as
"structs live on the stack, classes on the heap", which is wrong often enough
to cause real bugs and wasted optimizations. This concept explains copy
semantics, where values really live, struct layout, the bugs that come from
invisible copies, where boxing hides, and how to measure allocations instead
of guessing.

## Use Cases

- Deciding whether a small domain value (a coordinate, an amount with a
  currency) should be a `struct` or a `class`.
- Understanding why `list[0].X = 5` does not compile while `array[0].X = 5`
  does.
- Finding the source of allocations in a hot path when a profiler points at
  `ValueType.Equals` or a boxed enumerator.
- Sizing a struct before storing millions of them in an array.
- Explaining an `InvalidCastException` when reading a number back from
  `object`.

## Deep Dive

### What a variable holds

A variable of a struct type holds the fields themselves. A variable of a class
type holds a reference to an object. Assignment, argument passing, and return
all copy the variable's content, so a struct is copied whole and a class
shares one object:

```csharp
var p1 = new PointS { X = 1, Y = 2 };
var p2 = p1; p2.X = 10;
Console.WriteLine(p1.X); // 1: p2 is an independent copy

var c1 = new PointC { X = 1, Y = 2 };
var c2 = c1; c2.X = 10;
Console.WriteLine(c1.X); // 10: both variables reference the same object

struct PointS { public int X; public int Y; }
class PointC { public int X; public int Y; }
```

### The stack is an implementation detail

Where a value lives depends on its container, not on whether it is a struct:

- A struct local in an ordinary method lives in the stack frame, or only in
  registers once the JIT promotes its fields.
- A struct field of a class, or an element of an array, lives inside that
  object on the heap.
- A local captured by a lambda, or used across an `await` or `yield`, is
  hoisted into a compiler-generated object. Capturing one `int` and creating
  the lambda cost 88 bytes per call in the measurements below: the closure
  object plus the delegate.

It also works in the other direction. The .NET 10 JIT allocates small
fixed-size arrays and delegates on the stack when escape analysis proves they
never leave the method. A method that builds `int[] n = { 1, 2, 3 }` and sums
it allocated 0 bytes per call once optimized, while its first, unoptimized
calls did allocate. That is an optimization, never a guarantee. The only
language-level promise of "never on the heap" is a `ref struct`, covered at the
end.

### Layout and size

A struct's size is its fields plus alignment padding. C# compilers ask for
sequential layout on structs, so field order matters:

```csharp
Unsafe.SizeOf<Padded>();  // 24
Unsafe.SizeOf<Packed>();  // 16
Unsafe.SizeOf<WithRef>(); // 16: with a reference field the runtime reordered it

struct Padded  { public byte A; public long B; public byte C; }
struct Packed  { public long B; public byte A; public byte C; }
struct WithRef { public byte A; public string? S; public byte C; }
```

Every heap object also pays a header and a type pointer. On this 64-bit
runtime, `new object()` and a class with two `int` fields both took 24 bytes.
That changes the cost of a collection: 1,000 two-int structs in an array took
8,024 bytes in one contiguous block, while 1,000 equivalent class instances
took 32,024 bytes (an 8,024-byte array of references plus 1,000 objects of 24
bytes) scattered across the heap.

The Framework Design Guidelines suggest a struct only when the type
represents a single value, is under 16 bytes, is immutable, and will not be
boxed often. The size limit is about copying: every assignment and every call
by value copies all of it.

### Mutable structs and invisible copies

Most struct bugs come from code that changes a copy without saying so:

```csharp
var list = new List<MPoint> { new() };
list[0].Move(5);
Console.WriteLine(list[0].X);   // 0: the indexer returned a copy

var arr = new[] { new MPoint() };
arr[0].Move(5);
Console.WriteLine(arr[0].X);    // 5: an array element is a variable
foreach (var p in arr) p.Move(100);
Console.WriteLine(arr[0].X);    // 5: the loop variable is a copy

var h = new Holder(); h.Bump(); h.Bump();
Console.WriteLine(h.Value);     // 0: calls on a readonly field run on a copy

interface IMovable { void Move(int dx); }
struct MPoint : IMovable { public int X; public void Move(int dx) => X += dx; }
struct Counter { public int N; public void Increment() => N++; }
class Holder
{
    private readonly Counter _c;
    public void Bump() => _c.Increment();
    public int Value => _c.N;
}
```

The compiler catches the direct forms. `list[0].X = 5` is error CS1612
("Cannot modify the return value of 'List<MPoint>.this[int]' because it is not
a variable"), the same for a dictionary indexer, and `p.X = 1` inside the
`foreach` is CS1654. It cannot catch a method call, because it does not know
whether the method writes. The fix is to make structs immutable: a
`readonly struct` or a `readonly record struct`, updated through `with`, turns
any write into a compile error. The same hidden copy appears with `in`
parameters on a non-readonly struct, as shown in Method Parameters: Optional,
Named and ref Kinds.

### Where boxing hides

Boxing converts a value type to `object`, `ValueType`, or an interface by
copying it into a new heap object. The obvious cases, `ArrayList`, interface
parameters, and `string.Format` with `params object[]`, are covered in
Generics: Constraints and Variance and in the formatting concept. These are
the quieter ones, measured per call (method below):

| Code | Bytes per call |
|---|---|
| `a.Equals(b)` on a struct without overrides | 48: `this` and `b` both boxed |
| the same struct implementing `IEquatable<T>` | 0 |
| `a.GetHashCode()` without an override | 24 |
| `Sink.O = 42 + x` (a box stored in a field) | 24 |
| `foreach` over a `List<int>` typed as `IEnumerable<int>` | 40 when cold or with PGO off, 0 once optimized with PGO |
| `flags.HasFlag(FileAttributes.Hidden)` | 48 when cold, 0 once optimized |

The default `ValueType.Equals` compares field by field through `object`, and
its documentation recommends overriding it, especially when the struct holds
references. A `record struct` generates `IEquatable<T>` and both overrides.

A box is a copy with a life of its own, and unboxing is strict about the type:

```csharp
object o = 42;
long l = (long)o;        // InvalidCastException: the box holds an int
long ok = (long)(int)o;  // unbox to int, then convert

int? none = null;
object bn = none;        // null: an empty Nullable<T> boxes to a null reference
int? some = 5;
object bs = some;
Console.WriteLine(bs.GetType()); // System.Int32, never Nullable<Int32>

var m = new MPoint();
object boxed = m;
((IMovable)boxed).Move(5);
Console.WriteLine($"{m.X} {((MPoint)boxed).X}"); // 0 5: only the box moved
```

### Measuring instead of guessing

`GC.GetAllocatedBytesForCurrentThread()` is enough for a quick check:

```csharp
static long Alloc(Action action)
{
    const int N = 10_000;
    for (int round = 0; round < 5; round++)   // let tiered compilation optimize
    {
        for (int i = 0; i < N; i++) action();
        Thread.Sleep(150);
    }
    long before = GC.GetAllocatedBytesForCurrentThread();
    for (int i = 0; i < N; i++) action();
    return (GC.GetAllocatedBytesForCurrentThread() - before) / N;
}
```

Run a Release build and warm up first, because code starts unoptimized
(Tier0) and the table above changes after tier-up. Store results in a static
field: `object o = 42 + x; x = (int)o;` measured 0 bytes, because the JIT
proved the box never escapes and kept it off the heap, while the same box
stored in a field measured 24. All numbers here come from .NET 10.0.0 on Apple
M4 Max (arm64), Release, with the default tiered compilation and PGO. For a running service, `dotnet-counters` shows the
allocation rate without code changes.

### `ref struct`: the stack as a rule

A `ref struct` cannot be boxed, cannot be a field of a class, cannot be an
array element, and cannot be captured by a lambda, so the compiler guarantees
it never reaches the heap. `Span<T>` is one, and `stackalloc` assigned to a
`Span<T>` gives safe stack memory without `unsafe`. Span, Memory, and Slicing
Without Allocating builds on this.

## Trade-offs

- **Struct versus class.** A struct avoids an allocation and a pointer chase
  but is copied on every assignment and call, so a large struct moves all its
  bytes each time. Keep structs small, or pass a large one with `in` only when
  it is `readonly`.
- **Mutable structs.** They make some hot paths cheaper (`List<T>.Enumerator`
  is one) but produce silent bugs through copies. Default to
  `readonly struct` and allow mutation only in private, local code.
- **Equality.** Overriding `Equals`, `GetHashCode`, and implementing
  `IEquatable<T>` is boilerplate, but without it every comparison boxes and
  goes through the slow default. `record struct` writes it for you.
- **Abstraction versus boxing.** Accepting `object` or an interface keeps an
  API simple and boxes every struct argument. A generic method constrained to
  the interface avoids the box at the price of one compiled copy per value
  type.
- **Trusting the JIT.** Escape analysis and PGO remove many allocations in
  steady state, but not in cold code, not always without PGO, and never when
  the value escapes. Measure the real path before and after a change.

## Documentation Links

- [Value types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-types) (doc)
- [Structure types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [Boxing and unboxing, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing) (doc)
- [Choosing between class and struct, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct) (doc)
- [ValueType.Equals(Object), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.equals) (doc)
- [What's new in .NET 10 runtime: stack allocation and escape analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime#stack-allocation) (doc)
- [ref struct types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
