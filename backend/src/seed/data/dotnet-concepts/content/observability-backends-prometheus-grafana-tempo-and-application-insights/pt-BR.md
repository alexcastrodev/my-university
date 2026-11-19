---
version: 1.0
updatedAt: 2026-11-19
title: "Backends de observabilidade: Prometheus, Grafana, Tempo e Application Insights"
summary: Para onde vão os sinais do OpenTelemetry e como consultá-los, medido em Docker com duas APIs ASP.NET Core minhas: o OpenTelemetry Collector como endpoint único, métricas no Prometheus com PromQL e o efeito de uma tag explosiva nas séries, traces no Tempo, logs no Loki com trace_id, datasources do Grafana provisionados por arquivo e validados pela API, sampling no SDK contra tail sampling no Collector, e Application Insights só pela documentação.
---
## Objective

O concept de OpenTelemetry termina no exportador OTLP: o app emite traces, métricas e logs e os envia para algum lugar. Este concept é esse "algum lugar". Ele sobe a pilha aberta de verdade no Docker (OpenTelemetry Collector, Prometheus, Grafana Tempo, Grafana Loki, Grafana) com dois serviços ASP.NET Core meus e mede o que você realmente faz com ela: enviar OTLP por gRPC e por HTTP, escrever PromQL para taxa, razão de erros e p95, ver uma tag explodir a contagem de séries, seguir uma requisição lenta do exemplar de uma métrica até o trace e até a linha de log, provisionar os datasources do Grafana por arquivo e conferi-los pela API HTTP, e comparar head sampling no SDK com tail sampling no Collector. Application Insights e Azure Monitor foram lidos só na documentação oficial, porque exigem uma assinatura do Azure (docs only). O básico de sources, meters, configuração do SDK e cardinalidade está no concept de OpenTelemetry e não é repetido. Versions: SDK 10.0.100, `net10.0`, `OpenTelemetry.Extensions.Hosting`, `OpenTelemetry.Exporter.OpenTelemetryProtocol`, `OpenTelemetry.Instrumentation.AspNetCore`, `.Http`, `.Runtime` 1.21.0, `OpenTelemetry.Exporter.Prometheus.AspNetCore` 1.21.0-beta.1 (não existe versão estável), `otel/opentelemetry-collector-contrib` 0.165.0, `prom/prometheus` v3.16.0, `grafana/tempo` 2.10.10, `grafana/loki` 3.7.10, `grafana/grafana` 13.3.1.

## Use Cases

- Escolher para onde vão traces, métricas e logs antes do primeiro deploy em produção, e quanto cada escolha custa.
- Responder "quantas requisições, quantas falham, qual o p95" com PromQL em vez de ler logs.
- Saltar de um pico de latência no painel para o trace lento e para as linhas de log daquela mesma requisição.
- Reduzir o volume de traces sem perder as requisições com erro e as lentas.
- Decidir entre a pilha aberta e o Application Insights para um time que roda no Azure.

## Deep Dive

### O Collector como endpoint único

Os apps falam OTLP com um único endereço, e o Collector decide para onde vai cada sinal. Isso tira os backends da configuração das aplicações: trocar o Tempo por outro armazenamento de traces é uma mudança no Collector, não um novo deploy de cada serviço. O Collector tem receivers, processors e exporters ligados em pipelines. Este é o arquivo inteiro do laboratório (imagem `otel/opentelemetry-collector-contrib`, a distribuição que inclui os componentes da comunidade):

```yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
processors:
  memory_limiter: { check_interval: 1s, limit_mib: 400, spike_limit_mib: 100 }
  resource/env:
    attributes: [{ key: deployment.environment.name, value: lab, action: upsert }]
  attributes/scrub:
    actions: [{ key: url.query, action: delete }]
  batch: { timeout: 1s }
exporters:
  otlp/tempo:          { endpoint: "tempo:4317", tls: { insecure: true } }
  otlphttp/prometheus: { endpoint: "http://prometheus:9090/api/v1/otlp", tls: { insecure: true } }
  otlphttp/loki:       { endpoint: "http://loki:3100/otlp" }
service:
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, resource/env, attributes/scrub, batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [memory_limiter, resource/env, batch], exporters: [otlphttp/prometheus] }
    logs:    { receivers: [otlp], processors: [memory_limiter, resource/env, batch], exporters: [otlphttp/loki] }
```

