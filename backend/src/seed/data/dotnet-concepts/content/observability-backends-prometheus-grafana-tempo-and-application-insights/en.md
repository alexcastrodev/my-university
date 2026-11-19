---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

The OpenTelemetry concept ends at the OTLP exporter: the app emits traces, metrics and logs and posts them somewhere. This concept is the "somewhere". It runs the open stack for real on Docker (OpenTelemetry Collector, Prometheus, Grafana Tempo, Grafana Loki, Grafana) with two ASP.NET Core services of mine, then measures what you actually do with it: send OTLP over gRPC and over HTTP, write PromQL for rate, error ratio and p95, watch a tag explode the series count, follow one slow request from a metric exemplar to its trace to its log line, provision the Grafana datasources from a file and check them through the HTTP API, and compare head sampling in the SDK with tail sampling in the Collector. Application Insights and Azure Monitor are read from the official docs only, because they need an Azure subscription (docs only). The basics of sources, meters, SDK wiring and cardinality are in the OpenTelemetry concept and are not repeated. Versions: SDK 10.0.100, `net10.0`, `OpenTelemetry.Extensions.Hosting`, `OpenTelemetry.Exporter.OpenTelemetryProtocol`, `OpenTelemetry.Instrumentation.AspNetCore`, `.Http`, `.Runtime` 1.21.0, `OpenTelemetry.Exporter.Prometheus.AspNetCore` 1.21.0-beta.1 (no stable release exists), `otel/opentelemetry-collector-contrib` 0.165.0, `prom/prometheus` v3.16.0, `grafana/tempo` 2.10.10, `grafana/loki` 3.7.10, `grafana/grafana` 13.3.1.

## Use Cases

- Choosing where traces, metrics and logs go before the first production deploy, and what each choice costs.
- Answering "how many requests, how many fail, how slow is p95" with PromQL instead of parsing logs.
- Jumping from a latency spike on a dashboard to the slow trace and to the log lines of that same request.
- Cutting trace volume without losing the failed and slow requests.
- Deciding between the open stack and Application Insights for a team on Azure.

## Deep Dive

### The Collector as the single endpoint

Apps talk OTLP to one address; the Collector decides where each signal goes. That keeps backends out of application config: swapping Tempo for another trace store is a Collector change, not a redeploy of every service. The Collector has receivers, processors and exporters wired into pipelines. This is the whole file of the lab (image `otel/opentelemetry-collector-contrib`, the distribution that includes the community components):

```yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
processors:
  memory_limiter: { check_interval: 1s, limit_mib: 400, spike_limit_mib: 100 }
  resource/env:
    attributes: [{ key: deployment.environment.name, value: lab, action: upsert }]
  attributes/scrub:
    actions: [{ key: url.query, action: delete }]
  batch: { timeout: 1s }
exporters:
  otlp/tempo:          { endpoint: "tempo:4317", tls: { insecure: true } }
  otlphttp/prometheus: { endpoint: "http://prometheus:9090/api/v1/otlp", tls: { insecure: true } }
  otlphttp/loki:       { endpoint: "http://loki:3100/otlp" }
service:
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, resource/env, attributes/scrub, batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [memory_limiter, resource/env, batch], exporters: [otlphttp/prometheus] }
    logs:    { receivers: [otlp], processors: [memory_limiter, resource/env, batch], exporters: [otlphttp/loki] }
```

Order in `processors` matters: `memory_limiter` goes first so overload is refused before work is done, `batch` goes last so exporters send groups. `resource/env` stamps `deployment.environment.name=lab` on everything, in one place. `attributes/scrub` deleted `url.query`: after a request to `/orders/5?token=abc&x=1`, a TraceQL search for spans with `url.query` in Tempo found none. I did not run the control without the processor, so that shows the delete worked on this path, not what the SDK sends by default. The Collector publishes its own metrics on port 8888, and those numbers are used below to count what each stage received and sent.

### One line in the app

The app is one minimal API binary run twice (`gateway` calls `inventory`), told apart only by environment variables:

```csharp
builder.Services.AddOpenTelemetry()
    .UseOtlpExporter()   // traces, metrics and logs, endpoint and protocol from OTEL_* variables
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddSource("Shop"))
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation().AddMeter("Shop").AddPrometheusExporter());
app.MapPrometheusScrapingEndpoint();   // /metrics, for the scrape comparison below
```

