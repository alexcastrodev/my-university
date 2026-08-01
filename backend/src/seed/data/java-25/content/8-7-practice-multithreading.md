# Practice: Multithreading

> Five exercises covering what the slides in this module introduced —
> virtual vs. platform threads, `run()` vs. `start()`, scoped values,
> synchronized locking on virtual threads, and structured concurrency. Try
> to answer before opening each explanation.

---

## Exercise 1 — `run()` on an unstarted virtual thread

```java
Thread t = Thread.ofVirtual().unstarted(() -> System.out.println("hi from " + Thread.currentThread()));
t.run();
System.out.println(t.isVirtual());
System.out.println(t.getState());
```

What gets printed for all three lines?

<details>
<summary>Answer</summary>

```
hi from Thread[#1,main]              (the exact name/id varies, but it's the CALLING thread)
true
NEW
```

Calling `t.run()` directly does **not** start a new thread — it just calls
the `run()` method like any other method, executing synchronously on
whichever thread called it (here, `main`). So the lambda's `println` runs
on the *calling* thread, not on a virtual thread's carrier, even though
`t` itself was built with `Thread.ofVirtual()`.

`t.isVirtual()` still returns `true` — it reflects how the `Thread` object
was *built*, not whether it's currently mounted and running.

`t.getState()` is still `NEW`, because `start()` was never called. `run()`
bypasses the JVM scheduler entirely — the thread's lifecycle never
advances past `NEW`.

</details>

---

## Exercise 2 — Re-interrupting after a caught `InterruptedException`

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
Future<Integer> future = executor.submit(() -> {
    try {
        Thread.sleep(50);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return -1;
    }
    return 42;
});
System.out.println(future.get());
executor.shutdown();
```

Under normal conditions (nothing interrupts this task), what's printed —
and why bother calling `Thread.currentThread().interrupt()` in the `catch`
block if the method is about to `return -1` anyway?

<details>
<summary>Answer</summary>

Prints `42` — nothing interrupts the sleep in this example, so the
`catch` block never actually runs here.

The `interrupt()` call matters as a general habit, not for this specific
run: swallowing an `InterruptedException` without restoring the
interrupted flag hides the signal from any other code that might later
check `Thread.currentThread().isInterrupted()` on that same thread. It's
most consequential with *reused* threads (like a fixed platform-thread
pool), where a later task on the same thread would otherwise have no way
to know an interrupt happened earlier. Virtual threads are one-per-task
and discarded afterward, so the risk is lower here — but "always restore
the flag when you can't fully handle the interruption" is a rule worth
applying consistently rather than deciding case by case.

</details>

---

## Exercise 3 — `ScopedValue` binding and `isBound()`

```java
static final ScopedValue<String> TENANT = ScopedValue.newInstance();

public static void main(String[] args) {
    System.out.println(TENANT.isBound());
    ScopedValue.where(TENANT, "acme").run(() -> {
        System.out.println(TENANT.get());
        inner();
    });
    System.out.println(TENANT.isBound());
}

static void inner() {
    System.out.println(TENANT.orElse("none"));
}
```

Predict all four lines of output.

<details>
<summary>Answer</summary>

```
false
acme
acme
false
```

`TENANT.isBound()` is `false` before and after the `run()` call — a
`ScopedValue` is only bound for the dynamic extent of the lambda passed to
`run()`/`call()`, and is automatically unbound when it returns.

Inside `run()`, `TENANT.get()` returns `"acme"`. `inner()` is a separate
method, but it's still called *from within* that `run()` lambda's dynamic
scope, so the binding is visible there too — `TENANT.orElse("none")`
returns `"acme"`, not the fallback. Scoped-value visibility follows the
call stack during the binding's lifetime, not lexical nesting.

</details>

---

## Exercise 4 — Does `synchronized` still pin virtual threads?

```java
Object lock = new Object();

Runnable task = () -> {
    synchronized (lock) {
        try {
            Thread.sleep(100);   // stands in for blocking I/O
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
};

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 1000; i++) {
        executor.submit(task);
    }
}
```

Running on Java 25: does submitting 1,000 of these tasks risk exhausting
the carrier thread pool?

<details>
<summary>Answer</summary>

**No** — not on Java 24 or later. Before Java 24, a virtual thread blocking
inside a `synchronized` block could not unmount from its carrier thread
("pinning"), so 1,000 concurrently sleeping virtual threads really could
have tied up 1,000 carrier (platform) threads — a genuine scalability
problem, and the standard workaround was replacing `synchronized` with
`ReentrantLock`, which never pinned.

**JEP 491 (Java 24)** removed that limitation: a virtual thread blocking
inside `synchronized` now unmounts from its carrier normally, exactly like
it already did with `ReentrantLock`. On Java 25, this code unmounts each
virtual thread during its `Thread.sleep(100)`, freeing carriers to run
other virtual threads — the `synchronized`-vs-`ReentrantLock` choice here
is no longer a scalability concern, only a matter of which extra features
(`tryLock`, fairness, `Condition`) you might still want from
`ReentrantLock`.

</details>

---

## Exercise 5 — `StructuredTaskScope.ShutdownOnFailure`

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<String> a = scope.fork(() -> "user-data");
    Future<String> b = scope.fork(() -> {
        throw new RuntimeException("boom");
    });
    scope.join().throwIfFailed();
    System.out.println(a.resultNow() + b.resultNow());
} catch (Exception e) {
    System.out.println("failed: " + e.getMessage());
}
```

Does `"user-data"` + the second task's result ever get printed? What
happens to subtask `a` when subtask `b` fails?

<details>
<summary>Answer</summary>

The `println` on the line after `throwIfFailed()` is **never reached**.
`ShutdownOnFailure` is a fail-fast policy: as soon as one forked subtask
fails, the scope is shut down, which cancels any sibling subtasks that
haven't finished yet (here, `a` may or may not have completed by that
point — its result is simply discarded either way, since it's never read).
`scope.join()` returns once every subtask has reached a terminal state
(completed, failed, or was cancelled by the shutdown), and
`throwIfFailed()` then throws — wrapping the original `RuntimeException`
inside an `ExecutionException` — which sends control straight to the
`catch` block instead of the `println`. So the output is a `"failed: ..."`
line whose message reflects that wrapped exception, not `"user-databoom"`
or anything built from `a`/`b`'s results.

</details>
