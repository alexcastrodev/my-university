---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

An Azure Functions app in C# is a .NET console app that a separate host process starts and talks to over gRPC. That split is the isolated worker model, and since 2026-11-10 it is the only model with full support: the in-process model reached end of support that day. I built one app with an HTTP trigger, a Timer trigger and a Queue trigger plus output binding, ran it under Azure Functions Core Tools 4.16.1 against Azurite in a container, and measured what the host prints, what the build produces, how settings reach the worker and how a function is tested without the host. Everything that needs a real Function App (plans, cold start, Flex Consumption, deployment) is read from the Microsoft Learn pages dated 2026-11 and marked "docs only". Versions: `Azure.Functions.Sdk` 1.1.0, `Microsoft.Azure.Functions.Worker` 2.52.0, `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore` 2.1.1, `...Extensions.Timer` 4.3.1, `...Extensions.Storage.Queues` 5.5.5, Core Tools 4.16.1 (host runtime 4.1054.250.26428), Azurite 3.38.0, MSTest 4.5.3, TFM `net10.0`, .NET SDK 10.0.100, Apple M4 Max (arm64).

## Use Cases

- Starting a new serverless .NET job (queue consumer, scheduled task, small HTTP API) on a supported model and a supported .NET version.
- Migrating an in-process app (`FunctionsStartup`, `Microsoft.NET.Sdk.Functions`) that is now out of support.
- Running and debugging a Functions app on a laptop with only Azurite and Core Tools, no Azure account.
- Keeping the business logic in plain classes so a unit test needs neither the host nor Azure.

## Deep Dive

### Two processes, one gRPC channel

The Functions host (Core Tools ships it, Azure runs it for you) owns triggers, scaling and bindings. Your project is an ordinary executable that the host launches and calls back. While the app ran, `ps` showed this (paths shortened):

```text
60773  func start --port 7010                       (Core Tools, hosts the Functions runtime)
60869  dotnet App.dll --host 127.0.0.1 --port 61822 --workerId fe33... --grpcMaxMessageLength 2147483647
```

The host log line `Worker process started and initialized.` followed by `3 functions found (Worker)` shows the third piece: the worker reports its own function list over gRPC (worker indexing). Because of that there is no `functions.metadata` file in the output: I searched the whole project folder after a build and a run and found none, which corrects the older material that mentions it. What `dotnet build` leaves in `bin/Debug/net10.0` is `worker.config.json`, `extensions.json` and a `.azurefunctions` folder:

```json
{ "description": { "language": "dotnet-isolated", "extensions": [".dll"], "defaultExecutablePath": "dotnet",
  "defaultWorkerPath": "App.dll", "workerIndexing": "true", "canUsePlaceholder": true } }
```

`extensions.json` lists the host-side half of each binding: for my queue trigger, `AzureStorageQueues` 5.3.8.0 plus a `FunctionMetadataLoader`. Adding Blob and Service Bus packages to a scratch project added `AzureStorageBlobs` 5.3.8.0 and `ServiceBus` 5.17.0.0. The `Microsoft.Azure.Functions.Worker.Extensions.*` package you reference is the worker-side API; the build restores the matching WebJobs extension for the host into `.azurefunctions`. This is why the docs list the benefits as fewer assembly conflicts, full control of start-up, standard dependency injection and .NET version flexibility: the worker is just your app with its own dependency graph.

### The project file and the packages

The docs now use `Azure.Functions.Sdk` as the project SDK (it replaces `Microsoft.NET.Sdk` plus the `Microsoft.Azure.Functions.Worker.Sdk` package, sets `AzureFunctionsVersion` to `v4` and `OutputType`, and makes `dotnet run` start the host when Core Tools is installed). The worker package stays an explicit reference:

```xml
<Project Sdk="Azure.Functions.Sdk/1.1.0">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="2.52.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore" Version="2.1.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Timer" Version="4.3.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Storage.Queues" Version="5.5.5" />
  </ItemGroup>
</Project>
```

The template that `func init --worker-runtime dotnet-isolated --target-framework net10.0` generated with Core Tools 4.16.1 still used `Microsoft.NET.Sdk` plus `Microsoft.Azure.Functions.Worker.Sdk` 2.0.7 and `Worker` 2.52.0, so you will meet both styles; the docs' migration section says the change needs no code edits. Latest stable versions on NuGet on 2026-11-20:

