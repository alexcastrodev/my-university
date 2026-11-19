---
version: 1.0
updatedAt: 2026-11-19
title: "Clientes OAuth 2.0 em Código .NET: PKCE, Client Credentials e Device Flow"
summary: Um app .NET como cliente OAuth, escrito em C# e medido contra o Keycloak: um handler de token com client credentials e uma única renovação sob 50 chamadores concorrentes (1 requisição de token contra 50), uma renovação no 401 e onde ela fica em relação ao handler de retry, MSAL e Duende.AccessTokenManagement comparados com a versão escrita à mão (licença da Duende lida nas páginas do fornecedor), private_key_jwt, authorization code com PKCE em um listener de loopback, o device flow com slow_down e expiração, rotação e reuso de refresh token, e onde tokens e segredos ficam guardados.
---
## Objective

As outras lições de identidade mostram o app .NET como o lado servidor do OAuth: validando tokens ou autenticando usuários com `AddOpenIdConnect`. Esta é a outra cadeira: o seu código é o cliente OAuth e precisa obter tokens, guardá-los, renová-los e sobreviver às falhas. Três formatos cobrem quase tudo: um serviço chamando outro serviço (client credentials), um app de console ou desktop com uma pessoa (authorization code com PKCE pelo navegador do sistema) e uma ferramenta sem navegador (device flow). Para cada um escrevi o cliente em C# e rodei contra um servidor de autorização real (Keycloak em Docker, como na [lição de OAuth no nível do protocolo](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles)), contando o que o servidor viu: 50 chamadores concorrentes e quantas requisições de token eles causam, um 401 tratado com exatamente uma renovação, onde o handler de token fica em relação ao handler de retry, `private_key_jwt`, um listener em loopback, `slow_down`, rotação de refresh. MSAL e Duende.AccessTokenManagement são medidos contra a versão escrita à mão. O que não pude rodar (um tenant Entra real, DPAPI, o Keychain) está marcado como só documentação. Versions: Keycloak 26.8.2 (`start-dev`, HTTP na 6700 e HTTPS autoassinado na 6702), `Microsoft.Identity.Client` 4.92.0, `Duende.AccessTokenManagement` 4.3.0, `Microsoft.Extensions.Http.Resilience` 10.11.0 (Polly.Core 8.4.2), `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `Microsoft.IdentityModel.JsonWebTokens` 8.23.0, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- Um worker ou API que chama uma API interna ou de parceiro com identidade própria, sem usuário.
- Uma ferramenta de CLI ou desktop em que a pessoa desenvolvedora entra uma vez e a ferramenta chama uma API em nome dela.
- Uma ferramenta em servidor ou container sem navegador, autenticando por um código digitado no celular.

## Deep Dive

### O laboratório

Um realm `demo` do Keycloak com os clientes `worker` (secret, tempo de vida do access token em 6 s para as renovações aparecerem), `worker-long` (3600 s), `worker-jwt` (chave privada), `cli` (público, PKCE, redirect em loopback) e `cli-device` (device grant). Um processo de console também hospeda o resource server na 6701 (`AddJwtBearer` com o realm como authority, audience `orders-api`, `ClockSkew` zero salvo aviso). As "chamadas ao token endpoint" são contadas duas vezes: pelo meu provider e pelos eventos `CLIENT_LOGIN` do próprio Keycloak, lidos pela API de administração, e os dois sempre concordaram. Não há navegador real: uma classe `FakeBrowser` segue redirects, guarda cookies, envia o formulário de login do Keycloak (`alice`) e a tela de consentimento do device flow. Os cookies são tratados à mão: o `CookieContainer` descartou os cookies legados `Version=1` do Keycloak (`cookie_not_found`).

### Serviço a serviço: um handler de token que você consegue ler

