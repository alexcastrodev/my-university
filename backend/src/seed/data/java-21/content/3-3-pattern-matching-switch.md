# Pattern Matching for switch

> **JEP 441** — finalized in Java 21. Extends `switch` to work with patterns, `null`, guarded labels, and any reference type as selector.

---

## Why Pattern Matching for switch?

Before Java 21, testing an object against multiple types required chained `instanceof` checks:

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

With pattern matching in `switch`, this becomes:

```java
static double getPerimeter(Shape s) {
    return switch (s) {
        case Rectangle r -> 2 * r.length() + 2 * r.width();
        case Circle c    -> 2 * c.radius() * Math.PI;
        default          -> throw new IllegalArgumentException("Unrecognized shape");
    };
}
```

---

## Selector Expression Types

The selector expression can be any **reference type** or **`int`** (not `long`, `float`, `double`, or `boolean`). Case labels can now be patterns:

```java
record Point(int x, int y) {}
enum Color { RED, GREEN, BLUE }

static void typeTester(Object obj) {
    switch (obj) {
        case null      -> System.out.println("null");
        case String s  -> System.out.println("String");
        case Color c   -> System.out.println("Color with " + c.values().length + " values");
        case Point p   -> System.out.println("Record: " + p);
        case int[] ia  -> System.out.println("int array, length " + ia.length);
        default        -> System.out.println("Something else");
    }
}
```

---

## When Clauses (Guarded Patterns)

Add a boolean condition to a pattern label with `when`:

```java
// Before
static void test(Object obj) {
    switch (obj) {
        case String s:
            if (s.length() == 1) System.out.println("Short: " + s);
            else System.out.println(s);
            break;
        default:
            System.out.println("Not a string");
    }
}

// After
static void test(Object obj) {
    switch (obj) {
        case String s when s.length() == 1 -> System.out.println("Short: " + s);
        case String s                      -> System.out.println(s);
        default                            -> System.out.println("Not a string");
    }
}
```

The pattern variable declared in `p` is in scope inside the `when` expression.

---

## Null Case Labels

Previously, a `null` selector always threw `NullPointerException`. Now you can handle it explicitly:

```java
static void test(Object obj) {
    switch (obj) {
        case null     -> System.out.println("null!");
        case String s -> System.out.println("String");
        default       -> System.out.println("Something else");
    }
}
```

You can combine `null` with `default`, but **not** with other pattern labels:

```java
// VALID
case null, default -> System.out.println("null or other");

// ERROR
case null, String s -> System.out.println(s); // compile-time error
```

> **Note:** Even a `case Object obj` label does **not** match `null` — you must add an explicit `case null`.

---

## Pattern Label Dominance

The compiler rejects case labels that can never match because a previous label always matches first:

```java
// ERROR: String is a subtype of CharSequence
static void error(Object obj) {
    switch (obj) {
        case CharSequence cs -> System.out.println(cs.length());
        case String s        -> System.out.println(s); // dominated!
        default              -> {}
    }
}
```

Guarded labels do **not** dominate constant labels, so constants can follow them:

```java
static void testInteger(Integer value) {
    switch (value) {
        case Integer i when i > 0 -> System.out.println("Positive");
        case 1  -> System.out.println("One");   // OK
        case -1 -> System.out.println("Minus one");
        case Integer i -> System.out.println("Other integer");
    }
}
```

**Best practice:** order labels as constants → guarded patterns → unguarded patterns.

---

## Exhaustiveness

`switch` expressions (and statements with pattern labels) must be **exhaustive** — every possible value must match a label.

```java
// ERROR: not exhaustive
static int bad(Object obj) {
    return switch (obj) {
        case String s  -> s.length();
        case Integer i -> i;
    };
}

// OK: default covers the rest
static int good(Object obj) {
    return switch (obj) {
        case String s  -> s.length();
        case Integer i -> i;
        default        -> 0;
    };
}
```

With sealed classes, the compiler can verify exhaustiveness without `default`:

```java
sealed interface Shape permits Circle, Rectangle {}
record Circle(double r) implements Shape {}
record Rectangle(double w, double h) implements Shape {}

static double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.r() * c.r();
        case Rectangle r -> r.w() * r.h();
        // no default needed — sealed hierarchy is fully covered
    };
}
```

### MatchException at Runtime

If a sealed hierarchy is extended and only some classes are recompiled, the `switch` may be exhaustive at compile time but not at runtime — throwing `MatchException`. **Always recompile all dependent classes** when changing a sealed hierarchy.

---

## Qualified Enum Constants

You can use qualified `enum` constants as case labels when multiple enum types implement the same interface:

```java
sealed interface CardClassification permits Standard, Tarot {}
enum Standard implements CardClassification { SPADE, HEART, DIAMOND, CLUB }
enum Tarot   implements CardClassification { SPADE, HEART, DIAMOND, CLUB, TRUMP, EXCUSE }

static void determineSuit(CardClassification c) {
    switch (c) {
        case Standard.SPADE   -> System.out.println("Spades");
        case Standard.HEART   -> System.out.println("Hearts");
        case Standard.DIAMOND -> System.out.println("Diamonds");
        case Standard.CLUB    -> System.out.println("Clubs");
        case Tarot.SPADE      -> System.out.println("Spades or Piques");
        case Tarot.HEART      -> System.out.println("Hearts or Cœur");
        case Tarot.DIAMOND    -> System.out.println("Diamonds or Carreaux");
        case Tarot.CLUB       -> System.out.println("Clubs or Trefles");
        case Tarot.TRUMP      -> System.out.println("Trumps");
        case Tarot.EXCUSE     -> System.out.println("The Fool");
    }
}
```

---

## Scope of Pattern Variables

A pattern variable declared in a `case` label is in scope in:

1. The `when` clause of that label
2. The expression, block, or `throw` to the right of `->` (arrow form)
3. The statement group of a `case` label (colon form), up to the end of that group

**Fall-through is a compile-time error** when a pattern variable would be uninitialized:

```java
// ERROR
switch (obj) {
    case Character c:
        System.out.println("char");
    case Integer i:             // compile-time error — c falls through here
        System.out.println(i);
}
```

---

## Record Patterns inside switch

Record patterns can be nested inside `switch` case labels:

```java
record Point(double x, double y) {}
record ColoredPoint(Point p, Color c) {}

static void print(Object obj) {
    switch (obj) {
        case Point(var x, var y)                -> System.out.println(x + ", " + y);
        case ColoredPoint(Point(var x, var y), var color) -> System.out.println(color + ": " + x);
        default                                 -> System.out.println("other");
    }
}
```

See the **Record Patterns** lesson for the full deconstruction syntax.


---

## References

- [Oracle Docs — Pattern Matching for switch (Java 21)](https://docs.oracle.com/en/java/javase/21/language/pattern-matching-switch.html)
- [JEP 441: Pattern Matching for switch](https://openjdk.org/jeps/441)
