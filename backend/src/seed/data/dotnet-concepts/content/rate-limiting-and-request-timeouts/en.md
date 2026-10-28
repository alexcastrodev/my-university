---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

An API has two ways to fall over that have nothing to do with bugs: too many requests arrive at once, or a few requests take so long that they hold threads, connections and database sessions until nothing is left for anyone else. ASP.NET Core ships one middleware for each problem. The rate limiting middleware (`AddRateLimiter` + `UseRateLimiter`, built on `System.Threading.RateLimiting`) decides whether a request may enter at all, using a fixed window, a sliding window, a token bucket or a concurrency limit, optionally per user, API key or IP. The request timeouts middleware (`AddRequestTimeouts` + `UseRequestTimeouts`) cancels `HttpContext.RequestAborted` when an endpoint runs too long. Both have defaults and traps that only show up under load: a rejection status you probably do not want, a `Retry-After` header some algorithms never fill, partitions an attacker can multiply, and a timeout that does nothing to a handler that ignores its token. This concept sends real bursts to a local server and reports which requests got 200, 429, 503 or 504, and when. Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (in-box `System.Threading.RateLimiting`, file version 10.0.25.52411), and the `System.Threading.RateLimiting` 10.0.14 package for the client-side example.

## Use Cases

- Capping how often one client (user, API key, tenant) can call an expensive endpoint, so one heavy consumer cannot starve the rest.
- Limiting how many requests run at the same time against a fragile dependency, such as a report endpoint that opens a large query.
- Cutting off endpoints that hang on a slow downstream call or a lock, so they return 504 instead of piling up.
- Throttling your own outgoing calls to a third-party API that enforces a quota on you.

## Deep Dive

### Two services, two middlewares

Both features are in the shared framework, so a web project needs no package. Each has a service registration and a middleware, and policies are attached to endpoints:

```csharp
builder.Services.AddRateLimiter(o => o.AddFixedWindowLimiter("fixed", f => { f.PermitLimit = 3; f.Window = TimeSpan.FromSeconds(10); }));
builder.Services.AddRequestTimeouts();
var app = builder.Build();
app.UseRateLimiter();
app.UseRequestTimeouts();
app.MapGet("/", () => "ok").RequireRateLimiting("fixed");
```

Both middlewares read endpoint metadata, so they must run after routing. A minimal app adds `UseRouting` at the start of the pipeline for you; if you call it yourself, put these two after it.

### The default rejection is 503 with an empty body

I read the default and sent 5 concurrent requests to the policy above:

```text
new RateLimiterOptions().RejectionStatusCode = 503
5 concurrent, fixed 3/10s, defaults: 200 x3, 503 x2
body length of rejected: 0, retry-after present: False
```

This matches the docs. A 503 tells clients and load balancers the server is unavailable, which can trigger failover or generic retries. For "you are calling too often" the right status is 429, so set it explicitly.

### Writing 429 and Retry-After

`RejectionStatusCode` sets the status; `OnRejected` runs before the response is sent. The lease carries metadata, and `MetadataName.RetryAfter` becomes the header:

```csharp
o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
o.OnRejected = (ctx, ct) =>
{
    if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        ctx.HttpContext.Response.Headers.RetryAfter =
            ((long)Math.Ceiling(retryAfter.TotalSeconds)).ToString(NumberFormatInfo.InvariantInfo);
    return ValueTask.CompletedTask;
};
```

I exhausted one policy per algorithm (2 permits, 10 s window or replenishment), waited 3 seconds and sent one more request to each:

```text
/fixed 3 s into window: 429 Retry-After=10 metadata=[RETRY_AFTER]
/sliding 3 s into window: 429 Retry-After=(none) metadata=[RETRY_AFTER]
/token 3 s into window: 429 Retry-After=10 metadata=[RETRY_AFTER]
/conc rejected: 429 Retry-After=(none) metadata=[REASON_PHRASE]
```

