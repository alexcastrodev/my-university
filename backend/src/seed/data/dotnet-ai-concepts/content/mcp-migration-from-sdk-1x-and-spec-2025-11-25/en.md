---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Moving a C# MCP server or client from SDK 1.x to 2.x is two migrations at once: a
source migration (a handful of compile errors, mostly Tasks) and a protocol
migration (the new default speaks spec 2026-07-28, stateless, with no handshake),
while some of your users still run clients that only speak 2025-11-25. This lesson
builds one server and one client against 1.4.2, upgrades them to 2.4.0 and shows the
real compiler output, compares the public API of both packages by reflection, then
measures every server x client pairing over stdio and HTTP: what is negotiated, what
still works and what changes without any compile error. No model is involved.
Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 1.4.2 (last
1.x, 2026-11-03) and 2.4.0 (2026-11-07), `ModelContextProtocol.Extensions.Tasks`
2.4.0, API comparison with `System.Reflection.MetadataLoadContext` 10.0.0, TFM
`net10.0`, SDK 10.0.100, spec 2025-11-25 against 2026-07-28.

## Use Cases

- A published server that other people run, upgraded without breaking their hosts.
- A client (an agent, a CI job) that talks to servers you do not control.
- Reading an old tutorial or the `dotnet new mcpserver` output and knowing what to change.
- Deciding when a legacy client allows you to drop the 2025-11-25 compatibility.

## Deep Dive

### What the compiler says: 1.4.2 to 2.4.0

The sample server and client use what 1.x projects use: stdio and HTTP transports,
a tool, `McpClient.CreateAsync`, `ServerInfo`, `RootsHandler`, `SamplingHandler`,
`SetLoggingLevelAsync`, `AsClientLoggerProvider`, and the experimental Tasks
(`TaskStore`, `TaskSupport`, `CallToolAsTaskAsync`). Against 1.4.2 it builds only
with `<NoWarn>MCPEXP001</NoWarn>`, because Tasks were experimental there. The same
source against 2.4.0, only the version changed:

```text
Server/Program.cs(13,36): error CS1061: 'McpServerOptions' does not contain a definition for 'TaskStore'
Server/Program.cs(13,52): error CS0246: The type or namespace name 'InMemoryMcpTaskStore' could not be found
Server/Program.cs(70,42): error CS0246: The type or namespace name 'TaskSupport' could not be found
Server/Program.cs(70,56): error CS0103: The name 'ToolTaskSupport' does not exist in the current context
Client/Program.cs(27,175): error CS1061: 'ServerCapabilities' does not contain a definition for 'Tasks'
Client/Program.cs(40,118): error CS0246: The type or namespace name 'McpTaskMetadata' could not be found
Client/Program.cs(40,26): error CS1061: 'McpClient' does not contain a definition for 'CallToolAsTaskAsync'
Client/Program.cs(41,29): error CS1061: 'McpClient' does not contain a definition for 'PollTaskUntilCompleteAsync'
Client/Program.cs(26,75): warning CS8602: Dereference of a possibly null reference.   (client.ServerInfo.Name)
```

Every error is Tasks. The rest compiled, with 17 `MCP9005` warnings (Roots, Sampling,
Logging, next sections). The whole fix is one package, one `using` and a different shape:

```csharp
// csproj: <PackageReference Include="ModelContextProtocol.Extensions.Tasks" Version="2.4.0" />
using ModelContextProtocol.Extensions.Tasks;
var store = new InMemoryMcpTaskStore();                       // was: options.TaskStore = new ...
builder.Services.AddMcpServer().WithHttpTransport().WithTools<LabTools>().WithTasks(store);
[McpServerTool(Name = "slow_report")]                          // was: TaskSupport = ToolTaskSupport.Optional
var r = await client.CallToolWithPollingAsync(new CallToolRequestParams { Name = "slow_report", Arguments = args });
bool tasks = client.ServerCapabilities.Extensions?.ContainsKey(TasksProtocol.ExtensionId) is true;
Console.WriteLine(client.ServerInfo?.Name ?? "(no serverInfo)");   // 2.3.0: nullable
```

