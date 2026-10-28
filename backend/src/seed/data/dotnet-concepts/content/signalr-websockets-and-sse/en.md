---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Plain HTTP is request and response: the server cannot speak until the client asks. Dashboards, chat, notifications, progress bars and live prices need the opposite, and ASP.NET Core 10 gives three ways to push data. Raw WebSockets (`UseWebSockets`) give a full-duplex socket and leave the protocol, reconnection and fan-out to you. Server-Sent Events, which .NET 10 now serves with `TypedResults.ServerSentEvents` and reads with `System.Net.ServerSentEvents.SseParser`, are a one-way text stream over a normal HTTP response. SignalR adds hubs, RPC in both directions, groups, users, streaming, automatic transport fallback and reconnection on top of those transports. This lesson runs a WebSocket echo endpoint, an SSE price feed, and a SignalR hub with a .NET client, prints the real negotiate JSON, headers, frames, timeouts and error messages, measures the reconnect delays and the 32 KB message limit, and starts two instances of the same app to show what a missing backplane does to a broadcast. Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (in-box `System.Net.ServerSentEvents` from `Microsoft.NETCore.App` 10.0.0), `Microsoft.AspNetCore.SignalR.Client` 10.0.14, `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.14, `Microsoft.Extensions.Logging.Console` 10.0.14.

## Use Cases

- Pushing order status, job progress or notifications to a browser the moment they change, instead of polling every few seconds.
- Streaming a feed (prices, logs, LLM tokens, sensor readings) where only the server talks, using SSE over a plain GET.
- Chat, collaboration and multiplayer features where clients and server both send, grouped by room, tenant or user.
- Calling connected clients from outside a hub: a background job, a webhook or a POST endpoint that tells "everyone in group X" something happened.

## Deep Dive

### Raw WebSockets: accept, echo, close

The middleware is in the shared framework. I printed the defaults of `new WebSocketOptions()` and then configured it:

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

A `ClientWebSocket` console client connected three times (no `Origin`, the allowed one, a foreign one), sent `ping 1` and closed with `CloseAsync(NormalClosure, "bye")`:

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

Defaults: a ping frame every 2 minutes, no pong timeout (`-1 ms` is `Timeout.InfiniteTimeSpan`), every origin allowed. A client close arrives as a `Close` message from `ReceiveAsync`; the server must answer it, and only then does the handler return and the request finish with status 101. `AllowedOrigins` rejected the foreign origin with 403 but let the request with no `Origin` header through, which is what non-browser clients send. The docs explain why it matters: browsers skip CORS for WebSockets, so this list is your only origin check, and `Origin` can be forged outside a browser.

The request is the connection, so the pipeline must stay alive while the socket lives. I wrote an endpoint that accepts the socket, starts `Task.Run` to send `late` 200 ms later, and returns:

```text
[server] late send: System.Net.WebSockets.WebSocketException: The remote party closed the WebSocket connection without completing the close handshake.
ws-bad client: WebSocketException: The remote party closed the WebSocket connection without completing the close handshake.
```

Returning from the handler ended the request and tore down the socket. The docs show the fix for background writers: pass a `TaskCompletionSource` to the worker and `await` its `Task` in the endpoint until the worker is done.

### Server-Sent Events in .NET 10

`TypedResults.ServerSentEvents` takes an `IAsyncEnumerable<T>` or `IAsyncEnumerable<SseItem<T>>`; `SseItem<T>` carries the event type, id and retry hint:

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

`curl -s -N -i http://localhost:5711/sse` (lines end in `\r\n` for headers and `\n` for events):

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

Objects are serialized as camelCase JSON and `retry` is in milliseconds. A plain `IAsyncEnumerable<string>` with `eventType: "word"` produced `data: hello`, and a value containing a newline became two `data:` lines (`data: two` / `data: lines`), which is how SSE encodes multi-line text. The result also sets `Content-Encoding: identity`; I did not test how it interacts with response compression.

To read it from .NET, `SseParser` is in the runtime (`System.Net.ServerSentEvents.dll` ships in `Microsoft.NETCore.App` 10.0.0, no package needed):

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

Neither side handles resumption for you. `SseParser` only parses: when the stream ended it did not reconnect or send `Last-Event-ID`; I sent the header myself on a second request. `TypedResults.ServerSentEvents` ignores the header too; my handler read it and continued from id 4. Browsers' `EventSource` reconnects on its own and sends `Last-Event-ID` (per MDN); the server still has to keep enough history to replay from that id. SSE is server-to-client text over one HTTP response: anything the client says goes in a separate request.

### SignalR: a strongly typed hub

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

`Hub<IChatClient>` turns `Clients.All.Receive(...)` into a compile-checked call instead of `SendAsync("Receive", ...)`. Three .NET clients (`HubConnectionBuilder().WithUrl(...).Build()`, `On<string, string>("Receive", ...)`), alice, bob and carol, with bob and carol in group `ops`, and alice invoking each method:

```text
SendAll: alice got [all] from alice; bob got [all] from alice; carol got [all] from alice
SendOthers: bob got [others] from alice; carol got [others] from alice
SendCaller: alice got [caller] from hub
SendUser(bob): bob got [dm] from alice
SendGroup(ops): bob got [grp] from alice; carol got [grp] from alice
unknown method: HubException: Failed to invoke 'NoSuchMethod' due to an error on the server. HubException: Method does not exist.
stream Counter: 1 at about 208 ms, 2 at about 408 ms, 3 at about 609 ms; stream Ticks: tick 1, tick 2, tick 3
```

`Context.ConnectionId` is per connection; `Context.UserIdentifier` comes from `IUserIdProvider`, which by default reads `ClaimTypes.NameIdentifier` (the docs say). For this demo I registered a provider that trusts a `?user=` query value; never do that in production. A group is just a name: `AddToGroupAsync` created `ops` on first use. The docs say `Clients.User` reaches every connection of that user. The last two lines are streams: a hub method returning `IAsyncEnumerable<int>` (`Counter`, 200 ms between items) or `ChannelReader<string>` (`Ticks`) is read with `StreamAsync<T>` or `StreamAsChannelAsync<T>`, and items arrived as produced, not as one batch.

### Negotiation and transports

Before connecting, the client POSTs to `/hub/negotiate?negotiateVersion=1`; the server answered 200 with `application/json`:

```text
{"negotiateVersion":1,"connectionId":"K3boaY_zYd6leDXjk91-mw","connectionToken":"B9wESLclC-ApWmkQOgDdhg","availableTransports":[{"transport":"WebSockets","transferFormats":["Text","Binary"]},{"transport":"ServerSentEvents","transferFormats":["Text"]},{"transport":"LongPolling","transferFormats":["Text","Binary"]}]}
```

The docs give the same fallback order (WebSockets, Server-Sent Events, Long Polling), and the .NET client picked WebSockets every time. I mapped the same hub twice more, restricted on the server with `MapHub<ChatHub>("/hub-ws", o => o.Transports = HttpTransportType.WebSockets)`, and forced transports on the client (`WithUrl(url, o => o.Transports = ...)`):

```text
/hub forcing ServerSentEvents: started            (server: transport=ServerSentEvents)
/hub forcing LongPolling: started                 (server: transport=LongPolling)
/hub-ws forcing LongPolling: AggregateException: Unable to connect to the server with any of the available transports. (WebSockets failed: The transport is disabled by the client.)
skipNegotiation with all transports: InvalidOperationException: Negotiation can only be skipped when using the WebSocket transport directly.
skipNegotiation + WebSockets: started, ConnectionId=(null)
```

`SkipNegotiation = true` works only with `HttpTransportType.WebSockets` alone, and the connection then has no client-visible id. A `GET /hub` without an id answered `400 Connection ID required`.

### Timeouts, keep-alive and the message size limit

Read back from `IOptions<HubOptions>` and then measured:

```text
HubOptions: KeepAliveInterval=00:00:15 ClientTimeoutInterval= HandshakeTimeout=00:00:15 MaximumReceiveMessageSize=32768 MaximumParallelInvocationsPerClient=1
```

`ClientTimeoutInterval` and `EnableDetailedErrors` read back as null (not 30 s and false): the handler applies its own 30 s default. To measure it I spoke the hub protocol over a raw WebSocket (handshake `{"protocol":"json","version":1}` plus the `0x1E` separator) and then stayed silent:

```text
silent client, no ping ever:   15.5 s {"type":6}, 31.5 s {"type":6}, 47.5 s, 62.5 s ... never closed
silent client after one ping:  15.6 s {"type":6}
                               30.6 s {"type":7,"error":"Connection closed with an error.","allowReconnect":true}
[server] disconnected ex=OperationCanceledException: Client hasn't sent a message/ping within the configured ClientTimeoutInterval.
```

The server pings every 15 s. On 10.0 the 30 s client timeout only starts after the client's first ping (in the source, `DefaultHubDispatcher` calls `StartClientTimeout` on a `PingMessage`); the official clients send one right after the handshake, so for them it behaves as documented. Message size: `Size(new string('x', 30000))` returned 30000, and 40000 characters killed the connection:

```text
Size(40000): HubException: The server closed the connection with the following error: Connection closed with an error.
[server, Debug] System.IO.InvalidDataException: The maximum message size of 32768B was exceeded. The message size can be configured in AddHubOptions.
```

The whole connection died, not just the call, and the reason appeared only at Debug level (no Warning or Error line). Raise it per hub with `AddHubOptions<THub>` if you must; the docs recommend uploading large payloads over normal HTTP and sending only ids through the hub.

### Automatic reconnect

`WithAutomaticReconnect()` with client Debug logging; I killed the server and kept it down:

```text
16:22:46.597 HubConnection reconnecting due to an error. ... The remote party closed the WebSocket connection without completing the close handshake.
16:22:46.598 / 16:22:48.602 / 16:22:58.605 / 16:23:28.608 Starting HubConnection.
Closed after about 42.0 s: OperationCanceledException: Reconnect retries have been exhausted after 4 failed attempts and 00:00:42.0139530 elapsed. Disconnecting.
```

