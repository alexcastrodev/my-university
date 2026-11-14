---
version: 1.0
updatedAt: 2026-11-14
---
# Monitoring and Troubleshooting: OpenTelemetry Tracing and KQL

> Exam domain: **Secure, monitor, and troubleshoot Azure solutions (20-25%)**, skill group *Monitor and troubleshoot Azure solutions*.

---

## What OpenTelemetry gives you

OpenTelemetry (OTel) is a vendor-neutral standard with three signals:

| Signal | Answers |
|--------|---------|
| **Traces** | What path did one request take across services, and where was the time spent? |
| **Metrics** | How is the system behaving over time (rates, durations, counts)? |
| **Logs** | What happened, in detail, at a moment? |

A **trace** is a tree of **spans**. A span is one timed operation with a name, attributes, a status and a parent. The trace id is shared by every span in the request.

```text
trace 4bf92f...
 `- span  POST /orders              (orders-api)       182 ms
     |- span  SELECT docs           (postgres)          41 ms
     |- span  PUBLISH ingest        (service bus)       12 ms
     `- span  POST /embeddings      (openai)            96 ms
```

### Context propagation

For one trace to cross services, the **trace context** travels with the call. The W3C standard header is **`traceparent`** (`00-<trace-id>-<span-id>-<flags>`). HTTP instrumentation injects and extracts it automatically. Across a **message broker** it must be carried in the message properties, and the Azure SDK instrumentation does this for Service Bus and Event Hubs when tracing is enabled.

---

## Send telemetry to Azure Monitor (Application Insights)

Microsoft supplies a **distro** that wires OTel to **Azure Monitor Application Insights** with one call, and instruments common libraries automatically (incoming and outgoing HTTP, database drivers, Azure SDK calls).

```bash
pip install microsoft-opentelemetry
```

```python
import logging
from microsoft.opentelemetry import use_microsoft_opentelemetry

use_microsoft_opentelemetry(enable_azure_monitor=True, logger_name="orders")
logging.getLogger("orders").setLevel(logging.INFO)
```

The earlier **Azure Monitor OpenTelemetry Distro** (`azure-monitor-opentelemetry`, with `configure_azure_monitor()`) is still supported, and projects already using it need no change. Do not initialize both distros in one app.

The destination is set with the **connection string** of the Application Insights resource:

| Method | Recommended for |
|--------|-----------------|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable | **Production** |
| Passing it in code | Local development and test only |

When several services send to **one** Application Insights resource you must set a distinct **cloud role name** for each (derived from the OTel `service.name` resource attribute), or the Application Map cannot tell them apart.

### Custom spans with the OpenTelemetry API

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

def embed_document(doc):
    with tracer.start_as_current_span("embed_document") as span:
        span.set_attribute("doc.id", doc.id)
        span.set_attribute("doc.chunks", len(doc.chunks))
        try:
            return call_embeddings_model(doc)
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "embedding failed"))
            raise
```

- Use the **API** (`opentelemetry.trace`) in your code and configure the **SDK and exporter** once at startup.
- Add **attributes** for what you will want to filter by (ids, sizes, tenant). Avoid personal data.
- Spans created inside another span become **children** automatically through the current context.
- Control volume and cost with **sampling**, but sample at the **trace** level so a trace is kept or dropped as a whole.

---

## Where the data lands

In Application Insights the telemetry is stored in a Log Analytics workspace:

| Application Insights (classic names) | Workspace tables | Holds |
|--------------------------------------|------------------|-------|
| `requests` | `AppRequests` | Incoming requests (server spans) |
| `dependencies` | `AppDependencies` | Outgoing calls: HTTP, database, Service Bus |
| `exceptions` | `AppExceptions` | Recorded exceptions |
| `traces` | `AppTraces` | Log messages |
| `customMetrics` | `AppMetrics` | Metrics |

Every row has an **`operation_Id`** (`OperationId` in the workspace tables) equal to the **trace id**, which lets you join requests, dependencies and exceptions of one transaction.

---

## KQL (Kusto Query Language)

A KQL query is a **pipeline**: a table, then operators joined with `|`, each taking the previous result.

| Operator | Purpose |
|----------|---------|
| `where` | Filter rows |
| `project` / `project-away` | Choose columns |
| `extend` | Add a calculated column |
| `summarize ... by ...` | Aggregate (`count()`, `avg()`, `sum()`, `dcount()`, `countif()`, `percentile()`) |
| `bin(x, 5m)` | Round a value into buckets, usually time |
| `order by` / `top n by` | Sort, take the first rows |
| `take n` | Any n rows, fast sampling |
| `join` | Combine two tables (`kind=inner`, `leftouter`) |
| `let` | Name a value or a sub-query |
| `render timechart` | Draw the result |

Time columns: `timestamp` in Application Insights tables, **`TimeGenerated`** in Log Analytics workspace tables. `ago(1h)` gives "one hour before now".

### Examples

```kusto
// Failed requests per 5 minutes over the last hour
requests
| where timestamp > ago(1h)
| summarize failed = countif(success == false), total = count() by bin(timestamp, 5m)
| extend failureRate = round(100.0 * failed / total, 1)
| render timechart
```

```kusto
// Slowest operations: 95th percentile latency
requests
| where timestamp > ago(24h)
| summarize p95 = percentile(duration, 95), calls = count() by name
| top 10 by p95 desc
```

```kusto
// Which dependency is failing?
dependencies
| where timestamp > ago(1h) and success == false
| summarize failures = count() by target, type, resultCode
| order by failures desc
```

```kusto
// Everything that happened in one failed transaction
let failedOp = toscalar(requests | where success == false | top 1 by timestamp desc | project operation_Id);
union requests, dependencies, exceptions, traces
| where operation_Id == failedOp
| order by timestamp asc
| project timestamp, itemType, name, message, duration
```

Troubleshooting method: **find the symptom** (failure rate or latency over time), **narrow** by operation, dependency or exception, then **follow one `operation_Id`** end to end.

---

## Quick check

1. Two microservices share one Application Insights resource and appear as one node on the map. **Set a different cloud role name for each (OTel `service.name`).**
2. Where should the connection string live in production? **In the `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable.**
3. Query: requests per 10 minute bucket. **`summarize count() by bin(timestamp, 10m)`.**
4. How do you correlate a request with its database call? **They share the same trace id, stored as `operation_Id`.**

---

## Official documentation

- [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)
- [Kusto Query Language overview](https://learn.microsoft.com/en-us/kusto/query/)
- [OpenTelemetry concepts](https://opentelemetry.io/docs/concepts/)
