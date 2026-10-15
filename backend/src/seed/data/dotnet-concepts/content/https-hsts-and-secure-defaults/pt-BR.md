---
version: 1.0
updatedAt: 2026-10-15
title: "HTTPS, HSTS e Padrões Seguros"
summary: Redirecionamento para HTTPS e a porta que ele precisa descobrir, HSTS e seu rollout, RedirectHttpResult.IsLocalUrl contra open redirect, o caso das APIs e o certificado de desenvolvimento.
---
## Objective

Três peças pequenas deixam um site ASP.NET Core "seguro por padrão" na camada de
transporte: o redirecionamento HTTPS leva clientes HTTP puro para HTTPS, o HSTS
avisa o navegador para nunca mais tentar HTTP puro, e a checagem de URL local
impede que os seus próprios redirects virem links de phishing. Cada uma tem uma
pré-condição que falha em silêncio. O redirecionamento não faz nada quando não
descobre a porta HTTPS, o HSTS fica desligado de propósito no `localhost`, e o
`Results.Redirect` segue qualquer string que receber. O objetivo é saber o que
cada peça lê, o que ela envia e como enxergar que funciona, usando só `curl`
contra um app rodando.

## Use Cases

- Migrar um site de HTTP para HTTPS e escolher um primeiro `max-age` seguro.
- Depurar "o redirect não acontece" ou "o redirect entra em loop" atrás de um
  proxy.
- Tratar o `returnUrl` depois do login sem criar um open redirect.
- Decidir o que uma API (e não um site) deve fazer com requisições HTTP puras.
- Configurar o certificado de desenvolvimento local sem surpresas em containers.

## Deep Dive

### O que o UseHttpsRedirection precisa: uma porta

O middleware responde a uma requisição HTTP com um redirect para a URL HTTPS,
então precisa saber a porta HTTPS. `HttpsRedirectionOptions.HttpsPort` é `null`
por padrão, e a documentação lista de onde ela vem: código, a configuração de
host `https_port` (também `ASPNETCORE_HTTPS_PORT` ou um `"https_port"` no topo do
`appsettings.json`), uma entrada `https://` em `ASPNETCORE_URLS`, a URL HTTPS do
`launchSettings.json`, ou um endpoint HTTPS de um Kestrel exposto diretamente. A
documentação não declara ordem de precedência, e `ASPNETCORE_HTTPS_PORT` não é a
mesma coisa que `ASPNETCORE_HTTPS_PORTS`, que configura os endpoints do Kestrel.

Este app (um file-based app, SDK 10.0.100, com um certificado autoassinado
descartável carregado de um `.pfx`, sem mexer em certificados da máquina) rodou em
`Production` com os dois endpoints:

```csharp
#:sdk Microsoft.NET.Sdk.Web
using Microsoft.AspNetCore.Http.HttpResults;
var b = WebApplication.CreateBuilder(args);
b.WebHost.ConfigureKestrel(k => k.ConfigureHttpsDefaults(h =>
    h.ServerCertificate = X509CertificateLoader.LoadPkcs12FromFile("c.pfx", "x")));
var app = b.Build();
app.UseHsts();
app.UseHttpsRedirection();
app.MapGet("/", (HttpContext c) => $"scheme={c.Request.Scheme}");
app.Run();
// ASPNETCORE_URLS="http://localhost:5300;https://localhost:5301"
```

```text
curl -i  http://localhost:5300/   -> 307 Temporary Redirect, Location: https://localhost:5301/
curl -ik https://localhost:5301/  -> 200, "scheme=https"
```

Duas observações. O status é `307`, o padrão documentado, porque redirects
permanentes ficam em cache no navegador e atrapalham o desenvolvimento. O `308`
permanente é opt-in (`options.RedirectStatusCode`) e a documentação sugere usá-lo
só fora de Development. Segundo, a porta veio da entrada HTTPS do
`ASPNETCORE_URLS`, sem nenhum código extra.

O modo de falha é o mais interessante. Com só a URL HTTP configurada, o mesmo app
respondeu `200` à requisição pura e registrou
`Failed to determine the https port for redirect.` Nada quebrou e nada foi
redirecionado. Com `ASPNETCORE_HTTPS_PORT=443`, o redirect foi para
`https://localhost/` (a porta padrão some da URL). Esse é o conserto atrás de um
proxy que termina o TLS: o Kestrel só vê HTTP, então você informa a porta pública
explicitamente e faz o `UseForwardedHeaders` rodar antes, como o conceito de
hosting explica.

### HSTS: um cabeçalho que o navegador lembra

O `Strict-Transport-Security` diz ao navegador: pelos próximos `max-age`
segundos, fale com este host só por HTTPS, mesmo que o usuário digite
`http://`. Isso elimina o primeiro salto desprotegido que um redirect sempre
deixa. As opções e seus padrões, segundo a documentação: `MaxAge` é 30 dias,
`IncludeSubDomains` e `Preload` vêm desligados, e `ExcludedHosts` contém
`localhost`, `127.0.0.1` e `[::1]`. Os templates chamam `UseHsts` só fora de
Development, porque o cabeçalho é "altamente cacheável" pelos navegadores e uma
rodada no `localhost` prenderia os seus outros projetos locais ao HTTPS.

Observado no app acima (`UseHsts` antes do middleware de redirect):

