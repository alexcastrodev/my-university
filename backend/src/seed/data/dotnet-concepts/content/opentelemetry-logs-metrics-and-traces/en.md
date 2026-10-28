---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

When a request is slow or fails in production you need three kinds of evidence: logs (what happened), metrics (how often and how long, in aggregate) and traces (where one request spent its time across services). .NET does not hide these behind a vendor SDK: the framework itself ships the APIs (`ILogger`, `Meter`, `ActivitySource`) and already emits data through them. OpenTelemetry is the standard layer that collects that data and exports it, usually over OTLP, to whatever backend you run. This concept separates the two halves that people mix up (what the framework and your code emit, what the SDK collects), runs both against a real app, and measures the parts that bite: instrumentation that silently does nothing, a metric that loses its dimensions, sampling that cuts the trace in half, and an exporter that posts to the wrong path. Versions used: SDK 10.0.100, OpenTelemetry packages 1.20.1.

## Use Cases

- Finding which hop of a request through three services added the 800 ms.
- Alerting on request rate, error rate and latency percentiles without parsing logs.
- Correlating a log line with the exact request that produced it.
- Sending the same telemetry to Aspire Dashboard locally and to a managed backend in production by changing only environment variables.

## Deep Dive

### Three signals, three framework APIs

The docs describe the split: `Microsoft.Extensions.Logging.ILogger` for logs, `System.Diagnostics.Metrics.Meter` for metrics, `System.Diagnostics.ActivitySource` and `Activity` for tracing. These types are part of .NET, so a library can instrument itself without referencing any telemetry vendor. OpenTelemetry's job is to listen to them and export. Naming differs: what OpenTelemetry calls a tracer and a span are `ActivitySource` and `Activity` in .NET, and what it calls attributes are tags.

### Tracing: StartActivity can return null

An `ActivitySource` costs nothing until somebody listens. With no listener:

```csharp
var src = new ActivitySource("Shop.Orders", "1.0.0");
src.StartActivity("x");   // null
```

With a listener, what the listener answers in `Sample` decides what you get:

```text
no listener:        StartActivity -> null
None                activity=null
PropagationData     activity=created, IsAllDataRequested=False, Recorded=False
AllData             activity=created, IsAllDataRequested=True,  Recorded=False
AllDataAndRecorded  activity=created, IsAllDataRequested=True,  Recorded=True
```

Always write `activity?.SetTag(...)`, because the result can be null. `PropagationData` creates an activity only to carry the trace id forward to the next service; `IsAllDataRequested` is the hint that nobody will read tags, so skip expensive ones. The IDs follow the W3C format (`Activity.DefaultIdFormat` is `W3C`), and children are linked automatically through `Activity.Current`, which flows across `await`:

```text
parent.Id      = 00-f0d96be9f9ac273ef74b763ab5c9571c-676432794cb0bbc8-01
child.Id       = 00-f0d96be9f9ac273ef74b763ab5c9571c-0e544646a89f0fa8-01
child.ParentId = 00-f0d96be9f9ac273ef74b763ab5c9571c-676432794cb0bbc8-01
same TraceId=True, Current is child=True
after await: Current is child=True
after child.Dispose: Current is parent=True
```

The format is `version-traceid-spanid-flags`. Failure is recorded with `activity?.SetStatus(ActivityStatusCode.Error, "card declined")`. The docs add two rules of thumb: events live in memory until sent, so use `ILogger` for large or unbounded volumes, and do not wrap every method in an activity, because the trace becomes unreadable.

### Metrics: instruments and listeners

A `Meter` is a named group of instruments. Each instrument type states an intent that backends use to choose a default computation:

```csharp
var meter = new Meter("Shop.Orders", "1.0.0");
var created  = meter.CreateCounter<long>("shop.orders.created", "{order}", "Orders created");
var duration = meter.CreateHistogram<double>("shop.orders.duration", "s");
var inFlight = meter.CreateUpDownCounter<int>("shop.orders.in_flight");
meter.CreateObservableGauge("shop.orders.pending", () => pending);
```

