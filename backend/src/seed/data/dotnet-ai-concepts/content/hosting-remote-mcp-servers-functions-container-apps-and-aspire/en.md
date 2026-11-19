---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A remote MCP server is an ordinary ASP.NET Core app, so everything that hurts a web app in production hurts it too, with two twists: a call can stream for minutes, and (for older clients) a session lives in one process's memory. I put one server behind nginx in Docker with two and three replicas and measured what breaks: round robin against sessions, response buffering and read timeouts on an SSE stream, graceful shutdown, `AllowedHosts` behind a proxy, body limits, a per-replica rate limiter, and what a restart destroys. Then I ran the same server as two replicas under an Aspire AppHost. Azure Functions and Azure Container Apps need an Azure account, so they are read from the documentation and marked "docs only", ending in a table of hosting targets. Versions: `ModelContextProtocol.AspNetCore` and `ModelContextProtocol` 2.4.0, `Aspire.AppHost.Sdk` 13.6.4 with `Aspire.Hosting.Orchestration.osx-arm64` 13.6.4, TFM `net10.0`, .NET SDK 10.0.100, container runtime 10.0.15 (`aspnet:10.0-noble-chiseled`), nginx 1.29.8, Docker on arm64, spec 2026-07-28. `Microsoft.Azure.Functions.Worker.Extensions.Mcp` 1.6.0 is read from NuGet, not run.

## Use Cases

- Putting an MCP server behind a load balancer without breaking sessions of older clients.
- Keeping a long tool call alive through a proxy that buffers or times out.
- Shipping the server as a small non-root image with probes that Kubernetes or Container Apps can use.
- Choosing between Container Apps, Functions, Kubernetes and a local Aspire run for a given MCP workload.

## Deep Dive

### The lab

One ASP.NET Core project (`AddMcpServer().WithHttpTransport(o => o.SessionMode = ...)`) with three tools (`whoami` returns the replica name, `ticker` sends N progress notifications, `silent` sleeps), `/health/live`, `/health/ready`, an `X-Replica` response header, and settings read from environment variables (`SESSION_MODE`, `RATE_LIMIT`, `MAX_BODY`). It runs as containers `mcphost-a` and `mcphost-b` (plus `mcphost-c` for edge settings) in a private Docker network, behind `mcphost-lb` (nginx on 6280 to 6294, one `server` block per experiment). A probe console app uses the SDK client (default 2026-07-28, or pinned to `2025-11-25`) and raw `HttpClient`/`curl` calls. Sessions were measured as "20 sessions, each does `initialize` and 3 tool calls; ok means all of it worked".

### Stateless scales with round robin

The 2026-07-28 default client does no handshake and sends no session id, so any replica can answer any request:

```text
negotiated=2026-07-28 session=(none)
call 1: b pid=1      call 2: a pid=1      call 3: b pid=1
call 4: a pid=1      call 5: b pid=1      call 6: a pid=1
```

### Stateful needs affinity, and the header hash does not give it

With `SessionMode.Stateful`, a client pinned to `2025-11-25` gets `Mcp-Session-Id` from the replica that served `initialize`. Through plain round robin, every other request lands on the replica that has never seen the session (`X-Replica` shows where it went):

```text
initialize:   200  X-Replica: a  session=ZmjjwwKmzGJ1m3-lG_XgEw
tools/list 1: 404  X-Replica: b  {"error":{"code":-32001,"message":"Session not found"},"id":2,...}
tools/list 2: 200  X-Replica: a
tools/list 3: 404  X-Replica: b
```

The SDK client usually dies inside `McpClient.CreateAsync`, because even `notifications/initialized` can miss (under the Aspire proxy: `ClientTransportClosedException: The server returned HTTP 404 for a request with an Mcp-Session-Id, indicating the session has expired.`). The obvious fix, `hash $http_mcp_session_id consistent;` in the nginx `upstream`, is a trap: the id does not exist when `initialize` is routed, and the replica that mints it is not the replica the hash picks later. Results for 20 sessions each:

| routing | sessions ok |
| --- | --- |
| round robin | 0 of 20 |
| `hash $http_mcp_session_id consistent` | 10 of 20 and 9 of 20 (a coin flip) |
| cookie affinity, client keeps cookies | 20 of 20 |
| cookie affinity, `UseCookies = false` | 0 of 20 |
| `StatefulForInitializeClients`, default (2026-07-28) clients, round robin | works, alternates a and b |
| `StatefulForInitializeClients`, `initialize` clients, round robin | 0 of 20 |

