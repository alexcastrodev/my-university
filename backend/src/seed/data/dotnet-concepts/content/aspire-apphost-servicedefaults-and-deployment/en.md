---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A plain ASP.NET Core solution with three services leaves you to start each process, hand out ports, copy connection strings into every `appsettings.json`, wire OpenTelemetry and health checks in each `Program.cs`, and later write the Docker Compose file or Kubernetes manifests by hand. Aspire (formerly ".NET Aspire", now branded just "Aspire") moves that into code: an AppHost project is a C# program that describes the app model (which services exist, what they reference, what waits for what), a `ServiceDefaults` project gives every service the same telemetry, health and resilience setup, a dashboard shows logs, traces and metrics during development, and publishers turn the same model into deployment artifacts. Microsoft's documentation for it moved to aspire.dev (the old learn.microsoft.com pages redirect there), so that is the primary source for this lesson. I built a real AppHost with two project resources, ran it without Docker, printed what the consumer received, checked the health endpoints in two environments, queried the dashboard from the CLI, and generated Docker Compose, Helm and manifest outputs to a folder without deploying. Container resources (Redis, PostgreSQL) are shown as code that compiles but was not run, because no container runtime was running. Versions used: SDK 10.0.100, Aspire 13.6.4 (`Aspire.AppHost.Sdk`, `Aspire.Hosting.AppHost`, `Aspire.Cli`, `Aspire.ProjectTemplates`, `Aspire.Hosting.Docker`, `Aspire.Hosting.Redis`, `Aspire.Hosting.PostgreSQL`, `Aspire.StackExchange.Redis`), `Aspire.Hosting.Kubernetes` 13.6.4-preview.1.26523.11 (prerelease), and from the ServiceDefaults template `Microsoft.Extensions.Http.Resilience` 10.10.0, `Microsoft.Extensions.ServiceDiscovery` 10.10.0, OpenTelemetry packages 1.17.0.

## Use Cases

- Starting an API, a frontend and their databases with one command, with ports and connection strings handed out automatically.
- Seeing structured logs, distributed traces and metrics of every local service in one dashboard without installing a collector.
- Giving every service in a solution the same OpenTelemetry, health check, service discovery and HTTP resilience setup from one shared project.
- Generating a first Docker Compose file or Helm chart from the same app model instead of writing it from scratch.

## Deep Dive

### The AppHost describes, it does not serve

`dotnet new aspire` (from `Aspire.ProjectTemplates` 13.6.4) created two projects: `Shop.AppHost` and `Shop.ServiceDefaults`. I added two empty web projects, `Shop.Api` and `Shop.Web`, referenced them from the AppHost, and wrote the model:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var db = builder.AddConnectionString("orders-db");      // value comes from AppHost config

var api = builder.AddProject<Projects.Shop_Api>("api")
    .WithReplicas(2);

builder.AddProject<Projects.Shop_Web>("web")
    .WithReference(api)                // service discovery info for "api"
    .WithReference(db)                 // ConnectionStrings__orders-db
    .WithEnvironment("API_GREETING", "hi")
    .WaitFor(api)                      // do not start web before api
    .WithExternalHttpEndpoints();      // public endpoint when deployed

builder.Build().Run();
```

`Projects.Shop_Api` is a type generated from the `ProjectReference`. The AppHost project file is a single SDK line; `Aspire.Hosting.AppHost` 13.6.4 arrived implicitly through it:

```xml
<Project Sdk="Aspire.AppHost.Sdk/13.6.4">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <AspireUseCliBundle>true</AspireUseCliBundle>
  </PropertyGroup>
</Project>
```

Nothing in this program handles requests. It builds a graph of resources and hands it to an orchestrator, the Developer Control Plane (DCP), which starts the processes. The prerequisites page says a C# AppHost needs the .NET 10 SDK while the services it runs can target .NET 8 or later, and that a container runtime (Docker Desktop or Podman) is needed for container resources.

### Running it: `dotnet run` is `aspire run`

I ran `dotnet run --project Shop.AppHost --launch-profile http`. The template's `http` profile did not start:

```text
Unhandled exception. System.AggregateException: One or more errors occurred. (The 'applicationUrl' setting must be an https address unless the
'ASPIRE_ALLOW_UNSECURED_TRANSPORT' environment variable is set to true. ...)
```

After adding `"ASPIRE_ALLOW_UNSECURED_TRANSPORT": "true"` to that profile (and pinning its ports to 5735, 5736 and 5737), it printed:

```text
AppHost:   Shop.AppHost.csproj
Dashboard: http://localhost:5735/login?t=4eb131305999fb9f9e40150e294ede80
Logs:      /Users/<me>/.aspire/logs/cli_20261028T162128_b736db6f.log
           Press CTRL+C to stop the AppHost and exit.
