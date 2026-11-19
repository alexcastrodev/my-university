---
version: 1.0
updatedAt: 2026-11-19
title: "Extensões de Autorização do MCP: Client Credentials e Autorização Gerenciada pela Empresa"
summary: As duas extensões oficiais do repositório modelcontextprotocol/ext-auth lidas por inteiro e medidas em localhost com um servidor MCP, um authorization server e um IdP corporativo próprios, o SDK C# 2.4.0 e o Keycloak 26.8.2: negociação por identificador de extensão, OAuth Client Credentials com private_key_jwt e a audiência de RFC 10070, Enterprise-Managed Authorization com ID-JAG, o que o SDK faz e não faz (audience com barra, resource obrigatório, sem checagem do issuer), o que cada lado recusa e quando adotar cada uma.
---
## Objective

O fluxo de autorização do núcleo do MCP supõe uma pessoa que abre o navegador e
consente. Duas extensões oficiais, mantidas no repositório
`modelcontextprotocol/ext-auth`, cobrem os casos em que isso não serve: OAuth
Client Credentials (um pipeline ou daemon sem usuário) e Enterprise-Managed
Authorization (o IdP da empresa decide, por um ID-JAG, e ninguém vê tela de
consentimento). Esta lição lê o repositório e as revisões 2026-07-28 e mede as
duas em localhost: um servidor MCP (resource server, RS), um authorization server
(AS) e um IdP corporativo próprios, o SDK C# na parte do ID-JAG, curl no resto e
o Keycloak para as regras de autenticação do cliente. Sem modelo.
Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2),
Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`), TFM `net10.0`,
SDK 10.0.100, revisão da spec 2026-07-28, revisões 04 a 06 do draft do ID-JAG,
RFC 10070.

## Use Cases

- Um job de CI ou worker noturno que chama um servidor MCP sem usuário presente.
- Distribuir clientes MCP numa empresa em que a TI, e não cada funcionário, decide quem acessa qual servidor.

## Deep Dive

### O que o repositório tem

Lido por inteiro (commit `15ca394`, 2026-10-23): duas extensões Stable, cada uma
em `2026-07-28/` e `draft/`. As duas pastas diferem por uma linha (o cabeçalho
`Protocol Revision`), então hoje o draft não acrescenta nada.

| extensão | identificador | estágio | spec |
| --- | --- | --- | --- |
| OAuth Client Credentials | `io.modelcontextprotocol/oauth-client-credentials` | Stable | 163 linhas |
| Enterprise-Managed Authorization | `io.modelcontextprotocol/enterprise-managed-authorization` | Stable | 270 linhas |

Por que fora do núcleo: o núcleo descreve um fluxo interativo. Extensões são
opcionais, aditivas e componíveis, e pela SEP-3392 uma Stable só muda com uma
nova revisão do núcleo. PRs abertos (não são spec) acrescentariam DPoP (#38) e
Workload Identity Federation (#40, #42) como Experimental; issues pedem device
code (#18).

### Negociação: identificador mais objeto de configurações vazio

A partir de 2026-07-28 o cliente lista os identificadores que suporta em
`_meta["io.modelcontextprotocol/clientCapabilities"].extensions` de cada request,
e o servidor lista os seus no resultado de `server/discover`. As duas extensões
usam `{}` como configurações. Extensões ficam "sempre desligadas por padrão", e
o lado sem suporte deve voltar ao comportamento do núcleo ou rejeitar, se a
extensão for obrigatória. Revisões antigas levam o mesmo campo no `initialize`.

```csharp
// client: declare   (2.4.0 has IDictionary<string, object>? Extensions on ClientCapabilities)
new McpClientOptions { Capabilities = new() { Extensions = new Dictionary<string, object> {
    ["io.modelcontextprotocol/oauth-client-credentials"] = new object() } } }
