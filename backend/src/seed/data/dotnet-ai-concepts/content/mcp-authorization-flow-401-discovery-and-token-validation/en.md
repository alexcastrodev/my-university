---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A remote MCP server protected by OAuth is a plain resource server: it answers 401
with a pointer to its metadata, the client finds the authorization server on its
own, runs authorization code with PKCE and `resource`, and comes back with a
token whose audience is that server alone. This lesson runs the flow on
localhost with the C# SDK and logs every request: 401, Protected Resource
Metadata (RFC 9728), AS discovery (RFC 8414 and OIDC), PKCE S256, audience and
scope checks (401 against 403) and the client's `iss` check (RFC 9207). No model.
Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2),
TFM `net10.0`, SDK 10.0.100, spec revision 2026-07-28.

## Use Cases

- Putting a remote MCP server built on ASP.NET Core behind an OAuth authorization server.
- Debugging a client that loops on 401 or dies during discovery, from the wire log.
- Checking that a server rejects tokens issued for another API (audience) or with too few scopes.
- Explaining to a security review what each hop of the flow carries and who checks it.

## Deep Dive

### The lab: three processes on localhost

The authorization server (AS) is the in-memory `TestOAuthServer` of the SDK
repository (tag v2.4.0), copied with its port moved to 5901 and its switches
(`iss` in the response, metadata issuer, disabled paths) read from environment
variables. It beat a Keycloak container because the SDK's own tests use it, it
copies `resource` into `aud` (RFC 8707) and each case below is one switch. It
is test-only: no login, no consent, any scope granted. The MCP server runs on
5900; the client's `HttpClient` has a logging `DelegatingHandler`.

### The protected server

```csharp
builder.Services.AddAuthentication(o =>
{
    o.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme; // 401 + resource_metadata
    o.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;      // reads the bearer token
})
.AddJwtBearer(o =>
{
    o.Authority = "https://localhost:5901";   // keys via /.well-known/openid-configuration
    o.MapInboundClaims = false;               // keep "scope" as "scope"
    o.TokenValidationParameters = new() { ValidIssuer = "https://localhost:5901",
                                          ValidAudience = "http://localhost:5900/mcp" };
})
.AddMcp(o => o.ResourceMetadata = new() { AuthorizationServers = { "https://localhost:5901" },
                                          ScopesSupported = ["mcp:tools"] });
builder.Services.AddAuthorization(o => o.AddPolicy("mcp", p => p.RequireAuthenticatedUser()
    .RequireAssertion(c => c.User.FindFirst("scope")?.Value.Split(' ').Contains("mcp:tools") == true)));
builder.Services.AddMcpServer().WithHttpTransport().WithTools<WhoAmITools>();
// ... app.UseAuthentication(); app.UseAuthorization();
app.MapMcp("/mcp").RequireAuthorization("mcp");
```

The audience is the canonical URI of the MCP endpoint, the string the client
sends as `resource`. The tool `whoami` echoes `sub`, `client_id` and `scope`.

### Step 1: the 401 and what the SDK writes in it

