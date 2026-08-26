---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Overloading picks a method at **compile time**, based on the *declared* (static) type of the arguments — not their runtime type. Overriding, by contrast, is resolved at **runtime**, based on the actual object's class. Confusing the two is the source of a classic, reproducible surprise, and it also shapes how a method's parameters should be designed in the first place: favor interfaces over concrete classes, and favor enums over `boolean` when a call site would otherwise be unreadable.

## Use Cases

- Debugging a call to an overloaded method that "picks the wrong version" when the argument arrives as a supertype-typed variable (`Collection<?>`, `Object`, a boxed number).
- Deciding whether a new method should be an overload of an existing name or a differently-named method entirely.
- Designing a public API method signature: how many parameters, which types, `boolean` vs. enum.
- Reviewing a PR that overloads a method with both `int` and `long`/`Integer` parameters and reasoning about which call sites are actually safe.

## Deep Dive

### Overload resolution is static; override resolution is dynamic

```java
public class CollectionClassifier {
    public static String classify(Set<?> s) {
        return "Set";
    }

    public static String classify(Collection<?> c) {
        return "Unknown Collection";
    }

    public static void main(String[] args) {
        Collection<?>[] collections = {
            new HashSet<String>(),
            new ArrayList<String>()
        };

        for (Collection<?> c : collections) {
            System.out.println(classify(c));   // both print "Unknown Collection"
        }
    }
}
```

The loop variable `c` is *declared* `Collection<?>`, and that declared type is all the compiler looks at when it resolves `classify(c)`. It doesn't matter that the first element is actually a `HashSet` at runtime — the only overload the compiler can prove applies to a `Collection<?>`-typed expression is `classify(Collection<?>)`, so that's the one baked into the bytecode at *both* call sites. The result: `Unknown Collection` twice, even though a `Set` is sitting right there at runtime.

Compare that with overriding, which resolves the opposite way — by the object's actual class, ignoring the variable's declared type:

```java
class Wine {
    String name() { return "wine"; }
}

class SparklingWine extends Wine {
    @Override String name() { return "sparkling wine"; }
}

public class Overriding {
    public static void main(String[] args) {
        Wine[] wines = { new Wine(), new SparklingWine() };
        for (Wine wine : wines) {
            System.out.println(wine.name());   // "wine", then "sparkling wine"
        }
    }
}
```

Here every loop variable has the *same* declared type, `Wine`, yet the two calls print different things — because `name()` is overridden, and overridden methods dispatch on the runtime type of the receiver. Overloading does the opposite: every call above shares the same runtime *behavior* because it shares the same declared type, regardless of the runtime type of the argument.

If the intent really is to branch on an object's runtime type, overloading doesn't provide that — an explicit `instanceof` check does:

```java
public static String classify(Collection<?> c) {
    return c instanceof Set ? "Set" : "Unknown Collection";
}
```

### Avoiding the trap: don't let overload choice change behavior

The bug above isn't really about `Collection` — it's about writing same-named overloads that do *meaningfully different* things and then calling them through a variable typed as a common supertype. Two ways out:

**1. Give them different names.** `ObjectOutputStream` doesn't overload `write` for every primitive type — it exports `writeBoolean(boolean)`, `writeInt(int)`, `writeLong(long)`, etc. Nobody can be surprised about which one runs, because the call site names it explicitly.

**2. If they must share a name, make them behave identically.** `String.contentEquals(StringBuffer)` predates `CharSequence`; once `CharSequence` was added, `String` gained `contentEquals(CharSequence)` too. The two overloads coexist safely only because the more specific one forwards to the more general one instead of doing something different:

```java
public boolean contentEquals(StringBuffer sb) {
    return contentEquals((CharSequence) sb);
}
```

A caller who can't tell which overload fired still gets the same answer either way — so the ambiguity is harmless.

Autoboxing makes this trap easier to fall into than it used to be, because `int` and `Integer` are no longer "radically different" at a call site the way `int` and `String` are:

```java
List<Integer> a = new ArrayList<>(List.of(10, 20, 30));
a.remove(1);                 // calls remove(int index) -> removes index 1, a is now [10, 30]

List<Integer> b = new ArrayList<>(List.of(10, 20, 30));
b.remove((Integer) 1);       // calls remove(Object o)   -> removes the value 1; not present, b unchanged
```

`List<E>` overloads `remove(int index)` and `remove(E)` (erased to `remove(Object)`). An `int` argument resolves to the `int` overload without even needing autoboxing, so `list.remove(1)` removes *by position*, not by value — a common source of confusion when a list happens to hold `Integer`s and a caller expected "remove this value."

### Signature design: enum over boolean, interface over class

A `boolean` parameter is opaque at the call site — the reader has to go look up what `true` means:

```java
Thermometer.newInstance(true);                             // true meaning what, exactly?
```

A two-element enum documents itself, and leaves room to grow:

```java
public enum TemperatureScale { FAHRENHEIT, CELSIUS }

Thermometer.newInstance(TemperatureScale.CELSIUS);         // unambiguous
```

Adding `KELVIN` later is a one-line change to the enum; a `boolean` parameter has no equivalent third state without breaking the method's signature.

Parameter *types* deserve the same scrutiny: prefer an interface over a concrete class whenever the method only relies on the interface's behavior.

```java
// Ties every caller to HashMap specifically
void printAll(HashMap<String, Integer> map) { ... }

// Accepts HashMap, TreeMap, a submap view, or any future Map implementation
void printAll(Map<String, Integer> map) { ... }
```

Declaring the parameter as `HashMap` forces a caller holding a `TreeMap` (or any other `Map`) to copy it into a `HashMap` just to call the method — an unnecessary, potentially expensive conversion the interface-typed version never demands.

## Trade-offs

- **Overloading by declared type is invisible at the call site** — the reader can't tell which overload runs without knowing the *static* type of every argument, not just what the object happens to be at runtime. Reserve overloading for cases where either the parameter types are radically different (an `int` and a `Collection` can never be confused) or every overload is guaranteed to behave the same way.
- **Same-arity overloads are the riskiest shape.** A conservative, mechanical rule: never export two overloads with the same number of parameters unless one parameter type in each pair is impossible to convert to the other. `ArrayList(int)` vs. `ArrayList(Collection<?>)` is safe this way; `remove(int)` vs. `remove(E)` on `List<Integer>` is not, because `int` converts to `Integer` via autoboxing.
  ```java
  new ArrayList<>(List.of(10, 20, 30)).remove(1);                    // removes index 1 -> [10, 30]
  new ArrayList<>(List.of(10, 20, 30)).remove(Integer.valueOf(20));  // removes the value 20 -> [10, 30]
  ```
- **A `boolean` parameter reads fine to the author and opaque to everyone else.** The cost of an enum is one extra type declaration; the payoff is a call site that needs no comment and a signature that can grow a third option without an API break.
- **An interface-typed parameter costs nothing when the method only calls interface methods, and avoids forcing callers into one implementation.** The only reason to require a concrete class is when the method genuinely needs something the interface doesn't expose (e.g. a class-specific method) — otherwise it's a needless restriction.

## Documentation Links

- [JLS 15.12 — Method Invocation Expressions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.12) — doc
- [JLS 8.4.9 — Overloading](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.9) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
