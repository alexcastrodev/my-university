# Practice: Localization

> Five exercises covering what this module's slides introduced — `Locale`
> construction and case normalization, `MessageFormat` quote-escaping
> combined with `ChoiceFormat` boundary semantics, locale-aware
> `DecimalFormat` symbols, the difference between `ofPattern(pattern,
> locale)` and `ofLocalizedDate(...).withLocale(...)`, and how `Currency`
> metadata drives `NumberFormat` currency-instance rounding. Every example
> pins an explicit `Locale` so the output is unambiguous — try to answer
> before opening each explanation.

---

## Exercise 1 — `Locale.of()` and case normalization

```java
import java.util.Locale;

public class Demo {
    public static void main(String[] args) {
        Locale loc = Locale.of("EN", "gb");

        System.out.println(loc.getLanguage());
        System.out.println(loc.getCountry());
        System.out.println(loc);
        System.out.println(loc.toLanguageTag());
    }
}
```

What is printed on each of the four lines?

<details>
<summary>Answer</summary>

```
en
GB
en_GB
en-GB
```

`Locale.of("EN", "gb")` compiles and runs fine even though the casing of
the arguments is "wrong" — `Locale` **canonicalizes** its language and
country subtags regardless of how they were passed in. The first argument
(language) is always normalized to lowercase, and the second argument
(country) is always normalized to uppercase, matching the ISO 639-1 /
ISO 3166-1 conventions described in the slide (`Locale.of("pt", "PT")` —
lowercase language, uppercase country). So `"EN"` becomes `"en"` and
`"gb"` becomes `"GB"` internally — `getLanguage()` and `getCountry()`
reflect the canonical form, not the literal strings passed to `of()`.

The last two lines show the two different textual representations the
slide covers:

- `toString()` joins the normalized subtags with an **underscore**:
  `"en_GB"` (the same shape as `Locale.FRANCE.toString()` → `"fr_FR"`).
