---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

A `Locale` is an identifier — a language, optionally a script, region, and variant — that tells locale-sensitive APIs which conventions to use. A `ResourceBundle` is a keyed lookup of localized values, normally backed by one `.properties` file per language, that lets you write `rb.getString("exit.label")` instead of hard-coding `"Exit"`. The mechanic worth understanding is not the `getString` call but what happens *before* it: `getBundle` turns one requested locale into an ordered list of candidate filenames, and when the requested language is missing it silently falls back — first to the JVM's **default** locale, and only then to the language-neutral base bundle. Knowing that order is the difference between a German user seeing English and a German user seeing whatever language the build machine was configured for.

## Use Cases

- Pulling every user-visible string (menu labels, emails, validation messages) out of the code and into `.properties` files, so adding a language means dropping in a file rather than recompiling.
- Serving a per-request locale in a server application — resolved from `Accept-Language` or a user profile — instead of letting every request inherit the JVM-wide default.
- Detecting whether a user actually got their own language or a fallback, by comparing `rb.getLocale()` against the locale you asked for.
- Making formatted output deterministic in tests by pinning an explicit `Locale` at the call site, so a CI machine with a different `LANG` does not change assertions about decimal separators or currency symbols.
- Keeping display language and number/date formatting independently configurable through `Locale.Category.DISPLAY` and `Locale.Category.FORMAT`.
- Shipping translations in a separate jar or module, discovered through the `ResourceBundleProvider` service-loader SPI rather than sitting next to the code that uses them.

## Deep Dive

### Obtaining a Locale

The `Locale` constructors are deprecated since Java 19. Use a constant, the `Locale.of` factory, `forLanguageTag`, or `Locale.Builder`:

```java
Locale a = Locale.FRANCE;                              // predefined constant -> fr_FR
Locale b = Locale.of("en", "GB");                      // language + region   -> en_GB
Locale c = Locale.forLanguageTag("pt-BR");             // IETF BCP 47 tag     -> pt_BR
Locale d = new Locale.Builder()                        // syntax-checked
        .setLanguage("sr").setScript("Latn").setRegion("RS")
        .build();                                      // -> sr_RS_#Latn

d.toLanguageTag();                 // sr-Latn-RS
d.getDisplayName(Locale.ENGLISH);  // Serbian (Latin, Serbia)
Locale.ROOT;                       // language/country-neutral locale, all fields ""
```

`Locale.of` normalizes case (language lowercased, region uppercased) but performs no syntax checks at all. Note the deprecated form still compiles, it just warns:

```java
Locale old = new Locale("en", "GB");
// warning: [deprecation] Locale(String,String) in Locale has been deprecated
```

### Locale validates nothing — "UK" is not a country code

The region subtag for the United Kingdom is `GB` (ISO 3166). `UK` is not a valid code, and nothing in the API says so:

```java
Locale bogus = Locale.of("en", "UK");
bogus.getCountry();                       // "UK"
bogus.toLanguageTag();                    // "en-UK"
bogus.getDisplayName(Locale.ENGLISH);     // "English (UK)"  -- no exception, no warning
```

The resulting locale is simply an unknown region: no CLDR data matches it, so formatting silently degrades to the plain `en` data. `Locale.Builder` checks *well-formedness* only — two alphabetic characters is a legal shape, so it accepts the same mistake:

```java
new Locale.Builder().setRegion("UK").build();     // fine -> en_UK, still wrong
new Locale.Builder().setRegion("USA1").build();   // IllformedLocaleException: Ill-formed region: USA1
```

`forLanguageTag` is the most forgiving of all — unparseable input becomes the empty locale rather than an error:

```java
Locale.forLanguageTag("garbage!").toLanguageTag();   // "und"  (undetermined)
```

So validate locale identifiers at the boundary where they enter your system; the `Locale` class will not do it for you.

### The default locale, and its two categories

Every locale-sensitive API has an overload that takes no `Locale` and uses `Locale.getDefault()`, which is derived from the platform (the `LANG` environment variable on Unix/macOS, regional settings on Windows) and overridable at launch with `-Duser.language` / `-Duser.country`. Since Java 7 the default is split in two: `DISPLAY` (language of display names) and `FORMAT` (number, date, and currency conventions).

```java
Locale.setDefault(Locale.US);
Locale.setDefault(Locale.Category.FORMAT, Locale.GERMANY);

Locale.getDefault(Locale.Category.DISPLAY);   // en_US
Locale.getDefault(Locale.Category.FORMAT);    // de_DE
Locale.getDefault();                          // en_US  -- unchanged by the FORMAT-only call

NumberFormat.getInstance().format(1234.5);    // "1.234,5"  -- follows FORMAT
```

`Locale.setDefault` mutates process-global state, so it belongs in `main` at startup, not in library code and not per request. In a server, pass the locale explicitly instead.

### A bundle is a .properties file, read as UTF-8

The base name is a fully qualified name; the files live on the classpath (or in a module) beside it. `Msg.properties` is the base bundle, `Msg_fr.properties` the French one:

```properties
# Msg.properties  -- base bundle
greeting=Hello, {0}!
farewell=Goodbye
```

