---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

.NET 11 adds three types from the IEEE 754-2019 standard for decimal floating point: `Decimal32`, `Decimal64` and `Decimal128`, in `System.Numerics`. They store a decimal significand and a power of ten (like `System.Decimal`, unlike `double`), in 4, 8 and 16 bytes, with 7, 16 and 34 significant digits and a huge exponent range. The two numeric concepts already say they exist; this one compares them with `decimal` and `double` (precision, range, size, bit layout, rounding, parsing and formatting, conversions, JSON, speed) and says when each is the right choice. Every output below was run on the 11.0.100 SDK. Timings are from one Apple Silicon Mac in a Release build, so read the ratios, not the digits.

The short answer: for money and business rules in C# code, `decimal` is still the type. The IEEE decimals are for data that already comes in that format or for results that need more digits or a wider exponent than `decimal` has. They are new, and almost nothing in the ecosystem uses them yet.

## Use Cases

- Reading or writing a binary format, a database column or a protocol that defines decimal32, decimal64 or decimal128 (the BID bit pattern).
- Carrying more than 28 digits through a calculation (`Decimal128` has 34) or a value beyond 7.9E+28 or below 1E-28.
- Matching the results of another language or library that implements IEEE decimal arithmetic.
- Compact storage of many decimal values where 7 digits are enough (`Decimal32`, 4 bytes) and the cost of software arithmetic is acceptable.
- Writing generic numeric code that must accept decimal floating point through `IDecimalFloatingPointIeee754<T>`.

## Deep Dive

### Three sizes, one idea

A value is `sign x significand x 10^exponent`. The significand is an integer with a fixed number of digits, the exponent is a small integer. That is also how `decimal` works, so `0.1 + 0.2` is exact (`0.3`) in all four decimal types and not in `double`.

| Type | Bytes | Significant digits | Largest finite value | Smallest step above 0 |
|---|---|---|---|---|
| `Decimal32` | 4 | 7 | 9.999999E+96 | 1E-101 |
| `Decimal64` | 8 | 16 | 9.999999999999999E+384 | 1E-398 |
| `Decimal128` | 16 | 34 | 9.999999999999999999999999999999999E+6144 | 1E-6176 |
| `decimal` | 16 | 28 to 29 | 79228162514264337593543950335 | 1E-28 |
| `double` | 8 | 15 to 17 (binary) | 1.7976931348623157E+308 | about 5E-324 |

Two things stand out. `Decimal64` is the same size as `double` but trades range (E+384 against E+308) and speed for exact decimal fractions. `Decimal128` has more digits than `decimal` and an exponent range thousands of times wider, in the same 16 bytes. The values come from `MaxValue` and `Epsilon` on each type; `Unsafe.SizeOf` gives 4, 8, 16, 16 and 8.

### Where the bits go

.NET stores the integer-significand form of IEEE 754, called BID (binary integer decimal). The type has no public constructors and no field to read, but `MemoryMarshal.Write` and the static methods `EncodeBinary` and `DecodeBinary` expose the bits:

```csharp
Decimal64.Parse("1.50", CultureInfo.InvariantCulture); // bits 3180000000000096
Decimal64.Parse("1.0",  CultureInfo.InvariantCulture); // bits 31A000000000000A
Decimal64.DecodeBinary(0x31A000000000000AUL);          // 1.0
```

`0x96` is 150 (the significand) and the high bits are the biased exponent: 396, that is -2 once the bias of 398 is removed. The other IEEE encoding, DPD (densely packed decimal), is available through `EncodeDecimal` and `DecodeDecimal`; I only checked that the methods exist and did not run them. Use `EncodeBinary` unless the format you read says DPD. Both methods work on the value, not on a byte order, so for a file or a socket decide endianness yourself (`BinaryPrimitives` on the `ulong`).

### The same value in several representations

