---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A `Channel<T>` queue lives inside one process and dies with it. The transactional outbox gets a message safely out of your database, but it still needs somewhere to publish to. That somewhere is a message broker: a separate server that stores messages durably and hands them to consumers in other processes. In .NET the default way to talk to one is a library, and the best known is MassTransit, which gives the same programming model over RabbitMQ, Azure Service Bus and an in-memory transport.

The objective is to learn the vocabulary every broker shares (queue, topic, competing consumers, at-least-once, dead-letter), to write consumers, publish and send, retry, fault handling and a consumer outbox with MassTransit, to run all of it in a test with no broker, and to know what changes when you point it at RabbitMQ or Azure Service Bus. There is also a licensing fact to know before any of this: MassTransit v9 is a commercial product, so this concept uses the last Apache-2.0 version.

This concept builds on In-Memory Queues with Channels and on Transactional Outbox, Inbox and Idempotent Consumers: the broker is the "somewhere" those two concepts left abstract.

## Use Cases

- An order service tells Billing, Shipping and Search that an order was placed, and none of them is called synchronously or knows the others exist.
- A burst of work (imports, emails, thumbnails) is absorbed by a queue and drained by several workers at the rate the downstream can take.
- A deploy restarts a consumer in the middle of the day and the messages wait in the broker instead of being lost.
- A malformed message must stop retrying and land somewhere an engineer can inspect and replay it.
- A team has to decide between a library on top of a broker, the broker's own SDK, and a commercial or open alternative, and needs the facts to argue it.

## Deep Dive

### The vocabulary of a broker

These words mean the same thing in RabbitMQ, Azure Service Bus and the others, with different names for the parts:

- **Queue:** messages wait in order until a consumer takes one. A message is delivered to one consumer of that queue. Several consumers on the same queue are **competing consumers**: they share the work, and adding instances scales throughput.
- **Topic (publish/subscribe):** a producer publishes once and each *subscription* gets its own copy, so Billing and Audit both see `OrderSubmitted`. In Service Bus this is a topic with subscriptions. In RabbitMQ it is an exchange with queues bound to it. Each subscription is a queue, so the competing-consumers rule still applies inside it.
- **Command versus event:** a command ("ship this order") has one intended receiver and is sent to a queue. An event ("an order was submitted") says something happened and is published to whoever cares. Mixing them up is the most common design error.
- **At-least-once delivery:** the broker re-delivers a message when the consumer fails or does not acknowledge in time, so a message can arrive more than once. Consumers must be idempotent, which is the inbox half of the previous concept.
- **Dead-letter queue (DLQ):** where a message goes after too many failed deliveries or when it is rejected. Service Bus has it built in as a sub-queue with a maximum delivery count. In RabbitMQ it is a dead-letter exchange you configure. MassTransit moves failed messages to an `_error` queue by itself (according to its documentation).
- **Acknowledgement:** the consumer returning normally is the ack, an exception is the nack. Everything above hangs on that.

### Publish versus send, in code

A MassTransit consumer is a class with one method, and the contracts are plain records:

```csharp
public record OrderSubmitted(Guid OrderId, decimal Total);   // event
public record ShipOrder(Guid OrderId);                       // command

public sealed class BillingConsumer(Ledger ledger) : IConsumer<OrderSubmitted>
{
    public async Task Consume(ConsumeContext<OrderSubmitted> context)
    {
        ledger.Charges.TryAdd(context.Message.OrderId, 0);
        await context.Publish(new PaymentCaptured(context.Message.OrderId));
    }
}
```

The producer side has two different verbs:

```csharp
await publish.Publish(new OrderSubmitted(orderId, total), ct);           // IPublishEndpoint: every subscriber
var ep = await send.GetSendEndpoint(new Uri("queue:shipping"));         // ISendEndpointProvider: one queue
await ep.Send(new ShipOrder(orderId), ct);
```

