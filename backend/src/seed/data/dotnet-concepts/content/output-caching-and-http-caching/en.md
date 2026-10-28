---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Caching a whole HTTP response is the cheapest request you will ever serve, and ASP.NET Core gives you three different ways to do it that are easy to confuse. HTTP caching headers (`Cache-Control`, `ETag`, `Vary`) are instructions the app writes for someone else: the browser, a CDN, a proxy. The Response Caching middleware is a server-side cache that obeys those same headers, including the ones the client sends, so a client can switch it off. The Output Caching middleware is a server-side cache that the server controls: policies, tags for invalidation, and a lock that makes one request do the work while the others wait. This concept runs all three against local servers with a counter in every handler, so each claim comes with how many times the handler really ran, which status came back and how many bytes crossed the wire. It also reproduces a real leak caused by putting `UseOutputCache` before authentication. It is the response-level companion of the data caching lesson (`IMemoryCache`, `HybridCache`). Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (all middleware is in the shared framework, no package), plus runtime 10.0.14 for the middleware-order experiment.

## Use Cases

- Letting browsers and CDNs keep static or slow-changing responses (a product catalog, a public price list) and revalidate them with `ETag` instead of downloading them again.
- Serving an expensive public endpoint from server memory for a few seconds, so a traffic spike hits the cache and not the database.
- Evicting every cached page about one product as soon as an admin edits it, with a tag.
- Protecting a cold endpoint from a thundering herd right after a deploy or a cache expiry.

## Deep Dive

### HTTP caching headers: instructions for someone else

Headers do nothing on the server. They tell the next cache in line (browser, CDN, proxy) what it may do. I set them with the typed headers API on a minimal endpoint:

```csharp
app.MapGet("/headers", (HttpContext ctx) =>
{
    var h = ctx.Response.GetTypedHeaders();
    h.CacheControl = new() { Public = true, MaxAge = TimeSpan.FromSeconds(60) };
    h.LastModified = new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);
    ctx.Response.Headers.Vary = "Accept-Encoding";
    return "hello";
});
app.MapGet("/nostore", (HttpContext ctx) => { ctx.Response.Headers.CacheControl = "no-store"; return "secret"; });
```

```text
/headers: Cache-Control=public, max-age=60 | Vary=Accept-Encoding | Last-Modified=Thu, 01 Oct 2026 12:00:00 GMT
/nostore: Cache-Control=no-store
```

What they mean, per RFC 9111: `public` lets shared caches (CDN, proxy) store the response and `private` restricts it to the user's browser; `max-age` is the freshness lifetime in seconds; `no-store` means no cache may keep any part of it (use it for personal or sensitive data); `no-cache` does not mean "do not cache", it means "store it, but revalidate before every reuse". `Vary` makes the cache keep one copy per value of the listed request headers. `Expires` is the HTTP/1.0 absolute date, and the RFC says a cache must ignore it when `max-age` is present, so new code only needs `max-age`.

### [ResponseCache] writes headers, but only in MVC

The `[ResponseCache]` attribute is a shortcut that writes those headers. It is an MVC filter, and I confirmed that it is silently ignored on a minimal API lambda:

```text
[ResponseCache(Duration = 30)] on a minimal API lambda: Cache-Control=(none)
controller Duration=30:                                Cache-Control=public, max-age=30
controller Duration=30, Location=Client, VaryByHeader: Cache-Control=max-age=30, private  Vary=Accept-Language
controller NoStore=true, Location=None:                Cache-Control=no-store, no-cache  Pragma=no-cache
controller VaryByQueryKeys=["page"]:                   500 InvalidOperationException: 'VaryByQueryKeys' requires the response cache middleware.
```

`Location.Any` maps to `public`, `Client` to `private`, and `VaryByQueryKeys` has no HTTP header at all: it is an instruction for the Response Caching middleware, and without it the action throws. In minimal APIs, write the headers yourself as above.

### Conditional requests: ETag and 304 by hand

An `ETag` is a version label for a representation. The client stores it and sends it back as `If-None-Match`; if it still matches, the server answers `304 Not Modified` with no body. I hashed a 50,000-byte payload into an ETag and implemented the check by hand:

```csharp
app.MapGet("/etag", (HttpContext ctx) =>
{
    ctx.Response.Headers.ETag = etag;
    ctx.Response.Headers.CacheControl = "no-cache"; // keep it, but ask me every time
    if (ctx.Request.Headers.IfNoneMatch == etag) return Results.StatusCode(304);
    return Results.Text(payload);
});
```

```text
first request:              200 ETag="AB8F07056F06AF00" body=50000 bytes
If-None-Match=same ETag:    304 body=0 bytes
If-None-Match=other value:  200 body=50000 bytes
```

The round trip still happens, but 50,000 bytes became 0. Note that the handler still ran: revalidation saves bandwidth, not server work, unless computing the ETag is cheaper than the response (a row version, a file timestamp).

### Response Caching middleware: the client is in charge

`AddResponseCaching()` plus `UseResponseCaching()` add a server-side cache that applies HTTP caching rules. I put a counter in a handler that returns `Cache-Control: public,max-age=10` and an `ETag`, and sent three requests per scenario:

```text
public,max-age=10:                handler runs=1, Age=0 on the third
max-age=10 without public:        handler runs=3
public + Set-Cookie:              handler runs=3
public + request Authorization:   handler runs=3
public, status 404 / POST:        handler runs=3 / 3
If-None-Match matching the ETag:  304, body=0 bytes, no extra handler run
```

All of that matches the docs' conditions for caching: only `GET`/`HEAD` with a 200, `public` required, no `Authorization` header, no `Set-Cookie`. The `Age` header is the visible sign of a hit. The weakness is the request side. With the entry warm, I sent two requests each with three different headers:

```text
client sends Cache-Control: no-cache   -> handler runs went 1 -> 3
client sends Cache-Control: max-age=0  -> 3 -> 5
client sends Pragma: no-cache          -> 5 -> 7
plain GET                              -> 7 -> 7 (Age=0)
```

Every one of them bypassed the cache. The docs say this is by design (RFC 9111 requires honoring request directives) and that there is no developer control over it; they add that Chrome and Edge send `max-age=0` on normal browsing, which is why the overview says Output Caching exists. Any client that wants to defeat your cache only needs one header.

### Response Caching ignores the query string

One more behavior surprised me. Three GETs to the same path with different query strings:

```text
GET /rc/q?page=1: body="run 1"
GET /rc/q?page=2: body="run 1" Age=0
GET /rc/q?page=3: body="run 1" Age=0
```

Page 2 and page 3 received page 1. The query string is not part of the key; it only counts when you set `VaryByQueryKeys` (on `[ResponseCache]` or through `IResponseCachingFeature`). Defaults read back: `SizeLimit=104857600` (100 MB), `MaximumBodySize=67108864` (64 MB), `UseCaseSensitivePaths=False`.

### Output Caching: the server is in charge

`AddOutputCache()` plus `UseOutputCache()` make caching available; nothing is cached until an endpoint opts in with `.CacheOutput()` or `[OutputCache]`, or a base policy applies:

```csharp
builder.Services.AddOutputCache();   // then, after building: app.UseOutputCache();
app.MapGet("/oc/default", () => Body("default")).CacheOutput();
app.MapGet("/oc/attr", [OutputCache(Duration = 5)] () => Body("attr"));
```

```text
3 GETs:                                        handler runs=1, Age=0, Cache-Control=(none)
then 2 GETs with Cache-Control: no-cache:      handler runs=1
then 2 GETs with Pragma: no-cache + max-age=0: handler runs=1
then 2 POSTs:                                  handler runs=3
then GET /OC/DEFAULT (upper case):             handler runs=3 (hit)
[OutputCache(Duration = 5)] on a lambda:       2 GETs, handler runs=1
endpoint with no CacheOutput:                  2 GETs, handler runs=2
```

The headers that defeated Response Caching changed nothing. Also note `Cache-Control=(none)`: output caching does not tell browsers anything, so it combines freely with the HTTP headers above. Unlike `[ResponseCache]`, the `[OutputCache]` attribute works on a minimal API lambda. Paths are case insensitive by default.

### What the default policy refuses

