---
version: 1.0
updatedAt: 2026-11-12
title: "Proteção contra CSRF: Tokens Antiforgery e Fetch Metadata"
summary: Os dois mecanismos de CSRF do ASP.NET Core, o token antiforgery e a checagem automática do .NET 11 por Sec-Fetch-Site e Origin, quem dá o veredito final, como abrir exceções (webhook, site parceiro via CORS), o que um endpoint JSON não recebe e como DisableAntiforgery e DisableCsrfProtection se comportam, com os códigos de status de cada caso medidos em testes.
---
## Objective

Cross-site request forgery (CSRF) explora o fato de que o navegador anexa os
seus cookies a uma requisição, não importa qual página a iniciou. Uma página em
`evil.example` pode enviar um formulário para `bank.example`, e o navegador manda
junto o cookie de sessão do banco. O ASP.NET Core tem duas defesas: o token
antiforgery (um cookie mais um campo oculto que só uma página do seu próprio
site consegue ler) e, novo no .NET 11, um middleware automático que rejeita
posts de formulário cross-site usando os cabeçalhos `Sec-Fetch-Site` e `Origin`
que o navegador define.

Este conceito explica as duas, qual delas tem a palavra final quando
discordam, como abrir uma exceção deliberada (um webhook, um site parceiro de
confiança) e o que nenhuma das duas protege. Todo código de status abaixo vem
de um teste que envia os cabeçalhos à mão para um app real no SDK 11.0.100.

## Use Cases

- Proteger um app com autenticação por cookie que recebe formulários (Razor
  Pages, MVC, Blazor SSR estático, `[FromForm]` em Minimal API).
- Atualizar do .NET 10 e se perguntar por que um post de formulário cross-site
  agora responde 400, ou por que o template do Blazor parou de chamar
  `UseAntiforgery()`.
- Deixar um provedor de pagamento ou um site parceiro postar em um endpoint
  sem desligar a proteção do app inteiro.
- Revisar uma API e decidir se um endpoint JSON precisa de proteção contra CSRF.

## Deep Dive

### O ataque e o que o navegador informa

Uma requisição forjada é uma requisição normal com o cookie da vítima,
iniciada por uma página que a vítima abriu por acaso. O servidor não a
distingue de uma legítima só pelo cookie. Os navegadores ajudam com dois
cabeçalhos que o JavaScript da página não consegue definir nem alterar (ambos
são forbidden request headers):

- `Sec-Fetch-Site` diz como o iniciador se relaciona com o alvo: `same-origin`,
  `same-site` (mesmo domínio registrável, origem diferente, como um subdomínio
  irmão), `cross-site`, ou `none` (o usuário digitou a URL ou usou um favorito).
- `Origin` carrega a origem do iniciador em requisições de escrita e é o
  recurso de reserva para navegadores anteriores ao Fetch Metadata.

Uma requisição sem nenhum dos dois cabeçalhos quase sempre é um cliente que
não é navegador (curl, um app mobile, um servidor chamando sua API). CSRF é um
ataque de navegador, então esses clientes não são o alvo.

### A checagem automática do .NET 11

O `WebApplication.CreateBuilder` registra por padrão um middleware de CSRF. Ele
não emite nem valida tokens. Aplica estas regras em ordem, e a primeira que
casar vale (segundo a
[página de anti-request-forgery](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery)):

1. Métodos seguros (`GET`, `HEAD`, `OPTIONS`, `TRACE`) passam.
2. `Sec-Fetch-Site` igual a `same-origin` ou `none` passa.
3. Uma requisição cujo `Origin` é permitido pela política de CORS do endpoint,
   quando essa política tem `AllowCredentials()`, passa.
4. Qualquer outro valor de `Sec-Fetch-Site` (`cross-site`, `same-site`) é negado.
5. Sem `Sec-Fetch-Site`, mas com `Origin`: ele precisa bater com o esquema,
   host e porta da própria requisição.
