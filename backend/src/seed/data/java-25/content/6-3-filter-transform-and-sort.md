---
version: 1.0
updatedAt: 2026-05-26
---
# Filter, Transform, and Sort

---

## Intermediate Operations

Intermediate operations return a new `Stream` and are **lazy** — they do not execute until a terminal operation is called.

---

## filter

Keeps only elements that satisfy a `Predicate`:

```java
Stream.of(1, 2, 3, 4, 5, 6)
      .filter(n -> n % 2 == 0)
      .forEach(System.out::println);   // 2 4 6
```

---

## map

Transforms each element using a `Function<T, R>`:

```java
Stream.of("hello", "world")
      .map(String::toUpperCase)
      .forEach(System.out::println);   // HELLO WORLD

// primitive map variants
Stream.of("one", "two", "three")
      .mapToInt(String::length)        // IntStream
      .forEach(System.out::println);   // 3 3 5
```

---

## flatMap

Maps each element to a stream and then flattens all resulting streams into one:

```java
Stream.of(List.of(1, 2), List.of(3, 4), List.of(5))
      .flatMap(Collection::stream)
      .forEach(System.out::println);   // 1 2 3 4 5

// splitting words into letters
Stream.of("foo", "bar")
      .flatMap(s -> Arrays.stream(s.split("")))
      .distinct()
      .sorted()
      .forEach(System.out::print);     // abfor
```

---

## distinct, sorted, limit, skip, peek

```java
Stream.of(3, 1, 4, 1, 5, 9, 2, 6, 5)
      .distinct()          // remove duplicates: 3 1 4 5 9 2 6
      .sorted()            // natural order: 1 2 3 4 5 6 9
      .skip(2)             // skip first 2: 3 4 5 6 9
      .limit(3)            // keep first 3: 3 4 5
      .forEach(System.out::println);

// sorted with Comparator
Stream.of("banana", "apple", "cherry")
      .sorted(Comparator.comparingInt(String::length))
      .forEach(System.out::println);   // apple banana cherry
```

`peek` is for debugging — it executes a `Consumer` on each element without consuming the stream:

```java
Stream.of(1, 2, 3)
      .peek(n -> System.out.print("before=" + n + " "))
      .map(n -> n * 10)
      .peek(n -> System.out.print("after=" + n + " "))
      .forEach(n -> {});
// before=1 after=10 before=2 after=20 before=3 after=30
```

---

## mapMulti (Java 16+)

An alternative to `flatMap` for cases where a `Consumer` output is more natural:

```java
Stream.of(1, 2, 3)
      .<Integer>mapMulti((n, consumer) -> {
          consumer.accept(n);
          consumer.accept(n * 10);
      })
      .forEach(System.out::println);   // 1 10 2 20 3 30
```

---

## takeWhile and dropWhile (Java 9+)

Process elements based on an ordered predicate — useful with sorted or predictable streams:

```java
Stream.of(1, 2, 3, 4, 5, 4, 3)
      .takeWhile(n -> n < 4)      // 1 2 3  — stops at first false
      .forEach(System.out::println);

Stream.of(1, 2, 3, 4, 5)
      .dropWhile(n -> n < 3)      // 3 4 5  — drops until first false
      .forEach(System.out::println);
```

---

## Chaining a Pipeline

```java
List<String> result = Stream.of("  Alice ", "Bob", "  carol", "David", "eve")
    .map(String::trim)
    .filter(s -> s.length() > 3)
    .map(s -> s.substring(0, 1).toUpperCase() + s.substring(1).toLowerCase())
    .sorted()
    .collect(Collectors.toList());

// [Alice, Carol, David]
```

---

## Key Rules

| Operation | Returns | Notes |
|-----------|---------|-------|
| `filter` | `Stream<T>` | Same type |
| `map` | `Stream<R>` | Can change type |
| `flatMap` | `Stream<R>` | Flattens one level |
| `distinct` | `Stream<T>` | Uses `equals()` |
| `sorted()` | `Stream<T>` | Natural order; must be `Comparable` |
| `sorted(c)` | `Stream<T>` | Custom `Comparator` |
| `limit(n)` | `Stream<T>` | Max n elements |
| `skip(n)` | `Stream<T>` | Drop first n |
| `peek` | `Stream<T>` | Side-effect only; don't rely on it for logic |
| `takeWhile` | `Stream<T>` | Ordered streams only |
| `dropWhile` | `Stream<T>` | Ordered streams only |
