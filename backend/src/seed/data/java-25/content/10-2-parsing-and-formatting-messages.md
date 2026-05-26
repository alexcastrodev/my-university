# Parsing and Formatting Messages

---

## Overview

Java provides several APIs for constructing messages with dynamic values, locale-aware number formatting, and compact number representation:

| Class | Package | Purpose |
|-------|---------|---------|
| `MessageFormat` | `java.text` | Inserts arguments into a pattern using positional placeholders |
| `String.format()` / `formatted()` | `java.lang` | `printf`-style formatting with optional locale |
| `ChoiceFormat` | `java.text` | Selects a message based on a numeric range |
| `NumberFormat` (compact) | `java.text` | Abbreviated number display (Java 12+) |

---

## MessageFormat

`MessageFormat` inserts values into a pattern string using numbered placeholders `{0}`, `{1}`, etc.

### Basic Usage

```java
String pattern = "Hello, {0}! You have {1} messages.";
String result  = MessageFormat.format(pattern, "Alice", 5);
// "Hello, Alice! You have 5 messages."
```

Arguments are numbered from `0`. Their `toString()` representation is used by default.

### Format Types

Placeholders can include a format type and subformat:

```
{argIndex}
{argIndex, formatType}
{argIndex, formatType, formatStyle}
```

| Format type | Example | Output (en_US) |
|-------------|---------|----------------|
| `number` | `{0,number}` | `1,234` |
| `number,integer` | `{0,number,integer}` | `1,234` |
| `number,currency` | `{0,number,currency}` | `$1,234.00` |
| `number,percent` | `{0,number,percent}` | `123,400%` |
| `number,#,##0.00` | `{0,number,#,##0.00}` | `1,234.00` |
| `date` | `{0,date}` | `Jan 1, 2025` |
| `date,short` | `{0,date,short}` | `1/1/25` |
| `date,long` | `{0,date,long}` | `January 1, 2025` |
| `time` | `{0,time}` | `12:00:00 PM` |
| `choice` | `{0,choice,0#none\|1#one\|1<many}` | depends on value |

```java
Date date   = new Date();
double amt  = 1234.5;

MessageFormat.format("Amount: {0,number,currency}", amt);
// "Amount: $1,234.50"  (depends on default locale)

MessageFormat.format("Date: {0,date,long}", date);
// "Date: January 1, 2025"
```

### Using MessageFormat with a Locale

```java
MessageFormat mf = new MessageFormat("{0,number,currency}", Locale.FRANCE);
String result = mf.format(new Object[]{ 1234.5 });
// "1 234,50 €"
```

> **Exam tip:** `MessageFormat.format()` is a static convenience method that uses the default locale. For a specific locale, construct a `MessageFormat` instance with the desired locale.

### Escaping Braces

Literal curly braces must be escaped with single quotes:

```java
MessageFormat.format("'{'0'}' = {0}", 42);  // "{0} = 42"
```

---

## String.format() and formatted()

`String.format()` uses `printf`-style format specifiers. Common specifiers:

| Specifier | Type | Example |
|-----------|------|---------|
| `%s` | String | `"hello"` |
| `%d` | Integer | `42` |
| `%f` | Floating-point | `3.140000` |
| `%.2f` | Float, 2 decimals | `3.14` |
| `%n` | Platform newline | — |
| `%b` | Boolean | `true` |
| `%c` | Character | `'A'` |
| `%10s` | Right-aligned in 10 chars | `"     hello"` |
| `%-10s` | Left-aligned in 10 chars | `"hello     "` |

```java
String s = String.format("Name: %s, Age: %d", "Alice", 30);
// "Name: Alice, Age: 30"

String price = String.format("%.2f", 3.14159);
// "3.14"

// Instance method — equivalent to String.format(this, args)
String t = "Price: %.2f".formatted(9.99);
// "Price: 9.99"
```

### Locale-Aware Formatting

```java
String frenchPrice = String.format(Locale.FRANCE, "%.2f", 1234.5);
// "1234,50"  (comma as decimal separator in French locale)
```

> **Exam tip:** `String.format()` uses the default locale unless a `Locale` is passed as the first argument. `formatted()` always uses the default locale — it does not accept a locale parameter.

---

## ChoiceFormat

`ChoiceFormat` selects a string based on a numeric value, enabling pluralization without conditionals.

```java
double[] limits  = { 0, 1, 2 };
String[] formats = { "no files", "one file", "{0} files" };

ChoiceFormat cf = new ChoiceFormat(limits, formats);
cf.format(0);   // "no files"
cf.format(1);   // "one file"
cf.format(5);   // "5 files"  — wait: ChoiceFormat.format() returns the pattern string only
```

`ChoiceFormat` is typically embedded inside a `MessageFormat` pattern using the `choice` format type:

```java
String pattern = "There {0,choice,0#are no files|1#is one file|1<are {0} files}.";
MessageFormat.format(pattern, 0);   // "There are no files."
MessageFormat.format(pattern, 1);   // "There is one file."
MessageFormat.format(pattern, 3);   // "There are 3 files."
```

Pattern syntax: `limit#text` for exact match (`==`), `limit<text` for greater-than (`>`).

---

## CompactNumberFormat (Java 12+)

`CompactNumberFormat` abbreviates large numbers into short, human-readable forms. Obtained via `NumberFormat.getCompactNumberInstance()`.

```java
NumberFormat compact = NumberFormat.getCompactNumberInstance(
    Locale.US, NumberFormat.Style.SHORT);

compact.format(1_000);         // "1K"
compact.format(1_500);         // "2K"   (rounds)
compact.format(1_000_000);     // "1M"
compact.format(2_500_000);     // "3M"
compact.format(1_000_000_000); // "1B"
```

```java
NumberFormat longCompact = NumberFormat.getCompactNumberInstance(
    Locale.US, NumberFormat.Style.LONG);

longCompact.format(1_000);     // "1 thousand"
longCompact.format(1_000_000); // "1 million"
```

### Controlling Fraction Digits

```java
NumberFormat compact = NumberFormat.getCompactNumberInstance(
    Locale.US, NumberFormat.Style.SHORT);
compact.setMinimumFractionDigits(1);

compact.format(1_500);  // "1.5K"
compact.format(1_000);  // "1.0K"
```

> **Exam tip:** `CompactNumberFormat` is available from Java 12. `NumberFormat.Style.SHORT` and `NumberFormat.Style.LONG` are the two style options. The style and locale together determine the abbreviation text.

---

## Key Points for the Exam

- `MessageFormat.format(pattern, args...)` inserts args at `{0}`, `{1}`, ... positions using the default locale.
- Placeholder format: `{index}`, `{index,type}`, or `{index,type,style}`.
- `String.format(Locale, pattern, args...)` is locale-aware; `"...".formatted(args...)` always uses the default locale.
- `ChoiceFormat` selects a string from ranges; `#` means `>=`, `<` means `>`.
- `NumberFormat.getCompactNumberInstance(locale, Style.SHORT)` requires Java 12+.
- Compact format rounds by default; use `setMinimumFractionDigits()` to show decimals.

## References

- [Oracle Docs — MessageFormat (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/MessageFormat.html)
- [Oracle Docs — ChoiceFormat (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/ChoiceFormat.html)
- [Oracle Docs — NumberFormat (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/NumberFormat.html)
