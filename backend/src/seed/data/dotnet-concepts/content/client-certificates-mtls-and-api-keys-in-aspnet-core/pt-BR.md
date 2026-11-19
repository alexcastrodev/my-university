---
version: 1.0
updatedAt: 2026-11-19
title: "Certificados de Cliente, mTLS e API Keys no ASP.NET Core"
summary: Autenticação de serviço para serviço no ASP.NET Core, medida em Kestrel e openssl com uma CA de teste: os modos de ClientCertificateMode em TLS 1.2, TLS 1.3 e HTTP/2, a validação do AddCertificate (confiança, uso, validade, revogação por CRL e OCSP, com falha fechada), um certificado encaminhado por header e como forjá-lo, os dois lados do cliente, API key com hash, comparação em tempo constante e rotação com sobreposição, e token preso a certificado (RFC 8705).
---
## Objective

Quem chama de serviço para serviço não tem navegador nem usuário, então a credencial é algo que ele guarda: um certificado de cliente provado no handshake TLS (TLS mútuo), uma API key num header, ou um token amarrado a um dos dois. Esta lição monta os três no ASP.NET Core e mede onde cada um quebra: os valores de `ClientCertificateMode` do Kestrel em TLS 1.2, TLS 1.3 e HTTP/2, a validação do `AddCertificate` (confiança, uso, validade, revogação por CRL e OCSP), um certificado encaminhado num header (e como forjá-lo), as APIs de certificado do lado cliente, hash de API key, rotação e comparação em tempo constante, e um token preso a certificado (RFC 8705). Toda chave e todo certificado vêm de uma CA de teste descartável feita com `openssl`; nada aqui é credencial real.
Versions: `Microsoft.AspNetCore.Authentication.Certificate` 10.0.15 e `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `net10.0`, SDK 10.0.100 (macOS arm64, runtime 10.0.0, OpenSSL 4.0.3) e, para os resultados só de Linux, o container `mcr.microsoft.com/dotnet/sdk:10.0` (Ubuntu 24.04, runtime 10.0.14, OpenSSL 3.0.13). O pacote `AddCertificate` também existe no NuGet como 11.0.0, não medido aqui.

## Use Cases

- Autenticar um serviço interno em outro com o próprio certificado, em vez de um segredo compartilhado.
- Colocar um parceiro ou um dispositivo atrás de TLS mútuo e mapear o certificado para claims.
- Ler com segurança o certificado de cliente que um proxy reverso ou load balancer terminou.
- Emitir API keys para integradores (com hash em repouso, rotação e revogação) e inutilizar um access token roubado prendendo-o a um certificado.

## Deep Dive

### O laboratório

Um script cria a `Lab Root CA`, uma intermediária sob ela e certificados folha (EC P-256): `billing` (SAN `DNS:billing.lab`, `URI:spiffe://lab/billing`, EKU clientAuth), `expired` (válido de jan a fev de 2026), `serveronly` (EKU serverAuth), `rogue-client` (CN=billing, assinado por uma CA sem relação), `selfsigned` e um certificado de servidor `localhost`. Um app Kestrel (HTTPS na 6820, HTTP puro na 6822) e um console cliente rodam todos os casos; o host macOS e o container Linux executam o mesmo código.

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout root.key -out root.crt \
  -days 30 -subj "/CN=Lab Root CA (test only)" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
# intermediate: basicConstraints=critical,CA:TRUE,pathlen:0 ; leaf: -extfile with subjectAltName, extendedKeyUsage=clientAuth
openssl x509 -req -in billing.csr -CA int.crt -CAkey int.key -CAcreateserial -out billing.crt -days 10 -extfile billing.ext
```

### O Kestrel decide quando o certificado é pedido, o AddCertificate decide se ele presta

Há duas camadas. O `ClientCertificateMode` do Kestrel controla o handshake TLS. O handler do `AddCertificate` valida o que o Kestrel entrega e o transforma em um `ClaimsPrincipal`.

```csharp
builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(6820, lo => lo.UseHttps(h =>
{
    h.ServerCertificate = X509CertificateLoader.LoadPkcs12FromFile("server.pfx", "test");
    h.ClientCertificateMode = ClientCertificateMode.RequireCertificate;
    h.AllowAnyClientCertificate();   // TLS accepts any cert; AddCertificate does the real validation
})));
builder.Services.AddAuthentication(CertificateAuthenticationDefaults.AuthenticationScheme)
  .AddCertificate(o => { o.ChainTrustValidationMode = X509ChainTrustMode.CustomRootTrust;
                         o.CustomTrustStore = roots; o.RevocationMode = X509RevocationMode.NoCheck; });
