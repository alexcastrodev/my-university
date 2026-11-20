---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

`lock`, `Interlocked` and `SemaphoreSlim` cover most thread coordination, and the neighbor concepts teach them. The rest of `System.Threading` is a shelf of specialized tools: `Barrier` for phased algorithms, `CountdownEvent` for fork/join without `Task`, `ManualResetEventSlim` and `AutoResetEvent` for signaling, `SpinLock` for tiny critical sections, `ReaderWriterLockSlim` for read-mostly state and `System.Threading.Lock`. Each can be misused in a way the compiler accepts, and some carry a reputation (a spin lock is "faster", a reader-writer lock "scales") that this concept checks by measuring. It ends with how they map to the semaphores and spin locks of operating systems papers.

Versions: .NET SDK 10.0.100, TFM `net10.0`, no NuGet packages (shared framework only), macOS arm64 (Apple M4 Max, 14 cores). One machine shared with other jobs: ratios are the result, absolute numbers moved up to 2x between runs.

## Use Cases

- A stencil or simulation where every worker must finish step N before anyone starts step N+1 (`Barrier`).
- Fanning out a known number of work items and blocking until all finish, with no `Task` (`CountdownEvent`).
- A hand-off between two dedicated threads (`ManualResetEventSlim`).
- A lock per node in a huge structure, held for nanoseconds (`SpinLock`).
- A cache or configuration read by many threads and changed rarely (`ReaderWriterLockSlim`, or a snapshot).

## Deep Dive

### Barrier: phases, participants and failure

A `Barrier` makes N participants wait for each other at the end of each phase. `SignalAndWait()` blocks until all arrived, the optional post-phase action runs once, then all are released and `CurrentPhaseNumber` advances. Four workers smoothed 4000 cells for 50 sweeps, double-buffered, swapping buffers in the action:

```csharp
using var barrier = new Barrier(4, b => (cur, next) = (next, cur)); // once per phase
// each worker, per sweep: Step(cur, next, lo, hi); barrier.SignalAndWait();
```

```text
phases=50 actionRuns=50 distinctActionThreads=4
returns that saw the action finished: 200 of 200
parallel == sequential: True
```

The action ran 50 times, always before any participant returned, on whichever participant arrived last. It is the safe place to swap buffers or reduce partial results, and a slow action delays everyone (`SignalAndWait` inside it throws `InvalidOperationException`). The participant count is a promise: 3 registered and 2 arriving is a hang. With `SignalAndWait(500)` both returned `false` and the barrier stayed intact (`ParticipantsRemaining=3`, phase 0), so a timeout detects the missing worker. A worker leaving for good calls `RemoveParticipant` (the other two then returned `True` and the phase advanced to 1); `AddParticipant` returns the phase the newcomer joins at; the limit is 32,767 participants (docs only). An exception in the action reaches every participant, and the barrier keeps working:

```text
phase 0, action throws: BarrierPostPhaseException(inner=InvalidOperationException: boom in action) | (same)
after the exception: phase=1; phase 1 on the same barrier: ok | ok
```

`SignalAndWait` blocks a thread: 18 participants as `Task.Run` jobs (14 cores, pool minimum 14) took 2390 ms because the pool injected the last 4 threads slowly (starvation concept); as `LongRunning` tasks they took 1 to 2 ms.

### CountdownEvent: fork/join without Task

A `CountdownEvent` starts at a count, `Signal()` decrements it and `Wait()` returns at zero. Start at 1 for the forking thread, so the count cannot hit zero while you are still forking:

```csharp
using var cd = new CountdownEvent(1);
for (int i = 0; i < 100; i++)
{
    cd.AddCount();                       // before queueing, never after
    ThreadPool.QueueUserWorkItem(_ => { Work(); cd.Signal(); });
}
cd.Signal();                             // the forker's own count
cd.Wait();
```

At zero the event is set for good, and the errors are strict:

```text
Signal() that reaches zero returns True; IsSet=True
AddCount after zero: InvalidOperationException: The event is already signaled and cannot be incremented.
TryAddCount after zero: False
Signal past zero: InvalidOperationException: Invalid attempt made to decrement the event's count below zero.
```

