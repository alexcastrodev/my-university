---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

`ILogger` looks trivial (inject it, call `LogInformation`), and that is why it is used badly: interpolated strings that throw away structure, a `Logging` section nobody can explain, `Debug` lines that cost allocations even when they are off, and personal data written in clear text. A small set of rules decides everything: every logger has a category, every provider picks one filter rule per category, the message is a template whose placeholders become fields, scopes attach context to every line inside them, and the source generator removes the cost of a disabled call. This concept runs each rule on .NET 10 with an in-memory provider and the console provider, and shows what was emitted, what was dropped, what threw and what allocated. Versions used: SDK 10.0.100, Microsoft.Extensions.Logging 10.0.14 (through Microsoft.Extensions.Hosting 10.0.14), Microsoft.Extensions.Telemetry and Microsoft.Extensions.Compliance.Redaction 10.11.0.

## Use Cases

- Turning on `Debug` for one namespace in production, through configuration, without drowning in framework logs.
- Sending verbose logs to one provider and only warnings to another.
- Making every line of a request or a background job carry the same order id, tenant or trace id.
- Logging on a hot path without paying for filtered-out messages, and without leaking e-mails into the log store.

## Deep Dive

### The category: ILogger<T> and ILoggerFactory

Every logger has a category, a string that travels with each message and is the key for filtering. `ILogger<T>` uses the full name of `T`; `ILoggerFactory.CreateLogger(string)` lets you choose it. I logged once through each way of getting a logger:

```text
Shop.Orders.OrderService                 from ILogger<OrderService>
Shop.Orders.OrderService.Validator       nested type
Shop.Orders.Repository                   generic type
Shop.Orders.Checkout                     CreateLogger(string)
Shop.Orders.OrderService                 CreateLogger<T>()
Shop.Orders.OrderService                 CreateLogger(Type)
ILogger<T> twice same instance: True
```

A nested type (`ILogger<OrderService.Validator>`) uses a dot, not the CLR `+`, and a generic type (`ILogger<Repository<Order>>`) loses its type arguments, so `Repository<Order>` and `Repository<Customer>` share one category. `ILogger<T>` is a singleton (`Logger<T>`), so injecting it is cheap. Use `ILogger<T>` by default, and `CreateLogger("Shop.Orders.Checkout")` when you want a sub-category you can filter separately, or one category shared by several classes.

### Levels and the default minimum

The levels are `Trace` (0), `Debug` (1), `Information` (2), `Warning` (3), `Error` (4), `Critical` (5) and `None` (6); a rule enables its level and everything above. With nothing configured, both `LoggerFactory.Create` and a host without appsettings gave `IsEnabled(Debug)=False` and `IsEnabled(Information)=True`: the fallback is `Information`, as the docs say, and `SetMinimumLevel` changes it. The docs also warn that `Trace` may contain sensitive data and should not be enabled in production.

### How one rule is chosen

For each provider and category the factory picks exactly one rule. The docs give the algorithm: keep the rules for that provider (alias or full type name), or if there are none, the rules with no provider; among those keep the longest matching category prefix, or the rules with no category; if several remain, take the last. I registered the console provider and an in-memory provider of mine marked `[ProviderAlias("Recorder")]`:

```json
"Logging": {
  "LogLevel": { "Default": "Information", "Microsoft": "Warning", "Microsoft.Hosting.Lifetime": "Information",
                "Shop": "Debug", "Shop.Payments": "Error" },
  "Recorder": { "LogLevel": { "Default": "Warning", "Shop.Orders": "Trace" } }
}
```

I wrote one message at every level for each category and kept the lowest level that reached each provider:

```text
category                                          Console      Recorder
Microsoft.AspNetCore.Routing.EndpointMiddleware   Warning      Warning
Microsoft.Hosting.Lifetime                        Information  Warning
Shop.Orders.OrderService                          Debug        Trace
Shop.Payments.CardGateway                         Error        Warning
Shopping.Cart                                     Debug        Warning
shop.payments.lowercase                           Error        Warning
MyApp.Worker                                      Information  Warning
```

The longest prefix wins (`Microsoft.Hosting.Lifetime` beats `Microsoft`). Matching ignores case. The prefix is a plain string prefix with no dot boundary: the `Shop` rule also enabled `Debug` for `Shopping.Cart`. And once a provider has its own section, the general section no longer applies to it at all: the Recorder got `Warning` for `Shop.Payments.CardGateway` and `Microsoft.Hosting.Lifetime`, because its own `Default` is a provider match, and provider matches are considered before any general rule. The built-in aliases are `Console`, `Debug`, `EventSource` and `EventLog`, so `Logging:Console:LogLevel` behaves the same way.

