---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

[WebApplicationFactory](/dotnet-testing-concepts/integration-testing-with-webapplicationfactory) proves that one API behaves; it does not prove that it holds under load, or that the client on the other side still understands its answers. Two kinds of test cover those gaps. A load test (NBomber from C#, k6 from a JavaScript file) sends traffic over a real socket and reports latency percentiles, throughput and errors. A contract test (Pact) records what a consumer needs from a provider in a file, and replays it against the real provider. Both are easy to get wrong in ways that look fine: a load test that hides its worst latencies, and a contract test that never fails when the API changes. The goal: write each one, break the system on purpose, and see the number or the message that tells the truth. Every result below was measured on one Apple M4 Max (14 cores, 36 GB, macOS 27.2.1, Docker Desktop 29.9.2).

Versions: SDK 10.0.100, `net10.0`, `NBomber` 6.7.1, `PactNet` 5.0.1 (native `libpact_ffi` inside the package), `MSTest.Sdk` 4.5.3 on Microsoft.Testing.Platform, `Microsoft.AspNetCore.Mvc.Testing` 10.0.14, `Microsoft.AspNetCore.OpenApi` 10.0.14, container images `grafana/k6:2.4.0`, `pactfoundation/pact-broker` and `pactfoundation/pact-cli` (latest on 2026-11-20). .NET 11 was not installed: nothing here was run on it.

## Use Cases

- Finding out how many requests per second an endpoint takes, and which percentile breaks a limit, before a release.
- Failing a pipeline when p95 or the error rate crosses a threshold.
- Letting a provider team rename a field and learn in its own build that a consumer reads it, and letting a consumer publish what it uses.
- Choosing which test to write for a question: the table near the end.

## Deep Dive

### The system under test

A Minimal API with three routes: `GET /products/{id}` (no I/O), `GET /quote` (takes a `SemaphoreSlim(1)`, 5 ms of work inside it), and `POST /stall?ms=3000`, which makes a background task hold the same lock, like a maintenance job or a failover. It ran as a published Release build on Kestrel, `http://127.0.0.1:6940`. Only the experiments name a different host.

### NBomber: a scenario and a load simulation

A scenario is a function NBomber calls once per iteration; `Step.Run` times a unit of work and names it in the report. The load simulation decides who calls the function and how often:

```csharp
var closed = Scenario.Create("closed", async ctx =>
        await Step.Run("get-product", ctx, async () =>
        {
            var r = await http.GetAsync("/products/1");
            return r.IsSuccessStatusCode ? Response.Ok(statusCode: "200") : Response.Fail(statusCode: ((int)r.StatusCode).ToString());
        }))
    .WithLoadSimulations(Simulation.KeepConstant(copies: 8, during: TimeSpan.FromSeconds(10)));

// open model: same body, .WithLoadSimulations(Simulation.Inject(rate: 80, interval: TimeSpan.FromSeconds(1), during: TimeSpan.FromSeconds(20)))
NBomberRunner.RegisterScenarios(closed).Run();
```

`KeepConstant` is the closed model: 8 copies, each starts the next iteration when the previous returns. `Inject` is the open model: 80 new iterations per second whether or not earlier ones finished. `RampingInject` and `RampingConstant` move the rate or the copies from the current value to a target over a duration. A run with `RampingInject(100/s, 5 s)`, `Inject(100/s, 5 s)`, `RampingInject(0/s, 3 s)` made 900 requests in 13 s (69/s on average). `WithoutWarmUp()` is used in every run here; by default NBomber warms up for 30 seconds and leaves that out of the report (see the warm-up section).

### A load test in memory measures the wrong thing

The same closed scenario, 8 copies for 10 s, `GET /products/1`, three runs each:

| Target | Requests per second | p50 | p99 |
| --- | --- | --- | --- |
| Kestrel on 127.0.0.1 (separate process) | 55,069, 55,115, 55,195 | 0.13 ms | 0.20 ms |
| `WebApplicationFactory` (`TestServer`, same process) | 226,385 to 242,293 | 0.01 ms | 0.79 to 0.81 ms |

The in-memory client was about 4 times faster and 13 times lower at p50, because there is no socket, no HTTP parsing, no TCP stack, and the load generator and the server share one process and its thread pool. Those numbers describe the code of one handler, not an API. Use `WebApplicationFactory` for correctness; use a real Kestrel (a published build, or `factory.UseKestrel(port)` since .NET 10) for load, and ideally another machine.

### Reports

`WithReportFormats(ReportFormat.Txt, Csv, Html, Md)` writes one file per format into `reports/<folder>`: the `.csv` has one row per scenario and step (`ok_latency_50`, `_75`, `_95`, `_99`, counts), and the `.html` is a 470 KB self-contained page with charts. `WithReportingInterval` has a minimum of 5 seconds ("ReportingInterval should be bigger than min value: '5'"), so per-second windows are not available. The `.md` of the open run:

```text
|requests|total = `1600`, ok = `1600`, fail = `0`|
|latency (ms)|min = `5.13`, mean = `461.21`, max = `2862.39`, StdDev = `831.83`|
|latency percentile (ms)|p50 = `14.04`, p75 = `335.62`, p95 = `2367.49`, p99 = `2834.43`|
```

### Thresholds: the build does not fail by itself

`WithThresholds` attaches pass/fail rules to a scenario (the two in the snippet below). With `Percent95 < 5` on `/quote` (open, 80/s, 10 s, no stall), NBomber ran to the end and `Run()` returned normally. The process exit code was 0. The failed rule is in `NodeStats.Thresholds` (`IsFailed`), so the pipeline has to check it:

```csharp
// scenario.WithThresholds(Threshold.Create(s => s.Fail.Request.Percent < 1), Threshold.Create(s => s.Ok.Latency.Percent95 < 150))
var stats = NBomberRunner.RegisterScenarios(scenario).Run();
Environment.ExitCode = stats.Thresholds.Any(t => t.IsFailed) ? 1 : 0;
```

NBomber's docs show assertions with xUnit or NUnit over the returned stats, which fits an MSTest test with `Assert.IsLessThan`. A threshold that never reaches an exit code is a green pipeline with a red report.

### k6 in a throwaway container

k6 is a Go binary that runs JavaScript. It was not installed here: the script runs in `grafana/k6:2.4.0` (`k6 v2.4.0`), removed when it ends, reaching the host API through `host.docker.internal`:

```javascript
// docker run --rm --name my-k6 -e BASE_URL=http://host.docker.internal:6940 -v "$PWD/k6:/scripts:ro" grafana/k6:2.4.0 run -q /scripts/stages.js
export const options = {
  stages: [{ duration: '5s', target: 20 }, { duration: '10s', target: 20 }, { duration: '3s', target: 0 }],
  thresholds: { http_req_duration: ['p(95)<50'], http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] },
};
export default function () {
  const res = http.get(`${__ENV.BASE_URL}/products/1`);
  check(res, { 'status is 200': (r) => r.status === 200, 'has the name': (r) => r.json('name') === 'Keyboard' });
  sleep(0.1);
}
```

`stages` is a closed model (virtual users ramp from 0 to 20, hold, ramp down). The summary:

```text
  █ THRESHOLDS
    checks ✓ 'rate>0.99' rate=100.00%   http_req_failed ✓ 'rate<0.01' rate=0.00%
    http_req_duration ✓ 'p(95)<50' p(95)=2.46ms
    http_req_duration: avg=1.25ms min=241.62µs med=1.17ms max=4ms p(90)=2.17ms p(95)=2.46ms
```

Changing the threshold to `p(95)<1` printed `✗ 'p(95)<1' p(95)=2.34ms`, `level=error msg="thresholds on metrics 'http_req_duration' have been crossed"` and exit code 99: k6, unlike NBomber, fails the process. The median of 1.17 ms for the same `/products/1` that NBomber saw at 0.13 ms is not a faster or slower server: k6 reached it from a Docker VM through the host gateway, NBomber over loopback. A number belongs to its vantage point.

### Coordinated omission: the lock that hides the worst latency

`/quote` serializes behind one lock. At t = 8 s the test calls `/stall?ms=3000`, so every `/quote` waits up to 3 s. Two load generators, both nominally about 80 requests per second, 20 s. In k6 the closed one is `{ executor: 'constant-vus', vus: 8 }` with `sleep(0.1)`, the open one `{ executor: 'constant-arrival-rate', rate: 80, timeUnit: '1s', preAllocatedVUs: 300, maxVUs: 500 }`; in NBomber, `KeepConstant(8, ...)` with a 100 ms delay against `Inject(80, 1 s, ...)`:

| Tool and model | Requests | p50 | p95 | p99 | max | mean |
| --- | --- | --- | --- | --- | --- | --- |
| NBomber `KeepConstant` 8 + 100 ms delay | 1,237 | 6.42 ms | 8.82 ms | 9.49 ms | 3,005 ms | 26 ms |
| NBomber `Inject` 80/s | 1,600 | 14.04 ms | 2,367 ms | 2,834 ms | 2,862 ms | 461 ms |
| k6 `constant-vus` 8 + `sleep(0.1)` | 1,256 | 7.18 ms | 12.23 ms | 20.93 ms | 2.98 s | 26.74 ms |
| k6 `constant-arrival-rate` 80/s | 1,601 | 7.0 ms | 2.49 s | 2.9 s | 3 s | 448.7 ms |

Same server, same stall, p99 of 9.5 ms against 2,834 ms. In the closed model only the 8 workers were stuck: 8 slow samples among 1,237, so the p99 stayed healthy and only the max (3,005 ms) shows it. The test also sent fewer requests (61.9/s, against about 75/s without a stall), because a stalled generator stops generating. In the open model, 80 requests per second kept arriving for 3 s, about 240 of them waited, and the queue took a while to drain: the p75 was already 336 ms. A real user population behaves like the second: people do not stop clicking because the server is busy. A closed-loop generator hides the queue; that is coordinated omission, named by Gil Tene.

The rule: for a public endpoint, or any independent clients, use the open model (`Inject`, `constant-arrival-rate`). Use the closed model for a session with fixed concurrency (a connection pool, a worker fleet), and read the max. With k6's open model, give it enough VUs: with `preAllocatedVUs: 50`, the stall run reported `dropped_iterations: 96` (6 percent of the arrivals never started) and a kinder p95 of 2.19 s. A test that drops its own load is quietly closed again.

### Warm-up, the machine, and what a percentile says

- **JIT.** Timing 2,000 sequential requests to a freshly started API: the first took 57.2 ms (56.6, 57.3, 57.2 in three runs), the second 1.1 ms, then about 0.2 ms, and the median of the rest was 0.08 ms. A 10 s NBomber run on a cold server had a max of 54.3 and 55.8 ms; with `WithWarmUpDuration(TimeSpan.FromSeconds(5))` the max was 2.7 and 3.6 ms, and the mean (0.14 ms) and p99 (0.2 ms) did not move. Warm up so the first requests do not become the max; the report excludes it.
- **Same machine.** During the closed run, `ps` showed the API at about 534 percent CPU and the load generator at about 512 percent, on 14 cores. They compete for cores, caches and the loopback stack, so the throughput is a ceiling of the pair, not of the API. NBomber also warns `Server GC mode is not enabled` (`<ServerGarbageCollection>`); here, enabling it moved 55.1 to 55.3 k requests per second to 56.0 to 56.3 k, about 2 percent. Put the generator on another machine, and watch its own CPU.
- **Percentiles.** In the open run the mean was 461 ms, the median 14 ms and the p99 2,834 ms: no single number describes it. p50 is what the typical request sees; p99 is what 1 request in 100 sees, and a page that makes 40 calls meets that tail often. Never average percentiles across runs or instances. State the percentile, the window and the model (see [Describing Performance](/system-design/system-design-concepts/describing-performance-latency-and-percentiles) and the paper [The Tail at Scale](/papers/the-tail-at-scale)).

### Pact: the consumer writes the contract

A consumer test declares the interaction it needs, and the mock server answers it. The consumer is a typed client for `/products/{id}` that reads `id`, `name` and `price`:

```csharp
var pact = Pact.V4("Web", "Shop.Api", new PactConfig { PactDir = "pacts" }).WithHttpInteractions(6942);

pact.UponReceiving("a request for an existing product").Given("product 1 exists")
    .WithRequest(HttpMethod.Get, "/products/1").WillRespond().WithStatus(HttpStatusCode.OK)
    .WithHeader("Content-Type", Match.Regex("application/json; charset=utf-8", @"^application/json(;.*)?$"))
    .WithJsonBody(new { id = Match.Integer(1), name = Match.Type("Keyboard"), price = Match.Decimal(49.90m) });

await pact.VerifyAsync(async ctx =>
{
    var product = await new ProductsClient(new HttpClient { BaseAddress = ctx.MockServerUri }).GetAsync(1);
    Assert.AreEqual("Keyboard", product!.Name);
});
```

Both tests passed in 0.9 s and wrote `pacts/Web-Shop.Api.json` (excerpt):

```json
"providerStates": [ { "name": "product 1 exists" } ],
"request": { "method": "GET", "path": "/products/1" },
"response": { "status": 200, "body": { "content": { "id": 1, "name": "Keyboard", "price": 49.9 } },
  "matchingRules": { "body": { "$.id": {"matchers": [{"match": "integer"}]}, "$.name": {"matchers": [{"match": "type"}]},
                               "$.price": {"matchers": [{"match": "decimal"}]} },
                     "header": { "Content-Type": {"matchers": [{"match": "regex", "regex": "^application/json(;.*)?$"}]} } } }
```

Matchers say how to compare, not what to send. `Match.Type("Keyboard")` accepts any string, `Match.Integer`/`Match.Decimal` any number of that kind, `Match.Regex` a string that fits the pattern. Without a matcher the provider must return exactly `"Keyboard"`, which makes a contract test depend on data. The file mentions only `id`, `name` and `price`: the consumer states what it uses, nothing more. A consumer that asks for the wrong path (`/product/1`) fails in its own test: the mock server logs `Received request GET /product/1`, answers 500, and `EnsureSuccessStatusCode` throws.

### Pact: the provider replays it against the real API

`PactVerifier` reads the file, calls the provider over HTTP and compares each response. `ProviderState` is how it prepares data: before each interaction it POSTs the `Given` text to a URL, and the provider puts itself in that state. Here a startup filter handles `POST /provider-states` and edits the in-memory store (add product 1; remove product 999). The provider test starts the API with `factory.UseKestrel(6941)`:

```csharp
using var factory = new ShopApiFactory();      // WebApplicationFactory<Program> + the states endpoint
factory.UseKestrel(6941); factory.StartServer();
new PactVerifier("Shop.Api", config)
    .WithHttpEndpoint(new Uri("http://127.0.0.1:6941"))
    .WithFileSource(new FileInfo(pactFile))
    .WithProviderStateUrl(new Uri("http://127.0.0.1:6941/provider-states"))
    .Verify();
```

```text
  a request for an existing product (0s loading, 162ms verification)
     Given product 1 exists
    returns a response which: has status code 200 (OK), includes headers (OK), has a matching body (OK)
```

PactNet's README says you cannot host the provider with `WebApplicationFactory`, because `TestServer` has no socket and the Rust verifier is a separate HTTP client. That was true before .NET 10; `UseKestrel(port)` gives the factory a real listener and it worked here. The native library came in the NuGet (`runtimes/osx-arm64/native/libpact_ffi.dylib`, 12 MB); on macOS arm64 nothing else was needed. The README lists Linux (libc) and Windows x64 as supported and Linux musl (Alpine) as not (docs only). Set `PACT_DO_NOT_TRACK=true` in CI: Pact logs that it sends anonymous usage events.

### Breaking the provider on purpose

Each change was made in the API, the tests rerun, and the code reverted:

| Provider change | Result |
| --- | --- |
| Rename `Name` to `Title` | `$ -> Actual map is missing the following keys: name`, with a diff of the two bodies |
| `Price` serialized as a string | `$.price -> Expected '49.90' (String) to be a decimal number` |
| `NotFound()` replaced by `NoContent()` | `has status code 404`: `expected 404 but was 204` |
| Add a `Sku` field | passes: extra fields are allowed |

The last row is the point of the design: the provider may add what no one reads, and is stopped only for what a consumer declared. And the provider's own `WebApplicationFactory` test, written against `Product`, stays green after the rename (it asserts `product.Title`, once someone fixes the compile error), while the pact fails: 2 tests, 1 failed. A provider test only knows what the provider believes.

### Pact Broker and `can-i-deploy`

The broker stores pacts and verification results by version. It ran as `pactfoundation/pact-broker` with SQLite on port 6944 (no Postgres needed), and the `pact-cli` image drove it:

```bash
pact-broker publish /pacts --consumer-app-version 1.0.0 --branch main --broker-base-url $B
pact-broker can-i-deploy --pacticipant Web --version 1.0.0 --to-environment production   # no: not verified yet
# provider: WithPactBrokerSource(...PublishResults("1.0.0", r => r.ProviderBranch("main")))
pact-broker record-deployment --pacticipant Shop.Api --version 1.0.0 --environment production
pact-broker can-i-deploy --pacticipant Web --version 1.0.0 --to-environment production   # yes, exit 0
```

With Shop.Api 1.1.0 (the rename) and `Web` 1.0.0 recorded in production, `can-i-deploy --pacticipant Shop.Api --version 1.1.0` printed `The verification for the pact between the version of Web currently in production (1.0.0) and version 1.1.0 of Shop.Api failed` and exited 1. Before `Web` was recorded as deployed, the same question answered yes: it only protects consumers it knows are in production. The broker container was removed afterwards; PactFlow (hosted) is docs only.

### Contract, OpenAPI and WebApplicationFactory

`Microsoft.AspNetCore.OpenApi` generated the document from code. With `Results.Ok(p)` the `200` response had no schema at all: add `.Produces<Product>(200).Produces(404)` and the schema appeared (`required: ["id","name","price"]`). After the rename the regenerated schema said `["id","title","price"]`: a spec generated from code follows the code, so it cannot reject the breaking change. Detecting that needs a diff of the spec between versions (a tool such as oasdiff, docs only) or the pact.

| | Pact | OpenAPI plus schema tests | `WebApplicationFactory` |
| --- | --- | --- | --- |
| Whose view | what each consumer uses | everything the provider offers | what the provider's team asserts |
| Catches a renamed field | yes, in the provider build | only by diffing versions | no, if the test is updated |
| Needs consumers' code | yes (their tests write it) | no | no |

### Which test answers which question

| Question | Test |
| --- | --- |
| Does this rule compute the right value? | unit |
| Do routing, binding, DI and the database work together? | integration (`WebApplicationFactory`, Testcontainers) |
| Does the provider still give the consumers what they read? | contract (Pact) |
| How many requests per second, and which p99, under what load? | load (NBomber, k6) |
| Does the page work in a real browser? | E2E ([Playwright](/dotnet-testing-concepts/end-to-end-testing-with-playwright-for-dotnet)) |

### Book vs today

- Classic advice is to report the average response time of a closed loop. In the measured run the mean was 461 ms, the median 14 ms and the p99 2,834 ms. Today the minimum is the open model, p50/p95/p99 and the max.
- NBomber 6.7.1 prints `THIS VERSION IS FREE ONLY FOR PERSONAL USE` and bundles a license agreement (version 3.2, effective 2026-09-01): free for personal and academic use, a paid subscription for organizations. k6 is AGPL-3.0 (its repository), so check both licenses before adopting.
- PactNet 3.x and below used a Ruby standalone mock service and a port per test; 4.0 moved to the Rust core, 5.x added Pact specification 4 (`Pact.V4`, `WithHttpInteractions`). Posts written for 3.x and older use an API that no longer exists (see the upgrade guide).
- "You cannot host a provider with `WebApplicationFactory`" (PactNet README) is out of date for .NET 10: `UseKestrel(port)`.

## Trade-offs

- **A load test on a laptop gives relative numbers.** The generator and the server shared 14 cores; compare two builds on the same machine, not against a production SLA.
- **Overload can look like success.** If the API sits behind [rate limiting](/dotnet-concepts/rate-limiting-and-request-timeouts) or a [resilience pipeline](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers), 429s and retried calls change the numbers: count them as failures in the check, and test what the limit should do.
- **The open model is honest and hungry.** It needs enough VUs or threads for the worst queue (k6 dropped 96 iterations with too few), and it can bury a struggling server under requests. Cap it with `maxVUs`, and read the failures.
- **A threshold is only as good as its exit code.** k6 returns 99; NBomber returns 0 and you check `Thresholds`.
- **A pact is only what the consumer wrote.** A consumer that skips a field it needs is not protected. Keep consumer tests to what the client really reads, with matchers instead of values.
- **Contract tests need two teams and a broker to pay off.** Alone in one repository, a typed client plus OpenAPI diff or `WebApplicationFactory` costs less. The broker and `can-i-deploy` only guard consumers recorded as deployed. Keep the provider-states endpoint in the test host, never in production code.

## Documentation Links

- [Load Simulation, NBomber](https://nbomber.com/docs/nbomber/load-simulation/) (doc)
- [Asserts and Thresholds, NBomber](https://nbomber.com/docs/nbomber/asserts_and_thresholds/) (doc)
- [License, NBomber](https://nbomber.com/docs/getting-started/license/) (doc)
- [Open and closed models, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/) (doc)
- [Constant arrival rate executor, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/) (doc)
- [Thresholds, Grafana k6](https://grafana.com/docs/k6/latest/using-k6/thresholds/) (doc)
- [How NOT to Measure Latency, Gil Tene](https://www.youtube.com/watch?v=lJ8ydIuPFeU) (doc)
- [PactNet on GitHub](https://github.com/pact-foundation/pact-net) (doc)
- [Upgrading to PactNet 4.x (Ruby to Rust core)](https://github.com/pact-foundation/pact-net/blob/master/docs/upgrading-to-4.md) (doc)
- [How Pact works, docs.pact.io](https://docs.pact.io/getting_started/how_pact_works) (doc)
- [Matching, docs.pact.io](https://docs.pact.io/getting_started/matching) (doc)
- [Provider states, docs.pact.io](https://docs.pact.io/getting_started/provider_states) (doc)
- [Can I Deploy, docs.pact.io](https://docs.pact.io/pact_broker/can_i_deploy) (doc)
- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [OpenAPI overview in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview) (doc)
