---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Since MCP 2026-07-28 a server no longer sends its own requests
(`elicitation/create`, `sampling/createMessage`, `roots/list`) in the middle of
a call: it answers with an interim `InputRequiredResult`, and the client repeats
the original request with `inputResponses` and the opaque `requestState`. This
lesson measures that loop in the C# SDK with a scripted client handler and no
model: the wire, decline and cancel, `await ElicitAsync`, every HTTP session
mode, forged state, URL mode and the deprecated Roots, Sampling and Logging.

Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0
(2026-11-07), Data Protection from the ASP.NET Core 10.0.0 shared framework,
TFM `net10.0`, SDK 10.0.100, MCP spec 2026-07-28.

## Use Cases

- A destructive tool that asks the user to confirm, or to pick an option, first.
- Collecting a missing argument from the user instead of letting the model guess.
- Sending the user to a browser page (third-party OAuth, payment) the client never sees.
- Keeping a multi-step flow on stateless HTTP behind a plain load balancer.

## Deep Dive

### A tool that asks: InputRequiredException

The tool throws on the first call and reads the answer on the retry, keeping nothing in memory:

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

The client registers a handler; `CallToolAsync` runs the whole loop by itself:

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

### On the wire

Captured on stdio with `tee` (`_meta` shortened; it carried `"clientCapabilities":
{"elicitation":{"form":{}}}`, declared as soon as an `ElicitationHandler` is set):

```text
--> {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42},"_meta":{...}},"id":2,"jsonrpc":"2.0"}
<-- {"result":{"inputRequests":{"reason":{"method":"elicitation/create","params":{"mode":"form","message":"Close ticket 42? Give a reason.","requestedSchema":{"type":"object","properties":{"reason":{"type":"string","description":"Why it is closed","default":"completed"}},"required":["reason"]}}}},"requestState":"ticket:42","resultType":"input_required","_meta":{...}},"id":2,"jsonrpc":"2.0"}
--> {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42},"_meta":{...},"inputResponses":{"reason":{"action":"accept","content":{"reason":"duplicate"}}},"requestState":"ticket:42"},"id":3,"jsonrpc":"2.0"}
<-- {"result":{"content":[{"type":"text","text":"closed ticket 42: duplicate (state ticket:42)"}],"resultType":"complete","_meta":{...}},"id":3,"jsonrpc":"2.0"}
```

Two independent requests (ids 2 and 3), no server-to-client message. The spec
allows `InputRequiredResult` only on `tools/call`, `prompts/get`, `resources/read`.

### Accept, decline, cancel, no handler

| Handler returns | Retry carries | Tool result |
| --- | --- | --- |
| `accept` + content | `{"action":"accept","content":{"reason":"duplicate"}}` | `closed ticket 42: duplicate` |
| `accept`, no content | `{"action":"accept","content":{"reason":"completed"}}` | the client filled in the schema `default` |
| `decline` | `{"action":"decline"}` | `ticket 42 left open (action=decline)` |
| `cancel` | `{"action":"cancel"}` | `ticket 42 left open (action=cancel)` |
| no handler | no retry | `InvalidOperationException: Server sent an elicitation input request, but no ElicitationHandler is registered.` |

Decline (said no) and cancel (closed the dialog) arrive as normal retries: branch on `IsAccepted`.

### The await style: ElicitAsync

The pre-2026 style, `await server.ElicitAsync(new ElicitRequestParams { ... },
ct)` in the middle of the tool, compiles without warnings. On stdio with a
2026-07-28 client the wire was MRTR too: key `input_1`, state
`"c515db44e6f64dd1be292ad8c16c5fbd"`, a handle to the handler suspended in
server memory and resumed by the retry. In the SDK source those continuations
have no expiry and are cancelled only when the server is disposed (source, not
measured). On stateless HTTP the tool returned `IsError=True`, logging
`InvalidOperationException: Elicitation is not supported in stateless mode.`

### Every session mode, measured

Both tools with the scripted `accept`, on stdio and every HTTP `SessionMode`:

| Server | Client | `close_ticket` (InputRequiredException) | `close_ticket_await` (ElicitAsync) |
| --- | --- | --- | --- |
| stdio | default | MRTR on the wire | MRTR, handler suspended |
| stdio | pinned 2025-11-25 | SDK sends a legacy `elicitation/create`, retries the tool | legacy `elicitation/create` |
| `Stateless` | default | MRTR | `IsError`, not supported in stateless mode |
| `Stateless` | pinned 2025-11-25 | `IsMrtrSupported` false, fallback text | `IsError`, same exception |
| `Stateful` | default (downgrades, gets a session) | legacy request on the POST's SSE stream | legacy |
| `Stateful` | pinned 2025-11-25 | legacy | legacy |
| `StatefulForInitializeClients` | default | MRTR | `IsError`, same exception |
| `StatefulForInitializeClients` | pinned 2025-11-25 | legacy, with session | legacy |

The legacy path of the `Stateful` row, captured with a `DelegatingHandler`
(params shortened):

```text
--> POST {"method":"tools/call","params":{"name":"close_ticket","arguments":{"ticketId":42}},"id":3,"jsonrpc":"2.0"} Mcp-Session-Id=6UwPPSXnxt2ZAt1c0DtQuA
<-- sse {"method":"elicitation/create","params":{"mode":"form","message":"Close ticket 42? Give a reason.",...},"id":1,"jsonrpc":"2.0"}
--> POST {"result":{"action":"accept","content":{"reason":"duplicate"}},"id":1,"jsonrpc":"2.0"} Mcp-Session-Id=6UwPPSXnxt2ZAt1c0DtQuA
<-- sse {"result":{"content":[{"type":"text","text":"closed ticket 42: duplicate (state ticket:42)"}]},"id":3,"jsonrpc":"2.0"}
```

