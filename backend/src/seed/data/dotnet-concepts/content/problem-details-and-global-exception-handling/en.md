---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Every API fails, and the question is whether clients can parse the failure.
ASP.NET Core ships the pieces for one machine-readable error shape, the
`application/problem+json` document of RFC 9457, but they live in three
different places and each one is optional: a service that builds the document
(`AddProblemDetails`), middleware that decides when to ask for it
(`UseExceptionHandler`, `UseStatusCodePages`), and a hook that maps your own
exception types to responses (`IExceptionHandler`). The REST concept introduced
the first two lines. This one is about wiring them so that a `404`, a validation
failure and an unhandled exception all look the same, and about the ways the
setup quietly does less than you expect.

## Use Cases

- Giving a front end one parser for every error the API can produce.
- Mapping domain exceptions (`GameNotFoundException`) to `404` or `409` in one
  class instead of a `try/catch` in every handler.
- Adding a correlation field or the request path to every error body.
- Making sure a database connection string in an exception message never
  reaches a client.
- Turning a downstream timeout into `503` with a `Retry-After` header.

## Deep Dive

### The document and who writes it

RFC 9457 (which obsoletes RFC 7807) defines `type`, `title`, `status`, `detail`
and `instance`, and allows extension members. `ProblemDetails` is that type in
ASP.NET Core, and `IProblemDetailsService` is the service that serializes it.
`AddProblemDetails()` registers the default service, nothing more. I ran the
same app (SDK 10.0.100, Kestrel, `curl`) with different wiring, and the body
for `GET /nope` (no such route) changed like this:

```text
AddProblemDetails() only            404, empty body
+ UseStatusCodePages()              404, application/problem+json
                                    {"type":".../rfc9110#section-15.5.5","title":"Not Found","status":404,"traceId":"00-..."}
```

So registering the service is not enough: for responses that are not
exceptions, nothing asks it to write until `UseStatusCodePages()` runs. The
same app confirmed the other half. An endpoint that returns `Results.NotFound()`
or `Results.BadRequest()` produces an empty body until status code pages are in
the pipeline, while `Results.Problem(...)` and `Results.ValidationProblem(...)`
are written directly and already carry `traceId` once the service is registered.
Note the `type` URI points at RFC 9110 sections in .NET 10, one per status code.

Exceptions are the second path. With status code pages alone, `GET /boom`
(a handler that throws) still returned a bare `500`, because that middleware
only looks at responses, and the exception goes straight past it. Adding
`UseExceptionHandler()` with no arguments, which is valid when problem details
are registered, produced:

```csharp
builder.Services.AddProblemDetails();
var app = builder.Build();
app.UseExceptionHandler();   // exception -> 500 problem+json, no stack, no message
app.UseStatusCodePages();    // empty 4xx/5xx -> problem+json
```

```text
GET /boom -> 500 application/problem+json
{"type":".../rfc9110#section-15.6.1","title":"An error occurred while processing your request.","status":500,"traceId":"..."}
```

Without the fallback, `UseExceptionHandler()` with no path and no
`AddProblemDetails` throws at startup, per the documentation.

### Content negotiation can silently skip you

The default writer only answers when the `Accept` header allows JSON. In my run
`Accept: application/problem+json` and `*/*` got the document, while
`Accept: text/html` and `application/xml` on `/boom` got a `500` with an empty
body, and a `404` for `text/html` got plain text (`Status Code: 404; Not Found`)
from status code pages. A browser hitting an API URL is the common case, so test
errors with the headers your real clients send, and add a fallback if you want
one body for everyone.

### `IExceptionHandler`: one place for known exceptions

Register handlers with `AddExceptionHandler<T>()`. They are singletons, run in
registration order, and each returns `true` to say "handled, stop" or `false` to
pass the exception along. They are only called if `UseExceptionHandler` is in the
pipeline. A handler should write the whole response; asking
`IProblemDetailsService` to do it keeps the shape consistent:

```csharp
class DomainExceptionHandler(IProblemDetailsService pds) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        (int status, string title) = ex switch
        {
            ArgumentException      => (400, "Invalid request"),
            GameNotFoundException  => (404, "Game not found"),
            _                      => (0, "")
        };
        if (status == 0) return false;               // not mine, next handler
        ctx.Response.StatusCode = status;
        return await pds.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx, Exception = ex,
            ProblemDetails = { Status = status, Title = title, Detail = ex.Message }
        });
    }
}
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
```

Observed results with a second handler for `TimeoutException` registered after
it:

```text
GET /arg     -> 400 {"title":"Invalid request","detail":"name is required",...}
GET /nf      -> 404 {"title":"Game not found","detail":"Game 42 not found",...}
GET /timeout -> 503 Retry-After: 5  {"title":"Service temporarily unavailable",...}
GET /boom    -> 500 {"title":"An error occurred while processing your request.",...}   (nobody claimed it)
```

A handler that returns `true` without writing anything leaves an empty
response: in my run `GET /silent` came back `500` with no body. A response that
already started cannot be replaced either: a handler that wrote `partial...`,
flushed, then threw ended as `200` with that text, and the log said
`The response has already started, the error handler will not be executed`.

### `CustomizeProblemDetails` and `instance`

`AddProblemDetails(o => o.CustomizeProblemDetails = ctx => ...)` runs for every
document the service writes, whatever produced it: exception, status code page,
`Results.Problem`, even the `AddValidation` 400. That makes it the place for
fields that belong on all errors:

```csharp
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path;
    ctx.ProblemDetails.Extensions["service"] = "games-api";
});
```

After that, the `400` from an invalid DTO, the `404` from `/nf` and the `500`
from `/boom` all carried `"instance":"/..."` and `"service":"games-api"`. The
context also exposes `ctx.Exception` when there is one.

### Not leaking details

Two separate leaks. The first is the body: `ex.Message` can hold a connection
string, a SQL fragment or a file path. In the run, `/boom` threw
`secret: Server=db;Password=hunter2` and the client saw only the generic title,
because the default exception handler writes no detail. The leak appears when
*you* copy `ex.Message` into `Detail`, as the `ArgumentException` handler above
does on purpose: that message is written for callers. The timeout handler
omitted `Detail` for exactly that reason. Return messages only from exception
types you own and wrote for clients.

The second is the Developer Exception Page, which shows stack traces, headers
and cookies and must stay in `Development`. `WebApplication` enables it
automatically there, so `UseExceptionHandler` is what protects production.

A third, quieter change in .NET 10: the exception handler middleware no longer
writes diagnostics (the `fail:` log line) for exceptions an `IExceptionHandler`
handled. My log showed only the unhandled `/boom`; `/arg`, `/nf` and `/timeout`
were silent. Setting `SuppressDiagnosticsCallback = _ => false` on
`ExceptionHandlerOptions` brought all of them back. Silence is right for
expected domain exceptions and wrong for a timeout you want an alert on, so
log inside the handler when it matters.

## Trade-offs

- **A global handler hides control flow.** Exceptions as `404` mean a
  `throw` far away decides the status code. Throwing for expected outcomes is
  slower than returning a result, so keep `Results.NotFound()` for the common
  path and the handler for the rest.
  ```csharp
  return game is null ? TypedResults.NotFound() : TypedResults.Ok(game);   // no exception
  ```
- **One shape for every error needs every path wired.** Status code pages,
  exception handler and validation each have a switch; miss one and that error
  is empty or a different shape. Add a test that hits a `404`, a `400` and a
  throw and asserts `application/problem+json`.
- **`Detail` is a contract.** Putting `ex.Message` in it ties clients to your
  exception wording and risks leaks. A stable `type` URI plus a short `title`
  is what clients should branch on.
- **Handler order matters.** The first handler that returns `true` wins, so a
  broad handler registered early shadows specific ones.
- **Content negotiation is a trap.** An `Accept: text/html` request gets no
  JSON document. If browsers hit the API, decide what they should see.

## Lab

In this lab you get an API with four failure scenarios that today return empty bodies or whatever the host decides. Your job is to wire up the problem details service, the exception handler middleware, status code pages and an `IExceptionHandler` that maps your own exception types. The core idea is to make a 404, an unknown route, a timeout and an unhandled exception all answer with the same `application/problem+json` shape, without leaking exception messages to clients.

**The scenario**

- `Program.cs`: registers the services and the pipeline (with TODOs) and maps `/games/{id:int}` (only id 1 exists, the others throw `GameNotFoundException`), `/timeout` (throws a `TimeoutException` with an internal host in the message) and `/boom` (throws an `InvalidOperationException` with `password=secret123` in the message).
- `GameNotFoundException.cs`: the domain exception, with the message `Game {id} not found`.
- `DomainExceptionHandler.cs`: an `IExceptionHandler` with a `switch` that decides status and title. It returns `false` for what is not its own and writes with `IProblemDetailsService`. Only our own exception messages are safe to show in `Detail`.

The tests run in the `Production` environment and check the content type, `Instance`, `Retry-After` and that no secret leaks.

**What you will do, step by step**

1. **Register problem details (TODO-00).** In `Program.cs`, call `AddProblemDetails` and customize it so that every document gets `Instance` set to the request path (when not already set).
2. **Register and enable the handler (TODO-01 and TODO-02).** Register `DomainExceptionHandler` as an exception handler and add the exception handler middleware, so thrown exceptions become responses.
3. **Give empty responses a body (TODO-03).** Add status code pages. Registering the service alone does not write a body for an unknown route: find out which middleware asks for it.
4. **Map the exceptions (TODO-04 and TODO-05).** In the `switch` of `DomainExceptionHandler`, `GameNotFoundException` becomes `(404, "Game not found")` and `TimeoutException` becomes `(503, "Service temporarily unavailable")`.
5. **Say when to retry (TODO-06).** For the timeout, which is temporary, send a `Retry-After` header of 5 seconds.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `/boom` answers a generic 500 without the exception message, why the handler returns `false` for unknown exceptions and why `AddProblemDetails` alone does not cover the unknown route.

**Optional challenges**

- **TODO-07:** request `/boom` with `curl` using `Accept: text/html` and compare it with `Accept: application/json`. What does the default writer do?
- **TODO-08:** replace the `return false` for unknown exceptions with `return true` without writing anything. What does the client receive?

**Prerequisites:** basic Minimal APIs, middleware order (the pipeline lab) and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The app compiles in the starter state and the tests fail until you complete the TODOs marked in comments in `Program.cs` and `DomainExceptionHandler.cs`.

## Documentation Links

- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [Handle errors in ASP.NET Core, IExceptionHandler, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling) (doc)
- [IExceptionHandler interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.diagnostics.iexceptionhandler) (doc)
- [IProblemDetailsService interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.iproblemdetailsservice) (doc)
- [Problem Details for HTTP APIs, RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (doc)
