# Supporting Internationalization and Localization

> Internationalization (i18n) is the process of designing an application so it can be adapted to different languages and regions. Localization (l10n) is the process of actually adapting it for a specific locale. Java's `Locale` class is the cornerstone of both.

---

## What Is a Locale?

A `Locale` object represents a specific geographical, political, or cultural region. It encodes:

- **Language** — a lowercase ISO 639 code (e.g., `"en"`, `"fr"`, `"pt"`)
- **Country / Region** — an uppercase ISO 3166 code (e.g., `"US"`, `"FR"`, `"BR"`)
- **Variant** — optional, for further distinctions

A locale does not translate text by itself; it tells locale-sensitive classes *how* to format or parse values for that region.

---

## Creating Locales

There are several ways to create a `Locale`:

### Using Built-in Constants

```java
Locale us      = Locale.US;          // en_US
Locale france  = Locale.FRANCE;      // fr_FR
Locale germany = Locale.GERMANY;     // de_DE
Locale uk      = Locale.UK;          // en_GB
```

### Using the Constructor

```java
Locale ptBR = new Locale("pt", "BR");   // Portuguese, Brazil
Locale es    = new Locale("es");         // Spanish (no country)
```

### Using Locale.of() (Java 19+, preferred on newer exams)

```java
Locale ptPT = Locale.of("pt", "PT");   // Portuguese, Portugal
```

### Using Locale.Builder

```java
Locale custom = new Locale.Builder()
        .setLanguage("ja")
        .setRegion("JP")
        .build();
```

---

## Getting the Default Locale

The JVM picks up the host system locale on startup:

```java
Locale defaultLocale = Locale.getDefault();
System.out.println(defaultLocale);           // e.g., en_US
System.out.println(defaultLocale.getLanguage());  // en
System.out.println(defaultLocale.getCountry());   // US
System.out.println(defaultLocale.getDisplayName()); // English (United States)
```

You can also change the default programmatically (affects the entire JVM):

```java
Locale.setDefault(Locale.FRANCE);
```

---

## Locale-Sensitive Classes

Many standard library classes accept a `Locale` to alter their behavior:

| Class | Locale effect |
|---|---|
| `NumberFormat` | Digit grouping separator, decimal separator, currency symbol |
| `DateTimeFormatter` | Month names, day names, date ordering |
| `Collator` | Language-specific string sorting |
| `String.toLowerCase(Locale)` / `toUpperCase(Locale)` | Correct case conversion for locale (e.g., Turkish `i` → `İ`) |
| `ResourceBundle` | Loads locale-specific property files |

```java
import java.text.NumberFormat;
import java.util.Locale;

double amount = 1234.56;

NumberFormat us = NumberFormat.getCurrencyInstance(Locale.US);
NumberFormat de = NumberFormat.getCurrencyInstance(Locale.GERMANY);
NumberFormat jp = NumberFormat.getCurrencyInstance(Locale.JAPAN);

System.out.println(us.format(amount));   // $1,234.56
System.out.println(de.format(amount));   // 1.234,56 €
System.out.println(jp.format(amount));   // ¥1,235
```

---

## Internationalization vs. Localization

| Term | Abbreviation | Definition |
|---|---|---|
| Internationalization | i18n (18 letters between i and n) | Designing/coding the app to be locale-neutral |
| Localization | l10n (10 letters between l and n) | Providing locale-specific data (strings, formats) |

Practical checklist for i18n-ready code:

- Never hard-code user-facing strings — use resource bundles.
- Never hard-code date or number formats — use `DateTimeFormatter` and `NumberFormat` with a `Locale`.
- Use `Locale`-aware string comparison and case conversion.
- Store dates internally as UTC; convert to local time for display.

---

## Locale Display Methods

```java
Locale locale = Locale.FRANCE;

System.out.println(locale.getLanguage());           // fr
System.out.println(locale.getCountry());            // FR
System.out.println(locale.getDisplayLanguage());    // French  (in default locale)
System.out.println(locale.getDisplayCountry());     // France
System.out.println(locale.getDisplayName());        // French (France)
System.out.println(locale.toString());              // fr_FR
System.out.println(locale.toLanguageTag());         // fr-FR  (IETF BCP 47)
```

`toLanguageTag()` uses hyphens (BCP 47 standard); `toString()` uses underscores (Java legacy format).

---

## Key Rules Summary

- `Locale` encodes language + optional country + optional variant.
- Use constants (`Locale.US`, `Locale.FRANCE`) when available; use `Locale.of()` or the constructor for others.
- `Locale.getDefault()` returns the JVM's current default locale, which mirrors the host OS.
- Locale does not translate text — it guides formatting classes and resource bundle selection.
- Always pass a `Locale` to locale-sensitive APIs rather than relying on the default, so behavior is predictable across environments.

---

## References

- [Oracle Docs — java.util.Locale](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Locale.html)
- [Oracle Tutorial — Internationalization](https://docs.oracle.com/javase/tutorial/i18n/index.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