### Rules in code: AddFilter, wildcards, filter functions

Rules added in code join the same list. In a host, configuration is registered first and `builder.Logging.AddFilter` afterwards, so for the same category the code rule comes last and wins. A category may contain one `*`:

```csharp
// configuration: Default=Information, Shop=Debug
builder.Logging.AddFilter("Shop", LogLevel.Error);
builder.Logging.AddFilter("Shop.*.Db", LogLevel.Trace);
```

```text
Shop.Orders.OrderService     min=Error
Shop.Orders.Db               min=Trace
Shop.Billing.Db              min=Trace
Other                        min=Information
```

`AddFilter((provider, category, level) => level >= LogLevel.Warning)` creates a rule with no provider and no category, so it only competes with `Default`. With the same configuration, `Other` went to `min=Warning` while `Shop.Orders.OrderService` stayed at `min=Debug`: the function replaced `Default` (it came last) and never ran for `Shop`, which had a more specific rule. The docs say the same: it is invoked for providers and categories with no rule from configuration or code.

### The ASP.NET Core template, environment variables and reload

`dotnet new web` on SDK 10.0.100 generates `"LogLevel": { "Default": "Information", "Microsoft.AspNetCore": "Warning" }` in both appsettings files, and the host registered `ConsoleLoggerProvider`, `DebugLoggerProvider` and `EventSourceLoggerProvider` (the docs add `EventLog` on Windows). After a request, the console showed only the `Microsoft.Hosting.Lifetime` lines (`Now listening on`, `Application started`), since that category falls under `Default`. Then I overrode one key from the environment, where `__` replaces `:`:

```bash
env 'Logging__LogLevel__Microsoft.AspNetCore=Information' dotnet run
```

```text
info: Microsoft.AspNetCore.Hosting.Diagnostics[1]
      Request starting HTTP/1.1 GET http://127.0.0.1:5099/ - - -
info: Microsoft.AspNetCore.Hosting.Diagnostics[2]
      Request finished HTTP/1.1 GET http://127.0.0.1:5099/ - 200 - text/plain;+charset=utf-8 15.8861ms
```

Two `Microsoft.AspNetCore.Routing.EndpointMiddleware` lines (`Executing endpoint 'HTTP: GET /'`, `Executed endpoint`) sat between those two. Without `env`, zsh answered `command not found: Logging__LogLevel__Microsoft.AspNetCore=Information`, because shell variable names cannot contain dots; a container's environment section accepts them. Levels also follow configuration reloads: I changed `appsettings.json` from `Default: Information` to `Debug` while a host was running, and the same `ILogger` instance returned `IsEnabled(Debug)=True` about 200 ms later, with no restart.

### EventId

An `EventId` is an `Id` plus an optional `Name`, and an `int` converts to it implicitly:

```csharp
static readonly EventId PaymentDeclined = new(4001, "PaymentDeclined");
log.LogWarning(PaymentDeclined, "Payment for order {OrderId} declined: {Reason}", 42, "insufficient funds");
```

The simple console prints the id in brackets (`warn: Shop.Orders[4001] ...`), and the JSON formatter (`AddJsonConsole`, here inside a dictionary scope) writes it as a field:

```text
{"EventId":4001,"LogLevel":"Warning","Category":"Shop.Orders","Message":"Payment for order 42 declined: insufficient funds","State":{"OrderId":42,"Reason":"insufficient funds","{OriginalFormat}":"Payment for order {OrderId} declined: {Reason}"},"Scopes":[{"Message":"System.Collections.Generic.Dictionary\u00602[System.String,System.Object]","Tenant":"acme"}]}
```

The name appeared in neither console format; it reaches providers that read `EventId.Name`. A stable id lets you query or alert on every declined payment even after the wording changes.

### Message templates are not format strings

Each placeholder becomes a named value in the state the provider receives, plus `{OriginalFormat}`. I logged five calls and my recorder printed event id, message and state:

```csharp
log.LogInformation(AppLogEvents.OrderPlaced, "Order {OrderId} placed, total {Total}", id, total);
log.LogInformation($"Order {id} placed, total {total}");
log.LogInformation("Parameter values: {B}, {A}", "a", "b");
log.LogInformation("Paid {Amount:F2} at {When:yyyy-MM-dd}", 9.9, new DateTime(2026, 10, 28));
log.LogInformation("User {@User} and {$Obj}", new { Name = "ana" }, 3);
```

