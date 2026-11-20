---
version: 1.0
updatedAt: 2026-11-20
title: "Azure Functions em C#: o modelo isolated worker"
summary: Um app de Azure Functions em C# é um processo .NET que o host inicia e chama por gRPC. Medido com Core Tools 4.16.1 e Azurite 3.38.0 num app com gatilhos HTTP, Timer e Queue com binding de saída, mais um teste MSTest sem o host, com net10.0, Azure.Functions.Sdk 1.1.0 e Worker 2.52.0. FunctionsApplication.CreateBuilder contra HostBuilder, IActionResult contra HttpResponseData, host.json contra local.settings.json, planos e datas (o modelo in-process terminou em 2026-11-10) lidos na doc e marcados "docs only".
---
## Objective

Um app de Azure Functions em C# é um console app .NET que um processo host separado inicia e com o qual conversa por gRPC. Essa divisão é o modelo isolated worker e, desde 2026-11-10, é o único modelo com suporte completo: o modelo in-process chegou ao fim do suporte nesse dia. Montei um app com um gatilho HTTP, um gatilho Timer e um gatilho Queue com binding de saída, rodei com o Azure Functions Core Tools 4.16.1 contra o Azurite num container e medi o que o host imprime, o que o build gera, como as configurações chegam ao worker e como testar uma função sem o host. Tudo o que exige um Function App de verdade (planos, cold start, Flex Consumption, deploy) vem das páginas do Microsoft Learn de 2026-11 e está marcado como "docs only". Versions: `Azure.Functions.Sdk` 1.1.0, `Microsoft.Azure.Functions.Worker` 2.52.0, `Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore` 2.1.1, `...Extensions.Timer` 4.3.1, `...Extensions.Storage.Queues` 5.5.5, Core Tools 4.16.1 (runtime do host 4.1054.250.26428), Azurite 3.38.0, MSTest 4.5.3, TFM `net10.0`, SDK .NET 10.0.100, Apple M4 Max (arm64).

## Use Cases

- Começar um job serverless novo em .NET (consumidor de fila, tarefa agendada, API HTTP pequena) num modelo e numa versão do .NET com suporte.
- Migrar um app in-process (`FunctionsStartup`, `Microsoft.NET.Sdk.Functions`) que agora está fora de suporte.
- Rodar e depurar um app de Functions no notebook só com Azurite e Core Tools, sem conta Azure.
- Manter a regra de negócio em classes simples, para que o teste unitário não precise do host nem do Azure.

## Deep Dive

### Dois processos, um canal gRPC

O host do Functions (o Core Tools traz um, o Azure roda o dele) cuida de gatilhos, escala e bindings. Seu projeto é um executável comum que o host lança e chama de volta. Com o app rodando, o `ps` mostrou isto (caminhos encurtados):

```text
60773  func start --port 7010                       (Core Tools, hosts the Functions runtime)
60869  dotnet App.dll --host 127.0.0.1 --port 61822 --workerId fe33... --grpcMaxMessageLength 2147483647
```

A linha do log do host `Worker process started and initialized.` seguida de `3 functions found (Worker)` mostra a terceira peça: o worker informa a própria lista de funções por gRPC (worker indexing). Por isso não existe arquivo `functions.metadata` na saída: procurei na pasta do projeto inteira depois de um build e de uma execução e não achei nenhum, o que corrige o material antigo que o menciona. O que o `dotnet build` deixa em `bin/Debug/net10.0` é `worker.config.json`, `extensions.json` e uma pasta `.azurefunctions`:

```json
{ "description": { "language": "dotnet-isolated", "extensions": [".dll"], "defaultExecutablePath": "dotnet",
  "defaultWorkerPath": "App.dll", "workerIndexing": "true", "canUsePlaceholder": true } }
```

