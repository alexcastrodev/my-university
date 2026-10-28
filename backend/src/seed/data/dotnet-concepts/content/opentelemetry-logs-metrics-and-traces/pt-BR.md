---
version: 1.0
updatedAt: 2026-10-28
title: "OpenTelemetry: logs, métricas e traces"
summary: ILogger, Meter e ActivitySource como as três APIs do framework, o que o ASP.NET Core já emite sozinho, o que o SDK e os pacotes de instrumentação acrescentam, propagação de contexto, limite de cardinalidade de métricas, buckets de histograma, amostragem, resource e o caminho que o exportador OTLP realmente usa, com o resultado medido de cada experimento.
---
## Objective

Quando uma requisição fica lenta ou falha em produção você precisa de três tipos de evidência: logs (o que aconteceu), métricas (quantas vezes e quanto tempo, de forma agregada) e traces (onde uma requisição gastou o tempo ao passar por vários serviços). O .NET não esconde isso atrás do SDK de um fornecedor: o próprio framework traz as APIs (`ILogger`, `Meter`, `ActivitySource`) e já emite dados por elas. O OpenTelemetry é a camada padrão que coleta esses dados e os exporta, normalmente por OTLP, para o backend que você usa. Este conceito separa as duas metades que as pessoas misturam (o que o framework e o seu código emitem, o que o SDK coleta), roda as duas num app real e mede as partes que machucam: uma instrumentação que não faz nada em silêncio, uma métrica que perde as dimensões, uma amostragem que corta o trace pela metade e um exportador que faz POST no caminho errado. Versões usadas: SDK 10.0.100, pacotes OpenTelemetry 1.20.1.

## Use Cases

- Descobrir qual salto de uma requisição que passa por três serviços acrescentou os 800 ms.
- Alertar sobre taxa de requisições, taxa de erros e percentis de latência sem ler logs.
- Correlacionar uma linha de log com a requisição exata que a produziu.
- Enviar a mesma telemetria para o Aspire Dashboard em desenvolvimento e para um backend gerenciado em produção mudando só variáveis de ambiente.

## Deep Dive

### Três sinais, três APIs do framework

A documentação descreve a divisão: `Microsoft.Extensions.Logging.ILogger` para logs, `System.Diagnostics.Metrics.Meter` para métricas, `System.Diagnostics.ActivitySource` e `Activity` para tracing. Esses tipos fazem parte do .NET, então uma biblioteca pode se instrumentar sem referenciar nenhum fornecedor de telemetria. O trabalho do OpenTelemetry é escutá-los e exportar. Os nomes diferem: o que o OpenTelemetry chama de tracer e span são `ActivitySource` e `Activity` no .NET, e o que ele chama de attributes são tags.

### Tracing: StartActivity pode devolver null

Um `ActivitySource` não custa nada até alguém escutar. Sem listener:

```csharp
var src = new ActivitySource("Shop.Orders", "1.0.0");
src.StartActivity("x");   // null
```

Com um listener, o que ele responde em `Sample` decide o que você recebe:

```text
no listener:        StartActivity -> null
None                activity=null
PropagationData     activity=created, IsAllDataRequested=False, Recorded=False
AllData             activity=created, IsAllDataRequested=True,  Recorded=False
AllDataAndRecorded  activity=created, IsAllDataRequested=True,  Recorded=True
```

Escreva sempre `activity?.SetTag(...)`, porque o resultado pode ser nulo. `PropagationData` cria uma activity só para levar o trace id adiante para o próximo serviço; `IsAllDataRequested` é a dica de que ninguém vai ler as tags, então pule as caras. Os IDs seguem o formato W3C (`Activity.DefaultIdFormat` é `W3C`), e os filhos são ligados automaticamente por `Activity.Current`, que atravessa o `await`:

```text
parent.Id      = 00-f0d96be9f9ac273ef74b763ab5c9571c-676432794cb0bbc8-01
child.Id       = 00-f0d96be9f9ac273ef74b763ab5c9571c-0e544646a89f0fa8-01
child.ParentId = 00-f0d96be9f9ac273ef74b763ab5c9571c-676432794cb0bbc8-01
same TraceId=True, Current is child=True
after await: Current is child=True
after child.Dispose: Current is parent=True
```

O formato é `versão-traceid-spanid-flags`. A falha é registrada com `activity?.SetStatus(ActivityStatusCode.Error, "card declined")`. A documentação acrescenta duas regras práticas: eventos ficam em memória até serem enviados, então use `ILogger` para volumes grandes ou sem limite, e não envolva todo método numa activity, porque o trace fica ilegível.

### Métricas: instrumentos e listeners

Um `Meter` é um grupo nomeado de instrumentos. Cada tipo de instrumento declara uma intenção que os backends usam para escolher o cálculo padrão:

```csharp
var meter = new Meter("Shop.Orders", "1.0.0");
var created  = meter.CreateCounter<long>("shop.orders.created", "{order}", "Orders created");
var duration = meter.CreateHistogram<double>("shop.orders.duration", "s");
var inFlight = meter.CreateUpDownCounter<int>("shop.orders.in_flight");
meter.CreateObservableGauge("shop.orders.pending", () => pending);
```

Use um counter para um valor que só cresce, um up-down counter para algo que sobe e desce, um histogram para durações e tamanhos (você quer percentis, não uma média) e um instrumento observável quando você já mantém o total e quer que ele seja lido sob demanda (os callbacks observáveis rodam em sequência, então mantenha-os rápidos). Um `MeterListener` é o gancho em processo que os SDKs usam, e eu o usei direto:

```text
no listener:   created.Enabled=False
with listener: created.Enabled=True
  Counter`1        shop.orders.created = 1 {region=eu}
  Counter`1        shop.orders.created = 2 {region=us}
  Histogram`1      shop.orders.duration = 0.012
  UpDownCounter`1  shop.orders.in_flight = 1
  ObservableGauge`1 shop.orders.pending = 7
```

`Enabled` é falso sem listener, e o primeiro `Add(1)` nesse estado não foi ouvido por ninguém. Siga o conselho de nomes da documentação: nomes minúsculos separados por ponto, unidades em UCUM (`s`, `By`, `{order}`) e durações em segundos como `double`. Em código que usa DI, obtenha o `Meter` de `IMeterFactory` (os hosts o registram desde o .NET 8) em vez de um campo estático, para que meters em contêineres diferentes fiquem isolados, o que importa quando os testes rodam em paralelo. O `MetricCollector<T>` do pacote `Microsoft.Extensions.Diagnostics.Testing` faz asserções sobre as medições num teste.

### O que o framework já emite

Subi uma minimal API sem nenhum pacote do OpenTelemetry, só com um `ActivityListener` e um `MeterListener`, e fiz uma requisição que chama um segundo endpoint por `HttpClient`:

```text
ActivitySources that produced activities:
  Microsoft.AspNetCore / Microsoft.AspNetCore.Hosting.HttpRequestIn (Server)
  System.Net.Http / System.Net.Http.HttpRequestOut (Client)
  Experimental.System.Net.Http.Connections / ...ConnectionSetup, ...WaitForConnection
  Experimental.System.Net.Sockets / ...Connect

Meters published (a selection):
  Microsoft.AspNetCore.Hosting / http.server.request.duration, http.server.active_requests
  Microsoft.AspNetCore.Routing / aspnetcore.routing.match_attempts
  Microsoft.AspNetCore.Server.Kestrel / kestrel.active_connections, kestrel.connection.duration, ...
  System.Net.Http / http.client.request.duration, http.client.open_connections, ...
  System.Runtime / dotnet.gc.collections, dotnet.gc.pause.time, dotnet.thread_pool.queue.length, ...
