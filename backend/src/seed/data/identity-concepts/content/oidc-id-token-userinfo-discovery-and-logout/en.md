---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

OAuth 2.0 gives a client an access token for an API and says nothing about who
logged in. OpenID Connect (OIDC) adds that on top of the same code flow: the
`openid` scope, the ID token (a signed JWT addressed to the client), UserInfo,
discovery and three logout mechanisms. All measured against a local Keycloak
with curl, jq and a 44-line Node 22 validator (no packages, so every check is
visible), including each validation step failing on purpose. Roles, grants,
PKCE and introspection are in the OAuth lesson this one requires.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
Node 22.23.4, curl 8.7.1, jq 1.7.1, OpenID Connect Core 1.0 with errata set 2.

## Use Cases

- Adding "Sign in with..." to an app and knowing which token proves the login.
- Reviewing code that sends an ID token to an API and saying why it is wrong.
- Forcing a fresh login or MFA for a sensitive action and checking the IdP obeyed.
- Designing logout so that leaving one app actually ends the user's sessions.

## Deep Dive

### What `scope=openid` changes (measured)

Keycloak in Docker (`idn-oidc-keycloak`, port 6240), realm `demo`, confidential
client `web-app`, user `alice`; the login form is driven with curl and a
cookie jar, and the code is redeemed at the token endpoint. Same flow, two scopes:

```text
scope=profile          -> {"access_token":"eyJhbGciOiJSUzI1NiIs...","token_type":"Bearer","scope":"email profile",...}
scope=openid&nonce=... -> {"access_token":"eyJhbGciOiJSUzI1NiIs...","token_type":"Bearer",
                           "id_token":"eyJhbGciOiJSUzI1NiIs...","scope":"openid email profile",...}
```

Without `openid` it is plain OAuth; with it, the response gains `id_token`.

### ID token versus access token, side by side (measured)

Both are RS256 JWTs signed by the same key (same `kid`). Decoded:

| Claim | ID token | Access token |
|---|---|---|
| `aud` | `web-app` (the client) | `account` (an API) |
| `typ` (Keycloak extra) | `ID` | `Bearer` |
| `nonce`, `at_hash` | `n-0S6_WzA2Mj`, `8X3sHIO5FueuXOnscLGA4w` | absent |
| `scope`, `realm_access`, `resource_access` | absent | present (roles for APIs) |
| `iss`, `sub`, `azp`, `exp`, `iat`, `auth_time`, `acr`, `sid` | same values | same values |

The ID token tells `web-app` "alice authenticated at `auth_time` with `acr` 1,
answering your `nonce`". An API accepting it as a bearer credential accepts a
token minted for someone else; Keycloak's UserInfo endpoint refuses it:

```text
Bearer $ACCESS_TOKEN -> 200 {"sub":"8f4d6d0a-...","name":"Alice Doe","email":"alice@example.org",...}
Bearer $ID_TOKEN     -> 401 WWW-Authenticate: Bearer realm="demo", error="invalid_token",
                        error_description="Token verification failed"
```

Rule: the client consumes the ID token once, at login; APIs get access tokens.
UserInfo returns fresh profile data (changed after login, or too large for the
token); its `sub` must equal the ID token's `sub`.

### The standard claims

| Claim | Meaning and purpose |
|---|---|
| `iss` | issuer URL, exactly as in discovery: which IdP vouches |
| `sub` | stable user id within `iss`; key users by (`iss`, `sub`), never by a recyclable `email` |
| `aud` | client_id(s) the token is for: stops reuse at another client |
| `exp`, `iat` | expiry and issue time in seconds: bound the replay window |
| `nonce` | echo of the value the client sent: binds the token to this login |
| `auth_time` | when the user really authenticated: checked against `max_age` |
| `acr` / `amr` | level achieved / methods used (`pwd`, `otp`, `hwk`, RFC 8176) |
| `azp` | authorized party; since errata set 2, defined only by extensions |
| `at_hash` | left half of SHA-256 of the access token: ties the two tokens |
| `sid` | IdP session id, used by front- and back-channel logout |

### Discovery and JWKS (measured)

The RP is configured with one URL, the issuer; the rest comes from discovery:

```text
$ curl -s localhost:6240/realms/demo/.well-known/openid-configuration | jq '{...}'
"issuer": "http://localhost:6240/realms/demo",  "jwks_uri": ".../protocol/openid-connect/certs",
"end_session_endpoint": ".../logout",  "userinfo_endpoint": ".../userinfo",
"acr_values_supported": ["0","1"],  "prompt_values_supported": ["none","login","consent"],
"id_token_signing_alg_values_supported": ["PS384","RS384","EdDSA","ES384","HS256",...,"RS256",...]
$ curl -s .../certs | jq -c '.keys[] | {kid, kty, alg, use}'
{"kid":"F827YyZ-rIWKo1ke7hIbRHCK1rcDgiwEaSICj9ptTL8","kty":"RSA","alg":"RS256","use":"sig"}
{"kid":"nIX7awUkxoaDaQFUNkrHTa7BD7nND_EJ16mH6w3LXro","kty":"RSA","alg":"RSA-OAEP","use":"enc"}
```

