---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

In a controller or a minimal API the `DbContext` lives for one request, so
injecting it is the obvious thing to do. In an interactive Blazor component the
same line of code binds the context to something else: the circuit. This concept
runs the same component three ways on SDK 10.0.100 with EF Core 10 and SQLite,
and shows what changes: a context that outlives every click, tracked entities
that keep returning old data, queries that run twice because of prerendering,
and what to do instead (`IDbContextFactory`, `[PersistentState]`, a service
behind an interface). It also covers why WebAssembly cannot use any of this.
The context lifetime rules in general are in DbContext Lifetime and Change
Tracking, the scoped lifetime in Dependency Injection and Service Lifetimes, and
`[StreamRendering]` in Blazor Static SSR and Enhanced Navigation.

## Use Cases

- Deciding how a component reads and writes the database without a stale or
  shared context.
- Finding out why a page shows old values after the database changed.
- Avoiding the second query that prerendering causes on every first load.
- Structuring data access so the same component can run on the server or in the
  browser.

## Deep Dive

### What "scoped" means in an interactive component

`AddDbContext` registers the context as scoped. In a request, the scope is the
request. In Interactive Server, the documentation states that the scoped instance
is shared across the components of the user's circuit, and a circuit lasts as
long as the user keeps the page open. A component with
`@inject ShopContext Db` and three buttons (load a product, change it from
another context, load again) printed this:

```text
context=24129389 tracked=0
click load      -> context=24129389 tracked=1   tracked read: Pen 1,0
click external  -> (another context sets Pen's price to 2)
click load      -> context=24129389 tracked=1   tracked read: Pen 1,0   <- stale
click no-track  -> no-tracking read: Pen 2,0
```

The hash code never changed across clicks, and the change tracker kept the `Pen`
entity. The second `load` returned the entity already in the tracker, so the
price from the database never reached the screen. That is correct EF Core
behavior (identity resolution) in the wrong lifetime: with a request-sized
context the tracker would have been empty. `AsNoTracking` returned the fresh
`2`, which is the symptom of the problem and a partial workaround.

The scoped context has a second problem, concurrency. A `DbContext` is not
thread safe, and in a circuit several components, timers and event handlers can
use the same instance. Eight overlapping queries on the shared context
(`Task.Run` to force the overlap, since SQLite's async methods complete
synchronously and rarely overlap on their own) failed every time:

```text
InvalidOperationException: A second operation was started on this context
instance before a previous operation completed. This is usually caused by
different threads concurrently using the same instance of DbContext.
```

The same eight queries, each with its own context, all succeeded.

### The factory

`AddDbContextFactory` registers `IDbContextFactory<T>`, a singleton that builds
a new context on demand. The documentation's first recommendation for Blazor is
one context per operation, because creating a context is cheap:

```csharp
builder.Services.AddDbContextFactory<ShopContext>(o => o.UseSqlite("Data Source=shop.db"));
```

```razor
@inject IDbContextFactory<ShopContext> Factory

@code {
    async Task Load()
    {
        await using var db = Factory.CreateDbContext();
        var p = await db.Products.FirstAsync(x => x.Id == 1);
        msg = $"read: {p.Name} {p.Price}";
    }
}
```

The run with the factory: `Pen 1`, then an external update, then `Pen 2` on the
next click (a different context hash each time), and the eight parallel queries
all completed. The cost is that the tracker no longer spans operations. For an
edit screen that does want change tracking across several steps, the
documentation suggests a context scoped to the component instead: create it in
`OnInitializedAsync` from the factory and dispose it in `Dispose`. That is a
deliberate unit of work, not an accident of the circuit scope, and it needs
the disposal hook from the component lifecycle concept.

Registering `AddScoped(sp => sp.GetRequiredService<IDbContextFactory<T>>().CreateDbContext())`
(as in the test app) keeps `@inject ShopContext` working for static SSR pages,
and the scope there is the request: two requests to a `[StreamRendering]` page
that injected the context directly showed two different context hashes, and the
page streamed `Loading...` first and `2 items` after the data was ready. Static
SSR is the one place where direct injection matches the intent.

### Prerendering runs the query twice

