---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

An orchestrator (Kubernetes, Azure Container Apps, a load balancer) cannot read your logs: it calls a URL every few seconds and acts on the HTTP status code. A 503 on the wrong endpoint takes a healthy replica out of rotation or, worse, restarts every replica at once. ASP.NET Core ships the building blocks in the shared framework: `AddHealthChecks()` registers checks, `MapHealthChecks` exposes them, tags and a `Predicate` split them into liveness, readiness and startup endpoints, and `Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore` adds a `DbContext` check. This concept runs all of it on a real Kestrel app and reports what came back: status codes and bodies for each state, what an exception inside a check becomes, how long a hanging check really blocks the probe, what the EF Core check says when the database is missing, and why a dependency check in the liveness probe is a trap. Versions used: SDK 10.0.100 (ASP.NET Core runtime 10.0.0, which contains the health checks middleware), `Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore` 10.0.14, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14.

## Use Cases

- Telling Kubernetes or Container Apps when a replica has finished starting and may receive traffic.
- Taking an instance out of the load balancer while a dependency it cannot work without is down, without restarting it.
- Restarting a process that is deadlocked or out of resources, and only that.
- Feeding a dashboard or an alerting system with a periodic, detailed health report that is not exposed to the internet.

## Deep Dive

### The smallest setup and the default response

Two lines (`builder.Services.AddHealthChecks();` and `app.MapHealthChecks("/healthz");`). With no check registered, the app is healthy as long as it can answer.

I called a health endpoint with `curl -s -i`. The default writer sends the status name as plain text and adds anti-caching headers on its own:

```text
HTTP/1.1 200 OK
Content-Type: text/plain
Cache-Control: no-store, no-cache
Expires: Thu, 01 Jan 1970 00:00:00 GMT
Pragma: no-cache

Healthy
```

The docs say those headers are controlled by `AllowCachingResponses` (default `false`), so a proxy will not serve a stale "Healthy". The docs also stress that checks do not run on a timer: every request to the endpoint runs every check it includes.

### Status codes: Degraded is still 200

I read the defaults from a fresh `HealthCheckOptions` and `HealthCheckRegistration`:

```text
ResultStatusCodes: Healthy=200, Degraded=200, Unhealthy=503
AllowCachingResponses=False, Predicate null=True
Registration Timeout=-00:00:00.0010000, FailureStatus=Unhealthy
```

The overall status is the worst entry. A check returning `Degraded` gave `200 Degraded`, so an orchestrator that only looks at the code keeps sending traffic. If degraded should mean "out of rotation" for that endpoint, remap it:

```csharp
app.MapHealthChecks("/health/payments-strict", new()
{
    Predicate = r => r.Tags.Contains("toggle"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status503ServiceUnavailable,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable,
    }
});
```

```text
state degraded:  /health/payments -> 200 Degraded   /health/payments-strict -> 503 Degraded
state unhealthy: /health/payments -> 503 Unhealthy  /health/payments-strict -> 503 Unhealthy
```

### Writing an IHealthCheck

A check returns a `HealthCheckResult` with a status, an optional description, optional data and an optional exception. My check calls a downstream payments API, switchable at runtime:

```csharp
class ToggleCheck(IHttpClientFactory http) : IHealthCheck
{
    public static volatile string State = "healthy";   // set by a test endpoint

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var data = new Dictionary<string, object> { ["queueDepth"] = 12 };
        switch (State)
        {
            case "degraded": return HealthCheckResult.Degraded("p95 latency 900 ms", data: data);
            case "unhealthy": return HealthCheckResult.Unhealthy("payments API returned 500");
            case "failure": return new HealthCheckResult(context.Registration.FailureStatus, "payments API returned 500");
            case "throw": await http.CreateClient().GetAsync("http://localhost:5639/ping", ct); break; // nothing listens there
        }
        return HealthCheckResult.Healthy("payments API reachable", data);
    }
}
```

I registered the same class twice, the second time with `failureStatus: HealthStatus.Degraded`, and read the entries through a JSON writer (shown later):

```text
state unhealthy: payments-api=Unhealthy  payments-api-degraded-on-failure=Unhealthy
state failure:   payments-api=Unhealthy  payments-api-degraded-on-failure=Degraded
state throw:     payments-api=Unhealthy  payments-api-degraded-on-failure=Degraded
                 description "Connection refused (localhost:5639)", exception HttpRequestException
```

Three rules came out of this. `failureStatus` does not override an explicit `HealthCheckResult.Unhealthy(...)`: it is used only when the check returns `context.Registration.FailureStatus` or throws, which matches the docs. An exception does not crash the endpoint: it becomes an entry with the exception message as description, and the log gets a `fail` line with the full stack trace (`Health check payments-api threw an unhandled exception after 19.8827ms`). And an `Unhealthy` result is logged at error level too (`Health check startup with status Unhealthy completed after 0.3733ms`), once per probe, so a failing probe called every 5 seconds is noisy by design.

