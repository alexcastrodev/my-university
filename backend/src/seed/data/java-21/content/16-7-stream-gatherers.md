# Stream Gatherers — `gather()` and the `Gatherers` API (JEP 485)

> JEP 485, finalized in Java 25, adds a new `Stream.gather(Gatherer)` intermediate operation that lets you define custom, stateful stream transformations that the built-in `map`, `filter`, and `flatMap` cannot express. This lesson covers the `Gatherer` interface, the built-in `Gatherers` utility class, and practical examples of each.

---

## Why Gatherers?

Java streams provide rich built-in operations, but some transformations require **internal state** or **control over how many elements are produced per input**. Before JEP 485, such operations had to be implemented with `reduce`, `collect`, or by materializing the stream to a list first — all of which break the lazy evaluation model.

Examples of transformations that gatherers enable cleanly:
- Grouping consecutive elements into fixed-size windows
- Computing a running total (scan)
- Taking elements until a condition changes
- Running tasks concurrently with backpressure control

---

## The `Stream.gather()` Method

`gather()` is a new **intermediate operation** on `Stream<T>`:

```java
<R> Stream<R> gather(Gatherer<? super T, ?, R> gatherer)
```

It fits naturally into a stream pipeline:

```java
import java.util.stream.Gatherers;

List<Integer> numbers = List.of(1, 2, 3, 4, 5, 6, 7, 8);

List<List<Integer>> windows = numbers.stream()
    .gather(Gatherers.windowFixed(3))   // gather() call
    .toList();

// [[1, 2, 3], [4, 5, 6], [7, 8]]
```

---

## The `Gatherer` Interface

A `Gatherer<T, A, R>` is defined by up to four components:

| Component | Type | Description |
|---|---|---|
| `initializer` | `Supplier<A>` | Creates the initial mutable state (`A`) |
| `integrator` | `Integrator<A, T, R>` | Processes each element; returns `false` to stop early |
| `combiner` | `BinaryOperator<A>` | Merges states for parallel streams |
| `finisher` | `BiConsumer<A, Downstream<R>>` | Called after all elements; emits any buffered output |

```java
// Custom gatherer: group every N elements into a list
Gatherer<Integer, List<Integer>, List<Integer>> groupByThree =
    Gatherer.ofSequential(
        ArrayList::new,                          // initializer
        (state, element, downstream) -> {        // integrator
            state.add(element);
            if (state.size() == 3) {
                downstream.push(new ArrayList<>(state));
                state.clear();
            }
            return true;  // continue
        },
        (state, downstream) -> {                 // finisher
            if (!state.isEmpty()) downstream.push(new ArrayList<>(state));
        }
    );
```

In practice, you rarely implement `Gatherer` directly — the built-in `Gatherers` class covers the most common cases.

---

## Built-in Gatherers

The `java.util.stream.Gatherers` class provides ready-to-use gatherers:

### `windowFixed(int n)` — Fixed-size non-overlapping windows

Collects elements into lists of exactly `n` elements. The last window may be smaller.

```java
List.of(1, 2, 3, 4, 5).stream()
    .gather(Gatherers.windowFixed(2))
    .toList();
// [[1, 2], [3, 4], [5]]
```

### `windowSliding(int n)` — Sliding windows

Produces a window of `n` elements for every element (overlapping).

```java
List.of(1, 2, 3, 4, 5).stream()
    .gather(Gatherers.windowSliding(3))
    .toList();
// [[1, 2, 3], [2, 3, 4], [3, 4, 5]]
```

### `scan(identity, accumulator)` — Running accumulation (like reduce but emits each step)

Emits each intermediate accumulated value, starting from `identity`.

```java
List.of(1, 2, 3, 4, 5).stream()
    .gather(Gatherers.scan(0, Integer::sum))
    .toList();
// [1, 3, 6, 10, 15]  — running sum
```

### `fold(identity, accumulator)` — Full reduction as a single element

Like `reduce`, but emits only one element (the final accumulated value) as a stream.

```java
List.of(1, 2, 3, 4, 5).stream()
    .gather(Gatherers.fold(0, Integer::sum))
    .toList();
// [15]  — single-element stream
```

### `mapConcurrent(int n, mapper)` — Concurrent mapping with backpressure

Applies a mapping function concurrently with at most `n` virtual threads in flight at once. Order is preserved.

```java
List<String> urls = List.of("url1", "url2", "url3", "url4");

List<String> results = urls.stream()
    .gather(Gatherers.mapConcurrent(2, this::fetchContent))  // max 2 concurrent
    .toList();
```

### Built-in Gatherers Summary

| Gatherer | Output per input | State | Use case |
|---|---|---|---|
| `windowFixed(n)` | 1 list per n elements | Buffer | Batch processing |
| `windowSliding(n)` | 1 list per element | Buffer | Moving average, trend |
| `scan(id, acc)` | 1 value per element | Accumulated value | Running totals |
| `fold(id, acc)` | 1 value total | Accumulated value | Single-result aggregation |
| `mapConcurrent(n, f)` | 1 per element | Concurrency control | Parallel I/O with ordering |

---

## Composing Gatherers

Gatherers can be composed with `andThen()`:

```java
// Slide a window of 3, then sum each window
List.of(1, 2, 3, 4, 5, 6).stream()
    .gather(Gatherers.windowSliding(3)
                     .andThen(Gatherers.fold(0, (sum, win) ->
                         sum + win.stream().mapToInt(Integer::intValue).sum())))
    .toList();
// Not typical — shown to illustrate .andThen()
```

---

## Parallel Streams and Gatherers

Most built-in gatherers are **sequential** (state cannot be easily split). For parallel streams, use `mapConcurrent`, which is explicitly designed for concurrent execution. Applying a sequential gatherer to a parallel stream causes the stream to be processed sequentially for that step.

---

## `gather()` vs Other Intermediate Operations

| Operation | Stateful | Custom elements per input | Built-in examples |
|---|---|---|---|
| `map()` | No | 1 output per 1 input | `String::toUpperCase` |
| `filter()` | No | 0 or 1 per input | `n -> n > 0` |
| `flatMap()` | No | 0–N per input | `List::stream` |
| `gather()` | Yes | 0–N per element, with state | window, scan, fold |

---

## Key Rules Summary

- `Stream.gather(Gatherer)` is a new intermediate operation finalized in Java 25 (JEP 485).
- A `Gatherer` has four optional components: initializer, integrator, combiner, finisher.
- `Gatherers.windowFixed(n)` — non-overlapping windows of size n.
- `Gatherers.windowSliding(n)` — overlapping windows; one per element.
- `Gatherers.scan(id, acc)` — emits each running accumulated value.
- `Gatherers.fold(id, acc)` — emits one final accumulated value.
- `Gatherers.mapConcurrent(n, f)` — concurrent mapping with bounded parallelism, preserving order.
- Gatherers compose with `.andThen()`.

---

## References

- [JEP 485 — Stream Gatherers](https://openjdk.org/jeps/485)
- [Javadoc — java.util.stream.Gatherer](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html)
- [Javadoc — java.util.stream.Gatherers](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
