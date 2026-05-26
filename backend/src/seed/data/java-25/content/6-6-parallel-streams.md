---
version: 1.0
updatedAt: 2026-05-26
---
# Parallel Streams

---

## Creating a Parallel Stream

```java
// from a collection
List<Integer> list = List.of(1, 2, 3, 4, 5);
Stream<Integer> parallel = list.parallelStream();

// converting a sequential stream
Stream<Integer> also = list.stream().parallel();

// checking
parallel.isParallel();   // true

// converting back to sequential
Stream<Integer> seq = parallel.sequential();
```

---

## How Parallel Streams Work

Under the hood, parallel streams use the **Fork/Join framework** and the common `ForkJoinPool` (by default, one thread per CPU core minus one):

1. The source is **split** into sub-problems (using `Spliterator`).
2. Each sub-problem is processed independently.
3. Results are **combined** (reduce/collect).

---

## When Parallel Streams Help

| Condition | Explanation |
|-----------|-------------|
| Large data set | Splitting overhead is amortised over many elements |
| CPU-bound work | Per-element operation is expensive |
| Stateless pipeline | `filter`, `map` — no shared mutable state |
| Good splittability | `ArrayList`, arrays split evenly; `LinkedList` does not |

---

## When Parallel Streams Hurt

| Condition | Explanation |
|-----------|-------------|
| Small data set | Thread-creation overhead exceeds benefit |
| I/O-bound work | Threads block; use async I/O instead |
| Ordered operations | `sorted`, `distinct`, `findFirst` may force synchronisation |
| Stateful lambdas | Shared mutable state causes race conditions |

---

## Order and Encounter Order

Some sources have a defined **encounter order** (e.g., `List`); others do not (e.g., `HashSet`).

```java
// findFirst on an ordered parallel stream — returns the first element
Stream.of(1, 2, 3, 4, 5).parallel().findFirst();   // Optional[1]

// findAny — may return any element (faster in parallel)
Stream.of(1, 2, 3, 4, 5).parallel().findAny();    // Optional[any]
```

`unordered()` hint allows the stream to ignore encounter order for better parallel performance:

```java
list.parallelStream().unordered().distinct().collect(Collectors.toList());
```

---

## Thread Safety in Collectors

Standard collectors (`toList()`, `groupingBy()`, etc.) are thread-safe for parallel use. **Do not** use `forEach` to accumulate into a non-thread-safe collection:

```java
// WRONG — race condition
List<Integer> result = new ArrayList<>();
stream.parallel().forEach(result::add);   // ArrayList is not thread-safe

// CORRECT — use collect
List<Integer> result = stream.parallel().collect(Collectors.toList());
```

---

## reduce with Parallel Streams

The identity value must truly be neutral, and the accumulator must be associative:

```java
// correct — 0 is a valid identity for +
int sum = IntStream.rangeClosed(1, 1000)
    .parallel()
    .reduce(0, Integer::sum);   // 500500

// WRONG identity — 10 is not neutral for +
// parallel splits may each start with 10, producing inflated results
int wrong = IntStream.rangeClosed(1, 5)
    .parallel()
    .reduce(10, Integer::sum);  // undefined — not 15
```

---

## Performance Example

```java
// sequential
long seqMs = time(() ->
    LongStream.rangeClosed(1, 100_000_000).sum()
);

// parallel
long parMs = time(() ->
    LongStream.rangeClosed(1, 100_000_000).parallel().sum()
);
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `parallelStream()` | Creates parallel stream from a `Collection` |
| `parallel()` / `sequential()` | Converts any stream; last call on the pipeline wins |
| Common pool | `Runtime.getRuntime().availableProcessors() - 1` threads |
| Thread safety | Only use thread-safe collectors in parallel pipelines |
| Identity for reduce | Must be neutral across all sub-problems |
| `forEachOrdered` | Processes in encounter order even in parallel (slower) |
