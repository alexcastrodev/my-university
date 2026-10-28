---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

An HTTP API is a contract with clients you do not deploy: once a mobile app or a partner integration reads `total` as a number, turning it into an object breaks them on the day you ship. Versioning lets the old and the new contract live side by side while clients migrate. ASP.NET Core has no versioning in the box; the de facto library is ASP.NET API Versioning (the `Asp.Versioning.*` packages), a .NET Foundation project that is not part of the framework; its documentation lives in its own GitHub repository and site, not in the ASP.NET Core docs. This concept runs it on .NET 10 with Minimal APIs and controllers, sends the version in the query string, a header, the URL path and the media type, and prints the exact status codes, headers and problem-details bodies that came back, including the deprecation and sunset headers and what each OpenAPI setup really generates per version. Versions used: SDK 10.0.100, `Asp.Versioning.Http` 10.2.3 (10.2.1 transitively in the controller project), `Asp.Versioning.Mvc` 10.2.1, `Asp.Versioning.Mvc.ApiExplorer` 10.2.1, `Asp.Versioning.OpenApi` 10.2.3, `Microsoft.AspNetCore.OpenApi` 10.0.14.

## Use Cases

- Shipping a breaking change to a response shape (a field changes type, a field is removed) while existing clients keep calling the old contract.
- Announcing to clients, in every response, which versions exist, which are deprecated and when one will be switched off.
- Publishing one OpenAPI document per version so each client generates code against the contract it actually uses.
- Keeping a few endpoints (health, ping) outside the versioning scheme so probes and load balancers never send a version.

## Deep Dive

### Breaking versus additive changes

Adding an optional request field or a new response field is additive: a tolerant client ignores what it does not know. Removing or renaming a field, changing its type or meaning, making an optional input required, or changing the status code of a known outcome breaks someone. Those are what versions are for. The DTO is the contract (see the DTO concept): version the DTOs, not the domain classes. The status-code rules from the REST semantics concept still apply inside each version.

### Which package for which application model

| Package | Use it for |
|---|---|
| `Asp.Versioning.Http` | Minimal APIs (`NewVersionedApi`, `HasApiVersion`) and the core options, readers and errors |
| `Asp.Versioning.Mvc` | Controllers (`[ApiVersion]`, `[MapToApiVersion]`, `.AddMvc()`); pulls in `Asp.Versioning.Http` |
| `Asp.Versioning.Mvc.ApiExplorer` | Versioned API explorer (`.AddApiExplorer()`), one group name per version, for Minimal APIs and controllers |
| `Asp.Versioning.OpenApi` | Integration with `Microsoft.AspNetCore.OpenApi` (`.AddOpenApi()`, `WithDocumentPerVersion()`) |

The 10.x line is the one for .NET 10: the packages I restored only contain a `net10.0` folder (8.1.1 targets `net8.0`). Since 10.2, `Asp.Versioning.Http` also ships Roslyn analyzers; the first build of my controller project already produced `AV0015` ("Configure 'ApiVersioningOptions.ApiVersionReader = new QueryStringApiVersionReader();' to optimize performance"), `AV0029` and `AV0030`, shown below.

### Minimal APIs: version sets, groups and MapToApiVersion

```csharp
builder.Services.AddProblemDetails();
builder.Services.AddApiVersioning(o => o.ReportApiVersions = true);
// after builder.Build():
var orders = app.NewVersionedApi("Orders");                         // one version set
var v1 = orders.MapGroup("/orders").HasDeprecatedApiVersion(1.0);
var v2 = orders.MapGroup("/orders").HasApiVersion(2.0);
v1.MapGet("/{id:int}", (int id, ApiVersion version) => new { id, total = 10.5m, servedBy = version.ToString() });
v2.MapGet("/{id:int}", (int id, ApiVersion version) => new { id, total = new { amount = 10.5m, currency = "EUR" }, servedBy = version.ToString() });

var products = app.NewVersionedApi("Products").MapGroup("/products").HasApiVersion(1.0).HasApiVersion(2.0);
products.MapGet("/", (HttpContext ctx) => $"list for {ctx.RequestedApiVersion}");
products.MapPost("/", () => "created (2.0 only)").MapToApiVersion(2.0);
```