The docs list four default rules: only 200, only GET/HEAD, no responses that set cookies, no authenticated requests. With two GETs each, a request carrying an `Authorization` header, a handler that sets a cookie and a handler that returns 404 all ran twice (POST was shown above). Any `Authorization` header disables caching, even one that no handler validates. Defaults read back from `OutputCacheOptions`:

```text
SizeLimit=104857600, MaximumBodySize=67108864, DefaultExpirationTimeSpan=00:01:00, UseCaseSensitivePaths=False
default IOutputCacheStore: Microsoft.AspNetCore.OutputCaching.Memory.MemoryOutputCacheStore
```

The docs say that when `SizeLimit` is reached no new responses are cached until older entries are evicted. I tested `MaximumBodySize`: with it set to 1024, a 512-byte response was cached (1 run for 2 GETs) and a 2048-byte one was not (2 runs).

### Policies and cache keys

Named policies are registered once and selected by name; a base policy applies to every request:

```csharp
builder.Services.AddOutputCache(o =>
{
    o.AddPolicy("short", p => p.Expire(TimeSpan.FromSeconds(2)));
    o.AddPolicy("culture", p => p.SetVaryByQuery("culture"));
    o.AddPolicy("lang", p => p.SetVaryByHeader("Accept-Language"));
    o.AddPolicy("tenant", p => p.VaryByValue(ctx => new KeyValuePair<string, string>("tenant", ctx.Request.Headers["X-Tenant"].ToString())));
    o.AddPolicy("prefix", p => p.SetCacheKeyPrefix(ctx => "t-" + ctx.Request.Headers["X-Tenant"]));
});
```

```text
default policy, ?a=1, ?a=1, ?a=2, ?a=2&b=1:        handler runs=3
SetVaryByQuery("culture"): pt&x=1, pt&x=2, en&x=1: handler runs=2
SetVaryByHeader(Accept-Language): pt-BR, pt-BR, en: handler runs=2
VaryByValue(X-Tenant): a, a, b:                    handler runs=2
SetCacheKeyPrefix(t-{X-Tenant}): a, a, b:          handler runs=2
```

By default every query key varies the entry (the opposite of Response Caching), so `SetVaryByQuery` is how you stop junk parameters (`?utm_source=...`) from multiplying entries. `SetVaryByRouteValue` does the same for route values. In a separate app with `AddBasePolicy(p => p.Expire(TimeSpan.FromSeconds(10)))` and no `CacheOutput` anywhere, a plain endpoint was cached (1 run for 2 GETs) and one marked `.CacheOutput(p => p.NoCache())` was not (2 runs): a base policy caches everything unless you opt out.

### Expiration, NoCache and eviction by tag

```csharp
app.MapGet("/oc/tagged", () => Body("tagged")).CacheOutput(p => p.Tag("products"));
app.MapPost("/purge/{tag}", async (string tag, IOutputCacheStore store, CancellationToken ct) =>
{ await store.EvictByTagAsync(tag, ct); return Results.NoContent(); });
```

```text
Expire(2s): GET, GET, wait 2.5 s, GET:                 handler runs=2
NoCache(): 3 GETs:                                     handler runs=3
Tag("products"): GET, GET, EvictByTagAsync, GET, GET:  handler runs=2
```

After eviction the next request recomputed once, then it was a hit again. Tags are the reason Output Caching can be invalidated on demand and Response Caching cannot. Protect any purge endpoint like an admin operation.

### Resource locking against a stampede

Ten concurrent GETs on a cold key, handler takes 500 ms, with the default policy and with `SetLocking(false)`:

```text
default (locking on): handler runs=1,  all 200=True, elapsed about 500 ms
SetLocking(false):    handler runs=10, all 200=True, elapsed about 500 ms
```

With locking, one request filled the entry and the other nine waited and received the cached result, as the docs describe. Latency was the same; the difference is that the database would have seen 1 query instead of 10.

### Revalidation for free

The handler only set an `ETag`; output caching answered `If-None-Match` with 304 and 0 bytes, and an `If-Modified-Since` later than the entry with 304, with one handler run in total. That is the docs' "cache revalidation is automatic". The overview also says Response Caching does not revalidate, but in my test it returned 304 for a matching `If-None-Match` (above), so on 10.0.0 that sentence does not hold.