Use a counter for a value that only goes up, an up-down counter for something that goes up and down, a histogram for durations and sizes (you want percentiles, not an average), and an observable instrument when you already hold the total and want it read on demand (observable callbacks run in sequence, so keep them fast). A `MeterListener` is the in-process hook that SDKs use, and I used it directly:

```text
no listener:   created.Enabled=False
with listener: created.Enabled=True
  Counter`1        shop.orders.created = 1 {region=eu}
  Counter`1        shop.orders.created = 2 {region=us}
  Histogram`1      shop.orders.duration = 0.012
  UpDownCounter`1  shop.orders.in_flight = 1
  ObservableGauge`1 shop.orders.pending = 7
```

`Enabled` is false without a listener, and the first `Add(1)` in that state was heard by nobody. Follow the naming advice in the docs: lowercase dotted names, units in UCUM (`s`, `By`, `{order}`), and durations in seconds as a `double`. In code that uses DI, get the `Meter` from `IMeterFactory` (hosts register it since .NET 8) instead of a static field, so meters in different containers stay isolated, which matters when tests run in parallel. `MetricCollector<T>` from `Microsoft.Extensions.Diagnostics.Testing` asserts on measurements in a test.

### What the framework already emits

I started a minimal API with no OpenTelemetry package at all, only an `ActivityListener` and a `MeterListener`, and made one request that calls a second endpoint through `HttpClient`:

```text
ActivitySources that produced activities:
  Microsoft.AspNetCore / Microsoft.AspNetCore.Hosting.HttpRequestIn (Server)
  System.Net.Http / System.Net.Http.HttpRequestOut (Client)
  Experimental.System.Net.Http.Connections / ...ConnectionSetup, ...WaitForConnection
  Experimental.System.Net.Sockets / ...Connect

Meters published (a selection):
  Microsoft.AspNetCore.Hosting / http.server.request.duration, http.server.active_requests
  Microsoft.AspNetCore.Routing / aspnetcore.routing.match_attempts
  Microsoft.AspNetCore.Server.Kestrel / kestrel.active_connections, kestrel.connection.duration, ...
  System.Net.Http / http.client.request.duration, http.client.open_connections, ...
  System.Runtime / dotnet.gc.collections, dotnet.gc.pause.time, dotnet.thread_pool.queue.length, ...
```

The old runtime counters (`EventCounters`, `PerformanceCounter`) are legacy next to this. The downstream endpoint printed the header it received:

```text
server activity trace=9c5458b80311b86ac52c6e20e14bea83
downstream saw: traceparent=00-9c5458b80311b86ac52c6e20e14bea83-73d5009bb7056542-01
```

`HttpClient` injected a `traceparent` header taken from the current activity, so the second hop joined the same trace with no code from me. This is context propagation, and it is what turns a pile of spans into one trace.

### Wiring the SDK

The SDK subscribes to the sources and meters you name and sends them to an exporter:

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api", serviceVersion: "1.0.0"))
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                       .AddSource("Shop.Orders").AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                       .AddRuntimeInstrumentation().AddMeter("Shop.Orders").AddOtlpExporter());
```

`AddSource` and `AddMeter` are opt-in: your `Shop.Orders` data is dropped unless you register its name. The docs also point to the Aspire `ServiceDefaults` project template (`dotnet new aspire-servicedefaults`) as the easiest starting configuration, even without the rest of Aspire. The `Console` exporter (`OpenTelemetry.Exporter.Console`) is the quick way to see what is exported.

### What the instrumentation packages still add

On .NET 10 the framework already creates the server and client spans, so I compared two hosts: one with `AddAspNetCoreInstrumentation()` and `AddHttpClientInstrumentation()`, one that only calls `AddSource("Microsoft.AspNetCore", "System.Net.Http")`:

```text
with the packages:
  Microsoft.AspNetCore | GET /orders/{id:int} | Server | tags: http.request.method=GET, url.path=/orders/7, http.route=/orders/{id:int}, http.response.status_code=200, server.address, server.port, url.scheme
  System.Net.Http      | GET                  | Client | tags: http.request.method, url.full=..., http.response.status_code=200

only AddSource:
  Microsoft.AspNetCore | Microsoft.AspNetCore.Hosting.HttpRequestIn | Server | tags: (none)
  System.Net.Http      | GET                  | Client | tags: same as above
```

