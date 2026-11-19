---
version: 1.0
updatedAt: 2026-11-19
title: "Observabilidade de MCP: OpenTelemetry e Propagação de Trace"
summary: O que o SDK C# do MCP 2.4.0 emite sozinho (ActivitySource e Meter Experimental.ModelContextProtocol, spans, tags e histogramas), traceparent, tracestate e baggage em _meta medidos no fio em stdio e HTTP, a árvore completa chat, tool, requisição MCP e handler com UseOpenTelemetry e UseFunctionInvocation, o que fica fora das tags por padrão, a cardinalidade de mcp.resource.uri, logs em stderr agora que Logging foi depreciado e exportação por OTLP.
---
## Objective

Uma chamada MCP atravessa uma fronteira de processo (um pipe ou o HTTP) que o seu tracing não enxerga, a menos que algo leve o contexto de trace junto. O SDK C# faz as duas metades: emite spans e métricas próprios e escreve `traceparent`,
`tracestate` e `baggage` no `_meta` da requisição, de modo que o handler do servidor cai no mesmo trace da chamada do cliente. Esta lição mede o que o SDK emite e o que registra por padrão (e o que não deveria), como o contexto viaja em stdio e em HTTP, como fica a árvore com `UseOpenTelemetry()` e
`UseFunctionInvocation()` sobre um `IChatClient` roteirizado (sem modelo), por que um servidor stdio precisa manter a telemetria fora do stdout e como exportar por OTLP. O básico de OpenTelemetry (sources, meters, configuração do SDK, amostragem) está na lição "OpenTelemetry: Logs, Metrics and Traces" e não se repete aqui. Versões: `ModelContextProtocol`, `ModelContextProtocol.Core` e
`ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.Extensions.AI` 10.11.0,
`OpenTelemetry` (`.Extensions.Hosting`, `.Exporter.Console`,
`.Exporter.OpenTelemetryProtocol`, `.Exporter.InMemory`) 1.21.0, `net10.0`, SDK 10.0.100, revisão da spec 2026-07-28.

## Use Cases

- Ver um único trace da requisição do usuário, passando pelo loop do agente, pela chamada MCP e pelo handler do servidor.
- Alertar sobre tools lentas ou com falha com os histogramas de duração do SDK, por tool.
- Manter logs e traces de um servidor stdio fora do canal do protocolo.
- Revisar o que uma integração MCP coloca na telemetria antes de ela chegar a um backend de terceiros.

## Deep Dive

### O que o SDK emite sozinho

Os nomes não estão na documentação que encontrei: li a tabela de strings de
`ModelContextProtocol.Core.dll` e confirmei com listeners. Há um `ActivitySource` e um `Meter`, ambos chamados `Experimental.ModelContextProtocol` (o prefixo avisa que as convenções ainda mudam). Dois processos, um cliente e um servidor stdio, cada um com um `ActivityListener` e um `MeterListener` meus (`Sample` devolvendo
`AllDataAndRecorded`), uma `tools/call` sob um span raiz `Demo.Host`:

```text
client Demo.Host | checkout-flow | Internal | trace=44bdd0ea span=5b42e0 parent=none | 43.5 ms
client Experimental.ModelContextProtocol | tools/call get_stock | Client | trace=44bdd0ea span=b996cd parent=5b42e0 | 32.3 ms
   tags: mcp.session.id, jsonrpc.request.id=2, mcp.method.name=tools/call, network.transport=pipe,
         mcp.protocol.version=2026-07-28, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool
server Experimental.ModelContextProtocol | tools/call get_stock | Server | trace=44bdd0ea span=3301c2 parent=b996cd | 31.8 ms
server Stock.Server | load-stock | Internal | trace=44bdd0ea span=815ff9 parent=3301c2 | 22.1 ms
```

O nome do span é `{mcp.method.name} {alvo}`. O span do servidor é filho do span do cliente, no mesmo trace, e a minha própria atividade `load-stock` (um
`ActivitySource` chamado `Stock.Server`, iniciado dentro da tool) fica sob o span do servidor sem nenhum código extra. `server/discover` também ganha um span, e
`resources/read` se chama apenas `resources/read`. Quatro histogramas, todos em segundos:

```text
client metric mcp.client.operation.duration (s) = 0.0324 {mcp.method.name=tools/call, network.transport=pipe, mcp.protocol.version=2026-07-28, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool}
server metric mcp.server.operation.duration (s) = 0.0319 {mcp.method.name=tools/call, network.transport=pipe, gen_ai.tool.name=get_stock, gen_ai.operation.name=execute_tool}
client metric mcp.client.session.duration (s) = 0.7553 {network.transport=pipe}      (também mcp.server.session.duration)
```

