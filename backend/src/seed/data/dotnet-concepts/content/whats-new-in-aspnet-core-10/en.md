---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The "What's new in ASP.NET Core 10" page is long: it spans Blazor, Minimal APIs,
OpenAPI, authentication, and a miscellaneous list of server changes. This
concept is a map of that page. Each change gets a few lines here, and the ones
that already have a full concept in this track link to it. Read it before an
upgrade to know which areas to test, then follow the links for the details.

Everything below was checked against the official release notes page. What the
page does not state is not claimed here.

## Use Cases

- Planning an upgrade from .NET 9 and deciding which changes need a test pass.
- Finding the concept that explains a feature you saw in the release notes.
- Telling apart what is automatic (nothing to do) from what is opt-in (a call
  or a package) from what can break existing code.
- Onboarding someone who knows ASP.NET Core 9 and needs only the delta.

## Deep Dive

### Hosting and server

- **Memory pool eviction.** Kestrel, IIS and HTTP.sys memory pools now release
  unused blocks when the app is idle or lightly loaded, with no configuration.
  Metrics appear under the `Microsoft.AspNetCore.MemoryPool` meter, and a
  built-in `IMemoryPoolFactory<T>` is available through DI. Full story in
  `kestrel-iis-and-hosting-models`.
- **`.localhost` top-level domain.** Kestrel binds `*.localhost` names to
  loopback, and `dotnet new web --localhost-tld` uses `*.dev.localhost` names.
- **HTTP.sys security descriptor.** `HttpSysOptions.RequestQueueSecurityDescriptor`
  customizes who may access a newly created request queue.
- **PipeReader JSON.** MVC, Minimal APIs and `ReadFromJsonAsync` use a
  PipeReader-based JSON parser with no code change. Custom converters that
  ignore `Utf8JsonReader.HasValueSequence` can fail.

### Minimal APIs and validation

- **Built-in validation.** `AddValidation()` validates query, header and body
  data with data annotations, returns a 400 with details, and can be switched
  off per endpoint with `.DisableValidation()`. Records work like classes. The
  APIs moved to the `Microsoft.Extensions.Validation` package, and failures
  can flow through `IProblemDetailsService`. See
  `input-validation-in-minimal-apis` and
  `problem-details-and-global-exception-handling`.
- **Empty form strings.** With `[FromForm]` on a complex type, an empty string
  now binds to `null` for nullable value types such as `DateOnly?`. Binding
  rules live in `parameter-binding-and-endpoint-filters`.
- **Server-Sent Events.** `TypedResults.ServerSentEvents` streams an
  `IAsyncEnumerable<SseItem<T>>` from Minimal APIs and controllers. No deep
  concept yet, so the official page is the source.
- **JSON Patch on System.Text.Json.** A new implementation ships in the
  `Microsoft.AspNetCore.JsonPatch.SystemTextJson` package. The page says it is
  not a drop-in replacement (no dynamic types such as `ExpandoObject`) and does
  not mitigate the security risks inherent to the JSON Patch standard.
- **`RedirectHttpResult.IsLocalUrl(url)`.** A helper that tells whether a URL
  is local, meant to guard redirects against open redirection.
- **Testing apps with top-level statements.** A source generator now emits
  `public partial class Program` when you did not write it, and an analyzer
  flags the explicit declaration.

### OpenAPI

- OpenAPI 3.1 is now the generated version, `Microsoft.OpenApi` moves to 2.0,
  YAML is served by a `.yaml` or `.yml` route suffix, XML doc comments feed the
  document, `Produces*` attributes accept `Description`, and transformers can
  be endpoint specific. Transformers written for 3.0 need updating. All of it is
  in `openapi-document-generation`.

### Blazor

- **Forms validation.** `DataAnnotationsValidator` now handles nested objects
  and collection items, after `AddValidation()` and a `[ValidatableType]`
  root. See `blazor-forms-editform-and-validation`.
- **Not Found.** `NavigationManager.NotFound`, the `Router` parameter
  `NotFoundPage`, and no more `<NotFound>` render fragment. See
  `blazor-routing-layouts-and-navigation`.
- **Declarative state.** `[PersistentState]` replaces manual
  `PersistentComponentState` code across prerendering, and circuit state can
  survive long disconnections. Prerendering context is in
  `blazor-data-access-and-streaming-rendering`.
- **Smaller items.** `QuickGrid` gained `RowClass` and `HideColumnOptionsAsync`,
  `InputHidden` is new, JS interop gained `InvokeConstructorAsync`,
  `GetValueAsync` and `SetValueAsync`, and the Blazor script is a fingerprinted
  static web asset. Hosting choices stay in `blazor-render-modes-and-hosting-models`.

### Identity and observability

- **Passkeys.** ASP.NET Core Identity supports WebAuthn passkeys, and the Blazor
  Web App template includes them.
- **Metrics.** New authentication, authorization and Identity metrics, plus
  Blazor metrics and tracing.
- **API-friendly cookies.** For endpoints marked with `IApiEndpointMetadata`,
  cookie authentication returns 401 or 403 instead of a redirect.
- **Exception diagnostics.** `ExceptionHandlerOptions.SuppressDiagnosticsCallback`
  controls logging for exceptions an `IExceptionHandler` already handled.

## Trade-offs

- **A map is not a recipe.** Three to six lines say that a feature exists, not
  how it fails. For anything marked with a link, read the deep concept before
  you adopt it.
- **Automatic is not free.** Memory eviction and PipeReader JSON need no code,
  yet both can change behavior under load or with unusual converters, so load
  test an upgrade even when nothing in your code changes. Opt-in features cost
  one call, and that call is easy to forget.
  ```csharp
  builder.Services.AddValidation(); // without it, annotations are not enforced
  ```
- **Breaking changes hide inside feature lists.** The page lists changes such
  as Blazor WebAssembly `HttpClient` response streaming on by default and the
  `<NotFound>` fragment no longer supported. Read each Blazor and OpenAPI item
  as a possible migration task, not only as a gain.
- **Some features have no concept here yet.** SSE, JSON Patch, `IsLocalUrl`,
  passkeys and the metrics are only described. Treat the official page as the
  source and verify against a running app before you rely on them.
- **Release notes age.** The page is tied to the .NET 10 release. Later
  releases can change defaults, so recheck the page for your exact version.

## Documentation Links

- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Breaking changes in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/breaking-changes) (doc)
- [Generate OpenAPI documents, ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
