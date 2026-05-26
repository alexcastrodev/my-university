# Making Decisions with the Ternary Operator

> **OCP Exam Topic** — Understand the ternary operator syntax, type compatibility rules, nested ternary expressions, and common exam traps. Covered in Chapter 2 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is the Ternary Operator?

The **ternary operator** (also called the conditional operator) is the only Java operator that takes three operands. It evaluates a boolean condition and returns one of two expressions depending on the result.

**Syntax:**

```
condition ? expression1 : expression2
```

- `condition` — any expression that evaluates to `boolean` or `Boolean`.
- `expression1` — returned when the condition is `true`.
- `expression2` — returned when the condition is `false`.

```java
int x = 10;
String result = (x > 5) ? "big" : "small";
System.out.println(result);  // big
```

---

## Ternary as a Replacement for `if`/`else`

The ternary operator is often used to replace a simple `if`/`else` assignment:

```java
// if/else version
int abs;
if (x < 0) {
    abs = -x;
} else {
    abs = x;
}

// ternary version
int abs = (x < 0) ? -x : x;
```

Both are equivalent. The ternary is more concise and can be embedded inside larger expressions.

---

## Type Compatibility Rules

The compiler must be able to determine a single type for the whole ternary expression. The rules follow Java's type promotion:

### Both operands are the same type

The result type is that type.

```java
int a = 1, b = 2;
int max = (a > b) ? a : b;   // both int → result is int
```

### Numeric operands of different types

The result is promoted to the wider type.

```java
int i = 5;
double d = 2.5;
double result = (i > 3) ? i : d;   // int promoted to double → result is double
System.out.println(result);         // 5.0
```

### One operand is `null`

If one branch is `null`, the result type is the type of the other branch (must be a reference type).

```java
String s = null;
String r = (true) ? s : "default";   // result type is String
```

### Incompatible types

If the compiler cannot find a common type, the code does not compile.

```java
// compile error — int and String have no common numeric type
// int bad = (true) ? 1 : "hello";
```

---

## Ternary Inside Expressions

Because the ternary operator is an expression (not a statement), it can appear wherever a value is expected:

```java
System.out.println((x % 2 == 0) ? "even" : "odd");

int fee = 5 + ((age < 18) ? 0 : 10);
```

> A ternary expression can appear on the right side of an assignment, as a method argument, or inside another expression.

---

## Side Effects in Ternary Expressions

Only **one** of the two branches is evaluated. Side effects in the unselected branch do not occur:

```java
int count = 0;
int value = (true) ? count++ : count--;   // only count++ executes
System.out.println(count);               // 1
System.out.println(value);              // 0 (the pre-increment value)
```

This is important when the branches have side effects such as method calls or increment/decrement operators.

---

## Nested Ternary Operators

Java allows nesting ternary operators. This is **legal** but strongly discouraged because it reduces readability. The exam may test whether you can parse a nested ternary correctly.

```java
int score = 75;
String grade = (score >= 90) ? "A"
             : (score >= 80) ? "B"
             : (score >= 70) ? "C"
             : "F";
System.out.println(grade);  // C
```

The ternary operator is **right-associative**, so `a ? b : c ? d : e` is parsed as `a ? b : (c ? d : e)`.

```java
int x = 1, y = 2, z = 3;
// Parentheses added for clarity:
int result = (x > y) ? x : (y > z) ? y : z;   // evaluates to 3
System.out.println(result);   // 3
```

---

## Common Exam Traps

### Trap 1 — Autoboxing and unboxing

When one branch is a wrapper type and the other is a primitive, unboxing occurs. This can cause a `NullPointerException` at runtime if the wrapper is `null`:

```java
Integer boxed = null;
int value = (true) ? boxed : 0;   // unboxing null → NullPointerException at runtime
```

### Trap 2 — Unary minus vs. the ternary separator

Watch for expressions where `-` could be confused with the negation operator or subtraction:

```java
int a = 1, b = 2;
int r = a > b ? a : -b;   // if a > b return a, else return -b (negative b)
System.out.println(r);    // -2
```

### Trap 3 — Assignment inside condition

A boolean variable can be assigned and used as the condition:

```java
boolean flag;
int x = 5;
String msg = (flag = x > 3) ? "yes" : "no";
System.out.println(flag);   // true
System.out.println(msg);    // yes
```

This is valid Java but a common source of confusion on the exam.

### Trap 4 — Void vs. value

The ternary operator produces a **value**; it cannot be used where a void statement is expected without capturing the result. Both branches must also produce compatible non-void values.

```java
// compile error — void methods cannot be used as ternary operands
// (true) ? System.out.println("a") : System.out.println("b");
```

---

## Ternary vs. `if`/`else` — When to Use Which

| Consideration | Ternary | `if`/`else` |
|---|---|---|
| Result used in expression | Natural fit | Requires temporary variable |
| Multiple statements per branch | Not possible | Use `if`/`else` |
| Readability | Good for simple, one-line choices | Better for complex logic |
| Nesting | Legal but avoid | Preferred |

---

## Key Points to Remember

- Syntax: `condition ? trueExpression : falseExpression`.
- Only one branch is evaluated — side effects in the other branch do not occur.
- The result type follows Java's numeric promotion rules; incompatible types are a compile error.
- Nested ternary is right-associative and legal, but discouraged.
- A `null` wrapper type in a branch that is unboxed causes a `NullPointerException` at runtime.
- The ternary operator produces a value; it cannot replace void method calls.

---

## References

- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
- [Java Language Specification §15.25 — Conditional Operator `? :`](https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.25)
