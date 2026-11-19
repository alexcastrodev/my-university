---
version: 1.0
updatedAt: 2026-11-19
title: "Servidores MCP Chamando APIs Downstream: Token Exchange e OBO"
summary: Como um servidor MCP chama outra API em nome do usuário sem repassar o token recebido, medido sem LLM com o SDK C# 2.4.0 e Keycloak 26.8.2: o passthrough (que só funciona enquanto a API não valida aud), a credencial do próprio servidor (que perde o usuário e deixa alice ler o pedido do bob), o token exchange RFC 8693 com IHttpContextAccessor e DelegatingHandler (erros reais, upscale de escopo, HybridCache contra IMemoryCache sob concorrência, falha sem vazar detalhes ao modelo), o OBO do Entra e gateways (só docs), tokens de terceiros por usuário via elicitation em modo URL e a trilha de auditoria com traceparent.
---
## Objective

Um servidor MCP quase sempre precisa chamar outra API (um serviço de pedidos) em nome de quem chamou a tool, e a
spec proíbe o caminho fácil: repassar o token recebido. Esta lição mede as opções com três serviços meus (um servidor
MCP, uma API de pedidos que confere `aud`, Keycloak) e sem modelo: passthrough, credenciais do próprio servidor, token
exchange RFC 8693 com `IHttpContextAccessor` e um `DelegatingHandler`, seu cache e suas falhas, um cofre por usuário
para tokens de terceiros via elicitation em modo URL, auditoria e propagação de trace. O OBO do Entra ID e os
gateways são só docs. A teoria do protocolo está na lição de identidade "OAuth Token Exchange, Delegation, and
On-Behalf-Of"; esta é a parte de MCP e .NET.
Versões: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`), `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `Microsoft.Extensions.Caching.Hybrid` 10.11.0,
Data Protection do shared framework do ASP.NET Core 10.0, TFM `net10.0`, SDK 10.0.100, spec 2026-07-28.

## Use Cases

- Uma tool MCP que lê ou escreve numa API interna e precisa respeitar o que cada usuário pode ver.
- Deixar uma tool usar uma conta de terceiros (um host de código) com que o usuário consente uma vez.

## Deep Dive

### O laboratório e a regra

`mcp-client` (público), `mcp-server` (confidencial, porta 6522, `aud` = `http://localhost:6522/mcp`), `orders-api`
(6523, `ValidAudience = orders-api`) e um realm do Keycloak com alice e bob. A alice é dona do pedido 1, o bob do
pedido 2; a API responde 200 ao dono ou a um token cujo `scope` tenha `orders:admin`. A spec: o servidor "MUST NOT
pass through the token it received from the MCP client"; o token do upstream é "a separate token, issued by the
upstream authorization server". Uma tool só; muda apenas o `DelegatingHandler` do seu `HttpClient`:

```csharp
[McpServerTool(Name = "get_order"), Description("Returns an order by id.")]
public async Task<string> GetOrder(int orderId, CancellationToken ct)
{   using var resp = await f.CreateClient("orders").GetAsync($"/orders/{orderId}", ct);
    return resp.IsSuccessStatusCode ? await resp.Content.ReadAsStringAsync(ct)
        : throw new McpException($"the orders service refused the request ({(int)resp.StatusCode})"); }
```

### 1. Passthrough: só funciona enquanto a API downstream for descuidada

```csharp
r.Headers.Authorization = AuthenticationHeaderValue.Parse(acc.HttpContext!.Request.Headers.Authorization.ToString()); // ANTIPATTERN
```

O token da alice tem `aud=[http://localhost:6522/mcp, mcp-server]`. Um `get_order` pelo servidor com passthrough:

```text
orders API checks aud, alice's usual token:            IsError=True "... refused the request (401)"
orders API checks aud, token that also has orders-api: "order 1: 2 x keyboard (owner alice)"   (aud=orders-api,http://localhost:6522/mcp,mcp-server)
orders API ValidateAudience=false, usual token:        "order 1: 2 x keyboard (owner alice)"
```

Reenviados direto para a API, o token do servidor MCP e o de outro cliente (sem `aud`) deram 200 com
`ValidateAudience=false` e 401 com a checagem ligada. O passthrough quebra para tokens honestos e só "funciona"
porque a API aceita qualquer token do realm, inclusive um que um servidor MCP comprometido guarda. Um token com as
duas audiences serve direto na API: esse é o dano. O log da API mostra `azp=mcp-client`.

### 2. A credencial do próprio servidor: funciona, e perde o usuário

Um handler pede `client_credentials` com `scope=orders:admin` e guarda o token em cache:

```text
alice get_order:1 -> "order 1: 2 x keyboard (owner alice)"
alice get_order:2 -> "order 2: 1 x monitor (owner bob)"        <- bob's data
bob   get_order:1 -> "order 1: 2 x keyboard (owner alice)"      <- alice's data
orders-api GET /orders/2 sub=f9423776 azp=mcp-server aud=orders-api scope=[orders:admin] -> 200
```

Um token só (`clientCredentials=1` para três chamadas) e a API enxerga apenas a conta de serviço: sem usuário, sem
regra por usuário. A autorização foi para o código do servidor MCP, onde um `if` esquecido ou um argumento vindo de
prompt injection vira um confused deputy (a alice lê o pedido do bob). Serve para dados que não são por usuário.

### 3. Token exchange (RFC 8693) com Keycloak

O standard token exchange é suportado desde o Keycloak 26.2 (2025-04-11) e vem ligado por padrão na 26.8.2; o client
que troca precisa ser confidencial e ter a chave ligada (`standard.token.exchange.enabled`). Dois detalhes de setup:

- o subject token precisa ter o client solicitante em `aud`: um Audience mapper em `mcp:tools` acrescenta a URL do MCP (o que a spec MCP valida) e `mcp-server` (o que o Keycloak exige);
- a audience de destino precisa vir por um scope: `orders-api` é um Audience mapper no scope opcional `orders:read`.

```text
curl .../token -u mcp-server:mcp-secret -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token=$ALICE -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d audience=orders-api -d scope=orders:read
user token:      sub=11111111 aud=[http://localhost:6522/mcp, mcp-server] azp=mcp-client scope="openid mcp:tools"
exchanged token: sub=11111111 aud=orders-api azp=mcp-server scope=orders:read expires_in=300   (no act claim)
```

O usuário continua em `sub`, a audience downstream é a única e `azp` diz quem agiu. Falhas medidas, do mesmo endpoint:

| requisição | resposta |
| --- | --- |
| sem `scope` | 400 `invalid_request`: "Requested audience not available: orders-api" |
| `audience` desconhecida | 400 `invalid_client`: "Audience not found" |
| secret do client errado | 401 `unauthorized_client` |
| subject token de outro client (sem `mcp-server` em `aud`) | 403 `access_denied`: "Client is not within the token audience" |
| `scope=orders:read orders:admin` | 200, o token tem os dois escopos |
| subject token depois de encerrar as sessões do usuário | 400 "Invalid token" |

A linha do upscale importa: o client que troca pode pedir qualquer um dos seus scopes opcionais, então o usuário
nunca consentiu com `orders:admin` e mesmo assim recebeu; a doc restringe isso com a client policy
`downscope-assertion-grant-enforcer` (só docs). Delegação com `act` é outra feature em preview
(`token-exchange-delegation`, um `actor_token`), não medida aqui. Depois de encerradas as sessões, a introspecção
mostrou o token trocado antes como `active: false`, mas uma API que valida o JWT offline o aceita até o `exp`;
mantenha o cache curto.

### O lado .NET: accessor, handler, cache

```csharp
public sealed class TokenExchangeHandler(IHttpContextAccessor acc, HybridCache cache, IHttpClientFactory f) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
    {
        var http = acc.HttpContext ?? throw new InvalidOperationException("no current MCP request"); // none on stdio
        var subject = http.Request.Headers.Authorization.ToString()["Bearer ".Length..];
        var key = $"xchg|{http.User.FindFirst("sub")!.Value}|orders-api";
        var token = await cache.GetOrCreateAsync(key, c => new ValueTask<string>(Exchange(subject, c)),
            new HybridCacheEntryOptions { Expiration = TimeSpan.FromSeconds(60), Flags = HybridCacheEntryFlags.DisableDistributedCache },
            cancellationToken: ct);
        r.Headers.Authorization = new("Bearer", token);
        return await base.SendAsync(r, ct);
    }
    // Exchange(): POST the form above plus client_id/client_secret; non-2xx throws TokenExchangeException
}   // AddHttpContextAccessor(); AddHybridCache(); AddHttpClient("orders", ...).AddHttpMessageHandler<TokenExchangeHandler>();
```

O `IHttpContextAccessor` é o caminho da lição de filtros até o request atual. A chave é `sub` mais a audience de
destino (acrescente `iss` ou `tid` com vários tenants), com vida bem abaixo dos 300 s do token. Com `TTL=3`:

```text
                                      IMemoryCache (TryGetValue, call, Set)   HybridCache.GetOrCreateAsync
10 concurrent calls, empty cache      exchanges=10                            exchanges=1
one call after the TTL (3 s)          exchanges=11                            exchanges=2
first call of bob                     exchanges=12                            exchanges=3
```

Só com `IMemoryCache`, dez primeiras chamadas simultâneas batem todas no Keycloak; o `HybridCache` roda uma factory
por chave e as outras esperam. Quando a troca falha, o modelo não pode ler a resposta do endpoint de token
(`SECRET=bad`):

```csharp
catch (Exception e) when (e is TokenExchangeException or HttpRequestException)
{ var id = Guid.NewGuid().ToString("N")[..8]; log.LogWarning("ref={Ref} {E}", id, e.Message);
  throw new McpException($"the orders service is unavailable, reference {id}"); }
```

```text
client sees: IsError=True "An error occurred invoking 'get_order': the orders service is unavailable, reference d4012592"
server log:  ref=d4012592 TokenExchangeException: token endpoint 401: {"error":"unauthorized_client","error_description":"Invalid client or Invalid client credentials"}
```

A referência liga as duas pontas (o filtro que padroniza exceções da lição de filtros faz o mesmo). Um 401 ou 403 da
API downstream devolve só o status: a alice pedindo o pedido 2 recebeu `refused the request (403)`.

### 4. OBO do Entra ID (só docs)

Sem tenant aqui. O OBO do Entra é um grant próprio, não o RFC 8693: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
o token recebido como `assertion`, `requested_token_use=on_behalf_of` e o `scope` downstream. Segundo a página do Learn:

- a `aud` da assertion precisa ser a camada intermediária ("Applications can't redeem a token for a different app"), um client confidencial; o Microsoft.Identity.Web esconde a chamada:

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration, "AzureAd")
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddDownstreamApi("Orders", builder.Configuration.GetSection("Orders"))   // BaseUrl + Scopes (an array)
    .AddInMemoryTokenCaches();
// in the tool: await downstreamApi.CallApiForUserAsync("Orders", o => o.RelativePath = "orders/1");  (or ITokenAcquisition.GetAccessTokenForUserAsync)
```

- não há interação com o usuário, então o consentimento vem antes: `knownClientApplications` com `.default`, aplicações pré-autorizadas ou consentimento do administrador. O OBO usa só escopos delegados, nunca app roles;
- Conditional Access (MFA, frequência de login) na API downstream devolve `interaction_required` com um valor em `claims`; a camada intermediária precisa responder 401 com `WWW-Authenticate` carregando o claims challenge para o chamador reautorizar. No MCP isso é o step-up da lição de filtros;
- `Scopes` precisa ser um array na configuração, senão o `IDownstreamApi` chama sem autenticação e recebe 401.

### 5. Uma conta de terceiros com que o usuário consente

Um host de código não é o seu AS, então não há o que trocar: o usuário consente uma vez, fora do cliente MCP, e o
servidor guarda o token por usuário. A lição de MRTR mediu o modo URL; `list_repos` lança `InputRequiredException`
com `Mode = "url"` quando não há token para o chamador:

```csharp
var flow = dp.CreateProtector("flow").ToTimeLimitedDataProtector().Protect(sub, TimeSpan.FromMinutes(10));
throw new InputRequiredException(new Dictionary<string, InputRequest> { ["consent"] = InputRequest.ForElicitation(
    new ElicitRequestParams { Mode = "url", Message = "Connect your code host account.",
        Url = $"https://mcp.example.com/connect/github?flow={Uri.EscapeDataString(flow)}" }) });
// ThirdPartyTokens: (sub, provider) -> (IDataProtector.Protect(token), expiresAt); Save, Get, Revoke
```

```text
alice list_repos: [handler] mode=url message="Connect your code host account." url=http://127.0.0.1:6522/connect/github?flow=CfDJ8CNx...
                  [browser] GET consent page -> connected
                  IsError= "repos of token gho_1111_f2...: [alpha, beta]"          (same CallToolAsync)
