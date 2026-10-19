---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

Code that calls another service over HTTP has two parts worth testing: what it
does with each kind of answer (a quote, a 400, a 503, a timeout, a cancelled
call), and what the resilience pipeline around it promises (how many attempts,
what each attempt sends, when the circuit opens). Both can be tested without a
server and without waiting: replace the last `HttpMessageHandler` with a
hand-written fake, keep the real handler chain and the real pipeline, and give
the pipeline a fake clock. The goal is a suite that runs in milliseconds and
turns red when someone deletes the retry, reorders the handlers or turns a
cancellation into a "timeout".

## Use Cases

- Proving that a typed client maps 4xx, 5xx, timeouts and cancellation to the
  results its callers expect, and that a 4xx is not retried.
- Proving that a retry sends the same idempotency key and the same body on
  every attempt.
- Testing `AddResilienceHandler` options (retry count, attempt timeout,
  circuit breaker) without sleeping for seconds per test.
- Testing a `DelegatingHandler` alone and in its place in the chain.
- Removing a stub server or a mocking library from a slow HTTP test suite.

## Deep Dive

### The fake is the last hop, written by hand

`HttpClient` sends through a chain of handlers. The last one normally opens a
socket; in a test it can be any `HttpMessageHandler`. A scripted fake is a
queue of answers and a record of what each attempt sent:

```csharp
internal sealed class FakeFreightApi : HttpMessageHandler
{
    private readonly ConcurrentQueue<Func<CancellationToken, Task<HttpResponseMessage>>> _script = new();
    private readonly ConcurrentQueue<SentRequest> _sent = new();

    public IReadOnlyList<SentRequest> Sent => _sent.ToArray();

    public FakeFreightApi Respond(HttpStatusCode status, string? json = null) { /* enqueue */ return this; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // ... snapshot the attempt (next sections) ...
        if (!_script.TryDequeue(out var answer))
        {
            Assert.Fail($"Unscripted request: {request.Method} {request.RequestUri}");
        }

        return await answer(cancellationToken);
    }
}
```

The `Assert.Fail` matters. A fake that answers 200 to anything makes "the client
retries a 503 until it succeeds" green with the retry deleted, because the first
attempt already succeeds. Script exactly the answers the scenario needs, and
assert the number of attempts:

```csharp
_api.Respond(HttpStatusCode.ServiceUnavailable).Respond(HttpStatusCode.TooManyRequests).Respond(HttpStatusCode.OK, QuoteJson);

var result = await RunAsync(_client.GetQuoteAsync(Request, Token));

Assert.AreEqual(FreightOutcome.Ok, result.Outcome);
Assert.HasCount(3, _api.Sent); // without this line a fake that always answers 200 passes too
```

### The typed client in a test ServiceCollection

Keep everything the production registration builds and swap only the primary
handler. `AddResilienceHandler` returns an `IHttpResiliencePipelineBuilder`, not
the `IHttpClientBuilder`, so `.ConfigurePrimaryHttpMessageHandler(...)` cannot
be chained after it (it is a compile error). The lab's registration method
returns the client builder for that reason:

```csharp
public static IHttpClientBuilder AddFreightClient(this IServiceCollection services, Uri baseAddress)
{
    var builder = services.AddHttpClient<FreightClient>(client => client.BaseAddress = baseAddress);
    builder.AddHttpMessageHandler(() => new IdempotencyKeyHandler()); // outermost: once per call
    builder.AddResilienceHandler("freight", pipeline => pipeline
        .AddRetry(new HttpRetryStrategyOptions { MaxRetryAttempts = 2, Delay = TimeSpan.FromSeconds(1) })
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5, MinimumThroughput = 4,
            SamplingDuration = TimeSpan.FromSeconds(30), BreakDuration = TimeSpan.FromSeconds(30),
        })
        .AddTimeout(TimeSpan.FromSeconds(2)));
    return builder;
}
```

The test then wires the fake clock and the fake API:

```csharp
var services = new ServiceCollection();
services.AddSingleton<TimeProvider>(_time); // the resilience pipeline picks it up from here
services.AddFreightClient(new Uri("http://freight.test/"))
    .ConfigurePrimaryHttpMessageHandler(() => _api); // replaces only the last hop
_services = services.BuildServiceProvider();
_client = _services.GetRequiredService<FreightClient>();
```

Why does the pipeline see `_time`? `AddResilienceHandler` registers the
pipeline through Polly's `AddResiliencePipeline`, and Polly's builder sets
`builder.TimeProvider` from the container when a `TimeProvider` is registered
(it is in `PollyServiceCollectionExtensions`). Every retry delay, attempt
timeout and break duration then runs on the fake clock.

One compile-time surprise: with the `Microsoft.VisualStudio.TestTools.UnitTesting`
global using, `DelayBackoffType` is ambiguous between Polly and MSTest (CS0104),
because MSTest 4 has its own for `[Retry]`. Write `Polly.DelayBackoffType` or add
an alias.

### Drive the fake clock

A `FakeTimeProvider` moves only when the test calls `Advance`. A test that
simply awaits a call with a retry delay waits until something else gives up:
`HttpClient.Timeout`, 100 seconds by default, which does not use
`TimeProvider`. A scratch call that nobody drove ended after 1 min 40 s with a
`TaskCanceledException`. Advance in small steps until the call completes:

```csharp
private async Task<T> RunAsync<T>(Task<T> call)
{
    await DriveAsync(call);
    Assert.IsTrue(call.IsCompleted, "The call did not complete after 50 seconds of fake time.");
    return await call;
}

private async Task DriveAsync(Task task)
{
    for (var step = 0; step < 200 && !task.IsCompleted; step++)
    {
        _time.Advance(TimeSpan.FromMilliseconds(250));
        await Task.WhenAny(task, Task.Delay(1));
    }
}
```

Small steps keep jitter harmless: the retry here uses the default exponential
backoff with jitter, and the test does not need to know the exact delays.

The same clock bites at the end of a failing test. Before Polly disposes a
pipeline it waits for executions still in flight, in 1 second steps on the
pipeline's `TimeProvider`, and gives up after 30 seconds (Polly's
`ExecutionTrackingComponent`). A test that failed with a call still hanging
made `ServiceProvider.Dispose()` block forever, and the whole run with it. The
fix is to dispose asynchronously while driving the clock:

```csharp
public async ValueTask DisposeAsync() => await DriveAsync(_services.DisposeAsync().AsTask());
```

### Snapshot each attempt: the retry reuses the message

The retry strategy sends the same `HttpRequestMessage` instance again. In a
scratch run with three attempts, the stored messages were one distinct object.
A `DelegatingHandler` that stamped a new key per attempt showed the difference:

```text
keys at send time = 0c4c2b,70074e,4b39ac
keys read from the stored messages after the call = 4b39ac,4b39ac,4b39ac
```

A test that stores the messages and checks "every attempt had the same key"
afterwards is green while the API received three different keys. Copy what you
need inside `SendAsync`, at the moment of the attempt:

```csharp
request.Headers.TryGetValues("Idempotency-Key", out var keys);
_sent.Enqueue(new SentRequest(request.Method, request.RequestUri!.AbsolutePath, body, keys?.Single()));
```

That is also how the chain test proves the handler order. The key handler is
added before `AddResilienceHandler`, so it is outside the retry and runs once
per call. Registered after it, it runs once per attempt; the lab's mutation
check moved it and only this test turned red:

```csharp
Assert.HasCount(3, _api.Sent);
Assert.HasCount(1, _api.Sent.Select(s => s.IdempotencyKey).Distinct());
Assert.HasCount(1, _api.Sent.Select(s => s.Body).Distinct());
```

A `DelegatingHandler` can also be tested alone: set its `InnerHandler` to the
fake and call it through `new HttpMessageInvoker(handler)`.

### Read the body like the wire does

A body that comes from a forward-only stream (an incoming request body being
forwarded, a download) cannot be sent twice. The client in the lab buffers it:

```csharp
using var content = new StreamContent(manifest);
await content.LoadIntoBufferAsync(cancellationToken); // or a retry finds the stream consumed
```

How the fake reads the body decides whether a test can see the difference. A
scratch run, with a 503 and then a 200, against an unbuffered `StreamContent`
over a non-seekable stream:

```text
fake never reads the body:        status=OK, 2 attempts
fake uses ReadAsStringAsync:      status=OK, body sent twice in full
fake uses CopyToAsync:            InvalidOperationException: The stream was already consumed. It cannot be read again.
```

`ReadAsStringAsync` buffers the content as a side effect, so the fake repairs
the bug it should expose. `CopyToAsync` into a `MemoryStream` reads it the way
a transport does:

```csharp
using var copy = new MemoryStream();
await request.Content.CopyToAsync(copy, cancellationToken);
body = Encoding.UTF8.GetString(copy.ToArray());
```

### 4xx, 5xx, timeout and cancellation are different answers

By the docs, the HTTP retry and circuit breaker treat 500 and above, 408, 429,
`HttpRequestException` and Polly's `TimeoutRejectedException` as transient. In
scratch runs:

| Situation | What reached the client code |
| --- | --- |
| 400 | the 400 response, after 1 attempt |
| 503 three times (2 retries) | the last 503 response, after 3 attempts |
| attempt slower than `AddTimeout(2 s)` | `Polly.Timeout.TimeoutRejectedException` |
| caller cancels its token | `TaskCanceledException`, no retry |
| `HttpClient.Timeout` expires | `TaskCanceledException` with an inner `TimeoutException` |
| circuit open | `BrokenCircuitException`, not retried by the retry strategy |

The lab's client maps the first four to `Rejected`, `Unavailable("status 503")`,
`Unavailable("timeout")` and a propagated cancellation. The slow attempt is a
fake that waits on the token, and three of them cost no real time:

```csharp
_api.Hang().Hang().Hang(); // each one: await Task.Delay(Timeout.Infinite, token)
var start = _time.GetUtcNow();

var result = await RunAsync(_client.GetQuoteAsync(Request, Token));

Assert.AreEqual(FreightResult.Unavailable("timeout"), result);
Assert.IsGreaterThanOrEqualTo(TimeSpan.FromSeconds(6), _time.GetUtcNow() - start); // on the fake clock
```

A slow fake that ignores the token (`Task.Delay(TimeSpan.FromSeconds(10))`)
keeps running after the timeout and takes real time. For cancellation,
`Assert.ThrowsAsync<OperationCanceledException>` is the right assertion
because it accepts the derived `TaskCanceledException`;
`ThrowsExactlyAsync<OperationCanceledException>` would not. A 200 whose body
does not match the contract is not an outage either: `ReadFromJsonAsync`
throws `JsonException`, and the test expects it with `ThrowsExactlyAsync`.

### The circuit opens

With a failure ratio of 0.5 and a minimum throughput of 4, the breaker opens on
the fourth failed attempt. The retry is outside the breaker, so the first call
makes three attempts, the second call's first attempt opens the circuit, and
the third call never reaches the API:

```csharp
var first = await RunAsync(_client.GetQuoteAsync(Request, Token));  // 3 attempts, all failed
var second = await RunAsync(_client.GetQuoteAsync(Request, Token)); // the 4th failure opens it
var third = await RunAsync(_client.GetQuoteAsync(Request, Token));  // never reaches the API

Assert.AreEqual(FreightResult.Unavailable("circuit open"), third);
Assert.HasCount(4, _api.Sent);
```

Each test builds its own `ServiceProvider`, so each has its own breaker and
tests in parallel do not trip each other's circuits.

### A real server, when you need one

A fake handler never opens a connection, so it cannot test TLS, proxies,
HTTP/2 or how your server-side framework parses a request. WireMock.Net
(Apache-2.0) runs an HTTP server inside the test process: `WireMockServer.Start()`
listened on a localhost port in a scratch test, and stubs are declared with
`Given(Request.Create()...)` and `RespondWith(Response.Create()...)`. It adds a
dependency and a port per test, so keep it to a few tests at the edge.

