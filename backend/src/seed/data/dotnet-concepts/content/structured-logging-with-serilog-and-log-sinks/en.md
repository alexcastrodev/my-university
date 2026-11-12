---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

`ILogger` is the API your code calls; a logging provider decides what happens to each message. Serilog is the provider most .NET teams pick when they want structured events, sinks for files and log stores, and enrichment, and it plugs in behind `ILogger<T>` so application code does not change. The built-in providers, categories, levels and `[LoggerMessage]` are covered in the ILogger concept; this one starts where it stops. It wires Serilog into an ASP.NET Core host, reads sinks and levels from `appsettings.json`, writes compact JSON to the console and to a rolling file, adds request logging and context properties, masks personal data, tests all of it with an in-memory sink, and compares Serilog with the OpenTelemetry route. Everything ran on .NET 10. Versions used: SDK 10.0.100, Serilog 4.4.0, Serilog.AspNetCore 10.0.0, Serilog.Settings.Configuration 10.0.1, Serilog.Sinks.Console 6.1.1, Serilog.Sinks.File 7.0.0, Serilog.Formatting.Compact 3.0.0, Serilog.Enrichers.Environment 3.0.1, Serilog.Sinks.OpenTelemetry 4.2.0, Microsoft.Extensions.Telemetry and Microsoft.Extensions.Compliance.Redaction 10.11.0.

## Use Cases

- Writing one JSON object per line to the console and to a rolling file, with levels you can change in configuration.
- Making every line of a request carry the tenant, the trace id and the request id without passing them around.
- Keeping an object's structure in the log (`{@Customer}`) while masking the fields you must not store.
- Asserting in a test that a log event has the right template, level and properties, instead of matching text.

## Deep Dive

### Message templates keep fields, interpolation throws them away

Serilog and `ILogger` share the idea of a message template: the placeholders are named values, not format slots. I logged the same order twice through `ILogger` with the Serilog provider and printed what the sink received:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", id, total);
log.LogInformation($"Order {id} placed, total {total}");
```

```text
template='Order {OrderId} placed, total {Total}' props=[OrderId=42, Total=9.9, SourceContext="Shop.Orders", Application="shop"]
template='Order 42 placed, total 9,9' props=[SourceContext="Shop.Orders", Application="shop"]
```

The interpolated call has no `OrderId` and no `Total`, and its "template" is a different string for every order, so a log store cannot group or filter on it. It also rendered the decimal with the comma of this machine's culture, while the template call kept the raw `9.9`. `SourceContext` is the `ILogger` category, and `Application` came from `Enrich.WithProperty`. Placeholders bind by position, and Serilog is forgiving where the built-in console provider is not. With a missing argument, the console provider threw an `AggregateException` out of the logging call (see the ILogger concept). With Serilog the call returned normally and the event was gone:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", 42);       // one argument short
log.LogInformation("Order {OrderId} placed", 42, 99);                  // one argument extra
```

```text
msg='Order 42 placed' props=[OrderId=42, ...]      <- only the second call arrived
2026-11-12T14:55:02.7235670Z Failed to write event through SerilogLogger: System.IndexOutOfRangeException: Index was outside the bounds of the array.
```

The error line appears only because I enabled `SelfLog`. The build still warns (CA2017), so keep that warning visible, and treat `SelfLog` as the place where Serilog reports its own failures.

### Destructuring: `@`, `$` and the default

An object passed to a placeholder is stored as its `ToString()` unless you ask for its structure with `@`. `$` forces the string form. I logged one record, one anonymous object and one dictionary:

```text
plain {Customer}        "Customer { Id = 5, Email = ana@example.com, Tags = System.String[] }"
destructured {@Customer} Customer { Id: 5, Email: "ana@example.com", Tags: ["a", "b"] }
stringified {$Customer}  "Customer { Id = 5, Email = ana@example.com, Tags = System.String[] }"
anon {@Obj}              { X: 1, Y: { Z: "q" } }
dict {@D}                [("a": 1)]
```

The same `{@Customer}` worked through `ILogger`, because the Serilog provider reads the template, not the call site. The built-in providers know nothing about `@`; it just becomes part of the key. Destructuring is also where personal data leaks, because every public property goes out. A destructuring policy fixes that for one type:

```csharp
.Destructure.ByTransforming<Customer>(c => new { c.Id, Email = Mask(c.Email) })
```

