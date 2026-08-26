---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Go past "how many threads" and into the actual `ThreadPoolExecutor` configuration surface: the precise sizing formula from Brian Goetz et al.'s *Java Concurrency in Practice* (Chapter 7, "Applying Thread Pools"), and the constructor parameters and hooks you use to turn a chosen size into a working, well-behaved pool — work queue choice, saturation policies for what happens when that queue fills up, custom thread factories, and the `beforeExecute`/`afterExecute`/`terminated` extension hooks. The `jvm-concepts` entry `thread-pool-sizing` already covers the CPU-bound-vs-I/O-bound sizing intuition qualitatively (with its own benchmark numbers) — that framing is not repeated here.

## Use Cases

- Computing a target pool size from a measured or profiled ratio of wait time to compute time, instead of guessing.
- Deciding between an unbounded queue, a bounded queue, or a synchronous handoff when configuring a `ThreadPoolExecutor` for a server under load.
- Choosing what should happen when a bounded work queue fills up — throw, discard, discard-oldest, or push work back onto the caller.
- Naming pool threads, setting an `UncaughtExceptionHandler`, or customizing thread creation with a `ThreadFactory` so thread dumps and error logs are readable.
- Extending `ThreadPoolExecutor` with `beforeExecute`/`afterExecute`/`terminated` to add logging, timing, or statistics gathering around task execution.

## Deep Dive

### The sizing formula

For purely compute-intensive tasks, an N<sub>cpu</sub>-processor system usually achieves optimum utilization with a thread pool of N<sub>cpu</sub> + 1 threads. (Even compute-intensive threads occasionally take a page fault or pause for some other reason, so an "extra" runnable thread prevents CPU cycles from going unused when this happens.)

For tasks that also include I/O or other blocking operations, you want a larger pool, since not all of the threads will be schedulable at all times. To size the pool properly, you must estimate the ratio of waiting time to compute time for your tasks — this estimate need not be precise and can be obtained through profiling or instrumentation, or the pool size can be tuned by running the application under several different pool sizes with a benchmark load and observing CPU utilization.

Given these definitions:

- N<sub>cpu</sub> = number of CPUs
- U<sub>cpu</sub> = target CPU utilization, 0 < U<sub>cpu</sub> ≤ 1
- W/C = ratio of wait time to compute time

the optimal pool size for keeping the processors at the desired utilization is:

```
Nthreads = Ncpu * Ucpu * (1 + W/C)
```

You can determine the number of CPUs at runtime with:

```java
int N_CPUS = Runtime.getRuntime().availableProcessors();
```

CPU cycles are not the only resource a thread pool might need to manage — memory, file handles, socket handles, and database connections can also constrain sizing. Calculating a pool size constraint for these is easier: add up how much of that resource each task requires and divide it into the total quantity available; the result is an upper bound on the pool size. When tasks require a pooled resource such as database connections, thread pool size and resource pool size affect each other — if each task requires a connection, the effective size of the thread pool is limited by the connection pool size, and vice versa.

### Thread creation and teardown

The general `ThreadPoolExecutor` constructor exposes the knobs directly:

```java
public ThreadPoolExecutor(int corePoolSize,
                           int maximumPoolSize,
                           long keepAliveTime,
                           TimeUnit unit,
                           BlockingQueue<Runnable> workQueue,
                           ThreadFactory threadFactory,
                           RejectedExecutionHandler handler) { ... }
```

The core pool size is the target size: the implementation attempts to maintain the pool at this size even when there are no tasks to execute, and will not create more threads than this unless the work queue is full. The maximum pool size is the upper bound on how many pool threads can be active at once. A thread idle longer than the keep-alive time becomes a candidate for reaping and can be terminated if the current pool size exceeds the core size. Tuning core pool size and keep-alive time lets the pool reclaim resources from otherwise idle threads — but this is a trade-off: reaping idle threads incurs additional latency later if threads must be created again when demand increases.

`newFixedThreadPool` sets both core and maximum pool size to the requested size, creating the effect of an infinite timeout. `newCachedThreadPool` sets the maximum pool size to `Integer.MAX_VALUE` and the core pool size to zero with a one-minute timeout, creating an infinitely expandable pool that contracts again when demand decreases.

### Managing queued tasks

`ThreadPoolExecutor` lets you supply a `BlockingQueue` to hold tasks awaiting execution. There are three basic approaches:

