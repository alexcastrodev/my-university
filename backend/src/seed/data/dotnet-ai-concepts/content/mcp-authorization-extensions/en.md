---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

The core MCP authorization flow assumes a person who opens a browser and
consents. Two official extensions, kept in the `modelcontextprotocol/ext-auth`
repository, cover the cases where that is wrong: OAuth Client Credentials
(a pipeline or daemon with no user) and Enterprise-Managed Authorization (the
company IdP decides, through an ID-JAG, and nobody sees a consent screen). This
lesson reads the repository and the 2026-07-28 revisions, then measures both on
localhost: an MCP resource server, an authorization server (AS) and an
enterprise IdP of my own, the C# SDK for the ID-JAG leg, curl for the rest, and
Keycloak for the client authentication rules. No model.
Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2),
Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`), TFM `net10.0`,
SDK 10.0.100, spec revision 2026-07-28, ID-JAG draft revisions 04 to 06,
RFC 10070.

## Use Cases

- A CI job or nightly worker that calls an MCP server with no user present.
- Rolling out MCP clients in a company where IT, not each employee, decides who reaches which server.
- Choosing, for an AS you run, which grants and metadata the extensions require of it.

## Deep Dive

### What the repository holds

Read in full (clone at commit `15ca394`, 2026-10-23): two Stable extensions, each
published as `2026-07-28/` and `draft/`. The two folders of each extension differ
by one line (the `Protocol Revision` header), so today the draft adds nothing.

| extension | identifier | stage | spec |
| --- | --- | --- | --- |
| OAuth Client Credentials | `io.modelcontextprotocol/oauth-client-credentials` | Stable | 163 lines |
| Enterprise-Managed Authorization | `io.modelcontextprotocol/enterprise-managed-authorization` | Stable | 270 lines |

Why outside the core: the core describes one interactive flow. Extensions are
optional, additive and composable, and per SEP-3392 a Stable one changes only
with a new core revision.
Open PRs (not merged, so not specs) would add DPoP (#38) and Workload Identity
Federation (#40, #42) as Experimental; open issues ask for device code (#18).

### Negotiation: identifier plus empty settings object

From 2026-07-28 on, a client lists the identifiers it supports in
`_meta["io.modelcontextprotocol/clientCapabilities"].extensions` of every
request, and a server lists its own in the `server/discover` result. Both
extensions use `{}` as settings. Extensions are "always disabled by default",
and a side that lacks support must fall back to core behavior or reject if the
extension is mandatory. Older revisions carry the same field in `initialize`.

```csharp
// client: declare   (2.4.0 has IDictionary<string, object>? Extensions on ClientCapabilities)
new McpClientOptions { Capabilities = new() { Extensions = new Dictionary<string, object> {
    ["io.modelcontextprotocol/oauth-client-credentials"] = new object() } } }
```

Measured: a `new Dictionary<string, object>()` value failed to serialize
(`NotSupportedException: Ambiguous matches when resolving JsonTypeInfo`);
`new object()` gives `{}`. The client read the server's list from
`client.ServerCapabilities.Extensions`, the tool the client's from
`server.ClientCapabilities.Extensions`:

```text
server capabilities.extensions = {"io.modelcontextprotocol/oauth-client-credentials":{},"io.modelcontextprotocol/enterprise-managed-authorization":{}}
whoami -> sub=ci-pipeline ... declared-extensions=[io.modelcontextprotocol/oauth-client-credentials]
whoami -> sub=u-alice ... declared-extensions=[]          (client called with no declaration)
```

The SDK declares nothing for you and the server did not refuse the undeclared
call: the declaration is a hint for the peer, the security is the token.

### What changes in the flow, and what does not

Nothing on the resource server. The 401, the PRM and the AS metadata are the
authorization flow lesson's, and the RS validates a JWT with `iss`, `aud` equal
to its URI and `scope` exactly as before. Only the grant at the token endpoint
differs, and who the token's `sub` is. The lab (ports 6600 RS, 6601 AS, 6602
IdP, one .NET project with a role per process) answered the same 401 with
`resource_metadata` and the same PRM (`authorization_servers` = the AS).

### Extension 1: OAuth Client Credentials

The spec text: the client is pre-registered out of band (no DCR). It MUST
authenticate with `private_key_jwt` (RECOMMENDED, RFC 7523 section 2.2) or a
client secret. The AS metadata MUST list `private_key_jwt` or
`client_secret_basic` in `token_endpoint_auth_methods_supported`, and
`token_endpoint_auth_signing_alg_values_supported` for JWT. The request carries
`resource` and `scope`. One inconsistency in the text: the metadata rule names
`client_secret_basic`, but its secret example puts `client_id` and
`client_secret` in the body, which is `client_secret_post`. The lab AS accepted
both. The call, with no SDK involved:

```text
$ curl -s -X POST http://localhost:6601/token -u nightly-job:nightly-secret \
    -d grant_type=client_credentials -d resource=http://localhost:6600/mcp -d scope=mcp:read
{"access_token":"eyJhbGciOiJS...","token_type":"Bearer","expires_in":300,"scope":"mcp:read"}
```

For `private_key_jwt` the client signs an assertion with `iss` and `sub` both the
client id and no `client_id` in the form (RFC 7523 section 3). Its `aud` must be
the AS issuer as the only value: the extension page cites RFC 10070 (November
2026), which forbids the token endpoint URL that RFC 7523 allowed, because of
audience injection. It also asks for `typ: client-authentication+jwt` (SHOULD;
servers should not reject its absence). The client's log, assertion cut short:

```text
--> POST http://localhost:6601/token
    form: grant_type=client_credentials&resource=http://loc...00/mcp&client_assertion_type=urn:ietf:p...bearer&client_assertion=eyJhbGciOi...dB7_dg&scope=mcp:read mcp:write
