---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Cross-site request forgery (CSRF) abuses the fact that a browser attaches your
cookies to a request no matter which page started it. A page on
`evil.example` can submit a form to `bank.example`, and the browser sends the
bank's session cookie along. ASP.NET Core has two defenses: the antiforgery
token (a cookie plus a hidden field that only a page of your own site can
read) and, new in .NET 11, an automatic middleware that rejects cross-site
form posts using the `Sec-Fetch-Site` and `Origin` headers the browser sets.

This concept explains both, which one has the last word when they disagree,
how to open a deliberate exception (a webhook, a trusted partner site), and
what neither protects. Every status code below comes from a test that sends
the headers by hand to a real app on SDK 11.0.100.

## Use Cases

- Securing a cookie-authenticated app that handles forms (Razor Pages, MVC,
  Blazor static SSR, Minimal API `[FromForm]`).
- Upgrading from .NET 10 and wondering why a cross-site form post now answers
  400, or why the Blazor template stopped calling `UseAntiforgery()`.
- Letting a payment provider or a partner site post to one endpoint without
  turning protection off for the whole app.
- Reviewing an API and deciding whether a JSON endpoint needs CSRF protection.

## Deep Dive

### The attack and what the browser tells you

A forged request is a normal request with the victim's cookie, started by a
page the victim happened to open. The server cannot tell it from a real one by
the cookie alone. Browsers help with two request headers that page JavaScript
cannot set or change (both are forbidden request headers):

- `Sec-Fetch-Site` says how the initiator relates to the target: `same-origin`,
  `same-site` (same registrable domain, different origin, such as a sibling
  subdomain), `cross-site`, or `none` (the user typed the URL or used a
  bookmark).
- `Origin` carries the initiator's origin on write requests and is the
  fallback for browsers that predate Fetch Metadata.

A request with neither header is almost always a non-browser client (curl, a
mobile app, a server calling your API). CSRF is a browser attack, so those are
not the target.

### The .NET 11 automatic check

`WebApplication.CreateBuilder` registers a CSRF middleware by default. It does
not issue or validate tokens. It applies these rules in order, and the first
match wins (per the
[anti-request-forgery page](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery)):

1. Safe methods (`GET`, `HEAD`, `OPTIONS`, `TRACE`) pass.
2. `Sec-Fetch-Site` of `same-origin` or `none` passes.
3. A request whose `Origin` is allowed by the endpoint's CORS policy, when
   that policy has `AllowCredentials()`, passes.
4. Any other `Sec-Fetch-Site` value (`cross-site`, `same-site`) is denied.
5. No `Sec-Fetch-Site` but an `Origin`: it must match the request's own
   scheme, host and port.
6. Neither header: allowed.

The middleware only records a verdict. The 400 comes from whoever reads the
form: a Minimal API endpoint with a `[FromForm]` parameter, an MVC action
protected by antiforgery, a Blazor SSR endpoint, or code that reads
`Request.Form`. The lab app has no `UseAntiforgery()` and one form endpoint,
and the test client plays the browser:

```csharp
app.MapPost("/transfer", ([FromForm] string to) => $"sent to {to}");
```

```text
                                         status  reason
no headers (curl)                          200   rule 6
Sec-Fetch-Site: same-origin                200   rule 2
Sec-Fetch-Site: none                       200   rule 2
Sec-Fetch-Site: cross-site, Origin: evil   400   rule 4
Sec-Fetch-Site: same-site                  400   rule 4
Origin: https://evil.example only          400   rule 5
Origin equal to the app's own origin       200   rule 5
```

Note `same-site`: a sibling subdomain such as `blog.example` posting to
`app.example` is denied, because it is not the same origin. This is the case
that catches a company with many subdomains sharing a parent cookie domain.

### The antiforgery token

The token system works differently: the server hands the page a token pair.
One half lives in a cookie, the other in a hidden form field (or a header),
and a forged request from another site can send the cookie but cannot read the
field value. Turn it on with `AddAntiforgery()` and `app.UseAntiforgery()`.
Razor Pages, MVC and Blazor forms render the field for you (`<AntiforgeryToken />`
in Blazor); a script-driven page asks for it:

```csharp
app.MapGet("/token", (HttpContext ctx, IAntiforgery antiforgery) =>
{
    var tokens = antiforgery.GetAndStoreTokens(ctx);   // also sets the cookie
    return Results.Ok(new TokenResponse(tokens.FormFieldName, tokens.RequestToken!));
});
```

With `UseAntiforgery()` on, the same `/transfer` endpoint changes verdict:

```text
same-origin, no token                              400
same-origin, cookie + __RequestVerificationToken   200
cross-site + Origin evil, valid cookie + token     200
valid token sent as header RequestVerificationToken 200
token from another client (other cookie)           400
```

The token is the final verdict. When both middlewares run, the token one runs
second and replaces the first verdict: a request the header check denied
becomes valid with a valid token, and a request the header check allowed
becomes invalid without one. Passing cross-site with a valid token is not a
hole, because only a page that could read the token can send it. The field
name is `__RequestVerificationToken`, and the token needs the Data Protection
key ring (see `data-protection-key-ring-and-purposes`).

### Opening an exception: `DisableAntiforgery()`

A payment provider posts a form to `/webhook` from its own site and cannot
send your token. Opt that endpoint out, and defend it another way:

```csharp
app.MapPost("/webhook", ([FromForm] string eventName, HttpRequest request) =>
        request.Headers["X-Webhook-Secret"] == "s3cret"
            ? Results.Ok($"handled {eventName}")
            : Results.Unauthorized())
    .DisableAntiforgery();
```

```text
cross-site POST with the secret      200
cross-site POST without the secret   401   (not 400: the CSRF check no longer runs)
with UseAntiforgery() on, with secret  200
```

`DisableAntiforgery()` adds `IAntiforgeryMetadata { RequiresValidation = false }`,
which both middlewares honor. MVC's `[IgnoreAntiforgeryToken]` does the same.
The opt-out is safe only when the endpoint is not reachable with ambient
cookie authentication: a shared secret, a signature or a bearer token is what
protects it now. Opting out an endpoint that a logged-in user reaches by
cookie rebuilds the vulnerability.

### Opening an exception: a trusted partner site

For a browser form on `https://partner.example` that posts to your API with
cookies, declare the origin through CORS and require the policy on the endpoint:

```csharp
builder.Services.AddCors(o => o.AddPolicy("partner", p => p
    .WithOrigins("https://partner.example")
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
// ...
app.UseCors();
app.MapPost("/partner-transfer", ([FromForm] string to) => $"partner sent to {to}")
   .RequireCors("partner");
```

```text
cross-site, Origin partner.example   200
cross-site, Origin evil.example      400
```

Two details from the docs matter. `AllowCredentials()` is required for the
trust: an allowed origin without it falls through to rule 4. And
`AllowAnyOrigin()` is never treated as trust, because "any browser can read
this" is not "any site may write for the user". A policy built with
`SetIsOriginAllowed` or wildcard subdomains is trusted for every origin it
accepts, so a wildcard over subdomains you do not fully control becomes a CSRF
hole. The CORS side is in `cors-for-spa-and-wasm-clients`.

### What JSON endpoints do and do not get

`/api/transfer` takes a JSON body, never reads a form, has no antiforgery
metadata, and answers 200 to a request that says `cross-site` from
`evil.example` (with and without `UseAntiforgery()`). Neither mechanism checks
it: the verdict is recorded and nothing enforces it.

That is not automatically a bug, because a cross-origin page cannot send
`Content-Type: application/json` without a CORS preflight, and the preflight
fails unless you allow the origin. It is a different defense with its own
holes: an endpoint that accepts `text/plain` or form bodies for the same
action, a permissive CORS policy, or a handler that ignores the content type
reopens it. Treat "JSON" as a property you enforce (reject other content types
on state-changing endpoints), not as a safety label. Token-authenticated APIs
(bearer tokens sent in a header by script) are not CSRF targets at all, since
the browser never attaches them on its own.

### Turning it off, and what you lose