The fixed window answered 10 seconds although about 7 were left: on 10.0.0 it reports a full window (the docs describe a boundary-based value only for ASP.NET Core 11, and the 10.0.14 package behaved the same in a console test). The sliding window lists `RETRY_AFTER` in `MetadataNames`, yet `TryGetMetadata` returned false. The concurrency limiter has no hint at all, as the docs say. Treat a missing hint as normal.

### Fixed window vs sliding window at the boundary

Both limiters allow 4 requests per 4 seconds; the sliding one has 2 segments of 2 seconds. Times are from the first request, which is when each limiter's window starts (`AddFixedWindowLimiter` vs `AddSlidingWindowLimiter` with `SegmentsPerWindow = 2`):

```text
t= 0.0s send 1: fixed [200 x1]  sliding [200 x1]
t= 3.5s send 3: fixed [200 x3]  sliding [200 x3]
t= 4.5s send 4: fixed [200 x4]  sliding [200 x1, 429 x3]
t= 6.5s send 4: fixed [429 x4]  sliding [200 x3, 429 x1]
```

The fixed window let 7 requests through in about one second (t=3.5 to t=4.5) because its counter resets at the boundary. The sliding window only gave back the permit of the segment that expired (the request at t=0), and the other 3 once the segment holding the t=3.5 burst expired.

### Token bucket: bursts with a ceiling

A token bucket starts full, spends one token per request and adds `TokensPerPeriod` every `ReplenishmentPeriod`, never above `TokenLimit`. With `TokenLimit = 4`, `TokensPerPeriod = 2` and a 1 s period:

```text
t=0.0s send 6: 200 x4, 429 x2  Retry-After on 429s: 1
t=1.5s send 6: 200 x2, 429 x4  Retry-After on 429s: 1
t=5.0s send 6: 200 x4, 429 x2  Retry-After on 429s: 1
```

After 3.5 idle seconds the bucket held 4 tokens, not more: idle time does not build credit beyond the limit. Short bursts pass, the sustained rate stays at 2 per second.

### Concurrency limiter and the queue

The concurrency limiter counts requests in flight; a permit returns when the response finishes. `PermitLimit = 2`, a handler that takes 1000 ms, r1 to r5 sent 100 ms apart:

```text
QueueLimit 0, OldestFirst:  r1:200@1042ms  r2:200@1105ms  r3:429@206ms  r4:429@303ms  r5:429@403ms
QueueLimit 2, OldestFirst:  r1:200@1003ms  r2:200@1101ms  r3:200@2004ms  r4:200@2101ms  r5:429@401ms
QueueLimit 2, NewestFirst:  r1:200@1003ms  r2:200@1102ms  r3:429@401ms  r4:200@2102ms  r5:200@2003ms
```

Without a queue, rejections are immediate. With `QueueLimit = 2`, r3 and r4 succeeded but took about 2 seconds: a queue turns rejections into latency, and the client's own timeout may fire first. With `NewestFirst` a full queue evicts its oldest waiter: r3 got 429 at about 400 ms, the moment r5 arrived, and r5 was served before r4. The time-based limiters accept the same `QueueLimit` and `QueueProcessingOrder` options.

### Global limiter, named policies and opting out

`GlobalLimiter` runs on every request; named policies run where attached, with `RequireRateLimiting("name")` or `[EnableRateLimiting("name")]`; `DisableRateLimiting()` turns off both. I combined a global limit of 6 per 30 s with a `"strict"` policy of 2 per 30 s and printed the global permits left after each call:

```csharp
o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(_ => RateLimitPartition.GetFixedWindowLimiter("all",
    _ => new FixedWindowRateLimiterOptions { PermitLimit = 6, Window = TimeSpan.FromSeconds(30) }));
o.AddFixedWindowLimiter("strict", f => { f.PermitLimit = 2; f.Window = TimeSpan.FromSeconds(30); });

app.MapGet("/a", () => "ok").RequireRateLimiting("strict");
app.MapGet("/b", [EnableRateLimiting("strict")] () => "ok");
app.MapGet("/plain", () => "ok");
app.MapGet("/free", () => "ok").DisableRateLimiting();
```

