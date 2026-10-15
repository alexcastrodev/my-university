---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

When an endpoint misbehaves in production you want to see what actually arrived and what went out, without leaking the data the request carried. ASP.NET Core has two middlewares for that, HTTP logging and W3C logging, plus structured logging with correlation ids to tie everything together. This concept shows what each one writes by default (which is less than most people expect), what turns on the sensitive parts, how to switch things off per endpoint or per request, and how a trace id ends up on every line. Everything was run on the 10.0.100 SDK (runtime 10.0.0) against a small minimal API.

## Use Cases

- Finding out why a client gets a 400: which headers and which body did the server really see.
- Keeping an access log in a standard file format for tools that already read it.
- Logging a request without ever writing a password, token or query-string secret to disk.
- Following one request across log lines from the middleware and from your own code.

## Deep Dive

### HTTP logging is off until you ask twice

Two calls enable the middleware, `AddHttpLogging` and `UseHttpLogging`. That is not enough to see anything. The project template sets the `Microsoft.AspNetCore` category to `Warning`, and the middleware logs at `Information`. With only the two calls my run printed zero lines from `HttpLoggingMiddleware`. The docs' fix is a category entry in `appsettings.Development.json`:

```json
"Microsoft.AspNetCore.HttpLogging.HttpLoggingMiddleware": "Information"
```

(I passed the same key as a command line argument.) With that, a `GET /search?q=secret-token` sent with an `Authorization` and an `X-Correlation-Id` header produced two messages, event ids 1 and 2:

```text
Request:
  Method: GET
  Path: /search
  Authorization: [Redacted]
  X-Correlation-Id: [Redacted]
Response:
  StatusCode: 200
  Content-Type: text/plain; charset=utf-8
```

Two defaults to notice. Header values are logged only for names on an allow list; everything else shows `[Redacted]` (the docs describe `RequestHeaders` and `ResponseHeaders` as the sets whose values are logged). And the query string `?q=secret-token` is not in the output at all.

### What the field flags really include

`HttpLoggingFields` is a flags enum. I printed its values:

```text
RequestPath=0x1  RequestQuery=0x2  RequestProtocol=0x4  RequestMethod=0x8
RequestScheme=0x10  RequestProperties=0x1D  ResponseStatusCode=0x20
RequestHeaders=0x40  ResponseHeaders=0x80  RequestBody=0x400
ResponseBody=0x800  Duration=0x1000  All=0x1CFD
```

`RequestProperties` is `0x1D`, which leaves out `RequestQuery` (`0x2`), and so does `All` (`0x1CFD` also omits the two trailer flags). The query string is the one thing `All` does not log. You opt in on purpose:

```csharp
o.LoggingFields = HttpLoggingFields.RequestPropertiesAndHeaders | HttpLoggingFields.RequestQuery;
```

and the line `QueryString: ?q=secret-token` appears. Ask yourself whether it should: query strings are where tokens and emails end up.

### Bodies, limits and one combined line

With `All`, a body limit of 40 and `CombineLogs = true`, a `POST /login` with a JSON body logged a single message (event id 9) instead of two:

```text
Request and Response:
  Authorization: [Redacted]
  X-Correlation-Id: abc-123        (added to RequestHeaders)
  RequestBody: {"user":"alice","password":"hunter2","no
  RequestBodyStatus: [Truncated by RequestBodyLogLimit]
  ResponseBody: {"ok":true}
  Duration: 6,357                  (ms; the comma is this machine's decimal separator)
```

The password is in the log. The limit only truncated it, and only because the body was long. The docs warn that HTTP logging can log personally identifiable information and can reduce performance, especially with bodies. Treat body logging as a temporary diagnostic, not a setting.

### Per endpoint and per request control

`WithHttpLogging` (or the `[HttpLogging]` attribute) overrides the global fields for one endpoint:

```csharp
app.MapGet("/health", () => "ok").WithHttpLogging(HttpLoggingFields.None);
app.MapGet("/dur", () => "d").WithHttpLogging(HttpLoggingFields.Duration | HttpLoggingFields.ResponseStatusCode);
```

`/health` wrote nothing, which is what you want for a probe hit every few seconds. `/dur` wrote only a `StatusCode` message and a `Duration` message. For decisions that depend on the request, register an `IHttpLoggingInterceptor` with `AddHttpLoggingInterceptor`. The docs list the order: global options, then endpoint settings, then the interceptor, which can change both. Mine removed the body for `/login`, replaced the query and added the trace id:

```csharp
public ValueTask OnRequestAsync(HttpLoggingInterceptorContext c)
{
    if (c.HttpContext.Request.Path.StartsWithSegments("/login"))
        c.LoggingFields &= ~HttpLoggingFields.RequestBody;
    if (c.TryDisable(HttpLoggingFields.RequestQuery)) c.AddParameter("Query", "[hidden]");
    c.AddParameter("TraceId", c.HttpContext.TraceIdentifier);
    return default;
}
```

```text
Query: [hidden]
TraceId: 0HNPAULADS3DJ:00000001
Method: POST
Path: /login
ResponseBody: {"ok":true}
```

Redaction has to cover the response too: `GET /search?q=secret-token` echoed the value, and `ResponseBody: q=secret-token` was logged even though the query was hidden. The docs also describe a data redaction route (`AddHttpLoggingRedaction` with `AddRedaction`); I did not run it.

### W3C logging: a file, not a logger

`AddW3CLogging` plus `UseW3CLogging` writes a W3C extended log file, not `ILogger` messages. Pointed at a scratch folder, one request and one 404 produced:

```text
#Version: 1.0
#Fields: date time c-ip s-computername s-ip s-port cs-method cs-uri-stem cs-uri-query sc-status time-taken cs-version cs-host cs(User-Agent) cs(Referer)
2026-10-15 19:48:59 ::1 <machine> ::1 5401 GET /search ?q=secret-token 200 4.3882 HTTP/1.1 localhost:5401 curl/8.7.1 -
2026-10-15 19:48:59 ::1 <machine> ::1 5401 GET /nope - 404 0.1161 HTTP/1.1 localhost:5401 curl/8.7.1 -
```

The file name was `w3clog-20261015.0000.txt`. Note what differs from HTTP logging: the query string is in by default, and so is the server's host name. The docs say the defaults exclude `UserName` and `Cookie` and give these defaults: `./logs/` under the content root, 10 MB size limit, 4 retained files, 1 second flush. Because it writes to disk, make sure the folder exists on a read-only container image and is rotated.

### Correlation and LoggerMessage

Your own log lines need the same identifiers. Console scopes are off in the template, so I enabled them (`Logging:Console:IncludeScopes=true`) and logged from a source-generated method:

```csharp
static partial class Msgs
{
    [LoggerMessage(EventId = 100, Level = LogLevel.Information,
        Message = "Handled order for {User} with {Items} items")]
    public static partial void Handled(ILogger logger, string user, int items);
}
```

Sending a W3C `traceparent` header, both my line and the middleware line carried the scope below, and the `TraceId` equals the one I sent:

```text
=> SpanId:729c0cc2e7b2a4cf, TraceId:0af7651916cd43dd8448eb211c80319c, ParentId:b7ad6b7169203331
=> ConnectionId:0HNPAULI8S6MD => RequestPath:/corr RequestId:0HNPAULI8S6MD:00000001
Handled order for alice with 3 items
```

Also note `traceparent` itself printed as `[Redacted]` because it is not on the allow list; the trace id is still available through the scope. The `{User}` and `{Items}` placeholders stay named, so a structured sink can query them.

## Trade-offs

- **Bodies are a leak waiting to happen.** Log them only for a short, targeted diagnosis, with a small limit.
  ```csharp
  o.RequestBodyLogLimit = 1024; // still logs the first 1 KB of a password form
  ```
- **The allow list is a safety net, not a policy.** Adding a header name to `RequestHeaders` logs its value from then on, including `Authorization` if you add it.
- **Two logs, two defaults.** HTTP logging omits the query string, W3C logging includes it. Know which file your secrets can land in.
- **Interceptors cost code on every request.** They give per-request control, but a bug in one affects all traffic. Keep them tiny.
- **Probe and static endpoints add noise.** Turn them off with `WithHttpLogging(HttpLoggingFields.None)` rather than filtering later.
- **Response bodies leak too.** Redacting the request is not enough when the response echoes the input.

## Documentation Links

- [HTTP logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-logging/) (doc)
- [W3CLogger in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/w3c-logger/) (doc)
- [Logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [Trace Context, W3C Recommendation](https://www.w3.org/TR/trace-context/) (doc)
