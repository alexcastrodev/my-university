---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Before an MCP client can run the authorization flow it needs a `client_id`
that the authorization server (AS) accepts. The 2026-07-28 spec lists three
ways, in order of preference: pre-registration, Client ID Metadata Documents
(CIMD, the `client_id` is an HTTPS URL to a JSON document the AS fetches) and
Dynamic Client Registration (RFC 7591, now deprecated, with `application_type`
mandatory). This lesson runs all three with the C# SDK on localhost, measures
which one the SDK picks, what happens when the AS changes, and what an AS has to
check before fetching a URL the client chose. No model.
Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, TFM `net10.0`,
SDK 10.0.100, spec revision 2026-07-28, CIMD draft `-00`.

## Use Cases

- Shipping a desktop app or CLI that talks to MCP servers it has never seen, with no registration step for the user.
- Deciding whether an AS you run should accept CIMD, keep DCR, or only take pre-registered clients.
- Debugging a client that registers again on every run, or fails after the server moved to another AS.
- Reviewing the SSRF exposure of an AS that fetches client metadata documents.

## Deep Dive

### The lab and the order of preference

Four processes on localhost: the protected MCP server (6100, a `whoami` tool
that echoes `iss` and `client_id`), the AS (6101, plus a copy on 6104), a host
for the client's metadata documents (`https://localhost:6102`) and the client
(redirect URI `http://localhost:6103/callback`, read from the 302 by an
`HttpClient` playing the browser). The AS is a copy of the SDK's
`TestOAuthServer` (tag v2.4.0), which advertises
`client_id_metadata_document_supported` but never fetches anything (it
pre-registers one CIMD URL as an ordinary client). The copy got a real resolver
(fetch, validate, cache, SSRF guard) and switches for CIMD, DCR and an
OIDC-style `application_type` rule. The rest of the flow (401, PRM, PKCE,
`resource`, `iss`) is the previous lesson's. The spec's order of preference:
pre-registered information for that AS first; then CIMD, if the AS metadata
has `client_id_metadata_document_supported: true`; then DCR, if it has a
`registration_endpoint`; otherwise ask the user. All three live in
`ClientOAuthOptions`:

```csharp
var oauth = new ClientOAuthOptions
{
    RedirectUri = new Uri("http://localhost:6103/callback"),
    AuthorizationCallbackHandler = OpenBrowserAndWaitForCode,
    ClientId = "demo-client", ClientSecret = "demo-secret",                       // 1. pre-registration
    ClientMetadataDocumentUri = new Uri("https://localhost:6102/oauth/client.json"), // 2. CIMD
    DynamicClientRegistration = new() { ClientName = "Lab MCP Client" },          // 3. DCR (deprecated)
};
var transport = new HttpClientTransport(new() { Endpoint = new("http://localhost:6100/mcp"), OAuth = oauth }, http);
```

### Path 1: pre-registration

The client was created at the AS beforehand (portal, IaC). With only
`ClientId`/`ClientSecret`, the token request carried
`client_id=demo-client&client_secret=demo-secret`, nothing registered or
fetched. The only path with an AS that has neither CIMD nor DCR.

### Path 2: Client ID Metadata Documents

The client publishes JSON at a stable HTTPS URL, and that URL is the
`client_id`. The spec requires `client_id`, `client_name` and `redirect_uris`,
with the inner `client_id` equal to the URL by simple string comparison. The
draft forbids secret-based auth methods and `client_secret`: a CIMD client is
public (`none`) or uses `private_key_jwt` with a `jwks_uri` (docs only).

```json
{"client_id":"https://localhost:6102/oauth/client.json","client_name":"Lab MCP Client",
 "client_uri":"https://localhost:6102","redirect_uris":["http://localhost:6103/callback","http://127.0.0.1:6103/callback"],
 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}
```

With `ClientMetadataDocumentUri` and `DynamicClientRegistration` both set, no
`/register` was sent; the `[as]` lines are the AS log (one fetch, then the cache):

```text
--> GET https://localhost:6101/.well-known/oauth-authorization-server
    registration_endpoint="https://localhost:6101/register" client_id_metadata_document_supported=true token_endpoint_auth_methods_supported=["client_secret_post","none"]
--> GET https://localhost:6101/authorize?client_id=https://localhost:6102/oauth/client.json&redirect_uri=http://localhost:6103/callback&response_type=code&...
<-- 302 Location: http://localhost:6103/callback?code=YhpS8B4R...&state=Cu0AbmsC...
--> POST https://localhost:6101/token
    form: grant_type=authorization_code&code=YhpS8B4R...&...&client_id=https://localhost:6102/oauth/client.json&client_secret=
whoami -> iss=https://localhost:6101 client_id=https://localhost:6102/oauth/client.json

[as] CIMD fetch https://localhost:6102/oauth/client.json
[as] CIMD ok client_name='Lab MCP Client' redirect_uris=http://localhost:6103/callback,http://127.0.0.1:6103/callback cache=00:05:00
[as] CIMD cache hit https://localhost:6102/oauth/client.json (expires 00:40:19)
```