In the lab, publishing `OrderSubmitted` reaches the billing consumer, which publishes `PaymentCaptured`, which an unrelated audit consumer also receives: one event, two independent subscribers. Sending `ShipOrder` to `queue:shipping` reaches exactly that consumer, and the test confirms the event travelled by publish and not by send. The `queue:` address is a MassTransit short form, and the queue name is pinned in a `ConsumerDefinition` so it does not depend on the naming convention.

### The in-memory transport and the test harness

```csharp
services.AddMassTransit(x =>
{
    x.AddConsumer<BillingConsumer, BillingConsumerDefinition>();
    x.UsingInMemory((ctx, cfg) => cfg.ConfigureEndpoints(ctx));
});
```

`UsingInMemory` runs a real bus inside the process: serialization, endpoints, retry filters and consumers are all the real ones. Only the broker server is missing. `ConfigureEndpoints` creates one receive endpoint per registered consumer and wires the message types. That is why the same registration can run in production against RabbitMQ and in a test against memory.

For tests, `AddMassTransitTestHarness` replaces the transport and gives an `ITestHarness`:

```csharp
var sp = new ServiceCollection().AddSingleton(ledger).AddScoped<OrderApi>()
    .AddMassTransitTestHarness(x => x.AddOrderConsumers()).BuildServiceProvider(true);
var harness = sp.GetRequiredService<ITestHarness>();
await harness.Start();
await api.SubmitAsync(order, 10m);
Assert.True(await harness.GetConsumerHarness<AuditConsumer>().Consumed.Any<PaymentCaptured>());
```

`harness.Published`, `harness.Sent` and `harness.Consumed` are awaitable lists. Two gotchas from running it. First, `Consumed.Any<T>()` becomes true on the first *attempt*, including a failing one, so to see the end of a retry sequence the lab polls the ledger for the final state instead of trusting the list. Second, the harness lists collapse messages that carry the same `MessageId`, so the lab counts duplicate deliveries with a counter in the consumer.

### Retry, then fault

Retry is a filter on the receive endpoint, configured in a definition:

```csharp
public sealed class BillingConsumerDefinition : ConsumerDefinition<BillingConsumer>
{
    protected override void ConfigureConsumer(IReceiveEndpointConfigurator endpoint,
        IConsumerConfigurator<BillingConsumer> consumer, IRegistrationContext context)
    {
        endpoint.UseMessageRetry(r => r.Interval(3, TimeSpan.FromMilliseconds(10)));
        endpoint.UseInMemoryOutbox(context);
    }
}
```

With a consumer that throws once, the lab shows two attempts and then success, and no `Fault<ShipOrder>`. With a consumer that always throws, there are three attempts (one try and two retries), nothing is shipped, and MassTransit publishes `Fault<ShipOrder>`. A poison `OrderSubmitted` (negative total) is delivered four times (one try and three retries) and ends in a consumer of `Fault<OrderSubmitted>`, which is the application's hook to alert, compensate or park the work.

This is *immediate* retry inside the consumer's process, good for a deadlock or a blip. A failure that needs minutes to clear is a different tool, **delayed redelivery** (`UseDelayedRedelivery`), which takes the message out and returns it later. According to the MassTransit documentation it needs a scheduler or broker-side delay, and I did not run it, so check the version you use. Retries also amplify load on a struggling dependency, which is where Resilience: Retries, Timeouts and Circuit Breakers applies: bound the attempts, add backoff, and do not retry what can never succeed (a validation error).

### Idempotency: the inbox in a consumer

At-least-once means the consumer sees duplicates, so it checks `context.MessageId` before acting and records it as the last step. In the lab the same `MessageId` is published twice and the broker delivers both (two deliveries counted), yet the ledger holds one charge and one `PaymentCaptured`. Removing the check makes that test fail. The in-memory set here is a stand-in: with a database, the "processed" row and the effect must share a transaction, exactly as in the previous concept.

### The consumer outbox

The consumer has its own version of the dual-write problem: it publishes an event and then fails, the broker redelivers the command, and the event goes out twice. MassTransit's in-memory outbox (`UseInMemoryOutbox`) holds what the consumer publishes and sends until `Consume` completes, and discards it when the consumer throws:

```csharp
_ledger.FailBillingTimes = 1;               // publish, then throw once
await api.SubmitAsync(order, 10m);
// with the outbox:    BillingAttempts == 2, one PaymentCaptured published
// without the outbox: two PaymentCaptured published (removing the line failed the test with 2 items)
```

That solves *publish only if the consumer succeeded*. It does not make a database write and a publish atomic: for that MassTransit documents an Entity Framework Core outbox with its own tables, which is the transactional outbox of the previous concept packaged in the library. I did not run the EF outbox in this lab, so read its page before adopting it, and note it brings tables and a delivery service to operate.

### What changes with RabbitMQ and Azure Service Bus

Almost nothing in the consumers. The registration keeps `AddConsumer` and `ConfigureEndpoints`, and the transport line changes. These two snippets compiled against `MassTransit.RabbitMQ` and `MassTransit.Azure.ServiceBus.Core` 8.5.12 and were not run, because no broker was available:

```csharp
x.UsingRabbitMq((ctx, cfg) =>
{
    cfg.Host("localhost", "/", h => { h.Username("guest"); h.Password("guest"); });
    cfg.ConfigureEndpoints(ctx);
});

x.UsingAzureServiceBus((ctx, cfg) =>
{
    cfg.Host("Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=x;SharedAccessKey=y");
    cfg.ConfigureEndpoints(ctx);
});
```

What the transport adds is topology, and the MassTransit documentation describes it: on RabbitMQ a published message type becomes an exchange and each consumer's queue is bound to it, and on Service Bus it becomes a topic with a subscription per consumer. The consequences are operational, not in your code: the queues and exchanges (or topics and subscriptions) are created at startup, which needs permissions; the dead-letter behaviour, message time-to-live, ordering (sessions on Service Bus, a single active consumer on RabbitMQ) and prefetch limits belong to the broker's own settings; and the connection string is a secret, so it comes from configuration and a vault, not from source.

### The license fact

MassTransit v9 is a commercial product. The NuGet package for 9.2.6 declares a license URL at `massient.com/license`, while 8.5.12 declares `Apache-2.0` as its SPDX license expression, and so do the `MassTransit.RabbitMQ` and `MassTransit.Azure.ServiceBus.Core` 8.5.12 packages. The company behind v9 is Massient, and its license page describes two paid scopes (single product line or organization-wide) that are not based on message volume or number of services. It also says v8 and earlier remain free and open source under their original licenses but are unsupported under that agreement. The v9 documentation has a "Configure the license key" page, so assume v9 needs a key at runtime and check it before you build on it. I could not find a public price or an end date for v8 maintenance on the pages I read, only a statement in the original announcement, quoted by secondary sources, that v8 would get fixes through at least the end of 2026, so verify that before relying on it.

For the lab this means a pin to 8.5.12 and a comment in the project file. For your project it is a decision with a cost: pay for v9, stay on v8 knowing support is limited, or move to an alternative.

### Alternatives

