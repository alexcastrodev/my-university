---
version: 1.0
updatedAt: 2026-05-26
---
# Stream Gatherers — gather() and the Gatherers API (JEP 485)

> **JEP 485** — finalized in Java 25. Adds `Stream.gather(Gatherer)` as a general-purpose intermediate operation.

---

## Motivation

Before Java 25, certain stateful or many-to-many intermediate transformations required awkward workarounds:

- Sliding windows of N elements
- Fixed-size batches
- Scan (running prefix aggregation)
- Deduplication with custom state

`gather()` provides a structured way to express these patterns.

---

## gather() Method

```java
<R> Stream<R> gather(Gatherer<? super T, ?, R> gatherer)
```

It sits in the pipeline like any intermediate operation:

```java
stream.filter(...).gather(myGatherer).map(...).collect(...);
```

---

## Built-in Gatherers (`java.util.stream.Gatherers`)

### windowFixed — fixed-size non-overlapping batches

```java
Stream.of(1, 2, 3, 4, 5, 6, 7)
      .gather(Gatherers.windowFixed(3))
      .forEach(System.out::println);
// [1, 2, 3]
// [4, 5, 6]
// [7]          ← partial window at end
```

### windowSliding — overlapping sliding window

```java
Stream.of(1, 2, 3, 4, 5)
      .gather(Gatherers.windowSliding(3))
      .forEach(System.out::println);
// [1, 2, 3]
// [2, 3, 4]
// [3, 4, 5]
```

### scan — running prefix reduction

```java
Stream.of(1, 2, 3, 4, 5)
      .gather(Gatherers.scan(() -> 0, Integer::sum))
      .forEach(System.out::println);
// 1  (0+1)
// 3  (1+2)
// 6  (3+3)
// 10 (6+4)
// 15 (10+5)
```

### fold — same as reduce but as an intermediate step

```java
Optional<Integer> result = Stream.of(1, 2, 3, 4, 5)
      .gather(Gatherers.fold(() -> 0, Integer::sum))
      .findFirst();
// Optional[15]
```

### mapConcurrent — parallel mapping with ordered output

```java
Stream.of("a", "b", "c")
      .gather(Gatherers.mapConcurrent(4, s -> fetchFromNetwork(s)))
      .forEach(System.out::println);
// processes up to 4 in parallel; output order is preserved
```

---

## Custom Gatherer

A `Gatherer<T, A, R>` has four components:

| Component | Role |
|-----------|------|
| `initializer` | `Supplier<A>` — creates mutable state |
| `integrator` | `Gatherer.Integrator<A,T,R>` — processes each element |
| `combiner` | `BinaryOperator<A>` — merges state for parallel streams |
| `finisher` | `BiConsumer<A, Downstream<R>>` — emits remaining output |

```java
// Custom gatherer: emit elements in pairs
Gatherer<Integer, List<Integer>, List<Integer>> pairwise = Gatherer.of(
    ArrayList::new,                                        // initializer
    (state, element, downstream) -> {                      // integrator
        state.add(element);
        if (state.size() == 2) {
            downstream.push(new ArrayList<>(state));
            state.clear();
        }
        return true;   // true = continue processing
    },
    (left, right) -> { left.addAll(right); return left; }, // combiner
    (state, downstream) -> {                               // finisher
        if (!state.isEmpty()) downstream.push(new ArrayList<>(state));
    }
);

Stream.of(1, 2, 3, 4, 5)
      .gather(pairwise)
      .forEach(System.out::println);
// [1, 2]
// [3, 4]
// [5]
```

---

## Composing Gatherers

```java
Gatherer<Integer, ?, List<Integer>> g = Gatherers
    .windowFixed(3)
    .andThen(Gatherers.windowSliding(2));   // apply second gatherer to output of first
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `gather()` is intermediate | Lazy; returns a new `Stream` |
| `Gatherers` class | Provides `windowFixed`, `windowSliding`, `scan`, `fold`, `mapConcurrent` |
| `integrator` return | `true` to continue; `false` to short-circuit (like an early `limit`) |
| Parallel support | Provide a `combiner`; without one the gatherer is sequential-only |
| Ordering | `mapConcurrent` preserves encounter order |