The SDK only checks that the URL is HTTPS with a non-root path (read in the
source). Hosting the document is your job: a static file on the product's site.

### Path 3: Dynamic Client Registration (deprecated)

With no `ClientId` and no CIMD support, the SDK posts to the `registration_endpoint`:

```text
--> POST https://localhost:6101/register
    body: {"redirect_uris":["http://localhost:6103/callback"],"token_endpoint_auth_method":"client_secret_post","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"client_name":"Lab MCP Client","scope":"mcp:tools","application_type":"native"}
<-- 200
    {"client_id":"dyn-9105...","client_secret":"8B3PFdwH...","redirect_uris":["http://localhost:6103/callback"],"client_id_issued_at":1795048505,"token_endpoint_auth_method":"client_secret_post",...}
    ResponseDelegate: client_id=dyn-9105b94d2fd743909b762342a497f5b2 (persist it, keyed by issuer)
```

Each new process registered again (`dyn-9105...`, `dyn-3f3b...`): the result
lives in memory, so persist it (`ResponseDelegate`, durable `TokenCache`) or the
AS fills with orphan clients. `application_type` is sent since SDK 2.0.0, inferred
from `RedirectUri` when `ApplicationType` is null. Against an AS rule from OIDC
Registration 1.0 (web clients may not use loopback redirects):

| redirect URI | `ApplicationType` | sent | result |
| --- | --- | --- | --- |
| `http://localhost:6103/callback` | null | `native` | registered, `whoami` answered |
| `https://app.example.com/callback` | null | `web` | registered, `whoami` answered |
| `http://localhost:6103/callback` | `"web"` | `web` | 400, below |

```text
McpException: Failed to handle unauthorized response with 'Bearer' scheme. Dynamic client registration failed with status BadRequest: {"error":"invalid_redirect_uri","error_description":"application_type web must not use a loopback redirect_uri"} (application_type: 'web', redirect_uri: 'http://localhost:6103/callback').
```

The message carries both values, as the spec asks clients to surface.

### Which path the SDK actually picks

| client configures | AS metadata | SDK did |
| --- | --- | --- |
| ClientId + CIMD URI + DCR | CIMD and DCR | `client_id=demo-client`, no fetch, no `/register` |
| CIMD URI + DCR | CIMD and DCR | CIMD URL, no `/register` |
| CIMD URI + DCR | DCR only | `POST /register` |
| CIMD URI only | DCR only | `POST /register` anyway (no `client_name`) |
| CIMD URI + DCR | neither | `Authorization server does not support dynamic client registration` |

Pre-registration beats CIMD, CIMD beats DCR, as the spec says. But DCR is not
opt-in (a null `DynamicClientRegistration` still registers), and there is no
"ask the user" step: the SDK throws, and your app must catch it and offer a
client ID field.

### The token endpoint auth method comes from the AS list

`ClientOAuthOptions` has no auth method property. DCR takes it from the
registration response; pre-registered and CIMD clients get the **first** entry
of `token_endpoint_auth_methods_supported`. Two orders of that list:

| AS list | pre-registered | CIMD | DCR |
| --- | --- | --- | --- |
| `["client_secret_post","none"]` | secret sent, works | sends `client_secret=` (empty), works here | works |
| `["none","client_secret_post"]` | secret dropped, `401 Invalid client credentials` | no secret, works | works |

A strict AS may reject the empty secret of a public CIMD client, and a
confidential pre-registered client breaks when the AS lists `none` first.

### Credentials belong to one issuer

SEP-2352: persisted credentials are keyed by the AS `issuer`, never reused with
another AS; a change means registering again. The lab moved the MCP server to
the AS on 6104 mid-session (PRM lists only 6104, tokens from 6101 refused) and
called `whoami` again on the same transport:

| path | after the switch |
| --- | --- |
| pre-registered | `The authorization server changed from 'https://localhost:6101' to 'https://localhost:6104', but explicitly configured client credentials cannot be assumed to be valid for the new authorization server.` |
| DCR | `POST https://localhost:6104/register`, new `dyn-f468...`, `whoami -> iss=https://localhost:6104` |
| CIMD | same URL sent to 6104, which fetched the document; `whoami -> iss=https://localhost:6104` |

No run tried a refresh token at the new AS. CIMD is portable: every AS
resolves the URL itself.

### What the AS must check before trusting a URL

CIMD makes the AS an HTTP client of an address chosen by whoever starts the
flow. The core of the lab resolver:

```csharp
static readonly HttpClient cimdHttp = new(new SocketsHttpHandler
{
    AllowAutoRedirect = false,                         // a 3xx is an error, not a hop
    ConnectCallback = async (ctx, ct) =>               // check the IP actually dialed (DNS rebinding)
    {
        var allowed = allowList.Contains($"{ctx.DnsEndPoint.Host}:{ctx.DnsEndPoint.Port}");
        foreach (var ip in await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct))
            if (allowed || !IsPrivate(ip)) { /* connect to ip, return the NetworkStream */ }
        throw new HttpRequestException($"SSRF policy: {ctx.DnsEndPoint.Host} has no public address and is not allow-listed");
    },
}) { Timeout = TimeSpan.FromSeconds(2) };
```

Then it reads at most 5 KB (the draft's figure), requires `client_id`,
`client_name` and `redirect_uris`, compares `client_id` to the URL, refuses
secret-based methods and caches by `Cache-Control: max-age`, capped at 24 h.
`IsPrivate` covers loopback, 10/8, 172.16/12, 192.168/16, 169.254/16,
100.64/10 and IPv6 link-local and unique local; only `localhost:6102` is
allow-listed. Probes sent straight to `/authorize`:

| `client_id` | AS log | response |
| --- | --- | --- |
| `.../mismatch.json` (inner id is `.../client.json`) | `client_id in document '.../client.json' does not match the URL` | 400 `invalid_client` |
| `.../redirect.json` (302 to a valid doc) | `metadata document answered 302, redirects are not followed` | 400 |
| `.../big.json` (6 KB) | `metadata document exceeds 5120 bytes` | 400 |
| `.../slow.json` (answers after 5 s) | `TaskCanceledException ... HttpClient.Timeout of 2 seconds` | 400 |
| `.../secret.json` (`client_secret_post`) | `needs a shared secret, not allowed for CIMD` | 400 |
| `https://169.254.169.254/latest/meta-data/` (and `https://127.0.0.1:6102/...`) | `SSRF policy: 169.254.169.254 has no public address and is not allow-listed` | 400 |
| `https://localhost:6102/` (root path) | `client_id URL is not a valid CIMD identifier` | 400 |
| valid doc, `redirect_uri=http://localhost:9999/cb` | fetched and cached | 400 `Unregistered redirect_uri` |

Errors come back as a 400 body, never as a redirect: until the document is
validated the `redirect_uri` is not trusted. After the first fetch of
`client.json` (`max-age=300`) the next two requests were cache hits and the doc
host saw one GET; two requests for `nocache.json` (no header) gave two GETs. The
draft forbids caching errors and invalid documents.

What a fetch cannot prove (docs only): anyone can publish a document listing
`http://localhost:3000/callback`, so a malicious local app can claim a known
client's identity for loopback redirects. The spec says the AS SHOULD warn about localhost-only redirect URIs,
MUST display the redirect URI hostname and MAY require attestation; the draft
adds domain trust policies (allow-lists, warnings for new domains, the
`client_id` hostname on the consent screen). The lab AS has no consent screen.

### When to use which

| scenario | use | why |
| --- | --- | --- |
| Desktop app or CLI talking to any MCP server | CIMD, DCR as fallback | one URL works with every AS that supports CIMD; nothing per user |
| SaaS web app with a backend | CIMD with `private_key_jwt`, or pre-registration per partner | a confidential client needs keys or a secret the AS knows |
| Company AS (Entra ID, Okta, Keycloak) | pre-registration | admins approve each app; CIMD and DCR are usually off |
| Old AS that only has DCR | DCR, persisting the result by issuer | the only automatic option, deprecated in 2026-07-28 |

Book vs today: MCP guides written for specs 2025-03-26 and 2025-06-18 present
DCR as the way to get a `client_id`. CIMD arrived in 2025-11-25 (SEP-991) and
2026-07-28 deprecated DCR, so new clients should start from CIMD.

## Trade-offs

- **CIMD vs DCR.** CIMD keeps no state at the AS and survives an AS change; DCR
  creates a client per install (per run here, unless persisted). CIMD costs a
  stable HTTPS host and an AS willing to fetch it.
- **Fetching is an attack surface.** Check the dialed IP, refuse redirects, cap
  size and time; only the IP check stopped a `client_id` aimed at `169.254.169.254`.
- **Cache vs freshness.** A long `max-age` saves fetches but delays revoking a
  redirect URI or rotating `jwks_uri`; cap the lifetime on the AS side.
- **SDK gaps.** No auth method option and no "ask the user" step: wrap the
  exception and check the AS metadata order against your client type.

## Documentation Links

- [Client Registration, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) (doc)
- [Authorization Security Considerations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (doc)
- [Key Changes, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [OAuth Client ID Metadata Document, draft-ietf-oauth-client-id-metadata-document-00, IETF](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00) (doc)
- [RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc7591) (doc)
- [OpenID Connect Dynamic Client Registration 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-registration-1_0.html) (doc)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security, RFC Editor](https://www.rfc-editor.org/rfc/rfc9700.html) (doc)
- [ClientOAuthOptions.cs at v2.4.0, MCP C# SDK on GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/src/ModelContextProtocol.Core/Authentication/ClientOAuthOptions.cs) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [HttpClient guidelines for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines) (doc)