```properties
# Msg_fr.properties
greeting=Bonjour, {0} !
```

```java
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.FRANCE);
rb.getString("greeting");   // Bonjour, {0} !
rb.getBaseBundleName();     // Msg
rb.getLocale();             // fr   -- see below: this is how you detect a fallback
```

Since Java 9, `PropertyResourceBundle` reads the stream as **UTF-8** and only re-reads it as ISO-8859-1 if the UTF-8 decode fails, so accented and non-Latin text goes in literally — the old `native2ascii` `\uXXXX` escaping is no longer needed. Force one encoding with `-Djava.util.PropertyResourceBundle.encoding=UTF-8` if you want a decode failure to be an error instead of a silent re-read.

### The candidate-name chain

`getBundle` expands the requested locale into candidate bundle names, most specific first, dropping one field at a time:

```
ResourceBundle.getBundle("Menus", Locale.of("es", "CU", "x"))
  Menus_es_CU_x
  Menus_es_CU
  Menus_es
  Menus            (base bundle)
```

Which is why the filename convention is `base_language`, `base_language_COUNTRY`: `Menus_sv.properties` (Swedish), `Menus_fr_CA.properties` (Canadian French), `Menus_es_CU.properties` (Cuban Spanish). Language subtags are lowercase ISO 639 (`sv` for *Sverige*, `es` for *Español*); region subtags are uppercase ISO 3166 (`CA`, `ES`, and `SE` — not `SV` — for Sweden). The base name itself is case-sensitive: `Menus.properties`, never `Menus.Properties`.

For each candidate, `getBundle` looks for a **class** first and a `.properties` file second. It stops at the first hit and that becomes the result bundle.

### The default-locale fallback runs before the base bundle

This is the part that surprises people. Given only these two files:

```
Menus.properties       which=base
Menus_fr.properties    which=french
```

asking for German does *not* give you the base bundle if the JVM default happens to be French:

```java
Locale.setDefault(Locale.FRANCE);

ResourceBundle rb = ResourceBundle.getBundle("Menus", Locale.GERMAN);
rb.getLocale();            // fr
rb.getString("which");     // "french"   -- a German user reading French
```

Instrumenting a `ResourceBundle.Control` shows the exact sequence: the base bundle is found early but **put on hold** precisely because it is the base bundle, then the fallback locale's whole chain is searched, and only if that fails too is the held base bundle returned.

```
getCandidateLocales(de) = [de, ]
  try java.properties locale=[]   -> HIT   (base bundle: found, put on hold)
  try java.properties locale=[de] -> miss
getFallbackLocale(de) = fr_FR
getCandidateLocales(fr_FR) = [fr_FR, fr, ]
  try java.properties locale=[fr] -> HIT   <- this becomes the result
=> fr
```

So the effective precedence is: **requested locale chain, then default locale chain, then base bundle.** Two ways to opt out. Request `Locale.ROOT` — a locale whose fields are all empty makes the base name the only candidate, skipping the fallback entirely:

```java
ResourceBundle.getBundle("Menus", Locale.ROOT).getString("which");   // "base"
```

Or supply a `Control` whose `getFallbackLocale` returns `null`:

```java
static final ResourceBundle.Control NO_FALLBACK = new ResourceBundle.Control() {
    @Override public List<String> getFormats(String baseName) { return FORMAT_PROPERTIES; }
    @Override public Locale getFallbackLocale(String baseName, Locale locale) { return null; }
};

ResourceBundle rb = ResourceBundle.getBundle(
        "Menus", Locale.GERMAN, MyApp.class.getClassLoader(), NO_FALLBACK);
rb.getLocale();          // "" (root)
rb.getString("which");   // "base"
```

Either way, the cheap defensive check is to compare what you asked for with what you got:

```java
if (!rb.getLocale().getLanguage().equals(requested.getLanguage())) {
    log.warn("no bundle for {}, serving {}", requested, rb.getLocale());
}
```

### The parent chain: keys fall back, not files

Once a result bundle is chosen, `getBundle` links the remaining, less specific candidates as its **parents**. A translation file therefore only needs the keys it actually overrides; anything missing resolves up the chain:

```java
// Msg_fr.properties defines only "greeting"; Msg.properties also defines "farewell"
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.FRANCE);

rb.getString("greeting");        // Bonjour, {0} !   -- from Msg_fr
rb.getString("farewell");        // Goodbye          -- from the parent, Msg
rb.containsKey("farewell");      // true  (searches parents)
rb.keySet();                     // [farewell, greeting]  (union with parents)
```

Convenient, but it means a half-translated file degrades to mixed-language output rather than to a visible error. `keySet()` on each locale's bundle compared against the base bundle's is a cheap completeness test in a unit test.

### MissingResourceException covers two different failures

`MissingResourceException` is unchecked and used for both "no bundle at all" and "bundle found, key absent" — the messages differ, and so does the fix:

```java
ResourceBundle.getBundle("NoSuch");
// MissingResourceException: Can't find bundle for base name NoSuch, locale en_US

rb.getString("nope");
// MissingResourceException: Can't find resource for bundle
//   java.util.PropertyResourceBundle, key nope
```