### Liveness, readiness and startup with tags

Tags at registration plus a `Predicate` per endpoint give each probe its own set of checks:

```csharp
builder.Services.AddHealthChecks()
    .AddCheck<StartupCheck>("startup", tags: ["startup", "ready"])
    .AddDbContextCheck<AppDb>(tags: ["ready", "db"])
    .AddCheck<ToggleCheck>("payments-api", tags: ["toggle"]);

app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/startup", new() { Predicate = r => r.Tags.Contains("startup") });
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") || r.Tags.Contains("toggle") });
```

`Predicate = _ => false` runs no check at all: liveness then means "the process answers HTTP". The startup check reads a flag that a `BackgroundService` sets after 8 seconds of simulated warm-up. I probed right after launch and again after the flag flipped:

```text
t~0 s  /health/startup -> 503 Unhealthy   /health/ready -> 503 (startup: "startup work still running")
t~0 s  /health/live    -> 200 Healthy
t>8 s  /health/startup -> 200 Healthy     /health/ready -> 200 Healthy
```

Each endpoint answered a different question, and the process was alive the whole time.

### The classic mistake: dependencies in the liveness probe

I added a second liveness endpoint that also includes the payments check, the way many apps do it, and broke the dependency:

```text
state=throw (payments API down)
GET /               -> 200 ok
/health/live        -> 200 Healthy
/health/live-wrong  -> 503 Unhealthy
/health/ready       -> 503 (payments-api: "Connection refused (localhost:5639)")
```

The process was fine and still serving the routes that do not need payments. Kubernetes restarts a container when liveness fails `failureThreshold` times in a row (defaults: every 10 s, 3 failures, so about 30 s). Every replica calls the same payments API, so every replica fails `/health/live-wrong` in the same 30 s window and they are all restarted together. A restart does not fix the payments API, so they come back, fail again and go into `CrashLoopBackOff`, while the cold starts add their own load. Each restart also pays the startup cost again (8 s of warm-up in this app). The readiness version of the same check only removes the pod from the Service endpoints and puts it back when the dependency recovers, with no restart. Rule: liveness checks only what a restart can fix (the process itself); dependencies go to readiness, and even there only the ones without which the instance is useless.

### Slow checks and timeouts

The registration timeout is optional. The default I read above is `InfiniteTimeSpan` (`-00:00:00.0010000`), not 30 s: the 30 s value in the docs is `HealthCheckPublisherOptions.Timeout`, which applies only to the publisher. I measured four cases (curl `--max-time` caps the client side):

```csharp
.AddCheck("hang", new HangCheck(honorToken: true))                                    // await Task.Delay(Infinite, ct)
.AddCheck("hang-2s", new HangCheck(honorToken: true), timeout: TimeSpan.FromSeconds(2))
.AddCheck("stubborn-2s", new HangCheck(honorToken: false), timeout: TimeSpan.FromSeconds(2)) // ignores ct, 6 s
```

```text
/health/hang     (no timeout)       -> no response, curl gave up at 35.004853s
/healthz         (no Predicate)     -> no response, curl gave up at 35.002022s
/health/hang2    (2 s, honors ct)   -> 503 in 2.004987s, "A timeout occurred while running check.", TaskCanceledException
/health/stubborn (2 s, ignores ct)  -> 200 in 6.004133s, Healthy "finished"
```

Without a timeout the probe hangs for as long as the check does, and a single hanging check blocks the whole `/healthz` that includes it. The timeout works only through the `CancellationToken`: a check that ignores the token runs to the end, and its late result is even reported as `Healthy`. Two more measurements: when the client disconnects, the middleware cancels the checks (two probes left in flight showed `hanging checks in flight: 2`, and the counter returned to 0 after curl gave up), and checks of one endpoint run concurrently (three checks of 1 s each answered in 1.004591s). Set a timeout shorter than the probe's own timeout (Kubernetes defaults to 1 s) and always pass `ct` down.

### AddDbContextCheck with EF Core

The `DbContext` check calls `Database.CanConnectAsync()` and is named after the context type. With SQLite, three databases:

```csharp
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(cs));
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDb>(tags: ["ready", "db"])
    .AddDbContextCheck<AppDb>("db-query", customTestQuery: async (db, ct) =>
    {
        await db.Database.ExecuteSqlRawAsync("SELECT count(*) FROM sqlite_master", ct);
        return true;
    });
```

```text
Data Source=app.db (file absent):        AppDb Healthy, and a 0-byte app.db was created on disk
Data Source=/nonexistent-dir/app.db:     AppDb Unhealthy, description null, exception null (57 ms)
                                         db-query Unhealthy, "SQLite Error 14: 'unable to open database file'.", SqliteException
```