`Signal` returns `true` only for the call that reached zero, `TryAddCount` is the non-throwing add, `Reset` reuses the event and `Wait` takes a timeout or a `CancellationToken`. A recursive walk of a tree of 8191 nodes (`AddCount` for each child before the parent signals) visited all 8191. `Signal` cost 2.9 ns against 1.8 ns for `Interlocked.Decrement`, and 1000 tiny jobs took 0.47 ms with `CountdownEvent` and 0.41 ms with `Task.Run` plus `WhenAll`. The gain over tasks is not speed: there is no `Task` to await, and plain threads can use it. In `async` code use `Task.WhenAll`, since `Wait()` blocks.

### Events: ManualResetEventSlim and AutoResetEvent

An event is a flag threads wait on, and the types differ in what a wait consumes:

```text
AutoResetEvent Set twice: WaitOne(0) -> True, then False
SemaphoreSlim Release twice: True, True, False
ManualResetEventSlim Set twice: True, True, True IsSet=True
```

A manual-reset event stays set until `Reset()` and releases every waiter. An `AutoResetEvent` releases one waiter and resets, so two `Set` calls before the wait collapse into one (a lost signal), unlike a semaphore that counts. There is no `AutoResetEventSlim` (checked by reflection). `ManualResetEvent` and `AutoResetEvent` wrap a kernel handle; the slim one spins briefly, then blocks. Hand-offs between two threads, 200,000 round trips, median of 5:

```text
ManualResetEventSlim: default spin 0.20 us, SpinCount 0 5.83 us, SpinCount 2047 0.16 us
ManualResetEvent (kernel) 5.71 us, AutoResetEvent (kernel) 5.78 us, SemaphoreSlim 0.35 us
```

Spinning won by about 30 times when the answer comes in microseconds. The default `SpinCount` was 35 here and the range is 0 to 2047 (2048 throws). The price appears when the signal is late. Waiting for a signal after `Thread.Sleep(1)`, 300 rounds, wall time was 380 to 387 ms for all, and process CPU time was:

```text
default spin 29 ms, SpinCount 0 13 ms, SpinCount 2047 248 ms, kernel ManualResetEvent 11 ms
```

The long spin burned 8 times the default's CPU and 20 times the kernel wait's. Keep the default for short waits, and use `SpinCount` 0 when waits are long or waiters outnumber cores.

### SpinLock: a struct with sharp edges

`SpinLock` is a `struct` that busy-waits. Copying it copies the lock, and the compiler does not warn: a `readonly` field makes every `Enter` lock a temporary copy.

```csharp
readonly SpinLock _s = new(false);   // wrong: each call locks a copy
SpinLock _s = new(false);            // right: mutable field, never copied
bool taken = false;
try { _s.Enter(ref taken); n++; } finally { if (taken) _s.Exit(); }
```

```text
readonly SpinLock field: expected 8000000, got 1826699
non-readonly SpinLock field: expected 8000000, got 8000000
copy.IsHeld=True original.IsHeld=False
```

Pass it by `ref` and never store it in a `readonly` field (the docs say so too). `lockTaken` is mandatory, and one already `true` throws `ArgumentException`. `enableThreadOwnerTracking` (on for `new SpinLock()`) records the owner:

```text
tracked, recursive Enter: LockRecursionException
tracked, Exit from another thread: SynchronizationLockException; still held: True
untracked, recursive TryEnter(100ms): False
untracked, IsHeldByCurrentThread: InvalidOperationException
untracked, Exit from another thread: no exception; still held: False
```

Untracked, a thread re-entering its own lock just times out (`Enter` would spin forever, not run) and a stray `Exit` frees someone else's lock. Tracking is expensive (`SpinLock(true)` 16.4 Mops/s against 121.7 on one thread), so it is a debugging tool.

Is it faster? Threads incrementing one counter inside the lock for 250 ms, plus fixed work inside (alone: 0, 22 and 451 ns). Million operations per second, median of 5, on 1, 8 and 28 threads (14 cores):

```text
                     counter++ only        + 22 ns work         + 451 ns work
threads              1      8     28       1      8     28      1     8    28
lock(object)     248.6  143.8  140.6    39.8   25.3   25.4    2.2   1.6   1.6
lock(Lock)       250.0  119.8  113.6    41.4   25.4   26.3    2.2   1.6   1.6
SpinLock(false)  121.7  117.5  110.0    44.8   44.3   43.5    2.2   2.2   2.2
Interlocked      542.2   31.7   16.3
```

With a near-empty section `lock` beat `SpinLock` (248.6 against 121.7 on one thread). `SpinLock` won only with work inside: 1.75 times at 22 ns, 1.4 times at 451 ns, steady even at 28 threads on 14 cores. Total throughput never beat one thread, since a lock serializes. The fairness run (8 threads, 500 ms, thousands of operations per thread, sorted, 22 ns of work) shows how the lead is made:

```text
lock(Lock)       1103 1185 1473 1593 1633 1740 2132 2160
SpinLock(false)     0    0    0  105 1144 1833 6598 11548
```

One thread monopolizes the `SpinLock` and three did zero work. `lock` was fairer here, but at 451 ns five of its threads got 1 thousand operations each against 429 thousand for the best. Neither promises fairness. The docs limit `SpinLock` to extremely short holds and say not to block, call virtual code, allocate or hold two inside it.

### ReaderWriterLockSlim: modes and rules

Read is shared, write is exclusive, and upgradeable read is shared with readers but held by one thread, and can become write. Four threads holding 50 ms each: `lock` 206 ms, read 52 ms, write 207 ms, upgradeable 205 ms, and one upgradeable plus three readers 53 ms. The recursion rules, measured:

```text
NoRecursion: read then read, read then upgradeable, write then read: LockRecursionException
NoRecursion: read then write: LockRecursionException: ... prone to deadlocks ... use an upgrade lock
NoRecursion: upgradeable then write: ok
SupportsRecursion: read then read: ok; write then read: ok; read then write: LockRecursionException
```

There is no silent upgrade deadlock between two readers: read-to-write is refused in both policies. The fix is `EnterUpgradeableReadLock`, check, then `EnterWriteLock`. A second upgradeable waits (`TryEnter...(100)` was `false`) while a reader gets in. The deadlock that remains is the ordinary kind: a thread in upgradeable mode held another lock and called `TryEnterWriteLock(500)` while a reader waited for that lock, and it returned `false` after 503 ms, so use timeouts when mixing locks. Writers get priority, a fairness policy the docs describe: reader 1 held the lock until 302 ms, a writer queued at 52 ms and reader 2 arrived at 102 ms, and the order was reader 1 out (302), writer in (302), writer out (406), reader 2 in (408). The default is `NoRecursion`, which the docs recommend. Dispose the lock with its owner.

### ReaderWriterLockSlim: when it pays, and the alternatives

A dictionary of 1000 keys in five stores: `lock(Lock)`, `ReaderWriterLockSlim`, a copy-on-write `Dictionary` (copy per write, reads through a volatile reference), an `ImmutableDictionary` swapped by compare-and-swap, and a `ConcurrentDictionary`. 8 threads, Mops/s, median of 5, with work done inside each read:

```text
reads%  work     lock    RWLS     COW   Immutable  Concurrent
100%    0 ns     4.88   45.61  1852.55     221.20     1869.44
 99%    0 ns     6.40   43.59    45.97     126.32      351.89
 90%    0 ns    10.48   19.84     4.85      23.86      132.20
 50%    0 ns    17.13   10.45     1.02       5.02       42.29
 90%  154 ns     4.44    2.22     4.18      22.34       50.58
 99%  1.8 us     0.42    1.71     3.87       3.94        4.03
```

The reader-writer lock beat `lock` only when a read held it for about 1.8 us (4 times at 99% reads), and lost at 90% reads with 154 ns reads and at 50% reads with no work. A read lock writes shared state, so reads do not scale: 94 Mops/s at 2 threads fell to 45 at 8. The copy-on-write stores read without writing and scale (572 to 1852 Mops/s from 2 to 8 threads), but a write copies: the plain `Dictionary` fell to 4.85 at 90% reads, while `ImmutableDictionary` (a path copy) held 23.86 and beat the reader-writer lock. For a config replaced a few times an hour, swap one immutable reference; for per-key updates use `ConcurrentDictionary`; keep `ReaderWriterLockSlim` for reads of microseconds on data too big to copy. Contended `lock` cells are noisy (8 threads, 100% reads: 43.3 in one full run, 4.88 in the next), so trust only large ratios.

### System.Threading.Lock

The `lock` statement uses the new type only when the compile-time type of the target is `Lock`. Proof by `IsHeldByCurrentThread`:

```text
lock(Lock): gate.IsHeldByCurrentThread=True
lock((object)gate): gate.IsHeldByCurrentThread=False, Monitor.IsEntered=True
```