The client span was identical, but the server span arrived with the raw operation name and no tags. The ASP.NET Core package names the span after the route and fills in the semantic-convention attributes (`http.route`, status code), which is what dashboards group by. For metrics there was no difference in the result: both hosts exported `http.server.request.duration`, `kestrel.active_connections`, `http.client.request.duration` and the `dotnet.*` runtime set, because the framework meters already publish them and the packages mainly enable the right meter names.

### One trace across hops

The exported spans of one request in that host, linked by parent:

```text
GET /orders/7          Client    System.Net.Http       parent: none
  GET /orders/{id:int} Server    Microsoft.AspNetCore  parent: the client span
    load-order         Internal  Shop.Orders           parent: the server span
      GET              Client    System.Net.Http       parent: load-order
        GET /down      Server    Microsoft.AspNetCore  parent: the client span
```

Five spans, one trace id, every `ParentSpanId` pointing at the previous hop. A custom activity needs nothing else to join: it picked `Activity.Current` as its parent.

### Metric cardinality: the silent data loss

Tags make a metric multi-dimensional, and every distinct combination is stored. I recorded 3000 hits with a different `user.id` each, through the SDK, with the default limit, then with `CardinalityLimit = 100`, and for contrast with 5 distinct routes:

```text
default limit, 3000 distinct user.id: points=2001, total=3000, overflow point=yes (value 1000)
CardinalityLimit=100:                 points=101,  total=3000, overflow point=yes (value 2900)
5 distinct routes:                    points=5,    total=3000, overflow point=no
```

The total is preserved, but after 2000 combinations (the default) the rest are folded into one point tagged `otel.metric.overflow=true`, so 1000 of those users cannot be told apart anymore. Nothing throws and nothing logs. The docs give the reasoning: collection tools allocate storage per tag combination, and about 1000 combinations per instrument is a safe budget. Put bounded values in tags (route template, status class, region), never ids, emails or raw URLs. A per-user question belongs in logs or traces.

### Histogram buckets

A histogram is exported as buckets, and the SDK default boundaries (`0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000`) suit milliseconds, not the seconds that the docs recommend for durations. Six measurements between 4 ms and 900 ms:

```text
default:       count=6 sum=1.158 buckets [<=0:0 <=5:6 <=10:0 ... <=10000:0 <=inf:0]
with advice:   count=6 sum=1.158 buckets [<=0.005:1 <=0.01:0 <=0.025:2 <=0.05:1 <=0.1:0 <=0.5:1 <=1:1 <=inf:0]
```

With the defaults all six land in the `<=5` bucket, so percentiles are useless. The second instrument was created with `new InstrumentAdvice<double> { HistogramBucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1] }` (from `System.Diagnostics.DiagnosticSource` 9, used by the SDK from 1.10), which lets the instrument author recommend sensible boundaries. The framework does this for its own histograms: reading `Advice` on `http.server.request.duration` and `http.client.request.duration` in .NET 10 gave `0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10` seconds, so those two are usable out of the box and only your own histograms need advice.

### Sampling: keep the trace whole

Recording every span is expensive at volume. A sampler decides at the root, and the sensible one is `ParentBasedSampler(new TraceIdRatioBasedSampler(0.1))`: the decision is made from the trace id and children follow the parent. I sent 2000 requests, each with a child span:

```text
ratio 0.1, 2000 requests: roots recorded=191, children recorded with sampled root=191,
                          children recorded under unsampled root=0, exported spans=382
default sampler, 50 requests: exported=50
```

About 10% of the traces were kept, and each kept trace is complete (the 191 children came with their 191 parents, and none appeared without one). The default samples everything. Sampling is by trace, so a rare error is dropped with the same odds as a healthy request; tail-based sampling, which keeps slow or failed traces, is done in a collector, not in this SDK.

### Resource: who is talking

Every signal carries a resource that identifies the service. Without configuration:

```text
service.name=unknown_service:OtelLab, telemetry.sdk.name=opentelemetry, telemetry.sdk.language=dotnet, telemetry.sdk.version=1.20.1
```