O `extensions.json` lista a parte do host de cada binding: para o meu gatilho de fila, `AzureStorageQueues` 5.3.8.0 mais um `FunctionMetadataLoader`. Ao incluir pacotes de Blob e Service Bus num projeto de teste apareceram `AzureStorageBlobs` 5.3.8.0 e `ServiceBus` 5.17.0.0. O pacote `Microsoft.Azure.Functions.Worker.Extensions.*` que você referencia é a API do lado do worker; o build restaura a extensão WebJobs correspondente para o host dentro de `.azurefunctions`. É por isso que a doc lista como benefícios menos conflitos de assemblies, controle total do start-up, injeção de dependência padrão e flexibilidade de versão do .NET: o worker é só o seu app com o grafo de dependências dele.

### O arquivo de projeto e os pacotes

A doc agora usa `Azure.Functions.Sdk` como SDK de projeto (ele substitui o `Microsoft.NET.Sdk` mais o pacote `Microsoft.Azure.Functions.Worker.Sdk`, define `AzureFunctionsVersion` como `v4` e o `OutputType`, e faz o `dotnet run` iniciar o host quando o Core Tools está instalado). O pacote do worker continua como referência explícita:

```xml
<Project Sdk="Azure.Functions.Sdk/1.1.0">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="2.52.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http.AspNetCore" Version="2.1.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Timer" Version="4.3.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Storage.Queues" Version="5.5.5" />
  </ItemGroup>
</Project>
```

O template que o `func init --worker-runtime dotnet-isolated --target-framework net10.0` gerou com o Core Tools 4.16.1 ainda usava `Microsoft.NET.Sdk` mais `Microsoft.Azure.Functions.Worker.Sdk` 2.0.7 e `Worker` 2.52.0, então você vai encontrar os dois estilos; a seção de migração da doc diz que a troca não exige mudança de código. Últimas versões estáveis no NuGet em 2026-11-20:

| Necessidade | Pacote | Versão |
| --- | --- | --- |
| Runtime do worker | `Microsoft.Azure.Functions.Worker` | 2.52.0 |
| SDK de build | `Azure.Functions.Sdk` | 1.1.0 (doc: 1.0.0 ou superior para .NET 10, 1.0.1 ou superior para .NET 11) |
| HTTP, tipos do ASP.NET Core | `...Extensions.Http.AspNetCore` | 2.1.1 |
| HTTP, tipos embutidos | `...Extensions.Http` | 3.3.0 |
| Timer | `...Extensions.Timer` | 4.3.1 |
| Queue | `...Extensions.Storage.Queues` | 5.5.5 |
| Blob | `...Extensions.Storage.Blobs` | 6.8.2 |
| Service Bus | `...Extensions.ServiceBus` | 5.24.0 |
| Event Hubs, Cosmos DB | `...Extensions.EventHubs`, `...Extensions.CosmosDB` | 6.5.0, 4.16.1 |
| Durable Functions | `...Extensions.DurableTask` | 1.22.0 |

### A entrada: CreateBuilder contra HostBuilder

O Worker 2.x trouxe `IHostApplicationBuilder`, então o `Program.cs` atual tem a mesma forma de um app Minimal API (veja [Hosted Services and BackgroundService](/dotnet-concepts/hosted-services-and-backgroundservice) e [Dependency Injection and Service Lifetimes](/dotnet-concepts/dependency-injection-and-service-lifetimes)). A entrada antiga é um `HostBuilder` com `ConfigureFunctionsWorkerDefaults`:

```csharp
// current: Microsoft.Azure.Functions.Worker.Builder
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();            // ASP.NET Core integration for HTTP
builder.UseMiddleware<TimingMiddleware>();
builder.Services.Configure<PricingOptions>(builder.Configuration.GetSection("Pricing"));
builder.Services.AddSingleton<OrderPricer>();
builder.Build().Run();

// older (and still supported): ConfigureFunctionsWorkerDefaults, built-in HTTP types
new HostBuilder().ConfigureFunctionsWorkerDefaults().Build().Run();
```

Os dois sobem e respondem requisições (rodei o segundo num projeto com `Extensions.Http` 3.3.0). Segundo a doc, `ConfigureFunctionsWebApplication()` substitui `ConfigureFunctionsWorkerDefaults()` e, com `IHostApplicationBuilder`, exige `Extensions.Http.AspNetCore` 2.0.0 ou superior; apps sem gatilho HTTP podem usar qualquer um, mas a doc recomenda manter o `FrameworkReference` do ASP.NET Core por desempenho.

