---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

[Stream API Fundamentals](/java-concepts/stream-api-fundamentals) covers the basic pipeline shape and mentions `Collectors` and `parallelStream()` in passing. This concept goes deeper on exactly those two points: the multi-level and combining collectors beyond `toList()`/`groupingBy()`, how to write a `Collector` from scratch, and what actually happens — mechanically and in terms of risk — when a stream runs in parallel instead of sequentially.

## Use Cases

- Producing a nested `Map` in one pass — e.g. orders grouped by status, and within each status grouped again or aggregated (count, sum, average).
- Splitting a collection into exactly two groups (pass/fail, valid/invalid) with a single boolean test instead of two separate `filter()` passes.
- Building a `Map<K, V>` from a stream where keys might collide, and deciding explicitly what happens to the value instead of letting a duplicate key blow up at runtime.
- Computing two related aggregates (sum and count, min and max) in a single pass over the data instead of iterating twice.
- Writing a `Collector` for a result shape `Collectors` doesn't ship (e.g. accumulating straight into an immutable value type).
- Speeding up a CPU-heavy, per-element-expensive computation over a large in-memory collection by parallelizing it — and knowing when that bet doesn't pay off.

## Deep Dive

### Multi-level grouping with `groupingBy` and a downstream collector

`Collectors.groupingBy(classifier)` alone produces `Map<K, List<T>>`. Passing a second, *downstream* collector changes what ends up in each bucket instead of a raw list — and that downstream collector can itself be another `groupingBy`, producing a nested map:

```java
record Order(String status, String region, double amount) {}

List<Order> orders = List.of(
    new Order("SHIPPED", "EU", 120.0),
    new Order("SHIPPED", "EU", 80.0),
    new Order("SHIPPED", "US", 50.0),
    new Order("PENDING", "EU", 30.0)
);

// one level: status -> count
Map<String, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status, Collectors.counting()));
// {SHIPPED=3, PENDING=1}

// two levels: status -> region -> total amount
Map<String, Map<String, Double>> totalByStatusAndRegion = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.groupingBy(Order::region, Collectors.summingDouble(Order::amount))
    ));
// {SHIPPED={EU=200.0, US=50.0}, PENDING={EU=30.0}}
```

The outer `groupingBy` builds the top-level `Map`; every value in that map is itself the result of running the *entire remaining stream of that bucket* through the downstream collector. Nothing about this is special-cased — `groupingBy` just delegates to whatever `Collector` it's handed, which is why a `groupingBy` can nest inside another `groupingBy` with no extra API surface.

### `partitioningBy`: the two-bucket special case

`partitioningBy` is `groupingBy` restricted to a `Predicate`, so the classifier only ever produces `true`/`false` — and unlike `groupingBy`, both keys are always present in the result, even if one bucket is empty:

```java
List<Integer> numbers = List.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

Map<Boolean, List<Integer>> evenOdd = numbers.stream()
    .collect(Collectors.partitioningBy(n -> n % 2 == 0));
// {false=[1, 3, 5, 7, 9], true=[2, 4, 6, 8, 10]}

Map<Boolean, Long> evenOddCounts = numbers.stream()
    .collect(Collectors.partitioningBy(n -> n % 2 == 0, Collectors.counting()));
// {false=5, true=5}
```

`groupingBy` on an equivalent predicate would return only the keys that actually occurred (a stream of all-even numbers would omit `false` entirely); `partitioningBy` always returns a two-entry map with both `true` and `false` present.

### `toMap` and the duplicate-key trap

`Collectors.toMap(keyMapper, valueMapper)` builds a `Map` directly from a stream, but it has no idea what to do when two elements map to the same key — its default behavior is to fail loudly:

```java
record Employee(String department, String name) {}

List<Employee> employees = List.of(
    new Employee("ENGINEERING", "Alice"),
    new Employee("ENGINEERING", "Bob"),   // same department key as Alice
    new Employee("SALES", "Carol")
);

Map<String, String> byDept = employees.stream()
    .collect(Collectors.toMap(Employee::department, Employee::name));
// IllegalStateException: Duplicate key ENGINEERING (attempted merging values Alice and Bob)
```

