# Working with Advanced Stream Pipeline Concepts

> **OCP Exam Topic** — Use advanced Collectors, parallel streams, and understand `collect` vs `reduce`. Covered in Chapter 10 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Collectors in Depth

`Collectors` (in `java.util.stream`) provides factory methods for common reduction strategies used with `Stream.collect()`.

### toList, toSet, toUnmodifiableList

```java
import java.util.stream.Collectors;

List<String> names = Stream.of("Alice", "Bob", "Charlie")
    .collect(Collectors.toList());             // mutable list

List<String> fixed = Stream.of("Alice", "Bob")
    .collect(Collectors.toUnmodifiableList()); // throws on modification

Set<String> nameSet = Stream.of("Alice", "Bob", "Alice")
    .collect(Collectors.toSet());              // {"Alice", "Bob"}
```

### toMap

```java
Map<String, Integer> lengthMap = Stream.of("Alice", "Bob", "Charlie")
    .collect(Collectors.toMap(
        s -> s,          // key mapper
        String::length   // value mapper
    ));
// {Alice=5, Bob=3, Charlie=7}
```

When duplicate keys are possible, provide a merge function:

```java
Map<Integer, String> merged = Stream.of("Alice", "Bob", "Al")
    .collect(Collectors.toMap(
        String::length,
        s -> s,
        (existing, replacement) -> existing + "," + replacement
    ));
// {5=Alice, 3=Bob,Al}
```

### groupingBy

Groups elements into a `Map<K, List<V>>` by a classifier function:

```java
Map<Integer, List<String>> byLength = Stream.of("a", "bb", "cc", "ddd")
    .collect(Collectors.groupingBy(String::length));
// {1=[a], 2=[bb, cc], 3=[ddd]}
```

With a downstream collector:

```java
Map<Integer, Long> countByLength = Stream.of("a", "bb", "cc", "ddd")
    .collect(Collectors.groupingBy(String::length, Collectors.counting()));
// {1=1, 2=2, 3=1}
```

### partitioningBy

Splits elements into a `Map<Boolean, List<T>>` based on a predicate:

```java
Map<Boolean, List<String>> partitioned = Stream.of("Alice", "Bob", "Charlie", "Dan")
    .collect(Collectors.partitioningBy(s -> s.length() > 3));
// {true=[Alice, Charlie], false=[Bob, Dan]}
```

### counting, joining, summarizingInt

```java
long count = Stream.of("a", "b", "c").collect(Collectors.counting()); // 3

String joined = Stream.of("Alice", "Bob", "Charlie")
    .collect(Collectors.joining(", ", "[", "]")); // [Alice, Bob, Charlie]

IntSummaryStatistics stats = Stream.of("apple", "banana", "cherry")
    .collect(Collectors.summarizingInt(String::length));
// count=3, sum=17, min=5, max=6
```

### mapping and teeing

`mapping` applies a function before feeding elements to a downstream collector:

```java
Map<Integer, List<Character>> firstByLength = Stream.of("Alice", "Bob", "Anna")
    .collect(Collectors.groupingBy(
        String::length,
        Collectors.mapping(s -> s.charAt(0), Collectors.toList())
    ));
// {5=[A, A], 3=[B]}
```

`teeing` (Java 12+) feeds the stream into two collectors and merges their results:

```java
record MinMax(int min, int max) { }

MinMax result = IntStream.of(3, 1, 4, 1, 5).boxed()
    .collect(Collectors.teeing(
        Collectors.minBy(Integer::compareTo),
        Collectors.maxBy(Integer::compareTo),
        (min, max) -> new MinMax(min.get(), max.get())
    ));
System.out.println(result); // MinMax[min=1, max=5]
```

---

## Parallel Streams

A parallel stream uses the common ForkJoinPool to split the source, process chunks on multiple threads, and combine the results.

### Creating a Parallel Stream

```java
// From a collection
List<Integer> numbers = List.of(1, 2, 3, 4, 5);
numbers.parallelStream().forEach(System.out::println); // order not guaranteed

// Converting an existing stream
Stream<String> parallel = Stream.of("a", "b", "c").parallel();

// Reverting to sequential
Stream<String> sequential = parallel.sequential();
```

### When Parallel Streams Help (and Hurt)

Parallel streams benefit large datasets with CPU-intensive, stateless, independent operations. They add overhead for small collections or operations with shared mutable state.

```java
// Good candidate — large, stateless computation
long count = LongStream.rangeClosed(1, 10_000_000L)
    .parallel()
    .filter(n -> n % 2 == 0)
    .count();
```

### Thread Safety Requirements

The accumulator and combiner passed to `reduce` and `collect` must be **stateless** and **associative**. Collectors from `Collectors` are safe to use with parallel streams. Using a shared mutable object (like a plain `ArrayList`) in a parallel `forEach` is not thread-safe.

```java
// UNSAFE — shared ArrayList with parallel stream
List<String> result = new ArrayList<>();
Stream.of("a", "b", "c").parallel().forEach(result::add); // data corruption risk

// SAFE — collect into a thread-safe reduction
List<String> safe = Stream.of("a", "b", "c")
    .parallel()
    .collect(Collectors.toList());
```

---

## collect vs reduce

Both are terminal operations that produce a single result from a stream, but they differ in intent and implementation.

| | `reduce` | `collect` |
|---|---|---|
| Result type | Usually an immutable value | Usually a mutable container |
| Approach | Combines elements with a `BinaryOperator` | Accumulates into a container via `Collector` |
| Parallel efficiency | Can be slow if combiner is expensive | Designed for efficient parallel accumulation |

```java
// reduce — builds an immutable result
Optional<Integer> sum = Stream.of(1, 2, 3, 4).reduce((a, b) -> a + b); // Optional[10]
int sumWithIdentity = Stream.of(1, 2, 3, 4).reduce(0, Integer::sum);   // 10

// collect — builds a mutable container
List<Integer> list = Stream.of(1, 2, 3, 4).collect(Collectors.toList());
String joined = Stream.of("a", "b", "c").collect(Collectors.joining("-")); // "a-b-c"
```

Use `reduce` when combining immutable values (sum, product, concatenation of immutable strings). Use `collect` when building a collection or a mutable container.

---

## Key Points to Remember

- `Collectors.toMap` throws `IllegalStateException` on duplicate keys unless a merge function is provided.
- `groupingBy` produces `Map<K, List<V>>`; a downstream collector can change the value type.
- `partitioningBy` always produces a `Map<Boolean, List<T>>` with exactly two keys (`true` and `false`).
- `joining(delimiter, prefix, suffix)` concatenates string elements.
- `parallelStream()` and `.parallel()` enable parallel processing using the common ForkJoinPool.
- Parallel streams require stateless, associative accumulation; avoid shared mutable state.
- `reduce` combines immutable values; `collect` accumulates into a mutable container.
- `teeing` (Java 12+) passes stream elements to two collectors and merges their results with a `BiFunction`.