The JWKS (RFC 7517) lists public keys by `kid`; only `use: sig` keys verify
tokens. The algorithm list is what the IdP *can* sign with; the RP pins the
one it registered.

### Validating an ID token, step by step (measured)

The order of OIDC Core section 3.1.3.7, in Node 22 with `node:crypto` only:

```js
check('alg allowlist', ['RS256'].includes(header.alg), header.alg);    // never the header's choice
await loadJwks(process.env.JWKS_CACHE);                                // kid -> KeyObject cache
if (!jwks.has(header.kid)) { console.log('     kid not cached, refetching JWKS once'); await loadJwks(); }
check('kid in JWKS', jwks.has(header.kid), header.kid);
check('signature', verify('RSA-SHA256', Buffer.from(`${h}.${p}`), jwks.get(header.kid), b64(s)));
check('iss', claims.iss === ISSUER, claims.iss);                       // exact string match
const aud = [].concat(claims.aud);
check('aud contains client_id', aud.includes(clientId), JSON.stringify(claims.aud));
if (aud.length > 1 || claims.azp) check('azp is client_id', claims.azp === clientId, claims.azp);
check('exp', now < claims.exp + SKEW, `exp=${claims.exp} now=${now}`); // SKEW = 60 s
check('iat not in future', claims.iat <= now + SKEW);
check('nonce', claims.nonce === nonce, `${claims.nonce} vs ${nonce}`); // nonce kept in the RP session
const d = createHash('sha256').update(accessToken).digest();
check('at_hash', claims.at_hash === d.subarray(0, d.length / 2).toString('base64url'), claims.at_hash);
```

The happy path prints ten `ok` lines and `valid: sub=8f4d6d0a-... acr=1`. Each
attack, with the line where it stops:

```text
same token, login session expects nonce n-NEW-LOGIN  -> FAIL nonce: n-0S6_WzA2Mj vs n-NEW-LOGIN
web-app's ID token sent to other-app                 -> FAIL aud contains client_id: "web-app"
access token presented as an ID token                -> FAIL aud contains client_id: "account"
payload edited to email admin@example.org            -> FAIL signature
header replaced by {"alg":"none"}, signature empty   -> FAIL alg allowlist: none
same token checked 10 minutes later                  -> FAIL exp: exp=1795049555 now=1795049855
genuine ID token paired with another access token    -> FAIL at_hash: WSQE3SXWpCsDp7H8whd6NQ
```

The `nonce` is random, kept in the user's session before the redirect: a token
from another login (logs, leaked URL, injected code) carries the wrong one. The
spec lets a code-flow client skip the signature (token came over TLS); libraries verify anyway.

### Key rotation and the JWKS cache (measured)

A second RSA key provider with higher priority was added at runtime. JWKS then
listed two `sig` keys and new tokens carried the new `kid`:

```text
new token kid: qu4GcQOydxK6X2_yXpd-tdI3lP0KqLWEw8M774IxQMA
validator still holding the old JWKS -> "kid not cached, refetching JWKS once" -> ok signature
token signed before rotation          -> ok (old key still published)
old key provider deleted              -> JWKS lists only qu4G...; old token: FAIL kid in JWKS
```

Cache the JWKS, refetch once on an unknown `kid` with a rate limit (else random
`kid`s make the RP hammer the IdP), and keep the old key published for the
longest token lifetime: removing it early fails every live token at once.

### Asking the IdP for a kind of login (measured)

```text
prompt=none, no IdP session      -> callback?error=login_required&state=st123&iss=...
first login                      -> {"auth_time":1795049269,"iat":1795049269,"acr":"1"}
prompt=none, 5 s later (SSO)     -> {"auth_time":1795049269,"iat":1795049274,"acr":"0"}
max_age=2                        -> login form again; {"auth_time":1795049274,"acr":"1"}
login_hint=alice                 -> <input id="username" name="username" value="alice" ...>
acr_values=2 (no level 2 set up) -> code issued, {"acr":"1"}, no error
claims={"id_token":{"acr":{"essential":true,"values":["2"]}}} -> fresh login, {"acr":"1"}, no error
```

`prompt=none` is a silent SSO check; an SSO-cookie login keeps the old
`auth_time` and Keycloak reports `acr` 0. `max_age` (or `prompt=login`) forces
real authentication, visible in `auth_time`. The trap: `acr_values` is a request,
Keycloak answered with a weaker level and no error, so the RP must compare the
token's `acr` with what it asked for. `amr` needs a mapper plus per-authenticator
references in Keycloak (a bare mapper gave `"amr":[]`; the rest is docs only).
The factors themselves are the MFA lesson (I3) of this track.

### Flows: code today, implicit and hybrid as history (measured)