The tool still saw `requestState=ticket:42`: the SDK bridged the exception to
the old request and retried the handler (up to 10 rounds, per the docs). So the
prerequisite's "stateless mode disables sampling and elicitation requests" holds
only for the direct methods (`ElicitAsync`, `SampleAsync`, `RequestRootsAsync`).
With a 2026-07-28 client, elicitation works on stateless HTTP through
`InputRequiredException`, with request-scoped `ClientCapabilities` populated;
only a 2025-11-25 client on a stateless server gets none.

### requestState is attacker input

A raw `curl` POST to the stateless server, with `inputResponses` on the very
first call and no `requestState`:

```text
{"result":{"content":[{"type":"text","text":"closed ticket 42: forged (state )"}],"resultType":"complete",...},"id":1,"jsonrpc":"2.0"}
```

The ticket closed without anyone being asked, and the MRTR samples in the SDK
docs also read `InputResponses` without verifying any state. The spec says the
server MUST treat `requestState` as attacker-controlled, protect its integrity
(HMAC or AEAD) when it drives a decision, and SHOULD bind it to the principal, a
short TTL and the originating request. ASP.NET Core Data Protection covers that:

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

Against this `close_ticket_safe`, the forged first call, a valid state from
ticket 42 sent for ticket 7, and a state with one character changed (logged as
`requestState rejected`) all got a new `InputRequiredResult`; the real flow
returned `closed ticket 42: duplicate`. The state was 155 characters, `CfDJ8...`.
Every instance behind a load balancer needs the same key ring (`PersistKeysTo...`)
or the retry fails elsewhere (docs only, one instance here). Integrity does not
make a state single-use; one-time actions still need a server-side check.

### URL mode

For data the client must not see (an API key, a payment, a third-party OAuth
consent) the server sends `Mode = "url"`, a `Message` and a `Url` instead of a
schema, here with `requestState: "flow:7f3a"`:

```text
[handler] mode=url message="Sign in to your calendar provider." url=https://mcp.example.com/connect/calendar?flow=7f3a
result IsError=null text="browser flow opened; call again once you finish"
```

The retry carried only `{"action":"accept"}`: consent to open the page, not a
finished flow, so the next call checks the server's own token store. The client
MUST show the full URL, ask before opening it and never prefetch it; form mode
MUST NOT collect secrets. This is not how the client authorizes to the MCP
server (see the authorization concept). Book vs today: 2026-07-28 removed the
`elicitationId` field and `notifications/elicitation/complete` and keeps the
`-32042` "URL elicitation required" error for 2025-11-25 only, while SDK 2.4.0
still ships `ElicitationId` and `UrlElicitationRequiredException` for older
peers, and its elicitation page still teaches them.

### Capabilities the SDK does not check for you

With no handler the client sent `"clientCapabilities":{}`, yet the exception
still went out with an `elicitation/create` inside, and a client that declared
only `form` received the URL-mode request; the spec says the server MUST NOT.
`ElicitAsync` checks (`Client does not support elicitation requests.`), the
exception path does not. Check in the tool and use the 2026-07-28 error:

```csharp
if (server.ClientCapabilities?.Elicitation is null)
    throw new MissingRequiredClientCapabilityException(
        new() { Elicitation = new() { Form = new() } }, "close_ticket needs form elicitation");
```

```text
<-- {"error":{"code":-32021,"message":"close_ticket needs form elicitation","data":{"requiredCapabilities":{"elicitation":{"form":{}}}}},"id":2,"jsonrpc":"2.0"}
```

On stdio the client threw `MissingRequiredClientCapabilityException`; over HTTP
the response was `400` and it threw a plain `HttpRequestException` instead.

### Roots, Sampling and Logging are deprecated

SEP-2577 deprecates all three (at least twelve months before removal), and SDK
2.0.0 marked them `[Obsolete]`: `SampleAsync`, `RequestRootsAsync`,
`SamplingHandler`, `RootsHandler`, `ClientCapabilities.Sampling`/`Roots`,
`CreateMessageRequestParams` and `InputRequest.ForRootsList` each gave `MCP9005`
(`The Roots feature is deprecated as of specification version 2026-07-28...`);
elicitation gave none. Migrations: directories or files as tool parameters,
resource URIs or server configuration instead of Roots; the LLM provider called
from the server (an `IChatClient`) instead of Sampling; stderr or OpenTelemetry
instead of Logging.

## Trade-offs

- **InputRequiredException vs ElicitAsync.** The exception works everywhere,
  but the tool becomes a state machine re-entered per round. `ElicitAsync` reads
  top to bottom, yet fails on stateless HTTP and pins the handler to one process.
- **State in requestState vs on the server.** Encoded state needs no store and
  survives any instance, but the client holds it: sign it, expire it, bind it.
- **Asking vs taking an argument.** Each question costs a round trip and a host
  with UI; also accept the value as a tool argument so scripts can skip the prompt.
- **Form vs URL mode.** Form data passes through the client; secrets go through
  URL mode, which makes the server own the browser flow and the user binding.

## Documentation Links

- [Multi Round-Trip Requests, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) (doc)
- [Elicitation, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Deprecated features, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/deprecated) (doc)
- [Multi Round-Trip Requests (MRTR), MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/mrtr/mrtr.md) (doc)
- [Elicitation, MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/elicitation/elicitation.md) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [Limit the lifetime of protected payloads, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/limited-lifetime-payloads) (doc)
