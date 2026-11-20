---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

`$"..."` looks like one feature and is really four: a constant, a `string.Concat`, a `DefaultInterpolatedStringHandler` and a `FormattableString`, picked by the compiler from the shape of the string and the type it is converted to. This concept opens that box with the IL, then builds on it: a handler of your own (logging that skips the work when the level is off, and SQL that turns holes into parameters), the formatting interfaces that let a value write itself into a `Span<char>` or `Span<byte>` without allocating (`ISpanFormattable`, `IUtf8SpanFormattable`), providers and `ICustomFormatter`, and who consumes `IParsable<T>`. The hole syntax, specifiers, culture basics, `CompositeFormat` and the first look at handlers are in `formatting-values-and-interpolated-strings`, and parsing in `parsing-tryparse-and-the-try-pattern`; this one does not repeat them.

Versions: .NET SDK 10.0.100 (runtime 10.0.0, Roslyn from the SDK), TFM `net10.0`, BenchmarkDotNet 0.15.8 (ShortRun, `[MemoryDiagnoser]`), `ilspycmd` 11.2.0 for the IL, ASP.NET Core 10.0.0 shared framework, macOS arm64 (Apple M4 Max, 14 cores). ShortRun has wide error bars: read the ratios and the allocation column, not the last digit.

## Use Cases

- A logging or tracing API of your own where a disabled level must cost nothing.
- A query builder that must never concatenate user input: `Sql.Query($"... {name}")`.
- Writing numbers, GUIDs and dates into a network or file buffer (UTF-8 bytes) without creating strings.
- A value type (`Money`, `Point`) that formats and parses like `int` and `Guid`.
- Reading what the compiler did when a hot path allocates more than expected.

## Deep Dive

### What the compiler emits

