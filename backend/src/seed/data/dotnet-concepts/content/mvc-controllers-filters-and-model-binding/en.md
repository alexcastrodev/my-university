---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Most ASP.NET Core APIs in production, and most job postings that mention ASP.NET Core, still use controllers: classes deriving from `ControllerBase`, registered with `AddControllers` and mapped with `MapControllers`. They solve the same problems as Minimal APIs with different machinery: `[ApiController]` switches on automatic 400 responses and binding source inference, model binding reads route, query, header, form and body through value providers and input formatters, and a filter pipeline (authorization, resource, action, exception, result) wraps every action. Each of those has rules that are easy to get wrong: a complex parameter silently bound from the query string, an entity parameter that lets a caller set `IsAdmin`, an exception filter that a global one overrides. This concept runs one controller app and records what each request returned and which filter methods ran, in which order. Razor Pages, views, Tag Helpers and view components are out of scope (a later lesson). Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (MVC and `Microsoft.Extensions.Validation` are in the shared framework, no package needed).

## Use Cases

- Maintaining or extending an existing controller-based API, which is still the most common shape of ASP.NET Core code in companies.
- Putting cross-cutting rules (audit, tenant checks, result shaping) in one filter instead of every action.
- Accepting writes safely: binding request bodies to DTOs so callers cannot set fields they do not own.
- Migrating an ASP.NET MVC 5 or Web API 2 application and knowing which concepts survived.

## Deep Dive

### AddControllers, MapControllers and what `[ApiController]` turns on

```csharp
builder.Services.AddControllers();   // then, after Build(): app.MapControllers();
public record CreateItem([Required] string? Name, [Range(1, 10)] int Quantity);

[ApiController, Route("api/items")]
public class ItemsController : ControllerBase
{
    [HttpPost] public object Create(CreateItem item) => new { item, valid = ModelState.IsValid };
}
```

I added a `PlainController` with the same action but without `[ApiController]`, and a global filter that logs every `OnXxx` call. The docs list what the attribute adds: attribute routing as a requirement, automatic HTTP 400 responses, binding source inference, `multipart/form-data` inference for `IFormFile`, and problem details for error status codes.

### Automatic 400 with `ValidationProblemDetails`

