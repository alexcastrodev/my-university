---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

`WebApplicationFactory<Program>` starts your real ASP.NET Core application in
memory: the same `Program.cs`, the same DI container, the same middleware and
endpoints, with an `HttpClient` that talks to it without a socket. The goal is
to write MSTest integration tests with it that replace only what a test cannot
reach (an external service, a setting), share one host per class without
leaking state, and assert what a client really receives: the status code, the
`Location` header, the JSON body and the ProblemDetails of an error. Along the
way, three habits that make such a test pass for the wrong reason: an override
that arrives too late, a singleton that remembers the previous test, and a
client that silently follows redirects.

## Use Cases

- Proving that `POST /orders` answers 201 with a `Location` header and the
  order in the body, through routing, model binding and serialization.
- Proving that an error is a ProblemDetails document with the right status and
  title, which is the contract the frontend parses.
- Replacing an HTTP client to another service with a fake, so the tests run
  without the network.
- Running the API with a different setting (a lower limit, a feature flag) for
  one test class.
- Checking a redirect itself (302 and `Location`), not the page it leads to.

## Deep Dive

### The package and the entry point

The test project references the API project and one package:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.13" />
</ItemGroup>
<ItemGroup>
  <ProjectReference Include="..\..\src\Orders.Api\Orders.Api.csproj" />
</ItemGroup>
```

`Microsoft.AspNetCore.Mvc.Testing` copies the API's `.deps` file into the test
output, sets the content root to the API project folder (so `appsettings.json`
is read from there), and provides `WebApplicationFactory<TEntryPoint>`, which
boots the app on the in-memory `TestServer`. Two defaults follow from this:
the environment is `Development` unless you set one, so
`appsettings.Development.json` is loaded too, and the host is only built when
something first touches the factory (`CreateClient`, `Services`, `Server`).

`TEntryPoint` is usually `Program`. Top-level statements compile to an
`internal` class, so until .NET 9 the API had to add
`public partial class Program;` for the test project to see it. Since .NET 10 a
source generator emits that declaration, and the analyzer ASP0027 suggests
removing an explicit one. The `Program.cs` of the lab has no such line, and
`WebApplicationFactory<Program>` compiles.

### A factory for the tests

Subclass the factory once and put every test override in `ConfigureWebHost`:

```csharp
public sealed class OrdersApiFactory : WebApplicationFactory<Program>
{
    public const int MaxQuantity = 3;

    public FakeInventory Inventory { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Orders:MaxQuantity", MaxQuantity.ToString());

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IInventoryClient>();
            services.AddSingleton<IInventoryClient>(Inventory);
        });
    }
}
```

`ConfigureTestServices` runs after `Program.cs` registered its services, so a
registration there wins. The API registers `IInventoryClient` as a typed
`HttpClient` pointing at another service; `RemoveAll<T>()` drops that
registration and the fake takes its place. For a single resolution the last
registration already wins, but `RemoveAll` also covers code that resolves
`IEnumerable<T>` or uses `TryAdd`, and it says what you meant. The fake is a
working in-memory implementation, not a mock:

```csharp
public sealed class FakeInventory : IInventoryClient
{
    public const int DefaultStock = 100;

    private readonly ConcurrentDictionary<string, int> _stock = new();

    public void SetStock(string sku, int available) => _stock[sku] = available;

    public void Clear() => _stock.Clear();

    public Task<int> GetAvailableAsync(string sku, CancellationToken ct) =>
        Task.FromResult(_stock.GetValueOrDefault(sku, DefaultStock));
}
```

### Override configuration in time

`Program.cs` reads the limit once, before `Build`, and passes the number to a
singleton. That is common and legitimate, and it decides which override works:

```csharp
var builder = WebApplication.CreateBuilder(args);

// Read once, before Build: OrderRules gets the number, not a configuration lookup.
var maxQuantity = builder.Configuration.GetValue("Orders:MaxQuantity", 10);

builder.Services.AddSingleton(new OrderRules(maxQuantity));
```

`UseSetting` reaches that read. `ConfigureAppConfiguration` does not: with the
minimal hosting model, the sources it adds are only available after the
application is built, which is too late for code above `builder.Build()`. A
learning test pins the behavior down:

```csharp
await using var factory = new OrdersApiFactory().WithWebHostBuilder(builder =>
    builder.ConfigureAppConfiguration((_, config) =>
        config.AddInMemoryCollection(new Dictionary<string, string?> { ["Orders:MaxQuantity"] = "1" })));

