---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Basic OAuth (code + PKCE, short tokens, refresh rotation) is the previous lesson. This one is the
hardening layer on top, in the order of the problem each piece solves: the RFC 9700 Security BCP,
the `iss` defense against mix-up, sender-constrained tokens with DPoP and mTLS (a stolen token stops
working), PAR and JAR (the request leaves the browser URL), RAR (fine-grained permissions), resource
indicators (one token per API) and FAPI 2.0, the profile that combines them. Every defense runs
against a lab of your own, a local Keycloak and a local resource server: first what gets through
without it, then the refusal. Signing needs code, so the client and the resource server are Node 22
files with `node:crypto` only (no packages, every check visible).
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev --features=resource-indicators`,
HTTPS with `--https-client-auth=request`), Node 22.23.4, OpenSSL 4.0.3, curl 8.7.1, jq 1.7.1.

## Use Cases

- Deciding whether an app needs DPoP, mTLS or PAR, or just a clean code + PKCE setup.
- Writing a resource server that refuses a stolen token instead of serving it.
- Reviewing an authorization server's discovery document for weak defaults.
- Scoping a token to one API when one client talks to many (MCP hosts, BFFs).

## Deep Dive

### The lab and RFC 9700 in one table

Keycloak `idn-bcp-keycloak` on 6460 (HTTP) and 6461 (HTTPS, client certificates checked against a
lab CA made with `openssl`), realm `demo`, user `alice`, clients `dpop-svc`, `bearer-svc`,
`svc-mtls`, `par-web` and `spa`; the lab resource server (RS) listens on 6463 (DPoP) and HTTPS 6464
(mTLS). RFC 9700 (January 2025) is the Security BCP, folded into OAuth 2.1. Its section 2:

| Rule (RFC 9700) | Stops | Where |
|---|---|---|
| Exact redirect URI match (2.1) | code sent to an attacker page under a wildcard | measured in the OAuth lesson |
| PKCE for every client, S256 only (2.1.1) | code injection, CSRF, a leaked code redeemed | OAuth lesson |
| No implicit grant (2.1.2) | tokens in URL fragments, impossible to sender-constrain | OAuth lesson |
| Mix-up defense when a client knows several AS (2.1) | a code from AS A sent to AS B | measured below |
| Sender-constrained access tokens, SHOULD (2.2.1) | replay of a leaked bearer token | DPoP, mTLS below |
| Public-client refresh tokens rotated or bound, MUST (2.2.2) | a stolen refresh token living forever | rotation in the OAuth lesson |
| Audience-restricted tokens (2.3) | one API replaying a token at another | resource indicators below |
| No ROPC, MUST NOT (2.4) | apps that see passwords and skip MFA | OAuth lesson |
| Asymmetric client auth, mTLS or `private_key_jwt` (2.5) | leaked shared secrets | mTLS below |

**Code injection** (section 4.5): the attacker plays a stolen code into their own session at the
real client and logs in as the victim; PKCE stops it: that session holds another `code_verifier`.
**Mix-up** (section 4.4): a client that knows an honest and an attacker AS starts at the attacker,
which bounces the user to the honest AS; the client then sends the honest code to the attacker.

### Mix-up: the `iss` check is the client's job (measured)

Keycloak advertises `"authorization_response_iss_parameter_supported": true` and adds `iss` to every
redirect, errors included. RFC 9207 makes the client compare it with the AS the flow started at, and
reject a missing `iss` when the metadata promised one. The real redirect and two edited copies:

```text
Location: http://localhost:6462/cb?state=1acwBr621cs&session_state=Mt94...&iss=http%3A%2F%2Flocalhost%3A6460%2Frealms%2Fdemo&code=517bd9e5-...
RFC 9207 check, genuine      : accept code 517bd9e5...
RFC 9207 check, iss swapped  : reject: iss https://attacker-as.example is not the AS this flow started with
RFC 9207 check, iss stripped : reject: iss missing but AS metadata says authorization_response_iss_parameter_supported
```

An AS that sends `iss` protects nobody if the client library ignores it.

### Bearer is cash: DPoP proofs (RFC 9449)

A bearer token works for whoever holds it: a log line, a proxy, an XSS payload. DPoP binds it to a
key pair the client generates. The AS writes the RFC 7638 thumbprint of the public key into the
token (`cnf.jkt`), and every request carries a fresh proof, a JWT signed with the private key:

```js
function proof(k, htm, htu, extra = {}) {
  const h = b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: k.jwk }));       // public key in the header
  const p = b64u(JSON.stringify({ jti: randomUUID(), htm, htu, iat: now(), ...extra })); // + ath, nonce
  return `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }))}`;
}
```

`htm`/`htu` pin method and URL, `iat`/`jti` limit replay, `ath` (SHA-256 of the access token) ties the
proof to one token, `nonce` is an optional server challenge. Keycloak: supported since 26.4.0.

### DPoP at the authorization server (measured)

```text
client key thumbprint (RFC 7638): 0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4
token without DPoP header             -> 400 {"error":"invalid_request","error_description":"DPoP proof is missing"}
token with DPoP proof                 -> 200 {"token_type":"DPoP","expires_in":300}
access token cnf                      -> {"jkt":"0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4","kc-jkt-type":"DPoP"}
same proof replayed at /token         -> 400 {"error":"invalid_request","error_description":"DPoP proof has already been used"}
proof with wrong htu at /token        -> 400 {"error":"invalid_request","error_description":"DPoP HTTP URL mismatch"}
client without DPoP required + proof  -> 200 DPoP {"jkt":"0rYIOCnWJwff3Up8abH75PjMcMVAmmMjB1srrbgsOn4","kc-jkt-type":"DPoP"}
```

`cnf.jkt` equals the thumbprint the client computed. A client not forced to use DPoP still gets a
bound token when it sends a proof, so rollout can go client by client.

### DPoP at the resource server: every check, every failure (measured)

The AS only binds; the RS enforces. The lab RS validates the token (RS256 via JWKS, `iss`, `aud`,
`exp`), then the proof in the order of RFC 9449 section 4.3, then compares the proof key with `cnf.jkt`:

```text
legit: DPoP scheme + fresh proof             -> 200 {"ok":true,"path":"/orders","azp":"dpop-svc"}
stolen token as Bearer                       -> 401 error="invalid_token", error_description="DPoP-bound token sent with Bearer scheme"
stolen token + proof from thief key          -> 401 error="invalid_token", error_description="proof key does not match cnf.jkt"
captured proof replayed (same jti)           -> 401 error="invalid_dpop_proof", error_description="jti aabd9624-... replayed"
proof for GET /orders sent to DELETE         -> 401 error="invalid_dpop_proof", error_description="htm GET vs DELETE"
proof for /orders sent to /payments          -> 401 error="invalid_dpop_proof", error_description="htu http://localhost:6463/orders vs http://localhost:6463/payments"
proof whose ath is for another token         -> 401 error="invalid_dpop_proof", error_description="ath does not match this access token"
proof with iat 5 minutes old                 -> 401 error="invalid_dpop_proof", error_description="iat 1795067494 outside 60 s window"
/payments without nonce                      -> 401 error="use_dpop_nonce", error_description="nonce required"   DPoP-Nonce: x0gKa997JAegD5t42a-vaw
/payments retried with that nonce            -> 200 {"ok":true,"path":"/payments","azp":"dpop-svc"}
```

The first refusal is the one most often missing: an RS that accepts `Bearer` for a token with `cnf`
throws the binding away (RFC 9449 section 7.2). Share the `jti` cache across RS replicas; the nonce
shrinks the window for proofs made in advance. DPoP cannot stop code running inside the client that
asks the client's own key to sign (XSS in a SPA); non-extractable WebCrypto keys only raise the bar.

### mTLS: certificate-bound tokens (RFC 8705, measured)

For service to service, the TLS client certificate does two jobs: it authenticates the client to
the AS (`client-x509`, subject `CN=svc-a`, no secret) and binds the token (`cnf.x5t#S256`, the
SHA-256 of the DER certificate, cross-checked with `openssl x509 -outform DER | openssl dgst -sha256`):

