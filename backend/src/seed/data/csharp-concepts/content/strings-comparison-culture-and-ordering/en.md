---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Comparing two strings looks like one operation, but .NET has two very different
ones behind it. An ordinal comparison looks at UTF-16 code units and nothing
else: fast, exact, and the same on every machine. A culture-sensitive
comparison asks the globalization library (ICU on Linux and macOS, ICU or NLS on
Windows) how a language wants text ordered, and the answer depends on the
culture, the library version, and even whether the container has ICU at all.
This concept covers when each one is right, how `StringComparison`,
`StringComparer`, and `CompareOptions` map onto them, the .NET 10
`CompareOptions.NumericOrdering` option that sorts "file2" before "file10",
what globalization-invariant mode silently changes, and why strings are
immutable and sometimes interned.

## Use Cases

- Choosing the comparison for dictionary keys, file names, headers, and
  identifiers (ordinal) versus names shown in a sorted list for a person
  (cultural).
- Sorting version-like or numbered labels such as "Windows 8", "Windows 10",
  "file07.txt" the way a human expects.
- Debugging code that works on a laptop and breaks in a Docker image that has no
  ICU or runs with `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`.
- Fixing the Turkish-i bug, where `ToLower()` or a case-insensitive compare
  changes behavior based on the user's locale.

## Deep Dive

### Ordinal versus cultural

`string.Equals(a, b)` and `==` are ordinal. Methods that take no
`StringComparison`, such as `Compare`, `CompareTo`, `StartsWith`, and
`IndexOf(string)`, are culture-sensitive by default, and that inconsistency is
the root of many bugs. The rule of thumb: pass the comparison explicitly.

```csharp
Console.WriteLine(string.Equals("é", "é"));                                   // False (default is ordinal)
Console.WriteLine(string.Equals("é", "é", StringComparison.InvariantCulture)); // True  (e + combining accent == precomposed e-acute)
Console.WriteLine(string.Equals("é", "é", StringComparison.Ordinal));          // False
Console.WriteLine("ab".Equals("a­b", StringComparison.InvariantCulture));            // True  (soft hyphen has zero weight)
Console.WriteLine("ab".IndexOf("­", StringComparison.InvariantCulture));             // 0     (found "nothing" at index 0)
Console.WriteLine("ab".IndexOf("­", StringComparison.Ordinal));                      // -1
```

A linguistic comparison treats canonically equivalent sequences as equal and
ignores zero-weight characters, which is exactly right for human text and
exactly wrong for a security check, a file path, or a cache key. Ordinal
comparison is also the cheapest, since it can compare memory directly.
`OrdinalIgnoreCase` gives case-insensitive matching without any culture lookup
and is the right default for identifiers, file extensions, and HTTP header names.

Sort order shows the other difference. The same six words, sorted three ways
(real output on .NET 10, macOS with ICU):

```csharp
string[] words = ["zebra", "Apple", "apple", "Zebra", "äpple", "Äpple"];
// Ordinal : Apple, Zebra, apple, zebra, Äpple, äpple     (by code unit: uppercase, lowercase, then accents)
// en-US   : apple, Apple, äpple, Äpple, zebra, Zebra     (a-words together, case as a tiebreaker)
// sv-SE   : apple, Apple, zebra, Zebra, äpple, Äpple     (in Swedish, ä is a letter after z)
```

### StringComparison, StringComparer, and CompareOptions

Three types express the same choice at different levels:

- `StringComparison` is the enum you pass to a single call: `Ordinal`,
  `OrdinalIgnoreCase`, `CurrentCulture`, `CurrentCultureIgnoreCase`,
  `InvariantCulture`, `InvariantCultureIgnoreCase`.
- `StringComparer` is an object implementing `IComparer<string>` and
  `IEqualityComparer<string>`. It is what you hand to `Dictionary`, `HashSet`,
  `Order`, and `Sort`. `StringComparer.Ordinal` and `OrdinalIgnoreCase` are
  ready-made; `StringComparer.Create(culture, options)` builds a cultural one.
- `CompareOptions` is the flag set used by `CompareInfo` and `StringComparer.Create`
  to refine a cultural comparison: `IgnoreCase`, `IgnoreNonSpace` (diacritics),
  `IgnoreSymbols`, `IgnoreWidth`, `IgnoreKanaType`, and in .NET 10
  `NumericOrdering`. `Ordinal` and `OrdinalIgnoreCase` are also members, but they
  cannot be combined with the others (the call throws `ArgumentException`).

The Turkish-i problem is what happens when a cultural comparison is used where
an ordinal one was meant:

```csharp
var tr = new CultureInfo("tr-TR");
Console.WriteLine("TITLE".ToLower(tr));         // tıtle  (dotless i)
Console.WriteLine("TITLE".ToLowerInvariant());  // title
```

Use `ToLowerInvariant`/`ToUpperInvariant` or ordinal comparers for protocol
text, and keep culture-aware casing for text a person reads.

### NumericOrdering, new in .NET 10

By default, a cultural compare sorts digit by digit, so "10" comes before "2".
`CompareOptions.NumericOrdering` compares each run of Unicode decimal digits
(category `Nd`) by numeric value. The "What's new in .NET 10 libraries" page
documents it, with `"2"` and `"02"` equal and `"Windows 8"` before `"Windows 10"`.