A ordem em `processors` importa: `memory_limiter` vem primeiro para recusar a sobrecarga antes de fazer trabalho, `batch` vem por último para os exporters enviarem em grupos. `resource/env` carimba `deployment.environment.name=lab` em tudo, num lugar só. `attributes/scrub` apagou `url.query`: depois de uma requisição a `/orders/5?token=abc&x=1`, uma busca TraceQL por spans com `url.query` no Tempo não achou nenhum. Não rodei o controle sem o processor, então isso mostra que o delete funcionou neste caminho, não o que o SDK envia por padrão. O Collector publica as próprias métricas na porta 8888, e esses números são usados abaixo para contar o que cada etapa recebeu e enviou.

### Uma linha no app

O app é uma API mínima rodada duas vezes (`gateway` chama `inventory`), diferenciadas só por variáveis de ambiente:

```csharp
builder.Services.AddOpenTelemetry()
    .UseOtlpExporter()   // traces, métricas e logs, endpoint e protocolo vêm das variáveis OTEL_*
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddSource("Shop"))
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation().AddMeter("Shop").AddPrometheusExporter());
app.MapPrometheusScrapingEndpoint();   // /metrics, para a comparação com scrape abaixo
```

`UseOtlpExporter()` registra o exportador OTLP para os três sinais de uma vez. Rodei duas vezes: com `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` e `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6540`, e com `http/protobuf` e `http://localhost:6541` (a 4318 do Collector). Os contadores do Collector dizem qual porta foi usada:

```text
http/protobuf: otelcol_receiver_accepted_log_records{receiver="otlp",transport="http"} 26479
               otelcol_receiver_accepted_metric_points{...transport="http"} 2547
               otelcol_receiver_accepted_spans{...transport="http"} 6230
```

Os dois funcionaram sem mudar código. Com HTTP basta a URL base: o exportador acrescenta `/v1/traces`, `/v1/metrics` e `/v1/logs` quando o endpoint vem do ambiente (veja o concept de OpenTelemetry para o caso em que não vem). gRPC é o padrão do SDK; HTTP/protobuf é o que se usa quando um proxy ou ingress não carrega HTTP/2. Repare na proporção: para cerca de 1550 pedidos o Collector aceitou 6230 spans e 26479 registros de log, ou seja, umas 4 vezes mais logs que spans. No nível `Information`, o ASP.NET Core e o `HttpClient` registram várias linhas por requisição, e o provider de logging do OpenTelemetry exporta todas. Logs costumam ser o maior sinal em volume, o que pesa na seção de custo.

### Métricas: Prometheus, duas entradas

O Prometheus pode puxar de `/metrics` ou aceitar OTLP vindo do Collector (`--web.enable-otlp-receiver`, caminho `/api/v1/otlp/v1/metrics`). Rodei os dois ao mesmo tempo contra o mesmo processo `gateway`, com a mesma carga (cerca de 30 req/s, 10% delas lentas):

```text
                                          OTLP via Collector        scrape de /metrics
taxa de /orders/{id:int}                  30.0 req/s                27.99 req/s
p95 de http_server_request_duration       0.375 s                   0.375 s
```

Os números concordam (a pequena diferença vem do intervalo de 5 s do scrape contra os 5 s da exportação OTLP, amostrados em instantes diferentes). A diferença está nos labels (o OTLP acrescenta `deployment_environment_name` e `service_instance_id`, o scrape acrescenta `otel_scope_name`). O Prometheus traduz os nomes: `http.server.request.duration` virou `http_server_request_duration_seconds_*` (pontos viram sublinhados, a unidade vira sufixo), um counter ganhou `_total`, e o resource foi para uma métrica `target_info`, exceto os atributos listados em `promote_resource_attributes` (promovi `service.instance.id` e `deployment.environment.name`, por isso esses labels existem). Com OTLP, `job` é o `service.name` e `instance` é o `service.instance.id`; com scrape eles vêm do endereço do alvo. Escolha um caminho por serviço: o scrape é simples e baseado em pull, mas exige que o Prometheus alcance o app; o push OTLP passa pelo mesmo Collector dos outros sinais e não precisa de porta aberta no app. A documentação do Prometheus lista a tradução e as opções.

