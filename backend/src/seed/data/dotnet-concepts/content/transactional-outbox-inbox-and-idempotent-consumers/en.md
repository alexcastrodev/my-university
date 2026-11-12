---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Saving an order and publishing `OrderPlaced` are two writes to two systems, and no transaction spans a database and a broker. If the process dies between them, the order exists and nobody hears about it (or the event goes out for an order that was rolled back). The transactional outbox closes the first gap: the event is a row written in the same `SaveChanges` as the order, and a relay publishes it later. That trades a lost message for a duplicate one, because the relay can crash after publishing and before marking the row. So the other half of the pattern lives in the consumer: an inbox plus an idempotent handler, so that "delivered at least once" has an effect exactly once. The objective is to build both halves, drive each failure on purpose, and know what the system does in every case.

Writing the outbox row inside the aggregate's transaction is already covered in Domain Events and Consistency Boundaries. This concept starts after that point: the relay, the retries, the dead-letter, the inbox, and the failure matrix.

## Use Cases

- A service must tell Shipping, Billing and Search that an order was placed, and none of them may miss it when a deploy kills the process mid-request.
- A broker outage during peak hours must delay messages, not drop them, and the backlog must drain by itself when the broker returns.
- A consumer that sends an email or creates a shipment must not do it twice when the broker redelivers.
- A malformed message must stop blocking the queue after a few attempts and land somewhere an engineer can inspect and replay it.
- Explaining in a design review why "exactly-once" in a brokers' marketing page still needs an idempotent consumer.

## Deep Dive

### The delivery guarantee you actually get

A relay that publishes first and marks afterwards gives **at-least-once**: the message is never lost, and may be delivered more than once. The opposite order (mark first, publish after) gives **at-most-once**: never twice, sometimes never. There is no ordering of those two steps that gives exactly-once, because the second step can always fail after the first succeeded. What you can build is *effectively-once*: at-least-once delivery plus a consumer whose effect is idempotent. The rest of this concept is that sentence made concrete.

### The outbox row

The outbox row carries more than a payload, because the relay needs state to retry and give up:

```csharp
public sealed class OutboxMessage
{
    public long Seq { get; set; }                 // autoincrement: the relay order
    public Guid MessageId { get; set; }           // travels to the broker, keys the inbox
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "";
    public long? PublishedAtMs { get; set; }      // null = still pending
    public int Attempts { get; set; }
    public long NextAttemptAtMs { get; set; }     // backoff: not due before this instant
    public long? DeadLetteredAtMs { get; set; }   // gave up
    public string? LastError { get; set; }
}
```

Two decisions are worth defending. The relay order comes from `Seq`, a database-generated sequence, not from the `MessageId` (a GUID is an identity, not a clock). And the pending rows are a tiny fraction of the table, so the relay's query gets a partial index instead of scanning history (`HasFilter("PublishedAtMs IS NULL AND DeadLetteredAtMs IS NULL")` was accepted by SQLite in the lab). In production, publish-and-delete or an archive job keeps the table small.

The write side is one `SaveChanges`:

```csharp
db.Orders.Add(order);
db.Outbox.Add(new OutboxMessage { MessageId = evt.MessageId, Type = nameof(OrderPlaced),
    Payload = JsonSerializer.Serialize(evt), NextAttemptAtMs = now });
await db.SaveChangesAsync(ct); // one transaction: both rows or neither
```

In the lab a second order with the same primary key fails the commit, and the outbox still has one row, not two. A crash after this call leaves a pending row behind. Both outcomes are the point.

### The relay as a BackgroundService

The relay polls, publishes in `Seq` order, and records the outcome per message:

```csharp
foreach (var m in batch)   // pending, not dead-lettered, due, ordered by Seq
{
    try
    {
        await broker.PublishAsync(new Envelope(m.MessageId, m.Type, m.Payload), ct);
        m.PublishedAtMs = now;                 // publish FIRST, mark LATER
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        RecordFailure(m, ex, now);
    }
    await db.SaveChangesAsync(ct);             // per message: a crash costs at most one duplicate
}
```

The hosted service around it is a `PeriodicTimer` loop that catches everything except cancellation and logs it. That catch matters: an exception that escapes `ExecuteAsync` stops the host by default, so a transient database error would take the whole service down (see Hosted Services and BackgroundService). The service is a few lines, and everything interesting is in `DispatchBatchAsync`, which is a plain method a test can call without a host or a timer.

### Retries, backoff and the dead-letter

A publish failure does not lose the message, it reschedules it:

```csharp
m.Attempts++;
m.LastError = ex.Message;
if (m.Attempts >= options.MaxAttempts) m.DeadLetteredAtMs = now;               // give up
else m.NextAttemptAtMs = now + (long)(options.Delay * Math.Pow(2, m.Attempts - 1)).TotalMilliseconds;
```

In the lab, with the broker told to fail once, the row ends with `Attempts == 1` and `LastError == "broker unavailable"`. An immediate second pass publishes nothing (not due yet). After the test clock advances by the first backoff, the third pass delivers it. With the broker failing 100 times and `MaxAttempts = 3`, the row stops at three attempts with `DeadLetteredAtMs` set, and a recovered broker no longer receives it: the query skips dead-lettered rows forever.

That last property is a decision, not an accident. A dead-lettered outbox row means "the system gave up, a human must look". It needs a way back (clear `DeadLetteredAtMs` after fixing the cause, or a replay tool) and an alert on the count, otherwise it is just a quiet message loss. The test clock is a `TimeProvider` subclass, which is why none of this needed a real `Task.Delay`.

### The inbox and the idempotent consumer

The consumer records what it processed, in the same transaction as the effect:

```csharp
db.Shipments.Add(new Shipment { Id = Guid.CreateVersion7(), OrderId = evt.OrderId });
db.Inbox.Add(new InboxMessage { MessageId = envelope.MessageId, Consumer = Name, ProcessedAtMs = now });
try { await db.SaveChangesAsync(ct); return Outcome.Processed; }
catch (DbUpdateException ex) when (ex.InnerException is SqliteException { SqliteErrorCode: 19 })
{
    return Outcome.Duplicate;   // two deliveries raced: the primary key let one in
}
```

The inbox's composite primary key `(MessageId, Consumer)` is the real guarantee. I also ran the consumer with the `AnyAsync` "have I seen this?" check deleted, and every test still passed: the second delivery fails on the key and the whole transaction, shipment included, rolls back. The check is a fast path that avoids a failed insert in the common duplicate, nothing more. The key is composite so that several consumers can handle the same message independently, each with its own inbox row.

Atomicity is what makes it safe. With the shipment write forced to fail once, the lab shows zero shipments and zero inbox rows afterwards, and the retry succeeds. There is no state where the inbox says "processed" and the effect is missing. The mirror mistake is to write the inbox row in a separate transaction before or after the effect: a crash between the two either skips the work forever or does it twice.

If the effect is not in your database (a call to an email provider, a payment gateway), the inbox cannot make it atomic. Then the effect itself needs an idempotency key that the other system honors (the same idea as in REST Semantics: Status Codes and Idempotency), or you accept a small duplicate window and make it harmless.

### Redelivery and the consumer-side dead-letter

The consumer's own failures follow a smaller version of the same loop: return to ack, throw to redeliver, and give up after a limit.

```csharp
try { await consumer.HandleAsync(envelope, ct); }                   // returning is the ack
catch (Exception ex) when (ex is not OperationCanceledException)
{
    if (envelope.DeliveryCount >= maxDeliveries) broker.DeadLetter(envelope);
    else await broker.RedeliverAsync(envelope, ct);                // DeliveryCount + 1
}
```

A message whose payload is `"not json"` is redelivered twice and then dead-lettered with `DeliveryCount == 3`, instead of looping forever and starving the messages behind it. A transient failure (the injected shipment failure) is redelivered once and succeeds. Real brokers offer a delivery count and a dead-letter queue as features, and the `Channel<T>` stand-in only shows the contract.

### What happens in each failure

Every row below is a test in the lab, except the last one, which is design guidance.

| Failure | State left behind | What happens next |
| --- | --- | --- |
| Order commit fails | no order, no outbox row | nothing to publish, the caller sees the error |
| Crash after commit, before publish | order + pending row | the restarted relay publishes it |
| Broker down | row with `Attempts`, `NextAttemptAtMs` | retried with backoff, dead-lettered after `MaxAttempts` |
| Crash after publish, before marking | published message + still-pending row | published again, the inbox drops the duplicate |
| Consumer crashes before commit | no effect, no inbox row | redelivered, processed once |
| Same message twice, even concurrently | one inbox row | second delivery returns `Duplicate` |
| Poison message | nothing processed | dead-lettered after `maxDeliveries` |
| Two relay instances | possible double publish | the inbox absorbs it (lease or row lock reduces it, never replaces the inbox) |
| Consumer is slow, relay is fast | growing backlog | needs monitoring on pending age, not on the code path |

The case with two relays deserves its own sentence: the lab runs two dispatchers at once on the same file, and the final state is one shipment whether one or two copies reached the queue.

## Trade-offs

