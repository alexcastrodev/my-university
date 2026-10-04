---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

An in-memory queue loses its jobs when the process restarts. A durable job
scheduler stores each job in a database before it runs, so a crash, a deploy, or
a thrown exception does not make the work disappear: the job is picked up again
and retried. Hangfire and Quartz.NET are the two established libraries for this
in .NET. They solve overlapping problems with different centers of gravity:
Hangfire is built around "run this method in the background, reliably", and
Quartz.NET around "run this job on a schedule, in a cluster". Whichever you pick,
the same rule governs your code: delivery is at-least-once, so every job must be
safe to run twice.

## Use Cases

- Sending a welcome email after sign-up, with retries when the mail provider is
  down, and surviving a deploy in the middle.
- Generating a nightly report at 02:00 on exactly one of three application
  instances.
- Processing the rows of an outbox table and publishing them to a broker.
- Scheduling a one-off job for the future, such as reminding a customer in 24
  hours.

## Deep Dive

### Why a channel is not enough

A `Channel<T>` consumed by a `BackgroundService` is fast and simple, and
everything in it is gone when the process stops. Durable jobs add three things:
persistence (the job is in a database before the request returns), retries with
back-off, and visibility (you can see what failed and why). If losing a job on a
restart is acceptable, stay with the channel. If it is not, move to a store.

### Hangfire: fire-and-forget, delayed, and recurring jobs

Hangfire serializes a method call and its arguments to JSON, stores it, and a
server process in your application runs it later:

```csharp
builder.Services.AddHangfire(c => c.UsePostgreSqlStorage(o => o.UseNpgsqlConnection(connectionString)));
builder.Services.AddHangfireServer();

// In an endpoint: returns immediately, the job is already stored.
app.MapPost("/orders/{id:guid}/confirm", (Guid id, IBackgroundJobClient jobs) =>
{
    jobs.Enqueue<IOrderEmails>(x => x.SendConfirmationAsync(id, CancellationToken.None));
    jobs.Schedule<IOrderEmails>(x => x.SendReminderAsync(id, CancellationToken.None), TimeSpan.FromHours(24));
    return Results.Accepted();
});

// Recurring job, defined once at startup.
app.Services.GetRequiredService<IRecurringJobManager>()
    .AddOrUpdate<IReports>("nightly-report", x => x.BuildAsync(CancellationToken.None), Cron.Daily(2));
```

A job that throws is retried automatically, 10 times by default with increasing
delays, and then moves to the failed state where it stays visible in the
dashboard. Change the policy per method:

```csharp
[AutomaticRetry(Attempts = 3, OnAttemptsExceeded = AttemptsExceededAction.Delete)]
public Task SendReminderAsync(Guid orderId, CancellationToken ct) { /* ... */ }
```

The dashboard (`app.MapHangfireDashboard`) lists queues, retries, and failures,
and lets you requeue a job. It exposes job arguments and actions, so protect it
with an authorization filter instead of leaving the default in place.

### Quartz.NET: triggers, clusters, and misfires

Quartz separates the job (the code) from the trigger (when it runs), and its
strength is scheduling: cron expressions, calendars, and clustering with a
persistent store so that each firing runs on exactly one node:

```csharp
builder.Services.AddQuartz(q =>
{
    var key = new JobKey("nightly-report");
    q.AddJob<NightlyReportJob>(o => o.WithIdentity(key));
    q.AddTrigger(t => t.ForJob(key).WithCronSchedule("0 0 2 * * ?",
        c => c.WithMisfireHandlingInstructionFireAndProceed()));
});
builder.Services.AddQuartzHostedService(o => o.WaitForJobsToComplete = true);

[DisallowConcurrentExecution]
public sealed class NightlyReportJob(IReports reports) : IJob
{
    public Task Execute(IJobExecutionContext context) => reports.BuildAsync(context.CancellationToken);
}
```

A misfire happens when a trigger was due but no node was free to run it, for
example during downtime. The misfire instruction says what to do afterward: run
now once (`FireAndProceed`), skip to the next scheduled time, or run every missed
firing. For a persistent, clustered setup you configure an ADO job store against
your database in the same `AddQuartz` call.

### Choosing between them

Pick Hangfire when the dominant need is "enqueue this work from application code,
retry it, and show me what failed". Pick Quartz.NET when the dominant need is
precise, calendar-based scheduling or clustered recurring jobs. Using both is
legitimate and rarely necessary.

### At-least-once delivery means idempotent jobs

A job can run more than once: a worker crashes after the work but before the
state is saved, or a retry fires after a timeout that actually succeeded. Make
the job safe to repeat by checking state, not by assuming a single run:

```csharp
public async Task SendConfirmationAsync(Guid orderId, CancellationToken ct)
{
    var order = await db.Orders.SingleAsync(o => o.Id == new OrderId(orderId), ct);
    if (order.ConfirmationSentAt is not null) return; // already done on an earlier attempt

    await mailer.SendAsync(order.CustomerEmail, "Order confirmed", ct, idempotencyKey: $"confirm-{orderId}");
    order.MarkConfirmationSent(clock.GetUtcNow());
    await db.SaveChangesAsync(ct);
}
```

### Pass IDs, not entities

The arguments are serialized when the job is enqueued and read back when it runs,
possibly minutes or days later, possibly after the code changed. Pass small,
stable values (an id) and load the current data inside the job. An entity
serialized at enqueue time is a stale snapshot, and a renamed property can break
the deserialization of jobs already in the queue.

### Relation to the outbox

Enqueuing a job from a request has the same dual-write problem as publishing an
event: the database commit and the enqueue are two systems. If the enqueue
succeeds and the commit fails, the job runs for data that does not exist. If the
commit succeeds and the process dies before the enqueue, the job is lost.
Writing the intent to an outbox table in the same transaction, and enqueuing from
there, closes that gap.

## Trade-offs

- **Durable means slower and more infrastructure.** Every job is a database write
  and polling or a lock, so very high-volume, short-lived work is better served by
  a broker or an in-memory channel.
- **Serialized arguments are a contract.** Renaming a method, a parameter, or its
  type while jobs are in the queue makes those jobs fail on deserialization.
  ```csharp
  // Enqueued yesterday as SendConfirmationAsync(Guid). Today's signature takes a record: it cannot bind.
  public Task SendConfirmationAsync(ConfirmationRequest request, CancellationToken ct);
  ```
  Keep old signatures until the queue has drained, or add a new method.
- **Retries multiply side effects.** A job that sends an email and then fails on a
  database write sends the email again on every retry unless the send is
  idempotent.
- **The dashboard is an admin tool.** It can trigger and delete jobs and shows
  their arguments, so it needs authentication and should not be public.
- **Quartz clustering depends on shared clocks and the database.** Nodes with
  drifting clocks or a slow store can fire late or skip, and misfire handling is
  something you have to choose on purpose per trigger.

## Documentation Links

- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Hangfire documentation](https://docs.hangfire.io/en/latest/) (doc)
- [Hangfire, dealing with exceptions and automatic retries](https://docs.hangfire.io/en/latest/background-processing/dealing-with-exceptions.html) (doc)
- [Hangfire, writing reliable jobs](https://docs.hangfire.io/en/latest/background-methods/writing-reliable-jobs.html) (doc)
- [Quartz.NET documentation](https://www.quartz-scheduler.net/documentation/) (doc)
