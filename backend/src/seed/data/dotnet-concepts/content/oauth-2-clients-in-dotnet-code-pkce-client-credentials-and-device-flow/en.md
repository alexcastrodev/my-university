---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

The other identity lessons show a .NET app as the server side of OAuth: validating tokens or signing users in with `AddOpenIdConnect`. This one is the other seat: your code is the OAuth client and has to get tokens, keep them, renew them and survive their failures. Three shapes cover almost everything: a service calling another service (client credentials), a console or desktop app with a human (authorization code with PKCE through the system browser) and a tool with no browser (device flow). For each I wrote the client in C# and ran it against a real authorization server (Keycloak in Docker, as in the [wire-level OAuth lesson](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles)), counting what the server saw: 50 concurrent callers and how many token requests they cause, a 401 handled with exactly one renewal, where the token handler goes relative to the retry handler, `private_key_jwt`, a loopback listener, `slow_down`, refresh rotation. MSAL and Duende.AccessTokenManagement are measured against the hand-written version. Anything I could not run (a real Entra tenant, DPAPI, the Keychain) is marked docs only. Versions: Keycloak 26.8.2 (`start-dev`, HTTP on 6700 and self-signed HTTPS on 6702), `Microsoft.Identity.Client` 4.92.0, `Duende.AccessTokenManagement` 4.3.0, `Microsoft.Extensions.Http.Resilience` 10.11.0 (Polly.Core 8.4.2), `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `Microsoft.IdentityModel.JsonWebTokens` 8.23.0, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- A worker or API that calls a partner or internal API with its own identity, with no user.
- A CLI or desktop tool where the developer signs in once and the tool calls an API as them.
- A tool on a server or in a container with no browser, signing in through a code typed on a phone.

## Deep Dive

### The lab

One Keycloak realm `demo` with clients `worker` (secret, access token lifetime set to 6 s so renewals are visible), `worker-long` (3600 s), `worker-jwt` (private key), `cli` (public, PKCE, loopback redirect), `cli-device` (device grant). One console process also hosts the resource server on 6701 (`AddJwtBearer` with the realm as authority, audience `orders-api`, `ClockSkew` zero unless said). "Token endpoint calls" are counted twice: by my provider, and by Keycloak's own `CLIENT_LOGIN` events read over the admin API, and the two always agreed. There is no real browser: a small `FakeBrowser` class follows redirects, keeps cookies, posts Keycloak's login form (`alice`) and the device consent page. Cookies are handled by hand: `CookieContainer` dropped Keycloak's legacy `Version=1` cookies (`cookie_not_found`).

### Service to service: a token handler you can read

```csharp
public async Task<string> GetAsync(string? rejected = null, CancellationToken ct = default)
{
    if (Fresh && _cached!.Value.Token != rejected) return _cached!.Value.Token;   // fast path, no lock
    await _gate.WaitAsync(ct);                                                    // SemaphoreSlim(1, 1)
    try
    {
        if (Fresh && _cached!.Value.Token != rejected) return _cached!.Value.Token; // someone refreshed while we waited
        var o = options.CurrentValue;                                             // IOptionsMonitor: secret rotation, below
        using var req = new HttpRequestMessage(HttpMethod.Post, o.TokenEndpoint) { Content = new FormUrlEncodedContent(
            [new("grant_type", "client_credentials"), new("scope", o.Scope)]) };
        req.Headers.Authorization = new("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{o.ClientId}:{o.ClientSecret}")));
        using var res = await factory.CreateClient("token").SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct)); var root = doc.RootElement;
        _cached = (root.GetProperty("access_token").GetString()!, DateTimeOffset.UtcNow.AddSeconds(root.GetProperty("expires_in").GetInt32()) - o.Skew);
        return _cached.Value.Token;
    }
    finally { _gate.Release(); }
}

public sealed class BearerHandler(TokenProvider tokens) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var bytes = request.Content is null ? null : await request.Content.ReadAsByteArrayAsync(ct);
        var token = await tokens.GetAsync(null, ct);
        request.Headers.Authorization = new("Bearer", token);
        var response = await base.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.Unauthorized) return response;
        response.Dispose();
        var retry = new HttpRequestMessage(request.Method, request.RequestUri);  // a sent request cannot be sent again
        if (bytes is not null) retry.Content = new ByteArrayContent(bytes);
        retry.Headers.Authorization = new("Bearer", await tokens.GetAsync(rejected: token, ct));
        return await base.SendAsync(retry, ct);                                 // one renewal, one repeat, never a loop
    }
}
// DI: the provider is a singleton (it owns the cache), the handler transient; the "token" client has no bearer handler
services.AddSingleton<TokenProvider>(); services.AddTransient<BearerHandler>(); services.AddHttpClient("token");
services.AddHttpClient("orders", c => c.BaseAddress = new("https://orders.example")).AddHttpMessageHandler<BearerHandler>();
```
`Skew` is how early the token is considered expired (30 s by default in my options), so a request never leaves with a token that dies in flight. The `rejected` argument is what stops a second caller from renewing again after the first one already did: a caller whose token got a 401 only refreshes if the cached token is still the one that failed.

