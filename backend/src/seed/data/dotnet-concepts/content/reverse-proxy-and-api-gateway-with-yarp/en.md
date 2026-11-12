---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A reverse proxy takes requests from clients and forwards them to servers they never see. An API gateway is a reverse proxy that also owns the cross-cutting rules of the edge: which path goes to which service, who may call, how often, and what happens when a backend is down. YARP (Yet Another Reverse Proxy) is Microsoft's library for building one on ASP.NET Core. It is not a server you install: it is a NuGet package, a few lines in `Program.cs` and a configuration model of routes and clusters, so everything else in your pipeline (authentication, rate limiting, logging, `appsettings.json`) works as it already does. This concept builds a small gateway and measures what it does with two real Kestrel backends on free local ports: path rewriting and transforms, six load balancing policies, passive and active health checks, a rate limit and authentication at the edge, timeouts, and hot reload of the configuration. Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 and `Yarp.ReverseProxy` 2.3.0 (its newest target framework is net8.0, and it ran unchanged on .NET 10).

## Use Cases

- Putting one public address in front of several services, with `/orders/*` going to one cluster and `/billing/*` to another.
- Keeping cross-cutting edge rules (authentication, rate limit, CORS) in one place instead of repeating them in every service.
- Spreading load across instances and removing the ones that fail, without a separate load balancer product.
- Moving a monolith to services one route at a time: the gateway sends one prefix to the new service and everything else to the old app.
- Giving a Blazor or SPA front end a single origin for its API calls.

## Deep Dive

### Routes and clusters

The model has two parts. A route says which requests match (path, host, methods, headers) and which cluster takes them. A cluster is a set of destinations (addresses) plus the policies for choosing among them and checking their health. The same model binds from `appsettings.json` (`LoadFromConfig`) or is built in code (`LoadFromMemory`, which the lab uses so the tests can inject dynamic ports):

```csharp
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
app.MapReverseProxy();
```

```json
{
  "ReverseProxy": {
    "Routes": {
      "api": {
        "ClusterId": "backends",
        "Match": { "Path": "/api/{**catch-all}" },
        "Transforms": [ { "PathRemovePrefix": "/api" } ]
      }
    },
    "Clusters": {
      "backends": {
        "Destinations": { "a": { "Address": "http://orders-1:8080/" }, "b": { "Address": "http://orders-2:8080/" } }
      }
    }
  }
}
```

`MapReverseProxy` adds ordinary endpoints, so routing, `UseAuthentication`, `UseAuthorization`, `UseRateLimiter` and `UseCors` apply to proxied requests the way they apply to any endpoint. A request that matches no route gets a plain 404 from the gateway.

### What the backend sees: transforms

I put a gateway in front of a backend that echoes what it receives, and called `/api/hello?x=1`:

```text
A path=/hello?x=1 host=127.0.0.1:51685 xff=127.0.0.1 xfproto=http xfhost=127.0.0.1:51686 by=gateway
```

The gateway listened on port 51686 and the backend on 51685. Four things happened. `PathRemovePrefix` turned `/api/hello` into `/hello`. The query string went through. The `Host` header became the destination's host, not the gateway's: this is the default. And YARP added `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` on its own. My `RequestHeader` transform (`"RequestHeader": "X-Forwarded-By", "Set": "gateway"`) added the last one.

Other transforms I ran on the same gateway:

```text
/v1/orders/42?a=b with PathPattern "/internal/orders/{id}/detail" and QueryValueParameter source=gw
A path=/internal/orders/42/detail?a=b&source=gw ...
/host/hi with RequestHeaderOriginalHost = true
A path=/hi host=127.0.0.1:51686 ...                (the gateway's own host, not the backend's)
/nofwd/hi with "X-Forwarded": "Off"
A path=/hi host=127.0.0.1:51685 xff= xfproto= xfhost=
```

Keep the default `Host` unless the backend needs the public host name (for example to build absolute links); a backend that routes by `Host` and receives the wrong one is a classic proxy bug. If the backend is an ASP.NET Core app and must see the real client IP and scheme, it has to trust the `X-Forwarded-*` headers explicitly (`UseForwardedHeaders` with known proxies), which is the same trade-off described in the rate limiting concept.

### Load balancing

A cluster with several destinations picks one per request according to `LoadBalancingPolicy`. I made backend A answer instantly and backend B take 150 ms, and sent 60 requests, 12 at a time, through each policy:

```text
PowerOfTwoChoices  A=52 B=8     (the default)
RoundRobin         A=30 B=30
Random             A=31 B=29
LeastRequests      A=53 B=7
FirstAlphabetical  A=60 B=0
```

`RoundRobin` and `Random` ignore how loaded a backend is, so the slow one got half of the traffic. `PowerOfTwoChoices` (the default) and `LeastRequests` look at the number of requests in flight and shifted most of the work to the fast backend. `FirstAlphabetical` always picks the first destination: it is a failover order, not a load balancer. Session affinity (a cookie or header that pins a client to one destination) also exists; I did not test it, so see the docs before relying on it.

### Passive health checks

The passive check watches real traffic. With `HealthCheck.Passive` enabled and the `TransportFailureRate` policy, YARP marks a destination unhealthy when too many requests to it fail at the transport level. I stopped backend B and sent 30 requests in a row through a round-robin cluster:

```text
502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 502 200 200 200 200 200 200 200 200 200 200 200
```

Ten requests went to B and failed with 502, then B was out of rotation. The point is the price: a passive check learns from failures, so some real clients get an error before it reacts, and YARP does not retry the failed request on another destination by itself. The policy only starts judging a destination after `MinimalTotalCountThreshold` requests (10 by default, per the docs) and uses a 30% failure rate limit, which fits the 10 failures I saw. The docs say a destination returns to `Unknown` and receives traffic again after `ReactivationPeriod`. I set it to 5 s, waited 8 s and sent 24 more requests: none went to B and none failed. I did not find out why, so do not plan around the exact moment of recovery.

### Active health checks

The active check probes each destination on a timer, independent of client traffic. I enabled it with a 1 s interval and timeout, `ConsecutiveFailures` and path `/health`, then made B's `/health` return 503 while B kept answering normal requests with 200:

```text
B out of rotation after 1.0 s
B back after 1.0 s   (after /health returned 200 again)
```

This is the check to use for a destination that is up but unfit to serve (warming up, lost its database). It costs one probe per destination per interval, and it needs a `/health` endpoint on the backend (see the health checks concept for liveness versus readiness). Use both checks together: the active probe catches an instance before clients do, the passive one reacts inside the probe interval.

