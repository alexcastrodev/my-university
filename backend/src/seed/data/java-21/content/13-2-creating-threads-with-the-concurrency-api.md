# Creating Threads with the Concurrency API

> The `java.util.concurrent` package provides high-level abstractions for managing threads. Instead of creating and managing `Thread` objects manually, you submit tasks to an **executor service** and let the framework handle the threading details.

---

## Why Use the Concurrency API?

Manually managing threads is error-prone: forgetting to call `start()`, not handling exceptions, or creating too many threads and overwhelming the system. The Concurrency API solves these problems by separating **task definition** from **thread management**.

---

## `ExecutorService`

`ExecutorService` is the central interface. You obtain instances from the `Executors` factory class.

### Common Factory Methods

| Factory Method | Description |
|---|---|
| `Executors.newSingleThreadExecutor()` | One thread processes tasks sequentially |
| `Executors.newFixedThreadPool(int n)` | Pool of exactly `n` threads |
| `Executors.newCachedThreadPool()` | Grows and shrinks as needed; reuses idle threads |
| `Executors.newSingleThreadScheduledExecutor()` | Single thread with scheduling support |
| `Executors.newScheduledThreadPool(int n)` | Fixed pool with scheduling support |

---

## Submitting `Runnable` Tasks

`execute(Runnable)` submits a task and returns nothing. `submit(Runnable)` also submits but returns a `Future<?>` that can be used to detect exceptions or wait for completion.

```java
ExecutorService service = Executors.newFixedThreadPool(3);
try {
    service.execute(() -> System.out.println("Task A"));

    Future<?> future = service.submit(() -> System.out.println("Task B"));
    future.get(); // blocks until Task B finishes
} finally {
    service.shutdown();
}
```

---

## Submitting `Callable<T>` Tasks

`Callable<T>` is like `Runnable` but it **returns a value** and can **throw a checked exception**. Use `submit(Callable<T>)` to get a `Future<T>`.

```java
ExecutorService service = Executors.newSingleThreadExecutor();
try {
    Callable<Integer> task = () -> {
        int sum = 0;
        for (int i = 1; i <= 100; i++) sum += i;
        return sum;
    };

    Future<Integer> future = service.submit(task);
    System.out.println("Sum: " + future.get()); // 5050
} finally {
    service.shutdown();
}
```

---

## `Future<T>` API

A `Future<T>` represents the pending result of an asynchronous computation.

| Method | Description |
|---|---|
| `get()` | Blocks until result is available; throws checked exceptions |
| `get(long timeout, TimeUnit unit)` | Blocks up to the given time; throws `TimeoutException` |
| `isDone()` | Returns `true` if task completed (normally, by exception, or cancellation) |
| `isCancelled()` | Returns `true` if task was cancelled before completion |
| `cancel(boolean mayInterruptIfRunning)` | Attempts to cancel; `true` to interrupt if running |

```java
Future<String> future = service.submit(() -> {
    Thread.sleep(500);
    return "done";
});

if (!future.isDone()) {
    System.out.println("Still running...");
}

try {
    String result = future.get(1, TimeUnit.SECONDS);
    System.out.println("Result: " + result);
} catch (TimeoutException e) {
    future.cancel(true);
}
```

> **Exam tip:** `Future.get()` wraps any exception thrown inside the task in an `ExecutionException`. Call `getCause()` on the `ExecutionException` to retrieve the original exception.

---

## Shutting Down an `ExecutorService`

An executor service will not stop accepting tasks, and the JVM will not exit, unless you explicitly shut it down.

| Method | Behaviour |
|---|---|
| `shutdown()` | Stops accepting new tasks; waits for submitted tasks to finish |
| `shutdownNow()` | Attempts to stop all running tasks immediately; returns pending tasks |
| `awaitTermination(long t, TimeUnit u)` | Blocks until shutdown completes or timeout elapses |
| `isShutdown()` | `true` after `shutdown()` or `shutdownNow()` was called |
| `isTerminated()` | `true` after all tasks have finished post-shutdown |

```java
service.shutdown();
boolean finished = service.awaitTermination(10, TimeUnit.SECONDS);
if (!finished) {
    service.shutdownNow();
}
```

---

## `ScheduledExecutorService`

`ScheduledExecutorService` extends `ExecutorService` to support delayed and periodic execution.

| Method | Description |
|---|---|
| `schedule(Callable, delay, unit)` | Run once after delay |
| `schedule(Runnable, delay, unit)` | Run once after delay |
| `scheduleAtFixedRate(Runnable, initialDelay, period, unit)` | Repeat at fixed rate regardless of task duration |
| `scheduleWithFixedDelay(Runnable, initialDelay, delay, unit)` | Wait fixed delay between end of last run and start of next |

```java
ScheduledExecutorService scheduler =
    Executors.newSingleThreadScheduledExecutor();
try {
    scheduler.schedule(
        () -> System.out.println("Delayed task"),
        2, TimeUnit.SECONDS
    );

    scheduler.scheduleAtFixedRate(
        () -> System.out.println("Heartbeat"),
        0, 1, TimeUnit.SECONDS
    );
} finally {
    scheduler.shutdown();
}
```

---

## Submitting Multiple Tasks with `invokeAll` and `invokeAny`

| Method | Behaviour |
|---|---|
| `invokeAll(Collection<Callable<T>>)` | Submits all tasks; blocks until all complete; returns `List<Future<T>>` |
| `invokeAny(Collection<Callable<T>>)` | Submits all tasks; returns the result of the **first** to complete successfully |

```java
List<Callable<String>> tasks = List.of(
    () -> "result-A",
    () -> "result-B",
    () -> "result-C"
);

List<Future<String>> futures = service.invokeAll(tasks);
for (Future<String> f : futures) {
    System.out.println(f.get());
}

String fastest = service.invokeAny(tasks);
System.out.println("Fastest: " + fastest);
```

---

## Key Rules Summary

- Obtain `ExecutorService` instances from `Executors` factory methods — never create threads manually.
- Use `Callable<T>` when a task needs to return a value or throw a checked exception.
- Always call `shutdown()` (usually in a `finally` block) to avoid thread leaks.
- `Future.get()` blocks; prefer `isDone()` to poll without blocking.
- `ScheduledExecutorService` handles delayed and recurring tasks.

---

## References

- [Oracle Docs — ExecutorService](https://docs.oracle.com/en/java/docs/api/java.base/java/util/concurrent/ExecutorService.html)
- [Oracle Docs — Future](https://docs.oracle.com/en/java/docs/api/java.base/java/util/concurrent/Future.html)
- OCP Study Guide, Chapter 13 — Concurrency
