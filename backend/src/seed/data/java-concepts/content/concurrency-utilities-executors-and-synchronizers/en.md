---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`Thread`, `Runnable`, and `synchronized` (covered in depth by the companion concept
on the [legacy vs. virtual thread model](../thread-model-legacy-vs-virtual-threads.md))
are the *primitives* Java has always had for concurrency. JDK 5 added a layer on top
of them — the **concurrency utilities**, spread across `java.util.concurrent`,
`java.util.concurrent.atomic`, and `java.util.concurrent.locks` — that gives programs
higher-level, purpose-built tools instead of hand-rolled `wait()`/`notify()` code:
thread pools managed by an `Executor`, tasks that return a value via `Callable`/
`Future`, ready-made synchronizers (`Semaphore`, `CountDownLatch`, `CyclicBarrier`),
an explicit `Lock` alternative to `synchronized`, and lock-free atomic variables. This
concept covers that toolkit; the Fork/Join framework (JDK 7's addition for
divide-and-conquer parallelism) is a separate, closely related concept.

## Use Cases

- Running a bounded number of concurrent tasks — HTTP handlers, background jobs —
  without creating a raw `Thread` per task, by submitting them to a pooled
  `ExecutorService`.
- Getting a result (or a checked exception) back from a background computation via
  `Callable`+`Future`, instead of writing it into a shared field a `Runnable`
  mutates.
- Making one thread wait for several others to finish a one-time startup sequence
  (`CountDownLatch`), or making a fixed group of threads rendezvous repeatedly at
  the same point in a loop (`CyclicBarrier`).
- Throttling concurrent access to a limited resource — a connection pool, a rate
  limit — to at most *N* threads at once with a `Semaphore`.
- Needing `tryLock()` (never block), a lock that can be acquired across multiple
  methods without nesting `synchronized` blocks, or per-condition `await()`/
  `signal()` — none of which plain `synchronized` offers.
- Maintaining a simple shared counter or flag under concurrent updates without
  taking out a lock at all, via `AtomicInteger`/`AtomicLong`.

## Deep Dive

### ExecutorService and thread pools

An `Executor` decouples *submitting* a task from deciding how (and on which thread)
it runs. `ExecutorService` extends it with lifecycle control — `submit()`/
`execute()` to hand off work, `shutdown()` to stop accepting new work once queued
tasks finish. `Executors` is the factory: `newFixedThreadPool(n)` caps the pool at
`n` threads, `newCachedThreadPool()` grows on demand and reuses idle threads,
`newScheduledThreadPool(n)` adds delayed/periodic execution.

```java
import java.util.concurrent.*;

class SimpExec {
  public static void main(String[] args) {
    ExecutorService es = Executors.newFixedThreadPool(2);

    System.out.println("Starting");

    // Four tasks share a pool of two threads.
    es.execute(new MyThread("A"));
    es.execute(new MyThread("B"));
    es.execute(new MyThread("C"));
    es.execute(new MyThread("D"));

    es.shutdown(); // without this call, the program never terminates
    System.out.println("Done");
  }
}

class MyThread implements Runnable {
  String name;
  MyThread(String n) { name = n; }

  public void run() {
    for (int i = 0; i < 5; i++) {
      System.out.println(name + ": " + i);
    }
  }
}
```

Only two of the four `MyThread` tasks run at any instant; the rest wait for a pool
thread to free up. `shutdown()` is not optional cleanup — an `ExecutorService` that
is never shut down keeps its threads alive and the JVM running.

### Callable and Future: tasks that return a value

`Runnable.run()` returns nothing and cannot declare a checked exception. `Callable<V>`
fixes both: its single method, `V call() throws Exception`, returns a result and is
allowed to fail. Submitting a `Callable` to an `ExecutorService` returns a
`Future<V>` — a handle to a result that doesn't exist yet. `Future.get()` blocks
until the task finishes (or a timeout, in the overload that takes a `TimeUnit`) and
either returns the value or rethrows the task's failure wrapped in an
`ExecutionException`.

```java
import java.util.concurrent.*;

class CallableDemo {
  public static void main(String[] args) {
    ExecutorService es = Executors.newFixedThreadPool(3);
    Future<Integer> f;
    Future<Double> f2;
    Future<Integer> f3;

    System.out.println("Starting");

    f = es.submit(new Sum(10));
    f2 = es.submit(new Hypot(3, 4));
    f3 = es.submit(new Factorial(5));

    try {
      System.out.println(f.get());
      System.out.println(f2.get());
      System.out.println(f3.get());
    } catch (InterruptedException exc) {
      System.out.println(exc);
    } catch (ExecutionException exc) {
      System.out.println(exc);
    }

    es.shutdown();
    System.out.println("Done");
  }
}

class Sum implements Callable<Integer> {
  int stop;
  Sum(int v) { stop = v; }

  public Integer call() {
    int sum = 0;
    for (int i = 1; i <= stop; i++) sum += i;
    return sum;
  }
}

class Hypot implements Callable<Double> {
  double side1, side2;
  Hypot(double s1, double s2) { side1 = s1; side2 = s2; }

  public Double call() {
    return Math.sqrt((side1 * side1) + (side2 * side2));
  }
}

class Factorial implements Callable<Integer> {
  int stop;
  Factorial(int v) { stop = v; }

  public Integer call() {
    int fact = 1;
    for (int i = 2; i <= stop; i++) fact *= i;
    return fact;
  }
}
```

