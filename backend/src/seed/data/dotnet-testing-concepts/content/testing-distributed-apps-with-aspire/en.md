---
version: 1.0
updatedAt: 2026-10-29
---
## Objective

An Aspire solution is several processes, and its bugs live between them: a
wrong reference, a missing variable, a dependency that never gets healthy.
`DistributedApplicationTestingBuilder` (`Aspire.Hosting.Testing`) runs the
real AppHost from a test, each resource a process on random ports. The goal:
a closed-box MSTest test of `web` calling `api` by name, a timeout policy that
fails in about a second, overrides that arrive, a log assertion, and a measured
choice between one app per class or per test. Versions: SDK 10.0.100, Aspire
13.6.4, `MSTest.Sdk` 4.5.2 on Microsoft.Testing.Platform, and
`Microsoft.AspNetCore.Mvc.Testing` 10.0.14 for the comparison. No Docker
daemon was running, so only project resources ran.

## Use Cases

- Proving that the frontend reaches the API through service discovery.
- Failing CI in about a second, with the stderr, when a service crashes.
- Running the whole system with a different setting or a broken dependency.
- Pairing a few end-to-end smoke tests with fast `WebApplicationFactory` tests.

## Deep Dive

### The app and the first test

The AppHost declares two projects, each with an HTTP health check:

```csharp
var api = builder.AddProject<Projects.Shop_Api>("api")
    .WithEnvironment("Greeting", builder.Configuration["Greeting"] ?? "hello")
    .WithHttpHealthCheck("/health");

builder.AddProject<Projects.Shop_Web>("web")
    .WithReference(api).WaitFor(api).WithHttpHealthCheck("/health");
```

`web`'s `/call` calls `http://api/hello`. The test project is `MSTest.Sdk/4.5.2`
with `Aspire.Hosting.Testing` 13.6.4 and a `ProjectReference` to the AppHost,
run by `dotnet test` in MTP mode (`global.json`). The docs' `aspire-mstest`
template still shows MSTest 3.10.2 with `EnableMSTestRunner`.

```csharp
using var cts = CancellationTokenSource.CreateLinkedTokenSource(TestContext.CancellationToken);
cts.CancelAfter(TimeSpan.FromSeconds(30));
var token = cts.Token;
var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.Shop_AppHost>([], token);
builder.Services.ConfigureHttpClientDefaults(http => http.AddStandardResilienceHandler());
await using var app = await builder.BuildAsync(token);
await app.StartAsync(token);
await app.ResourceNotifications.WaitForResourceHealthyAsync("api", token);
await app.ResourceNotifications.WaitForResourceAsync("web", KnownResourceStates.Running, token);

using var web = app.CreateHttpClient("web");
StringAssert.Contains(await web.GetStringAsync("/call", token), "\"from\":\"api\"");
```

```text
started after 1838 ms
api healthy, web running after 1846 ms
api endpoint http://localhost:61998/   web endpoint http://localhost:61999/
{"from":"api","greeting":"hello","pid":27127,"env":"Development"}
done after 2479 ms
passed WebReachesApiThroughServiceDiscovery (15s 773ms)
```

DCP started each service with `dotnet run --project ... --no-build
--no-launch-profile`, and their console output landed in the test output.
`web` logged `GET http://api/hello` sent as `GET http://localhost:61998/hello`;
the test's client logged a `-standard//Standard-Retry` attempt `0`. The test
also passed with the AppHost's `launchSettings.json` deleted (no
`ASPIRE_ALLOW_UNSECURED_TRANSPORT` needed).

Running is not ready. `StartAsync` returned only after `api` was healthy,
because `web` has `WaitFor(api)` (`Finished waiting for resource 'api'` came
before `Distributed application started`). `WaitForResourceAsync("web", Running)`
returned 8 ms later, about half a second before `web` logged
`Now listening on`; the first request took 627 ms. As the docs say, `Running`
means the process started; health means ready. A resource without health
checks counts as healthy once `Running` (XML docs).

### Random ports, and two runs at once

