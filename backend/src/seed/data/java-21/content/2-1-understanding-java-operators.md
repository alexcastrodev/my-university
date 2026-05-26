# Understanding Java Operators

> Operators are special symbols that perform operations on one or more **operands** and produce a result. Every Java expression is built from operators, variables, and literals.

---

## Operator Categories

Java operators fall into three categories based on the number of operands they require:

| Category | Operands | Examples |
|---|---|---|
| **Unary** | 1 | `!`, `~`, `++`, `--`, `-` (negation) |
| **Binary** | 2 | `+`, `-`, `*`, `/`, `%`, `&&`, `||`, `==` |
| **Ternary** | 3 | `? :` |

---

## Operator Precedence

When an expression contains multiple operators, **precedence** determines the order of evaluation. Higher precedence operators are evaluated before lower ones.

| Precedence | Operators | Associativity |
|---|---|---|
| 1 (highest) | `++` `--` (postfix) | Left to right |
| 2 | `++` `--` (prefix), `+` `-` (unary), `~`, `!` | Right to left |
| 3 | `*` `/` `%` | Left to right |
| 4 | `+` `-` (binary) | Left to right |
| 5 | `<<` `>>` `>>>` | Left to right |
| 6 | `<` `>` `<=` `>=` `instanceof` | Left to right |
| 7 | `==` `!=` | Left to right |
| 8 | `&` (bitwise AND) | Left to right |
| 9 | `^` (bitwise XOR) | Left to right |
| 10 | `\|` (bitwise OR) | Left to right |
| 11 | `&&` (logical AND) | Left to right |
| 12 | `\|\|` (logical OR) | Left to right |
| 13 | `? :` (ternary) | Right to left |
| 14 (lowest) | `=` `+=` `-=` `*=` `/=` `%=` etc. | Right to left |

> **Tip for the exam:** You do not need to memorize every level, but you must know that multiplication and division bind more tightly than addition and subtraction, that `!` is applied before `&&`, and that `&&` binds more tightly than `||`.

---

## Evaluating Expressions with Precedence

Consider this expression:

```java
int result = 2 + 3 * 4;  // result = 14, not 20
```

`*` has higher precedence than `+`, so `3 * 4 = 12` is evaluated first, then `2 + 12 = 14`.

Use parentheses to override precedence:

```java
int result = (2 + 3) * 4;  // result = 20
```

---

## Associativity

When two operators have the **same precedence**, associativity determines the direction of evaluation.

```java
int a = 10 - 3 - 2;  // left-to-right: (10 - 3) - 2 = 5, not 10 - (3 - 2) = 9
```

Assignment operators are right-to-left:

```java
int x, y, z;
x = y = z = 5;  // right-to-left: z=5, then y=5, then x=5
```

---

## Operand Types and Promotion

Before most binary operations, Java automatically promotes smaller numeric types:

- `byte`, `short`, and `char` are promoted to `int` before any binary arithmetic.
- If either operand is `long`, `float`, or `double`, the other operand is promoted to match.

```java
byte b1 = 10;
byte b2 = 20;
// byte b3 = b1 + b2;  // compile error: result is int
int  b3 = b1 + b2;     // correct
```

---

## Overview of Operator Types

The following lessons cover each category in depth:

| Lesson | Topic |
|---|---|
| 2-2 | Unary operators: `!`, `~`, `+`, `-`, `++`, `--`, casting |
| 2-3 | Binary arithmetic: `+`, `-`, `*`, `/`, `%`, numeric promotion |
| 2-4 | Assignment operators: `=`, `+=`, `-=`, compound assignments |
| 2-5 | Comparison operators: `==`, `!=`, `<`, `>`, `instanceof` |
| 2-6 | Ternary operator: `? :` |

---

## Key Rules to Remember

- Parentheses always override precedence — use them when in doubt.
- `byte` and `short` arithmetic produces `int`, not `byte` or `short`.
- Unary prefix operators are right-to-left; most binary operators are left-to-right.
- Assignment has the lowest precedence of all operators.

---

## References

- [Oracle Docs — Operators (Java 21)](https://docs.oracle.com/en/java/javase/21/docs/api/)
- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