| Need | Package | Version |
| --- | --- | --- |
| Worker runtime | `Microsoft.Azure.Functions.Worker` | 2.52.0 |
| Build SDK | `Azure.Functions.Sdk` | 1.1.0 (docs: 1.0.0 or later for .NET 10, 1.0.1 or later for .NET 11) |
| HTTP, ASP.NET Core types | `...Extensions.Http.AspNetCore` | 2.1.1 |
| HTTP, built-in types | `...Extensions.Http` | 3.3.0 |
| Timer | `...Extensions.Timer` | 4.3.1 |
| Queue | `...Extensions.Storage.Queues` | 5.5.5 |
| Blob | `...Extensions.Storage.Blobs` | 6.8.2 |
| Service Bus | `...Extensions.ServiceBus` | 5.24.0 |
| Event Hubs, Cosmos DB | `...Extensions.EventHubs`, `...Extensions.CosmosDB` | 6.5.0, 4.16.1 |
| Durable Functions | `...Extensions.DurableTask` | 1.22.0 |

### The entry point: CreateBuilder against HostBuilder

Worker 2.x added `IHostApplicationBuilder`, so the current `Program.cs` is the same shape as a Minimal API app (see [Hosted Services and BackgroundService](/dotnet-concepts/hosted-services-and-backgroundservice) and [Dependency Injection and Service Lifetimes](/dotnet-concepts/dependency-injection-and-service-lifetimes)). The older entry point is a `HostBuilder` with `ConfigureFunctionsWorkerDefaults`:

```csharp
// current: Microsoft.Azure.Functions.Worker.Builder
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();            // ASP.NET Core integration for HTTP
builder.UseMiddleware<TimingMiddleware>();
builder.Services.Configure<PricingOptions>(builder.Configuration.GetSection("Pricing"));
builder.Services.AddSingleton<OrderPricer>();
builder.Build().Run();

// older (and still supported): ConfigureFunctionsWorkerDefaults, built-in HTTP types
new HostBuilder().ConfigureFunctionsWorkerDefaults().Build().Run();
```

Both start and answer requests (I ran the second in a project with `Extensions.Http` 3.3.0). Per the docs `ConfigureFunctionsWebApplication()` replaces `ConfigureFunctionsWorkerDefaults()` and needs `Extensions.Http.AspNetCore` 2.0.0 or later with `IHostApplicationBuilder`; apps without HTTP triggers can use either, but the docs advise keeping the ASP.NET Core `FrameworkReference` for performance.

### Functions, triggers and bindings

A function is a public method of a public class with `[Function]` (unique name, up to 127 characters) and exactly one trigger parameter. Classes are instance classes so constructor injection works:

```csharp
public sealed class Functions(OrderPricer pricer, ILogger<Functions> log)
{
    [Function("Quote")]
    public IActionResult Quote([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "quote/{sku}")] HttpRequest req, string sku)
        => int.TryParse(req.Query["qty"], out var qty) ? new OkObjectResult(pricer.Price(sku, qty))
                                                       : new BadRequestObjectResult(new { error = "qty must be an integer" });

    [Function("Heartbeat")]
    public void Heartbeat([TimerTrigger("*/5 * * * * *")] TimerInfo timer) => log.LogInformation("heartbeat, past due: {PastDue}", timer.IsPastDue);

    [Function("OrderQueued")]
    [QueueOutput("quotes", Connection = "AzureWebJobsStorage")]
    public string OrderQueued([QueueTrigger("orders", Connection = "AzureWebJobsStorage")] string message) { /* price, return JSON */ }
}
```

The host startup output, with the function list the worker reported and the route table:

```text
3 functions found (Worker)
Mapped function route 'api/quote/{sku}' [get] to 'Quote'
Functions:
        Quote: [GET] http://localhost:7010/api/quote/{sku}
        Heartbeat: timerTrigger
        OrderQueued: queueTrigger
Executing 'Functions.Heartbeat' (Reason='Timer fired at 2026-11-20T15:19:00.0059130+00:00', ...)
heartbeat, past due: False
Executed 'Functions.Heartbeat' (Succeeded, ..., Duration=60ms)
```