```

Sem `AllowAnyClientCertificate()` o Kestrel valida a cadeia contra o repositório do sistema operacional durante o handshake: com a CA privada, `RequireCertificate` e o certificado certo, o cliente recebeu `SocketException: Connection reset by peer` e o handler nunca rodou. Defaults do framework em `CertificateAuthenticationOptions`, lidos pelo `IOptionsMonitor`: `AllowedCertificateTypes` Chained, `ChainTrustValidationMode` System, `RevocationMode` Online, `RevocationFlag` ExcludeRoot, `ValidateCertificateUse` e `ValidateValidityPeriod` true.

`GET /whoami` (exige o esquema Certificate), macOS, TLS 1.2 (o macOS não negociou TLS 1.3 com o Kestrel em nenhuma execução):

```text
mode                no certificate                         certificate "billing"
NoCertificate       403                                    403 (the certificate is never requested)
AllowCertificate    403                                    200 ["issuer=CN=Lab Intermediate CA (test only)","thumbprint=3FC6...","dns=billing.lab","name=billing","uri=spiffe://lab/billing",...]
RequireCertificate  connection reset, no HTTP response      200
```

`RequireCertificate` falha abaixo do HTTP, então quem chama vê um erro de socket e o handler nunca roda. `AllowCertificate` chega ao seu código e responde 403, que é o que você quer quando só algumas rotas exigem o certificado. As claims padrão incluem emissor, thumbprint, subject, número de série e uma claim por SAN (`dns`, `uri`), mais `name` vindo do subject. Rejeições (o log mostra o motivo, o cliente só vê 403):

```text
rogue-client (CN=billing, unknown CA)  PartialChain One or more certificates required to validate this certificate cannot be found.
selfsigned                             Options do not allow self signed certificates.
expired                                NotTimeValid An expired certificate was detected.
serveronly (EKU serverAuth)            NotValidForUsage The key usage is incorrect.
```

### Confiança: System, CustomRootTrust e a intermediária

`ChainTrustValidationMode.System` falha para uma CA privada (`PartialChain`, medido). `CustomRootTrust` com `CustomTrustStore` resolve, com uma pegadinha medida no macOS e no Linux: só com a raiz no store, o `billing` foi rejeitado com `PartialChain` mesmo quando o cliente mandou a intermediária no handshake (`SslStreamCertificateContext` com a intermediária). O servidor não usou a cadeia enviada pelo cliente. Com raiz e intermediária juntas no `CustomTrustStore`, o mesmo certificado recebeu 200. Consequência: a intermediária fica no store como âncora, então o handler confia em tudo que ela assinou, e trocar ou revogar a intermediária exige redeploy do store.

### OnCertificateValidated: suas regras e suas claims

A cadeia diz "uma CA em que confio assinou". Qual serviço é esse, e ele pode estar aqui? Isso é decisão sua no evento, e `Fail` ou um `Principal` próprio substitui o mapeamento padrão:

```csharp
o.Events = new CertificateAuthenticationEvents { OnCertificateValidated = c =>
{
    var cert = c.ClientCertificate;
    if (!registry.TryGetValue(cert.Thumbprint, out var service)) { c.Fail("thumbprint not in registry"); return Task.CompletedTask; }
    if (cert.GetNameInfo(X509NameType.DnsName, false) != "billing.lab") { c.Fail("SAN DNS mismatch"); return Task.CompletedTask; }
    c.Principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, service), new Claim("role", "payer")], c.Scheme.Name));
    c.Success(); return Task.CompletedTask;
} };
```

```text
billing       200 ["name=billing-service","role=payer","x5t#S256=133BC488..."]
rogue-client  403 (never reaches the event: chain validation failed first)
```

O evento só roda depois que cadeia, uso, validade e revogação passaram, então é o lugar da allowlist (thumbprint, SAN, SPIFFE ID), não um substituto dessas checagens. Uma allowlist por thumbprint também faz da rotação um deploy: mantenha dois thumbprints por serviço durante a troca, ou compare emissor mais SAN.

### DelayCertificate: a renegociação depende do SO, da versão do TLS e do HTTP

`DelayCertificate` significa "não peça no handshake, peça depois com `GetClientCertificateAsync`". Medido com um endpoint que lê `Connection.ClientCertificate` e depois faz await em `GetClientCertificateAsync()` (container Linux, cliente com e sem certificado, `DelayCertificate`):

```text
client          TLS   HTTP    result
no certificate  1.2   1.1     200, cert (none)
no certificate  1.2   2       200, cert (none)
no certificate  1.3   1.1     500  SslException: Operation failed with error - 0.  (at RenegotiateAsync)
no certificate  1.3   2       200, cert (none)
billing         1.2   1.1     200, cert CN=billing
billing         1.3   1.1     200, cert CN=billing
billing         1.2   2       200, cert (none)   <- the certificate the client holds is never delivered
billing         1.3   2       200, cert (none)
```

Com `AllowCertificate`, o mesmo cliente `billing` recebeu `CN=billing` nas quatro linhas, inclusive em HTTP/2. Ou seja, com `DelayCertificate` sobre HTTP/2 um cliente que tem certificado parece anônimo, sem erro, porque o HTTP/2 proíbe renegociação. No macOS o mesmo endpoint lançou `PlatformNotSupportedException` em `SslStreamPal.Renegotiate` em toda requisição, também com o servidor fixado em TLS 1.2. A documentação (lida, não executada) diz que renegociar não é recomendado, que é preciso fazer buffer ou drenar o corpo da requisição antes (senão `InvalidOperationException: Client stream needs to be drained before renegotiation`) e que o melhor é usar hosts separados com configuração por SNI. Uma alternativa barata: `AllowCertificate` no listener inteiro e 403 onde o certificado for obrigatório.

### Revogação: falha fechada, medida no Linux

`RevocationMode` `Online` busca a CRL ou consulta o OCSP, `Offline` só usa o que já está em cache, `NoCheck` pula a checagem. A CA de teste publica uma CRL num servidor HTTP local e um responder OCSP (`openssl ocsp`); nas linhas abaixo, `RevocationFlag.EndCertificateOnly`:

```text
OCSP responder up:         good 200, revoked 403 "Revoked certificate revoked" (the responder log shows the GET requests)
CRL up, cold cache:        good 200, revoked 403 "Revoked certificate revoked"
CRL down, CRL cached:      good 200, revoked 403 (the cached CRL is used; nextUpdate was 7 days)
CRL down, cold cache:      Online 403, Offline 403: RevocationStatusUnknown unable to get certificate CRL, OfflineRevocation ...
                           NoCheck 200
