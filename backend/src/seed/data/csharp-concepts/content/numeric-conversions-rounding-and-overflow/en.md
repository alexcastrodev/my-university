---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Moving a number from one type to another can lose information in four
different ways: the value does not fit, the fraction is dropped, precision is
rounded away, or the sign bit changes meaning. C# lets you pick the behavior,
but the default depends on the kind of conversion, and the three tools people
reach for (a cast, `System.Convert` and `Math.Round`) disagree with each other
about `2.5`. This concept covers the implicit and explicit conversion rules,
what `checked` and `unchecked` really change (and what they do not), the
rounding modes behind `Math.Round`, `Convert` and `ToString("F2")`, and the
APIs that choose the overflow policy explicitly. It builds on the bit-level
view of the previous concept (`numeric-types-and-binary-representation`).

## Use Cases

- Converting a `double` from a calculation to an `int` index or a `byte` pixel
  value without surprises at the edges.
- Rounding money to cents the way the business rule says, not the way the
  default happens to work.
- Detecting integer overflow in totals, counters, sizes and hash computations.
- Narrowing generic numbers (`TTo.CreateChecked`) in library code.
- Reading code that mixes `(int)x`, `Convert.ToInt32(x)` and `Math.Round(x)`
  and knowing exactly how each differs.

## Deep Dive

Output comes from .NET 10 (SDK 10.0.100) on arm64, with
`CultureInfo.InvariantCulture`. Where a result is platform dependent, the text
says so.

### Implicit conversions: widening, not always lossless

The compiler allows an implicit conversion when every value of the source type
fits the target. Examples: `byte` to `short`, `int` to `long`, `float` to
`double`, any integer to `decimal`. The table is in the Microsoft Learn page on
built-in numeric conversions. Three rules matter in practice:

- Any integer type converts implicitly to `float`, `double` and `decimal`. The
  conversion keeps the order of magnitude but not always every digit.
- There is no implicit conversion between `decimal` and `float` or `double` in
  either direction, so mixing them in an expression is a compile error.
- A constant `int` expression converts implicitly to a narrower type when its
  value fits (`byte b = 17;`), and is error CS0031 when it does not
  (`byte b = 300;`).

The lossy implicit conversions are `int`/`uint`/`long`/`ulong` to `float` and
`long`/`ulong` to `double`:

```csharp
int i = 123_456_789;
float f = i;                 // 123456790
(int)f                       // 123456792   (not the original value)
(double)i                    // 123456789   (double has room for an int)

long big = 9_007_199_254_740_993;
double bd = big;             // 9007199254740992
(float)16777217              // 16777216
```

Arithmetic promotes both operands to a common type: `int + long` is `long`,
`int + float` and `long + float` are `float` (so a `long` can lose digits in a
`float` sum), `int + double` is `double`, `int + decimal` is `decimal`. Types
smaller than `int` are promoted to `int` first, which is why
`char + int` is `int` while `(char)(ch + 1)` is a `char` and `ch++` stays a
`char` (`'A'` becomes `'B'`).

### Explicit conversions: casts and what they do

A cast is a request to the compiler. The result depends on the pair of types.

**Integer to integer** keeps the low bits (unchecked) or throws (checked):

```csharp
unchecked((byte)300)               // 44      300 = 1_0010_1100, low 8 bits = 0010_1100
unchecked((sbyte)200)              // -56
unchecked((short)70000)            // 4464
unchecked((uint)-1)                // 4294967295
unchecked((int)3_000_000_000L)     // -1294967296
```

**Floating point to integer** truncates toward zero, it does not round:

```csharp
(int)-3.7     // -3
(int)3.7      // 3
(int)2.5      // 2
(long)-0.9    // 0
(int)-3.7m    // -3      decimal also truncates
```

**Out of range, NaN and infinity.** The language spec leaves the result of an
unchecked out-of-range `double` to integer cast unspecified. Since .NET 9 the
runtime made `double`/`float` to `int`, `uint`, `long` and `ulong` conversions
saturate on x86 and x64 (the breaking-change page says so), and on this arm64
machine .NET 10 gave the same:

```csharp
(int)1e20                 // 2147483647
(int)-1e20                // -2147483648
(int)double.NaN           // 0
(int)double.PositiveInfinity   // 2147483647
(uint)-1.0                // 0
(uint)5e9                 // 4294967295
(ulong)-5.0               // 0
(long)1e30                // 9223372036854775807
```