token: scope="mcp:read mcp:write" expires_in=300 jwt payload={"iss":"http://localhost:6601","client_id":"ci-pipeline","sub":"ci-pipeline","aud":"http://localhost:6600/mcp","scope":"mcp:read mcp:write",...}
```

The token's `sub` is the client id: no person exists. A tool that logs "user"
from `sub` or applies per-user rules is wrong here, so the lab tool decides
`kind=machine` when `sub == client_id`. Scopes still apply: with
`nightly-job` (only `mcp:read`), `write_report` was refused with
`Access forbidden: This tool requires authorization.` (needs
`AddAuthorizationFilters()`, otherwise `InvalidOperationException` at call time).

What the lab AS checks, each case sent for real (my AS, my rules where marked):

| request | answer |
| --- | --- |
| `scope=mcp:read mcp:write` for a client allowed only `mcp:read` | 400 `invalid_scope` |
| no `resource`, or `resource` of another server | 400 `invalid_target` (my rule, RFC 8707) |
| assertion `aud` = token endpoint URL | 401 "aud must be the issuer identifier ... as its sole value" |
| assertion `aud` = `[issuer, token endpoint]` | 401, same message |
| wrong secret, other key, expired, `sub` different from `iss` | 401 `invalid_client` each (`IDX10503`, `IDX10224` for key and expiry) |
| same assertion twice | second 401 "jti ... already used" (my one-use policy) |
| `typ` `JWT` instead of `client-authentication+jwt` | 200 (as the RFC advises, not rejected) |

Keycloak 26.8.2, a client with `client-jwt` authentication and the same key
(`resource` sent, which Keycloak ignores without its resource indicators
feature, off here): `aud` = issuer gave 200; `aud` = the token endpoint URL (the
old RFC 7523 value) still 200; `[issuer, token endpoint]` 400 "Multiple
audiences not allowed"; another issuer 400 "Invalid token audience"; `typ` `JWT`
200; the same assertion again 400 "Token reuse detected"; a secret by Basic
header and by body 200 both.

So Keycloak's default is lenient where RFC 10070 is strict: if your threat model
includes audience injection, check what your AS does with the token endpoint URL.

The C# SDK has no client credentials provider in 2.4.0 (its OAuth provider source
has no `client_credentials` string; the extension page shows providers for
TypeScript and Python). In .NET you POST the form as above and give `HttpClient`
a bearer header. There is no refresh token: ask again before `exp` (300 s here).
On a 403 `insufficient_scope` the core says such clients MAY step up or abort.

### Extension 2: Enterprise-Managed Authorization (ID-JAG)

Cast: the MCP client, the IdP (enterprise SSO, issues the grant), the Resource AS
(redeems it) and the RS. The user signs in to the client through the IdP once and
the client keeps the ID token. For each MCP server it then:

1. Token Exchange (RFC 8693) at the IdP: `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`, `subject_token` = ID token, `audience` = Resource AS issuer, `resource` = MCP URL, `scope`. Policy runs here (group, role, conditional access).
2. Gets an ID-JAG: a JWT with `typ: oauth-id-jag+jwt`, `iss` IdP, `sub` user, `aud` Resource AS issuer, `client_id`, `jti`, `resource`, `scope`.
3. POSTs it to the Resource AS with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion`, plus its own client authentication. Never the authorize endpoint. The access token MUST be restricted to the `resource` of the ID-JAG.

