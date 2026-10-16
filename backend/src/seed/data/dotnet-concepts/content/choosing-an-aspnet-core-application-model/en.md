---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

"ASP.NET Core" is not one programming model but a shared host with several
models plugged into it: minimal APIs, controllers, Razor Pages, MVC views,
Blazor components, gRPC services, and a JavaScript SPA served next to an API.
The goal of this concept is to pick among them on purpose: know what each one
is for, what it costs in files, languages and runtime behavior, and which parts
(pipeline, DI, configuration, authentication) you keep no matter what you pick.
The template measurements and HTTP responses below come from the .NET 10 SDK
(10.0.100).

## Use Cases

- Starting a new project and deciding which `dotnet new` template to run.
- An existing MVC or Razor Pages app that needs some interactive pages, where
  the question is "rewrite or add Blazor components?".
- A team with strong React or Angular skills deciding whether the front end
  lives in Blazor or stays in JavaScript with an ASP.NET Core API behind it.
- Service-to-service traffic where JSON over HTTP is not the only option and
  gRPC is on the table.
- A product that also needs a desktop or mobile client and wants to reuse C#
  code across them.

## Deep Dive

### The official recommendations, read carefully

The "Choose an ASP.NET Core UI" page says that for new project development
Microsoft recommends Blazor, and the APIs overview says that for new projects it
recommends minimal APIs. Neither page declares the alternatives obsolete. Razor
Pages and MVC are still described as mature models for server-rendered UI, and
controllers are still listed as the better fit when you need model binding
extensibility (`IModelBinderProvider`, `IModelBinder`), advanced validation
(`IModelValidator`), application parts or the application model, or OData. The
doc adds that most of those can be built for minimal APIs by hand, while
controllers ship them. So "recommended for new projects" is a default, not a
migration order for apps that already work.

### What each template gives you

Generating each web template with `dotnet new <template> --no-restore` and
counting files (excluding the vendored Bootstrap and jQuery under
`wwwroot/lib`) gave:

```text
template     files  wwwroot/lib  projects  extra packages
web            5        0           1      none
webapi         6        0           1      Microsoft.AspNetCore.OpenApi
webapiaot      6        0           1      Microsoft.AspNetCore.OpenApi
grpc           7        0           1      Grpc.AspNetCore
mvc           18       60           1      none
webapp        19       60           1      none          (Razor Pages)
blazor        22       44           1      none          (default: Server interactivity)
blazorwasm    18       44           1      Components.WebAssembly + DevServer
```

`blazor --interactivity Auto` (or `WebAssembly`) produced two projects, the
server app and a `.Client` project, because code that runs in the browser has
to be compiled into its own assembly. That split is the first visible cost of
client-side rendering. Also note that the .NET 10 `webapi` template is a
minimal API by default; controllers need `--use-controllers`.

The `Program.cs` files differ only in a few lines, which is the point of the
shared host:

```text
web       app.MapGet("/", ...)
webapi    AddOpenApi + MapOpenApi + MapGet
mvc       AddControllersWithViews + MapControllerRoute
webapp    AddRazorPages + MapRazorPages
blazor    AddRazorComponents + MapRazorComponents<App> + UseAntiforgery
grpc      AddGrpc + MapGrpcService<GreeterService>
```

Exception handling, HSTS, HTTPS redirection, `MapStaticAssets` and
authorization appear in the UI templates in the same order. Learning the
pipeline once pays off in every model.

### Models coexist in one host

Because they are just endpoint sources, models can be mixed in a single app.
This file-based app registers a minimal API endpoint and an `[ApiController]`
controller, both consuming the same singleton and the same middleware:

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddValidation();
builder.Services.AddSingleton<Clock>();
var app = builder.Build();
app.Use(async (ctx, next) => { ctx.Response.Headers["X-Pipeline"] = "shared"; await next(); });
app.MapPost("/minimal/orders", (Order o, Clock c) => TypedResults.Ok(new { o.Sku, at = c.Name }));
app.MapControllers();
app.Run();

public record Order([Required] string Sku, [Range(1, 10)] int Qty);
public class Clock { public string Name => "same singleton"; }

