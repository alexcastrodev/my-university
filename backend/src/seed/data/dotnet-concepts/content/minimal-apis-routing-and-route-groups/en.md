---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

A minimal API is an ASP.NET Core application whose endpoints are plain
delegates mapped to a route, with no controller class in between. The whole
application starts in `Program.cs`: a builder registers services, `Build()`
produces the `WebApplication`, and the code after it describes the request
pipeline and the endpoints. The goal is to know how a URL becomes a handler call
(route templates and parameter binding), how to name and group routes so they
stay maintainable, and how to move endpoints out of `Program.cs` before it
becomes a thousand-line file.

## Use Cases

- Building a small REST API (a CRUD over one resource) with the least ceremony
  the framework allows.
- Splitting a growing API by resource, with one extension method and one route
  group per resource, instead of one giant `Program.cs`.
- Returning a `Location` header that points at the endpoint that reads a
  just-created resource, without hard-coding the URL.
- Applying one policy (authorization, a tag, a filter) to every endpoint of a
  resource in one place.

## Deep Dive

### Two phases in one file

`Program.cs` has two sections separated by `Build()`. Before it you configure
what the app *has* (services, configuration, logging); after it you configure
what the app *does* with each request:

```csharp
var builder = WebApplication.CreateBuilder(args);   // phase 1: services
builder.Services.AddValidation();

var app = builder.Build();                           // phase 2: pipeline

app.MapGet("/", () => "Hello World!");
app.Run();
```

`CreateBuilder` already wires Kestrel, configuration from JSON and environment
variables, and logging. `Build()` freezes the service collection: registering a
service after it is too late.

### How a URL reaches a handler: templates and binding

`MapGet`, `MapPost`, `MapPut`, and `MapDelete` take a route template and a
delegate. The delegate parameters are bound by convention, with no attributes
needed in the common cases:

```csharp
app.MapGet("/games/{id}", (int id) => ...);            // route value
app.MapGet("/games", (string? genre, int page = 1) => ...); // query string
app.MapPost("/games", (CreateGameDto dto) => ...);     // JSON body
app.MapGet("/games", (GameStoreContext db) => ...);    // registered service
```

The rules, in the order the framework applies them:

1. A name that appears in the route template binds from the route.
2. A simple type (`int`, `string`, `Guid`, `DateOnly`) that is not in the
   template binds from the query string.
3. A type registered in the container is injected.
4. Any other complex type binds from the JSON body, but only for verbs that
   allow a body (`POST`, `PUT`, `PATCH`).

Failed conversions answer for you. With `"/games/{id}"` and an `int id`, a
request to `/games/abc` returns `400 Bad Request`. A required parameter with no
value (`(int page)` and no `?page=`) is also a `400`. If you want a non-matching
value to look like a missing route instead, add a constraint to the template:
`"/games/{id:int}"` makes `/games/abc` a `404`.

### Named routes and `CreatedAtRoute`

A route can carry a name, and other code can ask the framework to build the URL
for it. This is how a `POST` points the client at the new resource:

```csharp
const string GetGameEndpointName = "GetGame";

group.MapGet("/{id}", GetGame).WithName(GetGameEndpointName);

group.MapPost("/", async (CreateGameDto dto, GameStoreContext db) =>
{
    // ... create the game ...
    return Results.CreatedAtRoute(
        GetGameEndpointName, new { id = game.Id }, details);
});
```

The response is `201 Created` with a `Location: http://host/games/1` header and
the created resource in the body. The anonymous object supplies the route
values, so the URL stays correct if you later rename the path. Keep the name in
a constant: a mistyped string fails at runtime, not at compile time.

### Route groups

`MapGroup` gives a set of endpoints a shared prefix and a shared configuration
point. Inside the group, routes are relative to the prefix:

```csharp
var group = app.MapGroup("/games").WithTags("Games");

group.MapGet("/", GetGames);          // GET    /games
group.MapGet("/{id}", GetGame);       // GET    /games/{id}
group.MapPost("/", CreateGame);       // POST   /games
group.MapPut("/{id}", UpdateGame);    // PUT    /games/{id}
group.MapDelete("/{id}", DeleteGame); // DELETE /games/{id}
```

Anything you chain onto the group applies to every endpoint in it:
`RequireAuthorization()`, `WithTags(...)`, `AddEndpointFilter(...)`,
`ProducesProblem(...)`. Groups can be nested (`/api` containing `/games`), and
the prefix is written once, so it cannot drift between five copies.

### Moving endpoints out of `Program.cs`

The usual next step is one static class per resource with an extension method
on `IEndpointRouteBuilder`. Taking the interface instead of `WebApplication`
means the method also works inside another group or inside a module (see the
next concepts), not only on the app itself:

```csharp
public static class GamesEndpoints
{
    const string GetGameEndpointName = "GetGame";

    public static IEndpointRouteBuilder MapGamesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/games").WithTags("Games");

        group.MapGet("/", GetGames);
        group.MapGet("/{id}", GetGame).WithName(GetGameEndpointName);
        // ...
        return app;
    }

    static async Task<IResult> GetGame(int id, GameStoreContext db) { /* ... */ }
}
```

Handlers declared as static methods keep the mapping method short and can be
unit tested like any other method. `Program.cs` goes back to a list of calls:
`app.MapGamesEndpoints(); app.MapGenresEndpoints();`.

### Where binding surprises you

- **A complex type on a `GET`.** `app.MapGet("/x", (Dto d) => d)` compiles and
  the app starts. The first request fails with a `500` and
  `InvalidOperationException: Body was inferred but the method does not allow
  inferred body parameters`. Read the filter from the query with
  `[AsParameters]` or move to `POST`.
- **A service that was never registered.** The parameter is then treated as a
  body parameter, so the error you see is about body binding, not about a
  missing service.
- **Order of registration is not order of matching.** Routes are matched by
  template specificity, not by the order of the `Map*` calls, so `/games/{id}`
  and `/games/search` do not shadow each other.

## Trade-offs

- **No imposed structure.** Controllers give every team the same folders and
  naming. Minimal APIs give you freedom, which means the discipline (one file
  per resource, static handlers, groups) is yours to keep.
- **Lambdas grow.** A twenty-line lambda inside `MapPost` hides the route and
  makes the file hard to scan. Past a few lines, extract a named static method.
  ```csharp
  group.MapPost("/", CreateGame); // reads like a table of contents
  ```
- **Binding by convention is compact and implicit.** `(CreateGameDto dto)`
  needs no `[FromBody]`, which is nice until a refactor changes where a
  parameter comes from. Use explicit attributes (`[FromQuery]`,
  `[FromBody]`, `[FromServices]`) at the boundaries that matter.
- **Filters are per endpoint, not a pipeline you can see.** Endpoint filters
  run in the order they were added, around the handler. They are enough for
  validation and logging, but cross-cutting behavior that applies to everything
  usually belongs in middleware.
- **Reflection-free does not mean zero cost.** Minimal APIs build the request
  delegate on first use of each endpoint. For serverless and Native AOT
  scenarios there is a separate request delegate generator, with its own
  limits on what binding it supports.

## Documentation Links

- [Minimal APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) (doc)
- [Route handlers in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Routing in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