```json
"Customer":{"Id":5,"Email":"a***@example.com"}
```

The transform applies only to `{@Customer}`. A `{Customer}` placeholder still prints `ToString()` and bypasses it.

### UseSerilog, AddSerilog and the bootstrap logger

The lab host registers Serilog like this:

```csharp
builder.Host.UseSerilog((context, services, logger) => logger
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .Destructure.ByTransforming<Customer>(c => new { c.Id, Email = Mask(c.Email) }));
```

`ReadFrom.Configuration` builds sinks, levels and enrichers from the `Serilog` section, and `ReadFrom.Services` picks up the Serilog extension points registered in the container (the README lists sinks, enrichers and destructuring policies; I exercised the sink), which is how the tests add theirs. `builder.Services.AddSerilog(...)` (an extension on `IServiceCollection`) took the same lambda in my second experiment, on `Host.CreateApplicationBuilder`, so it is the form for hosts that are not web hosts. Two small facts from building it: with `using Serilog;` and `using Microsoft.Extensions.Logging;` in one file, `ILogger` is ambiguous (`error CS0104`), so alias one or qualify it; and the lambda that receives `IServiceProvider` is the one that lets sinks use registered services.

Logs written before the host is built (configuration errors, a failing `Build()`) need a logger that exists earlier. `CreateBootstrapLogger` returns a reloadable logger that the host later replaces:

```csharp
Log.Logger = new LoggerConfiguration().WriteTo.Console(new CompactJsonFormatter()).CreateBootstrapLogger();
Log.Information("before the host: bootstrap");
builder.Services.AddSerilog((services, lc) => lc.ReadFrom.Configuration(builder.Configuration)
    .Enrich.WithProperty("Phase", "host").WriteTo.Console(new CompactJsonFormatter()));
```

```text
{"@t":"2026-11-12T14:55:43.2006690Z","@mt":"before the host: bootstrap"}
{"@t":"2026-11-12T14:55:43.2664860Z","@mt":"inside the host","SourceContext":"Program","Phase":"host"}
{"@t":"2026-11-12T14:55:43.2671120Z","@mt":"static Log after the host built","Phase":"host"}
```

The third line shows that the static `Log.Logger` is the same reloadable logger and now has the full configuration. Put the bootstrap logger and a `try/catch` with `Log.Fatal` and `Log.CloseAndFlush()` around `Program.cs` in a real service. I left it out of the lab on purpose: tests create several hosts in one process, and a static logger is shared state you do not want there.

### Sinks from `appsettings.json`

With `Serilog.Settings.Configuration` the whole pipeline lives in configuration. This is the lab's file:

```json
"Serilog": {
  "Using": [ "Serilog.Sinks.Console", "Serilog.Sinks.File" ],
  "MinimumLevel": { "Default": "Information", "Override": { "Microsoft.AspNetCore": "Warning" } },
  "WriteTo": [
    { "Name": "Console", "Args": { "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact" } },
    { "Name": "File", "Args": { "path": "logs/lab-.ndjson", "rollingInterval": "Day", "retainedFileCountLimit": 7,
                                "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact" } }
  ]
}
```

I started the app and sent five requests (an order with a tenant header, a customer, a refusal, an endpoint that throws and a 404). The console and the file both got one JSON object per line in the compact format (`@t` time, `@mt` template, `@l` level only when it is not Information, `@x` exception, `@tr` and `@sp` trace and span id). The business line and its request summary:

```json
{"@t":"2026-11-12T14:55:15.9989430Z","@mt":"Order {OrderId} placed, total {Total}","@tr":"7ecd9ffc2a1b4128dc0f4019537cd342","@sp":"a7f5e6b89380777e","OrderId":42,"Total":9.90,"SourceContext":"SerilogLab.OrderService","RequestId":"0HNQ0PJR4LFQ7:00000001","RequestPath":"/orders/42","ConnectionId":"0HNQ0PJR4LFQ7","Tenant":"acme"}
{"@t":"2026-11-12T14:55:16.0009220Z","@mt":"HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms","@r":["5.1821"],"@tr":"7ecd9ffc2a1b4128dc0f4019537cd342","@sp":"a7f5e6b89380777e","Tenant":"acme","RequestMethod":"POST","RequestPath":"/orders/42","StatusCode":200,"Elapsed":5.182084,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","RequestId":"0HNQ0PJR4LFQ7:00000001","ConnectionId":"0HNQ0PJR4LFQ7"}
```

