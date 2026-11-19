---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

An MCP call crosses a process boundary (a pipe or HTTP) that your tracing does not see unless something carries the trace context across. The C# SDK does both halves: it emits its own spans and metrics, and it writes `traceparent`, `tracestate` and `baggage` into the request's `_meta`, so a server handler lands in the same trace as the client call. This lesson measures what the SDK emits and what it records by default (and what it should not), how the context travels over stdio and HTTP, how the tree looks with `UseOpenTelemetry()` and `UseFunctionInvocation()` on a scripted `IChatClient` (no model), why a stdio server must keep telemetry off stdout, and how to export over OTLP. OpenTelemetry basics (sources, meters, SDK wiring, sampling) are in the lesson "OpenTelemetry: Logs, Metrics and Traces" and are not repeated. Versions: `ModelContextProtocol`, `ModelContextProtocol.Core` and `ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.Extensions.AI` 10.11.0, `OpenTelemetry` (`.Extensions.Hosting`, `.Exporter.Console`, `.Exporter.OpenTelemetryProtocol`, `.Exporter.InMemory`) 1.21.0, `net10.0`, SDK 10.0.100, spec revision 2026-07-28.

## Use Cases

- Seeing one trace from a user request through the agent loop, the MCP call and the server handler.
- Alerting on slow or failing tools with the SDK's duration histograms, per tool.
- Keeping a stdio server's logs and traces out of the protocol channel.
- Reviewing what an MCP integration puts into telemetry before it reaches a vendor backend.

## Deep Dive

### What the SDK emits by itself

The names are not in the docs I found; I read them from the string table of `ModelContextProtocol.Core.dll` and confirmed with listeners. One `ActivitySource` and one `Meter`, both named `Experimental.ModelContextProtocol` (the prefix says the conventions are still moving). Two processes, a client and a stdio server, each with an `ActivityListener` and a `MeterListener` of mine (`Sample` returning `AllDataAndRecorded`), one `tools/call` under a `Demo.Host` root span:

```text
client Demo.Host | checkout-flow | Internal | trace=44bdd0ea span=5b42e0 parent=none | 43.5 ms
client Experimental.ModelContextProtocol | tools/call get_stock | Client | trace=44bdd0ea span=b996cd parent=5b42e0 | 32.3 ms
   tags: mcp.session.id, jsonrpc.request.id=2, mcp.method.name=tools/call, network.transport=pipe,
         mcp.protocol.version=2026-07-28, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool
server Experimental.ModelContextProtocol | tools/call get_stock | Server | trace=44bdd0ea span=3301c2 parent=b996cd | 31.8 ms
server Stock.Server | load-stock | Internal | trace=44bdd0ea span=815ff9 parent=3301c2 | 22.1 ms
```

The span name is `{mcp.method.name} {target}`. The server span is a child of the client span in the same trace, and my own `load-stock` activity (an `ActivitySource` called `Stock.Server`, started inside the tool) hangs under the server span with no extra code. `server/discover` gets a span too, and `resources/read` is named just `resources/read`. Four histograms, all in seconds:

```text
client metric mcp.client.operation.duration (s) = 0.0324 {mcp.method.name=tools/call, network.transport=pipe, mcp.protocol.version=2026-07-28, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool}
server metric mcp.server.operation.duration (s) = 0.0319 {mcp.method.name=tools/call, network.transport=pipe, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool}
client metric mcp.client.session.duration (s) = 0.7553 {network.transport=pipe}      (also mcp.server.session.duration)
```

Two quirks. Each response also produced a measurement tagged `mcp.method.name=unknownMethod` with a near-zero value, so a histogram of 2501 real operations had a count of 5002; I did not find the cause, so exclude that tag value in views and alerts. And `mcp.session.id` is different on the client and the server for stdio (each side makes its own), so it is not a join key: join on the trace id.

### The context travels in _meta

