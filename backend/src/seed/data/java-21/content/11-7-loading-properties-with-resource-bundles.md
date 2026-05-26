# Loading Properties with Resource Bundles

> A `ResourceBundle` externalizes locale-specific strings so the same compiled code can display different text for different languages. Understanding how Java searches for bundle files and falls back when exact matches are missing is a key exam topic.

---

## What Is a Resource Bundle?

A resource bundle is a collection of key-value pairs for a specific locale. Your code always references keys; the bundle provides the locale-appropriate value at runtime.

```java
// Code — locale-independent
String greeting = bundle.getString("greeting");

// Zoo_en_US.properties
// greeting=Hello!

// Zoo_fr_FR.properties
// greeting=Bonjour!
```

---

## Properties File Format

Resource bundle properties files use UTF-8 (Java 9+) with the naming convention:

```
<BaseName>[_<language>[_<country>[_<variant>]]].properties
```

| File name | Locale |
|---|---|
| `Zoo.properties` | Default (fallback) |
| `Zoo_en.properties` | English |
| `Zoo_en_US.properties` | English, United States |
| `Zoo_fr.properties` | French |
| `Zoo_fr_FR.properties` | French, France |

Example — `Zoo_en_US.properties`:

```properties
greeting=Hello!
farewell=Goodbye!
animal.lion=Lion
animal.tiger=Tiger
```

Example — `Zoo_fr_FR.properties`:

```properties
greeting=Bonjour !
farewell=Au revoir !
animal.lion=Lion
animal.tiger=Tigre
```

---

## Loading a ResourceBundle

Use `ResourceBundle.getBundle(baseName, locale)`:

```java
import java.util.*;

Locale locale = Locale.FRANCE;
ResourceBundle bundle = ResourceBundle.getBundle("Zoo", locale);

System.out.println(bundle.getString("greeting"));    // Bonjour !
System.out.println(bundle.getString("animal.tiger")); // Tigre
```

When the locale is omitted, the JVM default locale is used:

```java
ResourceBundle bundle = ResourceBundle.getBundle("Zoo");
```

---

## The Locale Fallback Chain

If the exact file for a locale is not found, Java searches progressively less specific bundles before throwing `MissingResourceException`. Given `Locale("fr", "FR")` and base name `"Zoo"`:

```
1. Zoo_fr_FR.properties   (requested locale — language + country)
2. Zoo_fr.properties      (language only)
3. Zoo_fr_FR.properties   (default locale — language + country, if default ≠ requested)
4. Zoo_en.properties      (default locale — language only, assuming en default)
5. Zoo.properties         (base bundle — last resort)
6. MissingResourceException (nothing found)
```

> **Exam tip:** The fallback is per **bundle file**, not per key. Once Java picks a bundle file, it uses that file — it does **not** then fall back to a parent bundle for missing individual keys. The exception: once a bundle object is loaded, `getObject()` *does* check the parent bundle hierarchy for individual keys.

---

## Key-Level Fallback

Individual key lookup does check parent bundles. If `Zoo_fr_FR.properties` does not contain `farewell`, Java looks in `Zoo_fr.properties`, then `Zoo.properties`:

```java
// Zoo_fr_FR.properties — has "greeting", no "farewell"
// Zoo.properties       — has "farewell=Goodbye"

ResourceBundle bundle = ResourceBundle.getBundle("Zoo", Locale.FRANCE);
System.out.println(bundle.getString("farewell")); // Goodbye (from Zoo.properties)
```

If the key is not found in any bundle in the chain, `MissingResourceException` is thrown (unchecked).

---

## Java Class Bundles

Instead of a `.properties` file you can extend `ListResourceBundle` in a Java class:

```java
import java.util.*;

public class Zoo_en_US extends ListResourceBundle {
    @Override
    protected Object[][] getContents() {
        return new Object[][] {
            { "greeting",    "Hello!"  },
            { "farewell",    "Goodbye!" },
            { "animal.lion", "Lion"    }
        };
    }
}
```

Class bundles take **precedence** over properties files when both exist for the same locale. They are useful when values cannot be expressed as plain strings (e.g., images or lists).

---

## Iterating Bundle Keys

```java
ResourceBundle bundle = ResourceBundle.getBundle("Zoo", Locale.US);

// Get all keys (including those inherited from parent bundles)
Enumeration<String> keys = bundle.getKeys();
while (keys.hasMoreElements()) {
    String key = keys.nextElement();
    System.out.println(key + " = " + bundle.getString(key));
}
```

---

## Key Rules Summary

| Rule | Detail |
|---|---|
| Naming convention | `BaseName_language_COUNTRY.properties` |
| Fallback order | Exact locale → language only → default locale chain → base bundle |
| Missing key | `MissingResourceException` (unchecked) |
| Class vs. properties | Class bundles take precedence |
| Key-level fallback | Individual keys are looked up in the parent chain after the initial bundle is selected |

---

## References

- [Oracle Docs — ResourceBundle](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ResourceBundle.html)
- [Oracle Tutorial — Backing a ResourceBundle with Properties Files](https://docs.oracle.com/javase/tutorial/i18n/resbundle/propfile.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