```csharp
public async Task<string> GetAsync(string? rejected = null, CancellationToken ct = default)
{
    if (Fresh && _cached!.Value.Token != rejected) return _cached!.Value.Token;   // fast path, no lock
    await _gate.WaitAsync(ct);                                                    // SemaphoreSlim(1, 1)
    try
    {
        if (Fresh && _cached!.Value.Token != rejected) return _cached!.Value.Token; // someone refreshed while we waited
        var o = options.CurrentValue;                                             // IOptionsMonitor: secret rotation, below
        using var req = new HttpRequestMessage(HttpMethod.Post, o.TokenEndpoint) { Content = new FormUrlEncodedContent(
            [new("grant_type", "client_credentials"), new("scope", o.Scope)]) };
        req.Headers.Authorization = new("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{o.ClientId}:{o.ClientSecret}")));
        using var res = await factory.CreateClient("token").SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct)); var root = doc.RootElement;
        _cached = (root.GetProperty("access_token").GetString()!, DateTimeOffset.UtcNow.AddSeconds(root.GetProperty("expires_in").GetInt32()) - o.Skew);
        return _cached.Value.Token;
    }
    finally { _gate.Release(); }
}

public sealed class BearerHandler(TokenProvider tokens) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var bytes = request.Content is null ? null : await request.Content.ReadAsByteArrayAsync(ct);
        var token = await tokens.GetAsync(null, ct);
        request.Headers.Authorization = new("Bearer", token);
        var response = await base.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.Unauthorized) return response;
        response.Dispose();
        var retry = new HttpRequestMessage(request.Method, request.RequestUri);  // a sent request cannot be sent again
        if (bytes is not null) retry.Content = new ByteArrayContent(bytes);
        retry.Headers.Authorization = new("Bearer", await tokens.GetAsync(rejected: token, ct));
        return await base.SendAsync(retry, ct);                                 // one renewal, one repeat, never a loop
    }
}
// DI: the provider is a singleton (it owns the cache), the handler transient; the "token" client has no bearer handler
services.AddSingleton<TokenProvider>(); services.AddTransient<BearerHandler>(); services.AddHttpClient("token");
services.AddHttpClient("orders", c => c.BaseAddress = new("https://orders.example")).AddHttpMessageHandler<BearerHandler>();
```
`Skew` é quanto antes o token passa a ser considerado expirado (30 s por padrão nas minhas options), para que uma requisição nunca saia com um token que morre no caminho. O argumento `rejected` impede que um segundo chamador renove de novo depois que o primeiro já renovou: quem recebeu 401 só renova se o token em cache ainda for aquele que falhou.

### 50 chamadores, um token: o lock é o ponto

50 tasks começam juntas sem token. Depois, 50 workers chamam a API a cada 100 ms por 20 s, com um token de 6 s renovado aos 5 s. Mesmo código, com e sem o semáforo:

```text
no gate : 50 cold calls -> 50 x 200, token endpoint calls: own 50, Keycloak events 50
no gate : 20 s, 50 workers: 9750 ok, 0 failed, token endpoint calls: own 150, Keycloak events 150
gated   : 50 cold calls -> 50 x 200, token endpoint calls: own 1,  Keycloak events 1
gated   : 20 s, 50 workers: 9750 ok, 0 failed, token endpoint calls: own 3,   Keycloak events 3
```
Nada falha sem o gate; são só 50 vezes mais carga no servidor de autorização a cada expiração (150 requisições onde 3 bastariam), que é como uma frota de pods estoura um rate limit na virada da hora. A proteção contra stampede do `HybridCache` também serviria, mas a expiração dele é definida antes de a factory rodar, então ele não consegue seguir o `expires_in` (raciocínio, não medido).

### O 401 e o handler de retry

```text
API revokes the cached token (denylist on jti): call -> 200, token calls 2, API saw: /orders 401 | /orders 200
API rejects every token:                        call -> 401, token calls 3, API saw: /orders 401 | /orders 401
```
Um token revogado ou de chave rotacionada custa uma requisição extra e uma renovação. Se a API continua respondendo 401 (audience errada, um bug), o handler para depois de uma repetição e devolve o 401, que é o único formato seguro: um loop aqui é um ataque de negação de serviço contra o seu próprio provedor de identidade. Se o handler de token fica antes ou depois do `AddStandardResilienceHandler` importa quando as tentativas são espaçadas. Cenário: o token vive 6 s, `/flaky` responde 503 duas vezes, os retries esperam 4 s (`Retry.Delay`, constante, sem jitter):

