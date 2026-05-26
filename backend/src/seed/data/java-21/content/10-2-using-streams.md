# Using Streams

> A stream is a sequence of elements supporting sequential and parallel aggregate operations. Streams do not store data — they describe a pipeline of transformations applied to a source.

---

## The Stream Pipeline Model

Every stream pipeline has three parts:

1. **Source** — produces elements (collection, array, generator, …)
2. **Intermediate operations** — transform the stream lazily; return a new `Stream`
3. **Terminal operation** — triggers execution and produces a result or side-effect

```
source → [intermediate op] → [intermediate op] → terminal op
```

A stream is **lazy**: intermediate operations are not executed until a terminal operation is invoked.

---

## Creating Streams

### From collections and arrays

```java
List<String> list = List.of("a", "b", "c");
Stream<String> s1 = list.stream();

String[] arr = {"x", "y", "z"};
Stream<String> s2 = Arrays.stream(arr);
```

### Stream.of

```java
Stream<Integer> s = Stream.of(1, 2, 3, 4, 5);
```

### Stream.generate — infinite, each element produced by a Supplier

```java
Stream<Double> randoms = Stream.generate(Math::random);
// must be limited before a terminal operation
randoms.limit(5).forEach(System.out::println);
```

### Stream.iterate — infinite, each element derived from the previous

```java
// Two-arg form (infinite)
Stream<Integer> evens = Stream.iterate(0, n -> n + 2);
evens.limit(5).forEach(System.out::println); // 0 2 4 6 8

// Three-arg form (Java 9+, acts like a for-loop)
Stream<Integer> upTo10 = Stream.iterate(0, n -> n < 10, n -> n + 2);
upTo10.forEach(System.out::println); // 0 2 4 6 8
```

### Empty and concatenated streams

```java
Stream<String> empty  = Stream.empty();
Stream<String> concat = Stream.concat(Stream.of("a"), Stream.of("b"));
```

---

## Intermediate Operations

Intermediate operations return a `Stream` and are **lazy** — they build up a description of work but do nothing until a terminal operation is reached.

| Operation | Signature | Description |
|---|---|---|
| `filter` | `filter(Predicate<T>)` | Keeps elements matching the predicate |
| `map` | `map(Function<T,R>)` | Transforms each element |
| `flatMap` | `flatMap(Function<T, Stream<R>>)` | Flattens nested streams |
| `distinct` | `distinct()` | Removes duplicates (uses `equals`) |
| `sorted` | `sorted()` / `sorted(Comparator)` | Sorts elements |
| `peek` | `peek(Consumer<T>)` | Inspects each element without modifying |
| `limit` | `limit(long)` | Truncates stream to at most n elements |
| `skip` | `skip(long)` | Discards first n elements |

```java
List<String> words = List.of("hello", "world", "java", "streams", "hello");

List<String> result = words.stream()
    .filter(w -> w.length() > 4)      // "hello", "world", "streams", "hello"
    .map(String::toUpperCase)          // "HELLO", "WORLD", "STREAMS", "HELLO"
    .distinct()                        // "HELLO", "WORLD", "STREAMS"
    .sorted()                          // "HELLO", "STREAMS", "WORLD"
    .toList();

System.out.println(result); // [HELLO, STREAMS, WORLD]
```

### flatMap example

```java
List<List<Integer>> nested = List.of(
    List.of(1, 2),
    List.of(3, 4),
    List.of(5)
);

List<Integer> flat = nested.stream()
    .flatMap(Collection::stream)
    .toList();

System.out.println(flat); // [1, 2, 3, 4, 5]
```

---

## Terminal Operations

Terminal operations consume the stream and produce a result. After a terminal operation, the stream is **closed** and cannot be reused.

| Operation | Returns | Description |
|---|---|---|
| `forEach(Consumer)` | `void` | Processes each element |
| `count()` | `long` | Number of elements |
| `collect(Collector)` | varies | Accumulates into a collection or value |
| `toList()` | `List<T>` | Collects to an unmodifiable list (Java 16+) |
| `min(Comparator)` | `Optional<T>` | Minimum element |
| `max(Comparator)` | `Optional<T>` | Maximum element |
| `findFirst()` | `Optional<T>` | First element in encounter order |
| `findAny()` | `Optional<T>` | Any element (useful with parallel streams) |
| `anyMatch(Predicate)` | `boolean` | True if any element matches |
| `allMatch(Predicate)` | `boolean` | True if all elements match |
| `noneMatch(Predicate)` | `boolean` | True if no elements match |
| `reduce(identity, BinaryOperator)` | `T` | Folds elements into one value |
| `reduce(BinaryOperator)` | `Optional<T>` | Same but no identity — returns Optional |

```java
List<Integer> nums = List.of(3, 1, 4, 1, 5, 9, 2, 6);

long count   = nums.stream().count();                                 // 8
int  sum     = nums.stream().reduce(0, Integer::sum);                 // 31
Optional<Integer> max = nums.stream().max(Comparator.naturalOrder()); // Optional[9]

boolean anyOver8  = nums.stream().anyMatch(n -> n > 8);  // true
boolean allPositive = nums.stream().allMatch(n -> n > 0); // true
boolean noneNeg   = nums.stream().noneMatch(n -> n < 0); // true
```

---

## Lazy Evaluation and Short-Circuit Operations

Streams do not process elements until the terminal operation demands them. This means intermediate operations compose into a single pass.

**Short-circuit** operations can stop processing before consuming the entire stream:

| Operation | Type | Short-circuits? |
|---|---|---|
| `limit(n)` | Intermediate | Yes |
| `findFirst()` | Terminal | Yes |
| `findAny()` | Terminal | Yes |
| `anyMatch()` | Terminal | Yes — stops at first match |
| `allMatch()` | Terminal | Yes — stops at first non-match |
| `noneMatch()` | Terminal | Yes — stops at first match |

```java
// Only the first 3 elements are ever processed
Stream.iterate(1, n -> n + 1)  // infinite
    .filter(n -> n % 2 == 0)
    .limit(3)
    .forEach(System.out::println); // 2, 4, 6
```

> **Exam tip:** A stream pipeline with `Stream.generate` or two-argument `Stream.iterate` will run forever if no short-circuit operation or `limit` is present.

---

## peek for Debugging

`peek` is an intermediate operation that runs a `Consumer` on each element without changing the stream. It is intended for debugging, not for side effects in production code.

```java
List<Integer> result = Stream.of(1, 2, 3, 4, 5)
    .filter(n -> n % 2 != 0)
    .peek(n -> System.out.println("after filter: " + n))
    .map(n -> n * 10)
    .peek(n -> System.out.println("after map: " + n))
    .toList();
```

---

## Key Rules Summary

- A stream pipeline = source + zero or more intermediate ops + one terminal op.
- Intermediate operations are lazy; nothing executes until the terminal op is called.
- A stream can only be consumed once — reusing it throws `IllegalStateException`.
- `Stream.generate` and `Stream.iterate` (two-arg) produce infinite streams; always pair with `limit` or a short-circuit terminal op.
- `flatMap` is `map` + flatten: use it when the mapping function returns a `Stream`.

---

## References

- [Oracle Docs — Stream](https://docs.oracle.com/en/java/docs/api/java.base/java/util/stream/Stream.html)
- OCP Study Guide, Chapter 10 — Streams