```

Medido: um valor `new Dictionary<string, object>()` não serializou
(`NotSupportedException: Ambiguous matches when resolving JsonTypeInfo`);
`new object()` gera `{}`. O cliente leu a lista do servidor em
`client.ServerCapabilities.Extensions`, e a tool leu a do cliente em
`server.ClientCapabilities.Extensions`:

```text
server capabilities.extensions = {"io.modelcontextprotocol/oauth-client-credentials":{},"io.modelcontextprotocol/enterprise-managed-authorization":{}}
whoami -> sub=ci-pipeline ... declared-extensions=[io.modelcontextprotocol/oauth-client-credentials]
whoami -> sub=u-alice ... declared-extensions=[]          (client called with no declaration)
```

O SDK não declara nada por você e o servidor não recusou a chamada sem declaração:
ela é uma dica para o outro lado, a segurança é o token.

### O que muda no fluxo, e o que não muda

Nada no resource server. O 401, o PRM e os metadados do AS são os da lição do
fluxo de autorização, e o RS valida um JWT com `iss`, `aud` igual à sua URI e
`scope` como antes. Só muda o grant no token endpoint e quem é o `sub` do token.
O laboratório (portas 6600 RS, 6601 AS, 6602 IdP, um projeto .NET) respondeu o
mesmo 401 com `resource_metadata` e o mesmo PRM (`authorization_servers` = o AS).

### Extensão 1: OAuth Client Credentials

O texto da spec: o cliente é pré-registrado fora de banda (sem DCR). Deve
autenticar com `private_key_jwt` (RECOMMENDED, RFC 7523 seção 2.2) ou com um
client secret. Os metadados do AS devem listar `private_key_jwt` ou
`client_secret_basic` em `token_endpoint_auth_methods_supported`, e
`token_endpoint_auth_signing_alg_values_supported` para JWT. O request leva
`resource` e `scope`. Uma inconsistência no texto: a regra dos metadados cita
`client_secret_basic`, mas o exemplo do secret põe `client_id` e `client_secret`
no corpo, o que é `client_secret_post`. O AS do laboratório aceitou os dois. A
chamada, sem SDK:

```text
$ curl -s -X POST http://localhost:6601/token -u nightly-job:nightly-secret \
    -d grant_type=client_credentials -d resource=http://localhost:6600/mcp -d scope=mcp:read
{"access_token":"eyJhbGciOiJS...","token_type":"Bearer","expires_in":300,"scope":"mcp:read"}
```

Em `private_key_jwt` o cliente assina uma assertion com `iss` e `sub` iguais ao
client id e sem `client_id` no formulário (RFC 7523 seção 3). O `aud` deve ser o
issuer do AS como único valor: a página da extensão cita a RFC 10070 (novembro de
2026), que proíbe a URL do token endpoint que a RFC 7523 permitia, por causa de
audience injection. Ela também pede `typ: client-authentication+jwt` (SHOULD;
servidores não devem rejeitar a ausência). O log do cliente, assertion abreviada:

```text
--> POST http://localhost:6601/token
    form: grant_type=client_credentials&resource=http://loc...00/mcp&client_assertion_type=urn:ietf:p...bearer&client_assertion=eyJhbGciOi...dB7_dg&scope=mcp:read mcp:write
