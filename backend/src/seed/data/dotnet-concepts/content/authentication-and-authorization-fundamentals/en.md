---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Authentication answers "who is this request from?" and authorization answers
"may that caller do this?". ASP.NET Core keeps the two apart on purpose: an
authentication **scheme** turns a cookie or a header into a `ClaimsPrincipal`,
and authorization **policies** decide against that principal. The goal is to
read an app's security setup and predict, for any request, whether it gets a
200, a 401, a 403 or a redirect, and why. Every status code in this concept
comes from real requests against a .NET 10 app (SDK 10.0.100).

## Use Cases

- Protecting a minimal API or a server-rendered app with `RequireAuthorization()`
  and named policies instead of `if` checks scattered in handlers.
- Choosing between a cookie (browser on the same site) and a bearer token (API
  called by other programs), or registering both.
- Making an app secure by default, so a new endpoint is closed until someone
  marks it public.
- Rules that depend on the data being accessed ("only the owner may edit this
  document"), which a static role check cannot express.

## Deep Dive

### Schemes, handlers and the three actions

`AddAuthentication` registers the authentication service, and each
`AddCookie`, `AddJwtBearer` and similar call registers a **scheme**: a name
bound to a handler plus its options. A handler has three jobs, per the
authentication overview:

- **Authenticate**: build the user from the request (decrypt the cookie,
  validate the token) or report "no result" or "failure".
- **Challenge**: answer an anonymous caller who hit a protected resource. The
  cookie handler redirects to a login page, the JWT bearer handler returns 401
  with `WWW-Authenticate: Bearer`.
- **Forbid**: answer a caller who is authenticated but not allowed. The cookie
  handler redirects to an access-denied page, the bearer handler returns 403.

With a single registered scheme, that scheme becomes the default. With several,
you name the default in `AddAuthentication("...")` or name the scheme in the
policy; otherwise the framework throws "No authenticationScheme was specified".

A detail that bites people writing custom handlers: a `ClaimsIdentity` counts as
authenticated only if it has an authentication type. Run in the app, the two
lines below printed `False` and then `True`:

```csharp
new ClaimsIdentity([new Claim(ClaimTypes.Name, "x")]).IsAuthenticated          // False
new ClaimsIdentity([new Claim(ClaimTypes.Name, "x")], "demo").IsAuthenticated  // True
```

### The experiment app

The app below uses the cookie scheme, a fallback policy, a role policy, a claim
policy, a custom requirement and a resource-based check. The `/login` endpoint
signs in whoever asks: it exists only to produce users for the experiment and
must never ship. `PublishAot=false` is there because file-based apps default to
Native AOT, and without it the app failed at startup when serializing the
anonymous type returned by `/me`.

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie();
builder.Services.AddSingleton<IAuthorizationHandler, MinimumAgeHandler>();
builder.Services.AddSingleton<IAuthorizationHandler, OwnerHandler>();
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("AdminOnly", p => p.RequireRole("admin"))
    .AddPolicy("Sales", p => p.RequireClaim("department", "sales"))
    .AddPolicy("Adult", p => p.AddRequirements(new MinimumAgeRequirement(18)));
var app = builder.Build();

app.MapPost("/login", async (HttpContext ctx, string name, string? role, string? dept, int? age) =>
{   // DEMO ONLY: no password check
    var claims = new List<Claim> { new(ClaimTypes.Name, name) };
    if (role is not null) claims.Add(new(ClaimTypes.Role, role));
    if (dept is not null) claims.Add(new("department", dept));
    if (age is not null) claims.Add(new("age", age.Value.ToString()));
    await ctx.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok();
}).AllowAnonymous();
app.MapGet("/public", () => "anyone").AllowAnonymous();
app.MapGet("/fallback", () => "covered by the fallback policy");
app.MapGet("/text", () => "plain text").RequireAuthorization();
app.MapGet("/me", (ClaimsPrincipal user) => new { user.Identity!.Name, IsAdmin = user.IsInRole("admin"),
    Claims = user.Claims.Select(c => $"{c.Type}={c.Value}") }).RequireAuthorization();
app.MapGet("/admin", () => new { ok = "admin" }).RequireAuthorization("AdminOnly");
app.MapGet("/adult", () => new { ok = "adult" }).RequireAuthorization("Adult");
```

There is no `UseAuthentication()` or `UseAuthorization()` call: `WebApplication`
adds both after routing when the services are registered (see the middleware
pipeline concept). Results, with `ana` (role admin, age 30) and `bob` (no role,
age 16):

```text
anonymous  GET /public    -> 200 anyone
anonymous  GET /fallback  -> 302 Location: /Account/Login?ReturnUrl=%2Ffallback
anonymous  GET /text      -> 302 Location: /Account/Login?ReturnUrl=%2Ftext
anonymous  GET /me        -> 401 (Location header still present)
ana        GET /admin     -> 200 {"ok":"admin"}
bob        GET /admin     -> 403
bob        GET /adult     -> 403
```

Three lessons are in that table. `/fallback` has no authorization metadata at
all and is still protected, because of the fallback policy. 401 means "I do not
know you" (challenge) and 403 means "I know you, and no" (forbid). And the
cookie handler answers differently for `/text` and `/me`, which the next
section explains.

### Cookie versus bearer, and the .NET 10 redirect change

A cookie is sent by the browser automatically, which suits server-rendered
pages and same-site front ends. The cookie the app issued was
`.AspNetCore.Cookies=...; path=/; samesite=lax; httponly`: JavaScript cannot
read it, and its content is encrypted with the Data Protection key ring, so
several instances behind a load balancer must share that key ring. Because the
browser attaches it on its own, cookie-authenticated endpoints that change
state also need antiforgery protection. A bearer token is attached by the
caller in the `Authorization` header, which suits APIs called by programs and
mobile apps; the JWT bearer concept continues there.

Before .NET 10, the cookie handler redirected every challenge and forbid to a
login or access-denied page, except for XHR requests. Since .NET 10, endpoints
recognized as APIs get 401 and 403 instead. The breaking-change note lists them:
`[ApiController]` actions, minimal APIs that read or write JSON, endpoints using
`TypedResults`, and SignalR. That is why `/me` (JSON) returned 401 and `/text`
(plain string) returned 302. The 401 still carries the `Location` header; only
the status changed. You can force either behavior per endpoint, and both were
checked:

```text
.RequireAuthorization().DisableCookieRedirect()         GET /text  -> 401
.RequireAuthorization("AdminOnly").AllowCookieRedirect() GET /admin -> 302 to /Account/Login
```

### Claims, roles and policies

A role is a claim of type `ClaimTypes.Role`; `RequireRole("admin")` and
`user.IsInRole("admin")` read it. `/me` showed how those claims look inside the
principal:

```text
http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name=ana
http://schemas.microsoft.com/ws/2008/06/identity/claims/role=admin
department=sales
age=30
```

A **policy** is a list of requirements, and all of them must succeed (AND). A
requirement can have several handlers, and any one calling `Succeed` satisfies
it (OR), unless some handler calls `Fail`, which forces failure. A handler that
does neither leaves the requirement pending, which is a failure. By default all
handlers run even after a failure (`InvokeHandlersAfterFailure` is `true`), and
the docs warn that their order is not guaranteed.

```csharp
class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, MinimumAgeRequirement req)
    {
        if (int.TryParse(ctx.User.FindFirst("age")?.Value, out var age) && age >= req.Age)
            ctx.Succeed(req);
        return Task.CompletedTask;   // no Succeed: requirement stays unmet, bob gets 403
    }
}
```

Policy selection follows the metadata: no metadata uses the fallback policy (by
default `null`, meaning open); `RequireAuthorization()` without a name uses the
default policy (an authenticated user); a named policy replaces both.
`AllowAnonymous()` opts an endpoint out. The fallback policy applies only to
requests that reach the authorization middleware, so static files served
earlier in the pipeline are not covered by it.

### Resource-based authorization

"Only the owner may read this document" depends on data the endpoint loads, so
it cannot be an attribute. Inject `IAuthorizationService` and pass the resource:

```csharp
app.MapGet("/doc/{owner}", async Task<Results<Ok<string>, ForbidHttpResult>>
    (string owner, ClaimsPrincipal user, IAuthorizationService authz) =>
{
    var result = await authz.AuthorizeAsync(user, owner, new OwnerRequirement());
    return result.Succeeded ? TypedResults.Ok(owner) : TypedResults.Forbid();
}).RequireAuthorization();