6. Nenhum dos dois cabeçalhos: permitido.

O middleware só registra um veredito. O 400 vem de quem lê o formulário: um
endpoint de Minimal API com parâmetro `[FromForm]`, uma action de MVC protegida
por antiforgery, um endpoint de Blazor SSR ou código que lê `Request.Form`. O
app do lab não tem `UseAntiforgery()` e tem um endpoint de formulário, e o
cliente de teste faz o papel do navegador:

```csharp
app.MapPost("/transfer", ([FromForm] string to) => $"sent to {to}");
```

```text
                                         status  motivo
sem cabeçalhos (curl)                      200   regra 6
Sec-Fetch-Site: same-origin                200   regra 2
Sec-Fetch-Site: none                       200   regra 2
Sec-Fetch-Site: cross-site, Origin: evil   400   regra 4
Sec-Fetch-Site: same-site                  400   regra 4
só Origin: https://evil.example            400   regra 5
Origin igual à origem do próprio app       200   regra 5
```

Repare em `same-site`: um subdomínio irmão como `blog.example` postando para
`app.example` é negado, porque não é a mesma origem. É o caso que pega uma
empresa com muitos subdomínios que compartilham o domínio do cookie.

### O token antiforgery

O sistema de tokens funciona de outro jeito: o servidor entrega à página um par
de tokens. Uma metade vive em um cookie, a outra em um campo oculto do
formulário (ou em um cabeçalho), e uma requisição forjada de outro site envia o
cookie, mas não consegue ler o valor do campo. Ligue com `AddAntiforgery()` e
`app.UseAntiforgery()`. Razor Pages, MVC e formulários Blazor renderizam o campo
por você (`<AntiforgeryToken />` no Blazor); uma página guiada por script pede o
token:

```csharp
app.MapGet("/token", (HttpContext ctx, IAntiforgery antiforgery) =>
{
    var tokens = antiforgery.GetAndStoreTokens(ctx);   // também grava o cookie
    return Results.Ok(new TokenResponse(tokens.FormFieldName, tokens.RequestToken!));
});
```

Com `UseAntiforgery()` ligado, o mesmo endpoint `/transfer` muda de veredito:

```text
same-origin, sem token                                  400
same-origin, cookie + __RequestVerificationToken        200
cross-site + Origin evil, cookie + token válidos        200
token válido enviado no cabeçalho RequestVerificationToken 200
token de outro cliente (outro cookie)                   400
```

O token dá o veredito final. Quando os dois middlewares rodam, o de token roda
em segundo lugar e substitui o primeiro veredito: uma requisição que a checagem
por cabeçalho negou passa a ser válida com um token válido, e uma que a
checagem permitiu passa a ser inválida sem token. Passar cross-site com token
válido não é uma brecha, porque só uma página que conseguiu ler o token
consegue enviá-lo. O nome do campo é `__RequestVerificationToken`, e o token
precisa do key ring do Data Protection (veja
`data-protection-key-ring-and-purposes`).

### Abrindo uma exceção: `DisableAntiforgery()`

Um provedor de pagamento posta um formulário em `/webhook` a partir do próprio
site e não consegue enviar o seu token. Tire esse endpoint da proteção e defenda
de outro modo:

```csharp
app.MapPost("/webhook", ([FromForm] string eventName, HttpRequest request) =>
        request.Headers["X-Webhook-Secret"] == "s3cret"
            ? Results.Ok($"handled {eventName}")
            : Results.Unauthorized())
    .DisableAntiforgery();
```

```text
POST cross-site com o segredo         200
POST cross-site sem o segredo         401   (não 400: a checagem de CSRF não roda mais)
com UseAntiforgery() ligado, com segredo  200
```