Two groups share the route `/orders`; the version picks the handler. `ApiVersion` bound as a handler parameter without extra setup (the library's source registers it as a transient service resolved from the current request). With the default reader:

```text
GET /orders/7?api-version=1.0   -> 200 {"id":7,"total":10.5,"servedBy":"1.0"}
GET /orders/7?api-version=2.0   -> 200 {"id":7,"total":{"amount":10.5,"currency":"EUR"},"servedBy":"2.0"}
GET /orders/7?api-version=2     -> 200 ... "servedBy":"2"
GET /products?api-version=1.0   -> 200 list for 1.0
POST /products?api-version=1.0  -> 400 UnsupportedApiVersion
POST /products?api-version=2.0  -> 200 created (2.0 only)
```

`2` matched `2.0` (the minor part is optional), but `servedBy` echoes the raw form, so do not compare version strings. Advertising is per version set: when `/products` was in the `Orders` set, its responses also listed `api-deprecated-versions: 1.0`, the deprecation of `/orders`. Give each logical API its own `NewVersionedApi` name.

### The four error responses

With `AddProblemDetails()` registered, I sent bad versions to `/orders/7`:

```text
(no version)          400 {"type":"https://docs.api-versioning.org/problems#unspecified","title":"Unspecified API version","status":400,"detail":"An API version is required, but was not specified.","code":"ApiVersionUnspecified","traceId":"00-..."}
?api-version=3.0      400 {"type":"https://docs.api-versioning.org/problems#unsupported","title":"Unsupported API version","status":400,"detail":"The HTTP resource that matches the request URI 'http://127.0.0.1:5741/orders/7' does not support the API version '3.0'.","code":"UnsupportedApiVersion",...}
?api-version=abc      400 {"type":"https://docs.api-versioning.org/problems#invalid","title":"Invalid API version","status":400,"detail":"The HTTP resource that matches the request URI 'http://127.0.0.1:5741/orders/7' does not support the API version 'abc'.","code":"InvalidApiVersion",...}
?api-version=1.0&api-version=2.0
                      400 {"type":"https://docs.api-versioning.org/problems#ambiguous","title":"Ambiguous API version","status":400,"detail":"The following API versions were requested: 1.0, 2.0. At most, only a single API version may be specified. Please update the intended API version and retry the request.","code":"AmbiguousApiVersion",...}
```

All came as `application/problem+json`, and the first three also carried `api-supported-versions: 2.0` and `api-deprecated-versions: 1.0`, so a client can discover what to send. Note the invalid case reuses the "does not support" wording although its code is `InvalidApiVersion`; switch on `code`, not `detail`. Without `AddProblemDetails()` the unspecified and unsupported requests returned `400` with `Content-Length: 0`, which matches the docs.

### Query string, header, and combining readers

The docs say the default reader is query string plus URL segment combined, with `api-version` as the parameter name. Headers are not read by default: `X-Version: 2.0` with no query string returned `400 ApiVersionUnspecified`. The `AV0015` analyzer suggests setting `QueryStringApiVersionReader` explicitly when you do not use URL segments, because the docs call URL-segment extraction the slowest method.

```csharp
o.ApiVersionReader = new HeaderApiVersionReader("X-Version");       // header only
o.ApiVersionReader = ApiVersionReader.Combine(new QueryStringApiVersionReader(),
    new HeaderApiVersionReader("X-Version"), new MediaTypeApiVersionReader());   // any of three
```

```text
header only: X-Version: 2.0 -> 200    X-Version: 3.0 -> 400 UnsupportedApiVersion
             ?api-version=2.0 -> 400 ApiVersionUnspecified    two X-Version values -> 400 AmbiguousApiVersion
combined:    X-Version: 2.0 -> 200    X-Version: 2.0 + ?api-version=2.0 -> 200
             X-Version: 1.0 + ?api-version=2.0 -> 400 AmbiguousApiVersion
```

There is no standard header name; you pick one, and a reader you did not configure is simply not consulted. Combined readers accept the same version repeated, and reject disagreeing sources rather than ranking them.

### URL segment

```csharp
o.ApiVersionReader = new UrlSegmentApiVersionReader();
var v1 = orders.MapGroup("/v{version:apiVersion}/orders").HasDeprecatedApiVersion(1.0);
```

```text
GET /v1/orders/7     -> 200 ... "servedBy":"1"
GET /v2.0/orders/7   -> 200 ... "servedBy":"2.0"
GET /v3/orders/7     -> 404, Content-Length: 0, no api-supported-versions header
GET /vabc/orders/7   -> 404, Content-Length: 0          GET /orders/7 -> 404
```

The docs say an unsupported version is always 404 with this method, whatever `UnsupportedApiVersionStatusCode` says. What I got was a plain routing 404: no problem body and no advertising headers, so a client that typed `v3` learns nothing. With `AssumeDefaultVersionWhenUnspecified = true` added, `/orders/7` was still 404: a path without the segment matches no route.

### Media type

```csharp
o.ApiVersionReader = new MediaTypeApiVersionReader();   // parameter "v"
```

```text
Accept: application/json;v=2.0   -> 200 Content-Type: application/json; charset=utf-8; v=2.0
Accept: application/json;v=3.0   -> 406 Not Acceptable, problem+json, "code":"UnsupportedApiVersion"
Accept: application/json         -> 400 ApiVersionUnspecified
Accept: application/json;v=1.0;q=0.5, application/json;v=2.0;q=0.9 -> 200 ... "servedBy":"2.0"
POST, Content-Type: application/json;v=2.0 + Accept: application/json;v=1.0 -> 400 AmbiguousApiVersion
Accept: application/xml;v=2.0    -> 200 Content-Type: application/json; charset=utf-8; v=2.0
```

The response echoes the version in its `Content-Type`, and the highest quality value won, as the docs say. Two things differ from the docs: they say Content-Type is preferred when both headers are present, but differing values gave `AmbiguousApiVersion`; and asking for XML got JSON, because the reader only extracts the version, it does not negotiate formats.

### Default version when unspecified

```csharp
o.AssumeDefaultVersionWhenUnspecified = true; o.DefaultApiVersion = new ApiVersion(1, 0); // docs: already the default
// or: o.ApiVersionSelector = new CurrentImplementationApiVersionSelector(o);
```

```text
DefaultApiVersion 1.0:            GET /orders/7 -> 200 "servedBy":"1.0"    GET /products -> list for 1.0
CurrentImplementationSelector:    GET /orders/7 -> 200 "servedBy":"2.0"    GET /products -> list for 2.0
```

The first keeps old version-less clients on the old contract (the usual reason to turn it on when versioning an existing API). "Current implementation" moves them to the newest version on every release, which reintroduces the breakage versioning was meant to prevent.

### Controllers

```csharp
builder.Services.AddControllers();
builder.Services.AddApiVersioning(o => o.ReportApiVersions = true).AddMvc();

[ApiController, ApiVersion(1.0, Deprecated = true), ApiVersion(2.0), Route("orders")]
public class OrdersController : ControllerBase
{
    [HttpGet("{id:int}")] public OrderV1 Get(int id) => new(id, 10.5m);
    [HttpGet("{id:int}"), MapToApiVersion(2.0)]
    public OrderV2 GetV2(int id, ApiVersion version) => new(id, new Money(10.5m, "EUR"), version.ToString());
}
```

```text
GET /orders/7?api-version=1.0 -> 200 {"id":7,"total":10.5}
GET /orders/7?api-version=2.0 -> 200 {"id":7,"total":{"amount":10.5,"currency":"EUR"},"servedBy":"2.0"}
GET /orders/7                 -> 400 ApiVersionUnspecified (same body as above)
```

The unmapped action served 1.0 and the explicitly mapped one won for 2.0. The controller model is covered in the MVC controllers concept.

### Version-neutral and unversioned endpoints

`[ApiVersionNeutral]` or `.IsApiVersionNeutral()` marks an endpoint that accepts no version. The docs say it accepts "any valid API version"; what I observed is narrower:

```text
GET /ping                   -> 200 pong
GET /ping?api-version=1.0   -> 200 pong
GET /ping?api-version=9.0   -> 400 UnsupportedApiVersion   (Minimal API and controller alike)
GET /health?api-version=9.0 -> 200                          (plain MapGet, no versioning metadata)
```

A neutral endpoint accepted the versions the application declares and rejected one nobody declares. For health probes, a plain endpoint outside `NewVersionedApi` was the most permissive.

### Deprecation, advertising and sunset policies

`Deprecated = true` (or `HasDeprecatedApiVersion`) does not stop serving: 1.0 kept answering 200. It only changes what `ReportApiVersions = true` writes. Policies add dates and links:

```csharp
o.Policies.Deprecate(1.0).Effective(2026, 1, 1)
    .Link("https://example.com/api-policy").Title("Versioning policy").Type("text/html");
o.Policies.Sunset(1.0).Effective(2027, 1, 1)
    .Link("https://example.com/api-policy").Title("Versioning policy").Type("text/html");
```

```text
GET /orders/7?api-version=1.0 -> HTTP/1.1 200 OK
api-deprecated-versions: 1.0
Sunset: Fri, 01 Jan 2027 00:00:00 GMT
Link: <https://example.com/api-policy>; rel="sunset"; title="Versioning policy"; type="text/html"
Link: <https://example.com/api-policy>; rel="deprecation"; title="Versioning policy"; type="text/html"
Deprecation: @1767225600
```

`Deprecation` is the RFC 9745 form (`@` plus Unix seconds, here 2026-01-01T00:00:00Z) and `Sunset` the RFC 8594 HTTP date. The policy headers appear only on requests for the version they describe (the 2.0 response had just the two `api-*` headers), and none of them appeared with `ReportApiVersions = false`. With the sunset date moved to 2025, 1.0 still returned 200 with a past `Sunset` header: the library advertises, it never switches a version off. The `Deprecation` header also vanished in that run; the reporter's source writes it only when the deprecation date is not after the sunset date. An `OPTIONS` request, used in the docs to show these headers, returned `405` with `Allow: GET` here: you map `OPTIONS` yourself.

### OpenAPI: one document per version

I generated `/openapi/v1.json` and `/openapi/v2.json` for the controller above in three setups (summary of each document):

```text
A) AddOpenApi() only, no versioned explorer
   v1: GET /orders/{id} -> OrderV2, no api-version parameter     v2: 404
B) .AddApiExplorer(o => o.GroupNameFormat = "'v'VVV") + AddOpenApi("v1") + AddOpenApi("v2")
   v1: GET /orders/{id} -> OrderV1, api-version {"type":"string"}, deprecated=false, info.version 1.0.0
   v2: GET /orders/{id} -> OrderV2, api-version {"type":"string"}, deprecated=false, info.version 1.0.0
C) .AddApiExplorer(...).AddOpenApi() + app.MapOpenApi().WithDocumentPerVersion()
   v1: OrderV1, api-version {"enum":["1.0"]}, deprecated=true, info.version 1.0, description "The API is deprecated."
   v2: OrderV2, api-version {"enum":["2.0"]}, deprecated=false, info.version 2.0
```

Setup A silently dropped the 1.0 operation (two actions on one route collapsed into one path entry) and documented no way to send the version. Setup B works with only the framework package because the versioned explorer sets `ApiDescription.GroupName` to `v1`/`v2`, and the Learn docs say the default `ShouldInclude` keeps endpoints whose group name equals the document name or is null; you list the documents by hand and lose the deprecation and version details. In B the analyzers warned `AV0029` ("AddApiVersioning().AddOpenApi() registers the OpenAPI services that describe API versions") and `AV0030` ("Call MapOpenApi().WithDocumentPerVersion() ..."). Setup C derived the documents from the declared versions. A version-neutral `[ApiVersionNeutral]` `/ping` controller appeared in every document.

### Comparing the strategies

| | Query string | Header | URL segment | Media type |
|---|---|---|---|---|
| HTTP cache key | URL, works | needs `Vary` on that header | URL, works | needs `Vary: Accept` |
| Visible in links and logs | yes | no | yes | no |
| Proxy/CDN friendly | yes | only if the header is forwarded and varied | best | weakest |
| Client friction | low | medium (custom header) | lowest | highest |
| Unsupported version answer | 400 + body | 400 + body | 404, empty | 406 + body |
| REST purism (per library docs) | recommended for new APIs | does not follow the Microsoft REST Guidelines | violates the uniform interface | "generally accepted as fully REST-compliant" |

No response in any run carried a `Vary` header: if a cache sits in front of header or media-type versioning, adding `Vary` is on you (see the output caching and HTTP caching concept). My recommendation from these runs: query string as the default for new APIs (cacheable, visible, rich errors, the library's default), URL segment when the API is consumed through CDNs or by clients that only build paths, and header or media type only when every cache in the path is configured to vary.

## Trade-offs

- **Versioning is not the only answer.** Additive changes plus tolerant readers (ignore unknown fields, never repurpose a field) need no versions at all; version only for real breaks, because every live version is code you test and secure.
- **The library is a dependency, not the framework.** Per its README it is a .NET Foundation project whose releases follow the .NET LTS cycle; 10.x is `net10.0` only, and 10.0 reshaped APIs (`HttpContext.GetRequestedApiVersion()` did not compile, it is now the `RequestedApiVersion` property). Budget for that on each LTS move.
- **URL segments hide errors.** An unknown `v3` got an empty 404 with no supported-versions header, while query, header and media type returned a problem body that names the codes.
- **Header and media-type versions break naive caches.** Nothing adds `Vary` for you; this middleware made responses carry `Vary: X-Version`.
  ```csharp
  app.Use(async (ctx, next) => { ctx.Response.Headers.Append("Vary", "X-Version"); await next(); });
  ```
- **Assuming a default is a migration tool.** Pin `DefaultApiVersion` to the oldest contract; the current-implementation selector silently moves version-less clients forward.
- **Deprecation and sunset are only advertised.** A past `Sunset` date still served 200; removing a version is a deploy you schedule, ideally after watching who still sends it.
- **Use the versioned OpenAPI integration.** The framework alone produced one document that hid the 1.0 operation; `Asp.Versioning.OpenApi` gave per-version documents with deprecation flags and bounded `api-version` values.

## Documentation Links

- [ASP.NET API Versioning repository, GitHub](https://github.com/dotnet/aspnet-api-versioning) (doc)
- [API Version Reader, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/config/reader.html) (doc)
- [Error Responses, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/errors.html) (doc)
- [Version Policies, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/version-policies.html) (doc)
- [API Documentation, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/docs/overview.html) (doc)
- [Generate OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi?view=aspnetcore-10.0) (doc)
