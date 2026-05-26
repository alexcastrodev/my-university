# Assigning Values

> The **assignment operator** `=` stores a value into a variable. Java also provides **compound assignment operators** that combine an arithmetic (or bitwise) operation with assignment in a single step.

---

## Simple Assignment: `=`

The right-hand side is evaluated first, then the result is stored in the variable on the left.

```java
int x = 5;
int y = x + 3;  // y = 8
x = y;          // x = 8
```

Assignment is an expression — it returns the assigned value:

```java
int a, b;
a = b = 10;     // right-to-left: b = 10, then a = 10
System.out.println(a + " " + b);  // 10 10
```

---

## Compound Assignment Operators

A compound assignment operator applies a binary operation and assigns the result in one step.

| Operator | Equivalent (approximately) | Example |
|---|---|---|
| `+=` | `x = x + rhs` | `x += 3` |
| `-=` | `x = x - rhs` | `x -= 3` |
| `*=` | `x = x * rhs` | `x *= 3` |
| `/=` | `x = x / rhs` | `x /= 3` |
| `%=` | `x = x % rhs` | `x %= 3` |

```java
int score = 100;
score += 25;   // 125
score -= 10;   // 115
score *= 2;    // 230
score /= 5;    // 46
score %= 7;    // 4
```

---

## Hidden Casting in Compound Assignments

This is a critical exam point. A compound assignment operator **includes an implicit narrowing cast** to the type of the left-hand side. A plain expanded form does not.

```java
byte b = 10;

b += 5;          // compiles — equivalent to b = (byte)(b + 5)
// b = b + 5;    // compile error — b + 5 is int, cannot assign to byte
```

```java
short s = 100;
s *= 2;          // compiles — implicit cast to short
// short s2 = s * 2;  // compile error
```

The implicit cast can cause data loss if the result overflows the target type:

```java
byte b = 100;
b += 100;   // (byte)(200) → -56 (overflow, no compile error)
System.out.println(b);  // -56
```

---

## Compound Assignment with Different Types

The right-hand side can be a wider type than the variable — the implicit cast handles it:

```java
long bigNum = 1_000_000L;
int  x = 5;
x += bigNum;   // compiles — implicit cast (long) to int; may lose data
System.out.println(x);  // 1000005 (if within int range, no data loss here)
```

---

## Assignment with Floating-Point

```java
double d = 3.5;
d += 1;       // 4.5  (int 1 widened to double)
d *= 2;       // 9.0
d /= 4;       // 2.25
```

```java
float f = 1.0f;
f += 0.5f;    // 1.5f
```

---

## Chained and Nested Assignments

Assignments can be chained (right-to-left associativity):

```java
int a, b, c;
a = b = c = 42;
// c assigned 42, b assigned 42, a assigned 42
```

An assignment expression used inside a larger expression returns the assigned value:

```java
int x;
System.out.println(x = 7);  // prints 7, x is now 7
```

---

## Bitwise and Shift Compound Assignments

Java also supports compound assignment for bitwise and shift operators. These appear less frequently in day-to-day code but can appear on the exam.

| Operator | Description |
|---|---|
| `&=` | Bitwise AND assignment |
| `\|=` | Bitwise OR assignment |
| `^=` | Bitwise XOR assignment |
| `<<=` | Left-shift assignment |
| `>>=` | Signed right-shift assignment |
| `>>>=` | Unsigned right-shift assignment |

```java
int flags = 0b1100;
flags &= 0b1010;   // 0b1000 (AND)
flags |= 0b0001;   // 0b1001 (OR)
flags ^= 0b1001;   // 0b0000 (XOR)
```

---

## Common Exam Traps

```java
// Trap 1: compound vs. expanded
short s = 10;
s += 5;         // OK  (implicit cast)
// s = s + 5;  // compile error

// Trap 2: overflow is silent
byte b = 127;
b += 1;          // b becomes -128 (no exception)

// Trap 3: assignment returns the value
boolean flag;
if ((flag = someCondition()) == true) { ... }  // valid but unusual
```

---

## Key Rules to Remember

- `=` is right-to-left: the right-hand side is evaluated completely before assignment.
- Compound operators (`+=`, `-=`, etc.) include an **implicit narrowing cast** — plain expansion does not.
- That implicit cast can silently cause overflow or data loss.
- Chained assignments like `a = b = c = 0` work right-to-left.

---

## References

- [Oracle Docs — Assignment, Arithmetic, and Unary Operators](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/op1.html)
- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