### Funções, gatilhos e bindings

Uma função é um método público de uma classe pública com `[Function]` (nome único, até 127 caracteres) e exatamente um parâmetro de gatilho. As classes são de instância para que a injeção pelo construtor funcione:

```csharp
public sealed class Functions(OrderPricer pricer, ILogger<Functions> log)
{
    [Function("Quote")]
    public IActionResult Quote([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "quote/{sku}")] HttpRequest req, string sku)
        => int.TryParse(req.Query["qty"], out var qty) ? new OkObjectResult(pricer.Price(sku, qty))
                                                       : new BadRequestObjectResult(new { error = "qty must be an integer" });

    [Function("Heartbeat")]
    public void Heartbeat([TimerTrigger("*/5 * * * * *")] TimerInfo timer) => log.LogInformation("heartbeat, past due: {PastDue}", timer.IsPastDue);

    [Function("OrderQueued")]
    [QueueOutput("quotes", Connection = "AzureWebJobsStorage")]
    public string OrderQueued([QueueTrigger("orders", Connection = "AzureWebJobsStorage")] string message) { /* price, return JSON */ }
}
```

A saída de start-up do host, com a lista de funções que o worker informou e a tabela de rotas:

```text
3 functions found (Worker)
Mapped function route 'api/quote/{sku}' [get] to 'Quote'
Functions:
        Quote: [GET] http://localhost:7010/api/quote/{sku}
        Heartbeat: timerTrigger
        OrderQueued: queueTrigger
Executing 'Functions.Heartbeat' (Reason='Timer fired at 2026-11-20T15:19:00.0059130+00:00', ...)
heartbeat, past due: False
Executed 'Functions.Heartbeat' (Succeeded, ..., Duration=60ms)
```

O `curl http://localhost:7010/api/quote/ABC?qty=12` devolveu `200` com `{"sku":"ABC","quantity":12,"total":127.500,"bulkApplied":true}`, e `?qty=x` devolveu `400` com `{"error":"qty must be an integer"}`. O prefixo `api/` vem do `host.json` (`extensions.http.routePrefix`, padrão `api` segundo a doc). Enviar `ABC:3` e `ZZZ:20` para a fila `orders` (em Base64, que é o que o gatilho de Queue espera por padrão) fez o host registrar `Executing 'Functions.OrderQueued' (Reason='New queue message detected on 'orders'.')`, e o binding de saída gravou as duas cotações em JSON em `quotes`. Regras de gatilho que importam: um gatilho por função, bindings de entrada leem, bindings de saída gravam o valor de retorno (várias saídas pedem um tipo de retorno com um atributo por propriedade), e o `Connection` de um binding nomeia uma app setting, não um segredo.

O comportamento de falha é do host, não seu. Uma mensagem `oops` fez a função lançar `IndexOutOfRangeException`; o host registrou três execuções com falha (`maxDequeueCount` 3, definido no `host.json`) e a mensagem então ficou em `orders-poison`. Uma armadilha da primeira execução: com `AzureWebJobsStorage` igual a `UseDevelopmentStorage=true;BlobEndpoint=...` (atalho mais portas customizadas) o host imprimiu `Error indexing method 'Functions.OrderQueued' ... Azure.Storage.Queues: No valid combination of account information found.`, desabilitou só aquela função e continuou atendendo as outras duas. A connection string completa do Azurite (nome da conta, chave, três endpoints) resolveu. Além disso, o `func start` direto num projeto isolated imprimiu `Running 'func start' directly against a .NET Isolated project may not correctly load function extensions. Use 'dotnet run' instead`; o `dotnet run` (host pronto em cerca de 4 s com build já feito nesta máquina) é o caminho suportado.

### Configuração, options, logging e middleware

