---
version: 1.0
updatedAt: 2026-10-28
title: "OpenID Connect, Entra ID e o padrão BFF"
summary: Login com OpenID Connect no ASP.NET Core (code flow com PKCE, PAR, cookie como sessão, SaveTokens, mapeamento de claims, logout e as falhas Correlation failed e message.State), proteção de API com Microsoft.Identity.Web (audiência, issuer, scp versus roles, tokens v1 e v2) e o padrão BFF para SPAs, verificados contra um provedor OpenID local.
---
## Objective

Um app no navegador não deve ver senha, e uma API não deve confiar num nome de usuário digitado num formulário: o usuário faz login num provedor de identidade, o app web recebe a prova via OpenID Connect (OIDC) e a API aceita apenas access tokens emitidos para ela. No ASP.NET Core isso são duas camadas. `AddOpenIdConnect` mais `AddCookie` executam o authorization code flow com PKCE e guardam a sessão num cookie; `Microsoft.Identity.Web` envolve os mesmos handlers para o Microsoft Entra ID e acrescenta as regras do Entra (audiência, issuer por tenant, `scp` versus `roles`, obtenção de tokens para APIs downstream). Para single-page apps, o padrão backend-for-frontend (BFF) mantém todos os tokens no servidor. Este conceito parte das lições de [fundamentos](authentication-and-authorization-fundamentals) e de [JWT bearer](jwt-bearer-and-aspnet-core-identity) e não as repete. Eu não tinha um tenant Entra real, então escrevi um pequeno provedor OpenID local, apontei as duas bibliotecas para ele e percorri cada redirect com um `HttpClient`. As partes exclusivas do Entra (registro no portal, consentimento, a autoridade real `https://login.microsoftonline.com/<tenant>/v2.0`) vêm da documentação e são atribuídas a ela. Versões usadas: SDK 10.0.100, `Microsoft.AspNetCore.Authentication.OpenIdConnect` 10.0.14, `Microsoft.Identity.Web` 4.16.1 (que trouxe `Microsoft.IdentityModel.*` 8.23.0 e o MSAL `Microsoft.Identity.Client` 4.90.1).

## Use Cases

- Um app renderizado no servidor (Razor Pages, MVC, Blazor Server) em que os funcionários entram com a conta do Entra ID.
- Uma API que aceita access tokens do Entra vindos de apps com usuário (`scp` delegado) e de daemons (`roles` de aplicação) no mesmo endpoint.
- Uma SPA em React ou Angular servida por um host ASP.NET Core que precisa chamar APIs protegidas sem nunca guardar um token no JavaScript.
- Diagnosticar `Correlation failed.` ou `Unable to unprotect the message.State.` depois de colocar o app atrás de um load balancer ou escalar para várias réplicas.

## Deep Dive

### O laboratório: um substituto local do Entra

Um único processo de console sobe quatro apps Kestrel em HTTPS (certificado de desenvolvimento): um provedor OpenID local na 5651 com URLs no formato do Entra (`/{tenant}/v2.0/...`), o app web/BFF na 5652, uma API protegida por `Microsoft.Identity.Web` na 5653 e uma segunda instância do app web na 5654. O provedor são alguns endpoints de minimal API: discovery, um JWKS com uma chave RSA, um endpoint `authorize` sem tela de login, um endpoint `token` que confere o PKCE e devolve um `id_token` e um `access_token` assinados, além de `userinfo`, `logout` e um `par` opcional. Todos os segredos são strings falsas. O cliente que percorre o fluxo usa `new HttpClientHandler { CookieContainer = jar, AllowAutoRedirect = false }` e imprime cada salto.

### Configuração: o cookie é a sessão, o OIDC só faz o challenge

