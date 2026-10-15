---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Turning a value into text looks trivial and hides three real topics: the syntax
of format specifiers and alignment, what the compiler does with an interpolated
string, and which culture the conversion uses. The first is a table you can look
up. The second explains why `$"{x}"` is usually cheaper than `string.Format`,
and how an interpolated string handler can skip work entirely. The third is a
classic production bug: a number written with the machine's culture, then
parsed somewhere else with another one. This concept covers the hole syntax
`{value,width:format}`, the standard and custom format strings, the handler
pattern, `IFormattable` and `ISpanFormattable`, `CompositeFormat`, and the
culture rules.

## Use Cases

- Printing aligned tables in a console tool or a log line with
  `{name,-12}{price,10:N2}`.
- Writing numbers and dates to a file, a header or a query string that another
  system must parse back.
- Building a logging API that does not format the message when the level is off.
- Making your own type work with `$"{money:long}"` and with spans.

## Deep Dive

### The hole syntax and common specifiers

A hole in an interpolated string is `{expression[,width][:format]}`. A positive
width right-aligns in at least that many characters, a negative width
left-aligns, and the format string is passed to the value's formatting. A colon
inside the expression needs parentheses, so write
`{(n > 40 ? "big" : "small")}`; `{{` and `}}` produce literal braces. Output
with `CultureInfo.InvariantCulture`:

```csharp
double d = 1234567.891; int n = 42; var when = new DateTime(2026, 10, 15, 9, 5, 7, DateTimeKind.Utc);
$"{d:N2}"   // 1,234,567.89   number with group separators
$"{d:F1}"   // 1234567.9      fixed point
$"{d:E2}"   // 1.23E+006      scientific
$"{d:C}"    // ¤1,234,567.89  currency (the invariant culture has only a generic sign)
$"{0.256:P1}" // 25.6 %       percent, multiplies by 100
$"{n:D5}"   // 00042          integer padded with zeros
$"{255:X4}" // 00FF           hex, lower case with x
$"[{n,8}] [{n,-8}] [{"ab",5}]"  // [      42] [42      ] [   ab]
$"{when:yyyy-MM-dd HH:mm:ss}"   // 2026-10-15 09:05:07
$"{when:O}"                     // 2026-10-15T09:05:07.0000000Z  round trip, sortable
```

Custom numeric formats use placeholders: `0` forces a digit, `#` shows a digit only
if there is one, `,` groups, and `;` separates up to three sections for positive,
negative and zero values:

```csharp
$"{d:0.00}"             // 1234567.89
$"{d:#,##0.0}"          // 1,234,567.9
$"{0:+0;-0;zero}"       // zero
$"{1234:00-00}"         // 12-34   other characters are copied between digits
$"{0.5:#.##}"           // .5
$"{0.0:#.##}"           // (empty string)
```

The last two are the usual surprises: `#` never invents a leading or trailing zero,
so a zero can become an empty string.

### What an interpolated string becomes

If the target type of an interpolated string is `string`, the compiler uses
`DefaultInterpolatedStringHandler` (the compiled assembly of the experiment
references that type and its `ToStringAndClear` method), a `ref struct` that
formats directly into a pooled buffer. The Microsoft Learn page adds that the
compiler may use `string.Concat` when that is equivalent. If the target is
`IFormattable` or `FormattableString`, it calls `FormattableStringFactory.Create`
instead, which keeps the format and the arguments separate.

The handler pattern is public, so you can see it by writing your own. The
compiler calls a constructor with the total literal length and the number of
holes, then `AppendLiteral` and `AppendFormatted<T>` in order. A constructor
parameter `out bool shouldAppend` lets the handler say "do not bother":

```csharp
log.Debug($"hello {who} id={n,5:D3} done");   // logger enabled
//   ctor literalLength=15 formattedCount=2 enabled=True
//   AppendLiteral(hello )
//   AppendFormatted<String>(Ana)
//   AppendLiteral( id=)
//   AppendFormatted<Int32>(42, 5, D3)
//   AppendLiteral( done)

log.Enabled = false;
log.Debug($"skipped {Expensive()}");
//   ctor literalLength=8 formattedCount=1 enabled=False
// Expensive() was never called: 0 calls
```

The first call shows that the type of each hole is known at compile time (no
boxing, `AppendFormatted<Int32>`), and that width and format arrive as separate
arguments. The second shows the key trick: with `shouldAppend` false the compiler
skips the remaining calls, and that includes evaluating the hole expressions.
The same documentation page warns about the other side of this coin, since side
effects in a hole may not run. `Debug.Assert(true, $"v={E()}")` is an
example from the framework: when the assertion holds, `E()` is never called
(0 calls in the experiment).

The cost shows up in allocations. Measured with
`GC.GetAllocatedBytesForCurrentThread` in a Release build on .NET 10.0.0, bytes
per call, including the result string:

| Expression | Bytes |
|---|---|
| `$"{v}-{s}"` (int, string) | 48 |
| `string.Format("{0}-{1}", v, s)` | 72 |
| `v.ToString() + "-" + s` | 88 |
| `$"{dd}"` (double) | 32 |
| `string.Format("{0}", dd)` | 56 |
| `string.Format("{0}{1}{2}{3}", v, v, v, v)` (4 ints) | 168 |
| `$"{v}{v}{v}{v}"` | 72 |

The difference is boxing: `string.Format` takes `params object?[]`, so each int
or double becomes an object and the arguments need an array, while the handler
stays generic. The numbers are specific to this run, but the order is stable.