`UseOtlpExporter()` registers the OTLP exporter for all three signals at once. I ran it twice, once with `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6540`, once with `http/protobuf` and `http://localhost:6541` (the Collector's 4318). The Collector counters tell which door was used:

```text
http/protobuf: otelcol_receiver_accepted_log_records{receiver="otlp",transport="http"} 26479
               otelcol_receiver_accepted_metric_points{...transport="http"} 2547
               otelcol_receiver_accepted_spans{...transport="http"} 6230
```

Both worked with no code change. With HTTP the base URL is enough: the exporter appends `/v1/traces`, `/v1/metrics` and `/v1/logs` when the endpoint comes from the environment (see the OpenTelemetry concept for the case where it does not). gRPC is the default in the SDK; HTTP/protobuf is what you use when a proxy or ingress does not carry HTTP/2. Note the ratio: for about 1550 orders the Collector accepted 6230 spans and 26479 log records, roughly 4 times more logs than spans. At `Information` level ASP.NET Core and `HttpClient` log several lines per request, and the OpenTelemetry logging provider exports all of them. Logs are usually your biggest signal by volume, which matters in the cost section.

### Metrics: Prometheus, two ways in

Prometheus can pull from `/metrics` or accept OTLP from the Collector (`--web.enable-otlp-receiver`, path `/api/v1/otlp/v1/metrics`). I ran both at the same time against the same `gateway` process, with the same load (about 30 req/s, 10% of them slow):

```text
                                          OTLP via Collector        scrape of /metrics
rate of /orders/{id:int}                  30.0 req/s                27.99 req/s
p95 of http_server_request_duration       0.375 s                   0.375 s
```

The numbers agree (the small gap is the 5 s scrape interval against the 5 s OTLP export, sampled at different instants). The difference is in the labels (OTLP adds `deployment_environment_name` and `service_instance_id`, scrape adds `otel_scope_name`). Prometheus translates names: `http.server.request.duration` became `http_server_request_duration_seconds_*` (dots to underscores, unit as suffix), a counter got `_total`, and the resource went to a `target_info` metric except for the attributes listed in `promote_resource_attributes` (I promoted `service.instance.id` and `deployment.environment.name`, which is why those labels exist). With OTLP, `job` is the `service.name` and `instance` the `service.instance.id`; with scrape they come from the target address. Choose one path per service: scrape is simple and pull-based but needs Prometheus to reach the app; OTLP push goes through the same Collector as the other signals and needs no open port on the app. The Prometheus docs list the translation and its options.

PromQL on that data, all run against the API:

```promql
sum by (job, http_route) (rate(http_server_request_duration_seconds_count{http_route!="/metrics"}[30s]))
  # gateway /orders/{id:int} 34.0 req/s, inventory /stock/{id:int} 34.0 req/s
sum(rate(...count{job="gateway",http_response_status_code=~"5.."}[30s])) / sum(rate(...count{job="gateway",http_route="/orders/{id:int}"}[30s]))
  # 0.0506  (5 of every 100 orders end in 502 because inventory fails every 20th id)
histogram_quantile(0.95, sum by (le, job) (rate(http_server_request_duration_seconds_bucket{job="gateway"}[30s])))
  # 0.253 s with 5% slow requests, 0.375 s with 10% slow
```

Two things to watch. `histogram_quantile` interpolates inside a bucket: the 0.375 is the middle of the 0.25 to 0.5 bucket, not a measured latency, and when the slow share sits at exactly 5% a p95 can flip between the fast and the slow bucket. And the buckets must exist: .NET 10's own `http.server.request.duration` has sensible second-based boundaries (OpenTelemetry concept), your custom histograms need advice.

### Cardinality, measured in series

The same experiment as the OpenTelemetry concept, now seen from the backend. A counter `shop.orders.placed` and an endpoint that adds 3000 increments, first with a bounded tag (5 regions), then with a different `user.id` each time:

```text
series of shop_orders_placed_total (gateway)
  before                            2     (eu, us)
  after 3000 hits, 5 regions        7
  after 3000 hits, user.id unique   2001  (2000 distinct + 1 overflow series otel.metric.overflow="true", value 1007)
  sum over all series               6950  (nothing lost in total, only the identity)
```

Both paths (OTLP and scrape) showed the 2001 series. Every series is a time series that Prometheus must index and store, so one careless tag turned one counter into 2001 series, and 2000 is the SDK default ceiling, not a protection of your Prometheus: with several service instances the series multiply again by the number of instances. Keep ids out of metric tags; per-user questions go to traces and logs. Prometheus gets cheap when label values are bounded (route template, status class, region).

### Traces: why Tempo here

I picked Grafana Tempo and did not run Jaeger. The reasons, which are judgments: Tempo stores traces in an object store (the lab uses local disk) with no index database to operate, it is queried with TraceQL, and it is built to be linked from metrics and logs in Grafana, which is the point of this concept. Jaeger's all-in-one image is a fine local viewer too; the app and the Collector would not change, only the exporter in the Collector. The Tempo config of the lab is the minimum for one node: an OTLP gRPC receiver, `local` storage and `block_retention: 48h`. The Collector's `otlp/tempo` exporter feeds it. I measured Tempo 2.10.10 in single-binary mode; the project also publishes a 3.x line (3.1.1 at the time of writing) that I did not run, so re-check the config on the version you deploy.

One request through both services, found by TraceQL and then fetched by id:

```text
GET /api/search?q={ rootName = "GET /orders/{id:int}" && duration > 250ms }
trace 4845c8478f9319c9120e0e0405ebe18f
  gateway   GET /orders/{id:int}   301.3 ms
  gateway   price-order            301.1 ms   (my ActivitySource "Shop")
  gateway   GET                    301.0 ms   (HttpClient)
  inventory GET /stock/{id:int}    300.8 ms
```

Four spans, two services, one trace id: `HttpClient` sent a `traceparent` header and `inventory` continued the trace (W3C propagation, as in the OpenTelemetry concept). The 300 ms is in the inventory span, so the slowness is not in the gateway.

### Logs: Loki and the trace id

Loki 3.x ingests OTLP natively at `/otlp` (the Collector's `otlphttp/loki` exporter), so there is no separate Loki exporter to configure. The log record carries the active trace and span ids, and Loki keeps them as structured metadata. I set `IncludeFormattedMessage = true` on the logging options so the line is readable. An error from the failing inventory call, queried by label and level:

```text
{service_name="gateway"} | detected_level="error"
line:     Order 60 failed, stock answered 500
metadata: OrderId=60 Status=500 trace_id=42ccd87e6bf8c255... span_id=07dec4a826607fac severity_text=Error scope_name=Program
labels:   service_name, deployment_environment_name   (the only two index labels)
```

Only a few resource attributes become labels (`service_name`, `deployment_environment_name`); everything else, including `trace_id`, is structured metadata that you filter with `| trace_id="..."`. That keeps Loki's index small, and it is the reverse of what high-cardinality label habits suggest. The message template placeholders (`OrderId`, `Status`) came through as metadata too, so use templates, not interpolation.

### Grafana: datasources by file, correlation by config

Datasources are provisioned from a YAML file in `/etc/grafana/provisioning/datasources`, so a fresh container is ready with no clicking:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      exemplarTraceIdDestinations: [{ name: trace_id, datasourceUid: tempo }]
  - name: Tempo
    uid: tempo
    type: tempo
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        filterByTraceID: true
        customQuery: true
        query: '{service_name="$${__span.tags["service.name"]}"} | trace_id="$${__trace.traceId}"'
      tracesToMetrics: { datasourceUid: prometheus }
  - name: Loki
    uid: loki
    type: loki
    url: http://loki:3100
    jsonData:
      derivedFields:
        - { name: trace_id, matcherType: label, matcherRegex: trace_id, url: '$${__value.raw}', datasourceUid: tempo }
```

The `$$` is not a typo: Grafana expands `$VAR` in provisioning files, and `$$` yields a literal `$` for its own variables (the API returned `${__span.tags[...]}` and `${__trace.traceId}`). Verification by HTTP, no screenshots:

```text
GET /api/datasources                       loki, prometheus (default), tempo
GET /api/datasources/uid/{prometheus,tempo,loki}/health
   OK Successfully queried the Prometheus API.
   OK Data source is working
   OK Data source successfully connected.
```

The three signals together, entirely through `POST /api/ds/query`, the endpoint the panels use:

```text
1. Prometheus, exemplar=true, bucket le="0.5": 4 exemplars, all > 0.25 s, one with
   value 0.301263 s and trace_id 4845c8478f9319c9120e0e0405ebe18f
2. Tempo, queryType "traceId" with that id: the 4 spans listed above
3. Loki, {service_name="gateway"} | trace_id="4845c8...":
   Request finished HTTP/1.1 GET http://localhost:6550/orders/1041 - 200 ... 301.2630ms
```

Exemplars need two switches that are easy to miss. In Prometheus, `--enable-feature=exemplar-storage`. In the .NET SDK, the exemplar filter: with the default, `/metrics` in OpenMetrics format carried no exemplar (0 lines with `# {trace_id`), and with `OTEL_METRICS_EXEMPLAR_FILTER=trace_based` it carried 23, and Prometheus then returned them from `/api/v1/query_exemplars` (9 series). The "traceId" query type is the one that fetches a trace by id; sending the id as a TraceQL query returned a parse error.

### Sampling: head in the SDK, tail in the Collector

The same 1000 requests (50 end in an error, 100 take 300 ms) sent three times, counting traces in Tempo by TraceQL after the flush (Tempo needed about 30 s before all of them were searchable: a count taken too early gave 627 of 1000):

```text
                                        traces kept   error traces   slow traces   spans sent to Tempo
no sampling                             1000          50             100           ~4000
head: parentbased_traceidratio 0.1      81            5              8             ~326
tail: errors + >200 ms + 10%            220           50             100           880
```

Head sampling is decided at the root from the trace id (`OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`). It kept 8% of the traces, complete, and dropped the bad ones at the same rate as the good ones: 5 of 50 errors survived. The saving is at the source: the Collector received about 326 spans, not 4000. The tail policy, in the `tail_sampling` processor (`decision_wait: 5s`, three policies: `status_code` ERROR, `latency` threshold 200 ms, `probabilistic` 10%),

kept all 50 error traces and all 100 slow ones plus about 8% of the 850 healthy ones. The price: the Collector received all 4016 spans and held them in memory for `decision_wait`, and all spans of a trace must reach the same Collector instance (with several replicas you need load balancing by trace id in front). Use head sampling when you only need to cap volume and can live without the rare failure; use tail sampling when the failure and the slow request are exactly what you keep traces for. They combine: a modest head ratio in the SDK and tail policies in the Collector.

### Cost and retention

I do not quote prices; they depend on the vendor and contract. What the measurements show is what drives them. Series count (one tag turned 2 series into 2001), log volume (about 4 log records for each span at default levels), and trace volume (sampling cut 4000 spans to 326 or 880 sent). Retention is a setting per store: the lab used `--storage.tsdb.retention.time=2d` for Prometheus, `block_retention: 48h` for Tempo and `retention_period: 48h` for Loki. Long retention for logs is the expensive default to forget; metrics are cheap to keep, traces are the ones to sample.

### Application Insights and Azure Monitor (docs only)

Not run here, since it needs an Azure subscription. What the Microsoft docs say today: application telemetry goes to an Application Insights resource, identified by a connection string. The recommended way for new .NET apps is now the Microsoft OpenTelemetry Distro (package `Microsoft.OpenTelemetry`, `builder.UseMicrosoftOpenTelemetry(o => o.Exporters = ExportTarget.AzureMonitor)`); the docs say that apps already on the Azure Monitor OpenTelemetry Distro need no action. That older distro is `Azure.Monitor.OpenTelemetry.AspNetCore` (1.6.0 stable on NuGet), with `builder.Services.AddOpenTelemetry().UseAzureMonitor()`. Both read `APPLICATIONINSIGHTS_CONNECTION_STRING`, and the docs recommend the environment variable for production and the code setting for local development only. Data model: spans for server work land in the `requests` table and outgoing calls in `dependencies`, log records in `traces` (a legacy name), and exceptions have their own `exceptions` table; sampling is rate-limited or fixed-percentage through the distro options. When several services share one resource, set the cloud role name (the OpenTelemetry `service.name`), or the Application Map merges them. The classic Application Insights API SDK 2.x for .NET is deprecated and retires on 2027-03-31, per the docs, so new code should use OpenTelemetry. The docs also say the OTLP exporter is "for convenience only" and not officially supported alongside the Azure exporter.

For local development without any of the above, the standalone Aspire Dashboard accepts OTLP and shows the three signals in one container (covered in the Aspire concept).

### Which backend for which signal

| Signal | Backend | How the app sends it | Typical query | Pitfall |
|---|---|---|---|---|
| Metrics | Prometheus | OTLP via Collector, or scrape `/metrics` | `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))` | Unbounded tags make millions of series |
| Traces | Tempo (or Jaeger) | OTLP via Collector | TraceQL `{ status = error && duration > 250ms }` | Head sampling drops rare errors; tail needs one Collector per trace |
| Logs | Loki | OTLP via Collector (`/otlp`) | `{service_name="gateway"} \| trace_id="..."` | Highest volume; ids are metadata, not labels |
| All three | Grafana | Datasources provisioned by file | Exemplar to trace to log | Exemplars need two switches (SDK filter and Prometheus feature) |
| All three | Application Insights | `Microsoft.OpenTelemetry` or `UseAzureMonitor`, connection string | KQL on `requests`, `dependencies`, `traces` | Classic SDK 2.x retires 2027-03-31; set cloud role names |

On the job market: the Grafana, Prometheus and OTLP stack is the open standard and moves between clouds; Application Insights dominates in teams that run on Azure, and with OpenTelemetry the instrumentation code is the same, only the exporter differs.

## Trade-offs

- **A Collector is another service to run.** It gives one endpoint, central processors and backend swaps, and it adds a hop and a place that can drop data. For one small app, exporting OTLP straight to the backend is simpler.
- **Scrape or OTLP for metrics.** Scrape is pull-based and needs the app reachable; OTLP push shares the pipeline with the other signals, and translates names (`_seconds`, `_total`) and resource labels differently. Pick one per service, or you count twice.
- **Head against tail sampling.** Head is cheap and blind to errors; tail keeps the interesting traces and costs memory and a trace-aware load balancer. Measured above: 5 of 50 errors kept against 50 of 50.
- **Correlation is configuration, not magic.** Exemplars, `trace_id` in logs and the Tempo to Loki link each need a setting on both sides, and a typo means a silent dead link. Check it through the API, as above.
- **Application Insights is managed and Azure-bound.** Less to operate, billed by ingestion, with a KQL query model; the open stack is portable and you run it. The exporter choice is the only code difference.

## Documentation Links

- [OpenTelemetry for .NET, opentelemetry.io](https://opentelemetry.io/docs/languages/dotnet/) (doc)
- [OpenTelemetry Collector, opentelemetry.io](https://opentelemetry.io/docs/collector/) (doc)
- [Tail sampling processor, GitHub](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor) (doc)
- [OpenTelemetry Exporter Prometheus AspNetCore, GitHub](https://github.com/open-telemetry/opentelemetry-dotnet/tree/main/src/OpenTelemetry.Exporter.Prometheus.AspNetCore) (doc)
- [Prometheus documentation](https://prometheus.io/docs/) (doc)
- [Using Prometheus as an OpenTelemetry backend, prometheus.io](https://prometheus.io/docs/guides/opentelemetry/) (doc)
- [Grafana Tempo documentation](https://grafana.com/docs/tempo/latest/) (doc)
- [Grafana Loki documentation](https://grafana.com/docs/loki/latest/) (doc)
- [Ingesting logs to Loki using OpenTelemetry, Grafana](https://grafana.com/docs/loki/latest/send-data/otel/) (doc)
- [Provision Grafana, grafana.com](https://grafana.com/docs/grafana/latest/administration/provisioning/) (doc)
- [Enable OpenTelemetry in Application Insights, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable) (doc)
- [OpenTelemetry configuration for Azure Monitor, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration) (doc)
- [Application Insights telemetry data model, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/data-model-complete) (doc)
- [Application Insights Classic API 2.x deprecation, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/asp-net-core) (doc)
- [Standalone Aspire Dashboard, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard/standalone) (doc)