```

The process list showed why the output looks like a CLI: with `AspireUseCliBundle`, `dotnet run` executed `dnx --yes aspire.cli@13.6.4 -- run --project ...`, so the Aspire CLI was downloaded into the NuGet cache and drove the run even though I had not installed it. Below it were the AppHost, two `dcp` processes, the dashboard process and the three services:

```text
dcp          listening 5731 (api proxy), 5733 (web proxy), 5735 (dashboard), 5736 (OTLP)
Shop.AppHost listening 5737 (resource service)
Shop.Api     pid 47218 on 22015, pid 47219 on 22016    (2 replicas)
Shop.Web     pid 47225 on 22014
```

The ports from each service's `launchSettings.json` (5731, 5733) became proxy ports owned by DCP; the real processes got random ports. Separately, I installed the CLI without root into a scratch folder with `dotnet tool install Aspire.Cli --tool-path ./cli` (13.6.4). The docs also offer `curl -sSL https://aspire.dev/install.sh | bash` and Homebrew. `aspire doctor` reported `Docker: installed but not running`, and `aspire ps`, `aspire describe` and `aspire stop` worked against the running AppHost:

```text
Name          Type       State    Health   URLs
api-feaqwaxa  Project    Running  Healthy  http://localhost:5731
api-yngunhqs  Project    Running  Healthy  http://localhost:5731
orders-db     Parameter  Running  Healthy  -
web           Project    Running  Healthy  http://localhost:5733
```

A background `kill -INT` did not stop the tree; `aspire stop` did, and every process and port was gone afterwards.

### What the consumer receives

`Shop.Web` has an endpoint that prints its own environment. These are the variables the AppHost injected (selection):

```text
API_GREETING=hi
API_HTTP=http://localhost:5731
services__api__http__0=http://localhost:5731
ConnectionStrings__orders-db=Host=db.example;Database=orders
ConnectionStrings__orders_db=Host=db.example;Database=orders
ASPNETCORE_URLS=http://localhost:22014
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5736
OTEL_EXPORTER_OTLP_HEADERS=x-otlp-api-key=70f464087b52bfbd0cde5e8e3f048cae
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_SERVICE_NAME=web
OTEL_RESOURCE_ATTRIBUTES=service.instance.id=mnymsryz
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_BLRP_SCHEDULE_DELAY=1000
OTEL_METRIC_EXPORT_INTERVAL=1000
OTEL_TRACES_SAMPLER=always_on
```

`WithReference(api)` produced two forms of the same address: `services__api__http__0` (the configuration key `services:api:http:0`, read by `Microsoft.Extensions.ServiceDiscovery`) and `API_HTTP`, a plain variable for code that does not use .NET service discovery. The connection string arrived under both `orders-db` and `orders_db`. The 1-second export intervals are what the telemetry docs describe: settings for local development so data shows up in the dashboard quickly.

In `Shop.Web` the client is registered with a logical name, `AddHttpClient("api", c => c.BaseAddress = new("http://api"))`. The structured logs show the rewrite:

```text
Start processing HTTP request GET http://api/hello
Sending HTTP request GET http://localhost:5731/hello
```

Service discovery is only configuration. I ran the two compiled services directly, without the AppHost. Without the variable, `/call` returned `500` after the standard retry made 4 attempts (`Attempt: '0'` to `'3'`):

```text
System.Net.Http.HttpRequestException: nodename nor servname provided, or not known (api:80)
```

With `services__api__http__0=http://localhost:5738` set by hand, the same binary reached the API. This is what makes the generated deployment files below work: they set the same variable.

### Replicas and the proxy

Six separate `curl` calls to the proxy on 5731 alternated between the two API processes (`47218, 47219, 47218, 47219, 47219, 47218`). Four calls from `Shop.Web` through one `HttpClient` all landed on pid 47219, most likely because the pooled connection stays open to one replica.

### ServiceDefaults: exactly what `AddServiceDefaults()` configures

Each service calls `builder.AddServiceDefaults()` and `app.MapDefaultEndpoints()`. I read the generated `Extensions.cs`. It does this, and nothing more (the OpenTelemetry lesson explains each piece):

- **Logging**: `builder.Logging.AddOpenTelemetry` with `IncludeFormattedMessage = true` and `IncludeScopes = true`.
- **Metrics**: ASP.NET Core, HttpClient and runtime instrumentation.
- **Tracing**: `AddSource(builder.Environment.ApplicationName)`, ASP.NET Core instrumentation with a filter that drops requests to `/health` and `/alive`, and HttpClient instrumentation (gRPC client instrumentation is a commented line).
- **Exporter**: `UseOtlpExporter()` only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; Azure Monitor is a commented block.
- **Health checks**: one check named `self`, always healthy, tagged `live`.
- **Service discovery**: `AddServiceDiscovery()`, plus `ConfigureHttpClientDefaults` that adds `AddStandardResilienceHandler()` and `AddServiceDiscovery()` to every `HttpClient` (restricting schemes to https is a commented option).
- **Endpoints**: `MapDefaultEndpoints` maps `/health` (all checks) and `/alive` (checks tagged `live`) only `if (app.Environment.IsDevelopment())`.