```csharp
builder.Services.AddAuthentication(o =>
{
    o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    o.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
})
.AddCookie(o => o.Cookie.Name = "__Host-bff")
.AddOpenIdConnect(o =>
{
    o.Authority = "https://localhost:5651/<tenant>/v2.0"; // Entra: https://login.microsoftonline.com/<tenant>/v2.0
    o.ClientId = "<web-client-id>";
    o.ClientSecret = "<from user-secrets or Key Vault>";
    o.ResponseType = "code";
    o.SaveTokens = true;
    o.GetClaimsFromUserInfoEndpoint = true;
    o.Scope.Add("offline_access");
    o.Scope.Add("api://<api-client-id>/access_as_user");
    o.MapInboundClaims = false;
    o.TokenValidationParameters.NameClaimType = "name";
});
```

Os endpoints vêm de `{Authority}/.well-known/openid-configuration`. Um `OpenIdConnectOptions` recém-criado mostra por que `ResponseType = "code"` precisa ser definido: o padrão ainda é `id_token`, não o code flow que a documentação recomenda, e `UsePkce` só vale para code.

```text
ResponseType=id_token ResponseMode=form_post UsePkce=True PAR=UseIfAvailable MapInboundClaims=True SaveTokens=False GetClaimsFromUserInfoEndpoint=False
Scope=openid profile RemoteAuthenticationTimeout=00:15:00 CallbackPath=/signin-oidc SignedOutCallbackPath=/signout-callback-oidc
```

### O que o redirect do challenge realmente contém

Um `GET /me` anônimo (com o provedor sem anunciar PAR):

```text
GET https://localhost:5652/me -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/authorize
    client_id = aaaaaaaa-0000-0000-0000-00000000000a
    redirect_uri = https://localhost:5652/signin-oidc
    response_type = code
    scope = openid profile offline_access api://bbbbbbbb-0000-0000-0000-0000000000...
    code_challenge = Q2wJ0qkfIiohAkPvx7-FZ3QUhaulpetIc-sGMeuZzDs
    code_challenge_method = S256
    response_mode = form_post
    nonce = 639287987807274850.Y2VmMWJkYTItNmY4ZS00OTVmLThiNzgtYjhiNjc3ZGNhYTIwYTg...
    state = CfDJ8Bpa4M6axNlNppikrVZHS9svLknz2m1wltYza-4wcjE0gWPjas4HeOo5L-eVNwaQzE...
    x-client-SKU = ID_NET10_0
    x-client-ver = 8.23.0.0
  Set-Cookie: .AspNetCore.OpenIdConnect.Nonce.CfDJ8Bpa... (1 chars); expires=Wed, 28 Oct 2026 15:54:40 GMT; path=/signin-oidc; secure; samesite=none; httponly
  Set-Cookie: .AspNetCore.Correlation.WSwaXOVT7DqtDRU9... (1 chars); expires=Wed, 28 Oct 2026 15:54:40 GMT; path=/signin-oidc; secure; samesite=none; httponly
```

`code_challenge` é o SHA-256 de um `code_verifier` secreto que o handler guarda. `state` começa com `CfDJ8`, o cabeçalho do Data Protection: são as `AuthenticationProperties` criptografadas (URL de retorno, o verifier, um id de correlação). O `nonce` vai voltar dentro do id_token. Os dois cookies, válidos por 15 minutos (`RemoteAuthenticationTimeout`), são `SameSite=None; Secure` porque o provedor devolve a resposta com um POST cross-site (`response_mode=form_post`).

### O callback: PKCE, troca do code e login no cookie

```text
GET authorize -> 200
  form_post to https://localhost:5652/signin-oidc with fields: code, state
  [idp] POST /token body: client_id, client_secret, code, grant_type, redirect_uri, code_verifier
  [idp] PKCE S256(code_verifier) == code_challenge: True; redirect_uri matches: True
POST /signin-oidc -> 302
  Location: /me
  Set-Cookie: .AspNetCore.Correlation.WSwaXOVT7DqtDRU9... (0 chars); expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/signin-oidc; secure; samesite=none; httponly
  Set-Cookie: __Host-bff=chunks-2 (8 chars); path=/; secure; samesite=lax; httponly
  Set-Cookie: __Host-bffC1=CfDJ8Bpa4M6axNlNppikrVZHS9t... (3996 chars); path=/; secure; samesite=lax; httponly
  Set-Cookie: __Host-bffC2=h6Lc3XuJ-4J9rnO4Hca1Y5CHaOP... (127 chars); path=/; secure; samesite=lax; httponly
```