Only what I could check on NuGet (version and license field): **Rebus** (8.10.0, MIT license), **Wolverine** (package `WolverineFx` 6.64.0, MIT license, which according to the previous concept's sources also ships an outbox and inbox) and **NServiceBus** (10.2.9 as of this writing, a long-standing commercial product, so check its terms on the vendor page, I did not read them). I did not build with any of them. The decision criteria are the same as for any library: which brokers it supports, whether it has an outbox and sagas, how it tests, how active it is, and what the license says.

## Trade-offs

- **A broker decouples in time and adds a moving part.** Producers survive consumer outages, and you now operate, secure, monitor and pay for a server.
  ```csharp
  await publish.Publish(new OrderSubmitted(id, total)); // returns when the broker has the message, not when anyone handled it
  ```
  The caller cannot assume the work happened, so the user experience must tolerate "accepted, not done".
- **An abstraction over brokers hides real differences.** `ConfigureEndpoints` makes RabbitMQ and Service Bus look alike, and ordering, sessions, delay, dead-lettering and limits still differ. Test against the real broker before production, since the in-memory transport cannot show those differences.
- **In-memory tests are fast and prove the wiring, not the broker.** They verify consumers, retry, faults and idempotency. They do not verify permissions, topology creation, network failure or real redelivery timing.
- **Retry hides poison messages until it does not.** Three immediate retries clear a blip and waste time on a bug. Separate transient from permanent errors, and watch the fault and `_error` queues, because a dead-letter without an owner is silent loss.
- **Events versus commands is a design choice, not a verb choice.** Publishing a command to unknown subscribers or sending an event to one queue both work and both rot as the system grows.
- **The consumer outbox is not the transactional outbox.** The in-memory outbox only delays publishes until success. Atomicity with a database needs the EF outbox or the hand-written version from the previous concept.
- **The library license is part of the architecture.** The same package name moved from Apache-2.0 to commercial between major versions. Pin versions, record the license in the decision, and have an exit path.

## Lab

In this lab you receive a MassTransit setup with the in-memory transport and an `OrderApi`, a billing consumer, a fault consumer and a consumer definition left with TODOs, plus contracts, a ledger, a shipping consumer, an audit consumer and 8 tests that run on the MassTransit test harness. MassTransit is pinned to 8.5.12, the last Apache-2.0 release. You implement publish and send, the consumer, the inbox check, retry, the fault handler and the outbox.

**The scenario**

Submitting an order publishes an event that Billing and Audit consume, shipping is a command to its own queue, and every failure mode must end in a visible state.

- `Contracts.cs`, `Ledger.cs`, `Setup.cs` shell, `ShippingConsumer`, `AuditConsumer` (ready).
- `OrderApi.cs`: publish and send.
- `Consumers.cs`: `BillingConsumer` and `BillingFaultConsumer`.
- `Setup.cs`: `BillingConsumerDefinition` (retry and outbox).

**What you will do, step by step**

1. **Charge and publish (TODO-00).** Reject a negative total, record the charge, publish `PaymentCaptured`.
2. **Publish the event (TODO-01).** `Publish` with an optional fixed `MessageId`.
3. **Send the command (TODO-02).** `GetSendEndpoint("queue:shipping")` and `Send`.
4. **Inbox (TODO-03).** Skip a processed `MessageId`, mark it last.
5. **Retry (TODO-04).** Three retries, 10 ms apart.
6. **Fault handler (TODO-05).** Record the order from `Fault<OrderSubmitted>`.
7. **Outbox (TODO-06).** `UseInMemoryOutbox` after the retry.

**How you know you are done**

`dotnet test` is green, 8 of 8. Be able to explain why `Consumed.Any` is not proof that a retried message finished, and why the inbox mark is the last line of the consumer.

**Optional challenges**

- Remove `UseInMemoryOutbox`. How many `PaymentCaptured` were published?
- Remove the inbox check. Which test fails?
- Swap `UsingInMemory` for `UsingRabbitMq` without running it. What must exist at runtime that the test never needed?

**Prerequisites:** `IConsumer<T>`, dependency injection, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The starter compiles and all 8 tests fail until you do the TODOs.

## Documentation Links

- [MassTransit documentation](https://masstransit.massient.com/) (doc)
- [MassTransit v9 license, Massient](https://massient.com/license) (doc)
- [MassTransit 8.5.12, NuGet (Apache-2.0)](https://www.nuget.org/packages/MassTransit/8.5.12) (doc)
- [Azure Service Bus queues, topics and subscriptions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions) (doc)
- [Service Bus dead-letter queues, Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) (doc)
- [RabbitMQ tutorials and concepts](https://www.rabbitmq.com/tutorials) (doc)
- [Wolverine, Jasper Fx](https://github.com/jasperfx/wolverine) (doc)
- [Rebus](https://rebus.fm/what-is-rebus/) (doc)
