---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

The companion concept on [concurrency utilities](concurrency-utilities-executors-and-synchronizers.md)
covers `ReentrantLock`, `Semaphore`, and `CountDownLatch` from the outside — call
`lock()`, call `acquire()`, call `await()`. This concept is about what's underneath
all three: `java.util.concurrent.locks.AbstractQueuedSynchronizer` (AQS), a single
class that implements the hard, easy-to-get-wrong part every blocking synchronizer
needs — a thread-safe queue of blocked threads, and the logic to park and unpark
them correctly — so that `ReentrantLock`, `Semaphore`, `CountDownLatch`,
`ReentrantReadWriteLock`, and `FutureTask` don't each reimplement it from scratch.
A subclass of AQS only has to answer one narrow question in a handful of `protected`
methods: given the current state, does this specific synchronizer let the calling
thread proceed right now?

## Use Cases

- Understanding *why* `ReentrantLock.tryAcquire()` and `Semaphore.tryAcquireShared()`
  behave the way they do under contention, instead of treating them as black boxes.
- Building a custom synchronizer when none of the standard `java.util.concurrent`
  classes fit the exact wait/release shape needed — a one-shot latch, a resource
  gate with custom admission rules — without hand-writing thread parking and a
  wait queue.
- Reading a thread dump or stack trace that mentions
  `AbstractQueuedSynchronizer$Node` or `ConditionObject` and knowing what produced
  it — any blocked `ReentrantLock.lock()`, `Semaphore.acquire()`, or
  `CountDownLatch.await()` call routes through AQS internals.
- Recognizing the same `getState()`/`compareAndSetState()` pattern across unrelated
  JDK classes and knowing it's the same underlying mechanism, not three independent
  implementations.

## Deep Dive

### The shape every synchronizer shares

A lock, a semaphore, a latch, and a barrier look unrelated from their public APIs,
but structurally they are the same three ingredients:

1. **Some state** that determines whether a thread may proceed — held/unheld for a
   lock, permits remaining for a semaphore, count-to-zero for a latch.
2. **Acquire and release operations** that check that state and, if it permits
   proceeding, update it — otherwise the calling thread must wait.
3. **A queue of blocked threads** waiting for the state to become favorable, which
   must be woken (some or all of them) whenever a release makes progress possible.

Every one of these classes could reimplement thread parking, an internal wait
queue, and the race-prone logic to atomically check-state/enqueue/park — and get
it subtly wrong under contention. AQS exists so that this happens exactly once.
It owns:

- A single `int` state field, exposed to subclasses only through three
  `protected final` methods: `getState()`, `setState(int)`, and
  `compareAndSetState(int expect, int update)`.
- A FIFO queue of threads waiting to acquire, managed entirely inside AQS — a
  subclass never touches the queue directly.
- The blocking/unblocking machinery: `acquire(int)`/`release(int)` for exclusive
  mode, `acquireShared(int)`/`releaseShared(int)` for shared mode, plus
  interruptible and timed variants of each.

What a subclass supplies is only the *meaning* of acquire and release for its
specific synchronizer, by overriding a small subset of `protected` hook methods
that AQS calls back into:

```java
// exclusive mode (e.g. a lock — only one thread can hold it)
protected boolean tryAcquire(int arg)         { ... }
protected boolean tryRelease(int arg)         { ... }
protected boolean isHeldExclusively()         { ... }

// shared mode (e.g. a semaphore or latch — many threads can hold it at once)
protected int     tryAcquireShared(int arg)   { ... } // negative = failed
protected boolean tryReleaseShared(int arg)   { ... }
```

The canonical loop AQS runs internally, in outline, is: check whether the current
state permits acquisition via the `try*` hook; if not, enqueue the calling thread
(if not already queued) and park it; once unparked, retry the hook. `release`
updates the state via the hook and, if the hook reports the release may have
unblocked someone, wakes queued threads so they retry `tryAcquire`/
`tryAcquireShared`. None of that loop, the queue, or the parking is something a
subclass writes — it only writes the `try*` methods.

### A minimal worked example: a one-shot latch on AQS

