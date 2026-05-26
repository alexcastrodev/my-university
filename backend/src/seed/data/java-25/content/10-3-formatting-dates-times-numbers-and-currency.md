---
version: 1.0
updatedAt: 2026-05-26
---
# Formatting Dates, Times, Numbers, and Currency

---

## Overview

Java provides dedicated classes for locale-aware formatting and parsing of dates, times, numbers, and currencies:

| Class | Package | Purpose |
|-------|---------|---------|
| `DateTimeFormatter` | `java.time.format` | Format and parse `LocalDate`, `LocalTime`, `LocalDateTime`, `ZonedDateTime` |
| `NumberFormat` | `java.text` | Locale-aware number, currency, and percentage formatting |
| `DecimalFormat` | `java.text` | Custom numeric patterns (e.g., `#,##0.00`) |
| `Currency` | `java.util` | Currency metadata (symbol, code, fraction digits) |

---

## DateTimeFormatter

`DateTimeFormatter` is immutable and thread-safe. It can both format (date → string) and parse (string → date).

### Predefined Formatters

```java
DateTimeFormatter.ISO_LOCAL_DATE        // "2025-06-15"
DateTimeFormatter.ISO_LOCAL_DATE_TIME   // "2025-06-15T10:30:00"
DateTimeFormatter.ISO_ZONED_DATE_TIME   // "2025-06-15T10:30:00+01:00[Europe/London]"
```

### Pattern-Based Formatter

```java
DateTimeFormatter fmt = DateTimeFormatter.ofPattern("dd/MM/yyyy");
LocalDate date = LocalDate.of(2025, 6, 15);

String formatted = date.format(fmt);          // "15/06/2025"
LocalDate parsed = LocalDate.parse("15/06/2025", fmt);  // LocalDate
```

Common pattern letters:

| Symbol | Meaning | Example |
|--------|---------|---------|
| `yyyy` | Year (4 digits) | `2025` |
| `yy` | Year (2 digits) | `25` |
| `MM` | Month (2 digits) | `06` |
| `MMM` | Month abbreviation | `Jun` |
| `MMMM` | Month full name | `June` |
| `dd` | Day of month | `15` |
| `HH` | Hour (0–23) | `10` |
| `hh` | Hour (1–12) | `10` |
| `mm` | Minutes | `30` |
| `ss` | Seconds | `00` |
| `a` | AM/PM marker | `PM` |
| `z` | Time-zone name | `EDT` |
| `Z` | Zone offset | `-0400` |

```java
DateTimeFormatter dtFmt = DateTimeFormatter.ofPattern("MMMM dd, yyyy 'at' HH:mm");
LocalDateTime ldt = LocalDateTime.of(2025, 6, 15, 10, 30);

ldt.format(dtFmt);  // "June 15, 2025 at 10:30"
```

### Locale-Aware Pattern Formatter

Pass a locale to `ofPattern()` to control locale-specific elements (month names, AM/PM text):

```java
DateTimeFormatter fmtFR = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.FRANCE);
LocalDate.of(2025, 6, 15).format(fmtFR);  // "juin 15, 2025"
```

### Localized Formatters — ofLocalizedDate() and ofLocalizedDateTime()

`FormatStyle` controls the verbosity of a localized format:

| FormatStyle | Date example (en_US) |
|-------------|----------------------|
| `SHORT` | `6/15/25` |
| `MEDIUM` | `Jun 15, 2025` |
| `LONG` | `June 15, 2025` |
| `FULL` | `Sunday, June 15, 2025` |

```java
DateTimeFormatter shortFmt = DateTimeFormatter
    .ofLocalizedDate(FormatStyle.SHORT)
    .withLocale(Locale.US);

DateTimeFormatter fullFmt = DateTimeFormatter
    .ofLocalizedDate(FormatStyle.FULL)
    .withLocale(Locale.FRANCE);

LocalDate d = LocalDate.of(2025, 6, 15);
d.format(shortFmt);  // "6/15/25"
d.format(fullFmt);   // "dimanche 15 juin 2025"
```

For date-time formatting, use `ofLocalizedDateTime(dateStyle, timeStyle)`:

```java
DateTimeFormatter dtFmt = DateTimeFormatter
    .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    .withLocale(Locale.US);

LocalDateTime.of(2025, 6, 15, 10, 30).format(dtFmt);
// "Jun 15, 2025, 10:30 AM"
```

### Parsing with DateTimeFormatter

```java
DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

LocalDateTime ldt = LocalDateTime.parse("2025-06-15 10:30", fmt);
LocalDate ld      = LocalDate.parse("2025-06-15");   // ISO format, no formatter needed
```

> **Exam tip:** `LocalDate.parse()` and `LocalDateTime.parse()` without a formatter use `ISO_LOCAL_DATE` and `ISO_LOCAL_DATE_TIME` respectively. A formatter must be provided if the string uses a different pattern.

---

## NumberFormat

`NumberFormat` is the base class for locale-aware formatting of numbers, currencies, and percentages. Obtain instances via factory methods — do not construct directly.

### Factory Methods

```java
NumberFormat nf   = NumberFormat.getInstance(Locale.US);            // general number
NumberFormat curr = NumberFormat.getCurrencyInstance(Locale.US);    // currency
NumberFormat pct  = NumberFormat.getPercentInstance(Locale.US);     // percentage
NumberFormat intF = NumberFormat.getIntegerInstance(Locale.US);     // integer (truncates)
```

### Formatting Numbers

