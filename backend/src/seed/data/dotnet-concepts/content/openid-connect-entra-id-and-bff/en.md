---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A browser app should not see a password, and an API should not trust a user name typed into a form: the user signs in at an identity provider, the web app receives proof through OpenID Connect (OIDC), and the API accepts only access tokens issued for it. In ASP.NET Core that is two layers. `AddOpenIdConnect` plus `AddCookie` run the authorization code flow with PKCE and keep the session in a cookie; `Microsoft.Identity.Web` wraps the same handlers for Microsoft Entra ID and adds Entra rules (audience, issuer per tenant, `scp` versus `roles`, token acquisition for downstream APIs). For single-page apps, the backend-for-frontend (BFF) pattern keeps every token on the server. This concept builds on the [fundamentals](authentication-and-authorization-fundamentals) and [JWT bearer](jwt-bearer-and-aspnet-core-identity) lessons and does not repeat them. I could not use a real Entra tenant, so I wrote a small local OpenID provider and pointed both libraries at it, then walked every redirect with an `HttpClient`. The Entra-only parts (portal registration, consent, the real `https://login.microsoftonline.com/<tenant>/v2.0` authority) come from the docs and are attributed as such. Versions used: SDK 10.0.100, `Microsoft.AspNetCore.Authentication.OpenIdConnect` 10.0.14, `Microsoft.Identity.Web` 4.16.1 (which brought `Microsoft.IdentityModel.*` 8.23.0 and MSAL `Microsoft.Identity.Client` 4.90.1).

## Use Cases

- A server-rendered app (Razor Pages, MVC, Blazor Server) where employees sign in with their Entra ID account.
- An API that accepts Entra access tokens from user-facing apps (delegated `scp`) and from daemons (application `roles`) on the same endpoint.
- A React or Angular SPA served by an ASP.NET Core host that must call protected APIs without ever holding a token in JavaScript.
- Diagnosing `Correlation failed.` or `Unable to unprotect the message.State.` after moving an app behind a load balancer or scaling it out.

## Deep Dive

### The lab: a local stand-in for Entra

One console process starts four Kestrel apps on HTTPS (development certificate): a local OpenID provider on 5651 shaped like Entra's URLs (`/{tenant}/v2.0/...`), the web app/BFF on 5652, an API protected by `Microsoft.Identity.Web` on 5653 and a second web instance on 5654. The provider is a few minimal API endpoints: discovery, a JWKS with one RSA key, an `authorize` endpoint with no login screen, a `token` endpoint that checks PKCE and returns a signed `id_token` and `access_token`, plus `userinfo`, `logout` and an optional `par`. All secrets are fake strings. The walker uses `new HttpClientHandler { CookieContainer = jar, AllowAutoRedirect = false }` and prints each hop.

### Wiring: the cookie is the session, OIDC only challenges

```csharp
builder.Services.AddAuthentication(o =>
{
    o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    o.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
})
.AddCookie(o => o.Cookie.Name = "__Host-bff")
.AddOpenIdConnect(o =>
{
    o.Authority = "https://localhost:5651/<tenant>/v2.0"; // Entra: https://login.microsoftonline.com/<tenant>/v2.0
    o.ClientId = "<web-client-id>";
    o.ClientSecret = "<from user-secrets or Key Vault>";
    o.ResponseType = "code";
    o.SaveTokens = true;
    o.GetClaimsFromUserInfoEndpoint = true;
    o.Scope.Add("offline_access");
    o.Scope.Add("api://<api-client-id>/access_as_user");
    o.MapInboundClaims = false;
    o.TokenValidationParameters.NameClaimType = "name";
});
```

The endpoints come from `{Authority}/.well-known/openid-configuration`. A fresh `OpenIdConnectOptions` shows why `ResponseType = "code"` must be set: the default is still `id_token`, not the code flow the docs recommend, and `UsePkce` only applies to code.

```text
ResponseType=id_token ResponseMode=form_post UsePkce=True PAR=UseIfAvailable MapInboundClaims=True SaveTokens=False GetClaimsFromUserInfoEndpoint=False
Scope=openid profile RemoteAuthenticationTimeout=00:15:00 CallbackPath=/signin-oidc SignedOutCallbackPath=/signout-callback-oidc
```

### What the challenge redirect really contains

