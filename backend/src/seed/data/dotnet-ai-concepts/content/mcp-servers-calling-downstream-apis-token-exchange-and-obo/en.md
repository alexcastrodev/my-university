---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

An MCP server often has to call another API (an orders service) on behalf of the person who called the tool,
and the spec forbids the easy way: forwarding the token it received. This lesson measures the options with
three services of my own (an MCP server, an orders API that checks `aud`, Keycloak) and no model: token
passthrough, the server's own credentials, RFC 8693 token exchange with `IHttpContextAccessor` and a
`DelegatingHandler`, its cache and failures, a per-user store for third-party tokens reached through URL
elicitation, audit and trace propagation. Entra ID on-behalf-of and gateways are docs only. The protocol
theory is in the identity lesson "OAuth Token Exchange, Delegation, and On-Behalf-Of"; this is the MCP and .NET side.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`), `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `Microsoft.Extensions.Caching.Hybrid` 10.11.0,
Data Protection from the ASP.NET Core 10.0 shared framework, TFM `net10.0`, SDK 10.0.100, spec 2026-07-28.

## Use Cases

- An MCP tool that reads or writes in an internal API and must respect what each user may see.
- Letting a tool use a third-party account (a code host) the user consents to once.

## Deep Dive

### The lab and the rule

`mcp-client` (public), `mcp-server` (confidential, port 6522, `aud` = `http://localhost:6522/mcp`),
`orders-api` (6523, `ValidAudience = orders-api`) and a Keycloak realm with alice and bob. Alice owns order 1,
bob order 2; the API answers 200 to the owner or to a token whose `scope` has `orders:admin`. The spec: the
server "MUST NOT pass through the token it received from the MCP client"; the upstream token is "a separate
token, issued by the upstream authorization server". One tool; only the
`DelegatingHandler` on its `HttpClient` changes:

```csharp
[McpServerTool(Name = "get_order"), Description("Returns an order by id.")]
public async Task<string> GetOrder(int orderId, CancellationToken ct)
{   using var resp = await f.CreateClient("orders").GetAsync($"/orders/{orderId}", ct);
    return resp.IsSuccessStatusCode ? await resp.Content.ReadAsStringAsync(ct)
        : throw new McpException($"the orders service refused the request ({(int)resp.StatusCode})"); }
```

### 1. Passthrough: it works only while the downstream is careless

```csharp
r.Headers.Authorization = AuthenticationHeaderValue.Parse(acc.HttpContext!.Request.Headers.Authorization.ToString()); // ANTIPATTERN
```

Alice's token has `aud=[http://localhost:6522/mcp, mcp-server]`. One `get_order` through the passthrough server:

```text
orders API checks aud, alice's usual token:            IsError=True "... refused the request (401)"
orders API checks aud, token that also has orders-api: "order 1: 2 x keyboard (owner alice)"   (aud=orders-api,http://localhost:6522/mcp,mcp-server)
orders API ValidateAudience=false, usual token:        "order 1: 2 x keyboard (owner alice)"
```

Replayed straight at the API, the token for the MCP server and one of another client (no `aud`) both got 200
with `ValidateAudience=false` and 401 with the check on. So passthrough breaks for honest tokens, and "works"
only because the API accepts any token of the realm, including one a compromised MCP server holds. A token
with both audiences is usable at the API directly: that is the damage. The API log shows `azp=mcp-client`.

### 2. The server's own credential: it works, and loses the user

A handler requests `client_credentials` with `scope=orders:admin` and caches it:

```text
alice get_order:1 -> "order 1: 2 x keyboard (owner alice)"
alice get_order:2 -> "order 2: 1 x monitor (owner bob)"        <- bob's data
bob   get_order:1 -> "order 1: 2 x keyboard (owner alice)"      <- alice's data
orders-api GET /orders/2 sub=f9423776 azp=mcp-server aud=orders-api scope=[orders:admin] -> 200
```