```text
[1000:OrderPlaced] msg='Order 42 placed, total 9.90'
      state: OrderId=42, Total=9.90, {OriginalFormat}=Order {OrderId} placed, total {Total}
[0:] msg='Order 42 placed, total 9.90'
      state: {OriginalFormat}=Order 42 placed, total 9.90
[0:] msg='Parameter values: a, b'
      state: B=a, A=b, {OriginalFormat}=Parameter values: {B}, {A}
[0:] msg='Paid 9.90 at 2026-10-28'
      state: Amount=9.9, When=10/28/2026 12:00:00 AM, {OriginalFormat}=Paid {Amount:F2} at {When:yyyy-MM-dd}
[0:] msg='User { Name = ana } and 3'
      state: @User={ Name = ana }, $Obj=3, {OriginalFormat}=User {@User} and {$Obj}
```

Interpolation gives the same text but no fields, and a different "template" per order, so the log store can no longer group by `OrderId`. Placeholders bind by position, not by name. A format specifier changes only the text; the state keeps the raw value. The Serilog `@` prefix means nothing to the built-in providers, it just becomes part of the key. A missing argument is worse:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", 42);   // one argument short
```

```text
AggregateException: An error occurred while writing to logger(s). (Index (zero based) must be greater than or equal to zero and less than the size of the argument list.)
```

The exception came out of the logging call, and only when the level was enabled: the same call with `LogDebug` (disabled) did nothing, so the bug hides until someone turns `Debug` on. An extra argument was silently dropped. The build warned on both by default with CA2017 ("Number of parameters supplied in the logging message template do not match the number of named placeholders").

### CA2254 and the cost of a disabled log

CA2254 flags a non-constant template. On .NET 10 it is enabled only "as suggestion", so a plain `dotnet build` printed nothing for `LogInformation($"Order {id} placed")`. With `dotnet_diagnostic.CA2254.severity = warning` in `.editorconfig`:

```text
Program.cs(9,20): warning CA2254: The logging message template should not vary between calls to 'LoggerExtensions.LogInformation(ILogger, string?, params object?[])'
```

I timed 1,000,000 calls per variant (Release) against a provider that accepts everything but never builds the string or does I/O, minimum level `Information`:

```text
template, Debug disabled                 96.0 B/call    71.3 ns/call
interpolated, Debug disabled            112.0 B/call   152.0 ns/call
IsEnabled guard + template                0.0 B/call    11.6 ns/call
[LoggerMessage], Debug disabled           0.0 B/call    11.6 ns/call
template, Information enabled            96.0 B/call    91.1 ns/call
interpolated, Information enabled       115.5 B/call   175.2 ns/call
[LoggerMessage], Information enabled      0.0 B/call    51.2 ns/call
```

A disabled `LogDebug` with a template still allocated 96 bytes: the `params object[]`, a boxed `int` and a boxed `decimal`, all created before the logger can say no. Interpolation was worse, because the string is built before the call. A real provider adds the cost of formatting the message.

### Scopes

`BeginScope` returns an `IDisposable`; every log written before it is disposed carries the scope's state, scopes nest, and they flow across `await` (a log inside `Task.Run` after an `await` still printed `=> Order 42`). The console formatter needs `IncludeScopes = true` (off by default; without it the scope did not appear):

```csharp
using (log.BeginScope("Checkout {CartId}", "c-7"))
using (log.BeginScope(new Dictionary<string, object> { ["Tenant"] = "acme", ["UserId"] = 12 }))
    log.LogInformation("Order {OrderId} placed", 42);
```

```text
info: Shop.Orders[0] => Checkout c-7 => System.Collections.Generic.Dictionary`2[System.String,System.Object] Order 42 placed
```

The template scope was readable; the dictionary printed its type name, and so did the docs' own sample shape, a `List<KeyValuePair<string, object>>`. Structured providers do read the pairs: the JSON formatter wrote `"Tenant":"acme"` inside `Scopes` (see the EventId example), and my recorder saw `{CartId=c-7, {OriginalFormat}=Checkout {CartId}}`. Prefer the template form, readable in both. `builder.Logging.Configure(o => o.ActivityTrackingOptions = ActivityTrackingOptions.TraceId | ActivityTrackingOptions.SpanId)` adds the current `Activity` ids as a scope on every line:

```text
info: Shop.Orders[0] => SpanId:286c56e993c61c8b, TraceId:e205e82043529929c59329d453d8067e inside activity e205e82043529929c59329d453d8067e
```

### Source-generated logging with [LoggerMessage]

The generator writes the body of a `partial` method at compile time. For this declaration it emitted the code below (shortened):

```csharp
[LoggerMessage(EventId = 1001, Level = LogLevel.Debug, Message = "Order {OrderId} placed, total {Total}")]
public static partial void OrderDebug(this ILogger logger, int orderId, decimal total);

// generated
private static readonly Action<ILogger, int, decimal, Exception?> __OrderDebugCallback =
    LoggerMessage.Define<int, decimal>(LogLevel.Debug, new EventId(1001, nameof(OrderDebug)), "Order {OrderId} placed, total {Total}", ...);
public static partial void OrderDebug(this ILogger logger, int orderId, decimal total)
{ if (logger.IsEnabled(LogLevel.Debug)) __OrderDebugCallback(logger, orderId, total, null); }
```

