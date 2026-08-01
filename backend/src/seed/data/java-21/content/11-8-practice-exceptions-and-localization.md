# Practice: Exceptions and Localization

> Five exercises covering what the slides in this module introduced — the
> checked/unchecked exception hierarchy and catch-ordering rules, the
> finally-block-overrides-everything control-flow gotcha, multi-catch
> syntax rules, try-with-resources close order and suppressed exceptions,
> and `ResourceBundle` key-level fallback. Try to answer before opening
> each explanation.

---

## Exercise 1 — Catch block ordering and the exception hierarchy

```java
public class Demo {
    public static void main(String[] args) {
        try {
            risky();
        } catch (Exception e) {
            System.out.println("Exception: " + e.getMessage());
        } catch (NumberFormatException e) {
            System.out.println("NFE: " + e.getMessage());
        }
    }

    static void risky() {
        throw new NumberFormatException("bad number");
    }
}
```

Does this compile? If not, why not?

<details>
<summary>Answer</summary>

**No — this is a compile-time error**, on the second `catch` clause.

`NumberFormatException` extends `IllegalArgumentException`, which extends
`RuntimeException`, which extends `Exception`. So `NumberFormatException`
*is* an `Exception` — it's already fully covered by the first `catch
(Exception e)` block.

Catch blocks are checked top-to-bottom, and the rule is that a more
specific (child) type must appear **before** a more general (ancestor)
type. Because `catch (Exception e)` comes first here, the second block —
`catch (NumberFormatException e)` — can never be reached, and javac
rejects this as unreachable code with an error like "exception
`NumberFormatException` has already been caught by the alternative
`Exception`." This is a compile error, not a warning — the code simply
does not build.

Swapping the order (most-specific `NumberFormatException` first, `Exception`
second) would compile fine and print `NFE: bad number`.

</details>

---

## Exercise 2 — `finally` swallows an in-flight exception

```java
public class Demo {
    static int test() {
        try {
            throw new RuntimeException("boom");
        } finally {
            return 42;
        }
    }

    public static void main(String[] args) {
        System.out.println(test());
    }
}
```

Does this compile, and if so, what's printed? Does the `RuntimeException`
ever reach `main`?

<details>
<summary>Answer</summary>

This **compiles** and **prints `42`**. The `RuntimeException` never
propagates anywhere — it is silently discarded.

`finally` always runs, even when the `try` block is in the middle of
propagating an exception. But if the `finally` block itself completes
**abruptly** — via `return`, `break`, `continue`, or by throwing — that
abrupt completion *replaces* whatever the `try` block was doing. Per the
Java Language Specification, a `return` inside `finally` discards any
exception that was in flight from the `try` block: the method returns
`42` normally, as if the `throw` had never happened.

This is exactly the "finally overrides return" gotcha: it works
identically whether the `try` block was returning a value or throwing an
exception — the `finally` block's own `return`/`throw`/`break`/`continue`
always wins. It's why deliberately returning (or throwing) from a
`finally` block is considered a code smell — it can silently hide real
failures.

</details>

---

## Exercise 3 — Multi-catch and the implicitly-final variable

```java
public class Demo {
    public static void main(String[] args) {
        try {
            throw new NumberFormatException("bad");
        } catch (NumberFormatException | NullPointerException e) {
            e = new NumberFormatException("replaced");
            System.out.println(e.getMessage());
        }
    }
}
```

Does this compile?

<details>
<summary>Answer</summary>

**No — compile-time error** on the line `e = new NumberFormatException("replaced");`.

The multi-catch types themselves are fine: `NumberFormatException` and
`NullPointerException` are unrelated (neither is an ancestor of the
other), which is exactly what multi-catch requires — the compiler would
reject something like `catch (IOException | FileNotFoundException e)`
because `FileNotFoundException` is already a subtype of `IOException`,
making the alternative redundant.

The actual problem is that a multi-catch parameter is **implicitly
`final`**. Because `e`'s declared type is effectively the union of the
listed alternatives, the compiler cannot know at any reassignment point
which of the alternatives' methods are safe to call on a new value, so
the language simply forbids reassigning it at all. Trying to assign
`e = new NumberFormatException(...)` — even to a value type-compatible
with one of the alternatives — fails to compile with something like
"multi-catch parameter e may not be assigned."

A single-type `catch (NumberFormatException e)` block, by contrast, does
allow reassigning `e`, since ordinary catch parameters are not
implicitly final.

</details>

---

## Exercise 4 — Try-with-resources: close order and suppressed exceptions

```java
class Res implements AutoCloseable {
    private final String name;
    Res(String name) { this.name = name; }

