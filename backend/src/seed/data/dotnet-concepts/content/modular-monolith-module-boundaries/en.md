---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A modular monolith is a single deployable .NET application that is split
internally into modules, each owning its own data and exposing a small public
surface to the others. It keeps the operational simplicity of one process (one
deploy, one log stream, in-process calls) while getting most of the decoupling
people usually reach for microservices to achieve. In .NET the boundary is
drawn with tools the compiler already enforces: separate projects (assemblies),
the `internal` access modifier, a thin contracts project per module, and a
registration method each module owns. The goal is that a module can be read,
tested, and eventually extracted without untangling the rest of the codebase.

## Use Cases

- Starting a product whose domain is still being discovered, where splitting
  into services now would freeze the wrong boundaries into network calls.
- Untangling an ASP.NET Core application where every controller can reach every
  `DbSet`, so a change in billing quietly breaks the catalog.
- Letting several teams work in one repository with the compiler, not a wiki
  page, telling them when they cross into someone else's module.
- Preparing a module for later extraction into its own service by making its
  dependencies explicit before a network sits in the middle of them.

## Deep Dive

### Solution layout: a module is a small group of projects

A common layout keeps a host project that only composes modules, and two
projects per module: a public contracts project and an implementation project
that keeps almost everything `internal`.

```text
src/
  Host/                      -> ASP.NET Core entry point, wires modules together
  Modules/
    Orders/
      Orders.Contracts/      -> public: DTOs, integration events, IOrdersModule
      Orders.Core/           -> domain, use cases, OrdersDbContext (internal)
    Catalog/
      Catalog.Contracts/
      Catalog.Core/
  Shared/
    Shared.Kernel/           -> tiny: Result type, clock abstraction, base event type
```

The dependency rules are what make this a modular monolith instead of a folder
structure:

- `Host` references every `*.Core` project, only to call its registration
  method.
- A module's `Core` may reference other modules' `Contracts`, never another
  module's `Core`.
- `Contracts` projects reference nothing except, at most, `Shared.Kernel`.

Project references are directional, so the compiler enforces the second rule
for you. If `Orders.Core.csproj` does not reference `Catalog.Core`, nothing in
Orders can name a Catalog repository or entity:

```xml
<!-- Modules/Orders/Orders.Core/Orders.Core.csproj -->
<ItemGroup>
  <ProjectReference Include="..\Orders.Contracts\Orders.Contracts.csproj" />
  <ProjectReference Include="..\..\Catalog\Catalog.Contracts\Catalog.Contracts.csproj" />
</ItemGroup>
```

Splitting a module further into `Domain`, `Application`, and `Infrastructure`
projects is a separate decision. Layering inside a module is optional; the
boundary *between* modules is the one that pays for itself.

### `internal` by default, `public` on purpose

Inside `Orders.Core`, everything is `internal` except the handful of types the
host needs to call. Typing `public` out of habit is the path of least
resistance, so this is a discipline to build (and later, to test for):

```csharp
namespace Orders.Core.Domain;

internal sealed class Order
{
    public Guid Id { get; private set; }
    public OrderStatus Status { get; private set; }
    // ...
}
```

The public face of the module lives in `Orders.Contracts`, and it speaks in
DTOs, never in entities:

```csharp
namespace Orders.Contracts;

public interface IOrdersModule
{
    Task<OrderSummaryDto?> GetSummaryAsync(Guid orderId, CancellationToken ct);
}

public sealed record OrderSummaryDto(Guid Id, string Status, decimal Total);
```

The implementation of `IOrdersModule` sits in `Orders.Core` and is `internal`.
A nice side effect of the project graph: a contract cannot leak an entity even
by accident, because `Orders.Contracts` does not reference `Orders.Core`, so
`Order` simply does not exist from its point of view.

Tests still need the internals. The SDK has an MSBuild item for that, so no
`AssemblyInfo.cs` is needed:

```xml
<!-- Orders.Core.csproj -->
<ItemGroup>
  <InternalsVisibleTo Include="Orders.Core.Tests" />
</ItemGroup>
```

### Each module registers itself

The host should not know which handlers, DbContexts, or options a module needs.
Each module exposes one extension method for services and one for endpoints
(the `Core` project needs `<FrameworkReference Include="Microsoft.AspNetCore.App" />`
to use the routing types):

```csharp
namespace Orders.Core;

public static class OrdersModule
{
    public static IServiceCollection AddOrdersModule(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<OrdersDbContext>(options =>
            options.UseNpgsql(
                configuration.GetConnectionString("Main"),
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "orders")));

        services.AddScoped<IOrdersModule, OrdersModuleApi>();
        services.AddScoped<PlaceOrderHandler>();
        return services;
    }

    public static IEndpointRouteBuilder MapOrdersEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/orders").WithTags("Orders");
        group.MapPost("/", PlaceOrderEndpoint.HandleAsync);
        group.MapGet("/{id:guid}", GetOrderEndpoint.HandleAsync);
        return app;
    }
}
```

