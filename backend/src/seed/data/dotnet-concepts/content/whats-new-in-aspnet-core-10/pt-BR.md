---
version: 1.0
updatedAt: 2026-10-15
title: "Novidades do ASP.NET Core 10: um Mapa"
summary: Um mapa das novidades do ASP.NET Core 10 conferidas na página oficial, agrupadas em hosting, Minimal APIs, OpenAPI, Blazor e Identity, com link para o conceito que aprofunda cada uma.
---
## Objective

A página "What's new in ASP.NET Core 10" é longa: cobre Blazor, Minimal APIs,
OpenAPI, autenticação e uma lista variada de mudanças no servidor. Este
conceito é um mapa dessa página. Cada mudança ganha poucas linhas aqui, e as que
já têm um conceito completo nesta trilha apontam para ele. Leia antes de uma
atualização para saber quais áreas testar, depois siga os links para os
detalhes.

Tudo abaixo foi conferido na página oficial de release notes. O que a página
não afirma não é afirmado aqui.

## Use Cases

- Planejar a atualização do .NET 9 e decidir quais mudanças pedem uma rodada de
  testes.
- Achar o conceito que explica uma novidade que você viu nas release notes.
- Separar o que é automático (nada a fazer) do que é opt-in (uma chamada ou um
  pacote) e do que pode quebrar código existente.
- Apresentar a quem já conhece o ASP.NET Core 9 só o que mudou.

## Deep Dive

### Hosting e servidor

- **Liberação de memória nos pools.** Os memory pools do Kestrel, IIS e
  HTTP.sys agora devolvem blocos sem uso quando o app está ocioso ou com pouca
  carga, sem configuração. As métricas aparecem no meter
  `Microsoft.AspNetCore.MemoryPool`, e um `IMemoryPoolFactory<T>` embutido fica
  disponível via DI. A história completa está em
  `kestrel-iis-and-hosting-models`.
- **Domínio `.localhost`.** O Kestrel faz bind de nomes `*.localhost` no
  loopback, e `dotnet new web --localhost-tld` usa nomes `*.dev.localhost`.
- **Security descriptor do HTTP.sys.** `HttpSysOptions.RequestQueueSecurityDescriptor`
  personaliza quem pode acessar uma request queue recém-criada.
- **JSON com PipeReader.** MVC, Minimal APIs e `ReadFromJsonAsync` usam um
  parser JSON baseado em PipeReader sem mudar código. Converters customizados
  que ignoram `Utf8JsonReader.HasValueSequence` podem falhar.

### Minimal APIs e validação

- **Validação embutida.** `AddValidation()` valida query, header e body com data
  annotations, devolve 400 com detalhes e pode ser desligada por endpoint com
  `.DisableValidation()`. Records funcionam como classes. As APIs foram para o
  pacote `Microsoft.Extensions.Validation`, e as falhas podem passar pelo
  `IProblemDetailsService`. Veja `input-validation-in-minimal-apis` e
  `problem-details-and-global-exception-handling`.
- **Strings vazias em formulário.** Com `[FromForm]` em um tipo complexo, string
  vazia agora vira `null` em tipos de valor anuláveis como `DateOnly?`. As
  regras de binding estão em `parameter-binding-and-endpoint-filters`.
- **Server-Sent Events.** `TypedResults.ServerSentEvents` transmite um
  `IAsyncEnumerable<SseItem<T>>` em Minimal APIs e controllers. Ainda sem
  conceito próprio, então a página oficial é a fonte.
- **JSON Patch sobre System.Text.Json.** Uma nova implementação vem no pacote
  `Microsoft.AspNetCore.JsonPatch.SystemTextJson`. A página diz que ela não é
  substituta direta (sem tipos dinâmicos como `ExpandoObject`) e que não mitiga
  os riscos de segurança inerentes ao padrão JSON Patch.
- **`RedirectHttpResult.IsLocalUrl(url)`.** Um helper que diz se uma URL é
  local, pensado para proteger redirecionamentos contra open redirect.