```

Os contadores antigos do runtime (`EventCounters`, `PerformanceCounter`) são legado perto disso. O endpoint de destino imprimiu o header que recebeu:

```text
server activity trace=9c5458b80311b86ac52c6e20e14bea83
downstream saw: traceparent=00-9c5458b80311b86ac52c6e20e14bea83-73d5009bb7056542-01
```

O `HttpClient` injetou um header `traceparent` tirado da activity atual, então o segundo salto entrou no mesmo trace sem nenhum código meu. Isso é a propagação de contexto, e é ela que transforma um monte de spans em um trace só.

### Ligando o SDK

O SDK assina as fontes e os meters que você nomear e os envia para um exportador:

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api", serviceVersion: "1.0.0"))
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                       .AddSource("Shop.Orders").AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
                       .AddRuntimeInstrumentation().AddMeter("Shop.Orders").AddOtlpExporter());
```

`AddSource` e `AddMeter` são opt-in: os dados do seu `Shop.Orders` são descartados a menos que você registre o nome. A documentação também aponta o template de projeto `ServiceDefaults` do Aspire (`dotnet new aspire-servicedefaults`) como a configuração inicial mais fácil, mesmo sem o resto do Aspire. O exportador de `Console` (`OpenTelemetry.Exporter.Console`) é o jeito rápido de ver o que está sendo exportado.

### O que os pacotes de instrumentação ainda acrescentam

No .NET 10 o framework já cria os spans de servidor e de cliente, então comparei dois hosts: um com `AddAspNetCoreInstrumentation()` e `AddHttpClientInstrumentation()`, outro que só chama `AddSource("Microsoft.AspNetCore", "System.Net.Http")`:

```text
with the packages:
  Microsoft.AspNetCore | GET /orders/{id:int} | Server | tags: http.request.method=GET, url.path=/orders/7, http.route=/orders/{id:int}, http.response.status_code=200, server.address, server.port, url.scheme
  System.Net.Http      | GET                  | Client | tags: http.request.method, url.full=..., http.response.status_code=200

only AddSource:
  Microsoft.AspNetCore | Microsoft.AspNetCore.Hosting.HttpRequestIn | Server | tags: (none)
  System.Net.Http      | GET                  | Client | tags: same as above
```

O span de cliente foi idêntico, mas o de servidor chegou com o nome cru da operação e sem tags. O pacote do ASP.NET Core nomeia o span pela rota e preenche os atributos das convenções semânticas (`http.route`, código de status), que é o que os dashboards usam para agrupar. Para métricas não houve diferença no resultado: os dois hosts exportaram `http.server.request.duration`, `kestrel.active_connections`, `http.client.request.duration` e o conjunto `dotnet.*` do runtime, porque os meters do framework já os publicam e os pacotes servem principalmente para habilitar os nomes de meter certos.

### Um trace atravessando os saltos

Os spans exportados de uma requisição nesse host, ligados pelo pai:

```text
GET /orders/7          Client    System.Net.Http       parent: none
  GET /orders/{id:int} Server    Microsoft.AspNetCore  parent: the client span
    load-order         Internal  Shop.Orders           parent: the server span
      GET              Client    System.Net.Http       parent: load-order
        GET /down      Server    Microsoft.AspNetCore  parent: the client span
```

Cinco spans, um trace id, cada `ParentSpanId` apontando para o salto anterior. Uma activity própria não precisa de mais nada para entrar: ela pegou `Activity.Current` como pai.

### Cardinalidade de métricas: a perda silenciosa de dados

As tags tornam uma métrica multidimensional, e cada combinação distinta é armazenada. Registrei 3000 acessos com um `user.id` diferente em cada um, pelo SDK, com o limite padrão, depois com `CardinalityLimit = 100`, e para contraste com 5 rotas distintas:

```text
default limit, 3000 distinct user.id: points=2001, total=3000, overflow point=yes (value 1000)
CardinalityLimit=100:                 points=101,  total=3000, overflow point=yes (value 2900)
5 distinct routes:                    points=5,    total=3000, overflow point=no
```

