---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A `DbContext` is a unit of work: it tracks the entities you load, notices what
changed, and writes the difference on `SaveChanges`. Most EF Core bugs that
look random come from misunderstanding two things about it. First, how long an
instance lives and who shares it, because it is not thread-safe and it
accumulates every entity it has seen. Second, what the change tracker does with
each entity, because that decides what SQL is sent, what memory is held, and
whether a query returns the object you already modified.

## Use Cases

- Registering `OrdersDbContext` in an ASP.NET Core app so each request gets its
  own instance and never shares it with another request.
- Using a `DbContext` from a `BackgroundService` or a Blazor Server component,
  where there is no request scope to borrow.
- Making a read-only list endpoint cheaper by not tracking what it loads.
- Understanding why a second query for the same row returns the instance you
  already changed, not what is in the database.

## Deep Dive

### One context per unit of work

`AddDbContext` registers the context as scoped, so in a web app that means one
instance per request. That matches the unit-of-work idea: load, change, save,
dispose. A `DbContext` is not thread-safe, so running two queries on the same
instance at once throws:

```csharp
// Wrong: two operations on one context at the same time.
var a = db.Orders.ToListAsync(ct);
var b = db.Customers.ToListAsync(ct);
await Task.WhenAll(a, b); // InvalidOperationException: A second operation started on this context before a previous operation completed

// Right: await each one, or give each task its own context from a factory.
var orders = await db.Orders.ToListAsync(ct);
var customers = await db.Customers.ToListAsync(ct);
```

### Pooling and factories

`AddDbContextPool` keeps a pool of instances and resets their state between
uses, which removes the cost of building one per request. The price is a
rule: a pooled context must not hold per-request state in its own fields,
because the instance outlives the request. For code that has no scope, inject
`IDbContextFactory<T>` and create a short-lived context where you need it:

```csharp
builder.Services.AddDbContextPool<OrdersDbContext>(o =>
    o.UseNpgsql(connectionString));
builder.Services.AddPooledDbContextFactory<ReportsDbContext>(o =>
    o.UseNpgsql(connectionString));

internal sealed class NightlyJob(IDbContextFactory<ReportsDbContext> factory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct); // new context per run
        // ... query and save
    }
}
```

A `BackgroundService` is a singleton, so injecting a scoped `DbContext` into it
fails at startup, or worse, captures one instance for the lifetime of the app.

### What the change tracker records

Every tracked entity has a state: `Detached`, `Unchanged`, `Added`, `Modified`,
or `Deleted`. A query that returns entities starts them as `Unchanged` and
keeps a snapshot of their values. On `SaveChanges`, EF Core compares each
entity with its snapshot (`DetectChanges`), and only the properties that
differ go into the `UPDATE`:

```csharp
var order = await db.Orders.SingleAsync(o => o.Id == id, ct);
order.Rename("Rush order");        // Modified, only the changed column is written
await db.SaveChangesAsync(ct);     // UPDATE orders SET name = @p0 WHERE id = @p1

var state = db.Entry(order).State; // Unchanged again after the save
```

The tracker also gives identity resolution: asking for the same key twice
returns the same instance, and the second query does not overwrite what you
already changed in memory.

### Stop tracking when you only read

Tracking costs memory and CPU, because every entity gets a snapshot. For a
read-only query, `AsNoTracking` skips it, and a projection into a DTO skips
entities entirely:

```csharp
var rows = await db.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == customerId)
    .Select(o => new OrderRow(o.Id.Value, o.Status, o.Total.Amount))
    .ToListAsync(ct);
```

For long-lived contexts, such as a batch import that loads thousands of rows,
call `db.ChangeTracker.Clear()` between batches so the tracker does not keep
every entity until the end.

## Trade-offs

- **Pooling reuses instances, so leaked state leaks across requests.** A field
  set on the context in one request can be visible in the next.
  ```csharp
  public sealed class OrdersDbContext : DbContext
  {
      public Guid CurrentTenant { get; set; } // dangerous in a pooled context
  }
  // Resolve the tenant from a scoped service inside the query filter instead.
  ```
- **`AsNoTracking` queries return disconnected entities.** Changing them and
  calling `SaveChanges` writes nothing, because the context never saw them.
  ```csharp
  var o = await db.Orders.AsNoTracking().SingleAsync(x => x.Id == id, ct);
  o.Rename("X");
  await db.SaveChangesAsync(ct); // 0 rows affected, no error
  ```
- **No-tracking queries lose identity resolution.** Two rows that point at the
  same customer produce two separate `Customer` objects unless you use
  `AsNoTrackingWithIdentityResolution`, which costs part of the saving.
- **A long-lived context grows without bound and goes stale.** Keeping one
  context for a whole session of a desktop or Blazor Server app holds every
  entity it ever loaded and shows data that other users changed since.
- **`DetectChanges` is linear in the number of tracked entities.** Tracking
  tens of thousands of entities makes every `SaveChanges` slow, which is another
  reason to batch and clear instead of loading everything at once.

## Documentation Links

- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
- [Advanced performance topics, DbContext pooling, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics) (doc)
- [Change tracking in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/change-tracking/) (doc)
- [Tracking vs. no-tracking queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tracking) (doc)
