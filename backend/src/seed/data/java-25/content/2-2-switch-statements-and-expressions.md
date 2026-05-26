---
version: 1.0
updatedAt: 2026-05-26
---
# switch Statements and Expressions

---

## Overview

Java has two forms of `switch`:

| Form | Introduced | Returns a value? |
|------|-----------|-----------------|
| `switch` statement | Java 1.0 | No |
| `switch` expression | Java 14 (final) | Yes |

Both support the traditional colon (`:`) syntax and the newer arrow (`->`) syntax.

---

## switch Statement — Colon Syntax

```java
int day = 3;

switch (day) {
    case 1:
        System.out.println("Monday");
        break;
    case 2:
        System.out.println("Tuesday");
        break;
    case 3:
        System.out.println("Wednesday");
        break;
    default:
        System.out.println("Other");
}
```

**Fall-through:** Without `break`, execution continues into the next case.

```java
switch (day) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
        System.out.println("Weekday");
        break;
    case 6:
    case 7:
        System.out.println("Weekend");
}
```

---

## switch Statement — Arrow Syntax

Arrow cases do **not** fall through:

```java
switch (day) {
    case 1 -> System.out.println("Monday");
    case 2 -> System.out.println("Tuesday");
    case 3 -> System.out.println("Wednesday");
    default -> System.out.println("Other");
}
```

Multiple labels per arrow case:

```java
switch (day) {
    case 1, 2, 3, 4, 5 -> System.out.println("Weekday");
    case 6, 7           -> System.out.println("Weekend");
}
```

---

## switch Expression — Arrow Syntax

A `switch` expression produces a value and must be exhaustive (all possible values covered):

```java
String name = switch (day) {
    case 1 -> "Monday";
    case 2 -> "Tuesday";
    case 3 -> "Wednesday";
    case 4 -> "Thursday";
    case 5 -> "Friday";
    case 6 -> "Saturday";
    case 7 -> "Sunday";
    default -> throw new IllegalArgumentException("Invalid day: " + day);
};
```

---

## switch Expression — Colon Syntax with yield

Use `yield` to return a value from a colon-style `switch` expression block:

```java
int numLetters = switch (day) {
    case 1, 2, 3, 4, 5, 6 -> day + 5;  // simple arrow
    case 7 -> {
        System.out.println("Computing Sunday...");
        yield 6;  // yield required in a block
    }
    default -> 0;
};
```

> **`yield` vs `return`:** `yield` exits the `switch` block with a value; `return` exits the enclosing method.

---

## Allowed Selector Types

| Type | Allowed in switch |
|------|------------------|
| `byte`, `short`, `int`, `char` | Yes |
| `Byte`, `Short`, `Integer`, `Character` | Yes |
| `String` | Yes (since Java 7) |
| `enum` | Yes |
| `long`, `float`, `double`, `boolean` | **No** |
| Any reference type (patterns) | Yes (since Java 21) |

---

## Exhaustiveness

- A `switch` **statement** does not need to be exhaustive — missing cases are simply skipped.
- A `switch` **expression** must be exhaustive — the compiler enforces this. Use `default` or cover all enum constants.

---

## Key Rules Summary

| Concept | Colon syntax | Arrow syntax |
|---------|-------------|--------------|
| Fall-through | Yes | No |
| Multiple labels | `case 1: case 2:` | `case 1, 2 ->` |
| Value from block | `yield` | `yield` |
| Break needed? | Yes (to stop fall-through) | No |
