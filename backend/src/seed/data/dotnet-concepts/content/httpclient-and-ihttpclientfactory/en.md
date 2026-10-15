---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`HttpClient` looks like a disposable helper, and treating it like one is the
classic way to break a service in production. Each client owns a connection
pool, and the pool lives and dies with the handler underneath it. This concept
explains what that costs when you create clients per request, what a long-lived
client gets wrong about DNS, how `IHttpClientFactory` (named and typed clients,
handler lifetime, `DelegatingHandler`) fixes both, and what the exceptions
really look like when a request times out or is cancelled. Everything was run
against a local Kestrel server on the 10.0.100 SDK (runtime 10.0.0).

## Use Cases

- An API that calls a payment or catalog service on every request and must not
  leak sockets under load.
- Adding a correlation header or an API key to every outgoing call from one
  place instead of every call site.
- A service behind a load balancer or a blue/green deployment whose address
  changes while the process keeps running.
- Reading a large download or a long stream without buffering it in memory.

## Deep Dive

### One client per request exhausts sockets

Creating and disposing a client for every call throws away the connection pool
each time. Against a local server, 1000 such calls:

```csharp
for (int i = 0; i < 1000; i++)
{
    using var c = new HttpClient();
    await c.GetStringAsync("http://127.0.0.1:5300/ping");
}
```

left **1000 sockets in `TIME_WAIT`** (`netstat -an -p tcp`). A single shared
client doing the same 1000 calls added one. `TIME_WAIT` is the TCP state in which
the side that closed first holds the port for a while; the docs point to RFC 9293
for it. Looping until something broke, the 16256th request failed with
`HttpRequestException: Can't assign requested address (127.0.0.1:5300)` (inner
`SocketException`, `HttpRequestError.ConnectionError`), roughly the size of the
macOS ephemeral port range (49152 to 65535) on this machine. The limit is a
property of the operating system, so the number differs elsewhere, but the
failure mode does not.

### The static client and DNS

The fix everyone learns is one shared client. It has the opposite problem:
`HttpClient` resolves DNS only when it opens a connection, and by default a
pooled connection is kept as long as it is healthy (`PooledConnectionLifetime`
is infinite). The docs state that it does not follow DNS TTLs. I simulated a
name whose address changes at second 3 (a `ConnectCallback` that picks the port)
with two clients:

```text
t=2s  infinite lifetime -> server-5300   2s lifetime -> server-5300
--- DNS now answers with the new address (5301) ---
t=3s  infinite lifetime -> server-5300   2s lifetime -> server-5300
t=4s  infinite lifetime -> server-5300   2s lifetime -> server-5301
t=7s  infinite lifetime -> server-5300   2s lifetime -> server-5301
```

The client with the default settings kept talking to the old server until the
process died. Setting `PooledConnectionLifetime` on a `SocketsHttpHandler`
closes the connection after that time (once its last request finishes), and the
next connection resolves the name again:

```csharp
var shared = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) });
```

The official guidance accepts this as one of two valid strategies: a long-lived
client with `PooledConnectionLifetime`, or short-lived clients from
`IHttpClientFactory`. Never a client per request.

### IHttpClientFactory: named and typed clients

`AddHttpClient` (package `Microsoft.Extensions.Http`, part of the ASP.NET Core
shared framework) registers the factory. A named client is configured once and
fetched by string; a typed client is a class that takes an `HttpClient` in its
constructor:

```csharp
builder.Services.AddHttpClient("games", c => c.BaseAddress = new Uri("http://127.0.0.1:5300"));
builder.Services.AddHttpClient<GamesClient>(c => c.BaseAddress = new Uri("http://127.0.0.1:5300"));

class GamesClient(HttpClient http) { public Task<string> WhoAsync() => http.GetStringAsync("/who"); }
```

What the factory does, observed:

- Every `CreateClient` returns a **new `HttpClient`** (`ReferenceEquals` was
  false) that shares the **same handler** (true) while it is within its
  lifetime. 1000 calls to `CreateClient` plus `Dispose` per request left no
  growth in `TIME_WAIT`: disposing a factory client does not dispose the
  pooled handler.
- The default `HandlerLifetime` read back as `00:02:00`; `SetHandlerLifetime`
  changes it per client. When it expires, the next `CreateClient` gets a new
  handler and the old one is disposed once no client uses it.
- The chain behind a client was `LifetimeTrackingHttpMessageHandler`,
  `LoggingScopeHttpMessageHandler`, `LoggingHttpMessageHandler`, then a
  `SocketsHttpHandler` whose `PooledConnectionLifetime` read `00:02:00`. The
  docs call the factory-default primary handler an implementation detail, so
  do not cast it; use `ConfigurePrimaryHttpMessageHandler` or
  `UseSocketsHttpHandler` when you need control.
