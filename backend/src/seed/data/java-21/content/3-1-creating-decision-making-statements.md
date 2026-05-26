# Creating Decision-Making Statements

> Decision-making statements control which code paths execute at runtime. Java provides `if`, `if/else`, and `if/else if/else` chains as the foundational building blocks for branching logic.

---

## The if Statement

An `if` statement executes a block only when its boolean expression evaluates to `true`:

```java
int score = 85;

if (score >= 60) {
    System.out.println("Passed");
}
```

The condition must be a `boolean` or `Boolean` expression — unlike C or C++, an integer is **not** valid:

```java
int x = 1;
if (x) { }   // compile-time error: incompatible types
```

---

## The if/else Statement

An `else` clause runs when the condition is `false`:

```java
int temperature = 18;

if (temperature >= 20) {
    System.out.println("Warm day");
} else {
    System.out.println("Cool day");
}
```

Exactly one branch executes — never both, never neither.

---

## The if/else if/else Chain

Multiple conditions can be chained together. Java evaluates them top-to-bottom and executes the **first** branch whose condition is `true`:

```java
int score = 72;

if (score >= 90) {
    System.out.println("A");
} else if (score >= 80) {
    System.out.println("B");
} else if (score >= 70) {
    System.out.println("C");
} else {
    System.out.println("F");
}
// Output: C
```

The trailing `else` is optional but acts as a catch-all for values that match no preceding condition.

---

## Nested if Statements

An `if` can appear inside another `if` or `else` block:

```java
boolean isLoggedIn = true;
boolean isAdmin = false;

if (isLoggedIn) {
    if (isAdmin) {
        System.out.println("Admin dashboard");
    } else {
        System.out.println("User dashboard");
    }
} else {
    System.out.println("Login required");
}
```

Deep nesting quickly becomes hard to read. Prefer early returns or pattern matching where appropriate.

---

## Comparison: Statement Forms

| Form | When to use |
|---|---|
| `if` | Single optional action |
| `if/else` | Binary choice — one of two paths |
| `if/else if/else` | Three or more mutually exclusive conditions |
| Nested `if` | Conditions that depend on an outer condition being true |

---

## Common Pitfall: Missing Braces

Without braces, only the **single next statement** belongs to the `if` or `else`:

```java
int x = 5;

if (x > 3)
    System.out.println("Greater");   // inside the if
    System.out.println("Always");    // ALWAYS runs — NOT part of the if
```

This compiles without error but is a frequent source of bugs. The OCP exam tests this directly.

### The Dangling else Problem

When braces are omitted, an `else` binds to the **nearest preceding** `if`:

```java
int x = 10;
int y = 5;

if (x > 5)
    if (y > 10)
        System.out.println("Both");
else
    System.out.println("Else");   // belongs to: if (y > 10), NOT if (x > 5)
```

Adding braces makes the intent explicit and eliminates ambiguity:

```java
if (x > 5) {
    if (y > 10) {
        System.out.println("Both");
    }
} else {
    System.out.println("Else");   // now clearly belongs to if (x > 5)
}
```

> **Best practice:** always use braces, even for single-statement bodies.

---

## Common Pitfall: Assignment Inside Condition

A classic typo replaces `==` with `=`, which produces a compile-time error in Java for primitive boolean contexts:

```java
boolean active = false;

if (active = true) {   // assigns true, then evaluates as true — compiles!
    System.out.println("This always runs");
}
```

Java does allow assignment inside a boolean condition (unlike C, it produces a `boolean` result only when the assigned type is `boolean`). The compiler will warn but not always reject it. Use `==` for comparisons.

---

## Ternary Operator as a Compact Alternative

For simple value selection, the ternary operator `? :` replaces an `if/else`:

```java
int age = 20;
String status = (age >= 18) ? "adult" : "minor";
System.out.println(status);  // adult
```

The ternary is an **expression** (it produces a value), not a statement. Do not use it for complex logic — keep it for concise value assignments.

---

## Key Rules to Remember

- The condition of an `if` must be a `boolean` expression
- Only the first matching branch in an `if/else if` chain executes
- An `else` binds to the nearest unmatched `if` when braces are omitted
- Single-statement bodies without braces are legal but error-prone
- `null` assigned to a `Boolean` parameter and unboxed causes `NullPointerException`

---

## References

- [Oracle Docs — The if-then and if-then-else Statements (Java 21)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/if.html)
- [Java Language Specification — §14.9 The if Statement](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.9)
