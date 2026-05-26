---
version: 1.0
updatedAt: 2026-05-26
---
# Operator Precedence, Type Conversions, and Casting

---

## Operator Precedence

When an expression contains multiple operators, **precedence** determines which operations execute first. Higher precedence operators bind more tightly than lower ones.

| Priority | Operators | Description |
|----------|-----------|-------------|
| 1 (highest) | `()` `[]` `.` | Parentheses, array access, member access |
| 2 | `++` `--` (postfix) | Postfix increment/decrement |
| 3 | `++` `--` (prefix), `+` `-` (unary), `~`, `!` | Prefix increment/decrement, unary |
| 4 | `*` `/` `%` | Multiplicative |
| 5 | `+` `-` | Additive |
| 6 | `<<` `>>` `>>>` | Shift |
| 7 | `<` `>` `<=` `>=` `instanceof` | Relational |
| 8 | `==` `!=` | Equality |
| 9 | `&` | Bitwise AND |
| 10 | `^` | Bitwise XOR |
| 11 | `\|` | Bitwise OR |
| 12 | `&&` | Logical AND |
| 13 | `\|\|` | Logical OR |
| 14 | `? :` | Ternary |
| 15 (lowest) | `=` `+=` `-=` `*=` `/=` `%=` etc. | Assignment |

### Precedence Examples

```java
int result = 2 + 3 * 4;          // 14, not 20 (*, then +)
boolean b  = 5 > 3 && 2 < 4;     // true (> and < before &&)
int x      = 10 - 4 - 2;         // 4   (left-to-right associativity)
int y      = 2 * 3 + 4 / 2;      // 8   (both * and / before +)
```

> **Exam tip:** Use parentheses to make intent explicit. The exam often presents expressions without parentheses to test whether you know the correct evaluation order.

### Associativity

When operators have the same precedence, **associativity** determines evaluation order:
- **Left-to-right**: most binary operators (`+`, `-`, `*`, `/`, `&&`, `||`)
- **Right-to-left**: assignment operators and prefix unary operators

```java
int a = 4 - 2 - 1;      // (4 - 2) - 1 = 1  (left-to-right)
int x = 5;
int y = x = 3;           // x=3 first, then y=3 (right-to-left assignment)
```

---

## Type Conversions

### Widening Conversion (Implicit)

A widening conversion converts a smaller type to a larger type. No explicit cast is needed and no data is lost:

```
byte → short → int → long → float → double
                char ↗
```

```java
byte   b = 100;
short  s = b;      // widening: byte → short
int    i = s;      // widening: short → int
long   l = i;      // widening: int → long
float  f = l;      // widening: long → float  (may lose precision for large values)
double d = f;      // widening: float → double
```

> **Exam tip:** `long` to `float` (and `long` to `double`) widening can lose precision because floating-point types cannot represent all large integer values exactly.

### Narrowing Conversion (Explicit Cast Required)

A narrowing conversion converts a larger type to a smaller type. Explicit cast syntax is required, and data may be truncated or mangled:

```java
double d = 3.99;
int    i = (int) d;     // 3 — fractional part truncated, not rounded

int  large = 300;
byte small  = (byte) large;  // 44 — only lowest 8 bits kept (300 % 256 = 44)

int  neg    = -1;
byte b      = (byte) neg;    // -1 — two's complement preserved within byte range
```

---

## Casting

### Primitive Casting

Syntax: `(targetType) expression`

```java
double pi    = 3.14159;
int    iPi   = (int) pi;         // 3

long   big   = 1_000_000_000_000L;
int    small = (int) big;        // data loss — truncated to lowest 32 bits

float  f     = (float) 3.14159; // explicit cast needed: double → float
```

### char and int Conversion

`char` is an unsigned 16-bit type. Assigning an integer literal to `char` is allowed if the value fits; assigning an `int` variable requires an explicit cast:

```java
char c1 = 'A';         // character literal
char c2 = 65;          // integer literal — OK (65 fits in char)
int  i  = 65;
char c3 = i;           // COMPILE ERROR — needs explicit cast
char c4 = (char) i;    // 'A' — explicit cast

int code = 'A' + 1;    // 66 (char promoted to int in expression)
```

### Object Casting (Reference Types)

Casting between reference types is covered in the OOP module. Briefly:

```java
Object obj = "Hello";         // upcasting (implicit)
String s   = (String) obj;    // downcasting (explicit)
String bad = (String) new Object();  // ClassCastException at runtime
```

Use `instanceof` to check before casting:

```java
if (obj instanceof String s) {
    System.out.println(s.length());  // safe — pattern variable
}
```

---

## Numeric Overflow and Underflow

When arithmetic produces a value outside a type's range, it **overflows** (wraps around silently for integer types):

```java
int max  = Integer.MAX_VALUE;  // 2_147_483_647
int over = max + 1;            // -2_147_483_648 (wraps to MIN_VALUE)

byte b   = (byte) 130;         // -126 (130 - 256)
```

Floating-point overflow yields `Infinity`; underflow (too small) yields `0.0`:

```java
double big  = Double.MAX_VALUE * 2;   // Infinity
double tiny = Double.MIN_VALUE / 2;   // 0.0
```

---

## The Ternary Operator

The ternary operator is a compact conditional expression:

```
condition ? expressionIfTrue : expressionIfFalse
```

```java
int x    = 5;
String s = (x > 3) ? "big" : "small";   // "big"
int abs  = (x < 0) ? -x : x;            // absolute value
```

Type promotion applies: both branches are promoted to a common type:

```java
int    i = 1;
double d = 2.0;
var    r = true ? i : d;   // r is double (int widened to double)
```

---

## Key Points for the Exam

- Multiplication and division have higher precedence than addition and subtraction.
- Assignment operators have the lowest precedence and are right-to-left associative.
- Widening conversions are implicit; narrowing conversions require an explicit cast.
- Integer truncation (not rounding) occurs when casting `double`/`float` to an integer type.
- Integer overflow silently wraps around; it does not throw an exception.
- `char` can hold an integer literal (0–65535) without a cast, but not an `int` variable.
- Compound assignment operators (`+=`, etc.) include an implicit narrowing cast.

## References

- [Oracle Docs — Operators (Java SE 25)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/operators.html)
- [Oracle Docs — Conversions and Promotions (JLS 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html)
