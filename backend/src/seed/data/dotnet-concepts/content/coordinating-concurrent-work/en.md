---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Starting concurrent work is easy. Coordinating it is where the bugs live: an
operation that never stops when the caller gives up, fifty requests fired at a
service that allows five, a result that is awaited from a callback, a cache that
runs the same expensive call twice. .NET has a small set of primitives for
this: cancellation tokens and timeouts, `SemaphoreSlim` for throttling,
`Channel<T>` for fan-out and fan-in, `TaskCompletionSource<T>` for turning events
into tasks, and `Task.WhenAll`/`WhenAny` for joining. This concept shows how
they fit together and where each one fails quietly.

## Use Cases

- Aborting a downstream call when the HTTP client disconnects or a deadline
  passes.
- Calling a rate-limited API for thousands of items with at most N requests in
  flight.
- Splitting a big job across workers and collecting their results in one place.
- Waiting for a message that arrives later on a callback or an event.
- Caching the result of an expensive async lookup per key.

## Deep Dive

### Cancellation and timeouts

Cancellation is cooperative: you pass a `CancellationToken` down and every
awaited call observes it. `CancelAfter` adds a deadline, and
`CreateLinkedTokenSource` combines the caller's token with your own timeout so
either one stops the work:

```csharp
async Task<Report> BuildAsync(CancellationToken callerToken)
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
    cts.CancelAfter(TimeSpan.FromSeconds(5)); // deadline for this operation

    return await client.GetFromJsonAsync<Report>("report", cts.Token);
}
```

When you need a timeout around a call that does not take a token,
`Task.WaitAsync` abandons the wait (not the work):

```csharp
var result = await slowTask.WaitAsync(TimeSpan.FromSeconds(2), ct);
// throws TimeoutException after 2 seconds, but slowTask keeps running
```

Since .NET 8, `TimeProvider` lets you control time in tests: the
`CancellationTokenSource` and `Task.WaitAsync` overloads that take a
`TimeProvider` can be driven by a fake clock instead of real waiting.

### Throttling with SemaphoreSlim

A semaphore limits how many operations run at once. Release in a `finally`, or
one exception leaks a permit forever:

```csharp
var gate = new SemaphoreSlim(initialCount: 5);

var tasks = ids.Select(async id =>
{
    await gate.WaitAsync(ct);
    try { return await client.GetFromJsonAsync<Item>($"items/{id}", ct); }
    finally { gate.Release(); }
});

var items = await Task.WhenAll(tasks);
```

This still creates one task per id up front, which is fine for thousands and
wasteful for millions. `Parallel.ForEachAsync` with `MaxDegreeOfParallelism`, or a
channel with a fixed number of workers, bounds both concurrency and memory.

### Fan-out and fan-in with Channels

A bounded `Channel<T>` is a thread-safe queue with backpressure. Producers write,
a fixed number of workers read (fan-out), and a second channel collects results
(fan-in):

```csharp
var input = Channel.CreateBounded<int>(capacity: 100);
var output = Channel.CreateUnbounded<string>();

var workers = Enumerable.Range(0, 4).Select(_ => Task.Run(async () =>
{
    await foreach (var id in input.Reader.ReadAllAsync(ct))
        await output.Writer.WriteAsync(await ProcessAsync(id, ct), ct);
})).ToArray();

foreach (var id in ids) await input.Writer.WriteAsync(id, ct); // waits when the channel is full
input.Writer.Complete();

await Task.WhenAll(workers);
output.Writer.Complete();
```

Always call `Complete()` on the writer, or `ReadAllAsync` never ends.

### TaskCompletionSource

`TaskCompletionSource<T>` turns "something will happen later" into a task you can
await, such as a response matched to a request id:

```csharp
var tcs = new TaskCompletionSource<Reply>(TaskCreationOptions.RunContinuationsAsynchronously);
pending[requestId] = tcs;

// later, on the receiving thread:
if (pending.TryRemove(requestId, out var waiter)) waiter.SetResult(reply);

var reply = await tcs.Task;
```

`RunContinuationsAsynchronously` matters. Without it, the code after the `await`
runs inline inside `SetResult`, on the thread that completed the task, so a slow
continuation blocks your receive loop and can even deadlock on a lock you hold.

### WhenAll, WhenAny, and exceptions

`await Task.WhenAll(tasks)` throws only the first exception. The others are on
the `Exception` property of the `WhenAll` task, so inspect that if you need all
of them. `Task.WhenAny` returns the first task to finish and does not cancel the
rest:

```csharp
var all = Task.WhenAll(tasks);
try { await all; }
catch { foreach (var e in all.Exception!.InnerExceptions) log.LogError(e, "task failed"); }

var first = await Task.WhenAny(primary, fallback);
```

### ConcurrentDictionary.GetOrAdd

`GetOrAdd(key, factory)` is thread-safe for the dictionary, not for the factory:
two threads can both find the key missing and both run the factory, and one
result wins. For an expensive or side-effecting factory, store a `Lazy<T>` or a
`Lazy<Task<T>>`, so only one value is created and every caller shares it:

```csharp
var cache = new ConcurrentDictionary<string, Lazy<Task<Product>>>();

Task<Product> GetAsync(string sku) =>
    cache.GetOrAdd(sku, s => new Lazy<Task<Product>>(() => LoadAsync(s))).Value;
```

## Trade-offs

- **Cancellation is a request, not a kill.** Code that never checks the token,
  or calls a library that ignores it, keeps running after cancel. `WaitAsync`
  stops waiting but not the underlying work, which can leak resources.
- **Always dispose the CancellationTokenSource.** A linked source or a timer left
  undisposed holds registrations and can leak, so use `using`.
- **Cached faulted tasks stay faulted.** With `Lazy<Task<T>>`, one failed load is
  cached for every later caller.
  ```csharp
  cache.TryRemove(sku, out _); // evict on failure so the next call retries
  ```
- **Throttling with a semaphore does not bound memory.** One task per item exists
  immediately, waiting on the gate. Use a channel or `ForEachAsync` for very large
  inputs.
- **Unbounded channels hide a slow consumer.** A producer that is faster than the
  workers grows the queue until memory runs out. Prefer `CreateBounded` with a
  `FullMode` that fits (wait, drop, or drop oldest).
- **`WhenAny` leaves the losers running.** Cancel them explicitly with a shared
  token once you have a winner.

## Documentation Links

- [Cancellation in managed threads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads) (doc)
- [Task.WaitAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync) (doc)
- [TimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
- [SemaphoreSlim, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim) (doc)
- [System.Threading.Channels, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [TaskCompletionSource, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcompletionsource-1) (doc)
- [ConcurrentDictionary.GetOrAdd, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentdictionary-2.getoradd) (doc)
