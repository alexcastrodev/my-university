---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A stream (`java.util.stream`) is a conduit for data, not a data structure — it never stores elements itself, it just moves them from a source (a collection, an array, an I/O channel) through a pipeline of operations. A stream is single-use: once a *terminal* operation consumes it, that stream object is spent, and getting a fresh one means going back to the source. Most of a stream's operations are lambdas or method references implementing the functional interfaces from `java.util.function` (`Predicate`, `Function`, `Consumer`, ...) — see [Lambda Expressions](/java-concepts/lambda-expressions) for how those are built and captured; this concept assumes that machinery and focuses on what streams do with it: build a lazily-evaluated pipeline that filters, transforms, and reduces data in a style closer to a database query than a loop.

## Use Cases

- Replacing a hand-written `for` loop that filters, transforms, and collects in one pass with a declarative `filter().map().collect()` pipeline.
- Searching a large or expensive-to-produce source for the first match without processing the rest of it (`filter(...).findFirst()`), relying on laziness and short-circuiting instead of a manual early-return loop.
- Aggregating data — grouping, partitioning, joining, summarizing — with `Collectors` instead of hand-rolled accumulator loops.
- Running the same pipeline across multiple cores with `parallelStream()` when the source is large and the work per element is non-trivial.
- Iterating primitive `int`/`long`/`double` data without boxing every element into `Integer`/`Long`/`Double`, via `IntStream`/`LongStream`/`DoubleStream`.

## Deep Dive

### The pipeline shape and laziness

Every stream pipeline has the same three-part shape: one **source**, zero or more **intermediate operations**, and exactly one **terminal operation**.

```java
long count = myList.stream()          // source
    .filter(n -> n % 2 == 0)          // intermediate
    .map(n -> n * n)                  // intermediate
    .count();                         // terminal
```

Intermediate operations (`filter`, `map`, `sorted`, ...) each return a *new* stream — they never touch the source or run any code by themselves. Nothing actually executes until a terminal operation (`count`, `collect`, `forEach`, `reduce`, ...) is called; at that point the pipeline runs element-by-element, pulling one value through every intermediate stage before pulling the next. This is **lazy evaluation**, and it's what makes short-circuiting possible:

```java
Optional<String> first = names.stream()
    .filter(n -> n.startsWith("A"))
    .findFirst();
```

`findFirst()` is a short-circuiting terminal operation: as soon as `filter` produces one matching element, the pipeline stops pulling more elements from the source entirely — the rest of `names` is never even visited. Because the pipeline is driven element-at-a-time rather than stage-at-a-time (filter *all*, then find first), this also works on an infinite source:

```java
Stream.iterate(2, n -> n + 1)
    .filter(StreamApiFundamentals::isPrime)
    .findFirst();   // terminates — an eager "filter everything first" design couldn't
```

A stream never modifies its source either: sorting a stream produces a new stream with a new order, the backing `List` is untouched.

### Obtaining a stream

The most common source is a collection, via the two default methods `Collection` gained in JDK 8:

```java
Stream<Integer> s1 = myList.stream();          // sequential
Stream<Integer> s2 = myList.parallelStream();   // parallel, if the environment supports it
```

Arrays go through the static `Arrays.stream()`:

```java
Stream<Address> addrStream = Arrays.stream(addresses);
IntStream ints = Arrays.stream(intArray);   // primitive overload
```

Other common sources: `Stream.of(a, b, c)` for a literal handful of elements, `IntStream.range(0, 10)` / `IntStream.rangeClosed(0, 10)` for numeric sequences, `Stream.iterate(seed, next)` / `Stream.generate(supplier)` for computed (potentially infinite) streams, and `BufferedReader.lines()` for a stream backed by an I/O source. `BaseStream` (the root interface every stream type extends) also extends `AutoCloseable`, so a stream whose source needs closing — a file-backed one — can be managed in try-with-resources; a collection-backed stream never needs this.

### Intermediate vs. terminal operations: stateless vs. stateful

Terminal operations consume the stream and either produce a result (`min`, `max`, `count`, `collect`, `reduce`) or perform an action (`forEach`). Once one runs, the stream it ran on is dead — reusing the reference throws:

```java
Stream<Integer> s = myList.stream();
s.count();
s.forEach(System.out::println);   // IllegalStateException: stream has already been operated upon or closed
```

Intermediate operations split further into **stateless** and **stateful**. A stateless operation (`filter`, `map`, `peek`) processes each element independently of every other element — it can emit (or transform, or drop) an element the moment it sees it, without waiting for anything else. A stateful operation (`sorted`, `distinct`, `limit`) needs information about *other* elements to decide what to do with the current one — `sorted()` cannot emit its first output element until it has seen the entire upstream, and `distinct()` has to remember every element it has already emitted to recognize a repeat.

That distinction is exactly why the infinite-stream example above works only because `filter` comes before `findFirst`: a stateless op can be interleaved element-by-element with a short-circuiting terminal op. Put a stateful op like `sorted()` in that same pipeline against an infinite source and it hangs forever, because sorting needs to see everything before it can produce anything:

```java
Stream.iterate(1, n -> n + 1)
    .sorted()          // stateful: must exhaust the (infinite) source first
    .findFirst();      // never returns
```

`limit(n)` is the one operation that can turn an otherwise-stateful pipeline back into something safe for infinite sources, because it is itself short-circuiting: `Stream.iterate(1, n -> n + 1).limit(5).sorted().toList()` terminates, because `limit` cuts the source down to five elements before `sorted` ever runs.

### The Collectors catalogue and how a custom Collector works

`collect()` is the terminal operation that turns a stream back into a mutable result — most often via a ready-made `Collector` from the `Collectors` utility class:

```java
List<String> names   = people.stream().map(Person::name).collect(Collectors.toList());
Set<String> unique    = people.stream().map(Person::city).collect(Collectors.toSet());
String csv            = people.stream().map(Person::name).collect(Collectors.joining(", "));
Map<String, List<Person>> byCity =
    people.stream().collect(Collectors.groupingBy(Person::city));
long count            = people.stream().collect(Collectors.counting());
DoubleSummaryStatistics stats =
    people.stream().collect(Collectors.summarizingDouble(Person::salary));
```

`groupingBy` also accepts a downstream collector, so grouping and aggregating compose in one call — `groupingBy(Person::city, Collectors.counting())` gives a population count per city instead of a list of `Person` per city.

Under the hood, `Collector<T, A, R>` is a plain interface with four functional components, and any of the `Collectors` factory methods just assembles them:

```java
interface Collector<T, A, R> {
    Supplier<A> supplier();                  // creates a new, empty accumulation container
    BiConsumer<A, T> accumulator();           // folds one element into the container
    BinaryOperator<A> combiner();             // merges two containers (parallel streams)
    Function<A, R> finisher();                // converts the container into the final result
    Set<Characteristics> characteristics();   // hints: CONCURRENT, UNORDERED, IDENTITY_FINISH
}
```

`T` is the stream's element type, `A` the (often invisible) mutable container type doing the accumulating, and `R` the final result type — for `toList()`, `A` and `R` happen to both be `List<T>`, which is what `IDENTITY_FINISH` signals (skip calling `finisher()`, the container already *is* the result). Writing a custom collector is just supplying those four pieces directly with `Collector.of(...)`, e.g. `collect(HashSet::new, HashSet::add, HashSet::addAll)` — the three-argument `collect()` overload is the same shape without the `Collector` wrapper.

### Primitive stream specializations

`Stream<T>` only ever holds object references, so a `Stream<Integer>` boxes every `int` it touches. `IntStream`, `LongStream`, and `DoubleStream` exist purely to avoid that: they carry primitive `int`/`long`/`double` values directly, with primitive-specialized operations (`sum()`, `average()`, `IntBinaryOperator` instead of `BinaryOperator<Integer>`) so no boxing happens mid-pipeline.

```java
int total = orders.stream()
    .mapToInt(Order::quantity)   // Stream<Order> -> IntStream, no boxing from here on
    .sum();

IntStream.rangeClosed(1, 100).filter(n -> n % 3 == 0).forEach(System.out::println);
```