### Culture: the silent bug

By default every hole is formatted with `CultureInfo.CurrentCulture`. The same
code gives different text per machine:

```csharp
foreach (var name in new[] { "en-US", "pt-BR", "de-DE" })
{
    CultureInfo.CurrentCulture = new CultureInfo(name);
    Console.WriteLine($"{name}: {1234567.891} | {1234567.891:N2} | {when:d} | {1.5}");
}
// en-US: 1234567.891 | 1,234,567.89 | 10/15/2026 | 1.5
// pt-BR: 1234567,891 | 1.234.567,89 | 15/10/2026 | 1,5
// de-DE: 1234567,891 | 1.234.567,89 | 15.10.2026 | 1,5
```

That is right for text shown to a user and wrong for data. A `price=1,5` written
on a pt-BR machine becomes a bug in a service expecting a dot. Parsing is where
it gets worse: with the invariant culture, a comma is a thousands separator, so

```csharp
double.Parse("1,5", CultureInfo.InvariantCulture)   // 15, no exception
```

returns 15 and not 1.5. For machine-readable text, pass the culture explicitly.
The documented options are `string.Create(CultureInfo.InvariantCulture, $"...")`
(.NET 6+), `FormattableString.Invariant($"...")`, and
`value.ToString(CultureInfo.InvariantCulture)`; all three gave `price=1.5` in the
experiment. A `FormattableString` also exposes what the handler hides:

```csharp
FormattableString fs = $"x={1.5:N2} y={n}";
fs.Format          // x={0:N2} y={1}
fs.ArgumentCount   // 2
fs.ToString(CultureInfo.InvariantCulture)   // x=1.50 y=42
```

### IFormattable, ISpanFormattable and CompositeFormat

A type decides what its format strings mean by implementing `IFormattable`:
`ToString(string? format, IFormatProvider? provider)`. `ISpanFormattable` adds
`TryFormat(Span<char>, out int, ReadOnlySpan<char>, IFormatProvider?)` so that
the handler can write straight into its buffer without creating an intermediate
string. A small type that supports both:

```csharp
readonly record struct Money(decimal Amount, string Currency) : IFormattable, ISpanFormattable
{
    public string ToString(string? format, IFormatProvider? provider)
    {
        var p = provider ?? CultureInfo.CurrentCulture;
        return format == "long" ? $"{Amount.ToString("N2", p)} {Currency}"
                                : $"{Amount.ToString("0.##", p)}{Currency[0]}";
    }
    public bool TryFormat(Span<char> dest, out int written, ReadOnlySpan<char> format, IFormatProvider? provider)
    {
        var s = ToString(format.ToString(), provider);
        written = 0;
        if (s.Length > dest.Length) return false;
        s.CopyTo(dest); written = s.Length; return true;
    }
}

var m = new Money(12.5m, "EUR");
$"{m} | {m:short} | {m:long} | {m,14:long}|"   // 12.5E | 12.5E | 12.50 EUR |      12.50 EUR|
Span<char> buf = stackalloc char[64];
buf.TryWrite($"{m:short} {n}", out int w);     // true, w = 8, "12.5E 42"
```

The sample's `TryFormat` still builds a string internally to stay short; a real
one formats the pieces directly into `dest`. `TryWrite` (on a `Span<char>`) and
`Utf8.TryWrite` (on a `Span<byte>`) write an interpolated string straight into a
caller-provided buffer, without building the result string.

When the template is a constant reused many times (a log message, a resource
string), `CompositeFormat.Parse("{0}-{1}")` (.NET 8+) parses it once, and
`string.Format(null, compositeFormat, v, s)` reuses it. In the experiment that
call allocated 48 bytes, the same as the interpolated version, compared with 72
for the plain `string.Format`.

## Trade-offs

- **Interpolation is the readable default, not always the fastest.** It beats
  `string.Format` in allocation, but in a loop that builds one large string a
  `StringBuilder` or a span-based writer avoids the intermediate strings.
- **The current culture is correct for people and wrong for data.** Anything
  written to a file, a header, a cache key or a query string should use the
  invariant culture explicitly, because `ToString()` will follow the machine.
  ```csharp
  var key = string.Create(CultureInfo.InvariantCulture, $"price:{price}");
  ```
- **Handlers skip evaluation, which is a feature and a trap.** A hole with a side
  effect (`$"{queue.Dequeue()}"`) inside a log call that is disabled never runs.
  Keep holes pure.
- **Format strings are plain strings, checked at run time.** A wrong specifier
  fails or misformats only when that line executes, and an unknown format on
  your own `IFormattable` type needs a deliberate `FormatException`. Cover the
  specifiers you support in tests.
- **`ISpanFormattable` is extra code for a measurable gain only in hot paths.**
  For a type formatted a few times per request, `IFormattable` alone is enough.
- **`CompositeFormat` pays off only for reused templates.** Parsing once is a
  cost for a template used a single time, and you must keep the parsed object
  somewhere (a `static readonly` field).

## Documentation Links

- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [Composite formatting, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/composite-formatting) (doc)
- [Standard numeric format strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/standard-numeric-format-strings) (doc)
- [Custom numeric format strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-numeric-format-strings) (doc)
- [Write a custom string interpolation handler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/interpolated-string-handler) (doc)
- [Formatting types in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/formatting-types) (doc)
- [CompositeFormat class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.compositeformat) (doc)
