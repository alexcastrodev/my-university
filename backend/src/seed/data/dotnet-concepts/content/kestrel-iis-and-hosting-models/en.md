---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

An ASP.NET Core app is a console program that owns a web server. The server is
an `IServer` implementation, and the framework does not care which one: it turns
raw connections into `HttpContext` objects and hands them to your middleware
pipeline. In practice there are three places that server can live: Kestrel on
its own, Kestrel behind a reverse proxy, or IIS (in-process or out-of-process).
The goal is to understand what each model changes about who terminates TLS,
who sees the real client address, which limits apply, and what you must
configure so the app behaves the same behind a proxy as it does on your laptop.

## Use Cases

- Choosing between exposing Kestrel directly and putting nginx, YARP, an
  ingress, or a cloud load balancer in front of it.
- Debugging an app behind a proxy that thinks every request is `http` from
  `127.0.0.1`, which breaks redirects, absolute links, and rate limiting.
- Raising or lowering the request body limit for an upload endpoint.
- Migrating an app from a Windows IIS server to a Linux container, and knowing
  which settings stop applying.

## Deep Dive

### Kestrel is the default server

`WebApplication.CreateBuilder` registers Kestrel unless something else is
configured. It is cross-platform, built on managed sockets and
`System.IO.Pipelines`, and speaks HTTP/1.1, HTTP/2 and HTTP/3. The official
docs say Kestrel can be used as an edge (Internet-facing) server on its own, and
that a reverse proxy is still useful when you want a shared port among several
processes, extra security layers, or load balancing. Both are valid; the choice
is operational, not a matter of Kestrel being "unsafe".

Plain-text endpoints speak HTTP/1.1 only. HTTP/2 is negotiated through ALPN
during the TLS handshake, so it needs an HTTPS endpoint. Running a tiny app with
one endpoint of each kind and asking curl for each protocol shows it:

```csharp
// k.cs, run with: dotnet run k.cs   (file-based app, SDK 10.0.100)
#:sdk Microsoft.NET.Sdk.Web
using Microsoft.AspNetCore.Server.Kestrel.Core;

var b = WebApplication.CreateBuilder(args);
b.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = 10;                 // bytes, tiny on purpose
    o.ListenLocalhost(5280);                          // plain HTTP
    o.ListenLocalhost(5281, l =>
    {
        l.Protocols = HttpProtocols.Http1AndHttp2;
        l.UseHttps("t.pfx", "x");                     // a throwaway self-signed cert
    });
});
var app = b.Build();
app.MapGet("/info", (HttpContext c) => $"proto={c.Request.Protocol} scheme={c.Request.Scheme}");
app.MapPost("/echo", async (HttpContext c) =>
    (await new StreamReader(c.Request.Body).ReadToEndAsync()).Length.ToString());
app.Run();
```

```text
$ curl -si http://localhost:5280/info           -> Server: Kestrel   proto=HTTP/1.1 scheme=http
$ curl -sik --http2 https://localhost:5281/info -> HTTP/2 200        proto=HTTP/2 scheme=https
$ curl -sik --http1.1 https://localhost:5281/info                    proto=HTTP/1.1 scheme=https
$ curl --http2-prior-knowledge http://localhost:5280/info            (fails: the plain port is HTTP/1.1 only)
```

The docs list a macOS caveat for HTTP/2 and say macOS is for development, not
for production server workloads. On the machine used for this lesson HTTP/2
over TLS negotiated fine; treat the platform table in the docs as the contract
for production and your own test as a convenience.

### Limits are Kestrel's job, so they move with the server

Kestrel enforces limits before your code runs. The one that bites first is
`MaxRequestBodySize`, whose default is 30,000,000 bytes (about 28.6 MB). When a
body goes over it, the request is rejected without reaching the handler:

```text
$ curl -si -X POST -d "aaaaaaaaaaaaaaaaaaaa" http://localhost:5280/echo   (limit set to 10)
HTTP/1.1 413 Payload Too Large
Connection: close
```

Other limits worth knowing by name are `MaxConcurrentConnections`,
`KeepAliveTimeout` and `RequestHeadersTimeout`. You can also change the body
limit for one endpoint with `[RequestSizeLimit]` or
`IHttpMaxRequestBodySizeFeature`, but only before the body is read. A proxy has
its own limits too (nginx defaults to 1 MB for `client_max_body_size`), and the
smallest one in the chain wins, which is why an upload can fail with a 413 that
your app logs never show.

### Behind a reverse proxy: forwarded headers

