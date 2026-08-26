---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

A class guarded by a single lock can be perfectly correct and still become the
reason a server stops scaling: every thread that needs the lock queues up
behind whichever thread holds it, so adding more threads (or cores) just grows
the queue instead of growing throughput. This concept assumes correctness is
already solved — the companion concepts on
[AQS](abstract-queued-synchronizer-and-custom-locks.md) and
[deadlock avoidance](deadlock-lock-ordering-and-avoidance.md) cover what's
underneath a lock and how to avoid corrupting or wedging it — and asks the next
question: once a correct lock has become a contention bottleneck, what are the
concrete levers to pull, roughly in order of how surgical (vs. invasive) each
one is.

## Use Cases

- A profiler or thread dump shows many threads blocked waiting for the same
  monitor, and CPU utilization is low even though there's plenty of queued
  work — the classic symptom of a hot lock rather than insufficient hardware.
- A class that started with one lock guarding "the object's state" has grown
  several logically unrelated fields under that same lock, so unrelated
  operations now contend with each other for no real reason.
- A shared counter or cached size field is updated on every write to an
  otherwise well-partitioned data structure, and that one field is the last
  thing still forcing writers to serialize.
- Deciding whether a read-heavy shared structure should keep using exclusive
  locking or move to a reader/writer split, before reaching for something more
  drastic like a full rewrite to a lock-free algorithm.

## Deep Dive

### 1. Performance vs. scalability, and why Amdahl's Law sets the ceiling

"Faster" and "scales better" are different properties. A change that makes a
single-threaded run faster (better caching, a cheaper algorithm) can be
scalability-neutral or even harmful; a change that makes a program scale
better across many cores (splitting work into independent pieces) can add
overhead that makes the single-threaded case slower. For a concurrent server,
throughput and scalability — how much work gets done as load and hardware
grow — usually matter more than shaving milliseconds off one request.

Amdahl's Law quantifies why: if `F` is the fraction of a task's work that must
run serially — because it's guarded by a single lock, or otherwise can't be
divided among threads — then on `N` processors the maximum possible speedup
over running on one is:

```
speedup(N) = 1 / (F + (1 - F) / N)
```

As `N → ∞`, that expression converges to `1/F` — a hard ceiling that no amount
of extra hardware can cross. The serial fraction dominates faster than
intuition suggests. Take `F = 0.05` (just 5% of the work is serialized,
95% is perfectly parallel):

```java
static double speedup(double serialFraction, int processors) {
    return 1.0 / (serialFraction + (1 - serialFraction) / processors);
}

speedup(0.05, 8);   // ≈ 5.93x  — on 8 processors
speedup(0.05, 64);  // ≈ 15.42x — 8x more hardware, not even 3x more speedup
speedup(0.05, 1_000_000); // ≈ 19.9996x — converging on the ceiling
// the theoretical limit as N -> infinity is 1 / 0.05 = 20x, forever
```

Going from 8 to 64 processors is an 8x hardware investment for barely 2.6x
more speedup, and no processor count — not 64, not a million — will ever push
past 20x while that 5% stays serial. This is what motivates every technique
below: none of them change *what* the program computes, they all exist purely
to shrink `F` — the portion of the program's execution forced through a single
serialized gate — so that adding threads keeps paying off.

### 2. Narrowing lock scope — "get in, get out"

The cheapest lever: hold the lock only for the instructions that actually
touch shared state, and move everything else — string formatting, logging,
parsing, any I/O — outside the `synchronized` block. Contention depends on how
often a lock is requested *and* how long it's held; shrinking the hold time
attacks the second factor directly, with no design change required.

```java
// Before: the lock is held for the entire method, including work
// that never touches sharedCounts.
@ThreadSafe
public class MetricsRecorder {
    @GuardedBy("this")
    private final Map<String, Long> sharedCounts = new HashMap<>();

    public synchronized void recordEvent(String name) {
        sharedCounts.merge(name, 1L, Long::sum);           // needs the lock

        String message = String.format("[%s] event=%s count=%d",
                Instant.now(), name, sharedCounts.get(name)); // doesn't
        logger.info(message);                                 // doesn't
    }
}
```

```java
// After: only the map access is synchronized; formatting and logging
// run with no lock held at all.
@ThreadSafe
public class MetricsRecorder {
    @GuardedBy("this")
    private final Map<String, Long> sharedCounts = new HashMap<>();

    public void recordEvent(String name) {
        long count;
        synchronized (this) {
            count = sharedCounts.merge(name, 1L, Long::sum);
        }
        String message = String.format("[%s] event=%s count=%d",
                Instant.now(), name, count);
        logger.info(message);
    }
}
```