### 50 callers, one token: the lock is the point

50 tasks start together with no token. Then 50 workers call the API every 100 ms for 20 s, with a 6 s token renewed at 5 s. Same code, with and without the semaphore:

```text
no gate : 50 cold calls -> 50 x 200, token endpoint calls: own 50, Keycloak events 50
no gate : 20 s, 50 workers: 9750 ok, 0 failed, token endpoint calls: own 150, Keycloak events 150
gated   : 50 cold calls -> 50 x 200, token endpoint calls: own 1,  Keycloak events 1
gated   : 20 s, 50 workers: 9750 ok, 0 failed, token endpoint calls: own 3,   Keycloak events 3
```
Nothing fails without the gate; it is just 50 times the load on the authorization server at every expiry (150 requests where 3 would do), which is how a fleet of pods trips a rate limit at the top of the hour. `HybridCache` stampede protection would also work, but its expiration is set before the factory runs, so it cannot follow `expires_in` (reasoned, not measured).

### The 401 and the retry handler

```text
API revokes the cached token (denylist on jti): call -> 200, token calls 2, API saw: /orders 401 | /orders 200
API rejects every token:                        call -> 401, token calls 3, API saw: /orders 401 | /orders 401
```
A revoked or rotated-key token costs one extra request and one renewal. If the API keeps saying 401 (wrong audience, a bug), the handler stops after one repeat and returns the 401, which is the only safe shape: a loop here is a denial of service against your own identity provider. Whether the token handler sits before or after `AddStandardResilienceHandler` matters when attempts are far apart. Setup: token lives 6 s, `/flaky` answers 503 twice, retries wait 4 s (`Retry.Delay`, constant, no jitter):

```text
token handler BEFORE the retry (outer): final 200, token calls 2
   API saw: t+0.0 503 | t+4.0 503 | t+8.1 401 | t+8.1 200
token handler AFTER the retry (inner):  final 200, token calls 2
   API saw: t+0.0 503 | t+4.0 503 | t+8.0 200
```
Outer: the header is stamped once, so the third attempt carries a token that expired in between, wastes a request on a 401 and only my 401 handling saves it. Inner: every attempt asks the provider, which is a cache read, and the renewal happens before sending. Put the token handler after resilience. Real tokens live 60 to 90 minutes in Entra (default, docs), so the stale attempt is rare, but the inner order costs nothing and removes it. The standard handler does not retry a 401.

### MSAL and Duende against the hand-written handler

