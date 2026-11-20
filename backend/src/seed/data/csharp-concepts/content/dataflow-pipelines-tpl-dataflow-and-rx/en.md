---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

`Channel<T>` and `Parallel.ForEachAsync` cover most producer/consumer work, but two older libraries still show up in
real codebases: TPL Dataflow (blocks linked into a pipeline, bounded buffers, pull style) and Rx.NET
(`IObservable<T>`, push style, built for event streams). This concept builds one pipeline in Dataflow, shows where Rx
differs (cold and hot sources, schedulers, the subscription that is never disposed, no backpressure), covers
`Task.WhenEach` and the .NET 10 change to async LINQ, and ends with one job run through `Channel<T>`, Dataflow, Rx and
`Parallel.ForEachAsync`, measuring throughput and memory. Baselines covered elsewhere:
[Channels](/dotnet-concepts/in-memory-queues-with-channels),
[Parallel.ForEachAsync](/dotnet-concepts/data-parallelism-parallel-and-plinq),
[IAsyncEnumerable](/csharp-concepts/async-streams-iasyncenumerable). Ran on macOS arm64 (14 cores).

Versions: .NET SDK 10.0.100, TFM `net10.0`. `System.Threading.Tasks.Dataflow` 10.0.0.0 from the shared framework (no
package, see below), `System.Reactive` 7.0.0, `System.Linq.Async` 7.0.1 (only for the Rx bridges).

## Use Cases

- An in-process pipeline whose stages have their own parallelism and buffer size (parse, enrich, batch, write).
- Batching by count before a bulk insert; event streams with time operators (debounce, buffer, combine latest).
- Consuming results as each task finishes, with `Task.WhenEach`.

## Deep Dive

### Dataflow ships in the framework