token: scope="mcp:read mcp:write" expires_in=300 jwt payload={"iss":"http://localhost:6601","client_id":"ci-pipeline","sub":"ci-pipeline","aud":"http://localhost:6600/mcp","scope":"mcp:read mcp:write",...}
```

O `sub` do token é o client id: não existe pessoa. Uma tool que registra "usuário"
a partir do `sub` ou aplica regras por usuário erra aqui, então a tool do
laboratório decide `kind=machine` quando `sub == client_id`. Os escopos continuam
valendo: com `nightly-job` (só `mcp:read`), `write_report` foi recusada com
`Access forbidden: This tool requires authorization.` (exige
`AddAuthorizationFilters()`, senão `InvalidOperationException` na chamada).

O que o AS do laboratório confere, cada caso enviado de verdade (meu AS, minhas
regras onde indicado):

| request | resposta |
| --- | --- |
| `scope=mcp:read mcp:write` para um cliente que só pode `mcp:read` | 400 `invalid_scope` |
| sem `resource`, ou `resource` de outro servidor | 400 `invalid_target` (regra minha, RFC 8707) |
| `aud` da assertion = URL do token endpoint | 401 "aud must be the issuer identifier ... as its sole value" |
| `aud` da assertion = `[issuer, token endpoint]` | 401, mesma mensagem |
| secret errado, outra chave, expirada, `sub` diferente de `iss` | 401 `invalid_client` em cada (`IDX10503`, `IDX10224` para chave e expiração) |
| mesma assertion duas vezes | a segunda dá 401 "jti ... already used" (política minha de uso único) |
| `typ` `JWT` em vez de `client-authentication+jwt` | 200 (como a RFC aconselha, sem rejeitar) |

Keycloak 26.8.2, um cliente com autenticação `client-jwt` e a mesma chave
(`resource` enviado, que o Keycloak ignora sem o recurso de resource indicators,
desligado aqui): `aud` = issuer deu 200; `aud` = URL do token endpoint (o valor
antigo da RFC 7523) ainda 200; `[issuer, token endpoint]` 400 "Multiple audiences
not allowed"; outro issuer 400 "Invalid token audience"; `typ` `JWT` 200; a mesma
assertion de novo 400 "Token reuse detected"; secret por header Basic e por corpo
200 nos dois. O padrão do Keycloak é tolerante onde a RFC 10070 é estrita: se o
seu modelo de ameaça inclui audience injection, confira o que o seu AS faz com a
URL do token endpoint.

O SDK C# 2.4.0 não tem provider de client credentials (o código do provider OAuth
não tem a string `client_credentials`; a página da extensão mostra providers para
TypeScript e Python). Em .NET você faz o POST do formulário acima e dá ao
`HttpClient` um header bearer. Não há refresh token: peça de novo antes do `exp`
(300 s aqui). Num 403 `insufficient_scope`, o núcleo diz que esses clientes PODEM
fazer step-up ou desistir.

### Extensão 2: Enterprise-Managed Authorization (ID-JAG)

Elenco: o cliente MCP, o IdP (SSO, emite o grant), o Resource AS (resgata) e o RS.
O usuário entra pelo IdP uma vez e o cliente guarda o ID token. Para cada
servidor MCP ele então:

1. Token Exchange (RFC 8693) no IdP: `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`, `subject_token` = ID token, `audience` = issuer do Resource AS, `resource` = URL do MCP, `scope`. A política roda aqui (grupo, papel, acesso condicional).
2. Recebe um ID-JAG: um JWT com `typ: oauth-id-jag+jwt`, `iss` do IdP, `sub` do usuário, `aud` = issuer do Resource AS, `client_id`, `jti`, `resource`, `scope`.
3. Envia o ID-JAG ao Resource AS com `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `assertion` e a própria autenticação de cliente. Nunca ao endpoint de authorize. O access token DEVE ficar restrito ao `resource` do ID-JAG.

Descoberta: um Resource AS anuncia `urn:ietf:params:oauth:grant-profile:id-jag` em
`authorization_grant_profiles_supported` e então deve listar também jwt-bearer em
`grant_types_supported`. O SDK, com o token endpoint do meu IdP:

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

A execução para a alice (grupo engineering), com o tráfego do SDK e o token:

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

O IdP concedeu um subconjunto do escopo (engineering só lê), o AS manteve e o RS
aplicou, sem navegador. Achados sobre o SDK:

- **`audience` é o `Uri.ToString()` da URL do AS**: passei `http://localhost:6601`, ele enviou `http://localhost:6601/`, e o meu IdP (comparação exata com o issuer, como o draft diz) respondeu `invalid_target`. Passe a URL exatamente como o issuer, com a barra se o issuer tiver.
- **`resource` é obrigatório no SDK** (`Throw.IfNullOrWhiteSpace`), embora a extensão diga OPTIONAL: um IdP que queira omiti-lo não é atendido.
- **A descoberta tenta `/.well-known/openid-configuration` e depois `oauth-authorization-server`, anexados ao issuer** (sem inserção de caminho da RFC 8414); `IdpUrl` no lugar de `IdpTokenEndpoint` funcionou do mesmo jeito.
- **Sem checagem do issuer nos metadados do AS**: com o AS servindo `"issuer":"https://honest.example/"` o SDK usou o `token_endpoint` e concluiu a troca. O draft 06 (seção 9.5) torna essa validação um MUST; o draft 04, que o texto da extensão linka, não tem essa seção. A minha descoberta manual conferiu e falhou com `AS metadata issuer mismatch`.
- Ele sempre envia `subject_token_type=...:id_token` (sem assertion SAML nem refresh token, que a spec também permite) e rejeita resposta do IdP cujo `token_type` não seja `N_A`. O resultado fica em cache atrás de um lock; chame `InvalidateCache()` após um 401.

O que cada lado recusa, enviado com curl (as regras são as de processamento do
draft como eu as implementei: o que o texto pede, não o que um produto faz):