O registro é .NET padrão (veja [Configuration and the Options Pattern](/dotnet-concepts/configuration-and-the-options-pattern)): `builder.Services`, `builder.Configuration`, `IOptions<T>`, `ILogger<T>`. Uma entrada `"Pricing__UnitPrice": "12.5"` em `Values` do `local.settings.json` chegou ao worker como configuração: quantidade 3 custou 37,5 (12,5 x 3), não 30. A doc diz que nomes em `Values` não podem ter sublinhado duplo (reservado pelo runtime); no Core Tools 4.16.1 funcionou, mas eu não construiria nada sobre isso: prefira app settings que a plataforma documenta (`Pricing__UnitPrice` é a forma normal do .NET para app settings do Azure no Linux) e verifique. A configuração do worker não configura gatilhos: a doc diz que a configuração de gatilhos e bindings precisa vir de application settings, referências ao Key Vault ou referências ao App Configuration, porque quem a lê é a plataforma, não o seu `Program.cs`.

Middleware (a mesma ideia de [The Middleware Pipeline and Program.cs](/dotnet-concepts/middleware-pipeline-and-program-cs)) é `IFunctionsWorkerMiddleware` com `builder.UseMiddleware<T>()` e `UseWhen` condicional. O meu cronometrava cada invocação e registrava dentro do worker, no mesmo processo da função (`pid 60869`):

```text
middleware: Heartbeat took 12 ms (pid 60869)
middleware: OrderQueued took 6 ms (pid 63228)
```

A doc avisa que definir cabeçalhos de resposta depois de `await next(context)` não é confiável com a integração ASP.NET Core; defina-os a partir do resultado da invocação antes de retornar. Os níveis de log são divididos em dois: o `host.json` filtra o que o host emite, e o `Program.cs` filtra o que o seu código registra. O Application Insights agora é ligado por OpenTelemetry (docs only): `"telemetryMode": "OpenTelemetry"` no `host.json`, os pacotes `Microsoft.Azure.Functions.Worker.OpenTelemetry` 1.2.0 e `Azure.Monitor.OpenTelemetry.Exporter`, e `AddOpenTelemetry().UseFunctionsWorkerDefaults().UseAzureMonitorExporter()`, que o template gerado protege com `APPLICATIONINSIGHTS_CONNECTION_STRING`. Sem essa linha, o host informou `"TelemetryMode": "ApplicationInsights"`. O básico está em [Observability Backends: Prometheus, Grafana, Tempo and Application Insights](/dotnet-concepts/observability-backends-prometheus-grafana-tempo-and-application-insights).

### HttpResponseData contra IActionResult

Existem dois modelos HTTP. Com a integração ASP.NET Core a função recebe `HttpRequest` e devolve `IActionResult` (ou `Task<IActionResult>`); a doc diz que ela não expõe o pipeline de middleware nem o roteamento do ASP.NET Core, só os tipos. O modelo embutido recebe `HttpRequestData` e devolve `HttpResponseData`, que o worker traduz (uma requisição sem `Content-Length` e com chunked encoding chega com `Body` nulo):

```csharp
[Function("Hello")]
public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get")] HttpRequestData req)
{
    var res = req.CreateResponse(HttpStatusCode.OK);
    await res.WriteAsJsonAsync(new { hello = "world" });   // 2.x: no longer forces 200 over a status you set
    return res;
}
```

Respondeu `200` com `{"hello":"world"}`. Escolha `IActionResult` para código novo em .NET 8 ou superior (tipos conhecidos, e o modelo embutido não consegue fazer streaming do corpo da requisição) e mantenha `HttpResponseData` para o .NET Framework, que não pode usar os tipos do ASP.NET Core, ou para código que você não quer mexer. Com a integração ASP.NET Core, leituras e escritas síncronas no stream da requisição ou da resposta lançam `Synchronous operations are disallowed`; use os métodos `Async`.

### host.json e local.settings.json