Cookie affinity is what works: the server sets a cookie naming itself, and nginx maps it to a pool.

```csharp
ctx.Response.Headers.Append("Set-Cookie", $"mcp_replica={replica}; Path=/; HttpOnly");   // on every response
```

```nginx
map $cookie_mcp_replica $pool { a pool_a; b pool_b; default rr; }   # unknown client: round robin
server { listen 6284; location / { proxy_pass http://$pool; } }
```

The cookie name matters: my first attempt used `mcp-replica` and nginx kept routing by round robin; with `mcp_replica` (underscore, so it maps cleanly to `$cookie_mcp_replica`) it worked. Cookie stickiness is also what Container Apps and YARP do (docs only below), and it fails for any client that drops cookies, so the real fix is to stay stateless and use `StatefulForInitializeClients` only for legacy clients.

### SSE behind a proxy: what delays the first event

`ticker` (5 progress events, 500 ms apart) answers as `text/event-stream`. The server response says what it expects of a proxy:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache,no-store
Content-Encoding: identity
X-Accel-Buffering: no
```

The client logs when each event arrives (first event, then total):

```text
direct to the replica                                         first 531 ms   last 2534 ms
nginx defaults, HTTP/1.1 upstream (proxy_buffering on)        first 518 ms   last 2515 ms
nginx with proxy_buffering off                                first 517 ms
nginx 1.0 upstream (its real default), header honored         first 526 ms
nginx 1.0 upstream + proxy_ignore_headers X-Accel-Buffering   first 2540 ms (one burst at the end)
nginx gzip on for text/event-stream, header ignored           first 2523 ms (one burst at the end)
nginx gzip on, header honored                                 first 520 ms
```

`X-Accel-Buffering: no` and `Content-Encoding: identity` make nginx stream by itself, so the stock config works. A proxy that ignores them (another vendor, a CDN, `proxy_ignore_headers`) buffers: the user sees no progress for the whole call. Keep `proxy_buffering off` on the MCP location anyway, and never compress `text/event-stream`. A silent call is a separate problem: `silent 8` with `proxy_read_timeout 3s` ended as `504 (Gateway Time-out) after 3023 ms`, but `ticker` with 8 events one second apart through the same proxy finished (`done on a after 8021 ms`), because each event resets the read timer. Progress notifications double as keepalive.

### Container, probes and shutdown

`dotnet publish -t:PublishContainer` with `<ContainerFamily>noble-chiseled</ContainerFamily>` produced a 188 MB image (53.3 MB compressed) running as user `1654`, listening on 8080; the default Ubuntu family gave 406 MB, same user, a shell, and no `curl` or `wget`. The chiseled image has no shell either (`docker exec ... /bin/sh` fails), so a Docker `HEALTHCHECK` that shells out cannot run; probes belong to the orchestrator over HTTP. Liveness and readiness are separate endpoints, and neither is `/mcp`:

```text
ready=200 live=200
POST /admin/downstream/false  ->  ready=503 (Unhealthy)  live=200 (Healthy)  /mcp still answers 200
```

Readiness fails while a dependency is down (the orchestrator stops routing); liveness answers `200` as long as the process runs, so it is not restarted. Open source nginx has no active health checks, only passive ones (`max_fails`): readiness is for Kubernetes, Container Apps or a proxy that supports it.

Rolling deploys send SIGTERM. A 5 s call started 1.5 s before `docker stop` finished normally (`docker stop returned after 5163 ms`). A 40 s call was cut when the 10 s grace period ended (`The response ended prematurely` after 11.7 s); with `docker stop -t 60` it was still cut, at 31.7 s, because the .NET host waits only `HostOptions.ShutdownTimeout`, 30 s by default. Raise the platform grace period and the host timeout together, and make clients retry (see the retry lesson). Container Apps sends SIGTERM and kills after 30 s (docs only).

### Edge settings behind a proxy

- **Host header.** Replica `c` runs with `AllowedHosts=localhost`. nginx forwards `Host: c` by default (`$proxy_host`) and the request fails; with `proxy_set_header Host $host;` it passes. `AllowedHosts` also needs the proxy to forward the public name, and `UseForwardedHeaders` if the app builds absolute URLs.

```text
proxy_set_header Host $proxy_host  ->  400 Bad Request
proxy_set_header Host $host        ->  200 OK
```

- **Body limit.** An MCP request with a 1953 KB body: direct to Kestrel `200` (its default limit is 30 MB); through nginx `413 Request Entity Too Large` (`client_max_body_size` defaults to 1 MB); a 68 KB body to replica `c` (`Limits.MaxRequestBodySize = 65536`) got `413 Payload Too Large` from Kestrel. Size the limit to your largest legitimate tool arguments, at the proxy and in the app.
- **Rate limiting.** `AddRateLimiter` with a fixed window of 5 per 10 s, partitioned by `X-Api-Key`, rejecting with 429 and a `Retry-After` header set in `OnRejected`:

```text
req 5 key=alice -> 200 replica=a Retry-After=-
req 6 key=alice -> 429 replica=a Retry-After=10
req 1 key=bob   -> 200 replica=a          (own partition)
through round robin, key alice, 12 requests: 200 on 1..10 (a, b, a, b ...), 429 on 11 and 12
```

The limiter lives in each process, so two replicas accepted 10 requests for a limit of 5: limit at the edge (nginx `limit_req`, API gateway) or with a shared store when the number must be exact. `Retry-After` carried the window length (10), not the time left in the window.

- **TLS** terminates at nginx, ingress or the load balancer; the MCP server and the lab spoke plain HTTP (docs only). The security lesson covers `Origin`, tokens and DNS rebinding.

### Restart and scale to zero

A client with an `initialize` session on replica `a`, then `docker restart mcphost-a`, then `tools/list` through cookie affinity: `404` with `{"code":-32001,"message":"Session not found"}`. The session table lived in process memory, and so does anything else you keep there (task state of the tasks extension, subscriptions, caches). A stateless 2026-07-28 client through round robin went on working across the restart (`a pid=1`, then `b pid=1`). Scaling to zero is a restart with a delay, so keep durable state outside the process and, for interactive hosts, a minimum of one replica.

### Aspire AppHost for local orchestration

An AppHost starts replicas as plain processes, no Docker, and hands the client the address (the AppHost lesson covers service discovery and the dashboard):

```csharp
var mcp = builder.AddProject<Projects.McpHost_Server>("mcp")
    .WithHttpEndpoint(port: 6295, name: "http")     // AppHost proxy; replicas get dynamic target ports
    .WithReplicas(2)
    .WithHttpHealthCheck("/health/ready")           // readiness, not /mcp
    .WithEnvironment("SESSION_MODE", mode);