For the small types the result in .NET 10 went through `int` and then wrapped:
`(byte)300.0` is `44`, `(byte)-5.0` is `251`, `(sbyte)1e10` is `-1`. The
Microsoft Learn compatibility pages say that .NET 11 makes conversions to
`sbyte`, `byte`, `short`, `ushort` and `char` saturating as well, so do not
depend on the .NET 10 values for those types. Treat out-of-range
floating-point casts as "validate first or use `checked`".

**`double` to `float`** rounds to the nearest `float`, and becomes `Infinity`
or `0` when out of range (`(float)1e40` is `Infinity`, `(float)1e-50` is `0`).
`(double)(float)0.1` is `0.10000000149011612`: widening back does not recover
the digits.

**To and from `decimal`.** `(decimal)` of a `double` rounds to about 15
significant digits, and `NaN`, infinities and values beyond about 7.9e28 throw
`OverflowException`; a value too small becomes `0` (`(decimal)1e-30` is `0`).
`(int)` of a `decimal` truncates and throws when it does not fit,
regardless of the checked context. The documentation for .NET 11 Preview 7
lists a change so that `decimal` and `double` conversions are correctly rounded
(a `double` such as `1.23` would convert to its exact value
`1.229999999999999982236431606`). That is not in .NET 10, so the 15-digit
behavior above is what a .NET 10 program sees.

### `checked` and `unchecked`

Integer arithmetic and conversions run in an overflow-checking context. The
default is unchecked: the result is truncated to the low bits.

```csharp
int max = int.MaxValue;
max + 1                       // -2147483648
max * 2                       // -2
(short)max                    // -1
int acc = 1; for (int i = 1; i <= 13; i++) acc *= i;   // 13! = 1932053504 (wrong)
```

You switch the context for a block or for one expression:

```csharp
checked { v++; }                        // OverflowException
checked(a + b)                          // OverflowException
checked((byte)300)                      // OverflowException
checked((int)3e9)                       // OverflowException  (double to int)
checked((int)double.NaN)                // OverflowException
checked((int)-3.7)                      // -3  (in range after truncation, no exception)
checked((uint)-1)                       // OverflowException
```

The operations affected are `++`, `--`, unary `-`, binary `+ - * /` on integral
types and enums, and explicit conversions between integral types or from
`float`/`double` to an integral type. Not affected: shifts and bitwise
operators, `decimal` (it always throws), and `float`/`double` arithmetic (they
give `Infinity`; `checked((float)1e40)` is still `Infinity`).

Two details that cause real bugs:

**The scope is textual.** The context covers the expressions written inside
the block or the parentheses, not the methods they call:

```csharp
static int Mul(int a, int b) => a * b;
checked { return Mul(2, int.MaxValue); }        // -2, no exception: Mul is unchecked
checked { return Mul(2, 2 * int.MaxValue); }    // OverflowException: 2 * int.MaxValue is written inside
checked(x * y) / z                              // the multiplication is checked
(x * y) / z                                     // unchecked: 100000 * 100000 / 1000 = 1410065
(long)x * y / z                                 // 10000000: widen before multiplying
```

A lambda written inside the block is checked, because its body is textually
there.