I compiled one method per case in Release and read the IL with `ilspycmd -il` (the default C# view of ILSpy turns the IL back into `$"..."`, so it hides the answer).

```csharp
const string A = "alpha", B = "beta";
const string Joined = $"{A}-{B}";          // ldstr "alpha-beta"       (C# 10 constant)
$"{a}-{b}"            // a, b strings    -> string.Concat(a, "-", b)
$"id={i}"             // int hole        -> DefaultInterpolatedStringHandler
$"{d:F2}"             // format          -> AppendFormatted<double>(d, "F2")
$"[{s,8}]"            // alignment       -> AppendFormatted<string>(s, 8)
string.Create(p, $"n={i}")  // provider  -> handler built with (2, 1, p), then string.Create(p, ref handler)
FormattableString fs = $"n={i}";  // -> FormattableStringFactory.Create("n={0}", new object[] { (object)i })
string.Format("{0}:{1}", i, s)    // -> box i, then String.Format(string, object, object)
i + ":" + s           //               -> i.ToString(), then String.Concat(string, string, string)
```

The handler case, `$"id={i}"`, is this IL (trimmed):

```
ldloca.s 0 ; ldc.i4.3 ; ldc.i4.1 ; newobj DefaultInterpolatedStringHandler::.ctor(int32, int32)
ldloca.s 0 ; ldstr "id=" ; call AppendLiteral(string)
ldloca.s 0 ; ldarg.0       ; call AppendFormatted<int32>(!!0)
ldloca.s 0                 ; call ToStringAndClear()
```

The two constructor arguments are the total length of the literal parts (3) and the number of holes (1), the pre-size hint. A hole of type `string` binds the non-generic `AppendFormatted(string)`, and a `string` hole with alignment binds the generic one; `$"{o}"` over an `object` is `AppendFormatted<object>`. The `FormattableString` case is the expensive one: a boxed value plus an `object[]` before anything is formatted. A `const` accepts only string constants: with `const int N = 5`, `const string Bad = $"{S}-{N}"` fails with `CS0133` (the literals concept covers constants too).

### Writing a handler: skip the work when nobody reads it

A handler is a type marked `[InterpolatedStringHandler]` with a constructor `(int literalLength, int formattedCount, ...)`, an `AppendLiteral(string)` and one or more `AppendFormatted` overloads (`<T>(T)`, `<T>(T, string?)`, `<T>(T, int, string? = null)`). A constructor parameter `out bool shouldAppend` lets it refuse, and `[InterpolatedStringHandlerArgument("")]` on the API parameter tells the compiler to pass the receiver (`this`) to the constructor:

```csharp
public sealed class Logger
{
    public bool DebugEnabled;
    public void Debug(string message) { if (DebugEnabled) Write(message); }
    public void Debug([InterpolatedStringHandlerArgument("")] ref DebugHandler h)
    { if (DebugEnabled) Write(h.Text()); }
}

[InterpolatedStringHandler]
public ref struct DebugHandler
{
    private DefaultInterpolatedStringHandler _inner;   // reuse the pooled-buffer machinery
    private readonly bool _on;
    public DebugHandler(int literalLength, int formattedCount, Logger logger, out bool shouldAppend)
    {
        _on = shouldAppend = logger.DebugEnabled;
        _inner = _on ? new DefaultInterpolatedStringHandler(literalLength, formattedCount) : default;
    }
    public void AppendLiteral(string s) => _inner.AppendLiteral(s);
    public void AppendFormatted<T>(T value) => _inner.AppendFormatted(value);
    public void AppendFormatted<T>(T value, string? format) => _inner.AppendFormatted(value, format);
    public void AppendFormatted<T>(T value, int alignment, string? format = null) => _inner.AppendFormatted(value, alignment, format);
    public string Text() => _on ? _inner.ToStringAndClear() : "";
}
```

Measured with `log.Debug($"user {id} did {action} for {price:F2}")`, the `string` rows cast the interpolation to `string` to select the old overload:

```
| Method      | Mean      | Ratio | Allocated |
| Off_String  | 62.291 ns |  1.00 |      88 B |
| Off_Handler |  3.866 ns |  0.06 |         - |
| On_String   | 62.533 ns |  1.00 |      88 B |
| On_Handler  | 64.675 ns |  1.04 |      88 B |
```

With the level off the handler skips formatting, the allocation and the evaluation of the holes (the existing formatting concept shows a hole method called 0 times). With it on, the wrapper costs the same as plain interpolation. Two limits matter. `Microsoft.Extensions.Logging.Abstractions` 10.0.0 has zero methods that take a handler (I checked by reflection over the assembly), so `ILogger.LogDebug($"...")` still builds the string: for `ILogger` the answer is `[LoggerMessage]` (see the ILogger concept). The pattern is for your own APIs, and the BCL uses it that way: reflection on CoreLib lists `Debug.Assert`, `Debug.WriteIf`, `StringBuilder.Append`, `MemoryExtensions.TryWrite`, `Utf8.TryWrite` and `DefaultInterpolatedStringHandler`. Docs only (not run here): if every `Append*` returns `bool` instead of `void`, a `false` stops the remaining appends, which is how a handler gives up halfway (a length limit, for example); mixing the two return types is a compile error.

### A handler that is not about strings

Because the compiler hands the handler the literals and the values separately, the values never have to become text. A handler can turn each hole into a parameter:

```csharp
[InterpolatedStringHandler]
public ref struct SqlHandler
{
    private readonly StringBuilder _sb; private readonly List<object?> _params;
    public SqlHandler(int literalLength, int formattedCount)
    { _sb = new(literalLength + formattedCount * 3); _params = new(formattedCount); }
    public void AppendLiteral(string s) => _sb.Append(s);
    public void AppendFormatted<T>(T value) { _sb.Append("@p").Append(_params.Count); _params.Add(value); }
    public SqlQuery Build() => new() { Text = _sb.ToString(), Parameters = _params };
}
public static class Sql { public static SqlQuery Query(SqlHandler h) => h.Build(); }

Sql.Query($"select * from users where name = {"Robert'); drop table users;--"} and age > {30}")
// select * from users where name = @p0 and age > @p1 | params: Robert'); drop table users;--, 30
```

The API has no `string` overload, so `Sql.Query(someString)` does not compile (`CS1503: cannot convert from 'string' to 'SqlHandler'`) and a caller cannot concatenate by accident. EF Core's `FromSql(FormattableString)` is the same idea built on the `FormattableString` path above, which boxes every value and allocates an array.

### Overload resolution decides which one runs

Four pairs of overloads, called with `$"n={1}"`:

```
Which(string)          vs Which(FormattableString)  -> string
W2(string)             vs W2(SqlHandler)            -> handler
W3(FormattableString)  vs W3(IFormattable)          -> FormattableString
W4(FormattableString)  vs W4(SqlHandler)            -> SqlHandler
```

The handler beats `string` and `FormattableString`, and `string` beats `FormattableString`. The consequence is behavioral: adding a handler overload next to an existing `string` one recompiles every interpolated call site to the new path without a source change. That is the point for logging, and a surprise when the handler formats differently (see the culture section). A call with a `string` variable keeps the `string` overload.

### Formatting without allocating: ISpanFormattable and IUtf8SpanFormattable

`ISpanFormattable.TryFormat(Span<char>, out int, ReadOnlySpan<char>, IFormatProvider?)` writes into the caller's buffer and returns `false` when it does not fit. `IUtf8SpanFormattable` (.NET 8) is the same with `Span<byte>`, producing UTF-8 directly. The Learn page lists `Int32`, `Guid`, `DateTime`, `DateTimeOffset`, `Decimal`, `Double` and the other numeric types, and I confirmed with `is`: `int`, `Guid` and `DateTime` are `IUtf8SpanFormattable`, `string` is not. Measured, `n = 1234567`, a `Guid`, `DateTime` with `"O"`, all with the invariant culture:

```
| Method                  | Mean      | Allocated |
| Int_ToString            |  4.423 ns |      40 B |
| Int_TryFormat_Char      |  1.825 ns |         - |
| Int_TryFormat_Utf8      |  2.183 ns |         - |
| Guid_ToString           |  5.963 ns |      96 B |
| Guid_TryFormat_Char     |  1.207 ns |         - |
| Guid_TryFormat_Utf8     |  1.041 ns |         - |
| DateTime_ToString       | 13.072 ns |      80 B |
| DateTime_TryFormat_Char |  6.979 ns |         - |
| DateTime_TryFormat_Utf8 |  6.756 ns |         - |
```

Your own type implements the interfaces the same way. Write the span versions as the real implementation and let `ToString` use them, so the logic lives once. `Money` below formats the decimal straight into the destination and fails cleanly when the buffer is short (the UTF-8 overload copies currency codes as ASCII, which is enough for ISO codes and not for arbitrary text):

```csharp
public readonly record struct Money(decimal Amount, string Currency) : IFormattable, ISpanFormattable, IUtf8SpanFormattable
{
    public string ToString(string? format, IFormatProvider? provider)
        => string.Create(provider, $"{Amount.ToString("N2", provider)} {Currency}");
    public bool TryFormat(Span<char> destination, out int charsWritten, ReadOnlySpan<char> format, IFormatProvider? provider)
    {
        charsWritten = 0;
        if (!Amount.TryFormat(destination, out int n, "N2", provider)) return false;
        if (destination.Length < n + 1 + Currency.Length) return false;
        destination[n] = ' '; Currency.CopyTo(destination[(n + 1)..]);
        charsWritten = n + 1 + Currency.Length; return true;
    }
    public bool TryFormat(Span<byte> utf8Destination, out int bytesWritten, ReadOnlySpan<char> format, IFormatProvider? provider)
    { /* same shape: decimal.TryFormat into the bytes, then the ASCII currency */ }
}
// de-DE: ok=True w=16 text=1.234.567,89 EUR      an 8-char buffer: ok=False w=0
```

```
| Money_ToString        | 40.107 ns | 104 B |
| Money_TryFormat_Char  | 26.770 ns |     - |
| Money_TryFormat_Utf8  | 24.244 ns |     - |
| Interp_Money          | 39.985 ns |  72 B |   string.Create(invariant, $"total={m}")
| Utf8_GetBytes_Interp  | 24.408 ns | 120 B |   Encoding.UTF8.GetBytes(string.Create(inv, $"n={n} g={g}"))
| Utf8_TryWrite         |  7.866 ns |     - |   Utf8.TryWrite(buf, inv, $"n={n} g={g}", out w)
```

`Interp_Money` allocates 72 bytes, the size of the result string only: the handler found `ISpanFormattable` on the struct and wrote into its own buffer. `Utf8.TryWrite` is the same handler idea targeting bytes, three times faster than formatting to a string and encoding it, with nothing allocated. A measurement trap: a hand-rolled loop with `GC.GetAllocatedBytesForCurrentThread` printed 24 bytes per call for an `int` hole and 40 for `Money` while the code was still in tier 0 (consistent with the value being boxed there); with `DOTNET_TieredCompilation=0` the same loop printed 0 for `int`, `Guid`, `DateTime`, a plain struct and `Money`. Use BenchmarkDotNet, which warms up.

### Providers and ICustomFormatter

Every `ToString(format, provider)` and `TryFormat` receives an `IFormatProvider`. Its only method, `GetFormat(Type)`, returns an object describing the culture (`NumberFormatInfo`, `DateTimeFormatInfo`) or an `ICustomFormatter`. Return a custom formatter and it is offered every hole:

```csharp
public sealed class BytesFormatter : IFormatProvider, ICustomFormatter
{
    public object? GetFormat(Type? t) => t == typeof(ICustomFormatter) ? this : null;
    public string Format(string? format, object? arg, IFormatProvider? provider)
    {
        if (format == "bytes" && arg is long b) { /* scale to KB, MB, GB */ }
        return arg is IFormattable f ? f.ToString(format, CultureInfo.InvariantCulture) : arg?.ToString() ?? "";
    }
}
string.Create(bf, $"{123456789L:bytes} {1536L:bytes} {1.5:F2}")   // 117.7 MB 1.5 KB 1.50
string.Format(bf, "{0:bytes} {1:bytes}", 123456789L, 5L)          // 117.7 MB 5 B
$"{123456789L:bytes}"                                             // bytes
```

The last line is the silent failure: with no provider, `bytes` is not a known format, and in a custom numeric format the letters are literals, so the output is the word `bytes` without an exception. A custom formatter gets each hole as a boxed `object` and must forward every other format itself, so reserve it for formats you own.

The provider is also where a handler of yours leaks the culture. `DebugHandler` above creates its inner handler without a provider, so it follows the machine, while `string.Create(CultureInfo.InvariantCulture, ...)` does not. With `CurrentCulture` set to pt-BR:

```
handler wrapper, current pt-BR:   price=1,5 when=20/11/2026
string.Create(Invariant):         price=1.5 when=11/20/2026
```

For logs read by people, that is right. For anything parsed later, give the handler constructor an `IFormatProvider` (or fix it to invariant) and pass it to `new DefaultInterpolatedStringHandler(l, c, provider)`.

### Who consumes IParsable

An ASP.NET Core 10 minimal API binds route, query and header values to a parameter type that has `TryParse(string, out T)` or `TryParse(string, IFormatProvider, out T)` (the Learn page lists both, and `BindAsync` for custom binding). I mapped `Point : IParsable<Point>` and some built-ins on Kestrel with `CurrentCulture` set to pt-BR, and called each URL:

```
GET /point?p=3.5;-2      200  X=3.5 Y=-2 provider=CultureInfo/invariant currentCulture=pt-BR
GET /point?p=3,5;-2      400
GET /ratio/1,5           200  r=15            (double: the comma is a group separator)
GET /ratio/1.5           200  r=1.5
GET /when?d=2026-11-20   200  d=2026-11-20    GET /when?d=20/11/2026   400   (DateOnly)
GET /color?d=Friday      200                  GET /color?d=friday      400   (enum, case sensitive)
GET /color?d=99          200  d=99            (an undefined enum value passes)
GET /opt?n=x             400                  GET /opt                 200  n=null   (int?)
```

The binder passed the invariant culture, not the machine's: a client sends `1.5` and the server's culture does not matter, which is correct for an API. `1,5` is not an error for a `double`, it is 15, the same trap the parsing concept measures with `double.Parse`. In the interface family, `IUtf8SpanParsable<T>` is the UTF-8 sibling (numbers implement it). Docs only: the System.CommandLine pages on Learn do not mention `IParsable<T>`; custom argument types use a `CustomParser` delegate on the `Argument<T>` (a `CustomParser` appears in the get-started tutorial).

### Book vs today

Older books teach `string.Format("{0}:{1}", i, s)` and `+` as the two ways to build text, and `IFormattable.ToString(format, provider)` as the only hook for your own types. In the IL above, `string.Format` boxes each value type and `i + ":" + s` creates a temporary string for `i` before the `Concat`, while an interpolation whose holes are all strings compiles to `Concat` with no temporary. For anything with a non-string hole the compiler uses the handler, which formats into a pooled buffer, and the formatting concept measured 48 bytes for it against 72 for `string.Format` and 88 for `+`. The hook that matters for hot paths is now `TryFormat` (.NET 6 for chars, .NET 8 for UTF-8), and `ToString` becomes a convenience over it.

## Trade-offs

- **A handler is a `ref struct`.** It cannot be a field of a class, cross an `await` or be captured by a lambda, which is why the API takes it as a parameter and consumes it in the call. Keep `Text()`-style materialization inside the method that received it.
- **A new handler overload changes which method binds.** Callers recompile onto it silently, so the semantics must match the `string` overload (same culture, same output), or the change is a behavior break dressed as an optimization.
  ```csharp
  void Log(string m); void Log([InterpolatedStringHandlerArgument("")] ref Handler h);   // log.Log($"{x}") now calls the second
  ```
- **Skipping evaluation is the feature and the trap.** With `shouldAppend` false the hole expressions never run, so a hole with a side effect (`{queue.Dequeue()}`) is a bug in a disabled path. Keep holes pure.
- **`ISpanFormattable` duplicates the formatting path unless `ToString` delegates to it.** Two implementations drift. In a settings screen it is wasted code, and in a serializer or a log pipeline it is the difference between 0 and 104 bytes per value (the `Money` table).
- **UTF-8 formatting is not a free encode.** Numbers, GUIDs and ISO dates are ASCII, so `IUtf8SpanFormattable` is simple for them. A type with culture-specific text (a currency symbol, a month name) must encode properly, and the sample cheats with ASCII codes.
- **`ICustomFormatter` is global behavior behind a provider.** It boxes every hole and, if it forgets to forward a format, hides bugs (`bytes` printed as a literal). Prefer a type with its own `IFormattable` and a format letter when you own the type.
- **ShortRun is for ratios.** The error columns here reach up to about 40 percent of the mean for some rows; the claims in this concept rest on the allocation column and on order-of-magnitude ratios (0.06 for the disabled handler, 0 bytes for `TryFormat`).

## Documentation Links

- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [Write a custom string interpolation handler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/interpolated-string-handler) (doc)
- [Improved interpolated strings, C# 10 feature specification, csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-10.0/improved-interpolated-strings.md) (doc)
- [DefaultInterpolatedStringHandler class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.defaultinterpolatedstringhandler) (doc)
- [InterpolatedStringHandlerArgumentAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.interpolatedstringhandlerargumentattribute) (doc)
- [ISpanFormattable interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.ispanformattable) (doc)
- [IUtf8SpanFormattable interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iutf8spanformattable) (doc)
- [Utf8.TryWrite method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.unicode.utf8.trywrite) (doc)
- [ICustomFormatter interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icustomformatter) (doc)
- [IFormatProvider interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iformatprovider) (doc)
- [IParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iparsable-1) (doc)
- [IUtf8SpanParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iutf8spanparsable-1) (doc)
- [Parameter binding in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Get started with System.CommandLine, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/commandline/get-started-tutorial) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [BenchmarkDotNet](https://benchmarkdotnet.org/) (doc)
