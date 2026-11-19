---
version: 1.0
updatedAt: 2026-11-19
title: "Fluxo de Autorização do MCP: 401, Descoberta e Validação de Token"
summary: O fluxo OAuth inteiro de um servidor MCP HTTP protegido, medido no fio com o SDK C# 2.4.0 e um authorization server local: o 401 com resource_metadata, o Protected Resource Metadata (RFC 9728), a descoberta por RFC 8414 e OIDC, authorization code com PKCE S256 e resource (RFC 8707), audience errada dando 401, escopo faltando dando 403 insufficient_scope, a checagem de iss (RFC 9207) no cliente e por que stdio fica de fora.
---
## Objective

Um servidor MCP remoto protegido por OAuth é um resource server comum: responde
401 apontando para os próprios metadados, o cliente descobre sozinho o
authorization server, faz authorization code com PKCE e `resource`, e volta com
um token cuja audience é só aquele servidor. Esta lição roda o fluxo em
localhost com o SDK C# e registra cada request: 401, Protected Resource Metadata
(RFC 9728), descoberta do AS (RFC 8414 e OIDC), PKCE S256, checagem de audience e
de escopo (401 contra 403) e a checagem de `iss` no cliente (RFC 9207). Sem modelo.
Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2),
TFM `net10.0`, SDK 10.0.100, revisão da spec 2026-07-28.

## Use Cases

- Colocar um servidor MCP remoto em ASP.NET Core atrás de um authorization server OAuth.
- Depurar, pelo log do fio, um cliente que fica em loop de 401 ou morre na descoberta.
- Conferir se o servidor recusa token emitido para outra API (audience) ou com escopo de menos.
- Explicar numa revisão de segurança o que cada salto do fluxo carrega e quem confere.

## Deep Dive

### O laboratório: três processos em localhost

O authorization server (AS) é o `TestOAuthServer` em memória do repositório do
SDK (tag v2.4.0), copiado com a porta 5901 e as chaves (`iss` na resposta,
issuer dos metadados, caminhos desligados) lidas do ambiente. Ganhou de um
Keycloak em container porque é o AS dos testes do SDK, copia `resource` para
`aud` (RFC 8707) e cada caso abaixo é uma chave. Só serve para teste: sem login,
sem consentimento, concede qualquer escopo. O servidor MCP roda na 5900; o
`HttpClient` do cliente tem um `DelegatingHandler` que registra tudo.

### O servidor protegido

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

A audience é a URI canônica do endpoint MCP, a string que o cliente manda em
`resource`. A tool `whoami` devolve `sub`, `client_id` e `scope`.

### Passo 1: o 401 e o que o SDK escreve nele