On `net10.0` it is not a package. Referencing `System.Threading.Tasks.Dataflow` 10.0.15 gave warning NU1510 ("will not
be pruned ... likely unnecessary") and the assembly loaded at run time came from `Microsoft.NETCore.App/10.0.0`. The docs
say it is included in .NET 6 and later; the package is for .NET Framework and .NET Standard.

### A pipeline: producer, parallel transform, consumer

```csharp
var buffer = new BufferBlock<int>(new DataflowBlockOptions { BoundedCapacity = 4 });
var transform = new TransformBlock<int, int>(
    async i => { await Task.Delay(i % 5 == 0 ? 40 : 5); return i * i; },  // every 5th is slow
    new ExecutionDataflowBlockOptions
        { MaxDegreeOfParallelism = 4, BoundedCapacity = 4, EnsureOrdered = ordered });
var sink = new ActionBlock<int>(async v => { arrivals.Add(v); await Task.Delay(5); },
    new ExecutionDataflowBlockOptions { BoundedCapacity = 4 });
var link = new DataflowLinkOptions { PropagateCompletion = true };
buffer.LinkTo(transform, link); transform.LinkTo(sink, link);
for (int i = 0; i < 40; i++) await buffer.SendAsync(i);
buffer.Complete(); await sink.Completion;
```

```text
EnsureOrdered=True: 371 ms, max concurrent transforms 4, produced-but-not-consumed peak 11, arrivals 0,1,2,3,4,5,...
EnsureOrdered=False: 250 ms, max concurrent transforms 4, produced-but-not-consumed peak 10, arrivals 1,3,2,4,6,8,...
```

Three runs agreed within 5 ms. By default output order equals input order, so a slow item holds back the fast ones
behind it (371 ms against 250 ms, where item 0 arrived tenth). Turn ordering off only when order does not matter.

### BoundedCapacity is the backpressure

`BoundedCapacity` caps what a block holds (queued, in process, and finished output waiting for the next block). With 4
in each of three blocks the producer was never more than 11 items ahead. `Post` and `SendAsync` differ when a block is
full:

```text
Post into BoundedCapacity=3 with a slow consumer: accepted 3, rejected 7
SendAsync of 10 items: producer was held for 362 ms (waited for room)
Default (unbounded) block: Post x1000 all accepted, InputCount right after = 1000
```

`Post` returns `false` and the item is lost unless you check it; `SendAsync` waits for room. The default is unbounded,
the same memory trap as an unbounded channel.

### Completion, faults and cancellation

`PropagateCompletion = true` forwards completion, fault and cancellation to the next block; without it the downstream
block never finishes.

```text
a fault chain: AggregateException -> AggregateException -> InvalidOperationException
no PropagateCompletion: t2 RanToCompletion; a2 completed within 500 ms? False
ActionBlock faulted on item 2: handled 2 of 10, status Faulted
try/catch inside delegate: ok 6, failed 4, status RanToCompletion
cancel: t5 Canceled, a5 Canceled, transformed 10 of 100, input left 0
```

An exception escaping a delegate faults the block for good: the queued items (8 of 10) are dropped and only
`Completion` says so; `Post` then returns `false`. Each propagation wraps the exception in another `AggregateException`,
so use `Flatten()` or `GetBaseException()`. To keep going after a bad item, catch inside the delegate. For cancellation
pass the token in the options of every block; items in flight finish and the queue is discarded.

### The other blocks

```text
after TriggerBatch: [1,2,3,4,5] [6,7,8,9,10] [11,12]   (12 posted, batch size 5)
BroadcastBlock, 20 messages: fast target got 20, slow target (30 ms per item) got 5: 0,5,10,15,19; late target got: c
```

- `BatchBlock<T>(5)` emits arrays of 5; the tail waits for `TriggerBatch()` or `Complete()`, so add a timer that calls
  `TriggerBatch` if a half batch must not wait forever.
- `BroadcastBlock<T>` offers each message to every target but keeps only the latest: the slow target saw 5 of 20 and a
  late subscriber got only `c`. It is a "current value" block, not a fan-out queue.
- Non-greedy `BatchBlock`, `JoinBlock`, `TransformManyBlock`: docs only.

### Rx: push, and cold or hot decides who runs the producer

```text
cold: 2 subscribers, producer ran 2 times
Publish().RefCount(): producer ticks 5; A saw [0,1,2,3,4], late B saw [2,3,4]
hot Subject: early [1,2,3], late [3]
```

A cold observable (`Observable.Create`, `Interval`, `Range`) starts the producer per subscriber. A hot one
(`Subject<T>`) exists on its own and late subscribers miss earlier values. `Publish().RefCount()` shares a cold source;
`ReplaySubject(2)` replays the last two (late subscriber got `[2,3]`).

### Rx operators and schedulers

```text
Throttle(60ms) over a,b,c (15 ms apart), d, e,f: emitted c@90 d@230 f@370
CombineLatest(1,2 | x | 3 | y): 2x 3x 3y
main: thread 1; Range subscriber ran on thread 1 (synchronous); Interval tick on thread 5 (pool)
```

`Throttle` is a debounce: it emits the last value after a quiet period (`c`, `d`, `f`), not a rate limiter.
`CombineLatest` waits for both sides, so the `1` never appears. `Range` runs synchronously on the subscribing thread,
`Interval` on a pool thread; `ObserveOn` moves the callbacks and `SubscribeOn` the subscription, so a UI app puts
`ObserveOn` with the UI scheduler right before touching a control. Virtual-time tests use `TestScheduler` from
`Microsoft.Reactive.Testing` (docs only).

### The subscription that is never disposed

`Observable.Interval(10 ms).Subscribe(_ => widget.Ticks++)`, then the references to the subscription and `widget` are
dropped and `GC.Collect()` runs three times:

```text
subscription dropped without Dispose: after GC the widget is STILL ALIVE (rooted by the timer), ticks 10 then 21
subscription disposed: ticks at 100 ms = 0; after GC the widget is collected
100000 short-lived subscribers, never disposed: retained 59345 KB, 100 x OnNext took 47 ms
100000 short-lived subscribers, disposed: retained 8 KB, 100 x OnNext took 0 ms
```

The scheduler's timer, not your variable, keeps the callback and what it captures alive. On a long-lived `Subject` (or
an event wrapped with `FromEventPattern`) each forgotten subscription also stays in the observer list. Dispose in
`Dispose`, keep subscriptions in a `CompositeDisposable`, or end the stream with `TakeUntil(stop)`.