```text
token handler BEFORE the retry (outer): final 200, token calls 2
   API saw: t+0.0 503 | t+4.0 503 | t+8.1 401 | t+8.1 200
token handler AFTER the retry (inner):  final 200, token calls 2
   API saw: t+0.0 503 | t+4.0 503 | t+8.0 200
```
Externo: o header é carimbado uma vez, então a terceira tentativa leva um token que expirou no meio do caminho, gasta uma requisição num 401 e só o meu tratamento de 401 salva. Interno: cada tentativa pede ao provider, que é uma leitura de cache, e a renovação acontece antes do envio. Ponha o handler de token depois do de resiliência. Tokens reais duram de 60 a 90 minutos no Entra (padrão, docs), então a tentativa com token vencido é rara, mas a ordem interna não custa nada e a elimina. O handler padrão não faz retry de 401.

### MSAL e Duende contra o handler escrito à mão

```csharp
var msal = ConfidentialClientApplicationBuilder.Create("worker-long").WithClientSecret(secret)
    .WithAuthority("https://login.microsoftonline.com/<tenant>").Build();   // keep ONE instance: it owns the cache (docs)
var r = await msal.AcquireTokenForClient(["api://<api>/.default"]).ExecuteAsync();  // cache first, then the endpoint
// Duende.AccessTokenManagement 4.3.0
services.AddClientCredentialsTokenManagement().AddClient("worker-long", c => { c.TokenEndpoint = new(url);
    c.ClientId = ClientId.Parse("worker-long"); c.ClientSecret = ClientSecret.Parse(secret); c.Scope = Scope.Parse("orders.read"); });
services.AddClientCredentialsHttpClient("orders", ClientCredentialsClientName.Parse("worker-long"), c => c.BaseAddress = new(api));
```
```text
MSAL, 50 cold AcquireTokenForClient: Keycloak events 50, TokenSource IdentityProvider; next call: Cache
Duende, 50 cold calls through the client: 50 x 200, Keycloak events 1; 50 more calls: events 0
```
O MSAL faz cache (a segunda chamada é `Cache`), mas não agrupa um cold start concorrente: 50 chamadas simultâneas geraram 50 requisições. Aqueça o app na inicialização ou ponha um `SemaphoreSlim` em volta da primeira aquisição. O Duende gerou 1 (e 2 com o token de 6 s, em que o `CacheLifetimeBuffer` de 60 s mostrado na doc dele supera o tempo de vida, então ajuste-o para tokens curtos; tokens de 60 a 90 minutos do Entra não têm problema). O MSAL é a biblioteca da Microsoft: o escopo `/.default` para client credentials é obrigatório no Entra (docs), ela é construída em torno de authorities do Entra e, contra o Keycloak, precisa de `WithOidcAuthority`, que só aceita HTTPS (`ArgumentException: The authority must use HTTPS scheme`, por isso o Keycloak acima também escuta na 6702 com certificado autoassinado e um `IMsalHttpClientFactory` que confia nele). Essa chamada é marcada como experimental para clientes públicos (`MsalClientException` até `.WithExperimentalFeatures()`); no cliente confidencial rodou sem. Prefira o MSAL quando a authority é o Entra e você quer o cache, os certificados e a Managed Identity dele; para outra authority, o handler acima são poucas dezenas de linhas sem dependência.

Licenças, lidas em 2026-11-19: a página de produtos da Duende lista "Access Token Management (Open Source)" e a documentação da biblioteca diz "Duende.AccessTokenManagement is released as open source under the Apache 2.0 license" (página atualizada em Feb 26, 2026); o metadado do NuGet da 4.3.0 mostra `Apache-2.0`. O Duende IdentityServer, outro produto, é comercial: a página da Community Edition diz que ele é gratuito para organizações com fins lucrativos com receita bruta anual projetada abaixo de US$ 1 milhão e acesso a menos de US$ 3 milhões em capital, ou para organizações sem fins lucrativos com orçamento publicado abaixo de US$ 1 milhão, e que avaliação, desenvolvimento, testes e uso pessoal não exigem licença. Os termos mudam, então reconfira as páginas.