One token (`clientCredentials=1` for three calls) and the API sees only the service account: no user, no
per-user rule. Authorization moved into the MCP server's code, where a missing `if` or a prompt-injected
argument turns it into a confused deputy (alice reads bob's order). Fine for data that is not per user.

### 3. Token exchange (RFC 8693) with Keycloak

Standard token exchange is supported since Keycloak 26.2 (2025-04-11) and on by default in 26.8.2; the
exchanging client must be confidential with the switch on (`standard.token.exchange.enabled`). Two setup details:

- the subject token needs the requesting client in `aud`: an Audience mapper on `mcp:tools` adds both the MCP URL (what the MCP spec validates) and `mcp-server` (what Keycloak requires);
- the target audience must come through a scope: `orders-api` is an Audience mapper in the optional scope `orders:read`.

```text
curl .../token -u mcp-server:mcp-secret -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token=$ALICE -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d audience=orders-api -d scope=orders:read
user token:      sub=11111111 aud=[http://localhost:6522/mcp, mcp-server] azp=mcp-client scope="openid mcp:tools"
exchanged token: sub=11111111 aud=orders-api azp=mcp-server scope=orders:read expires_in=300   (no act claim)
```

The user stays in `sub`, the downstream audience is the only one, and `azp` says who acted. The measured
failures, all from the same endpoint:

| request | answer |
| --- | --- |
| no `scope` | 400 `invalid_request`: "Requested audience not available: orders-api" |
| unknown `audience` | 400 `invalid_client`: "Audience not found" |
| wrong client secret | 401 `unauthorized_client` |
| subject token of another client (no `mcp-server` in `aud`) | 403 `access_denied`: "Client is not within the token audience" |
| `scope=orders:read orders:admin` | 200, token has both scopes |
| subject token after the user's sessions were ended | 400 "Invalid token" |

The upscale row matters: the exchanging client may ask for any of its optional scopes, so the user never
consented to `orders:admin` and still got it; the docs restrict this with the `downscope-assertion-grant-enforcer`
client policy (docs only). Delegation with `act` is a separate preview feature (`token-exchange-delegation`,
an `actor_token`), not measured here. After the sessions ended, introspection reported the earlier exchanged
token as `active: false`, but an API validating the JWT offline accepts it until `exp`, so keep the cache short.

### The .NET side: accessor, handler, cache

```csharp
public sealed class TokenExchangeHandler(IHttpContextAccessor acc, HybridCache cache, IHttpClientFactory f) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
    {
        var http = acc.HttpContext ?? throw new InvalidOperationException("no current MCP request"); // none on stdio
        var subject = http.Request.Headers.Authorization.ToString()["Bearer ".Length..];
        var key = $"xchg|{http.User.FindFirst("sub")!.Value}|orders-api";
        var token = await cache.GetOrCreateAsync(key, c => new ValueTask<string>(Exchange(subject, c)),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromSeconds(60), Flags = HybridCacheEntryFlags.DisableDistributedCache },
            cancellationToken: ct);
        r.Headers.Authorization = new("Bearer", token);
        return await base.SendAsync(r, ct);
    }
    // Exchange(): POST the form above plus client_id/client_secret; non-2xx throws TokenExchangeException
}   // AddHttpContextAccessor(); AddHybridCache(); AddHttpClient("orders", ...).AddHttpMessageHandler<TokenExchangeHandler>();
```

`IHttpContextAccessor` is the filters lesson's route to the current request. The key is `sub` plus target
audience (add `iss` or `tid` with several tenants), the lifetime far below the token's 300 seconds. With `TTL=3`:

```text
                                      IMemoryCache (TryGetValue, call, Set)   HybridCache.GetOrCreateAsync
10 concurrent calls, empty cache      exchanges=10                            exchanges=1
one call after the TTL (3 s)          exchanges=11                            exchanges=2
first call of bob                     exchanges=12                            exchanges=3
```

`IMemoryCache` alone lets ten simultaneous first calls each hit Keycloak; `HybridCache` runs one factory per
key and the others wait. When the exchange fails the model must not read the token endpoint's answer
(`SECRET=bad`):

```csharp
catch (Exception e) when (e is TokenExchangeException or HttpRequestException)
{ var id = Guid.NewGuid().ToString("N")[..8]; log.LogWarning("ref={Ref} {E}", id, e.Message);
  throw new McpException($"the orders service is unavailable, reference {id}"); }
```

```text
client sees: IsError=True "An error occurred invoking 'get_order': the orders service is unavailable, reference d4012592"
server log:  ref=d4012592 TokenExchangeException: token endpoint 401: {"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"}
```

The reference ties the two (the filters lesson's standardizing filter does the same). A downstream 401 or
403 returns only the status: alice asking for order 2 got `refused the request (403)`.

### 4. Entra ID on-behalf-of (docs only)

No tenant here. Entra's OBO is its own grant, not RFC 8693: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
the incoming token as `assertion`, `requested_token_use=on_behalf_of` and the downstream `scope`. From the Learn page:

- the assertion's `aud` must be the middle tier ("Applications can't redeem a token for a different app"), a confidential client; Microsoft.Identity.Web hides the call:

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration, "AzureAd")
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddDownstreamApi("Orders", builder.Configuration.GetSection("Orders"))   // BaseUrl + Scopes (an array)
    .AddInMemoryTokenCaches();
// in the tool: await downstreamApi.CallApiForUserAsync("Orders", o => o.RelativePath = "orders/1");  (or ITokenAcquisition.GetAccessTokenForUserAsync)
```

- no user interaction is possible, so consent comes first: `knownClientApplications` with `.default`, preauthorized applications, or admin consent. OBO uses delegated scopes only, never app roles;
- Conditional Access (MFA, sign-in frequency) on the downstream returns `interaction_required` with a `claims` value; the middle tier must answer 401 with `WWW-Authenticate` carrying the claims challenge so the caller reauthorizes. For MCP that is the step-up of the filters lesson;
- `Scopes` must be an array in configuration, or `IDownstreamApi` calls anonymously and gets 401;

### 5. A third-party account the user consents to

A code host is not your AS, so there is nothing to exchange: the user consents once, outside the MCP client,
and the server stores the token per user. The MRTR lesson measured URL mode; `list_repos` throws
`InputRequiredException` with `Mode = "url"` when it has no token for the caller:

```csharp
var flow = dp.CreateProtector("flow").ToTimeLimitedDataProtector().Protect(sub, TimeSpan.FromMinutes(10));
throw new InputRequiredException(new Dictionary<string, InputRequest> { ["consent"] = InputRequest.ForElicitation(
    new ElicitRequestParams { Mode = "url", Message = "Connect your code host account.",
        Url = $"https://mcp.example.com/connect/github?flow={Uri.EscapeDataString(flow)}" }) });
// ThirdPartyTokens: (sub, provider) -> (IDataProtector.Protect(token), expiresAt); Save, Get, Revoke
```

```text
alice list_repos: [handler] mode=url message="Connect your code host account." url=http://127.0.0.1:6522/connect/github?flow=CfDJ8CNx...
                  [browser] GET consent page -> connected
                  IsError= "repos of token gho_1111_f2...: [alpha, beta]"          (same CallToolAsync)
alice list_repos again: no handler call;  bob list_repos: asks again (own consent), token gho_2222_c1...
store blob for alice: CfDJ8CNxsmSr6TxIvG4iGAQCOKi8v8Vey4Je7v5m... len=155, contains "gho_": 0
DELETE /connections/github as alice: 204 (again: 404), next call asks for consent; TP_TTL=4, after 5 s: asks again
forged ?flow=CfDJ8forged: 400 "invalid or expired flow"
```

The client handler saw a URL and a message, never a token. Production needs what the lab skips: a consent
page that signs the user in and checks its `sub` against the one in `flow` (otherwise the link alone binds a
token to alice), the provider's real code exchange, a durable store with a shared Data Protection key ring,
and refresh. The spec's token-theft section asks for secure storage of tokens "cached or logged on the server".

### 6. A gateway in front (docs only)

A reverse proxy (YARP request transforms, Azure API Management policies) validates the MCP token, replaces
`Authorization` and injects the downstream credential (managed identity, exchanged token, API key): the MCP
server holds no downstream secret and the policy lives in one place. A policy that forwards the incoming
header is passthrough again, and one that always injects a service credential is approach 2, moved.

### 7. Audit and trace propagation

The call-tool filter of the filters lesson logs the user, the MCP client (`azp` of the incoming token), the
tool and the outcome. The client started an `Activity` and `HttpClient` sent `traceparent`; ASP.NET Core
adopted it in the MCP server and the handler's `HttpClient` passed it on, with no code:

```text
audit tool=get_order sub=11111111 client=mcp-client trace=b726e12e ok=True
orders-api GET /orders/1 sub=11111111 azp=mcp-server aud=orders-api scope=[orders:read] trace=b726e12e traceparent=b726e12e -> 200
audit tool=get_order sub=11111111 client=mcp-client trace=48da4444 McpException          (order 2: the API said 403)
```

Record `sub`, MCP client, tool, relevant arguments (not secrets) and trace id on the MCP side; the API has
`sub` and `azp=mcp-server`, and the trace id joins the two. Gaps: the API knows neither the tool nor the MCP
client, and in 2.4.0 a denied `[Authorize]` call never reaches an ordinary call-tool filter (use a message filter).

### Choosing

| Approach | User identity kept | Risk | When |
| --- | --- | --- | --- |
| Passthrough | yes, but wrong audience | forbidden; breaks with `aud` checks, leaks usable tokens | never |
| Server client credentials | no | confused deputy, one broad credential | data that is not per user, jobs |
| RFC 8693 exchange (Keycloak) | yes (`sub`), `azp` names the server | upscaling by default, cache outlives sessions, setup of audiences | one AS you control, per-user rules in the API |
| Entra OBO (docs only) | yes | consent set up first, claims challenge | Entra tenant, downstream protected by Entra |
| URL elicitation + token store | yes, per user and provider | you keep third-party tokens | APIs outside your AS (code host, calendar) |
| Gateway injects credentials | depends on the policy | passthrough or service credential in disguise | many APIs, central policy |

## Trade-offs

- **Exchange per call vs cache.** A cache removes a round trip and a stampede, but a revoked session keeps working until the entry expires; the lab used 60 seconds.
- **The user's identity vs a simple downstream.** Exchange puts the user in `sub` so the API enforces its own rules, at the cost of AS setup (audiences, scopes, client policy); a service credential is two lines and moves every rule into your tool code.
- **Storing third-party tokens.** Consent through URL mode keeps them away from the client, and now your server is a vault: encrypt, expire, allow revoking.

## Documentation Links

- [Authorization Security Considerations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (doc)
- [Security Best Practices, token passthrough, modelcontextprotocol.io](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) (doc)
- [Elicitation, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) (doc)
- [OAuth 2.0 Token Exchange, RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) (doc)
- [Configuring and using standard token exchange, Keycloak](https://www.keycloak.org/securing-apps/token-exchange) (doc)
- [Standard Token Exchange is now officially supported in Keycloak 26.2, Keycloak blog](https://www.keycloak.org/2025/05/standard-token-exchange-kc-26-2) (doc)
- [Microsoft identity platform and OAuth 2.0 On-Behalf-Of flow, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow) (doc)
- [Configure a web API that calls web APIs, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-web-api-call-api-app-configuration) (doc)
- [HybridCache library in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid) (doc)
- [Request and response transforms, YARP](https://microsoft.github.io/reverse-proxy/articles/transforms.html) (doc)
- [Secure access to MCP servers in Azure API Management, Microsoft Learn](https://learn.microsoft.com/en-us/azure/api-management/secure-mcp-servers) (doc)
