---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A protected MCP server is only a resource server: it validates tokens another
authorization server (AS) issued, and its Protected Resource Metadata names it.
This lesson measures what the 2026-07-28 spec needs from that AS (discovery,
advertised PKCE S256, `resource` and a matching `aud`, `iss` in the response,
CIMD or DCR) on Keycloak in Docker, OpenIddict embedded in ASP.NET Core and
Microsoft Entra ID (public metadata measured, the rest docs only), then gives a
decision table and a recommendation per scenario. No model.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`),
`OpenIddict.AspNetCore` and `OpenIddict.EntityFrameworkCore` 7.9.0,
`Microsoft.EntityFrameworkCore.InMemory` 10.0.0, `ModelContextProtocol` and
`ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.AspNetCore.Authentication.JwtBearer`
10.0.15, TFM `net10.0`, SDK 10.0.100, spec revision 2026-07-28.

## Use Cases

- Picking the AS for a new remote MCP server, or checking whether the one the company already runs is enough.
- Explaining why an MCP client refuses to log in against Entra ID before any login page appears.
- Configuring Keycloak or OpenIddict so tokens carry the MCP server URL as audience.
- Deciding when a gateway in front of a legacy identity provider is the only way out.

## Deep Dive

### What the spec asks of the AS

The MCP server never issues tokens; it publishes `authorization_servers` in its
PRM (RFC 9728) and validates. The AS has to provide (2026-07-28):

| requirement | level | why the client cares |
| --- | --- | --- |
| RFC 8414 or OIDC Discovery | MUST (one of them) | the client tries both |
| `code_challenge_methods_supported` in metadata | MUST for OIDC providers | if absent, clients MUST refuse to proceed |
| `resource` (RFC 8707) | clients MUST send it in authorize and token | the server checks `aud` against its own URI |
| `iss` in the authorization response (RFC 9207) | SHOULD | mix-up defense, checked before the token exchange |
| Client ID Metadata Documents | SHOULD | a client with no prior registration |
| Dynamic Client Registration (RFC 7591) | MAY, deprecated | legacy fallback |

The lab reuses the protected MCP server and SDK client of the authorization flow
lesson (port 6222, AS issuer from an environment variable); an `HttpClient` with
a cookie jar plays the browser as user `alice`. Each AS was also probed with curl.

### Keycloak 26.8.2: everything exists, two pieces behind flags

The realm metadata, default start (`start-dev`, no features):

```text
GET /realms/mcp/.well-known/openid-configuration                 -> 200
GET /.well-known/oauth-authorization-server/realms/mcp           -> 200 (RFC 8414 path insertion)
registration_endpoint = "http://localhost:6220/realms/mcp/clients-registrations/openid-connect"
code_challenge_methods_supported = ["plain", "S256"]
authorization_response_iss_parameter_supported = true
client_id_metadata_document_supported = <absent>
```

Without flags `resource` is ignored, and audience comes from an Audience mapper
on the client scope `mcp:tools` (Included Custom Audience = the MCP URL):

| request (public client `mcp-client`) | access token `aud` |
| --- | --- |
| `scope=openid`, no `resource` | `"account"` |
| `scope=openid`, `resource=http://localhost:6222/mcp` | `"account"` (ignored) |
| `scope=openid mcp:tools`, no `resource` | `["http://localhost:6222/mcp","account"]` |
| `scope=openid mcp:tools`, `resource=http://localhost:6299/other` | `["http://localhost:6222/mcp","account"]` |

The last row is the risk: a token for another resource was not refused, the
scope decided the audience. Restarted with `--features=cimd,resource-indicators`
(the log says `Experimental features enabled: cimd:v1, resource-indicators:v1`),
a client `mcp-server` with the attribute `resource_url=http://localhost:6222/mcp`
and an Audience mapper on `mcp-client` pointing to it:

| authorize `resource` / token `resource` | result |
| --- | --- |
| `.../6222/mcp` / same | `aud="http://localhost:6222/mcp"` |
| `.../6299/other` / same | code issued, token: `invalid_target` "The requested resource is invalid, missing, unknown, or malformed." |
| `.../6222/mcp` / `.../6299/other` | `invalid_target` "The requested resource is not matching the original request." |
| none / none | `aud=["mcp-server","account"]` (the client id, not the URL) |

With the flag the metadata gained `client_id_metadata_document_supported: true`.
CIMD needs a client policy: a profile with the `client-id-metadata-document`
executor (options `cimd-allow-http-scheme` for the lab,
`cimd-allow-permitted-domains`, `cimd-resource-indicator-allow-list`) and a
policy with the `client-id-uri` condition. A document served on the host as
`http://host.docker.internal:6224/oauth/client.json`:

- with only `host.docker.internal` trusted: `Invalid Client ID: domain not allowed.`, log `not trusted domain: host = localhost`; the redirect URI host is checked too.
- with `localhost` added: consent screen, then `aud="http://localhost:6222/mcp"`, `azp` = the document URL. Without `resource` the `aud` was the same (the allow list); with `.../6299/other` the authorize answered 400, log `resource parameter not allowed`.
- the fetched client was saved as an ordinary realm client (visible in the admin API), and three flows in a row left one GET in the document host log.

DCR works, behind anonymous registration policies. The body the SDK sends
(previous lesson) went through three answers:

```text
403 {"error":"insufficient_scope","error_description":"Policy 'Trusted Hosts' rejected request to client-registration service. Details: Host not trusted."}
403 ... "Policy 'Allowed Client Scopes' rejected request ... Not permitted to use specified clientScope"
201 {"client_id":"1c62772b-d37a-...","token_endpoint_auth_method":"none","scope":"mcp:tools",...}
```

The first needed the caller's IP (the Docker gateway, `192.168.65.1`) in Trusted
Hosts, the second `mcp:tools` in Allowed Client Scopes; `application_type` was
not echoed, and "Consent Required" showed a consent screen. End to end, the SDK
with the pre-registered public client found `/.well-known/oauth-authorization-server/realms/mcp`,
sent `resource=http://localhost:6222/mcp&client_id=mcp-client&client_secret=`
(empty, accepted) and got `whoami -> ... iss=http://localhost:6220/realms/mcp scope=profile mcp:tools offline_access email`.

### OpenIddict 7.9.0: an AS inside your app

```csharp
builder.Services.AddOpenIddict()
    .AddCore(o => o.UseEntityFrameworkCore().UseDbContext<DbContext>())
    .AddServer(o =>
    {
        o.SetIssuer("http://localhost:6221/");
        o.SetAuthorizationEndpointUris("connect/authorize").SetTokenEndpointUris("connect/token");
        o.AllowAuthorizationCodeFlow().AllowRefreshTokenFlow().RequireProofKeyForCodeExchange();
        o.RegisterScopes("mcp:tools");
        o.RegisterResources("http://localhost:6222/mcp");   // 7.x: unknown resource -> invalid_target
        o.AddEphemeralEncryptionKey().AddEphemeralSigningKey();
        o.DisableAccessTokenEncryption();                    // a JWT that plain JwtBearer can read
        o.UseAspNetCore().EnableAuthorizationEndpointPassthrough().DisableTransportSecurityRequirement();
    });
// client "mcp-client": public, PKCE required, endpoint and grant permissions, plus
// Permissions.Prefixes.Scope + "mcp:tools" and Permissions.Prefixes.Resource + the MCP URL.
// Passthrough /connect/authorize (lab: signs alice in, no login page):
id.SetScopes(req.GetScopes());
id.SetResources(req.GetResources());   // resource -> aud
```

Both well-known URIs answered 200 with the same document: `issuer`
`http://localhost:6221/`, `code_challenge_methods_supported: ["plain","S256"]`,
`authorization_response_iss_parameter_supported: true`, and neither
`registration_endpoint` nor `client_id_metadata_document_supported`. The first
SDK run stopped at the authorize step:

```text
[browser] GET .../connect/authorize?client_id=mcp-client&...&resource=http%3a%2f%2flocalhost%3a6222%2fmcp&scope=mcp%3atools+offline_access
[browser] 400 error:invalid_request
error_description:The client application is not allowed to use the 'offline_access' scope.
```

The SDK added `offline_access` because the metadata lists it; the client needs
the `refresh_token` grant permission. After that the run completed, with the
code redirect carrying `iss=http%3A%2F%2Flocalhost%3A6221%2F` and the token
payload `"aud":"http://localhost:6222/mcp","client_id":"mcp-client","scope":"mcp:tools offline_access"`.
`client_secret=` (empty) was accepted for the public client. Probes with curl:

| authorize `resource` / token `resource` | result |
| --- | --- |
| `.../6222/mcp` / same | `aud="http://localhost:6222/mcp"`, server log `valid token` |
| `.../6299/other` / not reached | 400 at authorize, `invalid_target` (ID2190), no redirect |
| none / none | token without `aud`, server log `IDX10206: Unable to validate audience`, 401 |
| `.../6222/mcp` / `.../6299/other` | `invalid_target` |
| `.../6222/mcp` / none | `invalid_target` |

OpenIddict validates `resource` against registered resources and per-client
permissions, but writing it into the token is your code (`SetResources`). DCR
and CIMD are not there: issues #2404 (DCR) and #2552 (CIMD) are open, and the
maintainer called CIMD too early to implement (docs only).

### Microsoft Entra ID: metadata measured, the rest docs only

No tenant here, but discovery is public. The SDK, with a PRM pointing at
`https://login.microsoftonline.com/{tenant}/v2.0`:

```text
--> GET https://login.microsoftonline.com/.well-known/oauth-authorization-server/{tenant}/v2.0   <-- 404
--> GET https://login.microsoftonline.com/.well-known/openid-configuration/{tenant}/v2.0         <-- 404
--> GET https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration         <-- 200
McpException: ... Authorization server metadata from '.../v2.0/.well-known/openid-configuration' does not include 'code_challenge_methods_supported'. MCP clients require PKCE support and must refuse to proceed.
```

The v2.0 document also has no `registration_endpoint`, no
`authorization_response_iss_parameter_supported` and no
`client_id_metadata_document_supported`. The auth code flow doc accepts
`code_challenge_method=S256` in the request: Entra does PKCE but does not
advertise it, and a compliant client stops before the login page. From the docs:

- `aud`: "In v2.0 tokens, this value is always the client ID of the API. In v1.0 tokens, it can be the client ID or the resource URI used in the request." `requestedAccessTokenVersion` null means v1.0 tokens.
- `scope={resource-identifier}/.default` "is functionally the same as `resource={resource-identifier}` on the v1.0 endpoint"; scopes in one request "must all be from a single resource", and a scope without resource prefix means Microsoft Graph.
- the RFC 8707 `resource` parameter on the v2.0 endpoint: not documented (the request tables do not list it).
- DCR: "Microsoft Entra ID doesn't publish an RFC 7591 registration endpoint" (Microsoft 365 Copilot docs). CIMD: not documented.
- the authorization response is documented with `code` and `state`; `iss` there: not documented.

For the MCP server this means: validate `aud` against the API's client ID (or
both client ID and App ID URI while v1.0 tokens exist), not against the MCP URL
the client sends as `resource`; publish full scopes such as
`api://{client-id}/mcp.tools` in `scopes_supported`; and pre-register every
client. Even then a spec-compliant client refuses the metadata.

### Decision table

(m) measured here, (d) vendor docs or issue tracker.