Like `decimal`, the IEEE types keep trailing zeros. `1.0` and `1.00` are equal and have different bits, a hash set holds one of them, and the exponent follows the arithmetic: `1.50 * 1.50` is `2.2500`. The exponent has a name here, the quantum:

```csharp
Decimal64.GetQuantum(Decimal64.Parse("1.50", inv));  // 0.01
Decimal64.HaveSameQuantum(a, b);                     // same exponent?
Decimal64.Quantize(Decimal64.Parse("19.9", inv), Decimal64.Parse("0.01", inv)); // 19.90
```

`Quantize(x, y)` returns `x` rounded to the exponent of `y`. It is the right tool for "two decimal places": `Decimal64.Round(2.5, 2)` leaves `2.5`, while `Quantize` gives `2.50`, and `2.675` becomes `2.68` and `2.665` becomes `2.66` (ties go to even). If the result does not fit in the digits of the type, `Quantize` returns `NaN` (`1E20` to cents needs 22 digits and `Decimal64` has 16).

### Rounding: when digits run out

`decimal` has a scale of at most 28 and throws `OverflowException` when the integer part is too big. The IEEE types have a fixed number of digits and round, silently, to the nearest, ties to even. This applies to parsing, to conversions and to every operation:

```csharp
Decimal32.Parse("12345675")  // 1.234568E+07   (tie, goes to the even 8)
Decimal32.Parse("12345685")  // 1.234568E+07   (tie, goes to the even 8)
Decimal32.Parse("12345695")  // 1.234570E+07
Decimal64.Parse("1234567890123456789") // 1.234567890123457E+18
Decimal64.MaxValue + Decimal64.One     // 9.999999999999999E+384 (the 1 is absorbed)
(Decimal64.One / 3)                    // 0.3333333333333333
```

This is the main change in mindset. A `Decimal32` that receives an 8-digit integer does not complain: it keeps 7 digits. Validate ranges at the boundary if the number of digits matters to you.

The rounding methods are `Round`, `Floor`, `Ceiling` and `Truncate` on the type itself (there is no `Math.Round(Decimal64)`). `Decimal64.Round(x)` is ties to even (`2.5` gives `2`), `MidpointRounding.AwayFromZero` gives `3`, `Round(2.675, 2)` gives `2.68` where `Math.Round(2.675, 2)` on a `double` gives `2.67` because the binary value is below the tie, and `Decimal32.Round(1.005, 2)` is `1.00` with the default and `1.01` with `AwayFromZero`. A negative `digits` throws `ArgumentOutOfRangeException` (use `Quantize` with a quantum such as `1E+2`).

### Overflow, infinity and NaN

`decimal` throws. The IEEE types follow IEEE 754 and produce special values:

```csharp
Decimal64.One / Decimal64.Zero          // Infinity (decimal: DivideByZeroException)
Decimal32.Zero / Decimal32.Zero         // NaN
Decimal32.MaxValue + Decimal32.MaxValue // Infinity
checked(Decimal32.MaxValue + Decimal32.MaxValue) // still Infinity, no exception
Decimal64.Parse("1E400")                // Infinity
Decimal64.Parse("1E-400")               // 0E-398
Decimal32.NaN == Decimal32.NaN          // False
```

`checked` has no effect on these operators, so a calculation that overflows reaches your code as `Infinity` and can be written to a database or a file. The `CreateChecked` and explicit conversions behave the same way for a too-large `Decimal64` to `Decimal32`: `Infinity`, not an exception. If you want an exception, test with `IsInfinity` and `IsNaN` (the lab has a `MultiplyChecked`). Casting an out-of-range value to an integer saturates (`(int)Decimal64.Parse("1E20")` is `2147483647`).

### Conversions

The implicit conversions are the lossless ones, and the list is a good map:

- To `Decimal32`: `byte`, `sbyte`, `char`, `short`, `ushort`. Not `int`: 10 digits do not fit in 7.
- To `Decimal64`: those plus `int` and `uint`, and from `Decimal32`. Not `long`.
- To `Decimal128`: every integer type up to 64 bits, `decimal`, and both smaller IEEE types.
- Everything else is explicit: wider to narrower IEEE type, `Decimal64` to `decimal`, anything to and from `float` and `double`.

`Decimal64 x = 5;` compiles, `(Decimal64)0.1m` needs the cast, and there is no `Decimal64` literal (no suffix). From `double` the result depends on the digits available. `(Decimal64)0.1` is `0.1000000000000000` (16 digits, the binary error is rounded away), while `(Decimal128)0.1` is `0.1000000000000000055511151231257827`: 34 digits are enough to show the true value of the `double`. `(Decimal64)0.1f` is `0.1000000014901161`. This agrees with the .NET 11 change to `(decimal)` of a `double`, which now keeps the exact binary value (see `numeric-conversions-rounding-and-overflow`). Going the other way, `(double)Decimal64.Parse("0.1") == 0.1` is `True` because the `double` conversion rounds to the nearest `double`.

Conversion to `decimal` is where size matters. `(decimal)Decimal128.MaxValue` and `(decimal)Decimal64.MaxValue` throw `OverflowException`, `decimal.MaxValue` goes to `Decimal128` and back unchanged, and `(decimal)Decimal128.Parse("0.0000000000000000000000000000001234")` becomes `0.0000000000000000000000000000` without an error: below 1E-28 the value silently turns into zero, like `(decimal)1e-30` does. For code that must not lose digits, check the range before converting, or catch `OverflowException` (the lab has `ToDecimalOrNull`).

### Parsing and formatting

`Parse`, `TryParse`, `TryParsePartial`, `TryFormat`, UTF-8 overloads and the `NumberStyles` and `IFormatProvider` parameters are all there, as for the other numeric types. Two details:

- `Decimal64.Parse("1.0")` uses the current culture, as `decimal.Parse` does. On a machine whose culture uses a comma the call throws `FormatException`, so pass `CultureInfo.InvariantCulture` for data that is not meant for a person.
- The default `G` format switches to scientific notation when the value has more digits than the type: `Decimal32.Parse("12345678")` prints `1.234568E+07`, and `1234567` prints `1234567`. For plain digits, ask for `F0`, `N0` or another fixed format: `12345680`, `12,345,680`. `Decimal128.MaxValue.ToString("F0")` is 6145 characters long.

```csharp
var d = Decimal64.Parse("1234.5", CultureInfo.InvariantCulture);
d.ToString("C", CultureInfo.GetCultureInfo("pt-BR")) // R$ 1.234,50
d.ToString("N2", CultureInfo.InvariantCulture)       // 1,234.50
d.ToString("E3", CultureInfo.InvariantCulture)       // 1.234E+003
Decimal64.TryParse("abc", null, out var r)           // False, r is 0
```

Both `Infinity` and `NaN` parse, `TryParse` returns `false` for text that is not a number, and a 19-digit integer parses without error to a 16-digit value.

### JSON and other formats

`System.Text.Json` handles the three types as JSON numbers, with no converter and no options, and the exponent survives:

```csharp
JsonSerializer.Serialize(new { A = Decimal64.Parse("1.50", inv), B = 1.50m }); // {"A":1.50,"B":1.50}
JsonSerializer.Deserialize<Decimal128>("12345678901234567890.123456789");      // exact
JsonSerializer.Deserialize<Decimal32>("1.23456789");                           // 1.234568
JsonSerializer.Deserialize<Decimal64>("1E400");                                // Infinity
```

`Decimal64.NaN` fails to serialize with `ArgumentException` unless `JsonNumberHandling.AllowNamedFloatingPointLiterals` is set, as for `double`. A number in a string reads with `AllowReadingFromString`. A JSON number with more digits than the type is rounded on read, as with parsing.

