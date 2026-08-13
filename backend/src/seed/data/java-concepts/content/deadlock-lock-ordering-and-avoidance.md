---
version: 1.0
updatedAt: 2026-08-13
---

## Objective

Deadlock happens when two or more threads each hold a lock the other one needs, and
neither will release what it holds until it gets what it's waiting for — a cycle in the
"is waiting for a lock held by" graph. The JVM does not detect or recover from deadlock
the way a database does with transactions: once a set of threads deadlocks, those
threads are gone for good, and the only fix is restarting the process. The most common
cause is lock-ordering deadlock — two threads acquiring the same two locks in opposite
order — and the reliable prevention is a consistent, global lock-acquisition order,
combined with keeping locked regions small enough that they never call out to code you
don't control.

## Use Cases

- Any method that needs to hold two locks at once to keep an operation atomic — the
  classic example is transferring funds between two accounts, where both balances must
  be updated together.
- Systems with resource pools (database connection pools, semaphore-guarded caches)
  where a task may need a permit from more than one pool at a time.
- Cooperating objects that call back into each other while synchronized — e.g. a
  dispatcher that notifies a worker, and the worker that reports back to the dispatcher.
- Diagnosing a hung production server: reading a thread dump to find which threads are
  deadlocked and on which locks.

## Deep Dive

### 1. The canonical lock-ordering deadlock

Two threads acquiring the same two locks in opposite order is the textbook case.
Consider a naive funds transfer between two `Account` objects:

```java
// Warning: deadlock-prone
public void transferMoney(Account fromAccount, Account toAccount, BigDecimal amount)
        throws InsufficientFundsException {
    synchronized (fromAccount) {
        synchronized (toAccount) {
            if (fromAccount.getBalance().compareTo(amount) < 0) {
                throw new InsufficientFundsException();
            }
            fromAccount.debit(amount);
            toAccount.credit(amount);
        }
    }
}
```

This looks safe in isolation — both locks are always acquired before touching either
balance. But the *order* in which the locks are taken depends on which account is
passed as `fromAccount` and which as `toAccount`, and that depends on runtime
arguments, not on anything visible by reading a single call site. If thread A runs
`transferMoney(alice, bob, amt)` while thread B concurrently runs
`transferMoney(bob, alice, amt)`, the interleaving

```
Thread A: synchronized (alice)          // A holds alice's lock
Thread B: synchronized (bob)            // B holds bob's lock
Thread A: synchronized (bob)   -> BLOCKS, waiting on B
Thread B: synchronized (alice) -> BLOCKS, waiting on A
```

leaves both threads waiting forever: A holds `alice` and wants `bob`; B holds `bob` and
wants `alice`. Neither will ever release what it holds, because releasing happens only
after the nested `synchronized` block completes. This is a *dynamic* lock-order
deadlock — the bug isn't visible by staring at `transferMoney` alone, because the two
call sites (`transferMoney(alice, bob, ...)` and `transferMoney(bob, alice, ...)`) are
each individually "reasonable"; they're just incompatible with each other.

### 2. The fix: a consistent, global lock ordering

If every thread that needs two particular locks always acquires them in the same
order, the cyclic wait can't form. Since the argument order to `transferMoney` is
outside our control, we induce an ordering on the two `Account` objects using a stable,
comparable key — `System.identityHashCode` works when accounts have no natural key:

```java
private static final Object tieLock = new Object();

public void transferMoney(Account fromAcct, Account toAcct, BigDecimal amount)
        throws InsufficientFundsException {
    int fromHash = System.identityHashCode(fromAcct);
    int toHash = System.identityHashCode(toAcct);

    if (fromHash < toHash) {
        synchronized (fromAcct) {
            synchronized (toAcct) {
                doTransfer(fromAcct, toAcct, amount);
            }
        }
    } else if (fromHash > toHash) {
        synchronized (toAcct) {
            synchronized (fromAcct) {
                doTransfer(fromAcct, toAcct, amount);
            }
        }
    } else {
        // Vanishingly rare identityHashCode collision: fall back to a
        // tie-breaking lock so only one thread at a time risks an
        // arbitrary acquisition order.
        synchronized (tieLock) {
            synchronized (fromAcct) {
                synchronized (toAcct) {
                    doTransfer(fromAcct, toAcct, amount);
                }
            }
        }
    }
}
```

