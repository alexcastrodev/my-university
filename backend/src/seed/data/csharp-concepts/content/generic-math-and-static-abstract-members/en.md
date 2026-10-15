---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Before .NET 7, a method that added numbers needed one overload per type, or a
detour through `object` and casts, because a type parameter `T` had no `+`.
Generic math fixes that with two pieces that shipped together: C# 11 lets an
interface declare `static abstract` and `static virtual` members (operators
included), and .NET 7 added a family of interfaces in `System.Numerics` that
every built-in numeric type implements. This concept shows how to pick the
smallest constraint for an algorithm, how to plug your own type in, where
integer division and overflow bite in generic code, and what the JIT actually
produces. The `static abstract` mechanism itself was introduced in
the interfaces concept; here it
is put to work.

## Use Cases

- One `Sum`, `Average` or `Clamp` for `int`, `double`, `decimal`,
  `BigInteger` and your own value types, instead of a block of overloads.
- Domain types (`Money`, `Vector2`, `Meters`) that take part in the same
  algorithms as built-in numbers by implementing only the operators they need.
- Library code that parses, converts and computes without knowing the exact
  numeric type (`IParsable<T>`, `CreateChecked`).
- Bit manipulation written once for every integer width (`IBinaryInteger<T>`).

## Deep Dive

### The interface family

The interfaces are layered. The coarse ones describe a kind of number; the
fine ones describe a single capability:

| Interface | Gives you |
|---|---|
| `INumberBase<T>` | `T.Zero`, `T.One`, `CreateChecked/Saturating/Truncating`, `IsNaN`, `IsInteger` and the basic operators |
| `INumber<T>` | adds comparison: `T.Clamp`, `T.Max`, `T.Min`, `T.Sign` |
| `IBinaryInteger<T>` | `PopCount`, `LeadingZeroCount`, `RotateLeft`, `DivRem` |
| `IFloatingPointIeee754<T>` | `T.NaN`, `T.Pi`, `T.Epsilon`, trigonometric and log functions |
| `IAdditionOperators<TSelf, TOther, TResult>` and siblings | one operator each: `+`, `-`, `*`, `/`, `%`, `<<`, `==`, `<` |
| `IAdditiveIdentity<TSelf, TResult>` | `T.AdditiveIdentity` (the zero for `+`) |

The operator interfaces have three type parameters so that input and result
can differ, and they deliberately do not pair operations: the docs give
`Matrix4x4`, which supports `*` but not `/`. All of this lives in
`System.Numerics`, except the parsing interfaces (`IParsable<T>`), which are in
`System` and were covered in the parsing concept.

### A generic `Sum`: ask for the least

`INumber<T>` is the obvious constraint, but a sum only needs `+` and a zero.
Asking for exactly that lets types that are not "numbers" join in:

```csharp
using System.Numerics;

static T Sum<T>(IEnumerable<T> values)
    where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T total = T.AdditiveIdentity;
    foreach (var v in values) total += v;
    return total;
}

readonly record struct Money(long Cents)
    : IAdditionOperators<Money, Money, Money>, IAdditiveIdentity<Money, Money>
{
    public static Money operator +(Money a, Money b) => new(a.Cents + b.Cents);
    public static Money AdditiveIdentity => new(0);
}

Sum<int>([1, 2, 3])                          // 6
Sum<double>([0.5, 0.25])                     // 0.75
Sum<decimal>([0.1m, 0.2m])                   // 0.3
Sum<BigInteger>([BigInteger.Pow(2, 100), 1]) // 1267650600228229401496703205377
Sum<Money>([new(1050), new(250)])            // Money { Cents = 1300 }
```

`T.AdditiveIdentity` and `+` are static members reached through the type
parameter. `Money` is not a number, has no `/` and no comparison, and still
works because it implements only the two capabilities the algorithm asked for.
`total += v` compiles because a compound assignment uses the `+` the
constraint provides.

The coarse interfaces pay off when you need many capabilities at once:

```csharp
static T Clamp01<T>(T v) where T : INumber<T> => T.Clamp(v, T.Zero, T.One);
static T Bits<T>(T v) where T : IBinaryInteger<T> => T.PopCount(v);

Clamp01(1.7) + " " + Clamp01(-2f) + " " + Clamp01(0.5m)   // 1 0 0.5
Bits(255) + " " + Bits(255UL) + " " + Bits((byte)7)       // 8 8 3
```

### Mixing types: the integer division trap

Generic code runs the operators of the type it receives, including integer
division:

```csharp
static T Average<T>(IReadOnlyList<T> values) where T : INumber<T>
    => Sum(values) / T.CreateChecked(values.Count);

static TResult AverageAs<T, TResult>(IReadOnlyList<T> values)
    where T : INumber<T> where TResult : INumber<TResult>
{
    TResult total = TResult.Zero;
    foreach (var v in values) total += TResult.CreateChecked(v);
    return total / TResult.CreateChecked(values.Count);
}

Average<int>([1, 2])                                 // 1  (int division)
AverageAs<int, double>([1, 2])                       // 1.5
AverageAs<int, long>([int.MaxValue, int.MaxValue])   // 2147483647, no overflow
```