All three `call()` methods run concurrently on the pool; `get()` on each `Future`
simply waits for that particular task. `Future` predates `CompletableFuture` (added
in Java 8): it has no way to attach a callback or chain a follow-up computation —
`get()` is the only way out, and it blocks the calling thread. `CompletableFuture`
adds `thenApply()`/`thenCompose()`/`thenCombine()` and friends for composing async
work without blocking; reach for it over raw `Future` in new code.

### Coordination primitives: CountDownLatch, CyclicBarrier, and Semaphore

These three solve different shapes of the same problem — "make threads wait for
each other" — and picking the wrong one usually means fighting the API instead of
using it.

**`CountDownLatch`** is a one-shot gate: created with a count of events to wait for,
it opens permanently once `countDown()` has been called that many times. It cannot
be reset or reused.

```java
import java.util.concurrent.CountDownLatch;

class CDLDemo {
  public static void main(String[] args) {
    CountDownLatch cdl = new CountDownLatch(5);

    System.out.println("Starting");

    new Thread(new MyThread(cdl)).start();

    try {
      cdl.await(); // blocks until the count reaches zero
    } catch (InterruptedException exc) {
      System.out.println(exc);
    }

    System.out.println("Done");
  }
}

class MyThread implements Runnable {
  CountDownLatch latch;
  MyThread(CountDownLatch c) { latch = c; }

  public void run() {
    for (int i = 0; i < 5; i++) {
      System.out.println(i);
      latch.countDown(); // decrement count
    }
  }
}
```

**`CyclicBarrier`** makes a *fixed* set of threads rendezvous at a point and then
resets automatically, so it can be reused across repeated rounds — useful when the
same group of threads needs to sync up once per loop iteration rather than once
ever:

```java
CyclicBarrier barrier = new CyclicBarrier(3, () ->
    System.out.println("All three reached the barrier"));

// each of the three worker threads, once per round:
barrier.await(); // blocks until all 3 have called await(), then all resume together
```

**`Semaphore`** counts *permits* rather than arrivals: `acquire()` blocks only when
the permit count is already zero, and `release()` gives one back. With an initial
count of 1 it behaves like a mutex; with a higher count it caps concurrent access
at that many threads.

```java
import java.util.concurrent.Semaphore;

class SemDemo {
  public static void main(String[] args) {
    Semaphore sem = new Semaphore(1);

    new Thread(new IncThread(sem, "A")).start();
    new Thread(new DecThread(sem, "B")).start(); // mirrors IncThread, decrements
  }
}

class Shared {
  static int count = 0;
}

class IncThread implements Runnable {
  String name;
  Semaphore sem;
  IncThread(Semaphore s, String n) { sem = s; name = n; }

  public void run() {
    try {
      sem.acquire(); // blocks here if the permit is already taken
      for (int i = 0; i < 5; i++) {
        Shared.count++;
        System.out.println(name + ": " + Shared.count);
        Thread.sleep(10); // give the other thread a chance to try acquire()
      }
    } catch (InterruptedException exc) {
      System.out.println(exc);
    }
    sem.release();
  }
}
```

Without the `acquire()`/`release()` pair, both threads would interleave their
increments and decrements on `Shared.count`; with a single permit, one thread runs
its whole five-iteration loop before the other is let in. Two more specialized
synchronizers live in the same package — `Exchanger`, which pairs exactly two
threads to swap a value, and `Phaser`, which generalizes `CyclicBarrier` to
multiple named phases — reach for them only when none of the three above fit.

### Explicit locks: Lock, ReentrantLock, and Condition

`Lock` is an interface — `lock()`, `unlock()`, `tryLock()`, `newCondition()` — that
does the same job as `synchronized` but as an ordinary object instead of a language
keyword. `ReentrantLock` is its standard implementation: a thread that already
holds the lock can re-acquire it (each `lock()` call must be matched by an
`unlock()`).

