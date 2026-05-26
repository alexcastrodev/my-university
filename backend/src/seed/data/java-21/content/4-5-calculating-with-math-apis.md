# Calculating with Math APIs

## Overview

The `java.lang.Math` class provides static utility methods for common mathematical operations. Because it is in `java.lang`, no import is needed. All methods are `static` — you call them directly on the class.

```java
double result = Math.sqrt(16.0); // no import needed
```

## Minimum and Maximum

`Math.min` and `Math.max` compare two values and return the smaller or larger one. They are overloaded for `int`, `long`, `float`, and `double`.

```java
System.out.println(Math.min(10, 20));    // 10
System.out.println(Math.max(10, 20));    // 20
System.out.println(Math.min(3.5, 3.1)); // 3.1
System.out.println(Math.max(-5, -3));   // -3
```

## Absolute Value

`Math.abs` returns the non-negative magnitude of a number.

```java
System.out.println(Math.abs(-7));    // 7
System.out.println(Math.abs(7));     // 7
System.out.println(Math.abs(-3.14)); // 3.14
```

> Note: `Math.abs(Integer.MIN_VALUE)` returns `Integer.MIN_VALUE` (still negative) due to integer overflow. This is an exam-tested edge case.

## Rounding Methods

| Method | Behavior | Example |
|--------|----------|---------|
| `Math.round(x)` | Rounds to nearest; .5 rounds up | `Math.round(2.5)` → `3` |
| `Math.ceil(x)` | Rounds **up** to nearest integer (returns `double`) | `Math.ceil(2.1)` → `3.0` |
| `Math.floor(x)` | Rounds **down** to nearest integer (returns `double`) | `Math.floor(2.9)` → `2.0` |

```java
System.out.println(Math.round(2.4));  // 2
System.out.println(Math.round(2.5));  // 3
System.out.println(Math.round(-2.5)); // -2 (rounds toward positive infinity)

System.out.println(Math.ceil(3.1));   // 4.0
System.out.println(Math.ceil(-3.9));  // -3.0

System.out.println(Math.floor(3.9));  // 3.0
System.out.println(Math.floor(-3.1)); // -4.0
```

`Math.round` returns `long` when given a `double`, and `int` when given a `float`.

## Power and Square Root

```java
System.out.println(Math.pow(2, 10));  // 1024.0  (2 to the power of 10)
System.out.println(Math.pow(9, 0.5)); // 3.0     (square root via fractional exponent)
System.out.println(Math.sqrt(25.0));  // 5.0
System.out.println(Math.sqrt(2.0));   // 1.4142135623730951
```

`Math.pow(base, exponent)` always returns a `double`.

## Random Numbers

`Math.random()` returns a `double` in the range **[0.0, 1.0)** — inclusive of 0.0, exclusive of 1.0.

```java
double rand = Math.random();      // e.g. 0.7341...

// Integer in range [0, n-1]
int d6 = (int)(Math.random() * 6);  // 0 to 5

// Integer in range [1, n]
int die = (int)(Math.random() * 6) + 1; // 1 to 6
```

For production code, prefer `java.util.Random` or `java.security.SecureRandom`, but know `Math.random()` for the exam.

## Mathematical Constants

```java
System.out.println(Math.PI);  // 3.141592653589793
System.out.println(Math.E);   // 2.718281828459045  (base of natural logarithm)
```

## Logarithms and Trigonometry

These are less commonly tested but worth recognising:

```java
Math.log(Math.E);    // 1.0  (natural logarithm)
Math.log10(1000);    // 3.0
Math.sin(Math.PI/2); // 1.0
Math.cos(0);         // 1.0
```

## Quick Reference Table

| Method | Return Type | Description |
|--------|-------------|-------------|
| `Math.min(a, b)` | same as args | Smaller of two values |
| `Math.max(a, b)` | same as args | Larger of two values |
| `Math.abs(x)` | same as arg | Absolute value |
| `Math.round(x)` | `long`/`int` | Round to nearest |
| `Math.ceil(x)` | `double` | Round toward positive infinity |
| `Math.floor(x)` | `double` | Round toward negative infinity |
| `Math.pow(base, exp)` | `double` | Exponentiation |
| `Math.sqrt(x)` | `double` | Square root |
| `Math.random()` | `double` | Pseudo-random [0.0, 1.0) |
| `Math.PI` | `double` (constant) | π ≈ 3.14159... |
| `Math.E` | `double` (constant) | e ≈ 2.71828... |

## Practical Example

```java
public class CircleCalculator {
    public static double area(double radius) {
        return Math.PI * Math.pow(radius, 2);
    }

    public static double hypotenuse(double a, double b) {
        return Math.sqrt(Math.pow(a, 2) + Math.pow(b, 2));
    }

    public static void main(String[] args) {
        System.out.printf("Area: %.2f%n", area(5));           // Area: 78.54
        System.out.printf("Hypotenuse: %.2f%n", hypotenuse(3, 4)); // Hypotenuse: 5.00
    }
}
```

## Exam Tips

- All `Math` methods are **static** — call them as `Math.methodName(...)`.
- `Math.round(-2.5)` returns `-2`, not `-3` — it rounds toward positive infinity.
- `Math.ceil` and `Math.floor` return `double`, even though the value is a whole number (`3.0`, not `3`).
- `Math.pow` always returns `double`; cast to `int` or `long` if needed.
- `Math.random()` range is **[0.0, 1.0)** — 0.0 can occur, 1.0 cannot.
