---
version: 1.0
updatedAt: 2026-09-04
---
## Question

# What are the characteristics of a Collector?

## Short Answer

There are three of them.

## Less Short Answer

They are defined in the `Collector.Characteristics` enum, and the Stream API implementation uses them to know how it's allowed to drive your collector.

## The Three Characteristics

- **CONCURRENT** — this collector supports concurrency for the Stream API: a parallel stream is allowed to use it.
- **UNORDERED** — you're collecting data into a container that doesn't care about the order in which it receives elements. That's the case for `Collectors.toSet()`, for instance. This property can be used to relax some constraints on the computation of parallel streams.
- **IDENTITY_FINISH** — the finisher of your collector is the identity function, so the implementation doesn't need to call it. That's the case for `Collectors.toList()` or `Collectors.toSet()`, but it is *not* the case for `Collectors.joining()`.

## One Last Word

Setting the `CONCURRENT` characteristic to true does not magically make your collector concurrent — providing a thread-safe implementation is your responsibility.

## References

- [Java Coding Tip #392: What Are the Characteristics of a Collector?](https://www.youtube.com/shorts/zsSblXfes88) — video
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