An interactive component prerenders by default, so `OnInitializedAsync` runs on
the server for the HTML and again when the circuit starts. With EF's command log
at `Information`, a component that loads through the factory logged this on one
browser load:

```text
[loader plain] queried, interactive=False
[loader plain] queried, interactive=True
```

Two round trips to the database for the same list. With .NET 10's declarative
persistence the second one disappears:

```csharp
[PersistentState] public List<Product>? Items { get; set; }

protected override async Task OnInitializedAsync()
{
    if (Items is not null) return;          // restored from the prerender
    await using var db = Factory.CreateDbContext();
    Items = await db.Products.AsNoTracking().ToListAsync();
}
```

```text
[loader persist] queried, interactive=False      (no second line)
```

The attribute goes on a public property, which the framework serializes into the
prerendered page with System.Text.Json and restores in the interactive instance.
The documentation notes that with `InteractiveServer` the data is protected with
Data Protection, while with WebAssembly or Auto it is exposed to the browser, so
it must not hold anything private. Two options matter for data access:
`AllowUpdates = true` lets read-only, rarely changing data be refreshed after an
enhanced navigation, and `RestoreBehavior = RestoreBehavior.SkipLastSnapshot`
skips the snapshot on reconnection when you want fresh data. Both are in the
.NET 10 article on prerendered state persistence. When a page is reached by
enhanced navigation inside an already interactive app there is no prerender, so
the double query shows up only on a full load.

### WebAssembly cannot call the database

A component that runs in the browser cannot use any of this: the documentation
says WebAssembly runs in a sandbox that prevents most direct database
connections, and a connection string in client code would be exposed anyway. The
component needs an API. The shape that keeps one component working in both
places is an interface, with one implementation per side:

```csharp
public interface IProductService { Task<List<Product>> ListAsync(CancellationToken ct = default); }

public sealed class DbProductService(IDbContextFactory<ShopContext> factory) : IProductService
{
    public async Task<List<Product>> ListAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Products.AsNoTracking().OrderBy(p => p.Name).ToListAsync(ct);
    }
}

public sealed class HttpProductService(HttpClient http) : IProductService
{
    public async Task<List<Product>> ListAsync(CancellationToken ct = default)
        => await http.GetFromJsonAsync<List<Product>>("api/products", ct) ?? [];
}
```

The server registers `DbProductService` and exposes the same service through
`app.MapGet("/api/products", ...)`; in the run the endpoint returned the two
rows as JSON. The WebAssembly project registers `HttpProductService`. A
component that depends only on `IProductService` renders in static SSR,
Interactive Server and WebAssembly without a change, and the data access rules
live in one class. The client side, with the base address and CORS, is a
separate topic.

## Trade-offs

- **Direct injection is fine for static SSR and wrong for interactive modes.**
  The same `@inject ShopContext` is a per-request context in one and a
  circuit-long context in the other.
  ```razor
  @inject ShopContext Db   @* request-scoped on static pages, circuit-scoped when interactive *@
  ```
- **A factory fixes sharing and gives up the tracker between operations.** Each
  operation starts clean, which is right for reads and for most writes, but a
  multi-step edit needs a component-scoped context on purpose.
- **A context per component is a unit of work with a lifetime you own.** It
  tracks and detects concurrency conflicts across steps, and it holds a
  connection and memory for as long as the page is open, so dispose it.
- **`[PersistentState]` removes the duplicate query and adds payload.** The data
  is serialized into the HTML, which grows the response and, for WebAssembly and
  Auto, is visible to the browser.
- **An interface hides where the data comes from, and an HTTP implementation adds
  a hop.** The same component calls a service in-process on the server and a
  network call in the browser, so latency and failure modes differ by mode.
- **`AsNoTracking` is not a cure for a shared context.** It avoids stale entities
  but not the concurrency exception, which comes from sharing the instance.

## Documentation Links

- [ASP.NET Core Blazor with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core) (doc)
- [ASP.NET Core Blazor prerendered state persistence, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/prerendered-state-persistence) (doc)
- [ASP.NET Core Razor component rendering, streaming rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [Using a DbContext factory, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/#use-a-dbcontext-factory) (doc)
- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