Where the properties came from: `OrderId` and `Total` from the template, `SourceContext` from the logger category, `Tenant` from the `LogContext` (next section), `RequestId`, `RequestPath` and `ConnectionId` from the scope ASP.NET Core opens around every request (Serilog turns key-value scopes into properties), and `@tr`/`@sp` from the current `Activity`, with no code of mine. The refused order, written by a `[LoggerMessage]` method, carried its event id as a structure, `"EventId":{"Id":3001,"Name":"OrderRefused"}`, and `"@l":"Warning"`.

Two facts about configuration that cost time if you meet them in production. First, an unknown sink name does not stop the app. I configured `"Name": "Nope"`:

```text
Unable to find a method called Nope. Candidate methods are:
Serilog.LoggerConfiguration Console(...)
Serilog.LoggerConfiguration File(...)
```

That text went to `SelfLog` only; `CreateLogger()` returned normally and the app ran with no sink. The same happened to me in the lab tests: overriding the file path with `WebApplicationFactory.UseSetting("Serilog:WriteTo:1:Args:path", ...)` produced the same `Unable to find a method called .` for every host and no file was ever created, while the tests that use the in-memory sink kept passing. `ConfigureAppConfiguration` with an in-memory collection for the same key worked. Add a test that reads the file, as the lab does. Second, a sink that throws does not break the caller either: a sink whose `Emit` threw `IOException("disk full")` was reported to `SelfLog` and the program continued. Logging is meant never to take the app down, which also means it fails silently.

Levels reload live. With `AddJsonFile(..., reloadOnChange: true)` and a file holding `Default: Information` and `Override: { "Shop": "Warning" }`, one probe of every level for `Shop.Orders` and `Other`, then a rewrite of the file to `Debug` for both, then the same probe 1.5 s later:

```text
initial: Shop.Orders:Warning Other:Information
after reload: Shop.Orders:Debug Shop.Orders:Information Shop.Orders:Warning Other:Debug Other:Information
```

The `Override` that quiets framework noise is the one you will use most. With `Microsoft.AspNetCore` at `Warning` one request wrote 2 lines. Setting it back to `Information` through the environment (`Serilog__MinimumLevel__Override__Microsoft.AspNetCore=Information`, where `__` replaces `:`) wrote 7: `Request starting`, `Executing endpoint`, the business line, `Setting HTTP status code`, `Executed endpoint`, the Serilog summary and `Request finished`.

### Rolling files

`rollingInterval` puts the date in the name (`lab-.ndjson` became `lab-20261112.ndjson`), and `retainedFileCountLimit` deletes the oldest. I wrote 120 lines with `fileSizeLimitBytes` 2000 and `rollOnFileSizeLimit` true, a daily interval and `retainedFileCountLimit` 3:

```text
app-20261112_003.log 2046 bytes
app-20261112_004.log 2056 bytes
app-20261112_005.log 940 bytes
```

The size limit adds a `_NNN` suffix, files go slightly over the limit (the line that crosses it is finished), and retention kept the 3 newest, so `_001` and `_002` were deleted. Without `rollOnFileSizeLimit`, a file that reaches `fileSizeLimitBytes` stops accepting events, and it does so silently: the same 120 lines with `rollOnFileSizeLimit: false` left one file of 2099 bytes with 19 lines and nothing on `SelfLog`. Set both. The file sink's `outputTemplate` controls the text format when you do not pass a formatter (`{Timestamp:HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}` produced `14:55:43.192 [INF] line 110 ...`). In containers, the console sink with JSON is usually the only sink you need, since the platform collects stdout.

### LogContext, scopes and enrichers

`LogContext.PushProperty` adds a property to every event written until it is disposed, and it flows across `await`. It only works if `Enrich.FromLogContext()` is configured; without it the property silently never appears. The middleware of the lab:

```csharp
using (LogContext.PushProperty("Tenant", tenant))
{
    await next(context);
}
```

`ILogger.BeginScope` also reaches Serilog. I opened a template scope, a dictionary scope, a plain string scope and a `LogContext` property, and logged once:

```text
props=[SourceContext="Shop.Orders", CartId="c-7", Tenant="acme", Scope=["Checkout c-7", "plain text scope"], FromContext=1, Application="shop"]
```

Template and dictionary scopes became properties (`CartId`, `Tenant`), plain strings went into a `Scope` array, and `FromContext` appeared once `FromLogContext` was on. Unlike the console provider, no `IncludeScopes` switch is involved. Put the middleware that pushes the property before `UseSerilogRequestLogging`, so the summary line has it too, or set it explicitly with `EnrichDiagnosticContext`.

Enrichers add properties from outside the call. They come from code (`Enrich.WithProperty`, `Enrich.With(new MyEnricher())`), from packages, or from configuration. With `Serilog.Enrichers.Environment`:

```json
"Enrich": [ "WithMachineName" ], "Properties": { "Application": "shop-api" }
```

```text
{"@t":"2026-11-12T14:55:43.3161460Z","@mt":"with enrichers","MachineName":"Alexandros-MacBook-Pro-2","Application":"shop-api"}
```

This experiment had no `Using` section and still found the console sink and the enricher, since their packages are referenced by the project (the Settings.Configuration README says it scans the dependency context); list them in `Using` when an assembly is not discovered that way. Machine names and process ids are the usual enrichers. Put the version, environment and service name in `Properties` or in the OpenTelemetry resource attributes, once.

### Request logging

`app.UseSerilogRequestLogging()` replaces the several `Microsoft.AspNetCore` lines per request with one event, written when the request finishes: method, path, status and elapsed time, at `Information` (500 and unhandled exceptions at `Error`, with the exception attached; the 404 in my run was `Information`). The throwing endpoint produced:

```json
{"@mt":"HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms","@l":"Error","@x":"System.InvalidOperationException: kaboom\n   at Program...","@tr":"cfb3a8b2...","Tenant":"none","RequestMethod":"GET","RequestPath":"/boom","StatusCode":500,"Elapsed":0.144084}
```

Kestrel then wrote its own `An unhandled exception was thrown by the application` line at `Error`, since `Microsoft.AspNetCore` at `Warning` still lets errors through. `EnrichDiagnosticContext` receives an `IDiagnosticContext` and the `HttpContext`, so you can add the tenant, the user id (not the e-mail) or a header to the summary. Middleware registered before `UseSerilogRequestLogging` runs outside the summary, so register it after anything you do not want counted (static files, for example). Compared with the ASP.NET Core HTTP logging middleware, this is one line per request with no headers and no bodies; use HTTP logging when you need those, and see the HTTP logging concept for its costs.

### Redacting what must not reach the sink

Masking in a destructuring policy covers objects you destructure. For values passed as parameters, `Microsoft.Extensions.Compliance.Redaction` works through a `[LoggerMessage]` method and sits in front of any provider. I ran it with the Serilog provider and an in-memory sink, with a `[Pii.Private]` attribute on the parameter and a redactor that writes `*****`:

```text
msg='Signup for "*****"' props=[Email="*****", EventId={ Id: 2000, Name: "Signup" }, SourceContext="Program"]
msg='plain "ana@example.com"' props=[Email="ana@example.com", SourceContext="Program"]
```

The classified call arrived redacted in the message and the property, and the plain `LogInformation` call went out untouched: this protects only what is classified and goes through generated methods. The ILogger concept shows the declaration and what happens without `EnableRedaction`. Both techniques are opt-in, so the rest is process: do not log request bodies at `Information`, and keep `Debug` and `Verbose` out of production sinks.

### In-memory sink for tests

A sink is an object with one method. This is the whole test double of the lab:

```csharp
public sealed class InMemorySink : ILogEventSink
{
    private readonly List<LogEvent> _events = [];
    public IReadOnlyList<LogEvent> Events { get { lock (_events) return [.. _events]; } }
    public void Emit(LogEvent logEvent) { lock (_events) _events.Add(logEvent); }
}
```

It is registered with `services.AddSingleton<ILogEventSink>(sink)`, and `ReadFrom.Services` adds it to the production pipeline. A test then asserts on structure:

```csharp
var e = sink.Events.Single(IsFromOrderService);
Assert.Equal("Order {OrderId} placed, total {Total}", e.MessageTemplate.Text);
Assert.Equal("42", e.Properties["OrderId"].ToString());
Assert.Equal("acme", Text(e.Properties["Tenant"]));
```

