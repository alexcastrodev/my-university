# Object and Primitive Streams

---

## What Is a Stream?

A `Stream<T>` is a sequence of elements that supports declarative processing via a pipeline of operations. Streams are:

- **Lazy** — intermediate operations are not executed until a terminal operation is invoked.
- **Non-reusable** — a stream can only be consumed once.
- **Non-storing** — elements are pulled from a source; no internal buffer.

```
Source → intermediate ops (lazy) → terminal op (triggers execution)
```

---

## Creating Object Streams

```java
// from a collection
Stream<String> s1 = List.of("A", "B", "C").stream();

// from values
Stream<String> s2 = Stream.of("X", "Y", "Z");

// empty stream
Stream<String> s3 = Stream.empty();

// infinite — generate
Stream<Double> randoms = Stream.generate(Math::random);

// infinite — iterate
Stream<Integer> evens = Stream.iterate(0, n -> n + 2);
// with a predicate (Java 9)
Stream<Integer> evens10 = Stream.iterate(0, n -> n < 20, n -> n + 2);

// from array
Stream<String> s4 = Arrays.stream(new String[]{"a", "b"});

// builders
Stream.Builder<String> builder = Stream.builder();
builder.add("one").add("two");
Stream<String> s5 = builder.build();
```

---

## Primitive Streams

Boxing/unboxing overhead is avoided with specialised stream types:

| Type | For | Creation |
|------|-----|---------|
| `IntStream` | `int` | `IntStream.of(1,2,3)`, `IntStream.range(0,10)` |
| `LongStream` | `long` | `LongStream.of(...)`, `LongStream.rangeClosed(1,5)` |
| `DoubleStream` | `double` | `DoubleStream.of(...)`, `DoubleStream.generate(Math::random)` |

```java
IntStream.range(1, 6)         // 1,2,3,4,5  (exclusive end)
         .forEach(System.out::println);

IntStream.rangeClosed(1, 5)   // 1,2,3,4,5  (inclusive end)

// from object stream
IntStream lengths = Stream.of("hello", "world").mapToInt(String::length);

// back to object stream
Stream<Integer> boxed = IntStream.range(1, 4).boxed();
Stream<String>  asStr = IntStream.range(1, 4).mapToObj(Integer::toString);
```

### Primitive Stream Statistics

```java
IntStream nums = IntStream.of(3, 1, 4, 1, 5, 9);

nums.sum();      // 23
nums.min();      // OptionalInt[1]
nums.max();      // OptionalInt[9]
nums.average();  // OptionalDouble[3.8333...]
nums.count();    // 6

IntSummaryStatistics stats = IntStream.of(3, 1, 4).summaryStatistics();
stats.getMin(); stats.getMax(); stats.getSum(); stats.getAverage(); stats.getCount();
```

---

## Optional

Terminal operations that may produce no result return `Optional<T>` (or `OptionalInt`, etc.):

```java
Optional<String> first = Stream.of("a", "b").filter(s -> s.equals("z")).findFirst();

first.isPresent();          // false
first.isEmpty();            // true  (Java 11+)
first.orElse("default");    // "default"
first.orElseGet(() -> compute()); // lazy fallback
first.orElseThrow();        // throws NoSuchElementException if empty
first.ifPresent(System.out::println);  // runs only if value present
first.map(String::toUpperCase);        // Optional<String> — transforms if present
```

---

## Pipeline Structure

```java
long count = Stream.of("apple", "banana", "cherry", "avocado")
    .filter(s -> s.startsWith("a"))    // intermediate
    .map(String::toUpperCase)           // intermediate
    .sorted()                           // intermediate
    .count();                           // terminal → triggers execution
// count = 2
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| Lazy evaluation | Nothing runs until terminal op is called |
| Single use | Reusing a consumed stream throws `IllegalStateException` |
| Infinite streams | Must use `limit()` or a predicate-based `iterate` before a terminal op |
| Primitive streams | Avoid boxing; have extra methods: `sum()`, `average()`, `summaryStatistics()` |
| `Optional` | Never call `get()` without checking `isPresent()` — prefer `orElse`/`ifPresent` |