CRL URL pointing nowhere:  Online 403, Offline 403 (same message)
OCSP URL pointing nowhere: Online 403, Offline 403
```

Uma fonte de revogação inalcançável faz o handler rejeitar o certificado (falha fechada), e `NoCheck` é o único modo que a ignora. Uma CRL em cache mantém as respostas "bom" e "revogado" funcionando por toda a validade dela. Um certificado com OCSP e URL de CRL continuou bom com o servidor de CRL fora do ar e o cache vazio, o que indica que o OCSP respondeu primeiro (inferido do resultado, não rastreado). Duas pegadinhas: com o `ExcludeRoot` padrão a intermediária também é checada, e a minha não tinha CRL distribution point, então todo certificado falhou com `unable to get certificate CRL` até eu usar `EndCertificateOnly` (ou publicar uma CRL da raiz e pôr a URL na intermediária). No macOS, com esta CA privada e CRL em HTTP, todo certificado, inclusive o bom, falhou com `RevocationStatusUnknown` em `Online` e em `Offline`, então um laptop Mac não prevê o comportamento de produção. O comportamento no Windows não foi testado (só documentação).

### Um certificado encaminhado num header

Atrás de um proxy que termina o TLS, o app nunca vê o handshake. `AddCertificateForwarding` mais `UseCertificateForwarding()` (antes do `UseAuthentication()`) leem o certificado de um header, aqui `X-ARR-ClientCert`, em base64 DER por padrão; outros formatos pedem um `HeaderConverter` (os formatos de header do nginx e do IIS/Azure são só documentação, nenhum proxy foi executado). O handler ignora HTTP puro (`Not https, skipping certificate authentication.`), então a requisição precisa parecer HTTPS: ou porque o salto é TLS, ou porque o `UseForwardedHeaders` aceitou o `X-Forwarded-Proto`.

Um certificado de cliente é informação pública, então o header sozinho não prova nada. As requisições do atacante abaixo levam só o `billing.crt` público no header (sem chave privada, sem certificado de cliente na sessão TLS):

```text
A. TLS hop, no guard, billing.crt in the header      200 as billing
   same with the self-signed cert in the header      403 (the chain is still validated)