PromQL sobre esses dados, tudo executado contra a API:

```promql
sum by (job, http_route) (rate(http_server_request_duration_seconds_count{http_route!="/metrics"}[30s]))
  # gateway /orders/{id:int} 34.0 req/s, inventory /stock/{id:int} 34.0 req/s
sum(rate(...count{job="gateway",http_response_status_code=~"5.."}[30s])) / sum(rate(...count{job="gateway",http_route="/orders/{id:int}"}[30s]))
  # 0.0506  (5 de cada 100 pedidos terminam em 502 porque o inventory falha a cada 20 ids)
histogram_quantile(0.95, sum by (le, job) (rate(http_server_request_duration_seconds_bucket{job="gateway"}[30s])))
  # 0.253 s com 5% de requisições lentas, 0.375 s com 10% lentas
```

Duas coisas para vigiar. `histogram_quantile` interpola dentro de um bucket: o 0.375 é o meio do bucket de 0.25 a 0.5, não uma latência medida, e quando a fatia lenta fica em exatos 5% o p95 pode oscilar entre o bucket rápido e o lento. E os buckets precisam existir: o `http.server.request.duration` do próprio .NET 10 tem limites sensatos em segundos (concept de OpenTelemetry), já os seus histogramas customizados precisam de advice.

### Cardinalidade, medida em séries

O mesmo experimento do concept de OpenTelemetry, agora visto do backend. Um counter `shop.orders.placed` e um endpoint que soma 3000 incrementos, primeiro com uma tag limitada (5 regiões), depois com um `user.id` diferente a cada vez:

```text
séries de shop_orders_placed_total (gateway)
  antes                              2     (eu, us)
  depois de 3000 hits, 5 regiões     7
  depois de 3000 hits, user.id único 2001  (2000 distintos + 1 série de overflow otel.metric.overflow="true", valor 1007)
  soma de todas as séries            6950  (nada se perdeu no total, só a identidade)
```

Os dois caminhos (OTLP e scrape) mostraram as 2001 séries. Cada série é uma série temporal que o Prometheus precisa indexar e guardar, então uma tag descuidada transformou um counter em 2001 séries, e 2000 é o teto padrão do SDK, não uma proteção do seu Prometheus: com várias instâncias do serviço as séries se multiplicam de novo pelo número de instâncias. Mantenha ids fora das tags de métrica; perguntas por usuário vão para traces e logs. O Prometheus fica barato quando os valores de label são limitados (template de rota, classe de status, região).

### Traces: por que Tempo aqui

Escolhi o Grafana Tempo e não rodei o Jaeger. Os motivos, que são julgamentos: o Tempo guarda traces em um object store (o laboratório usa disco local) sem banco de índice para operar, é consultado com TraceQL e foi feito para ser ligado a métricas e logs no Grafana, que é o ponto deste concept. A imagem all-in-one do Jaeger também é um bom visualizador local; o app e o Collector não mudariam, só o exporter no Collector. A configuração do Tempo no laboratório é o mínimo para um nó: receiver OTLP gRPC, storage `local` e `block_retention: 48h`. O exporter `otlp/tempo` do Collector o alimenta. Medi o Tempo 2.10.10 em modo binário único; o projeto também publica uma linha 3.x (3.1.1 na data desta escrita) que não rodei, então confira a configuração na versão que for publicar.

Uma requisição pelos dois serviços, achada por TraceQL e depois buscada por id:

```text
GET /api/search?q={ rootName = "GET /orders/{id:int}" && duration > 250ms }
trace 4845c8478f9319c9120e0e0405ebe18f
  gateway   GET /orders/{id:int}   301.3 ms
  gateway   price-order            301.1 ms   (meu ActivitySource "Shop")
  gateway   GET                    301.0 ms   (HttpClient)
  inventory GET /stock/{id:int}    300.8 ms
```