`curl -i -X POST http://localhost:5900/mcp` sem token, só com o SDK:

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="http://localhost:5900/.well-known/oauth-protected-resource/mcp"
```

A spec diz que o servidor DEVERIA (SHOULD) mandar também `scope` e responder a
token com escopo de menos com 403 `error="insufficient_scope"`. No 2.4.0 o
handler escreve só `resource_metadata`, e a falha da policy voltou como `403`
pelado (`Content-Length: 0`). Um middleware antes de `UseAuthentication` resolve:

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

### Passo 2: Protected Resource Metadata (RFC 9728)

O desafio aponta para a URI com o caminho inserido (o endpoint é `/mcp`); o
handler deriva `resource` do caminho da request:

```text
$ curl http://localhost:5900/.well-known/oauth-protected-resource/mcp
{"resource":"http://localhost:5900/mcp","authorization_servers":["https://localhost:5901"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:tools"]}
$ curl http://localhost:5900/.well-known/oauth-protected-resource
{"resource":"http://localhost:5900","authorization_servers":["https://localhost:5901"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:tools"]}
```

O documento da raiz fala de outro resource, e o cliente recusa metadados cujo
`resource` não é o servidor que ele chamou (lido no código-fonte).

### Passo 3: achando o authorization server

Sem caminho no issuer, o cliente tenta RFC 8414 e depois OIDC. Abaixo, uma vez com
`/.well-known/oauth-authorization-server` desligado e outra com `"issuer":"https://honest.example"`:

```text
--> GET https://localhost:5901/.well-known/oauth-authorization-server
<-- 404
--> GET https://localhost:5901/.well-known/openid-configuration
<-- 200
McpException: Failed to handle unauthorized response with 'Bearer' scheme. Authorization server metadata issuer 'https://honest.example/' does not match the expected issuer 'https://localhost:5901/' (RFC 8414 Section 3.3).
```

O log do AS também mostrou `GET /.well-known/openid-configuration` com
`User-Agent: Microsoft ASP.NET Core JwtBearer handler`: o servidor busca as
chaves de assinatura pela descoberta OIDC. O cliente ainda recusa metadados sem
`S256` em `code_challenge_methods_supported` (desde o SDK 2.0.0; lido no
código-fonte e nas release notes, não executado).

### Passo 4: authorization code, PKCE S256 e `resource`

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

A execução completa (o logger corta valores de 40+ caracteres para 8; a linha de
metadados do AS foi cortada com `...` e o corpo do PRM, do passo 2, omitido):

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

`resource` vai na request de autorização e na de token, `scope` veio do
desafio, e o token só anda no header `Authorization`. `ClientOAuthOptions.Scopes`
é só reserva: com `Scopes = ["openid"]` o cliente pediu `mcp:tools` mesmo assim;
quem muda isso é o `ScopeSelector`. O AS confere a outra metade: sem `resource`
redirecionou com `error=invalid_target`, e `code_verifier` errado levou
`invalid_grant` "Code verifier does not match the challenge".

### Passo 5: o que o servidor aceita

Três tokens emitidos com curl (mesmo cliente, PKCE na mão) contra `tools/list`;
"log do servidor" é o que `OnAuthenticationFailed` e `OnTokenValidated` imprimiram:

| token | log do servidor | resposta |
| --- | --- | --- |
| `resource=http://localhost:5910/mcp` (outro servidor) | `rejected: IDX10214: Audience validation failed` | 401, mesmo header do passo 1 |
| audience certa, `scope=openid` | `valid token, aud=http://localhost:5900/mcp scope=openid` | 403 `Bearer error="insufficient_scope", scope="mcp:tools", resource_metadata="..."` |
| `abc.def.ghi` | `rejected: IDX14102: Unable to decode the header ...` | 401, mesmo header do passo 1 |

Token de outro servidor é inválido aqui (401); token válido com escopo de menos
é 403. Nenhum 401 traz `error="invalid_token"`: o esquema do MCP manda o mesmo
desafio para "sem token" e "token ruim". Com o `ScopeSelector` forçando a
primeira autorização a pedir só `openid`, o 403 caiu na nova tentativa logo
depois da troca do token, e ali o SDK não fez step-up (`HttpRequestException:
... 403 (Forbidden)`); a request seguinte no mesmo transport levou o 403, refez
o fluxo com `scope=mcp%3atools` e passou. Contra o 403 pelado, nada de step-up.

### Passo 6: `iss` na resposta de autorização (RFC 9207)

O cliente compara o `iss` que volta com o code ao issuer dos metadados já
validados, por string exata. As quatro linhas da spec mais uma variação:

| `authorization_response_iss_parameter_supported` | `iss` recebido | resultado |
| --- | --- | --- |
| `true` | `https://localhost:5901` | token trocado, `whoami` respondeu |
| `true` | ausente | `Authorization server advertises RFC 9207 iss parameter support but none was received in the authorization response.` |
| ausente | `https://evil.example` | `Authorization response issuer 'https://evil.example' does not match expected issuer 'https://localhost:5901'.` |
| ausente | ausente | token trocado, `whoami` respondeu |
| `true` | `https://localhost:5901/` | `Authorization response issuer 'https://localhost:5901/' does not match expected issuer 'https://localhost:5901'.` |

Nas falhas o log não tem `POST /token`: o code nem saiu do cliente. A barra no
fim falha porque a spec proíbe normalizar antes de comparar. É a defesa contra
mix-up: um AS malicioso levando um cliente que fala com vários servidores a lhe
entregar o code emitido por um honesto.

### Por que stdio não usa nada disso

Implementações stdio NÃO DEVERIAM (SHOULD NOT) seguir esta spec: pegam a
credencial do ambiente, porque o servidor é processo filho do host, sem request
HTTP para desafiar e sem par remoto. No 2.4.0 `HttpClientTransportOptions` tem
`OAuth` e `StdioClientTransportOptions` tem `EnvironmentVariables` (fonte, não executado).

### O que vem depois

Como um cliente sem relação prévia obtém um `client_id` (Client ID Metadata
Documents, DCR depreciado) é o próximo assunto; o que o fluxo sozinho não impede
(token passthrough, confused deputy, SSRF na busca de metadados) é segurança em MCP.

## Trade-offs

- **Padrão do SDK vs os SHOULD da spec.** O handler entrega o 401 e o endpoint
  de metadados; `scope` no desafio e o 403 `insufficient_scope` ficam por sua
  conta, e sem eles o cliente não consegue fazer step-up.
- **Uma audience por servidor.** `ValidAudience` = a URI do MCP recusa token de
  outras APIs, mas tem que ser igual ao `resource` do cliente: `/mcp` e a raiz
  são resources diferentes (passo 2).
- **401 genérico vs 401 diagnosticável.** Um header só para toda falha esconde o
  interno; registre `OnAuthenticationFailed`, o único lugar onde o motivo aparece.
- **Rotação da chave de assinatura.** Reiniciado o AS em memória (chave RSA
  nova), o servidor já no ar recusou tokens novos com `IDX10503: Signature
  validation failed` até reiniciar também: as chaves em cache estavam velhas. Um
  AS de verdade publica a chave nova no JWKS antes de assinar com ela.

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