### Do the tests protect the rules?

Each change below was made to the lab's production code on its own, the suite
was run, and the code was restored:

| Change to the production code | Tests that fail |
| --- | --- |
| The retry handles nothing | 7 of 13, from the retry tests to the manifest test |
| Key handler registered after `AddResilienceHandler` | only the "same key and body" test |
| No attempt timeout | the timeout test |
| No circuit breaker | both circuit tests |
| No `LoadIntoBufferAsync` | the forward-only manifest test |
| Every failure status mapped to `Unavailable` | both `[DataRow]` rows of the 4xx test |
| Cancellation caught and reported as a timeout | the cancellation test |
| `JsonException` caught and reported as an outage | the malformed quote test |

## Trade-offs

- **A fake handler tests your code, not HTTP.** It is fast and deterministic,
  and it never sees a socket, a header the server rejects or a proxy. Keep a
  handful of tests against a real server (WireMock.Net, or the real API in a
  container) for the edges.
- **Scripted fakes are strict on purpose.** Failing on an unscripted request
  makes tests longer to write, and it is what stops a retry test from passing
  with no retries.
- **Testing the real pipeline couples tests to its options.** Changing
  `MaxRetryAttempts` breaks the attempt counts. That is the point when the
  options are a contract with the API; when they are not, test the client with
  the pipeline removed and test the options in one place.
  `RemoveAllResilienceHandlers()` does that, but in Microsoft.Extensions.Http.Resilience
  10.11 it is marked experimental and the build fails until you suppress EXTEXP0001.
  ```csharp
  #pragma warning disable EXTEXP0001 // experimental API
  builder.RemoveAllResilienceHandlers(); // client mapping only, no retries, no clock to drive
  ```
- **A fake clock needs a driver.** Every call goes through a helper that
  advances time, and disposal does too. Forgetting it costs 100 seconds per
  call, or a hung run.
- **Snapshots cost a little code.** Copying the body and headers per attempt is
  more than storing the message, and it is the only way to know what each
  attempt sent.
- **A mocking library is optional here.** A handler fake is ten lines of plain
  C#, it can read the body the way a transport does, and it asserts on what was
  sent rather than on which methods were called. The Java testing-concepts
  track covers the general fakes-versus-mocks trade-off.

## Lab

`FreightClient`, a typed client for a freight API behind an idempotency-key handler and a resilience pipeline (retry, circuit breaker, attempt timeout), is already implemented. Your job is to write the MSTest tests that prove its eight rules with a hand-written fake handler and a fake clock.

**What you will practice**

- Writing a scripted `HttpMessageHandler` fake that snapshots every attempt and reads the body like a transport.
- Wiring a typed client in a test `ServiceCollection`, replacing only the last hop.
- Testing retries, attempt timeouts and the circuit breaker on a `FakeTimeProvider`, without real waits.
- Telling 4xx, 5xx, timeout, cancellation and contract errors apart.

**Prerequisites:** HttpClient and IHttpClientFactory, Resilience: Retries, Timeouts and Circuit Breakers, Controlling Time with TimeProvider, Test Doubles: Fakes, Stubs and NSubstitute, .NET 10 SDK.

**How it works:** every test is declared with a hint and fails with a `TODO-NN` message until you write it. Four tests have a naive version that passes for the wrong reason (a fake that always answers 200, headers read from the reused message, a body nobody reads, a call nobody drives). The optional TODOs cover the circuit's probe and a mutation check.

## Documentation Links

- [Build resilient HTTP apps, Microsoft.Extensions.Http.Resilience, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [IHttpClientFactory with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [Polly: dependency injection, Polly docs](https://www.pollydocs.org/advanced/dependency-injection.html) (doc)
- [Polly: testing, Polly docs](https://www.pollydocs.org/advanced/testing.html) (doc)
- [HttpContent.LoadIntoBufferAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpcontent.loadintobufferasync) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [WireMock.Net, GitHub](https://github.com/wiremock/WireMock.Net) (doc)