### Rx has no backpressure, IAsyncEnumerable pulls

A fast producer of 200,000 items, the same slow consumer, counting items produced but not yet consumed:

```text
Rx Range(200000).ObserveOn(slow consumer): max items waiting = 199455
IAsyncEnumerable pull, same slow consumer: max items waiting = 0
Channel.CreateBounded(100), same slow consumer: max items waiting = 100
```

`ObserveOn` decouples the sides with an unbounded queue, so push never slows the producer. `await foreach` produces only
when asked, and a bounded channel blocks the producer at a chosen limit. Rx fits sources you cannot pause (clicks,
sensors); pull fits a source you control that can outrun you. The bridges (`ToAsyncEnumerable()`, `ToObservable()`) are
not in `System.Reactive` 7.0.0: they did not compile until `System.Linq.Async` 7.0.1 was referenced.

### Task.WhenEach (.NET 9)

`await foreach (var t in Task.WhenEach(tasks))` yields each task as it completes:

```text
  WhenEach yielded the 50 ms task at 50 ms   (then 100, 200, 300 ms)
  task faulted: bad one (enumeration kept going)
  n= 10000: WhenEach     20 ms      4 MB allocated | WhenAny loop    268 ms    404 MB allocated
  n= 40000: WhenEach     53 ms     20 MB allocated | WhenAny loop   4410 ms   6139 MB allocated
```

Tasks come back in completion order, and a faulted task is yielded, not thrown: the exception appears on `await t` and
the loop goes on. The old pattern calls `WhenAny` and removes the finished task each time, which is quadratic (same
sums in both).

### .NET 10 ships async LINQ

`System.Linq.AsyncEnumerable.dll` is in the .NET 10 shared framework, so `Where`, `Select` and `ToListAsync` on
`IAsyncEnumerable<T>` need no package (usage in [Async Streams](/csharp-concepts/async-streams-iasyncenumerable)). A
project that still references the old package, same code (`Where`, `Select`, `ToListAsync`, `SelectAwait`):

```text
System.Linq.Async 6.0.1 and 6.0.3: error CS0121 (ambiguous call) on Where and ToListAsync
System.Linq.Async 7.0.1: builds; SelectAwait warns CS0618 ("Use Select ... additional CancellationToken argument")
```

So upgrade to 7.0.0 or later (the .NET 10 breaking-change page says the same) or drop the reference; `SelectAwait`
callbacks become `Select` overloads with a `CancellationToken`.

### Choosing, with a measured job

One job, four implementations, each in its own process, 5 runs, medians (range in parentheses). Items are produced fast
and carry a payload (1 KB for CPU, 4 KB for I/O); concurrency is 14 (CPU) or 100 (I/O). The Rx version needs
`Observable.FromAsync(() => Task.Run(...))` so work leaves the subscribing thread, and `Merge(maxConcurrent)` to cap it.
All four gave the same checksum.

CPU job (200,000 items, a few microseconds of hashing each):

| Approach | ms | items/s | allocated MB | peak items in flight |
|---|---|---|---|---|
| `Channel<T>` bounded 1000, 14 workers | 460 (356 to 498) | 434,783 | 200 | 1,015 |
| Dataflow `ActionBlock`, bounded 1000 | 377 (365 to 386) | 530,504 | 200 | 1,001 |
| `Parallel.ForEachAsync` over `Enumerable.Range` | 558 (452 to 650) | 358,423 | 213 | 14 |
| Rx `Select` + `Merge(14)` | 1063 (1015 to 1201) | 188,147 | 417 | 78,461 |

I/O job (20,000 items, `Task.Delay(10)` each, ideal about 2000 ms), as ms, MB allocated, peak items in flight, peak heap
MB: `Channel<T>` 2329, 84, 1,101, 29; Dataflow 2347, 90, 1,001, 24; `Parallel.ForEachAsync` 2398, 87, 100, 7.5; Rx 2400, 110,
19,800, 186.

