---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

A REST API is a contract written in HTTP: a verb says what the client wants to
do, a URI says to which resource, and a status code says what happened. Clients,
proxies, retry logic, and caches all act on those three signals without reading
your code. The goal is to pick the right verb and status code for each CRUD
operation in ASP.NET Core, to understand which operations are safe or
idempotent and why that matters for retries, and to answer a missing resource
honestly instead of returning `200` with an empty body.

## Use Cases

- Implementing create, read, update, and delete for one resource so that a
  generic HTTP client, a browser, and a React front end all behave correctly.
- Letting a client retry a request after a network timeout without creating a
  duplicate or deleting something twice.
- Telling a front end the difference between "the game does not exist" and "your
  request is malformed", so it can show the right message.
- Handing the client the URL of a freshly created resource without it having to
  guess the id.

## Deep Dive

### The four verbs and their guarantees

Two properties decide how a client may treat a verb. A **safe** method does not
change server state. An **idempotent** method has the same effect on the server
whether it is sent once or many times.

| Verb | Meaning | Safe | Idempotent |
|---|---|---|---|
| `GET` | read a resource or a collection | yes | yes |
| `POST` | create a resource under a collection | no | no |
| `PUT` | replace the resource at a known URI | no | yes |
| `DELETE` | remove the resource | no | yes |

Idempotence is what makes a retry safe. If a `PUT` times out, the client can
send it again and the final state is the same. If a `POST` times out, resending
it may create a second game. Handling that case is why production APIs add
idempotency keys to `POST`, which is a separate concept.

### Status codes for each operation

```csharp
group.MapGet("/", ...);                          // 200 OK, body is the list (empty list is still 200)
group.MapGet("/{id}", ...);                      // 200 OK, or 404 Not Found
group.MapPost("/", ...);                         // 201 Created + Location header, or 400
group.MapPut("/{id}", ...);                      // 204 No Content, or 404, or 400
group.MapDelete("/{id}", ...);                   // 204 No Content
```

- **`200 OK`** carries a representation. **`201 Created`** says a resource now
  exists and, with the `Location` header, where to read it (see the routing
  concept for `CreatedAtRoute`).
- **`204 No Content`** says the operation succeeded and there is nothing to
  return, which is the convention for `PUT` and `DELETE`.
- **`400 Bad Request`** means the request itself is wrong (malformed JSON,
  failed validation). **`404 Not Found`** means the request was fine but the
  resource is not there.

### Not found must be a 404

The most common beginner bug is a read that finds nothing and still answers
`200`:

```csharp
// Wrong: 200 with a null body for an id that does not exist
group.MapGet("/{id}", async (int id, GameStoreContext db) =>
    await db.Games.FindAsync(id));

// Right: say so
group.MapGet("/{id}", async (int id, GameStoreContext db) =>
{
    var game = await db.Games.FindAsync(id);
    return game is null ? Results.NotFound() : Results.Ok(game.ToDetailsDto());
});
```

Every endpoint that looks a resource up by id has to make this decision,
including `PUT`: `FindAsync` returns `null`, so answer `404` instead of
dereferencing it. Whether `PUT` on a missing id should instead create the
resource is a design choice (the HTTP spec allows it). Returning `404` is the
more conservative option and the one a front end expects when the id comes from
a list it just fetched.

### Idempotent delete: the outcome, not the event

`DELETE` is idempotent because the guarantee is about the final state: after the
call, the resource does not exist. So a second `DELETE` of the same id is not an
error, and many APIs answer `204` both times:

```csharp
group.MapDelete("/{id}", async (int id, GameStoreContext db) =>
{
    await db.Games.Where(g => g.Id == id).ExecuteDeleteAsync();
    return Results.NoContent();
});
```

`ExecuteDeleteAsync` is a bulk delete: one `DELETE ... WHERE Id = @id`
statement, no load and no `SaveChanges`. When the row is missing it simply
affects zero rows. Answering `404` for the second call is also defensible (the
client learns the id was already gone), but it makes retries look like failures.
Pick one rule and apply it everywhere.

### Typed results make the contract visible

`Results.NotFound()` returns an `IResult`, so the handler's signature says
nothing about which responses are possible. `TypedResults` and the union
`Results<T1, T2>` put the possible responses in the return type, and OpenAPI
generation reads them:

```csharp
group.MapGet("/{id}", async Task<Results<Ok<GameDetailsDto>, NotFound>> (int id, GameStoreContext db) =>
{
    var game = await db.Games.FindAsync(id);
    return game is null ? TypedResults.NotFound() : TypedResults.Ok(game.ToDetailsDto());
});
```

### Errors as `ProblemDetails`

For an error body, prefer the standard `application/problem+json` shape (RFC
9457) over an ad hoc string. Registering the service is only half of it: the
middleware has to ask for it.

```csharp
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();   // unhandled exception -> 500 problem+json
app.UseStatusCodePages();    // bare 404/400 with no body -> problem+json
```

Without `UseStatusCodePages()`, `Results.NotFound()` still answers with an empty
body, even when `AddProblemDetails()` is registered. With both, the same `404`
carries `{"title":"Not Found","status":404,"traceId":"..."}`, and
`Results.Problem(...)` builds one explicitly. A front end can then handle every
API error with one parser.

## Trade-offs

- **`PUT` replaces, it does not patch.** The body must carry every field,
  otherwise the missing ones are overwritten with defaults. For partial
  updates, `PATCH` exists, with its own rules and more code.
- **`204` on a missing `DELETE` hides information.** It is simple and retry
  friendly, but a client cannot tell "I deleted it" from "it was never there".
  If that distinction matters, return `404` and make clients treat it as
  success.
- **A `201` from `POST` is not idempotent.** Two identical requests create two
  rows. If a client retries after a timeout, add a uniqueness rule or an
  idempotency key; the status code alone will not protect you.
  ```csharp
  // client retry after a timeout: two games with the same name unless you guard it
  POST /games { "name": "Astro Vault", ... }
  ```
- **Bulk delete skips the change tracker.** `ExecuteDeleteAsync` does not load
  the entity, so there are no EF Core events or tracked state, and a cascading
  rule you modeled only in C# will not run. Database-level cascades still do.
- **Status codes are a convention, not a type system.** Nothing stops a handler
  from returning `200` for an error. `TypedResults` and tests that assert the
  status code are what keep the contract honest.

## Documentation Links

- [Create responses in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [TypedResults vs Results, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses#typedresults-vs-results) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (doc)
- [Problem Details for HTTP APIs, RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