```text
[global avail 5] [global avail 4] [global avail 2] /a x3 sequential: 200 200 429
[global avail 0] /b x1 sequential: 429
[global avail 0] [global avail 0] [global avail 0] /plain x3 sequential: 429 429 429
[global avail 0] [global avail 0] [global avail 0] /free x3 sequential: 200 200 200
```

Two surprises. `/b` was rejected on its first call: a policy made with `AddFixedWindowLimiter` is one bucket shared by every endpoint that uses it. And each request rejected by the endpoint policy cost two global permits. The middleware source shows why: it tries a non-blocking acquire on both limiters and, when the endpoint one fails, tries again through the queued path, and each attempt takes a global permit that a time-based limiter does not give back.

The order of `UseRateLimiter` and `UseRouting` matters too. With `app.UseRateLimiter(); app.UseRouting();` a policy of 1 permit answered `200 200 200`: no error, the endpoint policy was silently skipped because no endpoint was selected yet. The docs allow that order only for global limiters.

### Partitions on attacker-controlled keys

A single bucket lets one client use the whole limit, so partitioned limiters keep one limiter per key (user, API key, IP). I keyed a 2-per-minute limit on an unvalidated `X-Api-Key` header and counted factory calls:

```csharp
o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    RateLimitPartition.GetFixedWindowLimiter(ctx.Request.Headers["X-Api-Key"].ToString(),
        _ => { Interlocked.Increment(ref created); return new FixedWindowRateLimiterOptions { PermitLimit = 2, Window = TimeSpan.FromMinutes(1) }; }));
```

```text
10 requests with X-Api-Key: alice -> 200 x2, 429 x8; partitions created so far: 1
2000 requests, random X-Api-Key each -> 200 x2000; partitions created: 2001
```

An honest client was limited; a client sending a new value per request was never limited, and the server built a limiter for each value. To size that, I created 100000 GUID partitions directly with `PartitionedRateLimiter.Create<string, string>`, then waited with no traffic:

```text
window 60 s: 100000 distinct keys -> +64.3 MB (674 bytes per partition)
   after 15 s with no traffic: +65.9 MB over the baseline
window 1 s:  100000 distinct keys -> +64.2 MB (672 bytes per partition)
   after 15 s with no traffic: +6.5 MB over the baseline
```

Idle partitions are removed only after their permits are back and they stay idle a while, so with a 1-minute window nothing was freed. Partition on what the server trusts (the authenticated user, an API key validated against your store) and put anonymous traffic in a few shared buckets. The docs warn about the same DoS risk, including spoofed source IPs.

### Behind a proxy, RemoteIpAddress is the proxy

I partitioned on `RemoteIpAddress` with 3 permits and sent 6 requests from one machine, each with a different `X-Forwarded-For`:

```text
UseForwardedHeaders=False: 200 200 200 429 429 429   partition keys seen: 127.0.0.1
UseForwardedHeaders=True:  200 200 200 200 200 200   partition keys seen: 203.0.113.1 ... 203.0.113.6
'X-Forwarded-For: 198.51.100.7, 203.0.113.50' -> RemoteIpAddress 203.0.113.50
ForwardLimit=1, KnownProxies=[::1], KnownIPNetworks=[127.0.0.0/8]
```

Without forwarded headers every client behind a proxy shares the proxy's bucket. With `UseForwardedHeaders` (before `UseRateLimiter`) the key comes from the header, which is safe only if a proxy you trust writes it. The defaults trust loopback only and take the rightmost value; register your real proxy in `KnownProxies` or `KnownIPNetworks` and make sure it overwrites what the client sent.

### Metrics

