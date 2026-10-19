---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

A `BackgroundService` has no caller waiting for its result. It starts on its own
thread, wakes up on a timer, reads from a channel, and reports failures only
through logs. A test for it has to answer three questions that a normal unit
test never asks: when has the worker actually run, how do I make time pass
without waiting for it, and how do I see an exception that nobody awaits? The
goal is an MSTest suite that drives a worker with a fake clock, waits on
signals instead of `Task.Delay`, runs in a fraction of a second, and turns red
when the worker loses a batch, dies silently or applies work too early.

## Use Cases

- Testing a worker that consumes a `Channel<T>` and writes in periodic batches,
  without waiting for real intervals.
- Proving that a failure in one batch is logged and retried, and that it does
  not kill the worker or stop the host.
- Proving graceful shutdown: what was already queued is applied when the host
  stops, and completing the channel finishes the worker.
- Replacing `Thread.Sleep` and `Task.Delay` in an existing suite that is slow
  and fails once a week on CI.
- Asserting on log records with `FakeLogger` instead of a hand-rolled logger.

## Deep Dive

### The lifecycle you are testing

`BackgroundService` implements `IHostedService`. The host calls `StartAsync`,
which starts `ExecuteAsync` and returns; on shutdown it calls `StopAsync`, which
cancels the `stoppingToken` and waits for `ExecuteAsync` to finish. The task
that `ExecuteAsync` returned is exposed as `ExecuteTask`.

.NET 10 changed one detail that matters for tests. Before, the synchronous part
of `ExecuteAsync` (everything before the first `await`) ran inside `StartAsync`.
Since .NET 10 all of `ExecuteAsync` runs on a background thread. A probe that
blocks for 200 ms before setting a flag showed it:

```text
ran right after StartAsync: False, ExecuteTask null? False
ran after await: True
```

So after `await worker.StartAsync(token)` the worker may not have done anything
yet. Anything the test asserts at that moment says nothing about the worker.

### The worker under test

The lab's worker reads `StockMovement` records from a channel and applies them
to a ledger once per interval, at most `MaxBatchSize` per call. Every
dependency that a test needs to control is a constructor parameter, including
the clock:

```csharp
public sealed class StockBatchWorker(
    ChannelReader<StockMovement> reader,
    IStockLedger ledger,
    TimeProvider timeProvider,
    StockBatchOptions options,
    ILogger<StockBatchWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Interval, timeProvider);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await FlushAsync(stoppingToken);
                if (reader.Completion.IsCompleted) return;
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }

        await FlushAsync(CancellationToken.None); // the host is stopping: apply what is queued
    }
}
```

`FlushAsync` drains with `TryRead`, calls the ledger, and on failure logs an
error and keeps the batch for the next tick. That gives five rules to test:
nothing before the first tick, batches capped at `MaxBatchSize`, a failed batch
retried, a completed channel finishes the worker, and stopping drains the queue.

### Wait for a signal, not for time

The broken version of a worker test sleeps and hopes:

```csharp
await worker.StartAsync(token);
writer.TryWrite(new StockMovement("KB-01", 5));
await Task.Delay(TimeSpan.FromSeconds(6)); // longer than the interval, "should be enough"
Assert.HasCount(1, ledger.Batches);
```

It costs six seconds per test, and on a busy CI agent six seconds is sometimes
not enough. With a `FakeTimeProvider` it is worse: `Task.Delay` in the test
does not move the fake clock, so the worker never ticks.

The fixed version waits for the thing it wants to see. The lab's fake ledger
writes every batch into a channel, which works as a signal that carries a
payload, and the test awaits the next one with a deadline:

```csharp
public Task ApplyAsync(IReadOnlyList<StockMovement> batch, CancellationToken cancellationToken)
{
    _calls.Writer.TryWrite(batch);
    return Interlocked.Decrement(ref _failuresLeft) >= 0
        ? Task.FromException(new InvalidOperationException("The ledger is down."))
        : Task.CompletedTask;
}

public async Task<IReadOnlyList<StockMovement>> NextCallAsync(CancellationToken cancellationToken) =>
    await _calls.Reader.ReadAsync(cancellationToken).AsTask().WaitAsync(Deadline, cancellationToken);
```

The 5 second deadline is only reached when the test is already failing, so a
green run costs nothing. A `TaskCompletionSource` does the same for a one-time
event, and polling a condition with a deadline is the fallback when the code
offers no hook at all.

### PeriodicTimer and FakeTimeProvider

`PeriodicTimer` accepts a `TimeProvider` since .NET 8, so
`FakeTimeProvider.Advance` from `Microsoft.Extensions.TimeProvider.Testing`
fires its ticks. Two behaviors, both reproduced in a scratch test, decide how
to write the test:

```text
Advance(5 s), then create a 5 s timer:  tick completed: False
then Advance(5 s) again:                tick completed: True
Advance(15 s) with nobody waiting:      first wait completes at once, the second does not
```

