---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A rich domain model has private setters, a private constructor, value objects,
and collections hidden behind the root. EF Core can persist all of that without
turning the model into an anemic bag of public properties, but only if the
mapping is configured deliberately. This concept covers the mapping tools that
matter for DDD (owned types, complex types, value converters, backing fields
and private constructors) and the recurring question of whether to wrap the
`DbContext` in a repository at all.

## Use Cases

- Persisting a `Money` value object as two columns (`Amount`, `Currency`) on
  the order row, without a table of its own.
- Mapping `OrderId` and other strongly-typed IDs to a plain `uuid` column.
- Loading an `Order` through a private constructor and filling its private
  `_lines` list, without ever exposing a public setter.
- Choosing between `IOrderRepository` and injecting `OrdersDbContext` directly
  into a command handler.

## Deep Dive

### Owned types and complex types

Both map a value object into columns of the owner's table. They differ in
identity semantics. An owned type is still an entity internally: it has a
hidden key, is tracked by reference, and can sit in its own table or a JSON
column. A complex type (EF Core 8 and later) has no identity at all, is tracked
by value, and two properties can hold equal values without being "the same"
instance. That second behavior is closer to what a value object means:

```csharp
// Complex type: value semantics, no hidden key.
builder.ComplexProperty(o => o.Total, m =>
{
    m.Property(x => x.Amount).HasColumnName("total_amount").HasPrecision(18, 2);
    m.Property(x => x.Currency).HasColumnName("total_currency").HasMaxLength(3);
});

// Owned type: reference semantics, can be a collection with its own table.
builder.OwnsMany(o => o.Lines, l =>
{
    l.WithOwner().HasForeignKey("OrderId");
    l.Property<int>("Id");
    l.HasKey("Id");
    l.Property(x => x.Quantity);
});
```

EF Core 10 closed two gaps that used to push people toward owned types: complex
types can now be optional (a nullable `Address?`), and they can be mapped to a
single JSON column. An optional complex type must still declare at least one
required property, so EF Core can tell a `null` value from one whose properties
are all `null`.

Use a complex type for a single value object that is only ever replaced whole
(`Money`, `Address`). Use an owned type, or a real entity, when the part has a
lifecycle of its own, such as order lines that are added and removed over time.

### Value converters

When the value object wraps a single value, a converter maps it to one column.
This is how strongly-typed IDs, enums stored as strings, and simple wrappers are
persisted:

```csharp
builder.Property(o => o.Id)
    .HasConversion(id => id.Value, value => new OrderId(value))
    .ValueGeneratedNever(); // the domain creates the id, not the database

builder.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
```

`ValueGeneratedNever()` matters: by convention EF Core treats a `Guid` key as
generated on add, and uses a non-default key to decide whether a disconnected
entity is new or already stored. Declaring that the domain owns the key removes
that guessing.

### Private constructors and backing fields

EF Core materializes an entity through any constructor it can bind, including a
private parameterless one, and then sets properties even when the setter is
private. For collections, tell it to use the field so the root's public
`IReadOnlyList` never has to be writable:

```csharp
builder.Navigation(o => o.Lines)
    .HasField("_lines")
    .UsePropertyAccessMode(PropertyAccessMode.Field);
```

By convention EF Core already finds `_lines` for a `Lines` property, but being
explicit documents the intent and survives a rename of either name.

### Repository or DbContext?

`DbContext` already implements the unit of work and acts as a repository per
aggregate (`db.Orders`). A repository on top of it earns its place only when it
does something the context does not:

```csharp
// Worth it: it loads the whole aggregate and hides the Include chain.
public interface IOrderRepository
{
    Task<Order?> GetAsync(OrderId id, CancellationToken ct);
    void Add(Order order);
}

internal sealed class OrderRepository(OrdersDbContext db) : IOrderRepository
{
    public Task<Order?> GetAsync(OrderId id, CancellationToken ct) =>
        db.Orders.Include(o => o.Lines).SingleOrDefaultAsync(o => o.Id == id, ct);

    public void Add(Order order) => db.Orders.Add(order);
}
```

For writes, a small repository per aggregate root keeps "always load the whole
aggregate" in one place. For reads (lists, search, reports), skip it and query
the `DbContext` with projections straight into DTOs, because a repository that
returns aggregates is the wrong shape for a read model.

## Trade-offs

- **Owned types hide an identity you did not model.** An `OwnsMany` collection
  gets a shadow key, and replacing the whole collection produces deletes and
  inserts for every item instead of updates.
  ```csharp
  order.ReplaceLines(newLines); // delete all old rows, insert all new rows
  ```
  If the rows have meaning of their own (audit, links from other tables), model
  them as entities.
- **Complex types cannot be queried or tracked like entities.** There is no
  `DbSet<Money>`, no foreign key to one, and a complex type used as a value
  object is best kept immutable, so changing it means assigning a new value
  (EF Core still tracks changes per property).
  ```csharp
  order.Total = order.Total with { Amount = 20m }; // ok: replace the value
  order.Total.Amount = 20m;                        // does not compile: Money has no setters
  ```
- **Converters can defeat query translation.** A value converter that calls
  arbitrary code cannot always be translated to SQL, so comparing a converted
  property in a `Where` may fail or force client evaluation.
  ```csharp
  db.Orders.Where(o => o.Id == id)     // fine, the converter applies to the parameter
  db.Orders.Where(o => o.Id.Value == x) // may fail: Value is not a mapped property
  ```
- **A generic repository hides the thing you need.** `IRepository<T>` with
  `GetAll()` returning `IQueryable<T>` leaks the ORM, and one that returns
  `IEnumerable<T>` loads the whole table. A specific repository per aggregate
  root is smaller and honest about what it loads.
- **Private mapping is invisible to the compiler.** Rename `_lines` and EF Core
  silently falls back to another access mode or fails at startup, so cover the
  mapping with a test that saves and reloads an aggregate.

## Documentation Links

- [Owned entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/owned-entities) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#value-objects-using-complex-types) (doc)
- [What is new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Value conversions, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/value-conversions) (doc)
- [Backing fields, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/backing-field) (doc)
- [Implement the infrastructure persistence layer with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-implementation-entity-framework-core) (doc)