Duas esquisitices. Cada resposta também gerou uma medição com
`mcp.method.name=unknownMethod` e valor quase zero, então um histograma de 2501 operações reais teve contagem 5002; não achei a causa, então exclua esse valor de tag em views e alertas. E o `mcp.session.id` é diferente no cliente e no servidor em stdio (cada lado cria o seu), logo não serve para juntar os dois lados: junte pelo trace id.

### O contexto viaja em _meta

A tabela de `_meta` da spec reserva `traceparent`, `tracestate` e `baggage` para o contexto de trace do OpenTelemetry (SEP-414, uma mudança menor da 2026-07-28), nos formatos W3C Trace Context e W3C Baggage. Capturando o stdin do filho com
`sh -c "tee c2s.log | dotnet Server.dll | tee s2c.log"`, com `tracestate` e baggage definidos na atividade raiz:

```text
{"method":"tools/call","params":{"name":"get_stock","arguments":{"sku":"SKU-1"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"Client","version":"1.0.0.0"},"io.modelcontextprotocol/clientCapabilities":{},"traceparent":"00-e6c238e038c80845005bce894cc06868-e54696841d81bedb-03","tracestate":"vendor=abc","baggage":"tenant = acme"}},"id":2,"jsonrpc":"2.0"}
```

O id do pai em `traceparent` (`e54696...`) é o span MCP do cliente, não a raiz. O cliente fixado em `ProtocolVersion = "2025-11-25"` mandou as mesmas três chaves sozinhas no `_meta`, e o span do servidor continuou filho do span do cliente: a propagação não depende do protocolo novo. O que o servidor fez com elas:

```text
handler sees: tracestate='vendor=abc' Activity.Baggage=[] OTel Baggage.Current=[]
_meta baggage read by hand: tenant = acme      (ctx.Params?.Meta?["baggage"] numa tool com RequestContext<CallToolRequestParams>)
```

`traceparent` e `tracestate` são restaurados no span do servidor; o `baggage` é escrito pelo cliente, mas não restaurado no 2.4.0 (o IL referencia
`ExtractTraceIdAndState`, não `ExtractBaggage`). Se um id de tenant precisa chegar às tags ou aos logs do servidor, leia `_meta["baggage"]` você mesmo e decida em que confiar, porque qualquer cliente pode mandar qualquer valor.

### No HTTP há dois pais

No Streamable HTTP a mesma requisição leva o contexto duas vezes: no header
`traceparent` (colocado pelo `HttpClient`) e no `_meta` (colocado pelo SDK). O servidor escutou também o `Microsoft.AspNetCore`:

```text
trace=b1f41122  Demo.Host checkout-flow                         span=f2ceb9
  client  MCP   tools/call get_stock                            span=45d458  parent=f2ceb9
    client  System.Net.Http POST                                span=e6d50c  parent=45d458
      server  Microsoft.AspNetCore HttpRequestIn                span=1063ff  parent=e6d50c   (do header)
    server  MCP   tools/call get_stock                          span=50bfd9  parent=45d458   (do _meta)
      server  Stock.Server load-stock                           span=114f51  parent=50bfd9
```

O span MCP do servidor não é filho do span do ASP.NET Core: os dois pendem do span do cliente, um pelo header e outro pelo `_meta`. Um backend que desenha a árvore ainda mostra um único trace, mas não espere que o span HTTP do servidor seja o pai da tool. O cliente reportou `network.transport=unknown` no HTTP enquanto o servidor disse `tcp`, então agrupe por `mcp.method.name` e nome da tool, não por transporte, ao cruzar os dois lados. Aqui o `baggage` chegou ao span do ASP.NET Core (pelo header HTTP), mas não ao span MCP.

### A árvore completa: chat, tool, requisição MCP, handler

Um `IChatClient` roteirizado (sem modelo) responde à primeira chamada com um
`FunctionCallContent` para `get_stock` e à segunda com texto. As tools MCP de
`ListToolsAsync()` vão em `ChatOptions.Tools`. A ordem do middleware define a árvore, porque os spans do loop de tools dependem de onde fica o
`UseOpenTelemetry()`. Primeiro,
`UseFunctionInvocation().UseOpenTelemetry(sourceName: "lab.llm")`:

```text
handle-user-request                          Demo.Host
  orchestrate_tools                          lab.llm
    chat                                     lab.llm      (o modelo pede get_stock)
    execute_tool get_stock                   lab.llm      (+ tags mcp.* postas pelo SDK do MCP)
      tools/call get_stock       [server]    Experimental.ModelContextProtocol   (outro processo, pai = execute_tool)
        load-stock               [server]    Stock.Server
    chat                                     lab.llm      (a resposta final)
```

