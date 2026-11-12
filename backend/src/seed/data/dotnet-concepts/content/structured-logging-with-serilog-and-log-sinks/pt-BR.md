---
version: 1.0
updatedAt: 2026-11-12
title: "Logging estruturado com Serilog e sinks de log"
summary: Serilog por trás de ILogger no ASP.NET Core, com UseSerilog e logger de bootstrap, message templates contra interpolação, destructuring com máscara, sinks Console JSON e File com rolling configurados no appsettings, LogContext, escopos e enrichers, request logging, redação de dados sensíveis, sink em memória para testes e Serilog contra OpenTelemetry Logs, tudo rodado no .NET 10.
---
## Objective

`ILogger` é a API que o seu código chama; um provider de logging decide o que acontece com cada mensagem. O Serilog é o provider que a maioria dos times .NET escolhe quando quer eventos estruturados, sinks para arquivos e repositórios de log e enriquecimento, e ele se encaixa atrás de `ILogger<T>`, então o código da aplicação não muda. Os providers embutidos, categorias, níveis e `[LoggerMessage]` estão no concept de ILogger; este começa onde aquele termina. Ele liga o Serilog num host ASP.NET Core, lê sinks e níveis do `appsettings.json`, escreve JSON compacto no console e num arquivo com rolling, adiciona request logging e propriedades de contexto, mascara dados pessoais, testa tudo com um sink em memória e compara o Serilog com o caminho do OpenTelemetry. Tudo rodou no .NET 10. Versões usadas: SDK 10.0.100, Serilog 4.4.0, Serilog.AspNetCore 10.0.0, Serilog.Settings.Configuration 10.0.1, Serilog.Sinks.Console 6.1.1, Serilog.Sinks.File 7.0.0, Serilog.Formatting.Compact 3.0.0, Serilog.Enrichers.Environment 3.0.1, Serilog.Sinks.OpenTelemetry 4.2.0, Microsoft.Extensions.Telemetry e Microsoft.Extensions.Compliance.Redaction 10.11.0.

## Use Cases

- Escrever um objeto JSON por linha no console e num arquivo com rolling, com níveis que você muda na configuração.
- Fazer cada linha de uma requisição carregar o tenant, o trace id e o request id sem passá-los de mão em mão.
- Manter a estrutura de um objeto no log (`{@Customer}`) mascarando os campos que não podem ser guardados.
- Verificar num teste que um evento de log tem o template, o nível e as propriedades certos, em vez de comparar texto.

## Deep Dive

### Message templates mantêm os campos, a interpolação os joga fora

O Serilog e o `ILogger` compartilham a ideia de message template: os placeholders são valores nomeados, não posições de formatação. Logei o mesmo pedido duas vezes pelo `ILogger` com o provider do Serilog e imprimi o que o sink recebeu:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", id, total);
log.LogInformation($"Order {id} placed, total {total}");
```

```text
template='Order {OrderId} placed, total {Total}' props=[OrderId=42, Total=9.9, SourceContext="Shop.Orders", Application="shop"]
template='Order 42 placed, total 9,9' props=[SourceContext="Shop.Orders", Application="shop"]
```

A chamada interpolada não tem `OrderId` nem `Total`, e o "template" dela é uma string diferente para cada pedido, então um repositório de logs não consegue agrupar nem filtrar por ela. Ela também formatou o decimal com a vírgula da cultura desta máquina, enquanto a chamada com template guardou o `9.9` bruto. `SourceContext` é a categoria do `ILogger`, e `Application` veio de `Enrich.WithProperty`. Os placeholders se ligam por posição, e o Serilog é tolerante onde o provider de console embutido não é. Com um argumento faltando, o provider de console lançou uma `AggregateException` de dentro da chamada de log (veja o concept de ILogger). Com o Serilog a chamada retornou normalmente e o evento sumiu:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", 42);       // falta um argumento
log.LogInformation("Order {OrderId} placed", 42, 99);                  // sobra um argumento
```

```text
msg='Order 42 placed' props=[OrderId=42, ...]      <- só a segunda chamada chegou
2026-11-12T14:55:02.7235670Z Failed to write event through SerilogLogger: System.IndexOutOfRangeException: Index was outside the bounds of the array.
```

