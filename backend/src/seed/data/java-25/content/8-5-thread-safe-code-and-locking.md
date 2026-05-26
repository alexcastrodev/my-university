---
version: 1.0
updatedAt: 2026-05-26
---
# Thread-Safe Code and Locking Mechanisms

---

## Race Conditions

A **race condition** occurs when the correctness of a program depends on the relative ordering of thread execution. The classic example is a non-atomic read-modify-write:

```java
// NOT thread-safe — check-then-act race condition
int count = 0;

void increment() {
    count++;   // actually: read count, add 1, write count — three steps
}
```

Two threads running `increment()` simultaneously may both read the same value and write the same incremented result, losing one update.

---

## synchronized — Methods

```java
class Counter {
    private int count = 0;

    public synchronized void increment() {
        count++;
    }

    public synchronized int getCount() {
        return count;
    }
}
```

Only one thread can execute any `synchronized` method on the same object at a time. Static `synchronized` methods lock on the **class object**, not the instance.

---

## synchronized — Blocks

Prefer synchronized blocks to minimize the critical section:

```java
class Counter {
    private int count = 0;
    private final Object lock = new Object();

    public void increment() {
        synchronized (lock) {
            count++;
        }
        doOtherWork();   // outside the lock — runs concurrently
    }
}
```

---

## volatile

`volatile` ensures that reads and writes to a variable are always done from/to main memory, not a thread-local cache. It does **not** make compound actions (like `++`) atomic.

```java
private volatile boolean running = true;

void stop() {
    running = false;   // visible to all threads immediately
}

void run() {
    while (running) {
        doWork();
    }
}
```

> **Exam tip:** `volatile` prevents visibility issues (stale cache) but does not prevent race conditions on compound operations like `count++`.

---

## ReentrantLock

`java.util.concurrent.locks.ReentrantLock` provides the same mutual exclusion as `synchronized` but with additional capabilities.

```java
import java.util.concurrent.locks.ReentrantLock;

ReentrantLock lock = new ReentrantLock();

void transfer(Account from, Account to, int amount) {
    lock.lock();
    try {
        from.debit(amount);
        to.credit(amount);
    } finally {
        lock.unlock();   // always in finally — even if exception thrown
    }
}
```

> **Exam tip:** Always call `unlock()` in a `finally` block to guarantee the lock is released even if the protected code throws.

---

## tryLock()

```java
if (lock.tryLock()) {
    try {
        doWork();
    } finally {
        lock.unlock();
    }
} else {
    System.out.println("could not acquire lock — skipping");
}

// with timeout
if (lock.tryLock(500, TimeUnit.MILLISECONDS)) {
    try {
        doWork();
    } finally {
        lock.unlock();
    }
}
```

---

## ReadWriteLock

Allows multiple concurrent readers but exclusive write access.

```java
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

ReadWriteLock rwLock = new ReentrantReadWriteLock();

void read() {
    rwLock.readLock().lock();
    try {
        System.out.println(data);
    } finally {
        rwLock.readLock().unlock();
    }
}

void write(String newData) {
    rwLock.writeLock().lock();
    try {
        data = newData;
    } finally {
        rwLock.writeLock().unlock();
    }
}
```

| Lock | Concurrency |
|------|-------------|
| Read lock | Multiple threads can hold simultaneously |
| Write lock | Exclusive — no reader or writer may hold it concurrently |

---

## Atomic Classes

`java.util.concurrent.atomic` provides lock-free atomic operations based on Compare-And-Swap (CAS).

| Class | Use |
|-------|-----|
| `AtomicInteger` | Atomic `int` operations |
| `AtomicLong` | Atomic `long` operations |
| `AtomicBoolean` | Atomic `boolean` |
| `AtomicReference<V>` | Atomic reference update |

```java
AtomicInteger counter = new AtomicInteger(0);

counter.incrementAndGet();          // atomic ++, returns new value
counter.getAndIncrement();          // atomic ++, returns old value
counter.addAndGet(5);               // atomic +=5, returns new value
counter.get();                      // plain read
```

---

## compareAndSet()

`compareAndSet(expected, update)` atomically sets the value to `update` only if the current value equals `expected`. Returns `true` if successful.

```java
AtomicInteger ai = new AtomicInteger(10);

boolean updated = ai.compareAndSet(10, 20);   // true — was 10, now 20
boolean again   = ai.compareAndSet(10, 30);   // false — is now 20, not 10
```

```java
AtomicReference<String> ref = new AtomicReference<>("old");
ref.compareAndSet("old", "new");   // true — atomically replaces
```

---

## synchronized vs ReentrantLock vs Atomic

| Feature | `synchronized` | `ReentrantLock` | `AtomicInteger` |
|---------|---------------|-----------------|-----------------|
| Simplicity | High | Medium | High |
| Try-acquire | No | Yes (`tryLock`) | N/A |
| Interruptible wait | No | Yes | N/A |
| Multiple conditions | One (wait/notify) | Multiple (`Condition`) | N/A |
| Lock-free | No | No | Yes (CAS) |
| Virtual thread pinning | Yes | No | N/A |

---

## Key Rules

- `synchronized` and `ReentrantLock` use mutual exclusion — one thread at a time.
- `volatile` provides visibility guarantees but not atomicity for compound operations.
- `AtomicInteger.incrementAndGet()` is atomic and lock-free; `count++` on a plain `int` is not.
- `ReadWriteLock` improves throughput in read-heavy scenarios.
- Prefer `ReentrantLock` over `synchronized` when using virtual threads with blocking operations to avoid pinning.

---

## References

- [Oracle Docs — ReentrantLock (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html)
- [Oracle Docs — AtomicInteger (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)
- [Oracle Docs — ReadWriteLock (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html)
