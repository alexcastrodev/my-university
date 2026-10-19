---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

Security tests fail in a particular way: they stay green. A suite that only
calls the API as the owner or as an admin proves that the right people get in,
and says nothing about whether everyone else stays out. The goal is an MSTest
suite for an ASP.NET Core API that tests authentication and authorization from
the side that must be refused: a fake authentication scheme so a test can be
anyone (or nobody), exact 401 and 403 assertions, unit tests for the
authorization handler and the policies, a few tests with real signed JWTs for
what the fake cannot see, and an audit that fails when an endpoint is mapped
with no authorization decision at all.

## Use Cases

- Proving that a user cannot read or delete another user's note, and that the
  note is still there after the attempt.
- Proving that a role-based policy refuses every role except the one it names.
- Testing a resource-based `AuthorizationHandler` in milliseconds, without a
  host.
- Catching a token configuration mistake (lifetime, audience, claim mapping)
  before production does.
- Failing the build when someone adds an endpoint and forgets
  `RequireAuthorization()` or `AllowAnonymous()`.

## Deep Dive

### A fake scheme the test controls

Production uses JWT bearer, and a test does not want to mint a token for every
request. Replace the default scheme with a handler that reads the caller from
headers:

```csharp
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string UserHeader = "X-Test-User";
    public const string RolesHeader = "X-Test-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserHeader, out var user) || string.IsNullOrWhiteSpace(user))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.ToString()) };
        var roles = Request.Headers[RolesHeader].ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
```

Two details decide whether this handler can test anything. No header returns
`NoResult()`, so the request stays anonymous and the API can answer 401. The
handler in the Microsoft docs always signs a "Test user" in, which is fine when
every test needs a user and makes a 401 impossible to test. And the
`ClaimsIdentity` gets an authentication type (`SchemeName`): without one,
`IsAuthenticated` is `false` and every request looks anonymous.

The factory registers the scheme in `ConfigureTestServices` and makes it the
default. That runs after `Program.cs`, so it replaces JWT bearer for
authenticate, challenge and forbid:

```csharp
protected override void ConfigureWebHost(IWebHostBuilder builder)
{
    builder.UseSetting("Auth:SigningKey", SigningKey);

    if (useFakeAuthentication)
    {
        builder.ConfigureTestServices(services =>
            services.AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { }));
    }
}
```

`Program.cs` refuses to start without `Auth:SigningKey` and reads it before
`Build`, so the factory passes a test key with `UseSetting`, as in the
WebApplicationFactory concept. Two helpers on the factory keep the tests short:
`Anonymous()` is a plain `CreateClient()`, and `ClientAs("bob", Roles.Moderator)`
adds the two headers to `DefaultRequestHeaders`.

### 401 is not 403

401 means the API does not know who you are; 403 means it knows and the answer
is no. The fake scheme's default challenge writes a 401 and its default forbid a
403, so the tests can tell them apart, and they should:

```csharp
[TestMethod]
public async Task ShouldReturn401ToAnAnonymousCaller()
{
    var response = await _api.Anonymous().GetAsync("/notes", Ct);

    Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
}

[TestMethod]
public async Task ShouldReturn403WhenAnotherUserReadsTheNote()
{
    var note = await CreateNoteAsAsync("alice", "buy milk");

    var response = await _api.ClientAs("bob").GetAsync($"/notes/{note.Id}", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}
```

`Assert.IsFalse(response.IsSuccessStatusCode)` passes for both, and for a 500.
The difference matters to clients: a 401 sends them to log in again, a 403 does
not. When the endpoint decides by itself (resource-based authorization below),
it chooses: `Results.Forbid()` for an authenticated user, `Results.Challenge()`
for an anonymous one. Here the `/notes` group already requires an authenticated
user, so the endpoint only needs `Forbid`.

### Test from the side that must be refused

The endpoint loads the note and asks the authorization service, because the
decision needs the note itself:

```csharp
notes.MapGet("/{id:int}", async (int id, ClaimsPrincipal user, NoteStore store, IAuthorizationService authorization) =>
{
    if (store.Find(id) is not { } note)
    {
        return Results.NotFound();
    }

    var result = await authorization.AuthorizeAsync(user, note, Policies.NoteOwner);
    return result.Succeeded ? Results.Ok(note) : Results.Forbid();
});
```

A test as Alice reading Alice's note passes even if the handler lets everyone
in. The tests that carry the rule are the ones that are refused, and for a
write the status is only half of it:

```csharp
[TestMethod]
public async Task ShouldReturn403WhenAnotherUserDeletesTheNoteAndKeepIt()
{
    var note = await CreateNoteAsAsync("alice", "buy milk");

    var response = await _api.ClientAs("bob").DeleteAsync($"/notes/{note.Id}", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    var stillThere = await _api.ClientAs("alice").GetAsync($"/notes/{note.Id}", Ct);
    Assert.AreEqual(HttpStatusCode.OK, stillThere.StatusCode);
}
```

The same goes for roles. `/admin/stats` requires the `Admin` policy
(`RequireRole("admin")`). Calling it as an admin proves the door opens; the
rows that prove it stays shut are a moderator and a user with no role:

```csharp
[TestMethod]
[DataRow(Roles.Moderator)]
[DataRow(null)]
public async Task ShouldReturn403OnAdminStatsToAnyoneWhoIsNotAnAdmin(string? role)
{
    var client = role is null ? _api.ClientAs("bob") : _api.ClientAs("bob", role);

    var response = await client.GetAsync("/admin/stats", Ct);

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}
```

### Unit test the handler and the policies

The handler is a plain class. Build the context it receives and read
`HasSucceeded`:

```csharp
private static async Task<bool> HandlerAllowsAsync(ClaimsPrincipal user, Note note)
{
    var requirement = new NoteOwnerRequirement();
    var context = new AuthorizationHandlerContext([requirement], user, note);

    await new NoteOwnerHandler().HandleAsync(context);

    return context.HasSucceeded;
}

[TestMethod]
public async Task TheHandlerShouldNotTreatAnAdminAsAModerator() =>
    Assert.IsFalse(await HandlerAllowsAsync(User("root", Roles.Admin), AlicesNote));
```

That tests the handler, not the registration: a policy name with a typo, or a
handler that was never added to DI, still passes. One step up, build the real
registration in a `ServiceCollection` (the API exposes it as
`AddNotesAuthorization()`, the same call `Program.cs` makes) and use
`IAuthorizationService`, still with no host:

```csharp
private static IAuthorizationService AuthorizationService() =>
    new ServiceCollection()
        .AddLogging()
        .AddNotesAuthorization()
        .BuildServiceProvider()
        .GetRequiredService<IAuthorizationService>();

[TestMethod]
[DataRow("alice", null, true)]
[DataRow("bob", null, false)]
[DataRow("carol", Roles.Moderator, true)]
public async Task TheNoteOwnerPolicyShouldDecideOnTheNote(string userId, string? role, bool expected)
{
    var user = role is null ? User(userId) : User(userId, role);

    var result = await AuthorizationService().AuthorizeAsync(user, AlicesNote, Policies.NoteOwner);

    Assert.AreEqual(expected, result.Succeeded);
}
```

`AddLogging()` is there because the default authorization service needs a
logger. `AuthorizeAsync` has an overload with a resource (for `NoteOwner`) and
one without (for `Admin`).

### Audit every endpoint

The worst authorization bug is the endpoint nobody tests, because nobody
remembers it exists. Happy-path tests cannot find it. The routing system can:
every endpoint the app mapped is in `EndpointDataSource`, with its metadata.
`RequireAuthorization()` and `[Authorize]` add `IAuthorizeData`;
`AllowAnonymous()` adds `IAllowAnonymous`:

```csharp
private static IReadOnlyList<RouteEndpoint> Endpoints(NotesApiFactory api) =>
    [.. api.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()];

[TestMethod]
public async Task EveryEndpointShouldRequireAuthorizationOrAllowAnonymousExplicitly()
{
    await using var api = new NotesApiFactory();

    var undecided = Endpoints(api)
        .Where(e => e.Metadata.GetMetadata<IAuthorizeData>() is null
                 && e.Metadata.GetMetadata<IAllowAnonymous>() is null)
        .Select(e => e.DisplayName)
        .ToList();

    Assert.IsEmpty(undecided, $"No authorization decision on: {string.Join(", ", undecided)}");
}
```

A second test guards the guard: it checks that the list contains
`/notes/{id:int}`, `/admin/stats` and `/health`, because an empty list would
make the audit pass for the wrong reason. Group conventions count: an endpoint
inside `MapGroup("/notes").RequireAuthorization()` carries the metadata. The
production-side complement is `AuthorizationOptions.FallbackPolicy`, which
applies when an endpoint has no authorization metadata and is `null` by
default. The audit and a fallback policy answer different questions: the
fallback protects the forgotten endpoint, the audit makes someone decide.

### Real tokens, for what the fake cannot see

The fake scheme never reads a token, so it cannot notice a lifetime that is not
validated, a wrong audience, or a claim that maps to the wrong type. A few
tests run the production JWT bearer handler (the factory without the fake
scheme) with tokens signed by the same test key:

```csharp
private static string Token(string userId, string? role = null, string audience = NotesApiFactory.Audience,
    DateTime? expires = null)
{
    var claims = new Dictionary<string, object> { ["sub"] = userId };
    if (role is not null)
    {
        claims["role"] = role;
    }

    var now = DateTime.UtcNow;
    return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = NotesApiFactory.Issuer,
        Audience = audience,
        Claims = claims,
        IssuedAt = now.AddHours(-2),
        NotBefore = now.AddHours(-2),
        Expires = expires ?? now.AddMinutes(5),
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(NotesApiFactory.SigningKey)),
            SecurityAlgorithms.HmacSha256),
    });
}
```

`JsonWebTokenHandler` comes with the `Microsoft.AspNetCore.Authentication.JwtBearer`
package. With the handler's default claim mapping, the `role` claim in the
token satisfies `RequireRole("admin")` and `sub` becomes
`ClaimTypes.NameIdentifier`, which the lab's tests prove. A token expired ten
minutes ago (more than the default five minutes of clock skew) gets a 401 with
`WWW-Authenticate: Bearer error="invalid_token", error_description="The token
expired at '...'"`, and a token for another audience gets a 401 too. HS256
needs a key of at least 256 bits, so the test key is 32 characters long (a
shorter one fails with `IDX10720`).

### Do the tests protect the rules?

Break the production code on purpose, one change at a time. These are the
results for the lab's solution:

| Change to the production code | Tests that fail |
| --- | --- |
| `Admin` policy becomes `RequireAuthenticatedUser()` | both non-admin rows of the 403 test, the admin policy unit test |
| `NoteOwnerHandler` succeeds for any user | the two HTTP 403 tests, two handler tests, the `bob` row of the policy test |
| `NoteOwnerHandler` forgets the moderator | the moderator delete test, the moderator handler test, the `carol` row |
| `GET /notes/{id}` returns `Challenge()` instead of `Forbid()` | the "another user reads" 403 test |
| A new `MapGet("/notes-export", ...)` with no authorization | only the endpoint audit |
| `ValidateLifetime = false` | only the expired token test |
| `DELETE` answers 204 without removing the note | the moderator delete test (it reads the note back) |

The suite that only calls as the owner and the admin passes the first three
rows. Only the audit sees the forgotten endpoint, and only a real token sees
the lifetime.

## Trade-offs

- **A fake scheme tests authorization, not authentication.** It is fast and
  lets a test be anyone, and it never validates a signature, an expiry or an
  audience. Keep a handful of real-token tests for the production handler's
  configuration.
- **Real tokens need a key the tests know.** That key must come from
  configuration, so the API cannot hard-code it, and the test key must never be
  a production key. Against an external identity provider, the alternative is a
  token from a test tenant, which is slower and needs the network.
- **Unit tests of handlers miss the wiring.** A handler that is correct and
  never registered passes its unit tests. The `IAuthorizationService` tests
  catch the registration, and the HTTP tests catch an endpoint that forgets to
  call it.
- **The audit is a rule about metadata, not about safety.** An endpoint with
  `AllowAnonymous()` passes even if it should not be public. It forces a
  decision; reviewing the decision is still a human job.
- **Headers that impersonate users only exist in tests.** The fake handler is in
  the test project and is only registered by the factory. Putting such a scheme
  in the API "for local development" is a backdoor.
- **Exact status codes couple tests to the contract.** Choosing 404 instead of
  403 for another user's note (to hide that it exists) is a legitimate design
  change that breaks these tests on purpose. That is the contract being
  reviewed, not test fragility.

## Lab

The notes API is already implemented with JWT bearer authentication, an `Admin` policy based on a role, and a resource-based `NoteOwner` policy with its own handler. Your job is to write the MSTest tests that prove who gets in and who stays out, and an audit that catches the endpoint nobody remembered.

**What you will practice**

- A fake authentication scheme driven by headers, registered in the factory.
- Exact 401 and 403 assertions, from the side that must be refused.
- Unit tests for an `AuthorizationHandler` and for the policies through `IAuthorizationService`.
- An endpoint audit over `EndpointDataSource`, and (optional) real JWTs signed with a test key.

**Prerequisites:** the Authentication and Authorization Fundamentals concept, the Integration Testing ASP.NET Core with WebApplicationFactory concept and lab, .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with `TODO-NN: write this test` until you write it. The hints point at the tests a happy-path suite never writes. The optional TODOs add real tokens and ask you to break the production code on purpose.

## Documentation Links

- [Integration tests in ASP.NET Core (mock authentication), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests) (doc)
- [Resource-based authorization in ASP.NET Core MVC, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/security/authorization/resource-based) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [AuthorizationOptions.FallbackPolicy property, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authorization.authorizationoptions.fallbackpolicy) (doc)
- [Configure JWT bearer authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
