# Practice: Concurrency

> Five exercises covering what the slides in this module introduced —
> thread creation, race conditions, thread-safe collections, deadlocks, and
> virtual threads. Each one shows code first; try to answer before opening
> the explanation.

---

## Exercise 1 — Two ways to start a thread

```java
class Greeter implements Runnable {
    public void run() {
        System.out.println("Runnable: " + Thread.currentThread().getName());
    }
}

public class Demo {
    public static void main(String[] args) {
        Thread t1 = new Thread(new Greeter());
        Thread t2 = new Thread(() -> System.out.println("Lambda: " + Thread.currentThread().getName()));
        t1.start();
        t2.start();
    }
}
```

Does this compile? Is the order of the two `println` lines guaranteed?

<details>
<summary>Answer</summary>

Compiles fine — `Greeter` implements `Runnable`, and a lambda is a valid
`Runnable` too, since `run()` is a single abstract method.

The **order is not guaranteed**. Once both threads are started, the JVM's
thread scheduler decides which one actually runs first — either line could
print first, and on a multi-core machine they could even interleave
character-by-character if the `println` calls weren't already synchronized
internally (they are, so each line prints atomically — just in unpredictable
order relative to each other).

What *is* guaranteed: each thread prints its own line exactly once, and
`Thread.currentThread().getName()` returns that thread's own name — never
`"main"`.

</details>

---

## Exercise 2 — The classic race condition

```java
public class Counter {
    private static int count = 0;

    public static void main(String[] args) throws InterruptedException {
        Runnable task = () -> {
            for (int i = 0; i < 1000; i++) {
                count++;
            }
        };

        Thread t1 = new Thread(task);
        Thread t2 = new Thread(task);
        t1.start();
        t2.start();
        t1.join();
        t2.join();

        System.out.println(count);
    }
}
```

Is `2000` always printed?

<details>
<summary>Answer</summary>

**Not guaranteed.** `count++` looks like one operation but is actually
three: read `count`, add 1, write it back. When both threads read the same
value before either writes it back, one increment gets silently lost. Run
this enough times and you'll usually see a number *less than* 2000 — though
occasionally, by chance, you might still land on exactly 2000.

Fix — make the increment atomic, e.g. with `AtomicInteger`:

```java
import java.util.concurrent.atomic.AtomicInteger;

private static final AtomicInteger count = new AtomicInteger(0);
// ...
Runnable task = () -> {
    for (int i = 0; i < 1000; i++) {
        count.incrementAndGet();
    }
};
// ...
System.out.println(count.get()); // always 2000
```

</details>

---

## Exercise 3 — `HashMap` under a parallel stream

```java
Map<String, Integer> counts = new HashMap<>();

List<String> words = List.of("a", "b", "a", "c", "b", "a");
words.parallelStream().forEach(w -> counts.merge(w, 1, Integer::sum));

System.out.println(counts);
```

What's risky about this code, and what's the fix?

<details>
<summary>Answer</summary>

`HashMap` is **not thread-safe**. `merge()` can trigger structural changes
(resizing, bucket rewiring) internally, and when two threads do that at the
same time on a plain `HashMap`, the result is undefined — you can get a
wrong count, a `ConcurrentModificationException`, or in rare cases even an
infinite loop on older JDKs. This bug is easy to miss because it often
*looks* fine in small test runs and only misbehaves under real concurrent
load.

Two valid fixes:

```java
// Option 1: a map designed for concurrent access
Map<String, Integer> counts = new ConcurrentHashMap<>();
words.parallelStream().forEach(w -> counts.merge(w, 1, Integer::sum));

// Option 2: let the Collector own the aggregation instead of a shared map
Map<String, Long> counts2 = words.parallelStream()
    .collect(Collectors.groupingBy(w -> w, Collectors.counting()));
```

</details>

---

## Exercise 4 — Will this deadlock?

```java
class Resource {}

Resource resourceA = new Resource();
Resource resourceB = new Resource();

Thread t1 = new Thread(() -> {
    synchronized (resourceA) {
        synchronized (resourceB) {
            System.out.println("t1 done");
        }
    }
});

Thread t2 = new Thread(() -> {
    synchronized (resourceB) {
        synchronized (resourceA) {
            System.out.println("t2 done");
        }
    }
});

t1.start();
t2.start();
```

<details>
<summary>Answer</summary>

**Yes, it can deadlock** — this is the textbook lock-ordering deadlock.
If the timing lines up so that `t1` acquires `resourceA` at roughly the same
moment `t2` acquires `resourceB`, then `t1` blocks waiting for `resourceB`
(held by `t2`), and `t2` blocks waiting for `resourceA` (held by `t1`).
Neither thread ever releases what it's holding, so both wait forever and
neither `println` ever runs. It won't happen on *every* run — it depends on
timing — which is exactly what makes this bug dangerous in production.

Fix: always acquire the two locks in the **same global order** in every
thread. If `t2` also locked `resourceA` before `resourceB`, the deadlock
becomes impossible — whichever thread gets `resourceA` first simply makes
the other one wait, and no cycle can form.

</details>

---

## Exercise 5 — Virtual threads and `try`-with-resources

```java
import java.util.concurrent.*;

public class VThreads {
    public static void main(String[] args) throws Exception {
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<String> future = executor.submit(() -> {
                Thread.sleep(100);
                return "done on " + Thread.currentThread();
            });
            System.out.println(future.get());
        }
    }
}
```

Two questions: does the `try`-with-resources block wait for the submitted
task to finish before moving on? And what does `Thread.currentThread()`
actually print for a virtual thread?

<details>
<summary>Answer</summary>

**Yes, it waits** — twice over, in fact. `future.get()` already blocks
until the task completes, so by the time the `try` block's body finishes,
the task is done. On top of that, `ExecutorService` has implemented
`AutoCloseable` since Java 19: its `close()` calls `shutdown()` and then
blocks until all submitted tasks finish (or the close itself is
interrupted), so even without the explicit `future.get()`, exiting the
`try`-with-resources block would still wait for in-flight work.

`Thread.currentThread()` on a virtual thread does **not** print a fixed OS
thread name the way a platform thread does. It prints something like
`VirtualThread[#33]/runnable@ForkJoinPool-1-worker-1` — the part after `@`
is the *carrier* (platform) thread currently running it, and that carrier
can change across the virtual thread's lifetime as it's unmounted and
remounted, which is exactly what makes virtual threads cheap to create by
the thousands.

</details>
