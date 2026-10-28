---
version: 1.0
updatedAt: 2026-10-28
title: "SignalR, WebSockets e Server-Sent Events"
summary: Comunicação em tempo real no ASP.NET Core 10 medida de verdade: WebSockets crus com AllowedOrigins e fechamento, SSE com TypedResults.ServerSentEvents e SseParser, hubs SignalR tipados com grupos, usuários e streaming, negociação e transportes, timeouts e limite de 32 KB, reconexão automática, token na query string e o que acontece com duas instâncias sem backplane.
---
## Objective

HTTP comum é requisição e resposta: o servidor não fala até o cliente perguntar. Dashboards, chat, notificações, barras de progresso e cotações ao vivo precisam do contrário, e o ASP.NET Core 10 oferece três formas de empurrar dados. WebSockets crus (`UseWebSockets`) dão um socket full-duplex e deixam protocolo, reconexão e fan-out com você. Server-Sent Events, que o .NET 10 agora serve com `TypedResults.ServerSentEvents` e lê com `System.Net.ServerSentEvents.SseParser`, são um fluxo de texto de mão única sobre uma resposta HTTP normal. O SignalR adiciona hubs, RPC nas duas direções, grupos, usuários, streaming, fallback automático de transporte e reconexão por cima desses transportes. Esta lição roda um endpoint de eco WebSocket, um feed de preços SSE e um hub SignalR com cliente .NET, mostra o JSON real do negotiate, headers, frames, timeouts e mensagens de erro, mede os atrasos de reconexão e o limite de mensagem de 32 KB, e sobe duas instâncias do mesmo app para mostrar o que a falta de um backplane faz com um broadcast. Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (`System.Net.ServerSentEvents` embutido no `Microsoft.NETCore.App` 10.0.0), `Microsoft.AspNetCore.SignalR.Client` 10.0.14, `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.14, `Microsoft.Extensions.Logging.Console` 10.0.14.

## Use Cases

- Enviar status de pedido, progresso de job ou notificações ao navegador no momento em que mudam, em vez de fazer polling a cada poucos segundos.
- Transmitir um feed (preços, logs, tokens de LLM, leituras de sensor) em que só o servidor fala, usando SSE sobre um GET simples.
- Chat, colaboração e recursos multiplayer em que cliente e servidor enviam, agrupados por sala, tenant ou usuário.
- Chamar clientes conectados de fora de um hub: um job em background, um webhook ou um endpoint POST que avisa "todo mundo do grupo X" que algo aconteceu.

## Deep Dive

### WebSockets crus: aceitar, ecoar, fechar

O middleware faz parte do shared framework. Imprimi os padrões de `new WebSocketOptions()` e depois configurei:

```csharp
var ws = new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) };
ws.AllowedOrigins.Add("https://app.example.com");
app.UseWebSockets(ws);
app.Map("/ws", async ctx =>
{
    using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
    var buf = new byte[4096];
    while (true)
    {
        var r = await socket.ReceiveAsync(buf, ctx.RequestAborted);
        if (r.MessageType == WebSocketMessageType.Close)
        { await socket.CloseOutputAsync(r.CloseStatus!.Value, r.CloseStatusDescription, default); break; }
        await socket.SendAsync(buf.AsMemory(0, r.Count), r.MessageType, r.EndOfMessage, ctx.RequestAborted);
    }
});
```

Um cliente console com `ClientWebSocket` conectou três vezes (sem `Origin`, com a origem permitida, com uma estranha), enviou `ping 1` e fechou com `CloseAsync(NormalClosure, "bye")`:

```text
WebSocketOptions: KeepAliveInterval=00:02:00 KeepAliveTimeout=-00:00:00.0010000 AllowedOrigins.Count=0
Origin=(none): connected, state=Open
echo: ping 1 (Text, end=True)
[server] ws close received: status=NormalClosure desc=bye state=CloseReceived; handler returning, state=Closed
client after close: state=Closed status=NormalClosure desc=bye
Origin=https://app.example.com: connected, state=Open
Origin=https://evil.example.com: WebSocketException: The server returned status code '403' when status code '101' was expected.
Request finished HTTP/1.1 GET http://localhost:5711/ws - 101 - - 17.3692ms
```

Padrões: um frame de ping a cada 2 minutos, nenhum timeout de pong (`-1 ms` é `Timeout.InfiniteTimeSpan`), todas as origens permitidas. O fechamento do cliente chega como uma mensagem `Close` do `ReceiveAsync`; o servidor precisa responder, e só então o handler retorna e a requisição termina com status 101. `AllowedOrigins` rejeitou a origem estranha com 403, mas deixou passar a requisição sem header `Origin`, que é o que clientes fora do navegador enviam. A documentação explica por que isso importa: navegadores não aplicam CORS a WebSockets, então essa lista é a sua única checagem de origem, e o `Origin` pode ser forjado fora de um navegador.

A requisição é a conexão, então o pipeline precisa continuar vivo enquanto o socket vive. Escrevi um endpoint que aceita o socket, dispara um `Task.Run` para enviar `late` 200 ms depois e retorna:

```text
[server] late send: System.Net.WebSockets.WebSocketException: The remote party closed the WebSocket connection without completing the close handshake.
ws-bad client: WebSocketException: The remote party closed the WebSocket connection without completing the close handshake.
```

Retornar do handler encerrou a requisição e derrubou o socket. A documentação mostra a correção para quem escreve em background: passe um `TaskCompletionSource` ao worker e faça `await` da sua `Task` no endpoint até o worker terminar.

### Server-Sent Events no .NET 10

`TypedResults.ServerSentEvents` recebe um `IAsyncEnumerable<T>` ou `IAsyncEnumerable<SseItem<T>>`; o `SseItem<T>` carrega o tipo do evento, o id e a dica de retry:

```csharp
app.MapGet("/sse", (HttpContext ctx, CancellationToken ct) =>
{
    var last = ctx.Request.Headers["Last-Event-ID"].ToString();
    var start = int.TryParse(last, out var n) ? n + 1 : 1;
    return TypedResults.ServerSentEvents(Prices(start, ct));
});
static async IAsyncEnumerable<SseItem<Price>> Prices(int start, [EnumeratorCancellation] CancellationToken ct)
{
    for (var i = start; i < start + 3; i++)
    {   await Task.Delay(300, ct);
        yield return new SseItem<Price>(new Price("MSFT", 400 + i), "price") { EventId = i.ToString(), ReconnectionInterval = TimeSpan.FromSeconds(5) }; }
}
```

`curl -s -N -i http://localhost:5711/sse` (as linhas terminam em `\r\n` nos headers e em `\n` nos eventos):

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache,no-store
Content-Encoding: identity
Pragma: no-cache
Transfer-Encoding: chunked

