---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A Blazor WebAssembly component runs in the browser, so every call it makes to
your API is a browser request, with a browser's rules: the same-origin policy,
CORS preflights, and a download that happens before the first pixel. This
concept builds a standalone client (`dotnet new blazorwasm`, SDK 10.0.100) and a
separate minimal API, runs both, and watches what happens in a real browser:
the exact failure when CORS is missing, what the API sees in each case, a
relative URL that quietly returns HTML, named clients, how big the publish
output is and what trimming, compression and invariant globalization do to it,
and lazy loading of an assembly. Where to put the data access behind an interface
so the same component runs on the server or in the browser is in Blazor Data
Access and Streaming Rendering; the render mode choice is in Blazor Render Modes
and Hosting Models. This one is about the client and the HTTP boundary.

## Use Cases

- Standing up a WebAssembly front end next to an existing API on another origin.
- Diagnosing "TypeError: Failed to fetch" when the API itself is healthy.
- Estimating and reducing the first-load download of a WebAssembly app.
- Deferring rarely used code with assembly lazy loading.

## Deep Dive

### The standalone project

`dotnet new blazorwasm` creates a project with
`Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"`. Its `Program.cs` builds a
`WebAssemblyHostBuilder`, registers the root components, and gives the app one
`HttpClient` whose base address is the origin that served the app:

```csharp
builder.Services.AddScoped(sp =>
    new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
```

There is no server project in this template: the output is a set of static
files, and the documentation says any static file server can host it. Inside a
component, `OperatingSystem.IsBrowser()` returned `True`. The documentation
describes this `HttpClient` as implemented on the browser's Fetch API and subject
to its limits, including the same-origin policy, and as "focused on making
requests back to the server of origin".

### What CORS looks like from both sides

The test page calls an API on another port. The API is a minimal API with two
endpoints and a policy that is switched on by configuration:

```csharp
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5602").AllowAnyHeader().AllowAnyMethod()));
// ...
app.UseCors();
app.MapGet("/api/products", () => new[] { new Product(1, "Pen", 1.5m), new Product(2, "Ink", 7m) });
app.MapPost("/api/products", (Product p) => Results.Created($"/api/products/{p.Id}", p));
```

```razor
items = await Http.GetFromJsonAsync<List<Product>>("http://localhost:5601/api/products") ?? [];
```

With the policy off, the browser console printed `has been blocked by CORS
policy: No 'Access-Control-Allow-Origin' header is present`, and the component
caught `HttpRequestException: TypeError: Failed to fetch`. That message is all
the .NET side gets: no status code, no body. The API log (request logging on)
shows the part that surprises people:

```text
GET  /api/products   -> 200   (the endpoint ran; the browser discarded the response)
OPTIONS /api/products -> 405  (the preflight for the JSON POST; the POST was never sent)
```

A simple GET is sent and executed, and only the read is blocked, so CORS is not
a defence for a state-changing GET. A POST with a JSON body triggers a preflight
first, and without a policy the API answered it with 405 and the browser stopped.
With the policy on, the same page logged `GET 200`, `OPTIONS 204`, `POST 201` and
showed `post 201`. The origin must match exactly, scheme, host and port: the same
client opened at `http://127.0.0.1:5602` instead of `localhost:5602` failed again
with `Failed to fetch`. The documentation adds that `SetBrowserRequestMode` with
`NoCors` does not get around this for an API you do not control. Its advice is to
call your own backend, which calls the external API from server code, or to use a
proxy. Cookie credentials are an opt-in per request
(`SetBrowserRequestCredentials(BrowserRequestCredentials.Include)`).

### The base address trap

The default client points at the origin that serves the static files. A
relative call such as `Http.GetAsync("api/products")` in the standalone app
therefore goes to the dev server, not to the API:

```text
200 text/html http://localhost:5602/ first: <!DOCTYPE html><html lang="en
JsonException: ExpectedStartOfValueNotFound, < Path: $ | LineNumber: 0
```

The static host answered the unknown path with `index.html` and a 200, so the
failure appears as a JSON parsing error instead of a 404. When the API is on
another origin, give the client that origin. A named client does it without
changing the default one:

```csharp
builder.Services.AddHttpClient("api", c => c.BaseAddress = new Uri("http://localhost:5601"));
```

```razor
@inject IHttpClientFactory Factory
var http = Factory.CreateClient("api");
var items = await http.GetFromJsonAsync<List<Product>>("api/products");
```

This needs the `Microsoft.Extensions.Http` package, as the documentation says;
the page then read `http://localhost:5601/ -> 2 items, first Pen`. Typed clients
are supported the same way. In a Blazor Web App the documentation adds a caveat:
`HttpClient` services are not registered in the server project by default, so a
WebAssembly component that is prerendered needs the registration on the server
too, or prerendering turned off for it.

### What the browser downloads

In `dotnet run` (Debug) the browser made about 200 requests, one `.wasm` per
assembly. Since .NET 8 the assemblies are shipped as `.wasm` files in the Webcil
format by default (`WasmEnableWebcil` turns it off). A Release publish is very
different. I published the template with a page and a router change on SDK
10.0.100 and summed the files a client loads (the `.wasm` files, the `dotnet*.js`
and `blazor.webassembly.js` scripts and one ICU data file):

