---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Most .NET teams consume tokens: [JWT bearer](jwt-bearer-and-aspnet-core-identity) and [OpenID Connect](openid-connect-entra-id-and-bff) validate what an identity provider issued. This lesson builds the provider: an OAuth 2.0 and OpenID Connect authorization server (AS) inside ASP.NET Core with OpenIddict, then asks the harder question, whether you should. OpenIddict is a library, not an identity product: it parses and validates the protocol messages, stores applications, authorizations and tokens, and signs what you tell it to sign. The login screen, user store, MFA, consent page and account recovery are yours. Everything below was measured with curl against a ~160-line lab server (SQLite) and a separate protected API; what only came from docs is marked "docs only". The [MCP lesson](/dotnet-ai-concepts/choosing-an-authorization-server-for-mcp-entra-keycloak-openiddict) already measured OpenIddict as an MCP authorization server, so this one goes to the full server, and the client side lives in the [OAuth clients lesson](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow).
Versions: `OpenIddict.AspNetCore` and `OpenIddict.EntityFrameworkCore` 7.9.0 (latest stable on NuGet and Apache-2.0 on GitHub, both checked 2026-11-19; `8.0.0-preview.6` also exists), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15, `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- A product that must issue its own tokens to third-party apps, partners or customers' systems.
- An internal platform where Entra ID or Keycloak is not allowed or not enough, and a .NET team owns the login.
- Deciding, with evidence, between OpenIddict, Duende IdentityServer and a ready-made product.
- Auditing an existing OpenIddict server: lifetimes, key rotation, revocation, claims in tokens.

## Deep Dive

The protocol vocabulary (roles, grants, PKCE, introspection) is in the neutral lessons [OAuth 2.0 from First Principles](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles), [OpenID Connect](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout) and [OAuth security BCP](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators). Here it is .NET code.

### Core, server, validation and four tables

`AddOpenIddict()` has three parts: `AddCore` (managers and the store, here `UseEntityFrameworkCore`), `AddServer` (the endpoints) and `AddValidation` (accepting tokens, in the AS itself or in an API). With EF Core and SQLite, `UseOpenIddict()` on the `DbContext` created four tables, and a few flows filled them:

```text
OpenIddictApplications    clients: ClientId, hashed ClientSecret, ClientType, ConsentType, Permissions, RedirectUris, Requirements
OpenIddictScopes          scope names and the resources (future aud) they imply
OpenIddictAuthorizations  "user X granted client Y these scopes": Subject, Scopes, Status, Type (permanent or ad-hoc)
OpenIddictTokens          one row per token: Type, Status, Subject, AuthorizationId, ExpirationDate, RedemptionDate, ReferenceId, Payload
```

The `ClientSecret` column held `AQAAAAEAACcQ...`, the shape of an ASP.NET Core Identity v3 password hash: secrets are hashed, not stored. Tokens are rows too: one authorization code flow left a `valid` authorization plus rows for the code, access, refresh and ID tokens, which is what makes revocation and replay detection possible. Payload is empty for ordinary JWTs and filled only for codes (and reference tokens, below).

### The lab, and the login is yours

```csharp
builder.Services.AddOpenIddict()
    .AddCore(o => o.UseEntityFrameworkCore().UseDbContext<DbContext>())
    .AddServer(o =>
    {
        o.SetIssuer("http://localhost:6740/");
        o.SetAuthorizationEndpointUris("connect/authorize").SetTokenEndpointUris("connect/token")
         .SetIntrospectionEndpointUris("connect/introspect").SetRevocationEndpointUris("connect/revoke");
        o.AllowAuthorizationCodeFlow().AllowClientCredentialsFlow().AllowRefreshTokenFlow();   // no implicit, no password
        o.RequireProofKeyForCodeExchange();
        o.RegisterScopes(Scopes.Email, Scopes.Profile, Scopes.OfflineAccess, "orders");
        o.AddEncryptionKey(key).AddSigningCertificate(cert);
        o.UseAspNetCore().EnableAuthorizationEndpointPassthrough().EnableTokenEndpointPassthrough()
         .DisableTransportSecurityRequirement();                                    // lab only: http
    })
    .AddValidation(o => { o.UseLocalServer(); o.UseAspNetCore(); });