```text
token with svc-a cert    -> 200 {"iss":"https://localhost:6461/realms/demo","azp":"svc-mtls","cnf":{"x5t#S256":"hOOC3ltSJqdDdBIvwSnI3-hbVha_qn89i3dBVvzlKz0"}}
token with mallory cert  -> 401 {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"}
token with no cert       -> 401 {"error":"invalid_client","error_description":"Invalid client or Invalid client credentials"}
--- resource server (https :6464, requestCert)
svc-a cert + its token                 -> 200 {"ok":true,"subject":"svc-a"}
mallory cert (same CA) + stolen token  -> 401 ... "cert thumbprint gtx3sgmb2iOcdyQONuGFDI5URR6XHj5hkCqYup1oJuE != cnf.x5t#S256 hOOC3ltSJqdDdBIvwSnI3-hbVha_qn89i3dBVvzlKz0"
no cert + stolen token                 -> 401 ... "no client certificate on the TLS connection"
```

A certificate from the same CA is not enough: the RS compares the exact certificate. Two traps: a
TLS-terminating proxy must forward the client certificate in a header it always overwrites (never
passes through), and rotating the certificate strands every live token until it is refreshed.
**Which one:** DPoP for SPAs, mobile and public clients, or anything behind TLS termination (no PKI,
one signature per call); mTLS for service to service with a PKI or a mesh (free per call, and it
authenticates the client too).

