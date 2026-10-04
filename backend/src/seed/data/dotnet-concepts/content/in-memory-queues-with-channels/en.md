---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Sometimes an endpoint has work that should not delay the response: send a
confirmation email, resize an image, call a slow partner API. `Channel<T>` from
`System.Threading.Channels` is the in-process queue built for that. A producer
writes items, a consumer reads them asynchronously, and the channel handles the
waiting without locks or polling. The two decisions that matter are what happens
when the producer is faster than the consumer (bounded capacity and a full
mode), and what you accept to lose, because a channel lives in memory and
disappears with the process.

## Use Cases

- A `POST /orders` endpoint that replies `202 Accepted` and lets a background
  service send the confirmation email.
- Smoothing a burst of incoming events so a slow downstream call processes them
  at its own pace.
- Fan-out to a few consumers that share one queue of work items.
- Telemetry or audit entries that are useful but acceptable to drop under load.

## Deep Dive

### A bounded channel

`Channel.CreateBounded<T>` gives the queue a capacity. When it is full, the
`FullMode` decides what a writer experiences:

```csharp
var channel = Channel.CreateBounded<EmailJob>(new BoundedChannelOptions(capacity: 1000)
{
    FullMode = BoundedChannelFullMode.Wait, // WriteAsync waits for room
    SingleReader = true,                    // one consumer: lets the channel skip some synchronization
    SingleWriter = false,                   // many requests write at once
});
```

The modes are `Wait` (the writer waits, giving backpressure), `DropWrite` (the
new item is discarded), `DropNewest` (the most recently queued item is
discarded), and `DropOldest` (the oldest queued item is discarded). `SingleReader`
and `SingleWriter` are promises: if you set them and break them, the behavior is
undefined, so set them only when it is structurally true.

`Channel.CreateUnbounded<T>` has no limit, which means a slow consumer lets the
queue grow until the process runs out of memory.

### Producer in the endpoint

Register the channel as a singleton and hand each side to the code that needs
it, so the endpoint can only write and the worker can only read:

```csharp
builder.Services.AddSingleton(channel);
builder.Services.AddSingleton(sp => sp.GetRequiredService<Channel<EmailJob>>().Writer);
builder.Services.AddHostedService<EmailWorker>();

app.MapPost("/orders", async (PlaceOrder cmd, OrdersModule orders,
    ChannelWriter<EmailJob> queue, CancellationToken ct) =>
{
    var id = await orders.PlaceAsync(cmd, ct);

    if (!queue.TryWrite(new EmailJob(id)))          // full: decide, do not block the request forever
        return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);

    return Results.Accepted($"/orders/{id}");
});
```

`TryWrite` returns immediately with `false` when a `Wait` channel is full, and
`WriteAsync` waits for room (until the token cancels). For an HTTP endpoint,
failing fast with a clear status is usually better than holding the request.

### Consumer in a BackgroundService

`Reader.ReadAllAsync` returns an `IAsyncEnumerable<T>` that yields items as they
arrive and ends when the writer completes and the queue is empty:

```csharp
internal sealed class EmailWorker(
    Channel<EmailJob> channel, IServiceScopeFactory scopes, ILogger<EmailWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in channel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IEmailSender>().SendAsync(job, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Email job {Id} failed", job.OrderId);
            }
        }
    }
}
```

To run several consumers, start several loops over the same reader, and leave
`SingleReader` as `false`. Catching inside the loop matters: one bad item must
not end the `await foreach` and stop the whole worker.

### Completing the channel and draining on shutdown

`Writer.Complete()` says no more items will be written. Readers keep getting the
items already queued, and `ReadAllAsync` ends after the last one. On shutdown,
complete the writer and wait for the consumer to finish what is queued. For that,
the consumer must not read with `stoppingToken`, because `BackgroundService`
cancels it as soon as `StopAsync` runs and the loop would end with items left:

```csharp
// In ExecuteAsync: read until the channel is completed and empty.
await foreach (var job in channel.Reader.ReadAllAsync(CancellationToken.None)) { /* ... */ }

public override async Task StopAsync(CancellationToken cancellationToken)
{
    channel.Writer.Complete();                      // no new items
    if (ExecuteTask is { } running)
        await running.WaitAsync(cancellationToken); // drain, bounded by the shutdown timeout
    await base.StopAsync(cancellationToken);
}
```

The `cancellationToken` passed to `StopAsync` is the host's shutdown deadline, so
the drain is bounded by `HostOptions.ShutdownTimeout`. Whatever is still queued
when it expires is lost.

## Trade-offs

- **The queue is only in memory.** A restart, a crash, or a deployment loses
  every queued item, and the endpoint has already told the client `202`. Anything
  that must be delivered needs a durable store (an outbox table or a broker), and
  the channel is only a way to wake the worker.
- **Bounded versus unbounded is a memory decision.** An unbounded channel never
  rejects work and eventually exhausts memory under a slow consumer. A bounded
  one pushes the overload back to the producer, which is the safer failure.
- **Each `FullMode` loses something different.** `Wait` loses nothing and slows
  the producer, while the `Drop*` modes lose items silently unless you observe
  them.
  ```csharp
  Channel.CreateBounded<Metric>(options, dropped => log.LogWarning("Dropped {Metric}", dropped.Name));
  // The overload with an itemDropped callback reports what the drop modes discard.
  ```
- **`SingleReader` and `SingleWriter` are unchecked promises.** They make the
  channel faster, and setting `SingleWriter = true` while several requests write
  concurrently works in a quick test and breaks under real load.
- **The queue sits in one process.** With several replicas, each has its own
  channel, so there is no shared ordering, no sharing of load between instances,
  and no visibility into how much work is waiting overall.
- **A failed item is not retried.** The worker above logs and moves on, so retries
  and a dead-letter store are yours to build, which is the point where a durable
  job library earns its place.

## Documentation Links

- [Channels, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [BoundedChannelFullMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.channels.boundedchannelfullmode) (doc)
- [Queue background tasks with a hosted service, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/queue-service) (doc)
- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
