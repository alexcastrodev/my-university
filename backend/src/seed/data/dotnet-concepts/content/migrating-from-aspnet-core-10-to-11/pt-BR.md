---
version: 1.0
updatedAt: 2026-11-12
title: Migrando do ASP.NET Core 10 para o 11
summary: O checklist do upgrade do LTS para o .NET 11 com o que reproduzi no SDK 11.0.100 GA contra o SDK 10 no mesmo código (NU1605 do Microsoft.OpenApi 3.x, OpenAPI 3.2, RunAsync lançando quando um BackgroundService falha, descarte de escopo agregando exceções, string vazia em configuração encadeada, CSRF automático) e o que vem só da documentação.
---
## Objective

Mover um app ASP.NET Core 10 para o 11 compila para a maioria dos times depois
de trocar o target framework. O custo não está no compilador: está no
comportamento que mudou sem erro de build e em algumas falhas de restore que
parecem problema de pacote. Este conceito é o checklist desse upgrade. Ele fica
no que reproduzi no SDK 11.0.100 GA contra o SDK 10 no mesmo código, e marca
todo o resto como vindo do guia de migração oficial.

Para a lista do que é novo em vez do que quebra, veja
`whats-new-in-aspnet-core-11`. Para o mapa do .NET 10, veja
`whats-new-in-aspnet-core-10`.

## Use Cases

- Planejar o upgrade do LTS .NET 10 para o .NET 11 e dimensionar a rodada de
  testes.
- Ler um build vermelho ou um teste alterado depois de trocar o target e
  perguntar se a causa é o seu código ou o framework.
- Revisar um pull request que muda `TargetFramework` para `net11.0`.
- Decidir se vale migrar (veja `dotnet-support-lifecycle-and-choosing-a-target`).

## Deep Dive

### Troque o target, depois leia o restore

Mude `<TargetFramework>` para `net11.0`, atualize os pacotes do framework
(`Microsoft.AspNetCore.OpenApi` 11.0.0 e outros) e rode o restore. Fixe o SDK
com `global.json` para que um colega em outro SDK não mude o resultado. Dois
fatos de pacote que conferi no nuget.org em 2026-11-12:
`Microsoft.Extensions.Http.Resilience` agora tem a versão estável 11.0.0, e
`Asp.Versioning.Http` ainda não tem 11.x (a última é a 10.2.3). Um pacote sem
11.x não está necessariamente quebrado no net11.0, mas não executei o
`Asp.Versioning` lá, então leia as notas de versão dele antes de presumir.

### OpenAPI: um erro de restore e um default novo

Se o projeto fixa `Microsoft.OpenApi` 2.x ao lado do
`Microsoft.AspNetCore.OpenApi` 11.0.0, o restore falha, porque o pacote novo
pede `[3.11.0, 4.0.0)`:

```text
error NU1605: Warning As Error: Detected package downgrade: Microsoft.OpenApi from 3.11.0 to 2.7.5.
 oa -> Microsoft.AspNetCore.OpenApi 11.0.0 -> Microsoft.OpenApi (>= 3.11.0 && < 4.0.0)
 oa -> Microsoft.OpenApi (>= 2.7.5)
```

Remova o pin ou suba para 3.11.0 ou mais. A correção é uma troca de versão,
mas a major nova também move tipos: código que montava um documento com tipos
da 2.x (transformers, código de schema próprio) precisa de uma passada de
compilação. Com o pin corrigido, a versão gerada também mudou:

```text
AddOpenApi()                              -> "openapi": "3.2.0"
AddOpenApi("v31", o => o.OpenApiVersion = OpenApiSpecVersion.OpenApi3_1) -> "3.1.2"
```

Um teste de snapshot que espera um documento 3.1 ou um gerador de cliente que
não lê 3.2 quebra aqui. Fixe `OpenApi3_1` até suas ferramentas alcançarem. Os
detalhes das diferenças do 3.2 estão em `openapi-document-generation`.

### Um BackgroundService que falha agora faz o RunAsync falhar

O mesmo código, um hosted service que lança em `ExecuteAsync`, nos dois SDKs:

```csharp
class Boom : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct)
        => throw new InvalidOperationException("boom in ExecuteAsync");
}
// host.RunAsync() com AddHostedService<Boom>()
```

```text
.NET 10: RunAsync completed normally
.NET 11: RunAsync threw InvalidOperationException: boom in ExecuteAsync
```

No .NET 10 o `RunAsync` retornava como se nada tivesse dado errado, então o
`Program.cs` simplesmente continuava. No 11 a exceção chega a quem chamou, e uma
exceção não tratada no `Program.cs` encerra o processo como qualquer exceção
não tratada (não medi o código de saída). Para um orquestrador esse é o sinal
certo, mas um job que falhava em silêncio pode agora reiniciar o seu contêiner.

Os controles estão em `hosted-services-and-backgroundservice`. Um que executei:
definir `BackgroundServiceExceptionBehavior.Ignore` em `HostOptions` faz o mesmo
host terminar normalmente nas duas versões (cancelei depois de 500 ms), e a
correção de verdade é capturar dentro do `ExecuteAsync` o que o serviço sabe
recuperar.

### O descarte de escopo relata toda falha

Quando um escopo é descartado, roda o `Dispose` de cada serviço scoped. Dois
serviços scoped cujo `Dispose` lança, resolvidos em um escopo:

```text
.NET 10: InvalidOperationException: D2 dispose failed        d1.disposed=False
.NET 11: AggregateException (D2 dispose failed) (D1 dispose failed)  inner=2  d1.disposed=True
```

