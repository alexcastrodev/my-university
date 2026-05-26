# Reduction, Grouping, and Partitioning

---

## Terminal Operations Overview

Terminal operations trigger execution of the lazy pipeline and produce a result or side-effect.

---

## Basic Terminals

```java
Stream<String> words = Stream.of("apple", "banana", "cherry");

words.count();                           // 3
words.findFirst();                       // Optional["apple"]
words.findAny();                         // Optional[any element]
words.anyMatch(s -> s.startsWith("b"));  // true
words.allMatch(s -> s.length() > 3);     // true
words.noneMatch(s -> s.isEmpty());       // true
words.min(Comparator.naturalOrder());    // Optional["apple"]
words.max(Comparator.naturalOrder());    // Optional["cherry"]
words.forEach(System.out::println);      // side-effect, returns void
```

---

## reduce

Combines elements into a single value using a `BinaryOperator`:

```java
// with identity — always returns T
int sum = IntStream.rangeClosed(1, 5)
    .reduce(0, Integer::sum);   // 15

// without identity — returns Optional<T>
Optional<String> longest = Stream.of("apple", "banana", "cherry")
    .reduce((a, b) -> a.length() >= b.length() ? a : b);   // Optional["banana"]

// three-arg form for parallel streams (combiner)
int total = Stream.of(1, 2, 3, 4, 5)
    .reduce(0, Integer::sum, Integer::sum);   // 15
```

---

## collect — Collectors

`collect` is the most flexible terminal operation. It uses a `Collector` to accumulate elements:

```java
// to mutable list
List<String> list = stream.collect(Collectors.toList());
// Java 16+ — unmodifiable
List<String> unmod = stream.collect(Collectors.toUnmodifiableList());

// to set
Set<String> set = stream.collect(Collectors.toSet());

// joining
String joined = Stream.of("a", "b", "c")
    .collect(Collectors.joining(", ", "[", "]"));   // "[a, b, c]"

// counting
long count = stream.collect(Collectors.counting());

// summing / averaging
int total  = stream.collect(Collectors.summingInt(String::length));
double avg = stream.collect(Collectors.averagingInt(String::length));

// statistics
IntSummaryStatistics stats = stream
    .collect(Collectors.summarizingInt(String::length));

// toMap
Map<String, Integer> map = Stream.of("a", "bb", "ccc")
    .collect(Collectors.toMap(s -> s, String::length));
// {a=1, bb=2, ccc=3}
```

---

## groupingBy

Groups elements by a classifier function into a `Map<K, List<V>>`:

```java
Map<Integer, List<String>> byLength = Stream.of("apple", "banana", "fig", "cherry", "ant")
    .collect(Collectors.groupingBy(String::length));
// {3=[fig, ant], 5=[apple], 6=[banana, cherry]}

// downstream collector
Map<Integer, Long> countByLength = Stream.of("apple", "banana", "fig", "cherry")
    .collect(Collectors.groupingBy(String::length, Collectors.counting()));
// {3=1, 5=1, 6=2}

// nested grouping
Map<Integer, Map<Character, List<String>>> nested = words.collect(
    Collectors.groupingBy(String::length,
        Collectors.groupingBy(s -> s.charAt(0))));
```

---

## partitioningBy

Splits elements into two groups (`true` / `false`) based on a `Predicate`:

```java
Map<Boolean, List<String>> partition = Stream.of("apple", "banana", "fig", "cherry")
    .collect(Collectors.partitioningBy(s -> s.length() > 4));
// {false=[fig], true=[apple, banana, cherry]}

// with downstream
Map<Boolean, Long> counted = stream
    .collect(Collectors.partitioningBy(s -> s.length() > 4, Collectors.counting()));
// {false=1, true=3}
```

---

## Collectors.teeing (Java 12+)

Applies two collectors simultaneously and merges their results:

```java
record MinMax(Optional<Integer> min, Optional<Integer> max) {}

MinMax result = IntStream.rangeClosed(1, 10).boxed()
    .collect(Collectors.teeing(
        Collectors.minBy(Comparator.naturalOrder()),
        Collectors.maxBy(Comparator.naturalOrder()),
        MinMax::new
    ));
// MinMax[min=Optional[1], max=Optional[10]]
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `reduce` identity | Must be neutral (0 for sum, 1 for product, `""` for concatenation) |
| `collect` vs `reduce` | `collect` uses mutable accumulation (efficient); `reduce` is immutable |
| `groupingBy` | Default downstream is `Collectors.toList()` |
| `partitioningBy` | Always produces exactly two keys: `true` and `false` |
| `toMap` duplicates | Throws `IllegalStateException` on duplicate keys — use merge function |