- **The outbox moves the problem, it does not delete it.** The event is no longer lost, but it is delayed by the polling interval and it can be duplicated.
  ```csharp
  await Task.WhenAll(relayA.DispatchBatchAsync(ct), relayB.DispatchBatchAsync(ct)); // 1 or 2 deliveries, 1 shipment
  ```
  Budget for the latency and design every consumer for duplicates from the first day.
- **Publish-then-mark is a choice of failure.** Swapping the order in the lab (save the mark, then publish) turned four tests red: a broker outage after the mark loses the message for good. At-least-once with an inbox is almost always the better trade, at-most-once only fits data you can afford to lose.
- **Polling is simple and adds load and latency.** A short interval means many empty queries, a long one means slow delivery. A database notification, change data capture on the outbox table, or a trigger that wakes the relay reduces both, at the cost of more infrastructure.
- **Ordering is per relay, not per world.** `Seq` order holds for one relay with no failures. A message that is retried falls behind later ones, and competing consumers process in parallel. If a consumer needs per-entity order, carry a version or sequence in the payload and have the consumer ignore or park out-of-order messages.
- **The inbox table grows forever unless you prune it.** It must be kept at least as long as the broker can redeliver. A time-based cleanup of old rows is part of the design, not an afterthought.
  ```csharp
  await db.Inbox.Where(i => i.ProcessedAtMs < cutoffMs).ExecuteDeleteAsync(ct);
  ```
- **Dead-letter without an owner is silent loss.** Alert on count and age, record the error, and have a replay path that is itself idempotent.
- **A library may already do this.** According to their documentation, MassTransit and Wolverine ship an outbox and inbox on top of EF Core. Writing one by hand is worth it to understand it and for small cases, and risky to maintain when the library covers it. Check each library's current licensing before choosing.

## Lab

In this lab you receive an order service, an outbox relay, a shipping consumer and a consumer runner as empty methods, plus a `Channel<T>` broker that can be told to fail and an EF Core SQLite database in a temporary file. You implement the five pieces and a suite of 14 tests drives every failure from the table above, including one test that runs the relay and the consumer as real hosted services while faults are injected. The core idea is that you never test the happy path alone: each failure is a test, and the final state, not the log, is what you assert.

**The scenario**

Placing an order must produce an `OrderPlaced` message for a shipping consumer, with every stage allowed to crash.

- `Model.cs`, `AppDbContext.cs`, `Broker.cs` (ready): the entities, the composite inbox key, the partial index, and the `InMemoryBroker` with `FailNextPublishes`.
- `OrderService.cs`: `PlaceOrderAsync`, order and outbox row in one `SaveChanges`.
- `OutboxDispatcher.cs`: `DispatchBatchAsync` and `RecordFailure` (the `BackgroundService` shell is ready).
- `Consumer.cs`: `ShippingConsumer.HandleAsync` and `ConsumerRunner.ProcessAsync`.

The tests inject faults with an EF Core `SaveChangesInterceptor` (a save that dies on demand) and a manual `TimeProvider`, so backoff is tested without waiting.

**What you will do, step by step**

1. **Write both rows at once (TODO-00).** Add the order and the `OutboxMessage` and call `SaveChangesAsync` once.
2. **Relay in order (TODO-01).** Select pending, not dead-lettered, due rows by `Seq`, publish, mark, and save after each message.
3. **Back off and give up (TODO-02).** Count attempts, schedule the next try with exponential backoff, dead-letter at `MaxAttempts`.
4. **Consume once (TODO-03).** Add the effect and the inbox row in one transaction, and map a duplicate to `Outcome.Duplicate`, also when the key rejects it.
5. **Redeliver or dead-letter (TODO-04).** On an exception, redeliver with a higher count, or dead-letter at `maxDeliveries`.

**How you know you are done**

`dotnet test` is green, 14 of 14. Pay attention to the test where the "mark as published" write fails: the message really arrives twice, and the shipment is created once. You should be able to explain why the publish comes before the mark, and why the inbox row has to share a transaction with the effect.

**Optional challenges**

- Remove the `AnyAsync` fast path from the consumer. What still keeps the effect single?
- Swap publish and mark in the relay. Which tests fail, and what delivery guarantee did you just build?
- Run two relays at once. How many copies reach the broker, and why is the final state still correct?

**Prerequisites:** EF Core basics, `BackgroundService` and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The starter compiles and all 14 tests fail until you do the TODOs.

## Documentation Links

- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
- [Background tasks with hosted services in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Transactions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/transactions) (doc)
- [Transactional outbox, microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) (engineering)
- [Idempotent consumer, microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html) (engineering)
