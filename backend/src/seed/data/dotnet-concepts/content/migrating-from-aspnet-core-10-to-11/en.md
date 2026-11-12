---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Moving an ASP.NET Core 10 app to 11 compiles for most teams after a change of
target framework. The cost is not in the compiler: it is in behavior that
changed without a build error, and a few restore failures that look like
package problems. This concept is the checklist for that upgrade. It keeps to
what I reproduced on the SDK 11.0.100 GA against the .NET 10 SDK on the same
code, and labels everything else as coming from the official migration guide.

For the list of what is new rather than what breaks, see
`whats-new-in-aspnet-core-11`. For the .NET 10 map, see
`whats-new-in-aspnet-core-10`.

## Use Cases

- Planning the upgrade from the .NET 10 LTS to .NET 11 and sizing the test
  pass.
- Reading a red build or a changed test after retargeting and asking whether
  the cause is your code or the framework.
- Reviewing a pull request that bumps `TargetFramework` to `net11.0`.
- Deciding whether to move at all (see `dotnet-support-lifecycle-and-choosing-a-target`).

## Deep Dive

### Retarget, then read the restore

Change `<TargetFramework>` to `net11.0`, update the framework packages
(`Microsoft.AspNetCore.OpenApi` 11.0.0 and so on) and restore. Pin the SDK with
`global.json` so a teammate on another SDK does not change the result. Two
package facts I checked on nuget.org on 2026-11-12: `Microsoft.Extensions.Http.Resilience`
now has a stable 11.0.0, and `Asp.Versioning.Http` has no 11.x yet (latest
10.2.3). A package with no 11.x is not necessarily broken on net11.0, but I did
not run `Asp.Versioning` there, so read its release notes before you assume.

### OpenAPI: a restore error and a new default

If the project pins `Microsoft.OpenApi` 2.x next to `Microsoft.AspNetCore.OpenApi`
11.0.0, restore fails, because the new package asks for `[3.11.0, 4.0.0)`:

```text
error NU1605: Warning As Error: Detected package downgrade: Microsoft.OpenApi from 3.11.0 to 2.7.5.
 oa -> Microsoft.AspNetCore.OpenApi 11.0.0 -> Microsoft.OpenApi (>= 3.11.0 && < 4.0.0)
 oa -> Microsoft.OpenApi (>= 2.7.5)
```

Remove the pin or raise it to 3.11.0 or higher. The fix is a version bump, but
the new major also moves types: code that built a document with 2.x types
(transformers, custom schema code) needs a compile pass. With the pin fixed,
the generated version changed too:

```text
AddOpenApi()                              -> "openapi": "3.2.0"
AddOpenApi("v31", o => o.OpenApiVersion = OpenApiSpecVersion.OpenApi3_1) -> "3.1.2"
```

A snapshot test that expects a 3.1 document or a client generator that
cannot read 3.2 breaks here. Pin `OpenApi3_1` until your tools catch up. The
details of the 3.2 differences are in `openapi-document-generation`.

### A BackgroundService that fails now fails RunAsync

Same code, a hosted service that throws from `ExecuteAsync`, on both SDKs:

```csharp
class Boom : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct)
        => throw new InvalidOperationException("boom in ExecuteAsync");
}
// host.RunAsync() with AddHostedService<Boom>()
```

```text
.NET 10: RunAsync completed normally
.NET 11: RunAsync threw InvalidOperationException: boom in ExecuteAsync
```

On .NET 10 `RunAsync` returned as if nothing went wrong, so `Program.cs` simply
continued. On 11 the exception reaches the caller, and an unhandled exception
in `Program.cs` ends the process the way any unhandled exception does (I did
not measure the exit code). For an orchestrator that is the right signal, but
a job that used to fail silently can now restart your container.

The knobs are in `hosted-services-and-backgroundservice`. One I ran: setting
`BackgroundServiceExceptionBehavior.Ignore` on `HostOptions` makes the same host
complete normally on both versions (I cancelled it after 500 ms), and the proper fix is to catch inside
`ExecuteAsync` what the service can recover from.

### Scope disposal reports every failure

When a scope is disposed, `Dispose` of each scoped service runs. Two scoped
services whose `Dispose` throws, resolved in one scope:

```text
.NET 10: InvalidOperationException: D2 dispose failed        d1.disposed=False
.NET 11: AggregateException (D2 dispose failed) (D1 dispose failed)  inner=2  d1.disposed=True
```

On 10 the first exception escaped and the other service was never disposed. On
11 every service is disposed and all failures come back in an
`AggregateException`. A `catch (InvalidOperationException)` around a scope
dispose, or a test asserting the type of the exception, no longer matches, and
logging that printed only `e.Message` now prints "One or more errors occurred."
first. The upside is that the leak is gone. See
`dependency-injection-and-service-lifetimes`.

