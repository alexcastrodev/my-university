# Pattern Matching

> **JEP 394** — finalized in Java 16, available in Java 21. Extends `instanceof` to combine type test, cast, and variable binding in a single step.

---

## The Problem: Traditional instanceof

Before pattern matching, testing and extracting data from an object required three separate steps:

```java
static double getPerimeter(Shape s) {
    if (s instanceof Rectangle) {
        Rectangle r = (Rectangle) s;   // explicit cast
        return 2 * r.length() + 2 * r.width();
    } else if (s instanceof Circle) {
        Circle c = (Circle) s;         // explicit cast
        return 2 * c.radius() * Math.PI;
    } else {
        throw new IllegalArgumentException("Unrecognized shape");
    }
}
```

This is verbose and error-prone — changing the type in one place and forgetting the cast in another is a common bug.

---

## Pattern Matching with instanceof

Pattern matching eliminates the explicit cast:

```java
static double getPerimeter(Shape s) {
    if (s instanceof Rectangle r) {
        return 2 * r.length() + 2 * r.width();
    } else if (s instanceof Circle c) {
        return 2 * c.radius() * Math.PI;
    } else {
        throw new IllegalArgumentException("Unrecognized shape");
    }
}
```

`Rectangle r` is a **type pattern**: it tests that `s` is a `Rectangle` and, if so, binds it to the pattern variable `r` — all in one expression.

---

## Pattern Components

A type pattern has three parts:

| Part | Description | Example |
|---|---|---|
| **Predicate** | The type test (`instanceof`) | `s instanceof Rectangle` |
| **Target** | The value being tested | `s` |
| **Pattern variable** | Bound only when the test is `true` | `r` |

---

## Scope of Pattern Variables

A pattern variable is only in scope where the `instanceof` test is guaranteed to be `true`:

```java
static void check(Shape s) {
    if (s instanceof Rectangle r) {
        // r is in scope here — test was true
        System.out.println(r.length());
    } else {
        // r is NOT in scope here
    }
}
```

### Scope extends past the if-block

If the `if` block exits unconditionally (returns, throws, etc.), the pattern variable is in scope after it:

```java
static boolean bigEnoughRect(Shape s) {
    if (!(s instanceof Rectangle r)) {
        return false;   // exits if NOT a Rectangle
    }
    // r is in scope here — we know s is a Rectangle
    return r.length() > 5;
}
```

### With `&&` (allowed)

```java
if (s instanceof Rectangle r && r.length() > 5) {
    // r is in scope in the right-hand side of &&
    // because && short-circuits: right side only runs when left is true
}
```

### With `||` (not allowed)

```java
if (s instanceof Rectangle r || r.length() > 0) { // compile error
    // r could be unbound when instanceof is false
}
```

---

## Pattern Variables vs Local Variables

Pattern variables follow normal shadowing rules — a pattern variable can shadow a field but not a local variable of the same name in scope:

```java
Object obj = "hello";
String s = "world";

if (obj instanceof String s) { // compile error: s already declared
    System.out.println(s);
}
```

---

## Combining with switch (Java 21)

Pattern matching in `instanceof` pairs naturally with pattern matching in `switch` (also finalized in Java 21):

```java
// instanceof style
static String describe(Object obj) {
    if (obj instanceof Integer i) return "int: " + i;
    if (obj instanceof String s)  return "str: " + s;
    return "other";
}

// switch style (more concise for multiple types)
static String describe(Object obj) {
    return switch (obj) {
        case Integer i -> "int: " + i;
        case String s  -> "str: " + s;
        default        -> "other";
    };
}
```

Use `instanceof` for simple one-off checks; prefer `switch` when testing against multiple types.

---

## Key Rules to Remember

- The pattern variable is bound **only** when `instanceof` returns `true`
- Works with any reference type (classes, interfaces, records, enums, arrays)
- `null` never matches any pattern — `null instanceof X` is always `false`
- The compiler enforces scope — using a pattern variable outside its scope is a compile-time error
- No explicit cast needed — the pattern variable is already the narrowed type


---

## References

- [Oracle Docs — Pattern Matching for the instanceof Operator (Java 21)](https://docs.oracle.com/en/java/javase/21/language/pattern-matching-instanceof-operator.html)
- [JEP 394: Pattern Matching for instanceof](https://openjdk.org/jeps/394)
