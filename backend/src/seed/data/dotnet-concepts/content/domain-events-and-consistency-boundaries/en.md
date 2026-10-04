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
saved or nothing is. Dispatching in `SavedChangesAsync` (after the commit) means
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

## Documentation Links

- [Domain events: design and implementation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation) (doc)
- [Interceptors, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors) (doc)
- [Design a microservice domain model, aggregates and consistency, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model) (doc)
- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
