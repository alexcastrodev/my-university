---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

CORS is the reason a front-end that works against your API in `curl` fails in the browser. A single-page app or a Blazor WebAssembly client served from one origin and calling an API on another is cross-origin, and the browser asks the API for permission before it lets the page read the answer. This concept shows exactly which headers the ASP.NET Core CORS middleware sends, what a preflight is, which configurations fail silently, and how to read the browser's error. Everything was checked twice: with `curl` against the API to see the raw headers, and with real `fetch` calls from a page on another origin in Chrome, whose console messages are quoted below. Versions: SDK 10.0.100, runtime 10.0.0.

## Use Cases

- A React, Angular or Vue app on `http://localhost:5410` calling an API on `http://localhost:5403`, or the same split in production on two subdomains.
- A Blazor WebAssembly app served from a CDN or static host that calls an ASP.NET Core API on another host.
- An API that must also accept cookie credentials from the SPA.
- Diagnosing a "blocked by CORS policy" error that the server logs never mention.

## Deep Dive

### The server answers, the browser decides

An origin is scheme, host and port. The docs state that CORS is not a security feature, it relaxes the browser's same-origin rule, and that it is up to the browser to enforce it: the server runs the request and returns the response, and the browser withholds it from the page. That has a visible consequence. With a policy for `http://localhost:5410`, a request from another origin still reached the endpoint and got a normal answer:

```text
GET /items  Origin: http://evil.example   ->  200 OK   (no Access-Control-Allow-Origin header)
GET /items  (no Origin header at all)     ->  200 OK
```

`curl`, Postman and server-to-server calls ignore CORS entirely. It protects users' browsers, not your API. Authorization still has to be done on the server.

### Configuring a policy

```csharp
const string Spa = "http://localhost:5410";
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(Spa)
    .WithMethods("GET", "POST")
    .WithHeaders("Content-Type")));

var app = builder.Build();
app.UseRouting();
app.UseCors();            // before UseAuthorization
app.UseAuthentication();
app.UseAuthorization();
```

With that policy a request from the allowed origin got one extra response header:

```text
GET /items  Origin: http://localhost:5410
200 OK
Access-Control-Allow-Origin: http://localhost:5410
```

A default policy applies through `UseCors()`; a named policy is applied globally with `UseCors("name")` or per endpoint with `.RequireCors("name")` (and `[EnableCors]` for controllers). The docs recommend against mixing the attribute and the middleware in one app.

### Preflight

Before some requests the browser first sends an `OPTIONS` request, the preflight, asking whether the real one would be allowed. Per the docs it can skip that only for GET, HEAD or POST, with only the safelisted headers (`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`, `Last-Event-ID`), and a `Content-Type` of `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`. A JSON `POST`, a `PUT`, `DELETE`, or any custom header or `Authorization` header triggers a preflight. The middleware answers it without reaching your endpoint:

```text
OPTIONS /items
Origin: http://localhost:5410
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type

204 No Content
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET,POST
Access-Control-Allow-Origin: http://localhost:5410
```

Notice who judges. For a disallowed method or header, the server still answered `204` with the policy's own lists (`GET,POST`, `Content-Type`) and the browser compared them with what the page asked for. Only a disallowed origin got a bare `204` with no CORS headers. An `OPTIONS` request with no `Access-Control-Request-Method` is not treated as a preflight and got `405`. From Chrome, with that policy:

```text
fetch(..., { headers: { 'X-Custom': '1' } })
  blocked: Request header field x-custom is not allowed by Access-Control-Allow-Headers in preflight response.
fetch(..., { method: 'PUT' })
  blocked: Method PUT is not allowed by Access-Control-Allow-Methods in preflight response.
```

The page's code sees only `TypeError: Failed to fetch`. The reason is in the console, which is why CORS bugs feel invisible from the server.

### Credentials, exposed headers and preflight caching

Cookies and other browser-managed credentials need both sides: the page sets `credentials: 'include'` and the policy calls `AllowCredentials()`. Without it Chrome refused: `The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.` A policy with credentials, an exposed header and a preflight cache time:

```csharp
p.WithOrigins(Spa).AllowAnyHeader().AllowAnyMethod().AllowCredentials()
 .WithExposedHeaders("X-Total-Count").SetPreflightMaxAge(TimeSpan.FromMinutes(10));
```

```text
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: http://localhost:5410
Access-Control-Expose-Headers: X-Total-Count
Access-Control-Max-Age: 600          (on the preflight)
```

Reading `response.headers.get('X-Total-Count')` returned `null` in the browser under the first policy, even though the header was on the wire, and `42` under this one. The docs list the only response headers a page can read by default: `Cache-Control`, `Content-Language`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`.

### Wildcards and the mistakes that fail silently

- `AllowAnyOrigin()` sends `Access-Control-Allow-Origin: *`, and the preflight echoes the requested headers and methods.
- `AllowAnyOrigin()` together with `AllowCredentials()` is invalid. On this runtime the app **did not start**: `InvalidOperationException: The CORS protocol does not allow specifying a wildcard (any) origin and credentials at the same time. Configure the CORS policy by listing individual origins if credentials needs to be supported.`
- A trailing slash in the origin is wrong: `WithOrigins("http://localhost:5410/")` threw nothing and simply sent **no** `Access-Control-Allow-Origin` header for any request. The docs state the comparison fails.
- `127.0.0.1` is not `localhost`. A page opened at `http://127.0.0.1:5410` calling the policy for `http://localhost:5410` failed with `No 'Access-Control-Allow-Origin' header is present on the requested resource.`
- With two or more allowed origins the middleware also sent `Vary: Origin`; with a single origin it did not. Caches in front of the API need that header to keep per-origin answers apart.

### Order with authorization

The docs say `UseCors` goes after `UseRouting` and before `UseAuthorization`. I tested both orders against an endpoint with `RequireAuthorization()` and no credentials:

```text
UseCors before UseAuthorization:  401, Access-Control-Allow-Origin present  -> fetch reads status 401
UseCors after  UseAuthorization:  401, no CORS header                       -> fetch: TypeError: Failed to fetch
```

The preflight succeeded in both orders. Only the real response differed, and in the second case the page cannot even see that it was a 401. The docs add a separate caveat: a redirect from HTTP to HTTPS on the preflight fails in the browser (`ERR_INVALID_REDIRECT`), so an API should reject HTTP instead of redirecting it. I did not run that case.

## Trade-offs

- **`AllowAnyOrigin` is convenient for public, credential-free APIs and wrong for the rest.** List origins from configuration instead of hard coding them.
  ```csharp
  p.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>()!)
  ```
- **Credentials raise the stakes.** Allowing cross-origin credentials is a security risk in the docs' words. Keep the origin list short and exact.
- **Exposed headers are opt-in.** Pagination or ETag headers vanish for the page until you list them.
- **Preflight cache time cuts round trips but delays policy changes.** `SetPreflightMaxAge` of ten minutes means a tightened policy may take ten minutes to reach a browser that cached the old answer.
- **CORS errors hide in the browser.** Keep the console open, and test with `curl -i -H "Origin: ..."` to see the raw headers before touching the client code.
- **A same-origin deployment needs none of this.** Serving the SPA or Blazor app from the API's own origin, or through a reverse proxy, removes the whole mechanism.

## Documentation Links

- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Cross-Origin Resource Sharing (CORS), MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) (doc)
- [Fetch Standard: CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol) (doc)
- [Call a web API from ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/call-web-api) (doc)
- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