`OrdersModuleApi`, `PlaceOrderHandler`, and the endpoint classes are all
`internal`; registering them from inside their own assembly is fine. The host
stays a short list of modules:

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddOrdersModule(builder.Configuration)
    .AddCatalogModule(builder.Configuration);

var app = builder.Build();

app.MapOrdersEndpoints();
app.MapCatalogEndpoints();

app.Run();
```

### Data ownership: one schema and one DbContext per module

A module owns its tables. The simplest way to make that visible is a database
schema per module and a `DbContext` that only knows that schema:

```csharp
internal sealed class OrdersDbContext(DbContextOptions<OrdersDbContext> options)
    : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("orders");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(OrdersDbContext).Assembly);
    }
}
```

Combined with the `MigrationsHistoryTable(..., "orders")` call during
registration, each module also gets its own migration history, so Orders and
Catalog can evolve their schemas independently.

The rule that follows is strict: no joins across modules and no reading another
module's tables. Here is the shortcut that a single, shared `AppDbContext`
makes possible:

```csharp
// Inside Orders, with one shared DbContext that maps every table
var lines = await db.OrderLines
    .Where(l => l.OrderId == orderId)
    .Join(db.Products, l => l.ProductId, p => p.Id,
          (l, p) => new { l.Quantity, p.Name })
    .ToListAsync(ct);
```

And the version that respects the boundary, asking Catalog through its contract:

```csharp
// OrdersDbContext only maps Orders tables; Catalog answers through ICatalogModule
var lines = await db.OrderLines
    .Where(l => l.OrderId == orderId)
    .ToListAsync(ct);

var names = await catalog.GetProductNamesAsync(
    lines.Select(l => l.ProductId).Distinct().ToArray(), ct);
```

Two queries instead of one is the price. When that price is too high on a hot
path, the usual answer is for Orders to keep a small local copy of the product
data it needs, updated from Catalog's events (covered in the next concept),
instead of reaching back into Catalog's schema.

### Where boundaries leak in practice

- **The shared kernel grows into a second monolith.** `Shared.Kernel` starts
  with a `Result` type and ends up holding entities "two modules both need".
  Keep it to things with no business meaning.
- **One `AppDbContext` for everything.** It is the single fastest way to undo
  the module split, because every module can query every table.
- **Contracts that mirror entities.** A DTO with the same twenty properties as
  the entity couples the consumer to the producer's internal model just as
  tightly as referencing the entity would.
- **Static helpers and singletons in `Shared`** that hold state from one module
  and get read by another, an invisible dependency the project graph cannot see.

## Trade-offs

- **The project count grows fast.** Two or three projects per module times a
  dozen modules is a large solution, with slower builds and more ceremony. A
  lighter variant is one project per module where the only `public` types are
  the contracts; the boundary still holds, but every consumer now references
  the whole module assembly and its package dependencies transitively.
- **`internal` is a compile-time fence, not a security boundary.** Reflection,
  `InternalsVisibleTo`, and a "temporary" friend assembly all walk straight
  through it, and the build stays green.
  ```csharp
  // Orders.Core/AssemblyInfo.cs, added "just to unblock the report"
  [assembly: InternalsVisibleTo("Reporting.Core")]
  // Reporting can now construct OrdersDbContext directly. The boundary is gone.
  ```
- **One physical database invites cross-module transactions.** Because all
  schemas live in the same database, it is technically possible to share one
  connection and one transaction between two modules' DbContexts. It works
  today and becomes a distributed transaction the day one module is extracted,
  so it is worth treating as forbidden from the start.
- **Boundaries erode quietly.** Nothing in the runtime complains when a new
  project reference crosses a module line. Without architecture tests in CI
  (next concept), the layout above degrades one reasonable-looking pull request
  at a time.
- **In-process calls hide distributed-system costs.** A call through
  `IOrdersModule` has no latency, no partial failure, and no versioning
  problem. Extraction adds all three at once, so a module whose callers depend
  on chatty synchronous calls is harder to extract than its clean project graph
  suggests.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [The internal keyword, C# reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/internal) (doc)
- [Friend assemblies (InternalsVisibleTo), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/friend) (doc)
- [Route groups in minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers#route-groups) (doc)
- [Modular Monolith with DDD, kgrzybek (reference implementation)](https://github.com/kgrzybek/modular-monolith-with-ddd) (doc)
