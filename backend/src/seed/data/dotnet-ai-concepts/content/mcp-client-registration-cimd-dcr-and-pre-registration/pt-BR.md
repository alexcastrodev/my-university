---
version: 1.0
updatedAt: 2026-11-19
title: "Registro de Cliente MCP: CIMD, DCR e Pré-registro"
summary: Os três jeitos de um cliente MCP obter um client_id na spec 2026-07-28, medidos com o SDK C# 2.4.0 e um authorization server local que busca Client ID Metadata Documents de verdade: pré-registro, CIMD e DCR depreciado com application_type, a ordem que o SDK segue, o método de autenticação no token endpoint que vem da lista do AS, o vínculo da credencial ao issuer e o que o AS precisa checar antes de buscar uma URL escolhida pelo cliente (SSRF, redirect, tamanho, tempo, cache).
---
## Objective

Antes de rodar o fluxo de autorização, o cliente MCP precisa de um `client_id`
que o authorization server (AS) aceite. A spec 2026-07-28 lista três caminhos,
em ordem de preferência: pré-registro, Client ID Metadata Documents (CIMD, o
`client_id` é uma URL HTTPS de um JSON que o AS busca) e Dynamic Client
Registration (RFC 7591, agora depreciado, com `application_type` obrigatório).
Esta lição roda os três com o SDK C# em localhost e mede qual o SDK escolhe, o
que acontece quando o AS muda e o que o AS checa antes de buscar uma URL
escolhida pelo cliente. Sem modelo.
Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, TFM `net10.0`,
SDK 10.0.100, revisão da spec 2026-07-28, draft do CIMD `-00`.

## Use Cases

- Distribuir um app desktop ou CLI que conversa com servidores MCP que nunca viu, sem etapa de registro para o usuário.
- Decidir se um AS seu deve aceitar CIMD, manter DCR ou só aceitar clientes pré-registrados.
- Depurar um cliente que se registra de novo a cada execução, ou que quebra depois que o servidor trocou de AS.
- Revisar a exposição a SSRF de um AS que busca documentos de metadados de cliente.

## Deep Dive

### O laboratório e a ordem de preferência

Quatro processos em localhost: o servidor MCP protegido (6100, com a tool
`whoami` que devolve `iss` e `client_id`), o AS (6101, mais uma cópia em 6104),
um host para os documentos de metadados do cliente (`https://localhost:6102`) e
o cliente (redirect URI `http://localhost:6103/callback`, lido do 302 por um
`HttpClient` no papel do navegador). O AS é uma cópia do `TestOAuthServer` do
SDK (tag v2.4.0), que anuncia `client_id_metadata_document_supported` mas nunca
busca nada (ele pré-registra uma URL de CIMD como cliente comum). A cópia
ganhou um resolvedor de verdade (busca, validação, cache, proteção contra SSRF)
e chaves para ligar CIMD, DCR e uma regra de `application_type` no estilo OIDC.
O resto do fluxo (401, PRM, PKCE, `resource`, `iss`) é o da lição anterior. A
ordem da spec: pré-registro para aquele AS; depois CIMD, se os metadados do AS
têm `client_id_metadata_document_supported: true`; depois DCR, se têm
`registration_endpoint`; senão, perguntar ao usuário. Tudo em `ClientOAuthOptions`:

```csharp
var oauth = new ClientOAuthOptions
{
    RedirectUri = new Uri("http://localhost:6103/callback"),
    AuthorizationCallbackHandler = OpenBrowserAndWaitForCode,
    ClientId = "demo-client", ClientSecret = "demo-secret",                       // 1. pré-registro
    ClientMetadataDocumentUri = new Uri("https://localhost:6102/oauth/client.json"), // 2. CIMD
    DynamicClientRegistration = new() { ClientName = "Lab MCP Client" },          // 3. DCR (depreciado)
};
var transport = new HttpClientTransport(new() { Endpoint = new("http://localhost:6100/mcp"), OAuth = oauth }, http);
```

### Caminho 1: pré-registro

O cliente foi criado no AS antes (portal, IaC). Só com `ClientId`/`ClientSecret`,
o token request levou `client_id=demo-client&client_secret=demo-secret`, sem
registro e sem busca. É o único caminho com um AS que não tem CIMD nem DCR.

### Caminho 2: Client ID Metadata Documents

O cliente publica um JSON numa URL HTTPS estável, e essa URL é o `client_id`. A
spec exige `client_id`, `client_name` e `redirect_uris`, com o `client_id` de
dentro igual à URL por comparação simples de string. O draft proíbe métodos de
autenticação baseados em segredo e o campo `client_secret`: um cliente CIMD é
público (`none`) ou usa `private_key_jwt` com `jwks_uri` (só documentação).

```json
{"client_id":"https://localhost:6102/oauth/client.json","client_name":"Lab MCP Client",
 "client_uri":"https://localhost:6102","redirect_uris":["http://localhost:6103/callback","http://127.0.0.1:6103/callback"],
 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}
```

Com `ClientMetadataDocumentUri` e `DynamicClientRegistration` configurados, não
saiu nenhum `/register`; as linhas `[as]` são o log do AS (uma busca, depois o cache):

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