```text
https://localhost:5301/   (ExcludedHosts padrão)      -> sem cabeçalho Strict-Transport-Security
https://localhost:5301/   (ExcludedHosts.Clear())     -> strict-transport-security: max-age=2592000
http://localhost:5300/                                -> 307, e sem HSTS na resposta HTTP
```

`2592000` são 30 dias em segundos. O cabeçalho só sai em respostas HTTPS, e os
navegadores o ignoram quando chega por HTTP puro (RFC 6797).

O estrago acontece no rollout, porque você não consegue desfazer o cabeçalho. A
documentação recomenda começar com um `MaxAge` de horas, no máximo um dia, para
poder reverter, e aumentar (comumente para um ano) quando tiver certeza.
`IncludeSubDomains` compromete todo subdomínio com HTTPS, inclusive aquele interno
esquecido. `Preload` não faz parte da RFC 6797: ele inscreve você nas listas de
preload dos navegadores, o que na prática é permanente.

```csharp
builder.Services.AddHsts(o =>
{
    o.MaxAge = TimeSpan.FromHours(6);   // primeiro rollout; aumente depois
    o.IncludeSubDomains = false;        // só quando todo subdomínio servir HTTPS
});
```

### Redirecionar para um returnUrl: IsLocalUrl

Uma página de login que faz `Results.Redirect(returnUrl)` redireciona
tranquilamente para `https://evil.com/phish` se a query string mandar. Observado:

```text
GET /go?returnUrl=https://evil.com/phish   (Results.Redirect)  -> 302, Location: https://evil.com/phish
```

O ASP.NET Core 10 trouxe `RedirectHttpResult.IsLocalUrl(url)` (documentado nas
release notes do ASP.NET Core 10). Uma URL é local quando não tem a seção de host
ou authority e tem um caminho absoluto; caminhos virtuais `~/` também contam como
locais. Estes são resultados reais do helper:

```text
/home                -> True        /a/b?x=1             -> True
~/x                  -> True        //evil.com           -> False
/\evil.com           -> False       https://evil.com     -> False
http://localhost:5300/x -> False    "" e x/y             -> False
```

Repare que uma URL absoluta para o seu próprio host também dá `False`: a
checagem olha o formato, não em qual site você está. Use como guarda:

```csharp
app.MapGet("/safe", (string? returnUrl) =>
    RedirectHttpResult.IsLocalUrl(returnUrl)
        ? Results.LocalRedirect(returnUrl!)
        : Results.Redirect("/"));
```

`/safe?returnUrl=https://evil.com/phish` respondeu `302` para `/`, e
`/safe?returnUrl=/dashboard` respondeu `302` para `/dashboard`. O
`Results.LocalRedirect` já aplica a regra lançando exceção; com
`https://evil.com` ele produziu um `500` com
`InvalidOperationException: The supplied URL is not local.` É seguro, mas feio,
então cheque antes e caia numa página padrão.

### APIs são diferentes de sites

A documentação diz que uma web API deve ou não escutar em HTTP, ou fechar a
conexão com `400` em vez de atender. Redirecionar um cliente de API é arriscado
porque ele pode não seguir o redirect, ou já ter mandado o corpo por HTTP. A
documentação acrescenta que `UseHttpsRedirection` num endpoint HTTP causa
`ERR_INVALID_REDIRECT` em preflights de CORS, e que os templates de API não
incluem HSTS porque ele é uma instrução só para navegadores. Para uma API pura,
faça o bind só em HTTPS (`ASPNETCORE_URLS` ou `--urls`).

### O certificado de desenvolvimento

O `dotnet dev-certs https` gerencia o certificado de desenvolvimento. Segundo a
documentação, a primeira execução o instala no repositório do usuário como não
confiável, `--trust` é o passo único de confiança no Windows e no macOS (no Linux
depende da distribuição), `--clean` o remove, e `-ep <arquivo> --format PEM` o
exporta. Não o crie em imagens ou VMs que serão redistribuídas; defina
`DOTNET_GENERATE_ASPNET_CERTIFICATE=false` antes da primeira chamada da CLI.
Esses comandos alteram o repositório de certificados do usuário, então os
experimentos acima os evitaram e usaram um certificado descartável com `curl -k`.
O `-k` serve só para experimentos locais.

## Trade-offs

- **Redirect sem porta é um no-op silencioso.** O app sobe, serve HTTP, e só uma
  linha de log avisa.
  ```csharp
  builder.Services.AddHttpsRedirection(o => o.HttpsPort = 443); // explícito atrás de proxy
  ```
- **HSTS é uma porta de mão única por `max-age` segundos.** Um erro não volta
  atrás pelo servidor; comece com horas e aumente quando o HTTPS estiver provado
  em todos os hosts do domínio.
- **`Preload` e `IncludeSubDomains` ampliam o compromisso.** Servem para um site
  pronto e erram para um com subdomínios HTTP legados.
- **O redirect ainda deixa a primeira requisição trafegar em texto claro.** O
  HSTS fecha essa janela só depois que o navegador viu o cabeçalho uma vez; numa
  API, recusar HTTP é mais forte que redirecionar.
- **`IsLocalUrl` checa o formato, não a intenção.** Ele bloqueia destinos
  externos, mas não impede um caminho local que leva a uma página que você não
  queria expor; a autorização continua valendo depois do redirect.

## Documentation Links

- [Enforce HTTPS in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [Prevent open redirect attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/preventing-open-redirects) (doc)
- [HTTP Strict Transport Security Protocol, RFC 6797](https://www.rfc-editor.org/rfc/rfc6797) (doc)
