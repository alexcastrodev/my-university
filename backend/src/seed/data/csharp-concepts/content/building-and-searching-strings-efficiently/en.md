---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Strings are immutable, so every "change" allocates a new one, and the obvious way
to search for several things at once is a loop of `IndexOf` calls. Both are fine
in a one-off script and costly in a hot path. This concept covers the tools
.NET gives you to build text without a pile of garbage (`StringBuilder`,
`string.Create`, spans, `ArrayPool<T>`) and to search it with vectorized code
(`SearchValues<T>`), plus how to measure instead of guessing. It builds on the
comparison rules from the strings concept: every search here is ordinal.

## Use Cases

- Assembling a large report, CSV or log line from thousands of pieces in a loop.
- Formatting an identifier or a fixed-width field straight into its final
  `string`, with no intermediate copies.
- Scanning each incoming request or log line for a set of forbidden characters
  or keywords, many times per second.
- Reviewing a PR that "optimizes" string code and deciding whether the change is
  real or only looks faster.

## Deep Dive

### Concatenation in a loop versus StringBuilder

`s += x` creates a new string every time, copying everything built so far, so a
loop of n appends does O(n²) copying. A `StringBuilder` keeps a chunked buffer
and appends in amortized constant time, and you pay for one final copy in
`ToString()`:

```csharp
const int N = 20000;
var sw = Stopwatch.StartNew();
string c = ""; for (int i = 0; i < N; i++) c += "x";
Console.WriteLine($"concat {sw.ElapsedMilliseconds}ms len {c.Length}");   // concat 12ms len 20000
sw.Restart();
var b2 = new StringBuilder(); for (int i = 0; i < N; i++) b2.Append("x");
Console.WriteLine($"sb {sw.ElapsedMilliseconds}ms len {b2.Length}");      // sb 0ms len 20000
```

Those numbers are from one run on a laptop, and a hand-rolled `Stopwatch` loop is
only a smoke test (more on that below). The shape is what matters: the concat
line grows quadratically with N, the builder does not. A single expression such
as `"id=" + id + ";" + name` is not the problem; it is a fixed number of pieces,
not a loop. An interpolated string (`$"..."`) is just as fine there.

`StringBuilder` has a few details worth knowing. `Append` returns the builder, so
calls chain, and `Append('x', 3)` repeats a character. A new builder starts with
a capacity of 16 and grows by adding chunks, so pass an expected size to the
constructor if you know it. For very large builders, `GetChunks()` hands you the
pieces as `ReadOnlyMemory<char>` so you can write them to a stream without ever
calling `ToString()`.

### string.Create and spans: format straight into the result

When the final length is known, `string.Create` allocates the `string` once and
lets you fill its characters through a `Span<char>`, with no temporary builder:

```csharp
string hex = string.Create(8, 0xBEEF, (span, v) => v.TryFormat(span, out _, "X8"));
Console.WriteLine(hex);     // 0000BEEF

int n = 42;
Span<char> stack = stackalloc char[32];
bool ok = stack.TryWrite($"id={n:D5}", out int w);   // interpolation into a span
Console.WriteLine(stack[..w].ToString());             // id=00042
```

The state argument (`0xBEEF` here) exists so the lambda does not need to capture,
which lets it be a static, allocation-free delegate. `TryWrite` with an
interpolated string formats into any `Span<char>`, here a small `stackalloc`
buffer, and returns `false` if the text did not fit. Use the stack only for
small, bounded sizes. This is the same span machinery from the span concept,
applied to text.

### Renting buffers with ArrayPool

For medium or large temporary buffers, renting beats allocating:

```csharp
char[] buf = ArrayPool<char>.Shared.Rent(10);
Console.WriteLine(buf.Length);       // 16: at least the size you asked for
ArrayPool<char>.Shared.Return(buf);
```

The documentation says the array is "at least the requested length" and "may not
be zero-initialized". Always slice to the length you actually need, never rely on
`buf.Length` or on its starting contents, and return it in a `finally` so a
failure does not leak it. Forgetting to return is not fatal, the pool just
allocates a replacement, but you lose the benefit. Do not use the buffer after
`Return`: another caller may already own it. If the buffer held secrets, pass
`clearArray: true` to `Return`.

### SearchValues: a vectorized "any of these"

Searching for one of several characters with `IndexOfAny("aeiou")` re-analyzes the
set on every call. `SearchValues<T>` does that analysis once, at creation, and
picks an algorithm that can use SIMD. Create it once, keep it in a
`static readonly` field, and use it with the span search methods:

```csharp
var vowels = SearchValues.Create("aeiou");
Console.WriteLine("rhythm and blues".AsSpan().IndexOfAny(vowels));   // 7

var words = SearchValues.Create(["error", "fatal"], StringComparison.OrdinalIgnoreCase);
Console.WriteLine("all ok, then FATAL happened".AsSpan().IndexOfAny(words));  // 13
Console.WriteLine("nothing".AsSpan().ContainsAny(words));                    // False
```

The overload that takes strings returns a `SearchValues<string>` and searches for
substrings, not just characters. Per the API docs it exists from .NET 9, and only
`Ordinal` or `OrdinalIgnoreCase` may be used. The char and byte overloads are
available since .NET 8. The concrete type behind the instance is an
implementation detail that the runtime picks from your input (in this run, an
ASCII-specialized one), so do not depend on it.

### Measure, then decide

Here is the same task, finding the first of four keywords, with a loop of `IndexOf`
calls and with `SearchValues`, over a 9 KB string, 20,000 iterations after a
warm-up:

```
loop: 90.3 ms
searchvalues: 43.3 ms
```

Roughly 2x on this input and this machine; the gap changes with text length,
how early the match is, and the keyword set. That is the point: do not carry the
number, carry the habit. For real decisions use BenchmarkDotNet, which handles
warm-up, JIT tiers, GC noise and statistics, and can report allocations per
operation with `[MemoryDiagnoser]`. A stopwatch loop like the one above is fine
to check an order of magnitude, never to publish a conclusion.

## Trade-offs

- **`StringBuilder` is not free for small jobs.** For three or four known pieces,
  a plain `+` or an interpolated string is faster and clearer, because the builder
  is itself a heap object. Reach for it when the number of appends is not known
  or is in the thousands.
- **`string.Create` and `stackalloc` trade readability for allocations.** Use them
  where a profiler points, such as formatting millions of identifiers. A
  `stackalloc` over a few hundred chars is fine; over a size an outsider controls
  it can overflow the stack.
- **Pooled arrays are shared mutable state.** A bug that reads after `Return`, or
  assumes zeroed memory, produces corrupt data far from the cause. Prefer the
  simpler allocation until the allocation shows up in a measurement.
- **`SearchValues` pays at creation.** Building one costs more than a single
  search, so creating it inside the hot method defeats the point. A rare search
  over a short string is not worth it.
- **Vectorized search is ordinal.** `SearchValues<string>` cannot do culture-aware
  matching. For user-visible, linguistic search you still need culture-aware
  methods and their cost.

## Documentation Links

- [StringBuilder class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.stringbuilder) (doc)
- [String.Create method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.string.create) (doc)
- [SearchValues class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.searchvalues) (doc)
- [ArrayPool<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
