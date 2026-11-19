---
version: 1.0
updatedAt: 2026-11-19
title: "Progresso, Cancelamento e Semântica de Retry no MCP"
summary: O que acontece com uma chamada de tool do MCP quando algo falha no caminho, medido no SDK C# 2.4.0 e na spec 2026-07-28 com um proxy TCP que derruba conexões, progresso que flui no stream da própria resposta, cancelamento por fechar o stream (e por notifications/cancelled no stdio), a request perdida sem Last-Event-ID, um reserve executado em dobro, a chave de idempotência como correção, timeouts em camadas e o que um handler de retry pode repetir.
---
## Objective

Uma chamada de tool é uma request que pode falhar no meio, e a spec 2026-07-28 deixou de disfarçar isso: as notificações de
progresso viajam no stream da resposta da própria request, fechar esse stream é o cancelamento, e um stream quebrado perde a
request de vez (sem `Last-Event-ID`, sem replay). O cliente tem de reemiti-la com um novo id, então a mesma tool pode rodar
duas vezes. Esta lição mede isso num servidor Streamable HTTP real, com um proxy TCP que derruba conexões sob demanda:
progresso, cancelamento, o stream quebrado, um `reserve` em dobro, a correção com chave de idempotência, timeouts em camadas
e o que um handler de retry pode repetir. Nenhum modelo. Versões: `ModelContextProtocol.AspNetCore` 2.4.0 (HTTP stateless,
stdio em um caso), `Microsoft.Extensions.Http.Resilience` 10.11.0, spec 2026-07-28, TFM `net10.0`, SDK 10.0.100. A
configuração básica está em "Servidores e Clientes MCP com o SDK C#".

## Use Cases

- Mostrar progresso real de uma tool que leva segundos e pará-la quando o usuário desiste.
- Escrever tools que alteram estado (reservar, cobrar, enviar) para que um retry do cliente seja inofensivo, ou pôr `AddStandardResilienceHandler` no `HttpClient` de um cliente MCP sem duplicar efeitos colaterais.

## Deep Dive

### Progresso: um token na ida, notificações na mesma resposta

Uma tool declara um parâmetro `IProgress<ProgressNotificationValue>` (o SDK o injeta, ele não entra no JSON schema) e vai
reportando:

```csharp
[McpServerTool(Name = "crunch")]
public static async Task<string> Crunch(IProgress<ProgressNotificationValue> progress, CancellationToken ct)
{
    for (int i = 1; i <= 5; i++)
    {
        await Task.Delay(400, ct);
        progress.Report(new() { Progress = i, Total = 5, Message = $"step {i} of 5" });
    }
    return "crunched";
}
// cliente: passar um IProgress faz o SDK acrescentar um progressToken em _meta
await client.CallToolAsync("crunch", null, new Progress<ProgressNotificationValue>(v => Console.WriteLine($"{v.Progress}/{v.Total}")));
```

Um proxy TCP entre cliente e servidor registra os dois sentidos:

```text
--> [    0 ms] tools/call id=2 "progressToken":"8c47006cdc8a447096da99d46ffac860"
<-- [  415 ms] HTTP/1.1 200 OK Content-Type: text/event-stream
<-- [  415 ms] {"method":"notifications/progress","params":{"progressToken":"8c47...","progress":1,"total":5,...}}
... (steps 2 to 5, 400 ms apart, each also reaching the client's IProgress) ...
<-- [ 2034 ms] {"result":{"content":[{"type":"text","text":"crunched"}],"resultType":"complete",...},"id":2,"jsonrpc":"2.0"}
```

