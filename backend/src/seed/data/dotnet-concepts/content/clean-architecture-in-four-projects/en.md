---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

Clean architecture, in its most common .NET form, splits one application into
four projects by technical role: `Domain`, `Application`, `Infrastructure`, and
`Api`. There is a single deployable, a single bounded area, and one rule: source
code dependencies point inward, so the business rules know nothing about EF Core
or HTTP. It is a simpler step than a modular monolith, because there are no
per-module contracts, schemas, or boundaries between business areas to maintain.
The goal is to know what belongs in each project, how project references enforce
the rule, how the pieces are wired together, and how each layer is tested on its
own.

## Use Cases

- Starting a new API where every kind of code (rules, use cases, persistence,
  HTTP) already has an obvious home.
- Testing business rules and use cases in milliseconds, with no database and no
  web server.
- Swapping SQLite for PostgreSQL, or one message broker for another, by touching
  one project.
- Giving a new team member a layout they have likely seen before, so they find
  things without a tour.

## Deep Dive

### Four projects and one rule

A multi-tenant API, where a tenant is identified by a subdomain
(`acme.example.com` belongs to tenant `acme`), is a small example:

```text
src/
  Tenancy.Domain          -> Tenant: identity and rules. References nothing.
  Tenancy.Application     -> use cases and the ports they need. References Domain.
  Tenancy.Infrastructure  -> EF Core, repository implementations. References Application.
  Tenancy.Api             -> HTTP, middleware, composition root. References Application and Infrastructure.
```

The rule is that an inner project never references an outer one. Domain
references no layer, Application references only Domain, and Infrastructure and
Api point inward. Project references are directional and the compiler enforces
them: nothing in `Tenancy.Application` can name a `DbContext`, because it has no
reference to EF Core.

The one part that looks backwards is persistence. Application needs to store
tenants, but it must not depend on the code that does. So Application declares
the interface it needs (a port), and Infrastructure implements it. The source
arrow points inward even though, at runtime, Application calls Infrastructure.

### Domain: rules and identity

The domain class owns what is valid. It has private setters and a constructor
that refuses invalid input, so no layer can create a bad tenant:

```csharp
public sealed partial class Tenant
{
    public Guid Id { get; private set; }
    public string Subdomain { get; private set; }

    public Tenant(string subdomain)
    {
        Id = Guid.CreateVersion7();
        Subdomain = Normalize(subdomain);
    }

    public void Rename(string subdomain) => Subdomain = Normalize(subdomain);
    // Normalize: trim, lower-case, then match ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ or throw
}
```

`Guid.CreateVersion7()` (since .NET 9) produces a time-ordered id, which is
friendlier to database indexes than a random version 4 one, and the entity
needs no key generator from the database. The project has no `PackageReference`
at all; if an EF Core or ASP.NET Core type appears here, the architecture is
already leaking.

### Application: use cases and ports

A use case is a class with one method. It receives plain values, calls the
domain, talks to ports, and returns a result that says what happened:

```csharp
public interface ITenantRepository
{
    Task<bool> ExistsAsync(string subdomain, CancellationToken ct);
    Task<Tenant?> FindBySubdomainAsync(string subdomain, CancellationToken ct);
    Task AddAsync(Tenant tenant, CancellationToken ct);
}

public sealed class CreateTenantHandler(ITenantRepository tenants)
{
    public async Task<CreateTenantResult> HandleAsync(string subdomain, CancellationToken ct)
    {
        Tenant tenant;
        try { tenant = new Tenant(subdomain); }
        catch (ArgumentException e) { return new(CreateTenantStatus.InvalidSubdomain, Error: e.Message); }

        if (await tenants.ExistsAsync(tenant.Subdomain, ct))
            return new(CreateTenantStatus.SubdomainTaken, Error: $"Subdomain '{tenant.Subdomain}' is already taken.");

        await tenants.AddAsync(tenant, ct);
        return new(CreateTenantStatus.Created, tenant);
    }
}
```

The handler returns `Created`, `InvalidSubdomain` or `SubdomainTaken`, not
`201`, `400` or `409`. Expected outcomes are values, not exceptions, and HTTP
stays out of the layer. Because the only thing it knows about storage is the
interface it declared, the handler is tested with a dictionary-backed fake and
no database. Each layer registers itself with one extension method
(`AddApplication`), so the Api does not list handlers one by one.

### Infrastructure: the details

Everything that talks to the outside world lives here. The EF mapping is a
configuration class, so the domain entity has no attributes:

```csharp
internal sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Subdomain).HasMaxLength(63).IsRequired();
        builder.HasIndex(t => t.Subdomain).IsUnique();
    }
}

internal sealed class TenantRepository(TenancyDbContext db) : ITenantRepository
{
    public Task<bool> ExistsAsync(string subdomain, CancellationToken ct) =>
        db.Tenants.AnyAsync(t => t.Subdomain == subdomain, ct);
    // ... AsNoTracking for reads, SaveChangesAsync in AddAsync
}
```

EF Core fills a `Tenant` through its constructor and private setters, so the
entity keeps its invariants. The unique index is the real guarantee: the
handler's `ExistsAsync` gives a friendly `409`, and the index closes the race
between two concurrent requests. Repository and configuration are `internal`;
the layer exposes only `AddInfrastructure(connectionString)`. Moving from SQLite
to PostgreSQL changes this project (the package and `UseNpgsql`) and nothing
else.

### Api: translate and compose

The outermost layer is the only one that knows HTTP and the only one that knows
every other layer. It turns results into status codes and returns DTOs, never
entities:

```csharp
group.MapPost("/", async (CreateTenantRequest request, CreateTenantHandler handler, CancellationToken ct) =>
{
    var result = await handler.HandleAsync(request.Subdomain, ct);
    return result.Status switch
    {
        CreateTenantStatus.Created => Results.Created($"/tenants/{result.Tenant!.Id}", new TenantDto(...)),
        CreateTenantStatus.SubdomainTaken => Results.Conflict(result.Error),
        _ => Results.BadRequest(result.Error),
    };
});
```

Resolving the current tenant from the host header is a middleware in this
layer that calls a `ResolveTenantHandler` and stores the answer in a scoped
`ITenantContext`. `Program.cs` is the composition root:
`AddApplication()`, `AddInfrastructure(connectionString)`, then the pipeline.

### Testing each layer, and the rule itself

- **Domain tests** need no setup: `new Tenant("ACME ")` and assert.
- **Application tests** use a fake `ITenantRepository`.
- **API tests** run the whole stack with `WebApplicationFactory` and a
  temporary SQLite file, once per scenario that crosses layers.
- **Dependency tests** read the compiled references and fail if an inner layer
  points outward:

```csharp
Assert.DoesNotContain(typeof(Tenant).Assembly.GetReferencedAssemblies().Select(a => a.Name!),
    name => name.StartsWith("Tenancy.") || name.StartsWith("Microsoft.EntityFrameworkCore"));
```

An unused project reference is not recorded in the assembly metadata, so this
test fires when code actually uses a type from the wrong layer, which is the
moment that matters.

### When this is enough, and when it is not

One bounded area, one team, and a domain that fits in a head: four projects are
enough, and there is little reason to go further. Signs of outgrowing it are a
second business area with its own data and rules, a `Domain` project where two
groups of classes never change together, and teams stepping on each other. At
that point each area becomes a module with its own contract, which is the
modular monolith, and a module may itself keep this four-layer shape inside.

## Trade-offs

- **Ceremony for simple operations.** A pure CRUD still passes through a
  controller, a handler, a repository, and an EF call. For a thin resource that
  is four files where one would do; layering pays off when there are rules to
  protect.
- **Layers by technical role make features cut across projects.** Adding "suspend
  a tenant" touches Domain, Application, Infrastructure, and Api. Vertical
  slices group by feature instead, at the cost of a less uniform layout.
- **A repository over EF Core is debatable.** `DbContext` is already a unit of
  work and repository. The port earns its keep when it states a domain question
  (`ExistsAsync`) and hides query shape, and becomes noise when it forwards
  `IQueryable` or mirrors every `DbSet` method.
  ```csharp
  IQueryable<Tenant> Query(); // leaks EF behavior into every caller
  ```
- **`Application` becomes the dumping ground.** Without discipline it collects
  helpers, DTOs, and "services" that do nothing but forward calls. Keep it to
  use cases and the ports they need.
- **The rule is enforced by reference, not by visibility.** Nothing stops a
  public class in `Api` from reaching an `Infrastructure` type; the compiler only
  guards the direction. Keep implementations `internal` and add dependency tests.
- **Result types versus exceptions is a style choice.** Returning a status keeps
  expected failures visible in the signature, but it adds a result type per use
  case. Exceptions are shorter and fine for truly exceptional cases.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [Architectural principles, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles) (doc)
- [Guid.CreateVersion7, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.guid.createversion7) (doc)
- [Creating and configuring a model, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/) (doc)
- [Clean Architecture, Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) (doc)
