---
version: 1.0
updatedAt: 2026-07-23
---
## Question

# What is a subsized stream?

## Short Answer

A subsized stream is a good candidate for parallel execution. Being **sized** means the stream already knows how many elements it will process; being **subsized** means that if you split the stream into substreams, each substream also knows its own element count.

## What It Is

A stream is **sized** when its size is known upfront without consuming it — for example, a stream opened on any collection is sized, since you can just call `size()` on the collection.

A stream is **subsized** when splitting it produces substreams that are themselves sized. Not every sized stream is subsized: it depends entirely on how the underlying data structure splits.

## Lists vs. Sets

`List` gives you subsized streams: if you split a list into two sublists, you know exactly how many elements landed in each one.

`Set` does not. Splitting a set means splitting its internal array, and there's no guarantee of how the elements land across the two halves. In the worst case, one half could end up with zero elements and the other with all of them — a completely unbalanced split.

## Why It Matters

Splitting a data source is exactly what parallel streams do internally: they divide the source into chunks and process each chunk on a different thread. If a source can't be split evenly — like a `Set` — a parallel stream over it can end up with badly unbalanced work, where one thread does almost everything while others sit idle.

## Practical Example

```java
List<Integer> list = List.of(1, 2, 3, 4, 5, 6);
Set<Integer> set = Set.of(1, 2, 3, 4, 5, 6);

list.stream().spliterator().hasCharacteristics(Spliterator.SUBSIZED); // true
set.stream().spliterator().hasCharacteristics(Spliterator.SUBSIZED);  // false
```

A `List`'s spliterator reports `SUBSIZED`; a `Set`'s does not, since its internal array can't be divided predictably.

## Solution and Conclusion

Don't reach for a parallel stream on a source that isn't easily splittable — a `HashSet`, for instance, is a poor candidate. And even when a source is subsized, like a `List`, think twice before parallelizing: the overhead of splitting and coordinating threads can easily outweigh the benefit, and a parallel stream can end up hurting performance rather than improving it.

## References

- [Java Coding Tip #377: Sized and Subsized Streams](https://www.youtube.com/shorts/WLsaE5eC9k8) — video
- [Spliterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html) — doc
- [Spliterator.SUBSIZED — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html#SUBSIZED) — doc