A binary latch — closed until someone opens it, then permanently open — needs
exactly one bit of state. Encode it as AQS state `0` (closed) or `1` (open), and
delegate to a private inner `Sync` rather than extending AQS directly (the same
pattern every synchronizer in the JDK follows, so the latch's own public surface
stays just `await()`/`signal()` instead of leaking AQS's full public API):

```java
import java.util.concurrent.locks.AbstractQueuedSynchronizer;

public class OneShotLatch {
    private final Sync sync = new Sync();

    public void await() throws InterruptedException {
        sync.acquireSharedInterruptibly(0); // arg is unused here
    }

    public void signal() {
        sync.releaseShared(0); // arg is unused here
    }

    private static class Sync extends AbstractQueuedSynchronizer {
        protected int tryAcquireShared(int ignored) {
            // Succeed (return >= 0) only once the latch is open.
            return (getState() == 1) ? 1 : -1;
        }

        protected boolean tryReleaseShared(int ignored) {
            setState(1); // latch is now open, permanently
            return true; // let every queued (and future) acquirer proceed
        }
    }
}
```

Tracing what happens: a thread calling `await()` invokes
`acquireSharedInterruptibly(0)`, which calls `tryAcquireShared`. While
`getState() == 0`, that returns `-1` (failure), so AQS parks the calling thread on
its internal queue. When some other thread calls `signal()`, `releaseShared(0)`
calls `tryReleaseShared`, which sets the state to `1` and returns `true`. AQS
reads that `true` as "a blocked thread might now succeed" and wakes the queued
threads, each of which re-runs `tryAcquireShared` — now returning `1` because
`getState() == 1` — and proceeds. A thread that calls `await()` *after* `signal()`
already ran never blocks at all: `tryAcquireShared` succeeds on the first try.
That is the entire latch — about a dozen lines, no hand-written queue, no
hand-written `wait()`/`notifyAll()`.

### ReentrantLock on AQS: state as hold count

`ReentrantLock` is the exclusive-mode case: only one thread may hold it, but that
thread may re-acquire it (each `lock()` needs a matching `unlock()`). It maps onto
AQS by using the state as a **hold count** rather than a boolean, plus one extra
field of its own — the owning thread — that AQS doesn't track:

```java
// simplified from the non-fair ReentrantLock.Sync.tryAcquire
protected boolean tryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // lock is free — try to claim it
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        // already ours — this is a reentrant acquisition, just bump the count
        setState(c + acquires);
        return true;
    }
    return false; // held by another thread
}
```

State `0` means unheld. The first `lock()` call sees `c == 0` and uses
`compareAndSetState(0, 1)` — not a plain `setState`, because another thread could
be racing to claim the same lock at the same instant, and only one
compare-and-set can win. A second `lock()` call from the *same* thread (reentrant
acquisition — the scenario the Trade-offs section of the companion concept
mentions: `lock()` calls must be balanced by `unlock()` calls) sees `current ==
getExclusiveOwnerThread()` and simply increments the count instead of blocking on
itself. `tryRelease` is the mirror image: it decrements the count and only
reports the lock as released (letting AQS wake a queued thread) once the count
reaches zero again — so a doubly-locked `ReentrantLock` needs two `unlock()`
calls before anyone else can acquire it. `Lock.newCondition()` returns a `new
ConditionObject()` — a non-static inner class AQS itself provides — which is why
`ReentrantLock` gets multiple independent wait sets almost for free.

`Semaphore` and `CountDownLatch` follow the same pattern in shared mode instead
of exclusive: `Semaphore`'s state is permits remaining, and its
`tryAcquireShared`/`tryReleaseShared` loop on `compareAndSetState` exactly like
`OneShotLatch` above, retrying under contention instead of blocking, until either
there aren't enough permits left or the compare-and-set wins. `CountDownLatch`'s
state is the countdown value itself. `FutureTask` and
`ReentrantReadWriteLock` build on AQS too — `FutureTask` encodes task status
(not-started/running/completed/cancelled) as the state, and
`ReentrantReadWriteLock` splits its one `int` state into two 16-bit halves, one
for the read-lock count and one for the write-lock count, routing reader threads
through the shared-acquire path and the writer through the exclusive-acquire path
of the very same AQS instance.

## Trade-offs

- **AQS is an implementation detail you inherit correctness from, not an API you
  call day to day** — reaching for it directly only pays off when no existing
  class in `java.util.concurrent` (`Semaphore`, `CountDownLatch`,
  `ReentrantLock`, `BlockingQueue`) already expresses the wait condition needed;
  building a custom synchronizer is strictly harder to get right than composing
  existing ones.
- **A synchronizer built on AQS should delegate to it via a private inner `Sync`,
  not extend it directly** — extending AQS publicly exposes methods like
  `acquire(int)`/`release(int)` on the synchronizer's own type, letting callers
  manipulate the queue or state directly and corrupt invariants the synchronizer
  is supposed to guarantee:
  ```java
  // fragile: OneShotLatch IS an AQS, so its acquire/release are public too
  public class OneShotLatch extends AbstractQueuedSynchronizer { ... }
  new OneShotLatch().acquireShared(0); // callers can bypass await()/signal()

  // robust: OneShotLatch HAS an AQS, hidden in a private field
  public class OneShotLatch {
      private final Sync sync = new Sync(); // Sync extends AQS, but stays private
      public void await() throws InterruptedException { sync.acquireSharedInterruptibly(0); }
  }
  ```
- **The `try*` hook methods must use `compareAndSetState`, not `setState`, when
  another thread could be racing to change the same state** — `setState` is a
  plain write; two threads both observing an unheld lock and both calling
  `setState(0, 1)`-style logic with a plain write can both believe they acquired
  it. `compareAndSetState(expected, new)` only succeeds if the state still
  matches what was last observed, which is exactly why the `ReentrantLock` and
  `Semaphore` snippets above retry in a loop instead of writing unconditionally.
- **Choosing exclusive vs. shared mode is a one-way design decision** — a
  synchronizer that only implements `tryAcquire`/`tryRelease` (exclusive) has no
  path for multiple threads to hold it simultaneously, and one that only
  implements `tryAcquireShared`/`tryReleaseShared` has no concept of a single
  owning thread; retrofitting the other mode later means adding the missing pair
  of hook methods and re-reasoning about the state encoding from scratch, the way
  `ReentrantReadWriteLock` had to split its state into two halves to support both
  modes on one instance.

## Documentation Links

- [AbstractQueuedSynchronizer — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html) — doc
- [AbstractQueuedSynchronizer.ConditionObject — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.ConditionObject.html) — doc
- [ReentrantLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) — doc
- [Semaphore — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [CountDownLatch — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html) — doc
- [ReentrantReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
