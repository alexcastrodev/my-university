# Working with Built-in Functional Interfaces

> **OCP Exam Topic** — Use built-in functional interfaces from `java.util.function`. Covered in Chapter 8 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Overview

The `java.util.function` package provides a standard library of functional interfaces that cover the most common patterns. Knowing their method signatures and return types is essential for the exam.

---

## Core Single-Type Interfaces

### Predicate\<T>

Tests a condition on an object. Returns `boolean`.

- Abstract method: `boolean test(T t)`
- Key defaults: `and`, `or`, `negate`

```java
import java.util.function.Predicate;

Predicate<String> isLong = s -> s.length() > 5;
Predicate<String> startsA = s -> s.startsWith("A");

System.out.println(isLong.test("Java"));            // false
System.out.println(isLong.and(startsA).test("Algorithms")); // true
System.out.println(isLong.negate().test("Hi"));     // true
```

### Consumer\<T>

Accepts one argument and returns nothing. Typically used for side effects.

- Abstract method: `void accept(T t)`
- Key default: `andThen`

```java
import java.util.function.Consumer;

Consumer<String> print = System.out::println;
Consumer<String> shout = s -> System.out.println(s.toUpperCase());

Consumer<String> printThenShout = print.andThen(shout);
printThenShout.accept("hello"); // prints "hello" then "HELLO"
```

### Supplier\<T>

Produces a value without taking any input. Useful for lazy evaluation and factories.

- Abstract method: `T get()`

```java
import java.util.function.Supplier;

Supplier<Double> random = Math::random;
System.out.println(random.get()); // some double between 0.0 and 1.0
```

### Function\<T, R>

Transforms an input of type `T` into an output of type `R`.

- Abstract method: `R apply(T t)`
- Key defaults: `andThen`, `compose`
- Key static: `identity()`

```java
import java.util.function.Function;

Function<String, Integer> length  = String::length;
Function<Integer, String> toHex   = Integer::toHexString;

Function<String, String> pipeline = length.andThen(toHex);
System.out.println(pipeline.apply("Hello")); // "5"
```

### UnaryOperator\<T>

A specialisation of `Function<T, T>` where input and output are the same type.

- Abstract method: `T apply(T t)` (inherited from `Function`)

```java
import java.util.function.UnaryOperator;

UnaryOperator<String> trim = String::strip;
System.out.println(trim.apply("  hello  ")); // "hello"
```

### BinaryOperator\<T>

A specialisation of `BiFunction<T, T, T>` where both inputs and the output share the same type.

- Abstract method: `T apply(T t1, T t2)` (inherited from `BiFunction`)

```java
import java.util.function.BinaryOperator;

BinaryOperator<Integer> max = (a, b) -> a > b ? a : b;
System.out.println(max.apply(7, 3)); // 7
```

---

## Bi- Variants

These accept **two** input parameters.

| Interface | Abstract Method | Description |
|---|---|---|
| `BiPredicate<T, U>` | `boolean test(T t, U u)` | Test with two inputs |
| `BiConsumer<T, U>` | `void accept(T t, U u)` | Consume two inputs, no return |
| `BiFunction<T, U, R>` | `R apply(T t, U u)` | Transform two inputs to output |

```java
import java.util.function.*;

BiPredicate<String, Integer> longerThan = (s, n) -> s.length() > n;
System.out.println(longerThan.test("Java", 3)); // true

BiConsumer<String, Integer> print = (s, n) -> System.out.println(s.repeat(n));
print.accept("ha", 3); // "hahaha"

BiFunction<String, String, String> concat = (a, b) -> a + b;
System.out.println(concat.apply("Hello, ", "World!")); // "Hello, World!"
```

---

## Quick Reference Table

| Interface | Method | Input | Output |
|---|---|---|---|
| `Predicate<T>` | `test(T)` | T | boolean |
| `Consumer<T>` | `accept(T)` | T | void |
| `Supplier<T>` | `get()` | — | T |
| `Function<T,R>` | `apply(T)` | T | R |
| `UnaryOperator<T>` | `apply(T)` | T | T |
| `BinaryOperator<T>` | `apply(T,T)` | T, T | T |
| `BiPredicate<T,U>` | `test(T,U)` | T, U | boolean |
| `BiConsumer<T,U>` | `accept(T,U)` | T, U | void |
| `BiFunction<T,U,R>` | `apply(T,U)` | T, U | R |

---

## Primitive Specialisations

Using generic interfaces like `Function<Integer, Boolean>` boxes and unboxes primitives on every call, which harms performance. Java provides primitive variants to avoid this.

### Predicate Variants

| Interface | Method |
|---|---|
| `IntPredicate` | `boolean test(int value)` |
| `LongPredicate` | `boolean test(long value)` |
| `DoublePredicate` | `boolean test(double value)` |

```java
import java.util.function.IntPredicate;

IntPredicate isEven = n -> n % 2 == 0;
System.out.println(isEven.test(4));  // true
System.out.println(isEven.test(7));  // false
```

### Function Variants (selected)

| Interface | Method | Description |
|---|---|---|
| `IntFunction<R>` | `R apply(int value)` | int → R |
| `LongFunction<R>` | `R apply(long value)` | long → R |
| `DoubleFunction<R>` | `R apply(double value)` | double → R |
| `ToIntFunction<T>` | `int applyAsInt(T value)` | T → int |
| `ToLongFunction<T>` | `long applyAsLong(T value)` | T → long |
| `ToDoubleFunction<T>` | `double applyAsDouble(T value)` | T → double |
| `IntUnaryOperator` | `int applyAsInt(int)` | int → int |
| `IntBinaryOperator` | `int applyAsInt(int, int)` | int, int → int |

```java
import java.util.function.*;

ToIntFunction<String> length = String::length;
System.out.println(length.applyAsInt("OCP")); // 3

IntBinaryOperator add = (a, b) -> a + b;
System.out.println(add.applyAsInt(3, 4)); // 7
```

---

## Key Points to Remember

- `Predicate` tests; `Consumer` consumes; `Supplier` supplies; `Function` transforms.
- `UnaryOperator` extends `Function` for same-type transformations; `BinaryOperator` extends `BiFunction`.
- `Bi` variants accept two parameters instead of one.
- Primitive specialisations (`IntPredicate`, `LongFunction`, `ToIntFunction`, etc.) avoid autoboxing overhead.
- Memorise which abstract method name each interface uses: `test`, `accept`, `get`, `apply`.