### PAR and JAR: the request leaves the URL (measured)

A front-channel authorization request is a URL that the user, extensions, logs and an attacker can
read and edit. PAR (RFC 9126) has the client POST the whole request to the AS first, authenticated,
and hand the browser only a handle:

```text
classic front-channel request (264 chars) -> 302 http://localhost:6462/cb?error=invalid_request&error_description=Pushed+Authorization+Request+is+only+allowed.&state=...&iss=...
POST /ext/par/request -> 201 {"request_uri":"urn:ietf:params:oauth:request_uri:1c946853-52f2-558c-871e-d553e706bffd","expires_in":60}
browser URL (173 chars): http://localhost:6460/realms/demo/protocol/openid-connect/auth?client_id=par-web&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A1c946853-...
login -> Location: http://localhost:6462/cb?state=1acwBr621cs&session_state=Mt94...&iss=http%3A%2F%2Flocalhost%3A6460%2Frealms%2Fdemo&code=517bd9e5-...
same request_uri again -> 400 Invalid Request
PAR with unregistered redirect_uri -> 400 {"error":"invalid_request","error_description":"Invalid parameter: redirect_uri"}
```

Scope, redirect URI, PKCE challenge and state never reach the browser, the handle is one-time and
lives 60 s, and a bad redirect URI fails on the back channel before any user is involved. JAR
(RFC 9101, docs only) signs the request itself (`request=<JWT>`, in the PAR body when combined) so
nobody can alter it. Defaults worth auditing in the discovery document: `"none"` is in
`request_object_signing_alg_values_supported` and `"plain"` in `code_challenge_methods_supported`;
pin the client's algorithm and S256, or apply a Keycloak client policy profile.

### RAR: permissions finer than a scope (measured)

`scope=payments` cannot say "123.50 EUR to this IBAN, once". RFC 9396 adds `authorization_details`,
a JSON array of typed objects that the consent screen shows and the token carries:

```text
authorization_details=[{"type":"payment_initiation","actions":["initiate"],"instructedAmount":{"currency":"EUR","amount":"123.50"},"creditorName":"Merchant A","creditorAccount":{"iban":"DE02100100109307118603"}}]
PAR with authorization_details -> 201 {"request_uri":"urn:ietf:params:oauth:request_uri:392139ac-...","expires_in":60}
  ...authorize -> http://localhost:6462/cb?error=invalid_request&error_description=Unsupported type 'payment_initiation' of authorization_details parameter supplied in the request. Supported values: []
```

Keycloak 26.8.2 parses the parameter but has no custom types: no `authorization_details_types_supported`
in its metadata, no RFC 9396 in its standards list. Auth0 documents RAR under an add-on (table below).

### Resource indicators: one token per API (measured)

One client, two APIs: without a target the token is valid at both, so either API can replay it at
the other. RFC 8707 adds `resource` (experimental in Keycloak 26.8.2, `--features=resource-indicators`
plus `resource_url` on the API client):

```text
client_credentials, no resource               -> aud ["orders-api","reports-api","account"]
resource=https://orders.example/api           -> aud "https://orders.example/api"
resource=https://evil.example                 -> 400 {"error":"invalid_target","error_description":"The requested resource is invalid, missing, unknown, or malformed."}
code flow: authorize orders, token orders     -> aud "https://orders.example/api"
code flow: authorize orders, token reports    -> 400 {"error":"invalid_target","error_description":"The requested resource is not matching the original request."}
```

`aud` becomes the resource URL, not the client id, so an RS checking `aud == "orders-api"` must switch
to its URL. MCP requires exactly this binding; the MCP authorization concept measures it with the C# SDK.

### FAPI 2.0: all of it, mandatory (docs only)

The FAPI 2.0 Security Profile (OpenID Foundation, Final) targets open banking and other APIs where a
stolen token moves money or data. Its authorization servers shall: accept only confidential clients,
authenticated with mTLS or `private_key_jwt`; issue only sender-constrained tokens (mTLS or DPoP);
require PAR and reject requests without it; require PKCE S256; return `iss`; keep codes 60 s at most
and `request_uri` under 600 s. A surprise: it forbids refresh token rotation outside extraordinary
cases, since with bound tokens and confidential clients rotation only adds failure modes. Message
Signing (a sibling spec) adds signed requests and responses; Keycloak ships `fapi-2-*` client profiles.

