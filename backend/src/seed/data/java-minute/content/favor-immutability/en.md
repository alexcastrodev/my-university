---
version: 1.0
updatedAt: 2026-08-30
---
## Question

# Why should you favor immutability?

## Short Answer

For many good reasons.

## Less Short Answer

When your objects are non-modifiable, you don't need to bother about the state they carry — it is the state you created them with. So debugging is much simpler, because you do not need to track when this state was modified.

## Simpler in a Concurrent Environment

It is simpler also in a concurrent environment. Non-modifiability comes with built-in thread safety: race conditions can only occur when you have a write operation, and here the only write operation you have is the creation of your object. So if you are using records, or classes with final instance fields, then the creation of your objects is protected against race conditions.

```java
public record Point(int x, int y) {} // fields are implicitly final
```

Non-modifiability makes your job much easier when it comes to bug hunting in your applications.

## One Last Word

Immutability will even bring better performance when Valhalla delivers value classes. And stop making fun of Valhalla not coming anytime soon — because it is coming sooner than you expect.

## References

- [Java Coding Tip #390: Why Should You Favor Immutability?](https://www.youtube.com/shorts/p9jdVv0BOzI) — video
- [Record Classes — The Java Tutorials](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [JEP 401: Value Classes and Objects (Preview)](https://openjdk.org/jeps/401) — doc
