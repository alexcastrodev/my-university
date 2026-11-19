---
version: 1.0
updatedAt: 2026-11-19
title: "Multi Round-Trip Requests e Elicitation no MCP"
summary: InputRequiredResult, inputResponses e requestState da revisão 2026-07-28 medidos no SDK C# 2.4.0 com um handler roteirizado, o fio real, accept, decline e cancel, ElicitAsync contra InputRequiredException em stdio e nos três modos de sessão HTTP, requestState forjado e protegido com Data Protection, elicitation em modo URL, capabilities que o SDK não confere e a depreciação de Roots, Sampling e Logging.
---
## Objective

Desde o MCP 2026-07-28 o servidor não envia mais pedidos próprios
(`elicitation/create`, `sampling/createMessage`, `roots/list`) no meio de uma
chamada: ele responde com um `InputRequiredResult` intermediário, e o cliente
repete a requisição original com `inputResponses` e o `requestState` opaco. Esta
lição mede esse ciclo no SDK C# com um handler de cliente roteirizado e sem
modelo: o fio, decline e cancel, `await ElicitAsync`, todos os modos de sessão
HTTP, estado forjado, modo URL e a depreciação de Roots, Sampling e Logging.

Versions: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0
(2026-11-07), Data Protection do shared framework do ASP.NET Core 10.0.0,
TFM `net10.0`, SDK 10.0.100, spec MCP 2026-07-28.

## Use Cases

- Uma tool destrutiva que pede confirmação, ou uma escolha, ao usuário antes de agir.
- Coletar um argumento que faltou com o usuário em vez de deixar o modelo chutar.
- Mandar o usuário para uma página no navegador (OAuth de terceiro, pagamento) que o cliente não vê.
- Manter um fluxo de vários passos em HTTP stateless atrás de um load balancer comum.

## Deep Dive

### Uma tool que pergunta: InputRequiredException

A tool lança na primeira chamada e lê a resposta na repetição, sem guardar nada em memória:

```csharp
[McpServerTool(Name = "close_ticket"), Description("Closes a support ticket after the user confirms a reason.")]
public static string CloseTicket(McpServer server, RequestContext<CallToolRequestParams> ctx, int ticketId)
{
    var p = ctx.Params!;
    if (p.InputResponses?.TryGetValue("reason", out var resp) is true)          // the retry
    {
        ElicitResult? r = resp.Deserialize(InputResponse.ElicitResultJsonTypeInfo);
        if (r?.IsAccepted is not true) return $"ticket {ticketId} left open (action={r?.Action})";
        return $"closed ticket {ticketId}: {r.Content!["reason"].GetString()} (state {p.RequestState})";
    }
    if (!server.IsMrtrSupported) return "This tool needs input. Resend with a client that speaks 2026-07-28.";
    throw new InputRequiredException(new Dictionary<string, InputRequest>        // the first call
    {
        ["reason"] = InputRequest.ForElicitation(new ElicitRequestParams
        {
            Message = $"Close ticket {ticketId}? Give a reason.",
            RequestedSchema = new() { Required = ["reason"], Properties =
                { ["reason"] = new ElicitRequestParams.StringSchema { Description = "Why it is closed", Default = "completed" } } },
        }),
    }, requestState: $"ticket:{ticketId}");
}
```

O cliente registra um handler, e o `CallToolAsync` roda o ciclo inteiro sozinho:

```csharp
var options = new McpClientOptions();
options.Handlers.ElicitationHandler = (req, ct) =>
{
    Console.WriteLine($"[handler] mode={req!.Mode} message=\"{req.Message}\" url={req.Url ?? "-"}");
    return ValueTask.FromResult(new ElicitResult { Action = "accept",   // a real host renders a form here
        Content = new Dictionary<string, JsonElement> { ["reason"] = JsonSerializer.SerializeToElement("duplicate") } });
};
await using var client = await McpClient.CreateAsync(transport, options);
var r = await client.CallToolAsync("close_ticket", new Dictionary<string, object?> { ["ticketId"] = 42 });
```

