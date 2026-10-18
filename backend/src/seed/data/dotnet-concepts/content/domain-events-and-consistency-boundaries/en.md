---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A domain event records something that happened inside an aggregate, named in
the language of the business: `OrderPlaced`, `PaymentCaptured`. Raising events
from the aggregate keeps the rule "when X happens, Y must follow" out of the
code that triggered X. The harder question is when the reactions run. Inside
the same transaction they share its atomicity and its failures. After the
commit they are eventually consistent and need a delivery guarantee. Choosing
between the two is a decision about consistency boundaries, and the aggregate
is the boundary.

## Use Cases

- Placing an order must reserve stock, but Orders should not know how
  inventory works (a domain event handled in the same transaction or after it).
- A price change must reach Search and Notifications in other modules (a domain
  event translated into an integration event).
- Updating a read model or sending an email only if the order was really
  committed.
- Explaining to a product owner why the customer's loyalty points appear a few
  seconds after the order, not in the same instant.

## Deep Dive

### Raise events from the aggregate

The aggregate records events in a list instead of publishing them. It does not
know about handlers, a bus, or the database:

```csharp
public abstract class AggregateRoot
{
    private readonly List<IDomainEvent> _events = [];
    public IReadOnlyList<IDomainEvent> DomainEvents => _events;
    protected void Raise(IDomainEvent e) => _events.Add(e);
    public void ClearDomainEvents() => _events.Clear();
}

public sealed record OrderPlaced(OrderId OrderId, CustomerId CustomerId, DateTimeOffset At) : IDomainEvent;

// Inside Order.Place(...), after the invariants pass:
order.Raise(new OrderPlaced(order.Id, customerId, clock.GetUtcNow()));
```

The event is a fact in the past tense, immutable, and carries ids and the values
the handlers need, not live entities.

### Dispatch from a SaveChanges interceptor

An EF Core `SaveChangesInterceptor` sees every save, so the application code
never has to remember to publish. The tracker already knows which aggregates
changed, so collect their events there:

```csharp
internal sealed class DomainEventsInterceptor(IDomainEventDispatcher dispatcher) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
    {
        if (data.Context is null) return result;

        var aggregates = data.Context.ChangeTracker.Entries<AggregateRoot>()
            .Select(e => e.Entity)
            .Where(a => a.DomainEvents.Count > 0)
            .ToList();

        var events = aggregates.SelectMany(a => a.DomainEvents).ToList();
        aggregates.ForEach(a => a.ClearDomainEvents());

        foreach (var e in events)
            await dispatcher.DispatchAsync(e, ct); // runs before the commit, in the same unit of work

        return result;
    }
}
```

Dispatching in `SavingChangesAsync` (before the commit) means handlers that
write to the same `DbContext` land in the same transaction: either everything is
saved or nothing is. EF Core invokes the interceptor before it runs
`DetectChanges`, so entities that a handler adds or changes there are picked up
by the same save. Dispatching in `SavedChangesAsync` (after the commit) means
the data is already durable, but a crash between the commit and the dispatch
loses the event.

### Domain events vs integration events

A domain event is internal to the module and can carry rich types. An
integration event is a public contract between modules, so it is versioned and
carries only primitives. A handler in the owning module translates one into the
other, and the translation writes to the outbox in the same transaction:

```csharp
internal sealed class OrderPlacedHandler(OrdersDbContext db) : IDomainEventHandler<OrderPlaced>
{
    public Task HandleAsync(OrderPlaced e, CancellationToken ct)
    {
        db.OutboxMessages.Add(OutboxMessage.From(
            new OrderPlacedIntegrationEvent(e.OrderId.Value, e.CustomerId.Value, e.At)));
        return Task.CompletedTask; // saved together with the order by the surrounding SaveChanges
    }
}
```

Because the outbox row is saved with the order, the integration event exists if
and only if the order does. The dispatcher that reads the outbox is covered in
the Module Communication and Architecture Tests concept.

### One aggregate per transaction

The rule behind all of this: a transaction changes one aggregate. When a
business operation needs to change two (placing an order also awards points to
the customer), the second change happens in a separate transaction, triggered
by an event. That makes the system eventually consistent between aggregates,
and the design question becomes "how long can this stay out of sync, and what
does the user see in the meantime?".

```csharp
// Handled in its own transaction, after OrderPlaced was committed and delivered.
public async Task HandleAsync(OrderPlacedIntegrationEvent e, CancellationToken ct)
{
    var customer = await db.Customers.FindAsync([new CustomerId(e.CustomerId)], ct);
    customer!.RegisterOrder(new OrderId(e.OrderId));
    await db.SaveChangesAsync(ct);
}
```

## Trade-offs

- **In-transaction handlers couple failures.** A handler that throws rolls back
  the order, so a bug in loyalty points can block checkout.
  ```csharp
  await dispatcher.DispatchAsync(e, ct); // throws -> SaveChanges never commits the order
  ```
  Keep in-transaction handlers to work that truly belongs to the same
  consistency boundary, and move the rest behind the outbox.