Quatro spans, dois serviços, um trace id: o `HttpClient` enviou o header `traceparent` e o `inventory` continuou o trace (propagação W3C, como no concept de OpenTelemetry). Os 300 ms estão no span do inventory, então a lentidão não está no gateway.

### Logs: Loki e o trace id

O Loki 3.x ingere OTLP nativamente em `/otlp` (o exporter `otlphttp/loki` do Collector), então não há um exporter Loki separado para configurar. O registro de log carrega os ids do trace e do span ativos, e o Loki os guarda como structured metadata. Liguei `IncludeFormattedMessage = true` nas opções de logging para a linha ficar legível. Um erro da chamada falha ao inventory, consultado por label e nível:

```text
{service_name="gateway"} | detected_level="error"
linha:    Order 60 failed, stock answered 500
metadata: OrderId=60 Status=500 trace_id=42ccd87e6bf8c255... span_id=07dec4a826607fac severity_text=Error scope_name=Program
labels:   service_name, deployment_environment_name   (os únicos dois labels de índice)
```

Só alguns atributos do resource viram labels (`service_name`, `deployment_environment_name`); todo o resto, inclusive `trace_id`, é structured metadata que se filtra com `| trace_id="..."`. Isso mantém o índice do Loki pequeno e é o contrário do que os hábitos de labels de alta cardinalidade sugerem. Os placeholders do template (`OrderId`, `Status`) também chegaram como metadata, então use templates, não interpolação.

### Grafana: datasources por arquivo, correlação por configuração

Os datasources são provisionados por um YAML em `/etc/grafana/provisioning/datasources`, então um container novo já nasce pronto, sem cliques:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      exemplarTraceIdDestinations: [{ name: trace_id, datasourceUid: tempo }]
  - name: Tempo
    uid: tempo
    type: tempo
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        filterByTraceID: true
        customQuery: true
        query: '{service_name="$${__span.tags["service.name"]}"} | trace_id="$${__trace.traceId}"'
      tracesToMetrics: { datasourceUid: prometheus }
  - name: Loki
    uid: loki
    type: loki
    url: http://loki:3100
    jsonData:
      derivedFields:
        - { name: trace_id, matcherType: label, matcherRegex: trace_id, url: '$${__value.raw}', datasourceUid: tempo }
```

O `$$` não é erro de digitação: o Grafana expande `$VAR` nos arquivos de provisionamento, e `$$` produz um `$` literal para as variáveis do próprio Grafana (a API devolveu `${__span.tags[...]}` e `${__trace.traceId}`). Verificação por HTTP, sem screenshots:

```text
GET /api/datasources                       loki, prometheus (default), tempo
GET /api/datasources/uid/{prometheus,tempo,loki}/health
   OK Successfully queried the Prometheus API.
   OK Data source is working
   OK Data source successfully connected.
```

Os três sinais juntos, inteiramente por `POST /api/ds/query`, o endpoint que os painéis usam:

```text
1. Prometheus, exemplar=true, bucket le="0.5": 4 exemplares, todos > 0.25 s, um com
   valor 0.301263 s e trace_id 4845c8478f9319c9120e0e0405ebe18f
2. Tempo, queryType "traceId" com esse id: os 4 spans listados acima
3. Loki, {service_name="gateway"} | trace_id="4845c8...":
   Request finished HTTP/1.1 GET http://localhost:6550/orders/1041 - 200 ... 301.2630ms
```

Exemplares precisam de dois interruptores fáceis de esquecer. No Prometheus, `--enable-feature=exemplar-storage`. No SDK .NET, o filtro de exemplares: com o padrão, `/metrics` em formato OpenMetrics não trouxe nenhum exemplar (0 linhas com `# {trace_id`), e com `OTEL_METRICS_EXEMPLAR_FILTER=trace_based` trouxe 23, e o Prometheus então os devolveu em `/api/v1/query_exemplars` (9 séries). O tipo de query "traceId" é o que busca um trace por id; mandar o id como query TraceQL devolveu erro de parse.

### Sampling: head no SDK, tail no Collector