### Uma assertion assinada no lugar de um segredo compartilhado

O `private_key_jwt` (RFC 7523) troca o `client_secret` por um JWT curto assinado com uma chave privada que só o cliente tem. O servidor guarda a chave pública (um JWKS), então nada que valha roubar fica no servidor de autorização.

```csharp
new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
{
    Issuer = clientId, Audience = tokenEndpoint,                      // iss == sub == client_id
    Claims = new Dictionary<string, object> { ["sub"] = clientId, ["jti"] = Guid.NewGuid().ToString() },
    NotBefore = now, IssuedAt = now, Expires = now.AddSeconds(60),
    SigningCredentials = new(new RsaSecurityKey(rsa) { KeyId = "lab-1" }, SecurityAlgorithms.RsaSha256)
});   // sent as client_assertion with client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
```
```text
valid assertion              -> access_token 894 chars, expires_in 300
same assertion again (jti)   -> invalid_client: Token reuse detected
wrong audience               -> invalid_client: Invalid token audience
expired (clock 5 min behind) -> invalid_client: Token is not active (also at +30 s, nbf)
signed with another key      -> invalid_client: Signature on JWT token failed validation
```
Gere uma assertion nova a cada requisição de token (uso único, o `jti` é verificado) e mantenha o `exp` em um minuto. Uma deriva de 30 segundos já foi rejeitada, então rode NTP em quem assina. O Keycloak precisa do JWKS no atributo `jwks.string` do cliente com `use.jwks.string` verdadeiro; configurar o JWKS sem isso não carregou nada (`Unable to load public key`). O MSAL faz o mesmo com `.WithClientAssertion(o => ...)` (ele chama de volta com `o.TokenEndpoint`, e funcionou contra o Keycloak) ou `.WithCertificate(cert)` no Entra, onde a chave privada fica no Key Vault ou no repositório de certificados (docs).

### Uma pessoa no terminal: code com PKCE numa porta de loopback

A RFC 8252 diz que um app nativo usa o navegador do sistema e recebe o code em `http://127.0.0.1:<porta>`, uma porta escolhida pelo SO em tempo de execução. Resumido das ~80 linhas que rodei:

```csharp
var verifier  = B64Url(RandomNumberGenerator.GetBytes(32));                      // 43 chars
var challenge = B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));      // code_challenge_method=S256
var state = B64Url(RandomNumberGenerator.GetBytes(16)); var nonce = B64Url(RandomNumberGenerator.GetBytes(16));
var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); int port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();  // a free port
var redirect = $"http://127.0.0.1:{port}/callback";
using var listener = new HttpListener(); listener.Prefixes.Add($"http://127.0.0.1:{port}/"); listener.Start();
var pending = listener.GetContextAsync();                                       // listen BEFORE opening the browser
Process.Start(new ProcessStartInfo($"{auth}?response_type=code&client_id=cli&redirect_uri={Uri.EscapeDataString(redirect)}" +
    $"&scope=openid%20orders.read&state={state}&nonce={nonce}&code_challenge={challenge}&code_challenge_method=S256") { UseShellExecute = true });
var q = (await pending.WaitAsync(TimeSpan.FromMinutes(2))).Request.QueryString;   // then answer with a "you can close this tab" page
if (q["state"] != state) throw new InvalidOperationException("state mismatch");  // CSRF on the redirect
// back channel, public client: no secret, the verifier proves it is the same instance
POST token: grant_type=authorization_code, client_id=cli, code=q["code"], redirect_uri=redirect, code_verifier=verifier
```
```text
[browser] signed in as alice: 200
[cli] redirect_uri used: http://127.0.0.1:63933/callback
[cli] access_token 862 chars, expires_in 300, refresh_token yes
[cli] id_token valid=True, nonce matches=True, azp=cli, exp=2026-11-19 11:05:06Z
[cli] same id_token for audience other-app: valid=False (SecurityTokenInvalidAudienceException)
[cli] GET /orders with the user token: 200
```
O Keycloak tinha `http://127.0.0.1/callback` registrado e aceitou a porta aleatória, a regra de loopback da RFC 8252. Todo o resto continuou exato: `/other`, `/callback/x` e `http://localhost:50001/callback` deram `400 Invalid parameter: redirect_uri`. A doc do MSAL registra `http://localhost` como redirect URI no Entra e a biblioteca preenche a porta (só documentação). O cliente valida o ID token (issuer, audience = o próprio `client_id`, assinatura pelo JWKS do discovery, `nonce`) como na [lição de OpenID Connect](/identity-concepts/oidc-id-token-userinfo-discovery-and-logout); ele não valida o access token, que é opaco para ele e destinado à API. Lê o `expires_in` da resposta em vez de decodificar o JWT.