Não há span MCP de cliente na lista do cliente: quando a atividade atual já se chama `execute_tool ...`, o SDK não cria o seu e escreve `mcp.method.name`,
`mcp.session.id` e as outras tags nesse span, e o `_meta` leva o id do span
`execute_tool`. Confirmei à mão: iniciar uma atividade minha chamada
`execute_tool get_stock` suprimiu o span do cliente, `other-name` não. As convenções MCP do OpenTelemetry pedem exatamente isso (não criar um span separado quando a instrumentação GenAI externa já traça a execução da tool). Com a ordem invertida, `UseOpenTelemetry().UseFunctionInvocation()`, o resultado foi um único span `chat` para o loop inteiro (o modelo roteirizado rodou duas vezes dentro dele), nenhum span `orchestrate_tools` ou `execute_tool`, e o span MCP do cliente
`tools/call get_stock` direto sob `chat`. Use a primeira ordem para ver cada chamada de modelo e cada chamada de tool como um span.

### O que é registrado por padrão, e o que não é

Os spans e as métricas do SDK nunca carregaram argumentos de tool, resultados, texto de prompt ou conteúdo de arquivo: `get_stock` com `sku=SKU-1` não deixou
`SKU-1` em nenhum deles. As partes sensíveis estão em outro lugar:

```text
UseOpenTelemetry, EnableSensitiveData=false: tags de execute_tool get_stock: gen_ai.tool.call.id, gen_ai.tool.name, gen_ai.tool.description, mcp.*, ...
UseOpenTelemetry, EnableSensitiveData=true:  as mesmas mais
    gen_ai.tool.call.arguments={"sku":"SKU-1"}  gen_ai.tool.call.result={"$type":"text","text":"SKU-1: 12 units"}
```

`gen_ai.tool.definitions` (nomes e descrições das tools) estava no span `chat` nas duas execuções. Uma tool que lança `InvalidOperationException("db password is hunter2")`:

```text
span status=Error, error.type=tool_error          (o texto da exceção não está no span nem na métrica)
client:  IsError=True, generic text                (a lição do SDK C# mostra esta parte)
server stderr (ILogger): "fail" threw an unhandled exception. System.InvalidOperationException: db password is hunter2 ...stack...
```

O cliente e o span ficam seguros, mas o `ILogger` do próprio servidor escreveu a mensagem e a stack. Essa linha de log, mais qualquer
`LogInformation("looking up {Sku}", sku)` que você adicionar, é por onde os dados vazam. Trate o pipeline de telemetria como o de logs: decida o que sai da máquina. Uma tool desconhecida (`error.type=-32602`,
`rpc.response.status_code=-32602`) pôs o `gen_ai.tool.name=nope` do chamador na métrica do servidor, então o cliente controla esse valor de tag.

### Cardinalidade de métrica: a URI do recurso

As convenções MCP do OpenTelemetry listam `mcp.resource.uri` nas métricas de operação como Opt-In (os spans podem levá-la, o nome do span não deve). No 2.4.0 ela estava na métrica por padrão (`resources/read ... mcp.resource.uri=stock://item/SKU-7`). Um cliente lendo 2500 URIs diferentes
`stock://item/{sku}` por um `MeterProvider` real (`AddInMemoryExporter`), no padrão e depois com uma View que mantém só três chaves de tag:

```text
default: points=2001, total count=5002, overflow point=yes
with View dropping mcp.resource.uri: points=3, total count=5002, overflow point=no
```

```csharp
b.AddMeter("Experimental.ModelContextProtocol")
 .AddView("mcp.client.operation.duration",
          new MetricStreamConfiguration { TagKeys = ["mcp.method.name", "gen_ai.tool.name", "error.type"] });
```

Passado o limite padrão de 2000 combinações, o resto colapsa em
`otel.metric.overflow=true`, em silêncio (a causa está explicada na lição de OpenTelemetry). Aplique a mesma View em `mcp.server.operation.duration`. O span mantém a URI, o que serve para uma requisição, mas URIs carregam ids e caminhos de arquivo, então redija-as num span processor se o backend for compartilhado. Não rodei o caso de nomes de tool ilimitados no servidor, só observei o valor da tag.

### Logging: stderr, não stdout

A spec 2026-07-28 deprecia o recurso Logging (SEP-2577); o changelog diz "log to stderr (stdio) or use OpenTelemetry instead of Logging", e a documentação do SDK o marca como depreciado (diagnóstico `MCP9005`). `notifications/message` agora só flui para requisições que levam `io.modelcontextprotocol/logLevel` no `_meta` (só documentação, não executei). Em stdio, o stdout é o protocolo, então todo o resto vai para o stderr. Um servidor stdio com o logger de console padrão, depois com `LogToStandardErrorThreshold = LogLevel.Trace` (a lição de referência mostra o relay para o logger do cliente por `StandardErrorLines`):

