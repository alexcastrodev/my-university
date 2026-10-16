---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

The authentication fundamentals concept showed schemes, challenge and forbid.
This one goes into the two token options people actually reach for: an API
that validates **JWT access tokens** issued by an identity provider, and
**ASP.NET Core Identity**, which stores users itself and, through
`MapIdentityApi`, can hand out its own bearer tokens. The goal is to know what
the JWT handler checks and what it lets through, why claims arrive under
strange names, what Identity's tokens really are, what refresh and logout do
(and do not) revoke, where passkeys fit in .NET 10, and where a browser should
keep a token. Every status code below comes from requests against .NET 10 apps
(SDK 10.0.100, packages 10.0.0).

## Use Cases

- An API called by SPAs, mobile apps or other services, with users managed by
  Microsoft Entra ID, Keycloak, Auth0 or another OpenID Connect provider.
- A small app with its own user table, where a full identity provider is too
  much and Identity's register/login endpoints are enough.
- Reviewing an existing API: is the audience validated, is the clock skew
  sane, does `[Authorize(Roles = "admin")]` actually see the role claim?
- Deciding between cookies and tokens for a browser client.

## Deep Dive

### What the JWT bearer handler validates

The `Microsoft.AspNetCore.Authentication.JwtBearer` package validates a token
from the `Authorization: Bearer` header. The docs list what an API must check:
the signature, the issuer, the audience and the expiration. The test app below
signs tokens with an RSA key (test only: in production the identity provider
holds the private key and the API downloads the public keys from
`Authority`'s metadata):

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        // Production: o.Authority = "https://idp.example"; keys come from its metadata.
        o.MapInboundClaims = false;                 // keep "sub", "role", "name" as sent
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = "https://idp.example",
            ValidAudience = "orders-api",
            IssuerSigningKey = publicKey,
            NameClaimType = "name",
            RoleClaimType = "role",
            ClockSkew = TimeSpan.FromSeconds(30),   // default is 5 minutes
        };
    });

app.MapGet("/who", (ClaimsPrincipal u) =>
    $"Name={u.Identity!.Name} sub={u.FindFirstValue("sub")} admin={u.IsInRole("admin")}")
   .RequireAuthorization();
```

With a valid token, `/who` returned `Name=Ana sub=user-42 admin=True`. Each
broken token got a 401, and with the default `IncludeErrorDetails` the reason
is in the `WWW-Authenticate` header:

```text
no token                    401  WWW-Authenticate: Bearer
audience billing-api        401  error="invalid_token", error_description="The audience 'billing-api' is invalid"
issuer https://evil.example 401  error_description="The issuer 'https://evil.example' is invalid"
signed with another key     401  error_description="The signature is invalid"
unsigned (alg none)         401  error_description="The signature is invalid"
expired 10 minutes ago      401  error_description="The token expired at '...'"
expired 2 minutes ago       200  (default ClockSkew of 5 minutes)
```

The last line surprises people: `TokenValidationParameters.DefaultClockSkew`
is 5 minutes, so a token is accepted for up to 5 minutes after `exp`. With
`ClockSkew = TimeSpan.Zero` the same token got 401. Lower it when access
tokens are short-lived and server clocks are synchronized.

### Why the claims have strange names

`JwtBearerOptions.MapInboundClaims` is `true` by default (printed from a fresh
options object). It renames some JWT claims to the long WS-Federation URIs. The
same token, read under three configurations:

```text
default (MapInboundClaims = true)
  claims: nameidentifier URI=user-42 | name=Ana | role URI=admin
  Identity.Name = null   IsInRole("admin") = True
MapInboundClaims = false
  claims: sub=user-42 | name=Ana | role=admin
  Identity.Name = null   IsInRole("admin") = False
MapInboundClaims = false + NameClaimType "name" + RoleClaimType "role"
  claims: sub=user-42 | name=Ana | role=admin
  Identity.Name = Ana    IsInRole("admin") = True
