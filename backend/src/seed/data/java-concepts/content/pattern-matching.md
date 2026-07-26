---
version: 1.0
updatedAt: 2026-07-26
---
## Objective

Understand pattern matching: a `pattern` is a test performed on a value (the `target`) that, when it matches, both confirms the value's shape and extracts data from it into pattern variables — replacing the old "check the type, then cast" idiom with a single expression.

## Use Cases

- Replacing `instanceof` + explicit cast with a single `instanceof` pattern that both checks and binds the variable.
- Branching over a type hierarchy (e.g., a sealed `Shape`) with `switch` pattern labels instead of a chain of `if`/`else instanceof`.
- Destructuring a `record` directly in an `instanceof` or `case` label, pulling out its components without calling each accessor manually.
- Adding extra conditions to a case with `when` guards, without nesting an `if` inside the case body.
- Handling `null` explicitly as its own `case null` label instead of guarding against `NullPointerException` before the `switch`.

## Deep Dive

### instanceof: pattern match vs type comparison

`instanceof` still works as a plain type comparison, but it also acts as the *pattern match operator* when its right operand is a pattern:

```java
if (s instanceof Rectangle r) {
    System.out.println(r.length() * r.width());
}
```

`Rectangle r` here is a **type pattern**: a type plus a single pattern variable. If `s` is a `Rectangle`, the test succeeds and `r` is initialized with `s`, already cast — no separate `(Rectangle) s` needed. If it fails, `r` is simply not in scope.

### Record patterns

A **record pattern** pairs a record type with a pattern list matching its components, so it can deconstruct nested data in one step:

```java
record Point(double x, double y) {}

if (obj instanceof Point(double a, double b)) {
    System.out.println(a + b);
}
```

Record patterns nest, so a record of records can be flattened directly in the pattern:

```java
record Line(Point start, Point end) {}

if (obj instanceof Line(Point(double x1, double y1), Point(double x2, double y2))) {
    System.out.println(Math.hypot(x2 - x1, y2 - y1));
}
```

### Pattern matching with switch

Patterns can appear as `case` labels, turning a chain of `instanceof` checks into a single `switch`:

```java
static double getArea(Shape s) {
    return switch (s) {
        case Rectangle r -> r.length() * r.width();
        case Circle c    -> c.radius() * c.radius() * Math.PI;
        default          -> throw new IllegalArgumentException("Unrecognized shape");
    };
}
```

When `Shape` is `sealed` and every permitted subtype has a case, the compiler verifies exhaustiveness on its own and `default` can be dropped.

### Guarded patterns (when)

A `when` clause attaches a boolean condition to a pattern label; the label only matches if the pattern *and* the guard both hold:

```java
switch (obj) {
    case String s when s.length() == 1 -> System.out.println("Short: " + s);
    case String s                      -> System.out.println(s);
    default                             -> System.out.println("Not a string");
}
```

Guards do not participate in dominance checking the way plain patterns do, so the compiler lets a guarded pattern sit before a constant label that it could also match.

### Handling null explicitly

`switch` used to throw `NullPointerException` on a `null` selector. A pattern `switch` can instead match `null` directly:

```java
switch (obj) {
    case null     -> System.out.println("null!");
    case String s -> System.out.println("String");
    default       -> System.out.println("Something else");
}
```

`null` can only be combined with `default` (`case null, default ->`), never with another pattern label.

### Exhaustiveness with sealed types

Without `sealed`, the compiler can't know every possible subtype, so a pattern `switch` expression without `default` fails to compile:

```java
interface Shape {}
record Circle(double radius) implements Shape {}
record Rectangle(double length, double width) implements Shape {}

static double area(Shape s) {
    return switch (s) {           // error: the switch expression does not cover all possible input values
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.length() * r.width();
    };
}
```

Sealing `Shape` to exactly these two permitted subtypes lets the compiler prove the `switch` is exhaustive, so it compiles with no `default`:

```java
sealed interface Shape permits Circle, Rectangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double length, double width) implements Shape {}

static double area(Shape s) {
    return switch (s) {           // compiles: Circle + Rectangle cover every permitted subtype
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.length() * r.width();
    };
}
```

### MatchException on stale recompilation

Add a third permitted subtype to the sealed hierarchy above:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Triangle(double base, double height) implements Shape {}
```

If `Shape` and `Triangle` are recompiled but the class containing `area(Shape s)` is not, that `.class` file still thinks `Circle`/`Rectangle` are exhaustive. Calling `area(new Triangle(3, 4))` against the stale bytecode compiles fine at the time but throws `MatchException` at runtime — recompiling `area` too turns it back into a compile error demanding a `Triangle` case.

### Pattern variable scope and fall-through

A pattern variable is only in scope for its own label's guard and body. In colon form, falling through *past* a pattern label into the next one is a compile error, because the next label doesn't see the previous one's variable:

```java
switch (obj) {
    case Character c:
        System.out.println("char");
        // falls through
    case Integer i:              // error: variable c is already in scope, control falls through
        System.out.println(i);
}
```

Removing the fall-through (or scoping each case to a `->` arrow, which never falls through) fixes it:

```java
switch (obj) {
    case Character c -> System.out.println("char: " + c);
    case Integer i    -> System.out.println("int: " + i);
    default           -> System.out.println("other");
}
```

## Trade-offs

- **Conciseness vs. familiarity** — pattern matching removes the redundant cast after an `instanceof` check, but reads unfamiliar to developers used to the classic "check then cast" idiom.
- **Exhaustiveness needs sealed types** — `switch` over patterns only skips `default` safely when the target's hierarchy is `sealed`; over a plain interface, a missing `default` is a compile error:

```java
interface Shape {}                     // not sealed
switch (s) {                           // error: not exhaustive, needs default
    case Circle c    -> ...;
    case Rectangle r -> ...;
}
```

- **Recompilation hazard** — if a sealed hierarchy gains a new permitted subtype and only some classes are recompiled, a previously exhaustive `switch` can throw `MatchException` at runtime instead of failing to compile:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {} // Triangle added, area() not recompiled
area(new Triangle(3, 4)); // MatchException at runtime
```

- **Pattern variable scope is narrow** — a variable bound in a `case` label is only in scope for that label's guard and body (or, in colon form, until the end of its statement group), so fall-through past a pattern label is a compile-time error:

```java
case Character c:
    // falls through
case Integer i:   // error: c falls through into this label
```

## Documentation Links

- [Pattern Matching — Java SE 26 Language Guide](https://docs.oracle.com/en/java/javase/26/language/pattern-matching.html) — doc