The endpoints a test sees are DCP proxies; the processes behind them got
other random ports (`web` had `ASPNETCORE_URLS` `http://localhost:30801`).
Two `dotnet test` runs started together both passed in about 15.9 s, run A on
53244/53245, run B on 53238/53239. With the docs' argument
`"DcpPublisher:RandomizePorts=false"` both got the `launchSettings.json` ports
(5174, 5062); the second logged
`Request to http://localhost:5062/health timed out` and was healthy at about
11.9 s instead of 2.3 s.

### Overriding configuration: what arrives

Each variant removed `web` and read `/hello` from `api`:

| Override in the test | `api` saw |
| --- | --- |
| `CreateAsync<...>(["Greeting=from-args"])` | `"greeting":"from-args"` |
| `CreateAsync<...>(["--Greeting=from-dashdash"])` | `"greeting":"from-dashdash"` |
| `builder.Configuration["Greeting"] = "..."` after `CreateAsync` | `"greeting":"hello"` (ignored) |
| `builder.CreateResourceBuilder<ProjectResource>("api").WithEnvironment("Greeting", "from-withenv")` | `"greeting":"from-withenv"` |
| `["--environment=Testing"]` | AppHost `Testing`, `api` still `"env":"Development"` |

Arguments are AppHost configuration, and `AppHost.cs` has already run when
`CreateAsync` returns. To reach one service, `WithEnvironment` on its
resource builder won. The AppHost environment is not the services'.

### Removing a resource, and the dashboard

`builder.Resources.Remove(builder.Resources.Single(r => r.Name == "web"))`
started `api` alone (the model also listed hidden `api-rebuilder` and
`web-rebuilder`). Removing `api` left `web` logging `Waiting for resource
'api' to enter the 'Running' state.` until `StartAsync` threw
`TaskCanceledException` at its 30 s token. The docs warn there is no DI
replacement: the levers are the model, arguments and variables.

The dashboard is off by default: `app.GetDashboardUrlAsync()` threw
`InvalidOperationException: The dashboard is not enabled for this
application.` Passing `(options, _) => options.DisableDashboard = false` to
`CreateAsync` returned `http://localhost:65130/login?t=8568...` and started an
`Aspire.Dashboard` process. Reflection also shows
`DistributedApplicationTestingBuilderOptions.EnableDashboard` (not run). The
dashboard UI was not opened.

### Reading state and logs from the test

```csharp
app.ResourceNotifications.TryGetCurrentState("api", out var evt);
// api state=Running health=Healthy reports=api_http_/health_200_check:Healthy

var logs = app.Services.GetRequiredService<ResourceLoggerService>();
LogLine? served = null;
await foreach (var batch in logs.WatchAsync(evt!.ResourceId).WithCancellation(token))
{
    served = batch.Where(l => l.Content.Contains("Served hello from pid"))
                  .Select(l => (LogLine?)l).FirstOrDefault();
    if (served is not null) break;
}
Assert.IsNotNull(served);
// line 11: 2026-10-29T20:46:37.7900000Z       Served hello from pid 59953
```

Two traps. `WatchAsync("api")` gave nothing in 5 s; logs are keyed by the
replica id (`api-ayrbxpwr`), which delivered the line in about 80 ms. And
`LogLine` is a struct: a plain `FirstOrDefault()` is never `null`.

### Timeouts and failing fast

With `WithEnvironment("Api__Broken", "true")` the API's health check reports
Unhealthy. `StartAsync` ran in the background (it blocks on `WaitFor`) and
the test waited with a 30 s token:

```text
[30161 ms] System.OperationCanceledException: Resource 'api' failed to become healthy before the operation was cancelled.
[30161 ms] api state=Running health=Unhealthy api_http_/health_200_check:Unhealthy
[30161 ms] web state=Waiting
[30161 ms] StartAsync: System.Threading.Tasks.TaskCanceledException: A task was canceled.
```

