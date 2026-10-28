---
version: 1.0
updatedAt: 2026-10-28
title: "ILogger: categorias, níveis, filtros e escopos"
summary: Categoria de ILogger<T> e ILoggerFactory, níveis, a regra que escolhe um filtro por provider e categoria, seções por provider, AddFilter, EventId, message templates contra interpolação e CA2254, escopos, logging gerado com [LoggerMessage] e redação de dados classificados, com o resultado medido de cada experimento.
---
## Objective

`ILogger` parece trivial (injete, chame `LogInformation`), e é justamente por isso que ele é mal usado: strings interpoladas que jogam fora a estrutura, uma seção `Logging` que ninguém sabe explicar, linhas de `Debug` que alocam mesmo desligadas e dados pessoais gravados em texto puro. Um conjunto pequeno de regras decide tudo: todo logger tem uma categoria, cada provider escolhe uma única regra de filtro por categoria, a mensagem é um template cujos placeholders viram campos, escopos anexam contexto a toda linha dentro deles, e o gerador de código elimina o custo de uma chamada desligada. Este conceito roda cada regra no .NET 10 com um provider em memória e com o provider de console, e mostra o que foi emitido, o que foi descartado, o que lançou exceção e o que alocou. Versões usadas: SDK 10.0.100, Microsoft.Extensions.Logging 10.0.14 (via Microsoft.Extensions.Hosting 10.0.14), Microsoft.Extensions.Telemetry e Microsoft.Extensions.Compliance.Redaction 10.11.0.

## Use Cases

- Ligar `Debug` para um único namespace em produção, por configuração, sem se afogar em logs do framework.
- Mandar logs detalhados para um provider e só avisos para outro.
- Fazer toda linha de uma requisição ou de um job em background carregar o mesmo id de pedido, tenant ou trace id.
- Logar num caminho quente sem pagar por mensagens filtradas, e sem vazar e-mails para o armazenamento de logs.

## Deep Dive

### A categoria: ILogger<T> e ILoggerFactory

Todo logger tem uma categoria, uma string que viaja com cada mensagem e é a chave da filtragem. `ILogger<T>` usa o nome completo de `T`; `ILoggerFactory.CreateLogger(string)` deixa você escolher. Eu loguei uma vez por cada forma de obter um logger:

```text
Shop.Orders.OrderService                 from ILogger<OrderService>
Shop.Orders.OrderService.Validator       nested type
Shop.Orders.Repository                   generic type
Shop.Orders.Checkout                     CreateLogger(string)
Shop.Orders.OrderService                 CreateLogger<T>()
Shop.Orders.OrderService                 CreateLogger(Type)
ILogger<T> twice same instance: True
```

Um tipo aninhado (`ILogger<OrderService.Validator>`) usa ponto, não o `+` do CLR, e um tipo genérico (`ILogger<Repository<Order>>`) perde os argumentos de tipo, então `Repository<Order>` e `Repository<Customer>` dividem a mesma categoria. `ILogger<T>` é singleton (`Logger<T>`), então injetá-lo é barato. Use `ILogger<T>` por padrão, e `CreateLogger("Shop.Orders.Checkout")` quando quiser uma subcategoria que dê para filtrar à parte, ou uma categoria compartilhada por várias classes.

### Níveis e o mínimo padrão

Os níveis são `Trace` (0), `Debug` (1), `Information` (2), `Warning` (3), `Error` (4), `Critical` (5) e `None` (6); uma regra habilita o seu nível e tudo acima. Sem nada configurado, tanto `LoggerFactory.Create` quanto um host sem appsettings deram `IsEnabled(Debug)=False` e `IsEnabled(Information)=True`: o mínimo de fallback é `Information`, como diz a documentação, e `SetMinimumLevel` o altera. A documentação também avisa que `Trace` pode conter dados sensíveis e não deve ser ligado em produção.

### Como uma regra é escolhida

Para cada provider e categoria, a factory escolhe exatamente uma regra. A documentação descreve o algoritmo: fique com as regras daquele provider (alias ou nome completo do tipo), ou, se não houver nenhuma, com as regras sem provider; entre elas, fique com o prefixo de categoria mais longo que casar, ou com as regras sem categoria; se sobrar mais de uma, pegue a última. Registrei o provider de console e um provider em memória meu, marcado com `[ProviderAlias("Recorder")]`:

```json
"Logging": {
  "LogLevel": { "Default": "Information", "Microsoft": "Warning", "Microsoft.Hosting.Lifetime": "Information",
                "Shop": "Debug", "Shop.Payments": "Error" },
  "Recorder": { "LogLevel": { "Default": "Warning", "Shop.Orders": "Trace" } }
}
```

Escrevi uma mensagem em cada nível para cada categoria e anotei o menor nível que chegou a cada provider:

```text
category                                          Console      Recorder
Microsoft.AspNetCore.Routing.EndpointMiddleware   Warning      Warning
Microsoft.Hosting.Lifetime                        Information  Warning
Shop.Orders.OrderService                          Debug        Trace
Shop.Payments.CardGateway                         Error        Warning
Shopping.Cart                                     Debug        Warning
shop.payments.lowercase                           Error        Warning
MyApp.Worker                                      Information  Warning
```

O prefixo mais longo vence (`Microsoft.Hosting.Lifetime` ganha de `Microsoft`). A comparação ignora maiúsculas e minúsculas. O prefixo é um prefixo de string puro, sem fronteira de ponto: a regra `Shop` também habilitou `Debug` para `Shopping.Cart`. E quando um provider tem a própria seção, a seção geral deixa de valer para ele por completo: o Recorder ficou com `Warning` para `Shop.Payments.CardGateway` e `Microsoft.Hosting.Lifetime`, porque o `Default` dele é uma regra do provider, e regras do provider são consideradas antes de qualquer regra geral. Os aliases embutidos são `Console`, `Debug`, `EventSource` e `EventLog`, então `Logging:Console:LogLevel` se comporta do mesmo jeito.

### Regras em código: AddFilter, curingas, funções de filtro

Regras adicionadas em código entram na mesma lista. Num host, a configuração é registrada primeiro e `builder.Logging.AddFilter` depois, então, para a mesma categoria, a regra do código vem por último e vence. Uma categoria pode conter um `*`:

```csharp
// configuração: Default=Information, Shop=Debug
builder.Logging.AddFilter("Shop", LogLevel.Error);
builder.Logging.AddFilter("Shop.*.Db", LogLevel.Trace);
```

```text
Shop.Orders.OrderService     min=Error
Shop.Orders.Db               min=Trace
Shop.Billing.Db              min=Trace
Other                        min=Information
```

`AddFilter((provider, category, level) => level >= LogLevel.Warning)` cria uma regra sem provider e sem categoria, então ela só disputa com o `Default`. Com a mesma configuração, `Other` passou para `min=Warning` enquanto `Shop.Orders.OrderService` ficou em `min=Debug`: a função substituiu o `Default` (veio por último) e nunca rodou para `Shop`, que tinha uma regra mais específica. A documentação diz o mesmo: a função é chamada para providers e categorias sem regra vinda de configuração ou de código.

### O template do ASP.NET Core, variáveis de ambiente e reload

`dotnet new web` no SDK 10.0.100 gera `"LogLevel": { "Default": "Information", "Microsoft.AspNetCore": "Warning" }` nos dois arquivos appsettings, e o host registrou `ConsoleLoggerProvider`, `DebugLoggerProvider` e `EventSourceLoggerProvider` (a documentação acrescenta `EventLog` no Windows). Depois de uma requisição, o console mostrou só as linhas de `Microsoft.Hosting.Lifetime` (`Now listening on`, `Application started`), já que essa categoria cai no `Default`. Então sobrescrevi uma chave pelo ambiente, onde `__` substitui `:`:

```bash
env 'Logging__LogLevel__Microsoft.AspNetCore=Information' dotnet run
```

```text
info: Microsoft.AspNetCore.Hosting.Diagnostics[1]
      Request starting HTTP/1.1 GET http://127.0.0.1:5099/ - - -
info: Microsoft.AspNetCore.Hosting.Diagnostics[2]
      Request finished HTTP/1.1 GET http://127.0.0.1:5099/ - 200 - text/plain;+charset=utf-8 15.8861ms
```

Duas linhas de `Microsoft.AspNetCore.Routing.EndpointMiddleware` (`Executing endpoint 'HTTP: GET /'`, `Executed endpoint`) apareceram entre essas duas. Sem o `env`, o zsh respondeu `command not found: Logging__LogLevel__Microsoft.AspNetCore=Information`, porque nomes de variável do shell não aceitam ponto; a seção de ambiente de um container aceita. Os níveis também acompanham o reload da configuração: mudei o `appsettings.json` de `Default: Information` para `Debug` com o host rodando, e a mesma instância de `ILogger` passou a responder `IsEnabled(Debug)=True` cerca de 200 ms depois, sem reiniciar.