- **Unbounded queue** — the default for `newFixedThreadPool` and `newSingleThreadExecutor`, using an unbounded `LinkedBlockingQueue`. Tasks queue up if all worker threads are busy, but the queue can grow without bound if tasks keep arriving faster than they can be executed.
- **Bounded queue** — such as an `ArrayBlockingQueue`, a bounded `LinkedBlockingQueue`, or a `PriorityBlockingQueue`. Bounded queues help prevent resource exhaustion but raise the question of what to do with new tasks once the queue is full (a saturation policy — see below). With a bounded work queue, queue size and pool size must be tuned together: a large queue with a small pool can reduce memory usage, CPU usage, and context switching, at the cost of potentially constraining throughput.
- **Synchronous handoff** — for very large or unbounded pools, a `SynchronousQueue` bypasses queueing entirely and hands tasks directly from producers to worker threads. It isn't really a queue: to put an element on it, another thread must already be waiting to accept the handoff. If no thread is waiting but the pool is below its maximum size, `ThreadPoolExecutor` creates a new thread; otherwise the task is rejected according to the saturation policy. `SynchronousQueue` is a practical choice only if the pool is unbounded or rejecting excess tasks is acceptable — `newCachedThreadPool` uses one.

A FIFO queue (`LinkedBlockingQueue` or `ArrayBlockingQueue`) starts tasks in arrival order. For more control over execution order, a `PriorityBlockingQueue` orders tasks by priority, defined by natural order (if tasks implement `Comparable`) or by a `Comparator`.

Bounding either the thread pool or the work queue is suitable only when tasks are independent — with tasks that depend on other tasks, bounded pools or queues can cause thread starvation deadlock, so an unbounded configuration like `newCachedThreadPool` is used instead.

### Saturation policies

When a bounded work queue fills up, the saturation policy comes into play — it also applies when a task is submitted to an `Executor` that has already been shut down. The policy is set by calling `setRejectedExecutionHandler`, and the JDK provides four implementations of `RejectedExecutionHandler`:

- **`AbortPolicy`** (the default) — `execute` throws the unchecked `RejectedExecutionException`; the caller can catch it and implement its own overflow handling.
- **`DiscardPolicy`** — silently discards the newly submitted task if it cannot be queued.
- **`DiscardOldestPolicy`** — discards the task that would otherwise be executed next, then tries to resubmit the new task. (If the work queue is a priority queue, this discards the highest-priority element, so combining discard-oldest with a priority queue is not a good idea.)
- **`CallerRunsPolicy`** — a form of throttling: it neither discards tasks nor throws, but executes the newly submitted task in the thread that called `execute` instead of a pool thread. This slows the flow of new tasks, since that caller thread cannot submit more work while it's busy running the pushed-back task — giving worker threads time to catch up. As the pool becomes overloaded, work is gradually pushed outward: from pool threads to the work queue to the application and (in a network server) eventually to the TCP layer and the client, enabling more graceful degradation.

```java
ThreadPoolExecutor executor
    = new ThreadPoolExecutor(N_THREADS, N_THREADS,
        0L, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<Runnable>(CAPACITY));
executor.setRejectedExecutionHandler(
    new ThreadPoolExecutor.CallerRunsPolicy());
```