O handler validou o `state` e o cookie de correlação, trocou o code pelo canal de back-end com o segredo e o verifier (um code roubado não serve sem os dois), validou assinatura, issuer, audiência e nonce do id_token e então fez o sign-in no esquema de cookie. Daí em diante cada requisição é autenticada só pelo cookie; o provedor não é mais consultado.

### PAR é usado por padrão desde o .NET 9

A documentação diz que Pushed Authorization Requests (RFC 9126) são usados por padrão quando o servidor oferece suporte. Adicionei `pushed_authorization_request_endpoint` ao documento de discovery e repeti a mesma requisição:

```text
  [idp] POST /par body: client_id, redirect_uri, response_type, scope, code_challenge, code_challenge_method, response_mode, nonce, state, client_secret
GET https://localhost:5652/me -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/authorize
    client_id = aaaaaaaa-0000-0000-0000-00000000000a
    request_uri = urn:ietf:params:oauth:request_uri:70915645
```

Confirmado: sem mudar código, os parâmetros foram por um POST autenticado no back-channel e a URL do navegador levou só `client_id` e `request_uri`. `PushedAuthorizationBehavior.Require` falha se o servidor não tiver endpoint de PAR; `Disable` desliga o recurso.

### SaveTokens e GetTokenAsync

```text
stored tokens: access_token(874), id_token(1027), refresh_token(21), token_type(6), expires_at(33)
access_token via GetTokenAsync is a JWT: True
```

`await HttpContext.GetTokenAsync("access_token")` lê os tokens das propriedades de autenticação, que ficam dentro do cookie criptografado. O preço é o tamanho: com `SaveTokens = false` o cookie era um único valor de 1264 caracteres; com os tokens passou de 4 KB e o gerenciador de cookies o dividiu em `__Host-bffC1` e `C2`. Toda requisição carrega esses bytes, e tokens reais do Entra são maiores que os meus. `SaveTokens` também não renova nada: quando `expires_at` passa, usar o refresh token é trabalho do seu código (ou do cache de tokens do `Microsoft.Identity.Web`, mais abaixo).

### Claims: MapInboundClaims, sub e o nome

Com `MapInboundClaims = false` e `NameClaimType = "name"`, o `/me` imprimiu as claims como vieram, mais o `email` do endpoint userinfo:

```text
Identity.Name=Ana Silva
  sub = pairwise-sub-ana
  oid = oid-ana
  tid = 11111111-2222-3333-4444-555555555555
  name = Ana Silva
  preferred_username = ana@contoso.example
  sid = session-1
  email = ana@contoso.example
```

As claims de protocolo (`nonce`, `aud`, `iss`, `iat`, `exp`, `ver`) foram removidas pelas claim actions padrão, e o campo `website` do userinfo foi descartado porque só chaves mapeadas são copiadas (`ClaimActions.MapUniqueJsonKey("website", "website")` o inclui). Com o padrão `MapInboundClaims = true`, `sub` virou `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`, `oid` e `tid` viraram URIs `http://schemas.microsoft.com/identity/claims/...`, `name` continuou `name` e `Identity.Name` ficou vazio porque o `NameClaimType` padrão é a URI longa. É a mesma armadilha da lição de JWT, agora no handler de cookie. No Entra o `sub` é pairwise (diferente por app), por isso a documentação usa `oid` mais `tid` como chave estável do usuário.

### Logout: iniciado pelo app e front-channel

`/logout` devolve `Results.SignOut(new() { RedirectUri = "/signed-out" }, [CookieAuthenticationDefaults.AuthenticationScheme, OpenIdConnectDefaults.AuthenticationScheme])`:

```text
GET /logout -> 302
  Location: https://localhost:5651/11111111-2222-3333-4444-555555555555/v2.0/logout
    post_logout_redirect_uri = https://localhost:5652/signout-callback-oidc
    id_token_hint = eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIiwidHlwIjoiSldUIn0...
  Set-Cookie: __Host-bff= (0 chars); expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=lax; httponly
GET idp logout -> 302
  Location: https://localhost:5652/signout-callback-oidc
GET signout-callback -> 302
  Location: /signed-out
```

Fazer sign-out só do esquema de cookie deixaria viva a sessão no provedor, e o próximo challenge logaria o usuário de novo sem pedir nada. O id_token usado em `id_token_hint` veio do `SaveTokens`. Segundo a documentação, o Entra recusa a volta se a URI de callback não estiver registrada. O handler também atende o logout front-channel em `RemoteSignOutPath` (`/signout-oidc`): uma requisição com `iss` e `sid` corretos apagou o cookie (o `/me` depois deu 302), e um `sid` diferente não mudou nada (200). No navegador essa requisição vem de um iframe cross-site, que não leva um cookie `SameSite=Lax`, então não dependa só dela.

### Correlation failed e Unable to unprotect the message.State

```text
  [A] AuthenticationFailureException: An error was encountered while handling the remote login. | inner: Correlation failed.
callback without the correlation cookie -> 500
  [B] AuthenticationFailureException: An error was encountered while handling the remote login. | inner: Unable to unprotect the message.State.
callback delivered to instance B (shared keys: False) -> 500
callback delivered to instance B (shared keys: True) -> 302 /me
```

`Correlation failed.` aparece quando o navegador não devolve o cookie de correlação: login expirado (mais de 15 minutos), outro nome de host ou um cookie `Secure` gravado sobre HTTP puro. `Unable to unprotect the message.State.` aparece quando a instância que recebe o callback não consegue descriptografar o `state`, tipicamente duas réplicas com key rings separados; quando as duas usaram o mesmo diretório e o mesmo nome de aplicação, o callback funcionou. Configure isso como mostrado em [Data Protection](data-protection-key-ring-and-purposes). Atrás de um proxy que termina o TLS, o handler monta o `redirect_uri` a partir da requisição que enxerga:

```text
port 5655 UseForwardedHeaders=False: redirect_uri=http://localhost:5655/signin-oidc
port 5656 UseForwardedHeaders=True: redirect_uri=https://app.contoso.example/signin-oidc
```

O primeiro valor seria rejeitado pelo Entra por não estar registrado, e o cookie de correlação que ele grava continua `secure` sobre HTTP, o que o navegador descarta. `UseForwardedHeaders` precisa rodar antes da autenticação.

### Protegendo a API com Microsoft.Identity.Web

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

app.MapGet("/orders", ...).RequireAuthorization().RequireScope("access_as_user");
app.MapGet("/orders/all", ...).RequireAuthorization()
   .RequireScopeOrAppPermission(["access_as_user"], ["Orders.Read.All"]);
app.MapGet("/admin", ...).RequireAuthorization(p => p.RequireRole("Orders.Admin"));
```

A seção `AzureAd` contém `Instance` (`https://login.microsoftonline.com/` no Entra, `https://localhost:5651/` aqui), `TenantId` e `ClientId`; `Instance` + `TenantId` + `/v2.0` virou a autoridade. As opções configuradas mostraram `MapInboundClaims=True`, nenhum `ValidAudiences`, `IssuerValidator=AadIssuerValidator` e o `NameClaimType` em formato de URI. Assinei tokens com a chave do provedor:

```text
v2 user token, scp access_as_user                /orders      200 orders for  (oid oid-x, scp access_as_user)
aud api://<clientId>                             /orders      401  Bearer error="invalid_token", error_description="The audience '(null)' is invalid"
aud another-api                                  /orders      401  Bearer error="invalid_token", error_description="The audience '(null)' is invalid"
scp Orders.Write only                            /orders      403
app-only token, roles Orders.Read.All            /orders      403
app-only token, roles Orders.Read.All            /orders/all  200 all orders
user token, roles Orders.Admin                   /admin       200 admin
other tenant (iss and tid)                       /orders      401  Bearer error="invalid_token", error_description="The issuer '(null)' is invalid"
```