### EventId

Um `EventId` é um `Id` mais um `Name` opcional, e um `int` se converte nele implicitamente:

```csharp
static readonly EventId PaymentDeclined = new(4001, "PaymentDeclined");
log.LogWarning(PaymentDeclined, "Payment for order {OrderId} declined: {Reason}", 42, "insufficient funds");
```

O console simples imprime o id entre colchetes (`warn: Shop.Orders[4001] ...`), e o formatador JSON (`AddJsonConsole`, aqui dentro de um escopo de dicionário) o grava como campo:

```text
{"EventId":4001,"LogLevel":"Warning","Category":"Shop.Orders","Message":"Payment for order 42 declined: insufficient funds","State":{"OrderId":42,"Reason":"insufficient funds","{OriginalFormat}":"Payment for order {OrderId} declined: {Reason}"},"Scopes":[{"Message":"System.Collections.Generic.Dictionary\u00602[System.String,System.Object]","Tenant":"acme"}]}
```

O nome não apareceu em nenhum dos dois formatos de console; ele chega aos providers que leem `EventId.Name`. Um id estável permite consultar ou alertar sobre todo pagamento recusado mesmo depois que o texto da mensagem muda.

### Message templates não são format strings

Cada placeholder vira um valor nomeado no estado que o provider recebe, mais o `{OriginalFormat}`. Fiz cinco chamadas e o meu recorder imprimiu event id, mensagem e estado:

```csharp
log.LogInformation(AppLogEvents.OrderPlaced, "Order {OrderId} placed, total {Total}", id, total);
log.LogInformation($"Order {id} placed, total {total}");
log.LogInformation("Parameter values: {B}, {A}", "a", "b");
log.LogInformation("Paid {Amount:F2} at {When:yyyy-MM-dd}", 9.9, new DateTime(2026, 10, 28));
log.LogInformation("User {@User} and {$Obj}", new { Name = "ana" }, 3);
```

```text
[1000:OrderPlaced] msg='Order 42 placed, total 9.90'
      state: OrderId=42, Total=9.90, {OriginalFormat}=Order {OrderId} placed, total {Total}
[0:] msg='Order 42 placed, total 9.90'
      state: {OriginalFormat}=Order 42 placed, total 9.90
[0:] msg='Parameter values: a, b'
      state: B=a, A=b, {OriginalFormat}=Parameter values: {B}, {A}
[0:] msg='Paid 9.90 at 2026-10-28'
      state: Amount=9.9, When=10/28/2026 12:00:00 AM, {OriginalFormat}=Paid {Amount:F2} at {When:yyyy-MM-dd}
[0:] msg='User { Name = ana } and 3'
      state: @User={ Name = ana }, $Obj=3, {OriginalFormat}=User {@User} and {$Obj}
```

A interpolação gera o mesmo texto, mas sem campos e com um "template" diferente por pedido, então o armazenamento de logs não consegue mais agrupar por `OrderId`. Os placeholders se ligam por posição, não por nome. Um especificador de formato muda só o texto; o estado guarda o valor bruto. O prefixo `@` do Serilog não significa nada para os providers embutidos, ele só vira parte da chave. Um argumento faltando é pior:

```csharp
log.LogInformation("Order {OrderId} placed, total {Total}", 42);   // falta um argumento
```

```text
AggregateException: An error occurred while writing to logger(s). (Index (zero based) must be greater than or equal to zero and less than the size of the argument list.)
```

A exceção saiu da própria chamada de log, e só com o nível habilitado: a mesma chamada com `LogDebug` (desligado) não fez nada, então o bug fica escondido até alguém ligar o `Debug`. Um argumento a mais foi descartado em silêncio. O build avisou nos dois casos, por padrão, com CA2017 ("Number of parameters supplied in the logging message template do not match the number of named placeholders").

### CA2254 e o custo de um log desligado

A CA2254 aponta um template que não é constante. No .NET 10 ela vem habilitada só "as suggestion", então um `dotnet build` comum não imprimiu nada para `LogInformation($"Order {id} placed")`. Com `dotnet_diagnostic.CA2254.severity = warning` no `.editorconfig`:

```text
Program.cs(9,20): warning CA2254: The logging message template should not vary between calls to 'LoggerExtensions.LogInformation(ILogger, string?, params object?[])'
```

Medi 1.000.000 de chamadas por variante (Release) contra um provider que aceita tudo, mas nunca monta a string nem faz I/O, com nível mínimo `Information`:

```text
template, Debug disabled                 96.0 B/call    71.3 ns/call
interpolated, Debug disabled            112.0 B/call   152.0 ns/call
IsEnabled guard + template                0.0 B/call    11.6 ns/call
[LoggerMessage], Debug disabled           0.0 B/call    11.6 ns/call
template, Information enabled            96.0 B/call    91.1 ns/call
interpolated, Information enabled       115.5 B/call   175.2 ns/call
[LoggerMessage], Information enabled      0.0 B/call    51.2 ns/call
```

Um `LogDebug` desligado com template ainda alocou 96 bytes: o `params object[]`, um `int` boxed e um `decimal` boxed, tudo criado antes de o logger poder dizer não. A interpolação foi pior, porque a string é montada antes da chamada. Um provider real ainda soma o custo de formatar a mensagem.

### Escopos

`BeginScope` devolve um `IDisposable`; todo log escrito antes do dispose carrega o estado do escopo, escopos se aninham, e eles atravessam o `await` (um log dentro de `Task.Run` depois de um `await` ainda imprimiu `=> Order 42`). O formatador de console precisa de `IncludeScopes = true` (desligado por padrão; sem ele o escopo não apareceu):

```csharp
using (log.BeginScope("Checkout {CartId}", "c-7"))
using (log.BeginScope(new Dictionary<string, object> { ["Tenant"] = "acme", ["UserId"] = 12 }))
    log.LogInformation("Order {OrderId} placed", 42);
```

```text
info: Shop.Orders[0] => Checkout c-7 => System.Collections.Generic.Dictionary`2[System.String,System.Object] Order 42 placed
```

O escopo com template ficou legível; o dicionário imprimiu o nome do tipo, e o mesmo aconteceu com o formato usado no exemplo da própria documentação, uma `List<KeyValuePair<string, object>>`. Providers estruturados leem os pares: o formatador JSON gravou `"Tenant":"acme"` dentro de `Scopes` (veja o exemplo de EventId), e o meu recorder viu `{CartId=c-7, {OriginalFormat}=Checkout {CartId}}`. Prefira a forma com template, legível nos dois. `builder.Logging.Configure(o => o.ActivityTrackingOptions = ActivityTrackingOptions.TraceId | ActivityTrackingOptions.SpanId)` acrescenta os ids da `Activity` atual como escopo em toda linha:

```text
info: Shop.Orders[0] => SpanId:286c56e993c61c8b, TraceId:e205e82043529929c59329d453d8067e inside activity e205e82043529929c59329d453d8067e
```

### Logging gerado com [LoggerMessage]

O gerador escreve o corpo de um método `partial` em tempo de compilação. Para esta declaração ele emitiu o código abaixo (resumido):

```csharp
[LoggerMessage(EventId = 1001, Level = LogLevel.Debug, Message = "Order {OrderId} placed, total {Total}")]
public static partial void OrderDebug(this ILogger logger, int orderId, decimal total);

// gerado
private static readonly Action<ILogger, int, decimal, Exception?> __OrderDebugCallback =
    LoggerMessage.Define<int, decimal>(LogLevel.Debug, new EventId(1001, nameof(OrderDebug)), "Order {OrderId} placed, total {Total}", ...);