`boxed()` converts a primitive stream back to `Stream<Integer>`/`Stream<Long>`/`Stream<Double>` when a boxed value is actually needed downstream (a `Collectors.toList()` target, for instance, since there's no `List<int>`).

### Parallel streams: when they help and when they hurt

`parallelStream()` (or calling `.parallel()` on a sequential stream) asks the pipeline to run across the common `ForkJoinPool`, splitting the source and combining partial results. Any operation used on a parallel stream — `filter`'s predicate, `reduce`'s accumulator and combiner, a custom `Collector`'s accumulator/combiner — must be stateless, non-interfering, and associative, or the parallel result can differ from the sequential one.

Parallelism pays off when the source is large, each element's processing is non-trivial, and the source splits cheaply (an `ArrayList` or an array splits well; a `LinkedList` or an I/O-backed stream does not). It tends to *lose* to a sequential stream when the source is small (fork/join coordination overhead dwarfs the actual work), when the operation is cheap per element, or when a stateful operation like `sorted()` forces extra coordination passes across partitions. `forEach()` on a parallel stream also doesn't preserve encounter order — `forEachOrdered()` is the ordered alternative when output order matters.

### Gatherers: custom intermediate operations (JEP 485, finalized JDK 24)

The predefined intermediate operations (`filter`, `map`, `sorted`, ...) cover most needs, but nothing in the classic API lets user code define a *new* stateful intermediate operation — grouping into fixed-size batches, or a running accumulation that emits every step, previously meant dropping out of the stream API entirely. `Stream.gather(Gatherer)`, finalized in JDK 24 after two preview rounds (JEP 461 in JDK 22, JEP 473 in JDK 23), fills that gap: a `Gatherer<T, A, R>` is built from the same shape as a `Collector` (an initializer, an integrator, a combiner, a finisher) but produces a *stream* instead of a single collected result, so it composes with further intermediate and terminal operations.

```java
List<List<Integer>> batches = Stream.of(1, 2, 3, 4, 5, 6, 7)
    .gather(Gatherers.windowFixed(3))
    .toList();
// [[1, 2, 3], [4, 5, 6], [7]]

List<Integer> runningTotal = Stream.of(1, 2, 3, 4)
    .gather(Gatherers.scan(() -> 0, Integer::sum))
    .toList();
// [1, 3, 6, 10]
```

`java.util.stream.Gatherers` ships a handful of ready-made gatherers (`windowFixed`, `windowSliding`, `fold`, `scan`, `mapConcurrent`), and custom ones are built with `Gatherer.of(...)`. This is the one part of the Stream API that's genuinely new since a Java-17-era treatment — everything else covered above (`mapMulti`, `Stream.toList()`) was already present by JDK 16-17.

## Trade-offs

- **A stream is single-use.** Calling a second terminal (or intermediate) operation on an already-consumed stream throws at runtime, not compile time — the reference still type-checks, it just can't be reused.
  ```java
  Stream<String> s = list.stream();
  s.forEach(System.out::println);
  s.count();   // IllegalStateException: stream has already been operated upon or closed
  ```
- **Stateful intermediate operations buy correctness at the cost of buffering.** `sorted()` and `distinct()` can't emit anything until they've seen the whole upstream (or until a `limit()` ahead of them bounds it), unlike `filter`/`map`, which stream through one element at a time and are the only kind safe to place directly ahead of a short-circuiting terminal operation on an infinite source.
- **Parallel streams aren't free — the coordination overhead can exceed the work saved.** A small collection, a cheap per-element operation, or a source that resists cheap splitting (linked lists, I/O-backed streams) commonly runs *slower* in parallel than sequential; parallelism is a bet that only pays off once per-element work and data size are large enough to amortize fork/join overhead.
- **A parallel `reduce`/`collect`'s accumulator and combiner must be associative, or the result becomes order-dependent and unreliable.** The classic failure is reusing the same function for both roles when they need to differ — multiplying two elements' square roots is not the same operation as multiplying two already-computed partial products.
- **`forEach()` does not guarantee encounter order on a parallel stream.** Code that depends on processing elements in source order needs `forEachOrdered()` instead, which reintroduces the coordination `forEach()` was avoiding.

## Documentation Links

- [java.util.stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
- [Collectors — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html) — doc
- [Gatherer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html) — doc
- [Gatherers — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html) — doc
- [JEP 485: Stream Gatherers](https://openjdk.org/jeps/485) — doc
