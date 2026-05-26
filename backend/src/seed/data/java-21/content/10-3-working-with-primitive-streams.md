# Working with Primitive Streams

> **OCP Exam Topic** — Use `IntStream`, `LongStream`, and `DoubleStream` to process primitives without boxing overhead. Covered in Chapter 10 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Why Primitive Streams?

A `Stream<Integer>` boxes each `int` value into an `Integer` object, creating unnecessary heap allocations. Java provides three primitive stream specializations that work directly with unboxed values:

| Stream Type | Primitive Type |
|---|---|
| `IntStream` | `int` |
| `LongStream` | `long` |
| `DoubleStream` | `double` |

Each offers the full set of intermediate and terminal operations from `Stream`, plus numeric-specific operations.

---

## Creating Primitive Streams

```java
import java.util.stream.IntStream;
import java.util.stream.LongStream;
import java.util.stream.DoubleStream;

// From literal values
IntStream ints = IntStream.of(1, 2, 3, 4, 5);

// Range — end is exclusive
IntStream range = IntStream.range(1, 6);        // 1, 2, 3, 4, 5

// RangeClosed — end is inclusive
IntStream closed = IntStream.rangeClosed(1, 5); // 1, 2, 3, 4, 5

// Infinite streams (use limit)
LongStream longs = LongStream.iterate(0L, n -> n + 2).limit(5); // 0, 2, 4, 6, 8

// From an array
DoubleStream doubles = DoubleStream.of(1.1, 2.2, 3.3);
```

---

## range vs rangeClosed

```java
IntStream.range(1, 5).forEach(System.out::print);      // 1234  (excludes 5)
IntStream.rangeClosed(1, 5).forEach(System.out::print); // 12345 (includes 5)

// Common use: iterating a fixed number of times
IntStream.range(0, 10).forEach(i -> System.out.print(i + " "));
```

---

## Numeric Terminal Operations

These are unique to primitive streams and do not exist on `Stream<T>`:

| Method | Return Type | Description |
|---|---|---|
| `sum()` | `int` / `long` / `double` | Sum of all elements |
| `average()` | `OptionalDouble` | Arithmetic mean |
| `min()` | `OptionalInt` / `OptionalLong` / `OptionalDouble` | Smallest element |
| `max()` | `OptionalInt` / `OptionalLong` / `OptionalDouble` | Largest element |
| `count()` | `long` | Number of elements |
| `summaryStatistics()` | `IntSummaryStatistics` etc. | Count, sum, min, max, average in one pass |

```java
IntStream numbers = IntStream.of(3, 1, 4, 1, 5, 9, 2, 6);

System.out.println(numbers.sum());          // 31
// Note: stream is consumed — create a new one for each terminal op

int[] arr = {3, 1, 4, 1, 5, 9, 2, 6};
System.out.println(IntStream.of(arr).average().getAsDouble()); // 3.875
System.out.println(IntStream.of(arr).min().getAsInt());        // 1
System.out.println(IntStream.of(arr).max().getAsInt());        // 9

IntSummaryStatistics stats = IntStream.of(arr).summaryStatistics();
System.out.println(stats.getCount());   // 8
System.out.println(stats.getSum());     // 31
System.out.println(stats.getMin());     // 1
System.out.println(stats.getMax());     // 9
System.out.println(stats.getAverage()); // 3.875
```

---

## Converting Between Primitive and Object Streams

### Primitive to Object

| Method | Result |
|---|---|
| `boxed()` | `Stream<Integer>` / `Stream<Long>` / `Stream<Double>` |
| `mapToObj(function)` | `Stream<R>` using a mapping function |

```java
Stream<Integer> boxed = IntStream.range(1, 4).boxed(); // Stream<Integer>

Stream<String> strings = IntStream.range(1, 4)
    .mapToObj(i -> "item-" + i); // ["item-1", "item-2", "item-3"]
```

### Object to Primitive

| Method | Result |
|---|---|
| `mapToInt(toIntFunction)` | `IntStream` |
| `mapToLong(toLongFunction)` | `LongStream` |
| `mapToDouble(toDoubleFunction)` | `DoubleStream` |

```java
List<String> words = List.of("apple", "banana", "cherry");

int totalLength = words.stream()
    .mapToInt(String::length)
    .sum();

System.out.println(totalLength); // 17
```

### Between Primitive Streams

```java
IntStream  ints    = IntStream.of(1, 2, 3);
LongStream longs   = ints.asLongStream();       // IntStream → LongStream
DoubleStream dubs  = IntStream.of(1, 2, 3).asDoubleStream(); // IntStream → DoubleStream
```

---

## When to Use Primitive Streams vs Object Streams

| Use Primitive Stream When | Use `Stream<T>` When |
|---|---|
| Working with raw `int`, `long`, or `double` values | Working with objects or mixed types |
| You need `sum`, `average`, `summaryStatistics` | You need `Collectors.toList()`, `groupingBy`, etc. |
| Performance matters and boxing should be avoided | The type doesn't map to a primitive specialization |

```java
// Prefer this — no boxing
int sum = IntStream.rangeClosed(1, 100).sum();

// Avoid this — boxes every int to Integer
int sum2 = Stream.iterate(1, n -> n + 1)
    .limit(100)
    .mapToInt(Integer::intValue)
    .sum();
```

---

## Key Points to Remember

- `IntStream`, `LongStream`, and `DoubleStream` avoid boxing overhead when working with primitives.
- `range(start, end)` is exclusive of end; `rangeClosed(start, end)` is inclusive.
- Numeric terminal operations (`sum`, `average`, `min`, `max`, `summaryStatistics`) are only on primitive streams.
- `average()`, `min()`, and `max()` return `OptionalDouble`, `OptionalInt`, or `OptionalLong` — handle the empty case.
- `boxed()` converts a primitive stream to the equivalent `Stream<Wrapper>`.
- `mapToInt`, `mapToLong`, `mapToDouble` convert a `Stream<T>` to the corresponding primitive stream.
- `mapToObj` converts a primitive stream to `Stream<R>` using a mapping function.