- `toLanguageTag()` produces the **IETF BCP 47** form, which uses a
  **hyphen** instead: `"en-GB"` (matching the slide's `locale.toLanguageTag()
  // "fr-FR"` example).

Both strings describe the same `Locale` — the difference is purely
formatting convention (Java's internal `toString()` vs. the BCP 47 tag
format used by web/HTTP standards), not a difference in the locale
itself.

</details>

---

## Exercise 2 — `MessageFormat`: escaped quotes and `ChoiceFormat` boundaries

```java
import java.text.MessageFormat;
import java.util.Locale;

public class Demo {
    public static void main(String[] args) {
        MessageFormat mf = new MessageFormat(
            "It''s {0,choice,0#freezing|0<mild|20<hot} outside ({0} degrees).",
            Locale.US);

        System.out.println(mf.format(new Object[]{15}));
        System.out.println(mf.format(new Object[]{0}));
        System.out.println(mf.format(new Object[]{20}));
        System.out.println(mf.format(new Object[]{25}));
    }
}
```

What is printed for each of the four calls?

<details>
<summary>Answer</summary>

```
It's mild outside (15 degrees).
It's freezing outside (0 degrees).
It's mild outside (20 degrees).
It's hot outside (25 degrees).
```

Two separate rules from the slides combine here.

**1. Doubled single quotes escape a literal apostrophe.** The slide shows
that literal curly braces must be escaped with single quotes
(`'{'0'}'`). The same quoting mechanism applies to the apostrophe
character itself: inside a `MessageFormat` pattern, a single quote starts
a quoted (literal) section, so to get one literal `'` character in the
output you must write it as **two** single quotes, `''`. That is why the
pattern text `"It''s"` — not `"It's"` — is required, and it produces the
plain string `It's` in the output, with the `{0,choice,...}` placeholder
substituted right after it.

**2. `ChoiceFormat` limit semantics: `#` is exact/`>=`, `<` is strictly
`>`.** The embedded choice pattern `0#freezing|0<mild|20<hot` defines
three ranges:
- `0#freezing` — applies when the value is `>= 0` (up to, but not
  including, wherever the next limit begins)
- `0<mild` — applies when the value is strictly `> 0`
- `20<hot` — applies when the value is strictly `> 20`

So `format(0)` lands exactly on the `0#` boundary → `"freezing"`.
`format(15)` is `> 0` and not yet `> 20` → `"mild"`. Critically,
`format(20)` is **not** `> 20` — it's exactly `20` — so it still falls in
the `0<mild` range and prints `"mild"`, not `"hot"`. Only a value
strictly greater than `20`, like `25`, crosses into the `20<hot` range.
This is exactly the distinction the slide draws between `#` (`==`
comparison, or more precisely "at least this limit") and `<` (`>`
comparison) in `ChoiceFormat` pattern syntax.

Note the pattern was compiled into a `MessageFormat` with an explicit
`Locale.US` (per the slide's "Using `MessageFormat` with a Locale"
example) rather than relying on `MessageFormat.format(...)`'s
default-locale static overload — although here it makes no visible
difference since `{0}` is a plain, sub-1000 integer with no grouping or
decimal separator to render differently across locales.

</details>

---

## Exercise 3 — Locale-aware `DecimalFormat` with explicit symbols

```java
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

public class Demo {
    public static void main(String[] args) {
        DecimalFormatSymbols symbols = DecimalFormatSymbols.getInstance(Locale.GERMANY);
        DecimalFormat df = new DecimalFormat("#,##0.00", symbols);

        System.out.println(df.format(1234.5));
        System.out.println(df.format(1_000_000));
    }
}
```

What is printed on each line?

<details>
<summary>Answer</summary>

```
1.234,50
1.000.000,00
```

`DecimalFormat` by itself would use the **JVM default locale's** decimal
and grouping symbols — which is exactly why the slide warns that to get
locale-specific output reliably, you must pass an explicit
`DecimalFormatSymbols` instance obtained via `DecimalFormatSymbols
.getInstance(locale)` to the two-argument `DecimalFormat` constructor,
rather than relying on the no-symbols constructor and whatever the
runtime's default locale happens to be.

For `Locale.GERMANY`, the grouping separator is `.` and the decimal
separator is `,` — the reverse of the U.S. convention. This is stated
directly in the slide's own example: `df.format(1234.5)` with German
symbols produces `"1.234,50"`.

The pattern `#,##0.00` (from the "Pattern Characters" table: `0` =
required digit, `#` = optional digit, `,` = grouping separator position,
`.` = decimal separator position) groups digits every three positions and
always shows exactly two fraction digits. Applying that same pattern and
symbols to `1_000_000` groups it into three three-digit clusters
separated by the German grouping symbol `.`, with a trailing `,00` for
the (zero-valued) required fraction digits: `"1.000.000,00"`. The pattern
itself (digit grouping/required-digit rules) doesn't change between
locales — only which *characters* represent "grouping separator" and
"decimal separator" changes, because those come from the
`DecimalFormatSymbols` object, not the pattern string.

</details>

---

## Exercise 4 — `ofPattern(pattern, locale)` only localizes tokens, not structure

```java
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public class Demo {
    public static void main(String[] args) {
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.FRANCE);
        LocalDate date = LocalDate.of(2025, 6, 15);

        System.out.println(date.format(fmt));
    }
}
```

A teammate expects this to print `"15 juin 2025"` — the natural French
date ordering (day before month, no comma). What does it actually print,
and why?

<details>
<summary>Answer</summary>

It prints:

```
juin 15, 2025
```

This is exactly the behavior the slide calls out under "Locale-Aware
Pattern Formatter": passing a `Locale` to `DateTimeFormatter.ofPattern()`
only affects how **locale-sensitive text tokens** in the pattern are
resolved — here, `MMMM` resolves to the French month name `"juin"`
instead of `"June"`. It does **not** reorder, restructure, or otherwise
localize the *shape* of the pattern itself. The literal pattern
`"MMMM dd, yyyy"` still means "month-name text, then a space, then the
two-digit day, then a literal comma and space, then the four-digit
year" — that structure is fixed by the pattern string the developer
wrote, regardless of locale. Only tokens whose textual representation is
locale-dependent (month names, day-of-week names, AM/PM markers, and
similar) get translated; the day number `15`, the comma, and the field
order all stay exactly where the pattern places them.

To get an idiomatic, locale-appropriate arrangement — day before month,
no English-style comma — you need a different API: the slide's
`ofLocalizedDate(FormatStyle)` combined with `.withLocale(locale)`. That
approach doesn't take a hardcoded pattern at all; it asks the locale
itself to supply an appropriate arrangement. That's precisely how the
slide's own `FULL`-style example works: `DateTimeFormatter
.ofLocalizedDate(FormatStyle.FULL).withLocale(Locale.FRANCE)` formats the
same `LocalDate.of(2025, 6, 15)` as `"dimanche 15 juin 2025"` — day of
week, then day number, then month name, with no hardcoded pattern
dictating "month first."

</details>

---

## Exercise 5 — `Currency` metadata drives `NumberFormat` currency rounding

```java
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;

public class Demo {
    public static void main(String[] args) {
        Currency jpy = Currency.getInstance("JPY");
        System.out.println(jpy.getDefaultFractionDigits());

        NumberFormat yenFormat = NumberFormat.getCurrencyInstance(Locale.JAPAN);
        System.out.println(yenFormat.format(2500.75));
    }
}
```

What is printed on each line, and why doesn't the second line show any
decimal places even though `2500.75` clearly has a fractional part?

<details>
<summary>Answer</summary>

```
0
￥2,501
```

The first line comes straight from the slide's "Currency" section:
`Currency.getInstance("JPY").getDefaultFractionDigits()` returns `0`,
because — as the slide explicitly notes — "Japanese Yen has no subunit."
`Currency` itself only holds ISO 4217 metadata (code, symbol, fraction
digits); it does not format anything on its own.

The second line is where that metadata actually gets used:
`NumberFormat.getCurrencyInstance(Locale.JAPAN)` builds a formatter that
looks up the currency associated with Japan (JPY) and configures itself
to use *that currency's* default fraction-digit count, not some fixed
count and not the number of decimal digits present in the value being
formatted. Since JPY's default fraction digits is `0`, the currency
instance is configured to show zero digits after the decimal point
— it rounds the input to the nearest whole yen rather than truncating or
printing `2500.75` verbatim or with two decimals like a USD/EUR
formatter would. `2500.75` is unambiguously closer to `2501` than to
`2500`, so it rounds up to `2,501`, grouped with a comma per the
`NumberFormat` grouping rules, and prefixed with the yen currency symbol
for the `ja_JP` locale (rendered here as the fullwidth yen sign `￥`).

This mirrors the slide's broader point about `NumberFormat`: factory
methods like `getCurrencyInstance(Locale)` derive *all* their formatting
behavior — symbol, grouping, and fraction-digit count — from the
combination of the target currency and locale, which is exactly why the
exam tip stresses using `Currency.getInstance(Locale)` /
`getDefaultFractionDigits()` to reason about currency output instead of
assuming every currency behaves like USD's familiar two-decimal-place
convention.

</details>