O MSAL faz a dança do navegador numa chamada, e rodou contra o Keycloak com o meu navegador falso ligado em `SystemWebViewOptions.OpenBrowserAsync`:

```csharp
var app = PublicClientApplicationBuilder.Create("cli-msal").WithRedirectUri("http://localhost").Build();  // + WithAuthority for Entra
var r = await app.AcquireTokenInteractive(["openid", "orders.read"]).ExecuteAsync();   // MSAL opens the browser and runs the listener
// -> MSAL interactive: token 1018 chars, account alice
```
O MSAL acrescentou `profile` e `offline_access` à requisição por conta própria (o Keycloak recusou a primeira tentativa com `Invalid scopes` até o cliente tê-los) e usou `response_mode=form_post`, que o meu navegador falso teve de submeter como um navegador faz. No Windows, o MSAL também pode usar um navegador embutido (só documentação).

### Sem navegador: o device flow

```csharp
var d = await Post(deviceEndpoint, new() { ["client_id"] = clientId, ["scope"] = "orders.read" });
Console.WriteLine($"visit {d.verification_uri} and enter {d.user_code}");      // RFC 8628: show a short code
int interval = d.interval; var deadline = DateTime.UtcNow.AddSeconds(d.expires_in);
while (DateTime.UtcNow < deadline.AddSeconds(interval))
{
    await Task.Delay(TimeSpan.FromSeconds(interval));
    var j = await Post(tokenEndpoint, new() { ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code", ["client_id"] = clientId, ["device_code"] = d.device_code });
    if (j.error is null) return j;                         // success
    if (j.error == "slow_down") interval += 5;             // RFC 8628 section 3.5
    else if (j.error != "authorization_pending") throw new InvalidOperationException(j.error);   // access_denied, expired_token
}
```
```text
interval 5, user approves after 7 s:  t=5.0 authorization_pending | t=10.0 token
polling every 1 s anyway:              t=1.0 authorization_pending | t=2.0 slow_down (next in 6 s) | t=8.0 token
nobody approves (lifespan 12 s):       t=2.0 ... t=12.0 authorization_pending | t=14.1 expired_token
```
Consultar mais rápido que o `interval` gerou `slow_down` na segunda requisição, e o cliente deve somar 5 s dali em diante. O loop confere o `expired_token` vindo do servidor em vez de confiar no próprio relógio. Duas surpresas: o cliente `cli`, que exige PKCE, fez o endpoint de device responder `Missing parameter: code_challenge_method`, então o device grant ganhou um cliente próprio; e o `AcquireTokenWithDeviceCode` do MSAL contra a authority OIDC genérica lançou `NotImplementedException` na 4.92.0, então com o Keycloak escreva o loop você mesmo (no Entra o MSAL suporta, só documentação). O phishing de device code é o ponto fraco desse grant: a tela de consentimento precisa nomear o app, e o grant deve ficar desligado nos clientes que não precisam dele.

### Refresh tokens: rotação, reuso e onde guardar