A timer created after `Advance` counts from the new "now", so advancing before
the worker has created its timer moves time for nobody. And a `PeriodicTimer`
remembers one missed tick, not three. Because `ExecuteAsync` starts later than
`StartAsync`, the test needs to know when the timer exists. `FakeTimeProvider`
is not sealed, so a subclass can signal it:

```csharp
internal sealed class SignalingTimeProvider : FakeTimeProvider
{
    private readonly TaskCompletionSource _timerCreated = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task TimerCreated => _timerCreated.Task;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = base.CreateTimer(callback, state, dueTime, period);
        _timerCreated.TrySetResult();
        return timer;
    }
}
```

With it, a test reads like a timeline. Five movements, a cap of two, one tick:

```csharp
await StartWorkerAsync(maxBatchSize: 2); // StartAsync, then await _time.TimerCreated
Write(new StockMovement("A", 1), new StockMovement("B", 1), new StockMovement("C", 1),
      new StockMovement("D", 1), new StockMovement("E", 1));

_time.Advance(Interval);

Assert.HasCount(2, await _ledger.NextCallAsync(Token));
Assert.HasCount(2, await _ledger.NextCallAsync(Token));
Assert.HasCount(1, await _ledger.NextCallAsync(Token));
```

### "Not yet" is the one honest real wait

"Nothing is applied before the first tick" is a negative, and a negative has no
signal. The naive test asserts it right after `StartAsync`:

```csharp
await worker.StartAsync(token);
writer.TryWrite(new StockMovement("A", 1));
Assert.AreEqual(0, ledger.Calls); // green even for a worker that flushes on arrival
```

It was green against a mutant that flushes every movement as it arrives,
because that worker had not run yet. The lab's version waits until the timer
exists, moves the clock to 1 ms before the tick, gives a misbehaving worker a
200 ms quiet period, and then requires the first call to hold a movement
written after that period:

```csharp
Write(new StockMovement("KB-01", 5));
_time.Advance(Interval - TimeSpan.FromMilliseconds(1));
Assert.IsFalse(await _ledger.IsCalledWithinAsync(TimeSpan.FromMilliseconds(200), Token));
Write(new StockMovement("MS-02", -1));
_time.Advance(TimeSpan.FromMilliseconds(1));

var first = await _ledger.NextCallAsync(Token);
CollectionAssert.AreEqual(new StockMovement[] { new("KB-01", 5), new("MS-02", -1) }, first.ToArray());
```

Without the quiet period the same test still passed against the mutant: the
test wrote both movements before the mutant woke up. Keep the real wait short
and keep it to the rule that is about "not yet".

### Draining a channel

`ChannelReader.Completion` completes when the writer called `Complete` and the
last item was read, not before (`completion before read: False`, `after last
read: True` in a scratch test). The worker checks it after each flush, so the
test completes the writer, ticks once, and awaits `ExecuteTask` with a deadline:

```csharp
Write(new StockMovement("KB-01", 5), new StockMovement("MS-02", -1));
_channel.Writer.Complete();

_time.Advance(Interval);

Assert.HasCount(2, await _ledger.NextCallAsync(Token));
await worker.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(5), Token);
Assert.IsTrue(worker.ExecuteTask.IsCompletedSuccessfully);
```

A bare `await worker.ExecuteTask` would hang the run if the worker never ends.
Shutdown is the other way out: `StopAsync` with no tick at all must still apply
the three queued movements, because the worker drains with
`CancellationToken.None` after the stopping token fires.

### An exception nobody awaits

`StopAsync` does not rethrow what killed `ExecuteAsync`. A worker that threw
after its first `await` gave this:

```text
StopAsync returned; status=Faulted ex=boom
```

So "the ledger was called and `StopAsync` completed" is green whether the
worker survived or died. Look at `ExecuteTask` (`IsFaulted`, `IsCompleted`, or
`Assert.ThrowsExactlyAsync<InvalidOperationException>(() => worker.ExecuteTask!)`)
and at the logs. Inside a host, since .NET 6 an unhandled exception in
`ExecuteAsync` is logged and stops the host
(`BackgroundServiceExceptionBehavior.StopHost`, the default). Captured with
`AddFakeLogging()`, the host wrote:

```text
Error    [Microsoft.Extensions.Hosting.Internal.Host] BackgroundService failed
Critical [Microsoft.Extensions.Hosting.Internal.Host] The HostOptions.BackgroundServiceExceptionBehavior is configured to StopHost. ...
```

With `BackgroundServiceExceptionBehavior.Ignore` only the `Error` was written
and the host kept running, with a dead worker. A host test can therefore prove
"a failing ledger does not stop the host" by asserting that
`IHostApplicationLifetime.ApplicationStopping` was not cancelled and that no
`Critical` record exists.

### FakeLogger and FakeLogCollector

`Microsoft.Extensions.Diagnostics.Testing` ships `FakeLogger<T>` for a worker
constructed by hand, and `AddFakeLogging()` plus `GetFakeLogCollector()` for a
host. A record keeps the level, the category, the exception and the formatted
message:

```csharp
var error = Assert.ContainsSingle(_logger.Collector.GetSnapshot().Where(r => r.Level == LogLevel.Error));
Assert.IsInstanceOfType<InvalidOperationException>(error.Exception);
Assert.AreEqual("Failed to apply 2 stock movements; retrying on the next tick", error.Message);
```

Assert the log after the retry has arrived, not right after the failed call:
the worker writes the log after the ledger throws, on its own thread.

### Async test methods in MSTest

MSTest 4 runs `async Task` and `async ValueTask` test methods (both checked
here). `Assert.ThrowsExactlyAsync<T>` accepts only `T`, and
`Assert.ThrowsAsync<T>` also accepts derived types. `TestContext.CancellationToken`
is the token to pass to everything the test awaits: with
`[Timeout(500, CooperativeCancellation = true)]` a test that ran too long saw
that token cancelled. The docs recommend cooperative cancellation (analyzer
MSTEST0045) because the non-cooperative timeout leaves the test running in the
background. In xUnit v3 the same token is
`TestContext.Current.CancellationToken`.

### Do the tests protect the rules?

Each change below was made to `StockBatchWorker` on its own, the suite was run,
and the file was restored:

| Change to the production code | Tests that fail |
| --- | --- |
| `FlushAsync` ignores `MaxBatchSize` | the batch size test |
| A ledger failure escapes `ExecuteAsync` | the retry test and the host "does not stop" test |
| The batch is cleared before the ledger call (lost on failure) | the retry test and the host test |
| No `return` after the channel completes | the channel completion test |
| No final flush on stop | the stop test and the host shutdown test |
| Flush on arrival (`WaitToReadAsync` instead of the timer) | "nothing before the first tick" and both failure tests |

The two naive tests above (assert right after `StartAsync`, assert only that
`StopAsync` completed) stayed green against the flush-on-arrival and the
escaping-exception mutants.

## Trade-offs

- **A fake clock tests your logic, not the timer.** `FakeTimeProvider` makes
  ticks exact, which is the point, but it also hides drift and thread-pool
  starvation. Keep one slow test with the real clock if timing in production
  matters, and tag it.
  ```csharp
  [TestCategory("Slow")] // runs with TimeProvider.System, excluded from the default run
  ```
- **Testing without a host is cheaper, testing with one is truer.** Hand-built
  workers run in milliseconds and expose `ExecuteTask`. Only the host shows
  registration mistakes and `BackgroundServiceExceptionBehavior`. The lab keeps
  six direct tests and two host tests.
- **Every hook for the test is a design decision.** Injecting `TimeProvider`,
  the `ChannelReader` and the ledger is good design anyway. A
  `SignalingTimeProvider` lives only in the test project; resist adding "for
  tests" events to production code.
- **Deadlines turn hangs into failures, at a price.** A 5 second deadline is
  free when green but makes a red run slower. Shorter deadlines fail on slow CI
  agents for the wrong reason.
- **Negative assertions need a real wait.** There is no signal for "nothing
  happened". One short quiet period is acceptable; a suite full of them is the
  `Task.Delay` suite again.
- **Logs are a contract once you assert on them.** Asserting the exact message
  catches a lost `{Count}`, and also breaks on a harmless rewording. Assert the
  level and exception everywhere, and the message only where it matters.
- **The theory is not .NET-specific.** Fakes versus mocks and the cost of
  asserting on implementation details are covered in the testing-concepts
  track; this concept only adds what hosting, channels and timers change.

## Lab

`StockBatchWorker`, a `BackgroundService` that consumes a `Channel<StockMovement>` and applies periodic batches to a ledger, is already implemented. Your job is to write the MSTest tests that prove its five rules, with a fake clock and no `Task.Delay` used as a wait.

**What you will practice**

- Driving a `PeriodicTimer` with `FakeTimeProvider`, and knowing when the worker has created its timer.
- Waiting on signals with deadlines instead of sleeping.
- Seeing a failure that `StopAsync` hides, through `ExecuteTask` and `FakeLogger`.
- Testing drain on channel completion and on shutdown, without a host and inside a real generic host.

**Prerequisites:** Hosted Services and BackgroundService, In-Memory Queues with Channels, Controlling Time with TimeProvider, basic MSTest, .NET 10 SDK.

**How it works:** every test is declared with a hint and fails with `TODO-NN: write this test` until you write it. Three tests have a naive version that passes for the wrong reason (asserting before the worker ran, missing an exception that killed it, sleeping instead of advancing the clock). The optional TODOs ask you to prove that `StopAsync` hides a fault and to mutate the worker and see what your suite notices.

## Documentation Links

- [Breaking change: BackgroundService runs all of ExecuteAsync as a Task (.NET 10), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/extensions/10.0/backgroundservice-executeasync-task) (doc)
- [Breaking change: Exception handling in hosting (.NET 6), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling) (doc)
- [Worker services in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [System.Threading.Channels library, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [FakeLogCollector class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.logging.testing.fakelogcollector) (doc)
- [Test execution and control in MSTest (timeouts, cooperative cancellation), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
