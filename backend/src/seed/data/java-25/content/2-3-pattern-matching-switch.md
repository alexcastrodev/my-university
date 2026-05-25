# Pattern Matching in switch

## Overview

A `switch` statement transfers control to one of several statements or expressions, depending on the value of its selector expression. In earlier releases, the selector expression had to evaluate to a number, string, or `enum` constant, and case labels had to be constants.

**In Java 25 (JEP 441 + JEP 507):**
- The selector expression can be any reference type, `int`, or primitive type (including `long`, `float`, `double`)
- `case` labels can have patterns
- A `switch` statement or expression can test whether its selector expression matches a pattern, offering more flexibility and expressiveness
- Primitive type patterns in `switch` are a preview feature (JEP 507)

---

## Converting instanceof Chains to Pattern Switch

**Before — using instanceof chain:**

```java
interface Shape { }
record Rectangle(double length, double width) implements Shape { }
record Circle(double radius) implements Shape { }

public static double getPerimeter(Shape s) throws IllegalArgumentException {
    if (s instanceof Rectangle r) {
        return 2 * r.length() + 2 * r.width();
    } else if (s instanceof Circle c) {
        return 2 * c.radius() * Math.PI;
    } else {
        throw new IllegalArgumentException("Unrecognized shape");
    }
}
```

**After — using switch expression:**

```java
public static double getPerimeter(Shape s) throws IllegalArgumentException {
    return switch (s) {
        case Rectangle r -> 2 * r.length() + 2 * r.width();
        case Circle c    -> 2 * c.radius() * Math.PI;
        default          -> throw new IllegalArgumentException("Unrecognized shape");
    };
}
```

**Or using switch statement (colon labels):**

```java
public static double getPerimeter(Shape s) throws IllegalArgumentException {
    switch (s) {
        case Rectangle r: return 2 * r.length() + 2 * r.width();
        case Circle c:    return 2 * c.radius() * Math.PI;
        default:          throw new IllegalArgumentException("Unrecognized shape");
    }
}
```

---

## Selector Expression Type

The selector expression can be any reference type or a primitive type:

```java
record Point(int x, int y) { }
enum Color { RED, GREEN, BLUE; }

static void typeTester(Object obj) {
    switch (obj) {
        case null     -> System.out.println("null");
        case String s -> System.out.println("String");
        case Color c  -> System.out.println("Color with " + c.values().length + " values");
        case Point p  -> System.out.println("Record class: " + p.toString());
        case int[] ia -> System.out.println("Array of int values of length " + ia.length);
        default       -> System.out.println("Something else");
    }
}
```

---

## When Clauses (Guarded Patterns)

Add a boolean condition to a pattern label using a `when` clause:

```java
static void test(Object obj) {
    switch (obj) {
        case String s when s.length() == 1 -> System.out.println("Short: " + s);
        case String s                      -> System.out.println(s);
        default                            -> System.out.println("Not a string");
    }
}
```

A value matches a guarded pattern label if it:
1. Matches the pattern type, **and**
2. The `when` expression evaluates to `true`

The scope of the pattern variable includes the `when` guard expression.

**With record patterns:**

```java
record R(int x) { }

static void testSwitch(R r) {
    switch (r) {
        case R(int x) when x >= 5 -> System.out.println(x + " => 5");
        default                   -> System.out.println(r.x() + " < 5");
    }
}
```

---

## Primitive Type Patterns (Preview — JEP 507)

Java 25 introduces primitive type patterns in `switch` as a preview feature. The selector expression can be a primitive type such as `double` or `long`, and case labels can contain primitive type patterns with `when` guards.

```java
String doubleToRating(double rating) {
    return switch (rating) {
        case 0d                                    -> "0 stars";
        case double d when d > 0d && d < 2.5d     -> d + " is not good";
        case double d when d >= 2.5d && d < 5d    -> d + " is better";
        case 5d                                    -> "5 stars";
        default                                    -> "Invalid rating";
    };
}
```

```java
void bigNumbers(long v) {
    switch (v) {
        case long x when x < 1_000_000L            -> System.out.println("Less than a million");
        case long x when x < 1_000_000_000L        -> System.out.println("Less than a billion");
        case long x when x < 1_000_000_000_000L    -> System.out.println("Less than a trillion");
        case long x when x < 1_000_000_000_000_000L -> System.out.println("Less than a quadrillion");
        default                                    -> System.out.println("At least a quadrillion");
    }
}
```

> **Note:** Requires `--enable-preview` flag to compile and run.

---

## Qualified enum Constants as case Labels

When multiple `enum` types implement the same interface, you can use qualified names to distinguish them:

```java
sealed interface CardClassification permits Standard, Tarot {}
public enum Standard implements CardClassification { SPADE, HEART, DIAMOND, CLUB }
public enum Tarot implements CardClassification   { SPADE, HEART, DIAMOND, CLUB, TRUMP, EXCUSE }

static void determineSuit(CardClassification c) {
    switch (c) {
        case Standard.SPADE   -> System.out.println("Spades");
        case Standard.HEART   -> System.out.println("Hearts");
        case Standard.DIAMOND -> System.out.println("Diamonds");
        case Standard.CLUB    -> System.out.println("Clubs");
        case Tarot.SPADE      -> System.out.println("Spades or Piques");
        case Tarot.HEART      -> System.out.println("Hearts or Cœur");
        case Tarot.DIAMOND    -> System.out.println("Diamonds or Carreaux");
        case Tarot.CLUB       -> System.out.println("Clubs or Trèfles");
        case Tarot.TRUMP      -> System.out.println("Trumps or Atouts");
        case Tarot.EXCUSE     -> System.out.println("The Fool or L'Excuse");
    }
}
```

---

## Pattern Label Dominance