`e.getKey()` returns the missing key, which is what makes the per-key catch-and-default idiom workable:

```java
static String label(ResourceBundle rb, String key, String fallback) {
    try {
        return rb.getString(key);
    } catch (MissingResourceException e) {
        return fallback;                 // e.getKey() == key
    }
}
```

Prefer `rb.containsKey(key)` when you just want the test without the exception.

### Placeholders: the bundle stores the pattern, MessageFormat fills it

A properties value holds only text, so anything variable is a `MessageFormat` pattern that the bundle stores verbatim and you format at the call site — with the same locale you used to load the bundle, since the numeric and currency parts are locale-sensitive:

```properties
# Msg.properties
items=You have {0,number,integer} item(s), total {1,number,currency}.
```

```java
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.US);

new MessageFormat(rb.getString("items"), Locale.US)
        .format(new Object[] { 3, 1234.5 });
// You have 3 item(s), total $1,234.50.

new MessageFormat(rb.getString("items"), Locale.GERMANY)
        .format(new Object[] { 3, 1234.5 });
// You have 3 item(s), total 1.234,50 €.
```

Numbered placeholders — not string concatenation — are what let a translator reorder the sentence. Everything past this point (`DateTimeFormatter`, `NumberFormat`, `Collator`) follows the same pattern of a `Locale`-taking overload beside the default one; see the `java.time` concept for date/time formatting specifics.

### Bundles in named modules

Under JPMS a bundle in another module is encapsulated by default. Two supported shapes: put the `.properties` files in the *same* module as the code and use the `Module` overload, or publish them from a separate module through the `ResourceBundleProvider` SPI and let `ServiceLoader` find them.

```java
// same module as the resources
ResourceBundle.getBundle("com.example.app.Msg", locale, MyApp.class.getModule());
```

```java
// provider module
module com.example.app.translations {
    requires com.example.app;
    provides com.example.app.spi.MsgProvider with com.example.app.fr.MsgProvider_fr;
}
```

The `Control`-taking overloads are unsupported here: calling one from a named module throws `UnsupportedOperationException`, because `Control` predates and does not understand module encapsulation.

## Trade-offs

- **Properties files vs. class-based bundles** — `.properties` files remain the default choice: translators can edit them without a compiler, a new language is a new file, and since Java 9 they are UTF-8 so `ListResourceBundle`'s old character-set advantage is gone. `ListResourceBundle` survives for the rare case of non-`String` resources, at the cost of recompiling to change a translation. It also silently wins the lookup, since `getBundle` tries the class candidate before the properties candidate for the same name — so a stray `Msg_fr.class` shadows `Msg_fr.properties`:

```java
// classpath contains BOTH Msg2_fr.class (a ListResourceBundle) and Msg2_fr.properties
ResourceBundle.getBundle("Msg2", Locale.FRENCH).getString("greeting");
// "from Msg2_fr.class"  -- the .properties file is never read
```

- **Fallback is silent by design** — a missing bundle or key never fails the build and rarely fails at runtime; it degrades to another language. That keeps a partial translation shippable, but it also means a translation gap only surfaces as a user complaint unless you assert on it:

```java
ResourceBundle rb = ResourceBundle.getBundle("Menus", Locale.GERMAN);
assertEquals(Locale.GERMAN, rb.getLocale());   // fails loudly instead of serving French
```

- **The default locale is process-global** — `Locale.setDefault` is the only lever for the no-argument overloads, so it is convenient in a CLI and wrong in a server, where two concurrent requests may need different locales. Threading the locale through explicitly is more code but the only correct option under concurrency.

- **Bundles are cached for the process lifetime** — `getBundle` returns cached instances, so editing a `.properties` file has no effect until the cache is dropped or the JVM restarts. `clearCache()` exists but clears everything for the caller's module, so live reloading needs a `Control` with a real `getTimeToLive`/`needsReload` rather than this blunt call:

```java
ResourceBundle.clearCache();   // all bundles loaded by the caller's module
```

- **One flat namespace of string keys** — keys are untyped strings with no compiler check, so a renamed key is a runtime failure and dotted prefixes (`file.new.label`) are convention, not structure. Tooling or a generated constants class can recover some safety; the API itself offers none.

- **`Control` is unavailable in named modules** — every customization hook (formats, candidate list, fallback, cache TTL) lives on `ResourceBundle.Control`, and the factory methods that accept one throw `UnsupportedOperationException` from a named module. Modularized applications get the `ResourceBundleProvider` SPI instead, which controls *where* bundles come from but not the search and caching policy.

## Documentation Links

- [Locale — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html) — doc
- [ResourceBundle — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.html) — doc
- [PropertyResourceBundle — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PropertyResourceBundle.html) — doc
- [ResourceBundle.Control — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.Control.html) — doc
- [ResourceBundleProvider — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/spi/ResourceBundleProvider.html) — doc
- [MessageFormat — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/MessageFormat.html) — doc
- [Internationalization Overview — Java SE 25](https://docs.oracle.com/en/java/javase/25/intl/internationalization-overview.html) — doc
