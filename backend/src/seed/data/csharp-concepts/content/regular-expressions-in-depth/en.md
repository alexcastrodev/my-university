---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A regular expression is a small program that the `Regex` class runs against
text, and in .NET there is more than one way it can be run. The default engine
tries alternatives one at a time and goes back when a choice fails
(backtracking), which is what makes lookarounds and backreferences possible and
also what makes some patterns slow. An opt-in engine, `RegexOptions.NonBacktracking`,
runs in time proportional to the input but supports fewer constructs. This
concept covers the two engines, the options that change what a pattern means
(`IgnoreCase`, `CultureInvariant`, `ECMAScript`, `ExplicitCapture`), named
groups, lookaround, greedy versus lazy quantifiers, the allocation-free
`EnumerateMatches`, and match timeouts.

## Use Cases

- Validating and extracting structured pieces of text such as dates, log lines,
  and identifiers, with named groups instead of numeric indexes.
- Reformatting text with `Regex.Replace` and group references, for example turning
  `2025-11-11` into `11/11/2025`.
- Counting or scanning large inputs without allocating a `Match` object per hit.
- Choosing between the backtracking and the non-backtracking engine when a pattern
  will run on input that someone else controls.

## Deep Dive

### Groups, named captures, and Replace

Parentheses create numbered capture groups. A name, `(?<name>...)`, makes the
code survive edits to the pattern, because numbers shift when a group is added
and names do not. The replacement string can reference groups as `${name}`.

```csharp
var date = new Regex(@"(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})");
var m = date.Match("Released on 2025-11-11, patched 2025-12-09.");
Console.WriteLine($"{m.Value} year={m.Groups["year"].Value} idx={m.Index} len={m.Length}");
// 2025-11-11 year=2025 idx=12 len=10
Console.WriteLine(m.NextMatch().Value);                                   // 2025-12-09
Console.WriteLine(date.Replace("2025-11-11", "${day}/${month}/${year}")); // 11/11/2025
Console.WriteLine(date.Count("a 2025-11-11 b 2025-12-09"));               // 2
```

Numbering has one surprise: unnamed groups are numbered first, left to right,
and named groups come after them. `new Regex(@"(?<a>\d)(\d)")` has group names
`0,1,a`, so the unnamed `(\d)` is group 1 and `a` is group 2. When you do not
need captures at all, `RegexOptions.ExplicitCapture` turns plain parentheses
into non-capturing groups (`new Regex(@"(\d)(\d)", RegexOptions.ExplicitCapture)`
yields a `Groups.Count` of 1, only group 0), which saves the engine bookkeeping.

### Greedy versus lazy, and anchors

A quantifier is greedy by default: it takes as much as it can and gives back on
failure. Adding `?` makes it lazy. The backtracking engine's search order is
what makes the difference:

```csharp
string html = "<b>one</b><b>two</b>";
Console.WriteLine(Regex.Match(html, "<b>.*</b>").Value);   // <b>one</b><b>two</b>
Console.WriteLine(Regex.Match(html, "<b>.*?</b>").Value);  // <b>one</b>

Console.WriteLine(Regex.IsMatch("abc\n", @"^abc$"));   // True: $ also matches before a final newline
Console.WriteLine(Regex.IsMatch("abc\n", @"^abc\z"));  // False: \z is the real end of input
```

For validation, prefer `\z` (or `\A` and `\z`) when a trailing newline must be
rejected.

### Lookaround

Lookahead `(?=...)`, `(?!...)` and lookbehind `(?<=...)`, `(?<!...)` check the
text around the current position without consuming it. They let one pattern
express "followed by" and "preceded by" without putting the context in the match:

```csharp
Console.WriteLine(Regex.Replace("1234567", @"(?<=\d)(?=(\d{3})+$)", ","));   // 1,234,567
Console.WriteLine(Regex.Match("price: $15, cost: 20", @"(?<=\$)\d+").Value); // 15 (the $ is not part of the match)
Console.WriteLine(Regex.IsMatch("password1", @"^(?=.*\d)(?=.*[a-z]).{8,}$")); // True: two independent conditions at one position
```

.NET supports variable-length lookbehind, which many other flavors do not. These
constructs need the backtracking engine (see below).

### Options that change meaning

`IgnoreCase` uses the current culture's casing rules unless you also pass
`CultureInvariant`, which reproduces the Turkish-i problem from string
comparison. `\d` matches any Unicode decimal digit, not just `0-9`, unless you
use `[0-9]` or `RegexOptions.ECMAScript`:

```csharp
CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
Regex.IsMatch("I", "i", RegexOptions.IgnoreCase);                                    // False
Regex.IsMatch("I", "i", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);    // True

string arabic = "١٢٣"; // Arabic-Indic digits
Regex.IsMatch(arabic, @"^\d+$");                              // True
Regex.IsMatch(arabic, @"^[0-9]+$");                           // False
Regex.IsMatch(arabic, @"^\d+$", RegexOptions.ECMAScript);     // False
```

