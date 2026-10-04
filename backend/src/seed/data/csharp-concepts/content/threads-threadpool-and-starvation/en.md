---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A .NET program runs on operating system threads, but most code never creates
one. Work goes to the thread pool, a shared set of worker threads that the
runtime grows and shrinks on its own. That is efficient until the pool runs out
of free threads while many requests are waiting for one. Then latency climbs,
CPU stays low, and the service looks hung even though nothing is wrong with the
code that is stuck. This concept covers what a `Thread` is, how the pool decides
how many threads to run, why blocking on async work starves it, and how to see
it happening.

## Use Cases

- An ASP.NET Core service that is fast under light load and times out under
  moderate load, with CPU close to idle.
- A console app that never exits because a worker thread is still running.
- Deciding whether a long-lived loop (a message pump, a socket reader) should
  use `Task.Run`, `LongRunning`, or its own `Thread`.
- Reading `dotnet-counters` output during an incident and knowing whether the
  thread pool is the bottleneck.

## Deep Dive

### A Thread is an OS thread

`new Thread(...)` creates a real operating system thread with its own stack
(commonly around 1 MB reserved on Windows, so creating thousands is expensive).
It is a foreground thread by default, and the process does not exit until every
foreground thread has finished:

```csharp
var worker = new Thread(() =>
{
    Thread.Sleep(5_000);
    Console.WriteLine("worker done");
});
// worker.IsBackground = true;  // without this line, Main returning does not end the process
worker.Start();

Console.WriteLine("main done"); // the process stays alive about 5 more seconds
```

Setting `IsBackground = true` makes the thread die with the process, which is
right for helpers and wrong for work that must finish. Thread pool threads are
always background threads, which is why a `Task.Run` that is still running does
not keep the process alive.

An unhandled exception on a `Thread` terminates the whole process. Inside a
`Task`, the exception is stored on the task and only surfaces when something
awaits it, so a forgotten task fails silently instead:

```csharp
new Thread(() => throw new InvalidOperationException("boom")).Start(); // process crashes
_ = Task.Run(() => throw new InvalidOperationException("boom"));       // swallowed unless observed
```

### The thread pool and gradual injection

`Task.Run`, `async` continuations, `Parallel` loops, and timers all queue work to
the same pool. The pool starts with a minimum number of threads, by default the
number of processors, and creates those on demand without delay. Above that
minimum it adds threads slowly, using a hill-climbing algorithm that tries one
more thread, measures throughput, and keeps it only if throughput improved. In
practice that means roughly a thread or so per second once demand exceeds the
minimum:

```csharp
ThreadPool.GetMinThreads(out var minWorker, out var minIo);
ThreadPool.GetAvailableThreads(out var freeWorker, out var freeIo);

Console.WriteLine($"min {minWorker}, threads now {ThreadPool.ThreadCount}, " +
                  $"queued {ThreadPool.PendingWorkItemCount}");
```

The slow growth is deliberate: it avoids creating hundreds of threads that fight
over a few cores. It is also what turns a brief blocking spike into a long stall.

### Starvation from sync-over-async

Sync-over-async means calling `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()`
on a task from a thread that cannot continue until it finishes. Each blocked call
holds a pool thread idle, and the continuation it is waiting for needs a pool
thread to run:

```csharp
// Called on a pool thread for every request.
public IActionResult Get()
{
    var data = _client.GetStringAsync(url).Result; // blocks this thread until the I/O completes
    return Ok(data);
}
```

With 8 cores, the first 8 concurrent requests block 8 threads. The I/O completions
queue behind them, no thread is free to run them, and the pool trickles in new
threads at its slow pace. ASP.NET Core has no synchronization context, so this is
not the classic deadlock but starvation: it resolves eventually, after a long
delay. The fix is to stay async all the way up (see the dotnet concept on
`Task` and async/await internals):

```csharp
public async Task<IActionResult> Get()
{
    var data = await _client.GetStringAsync(url); // thread is returned to the pool while waiting
    return Ok(data);
}
```

### LongRunning, and why SetMinThreads is not a remedy

A loop that runs for the lifetime of the app would occupy a pool thread forever,
shrinking what the pool can offer everyone else. `TaskCreationOptions.LongRunning`
tells the scheduler to use a dedicated thread instead:

```csharp
var reader = Task.Factory.StartNew(
    () => ReadSocketForever(token),
    token,
    TaskCreationOptions.LongRunning,
    TaskScheduler.Default);
```

`ThreadPool.SetMinThreads` lifts the minimum so the pool creates threads
immediately up to that number. It can shorten a stall, but it hides the blocking
code that caused it, and the extra threads cost memory and context switching. Treat
it as a temporary mitigation while you remove the blocking calls.

### Seeing it happen

`dotnet-counters monitor --process-id <pid> System.Runtime` shows the numbers that
matter: thread pool thread count, queue length, and completed items. A growing
queue length with a thread count that rises one step at a time, and CPU that stays
low, is the signature of starvation:

```text
ThreadPool Thread Count     :  18
ThreadPool Queue Length     : 412
CPU Usage (%)               :   6
```

## Trade-offs

- **A dedicated `Thread` costs a stack and an OS resource.** It is the right
  choice for a handful of long-lived loops and the wrong one for per-request work.
  A `Task` on the pool reuses threads and costs a small object.
- **`LongRunning` does not help async code.** An `async` lambda started with
  `LongRunning` releases its dedicated thread at the first `await`, and the rest
  runs on the pool as usual.
  ```csharp
  // The dedicated thread ends at the first await. The loop continues on the pool.
  Task.Factory.StartNew(async () => { while (true) await Task.Delay(1000); },
                        TaskCreationOptions.LongRunning);
  ```
- **Background threads can be cut off mid-work.** When the last foreground thread
  ends, the process exits and background threads stop without running `finally`
  blocks, so work that must finish needs a foreground thread or a graceful shutdown.
- **`SetMinThreads` trades latency for memory and hides the cause.** Raising it to
  a large value makes the stall disappear in a test and then returns at a higher
  load, with more threads fighting over the same cores.
- **Wrapping blocking code in `Task.Run` only moves the blocking.** It frees the
  request thread by taking another pool thread, so the pool still starves, only
  later. Use true async APIs for I/O and keep `Task.Run` for CPU-bound work.
- **The numbers differ between runtime versions.** The injection rate and the
  default minimum are runtime details. Measure on the runtime you deploy, and do not
  hard-code assumptions about the delay.

## Documentation Links

- [The managed thread pool, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/the-managed-thread-pool) (doc)
- [Foreground and background threads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/foreground-and-background-threads) (doc)
- [ThreadPool.SetMinThreads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadpool.setminthreads) (doc)
- [TaskCreationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
- [ASP.NET Core best practices, avoid blocking calls, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices#avoid-blocking-calls) (doc)
