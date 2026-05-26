---
version: 1.0
updatedAt: 2026-05-26
---
# Pattern Matching for switch

> **JEP 441** — finalized in Java 21, available in Java 25. The selector expression can be any reference or primitive type; case labels can have patterns.

---

## Motivation

Before pattern matching in `switch`, testing an object against multiple types required chained `instanceof` checks:

```java
interface Shape { }
record Rectangle(double length, double width) implements Shape { }
record Circle(double radius) implements Shape { }

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

With pattern matching in `switch`:

```java
// switch expression
static double getPerimeter(Shape s) {
    return switch (s) {
        case Rectangle r -> 2 * r.length() + 2 * r.width();
        case Circle c    -> 2 * c.radius() * Math.PI;
        default          -> throw new IllegalArgumentException("Unrecognized shape");
    };
}

// switch statement
static double getPerimeter(Shape s) {
    switch (s) {
        case Rectangle r: return 2 * r.length() + 2 * r.width();
        case Circle c:    return 2 * c.radius() * Math.PI;
        default:          throw new IllegalArgumentException("Unrecognized shape");
    }
}
```

---

## When Clauses (Guarded Patterns)

A `when` clause adds a boolean condition to a pattern label. A value matches only if both the pattern and the guard are true:

```java
static void test(Object obj) {
    switch (obj) {
        case String s when s.length() == 1 -> System.out.println("Short: " + s);
        case String s                      -> System.out.println(s);
        default                            -> System.out.println("Not a string");
    }
}
```

With record patterns and guards:

```java
record R(int x) { }

static void testSwitch(R r) {
    switch (r) {
        case R(int x) when x >= 5 -> System.out.println(x + " => 5");
        default                   -> System.out.println(r.x() + " < 5");
    }
}
```

With primitive types (preview in Java 25):

```java
String doubleToRating(double rating) {
    return switch (rating) {
        case 0d -> "0 stars";
        case double d when d > 0d && d < 2.5d -> d + " is not good";
        case double d when d >= 2.5f && d < 5d -> d + " is better";
        case 5d -> "5 stars";
        default -> "Invalid rating";
    };
}
```

---

## Pattern Label Dominance

Labels are tested in order. The compiler errors if a label can never match because a prior label always matches first:

```java
// ERROR: String is subtype of CharSequence
static void error(Object obj) {
    switch (obj) {
        case CharSequence cs -> System.out.println(cs.length());
        case String s        -> System.out.println(s); // dominated
        default              -> {}
    }
}

// ERROR: pattern dominates constant
static void error2(Integer value) {
    switch (value) {
        case Integer i   -> System.out.println(i);
        case -1, 1       -> System.out.println("number"); // dominated
        default          -> {}
    }
}
```

Guarded patterns do **not** dominate constant labels — dominance is undecidable for guards:

```java
static void testInteger(Integer value) {
    switch (value) {
        case Integer i when i > 0 -> System.out.println("Positive");
        case 1                    -> System.out.println("One");   // OK
        case -1                   -> System.out.println("Minus one");
        case Integer i            -> System.out.println("Other integer");
    }
}
```

**Best practice:** constants → guarded patterns → unguarded patterns.

---

## Null Case Labels

`switch` used to throw `NullPointerException` for `null` selectors. Now you can handle `null` explicitly:

```java
static void test(Object obj) {
    switch (obj) {
        case null     -> System.out.println("null!");
        case String s -> System.out.println("String");
        default       -> System.out.println("Something else");
    }
}
```

`null` can only be combined with `default`, not with other pattern labels:

```java
// VALID
case null, default -> System.out.println("null or other");

// ERROR
case null, String s -> System.out.println(s);
```

> **Note:** Even `case Object obj` does not match `null` — an explicit `case null` is required.

---

## Exhaustiveness

`switch` expressions (and statements with pattern labels) must cover all possible values:

```java
// ERROR: not exhaustive
static int bad(Object obj) {
    return switch (obj) {
        case String s  -> s.length();
        case Integer i -> i;
    };
}

// OK
static int good(Object obj) {
    return switch (obj) {
        case String s  -> s.length();
        case Integer i -> i;
        default        -> 0;
    };
}
```

With sealed classes, exhaustiveness is verified without `default`:

```java
sealed interface Shape permits Circle, Rectangle {}

static double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.length() * r.width();
    };
}
```

If a sealed hierarchy is extended and only some classes are recompiled, a `MatchException` is thrown at runtime. Always recompile all dependent classes.

---

## Scope of Pattern Variables

A pattern variable is in scope in:
1. The `when` clause of its case label
2. The expression/block/`throw` after `->` (arrow form)
3. The statement group of a `case` label (colon form), up to the end of that group

Fall-through **past** a pattern label is a compile-time error:

```java
// ERROR
switch (obj) {
    case Character c:
        System.out.println("char");
    case Integer i:   // compile error: c falls through here
        System.out.println(i);
}
```

---

## References

- [Oracle Docs — Pattern Matching for switch (Java 25)](https://docs.oracle.com/en/java/javase/25/language/pattern-matching-switch.html)
- [JEP 441: Pattern Matching for switch](https://openjdk.org/jeps/441)