```

"Passthrough" means OpenIddict validates the request, then calls your endpoint, which returns `Results.SignIn(principal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme)` to make it issue. My `/connect/authorize` checks a login cookie (a plain `AddCookie` scheme with a 5-line form at `/login`); if absent it returns `Results.Challenge`, which redirects to the form. Only then does it build the `ClaimsPrincipal` and sign in. `/connect/token` handles `client_credentials` itself and, for codes and refresh tokens, re-signs the principal OpenIddict already rebuilt from the redeemed token. The API is a second process with `AddJwtBearer` and `AddOpenIddict().AddValidation(...)`. Ports 6740 (AS) and 6741 (API); a few environment variables flip options between runs.

### Discovery: what is on, what is off

`GET /.well-known/openid-configuration` advertises only what was enabled:

```text
grant_types_supported = authorization_code, client_credentials, refresh_token, urn:ietf:params:oauth:grant-type:device_code
response_types_supported = code
code_challenge_methods_supported = plain, S256
jwks_uri = http://localhost:6740/.well-known/jwks      (one RSA key, with x5c)
authorization_response_iss_parameter_supported = True
POST /connect/token grant_type=password                      -> unsupported_grant_type (ID2032)
GET  /connect/authorize?response_type=token (implicit)       -> unsupported_response_type (ID2032)
```

The device grant appeared because the lab also called `AllowDeviceAuthorizationFlow()`; password and implicit simply do not exist unless you call `AllowPasswordFlow()` or `AllowImplicitFlow()`. There is no `end_session_endpoint` or `userinfo_endpoint` either, because I did not enable them.

### Authorization code with PKCE, and its errors

A shell helper follows the redirects: authorize, 302 to `/login`, POST the form, repeat authorize, read the final `Location`.

```text
authorize, not logged in                -> 302 /login?ReturnUrl=...
authorize without code_challenge        -> error=invalid_request "The mandatory 'code_challenge' parameter is missing." (ID2029)
redirect_uri with a trailing slash      -> 400 "The specified 'redirect_uri' is not valid for this client application." (ID2043)
scope=openid admin (unregistered)       -> invalid_scope (ID2052)
scope=email on a client without it      -> "This client application is not allowed to use the specified scope." (ID2051)
authorize with PKCE                     -> 302 http://localhost:6745/callback?code=...&state=xyz&iss=http%3A%2F%2Flocalhost%3A6740%2F
token with the verifier                 -> access_token, id_token, refresh_token
second redemption of the same code      -> invalid_grant "The specified authorization code has already been redeemed." (ID2010)
```

`redirect_uri` is matched exactly against the registered value, and the error page is a plain 400, never a redirect to an unverified URI. `state` is only echoed, and the `nonce` landed in the ID token (`"nonce":"n1"`): checking both stays the client's job. Two details matter for security. The metadata lists `plain` and the server accepted `code_challenge_method=plain`; adding `o.Configure(x => x.CodeChallengeMethods.Remove(CodeChallengeMethods.Plain))` made the metadata `['S256']` and `plain` fail with ID2032. And the second redemption did not only fail: the log said `4 tokens associated with the authorization ... were revoked to prevent a potential token replay attack`, and the table showed code, access, refresh and ID token all `revoked` (the authorization itself stayed `valid`). An access token from that chain then got 401 from the API.

### Applications: public, confidential, consent

`IOpenIddictApplicationManager.CreateAsync` takes a descriptor. The `spa` client is public (no secret) with one exact redirect and the PKCE requirement; `worker` is confidential:

```csharp
new OpenIddictApplicationDescriptor
{
    ClientId = "worker", ClientSecret = "worker-secret", ClientType = ClientTypes.Confidential,
    Permissions = { Permissions.Endpoints.Token, Permissions.Endpoints.Introspection,
                    Permissions.GrantTypes.ClientCredentials, Permissions.Prefixes.Scope + "orders" },
}
```

Permissions are an allow-list per client, so a client cannot call an endpoint, use a grant or ask for a scope it was not given. Measured with client credentials: wrong secret `invalid_client` (ID2055); `scope=email` not permitted `invalid_request`; `spa` asking for `client_credentials` got `invalid_request` (a secret is required); the secret went in the form or as HTTP Basic. A client with `ConsentTypes.Explicit` and no stored authorization got `error=consent_required` in the redirect, because my handler returned `Forbid` with that error. The screen that asks and the `AuthorizationManager.CreateAsync` call that remembers the answer are your code (docs only: the sample in the authorization storage page); `Implicit` skips the question, `External` leaves it to an admin.

### Scopes, resources and claim destinations

A scope row carries `Resources = { "orders-api" }`; the handler calls `p.SetResources(await scopes.ListResourcesAsync(p.GetScopes()))` and the token gets `"aud":"orders-api"`. Claims are different: OpenIddict copies claims into codes and refresh tokens by itself, but into access and ID tokens only those with a destination, except `sub`. My principal had `name`, `email`, `role` and `department`:

```text
SetDestinations never called   AT {sub}                                        ID {sub}                        (and nothing else)
std rule (name: AT+ID, email: ID if scope email, role: AT, department: none)
                               AT {sub, name, role}                            ID {sub, name, email}
