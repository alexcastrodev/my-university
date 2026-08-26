---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

The Fork/Join Framework (`java.util.concurrent`, added in JDK 7) is Java's engine for true parallel execution across multiple CPU cores, built around a recursive divide-and-conquer strategy: a task splits itself into smaller subtasks, those subtasks run concurrently (and split further if they're still too big), and the results merge back together. It is a different problem from classic multithreading — a single-CPU `Thread` lets one task run while another waits on I/O or user input, sharing one core over time; Fork/Join instead needs two or more cores actually available to pay off, because its whole point is running pieces of the same computation simultaneously. A `ForkJoinPool` manages a small number of worker threads that execute a potentially large number of lightweight `ForkJoinTask`s, using work-stealing to keep every core busy.

## Use Cases

- Transforming, sorting, or searching a large in-memory array or collection by splitting it into halves (or smaller) and processing each piece on its own core.
- Any recursive divide-and-conquer algorithm — merge sort, matrix multiplication, tree/graph traversal — where subproblems are naturally independent.
- The mechanism `parallelStream()` itself is built on: parallel streams submit their work to the common `ForkJoinPool` rather than implementing their own thread management.
- Firing off CPU-bound work asynchronously with `execute()` when the calling thread has its own work to keep doing, rather than blocking on `invoke()`.
- Work that needs cancellation or completion-status checks (`cancel()`, `isCompletedAbnormally()`) beyond what a plain `Runnable`/`Callable` submitted to an `ExecutorService` exposes.

## Deep Dive

### Divide-and-conquer and work-stealing

The pattern is: keep splitting a task in half until the remaining piece is small enough to just compute directly (the *sequential threshold*), then let the pieces run concurrently and combine their results. This is why the two classes you actually extend are named `RecursiveAction` and `RecursiveTask<V>` — recursion is the mechanism, not just a style choice.

`ForkJoinPool` runs this efficiently through **work-stealing**: every worker thread keeps its own queue of tasks, and whenever a thread's queue runs dry, it steals a task off another thread's queue instead of sitting idle. This matters most when subtasks are unevenly sized — a fixed-size thread pool handing out equal-sized chunks up front has no way to rebalance if one chunk turns out to be cheaper than another, whereas work-stealing keeps every core fed regardless.

### The core classes

```
ForkJoinTask<V>       an abstract class that defines a task
ForkJoinPool          manages the execution of ForkJoinTasks
RecursiveAction        a subclass of ForkJoinTask<V> for tasks that do not return values
RecursiveTask<V>       a subclass of ForkJoinTask<V> for tasks that return values
```

`ForkJoinTask<V>` represents a lightweight *task*, not a thread of execution — a `ForkJoinPool` can manage far more tasks than it has actual worker threads. Its core methods:

```java
final ForkJoinTask<V> fork()   // schedules this task for async execution; caller keeps running
final V join()                  // blocks until this task finishes, then returns its result
final V invoke()                // fork + join in one call: start the task and wait for it
static void invokeAll(ForkJoinTask<?>... taskList)  // run several tasks, wait for all of them
```

You extend `RecursiveAction` when the task produces no result and override `protected abstract void compute()`; you extend `RecursiveTask<V>` when it produces a `V` and override `protected abstract V compute()`. Either way, `compute()` is where the divide-and-conquer logic — and the threshold check — lives.

### RecursiveAction: split until small, then just compute