An anonymous `GET /me` (with the provider not advertising PAR):

```text
GET https://localhost:5652/me -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/authorize
    client_id = aaaaaaaa-0000-0000-0000-00000000000a
    redirect_uri = https://localhost:5652/signin-oidc
    response_type = code
    scope = openid profile offline_access api://bbbbbbbb-0000-0000-0000-0000000000...
    code_challenge = Q2wJ0qkfIiohAkPvx7-FZ3QUhaulpetIc-sGMeuZzDs
    code_challenge_method = S256
    response_mode = form_post
    nonce = 639287987807274850.Y2VmMWJkYTItNmY4ZS00OTVmLThiNzgtYjhiNjc3ZGNhYTIwYTg...
    state = CfDJ8Bpa4M6axNlNppikrVZHS9svLknz2m1wltYza-4wcjE0gWPjas4HeOo5L-eVNwaQzE...
    x-client-SKU = ID_NET10_0
    x-client-ver = 8.23.0.0
  Set-Cookie: .AspNetCore.OpenIdConnect.Nonce.CfDJ8Bpa... (1 chars); expires=Wed, 28 Oct 2026 15:54:40 GMT; path=/signin-oidc; secure; samesite=none; httponly
  Set-Cookie: .AspNetCore.Correlation.WSwaXOVT7DqtDRU9... (1 chars); expires=Wed, 28 Oct 2026 15:54:40 GMT; path=/signin-oidc; secure; samesite=none; httponly
```

`code_challenge` is the SHA-256 of a secret `code_verifier` the handler keeps. `state` starts with `CfDJ8`, the Data Protection header: it is the encrypted `AuthenticationProperties` (return URL, the verifier, a correlation id). `nonce` will come back inside the id_token. The two cookies, 15 minutes long (`RemoteAuthenticationTimeout`), are `SameSite=None; Secure` because the provider sends the answer back with a cross-site POST (`response_mode=form_post`).

### The callback: PKCE, token exchange, cookie sign-in

```text
GET authorize -> 200
  form_post to https://localhost:5652/signin-oidc with fields: code, state
  [idp] POST /token body: client_id, client_secret, code, grant_type, redirect_uri, code_verifier
  [idp] PKCE S256(code_verifier) == code_challenge: True; redirect_uri matches: True
POST /signin-oidc -> 302
  Location: /me
  Set-Cookie: .AspNetCore.Correlation.WSwaXOVT7DqtDRU9... (0 chars); expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/signin-oidc; secure; samesite=none; httponly
  Set-Cookie: __Host-bff=chunks-2 (8 chars); path=/; secure; samesite=lax; httponly
  Set-Cookie: __Host-bffC1=CfDJ8Bpa4M6axNlNppikrVZHS9t... (3996 chars); path=/; secure; samesite=lax; httponly
  Set-Cookie: __Host-bffC2=h6Lc3XuJ-4J9rnO4Hca1Y5CHaOP... (127 chars); path=/; secure; samesite=lax; httponly
```

The handler validated `state` and the correlation cookie, redeemed the code over the back channel with the secret and the verifier (a stolen code is useless without both), validated the id_token signature, issuer, audience and nonce, and then signed in the cookie scheme. From then on, each request is authenticated by the cookie alone; the provider is not contacted again.

### PAR is used by default since .NET 9

The docs say Pushed Authorization Requests (RFC 9126) are used by default when the server supports them. I added `pushed_authorization_request_endpoint` to the discovery document and ran the same request:

```text
  [idp] POST /par body: client_id, redirect_uri, response_type, scope, code_challenge, code_challenge_method, response_mode, nonce, state, client_secret
GET https://localhost:5652/me -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/authorize
    client_id = aaaaaaaa-0000-0000-0000-00000000000a
    request_uri = urn:ietf:params:oauth:request_uri:70915645
```

Confirmed: with no code change, the parameters went over an authenticated back-channel POST and the browser URL carried only `client_id` and `request_uri`. `PushedAuthorizationBehavior.Require` fails if the server has no PAR endpoint; `Disable` turns it off.

### SaveTokens and GetTokenAsync

```text
stored tokens: access_token(874), id_token(1027), refresh_token(21), token_type(6), expires_at(33)
access_token via GetTokenAsync is a JWT: True
```