A linha de erro só aparece porque habilitei o `SelfLog`. O build continua avisando (CA2017), então mantenha esse aviso visível e trate o `SelfLog` como o lugar onde o Serilog reporta as próprias falhas.

### Destructuring: `@`, `$` e o padrão

Um objeto passado a um placeholder é guardado como seu `ToString()`, a não ser que você peça a estrutura com `@`. O `$` força a forma em string. Logei um record, um objeto anônimo e um dicionário:

```text
plain {Customer}        "Customer { Id = 5, Email = ana@example.com, Tags = System.String[] }"
destructured {@Customer} Customer { Id: 5, Email: "ana@example.com", Tags: ["a", "b"] }
stringified {$Customer}  "Customer { Id = 5, Email = ana@example.com, Tags = System.String[] }"
anon {@Obj}              { X: 1, Y: { Z: "q" } }
dict {@D}                [("a": 1)]
```

O mesmo `{@Customer}` funcionou pelo `ILogger`, porque o provider do Serilog lê o template, não o ponto de chamada. Os providers embutidos não sabem nada de `@`; ele só vira parte da chave. O destructuring também é onde dados pessoais vazam, porque toda propriedade pública sai. Uma política de destructuring resolve isso para um tipo:

```csharp
.Destructure.ByTransforming<Customer>(c => new { c.Id, Email = Mask(c.Email) })
```

```json
"Customer":{"Id":5,"Email":"a***@example.com"}
```

A transformação vale só para `{@Customer}`. Um placeholder `{Customer}` ainda imprime o `ToString()` e passa por fora dela.

### UseSerilog, AddSerilog e o logger de bootstrap

O host do lab registra o Serilog assim:

```csharp
builder.Host.UseSerilog((context, services, logger) => logger
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .Destructure.ByTransforming<Customer>(c => new { c.Id, Email = Mask(c.Email) }));
```

`ReadFrom.Configuration` monta sinks, níveis e enrichers a partir da seção `Serilog`, e `ReadFrom.Services` pega os pontos de extensão do Serilog registrados no contêiner (o README lista sinks, enrichers e políticas de destructuring; eu exercitei o sink), que é como os testes adicionam o deles. `builder.Services.AddSerilog(...)` (uma extensão de `IServiceCollection`) recebeu a mesma lambda no meu segundo experimento, em `Host.CreateApplicationBuilder`, então é a forma para hosts que não são web. Dois fatos pequenos de montar isso: com `using Serilog;` e `using Microsoft.Extensions.Logging;` no mesmo arquivo, `ILogger` fica ambíguo (`error CS0104`), então use alias ou qualifique um deles; e a lambda que recebe o `IServiceProvider` é a que deixa os sinks usarem serviços registrados.

Logs escritos antes de o host ser construído (erros de configuração, um `Build()` que falha) precisam de um logger que exista antes. `CreateBootstrapLogger` devolve um logger recarregável que o host depois substitui:

```csharp
Log.Logger = new LoggerConfiguration().WriteTo.Console(new CompactJsonFormatter()).CreateBootstrapLogger();
Log.Information("before the host: bootstrap");
builder.Services.AddSerilog((services, lc) => lc.ReadFrom.Configuration(builder.Configuration)
    .Enrich.WithProperty("Phase", "host").WriteTo.Console(new CompactJsonFormatter()));
```

```text
{"@t":"2026-11-12T14:55:43.2006690Z","@mt":"before the host: bootstrap"}
{"@t":"2026-11-12T14:55:43.2664860Z","@mt":"inside the host","SourceContext":"Program","Phase":"host"}
{"@t":"2026-11-12T14:55:43.2671120Z","@mt":"static Log after the host built","Phase":"host"}
```

A terceira linha mostra que o `Log.Logger` estático é o mesmo logger recarregável e agora tem a configuração completa. Num serviço real, coloque o logger de bootstrap e um `try/catch` com `Log.Fatal` e `Log.CloseAndFlush()` em volta do `Program.cs`. Deixei isso de fora do lab de propósito: os testes criam vários hosts no mesmo processo, e um logger estático é estado compartilhado que você não quer ali.

### Sinks a partir do `appsettings.json`

Com o `Serilog.Settings.Configuration` o pipeline inteiro mora na configuração. Este é o arquivo do lab:

```json
"Serilog": {
  "Using": [ "Serilog.Sinks.Console", "Serilog.Sinks.File" ],
  "MinimumLevel": { "Default": "Information", "Override": { "Microsoft.AspNetCore": "Warning" } },
  "WriteTo": [
    { "Name": "Console", "Args": { "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact" } },
    { "Name": "File", "Args": { "path": "logs/lab-.ndjson", "rollingInterval": "Day", "retainedFileCountLimit": 7,
                                "formatter": "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact" } }
  ]
}
```

Subi o app e mandei cinco requisições (um pedido com header de tenant, um cliente, uma recusa, um endpoint que lança exceção e um 404). O console e o arquivo receberam um objeto JSON por linha no formato compacto (`@t` horário, `@mt` template, `@l` nível só quando não é Information, `@x` exceção, `@tr` e `@sp` trace e span id). A linha de negócio e o resumo da requisição:

```json
{"@t":"2026-11-12T14:55:15.9989430Z","@mt":"Order {OrderId} placed, total {Total}","@tr":"7ecd9ffc2a1b4128dc0f4019537cd342","@sp":"a7f5e6b89380777e","OrderId":42,"Total":9.90,"SourceContext":"SerilogLab.OrderService","RequestId":"0HNQ0PJR4LFQ7:00000001","RequestPath":"/orders/42","ConnectionId":"0HNQ0PJR4LFQ7","Tenant":"acme"}
{"@t":"2026-11-12T14:55:16.0009220Z","@mt":"HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms","@r":["5.1821"],"@tr":"7ecd9ffc2a1b4128dc0f4019537cd342","@sp":"a7f5e6b89380777e","Tenant":"acme","RequestMethod":"POST","RequestPath":"/orders/42","StatusCode":200,"Elapsed":5.182084,"SourceContext":"Serilog.AspNetCore.RequestLoggingMiddleware","RequestId":"0HNQ0PJR4LFQ7:00000001","ConnectionId":"0HNQ0PJR4LFQ7"}
```

De onde vieram as propriedades: `OrderId` e `Total` do template, `SourceContext` da categoria do logger, `Tenant` do `LogContext` (próxima seção), `RequestId`, `RequestPath` e `ConnectionId` do escopo que o ASP.NET Core abre em volta de cada requisição (o Serilog transforma escopos chave-valor em propriedades), e `@tr`/`@sp` da `Activity` atual, sem código meu. O pedido recusado, escrito por um método `[LoggerMessage]`, levou o event id como estrutura, `"EventId":{"Id":3001,"Name":"OrderRefused"}`, e `"@l":"Warning"`.

Dois fatos sobre configuração que custam tempo se você os encontrar em produção. Primeiro, um nome de sink desconhecido não derruba o app. Configurei `"Name": "Nope"`:

```text
Unable to find a method called Nope. Candidate methods are:
Serilog.LoggerConfiguration Console(...)
Serilog.LoggerConfiguration File(...)
```

Esse texto foi só para o `SelfLog`; `CreateLogger()` retornou normalmente e o app rodou sem sink. O mesmo me aconteceu nos testes do lab: sobrescrever o caminho do arquivo com `WebApplicationFactory.UseSetting("Serilog:WriteTo:1:Args:path", ...)` produziu o mesmo `Unable to find a method called .` para cada host e nenhum arquivo foi criado, enquanto os testes que usam o sink em memória continuaram passando. `ConfigureAppConfiguration` com uma coleção em memória para a mesma chave funcionou. Adicione um teste que lê o arquivo, como o lab faz. Segundo, um sink que lança exceção também não quebra quem chamou: um sink cujo `Emit` lançou `IOException("disk full")` foi reportado ao `SelfLog` e o programa continuou. O logging foi feito para nunca derrubar o app, o que também significa que ele falha em silêncio.

Os níveis recarregam ao vivo. Com `AddJsonFile(..., reloadOnChange: true)` e um arquivo com `Default: Information` e `Override: { "Shop": "Warning" }`, uma sonda de todos os níveis para `Shop.Orders` e `Other`, depois a reescrita do arquivo para `Debug` nos dois, e a mesma sonda 1,5 s depois:

```text
initial: Shop.Orders:Warning Other:Information
after reload: Shop.Orders:Debug Shop.Orders:Information Shop.Orders:Warning Other:Debug Other:Information
```

O `Override` que silencia o ruído do framework é o que você mais vai usar. Com `Microsoft.AspNetCore` em `Warning`, uma requisição escreveu 2 linhas. Voltando para `Information` pelo ambiente (`Serilog__MinimumLevel__Override__Microsoft.AspNetCore=Information`, em que `__` substitui `:`), escreveu 7: `Request starting`, `Executing endpoint`, a linha de negócio, `Setting HTTP status code`, `Executed endpoint`, o resumo do Serilog e `Request finished`.

### Arquivos com rolling

O `rollingInterval` põe a data no nome (`lab-.ndjson` virou `lab-20261112.ndjson`), e o `retainedFileCountLimit` apaga os mais antigos. Escrevi 120 linhas com `fileSizeLimitBytes` 2000 e `rollOnFileSizeLimit` true, intervalo diário e `retainedFileCountLimit` 3:

```text
app-20261112_003.log 2046 bytes
app-20261112_004.log 2056 bytes
app-20261112_005.log 940 bytes
```

O limite de tamanho acrescenta um sufixo `_NNN`, os arquivos passam um pouco do limite (a linha que o cruza é terminada) e a retenção ficou com os 3 mais novos, então `_001` e `_002` foram apagados. Sem `rollOnFileSizeLimit`, um arquivo que chega em `fileSizeLimitBytes` para de aceitar eventos, e faz isso em silêncio: as mesmas 120 linhas com `rollOnFileSizeLimit: false` deixaram um arquivo de 2099 bytes com 19 linhas e nada no `SelfLog`. Configure os dois. O `outputTemplate` do sink de arquivo controla o formato de texto quando você não passa um formatter (`{Timestamp:HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}` produziu `14:55:43.192 [INF] line 110 ...`). Em contêineres, o sink de console com JSON costuma ser o único de que você precisa, já que a plataforma coleta o stdout.

### LogContext, escopos e enrichers

`LogContext.PushProperty` adiciona uma propriedade a todo evento escrito até ela ser descartada, e atravessa `await`. Só funciona se `Enrich.FromLogContext()` estiver configurado; sem ele a propriedade simplesmente nunca aparece. O middleware do lab:

```csharp
using (LogContext.PushProperty("Tenant", tenant))
{
    await next(context);
}
```

O `ILogger.BeginScope` também chega ao Serilog. Abri um escopo com template, um escopo com dicionário, um escopo com string simples e uma propriedade de `LogContext`, e logei uma vez:

```text
props=[SourceContext="Shop.Orders", CartId="c-7", Tenant="acme", Scope=["Checkout c-7", "plain text scope"], FromContext=1, Application="shop"]
```

Os escopos de template e de dicionário viraram propriedades (`CartId`, `Tenant`), as strings simples foram para um array `Scope`, e `FromContext` apareceu quando `FromLogContext` estava ligado. Diferente do provider de console, não há chave `IncludeScopes`. Coloque o middleware que empurra a propriedade antes do `UseSerilogRequestLogging`, para o resumo também a ter, ou defina explicitamente com `EnrichDiagnosticContext`.

Enrichers adicionam propriedades de fora da chamada. Vêm do código (`Enrich.WithProperty`, `Enrich.With(new MyEnricher())`), de pacotes ou da configuração. Com o `Serilog.Enrichers.Environment`:

```json
"Enrich": [ "WithMachineName" ], "Properties": { "Application": "shop-api" }
```

```text
{"@t":"2026-11-12T14:55:43.3161460Z","@mt":"with enrichers","MachineName":"Alexandros-MacBook-Pro-2","Application":"shop-api"}
```

Esse experimento não tinha seção `Using` e mesmo assim achou o sink de console e o enricher, já que os pacotes são referenciados pelo projeto (o README do Settings.Configuration diz que ele varre o dependency context); liste-os em `Using` quando um assembly não for descoberto assim. Nome da máquina e id do processo são os enrichers de sempre. Coloque versão, ambiente e nome do serviço em `Properties` ou nos resource attributes do OpenTelemetry, uma vez só.

### Request logging

