---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

`String.format`, `printf`, and `Formatter` all funnel through the same conversion engine: a format string made of literal characters plus `%`-prefixed specifiers, each specifier consuming one argument in order and rendering it according to a conversion character (`%d`, `%s`, `%f`, ...) plus optional flags for width, precision, padding, and grouping. Most of this is discoverable by example, but a handful of specifics — argument indexing, the comma/space/`(`/`0` flags, and the difference between width and precision — are genuinely easy to get wrong or forget, and are exactly the parts worth having a clear reference for.

## Use Cases

- Producing aligned, human-readable console/log output — right- or left-justified columns of numbers, consistent decimal places, grouped thousands.
- Formatting currency or measurement output with explicit sign display (`+100` vs. `100`) or accounting-style negative numbers (`(100)` instead of `-100`).
- Reusing the same argument in multiple places in one format string (a date formatted as day, then month, then year, all from one `Calendar`/`TemporalAccessor` argument) without repeating it in the call.
- Building an internal `Formatter` explicitly (rather than through `String.format`) when the output needs to accumulate into a specific `Appendable`, or be written straight to a file via one of `Formatter`'s file-backed constructors.

## Deep Dive

### The three ways to reach the same engine

```java
String s = String.format("%s scored %d%%", "Ana", 92);   // one-shot, returns a String
System.out.printf("%s scored %d%%%n", "Ana", 92);         // writes straight to System.out

Formatter fmt = new Formatter();                            // explicit Formatter, own buffer
fmt.format("%s scored %d%%", "Ana", 92);
String result = fmt.toString();
fmt.close();
```

`printf` (on `PrintStream`/`PrintWriter`) and `String.format` are both thin wrappers over `Formatter` — reach for the explicit form only when you need control `String.format` doesn't give you: writing directly to a file via one of `Formatter`'s file-backed constructors, or accumulating into an existing `Appendable`/`StringBuilder` across multiple `format()` calls.

### Conversions: one character decides the shape

```java
String.format("%d", 42);        // 42            — integer, decimal
String.format("%f", 3.14159);   // 3.141590      — floating-point, 6 decimals by default
String.format("%e", 12345.6);   // 1.234560e+04  — scientific notation
String.format("%x", 250);       // fa            — hexadecimal
String.format("%X", 250);       // FA            — uppercase variant
String.format("%o", 250);       // 372           — octal
String.format("%s", "hi");      // hi            — any object, via toString()
String.format("%c", 'z');       // z             — a single character
```

Java **type-checks** each argument against its specifier — `%d` on a `double` argument throws `IllegalFormatConversionException` rather than silently coercing, unlike C's `printf`, which trusts the format string and reads memory according to it regardless of what was actually passed.

### Width, precision, and the difference between them

```java
String.format("[%10.4f]", 10.12345);   // [   10.1235]  — width 10, 4 decimal places
String.format("[%-10.4f]", 10.12345);  // [10.1235   ]  — left-justified in the same field
String.format("[%5.7s]", "hi");         // [   hi]       — width 5 (padded), max length 7
```

**Width** is the minimum total field length (padded with spaces, or `0`s if the `0` flag is used); **precision** means something different per conversion — decimal places for `%f`/`%e`, significant digits for `%g`, and *maximum* string length for `%s` (truncating, not padding, if the string is longer). The two numbers sit in the same `%width.precision` position but answer different questions, which is the part most easily misremembered.

### The flags that carry real weight

```java
String.format("%+d", 100);        // +100      — always show the sign
String.format("% d", 100);        // " 100"    — leading space for positive, aligns with "-100"
String.format("%(d", -100);       // (100)     — accounting-style negative, no minus sign
String.format("%05d", 42);        // 00042     — zero-padded instead of space-padded
String.format("%,.2f", 4356783497.34);  // 4,356,783,497.34   — grouping separator
String.format("%#x", 250);        // 0xfa      — # prefixes hex with 0x, octal with a leading 0
```

