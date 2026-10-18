---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Every HTTP request in ASP.NET Core passes through a chain of delegates, the
middleware pipeline, and `Program.cs` is where you build that chain. The chain
has an order, each link can run code before and after the next one, and any link
can stop the request by not calling the next. Most "why does this not work"
questions about HTTPS redirects, CORS, authentication, static files and error
pages are really questions about order. The goal is to read a `Program.cs` as a
pipeline: know what `Use`, `Run` and `Map` do, what `WebApplication` adds for you,
how a short-circuit looks from the outside, and how to write your own middleware
without leaking scoped services.

## Use Cases

- Adding a cross-cutting rule that applies to every request: a correlation id,
  a custom header, a maintenance-mode switch, a request timer.
- Deciding where `UseExceptionHandler`, `UseHsts`, `UseCors` and
  authentication belong relative to each other.
- Debugging an endpoint that is never reached because something earlier in the
  pipeline answered first.
- Serving a different sub-application under a path prefix, or only for requests
  that carry a given header.

## Deep Dive

### Use, Run and Map

`WebApplication` is both the host and the pipeline builder. Three methods shape
the chain:

- `Use(async (ctx, next) => ...)` adds a middleware that decides whether and
  when to call `next`. Work before `await next(ctx)` happens on the way in, work
  after it on the way out.
- `Run(ctx => ...)` adds a terminal delegate. It has no `next`, so nothing after
  it in the chain ever runs for that request.
- `Map(path, branch)` and `MapWhen(predicate, branch)` fork a separate pipeline
  for matching requests. `Map` also moves the matched prefix from `Path` to
  `PathBase`. `UseWhen` forks too, but rejoins the main chain unless the branch
  short-circuits.

Here is a small app (a file-based app, run with `dotnet run p.cs` on SDK
10.0.100) that records the order in which each piece runs for each request:

```csharp
#:sdk Microsoft.NET.Sdk.Web
using System.Text;
var app = WebApplication.CreateBuilder(args).Build();
StringBuilder T(HttpContext c) => (StringBuilder)(c.Items["t"] ??= new StringBuilder());

app.Use(async (ctx, next) =>                         // A: outermost, catches exceptions
{
    try { await next(ctx); }
    catch (Exception ex) { ctx.Response.StatusCode = 500; await ctx.Response.WriteAsync("caught: " + ex.Message); }
});
app.Use(async (ctx, next) =>                         // B: trace
{
    T(ctx).Append("A>"); await next(ctx); T(ctx).Append("<A");
    Console.WriteLine($"TRACE {ctx.Request.Path} {T(ctx)} status={ctx.Response.StatusCode}");
});
app.Use(async (ctx, next) =>                         // C: a gate
{
    if (ctx.Request.Query.ContainsKey("deny")) { ctx.Response.StatusCode = 401; await ctx.Response.WriteAsync("denied"); return; }
    T(ctx).Append("B>"); await next(ctx); T(ctx).Append("<B");
});
app.Map("/branch", br => br.Run(c => c.Response.WriteAsync($"pathBase={c.Request.PathBase} path={c.Request.Path}")));
app.MapGet("/hello", (HttpContext ctx) => { T(ctx).Append("H"); return "hello"; });
app.MapGet("/boom", () => { throw new InvalidOperationException("kaboom"); return "x"; });
app.Run();
```

Real output of `curl` against it, plus the console trace:

```text
GET /hello          -> 200 hello                           TRACE A>B>H<B<A status=200
GET /hello?deny=1   -> 401 denied                          TRACE A><A status=401
GET /boom           -> 500 caught: kaboom
GET /branch/x       -> 200 pathBase=/branch path=/x        TRACE A>B><B<A status=200
GET /nope           -> 404 (empty body)                    TRACE A>B><B<A status=404
```

The first line shows the onion: in through A and B, the handler `H`, out through
B and A. The second shows a short-circuit: the gate answered 401 and never called
`next`, so the handler never ran and the outer middleware still saw the way out.
The third shows why the exception handler goes first: it is the only thing
wrapping the rest, and an exception in the endpoint became a controlled 500. The
fourth shows `Map` rewriting `Path` and `PathBase`. The last shows that a
request nobody handles falls off the end of the pipeline as a 404.

### What WebApplication adds for you

You do not write `UseRouting` or `UseEndpoints` in a modern `Program.cs`. Per the
docs, `WebApplication` adds `UseDeveloperExceptionPage` first when the environment
is `Development`, adds `UseRouting` at the start if you did not call it and
endpoints exist, adds authentication and authorization right after routing when
those services are registered, and adds the endpoint middleware at the **end** of
the pipeline. Your own middleware therefore runs between routing and the
endpoints.

Two observable consequences. First, the selected endpoint is already known to
your middleware, even without an explicit `UseRouting`:

```text
Header written by a Use() placed before any Map call, for GET /hello:
X-Endpoint-Before-UseRouting: HTTP: GET /hello          (for /nope and /branch/x: null)
```

That is what lets authorization and CORS read endpoint metadata. Second, because
the endpoint middleware sits at the very end, a terminal `app.Run(...)` that you
register in the middle of `Program.cs` swallows everything. With a catch-all
`Run` written before `app.Run()`, a request to `/hello` returned
`terminal: nothing matched` and `/boom` returned 200, so the endpoints and the
exception handler's job both vanished with no error.

### The recommended order

The documented guidance for the built-in pieces is, from outermost to innermost:
exception handling (and HSTS in production), HTTPS redirection, static files,
routing, CORS, authentication, authorization, then your endpoints. The reasoning
is a short rule: put anything that can fail or short-circuit cheaply as early as
it can see what it needs. Exception handling is first because it must wrap the
rest. Static files come before authentication so images do not pay for a token
check. CORS must run after routing (it reads endpoint metadata) and before
authentication so a rejected preflight does not become a 401. Authentication
precedes authorization because the second needs the user the first built.