A second type parameter for the result is the pattern the official docs use
for averages. Accumulating in a wider `TResult` also removes the overflow that
`Average<int>` would hit on large inputs. `CreateChecked` is the conversion
that throws when a value does not fit; its saturating and truncating siblings
are compared in
the numeric conversions concept.

### `checked` in generic code

A `checked` expression inside a generic method calls the type's checked
operator. `IAdditionOperators` declares that operator as `static virtual`, so a
type that writes only `+` still satisfies the constraint, and in a checked
context its plain `+` runs:

```csharp
static T SumChecked<T>(IEnumerable<T> values)
    where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T total = T.AdditiveIdentity;
    foreach (var v in values) total = checked(total + v);
    return total;
}

readonly record struct SafeMoney(long Cents) /* same interfaces as Money */
{
    public static SafeMoney operator +(SafeMoney a, SafeMoney b) => new(unchecked(a.Cents + b.Cents));
    public static SafeMoney operator checked +(SafeMoney a, SafeMoney b) => new(checked(a.Cents + b.Cents));
    public static SafeMoney AdditiveIdentity => new(0);
}

Sum<int>([int.MaxValue, 1])                               // -2147483648 (wraps)
SumChecked<int>([int.MaxValue, 1])                        // OverflowException
SumChecked<double>([double.MaxValue, double.MaxValue])    // Infinity
SumChecked<Money>([new(long.MaxValue), new(1)])           // Money { Cents = -9223372036854775808 }
SumChecked<SafeMoney>([new(long.MaxValue), new(1)])       // OverflowException
```

`checked` changes nothing for `double`, and it only protects your own type if
that type defines `operator checked`. Writing `checked` in the algorithm is a
request; each type decides whether to honor it.

### What the JIT produces

The generics concept showed that the
runtime compiles a separate copy of generic code for each value type. That is
what makes generic math cheap. For this `Sum<T>(ReadOnlySpan<T>)` constrained
to `INumberBase<T>`, `DOTNET_JitDisasm` on an Apple Silicon machine (Release,
tiered compilation off) printed the `int` instantiation as a plain loop
(trimmed, comments added):

```text
; Assembly listing for method Program:<<Main>$>g__Sum|0_0[int](System.ReadOnlySpan`1[int]):int (FullOpts)
            mov     w2, wzr            ; T.Zero
G_M000_IG04:
            ldr     w4, [x0, x3]
            add     w2, w4, w2         ; total += v
            add     x3, x3, #4
            sub     w1, w1, #1
            cbnz    w1, G_M000_IG04
```

No interface call, no boxing: `GC.GetAllocatedBytesForCurrentThread()` around a
call over 1,000 `int`s reported `0` bytes. The C# reference explains why: calls
to `static abstract` members have no runtime dispatch; they are resolved from
the type argument.

### Inside LINQ

`Enumerable.Sum` uses the same machinery. In the .NET 10 source, the
`IEnumerable<int>`, `long`, `float`, `double` and `decimal` overloads try to
get a span from the source and, when they can, call one private
`Sum<T, TResult>(ReadOnlySpan<T>)` constrained to `INumber<T>`. That method
vectorizes only `int` and `long` (when hardware acceleration is available and
the span is long enough) and keeps overflow checking on every path, which is
why `new[] { int.MaxValue, 1 }.Sum()` throws `OverflowException` while a
hand-written `+=` loop wraps.

### What the compiler refuses

```csharp
List<INumber<int>> list = [];
// error CS8920: The interface 'INumber<int>' cannot be used as type argument.
//   Static member 'IParsable<int>.Parse(string, IFormatProvider?)' does not have
//   a most specific implementation in the interface.
var z = INumber<int>.Zero;
// error CS8926: A static virtual or abstract interface member can be accessed
//   only on a type parameter.
```

These interfaces are constraints, not types for variables or collections. If
you want "a list of numbers of any type", generic math is the wrong tool.

## Trade-offs

- **Constraint size versus reach.** `INumber<T>` is easy to write but
  excludes types like `Money`. Fine-grained operator interfaces reach more
  types and make signatures long.
  ```csharp
  where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>   // Money fits
  where T : INumber<T>                                              // Money does not
  ```
- **Semantics follow the type.** The same code divides with truncation for
  `int`, ignores `checked` for `double`, and wraps or throws for your own type
  depending on its operators. Test the algorithm with each kind of type you
  promise to support.
- **Implementing `INumber<T>` yourself is large.** It pulls in parsing,
  formatting, comparison and a dozen operators. Implement only the small
  interfaces your algorithms need.
- **Not a polymorphism tool.** No runtime dispatch and no `INumber<int>`
  variables (CS8920, CS8926). Code that must handle numbers whose type is
  only known at run time still needs overloads, `switch` or `decimal`
  everywhere.
- **Application code rarely needs it.** The docs say library authors benefit
  most. For one concrete type, a non-generic method is simpler to read.

## Documentation Links

- [Generic math, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
- [interface keyword: static abstract and virtual members, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) (doc)
- [Tutorial: Explore static virtual members in interfaces, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/static-virtual-interface-members) (doc)
- [What's new in C# 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-11) (doc)
- [INumber<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.inumber-1) (doc)
- [IAdditionOperators<TSelf,TOther,TResult>.CheckedAddition, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.iadditionoperators-3.op_checkedaddition) (doc)