`curl -i -X POST http://localhost:5900/mcp` with no token, using only the SDK:

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="http://localhost:5900/.well-known/oauth-protected-resource/mcp"
```

The spec says the server SHOULD also send `scope`, and answer a token with too
few scopes with 403 `error="insufficient_scope"`. In 2.4.0 the handler writes
only `resource_metadata`, and the policy failure came back as a bare `403` with
`Content-Length: 0`. A middleware before `UseAuthentication` fills both in:

```csharp
app.Use((ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        var h = ctx.Response.Headers;
        var prm = $"{ctx.Request.Scheme}://{ctx.Request.Host}/.well-known/oauth-protected-resource{ctx.Request.Path}";
        if (ctx.Response.StatusCode == 401 && h.WWWAuthenticate.Count > 0) h.WWWAuthenticate = $"{h.WWWAuthenticate}, scope=\"mcp:tools\"";
        else if (ctx.Response.StatusCode == 403)
            h.WWWAuthenticate = $"Bearer error=\"insufficient_scope\", scope=\"mcp:tools\", resource_metadata=\"{prm}\"";
        return Task.CompletedTask;
    });
    return next(ctx);
});
```

### Step 2: Protected Resource Metadata (RFC 9728)

The challenge points to the path-inserted URI (the endpoint is `/mcp`); the
handler derives `resource` from the request path:

```text
$ curl http://localhost:5900/.well-known/oauth-protected-resource/mcp
{"resource":"http://localhost:5900/mcp","authorization_servers":["https://localhost:5901"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:tools"]}
$ curl http://localhost:5900/.well-known/oauth-protected-resource
{"resource":"http://localhost:5900","authorization_servers":["https://localhost:5901"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:tools"]}
```

The root document names a different resource, and the client rejects metadata
whose `resource` is not the server it called (read in the source).

### Step 3: finding the authorization server

For an issuer without a path the client tries RFC 8414, then OIDC discovery.
First with `/.well-known/oauth-authorization-server` disabled on the AS, then
with the metadata claiming `"issuer":"https://honest.example"`:

```text
--> GET https://localhost:5901/.well-known/oauth-authorization-server
<-- 404
--> GET https://localhost:5901/.well-known/openid-configuration
<-- 200
McpException: Failed to handle unauthorized response with 'Bearer' scheme. Authorization server metadata issuer 'https://honest.example/' does not match the expected issuer 'https://localhost:5901/' (RFC 8414 Section 3.3).
```

The AS log also showed `GET /.well-known/openid-configuration` with `User-Agent:
Microsoft ASP.NET Core JwtBearer handler`: the server gets its signing keys via
OIDC discovery. The client also refuses metadata without `S256` in
`code_challenge_methods_supported` (since SDK 2.0.0; read in the source and
release notes, not run).

### Step 4: authorization code, PKCE S256 and `resource`

```csharp
var transport = new HttpClientTransport(new()
{
    Endpoint = new Uri("http://localhost:5900/mcp"),
    OAuth = new()
    {
        ClientId = "demo-client", ClientSecret = "demo-secret",   // pre-registered at the AS
        RedirectUri = new Uri("http://localhost:5902/callback"),
        AuthorizationCallbackHandler = async (ctx, ct) =>
        {
            // browser: an HttpClient with AllowAutoRedirect = false; a real app opens a browser
            var resp = await browser.GetAsync(ctx.AuthorizationUri, ct);
            var q = HttpUtility.ParseQueryString(resp.Headers.Location!.Query);
            return new AuthorizationResult { Code = q["code"], State = q["state"], Iss = q["iss"] };
        },
    },
}, http);
await using var client = await McpClient.CreateAsync(transport);
```

The full run (the logger cuts values of 40+ characters to 8; the AS metadata
line is cut with `...` and the PRM body, shown in step 2, left out):

```text
--> POST http://localhost:5900/mcp [Mcp-Method: server/discover]
<-- 401 WWW-Authenticate: Bearer resource_metadata="http://localhost:5900/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"
--> GET http://localhost:5900/.well-known/oauth-protected-resource/mcp
<-- 200
--> GET https://localhost:5901/.well-known/oauth-authorization-server
<-- 200
    {"issuer":"https://localhost:5901","authorization_endpoint":"https://localhost:5901/authorize",...,"code_challenge_methods_supported":["S256"],...}
--> GET https://localhost:5901/authorize?client_id=demo-client&redirect_uri=http%3a%2f%2flocalhost%3a5902%2fcallback&response_type=code&code_challenge=LQ4t5Bbf...&code_challenge_method=S256&state=gRIZ1dnY...&resource=http%3a%2f%2flocalhost%3a5900%2fmcp&scope=mcp%3atools
<-- 302 Location: http://localhost:5902/callback?code=or8_F3kd...&state=gRIZ1dnY...
--> POST https://localhost:5901/token
    form: grant_type=authorization_code&code=or8_F3kd...&redirect_uri=http://localhost:5902/callback&code_verifier=PQvM1kDq...&resource=http://localhost:5900/mcp&client_id=demo-client&client_secret=demo-secret
<-- 200
    {"access_token":"eyJhbGci....eyJpc3Mi....F_px8CNu...","token_type":"Bearer","expires_in":3600,"refresh_token":"_TGUyqD2...","scope":"mcp:tools"}
    jwt payload: {"iss":"https://localhost:5901","sub":"user-demo-client","name":"user-demo-client","aud":"http://localhost:5900/mcp","client_id":"demo-client","jti":"1e8bd12e-371c-4131-b736-3fdf11ce4948","iat":"1795047165","exp":"1795050765","scope":"mcp:tools"}
--> POST http://localhost:5900/mcp [Authorization: Bearer eyJhbGciOiJS...] [Mcp-Method: server/discover]
<-- 200
--> POST http://localhost:5900/mcp [Authorization: Bearer eyJhbGciOiJS...] [Mcp-Method: tools/call]
<-- 200
whoami -> sub=user-demo-client client_id=demo-client scope=mcp:tools
```

`resource` is in both the authorization and the token request, `scope` came
from the challenge, and the token travels only in `Authorization`.
`ClientOAuthOptions.Scopes` is a fallback: with `Scopes = ["openid"]` the
client still asked for `mcp:tools`; `ScopeSelector` is the hook that overrides.
The AS checks the other half: without `resource` it redirected with
`error=invalid_target`, and a wrong `code_verifier` got `invalid_grant` "Code
verifier does not match the challenge".

### Step 5: what the server accepts

Three tokens minted with curl (same client, PKCE by hand), sent to `tools/list`;
"server log" is what `OnAuthenticationFailed` and `OnTokenValidated` printed:

| token | server log | response |
| --- | --- | --- |
| `resource=http://localhost:5910/mcp` (another server) | `rejected: IDX10214: Audience validation failed` | 401, same header as step 1 |
| right audience, `scope=openid` | `valid token, aud=http://localhost:5900/mcp scope=openid` | 403 `Bearer error="insufficient_scope", scope="mcp:tools", resource_metadata="..."` |
| `abc.def.ghi` | `rejected: IDX14102: Unable to decode the header ...` | 401, same header as step 1 |

A token for another server is invalid here (401); a valid one with too few
scopes is a 403. No 401 carries `error="invalid_token"`: the MCP scheme sends
one challenge for "no token" and "bad token". With `ScopeSelector` forcing the
first authorization down to `openid`, the 403 hit the retry right after the
token exchange and the SDK did not step up there (`HttpRequestException: ...
403 (Forbidden)`); the next request on the same transport got the 403, reran
the flow with `scope=mcp%3atools` and succeeded. Against the bare 403, no step-up.

### Step 6: `iss` in the authorization response (RFC 9207)

The client compares the `iss` returned with the code to the issuer of the
validated metadata, by exact string. The spec's four rows plus one variant:

| `authorization_response_iss_parameter_supported` | `iss` returned | result |
| --- | --- | --- |
| `true` | `https://localhost:5901` | token exchanged, `whoami` answered |
| `true` | absent | `Authorization server advertises RFC 9207 iss parameter support but none was received in the authorization response.` |
| absent | `https://evil.example` | `Authorization response issuer 'https://evil.example' does not match expected issuer 'https://localhost:5901'.` |
| absent | absent | token exchanged, `whoami` answered |
| `true` | `https://localhost:5901/` | `Authorization response issuer 'https://localhost:5901/' does not match expected issuer 'https://localhost:5901'.` |

In the failures the log has no `POST /token`: the code never left the client.
The trailing slash fails because the spec forbids normalizing before comparing.
This stops mix-up attacks, where a malicious AS gets a client that talks to
several servers to send it a code issued by an honest one.

### Why stdio does not use any of this

Stdio implementations SHOULD NOT follow this spec and take credentials from the
environment: the server is the host's child process, with no HTTP request to
challenge and no remote peer. In 2.4.0 `HttpClientTransportOptions` has `OAuth`,
`StdioClientTransportOptions` has `EnvironmentVariables` (source, not run).

### What comes next

How a client with no prior relationship gets a `client_id` (Client ID Metadata
Documents, deprecated DCR) comes next; what this flow alone does not stop (token
passthrough, confused deputy, SSRF in metadata fetches) belongs to MCP security.

## Trade-offs

- **SDK defaults vs the spec's SHOULDs.** The handler gives the 401 and the
  metadata endpoint; `scope` in the challenge and the `insufficient_scope` 403
  are yours to add, and without them clients cannot step up.
- **One audience per server.** `ValidAudience` = the MCP URI rejects tokens for
  other APIs, but it must equal the client's `resource` exactly: `/mcp` and the
  root are different resources (step 2).
- **Generic vs diagnosable 401.** One header for every failure hides internals;
  log `OnAuthenticationFailed`, the only place the reason appears.
- **Signing key rotation.** After a restart of the in-memory AS (new RSA key)
  the running server rejected fresh tokens with `IDX10503: Signature validation
  failed` until it restarted too, its cached keys stale. A real AS publishes a
  new key in the JWKS before signing with it.

## Documentation Links

- [Authorization, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (doc)
- [Authorization Server Discovery, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) (doc)
- [Authorization Security Considerations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (doc)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata, IETF](https://datatracker.ietf.org/doc/html/rfc9728) (doc)
- [RFC 8707: Resource Indicators for OAuth 2.0, RFC Editor](https://www.rfc-editor.org/rfc/rfc8707.html) (doc)
- [RFC 9207: OAuth 2.0 Authorization Server Issuer Identification, IETF](https://datatracker.ietf.org/doc/html/rfc9207) (doc)
- [RFC 8414: OAuth 2.0 Authorization Server Metadata, IETF](https://datatracker.ietf.org/doc/html/rfc8414) (doc)
- [Configure JWT bearer authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication) (doc)
- [ProtectedMcpServer sample, MCP C# SDK on GitHub](https://github.com/modelcontextprotocol/csharp-sdk/tree/main/samples/ProtectedMcpServer) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
