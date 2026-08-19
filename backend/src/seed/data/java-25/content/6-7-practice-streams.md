# Practice: Streams

> Five exercises grounded in this module's slides: the
> `gather()` / `Gatherers` API (JEP 485, finalized in Java 24, included
> unchanged in Java 25), a primitive-vs-object stream
> boxing gotcha, why `sorted()` isn't lazy the way `filter`/`map` are,
> `Collectors.teeing`, and a parallel-stream thread-safety trap. Try to
> work out each answer before opening it.

---

## Exercise 1 — `gather()` and `Gatherers.windowFixed`

```java
List<List<Integer>> windows = Stream.of(1, 2, 3, 4, 5, 6, 7, 8)
    .gather(Gatherers.windowFixed(3))
    .toList();

System.out.println(windows);
```

What does this print, and what is the static type of the expression
`Stream.of(1, 2, 3, 4, 5, 6, 7, 8).gather(Gatherers.windowFixed(3))`?

<details>
<summary>Answer</summary>

```
[[1, 2, 3], [4, 5, 6], [7, 8]]
```

`gather` is the general-purpose intermediate operation added by **JEP
485** (finalized in Java 24, included unchanged in Java 25 LTS):

```java
<R> Stream<R> gather(Gatherer<? super T, ?, R> gatherer)
```

Because it's an intermediate operation, it's lazy and returns a new
`Stream` — here, `Stream<List<Integer>>`, since `Gatherers.windowFixed(3)`
is typed `Gatherer<T, ?, List<T>>`.

`Gatherers.windowFixed(int)` (from `java.util.stream.Gatherers`) groups
the source into consecutive, non-overlapping batches of the given size.
With 8 elements and a window size of 3, the first two windows are full
(`[1,2,3]`, `[4,5,6]`), and the remaining 2 elements form a **partial
final window** (`[7,8]`) rather than being dropped or causing an error —
unlike a naive `groupingBy`-based batching scheme, `windowFixed` always
emits a trailing short window if the source doesn't divide evenly.

This is distinct from `Gatherers.windowSliding(3)`, which would instead
produce every *overlapping* 3-element run: `[1,2,3]`, `[2,3,4]`,
`[3,4,5]`, ... `[6,7,8]`.

</details>

---

## Exercise 2 — Object stream vs. primitive stream: does it compile?

```java
List<Integer> nums = List.of(1, 2, 3, 4, 5);

double avg = nums.stream()
    .average()
    .getAsDouble();
```

Does this compile? If not, what's the fix?

<details>
<summary>Answer</summary>

**No, it does not compile.** `nums.stream()` returns a `Stream<Integer>`,
and `Stream<T>` has no `average()` method at all — `average()`,
`sum()`, and `summaryStatistics()` only exist on the primitive
specializations `IntStream`, `LongStream`, and `DoubleStream`. The
compiler reports something like `cannot find symbol: method average()`.

This is exactly the boxing/unboxing trade-off the primitive stream types
exist to manage: a `Stream<Integer>` holds boxed `Integer` objects and
only offers the general-purpose `Stream` API, while an `IntStream` holds
unboxed `int` values and adds numeric aggregate methods.