// With a limit of 1 this would be a 400. Program.cs read the value before Build,
// so OrderRules received the UseSetting value (3), and 2 is accepted.
var response = await factory.CreateClient()
    .PostAsJsonAsync("/orders", new PlaceOrderRequest("KB-1", 2), testContext.CancellationToken);

Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
```

The same override is visible in `IConfiguration` resolved from
`factory.Services` afterwards, so an endpoint that reads configuration per
request would see it. Values bound with `IOptions<T>` are read late too. A
value read before `Build` needs `UseSetting` (or an environment variable).

The trap is in the assertion, not only in the override. With a limit of 3 and
an `appsettings.json` limit of 10, a test that orders 50 units gets a 400 with
either limit, so it passes even when the override never arrived. Test at the
boundary the override creates:

```csharp
[TestMethod]
public async Task ShouldRejectAQuantityJustAboveTheConfiguredLimit()
{
    var response = await PlaceAsync("KB-1", OrdersApiFactory.MaxQuantity + 1);

    Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    var problem = await response.Content.ReadFromJsonAsync<HttpValidationProblemDetails>(Ct);
    var error = Assert.ContainsSingle(problem!.Errors["quantity"]);
    Assert.AreEqual("The quantity must be between 1 and 3.", error);
}
```

### One host per class, reset per test

Starting a host per test is the most isolated option and costs a startup each
time. MSTest has no `IClassFixture<T>`; a `static` field set in
`[ClassInitialize]` and disposed in `[ClassCleanup]` does the same job (xUnit's
`IClassFixture<T>`, NUnit's `[OneTimeSetUp]`). For one host per test assembly,
`[AssemblyInitialize]` and `[AssemblyCleanup]` follow the same rules. Both
cleanup methods may be `async Task`:

```csharp
[TestClass]
[DoNotParallelize]
public sealed class OrdersApiTests(TestContext testContext)
{
    private static OrdersApiFactory _factory = null!;

    [ClassInitialize]
    public static void StartApi(TestContext _) => _factory = new OrdersApiFactory();

    [ClassCleanup]
    public static async Task StopApi() => await _factory.DisposeAsync();

    [TestInitialize]
    public void ResetState()
    {
        _factory.Services.GetRequiredService<OrderStore>().Clear();
        _factory.Inventory.Clear();
    }
}
```

Sharing the host means sharing its singletons. `OrderStore` is one list for
the life of the host, so without the reset a test that lists the orders also
sees the orders of the tests that ran before it, and fails or passes depending
on the order. The reset stands in for what you would do against a real
database (truncate, or a tool such as Respawn). The lab's `MSTestSettings.cs`
runs test methods in parallel, and two tests that reset and fill the same store
at the same time break each other, so this class opts out with
`[DoNotParallelize]`. The other way out is unique data per test (a new SKU or
customer id each time) and no reset.

`WithWebHostBuilder` is the per-test escape hatch. It returns a new factory
with its own host, its own singletons and the extra configuration, which is how
the configuration test above changes one setting without touching the shared
host. Dispose it.

### Assert the response a client sees

Send the production request type, so a misspelled property cannot produce a 400
that the test mistakes for a validation error:

```csharp
private Task<HttpResponseMessage> PlaceAsync(string sku, int quantity) =>
    _factory.CreateClient().PostAsJsonAsync("/orders", new PlaceOrderRequest(sku, quantity), Ct);

[TestMethod]
public async Task ShouldPlaceAnOrderAndPointToItWithTheLocationHeader()
{
    var response = await PlaceAsync("KB-1", 2);

    Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
    var order = await response.Content.ReadFromJsonAsync<Order>(Ct);
    Assert.AreEqual(new Order(order!.Id, "KB-1", 2), order);
    Assert.AreEqual($"/orders/{order.Id}", response.Headers.Location!.OriginalString);
}
```

`GetFromJsonAsync<T>` is the shortest read for a 200, and it throws
`HttpRequestException` ("Response status code does not indicate success: 404")
for anything else. For an error, get the response and read the body as
ProblemDetails:

```csharp
var response = await _factory.CreateClient().GetAsync("/orders/999", Ct);

Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
Assert.AreEqual("application/problem+json", response.Content.Headers.ContentType?.MediaType);
var problem = await response.Content.ReadFromJsonAsync<ProblemDetails>(Ct);
Assert.AreEqual("Order not found", problem!.Title);
```

`ProblemDetails` lives in `Microsoft.AspNetCore.Mvc` and
`HttpValidationProblemDetails` (with the `Errors` dictionary that
`Results.ValidationProblem` writes) in `Microsoft.AspNetCore.Http`. Checking the
title or the error key is what tells "not found" apart from a 404 that routing
produced because the URL was wrong.

### Redirects: turn off the autopilot

`CreateClient()` returns a client with `AllowAutoRedirect = true`,
`HandleCookies = true`, up to 7 redirects and `BaseAddress` `http://localhost`.
`GET /orders/latest` answers 302 to the newest order, and the default client
follows it and reports the 200 of `/orders/{id}`. A test that asserts 200
passes if the endpoint redirects, if it returns the order directly, and, with
one order in the store, if it redirects to the oldest one. Ask for the redirect:

```csharp
var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

var response = await client.GetAsync("/orders/latest", Ct);

Assert.AreEqual(HttpStatusCode.Redirect, response.StatusCode);
Assert.AreEqual($"/orders/{newest.Id}", response.Headers.Location!.OriginalString);
```