```text
negotiated=2026-07-28 session=(none)
[handler] mode=form message="Close ticket 42? Give a reason." url=-
result IsError=null text="closed ticket 42: duplicate (state ticket:42)"
[server] close_ticket: protocol=2026-07-28 mrtr=True requestState=- inputResponses=-
[server] close_ticket: protocol=2026-07-28 mrtr=True requestState=ticket:42 inputResponses=reason
```

### No fio

Capturado no stdio com `tee` (`_meta` encurtado; ele levava `"clientCapabilities":
{"elicitation":{"form":{}}}`, declarado assim que um `ElicitationHandler` existe):

```text
--> {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42},"_meta":{...}},"id":2,"jsonrpc":"2.0"}
<-- {"result":{"inputRequests":{"reason":{"method":"elicitation/create","params":{"mode":"form","message":"Close ticket 42? Give a reason.","requestedSchema":{"type":"object","properties":{"reason":{"type":"string","description":"Why it is closed","default":"completed"}},"required":["reason"]}}}},"requestState":"ticket:42","resultType":"input_required","_meta":{...}},"id":2,"jsonrpc":"2.0"}
--> {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42},"_meta":{...},"inputResponses":{"reason":{"action":"accept","content":{"reason":"duplicate"}}},"requestState":"ticket:42"},"id":3,"jsonrpc":"2.0"}
<-- {"result":{"content":[{"type":"text","text":"closed ticket 42: duplicate (state ticket:42)"}],"resultType":"complete","_meta":{...}},"id":3,"jsonrpc":"2.0"}
```

Duas requisições independentes (ids 2 e 3), nenhuma mensagem do servidor para o
cliente. A spec só permite `InputRequiredResult` em `tools/call`, `prompts/get` e `resources/read`.

### Accept, decline, cancel e sem handler

| O handler devolve | A repetição leva | Resultado da tool |
| --- | --- | --- |
| `accept` + conteúdo | `{"action":"accept","content":{"reason":"duplicate"}}` | `closed ticket 42: duplicate` |
| `accept` sem conteúdo | `{"action":"accept","content":{"reason":"completed"}}` | o cliente preencheu o `default` do schema |
| `decline` | `{"action":"decline"}` | `ticket 42 left open (action=decline)` |
| `cancel` | `{"action":"cancel"}` | `ticket 42 left open (action=cancel)` |
| sem handler | não há repetição | `InvalidOperationException: Server sent an elicitation input request, but no ElicitationHandler is registered.` |

Decline (disse não) e cancel (fechou o diálogo) chegam como repetições normais: decida pelo `IsAccepted`.

### O estilo await: ElicitAsync

O estilo de antes de 2026, `await server.ElicitAsync(new ElicitRequestParams {
... }, ct)` no meio da tool, compila sem warning. No stdio com cliente
2026-07-28 o fio também foi MRTR: chave `input_1`, estado
`"c515db44e6f64dd1be292ad8c16c5fbd"`, um handle para o handler suspenso na
memória do servidor e retomado pela repetição. No código do SDK essas
continuações não expiram e só são canceladas no dispose do servidor (lido no
código, não medido). No HTTP stateless a tool devolveu `IsError=True`, com o log
`InvalidOperationException: Elicitation is not supported in stateless mode.`

### Todos os modos de sessão, medidos

As duas tools com o `accept` roteirizado, no stdio e em cada `SessionMode` do HTTP:

| Servidor | Cliente | `close_ticket` (InputRequiredException) | `close_ticket_await` (ElicitAsync) |
| --- | --- | --- | --- |
| stdio | padrão | MRTR no fio | MRTR, handler suspenso |
| stdio | fixado em 2025-11-25 | o SDK envia um `elicitation/create` legado e repete a tool | `elicitation/create` legado |
| `Stateless` | padrão | MRTR | `IsError`, não suportado em stateless |
| `Stateless` | fixado em 2025-11-25 | `IsMrtrSupported` falso, texto de fallback | `IsError`, mesma exceção |
| `Stateful` | padrão (rebaixa e ganha sessão) | pedido legado no stream SSE do POST | legado |
| `Stateful` | fixado em 2025-11-25 | legado | legado |
| `StatefulForInitializeClients` | padrão | MRTR | `IsError`, mesma exceção |
| `StatefulForInitializeClients` | fixado em 2025-11-25 | legado, com sessão | legado |