```java
import java.util.concurrent.locks.*;

class LockDemo {
  public static void main(String[] args) {
    ReentrantLock lock = new ReentrantLock();

    new Thread(new LockThread(lock, "A")).start();
    new Thread(new LockThread(lock, "B")).start();
  }
}

class Shared {
  static int count = 0;
}

class LockThread implements Runnable {
  String name;
  ReentrantLock lock;
  LockThread(ReentrantLock lk, String n) { lock = lk; name = n; }

  public void run() {
    try {
      lock.lock(); // blocks here if another thread already holds the lock
      Shared.count++;
      System.out.println(name + ": " + Shared.count);
      Thread.sleep(1000); // proves the second thread really does wait
    } catch (InterruptedException exc) {
      System.out.println(exc);
    } finally {
      lock.unlock(); // must run even if the try block throws
    }
  }
}
```

Unlike `synchronized`, which releases automatically when the block exits, `Lock`
gives no such guarantee — `unlock()` belongs in a `finally` block, always. In
exchange, `Lock` offers what `synchronized` cannot: `tryLock()` to attempt
acquisition without blocking, and `newCondition()` for multiple independent wait
sets on the same lock (versus `Object.wait()`/`notify()`, which every object has
only one of).

### Atomic variables: lock-free updates

`java.util.concurrent.atomic` classes such as `AtomicInteger` and `AtomicLong`
perform get/set/compare-and-swap as a single uninterruptible hardware operation —
no `Lock`, no `synchronized`, and no blocking, for the common case of a single
shared counter or flag.

```java
import java.util.concurrent.atomic.AtomicInteger;

class AtomicDemo {
  public static void main(String[] args) {
    new Thread(new AtomThread("A")).start();
    new Thread(new AtomThread("B")).start();
    new Thread(new AtomThread("C")).start();
  }
}

class Shared {
  static AtomicInteger ai = new AtomicInteger(0);
}

class AtomThread implements Runnable {
  String name;
  AtomThread(String n) { name = n; }

  public void run() {
    for (int i = 1; i <= 3; i++) {
      // getAndSet() reads the old value and stores a new one, atomically —
      // no two threads can interleave inside that read-then-write.
      System.out.println(name + " got: " + Shared.ai.getAndSet(i));
    }
  }
}
```

No thread can observe `ai` mid-update, and no lock is ever acquired or released.
Beyond `get()`/`set()`/`compareAndSet()`/`getAndSet()`, the package also has
`LongAdder`/`DoubleAdder` (cumulative sums) and `LongAccumulator`/
`DoubleAccumulator` (user-specified combining operations) for high-contention
counters where even an atomic compare-and-swap loop becomes a bottleneck.

## Trade-offs

- **Thread pool sizing is a tuning problem you now own** — `newFixedThreadPool(2)`
  caps concurrency at 2 regardless of how many tasks are submitted, so 4 tasks
  queue in pairs rather than all running at once; too small a pool underuses
  available cores, too large a one risks the same resource exhaustion pools exist
  to prevent. There is no single right number — it depends on whether tasks are
  CPU-bound or I/O-bound.
- **`Lock` trades automatic release for manual discipline** — `synchronized`
  releases its monitor when the block exits, exception or not; `Lock.unlock()`
  does not happen unless you call it, so skipping the `finally` leaves the lock
  held forever after an exception.
  ```java
  lock.lock();
  doWork();       // throws
  lock.unlock();  // never reached — lock is now stuck locked, every future
                   // lock() from any thread blocks forever
  ```
- **`Future.get()` blocks; it does not compose** — calling `get()` ties up the
  calling thread until the task finishes, and there's no built-in way to chain a
  follow-up action or combine two `Future`s without blocking on each in turn.
  `CompletableFuture` (Java 8) exists specifically to close this gap with
  callback-based composition — prefer it when the workflow needs to react to a
  result rather than just wait for one.
- **Picking the wrong synchronizer costs a rewrite, not a compile error** — a
  one-shot startup gate implemented with `CyclicBarrier` "works" until the second
  round of the loop needs the barrier to reset, or a repeating rendezvous
  implemented with `CountDownLatch` "works" until the second round needs to wait
  again — nothing catches the mismatch until the code actually runs a second time.
- **Atomics only cover a single variable at once** — `AtomicInteger` makes one
  read-modify-write atomic, but updating two related atomics together is not:
  ```java
  AtomicInteger balance = new AtomicInteger(100);
  AtomicInteger txCount = new AtomicInteger(0);
  balance.addAndGet(-50); // atomic on its own...
  txCount.incrementAndGet(); // ...but another thread can observe the gap
                              // between these two calls — this pair still
                              // needs a Lock or synchronized block to be
                              // atomic together.
  ```

## Documentation Links

- [ExecutorService — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html) — doc
- [Executors — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html) — doc
- [Future — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html) — doc
- [CompletableFuture — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html) — doc
- [CountDownLatch — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html) — doc
- [Semaphore — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [ReentrantLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) — doc
- [AtomicInteger — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html) — doc