Attempts at 0, 2, 12 and 42 s: gaps of 0, 2, 10 and 30 s, then `Closed`, exactly as the docs state. Restarting the server within 2 s gave `Reconnected after about 2.1 s, new id=UuAYHyCUrUwHPzZubzrhgA` (old id `NbHDAIGFD-...`); the docs explain that the server sees a brand new connection, so re-join groups in the `Reconnected` handler. The docs add that `WithAutomaticReconnect` does not retry a failed initial `StartAsync`.

### Authentication: header or query string

I added JWT bearer with the docs' `OnMessageReceived` hook that copies `access_token` from the query for `/secure`, an `[Authorize]` hub, and a .NET client with `AccessTokenProvider`:

```text
WebSockets / ServerSentEvents / LongPolling: UserIdentifier=alice
no token: HttpRequestException: Response status code does not indicate success: 401 (Unauthorized).
[server] GET /secure Authorization header=yes access_token query=no     (every request of the .NET client)
info: Request starting HTTP/1.1 POST http://localhost:5711/secure/negotiate?negotiateVersion=1&access_token=eyJhbGciOiJIUzI1NiIsIn...
```

The .NET client sent `Authorization` on all transports; the last line is the log of a `curl` POST to `/secure/negotiate` with the token in `access_token` (it got 200). Browsers cannot set headers on WebSocket or `EventSource`, so the JavaScript client puts the token in `access_token` (the docs say). When I sent it that way, the default hosting log wrote the full JWT at Information level in both "Request starting" and "Request finished". Raise `Microsoft.AspNetCore.Hosting` to Warning or redact it, and keep tokens short-lived.

### Scale-out: two instances, no backplane

I started the same app on ports 5711 (A) and 5712 (B), connected alice to A and bob to B, then had alice call `SendAll` and `SendUser("bob", ...)` on A, and posted to `/notify/hello` on B, an endpoint that calls the hub from outside with an injected `IHubContext<ChatHub, IChatClient>` and `hub.Clients.All.Receive("server", ...)`:

```text
alice(on A) got [hub SendAll from alice on A]
bob(on B) got [hello (from B)]
```

Bob never saw alice's broadcast or her direct message, and nothing failed: each instance only knows its own connections. Fixing that needs a backplane: `AddSignalR().AddStackExchangeRedis(connectionString)` (package `Microsoft.AspNetCore.SignalR.StackExchangeRedis`) or Azure SignalR Service. I could not run Redis here (no Docker), so this part is from the docs. Sticky sessions are a separate requirement: I negotiated on A and used the returned token on B, and `GET B/hub?id=<token>` answered `404 Not Found` with `No Connection with that ID`, while the same token on A answered 200. The docs say sticky sessions are needed in every multi-server setup (Redis included) unless all clients use WebSockets only with `SkipNegotiation`, or you use Azure SignalR Service.

### Choosing a transport

| | Direction | Reconnect and resume | Fan-out across servers | Best fit |
|---|---|---|---|---|
| Raw WebSockets | both, binary or text | yours to write | yours to write | custom protocols, games, binary streams |
| SSE (`ServerSentEvents`) | server to client, text | `EventSource` reconnects, you replay by `Last-Event-ID` | yours (each request is independent) | feeds, notifications, LLM token streams |
| SignalR | both, RPC and streams | `WithAutomaticReconnect`, new connection id | Redis or Azure SignalR backplane | chat, dashboards, groups and users |
| Polling | client pulls | nothing to break | free (stateless) | rare updates, strict proxies, simplest ops |

## Trade-offs

- **SignalR is a protocol, not just a socket.** You get groups, users, RPC and fallback, but every client needs a SignalR library and the 32 KB message limit, keep-alives and timeouts apply. For a single feed, SSE with `TypedResults.ServerSentEvents` is less machinery.
- **SSE is cheap but one-way.** It is a plain GET that any HTTP client can read, but the client cannot reply on it, and resumption is your job: the framework ignores `Last-Event-ID`.
- **Raw WebSockets leave everything to you.** Close handshakes, reconnection, dead-peer detection (`KeepAliveTimeout` is infinite by default, so set it), origin checks and message framing.
- **Scale-out is silent until it is not.** Without a backplane a broadcast reaches only the instance that sent it, with no error. Plan Redis or Azure SignalR Service plus sticky sessions before the second replica.
- **Query-string tokens end up in logs.** The default request log printed the full JWT; filter `Microsoft.AspNetCore.Hosting` or redact it before production.
- **Reconnection is a new connection.** I got a new `ConnectionId`, so anything keyed by the old id (group membership included) must be rebuilt in `Reconnected`.

## Documentation Links

- [Use hubs in ASP.NET Core SignalR, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR .NET client, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/dotnet-client?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR configuration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-10.0) (doc)
- [ASP.NET Core SignalR production hosting and scaling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/signalr/scale?view=aspnetcore-10.0) (doc)
- [WebSockets support in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0) (doc)
- [What's new in ASP.NET Core in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0?view=aspnetcore-10.0) (doc)