B. same with the thumbprint allowlist                200 as "billing-service" (the thumbprint is public too)
C. plain HTTP hop                                    403 (Not https)
D. plain HTTP + forwarded headers trusted for all, attacker adds X-Forwarded-Proto: https      200 as billing
E. guard: header kept only from the proxy address
   attacker 127.0.0.1                                403
   proxy 127.0.0.2                                   200
```

O que fecha a brecha: o header só pode ser aceito vindo do proxy, e o proxy precisa sobrescrever ou remover esse mesmo header em toda requisição, porque um proxy que apenas acrescenta o header repassa também a cópia do atacante. O guard do laboratório:

```csharp
app.Use((ctx, next) => {   // before UseCertificateForwarding
    if (ctx.Connection.RemoteIpAddress?.MapToIPv4().ToString() != trustedProxy) ctx.Request.Headers.Remove("X-ARR-ClientCert");
    return next(); });
```

Além disso, deixe o app alcançável só pelo proxy (política de rede, interface privada) e configure o `UseForwardedHeaders` com `KnownProxies` em vez de limpá-los, como muitos exemplos para container fazem (D).

### O lado cliente

```csharp
// older, shorter
var h1 = new HttpClientHandler(); h1.ClientCertificates.Add(cert);
// SocketsHttpHandler: TLS options in one place; send the intermediate along with the leaf
var h2 = new SocketsHttpHandler { SslOptions = new() {
    ClientCertificateContext = SslStreamCertificateContext.Create(leaf, [intermediate], offline: true) } };
```

Os dois funcionaram contra o laboratório (`ClientCertificates` e `ClientCertificateContext`). O `.pfx` precisa conter a chave privada: passar só o `.crt` público por `SslOptions.ClientCertificates` terminou em `Connection reset by peer`, porque o cliente não conseguiu assinar o handshake. Carregue PKCS#12 com `X509CertificateLoader.LoadPkcs12FromFile` (os construtores de `X509Certificate2` são obsoletos no .NET 9+). Com `IHttpClientFactory`, configure o handler em `ConfigurePrimaryHttpMessageHandler`.

### API keys: hash, comparação em tempo constante, rotação com sobreposição

Uma key é uma credencial sem validade e sem prova de posse, então limite o dano: segredo aleatório de 256 bits, prefixo identificável, só o hash armazenado e duas keys válidas por integrador durante a rotação.

```csharp
// "dk_<id>_<secret>": dk_ marks it for secret scanners, <id> finds the record without scanning every hash
public string? Validate(string presented)
{
    var parts = presented.Split('_', 3);
    if (parts.Length != 3 || parts[0] != "dk" || !_byId.TryGetValue(parts[1], out var recs)) return null;
    var h = SHA256.HashData(Encoding.UTF8.GetBytes(parts[2]));
    string? ok = null;
    foreach (var r in recs)    // no early exit: every candidate hash is compared
        if (CryptographicOperations.FixedTimeEquals(h, r.Hash) && (r.NotAfter is null || r.NotAfter > DateTimeOffset.UtcNow)) ok = r.Id;
    return ok;
}
// AuthenticationHandler<AuthenticationSchemeOptions>.HandleAuthenticateAsync: read X-Api-Key, NoResult() when absent, Fail("invalid api key"), else Success(ticket)
```

Rotação, conduzida por HTTP contra o laboratório:

```text
issue key 1                       -> GET /key with it: 200 "hello billing"; wrong key 401; no header 401
issue key 2 (overlap)             -> key 1: 200, key 2: 200
revoke key 1                      -> key 1: 401, key 2: 200
```

Um hash rápido é o certo aqui (o segredo é aleatório, não é senha), e o benchmark mostra por que o custo não importa, além do que uma comparação ingênua vazaria (arm64, 2.000.000 de iterações):

```text
SHA-256(key) + FixedTimeEquals                              203 ns
HMAC-SHA256(key) + FixedTimeEquals                          325 ns
PBKDF2-SHA256, 100000 iterations (for contrast)      14.2 ms (14,229,785 ns)