- **After-commit dispatch can lose events.** Publishing in `SavedChangesAsync`
  without an outbox means a crash after the commit leaves the order saved and
  the event gone, with nothing to retry.
- **Handlers that call `SaveChanges` re-enter the interceptor.** A handler that
  saves inside `SavingChangesAsync` triggers the interceptor again, so events
  raised there are dispatched recursively.
  ```csharp
  // Safer: handlers only add to the context, and the single outer SaveChanges commits all.
  db.OutboxMessages.Add(message); // no SaveChanges here
  ```
- **Eventual consistency leaks into the user interface.** After the order is
  placed, the points balance can lag, so screens either read from the source of
  truth for that moment or accept and communicate the delay.
- **Events can become the hidden call graph.** With many handlers per event, the
  flow of a use case is scattered across files and hard to follow in a debugger.
  Keep the number of reactions per event small and named after what they do.

## Lab

In this lab you raise domain events from an aggregate, dispatch them from an EF Core `SaveChanges` interceptor in the same transaction, translate them into an outbox row, and consume the integration event in a separate transaction, idempotently. You receive the `DbContext`, the dispatcher and the event types ready, but the business logic is empty: the order raises nothing, the interceptor dispatches nothing, and the handler and the consumer throw `NotImplementedException`. The core idea is the consistency boundary: what must be atomic with the order goes in the same transaction, and what lives in another aggregate happens afterwards, in its own transaction.

**The scenario**

When an `Order` is placed, two things must follow: an integration event for other modules and loyalty points for the customer. The two live in different aggregates, so they cannot share a transaction.

The flow is:

- `Order.Place`: raises OrderPlaced (the aggregate only records it)
- `Interceptor`: before the commit, dispatches the events of tracked aggregates
- `OrderPlacedHandler`: same transaction: adds an OutboxMessage next to the order
- `LoyaltyConsumer`: own transaction, after the commit: awards points to the Customer

- `Model.cs`: `Order.Place` (to implement) and `Customer` with `AwardPoints`.
- `Events.cs` (ready): `AggregateRoot`, `OrderPlaced`, `OrderPlacedIntegrationEvent`, `OutboxMessage` and `ProcessedMessage` (the inbox).
- `Dispatching.cs`: `DomainEventDispatcher` (ready) and `DomainEventsInterceptor` (to implement).
- `Handlers.cs`: `OrderPlacedHandler` and `LoyaltyConsumer` (to implement).

The tests use in-memory SQLite and open several contexts on the same connection, so you can see what was really committed.

**What you will do, step by step**

1. **Raise the event (TODO-00).** In `Order.Place`, reject a total less than or equal to zero with `ArgumentOutOfRangeException`. Otherwise build the order (`Guid.CreateVersion7()`) and `Raise` an `OrderPlaced`, using `clock.GetUtcNow()`. The aggregate only records, it never publishes.
2. **Dispatch before the commit (TODO-01).** In `SavingChangesAsync`, collect the events of every tracked `AggregateRoot` (`ChangeTracker.Entries<AggregateRoot>()`), clear them first (otherwise a second `SaveChanges` dispatches again) and call `dispatcher.DispatchAsync` for each one.
3. **Write the outbox (TODO-02).** In `OrderPlacedHandler`, translate the event into an `OrderPlacedIntegrationEvent` (one new `Guid` used as both the `MessageId` and the row id) and add an `OutboxMessage` to `db.OutboxMessages`, without calling `SaveChanges`: the outer `SaveChanges` commits the order and the row together.
4. **Consume once (TODO-03).** In `LoyaltyConsumer`, open a context with `newContext()`, award the points to the customer (create it if missing) and record a `ProcessedMessage(e.MessageId, Name)` in the same transaction. If it is already there, skip the message.

**How you know you are done**

`dotnet test` is green. Pay attention to the three tests that check what is NOT in the database after a failure or a duplicate delivery. You should be able to explain why a handler that throws rolls back the order, why there is never an outbox row without an order, and why the same message delivered twice awards points only once.

**Optional challenges**

- **TODO-04:** move the dispatch to `SavedChangesAsync` (after the commit). Which test fails, and which failure would you never see in tests (a crash between the commit and the dispatch)?
- **TODO-05:** make `OrderPlacedHandler` call `db.SaveChangesAsync()`. What happens to the events, and why does the interceptor need to clear them first?
- **TODO-06:** register the `Exploding` handler only for `OrderPlaced`, then move the loyalty work into an in-transaction handler. What does a loyalty outage do to checkout now?

**Prerequisites:** aggregates and basic EF Core, `SaveChangesInterceptor` and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Each place to fill in throws `NotImplementedException` with a `TODO-NN` comment explaining the step, so the red tests are your checklist.

## Documentation Links

- [Domain events: design and implementation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Design a microservice domain model, aggregates and consistency, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model) (doc)
- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
