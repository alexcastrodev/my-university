---
version: 1.0
updatedAt: 2026-11-12
title: "Novidades do ASP.NET Core 11: um Mapa"
summary: Um mapa das notas de versão do ASP.NET Core 11 separando o que é automático, o que exige uma chamada e o que pode quebrar, dizendo o que foi executado no SDK 11.0.100 GA e o que vem só da página oficial, com link para o conceito que aprofunda cada item.
---
## Objective

O ASP.NET Core 11 saiu junto com o .NET 11 GA em 2026-11-10. Como o mapa do
.NET 10 (`whats-new-in-aspnet-core-10`), este conceito é um guia das notas de
versão: poucas linhas por mudança, agrupadas pelo que você precisa fazer a
respeito, com link para o conceito que aprofunda. O agrupamento é o ponto.
Algumas mudanças são automáticas, outras pedem uma chamada, e outras podem
quebrar um app que funciona.

Cada item diz como eu sei. "Executado no GA" significa que um programa pequeno
no SDK 11.0.100 produziu a saída citada. "Notas de versão" significa que estou
repassando a página oficial e não executei. A lista do que quebra, com antes e
depois nos dois SDKs, está em `migrating-from-aspnet-core-10-to-11`.

## Use Cases

- Decidir o que testar em um upgrade do .NET 10, o LTS atual.
- Achar o conceito que explica uma funcionalidade vista nas notas de versão.
- Separar mudanças automáticas (nada a fazer) de opt-in (uma chamada ou um
  pacote) e de breaking (podem alterar um resultado do qual você depende).
- Integrar alguém que conhece o ASP.NET Core 10 e precisa só do delta.

## Deep Dive

### Automático: você ganha ao trocar o target

- **Checagem de CSRF em posts de formulário.** O `WebApplication.CreateBuilder`
  registra um middleware que julga as requisições por `Sec-Fetch-Site` e
  `Origin`, e endpoints que consomem formulário respondem 400 a um post
  cross-site. Executado no GA: um endpoint `[FromForm]` deu 200 same-origin, 200
  sem cabeçalhos e 400 cross-site. A história completa, as exceções e um lab
  estão em `csrf-protection-antiforgery-tokens-and-fetch-metadata`.
- **Tags de hosting no span da requisição.** Só com o `ActivitySource` do
  próprio framework e sem pacote do OpenTelemetry, um listener viu um span
  chamado `GET /hello` com `client.address`, `network.peer.address`,
  `server.port`, `http.request.method`, `url.scheme`, `url.path` e
  `http.response.status_code`, entre outras. Executado no GA. Se você também usa
  um pacote de instrumentação antigo, pode ver tags duplicadas (notas de
  versão). Veja `opentelemetry-logs-metrics-and-traces`.
- **A compressão de resposta ganha zstd e um cabeçalho `Vary`.** Executado no
  GA com `AddResponseCompression`: `Accept-Encoding: zstd` deu
  `Content-Encoding: zstd`, e `zstd, br, gzip` escolheu zstd. Toda resposta
  desse teste trouxe `Vary: Accept-Encoding`, inclusive uma que não foi
  comprimida.
- **`Retry-After` exato.** Um limitador de janela fixa de uma requisição por 30
  segundos respondeu à segunda com 429 e `Retry-After: 29`. Executado no GA. As
  tabelas e o código do cabeçalho opt-in estão em
  `rate-limiting-and-request-timeouts`.
- **Kestrel mais estrito.** As checagens de conformidade de protocolo ficaram
  mais rígidas em HTTP/1.1, HTTP/2 e HTTP/3, e há diagnósticos do handshake TLS
  (notas de versão, não executado). O contexto de hosting está em
  `kestrel-iis-and-hosting-models`.
- **Falhas de hosted service chegam ao `RunAsync`, o descarte de escopo agrega
  erros, e a configuração encadeada vazia vence.** Três mudanças de
  comportamento em runtime que executei nos dois SDKs; as três estão no
  conceito de migração.

### Opt-in: uma chamada ou um atributo