string == against a 4096-char constant: matching prefix 0 -> 3.22 ns, 2048 -> 84.25 ns, 4095 -> 151.14 ns
FixedTimeEquals, same inputs:           matching prefix 0 -> 8968 ns, 2048 -> 8893 ns, 4095 -> 8876 ns
44-char key, string ==: 40 chars right 4.33 ns, 0 chars right 2.97 ns
```

O `==` comum vaza o tamanho do prefixo (cerca de 47x numa entrada de 4096 caracteres), e o `FixedTimeEquals` fica plano. Numa key de 44 caracteres a diferença toda é de uns 1,4 ns, muito abaixo do jitter da rede, então pela internet o risco prático é pequeno; o hábito é de graça, e fazer o hash antes (comparar dois digests de 32 bytes) também elimina o vazamento do tamanho. `FixedTimeEquals` serve só para spans de mesmo tamanho: ele devolve false de imediato quando os tamanhos diferem, e por isso você compara os hashes de tamanho fixo. Use HMAC com uma chave do servidor (de [secrets and managed identities](secrets-and-managed-identities-key-vault-and-workload-identity)) quando o valor guardado deve ser inútil sem a chave do servidor. Um hash de senha (PBKDF2, 14 ms por checagem aqui) poria 14 ms de CPU em toda requisição sem ganho algum com um segredo aleatório de 256 bits.

### Um token preso a um certificado (RFC 8705)

Um bearer token vale para quem o carrega. A RFC 8705 acrescenta uma claim de confirmação: o access token leva `cnf` com `x5t#S256`, o SHA-256 em base64url do certificado de cliente em DER, e a API só aceita o token numa conexão TLS que apresente esse certificado. O laboratório assina um JWT de teste (HS256, chave do laboratório) com o `cnf` do `billing.crt` e confere a ligação em um authorization handler:

```csharp
var cnf = ctx.User.FindFirstValue("cnf");                               // {"x5t#S256":"..."}, JwtBearer with MapInboundClaims = false
var cert = await http.Connection.GetClientCertificateAsync();            // listener in AllowCertificate mode
var actual = Base64UrlEncoder.Encode(SHA256.HashData(cert.RawData));
if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(thumb ?? ""))) ctx.Succeed(r);
```

```text
GET /bound   client cert      token bound to    result
             billing          billing           200 "bound token ok for billing-service"
             billing          (no cnf)          403
             rogue-client     billing           403   (stolen token, other certificate)
             selfsigned       billing           403
             (none)           billing           403
             billing          rogue-client      403
GET /plain   (none)           billing           200   (the same stolen token on a plain JwtBearer endpoint)
```

