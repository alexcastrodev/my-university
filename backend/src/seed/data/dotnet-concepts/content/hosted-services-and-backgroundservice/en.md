---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

An ASP.NET Core or Worker Service host can run long-lived code next to the web
server: a polling loop, a nightly cleanup, a consumer of a queue. The building
block is `IHostedService`, and `BackgroundService` is the base class most code
should start from. The details that cause incidents are all in the lifecycle:
what happens when the loop throws, how a singleton reaches a scoped
`DbContext`, how startup is delayed by work that looks asynchronous, and how
much time the host gives the service to stop.

## Use Cases

- Polling a table every 30 seconds for outbox messages and dispatching them.
- Running a cleanup of expired sessions every night without an external
  scheduler.
- Warming a cache or checking a dependency once at startup, before the host
  starts accepting traffic.
- Draining in-flight work when the orchestrator sends a termination signal,
  instead of dropping it.

## Deep Dive

### IHostedService and BackgroundService

`IHostedService` has two methods: `StartAsync`, called when the host starts, and
`StopAsync`, called when it shuts down. `BackgroundService` implements both and
leaves you one abstract method, `ExecuteAsync(CancellationToken)`, that runs for
the lifetime of the service:

```csharp
internal sealed class OutboxDispatcher(
    IServiceScopeFactory scopes, ILogger<OutboxDispatcher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<OrdersDbContext>();
                await DispatchPendingAsync(db, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Outbox dispatch failed, retrying on the next tick");
            }
        }
    }
}

builder.Services.AddHostedService<OutboxDispatcher>();
```

Implement `IHostedService` directly only when you need separate start and stop
behavior, such as opening a connection in `StartAsync` and closing it in
`StopAsync`. Otherwise `BackgroundService` gives you the cancellation token and
the stop handling for free.

### An unhandled exception stops the host

Since .NET 6, an exception that escapes `ExecuteAsync` is logged as critical
and the host stops (`BackgroundServiceExceptionBehavior.StopHost`, the default).
Before that, the exception was swallowed and the service silently stopped
working while the application kept running. Catch what you can recover from
inside the loop, as above, and let truly fatal errors end the process so the
orchestrator restarts it:

```csharp
builder.Services.Configure<HostOptions>(o =>
    o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);
// Restores the old behavior: the failure is logged and the host keeps running without the service.
```

### Scoped services from a singleton

A hosted service is a singleton, so it cannot take a scoped `DbContext` in its
constructor: with scope validation on (the default in Development) the host
fails at startup, and without it the service would capture one context for the
whole life of the application. Inject `IServiceScopeFactory` and create a scope
for each unit of work, as the dispatcher above does, or inject
`IDbContextFactory<T>`.

### PeriodicTimer

`PeriodicTimer` is the right tool for a fixed-interval loop. `WaitForNextTickAsync`
returns `true` for each tick, throws `OperationCanceledException` when the token
is cancelled, and returns `false` after the timer is disposed. If an iteration
takes longer than the period, ticks do not pile up: the next wait completes
once, so iterations never overlap. A `while` loop with `Task.Delay` drifts by the
duration of the work, and `System.Threading.Timer` can fire a callback while the
previous one is still running.

### Startup and graceful shutdown

The host calls `StartAsync` on each hosted service in registration order and
waits for it. For a `BackgroundService`, `StartAsync` runs `ExecuteAsync` up to
its first real `await` and then returns, so synchronous work at the top of
`ExecuteAsync` blocks the startup of every service after it. Newer runtime
versions may relax this, so check the release notes of the version you target,
but an `ExecuteAsync` that yields early is safe on all of them:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    await Task.Yield(); // let the host finish starting, then do the slow initialization
    await WarmUpCacheAsync(stoppingToken);
    // ... loop
}
```

On shutdown the host cancels `stoppingToken` and waits for `ExecuteAsync` to
finish, up to `HostOptions.ShutdownTimeout`, which is 30 seconds by default in
current versions. Services stop in reverse registration order. If your loop
needs longer to drain, raise the timeout, and make sure the orchestrator's own
grace period (for example Kubernetes' `terminationGracePeriodSeconds`) is
longer than it:

```csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60));
```

## Trade-offs

- **Swallowing every exception keeps the loop alive and hides a stuck service.**
  A catch-all that only logs can turn a permanent failure (a bad connection
  string) into an endless loop of errors, so pair it with a health check or a
  metric that shows no recent success.
- **Letting it crash is loud and needs a restarter.** Stopping the host on an
  unhandled exception is the right default when an orchestrator restarts the
  process, and it takes the web endpoints down with it when the background work
  and the API share one host.
- **Hosted services run in the web process.** A CPU-heavy loop competes with
  request handling for the same thread pool, so heavy or independently scaled
  work belongs in a separate Worker Service deployment.
- **A long synchronous `StartAsync` delays readiness.** The app does not accept
  requests until every hosted service has started, so slow initialization at the
  top of `ExecuteAsync` shows up as slow deployments.
  ```csharp
  await Task.Yield(); // without this, a 40 second warm-up delays the whole host by 40 seconds
  ```
- **The shutdown timeout is a hard stop.** Work still running when it expires is
  abandoned, so anything that must not be lost needs to be durable (a database
  or a broker) and not only in memory.

## Documentation Links

- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Worker Services in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/workers) (doc)
- [Generic Host, shutdown and HostOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) (doc)
- [Breaking change: Unhandled exceptions from a BackgroundService, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/6.0/hosting-exception-handling) (doc)
- [PeriodicTimer class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer) (doc)