The spec's `_meta` table reserves `traceparent`, `tracestate` and `baggage` for OpenTelemetry trace context (SEP-414, a minor change in 2026-07-28), in W3C Trace Context and W3C Baggage formats. Capturing the child's stdin with `sh -c "tee c2s.log | dotnet Server.dll | tee s2c.log"`, with `tracestate` and baggage set on the root activity:

```text
{"method":"tools/call","params":{"name":"get_stock","arguments":{"sku":"SKU-1"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"Client","version":"1.0.0.0"},"io.modelcontextprotocol/clientCapabilities":{},"traceparent":"00-e6c238e038c80845005bce894cc06868-e54696841d81bedb-03","tracestate":"vendor=abc","baggage":"tenant = acme"}},"id":2,"jsonrpc":"2.0"}
```

The parent id in `traceparent` (`e54696...`) is the client MCP span, not the root. The client pinned to `ProtocolVersion = "2025-11-25"` sent the same three keys alone in `_meta`, and the server span was still a child of the client span, so propagation does not depend on the new protocol. What the server did with them:

```text
handler sees: tracestate='vendor=abc' Activity.Baggage=[] OTel Baggage.Current=[]
_meta baggage read by hand: tenant = acme      (ctx.Params?.Meta?["baggage"] in a tool with RequestContext<CallToolRequestParams>)
```

`traceparent` and `tracestate` are restored on the server span; `baggage` is written by the client but not restored in 2.4.0 (the IL references `ExtractTraceIdAndState`, not `ExtractBaggage`). If a tenant id must reach server-side tags or logs, read `_meta["baggage"]` yourself and decide what to trust, because any client can send any value.

### HTTP has two parents

Over Streamable HTTP the same request carries the context twice: in the `traceparent` header (added by `HttpClient`) and in `_meta` (added by the SDK). The server listened to `Microsoft.AspNetCore` as well:

```text
trace=b1f41122  Demo.Host checkout-flow                         span=f2ceb9
  client  MCP   tools/call get_stock                            span=45d458  parent=f2ceb9
    client  System.Net.Http POST                                span=e6d50c  parent=45d458
      server  Microsoft.AspNetCore HttpRequestIn                span=1063ff  parent=e6d50c   (from the header)
    server  MCP   tools/call get_stock                          span=50bfd9  parent=45d458   (from _meta)
      server  Stock.Server load-stock                           span=114f51  parent=50bfd9
```

The MCP server span is not a child of the ASP.NET Core span: both hang from the client span, one through the header and one through `_meta`. A backend that draws the tree still shows one trace, but do not expect the HTTP server span to be the parent of the tool. The client reported `network.transport=unknown` on HTTP while the server said `tcp`, so group by `mcp.method.name` and tool name, not by transport, across the two sides. Here `baggage` did reach the ASP.NET Core span (from the HTTP header), but not the MCP span.

### The full tree: chat, tool call, MCP request, handler

A scripted `IChatClient` (no model) answers the first call with a `FunctionCallContent` for `get_stock` and the second with text. The MCP tools from `ListToolsAsync()` go into `ChatOptions.Tools`. Middleware order decides the tree, because the spans of the tool loop depend on where `UseOpenTelemetry()` sits. First, `UseFunctionInvocation().UseOpenTelemetry(sourceName: "lab.llm")`:

```text
handle-user-request                          Demo.Host
  orchestrate_tools                          lab.llm
    chat                                     lab.llm      (the model asks for get_stock)
    execute_tool get_stock                   lab.llm      (+ mcp.* tags added by the MCP SDK)
      tools/call get_stock       [server]    Experimental.ModelContextProtocol   (other process, parent = execute_tool)
        load-stock               [server]    Stock.Server
    chat                                     lab.llm      (the final answer)
```

There is no MCP client span in the client's list: when the current activity is already named `execute_tool ...`, the SDK does not create its own and writes `mcp.method.name`, `mcp.session.id` and the others onto that span, and the `_meta` carries the `execute_tool` span id. I confirmed it by hand: starting my own activity named `execute_tool get_stock` suppressed the client span, `other-name` did not. The OpenTelemetry MCP conventions ask for exactly this (do not create a separate span when outer GenAI instrumentation already traces the tool). With the order reversed, `UseOpenTelemetry().UseFunctionInvocation()`, the result was one `chat` span for the whole loop (the scripted model ran twice inside it), no `orchestrate_tools` or `execute_tool` span, and the MCP client span `tools/call get_stock` directly under `chat`. Use the first order to see each model call and each tool call as a span.

