---
version: 1.0
updatedAt: 2026-10-07
---
## Objective

A clean architecture with four projects (`Domain`, `Application`,
`Infrastructure`, `Api`) is easy to test because each layer needs a different,
and smaller, kind of test than the one outside it. The domain needs no setup,
the use cases need a fake of one port, and only the outer layer needs a real
host and a real database. The goal is to write that suite in MSTest: one test
project per layer, the cheapest test that can see each rule, and a test for the
dependency rule itself so the architecture cannot erode quietly.

## Use Cases

- Testing business rules in milliseconds, with no database and no web server.
- Testing use cases against an in-memory fake of the repository port, so a
  failing test points at the handler and not at EF Core.
- Testing the HTTP contract (201, 400, 409, 404) and the database constraints
  through the real pipeline, once per scenario that crosses layers.
- Failing the build when someone adds an EF Core reference to `Application` or
  makes a repository `public`.
- Keeping the pyramid honest: many fast domain tests, fewer application tests,
  few API tests.

## Deep Dive

### One test project per layer, and the references are the rule

The test projects mirror the source projects, and each one references only what
its layer may see:

```text
tests/
  Tenancy.Domain.Tests       -> references Domain only.
  Tenancy.Application.Tests  -> references Application and Domain.
  Tenancy.Api.Tests          -> references all four (it is where the layers meet).
```

A domain test cannot reach EF Core or HTTP by accident, because the project has
no reference to them. The csproj of the smallest one is the whole setup:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.4.1" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
<ItemGroup>
  <ProjectReference Include="..\..\src\Tenancy.Domain\Tenancy.Domain.csproj" />
</ItemGroup>
```

MSTest runs tests one at a time until the assembly opts in. `dotnet new mstest`
adds a `MSTestSettings.cs` with `[assembly: Parallelize(Scope =
ExecutionScope.MethodLevel)]`, and each test project here keeps it. MSTest also
creates a new instance of the test class for every test method, so instance
fields are private to one test and running methods in parallel is safe as long
as nothing is `static`.

### Domain tests: construct, act, assert

The domain class refuses invalid input in its constructor, so the tests are
tables of inputs. `[DataRow]` turns a table into one method, and each row is
reported on its own:

```csharp
[TestClass]
public sealed class TenantTests
{
    [TestMethod]
    [DataRow("acme", "acme")]
    [DataRow("  ACME-Games ", "acme-games")]
    [DataRow("A", "a")]
    public void ShouldNormalizeTheSubdomain(string input, string expected) =>
        Assert.AreEqual(expected, new Tenant(input).Subdomain);

    [TestMethod]
    [DataRow("")]
    [DataRow("-acme")]
    [DataRow("a.b")]
    [DataRow("under_score")]
    public void ShouldRejectAnInvalidSubdomain(string subdomain) =>
        Assert.ThrowsExactly<ArgumentException>(() => new Tenant(subdomain));

    [TestMethod]
    public void ShouldAcceptExactly63CharactersAndRejectMore()
    {
        Assert.AreEqual(63, new Tenant(new string('a', 63)).Subdomain.Length);
        Assert.ThrowsExactly<ArgumentException>(() => new Tenant(new string('a', 64)));
    }
}
```

The 63-character test checks both sides of the boundary in one place. Another
test checks that a failed `Rename` leaves the old subdomain in place, because a
failed operation must not leave the object half changed.

### Application tests: a fake of the port

The handler depends on `ITenantRepository`, which `Application` declares. The
test provides a working in-memory implementation, not a script of expected
calls:

```csharp
internal sealed class FakeTenantRepository : ITenantRepository
{
    public List<Tenant> Stored { get; } = [];

    public Task<bool> ExistsAsync(string subdomain, CancellationToken ct) =>
        Task.FromResult(Stored.Any(t => t.Subdomain == subdomain));

    public Task<Tenant?> FindBySubdomainAsync(string subdomain, CancellationToken ct) =>
        Task.FromResult(Stored.FirstOrDefault(t => t.Subdomain == subdomain));

    public Task AddAsync(Tenant tenant, CancellationToken ct)
    {
        Stored.Add(tenant);
        return Task.CompletedTask;
    }
}
```

Tests seed `Stored` before the act step and read it after, so they assert on the
outcome (one tenant stored, none stored) and on the status the use case returns,
not on which methods were called:

```csharp
[TestClass]
public sealed class CreateTenantHandlerTests(TestContext testContext)
{
    private readonly FakeTenantRepository _tenants = new();