- **Validação assíncrona.** O `AddValidation()` agora executa regras
  assíncronas, por `AsyncValidationAttribute` em uma propriedade e
  `IAsyncValidatableObject` em um tipo. Executado no GA: uma regra que devolvia
  erro para um e-mail já usado produziu um 400 `application/problem+json` com o
  erro em `Email`, um tipo cujo `ValidateAsync` devolvia `End must be after
  Start` produziu `errors: {"End": ...}`, e a requisição válida retornou 201.
  As duas APIs obrigam você a implementar também o caminho síncrono (`IsValid`
  é abstrato, e `IAsyncValidatableObject` estende `IValidatableObject`); na
  execução com Minimal API eu lancei exceção nele e ele nunca foi chamado.
  Regras e mensagens: `input-validation-in-minimal-apis`.
- **`[ShortCircuit]` como atributo.** `[ShortCircuit(404)]` em um handler
  devolveu 404 sem rodar o resto do pipeline, ao lado do `.ShortCircuit(418)`
  que já existia. Executado no GA. Veja
  `route-constraints-short-circuit-and-handler-results`.
- **`IOutputCachePolicyProvider`.** O `AddOutputCache()` o registra, então
  políticas podem ser resolvidas em runtime (por exemplo, por tenant).
  Executado no GA: o serviço resolve. Não montei um provider com políticas
  reais. Veja `output-caching-and-http-caching`.
- **`HttpMethod.Query`, TempData e Session no Blazor SSR, `CacheView`, estado
  do `QuickGrid` na URL, ancoragem do `Virtualize`, `DisplayName`, `BasePath`,
  refresh de autenticação no SignalR.** Tudo nas notas de versão e conferido só
  contra o build RC3, sem nova execução no GA, então não dou saída. Comece por
  `blazor-static-ssr-and-enhanced-navigation`,
  `blazor-forms-editform-and-validation` e `signalr-websockets-and-sse`.
- **Passkeys e Identity.** Mudanças de confirmação e lockout e nomes de passkey,
  segundo as notas de versão (não executado). Veja
  `jwt-bearer-and-aspnet-core-identity`.

### Breaking: pode alterar um resultado

- **O OpenAPI 3.2 é o default.** O `AddOpenApi()` escreveu `"openapi": "3.2.0"` e
  o `OpenApi3_1` escreveu `3.1.2`. Executado no GA. O pacote agora exige
  `Microsoft.OpenApi` 3.x: um projeto com pin em 2.7.5 falhou no restore com
  `NU1605`. Detalhes em `openapi-document-generation`, correção no conceito de
  migração.
- **O template do Blazor não chama mais `UseAntiforgery()`.** As páginas com
  formulário dependem da checagem automática, a menos que você recoloque a
  chamada. Executado no GA: o `Program.cs` gerado não tem `UseAntiforgery`.
- **APIs removidas.** O middleware `ConcurrencyLimiter`,
  `SetCompatibilityVersion`, `Router.PreferExactMatches` e
  `AddDataAnnotationsValidation`, segundo a lista de breaking changes (não
  executado).

### Experimental ou preview

As notas de versão também descrevem Device Bound Session Credentials e novos
componentes de IA do Blazor. Os dois estão marcados como experimentais. Não
são cobertos nesta trilha, e não executei nenhum. Não planeje trabalho de
produção em cima deles.

## Trade-offs

- **Um mapa não é uma receita.** Duas linhas dizem que uma funcionalidade
  existe, não como ela falha. Leia o conceito para o qual o link aponta antes de
  adotar.
- **Automático não é de graça.** A checagem de CSRF, as tags de hosting e o
  cabeçalho `Vary` mudam o que seus clientes e sua telemetria enxergam sem uma
  linha do seu código. Um cache ou um dashboard que depende do formato antigo
  merece uma olhada.
- **Funcionalidades opt-in custam uma chamada esquecida.**
  ```csharp
  builder.Services.AddValidation(); // regras assíncronas são ignoradas sem ele
  ```
- **Alguns itens das notas de versão ainda não têm conceito.** As APIs de estado
  do Blazor SSR, o `QuickGrid`, o `Virtualize` e o refresh do SignalR são
  descritos, não ensinados aqui. Verifique em um app rodando antes de confiar.
- **O .NET 11 não é o LTS.** Adote-o por uma funcionalidade de que você precisa.
  Veja `dotnet-support-lifecycle-and-choosing-a-target` para saber por quanto
  tempo cada versão é suportada.
- **Notas de versão envelhecem.** A página está ligada à versão 11.0. Confira de
  novo para o patch que você roda.

## Documentation Links

- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11) (doc)
- [Breaking changes in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/overview) (doc)
- [Migrate from ASP.NET Core 10 to 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/100-to-110) (doc)
- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