With `OTEL_SERVICE_NAME=orders-api` and `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=staging,service.version=1.4.2` set in the environment:

```text
service.name=orders-api, deployment.environment.name=staging, service.version=1.4.2, ...
```

Set at least `OTEL_SERVICE_NAME` in every deployment. Otherwise the backend shows a service named after the process, and two services with the same executable name merge.

### Logs that point at their trace

OpenTelemetry hooks into `ILogger`, so existing log calls need no change. Inside an active activity:

```csharp
logger.LogInformation("Order {OrderId} placed, total {Total}", 42, 9.9m);
```

```text
in activity: TraceId=d747be3aa0ca29352f021160e351abbf (matches the activity), SpanId=1b30f63abb610b09, LogLevel=Information
  FormattedMessage='Order 42 placed, total 9.9', Body='Order {OrderId} placed, total {Total}'
  Attributes: OrderId=42, Total=9.9, {OriginalFormat}=Order {OrderId} placed, total {Total}
  Scopes: tenant=acme
outside any activity: TraceId=00000000000000000000000000000000, SpanId=0000000000000000
```

The log record carries the trace and span ids, so a backend can jump from a trace to its logs and back. The message template stays as the body and each placeholder becomes an attribute (`OrderId=42`), which is why you should log with templates, not interpolated strings. A log written outside any activity has all-zero ids. (`IncludeFormattedMessage` and `IncludeScopes` are options of the logging provider, off by default.)

### Exporting with OTLP

`OpenTelemetry.Exporter.OpenTelemetryProtocol` sends everything to any OTLP endpoint (a collector, Aspire Dashboard, most vendors). I pointed it at a local HTTP listener that logged what it received:

```text
env OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 + protocol http/protobuf: POST /v1/traces
code  Endpoint=http://127.0.0.1:4318 + HttpProtobuf:                            POST /
code  Endpoint=http://127.0.0.1:4318/v1/traces + HttpProtobuf:                  POST /v1/traces
```

Through the environment variable the exporter appends the per-signal path (`/v1/traces`, `/v1/metrics`, `/v1/logs`). A URI set in code is used as written, so over HTTP the first code variant posted to `/` and a collector would answer 404. Prefer the standard `OTEL_EXPORTER_OTLP_*` variables, which also make the same image work against a different backend per environment.

## Trade-offs

- **Instrumentation is opt-in per name.** A source or meter you never register is silently dropped.
  ```csharp
  .WithTracing(t => t.AddSource("Shop.Orders"))   // forget this and load-order never appears
  ```
- **Tags are the cost center of metrics.** Each distinct combination costs memory and money, and past the limit the dimension collapses into one overflow point.
  ```csharp
  counter.Add(1, new("route", "/orders/{id}"));   // good: bounded
  counter.Add(1, new("user.id", userId));         // bad: unbounded
  ```
- **Sampling trades completeness for cost.** At 10% you will miss most rare failures; keep errors with a collector that does tail sampling, or sample at 100% for a low-traffic service.
- **Span names and tags come from the instrumentation package.** Registering only the framework's source gives you spans, but with no route name and no attributes, so aggregation by endpoint is impossible.
- **Logs, metrics and traces answer different questions.** Metrics are cheap and aggregate, traces show one request's path, logs hold the detail. Use the cheapest one that answers your question.
- **Telemetry has a runtime cost.** Recording is cheap (under 10 ns with no listener per the docs, more with a collector), but unbounded events on an activity sit in memory until exported.
- **Packages and conventions move.** The spans above declare a semantic-convention schema (`https://opentelemetry.io/schemas/1.44.0`), and attribute names change as that schema evolves, so build dashboards and alerts on the names you actually export and re-check them when you upgrade the packages.

## Documentation Links

- [.NET Observability with OpenTelemetry, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel) (doc)
- [Creating Metrics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/metrics-instrumentation) (doc)
- [Add distributed tracing instrumentation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-instrumentation-walkthroughs) (doc)
- [Compare metric APIs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/compare-metric-apis) (doc)
- [ASP.NET Core metrics, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/metrics/overview?view=aspnetcore-10.0) (doc)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/) (doc)