**Constants are checked by default at compile time.** The compiler rejects
overflowing constant expressions, so `int a = int.MaxValue + 1;` is error
CS0220, `byte b = 300;` is CS0031, `(byte)300` is CS0221 ("use `unchecked`
syntax to override") and `(decimal)double.NaN` is CS0031. You need
`unchecked(...)` to get the wrapped constant on purpose.

The default can be flipped for a project with
`<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>` (a file-based app
accepts `#:property CheckForOverflowUnderflow=true`). With it on, every
non-constant integer overflow in your own code throws, including hashes written
as `h = h * 31 + c`; that loop threw on a 43-character string, so use
`unchecked(...)` explicitly there, and it returned `1972221122`. Framework code
is compiled separately and is not affected (`HashCode.Combine` and
`string.GetHashCode` ran fine). Shifts still wrap (`int.MaxValue << 1` is
`-2`).

Division has one case that is never unchecked: integer division by zero throws
`DivideByZeroException`, and `int.MinValue / -1` throws `OverflowException`
(the documentation says an `ArithmeticException` can be thrown) even inside
`unchecked`. In the experiment `int.MinValue % -1` threw too.

What the compiler emits is simple. For `a + b` it is `add`, for
`checked(a + b)` it is `add.ovf`, for `checked(a * b)` `mul.ovf`, and for a
narrowing cast `conv.u1` versus `conv.ovf.u1` (bytes `58`, `D6`, `D8`, `D2`,
`B4` in the method bodies I dumped). The checked form costs a branch and a
flag test, so it is cheap but not free in tight numeric loops.

### Rounding: cast, `Math.Round`, `Convert` and formatting

`Math.Round(double)` and `Math.Round(decimal)` use `MidpointRounding.ToEven`
by default (banker's rounding): a value exactly halfway goes to the nearest
even integer. The other modes are `AwayFromZero`, and three directed modes,
`ToZero`, `ToNegativeInfinity` and `ToPositiveInfinity`, which
round every value and not just midpoints.

```csharp
//    x  (int)  Round  ToEven AwayFromZero ToZero ToNegInf ToPosInf Floor Ceiling Truncate Convert.ToInt32
//  -2.5   -2     -2     -2        -3        -2     -3       -2      -3    -2      -2       -2
//  -1.5   -1     -2     -2        -2        -1     -2       -1      -2    -1      -1       -2
//   0.5    0      0      0         1         0      0        1       0     1       0        0
//   1.5    1      2      2         2         1      1        2       1     2       1        2
//   2.5    2      2      2         3         2      2        3       2     3       2        2
//   3.5    3      4      4         4         3      3        4       3     4       3        4
//   2.6    2      3      3         3         2      2        3       2     3       2        3
//  -2.6   -2     -3     -3        -3        -2     -3       -2      -3    -2      -2       -3
```

`Convert.ToInt32(double)` rounds with the same rule as `Math.Round`
(`Convert.ToInt32(2.5)` is `2`, `3.5` is `4`, `2.51` is `3`), while the cast
truncates. `Math.Round(-0.4)` is `-0` (negative zero), and it prints as `-0`.

Digits are where `double` and `decimal` differ. `Math.Round(double, digits)` in
the .NET 10 source multiplies by a power of ten, rounds the product, and
divides back, and it accepts 0 to 15 digits; `decimal` rounds the exact decimal
value and accepts 0 to 28. A negative digit count throws
`ArgumentOutOfRangeException` for both.

```csharp
Math.Round(2.675, 2)                 // 2.68   (2.675 * 100 = 267.5 in double, then to even)
Math.Round(2.675m, 2)                // 2.68
2.675.ToString("F2")                 // 2.67   (formatting uses the exact stored value 2.67499999...)
Math.Round(1.005, 2)                 // 1      (1.005 * 100 = 100.49999999999999)
Math.Round(1.005m, 2)                // 1.00
Math.Round(1.005m, 2, MidpointRounding.AwayFromZero)  // 1.01
Math.Round(1.015m, 2)                // 1.02   (101.5 goes to the even 102)
Math.Round(1.015, 2)                 // 1.01   (1.015 is stored just below)
Math.Round(0.125, 2)                 // 0.12
Math.Round(0.125, 2, MidpointRounding.AwayFromZero)   // 0.13
```

Two takeaways. First, the same call on `double` and on `decimal` can differ
because the `double` literal is not the number you typed. Second, formatting is
a third rounding implementation: in this run `0.5.ToString("F0")` was `0` and
`2.5.ToString("F0")` was `2` for `double` but `1` and `3` for `decimal`, and
`0.125.ToString("N2")` was `0.12` against `0.125m.ToString("N2")` giving
`0.13`. If a figure is shown and also stored, round once, explicitly, with the
mode the rule names, and format the rounded value.

Rounding each part and rounding the total are different results:

```csharp
Math.Round(1.005m, 2) + Math.Round(1.005m, 2)   // 2.00
Math.Round(1.005m + 1.005m, 2)                  // 2.01
Math.Round(10m / 3, 2) * 3                      // 9.99, a cent is missing
```

Money rules usually say where the rounding happens (per line or per invoice)
and where the leftover cent goes; encode that decision, not a call to
`Math.Round`.

### `System.Convert`

`Convert` is a family of static methods. For numbers it behaves differently
from a cast in these ways:

```csharp
Convert.ToInt32(2.51)             // 3      rounds (to even at the midpoint); (int)2.51 is 2
Convert.ToInt32(3e9)              // OverflowException (always checked)
Convert.ToByte(300)               // OverflowException
Convert.ToInt32(uint.MaxValue)    // OverflowException
Convert.ToInt32(double.NaN)       // OverflowException
Convert.ToInt32(true)             // 1
Convert.ToInt32('7')              // 55   the code point, not 7
Convert.ToInt32("42")             // 42
Convert.ToInt32((string?)null)    // 0    null becomes zero
Convert.ToInt32("4.5")            // FormatException
Convert.ToBoolean("yes")          // FormatException
Convert.ToInt32(new object())     // InvalidCastException (not IConvertible)
Convert.ToString(255, 2)          // 11111111
Convert.ToInt32("ff", 16)         // 255
Convert.ToInt32("102", 2)         // FormatException
Convert.ChangeType(12.7, typeof(int))   // 13
```

Two traps are visible in that list. `Convert` with a `null` string returns `0`
instead of failing, which hides a missing value; and `Convert.ToInt32(string)`
uses the current culture, so `Convert.ToDouble("1,5")` returned `15` under
the invariant culture and `Convert.ToDouble("1.5", new CultureInfo("pt-BR"))`
also returned `15` (`.` is a group separator there). Parsing with an explicit
culture is covered in `parsing-tryparse-and-the-try-pattern`.

The base-2, 8, 10 and 16 overloads read and write two's complement text:
`Convert.ToString(-1, 16)` is `ffffffff` and a 32-digit string of ones with
base 2 parses to `-1`.

### Choosing the policy in code: `checked`, saturate, truncate, clamp

The generic-math interfaces make the policy part of the call.
`TTo.CreateChecked`, `CreateSaturating` and `CreateTruncating` exist on every
numeric type:

```csharp
byte.CreateChecked(300)        // OverflowException
byte.CreateSaturating(300)     // 255
byte.CreateSaturating(-5)      // 0
byte.CreateTruncating(300)     // 44        low bits, like unchecked
int.CreateSaturating(3e9)      // 2147483647
int.CreateChecked(double.NaN)  // OverflowException
int.CreateSaturating(double.NaN)   // 0
int.CreateTruncating(-3.7)     // -3
int.CreateTruncating(uint.MaxValue)  // -1

static TTo Narrow<TFrom, TTo>(TFrom v)
    where TFrom : INumberBase<TFrom> where TTo : INumberBase<TTo>
    => TTo.CreateChecked(v);
Narrow<long, short>(70000L)    // OverflowException
```

`Math.Clamp(300, 0, 255)` is the readable saturation for a value you already
hold in a wider type.

Some framework APIs are checked no matter what your project says:
`Math.Abs(int.MinValue)`, `Enumerable.Sum` over `int` or `long`
(`new[] { int.MaxValue, 1 }.Sum()` throws), `new int[-1]` and
`Math.DivRem(int.MinValue, -1)` all threw `OverflowException`, while
`Aggregate(0, (a, b) => a + b)` wrapped to `-2147483648` and `Sum(x => (long)x)`
gave `2147483648`. `Average()` of two `int.MaxValue` values is correct
(`2147483647`) because it accumulates in a `long`.

### User-defined checked operators and conversions

Since C# 11 a type can supply a `checked` variant of arithmetic operators and
explicit conversions. A checked context calls it, an unchecked context calls
the plain one, and you must define the plain operator too:

```csharp
readonly record struct Pct(byte Value)
{
    public static Pct operator +(Pct a, Pct b) => new(unchecked((byte)(a.Value + b.Value)));
    public static Pct operator checked +(Pct a, Pct b) => new(checked((byte)(a.Value + b.Value)));
    public static explicit operator Pct(int v) => new(unchecked((byte)v));
    public static explicit operator checked Pct(int v) => new(checked((byte)v));
}

new Pct(200) + new Pct(100)               // 44%
checked(new Pct(200) + new Pct(100))      // OverflowException
(Pct)300                                  // 44%
checked((Pct)300)                         // OverflowException
```

Per the documentation, the `checked` keyword on the operator does not change
the context inside its body; the body uses `checked`/`unchecked` explicitly,
as above.

## Trade-offs

- **Unchecked is the default because it is fast and sometimes wanted.** Hashes,
  checksums and random generators rely on wrap-around. The cost is that a
  counter or a sum can silently go negative; put `checked` around money, sizes
  and indexes, and `unchecked` around hash code.
- **Project-wide `CheckForOverflowUnderflow` is a safety net with a price.** It
  catches every silent overflow in your code, and it also breaks hand-written
  hash functions until you mark them `unchecked`. Turn it on in applications
  and tests, decide per library.
- **A cast is the shortest way to say "I accept the loss", and it says
  nothing about which loss.** `(int)x` truncates, `Math.Round` goes to even,
  and `Convert.ToInt32` rounds and throws. Name the intent in the code
  (`Math.Round(x, MidpointRounding.AwayFromZero)`, `int.CreateSaturating(x)`).
- **Banker's rounding is statistically fair and surprising to users.** It
  avoids a bias when summing many rounded halves, but a price list that shows
  `2.5` becoming `2` looks wrong. Pick the mode from the business rule, and
  prefer `decimal` so the midpoint is a real midpoint.
- **`Convert` is convenient at boundaries and lenient in the wrong places.**
  A `null` becomes `0` and the culture is implicit. For input, parse; for a
  known-good numeric narrowing, use a cast inside `checked` or `CreateChecked`.
- **Saturating hides the problem that checked reveals.** Clamping a sensor
  reading to a `byte` is fine; clamping a payment amount is a bug waiting for
  an audit. Use saturation where the maximum is a legitimate answer.
- **Relying on out-of-range floating-point casts is relying on the runtime
  version.** The result changed between .NET 8 and .NET 9, and the small
  integer types change again in .NET 11. Validate range and `NaN` first.

## Lab

In this lab you get the **stubbed** static class `Conversions`, with six methods that throw `NotImplementedException`, plus ready xUnit tests. Your job is to implement them. The core idea is to choose the conversion, the rounding mode and the overflow policy explicitly, instead of trusting the default of a cast, of `Convert` or of `Math.Round`. Each method has an edge case where the obvious code gives a wrong or silent result (NaN, halves, wrap-around).

**The scenario**

Small numeric converters that show up in any system: pixel brightness, money in cents, indexes and sums.

- `ToPixel` and `RoundToCents`: rounding with a business rule (`double` to `byte` and `decimal` to two decimals).
- `ToIndex` and `ToIntWithConvert`: two ways to go from `double` to `int`, with different rules for the fractional part.
- `SumExact` and `TryAddExact`: `int` addition without silent overflow, one throwing and the other following the Try pattern.

Everything lives in `Conversions.cs`, and the tests in `ConversionTests.cs` pin the edge values.

**What you will do, step by step**

1. **Safe pixel (TODO-00).** In `ToPixel`, round halves away from zero (2.5 becomes 3), clamp the value to 0..255 and map NaN to 0. A plain `(byte)` cast gives unspecified results outside the range, so clamp before converting.
2. **Round money (TODO-01).** In `RoundToCents`, round to two decimals with halves going away from zero (2.345 becomes 2.35, -2.345 becomes -2.35). The default `Math.Round` uses banker's rounding, so choose the `MidpointRounding` mode explicitly.
3. **Truncate and fail loudly (TODO-02).** In `ToIndex`, truncate toward zero (2.9 becomes 2, -2.9 becomes -2) and throw `OverflowException` for NaN, infinities and values outside the `int` range. A cast without `checked` returns garbage in those cases.
4. **Know `Convert` (TODO-03).** In `ToIntWithConvert`, use `System.Convert`: `Convert.ToInt32` rounds to the nearest integer and sends halves to the even neighbor (2.5 becomes 2, 3.5 becomes 4), unlike the truncating cast.
5. **Detect the wrap-around (TODO-04).** In `SumExact`, add the values and throw `OverflowException` when the total does not fit in an `int`. Without `checked`, `int` addition wraps silently, both upward and downward.
6. **The Try pattern (TODO-05).** In `TryAddExact`, return `true` and the sum when it fits, and `false` with `result = 0` when it does not, with no exception for an expected failure.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `ToIntWithConvert(2.5)` gives 2 while `ToIndex(2.9)` gives 2 for a different reason, and when to prefer `SumExact` over `TryAddExact`.

**Optional challenges**

None of the three has a stub or a test, so you write both.

- **TODO-06:** `NarrowChecked<TFrom, TTo>` using `TTo.CreateChecked`.
- **TODO-07:** `AddSaturating`, which clamps the result to the `int` range instead of throwing or wrapping.
- **TODO-08:** `SplitEvenly`, which splits an amount into parts that add up to the exact total.

**Prerequisites:** C# numeric types, `checked` and `unchecked`, exceptions and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The stubbed methods throw `NotImplementedException`, so red tests are your checklist, and the `TODO-NN` comments explain the edge case of each one.

## Documentation Links

- [Built-in numeric conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/numeric-conversions) (doc)
- [The checked and unchecked statements, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked) (doc)
- [Arithmetic operators, overflow and user-defined checked operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators) (doc)
- [MidpointRounding enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.midpointrounding) (doc)
- [Math.Round method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.math.round) (doc)
- [Convert class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.convert) (doc)
- [Floating point-to-integer conversions are saturating (.NET 9), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer) (doc)
- [CheckForOverflowUnderflow compiler option, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language#checkforoverflowunderflow) (doc)