`DisableAntiforgery()` adiciona `IAntiforgeryMetadata { RequiresValidation = false }`,
que os dois middlewares respeitam. O `[IgnoreAntiforgeryToken]` do MVC faz o
mesmo. A exclusão só é segura quando o endpoint não é alcançável com
autenticação por cookie ambiente: um segredo compartilhado, uma assinatura ou um
bearer token é o que o protege agora. Excluir um endpoint que um usuário logado
alcança por cookie reconstrói a vulnerabilidade.

### Abrindo uma exceção: um site parceiro de confiança

Para um formulário de navegador em `https://partner.example` que posta na sua
API com cookies, declare a origem pelo CORS e exija a política no endpoint:

```csharp
builder.Services.AddCors(o => o.AddPolicy("partner", p => p
    .WithOrigins("https://partner.example")
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
// ...
app.UseCors();
app.MapPost("/partner-transfer", ([FromForm] string to) => $"partner sent to {to}")
   .RequireCors("partner");
```

```text
cross-site, Origin partner.example   200
cross-site, Origin evil.example      400
```

Dois detalhes da documentação importam. `AllowCredentials()` é obrigatório para
haver confiança: uma origem permitida sem ele cai na regra 4. E
`AllowAnyOrigin()` nunca é tratado como confiança, porque "qualquer navegador
pode ler isto" não é "qualquer site pode escrever em nome do usuário". Uma
política montada com `SetIsOriginAllowed` ou com subdomínios curinga é confiável
para toda origem que aceita, então um curinga sobre subdomínios que você não
controla por completo vira uma brecha de CSRF. O lado do CORS está em
`cors-for-spa-and-wasm-clients`.

### O que endpoints JSON recebem e o que não recebem

`/api/transfer` recebe um corpo JSON, nunca lê formulário, não tem metadado de
antiforgery e responde 200 a uma requisição que diz `cross-site` vinda de
`evil.example` (com e sem `UseAntiforgery()`). Nenhum dos dois mecanismos a
checa: o veredito é registrado e nada o aplica.

Isso não é automaticamente um bug, porque uma página de outra origem não
consegue enviar `Content-Type: application/json` sem um preflight de CORS, e o
preflight falha a menos que você permita a origem. É outra defesa, com brechas
próprias: um endpoint que aceita `text/plain` ou corpo de formulário para a
mesma ação, uma política de CORS permissiva ou um handler que ignora o
content type reabrem o problema. Trate "JSON" como uma propriedade que você
impõe (rejeite outros content types em endpoints que alteram estado), não como
um selo de segurança. APIs com token (bearer enviado em cabeçalho por script)
não são alvo de CSRF, já que o navegador nunca os anexa sozinho.

### Desligando, e o que você perde

`DisableCsrfProtection=true` (configuração ou `ASPNETCORE_DisableCsrfProtection`)
remove o middleware do app inteiro. É uma válvula de escape. A documentação
avisa que o middleware automático também satisfaz a exigência de "um middleware
de antiforgery rodou" dos endpoints de formulário, então um app que depende
dele e não tem nem ele nem `UseAntiforgery()` falha ao servir esse formulário.
No .NET 10, essa mesma falta de middleware já lançava
`InvalidOperationException: ... contains anti-forgery metadata, but a
middleware was not found that supports anti-forgery`, um 500. Um app de teste
com a chave ligada e sem `UseAntiforgery()` respondeu 500 em um endpoint
`[FromForm]` para um post cross-site, um same-origin e um sem cabeçalhos, e 200
só no endpoint que chamou `DisableAntiforgery()`, o que confere com o aviso. O
`ICsrfProtection` padrão pode ser substituído por regras suas (uma allowlist,
um cabeçalho próprio), o que li na documentação e não executei.

## Trade-offs

- **Cabeçalhos versus tokens.** A checagem por cabeçalho não precisa de estado
  nem de chaves do Data Protection, então serve para um app mínimo, mas confia
  que o navegador envia `Sec-Fetch-Site` ou `Origin`. Um cliente que não envia
  nenhum dos dois passa, por projeto. Mantenha os tokens quando precisar
  suportar navegadores que não enviam nenhum, quando levar dados dentro do
  token ou quando uma revisão pedir uma camada independente.