every claim -> AccessToken     AT {sub, name, email, role, department}         ID {sub}
```

That is the classic "my claim is missing" bug: no destination means no claim, no error. Putting everything in the access token leaks `department` to the client, which can read it when encryption is off. The API printed `role=admin email= dept=` for the std rule: `email` was only in the ID token, as intended.

### Token format and how the API validates

By default access tokens are JWE (encrypted JWT): header `{"alg":"A256KW","enc":"A256CBC-HS512","typ":"at+jwt","cty":"JWT"}`, five segments, 1575 characters; the ID token is a signed 3-segment JWT. The API accepted the same token in four configurations:

| API validation | encrypted AT (default) | `DisableAccessTokenEncryption()` |
| --- | --- | --- |
| `AddJwtBearer` with `Authority` | 401 `invalid_token` | 200 (needs `aud` and a reachable JWKS) |
| OpenIddict validation, `UseIntrospection()` | 200 (call to `/connect/introspect` per token) | 200 |
| OpenIddict validation, `AddEncryptionKey(sameKey)` | 200 (local, no call) | n/a |
| `UseLocalServer()` in the AS itself | 200 | 200 |

```csharp
// API: o.SetIssuer("http://localhost:6740/"); o.AddAudiences("orders-api");
o.UseIntrospection().SetClientId("orders-api").SetClientSecret("api-secret");   // or o.AddEncryptionKey(sharedKey)
o.UseSystemNetHttp(); o.UseAspNetCore();
```

`orders-api` is itself an application with only the introspection permission. The introspection response carried `"active": true`, `aud`, `scope`, `client_id`, `name` and `role`; a caller that is not the token's audience (`worker`) got `{"active": false}`. Encryption hides claims from clients and from third parties; disabling it is what lets plain JwtBearer work (the case covered in the [JWT lesson](jwt-bearer-and-aspnet-core-identity)), at the price of readable claims. Sharing the encryption key with every API is the third option.

### Lifetimes, revocation and what "valid" means

Defaults read from tokens and rows: code 5 minutes, access token 1 hour (`expires_in: 3600`), ID token 20 minutes, refresh token 14 days; `SetAccessTokenLifetime`, `SetRefreshTokenLifetime`, `SetAuthorizationCodeLifetime` and `SetIdentityTokenLifetime` change them. With a 5 second access token, 7 seconds later:

```text
AddJwtBearer (default clock skew 5 min)      200   (expired 2 s ago, still accepted)
OpenIddict validation via introspection      401
AS local validation                          401
```

Then revocation, `POST /connect/revoke` (200, empty `{}`), with a self-contained JWT:

```text
                                   AddJwtBearer   introspection   local, default   local, EnableTokenEntryValidation()
