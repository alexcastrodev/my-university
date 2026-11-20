---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Azure Service Bus is a managed message broker: a sender puts a message in a queue (one consumer gets it) or in a topic (each subscription gets its own copy), and the broker holds it until a receiver settles it. In .NET you talk to it with `Azure.Messaging.ServiceBus`. This concept measures the parts that decide whether your consumer is correct: `PeekLock` and the four ways to settle a message, `DeliveryCount` and the dead-letter queue, `ServiceBusProcessor` and its options, sessions for ordering per key, duplicate detection, scheduling, TTL, batches, subscription filters, and the cost of a lock that expires in the middle of slow work. It all ran against the local Service Bus emulator, so there is no Azure account here. What needs a real namespace (Entra ID authentication, RBAC roles, Premium features) is marked "docs only".

Related: [Message Brokers: MassTransit, Azure Service Bus and RabbitMQ](/dotnet-concepts/message-brokers-masstransit-azure-service-bus-and-rabbitmq) covers the library on top, and [Idempotency](/system-design/system-design-concepts/idempotency) covers why a consumer must be safe to repeat. This one is the SDK itself, and credentials are in [Azure SDK Clients and DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential).

Versions: .NET SDK 10.0.100, TFM `net10.0`, `Azure.Messaging.ServiceBus` 7.21.0, `Azure.Identity` 1.21.0, `Microsoft.Extensions.Azure` 1.14.1, `Microsoft.Extensions.Hosting` 10.0.0, Service Bus emulator image `mcr.microsoft.com/azure-messaging/servicebus-emulator` 1.0.0 (arm64) with a SQL Server container it requires (an amd64 image running under emulation), Docker 29.9.2, macOS arm64 on an Apple M4 Max.

## Use Cases

- A queue absorbs a burst of work and a worker fleet drains it at its own pace.
- One `OrderPlaced` event reaches billing, shipping and analytics through a topic, each subscription with its own retry state.
- Messages for one customer are processed in order while customers run in parallel (sessions).
- A message that fails repeatedly stops blocking the queue and lands where someone can read why.

## Deep Dive

### The pieces: queue, topic, subscription, and the client types

A **queue** delivers each message to one consumer, and consumers on the same queue compete. A **topic** is a send-only entity: senders write to it, and each **subscription** is a virtual queue that receives a copy (optionally filtered). You cannot receive from a topic itself: a receiver on topic `events` failed with `MessagingEntityNotFound`, while `CreateReceiver("events", "all")` worked.

In the SDK, one `ServiceBusClient` owns the connection, and `CreateSender`, `CreateReceiver` and `CreateProcessor` hang off it. The doc says the client types are safe to cache and use as singletons, and that clients in one process share a connection, so create one client per process and dispose with `DisposeAsync`. A connection to the local emulator:

```csharp
await using var client = new ServiceBusClient("Endpoint=sb://localhost:7021;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;");
await using var sender = client.CreateSender("orders");
await sender.SendMessageAsync(new ServiceBusMessage("order-1") { MessageId = "m-1", Subject = "created", ApplicationProperties = { ["region"] = "eu" } });
```

That is the emulator's fixed development key. In Azure the recommended form is the namespace name plus `DefaultAzureCredential`, with no key.

### PeekLock and ReceiveAndDelete

`PeekLock` is the default. The broker hands you the message and locks it for the entity's `LockDuration`, and the message only disappears when you complete it. `ReceiveAndDelete` settles on delivery: if your process dies after the receive, the message is gone (at-most-once).

```text
received: Id=m-1 Body=order-1 Subject=created region=eu
DeliveryCount=1 SequenceNumber=1 State=Active LockedUntil-now=30s
complete twice -> ServiceBusException Reason=MessageLockLost IsTransient=False Message="The lock supplied is invalid. Either the lock expired, or the message has already been removed from the queue..."
complete in ReceiveAndDelete -> InvalidOperationException: The operation is only supported in 'PeekLock' receive mode.
```

The queue was created with a 30 second lock, and `LockedUntil` showed it. Completing twice gives `MessageLockLost`, the same exception as an expired lock, so the reason alone does not say which one happened. Use `ReceiveAndDelete` only for data that is cheap to lose.