Book versus today: implicit (`response_type=id_token token`) returned tokens in
the URL fragment (hence `at_hash` and a mandatory `nonce`); hybrid (`code
id_token`) returned an early ID token to detect code injection. RFC 9700 (2025)
and OAuth 2.1 drop implicit, code with PKCE covers SPAs, mobile and servers, and
hybrid survives in FAPI 1.0 Advanced. Keycloak's answer to implicit on a
default client: `#error=unauthorized_client` ("Implicit flow is disabled").

### Logout: three mechanisms, three guarantees (measured)

Two sessions exist: the IdP's (SSO cookie, `sid`) and each RP's own cookie.
**RP-initiated logout** ends the IdP session from the app:

```text
GET .../logout?id_token_hint=<ID token>&post_logout_redirect_uri=http://localhost:6241/bye&state=lo-state
front-channel on -> 200, HTML with
  <iframe src="http://localhost:6241/frontchannel-logout?sid=aAdy9deh9NwUfa_FcGN5ZdpM&iss=http%3A%2F%2F..." style="display:none;">
  window.location.replace("http://localhost:6241/bye?state=lo-state")
afterwards: prompt=none -> error=login_required; UserInfo with old access token -> 401
            local validation of the old ID token -> valid (signature and exp still fine)
unregistered post_logout_redirect_uri -> 400 "Invalid redirect uri"; no id_token_hint -> "Do you want to log out?"
```

**Front-channel** depends on the browser loading that hidden iframe. curl never
rendered it and the RP's log stayed empty: the RP was never told. Browsers that
block third-party cookies deliver the call without the RP's session cookie.
**Back-channel** (front-channel switched off) is a server-to-server POST:

```text
POST /backchannel-logout  application/x-www-form-urlencoded  logout_token=eyJhbGciOiJSUzI1NiIsInR5cCI...
{"alg":"RS256","typ":"logout+jwt","kid":"qu4GcQOydxK6X2_yXpd-tdI3lP0KqLWEw8M774IxQMA"}
{"aud":"web-app","events":{"http://schemas.openid.net/event/backchannel-logout":{}},"exp":1795049480,
 "iat":1795049360,"iss":"http://localhost:6240/realms/demo","jti":"1debca12-...",
 "sid":"JFu3aqJyAOMDo9WXylI2NJWO","sub":"8f4d6d0a-...","typ":"Logout"}
```

The RP validates it like an ID token (signature, `iss`, `aud`, `iat`), checks
`events`, rejects it if it has a `nonce` (so it never passes as an ID token),
deletes its sessions by `sid` and answers 200 with `Cache-Control: no-store`.
It needs IdP-to-RP connectivity and sessions in a shared store. None of the
three revokes issued tokens: a JWT access token lives until `exp`.

### Validation map: claim, who checks, what it prevents

| Claim / check | Checked by | Skipping it allows |
|---|---|---|
| `alg` allowlist | RP | `alg: none` and RS256-to-HS256 forgery |
| signature with JWKS `kid` | RP (API for access tokens) | forged or edited claims |
| `iss` exact match | RP | tokens from another IdP or tenant |
| `aud` contains client_id | RP | a token minted for another app logs into yours |
| `exp`, `iat` | RP | indefinite replay of a leaked token |
| `nonce` | RP (from its session) | replay or injection of another login's token |
| `at_hash` | RP, when present | swapping the access token in a response |
| `acr`, `amr`, `auth_time` | RP | silent downgrade from MFA, stale login |
| logout token: `events`, no `nonce` | RP | logout token replayed as an ID token |

Next in this track: JWT, JWS, JWE and JWK (I11) covers the `alg` confusion,
`kid` injection and clock skew behind this table; SAML 2.0 (I5) is the XML
predecessor still common in enterprise SSO, with OIDC the default for new
apps. ASP.NET Core (OIDC and BFF) and Spring implementations are in the related concepts.

## Trade-offs

- **Claims in the ID token versus UserInfo.** Token claims cost no call but go
  stale and bloat cookies; UserInfo is fresh but adds latency at login.
- **Front-channel versus back-channel logout.** Front-channel needs no network
  path but depends on iframes and third-party cookies (measured: no browser, no
  notification); back-channel is reliable but needs IdP-to-RP reachability and
  a session store indexed by `sid`.
- **Short tokens versus IdP load.** Keycloak's default `expires_in: 300` limits
  damage after logout at the cost of more refreshes; logout never revokes a JWT.
- **Strict `acr` checks versus availability.** Rejecting a lower `acr` blocks
  users when the IdP is misconfigured; accepting it makes "MFA required" a suggestion.

## Documentation Links

- [OpenID Connect Core 1.0 incorporating errata set 2, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [OpenID Connect Discovery 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-discovery-1_0.html) (doc)
- [OpenID Connect RP-Initiated Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) (doc)
- [OpenID Connect Front-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-frontchannel-1_0.html) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [RFC 7517, JSON Web Key (JWK), IETF](https://www.rfc-editor.org/rfc/rfc7517) (doc)
- [RFC 8176, Authentication Method Reference Values, IETF](https://www.rfc-editor.org/rfc/rfc8176) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