`curl http://localhost:7010/api/quote/ABC?qty=12` returned `200` with `{"sku":"ABC","quantity":12,"total":127.500,"bulkApplied":true}`, and `?qty=x` returned `400` with `{"error":"qty must be an integer"}`. The `api/` prefix comes from `host.json` (`extensions.http.routePrefix`, default `api` per the docs). Sending `ABC:3` and `ZZZ:20` to the `orders` queue (Base64 encoded, which is what the Queue trigger expects by default) made the host log `Executing 'Functions.OrderQueued' (Reason='New queue message detected on 'orders'.')`, and the output binding wrote both JSON quotes to `quotes`. Trigger rules that matter: one trigger per function, input bindings read, output bindings write the return value (several outputs need a return type with one attribute per property), and a binding's `Connection` names an app setting, not a secret.

Failure behavior is the host's, not yours. A message `oops` made the function throw `IndexOutOfRangeException`; the host logged `Executed 'Functions.OrderQueued' (Failed, ...)`, logged three failed executions (`maxDequeueCount` 3, set in `host.json`), and the message then sat in `orders-poison`. One gotcha from the first run: with `AzureWebJobsStorage` set to `UseDevelopmentStorage=true;BlobEndpoint=...` (a shortcut plus custom ports) the host printed `Error indexing method 'Functions.OrderQueued' ... Azure.Storage.Queues: No valid combination of account information found.`, disabled only that function, and kept serving the other two. The full Azurite connection string (account name, key, three endpoints) fixed it. Also, `func start` directly against an isolated project printed `Running 'func start' directly against a .NET Isolated project may not correctly load function extensions. Use 'dotnet run' instead`; `dotnet run` (host ready in about 4 s with a warm build on this machine) is the supported way.

### Configuration, options, logging and middleware

Registration is standard .NET (see [Configuration and the Options Pattern](/dotnet-concepts/configuration-and-the-options-pattern)): `builder.Services`, `builder.Configuration`, `IOptions<T>`, `ILogger<T>`. A `Values` entry `"Pricing__UnitPrice": "12.5"` in `local.settings.json` reached the worker as configuration: quantity 3 priced at 37.5 (12.5 x 3), not 30. The docs say names in `Values` can't include a double underscore (reserved by the runtime); on Core Tools 4.16.1 it worked, but I would not build on it: prefer app settings that the platform documents (`Pricing__UnitPrice` is the normal .NET form for Azure app settings on Linux) and verify. Worker configuration does not configure triggers: the docs say trigger and binding configuration must come from application settings, Key Vault references or App Configuration references, because the platform reads it, not your `Program.cs`.

Middleware (the same idea as in [The Middleware Pipeline and Program.cs](/dotnet-concepts/middleware-pipeline-and-program-cs)) is `IFunctionsWorkerMiddleware` with `builder.UseMiddleware<T>()` and conditional `UseWhen`. Mine timed each invocation and logged inside the worker, in the same process as the function (`pid 60869`):

```text
middleware: Heartbeat took 12 ms (pid 60869)
middleware: OrderQueued took 6 ms (pid 63228)
```

The docs warn that setting response headers after `await next(context)` is unreliable with ASP.NET Core integration; set them from the invocation result before returning. Log levels are split in two: `host.json` filters what the host emits, while `Program.cs` filters what your code logs. Application Insights is now wired through OpenTelemetry (docs only): `"telemetryMode": "OpenTelemetry"` in `host.json`, packages `Microsoft.Azure.Functions.Worker.OpenTelemetry` 1.2.0 and `Azure.Monitor.OpenTelemetry.Exporter`, and `AddOpenTelemetry().UseFunctionsWorkerDefaults().UseAzureMonitorExporter()`, which the generated template guards with `APPLICATIONINSIGHTS_CONNECTION_STRING`. Without that line the host reported `"TelemetryMode": "ApplicationInsights"`. The basics are in [Observability Backends: Prometheus, Grafana, Tempo and Application Insights](/dotnet-concepts/observability-backends-prometheus-grafana-tempo-and-application-insights).

### HttpResponseData against IActionResult

Two HTTP models exist. With ASP.NET Core integration the function takes `HttpRequest` and returns `IActionResult` (or `Task<IActionResult>`); the docs say it does not expose the ASP.NET Core middleware pipeline or routing, only the types. The built-in model takes `HttpRequestData` and returns `HttpResponseData`, which the worker translates (a request without `Content-Length` and with chunked encoding arrives with a null `Body`):