The template is parsed once, the arguments stay strongly typed (no array, no boxing) and `IsEnabled` is checked first, which is where the 0 B in the table comes from. Per the docs, placeholders here bind to parameters by name, not position, and the comparison ignores case. The generator also checks your work:

```text
warning SYSLIB1015: Argument 'extra' is not referenced from the logging message
error SYSLIB1014: Template 'Missing' is not provided as argument to the logging method
warning SYSLIB1025: Multiple logging methods are using event name Same in class Diag
```

Two methods with the same `EventId` and different names produced no warning: the duplicate-id diagnostic the docs mention (SYSLIB1006) did not fire with Microsoft.Extensions.Logging 10.0.14. Without `EventId`, the generator derived one from the method name (`new EventId(1052509500, nameof(OrderDebug2))`), so set ids explicitly if you alert on them. The `IsEnabled` check does not protect the arguments: `log.OrderDebug2(Expensive())` still called `Expensive()` with `Debug` off (`calls=1`). And referencing Microsoft.Extensions.Telemetry 10.11.0 swaps in another generator (`Microsoft.Gen.Logging`) that stores arguments in a tag array: there the enabled call allocated 56 B (the two boxed values), the disabled one still 0 B.

### Redacting classified data

Microsoft.Extensions.Compliance.Redaction and Microsoft.Extensions.Telemetry add data classification to logging: declare a classification and its attribute, mark parameters (or properties of an object logged with `[LogProperties]`), and register a redactor per classification:

```csharp
[LoggerMessage(2000, LogLevel.Information, "Signup for {Email}")]
public static partial void Signup(this ILogger logger, [Pii.Private] string email);
[LoggerMessage(2001, LogLevel.Information, "Customer updated")]
public static partial void CustomerUpdated(this ILogger logger, [LogProperties] Customer customer); // Email is [Pii.Private]

services.AddLogging(b => b.EnableRedaction());
services.AddRedaction(r => r.SetRedactor<StarRedactor>(Pii.Private));
```

```text
--- no EnableRedaction
msg='Signup for (null)' state: {OriginalFormat}=Signup for {Email}
msg='Customer updated' state: customer.Id=7, {OriginalFormat}=Customer updated
--- EnableRedaction, no redactor set
msg='Signup for ' state: Email=, {OriginalFormat}=Signup for {Email}
--- EnableRedaction + StarRedactor
msg='Signup for *****' state: Email=*****, {OriginalFormat}=Signup for {Email}
msg='Customer updated' state: customer.Email=*****, customer.Id=7, {OriginalFormat}=Customer updated
```

The e-mail never reached the provider: without `EnableRedaction` the classified value was dropped entirely, and with no matching redactor the fallback erased it. `[LogProperties]` flattened the object into `customer.Id` and `customer.Email`. This works only through `[LoggerMessage]` methods; a plain `LogInformation("... {Email}", email)` knows nothing about classifications.

## Trade-offs

- **Templates over interpolation, always.** Interpolation loses the fields, allocates even when the level is off, and slips past CA2254 unless you raise its severity.
  ```ini
  dotnet_diagnostic.CA2254.severity = warning
  ```
- **`[LoggerMessage]` costs a declaration per message.** Worth it on hot paths and for messages you query by id; a log written once at startup is fine as a template call.
- **Category prefixes are plain strings.** `Shop` also matches `Shopping.Cart`. A trailing dot works as a boundary, at the price of not matching `Shop` itself:
  ```text
  rule 'Shop.' -> Shop: Debug enabled=False
  rule 'Shop.' -> Shop.Orders: Debug enabled=True
  rule 'Shop.' -> Shopping.Cart: Debug enabled=False
  ```
- **A provider section replaces the general one for that provider.** Repeat in it every category that provider needs, or it falls back to its own `Default`.
- **Lower levels cost money at the sink.** `Debug` everywhere floods storage; enable it per category and temporarily, through a configuration reload or an environment variable.
- **Scopes are only as good as the provider that prints them.** The console needs `IncludeScopes` and prints dictionary scopes as type names; structured providers read them as fields.
- **Redaction is opt-in per parameter.** It protects what is classified and passed through generated methods; anything concatenated into a message goes out as written.

## Documentation Links

- [Logging in C# and .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation) (doc)
- [Logging providers in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/providers) (doc)
- [CA2254: Template should be a static expression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2254) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [Logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/?view=aspnetcore-10.0) (doc)