O total é preservado, mas depois de 2000 combinações (o padrão) as demais são dobradas num único ponto marcado com `otel.metric.overflow=true`, então 1000 desses usuários não podem mais ser distinguidos. Nada lança exceção e nada vai para o log. A documentação dá a razão: as ferramentas de coleta alocam armazenamento por combinação de tags, e cerca de 1000 combinações por instrumento é um orçamento seguro. Ponha valores limitados nas tags (template da rota, classe de status, região), nunca ids, e-mails ou URLs cruas. Uma pergunta por usuário pertence aos logs ou aos traces.

### Buckets de histograma

Um histograma é exportado como buckets, e os limites padrão do SDK (`0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000`) servem para milissegundos, não para os segundos que a documentação recomenda para durações. Seis medições entre 4 ms e 900 ms:

```text
default:       count=6 sum=1.158 buckets [<=0:0 <=5:6 <=10:0 ... <=10000:0 <=inf:0]
with advice:   count=6 sum=1.158 buckets [<=0.005:1 <=0.01:0 <=0.025:2 <=0.05:1 <=0.1:0 <=0.5:1 <=1:1 <=inf:0]
```

Com os padrões, as seis caíram no bucket `<=5`, então os percentis ficam inúteis. O segundo instrumento foi criado com `new InstrumentAdvice<double> { HistogramBucketBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1] }` (de `System.Diagnostics.DiagnosticSource` 9, usado pelo SDK a partir da 1.10), que permite ao autor do instrumento recomendar limites sensatos. O framework faz isso nos próprios histogramas: ler `Advice` em `http.server.request.duration` e `http.client.request.duration` no .NET 10 deu `0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10` segundos, então esses dois já servem de fábrica e só os seus próprios histogramas precisam de advice.

### Amostragem: mantenha o trace inteiro

Gravar todo span é caro em volume. Um sampler decide na raiz, e o sensato é o `ParentBasedSampler(new TraceIdRatioBasedSampler(0.1))`: a decisão sai do trace id e os filhos seguem o pai. Enviei 2000 requisições, cada uma com um span filho:

```text
ratio 0.1, 2000 requests: roots recorded=191, children recorded with sampled root=191,
                          children recorded under unsampled root=0, exported spans=382
default sampler, 50 requests: exported=50
```

Cerca de 10% dos traces foram mantidos, e cada trace mantido veio completo (os 191 filhos vieram com seus 191 pais, e nenhum apareceu sem pai). O padrão amostra tudo. A amostragem é por trace, então um erro raro é descartado com a mesma probabilidade de uma requisição saudável; a amostragem baseada na cauda, que mantém traces lentos ou com falha, é feita num collector, não neste SDK.

### Resource: quem está falando

Todo sinal carrega um resource que identifica o serviço. Sem configuração:

```text
service.name=unknown_service:OtelLab, telemetry.sdk.name=opentelemetry, telemetry.sdk.language=dotnet, telemetry.sdk.version=1.20.1
```

Com `OTEL_SERVICE_NAME=orders-api` e `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=staging,service.version=1.4.2` definidos no ambiente:

```text
service.name=orders-api, deployment.environment.name=staging, service.version=1.4.2, ...
```

Defina pelo menos `OTEL_SERVICE_NAME` em todo deploy. Senão o backend mostra um serviço com o nome do processo, e dois serviços com o mesmo nome de executável se fundem.

### Logs que apontam para o seu trace

O OpenTelemetry se pluga no `ILogger`, então as chamadas de log existentes não mudam. Dentro de uma activity ativa:

```csharp
logger.LogInformation("Order {OrderId} placed, total {Total}", 42, 9.9m);
```