### Storage: one cache per instance

The default store is in memory, so each server instance has its own cache, an eviction reaches only that instance, and a restart empties it. The docs offer Redis through `Microsoft.AspNetCore.OutputCaching.StackExchangeRedis` (`AddStackExchangeRedisOutputCache`, not `AddStackExchangeRedisCache`) and advise against `IDistributedCache` as a store because it lacks the atomic operations tags need. I had no Redis server available, so this part is from the docs only.

### Middleware order: a reproduced leak

The docs require `UseOutputCache` after `UseCors`, after `UseRouting` when you call it, and after `UseAuthentication`/`UseAuthorization`, otherwise "output caching middleware can serve content cached for unauthorized users". I built an endpoint with `.RequireAuthorization().CacheOutput()` and an API-key handler (header `X-Api-Key`, not `Authorization`), then called it as alice and then anonymously:

```csharp
app.UseOutputCache();      // WRONG: before authentication
app.UseAuthentication();
app.UseAuthorization();
```

```text
runtime 10.0.0,  WRONG order: alice -> 200 "salary report for alice, run 1"; anonymous -> 200 "salary report for alice, run 1"
runtime 10.0.0,  RIGHT order: alice -> 200 "salary report for alice, run 1"; anonymous -> 401 ""
runtime 10.0.14, WRONG order: alice -> 200 "salary report for alice, run 1"; anonymous -> 401 ""
```

On 10.0.0 an anonymous caller received alice's private response. When the cache middleware ran, nobody was authenticated yet, so the default policy stored the response; the next request was answered from cache before authorization ever ran. On 10.0.14 the same app no longer leaked: the `DefaultPolicy` source from tag v10.0.10 onward refuses to store a response when the user is authenticated at response time. Keep the documented order anyway and patch the runtime: the order is what keeps custom policies safe.

### Response caching versus data caching

| | Browser/CDN cache | Response Caching | Output Caching | Data cache (`HybridCache`) |
|---|---|---|---|---|
| Caches | full response | full response | full response | objects you choose |
| Controlled by | response headers | request and response headers | server policies | your code |
| Lives in | client or edge | server memory | server memory or Redis | memory, optional L2 |
| Invalidated by | `max-age` expiry, revalidation | expiry only | expiry, `EvictByTagAsync` | expiry, `RemoveAsync`, tags |
| Stampede protection | no | no | yes, locking | yes, per instance |

Response caching skips the whole pipeline (binding, handler, serialization); data caching skips only the expensive query inside it. They stack well: data cache for shared objects, output cache for hot public endpoints, headers for the browser.

## Trade-offs

- **Output Caching is the default choice for server-side response caching.** The server decides, clients cannot bypass it, and it has tags and locking. Response Caching only fits public GET APIs whose clients you trust to send sane headers.
- **The query string is a key decision.** Response Caching ignores it unless told (page 2 served page 1); Output Caching varies by every key, so restrict it.
  ```csharp
  o.AddPolicy("catalog", p => p.SetVaryByQuery("page", "category"));
  ```
- **Never cache personalized output without varying by the user.** The default policy skips authenticated requests for a reason; if you override it, add `VaryByValue` per user or tenant and keep `UseOutputCache` after authorization.
- **Each instance has its own cache.** Evicting a tag on one pod leaves the others stale until expiry, unless the store is shared (Redis).
- **HTTP headers outlive your deploy.** A `max-age=86400` already in a browser cannot be recalled; use short `max-age` plus `ETag`, or versioned URLs for static assets.
- **Revalidation saves bytes, not CPU.** A hand-written 304 still runs the handler; make the ETag cheap to compute.

## Documentation Links

- [Output caching middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output?view=aspnetcore-10.0) (doc)
- [Response caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/response?view=aspnetcore-10.0) (doc)
- [Response Caching Middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/middleware?view=aspnetcore-10.0) (doc)
- [Overview of caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/overview?view=aspnetcore-10.0) (doc)
- [RFC 9111: HTTP Caching, IETF](https://www.rfc-editor.org/rfc/rfc9111.html) (doc)
