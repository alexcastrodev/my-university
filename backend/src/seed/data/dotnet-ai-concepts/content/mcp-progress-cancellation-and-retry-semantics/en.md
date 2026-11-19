---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A tool call is a request that can fail in the middle, and spec 2026-07-28 no longer
papers over that: progress notifications ride on the response stream of the request,
closing that stream is the cancellation, and a broken stream loses the request for good
(no `Last-Event-ID`, no replay). The client must re-issue it under a new request id, so
the same tool can run twice. This lesson measures it on a real Streamable HTTP server
with a TCP proxy that cuts connections on demand: progress, cancellation, the broken
stream, a double `reserve`, the idempotency-key fix, timeouts in layers and what a retry
handler may repeat. No model. Versions: `ModelContextProtocol.AspNetCore`
2.4.0 (stateless HTTP, stdio for one case), `Microsoft.Extensions.Http.Resilience` 10.11.0,
spec 2026-07-28, TFM `net10.0`, SDK 10.0.100. Setup: "MCP Servers and Clients with the C# SDK".

## Use Cases

- Showing real progress for a tool that takes seconds, and stopping it when the user gives up.
- Writing mutating tools (reserve, charge, send) so a client retry is harmless, or putting `AddStandardResilienceHandler` on an MCP client's `HttpClient` without duplicating side effects.

## Deep Dive

### Progress: a token in, notifications on the same response