```java
NumberFormat nf = NumberFormat.getInstance(Locale.US);
nf.format(1234567.89);   // "1,234,567.89"

NumberFormat nfDE = NumberFormat.getInstance(Locale.GERMANY);
nfDE.format(1234567.89); // "1.234.567,89"  (German uses . for grouping, , for decimal)
```

### Currency Formatting

```java
NumberFormat curr = NumberFormat.getCurrencyInstance(Locale.US);
curr.format(1234.5);     // "$1,234.50"

NumberFormat currFR = NumberFormat.getCurrencyInstance(Locale.FRANCE);
currFR.format(1234.5);   // "1 234,50 €"
```

### Percentage Formatting

```java
NumberFormat pct = NumberFormat.getPercentInstance(Locale.US);
pct.format(0.75);   // "75%"
pct.format(1.5);    // "150%"
```

### Integer Formatting

```java
NumberFormat intF = NumberFormat.getIntegerInstance(Locale.US);
intF.format(1234.9);  // "1,235"  (rounds to nearest integer)
```

### Controlling Fraction Digits

```java
NumberFormat nf = NumberFormat.getInstance(Locale.US);
nf.setMinimumFractionDigits(2);
nf.setMaximumFractionDigits(4);

nf.format(3.1);      // "3.10"
nf.format(3.14159);  // "3.1416"
```

### Parsing with NumberFormat

```java
NumberFormat nf = NumberFormat.getInstance(Locale.US);
Number n = nf.parse("1,234.56");   // 1234.56 as a Double
double d = n.doubleValue();

NumberFormat curr = NumberFormat.getCurrencyInstance(Locale.US);
Number amount = curr.parse("$1,234.50");  // 1234.5
```

> **Exam tip:** `NumberFormat.parse()` throws the checked `ParseException`. The return type is `Number`, not `double` — call `doubleValue()` or `intValue()` on the result.

---

## DecimalFormat

`DecimalFormat` applies a custom pattern to numeric values. It is a subclass of `NumberFormat`.

### Pattern Characters

| Symbol | Meaning |
|--------|---------|
| `0` | Required digit (shows `0` if absent) |
| `#` | Optional digit (suppressed if absent) |
| `.` | Decimal separator position |
| `,` | Grouping separator |
| `%` | Multiply by 100 and show as percentage |
| `E` | Scientific notation |
| `'` | Escape literal text |

```java
DecimalFormat df = new DecimalFormat("#,##0.00");
df.format(1234.5);    // "1,234.50"
df.format(0.5);       // "0.50"
df.format(1234567);   // "1,234,567.00"

DecimalFormat pct = new DecimalFormat("#0.0%");
pct.format(0.756);    // "75.6%"

DecimalFormat sci = new DecimalFormat("0.###E0");
sci.format(123456);   // "1.235E5"
```

### Locale-Aware DecimalFormat

By default, `DecimalFormat` uses the JVM default locale's decimal and grouping symbols. To use a specific locale, obtain the symbols explicitly:

```java
DecimalFormatSymbols symbols = DecimalFormatSymbols.getInstance(Locale.GERMANY);
DecimalFormat df = new DecimalFormat("#,##0.00", symbols);
df.format(1234.5);   // "1.234,50"
```

---

## Currency

`Currency` holds ISO 4217 currency metadata. It does not perform formatting — use `NumberFormat.getCurrencyInstance()` for that.

```java
Currency eur = Currency.getInstance("EUR");
Currency usd = Currency.getInstance("USD");
Currency jpy = Currency.getInstance("JPY");

eur.getCurrencyCode();           // "EUR"
eur.getSymbol();                 // "€"  (in default locale)
eur.getSymbol(Locale.US);        // "EUR"  (symbol in a given locale)
eur.getSymbol(Locale.FRANCE);    // "€"
eur.getDisplayName();            // "Euro"
eur.getDefaultFractionDigits();  // 2

jpy.getDefaultFractionDigits();  // 0  (Japanese Yen has no subunit)
```

### Currency from Locale

```java
Currency localCurrency = Currency.getInstance(Locale.US);   // USD
```

> **Exam tip:** `Currency.getInstance(String)` takes an ISO 4217 currency code (uppercase, 3 letters). `Currency.getInstance(Locale)` takes a locale and derives the currency from the country. `getSymbol()` returns the locale-sensitive symbol, not always `€` or `$` — it depends on the display locale.

---

## Key Points for the Exam

- `DateTimeFormatter.ofPattern()` defines a custom format; letters are case-sensitive (`MM` = month, `mm` = minutes).
- `ofLocalizedDate(FormatStyle)` + `withLocale(locale)` produces a locale-aware formatter without a hardcoded pattern.
- `LocalDate.parse(string, formatter)` and `date.format(formatter)` are symmetric operations.
- `NumberFormat` factory methods: `getInstance`, `getCurrencyInstance`, `getPercentInstance`, `getIntegerInstance` — all accept an optional `Locale`.
- `NumberFormat.parse()` returns `Number`, throws checked `ParseException`.
- `DecimalFormat` pattern: `0` is a required digit, `#` is optional; `#,##0.00` is a common currency-like pattern.
- `Currency.getInstance("EUR")` retrieves metadata; use `getCurrencyInstance(locale)` on `NumberFormat` for actual formatting.

## References

- [Oracle Docs — DateTimeFormatter (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html)
- [Oracle Docs — NumberFormat (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/NumberFormat.html)
- [Oracle Docs — DecimalFormat (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/DecimalFormat.html)
- [Oracle Docs — Currency (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Currency.html)
