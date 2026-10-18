---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A call to another service fails in ways your code cannot prevent: a 503 during a deploy, a connection that hangs, a dependency that is down for a minute. Resilience policies decide what happens next: try again, give up early, stop calling for a while, or ask a second server. In .NET this is done with the `Microsoft.Extensions.Http.Resilience` package, which puts Polly v8 strategies on an `HttpClient` created by `IHttpClientFactory`. This concept runs every strategy against a local server that fails on demand, reports what the server really received, and shows the case where the default is dangerous (retrying a POST). Versions used: SDK 10.0.100, `Microsoft.Extensions.Http.Resilience` 10.11.0, which resolved `Polly.Core` 8.4.2.

## Use Cases

- Calling a payment, catalog or identity service that sometimes answers 503 or times out.
- Stopping a slow dependency from tying up all of your request threads and connections.
- Reducing tail latency for a safe read by asking a second endpoint when the first is slow.
- Deciding, per client, which requests may be repeated and which must not.

## Deep Dive

### One call adds a pipeline

It builds on the factory from the HttpClient concept: you chain onto the builder that `AddHttpClient` returns.

```text
dotnet add package Microsoft.Extensions.Http.Resilience
```

```csharp
builder.Services.AddHttpClient("orders", c => c.BaseAddress = new Uri("http://localhost:5402"))
    .AddStandardResilienceHandler();
```

The docs say to add only one resilience handler per client and not to stack them. The standard handler chains five strategies, outermost first. I read the real option values back from `IOptionsMonitor<HttpStandardResilienceOptions>`:

```text
rate limiter   permits=1000 queue=0
total timeout  30 s
retry          3 retries, delay 2 s, Exponential, jitter on
circuit breaker  failure ratio 0.1, min throughput 100, sampling 30 s, break 5 s
attempt timeout  10 s
```

This matches the table in the docs. What the retry and breaker treat as a failure, per the docs, is a status of 500 and above, 408 or 429, plus `HttpRequestException` and Polly's `TimeoutRejectedException`.

### Retries: what actually happens

Against an endpoint that always answers 503, a GET with the defaults made **4 requests** (1 plus 3 retries) and then returned the last response. It did not throw: `status 503`. The delays are exponential with jitter, so the total varied between runs, 6.4 s in one and 9.3 s in another. Log lines from Polly show each attempt (category `Polly`, Warning):

```text
warn: Polly[0] Resilience event occurred. EventName: 'OnRetry', Source: 'std-default-standard//Standard-Retry', Result: '503'
fail: Polly[3] Execution attempt. ... Result: '503', Handled: 'True', Attempt: '3'
```

With `Retry.Delay` lowered to 100 ms and an endpoint that fails twice, the third attempt succeeded: `status 200 "ok after 3 attempts"` in 217 ms. The default also honors `Retry-After`: the option read `ShouldRetryAfterHeader = True`, and a 429 with `Retry-After: 2` made the retry wait 2096 ms even though `Retry.Delay` was 100 ms.

### The dangerous default: retrying a POST

The docs say it plainly: by default the handler retries all HTTP methods. I posted an order to an endpoint that fails twice:

```text
POST default:                      status 200, server hits: 3, body '{"item":"book"}' x3
POST + Retry.DisableForUnsafeHttpMethods(): status 503, server hits: 1
```

Three POSTs reached the server, each with its body, so a server that creates a row per POST would have created three. `DisableForUnsafeHttpMethods()` (POST, PATCH, PUT, DELETE and CONNECT per the docs) removed the retries. `DisableFor(HttpMethod.Post)` is the narrower form. The real fix for a write is to make it idempotent on the server, as in the REST semantics concept, for instance with a client-supplied key the server deduplicates, and only then allow retries.

### Timeouts: attempt versus total

Two timeouts exist. The attempt timeout limits each try, and the total timeout limits everything including retries. With an attempt timeout of 300 ms, 2 retries and a total of 5 s against an endpoint that sleeps 5 s:

```text
Polly.Timeout.TimeoutRejectedException: The operation didn't complete within the allowed timeout of '00:00:00.3000000'.
server hits: 3, each logged "client aborted", 1197 ms total
```

Three things follow. The exception is Polly's `TimeoutRejectedException`, not `TimeoutException` (the docs warn about this when you write your own `ShouldHandle`). A timed-out attempt is retried like a 503. And the server saw the client abort each attempt, so a handler that honors `RequestAborted` stops working instead of finishing work nobody will read.

### Circuit breaker: stop calling

A breaker opens after enough recent failures and then fails fast without touching the network. With retries off, an attempt timeout of 1 s, sampling 10 s, minimum throughput 5, ratio 0.5 and a 3 s break, eight calls to an always-503 endpoint gave:

```text
req 1..5: 503   (server hits 1..5)
req 6..8: BrokenCircuitException   (server hits stay at 5)
after 3.2 s: 200 (a probe call reached a healthy endpoint, breaker closed)
next: 200
```

Calls 6 to 8 never left the process. After the break duration the next call is let through as a probe and its success closed the circuit. The defaults need 100 requests in 30 s before the breaker can open, so on a low-traffic service it practically never trips; tune `MinimumThroughput` to your traffic. Callers must catch `BrokenCircuitException` and degrade (cached data, a clear error) instead of treating it as a bug.

### Hedging: ask twice

`AddStandardHedgingHandler` is the alternative to retry for latency: if the first request is slow, send another without cancelling the first, and take the first good answer. The option read back was `Hedging.Delay = 2 s` and `MaxHedgedAttempts = 1`. With `Delay` set to 200 ms against an endpoint whose first request sleeps 3 s:

```text
status 200 'answer from attempt 2' after 219 ms
server hits: 2, "attempt 1 cancelled after 208 ms"
```

The slow attempt was cancelled once the fast one won. Hedging doubles load on a slow dependency and can send the same request twice, so use it only for safe, idempotent reads.

### Custom pipelines and order

`AddResilienceHandler("name", builder => ...)` builds your own pipeline, and strategies run in the order you add them, first one outermost. I added a 1 s timeout, then a retry (3 attempts, 50 ms), then a 300 ms timeout:

```text
TimeoutRejectedException: ... allowed timeout of '00:00:01'. | server hits: 3 | 1221 ms
```

The outer timeout capped the whole sequence at about one second while the inner one limited each attempt. Putting the strategies in the wrong order silently changes what the numbers mean.

## Trade-offs

- **Retries multiply load.** Three retries turn one failing call into four, from every caller at once. Keep the retry count low and the delay exponential with jitter, which is the default.
  ```csharp
  options.Retry.MaxRetryAttempts = 2;
  ```
- **Retrying writes is a correctness decision.** Disable unsafe methods or make the endpoint idempotent first.
  ```csharp
  options.Retry.DisableForUnsafeHttpMethods();
  ```
- **The defaults suit mid-traffic services.** A breaker that needs 100 calls in 30 s never opens on a quiet client; a 30 s total timeout may be longer than your own caller waits.
- **Hedging trades load for latency.** Good for a fast read replica, bad for a dependency that is already struggling.
- **A breaker moves the failure, it does not remove it.** You still have to decide what the caller sees while it is open.
- **One handler per client.** The docs advise against stacking resilience handlers; to swap one for another, call `RemoveAllResilienceHandlers()` first.
  ```csharp
  services.AddHttpClient("custom").RemoveAllResilienceHandlers().AddStandardHedgingHandler();
  ```

## Lab

In this lab you get two named HTTP clients, `orders` and `catalog`, with no resilience at all. Your job is to configure `Microsoft.Extensions.Http.Resilience` (Polly v8) on them and observe what each strategy does to the number of requests that reach the server. The core idea is to feel that retry, timeout and circuit breaker are not decoration: each one changes the call count, and misconfigured they get in each other's way (a retried POST can create three orders, a breaker that never opens protects nobody).

**The scenario**

No network and no real server. The tests use `ScriptedHandler`, an in-process `HttpMessageHandler` that counts hits (`Hits`) and answers 503, hangs or recovers on demand.

- `ResilienceClients.cs`: everything you touch is here. `AddOrdersClient` and `ConfigureOrders` (retries and timeouts), `AddCatalogClient` and `ConfigureCatalog` (circuit breaker), and two optional clients, `pricing` and `strict`.

Read the validation errors the options throw carefully: they are part of the lesson (for example, the breaker's `SamplingDuration` must be at least twice the attempt timeout, and `MaxRetryAttempts` cannot be 0).

**What you will do, step by step**

1. **Add the standard handler (TODO-00 and TODO-01).** In `AddOrdersClient` and `AddCatalogClient`, add the standard resilience handler, configured by `ConfigureOrders` and `ConfigureCatalog` respectively.
2. **Configure the `orders` retries (TODO-02 and TODO-03).** Allow 2 retries with a 10 ms base delay (the tests must stay fast) and never retry unsafe methods such as POST.
3. **Configure the `orders` timeouts (TODO-04).** Attempt timeout 300 ms, total timeout 5 s and breaker `SamplingDuration` 10 s, to satisfy the validation rule.
4. **Turn off GET retries on `catalog` (TODO-05).** `MaxRetryAttempts` cannot be 0: find the method that disables retries for a verb, so the breaker sees each failure once.
5. **Tune the circuit breaker (TODO-06).** Attempt timeout 1 s, total 5 s, and a breaker that opens after 5 calls when at least half failed within 10 s, staying open for 1 s. The default `MinimumThroughput` is 100, which is why it would never open in the tests.

**How you know you are done**

`dotnet test` is all green. You should be able to explain, by looking at `Hits`, why a GET that fails twice reaches 3 hits, why a POST stays at 1, why an open circuit throws `BrokenCircuitException` without touching the server and how it closes again after a probe succeeds.

**Optional challenges**

- **TODO-07:** on `pricing`, use `AddStandardHedgingHandler` (sends a second request after 100 ms of silence, at most one extra attempt).
- **TODO-08:** on `strict`, build a custom pipeline named "strict" with `AddResilienceHandler`: outer timeout 1 s, then a retry (3 attempts, 50 ms) and an inner timeout of 300 ms. Order matters: the first strategy added is the outermost.

**Prerequisites:** `IHttpClientFactory` and named clients (the HttpClient lab), idempotency of HTTP methods and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. In the starter state the clients have no resilience, so the tests that depend on retry, timeout or breaker fail until you complete the TODOs marked in comments in `ResilienceClients.cs`.

## Documentation Links

- [Build resilient HTTP apps: Key development patterns, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [Introduction to resilient app development, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/) (doc)
- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [Polly documentation: Retry strategy](https://www.pollydocs.org/strategies/retry.html) (doc)
- [Polly documentation: Circuit breaker strategy](https://www.pollydocs.org/strategies/circuit-breaker.html) (doc)
- [Polly documentation: Hedging strategy](https://www.pollydocs.org/strategies/hedging.html) (doc)
