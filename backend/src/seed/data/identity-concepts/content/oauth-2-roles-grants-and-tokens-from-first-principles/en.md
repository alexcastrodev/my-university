---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

OAuth 2.0 lets an application call an API on someone's behalf without ever
seeing their password: an authorization server hands out access tokens, the
API checks them. Libraries hide that behind one config block, so this lesson
does it by hand against a real authorization server, Keycloak in Docker
(chosen over a hand-written one because its answers, quirks included, are a
production server's answers): roles, client types, every grant, refresh
rotation, what OAuth 2.1 removed and the attack behind each removal, scope
versus audience, JWT versus opaque tokens, introspection, revocation, and the
errors provoked on purpose. curl, jq and openssl; one Node file plays the API.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
curl 8.7.1, jq 1.7.1, OpenSSL 4.0.3, Node 22.23.4.

## Use Cases

- Picking the right grant for a SPA, a mobile app, a cron job, a CLI or a TV.
- Reading `invalid_grant` or `invalid_client` in a log and knowing the cause.
- Reviewing a client registration: redirect URIs, PKCE, token lifetimes.
- Deciding whether an API validates JWTs locally or calls introspection.

## Deep Dive

### Four roles, two kinds of client

| Role | Who | In the lab |
|---|---|---|
| Resource owner | the user who can grant access | `alice` |
| Client | the app that wants access | `spa`, `worker`, `tv`, `legacy` |
| Authorization server (AS) | authenticates, asks consent, issues tokens | Keycloak realm `demo` on `:6180` |
| Resource server (RS) | the API that accepts tokens | `reports-api` |

A **confidential** client can keep a secret (a backend: `worker` sends
`worker-secret`). A **public** client cannot: anything shipped in a SPA, a
mobile binary or a CLI is readable, so `spa` and `tv` have no secret and rely
on PKCE and exact redirect URIs. Endpoints come from the realm's discovery
document; `$B` below is `http://localhost:6180/realms/demo/protocol/openid-connect`.

### Authorization code with PKCE, step by step (measured)

PKCE (RFC 7636) binds the code to the client instance that asked for it: the
client keeps a random `code_verifier` and sends only its SHA-256, the
`code_challenge`. The recipe first reproduces the RFC's test vector
(Appendix B: verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` gave
`E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`, as the RFC says), then runs:

```bash
VERIFIER=$(openssl rand 32 | openssl base64 -A | tr '+/' '-_' | tr -d '=')
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
# 1) front channel: the browser goes to the AS, alice signs in on Keycloak's form
GET $B/auth?response_type=code&client_id=spa&redirect_uri=http%3A%2F%2Flocalhost%3A6181%2Fcb
      &scope=reports.read&state=$STATE&code_challenge=$CHALLENGE&code_challenge_method=S256
# 2) back channel: the client trades the code plus the verifier
curl -s $B/token -d grant_type=authorization_code -d client_id=spa \
  -d redirect_uri=http://localhost:6181/cb -d code=$CODE -d code_verifier=$VERIFIER
```

```text
code_verifier=pIquw3rtSqFhHsWVnlL6mFJL2YEHN03n_neFwa_LEDw
code_challenge=R7BrEvR4VtCoDcdQ1jtEdJx9Z7A3lkxca7-oxkLr3jU
Location: http://localhost:6181/cb?state=58cf628b1d9794160ed90c7e9b5c18dd&session_state=rCx8-RYUpdRpNVqMqVRCoXIk&iss=http%3A%2F%2Flocalhost%3A6180%2Frealms%2Fdemo&code=bf29521c-cefb-c672-32bc-e2a707da3dee.rCx8-...
state matches
{"access_token":"eyJhbGciOiJSUzI1NiIs...","expires_in":300,"refresh_expires_in":1800,"refresh_token":"eyJhbGciOiJIUzUxMiIs...","token_type":"Bearer","scope":"reports.read",...}
{"exp":1795049542,"iat":1795049242,"auth_time":1795049242,"jti":"onrtac:6c02...","iss":"http://localhost:6180/realms/demo","aud":"reports-api","sub":"0efb9582-...","typ":"Bearer","azp":"spa","sid":"rCx8-...","scope":"reports.read"}
```

The code crosses the browser and can leak; tokens travel only on the back
channel. `state` is the client's CSRF defense and must come back identical;
`iss` in the redirect is RFC 9207 (mix-up defense). The access token is a JWT
for audience `reports-api`, issued to (`azp`) `spa`, valid 300 seconds. No
`id_token`: `openid` was not requested, so this is plain OAuth, not OIDC.

### Breaking it on purpose: redirect URI, PKCE, code reuse (measured)

```text
authorize with redirect_uri=/cb2 (not registered)  -> HTTP 400, no redirect, page says "Invalid parameter: redirect_uri"
authorize without code_challenge                   -> /cb?error=invalid_request&error_description=Missing+parameter%3A+code_challenge_method
authorize with code_challenge_method=plain         -> /cb?error=invalid_request&error_description=Invalid+parameter%3A+code+challenge+method+is+not+matching+the+configured+one
token with a wrong code_verifier                   -> {"error":"invalid_grant","error_description":"PKCE verification failed: Code mismatch"}
 ...then the right verifier on the same code       -> {"error":"invalid_grant","error_description":"Code not valid"}
token with redirect_uri=/other                     -> {"error":"invalid_grant","error_description":"Incorrect redirect_uri"}
replay a code that was already exchanged           -> {"error":"invalid_grant","error_description":"Code not valid"}
first access token after the replay                -> introspection {"active":false}
```

An unregistered redirect URI never receives anything, not even an error; a
bad verifier burns the code; a replayed code also revokes the tokens already
issued from it, as RFC 6749 section 4.1.2 asks: someone else holds the code.

### Client credentials: no user at all (measured)

```text
$ curl -s -u worker:worker-secret $B/token -d grant_type=client_credentials -d scope=reports.read
{"expires_in":300,"refresh_expires_in":0,"token_type":"Bearer","scope":"reports.read",...}   # no refresh_token
header  {"alg":"RS256","typ" : "at+jwt","kid" : "-O9ROeSgIbWUhOjGxuXYQkiMhpbk3AatwFerlTR9JFk"}
payload {"exp":1795049436,"iat":1795049136,"jti":"trrtcc:1c24...","iss":"http://localhost:6180/realms/demo","aud":"reports-api","sub":"464b2aef-...","azp":"worker","scope":"reports.read","client_id":"worker",...}
wrong secret          -> {"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"} HTTP 401
unknown client_id     -> {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"} HTTP 401
scope=reports.delete  -> {"error":"invalid_scope","error_description":"Invalid scopes: reports.delete"} HTTP 400
public client `spa`   -> {"error":"unauthorized_client","error_description":"Public client not allowed to retrieve service account"} HTTP 401
```

The client is its own resource owner (`sub` is its service account) and gets
no refresh token: it simply asks again. Quirk: RFC 6749 section 5.2 says a
failed client authentication is `invalid_client`, but Keycloak 26.8.2 answers
`unauthorized_client` for a known client with a wrong secret. Alert on both.

### Device authorization grant, RFC 8628 (measured)

```text
$ curl -s $B/auth/device -d client_id=tv -d scope=reports.read
{"device_code":"pYtgfmYMU_csfd...","user_code":"LFMR-WJXE","verification_uri":"http://localhost:6180/realms/demo/device","verification_uri_complete":"...?user_code=LFMR-WJXE","expires_in":600,"interval":5}
poll (grant_type=urn:ietf:params:oauth:grant-type:device_code) -> {"error":"authorization_pending",...} HTTP 400
poll again right away                                           -> {"error":"slow_down","error_description":"Slow down"} HTTP 400
alice opens the URI, signs in, accepts the consent screen       -> "Device Login Successful"
poll after 5 s                                                  -> {"access_token":"eyJhbGciOiJSUzI1NiIs...", ...}
```

The TV shows `user_code`, alice approves on her phone, the TV polls;
`slow_down` means "add 5 seconds to your interval" (RFC 8628 section 3.5).
Weak point: an attacker starts a flow and sends the victim the code (device
code phishing), so the consent screen must name the app; leave the grant off
on clients that do not need it.

### Refresh tokens and rotation (measured)

The realm has `revokeRefreshToken=true` and `refreshTokenMaxReuse=0`: each
refresh returns a new refresh token and the old one dies.

```text
refresh with RT1 -> new pair, RT2 differs: yes
replay RT1       -> {"error":"invalid_grant","error_description":"Maximum allowed refresh token reuse exceeded"} HTTP 400
RT2 after the replay: {"active":false}  AT2: {"active":false}
use RT2          -> {"error":"invalid_grant","error_description":"Session doesn't have required client"}
```

The AS cannot tell thief from user, so it kills the whole family, RT2
included: the reuse detection of RFC 9700 section 4.14.2. OAuth 2.1 requires
public-client refresh tokens to be one-time use or sender-constrained.

### What OAuth 2.1 removed, and why (measured)

OAuth 2.1 (draft-ietf-oauth-v2-1-17, still a draft) folds RFC 9700 into the
core: PKCE by default, exact redirect matching, no implicit grant, no password
grant, no tokens in query strings. Keycloak still allows the old habits on a
client that enables them, like `legacy`:

```text
implicit (response_type=token):
Location: http://localhost:6181/cb#state=26bb69b0faaae21e&iss=...&access_token=<JWT>&token_type=Bearer&expires_in=900
wildcard redirect: legacy registered http://localhost:6181/*, attacker sends redirect_uri=http://localhost:6181/user-content/mallory.html
Location: http://localhost:6181/user-content/mallory.html?state=26bb69b0faaae21e&iss=...&code=a027f1d9-0280-f627-47fd-e5f1b95a46...
ROPC (grant_type=password): the client itself holds alice's password
{"token_type":"Bearer","expires_in":300,"scope":"email profile","has_refresh":true}
wrong password -> {"error":"invalid_grant","error_description":"Invalid user credentials"} HTTP 400
```

- **Implicit**: the token sits in the URL fragment, open to page scripts,
  history and extensions, with no PKCE to bind it. Code + PKCE replaced it.
- **Wildcard redirect**: any page under the prefix (user uploads, an open
  redirect) receives the code. The exact `spa` registration answered 400.
- **ROPC**: the app sees the raw password, so no MFA, passkeys or federation,
  users learn to type passwords into third-party apps, and the token endpoint
  becomes a password-guessing oracle (`Invalid user credentials`).

### Scope versus audience

Scope says **what** the token allows (`reports.read`); audience says **which
API** may accept it (`aud: reports-api`). Here the scope carries an audience
mapper, and the `worker` token without it came back with `"scope":""` and no
`aud`. An API that checks only the signature accepts tokens minted for every
other API of the same AS: check `iss`, `aud`, `exp`, then scope.

### JWT versus opaque: introspection and revocation (measured)

A JWT access token (RFC 9068, `typ: at+jwt`, enabled here with the client
attribute `access.token.header.type.rfc9068`) is checked locally with the AS's
public keys. An opaque token is a handle only the AS can resolve, through
introspection (RFC 7662). A Node 22 resource server (`node:crypto` and
`fetch`, no packages) does both on one token, then revokes it (RFC 7009):

```text
local JWT check : 0.024 ms/op -> true
introspection   : 2.322 ms/op -> active=true
POST /revoke    : HTTP 200
after revoke    : local=true introspection active=false
revoke garbage  : HTTP 200
introspection body (active token):
{"active":true,"client_id":"worker","token_type":"Bearer","scope":"reports.read","aud":"reports-api","sub":"464b2aef-...","exp":1795049531,"iss":"http://localhost:6180/realms/demo"}
```

Introspection was about 100 times slower even on localhost, but only it sees
revocation: after `/revoke` the local check stayed `true` until `exp`. 200 for
garbage is by design (RFC 7009 section 2.2): the token is dead either way.
RFC 9068 requires `iss`, `exp`, `aud`, `sub`, `client_id`, `iat`, `jti`: the
`worker` token has them all; the `spa` user token lacks `client_id` (it has
`azp`), so Keycloak user tokens are not RFC 9068 by default.

### OAuth errors you will see

| Error | Endpoint | Provoked here by |
|---|---|---|
| `invalid_request` | authorize, token | missing `code_challenge` |
| `invalid_client` | token, introspect | unknown `client_id`; bad RS secret on introspect |
| `unauthorized_client` | token | public client asking client credentials; Keycloak also for a bad secret |
| `invalid_grant` | token | reused, burned or mismatched code; bad verifier; replayed refresh token; bad ROPC password |
| `invalid_scope` | token | `scope=reports.delete` |
| `authorization_pending`, `slow_down` | token (device) | polling before approval, polling too fast |

### Which grant for which scenario

| Scenario | Grant | Client type |
|---|---|---|
| Web app with a backend | authorization code + PKCE | confidential |
| SPA | code + PKCE, ideally via a BFF so tokens stay server side | public (or confidential BFF) |
| Mobile or desktop app | code + PKCE, system browser | public |
| Service to service, cron, batch | client credentials | confidential |
| TV, CLI, IoT without a browser | device authorization (RFC 8628) | public |
| "Username and password form in my app" | none: migrate to code + PKCE (ROPC is gone in 2.1) | n/a |

### Where to go next

OAuth only delegates access. The next concept, OIDC, adds the `id_token`,
`nonce` and discovery that turn it into login; the one after dissects the JWT
itself (`alg`, `kid`, JWKS, attacks). The MCP authorization concept runs this
same code + PKCE flow, plus resource indicators, against an MCP server.

## Trade-offs

- **JWT versus opaque access tokens.** JWTs validate in microseconds but
  cannot be recalled before `exp`; opaque tokens cost an introspection call
  (plus caching) but revoke instantly. Common middle ground: 5-minute JWTs and
  revocable refresh tokens.
- **Strict rotation versus flaky networks.** Reuse detection catches stolen
  refresh tokens, but a mobile app that loses a response and retries with the
  old token logs the user out. A reuse allowance (`refreshTokenMaxReuse > 0`
  in Keycloak) helps and weakens detection.
- **PKCE plus a secret versus PKCE alone.** A confidential client uses both:
  PKCE stops code injection, the secret authenticates the client. PKCE alone
  is the most a public client can do.
- **Coarse versus fine scopes.** `reports.read` is easy to consent to;
  per-record rules belong to the API's authorization model, not to scopes.

## Documentation Links

- [RFC 6749, The OAuth 2.0 Authorization Framework, IETF](https://datatracker.ietf.org/doc/html/rfc6749) (doc)
- [RFC 7636, Proof Key for Code Exchange (PKCE), IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 8628, OAuth 2.0 Device Authorization Grant, IETF](https://datatracker.ietf.org/doc/html/rfc8628) (doc)
- [RFC 7009, OAuth 2.0 Token Revocation, IETF](https://datatracker.ietf.org/doc/html/rfc7009) (doc)
- [RFC 7662, OAuth 2.0 Token Introspection, IETF](https://datatracker.ietf.org/doc/html/rfc7662) (doc)
- [RFC 9068, JWT Profile for OAuth 2.0 Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc9068) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [RFC 9207, OAuth 2.0 Authorization Server Issuer Identification, IETF](https://datatracker.ietf.org/doc/html/rfc9207) (doc)
- [The OAuth 2.1 Authorization Framework (draft), IETF](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
- [Keycloak Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