`app.UseSerilogRequestLogging()` troca as várias linhas de `Microsoft.AspNetCore` por requisição por um único evento, escrito quando a requisição termina: método, caminho, status e tempo, em `Information` (500 e exceções não tratadas em `Error`, com a exceção anexada; o 404 da minha execução foi `Information`). O endpoint que lança exceção produziu:

```json
{"@mt":"HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms","@l":"Error","@x":"System.InvalidOperationException: kaboom\n   at Program...","@tr":"cfb3a8b2...","Tenant":"none","RequestMethod":"GET","RequestPath":"/boom","StatusCode":500,"Elapsed":0.144084}
```

Em seguida o Kestrel escreveu a própria linha `An unhandled exception was thrown by the application` em `Error`, já que `Microsoft.AspNetCore` em `Warning` ainda deixa erros passarem. O `EnrichDiagnosticContext` recebe um `IDiagnosticContext` e o `HttpContext`, então dá para colocar no resumo o tenant, o id do usuário (não o e-mail) ou um header. Um middleware registrado antes do `UseSerilogRequestLogging` roda fora do resumo, então registre depois o que você não quer contar (arquivos estáticos, por exemplo). Comparado com o middleware de HTTP logging do ASP.NET Core, isto é uma linha por requisição, sem headers e sem corpos; use o HTTP logging quando precisar deles, e veja o concept de HTTP logging para os custos.

### Redigindo o que não pode chegar ao sink

Mascarar numa política de destructuring cobre os objetos que você destrutura. Para valores passados como parâmetros, o `Microsoft.Extensions.Compliance.Redaction` funciona por um método `[LoggerMessage]` e fica na frente de qualquer provider. Rodei com o provider do Serilog e um sink em memória, com um atributo `[Pii.Private]` no parâmetro e um redactor que escreve `*****`:

```text
msg='Signup for "*****"' props=[Email="*****", EventId={ Id: 2000, Name: "Signup" }, SourceContext="Program"]
msg='plain "ana@example.com"' props=[Email="ana@example.com", SourceContext="Program"]
```

A chamada classificada chegou redigida na mensagem e na propriedade, e a chamada `LogInformation` comum saiu intacta: isso protege só o que é classificado e passa por métodos gerados. O concept de ILogger mostra a declaração e o que acontece sem `EnableRedaction`. As duas técnicas são opt-in, então o resto é processo: não logue corpos de requisição em `Information` e mantenha `Debug` e `Verbose` fora dos sinks de produção.

### Sink em memória para testes

Um sink é um objeto com um método. Este é o dublê de teste inteiro do lab:

```csharp
public sealed class InMemorySink : ILogEventSink
{
    private readonly List<LogEvent> _events = [];
    public IReadOnlyList<LogEvent> Events { get { lock (_events) return [.. _events]; } }
    public void Emit(LogEvent logEvent) { lock (_events) _events.Add(logEvent); }
}
```

Ele é registrado com `services.AddSingleton<ILogEventSink>(sink)`, e o `ReadFrom.Services` o adiciona ao pipeline de produção. Um teste então verifica a estrutura:

```csharp
var e = sink.Events.Single(IsFromOrderService);
Assert.Equal("Order {OrderId} placed, total {Total}", e.MessageTemplate.Text);
Assert.Equal("42", e.Properties["OrderId"].ToString());
Assert.Equal("acme", Text(e.Properties["Tenant"]));
```

Oito testes do lab passaram em cerca de 0,6 s, cobrindo o template e as propriedades, o `Tenant` vindo do `LogContext`, o e-mail mascarado (e que o endereço em claro não está em nenhuma mensagem renderizada), o event id 3001, o resumo da requisição, a exceção não tratada (500 e a exceção no evento), o override de `Microsoft.AspNetCore` e o arquivo com rolling com sua linha JSON compacta. Valores de propriedade são `LogEventPropertyValue`: uma string é `"out of stock"` com aspas no `ToString()`, um número vem sem aspas, um objeto é um `StructureValue`. Verifique o texto do template e as propriedades, não a mensagem renderizada, porque a mensagem muda com cultura e redação.

### Serilog e OpenTelemetry Logs