| request | resposta |
| --- | --- |
| IdP: bob, grupo sem política para este AS | 403 `access_denied` |
| IdP: audience sem a barra final, desconhecida, ou `resource` que ela não governa | 400 `invalid_target` |
| IdP: escopo que o grupo não pode ter | 400 `invalid_scope` |
| IdP: subject token é um access token ou um ID-JAG | 400 `invalid_request` "not an identity assertion" |
| IdP: ID token emitido para outro cliente | 400 `invalid_request` (a audience deve ser o cliente autenticado) |
| AS: ID-JAG resgatado duas vezes | 400 `invalid_grant` "ID-JAG already used" |
| AS: resgatado por outro cliente que não o do claim `client_id`, ou um ID token como `assertion` | 400 `invalid_grant` |
| AS: carol, ID-JAG válido, sem licença | 400 `access_denied` (pelo SDK: `IdentityAssertionGrantException ... error=access_denied`) |
| RS: o ID-JAG usado como bearer token | 401 (`IDX10205: Issuer validation failed`) |

O draft 06 tornou `resource` RECOMMENDED (04: OPTIONAL) e só deixa o AS dispensar
a autenticação do cliente para um ID-JAG com sender constraint (`cnf`: DPoP ou
mTLS). Esse vínculo, SAML, refresh token como sujeito e RAR: lidos, não executados.

### Quem suporta o quê

| peça | estado |
| --- | --- |
| SDK C# 2.4.0 | cliente ID-JAG: `IdentityAssertionGrantProvider` (medido). Client credentials: nenhum (TypeScript e Python têm providers, só doc). Lado servidor de qualquer uma: apenas o dicionário `Extensions` |
| Keycloak 26.8.2 | só o lado que aceita ID-JAG, atrás de `--features=identity-assertion-jwt` (Experimental), guia para o draft 01, lado emissor "TBD". Com a flag ligada, os metadados do realm continuaram sem `authorization_grant_profiles_supported`. Client credentials: medido acima |
| Outros produtos | a página da extensão lista Okta, Ping, Descope, Janssen, Athenz, ThunderID e outros, com "Available", "Early access" ou "Experimental" por papel (só doc, não executado). Entra ID e OpenIddict: não listados, não documentados para ID-JAG aqui |
| Clientes | o site do MCP mantém uma matriz de suporte; meu fetch só de texto não mostrou marcas legíveis nas colunas de auth, então não afirmo nada sobre nenhum cliente |

### Quando adotar

| extensão | problema | estado | suporte | adote quando |
| --- | --- | --- | --- | --- |
| Client Credentials | sem usuário: pipeline, daemon, serviço a serviço | Stable | AS: grant padrão; cliente C#: escreva (10 linhas); TS e Python: provider | quem chama é uma carga de trabalho que você pré-registra e cuja chave rotaciona |
| Enterprise-Managed Authorization | a TI, e não cada funcionário, aprova pares cliente e servidor; sem prompts de consentimento | spec Stable sobre um draft do IETF (06 em 2026-10-31, fornecedores em 01 a 04) | IdP e AS precisam falar o protocolo; cliente C# sim; Keycloak só aceita, experimental | a empresa tem um IdP que emite ID-JAGs e o AS de cada servidor MCP os aceita |

Livro vs hoje: guias das specs de 2025 mostram só authorization code com PKCE e
DCR; fluxos de máquina e de empresa agora são extensões, não "token de serviço" caseiro.

## Trade-offs

- **Spec Stable, draft em movimento por baixo.** A extensão é fixa por revisão do núcleo, mas o draft do ID-JAG foi de 04 a 06 e ganhou MUSTs (validação de metadados) que o texto da extensão não linka. Fixe uma revisão do draft no AS e no cliente e teste os dois lados juntos.
- **Identidade de carga de trabalho é um `sub` sem pessoa.** Toda regra por usuário, linha de auditoria e cota precisa tratar `sub == client_id`.
- **Secrets contra chaves.** Um client secret vazado funciona em silêncio até ser rotacionado; `private_key_jwt` exige guarda de chave e um AS estrito (o Keycloak ainda aceitou o `aud` antigo).
- **Política central exige confiança central.** O IdP decide antes de o token existir e nunca vê o tráfego MCP; o Resource AS confia no issuer, na chave e no `sub` dele, então uma entrada de confiança errada abre a organização inteira.
- **Extensão declarada não é imposição.** Imponha no token, no grant e no escopo.

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