`await HttpContext.GetTokenAsync("access_token")` reads them from the authentication properties, which live inside the encrypted cookie. The price is size: with `SaveTokens = false` the cookie was one 1264-character value; with tokens it grew past 4 KB and the cookie manager split it into `__Host-bffC1` and `C2`. Every request carries those bytes, and real Entra tokens are larger than mine. `SaveTokens` also does not refresh anything: when `expires_at` passes, renewing with the refresh token is your code's job (or `Microsoft.Identity.Web`'s token cache, below).

### Claims: MapInboundClaims, sub and the name

With `MapInboundClaims = false` and `NameClaimType = "name"`, `/me` printed the claims as sent, plus `email` from the userinfo endpoint:

```text
Identity.Name=Ana Silva
  sub = pairwise-sub-ana
  oid = oid-ana
  tid = 11111111-2222-3333-4444-555555555555
  name = Ana Silva
  preferred_username = ana@contoso.example
  sid = session-1
  email = ana@contoso.example
```

Protocol claims (`nonce`, `aud`, `iss`, `iat`, `exp`, `ver`) were removed by the default claim actions, and the `website` field from userinfo was dropped because only mapped keys are copied (`ClaimActions.MapUniqueJsonKey("website", "website")` adds it). With the default `MapInboundClaims = true`, `sub` became `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, `oid` and `tid` became `http://schemas.microsoft.com/identity/claims/...` URIs, `name` stayed `name`, and `Identity.Name` was empty because the default `NameClaimType` is the long URI. The same trap from the JWT lesson, in the cookie handler. In Entra, `sub` is pairwise (different per app), so the docs use `oid` plus `tid` as the stable user key.

### Sign-out: RP-initiated and front-channel

`/logout` returns `Results.SignOut(new() { RedirectUri = "/signed-out" }, [CookieAuthenticationDefaults.AuthenticationScheme, OpenIdConnectDefaults.AuthenticationScheme])`:

```text
GET /logout -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/logout
    post_logout_redirect_uri = https://localhost:5652/signout-callback-oidc
    id_token_hint = eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIiwidHlwIjoiSldUIn0...
  Set-Cookie: __Host-bff= (0 chars); expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=lax; httponly
GET idp logout -> 302
  Location: https://localhost:5652/signout-callback-oidc
GET signout-callback -> 302
  Location: /signed-out
```

Signing out only the cookie scheme would leave the provider session alive, and the next challenge would sign the user back in silently. The id_token needed for `id_token_hint` came from `SaveTokens`. Entra refuses the return trip unless the callback URI is registered, per the docs. The handler also serves front-channel logout at `RemoteSignOutPath` (`/signout-oidc`): a request with the right `iss` and `sid` cleared the cookie (`/me` then gave 302), and a different `sid` changed nothing (200). In a browser that request comes from a cross-site iframe, which does not carry a `SameSite=Lax` cookie, so do not rely on it alone.

### Correlation failed and Unable to unprotect the message.State

```text
  [A] AuthenticationFailureException: An error was encountered while handling the remote login. | inner: Correlation failed.
callback without the correlation cookie -> 500
  [B] AuthenticationFailureException: An error was encountered while handling the remote login. | inner: Unable to unprotect the message.State.
callback delivered to instance B (shared keys: False) -> 500
callback delivered to instance B (shared keys: True) -> 302 /me
```

`Correlation failed.` appears when the browser does not send back the correlation cookie: an expired login (over 15 minutes), a different host name, or a `Secure` cookie set over plain HTTP. `Unable to unprotect the message.State.` appears when the instance receiving the callback cannot decrypt `state`, typically two replicas with separate key rings; once both used the same directory and application name, the callback succeeded. Configure that as shown in [Data Protection](data-protection-key-ring-and-purposes). Behind a TLS-terminating proxy the handler builds `redirect_uri` from the request it sees:

```text
port 5655 UseForwardedHeaders=False: redirect_uri=http://localhost:5655/signin-oidc
port 5656 UseForwardedHeaders=True: redirect_uri=https://app.contoso.example/signin-oidc
```

The first value would be rejected by Entra as unregistered, and the correlation cookie it sets is still `secure` over HTTP, which a browser drops. `UseForwardedHeaders` must run before authentication.

### Protecting the API with Microsoft.Identity.Web

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