Os dois não são rivais; ficam em lugares diferentes. O Serilog é um provider atrás do `ILogger`. O OpenTelemetry (veja o concept de OpenTelemetry) é um protocolo e um SDK com o próprio provider de `ILogger`, que exporta logs junto com traces e métricas. Você pode manter o Serilog como API de logging e enviar os eventos por OTLP com o `Serilog.Sinks.OpenTelemetry`. Apontei esse sink para um listener HTTP local no lugar de um collector, dentro de uma `Activity`, com um resource attribute `service.name` e um enricher `Tenant`:

```text
POST /v1/logs content-type=application/x-protobuf bytes=402
printable: service.name shop-api, telemetry.sdk.name serilog, telemetry.sdk.version 4.2.0..., Information, Order 42 placed, OrderId, Tenant acme, message_template.text Order {OrderId} placed
trace id bytes present: True
```

O corpo era protobuf OTLP. A mensagem renderizada virou o body do log, os placeholders do template e as propriedades enriquecidas viraram atributos, o template foi mantido em `message_template.text`, e o trace id da `Activity` ativa estava no registro, então o log pode ser ligado ao seu trace. O que você ganha é o ecossistema de enrichers e destructuring do Serilog na frente de um backend OTLP. O que você perde é um pipeline só: você configura o Serilog e o SDK do OpenTelemetry para traces e métricas separadamente, e os resource attributes em dois lugares. Uma regra prática, que é um julgamento e não uma medição: serviço novo, um backend só, nenhum sink do Serilog de que você dependa, fique com `ILogger` e o provider do OpenTelemetry; configuração do Serilog existente, sinks próprios ou políticas de destructuring de que você depende, mantenha o Serilog e adicione o sink OTLP ou o JSON no console que a sua plataforma coleta.

## Trade-offs

- **O Serilog é uma dependência e um segundo sistema de configuração.** A seção `Serilog` e o `Logging:LogLevel` não têm relação; com `UseSerilog` a seção `Logging` deixa de decidir o que é escrito: com `Logging__LogLevel__Default=Error` no ambiente, a linha do pedido e o resumo da requisição em `Information` continuaram sendo escritos. Mantenha uma fonte de verdade e apague a outra.
- **Falhar em silêncio é o padrão.** Um sink com nome errado, um argumento de template faltando ou um disco cheio não geraram exceção, só saída no `SelfLog`. Habilite o `SelfLog` em desenvolvimento e teste o arquivo e as propriedades críticas.
- **Destructuring (`@`) pode vazar.** Ele serializa toda propriedade pública. Prefira propriedades explícitas, `Destructure.ByTransforming` ou `[LogProperties]` com redação para tipos sensíveis.
- **`LogContext` precisa de `Enrich.FromLogContext()`.** Esquecê-lo perde as propriedades sem aviso; um teste na propriedade pega isso.
- **Prefira `[LoggerMessage]` em caminhos quentes.** Templates pelo `ILogger` ainda alocam com o nível desligado (veja o concept de ILogger); o método gerado mantém a estrutura e o event id.
- **O rolling precisa dos dois limites.** `rollingInterval` para datas, `rollOnFileSizeLimit` para tamanho, `retainedFileCountLimit` para disco. Os arquivos podem terminar um pouco acima do limite.
- **JSON no console vence arquivos em contêineres.** Arquivos fazem sentido em VMs e para auditoria; no Kubernetes a plataforma já rotaciona e envia o stdout.
- **Um `Log.Logger` estático é estado compartilhado.** Use `ILogger<T>` no código da aplicação e deixe o logger estático para a inicialização e o encerramento.

## Documentation Links

- [Structured Data, Serilog wiki](https://github.com/serilog/serilog/wiki/Structured-Data) (doc)
- [serilog-aspnetcore, GitHub](https://github.com/serilog/serilog-aspnetcore) (doc)
- [serilog-settings-configuration, GitHub](https://github.com/serilog/serilog-settings-configuration) (doc)
- [serilog-sinks-file, GitHub](https://github.com/serilog/serilog-sinks-file) (doc)
- [serilog-formatting-compact, GitHub](https://github.com/serilog/serilog-formatting-compact) (doc)
- [serilog-sinks-opentelemetry, GitHub](https://github.com/serilog/serilog-sinks-opentelemetry) (doc)
- [Logging in C# and .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