event: price
data: {"symbol":"MSFT","value":401}
id: 1
retry: 5000
```

Objetos são serializados como JSON em camelCase e `retry` vem em milissegundos. Um `IAsyncEnumerable<string>` simples com `eventType: "word"` gerou `data: hello`, e um valor com quebra de linha virou duas linhas `data:` (`data: two` / `data: lines`), que é como o SSE codifica texto multilinha. O resultado também define `Content-Encoding: identity`; não testei como isso interage com compressão de resposta.

Para ler do .NET, o `SseParser` está no runtime (`System.Net.ServerSentEvents.dll` vem no `Microsoft.NETCore.App` 10.0.0, sem pacote):

```csharp
using var stream = await http.GetStreamAsync($"{A}/sse");
await foreach (var item in SseParser.Create(stream, (type, bytes) => JsonSerializer.Deserialize<Price>(bytes, JsonSerializerOptions.Web)!).EnumerateAsync())
    Console.WriteLine($"type={item.EventType} id={item.EventId} retry={item.ReconnectionInterval} data={item.Data}");
```

```text
type=price id=1 retry=00:00:05 data=Price { Symbol = MSFT, Value = 401 }   (then id=2)
type=price id=3 retry=00:00:05 data=Price { Symbol = MSFT, Value = 403 }
[server] /sse Last-Event-ID=''      then, on my second request:  [server] /sse Last-Event-ID='3'
resumed: id=4 data={"symbol":"MSFT","value":404}
```

Nenhum dos lados cuida da retomada por você. O `SseParser` só faz o parsing: quando o stream terminou, ele não reconectou nem enviou `Last-Event-ID`; eu mesmo mandei o header numa segunda requisição. O `TypedResults.ServerSentEvents` também ignora o header; o meu handler o leu e continuou a partir do id 4. O `EventSource` dos navegadores reconecta sozinho e envia `Last-Event-ID` (segundo a MDN); o servidor ainda precisa guardar histórico suficiente para reenviar a partir desse id. SSE é texto do servidor para o cliente numa única resposta HTTP: o que o cliente tiver a dizer vai em outra requisição.

### SignalR: um hub fortemente tipado

```csharp
public interface IChatClient { Task Receive(string from, string text); }
public class ChatHub : Hub<IChatClient>
{
    public Task SendAll(string text) => Clients.All.Receive(Context.UserIdentifier ?? Context.ConnectionId, text);
    public Task SendOthers(string text) => Clients.Others.Receive(Context.UserIdentifier!, text);
    public Task SendCaller(string text) => Clients.Caller.Receive("hub", text);
    public Task SendUser(string user, string text) => Clients.User(user).Receive(Context.UserIdentifier!, text);
    public Task Join(string group) => Groups.AddToGroupAsync(Context.ConnectionId, group);
    public Task SendGroup(string group, string text) => Clients.Group(group).Receive(Context.UserIdentifier!, text);
    public async IAsyncEnumerable<int> Counter(int count, int delayMs, [EnumeratorCancellation] CancellationToken ct)
    { for (var i = 1; i <= count; i++) { await Task.Delay(delayMs, ct); yield return i; } }
}
builder.Services.AddSignalR();   app.MapHub<ChatHub>("/hub");
```

`Hub<IChatClient>` transforma `Clients.All.Receive(...)` numa chamada checada pelo compilador, em vez de `SendAsync("Receive", ...)`. Três clientes .NET (`HubConnectionBuilder().WithUrl(...).Build()`, `On<string, string>("Receive", ...)`), alice, bob e carol, com bob e carol no grupo `ops`, e alice chamando cada método:

```text
SendAll: alice got [all] from alice; bob got [all] from alice; carol got [all] from alice
SendOthers: bob got [others] from alice; carol got [others] from alice
SendCaller: alice got [caller] from hub
SendUser(bob): bob got [dm] from alice
SendGroup(ops): bob got [grp] from alice; carol got [grp] from alice
unknown method: HubException: Failed to invoke 'NoSuchMethod' due to an error on the server. HubException: Method does not exist.
stream Counter: 1 at about 208 ms, 2 at about 408 ms, 3 at about 609 ms; stream Ticks: tick 1, tick 2, tick 3
```

`Context.ConnectionId` é por conexão; `Context.UserIdentifier` vem do `IUserIdProvider`, que por padrão lê `ClaimTypes.NameIdentifier` (segundo a documentação). Nesta demo registrei um provider que confia num valor `?user=` da query; nunca faça isso em produção. Um grupo é só um nome: `AddToGroupAsync` criou `ops` no primeiro uso. A documentação diz que `Clients.User` alcança todas as conexões daquele usuário. As duas últimas linhas são streams: um método de hub que retorna `IAsyncEnumerable<int>` (`Counter`, 200 ms entre itens) ou `ChannelReader<string>` (`Ticks`) é lido com `StreamAsync<T>` ou `StreamAsChannelAsync<T>`, e os itens chegaram conforme eram produzidos, não num lote no final.

### Negociação e transportes

Antes de conectar, o cliente faz POST em `/hub/negotiate?negotiateVersion=1`; o servidor respondeu 200 com `application/json`:

```text
{"negotiateVersion":1,"connectionId":"K3boaY_zYd6leDXjk91-mw","connectionToken":"B9wESLclC-ApWmkQOgDdhg","availableTransports":[{"transport":"WebSockets","transferFormats":["Text","Binary"]},{"transport":"ServerSentEvents","transferFormats":["Text"]},{"transport":"LongPolling","transferFormats":["Text","Binary"]}]}
```

A documentação dá a mesma ordem de fallback (WebSockets, Server-Sent Events, Long Polling), e o cliente .NET escolheu WebSockets todas as vezes. Mapeei o mesmo hub mais duas vezes, restrito no servidor com `MapHub<ChatHub>("/hub-ws", o => o.Transports = HttpTransportType.WebSockets)`, e forcei transportes no cliente (`WithUrl(url, o => o.Transports = ...)`):

```text
/hub forcing ServerSentEvents: started            (server: transport=ServerSentEvents)
/hub forcing LongPolling: started                 (server: transport=LongPolling)
/hub-ws forcing LongPolling: AggregateException: Unable to connect to the server with any of the available transports. (WebSockets failed: The transport is disabled by the client.)
skipNegotiation with all transports: InvalidOperationException: Negotiation can only be skipped when using the WebSocket transport directly.
skipNegotiation + WebSockets: started, ConnectionId=(null)
```

`SkipNegotiation = true` só funciona com `HttpTransportType.WebSockets` sozinho, e a conexão fica sem id visível no cliente. Um `GET /hub` sem id respondeu `400 Connection ID required`.

### Timeouts, keep-alive e o limite de tamanho de mensagem

Lido de volta de `IOptions<HubOptions>` e depois medido:

```text
HubOptions: KeepAliveInterval=00:00:15 ClientTimeoutInterval= HandshakeTimeout=00:00:15 MaximumReceiveMessageSize=32768 MaximumParallelInvocationsPerClient=1
```

`ClientTimeoutInterval` e `EnableDetailedErrors` voltaram como null (não 30 s e false): o handler aplica o próprio padrão de 30 s. Para medir, falei o protocolo do hub sobre um WebSocket cru (handshake `{"protocol":"json","version":1}` mais o separador `0x1E`) e fiquei em silêncio:

```text
silent client, no ping ever:   15.5 s {"type":6}, 31.5 s {"type":6}, 47.5 s, 62.5 s ... never closed
silent client after one ping:  15.6 s {"type":6}
                               30.6 s {"type":7,"error":"Connection closed with an error.","allowReconnect":true}