app.MapGet("/orders", ...).RequireAuthorization().RequireScope("access_as_user");
app.MapGet("/orders/all", ...).RequireAuthorization()
   .RequireScopeOrAppPermission(["access_as_user"], ["Orders.Read.All"]);
app.MapGet("/admin", ...).RequireAuthorization(p => p.RequireRole("Orders.Admin"));
```

The `AzureAd` section holds `Instance` (`https://login.microsoftonline.com/` in Entra, `https://localhost:5651/` here), `TenantId` and `ClientId`; `Instance` + `TenantId` + `/v2.0` became the authority. The configured options showed `MapInboundClaims=True`, no `ValidAudiences`, `IssuerValidator=AadIssuerValidator` and the URI `NameClaimType`. I signed tokens with the provider's key:

```text
v2 user token, scp access_as_user                /orders      200 orders for  (oid oid-x, scp access_as_user)
aud api://<clientId>                             /orders      401  Bearer error="invalid_token", error_description="The audience '(null)' is invalid"
aud another-api                                  /orders      401  Bearer error="invalid_token", error_description="The audience '(null)' is invalid"
scp Orders.Write only                            /orders      403
app-only token, roles Orders.Read.All            /orders      403
app-only token, roles Orders.Read.All            /orders/all  200 all orders
user token, roles Orders.Admin                   /admin       200 admin
other tenant (iss and tid)                       /orders      401  Bearer error="invalid_token", error_description="The issuer '(null)' is invalid"
```

Audience and issuer come from the Entra conventions, not from settings I wrote. A missing scope is a 403 after authentication; the Microsoft.Identity.Web authorization docs show an `insufficient_scope` JSON body, but the minimal API `RequireScope` returned an empty 403 in 4.16.1. Two details: the `scp` claim arrived renamed to `http://schemas.microsoft.com/identity/claims/scope`, and `Identity.Name` was empty ("orders for  ") because a v2 token's `name` claim is not mapped to the URI name type. After `builder.Services.Configure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o => o.TokenValidationParameters.NameClaimType = "name")` it printed `orders for Caller`.

### v1 and v2 access tokens

The API registration decides the format, per the Entra docs: `requestedAccessTokenVersion` in the manifest (`accessTokenAcceptedVersion` in older manifests), where `null` or `1` gives v1 tokens even if the client used the v2 endpoint. A v1 token has `iss=https://sts.windows.net/<tid>/` and usually `aud=api://<clientId>`. My first v1 test failed with 401; after I added the v1 discovery document (`/{tenant}/.well-known/openid-configuration`), the provider log showed `AadIssuerValidator` fetching it and the token passed:

```text
v1 issuer sts.windows.net, ver 1.0               /orders      200 orders for  (oid oid-x, scp access_as_user)
v1-shaped token at v2 issuer                     /orders      200 orders for  (oid oid-x, scp access_as_user)
```

Both tokens carried `aud=api://<clientId>`, which was accepted only when `ver` was 1.0 (the `ver 2.0` token with that audience got 401 above). Setting the version to 2 in the manifest gives one predictable shape.

### Web apps with Microsoft.Identity.Web, and calling downstream APIs

`AddMicrosoftIdentityWebApp` against the same provider set `NameClaimType=preferred_username` (`/me` printed `Name=ana@contoso.example`) and challenged with `response_type=id_token` and no PKCE. After adding a client secret and `.EnableTokenAcquisitionToCallDownstreamApi([...]).AddInMemoryTokenCaches()`, the challenge switched to `response_type=code` with `code_challenge` and `offline_access`, and MSAL took over redeeming the code. That is where the stand-in stops: MSAL validated the unknown authority with Microsoft and failed with `MsalServiceException: AADSTS50049: Unknown or invalid instance.` The rest comes from the docs: `AddDownstreamApis(config.GetSection("DownstreamApis"))` registers named APIs (`BaseUrl`, `Scopes`) and `IDownstreamApi.GetForUserAsync<T>("OrdersApi", o => o.RelativePath = "orders")` calls one on behalf of the user, with MSAL caching and refreshing tokens. `ITokenAcquisition.GetAccessTokenForUserAsync(scopes)` gives the raw token, `AddMicrosoftGraph` (package `Microsoft.Identity.Web.GraphServiceClient`) gives a `GraphServiceClient`, and `[AuthorizeForScopes]` turns a `MicrosoftIdentityWebChallengeUserException` (consent or MFA needed) into a new challenge. Per the docs, an API calling another API uses the same `...ForUserAsync` calls, which then run the on-behalf-of flow. The docs recommend `AddDistributedTokenCaches()` in production, because the in-memory cache is per instance and lost on restart.