    @Override
    public void close() {
        System.out.println("closing " + name);
        if (name.equals("B")) {
            throw new RuntimeException("B close failed");
        }
    }
}

public class Demo {
    public static void main(String[] args) {
        try (Res a = new Res("A"); Res b = new Res("B")) {
            throw new IllegalStateException("body failed");
        } catch (Exception e) {
            System.out.println("caught: " + e.getMessage());
            for (Throwable t : e.getSuppressed()) {
                System.out.println("suppressed: " + t.getMessage());
            }
        }
    }
}
```

What's printed, in order?

<details>
<summary>Answer</summary>

```
closing B
closing A
caught: body failed
suppressed: B close failed
```

Two rules from this module combine here:

1. **Close order is reverse of declaration order.** `a` was declared
   before `b`, so when the `try` block finishes (however it finishes),
   resources close as `b` first, then `a` — hence "closing B" prints
   before "closing A".

2. **When the body already threw and `close()` also throws, the `close()`
   exception is attached as suppressed rather than replacing the primary
   one.** The `try` body throws `IllegalStateException("body failed")`
   first — that becomes the primary exception working its way out. While
   unwinding, Java still closes both resources: closing `b` throws a
   `RuntimeException("B close failed")`, but since a primary exception is
   already propagating, this new exception is *not* allowed to
   replace it — instead it's automatically appended to the primary
   exception's suppressed list via `addSuppressed()`. Closing `a`
   completes normally (no exception), so it contributes nothing further.

The `catch (Exception e)` block therefore catches the original
`IllegalStateException` as `e` (message `"body failed"`), and
`e.getSuppressed()` contains exactly one entry — the `RuntimeException`
from `b.close()` (message `"B close failed"`). Nothing is silently lost,
which is precisely try-with-resources' advantage over a hand-written
`finally` block that closes resources manually.

</details>

---

## Exercise 5 — `ResourceBundle` key-level fallback

```java
// Messages.properties       (base/root bundle)
// greeting=Hello
// farewell=Goodbye

// Messages_fr.properties    (French, no country)
// greeting=Bonjour

import java.util.Locale;
import java.util.ResourceBundle;

public class Demo {
    public static void main(String[] args) {
        Locale.setDefault(Locale.US);
        ResourceBundle bundle = ResourceBundle.getBundle("Messages", Locale.FRENCH);
        System.out.println(bundle.getString("greeting"));
        System.out.println(bundle.getString("farewell"));
    }
}
```

`Locale.FRENCH` is the built-in constant for language `"fr"` with no
country. What's printed on each line?

<details>
<summary>Answer</summary>

```
Bonjour
Goodbye
```

`ResourceBundle.getBundle("Messages", Locale.FRENCH)` first looks for the
most specific matching *file* for the requested locale. Since
`Locale.FRENCH` has no country, the search is just
`Messages_fr.properties` → `Messages.properties` (the root/base bundle).
`Messages_fr.properties` exists, so that file becomes the selected
bundle — its `parent` in the fallback chain is the root bundle,
`Messages.properties`.

The fallback for an individual *key* is then separate from the fallback
for the *file*: once `Messages_fr.properties` is selected as the primary
bundle, `bundle.getString("greeting")` finds `greeting` directly in that
file and returns `"Bonjour"`. But `Messages_fr.properties` has no
`farewell` key, so `getString("farewell")` walks up the bundle's parent
chain to the root bundle `Messages.properties`, finds `farewell=Goodbye`
there, and returns `"Goodbye"` — it does **not** throw
`MissingResourceException`, because the key exists somewhere in the
chain.

Note that `Locale.setDefault(Locale.US)` here is irrelevant to the
result: the default locale only matters as an additional fallback step
when the *requested* locale's own file (and its language-only variant)
can't be found at all — it never affects which bundle is chosen once
`Messages_fr.properties` is successfully located.

</details>