When the work is a delay the four sit within about 3% of each other, so the choice is memory and shape, not speed. For
CPU work Channel and Dataflow were within noise, `ForEachAsync` was slower, and Rx took 2 to 3 times as long and
allocated twice as much, with tens of thousands of items created before being done (peak heap 302 MB), because `Range`
emits everything at once and nothing pushes back. Peak heap is sampled and includes garbage not yet collected.

| If you need | Pick |
|---|---|
| A queue between producers and consumers, simplest code | `Channel<T>` |
| A loop over a collection or stream with a concurrency cap | `Parallel.ForEachAsync` (least memory above) |
| Several stages, per-stage parallelism, batching, ordered output | Dataflow |
| Time operators over events you cannot pause | Rx |

### Book vs today

- **Dataflow** lives in `dotnet/runtime` (`src/libraries/System.Threading.Tasks.Dataflow`) and ships in the framework.
  On 2026-11-20 that folder had 9 commits since 2025-11-20 and 21 since 2024-11-20, mostly repository-wide changes
  (analyzers, polyfills, CI); the one behavior fix was a `WriteOnceBlock` race (#123435, February 2026). The package
  gets a version per servicing release (10.0.9 to 10.0.15 monthly, 11.0.0 on 2026-11-10). Maintained, not growing.
  Material from the .NET 4.5 era presents it as the way to build pipelines; today channels and `Parallel.ForEachAsync`
  cover the common cases.
- **Rx**: `dotnet/reactive` is not archived, had commits on the day of this check (17 since 2025-11-20, 47 since
  2024-11-20) and released 7.0.0 on 2026-07-17 (RC 2026-06-18; 6.1.0 was 2025-10-03). It has no `net10.0` target (uses
  `net8.0`).
- **Adoption signals, not job postings.** NuGet all-time downloads (include transitive restores):
  `System.Threading.Channels` 1.66 B, Dataflow 898 M, `System.Reactive` 469 M, `System.Linq.Async` 404 M. GitHub code
  search, C# files: `using System.Reactive.Linq` 62,080; `Channel.CreateBounded` 22,496; `Parallel.ForEachAsync` 13,872;
  `ActionBlock<` 3,960; `Task.WhenEach` 415 (Rx is heavy in UI code, not separated here). Job postings: not measured.

## Trade-offs

- **Dataflow is verbose.** Options on every block and nested `AggregateException`s are more ceremony than a channel
  with workers; the payoff is per-stage capacity, ordering and batching. Ordering cost 371 ms against 250 ms.
- **Bound every block and use `SendAsync`** (7 of 10 `Post` calls were rejected above). A faulted block drops its
  queue, so catch per item inside the delegate and watch `Completion`.
- **Rx moves the problem to the consumer.** Push without backpressure queued 199,455 items; use it for events, not a
  fast finite source you control, and dispose every subscription (59 MB retained otherwise). `Throttle` debounces; use
  `Sample` or a token bucket to limit a rate.
- **Rx is a second vocabulary** (cold versus hot, schedulers, `Publish`), and `System.Linq.Async` below 7.0 does not
  compile against async LINQ on .NET 10.

## Documentation Links

- [Dataflow (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/dataflow-task-parallel-library) (doc)
- [Walkthrough: Implement a producer-consumer dataflow pattern, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/how-to-implement-a-producer-consumer-dataflow-pattern) (doc)
- [DataflowLinkOptions.PropagateCompletion, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.dataflow.dataflowlinkoptions.propagatecompletion) (doc)
- [Rx.NET repository, GitHub](https://github.com/dotnet/reactive) (doc)
- [Introduction to Rx.NET, introtorx.com](https://introtorx.com/) (doc)
- [Task.WhenEach, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.wheneach) (doc)
- [Breaking change: System.Linq.AsyncEnumerable in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/asyncenumerable) (doc)
- [AsyncEnumerable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.asyncenumerable) (doc)