builder.AddProject<Projects.McpHost_Probe>("client").WithReference(mcp).WaitFor(mcp);
```

The client read `services__mcp__http__0` (`http://localhost:6295`), and the DCP proxy listened on 6295 with replicas on two ports picked by Aspire (27673, 27674). Six calls from one `HttpClient` all returned the same pid: the proxy most likely balances per connection, so a single keep-alive client sticks to one replica (stateful by accident). With `SessionMode=Stateful` the `initialize` client failed with the 404 above. Do not trust a local run to reveal affinity bugs: test through a per-request balancer such as the nginx lab. Wiring a ready-made inspector into the AppHost exists in the Community Toolkit (`CommunityToolkit.Aspire.Hosting.McpInspector`, prerelease, not run).

### Azure Functions (docs only)

Two ways: the MCP extension (`Microsoft.Azure.Functions.Worker.Extensions.Mcp`, 1.6.0 on NuGet, isolated worker only) or a self-hosted server built with the SDK. The extension maps a trigger to a tool, with endpoint `/runtime/webhooks/mcp`, and in Azure demands the system key `mcp_extension` in `x-functions-key` (or `webhookAuthorizationLevel: Anonymous` plus built-in authorization):

```csharp
[Function(nameof(SayHello))]
public string SayHello([McpToolTrigger("hello", "Says hello")] ToolInvocationContext context) => "Hello I am MCP Tool!";
```

Its SSE transport (`/runtime/webhooks/mcp/sse`) uses Queue storage and is called deprecated by newer protocol versions. The self-hosted mode (public preview) runs your own server as a custom handler (`"configurationProfile": "mcp-custom-handler"`), only stateless Streamable HTTP, only on Flex Consumption, and no F5 debugging (`func start` instead). HTTP-triggered functions are cut at 230 s regardless of the function timeout (Azure Load Balancer idle timeout), so long calls need progress notifications or the tasks extension.