public static partial void OrderDebug(this ILogger logger, int orderId, decimal total)
{ if (logger.IsEnabled(LogLevel.Debug)) __OrderDebugCallback(logger, orderId, total, null); }
```

O template é processado uma vez, os argumentos continuam fortemente tipados (sem array, sem boxing) e o `IsEnabled` é checado primeiro, e é daí que vêm os 0 B da tabela. Segundo a documentação, aqui os placeholders se ligam aos parâmetros por nome, não por posição, e a comparação ignora maiúsculas e minúsculas. O gerador também confere o seu trabalho:

```text
warning SYSLIB1015: Argument 'extra' is not referenced from the logging message
error SYSLIB1014: Template 'Missing' is not provided as argument to the logging method
warning SYSLIB1025: Multiple logging methods are using event name Same in class Diag
```

Dois métodos com o mesmo `EventId` e nomes diferentes não geraram aviso: o diagnóstico de id duplicado que a documentação cita (SYSLIB1006) não disparou com Microsoft.Extensions.Logging 10.0.14. Sem `EventId`, o gerador derivou um a partir do nome do método (`new EventId(1052509500, nameof(OrderDebug2))`), então defina os ids explicitamente se você alerta em cima deles. O `IsEnabled` não protege os argumentos: `log.OrderDebug2(Expensive())` ainda chamou `Expensive()` com `Debug` desligado (`calls=1`). E referenciar Microsoft.Extensions.Telemetry 10.11.0 troca o gerador por outro (`Microsoft.Gen.Logging`), que guarda os argumentos num array de tags: nele a chamada habilitada alocou 56 B (os dois valores boxed), e a desligada continuou em 0 B.

### Redação de dados classificados

Microsoft.Extensions.Compliance.Redaction e Microsoft.Extensions.Telemetry acrescentam classificação de dados ao logging: declare uma classificação e o atributo dela, marque parâmetros (ou propriedades de um objeto logado com `[LogProperties]`) e registre um redactor por classificação:

```csharp
[LoggerMessage(2000, LogLevel.Information, "Signup for {Email}")]
public static partial void Signup(this ILogger logger, [Pii.Private] string email);
[LoggerMessage(2001, LogLevel.Information, "Customer updated")]
public static partial void CustomerUpdated(this ILogger logger, [LogProperties] Customer customer); // Email é [Pii.Private]

services.AddLogging(b => b.EnableRedaction());
services.AddRedaction(r => r.SetRedactor<StarRedactor>(Pii.Private));
```

```text
--- no EnableRedaction
msg='Signup for (null)' state: {OriginalFormat}=Signup for {Email}
msg='Customer updated' state: customer.Id=7, {OriginalFormat}=Customer updated
--- EnableRedaction, no redactor set
msg='Signup for ' state: Email=, {OriginalFormat}=Signup for {Email}
--- EnableRedaction + StarRedactor
msg='Signup for *****' state: Email=*****, {OriginalFormat}=Signup for {Email}
msg='Customer updated' state: customer.Email=*****, customer.Id=7, {OriginalFormat}=Customer updated
```

O e-mail nunca chegou ao provider: sem `EnableRedaction` o valor classificado foi descartado por inteiro, e sem um redactor correspondente o fallback o apagou. O `[LogProperties]` achatou o objeto em `customer.Id` e `customer.Email`. Isso só funciona por métodos `[LoggerMessage]`; um `LogInformation("... {Email}", email)` comum não sabe nada de classificação.

## Trade-offs

- **Template em vez de interpolação, sempre.** A interpolação perde os campos, aloca mesmo com o nível desligado e escapa da CA2254 a menos que você suba a severidade dela.
  ```ini
  dotnet_diagnostic.CA2254.severity = warning
  ```
- **`[LoggerMessage]` custa uma declaração por mensagem.** Compensa em caminhos quentes e em mensagens que você consulta por id; um log escrito uma vez na inicialização pode ficar como chamada com template.
- **Prefixos de categoria são strings puras.** `Shop` também casa com `Shopping.Cart`. Um ponto no final funciona como fronteira, ao custo de não casar mais com a própria categoria `Shop`:
  ```text
  rule 'Shop.' -> Shop: Debug enabled=False
  rule 'Shop.' -> Shop.Orders: Debug enabled=True
  rule 'Shop.' -> Shopping.Cart: Debug enabled=False
  ```
- **Uma seção de provider substitui a geral para aquele provider.** Repita nela toda categoria de que o provider precisa, ou ele cai no próprio `Default`.
- **Níveis mais baixos custam dinheiro no destino.** `Debug` em tudo inunda o armazenamento; ligue por categoria e por pouco tempo, via reload de configuração ou variável de ambiente.
- **Escopos valem o que vale o provider que os imprime.** O console precisa de `IncludeScopes` e imprime escopos de dicionário como nome de tipo; providers estruturados os leem como campos.
- **A redação é opt-in por parâmetro.** Ela protege o que foi classificado e passa por métodos gerados; qualquer coisa concatenada na mensagem sai do jeito que foi escrita.

## Documentation Links

- [Logging in C# and .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/overview) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/source-generation) (doc)
- [Logging providers in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/providers) (doc)
- [CA2254: Template should be a static expression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2254) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [Logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/?view=aspnetcore-10.0) (doc)
