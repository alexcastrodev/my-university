---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Text is where numbers, dates and enums come from: forms, files, query strings,
headers, configuration. Turning that text into typed values is the most common
place where an exception becomes a normal event, and the most common place
where a culture bug becomes silent data corruption. This concept covers the
two families of parsing methods (`Parse` and `TryParse`), what the default
`NumberStyles` accept, the culture rules on the reading side, exact date
parsing, `Enum.TryParse` and its traps, the `IParsable<T>` and
`ISpanParsable<T>` interfaces that unify all of this, and how to write your own
`Try` method with the right semantics. The formatting side of the
culture problem is in `formatting-values-and-interpolated-strings`; this
concept adds the reading side with measured output.

## Use Cases

- Reading user input or a CSV field into a number without a try/catch around
  every line.
- Parsing dates that arrive as `dd/MM/yyyy`, ISO 8601 with an offset, or
  several accepted formats.
- Binding a command-line argument, an environment variable or a query-string
  value to an enum.
- Writing a generic method (`T Read<T>(string s) where T : IParsable<T>`) and a
  value type that parses like the built-in ones.
- Choosing between an exception-based API and a `TryX` API when you design a
  library.

## Deep Dive

Output is from .NET 10 (SDK 10.0.100) on arm64. Unless a culture is named, the
examples set `CultureInfo.CurrentCulture` to the invariant culture, so the
output does not depend on the machine.

### `Parse` throws, `TryParse` answers

`Parse` returns the value or throws. `TryParse` returns a `bool` and puts the
value in an `out` parameter, so there is no exception for ordinary bad input:

```csharp
int.Parse("42")                // 42
int.Parse("4x")                // FormatException
int.Parse("")                  // FormatException
int.Parse(null)                // ArgumentNullException
int.Parse("2147483648")        // OverflowException

if (int.TryParse(text, out var n)) { /* n is valid */ }
int.TryParse((string?)null, out var a)   // False, a = 0
int.TryParse("4x", out var b)            // False, b = 0
int.TryParse("2147483648", out var c)    // False, c = 0  (overflow is just false)
```