- The typed client is registered transient. The docs add two cautions: do not
  register the typed class a second time yourself (the later registration
  overwrites the factory's), and keep the number of distinct client names
  bounded, never derived from user input.

### Typed clients captured by singletons

Typed clients are meant to be short-lived: once one exists, the factory no
longer controls it. I gave `GamesClient` a 3 second handler lifetime and had
one transient copy resolved per use, plus one captured by a singleton, and
logged the client port the server saw once per second:

```text
t=2s  default handler: resolved 65452 captured 65452   |   explicit infinite SocketsHttpHandler: resolved 65453 captured 65453
t=3s  default handler: resolved 65457 captured 65458   |   explicit infinite SocketsHttpHandler: resolved 65459 captured 65453
t=7s  default handler: resolved 65462 captured 65463   |   explicit infinite SocketsHttpHandler: resolved 65464 captured 65453
```

With the default primary handler the captured client still rotated its
connection (it read `PooledConnectionLifetime` of two minutes at the default
handler lifetime, so it probably follows the handler lifetime), but with a
primary handler built as a plain
`new SocketsHttpHandler()` the captured one stayed on port 65453 forever. That
is the captive dependency from the earlier DI concept, applied to DNS. The
docs' remedies: inject `IHttpClientFactory` into the singleton and call
`CreateClient` when needed, or set `PooledConnectionLifetime` on the primary
handler yourself. Do not rely on the first behavior, since it comes from that
implementation detail.

### DelegatingHandler: outgoing middleware

A `DelegatingHandler` is the client-side counterpart of the middleware pipeline.
`AddHttpMessageHandler<T>` adds one, and the first one added is the outermost:

```csharp
builder.Services.AddTransient<TraceHandler>();
builder.Services.AddHttpClient<GamesClient>(...).AddHttpMessageHandler<TimingHandler>().AddHttpMessageHandler<TraceHandler>();

class TraceHandler(RequestInfo info) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        request.Headers.Add("X-Trace", info.Id);   // runs before the request leaves
        return base.SendAsync(request, ct);
    }
}
```

The log showed `TimingHandler: before`, `TraceHandler`, then `TimingHandler:
after`. There is a trap with scoped services. The factory creates its own DI
scope per handler instance, separate from the request scope. A scoped
`RequestInfo` was `787f50` in the first request scope and `f14957` in the second,
yet the handler saw `027923` in both, because the same cached handler served
both requests. The docs advise not caching scope data in handlers and describe a
transient scope-aware handler wrapped around the cached one for the cases that
need it.

### Timeouts and cancellation

`HttpClient.Timeout` defaults to 100 seconds (confirmed) and applies to every
request from that client. A `CancellationToken` applies to one call. The docs say
the shorter of the two wins. What you catch differs:

```csharp
catch (OperationCanceledException) when (ct.IsCancellationRequested)            { /* caller cancelled */ }
catch (OperationCanceledException ex) when (ex.InnerException is TimeoutException) { /* Timeout elapsed */ }
catch (HttpRequestException ex) { /* ex.StatusCode (after EnsureSuccessStatusCode) or ex.HttpRequestError */ }
```

Output with a 500 ms `Timeout`, a 200 ms token and a 2 second endpoint:
`caller cancelled`; without the token: `HttpClient.Timeout elapsed`; a `503`:
`ServiceUnavailable`; a closed port: `ConnectionError`. Both cancellations are a
`TaskCanceledException`; only the timeout has a `TimeoutException` inside and a
message naming `HttpClient.Timeout`. Always pass the caller's token down, as in
the coordinating-concurrent-work concept; a `Timeout` alone cannot tell a client
disconnect from a slow server.

### ResponseHeadersRead and GetFromJsonAsync

By default `GetAsync` returns only after the whole body is buffered. Against an
endpoint that sends headers at once and the body over three seconds:

```text
ResponseContentRead: GetAsync returned after 3009 ms
ResponseHeadersRead: GetAsync returned after 0 ms (body read to the end after 3006 ms)
first 512 bytes after 20 ms when streaming with ReadAsStreamAsync
```

Use `HttpCompletionOption.ResponseHeadersRead` to look at status and headers
first, or to stream a large body. Two consequences were observed: a client with a
1500 ms `Timeout` read the full three second body without error (the timeout
covered getting the headers, not the later read), and you must dispose the
response yourself.

`GetFromJsonAsync<T>` (`System.Net.Http.Json`) does the request and the
deserialization. A `404` threw `HttpRequestException` (it checks the status
for you), a body of `null` returned `null` with no exception, a non-JSON body
threw `JsonException`. `GetFromJsonAsAsyncEnumerable<T>` yielded items at 409,
812, 1211, 1612 and 2013 ms, while `GetFromJsonAsync<List<T>>` returned all five
at 2009 ms.

## Trade-offs

- **A static client is simplest, but only with the right setting.** Without
  `PooledConnectionLifetime` it never sees a DNS change. The factory gives named
  configuration and handler pipelines in exchange for a package and a lifetime
  model to understand.
  ```csharp
  new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) }
  ```
- **Typed clients are convenient and easy to capture.** Injected into a
  singleton, they escape the factory's control. A named client plus
  `CreateClient` per use avoids it.
- **Handler rotation recycles state.** The docs warn that cookies in a pooled
  `CookieContainer` are shared and lost when a handler expires, so avoid the
  factory when you depend on cookies.
- **Handlers have their own DI scope.** A scoped service is shared by many
  requests there. Pass per-request data on the `HttpRequestMessage`, not through
  handler constructors.
- **`Timeout` is blunt.** One value per client, 100 seconds by default, and it
  stops covering the body under `ResponseHeadersRead`. Per-call limits belong on
  a linked token with `CancelAfter`.
  ```csharp
  using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
  cts.CancelAfter(TimeSpan.FromSeconds(5));
  ```
- **`ResponseHeadersRead` transfers cleanup to you.** Dispose the response, or
  the connection stays busy.
- **`GetFromJsonAsync` hides the status code.** It throws on non-success, so
  use `GetAsync` when you must read a `ProblemDetails` body from a `4xx`.

## Documentation Links

- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [HttpClient guidelines for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines) (doc)
- [Send a request using HttpClient, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient) (doc)
- [HttpClient.Timeout, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.timeout) (doc)
- [HttpCompletionOption, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpcompletionoption) (doc)
- [SocketsHttpHandler.PooledConnectionLifetime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.pooledconnectionlifetime) (doc)
- [Make HTTP requests using IHttpClientFactory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests) (doc)
