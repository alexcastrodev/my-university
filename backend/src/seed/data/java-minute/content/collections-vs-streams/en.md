---
version: 1.0
updatedAt: 2026-09-16
---
## Question

# What are the differences between collections and streams?

## Short Answer

They are different interfaces.

## Less Short Answer

The two concepts are fundamentally different in the way that a collection carries elements, while a stream does not. The `Collection` interface defines how you can add and remove elements, and how you can iterate over them. The `Stream` interface, on the other hand, defines how you can process elements: typically map, filter, and reduce them. So the two concerns, managing elements and processing them, are cleanly separated into two different interfaces.

## Why This Separation Matters

This separation is very powerful because it allows streams to connect to any source of data: collections, of course, but also strings of characters, regular expressions, files, file systems, and network sockets. The limit is your imagination.

## One Last Word

Connecting a stream to a custom source of data is not that hard. You need to implement the `Spliterator` interface, which is not trivial but not impossible, and pass this spliterator to the `StreamSupport.stream()` factory method. Neat!

## References

- [Java Coding Tip #395: What Are the Differences Between Collections and Streams?](https://www.youtube.com/shorts/TEZNPeH1Hwo) — video
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [Spliterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Spliterator.html) — doc