- **Testar apps com top-level statements.** Um source generator agora emite
  `public partial class Program` quando você não escreveu, e um analyzer sinaliza
  a declaração explícita.

### OpenAPI

- OpenAPI 3.1 é a versão gerada agora, o `Microsoft.OpenApi` vai para a 2.0, o
  YAML sai por sufixo de rota `.yaml` ou `.yml`, comentários XML alimentam o
  documento, os atributos `Produces*` aceitam `Description` e transformers podem
  ser por endpoint. Transformers escritos para 3.0 precisam de ajuste. Tudo isso
  está em `openapi-document-generation`.

### Blazor

- **Validação de formulários.** O `DataAnnotationsValidator` agora trata objetos
  aninhados e itens de coleção, depois de `AddValidation()` e de uma raiz com
  `[ValidatableType]`. Veja `blazor-forms-editform-and-validation`.
- **Not Found.** `NavigationManager.NotFound`, o parâmetro `NotFoundPage` do
  `Router`, e o fim do render fragment `<NotFound>`. Veja
  `blazor-routing-layouts-and-navigation`.
- **Estado declarativo.** `[PersistentState]` substitui o código manual de
  `PersistentComponentState` no prerendering, e o estado do circuito pode
  sobreviver a desconexões longas. O contexto do prerendering está em
  `blazor-data-access-and-streaming-rendering`.
- **Itens menores.** O `QuickGrid` ganhou `RowClass` e `HideColumnOptionsAsync`,
  `InputHidden` é novo, o JS interop ganhou `InvokeConstructorAsync`,
  `GetValueAsync` e `SetValueAsync`, e o script do Blazor virou um static web
  asset com fingerprint. As escolhas de hosting continuam em
  `blazor-render-modes-and-hosting-models`.

### Identity e observabilidade

- **Passkeys.** O ASP.NET Core Identity suporta passkeys WebAuthn, e o template
  de Blazor Web App já traz isso.
- **Métricas.** Novas métricas de autenticação, autorização e Identity, além de
  métricas e tracing do Blazor.
- **Cookies amigáveis a API.** Em endpoints marcados com `IApiEndpointMetadata`,
  a autenticação por cookie devolve 401 ou 403 em vez de redirecionar.
- **Diagnóstico de exceções.** `ExceptionHandlerOptions.SuppressDiagnosticsCallback`
  controla o log de exceções que um `IExceptionHandler` já tratou.

## Trade-offs

- **Um mapa não é uma receita.** Três a seis linhas dizem que a novidade existe,
  não como ela falha. Para tudo que tem link, leia o conceito profundo antes de
  adotar.
- **Automático não é de graça.** A liberação de memória e o JSON com PipeReader
  não pedem código, mas os dois podem mudar o comportamento sob carga ou com
  converters incomuns, então rode teste de carga numa atualização mesmo sem
  mudar nada no seu código. Recursos opt-in custam uma chamada, fácil de
  esquecer.
  ```csharp
  builder.Services.AddValidation(); // sem isso, as annotations não são aplicadas
  ```
- **Breaking changes se escondem em listas de novidades.** A página lista
  mudanças como o response streaming do `HttpClient` do Blazor WebAssembly
  ligado por padrão e o fragment `<NotFound>` não mais suportado. Leia cada item
  de Blazor e OpenAPI como possível tarefa de migração, não só como ganho.
- **Algumas novidades ainda não têm conceito aqui.** SSE, JSON Patch,
  `IsLocalUrl`, passkeys e as métricas só são descritos. Trate a página oficial
  como fonte e confirme num app rodando antes de depender deles.
- **Release notes envelhecem.** A página é da versão .NET 10. Versões futuras
  podem mudar padrões, então reveja a página para a sua versão exata.

## Documentation Links

- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Breaking changes in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/breaking-changes) (doc)
- [Generate OpenAPI documents, ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