Now every thread, regardless of which account it calls "from" and which it calls "to",
locks the lower-identity-hash account first. Both `transferMoney(alice, bob, ...)` and
`transferMoney(bob, alice, ...)` converge on the same acquisition order, so the cycle
from Deep Dive 1 can never occur. If `Account` had a natural unique, immutable,
comparable key (an account number), ordering by that key is simpler and skips the
tie-breaking lock entirely, since two distinct accounts can never collide on it.

The same principle applies to *static* deadlocks like `LeftRightDeadlock`, where one
method does `synchronized(left) { synchronized(right) {...} }` and another does
`synchronized(right) { synchronized(left) {...} }` — the fix is identical: pick one
global order for `left`/`right` and never deviate. It also extends to deadlocks between
cooperating objects: if a `Taxi` and its `Dispatcher` both hold their own lock while
calling into each other, one thread can end up holding `Taxi`'s lock waiting for
`Dispatcher`'s lock while another holds `Dispatcher`'s lock waiting for `Taxi`'s — the
same cyclic-wait shape, just spread across two classes instead of one method.

### 3. Open calls — don't call alien code while holding a lock

The `Taxi`/`Dispatcher` deadlock above has a root cause distinct from "wrong order":
each class calls a method on the *other* object while holding its own lock.

```java
// Warning: deadlock-prone — calls dispatcher while holding the Taxi lock
class Taxi {
    private final Dispatcher dispatcher;
    private Point location, destination;

    public synchronized void setLocation(Point location) {
        this.location = location;
        if (location.equals(destination)) {
            dispatcher.notifyAvailable(this); // alien call, lock still held
        }
    }
}

class Dispatcher {
    private final Set<Taxi> taxis = new HashSet<>();

    public synchronized void notifyAvailable(Taxi taxi) { /* ... */ }

    public synchronized Image getImage() {
        Image image = new Image();
        for (Taxi t : taxis) {
            image.drawMarker(t.getLocation()); // alien call, lock still held
        }
        return image;
    }
}
```