O SDK só confere se a URL é HTTPS com caminho que não seja a raiz (lido no
código-fonte). Hospedar o documento é com você: um arquivo estático no site do produto.

### Caminho 3: Dynamic Client Registration (depreciado)

Sem `ClientId` e sem suporte a CIMD, o SDK faz POST no `registration_endpoint`:

```text
--> POST https://localhost:6101/register
    body: {"redirect_uris":["http://localhost:6103/callback"],"token_endpoint_auth_method":"client_secret_post","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"client_name":"Lab MCP Client","scope":"mcp:tools","application_type":"native"}
<-- 200
    {"client_id":"dyn-9105...","client_secret":"8B3PFdwH...","redirect_uris":["http://localhost:6103/callback"],"client_id_issued_at":1795048505,"token_endpoint_auth_method":"client_secret_post",...}
    ResponseDelegate: client_id=dyn-9105b94d2fd743909b762342a497f5b2 (persist it, keyed by issuer)
```

Cada processo novo se registrou de novo (`dyn-9105...`, `dyn-3f3b...`): o
resultado vive em memória, então persista (`ResponseDelegate`, `TokenCache`
durável) ou o AS enche de clientes órfãos. O `application_type` vai desde o SDK
2.0.0, deduzido do `RedirectUri` quando `ApplicationType` é null. Contra uma
regra do OIDC Registration 1.0 no AS (cliente web não pode usar redirect de loopback):

| redirect URI | `ApplicationType` | enviado | resultado |
| --- | --- | --- | --- |
| `http://localhost:6103/callback` | null | `native` | registrado, `whoami` respondeu |
| `https://app.example.com/callback` | null | `web` | registrado, `whoami` respondeu |
| `http://localhost:6103/callback` | `"web"` | `web` | 400, abaixo |

```text
McpException: Failed to handle unauthorized response with 'Bearer' scheme. Dynamic client registration failed with status BadRequest: {"error":"invalid_redirect_uri","error_description":"application_type web must not use a loopback redirect_uri"} (application_type: 'web', redirect_uri: 'http://localhost:6103/callback').
```

A mensagem traz os dois valores, como a spec pede que o cliente mostre.

### Qual caminho o SDK escolhe de fato

| o cliente configura | metadados do AS | o SDK fez |
| --- | --- | --- |
| ClientId + URI do CIMD + DCR | CIMD e DCR | `client_id=demo-client`, sem busca, sem `/register` |
| URI do CIMD + DCR | CIMD e DCR | URL do CIMD, sem `/register` |
| URI do CIMD + DCR | só DCR | `POST /register` |
| só URI do CIMD | só DCR | `POST /register` mesmo assim (sem `client_name`) |
| URI do CIMD + DCR | nenhum | `Authorization server does not support dynamic client registration` |

Pré-registro ganha de CIMD, CIMD ganha de DCR, como a spec manda. Mas o DCR não
é opcional (com `DynamicClientRegistration` null ele registra igual) e não
existe a etapa "perguntar ao usuário": o SDK lança exceção, e o app precisa
capturar e oferecer um campo de client ID.

### O método de autenticação no token endpoint vem da lista do AS

`ClientOAuthOptions` não tem propriedade para o método de autenticação. No DCR
ele vem da resposta do registro; clientes pré-registrados e CIMD pegam a
**primeira** entrada de `token_endpoint_auth_methods_supported`. Duas ordens
dessa lista:

| lista do AS | pré-registrado | CIMD | DCR |
| --- | --- | --- | --- |
| `["client_secret_post","none"]` | segredo enviado, funciona | manda `client_secret=` (vazio), funciona aqui | funciona |
| `["none","client_secret_post"]` | segredo descartado, `401 Invalid client credentials` | sem segredo, funciona | funciona |

Um AS rigoroso pode recusar o segredo vazio do cliente CIMD público; o cliente
confidencial pré-registrado quebra quando o AS lista `none` primeiro.

### Credenciais pertencem a um issuer

SEP-2352: credenciais persistidas são indexadas pelo `issuer` do AS e nunca
reaproveitadas com outro AS; trocou de AS, registra de novo. O laboratório
mudou o servidor MCP para o AS em 6104 no meio da sessão (o PRM passa a listar
só 6104 e tokens de 6101 são recusados) e chamou `whoami` de novo no mesmo transport:

| caminho | depois da troca |
| --- | --- |
| pré-registrado | `The authorization server changed from 'https://localhost:6101' to 'https://localhost:6104', but explicitly configured client credentials cannot be assumed to be valid for the new authorization server.` |
| DCR | `POST https://localhost:6104/register`, novo `dyn-f468...`, `whoami -> iss=https://localhost:6104` |
| CIMD | mesma URL enviada ao 6104, que buscou o documento; `whoami -> iss=https://localhost:6104` |

Nenhuma execução tentou refresh token no AS novo. O CIMD é portável: cada AS resolve a URL.

### O que o AS precisa checar antes de confiar numa URL

O CIMD transforma o AS em cliente HTTP de um endereço escolhido por quem inicia
o fluxo. O núcleo do resolvedor do laboratório:

```csharp
static readonly HttpClient cimdHttp = new(new SocketsHttpHandler
{
    AllowAutoRedirect = false,                         // 3xx é erro, não salto
    ConnectCallback = async (ctx, ct) =>               // checa o IP realmente discado (DNS rebinding)
    {
        var allowed = allowList.Contains($"{ctx.DnsEndPoint.Host}:{ctx.DnsEndPoint.Port}");
        foreach (var ip in await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct))
            if (allowed || !IsPrivate(ip)) { /* conecta no ip e devolve o NetworkStream */ }
        throw new HttpRequestException($"SSRF policy: {ctx.DnsEndPoint.Host} has no public address and is not allow-listed");
    },
}) { Timeout = TimeSpan.FromSeconds(2) };
```

Depois ele lê no máximo 5 KB (o número do draft), exige `client_id`,
`client_name` e `redirect_uris`, compara `client_id` com a URL, recusa métodos
baseados em segredo e faz cache por `Cache-Control: max-age`, com teto de 24 h.
`IsPrivate` cobre loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10
e IPv6 link-local e unique local; só `localhost:6102` está na lista liberada.
Sondas mandadas direto para `/authorize`:

| `client_id` | log do AS | resposta |
| --- | --- | --- |
| `.../mismatch.json` (id de dentro é `.../client.json`) | `client_id in document '.../client.json' does not match the URL` | 400 `invalid_client` |
| `.../redirect.json` (302 para um documento válido) | `metadata document answered 302, redirects are not followed` | 400 |
| `.../big.json` (6 KB) | `metadata document exceeds 5120 bytes` | 400 |
| `.../slow.json` (responde depois de 5 s) | `TaskCanceledException ... HttpClient.Timeout of 2 seconds` | 400 |
| `.../secret.json` (`client_secret_post`) | `needs a shared secret, not allowed for CIMD` | 400 |
| `https://169.254.169.254/latest/meta-data/` (e `https://127.0.0.1:6102/...`) | `SSRF policy: 169.254.169.254 has no public address and is not allow-listed` | 400 |
| `https://localhost:6102/` (caminho raiz) | `client_id URL is not a valid CIMD identifier` | 400 |
| documento válido, `redirect_uri=http://localhost:9999/cb` | buscado e guardado em cache | 400 `Unregistered redirect_uri` |

Os erros voltam como corpo de um 400, nunca como redirect: enquanto o documento
não foi validado, o `redirect_uri` não é confiável. Depois da primeira busca de
`client.json` (`max-age=300`), as duas requisições seguintes bateram no cache e
o host do documento viu um único GET; duas requisições de `nocache.json` (sem
cabeçalho) deram dois GETs. O draft proíbe guardar em cache erros e documentos inválidos.

O que a busca não prova (só documentação): qualquer um publica um documento com
`http://localhost:3000/callback`, então um app malicioso local consegue se
passar por um cliente conhecido em redirects de loopback. A spec diz que o AS
DEVERIA alertar sobre redirect URIs só de localhost, PRECISA mostrar o hostname
do redirect URI e PODE exigir atestação; o draft acrescenta políticas de
confiança por domínio (lista liberada, alerta para domínio novo, hostname do
`client_id` na tela de consentimento). O AS do laboratório não tem tela de consentimento.

### Quando usar qual

| cenário | use | por quê |
| --- | --- | --- |
| App desktop ou CLI falando com qualquer servidor MCP | CIMD, com DCR de reserva | uma URL serve para todo AS que suporta CIMD; nada por usuário |
| App web SaaS com backend | CIMD com `private_key_jwt`, ou pré-registro por parceiro | cliente confidencial precisa de chave ou segredo que o AS conheça |
| AS da empresa (Entra ID, Okta, Keycloak) | pré-registro | admins aprovam cada app; CIMD e DCR costumam estar desligados |
| AS antigo que só tem DCR | DCR, persistindo o resultado por issuer | a única opção automática, depreciada na 2026-07-28 |

Livro vs hoje: guias de MCP escritos para as specs 2025-03-26 e 2025-06-18
apresentam o DCR como o jeito de obter um `client_id`. O CIMD chegou na
2025-11-25 (SEP-991) e a 2026-07-28 depreciou o DCR, então cliente novo deve começar pelo CIMD.

## Trade-offs

- **CIMD contra DCR.** O CIMD não guarda estado no AS e sobrevive a uma troca de
  AS; o DCR cria um cliente por instalação (aqui, por execução, se não
  persistir). O custo do CIMD é um host HTTPS estável e um AS disposto a buscar.
- **Buscar é superfície de ataque.** Cheque o IP discado, recuse redirects,
  limite tamanho e tempo; só a checagem de IP barrou um `client_id` apontado para `169.254.169.254`.
- **Cache contra atualização.** Um `max-age` longo economiza buscas mas atrasa a
  revogação de um redirect URI ou a rotação do `jwks_uri`; ponha teto no AS.
- **Lacunas do SDK.** Sem opção de método de autenticação e sem "perguntar ao
  usuário": capture a exceção e confira a ordem nos metadados do AS.

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