class OwnerHandler : AuthorizationHandler<OwnerRequirement, string>   // registered as IAuthorizationHandler
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OwnerRequirement req, string owner)
    {
        if (ctx.User.Identity?.Name == owner) ctx.Succeed(req);
        return Task.CompletedTask;
    }
}
```

With `TypedResults` the endpoint counts as an API: anonymous got 401, `bob`
asking for `ana`'s document got 403, his own got 200. The first version used
`Results.Ok(...)` and `Results.Forbid()`, and the same forbidden request
returned a 302 to `/Account/AccessDenied`, because the endpoint was not
recognized as an API.

### Order and wiring failures

If you call the middleware yourself, the order is `UseRouting`,
`UseAuthentication`, `UseAuthorization`. Swapping the last two compiled, started
and returned 401 for `/me` even with a valid cookie: authorization ran before
anyone read the cookie. Leaving out both `AddAuthentication` and
`AddAuthorization` also starts fine and fails per request with a 500: "Endpoint HTTP: GET /me contains
authorization metadata, but a middleware was not found that supports
authorization." Neither mistake shows up at build time, so test a protected
endpoint with and without credentials.

## Trade-offs

- **Fallback policy versus opt-in.** Secure by default protects every new
  endpoint, but health checks and login pages need an explicit
  `AllowAnonymous()`, and static files before the authorization middleware stay
  public.
- **Roles versus policies.** `RequireRole` is quick but spreads role names
  across endpoints. Named policies keep the rule in one place.
  ```csharp
  .RequireAuthorization("AdminOnly")   // change the rule once, not in every endpoint
  ```
- **Cookie versus bearer.** Cookies are automatic, `HttpOnly` and easy for
  browsers, but bring CSRF and Data Protection key sharing. Bearer tokens avoid
  CSRF but must be stored and attached by the client.
- **A valid cookie outlives a disabled account.** Per the cookie docs, the
  cookie is the single source of identity until it expires. The
  `ValidatePrincipal` event can recheck the user store, at a cost on every
  request.
- **Redirects versus status codes.** .NET 10 decides per endpoint from metadata.
  An endpoint returning plain `IResult` still redirects; mark it with
  `DisableCookieRedirect()` or use `TypedResults` if a client expects 401/403.
- **Resource checks cost a lookup.** `IAuthorizationService` with the loaded
  entity is precise, but the endpoint must load the data before it can decide,
  and you still choose between 403 and a 404 that does not reveal the resource
  exists.

## Documentation Links

- [Overview of ASP.NET Core Authentication, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [Authentication and authorization in minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/security) (doc)
- [Resource-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resource-based) (doc)
- [Use cookie authentication without ASP.NET Core Identity, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie) (doc)
- [Cookie login redirects are disabled for known API endpoints, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/10/cookie-authentication-api-endpoints) (doc)