The same option matters for authentication: a cookie scheme that redirects to a
login page looks like a 200 to a client that follows redirects. (Since .NET 10,
cookie authentication answers 401 and 403 instead of redirecting on known API
endpoints, such as minimal APIs that read or write JSON.)

### TestServer, or a real Kestrel (.NET 10)

`TestServer` processes requests in memory: no port, no socket, no TLS. That is
what you want for almost every API test. .NET 10 adds `UseKestrel()` to the
factory, for tests that need a real socket (a browser driven by Playwright, an
HTTP client you do not control):

```csharp
await using var factory = new OrdersApiFactory();
factory.UseKestrel(0); // port 0: the OS picks a free port
factory.StartServer();

var client = factory.CreateClient(); // http://127.0.0.1:<port>/
var orders = await client.GetFromJsonAsync<List<Order>>("/orders", testContext.CancellationToken);
```

`UseKestrel` must be called before the host starts; afterwards it throws
`InvalidOperationException`. With Kestrel there is no `TestServer`, so
`factory.Server` throws `NotSupportedException`, while `CreateClient()` and
`Services` keep working.

### Do the tests protect the rules?

Break the production code on purpose, one change at a time, and see what turns
red. These are the results for the lab's solution:

| Change to the production code | Tests that fail |
| --- | --- |
| `Program.cs` builds `new OrderRules(10)` and ignores the configuration | the "just above the configured limit" test |
| The limit check is off by one | the "just above the configured limit" test |
| `/orders/latest` returns `Results.Ok(order)` instead of a redirect | the redirect test |
| `OrderStore.Latest` returns the oldest order | the redirect test |
| The stock check is skipped | the 409 test |
| The 404 is `Results.NotFound()` with no ProblemDetails body | the ProblemDetails test |

The naive versions survive their rows: a limit test with 50 units passes with a
hard-coded 10, and a redirect test with the default client passes when the
endpoint returns the order directly. Removing the reset from `[TestInitialize]`
turns the list test red ("Different number of elements").

## Trade-offs

- **In-memory host, not a deployment.** `TestServer` skips the network, TLS and
  the reverse proxy, so a test proves the app, not the hosting. Keep a few smoke
  tests against a deployed environment, and use `UseKestrel` only when a real
  socket is the point.
- **A shared host is fast and remembers.** One host per class saves a startup
  per test, at the price of resetting every singleton and giving up parallelism
  in that class. One host per test (`WithWebHostBuilder` or a new factory) is
  isolated and parallel, and slower.
  ```csharp
  var sku = $"KB-{Guid.NewGuid():N}"; // unique data instead of a reset
  ```
- **Fakes at the edge drift from the real service.** The fake inventory answers
  instantly and never times out. A contract test (or a test against a container
  of the real service) covers what the fake cannot.
- **Overrides couple tests to `Program.cs`.** A test that relies on `UseSetting`
  reaching a read before `Build` breaks if someone moves that read into
  `IOptions<T>`, and the reverse. The learning test makes that coupling visible.
- **Integration tests are slower than unit tests.** Each one goes through
  routing, binding and serialization. Test rules in the domain or the handler,
  and keep the HTTP tests for the contract: status, headers, body shape.
- **MSTest, xUnit and NUnit differ in shape, not in substance.**
  `[ClassInitialize]` with a `static` field is `IClassFixture<T>` in xUnit and
  `[OneTimeSetUp]` in NUnit. The factory code is the same in all three, as in
  the Testing Modules in Isolation concept.

## Lab

The orders API is already implemented: a minimal API with validation, ProblemDetails, an inventory service it calls over HTTP, an in-memory store and a redirect. Your job is to write the MSTest integration tests that start it with `WebApplicationFactory<Program>`, and to find out where the obvious version of a test passes for the wrong reason.

**What you will practice**

- A factory subclass with `UseSetting` and `ConfigureTestServices`/`RemoveAll`.
- One host per class with `[ClassInitialize]`/`[ClassCleanup]`, and a reset per test.
- Asserting 201 with `Location`, ProblemDetails and validation errors.
- A 302 with `AllowAutoRedirect = false`, and a real Kestrel server with `UseKestrel`.

**Prerequisites:** the Minimal APIs and Middleware Pipeline concepts, the MSTest lifecycle, .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with `TODO-NN: write this test` until you write it. Some hints warn you where a naive assertion passes for the wrong reason. The optional TODOs pin down the configuration behavior, start Kestrel, and ask you to break the production code on purpose.

## Documentation Links

- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [WebApplicationFactory<TEntryPoint> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1) (doc)
- [WebApplicationFactory<TEntryPoint>.UseKestrel method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1.usekestrel) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [ASP0027: Unnecessary public Program class declaration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/diagnostics/asp0027) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Test execution and control in MSTest (parallelization), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
