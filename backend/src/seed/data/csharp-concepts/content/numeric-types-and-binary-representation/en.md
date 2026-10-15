---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Most numeric bugs in C# are not syntax errors. They come from what a number
really is in memory: a fixed number of bits, interpreted as two's complement
for integers, as an IEEE 754 binary fraction for `float` and `double`, and as a
96-bit integer with a decimal scale for `decimal`. This concept explains those
three representations, so that `0.1 + 0.2`, `int.MinValue`, `NaN`, `1 << 32`
and `1.0m` versus `1.00m` stop being surprises. It also covers the shift
operators (including `>>>`), the newer types `Half`, `Int128` and the
native-sized `nint`, and how to choose a type for money and for measurements.
Conversions, rounding and overflow are the next concept
(`numeric-conversions-rounding-and-overflow`).

## Use Cases

- Choosing between `double` and `decimal` for prices, taxes, sensor readings
  and scores.
- Packing flags and fields into an integer, and reading them back with masks
  and shifts.
- Comparing computed floating-point results in a unit test or a business rule.
- Understanding wrong results at the edges: `Math.Abs(int.MinValue)`, a `float`
  counter that stops counting, a `NaN` that breaks sorting.
- Interop and low-level code where the size of an integer matters (`nint`,
  `Int128`, `Half` for ML data).

## Deep Dive

All output below comes from .NET 10 with `CultureInfo.InvariantCulture`; with
a pt-BR or de-DE culture the decimal point prints as a comma (see
`formatting-values-and-interpolated-strings`).

### Integer types and literals

The integral keywords are aliases of .NET types: `int` is `System.Int32`, and
the table below was printed with `Unsafe.SizeOf<T>()` and `MinValue`/`MaxValue`:

```csharp
sbyte  1 -128..127              byte   1 0..255
short  2 -32768..32767          int    4 -2147483648..2147483647
uint   4 0..4294967295          long   8 -9223372036854775808..9223372036854775807
ulong  8 0..18446744073709551615
Int128 16 -170141183460469231731687303715884105728..170141183460469231731687303715884105727
```

A literal can use `_` as a digit separator and a `0b` or `0x` prefix:
`1_000_000`, `0b1010_1010` (170) and `0xFF_FF` (65535). Its type is the first
of `int`, `uint`, `long`, `ulong` that can hold the value, so literals do not
carry a sign:

```csharp
0xFFFFFFFF.GetType()   // System.UInt32
2147483648.GetType()   // System.UInt32   (does not fit int, so it is uint, not a negative int)
0x7FFFFFFF.GetType()   // System.Int32
0xFFFFFFFFF.GetType()  // System.Int64
unchecked((int)0xFFFFFFFF)  // -1
```

Arithmetic on `byte`, `sbyte`, `short` and `ushort` happens in `int`:
`(byte)200 + (byte)100` is `300` and its type is `System.Int32`, and so is
`short + short`. That is why `byte c = a + b;` needs a cast.

### Two's complement

A signed integer uses its top bit as a weight of minus 2^(n-1) instead of a
sign flag. To negate, invert all bits and add one:

```csharp
Convert.ToString(5, 2).PadLeft(32, '0')   // 00000000000000000000000000000101
Convert.ToString(~5, 2)                   // 11111111111111111111111111111010   ~5 == -6
Convert.ToString(-5, 2)                   // 11111111111111111111111111111011
-5 == ~5 + 1                              // true
(-5).ToString("X8")                       // FFFFFFFB
```