As mesmas 1000 requisições (50 terminam em erro, 100 levam 300 ms) enviadas três vezes, contando os traces no Tempo por TraceQL depois do flush (o Tempo precisou de uns 30 s até todos ficarem pesquisáveis: uma contagem feita cedo demais deu 627 de 1000):

```text
                                        traces mantidos  traces com erro  traces lentos  spans enviados ao Tempo
sem sampling                            1000             50               100            ~4000
head: parentbased_traceidratio 0.1      81               5                8              ~326
tail: erros + >200 ms + 10%             220              50               100            880
```

O head sampling é decidido na raiz a partir do trace id (`OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`). Manteve 8% dos traces, completos, e descartou os ruins na mesma taxa que os bons: 5 de 50 erros sobreviveram. A economia é na origem: o Collector recebeu uns 326 spans, não 4000. A política de tail, no processor `tail_sampling` (`decision_wait: 5s`, três políticas: `status_code` ERROR, `latency` com limite de 200 ms, `probabilistic` 10%), manteve todos os 50 traces com erro e todos os 100 lentos, mais cerca de 8% dos 850 saudáveis. O preço: o Collector recebeu todos os 4016 spans e os segurou em memória durante o `decision_wait`, e todos os spans de um trace precisam chegar à mesma instância do Collector (com várias réplicas você precisa de balanceamento por trace id na frente). Use head sampling quando só precisa limitar o volume e aceita perder a falha rara; use tail sampling quando a falha e a requisição lenta são exatamente o motivo de guardar traces. Os dois se combinam: uma razão modesta de head no SDK e políticas de tail no Collector.

### Custo e retenção

Não cito preços; eles dependem do fornecedor e do contrato. O que as medições mostram é o que os move. Contagem de séries (uma tag transformou 2 séries em 2001), volume de logs (cerca de 4 registros de log para cada span nos níveis padrão) e volume de traces (o sampling reduziu 4000 spans para 326 ou 880 enviados). A retenção é uma configuração por armazenamento: o laboratório usou `--storage.tsdb.retention.time=2d` no Prometheus, `block_retention: 48h` no Tempo e `retention_period: 48h` no Loki. Retenção longa de logs é o padrão caro que se esquece; métricas são baratas de guardar, traces são os que se amostram.

### Application Insights e Azure Monitor (docs only)

Não rodei aqui, pois exige uma assinatura do Azure. O que a documentação da Microsoft diz hoje: a telemetria da aplicação vai para um recurso Application Insights, identificado por uma connection string. O caminho recomendado para apps .NET novos agora é o Microsoft OpenTelemetry Distro (pacote `Microsoft.OpenTelemetry`, `builder.UseMicrosoftOpenTelemetry(o => o.Exporters = ExportTarget.AzureMonitor)`); a doc diz que apps que já usam o Azure Monitor OpenTelemetry Distro não precisam fazer nada. Esse distro mais antigo é o `Azure.Monitor.OpenTelemetry.AspNetCore` (1.6.0 estável no NuGet), com `builder.Services.AddOpenTelemetry().UseAzureMonitor()`. Os dois leem `APPLICATIONINSIGHTS_CONNECTION_STRING`, e a doc recomenda a variável de ambiente em produção e a configuração em código só para desenvolvimento local. Modelo de dados: spans de trabalho de servidor caem na tabela `requests` e chamadas de saída em `dependencies`, registros de log em `traces` (nome legado), e exceções têm a tabela própria `exceptions`; o sampling é limitado por taxa ou por porcentagem fixa, pelas opções do distro. Quando vários serviços compartilham um recurso, defina o cloud role name (o `service.name` do OpenTelemetry), senão o Application Map os mistura. O SDK clássico de API do Application Insights 2.x para .NET está descontinuado e se aposenta em 2027-03-31, segundo a doc, então código novo deve usar OpenTelemetry. A doc também diz que o exporter OTLP é "só por conveniência" e sem suporte oficial ao lado do exporter do Azure.

Para desenvolvimento local sem nada disso, o Aspire Dashboard standalone aceita OTLP e mostra os três sinais em um container (coberto no concept de Aspire).

### Qual backend para qual sinal