Discovery: a Resource AS advertises `urn:ietf:params:oauth:grant-profile:id-jag`
in `authorization_grant_profiles_supported` and must then also list jwt-bearer in
`grant_types_supported`. The SDK, with my IdP's token endpoint set:

```csharp
var provider = new IdentityAssertionGrantProvider(new IdentityAssertionGrantProviderOptions
{
    ClientId = "chat-client", ClientSecret = "chat-secret", TokenEndpointAuthMethod = "client_secret_basic", // at the Resource AS
    IdpClientId = "chat-client-idp", IdpClientSecret = "idp-secret", IdpTokenEndpoint = "http://localhost:6602/token",
    Scope = "mcp:read mcp:write", IdpScope = "mcp:read mcp:write",
    IdTokenCallback = async (ctx, ct) => await GetIdTokenFromSso(ctx.ResourceUrl, ct),   // your SSO session
}, httpClient);
TokenContainer t = await provider.GetAccessTokenAsync(new Uri("http://localhost:6600/mcp"), new Uri("http://localhost:6601"));
```

The run for alice (engineering group), SDK traffic and the token it produced:

```text
--> GET http://localhost:6601/.well-known/openid-configuration                     (AS metadata, to find token_endpoint)
--> POST http://localhost:6602/token
    form: grant_type=urn:ietf:p...change&requested_token_type=urn:ietf:p...id-jag&subject_token=eyJhbGciOi...f3jU-A&subject_token_type=urn:ietf:p..._token&audience=http://localhost:6601/&resource=http://loc...00/mcp&client_id=chat-client-idp&client_secret=***&scope=mcp:read mcp:write
[idp] -> 200 ID-JAG sub=u-alice aud=http://localhost:6601/ client_id=chat-client scope="mcp:read" (requested "mcp:read mcp:write")
--> POST http://localhost:6601/token [Authorization: Basic Y2hhdC1jbG...NyZXQ=]
    form: grant_type=urn:ietf:p...bearer&assertion=eyJhbGciOi...JLyxdQ&scope=mcp:read mcp:write
access token: scope="mcp:read" payload={"iss":"http://localhost:6601/","client_id":"chat-client","sub":"u-alice","aud":"http://localhost:6600/mcp","scope":"mcp:read","email":"alice@acme.example",...}
whoami -> sub=u-alice client_id=chat-client scope="mcp:read" email=alice@acme.example kind=user declared-extensions=[io.modelcontextprotocol/enterprise-managed-authorization]
write_report -> McpProtocolException: ... Access forbidden: This tool requires authorization.
```

The IdP granted a subset of the scope (engineering has only read), the AS kept
it and the RS enforced it, with no browser. Findings about the SDK:

- **`audience` is `Uri.ToString()` of the AS URL**: I gave `http://localhost:6601`, it sent `http://localhost:6601/`, and my IdP (exact match on the issuer, as the draft says) answered `invalid_target`. Pass the URL exactly as the issuer, with the slash if the issuer has one.
- **`resource` is mandatory in the SDK** (`Throw.IfNullOrWhiteSpace`), although the extension says OPTIONAL: an IdP that wants to omit it cannot be served.
- **Discovery tries `/.well-known/openid-configuration`, then `oauth-authorization-server`, appended to the issuer** (no RFC 8414 path insertion); `IdpUrl` in place of `IdpTokenEndpoint` worked the same way.
- **No issuer check on the AS metadata**: with the AS serving `"issuer":"https://honest.example/"` the SDK took its `token_endpoint` and completed the exchange. Draft 06 (section 9.5) makes that validation a MUST; draft 04, which the extension text links, has no such section. My hand-written discovery did check it and failed with `AS metadata issuer mismatch`.
- It always sends `subject_token_type=...:id_token` (no SAML assertion or refresh token, which the spec also allows) and rejects an IdP answer whose `token_type` is not `N_A`. The result is cached behind one lock; call `InvalidateCache()` after a 401.

What each side refuses, sent with curl (the rules are the draft's processing
rules as I implemented them: what the text asks, not what a product does):

| request | answer |
| --- | --- |
| IdP: bob, group without a policy for this AS | 403 `access_denied` |
| IdP: audience without the trailing slash, unknown, or `resource` not governed by it | 400 `invalid_target` |
| IdP: scope the group cannot have | 400 `invalid_scope` |
| IdP: subject token is an access token or an ID-JAG | 400 `invalid_request` "not an identity assertion" |
| IdP: ID token issued to another client | 400 `invalid_request` (audience must be the authenticated client) |
| AS: ID-JAG redeemed twice | 400 `invalid_grant` "ID-JAG already used" |
| AS: redeemed by another client than the `client_id` claim, or an ID token as `assertion` | 400 `invalid_grant` |
| AS: carol, valid ID-JAG, no licence | 400 `access_denied` (through the SDK: `IdentityAssertionGrantException ... error=access_denied`) |
| RS: the ID-JAG used as a bearer token | 401 (`IDX10205: Issuer validation failed`) |