[ApiController, Route("controller/orders")]
public class OrdersController(Clock c) : ControllerBase
{
    [HttpPost] public IActionResult Post(Order o) => Ok(new { o.Sku, at = c.Name });
}
```

Valid requests to both routes returned `200`, the `X-Pipeline: shared` header
and `{"sku":"A1","at":"same singleton"}`. Invalid bodies showed where the
models still differ:

```text
POST /controller/orders {"qty":50}
  400 application/problem+json; charset=utf-8
  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more
   validation errors occurred.","status":400,"errors":{...},"traceId":"..."}

POST /minimal/orders {"qty":50}
  400 application/json; charset=utf-8
  {"title":"One or more validation errors occurred.","errors":{...}}
```

`[ApiController]` produces a full ProblemDetails response on its own. The
minimal API validation added in .NET 10 returned only `title` and `errors`
until `AddProblemDetails()` was registered; after that it answered
`application/problem+json` with `type`, `status` and `traceId`, matching the
controller. Mixing models is fine, but defaults like this one are per model,
and a client sees the difference.

### Server-rendered UI: Razor Pages and MVC

Both render HTML on the server for every request, so the browser receives a
finished page and needs no .NET runtime. Razor Pages organizes code by page
(a `.cshtml` plus its page model), which keeps simple form flows short. MVC
organizes code by controller and action and routes views through them, which
suits large sites with many actions over the same resources. Interactivity is
whatever JavaScript you add yourself. Both can host Razor components through
the Component Tag Helper, which is how an existing app adds interactive islands
without a rewrite.

### Blazor: one component model, several render locations

Blazor components can render statically on the server, interactively over a
SignalR circuit (Server), in the browser on WebAssembly, or start on the server
and switch to WebAssembly (Auto). The render-modes concept covers what each
costs: a circuit holds memory per user on the server, WebAssembly downloads
the runtime, and Auto needs the two-project layout measured above. The main
selling point is one language and shared types from database to button.

### SPA with an ASP.NET Core API

When the front end is React, Angular or Vue, ASP.NET Core is the API (usually
minimal APIs) plus the static file host. The UI doc lists the downsides
plainly: more languages and tools, and logic such as validation tends to be
written twice. The upside is the JavaScript ecosystem and hiring pool. Browser
calls from another origin need CORS, and authentication usually moves from
cookies to tokens or to a backend-for-frontend.

### Services and non-web clients

gRPC (`grpc` template) uses HTTP/2 and Protocol Buffers with generated clients,
a good fit between services you control, but browsers cannot call it directly
without gRPC-Web. Background processing without HTTP belongs in the `worker`
template. For desktop and mobile, .NET MAUI is Microsoft's cross-platform UI,
and MAUI can host Blazor components (Blazor Hybrid) to share UI with the web
app; Avalonia and Uno Platform are third-party alternatives. The web side of
those apps is again an API.

### A short decision path

1. Only machines call it? Minimal APIs; controllers if you need the features
   listed above; gRPC for internal high-volume calls.
2. Human users, team writes C#? Blazor, starting with static SSR and adding
   interactivity per page.
3. Existing MVC or Razor Pages app? Keep it and add components where needed.
4. Team or product already committed to a JavaScript framework? SPA plus API.

## Trade-offs

- **Recommended versus familiar.** Minimal APIs and Blazor are the default for
  new code, but a team fluent in controllers ships faster with controllers, and
  the docs explicitly support that.
- **Mixing models.** One host can serve all of them, but each brings its own
  defaults (validation responses, routing conventions, filters versus endpoint
  filters), so document which model owns which routes.
  ```text
  /api/*  minimal APIs     /admin/*  Razor Pages     /app/*  Blazor
  ```
- **Server rendering versus client rendering.** Server-rendered pages are cheap
  for the client and easy to cache; interactive client code needs a runtime
  download (WebAssembly) or a persistent connection (Server circuit).
- **One language versus best-of-breed front end.** Blazor removes the
  duplicate model and validation code; a JavaScript SPA brings a larger
  component ecosystem and a separate build, deploy and security story.
- **Template weight.** The UI templates arrive with about 45 to 60 vendored
  front-end files; the API templates with none. Delete what you will not use on
  day one, or it becomes code nobody owns.

## Documentation Links

- [Choose an ASP.NET Core UI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/choose-web-ui) (doc)
- [APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis) (doc)
- [Integrate ASP.NET Core Razor components with MVC or Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/integration) (doc)
- [ASP.NET Core Blazor hosting models, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models) (doc)
- [Overview for gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/) (doc)
- [What is .NET MAUI?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/what-is-maui) (doc)