The refactored version reduces the number of instructions executed under the
lock, which by Amdahl's Law shrinks `F` for this method — the serialized
portion is now just one map update instead of a map update plus formatting
plus an I/O call to the logging framework. There is a floor to this technique:
a `synchronized` block can be too small if it stops covering everything an
invariant needs (see Trade-offs), and since synchronization itself has a
nonzero cost, splitting one block into several only pays off once the work
moved outside is "substantial" — not for a single arithmetic operation.

### 3. Reducing granularity: splitting a lock, then striping it

If one lock guards several *independent* pieces of state, threads that touch
different pieces still contend with each other purely because they share a
lock, not because they share data. Splitting the lock removes that
accidental coupling.

```java
// Before: one lock serializes two unrelated kinds of updates.
@ThreadSafe
public class ServerStats {
    @GuardedBy("this") private final Set<String> activeUsers = new HashSet<>();
    @GuardedBy("this") private final Set<String> activeQueries = new HashSet<>();

    public synchronized void userLoggedIn(String u)  { activeUsers.add(u); }
    public synchronized void queryStarted(String q)  { activeQueries.add(q); }
}
```

```java
// After: each independent piece of state gets its own lock, so a login
// and a query no longer block each other.
@ThreadSafe
public class ServerStats {
    @GuardedBy("userLock") private final Set<String> activeUsers = new HashSet<>();
    @GuardedBy("queryLock") private final Set<String> activeQueries = new HashSet<>();
    private final Object userLock = new Object();
    private final Object queryLock = new Object();

    public void userLoggedIn(String u) {
        synchronized (userLock) { activeUsers.add(u); }
    }
    public void queryStarted(String q) {
        synchronized (queryLock) { activeQueries.add(q); }
    }
}
```

Splitting one lock into two only helps under moderate contention — on a lock
that's rarely contended, there's nothing to split off; on a lock that's
massively contended, two heavily contended locks are only a small
improvement over one. **Lock striping** is what makes this scale further:
instead of one lock per logical variable, hash a large, fixed set of items
into a small, fixed array of locks, so contention is spread across the whole
array instead of concentrated on one or two locks.

```java
// Sketch: N independent buckets, guarded by a much smaller, fixed
// array of stripe locks — contention only happens between the
// fraction of operations that hash to the *same* stripe.
public class StripedCounterMap {
    private static final int STRIPE_COUNT = 16;
    private final Object[] stripeLocks = new Object[STRIPE_COUNT];
    private final Map<String, Long>[] buckets = new HashMap[STRIPE_COUNT];

    { for (int i = 0; i < STRIPE_COUNT; i++) stripeLocks[i] = new Object(); }

    private int stripeFor(String key) {
        return Math.abs(key.hashCode() % STRIPE_COUNT);
    }

    public void increment(String key) {
        int stripe = stripeFor(key);
        synchronized (stripeLocks[stripe]) {
            buckets[stripe].merge(key, 1L, Long::sum);
        }
    }
}
```

With a reasonably uniform hash, 16 stripes cut contention on any one lock to
roughly 1/16th of what a single lock would see. The number of stripes can grow
as processor count grows — which, viewed through Amdahl's Law, is exactly why
striping scales further than a one-time split into two: `F` keeps shrinking as
the stripe count grows, where splitting into two locks only shrinks it once.
The cost is that operations needing *every* stripe at once (resizing the whole
structure, or an exact `size()`) become more expensive, since they must
acquire some or all of the stripe locks instead of just one.
`ConcurrentHashMap` is the canonical real-world example of pushing this idea
further still — its current bin-level CAS-plus-`synchronized` design is
covered in depth by the sibling concept on
[concurrent collections](concurrent-collections-and-compound-actions.md); the
point to take from it here is just that lock striping generalizes to
per-bucket locking, and modern `ConcurrentHashMap` generalizes that once more
into per-bin CAS with synchronization only on an actual collision.

### 4. Avoiding hot fields

Splitting and striping only help when the pieces of state are actually
independent. A single field that every operation must touch — a running
total, a cached size — stays a bottleneck no matter how well everything else
is partitioned, because every writer still has to serialize on that one field.
This is what happens if a hand-rolled counter is kept up to date on every
write purely to make reads cheap: the "hot" field becomes the one thing still
forcing all writers to contend.