Draft 06 made `resource` RECOMMENDED (04: OPTIONAL) and lets an AS skip client
authentication only for a sender-constrained ID-JAG (`cnf`: DPoP or mTLS). That
binding, SAML subjects, refresh-token subjects and RAR were read, not run.

### Who supports what

| piece | state |
| --- | --- |
| C# SDK 2.4.0 | ID-JAG client: `IdentityAssertionGrantProvider` (measured). Client credentials: none (TypeScript and Python have providers, docs only). Server side of either: only the `Extensions` dictionary |
| Keycloak 26.8.2 | ID-JAG accepting side only, behind `--features=identity-assertion-jwt` (Experimental), guide for draft 01, issuing side "TBD". With the flag on, the realm metadata still had no `authorization_grant_profiles_supported`. Client credentials: measured above |
| Other products | the extension page lists Okta, Ping, Descope, Janssen, Athenz, ThunderID and others, with "Available", "Early access" or "Experimental" per role (docs only, not run). Entra ID and OpenIddict: not listed, not documented for ID-JAG here |
| Clients | the MCP site keeps a support matrix; my text-only fetch showed no readable marks for the auth columns, so I claim nothing about any client |

### When to adopt

| extension | problem | state | support | adopt when |
| --- | --- | --- | --- | --- |
| Client Credentials | no user: pipeline, daemon, service to service | Stable | AS: standard grant; C# client: write it (10 lines); TS and Python: provider | the caller is a workload and you can pre-register it and rotate its key |
| Enterprise-Managed Authorization | IT, not each employee, approves client and server pairs; no consent prompts | Stable spec on an IETF draft (06 at 2026-10-31, vendors on 01 to 04) | IdP and AS both must speak it; C# client yes; Keycloak accept-only, experimental | the company runs an IdP that issues ID-JAGs and every MCP server's AS accepts them |

Book vs today: guides for the 2025 specs show only authorization code with PKCE
and DCR; machine and enterprise flows are extensions now, so skip home-made
"service token" conventions.

## Trade-offs

- **Stable spec, moving draft underneath.** The extension is fixed per core revision, but the ID-JAG draft moved from 04 to 06 and gained MUSTs (metadata validation) the extension text does not link. Pin a draft revision in your AS and client and test both sides together.
- **A workload identity is a person-less `sub`.** Every per-user rule, audit line and quota must handle `sub == client_id`.
- **Secrets vs keys.** A leaked client secret works silently until rotated; `private_key_jwt` needs key storage and a strict AS (Keycloak still accepted the old `aud`).
- **Central policy needs central trust.** The IdP decides before the token exists and never sees the MCP traffic; the Resource AS trusts its issuer, key and `sub`, so a wrong trust entry opens the whole organization.
- **Declared extensions are not enforcement.** Enforce on the token, grant and scope.

## Documentation Links

- [Authorization, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (doc)
- [MCP Authorization Extensions repository, GitHub](https://github.com/modelcontextprotocol/ext-auth) (doc)
- [OAuth Client Credentials extension, 2026-07-28 revision, GitHub](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/stable/oauth-client-credentials/2026-07-28/oauth-client-credentials.mdx) (doc)
- [Enterprise-Managed Authorization extension, 2026-07-28 revision, GitHub](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/stable/enterprise-managed-authorization/2026-07-28/enterprise-managed-authorization.mdx) (doc)
- [Extensions Overview and negotiation, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/overview) (doc)
- [Enterprise-Managed Authorization and implementation support, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) (doc)
- [SEP-3392: Extension Lifecycle, modelcontextprotocol.io](https://modelcontextprotocol.io/seps/3392-extension-lifecycle) (doc)
- [Identity Assertion JWT Authorization Grant, IETF draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/) (doc)
- [RFC 10070: Updates to OAuth 2.0 JWT Client Authentication and Assertion-Based Authorization Grants, RFC Editor](https://www.rfc-editor.org/rfc/rfc10070.html) (doc)
- [IdentityAssertionGrantProvider.cs at v2.4.0, MCP C# SDK on GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/src/ModelContextProtocol.Core/Authentication/IdentityAssertionGrantProvider.cs) (doc)
- [Identity Assertion JWT Authorization Grant, Keycloak](https://www.keycloak.org/securing-apps/identity-assertion-jwt-authorization-grant) (doc)
