---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Once modules have boundaries, they still need to talk to each other. A modular
monolith uses two styles: synchronous queries through a module's public
contract, for when the caller needs an answer right now, and asynchronous
integration events, for announcing that something happened without knowing who
cares. The transactional outbox keeps those events consistent with the
database, and architecture tests turn the dependency rules into a failing build
instead of a convention people forget. Together they decide whether the module
split survives its first year.

## Use Cases

- Orders needs the current product names and prices from Catalog while building
  a checkout response (a synchronous query).
- Catalog changes a price and Orders, Search, and Notifications each need to
  react, without Catalog knowing any of them exist (an integration event).
- Guaranteeing that an event is published if and only if the change that caused
  it was committed (the outbox).
- Failing CI when someone adds a reference from `Orders.Core` to `Catalog.Core`,
  or makes an internal type `public` "just for now" (architecture tests).

## Deep Dive

### Synchronous queries through contracts

When the caller cannot continue without the answer, call the other module's
contract. Keep these calls coarse-grained and batch-friendly, so a list page
makes one call with many ids instead of one call per row:

```csharp
// Catalog.Contracts
public interface ICatalogModule
{
    Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(
        Guid[] productIds, CancellationToken ct);
}

// Catalog.Core
internal sealed class CatalogModuleApi(CatalogDbContext db) : ICatalogModule
{
    public async Task<IReadOnlyDictionary<Guid, string>> GetProductNamesAsync(
        Guid[] productIds, CancellationToken ct) =>
        await db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name, ct);
}
```

A useful rule of thumb: synchronous *queries* across modules are fine;
synchronous *commands* (Orders telling Catalog to change its state inside the
same request) are a smell. They couple the two modules' failure modes and
usually mean one of them is reaching into a decision the other should own.

### Integration events with an in-process bus

An integration event is a fact, named in the past tense, defined in the
publisher's contracts project:

```csharp
namespace Catalog.Contracts;

public sealed record ProductPriceChanged(
    Guid ProductId, decimal NewPrice, DateTimeOffset OccurredAt);
```

Subscribers reference `Catalog.Contracts` and implement a handler. The
dependency points from subscriber to publisher, so Catalog never learns that
Orders exists:

```csharp
// Shared.Kernel
public interface IIntegrationEventHandler<in TEvent>
{
    Task HandleAsync(TEvent @event, CancellationToken ct);
}

// Orders.Core
internal sealed class ProductPriceChangedHandler(OrdersDbContext db)
    : IIntegrationEventHandler<ProductPriceChanged>
{
    public Task HandleAsync(ProductPriceChanged e, CancellationToken ct) =>
        db.ProductPrices
            .Where(p => p.ProductId == e.ProductId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, e.NewPrice), ct);
}

// inside AddOrdersModule(...)
services.AddScoped<IIntegrationEventHandler<ProductPriceChanged>, ProductPriceChangedHandler>();
```

An in-process bus only has to find every registered handler for the event's
runtime type. Going through the public interface's `MethodInfo` (instead of
`dynamic`) matters here, because the handlers are `internal` types living in
other assemblies:

```csharp
public sealed class InProcessEventBus(IServiceScopeFactory scopes) : IEventBus
{
    public async Task PublishAsync(object @event, CancellationToken ct)
    {
        var handlerType = typeof(IIntegrationEventHandler<>).MakeGenericType(@event.GetType());
        var handle = handlerType.GetMethod("HandleAsync")!;

        await using var scope = scopes.CreateAsyncScope();
        foreach (var handler in scope.ServiceProvider.GetServices(handlerType))
        {
            await (Task)handle.Invoke(handler, [@event, ct])!;
        }
    }
}
```