A tool declares an `IProgress<ProgressNotificationValue>` parameter (the SDK injects it,
it is not in the JSON schema) and reports as it goes:

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
// client: passing an IProgress makes the SDK add a progressToken to _meta
await client.CallToolAsync("crunch", null, new Progress<ProgressNotificationValue>(v => Console.WriteLine($"{v.Progress}/{v.Total}")));
```

A TCP proxy between client and server logs both directions:

```text
--> [    0 ms] tools/call id=2 "progressToken":"8c47006cdc8a447096da99d46ffac860"
<-- [  415 ms] HTTP/1.1 200 OK Content-Type: text/event-stream
<-- [  415 ms] {"method":"notifications/progress","params":{"progressToken":"8c47...","progress":1,"total":5,...}}
... (steps 2 to 5, 400 ms apart, each also reaching the client's IProgress) ...
<-- [ 2034 ms] {"result":{"content":[{"type":"text","text":"crunched"}],"resultType":"complete",...},"id":2,"jsonrpc":"2.0"}
```

The notifications are events of the SSE response to that one POST: no second connection
and no `subscriptions/listen`, matching the changelog ("request-scoped notifications
such as `notifications/progress` continue to flow on the response stream of the
request they relate to"). Without `IProgress` there is no `progressToken` and the server sends nothing. Progress
is optional (`MAY`) on both sides; the spec lets a client reset its timeout on progress
but says it SHOULD keep a maximum.

### Cancellation: closing the stream is the signal

On the client it is the ordinary `CancellationToken`. Cancelling `crunch` after 1 s:

```text
    [server  1004 ms] crunch: token fired, stopped
TaskCanceledException: The operation was canceled.  (after 1006 ms)
```

Nothing else crossed the wire: no `notifications/cancelled`, only the closed connection.
That is the 2026-07-28 rule for Streamable HTTP ("closing the response stream MUST be
treated by the server as cancellation", "No `notifications/cancelled` message is required
or expected"). The server sees it as the tool's `CancellationToken` (in stateless mode,
`HttpContext.RequestAborted`). The SDK doc says a client token "sends a
`notifications/cancelled`", which holds on stdio, where there is no per-request stream.
Measured over stdio with `tee` in the pipe, the client sent
`{"method":"notifications/cancelled","params":{"requestId":2},"jsonrpc":"2.0"}` and the
server's token fired at 1156 ms.

Cancellation is cooperative. `ignores_token` sleeps 3 s without looking at `ct`:

```text
TaskCanceledException: The operation was canceled.  (after 1001 ms)
    [server  7531 ms] ignores_token finished (token fired meanwhile: True)
```

The work ran to the end and was discarded. A tool that must not outlive its caller passes
`ct` to every awaited call.

### The broken stream loses the request

The proxy cuts a connection N ms after a `tools/call` crosses it, with the response
passing until then or swallowed. The tool is `reserve`: not idempotent, it waits 2 s for
"the warehouse" and then commits `Reserved += quantity`. After each case the client calls
again (the SDK assigns a new request id and never retries by itself):

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

A is the benign half: the disconnect cancelled the tool before the commit, so the retry
ran it once. B is the dangerous one: the work finished and only the answer died. The
client sees the same exception in both and cannot tell them apart, so retrying is a
guess, and here it reserved 20 units for a 10 unit order. A third shape, the stream
already open (progress flowing) and cut at 1 s, raises a different exception (after two progress events):

```text
McpException: Streamable HTTP POST response completed without a reply to request with ID: 10  (after 1006 ms)
```

A retry layer must treat both `HttpRequestException` (cut before the headers) and
`McpException` (cut mid-stream) as "outcome unknown". Older material (spec 2025-11-25, SDK 1.x docs) describes resumable SSE
streams, so "the SDK will resume the stream" no longer holds for current servers: the
SDK client still has a `Last-Event-ID` resume path, but it only
triggers when the server sent event ids, and a raw POST to the 2026-07-28 server showed SSE
frames with only `event: message` and `data:` lines, no `id:`. (The SDK also logs a `TaskCanceledException` stack at Warning whenever a
cancelled tool unwinds: noise to filter, not an incident.)

### At-least-once, and the fix

A client that retries after "outcome unknown" gives the call at-least-once semantics;
one that never retries gives at-most-once; exactly-once is not something the transport
offers, only retry plus a server that deduplicates (the concept "At-Least-Once,
At-Most-Once, and Exactly-Once Semantics" in Distributed Systems I covers the three
contracts and why a lost reply is ambiguous). The MCP-shaped fix is a key chosen by the
caller and passed as an ordinary tool argument, since the spec has no session and no
request-level idempotency field:

```csharp
[McpServerTool(Name = "reserve_idem")]
public static async Task<string> ReserveIdem(string sku, int quantity, string idempotencyKey)
{
    // one Lazy per key: the first caller runs the work, every retry awaits the same Task
    var lazy = Ledger.ByKey.GetOrAdd(idempotencyKey, _ => new Lazy<Task<string>>(() => Run(sku, quantity)));
    return await lazy.Value;
}   // Run() does Task.Delay(2000) with NO request token, then commits once
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

The retry got the stored result in 1 ms (C) or joined the running work (D). The work is
deliberately not tied to the request token, otherwise the disconnect would cancel it and
D would degrade into A. The key comes from the caller (a hash of order and line, or a
GUID stored with the pending operation); the server stores key and outcome durably (a
unique index, see "Transactional Outbox, Inbox and Idempotent Consumers"; the dictionary
here lives in one process) and rejects a reused key with different arguments. The
alternative is a durable handle: with the Tasks extension a lost response costs one poll
(see "MCP Tasks Extension for Long-Running Tools"), but the creating call can still be
lost and repeated (that lesson measured two runs for the same arguments), so the key stays. The REST side is in "REST
Semantics: Status Codes and Idempotency".

### Timeouts in layers, and who wins

`McpClientOptions` has two timeout properties, `InitializationTimeout` (60 s) and
`DiscoverProbeTimeout`, and both only govern connecting. The SDK has no per-call timeout;
a call is bounded by the layers around it. Measured with a 4 s tool:

```text
1: HttpClient.Timeout 1.5 s      -> TaskCanceledException "...configured HttpClient.Timeout ... elapsing" (1513 ms); server token fired at 1495 ms
2: CancellationToken after 1 s   -> TaskCanceledException "The operation was canceled." (1002 ms); server token fired
3: tool's own 500 ms deadline    -> IsError result "An error occurred invoking 'sleep_with_own_deadline': the backend did not answer within 500 ms" (525 ms)
4: token at 3 s and own deadline -> the same tool result (505 ms)
```

The shortest layer wins, and what the caller sees differs: client-side layers throw and
abort the work through the disconnect, while a server-side deadline is a normal `IsError`
result the model can read, the only one of the three that says what happened. Keep the
tool's own deadline below the client's `HttpClient` timeout, and that below any proxy idle
timeout (a gateway dropping idle streams looks like case B).

### Retry in the client: what may be repeated

The SDK never retries a call (A and B each started the tool once), so retry is whatever
you add. A hand-rolled handler that repeats on any transport failure, first response
swallowed:

```text
[server 2002 ms] reserve COMMITTED, total reserved now 10  ... proxy swallows the response
[server 4506 ms] reserve COMMITTED, total reserved now 20
    tools/call id=2 attempt 1: HttpRequestException, retrying with the same body and id
    tools/call id=2 attempt 2: HTTP 200
```

And `AddStandardResilienceHandler` on the client's `HttpClient` (1 s attempt timeout, 2
retries) against a 2 s tool:

```text
reserve (honors ct):    3 starts, each cancelled at 1 s, committed 0, TimeoutRejectedException after 3213 ms
reserve_sloppy (no ct): 3 starts, 3 commits, committed 30, TimeoutRejectedException after 3232 ms
```

The default strategy repeats POST, and every MCP call is a POST, so the handler cannot
tell `read_stock` from `reserve`. `Retry.DisableForUnsafeHttpMethods()` turns retries off
for all of MCP (measured: 1 start, and the tool without `ct` still committed once). The
standard handler's defaults (10 s per attempt, 30 s total) also silently kill a
legitimate 20 s tool, and it only sees faults before the response headers arrive: the
mid-stream cut went through the same blind handler as `attempt 1: HTTP 200`, was not
retried, and the client still threw the `McpException`. What worked: a handler that
retries only tools on your own allow-list, keyed on the `Mcp-Name` header:

```text
read_stock: cut, retried, HTTP 200 on attempt 2
reserve:    attempt 1: HttpRequestException, NOT retried (reserve is not on the allow-list)
after both  [started=1 committed total=10]
```

Annotations are not that allow-list: the client saw `idempotentHint` `True` for
`read_stock`, `False` for `reserve` and `null` for tools that did not set it, and the spec says clients "MUST consider tool annotations to be untrusted unless they come
from trusted servers". Build the list from tools you or a vendor you trust vouch for. A
retry that reuses the body repeats the same JSON-RPC id (id=2 above); the spec asks for a
new id after a broken stream, which a plain re-call through the SDK does.

### The whole table

| Failure | What the client sees | What the server did | Defense |
| --- | --- | --- | --- |
| Token cancelled (stdio also sends `notifications/cancelled`) | `TaskCanceledException` | `ct` fires; stops if it honors it | pass `ct`; commit last |
| Tool ignores `ct` | already gave up | runs to the end, result dropped | honor `ct`; idempotent commit |
| Cut before the headers | `HttpRequestException` | cancelled (A) or finished (B) | key, then retry |
| Cut mid-stream | `McpException` "completed without a reply" | cancelled or finished | key, then retry; catch both |
| `HttpClient.Timeout` | `TaskCanceledException` (timeout text) | `ct` fires | tool deadline below it |
| Tool's own deadline | `IsError` result, your message | stopped | readable error for the model |
| Blind retry on POST | maybe success | ran twice | tool allow-list plus keys |

## Trade-offs

- **Key vs task handle.** A key is a few lines and works on any server, but you store outcomes and write the dedup. A task keeps the result for you but needs the extension on both sides, and the creating call still needs a key.
- **Work tied to the request token vs not.** Tied: a hung-up caller frees resources, at the cost of case B style losses after a commit. Untied: retries can join (D), but abandoned work runs on and needs its own timeout.
- **The model can retry too.** A model that sees an error may call `reserve` again; server-side dedup covers the handler and the model alike.
- **Global resilience policy vs per tool.** One `AddStandardResilienceHandler` is easy and wrong for mutating tools (3 commits above); an allow-list is more code and the only safe shape.

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
