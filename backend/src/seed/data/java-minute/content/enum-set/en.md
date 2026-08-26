---
version: 1.0
updatedAt: 2026-07-23
---
## Question

# What is an EnumSet?

## Short Answer

An `EnumSet` is a `Set` that can hold only values of a single enum type. Internally it's implemented as a bit vector, which makes it extremely efficient both in memory usage and in CPU time compared to a regular `HashSet`.

## What It Is

Because an `EnumSet` only ever stores values from one enum, each possible value can be represented by a single bit: bit set means the value is present, bit unset means it isn't. This bit-vector representation is what makes operations like add, remove, and contains so fast, and why the memory footprint is tiny regardless of how many values you add.

## Factory Methods

`EnumSet` doesn't have a public constructor — you create one through static factory methods:

- `EnumSet.allOf(Class)` — puts all the enum's values in the set.
- `EnumSet.noneOf(Class)` — gives you an empty set of the right enum type, to which you can add values one by one.
- `EnumSet.complementOf(otherSet)` — takes another `EnumSet` and returns the complement: every value of the enum that isn't in `otherSet`.

## Practical Example

```java
enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

EnumSet<Day> allDays = EnumSet.allOf(Day.class);
EnumSet<Day> weekend = EnumSet.of(Day.SAT, Day.SUN);
EnumSet<Day> weekdays = EnumSet.complementOf(weekend);

EnumSet<Day> empty = EnumSet.noneOf(Day.class);
empty.add(Day.MON);
```

## Why It Matters

An `EnumSet` is modifiable, so you can add and remove elements after creating it. But you cannot add `null` to it — attempting to do so throws a `NullPointerException`. This isn't a real limitation in practice: an `EnumSet` can only ever contain values from a specific enum, and enum constants can never be `null`, so there's nothing meaningful a `null` element would represent.

## Solution and Conclusion

Reach for `EnumSet` whenever you need a set of enum values: it's faster and more compact than `HashSet`, and the factory methods (`allOf`, `noneOf`, `complementOf`) cover the common construction patterns without extra boilerplate.

## References

- [Java Coding Tip #375: Enum Set](https://www.youtube.com/shorts/1BzJQf2fP3U) — video
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