```text
POST /api/items {"quantity":50}
400 application/problem+json; charset=utf-8 {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more validation errors occurred.","status":400,"errors":{"Name":["The Name field is required."],"Quantity":["The field Quantity must be between 1 and 10."]},"traceId":"0HNPL16EJJ4JH:00000001"}
trace: OnAuthorization > OnResourceExecuting > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

The action never ran, and neither did my global action filter: the check is done by `ModelStateInvalidFilter`, an action filter whose `Order` I read as -2000, so it short-circuits before filters with the default order 0. The docs' sample body still shows an `rfc7231` link; 10.0.0 wrote `rfc9110`. Without `[ApiController]`, nothing stops the action and you must check `ModelState.IsValid` yourself.

### Binding source inference, `[FromBody]` and ProblemDetails

The same JSON sent to both controllers, then a 404 from `NotFound()` in each:

```text
POST /api/items   {"name":"pen","quantity":2} -> 200 {"item":{"name":"pen","quantity":2},"valid":true}
POST /plain/items {"name":"pen","quantity":2} -> 200 {"item":{"name":null,"quantity":0},"valid":false,"errors":2}
POST /plain/items?name=pen&quantity=2         -> 200 {"item":{"name":"pen","quantity":2},"valid":true,"errors":0}
GET /api/items/0   -> 404 application/problem+json {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found","status":404,"traceId":"..."}
GET /plain/items/0 -> 404 (no content type, empty body)
```

`[ApiController]` inferred `[FromBody]` for the complex parameter. The plain controller bound it from form, route and query values, ignored the JSON and still returned 200: the classic "my body is always null" bug. The docs list the inference rules: complex types registered in DI become `[FromServices]`, other complex types `[FromBody]`, `IFormFile` `[FromForm]`, names in a route template `[FromRoute]`, everything else `[FromQuery]`. Simple types are never inferred from the body. An inferred body is also required:

```text
POST /api/items (no body, no Content-Type) -> 415 {"title":"Unsupported Media Type","status":415,...}
POST /api/items (empty body, application/json) -> 400 {"errors":{"":["A non-empty request body is required."],"item":["The item field is required."]},...}
```

The docs mention only the 400 case; with no `Content-Type` I got 415 first.

Attribute routing is enforced at startup. An `[ApiController]` without `[Route]`, mapped with `MapControllerRoute("default", "{controller}/{action}")`, threw from that call:

```text
System.InvalidOperationException: Action 'NoRouteController.Index (Lab)' does not have an attribute route. Action methods on controllers annotated with ApiControllerAttribute must be attribute routed.
```

### Turning the behaviors off

```csharp
builder.Services.Configure<ApiBehaviorOptions>(o =>
{
    o.SuppressModelStateInvalidFilter = true;          // no automatic 400
    o.SuppressInferBindingSourcesForParameters = true; // no inference
    o.SuppressMapClientErrors = true;                  // no ProblemDetails for NotFound() etc.
});
```

```text
POST /api/items {"quantity":50}          -> 200 {"item":{"name":null,"quantity":0},"valid":false}
POST /api/items?name=pen&quantity=2      -> 200 {"item":{"name":"pen","quantity":2},"valid":true}
GET /api/items/0                         -> 404 (empty body)
```

With inference off, the body was not even read (`quantity` is 0, not 50) and the action ran with an invalid model. Turn these off one at a time and only on purpose.

### Binding sources and precedence

```csharp
[HttpPost("sources/{id}")]
public object Sources([FromRoute] int id, [FromQuery] string sort, [FromHeader(Name = "X-Tenant")] string tenant,
    [FromBody] CreateItem body, [FromServices] TimeProvider clock) => new { id, sort, tenant, body, clock = clock.GetType().Name };
```

```text
POST /api/items/sources/5?sort=name, X-Tenant: acme, {"name":"pen","quantity":2}
200 {"id":5,"sort":"name","tenant":"acme","body":{"name":"pen","quantity":2},"clock":"SystemTimeProvider"}
POST /api/items/form (form name=pen&quantity=3, [FromForm] CreateItem) -> 200 {"name":"pen","quantity":3}
POST /api/items (same form, inferred body) -> 415 Unsupported Media Type
```

Without attributes, the docs give the order form fields, body (only with `[ApiController]`), route data, query string, files. I sent the same `id` three ways to `Prec(int id)` on `/prec/{id}`:

```text
plain, POST /plain/prec/1?id=2 with form id=3 -> {"id":3}
plain, POST /plain/prec/1?id=2 without form  -> {"id":1}
api,   POST /api/items/prec/1?id=2 with form id=3 -> {"id":1}
```

On a plain controller a form field beats the route value, which matters when an id in the URL was authorized but the form says otherwise. `[ApiController]` pinned `id` to the route. Two body parameters fail at startup, from `MapControllers()`:

```text
System.InvalidOperationException: Action 'TwoBodiesController.Post (Lab)' has more than one parameter that was specified or inferred as bound from request body. Only one parameter per action may be bound from body. Inspect the following parameters, and use 'FromQueryAttribute' to specify bound from query, 'FromRouteAttribute' to specify bound from route, and 'FromBodyAttribute' for parameters to be bound from body:
CreateItem a
CreateItem b
```

### When binding fails: conversion, `[BindRequired]`, `[BindNever]`

```text
GET /api/items/page?page=abc -> 400 {"errors":{"page":["The value 'abc' is not valid."]}}
GET /api/items/page          -> 200 {"page":0}
POST /api/items {"name":"pen","quantity":"abc"} -> 400 {"errors":{"item":["The item field is required."],"$.quantity":["The JSON value could not be converted to CreateItem. Path: $.quantity | LineNumber: 0 | BytePositionInLine: 30."]}}
GET /api/items/req (Req([BindRequired] int page)) -> 400 {"errors":{"page":["A value for the 'page' parameter or property was not provided."]}}
GET /api/items/req?page=0 -> 200 {"page":0}
```

A missing `int` is silently 0; `[BindRequired]` distinguishes "absent" from "0". The JSON error names the record (`CreateItem`), not `int`, and the failed body adds a second "field is required" error. The docs say `[BindRequired]`, `[BindNever]` and `[Bind]` apply to form and value-provider binding only, not to input formatters (JSON, XML); the next section shows what that means.

### Over-posting: entity parameter vs DTO

```csharp
public class User { public int Id { get; set; } public string Name { get; set; } = ""; [BindNever] public bool IsAdmin { get; set; } }

[HttpPut("{id}/entity")] public User PutEntity(int id, User user) { user.Id = id; Db[id] = user; return user; }
[HttpPut("{id}/dto")]    public User PutDto(int id, UpdateUserDto dto) { Db[id].Name = dto.Name; return Db[id]; }
public record UpdateUserDto([Required] string Name);
```

```text
GET /api/users/1                                         -> {"id":1,"name":"alice","isAdmin":false}
PUT /api/users/1/entity {"name":"mallory","isAdmin":true} -> {"id":1,"name":"mallory","isAdmin":true}
GET /api/users/1                                         -> {"id":1,"name":"mallory","isAdmin":true}
PUT /api/users/2/dto    {"name":"mallory","isAdmin":true} -> {"id":2,"name":"mallory","isAdmin":false}
PUT /api/users/3/form   name=mallory&isAdmin=true ([FromForm] User) -> {"id":3,"name":"mallory","isAdmin":false}
```

The caller made itself admin through the entity, although `IsAdmin` carries `[BindNever]`: System.Text.Json does not read MVC binding attributes. `[BindNever]` worked only for the form. The DTO has no `IsAdmin`, so the extra JSON property was dropped and the stored entity kept `false`; that is the argument of `dtos-and-the-api-contract`. To reject unknown properties instead of ignoring them, I set `UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow` in `AddJsonOptions`:

```text
400 {"errors":{"dto":["The dto field is required."],"$.isAdmin":["The JSON property 'isAdmin' could not be mapped to any .NET member contained in type 'UpdateUserDto'."]}}
```

### The filter pipeline, traced

One global filter implements `IAuthorizationFilter`, `IResourceFilter`, `IActionFilter`, `IExceptionFilter` and `IResultFilter`; the action parameter is an `IParsable<T>` type whose `TryParse` logs "model binding". Four requests:

```text
ok:       OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > ACTION > OnActionExecuted(exception=none, canceled=False) > OnResultExecuting > OnResultExecuted > OnResourceExecuted
throws:   OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > ACTION throws > OnActionExecuted(exception=InvalidOperationException, canceled=False) > OnException(handled=False, result=null) > OnResourceExecuted
?block=1: OnAuthorization > OnResourceExecuting > model binding > OnActionExecuting > OnResultExecuting > OnResultExecuted > OnResourceExecuted   (409 from c.Result in OnActionExecuting)
?deny=1:  OnAuthorization   (403 from c.Result in OnAuthorization)
```

Resource filters wrap model binding, so they can short-circuit before the body is read (caching, feature flags). When the action threw, `OnActionExecuted` saw the exception, the exception filter wrote the 500 and the result filters did not run, as the docs say. An action filter that sets `Result` skips the action and its own `OnActionExecuted`, but result filters still run. An authorization filter's result skips everything else.

### Scope and `Order`

`NamedFilter` is an `IAsyncActionFilter` (`before`, `await next()`, `after`), applied globally, on the controller, on the action, and once more on the action with `Order = -1`:

```text
OnAuthorization > OnResourceExecuting > action-order-minus1 before > OnActionExecuting > global before > controller before > action before > ACTION > action after > controller after > global after > OnActionExecuted(exception=none, canceled=False) > action-order-minus1 after > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

Default order is global, controller, action, with the "after" code reversed. A lower `Order` wins over scope: the action filter with -1 ran outside both global filters (`Order` 0).

### Attribute vs `TypeFilter` vs `ServiceFilter`

Each filter's constructor incremented a counter; I sent 3 requests to each endpoint:

```text
constructed before count requests: attribute=2
constructed: attribute=2, service-scoped=3, service-singleton=1, type=3, type-reusable=1
```

A filter attribute is an object built when the app builds its action descriptors (twice in my run, both at startup), shared by all requests, so it cannot receive constructor injection. `[TypeFilter(typeof(F))]` creates `F` per request with `ObjectFactory`: `F` need not be registered, its dependencies come from DI, and `Arguments` fills the rest. `[ServiceFilter(typeof(F))]` resolves `F` from DI, so the registered lifetime decides (scoped: one per request; singleton: one). `IsReusable = true` made `TypeFilter` create one instance for all requests; the docs warn not to combine it with dependencies that are not singletons.

### Exception filters vs exception handling middleware

`ErrorsController` has a controller-scoped `IExceptionFilter` that turns `KeyNotFoundException` into 404; the app also has `UseExceptionHandler()` plus `AddProblemDetails()`, and my global trace filter (which writes 500 if nothing set a result):

```text
GET /x/action -> 404 {"title":"order 42","status":404}
trace: ... OnActionExecuted(exception=KeyNotFoundException, canceled=False) > ApiExceptionFilter handled KeyNotFoundException > OnException(handled=False, result=NotFoundObjectResult) > OnResourceExecuted
GET /x/action?mark=1 (filter also sets ExceptionHandled = true) -> 404 {"title":"order 42","status":404}
trace: ... OnActionExecuted(exception=KeyNotFoundException, canceled=False) > ApiExceptionFilter handled KeyNotFoundException > OnResourceExecuted
GET /x/result (IActionResult throws in ExecuteResultAsync) -> 500 application/problem+json {"title":"An error occurred while processing your request.","status":500,...}
trace: ... OnActionExecuted(exception=none, canceled=False) > OnResultExecuting > OnResultExecuted > OnResourceExecuted
```

The controller filter ran first, and setting only `Result` did not stop the global exception filter, which could have overwritten the response; `ExceptionHandled = true` did. An exception during result execution skipped every exception filter, as the docs say. The docs recommend middleware and exception filters only when error handling must differ per action (JSON for APIs, HTML for views). Prefer `IExceptionHandler` and problem details (`problem-details-and-global-exception-handling`): one place for controllers, Minimal APIs and middleware.

### `ActionResult<T>` and `IActionResult`

```csharp
[HttpGet("typed/{id}")] public ActionResult<CreateItem> Typed(int id) => id == 0 ? NotFound() : new CreateItem("pen", id);
```

```text
GET /x/typed/1 -> 200 {"name":"pen","quantity":1}
GET /x/typed/0 -> 404 application/problem+json {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found","status":404,...}
```

Implicit conversions let the action return either `T` or any `ActionResult`, and the docs note that the response type is inferred from `T`, so `[ProducesResponseType(200)]` needs no `Type`. `IActionResult` hides the payload type, so it needs `[ProducesResponseType(200, Type = typeof(T))]`. Interfaces such as `IEnumerable<T>` cannot convert implicitly; return a concrete type such as a list.

### Controllers vs Minimal APIs, same endpoint

| | Controllers | Minimal APIs |
|---|---|---|
| Binding | Value providers, input formatters, inference under `[ApiController]`; form beats route on plain controllers | Fixed rules per parameter, see `parameter-binding-and-endpoint-filters` |
| Validation | Data annotations on by default; automatic 400 with `[ApiController]` | Only after `AddValidation()` (`input-validation-in-minimal-apis`) |
| Filters | Five filter stages plus global, controller and action scope | Endpoint filters only, per endpoint or group |
| Routing | Attribute routes (`[Route]`, `[HttpGet]`) | `MapGet`, route groups |
| Testability | Actions are methods on a class you can construct | Handlers are delegates; `TypedResults` makes them unit-testable |

I sent `{"quantity":50}` to `app.MapPost("/min/items", (CreateItem item) => ...)`: 200 with no validation, 400 with `ValidationProblemDetails` after `AddValidation()`. One oddity on 10.0.0: `GET /min/page?page=abc` (an `int` parameter) returned 400 with an empty body, but with `AddValidation()` registered the handler still ran and the response was 400 with body `{"page":0}`. For choosing between the models, see `choosing-an-aspnet-core-application-model`.

### Book vs today: what changed since ASP.NET MVC 5 (exam 70-486)

- `System.Web` is gone: I found no `System.Web` assembly loaded, and `ControllerBase.Request` is `Microsoft.AspNetCore.Http.HttpRequest`, where MVC 5's `Controller.Request` was `System.Web.HttpRequestBase`. `Request.Query` is the collection; `Request.QueryString` is the raw string. Outside a controller the docs recommend `IHttpContextAccessor` instead of `HttpContext.Current`.
- The migration docs state that HTTP modules, `Global.asax.cs`, Web.config (except IIS configuration) and the application life cycle are gone; modules and handlers become middleware configured in code (`Program.cs`), and settings move to `appsettings.json`.
- MVC and Web API are one framework: `ApiController` and `IHttpActionResult` become `ControllerBase` and `ActionResult<T>`.
- Bundling: the docs say ASP.NET Core has no native bundling and minification (no `BundleConfig`); use front-end tooling.
- Antiforgery: `[HttpPost]` alone validates nothing. My form POST to a `[FromForm]` action without a token got 200 under `AddControllers`. For views the docs recommend registering `AutoValidateAntiforgeryTokenAttribute` globally rather than per-action `[ValidateAntiForgeryToken]`.

## Trade-offs

- **`[ApiController]` is the safe default.** Without it, a JSON body binds to nothing and the action runs with an invalid model and returns 200.
- **Never bind entities.** `[BindNever]` and `[Bind]` do not affect JSON bodies; a DTO per use case is the only reliable over-posting fix.
  ```csharp
  public record UpdateUserDto([Required] string Name);   // no IsAdmin to set
  ```
- **Know which source wins.** On a plain controller a form field overrode the route id; pin security-relevant values with `[FromRoute]`.
- **Filter lifetime is a choice.** Attributes are shared instances, `TypeFilter` is per request, `ServiceFilter` follows the DI registration; a scoped dependency inside a reused filter is a bug.
- **Exception filters are narrower than middleware.** They miss result execution, resource filters and everything outside MVC, and a later filter can overwrite your result unless you set `ExceptionHandled`.
- **More machinery than Minimal APIs.** Value providers, conventions and five filter stages cost startup work and learning time; new small services usually start with Minimal APIs, existing controller code does not need a rewrite.

## Documentation Links

- [Create web APIs with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-10.0) (doc)
- [Filters in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters?view=aspnetcore-10.0) (doc)
- [Model Binding in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding?view=aspnetcore-10.0) (doc)
- [Model validation in ASP.NET Core MVC and Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-10.0) (doc)
- [Controller action return types in ASP.NET Core web API, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/action-return-types?view=aspnetcore-10.0) (doc)
- [Migrate HTTP modules to ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/fx-to-core/areas/http-modules?view=aspnetcore-10.0) (doc)