- **Os dois juntos funcionam.** A checagem de token roda em segundo e vence,
  então adicionar `UseAntiforgery()` a um app que já tem a checagem por
  cabeçalho só o deixa mais estrito: um post de formulário sem token é 400 até
  da mesma origem. Todo script que posta formulários precisa buscar e enviar o
  token.
  ```csharp
  var token = await client.GetFromJsonAsync<TokenResponse>("/token");
  ```
- **Toda exclusão é uma promessa.** `DisableAntiforgery()` e
  `[IgnoreAntiforgeryToken]` removem a checagem também para quem usa cookie.
  Coloque a substituição (segredo, assinatura, bearer token) ao lado da
  exclusão.
- **Confiança de CORS é confiança de CSRF.** Adicionar uma origem com
  credenciais a uma política para um SPA também deixa essa origem postar
  formulários nos endpoints que usam a política. Mantenha a lista explícita e
  curta.
- **`same-site` não é seguro.** Subdomínios compartilham cookies e são negados
  pela checagem por cabeçalho. Se um subdomínio irmão hospeda conteúdo de
  usuário, um takeover ali é uma fonte de CSRF contra o domínio pai.
- **Checagem por teste não é navegador.** O lab envia os cabeçalhos à mão, que
  é exatamente o que o servidor vê, mas não prova o que um navegador específico
  envia. Teste o fluxo real uma vez com a aba de rede do navegador.

## Lab

Neste lab você recebe uma API em que os endpoints de formulário existem, mas sem nenhuma ligação: nem serviços de antiforgery, nem política de CORS, nem endpoint de token, nem exclusão para o webhook. Você liga tudo isso e lê cada código de status como o veredito de um mecanismo específico. Os testes fazem o papel do navegador adicionando cabeçalhos `Sec-Fetch-Site` e `Origin` pelo `WebApplicationFactory`, então não é preciso navegador. O lab usa `net11.0` e precisa do SDK 11. Sem Docker.

**O cenário**

O `Program.cs` tem `/transfer` (um formulário), `/webhook` (um formulário postado por um provedor de pagamento, protegido por um segredo compartilhado), `/partner-transfer` (um formulário postado por um site parceiro de confiança), `/api/transfer` (JSON) e `/token`. Uma chave de configuração, `Csrf:UseTokens`, deixa um único app mostrar as duas fases: só a checagem automática e depois o token como veredito final.

**O que você vai fazer, passo a passo**

1. **Registrar os serviços (TODO-00 e TODO-01).** `AddAntiforgery()` e uma política de CORS `partner` para `https://partner.example` com `AllowCredentials()`.
2. **Ligar o pipeline (TODO-02 e TODO-03).** `UseCors()` e `UseAntiforgery()` só quando `Csrf:UseTokens` for true.
3. **Emitir um token (TODO-04).** Em `/token` chame `GetAndStoreTokens` e responda o nome do campo e o request token.
4. **Abrir as duas exceções (TODO-05 e TODO-06).** `.DisableAntiforgery()` em `/webhook` e `.RequireCors("partner")` em `/partner-transfer`.

**Como saber que terminou**

`dotnet test` fica verde. Para cada teste você deve saber dizer se o 400, o 200 ou o 401 veio da checagem automática, do token, do CORS ou do segredo do webhook, e por que `/api/transfer` dá 200 em todas as fases. Repare que um token válido passa mesmo quando os cabeçalhos dizem `cross-site`.

## Documentation Links

- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
- [Blazor SSR defers antiforgery validation to middleware, breaking change, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/blazor-server-side-rendering-deferred-cross-site-request-forgery-protection) (doc)
- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Sec-Fetch-Site, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) (doc)
- [Fetch Metadata Request Headers, W3C](https://www.w3.org/TR/fetch-metadata/) (doc)
- [Cross-Site Request Forgery Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) (doc)
