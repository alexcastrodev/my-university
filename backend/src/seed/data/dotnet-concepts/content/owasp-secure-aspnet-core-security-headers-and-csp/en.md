---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A security review of an ASP.NET Core app usually arrives as a list: "map it to the OWASP Top 10, show me the response headers, tell me where the secrets live". Other concepts in this track cover single mechanisms (HTTPS and HSTS, CSRF, CORS, Data Protection). This one is the hardening pass that ties them together: what the framework already does for each OWASP category and what stays with you, the browser-side headers (a Content-Security-Policy with a per-request nonce, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`), whether to write that middleware or take a package, how a CSP meets Blazor and inline scripts, mass assignment with a DTO, and where a developer keeps a secret that must not reach git.

Everything below was run on .NET 10 (SDK 10.0.100), which is the LTS. The lab uses `WebApplicationFactory` and reads headers as strings, so no browser is involved. Where a claim depends on browser behavior I say so.

## Use Cases

- Answering a pentest or audit finding that says "no CSP, no `nosniff`, clickjacking possible".
- Choosing between a 30-line middleware and a security-headers package for a new API or a Razor/Blazor site.
- Adding a CSP to a page that has inline scripts without falling back to `'unsafe-inline'`.
- Reviewing an endpoint that binds an entity directly from a request body.
- Onboarding a team that keeps API keys in `appsettings.json`.

## Deep Dive

### The Top 10 as a map: what the framework does, what is yours

The current list is the OWASP Top 10:2025. Its categories, in order: A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions. Compared with the 2021 list, supply chain and exceptional conditions are new entries. Here is a short mapping for ASP.NET Core, with the other concepts that go deeper:

| Category | The framework gives you | It is still you |
|---|---|---|
| A01 Access control | Authorization policies, `RequireAuthorization`, a fallback policy | Checking that this user owns this row (IDOR), not forgetting one endpoint |
| A02 Misconfiguration | Secure defaults, HSTS and HTTPS redirection helpers | Headers, CORS origins, dev error pages off in production, secrets out of config files |
| A03 Supply chain | NuGet Audit warns at restore | Reading those warnings, lock files, pinning, a review of new packages |
| A04 Cryptography | Data Protection, `PasswordHasher<T>` | Never rolling your own, key storage (see `data-protection-key-ring-and-purposes`) |
| A05 Injection | Razor encodes output; EF Core and interpolated `FromSql` parameterize | String-built SQL in `FromSqlRaw`, `Html.Raw`, `MarkupString` on user data |
| A06 Insecure design | Rate limiting middleware | Threat modeling, abuse cases, limits on expensive endpoints |
| A07 Authentication | Identity lockout and hashing, JWT validation | Sane lockout settings, MFA, short token lifetimes |
| A08 Integrity | Signed Data Protection payloads, no `BinaryFormatter` | Verifying webhook signatures, trusting no client-side state |
| A09 Logging | `ILogger`, HTTP logging that redacts headers by default | Not logging secrets or tokens, alerting on what you log |
| A10 Exceptional conditions | Exception handler and `ProblemDetails` | Failing closed, no stack traces to clients, no swallowed exceptions in auth code |

Two lines of that table I verified by running them. NuGet Audit is on by default: restoring a project that references `System.Text.Encodings.Web` 4.5.0 printed `warn : NU1904: Package 'System.Text.Encodings.Web' 4.5.0 has a known critical severity vulnerability` with the advisory link, and `dotnet list package --vulnerable` listed the same package with severity `Critical`. A warning nobody reads does not defend anything, so many teams turn warnings into errors for this code (`<WarningsAsErrors>NU1904</WarningsAsErrors>`). The injection row is covered by `input-validation-in-minimal-apis` and the EF Core concepts.

The rest of this concept is the A02 and A05 corner that is least covered elsewhere: what the browser is told about your pages.

### The headers, one by one

Each of these is a response header, and each limits a specific thing a browser would otherwise allow:

- `X-Content-Type-Options: nosniff` stops the browser from guessing that a response served as `text/plain` is really a script. It protects mostly against user-uploaded files.
- `Referrer-Policy: strict-origin-when-cross-origin` sends only the origin (not the path and query) to other sites, and nothing when going from HTTPS to HTTP. Paths often hold ids or tokens.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` turns off browser features the site never uses, including for any third-party script that gets in.
- `Content-Security-Policy` is the allowlist for what a page may load and run. It is the strongest defense against XSS after output encoding.
- Inside the CSP, `frame-ancestors 'none'` says no one may embed the page in a frame, which is the modern replacement for `X-Frame-Options` against clickjacking. It cannot be set from a `<meta>` tag, only from a header.

HSTS is the other classic header and has its own concept (`https-hsts-and-secure-defaults`), so it is not repeated here.

### A CSP with a nonce

A policy with `script-src 'self'` already blocks every inline script, injected or not. A real page often has one legitimate inline script (a bootstrap config, an analytics stub). Allowing it with `'unsafe-inline'` turns off the whole protection: an attacker's injected `<script>` is inline too. A nonce fixes that. The server generates a random value per response, puts it in the header (`'nonce-...'`) and on each script tag it trusts (`<script nonce="...">`). The browser runs only inline scripts whose nonce matches, and an attacker who injects markup cannot know the value.

The lab middleware is the whole thing:

```csharp
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public const string NonceKey = "csp-nonce";

    public Task InvokeAsync(HttpContext context)
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        context.Items[NonceKey] = nonce;

        context.Response.OnStarting(() =>
        {
            var h = context.Response.Headers;
            h.XContentTypeOptions = "nosniff";
            h["Referrer-Policy"] = "strict-origin-when-cross-origin";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            h.ContentSecurityPolicy =
                $"default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'; " +
                "base-uri 'self'; frame-ancestors 'none'";
            return Task.CompletedTask;
        });

        return next(context);
    }
}
```

Two details matter. The nonce is 16 random bytes per request: a fixed nonce is a static allowlist entry that an attacker can copy. And the headers are set inside `OnStarting`, which runs right before the response starts, so they also appear on responses written by later middleware, such as a 404 or an error page. The test table from the lab, run against the solution:

```text
Passed!  - Failed: 0, Passed: 8, Skipped: 0, Total: 8 - SecurityHeadersLab.Tests.dll (net10.0)
```

The assertions behind it: `nosniff`, `Referrer-Policy` and `Permissions-Policy` are present on `/`, `/api/ping` and an unknown route (404); the CSP contains `frame-ancestors 'none'` and `object-src 'none'` and not `unsafe-inline`; two requests to `/` produce two different nonces of 16 bytes each; and the nonce in the header equals the one on the `<script nonce="...">` in the body. The starter version of the same lab, with the TODOs unfilled, fails 7 of those 8 tests.

What this does not prove: a unit test compares strings, it does not run a browser. The first time you add a policy, open the page and read the console, because a CSP violation shows there and nowhere on the server.

### Middleware or package

The package I checked is NetEscapades.AspNetCore.SecurityHeaders, version 1.3.1 (published December 2025, MIT license, built for `netcoreapp3.1` and used here on .NET 10). Its builder replaces the hand-written string:

```csharp
app.UseSecurityHeaders(policy => policy
    .AddDefaultSecurityHeaders()
    .AddPermissionsPolicyWithDefaultSecureDirectives()
    .AddContentSecurityPolicy(b =>
    {
        b.AddDefaultSrc().Self();
        b.AddScriptSrc().Self().WithNonce();
        b.AddObjectSrc().None();
        b.AddBaseUri().Self();
        b.AddFrameAncestors().None();
    }));

app.MapGet("/", (HttpContext c) => $"nonce={c.GetNonce()}");
```

Running it and reading the response gave a typed policy and a fresh nonce on every request (`GetNonce()` returned a different value on each call):

```text
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: script-src 'self' 'nonce-pmnd+VoI+8i6ZtC02wQ4xtI6aDAZQ6WUTp+Vzq7vzXY='; default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: accelerometer=(), autoplay=(), camera=(), ...
```

Look at what `AddDefaultSecurityHeaders()` added that the lab did not: `X-Frame-Options`, and three cross-origin headers. `Cross-Origin-Embedder-Policy: credentialless` can break pages that embed third-party images or iframes, so a package default is a decision made for you. The `Server: Kestrel` header was still present: removing it is a separate choice (`AddServerHeader = false` on Kestrel options, from the docs, not run here).

How to choose:

- Write the middleware when you need five fixed headers and a nonce. It is under 30 lines, has no dependency and every line is yours to read in an audit.
- Take the package when the policy grows (many directives, per-endpoint policies, report-only mode, `Report-To`), because the typed builder is less error-prone than concatenated strings.
- Either way, test the headers. A package upgrade can change a default, and a test on the final header string catches it.

### CSP with Blazor and other inline scripts

Blazor Web Apps meet a strict CSP in three places. I ran the .NET 10 `blazor` template and read the HTML of `/counter`: it contains an inline `<script type="importmap">` (rendered by the `ImportMap` component in `App.razor`), one inline `onclick="..."` handler in the nav menu, and external scripts (`blazor.web.js` and a module script). Under `script-src 'self' 'nonce-...'` the external ones load, and the other two are blocked until you deal with them.

For the import map, the `ImportMap` component accepts a `nonce` attribute. With the middleware above placing the nonce in `HttpContext.Items`, `App.razor` reads it and passes it on:

```razor
<ImportMap nonce="@Nonce" />
@code {
    [CascadingParameter] private HttpContext? HttpContext { get; set; }
    private string? Nonce => HttpContext?.Items["csp-nonce"] as string;
}
```

The rendered tag became `<script type="importmap" nonce="KQSKi1XNmdzTQKntssZCgA==">` and the header carried the same value. The `onclick` attribute is different: a nonce applies to `<script>` elements, not to event handler attributes. The Microsoft docs give two ways out, an `'unsafe-hashes'` source with the SHA-256 of that handler, or moving the handler into a JavaScript file that the policy allows. Prefer moving it; hashes break the day someone edits the handler.

Other facts from the Blazor CSP documentation (not run here): Blazor WebAssembly needs `'wasm-unsafe-eval'` in `script-src` (not the old `'unsafe-eval'`), interactive Server needs `connect-src` to allow the WebSocket (`ws:`/`wss:`), and inline `style` attributes need `'unsafe-inline'` in `style-src` unless the component avoids them. The docs also note that .NET 11 makes `Virtualize` stop emitting inline styles.

One more thing I observed: the Blazor Web App template already sends `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` by itself. When my middleware added its own CSP, the response carried two `Content-Security-Policy` headers. A browser enforces all of them, so the result is the intersection and the stricter `frame-ancestors 'none'` wins in effect. It works, but it is a thing to know when a test asserts `Single()` on that header, as the lab does for its own app. The documented option to set it from Blazor is `ContentSecurityFrameAncestorsPolicy` on `AddInteractiveServerRenderMode`.

Roll a new policy out with `Content-Security-Policy-Report-Only` first, so violations are reported (to a `report-to` endpoint) without breaking users, then switch the header name.

### Mass assignment and overposting

Mass assignment is a bug of binding: the client sends more fields than the form shows, and the binder writes them all. Here the entity has `IsAdmin`, and the endpoint takes the entity:

```csharp
public class User { public int Id { get; set; } public string Name { get; set; } = ""; public bool IsAdmin { get; set; } }
public record CreateUserRequest(string Name);

app.MapPost("/users/unsafe", (User user) => Results.Ok(user));
app.MapPost("/users/safe", (CreateUserRequest request) =>
    Results.Ok(new User { Id = 1, Name = request.Name, IsAdmin = false }));
```

```text
POST /users/unsafe {"name":"mallory","isAdmin":true}   -> {"id":0,"name":"mallory","isAdmin":true}
POST /users/safe   {"name":"mallory","isAdmin":true}   -> {"id":1,"name":"mallory","isAdmin":false}
```

The fix is a type that only has the fields the client may set, and the server fills the rest. The lab tests both: one keeps the hole open on purpose so you see the difference. Note that the safe endpoint ignores the extra field silently: the request is accepted with a 200. If you want the opposite (a client sending `isAdmin` is probably an attacker or a bug), `System.Text.Json` can reject unmapped members. In a scratch app with the default options, `POST /users` with the extra field answered 200. With `[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]` on the DTO, it answered 400. Setting `Disallow` on `ConfigureHttpJsonOptions` (`SerializerOptions.UnmappedMemberHandling`) did the same for every endpoint, which also rejects a client that is merely a version ahead, so a public API that evolves usually applies it per DTO or not at all.

The same rule holds for MVC models and forms, where `[BindNever]` or a view model is the equivalent (read in the docs, not run here), and for EF Core: binding an entity from the request and calling `Update` also overwrites columns the client should never touch.

### Where a secret lives in development

A key in `appsettings.json` ends up in git, in images and in screenshots. For local development, .NET has a per-user store outside the project folder:

```text
$ dotnet user-secrets init
Set UserSecretsId to '015dd2e2-...' for MSBuild project '.../Sec2.csproj'.
$ dotnet user-secrets set "Stripe:ApiKey" "sk_test_123"
Successfully saved Stripe:ApiKey to the secret store.
$ dotnet user-secrets list
Stripe:ApiKey = sk_test_123
$ dotnet user-secrets remove "Stripe:ApiKey"
$ dotnet user-secrets list
No secrets configured for this application.
```

`init` writes a `UserSecretsId` into the `.csproj`; the values live in a JSON file under your user profile (on macOS, `~/.microsoft/usersecrets/<id>/secrets.json`), outside the repository. The host reads that file into `IConfiguration` only in the `Development` environment. Running the same build printed `Development: key=sk_test_123` and `Production: key=(null)`: production never sees a developer's secrets, which is the point, and also means production needs its own source.

Know the limit: the file is plain text, protected only by your user's file permissions. The docs state that user secrets is a development convenience and not a vault. In production, use environment variables, a mounted secret, or a secret manager such as Azure Key Vault. Because configuration is layered, the code that reads `Stripe:ApiKey` does not change between them (see `configuration-and-the-options-pattern`).

## Trade-offs

- **Nonce versus hash versus `'unsafe-inline'`.** A nonce needs the HTML to be generated per request, so it does not fit fully static or heavily cached pages (a cached page replays an old nonce). A hash fits a static inline script that never changes. `'unsafe-inline'` removes the XSS protection. Prefer no inline scripts at all, with the nonce for the few you cannot avoid.
- **A strict CSP costs maintenance.** A new analytics tag, a CDN font or an embedded video breaks until the policy allows it. Report-only mode and a test on the header string make that change reviewable instead of a Friday-night incident.
- **Headers are defense in depth.** `nosniff` and a CSP reduce what an XSS or an upload can do. They do not replace output encoding, validation or authorization, and a CSP does not stop SQL injection or CSRF.
- **Package defaults are decisions.** `AddDefaultSecurityHeaders()` is convenient, and it also set COEP and COOP values you did not choose. Read the output once and decide each header.
- **The DTO is the cheap fix, `Disallow` is a policy.** A DTO without `IsAdmin` removes the hole at no cost. Rejecting unknown members catches probing but can break tolerant clients. Choose it per API.
- **A header test is not a browser test.** The lab proves the server sends the policy. Whether your page works under it is checked in a browser console, once per policy change.

## Lab

In this lab you get a small API with a page that has an inline script and two user endpoints. No security header is set and the safe endpoint still binds the entity. You write the middleware, wire it, and fix the binding. The tests use `WebApplicationFactory` and compare header strings and nonces, so no browser is needed. The lab targets `net10.0`. No Docker.

**The scenario**

`Program.cs` serves `/` (HTML with an inline script), `/api/ping`, `/users/unsafe` (left vulnerable on purpose, to show the hole) and `/users/safe`. `SecurityHeadersMiddleware` is an empty shell with a `NonceKey` constant.

**What you will do, step by step**

1. **Generate the nonce (TODO-00).** 16 random bytes, Base64, new for every request, stored in `HttpContext.Items`.
2. **Set the static headers (TODO-01).** `nosniff`, `Referrer-Policy`, `Permissions-Policy`, inside `Response.OnStarting`.
3. **Set the CSP (TODO-02).** With the nonce, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` and no `unsafe-inline`.
4. **Wire it (TODO-03 and TODO-04).** Add the middleware to the pipeline and put the request's nonce on the inline script.
5. **Stop the overposting (TODO-05).** Bind `CreateUserRequest` on `/users/safe` and build the `User` on the server.

**How you know you are done**

`dotnet test` is green. You should be able to say why the 404 response also carries the headers, why two requests must not share a nonce, and why the unsafe test still passes after you fix the safe endpoint.

## Documentation Links

- [OWASP Top 10:2025](https://top10.owasp.org/2025) (doc)
- [Enforce a Content Security Policy for ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/security/content-security-policy) (doc)
- [Content Security Policy (CSP), MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) (doc)
- [NetEscapades.AspNetCore.SecurityHeaders, NuGet](https://www.nuget.org/packages/NetEscapades.AspNetCore.SecurityHeaders) (doc)
- [Safe storage of app secrets in development in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [How to customize System.Text.Json: handle missing members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/missing-members) (doc)
- [Mass Assignment Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html) (doc)
