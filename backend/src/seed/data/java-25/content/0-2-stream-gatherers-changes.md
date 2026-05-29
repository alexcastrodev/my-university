---
version: 1.0
updatedAt: 2026-05-28
---
# Stream Gatherers — Delta from Java 21 to Java 25 (JEP 485)

> **JEP 485** — finalized in Java 24, included unchanged in the Java 25 LTS. See [openjdk.org/jeps/485](https://openjdk.org/jeps/485).

---

## What changed since Java 21

In Java 21 there was no `Stream.gather(...)` and no `java.util.stream.Gatherer` type. Stateful many-to-many intermediate operations had to be expressed with collectors plus a re-stream, or with hand-written `Spliterator` wrappers.

Preview history:

| Release | JEP | Status |
|---------|-----|--------|
| Java 22 | [461](https://openjdk.org/jeps/461) | First preview |
| Java 23 | [473](https://openjdk.org/jeps/473) | Second preview (no API changes) |
| Java 24 | [485](https://openjdk.org/jeps/485) | Final |
| Java 25 | — | Unchanged (LTS) |

There were no API breaks between previews and final. The integrator type was already `Gatherer.Integrator` in JEP 461 and the built-in list (`windowFixed`, `windowSliding`, `scan`, `fold`, `mapConcurrent`) was stable from the first preview. The only behavioural clarification between previews was that `mapConcurrent` is **not** parallelizable — it spawns virtual threads internally but the surrounding pipeline stays sequential.

---

## The gather() method

```java
<R> Stream<R> gather(Gatherer<? super T, ?, R> gatherer)
```

It is an intermediate operation, so it is lazy and composable with the rest of the pipeline.

```java
stream.filter(...).gather(g).map(...).toList();
```

---

## Built-in gatherers (`java.util.stream.Gatherers`)

```java
// Fixed non-overlapping windows
Gatherers.windowFixed(int windowSize)

// Sliding overlapping windows (step is always 1)
Gatherers.windowSliding(int windowSize)

// Running prefix; like reduce but emits each intermediate value
Gatherers.scan(Supplier<R> initial, BiFunction<R, T, R> folder)

// Terminal-style fold expressed as a gatherer (emits a single element)
Gatherers.fold(Supplier<R> initial, BiFunction<R, T, R> folder)

// Bounded parallelism with preserved encounter order
Gatherers.mapConcurrent(int maxConcurrency, Function<T, R> mapper)
```

```java
List<List<Integer>> batches = Stream.of(1,2,3,4,5,6,7)
    .gather(Gatherers.windowFixed(3))
    .toList();
// [[1,2,3], [4,5,6], [7]]
```

Note: `windowSliding` always advances by one; there is no step parameter. To get a step of N, compose with `windowFixed` or write a custom gatherer.

---

## The four parts of a custom Gatherer

`Gatherer<T, A, R>` has type parameters: input element `T`, mutable private state `A`, output element `R`.

| Part | Type | Required? |
|------|------|-----------|
| `initializer` | `Supplier<A>` | Only for stateful gatherers |
| `integrator` | `Gatherer.Integrator<A, T, R>` | Always |
| `combiner` | `BinaryOperator<A>` | Only for parallelizable gatherers |
| `finisher` | `BiConsumer<A, Downstream<? super R>>` | Optional |

The integrator returns a `boolean`: `true` to continue, `false` to short-circuit upstream (analogous to a built-in `limit`).

```java
// Emit running totals, but stop after the total exceeds 100
Gatherer<Integer, int[], Integer> runningSumCapped = Gatherer.ofSequential(
    () -> new int[]{0},                                  // initializer
    (state, element, downstream) -> {                    // integrator
        state[0] += element;
        downstream.push(state[0]);
        return state[0] <= 100;                          // false ⇒ short-circuit
    }
);
```

`Gatherer.of(...)` requires a combiner (parallel-capable). `Gatherer.ofSequential(...)` omits the combiner and forbids parallel execution.

---

## Composition with andThen

```java
Gatherer<Integer, ?, List<Integer>> pipeline =
    Gatherers.windowFixed(3)
             .andThen(Gatherers.windowSliding(2));
```

`andThen` chains gatherers so the output of the first feeds the input of the second. Each `gather()` call in a pipeline is equivalent to one gatherer; multiple `gather()` calls can be folded into one via `andThen`.

---

## Parallel semantics

| Construction | Parallel-safe? |
|--------------|---------------|
| `Gatherer.of(init, integrator, combiner, finisher)` | Yes — combiner merges per-split state |
| `Gatherer.ofSequential(...)` | No — pipeline runs sequentially even on a parallel stream |
| `Gatherers.windowFixed` / `windowSliding` / `scan` / `fold` | Sequential by contract |
| `Gatherers.mapConcurrent` | Concurrent (virtual threads) but **not** parallel — does not split the stream |

A parallel stream silently degrades to sequential at the gather() boundary when the gatherer lacks a combiner.

---

## Exam-relevant rules

| Rule | Detail |
|------|--------|
| `gather()` location | `java.util.stream.Stream`; intermediate, lazy |
| Five built-ins | `windowFixed`, `windowSliding`, `scan`, `fold`, `mapConcurrent` |
| Integrator return | `true` continue, `false` short-circuit |
| `ofSequential` vs `of` | `of` requires a combiner; `ofSequential` forbids parallel execution |
| `mapConcurrent` ordering | Encounter order preserved on output |
| `mapConcurrent` parallelism | Uses virtual threads internally; does not parallelize the surrounding pipeline |
| `windowSliding` step | Always 1; no overload with step |
| Final window of `windowFixed` | Emitted even if smaller than the window size |
| `scan` vs `fold` | `scan` emits each prefix; `fold` emits one final element |
| `andThen` direction | Output of the receiver becomes input of the argument |

---

## See also

- [[6-5-stream-gatherers]] — base course lesson on the gatherers API.
- Javadoc: [Gatherer](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html), [Gatherers](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html).