The docs recommend a timeout on every wait so a test cannot hang; a stuck
dependency costs the whole token. With `Api__CrashOnStart=true` the API throws
at startup. Awaiting `StartAsync` first, as the template does, cost the full
30 s (`web` stays `Waiting`), even with `DefaultWaitBehavior` set to
`StopOnResourceUnavailable` in `ResourceNotificationServiceOptions`. Racing
the start against a wait that stops on failure took about a second:

```csharp
var start = app.StartAsync(token);   // awaited later, on the happy path
await app.ResourceNotifications.WaitForResourceHealthyAsync(
    "api", WaitBehavior.StopOnResourceUnavailable, token);
```

```text
[1134 ms] Aspire.Hosting.DistributedApplicationException: Stopped waiting for resource 'api' to become healthy because it failed to start.
[1134 ms] api state=Finished exit=134
[1138 ms] log 0 err=True: ... Unhandled exception. System.InvalidOperationException: Api:CrashOnStart is set, refusing to start.
[2371 ms] disposed; start task status: Canceled
```

`ResourceLoggerService.GetAllAsync(id)` returned that stderr line, so the
failure message can carry the cause. The XML docs explain the default
(`WaitOnResourceUnavailable`): the wait goes on in case the resource restarts.

### One app per class, or one per test

Five tests calling `/call`, three runs each, took 16.3, 16.7 and 15.9 s with
one app from `[ClassInitialize]`, and 74.6, 77.4 and 74.4 s with a new app in
every test. Startup was not the cost (about 1.5 s to `StartAsync`, 2.2 s to
healthy); `StopAsync` took about 13 s in every run. With debug logs on, DCP
reported `Could not stop the Executable` with
`"timed out waiting for process to stop"` for `api` before finishing. Sharing is the docs' `[ClassInitialize]`/
`[ClassCleanup]` pattern.

### Cleanup, exit codes and containers

After each run a `dcp run-controllers` process lingered for about 1 s, then
`pgrep -fl 'dcp|Shop\.|Aspire.Dashboard'` printed nothing and `lsof` showed no
listener. Passing runs exited 0; one failed test gave `Exit code: 2`.
Containers were not run. For `AddRedis("cache")` the docs say
`app.GetConnectionStringAsync("cache")` lets a test check data directly, and
disposing the app cleans the containers up.

### Aspire tests vs WebApplicationFactory

| | `DistributedApplicationTestingBuilder` | `WebApplicationFactory<Program>` |
| --- | --- | --- |
| Scope | the whole AppHost model | one ASP.NET Core app |
| Processes | AppHost in the test, DCP plus one per resource | the test process only |
| Network | real sockets, DCP proxies, random ports | in-memory `TestServer` |
| Change behavior | args, variables, model edits; no DI access | `ConfigureTestServices`, fakes |
| Containers | yes, with a container runtime (not run) | no (use Testcontainers) |
| 5 tests, shared host | about 16 s | about 0.8 to 1 s |
| 5 tests, host per test | about 75 s | about 1 to 1.2 s |

## Trade-offs

- **Realism costs seconds per app.** About 15 s each here, mostly shutdown.
  Test wiring with Aspire, rules with `WebApplicationFactory`.
- **Every wait needs a token, and order matters.** `StartAsync` blocks on
  `WaitFor`, so a crashed dependency costs the full timeout unless the test
  races it with `StopOnResourceUnavailable`.
- **Shared apps share state.** One app per class was about 4.6 times faster,
  and every test sees what the previous ones wrote.
- **Containers need a runtime in CI.** `AddRedis` or `AddPostgres` need
  Docker or Podman; a project-only model ran without one.

## Documentation Links

- [Testing overview, aspire.dev](https://aspire.dev/testing/overview/) (doc)
- [Write your first test, aspire.dev](https://aspire.dev/testing/write-your-first-test/) (doc)
- [Manage the AppHost in tests, aspire.dev](https://aspire.dev/testing/manage-app-host/) (doc)
- [Access resources in tests, aspire.dev](https://aspire.dev/testing/accessing-resources/) (doc)
- [Testing in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