O `host.json` é publicado junto com o código e configura o host para todas as funções: regras de log, `functionTimeout`, opções de extensões (`queues`, `serviceBus`, `http`). O host ecoou o meu arquivo na inicialização (`Host configuration file read:`), e o dump de `QueuesOptions` mostrou `MaxPollingInterval` 00:00:02, `BatchSize` 4 e `MaxDequeueCount` 3. O `local.settings.json` é só local: `Values` são as app settings (`FUNCTIONS_WORKER_RUNTIME`: `dotnet-isolated`, `AzureWebJobsStorage`, conexões de bindings), `Host` ajusta o host local (`LocalHttpPort`, `CORS`), e `ConnectionStrings` serve só para frameworks que leem essa seção. O csproj o copia com `CopyToPublishDirectory` igual a `Never`, e o `func init` gerou um `.gitignore` que o lista, porque ele guarda segredos: faça commit de um `local.settings.sample.json` com valores falsos. Uma configuração que existe localmente e falta no Function App é o clássico "na minha máquina funciona". Tudo aqui usou a chave pública de desenvolvimento do Azurite e preços falsos.

### Testando uma função sem o host

Mantenha a lógica numa classe que não sabe nada de gatilhos (`OrderPricer`, construída a partir de `IOptions<PricingOptions>`) e deixe o método `[Function]` como um adaptador. Os dois são objetos comuns: `Functions.Quote` recebe um `HttpRequest` do ASP.NET Core, que o `DefaultHttpContext` fornece.

```csharp
[TestMethod]
public void Quote_returns_400_when_qty_is_zero() =>
    Assert.IsInstanceOfType<BadRequestObjectResult>(Sut().Quote(Req("?qty=0"), "ABC"));
```

Seis testes MSTest 4.5.3 (três no cálculo de preço, três no adaptador da função) rodaram em 125 ms com `dotnet run` no projeto de teste, sob o runner Microsoft.Testing.Platform, sem host, sem Azurite e sem rede. O que isso não cobre é a ligação: nomes de bindings, rotas, `host.json`, registro de DI. Um teste que sobe o host de verdade (Core Tools mais Azurite) por pipeline é o custo realista. [Test Doubles in .NET: Fakes, Stubs and NSubstitute](/dotnet-testing-concepts/test-doubles-fakes-stubs-and-nsubstitute) e [Testing BackgroundService, Channels and Async Code](/dotnet-testing-concepts/testing-background-services-and-async-code) cobrem as técnicas.

### Versões, planos e datas (docs only)

Das páginas do Learn (`functions-versions` de 2026-10-12, `dotnet-isolated-process-guide` de 2026-11-10, `functions-scale` de 2026-11-09):

- "Support will end for the in-process model on November 10, 2026." O modelo in-process suportava só o .NET 8; o isolated suporta .NET 11, .NET 10 (fim de suporte em 14 de novembro de 2028), .NET 9 e .NET 8 (ambos em 10 de novembro de 2026) e .NET Framework 4.8.1.
- O .NET 11 exige `Azure.Functions.Sdk` 1.0.1 ou superior e um `Microsoft.Azure.Functions.Worker` explícito; `func init --worker-runtime dotnet-isolated --target-framework net11.0` cria o projeto. F# no .NET 11 está temporariamente indisponível.
- "You can't run .NET 10 or later apps on Linux in the Consumption plan. To run on Linux, you should instead use the Flex Consumption plan." Logo, o "só no Flex Consumption" do backlog é forte demais: a restrição é do Consumption no Linux, que será aposentado em 30 de setembro de 2028; Premium, Dedicated e Container Apps também rodam Linux, e o Consumption no Windows (legado) não é afetado.
- Flex Consumption: só Linux, escala por função até 1.000 instâncias, memória de 512, 2.048 ou 4.096 MB, instâncias always-ready para reduzir o cold start, integração com VNet. Premium: workers pré-aquecidos, instâncias "always ready". Dedicated: o host roda continuamente, então cold start "isn't really an issue". Consumption: o plano legado, "scale to zero ... some requests might have more latencies at startup". Timeout padrão de 30 minutos, exceto no Consumption (5, máximo 10); qualquer gatilho HTTP tem no máximo 230 segundos para responder.

O cold start não foi medido: os cerca de 4 s do meu `dotnet run` local não são um número do Azure. As alavancas da doc para .NET são a configuração de placeholders, `Microsoft.Azure.Functions.Worker` 1.19.0 ou superior, o `FrameworkReference` do ASP.NET Core e ReadyToRun.

### Livro vs hoje

