# Applying Unary Operators

> A **unary operator** requires exactly one operand. Java provides unary operators for negation, logical complement, bitwise complement, increment/decrement, and casting.

---

## Logical Complement: `!`

Inverts a `boolean` value. Only applicable to `boolean` — not to numeric types.

```java
boolean open = true;
System.out.println(!open);   // false
System.out.println(!false);  // true
```

```java
int x = 1;
// System.out.println(!x);  // compile error: ! requires boolean
```

---

## Bitwise Complement: `~`

Flips every bit of an integral value (`int`, `long`, `short`, `byte`, `char`). The result is always `-(n + 1)`.

```java
int n = 5;          // bits: 0000...0101
int flip = ~n;      // bits: 1111...1010 → value: -6
System.out.println(flip);  // -6
```

> `~` is not the same as `!`. `~` works on integers; `!` works on booleans.

---

## Unary Plus and Minus: `+` and `-`

Unary `+` is rarely used — it simply confirms the sign without changing the value. Unary `-` negates a numeric value.

```java
int a =  5;
int b = -a;   // -5
int c = -b;   //  5
int d = +a;   //  5  (no change)
```

Applying unary `-` to a `byte` or `short` produces an `int`:

```java
byte b = 3;
// byte neg = -b;  // compile error: result is int
int  neg = -b;     // correct: -3
```

---

## Increment and Decrement: `++` and `--`

These operators add or subtract 1 from a variable. Their placement (prefix vs. postfix) determines when the updated value is used in the enclosing expression.

| Form | Evaluates to | Side effect |
|---|---|---|
| `++x` (prefix) | value **after** incrementing | `x` becomes `x + 1` |
| `x++` (postfix) | value **before** incrementing | `x` becomes `x + 1` |
| `--x` (prefix) | value **after** decrementing | `x` becomes `x - 1` |
| `x--` (postfix) | value **before** decrementing | `x` becomes `x - 1` |

```java
int x = 5;
System.out.println(x++);  // prints 5, then x becomes 6
System.out.println(x);    // prints 6

int y = 5;
System.out.println(++y);  // y becomes 6, then prints 6
System.out.println(y);    // prints 6
```

### Common Exam Trap

```java
int a = 3;
int b = ++a * 2;  // a becomes 4 first, then 4 * 2 = 8
System.out.println(a);  // 4
System.out.println(b);  // 8

int c = 3;
int d = c++ * 2;  // 3 * 2 = 6, then c becomes 4
System.out.println(c);  // 4
System.out.println(d);  // 6
```

---

## Casting

A cast is a unary operator that explicitly converts a value to a different type. Syntax: `(targetType) value`.

### Widening Conversion (implicit)

Moving to a larger type is automatic — no cast needed:

```java
int i = 100;
long l = i;    // widening: int → long (automatic)
double d = l;  // widening: long → double (automatic)
```

### Narrowing Conversion (explicit cast required)

Moving to a smaller type may lose data — the compiler requires an explicit cast:

```java
double d = 9.99;
int i = (int) d;   // truncates toward zero: i = 9 (not rounded)
System.out.println(i);  // 9
```

```java
int big = 130;
byte b = (byte) big;   // 130 overflows byte range (-128..127)
System.out.println(b); // -126  (wraps around)
```

### Casting Between char and int

`char` is an unsigned 16-bit integer (values 0–65535). It can be cast to and from `int`:

```java
char c = 'A';
int  n = c;         // widening: 65
char d = (char) 66; // narrowing to char: 'B'
System.out.println(d);  // B
```

---

## Summary of Unary Operators

| Operator | Operand type | Description |
|---|---|---|
| `!` | `boolean` | Logical complement |
| `~` | integral | Bitwise complement |
| `+` | numeric | Unary plus (no effect) |
| `-` | numeric | Arithmetic negation |
| `++` | numeric variable | Increment by 1 |
| `--` | numeric variable | Decrement by 1 |
| `(type)` | any compatible | Explicit type cast |

---

## Key Rules to Remember

- `!` is for booleans; `~` is for integers — they cannot be swapped.
- Postfix `x++` returns the original value; prefix `++x` returns the incremented value.
- Casting truncates (toward zero) for floating-point-to-integer conversions — it does not round.
- Narrowing conversions can silently lose data; always verify the target range.

---

## References

- [Oracle Docs — Unary Operators (Java 21 Tutorial)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/op1.html)
- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
