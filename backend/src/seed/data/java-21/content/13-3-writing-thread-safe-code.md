# Writing Thread-Safe Code

> **OCP Exam Topic** — Use `volatile`, `synchronized`, `Lock`, and atomic classes to protect shared mutable state from race conditions. Covered in Chapter 13 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Race Conditions

A **race condition** occurs when two or more threads access shared mutable data concurrently and the final result depends on the interleaving of their operations.

```java
// NOT thread-safe
public class Counter {
    private int count = 0;

    public void increment() {
        count++; // read-modify-write: three separate operations
    }

    public int getCount() { return count; }
}
```

`count++` compiles to three bytecode instructions: read `count`, add 1, write `count`. Two threads executing `increment()` simultaneously can both read the same value, both add 1, and write the same result — effectively losing one increment.

---

## `volatile` — Visibility Guarantee

The `volatile` keyword guarantees that a write to the variable is **immediately visible** to all threads. It prevents the JVM from caching the value in a CPU register or local cache.

```java
public class StatusFlag {
    private volatile boolean running = true;

    public void stop() {
        running = false; // other threads see this immediately
    }

    public void work() {
        while (running) {
            // do work
        }
    }
}
```

**Important limitations:**
- `volatile` guarantees visibility, **not** atomicity.
- `volatile int count; count++;` is still a race condition because `++` is still three operations.
- Use `volatile` for simple flags (read/write in a single operation) but not for compound operations like increment.

---

## `synchronized` — Intrinsic Lock

`synchronized` uses each object's built-in **intrinsic lock** (also called a monitor) to ensure that only one thread at a time executes the protected block.

### Synchronized Method

```java
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        count++; // only one thread at a time
    }

    public synchronized int getCount() {
        return count;
    }
}
```

An instance `synchronized` method locks on `this`. A static `synchronized` method locks on the `Class` object.

### Synchronized Block

```java
public class Counter {
    private int count = 0;
    private final Object lock = new Object();

    public void increment() {
        synchronized (lock) {
            count++;
        }
        // non-critical code here executes without holding the lock
    }
}
```

Synchronized blocks are more granular — they hold the lock only for the minimum required duration, improving throughput compared to synchronizing an entire method.

**Key properties of `synchronized`:**
- Mutual exclusion: only one thread holds the lock at a time.
- Visibility: releasing a lock flushes all writes to main memory; acquiring a lock reads fresh values.
- Reentrancy: a thread that already holds a lock can acquire it again without deadlocking.

---

## `Lock` Interface — Explicit Locking

The `java.util.concurrent.locks.Lock` interface provides more control than `synchronized`. The most common implementation is `ReentrantLock`.

```java
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

public class Counter {
    private int count = 0;
    private final Lock lock = new ReentrantLock();

    public void increment() {
        lock.lock();
        try {
            count++;
        } finally {
            lock.unlock(); // ALWAYS release in finally
        }
    }

    public int getCount() {
        lock.lock();
        try {
            return count;
        } finally {
            lock.unlock();
        }
    }
}
```

### `tryLock()`

Attempts to acquire the lock without blocking. Returns `true` if the lock was acquired, `false` otherwise.

```java
if (lock.tryLock()) {
    try {
        // work with shared resource
    } finally {
        lock.unlock();
    }
} else {
    System.out.println("Could not acquire lock, doing something else");
}
```

A timed variant avoids waiting indefinitely:

```java
if (lock.tryLock(500, TimeUnit.MILLISECONDS)) {
    try { /* ... */ } finally { lock.unlock(); }
}
```

### `ReentrantLock` vs `synchronized`

| Feature | `synchronized` | `ReentrantLock` |
|---|---|---|
| Syntax | Language construct | API |
| Try without blocking | Not possible | `tryLock()` |
| Interruptible lock wait | Not possible | `lockInterruptibly()` |
| Fairness policy | No | Optional (`new ReentrantLock(true)`) |
| Must release manually | No (automatic) | Yes (always use `finally`) |

---

## Atomic Classes

The `java.util.concurrent.atomic` package provides lock-free thread-safe operations using **compare-and-set (CAS)** — a hardware-level atomic instruction.

| Class | Use |
|---|---|
| `AtomicInteger` | `int` counter |
| `AtomicLong` | `long` counter |
| `AtomicBoolean` | `boolean` flag |
| `AtomicReference<V>` | Object reference |

```java
import java.util.concurrent.atomic.AtomicInteger;

public class Counter {
    private final AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        count.incrementAndGet(); // atomic: read-increment-write in one step
    }

    public int getCount() {
        return count.get();
    }
}
```

Common `AtomicInteger` methods:

| Method | Description |
|---|---|
| `get()` | Read current value |
| `set(int)` | Write value |
| `getAndIncrement()` | Return current value, then increment |
| `incrementAndGet()` | Increment, then return new value |
| `getAndAdd(int delta)` | Return current value, then add delta |
| `compareAndSet(int expect, int update)` | Atomically set to `update` if current value equals `expect` |

### Compare-and-Set

CAS is the foundation of all atomic operations. It reads the current value, compares it to an expected value, and only writes the new value if they match — all as a single uninterruptible hardware instruction.

```java
AtomicInteger atomic = new AtomicInteger(10);
boolean updated = atomic.compareAndSet(10, 20); // true: was 10, now 20
boolean failed  = atomic.compareAndSet(10, 30); // false: is 20, not 10
```

---

## Key Points to Remember

- A race condition occurs when multiple threads read, modify, and write shared state without synchronization.
- `volatile` guarantees visibility only — it does not make compound operations atomic.
- `synchronized` provides both mutual exclusion and visibility using the object's intrinsic lock.
- Always release `Lock` objects in a `finally` block to prevent lock leaks.
- `ReentrantLock.tryLock()` acquires the lock without blocking; use it to avoid deadlock.
- Atomic classes (`AtomicInteger`, etc.) provide lock-free thread safety for single-variable operations via CAS.

---

## References

- [Oracle Docs — AtomicInteger](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [Oracle Docs — ReentrantLock](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- OCP Study Guide, Chapter 13 — Concurrency