### What is recorded by default, and what is not

The SDK's spans and metrics never carried tool arguments, tool results, prompt text or file contents: `get_stock` with `sku=SKU-1` produced no `SKU-1` anywhere in them. The sensitive parts are elsewhere:

```text
UseOpenTelemetry, EnableSensitiveData=false: execute_tool get_stock tags: gen_ai.tool.call.id, gen_ai.tool.name, gen_ai.tool.description, mcp.*, ...
UseOpenTelemetry, EnableSensitiveData=true:  the same plus
    gen_ai.tool.call.arguments={"sku":"SKU-1"}  gen_ai.tool.call.result={"$type":"text","text":"SKU-1: 12 units"}
```

`gen_ai.tool.definitions` (names and descriptions of the tools) was on the `chat` span in both runs. A tool that throws `InvalidOperationException("db password is hunter2")`:

```text
span status=Error, error.type=tool_error          (the exception text is not in the span or the metric)
client:  IsError=True, generic text                (the C# SDK lesson shows this part)
server stderr (ILogger): "fail" threw an unhandled exception. System.InvalidOperationException: db password is hunter2 ...stack...
```

The client and the span are safe, but the server's own `ILogger` wrote the message and the stack. That log line, plus any `LogInformation("looking up {Sku}", sku)` you add, is where data leaks. Treat the telemetry pipeline like the logging pipeline: decide what leaves the machine. An unknown tool (`error.type=-32602`, `rpc.response.status_code=-32602`) put the caller's `gen_ai.tool.name=nope` on the server's metric, so a client controls that tag value.

### Metric cardinality: the resource URI

OpenTelemetry's MCP conventions list `mcp.resource.uri` on the operation metrics as Opt-In (the spans may carry it, the span name should not). In 2.4.0 it was on the metric by default (`resources/read ... mcp.resource.uri=stock://item/SKU-7`). A client reading 2500 different `stock://item/{sku}` URIs through a real `MeterProvider` (`AddInMemoryExporter`), default, then with a View that keeps only three tag keys:

```text
default: points=2001, total count=5002, overflow point=yes
with View dropping mcp.resource.uri: points=3, total count=5002, overflow point=no
```

```csharp
b.AddMeter("Experimental.ModelContextProtocol")
 .AddView("mcp.client.operation.duration",
          new MetricStreamConfiguration { TagKeys = ["mcp.method.name", "gen_ai.tool.name", "error.type"] });
```

Past the default limit of 2000 combinations the rest collapse into `otel.metric.overflow=true`, silently (the cause is explained in the OpenTelemetry lesson). Apply the same View to `mcp.server.operation.duration`. The span keeps the URI, which is fine for one request, but URIs carry ids and file paths, so redact them in a span processor if a backend is shared. I did not run the unbounded-tool-name case on the server, only observed the tag value.

### Logging: stderr, not stdout