A call made while holding no lock is an *open call*. Calling an unknown or overridable
("alien") method while holding a lock is risky precisely because a method call is
supposed to be an abstraction barrier — you don't know, and shouldn't have to know,
what happens on the other side. That method might try to acquire a lock of its own
(including, transitively, the very lock you're already holding — instant deadlock), or
it might simply run for far longer than expected, blocking every other thread that
needs your lock in the meantime.

The fix is to shrink the synchronized region so the call to the other object happens
after the lock is released:

```java
class Taxi {
    private final Dispatcher dispatcher;
    private Point location, destination;

    public void setLocation(Point location) {
        boolean reachedDestination;
        synchronized (this) {
            this.location = location;
            reachedDestination = location.equals(destination);
        }
        if (reachedDestination) {
            dispatcher.notifyAvailable(this); // open call, no lock held
        }
    }
}

class Dispatcher {
    private final Set<Taxi> taxis = new HashSet<>();

    public synchronized void notifyAvailable(Taxi taxi) { /* ... */ }

    public Image getImage() {
        Set<Taxi> copy;
        synchronized (this) {
            copy = new HashSet<>(taxis);
        }
        Image image = new Image();
        for (Taxi t : copy) {
            image.drawMarker(t.getLocation()); // open call, no lock held
        }
        return image;
    }
}
```

This trades a small amount of atomicity (`getImage` now reads each taxi's location at
a slightly different instant instead of one consistent snapshot) for a program whose
deadlock-freedom is far easier to reason about: with no calls to outside code made
while holding a lock, finding every place multiple locks could be held becomes a small,
enumerable set instead of a whole-program mystery. As a general rule, keep
`synchronized` blocks small and limited to touching your own guarded state — never a
call to code you don't control.

### 4. Detecting and mitigating deadlocks: `tryLock` and thread dumps

`synchronized` blocks unconditionally — a thread that can't get the lock waits forever.
`java.util.concurrent.locks.Lock` offers a way out: a timed acquisition attempt.

```java
Lock lock1 = new ReentrantLock();
Lock lock2 = new ReentrantLock();

boolean transferWithTimeout() throws InterruptedException {
    while (true) {
        if (lock1.tryLock(500, TimeUnit.MILLISECONDS)) {
            try {
                if (lock2.tryLock(500, TimeUnit.MILLISECONDS)) {
                    try {
                        // do the transfer
                        return true;
                    } finally {
                        lock2.unlock();
                    }
                }
            } finally {
                lock1.unlock();
            }
        }
        // failed to get both locks within the timeout: back off and retry
        Thread.sleep(ThreadLocalRandom.current().nextInt(100));
    }
}
```

If a lock attempt times out, you don't necessarily know why — it might be a deadlock,
an infinite loop that's holding the lock, or just an unusually slow neighbor — but you
regain control instead of blocking forever, and can log, back off with some randomness,
and retry.

When a deadlock has already happened, a thread dump is the standard diagnostic. On a
current JDK, the recommended way to take one is `jcmd <pid> Thread.print` (add `-l` to
include `java.util.concurrent` lock ownership). The older standalone `jstack <pid>`
tool still works and accepts the same `-l` flag, but current JDK documentation marks
it experimental and unsupported, so `jcmd Thread.print` is the tool to reach for first;
sending `SIGQUIT` (`kill -3` on Unix) to the JVM process also triggers the same
underlying VM thread-dump routine. Before printing, the JVM searches its internal
is-waiting-for graph for lock cycles; if it finds one, the dump includes a
`Found one Java-level deadlock` section naming exactly which threads and which locks
are involved.

Programmatically, `java.lang.management.ThreadMXBean` exposes the same cycle search at
runtime: `findMonitorDeadlockedThreads()` detects cycles among `synchronized`-style
object monitors, while `findDeadlockedThreads()` (since Java 6) additionally covers
`Lock`-based ownable synchronizers such as `ReentrantLock`, making it the more complete
of the two for code that mixes intrinsic and explicit locking. Both return `null` when
no deadlock is found and an array of deadlocked thread IDs otherwise, and neither one
detects cycles involving virtual threads.

```java
ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
long[] deadlocked = threadBean.findDeadlockedThreads();
if (deadlocked != null) {
    for (ThreadInfo info : threadBean.getThreadInfo(deadlocked, true, true)) {
        System.out.println(info);
    }
}
```

## Trade-offs

- **Global lock ordering requires whole-program discipline** — spotting a
  lock-ordering bug means auditing every place more than one lock is held together,
  not just the method you're currently editing; a single call site that acquires the
  same two locks in the "wrong" order anywhere in the codebase reintroduces the risk.
- **Open calls trade atomicity for analyzability** — shrinking a synchronized block so
  a call happens after `unlock()` can turn one atomic operation into two, so check
  whether callers actually depend on the old all-or-nothing view of the state.
- **`tryLock` adds retry complexity for a probabilistic guarantee** — it converts an
  unconditional deadlock into a recoverable timeout, but you must decide what
  "failed to acquire in time" means for your operation and implement the backoff
  yourself; it doesn't prevent deadlock so much as let you escape it.
  ```java
  if (!lock.tryLock(500, TimeUnit.MILLISECONDS)) {
      // caller must decide: retry, fail the request, or escalate
  }
  ```
- **Livelock is not deadlock** — a livelocked thread is never blocked, it's actively
  running and repeatedly retrying an operation that keeps failing (e.g. two threads
  each backing off for the other in lockstep), so nothing in a thread dump will show
  threads stuck waiting on a lock; the usual fix is adding randomness to the retry
  delay so the two retries stop colliding in lockstep.

## Documentation Links

- [ReentrantLock — tryLock(long, TimeUnit)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) - doc
- [Lock interface](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Lock.html) - doc
- [ThreadMXBean — findDeadlockedThreads / findMonitorDeadlockedThreads](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html) - doc
- [jcmd command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) - doc
- [jstack command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jstack.html) - doc