`DisableCsrfProtection=true` (configuration or `ASPNETCORE_DisableCsrfProtection`)
removes the middleware for the whole app. It is an escape hatch. The docs warn
that the automatic middleware also satisfies the "an antiforgery middleware
ran" requirement of form endpoints, so an app that depends on it and has
neither it nor `UseAntiforgery()` fails when it serves such a form. In .NET 10
that same missing middleware already threw
`InvalidOperationException: ... contains anti-forgery metadata, but a
middleware was not found that supports anti-forgery`, a 500. A test
app with the key on and no `UseAntiforgery()` answered 500 on a `[FromForm]`
endpoint for a cross-site, a same-origin and a header-less post, and 200 only
on the endpoint that called `DisableAntiforgery()`, which matches that warning.
The default `ICsrfProtection` can be replaced with your own rules (an
allowlist, a custom header), which I read in the docs and did not run.

## Trade-offs

- **Headers versus tokens.** The header check needs no state and no Data
  Protection keys, so it suits a minimal app, but it trusts the browser to send
  `Sec-Fetch-Site` or `Origin`. A client that sends neither is allowed through
  by design. Keep tokens when you must support browsers that send neither,
  when you round-trip data in the token, or when a review asks for an
  independent layer.
- **Both at once is fine.** The token check runs second and wins, so adding
  `UseAntiforgery()` to an app that already has the header check only makes it
  stricter: a form post without a token is a 400 even from the same origin. Any
  script that posts forms must fetch and send the token.
  ```csharp
  var token = await client.GetFromJsonAsync<TokenResponse>("/token");
  ```
- **Every opt-out is a promise.** `DisableAntiforgery()` and
  `[IgnoreAntiforgeryToken]` remove the check for cookie users too. Put the
  replacement (secret, signature, bearer token) next to the opt-out.
- **CORS trust is CSRF trust.** Adding a credentialed origin to a policy for an
  SPA also lets that origin post forms to the endpoints using the policy. Keep
  the list explicit and short.
- **`same-site` is not safe.** Subdomains share cookies and are denied by the
  header check. If a sibling subdomain hosts user content, a takeover there is
  a CSRF source against the parent.
- **Static checks are not a browser.** The lab sends headers by hand, which is
  exactly what the server sees, but it does not prove what a given browser
  sends. Test the real flow once with the browser network tab.

## Lab

In this lab you get an API where the form endpoints exist but none of the wiring: no antiforgery services, no CORS policy, no token endpoint and no opt-out for the webhook. You wire them and read each status code as the verdict of a specific mechanism. The tests play the browser by adding `Sec-Fetch-Site` and `Origin` headers through `WebApplicationFactory`, so no browser is needed. The lab targets `net11.0` and needs the .NET 11 SDK. No Docker.

**The scenario**

`Program.cs` has `/transfer` (a form), `/webhook` (a form posted by a payment provider, guarded by a shared secret), `/partner-transfer` (a form posted by a trusted partner site), `/api/transfer` (JSON) and `/token`. A configuration key, `Csrf:UseTokens`, lets one app show both phases: the automatic check alone, then the token as the final verdict.

**What you will do, step by step**

1. **Register the services (TODO-00 and TODO-01).** `AddAntiforgery()` and a `partner` CORS policy for `https://partner.example` with `AllowCredentials()`.
2. **Wire the pipeline (TODO-02 and TODO-03).** `UseCors()`, and `UseAntiforgery()` only when `Csrf:UseTokens` is true.
3. **Issue a token (TODO-04).** In `/token` call `GetAndStoreTokens` and answer the field name and the request token.
4. **Open the two exceptions (TODO-05 and TODO-06).** `.DisableAntiforgery()` on `/webhook` and `.RequireCors("partner")` on `/partner-transfer`.

**How you know you are done**

`dotnet test` is green. For each test you should be able to say whether the 400, 200 or 401 came from the automatic check, the token, CORS or the webhook secret, and why `/api/transfer` is 200 in every phase. Notice that a valid token passes even when the headers say `cross-site`.

## Documentation Links

- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
- [Blazor SSR defers antiforgery validation to middleware, breaking change, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/blazor-server-side-rendering-deferred-cross-site-request-forgery-protection) (doc)
- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Sec-Fetch-Site, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) (doc)
- [Fetch Metadata Request Headers, W3C](https://www.w3.org/TR/fetch-metadata/) (doc)
- [Cross-Site Request Forgery Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) (doc)
