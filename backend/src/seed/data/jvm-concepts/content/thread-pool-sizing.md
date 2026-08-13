---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how to size a `ThreadPoolExecutor` — why more threads isn't always faster, why compute-bound and I/O-bound workloads need opposite sizing strategies, and which half of this problem virtual threads actually solved.

## Use Cases

- Sizing a thread pool for a CPU-bound batch job (image processing, report generation) without over- or under-provisioning.
- Explaining why a REST server's thread pool needs many more threads than the machine has cores, when most of those threads spend their time blocked on a database call.
- Diagnosing a pool that's rejecting tasks (`RejectedExecutionException`, HTTP 429/503) because its queue and pool size don't match the actual workload.

## Deep Dive

### Every pool works the same way

Tasks go into a queue; a fixed-ish number of threads pull tasks off it, run them, and go back for more. Two numbers control the pool: a minimum (core) size of threads kept around even when idle, and a maximum size that caps how many run at once — the maximum acts as a throttle, not just a target to reach.

### CPU-bound work: more threads than cores just adds overhead

For a purely compute-bound workload (no blocking on I/O, minimal lock contention), the ceiling is the number of cores available — not the number of cores on the whole machine, but however many the process is actually allowed to use (a 4-CPU Docker limit counts the same as a genuine 4-core box). Oaks benchmarks calculating 10,000 mock stock histories on a 4-core machine:

```
1 thread:   55.2s (100%)
2 threads:  28.3s (51.2%)
4 threads:  13.9s (25.1%)  <- matches the core count
8 threads:  14.3s (25.9%)  <- no further gain, slightly worse
16 threads: 14.5s (26.2%)
```

Scaling roughly tracks core count up to 4, then flattens — extra threads beyond that just add coordination overhead (contending for the run queue, more context switching) without adding compute capacity, because there's no more CPU to give them.

### I/O-bound work needs a very different number

A thread blocked waiting on a database call or a network response isn't using its CPU core at all — the core sits idle unless *another* thread is scheduled onto it. That means an I/O-heavy workload benefits from a pool much larger than the core count, since most threads are blocked at any given moment rather than actually computing. This is the exact opposite intuition from the CPU-bound case above, and conflating the two is the most common thread-pool-sizing mistake.

### Minimum size and queue size rarely matter as much as maximum size

In almost all cases it's simplest to set the pool's minimum (core) size equal to its maximum — the system needs to be provisioned to handle peak load anyway, so keeping fewer threads "warm" below that just defers a small, one-time thread-creation cost to whenever load actually spikes. The task queue's size matters more: a queue that's too long means tasks wait behind work that's already stale by the time they'd execute (a request queued for 3 seconds behind a pile of other requests is a request the user has likely already given up on) — `ThreadPoolExecutor` calls `rejectedExecution()` once the queue is full, which a server should turn into an honest HTTP 429 or 503, not silence.

## Trade-offs

- **Sizing for CPU-bound work is close to a hard science (≈ core count); sizing for I/O-bound work is closer to art** — a self-tuning or generously-sized pool for I/O-bound work will often get 80-90% of optimal performance, but getting it badly wrong (too small) can tank throughput far more than overestimating a CPU-bound pool does.
- **A pool with far more idle threads than the workload needs isn't free** — each thread costs a stack's worth of native memory even while parked, and on a pool sized for a rare large spike (say, 2,000 threads to handle an occasional burst, sitting idle handling 20 tasks the rest of the time), the idle-thread overhead alone can cost a meaningful fraction of throughput.
- **Book vs today**: this book's I/O-bound sizing advice — provision *many* more platform threads than cores, because most of them are blocked at any moment — is exactly the problem **virtual threads (Project Loom, JEP 444, finalized JDK 21)** were built to eliminate. A blocked virtual thread doesn't pin the OS thread it's running on; the platform thread underneath is freed to run other virtual threads, so an I/O-bound workload using `Executors.newVirtualThreadPerTaskExecutor()` mostly doesn't need this sizing exercise at all — one virtual thread per task, no pool-size tuning. **This does not replace the CPU-bound half of this concept** — virtual threads don't create more CPU cores, so a compute-bound workload still needs roughly one worker per core either way; the sizing problem virtual threads solve is specifically the I/O-bound one.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 9 "Threading and Synchronization Performance", "Thread Pools and ThreadPoolExecutors", pp. 268-278 — book
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [ThreadPoolExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — doc
- [Executors.newVirtualThreadPerTaskExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()) — doc