[server] disconnected ex=OperationCanceledException: Client hasn't sent a message/ping within the configured ClientTimeoutInterval.
```

O servidor manda ping a cada 15 s. No 10.0, o timeout de 30 s do cliente só começa depois do primeiro ping do cliente (no código-fonte, o `DefaultHubDispatcher` chama `StartClientTimeout` ao receber um `PingMessage`); os clientes oficiais enviam um logo depois do handshake, então para eles o comportamento é o documentado. Tamanho de mensagem: `Size(new string('x', 30000))` retornou 30000, e 40000 caracteres derrubaram a conexão:

```text
Size(40000): HubException: The server closed the connection with the following error: Connection closed with an error.
[server, Debug] System.IO.InvalidDataException: The maximum message size of 32768B was exceeded. The message size can be configured in AddHubOptions.
```

A conexão inteira morreu, não só a chamada, e o motivo apareceu apenas em nível Debug (nenhuma linha Warning ou Error). Aumente o limite por hub com `AddHubOptions<THub>` se precisar; a documentação recomenda enviar payloads grandes por HTTP normal e passar só ids pelo hub.

### Reconexão automática

`WithAutomaticReconnect()` com log Debug no cliente; matei o servidor e o mantive fora do ar:

```text
16:22:46.597 HubConnection reconnecting due to an error. ... The remote party closed the WebSocket connection without completing the close handshake.
16:22:46.598 / 16:22:48.602 / 16:22:58.605 / 16:23:28.608 Starting HubConnection.
Closed after about 42.0 s: OperationCanceledException: Reconnect retries have been exhausted after 4 failed attempts and 00:00:42.0139530 elapsed. Disconnecting.
```

Tentativas em 0, 2, 12 e 42 s: intervalos de 0, 2, 10 e 30 s, depois `Closed`, exatamente como a documentação diz. Reiniciar o servidor em menos de 2 s deu `Reconnected after about 2.1 s, new id=UuAYHyCUrUwHPzZubzrhgA` (id antigo `NbHDAIGFD-...`); a documentação explica que o servidor vê uma conexão totalmente nova, então entre de novo nos grupos no handler `Reconnected`. A documentação acrescenta que `WithAutomaticReconnect` não repete um `StartAsync` inicial que falhou.

### Autenticação: header ou query string

Adicionei JWT bearer com o hook `OnMessageReceived` da documentação, que copia `access_token` da query para `/secure`, um hub com `[Authorize]` e um cliente .NET com `AccessTokenProvider`:

```text
WebSockets / ServerSentEvents / LongPolling: UserIdentifier=alice
no token: HttpRequestException: Response status code does not indicate success: 401 (Unauthorized).
[server] GET /secure Authorization header=yes access_token query=no     (every request of the .NET client)
info: Request starting HTTP/1.1 POST http://localhost:5711/secure/negotiate?negotiateVersion=1&access_token=eyJhbGciOiJIUzI1NiIsIn...
```

O cliente .NET enviou `Authorization` em todos os transportes; a última linha é o log de um POST com `curl` em `/secure/negotiate` com o token em `access_token` (recebeu 200). Navegadores não conseguem definir headers em WebSocket nem em `EventSource`, então o cliente JavaScript coloca o token em `access_token` (segundo a documentação). Quando mandei assim, o log padrão de hosting gravou o JWT inteiro em nível Information, tanto em "Request starting" quanto em "Request finished". Suba `Microsoft.AspNetCore.Hosting` para Warning ou mascare o valor, e use tokens de vida curta.

### Scale-out: duas instâncias, sem backplane

Subi o mesmo app nas portas 5711 (A) e 5712 (B), conectei alice em A e bob em B, fiz alice chamar `SendAll` e `SendUser("bob", ...)` em A e fiz um POST em `/notify/hello` em B, um endpoint que chama o hub de fora com um `IHubContext<ChatHub, IChatClient>` injetado e `hub.Clients.All.Receive("server", ...)`:

```text
alice(on A) got [hub SendAll from alice on A]
bob(on B) got [hello (from B)]
```

Bob nunca viu o broadcast nem a mensagem direta da alice, e nada falhou: cada instância só conhece as próprias conexões. Resolver isso exige um backplane: `AddSignalR().AddStackExchangeRedis(connectionString)` (pacote `Microsoft.AspNetCore.SignalR.StackExchangeRedis`) ou Azure SignalR Service. Não consegui rodar Redis aqui (sem Docker), então essa parte vem da documentação. Sticky sessions são um requisito à parte: negociei em A e usei o token retornado em B, e `GET B/hub?id=<token>` respondeu `404 Not Found` com `No Connection with that ID`, enquanto o mesmo token em A respondeu 200. A documentação diz que sticky sessions são necessárias em qualquer cenário com vários servidores (Redis incluído), a não ser que todos os clientes usem só WebSockets com `SkipNegotiation`, ou que você use o Azure SignalR Service.

### Escolhendo o transporte

| | Direção | Reconexão e retomada | Fan-out entre servidores | Melhor uso |
|---|---|---|---|---|
| WebSockets crus | ambas, binário ou texto | você escreve | você escreve | protocolos próprios, jogos, streams binários |
| SSE (`ServerSentEvents`) | servidor para cliente, texto | `EventSource` reconecta, você reenvia pelo `Last-Event-ID` | sua responsabilidade (cada requisição é independente) | feeds, notificações, streams de tokens de LLM |
| SignalR | ambas, RPC e streams | `WithAutomaticReconnect`, novo connection id | backplane Redis ou Azure SignalR | chat, dashboards, grupos e usuários |
| Polling | cliente busca | nada para quebrar | de graça (stateless) | atualizações raras, proxies restritivos, operação mais simples |

## Trade-offs

- **SignalR é um protocolo, não só um socket.** Você ganha grupos, usuários, RPC e fallback, mas todo cliente precisa de uma biblioteca SignalR e valem o limite de 32 KB por mensagem, os keep-alives e os timeouts. Para um único feed, SSE com `TypedResults.ServerSentEvents` é menos maquinaria.
- **SSE é barato, mas de mão única.** É um GET simples que qualquer cliente HTTP lê, mas o cliente não responde por ele, e a retomada é trabalho seu: o framework ignora o `Last-Event-ID`.
- **WebSockets crus deixam tudo com você.** Handshake de fechamento, reconexão, detecção de par morto (`KeepAliveTimeout` é infinito por padrão, então configure), checagem de origem e enquadramento de mensagens.
- **Scale-out falha em silêncio.** Sem backplane, um broadcast só alcança a instância que o enviou, sem nenhum erro. Planeje Redis ou Azure SignalR Service mais sticky sessions antes da segunda réplica.
- **Token na query string acaba no log.** O log padrão de requisições imprimiu o JWT inteiro; filtre `Microsoft.AspNetCore.Hosting` ou mascare o valor antes de ir para produção.
- **Reconexão é uma conexão nova.** Recebi um `ConnectionId` novo, então tudo que estava associado ao id antigo (incluindo participação em grupos) precisa ser refeito no `Reconnected`.

## Documentation Links

- [Use hubs in ASP.NET Core SignalR, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR .NET client, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/dotnet-client?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR configuration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR production hosting and scaling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/scale?view=aspnetcore-10.0) (doc)
- [WebSockets support in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0) (doc)