Labels are tested in the order they appear. The compiler raises an **error** if a pattern label can never match because a preceding label always matches first.

**Compile-time error — String dominated by CharSequence:**

```java
static void error(Object obj) {
    switch (obj) {
        case CharSequence cs ->
            System.out.println("A sequence of length " + cs.length());
        case String s ->          // ERROR: dominated by preceding case label
            System.out.println("A string: " + s);
        default -> { break; }
    }
}
```

**Compile-time error — constants dominated by a type pattern:**

```java
static void error2(Integer value) {
    switch (value) {
        case Integer i ->
            System.out.println("Integer: " + i);
        case -1, 1 ->             // ERROR: dominated by preceding case label
            System.out.println("The number 42");
        default -> { break; }
    }
}
```

**Guarded patterns do NOT dominate constant labels**, so the correct ordering is:

```java
static void testIntegerBetter(Integer value) {
    switch (value) {
        case 1                    -> System.out.println("Value is 1");
        case -1                   -> System.out.println("Value is -1");
        case Integer i when i > 0 -> System.out.println("Positive integer");
        case Integer i            -> System.out.println("An integer");
    }
}
```

> **Best practice:** order labels as: constant labels → guarded pattern labels → non-guarded pattern labels.

---

## Exhaustiveness

Switch blocks that use pattern or `null` labels must be **exhaustive** — every possible value must have a matching label.

**Not exhaustive (compile-time error):**

```java
static int coverage(Object obj) {
    return switch (obj) {    // ERROR: not exhaustive
        case String s  -> s.length();
        case Integer i -> i;
    };
}
```

**Exhaustive with `default`:**

```java
static int coverage(Object obj) {
    return switch (obj) {
        case String s  -> s.length();
        case Integer i -> i;
        default        -> 0;
    };
}
```

**Exhaustive with sealed classes — no `default` needed:**

```java
sealed interface S permits A, B, C { }
final class A implements S { }
final class B implements S { }
record C(int i) implements S { }

static int testSealedCoverage(S s) {
    return switch (s) {
        case A a -> 1;
        case B b -> 2;
        case C c -> 3;
    };
}
```

**Generic sealed classes:**

```java
sealed interface I<T> permits A, B {}
final class A<X> implements I<String> {}
final class B<Y> implements I<Y> {}

static int testGenericSealedExhaustive(I<Integer> i) {
    return switch (i) {
        case B<Integer> bi -> 42;  // exhaustive: no A<Integer> is possible
    };
}
```

> **MatchException:** If the switch is exhaustive at compile time but not at runtime (e.g., sealed hierarchy changed without recompiling), a `MatchException` is thrown. Recompile the class containing the switch.

---

## Type Argument Inference in Record Patterns

The compiler infers type arguments for generic record patterns:

```java
record MyPair<T, U>(T x, U y) { }

static void recordInference(MyPair<String, Integer> p) {
    switch (p) {
        case MyPair(var s, var i) ->   // inferred: MyPair<String, Integer>(String s, Integer i)
            System.out.println(s + ", #" + i);
    }
}
```

---

## Scope of Pattern Variables

A pattern variable declared in a `case` label is in scope for:

**1. The `when` clause:**

```java
static void test(Object obj) {
    switch (obj) {
        case Character c when c.charValue() == 7:
            System.out.println("Ding!");
            break;
        default:
            break;
    }
}
```

**2. The expression, block, or throw statement after the arrow:**

```java
static void test(Object obj) {
    switch (obj) {
        case Character c -> {
            if (c.charValue() == 7) System.out.println("Ding!");
            System.out.println("Character, value " + c.charValue());
        }
        case Integer i -> System.out.println("Integer: " + i);
        default        -> { break; }
    }
}
```

**3. The statement group of a colon-label case:**

```java
static void test(Object obj) {
    switch (obj) {
        case Character c:
            if (c.charValue() == 7) System.out.print("Ding ");
            if (c.charValue() == 9) System.out.print("Tab ");
            System.out.println("character, value " + c.charValue());
        default:
            break;
    }
}
```

**Fall-through is NOT allowed across a case that declares a pattern variable:**

```java
static void test(Object obj) {
    switch (obj) {
        case Character c:
            System.out.println("character");
        case Integer i:            // COMPILE-TIME ERROR
            System.out.println("An integer " + i);
        default:
            System.out.println("Neither character nor integer");
    }
}
```

---

## null case Labels

Previously, `switch` threw `NullPointerException` if the selector was `null`. Now you can handle it explicitly:

```java
static void test(Object obj) {
    switch (obj) {
        case null     -> System.out.println("null!");
        case String s -> System.out.println("String");
        default       -> System.out.println("Something else");
    }
}
```

**Rules for `null` labels:**

| Combination | Allowed? |
|---|---|
| `case null, String s` | No — compile-time error |
| `case null, default` | Yes |
| No `null` label, selector is `null` | `NullPointerException` thrown |

```java
// OK: combining null with default
static void testStringOrNull(Object obj) {
    switch (obj) {
        case String s      -> System.out.println("String: " + s);
        case null, default -> System.out.println("null or not a string");
    }
}
```

```java
// NPE: no null label, selector is null
String s = null;
switch (s) {
    case Object obj -> System.out.println("This doesn't match null");
    // NullPointerException is thrown
}
```

---

## Feature Summary

| Feature | Status |
|---|---|
| Type patterns in `switch` | Standard (JEP 441) |
| Guarded patterns (`when`) | Standard |
| Record pattern destructuring | Standard |
| Qualified `enum` constants | Standard |
| `null` case labels | Standard |
| Dominance checking | Standard |
| Fall-through prevention with pattern variables | Standard |
| Primitive type patterns (`long`, `float`, `double`) | Preview (JEP 507) |
