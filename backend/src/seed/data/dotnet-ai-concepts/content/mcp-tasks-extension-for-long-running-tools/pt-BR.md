---
version: 1.0
updatedAt: 2026-11-19
title: "Extensão Tasks do MCP para Tools de Longa Duração"
summary: A extensão io.modelcontextprotocol/tasks (SEP-2663) medida num servidor HTTP real com o SDK C# 2.4.0, uma tool de 6 segundos que devolve um handle em vez de bloquear, o polling com tasks/get, tasks/update com input, tasks/cancel cooperativo, os modos Synchronous, Optional e Required, o que um cliente sem a extensão enxerga, TTL, reinício do servidor e idempotência.
---
## Objective

Uma tool que leva 6 segundos, ou 6 minutos, não cabe numa única resposta HTTP:
qualquer timeout, proxy ou conexão derrubada perde o trabalho, e a spec 2026-07-28
removeu a resumabilidade SSE que antes amenizava isso. A resposta é a extensão Tasks
(`io.modelcontextprotocol/tasks`, SEP-2663): o servidor devolve na hora um handle
durável e o cliente faz polling em `tasks/get`, manda input com `tasks/update` e
cancela com `tasks/cancel`. Esta lição mede tudo num servidor Streamable HTTP de
verdade: o fio, os três modos de execução, o que um cliente sem a extensão enxerga,
cancelamento, erros, TTL, reinício do servidor e idempotência.
Versões: `ModelContextProtocol.AspNetCore` 2.4.0 e
`ModelContextProtocol.Extensions.Tasks` 2.4.0 (resolvidas com `dotnet list
package`), spec 2026-07-28, TFM `net10.0`, SDK 10.0.100. O pacote de tasks é estável
(sem aviso `MCPEXP` ao compilar; as notas da 2.0.0 listam "Stabilize official
Extensions, Tasks, and MRTR APIs"). Nenhum modelo é usado.

## Use Cases

- Uma tool que embrulha relatório, exportação, build ou job em lote que passa de um timeout HTTP normal.
- Uma tool que precisa pausar para uma aprovação humana no meio do trabalho.
- Um cliente que sobrevive ao próprio reinício retomando de um id de task guardado,
  e o que fazer com um cliente que não fala a extensão.

## Deep Dive

### O problema: uma resposta é um lugar ruim para 6 segundos

A tool `build_report` dorme 6 segundos e registra o início e o fim. Um cliente cujo
`HttpClient.Timeout` é de 3 segundos a chama de forma simples e depois como task:

```text
plain call, 3 s HTTP timeout: TaskCanceledException after 3026 ms
task call, same 3 s timeout: report T ready (run #6) after 6049 ms
```

O log do servidor mostra `run #5 started`, nunca `finished`, e uma
`TaskCanceledException`: quando o stream da resposta quebra, o trabalho para junto.
A spec diz isso: "A broken response stream loses the in-flight request; clients MUST
re-issue it as a new request with a new request ID", porque os ids de evento SSE e o
`Last-Event-ID` foram removidos. A chamada como task sobrevive ao mesmo timeout
porque nenhuma request isolada dura mais que alguns milissegundos. O básico de
cliente e servidor está no concept "MCP Servers and Clients with the C# SDK".

### Servidor: uma linha e um store

```csharp
// one store for the whole process: stateless HTTP builds a server per request
var store = new InMemoryMcpTaskStore { DefaultPollIntervalMs = 1000 };
builder.Services.AddMcpServer()
    .WithHttpTransport()
    .WithTools<LabTools>()
    .WithTasks(store);                       // package ModelContextProtocol.Extensions.Tasks
app.MapMcp("/mcp");

[McpServerTool(Name = "build_report"), Description("Builds a report. Takes 6 seconds.")]
public static async Task<string> BuildReport(string name, CancellationToken ct)
{
    await Task.Delay(TimeSpan.FromSeconds(6), ct);   // ct fires on tasks/cancel
    return $"report {name} ready";
}
```

`WithTasks` registra os handlers de `tasks/get`, `tasks/update` e `tasks/cancel`,
anuncia a extensão (o `server/discover` passa a listar
`"extensions":{"io.modelcontextprotocol/tasks":{}}`) e embrulha cada
`[McpServerTool]`: o corpo roda em segundo plano e a chamada devolve um handle. O
código da tool não muda. O store precisa ser compartilhado entre requests (singleton
ou armazenamento externo), senão um poll num servidor novo o encontra vazio.

### No fio: o handle e depois o polling

O cliente declara a extensão no `_meta` de cada request (abreviado aqui). O servidor
decide se responde com uma task; o cliente nunca pede uma.

```text
--> POST Mcp-Method=tools/call Mcp-Name=build_report
    {"method":"tools/call","params":{"name":"build_report","arguments":{"name":"Q3"},"_meta":{"io.modelcontextprotocol/clientCapabilities":{"extensions":{"io.modelcontextprotocol/tasks":{}}},...}},"id":2,...}
<-- 200 (after 15 ms)
    {"result":{"taskId":"ba0dbdbb574f46f9965f17a5dee762ff","status":"working","createdAt":"2026-11-19T00:11:09.53+00:00","lastUpdatedAt":"...","pollIntervalMs":1000,"resultType":"task",...},"id":2}
--> POST Mcp-Method=tasks/get Mcp-Name=ba0dbdbb574f46f9965f17a5dee762ff     (every 1000 ms)
<-- {"result":{"resultType":"complete","taskId":"a12a...","status":"working",...,"pollIntervalMs":1000},...}
<-- (6 s later) {"result":{"resultType":"complete","taskId":"a12a...","status":"completed","lastUpdatedAt":"...","result":{"content":[{"type":"text","text":"report Q3 ready (run #2)"}]}},...}
```

`resultType: "task"` avisa que isto é um handle, não um `CallToolResult`, e o
`Mcp-Name` leva o id da task em toda chamada de task, para um load balancer rotear
por task. O lado do cliente tem dois helpers:

```csharp
var raw = await client.CallToolAsTaskAsync(new() { Name = "build_report", Arguments = args });
if (raw.IsTask)                                       // ResultOrCreatedTask<CallToolResult>
    while (await client.GetTaskAsync(raw.TaskCreated!.TaskId) is WorkingTaskResult)
        await Task.Delay((int)(raw.TaskCreated.PollIntervalMs ?? 1000));
// or, to hide the lifecycle:
CallToolResult r = await client.CallToolWithPollingAsync(new() { Name = "build_report", Arguments = args });
```

`GetTaskResult` é uma hierarquia (`WorkingTaskResult`, `InputRequiredTaskResult`,
`CompletedTaskResult` com `Result`, `FailedTaskResult` com `Error`,
`CancelledTaskResult`). `CallToolWithPollingAsync` levou 6042 ms para o mesmo texto.

### Modos de execução e o cliente sem a extensão

Desde a 2.0.0-rc.2 o servidor escolhe um modo por chamada com `McpTasksOptions.ExecutionModeSelector`:

```csharp
.WithTasks(store, o => o.ExecutionModeSelector = ctx => ctx.Params?.Name switch
{
    "quick_lookup"   => McpTaskExecutionMode.Synchronous,   // never a task
    "nightly_export" => McpTaskExecutionMode.Required,      // only for clients with the extension
    _                => McpTaskExecutionMode.Optional,      // the default: task if the client opted in
});
```

| Chamada | Resultado medido |
| --- | --- |
| `CallToolAsync("build_report")` simples (Optional, sem extensão) | bloqueou 6023 ms, `CallToolResult` normal, `IsError` nulo |
| `CallToolAsync("nightly_export")` simples (Required, sem extensão) | HTTP 400, JSON-RPC `-32021` "requires the 'io.modelcontextprotocol/tasks' client extension capability", `data.requiredCapabilities` nomeia a extensão |
| `CallToolAsTaskAsync("quick_lookup")` (Synchronous, com extensão) | `IsTask=False`, `value-of-x` inline |
| `CallToolWithPollingAsync("nightly_export")` (Required, com extensão) | uma task, termina com `export done` |
| cliente fixado em `ProtocolVersion = "2025-11-25"` mais o helper | `IsTask=False`, bloqueou 6024 ms (o helper só envia o opt-in na 2026-07-28 ou superior) |
| `GetTaskAsync` nessa conexão 2025-11-25 | o cliente lança `InvalidOperationException`: exige 2026-07-28 ou superior |
| `GetTaskAsync("no-such-id")` | `McpProtocolException`: `Unknown task: 'no-such-id'` |

Ou seja, um cliente sem a extensão vê a tool bloquear em `Optional` (com o problema
de timeout acima) e um `-32021` claro em `Required`. Não executado: um `McpClientTool`
sob `UseFunctionInvocation()`; usa a chamada simples, então deve bloquear.

### Input no meio: tasks/update

Quando a tool chama `server.ElicitAsync` dentro de uma task, o SDK transforma isso
numa entrada de `inputRequests` em vez de uma request iniciada pelo servidor. A tool:

```csharp
[McpServerTool(Name = "deploy")]
public static async Task<string> Deploy(McpServer server, string service, CancellationToken ct)
{
    var ask = await server.ElicitAsync<Confirm>($"Deploy {service} to production?", cancellationToken: ct);
    return ask.IsAccepted && ask.Content!.Approve ? $"{service} deployed" : $"{service} NOT deployed ({ask.Action})";
}
```

Um poll manual vê a mudança, responde com `tasks/update` pela chave da request e
continua o polling (fio, abreviado):

```text
<-- tasks/get {"result":{"status":"input_required","inputRequests":{"808e235d74b140a89060319db0a5080a":{"method":"elicitation/create","params":{"mode":"form","message":"Deploy billing to production?","requestedSchema":{"type":"object","properties":{"approve":{"type":"boolean"}}}}}},...}}
--> tasks/update {"params":{"taskId":"4012f347...","inputResponses":{"808e235d74b140a89060319db0a5080a":{"action":"accept","content":{"approve":true}}}},...}
<-- {"result":{"resultType":"complete"},...}                      (empty acknowledgement)
<-- tasks/get {"result":{"status":"completed","result":{"content":[{"type":"text","text":"billing deployed"}]}}}
```

`CallToolWithPollingAsync` faz isso quando o cliente registrou
`McpClientOptions.Handlers.ElicitationHandler` (medido: `search deployed`). A chave é
única na vida da task e o cliente a deduplica entre polls. Pela documentação do SDK
(não executado), sampling funciona igual e `roots/list` ainda não é despachado. A
elicitation em si está no concept "MCP Multi Round-Trip Requests and Elicitation".

### Cancelamento é cooperativo

`tasks/cancel` devolve uma confirmação vazia e dispara o `CancellationToken` da tool.
Cancelando `build_report` depois de 1,5 s:

```text
after cancel +500 ms: cancelled        (same at +1000 and +1500 ms)
cancel on an already cancelled task: ack ok, state: cancelled
```

O log do servidor tem `run #7 started` e nenhum `finished`: o `Task.Delay(…, ct)` foi
interrompido. Uma tool que ignora o `ct` continua rodando (não executado), e a spec
permite um status final diferente de `cancelled`. Não use `notifications/cancelled`.

### Failed contra completed com isError

```text
explode:          completed result={"content":[{"type":"text","text":"An error occurred invoking 'explode'."}],"isError":true}
explode_protocol: failed error={"code":-32602,"message":"bad request detected late"}
  CallToolWithPollingAsync threw McpException: Task '...' failed: {"code":-32602,...}
```

Uma exceção comum vira task `completed` com `isError: true` (mesma regra de texto do
caminho síncrono; o `CallToolWithPollingAsync` a devolve normalmente). Só um erro
JSON-RPC (`McpProtocolException`) deixa a task `failed`, e aí o helper lança.

### TTL e reinício do servidor: o store em memória esquece

`InMemoryMcpTaskStore.DefaultTimeToLive` (nulo por padrão) aparece como `ttlMs` no
handle (`"ttlMs":5000`). O TTL conta a partir da criação, não da conclusão. Com TTL
de 5 s e polling uma vez por segundo:

```text
build_report (6 s):   +1.0s..+4.0s working,   +5.0s Unknown task   (the tool still ran to "finished")
nightly_export (2 s): +2.0s..+4.0s completed, +5.0s Unknown task
```

Sem TTL o store guarda toda task até o processo terminar, e um reinício perde todas
("not persisted across process restarts", segundo a documentação):

```text
started 70c364f934f74a268d809931434013df; process exits now      (client process 1)
resumed 70c364f9...: working                                      (a brand new client process, same server)
(server killed)    HttpRequestException: Connection refused (127.0.0.1:5940)
(server restarted) resumed 70c364f9...: McpProtocolException: Unknown task: '70c364f9...'
```

O handle sobrevive ao reinício do cliente (se ele guardou o id), mas não ao do
servidor. Em produção implemente `IMcpTaskStore` sobre banco ou cache
(`CreateTaskAsync` durável antes de retornar, transições terminais idempotentes,
`ResolveInputRequestsAsync` disparando `InputResponseReceived`; só documentação, sem
store próprio escrito aqui). O corpo de uma tool num processo morto se perde qualquer
que seja o store, então o trabalho precisa ser retomável ou seguro de repetir.

### Idempotência continua sendo problema seu

O handle torna o resultado durável, não a chamada única. Mesmos argumentos duas vezes:

```text
same arguments twice: ids differ = True, t1 ran as run #8, t2 as run #9
```

Dois ids, duas execuções. Um cliente que perdeu o `CreateTaskResult` (a única resposta
ainda numa request só) tenta de novo e começa um segundo job: ponha uma chave de
idempotência nos argumentos e deduplique na tool (veja o concept "Transactional
Outbox, Inbox and Idempotent Consumers").

### Livro contra hoje e o que o SDK ainda não faz

As Tasks experimentais da spec 2025-11-25 (SDK 1.3 e 1.4) tinham `tasks/list`, um
`tasks/result` bloqueante e um `taskSupport` por tool; tudo saiu, e peers v1 e v2 não
interoperam (cada um vê um resultado comum). Pela documentação do SDK,
`notifications/tasks` não está implementado na 2.4.0, então só há polling, e uma tool
não pode começar inline e virar task no meio. A spec diz que a extensão deve entrar
no protocolo núcleo quando estabilizar.

## Trade-offs

- **Polling contra conexão presa.** Polling custa uma request por intervalo e até um intervalo de latência, mas dispensa stream longo e atravessa proxies. `pollIntervalMs` é uma dica que o servidor pode impor com rate limit.
- **Optional contra Required.** `Optional` degrada para bloqueio nos clientes antigos e esconde o problema de timeout; `Required` falha rápido com `-32021`. Uma exportação de 20 minutos deve ser `Required`.
- **Store em memória contra o seu.** `InMemoryMcpTaskStore` serve para desenvolvimento e testes; o que o cliente espera de verdade precisa de store durável e política de limpeza.
- **TTL.** Curto demais e o resultado de um job lento é descartado antes de o cliente buscá-lo (o job de 6 s com TTL de 5 s); longo demais ou nulo e o store cresce.
- **O id da task como capability.** Sem `tasks/list` e sem sessões, o id é o único handle (os do SDK são 32 dígitos hex aleatórios); amarre-o ao chamador num store próprio.

## Documentation Links

- [Tasks extension overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/tasks/overview) (doc)
- [SEP-2663: Tasks Extension, modelcontextprotocol.io](https://modelcontextprotocol.io/seps/2663-tasks-extension) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Tasks guide in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/tasks/tasks.md) (doc)
- [MCP C# SDK 2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