```csharp
string[] files = ["file10.txt", "file2.txt", "file1.txt", "file07.txt", "file7.txt"];
var numeric = StringComparer.Create(CultureInfo.InvariantCulture, CompareOptions.NumericOrdering);

Console.WriteLine(string.Join(", ", files.Order(StringComparer.InvariantCulture)));
// file07.txt, file1.txt, file10.txt, file2.txt, file7.txt
Console.WriteLine(string.Join(", ", files.Order(numeric)));
// file1.txt, file2.txt, file07.txt, file7.txt, file10.txt

var info = CultureInfo.InvariantCulture.CompareInfo;
Console.WriteLine(info.Compare("7", "10"));                                  // 1
Console.WriteLine(info.Compare("7", "10", CompareOptions.NumericOrdering));  // -1
Console.WriteLine(info.Compare("7", "07", CompareOptions.NumericOrdering));  // 0
Console.WriteLine(info.Compare("1.5", "1.10", CompareOptions.NumericOrdering)); // -1: "5" < "10", the dot ends the number
Console.WriteLine(info.Compare("-5", "-10", CompareOptions.NumericOrdering));   // -1: the minus is not part of the number
```

Notes from running it: because "7" and "07" are equal, the comparer's
`GetHashCode` returns the same value for both, so a `HashSet<string>` built with
it treats them as duplicates. Signs and decimal points are not part of a number,
so this is not a semantic version or decimal sorter ("1.5" sorts before "1.10").
The flag throws `ArgumentException` with `IndexOf`, `IsPrefix` and the other
index-based methods, and with `Ordinal`.

### Invariant globalization mode and ICU in containers

Slim container images often ship without ICU. The runtime then fails at startup
unless you opt in to invariant mode (`DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` or
`<InvariantGlobalization>true</InvariantGlobalization>`). That mode removes the
ICU dependency by replacing linguistic behavior with ordinal behavior. The same
snippet, run with and without it:

```csharp
// ICU                                         // Invariant mode
words.Order(StringComparer.InvariantCulture)   // apple, Apple, äpple, Äpple, zebra, Zebra  |  Apple, Zebra, apple, zebra, Äpple, äpple
Equals("é", "é", InvariantCulture)  // True                                      |  False
cmp.Compare("7", "10", NumericOrdering)        // -1                                        |  6
cmp.Compare("7", "07", NumericOrdering)        // 0                                         |  7
new CultureInfo("tr-TR")                       // works                                     |  CultureNotFoundException
```

Two points stand out. Culture names other than the invariant one throw, because
`PredefinedCulturesOnly` defaults to true in this mode. And `NumericOrdering`
does not fail: it quietly returns the plain character difference (6 is `'7' - '1'`),
so a sorted list is wrong with no exception. If you depend on cultural
behavior, test in the same image you deploy, and prefer explicit ordinal
comparers where culture was never the intent. The docs note that analyzers
CA1307 and CA1309 flag call sites that do not specify a `StringComparison`.

### Immutability and interning

A `string` never changes after creation, which makes it safe to share across
threads and to use as a dictionary key (its hash code is stable). Compile-time
constants are stored once in an intern pool, so identical literals share one
object. A string built at run time is a separate object unless you intern it:

```csharp
string a = "hello", b = "hel" + "lo", c = new string(['h', 'e', 'l', 'l', 'o']);
Console.WriteLine(ReferenceEquals(a, b));                  // True  (folded to one literal at compile time)
Console.WriteLine(ReferenceEquals(a, c));                  // False
Console.WriteLine(ReferenceEquals(a, string.Intern(c)));   // True
```

Rely on `==` or `Equals` for equality, not reference identity. `string.Intern`
is rarely worth it: interned strings live for the life of the process.

## Trade-offs

- **Ordinal is fast and predictable, but not linguistic.** It will sort "Zebra"
  before "apple" and treat "é" and "é" as different strings. For user-facing sorted
  lists, use a culture (`StringComparer.Create(culture, CompareOptions.None)`).
- **Cultural comparison depends on the environment.** ICU versions and CLDR data
  change ordering rules between releases and between machines, so persisted
  sort order or cultural-compare results used as a key can shift after an OS or
  image update.
- **`NumericOrdering` fixes "file10" but not "version 1.10".** Digits are
  compared as whole numbers, but dots and signs end the run, so "1.5" sorts
  before "1.10" only because 5 < 10, and "-5" still sorts before "-10",
  the opposite of numeric order. For versions use `Version.Parse`, for numbers parse them.
- **`NumericOrdering` makes "7" equal to "07".** That is a feature for sorting
  but a hazard in a dictionary: `new Dictionary<string, T>(numeric)` merges keys
  that differ as text.
- **Invariant mode trades correctness for portability.** The app starts without
  ICU and the image is smaller, but cultural compares become ordinal, `new
  CultureInfo("tr-TR")` throws, and `NumericOrdering` returns wrong answers
  without throwing.
- **Interning saves memory only for repeated strings.** `string.Intern` on
  user input grows a pool that is never freed; a local `Dictionary<string,string>`
  as a deduplicating cache can be released.

## Documentation Links

- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
- [CompareOptions enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.compareoptions) (doc)
- [What's new in .NET libraries for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [.NET globalization and ICU, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) (doc)
- [StringComparer class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.stringcomparer) (doc)
- [.NET globalization invariant mode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