The fix is the three-argument overload, which takes a `BinaryOperator<V>` merge function telling `toMap` exactly what to do with the colliding values instead of throwing:

```java
Map<String, String> byDept = employees.stream()
    .collect(Collectors.toMap(
        Employee::department,
        Employee::name,
        (existing, incoming) -> existing + ", " + incoming   // merge function
    ));
// {ENGINEERING=Alice, Bob, SALES=Carol}
```

A four-argument overload additionally takes a `Map` supplier (e.g. `TreeMap::new`) when insertion order or sort order of the resulting map matters.

### `teeing`: combining two collectors into one result (Java 12+)

`Collectors.teeing(downstream1, downstream2, merger)` runs the *same* stream through two independent collectors in a single pass, then combines their two results with a `BiFunction`. The canonical example is an average computed without two separate terminal operations:

```java
record Sample(double value) {}

List<Sample> samples = List.of(new Sample(4.0), new Sample(8.0), new Sample(6.0));

double average = samples.stream()
    .collect(Collectors.teeing(
        Collectors.summingDouble(Sample::value),   // downstream 1: sum
        Collectors.counting(),                      // downstream 2: count
        (sum, count) -> sum / count                  // merger
    ));
// 6.0
```

Without `teeing`, the same result needs either two passes over the stream (impossible if the stream is already consumed after the first) or `summaryStatistics()`; `teeing` earns its place specifically when the two aggregates being combined aren't already covered by one built-in summarizing collector.

### Writing a custom `Collector` with `Collector.of`

`Collector.of` builds a `Collector` by supplying the same four pieces `stream-api-fundamentals` introduces conceptually (`supplier`, `accumulator`, `combiner`, `finisher`), for a result shape none of the built-in `Collectors` factory methods produce directly — here, joining names into an immutable, comma-joined `String` wrapped in a small value type:

```java
record NameList(String joined) {}

Collector<String, StringJoiner, NameList> toNameList = Collector.of(
    () -> new StringJoiner(", "),               // supplier: new empty container
    StringJoiner::add,                            // accumulator: fold one element in
    StringJoiner::merge,                           // combiner: merge two containers (parallel)
    joiner -> new NameList(joiner.toString())     // finisher: container -> final result
);

NameList names = Stream.of("Alice", "Bob", "Carol").collect(toNameList);
// NameList[joined=Alice, Bob, Carol]
```

Because the finisher does real work here (`StringJoiner` is not itself the result type), this collector does *not* declare `Characteristics.IDENTITY_FINISH` — contrast with `Collectors.toList()`, where the accumulation container already *is* the result and the finisher is skipped.

### How a parallel stream actually splits work

`parallelStream()` doesn't hand-roll thread management: it obtains a `Spliterator` from the source, which recursively splits the data into chunks (`trySplit()`), and submits those chunks as tasks to the common `ForkJoinPool` — the same divide-and-conquer engine covered in [Fork/Join Framework](/java-concepts/fork-join-framework). A source that splits cheaply and evenly (an `ArrayList`, an array) parallelizes well; one that can only be split by walking it node-by-node (a `LinkedList`) or that has no genuine random-access structure (an I/O-backed stream) gains little or nothing, because the `Spliterator` can't divide it efficiently.

```java
List<Integer> big = IntStream.rangeClosed(1, 10_000_000).boxed().toList();

long expensiveCount = big.parallelStream()
    .filter(StreamCollectorsAndParallelStreams::isPrime)   // non-trivial per-element cost
    .count();
```

Parallelism is a bet: it pays off only when the source is large *and* the per-element work is expensive enough to amortize the fork/split/merge coordination overhead. A `parallelStream()` over ten small integers with a cheap predicate typically loses to the sequential version outright, because the overhead of splitting the source and merging partial results costs more than just running the whole thing on one thread.

### Stateful lambdas in parallel streams: a concrete race

Every operation supplied to a parallel stream — a `filter` predicate, a `forEach` action, an accumulator — must be **stateless and non-interfering**, meaning it must not mutate shared state outside itself. Writing into a plain `ArrayList` from inside a parallel `forEach` breaks that rule, because `ArrayList.add` is not thread-safe:

```java
List<Integer> results = new ArrayList<>();

IntStream.rangeClosed(1, 100_000)
    .parallel()
    .forEach(results::add);   // multiple threads calling add() on the same ArrayList concurrently

System.out.println(results.size());
// unreliable: sometimes < 100000, occasionally throws ArrayIndexOutOfBoundsException
// or ConcurrentModificationException, depending on how the internal resize races land
```

Several worker threads call `add()` on the same backing array at the same time; `ArrayList` does no locking, so a resize triggered by one thread can be invisible to another mid-write, corrupting the array or losing elements. The fix is to let the stream's own collection machinery handle the concurrency instead of sharing mutable state by hand:

```java
List<Integer> results = IntStream.rangeClosed(1, 100_000)
    .parallel()
    .boxed()
    .collect(Collectors.toList());   // collect() is safe under parallel execution by construction
```

### Ordering: `forEach` vs `forEachOrdered`

A sequential stream always processes elements in encounter order. A parallel stream does not: `forEach()` on a parallel stream lets whichever worker thread finishes a chunk first emit its output first, so printed order can differ from source order on every run:

```java
List.of(1, 2, 3, 4, 5).parallelStream()
    .forEach(System.out::println);
// order varies between runs: e.g. 3 1 4 2 5

List.of(1, 2, 3, 4, 5).parallelStream()
    .forEachOrdered(System.out::println);
// always 1 2 3 4 5 — but pays the cost of reassembling encounter order across threads
```

`forEachOrdered()` restores encounter order by making the stream buffer and reassemble results according to source position before emitting them, which reintroduces exactly the cross-thread coordination that running unordered was trying to avoid — it is the right choice when output order matters, and the wrong default otherwise.

## Trade-offs

- **`groupingBy` with a downstream collector composes for free, but nested maps get harder to consume the deeper they go.** A two-level `groupingBy` is idiomatic; three or more levels usually reads better as a small record or a flat `Map` keyed on a composite key.
- **`partitioningBy` always returns both `true` and `false` keys, even when one side is empty** — code that assumes a missing key means "no such elements" will misread a `partitioningBy` result the way it would correctly read a `groupingBy` one.
  ```java
  Map<Boolean, List<Integer>> r = List.of(1, 3, 5).stream()
      .collect(Collectors.partitioningBy(n -> n % 2 == 0));
  // {false=[1, 3, 5], true=[]}  -- true is present and empty, not absent
  ```
- **`toMap` without a merge function is a runtime bomb, not a compile-time one.** The two-argument form only fails when a duplicate key actually shows up in the data, so it can pass code review and testing on a dataset that happens not to collide, then throw in production the day it does.
  ```java
  Stream.of("a", "b", "a").collect(Collectors.toMap(s -> s, s -> 1));
  // IllegalStateException: Duplicate key a
  ```
- **`teeing` is a single-pass optimization, not a readability win by itself.** It earns its place when two aggregates genuinely need to share one traversal of an expensive-to-produce or single-use stream; for a source that's cheap to traverse twice, two separate `collect()` calls are often clearer.
- **A custom `Collector`'s combiner is only exercised under parallel execution.** A `Collector.of(...)` whose combiner is subtly wrong (not truly associative, or mutates its first argument in a way the finisher doesn't expect) can pass every test run sequentially and only misbehave once the same collector is used with `parallelStream()`.
- **Parallelizing a small or cheap-per-element stream is a net loss, not neutral.** The fork/split/merge coordination has a real, fixed cost that a short sequential loop simply doesn't pay.
- **Sharing mutable state inside a parallel stream's lambda is a data race, not a slowdown.** It corrupts results (lost writes, `ArrayIndexOutOfBoundsException`, `ConcurrentModificationException`) rather than just running slower, because the parallelism contract assumes non-interfering operations and the JVM does nothing to enforce it.
- **`forEachOrdered()` buys back deterministic order at the cost of the coordination parallelism was meant to remove.** Using it on every parallel stream defeats much of the point of parallelizing in the first place; it's a targeted fix for the specific pipelines where output order is actually observable.

## Documentation Links

- [Collectors — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html) — doc
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
- [Stream — Java SE 25 API (see the "Parallelism" section)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [java.util.stream package summary — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html) — doc