For everything else, I only tested the BCL. I did not check Entity Framework Core, Npgsql, `Microsoft.Data.SqlClient`, ASP.NET Core model binding, protobuf or MessagePack, and I did not look for a provider that maps a column to these types. The SQL Server `decimal` and PostgreSQL `numeric` column types are fixed-point decimals, not the IEEE formats, so even a provider that supports the new types would be converting. Treat support in a library as something to test, not to assume.

### Math and generic code

The three types implement `IDecimalFloatingPointIeee754<T>`, so the whole IEEE surface is there: `Sqrt`, `Pow`, `Exp`, `Log`, trigonometric functions, `Hypot`, `FusedMultiplyAdd`, `Lerp`, `Min`/`Max` variants, `IsFinite`, `IsNormal`, `IsSubnormal`, `BitIncrement`. `Decimal64.Pow(1.05, 10)` is `1.628894626777441`, the exact value `1.62889462677744140625` rounded to 16 digits, while `Math.Pow(1.05, 10)` gives `1.628894626777442`.

`decimal` implements only `IFloatingPoint<T>` and `IFloatingPointConstants<T>`, not `IFloatingPointIeee754<T>`, so generic code with that constraint accepts `double` and `Decimal64` but not `decimal`. Code written against `INumber<T>` works with all of them:

```csharp
static T Sum<T>(params T[] xs) where T : INumber<T> { T s = T.Zero; foreach (var x in xs) s += x; return s; }
Sum(Decimal64.Parse("0.1", inv), Decimal64.Parse("0.2", inv), Decimal64.Parse("0.3", inv)); // 0.6
```

There are no operators between an IEEE decimal and `long`, `double` or `decimal`; convert first. The generic math concept explains the interfaces.

### Speed

The arithmetic is done in software (there is no decimal instruction in the processor), and so is `decimal`. 20 million operations, best of five, Release, `net11.0`, Apple Silicon (milliseconds):

| Operation | `double` | `decimal` | `Decimal32` | `Decimal64` | `Decimal128` |
|---|---|---|---|---|---|
| add | 12 | 67 | 138 | 108 | 128 |
| multiply | 15 | 378 | 262 | 534 | 3175 |
| divide | 11 | 423 | not run | 637 | 1048 for 5 million |

The multiply and divide loops of the decimal types also compare and reset or accumulate, so the numbers are good for ratios only. For 2 million calls: `Parse` takes 59 ms for `double`, 57 for `decimal`, 65 for `Decimal64` and 69 for `Decimal128`; `ToString` takes 74, 42, 58 and 59; `decimal` to `Decimal64` 47, back 55, `double` to `Decimal64` 200 and back 20.

What to take from it: `double` is 5 to 40 times faster than any decimal type on arithmetic; `decimal` is faster than `Decimal64` in all three operations and much faster than `Decimal128` for multiplication; `Decimal32` is slower than `Decimal64` for addition and faster for multiplication (smaller storage does not mean a fixed amount less work); parsing and formatting cost about the same for all of them; the conversion from `double` is the slow one. The IEEE decimals buy digits, range and a standard bit layout, not speed. Measure your own workload before choosing, and do not use `Decimal128` in a hot multiplication loop.

### Choosing

- Money, prices, tax, any business value with a fixed number of decimal places: `decimal`. It throws on overflow, has the wide support (EF Core, drivers, serializers) and is the faster of the exact decimals.
- Measurements, simulation, anything where a relative error of 1E-16 is fine: `double`.
- A format or protocol that says decimal64 or decimal128, or an interop with a library that returns bits in that layout: the matching IEEE type, converting at the edge and doing the business logic in whatever your team already trusts.
- More than 28 digits of precision, or an exponent beyond `decimal` and `double`, with exact decimal fractions: `Decimal128`.
- Many small decimal values stored compactly, where 7 digits are enough: `Decimal32`, but compare with `int` cents or `decimal` first.
- A fixed number of cents and nothing else: still `long` cents or `decimal`.