Spec 2026-07-28 deprecates the Logging feature (SEP-2577); the changelog says "log to stderr (stdio) or use OpenTelemetry instead of Logging", and the SDK docs mark it deprecated (diagnostic `MCP9005`). `notifications/message` now only flows for requests that carry `io.modelcontextprotocol/logLevel` in `_meta` (docs only, not run). On stdio, stdout is the protocol, so everything else goes to stderr. A stdio server with the default console logger, then with `LogToStandardErrorThreshold = LogLevel.Trace` (the reference lesson shows the relay to the client's logger through `StandardErrorLines`):

```text
default console logger:       call ok, client transport parse failures (non-JSON lines on stdout): 28
LogToStandardErrorThreshold:  call ok, client transport parse failures: 0
```

The OpenTelemetry console exporter is the same trap, because it prints to `Console.Out`:

```text
AddConsoleExporter(), default:                       call ok, parse failures: 64   (the client drops them)
Console.SetOut(Console.Error) before the host starts: call ok, parse failures: 0, exporter output on stderr
```

`Console.SetOut(Console.Error)` worked in 2.4.0, so the transport does not use `Console.Out`. Better still, do not use the console exporter in a stdio server: use OTLP.

### Exporting over OTLP

A stdio server with the SDK, set up by environment variables the client passes through `StdioClientTransportOptions.EnvironmentVariables`:

```csharp
b.Services.AddOpenTelemetry().ConfigureResource(r => r.AddService("stock-server", serviceVersion: "1.0.0"))
    .WithTracing(t => t.AddSource("Experimental.ModelContextProtocol").AddSource("Stock.Server").AddOtlpExporter())
    .WithMetrics(m => m.AddMeter("Experimental.ModelContextProtocol").AddOtlpExporter());
// OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:6161  OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

A local `HttpListener` played the collector:

```text
collector: POST /v1/traces  application/x-protobuf 954 bytes  service.name=stock-server has 'tools/call get_stock'=True
collector: POST /v1/metrics application/x-protobuf 2489 bytes  service.name=stock-server has 'mcp.server.operation.duration'=True
```

I closed the client and let the server shut down before reading the collector; a process killed abruptly can lose the last batch (my inference, not measured). For Aspire Dashboard (docs only, not run) the standalone page gives `docker run --rm -it -p 18888:18888 -p 4317:18889 -p 4318:18890 -d --name aspire-dashboard mcr.microsoft.com/aspire/dashboard:latest`, with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` for HTTP and `4317` for gRPC: the same variables, a different endpoint.

## Trade-offs

- **Experimental names.** The source and meter are `Experimental.ModelContextProtocol`, and the OpenTelemetry MCP conventions are in Development status. Dashboards built on these names break on a rename; keep the names in one constant and re-check on SDK upgrades.
- **Two parents over HTTP.** The header links the ASP.NET Core span and `_meta` links the MCP span, so the tree has two branches. Do not write queries that assume the tool span sits under `HttpRequestIn`.
- **Baggage is not applied on the server.** It is sent, but a handler reads it from `_meta` itself. Treat it as untrusted input.
  ```csharp
  var tenant = ctx.Params?.Meta?["baggage"];   // validate before it becomes a tag or a log field
  ```
- **Default tags can be too rich.** `mcp.resource.uri` and the caller's tool name on metrics grow with the traffic. Drop them with a View; arguments and results stay out unless you set `EnableSensitiveData`.
- **Your logs are the leak.** The span said `tool_error` while the server's `ILogger` printed the exception text. Review log statements in tools, and turn on `EnableSensitiveData` only in a development environment.
- **Order of middleware changes the tree.** `UseFunctionInvocation()` outside `UseOpenTelemetry()` gives per-call spans; the opposite gives one `chat` span.
- **stdio needs discipline.** Nothing but protocol on stdout: logger to stderr, no console exporter, no stray `Console.WriteLine`. OTLP avoids the problem.

## Documentation Links

- [Specification 2026-07-28: Base protocol, _meta and OpenTelemetry trace context, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) (doc)
- [Specification changelog 2026-07-28 (SEP-414, SEP-2577), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [OpenTelemetry semantic conventions for MCP, GitHub](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md) (doc)
- [MCP C# SDK, release v2.1.0 (telemetry samples), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.1.0) (doc)
- [MCP C# SDK, Logging concept (deprecated in 2026-07-28), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/logging/logging.md) (doc)
- [.NET distributed tracing concepts, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-concepts) (doc)
- [Add distributed tracing instrumentation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-instrumentation-walkthroughs) (doc)
- [Aspire dashboard standalone mode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard/standalone) (doc)
- [Trace Context, W3C](https://www.w3.org/TR/trace-context/) (doc)
- [Baggage, W3C](https://www.w3.org/TR/baggage/) (doc)
