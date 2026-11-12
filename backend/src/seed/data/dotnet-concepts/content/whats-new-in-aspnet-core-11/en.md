---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

ASP.NET Core 11 shipped with the .NET 11 GA on 2026-11-10. Like the .NET 10 map
(`whats-new-in-aspnet-core-10`), this concept is a guide to the release notes:
a few lines per change, grouped by what you have to do about it, with a link to
the concept that goes deep. The grouping is the point. Some changes are
automatic, some need one call, and some can break a working app.

Each item says how I know it. "Ran on GA" means a small program on SDK 11.0.100
produced the output quoted. "Release notes" means I am relaying the official
page and did not run it. The list of what breaks, with before and after on both
SDKs, is in `migrating-from-aspnet-core-10-to-11`.

## Use Cases

- Deciding what to test in an upgrade from .NET 10, the current LTS.
- Finding the concept that explains a feature you saw in the release notes.
- Telling automatic changes (nothing to do) from opt-in (a call or a package)
  from breaking (can change a result you depend on).
- Onboarding someone who knows ASP.NET Core 10 and needs only the delta.

## Deep Dive

### Automatic: you get these by retargeting

- **CSRF check on form posts.** `WebApplication.CreateBuilder` registers a
  middleware that judges requests by `Sec-Fetch-Site` and `Origin`, and
  form-consuming endpoints answer 400 to a cross-site post. Ran on GA: a
  `[FromForm]` endpoint gave 200 same-origin, 200 with no headers and 400
  cross-site. Full story, exceptions and a lab in
  `csrf-protection-antiforgery-tokens-and-fetch-metadata`.
- **Hosting tags on the request span.** With only the framework's own
  `ActivitySource` and no OpenTelemetry package, a listener saw a span named
  `GET /hello` carrying `client.address`, `network.peer.address`, `server.port`,
  `http.request.method`, `url.scheme`, `url.path` and `http.response.status_code`
  among others. Ran on GA. If you also run an older instrumentation package
  you may now see duplicated tags (release notes). See
  `opentelemetry-logs-metrics-and-traces`.
- **Response compression gains zstd and a `Vary` header.** Ran on GA with
  `AddResponseCompression`: `Accept-Encoding: zstd` gave `Content-Encoding: zstd`,
  and `zstd, br, gzip` chose zstd. Every response in that test carried
  `Vary: Accept-Encoding`, including one that was not compressed.
- **Exact `Retry-After`.** A fixed-window limiter of one request per 30 seconds
  answered the second request with 429 and `Retry-After: 29`. Ran on GA. Tables
  and the opt-in header code are in `rate-limiting-and-request-timeouts`.
- **Stricter Kestrel.** Protocol-compliance checks tightened for HTTP/1.1,
  HTTP/2 and HTTP/3, and there are TLS handshake diagnostics (release notes,
  not run). Hosting background is in `kestrel-iis-and-hosting-models`.
- **Hosted service failures reach `RunAsync`, scope disposal aggregates
  errors, empty chained configuration wins.** Three runtime behavior changes
  that I ran on both SDKs; all three are in the migration concept.

### Opt-in: one call or one attribute

- **Async validation.** `AddValidation()` now runs asynchronous rules, through
  `AsyncValidationAttribute` for a property and `IAsyncValidatableObject` for a
  type. Ran on GA: a rule that returned an error for a taken e-mail produced a
  400 `application/problem+json` with the error under `Email`, a type whose
  `ValidateAsync` yielded `End must be after Start` produced `errors: {"End": ...}`,
  and the valid request returned 201. Both APIs make you implement the
  synchronous path too (`IsValid` is abstract, and `IAsyncValidatableObject`
  extends `IValidatableObject`); in the Minimal API run I threw from it and it
  was never called. Rules and messages: `input-validation-in-minimal-apis`.
- **`[ShortCircuit]` as an attribute.** `[ShortCircuit(404)]` on a handler
  returned 404 without running the rest of the pipeline, next to the existing
  `.ShortCircuit(418)`. Ran on GA. See `route-constraints-short-circuit-and-handler-results`.
- **`IOutputCachePolicyProvider`.** `AddOutputCache()` registers it, so policies
  can be resolved at runtime (for example per tenant). Ran on GA: the service
  resolves. I did not build a provider with real policies. See
  `output-caching-and-http-caching`.
- **`HttpMethod.Query`, TempData and Session in Blazor SSR, `CacheView`,
  `QuickGrid` state in the URL, `Virtualize` anchoring, `DisplayName`,
  `BasePath`, SignalR authentication refresh.** All in the release notes and
  checked only against the RC3 build, not rerun on GA, so I give no output.
  Start from `blazor-static-ssr-and-enhanced-navigation`, `blazor-forms-editform-and-validation`
  and `signalr-websockets-and-sse`.
- **Passkeys and Identity.** Confirmation and lockout changes and passkey naming,
  per the release notes (not run). See `jwt-bearer-and-aspnet-core-identity`.

### Breaking: can change a result

- **OpenAPI 3.2 is the default.** `AddOpenApi()` wrote `"openapi": "3.2.0"` and
  `OpenApi3_1` wrote `3.1.2`. Ran on GA. The package now needs `Microsoft.OpenApi`
  3.x: a project pinning 2.7.5 failed restore with `NU1605`. Details in
  `openapi-document-generation`, fix in the migration concept.
- **The Blazor template no longer calls `UseAntiforgery()`.** Its form pages
  rely on the automatic check unless you add the call back. Ran on GA: the
  generated `Program.cs` has no `UseAntiforgery`.
- **Removed APIs.** The `ConcurrencyLimiter` middleware, `SetCompatibilityVersion`,
  `Router.PreferExactMatches` and `AddDataAnnotationsValidation`, per the
  breaking changes list (not run).

### Experimental or preview

The release notes also describe Device Bound Session Credentials and new Blazor
AI components. Both are marked experimental. They are not covered in this
track, and I did not run either. Do not plan production work on them.

## Trade-offs

- **A map is not a recipe.** Two lines say a feature exists, not how it fails.
  Read the concept that a link points to before you adopt it.
- **Automatic is not free.** The CSRF check, the hosting tags and the `Vary`
  header change what your clients and your telemetry see without a line of your
  code. A cache or a dashboard keyed on the old shape needs a look.
- **Opt-in features cost one forgotten call.**
  ```csharp
  builder.Services.AddValidation(); // async rules are ignored without it
  ```
- **Some release-note items have no concept yet.** The Blazor SSR state APIs,
  `QuickGrid`, `Virtualize` and the SignalR refresh are described, not taught
  here. Verify against a running app before you rely on them.
- **.NET 11 is not the LTS.** Take it for a feature you need. See
  `dotnet-support-lifecycle-and-choosing-a-target` for how long each release
  is supported.
- **Release notes age.** The page is tied to the 11.0 release. Recheck it for
  the patch version you run.

## Documentation Links

- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11) (doc)
- [Breaking changes in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/overview) (doc)
- [Migrate from ASP.NET Core 10 to 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/100-to-110) (doc)
- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
