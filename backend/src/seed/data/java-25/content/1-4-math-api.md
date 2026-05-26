# The Math API

---

## Overview

The `java.lang.Math` class provides static methods for common mathematical operations. All methods are `static` — no instance is needed. The class is `final` and cannot be subclassed.

```java
import java.lang.Math;  // optional — automatically imported from java.lang
```

---

## Rounding Methods

| Method | Description | Example |
|--------|-------------|---------|
| `Math.round(double)` | Rounds to nearest `long` (half up) | `Math.round(3.5)` → `4L` |
| `Math.round(float)` | Rounds to nearest `int` (half up) | `Math.round(3.5f)` → `4` |
| `Math.ceil(double)` | Rounds up (toward +∞) | `Math.ceil(3.1)` → `4.0` |
| `Math.floor(double)` | Rounds down (toward -∞) | `Math.floor(3.9)` → `3.0` |

```java
Math.round(3.5);    // 4   (half rounds up)
Math.round(-3.5);   // -3  (half rounds toward positive infinity)
Math.ceil(3.001);   // 4.0
Math.floor(3.999);  // 3.0
Math.ceil(-3.1);    // -3.0 (toward +∞ for negatives)
Math.floor(-3.1);   // -4.0 (toward -∞ for negatives)
```

> **Exam tip:** `Math.round(-3.5)` returns `-3`, not `-4`. Rounding is always toward positive infinity for `.5` values.

---

## Absolute Value

```java
Math.abs(-5);      // 5
Math.abs(-3.14);   // 3.14
Math.abs(Integer.MIN_VALUE);  // Integer.MIN_VALUE — overflow! Result is negative
```

> **Exam tip:** `Math.abs(Integer.MIN_VALUE)` is a known trap — the result is still `Integer.MIN_VALUE` because the positive equivalent cannot be represented as an `int`.

---

## Min and Max

```java
Math.min(3, 7);      // 3
Math.max(3, 7);      // 7
Math.min(-5, -10);   // -10
Math.max(3.5, 3.6);  // 3.6
```

Overloaded for `int`, `long`, `float`, and `double`.

---

## Power and Square Root

```java
Math.pow(2, 10);     // 1024.0 (returns double)
Math.pow(4, 0.5);    // 2.0    (square root via power)
Math.sqrt(25);       // 5.0
Math.sqrt(-1);       // NaN    (no imaginary numbers)
Math.cbrt(27);       // 3.0    (cube root)
```

---

## Logarithms and Exponentials

```java
Math.log(Math.E);    // 1.0  (natural log, base e)
Math.log10(1000);    // 3.0  (base 10 log)
Math.exp(1);         // 2.718... (e^1)
```

---

## Trigonometry

All trigonometric methods work in **radians**, not degrees.

```java
Math.sin(Math.PI / 2);   // 1.0
Math.cos(0);             // 1.0
Math.tan(Math.PI / 4);   // ~1.0

// Convert degrees to radians
double radians = Math.toRadians(90);   // Math.PI / 2
double degrees = Math.toDegrees(Math.PI);  // 180.0
```

---

## Constants

| Constant | Value |
|----------|-------|
| `Math.PI` | 3.141592653589793 |
| `Math.E` | 2.718281828459045 |

```java
double circumference = 2 * Math.PI * radius;
double naturalLog    = Math.log(Math.E);  // 1.0
```

---

## Random Numbers

```java
double r = Math.random();  // [0.0, 1.0) — includes 0.0, excludes 1.0

// Random int in range [min, max] inclusive:
int dice = (int)(Math.random() * 6) + 1;  // 1 to 6
```

For better control over randomness, use `java.util.Random` or `java.util.concurrent.ThreadLocalRandom`.

---

## Exact Arithmetic (Overflow Detection)

The `Math.exact*` methods throw `ArithmeticException` on overflow instead of silently wrapping:

```java
Math.addExact(Integer.MAX_VALUE, 1);      // ArithmeticException
Math.subtractExact(Integer.MIN_VALUE, 1); // ArithmeticException
Math.multiplyExact(Integer.MAX_VALUE, 2); // ArithmeticException
Math.incrementExact(Integer.MAX_VALUE);   // ArithmeticException
Math.toIntExact(Long.MAX_VALUE);          // ArithmeticException
```

---

## Signum and Clamp

```java
Math.signum(-5.0);  // -1.0
Math.signum(0.0);   //  0.0
Math.signum(5.0);   //  1.0

// Math.clamp — added in Java 21
Math.clamp(15, 0, 10);    // 10 (value clamped to max)
Math.clamp(-5, 0, 10);    // 0  (value clamped to min)
Math.clamp(7,  0, 10);    // 7  (within range)
```

---

## Key Points for the Exam

- All `Math` methods are `static` — call them as `Math.methodName()`.
- `Math.round()` rounds half-up toward positive infinity.
- `Math.abs(Integer.MIN_VALUE)` overflows and returns a negative number.
- `Math.pow()` always returns `double`.
- Trigonometric methods use radians; use `Math.toRadians()` to convert from degrees.
- `Math.random()` returns `[0.0, 1.0)` — includes 0.0 but excludes 1.0.
- `Math.exact*` methods throw `ArithmeticException` on integer overflow.

## References

- [Oracle Docs — Math (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Math.html)