```text
in activity: TraceId=d747be3aa0ca29352f021160e351abbf (matches the activity), SpanId=1b30f63abb610b09, LogLevel=Information
  FormattedMessage='Order 42 placed, total 9.9', Body='Order {OrderId} placed, total {Total}'
  Attributes: OrderId=42, Total=9.9, {OriginalFormat}=Order {OrderId} placed, total {Total}
  Scopes: tenant=acme
outside any activity: TraceId=00000000000000000000000000000000, SpanId=0000000000000000
```

O registro de log carrega os ids de trace e de span, então um backend consegue ir de um trace para os logs dele e voltar. O template da mensagem continua como corpo e cada placeholder vira um atributo (`OrderId=42`), e por isso você deve logar com templates, não com strings interpoladas. Um log escrito fora de qualquer activity tem os ids todos zerados. (`IncludeFormattedMessage` e `IncludeScopes` são opções do provider de logging, desligadas por padrão.)

### Exportando com OTLP

O `OpenTelemetry.Exporter.OpenTelemetryProtocol` envia tudo para qualquer endpoint OTLP (um collector, o Aspire Dashboard, a maioria dos fornecedores). Apontei-o para um listener HTTP local que registrava o que recebia:

```text
env OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 + protocol http/protobuf: POST /v1/traces
code  Endpoint=http://127.0.0.1:4318 + HttpProtobuf:                            POST /
code  Endpoint=http://127.0.0.1:4318/v1/traces + HttpProtobuf:                  POST /v1/traces
```

Pela variável de ambiente o exportador acrescenta o caminho de cada sinal (`/v1/traces`, `/v1/metrics`, `/v1/logs`). Uma URI definida em código é usada como foi escrita, então sobre HTTP a primeira variante em código fez POST em `/` e um collector responderia 404. Prefira as variáveis padrão `OTEL_EXPORTER_OTLP_*`, que também fazem a mesma imagem funcionar contra um backend diferente por ambiente.

## Trade-offs

- **A instrumentação é opt-in por nome.** Uma fonte ou meter que você nunca registrou é descartado em silêncio.
  ```csharp
  .WithTracing(t => t.AddSource("Shop.Orders"))   // esqueça isso e load-order nunca aparece
  ```
- **As tags são o centro de custo das métricas.** Cada combinação distinta custa memória e dinheiro, e passado o limite a dimensão colapsa num único ponto de overflow.
  ```csharp
  counter.Add(1, new("route", "/orders/{id}"));   // bom: limitado
  counter.Add(1, new("user.id", userId));         // ruim: sem limite
  ```
- **Amostrar troca completude por custo.** A 10% você perde a maioria das falhas raras; mantenha os erros com um collector que faça amostragem na cauda, ou amostre a 100% num serviço de pouco tráfego.
- **Nomes e tags dos spans vêm do pacote de instrumentação.** Registrar só a fonte do framework dá spans, mas sem nome de rota e sem atributos, o que impossibilita agregar por endpoint.
- **Logs, métricas e traces respondem a perguntas diferentes.** Métricas são baratas e agregadas, traces mostram o caminho de uma requisição, logs guardam o detalhe. Use o mais barato que responde à sua pergunta.
- **Telemetria tem custo em tempo de execução.** Gravar é barato (menos de 10 ns sem listener segundo a documentação, mais com um coletor), mas eventos sem limite numa activity ficam em memória até serem exportados.
- **Pacotes e convenções mudam.** Os spans acima declaram um schema de convenção semântica (`https://opentelemetry.io/schemas/1.44.0`), e os nomes de atributos mudam conforme esse schema evolui, então monte dashboards e alertas sobre os nomes que você realmente exporta e confira-os de novo ao atualizar os pacotes.

## Documentation Links

- [.NET Observability with OpenTelemetry, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel) (doc)
- [Creating Metrics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/metrics-instrumentation) (doc)
- [Add distributed tracing instrumentation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-instrumentation-walkthroughs) (doc)
- [Compare metric APIs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/compare-metric-apis) (doc)
- [ASP.NET Core metrics, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/metrics/overview?view=aspnetcore-10.0) (doc)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/) (doc)
