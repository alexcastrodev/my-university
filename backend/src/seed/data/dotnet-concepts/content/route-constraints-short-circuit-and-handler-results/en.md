---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A minimal API endpoint is decided in three places before your logic matters: the
route template (including its constraints), whether routing lets the rest of the
pipeline run, and what the handler's return value turns into. Each has a quiet
failure: a constraint turns bad input into a `404`, a short-circuit hides an
endpoint from your middleware, and a returned `null` becomes a `500`. This
concept shows each with the response you actually get, and stays out of ground the
earlier concepts cover: basic binding failures and `TypedResults` as a contract.

## Use Cases

- Telling `/games/42` from `/games/zelda` on the same prefix without an `if`.
- Answering health checks, `robots.txt` and `favicon.ico` without running
  logging, rate limiting or authentication.
- Choosing the return type of a handler so that the status code, the content
  type and the OpenAPI document all agree.
- Debugging an endpoint that returns `404` for input you expected to be a `400`.

## Deep Dive

### Constraints decide whether a route matches

A constraint is the part after the colon in `{id:int}`. If it fails, the route
does not match, so the request goes on to other routes and, if none matches, ends
as a `404`. The app below (SDK 10.0.100, an ordinary `dotnet new web` project)
mapped many shapes and was called with `curl`:

```csharp
app.MapGet("/i/{id:int}", (int id) => $"int {id}");
app.MapGet("/min/{n:int:min(1)}", (int n) => $"min {n}");
app.MapGet("/opt/{id:int?}", (int? id) => $"opt {(id?.ToString() ?? "none")}");
app.MapGet("/u/{id}", (int id) => $"u {id}");            // no constraint
app.MapGet("/games/{id:int}", (int id) => $"by id {id}");
app.MapGet("/games/{slug}", (string slug) => $"by slug {slug}");
```

```text
/i/5 -> 200 "int 5"        /i/abc -> 404       /i/1.5 -> 404
/min/3 -> 200              /min/0 -> 404
/opt -> 200 "opt none"     /opt/7 -> 200       /opt/x -> 404
/u/5 -> 200                /u/abc -> 400       (bound after the match)
/games/12 -> "by id 12"    /games/zelda -> "by slug zelda"
```

Compare `/i/abc` with `/u/abc`. With the constraint the answer is `404`, because
no route matched. Without it the route matches and the failure happens later,
during parameter binding, so it is a `400`. The routing docs state the intent:
constraints exist to disambiguate similar routes, and should not be used for
input validation, since invalid input would produce `404` instead of `400` with
a message. The last two lines show the legitimate use: both templates match
`/games/12`, and the constrained one wins because a parameter with a constraint
is more specific than one without. If two matches tie, the framework throws an
ambiguous match exception instead of choosing.

More shapes from the same run: `alpha` matched `abc` and rejected `ab1`;
`length(3)` matched `abc` and rejected `abcd`; `range(1,5)` matched `5` and
rejected `6`; `bool` matched `true` and rejected `yes`; `datetime` matched
`2026-10-15`; `guid` rejected `zzz`. The numeric and date constraints use the
invariant culture, per the docs.

A catch-all `{**rest}` captured `a/b/c` as `rest [a/b/c]`. Called as `/file`
with nothing after it, the route still matched (catch-alls can match the empty
string), and a non-nullable `string rest` then failed binding with a `400`.
Declare the parameter `string?` when the empty case is legal.

### Regex constraints and their escaping rules

The regex constraint is where templates get hard to read. The docs say that the
route delimiter characters `{`, `}`, `[` and `]` must be doubled inside the
expression, and that the backslash needs the usual C# escaping. Observed with
SDK 10.0.100:

```text
{c:regex(^[a-z]{{2}}$)}          /b/ab -> 200     /b/AB -> 200
{c:regex(^\\d{{3}}$)}            /c/123 -> 200
{c:regex(^[a-z]{{2}}\\d{{3}}$)}  /e/ab123 -> 200  /e/AB123 -> 200  /e/ab12 -> 404
{c:regex(^[[a-z]]{{2}}$)}        /a/ab -> 404     (the doubled-bracket form from the docs did not match)
{c:regex(^[[0-9]]{{3}}$)}        /d/123 -> 404
```

Three takeaways. Doubled braces and `\\d` worked. The doubled square brackets
that the docs show did not match in this run, while the single-bracket class
did, so test any pattern with a character class before you rely on it. And the
match is case-insensitive: the docs say the framework adds
`RegexOptions.IgnoreCase`, which is why `AB123` passed a `[a-z]` class. Anchor
with `^` and `$`, or the expression matches any substring.