The middleware publishes on the meter `Microsoft.AspNetCore.RateLimiting`. I listened with a `MeterListener` while sending 5 requests to a 3-permit fixed policy and 3 concurrent ones to a concurrency policy (1 permit, queue 1):

```text
instrument aspnetcore.rate_limiting.active_request_leases: UpDownCounter ({request})
instrument aspnetcore.rate_limiting.queued_requests: UpDownCounter ({request})
instrument aspnetcore.rate_limiting.request_lease.duration: Histogram (s)
instrument aspnetcore.rate_limiting.request.time_in_queue: Histogram (s)
instrument aspnetcore.rate_limiting.requests: Counter ({request})
aspnetcore.rate_limiting.requests result=acquired policy=fixed: 3
aspnetcore.rate_limiting.requests result=endpoint_limiter policy=fixed: 2
aspnetcore.rate_limiting.requests result=acquired policy=conc: 2
aspnetcore.rate_limiting.requests result=endpoint_limiter policy=conc: 1
```

The `aspnetcore.rate_limiting.result` tag separates endpoint rejections from global ones (`global_limiter`), which is what you alert on. Export it with `.AddMeter("Microsoft.AspNetCore.RateLimiting")`.

### Request timeouts: what the client sees

The timeout middleware does nothing until a timeout is configured. I set a 1 s default and some per-endpoint overrides:

```csharp
builder.Services.AddRequestTimeouts(o =>
{
    o.DefaultPolicy = new RequestTimeoutPolicy { Timeout = TimeSpan.FromSeconds(1) };
    o.AddPolicy("short", TimeSpan.FromMilliseconds(500));
    o.AddPolicy("custom", new RequestTimeoutPolicy { Timeout = TimeSpan.FromMilliseconds(500), TimeoutStatusCode = 503,
        WriteTimeoutResponse = ctx => ctx.Response.WriteAsync("took too long") });
});
app.MapGet("/coop", async (HttpContext ctx) => { await Task.Delay(5000, ctx.RequestAborted); return "done"; });
app.MapGet("/attr", [RequestTimeout(500)] async (HttpContext ctx) => { /* same body */ });
app.MapGet("/named", ...).WithRequestTimeout("short");     // "/custom" uses "custom"
app.MapGet("/off", ...).DisableRequestTimeout();            // 1500 ms body
```

```text
new RequestTimeoutPolicy().TimeoutStatusCode = null
/coop           -> 504 after 1048 ms, body:
/attr           -> 504 after 501 ms, body:
/named          -> 504 after 501 ms, body:
/custom         -> 503 after 501 ms, body: took too long
/off            -> 200 after 1502 ms, body: done
/cancelfeature  -> 200 after 1503 ms, body: done
```

When the token fired, `Task.Delay` threw `OperationCanceledException`, the middleware caught it and, with `TimeoutStatusCode` null, wrote 504 with an empty body, as the docs describe. `/cancelfeature` called `ctx.Features.Get<IHttpRequestTimeoutFeature>()?.DisableTimeout()` first, which cancels the running timeout. The docs add that the middleware does not trigger while a debugger is attached; I ran without one, so test timeouts with `dotnet run`, not under F5. And with `WithRequestTimeout(TimeSpan.FromMilliseconds(300))` but no `UseRequestTimeouts()`, the request got `200 after 1503 ms`: configuration without the middleware is silently ignored.

### A handler that ignores the token keeps running

The timeout cancels a token. It does not abort the request or stop your code:

```csharp
app.MapGet("/ignore", async () => { await Task.Delay(3000); return "done anyway"; });
app.MapGet("/catch", async (HttpContext ctx) =>
{
    try { await Task.Delay(5000, ctx.RequestAborted); return Results.Ok("done"); }
    catch (OperationCanceledException) { return Results.Ok("partial result"); }
});
```

```text
/ignore         -> 200 after 3007 ms, body: done anyway
/catch          -> 200 after 1020 ms, body: "partial result"
/ignore handler finished after 3002 ms, RequestAborted.IsCancellationRequested=True
```