```text
login: refresh_token ...xhC5eg
refresh #1 -> new refresh_token ...Uj_8_w (rotated: True), new access_token expires_in 300
replay the OLD refresh_token  -> invalid_grant: Maximum allowed refresh token reuse exceeded
then the NEWEST refresh_token -> invalid_grant: Session doesn't have required client
```
Com rotação, cada refresh devolve um refresh token novo que substitui o antigo no seu armazenamento, de forma atômica, antes de o antigo ser esquecido. Reapresentar o token antigo fez o servidor tratá-lo como roubo e encerrar a sessão inteira, então o token mais novo também morreu. Duas regras práticas decorrem disso. Faça refresh de um lugar por vez (o mesmo gate single-flight de antes, inclusive entre processos, ou dois refreshes concorrentes se matam). Em `invalid_grant` não tente de novo: apague os tokens guardados e comece o login interativo outra vez.

Um refresh token é uma senha que sobrevive à sessão, então onde ele fica importa, e a plataforma decide. O `ProtectedData` (DPAPI) é só Windows: aqui no macOS o `Protect` lançou `PlatformNotSupportedException`, como a doc diz. A resposta multiplataforma da doc é o pacote `Microsoft.Identity.Client.Extensions.Msal`, cujo `MsalCacheHelper` recebe propriedades de armazenamento `WithMacKeyChain(...)` e `WithLinuxKeyring(...)` no exemplo da doc, de modo que o cache vai para o Keychain e o keyring do Linux em vez de um arquivo comum (só documentação, não rodei; a página não mostra o lado Windows). Um arquivo JSON simples, mesmo com `chmod 600`, não é criptografia. Para um serviço não há refresh token para guardar: ele pede de novo, e por isso client credentials não devolve nenhum.

### Erros que você vai encontrar

```text
redirect_uri mismatch      -> 400 Invalid parameter: redirect_uri (the user sees it in the browser, your listener never fires)
token without the scope    -> aud=(none), API: 401 invalid_token, "The audience 'empty' is invalid"
secret rotated, not loaded -> 401 unauthorized_client (Keycloak; RFC 6749 says invalid_client, alert on both)
```
A rotação de segredo sem reiniciar funcionou com `IOptionsMonitor<T>`: o provider lê `CurrentValue` a cada renovação e, com um arquivo JSON recarregável, o mesmo processo foi de `token ok` para `401 unauthorized_client` quando gravei um segredo errado e voltou a `token ok` quando corrigi. O segredo em si pertence ao user-secrets, a uma variável de ambiente ou ao Key Vault, nunca a um `appsettings.json` no repositório. No Entra a audience é a outra armadilha: o escopo de client credentials deve ser `<resource>/.default` (docs), e a versão do token que a API recebe (v1 ou v2, `aud` como `api://<id>` ou o GUID puro) é decidida pelo registro da API, como visto na [lição de OIDC e Entra](openid-connect-entra-id-and-bff). O `JwtBearer` do ASP.NET Core mantém o `ClockSkew` padrão a menos que você o defina: um token expirado ainda recebeu 200 oito segundos depois do `exp`, e 401 (`The token expired at ...`) quando o pus em zero.

### Qual código para qual trabalho

| Cenário | Fluxo | Biblioteca ou código | Onde fica o segredo | Armadilha |
|---|---|---|---|---|
| Worker ou API chamando uma API | client credentials | handler de token (acima), MSAL ou Duende | Key Vault, user-secrets; melhor um certificado ou `private_key_jwt` | 50 chamadores frios geram 50 requisições de token (MSAL) ou 50 por expiração (sem gate) |
| Idem, sem segredo compartilhado | client credentials com `client_assertion` | `JsonWebTokenHandler`, MSAL `WithCertificate` | chave privada no Key Vault ou no repositório de certificados | uma assertion por requisição; deriva de relógio |
| App de console ou desktop com usuário | code + PKCE, loopback | escrito à mão (~80 linhas) ou MSAL `AcquireTokenInteractive` | nenhum (cliente público); refresh token no armazenamento do SO | redirect URI precisa casar; checar `state`; `form_post` |
| CLI em servidor ou sessão SSH | device flow | loop escrito à mão, MSAL no Entra | nenhum (cliente público) | `slow_down`, `expired_token`, phishing de código |
| App web renderizado no servidor com sessão | code + PKCE | `AddOpenIdConnect`, Microsoft.Identity.Web | no servidor, cookie como sessão | coberto na lição de OIDC |
| Qualquer cliente com refresh token | refresh com rotação | o mesmo armazenamento do login | armazenamento criptografado do SO | reuso mata a sessão; um refresh por vez |

