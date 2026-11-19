---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A user calls service A with an access token, and A needs data from service B.
The tempting move is to forward the token. This lesson shows on the wire why
that fails (and why it is forbidden when it works), then measures the real
answers on a Keycloak realm: A's own credential, token exchange (RFC 8693) as
impersonation, and as delegation, where the token carries a nested `act` claim
naming A. It tests what the server refuses (widening, wrong audience, wrong
requester, expired subject), ignores (`resource`) and cannot do (a delegation
chain). Microsoft Entra on-behalf-of is docs only (no tenant). Tools: curl, jq, Node 22.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`,
`--features=token-exchange-delegation,parameterized-scopes`), curl 8.7.1,
jq 1.7.1, Node 22.23.4. Docs only: Microsoft Entra ID, Microsoft.Identity.Web 4.18.0.

## Use Cases

- Reviewing a service that copies the incoming `Authorization` header into its outgoing calls.
- Choosing between a service credential, impersonation and delegation for an API chain.
- Reading `act` in a token or audit log; designing the downstream call of an MCP server, gateway or BFF.

## Deep Dive

### The problem, measured: A cannot forward the token

Realm `demo`: alice signs in at the public client `web` (password grant, a lab
shortcut to skip the browser; the PKCE flow is in the OAuth lesson) and her token
is audience-restricted to service A (`svc-a`). Service B (`svc-b`) is a Node
resource server checking signature, `iss`, `exp`, `aud` and `scope` (RFC 9700
section 2.3: a resource server MUST refuse a token not meant for it).

```text
alice's token : {"sub":"a568...","aud":["svc-a","account"],"azp":"web","scope":"a.use profile email"}
A forwards it : {"error":"invalid_token","detail":"aud [\"svc-a\",\"account\"] does not contain svc-b"} HTTP 401
```

The refusal is the good case. If B skipped the `aud` check, or alice's token
included `svc-b`, the forwarded token would work: B cannot tell A from alice, A
can replay it anywhere that audience is accepted, and every scope alice has is
exposed to every service A calls. (The MCP security lesson covers passthrough and the confused deputy.)

### Answer 1: A uses its own credential (client credentials)

```text
B sees A's own token: {"ok":true,"sub":"e151...","azp":"svc-a","aud":["svc-b","account"],"act_chain":[]} HTTP 200
```

Right for jobs with no user (batch, cache refresh). For a user request it loses the
user: `sub` is A's service account, so B cannot apply per-user rules or log the user,
and A holds authority no user consented to.

### Answer 2: token exchange, impersonation form (RFC 8693)

One grant at the token endpoint: A presents the user's token and asks for a
different one. Parameters as RFC 8693 and Keycloak use them:

| Parameter | Meaning | Keycloak standard exchange |
|---|---|---|
| `subject_token`, `subject_token_type` | the user's token and its type | access tokens only |
| `audience` / `resource` | name / URI of the target | `audience` yes, `resource` ignored |
| `scope`, `requested_token_type` | what is wanted | optional scopes of the requester; access, ID or refresh |
| `actor_token`, `actor_token_type` | who acts (delegation) | access token of the actor |

Standard token exchange V2 (supported since Keycloak 26.2, on by default) needs
a switch on the requester, which must be confidential: attribute
`standard.token.exchange.enabled=true` on `svc-a`. A authenticates and sends alice's token:

```bash
curl -s -u svc-a:a-secret $B/token -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token=$ALICE -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d audience=svc-b -d scope=b.read
```

```text
{"expires_in":20,"token_type":"Bearer","scope":"b.read profile email","issued_token_type":"urn:ietf:params:oauth:token-type:access_token",...}
new token : {"sub":"a568...","aud":"svc-b","azp":"svc-a","scope":"b.read profile email"}
B sees    : {"ok":true,"sub":"a568...","azp":"svc-a","aud":"svc-b","act_chain":[]} HTTP 200
```

`sub` is alice, `aud` is exactly B, `azp` is A: **impersonation**. B sees alice and
the only trace of A is `azp`, which is not a delegation claim. `expires_in` is 20
because alice's token lives 20 s (a client attribute on `web`) while `svc-a`'s default
is 300 s: the exchanged token cannot outlive its subject (a change in recent
Keycloak, per its upgrade guide; before it a client could re-exchange forever).

### What the server refuses, ignores and allows (measured)

`svc-x` is a confidential client with exchange off.

| Request | Answer |
|---|---|
| audience `svc-nope` | `invalid_client`, "Audience not found" |
| subject token whose `aud` lacks `svc-a` | `access_denied` (403), "Client is not within the token audience" |
| `svc-x` or public `web` as requester | `invalid_request`, "Standard token exchange is not enabled for the requested client" |
| wrong secret; unknown `scope` | `unauthorized_client`; `invalid_scope` |
| garbage token, or alice's token after 20 s | `invalid_request`, "Invalid token" (no separate "expired") |
| `resource=http://svc-b/` instead of `audience` | HTTP 200, `resource` ignored; `aud` came from the scope |