A cast silently switches to `Monitor`, and the compiler warns `CS9216: A value of type 'System.Threading.Lock' converted to a different type will use likely unintended monitor-based locking`. `EnterScope()` gives a disposable scope, the lock is re-entrant, `TryEnter(50)` was `false` for a second thread, and `Exit` without ownership, from another thread too, throws `SynchronizationLockException` (the locks concept calls that state undefined; on .NET 10 here it threw). `Monitor.Wait` on a `Lock` held by `Enter` throws the same, so condition waits still need a plain object. Speed: 200 million uncontended iterations, 3 rounds: `lock(object)` 4.5 ns, `lock(Lock)` 3.6 to 4.1 ns. Contended there was no gain (table above: 119.8 against 143.8 Mops/s with 8 threads and a bare counter, equal within 3% with real work). Use `Lock` for intent and the CS9216 warning, not for throughput.

### Bridges: operating systems

These are the vocabulary of operating systems. The THE system ([Dijkstra](/papers/the-structure-of-the-the-multiprogramming-system)) introduced P and V: `SemaphoreSlim.Wait` and `Release`. His "private semaphore", waited on by one process, is an event, and `AutoResetEvent` is that binary signal (hence two `Set` calls collapse). `Barrier` and `CountdownEvent` are a counter plus a wait, what a monitor (a lock with `Wait` and `Pulse`) builds. The spin lock is the multiprocessor problem THE did not have. [Mellor-Crummey and Scott](/papers/algorithms-for-scalable-synchronization-on-shared-memory-multiprocessors) show that spinning on one shared flag floods the memory system, and the MCS lock fixes it with a queue where each waiter spins on its own flag, in FIFO order. `SpinLock` is not that: the fairness run shows threads that never got in. Their tree barrier is the scalable cousin of `Barrier`'s counter.

## Trade-offs

- **The specialized primitives are niche, and the numbers say so.** Files matching on GitHub code search (C#, 2026-11-20, rounded estimates including forks): `Interlocked` 470k, `ConcurrentDictionary` 359k, `SemaphoreSlim` 180k, `AutoResetEvent` 66k, `ManualResetEventSlim` 62k, `Channel.CreateBounded` 22k, `ReaderWriterLockSlim` 21k, `CountdownEvent` 20k, `SpinLock` 9k, `new Barrier(` 6k, `new Lock()` 5k. New code is mostly `lock`, `SemaphoreSlim`, `Channel<T>` and `Interlocked`; `new Barrier(` appears in about 3% as many files as `SemaphoreSlim`.
- **Book vs today.** Older material recommends `SpinLock` for speed, `ReaderWriterLockSlim` for any read-heavy map and `ManualResetEvent` as the default. Here `SpinLock` lost on tiny sections and won by 1.4 to 1.75 times only by being unfair, the reader-writer lock lost to `lock` on short reads, and kernel events were 30 times slower than the slim one.
- **Spin only when the wait is short.** Spinning saved 5.6 us per hand-off, but `SpinCount` 2047 burned 8 times the default's CPU on late signals.
  ```csharp
  var e = new ManualResetEventSlim(false, spinCount: 0); // waits are long here
  ```
- **A barrier is a convoy.** Each phase runs at the speed of its slowest participant and one missing participant hangs the rest. Use a timeout and `RemoveParticipant`, and prefer `Parallel.For` when phases are just loops.
- **`CountdownEvent` is strict.** It throws once the count is zero, so code that adds work late must hold a count (the extra 1) or use `TryAddCount`.
- **`ReaderWriterLockSlim` is a measured choice.** Write the `lock` version, measure with the real read time, and consider a snapshot first.
- **No fairness promise.** `lock`, `SpinLock` and the reader-writer lock all starved or favored writers. If every caller must progress, use a queue.
- **One macOS machine.** The `SpinLock` versus `lock` gap may differ on Linux x64 (not measured): rerun on the target hardware before changing a lock.

## Documentation Links

- [Overview of synchronization primitives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/overview-of-synchronization-primitives) (doc)
- [Barrier class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.barrier) (doc)
- [How to synchronize concurrent operations with a Barrier, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/how-to-synchronize-concurrent-operations-with-a-barrier) (doc)
- [BarrierPostPhaseException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.barrierpostphaseexception) (doc)
- [CountdownEvent class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.countdownevent) (doc)
- [ManualResetEventSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.manualreseteventslim) (doc)
- [AutoResetEvent class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.autoresetevent) (doc)
- [SpinLock struct, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.spinlock) (doc)
- [How to use SpinLock for low-level synchronization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/how-to-use-spinlock-for-low-level-synchronization) (doc)
- [ReaderWriterLockSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim) (doc)
- [Lock class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lock) (doc)
- [lock statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock) (doc)
- [ImmutableInterlocked class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutableinterlocked) (doc)