This example (adapted from the book's `SqrtTransform`) transforms every element of a `double[]` into its square root in place, splitting the array in half at each level until a chunk is below `seqThreshold`:

```java
class SqrtTransform extends RecursiveAction {
    // Threshold is arbitrary here; in real code it's tuned by profiling.
    final int seqThreshold = 1000;

    double[] data;
    int start, end;

    SqrtTransform(double[] vals, int s, int e) {
        data = vals;
        start = s;
        end = e;
    }

    protected void compute() {
        if ((end - start) < seqThreshold) {
            // Small enough: just do the work sequentially.
            for (int i = start; i < end; i++) {
                data[i] = Math.sqrt(data[i]);
            }
        } else {
            // Still too big: split in half and run both halves,
            // waiting for both to finish before this call returns.
            int middle = (start + end) / 2;
            invokeAll(new SqrtTransform(data, start, middle),
                      new SqrtTransform(data, middle, end));
        }
    }
}

ForkJoinPool fjp = new ForkJoinPool();
double[] nums = new double[100_000];
for (int i = 0; i < nums.length; i++) nums[i] = (double) i;

SqrtTransform task = new SqrtTransform(nums, 0, nums.length);
fjp.invoke(task);   // blocks until the whole tree of subtasks completes
```

`invokeAll` here does the fork *and* the wait for both halves in one call — convenient for the "no result" case where there's nothing to aggregate.

### RecursiveTask<V>: returning and aggregating a result

When subtasks return values, you typically call `fork()` on each explicitly, then `join()` each to collect and combine the results yourself, rather than relying on `invokeAll()`. This example sums a `double[]`:

```java
class Sum extends RecursiveTask<Double> {
    final int seqThreshold = 500;
    double[] data;
    int start, end;

    Sum(double[] vals, int s, int e) {
        data = vals;
        start = s;
        end = e;
    }

    protected Double compute() {
        double sum = 0;
        if ((end - start) < seqThreshold) {
            for (int i = start; i < end; i++) sum += data[i];
        } else {
            int middle = (start + end) / 2;
            Sum subTaskA = new Sum(data, start, middle);
            Sum subTaskB = new Sum(data, middle, end);

            // Start both subtasks asynchronously...
            subTaskA.fork();
            subTaskB.fork();

            // ...then wait for each and combine their results.
            sum = subTaskA.join() + subTaskB.join();
        }
        return sum;
    }
}

ForkJoinPool fjp = new ForkJoinPool();
double[] nums = new double[5000];
for (int i = 0; i < nums.length; i++) nums[i] = (i % 2 == 0) ? i : -i;

Sum task = new Sum(nums, 0, nums.length);
double summation = fjp.invoke(task);   // invoke() returns the task's result here
```

Two other valid ways to run the pair: `subTaskA.fork(); sum = subTaskB.invoke() + subTaskA.join();` (start A asynchronously, run B on the current thread), or even having B call `compute()` directly instead of `fork()`/`join()` at all — useful when B is cheap enough that spinning up async scheduling for it isn't worth it.

### The common pool: usually no pool to construct at all

Since JDK 8, you rarely need `new ForkJoinPool()` yourself. `ForkJoinPool.commonPool()` returns a static, shared pool that's automatically available, and calling `fork()`, `invoke()`, or `invokeAll()` on a task *outside* any pool's computational context automatically routes it through the common pool:

```java
SqrtTransform task = new SqrtTransform(nums, 0, nums.length);
task.invoke();   // no ForkJoinPool variable needed — runs on the common pool
```

This is also the mechanism `parallelStream()` relies on: a parallel stream pipeline submits its split-and-combine work to `ForkJoinPool.commonPool()` rather than maintaining its own pool of worker threads.

### Async execution, cancellation, and completion status

`invoke()` blocks the calling thread until the task finishes. To start a task and let the calling thread keep going, use `ForkJoinPool.execute()` instead:

```java
void execute(ForkJoinTask<?> task)
void execute(Runnable task)   // bridges traditional Runnable-based code into the pool
```

Because `ForkJoinPool` worker threads are daemon threads, a program whose main thread exits before an `execute()`-started task completes will end without that task ever finishing.

A running task can be cancelled from outside code (a task doesn't need to cancel itself — it can just return):

```java
boolean cancel(boolean interruptOK)  // true if this call cancelled the task
boolean isCancelled()                 // true if cancelled before completion
```

and its outcome checked afterward with `isCompletedNormally()` (finished, no exception, not cancelled) or `isCompletedAbnormally()` (cancelled or threw). A finished task normally can't run again, but `reinitialize()` resets its internal state so it can be resubmitted — though any side effects it already made on shared data (like the array it modified) are not undone.

## Trade-offs

- **Threshold size is a real tuning knob, not a formality.** Too low, and the pool spends more time creating and scheduling tasks than doing actual work; too high, and there aren't enough independent pieces to keep every core busy. The `ForkJoinTask` API docs' rule of thumb is roughly 100 to 10,000 computational steps per task — but the right value still depends on profiling the actual workload, and erring high is safer than erring low.
- **Work-stealing pays off most with uneven subtask sizes.** A fixed thread pool that hands out equal-sized chunks upfront has no way to rebalance once one chunk turns out cheaper than another; a `ForkJoinPool`'s idle workers steal from busy ones instead of sitting there.
- **Fork/Join needs multiple cores to be worth it at all.** On a single-CPU machine there's no parallel execution to gain — traditional `Thread`-based multithreading (hiding I/O/input latency) is a different problem with a different solution, and Fork/Join doesn't replace it.
- **A `ForkJoinTask` should avoid blocking I/O and outside synchronization.** `compute()` methods that use `synchronized` blocks, wait on I/O, or otherwise block hold up a worker thread that the pool expects to stay busy computing, which defeats the pool's efficiency assumptions.
- **Parallel streams run on the shared common pool — contention is shared too.** Because `parallelStream()` submits to `ForkJoinPool.commonPool()` by default, a long-blocking or I/O-heavy task placed inside a parallel stream pipeline can starve *other, unrelated* code elsewhere in the same JVM that also relies on the common pool for its own parallel work.

## Documentation Links

- [ForkJoinPool — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html) — doc
- [ForkJoinTask — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinTask.html) — doc
- [RecursiveAction — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveAction.html) — doc
- [RecursiveTask — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RecursiveTask.html) — doc
- [Fork/Join — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/concurrency/forkjoin.html) — doc
