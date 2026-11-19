---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A tool call that takes 6 seconds, or 6 minutes, is a bad fit for one HTTP
response: any timeout, proxy or dropped connection loses the work, and the 2026-07-28
spec removed the SSE resumability that used to soften this. The answer is the
Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663): the server returns a
durable task handle right away and the client polls `tasks/get`, sends input with
`tasks/update`, and cancels with `tasks/cancel`. This lesson measures all of it
on a real Streamable HTTP server: the wire, the three execution modes, what a client
without the extension sees, cancellation, errors, TTL, a server restart and
idempotency. Versions: `ModelContextProtocol.AspNetCore` 2.4.0 and
`ModelContextProtocol.Extensions.Tasks` 2.4.0 (resolved with `dotnet list
package`), spec 2026-07-28, TFM `net10.0`, SDK 10.0.100. The tasks package is
stable (no `MCPEXP` warning when compiling; the 2.0.0 release notes list "Stabilize
official Extensions, Tasks, and MRTR APIs"). No model is involved.

## Use Cases

- A tool that wraps a report, export, build or batch job that outlives a normal HTTP timeout.
- A tool that must pause for a human approval in the middle of the work.
- A client that must survive its own restart and resume from a stored task id, and
  deciding what to do with a client that does not speak the extension.

## Deep Dive

### The problem: one response is a bad place for 6 seconds

The `build_report` tool sleeps 6 seconds and logs its start and end. A client whose
`HttpClient.Timeout` is 3 seconds calls it plainly, then calls it again as a task:

```text
plain call, 3 s HTTP timeout: TaskCanceledException after 3026 ms
task call, same 3 s timeout: report T ready (run #6) after 6049 ms
```

The server log shows `run #5 started`, never `finished`, and a
`TaskCanceledException`: when the response stream breaks, the work stops with it.
The spec says so: "A broken response stream loses the in-flight request; clients
MUST re-issue it as a new request with a new request ID", because SSE event ids and
`Last-Event-ID` were removed. The task call survives the same timeout because no
single request lasts more than a few milliseconds. The basic client and server
setup is in the concept "MCP Servers and Clients with the C# SDK".

### Server: one line, and a store

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

`WithTasks` registers the `tasks/get`, `tasks/update` and `tasks/cancel` handlers,
advertises the extension (`server/discover` now lists `"extensions":{"io.modelcontextprotocol/tasks":{}}`)
and wraps every `[McpServerTool]`: the body runs in the background and the call
returns a handle. The tool code does not change. The store must be shared across
requests (singleton or external storage), or a poll on a fresh server finds it empty.

### On the wire: handle, then polling

The client declares the extension in the `_meta` of each request (abbreviated here).
The server decides whether to answer with a task; the client never asks for one.

```text
--> POST Mcp-Method=tools/call Mcp-Name=build_report
    {"method":"tools/call","params":{"name":"build_report","arguments":{"name":"Q3"},"_meta":{"io.modelcontextprotocol/clientCapabilities":{"extensions":{"io.modelcontextprotocol/tasks":{}}},...}},"id":2,...}
<-- 200 (after 15 ms)
    {"result":{"taskId":"ba0dbdbb574f46f9965f17a5dee762ff","status":"working","createdAt":"2026-11-19T00:11:09.53+00:00","lastUpdatedAt":"...","pollIntervalMs":1000,"resultType":"task",...},"id":2}
--> POST Mcp-Method=tasks/get Mcp-Name=ba0dbdbb574f46f9965f17a5dee762ff     (every 1000 ms)
<-- {"result":{"resultType":"complete","taskId":"a12a...","status":"working",...,"pollIntervalMs":1000},...}
<-- (6 s later) {"result":{"resultType":"complete","taskId":"a12a...","status":"completed","lastUpdatedAt":"...","result":{"content":[{"type":"text","text":"report Q3 ready (run #2)"}]}},...}
```

`resultType: "task"` tells the client this is a handle, not a `CallToolResult`, and
`Mcp-Name` carries the task id on every task call so a load balancer can route by
task. The client side is two helpers:

```csharp
var raw = await client.CallToolAsTaskAsync(new() { Name = "build_report", Arguments = args });
if (raw.IsTask)                                       // ResultOrCreatedTask<CallToolResult>
    while (await client.GetTaskAsync(raw.TaskCreated!.TaskId) is WorkingTaskResult)
        await Task.Delay((int)(raw.TaskCreated.PollIntervalMs ?? 1000));
// or, to hide the lifecycle:
CallToolResult r = await client.CallToolWithPollingAsync(new() { Name = "build_report", Arguments = args });
```

`GetTaskResult` is a hierarchy (`WorkingTaskResult`, `InputRequiredTaskResult`,
`CompletedTaskResult` with `Result`, `FailedTaskResult` with `Error`,
`CancelledTaskResult`). `CallToolWithPollingAsync` took 6042 ms for the same text.

### Execution modes and the client without the extension

Since 2.0.0-rc.2 the server picks a mode per call with `McpTasksOptions.ExecutionModeSelector`:

```csharp
.WithTasks(store, o => o.ExecutionModeSelector = ctx => ctx.Params?.Name switch
{
    "quick_lookup"   => McpTaskExecutionMode.Synchronous,   // never a task
    "nightly_export" => McpTaskExecutionMode.Required,      // only for clients with the extension
    _                => McpTaskExecutionMode.Optional,      // the default: task if the client opted in
});
```

| Call | Measured result |
| --- | --- |
| plain `CallToolAsync("build_report")` (Optional, no extension) | blocked 6023 ms, normal `CallToolResult`, `IsError` null |
| plain `CallToolAsync("nightly_export")` (Required, no extension) | HTTP 400, JSON-RPC `-32021` "requires the 'io.modelcontextprotocol/tasks' client extension capability", `data.requiredCapabilities` names the extension |
| `CallToolAsTaskAsync("quick_lookup")` (Synchronous, with extension) | `IsTask=False`, inline `value-of-x` |
| `CallToolWithPollingAsync("nightly_export")` (Required, with extension) | a task, completes with `export done` |
| client pinned to `ProtocolVersion = "2025-11-25"` plus the helper | `IsTask=False`, blocked 6024 ms (the helper only adds the opt-in on 2026-07-28 or later) |
| `GetTaskAsync` on that 2025-11-25 connection | client throws `InvalidOperationException`: requires 2026-07-28 or later |
| `GetTaskAsync("no-such-id")` | `McpProtocolException`: `Unknown task: 'no-such-id'` |

So a client without the extension sees the same tool block under `Optional` (with the
timeout problem above) and a clear `-32021` under `Required`. Not run: an
`McpClientTool` under `UseFunctionInvocation()`; it uses the plain call, so it should block.

### Input in the middle: tasks/update

When the tool calls `server.ElicitAsync` inside a task, the SDK turns it into an
entry of `inputRequests` instead of a server-initiated request. The tool:

```csharp
[McpServerTool(Name = "deploy")]
public static async Task<string> Deploy(McpServer server, string service, CancellationToken ct)
{
    var ask = await server.ElicitAsync<Confirm>($"Deploy {service} to production?", cancellationToken: ct);
    return ask.IsAccepted && ask.Content!.Approve ? $"{service} deployed" : $"{service} NOT deployed ({ask.Action})";
}
```

A manual poll sees the status change, answers with `tasks/update` keyed by the
request key, and keeps polling (wire, abbreviated):

```text
<-- tasks/get {"result":{"status":"input_required","inputRequests":{"808e235d74b140a89060319db0a5080a":{"method":"elicitation/create","params":{"mode":"form","message":"Deploy billing to production?","requestedSchema":{"type":"object","properties":{"approve":{"type":"boolean"}}}}}},...}}
--> tasks/update {"params":{"taskId":"4012f347...","inputResponses":{"808e235d74b140a89060319db0a5080a":{"action":"accept","content":{"approve":true}}}},...}
<-- {"result":{"resultType":"complete"},...}                      (empty acknowledgement)
<-- tasks/get {"result":{"status":"completed","result":{"content":[{"type":"text","text":"billing deployed"}]}}}
```

`CallToolWithPollingAsync` does this when the client registered
`McpClientOptions.Handlers.ElicitationHandler` (measured: `search deployed`). The key is unique for the life of the task and the client deduplicates keys
across polls. Per the SDK docs (not run), sampling works the same way and
`roots/list` is not dispatched by the client yet. Elicitation itself is in the
concept "MCP Multi Round-Trip Requests and Elicitation".

### Cancellation is cooperative

`tasks/cancel` returns an empty acknowledgement and fires the tool's
`CancellationToken`. Cancelling `build_report` after 1.5 s:

```text
after cancel +500 ms: cancelled        (same at +1000 and +1500 ms)
cancel on an already cancelled task: ack ok, state: cancelled
```

The server log has `run #7 started` and no `finished`: the `Task.Delay(…, ct)` was
interrupted. A tool that ignores `ct` keeps running (not run), and the spec allows the final
status to be something other than `cancelled`. Do not use `notifications/cancelled`
for tasks.

### Failed versus completed with isError

```text
explode:          completed result={"content":[{"type":"text","text":"An error occurred invoking 'explode'."}],"isError":true}
explode_protocol: failed error={"code":-32602,"message":"bad request detected late"}
  CallToolWithPollingAsync threw McpException: Task '...' failed: {"code":-32602,...}
```

An ordinary exception is a `completed` task with `isError: true` (same text rule as
the synchronous path, and `CallToolWithPollingAsync` returns it normally). Only a
JSON-RPC error (`McpProtocolException`) makes the task `failed`, and then the helper throws.

### TTL and server restart: the in-memory store forgets

`InMemoryMcpTaskStore.DefaultTimeToLive` (null by default) shows up as `ttlMs` in
the handle (`"ttlMs":5000`). The TTL counts from creation, not from completion. With a
5 s TTL, polling once a second:

```text
build_report (6 s):   +1.0s..+4.0s working,   +5.0s Unknown task   (the tool still ran to "finished")
nightly_export (2 s): +2.0s..+4.0s completed, +5.0s Unknown task
```

Without a TTL the store keeps every task until the process exits, and a restart
loses them all ("not persisted across process restarts", per the docs):

```text
started 70c364f934f74a268d809931434013df; process exits now      (client process 1)
resumed 70c364f9...: working                                      (a brand new client process, same server)
(server killed)    HttpRequestException: Connection refused (127.0.0.1:5940)
(server restarted) resumed 70c364f9...: McpProtocolException: Unknown task: '70c364f9...'
```

The handle survives a client restart (if the client stored the id) but not a server
restart. For production implement `IMcpTaskStore` over a database or cache
(`CreateTaskAsync` durable before it returns, idempotent terminal transitions,
`ResolveInputRequestsAsync` raising `InputResponseReceived`; docs only, no custom
store was written here). A tool body running in a dead process is gone whatever the
store, so the work must be resumable or safe to rerun.

### Idempotency is still your job

The handle makes the result durable, not the call unique. Same arguments twice:

```text
same arguments twice: ids differ = True, t1 ran as run #8, t2 as run #9
```

Two ids, two executions. A client that lost the `CreateTaskResult` (the one response
still on a single request) retries and starts a second job, so put an idempotency
key in the tool arguments and dedupe in the tool (see the concept "Transactional
Outbox, Inbox and Idempotent Consumers").

### Book vs today and what the SDK does not do yet

The experimental Tasks of spec 2025-11-25 (SDK 1.3 and 1.4) had `tasks/list`, a
blocking `tasks/result` and a per-tool `taskSupport`; all gone, and v1 and v2 peers
do not interoperate (each sees an ordinary result). Per the SDK docs,
`notifications/tasks` is not implemented in 2.4.0, so polling is the only way, and
a tool cannot start inline and promote itself to a task midway. The spec says the
extension is meant to join the core protocol once it stabilizes.

## Trade-offs

- **Polling vs a held connection.** Polling costs a request per interval and up to
  one interval of latency, but needs no long-lived stream and survives proxies.
  `pollIntervalMs` is a hint the server may rate-limit.
- **Optional vs Required.** `Optional` degrades to blocking for old clients, hiding the
  timeout problem; `Required` fails fast with `-32021`. A 20 minute export should be `Required`.
- **In-memory store vs your own.** `InMemoryMcpTaskStore` is for development and tests;
  anything customers wait on needs a durable store and a cleanup policy.
- **TTL.** Too short and a slow job's result is discarded before the client collects
  it (the 6 s job with a 5 s TTL); too long or null and the store grows.
- **Task id as a capability.** With no `tasks/list` and no sessions the id is the only
  handle (the SDK's are random 32 hex digits); bind it to the caller in a custom store.

## Documentation Links

- [Tasks extension overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/tasks/overview) (doc)
- [SEP-2663: Tasks Extension, modelcontextprotocol.io](https://modelcontextprotocol.io/seps/2663-tasks-extension) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Tasks guide in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/tasks/tasks.md) (doc)
- [MCP C# SDK 2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