| requirement | Keycloak 26.8.2 | OpenIddict 7.9.0 | Entra ID (v2.0) |
| --- | --- | --- | --- |
| RFC 8414 / OIDC discovery | supports, both (m) | supports, both (m) | partial: OIDC only, RFC 8414 404 (m) |
| PKCE S256 advertised | supports (m) | supports (m) | no: field absent, SDK refuses (m); S256 accepted in requests (d) |
| `resource` and `aud` | partial: experimental flag, ignored without it (m) | supports: registered resources + `SetResources` (m) | docs only: not documented on v2.0; v2.0 `aud` = API client ID (d) |
| `iss` in response (RFC 9207) | supports (m) | supports (m) | no: not advertised (m), not documented (d) |
| CIMD | partial: experimental flag + client policy (m) | no (m, issue #2552) | no: not advertised (m), not documented (d) |
| DCR | supports, anonymous behind policies (m) | no (m, issue #2404) | no (m; d) |

### An MCP server in front of a legacy AS

When the identity provider is fixed (Entra, an old Keycloak, an in-house SSO),
the PRM does not have to name it. The pattern (cited, not built here): the PRM
lists an AS or authorization gateway that speaks MCP (RFC 8414 metadata with
S256, `iss`, CIMD or DCR, `resource` into `aud`) and federates the login to the
legacy provider; the MCP server trusts only that gateway's issuer. Keycloak can
play that role brokering Entra as an identity provider. Shortcuts seen in the
wild, such as a fake `/register` that hands every client the same static Entra
client ID, make all clients one client. A gateway policy that forwards the
incoming `Authorization` header to the backend (an example in the API
Management MCP docs) is token passthrough, which the MCP spec forbids.

### Recommendation per scenario

| scenario | choice |
| --- | --- |
| Company standardized on Entra ID | Entra stays the identity source; put a compliant AS or gateway in the PRM (Keycloak brokering Entra, or a managed gateway) until Entra advertises PKCE and accepts the MCP flow; pre-register clients |
| Self-hosted, known clients | OpenIddict inside the .NET app (pre-registration, real `resource` checks), or Keycloak if you want an admin console |
| SaaS product open to any MCP client | needs CIMD (DCR as fallback): Keycloak with the `cimd` and `resource-indicators` flags, accepting "experimental", or a vendor AS that supports CIMD |

Book vs today: guides for spec 2025-03-26 have the MCP server serve `/authorize`,
`/token` and `/register` itself; since 2025-06-18 it is only a resource server.

## Trade-offs

- **Experimental flags vs spec compliance.** Keycloak meets the 2026-07-28 list
  only with `cimd` and `resource-indicators`, which its docs call experimental.
- **Scope-based audience is a weaker check.** Without the flag, a token asked
  for `.../6299/other` still got the MCP audience, because the mapper hangs on
  the scope.
- **Embedded AS vs product.** OpenIddict gives exact control and no extra
  container, but login, consent, key storage and any DCR or CIMD are your code.
- **Entra's identity vs its metadata.** Users and Conditional Access live in
  Entra, but the v2.0 metadata stops compliant clients; a gateway adds a hop and
  one more issuer to trust.
- **Defaults that leak scope.** The SDK asked for `offline_access` when listed,
  and Keycloak added `profile` and `email`: decide which scopes the AS advertises.

## Documentation Links

- [Authorization, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (doc)
- [Authorization Security Considerations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (doc)
- [Client Registration, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) (doc)
- [Integrating with Model Context Protocol (MCP), Keycloak](https://www.keycloak.org/securing-apps/mcp-authz-server) (doc)
- [Client registration service, Keycloak](https://www.keycloak.org/securing-apps/client-registration) (doc)
- [Migrate from OpenIddict 6.0 to 7.0, OpenIddict documentation](https://documentation.openiddict.com/guides/migration/60-to-70) (doc)
- [Implement CIMD, issue #2552, OpenIddict on GitHub](https://github.com/openiddict/openiddict-core/issues/2552) (doc)
- [Access token claims reference, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference) (doc)
- [Scopes and permissions in the Microsoft identity platform, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc) (doc)
- [OAuth 2.0 authorization code flow, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) (doc)
- [Configure dynamic client registration, Microsoft Learn](https://learn.microsoft.com/en-us/plugins/plugin-authentication-dynamic-client-registration) (doc)
- [Secure access to MCP servers in Azure API Management, Microsoft Learn](https://learn.microsoft.com/en-us/azure/api-management/secure-mcp-servers) (doc)
