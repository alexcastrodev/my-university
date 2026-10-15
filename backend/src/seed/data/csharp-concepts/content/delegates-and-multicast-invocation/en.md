---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A delegate is an object that points to a method: a target instance (or none,
for a static method) plus the method itself. Every delegate type is a class the
compiler generates, every delegate instance is immutable, and every delegate is
multicast, which means it can hold a list of methods and call them in order.
This concept shows what the compiler emits for a delegate type, how `+=` and
`-=` really build and search invocation lists, what happens when one method in
the list throws, how `Func`, `Action` and `Predicate` relate to custom delegate
types, how method group conversions are cached, and where C# 9 function
pointers fit when a delegate is too expensive.

## Use Cases

- Passing behavior into an algorithm: a comparison to `Sort`, a predicate to
  `FindAll`, a retry callback to an HTTP helper.
- Fanning out a notification to several listeners with one call, which is how
  events work underneath.
- Collecting every result, or every exception, from a list of handlers instead
  of only the last one.
- Choosing between a custom delegate type (named, with `ref`/`out` parameters)
  and the generic `Func`/`Action` family.
- Calling native code or a hot dispatch table without allocating a delegate.

## Deep Dive

### A delegate type is a generated class

`delegate int Transform(int x);` is a type declaration. Reflection on .NET
10.0.0 shows what the compiler produced:

```csharp
foreach (var m in typeof(Transform).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
    Console.WriteLine(m);
// Int32 Invoke(Int32)
// System.IAsyncResult BeginInvoke(Int32, System.AsyncCallback, System.Object)
// Int32 EndInvoke(System.IAsyncResult)
Console.WriteLine($"{typeof(Transform).BaseType}, sealed: {typeof(Transform).IsSealed}");
// System.MulticastDelegate, sealed: True
```

Calling `t(3)` compiles to `t.Invoke(3)`. `BeginInvoke` is still generated for
compatibility, but calling it on .NET throws `PlatformNotSupportedException`
(checked on 10.0.0); use `Task.Run(() => t(3))` instead.

An instance carries two things, `Target` and `Method`:

```csharp
Transform inst = counter.Add;   // Target = counter, Method = Add
Transform stat = Ops.Square;    // Target = null,    Method = Square
```

The `Target` reference is a strong reference. A delegate stored somewhere long
lived keeps its target object alive, which is the root of the event leak in the
next concept.

### `Func`, `Action`, `Predicate` and custom types

`Func<...>` (up to 16 parameters plus a result), `Action<...>` and
`Predicate<T>` cover most signatures, and on .NET 10 their type parameters are
declared `allows ref struct`, so `Func<ReadOnlySpan<char>, int>` compiles. Two
delegate types with the same signature are still different types:

```csharp
Func<int, bool> isEven = x => x % 2 == 0;
Predicate<int> p = isEven;          // error CS0029: Cannot implicitly convert type 'System.Func<int, bool>' to 'System.Predicate<int>'
Predicate<int> ok = isEven.Invoke;  // compiles: a new delegate that calls the old one
```

The workaround allocates a second delegate and adds one hop per call. Custom
delegate types remain the right tool when the signature needs `ref`, `out` or
`in` parameters, which the generic family does not have, or when a name
documents intent:

```csharp
delegate bool TryParse<T>(string s, out T value);
TryParse<int> tp = int.TryParse;    // tp("42", out var v) -> True, v = 42
```

Method group conversions also apply variance on their own, separately from the
`in`/`out` variance of generic delegates covered in the generics concept:
`Func<object> f = GetText;` accepts a method returning `string`, and
`Action<string> a = TakeObject;` accepts a method taking `object`.

### Multicast: immutable invocation lists

`a += b` means `a = (Transform)Delegate.Combine(a, b)`. Combine never changes
its inputs; it builds a new delegate whose invocation list is the
concatenation:

```csharp
Transform chain = Ops.Square;
Transform first = chain;
chain += Ops.Negate;
chain += Ops.Double;
Console.WriteLine($"{chain(3)}; first still has {first.GetInvocationList().Length} target");
// 6; first still has 1 target
// invocation list: Square, Negate, Double
```

All three methods ran in order, and the caller saw only the last return value
(`Double(3) = 6`). The Microsoft Learn delegate guide states the same rule for
`out` parameters: the values come from the last method invoked, and a `ref`
argument flows through each method in turn.

Immutability has a cost and a benefit. Measured with
`GC.GetAllocatedBytesForCurrentThread` (.NET 10.0.0, Apple M4 Max, arm64,
Release), combining a one-method delegate with another allocated 104 bytes: a
new `MulticastDelegate` plus the array behind the list. In exchange, a delegate
you have read can never change under you, so invoking it from several threads
is safe. Writing `field += handler` on a shared field is not: it is a read, a
combine and a write, and two threads can lose an update. Events solve that
(next concept).

### `-=`: removing the right-most match

Removal compares delegates by value: same `Target` and same `Method`. The C#
reference defines `a - b` as removing the right-most contiguous sublist of `a`
that equals the list of `b`, returning `a` unchanged when there is no match and
`null` when nothing is left:

```csharp
Action seq = Ops.A;
seq += Ops.B; seq += Ops.A; seq += Ops.B;
seq -= Ops.A;                              // A, B, B: the LAST A went away

Action<string> log = s => Console.Write($"1:{s} ");
log += s => Console.Write($"2:{s} ");
log -= s => Console.Write($"2:{s} ");      // still 2 targets

Transform only = Ops.Square;
only -= Ops.Square;                        // null

Transform a1 = counter.Add, a2 = counter.Add, a3 = new Counter().Add;
// a1 == a2: True, ReferenceEquals(a1, a2): False, a1 == a3: False
```

The lambda case is the classic bug: two identical lambdas compile to two
different methods, so the second one never equals the first. Keep the delegate
in a variable or field if you plan to remove it. The `null` result matters too:
after removing the last handler, calling the field directly throws
`NullReferenceException`, hence `handler?.Invoke(...)`.

### When one method throws

An exception stops the invocation list at that point and goes to the caller:

```csharp
Action<string> notify = s => Console.Write($"first:{s} ");
notify += s => throw new InvalidOperationException("second failed");
notify += s => Console.Write($"third:{s} ");
try { notify("x"); } catch (InvalidOperationException e) { Console.WriteLine($"caught: {e.Message}"); }
// first:x caught: second failed
```

`third` never ran. When every listener must run, or when you need every return
value, walk the list yourself:

```csharp
var errors = new List<Exception>();
foreach (var handler in Delegate.EnumerateInvocationList(notify))
{
    try { handler("y"); } catch (Exception e) { errors.Add(e); }
}
// first:y third:y errors: 1  ->  throw new AggregateException(errors) if needed
```

`Delegate.EnumerateInvocationList<TDelegate>` (available since .NET 9) returns
a struct enumerator that is already typed and allocated 0 bytes per loop in the
measurement above, while `GetInvocationList()` returned a fresh `Delegate[]`
(48 bytes for three methods) that you then cast element by element. The
enumerator only follows the `foreach` pattern, it is not an `IEnumerable<T>`,
so `.Select(...)` on it fails with CS1061. `HasSingleTarget` (same version)
tells you whether a delegate is multicast without allocating.

### Method groups and caching

Converting a method name to a delegate is a method group conversion. Since
C# 11 the compiler caches the delegate for a static method group in a hidden
static field, like it already did for non-capturing lambdas. The IL of
`Func<int, int> f = Square; return f(x);`, read with `ilspycmd -il` and
trimmed:

```text
IL_0001: ldsfld class System.Func`2<int32, int32> Ops/'<>O'::'<0>__Square'
IL_0007: brtrue.s IL_001c
IL_000b: ldftn int32 Ops::Square(int32)
IL_0011: newobj instance void class System.Func`2<int32, int32>::.ctor(object, native int)
IL_0017: stsfld class System.Func`2<int32, int32> Ops/'<>O'::'<0>__Square'
IL_001f: callvirt instance !1 class System.Func`2<int32, int32>::Invoke(!0)
```

An instance method group cannot be cached, because the target differs per
object: `Transform t = calc.Add1;` measured 64 bytes per conversion, a static
one 0. The closures concept covers what lambdas allocate.

### Function pointers (C# 9)

A function pointer is the address of a static method with a typed signature.
It needs an `unsafe` context (and `AllowUnsafeBlocks`), and the call is a
`calli` instruction instead of `callvirt Invoke` on an object:

```csharp
unsafe static int ViaPointer(int x)
{
    delegate*<int, int> p = &Square;   // IL: ldftn Ops::Square, then calli int32(int32)
    return p(x);
}
```

No object, no allocation (0 bytes measured), no invocation list, no target.
Taking `&c.Add1` of an instance method fails with error CS8759 "Cannot create
a function pointer for 'C.Add1(int)' because it is not a static method", and
using `delegate*` outside `unsafe` is error CS0214. `delegate* unmanaged[Cdecl]<...>` calls native code
with a given calling convention. Outside interop and very hot low-level loops,
a delegate is the safer default.

## Trade-offs

- **Delegates are objects.** Each instance method group or capturing lambda
  allocates, and a stored delegate keeps its `Target` alive. Static method
  groups and non-capturing lambdas are cached.
- **Multicast keeps only the last result.** Use
  `Delegate.EnumerateInvocationList` when you need all results or want to
  isolate failures.
  ```csharp
  foreach (var v in Delegate.EnumerateInvocationList(validators)) results.Add(v(input));
  ```
- **Removal is by equality, not by identity of the source text.** Lambdas
  cannot be unsubscribed unless you kept the instance.
- **`Func`/`Action` versus custom types.** The generic family is
  interchangeable across libraries; a custom type supports `ref`/`out` and a
  meaningful name, but does not convert to `Func` without a wrapper.
- **Function pointers trade safety for speed.** `unsafe`, static methods only,
  no multicast. Measure before reaching for them.

## Documentation Links

- [Delegates, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/) (doc)
- [Using delegates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/using-delegates) (doc)
- [How to combine delegates (multicast delegates), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/how-to-combine-delegates-multicast-delegates) (doc)
- [Subtraction operator: delegate removal, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/subtraction-operator) (doc)
- [Delegate.EnumerateInvocationList method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.delegate.enumerateinvocationlist) (doc)
- [MulticastDelegate class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.multicastdelegate) (doc)
- [Unsafe code and function pointers, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/unsafe-code) (doc)
- [C# language version history (C# 9 function pointers, C# 11 method group conversion), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
