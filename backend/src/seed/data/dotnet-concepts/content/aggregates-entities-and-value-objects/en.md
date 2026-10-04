---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Domain-driven design gives a module's model three building blocks. An entity
has an identity that survives changes. A value object has no identity and is
defined entirely by its values. An aggregate is a cluster of entities and value
objects with one root, and the root is the only door in: every change goes
through it, so it can enforce the invariants that must always hold. In C# these
map onto records, private setters, and encapsulated collections, which makes
invalid states hard to write instead of merely discouraged.

## Use Cases

- An `Order` that must never be placed with zero lines or a negative total,
  no matter which endpoint, job, or test builds it.
- A `Money` value that carries an amount and a currency together, so adding
  euros to dollars is a compile-time or runtime error instead of a wrong total.
- Keeping `CustomerId` and `OrderId` distinct types so a method that takes both
  cannot be called with the arguments swapped.
- Deciding what belongs inside one aggregate (an order and its lines) and what
  only holds a reference by id (the customer who placed it).

## Deep Dive

### Value objects as records

A record gives value equality, immutability with `init`, and non-destructive
copying with `with`. Put validation in the constructor so no invalid instance
exists:

```csharp
public sealed record Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (currency.Length != 3) throw new ArgumentException("ISO 4217 code expected.", nameof(currency));
        (Amount, Currency) = (amount, currency.ToUpperInvariant());
    }

    public Money Add(Money other) =>
        other.Currency == Currency
            ? new Money(Amount + other.Amount, Currency)
            : throw new InvalidOperationException("Currency mismatch.");
}
```

Two `Money(10, "EUR")` instances are equal because record equality compares
every property. A `record struct` avoids an allocation for small values, at the
cost of a default value (`default(Money)`) that skips the constructor and its
validation.

### Strongly-typed IDs

A `Guid` or `int` for every identifier lets the compiler accept
`Ship(customerId, orderId)` when the signature is `Ship(OrderId, CustomerId)`.
A one-line `record struct` makes them different types for free:

```csharp
public readonly record struct OrderId(Guid Value)
{
    public static OrderId New() => new(Guid.NewGuid());
}

public readonly record struct CustomerId(Guid Value);

// Ship(CustomerId, OrderId) no longer compiles when called as Ship(orderId, customerId).
```

The cost shows up at the edges: JSON serialization, route binding, and EF Core
all need to know how to turn the wrapper into its inner value (a value
converter for EF Core, a `JsonConverter` or `TypeConverter` for the web layer).

### The aggregate root guards the invariants

Entities expose behavior, not setters. The constructor is private or protected
so the only way to create an order is a factory that checks the rules, and the
collection of lines is exposed read-only so nobody can add to it behind the
root's back:

```csharp
public sealed class Order
{
    private readonly List<OrderLine> _lines = [];

    private Order() { } // for EF Core

    public OrderId Id { get; private set; }
    public CustomerId CustomerId { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines;
    public OrderStatus Status { get; private set; }

    public static Order Place(CustomerId customerId, IEnumerable<(ProductId Product, int Quantity, Money Price)> items)
    {
        var order = new Order { Id = OrderId.New(), CustomerId = customerId, Status = OrderStatus.Placed };
        foreach (var (product, quantity, price) in items)
            order.AddLine(product, quantity, price);
        if (order._lines.Count == 0)
            throw new DomainException("An order needs at least one line.");
        return order;
    }

    public void AddLine(ProductId product, int quantity, Money price)
    {
        if (Status != OrderStatus.Placed) throw new DomainException("Order is closed.");
        if (quantity <= 0) throw new DomainException("Quantity must be positive.");
        _lines.Add(new OrderLine(product, quantity, price));
    }
}
```

`IReadOnlyList<OrderLine>` only hides the mutating methods from the type, so a
caller can still cast it back to `List<OrderLine>`. For a hard guarantee, return
`_lines.AsReadOnly()`, which wraps the list in a read-only view.

### Where the aggregate ends

Reference other aggregates by id, never by object. `Order` holds a
`CustomerId`, not a `Customer`. That keeps each aggregate small enough to load
and save as one unit, and it matches the transaction boundary: one aggregate
per transaction, with eventual consistency between aggregates (see the
Domain Events and Consistency Boundaries concept).

## Trade-offs

- **Strongly-typed IDs add ceremony everywhere the ID crosses a boundary.**
  Every serializer, model binder, and ORM mapping needs to know about them, and
  forgetting one produces a runtime error, not a compile error.
  ```csharp
  // Without a converter, EF Core cannot map OrderId and fails at model build time.
  builder.Property(o => o.Id).HasConversion(id => id.Value, value => new OrderId(value));
  ```
- **A `record struct` value object can be created in an invalid state.**
  `default(Money)` has a null `Currency` and never ran the constructor, and
  arrays or `new Money[3]` are full of them.
  ```csharp
  Money zero = default;   // Amount 0, Currency null
  zero.Add(new Money(5, "EUR")); // "Currency mismatch", because null != "EUR"
  ```
  Use a sealed `record` class when invalid defaults are a real risk.
- **Rich aggregates fight with generic CRUD.** An aggregate that exposes
  behavior and hides setters does not fit a "map this DTO onto the entity"
  workflow, so simple screens may be easier to write as plain queries and
  commands that skip the domain model.
- **Large aggregates become a concurrency bottleneck.** If `Order` also
  contains every shipment and every payment attempt, two users touching
  unrelated parts conflict on the same row version. Split the aggregate when
  concurrent edits to different parts are normal.
- **Exposing a read-only interface is not immutability.** An
  `IReadOnlyList<T>` still points at the same mutable list, so a cast breaks
  the guarantee. Treat it as a signal of intent, not a security boundary.

## Documentation Links

- [Domain model design, Microsoft Learn (.NET microservices architecture)](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model) (doc)
- [Implement value objects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/implement-value-objects) (doc)
- [Records, C# reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Design the microservice domain model, aggregates and root entities, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice) (doc)