### Azure Container Apps (docs only)

Container Apps has no MCP awareness: it gives HTTPS ingress with TLS 1.2 or 1.3, autoscaling including zero, CORS and optional Entra ID authentication to a container that listens on a target port (transport `auto` or `http`). Limits from the docs: ingress request timeout 240 s; session affinity is cookie based, only in single revision mode with HTTP ingress; scale-in to zero waits 300 s of cool down by default; SIGTERM, then SIGKILL after 30 s; Microsoft recommends a minimum of 1 replica for interactive MCP use because of cold starts. Dynamic sessions are a separate, platform-managed MCP server for sandboxed code (spec 2025-03-26, API key header `x-ms-apikey`, preview).

### Hosting targets

| target | stateless | stateful (`Mcp-Session-Id`) | long calls and streaming | cost shape | limits to design around |
| --- | --- | --- | --- | --- | --- |
| Container Apps (docs only) | yes, scale out freely | cookie sticky sessions, single revision | 240 s request timeout, SSE ok | vCPU and GiB seconds, zero when scaled to zero | cold start, SIGTERM 30 s |
| Functions MCP extension (docs only) | yes, per invocation | the docs point stateful servers to the extension; SSE needs Queue storage | 230 s HTTP limit | per execution (Flex: plus always ready) | function key or built-in auth |
| Functions self-hosted (docs only) | yes, only mode | no | 230 s HTTP limit | Flex Consumption only | preview, no F5 |
| Kubernetes or VM (nginx lab) | yes, round robin | cookie affinity, 20 of 20 | whatever the proxy allows | nodes you run | buffering, `proxy_read_timeout`, SIGTERM and `ShutdownTimeout` |
| Aspire local | per connection | accidental stickiness | none | free, dev only | not a test of production balancing |

## Trade-offs

- **Stateless vs sessions.** Stateless needs no affinity and survives restarts, but disables sampling, elicitation and unsolicited server messages in that mode; `StatefulForInitializeClients` keeps old clients working while 2026-07-28 clients stay stateless.
- **Cookie affinity vs correctness.** It routes a session home but loses it on restart, scale-in and clients without cookies; accept that and make clients re-initialize on `404`.
- **Chiseled vs debuggable.** 188 MB without a shell against 406 MB with one; debug with an ephemeral debug container, not by adding a shell to the image.
- **Per-process rate limit vs exactness.** In-memory is one line and approximate (10 for a limit of 5 on two replicas); exact limits need a shared store or an edge limiter.
- **Functions vs Container Apps.** Functions bills per call and fits short stateless tools; a container keeps the whole SDK, long calls and your own middleware.

## Documentation Links

- [Host MCP servers on Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/mcp-overview) (doc)
- [Choosing an Azure service for your MCP server, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/mcp-choosing-azure-service) (doc)
- [Deploy an MCP server to Container Apps (.NET), Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-mcp-server-dotnet) (doc)
- [Ingress in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview) (doc)
- [Session affinity in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions) (doc)
- [Set scaling rules in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) (doc)
- [Application lifecycle management in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management) (doc)
- [MCP bindings for Azure Functions overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp) (doc)
- [Self-hosted remote MCP server on Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/self-hosted-mcp-servers) (doc)
- [Azure Functions scale and hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale) (doc)
- [Azure Functions MCP extension, GitHub](https://github.com/Azure/azure-functions-mcp-extension) (doc)
- [remote-mcp-functions-dotnet sample, GitHub](https://github.com/Azure-Samples/remote-mcp-functions-dotnet) (doc)
- [Streamable HTTP transport 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (doc)
- [Transports guide of the C# SDK 2.4.0, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/transports/transports.md) (doc)
- [ngx_http_proxy_module (proxy_buffering, X-Accel-Buffering), nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering) (doc)
- [ngx_http_upstream_module (hash), nginx](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) (doc)
- [Session affinity, YARP](https://microsoft.github.io/reverse-proxy/articles/session-affinity.html) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [Rate limiting middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit) (doc)
- [Kestrel server options, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options) (doc)
- [.NET Generic Host (ShutdownTimeout), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/generic-host) (doc)
- [Aspire documentation, aspire.dev](https://aspire.dev/) (doc)