This is roughly what libraries like MediatR do for in-process notifications.
Worth knowing before adopting one: MediatR moved to a dual license (RPL 1.5 or a
commercial license) with version 13 in July 2025, with older packages staying
under their original licenses
([announcement](https://www.jimmybogard.com/automapper-and-mediatr-commercial-editions-launch-today/)),
and MassTransit version 9 is a commercial release
([MassTransit v9](https://masstransit.massient.com/introduction/v9-announcement)),
so check the license terms; a bus this small is often all a modular monolith needs.

### The outbox: commit the event with the change

Publishing right after `SaveChangesAsync` has two failure windows. If the
process dies between the commit and the publish, the event is lost forever. If
you publish *before* committing and the commit then fails, subscribers have
reacted to a change that never happened. The transactional outbox closes both
windows by writing the event as a row in the same transaction as the change:

```csharp
internal sealed class OutboxMessage
{
    public Guid Id { get; init; }
    public required string Type { get; init; }
    public required string Payload { get; init; }
    public DateTimeOffset OccurredAt { get; init; }
    public DateTimeOffset? ProcessedAt { get; set; }

    public static OutboxMessage From(object @event) => new()
    {
        Id = Guid.CreateVersion7(),
        Type = @event.GetType().AssemblyQualifiedName!,
        Payload = JsonSerializer.Serialize(@event, @event.GetType()),
        OccurredAt = DateTimeOffset.UtcNow,
    };
}

// In Catalog's use case: both rows commit, or neither does
product.ChangePrice(newPrice);
db.OutboxMessages.Add(OutboxMessage.From(
    new ProductPriceChanged(product.Id, newPrice, DateTimeOffset.UtcNow)));
await db.SaveChangesAsync(ct);
```

A background service then drains the table and publishes each message:

```csharp
internal sealed class CatalogOutboxDispatcher(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            var bus = scope.ServiceProvider.GetRequiredService<IEventBus>();

            var batch = await db.OutboxMessages
                .Where(m => m.ProcessedAt == null)
                .OrderBy(m => m.OccurredAt)
                .Take(50)
                .ToListAsync(stoppingToken);

            foreach (var message in batch)
            {
                var @event = JsonSerializer.Deserialize(message.Payload, Type.GetType(message.Type)!)!;
                await bus.PublishAsync(@event, stoppingToken);
                message.ProcessedAt = DateTimeOffset.UtcNow;
            }

            await db.SaveChangesAsync(stoppingToken);
        }
    }
}
```

If the process crashes after publishing but before saving `ProcessedAt`, the
message is published again on restart. That is the deal the outbox makes:
**at-least-once delivery**, so every handler must be idempotent. With more than
one instance of the application, two dispatchers will read the same rows unless
the query locks them (`FOR UPDATE SKIP LOCKED` in PostgreSQL) or only one
instance runs the dispatcher.

The payoff comes at extraction time. Swapping `InProcessEventBus` for a broker
publisher (RabbitMQ, Azure Service Bus, Kafka) changes the transport, not the
modules: the events, the outbox, and the idempotent handlers stay as they are.

### Architecture tests: the rules, as a failing build

Project references stop `Orders.Core` from *compiling* against `Catalog.Core`,
but nothing stops someone from adding the reference. Architecture tests catch
that, and the subtler rules the compiler cannot express. With
[NetArchTest](https://github.com/BenMorris/NetArchTest) in an xUnit project:

```csharp
public class ModuleBoundaryTests
{
    private static readonly Assembly Orders = typeof(OrdersModule).Assembly;

    [Fact]
    public void Orders_does_not_depend_on_other_modules_internals()
    {
        var result = Types.InAssembly(Orders)
            .ShouldNot()
            .HaveDependencyOnAny("Catalog.Core", "Billing.Core")
            .GetResult();

        Assert.True(result.IsSuccessful, Describe(result));
    }

    [Fact]
    public void Only_the_module_entry_point_is_public()
    {
        var result = Types.InAssembly(Orders)
            .That().DoNotHaveName(nameof(OrdersModule))
            .And().DoNotResideInNamespace("Orders.Core.Migrations")
            .Should().NotBePublic()
            .GetResult();

        Assert.True(result.IsSuccessful, Describe(result));
    }

    private static string Describe(TestResult result) =>
        string.Join(", ", result.FailingTypeNames ?? []);
}
```

The `Migrations` exclusion is there for a real reason: `dotnet ef migrations
add` generates `public partial class` migration types, and without the
exclusion the second test fails on generated code.
[ArchUnitNET](https://github.com/TNG/ArchUnitNET) covers the same ground with a
fluent rule API (dependency, naming, and layer rules) if the rules grow beyond
simple dependency checks.

### When a module should become a service

Extraction is worth it when a module needs something the monolith cannot give
it: independent scaling (a CPU-heavy pricing engine next to a light CRUD
module), a different deployment cadence, a separate team that is blocked by the
shared release train, or a different runtime. If the module already talks to
others only through contracts and outbox-backed events, extraction is mostly
mechanical: contract calls become HTTP or gRPC clients, and the in-process bus
becomes a broker.

## Trade-offs

- **Direct in-process publishing couples the publisher to every subscriber.**
  Without an outbox, a handler that throws fails the publisher's request, so a
  bug in Orders can stop Catalog from changing a price.
  ```csharp
  product.ChangePrice(newPrice);
  await db.SaveChangesAsync(ct);
  await bus.PublishAsync(new ProductPriceChanged(product.Id, newPrice, now), ct);
  // Orders' handler throws -> Catalog's endpoint returns 500,
  // even though the price change was already committed.
  ```
- **The outbox trades immediacy for reliability.** Subscribers see changes
  after the dispatcher's next tick, so the system is eventually consistent and
  users can briefly see a stale price in Orders. That lag has to be acceptable
  to the business, not just to the developers.
- **At-least-once delivery means duplicates and reordering.** A redelivered
  old event can overwrite a newer value unless the handler checks.
  ```csharp
  await db.ProductPrices
      .Where(p => p.ProductId == e.ProductId && p.UpdatedAt < e.OccurredAt)
      .ExecuteUpdateAsync(s => s
          .SetProperty(p => p.Price, e.NewPrice)
          .SetProperty(p => p.UpdatedAt, e.OccurredAt), ct);
  // An older event matches no rows and becomes a no-op.
  ```
- **Architecture tests only check what you encode, and string rules rot.** If
  `Catalog.Core` is renamed to `Products.Core`, the rule below keeps passing
  forever, because nothing depends on a namespace that no longer exists.
  ```csharp
  .ShouldNot().HaveDependencyOn("Catalog.Core") // vacuously true after a rename
  // Safer: derive it from a type, so a rename breaks compilation instead.
  .ShouldNot().HaveDependencyOn(typeof(CatalogModule).Namespace!)
  ```
- **Library or hand-rolled is a maintenance decision.** A library brings
  pipelines, retries, and broker integrations, along with licensing terms that
  can change under you. A hand-rolled bus is a few dozen lines you fully
  control, and also a few dozen lines nobody else maintains.

## Documentation Links

- [Implementing event-based communication between microservices (integration events), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/integration-event-based-microservice-communications) (doc)
- [Background tasks with hosted services, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) (doc)
- [NetArchTest, BenMorris](https://github.com/BenMorris/NetArchTest) (doc)
- [ArchUnitNET, TNG](https://github.com/TNG/ArchUnitNET) (doc)