RFC 8693 section 2.2.2 asks for `invalid_target` on an unknown target; Keycloak
26.8.2 never returned it. The docs say `resource` is not supported yet, and the lab
shows it is dropped without an error: never rely on it.

### Downscoping: the default allows widening, one executor stops it (measured)

Keycloak docs: by default exchange "can be used to request extra scopes and audiences
that are not present in the initial subject_token" (`scope` picks among the requester's
optional scopes). Executor off, alice's token had only `a.use`, and A asked for C:

```text
exchange audience=svc-c scope=c.read -> {"sub":"a568...","aud":"svc-c","azp":"svc-a","scope":"c.read profile email"}
```

Alice never had `c.read`; A minted it (RFC 8693 does not force narrowing: server
policy). The control is the client policy executor `downscope-assertion-grant-enforcer`
(a profile plus a policy with condition `any-client`, via `PUT /admin/realms/demo/client-policies/profiles`
and `/policies`). With it on:

```text
subject b.read b.write, ask b.read   -> {"aud":"svc-b","scope":"b.read profile email"}   (narrowing allowed)
subject b.read only,    ask b.write  -> {"error":"invalid_scope","error_description":"Scopes [b.write] not present in the initial access token [a.use, profile, b.read, email]"}
subject b.read, no scope parameter   -> {"error":"invalid_request","error_description":"Requested audience not available: svc-b"}
```

Last row: `audience` only filters audiences A's own scopes produce, it never adds one.
Turn the executor on for every requester, as you would PKCE.

### Answer 3: delegation, `may_act` in, `act` out (Keycloak preview, measured)

With delegation the new token says "alice, through A". RFC 8693 uses two claims:
`may_act` in the subject token (alice allows A) and `act` in the issued one (A is
acting). In Keycloak 26.8 this is a **preview**, and the lab needed four things the
docs list and that fail quietly when missing:

(1) Admin permissions (FGAP V2) on, with a `Users` permission, scope `delegate`, policy =
client `svc-a`. (2) A login client with **Consent required** (`portal`, code flow).
(3) A login asking `scope=openid b.read delegation:client:svc-a`. (4) Alice accepts a
consent screen (never stored: asked on every login).

Without the permission the log said `WARN ... Client 'svc-a' is not allowed to
delegate as user 'alice'` and the login still succeeded, with no `may_act`. With it:

```text
portal token: {"sub":"a568...","aud":["svc-a","svc-b"],"azp":"portal","scope":"openid b.read a.use profile email delegation:client:svc-a",
               "may_act":{"sub":"e151...","client_id":"svc-a"}}
```

A gets its own token (`client_credentials`, `$A_OWN`) and repeats the exchange above with
the portal token as `subject_token` plus `actor_token=$A_OWN` and
`actor_token_type=urn:ietf:params:oauth:token-type:access_token`:

```text
new token : {"sub":"a568...","aud":"svc-b","azp":"svc-a","scope":"b.read profile email","act":{"sub":"e151...","client_id":"svc-a"}}
B sees    : {"ok":true,"sub":"a568...","azp":"svc-a","aud":"svc-b","act_chain":["svc-a"]} HTTP 200
```

Same alice, same audience, but B knows A is the actor and can log or limit it. No
refresh token, no `sid` (transient session). Refusals measured:

| Request | Answer |
|---|---|
| subject token with `may_act`, no `actor_token` | `invalid_request`, "Subject token with a delegation claim is not allowed for standard token exchange" |
| `actor_token` from `svc-x` | `access_denied`, "Client is not within the token audience" |
| subject token without `may_act` (the plain `web` one) | `invalid_request`, "Invalid may_act claim in the subject_token" |

Keycloak validates only `sub`, `client_id` and `iss` inside `may_act`; extra claims are copied to `act` for readers only.

### The chain A, B, C: Keycloak stops at one hop, the RFC does not

B holds the delegated token and must call C. A plain exchange gets the "delegation
claim is not allowed" error above; with B's own `actor_token` it gets
`invalid_request`, "Invalid may_act claim in the subject_token". So in 26.8.2 a delegated token cannot be exchanged again. RFC 8693 section 4.1
does define the chain: nested `act`, the outermost is the current actor, nested
ones are "informational only" for access control. A short STS of my own (**illustration,
not Keycloak**: HS256, rules coded by hand, `chain.mjs`) with the same checks (requester in
`aud`, scope subset, allowed audiences, `may_act`) shows the shape:

```text
A -> B (aud svc-b, scope orders.read)  {"sub":"alice","aud":"svc-b","scope":"orders.read","act":{"sub":"svc-a"}}
B -> C (aud svc-c, scope orders.read)  {"sub":"alice","aud":"svc-c","scope":"orders.read","act":{"sub":"svc-b","act":{"sub":"svc-a"}}}
B widens to orders.write               -> invalid_scope: orders.write not in the subject token
B asks audience svc-a (back to A)      -> invalid_target: svc-b may not ask for svc-a
```

`sub` never changes, `act` grows one level per hop, every hop narrows `aud`. C authorizes
on `sub` and the outer actor (`svc-b`); `svc-a` is audit data. Keep chains to two or three hops.

### Answer 4: Microsoft Entra on-behalf-of (docs only, no tenant)

Same idea, own grant; all from the Learn page (updated 2025-01-04), not run. A web API
holding a user token (`aud` = itself) POSTs to `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`:

```text
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer   requested_token_use=on_behalf_of
client_id=<API A> + client_secret (or client_assertion with a certificate JWT)
assertion=<token A, aud = this API>   scope=https://graph.microsoft.com/user.read
```

- Not RFC 8693: no `subject_token`, no `actor_token`, no documented `act` (whether the
  issued token names the middle tier: not documented). Delegated scopes only; an app-only token cannot be exchanged.
- Consent comes up front (the middle tier has no UI): `knownClientApplications` with
  `.default` (never mixed with other delegated scopes: AADSTS70011), `preAuthorizedApplications`, or admin consent.
- Downstream Conditional Access answers `interaction_required` with a `claims`
  challenge; the middle tier returns 401 plus `WWW-Authenticate`, and must not retry from cache.
- .NET: Microsoft.Identity.Web, `.EnableTokenAcquisitionToCallDownstreamApi()` and `IDownstreamApi.CallApiForUserAsync(...)`.

### Where this appears, cost, cache and audit

- **MCP.** A tool calling a downstream API for the user is this problem: the server
  validates `aud`, then exchanges (or does OBO). The caller-identity lesson shows where
  the user is read inside the server; gateways and meshes can do the exchange too (keep audience rules in the AS).
- **Cost, measured** (A exchanging alice's token for B, 100 calls, localhost):

```text
100 exchanges      : 3.91 ms each, 100 calls to the AS
100 cached lookups : 0.05 ms each, 1 call to the AS   (key = subject jti + audience + scope; entry dies 5 s before exp)
```

  Cache per user and audience, never past the token. Keycloak does not revoke an exchanged
  access token when the subject is revoked (docs): the TTL is your revocation window.
- **Audit and risks.** Log `sub`, `act`, `aud`, `azp` at the resource server (with
  impersonation the trail says "alice" for something A did). Watch long chains, a requester that
  may widen (the default), `act` used for authorization, exchanged refresh tokens (they outlive the subject token).

### Choosing

| Approach | User preserved | Actor | `aud` | Risk | Use when |
|---|---|---|---|---|---|
| Forward the token | yes, by accident | invisible | wrong or too broad | highest | never |
| Client credentials | no | A as `sub` | B | A's own authority, no per-user control | jobs with no user |
| Exchange, impersonation | yes (`sub`) | only `azp` | B | audit blind spot; widening if unrestricted | one hop, B needs only the user |
| Exchange, delegation | yes (`sub`) | `act` | B | preview in Keycloak, one hop there | B must know and limit the actor |
| Entra OBO | yes | not documented | B | consent setup, claims challenge | Microsoft stack |

### Where to go next

The OAuth security lesson (DPoP, mTLS, resource indicators) covers binding these tokens
and `resource`. Workload identity covers how A authenticates to the AS without a
shared secret (`a-secret` here is what not to ship). The MCP lessons apply this to servers that call APIs.

## Trade-offs

- **Exchange versus own credential.** Exchange keeps the user and narrows the audience
  for one AS call per hop (4 ms here, 0.05 ms cached); a service credential has no user.
- **Impersonation versus delegation.** Impersonation is simple; delegation gives the
  audit trail but in Keycloak needs a preview, FGAP V2 and consent, and stops at one hop.
- **Open versus restricted exchange.** The default lets A mint scopes alice never had; the
  executor closes it but makes the first token the ceiling for every later hop.
- **Token lifetime.** No revocation chain for access tokens: keep them to a minute or two.

## Documentation Links

- [RFC 8693, OAuth 2.0 Token Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc8693) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security (section 2.3), IETF](https://datatracker.ietf.org/doc/html/rfc9700) (doc)
- [Configuring and using token exchange, Keycloak](https://www.keycloak.org/securing-apps/token-exchange) (doc)
- [Keycloak Server Administration Guide (downscoping, client policies), Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Microsoft identity platform and OAuth 2.0 On-Behalf-Of flow, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow) (doc)
- [Web API that calls web APIs: code configuration, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-web-api-call-api-app-configuration) (doc)