As notificações são eventos da resposta SSE àquele único POST: sem segunda conexão e sem `subscriptions/listen`, como diz o
changelog ("request-scoped notifications such as `notifications/progress` continue to flow on the response stream of the
request they relate to"). Sem `IProgress` não há `progressToken` e o servidor não envia nada. Progresso é opcional (`MAY`)
dos dois lados; a spec permite ao cliente zerar o timeout a cada progresso, mas diz que ele SHOULD manter um máximo.

### Cancelamento: fechar o stream é o sinal

No cliente é o `CancellationToken` de sempre. Cancelando `crunch` após 1 s:

```text
    [server  1004 ms] crunch: token fired, stopped
TaskCanceledException: The operation was canceled.  (after 1006 ms)
```

Nada mais passou pelo fio: nenhum `notifications/cancelled`, só a conexão fechada. Essa é a regra da 2026-07-28 para
Streamable HTTP ("closing the response stream MUST be treated by the server as cancellation", "No `notifications/cancelled`
message is required or expected"). O servidor enxerga isso como o `CancellationToken` da tool (em modo stateless,
`HttpContext.RequestAborted`). A doc do SDK diz que o token do cliente "envia um `notifications/cancelled`", o que vale no
stdio, onde não existe stream por request. Medido no stdio com `tee` no pipe, o cliente enviou
`{"method":"notifications/cancelled","params":{"requestId":2},"jsonrpc":"2.0"}` e o token do servidor disparou em 1156 ms.

O cancelamento é cooperativo. `ignores_token` dorme 3 s sem olhar para o `ct`:

```text
TaskCanceledException: The operation was canceled.  (after 1001 ms)
    [server  7531 ms] ignores_token finished (token fired meanwhile: True)
```

O trabalho foi até o fim e o resultado foi descartado. Uma tool que não pode sobreviver ao seu chamador passa o `ct` para
toda chamada assíncrona.

### O stream quebrado perde a request

O proxy corta a conexão N ms depois que um `tools/call` passa por ele, com a resposta passando até ali ou engolida. A tool é
`reserve`: não idempotente, espera 2 s pelo "armazém" e depois comita `Reserved += quantity`. Depois de cada caso o cliente
chama de novo (o SDK atribui um novo id de request e nunca faz retry sozinho):

```text
== A: cut at 1 s ==
    [server   999 ms] reserve: token fired before the commit, nothing written
HttpRequestException: An error occurred while sending the request. <- IOException: ... Connection reset by peer
after A + retry  [started=2 committed total=10]

== B: server finishes at 2 s, proxy swallows the answer and cuts at 2.5 s ==
    [server  7511 ms] reserve COMMITTED, total reserved now 10
HttpRequestException: An error occurred while sending the request. ...  (after 2502 ms)
after B + retry  [started=2 committed total=20]
```

A é a metade benigna: a desconexão cancelou a tool antes do commit, então o retry a executou uma vez. B é a perigosa: o
trabalho terminou e só a resposta morreu. O cliente vê a mesma exceção nos dois e não consegue distingui-los, então retentar
é um palpite, e aqui reservou 20 unidades para um pedido de 10. Uma terceira forma, com o stream já aberto (progresso
fluindo) e cortado em 1 s, levanta outra exceção (depois de dois eventos de progresso):

```text
McpException: Streamable HTTP POST response completed without a reply to request with ID: 10  (after 1006 ms)
```

Uma camada de retry precisa tratar `HttpRequestException` (corte antes dos headers) e `McpException` (corte no meio do
stream) como "resultado desconhecido". Material mais antigo (spec 2025-11-25, docs do SDK 1.x) descreve streams SSE
retomáveis, então "o SDK retoma o stream para você" não vale mais para servidores atuais: o cliente do SDK ainda tem um
caminho de retomada com `Last-Event-ID`, mas ele só dispara quando o servidor enviou ids de evento, e um POST cru ao servidor
2026-07-28 mostrou frames SSE só com linhas `event: message` e `data:`, sem `id:`. (O SDK também registra uma pilha de
`TaskCanceledException` em Warning toda vez que uma tool cancelada se desfaz: ruído para filtrar, não um incidente.)

### Pelo menos uma vez, e a correção

Um cliente que retenta depois de "resultado desconhecido" dá à chamada semântica at-least-once; um que nunca retenta dá
at-most-once; exactly-once não é algo que o transporte ofereça, só retry mais um servidor que deduplica (o concept
"At-Least-Once, At-Most-Once, and Exactly-Once Semantics", em Distributed Systems I, cobre os três contratos e por que uma
resposta perdida é ambígua). A correção no formato do MCP é uma chave escolhida pelo chamador e passada como argumento comum
da tool, já que a spec não tem sessão nem campo de idempotência no nível da request:

```csharp
[McpServerTool(Name = "reserve_idem")]
public static async Task<string> ReserveIdem(string sku, int quantity, string idempotencyKey)
{
    // um Lazy por chave: o primeiro chamador executa o trabalho, todo retry aguarda a mesma Task
    var lazy = Ledger.ByKey.GetOrAdd(idempotencyKey, _ => new Lazy<Task<string>>(() => Run(sku, quantity)));
    return await lazy.Value;
}   // Run() faz Task.Delay(2000) SEM o token da request e comita uma vez
```

```text
== C: case B again, same key on both attempts ==
    [server 12025 ms] reserve_idem COMMITTED, total reserved now 10
    [server 12524 ms] reserve_idem called, key order-77-line-1     (retry answered in 1 ms)
after C + retry  [started=1 committed total=10]

== D: cut at 1 s with the work in flight, retry at once with the same key ==
    [server 13530 ms] reserve_idem called, key order-78-line-1     (the retry joins the running work)
after D + retry  [started=1 committed total=10]
```

O retry recebeu o resultado guardado em 1 ms (C) ou entrou no trabalho em andamento (D). O trabalho propositalmente não está
preso ao token da request, senão a desconexão o cancelaria e D degeneraria em A. A chave vem do chamador (um hash de pedido e
linha, ou um GUID guardado junto da operação pendente); o servidor guarda chave e resultado de forma durável (um índice
único, veja "Transactional Outbox, Inbox and Idempotent Consumers"; o dicionário aqui vive em um processo só) e rejeita chave
reaproveitada com argumentos diferentes. A alternativa é um handle durável: com a extensão Tasks uma resposta perdida custa
um poll (veja "Extensão Tasks do MCP para Tools de Longa Duração"), mas a chamada que cria a task ainda pode se perder e se
repetir (aquela lição mediu duas execuções para os mesmos argumentos), então a chave continua necessária. O lado REST está em
"REST Semantics: Status Codes and Idempotency".

### Timeouts em camadas, e quem vence

`McpClientOptions` tem duas propriedades de timeout, `InitializationTimeout` (60 s) e `DiscoverProbeTimeout`, e as duas só
governam a conexão. O SDK não tem timeout por chamada; a chamada é limitada pelas camadas ao redor. Medido com uma tool de 4
s:

```text
1: HttpClient.Timeout 1.5 s      -> TaskCanceledException "...configured HttpClient.Timeout ... elapsing" (1513 ms); server token fired at 1495 ms
2: CancellationToken after 1 s   -> TaskCanceledException "The operation was canceled." (1002 ms); server token fired
3: tool's own 500 ms deadline    -> IsError result "An error occurred invoking 'sleep_with_own_deadline': the backend did not answer within 500 ms" (525 ms)
4: token at 3 s and own deadline -> the same tool result (505 ms)
```

A camada mais curta vence, e o que o chamador vê muda: as camadas do cliente lançam exceção e abortam o trabalho pela
desconexão, enquanto um deadline do servidor é um resultado `IsError` normal que o modelo consegue ler, o único dos três que
diz o que aconteceu. Mantenha o deadline da própria tool abaixo do timeout do `HttpClient` do cliente, e este abaixo de
qualquer timeout de ociosidade de proxy (um gateway que derruba streams ociosos se parece com o caso B).

### Retry no cliente: o que pode ser repetido

O SDK nunca retenta uma chamada (A e B iniciaram a tool uma vez cada), então retry é o que você acrescenta. Um handler feito
à mão que repete em qualquer falha de transporte, com a primeira resposta engolida:

```text
[server 2002 ms] reserve COMMITTED, total reserved now 10  ... proxy swallows the response
[server 4506 ms] reserve COMMITTED, total reserved now 20
    tools/call id=2 attempt 1: HttpRequestException, retrying with the same body and id
    tools/call id=2 attempt 2: HTTP 200
```

E `AddStandardResilienceHandler` no `HttpClient` do cliente (timeout de 1 s por tentativa, 2 retries) contra uma tool de 2 s:

```text
reserve (honors ct):    3 starts, each cancelled at 1 s, committed 0, TimeoutRejectedException after 3213 ms
reserve_sloppy (no ct): 3 starts, 3 commits, committed 30, TimeoutRejectedException after 3232 ms
```

A estratégia padrão repete POST, e toda chamada MCP é um POST, então o handler não distingue `read_stock` de `reserve`.
`Retry.DisableForUnsafeHttpMethods()` desliga o retry para todo o MCP (medido: 1 início, e a tool sem `ct` ainda comitou uma
vez). Os padrões do handler standard (10 s por tentativa, 30 s no total) também matam em silêncio uma tool legítima de 20 s,
e ele só enxerga falhas antes de os headers da resposta chegarem: o corte no meio do stream passou pelo mesmo handler cego
como `attempt 1: HTTP 200`, não foi retentado, e o cliente ainda recebeu a `McpException`. O que funcionou: um handler que
retenta só as tools da sua própria lista de permissão, usando o header `Mcp-Name`:

```text
read_stock: cut, retried, HTTP 200 on attempt 2
reserve:    attempt 1: HttpRequestException, NOT retried (reserve is not on the allow-list)
after both  [started=1 committed total=10]
```

As annotations não são essa lista: o cliente viu `idempotentHint` `True` em `read_stock`, `False` em `reserve` e `null` nas
tools que não definiram, e a spec diz que clientes "MUST consider tool annotations to be untrusted unless they come from
trusted servers". Monte a lista com tools das quais você ou um fornecedor em quem você confia se responsabilizam. Um retry
que reaproveita o corpo repete o mesmo id JSON-RPC (id=2 acima); a spec pede um id novo depois de um stream quebrado, o que
uma nova chamada normal pelo SDK faz.

### A tabela completa

| Falha | O que o cliente vê | O que o servidor fez | Defesa |
| --- | --- | --- | --- |
| Token cancelado (o stdio também envia `notifications/cancelled`) | `TaskCanceledException` | `ct` dispara; para se o respeitar | passar `ct`; comitar por último |
| Tool ignora o `ct` | já desistiu | roda até o fim, resultado descartado | respeitar `ct`; commit idempotente |
| Corte antes dos headers | `HttpRequestException` | cancelou (A) ou terminou (B) | chave, depois retry |
| Corte no meio do stream | `McpException` "completed without a reply" | cancelou ou terminou | chave, depois retry; capturar as duas |
| `HttpClient.Timeout` | `TaskCanceledException` (texto de timeout) | `ct` dispara | deadline da tool abaixo dele |
| Deadline da própria tool | resultado `IsError` com a sua mensagem | parou | erro legível para o modelo |
| Retry cego em POST | talvez sucesso | rodou duas vezes | lista de tools permitidas mais chaves |

## Trade-offs

- **Chave vs handle de task.** A chave são poucas linhas e funciona em qualquer servidor, mas você guarda os resultados e escreve a deduplicação. Uma task guarda o resultado por você, mas exige a extensão nos dois lados, e a chamada que a cria ainda precisa de chave.
- **Trabalho preso ao token da request ou não.** Preso: um chamador que desligou libera recursos, ao custo de perdas no estilo do caso B depois de um commit. Solto: retries podem entrar no trabalho (D), mas o trabalho abandonado continua rodando e precisa de timeout próprio.
- **O modelo também pode retentar.** Um modelo que vê um erro pode chamar `reserve` de novo; a deduplicação no servidor cobre o handler e o modelo igualmente.
- **Política global de resiliência vs por tool.** Um único `AddStandardResilienceHandler` é fácil e errado para tools que alteram estado (3 commits acima); uma lista de permissão dá mais código e é o único formato seguro.

## Documentation Links

- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Progress, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/progress) (doc)
- [Cancellation, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/cancellation) (doc)
- [Streamable HTTP transport, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (doc)
- [Tools and annotations, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (doc)
- [Progress guide in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/progress/progress.md) (doc)
- [Cancellation guide in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/cancellation/cancellation.md) (doc)
- [Build resilient HTTP apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/resilience/http-resilience) (doc)
- [The Idempotency-Key HTTP Header Field, IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) (doc)

