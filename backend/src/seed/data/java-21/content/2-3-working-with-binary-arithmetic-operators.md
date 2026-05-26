# Working with Binary Arithmetic Operators

> **Binary arithmetic operators** take two operands and produce a numeric result. Java supports addition, subtraction, multiplication, division, and modulus — each with specific rules for integer vs. floating-point behavior.

---

## The Five Arithmetic Operators

| Operator | Name | Example | Result |
|---|---|---|---|
| `+` | Addition | `5 + 3` | `8` |
| `-` | Subtraction | `5 - 3` | `2` |
| `*` | Multiplication | `5 * 3` | `15` |
| `/` | Division | `5 / 3` | `1` (integer) |
| `%` | Modulus (remainder) | `5 % 3` | `2` |

---

## Integer Division

When both operands are integral types (`byte`, `short`, `int`, `long`, `char`), `/` performs **integer division** — it discards the fractional part (truncates toward zero).

```java
System.out.println(10 / 3);   //  3  (not 3.33...)
System.out.println(-10 / 3);  // -3  (truncates toward zero, not -4)
System.out.println(10 / -3);  // -3
```

> Dividing an integer by zero throws `ArithmeticException: / by zero` at runtime.

```java
int x = 5 / 0;  // throws ArithmeticException at runtime
```

---

## Floating-Point Division

If either operand is `float` or `double`, the result is floating-point and division never truncates.

```java
System.out.println(10.0 / 3);    // 3.3333333333333335
System.out.println(10 / 3.0);    // 3.3333333333333335
System.out.println(10.0 / 0);    // Infinity  (no exception)
System.out.println(0.0 / 0.0);   // NaN
```

Floating-point division by zero yields `Infinity` or `NaN` — it does **not** throw an exception.

---

## Modulus Operator `%`

Returns the remainder after division. Works for both integers and floating-point.

```java
System.out.println(10 % 3);    //  1  (10 = 3*3 + 1)
System.out.println(-10 % 3);   // -1  (sign follows the dividend)
System.out.println(10 % -3);   //  1
System.out.println(10.5 % 3);  //  1.5
```

Integer modulus by zero also throws `ArithmeticException`.

---

## String Concatenation with `+`

When either operand of `+` is a `String`, the operator performs **concatenation**, not addition. Evaluation is left-to-right.

```java
System.out.println("value: " + 1 + 2);  // "value: 12"  (left-to-right)
System.out.println("value: " + (1 + 2)); // "value: 3"   (parentheses first)
System.out.println(1 + 2 + " value");    // "3 value"    (1+2 = 3 first, then concat)
```

---

## Numeric Promotion Rules

Before a binary arithmetic operation, Java automatically promotes operands according to these rules (applied in order):

1. If either operand is `double`, the other is promoted to `double`.
2. Else if either operand is `float`, the other is promoted to `float`.
3. Else if either operand is `long`, the other is promoted to `long`.
4. **Otherwise, both operands are promoted to `int`** — even if both are `byte`, `short`, or `char`.

```java
short s1 = 10;
short s2 = 20;
// short s3 = s1 + s2;  // compile error: result is int
int   s3 = s1 + s2;     // correct
```

```java
int   i = 5;
long  l = 10L;
long  result = i + l;   // i promoted to long
```

```java
long  l = 10L;
float f = 2.5f;
float r = l + f;        // l promoted to float
```

---

## Widening Promotion in Assignments

A common exam pattern combines promotion with assignment:

```java
byte  b = 10;
short s = 20;
// b = b + s;   // compile error: result is int, cannot assign to byte
b = (byte)(b + s);  // explicit cast required
```

---

## Integer Overflow

When an integer result exceeds the range of its type, it **wraps around** silently — no exception is thrown.

```java
int max = Integer.MAX_VALUE;  // 2_147_483_647
System.out.println(max + 1);  // -2_147_483_648  (wraps around)
```

Use `long` when values may exceed `int` range:

```java
long safe = (long) Integer.MAX_VALUE + 1;  // 2_147_483_648L
```

---

## Practical Examples

```java
// Checking even/odd
int n = 7;
boolean isEven = (n % 2 == 0);  // false

// Extracting digits
int number = 1234;
int lastDigit    = number % 10;   // 4
int remaining    = number / 10;   // 123

// Average with promotion
int a = 7, b = 3;
double avg = (double)(a + b) / 2;  // cast before division: 5.0
// double wrong = (double)(a + b / 2);  // 3+1 = 4 cast to 4.0 (wrong)
```

---

## Key Rules to Remember

- Integer division truncates toward zero — it does not round.
- Integer division by zero throws `ArithmeticException`; floating-point division by zero yields `Infinity` or `NaN`.
- `byte`, `short`, and `char` always promote to `int` in arithmetic — assigning the result back requires a cast.
- The sign of `%` matches the sign of the dividend.
- With `+`, if either operand is a `String`, concatenation occurs — not addition.

---

## References

- [Oracle Docs — Arithmetic Operators](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/op1.html)
- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