Audiência e issuer vêm das convenções do Entra, não de configurações que eu escrevi. Escopo ausente é 403 depois da autenticação; a documentação de autorização do Microsoft.Identity.Web mostra um corpo JSON com `insufficient_scope`, mas o `RequireScope` de minimal API devolveu um 403 vazio na 4.16.1. Dois detalhes: a claim `scp` chegou renomeada para `http://schemas.microsoft.com/identity/claims/scope`, e `Identity.Name` ficou vazio ("orders for  ") porque a claim `name` de um token v2 não é mapeada para o tipo de nome em URI. Depois de `builder.Services.Configure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o => o.TokenValidationParameters.NameClaimType = "name")` a resposta passou a ser `orders for Caller`.

### Access tokens v1 e v2

Segundo a documentação do Entra, quem decide o formato é o registro da API: `requestedAccessTokenVersion` no manifesto (`accessTokenAcceptedVersion` em manifestos mais antigos), em que `null` ou `1` gera tokens v1 mesmo que o cliente tenha usado o endpoint v2. Um token v1 tem `iss=https://sts.windows.net/<tid>/` e normalmente `aud=api://<clientId>`. Meu primeiro teste v1 falhou com 401; depois que adicionei o documento de discovery v1 (`/{tenant}/.well-known/openid-configuration`), o log do provedor mostrou o `AadIssuerValidator` buscando esse documento e o token passou:

```text
v1 issuer sts.windows.net, ver 1.0               /orders      200 orders for  (oid oid-x, scp access_as_user)
v1-shaped token at v2 issuer                     /orders      200 orders for  (oid oid-x, scp access_as_user)
```

Os dois tokens levavam `aud=api://<clientId>`, que só foi aceito quando `ver` era 1.0 (o token `ver 2.0` com essa audiência levou 401 acima). Definir a versão 2 no manifesto dá um formato único e previsível.

### Apps web com Microsoft.Identity.Web e chamadas a APIs downstream

`AddMicrosoftIdentityWebApp` contra o mesmo provedor definiu `NameClaimType=preferred_username` (o `/me` imprimiu `Name=ana@contoso.example`) e fez o challenge com `response_type=id_token` e sem PKCE. Depois de adicionar um client secret e `.EnableTokenAcquisitionToCallDownstreamApi([...]).AddInMemoryTokenCaches()`, o challenge mudou para `response_type=code` com `code_challenge` e `offline_access`, e o MSAL assumiu a troca do code. É aí que o substituto local para: o MSAL validou a autoridade desconhecida com a Microsoft e falhou com `MsalServiceException: AADSTS50049: Unknown or invalid instance.` O resto vem da documentação: `AddDownstreamApis(config.GetSection("DownstreamApis"))` registra APIs nomeadas (`BaseUrl`, `Scopes`) e `IDownstreamApi.GetForUserAsync<T>("OrdersApi", o => o.RelativePath = "orders")` chama uma delas em nome do usuário, com o MSAL guardando e renovando tokens. `ITokenAcquisition.GetAccessTokenForUserAsync(scopes)` entrega o token cru, `AddMicrosoftGraph` (pacote `Microsoft.Identity.Web.GraphServiceClient`) entrega um `GraphServiceClient`, e `[AuthorizeForScopes]` transforma uma `MicrosoftIdentityWebChallengeUserException` (consentimento ou MFA necessário) num novo challenge. Segundo a documentação, uma API que chama outra API usa as mesmas chamadas `...ForUserAsync`, que então executam o fluxo on-behalf-of. A documentação recomenda `AddDistributedTokenCaches()` em produção, porque o cache em memória é por instância e se perde no restart.

### O padrão BFF para SPAs

A SPA é servida pelo BFF e só conversa com o BFF; o BFF guarda os tokens na sessão e chama a API:

```csharp
app.MapGet("/bff/orders", async (HttpContext ctx, IHttpClientFactory f) =>
{
    var req = new HttpRequestMessage(HttpMethod.Get, "https://localhost:5653/orders");
    req.Headers.Authorization = new("Bearer", await ctx.GetTokenAsync("access_token"));
    var res = await f.CreateClient().SendAsync(req);
    return Results.Text(await res.Content.ReadAsStringAsync(), statusCode: (int)res.StatusCode);
}).RequireAuthorization().AddEndpointFilter(async (c, next) =>
    c.HttpContext.Request.Headers["X-CSRF"] == "1" ? await next(c) : Results.Problem("missing X-CSRF header", statusCode: 400));
```

```text
cookies the browser holds for :5652: __Host-bff(HttpOnly=True), __Host-bffC1(HttpOnly=True), __Host-bffC2(HttpOnly=True)
GET /bff/orders, no cookie -> 401
GET /bff/orders, cookie, no X-CSRF -> 400
  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"Bad Request","status":400,"detail":"missing X-CSRF header"}
GET /bff/orders, cookie + X-CSRF -> 200 orders for  (oid oid-ana, scp access_as_user)
```

Sem o evento `OnRedirectToIdentityProvider` que define 401 e chama `HandleResponse()` para caminhos `/bff`, o `fetch` receberia um 302 para o provedor que não consegue seguir (o evento ainda deixou o handler gravar os cookies de nonce e de correlação). O navegador tem só um cookie `HttpOnly` criptografado, então um XSS não consegue roubar token. O cabeçalho customizado é a defesa contra CSRF: um formulário de outro site não consegue adicioná-lo, e um `fetch` cross-origin com ele exige um preflight de CORS que o BFF não permite. A documentação não recomenda mais clientes públicos OIDC no navegador e aponta para a RFC 10017; o YARP pode encaminhar `/api/*` com o token anexado no lugar de endpoints escritos à mão.

## Trade-offs

- **BFF versus tokens no navegador.** O BFF tira os tokens do JavaScript, então um bug de XSS só consegue abusar da sessão enquanto a página está aberta, em vez de exfiltrar um token, ao custo de um salto a mais no servidor em cada chamada e de um deploy no mesmo site.
- **SaveTokens versus cache de tokens.** Tokens no cookie não exigem estado no servidor, mas deixam cada requisição mais pesada e a renovação por sua conta; `Microsoft.Identity.Web` com cache de tokens distribuído mantém o cookie pequeno e renova, mas precisa de Redis ou SQL.
- **OIDC puro versus Microsoft.Identity.Web.** Os handlers puros funcionam com qualquer provedor e a documentação os prefere quando um app fala com vários provedores; `Microsoft.Identity.Web` traz as regras de audiência, issuer e tokens do Entra e o MSAL, mas muda padrões (`preferred_username`, `id_token` sem credenciais) e não aceita uma autoridade fora do Entra para obter tokens.
- **Claims mapeadas ou cruas.** Escolha uma opção por app, defina `NameClaimType` (e `RoleClaimType`) explicitamente no app web e na API e teste um endpoint protegido.
- **Escalar tem pré-requisitos.** Chaves de Data Protection compartilhadas, forwarded headers e cache de tokens distribuído são necessários antes da segunda réplica, não depois do primeiro `Correlation failed.`
- **Escopos e roles respondem perguntas diferentes.** `scp` diz o que o app cliente pode fazer pelo usuário; `roles` dizem o que um app ou usuário tem permissão de fazer. Use `RequireScopeOrAppPermission` só onde os dois tipos de chamador são esperados.

## Documentation Links

- [Configure OpenID Connect Web (UI) authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-oidc-web-authentication?view=aspnetcore-10.0) (doc)
- [Quickstart: Protect an ASP.NET Core Web API, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/getting-started/quickstart-webapi) (doc)
- [Implement authorization in web APIs with Microsoft.Identity.Web, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/authentication/authorization) (doc)
- [Call downstream APIs from web apps, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msidweb/call-downstream-apis/from-web-apps) (doc)
- [Access tokens in the Microsoft identity platform, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) (doc)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications, IETF](https://datatracker.ietf.org/doc/html/rfc10017) (doc)