```csharp
[Function("Hello")]
public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get")] HttpRequestData req)
{
    var res = req.CreateResponse(HttpStatusCode.OK);
    await res.WriteAsJsonAsync(new { hello = "world" });   // 2.x: no longer forces 200 over a status you set
    return res;
}
```

It answered `200` with `{"hello":"world"}`. Pick `IActionResult` for new .NET 8+ code (familiar types, and the built-in model cannot stream a request body) and keep `HttpResponseData` for .NET Framework, which cannot use the ASP.NET Core types, or for code you do not want to touch. With ASP.NET Core integration, synchronous reads and writes of the request or response stream throw `Synchronous operations are disallowed`; use the `Async` methods.

### host.json and local.settings.json

`host.json` is deployed with the code and configures the host for all functions: logging rules, `functionTimeout`, extension options (`queues`, `serviceBus`, `http`). The host echoed my file on startup (`Host configuration file read:`), and the `QueuesOptions` dump showed `MaxPollingInterval` 00:00:02, `BatchSize` 4 and `MaxDequeueCount` 3. `local.settings.json` is local only: `Values` are the app settings (`FUNCTIONS_WORKER_RUNTIME`: `dotnet-isolated`, `AzureWebJobsStorage`, binding connections), `Host` tunes the local host (`LocalHttpPort`, `CORS`), `ConnectionStrings` is only for frameworks that read that section. The csproj copies it with `CopyToPublishDirectory` set to `Never`, and `func init` generated a `.gitignore` that lists it, because it holds secrets: commit a `local.settings.sample.json` with fake values instead. A setting present locally and missing in the Function App is the classic "works on my machine". Everything here used the public Azurite development key and fake prices.

### Testing a function without the host

Keep the logic in a class that knows nothing about triggers (`OrderPricer`, built from `IOptions<PricingOptions>`) and keep the `[Function]` method as an adapter. Both are plain objects: `Functions.Quote` takes an ASP.NET Core `HttpRequest`, which `DefaultHttpContext` supplies.

```csharp
[TestMethod]
public void Quote_returns_400_when_qty_is_zero() =>
    Assert.IsInstanceOfType<BadRequestObjectResult>(Sut().Quote(Req("?qty=0"), "ABC"));
```

Six MSTest 4.5.3 tests (three on the pricer, three on the function adapter) ran in 125 ms with `dotnet run` on the test project under the Microsoft.Testing.Platform runner, with no host, no Azurite and no network. What this does not cover is the wiring: binding names, routes, `host.json`, DI registration. One test that starts the real host (Core Tools plus Azurite) per pipeline is the realistic cost. [Test Doubles in .NET: Fakes, Stubs and NSubstitute](/dotnet-testing-concepts/test-doubles-fakes-stubs-and-nsubstitute) and [Testing BackgroundService, Channels and Async Code](/dotnet-testing-concepts/testing-background-services-and-async-code) cover the techniques.

### Versions, plans and dates (docs only)

From the Learn pages (`functions-versions` dated 2026-10-12, `dotnet-isolated-process-guide` 2026-11-10, `functions-scale` 2026-11-09):

- "Support will end for the in-process model on November 10, 2026." The in-process model supported only .NET 8; isolated supports .NET 11, .NET 10 (end of support November 14, 2028), .NET 9 and .NET 8 (both November 10, 2026) and .NET Framework 4.8.1.
- .NET 11 needs `Azure.Functions.Sdk` 1.0.1 or later and an explicit `Microsoft.Azure.Functions.Worker`; `func init --worker-runtime dotnet-isolated --target-framework net11.0` creates it. F# on .NET 11 is temporarily unavailable.
- "You can't run .NET 10 or later apps on Linux in the Consumption plan. To run on Linux, you should instead use the Flex Consumption plan." So the backlog's "only on Flex Consumption" is too strong: the restriction is for Linux Consumption, which is retiring on 30 September 2028; Premium, Dedicated and Container Apps also run Linux, and Windows Consumption (legacy) is not affected.
- Flex Consumption: Linux only, scales per function up to 1,000 instances, memory 512, 2,048 or 4,096 MB, always-ready instances to cut cold start, VNet integration. Premium: prewarmed workers, "always ready" instances. Dedicated: the host runs continuously, so cold start "isn't really an issue". Consumption: the legacy plan, "scale to zero ... some requests might have more latencies at startup". Default timeout 30 minutes except Consumption (5, max 10); any HTTP trigger gets at most 230 seconds to respond.

