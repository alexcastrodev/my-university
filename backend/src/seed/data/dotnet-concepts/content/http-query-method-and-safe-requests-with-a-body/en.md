---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Some searches do not fit in a URL: a filter with dozens of fields, a list of ids,
a structured query in JSON. The usual escape is `POST /products/search`, which
works, but tells every client, proxy and cache that the request may change state,
so none of them can retry it blindly or cache the answer. The HTTP `QUERY` method
(RFC 10008) was written for exactly this case: a request with a body that is
**safe and idempotent**. The goal is to understand what the standard says, how to
map and call `QUERY` in ASP.NET Core 11 and `HttpClient`, what the framework does
for you (and what it does not: caching, CORS), and how far you can rely on it
today, with the checks I ran separated from what only the documentation claims.

## Use Cases

- A search endpoint whose filter is a JSON document, too big or too structured for
  a query string, that you want to keep retryable.
- Service-to-service reads where you control the client, the server and the proxies
  in between, so a new method is cheap to adopt.
- Reviewing an API that already exposes `POST /search` and deciding whether
  `QUERY` is worth adding next to it.
- Explaining why a browser, a CDN or a code generator rejects or ignores an
  operation that uses a method it does not know.

## Deep Dive

### What the standard says

RFC 10008, "The HTTP QUERY Method", is a Standards Track document (Proposed
Standard, published in June 2026, after years as the draft
`safe-method-w-body`). Its core points:

- `QUERY` is **safe** (it does not change server state) and **idempotent**, and
  the query is the request content, like `POST`, not the URI.
- The server must fail a request with a missing or inconsistent `Content-Type`
  (`400`, or `415` for a type it does not support) and must not sniff the content.
  Valid content that cannot be processed is `422`. An unacceptable `Accept` is `406`.
- Responses are **cacheable**, and the cache key must include the request content.
- A `2xx` may carry `Content-Location` (where a `GET` fetches these results) or
  `Location` (an equivalent resource that a `GET` can repeat the query on).
- The `Accept-Query` response header lists the media types a resource accepts for
  `QUERY`, which is how a client discovers support.
- CORS: `QUERY` is not a CORS-safelisted method, so a browser always sends a
  preflight.

### Why GET with a body is not the answer

HTTP semantics (RFC 9110) give no meaning to content in a `GET` request, and some
implementations reject it or drop it. The Fetch standard used by browsers throws
a `TypeError` if you pass a body to a `GET` (from the specification, not something
I ran). Proxies and caches key a `GET` on the
URL alone, so two `GET`s with different bodies could be served the same cached
answer. `QUERY` fixes both sides: the body is part of the meaning of the method
and part of the cache key.

| Option | Body | Safe/idempotent | Cache key | Works everywhere today |
|---|---|---|---|---|
| `GET /products?category=Books` | no | yes | URL | yes |
| `GET` with a body | undefined | yes | URL only | no |
| `POST /products/search` | yes | no | not cached by default | yes |
| `QUERY /products` | yes | yes | URL plus body | no (see the last section) |

### Mapping QUERY in a minimal API

There is no `MapQuery` in .NET 11. I listed the `Map*` extensions on the endpoint
builder in the 11.0.100 SDK: `MapGet`, `MapPost`, `MapPut`, `MapDelete`,
`MapPatch`, `MapMethods`, `Map`, `MapGroup` and `MapFallback`. `MapMethods` takes
the method names, and `HttpMethods.Query` (a string constant with the value
`QUERY`) and `HttpMethods.IsQuery(...)` exist in `Microsoft.AspNetCore.Http`.

```csharp
app.MapMethods("/products", [HttpMethods.Query],
    ([FromBody] ProductFilter filter, Catalog catalog, HttpResponse response) =>
    {
        response.Headers["Accept-Query"] = "application/json";
        return catalog.Search(filter);
    });
```

Parameter binding treats the body of a `QUERY` like the body of a `POST`, and the
RFC's error cases come out right without code: a non-JSON `Content-Type` gave
`415`, a missing body gave `400`, and malformed JSON gave `400`. A `GET` on a
route that only maps `QUERY` answered `405` with `Allow: QUERY`, so a client can
learn the method from the error. You can map `GET` and `QUERY` on the same path:
they are separate endpoints.

### Calling it with HttpClient

`HttpMethod.Query` exists in .NET 11. Before it you had to write
`new HttpMethod("QUERY")`, which still works on older runtimes.

```csharp
using var request = new HttpRequestMessage(HttpMethod.Query, "/products")
{
    Content = JsonContent.Create(filter),
};
using var response = await http.SendAsync(request);
```