One behavior to know. I took every destination of a cluster out through the active check (A's `/health` returned 503) and called the route:

```text
status 200, body length 101
```

The request was proxied anyway. In my run, when no destination is healthy YARP still sends traffic to the cluster instead of failing the request, so "all unhealthy" does not become a 503 at the gateway. If you want a fast failure, you have to add it yourself.

### Timeouts and errors

I called a backend endpoint that takes 3 s:

```text
Cluster HttpRequest.ActivityTimeout 1 s: 504 after 1038 ms
Route Timeout 1 s without UseRequestTimeouts(): 500, InvalidOperationException
Route Timeout 1 s with UseRequestTimeouts():   400 after 1002 ms
destination refuses the connection:            502
```

`HttpRequest.ActivityTimeout` on the cluster (how long a request may stay idle) is the one that gave the clean 504 Gateway Timeout. A route-level `Timeout` requires `AddRequestTimeouts` and `UseRequestTimeouts` in the pipeline: without them the request failed with an exception that names the missing call, and with them the client got a 400 on this version, which is not what you would want to expose. A destination that is not listening gives 502 Bad Gateway. Treat 502 and 504 as the gateway's own vocabulary and test what your clients see.

### Rate limiting and authentication at the edge

Both are the ASP.NET Core features you already know, attached per route by name. In the lab, route `limited` has `RateLimiterPolicy = "per-client"` (a fixed window of 2 requests per 30 s, partitioned by the `X-Client-Id` header) and route `admin` has `AuthorizationPolicy = "apikey"` with a small API key handler. The tests send:

```text
c1: 200, 200, 429     c2: 200                       (rate limit per client)
/admin without key: 401   wrong key: 401   right key: 200
```

The rate limiter and the authorization middleware run before the proxy forwards anything, so a rejected request never reaches a backend. Three cautions. The limiter is per gateway instance, as the rate limiting concept explains, so two gateways give twice the quota. The partition key here is a client-supplied header and an attacker can invent unlimited keys; use an authenticated identity or the client IP behind a trusted proxy. And authentication at the edge only protects the backends if they are not reachable directly: the network, or mutual TLS between gateway and services, has to enforce that. By default the `Authorization` header is forwarded to the backend, so a service can validate the token again (defense in depth) at the cost of validating it twice.

### Configuration reload

The routes bind to `IConfiguration`, so a file with `reloadOnChange` updates the gateway while it runs. I added a route to the JSON file of a running gateway:

```text
/more before: 404
/more after edit: 200 within 333 ms, no restart
```

Routes and destinations can also come from a custom provider (for example a service registry or a database) by implementing `IProxyConfigProvider`; I did not run that path.

### A gateway is not a BFF

A gateway routes many clients to many services. A BFF (backend for frontend) belongs to one front end: it holds the user's session cookie and tokens on the server and calls the APIs on the user's behalf, as in the OIDC and BFF concept. They overlap in one place, forwarding, and YARP offers `IHttpForwarder` for code that decides per request where to send things:

```csharp
app.Map("/bff/{**rest}", (HttpContext ctx, IHttpForwarder forwarder) =>
    forwarder.SendAsync(ctx, "http://orders:8080/", invoker, new ForwarderRequestConfig(), transformer).AsTask());
```

I ran a forwarder like this and the backend received the request. Note that the forwarder only does what you configure: with a bare transformer none of the `X-Forwarded-*` headers were added, unlike the configured routes above.

### YARP against a managed gateway, Ocelot and Envoy

This part comes from documentation and general knowledge, not from my runs. A managed gateway (Azure API Management, Azure Front Door or Application Gateway, AWS API Gateway, a Kubernetes ingress) gives you a hosted control plane, TLS termination, a developer portal, API keys and quotas, with the operations done for you; you pay per call or per unit and accept its configuration model. YARP gives you a library in your own language: any logic is a few lines of C# (custom load balancing, a transform that reads a claim), it runs where your other .NET services run, and it is tested with `WebApplicationFactory` as in the lab. The cost is that you own the deployment, scaling, certificates and observability. Ocelot is another .NET gateway library, configured in a similar spirit; I did not compare how actively each is maintained. Envoy (and service meshes built on it) is a separate, non-.NET proxy usually chosen for polyglot platforms and very high throughput. A common split is a managed or Envoy-based entry point for the internet and YARP for application-aware routing inside a product.

## Trade-offs

- **A gateway is one more hop and one more thing that can fail.** It adds latency and a single point of failure; run at least two instances and keep its logic small.
- **Passive checks cost real requests.** Measured: 10 of the first requests failed with 502 before the destination left rotation, and nothing retried them. Add the active check so most failures are found by a probe.
  ```json
  "HealthCheck": { "Passive": { "Enabled": true, "Policy": "TransportFailureRate" },
                   "Active": { "Enabled": true, "Interval": "00:00:05", "Timeout": "00:00:02", "Path": "/health" } }
  ```
- **"All destinations unhealthy" is not an error.** In my run the traffic still went through to the cluster; decide whether you want a fast 503 and implement it.
- **Pick the load balancing policy on purpose.** With one slow backend, `RoundRobin` sent it half the traffic and `LeastRequests` sent it 7 of 60.
- **The right timeout setting matters.** `ActivityTimeout` produced a 504; a route `Timeout` without its middleware threw, and with it returned 400.
- **Edge authentication does not protect a backend that is reachable directly.** Isolate the network or use mutual TLS.
- **Edge limits are per instance and keyed by what you choose.** A client-supplied key is not a limit.
- **Keep business logic out of the gateway.** Routing, auth and limits belong there; aggregating data from several services turns it into a hidden monolith, and for that a BFF or a dedicated API is the better place.
- **Config drift is real.** Hot reload is convenient and also means a bad edit goes live in about a third of a second; validate the file in CI and review changes like code.

## Documentation Links

- [YARP documentation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/yarp-overview?view=aspnetcore-10.0) (doc)
- [YARP configuration files](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/config-files?view=aspnetcore-10.0) (doc)
- [YARP request and response transforms](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/transforms?view=aspnetcore-10.0) (doc)
- [YARP load balancing](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/load-balancing?view=aspnetcore-10.0) (doc)
- [YARP destination health checks](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/dests-health-checks?view=aspnetcore-10.0) (doc)
- [YARP rate limiting](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/rate-limiting?view=aspnetcore-10.0) (doc)
- [YARP authentication and authorization](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/authn-authz?view=aspnetcore-10.0) (doc)
- [YARP direct forwarding](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/direct-forwarding?view=aspnetcore-10.0) (doc)
- [dotnet/yarp, GitHub](https://github.com/dotnet/yarp) (doc)