| Publish | `.wasm` files | Raw | Brotli |
|---|---|---|---|
| Default (trimmed) | 37 | 7.0 MiB | 2.25 MiB |
| `-p:PublishTrimmed=false` | 201 | 18.8 MiB | 5.85 MiB |
| `-p:InvariantGlobalization=true` | 37 | 6.4 MiB | 2.09 MiB |

These sums include the 4.9 KB lazy assembly of the next section, and they are
close to the 6.7 and 2.1 MiB measured for the Auto template in the render modes
concept. The documentation says Blazor trims IL on each Release build, and the
untrimmed row shows how much that is worth. Its default trimmer granularity is
`partial`: only the core framework libraries and libraries that opted in to
trimming are trimmed. `InvariantGlobalization=true` removed the ICU data file
from the output (the default one was `icudt_EFIGS.dat`, 0.5 MiB raw, which the
documentation says is the file loaded for the `en-US` culture). The same page
says invariant globalization reduces the download size and speeds up startup, and
that the invariant culture is generally based on `en-US`, so it suits apps that
do not need localization. Publish also wrote a `.br` and a `.gz` next to every file, which
the documentation describes as static compression (Brotli at the highest level,
and gzip) that the host must serve: a static host without content negotiation
for precompressed files needs extra work, and the documentation describes a
Brotli decoder workaround. The publish folder had no `blazor.boot.json`. The
build also printed a recommendation to install the `wasm-tools` workload; I did
not install workloads, so relinking and AOT were not measured.

### Lazy loading an assembly

A class library `Reports` with one routable page (`/reports`) is referenced by
the client and marked for lazy loading by its file name with the extension:

```xml
<ProjectReference Include="../Reports/Reports.csproj" />
<BlazorWebAssemblyLazyLoad Include="Reports.wasm" />
```

```razor
@inject LazyAssemblyLoader Loader
<Router AppAssembly="@typeof(App).Assembly" AdditionalAssemblies="lazy" OnNavigateAsync="OnNavigate" ...>

@code {
    List<Assembly> lazy = [];
    bool loaded;
    async Task OnNavigate(NavigationContext ctx)
    {
        if (ctx.Path == "reports" && !loaded)
        {
            lazy.AddRange(await Loader.LoadAssembliesAsync(["Reports.wasm"]));
            loaded = true;
        }
    }
}
```

Reading `performance.getEntriesByType('resource')` in the browser showed that
`Reports.*.wasm` was not requested on startup, and appeared after
`Blazor.navigateTo('/reports')`; the page then rendered content from the lazy
assembly. A direct load of `/reports` also worked, because `OnNavigateAsync`
runs for the first navigation. In Debug the `Reports.pdb` was fetched at startup,
only the assembly was deferred. The test assembly was 4.9 KB, so this shows the
mechanism, not a saving. The documentation warns against lazy loading core
runtime assemblies, which may have been trimmed, and each dependency of a lazy
assembly needs its own entry.

### Running two projects

The API and the client are two processes. `dotnet run --no-launch-profile --urls
http://localhost:5601` in the API folder and the same with `5602` in the client
folder worked. The flag matters: in the Blazor Web App I ran for the Razor experiments,
setting `ASPNETCORE_URLS` was ignored because the launch profile's URL won, and
the app failed to bind a port that was already in use. Keep the allowed CORS origin and
the client's API base address in configuration, not in code, so the two ports
can change together.

## Trade-offs

- **WebAssembly removes the per-user server circuit and adds a download.** The
  default trimmed template is about 2.2 MiB with Brotli before your code, while
  a server-rendered page needed one script of 47.5 KB with Brotli in the render
  modes measurement.
- **CORS is the browser's rule, so the .NET client cannot report why a call
  failed.** Log requests on the API side to separate a blocked response from a
  request that never arrived.
  ```text
  Logging__LogLevel__Microsoft.AspNetCore=Information dotnet run --no-launch-profile ...
  ```
- **A named client avoids the base address trap and adds a package.** The default
  client is right for same-origin APIs; use `AddHttpClient("api", ...)` for the rest.
- **Trimming makes the download smaller and makes reflection fragile.** The
  trimmer documentation warns that reflection-heavy code (JS interop, JSON
  serialization) can lose types or parameter names, so test the published output,
  not only `dotnet run`.
- **Lazy loading defers bytes and adds a navigation delay.** It pays when the
  deferred assembly is large and rarely used, and needs a `<Navigating>` state.
- **Invariant globalization saved 0.6 MiB raw (0.16 MiB with Brotli) and gives up
  locale data.** Fine for an English-only tool, wrong for an app that formats
  dates and numbers per user.

## Documentation Links

- [Call a web API from an ASP.NET Core Blazor app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/call-web-api) (doc)
- [Host and deploy ASP.NET Core Blazor WebAssembly, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/webassembly/) (doc)
- [Lazy load assemblies in ASP.NET Core Blazor WebAssembly, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-lazy-load-assemblies) (doc)
- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Configure the Trimmer for ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/host-and-deploy/configure-trimmer) (doc)
- [ASP.NET Core Blazor globalization and localization, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/globalization-localization) (doc)