```

In all three, `NameClaimType` and `RoleClaimType` decide what `Identity.Name`
and `IsInRole` read; their defaults are the URI types. Turning off mapping
without setting them silently broke role checks: every `RequireRole("admin")`
would return 403. The docs' explicit-validation sample also sets
`MapInboundClaims = false`; whichever you choose, set the two claim types to
match your provider's tokens and test one role-protected endpoint.

### Where the tokens should come from

The JWT docs are blunt: don't create your own access tokens except for tests,
always use asymmetric keys, and never create an access token straight from a
username and password request. Tokens should come from an OpenID Connect or
OAuth flow (authorization code with PKCE for users, client credentials for
services). An ID token proves who logged in to the client and must never be
sent to an API. For local testing, `dotnet user-jwts create` issues tokens,
keeps the signing key in the user-secrets store and writes the matching issuer
and audiences into `appsettings.Development.json`.

### ASP.NET Core Identity and MapIdentityApi

Identity is a user store: password hashing, lockout, 2FA, email
confirmation, external logins. `AddIdentityApiEndpoints<TUser>()` plus
`MapIdentityApi<TUser>()` exposes it as JSON endpoints. Listing the endpoint
data source of the running app gave `/register`, `/login`, `/refresh`,
`/confirmEmail`, `/resendConfirmationEmail`, `/forgotPassword`,
`/resetPassword`, `/manage/2fa` and `/manage/info`. There is no logout
endpoint; the docs show how to add one.

```text
POST /register password "123"   400 PasswordTooShort, PasswordRequiresNonAlphanumeric, ...
POST /login wrong password      401 {"title":"Unauthorized","status":401,"detail":"Failed"}
POST /login                     200 {"tokenType":"Bearer","accessToken":"CfDJ8...","expiresIn":3600,"refreshToken":"CfDJ8..."}
POST /login?useCookies=true     200 Set-Cookie: .AspNetCore.Identity.Application=CfDJ8...
```

The access token had 688 characters and no dots: it is **not a JWT**. The docs
confirm it is a token proprietary to Identity, and deliberately so: the
endpoints target simple first-party scenarios and are not a token server. The
`CfDJ8` prefix is the header of an ASP.NET Core Data Protection payload, the
same mechanism that protects the cookie, so another API cannot read the token
without sharing the key ring. Defaults, read from `BearerTokenOptions`: 1
hour for the access token and 14 days for the refresh token.

### What refresh, logout and revocation really do

The same app, continuing with the first login's tokens:

```text
POST /refresh with the refresh token      200 new token pair
POST /refresh with the SAME token again   200 (the old refresh token still works)
GET /me with the old access token         200
POST /logout (SignOutAsync) with bearer   200
GET /me with that access token            200 (logout revoked nothing)
UpdateSecurityStampAsync(user)            200
POST /refresh with the old refresh token  401
GET /me with the old access token         200 (valid until it expires)
```

Bearer tokens are self-contained, so logging out only matters for cookies.
Refresh validates the user's security stamp, which is the revocation lever:
changing the password or calling `UpdateSecurityStampAsync` kills refresh
tokens. Access tokens already issued live until `BearerTokenExpiration`, which
is why the docs tie the session window after a security change to that
lifetime. Keep it short.

### Passkeys in .NET 10

New in .NET 10, Identity supports passkeys (WebAuthn/FIDO2): the server stores
only a public key and the browser proves possession of the private key, which
is bound to the site and so resists phishing. Per the passkeys docs, only the
Blazor Web App template (with individual accounts) includes the UI, passkeys
are a primary factor rather than a second factor, and the feature is scoped to
authentication, not a general WebAuthn library. The `MapIdentityApi` endpoint
list above has no passkey endpoints. Set `IdentityPasskeyOptions.ServerDomain`
or make sure host headers are validated, because otherwise the relying party
ID comes from the `Host` header.

### Where a browser should keep tokens

The JWT docs list storing access tokens in local storage, session storage or
web workers as insecure handling, and the Identity docs recommend cookies for
browser apps because JavaScript cannot read an `HttpOnly` cookie. Any XSS can
read `localStorage` and send the token anywhere, and a stolen bearer token
works from any machine. For browser front ends, prefer a cookie session, with a
backend-for-frontend that keeps the access tokens on the server when
downstream APIs need them. Tokens in the `Authorization` header fit
non-browser clients: mobile apps, CLIs, other services.

## Trade-offs

- **External provider versus Identity.** An OIDC provider gives standard JWTs,
  SSO and one place for MFA, at the cost of another system to run or pay for.
  Identity keeps users in your database but its tokens only work in your app.
- **Self-contained tokens versus revocation.** JWTs and Identity bearer tokens
  need no lookup per request, and for the same reason cannot be revoked before
  they expire. Short access tokens plus refresh is the usual compromise.
  ```csharp
  builder.Services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme,
      o => o.BearerTokenExpiration = TimeSpan.FromMinutes(15));
  ```
- **Claim mapping on or off.** Mapping keeps older code that reads
  `ClaimTypes.NameIdentifier` working; turning it off keeps the token's own
  names. Either way, set `NameClaimType` and `RoleClaimType` on purpose.
- **Clock skew.** Five minutes hides clock drift but stretches every token's
  life; a small value needs synchronized clocks.
- **Cookies versus tokens in the browser.** Cookies need CSRF protection and
  same-site deployment; tokens in JavaScript storage are exposed to XSS.
- **Passkeys.** Strong and phishing resistant, but the built-in UI exists only
  in the Blazor template, and account recovery still needs another method.

## Documentation Links

- [Configure JWT bearer authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) (doc)
- [Use Identity to secure a Web API backend for SPAs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-api-authorization) (doc)
- [Mapping, customizing, and transforming claims in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/claims) (doc)
- [Enable Web Authentication API (WebAuthn) passkeys, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/) (doc)
- [Manage JSON Web Tokens in development with dotnet user-jwts, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/jwt-authn) (doc)
- [RFC 8725: JSON Web Token Best Current Practices, IETF](https://datatracker.ietf.org/doc/html/rfc8725) (doc)