| Sinal | Backend | Como o app envia | Consulta típica | Armadilha |
|---|---|---|---|---|
| Métricas | Prometheus | OTLP via Collector, ou scrape de `/metrics` | `histogram_quantile(0.95, sum by (le) (rate(..._bucket[5m])))` | Tags sem limite geram milhões de séries |
| Traces | Tempo (ou Jaeger) | OTLP via Collector | TraceQL `{ status = error && duration > 250ms }` | Head sampling descarta erros raros; tail exige um Collector por trace |
| Logs | Loki | OTLP via Collector (`/otlp`) | `{service_name="gateway"} \| trace_id="..."` | Maior volume; ids são metadata, não labels |
| Os três | Grafana | Datasources provisionados por arquivo | Exemplar para trace para log | Exemplares precisam de dois interruptores (filtro do SDK e feature do Prometheus) |
| Os três | Application Insights | `Microsoft.OpenTelemetry` ou `UseAzureMonitor`, connection string | KQL em `requests`, `dependencies`, `traces` | SDK clássico 2.x se aposenta em 2027-03-31; defina cloud role names |

Sobre o mercado: a pilha Grafana, Prometheus e OTLP é o padrão aberto e anda entre nuvens; o Application Insights domina nos times que rodam no Azure, e com OpenTelemetry o código de instrumentação é o mesmo, só o exportador muda.

## Trade-offs

- **O Collector é mais um serviço para operar.** Dá um endpoint único, processors centrais e troca de backend, e acrescenta um salto e um lugar onde dados podem se perder. Para um app pequeno, exportar OTLP direto para o backend é mais simples.
- **Scrape ou OTLP para métricas.** O scrape é pull e exige o app alcançável; o push OTLP divide o pipeline com os outros sinais e traduz nomes (`_seconds`, `_total`) e labels do resource de outro jeito. Escolha um por serviço, ou você conta duas vezes.
- **Head contra tail sampling.** Head é barato e cego a erros; tail guarda os traces interessantes e custa memória e um balanceador que entenda trace. Medido acima: 5 de 50 erros mantidos contra 50 de 50.
- **Correlação é configuração, não mágica.** Exemplares, `trace_id` nos logs e o link Tempo para Loki precisam cada um de uma configuração nos dois lados, e um erro de digitação vira um link morto em silêncio. Confira pela API, como acima.
- **Application Insights é gerenciado e preso ao Azure.** Menos para operar, cobrado por ingestão, com modelo de consulta em KQL; a pilha aberta é portável e você a opera. A escolha do exportador é a única diferença no código.

## Documentation Links

- [OpenTelemetry for .NET, opentelemetry.io](https://opentelemetry.io/docs/languages/dotnet/) (doc)
- [OpenTelemetry Collector, opentelemetry.io](https://opentelemetry.io/docs/collector/) (doc)
- [Tail sampling processor, GitHub](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor) (doc)
- [OpenTelemetry Exporter Prometheus AspNetCore, GitHub](https://github.com/open-telemetry/opentelemetry-dotnet/tree/main/src/OpenTelemetry.Exporter.Prometheus.AspNetCore) (doc)
- [Prometheus documentation](https://prometheus.io/docs/) (doc)
- [Using Prometheus as an OpenTelemetry backend, prometheus.io](https://prometheus.io/docs/guides/opentelemetry/) (doc)
- [Grafana Tempo documentation](https://grafana.com/docs/tempo/latest/) (doc)
- [Grafana Loki documentation](https://grafana.com/docs/loki/latest/) (doc)
- [Ingesting logs to Loki using OpenTelemetry, Grafana](https://grafana.com/docs/loki/latest/send-data/otel/) (doc)
- [Provision Grafana, grafana.com](https://grafana.com/docs/grafana/latest/administration/provisioning/) (doc)
- [Enable OpenTelemetry in Application Insights, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable) (doc)
- [OpenTelemetry configuration for Azure Monitor, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration) (doc)
- [Application Insights telemetry data model, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/data-model-complete) (doc)
- [Application Insights Classic API 2.x deprecation, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-monitor/app/asp-net-core) (doc)
- [Standalone Aspire Dashboard, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard/standalone) (doc)
