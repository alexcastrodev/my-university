# Executor Services and the Concurrent API

---

## Overview

The `java.util.concurrent` package provides high-level abstractions for managing threads. Instead of creating and managing threads manually, submit tasks to an `ExecutorService` and let it handle lifecycle.

---

## ExecutorService

```java
ExecutorService exec = Executors.newFixedThreadPool(4);

// submit a Runnable — returns Future<?>
Future<?> f1 = exec.submit(() -> System.out.println("task"));

// submit a Callable — returns Future<V>
Future<Integer> f2 = exec.submit(() -> 6 * 7);

// execute a Runnable — fire-and-forget, no Future
exec.execute(() -> System.out.println("no future"));

exec.shutdown();
```

---

## Executors Factory Methods

| Factory Method | Description |
|----------------|-------------|
| `newFixedThreadPool(n)` | Pool of exactly `n` platform threads; tasks queue if all busy |
| `newCachedThreadPool()` | Grows unboundedly; idle threads recycled after 60 s |
| `newSingleThreadExecutor()` | One thread, tasks execute in submission order |
| `newVirtualThreadPerTaskExecutor()` | New virtual thread per task; no pooling |
| `newScheduledThreadPool(n)` | Fixed pool for scheduled/repeated tasks |

```java
ExecutorService fixed   = Executors.newFixedThreadPool(4);
ExecutorService cached  = Executors.newCachedThreadPool();
ExecutorService single  = Executors.newSingleThreadExecutor();
ExecutorService virtual = Executors.newVirtualThreadPerTaskExecutor();
```

---

## submit() vs execute()

| | `submit()` | `execute()` |
|---|---|---|
| Accepts | `Runnable` or `Callable` | `Runnable` only |
| Returns | `Future<?>` / `Future<V>` | `void` |
| Exception handling | Exceptions stored in `Future`; thrown on `get()` | Uncaught exceptions go to `UncaughtExceptionHandler` |

---

## Future\<V\>

```java
Future<String> future = exec.submit(() -> fetchData());

future.isDone();      // true if completed, cancelled, or threw an exception
future.isCancelled(); // true if cancelled before completion

// blocks until result is available
String result = future.get();

// blocks with timeout — throws TimeoutException if not done in time
String result2 = future.get(2, TimeUnit.SECONDS);

// cancel — true to interrupt if running
future.cancel(true);
```

> **Exam tip:** `Future.get()` throws `ExecutionException` (wrapping the task's exception) if the task threw, and `CancellationException` if it was cancelled.

---

## shutdown() vs shutdownNow()

| Method | Behaviour |
|--------|-----------|
| `shutdown()` | Stops accepting new tasks; waits for submitted tasks to finish |
| `shutdownNow()` | Attempts to interrupt running tasks; returns list of queued (never-started) tasks |
| `awaitTermination(timeout, unit)` | Blocks until all tasks finish or timeout elapses |
| `isShutdown()` | True after `shutdown()` or `shutdownNow()` called |
| `isTerminated()` | True after all tasks complete post-shutdown |

```java
exec.shutdown();
if (!exec.awaitTermination(10, TimeUnit.SECONDS)) {
    exec.shutdownNow();
}
```

---

## invokeAll() and invokeAny()

```java
List<Callable<Integer>> tasks = List.of(
    () -> 1,
    () -> 2,
    () -> 3
);

// invokeAll — submits all, blocks until ALL complete; returns List<Future<V>>
List<Future<Integer>> results = exec.invokeAll(tasks);
for (Future<Integer> f : results) {
    System.out.println(f.get());   // 1, 2, 3
}

// invokeAny — returns result of the FIRST successful task; cancels the rest
Integer first = exec.invokeAny(tasks);   // 1, 2, or 3
```

> **Exam tip:** `invokeAll()` always returns a `List` of completed `Future`s (done or failed). `invokeAny()` throws `ExecutionException` if all tasks fail.

---

## ScheduledExecutorService

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);

// run once after a delay
scheduler.schedule(() -> System.out.println("delayed"), 3, TimeUnit.SECONDS);

// run repeatedly — fixed rate (next run starts based on initial start time)
scheduler.scheduleAtFixedRate(() -> System.out.println("rate"), 0, 1, TimeUnit.SECONDS);

// run repeatedly — fixed delay (next run starts after previous finishes)
scheduler.scheduleWithFixedDelay(() -> System.out.println("delay"), 0, 1, TimeUnit.SECONDS);

scheduler.shutdown();
```

| Method | Initial Delay | Period Measurement |
|--------|--------------|-------------------|
| `scheduleAtFixedRate` | from start of execution | from start of previous run |
| `scheduleWithFixedDelay` | from end of execution | from end of previous run |

---

## try-with-resources and AutoCloseable

`ExecutorService` implements `AutoCloseable` since Java 19. `close()` calls `shutdown()` and awaits termination.

```java
try (ExecutorService exec = Executors.newFixedThreadPool(4)) {
    exec.submit(task1);
    exec.submit(task2);
}   // automatically shuts down and awaits termination
```

---

## Key Rules

- Always shut down an `ExecutorService`; orphaned pools prevent JVM exit.
- `submit(Callable)` returns a typed `Future<V>`; `submit(Runnable)` returns `Future<?>`.
- `execute()` does not return a `Future` — there is no way to check completion or retrieve exceptions.
- `invokeAll()` blocks until all tasks complete; `invokeAny()` returns as soon as one succeeds.
- Virtual thread executors should not be used for CPU-bound tasks that hold threads continuously.

---

## References

- [Oracle Docs — ExecutorService (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html)
- [Oracle Docs — Executors (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html)
- [Oracle Docs — Future (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html)