There are no `HttpClient.QueryAsync` or `QueryAsJsonAsync` helpers, so you go
through `SendAsync`, as for any method without a shortcut.

Redirects are where the new semantics show. I called a server that redirected with
each code and compared `POST` and `QUERY` on the default `HttpClient`:

```text
POST  301 -> GET   (body dropped)      QUERY 301 -> QUERY  (body resent)
POST  302 -> GET   (body dropped)      QUERY 302 -> QUERY  (body resent)
POST  303 -> GET                       QUERY 303 -> GET
POST  307 -> POST  (body resent)       QUERY 307 -> QUERY  (body resent)
POST  308 -> POST  (body resent)       QUERY 308 -> QUERY  (body resent)
```

That matches the RFC: the old rule that turns `POST` into `GET` after `301` and
`302` does not apply to `QUERY`, and `303` is how a server says "fetch the result
with a `GET` at `Location`".

### Safe and idempotent: what that buys you

Nothing in ASP.NET Core checks that a `QUERY` handler really is read-only. The
guarantee is a promise your code makes, and clients act on it. A concrete case is
retry. With `Microsoft.Extensions.Http.Resilience` (10.11.0, running on
`net11.0`) and `DisableForUnsafeHttpMethods()` on the retry options, a server that
always answered `503` was called this many times (one try plus two retries):

```text
GET    attempts=3
PUT    attempts=1
POST   attempts=1
QUERY  attempts=3
```

`QUERY` was retried like `GET`, which is the point of the method, and the reason
a `QUERY` handler must never write. Compare with the idempotency keys you add to
`POST` in the REST semantics concept: `QUERY` does not need them.

### Caching

The RFC makes `QUERY` responses cacheable with the body in the key. ASP.NET Core
output caching does not do that by default. With `.CacheOutput()` on a `QUERY`
endpoint, three identical requests ran the handler three times (a counter in the
handler went 1, 2, 3): the default policy only stores `GET` and `HEAD`.

A custom `IOutputCachePolicy` can opt in, and it must put the body in the key. I
hashed the body, rewound the stream so binding still works, and varied by the hash:

```csharp
public async ValueTask CacheRequestAsync(OutputCacheContext context, CancellationToken ct)
{
    var request = context.HttpContext.Request;
    if (!HttpMethods.IsQuery(request.Method)) return;

    request.EnableBuffering();
    var hash = Convert.ToHexString(await SHA256.HashDataAsync(request.Body, ct));
    request.Body.Position = 0;

    context.CacheVaryByRules.VaryByValues["body"] = hash;
    context.EnableOutputCaching = true;
    context.AllowCacheLookup = true;
    context.AllowCacheStorage = true;
}
```

With it, the same body was served from cache (`Age` header present, handler ran
once) and a different body ran the handler again. Without the hash in the key, two
different filters would share one entry, which is the bug the RFC warns about.
Buffering and hashing every body has a cost, so cap the request size. Browser and
CDN caches follow their own rules; I did not test any of them.

### CORS

Because `QUERY` is not safelisted, every cross-origin call from a browser starts
with an `OPTIONS` preflight, even when the body is small. The policy has to list
the method and the `Content-Type` header:

```csharp
builder.Services.AddCors(o => o.AddPolicy("spa", p => p
    .WithOrigins("https://app.test")
    .WithMethods("GET", "QUERY")
    .WithHeaders("Content-Type")));
```

With `Access-Control-Request-Method: QUERY` and the right origin, the response was
`204` with `Access-Control-Allow-Methods` containing `QUERY`. A policy that only
allowed `GET` answered the same preflight with `Allow-Methods: GET`, which a
browser reads as a refusal. (I checked the headers with `curl` and in tests, not
in a real browser.)

### OpenAPI 3.2 against 3.1

OpenAPI 3.1 has no slot for `QUERY` in a path item: it knows `get`, `put`, `post`,
`delete`, `options`, `head`, `patch` and `trace`. OpenAPI 3.2 added a `query` key.
.NET 11 writes `3.2.0` by default, and an endpoint mapped with `QUERY` appears as
`"query"` there, while pinning `OpenApi3_1` moves it under
`x-oai-additionalOperations`. The OpenAPI concept shows both documents, so I do not
repeat them here. The practical rule is the one from that concept: the generator
moved to 3.2, your consumers may not have.

### Where support is still weak

What I ran, on the 11.0.100 SDK: the mapping, the status codes, the `Allow` header,
output caching, the CORS preflight, `HttpClient` redirects and the retry handler,
all in the lab with `WebApplicationFactory` and `HttpClient` against Kestrel.