The fix is to convert to a primitive stream first, using `mapToInt` (or
start from a source that's already primitive, e.g. `IntStream.of(...)`):

```java
double avg = nums.stream()
    .mapToInt(Integer::intValue)   // Stream<Integer> -> IntStream
    .average()                     // OptionalDouble
    .getAsDouble();                // 3.0
```

`average()` returns `OptionalDouble` (not `Optional<Double>`) since it's
a primitive-specialized `Optional`, which is why the accessor is
`getAsDouble()` rather than `get()`.

</details>

---

## Exercise 3 — Is `sorted()` as lazy as `filter`/`map`?

```java
List<Integer> result = Stream.of(5, 3, 8, 1)
    .peek(n -> System.out.println("peek: " + n))
    .sorted()
    .limit(2)
    .toList();

System.out.println(result);
```

In what order do the `peek` lines print relative to each other, and does
any of them print *after* the final sorted result would logically be
known?

<details>
<summary>Answer</summary>

```
peek: 5
peek: 3
peek: 8
peek: 1
[1, 3]
```

All four `peek` lines print, **in source encounter order**, before
`result` is available — not interleaved with sorting or cut short by
`limit(2)`.

`filter` and `map` are *stateless* intermediate operations: each element
can be evaluated and pushed downstream independently, one at a time,
which is why the earlier `peek`-plus-`findFirst` style exercises can
short-circuit after touching only part of the source.

`sorted()` is different — it's a *stateful* intermediate operation. To
produce even the first element of a sorted output, it must first see
**every** upstream element (it can't know what's smallest until it has
looked at everything), so it pulls the entire stream through `peek`
first, buffers and sorts it internally, and only then starts handing
elements to `limit(2)`. `distinct()` is stateful for the same reason.

The net result here is still correct — sorting `[5,3,8,1]` gives
`[1,3,5,8]`, and `limit(2)` keeps `[1,3]` — but the *cost* is different
from an all-stateless pipeline: `sorted()` forces full traversal and
buffering of the source even though only 2 elements are ultimately kept.

</details>

---

## Exercise 4 — `Collectors.teeing`

```java
record Stats(long count, double average) {}

List<Integer> scores = List.of(88, 92, 75, 100, 60);

Stats result = scores.stream()
    .collect(Collectors.teeing(
        Collectors.counting(),
        Collectors.averagingInt(Integer::intValue),
        Stats::new
    ));

System.out.println(result);
```

What gets printed? How many passes does this make over `scores`?

<details>
<summary>Answer</summary>

```
Stats[count=5, average=83.0]
```

`count` = 5 elements. `average` = (88+92+75+100+60) / 5 = 415 / 5 =
`83.0`.

`Collectors.teeing(downstream1, downstream2, merger)` (Java 12+) applies
**both** downstream collectors to the *same* stream elements in a
**single pass**, then combines their two results with the supplied
`BiFunction` — here `Stats::new`, which takes the `Long` from
`counting()` and the `Double` from `averagingInt()` and builds one
`Stats` record.

This is different from running two separate terminal operations (which
would require two independent stream pipelines, since a stream can only
be consumed once — see the classic "stream reused" trap). `teeing`
threads every element through both collectors as it goes, so it needs
only one traversal of the source, whether that source is sequential or
parallel.

</details>

---

## Exercise 5 — `forEach` into a shared `ArrayList` in parallel

```java
List<Integer> input = IntStream.rangeClosed(1, 10_000).boxed().toList();
List<Integer> output = new ArrayList<>();

input.parallelStream()
     .filter(n -> n % 2 == 0)
     .forEach(output::add);

System.out.println(output.size());
```

Is `output.size()` guaranteed to print `5000`? What, specifically, is
wrong here, and how would you fix it?

<details>
<summary>Answer</summary>

**No — this is not guaranteed to print `5000`, or even to run
correctly.** The behavior is unspecified: it might print a wrong count,
throw an exception such as `ArrayIndexOutOfBoundsException`, silently
drop elements, or (on a given run, especially with few cores or lucky
timing) appear to work. None of those outcomes is something the program
can rely on, and no specific wrong value should be assumed.

The root cause: `parallelStream()` splits the work across multiple
threads from the common `ForkJoinPool`, and `forEach` gives no ordering
or synchronization guarantee about *when* or on *which thread* the
action runs — it may invoke `output::add` from several threads at the
same time. `ArrayList` is not thread-safe, so concurrent structural
modifications (resizing the backing array, updating `size`) race with
each other and corrupt the list's internal state.

The fix is to let a thread-safe **collector** perform the accumulation
instead of a shared mutable collection:

```java
List<Integer> output = input.parallelStream()
    .filter(n -> n % 2 == 0)
    .collect(Collectors.toList());   // or .toList()
// output.size() == 5000, reliably
```

Standard collectors like `toList()`, `toSet()`, and `groupingBy()` are
designed to accumulate safely under parallel execution (e.g. via
per-thread containers merged with a combiner), so there is no shared
mutable state for concurrent threads to fight over.

</details>