`/ignore` blew through its 1 s budget, ran 3 seconds and returned 200 with the token already cancelled. A handler that catches the cancellation decides the response itself. Pass `RequestAborted` (or a `CancellationToken` parameter) to EF Core, `HttpClient` and every awaitable call, or the timeout is decoration.

### Not the same as Kestrel limits or HttpClient.Timeout

```text
KeepAliveTimeout=00:02:10, RequestHeadersTimeout=00:00:30, MinRequestBodyDataRate=240 B/s grace 00:00:05, MaxConcurrentConnections=null
HttpClient.Timeout 500 ms on /off: TaskCanceledException: The request was canceled due to the configured HttpClient.Timeout of 0.5 seconds elapsing.
server saw RequestAborted after 499 ms
```

Kestrel limits (first line, the defaults of `KestrelServerLimits`) protect the connection: idle keep-alive, slow headers, slow bodies. They do not bound how long a handler runs. Request timeouts are per endpoint and about your handler. `HttpClient.Timeout` is on the caller's side (second line); in a separate run against a handler awaiting `Task.Delay(5000, ctx.RequestAborted)` with no request timeout, the client gave up at 500 ms and Kestrel cancelled `RequestAborted` at about 500 ms (third line), because the connection closed. Outgoing timeouts and retries are covered in the resilience concept.

### Rate limiting your own outgoing calls

`System.Threading.RateLimiting` is not tied to ASP.NET Core, but in a plain console project the namespace did not exist (`error CS0234`) until I added the package; web projects get it from the shared framework. I used the docs' client-side `DelegatingHandler` pattern (`await limiter.AcquireAsync(1, ct)`, forward the request if `lease.IsAcquired`, otherwise return a local 429) with a `TokenBucketRateLimiter` of 4 tokens, `QueueLimit = 0`, and an inner handler that counts what would reach the network:

```text
10 calls: 200 x4, 429(Retry-After 1s) x6; reached the inner handler: 4
```

Six calls never left the process. With a non-zero `QueueLimit` they would wait instead, usually what you want against a third-party quota.

## Trade-offs

- **Pick the status code on purpose.** The default 503 with an empty body says "server down", and clients and gateways treat that differently from 429.
  ```csharp
  o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
  ```
- **Retry-After is a hint, not a promise.** On 10.0.0 the fixed window reports a full window and the sliding window and concurrency limiter report nothing, so clients need their own capped backoff with jitter.
- **Fixed windows allow double bursts.** Measured: 7 requests in about one second under "4 per 4 s". Use a sliding window or token bucket when that matters.
- **Queues trade rejections for latency.** Each queued request waited a full extra handler duration; keep `QueueLimit` small and below the client's timeout.
- **Partition keys are a security decision.** Unvalidated headers or spoofable IPs give an attacker unlimited partitions (about 670 bytes each) and no limit at all.
  ```csharp
  var key = await apiKeys.IsValidAsync(header) ? header : "anonymous";   // unknown keys share one bucket
  ```
- **Limits are per instance.** The docs say counters live in memory, so 3 instances with 100 per minute allow up to 300. A shared limit needs a gateway or a store-backed limiter.
- **Global plus endpoint limiters cost more than they look.** Each endpoint rejection took two global permits in my test, and a named policy is one bucket for all its endpoints.
- **A request timeout is cooperative.** It writes 504 only if your code observes the token; code that ignores it runs to completion and returns 200.

## Documentation Links

- [Rate limiting middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-10.0) (doc)
- [Request timeouts middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/timeouts?view=aspnetcore-10.0) (doc)
- [Rate limit an HTTP handler in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/http-ratelimiter) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0) (doc)
- [Announcing Rate Limiting for .NET, .NET Blog](https://devblogs.microsoft.com/dotnet/announcing-rate-limiting-for-dotnet/) (doc)
