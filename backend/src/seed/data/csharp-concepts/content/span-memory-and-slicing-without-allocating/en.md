---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`Span<T>` lets code read and write part of an array, a string, a stack buffer,
or native memory without copying it and without allocating. The price is a set
of compiler rules, because a span may point into a stack frame that is about to
disappear. This concept explains what a span is, how slicing differs from
`Substring` and array ranges, the C# 14 implicit span conversions and the
upgrade surprises they bring, the `ref struct` rules, `stackalloc` with a safe
fallback, `scoped`, `params` spans and inline arrays, and when `Memory<T>` or
`MemoryMarshal` is the right tool.

## Use Cases

- Parsing lines, headers, or protocol frames without `Substring` and `Split`
  garbage.
- Small temporary buffers in a hot path, with a pooled fallback for large
  inputs.
- One API that accepts arrays, strings, and stack buffers through a
  `ReadOnlySpan<T>` parameter.
- Upgrading a codebase to C# 14 and understanding new compile errors or
  different overloads.
- Keeping a buffer alive across `await`, where a span cannot go.

## Deep Dive

### A reference and a length

A span is a `readonly ref struct` holding a `ref T` to the first element and a
length. Slicing makes a new pair over the same memory, so it is O(1) and never
copies. A range on an array is different: it allocates a new array.

```csharp
int[] data = { 10, 20, 30, 40, 50 };
int[] copy = data[1..4];              // new array
copy[0] = -1;
Span<int> view = data.AsSpan()[1..4]; // same memory
view[1] = -2;
Console.WriteLine(string.Join(",", data)); // 10,20,-2,40,50
```

Measured per call on .NET 10.0.0 (Apple M4 Max, arm64, Release, after
warm-up), with `line = "2026-10-15;ORD-1042;199.90"`:

| Code | Bytes per call |
|---|---|
| `line.Substring(11, 8)` | 40 |
| `line.AsSpan(11, 8)` | 0 |
| `data[1..4]` | 40 |
| `int.Parse(line.Substring(0, 4))` | 32 |
| `int.Parse(line.AsSpan(0, 4))` | 0 |
| `line.Split(';')` and parse each field | 176 |
| `SumAmounts(line)` below | 0 |

```csharp
static decimal SumAmounts(string line)
{
    ReadOnlySpan<char> s = line;
    decimal total = 0;
    foreach (Range r in s.Split(';'))   // .NET 9+: yields ranges, not strings
        if (decimal.TryParse(s[r], CultureInfo.InvariantCulture, out var d)) total += d;
    return total;
}
```

### C# 14: arrays and strings convert implicitly

The span types always had conversion operators, but user-defined conversions
are ignored for extension receivers and do not help generic type inference.
C# 14 adds language-level *implicit span conversions*: from `T[]` to `Span<T>`
and `ReadOnlySpan<T>`, from `Span<T>` to `ReadOnlySpan<T>`, covariant
conversions into `ReadOnlySpan<T>` (a `Span<string>` to
`ReadOnlySpan<object>`), and from `string` to `ReadOnlySpan<char>`. The same file under `LangVersion 13`
and 14:

```csharp
int[] numbers = { 3, 0, 5, 0 };
numbers.CountZeros();               // 2     C# 13: CS1929, receiver must be ReadOnlySpan<int>
"a,b,,c".CountCommas();             // 3     C# 13: CS1929
C.First(numbers);                   // 3     C# 13: CS0411, T cannot be inferred
Span<string> names = new[] { "ana", "bia" };
ReadOnlySpan<object> objs = names;  //       C# 13: CS0029
C.Pick(numbers);                    // "ReadOnlySpan"  C# 13: CS0121, ambiguous

static class Ext
{
    public static int CountZeros(this ReadOnlySpan<int> s) => s.Count(0);
    public static int CountCommas(this ReadOnlySpan<char> s) => s.Count(',');
}
static class C
{
    public static T First<T>(ReadOnlySpan<T> s) => s[0];
    public static string Pick(IEnumerable<int> e) => "IEnumerable";
    public static string Pick(ReadOnlySpan<int> s) => "ReadOnlySpan";
}
```

Overload resolution now prefers a span conversion, and `ReadOnlySpan<T>` over
`Span<T>`. That changes some existing code when you upgrade:

- `Span<int> ints = MemoryMarshal.Cast<byte, int>(bytes);` compiled in C# 13
  and is CS0029 in C# 14, because the array now binds to the
  `ReadOnlySpan<byte>` overload. Write `bytes.AsSpan()`.
- With overloads `R<T>(IEnumerable<T>)` and `R<T>(Span<T>)`, passing an
  `object[]` that really holds a `string[]` went to `IEnumerable` in C# 13 and
  throws `ArrayTypeMismatchException` in C# 14, because a writable span over a
  covariant array is not allowed. A `ReadOnlySpan<T>` overload avoids it.
- Inside an expression tree, `a.Contains(n)` on an array now binds to
  `MemoryExtensions.Contains`. Compiled it works; interpreted
  (`Compile(preferInterpretation: true)`) it threw `ArgumentException`, and
  LINQ providers that look for `Enumerable.Contains` must handle the new node.
- `array.Reverse()` would have bound to the in-place `MemoryExtensions.Reverse`,
  but .NET 10 adds `Enumerable.Reverse(T[])`: `foreach (var x in r.Reverse())`
  printed `321` and left the array untouched.

### The `ref struct` rules

Because a span can point to the stack, the compiler keeps every span inside
the stack frame that created it:

| Code | Result |
|---|---|
| `class Holder { Span<int> _s; }` | CS8345 |
| `object o = span;` | CS0029: no boxing |
| `Func<int> f = () => span.Length;` | CS8175: no capture |
| a span used after an `await` | CS4007 |
| returning a span over `stackalloc` | CS8352 |

