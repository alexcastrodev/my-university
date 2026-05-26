# Formatting Values

> Java provides several APIs for converting numbers, dates, and other values into human-readable strings — `String.format`, `NumberFormat`, and `DateTimeFormatter`. Each has its own syntax and use cases that the OCP exam tests directly.

---

## String.format and formatted()

`String.format(String format, Object... args)` returns a formatted string using *format specifiers* as placeholders. In Java 15+, the instance method `formatted()` on `String` does the same thing:

```java
String s1 = String.format("Hello, %s! You are %d years old.", "Alice", 30);
String s2 = "Hello, %s! You are %d years old.".formatted("Alice", 30);
// Both produce: "Hello, Alice! You are 30 years old."
```

`System.out.printf` uses the same format string syntax but writes directly to stdout instead of returning a `String`.

---

## Format Specifiers

| Specifier | Type | Example | Output |
|---|---|---|---|
| `%s` | String (or any object via `toString`) | `"%s".formatted("hello")` | `hello` |
| `%d` | Integer (`int`, `long`) | `"%d".formatted(42)` | `42` |
| `%f` | Floating-point | `"%f".formatted(3.14)` | `3.140000` |
| `%.2f` | Float with 2 decimal places | `"%.2f".formatted(3.14159)` | `3.14` |
| `%n` | Platform line separator | `"line1%nline2"` | `line1\nline2` |
| `%b` | Boolean | `"%b".formatted(null)` | `false` |
| `%c` | Character | `"%c".formatted('A')` | `A` |

```java
double price = 19.99;
int qty = 3;
String line = String.format("%-20s %5.2f x %d = %7.2f",
        "Widget", price, qty, price * qty);
// "Widget               19.99 x 3 =   59.97"
```

Width and flags:
- `%10d` — right-align in field of width 10.
- `%-10d` — left-align in field of width 10.
- `%05d` — zero-pad to width 5.

---

## NumberFormat

`java.text.NumberFormat` provides locale-aware formatting for numbers, currencies, and percentages. You obtain instances through factory methods — the constructor is not public.

```java
import java.text.NumberFormat;
import java.util.Locale;

double value = 1234567.89;

NumberFormat nf  = NumberFormat.getNumberInstance();
NumberFormat curr = NumberFormat.getCurrencyInstance(Locale.US);
NumberFormat pct  = NumberFormat.getPercentInstance();

System.out.println(nf.format(value));      // 1,234,567.89  (default locale)
System.out.println(curr.format(value));    // $1,234,567.89
System.out.println(pct.format(0.856));     // 86%
```

**Parsing** a formatted number back to a `Number`:

```java
NumberFormat nf = NumberFormat.getNumberInstance(Locale.US);
Number parsed = nf.parse("1,234.56");
double d = parsed.doubleValue();   // 1234.56
```

> `parse()` throws the checked `ParseException` if the string cannot be parsed.

---

## DateTimeFormatter

`java.time.format.DateTimeFormatter` formats and parses `LocalDate`, `LocalTime`, `LocalDateTime`, and `ZonedDateTime`. It is immutable and thread-safe.

### Predefined Formatters

```java
import java.time.*;
import java.time.format.*;

LocalDate date = LocalDate.of(2024, 3, 15);
System.out.println(date.format(DateTimeFormatter.ISO_LOCAL_DATE));   // 2024-03-15
System.out.println(date.format(DateTimeFormatter.BASIC_ISO_DATE));   // 20240315
```

### Custom Patterns

```java
DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MM/dd/yyyy");
LocalDate d = LocalDate.of(2024, 3, 15);
System.out.println(d.format(fmt));   // 03/15/2024

LocalDate parsed = LocalDate.parse("03/15/2024", fmt);
System.out.println(parsed);          // 2024-03-15
```

Common pattern symbols:

| Symbol | Meaning | Example |
|---|---|---|
| `yyyy` | 4-digit year | `2024` |
| `MM` | 2-digit month | `03` |
| `dd` | 2-digit day | `15` |
| `HH` | Hour (00–23) | `14` |
| `mm` | Minutes | `05` |
| `ss` | Seconds | `30` |
| `a` | AM/PM | `PM` |

### Locale-Sensitive Formatting

```java
DateTimeFormatter fmt = DateTimeFormatter
        .ofLocalizedDate(FormatStyle.LONG)
        .withLocale(Locale.FRANCE);

LocalDate date = LocalDate.of(2024, 3, 15);
System.out.println(date.format(fmt));   // 15 mars 2024
```

`FormatStyle` options: `FULL`, `LONG`, `MEDIUM`, `SHORT`.

---

## Key Rules Summary

- `%s` works for any object; `%d` is for integers; `%f` for floats; `%n` for a newline; `%b` returns `false` for `null`.
- `String.format` and `formatted()` produce the same result — `formatted()` is the more modern instance-method form.
- `NumberFormat` instances are created via factory methods (`getNumberInstance`, `getCurrencyInstance`, `getPercentInstance`); pass a `Locale` for locale-aware output.
- `DateTimeFormatter` is immutable and thread-safe; use `ofPattern()` for custom patterns and `ofLocalizedDate/Time/DateTime()` for locale-aware patterns.
- Parsing with `NumberFormat.parse()` throws checked `ParseException`; parsing with `DateTimeFormatter` throws unchecked `DateTimeParseException`.

---

## References

- [Oracle Docs — java.util.Formatter](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Formatter.html)
- [Oracle Docs — NumberFormat](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/text/NumberFormat.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