Two consequences follow. The range is asymmetric: there is one more negative
value than positive, so `-int.MinValue` has no representation. In an unchecked
context it silently stays `-2147483648`, and `Math.Abs(int.MinValue)` throws
`OverflowException` ("Negating the minimum value of a twos complement number
is invalid."). And casting between signed and unsigned reinterprets the same
bits: `unchecked((int)uint.MaxValue)` is `-1`, `unchecked((uint)-5)` is
`4294967291` and `unchecked((byte)-5)` is `251`.

One trap when printing: `Convert.ToString(value, toBase)` has no `sbyte`
overload, so `Convert.ToString((sbyte)-1, 2)` widens to `short` and prints 16
ones, not 8. Cast to `byte` first to see `11111111`.

### Shifts, masks and `BitOperations`

`<<` and `>>` move bits. `>>` on a signed type is an arithmetic shift (copies the
sign bit), on an unsigned type it is logical (fills with zero). `>>>`, added
in C# 11, is always logical, so you no longer need to cast to `uint` and back:

```csharp
int n = -16;
n >> 2          // -4
n >>> 2         // 1073741820   (hex 3FFFFFFC)
n << 1          // -32
```

The shift count is masked to the width of the left operand: five bits for
`int`/`uint`, six for `long`/`ulong`. A count that is too large does not give
zero, it wraps:

```csharp
1 << 31   // -2147483648
1 << 32   // 1
1 << 33   // 2
1L << 32  // 4294967296
1L << 64  // 1
```

Shifts and the bitwise operators never overflow and behave the same in
`checked` and `unchecked` contexts. A flag set is the classic use:

```csharp
uint flags = 0;
flags |= 1u << 2;  flags |= 1u << 0;     // 101
(flags & (1u << 2)) != 0                 // true
flags & ~(1u << 2)                       // 1  (bit cleared)
```

For counting and searching bits, use the hardware-backed helpers instead of
loops. `System.Numerics.BitOperations` and the matching static methods on the
integer types (`int.PopCount`, `uint.RotateRight`, `int.Log2`) gave:

```csharp
BitOperations.PopCount(255u)            // 8
BitOperations.LeadingZeroCount(1u)      // 31
BitOperations.TrailingZeroCount(8u)     // 3
BitOperations.IsPow2(64)                // True
BitOperations.Log2(1000)                // 9
BitOperations.RotateLeft(0x80000001u, 1)  // 00000003
BitOperations.RoundUpToPowerOf2(1000u)  // 1024
```

### IEEE 754: how `double` stores a number

A `double` is 64 bits: one sign bit, 11 exponent bits and 52 fraction bits. The
value is (-1)^sign x 1.fraction x 2^(exponent - 1023). Because the fraction is
binary, only sums of powers of two are exact. 0.1 is not one of them, so the
stored value is the nearest representable double, which is slightly above 0.1:

```csharp
1.0  : 0 01111111111 0000...0000   0x3FF0000000000000
0.1  : 0 01111111011 1001100110011001100110011001100110011001100110011010   0x3FB999999999999A
-2.5 : 1 10000000000 0100...0000   0xC004000000000000

0.1.ToString("F25")                 // 0.1000000000000000055511151
0.1 + 0.2                           // 0.30000000000000004
(0.1 + 0.2) == 0.3                  // False
(0.1 + 0.2).ToString("F20")         // 0.30000000000000004441
0.3.ToString("F20")                 // 0.29999999999999998890
```

The two results are neighbours: they differ by one unit in the last place
(`BitConverter.DoubleToInt64Bits` of both differ by 1). `ToString()` prints the
shortest text that round-trips, which is why the digits look short but
`F20` shows the truth. `float` has the same problem with a 23-bit fraction
(0.1f is exactly `0.100000001490116...`); it just happens that `0.1f + 0.2f ==
0.3f` is `true`, which hides the issue until a later calculation.

The precision is relative, not absolute. A `double` has a 53-bit significand,
so above 2^53 it can no longer represent every integer. A `float` stops at
2^24:

```csharp
9007199254740992.0 + 1       // 9007199254740992   (the +1 is lost)
9007199254740992.0 + 2       // 9007199254740994
(float)16777216 + 1f         // 16777216
Math.BitIncrement(1.0) - 1.0 // 2.220446049250313E-16
Math.BitIncrement(1e16) - 1e16  // 2   (gap between neighbours near 1e16)
```

Errors accumulate in loops. Adding `0.1` ten times:

```csharp
double  0.9999999999999999   == 1.0 ? False
float   1.0000001            == 1.0f ? False
decimal 1.0                  == 1.0m ? True
```

and adding `0.1f` one million times in a `float` ends at `100958.34`, not
100000, because every addition rounds to the nearest `float` and the rounding
errors pile up.

### NaN, Infinity and negative zero

Floating-point arithmetic does not throw for division by zero. It returns
special values, while integer and `decimal` division by zero throws
`DivideByZeroException`:

```csharp
1.0 / 0            // Infinity
-1.0 / 0           // -Infinity
0.0 / 0            // NaN
Math.Sqrt(-1)      // NaN
Math.Log(0)        // -Infinity
double.MaxValue * 2   // Infinity
1.0 % 0            // NaN
```

`NaN` is not equal to anything, including itself, and every ordered comparison
is false. The `Equals` and `CompareTo` methods are the exception: they treat
`NaN` as equal to itself and smaller than any other value, so that sorting and
hash tables are consistent:

```csharp
double nan = double.NaN;
nan == nan            // False
nan != nan            // True
nan < 1, nan > 1      // False, False
nan.Equals(nan)       // True
nan.CompareTo(1.0)    // -1
double.IsNaN(nan)     // True

new List<double> { 3, double.NaN, 1, 2 }.Sort()   // NaN, 1, 2, 3
Math.Max(double.NaN, 1)                           // NaN
```

Many bit patterns are `NaN`. On the machine used for these examples
`double.NaN` has bits `FFF8000000000000` while `0.0 / 0` computed at run time
produced `7FF8000000000000`, and both are `NaN`. Negative zero also exists:
`-0.0 == 0.0` is `true`, `1 / -0.0` is `-Infinity`, and `double.IsNegative(-0.0)`
is `true`. Use `double.IsFinite`, `double.IsNaN` and `double.IsInfinity` to
validate input, because a `NaN` that enters a sum poisons the whole result.

### Comparing floating-point values

Never use `==` on computed values. `double.Epsilon` is not the answer either:
it is the smallest positive double (`5E-324`), not a tolerance, and the
Microsoft Learn page for `Double` recommends against it for equality tests. A
tolerance must combine an absolute part (for values near zero) and a relative
part (for large values):

```csharp
static bool Near(double a, double b, double rel = 1e-9, double abs = 1e-12)
    => Math.Abs(a - b) <= Math.Max(abs, rel * Math.Max(Math.Abs(a), Math.Abs(b)));

Near(0.1 + 0.2, 0.3)       // True
Near(1e10 + 1e-3, 1e10)    // True
Near(0.0, 1e-15)           // True
Near(0.0, 1e-9)            // False
Math.Abs(0.1 + 0.2 - 0.3) < double.Epsilon   // False  (the difference is 5.55E-17)
```

The right tolerance depends on the domain; the numbers above are examples, not
constants to copy. Test frameworks offer this built in (an `Assert.Equal` with a
precision argument, for instance).

### `decimal`: a 96-bit integer with a decimal scale

`decimal` stores a sign, a 96-bit integer and a scale from 0 to 28 that says
how many digits are after the decimal point. The value is
integer / 10^scale. Decimal fractions like 0.1 are exact, and the scale keeps
trailing zeros:

```csharp
decimal.GetBits(1.0m)  -> integer 10,  scale 1
decimal.GetBits(1.00m) -> integer 100, scale 2
decimal.GetBits(1m)    -> integer 1,   scale 0
1.0m == 1.00m          // True   (arithmetic and comparison ignore the scale)
1.00m.ToString()       // 1.00   (but the text shows it)
1.250m.Scale           // 3
```

The scale follows the operands in arithmetic: addition keeps the larger scale,
multiplication adds the scales, and the result is not normalized.

```csharp
1.10m + 2.205m   // 3.305
1.10m * 2.0m     // 2.200
100m * 1.1m      // 110.0
100m * 1.10m     // 110.00
10m / 4m         // 2.5
1m / 3m          // 0.3333333333333333333333333333   (28 digits)
1m / 3m * 3m     // 0.9999999999999999999999999999
```

So `decimal` is exact for decimal fractions, not for every rational number. The
range is about +/-7.9 x 10^28, and going past it throws, unlike `double`:
`decimal.MaxValue + 1m` throws `OverflowException`. Casting a `double` to
`decimal` keeps about 15 significant digits, so
`(decimal)(0.1 + 0.2)` is `0.3`, `(decimal)1234567890123.456789` is
`1234567890123.46`, and `NaN`, infinities and values beyond the range throw
`OverflowException` (a constant such as `(decimal)double.NaN` is a compile
error, CS0031). That conversion hides the double error; it does not repair a
calculation that already lost precision.

The cost is speed and size: 16 bytes, and arithmetic implemented in software.
A loop of 50 million additions took 37 ms with `double` and 447 ms with
`decimal` in a Release build on the test machine (about 12 times). The
Microsoft Learn page says the difference goes unnoticed except in the most
calculation-intensive applications.

### Why not `float` for money

A price like `19.99` is not representable, and the errors do not cancel:

```csharp
// summing 0.10 one thousand times
float   99.99905
double  99.9999999999986
decimal 100.0

19.99 * 100                  // 1998.9999999999998
(int)(19.99 * 100)           // 1998  (cents truncated)
(int)(19.99m * 100)          // 1999
```

For money, store `decimal` (or integer cents in a `long`), round explicitly,
and keep `double` for measurements, statistics, graphics and anything where a
relative error of 1e-16 is meaningless.

### `Half`, `Int128` and native-sized integers

`Half` is a 16-bit IEEE 754 type (1 sign, 5 exponent, 10 fraction bits) used
for GPU and ML data. `Half.MaxValue` is `65504` (it prints as `65500`, the
shortest text that round-trips), `(Half)65520` is `Infinity` and `(Half)0.1`
is stored as `0.0999755859`. Precision is tiny: a `Half` loop adding `1` stops
at `2048`, and `(Half)0.1 + (Half)0.2` prints `0.2998`.

`Int128` and `UInt128` are 16-byte integers with the usual operators. They
avoid overflow where `long` fails (`(Int128)long.MaxValue * long.MaxValue` is
`85070591730234615847396907784232501249`), and `>>` versus `>>>` behave as for
other integers (`(Int128)(-1) >> 1` is `-1`, `>>> 1` is
`170141183460469231731687303715884105727`). For unbounded integers use
`System.Numerics.BigInteger`; for exact decimal arithmetic in Java the
equivalent is covered in `exact-arithmetic-with-bigdecimal-and-biginteger`.

`nint` and `nuint` are native-sized: 4 bytes in a 32-bit process, 8 in a
64-bit one. Since C# 11 they are plain aliases of `System.IntPtr` and
`System.UIntPtr` (`typeof(nint) == typeof(IntPtr)` is `true`). `MinValue` and
`MaxValue` are computed at run time, a compile-time constant of type `nint` is
limited to the 32-bit range (the compiler warns with CS8778 about larger
constants), and there is no literal suffix, so write `(nint)42`. Use them for
interop with native APIs, not as a general "fast int".

## Trade-offs

- **`double` is the default real type and it is usually right.** It is fast,
  hardware-backed and has 15 to 17 digits. It is wrong for values that must
  match a decimal ledger to the cent, because `0.1` cannot be stored and errors
  accumulate (a thousand additions of `0.10` gave `99.9999999999986`).
- **`decimal` is exact for decimal fractions, but slower and bigger.** It
  costs 16 bytes and roughly an order of magnitude in arithmetic throughput
  (12 times in the loop above), and it still rounds (`1m / 3m` has 28 digits).
  Use it for money and rates, not for physics.
  ```csharp
  decimal total = 0m; foreach (var p in prices) total += p;   // exact for cents
  ```
- **Integer cents are exact and fast, but push formatting to the edges.**
  Storing `1999` as a `long` avoids both `float` and `decimal` problems, at
  the price of converting on every display and parse.
- **Floating-point comparison needs a tolerance, and the tolerance is a
  decision.** A relative tolerance fails near zero, an absolute one fails for
  large magnitudes, and both hide a real bug if set too wide. Prefer to
  compare after rounding to the precision the domain defines.
- **`NaN` and `Infinity` instead of exceptions keep a computation running and
  make the failure silent.** Validate with `double.IsFinite` at boundaries
  (parsing, deserialization) so that one `NaN` does not travel through a report.
- **Wrap-around arithmetic is cheap and unforgiving.** The default for `int` is
  unchecked, so `int.MaxValue + 1` becomes `int.MinValue` with no error;
  the next concept shows `checked`.
- **`Half`, `Int128` and `nint` solve narrow problems.** `Half` keeps about
  three decimal digits and is mostly a storage format, `Int128` is slower than
  `long` and `nint` ties your code to a platform detail.

## Documentation Links

- [Integral numeric types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types) (doc)
- [Floating-point numeric types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types) (doc)
- [Bitwise and shift operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/bitwise-and-shift-operators) (doc)
- [Double struct, precision and comparison remarks, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.double) (doc)
- [Decimal struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.decimal) (doc)
- [BitOperations class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.bitoperations) (doc)
- [The history of C# (C# 11: nint aliases, generic math), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