The `out var` declaration (C# 7) keeps the value in scope after the `if`. On
failure the out value is `default` (the documentation says zero), and it is
overwritten even if it held something before, so never read it without
checking the result.

One exception remains with `TryParse`, because the "Try" covers only the
well-defined failure of the text. A `NumberStyles` combination that is invalid
is a programming error, and it still throws `ArgumentException`:

```csharp
int.TryParse("1", NumberStyles.HexNumber | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _);
// ArgumentException: With the AllowHexSpecifier or AllowBinarySpecifier bit set ...
int.TryParse("1", (NumberStyles)0x10000000, CultureInfo.InvariantCulture, out _);
// ArgumentException: An undefined NumberStyles value is being used.
```

### What the text may contain: `NumberStyles`

Each numeric type has a default style, and it is stricter for integers than
for floating point. The integer default (`NumberStyles.Integer`) allows leading
and trailing white space and one leading sign. The floating-point default
(`Float | AllowThousands`) also allows a decimal point, an exponent and group
separators:

```csharp
// int.TryParse (default style)
" 42 " -> 42     "+42" -> 42     "-42" -> -42
"(42)" "1,234" "1_000" "1e3" "42.0" "0x2A"   -> false

// double.TryParse(s, InvariantCulture, out ...)
"1.5" -> 1.5    "1,234.5" -> 1234.5   "1e3" -> 1000   "1E-2" -> 0.01
".5" -> 0.5     "5." -> 5             " 3.14 " -> 3.14
"NaN" -> NaN    "Infinity" -> Infinity    "-Infinity" -> -Infinity
"1e400" -> Infinity    (true, and the value is infinity)
"1,5" -> 15            (the comma is a group separator, no error)
"0x10" "1 234.5" "∞"  -> false
```

The `1e400` line matters: a text that overflows `double` still returns `true`
with `Infinity`. `int`, `decimal` and the other integer types return `false`
for overflow. Validate with `double.IsFinite` after parsing external input.

You choose the style explicitly when the default is wrong:

```csharp
int.TryParse("1,234", NumberStyles.Integer | NumberStyles.AllowThousands, inv, out v)  // True 1234
int.TryParse("FF", NumberStyles.HexNumber, inv, out v)           // True 255
int.TryParse("0xFF", NumberStyles.HexNumber, inv, out v)         // False (no prefix allowed)
int.TryParse("FFFFFFFF", NumberStyles.HexNumber, inv, out v)     // True -1 (two's complement)
decimal.TryParse("$1,234.50", NumberStyles.Currency, en-US, out d)    // True 1234.50
decimal.TryParse("1.234,50 €", NumberStyles.Currency, de-DE, out d)   // True 1234.50
int.TryParse(" 42", NumberStyles.None, inv, out v)               // False (digits only)
uint.TryParse("-0", out u)  // True 0     uint.TryParse("-1", out u)  // False
```

`decimal.Parse` keeps the scale of the text (`"1.10"` gives `1.10`,
`"1.100"` has `Scale` 3) and `NumberStyles.Float` accepts `"1e2"` as `100`. A
value outside the decimal range, such as `"1e29"`, is `false`.

### The culture on the reading side

`Parse` and `TryParse` without a provider use `CultureInfo.CurrentCulture`.
The same text gives different numbers in different places, and often not an
error. Output from `double.TryParse(text, Float | AllowThousands, culture, ...)`:

```csharp
culture   text         value
invariant "1,234.56"   1234.56
en-US     "1,234.56"   1234.56
pt-BR     "1.234,56"   1234.56
de-DE     "1.234,56"   1234.56
invariant "1.234,56"   false
pt-BR     "1,234.56"   false
pt-BR     "1.5"        15        <- a dot is a group separator, silently
invariant "1,5"        15        <- a comma is a group separator, silently
pt-BR     "1,5"        1.5
pt-BR     "1.234"      1234      <- thousand, not 1.234
invariant "1.234"      1.234
```

The dangerous rows are the ones without an error. A value written by a pt-BR
machine and read by an invariant parser is wrong by a factor of 10:

```csharp
CultureInfo.CurrentCulture = new CultureInfo("pt-BR");
string written = 1234.5.ToString();                  // "1234,5"
double.Parse(written, CultureInfo.InvariantCulture)  // 12345
double.Parse(written, new CultureInfo("pt-BR"))      // 1234.5
1234.5.ToString(CultureInfo.InvariantCulture)        // "1234.5"  (safe to store)
```

The rule is symmetric with formatting: data that a program stores or exchanges
uses `CultureInfo.InvariantCulture` on both ends, and text a person types is
parsed with that person's culture. Group separators are also culture data:
`de-CH` uses `'` and `fr-FR` uses U+202F (narrow no-break space), and in this
run `"1 234,5"` with a normal space and with U+202F both parsed as `1234.5`
for `fr-FR`, so tests with copied text from a spreadsheet deserve a real case.

### Dates and times

`DateTime.TryParse` is as culture dependent as the numbers, and a date has two
interpretations that both look valid:

```csharp
culture   text          date
invariant "03/04/2026"  2026-03-04
en-US     "03/04/2026"  2026-03-04
pt-BR     "03/04/2026"  2026-04-03
de-DE     "03.04.2026"  2026-04-03
invariant "2026-04-03"  2026-04-03   (ISO order is unambiguous)
en-US     "13/04/2026"  false
invariant "2026-02-30"  false
```

When the format is part of a contract, use `TryParseExact` with the format and
`InvariantCulture`. It is strict about the shape:

```csharp
DateTime.TryParseExact("03/04/2026", "dd/MM/yyyy", inv, DateTimeStyles.None, out d)   // 2026-04-03
DateTime.TryParseExact("03/04/2026", "MM/dd/yyyy", inv, DateTimeStyles.None, out d)   // 2026-03-04
DateTime.TryParseExact("3/4/2026", "dd/MM/yyyy", inv, DateTimeStyles.None, out d)     // False
DateTime.TryParseExact("3/4/2026", "d/M/yyyy", inv, DateTimeStyles.None, out d)       // True
DateTime.TryParseExact("03/04/2026 ", "dd/MM/yyyy", inv, DateTimeStyles.AllowWhiteSpaces, out d) // True
DateTime.TryParseExact("2026-04-03", new[] { "yyyy-MM-dd", "dd/MM/yyyy" }, inv, DateTimeStyles.None, out d) // True
```

`DateOnly.TryParseExact` and `TimeOnly.TryParse` exist for values that are not
instants. For an instant with an offset, prefer `DateTimeOffset`, because
`DateTime` loses the offset: `DateTime.Parse("2026-10-15T09:05:07Z")` returned a
`DateTime` with `Kind=Local`, already converted to the machine's zone
(`10:05:07+01:00` here), while `DateTimeStyles.RoundtripKind` kept `Kind=Utc`
and `09:05:07Z`. A string with no zone gives `Kind=Unspecified`.
`DateTimeOffset.TryParse("2026-10-15T09:05:07+02:00")` keeps the `+02:00`.

`TimeSpan.TryParse("90")` is `90.00:00:00`, ninety days, because a bare number
is days. For clock times use `TryParseExact` with a format such as `"hh\\:mm"`.

### `Enum.TryParse` and its traps

```csharp
enum Color { Red, Green, Blue }
Enum.TryParse<Color>("Green", out c)          // True Green
Enum.TryParse<Color>("green", out c)          // False  (case sensitive by default)
Enum.TryParse<Color>("green", true, out c)    // True Green
Enum.TryParse<Color>(" Green ", out c)        // True Green (white space is trimmed)
Enum.TryParse<Color>("1", out c)              // True Green  (a number is accepted)
Enum.TryParse<Color>("99", out c)             // True 99     (not a defined member)
Enum.IsDefined(c)                             // False
Enum.TryParse<Color>("-1", out c)             // True -1
Enum.TryParse<Color>("Red, Blue", out c)      // True Blue   (combined, even without [Flags])
Enum.Parse<Color>("Purple")                   // ArgumentException
```

An enum is an integer with names, so the parser accepts any integer text, and
`true` does not mean the value is a declared member. When the text comes from
outside, follow the parse with `Enum.IsDefined`, or reject texts that start
with a digit or a minus sign. For `[Flags]` enums the separator is a comma:
`"Read, Write"` gives `Read, Write` (3) and `"Read|Write"` is `false`.

### `IParsable<T>` and `ISpanParsable<T>`

.NET 7 turned the convention into interfaces. `IParsable<TSelf>` declares two
static members, and `ISpanParsable<TSelf>` adds the `ReadOnlySpan<char>`
overloads:

```csharp
public interface IParsable<TSelf> where TSelf : IParsable<TSelf>
{
    static abstract TSelf Parse(string s, IFormatProvider? provider);
    static abstract bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, out TSelf result);
}
```

`int`, `double`, `decimal`, `DateTime`, `DateOnly`, `TimeSpan`, `Guid`,
`IPAddress` and the other numeric types implement it (the Microsoft Learn page
lists them), and the numeric types also implement `IUtf8SpanParsable<T>`, so
`int.TryParse("12345"u8, out v)` parses UTF-8 bytes directly. Because the
members are `static abstract`, a generic method can parse without reflection:

```csharp
static IEnumerable<T> ParseAll<T>(string text, IFormatProvider? p) where T : IParsable<T>
{
    foreach (var part in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        yield return T.Parse(part, p);
}

ParseAll<int>("1 2 3", inv)                        // 1,2,3
ParseAll<double>("1.5 2.5", inv)                   // 1.5,2.5
ParseAll<DateOnly>("2026-10-15 2026-10-16", inv)   // 10/15/2026,10/16/2026 (printed by DateOnly.ToString)
static T TryParseOrDefault<T>(string s, T fallback, IFormatProvider? p) where T : IParsable<T>
    => T.TryParse(s, p, out var r) ? r : fallback;
```

Your own type joins the family by implementing the interface. The span
overloads hold the logic, and the string overloads delegate to them:

```csharp
readonly record struct Point(double X, double Y) : ISpanParsable<Point>
{
    public static Point Parse(string s, IFormatProvider? provider)
    {
        ArgumentNullException.ThrowIfNull(s);
        return Parse(s.AsSpan(), provider);
    }
    public static Point Parse(ReadOnlySpan<char> s, IFormatProvider? provider)
        => TryParse(s, provider, out var r) ? r : throw new FormatException($"'{s}' is not a Point (expected X;Y).");
    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, out Point result)
        => TryParse(s.AsSpan(), provider, out result);
    public static bool TryParse(ReadOnlySpan<char> s, IFormatProvider? provider, out Point result)
    {
        result = default;
        int semi = s.IndexOf(';');
        if (semi < 0) return false;
        if (!double.TryParse(s[..semi], NumberStyles.Float, provider, out var x)) return false;
        if (!double.TryParse(s[(semi + 1)..], NumberStyles.Float, provider, out var y)) return false;
        result = new Point(x, y);
        return true;
    }
}

Point.Parse("3.5;-2", inv)        // Point { X = 3.5, Y = -2 }
Point.Parse("3,5;-2", pt-BR)      // Point { X = 3.5, Y = -2 }
Point.TryParse("3.5", inv, out p)       // False
Point.TryParse((string?)null, inv, out p)  // False
Point.Parse("a;b", inv)           // FormatException: 'a;b' is not a Point (expected X;Y).
Point.Parse(null!, inv)           // ArgumentNullException
```

The `provider` is threaded to the inner calls, so the type does not decide the
culture by itself. Parsing from a span also avoids allocations. This loop sums
the valid fields of a line without creating a single substring:

```csharp
ReadOnlySpan<char> line = "10,20,x,40";
int total = 0, bad = 0;
foreach (var range in line.Split(','))
    if (int.TryParse(line[range], inv, out var v)) total += v; else bad++;
// total 70, bad 1
```

### Writing your own `Try` method

The Framework Design Guidelines (the Microsoft Learn page is a reprint of the
2008 edition and says some parts may be out of date, but the pattern is the one
the BCL still follows) define the shape: the name starts with `Try`,
the return type is `bool`, the result goes in an `out` parameter, and you also
provide the throwing counterpart. The `Try` covers a well-defined failure;
anything else (a null argument that is a bug, an invalid option) still throws.

```csharp
readonly record struct Percent(int Value)
{
    public static bool TryParse(string? s, out Percent result)
    {
        result = default;
        if (s is null || !s.EndsWith('%')) return false;
        if (!int.TryParse(s.AsSpan(0, s.Length - 1), NumberStyles.None, CultureInfo.InvariantCulture, out var v) || v > 100)
            return false;
        result = new Percent(v);
        return true;
    }
}
// "45%" -> True 45    "145%" -> False    "abc" -> False

record Customer(int Id, string Name)
{
    public static bool TryFind(int id, [NotNullWhen(true)] out Customer? customer)
        => Db.TryGetValue(id, out customer);
}
```

Always assign `result` first (the compiler forces it) and use
`[NotNullWhen(true)]` on a reference-type out parameter so that callers get
null-state analysis: after `if (TryFind(1, out var c))`, `c` is known not null.
The same shape is everywhere in the BCL: `Dictionary.TryGetValue`,
`Queue.TryDequeue`, `Guid.TryParse`, `Uri.TryCreate`. The older alternative is
the tester-doer pattern (`if (dict.ContainsKey(k)) use(dict[k])`), which does
two lookups and has a race window in concurrent code; the Try method does the
test and the work in one call.

### Exception cost, measured

Release build, no debugger attached, 200,000 `int` parses where 6 of 8 inputs
are invalid:

```csharp
Parse + catch (FormatException)   427 ms
TryParse                            1 ms

one failed Parse + catch            2.7 us
one failed TryParse                 5.5 ns
one successful Parse                5.0 ns
```

A throw costs roughly 500 times more than a failed `TryParse` here, and a
successful `Parse` is as cheap as a `TryParse`. That is why the guideline says
a `Try` method is for the case that fails in normal operation.

## Trade-offs

- **`TryParse` for untrusted input, `Parse` for trusted input.** A `Parse` on a
  constant, a configuration value you wrote or a file you generated gives a
  clear exception with a stack trace when the assumption breaks. Use `TryParse`
  where invalid text is a normal case and report a good error to the user.
- **`TryParse` hides why it failed.** The `false` does not say whether the
  text was empty, malformed or too big. If the caller needs the reason (a form
  with field messages), parse in steps or return a result type with an error
  code, which is a design cost the `bool` signature does not carry.
- **Default styles are permissive in ways you may not want.** `double` accepts
  group separators and `Infinity`; `Enum` accepts any number. Pass
  `NumberStyles.None` or `NumberStyles.AllowLeadingSign` for identifiers and
  counts, and check `double.IsFinite` and `Enum.IsDefined` afterwards.
- **A silent wrong value is worse than an exception.** `"1.5"` read as `15`
  and `03/04/2026` read as March or April do not fail. Any parser that reads
  stored or exchanged data must name its culture and, for dates, its exact
  format.
- **`IParsable<T>` buys generic code and a stable contract, at the price of
  implementing four methods.** For a type used by one caller, a single `Parse`
  method is enough. Implement the interface when the type is a value object that
  the generic code (binding, serializers, generic readers) should handle.
- **Implementing `ISpanParsable<T>` pushes the real work into spans.** The
  code is allocation-free and a little harder to read (slicing, `IndexOf`). It
  pays off in loops over large inputs, and not in a settings screen.
- **A `Try` method must keep a narrow meaning.** If it also swallows
  unrelated errors (a null reference, an invalid option), bugs disappear into
  `false`. Return `false` for the documented bad input and let programming
  errors throw.

## Documentation Links

- [Parse numeric strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/parsing-numeric) (doc)
- [Parse date and time strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/parsing-datetime) (doc)
- [Int32.TryParse method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.int32.tryparse) (doc)
- [NumberStyles enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.numberstyles) (doc)
- [IParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iparsable-1) (doc)
- [Enum.TryParse method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.tryparse) (doc)
- [Exceptions and Performance, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions-and-performance) (doc)