`java.util.concurrent.atomic.LongAdder` (and `LongAccumulator` for combining
operations other than addition) exist specifically for this: instead of one
`long` that every thread updates, they maintain an internal set of variables
that grows under contention, so concurrent writers usually update different
variables and rarely collide. The trade is a `sum()` read that costs more (it
adds up the internal variables and is not an atomic snapshot — concurrent
updates during the read may or may not be included) in exchange for writes
that stay cheap and contention-free even under heavy concurrent use:

```java
// AtomicLong: every increment retries a compare-and-swap against the
// *same* memory location — under high contention, many threads spin
// retrying against one another.
AtomicLong atomicHits = new AtomicLong();
atomicHits.incrementAndGet();
long total = atomicHits.get(); // exact, but every writer contends here

// LongAdder: increments are spread across internal cells, so
// concurrent writers usually don't collide at all.
LongAdder adderHits = new LongAdder();
adderHits.increment();
long approxTotal = adderHits.sum(); // combines the cells; not an atomic snapshot
```

For a counter that's written far more often than it's read — request counts,
cache-hit tallies — `LongAdder` is almost always the better choice over
`AtomicLong`; for a field read as often as (or more often than) it's written,
or one whose exact value must be observed atomically alongside other state,
the trade doesn't pay off and a plain atomic or a lock is still the right
tool.

### 5. Alternatives to exclusive locking, briefly

Two more options exist for when the *access pattern* itself doesn't need
exclusive locking at all, rather than needing a narrower or split lock. Both
have their usage mechanics covered by the sibling
[concurrency utilities](concurrency-utilities-executors-and-synchronizers.md)
concept — the point here is *why* to reach for one instead of narrowing or
splitting further:

- **`ReadWriteLock`** (`ReentrantReadWriteLock`) fits data that's read far more
  often than it's written: any number of readers can hold the read lock
  concurrently, and only a writer needs exclusive access. Splitting or
  striping doesn't help a read-heavy structure the way letting readers stop
  blocking each other does.
- **Atomic variables** replace a lock outright for the simplest case: a
  single variable with no invariant tying it to any other field. Once a class
  has more than one hot field, or fields that must change together
  atomically, plain atomics stop being enough and the choice comes back to
  scope/granularity/striping, or an explicit lock.

## Trade-offs

- **Narrowing a lock's scope has a floor — atomicity requirements don't
  shrink just because the code around them does.** An operation that updates
  two variables participating in the same invariant must keep both updates
  inside one `synchronized` block; splitting them into two smaller blocks
  "for scalability" breaks correctness instead of improving performance.
  ```java
  // Wrong: balance and lastUpdated can now be observed out of sync
  // by another thread between the two blocks.
  synchronized (this) { balance -= amount; }
  synchronized (this) { lastUpdated = Instant.now(); }
  ```
- **More locks means more places a deadlock can form.** Splitting one lock
  into several, or striping into many, only pays off if no code path ever
  needs to hold more than one of them at a time in an order that isn't
  consistent everywhere — see the sibling concept on
  [deadlock avoidance](deadlock-lock-ordering-and-avoidance.md) for the
  ordering discipline this requires once there's more than one lock.
- **Striping trades memory and whole-structure operations for
  concurrency.** A single lock costs one object; N stripes cost N. Operations
  that need the *entire* structure — a full resize, an exact `size()` across
  all stripes — become more expensive because they must touch every stripe,
  sometimes all at once, instead of the single lock they'd have needed before.
- **A hot-field fix that trades exactness for throughput isn't free —
  it changes what callers can rely on.** `LongAdder.sum()` is not an atomic
  snapshot, so code that needs an exact, point-in-time count (e.g. to decide
  whether a resource has hit a hard limit) may observe a stale or
  in-flight total and needs to tolerate that, or fall back to a field that
  stays exact at the cost of contention.
- **None of this is worth doing without a measurement showing lock
  contention is the actual bottleneck.** Splitting or striping locks that see
  little contention yields little improvement and still adds deadlock risk
  and code complexity for nothing; profile or thread-dump first to confirm the
  lock in question is the one that's actually hot.

## Documentation Links

- [LongAdder — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html) — doc
- [LongAccumulator — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAccumulator.html) — doc
- [AtomicLong — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html) — doc
- [ConcurrentHashMap — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [ReentrantReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
- [ReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html) — doc
