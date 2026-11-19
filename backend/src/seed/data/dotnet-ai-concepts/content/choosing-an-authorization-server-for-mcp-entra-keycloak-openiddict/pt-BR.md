---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Um servidor MCP protegido é só resource server: ele valida tokens que outro
authorization server (AS) emitiu, e o Protected Resource Metadata diz qual.
Esta lição mede o que a spec 2026-07-28 exige desse AS (descoberta, PKCE S256
anunciado, `resource` com `aud` correspondente, `iss` na resposta, CIMD ou DCR)
no Keycloak em Docker, no OpenIddict embutido em ASP.NET Core e no Microsoft
Entra ID (metadata público medido, o resto só documentação), e termina com uma
tabela de decisão e uma recomendação por cenário. Sem modelo.
Versões: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`),
`OpenIddict.AspNetCore` e `OpenIddict.EntityFrameworkCore` 7.9.0,
`Microsoft.EntityFrameworkCore.InMemory` 10.0.0, `ModelContextProtocol` e
`ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.AspNetCore.Authentication.JwtBearer`
10.0.15, TFM `net10.0`, SDK 10.0.100, revisão da spec 2026-07-28.

## Use Cases

- Escolher o AS de um servidor MCP remoto novo, ou conferir se o que a empresa já usa dá conta.
- Explicar por que um cliente MCP se recusa a autenticar no Entra ID antes de qualquer tela de login.
- Configurar Keycloak ou OpenIddict para que o token traga a URL do servidor MCP como audience.
- Decidir quando um gateway na frente de um provedor de identidade legado é a única saída.

## Deep Dive

### O que a spec pede do AS

O servidor MCP nunca emite token; ele publica `authorization_servers` no PRM
(RFC 9728) e valida. O AS precisa entregar (2026-07-28):

| requisito | nível | por que o cliente se importa |
| --- | --- | --- |
| RFC 8414 ou OIDC Discovery | MUST (um dos dois) | o cliente tenta os dois |
| `code_challenge_methods_supported` no metadata | MUST para provedores OIDC | se faltar, o cliente MUST se recusar a seguir |
| `resource` (RFC 8707) | o cliente MUST mandar no authorize e no token | o servidor confere `aud` contra a própria URI |
| `iss` na resposta de autorização (RFC 9207) | SHOULD | defesa contra mix-up, checada antes da troca do code |
| Client ID Metadata Documents | SHOULD | cliente sem registro prévio |
| Dynamic Client Registration (RFC 7591) | MAY, depreciado | fallback legado |

O laboratório reaproveita o servidor MCP protegido e o cliente do SDK da lição
do fluxo de autorização (porta 6222, issuer do AS lido de variável de ambiente);
um `HttpClient` com cookie jar faz o papel do navegador como a usuária `alice`.
Cada AS também foi sondado com curl.

### Keycloak 26.8.2: tem tudo, duas peças atrás de flags

O metadata do realm, na subida padrão (`start-dev`, sem features):

```text
GET /realms/mcp/.well-known/openid-configuration                 -> 200
GET /.well-known/oauth-authorization-server/realms/mcp           -> 200 (RFC 8414 path insertion)
registration_endpoint = "http://localhost:6220/realms/mcp/clients-registrations/openid-connect"
code_challenge_methods_supported = ["plain", "S256"]
authorization_response_iss_parameter_supported = true
client_id_metadata_document_supported = <absent>
```

Sem flags o `resource` é ignorado, e a audience vem de um Audience mapper no
client scope `mcp:tools` (Included Custom Audience = a URL do MCP):

| request (cliente público `mcp-client`) | `aud` do access token |
| --- | --- |
| `scope=openid`, sem `resource` | `"account"` |
| `scope=openid`, `resource=http://localhost:6222/mcp` | `"account"` (ignorado) |
| `scope=openid mcp:tools`, sem `resource` | `["http://localhost:6222/mcp","account"]` |
| `scope=openid mcp:tools`, `resource=http://localhost:6299/other` | `["http://localhost:6222/mcp","account"]` |

A última linha é o risco: um token pedido para outro recurso não foi recusado,
quem decidiu a audience foi o scope. Reiniciado com `--features=cimd,resource-indicators`
(log: `Experimental features enabled: cimd:v1, resource-indicators:v1`), um client
`mcp-server` com `resource_url=http://localhost:6222/mcp` e um Audience mapper no
`mcp-client` apontando para ele:

| `resource` no authorize / no token | resultado |
| --- | --- |
| `.../6222/mcp` / igual | `aud="http://localhost:6222/mcp"` |
| `.../6299/other` / igual | code emitido, token: `invalid_target` "The requested resource is invalid, missing, unknown, or malformed." |
| `.../6222/mcp` / `.../6299/other` | `invalid_target` "The requested resource is not matching the original request." |
| nenhum / nenhum | `aud=["mcp-server","account"]` (o client id, não a URL) |