### Writing your own: convention versus IMiddleware

There are two shapes. Convention-based middleware is a class with a constructor
taking `RequestDelegate` and an `InvokeAsync(HttpContext, ...)` method. It is
created **once**, so constructor parameters must be singleton-safe. Scoped
services go on `InvokeAsync`, which is resolved per request:

```csharp
class ConventionMiddleware(RequestDelegate next, ILogger<ConventionMiddleware> log)
{
    public async Task InvokeAsync(HttpContext ctx, Clock clock)   // Clock is scoped
    {
        ctx.Response.Headers["X-Clock-Scope"] = clock.Id.ToString("N")[..6];
        await next(ctx);
    }
}
app.UseMiddleware<ConventionMiddleware>();
```

The factory-based shape implements `IMiddleware`, is resolved from the container
for every request, and so can take scoped services in its constructor. It must be
registered, and forgetting that fails per request, not at startup:

```text
(no AddScoped<StampMiddleware>)  GET /env -> 500 caught: No service for type 'StampMiddleware' has been registered.
```

Two rules apply to both. Do not change the status code or headers after the
response has started (`Response.HasStarted`), and do not call `next` after you
have written the response.

### Environments and launch settings

The environment name comes from `ASPNETCORE_ENVIRONMENT`, and without it the
default is `Production`; the run above printed `Production` for `app.Environment.EnvironmentName`.
`Properties/launchSettings.json` is a tooling file: `dotnet run` and the IDE read
it to set environment variables and URLs, and a published app does not. See
the configuration concept for how the environment selects `appsettings.{Environment}.json`.
In `Program.cs` use `app.Environment.IsDevelopment()` for branches such as the
developer exception page, and keep production behavior as the unconditional path.

## Trade-offs

- **Order is global state in one file.** Moving `UseCors` one line changes
  every endpoint, and nothing fails to compile.
  ```csharp
  app.UseAuthentication();
  app.UseCors();            // after authentication: a preflight without credentials gets a 401
  ```
- **A terminal `Run` in the middle hides everything below it, including the
  endpoints.** Reserve it for branches inside `Map`, not the main pipeline.
- **Inline lambdas are quick but unreusable and hard to test.** Past a few
  lines, a convention class with `InvokeAsync` can be unit tested with a fake
  `HttpContext`.
- **Convention middleware is created once.** Injecting a scoped service in its
  constructor either fails at startup or captures one instance for the lifetime
  of the app; use `InvokeAsync` parameters or `IMiddleware`.
- **Middleware applies to every request, endpoint filters to one endpoint.**
  Use middleware for host-wide concerns and an endpoint filter when the logic
  depends on the typed arguments of a handler.

## Lab

In this lab you get an app with a maintenance gate, a correlation id middleware and a few endpoints, but the pipeline is incomplete and partly in the wrong order. Your job is to complete and fix it. The core idea is to read `Program.cs` as a pipeline: know what `Use`, `Run` and `Map` do, why order matters, how a short-circuit looks from the outside and how to write a convention-based middleware.

**The scenario**

The tests send requests through the in-memory server and check headers, status codes and bodies.

- `Program.cs`: the maintenance gate (`app.Use`, which answers 503 when `Maintenance:Enabled` is on, except for `/health`, and short-circuits by not calling `next`), the `CorrelationIdMiddleware` registration and the endpoints `/health`, `/hello` and `/boom` (which throws `InvalidOperationException("kaboom")`).
- `CorrelationIdMiddleware.cs`: the convention-based middleware (`InvokeAsync`), still without logic, with the `X-Correlation-Id` header constant.

**What you will do, step by step**

1. **Catch exceptions (TODO-00).** Add an inline middleware (`app.Use`) that wraps the rest of the pipeline in try/catch and answers 500 with the body `caught: <message>`. Decide where it must go so it can see exceptions from everything after it.
2. **Fix the order (TODO-01).** The gate's 503 has no `X-Correlation-Id` header. The two registrations are in the wrong order: fix it so the id is also present on short-circuited responses.
3. **Create a branch (TODO-02).** Map `/branch` to a separate branch (`Map`) whose terminal delegate (`Run`) writes `pathBase=<PathBase> path=<Path>`. This way you see `Path` and `PathBase` change inside the branch.
4. **Implement the middleware (TODO-03).** In `InvokeAsync`, use the request's `X-Correlation-Id` header when present, otherwise generate a new one (a `Guid` in "N" format). Store it in `ctx.Items["CorrelationId"]` and write it to the response header, all BEFORE calling `next`, because once the response starts the headers are read-only.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why the error middleware must come before the others, why the correlation id comes before the gate, and why the header cannot be written after `next`.

**Optional challenges**

- **TODO-04:** register a terminal `app.Run(...)` before the endpoints, see which tests break and remove it.
- **TODO-05:** add a timer middleware that sets `X-Elapsed-Ms` using `Response.OnStarting`. Why can it not set the header after `next`?

**Prerequisites:** basic Minimal APIs, `async`/`await` and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The app compiles in the starter state, and the tests for the required TODOs fail until you complete `Program.cs` and `CorrelationIdMiddleware.cs`.

## Documentation Links

- [ASP.NET Core Middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) (doc)
- [Write custom ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/write) (doc)
- [WebApplication and WebApplicationBuilder in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/webapplication) (doc)
- [Use multiple environments in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments) (doc)
- [Factory-based middleware activation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/extensibility) (doc)