alice list_repos again: no handler call;  bob list_repos: asks again (own consent), token gho_2222_c1...
store blob for alice: CfDJ8CNxsmSr6TxIvG4iGAQCOKi8v8Vey4Je7v5m... len=155, contains "gho_": 0
DELETE /connections/github as alice: 204 (again: 404), next call asks for consent; TP_TTL=4, after 5 s: asks again
forged ?flow=CfDJ8forged: 400 "invalid or expired flow"
```

O handler do cliente viu uma URL e uma mensagem, nunca um token. Produção precisa do que o laboratório pula: uma
página de consentimento que autentica o usuário e confere o `sub` com o de `flow` (senão o link sozinho amarra um
token à alice), a troca de código real do provedor, um repositório durável com key ring do Data Protection
compartilhado e refresh. A spec pede armazenamento seguro de tokens "cached or logged on the server".

### 6. Um gateway na frente (só docs)

Um proxy reverso (transforms do YARP, políticas do Azure API Management) valida o token do MCP, troca o
`Authorization` e injeta a credencial downstream (managed identity, token trocado, API key): o servidor MCP não guarda
segredo downstream e a política fica num lugar só. Repassar o header recebido é passthrough de novo, e sempre injetar
uma credencial de serviço é a abordagem 2, mudada de lugar.

### 7. Auditoria e propagação de trace

O filtro de call-tool da lição de filtros registra o usuário, o cliente MCP (`azp` do token recebido), a tool e o
resultado. O cliente abriu uma `Activity` e o `HttpClient` enviou `traceparent`; o ASP.NET Core o adotou no servidor
MCP e o `HttpClient` do handler o repassou, sem código:

```text
audit tool=get_order sub=11111111 client=mcp-client trace=b726e12e ok=True
orders-api GET /orders/1 sub=11111111 azp=mcp-server aud=orders-api scope=[orders:read] trace=b726e12e traceparent=b726e12e -> 200
audit tool=get_order sub=11111111 client=mcp-client trace=48da4444 McpException          (order 2: the API said 403)
```

Grave `sub`, cliente MCP, tool, argumentos relevantes (sem segredos) e trace id no lado MCP; a API tem `sub` e
`azp=mcp-server`, e o trace id junta os dois. Lacunas: a API não conhece a tool nem o cliente MCP, e na 2.4.0 uma
chamada `[Authorize]` negada não chega a um filtro comum de call-tool (use um message filter).

### Como escolher

| Abordagem | Identidade do usuário preservada | Risco | Quando usar |
| --- | --- | --- | --- |
| Passthrough | sim, mas com audience errada | proibido; quebra com checagem de `aud`, vaza tokens utilizáveis | nunca |
| Client credentials do servidor | não | confused deputy, uma credencial ampla | dados que não são por usuário, jobs |
| Exchange RFC 8693 (Keycloak) | sim (`sub`), `azp` nomeia o servidor | upscale por padrão, cache sobrevive às sessões, setup de audiences | um AS que você controla, regras por usuário na API |
| OBO do Entra (só docs) | sim | consentimento configurado antes, claims challenge | tenant Entra, downstream protegido pelo Entra |
| Elicitation em modo URL + cofre de tokens | sim, por usuário e provedor | você guarda tokens de terceiros | APIs fora do seu AS (host de código, agenda) |
| Gateway injeta credenciais | depende da política | passthrough ou credencial de serviço disfarçados | muitas APIs, política central |

## Trade-offs

- **Troca a cada chamada vs cache.** O cache tira uma ida ao AS e a debandada, mas uma sessão revogada continua valendo até a entrada expirar; o laboratório usou 60 segundos.
- **Identidade do usuário vs downstream simples.** O exchange põe o usuário em `sub` para a API aplicar as próprias regras, ao custo de setup no AS (audiences, scopes, client policy); uma credencial de serviço são duas linhas e leva toda regra para o código das tools.
- **Guardar tokens de terceiros.** O consentimento em modo URL os mantém longe do cliente, e agora seu servidor é um cofre: criptografe, expire e permita revogar.

## Documentation Links

- [Authorization Security Considerations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (doc)
- [Security Best Practices, token passthrough, modelcontextprotocol.io](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) (doc)
- [Elicitation, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) (doc)
- [OAuth 2.0 Token Exchange, RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) (doc)
- [Configuring and using standard token exchange, Keycloak](https://www.keycloak.org/securing-apps/token-exchange) (doc)
- [Standard Token Exchange is now officially supported in Keycloak 26.2, Keycloak blog](https://www.keycloak.org/2025/05/standard-token-exchange-kc-26-2) (doc)
- [Microsoft identity platform and OAuth 2.0 On-Behalf-Of flow, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow) (doc)
- [Configure a web API that calls web APIs, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-web-api-call-api-app-configuration) (doc)
- [HybridCache library in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid) (doc)
- [Request and response transforms, YARP](https://microsoft.github.io/reverse-proxy/articles/transforms.html) (doc)
- [Secure access to MCP servers in Azure API Management, Microsoft Learn](https://learn.microsoft.com/en-us/azure/api-management/secure-mcp-servers) (doc)