O caminho legado da linha `Stateful`, capturado com um `DelegatingHandler` (params encurtados):

```text
--> POST {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42}},"id":3,"jsonrpc":"2.0"} Mcp-Session-Id=6UwPPSXnxt2ZAt1c0DtQuA
<-- sse {"method":"elicitation/create","params":{"mode":"form","message":"Close ticket 42? Give a reason.",...},"id":1,"jsonrpc":"2.0"}
--> POST {"result":{"action":"accept","content":{"reason":"duplicate"}},"id":1,"jsonrpc":"2.0"} Mcp-Session-Id=6UwPPSXnxt2ZAt1c0DtQuA
<-- sse {"result":{"content":[{"type":"text","text":"closed ticket 42: duplicate (state ticket:42)"}]},"id":3,"jsonrpc":"2.0"}
```

A tool ainda viu `requestState=ticket:42`: o SDK traduziu a exceção para o
pedido antigo e repetiu o handler (até 10 rodadas, segundo a doc). Então a frase
do pré-requisito, "stateless mode disables sampling and elicitation requests",
só vale para os métodos diretos (`ElicitAsync`, `SampleAsync`,
`RequestRootsAsync`). Com cliente 2026-07-28, elicitation funciona em HTTP
stateless via `InputRequiredException`, com `ClientCapabilities` preenchido por
requisição; só um cliente 2025-11-25 num servidor stateless fica sem nenhuma.

### requestState é entrada do atacante

Um POST cru com `curl` no servidor stateless, com `inputResponses` já na primeira chamada e sem `requestState`:

```text
{"result":{"content":[{"type":"text","text":"closed ticket 42: forged (state )"}],"resultType":"complete",...},"id":1,"jsonrpc":"2.0"}
```

O ticket fechou sem ninguém ser consultado, e os exemplos de MRTR da doc do SDK
também leem `InputResponses` sem verificar estado nenhum. A spec diz que o
servidor MUST tratar `requestState` como controlado pelo atacante, proteger a
integridade (HMAC ou AEAD) quando ele decide algo, e SHOULD amarrá-lo ao
principal, a um TTL curto e à requisição de origem. O Data Protection do ASP.NET Core resolve:

```csharp
// services.AddDataProtection(); then inject IDataProtectionProvider dp into the tool
var protector = dp.CreateProtector("mrtr.close_ticket").ToTimeLimitedDataProtector();
string expected = $"close_ticket|{ticketId}";           // add the authenticated user id when there is one
string? state = null;
try { if (p.RequestState is { } rs) state = protector.Unprotect(rs); }
catch (CryptographicException) { }                       // tampered or expired: ask again
if (state == expected && p.InputResponses?.TryGetValue("reason", out var resp) is true) { /* as before */ }
throw new InputRequiredException(inputRequests, requestState: protector.Protect(expected, TimeSpan.FromMinutes(5)));
```

Contra esse `close_ticket_safe`, a primeira chamada forjada, um estado válido do
ticket 42 enviado para o ticket 7 e um estado com um caractere trocado (logado
como `requestState rejected`) receberam um novo `InputRequiredResult`; o fluxo
real devolveu `closed ticket 42: duplicate`. O estado tinha 155 caracteres
(`CfDJ8...`). Toda instância atrás do load balancer precisa do mesmo key ring
(`PersistKeysTo...`), senão a repetição falha em outra (só documentação). Ação
de uso único ainda precisa de checagem no servidor.

### Modo URL

Para dado que o cliente não pode ver (uma API key, um pagamento, o consentimento
de um OAuth de terceiro) o servidor manda `Mode = "url"`, uma `Message` e uma
`Url` no lugar do schema, aqui com `requestState: "flow:7f3a"`:

```text
[handler] mode=url message="Sign in to your calendar provider." url=https://mcp.example.com/connect/calendar?flow=7f3a
result IsError=null text="browser flow opened; call again once you finish"
```

A repetição levou só `{"action":"accept"}`: consentimento para abrir a página,
não fluxo concluído, então a próxima chamada consulta o próprio token store do
servidor. O cliente MUST mostrar a URL inteira, pedir antes de abrir e nunca
fazer prefetch; o modo formulário MUST NOT coletar segredos. Não é assim que o
cliente se autoriza no servidor MCP (veja o concept de autorização). Livro vs
hoje: a 2026-07-28 removeu o campo `elicitationId` e a
`notifications/elicitation/complete`, e deixa o erro `-32042` "URL elicitation
required" só para a 2025-11-25, enquanto o SDK 2.4.0 ainda traz `ElicitationId`
e `UrlElicitationRequiredException` para pares antigos, e a página de
elicitation dele ainda ensina os dois.

### Capabilities que o SDK não confere por você

Sem handler o cliente mandou `"clientCapabilities":{}`, e mesmo assim a exceção
saiu com um `elicitation/create` dentro; um cliente que declarou só `form`
recebeu o pedido em modo URL. A spec diz que o servidor MUST NOT. O `ElicitAsync`
confere (`Client does not support elicitation requests.`), o caminho da exceção
não. Confira na tool e use o erro da 2026-07-28:

```csharp
if (server.ClientCapabilities?.Elicitation is null)
    throw new MissingRequiredClientCapabilityException(
        new() { Elicitation = new() { Form = new() } }, "close_ticket needs form elicitation");
```

```text
<-- {"error":{"code":-32021,"message":"close_ticket needs form elicitation","data":{"requiredCapabilities":{"elicitation":{"form":{}}}}},"id":2,"jsonrpc":"2.0"}
```

No stdio o cliente lançou `MissingRequiredClientCapabilityException`; no HTTP a
resposta foi `400` e ele lançou um `HttpRequestException` comum.

### Roots, Sampling e Logging estão depreciados

A SEP-2577 deprecia os três (com pelo menos doze meses até a remoção), e o SDK
2.0.0 os marcou com `[Obsolete]`: `SampleAsync`, `RequestRootsAsync`,
`SamplingHandler`, `RootsHandler`, `ClientCapabilities.Sampling`/`Roots`,
`CreateMessageRequestParams` e `InputRequest.ForRootsList` deram `MCP9005` cada
(`The Roots feature is deprecated as of specification version 2026-07-28...`);
elicitation não deu nenhum. Migrações: diretórios ou arquivos como parâmetros de
tool, URIs de resource ou configuração do servidor no lugar de Roots; o provedor
de LLM chamado pelo servidor (um `IChatClient`) no lugar de Sampling; stderr ou
OpenTelemetry no lugar de Logging.

## Trade-offs

- **InputRequiredException vs ElicitAsync.** A exceção funciona em todo lugar,
  mas a tool vira uma máquina de estados reentrada a cada rodada. O `ElicitAsync`
  se lê de cima a baixo, porém falha no HTTP stateless e prende o handler a um processo.
- **Estado no requestState vs no servidor.** Estado codificado dispensa store e
  sobrevive a qualquer instância, mas fica na mão do cliente: assine, expire, amarre.
- **Perguntar vs receber argumento.** Cada pergunta custa uma ida e volta e um host
  com UI; aceite também o valor como argumento da tool para scripts pularem o prompt.
- **Formulário vs modo URL.** Dado de formulário passa pelo cliente; segredo vai
  pelo modo URL, que deixa com o servidor o fluxo no navegador e o vínculo com o usuário.

## Documentation Links

- [Multi Round-Trip Requests, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) (doc)
- [Elicitation, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Deprecated features, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/deprecated) (doc)
- [Multi Round-Trip Requests (MRTR), MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/mrtr/mrtr.md) (doc)
- [Elicitation, MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/elicitation/elicitation.md) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [Limit the lifetime of protected payloads, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/limited-lifetime-payloads) (doc)
