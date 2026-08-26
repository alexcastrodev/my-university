---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Early Java (before Java 2) let you pause, restart, and kill a thread from the outside with `Thread.suspend()`, `resume()`, and `stop()`. All three were deprecated for being able to corrupt shared state, and the fix — cooperative, flag-checked shutdown instead of external control — is still the shape of correct thread lifecycle code today. Their decline didn't stop at deprecation either: `suspend()`/`resume()` were removed outright from the API in Java SE 23, and `stop()` — still present and still deprecated for removal — now always throws `UnsupportedOperationException` instead of doing anything. That same pre-2 era also treated a `Thread` as an expensive, OS-backed resource to be rationed with pools. Virtual threads (JEP 444, standard since Java 21) don't change why `suspend`/`resume`/`stop` were unsafe, but they do remove the *reason* those old pooling habits existed in the first place.

## Use Cases

- Recognizing `Thread.suspend()`/`resume()`/`stop()` (or code that still calls them) as a correctness bug, not just a style nit, when reading or porting old Java code.
- Implementing pause/resume/cancel for a long-running task using a checked flag instead of external thread control.
- Deciding whether a piece of concurrent code needs a bounded `ExecutorService` (platform threads, a scarce resource) or can just spin up one virtual thread per task (an abundant one) — the same cost/pooling question the book's era answered only one way.

## Deep Dive

### Why `suspend()`/`resume()`/`stop()` were deprecated

```java
// Legacy control API — deprecated since Java 1.2, shown for what NOT to do.
// On current JDKs this no longer even compiles as written; see below.
Thread worker = new Thread(() -> updateCriticalStructure());
worker.start();
worker.suspend(); // Thread.suspend() — removed from the API in Java SE 23
worker.stop();    // Thread.stop() — still present, but always throws now
```

`suspend()` freezes a thread wherever it happens to be — including in the middle of holding a lock on a critical data structure. Because a suspended thread doesn't release what it holds, any other thread waiting on that same lock deadlocks: the only thread that could release the lock (by calling `resume()`) is usually a *different* thread than the one now blocked waiting for it. `stop()` is worse: it force-releases every lock the target thread holds, at whatever point execution happened to be, so a data structure that was mid-update is left in a corrupted state — and that corrupted state is now visible to any other thread that was waiting on the just-released lock.

This is not just historical color: both methods were `@Deprecated(forRemoval = true)` for years, and the JVM has since followed through in stages. `Thread.suspend()`/`resume()` were first changed to always throw `UnsupportedOperationException` (Java 20), then removed from `Thread` entirely in Java SE 23 — calling `worker.suspend()` against a current JDK fails to compile with "cannot find symbol." `Thread.stop()` took the softer path: the method is still declared on `Thread` (still deprecated for removal), but its body now unconditionally throws `UnsupportedOperationException` — it compiles, but it can never again stop a thread.

### The replacement: cooperative shutdown via a checked flag

```java
class Worker extends Thread {
    private volatile boolean running = true;

    @Override
    public void run() {
        while (running) {
            doUnitOfWork();
        }
    }

    void requestStop() { // called from another thread
        running = false;
    }
}
```

Instead of an external thread reaching in and freezing/killing another thread mid-instruction, the target thread checks its own flag at a safe point between units of work and exits `run()` on its own terms — never mid-update, never while holding a lock it doesn't know it's abandoning. This is the same idea the book's own `wait()`/`notify()`-based suspend/resume example demonstrates, and it's still exactly how correct cooperative cancellation works today (`Thread.interrupt()` plus a checked `isInterrupted()`/`InterruptedException` is the standard-library version of the same pattern).

### What virtual threads change — and what they don't

```java
// One virtual thread per task, no pool sizing decision to make
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Result> f1 = executor.submit(() -> callServiceA());
    Future<Result> f2 = executor.submit(() -> callServiceB());
}
```

The book's threading model treats a `Thread` as a scarce, OS-backed resource — one reason thread *pools* (reusing a bounded set of platform threads across many tasks) became standard practice: creating thousands of platform threads risks exhausting OS resources. Virtual threads (JEP 444) are mapped many-to-one onto a small number of carrier (platform) threads and unmounted while blocked on I/O, so millions can exist at once — the official guidance is explicitly to stop pooling them and instead create one per task, using a `Semaphore` if concurrency needs to be capped. This doesn't touch the `suspend`/`resume`/`stop` problem at all — a virtual thread has the exact same `java.lang.Thread` contract and would corrupt state exactly the same way if those deprecated methods still worked on it. Virtual threads solve a cost/scale problem (how many threads you can afford to have), not a correctness problem (what a thread is allowed to do to shared state while it's paused or killed).

## Trade-offs

- **The old API didn't just get a warning label — the JVM eventually enforced it** — `stop()` still compiles (deprecated for removal) but its body now unconditionally throws, so old code calling it fails loudly at run time instead of silently corrupting state; `suspend()`/`resume()` went further and were deleted from `Thread`, so old source calling them no longer compiles at all.
```java
Thread t = new Thread(() -> {});
t.start();
t.stop();    // compiles; throws UnsupportedOperationException at run time
t.suspend(); // compile error: cannot find symbol — removed in Java SE 23
```
- **Cooperative shutdown adds a small amount of ceremony** — the task's own loop has to check a flag or handle `InterruptedException`, versus the (unsafe) one-liner `stop()`; there's no way to force-terminate a thread that isn't cooperating, by design.
- **Pooling habits from the platform-thread era don't just disappear** — code that wraps virtual threads in a fixed-size `ExecutorService` (instead of `newVirtualThreadPerTaskExecutor()`) keeps the old scarcity mindset and throws away most of the scalability virtual threads offer, without being wrong in any way the compiler can flag.

## Documentation Links

- [Virtual Threads (Java SE developer guide)](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [Thread.stop() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#stop()) — doc
- [Why is Thread.stop deprecated and the ability to stop a thread removed?](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/doc-files/threadPrimitiveDeprecation.html) — doc
- [Java SE 25 Migration Guide — Removed APIs (Thread.suspend/resume)](https://docs.oracle.com/en/java/javase/25/migrate/removed-apis.html) — doc
