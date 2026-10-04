---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Data parallelism splits one collection of independent work across several
cores. .NET gives you `Parallel.For`, `Parallel.ForEach`,
`Parallel.ForEachAsync`, and PLINQ (`AsParallel`). They look like a loop with a
free speedup, and that is the trap: parallelism only helps when the work is
CPU-bound, large enough to pay for the scheduling, and free of shared state.
Used on tiny items, on I/O, or inside a web request, it makes things slower or
starves the thread pool that serves other requests. This concept covers when to
reach for each tool, how to aggregate without locks, and when to stay
sequential.

## Use Cases

- Resizing a few thousand images on a worker, where each image is independent
  CPU work.
- Calling an external API for 500 ids with at most 8 requests in flight, without
  hand-written semaphores.
- Summing or filtering a large in-memory array with a pure function.
- Deciding whether a slow endpoint should use `Parallel.ForEach` (usually: no).

## Deep Dive

### CPU-bound or I/O-bound

CPU-bound work keeps a core busy computing (hashing, image processing,
parsing). More cores help, up to the number of cores. I/O-bound work waits for a
disk or a network, so a thread is idle most of the time. For I/O, the answer is
`async`/`await`, which frees the thread while waiting. Burning one thread per
waiting call with `Parallel.ForEach` is the wrong tool.

```csharp
// CPU-bound: synchronous body, one worker thread per core.
Parallel.ForEach(files, file => Resize(file));

// I/O-bound: async body, bounded concurrency, no blocked threads.
await Parallel.ForEachAsync(
    ids,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await client.GetFromJsonAsync<Item>($"items/{id}", token));
```

`Parallel.ForEach` takes a synchronous delegate. Passing an `async` lambda
compiles as `async void`, so the loop returns before the work finishes and
exceptions are lost. `Parallel.ForEachAsync` (since .NET 6) is the one that
awaits.

### Aggregating without a lock

Writing to a shared variable from every iteration is a race, and wrapping each
write in `lock` serializes the work you wanted to parallelize. The overload with
`localInit` and `localFinally` gives each worker its own accumulator and merges
once per worker:

```csharp
long total = 0;
Parallel.For(
    0, numbers.Length,
    () => 0L,                                     // localInit: one accumulator per task
    (i, state, local) => local + Expensive(numbers[i]),
    local => Interlocked.Add(ref total, local));  // localFinally: merge once per task
```

### PLINQ

`AsParallel()` turns a LINQ query into a parallel one. Results come back in no
particular order unless you ask for it:

```csharp
var squares = numbers
    .AsParallel()
    .WithDegreeOfParallelism(Environment.ProcessorCount)
    .Where(n => IsPrime(n))
    .Select(n => n * n)
    .ToArray();

var inOrder = numbers.AsParallel().AsOrdered().Select(Expensive).ToArray();
```

`AsOrdered` keeps the source order and costs buffering. Prefer `Aggregate` or
`Sum` over mutating outside state in `ForAll`, because they combine partial
results safely.

### Not inside a request, without thinking

An ASP.NET Core request already runs on a thread-pool thread, and the pool is
shared by every other request. `Parallel.ForEach` inside a handler takes several
more threads from that same pool, so one request can starve the others under
load. For a large CPU job triggered by an endpoint, queue it to a background
worker and return, and keep request handlers `async` for I/O.

## Trade-offs

- **Small work gets slower in parallel.** Partitioning, scheduling, and merging
  cost more than the loop body.
  ```csharp
  Parallel.For(0, 1_000, i => sum[i] = i * 2); // usually slower than a plain for loop
  ```
  Measure with a realistic size before parallelizing.
- **Shared mutable state is a race.** `results.Add(x)` on a `List<T>` from several
  iterations corrupts the list. Use `localInit`/`localFinally`, a
  `ConcurrentBag<T>`, or return values from PLINQ instead.
- **Contention cancels the speedup.** If every iteration locks the same object,
  or hits the same database row, the workers queue up and you pay for threads
  that wait.
- **Ordering costs.** `AsOrdered` and `Parallel.ForEach` over a source with
  unpredictable item cost can leave cores idle at the end while one slow chunk
  finishes. Do not rely on the iteration order of `Parallel.ForEach`.
- **Exceptions are aggregated.** A failing iteration cancels the rest on a
  best-effort basis, and the caller sees an `AggregateException` from the
  synchronous APIs, while `ForEachAsync` throws the first one when awaited.
- **Unbounded concurrency overloads the target.** `Parallel.ForEachAsync` defaults
  `MaxDegreeOfParallelism` to the processor count, which is often wrong for an
  API with a rate limit. Set it on purpose.

## Documentation Links

- [Data parallelism (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/data-parallelism-task-parallel-library) (doc)
- [How to write a Parallel.For loop with thread-local variables, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/how-to-write-a-parallel-for-loop-with-thread-local-variables) (doc)
- [Parallel.ForEachAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.foreachasync) (doc)
- [Parallel LINQ (PLINQ), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/introduction-to-plinq) (doc)
- [Potential pitfalls in data and task parallelism, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/potential-pitfalls-in-data-and-task-parallelism) (doc)