A proxy opens a new connection to Kestrel, so from the app's point of view every
request comes from the proxy, over plain HTTP. The proxy tells you the truth in
`X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, and the
`ForwardedHeaders` middleware copies them into `Request.Scheme`,
`Connection.RemoteIpAddress` and `Request.Host`:

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear();
    o.KnownNetworks.Clear();
    o.KnownProxies.Add(IPAddress.Parse("10.9.9.9")); // the proxy you actually run
});

var app = builder.Build();
app.UseForwardedHeaders();   // first, before anything that reads scheme or IP
```

The trust list is the important part, because any client can send those
headers. The middleware ignores the headers from a sender that is not on the
list, and the default lists contain only loopback addresses. That default has a
trap that the test below exposed: adding `10.9.9.9` to `KnownProxies` did **not**
stop a loopback caller from being trusted, because the loopback entry is still in
the list. Only after `Clear()` on both lists did the same spoofed request
behave correctly:

```text
curl -H "X-Forwarded-For: 203.0.113.9" -H "X-Forwarded-Proto: https" http://localhost:5280/info
default lists + Add(10.9.9.9):  scheme=https ip=203.0.113.9   (spoofed values accepted)
after Clear() + Add(10.9.9.9):  scheme=http  ip=::1           (spoofed values ignored)
```

Two more facts from the docs. `ForwardLimit` defaults to 1, so only the
rightmost entry of a multi-value header is processed. And setting
`ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` turns the middleware on with
settings meant for cloud environments, without a `KnownProxies` restriction, so
use it only when the network already guarantees that nobody can reach the app
except through the proxy.

### IIS: in-process versus out-of-process

> This section comes from the official documentation only. IIS and the
> ASP.NET Core Module cannot run on the macOS machine used to write this lesson,
> so none of it was executed.

On Windows, IIS fronts the app through the ASP.NET Core Module. Since
ASP.NET Core 3.0 the default is **in-process** hosting: the app runs inside the
IIS worker process (`w3wp.exe`) and uses `IISHttpServer` instead of Kestrel, so
requests are not proxied over the loopback adapter. You can state it explicitly
with `<AspNetCoreHostingModel>InProcess</AspNetCoreHostingModel>` in the
project file. Consequences listed by the docs:

- Kestrel is not used, so `ConfigureKestrel` settings do not apply. The body
  limit comes from `IISServerOptions.MaxRequestBodySize` (default 30,000,000),
  and IIS applies its own `maxAllowedContentLength` first.
- One app pool per app, and the bitness of the app must match the pool.
- Single-file executables cannot be loaded by in-process hosting.

Out-of-process mode keeps Kestrel and makes IIS a reverse proxy, which is the
same shape you get on Linux with nginx, just with a different proxy.

### Memory returns to the system in ASP.NET Core 10

Kestrel rents buffers from a memory pool. Before ASP.NET Core 10 that pool kept
the memory it had grown to during a traffic peak. The ASP.NET Core 10 release
notes say the pools used by Kestrel, IIS and HTTP.sys now evict blocks
automatically when the app is idle or under less load, with no configuration,
and that new metrics are published under the meter name
`Microsoft.AspNetCore.MemoryPool`. This was not measured here; the claim is the
release notes' claim. A practical effect: a container that spiked once no
longer holds that memory just because the spike happened.

## Trade-offs

- **Kestrel alone is simple, a proxy is more to run.** Direct exposure removes a
  hop and a config file, but you own certificate renewal, request filtering,
  and the port-sharing limit (two processes cannot share one port without a
  proxy in front).
- **A proxy hides the client unless you configure it.** Without
  `UseForwardedHeaders`, `https` redirects loop and logs show the proxy IP.
  ```csharp
  app.UseForwardedHeaders(); // must come before UseHsts and UseHttpsRedirection
  ```
- **Trusting the forwarded headers too widely is a security hole.** If
  `KnownProxies` is left at the default on a network where clients can reach
  the app directly, anyone can spoof their IP in `X-Forwarded-For`.
- **Limits live in several layers.** Kestrel, IIS, the proxy and the cloud load
  balancer each cap body size and timeouts; the lowest wins and the failing
  layer may not be the one with the log.
- **In-process IIS is fast but couples the app to Windows and to IIS.**
  Moving to a container means switching to Kestrel and re-checking every
  setting that was really an IIS or `web.config` setting.

## Documentation Links

- [Kestrel web server in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [In-process hosting with IIS and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/in-process-hosting) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