I ran the API alone in both environments:

```text
ASPNETCORE_ENVIRONMENT=Development: /health -> 200, /alive -> 200, /hello -> 200
ASPNETCORE_ENVIRONMENT=Production:  /health -> 404, /alive -> 404, /hello -> 200
```

The template comment points to the security implications of exposing health endpoints. For a real orchestrator you map them yourself, as in the health checks lesson. The resilience handler logs on every call (`Execution attempt. Source: '-standard//Standard-Retry' ... Attempt: '0'`), which is also what retried the failed calls above.

### The dashboard and its OTLP endpoint

The login URL carries a token. I checked both cases with `curl`:

```text
GET /login?t=wrong                              -> 302 Location: /login   (no cookie)
GET /login?t=4eb131305999fb9f9e40150e294ede80   -> 302 Location: /
    Set-Cookie: .Aspire.Dashboard.Auth.Http.shop-887c4652474c3c06=CfDJ8...
```

The docs say the token is required because the dashboard shows sensitive data such as environment variables, and that the cookie stays valid for three days. The OTLP receiver on 5736 is protected too. I sent an empty gRPC `TraceService/Export`:

```text
without x-otlp-api-key:          HTTP/2 401
with the key from the env var:   HTTP/2 200, grpc-status: 0
```

The docs list the views: Resources (the home page, with a graph of dependencies), Console logs, Structured logs, Traces and Metrics. I did not open a browser; `aspire otel` read the same data from the dashboard's API:

```text
web: GET /env   1 span   21.45ms  OK
web: GET /call  9 spans  78.78ms  OK
```

The `/call` trace had 9 spans: the server span in `web`, 4 client spans and 4 server spans in the API replicas.

### Integrations: hosting packages and client packages

Hosting packages (`Aspire.Hosting.*`) add resource types to the AppHost. This compiled with `Aspire.Hosting.Redis` and `Aspire.Hosting.PostgreSQL` 13.6.4, but I did not run it, because each `Add...` here is a container:

```csharp
var cache = builder.AddRedis("cache");
var ordersDb = builder.AddPostgres("pg").WithDataVolume().AddDatabase("ordersdb");
builder.AddProject<Projects.Shop_Api>("api")
    .WithReference(cache).WithReference(ordersDb).WaitFor(ordersDb);
```

Client packages (`Aspire.*`, without `Hosting`) go into the service and read the connection string the AppHost injects. With `Aspire.StackExchange.Redis` 13.6.4, `builder.AddRedisClient("cache")` registered a health check besides the client. I pointed it at a port with no Redis:

```text
health checks: self[live], StackExchange.Redis[]
multiplexer connected=False
/health -> 503 Unhealthy
/alive  -> 200 Healthy
```

Because the Redis check has no `live` tag, a dead Redis makes the service not ready but still alive. Without any connection string, the first request that resolved the client threw `InvalidOperationException: No endpoints specified. Ensure a valid connection string was provided in 'ConnectionStrings:cache' or for the 'Aspire:StackExchange:Redis:ConnectionString' configuration key.`

### Publishing and deploying

`aspire publish` writes artifacts for a compute environment declared in the model; `aspire deploy` builds, pushes and applies them. The deploy docs list Docker Compose, Kubernetes, AKS, Azure Container Apps and Azure App Service as targets. With `builder.AddDockerComposeEnvironment("compose")` (`Aspire.Hosting.Docker`) added to the model above, `aspire publish -o publish-out` finished in about 17 ms of pipeline time and wrote `docker-compose.yaml` and `.env` without needing Docker:

```text
  api:
    image: "${API_IMAGE}"
    environment:
      HTTP_PORTS: "${API_PORT}"
      ConnectionStrings__cache: "cache:6379,password=${CACHE_PASSWORD}"
      ConnectionStrings__ordersdb: "Host=pg;Port=5432;Username=postgres;Password=${PG_PASSWORD};Database=ordersdb"
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://compose-dashboard:18889"
      OTEL_SERVICE_NAME: "api"
    depends_on:
      pg:
        condition: "service_started"
  web:
    environment:
      services__api__http__0: "http://api:${API_PORT}"
```

The file also had `cache` (`redis:8.6`), `pg` (`postgres:18.3` with a volume), and a `compose-dashboard` service (`mcr.microsoft.com/dotnet/nightly/aspire-dashboard:13.6`). Secrets and images became empty entries in `.env` (`CACHE_PASSWORD=`, `PG_PASSWORD=`, `API_IMAGE=`). Two things did not carry over: `WithReplicas(2)` produced no replica setting, and `WaitFor` became `service_started`, not a health condition. No `ASPNETCORE_ENVIRONMENT` was set, so the services run as Production, where `MapDefaultEndpoints` maps no health endpoint.