The default check reported a missing database as healthy because opening the connection created an empty file; it proves the connection opens, not that the schema exists. When it fails it gives no reason at all, because `CanConnectAsync` returns `false` instead of throwing. A custom query surfaces the real exception. With a server database the docs recommend a cheap query such as `SELECT 1`, or just a connection, because a heavy query on every probe loads the database. The SQL Server check the docs show comes from `AspNetCore.HealthChecks.SqlServer`, a third-party package that Microsoft does not maintain.

### The JSON report, and why it must stay private

`ResponseWriter` replaces the plain-text body:

```csharp
static Task WriteJson(HttpContext ctx, HealthReport report)
{
    ctx.Response.ContentType = "application/json; charset=utf-8";
    return ctx.Response.WriteAsync(JsonSerializer.Serialize(new
    {
        status = report.Status.ToString(),
        checks = report.Entries.Select(e => new { name = e.Key, status = e.Value.Status.ToString(),
            description = e.Value.Description, exception = e.Value.Exception?.GetType().Name, data = e.Value.Data })
    }));
}
```

```text
503 {"status":"Unhealthy","totalMs":2,"checks":[{"name":"payments-api","status":"Unhealthy","description":"Connection refused (localhost:5639)","durationMs":1,"exception":"HttpRequestException","data":{}}, ...]}
```

That body names an internal host and port, the libraries in use and, with other checks, connection details and queue sizes. It is reconnaissance for an attacker and an unauthenticated endpoint that does real work on demand. Keep public probes on the plain status, and put the detailed report behind `RequireAuthorization()` or on a separate port with `RequireHost`:

```csharp
app.MapHealthChecks("/health/private", new() { ResponseWriter = WriteJson }).RequireHost("*:5632");
```

```text
GET localhost:5631/health/private                         -> 404 Not Found
GET localhost:5632/health/private                         -> 200 {"status":"Healthy",...}
GET localhost:5631/health/private, Host: localhost:5632   -> 200
```

The last line is the catch: `RequireHost` matches the `Host` header, which the client controls. The docs warn about this spoofing and recommend adding `RequireAuthorization` or not exposing that port outside the cluster.

### Every probe runs every check

I counted executions of the payments check, then sent 100 requests to its endpoint:

```text
before: payments-api ran 3 times
after 100 probes: payments-api ran 103 times
```

There is no cache. Ten pods, three probe types, a probe every 5 seconds and a few monitoring tools add up to a steady stream of calls to every dependency the checks touch. Keep each check cheap (a ping, not a query), keep liveness free of I/O, and make health endpoints unreachable from the internet so nobody can turn them into a load generator. When you need periodic results instead, a publisher runs the checks in the background. I set `Delay = 2 s`, `Period = 5 s` (defaults read back: `Delay=00:00:05, Period=00:00:30, Timeout=00:00:30`):

```text
publish at t=2.3s status=Healthy entries=1
publish at t=7.2s status=Healthy entries=1
publish at t=12.2s status=Healthy entries=1
```

### Mapping to the orchestrator

In Kubernetes, `startupProbe` points to `/health/startup`, `livenessProbe` to `/health/live` and `readinessProbe` to `/health/ready`; while the startup probe has not succeeded, the other two do not run. Azure Container Apps has the same three probe types. Its docs say that when ingress is enabled and you define no probes, the portal adds TCP probes on the target port (startup every 1 s with a failure threshold of 240, readiness every 5 s with 48), which only prove that the port is open. Define HTTP probes against your endpoints to get the behavior shown above.

## Trade-offs

- **Liveness should be almost empty.** Every dependency you add to it turns an outage of that dependency into a restart of every replica.
  ```csharp
  app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
  ```
- **Readiness is a judgment call per dependency.** If the app can still serve useful requests without a dependency (cache, optional API), leave that dependency out of readiness too, or report it as `Degraded`, which stays 200 by default.
- **Timeouts only work if the check cooperates.** The default is infinite, and a check that ignores the token outlives its timeout and reports `Healthy` late.
  ```csharp
  .AddCheck<PaymentsCheck>("payments", tags: ["ready"], timeout: TimeSpan.FromMilliseconds(800))
  ```
- **The EF Core check is shallow.** It proves a connection opens, not that the schema or data are right, and it reports no reason on failure; a custom query adds detail and adds load.
- **Details help operators and attackers alike.** Plain status for probes, JSON only behind authorization or on an internal port, and remember that `RequireHost` alone can be spoofed.
- **Health checks are not monitoring.** They answer "route traffic here or not" every few seconds; trends, latency and error rates belong to metrics and traces.

## Documentation Links

- [Health checks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks?view=aspnetcore-10.0) (doc)
- [Health probes in Azure Container Apps, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/health-probes) (doc)
- [.NET on Azure Container Apps overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/container-apps/dotnet-overview) (doc)
- [Health monitoring, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/implement-resilient-applications/monitor-app-health) (doc)
