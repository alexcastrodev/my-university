# Identifying Threading Problems

> **OCP Exam Topic** — Recognize and understand the four classic concurrency hazards: race condition, deadlock, starvation, and livelock, as well as memory consistency errors. Covered in Chapter 13 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Race Condition

A **race condition** occurs when the correctness of a computation depends on the relative timing or interleaving of two or more threads. The result is non-deterministic and typically wrong under concurrent load.

### Example

```java
public class BankAccount {
    private double balance = 1000.0;

    public void withdraw(double amount) {
        if (balance >= amount) {         // check
            // another thread may withdraw here
            balance -= amount;           // act
        }
    }
}
```

Two threads each checking `balance >= 500` simultaneously both see `1000.0`, both pass the check, and both withdraw — leaving the balance at `0.0` after two withdrawals of `500.0` each.

**How to avoid:** Use `synchronized`, `Lock`, or atomic operations so the check-then-act is a single atomic step.

---

## Deadlock

A **deadlock** occurs when two or more threads are each waiting for a lock that another thread in the set holds, and none of them can proceed.

### Classic Two-Lock Deadlock

```java
public class DeadlockExample {
    private final Object lockA = new Object();
    private final Object lockB = new Object();

    public void methodA() {
        synchronized (lockA) {          // Thread 1 acquires lockA
            synchronized (lockB) {      // Thread 1 waits for lockB
                System.out.println("methodA");
            }
        }
    }

    public void methodB() {
        synchronized (lockB) {          // Thread 2 acquires lockB
            synchronized (lockA) {      // Thread 2 waits for lockA
                System.out.println("methodB");
            }
        }
    }
}
```

Thread 1 holds `lockA` and waits for `lockB`. Thread 2 holds `lockB` and waits for `lockA`. Neither ever makes progress.

### How to Avoid Deadlock

- **Lock ordering:** Always acquire locks in the same global order across all threads.
- **Timed lock acquisition:** Use `ReentrantLock.tryLock(timeout, unit)` and release already-held locks if the attempt times out.
- **Avoid nested locks:** Restructure code to acquire only one lock at a time.

```java
// Safe approach: consistent lock ordering
public void safeMethod(Object first, Object second) {
    Object lower  = System.identityHashCode(first) < System.identityHashCode(second) ? first : second;
    Object higher = lower == first ? second : first;
    synchronized (lower) {
        synchronized (higher) {
            // work
        }
    }
}
```

---

## Starvation

**Starvation** occurs when a thread is perpetually denied CPU time or lock access because other higher-priority threads continually take precedence. The starved thread is alive but makes no progress.

### Causes

- A thread with a very low priority never gets scheduled when higher-priority threads are always runnable.
- A thread waiting on a lock that is always held by other threads in a tight loop.
- An unfair lock policy where the same threads always win the lock.

### Example Scenario

```java
// Low-priority thread is starved when high-priority threads monopolize the lock
synchronized (sharedResource) {
    // High-priority thread holds this for a long time in a loop
    // Low-priority thread never gets a turn
}
```

**How to avoid:**
- Use a fair locking policy: `new ReentrantLock(true)` grants lock access in FIFO order.
- Keep synchronized blocks short to reduce contention.
- Avoid holding locks during blocking I/O.

---

## Livelock

A **livelock** occurs when two or more threads keep responding to each other's actions without making any real progress. Unlike deadlock, the threads are not blocked — they are actively running, just not doing useful work.

### Example

```java
// Two threads trying to be "polite" by yielding to each other
public void process(Thread other) {
    while (other.getState() == Thread.State.RUNNABLE) {
        Thread.yield(); // keep yielding to the other thread
        // both threads yield forever — neither makes progress
    }
    doWork();
}
```

A real-world analogy: two people in a hallway both step aside to let the other pass, then step aside again, then again — they keep moving but neither gets through.

**How to avoid:**
- Introduce randomness in retry timing (exponential backoff with jitter).
- Coordinate through a central arbiter rather than direct thread-to-thread signalling.

---

## Memory Consistency Errors

A **memory consistency error** occurs when different threads have inconsistent views of the same data. The Java Memory Model (JMM) allows the JVM and CPUs to cache values and reorder operations for performance. Without explicit synchronization, a write by one thread may not be visible to another.

```java
// Without synchronization, Thread 2 may never see the update
int value = 0;

// Thread 1
value = 42;

// Thread 2
System.out.println(value); // may print 0
```

**Happens-before relationship:** The JMM guarantees memory visibility only when a happens-before relationship exists between two threads. Happens-before is established by:

- Starting a thread: all actions before `t.start()` are visible in the new thread.
- Joining a thread: all actions in thread `t` are visible after `t.join()` returns.
- Acquiring a lock: all actions before a `synchronized` unlock are visible after the next lock acquire.
- Reading a `volatile` variable: all writes that happened before the `volatile` write are visible.

---

## Summary of Threading Problems

| Problem | Description | Threads | Resolution |
|---|---|---|---|
| Race condition | Non-deterministic result from unsynchronized shared state | 2+ | `synchronized`, `Lock`, atomic classes |
| Deadlock | Threads hold locks waiting for locks held by each other | 2+ | Lock ordering, `tryLock` with timeout |
| Starvation | Thread never gets CPU time or lock access | 1+ | Fair locks (`ReentrantLock(true)`), short critical sections |
| Livelock | Threads actively respond to each other without progress | 2+ | Randomized retry backoff, central coordination |
| Memory consistency | Threads see stale values due to JVM/CPU caching | 2+ | `volatile`, `synchronized`, happens-before guarantees |

---

## Key Points to Remember

- A race condition is caused by unsynchronized check-then-act or read-modify-write sequences.
- Deadlock requires mutual exclusion, hold-and-wait, no preemption, and circular wait — removing any one condition prevents deadlock.
- Starvation is fixed by fair lock policies or reducing lock hold times.
- Livelock threads are running but accomplishing nothing — they signal each other into an endless loop.
- Memory consistency errors arise when writes in one thread are not visible to others; use `volatile` or `synchronized` to establish happens-before.

---

## References

- [Oracle Docs — Thread Interference](https://docs.oracle.com/javase/tutorial/essential/concurrency/interfere.html)
- [Oracle Docs — Memory Consistency Errors](https://docs.oracle.com/javase/tutorial/essential/concurrency/memconsist.html)
- OCP Study Guide, Chapter 13 — Concurrency