### An empty string in chained configuration now wins

A configuration source added with `AddConfiguration(otherConfiguration)` whose
key holds an empty string:

```csharp
var inner = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Timeout"] = "" }).Build();
var cfg = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Timeout"] = "30" })
    .AddConfiguration(inner).Build();
```

```text
                                     .NET 10   .NET 11
cfg["Timeout"]                         '30'      ''
cfg.GetValue<int?>("Timeout")           30       null
```

On 10 the chained empty value was ignored and the earlier `30` survived. On 11
the empty string overrides it, which is how two plain providers
(`AddInMemoryCollection` twice) already behaved on both versions: the second
empty value wins. The risk is an app that layers a base configuration under an
environment-specific one and used to get a default back by leaving a value
blank. Now it gets an empty string, and `GetValue<int?>` returns `null`. Check `appsettings` files and environment variables that set
`Key=` with nothing after it. The options side is in
`configuration-and-the-options-pattern`.

### Forms: the CSRF check and the template

A Minimal API form endpoint, `[FromForm]`, no `UseAntiforgery()`, posted without
any browser headers:

```text
.NET 10: 500  InvalidOperationException: Endpoint HTTP: POST /transfer contains
              anti-forgery metadata, but a middleware was not found that supports anti-forgery.
.NET 11: 200
```

The 500 is gone because .NET 11 registers an automatic CSRF middleware in
`WebApplication.CreateBuilder`, and it satisfies that requirement. What you can
now see is a different change: a cross-site browser form post to that endpoint
answers 400 (a request with no `Sec-Fetch-Site` and no `Origin` is allowed
through). Webhooks and partner forms that posted across sites need an explicit
exception, and the `dotnet new blazor` template no longer writes
`app.UseAntiforgery()`. Both are explained, with a lab, in
`csrf-protection-antiforgery-tokens-and-fetch-metadata`. If you keep
`UseAntiforgery()`, token behavior is unchanged.

### Removals and stricter protocol handling (from the docs)

I did not run these on the GA. The migration guide and the .NET 11 breaking
changes list them, so treat each as "search your code for it":

- Removed APIs: the `ConcurrencyLimiter` middleware (the rate limiter has a
  concurrency limiter), `SetCompatibilityVersion` and `CompatibilityVersion`,
  `Router.PreferExactMatches`, and `AddDataAnnotationsValidation`.
- Kestrel is stricter on protocol compliance (for example headers forbidden in
  HTTP/2 and HTTP/3, and a request that sends both `Content-Length` and
  `Transfer-Encoding` on HTTP/1.1). A proxy or client that relied on leniency
  can start failing.
- Blazor enhanced navigation no longer preloads resources.

### A routine that works

1. Branch, retarget, pin the SDK, restore. Fix `NU1605` and package bounds.
2. Build, then search the code for the removed APIs above.
3. Run the whole test suite, not only the unit tests: the changes in this
   concept live in integration behavior (hosting, DI disposal, configuration,
   forms).
4. Start the app in a staging copy and read the first minute of logs and the
   exit code of a forced failure.
5. Regenerate OpenAPI documents and diff them against the committed ones.

## Trade-offs

- **Silent changes beat compiler errors.** Every item with a table above
  compiled and ran. Only a test or a log line shows the difference, so an
  upgrade without integration tests is a guess.
- **Some fixes are your code, some are a switch.** The `Ignore` behavior for
  hosted services and the `OpenApi3_1` pin restore the old result but keep
  the old behavior you may want gone. Prefer fixing the cause (catch in the
  service, update the consumer of the document) and use the switch to buy time.
- **The LTS stays on 10.** .NET 10 is the LTS, and 11 is the newer release. The
  upgrade earns its cost when you need something from the release notes, not
  because it is newer. See `dotnet-support-lifecycle-and-choosing-a-target`.
- **Third parties lag.** Document generators, API versioning and client
  generators release after the framework. Check each one against the new
  OpenAPI version and framework before the cutover.
- **My results are one app each.** The tables come from small programs, one
  per change. Your code may hit a variant (a different provider order, a
  different disposal path), so use them as the thing to look for, not as a
  proof you are safe.

## Documentation Links

- [Migrate from ASP.NET Core 10 to 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/100-to-110) (doc)
- [Breaking changes in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/overview) (doc)
- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [OpenAPI document version defaults to 3.2, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/openapi-version-default-3-2) (doc)
- [Microsoft.OpenApi 3.x dependency, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/microsoft-openapi-3x) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