Eight lab tests passed in about 0.6 s, covering the template and properties, `Tenant` from the `LogContext`, the masked e-mail (and that the clear address is in no rendered message), event id 3001, the request summary, the unhandled exception (500 and the exception on the event), the `Microsoft.AspNetCore` override and the rolling file with its compact JSON line. Property values are `LogEventPropertyValue`: a string is `"out of stock"` with quotes under `ToString()`, a number is bare, an object is a `StructureValue`. Assert on the template text and the properties rather than on the rendered message, because the message changes with culture and wording.

### Serilog and OpenTelemetry logs

The two are not rivals; they sit at different places. Serilog is a provider behind `ILogger`. OpenTelemetry (see the OpenTelemetry concept) is a protocol and an SDK with its own `ILogger` provider that exports logs together with traces and metrics. You can keep Serilog as the logging API and send its events over OTLP with `Serilog.Sinks.OpenTelemetry`. I pointed that sink at a local HTTP listener standing in for a collector, inside an `Activity`, with a `service.name` resource attribute and a `Tenant` enricher:

```text
POST /v1/logs content-type=application/x-protobuf bytes=402
printable: service.name shop-api, telemetry.sdk.name serilog, telemetry.sdk.version 4.2.0..., Information, Order 42 placed, OrderId, Tenant acme, message_template.text Order {OrderId} placed
trace id bytes present: True
```

The body was OTLP protobuf. The rendered message became the log body, the template placeholders and the enriched properties became attributes, the template was kept as `message_template.text`, and the trace id of the active `Activity` was in the record, so the log can be joined to its trace. What you gain is the Serilog ecosystem of enrichers and destructuring in front of an OTLP backend. What you lose is one pipeline: you configure Serilog and the OpenTelemetry SDK for traces and metrics separately, and resource attributes in two places. A rule of thumb, which is a judgment and not a measurement: new service, one backend, no Serilog sinks you depend on, stay with `ILogger` and the OpenTelemetry provider; existing Serilog configuration, custom sinks, or destructuring policies you rely on, keep Serilog and add the OTLP sink or console JSON that your platform collects.

## Trade-offs

- **Serilog is a dependency and a second configuration system.** The `Serilog` section and `Logging:LogLevel` are unrelated; with `UseSerilog` the `Logging` section no longer decides what is written: with `Logging__LogLevel__Default=Error` in the environment the order line and the request summary at `Information` were still written. Keep one source of truth and delete the other.
- **Silent failure is the default.** A misspelled sink, a missing template argument or a full disk produced no exception, only `SelfLog` output. Enable `SelfLog` in development and test the file and the critical properties.
- **Destructuring (`@`) can leak.** It serializes every public property. Prefer explicit properties, `Destructure.ByTransforming`, or `[LogProperties]` with redaction for sensitive types.
- **`LogContext` needs `Enrich.FromLogContext()`.** Forgetting it loses the properties with no warning; a test on the property catches it.
- **Prefer `[LoggerMessage]` on hot paths.** Templates through `ILogger` still allocate when the level is off (see the ILogger concept); the generated method keeps the structure and the event id.
- **Rolling needs both limits.** `rollingInterval` for dates, `rollOnFileSizeLimit` for size, `retainedFileCountLimit` for disk. Files can end slightly over the limit.
- **Console JSON beats files in containers.** Files make sense on VMs and for audits; on Kubernetes the platform already rotates and ships stdout.
- **A static `Log.Logger` is shared state.** Use `ILogger<T>` in application code and keep the static logger for startup and shutdown.

## Documentation Links

- [Structured Data, Serilog wiki](https://github.com/serilog/serilog/wiki/Structured-Data) (doc)
- [serilog-aspnetcore, GitHub](https://github.com/serilog/serilog-aspnetcore) (doc)
- [serilog-settings-configuration, GitHub](https://github.com/serilog/serilog-settings-configuration) (doc)
- [serilog-sinks-file, GitHub](https://github.com/serilog/serilog-sinks-file) (doc)
- [serilog-formatting-compact, GitHub](https://github.com/serilog/serilog-formatting-compact) (doc)
- [serilog-sinks-opentelemetry, GitHub](https://github.com/serilog/serilog-sinks-opentelemetry) (doc)
- [Logging in C# and .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