`,` (grouping), `+`/space (sign display), `(` (parenthesized negatives), and `0` (zero-padding) are the flags worth having memorized — most everyday formatting needs some combination of these rather than the bare conversion character alone.

### Argument index and relative index: reuse without repeating

```java
String.format("%3$d %1$d %2$d", 10, 20, 30);   // "30 10 20" — explicit n$ index, 1-based
String.format("%d in hex is %1$x", 255);        // "255 in hex is ff" — reuse argument 1
String.format("%d in hex is %<x", 255);         // same result — "<" reuses the PREVIOUS argument
```

An explicit `n$` right after the `%` overrides left-to-right matching entirely; `<` is shorthand for "the argument the previous specifier just used." This is most valuable formatting the same value multiple ways in one call — a `%t`-based date/time format that needs day, month, and year all pulled from one `Calendar`/`TemporalAccessor` argument is the canonical case: `%<` lets that one argument be passed once and referenced repeatedly, instead of appearing three times in the argument list.

### `%n` vs. `\n`

```java
System.out.printf("line one%nline two%n");
```

`%n` inserts the platform's own line separator (`\r\n` on Windows, `\n` elsewhere) the same way `System.lineSeparator()` does; a literal `\n` in the format string always inserts exactly `\n` regardless of platform. `%n` is the portable choice specifically inside a format string; `%%` is the matching escape for a literal `%` character, since a bare `%` in a format string is otherwise parsed as the start of a specifier.

## Trade-offs

- **`Formatter` type-checks strictly, which surfaces bugs early but breaks on any mismatch** — passing an `Integer` where `%f` expects a floating type throws immediately rather than silently misformatting, which is safer than C's `printf` but means a format string and its argument list must stay in exact sync as code evolves; a refactor that changes an argument's type without updating the specifier fails at run time, not compile time.
- **Locale matters and is easy to forget.** `%,d`'s grouping character, decimal points, and date/time formatting all depend on the active locale — `Formatter`'s no-locale constructor uses the JVM default, which differs across environments; an explicit `Locale` argument (`String.format(Locale.US, "%,.2f", amount)`) is the only way to guarantee identical output regardless of where the code runs. See `resource-bundles-and-locale` for the full locale-resolution picture.
- **Width/precision on `%s` truncates strings silently** — a display string longer than the specified precision loses its tail with no indication in the output that truncation happened, which is fine for a fixed-width report column and a real bug source if the full string mattered.
- **An explicitly constructed `Formatter` holds a resource and should be closed** (it implements `AutoCloseable`) — especially when file-backed, where an unclosed `Formatter` can leave buffered output unflushed; `String.format`/`printf` never expose this concern because they manage their own internal `Formatter` for you.
- **Relative indexing (`%<`) only reuses the *immediately preceding* specifier's argument** — it isn't a general "go back N arguments" mechanism, so reordering specifiers in a format string can silently change which argument `%<` now refers to; an explicit `n$` index is the more robust choice once a format string gets complex enough that reordering is likely.
- **An explicit `Formatter` is not thread-safe.** It buffers its output in internal mutable state, so sharing one instance across threads (e.g. caching it in a `static` field to "save resources") corrupts output under concurrent calls. `String.format`/`printf` never hit this because each call constructs its own private `Formatter` internally.
  ```java
  static final Formatter shared = new Formatter(); // unsafe: concurrent format() calls race on the buffer

  // safe alternative: no shared state to race on
  String s = String.format("%s scored %d%%", name, score);
  ```

## Documentation Links

- [Formatter — Java SE 25 API (full conversion and flag reference)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Formatter.html) — doc
- [String.format — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#format(java.lang.String,java.lang.Object...)) — doc
- [PrintStream.printf — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/PrintStream.html#printf(java.lang.String,java.lang.Object...)) — doc
