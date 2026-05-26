# Working with Parallel Streams

> **OCP Exam Topic** — Create and use parallel streams, understand the ForkJoinPool, recognize stateless vs stateful operations, and know when parallel streams improve or hurt performance. Covered in Chapter 13 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Creating Parallel Streams

There are two ways to obtain a parallel stream:

```java
// Option 1: from a Collection
List<Integer> numbers = List.of(1, 2, 3, 4, 5, 6, 7, 8);
Stream<Integer> parallel1 = numbers.parallelStream();

// Option 2: convert an existing stream
Stream<Integer> parallel2 = numbers.stream().parallel();
```

Both produce a stream that processes elements using multiple threads from the **ForkJoinPool**.

---

## The ForkJoinPool

Parallel streams use `ForkJoinPool.commonPool()` — a shared thread pool with a default parallelism level equal to the number of available CPU cores minus one.

```java
// Check the default parallelism level
System.out.println(ForkJoinPool.commonPool().getParallelism());
// Typically: Runtime.getRuntime().availableProcessors() - 1
```

The ForkJoin framework uses a **work-stealing** algorithm: idle threads steal tasks from the queues of busy threads, keeping all cores busy.

You can also run a parallel stream in a custom pool:

```java
ForkJoinPool customPool = new ForkJoinPool(4);
customPool.submit(() ->
    IntStream.range(0, 100)
             .parallel()
             .sum()
).get();
```

---

## Unordered Operations for Performance

By default, ordered streams (like those from `List`) preserve encounter order even in parallel — which adds synchronization overhead. Calling `unordered()` hints to the stream pipeline that order does not matter, enabling better parallelism.

```java
long count = IntStream.range(0, 1_000_000)
    .parallel()
    .unordered()           // skip ordering constraints
    .filter(n -> n % 2 == 0)
    .count();
```

`findFirst()` on an ordered parallel stream must search across threads for the first element, which is expensive. Prefer `findAny()` on parallel streams when the specific element does not matter.

```java
Optional<Integer> any = numbers.parallelStream()
    .filter(n -> n > 3)
    .findAny(); // faster than findFirst() on parallel streams
```

---

## Stateless vs Stateful Operations

### Stateless Operations (parallel-safe)

Stateless operations compute each element independently — the output depends only on the input element, not on other elements or external state.

| Operation | Stateless? |
|---|---|
| `filter(Predicate)` | Yes |
| `map(Function)` | Yes |
| `flatMap(Function)` | Yes |
| `forEach(Consumer)` | Depends on the consumer |

```java
// Safe: stateless filter and map
List<String> result = names.parallelStream()
    .filter(s -> s.length() > 3)
    .map(String::toUpperCase)
    .collect(Collectors.toList());
```

### Stateful Operations (order-sensitive or costly in parallel)

Stateful operations must consider other elements to produce a result. They can force synchronization between threads, reducing or eliminating the parallelism benefit.

| Operation | Notes |
|---|---|
| `sorted()` | Must see all elements before producing any output |
| `distinct()` | Must track all seen elements across threads |
| `limit(n)` | Must count elements across threads |
| `skip(n)` | Same challenge as `limit` |

```java
// sorted() in a parallel stream incurs significant overhead
List<Integer> sorted = numbers.parallelStream()
    .sorted()   // forces a merge-sort across all threads
    .collect(Collectors.toList());
```

---

## Thread Safety in Lambda Expressions

Lambdas passed to parallel stream operations are executed on multiple threads. Any shared mutable state inside a lambda is a race condition.

### Unsafe — shared mutable state

```java
List<Integer> results = new ArrayList<>(); // NOT thread-safe

numbers.parallelStream()
    .filter(n -> n % 2 == 0)
    .forEach(results::add); // race condition: ArrayList is not thread-safe
```

### Safe — use thread-safe collectors

```java
List<Integer> results = numbers.parallelStream()
    .filter(n -> n % 2 == 0)
    .collect(Collectors.toList()); // Collectors handle thread safety internally
```

### Safe — use a concurrent reduction

```java
int sum = numbers.parallelStream()
    .mapToInt(Integer::intValue)
    .sum(); // designed for parallel use
```

> **Exam tip:** `forEach` with a non-thread-safe collection is a classic parallel stream mistake. Always use `collect()` with standard `Collectors` or `reduce()` for aggregations.

---

## `reduce()` with Parallel Streams

The three-argument `reduce` is designed for parallel use. It requires an **identity**, an **accumulator**, and a **combiner**.

```java
// Sum of squares — safe in parallel
int sumOfSquares = numbers.parallelStream()
    .reduce(
        0,                              // identity
        (a, b) -> a + b * b,           // accumulator (element-wise)
        Integer::sum                    // combiner (merge partial results)
    );
```

The combiner merges partial results from different threads. For `reduce` to produce correct results in parallel, the accumulator and combiner must be **associative** and **stateless**.

---

## When Parallel Streams Help vs Hurt

### Parallel streams help when:

- The dataset is large (tens of thousands of elements or more).
- Operations are computationally expensive (CPU-bound work per element).
- Operations are stateless and independent.
- The data source splits efficiently (`ArrayList`, arrays — not `LinkedList`).

### Parallel streams hurt when:

- The dataset is small — thread coordination overhead exceeds the work itself.
- Operations are I/O-bound — threads spend time waiting, not computing.
- Operations are stateful (`sorted`, `distinct`, `limit`) — synchronization costs increase.
- The data source is hard to split (`LinkedList`, `BufferedReader.lines()`).
- Lambdas access shared mutable state — introduces race conditions.

```java
// Small list — sequential is faster
List<Integer> tiny = List.of(1, 2, 3);
int sum = tiny.parallelStream().mapToInt(i -> i).sum(); // parallelism overhead > benefit
```

---

## Key Points to Remember

- `parallelStream()` and `stream().parallel()` both create parallel streams backed by `ForkJoinPool.commonPool()`.
- `unordered()` and `findAny()` (instead of `findFirst()`) improve parallel stream performance when order is irrelevant.
- Stateless operations (`filter`, `map`) parallelize well; stateful operations (`sorted`, `distinct`, `limit`) add synchronization overhead.
- Never use non-thread-safe mutable state inside parallel stream lambdas — use `collect()` with standard `Collectors` or terminal reductions instead.
- The three-argument `reduce(identity, accumulator, combiner)` is the parallel-safe reduction pattern; the accumulator and combiner must be associative and stateless.
- Parallel streams benefit large, CPU-bound, splittable workloads; they hurt small datasets and I/O-bound or stateful operations.

---

## References

- [Oracle Docs — Stream.parallel()](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/Stream.html#parallel())
- [Oracle Docs — ForkJoinPool](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ForkJoinPool.html)
- OCP Study Guide, Chapter 13 — Concurrency