What I did not run, and which therefore rests on the documentation or on someone
else's result: reverse proxies (nginx, HAProxy, Envoy), CDNs and API gateways,
web application firewalls, browsers calling `QUERY` through `fetch`, and
logging or tracing tools that assume a short list of verbs. A proxy that only
forwards known methods, a WAF that blocks unknown ones, or a CDN that does not
cache the method will break the story. Check each hop you own.

One tool result I can cite is from the audit of the .NET 11 release candidate
(not rerun for the GA): the Kiota client generator, version 1.38.0, failed on an
OpenAPI 3.2 document that contained a `QUERY` operation (`Requested value 'QUERY'
was not found`), and generated normally from the same API in 3.1 and 3.0. I did
not test Scalar or other generators with 3.2.

## Trade-offs

- **Standard, but young.** RFC 10008 is recent, and the ecosystem (proxies,
  gateways, generators, test tools) is catching up. On a public API behind a CDN,
  `POST /search` still works everywhere. A middle path is to offer both and let
  clients that can use `QUERY` do so.
  ```text
  QUERY /products      same filter body, cacheable and retryable
  POST  /products/search   same filter body, works through any proxy
  ```
- **A short filter belongs in the URL.** If the filter fits in a query string,
  `GET` is still better: it is bookmarkable, loggable and cached by everything.
  `QUERY` pays off when the filter is large or structured.
- **No built-in caching.** You get a cacheable method but, in ASP.NET Core, a
  hand-written policy. A key that forgets the body returns wrong answers, and
  hashing bodies costs memory and CPU.
- **Always preflighted.** Every cross-origin browser call to `QUERY` costs an extra
  round trip, unless you cache the preflight with `SetPreflightMaxAge`.
- **Safety is a promise.** Nothing stops a handler from writing. A retry layer that
  trusts `QUERY` will repeat that write.
- **The body shows up in different places than the URL.** The RFC notes that URIs
  are more likely to be logged by intermediaries than content. That is good for
  secrets in a filter, and bad for debugging: your access logs will not show the
  filter unless you log it yourself.

## Lab

In this lab you get a small catalog API that already searches with `POST /products/search`, and you add the `QUERY` version of it. The core idea is to see that the method is a first-class citizen in ASP.NET Core 11 and `HttpClient` without any shortcut, and to cover the parts that are not automatic: discovery, CORS and caching. The lab targets `net11.0`, so it needs the .NET 11 SDK.

**The scenario**

The tests use `WebApplicationFactory<Program>` and `HttpClient` with `HttpMethod.Query`.

- `Catalog.cs`: five products, `Search(filter)` and a counter of how many times a search really ran.
- `Program.cs`: `GET /products`, the old `POST /products/search`, and TODO comments where the new code goes.
- `ProductsClient.cs`: a typed client with a `SearchAsync` to implement.
- `QueryCachePolicy.cs`: the output cache policy that lets `QUERY` in and varies by body hash (already written).

**What you will do, step by step**

1. **Map QUERY (TODO-00).** Use `MapMethods("/products", [HttpMethods.Query], ...)` with a `ProductFilter` read from the body, and check that a text body gives `415` and an empty one `400`.
2. **Advertise it (TODO-01).** Send `Accept-Query: application/json` on `GET /products` and on the `QUERY` response.
3. **Open CORS (TODO-02).** Register the `spa` policy with `GET` and `QUERY` and the `Content-Type` header, so the preflight passes.
4. **Call it (TODO-03).** Implement `ProductsClient.SearchAsync` with `HttpMethod.Query` and `JsonContent`.

**How you know you are done**

`dotnet test` is all green. You should be able to say why `GET` with a body is not an option, what a proxy may do with a safe and idempotent method that it cannot do with `POST`, and why the preflight is unavoidable.

**Optional challenges**

- **TODO-04:** register the provided `QueryCachePolicy`, add `UseOutputCache()` and `.CacheOutput("query")`. The last test checks that the same body runs the filter once. Then try `.CacheOutput()` without the policy and see the default refuse `QUERY`.

**Prerequisites:** minimal APIs, `WebApplicationFactory`, the idea of safe and idempotent methods, and the .NET 11 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The starter compiles and every test fails until you do the TODOs in `Program.cs` and `ProductsClient.cs`.

## Documentation Links

- [The HTTP QUERY Method, RFC 10008](https://www.rfc-editor.org/info/rfc10008) (doc)
- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [Minimal APIs, route handlers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Output caching middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output) (doc)
- [Enable CORS in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (doc)
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html) (doc)
