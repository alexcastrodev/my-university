---
version: 1.0
updatedAt: 2026-05-26
---
# if/else Statements

---

## Syntax

```java
if (condition) {
    // executes when condition is true
} else if (anotherCondition) {
    // executes when anotherCondition is true
} else {
    // executes when all conditions are false
}
```

The condition must be a `boolean` expression — Java does not allow numeric values as conditions (unlike C/C++).

---

## Single-statement Body

Braces are optional when the body is a single statement:

```java
if (score >= 60)
    System.out.println("Pass");
else
    System.out.println("Fail");
```

> **Exam tip:** Always trace which `else` belongs to which `if`. An `else` matches the nearest preceding unmatched `if`.

---

## Dangling else

```java
int x = 1;
if (x > 0)
    if (x > 5)
        System.out.println("big");
    else
        System.out.println("small");  // belongs to (x > 5), not (x > 0)
```

---

## Ternary Operator

A condensed `if/else` that produces a value:

```java
String result = (score >= 60) ? "Pass" : "Fail";
```

Both branches must be compatible types. The ternary is an expression, not a statement — it cannot stand alone without being assigned or used.

---

## switch as an Alternative

When testing a single variable against many constant values, `switch` is often clearer than chained `if/else if`. See lesson 2-2 for details.

---

## Key Rules

| Rule | Detail |
|------|--------|
| Condition type | Must be `boolean` or `Boolean` |
| `else if` | Shorthand for `else { if (...) { } }` — not a keyword |
| Braces | Required only for multi-statement bodies, but always recommended |
| Reachability | Code after an unconditional `return`/`throw` in all branches is unreachable |

---

## Quick Example

```java
int temperature = 72;

if (temperature < 32) {
    System.out.println("Freezing");
} else if (temperature < 60) {
    System.out.println("Cold");
} else if (temperature < 80) {
    System.out.println("Comfortable");
} else {
    System.out.println("Hot");
}
// Output: Comfortable
```