## Trade-offs

- **New and little used.** The types are in the BCL, but `System.Text.Json` is the only serializer I verified, and I did not check any database provider. Anything that crosses a boundary may need your own conversion to `decimal` or to the raw bits.
- **Silent rounding replaces `OverflowException`.** A value with too many digits is rounded and one with too large an exponent becomes `Infinity`; `checked` does not help. Test with `IsInfinity` and `IsNaN` at the edges and validate the number of digits when it matters.
- **Slower than `decimal` in most cases.** 16-digit `Decimal64` multiplication is about 1.4 times slower than `decimal` here, `Decimal128` about 8 times. Only addition and `Decimal32` multiplication are close.
- **No operators across types.** `Decimal64 + long` does not compile and `decimal` needs a cast. Converting inside a loop costs more than the arithmetic (the `double` to `Decimal64` conversion was the slowest operation measured).
- **Narrower digits than `decimal` for the common size.** `Decimal64` has 16 digits, `decimal` 28. Using it because it is "the same size as double" can lose cents on large amounts.
- **Representation leaks.** `1.0` and `1.00` are equal but print differently and have different bits. Normalize with `Quantize` before storing, hashing text or comparing bytes.
- **`G` formatting surprises.** A value with more digits than the type prints in scientific notation; use `F` or `N` with the digits you want, and always pass `CultureInfo.InvariantCulture` for data.
- **Culture sensitivity in `Parse`.** Like `decimal`, the culture of the machine decides whether `1.0` is accepted.
- **Silent underflow to `decimal`.** Converting a tiny `Decimal128` to `decimal` gives zero, not an exception.

## Lab

Use the IEEE decimals on purpose: round to cents with `Quantize`, convert `Decimal128` to `decimal` without crashing, see the quantum of `1.0` and `1.00`, read the BID bits, catch overflow that `checked` ignores, and round-trip JSON.

**The scenario**

One library project (`Ieee.cs`) and a test project that targets `net11.0`. The starter has `NotImplementedException` stubs and comments describing each routine.

**What you will do, step by step**

1. **Cents (TODO-00, TODO-01).** `RoundToCents` with `Quantize` (ties to even) and `RoundHalfAwayToCents` with an explicit `MidpointRounding`.
2. **Narrowing (TODO-02, TODO-03).** `ToDecimalOrNull` for a `Decimal128` that may not fit, and `FitsInDecimal32` with a round trip.
3. **Generic and quantum (TODO-04, TODO-05).** `SumTenths<T>` with `INumber<T>` for `double`, `decimal` and `Decimal64`, and `SameValueDifferentQuantum`.
4. **Bits (TODO-06, TODO-07).** `ToBid` and `FromBid` with `EncodeBinary` and `DecodeBinary`.
5. **Overflow and JSON (TODO-08 to TODO-10).** `MultiplyChecked` that throws when finite operands overflow, and `ToJson` / `FromJson` that keep the trailing zeros.

**How you know you are done**

`dotnet test` is green with 28 tests. You should be able to explain why `checked` does not catch the overflow in TODO-08.

**Optional challenges**

- Run `SumTenths<Decimal32>` and `SumTenths<Decimal128>` and compare with `decimal`.
- Time 20 million additions of `double`, `decimal` and `Decimal64` in a Release build and compare with the table above.

**Prerequisites:** the numeric types and rounding concepts, generic math and the .NET 11 SDK (the projects target `net11.0`).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed method throws `NotImplementedException`, so red tests are your checklist.

## Documentation Links

- [Decimal64 struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.decimal64) (doc)
- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [Decimal, double and BigInteger conversions in .NET 11, breaking change, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/decimal-biginteger-floating-point-conversions) (doc)
- [IDecimalFloatingPointIeee754<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.idecimalfloatingpointieee754-1) (doc)