Livros, posts e templates antigos ensinam o modelo in-process: `Microsoft.NET.Sdk.Functions`, `[FunctionName]`, `ILogger` como parâmetro do método, `[assembly: FunctionsStartup]` com `IFunctionsHostBuilder`, `IAsyncCollector<T>` e `IBinder`. Os passos de migração da doc: `[FunctionName]` vira `[Function]`; o logger vem da DI (`ILogger<T>`) ou do `FunctionContext`; `Startup.cs` vira `Program.cs`; os bindings passam para `Microsoft.Azure.Functions.Worker.Extensions.*` (entradas ganham o sufixo `Input`, saídas `Output`); `IAsyncCollector<T>` vira `T[]`; `IBinder` vira um client do SDK do serviço (veja [Azure SDK Clients and DefaultAzureCredential](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential)). Não referencie nenhum pacote `Microsoft.Azure.WebJobs.*` nem `Microsoft.Azure.Functions.Extensions` num app isolated. Antes do worker 2.x, `ConfigureFunctionsWorkerDefaults` era o único start-up; ele continua funcionando. Durable Functions existe para apps isolated (`...Extensions.DurableTask` 1.22.0) e não é tratado aqui: para jobs que precisam de orquestração, compare com [Durable Jobs with Hangfire and Quartz.NET](/dotnet-concepts/durable-jobs-hangfire-and-quartz).

## Trade-offs

- **Isolated worker vs in-process.** O worker custa um segundo processo e um salto gRPC por invocação, e você perde `IBinder` e `IAsyncCollector`; em troca ganha suas próprias versões de dependências, DI, middleware e toda versão atual do .NET. Para trabalho novo não há escolha: o in-process terminou em 2026-11-10.
- **IActionResult vs HttpResponseData.** Os tipos do ASP.NET Core são conhecidos e o corpo da requisição pode ser lido em streaming, mas só existem no .NET e o pipeline de middleware do ASP.NET Core não é exposto; os tipos embutidos funcionam em todo lugar e são verbosos.
- **Gatilhos vs código seu.** Um gatilho de Queue dá retentativas, fila de veneno e escala de graça (3 tentativas e depois `orders-poison` aqui), mas as regras de retry ficam no `host.json`, não no seu código; um `BackgroundService` num container dá controle total e nenhuma escala.
- **Dependência de storage.** Todo gatilho que não é HTTP precisa de uma conta de storage (`AzureWebJobsStorage`) para locks e checkpoints; localmente é o Azurite, no Azure é uma conta real cuja conexão você precisa proteger.
- **Flex Consumption vs Premium.** O Flex escala a zero e cobra por execução, com instâncias always-ready opcionais; o Premium mantém workers aquecidos a um preço previsível. Escolha pelo formato do tráfego, com os seus números.

## Documentation Links

- [Guide for running C# Azure Functions in an isolated worker process, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) (doc)
- [Azure Functions runtime versions overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions) (doc)
- [Migrate C# apps from in-process to isolated worker model, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/migrate-dotnet-to-isolated-model) (doc)
- [Differences between in-process and isolated worker process, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-in-process-differences) (doc)
- [Azure Functions scale and hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale) (doc)
- [Flex Consumption plan hosting, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan) (doc)
- [Migrate Consumption plan apps to Flex Consumption, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/migration/migrate-plan-consumption-to-flex) (doc)
- [Develop and run Azure Functions locally (local.settings.json), Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local) (doc)
- [host.json reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json) (doc)
- [Azure Functions Core Tools, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) (doc)
- [Triggers and bindings in Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings) (doc)
- [Azure Queue storage trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger) (doc)
- [Timer trigger for Azure Functions, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer) (doc)
- [Event-driven scaling and cold start, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-functions/event-driven-scaling) (doc)
- [Use the Azurite emulator for local Azure Storage development, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (doc)
- [Durable Functions in the .NET isolated worker, Microsoft Learn](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-dotnet-isolated-overview) (doc)
- [azure-functions-dotnet-worker, GitHub](https://github.com/Azure/azure-functions-dotnet-worker) (doc)