```text
default console logger:       call ok, client transport parse failures (non-JSON lines on stdout): 28
LogToStandardErrorThreshold:  call ok, client transport parse failures: 0
```

O exporter de console do OpenTelemetry é a mesma armadilha, porque imprime em
`Console.Out`:

```text
AddConsoleExporter(), default:                       call ok, parse failures: 64   (o cliente descarta)
Console.SetOut(Console.Error) before the host starts: call ok, parse failures: 0, saída do exporter no stderr
```

`Console.SetOut(Console.Error)` funcionou no 2.4.0, então o transporte não usa
`Console.Out`. Melhor ainda é não usar o exporter de console num servidor stdio: use OTLP.

### Exportando por OTLP

Um servidor stdio com o SDK, configurado por variáveis de ambiente que o cliente repassa em `StdioClientTransportOptions.EnvironmentVariables`:

```csharp
b.Services.AddOpenTelemetry().ConfigureResource(r => r.AddService("stock-server", serviceVersion: "1.0.0"))
    .WithTracing(t => t.AddSource("Experimental.ModelContextProtocol").AddSource("Stock.Server").AddOtlpExporter())
    .WithMetrics(m => m.AddMeter("Experimental.ModelContextProtocol").AddOtlpExporter());
// OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:6161  OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Um `HttpListener` local fez o papel de coletor:

```text
collector: POST /v1/traces  application/x-protobuf 954 bytes  service.name=stock-server has 'tools/call get_stock'=True
collector: POST /v1/metrics application/x-protobuf 2489 bytes  service.name=stock-server has 'mcp.server.operation.duration'=True
```

Fechei o cliente e deixei o servidor encerrar normalmente antes de ler o coletor; um processo morto de forma abrupta pode perder o último lote (inferência minha, não medida). Para o Aspire Dashboard (só documentação, não executei), a página do modo standalone dá `docker run --rm -it -p 18888:18888 -p 4317:18889 -p 4318:18890 -d --name aspire-dashboard mcr.microsoft.com/aspire/dashboard:latest`, com `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` para HTTP e `4317` para gRPC: as mesmas variáveis, outro endpoint.

## Trade-offs

- **Nomes experimentais.** O source e o meter são `Experimental.ModelContextProtocol`, e as convenções MCP do OpenTelemetry estão em status Development. Dashboards montados nesses nomes quebram numa renomeação; mantenha os nomes numa constante e reconfira a cada atualização do SDK.
- **Dois pais no HTTP.** O header liga o span do ASP.NET Core e o `_meta` liga o span MCP, então a árvore tem dois ramos. Não escreva consultas que assumam a tool sob `HttpRequestIn`.
- **Baggage não é aplicado no servidor.** Ele é enviado, mas o handler lê do `_meta` por conta própria. Trate como entrada não confiável.
  ```csharp
  var tenant = ctx.Params?.Meta?["baggage"];   // valide antes de virar tag ou campo de log
  ```
- **As tags padrão podem ser ricas demais.** `mcp.resource.uri` e o nome de tool do chamador nas métricas crescem com o tráfego. Remova com uma View; argumentos e resultados ficam de fora a menos que você ligue `EnableSensitiveData`.
- **Seus logs são o vazamento.** O span disse `tool_error` enquanto o `ILogger` do servidor imprimiu o texto da exceção. Revise os logs dentro das tools e ligue `EnableSensitiveData` só em desenvolvimento.
- **A ordem do middleware muda a árvore.** `UseFunctionInvocation()` por fora de `UseOpenTelemetry()` dá spans por chamada; o contrário dá um único span `chat`.
- **stdio exige disciplina.** Nada além do protocolo no stdout: logger no stderr, sem exporter de console, sem `Console.WriteLine` solto. OTLP evita o problema.

## Documentation Links

- [Specification 2026-07-28: Base protocol, _meta and OpenTelemetry trace context, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) (doc)
- [Specification changelog 2026-07-28 (SEP-414, SEP-2577), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [OpenTelemetry semantic conventions for MCP, GitHub](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md) (doc)
- [MCP C# SDK, release v2.1.0 (telemetry samples), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.1.0) (doc)
- [MCP C# SDK, Logging concept (deprecated in 2026-07-28), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/logging/logging.md) (doc)
- [.NET distributed tracing concepts, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-concepts) (doc)
- [Add distributed tracing instrumentation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/distributed-tracing-instrumentation-walkthroughs) (doc)
- [Aspire dashboard standalone mode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard/standalone) (doc)
- [Trace Context, W3C](https://www.w3.org/TR/trace-context/) (doc)
- [Baggage, W3C](https://www.w3.org/TR/baggage/) (doc)