No 10 a primeira exceção escapava e o outro serviço nunca era descartado. No 11
todo serviço é descartado e todas as falhas voltam em uma `AggregateException`.
Um `catch (InvalidOperationException)` em volta do descarte de um escopo, ou um
teste que verifica o tipo da exceção, deixa de casar, e um log que imprimia só
`e.Message` agora imprime "One or more errors occurred." primeiro. O lado bom é
que o vazamento acabou. Veja `dependency-injection-and-service-lifetimes`.

### String vazia em configuração encadeada agora vence

Uma fonte de configuração adicionada com `AddConfiguration(outraConfiguracao)`
cuja chave guarda uma string vazia:

```csharp
var inner = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Timeout"] = "" }).Build();
var cfg = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Timeout"] = "30" })
    .AddConfiguration(inner).Build();
```

```text
                                     .NET 10   .NET 11
cfg["Timeout"]                         '30'      ''
cfg.GetValue<int?>("Timeout")           30       null
```

No 10 o valor vazio encadeado era ignorado e o `30` anterior sobrevivia. No 11
a string vazia o sobrescreve, que é como dois providers comuns
(`AddInMemoryCollection` duas vezes) já se comportavam nas duas versões: o
segundo valor vazio vence. O risco é um app que empilha uma configuração base
sob uma específica de ambiente e antes recuperava um default deixando um valor
em branco. Agora recebe uma string vazia, e `GetValue<int?>` devolve `null`.
Confira arquivos `appsettings` e variáveis de ambiente que definem `Chave=` sem
nada depois. O lado das options está em `configuration-and-the-options-pattern`.

### Formulários: a checagem de CSRF e o template

Um endpoint de formulário em Minimal API, `[FromForm]`, sem `UseAntiforgery()`,
postado sem nenhum cabeçalho de navegador:

```text
.NET 10: 500  InvalidOperationException: Endpoint HTTP: POST /transfer contains
              anti-forgery metadata, but a middleware was not found that supports anti-forgery.
.NET 11: 200
```

O 500 sumiu porque o .NET 11 registra um middleware automático de CSRF no
`WebApplication.CreateBuilder`, e ele satisfaz essa exigência. O que você pode
ver agora é outra mudança: um post de formulário cross-site vindo de navegador
para esse endpoint responde 400 (uma requisição sem `Sec-Fetch-Site` e sem
`Origin` passa). Webhooks e formulários de parceiros que postavam de outros
sites precisam de uma exceção explícita, e o template `dotnet new blazor` não
escreve mais `app.UseAntiforgery()`. As duas coisas estão explicadas, com um
lab, em `csrf-protection-antiforgery-tokens-and-fetch-metadata`. Se você mantém
o `UseAntiforgery()`, o comportamento dos tokens não muda.

### Remoções e tratamento de protocolo mais estrito (da documentação)

Não executei estes no GA. O guia de migração e a lista de breaking changes do
.NET 11 os citam, então trate cada um como "procure no seu código":

- APIs removidas: o middleware `ConcurrencyLimiter` (o rate limiter tem um
  limitador de concorrência), `SetCompatibilityVersion` e `CompatibilityVersion`,
  `Router.PreferExactMatches` e `AddDataAnnotationsValidation`.
- O Kestrel é mais estrito na conformidade de protocolo (por exemplo,
  cabeçalhos proibidos em HTTP/2 e HTTP/3, e uma requisição que envia
  `Content-Length` e `Transfer-Encoding` juntos em HTTP/1.1). Um proxy ou
  cliente que dependia da tolerância pode passar a falhar.
- A navegação aprimorada do Blazor não pré-carrega mais recursos.

### Uma rotina que funciona

1. Crie um branch, troque o target, fixe o SDK, restaure. Corrija o `NU1605` e
   os limites de pacote.
2. Compile e procure no código as APIs removidas acima.
3. Rode a suíte inteira de testes, não só os unitários: as mudanças deste
   conceito vivem em comportamento de integração (hosting, descarte de DI,
   configuração, formulários).
4. Suba o app em uma cópia de staging e leia o primeiro minuto de logs e o
   código de saída de uma falha forçada.
5. Gere de novo os documentos OpenAPI e compare com os versionados.

## Trade-offs

- **Mudança silenciosa vence erro de compilador.** Todo item com tabela acima
  compilou e rodou. Só um teste ou uma linha de log mostra a diferença, então
  um upgrade sem testes de integração é um palpite.
- **Algumas correções são código seu, outras são um interruptor.** O
  comportamento `Ignore` dos hosted services e o pin `OpenApi3_1` restauram o
  resultado antigo, mas mantêm um comportamento que você talvez queira
  eliminar. Prefira corrigir a causa (capturar no serviço, atualizar o
  consumidor do documento) e use o interruptor para ganhar tempo.
- **O LTS continua no 10.** O .NET 10 é o LTS, e o 11 é a versão mais nova. O
  upgrade compensa quando você precisa de algo das notas de versão, não por ser
  mais novo. Veja `dotnet-support-lifecycle-and-choosing-a-target`.
- **Terceiros demoram.** Geradores de documento, versionamento de API e
  geradores de cliente saem depois do framework. Confira cada um contra a nova
  versão do OpenAPI e do framework antes da virada.
- **Meus resultados são um app para cada mudança.** As tabelas vêm de programas
  pequenos, um por mudança. O seu código pode cair em uma variante (outra ordem
  de providers, outro caminho de descarte), então use-as como o que procurar, não
  como prova de que está seguro.

## Documentation Links

- [Migrate from ASP.NET Core 10 to 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/100-to-110) (doc)
- [Breaking changes in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/overview) (doc)
- [Breaking changes in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/11) (doc)
- [OpenAPI document version defaults to 3.2, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/openapi-version-default-3-2) (doc)
- [Microsoft.OpenApi 3.x dependency, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/microsoft-openapi-3x) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