`aspire deploy --list-steps` showed what deploy would add: `build-api`, `build-web`, `push-api`, `push-web`, `docker-compose-up-compose`. Those need Docker, so I did not run them. With `AddKubernetesEnvironment("k8s")` instead, publish wrote a Helm chart (`Chart.yaml`, `values.yaml`, a Deployment, Service and ConfigMap per resource plus the dashboard). There `replicas: 2` was honored, but no Deployment had a liveness or readiness probe. Publishing a model with no compute environment reported `4/4 steps succeeded` and wrote no files. The older JSON manifest still exists: `dotnet run --project Shop.AppHost -- --publisher manifest --output-path ...` wrote `aspire-manifest.json` (`project.v0`, `parameter.v0` resources with `{api.bindings.http.url}` placeholders), but the CLI wrapper did not exit afterwards and I had to stop it. Azure Container Apps is listed by the deploy docs as a publish and deploy target (the hosting package `Aspire.Hosting.Azure.AppContainers` is 13.6.4 on NuGet); the deploy page I read does not mention azd, and I did not try Azure.

### Templates and version churn

With `Aspire.ProjectTemplates` 13.6.4 installed, `dotnet new` listed `aspire`, `aspire-apphost`, `aspire-apphost-singlefile`, `aspire-servicedefaults`, `aspire-starter`, `aspire-ts-cs-starter` and `aspire-mstest`/`aspire-nunit`/`aspire-xunit`. I unpacked the 9.5.2 package for comparison: the same short names except `aspire-ts-cs-starter`, but its AppHost used `Microsoft.NET.Sdk` plus `<Sdk Name="Aspire.AppHost.Sdk" Version="9.5.2" />`, an explicit `Aspire.Hosting.AppHost` package and `net8.0`, and its ServiceDefaults used OpenTelemetry 1.12.0. The `aspire new` command offers TypeScript and Python starters too; the 13.4 release notes made the TypeScript AppHost generally available. NuGet served 13.6.4, while the install page still announced "Aspire 13.6.0, released September 29, 2026".

The test templates are the testing counterpart: in the package I unpacked, `aspire-xunit` references `Aspire.Hosting.Testing` and its sample starts the AppHost with `DistributedApplicationTestingBuilder.CreateAsync<Projects.MyAspireApp_AppHost>()`. A sibling lesson covers it.

## Trade-offs

- **It is a development-time orchestrator, not a runtime.** In production there is no AppHost and no DCP; what remains is the environment variables and the ServiceDefaults code your services carry. Plan the real health probes, secrets and scaling yourself.
- **Generated deployment files are a start, not a finish.** Replicas were dropped in Compose, `WaitFor` became `service_started`, Helm deployments had no probes, and the health endpoints exist only in Development.
- **Plain Docker Compose or Kubernetes may be enough.** If your services already run from a compose file and you do not want a C# project describing them, Aspire adds a layer to learn and upgrade.
- **Services couple to Aspire conventions.** Logical names like `http://api` and `ConnectionStrings:cache` work outside the AppHost only if something sets `services__api__http__0` and the connection string. The code itself stays plain ASP.NET Core.
  ```csharp
  // works anywhere the variable is set
  builder.Services.AddHttpClient("api", c => c.BaseAddress = new("http://api"));
  ```
- **ServiceDefaults is copied code.** The template pinned OpenTelemetry 1.17.0 at creation time, so you update those packages yourself, like any other project.
- **Versions move fast.** The product was renamed, the AppHost project format changed between 9.x and 13.x, the CLI now drives `dotnet run`, and the Kubernetes publisher was still a preview package in 13.6.4. Pin the SDK version and read the release notes before upgrading.
- **Containers need a runtime.** Every `AddRedis`/`AddPostgres` resource needs Docker or Podman running; an AppHost with only project resources runs without one.

## Documentation Links

- [What is Aspire?, aspire.dev](https://aspire.dev/get-started/what-is-aspire/) (doc)
- [Service defaults, aspire.dev](https://aspire.dev/fundamentals/service-defaults/) (doc)
- [Telemetry, aspire.dev](https://aspire.dev/fundamentals/telemetry/) (doc)
- [Explore the Aspire dashboard, aspire.dev](https://aspire.dev/dashboard/explore/) (doc)
- [Deploy with Aspire, aspire.dev](https://aspire.dev/deployment/deploy-with-aspire/) (doc)
- [What's new in Aspire 13.4, Microsoft Aspire blog](https://devblogs.microsoft.com/aspire/whats-new-aspire-13-4/) (doc)