### What most apps need versus high risk

**Every app (the BCP baseline):** code + PKCE S256, exact redirect URIs, no implicit or ROPC, short
access tokens (5 to 15 minutes), `aud` checked by every API, refresh rotation for public clients,
`iss` checked, `resource` when one client calls several APIs. **High risk only** (money, health,
admin, agents with broad reach): DPoP or mTLS, PAR (plus JAR for signed requests), RAR, FAPI 2.0.

### Threat, mitigation, cost, support

| Threat | Mitigation | Adoption cost | Keycloak 26.8.2 | Entra ID | Auth0 |
|---|---|---|---|---|---|
| Stolen bearer token replayed | DPoP (RFC 9449) | client signs each call; RS checks proof, `jti` | supported (measured) | "aims to support" (MSAL docs), no GA status | documented |
| Same, service to service | mTLS (RFC 8705) | PKI, proxy forwarding | supported (measured) | mTLS PoP, private preview, app-only tokens | HRI add-on |
| Request read or edited in the browser | PAR (RFC 9126), JAR (RFC 9101) | one back-channel call | supported (PAR measured) | not documented | HRI add-on |
| Coarse consent | RAR (RFC 9396) | types, consent UI, RS checks | no custom types (measured) | not documented | HRI add-on |
| Token replayed at another API | resource indicators (RFC 8707) | one token per API | experimental (measured) | not documented | not documented |
| Mix-up across AS | `iss` (RFC 9207) | one client-side comparison | supported (measured) | not documented | not documented |

"Not documented": the vendor pages checked say nothing. HRI: Auth0 Highly Regulated Identity, an Enterprise add-on.

### Where to go next

Token exchange (I13) shows a service trading a bound token for a narrower one downstream instead of
forwarding it; sessions and revocation (I18) cover what happens to bound tokens at logout. The MCP
concepts apply `resource`, `iss` and client registration to agent hosts.

## Trade-offs

- **DPoP versus plain bearer.** DPoP stops replay but costs a signature per call, a shared `jti` store
  and nonce retries (one extra 401 on `/payments`); short bearer tokens behind a BFF often suffice.
- **mTLS versus DPoP.** mTLS is free per call but needs a PKI and breaks at proxies that drop the certificate.
- **PAR versus a plain redirect.** One round trip buys an authenticated, one-time request; a public SPA gains less.
- **Rotation versus binding for refresh tokens.** The BCP accepts either for public clients; FAPI 2.0
  forbids rotation for its bound confidential clients, because a lost response logs the user out.
- **Experimental features.** Keycloak's `resource-indicators` may change: pin the version, retest `aud`.

## Documentation Links

- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP), IETF](https://datatracker.ietf.org/doc/html/rfc9449) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [RFC 9126, OAuth 2.0 Pushed Authorization Requests, IETF](https://datatracker.ietf.org/doc/html/rfc9126) (doc)
- [RFC 9101, JWT-Secured Authorization Request (JAR), IETF](https://datatracker.ietf.org/doc/html/rfc9101) (doc)
- [RFC 9396, OAuth 2.0 Rich Authorization Requests, IETF](https://datatracker.ietf.org/doc/html/rfc9396) (doc)
- [RFC 8707, Resource Indicators for OAuth 2.0, IETF](https://datatracker.ietf.org/doc/html/rfc8707) (doc)
- [RFC 9207, OAuth 2.0 Authorization Server Issuer Identification, IETF](https://datatracker.ietf.org/doc/html/rfc9207) (doc)
- [FAPI 2.0 Security Profile, OpenID Foundation](https://openid.net/specs/fapi-security-profile-2_0-final.html) (doc)
- [Securing applications with DPoP, Keycloak](https://www.keycloak.org/securing-apps/dpop) (doc)
- [Supported specifications, Keycloak](https://www.keycloak.org/securing-apps/specifications) (doc)
- [Integrating with Model Context Protocol (resource indicators), Keycloak](https://www.keycloak.org/securing-apps/mcp-authz-server) (doc)
- [Proof-of-Possession tokens, MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/advanced/proof-of-possession-tokens) (doc)
- [Token binding with mTLS PoP, Microsoft Identity Web, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/call-downstream-apis/token-binding) (doc)
- [Sender constraining, Auth0](https://auth0.com/docs/secure/sender-constraining) (doc)
- [Highly Regulated Identity, Auth0](https://auth0.com/docs/secure/highly-regulated-identity) (doc)
