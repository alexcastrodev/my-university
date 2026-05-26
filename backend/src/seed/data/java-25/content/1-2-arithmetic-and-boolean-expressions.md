---
version: 1.0
updatedAt: 2026-05-26
---
# Arithmetic and Boolean Expressions

---

## Arithmetic Operators

Java provides the standard arithmetic operators for numeric types:

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Addition | `3 + 4` → `7` |
| `-` | Subtraction | `10 - 3` → `7` |
| `*` | Multiplication | `3 * 4` → `12` |
| `/` | Division | `10 / 3` → `3` (integer division) |
| `%` | Modulo (remainder) | `10 % 3` → `1` |

### Integer Division and Modulo

Integer division truncates toward zero — the fractional part is discarded:

```java
int a = 10 / 3;    // 3  (not 3.33)
int b = -10 / 3;   // -3 (truncates toward zero)
int c = 10 % 3;    // 1
int d = -10 % 3;   // -1 (sign follows the dividend)
```

Dividing an integer by zero throws `ArithmeticException`. Floating-point division by zero yields `Infinity` or `NaN`:

```java
int bad  = 5 / 0;       // ArithmeticException
double inf = 5.0 / 0;   // Infinity
double nan = 0.0 / 0;   // NaN
```

---

## Unary Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Unary plus (rarely used) | `+x` |
| `-` | Unary minus (negation) | `-x` |
| `++` | Increment by 1 | `x++` / `++x` |
| `--` | Decrement by 1 | `x--` / `--x` |

### Pre- vs Post-increment

The prefix form increments **before** the value is used; the postfix form increments **after**:

```java
int x = 5;
System.out.println(x++);  // prints 5, then x becomes 6
System.out.println(++x);  // x becomes 7, then prints 7

int y = 5;
int a = y++;  // a = 5, y = 6
int b = ++y;  // y = 7, b = 7
```

> **Exam tip:** `x++` returns the old value; `++x` returns the new value. These appear frequently in loop conditions and assignment expressions on the exam.

---

## Compound Assignment Operators

Compound operators combine an arithmetic operation with assignment:

```java
int x = 10;
x += 3;   // x = 13
x -= 2;   // x = 11
x *= 2;   // x = 22
x /= 4;   // x = 5
x %= 3;   // x = 2
```

Compound assignment operators include an **implicit cast**, so this compiles even though it would not with an explicit operation:

```java
byte b = 5;
b += 3;      // OK — implicit cast: equivalent to b = (byte)(b + 3)
b = b + 3;   // COMPILE ERROR — b + 3 promotes to int
```

---

## Numeric Promotion Rules

When operands of different types are combined, smaller types are promoted before the operation:

1. `byte`, `short`, and `char` are promoted to `int` before any binary operation.
2. If one operand is `long`, the other is promoted to `long`.
3. If one operand is `float`, the other is promoted to `float`.
4. If one operand is `double`, the other is promoted to `double`.

```java
byte b  = 10;
short s = 20;
// b + s is int, not byte or short
int result = b + s;  // OK
byte bad   = b + s;  // COMPILE ERROR — int cannot be assigned to byte
```

---

## Boolean Expressions

A boolean expression evaluates to `true` or `false` and is used in conditions.

### Relational Operators

| Operator | Meaning |
|----------|---------|
| `==` | Equal to |
| `!=` | Not equal to |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal to |
| `>=` | Greater than or equal to |

```java
int x = 5;
boolean a = x == 5;   // true
boolean b = x != 5;   // false
boolean c = x > 3;    // true
boolean d = x <= 5;   // true
```

### Logical Operators

| Operator | Type | Description |
|----------|------|-------------|
| `&` | AND (eager) | Both sides always evaluated |
| `\|` | OR (eager) | Both sides always evaluated |
| `^` | XOR | True when exactly one side is true |
| `!` | NOT | Inverts the boolean value |
| `&&` | AND (short-circuit) | Right side skipped if left is `false` |
| `\|\|` | OR (short-circuit) | Right side skipped if left is `true` |

```java
int x = 5;
// Short-circuit: right side not evaluated when not needed
boolean a = (x > 10) && (x++ > 0);  // false; x is still 5
boolean b = (x > 0)  || (x++ > 0);  // true;  x is still 5

// Eager: both sides always evaluated
boolean c = (x > 10) & (x++ > 0);   // false; x becomes 6
boolean d = (x > 0)  | (x++ > 0);   // true;  x becomes 7
```

> **Exam tip:** Use `&&` and `||` when the right-hand side has side effects (like `x++`). Short-circuit evaluation can prevent `NullPointerException` when checking for null before dereferencing.

### Short-circuit Evaluation for Null Safety

```java
String s = null;
// Without short-circuit — NullPointerException:
if (s != null & s.length() > 0) { }   // NPE when s is null

// With short-circuit — safe:
if (s != null && s.length() > 0) { }  // OK — right side skipped when s is null
```

---

## String Concatenation with `+`

When `+` has a `String` operand, it performs concatenation. Order of evaluation matters:

```java
System.out.println(1 + 2 + "3");    // "33"  (1+2=3, then "3"+"3")
System.out.println("1" + 2 + 3);    // "123" ("1"+"2"="12", then "12"+"3")
System.out.println("1" + (2 + 3));  // "15"  (parentheses force numeric addition first)
```

---

## Key Points for the Exam

- Integer division truncates toward zero; integer division by zero throws `ArithmeticException`.
- `x++` returns the original value; `++x` returns the incremented value.
- Compound assignments (`+=`, `-=`, etc.) include an implicit narrowing cast.
- `byte`, `short`, and `char` are promoted to `int` in binary expressions.
- `&&` and `||` short-circuit; `&` and `|` always evaluate both operands.
- `+` with a `String` operand performs concatenation, not addition.

## References

- [Oracle Docs — Operators (Java Tutorials)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/operators.html)
- [Oracle Docs — Expressions, Statements, and Blocks (Java Tutorials)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/expressions.html)
- [JLS 25 — Operators](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html)