after revoking the access token    200            401            200              401
```

Without `EnableTokenEntryValidation()` the validation handler never looks at the database ("access tokens are considered valid until they expire", per the docs), and a JwtBearer API cannot see revocation at all. The shared-key mode (200 after revoke) behaves like JwtBearer. Revocation only reaches an API that introspects or reads the AS database. Advisory GHSA-cxgj-hwwh-855g (fixed in 7.9.0 and 8.0 preview 6): with `EnableAuthorizationEntryValidation()` but without `EnableTokenEntryValidation()`, the authorization check was skipped, in `OpenIddict.Validation` above 4.0.0. Upgrade, and enable both when you validate entries.

### Refresh tokens: rotation, leeway and reuse

Each refresh issued a new refresh token and marked the old one `redeemed`. Three configurations, each starting from the first refresh token (`RT0`):

```text
LEEWAY=0           refresh RT0 -> ok; reuse RT0 -> invalid_grant "already been redeemed"; then RT1 -> invalid_grant "no longer valid"
                   rows: every access, refresh, code and ID token revoked ("7 tokens associated with the authorization ... were revoked")
default            reuse RT0 immediately -> ok (a second pair), RT1 -> ok; both chains alive (leeway window)
default, +31 s     reuse RT0 -> invalid_grant, RT1 -> invalid_grant, all rows revoked
ROLLING=off        (DisableRollingRefreshTokens) RT0 reused 3 times -> ok; 4 refresh rows, all valid, nothing revoked
```

The default `RefreshTokenReuseLeeway` of 30 seconds tolerates a client that retries after a lost response, at the cost of a short double-spend window. After it, reuse is treated as theft and the whole chain dies, the same signal as the code replay. Disabling rolling removes detection: a stolen refresh token works until it expires. Access tokens already issued from the chain keep working at a JwtBearer API for the rest of their lifetime (see above). When refreshing, re-check the user in your handler (disabled account, changed password); that part is code you write (docs only).

### Signing keys and rotation

`AddEphemeralSigningKey()` made a new key per start: a token issued before a restart got 401 after it, and, per the docs, so do refresh tokens and codes if the encryption key is ephemeral too (docs only). `AddDevelopmentSigningCertificate()` persists a certificate in the user's store (docs only, not run, to avoid touching the keychain). For production, `AddSigningCertificate` with a real certificate from a vault. Rotation with two certificates (A expires 2027-11, B 2028-11):

```text
AS with A:           jwks [7506ACC9]            token t1 signed with kid 7506ACC9, API 200
AS with A,B:         jwks [E35760B0, 7506ACC9]  new token signed with E35760B0 (B), also when the list order is B,A
API, cached JWKS:    t2 first call 401, next call 200 (JwtBearer refreshed on the unknown kid)
API restarted:       t1 200, t2 200
AS with only B:      jwks [E35760B0]            t1 on an API with cached JWKS 200, after API restart 401
```

The docs say OpenIddict signs with the certificate that expires furthest (not-yet-valid ones are skipped), and it published both keys, so old tokens kept validating until A left the JWKS. Two consequences: the API's JWKS cache lets a retired key live on until a restart or refresh, and the first request after rotation can fail once. Rotation is a deployment procedure you own (generate, publish both, wait for the longest token lifetime, remove the old one); Duende sells it as an add-on (below).

### Reference tokens

`UseReferenceAccessTokens()` made the access token a 43-character opaque string (instead of 1575) and stored the signed payload in `OpenIddictTokens.Payload` (1554 characters) with a `ReferenceId` that is not the token string. JwtBearer got 401; introspection got 200; revoking set the row `revoked` and introspection flipped to 401 at once. You gain short tokens and immediate revocation and pay a database read on every validation, and the docs strongly advise protecting the `Payload` column (at-rest encryption) or using the Data Protection token format (docs only).

### PAR, mTLS and DPoP, device flow, cleanup

- PAR (RFC 9126): `SetPushedAuthorizationEndpointUris("connect/par")` plus `Permissions.Endpoints.PushedAuthorization` on the client. `POST /connect/par` returned 201 with `request_uri=urn:ietf:params:oauth:request_uri:...` and `expires_in: 3599`; `authorize?client_id=spa&request_uri=...` gave a code, a second use of the same `request_uri` gave 400, and `RequirePushedAuthorizationRequests()` made the metadata say `require_pushed_authorization_requests: True` and plain authorize fail with `The mandatory 'request_uri' parameter is missing`.
- mTLS (RFC 8705): present in the server assemblies (`EnablePublicKeyInfrastructureTlsClientAuthentication`, `EnableSelfSignedTlsClientAuthentication`, `UseClientCertificateBoundAccessTokens`, per issue #2417 merged in 2026), docs only: not run, it needs a TLS terminator with client certificates.
- DPoP (RFC 9449): not supported. The assemblies have no DPoP type, and in issue #2483 (June 2026) the maintainer wrote that DPoP is not supported in the client, server or validation stacks, that he is open to adding it, and that mTLS offers the higher security level. Duende's pricing page lists DPoP in its base plan.
- Device flow: `AllowDeviceAuthorizationFlow()` with `SetDeviceAuthorizationEndpointUris` and `SetEndUserVerificationEndpointUris`: the device endpoint returned `device_code`, `user_code 0185-0217-0799`, `verification_uri` and `expires_in: 600`; polling gave `authorization_pending`. The verification page (type the code, approve) is yours, docs only. The client side is in the OAuth clients lesson.
- Cleanup: expired tokens and authorizations stay in the tables until pruned. 7.x uses `OpenIddict.Quartz` (`UseQuartz()`, docs only); the 8.0 preview.5 notes replace it with a `BackgroundService` shipped in `OpenIddict.Core`, opt-out with `DisableAutomaticTokenPruning()` (book vs today: 7.x guides say Quartz).

### Should you build it? The market

OpenIddict is Apache-2.0, maintained (a stable release on 2026-11-14, previews of 8.0 in progress), and a toolkit. Duende IdentityServer is a commercial framework for the same job; from its pricing and FAQ pages, read 2026-11-19: no license needed for development, test, trial or personal projects, and a free Community Edition (feature-equivalent to Standard) for for-profits under US$1M projected gross revenue and US$3M capital access, or non-profits under a US$1M budget. Paid plans, billed annually: Lite US$480/month (2 Connected Apps, community support, core protocol with PAR and DPoP), Standard US$1,042/month (10 Connected Apps, mTLS, device flow, resource indicators, server-side sessions, 2-day email SLA), Advanced US$2,075/month; on Standard, Automatic Key Management, SAML and User Management are add-ons. Prices change: read the page.

`MapIdentityApi` is not an alternative: its tokens are Data Protection blobs usable only by the app itself (measured in the JWT lesson). Keycloak is the self-hosted product measured in the MCP lesson (admin console, DCR), and Entra ID is the managed one; Auth0 was not evaluated here.

| Decision | OpenIddict | Duende IdentityServer | Ready-made product (Keycloak, Entra ID) | Choose when |
| --- | --- | --- | --- | --- |
| Cost | free, Apache-2.0; your engineering time | free Community Edition below the thresholds, then subscription | Keycloak self-hosted, Entra by plan (pricing not consulted) | budget is people (OpenIddict) or license (Duende) |
| What you get | protocol engine, stores, validation | the same plus vendor support, key management add-on, DPoP, UI samples | login UI, users, MFA, recovery, admin | you want screens and MFA done (product) |
| Login, MFA, recovery | yours | yours (User Management is an add-on) | included | users must sign in with passkeys, MFA, SSO on day one |
| Key rotation, pruning | manual procedure, you schedule | Automatic Key Management add-on | managed | no team to own keys |
| Newer specs | PAR, mTLS, device yes; DPoP no | PAR, DPoP, mTLS per plan | per product | read each changelog first |
| Own the claims and flows | complete control | complete control | limited to product extension points | tokens depend on your domain model |

Do you need to issue tokens at all? If your users already exist in Entra or Keycloak and apps only need to trust them, the cheapest AS is the one you do not run: validating tokens is a few lines, while running one means owning login security, MFA, recovery, key rotation, advisories like the one above and compliance evidence.

## Trade-offs

- **Library versus product.** OpenIddict gives exact control and no per-client fee, but nothing renders a login, resets a password or enforces MFA. Budget for them before choosing it.
- **Encrypted versus readable access tokens.** Encryption keeps claims private and forces introspection or a shared key at every API; `DisableAccessTokenEncryption()` makes JwtBearer work and exposes the payload to anyone holding the token.
- **Self-contained versus reference tokens.** JWTs need no lookup and cannot be revoked at a JwtBearer API; reference tokens revoke instantly but cost a database read per call.
  ```csharp
  o.UseReferenceAccessTokens();   // and protect the Payload column
  ```
- **Refresh leeway.** 30 seconds absorbs retries; `SetRefreshTokenReuseLeeway(TimeSpan.Zero)` is stricter and punishes flaky networks. `DisableRollingRefreshTokens()` removes theft detection.
- **Explicit destinations.** Safe by default (missing claims) but silent; write one test that decodes a token and lists its claims.
- **Key rotation is yours.** A stale JWKS cache in an API keeps a retired key alive and fails the first call after a new one.
- **Where the specs stop.** PAR and mTLS are here; DPoP is not. Check the release notes before promising a spec.

## Documentation Links

- [OpenIddict documentation](https://documentation.openiddict.com/) (doc)
- [Claim destinations, OpenIddict documentation](https://documentation.openiddict.com/configuration/claim-destinations) (doc)
- [Token formats, OpenIddict documentation](https://documentation.openiddict.com/configuration/token-formats) (doc)
- [Token storage, OpenIddict documentation](https://documentation.openiddict.com/configuration/token-storage) (doc)
- [Authorization storage, OpenIddict documentation](https://documentation.openiddict.com/configuration/authorization-storage) (doc)
- [Encryption and signing credentials, OpenIddict documentation](https://documentation.openiddict.com/configuration/encryption-and-signing-credentials) (doc)
- [openiddict-core, GitHub](https://github.com/openiddict/openiddict-core) (doc)
- [OpenIddict, NuGet Gallery](https://www.nuget.org/packages/OpenIddict) (doc)
- [GHSA-cxgj-hwwh-855g, OpenIddict security advisory](https://github.com/openiddict/openiddict-core/security/advisories/GHSA-cxgj-hwwh-855g) (doc)
- [Duende IdentityServer, Duende Software](https://duendesoftware.com/products/identityserver) (doc)
- [Duende pricing and licensing, Duende Software](https://duendesoftware.com/pricing) (doc)
- [RFC 6749: The OAuth 2.0 Authorization Framework, IETF](https://datatracker.ietf.org/doc/html/rfc6749) (doc)
- [RFC 7636: Proof Key for Code Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 7009: OAuth 2.0 Token Revocation, IETF](https://datatracker.ietf.org/doc/html/rfc7009) (doc)
- [RFC 7662: OAuth 2.0 Token Introspection, IETF](https://datatracker.ietf.org/doc/html/rfc7662) (doc)