A pattern that validates "a number" with `\d` accepts digits that `int.Parse`
with the invariant culture may refuse, so validate with `[0-9]` when the next
step is parsing. `RegexOptions.ECMAScript` can only be combined with a few other
options and disallows some constructs, so reach for `[0-9]` first.

### Two engines, and what NonBacktracking gives up

The default engine is a backtracking one: it keeps a stack of choices and
returns to them. `RegexOptions.Compiled` makes it emit IL for the pattern;
that changes speed, not meaning. `RegexOptions.NonBacktracking` swaps in an
automata-based engine that never goes back over the input, so matching time
grows with the input length. In exchange, constructs that depend on remembered
state are rejected when the `Regex` is constructed. Real results from .NET 10:

```csharp
new Regex(@"[a-z]+\d+", RegexOptions.NonBacktracking).IsMatch("abc123");  // True
new Regex(@"(?=a)a", RegexOptions.NonBacktracking);   // NotSupportedException: positive lookahead or lookbehind
new Regex(@"(a)\1", RegexOptions.NonBacktracking);    // NotSupportedException: backreference
new Regex(@"(?>a+)b", RegexOptions.NonBacktracking);  // NotSupportedException: atomic subexpression
new Regex("a", RegexOptions.NonBacktracking | RegexOptions.RightToLeft); // ArgumentOutOfRangeException ('options')
new Regex(@"(?<n>\d+)", RegexOptions.NonBacktracking).Match("x42").Groups["n"].Value; // 42, captures work
```

Because the failure is at construction, you find out as soon as the code runs,
not when a rare input arrives.

### Match, EnumerateMatches, Count, and timeouts

`Matches` allocates a `Match` and `Group` objects per hit. When you only need
positions, `Regex.EnumerateMatches` over a `ReadOnlySpan<char>` yields a
`ValueMatch` struct with `Index` and `Length` and allocates nothing per match.
`Count` and `IsMatch` also skip the captures, and `EnumerateSplits` is the same
idea for splitting:

```csharp
ReadOnlySpan<char> input = "a1 b22 c333";
foreach (ValueMatch vm in Regex.EnumerateMatches(input, @"\d+"))
    Console.Write($"[{vm.Index},{vm.Length}:{input.Slice(vm.Index, vm.Length)}] ");
// [1,1:1] [4,2:22] [8,3:333]
```

A match timeout bounds the time one match attempt may take. It is an
argument of the constructor (`new Regex(pattern, options, TimeSpan)`) and of the
static methods; exceeding it throws `RegexMatchTimeoutException`. The default is
`Regex.InfiniteMatchTimeout`, which is `-1 ms`, unless the process sets
`REGEX_DEFAULT_MATCH_TIMEOUT` with `AppDomain.SetData`. A zero or a negative value other than
infinite throws `ArgumentOutOfRangeException`. The next concept shows a
timeout saving a service from a catastrophic pattern.

Static methods such as `Regex.IsMatch(input, pattern)` use a cache of recently
built `Regex` objects whose default `Regex.CacheSize` is 15. A pattern used in a
hot path belongs in a `static readonly Regex` field, or in a generated regex.

## Trade-offs

- **Backtracking is expressive and can be exponential.** Lookaround and
  backreferences come with it. A nested quantifier such as `^(a+)+$` on
  22 `a` characters followed by `!` took about 300 ms on the default engine on
  an Apple M4 Max; for 20 to 24 characters it measured 75, 150, 282, 560, and
  1108 ms, so each added character doubles it.
- **NonBacktracking is linear but narrower.** On that same input and pattern it
  took 4 ms, but lookahead, lookbehind, backreferences, atomic groups, and
  `RightToLeft` are not available. Measure startup on your own pattern before
  you adopt it everywhere.
- **Named groups cost nothing at match time but add pattern noise.** In return,
  `Groups["year"]` keeps working when someone inserts a group before it.
- **`EnumerateMatches` gives positions, not captures.** You lose `Groups`; if you
  need a captured substring, slice the input with the index and length, or fall
  back to `Match`.
  ```csharp
  foreach (ValueMatch vm in Regex.EnumerateMatches(text, @"\d+")) { /* vm.Index, vm.Length only */ }
  ```
- **`Compiled` pays at construction.** It spends startup time emitting IL to
  win throughput on a pattern that runs many times; for a pattern that runs
  rarely, the interpreter is cheaper overall.
- **Timeouts are a safety net, not a fix.** A timeout turns a hang into an
  exception, but the pattern is still wrong. Treat `RegexMatchTimeoutException`
  as a signal to simplify the pattern or switch engine.

## Documentation Links

- [.NET regular expressions overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expressions) (doc)
- [Regular expression options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-options) (doc)
- [Backtracking in .NET regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/backtracking-in-regular-expressions) (doc)
- [Grouping constructs in regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/grouping-constructs-in-regular-expressions) (doc)
- [Best practices for regular expressions in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex) (doc)
- [Regex.EnumerateMatches method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.regex.enumeratematches) (doc)
