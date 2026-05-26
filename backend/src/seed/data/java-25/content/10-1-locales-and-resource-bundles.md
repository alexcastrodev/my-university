# Locales and Resource Bundles

---

## Overview

Localization (l10n) is the process of adapting an application to a specific language and region without changing the source code. Java's localization support is built around two pillars:

| Class | Package | Purpose |
|-------|---------|---------|
| `Locale` | `java.util` | Represents a language/region combination |
| `ResourceBundle` | `java.util` | Loads locale-specific strings and objects |

---

## Locale

A `Locale` identifies a specific language, region, and (optionally) variant. Locales are used throughout the JDK — in formatting, parsing, and resource lookups.

### Predefined Constants

```java
Locale.US        // English, United States
Locale.UK        // English, United Kingdom
Locale.FRANCE    // French, France
Locale.GERMANY   // German, Germany
Locale.JAPAN     // Japanese, Japan
Locale.CHINA     // Simplified Chinese, China
Locale.CANADA    // English, Canada
Locale.CANADA_FRENCH  // French, Canada
```

### Creating a Locale

Java 19 introduced `Locale.of()` as a replacement for the deprecated constructors:

```java
// Java 19+ — preferred
Locale ptPT = Locale.of("pt", "PT");   // Portuguese, Portugal
Locale enUS = Locale.of("en", "US");   // English, United States
Locale fr   = Locale.of("fr");         // French (no region)

// Pre-Java 19 — deprecated but still compiles
Locale old = new Locale("pt", "PT");
```

The first argument is the ISO 639-1 language code (lowercase); the second is the ISO 3166-1 alpha-2 country code (uppercase).

### Default Locale

```java
Locale def = Locale.getDefault();              // JVM default locale
Locale.setDefault(Locale.of("pt", "PT"));      // Override default (affects whole JVM)
```

> **Exam tip:** `Locale.of()` was added in Java 19. The `new Locale(language, country)` constructor is deprecated since Java 19 but is still valid on the exam. Know both forms.

### Locale Methods

```java
Locale locale = Locale.of("fr", "FR");

locale.getLanguage();        // "fr"
locale.getCountry();         // "FR"
locale.getDisplayLanguage(); // "French" (in the JVM default locale)
locale.getDisplayCountry();  // "France"
locale.toString();           // "fr_FR"
locale.toLanguageTag();      // "fr-FR" (BCP 47 format)
```

---

## ResourceBundle

`ResourceBundle` loads locale-specific text and objects from external files, keeping translated content out of source code.

### Properties Files

The most common form is a `.properties` file — a key=value text file in ISO 8859-1 encoding.

File naming convention: `<baseName>_<language>_<COUNTRY>.properties`

```
Messages.properties          ← default fallback
Messages_en.properties       ← English fallback
Messages_en_US.properties    ← English, United States
Messages_pt.properties       ← Portuguese fallback
Messages_pt_PT.properties    ← Portuguese, Portugal
```

Example `Messages_en_US.properties`:
```
greeting=Hello, {0}!
farewell=Goodbye!
item.count=You have {0} items.
```

Example `Messages_pt_PT.properties`:
```
greeting=Olá, {0}!
farewell=Adeus!
item.count=Tem {0} itens.
```

### Loading a ResourceBundle

```java
Locale locale = Locale.of("pt", "PT");
ResourceBundle bundle = ResourceBundle.getBundle("Messages", locale);

String greeting = bundle.getString("greeting");  // "Olá, {0}!"
```

If no locale-specific file exists, Java falls back through the lookup chain until a match is found.

### Fallback (Lookup) Chain

When `ResourceBundle.getBundle("Messages", Locale.of("pt", "PT"))` is called, Java searches in this order:

1. `Messages_pt_PT.properties`
2. `Messages_pt.properties`
3. `Messages.properties` (default)
4. `MissingResourceException` if none found

> **Exam tip:** The fallback chain goes from most specific to least specific. The default file (`Messages.properties`) is the last resort. If a key exists in a less-specific file but not in a more-specific one, the value from the parent file is returned.

### Key-Level Inheritance

Resource bundles do **not** merge keys from parent bundles. Java loads the most specific bundle that exists, and only falls back to a parent bundle for **lookup** if the key is not in the selected bundle.

```java
// Messages_pt_PT.properties has only "greeting"
// Messages_pt.properties    has "greeting" and "farewell"
// Messages.properties       has all three keys

ResourceBundle bundle = ResourceBundle.getBundle("Messages", Locale.of("pt", "PT"));
bundle.getString("farewell");  // found in Messages_pt.properties via fallback
```

### ResourceBundle Methods

```java
ResourceBundle bundle = ResourceBundle.getBundle("Messages", Locale.US);

bundle.getString("greeting");           // String value for key
bundle.getObject("someKey");            // Object value (cast required)
bundle.containsKey("farewell");         // true / false
bundle.keySet();                        // Set<String> of all keys in this bundle
bundle.getLocale();                     // Locale this bundle was loaded for
bundle.getBaseBundleName();             // "Messages"
```

---

## ListResourceBundle

`ListResourceBundle` is a programmatic alternative to `.properties` files. Subclass it and override `getContents()` to return an `Object[][]`:

```java
public class Messages_en_US extends ListResourceBundle {
    @Override
    protected Object[][] getContents() {
        return new Object[][] {
            { "greeting", "Hello!" },
            { "maxRetries", 3 },
            { "colors", new String[]{"red", "green", "blue"} }
        };
    }
}
```

`ListResourceBundle` supports any object type, not just strings. Load it the same way:

```java
ResourceBundle bundle = ResourceBundle.getBundle("Messages", Locale.US);
int max = (int) bundle.getObject("maxRetries");  // 3
```

> **Exam tip:** `ListResourceBundle` is loaded automatically by `getBundle()` if it is on the classpath and matches the naming convention. No special factory call is needed.

---

## Key Points for the Exam

- `Locale.of("language", "COUNTRY")` is the preferred factory method since Java 19; the `new Locale(...)` constructor is deprecated.
- `Locale.getDefault()` returns the JVM default locale; `Locale.setDefault()` changes it for the entire JVM.
- `ResourceBundle.getBundle(baseName, locale)` searches for the most specific matching properties file first.
- Fallback chain: `baseName_language_COUNTRY` → `baseName_language` → `baseName` → `MissingResourceException`.
- `getString()` returns a `String`; `getObject()` returns an `Object` and requires a cast.
- `ListResourceBundle` supports non-String values; it follows the same naming convention and lookup chain.

## References

- [Oracle Docs — Locale (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html)
- [Oracle Docs — ResourceBundle (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.html)
- [Java Tutorials — Isolating Locale-Specific Data](https://docs.oracle.com/javase/tutorial/i18n/resbundle/index.html)