### The four settlements

Every `PeekLock` message must end in one call on the receiver (or on the processor's event args): `CompleteMessageAsync` removes it, `AbandonMessageAsync` releases the lock now and raises `DeliveryCount`, `DeadLetterMessageAsync` moves it to the dead-letter queue with a reason you choose, and `DeferMessageAsync` sets it aside, retrievable only by sequence number. Measured on a queue with `MaxDeliveryCount = 3`:

```text
attempts 1, 2, 3: DeliveryCount=1, 2, 3, each abandoned; attempt 4: nothing in the queue
DLQ: Id=a-1 DeadLetterReason=MaxDeliveryCountExceeded Description="Message could not be consumed after 3 delivery attempts." DeliveryCount=4
explicit DeadLetterMessageAsync -> DLQ: Reason=InvalidPayload Description="body is not valid JSON" attempt=1
deferred seq=8; regular receive returns null; peek by sequence: State=Deferred
ReceiveDeferredMessageAsync -> Id=d-1 State=Deferred DeliveryCount=2
```

After the third abandon the broker moved the message by itself. The dead-letter copy carries `DeliveryCount=4`, because the move counts as a delivery attempt in the emulator. Use your own `DeadLetterMessageAsync(message, properties, reason, description)` for a message retrying cannot fix (a malformed body). The deferred message stayed invisible to a normal receive and came back only through `ReceiveDeferredMessageAsync(sequenceNumber)`, so the app must remember the number.

### The dead-letter queue: how to read it

The DLQ is a sub-queue of each queue and each subscription, created with it and never deleted. In .NET you do not build the `$deadletterqueue` path, you set an option:

```csharp
await using var dlq = client.CreateReceiver("orders", new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter });
var m = await dlq.ReceiveMessageAsync();                  // m.DeadLetterReason, m.DeadLetterErrorDescription
await dlq.CompleteMessageAsync(m);                        // nothing cleans the DLQ for you
```

System reasons include `MaxDeliveryCountExceeded` and `TTLExpiredException`. The DLQ needs an owner (an alert on its depth, a replay tool), because nothing there retries by itself, and a replay is a new send with a new sequence number, which breaks session order (doc). The emulator's `GetQueueRuntimePropertiesAsync` returned `active=0 dlq=0` with three messages in the queue (a peek found 3), so do not rely on administration counts there.

### ServiceBusProcessor: the receive loop for you

A processor runs the receive loop, calls your handler, settles, and reports failures to a second handler:

```csharp
await using var proc = client.CreateProcessor("orders", new ServiceBusProcessorOptions
{
    MaxConcurrentCalls = 3, AutoCompleteMessages = true, PrefetchCount = 0,
});
proc.ProcessMessageAsync += async a => { /* work; return = complete, throw = abandon */ };
proc.ProcessErrorAsync += a => { Log(a.ErrorSource, a.Exception); return Task.CompletedTask; };
await proc.StartProcessingAsync();
```

Measured with six 400 ms jobs and one poison message that always throws:

```text
handler throws for bad-1 at DeliveryCount=1, 2 and 3
ProcessErrorAsync: Source=ProcessMessageCallback Entity=orders Ex=InvalidOperationException: boom
done=6 of 6, peak concurrent handlers=3
DLQ: Id=bad-1 Reason=MaxDeliveryCountExceeded
```

- `MaxConcurrentCalls`: handler calls at once (peak was 3 with the value 3), so the handler must be thread-safe.
- `AutoCompleteMessages`: with `true`, returning completes and throwing abandons, so the poison message was delivered three times and dead-lettered. With `false` you settle through `args.CompleteMessageAsync` and the others.
- `ProcessErrorAsync`: required, and it also receives handler exceptions (`ErrorSource=ProcessMessageCallback`) next to broker and connection errors. It is a logging hook, not a place to settle.

### The lock expires during slow work

The queue `short-lock` has a 5 second lock, and the handler works for 7 seconds without renewing:

```text
LockedUntil-now=5.0s; working for 7s with no renewal
complete -> ServiceBusException Reason=MessageLockLost IsTransient=False ...
redelivered: Id=s-1 DeliveryCount=2
```

The work finished, the `Complete` failed, and the next receive returned the same message with `DeliveryCount=2`. If the handler had side effects, they ran twice: the cost is a duplicate, not an error. In a processor with `AutoCompleteMessages = false`, an 8 second handler on the same 5 second lock:

```text
MaxAutoLockRenewalDuration=00:00:00: handler start DeliveryCount=1, complete -> MessageLockLost; handler start DeliveryCount=2, complete -> MessageLockLost
MaxAutoLockRenewalDuration=00:01:00: handler start DeliveryCount=1, complete ok
```

With renewal disabled the handler ran twice and failed to complete both times (it would loop to the dead-letter queue). With `MaxAutoLockRenewalDuration` of one minute the processor renewed the lock in the background and the first attempt completed. Set it above your slowest handler (or `InfiniteTimeSpan`). The lock duration maximum is 5 minutes per the doc, so longer work depends on renewal, and a manual receiver calls `RenewMessageLockAsync`.

### Prefetch: locks start ticking before your handler runs

`PrefetchCount` makes the receiver pull messages ahead into a local buffer. Each prefetched message is already locked, and its lock timer runs while it waits. Six messages, `PrefetchCount = 6`, one handler call at a time, 2 seconds of work, 5 second lock:

```text
handling p1 DeliveryCount=1 lock left=5.0s
handling p4 DeliveryCount=1 lock left=-1.1s
handling p4 DeliveryCount=2 lock left=0.5s
```

By the fourth message the lock had already expired before the handler started, the auto-complete failed with `MessageLockLost`, and the message came back with `DeliveryCount=2`. The doc says the same: the buffer times the whole backlog, so `LockDuration` has to exceed processing time times the prefetch size. Prefetch helps when handling is cheap and hurts when it is slow. The doc adds that `PrefetchCount` caps concurrency, so a larger `MaxConcurrentCalls` is wasted.

### Sessions: order per key

A queue created with `RequiresSession` rejects messages without a `SessionId` and rejects a plain receiver. Both failed with `InvalidOperationException` ("The SessionId was not set on a message..." and "It is not possible for an entity that requires sessions to create a non-sessionful message receiver"). Eight messages, sessions `A` and `B` with four each, a `ServiceBusSessionProcessor` with `MaxConcurrentSessions = 2` and `MaxConcurrentCallsPerSession = 1`, random 50 to 250 ms handlers:

```text
processing order: B:B1 A:A1 B:B2 B:B3 A:A2 B:B4 A:A3 A:A4
```

The two sessions interleave, and inside each one the order is strict. A session processor holds an exclusive lock on the session, so one consumer sees a key's messages in order while different keys run in parallel. A plain queue is FIFO at the broker, not in your handlers once more than one call runs at a time.

### Duplicate detection

On a queue with `RequiresDuplicateDetection` and a 5 minute window, four sends (three with `MessageId = "same-id"`, one with another id) produced two received messages: `same-id/copy 0` and `other-id/other`. The broker accepted all the sends with no error and silently dropped the repeats. Only `MessageId` counts, not the body, and the window is configured per entity (doc: from 20 seconds to 7 days, not on the Basic tier). This protects the sender side (a retry after an unknown outcome). It does not make the consumer idempotent: redelivery after a lock loss reuses the same message, which detection does not touch.

### TTL, scheduled messages and batches

```text
after 6 s, received: t-2; DLQ: Id=t-1 Reason=TTLExpiredException
receive at t0: null; receive 4 s later: Id=sch-1 (the cancelled one never arrived)
```

A message with `TimeToLive = 3s` expired and, because the queue had `DeadLetteringOnMessageExpiration`, landed in the DLQ with `TTLExpiredException`. A second message asked for 2 days and the emulator kept 2 days although the queue default was 1 hour; the doc says the entity default is a ceiling, so treat that as an emulator difference. `ScheduleMessageAsync` returns a sequence number and the message stays invisible until the time arrives, and `CancelScheduledMessageAsync(sequenceNumber)` removed the other one.

A batch is built against the size limit instead of by guessing:

```csharp
using var batch = await sender.CreateMessageBatchAsync();
while (batch.TryAddMessage(new ServiceBusMessage(payload))) { }   // false when it no longer fits
await sender.SendMessagesAsync(batch);
```

```text
added 26 messages of 10000 bytes before TryAddMessage returned false; Count=26 SizeInBytes=260424
SendMessagesAsync(IEnumerable) of 40 x 10000 bytes -> MessageSizeExceeded (size:400640 bytes)
```

`MaxSizeInBytes` was 262144, the emulator's 256 KB limit (Standard tier size per the doc, Premium allows 100 MB). The `IEnumerable<ServiceBusMessage>` overload packs everything into one batch and throws if it does not fit, so use `ServiceBusMessageBatch` for unbounded input. Never send in a fire-and-forget loop: the doc warns that unawaited sends hide errors and can exhaust memory.

### Topics, subscriptions and rules

The topic `events` had two subscriptions: `all` (no rule, which means "accept everything") and `eu-only` with the SQL rule `region = 'eu'`, matched on `ApplicationProperties`:

Sending `order-eu` and `order-us`, subscription `all` received both and `eu-only` received only `order-eu`. Each subscription is an independent queue with its own lock, `MaxDeliveryCount` and DLQ, so a slow subscriber does not delay the others. Rule kinds are SQL, correlation and boolean (doc), and the filter lives on the subscription: the sender knows nothing about who listens.

### Errors you will see

`ServiceBusException.Reason` is a `ServiceBusFailureReason`, and `IsTransient` says whether the SDK retries it. Measured:

A missing queue gave `MessagingEntityNotFound`, an oversized message `MessageSizeExceeded` and an unknown deferred sequence number `MessageNotFound`, all with `IsTransient=False`. Nothing listening on the port (`MaxRetries=1`) gave `ServiceCommunicationProblem` with `IsTransient=True` after 0.4 s. The transient one is retried by the client (`ServiceBusRetryOptions`, `MaxRetries` and `Delay`) before it reaches you; the others are your bug or your data. Branch on `Reason`, not on the message text.

### Registering with dependency injection

`Microsoft.Extensions.Azure` registers the client as a singleton and can name extra ones:
```csharp
services.AddAzureClients(b =>
{
    b.AddServiceBusClientWithNamespace("demo.servicebus.windows.net").WithName("prod-ns"); // DefaultAzureCredential
    b.AddClient<ServiceBusSender, ServiceBusClientOptions>((_, _, sp) => sp.GetRequiredService<ServiceBusClient>().CreateSender("orders")).WithName("orders-sender");
});
```

Measured: two resolutions gave `sameInstance=True`, the named client reported `Namespace=demo.servicebus.windows.net`, and a sender from `IAzureClientFactory<ServiceBusSender>` sent to the emulator. Gotcha: disposing the `ServiceProvider` with a synchronous `using` threw `'ServiceBusClient' type only implements IAsyncDisposable`, so use `await using`. The namespace form with `DefaultAzureCredential` cannot be measured without a real namespace (offline it failed with `ServiceCommunicationProblem`).

Docs only, authentication: the principal needs `Azure Service Bus Data Sender` to send and `Azure Service Bus Data Receiver` to receive (`Data Owner` for both), on the namespace or one entity, and SAS key authentication can be disabled so only Entra ID works. In an Azure Function the `ServiceBusTrigger` binding replaces the processor, see [Azure Functions Isolated Worker](/azure-dotnet-concepts/azure-functions-isolated-worker).

### At-least-once and the idempotent consumer

PeekLock is at-least-once: a lost lock, a crashed worker, a failed `Complete` and a prefetch buffer all redeliver, as the `DeliveryCount=2` runs above showed. So the handler decides whether a duplicate is harmless:

```csharp
proc.ProcessMessageAsync += async a =>
{
    if (!await store.TryRecordAsync(a.Message.MessageId)) return;   // INSERT ... ON CONFLICT DO NOTHING, same transaction as the effect
    await ApplyAsync(a.Message);
};
```

The record and the effect must commit together, as in [Transactional Outbox, Inbox and Idempotent Consumers](/dotnet-concepts/transactional-outbox-inbox-and-idempotent-consumers); the sender side, with a stable `MessageId`, is the [Outbox pattern](/system-design/system-design-concepts/outbox-pattern). Duplicate detection covers sender retries only. For cross-service flows see [Saga pattern](/system-design/system-design-concepts/saga-pattern).

### Service Bus against RabbitMQ and Channel&lt;T&gt;

| | `Channel<T>` | RabbitMQ | Service Bus |
| --- | --- | --- | --- |
| Where it runs | inside one process | your broker | managed service |
| Survives a restart | no | durable queue, persistent messages, confirms | yes |
| Acknowledge | none | ack, nack, requeue | complete, abandon, dead-letter, defer |
| Ordering | FIFO | FIFO per queue, redelivery can change order | FIFO through sessions |

Sources: the `System.Threading.Channels` page (in-process producer/consumer), the RabbitMQ acknowledgements and queues guides, and the Service Bus queue comparison page (FIFO through sessions, at-least-once in PeekLock). I did not run RabbitMQ or compare throughput.

### Book vs today

Older code and books use `WindowsAzure.ServiceBus` (`QueueClient`, `BrokeredMessage`) or `Microsoft.Azure.ServiceBus` (`QueueClient`, `RegisterMessageHandler`). The current Learn page says both were retired on September 30, 2026 and no longer receive support or updates, and the SBMP protocol was retired the same day: the replacement is `Azure.Messaging.ServiceBus` over AMQP, with a migration guide on GitHub. The vocabulary moved: `QueueClient.RegisterMessageHandler` became `ServiceBusProcessor`, `BrokeredMessage` became `ServiceBusMessage` and `ServiceBusReceivedMessage`, and connection strings with keys give way to `DefaultAzureCredential` and RBAC. Retirement means no fixes, not that the packages stop working, but new code should not start on them.

## Trade-offs

- **PeekLock gives safety and a duplicate.** The message survives a crash, and in return the handler may run twice, so every handler with side effects needs the idempotency check above.
- **Long handlers need renewal or a different shape.** `MaxAutoLockRenewalDuration` keeps the lock, and an hour-long job is better split into short messages than held under a lock.
- **Prefetch is a throughput switch with a lock cost.** I did not measure a throughput gain, and it caused `MessageLockLost` at the fourth of six messages, so enable it only when handling is fast and `LockDuration` covers the whole buffer.
- **Sessions order by key and limit parallelism to the key count.** One hot session is a single-threaded queue, and a dead-letter replay loses its place.
- **Duplicate detection is not exactly-once.** It drops repeated `MessageId` values within a window on the way in. It says nothing about redelivery to a consumer.
- **The emulator is for development only.** It has no Entra ID, no partitioning, a 1 hour TTL, a 256 KB message limit and unusable runtime counts, so behavior that depends on those (RBAC failures, large messages, metrics) needs a real namespace.

## Documentation Links

- [Send and receive messages from a Service Bus queue (.NET), Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dotnet-get-started-with-queues) (doc)
- [Message transfers, locks, and settlement, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement) (doc)
- [Service Bus dead-letter queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) (doc)
- [Queues, topics, and subscriptions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions) (doc)
- [Message sessions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-sessions) (doc)
- [Duplicate detection, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection) (doc)
- [Prefetch Service Bus messages, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-prefetch) (doc)
- [Topic filters and actions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/topic-filters) (doc)
- [Authenticate an application with Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/authenticate-application) (doc)
- [Service Bus emulator overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator) (doc)
- [ServiceBusFailureReason, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.messaging.servicebus.servicebusfailurereason) (doc)
- [Service Bus queues compared with Storage queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Migrate from Microsoft.Azure.ServiceBus to Azure.Messaging.ServiceBus, Azure SDK for .NET](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/servicebus/Azure.Messaging.ServiceBus/MigrationGuide.md) (doc)
- [System.Threading.Channels, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/channels) (doc)
- [RabbitMQ consumer acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms) (doc)
- [RabbitMQ queues](https://www.rabbitmq.com/docs/queues) (doc)
