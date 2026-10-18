---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A minimal API handler is an ordinary delegate, and the framework builds the
glue that fills each of its parameters from the request. That glue has a fixed
precedence, a fixed set of failure codes, and three extension points: your own
`TryParse`, your own `BindAsync`, and endpoint filters that wrap the handler.
The routing concept showed the everyday cases. This one is about what happens at
the edges: when a value does not convert, when a type has to read two places at
once, when a form needs antiforgery, and when a rule should run before the
handler for one endpoint or a whole group.

## Use Cases

- Accepting a domain value in a URL (`/map?p=12.3,10.1`, a `Money`, an
  `OrderId`) without parsing strings inside every handler.
- Collapsing a six-parameter handler into one `[AsParameters]` request type.
- Building a value from several places at once, such as a tenant resolved from
  a header with a query fallback.
- Handling an HTML form post, with or without a file, safely.
- Applying one rule (normalize, reject, log) around many handlers without
  touching them.

## Deep Dive

### The order the framework tries

Per the documentation, a parameter's source is decided in this order: an
explicit `[From*]` attribute; then special types (`HttpContext`, `HttpRequest`,
`CancellationToken`, `ClaimsPrincipal`, `IFormFile`, `Stream`...); then a type with
a static `BindAsync`; then `string` or a type with a static `TryParse` (route if
the name is in the template, otherwise query string); then a service registered
in the container; and only then the JSON body. The last two matter most: the
service check comes before the body, and the body is the fallback for anything left over, which explains the surprise below.

I ran these on SDK 10.0.100 (file-based apps, `curl` against Kestrel). The
failure codes were:

```text
GET  /items/abc?p=2        ([FromRoute] int id)         -> 400
GET  /items/7              (missing required int)        -> 400
GET  /map?p=12.3           (TryParse returns false)      -> 400
GET  /who                  (BindAsync returns null)      -> 400
GET  /who  X-Caller: boom  (BindAsync throws)            -> 500
POST /post-body  text/plain                              -> 415
POST /post-body  {bad                                    -> 400
POST /post-unreg (service never registered, no body)     -> 400
POST /post-unreg {} (same, body "{}")                    -> 200 "handler ran"
```

The last two lines are the trap. A service you forgot to register is not
reported as a missing service: the parameter falls through to the body. With no
body you get a puzzling `400`. With a JSON body, even `{}`, the framework creates
an empty instance and your handler runs with a useless object. Register the
service, and mark the parameter `[FromServices]`: with the attribute, the same
request failed with `No service for type 'Svc' has been registered` (a `500`)
instead of binding an empty body.

### One bad signature takes the whole app down

The routing concept mentions that a complex type on a `GET` fails with
`Body was inferred but the method does not allow inferred body parameters`.
Two details from running it. `GET`, `HEAD`, `OPTIONS` and `DELETE` never infer a
body, while `[FromBody]` on them is allowed. And the failure is not local: the
endpoints are built together on the first request, so with one bad handler
among three, `/healthy` and even an unmatched `/nope` answered `500`:

```csharp
app.MapGet("/healthy", () => "I am fine");
app.MapGet("/bad", (Filter f) => f);               // inferred body on GET
```

```text
GET /healthy -> 500    GET /nope -> 500     (log: InvalidOperationException, Body was inferred ...)
```

The app starts without complaint in `Production`, so a smoke test that calls
any endpoint once, for example with `WebApplicationFactory`, catches it in CI.

### Explicit sources and `[AsParameters]`

Attributes are worth writing wherever a refactor could silently change the
source. A header can bind straight to a number or an array, and repeated query
keys bind to arrays:

```csharp
app.MapGet("/arr", (int[] ids, string[] tags, [FromHeader(Name = "X-Nums")] int[] nums) => ...);
// GET /arr?ids=1&ids=2&tags=a&tags=b  X-Nums: 3, 4   -> ids=[1,2] tags=[a,b] nums=[3,4]
// GET /arr?ids=1&ids=x                               -> 400
// GET /arr                                           -> 200, all three empty
```

Note the last line: a missing array is empty, not an error, while a missing
`int` is a `400`. `[AsParameters]` expands one type into its constructor
parameters, each bound by the normal rules, including services and the
cancellation token:

```csharp
app.MapGet("/search/{category}", ([AsParameters] SearchRequest r) => r.ToString());

record SearchRequest([FromRoute] string Category, [FromQuery] int Page,
    [FromHeader(Name = "X-Tenant")] string Tenant, Clock Clock, CancellationToken Ct);
// GET /search/books?page=3  X-Tenant: acme -> Category = books, Page = 3, Tenant = acme
// GET /search/books                        -> 400
```

