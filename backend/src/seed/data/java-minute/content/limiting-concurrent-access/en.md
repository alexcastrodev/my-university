---
version: 1.0
updatedAt: 2026-07-22
---
## Question

# How can you limit the number of concurrent accesses to a resource?

## Short Answer

That's the job of a **semaphore**. The JDK ships a `Semaphore` class for exactly this: capping how many threads can use a resource at the same time, in a way that says clearly, in the code itself, "I want to limit concurrent access to this."

## What It Is

A semaphore holds a fixed number of **permits**. A thread calls `acquire()` before using the resource — which blocks if no permit is available — and `release()` when it's done, handing the permit back for another thread to use:

```java
var semaphore = new Semaphore(10);
try {
    semaphore.acquire();
    scope.fork(Service::readData);
} finally {
    semaphore.release();
}
```

This is a much more explicit and intention-revealing approach than a common alternative: creating a dedicated `ExecutorService` with a fixed thread pool sized to the limit you want.

```java
var executor = Executors.newFixedThreadPool(10);
executor.submit(Service::readData);
```

That trick works, but it hides the real intent behind an unrelated abstraction (a thread pool), and it's easy to misuse or lose track of as the codebase grows.

## A Stream-Based Alternative

Since Java added **stream gatherers** (JEP 485), there's a third option for this exact problem when you're processing a stream of requests: `Gatherers.mapConcurrent(maxConcurrency, mapper)`.

You pass it a maximum concurrency and a mapping function. Each mapping runs concurrently, but the number of mappings actively running at any given moment never exceeds `maxConcurrency` — internally, it's backed by the same kind of permit-based limiting a semaphore provides, without you having to manage one yourself.

## Practical Example

```java
var requests = List.of(/* your requests */);

var results = requests.stream()
    .gather(Gatherers.mapConcurrent(
        10, // max concurrency
        Service::readData))
    .toList();
```

Here, up to 10 calls to `Service::readData` run concurrently; the rest wait their turn automatically as slots free up.

## Solution and Conclusion

Prefer `Semaphore` when you need explicit, reusable control over access to a resource across arbitrary code paths. Prefer `Gatherers.mapConcurrent` when the work is naturally expressed as a stream of requests being mapped to responses — it keeps the code simpler and the intent obvious.

One important caveat: never combine this gatherer with a **parallel stream** — the two concurrency mechanisms fight each other and the result is a mess. Stick to a plain sequential stream; `mapConcurrent` already manages the concurrency for you.

## References

- [Java Coding Tip #379: Limiting Concurrent Access](https://www.youtube.com/shorts/q-coQ6MBjeE) — video
- [Semaphore — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [Gatherers.mapConcurrent — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html#mapConcurrent(int,java.util.function.Function)) — doc
- [JEP 485: Stream Gatherers](https://openjdk.org/jeps/485) — doc