Since C# 13, span locals are allowed in `async` methods and iterators as long
as they are not alive across an `await` or `yield`: a span used only before the
`await` compiled and ran.

### `stackalloc` with a fallback

`stackalloc` assigned to a span needs no `unsafe`, but the stack is limited and
an overflow kills the process. Cap the size and fall back to a pooled array:

```csharp
static string Hex(ReadOnlySpan<byte> bytes)
{
    const int MaxStack = 256;
    char[]? rented = null;
    int needed = bytes.Length * 2;
    Span<char> buf = needed <= MaxStack
        ? stackalloc char[MaxStack]
        : (rented = ArrayPool<char>.Shared.Rent(needed));
    try
    {
        for (int i = 0; i < bytes.Length; i++)
            bytes[i].TryFormat(buf.Slice(i * 2, 2), out _, "X2");
        return new string(buf[..needed]);
    }
    finally
    {
        if (rented is not null) ArrayPool<char>.Shared.Return(rented);
    }
}
```

`Convert.ToHexString` already exists; the pattern is the point. For 16 and for
1,024 input bytes, the only allocation measured was the result string. The
documentation adds three rules: treat the new memory as uninitialized, never
`stackalloc` inside a loop, and validate lengths that come from input.

### `scoped`: keeping a span local

A span initialized from a heap array is considered safe to return, so the
compiler refuses to point it at stack memory later. `scoped` limits the
variable to the current method and makes the assignment legal:

```csharp
static int Sum(int n)
{
    scoped Span<int> buf = n > 16 ? new int[n] : default;
    if (n <= 16) buf = stackalloc int[n]; // without scoped: CS8353
    buf.Fill(1);
    int total = 0;
    foreach (var x in buf) total += x;
    return total;
}
```

On a parameter, `scoped` is a promise that the method will not return the span
or store it beyond the call, and the compiler holds the method to it:
returning a `scoped Span<int>` parameter is CS8352.

### `params` spans and inline arrays

A `params ReadOnlySpan<int>` parameter (C# 13) measured 0 bytes per call where
`params int[]` measured 40: for non-constant arguments the compiler builds a
hidden `[InlineArray]` struct on the stack, and for constants it points at data
in the assembly. The same attribute is available to you:

```csharp
[InlineArray(8)]
struct Buffer8 { private int _element0; }

var b = new Buffer8();
b[0] = 7;
Span<int> s = b;  // a view over the struct's own storage
s[1] = 8;
// Unsafe.SizeOf<Buffer8>() is 32; b[1] is 8
```

An inline array is a fixed-size buffer embedded in its container with no
separate allocation. Its default `Equals` throws `NotSupportedException`
(.NET 9 and later), so compare through the span.

### `Memory<T>` for storage and `await`

`Memory<T>` is an ordinary struct (internally an object reference, an index,
and a length) that can be a field and can cross `await`. Ask for `.Span` in the synchronous parts:

```csharp
static async Task<int> CountLinesAsync(Stream stream)
{
    Memory<byte> buffer = new byte[4096];
    int lines = 0, read;
    while ((read = await stream.ReadAsync(buffer)) > 0)
        lines += buffer.Span[..read].Count((byte)'\n');
    return lines;
}
```

The usage guidelines summarize the split: synchronous APIs take `Span<T>`,
asynchronous ones take `Memory<T>`, read-only views use the `ReadOnly`
variants, and nobody touches a `Memory<T>` after the call (or its task) that
received it has finished. Async I/O and System.IO.Pipelines applies this to
streams.

### `MemoryMarshal`: leaving the guardrails

`MemoryMarshal.Cast<byte, int>(raw.AsSpan())` reinterprets bytes as ints with
no copy. Writing `ints[1] = 256` changed `raw` to `1,0,0,0,0,1,0,0` on this
little-endian machine, which is exactly why file and network formats should use
`BinaryPrimitives` instead. `MemoryMarshal` and `CollectionsMarshal` (covered in
List<T> and Array Internals) skip checks the safe API makes.

## Trade-offs

- **Spans versus arrays and strings.** No copies and no allocations, but no
  fields, no lambdas, and no `await`. When the data must outlive the method,
  copy it once with `ToArray()` or `ToString()`.
- **`stackalloc` versus the heap.** Free and fast for small sizes, fatal when
  too large. Always cap it, and fall back to `ArrayPool<T>`, which must be
  returned in a `finally`.
- **`Memory<T>` versus `Span<T>`.** Storable and async-friendly, but each
  `.Span` call has to work out what the object behind it is, and the
  guidelines call `Span<T>` the faster type. Keep `Memory<T>` at the boundaries
  and use spans inside.
- **C# 14 conversions.** Fewer overloads and APIs that accept arrays and strings
  directly, at the cost of overloads changing on upgrade. Rebuild, run the
  tests, and review code that mixes `IEnumerable<T>` and span overloads.
- **`MemoryMarshal` and inline arrays.** Zero-copy and allocation-free, but
  they move responsibility for layout, endianness, and lifetime to you. Keep
  them in small, tested helpers.

## Documentation Links

- [Memory<T> and Span<T> usage guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
- [What's new in C# 14: implicit span conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14#implicit-span-conversions) (doc)
- [First-class span types, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/first-class-span-types) (doc)
- [ref struct types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
- [stackalloc expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/stackalloc) (doc)
- [Avoid memory allocations and data copies (ref safety and scoped), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/) (doc)
- [Structure types: inline arrays, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct#inline-arrays) (doc)
- [MemoryMarshal class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.memorymarshal) (doc)