Aqui o certificado não é uma identidade, é prova de posse: o handshake TLS prova a chave privada, o token diz quem é. Por isso a validação de cadeia do `AddCertificate` não é necessária nesta rota (o listener do laboratório aceitou qualquer certificado no TLS), e o token precisa estar preso ou a rota precisa recusá-lo. O servidor de autorização é quem põe o `cnf` no token: os assemblies do OpenIddict em [building an authorization server with OpenIddict](building-an-authorization-server-with-openiddict) expõem tokens presos a certificado (só documentação aqui, não executado). A visão do protocolo está em [OAuth security: BCP, DPoP, mTLS, PAR, RAR](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators), e o lado de identidade de workload (SPIFFE, certificados de vida curta) em [workload identity, service accounts, mTLS and SPIFFE](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe).

### Qual credencial para qual chamador

Serviços internos sob seu controle: mTLS com certificados de vida curta e allowlist por SAN ou SPIFFE ID. Parceiros e dispositivos: mTLS se eles conseguem gerir certificados, senão uma API key por integrador com janela de sobreposição. Uma chamada delegada ou de usuário: um token ([JWT bearer and ASP.NET Core Identity](jwt-bearer-and-aspnet-core-identity), [OAuth clients](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow)), preso a um certificado quando valer as regras extras de handshake. O modelo está em [authentication and authorization fundamentals](authentication-and-authorization-fundamentals).

## Trade-offs

- **mTLS contra API key.** O certificado prova a posse de uma chave privada que nunca viaja e expira sozinha; a key é um segredo compartilhado que vaza em log e em ticket. O preço é ter CA, emissão, rotação e revogação, e chamadores (navegadores, alguns SDKs) que não apresentam certificado.
- **Require contra Allow.** `RequireCertificate` rejeita abaixo do HTTP (reset de socket, o handler nunca roda); `AllowCertificate` deixa um listener servir rotas com e sem certificado e dá 403 legível. Prefira `Allow`, salvo se o listener inteiro for mTLS.
- **DelayCertificate.** A renegociação lançou exceção no macOS, falhou no Linux com TLS 1.3 sobre HTTP/1.1 sem certificado e devolveu nada, em silêncio, sobre HTTP/2. Prefira hosts separados (SNI) ou `Allow`.
- **Revogação.** `Online` falha fechada quando a fonte da CRL ou do OCSP cai, então uma queda no endpoint da sua CA vira queda de todos os chamadores; `NoCheck` falha aberta. Certificados de vida curta (dias) reduzem a necessidade de revogar.
- **Certificados encaminhados.** Cômodo e perigoso: o header é uma credencial do tipo bearer, a menos que o proxy o sobrescreva e o app confie só nesse proxy. Prefira refazer o mTLS até o app, ou um token assinado pelo proxy.
- **Hash das keys.** SHA-256 ou HMAC para keys aleatórias; PBKDF2 ou Argon2 só para segredos escolhidos por pessoas. A comparação em tempo constante é seguro barato, mesmo que um ataque de timing pela rede seja difícil de executar.
- **Tokens presos.** Eliminam o replay de um token roubado, mas só onde todo resource server confere o `cnf`, e exigem mTLS entre o cliente e a API (ou no proxy que repassa a checagem).
- **Limites do laboratório.** Um par de plataformas (macOS arm64 e Ubuntu no Docker), uma CA de teste, só HTTP/1.1 e HTTP/2, sem Windows, sem IIS, sem proxy real, sem HSM nem Key Vault. Meça de novo revogação e renegociação no seu SO de destino antes de depender delas.

## Documentation Links

- [Configure certificate authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/certauth) (doc)
- [Kestrel endpoints and HTTPS configuration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints) (doc)
- [ClientCertificateMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.server.kestrel.https.clientcertificatemode) (doc)
- [CertificateAuthenticationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.certificate.certificateauthenticationoptions) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [X509ChainPolicy.CustomTrustStore, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.x509chainpolicy.customtruststore) (doc)
- [SocketsHttpHandler.SslOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.ssloptions) (doc)
- [HttpClientHandler.ClientCertificates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclienthandler.clientcertificates) (doc)
- [CryptographicOperations.FixedTimeEquals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.cryptographicoperations.fixedtimeequals) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [RFC 5280, Internet X.509 PKI Certificate and CRL Profile, IETF](https://datatracker.ietf.org/doc/html/rfc5280) (doc)
- [RFC 6960, Online Certificate Status Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc6960) (doc)