### Custom constraints

A constraint is a class implementing `IRouteConstraint`. Register it by name; on
.NET 10 the build warned that `ConstraintMap` is not trimming friendly and
suggested `SetParameterPolicy` instead:

```csharp
builder.Services.Configure<RouteOptions>(o => o.SetParameterPolicy<EvenIntConstraint>("evenint"));
app.MapGet("/even/{n:evenint}", (int n) => $"even {n}");   // /even/4 -> 200, /even/3 -> 404
```

The docs call custom constraints rarely needed and suggest checking the value in
the handler, where you can return a descriptive error, before writing one.

### Short-circuit routes

Normally routing selects an endpoint and then lets the middleware that follows
run before the endpoint executes. `ShortCircuit()` makes routing run the
endpoint immediately and end the request. A request logger registered first
recorded every path except the short-circuited ones:

```csharp
app.MapGet("/health", () => "ok").ShortCircuit();
app.MapGet("/health204", () => "ignored").ShortCircuit(204);
app.MapShortCircuit(404, "robots.txt", "favicon.ico");
```

```text
/health -> 200 "ok"     /health204 -> 204 (no body)
/robots.txt -> 404      /favicon.ico -> 404       /i/5 -> 200
middleware log: mw /i/5     (nothing for /health, /health204, /robots.txt, /favicon.ico)
```

With a status code, `ShortCircuit(204)` answered `204` with no body, not the
handler's text. `MapShortCircuit` takes URL prefixes
and returns a convention builder, so a host filter can be added. The docs list
two limits: it does not affect middleware placed before `UseRouting`, and
combining it with `[Authorize]` or `[RequireCors]` metadata fails. That was
reproduced: a `.RequireAuthorization().ShortCircuit()` endpoint answered `500`
with `InvalidOperationException: Endpoint HTTP: GET /sc-auth contains
authorization metadata, but this endpoint is marked with short circuit`. Use it
only for endpoints that need no cross-cutting middleware.

### What a handler's return value becomes

The framework picks the response from the runtime shape of the value:

```text
return "plain"                          -> 200 text/plain
return new { a = 1, b = "x" }           -> 200 application/json   {"a":1,"b":"x"}
return 42                               -> 200 application/json   42
return Results.Created("/x/1", obj)     -> 201 application/json
return TypedResults.Accepted("/jobs/9") -> 202, no body (from an async handler)
handler sets Response.StatusCode = 418  -> 418, no body
return (string?)null                    -> 500  ArgumentNullException (parameter 'text')
```

Note that `42` is serialized as JSON while `"plain"` is text. A `null` string is
a bug, not an empty body, so return `TypedResults.NoContent()` or `NotFound()`
when there is nothing to send. Anonymous types and reflection-based JSON work
in a regular project; a file-based app (`dotnet run file.cs`) is different: the same anonymous type failed
there with a `NotSupportedException` (no JSON metadata for the anonymous type).

Returning `IResult` (as `Results.Created` does) tells the framework nothing about
the possible responses. Returning `Results<Ok<string>, NotFound, BadRequest<string>>`
does: the compiler restricts the branches to those three types, and the metadata
read by OpenAPI matched. Listing the endpoints' `IProducesResponseTypeMetadata`
printed `/r/typed/{id:int} => 200,404,400` for the union and nothing for the
`IResult` endpoint. The earlier REST concept shows the pattern in a CRUD group;
here the point is that the return type is data the framework reads, and an
`IResult` hides it.

## Trade-offs

- **A constraint hides the reason.** A `404` for `/orders/abc` gives the client
  nothing to fix; bind it as a plain `int` and return a `400` with a message
  when the caller needs to know.
  ```csharp
  app.MapGet("/orders/{id}", (int id) => ...);      // 400 on /orders/abc, with ProblemDetails if configured
  ```
- **Regex in a template is hard to read and to test.** Prefer a named custom
  constraint or validation in the handler for anything beyond a simple shape.
- **Short-circuit saves work and skips guarantees.** No logging, no security
  headers, no authentication; only for endpoints where that is acceptable.
- **`IResult` is flexible, `Results<...>` is checkable.** The union costs a long
  signature, and in return the status
  codes become part of the compiled and documented contract.
- **Return-type inference is convenient and implicit.** `return 42` is JSON and
  `return "42"` is text; write `TypedResults.Ok(...)` when the content type
  matters to the client.

## Documentation Links

- [Routing in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) (doc)
- [Create responses in Minimal API applications, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Route handler delegates in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Handle errors in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/handle-errors) (doc)