    private Task<CreateTenantResult> CreateAsync(string subdomain) =>
        new CreateTenantHandler(_tenants).HandleAsync(subdomain, testContext.CancellationToken);

    [TestMethod]
    public async Task ShouldRejectASubdomainThatIsAlreadyTakenIgnoringCase()
    {
        _tenants.Stored.Add(new Tenant("acme"));

        var result = await CreateAsync("Acme");

        Assert.AreEqual(CreateTenantStatus.SubdomainTaken, result.Status);
        Assert.HasCount(1, _tenants.Stored);
    }
}
```

MSTest passes the `TestContext` of the running test to the constructor (here a
primary constructor). Its `CancellationToken` is signaled when the test times
out or the run is aborted, so the handler receives a real token instead of
`CancellationToken.None`.

A table of hosts is a better fit for `[DynamicData]` than for a pile of
`[DataRow]` attributes. The source is a `static` property of tuples, so the rows
are typed and adding a host is one line:

```csharp
public static IEnumerable<(string Host, TenantResolutionStatus Expected)> Hosts =>
[
    ("acme.example.com", TenantResolutionStatus.Found),
    ("ACME.example.com", TenantResolutionStatus.Found),
    ("ghost.example.com", TenantResolutionStatus.NotFound),
    ("localhost", TenantResolutionStatus.NoSubdomain),
];

[TestMethod]
[DynamicData(nameof(Hosts))]
public async Task ShouldResolveTheTenantFromTheFirstLabelOfTheHost(string host, TenantResolutionStatus expected)
{
    var tenants = new FakeTenantRepository();
    tenants.Stored.Add(new Tenant("acme"));

    var resolution = await new ResolveTenantHandler(tenants).HandleAsync(host, testContext.CancellationToken);

    Assert.AreEqual(expected, resolution.Status);
}
```

### API tests: the whole stack, few times

Some rules only exist when the layers are wired together: the status code each
result maps to, the tenant resolved from the host header, the unique index. For
those, start the real application with `WebApplicationFactory<Program>` (the
`Api` project declares `public partial class Program;` so the test project can
see the entry point) and point it at a SQLite file that belongs to one test:

```csharp
[TestClass]
[TestCategory("Integration")]
public sealed class TenantsApiTests(TestContext testContext)
{
    private string _dbFile = null!;
    private WebApplicationFactory<Program> _factory = null!;

    [TestInitialize]
    public void StartApi()
    {
        _dbFile = Path.Combine(Path.GetTempPath(), $"tenancy-{Guid.NewGuid():N}.db");
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("ConnectionStrings:Tenancy", $"Data Source={_dbFile};Pooling=False"));
    }

    [TestCleanup]
    public async Task StopApi()
    {
        await _factory.DisposeAsync();
        File.Delete(_dbFile);
    }
}
```

A new file and a new host per test keep the tests from seeing each other's
tenants, which matters because they run in parallel. `Pooling=False` makes
closing a connection really close the file, so the cleanup can delete it. The
tenant is chosen by the host, so a small helper builds a client for any host:

```csharp
private HttpClient ClientFor(string host)
{
    var client = _factory.CreateClient();
    client.BaseAddress = new Uri($"http://{host}");
    return client;
}

[TestMethod]
public async Task ShouldReturn409WhenTheSubdomainIsAlreadyTaken()
{
    await CreateTenantAsync("acme");

    var again = await CreateTenantAsync("Acme");

    Assert.AreEqual(HttpStatusCode.Conflict, again.StatusCode);
}

[TestMethod]
[DataRow("ghost.localhost")]
[DataRow("localhost")]
public async Task ShouldReturn404ForCurrentWhenThereIsNoSuchTenant(string host)
{
    var response = await ClientFor(host).GetAsync("/tenants/current", testContext.CancellationToken);

    Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
}
```

One test goes around the handler on purpose. The handler's `ExistsAsync` check
is a courtesy that produces the friendly `409`; the unique index is the
guarantee. The test adds a duplicate straight to the `DbContext` and expects the
database to refuse it:

```csharp
db.Tenants.Add(new Tenant("acme"));
await Assert.ThrowsExactlyAsync<DbUpdateException>(() => db.SaveChangesAsync(testContext.CancellationToken));
```

### Test the dependency rule itself

The compiler guards the direction of project references, but not which packages
a layer uses or what a public type exposes. A test reads the compiled
references. One test over a table of layers keeps the rule in one place, and
`DynamicDataDisplayName` gives each row a readable name:

```csharp
public static IEnumerable<(Assembly Layer, string[] Forbidden)> Rules =>
[
    (Domain, ["Tenancy.", "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore"]),
    (Application, ["Tenancy.Infrastructure", "Tenancy.Api", "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore"]),
    (Infrastructure, ["Tenancy.Api"]),
];