```csharp
var msal = ConfidentialClientApplicationBuilder.Create("worker-long").WithClientSecret(secret)
    .WithAuthority("https://login.microsoftonline.com/<tenant>").Build();   // keep ONE instance: it owns the cache (docs)
var r = await msal.AcquireTokenForClient(["api://<api>/.default"]).ExecuteAsync();  // cache first, then the endpoint
// Duende.AccessTokenManagement 4.3.0
services.AddClientCredentialsTokenManagement().AddClient("worker-long", c => { c.TokenEndpoint = new(url);
    c.ClientId = ClientId.Parse("worker-long"); c.ClientSecret = ClientSecret.Parse(secret); c.Scope = Scope.Parse("orders.read"); });
services.AddClientCredentialsHttpClient("orders", ClientCredentialsClientName.Parse("worker-long"), c => c.BaseAddress = new(api));
```
```text
MSAL, 50 cold AcquireTokenForClient: Keycloak events 50, TokenSource IdentityProvider; next call: Cache
Duende, 50 cold calls through the client: 50 x 200, Keycloak events 1; 50 more calls: events 0
```
MSAL caches (the second call is `Cache`) but does not coalesce a concurrent cold start: 50 simultaneous calls made 50 requests. Warm the app at startup, or put a `SemaphoreSlim` around the first acquisition. Duende made 1 (and 2 with the 6 s token, where the 60 s `CacheLifetimeBuffer` its docs show exceeds the lifetime, so tune it for short tokens; Entra's 60 to 90 minute tokens are fine). MSAL is Microsoft's library: the `/.default` scope for client credentials is required against Entra (docs), it is built around Entra authorities, and against Keycloak it needs `WithOidcAuthority`, which accepts only HTTPS (`ArgumentException: The authority must use HTTPS scheme`, so the Keycloak above also listens on 6702 with a self-signed certificate and an `IMsalHttpClientFactory` that trusts it). That call is marked experimental for public clients (`MsalClientException` until `.WithExperimentalFeatures()`); for the confidential client it ran without. Prefer MSAL when the authority is Entra and you need its cache, certificates and Managed Identity; for another authority the handler above is a few dozen lines without a dependency.

Licenses, read on 2026-11-19: the Duende products page lists "Access Token Management (Open Source)", and the library's documentation says "Duende.AccessTokenManagement is released as open source under the Apache 2.0 license" (page last updated Feb 26, 2026); the NuGet metadata for 4.3.0 shows `Apache-2.0`. Duende IdentityServer, a different product, is commercial: the Community Edition page says it is free for for-profit organizations with under $1M projected annual gross revenue and under $3M in capital access, or non-profits with a published budget under $1M, and that evaluation, development, test and personal use need no license. Terms change, so recheck the pages.

### A signed assertion instead of a shared secret

`private_key_jwt` (RFC 7523) replaces `client_secret` with a short JWT signed by a private key only the client holds. The server stores the public key (a JWKS), so nothing worth stealing sits on the authorization server.

```csharp
new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
{
    Issuer = clientId, Audience = tokenEndpoint,                      // iss == sub == client_id
    Claims = new Dictionary<string, object> { ["sub"] = clientId, ["jti"] = Guid.NewGuid().ToString() },
    NotBefore = now, IssuedAt = now, Expires = now.AddSeconds(60),
    SigningCredentials = new(new RsaSecurityKey(rsa) { KeyId = "lab-1" }, SecurityAlgorithms.RsaSha256)
});   // sent as client_assertion with client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
```
```text
valid assertion              -> access_token 894 chars, expires_in 300
same assertion again (jti)   -> invalid_client: Token reuse detected
wrong audience               -> invalid_client: Invalid token audience
expired (clock 5 min behind) -> invalid_client: Token is not active (also at +30 s, nbf)
signed with another key      -> invalid_client: Signature on JWT token failed validation
```
Mint a new assertion for every token request (one use, `jti` is checked) and keep `exp` at a minute. A 30 second drift was already rejected, so run NTP on whatever signs. Keycloak needs the JWKS in the client's `jwks.string` attribute with `use.jwks.string` true; setting the JWKS without it loaded nothing (`Unable to load public key`). MSAL does the same with `.WithClientAssertion(o => ...)` (it calls back with `o.TokenEndpoint`, and it worked against Keycloak) or `.WithCertificate(cert)` against Entra, where the private key lives in Key Vault or the certificate store (docs).

### A user at a terminal: code with PKCE on a loopback port

RFC 8252 says a native app uses the system browser and receives the code on `http://127.0.0.1:<port>`, a port the OS picks at run time. Trimmed from the ~80 lines I ran:

```csharp
var verifier  = B64Url(RandomNumberGenerator.GetBytes(32));                      // 43 chars
var challenge = B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));      // code_challenge_method=S256
var state = B64Url(RandomNumberGenerator.GetBytes(16)); var nonce = B64Url(RandomNumberGenerator.GetBytes(16));
var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); int port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();  // a free port
var redirect = $"http://127.0.0.1:{port}/callback";
using var listener = new HttpListener(); listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
var pending = listener.GetContextAsync();                                       // listen BEFORE opening the browser
Process.Start(new ProcessStartInfo($"{auth}?response_type=code&client_id=cli&redirect_uri={Uri.EscapeDataString(redirect)}" +
    $"&scope=openid%20orders.read&state={state}&nonce={nonce}&code_challenge={challenge}&code_challenge_method=S256") { UseShellExecute = true });
var q = (await pending.WaitAsync(TimeSpan.FromMinutes(2))).Request.QueryString;   // then answer with a "you can close this tab" page
if (q["state"] != state) throw new InvalidOperationException("state mismatch");  // CSRF on the redirect
// back channel, public client: no secret, the verifier proves it is the same instance
POST token: grant_type=authorization_code, client_id=cli, code=q["code"], redirect_uri=redirect, code_verifier=verifier
```

```text
[browser] signed in as alice: 200
[cli] redirect_uri used: http://127.0.0.1:63933/callback
[cli] access_token 862 chars, expires_in 300, refresh_token yes
[cli] id_token valid=True, nonce matches=True, azp=cli, exp=2026-11-19 11:05:06Z
[cli] same id_token for audience other-app: valid=False (SecurityTokenInvalidAudienceException)
[cli] GET /orders with the user token: 200
```
Keycloak had `http://127.0.0.1/callback` registered and accepted the random port, the RFC 8252 loopback rule. Everything else was still exact: `/other`, `/callback/x` and `http://localhost:50001/callback` all gave `400 Invalid parameter: redirect_uri`. The MSAL docs register `http://localhost` as the redirect URI for Entra and the library fills in the port (docs only). The client validates the ID token (issuer, audience = its own `client_id`, signature from the discovery JWKS, `nonce`) as in the [OpenID Connect lesson](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout); it does not validate the access token, which is opaque to it and meant for the API. It reads `expires_in` from the response instead of decoding the JWT.

MSAL does the browser dance in one call, and it ran against Keycloak with my fake browser plugged into `SystemWebViewOptions.OpenBrowserAsync`:

```csharp
var app = PublicClientApplicationBuilder.Create("cli-msal").WithRedirectUri("http://localhost").Build();  // + WithAuthority for Entra
var r = await app.AcquireTokenInteractive(["openid", "orders.read"]).ExecuteAsync();   // MSAL opens the browser and runs the listener
// -> MSAL interactive: token 1018 chars, account alice
```

MSAL added `profile` and `offline_access` to the request on its own (Keycloak refused the first try with `Invalid scopes` until the client had them) and used `response_mode=form_post`, which my fake browser had to submit like a browser does. On Windows, MSAL can also use an embedded browser instead (docs only).

### No browser: the device flow

```csharp
var d = await Post(deviceEndpoint, new() { ["client_id"] = clientId, ["scope"] = "orders.read" });
Console.WriteLine($"visit {d.verification_uri} and enter {d.user_code}");      // RFC 8628: show a short code
int interval = d.interval; var deadline = DateTime.UtcNow.AddSeconds(d.expires_in);
while (DateTime.UtcNow < deadline.AddSeconds(interval))
{
    await Task.Delay(TimeSpan.FromSeconds(interval));
    var j = await Post(tokenEndpoint, new() { ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code", ["client_id"] = clientId, ["device_code"] = d.device_code });
    if (j.error is null) return j;                         // success
    if (j.error == "slow_down") interval += 5;             // RFC 8628 section 3.5
    else if (j.error != "authorization_pending") throw new InvalidOperationException(j.error);   // access_denied, expired_token
}
```
```text
interval 5, user approves after 7 s:  t=5.0 authorization_pending | t=10.0 token
polling every 1 s anyway:              t=1.0 authorization_pending | t=2.0 slow_down (next in 6 s) | t=8.0 token
nobody approves (lifespan 12 s):       t=2.0 ... t=12.0 authorization_pending | t=14.1 expired_token
```

Polling faster than `interval` got `slow_down` on the second request, and the client must add 5 s from then on. The loop checks `expired_token` from the server instead of trusting its own clock. Two surprises: the `cli` client, which requires PKCE, made the device endpoint answer `Missing parameter: code_challenge_method`, so the device grant got its own client; and MSAL `AcquireTokenWithDeviceCode` against the generic OIDC authority threw `NotImplementedException` in 4.92.0, so with Keycloak write the loop yourself (against Entra MSAL supports it, docs only). Device code phishing is the grant's weak point: the consent screen must name the app, and the grant should be off for clients that do not need it.

### Refresh tokens: rotation, reuse and where to keep them

```text
login: refresh_token ...xhC5eg
refresh #1 -> new refresh_token ...Uj_8_w (rotated: True), new access_token expires_in 300
replay the OLD refresh_token  -> invalid_grant: Maximum allowed refresh token reuse exceeded
then the NEWEST refresh_token -> invalid_grant: Session doesn't have required client
```

With rotation, every refresh returns a new refresh token that replaces the old one in your store, atomically, before the old one is forgotten. Replaying the old token made the server treat it as theft and end the whole session, so the newest token died too. Two practical rules follow. Refresh from one place at a time (the same single-flight gate as above, including across processes, or two concurrent refreshes kill each other). On `invalid_grant` do not retry: delete the stored tokens and start the interactive login again.

A refresh token is a password that outlives the session, so where it rests matters, and the platform decides. `ProtectedData` (DPAPI) is Windows only: here on macOS `Protect` threw `PlatformNotSupportedException`, as the docs say. The docs' cross-platform answer is the `Microsoft.Identity.Client.Extensions.Msal` package, whose `MsalCacheHelper` takes `WithMacKeyChain(...)` and `WithLinuxKeyring(...)` storage properties in the docs sample, so the cache lands in the Keychain and the Linux keyring instead of a plain file (docs only, not run; the page does not show the Windows side). A plain JSON file, even with `chmod 600`, is not encryption. For a service there is no refresh token to store: it asks again, which is why client credentials return none.

### Errors you will meet

```text
redirect_uri mismatch      -> 400 Invalid parameter: redirect_uri (the user sees it in the browser, your listener never fires)
token without the scope    -> aud=(none), API: 401 invalid_token, "The audience 'empty' is invalid"
secret rotated, not loaded -> 401 unauthorized_client (Keycloak; RFC 6749 says invalid_client, alert on both)
```

Secret rotation without a restart worked with `IOptionsMonitor<T>`: the provider reads `CurrentValue` on every refresh, and with a reloadable JSON file the same process went from `token ok` to `401 unauthorized_client` when I wrote a wrong secret and back to `token ok` when I fixed it. The secret itself belongs in user-secrets, an environment variable or Key Vault, never in `appsettings.json` in the repository. On Entra the audience is the other trap: the scope for client credentials must be `<resource>/.default` (docs), and the version of the token the API receives (v1 or v2, `aud` as `api://<id>` or the bare GUID) is decided by the API registration, as covered in the [OIDC and Entra lesson](openid-connect-entra-id-and-bff). ASP.NET Core's `JwtBearer` keeps its default `ClockSkew` unless you set it: an expired token still got 200 eight seconds after `exp`, and 401 (`The token expired at ...`) once I set it to zero.

### Which code for which job

| Scenario | Flow | Library or code | Where the secret lives | Trap |
|---|---|---|---|---|
| Worker or API calling an API | client credentials | token handler (above), MSAL or Duende | Key Vault, user-secrets; better a certificate or `private_key_jwt` | 50 cold callers make 50 token requests (MSAL) or 50 per expiry (no gate) |
| Same, no shared secret | client credentials with `client_assertion` | `JsonWebTokenHandler`, MSAL `WithCertificate` | private key in Key Vault or the certificate store | one assertion per request; clock drift |
| Console or desktop app with a user | code + PKCE, loopback | hand-written (~80 lines) or MSAL `AcquireTokenInteractive` | none (public client); refresh token in the OS store | redirect URI must match; `state` check; `form_post` |
| CLI on a server or SSH session | device flow | hand-written loop, MSAL against Entra | none (public client) | `slow_down`, `expired_token`, code phishing |
| Server-rendered web app with sessions | code + PKCE | `AddOpenIdConnect`, Microsoft.Identity.Web | server-side, cookie as session | covered in the OIDC lesson |
| Any client holding a refresh token | refresh with rotation | same store as the login | encrypted OS store | reuse kills the session; one refresher at a time |

`AddOpenIdConnect` is for a web app that signs users in and keeps a cookie session. Own client code (or MSAL) is for everything that has no browser session of its own: services, workers, CLIs, desktop apps.

## Trade-offs

- **Write the handler or take a library.** The handler is about 70 lines, has no license to read and works with any authorization server; MSAL brings Entra rules, certificates and a token cache; Duende brings coalescing, DPoP and user-token management as an Apache-2.0 package. Write it when the authority is not Entra or you want no dependency.
- **A gate costs a little latency.** Callers wait while one renews; the fast path (a fresh token) takes no lock. With a skew of a few seconds the wait is rare.
- **Early renewal versus 401 handling.** Renewing 30 s early avoids most 401s; the 401 repeat covers revocation and key rotation. Keep both, and only one repeat.
- **Secret versus assertion.** A secret is simple and leaks in logs and repositories; a signed assertion needs a key, a clock and a fresh JWT per request, and nothing reusable at rest on the server.
- **Loopback versus device flow.** Loopback is the better experience but needs a local browser and a free port; the device flow needs neither and is easier to phish.
- **Own PKCE code versus MSAL.** The hand-written flow is small and visible; MSAL handles the browser, ports, scopes and the cache, but adds scopes you did not ask for (`profile`, `offline_access`) and some of its generic-authority features were experimental or missing in 4.92.0.
- **Lab limits.** Keycloak is not Entra: defaults such as `unauthorized_client` for a bad secret, loopback port matching and refresh reuse handling differ by server, so re-measure against yours.

## Documentation Links

- [Microsoft Authentication Library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/) (doc)
- [Client credential flows in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/client-credential-flows) (doc)
- [Acquire tokens interactively with MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/acquiring-tokens-interactively) (doc)
- [Device code flow in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/device-code-flow) (doc)
- [Token cache serialization in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/how-to/token-cache-serialization) (doc)
- [Access tokens in the Microsoft identity platform, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) (doc)
- [Scopes and the .default scope, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc) (doc)
- [Make HTTP requests using IHttpClientFactory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests) (doc)
- [Build resilient HTTP apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [Access Token Management, Duende documentation](https://docs.duendesoftware.com/accesstokenmanagement/) (doc)
- [IdentityServer Community Edition, Duende](https://duendesoftware.com/products/communityedition) (doc)
- [RFC 8252, OAuth 2.0 for Native Apps, IETF](https://datatracker.ietf.org/doc/html/rfc8252) (doc)
- [RFC 8628, OAuth 2.0 Device Authorization Grant, IETF](https://datatracker.ietf.org/doc/html/rfc8628) (doc)
- [RFC 7636, Proof Key for Code Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 7523, JWT Profile for Client Authentication, IETF](https://datatracker.ietf.org/doc/html/rfc7523) (doc)