Com a flag o metadata ganhou `client_id_metadata_document_supported: true`.
O CIMD exige uma client policy: um profile com o executor
`client-id-metadata-document` (opções `cimd-allow-http-scheme` para o lab,
`cimd-allow-permitted-domains`, `cimd-resource-indicator-allow-list`) e uma
policy com a condição `client-id-uri`. Com um documento servido no host como
`http://host.docker.internal:6224/oauth/client.json`:

- só com `host.docker.internal` confiável: `Invalid Client ID: domain not allowed.`, log `not trusted domain: host = localhost`; o host do redirect URI também é checado.
- com `localhost` incluído: tela de consentimento, depois `aud="http://localhost:6222/mcp"`, `azp` = a URL do documento. Sem `resource` o `aud` saiu igual (a allow list); com `.../6299/other` o authorize respondeu 400, log `resource parameter not allowed`.
- o client buscado foi gravado como client comum do realm (aparece na API de admin), e três fluxos seguidos deixaram um único GET no log do host do documento.

O DCR funciona, atrás das políticas de registro anônimo. O corpo que o SDK
envia (lição anterior) passou por três respostas:

```text
403 {"error":"insufficient_scope","error_description":"Policy 'Trusted Hosts' rejected request to client-registration service. Details: Host not trusted."}
403 ... "Policy 'Allowed Client Scopes' rejected request ... Not permitted to use specified clientScope"
201 {"client_id":"1c62772b-d37a-...","token_endpoint_auth_method":"none","scope":"mcp:tools",...}
```

A primeira pediu o IP de quem chama (o gateway do Docker, `192.168.65.1`) em
Trusted Hosts, a segunda `mcp:tools` em Allowed Client Scopes; `application_type`
não voltou na resposta, e "Consent Required" mostrou tela de consentimento. De
ponta a ponta, o SDK com o cliente público pré-registrado achou `/.well-known/oauth-authorization-server/realms/mcp`,
mandou `resource=http://localhost:6222/mcp&client_id=mcp-client&client_secret=`
(vazio, aceito) e recebeu `whoami -> ... iss=http://localhost:6220/realms/mcp scope=profile mcp:tools offline_access email`.

### OpenIddict 7.9.0: um AS dentro da sua aplicação

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

As duas URIs well-known responderam 200 com o mesmo documento: `issuer`
`http://localhost:6221/`, `code_challenge_methods_supported: ["plain","S256"]`,
`authorization_response_iss_parameter_supported: true`, e nem
`registration_endpoint` nem `client_id_metadata_document_supported`. A primeira
execução do SDK parou no authorize:

```text
[browser] GET .../connect/authorize?client_id=mcp-client&...&resource=http%3a%2f%2flocalhost%3a6222%2fmcp&scope=mcp%3atools+offline_access
[browser] 400 error:invalid_request
error_description:The client application is not allowed to use the 'offline_access' scope.
```

O SDK acrescentou `offline_access` porque o metadata o lista; o cliente precisa
da permissão do grant `refresh_token`. Depois disso a execução fechou, com o
redirect do code trazendo `iss=http%3A%2F%2Flocalhost%3A6221%2F` e o payload do
token `"aud":"http://localhost:6222/mcp","client_id":"mcp-client","scope":"mcp:tools offline_access"`.
O `client_secret=` vazio foi aceito para o cliente público. Sondagens com curl:

| `resource` no authorize / no token | resultado |
| --- | --- |
| `.../6222/mcp` / igual | `aud="http://localhost:6222/mcp"`, log do servidor `valid token` |
| `.../6299/other` / não chega | 400 no authorize, `invalid_target` (ID2190), sem redirect |
| nenhum / nenhum | token sem `aud`, log do servidor `IDX10206: Unable to validate audience`, 401 |
| `.../6222/mcp` / `.../6299/other` | `invalid_target` |
| `.../6222/mcp` / nenhum | `invalid_target` |

O OpenIddict valida `resource` contra os recursos registrados e as permissões
de cada cliente, mas gravar o valor no token é código seu (`SetResources`). DCR
e CIMD não existem: as issues #2404 (DCR) e #2552 (CIMD) estão abertas, e o
mantenedor disse que ainda é cedo para implementar CIMD (só documentação).

### Microsoft Entra ID: metadata medido, o resto só documentação

Não há tenant aqui, mas a descoberta é pública. O SDK, com um PRM apontando para
`https://login.microsoftonline.com/{tenant}/v2.0`:

```text
--> GET https://login.microsoftonline.com/.well-known/oauth-authorization-server/{tenant}/v2.0   <-- 404
--> GET https://login.microsoftonline.com/.well-known/openid-configuration/{tenant}/v2.0         <-- 404
--> GET https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration         <-- 200
McpException: ... Authorization server metadata from '.../v2.0/.well-known/openid-configuration' does not include 'code_challenge_methods_supported'. MCP clients require PKCE support and must refuse to proceed.
```

O documento v2.0 também não tem `registration_endpoint`,
`authorization_response_iss_parameter_supported` nem
`client_id_metadata_document_supported`. A doc do auth code flow aceita
`code_challenge_method=S256` no request: o Entra faz PKCE mas não anuncia, e um
cliente que segue a spec para antes da tela de login. Pela documentação:

- `aud`: "In v2.0 tokens, this value is always the client ID of the API. In v1.0 tokens, it can be the client ID or the resource URI used in the request." `requestedAccessTokenVersion` nulo significa token v1.0.
- `scope={resource-identifier}/.default` "is functionally the same as `resource={resource-identifier}` on the v1.0 endpoint"; os scopes de um request "must all be from a single resource", e scope sem prefixo de recurso significa Microsoft Graph.
- o parâmetro `resource` do RFC 8707 no endpoint v2.0: não documentado (as tabelas do request não o listam).
- DCR: "Microsoft Entra ID doesn't publish an RFC 7591 registration endpoint" (doc do Microsoft 365 Copilot). CIMD: não documentado.
- a resposta de autorização é documentada com `code` e `state`; `iss` nela: não documentado.

Para o servidor MCP isso significa: validar `aud` contra o client ID da API (ou
client ID e App ID URI enquanto existirem tokens v1.0), e não contra a URL MCP
que o cliente manda em `resource`; publicar scopes completos como
`api://{client-id}/mcp.tools` em `scopes_supported`; e pré-registrar todo
cliente. Mesmo assim um cliente que segue a spec recusa o metadata.

### Tabela de decisão

(m) medido aqui, (d) documentação do fornecedor ou issue tracker.

| requisito | Keycloak 26.8.2 | OpenIddict 7.9.0 | Entra ID (v2.0) |
| --- | --- | --- | --- |
| descoberta RFC 8414 / OIDC | suporta, as duas (m) | suporta, as duas (m) | parcial: só OIDC, RFC 8414 dá 404 (m) |
| PKCE S256 anunciado | suporta (m) | suporta (m) | não: campo ausente, SDK recusa (m); S256 aceito no request (d) |
| `resource` e `aud` | parcial: flag experimental, ignorado sem ela (m) | suporta: recursos registrados + `SetResources` (m) | só doc: não documentado no v2.0; `aud` v2.0 = client ID da API (d) |
| `iss` na resposta (RFC 9207) | suporta (m) | suporta (m) | não: não anunciado (m), não documentado (d) |
| CIMD | parcial: flag experimental + client policy (m) | não (m, issue #2552) | não: não anunciado (m), não documentado (d) |
| DCR | suporta, anônimo atrás de políticas (m) | não (m, issue #2404) | não (m; d) |

### Servidor MCP na frente de um AS legado

Quando o provedor de identidade é fixo (Entra, um Keycloak antigo, um SSO
interno), o PRM não precisa apontar para ele. O padrão (citado, não montado
aqui): o PRM lista um AS ou gateway de autorização que fala MCP (metadata RFC
8414 com S256, `iss`, CIMD ou DCR, `resource` virando `aud`) e federa o login no
legado; o servidor MCP confia só no issuer desse gateway. O Keycloak faz esse
papel com o Entra como identity provider (brokering). Atalhos como um
`/register` falso que entrega a todo cliente o mesmo client ID estático do Entra
transformam todos os clientes em um só. Repassar o header `Authorization`
recebido para o backend (há um exemplo na doc de MCP do API Management) é token
passthrough, que a spec do MCP proíbe.

### Recomendação por cenário

| cenário | escolha |
| --- | --- |
| Empresa padronizada no Entra ID | o Entra continua fonte de identidade; ponha no PRM um AS ou gateway compatível (Keycloak fazendo brokering do Entra, ou um gateway gerenciado) até o Entra anunciar PKCE e aceitar o fluxo MCP; pré-registre os clientes |
| Self-hosted, clientes conhecidos | OpenIddict dentro da app .NET (pré-registro, checagem real de `resource`), ou Keycloak se quiser console de administração |
| Produto SaaS aberto a qualquer cliente MCP | precisa de CIMD (DCR como fallback): Keycloak com as flags `cimd` e `resource-indicators`, aceitando o "experimental", ou um AS de fornecedor com CIMD |

Livro vs hoje: guias da spec 2025-03-26 põem o próprio servidor MCP para servir
`/authorize`, `/token` e `/register`; desde 2025-06-18 ele é só resource server.

## Trade-offs

- **Flags experimentais contra conformidade.** O Keycloak cumpre a lista de
  2026-07-28 só com `cimd` e `resource-indicators`, que a doc chama de experimentais.
- **Audience por scope é uma checagem fraca.** Sem a flag, um token pedido para
  `.../6299/other` ganhou a audience do MCP, porque o mapper está no scope.
- **AS embutido contra produto.** O OpenIddict dá controle exato e nenhum
  container a mais, mas login, consentimento, guarda de chaves e qualquer DCR ou
  CIMD são código seu.
- **A identidade do Entra contra o metadata dele.** Usuários e Conditional
  Access moram no Entra, mas o metadata v2.0 barra clientes que seguem a spec; um
  gateway acrescenta um salto e mais um issuer para confiar.
- **Padrões que ampliam escopo.** O SDK pediu `offline_access` quando listado, e
  o Keycloak acrescentou `profile` e `email`: decida quais scopes o AS anuncia.

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
