---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

Dependency injection (DI) means a class receives the objects it needs instead of
creating them. ASP.NET Core has a built-in container for it, and nearly
everything in the framework (logging, configuration, `DbContext`, your own
handlers) goes through it. The goal is to understand what the container does
for you, to choose the right lifetime (transient, scoped, singleton) for each
service, and to recognize the bugs that come from getting a lifetime wrong, in
particular a long-lived object holding a short-lived one.

## Use Cases

- Handing a `GameStoreContext` to an endpoint without the endpoint knowing how
  to build or configure it.
- Replacing a real implementation with a fake in a test, by registering a
  different type for the same interface.
- Sharing one object across everything that participates in a single HTTP
  request (a unit of work, a per-request correlation id).
- Running code at startup that needs a database context, where there is no
  request to borrow one from.

## Deep Dive

### The problem: a class that builds its own dependencies

```csharp
public class MyService
{
    private readonly MyLogger _logger = new MyLogger(new MyFileWriter("log.txt"));
}
```

`MyService` is coupled to `MyLogger` and also to the way `MyLogger` is built.
When `MyLogger`'s constructor changes, `MyService` has to change. It cannot be
unit tested without writing a real file. The fix is to ask for the dependency in
the constructor and let someone else decide how to build it:

```csharp
public class MyService(MyLogger logger)
{
    public void Run() => logger.Log("started");
}
```

That "someone else" is the container, an `IServiceProvider` the framework builds
from your registrations.

### Register, then resolve

Registration happens before `Build()`, on `builder.Services`:

```csharp
builder.Services.AddScoped<IGameService, GameService>();
builder.Services.AddSingleton<ISystemClock, SystemClock>();
builder.Services.AddTransient<IReceiptNumberGenerator, ReceiptNumberGenerator>();
```

When a request needs a type, the container looks at its constructor, builds each
parameter (recursively, from its own registrations), and passes them in. Classes
with a primary constructor read cleanly for this. A parameter nobody registered
makes resolution fail, which is the early error you want.

In minimal APIs, handler parameters that are registered services are injected
directly, with no attribute needed in the usual case:

```csharp
app.MapGet("/games", async (GameStoreContext db) => ...);   // db is injected
```

### The three lifetimes

The lifetime answers one question: when the container is asked for the service
again, does it hand back the same instance or a new one?

- **Transient**: a new instance every time it is requested. For small stateless
  helpers.
- **Scoped**: one instance per scope. In a web app, a scope is one HTTP request,
  so everything in that request that asks for the service receives the same
  instance, and the next request gets a new one.
- **Singleton**: one instance for the whole life of the application.

You can see "same within a request" directly:

```csharp
builder.Services.AddScoped<RequestState>();

app.MapGet("/ids", (RequestState a, IServiceProvider sp) => new
{
    a = a.Id,
    b = sp.GetRequiredService<RequestState>().Id,   // same Guid as 'a' within this request
});
```

### Why `DbContext` is scoped

`AddDbContext` and `AddSqlite<T>` register the context as **scoped**, and that
is deliberate:

- A `DbContext` is not thread-safe, so two requests must not share one.
- Connections are limited and costly; a context per request opens and releases
  them promptly.
- The context tracks every entity it loads. A long-lived one would grow without
  bound and show stale data.
- One instance per request gives you a single unit of work for all the code that
  participates in that request.

### Captive dependencies

The dangerous mistake is a longer-lived service that captures a shorter-lived
one. A singleton that takes a scoped service in its constructor keeps the first
request's instance forever, shares it across threads, and defeats the reason the
service was scoped:

```csharp
builder.Services.AddScoped<RequestState>();
builder.Services.AddSingleton<Cache>();      // Cache(RequestState state) -> captive dependency

class Cache(RequestState state) { }
```

In the `Development` environment the container validates this when the host is
built and the app refuses to start with:
`Cannot consume scoped service 'RequestState' from singleton 'Cache'`. In
`Production` that validation is off by default, so the same code starts and
misbehaves. Run your integration tests in `Development`, or turn validation on
explicitly with `builder.Host.UseDefaultServiceProvider(o => o.ValidateScopes = true)`.

### Creating a scope by hand

Code that runs outside a request (startup, a `BackgroundService`, a singleton
that needs a database) has no ambient scope. It must create one and dispose it:

```csharp
public static void MigrateDb(this WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<GameStoreContext>();
    db.Database.Migrate();
}
```

The `using` disposes the scope and, with it, the context. Do not resolve scoped
services from `app.Services` directly: that is the root provider, and the
service would live as long as the application.

### Keyed services

When several implementations share one interface, register them with a key and
ask for one by name instead of injecting a collection and filtering:

```csharp
builder.Services.AddKeyedSingleton<IPaymentGateway, StripeGateway>("stripe");
builder.Services.AddKeyedSingleton<IPaymentGateway, PaypalGateway>("paypal");

app.MapPost("/pay", ([FromKeyedServices("stripe")] IPaymentGateway gateway) => ...);
```

## Trade-offs

- **An interface for everything is noise.** The container can register a
  concrete class directly. Create an interface when there is a second
  implementation or a real seam to fake in tests, not by reflex.
  ```csharp
  builder.Services.AddScoped<GameService>();   // no IGameService needed until it earns one
  ```
- **Injecting `IServiceProvider` is the service locator.** It hides what a class
  needs behind `GetService` calls, so dependencies stop being visible in the
  constructor and failures move to runtime. Reserve it for creating scopes and
  for factories.
- **Singletons must be thread-safe.** One instance serves every request
  concurrently. Mutable fields without synchronization, or a captive scoped
  dependency, produce bugs that appear only under load.
- **The container disposes what it creates.** An `IDisposable` it built is
  disposed with its scope, but an instance you pass in yourself
  (`AddSingleton(new Foo())`) is yours to dispose. Mixing the two leads to
  leaks or double disposal.
- **The built-in container is deliberately small.** No property injection, no
  per-registration interception, no convention-based scanning. Libraries such as
  Scrutor add scanning and decoration on top; a different container is rarely
  worth the migration.

## Documentation Links

- [Dependency injection in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) (doc)
- [Dependency injection in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection) (doc)
- [Dependency injection guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines) (doc)
- [Dependency injection in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#explicit-parameter-binding) (doc)
- [Scrutor, assembly scanning and decoration for the built-in container](https://github.com/khellang/Scrutor) (doc)
