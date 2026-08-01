# Practice: Streams

> Five exercises covering what the slides in this module introduced —
> reusing a stream, laziness with `peek`, `Collectors.toMap` collisions,
> `reduce` with and without an identity, and `partitioningBy`. Try to
> answer before opening each explanation.

---

## Exercise 1 — Using a stream twice

```java
Stream<String> s = Stream.of("a", "b", "c");
long count = s.count();
List<String> list = s.filter(x -> x.equals("a")).toList();
```

What happens when this runs?

<details>
<summary>Answer</summary>

Throws `IllegalStateException: stream has already been operated upon or
closed`.

`count()` is a terminal operation — once it runs, the stream `s` is
**closed**. Any further call on that same stream reference, even an
intermediate operation like `filter`, fails immediately with
`IllegalStateException`. A stream is a one-shot pipeline description, not
a reusable container; if you need to run two separate pipelines over the
same data, start from the source again (e.g. call `.stream()` on the
underlying list a second time).

</details>

---

## Exercise 2 — Laziness, `peek`, and a short-circuit

```java
List<Integer> result = Stream.of(1, 2, 3, 4, 5)
    .peek(n -> System.out.println("peek: " + n))
    .filter(n -> n % 2 == 0)
    .findFirst()
    .stream()
    .toList();

System.out.println(result);
```

Which numbers does `peek` actually print — all five, or fewer?

<details>
<summary>Answer</summary>

```
peek: 1
peek: 2
[2]
```

Only `1` and `2` are ever pulled through the pipeline. `findFirst()` is a
short-circuiting terminal operation, and streams process element-by-element
on demand rather than running each intermediate operation over the whole
source first: `1` flows through `peek` and fails `filter` (odd), then `2`
flows through `peek` and passes `filter` (even) — at that point
`findFirst()` already has its answer and the pipeline stops. `3`, `4`, and
`5` are never touched, so `peek` never fires for them.

`findFirst()` returns `Optional[2]`; `Optional.stream()` turns that into a
one-element `Stream<Integer>`, and `.toList()` collects it to `[2]`.

</details>

---

## Exercise 3 — `Collectors.toMap` with a duplicate key

```java
record Person(String name, int age) {}

List<Person> people = List.of(
    new Person("Alice", 30),
    new Person("Bob", 25),
    new Person("Al", 30)
);

Map<Integer, String> byAge = people.stream()
    .collect(Collectors.toMap(Person::age, Person::name));
```

Alice and Al are both 30. What happens?

<details>
<summary>Answer</summary>

Throws `IllegalStateException` at runtime — something like `Duplicate key
30 (attempted merging values Alice and Al)`.

The two-argument form of `Collectors.toMap` (key mapper + value mapper)
has no strategy for handling a repeated key, so it aborts as soon as it
sees one. The fix is the three-argument overload, which adds a
`BinaryOperator<String>` merge function telling the collector what to do
when two elements produce the same key:

```java
Map<Integer, String> byAge = people.stream()
    .collect(Collectors.toMap(Person::age, Person::name, (a, b) -> a + "/" + b));
// {25=Bob, 30=Alice/Al}
```

</details>

---

## Exercise 4 — `reduce` with and without an identity, on an empty stream

```java
List<Integer> empty = List.of();

int sum1 = empty.stream().reduce(0, Integer::sum);
Optional<Integer> sum2 = empty.stream().reduce(Integer::sum);

System.out.println(sum1);
System.out.println(sum2);
```

What's printed for each line?

<details>
<summary>Answer</summary>

```
0
Optional.empty
```

`reduce(identity, accumulator)` always has a defined answer, even for an
empty stream — with nothing to combine, it simply returns the identity
value unchanged (`0`). That's exactly why this overload's return type is
a plain `int`, not `Optional<Integer>`: there's always something to return.

The single-argument `reduce(accumulator)` has no identity to fall back on.
For an empty stream there's genuinely no value to produce, which is
precisely why *this* overload returns `Optional<Integer>` instead of
`int` — the empty case has to be representable in the return type.

</details>

---

## Exercise 5 — `partitioningBy` with a downstream collector

```java
List<String> words = List.of("sky", "moon", "sun", "ocean", "star", "lake");

Map<Boolean, Long> byLengthParity = words.stream()
    .collect(Collectors.partitioningBy(w -> w.length() % 2 == 0, Collectors.counting()));
```

What are the two counts in `byLengthParity`, and which key holds which?

<details>
<summary>Answer</summary>

- `false` (odd length) → `3` — `"sky"` (3), `"sun"` (3), `"ocean"` (5)
- `true` (even length) → `3` — `"moon"` (4), `"star"` (4), `"lake"` (4)

The predicate (`w.length() % 2 == 0`) decides which words land under the
`true` key versus the `false` key; `Collectors.counting()` as the
downstream collector turns each group's word list into a count instead of
a `List<String>`.

Worth remembering: unlike `groupingBy`, `partitioningBy` **always**
produces exactly two entries — `true` and `false` — even if one side ends
up empty. With `counting()` as the downstream, an empty side shows up as
`0`, not as a missing key.

</details>
