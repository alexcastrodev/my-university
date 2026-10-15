---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A `Regex` can be executed three ways: interpreted (the default),
compiled to IL at run time (`RegexOptions.Compiled`), or generated as C# at build
time with the `[GeneratedRegex]` attribute. The generated form removes the
startup work, runs at least as fast as `Compiled`, and works where run-time code
generation does not, such as Native AOT. This concept covers how to declare a
generated regex, what it costs and saves (with measurements), the cases where it
silently falls back to a plain `Regex`, and the analyzers that guide you. It also
covers ReDoS, regular expression denial of service: a pattern with ambiguous
nested quantifiers can take exponential time on a short hostile input, and
the defenses are a match timeout, a safer pattern, or the non-backtracking engine.

## Use Cases

- Turning a `static readonly Regex` or a per-request `new Regex(...)` into a
  generated regex so a hot path starts fast and allocates nothing for construction.
- Publishing with Native AOT or trimming, where `RegexOptions.Compiled` cannot emit IL.
- Validating input that an attacker controls (a search box, a header, an upload
  name) without letting one request pin a CPU core.
- Reviewing legacy patterns for catastrophic backtracking before they reach production.

## Deep Dive

### Declaring a generated regex

Put the attribute on a `partial` method or, since .NET 9 and C# 13, on a get-only
`partial` property, inside a `partial` class. The source generator writes the body:

```csharp
public static partial class Patterns
{
    [GeneratedRegex(@"(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})")]
    public static partial Regex Date();

    [GeneratedRegex(@"(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})")]
    public static partial Regex DateProp { get; }

    [GeneratedRegex(@"\d+", RegexOptions.None, matchTimeoutMilliseconds: 250)]
    public static partial Regex WithTimeout();
}

Patterns.Date().IsMatch("2025-11-11");                       // True
Patterns.DateProp.Match("on 2025-11-11").Groups["y"].Value;   // 2025
ReferenceEquals(Patterns.Date(), Patterns.Date());            // True: one cached instance
Patterns.WithTimeout().MatchTimeout;                          // 00:00:00.2500000
Patterns.Date().MatchTimeout;                                 // -00:00:00.0010000, infinite by default
```

The generated type derives from `Regex`, so everything from the previous concept
(`Match`, `EnumerateMatches`, `Count`) works unchanged. The method returns a
cached singleton, so you do not need your own `static readonly` field. The
`RegexOptions.Compiled` flag is ignored. The attribute also takes a culture name
as a third argument, which is how `IgnoreCase` knows which casing rules to bake in.
Note that the default timeout is still infinite: the attribute does not make the
pattern safe, you ask for a timeout with `matchTimeoutMilliseconds`.

### Interpreted, compiled, generated: cost and speed

The interpreter parses the pattern and walks opcodes at match time. `Compiled`
does the same parsing, then emits IL (costly to construct, and it must be
JIT-compiled on first use). The generator moves all of that to build time and
leaves ordinary C# in your assembly, which you can read and step through in a
debugger. Measured on .NET 10, Apple M4 Max, a Release build, each mode in its
own process, the time to construct the object and run one match (three runs per
mode, all within 1 ms of each other):

```text
interpreted      about 6.1 ms
Compiled         about 9.4 ms
NonBacktracking  about 18.9 ms
generated        about 1.6 ms
```

And steady-state throughput counting date matches in an 11,400 character string
(median of 2,000 runs, after warm-up):

```text
interpreted      35.7 us/op
Compiled         35.8 us/op
NonBacktracking  93.2 us/op
generated        23.6 us/op
```

These are Stopwatch measurements of one simple pattern, so read them as a
direction, not a benchmark: here `Compiled` did not beat the interpreter, and
other patterns may differ. What does not change is the shape: generated has the
lowest startup, and no run-time reflection emit, which the docs give as the
reason it is the choice for AOT and for smaller trimmed apps.

### When the generator falls back

For two cases the generator cannot emit custom code and instead caches a regular
`Regex` (still useful, but without the speed or the AOT benefit): an `IgnoreCase`
backreference, and `RegexOptions.NonBacktracking`. You can see the second one:

```csharp
[GeneratedRegex(@"(?<y>\d{4})", RegexOptions.NonBacktracking)]
public static partial Regex NB();

Patterns.NB().GetType().FullName;     // System.Text.RegularExpressions.Regex  (a plain Regex)
Patterns.Date().GetType().BaseType;   // System.Text.RegularExpressions.Regex  (Date() is a generated subclass)
```

### Analyzers

The SDK's analyzers use the IDs SYSLIB1040 to SYSLIB1045. SYSLIB1045 suggests
converting a `new Regex(...)` or a static `Regex.IsMatch(...)` call with a
constant pattern into a generated regex, and offers a code fix. It is only an
info-level diagnostic, so it does not show up in `dotnet build` output until you
raise it in `.editorconfig`:

```text
# .editorconfig
[*.cs]
dotnet_diagnostic.SYSLIB1045.severity = warning

# build output
Program.cs(3,19): warning SYSLIB1045: Use 'GeneratedRegexAttribute' to generate the regular expression implementation at compile-time.
```

The others are errors that point at misuse. A bad pattern fails at build time,
not at the first request:

```text
error SYSLIB1042: The specified regex is invalid. 'Invalid pattern '(unclosed' at offset 9. Not enough )'s.'
error SYSLIB1043: GeneratedRegexAttribute method or property must be partial, parameterless, non-generic, non-abstract, and return Regex.
```

SYSLIB1040 is invalid attribute usage, SYSLIB1041 is multiple attributes on one
member, and SYSLIB1044 is an internal limitation of the generator.

### ReDoS: catastrophic backtracking, always with a limit

A backtracking engine that fails a match must prove that no path works, and with
nested quantifiers the number of paths is exponential in the input length. The
classic is `^(a+)+$` against a run of `a` followed by something that is not `a`.
The demo below always sets a short timeout, so it cannot hang:

```csharp
var evil = new string('a', 26) + "!";
var bounded = new Regex(@"^(a+)+$", RegexOptions.None, TimeSpan.FromMilliseconds(200));
try { bounded.IsMatch(evil); }
catch (RegexMatchTimeoutException e)
{
    // interpreter: timeout at 200 ms (limit 200 ms, pattern ^(a+)+$)
}
```

Real results, each run with a 200 ms limit:

```text
interpreted    ^(a+)+$  on 26 a + "!"   timeout at 200 ms
generated      ^(a+)+$  on 26 a + "!"   timeout at 199 ms   (generation does not fix the algorithm)
(a|aa)+        on 30 a + "!"            timeout at 199 ms   (overlapping alternatives)
NonBacktracking ^(a+)+$ on 26 a + "!"  False in 13 ms
rewritten  ^(?>a+)$                      False in 0 ms
```

Three defenses, and you can combine them. First, a `matchTimeout` on every
regex that sees untrusted input, handled as an error, not retried forever. The
docs recommend a timeout whenever you use the backtracking engine on untrusted
input. Second, a rewrite that removes the ambiguity: `(a+)+` and `a+` accept the
same strings, so write `a+`; an atomic group `(?>...)` stops the engine from
backing into a part that already matched. Third, `RegexOptions.NonBacktracking`,
whose running time is linear in the input, for patterns that do not need
lookaround or backreferences. Also cap the input length before you match: a
2 KB limit on a form field removes most of the danger.

## Trade-offs

- **Generated code grows the assembly.** Each pattern adds C# that is compiled
  into your project. For a pattern used once at startup, the interpreter is
  simpler and its cost does not matter.
- **The pattern must be a compile-time constant.** A pattern read from
  configuration or built from user input cannot use `[GeneratedRegex]`. For
  those, build a `Regex` with a timeout, and prefer `NonBacktracking` when the
  pattern itself is untrusted.
- **Fallbacks hide the loss.** `NonBacktracking` and `IgnoreCase` backreferences
  compile without complaint but give you a plain `Regex`. Check the type, or the
  generated source, when you chose the generator for AOT.
- **A timeout bounds damage but burns CPU until it fires.** In the demo each bad
  request cost its full 200 ms of a core. Under load, a short limit plus an input
  length cap beats a long limit.
- **`RegexMatchTimeoutException` is not proof of an attack.** A tight limit on a
  busy machine can throw for an innocent input. Log it with the pattern (the
  exception exposes `Pattern` and `MatchTimeout`), reject the request, and do not
  fall back to a slower retry.
- **Rewriting a pattern can change what it accepts.** Replacing `(a+)+` with `a+`
  is safe because they accept the same strings, but swapping a group for an
  atomic group can reject inputs that used to match through backtracking. Keep
  a test with both matching and hostile strings.
  ```csharp
  Regex.IsMatch("aab", @"(?>a+)ab");   // False: the atomic group keeps both a's, so "ab" cannot match
  Regex.IsMatch("aab", @"a+ab");       // True
  ```

## Documentation Links

- [.NET regular expression source generators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators) (doc)
- [GeneratedRegexAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.generatedregexattribute) (doc)
- [SYSLIB diagnostics for regex source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib1040-1049) (doc)
- [Backtracking in .NET regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/backtracking-in-regular-expressions) (doc)
- [Best practices for regular expressions in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex) (doc)
- [Regex.MatchTimeout property, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.regex.matchtimeout) (doc)