public static string RuleName(MethodInfo method, object[] data) =>
    $"{((Assembly)data[0]).GetName().Name} must not reference {string.Join(", ", (string[])data[1])}";

[TestMethod]
[DynamicData(nameof(Rules), DynamicDataDisplayName = nameof(RuleName))]
public void ALayerShouldNotReferenceWhatIsOutsideItsRing(Assembly layer, string[] forbidden)
{
    var references = layer.GetReferencedAssemblies().Select(a => a.Name!).ToList();

    var violations = references.Where(r => forbidden.Any(r.StartsWith)).ToList();

    Assert.IsEmpty(violations, $"{layer.GetName().Name} references {string.Join(", ", violations)}");
}
```

A failure reads "Tenancy.Application must not reference
Microsoft.EntityFrameworkCore" instead of "row 2". A second test guards the
guard: if `Application` lost its reference to `Domain`, the rules would match
nothing and pass for the wrong reason, so `Assert.Contains("Tenancy.Domain",
references)` keeps the table honest. A reference that nothing uses is not
recorded in the compiled assembly, so these tests fire when code actually uses a
type from the wrong layer. Libraries such as NetArchTest or ArchUnitNET express
richer rules, as in the Module Communication and Architecture Tests concept.

### Does each layer notice a break?

Break the production code on purpose, one change at a time, and see which
project turns red. These are the results for this suite:

| Change to the production code | Tests that fail |
| --- | --- |
| `Tenant.Normalize` stops lower-casing | domain rows, the application "taken ignoring case" test, the API create and 409 tests |
| `CreateTenantHandler` skips `ExistsAsync` | the application "already taken" test and the API 409 test |
| The endpoint returns `Results.Ok` instead of `Results.Conflict` | only the API 409 test |
| `.IsUnique()` is removed from the mapping | only the unique index test |
| `TenantRepository` becomes `public` | only the "persistence types stay internal" test |
| `Tenancy.Application` uses EF Core | the Application row of the dependency rule |

The break shows up in the layer that owns the rule (and often again in the
layers above it), and a change that turns nothing red is a missing test. On this suite the domain project runs 14 tests in
tens of milliseconds, the application project 8, and the API project 12 in about
half a second, which is the shape of the pyramid.

## Trade-offs

- **A fake needs maintenance; a mock needs care.** When `ITenantRepository`
  gains a method, the fake must implement it. A mock that verifies calls would
  break on a harmless refactor of the handler. The fake keeps tests on outcomes,
  at the price of a small class per port.
- **API tests start a host, so keep them few.** Each one boots the application
  and a database file. A single shared factory is faster, but then tests share
  tenants and must use unique data, and a `static` factory shared by parallel
  tests is the usual source of flakiness.
  ```csharp
  var subdomain = $"t{Guid.NewGuid():N}"[..20]; // unique per test when the database is shared
  ```
- **SQLite is a stand-in for your real database.** The unique index test proves
  the mapping has an index, not that PostgreSQL enforces it the same way. EF
  Core's guidance is to test against the real database system when you can, with
  containers such as Testcontainers. Moving to PostgreSQL changes
  `AddInfrastructure` and the connection string the factory is given; the test
  bodies stay the same.
- **Testing every layer and also the API duplicates some checks.** The 409 is
  checked in the handler test and again through HTTP. That is deliberate: the
  first proves the rule, the second proves the wiring. Keep the second kind
  small.
- **Reflection tests only see what is compiled.** An unused reference is
  invisible to `GetReferencedAssemblies`, and the rules are strings that rot when
  a project is renamed. The guard test and a rule that fails loudly help, and a
  library such as NetArchTest covers more.
- **Mirroring the layers doubles the project count.** Three test projects for
  four source projects is more to maintain than one. In return, the references
  of each test project enforce what its tests may touch. One project with all
  references is simpler and lets a domain test reach for EF Core.

## Documentation Links

- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [Integration tests in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Choosing a testing strategy, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy) (doc)
- [Connection strings, Microsoft.Data.Sqlite, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/connection-strings) (doc)