It is a flat expansion, not recursive model binding: nested complex types are
not walked. The docs note that a struct can be cheaper than a record here.

### Custom binding: `TryParse`, `BindAsync`, `IBindableFromHttpContext`

For one value coming from one string (route, query or header), add a static
`TryParse`. The two-argument form receives an `IFormatProvider`, which in my run
was the invariant culture, so parsing does not depend on the server's locale:

```csharp
readonly record struct Point(double X, double Y)
{
    public static bool TryParse(string? s, IFormatProvider? fp, out Point r) { /* split, double.TryParse(..., InvariantCulture) */ }
}
app.MapGet("/map", (Point p) => FormattableString.Invariant($"Point: {p.X}, {p.Y}"));
// GET /map?p=12.3,10.1 -> Point: 12.3, 10.1      GET /map -> 400     GET /map-opt?p=bad -> 400
```

When the value needs the whole request, implement `BindAsync(HttpContext)` on
the type, or `IBindableFromHttpContext<T>` (static abstract, C# 11) which also
receives the `ParameterInfo`. Returning `null` becomes a `400`, but throwing
becomes a `500`, so validate and return `null` instead of throwing. Whichever you
pick, the result of a custom binder is checked *before* the handler, so the
handler can trust it.

### Forms and antiforgery

`[FromForm]` binds `application/x-www-form-urlencoded` and multipart data, and the
documentation says parameters bound with `[FromForm]` include an antiforgery
token that is validated when the request is processed. With `AddAntiforgery()` and
`UseAntiforgery()` in place, a form post without a token was rejected:

```text
POST /form  name=ana&age=30                        -> 400   (no token)
POST /form  same, cookie + __RequestVerificationToken -> 200  name=ana age=30
POST /form  age=abc (with token)                   -> 400
POST /form  Content-Type: application/json         -> 415
```

The token comes from `IAntiforgery.GetAndStoreTokens(context)` when you render the
page. `.DisableAntiforgery()` turns the check off per endpoint (right for an API
called by a non-browser client with its own auth, wrong for a cookie-authenticated
form). New in .NET 10, per the release notes: when `[FromForm]` binds a complex
type, an empty string for a nullable value type becomes `null` instead of a
parse failure. I confirmed `DueDate=` gives `due=null` on a `TodoForm` record,
while a top-level `[FromForm] DateOnly? due` parameter still answered `400` for
the same empty value, so do not generalize.

### Endpoint filters: wrapping the handler

`AddEndpointFilter` receives an `EndpointFilterInvocationContext` and the next
delegate. Filters run first-in, first-out on the way in and in reverse on the
way out, and a filter added to a `MapGroup` is the outermost: the trace for a
grouped endpoint with two filters was `group> f1> f2> handler`. Returning without
calling `next` short-circuits, and what you return becomes the response:

```csharp
app.MapPost("/args", (int id, Clock clock, CreateDto dto) => ...)
   .AddEndpointFilter(async (ctx, next) =>
   {
       var dto = ctx.GetArgument<CreateDto>(2);          // index counts services too
       return dto.Name.Contains('<') ? Results.Problem("bad chars", statusCode: 422)
                                     : await next(ctx);
   });
```

`ctx.Arguments` listed `Int32, Clock, CreateDto`: the index follows the handler
signature, services included. Asking for the wrong index threw
`InvalidCastException` and answered `500`, which is why a filter factory is
safer. `AddEndpointFilterFactory` runs once per endpoint when it is built and
receives the `MethodInfo`, so it can locate the parameter by type and return `next`
untouched when the handler has none. A class implementing `IEndpointFilter`
(`AddEndpointFilter<T>()`) is constructed per request, with constructor
injection, scoped services included, and it does not need a registration.

Three behaviors worth knowing. A route or query value that fails to convert (or is
missing) still runs the filter, with the default value (`arg0=0`), and the `400`
is applied after; a JSON body that fails to parse answers `400` without running the filter.
So a filter must never assume an argument is non-null. Second, with
`AddValidation()` a DTO that violates its annotations returned `400` and my
custom filter did not run, so your filters see only valid input. That holds
only for discovered types: the same record declared `internal` returned `200`
with the invalid body, as the validation concept warns, so keep request DTOs
`public`. Third, a filter
can translate exceptions: wrapping `next` in a `try` and returning
`TypedResults.NotFound(...)` for a `KeyNotFoundException` turned a throw into a
`404`. After `next`, the value is the handler's raw return: a `String` for a
lambda returning text, `Ok<string>` for `TypedResults.Ok`.

## Trade-offs

- **Convention binding is compact and silent.** A forgotten registration or a
  moved parameter changes the source with no compile error. Use `[FromServices]`
  and `[FromBody]` where being wrong is expensive, and keep a test per endpoint.
  ```csharp
  app.MapPost("/orders", ([FromBody] CreateOrder dto, [FromServices] IOrderService svc) => ...);
  ```
- **`TryParse` gives a bare `400`.** There is no message and no field name. If
  clients need a reason, bind a `string` and parse in a filter, so you control
  the problem body.
- **`BindAsync` hides I/O in a parameter.** It is handy for a tenant or a
  caller, but a handler signature that reads three headers through a type is
  harder to see in the OpenAPI document than three explicit parameters.
- **Index-based `GetArgument` is brittle.** Reordering handler parameters breaks
  the filter at runtime. Prefer a factory that finds the parameter by type, or
  an `[AsParameters]` request type whose position never moves.
- **Filters are per endpoint; middleware is global.** A filter sees typed
  arguments and results, middleware sees only `HttpContext`. Use middleware for
  host-wide rules and filters for rules that depend on a handler's inputs.
- **Disabling antiforgery is a security decision, not a convenience.** It is
  fine for a token-authenticated API, and an open door for a cookie-authenticated
  HTML form.

## Lab

In this lab you get an API with several half-built endpoints, and the first thing you notice is that all of them fail with 500, even the ones you did not touch. Your job is to find out why and then build the custom binders and a filter. The core idea is to understand how Minimal APIs bind handler parameters (route, query, header, services, body), how to extend binding with `TryParse` and `BindAsync`, how to expand a request type with `[AsParameters]` and how to run a rule around a whole group with an endpoint filter.

**The scenario**

A sample API with endpoints that exercise each binding source. The tests use `WebApplicationFactory<Program>`.

- `Program.cs`: maps `/map`, `/who`, `/search/{category}`, `/time` and an `/orders` group.
- `Point.cs`: `TryParse` for `/map?p=12.3,10.1`.
- `Caller.cs`: `BindAsync` for `/who`.
- `SearchRequest.cs`: a record used with `[AsParameters]`.
- `Clock.cs`: the service used by `/time`.
- `CreateOrder.cs` and `OrderValidationFilter.cs`: the order body and the filter that validates it.

**What you will do, step by step**

1. **Find the global 500 (TODO-00).** Read the log of the first request and register the missing service in `Program.cs`. A single handler with a bad signature takes down the whole application, which is why every endpoint fails.
2. **Make the `Clock` source explicit (TODO-01).** In `/time`, mark the parameter with an explicit source, so a forgotten registration can never fall through to the request body.
3. **Parse the `Point` (TODO-02).** In `Point.TryParse`, read `x,y` (two doubles separated by a comma) and return `false` when missing or malformed. Use the invariant culture so `12.3` works on any server.
4. **Bind the `Caller` (TODO-03).** In `Caller.BindAsync`, read the name from the `X-Caller` header, falling back to the `caller` query key. Return `null` (a 400) when neither has a value. Do not throw: it would become a 500.
5. **Give each property a source (TODO-04).** In `SearchRequest`, `Category` comes from the route, `Page` from the query string and `Tenant` from the `X-Tenant` header.
6. **Write and attach the filter (TODO-05 and TODO-06).** In `OrderValidationFilter`, return `Results.ValidationProblem(...)` when `Name` is blank (key `name`) or `Quantity` is not positive (key `quantity`); otherwise replace argument 0 with a copy whose `Name` is trimmed, so the handler only sees clean data. Then attach the filter to the `/orders` group in `Program.cs`.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why one broken handler takes down every endpoint, when a `BindAsync` yields a 400 instead of a 500 and why the filter runs before the handler.

**Optional challenges**

- **TODO-07:** remove the registration from TODO-00 and call `/time` with and without `[FromServices]`. Compare the status codes.
- **TODO-08:** add a `[FromHeader] int[]` parameter and send `X-Nums: 3, 4`. What happens when the header is missing?

**Prerequisites:** basic Minimal APIs and route groups, C# records and static members, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. In the starter state almost every test fails (even the ones for endpoints you have not touched yet), and the TODOs are marked in comments in the files.

## Documentation Links

- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
- [Antiforgery with Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
- [What's new in ASP.NET Core 10, Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Route handlers in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
