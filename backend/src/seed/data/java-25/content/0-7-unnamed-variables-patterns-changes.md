---
version: 1.0
updatedAt: 2026-05-28
---
# Unnamed Variables and Patterns — the `_` Keyword (JEP 456)

> **JEP 456** — finalized in Java 22. Post-dates OCP 21, so it IS testable on 1Z0-831.
> `_` (a single underscore) is now a **reserved keyword**, not an identifier. It denotes a variable or pattern whose name and value are intentionally ignored.

---

## Why

Before Java 22, you had to invent throwaway names (`ignored`, `unused`, `e`) for variables you never read. The compiler could not distinguish "I forgot to use this" from "I deliberately do not care". `_` makes that intent explicit and silences unused-variable warnings.

---

## Quick Reference — Where `_` is Allowed

| Context | Allowed? | Example |
|---------|----------|---------|
| Local variable declaration | yes | `var _ = computeSideEffect();` |
| `catch` parameter | yes | `catch (IOException _) { ... }` |
| Lambda parameter | yes | `(k, _) -> k.toUpperCase()` |
| `for-each` loop variable | yes | `for (var _ : list) counter++;` |
| Traditional `for` loop init | yes | `for (int _ = init(); cond; ...)` |
| `try-with-resources` | yes | `try (var _ = lock.acquire()) { ... }` |
| Record pattern component | yes | `case Point(int x, _) -> x;` |
| Type pattern in `switch` / `instanceof` | yes | `case Integer _ -> "int";` |
| Field declaration | **no** | `class C { int _; }` is illegal |
| Method parameter (non-lambda) | **no** | `void m(int _)` is illegal |
| Return type position | n/a | `_` is never a type |
| Variable name in expression | **no** | `_ = 1;` after declaration — cannot read `_` |

You can declare **multiple** `_` in the same scope without a redeclaration error — each is a fresh unnamed binding.

---

## Use Cases

### 1. Ignored exception in `catch`

```java
try {
    return Integer.parseInt(s);
} catch (NumberFormatException _) {
    return 0;
}
```

### 2. Ignoring a lambda argument

```java
map.forEach((key, _) -> System.out.println(key));

BiFunction<String, Integer, String> f = (s, _) -> s.toUpperCase();
```

### 3. Side-effect-only loop

```java
int total = 0;
for (var _ : items) {
    total++;
}
```

### 4. Deconstructing a record while ignoring components

```java
record Point(int x, int y) {}
record Line(Point from, Point to) {}

Object obj = new Line(new Point(0, 0), new Point(3, 4));

if (obj instanceof Line(Point(int x1, _), Point(int x2, _))) {
    System.out.println(x2 - x1);   // ignore y coordinates
}
```

Nested unnamed patterns scale gracefully when you only need a slice of a deep record.

### 5. Exhaustiveness in `switch` via `case _`

`case _` matches any value that earlier cases did not, including `null` when paired with `case null`. It is the **pattern-level default**.

```java
sealed interface Shape permits Circle, Square, Triangle {}
record Circle(double r) {}
record Square(double s) {}
record Triangle(double a, double b, double c) {}

String describe(Shape shape) {
    return switch (shape) {
        case Circle c    -> "round, r=" + c.r();
        case Square _    -> "square";   // bind to nothing
        case _           -> "other";    // pattern default
    };
}
```

Differences from `default`:

| | `default` | `case _` |
|---|-----------|----------|
| Allowed in classic switch statement | yes | yes |
| Allowed in switch expression with patterns | yes | yes |
| Position in source | anywhere | any case slot |
| Binds a name | no | no |
| Reads as a *pattern* | no | yes — composes with record patterns |

### 6. `try-with-resources` for guard-style resources

```java
try (var _ = lock.lock()) {
    mutateSharedState();
}
```

The `AutoCloseable` is still closed at end of block; you simply do not need a handle inside it.

---

## Interaction with `var`

`var _` is the idiomatic way to keep an expression's **side effects** without naming the result.

```java
var _ = registry.register(listener);  // run the call, discard the receipt
```

This is shorter than `Object ignored = registry.register(listener);` and the compiler will not warn about unused locals.

You cannot write `_ = expr;` as an assignment expression — `_` is not a readable or writable name; it can only appear as a *declaration* or *pattern*.

---

## Migration Tip — what changed since Java 21

| Java version | Status of `_` |
|--------------|---------------|
| 8 | Legal identifier |
| 9 | Identifier, but **warning** when used as a name |
| 10 | Same (warning) |
| 11 | **Error** to use `_` as a parameter name; reserved as an identifier elsewhere |
| 21 | Still error to declare `_` as a name; no special meaning |
| 22+ | `_` is a **reserved keyword** denoting an unnamed variable / pattern |

If you used `_` as a placeholder identifier in old code (rare, but it happens in test fixtures and BiFunction lambdas where you had to name both params), the Java 22 compiler now **reinterprets** it as an unnamed binding. Code that wrote `_.toString()` would have been illegal since Java 11; code that wrote `(k, _) -> k` keeps working but with new semantics — the second parameter is unnamed rather than just unused.

---

## Edge Cases the Exam Loves

1. **Two unnamed locals in the same scope** — legal:
   ```java
   var _ = a();
   var _ = b();   // OK, not a duplicate declaration
   ```
2. **Reading `_`** — never legal. `_` has no value:
   ```java
   var _ = 42;
   System.out.println(_);   // compile error
   ```
3. **`_` as a type name** — never legal; `_` is not a type.
4. **Mixed with named bindings in a record pattern**:
   ```java
   case Point(var x, _) -> x;     // OK
   case Point(_, var y) -> y;     // OK
   case Point(_, _)    -> 0;      // OK — equivalent to "any Point"
   ```
5. **`catch (Exception _ | IOException _)`** — multi-catch with unnamed binding works.

---

## See also

- [[3-5-encapsulation-immutability-var-unnamed-variables]] — `var` and the unnamed-variable companion lesson
- [[2-3-pattern-matching-switch]] — pattern matching where `case _` shines
- [[4-1-try-catch-finally]] — unnamed catch parameters
- JEP 456 — https://openjdk.org/jeps/456
- JLS §14 (Blocks and Statements) — https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html

---

## Rules Recap

| Rule | Detail |
|------|--------|
| `_` is a keyword | Cannot be used as an identifier anywhere |
| Declaration-only | `_` can be declared but never read |
| Multiple `_` per scope | No duplicate-declaration error |
| Lambda params | `_` allowed; mix with named params freely |
| Patterns | `case _` is the pattern-level default; nests inside record patterns |
| Fields and method params | Not allowed — `_` is local- and pattern-scoped |
| `var _ = expr` | Idiomatic side-effect discard |