### The BFF pattern for SPAs

The SPA is served by the BFF and calls only the BFF; the BFF holds the tokens in its session and calls the API:

```csharp
app.MapGet("/bff/orders", async (HttpContext ctx, IHttpClientFactory f) =>
{
    var req = new HttpRequestMessage(HttpMethod.Get, "https://localhost:5653/orders");
    req.Headers.Authorization = new("Bearer", await ctx.GetTokenAsync("access_token"));
    var res = await f.CreateClient().SendAsync(req);
    return Results.Text(await res.Content.ReadAsStringAsync(), statusCode: (int)res.StatusCode);
}).RequireAuthorization().AddEndpointFilter(async (c, next) =>
    c.HttpContext.Request.Headers["X-CSRF"] == "1" ? await next(c) : Results.Problem("missing X-CSRF header", statusCode: 400));
```

```text
cookies the browser holds for :5652: __Host-bff(HttpOnly=True), __Host-bffC1(HttpOnly=True), __Host-bffC2(HttpOnly=True)
GET /bff/orders, no cookie -> 401
GET /bff/orders, cookie, no X-CSRF -> 400
  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"Bad Request","status":400,"detail":"missing X-CSRF header"}
GET /bff/orders, cookie + X-CSRF -> 200 orders for  (oid oid-ana, scp access_as_user)
```

Without the `OnRedirectToIdentityProvider` event that sets 401 and calls `HandleResponse()` for `/bff` paths, `fetch` would get a 302 to the provider it cannot follow (the event still let the handler write the nonce and correlation cookies). The browser has only an encrypted `HttpOnly` cookie, so XSS cannot steal a token. The custom header is the CSRF defense: a form on another site cannot add it, and a cross-origin `fetch` with it needs a CORS preflight the BFF does not allow. The docs no longer recommend OIDC public clients in the browser and point to RFC 10017; YARP can forward `/api/*` with the token attached instead of hand-written endpoints.

## Trade-offs

- **BFF versus tokens in the browser.** The BFF keeps tokens out of JavaScript, so an XSS bug can misuse the session only while the page is open instead of exfiltrating a token, at the cost of a server hop for every API call and a same-site deployment.
- **SaveTokens versus a token cache.** Tokens in the cookie need no server state but make every request heavier and leave refresh to you; `Microsoft.Identity.Web` with a distributed token cache keeps the cookie small and refreshes, but needs Redis or SQL.
- **Plain OIDC versus Microsoft.Identity.Web.** Plain handlers work with any provider and the docs prefer them when one app talks to several providers; `Microsoft.Identity.Web` brings Entra's audience, issuer and token rules and MSAL, but changes defaults (`preferred_username`, `id_token` without credentials) and cannot point at a non-Entra authority for token acquisition.
- **Mapped or raw claims.** Pick one per app, set `NameClaimType` (and `RoleClaimType`) explicitly in both the web app and the API, and test one protected endpoint.
- **Scale-out has prerequisites.** Shared Data Protection keys, forwarded headers and a distributed token cache are required before the second replica, not after the first `Correlation failed.`
- **Scopes and roles are different questions.** `scp` says what the client app may do for the user; `roles` say what an app or user is allowed. Use `RequireScopeOrAppPermission` only where both callers are intended.

## Documentation Links

- [Configure OpenID Connect Web (UI) authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-oidc-web-authentication?view=aspnetcore-10.0) (doc)
- [Quickstart: Protect an ASP.NET Core Web API, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/getting-started/quickstart-webapi) (doc)
- [Implement authorization in web APIs with Microsoft.Identity.Web, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/authentication/authorization) (doc)
- [Call downstream APIs from web apps, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/call-downstream-apis/from-web-apps) (doc)
- [Access tokens in the Microsoft identity platform, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) (doc)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications, IETF](https://datatracker.ietf.org/doc/html/rfc10017) (doc)