O `AddOpenIdConnect` serve para um app web que autentica usuários e mantém uma sessão por cookie. Código de cliente próprio (ou o MSAL) serve para tudo que não tem sessão de navegador própria: serviços, workers, CLIs, apps desktop.

## Trade-offs

- **Escrever o handler ou usar uma biblioteca.** O handler tem cerca de 70 linhas, não tem licença para ler e funciona com qualquer servidor de autorização; o MSAL traz as regras do Entra, certificados e um cache de tokens; o Duende traz coalescência, DPoP e gestão de tokens de usuário num pacote Apache-2.0. Escreva-o quando a authority não for o Entra ou quando você não quiser dependência.
- **Um gate custa um pouco de latência.** Os chamadores esperam enquanto um renova; o caminho rápido (token válido) não pega lock. Com um skew de alguns segundos a espera é rara.
- **Renovação antecipada contra tratamento de 401.** Renovar 30 s antes evita a maioria dos 401; a repetição após 401 cobre revogação e rotação de chave. Mantenha os dois, e só uma repetição.
- **Segredo contra assertion.** O segredo é simples e vaza em logs e repositórios; a assertion assinada exige uma chave, um relógio e um JWT novo por requisição, e não deixa nada reutilizável em repouso no servidor.
- **Loopback contra device flow.** O loopback dá melhor experiência, mas exige navegador local e uma porta livre; o device flow não exige nenhum dos dois e é mais fácil de sofrer phishing.
- **Código PKCE próprio contra MSAL.** O fluxo escrito à mão é pequeno e visível; o MSAL cuida do navegador, das portas, dos escopos e do cache, mas acrescenta escopos que você não pediu (`profile`, `offline_access`) e alguns recursos de authority genérica eram experimentais ou faltavam na 4.92.0.
- **Limites do laboratório.** Keycloak não é Entra: padrões como `unauthorized_client` para segredo errado, o casamento de porta no loopback e o tratamento de reuso de refresh variam por servidor, então meça de novo contra o seu.

## Documentation Links

- [Microsoft Authentication Library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/) (doc)
- [Client credential flows in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/client-credential-flows) (doc)
- [Acquire tokens interactively with MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/acquiring-tokens-interactively) (doc)
- [Device code flow in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/device-code-flow) (doc)
- [Token cache serialization in MSAL.NET, Microsoft Learn](https://learn.microsoft.com/en-us/entra/msal/dotnet/how-to/token-cache-serialization) (doc)
- [Access tokens in the Microsoft identity platform, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) (doc)
- [Scopes and the .default scope, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc) (doc)
- [Make HTTP requests using IHttpClientFactory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests) (doc)
- [Build resilient HTTP apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [Access Token Management, Duende documentation](https://docs.duendesoftware.com/accesstokenmanagement/) (doc)
- [IdentityServer Community Edition, Duende](https://duendesoftware.com/products/communityedition) (doc)
- [RFC 8252, OAuth 2.0 for Native Apps, IETF](https://datatracker.ietf.org/doc/html/rfc8252) (doc)
- [RFC 8628, OAuth 2.0 Device Authorization Grant, IETF](https://datatracker.ietf.org/doc/html/rfc8628) (doc)
- [RFC 7636, Proof Key for Code Exchange, IETF](https://datatracker.ietf.org/doc/html/rfc7636) (doc)
- [RFC 7523, JWT Profile for Client Authentication, IETF](https://datatracker.ietf.org/doc/html/rfc7523) (doc)