There is no predefined saturation policy that makes `execute` block when the queue is full; the same effect can instead be accomplished with a `Semaphore` bounding the task injection rate (using an unbounded queue, since there's no reason to bound both the queue size and the injection rate).

### Thread factories

Whenever a thread pool needs to create a thread, it does so through a `ThreadFactory`:

```java
public interface ThreadFactory {
    Thread newThread(Runnable r);
}
```

The default factory creates a new, non-daemon thread with no special configuration. Reasons to supply a custom one include specifying an `UncaughtExceptionHandler` for pool threads, instantiating a custom `Thread` subclass (for example one that performs debug logging), modifying thread priority or daemon status, or simply giving pool threads more meaningful names to simplify reading thread dumps and error logs:

```java
public class MyThreadFactory implements ThreadFactory {
    private final String poolName;

    public MyThreadFactory(String poolName) {
        this.poolName = poolName;
    }

    public Thread newThread(Runnable runnable) {
        return new MyAppThread(runnable, poolName);
    }
}
```

`MyAppThread` (a custom `Thread` subclass) is where such customization actually lives — it can accept a pool-specific name, install a custom `UncaughtExceptionHandler` that logs the failure, and maintain statistics on how many threads have been created and are currently alive.

If an application relies on security policies to grant permissions to particular codebases, `Executors.privilegedThreadFactory()` constructs pool threads with the same permissions, `AccessControlContext`, and `contextClassLoader` as the thread that created the factory — otherwise pool threads inherit permissions from whatever client happens to be calling `execute` or `submit` when a new thread is needed, which can cause confusing security-related exceptions.

Most constructor options — core pool size, maximum pool size, keep-alive time, thread factory, rejected execution handler — can also be changed after construction via setters. If the executor came from one of the `Executors` factory methods (except `newSingleThreadExecutor`), it can be cast to `ThreadPoolExecutor` to reach those setters:

```java
ExecutorService exec = Executors.newCachedThreadPool();
if (exec instanceof ThreadPoolExecutor)
    ((ThreadPoolExecutor) exec).setCorePoolSize(10);
else
    throw new AssertionError("Oops, bad assumption");
```

`Executors.unconfigurableExecutorService` wraps an existing `ExecutorService` exposing only the `ExecutorService` interface, so it can't be reconfigured — useful when exposing an executor to code you don't trust not to modify it. `newSingleThreadExecutor` returns its result wrapped this way, precisely because letting someone increase a single-threaded executor's pool size would undermine the sequential-execution guarantee it promises.

### Extending ThreadPoolExecutor

`ThreadPoolExecutor` was designed for extension, with three hooks a subclass can override: `beforeExecute`, `afterExecute`, and `terminated`.

- `beforeExecute` and `afterExecute` run in the thread that executes the task, so they can be used for logging, timing, monitoring, or statistics gathering. `afterExecute` is called whether the task completed normally or by throwing an `Exception` — but not if the task completed with an `Error`. If `beforeExecute` throws a `RuntimeException`, the task is not executed and `afterExecute` is not called.
- `terminated` is called after the pool completes shutdown — once all tasks have finished and all worker threads have shut down. It can release resources, perform notification or logging, or finalize statistics.

#### Example: adding statistics to a thread pool

Because `beforeExecute` and `afterExecute` run in the executing thread, a value stashed in a `ThreadLocal` by `beforeExecute` can be retrieved by `afterExecute` to time the task — `TimingThreadPool` uses this to accumulate a task count and total processing time, then reports the average in `terminated`:

```java
public class TimingThreadPool extends ThreadPoolExecutor {
    private final ThreadLocal<Long> startTime = new ThreadLocal<Long>();
    private final Logger log = Logger.getLogger("TimingThreadPool");
    private final AtomicLong numTasks = new AtomicLong();
    private final AtomicLong totalTime = new AtomicLong();

    protected void beforeExecute(Thread t, Runnable r) {
        super.beforeExecute(t, r);
        log.fine(String.format("Thread %s: start %s", t, r));
        startTime.set(System.nanoTime());
    }

    protected void afterExecute(Runnable r, Throwable t) {
        try {
            long endTime = System.nanoTime();
            long taskTime = endTime - startTime.get();
            numTasks.incrementAndGet();
            totalTime.addAndGet(taskTime);
            log.fine(String.format("Thread %s: end %s, time=%dns",
                     t, r, taskTime));
        } finally {
            super.afterExecute(r, t);
        }
    }

    protected void terminated() {
        try {
            log.info(String.format("Terminated: avg time=%dns",
                     totalTime.get() / numTasks.get()));
        } finally {
            super.terminated();
        }
    }
}
```

## Trade-offs

- **Unbounded queues are simple but risk resource exhaustion** — `newFixedThreadPool` and `newSingleThreadExecutor` default to an unbounded `LinkedBlockingQueue`, so tasks queue up cheaply, but if arrivals keep outpacing execution the queue (and eventually memory) can run out. Bounded queues cap that risk but force a decision on what to do once they fill.
- **A bounded queue needs a saturation policy, and the default one throws** — leave `RejectedExecutionHandler` unset and a full queue triggers `AbortPolicy`, throwing `RejectedExecutionException` at the caller. Swapping it changes behavior entirely, e.g. discarding silently instead of failing loudly:
  ```java
  executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
  ```
- **`CallerRunsPolicy` throttles the producer instead of failing** — running the rejected task on the calling thread means that thread can't submit more work until it finishes, which pushes back pressure toward whatever is generating tasks (e.g. incoming network connections) rather than dropping or rejecting them outright.
- **Large queue + small pool trades throughput for lower resource usage** — pairing a big bounded queue with few threads reduces memory, CPU, and context-switching costs, but can constrain how much work actually gets done concurrently; the queue size and pool size have to be tuned as a pair, not independently.
- **Reaping idle threads (small core size) saves resources but adds latency** — letting the core pool shrink when idle frees memory, but if demand returns suddenly, new threads must be created before those tasks can start running.

## Documentation Links

- [ThreadPoolExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — doc
- [RejectedExecutionHandler — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html) — doc
- [ThreadFactory — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadFactory.html) — doc
