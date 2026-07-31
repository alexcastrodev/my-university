---
version: 1.0
updatedAt: 2026-07-31
---
## Question

# How can you get the max of a collection?

## Short Answer

There are several patterns for that, each with different trade-offs. If you just need to extract the max without transforming or filtering your collection, `Collections.max` is a good choice.

## Collections.max

`Collections.max` is a factory method: you pass it your collection, and optionally a `Comparator` if your elements aren't naturally `Comparable` or you want a different ordering.

```java
List<Integer> numbers = List.of(3, 7, 2, 9, 4);

int max = Collections.max(numbers); // 9
```

Two things to watch out for:

- If the collection contains a `null` element, you get a `NullPointerException`.
- If the collection is empty, you get a `NoSuchElementException`.

## Stream.max

The second pattern is based on streams: call `.stream()`, then `.max(...)`, passing a `Comparator`.

```java
List<Integer> numbers = List.of(3, 7, 2, 9, 4);

Optional<Integer> max = numbers.stream().max(Comparator.naturalOrder()); // Optional[9]
```

Just like `Collections.max`, you get a `NullPointerException` if there's a `null` value in the stream. But if the stream is empty, you get an empty `Optional` instead of an exception — arguably better for error handling, since the caller can decide how to handle the absence of a value instead of catching an exception.

## Solution and Conclusion

Be careful with the stream pattern: you still pay the price of creating the stream, which is extra overhead you may want to avoid. Unless you specifically need stream features (chaining with `filter`, `map`, etc.), plain old `Collections.max` is probably your best choice.

## References

- [Java Coding Tip #382: Max of a Collection](https://www.youtube.com/shorts/1XLa9QEMMyI) — video
- [Collections.max — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#max(java.util.Collection,java.util.Comparator)) — doc
- [Stream.max — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#max(java.util.Comparator)) — doc