Cold start was not measured: my local `dotnet run` start of about 4 s is not an Azure number. The docs' levers for .NET are the placeholders setting, `Microsoft.Azure.Functions.Worker` 1.19.0 or later, the ASP.NET Core `FrameworkReference` and ReadyToRun.

### Book vs today

Older books, posts and templates teach the in-process model: `Microsoft.NET.Sdk.Functions`, `[FunctionName]`, `ILogger` as a method parameter, `[assembly: FunctionsStartup]` with `IFunctionsHostBuilder`, `IAsyncCollector<T>` and `IBinder`. The docs' migration steps: `[FunctionName]` becomes `[Function]`; the logger comes from DI (`ILogger<T>`) or `FunctionContext`; `Startup.cs` becomes `Program.cs`; bindings move to `Microsoft.Azure.Functions.Worker.Extensions.*` (inputs gain an `Input` suffix, outputs `Output`); `IAsyncCollector<T>` becomes `T[]`; `IBinder` becomes a client from the service SDK (see [Azure SDK Clients and DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential)). Do not reference any `Microsoft.Azure.WebJobs.*` package or `Microsoft.Azure.Functions.Extensions` in an isolated app. Before the 2.x worker, `ConfigureFunctionsWorkerDefaults` was the only start-up; it still works. Durable Functions exists for isolated apps (`...Extensions.DurableTask` 1.22.0) and is not covered here: for jobs that need orchestration compare it with [Durable Jobs with Hangfire and Quartz.NET](/dotnet-concepts/durable-jobs-hangfire-and-quartz).

## Trade-offs

- **Isolated worker vs in-process.** The worker costs a second process and a gRPC hop per invocation, and you give up `IBinder` and `IAsyncCollector`; you gain your own dependency versions, DI, middleware and every current .NET version. There is no choice for new work: in-process ended on 2026-11-10.
- **IActionResult vs HttpResponseData.** ASP.NET Core types are familiar and the request body can be streamed, but they exist only on .NET, and the ASP.NET Core middleware pipeline is not exposed; the built-in types work everywhere and are verbose.
- **Triggers vs code you own.** A Queue trigger gives retries, poison queues and scaling for free (3 attempts, then `orders-poison` here), but the retry rules live in `host.json`, not in your code; a plain `BackgroundService` in a container gives full control and no scaling.
- **Storage dependency.** Every non-HTTP trigger needs a storage account (`AzureWebJobsStorage`) for locks and checkpoints; locally that is Azurite, in Azure a real account whose connection you must secure.
- **Flex Consumption vs Premium.** Flex scales to zero and bills per execution with optional always-ready instances; Premium keeps warm workers at a predictable price. Choose by traffic shape, with your own numbers.

## Documentation Links

- [Guide for running C# Azure Functions in an isolated worker process, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) (doc)
- [Azure Functions runtime versions overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions) (doc)
- [Migrate C# apps from in-process to isolated worker model, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model) (doc)
- [Differences between in-process and isolated worker process, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-in-process-differences) (doc)
- [Azure Functions scale and hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale) (doc)
- [Flex Consumption plan hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan) (doc)
- [Migrate Consumption plan apps to Flex Consumption, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/migration/migrate-plan-consumption-to-flex) (doc)
- [Develop and run Azure Functions locally (local.settings.json), Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local) (doc)
- [host.json reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json) (doc)
- [Azure Functions Core Tools, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) (doc)
- [Triggers and bindings in Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings) (doc)
- [Azure Queue storage trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger) (doc)
- [Timer trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer) (doc)
- [Event-driven scaling and cold start, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/event-driven-scaling) (doc)
- [Use the Azurite emulator for local Azure Storage development, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (doc)
- [Durable Functions in the .NET isolated worker, Microsoft Learn](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-dotnet-isolated-overview) (doc)
- [azure-functions-dotnet-worker, GitHub](https://github.com/Azure/azure-functions-dotnet-worker) (doc)