After this the server and client built with 0 errors. The new Tasks are a different
protocol (no `tasks/list`, no `tasks/result`; details in the concept "MCP Tasks
Extension for Long-Running Tools"), so this is a rewrite of the call site, not a rename.

### IMcpClient and McpClientFactory: the backlog was wrong

Many 2.x migration guides list `IMcpClient` and `McpClientFactory` as removed in 2.0.
A one-line project with `IMcpClient c = await McpClientFactory.CreateAsync(...)`,
built against each version, says otherwise:

```text
0.4.0-preview.3   Build succeeded
0.5.0-preview.1 .. 2.4.0   CS0246 'IMcpClient' could not be found ; CS0103 'McpClientFactory' does not exist
qualified as ModelContextProtocol.Client.IMcpClient (1.4.2):  CS0234 ... does not exist in the namespace
```

They disappeared in 0.5.0-preview.1, so the 1.0 line never had them; code written
for 0.x breaks when it first meets 1.x, not 2.x. The 1.x and 2.x API is `McpClient`
(abstract class) and `McpClient.CreateAsync`; the same for `McpServer`.

### The public API, compared by reflection

A script loaded both `ModelContextProtocol.Core.dll` with `MetadataLoadContext` and
diffed types and members (public, declared; 1.4.2 against 2.4.0):

```text
types: 242 -> 243     removed 26 (all Tasks: McpTask, IMcpTaskStore, InMemoryMcpTaskStore, ToolExecution, ...)
                      added 27 (InputRequiredException, InputRequest/Response, DiscoverResult, CacheScope, MetaKeys, McpHeaderAttribute, ...)
                      newly [Obsolete] 27 (CreateMessageRequestParams, ListRootsRequestParams, LoggingLevel, SamplingMessage, ...)
members removed: McpClientOptions.TaskStore, SendTaskStatusNotifications, CallToolRequestParams.Task, CallToolResult.Task,
                 ClientCapabilities.Tasks, ServerCapabilities.Tasks, Tool.Execution, McpServerToolAttribute.TaskSupport
members added:   RequestParams.InputResponses/RequestState, Result.ResultType, McpServer.IsMrtrSupported,
                 McpClientOptions.DiscoverProbeTimeout/TimeProvider/InitializeMeta, ListToolsResult.TimeToLive/CacheScope,
                 HttpServerTransportOptions.SessionMode (ModelContextProtocol.AspNetCore)
ModelContextProtocol.dll and .AspNetCore.dll: no type removed
```

So nothing was renamed, only Tasks left Core and the rest is additive or
`[Obsolete]`. `McpClient.ServerInfo` has the same CLR type; the change is the nullable
annotation, which reflection does not show (release notes for 2.3.0).

### Deprecated, still compiling: MCP9005, MCP9006, MCP9007

SEP-2577 deprecates Roots, Sampling and Logging. 2.x keeps them for connections that
negotiate 2025-11-25 and marks them `[Obsolete]` with `MCP9005`:

```text
warning MCP9005: 'McpServer.RequestRootsAsync(...)' is obsolete: 'The Roots feature is deprecated as of specification version 2026-07-28 ...'
warning MCP9005: 'McpServer.SampleAsync(...)' / 'ClientCapabilities.Sampling' / 'McpClientHandlers.RootsHandler' / 'McpClient.SetLoggingLevelAsync(...)'
warning MCP9006: 'HttpServerTransportOptions.IdleTimeout' is obsolete: 'Stateful Streamable HTTP mode is a back-compat-only escape hatch ...'   (also MaxIdleSessionCount)
warning MCP9007: 'ClientOAuthOptions.AuthorizationRedirectDelegate' is obsolete: '... cannot provide the RFC 9207 issuer ...'
```

`MCP9006` appears on the stateful-only options (`IdleTimeout`, `MaxIdleSessionCount`,
`SessionMigrationHandler`, `EventStreamStore` and `PerSessionExecutionContext` are
`[Obsolete]` too, by the reflection diff), not on `Stateless`. `MCP9007` means moving to `ClientOAuthOptions.AuthorizationCallbackHandler`
(see the concept "MCP Authorization Flow: 401, Discovery and Token Validation").
Suppress `MCP9005` temporarily while old clients exist. Migrations are in the concept "MCP Multi Round-Trip Requests and Elicitation": tool
parameters instead of Roots, your own `IChatClient` instead of Sampling, stderr or
OpenTelemetry instead of Logging.

### The matrix: server x client, measured

Same tools in all runs. `Server` is 1.4.2 or 2.4.0, `Client` the same; "pin" is
`McpClientOptions.ProtocolVersion`. Results over stdio and over HTTP with each default:

| Server | Client | Negotiated | `get_stock` | What else |
| --- | --- | --- | --- | --- |
| 1.4.2 | 1.4.2 | 2025-11-25 | ok | roots, sampling, logging, 1.x tasks all work |
| 1.4.2 | 2.4.0 | 2025-11-25 in 73 to 217 ms | ok | `server/discover` rejected fast, falls back; Roots, Sampling, Logging still work; `CallToolWithPollingAsync` is a plain blocking call |
| 1.4.2 | 2.4.0 pin 2026-07-28 | none | n/a | `McpException: The server does not support the requested protocol version` |
| 2.4.0 stdio | 1.4.2 | 2025-11-25 | ok | everything works except 1.x tasks |
| 2.4.0 stdio | 2.4.0 | 2026-07-28 | ok | no `logging` capability; `setLevel` fails; no session |
| 2.4.0 HTTP default | 1.4.2 | 2025-11-25, no session | ok | `who_am_i` sees no client name; roots and sampling fail |
| 2.4.0 HTTP default | 2.4.0 | 2026-07-28, no session | ok | `setLevel` is a 404 `-32601`; roots and sampling fail |
| 2.4.0 HTTP default | 2.4.0 pin 2025-11-25 | 2025-11-25, no session | ok | as the 1.4.2 client |
| 2.4.0 HTTP default | 1.4.2 pin 2026-07-28 | none | n/a | `McpProtocolException`: "not available through the initialize handshake" in 79 ms |
| 2.4.0 `Stateful` | 1.4.2 / 2.4.0 | 2025-11-25 with `Mcp-Session-Id` | ok | the 2.4.0 client is downgraded; everything works |
| 2.4.0 `StatefulForInitializeClients` | 1.4.2 | 2025-11-25 with session | ok | roots, sampling, logging work |
| 2.4.0 `StatefulForInitializeClients` | 2.4.0 | 2026-07-28, no session | ok | same limits as stateless |
| 2.4.0 `StatefulForInitializeClients` | 2.4.0 pin 2025-11-25 | 2025-11-25 with session | ok | roots, sampling, logging work |

The same pin test over stdio, a 1.4.2 client pinned to 2026-07-28 against a 2.4.0
server, failed after 5252 ms with the same error (cause not investigated; over HTTP it
took 79 ms). The 5 second `DiscoverProbeTimeout` is the cost of a server that does not
answer `server/discover` at all, measured in the concepts "MCP Servers and Clients with
the C# SDK" and "Testing MCP Servers in Process and with the Inspector". A 1.x server
answers it with an error right away, which is why the first rows connect fast.
A 1.4.2 tasks client against any 2.4.0 server throws `NullReferenceException` at
`CallToolAsTaskAsync` (the call site received a plain result), so v1 and v2 Tasks do not
interoperate, which the SDK notes say too.

### What changes and still compiles (the dangerous part)

All of these were measured with the same source and only the package version changed.

**HTTP default is now stateless.** 1.x served sessions by default (`Mcp-Session-Id`
minted, `who_am_i` saw `client=Client sampling=True roots=True`). 2.4.0 defaults to no
sessions; the same tools throw `InvalidOperationException: Roots are not supported in
stateless mode.` and `Sampling is not supported in stateless mode.`, which a client sees as
`IsError` with a generic text. A 1.x server with `Stateless = true` behaves the same, so the
fix is on the server: `Stateless = false` or `SessionMode =
HttpServerSessionMode.StatefulForInitializeClients` for the legacy clients, and
`InputRequiredException` for the new ones.

**Structured content.** `[McpServerTool(UseStructuredContent = true)]` on a method that
returns `int`: 1.4.2 sent `structuredContent: {"result":72}`; 2.4.0 sent `72` to a
2026-07-28 client, and still `{"result":72}` to a client pinned to 2025-11-25.

**Not-found resource.** The same missing URI is `-32002` (`ResourceNotFound`) for a
2025-11-25 client and `-32602` (`InvalidParams`) for a 2026-07-28 client, so a `catch`
on `McpErrorCode.ResourceNotFound` stops matching after the upgrade of the client alone.

**Tool order.** `tools/list` order is now the registration order (2.3.0); 1.4.2 listed
`who_am_i, answer, slow_report, ...` and 2.4.0 `get_stock, who_am_i, ask_roots, ...`.
Snapshot tests need re-approval.

**Logging.** `logging/setLevel` is gone on 2026-07-28: stdio gives `McpProtocolException`
("not available on protocol version '2026-07-28'"), HTTP a 404. `McpServer.AsClientLoggerProvider()`
still returned "logged", but the notification no longer reached the client over stateless HTTP.

**ServerInfo.** On 2026-07-28 `McpClient.ServerInfo` is `null` when the server omits the
optional identity (release notes 2.3.0, docs only; the compile signal is `CS8602`). Do not use
it for decisions, it is self-reported.

**Unchanged.** Cancellation by the client token worked the same in every combination: the
call stopped after 1.5 s and the server logged `WAIT cancelled` (HTTP).

### Migration order

1. **Inventory.** `grep` for `TaskStore`, `TaskSupport`, `RootsHandler`, `SamplingHandler`,
   `SetLoggingLevelAsync`, `AsClientLoggerProvider`, `ServerInfo`, `Stateless`, `IdleTimeout`,
   `AuthorizationRedirectDelegate`, and list which clients call your server.
2. **Pin.** Set `Version` exactly and, on clients, `ProtocolVersion = "2025-11-25"` if the
   servers they call are not upgraded.
3. **Upgrade the package** on the server first, then the clients that call it.
4. **Fix the compile errors** (Tasks) and read the warnings; leave `MCP9005` visible.
5. **Contract tests with both protocols:** one test client pinned to 2025-11-25 and one
   default, against the same server, asserting the table above for your tools
   (see "Testing MCP Servers in Process and with the Inspector").
6. **Choose the session mode** (`StatefulForInitializeClients` while legacy clients exist).
7. **Remove deprecated APIs**, then remove the pin and the compatibility mode when logs
   show no 2025-11-25 `initialize` for a release or two.

A legacy client in production keeps working against a 2.4.0 server only if the server
answers `initialize` for it: HTTP default does for tools, `StatefulForInitializeClients`
also for roots, sampling and logging. If that client cannot be upgraded and needs tasks, keep
it on a 1.x endpoint, because the two Tasks do not interoperate.

### The template still generates 1.x

NuGet lists `Microsoft.McpServer.ProjectTemplates` 1.2.1 as the latest, and its project
files reference `ModelContextProtocol` 1.2.0 and `ModelContextProtocol.AspNetCore` 1.2.0
(extracted from the package). A new server from `dotnet new mcpserver` therefore starts on
the 2025-11-25 line; bump both packages and run the build before publishing (see
"Packaging and Publishing an MCP Server").

### The change table

| Change | Symptom | Fix | Risk |
| --- | --- | --- | --- |
| Tasks moved to `Extensions.Tasks` | CS1061, CS0246 on `TaskStore`, `McpTaskMetadata`, `CallToolAsTaskAsync` | package, `WithTasks(store)`, `CallToolWithPollingAsync` | Low, loud |
| `IMcpClient`, `McpClientFactory` | CS0246, CS0103, CS0234 | `McpClient.CreateAsync` | None in 2.x (gone since 0.5) |
| Roots, Sampling, Logging | MCP9005 warnings | tool parameters, own `IChatClient`, stderr or OpenTelemetry | Medium, it is quiet |
| Stateless HTTP default | roots and sampling `IsError`, no session | `SessionMode` or `InputRequiredException` | High, no compile error |
| `ServerInfo` nullable | CS8602 | `ServerInfo?.Name ?? ...` | Low |
| Structured content `72` | clients reading `result` fail | read by the advertised schema | Medium |
| Not-found `-32602` | `catch` on `-32002` misses | handle both codes | Medium |
| Tool order | snapshot diff | re-approve | Low |
| Mixed Tasks versions | `NullReferenceException`, blocking call | one Tasks protocol per endpoint | High with legacy clients |
| `AuthorizationRedirectDelegate`, stateful options | MCP9007, MCP9006 | `AuthorizationCallbackHandler`, `SessionMode` | Low |

## Trade-offs

- **Upgrade now vs wait.** 2.x gets the fixes (2.3.1 and 1.4.2 both hardened sessions;
  1.4.2 is security-only), but a new default can break users before you notice. Upgrade
  the server first with a compatibility mode, then the clients.
- **Pinning a client.** `ProtocolVersion = "2025-11-25"` makes behavior predictable against
  old servers and keeps deprecated features, at the price of never using MRTR or Tasks.
- **Hybrid endpoint.** `StatefulForInitializeClients` serves both generations on one URL but
  needs sticky sessions for the legacy half; two endpoints are clearer but double the ops.
- **Suppressing MCP9005.** Fine as a dated, tracked decision; the spec allows removal after
  twelve months, so a suppression without an owner is a time bomb.

## Documentation Links

- [MCP C# SDK 2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [MCP C# SDK 2.3.0 release notes (ServerInfo nullable), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.3.0) (doc)
- [MCP C# SDK 1.4.2 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v1.4.2) (doc)
- [C# SDK versioning and breaking changes, csharp.sdk.modelcontextprotocol.io](https://csharp.sdk.modelcontextprotocol.io/versioning.html) (doc)
- [List of diagnostics (MCP9005, MCP9006, MCP9007), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Deprecated features, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/deprecated) (doc)
- [ModelContextProtocol package, NuGet](https://www.nuget.org/packages/ModelContextProtocol) (doc)
- [ModelContextProtocol.Extensions.Tasks package, NuGet](https://www.nuget.org/packages/ModelContextProtocol.Extensions.Tasks) (doc)
- [Create a minimal MCP server using C# and publish to NuGet, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/build-mcp-server) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
