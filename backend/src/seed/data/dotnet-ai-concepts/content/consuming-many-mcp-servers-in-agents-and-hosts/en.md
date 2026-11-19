---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

One MCP server per agent is the demo. A real host connects to several at once, and the problems are on the host side: two servers both ship a tool named `search`, three servers with 40 tools each put 12,000 tokens in front of the model on every call, a server dies in the middle of a conversation, `tools/list` is fetched again and again, and some tools should never run without a human. The earlier lessons cover the server, the client and the security threats; this one measures the host: a tool hub for N servers, built on `McpClient`, `McpClientTool` and an Agent Framework agent. No LLM is used: the model is a scripted `IChatClient` that records exactly what it receives, as in the agents lesson. The lab has one stdio server and two Streamable HTTP servers (40 tools each, `search` and `status` present in all three). Real host configuration files (VS Code, Copilot CLI, Claude Code) and the gateway pattern are docs only. Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.Agents.AI` 1.28.0 (the collision test also ran on 1.26.0), `Microsoft.Extensions.AI` 10.11.0, `Microsoft.ML.Tokenizers` 3.0.0 with `Microsoft.ML.Tokenizers.Data.O200kBase` 3.0.0, TFM `net10.0`, .NET SDK 10.0.100, spec 2026-07-28.

## Use Cases

- An internal assistant that needs tickets, a wiki and files, each owned by a different team.
- Choosing which of 120 tools an agent really gets, and what that costs per turn.
- Surviving a crashed or restarted MCP server without ending the conversation.
- Deciding which tool calls run alone and which wait for a person.

## Deep Dive

### What the agent receives from three servers

`ListToolsAsync()` returns `McpClientTool`s, which are `AIFunction`s, so the Agent Framework page "Using MCP tools with Agents" just spreads them into `tools:`. Three servers, 40 tools each:

```csharp
await using var files   = await McpClient.CreateAsync(new StdioClientTransport(new() { Name = "files", Command = "dotnet", Arguments = [dll, "stdio", "files"] }));
await using var tickets = await McpClient.CreateAsync(new HttpClientTransport(new() { Endpoint = new Uri("http://127.0.0.1:6421/mcp") }));
await using var wiki    = await McpClient.CreateAsync(new HttpClientTransport(new() { Endpoint = new Uri("http://127.0.0.1:6422/mcp") }));
List<McpClientTool> all = [.. await files.ListToolsAsync(), .. await tickets.ListToolsAsync(), .. await wiki.ListToolsAsync()];
AIAgent agent = model.AsAIAgent(instructions: "Use the tools.", tools: [.. all.Cast<AITool>()]);
```

Each client is created once and kept (`await using` disposes it at the end of the host, the Learn page says the same). The duplicates are `search`, `status` and two lab hooks, each x3, and the model's request is a flat list: nothing in `ChatOptions.Tools` says which server owns a tool.

### Name collisions: the agent throws, plain MEAI picks one

The scripted model asks for `search`:

```text
agent (Agent Framework 1.28.0): InvalidOperationException: Duplicate tool name 'search'. Tool names must be unique. (model requests: 0)
agent (Agent Framework 1.26.0): InvalidOperationException: Duplicate tool name 'search'. Tool names must be unique. (model requests: 0)
plain FunctionInvokingChatClient, files first: tool said: files matching refund  [120 tools sent]
plain FunctionInvokingChatClient, wiki first : tool said: wiki pages matching refund  [120 tools sent]
```

The agent fails before the first model call (the stack goes through `ApprovalRequirement.GetApprovalNotRequiredToolNames` in the agent's own pipeline), so the mistake is loud. Without the agent, `FunctionInvokingChatClient` accepts the list: the first function with that name wins, and which one that is depends on the order of your `Concat`. The three declarations are sent as they are, only the description differs (`Searches support tickets by text.` against `Searches the internal wiki.`), so a model that sees them cannot say which server it picked. How a real provider reacts to duplicate names was not measured here (it needs a real endpoint); do not rely on it.

### Fixing it: prefix, wrapper, allow-list

`McpClientTool.WithName` changes only the name the model sees; the XML docs say the server is still called with the original name. A `DelegatingAIFunction` does the same for any `AIFunction`:

```csharp
var prefixed = by.SelectMany(kv => kv.Value.Select(t => t.WithName($"{kv.Key}_{t.Name}")));
sealed class Renamed(AIFunction inner, string name) : DelegatingAIFunction(inner) { public override string Name => name; }
```

```text
duplicates left: 0 of 120     {"name":"tickets_search","description":"Searches support tickets by text.",...}
agent asks tickets_search: tool said: tickets matching refund  [120 tools sent]
agent asks wiki_search   : tool said: wiki pages matching refund  [120 tools sent]
server received tools/call: tickets 1, wiki 2
```

Each call reached the right server (the counters also include the earlier "wiki first" run, which is why the wiki shows two). The prefix also helps the model: `tickets_search` says what it searches. The allow-list is the third fix and the cheapest: keep `files:read_file`, `tickets:search`, `tickets:get_ticket`, `wiki:get_page` and the agent sees 4 tools (`read_file, search, get_ticket, get_page`), so there is nothing left to collide. Note that the allow-list is checked on `server:name`, not on the bare name. The spec's tool guide suggests the same prefix for aggregators and says `serverInfo.name` is not unique, so choose the prefix yourself instead of trusting the server.

### The context budget: tokens per tool, per turn

The tool definitions are resent with every model call, like the history. Counting what a provider adapter serializes (name, description, JSON Schema) with `TiktokenTokenizer.CreateForModel("gpt-4o")` (o200k; a different model tokenizes differently, so read it as an estimate, characters/4 is shown for comparison):

```text
server   tools  chars  tokens(o200k)  chars/4   tokens/tool
files       40  19789      4185       4947      104.6
tickets     40  19514      4155       4878      103.9
wiki        40  19282      4123       4820      103.1
all        120  59345     12584      14836      104.9
tool definitions resent on every model call: 1 call 12584, 10 calls 125840, 20 calls 251680
```

The tools are synthetic but realistic (a sentence of description, typed parameters with `[Description]`), about 105 tokens each; real servers vary a lot, and long descriptions cost more. Characters/4 overestimated by 18 percent here. Strategies, measured on the same 120 tools:

```text
strategy                                  tools  tokens  vs all
everything                                 120   12584  100.0%
read-only annotation only                   85    9449   75.1%
one server for the task (tickets)           40    4195   33.3%
allow-list for this agent                    4     190    1.5%
```

Filtering on `readOnlyHint` removes only 25 percent and trusts a hint a server controls (see the security lesson), so use it for convenience, not as a budget plan. A per-agent allow-list is the strong one. The fourth strategy is a "find tools" tool: the agent starts with one function and the tools it finds are added to `ChatOptions.Tools` for the rest of the run (`FunctionInvokingChatClient.CurrentContext` gives access to the live options):

```text
model call 1: tools [find_tools] = 61 tokens
model call 2: tools [find_tools, tickets_close_ticket] = 114 tokens
model call 3: tools [find_tools, tickets_close_ticket] = 114 tokens
second agent run, first model call sees: [find_tools]
```

Instead of 12,584 tokens per call, 61 then 114. The cost is an extra model round trip, a model that must ask well (keyword matching in the lab; a real one would use embeddings, see the vector search lesson), and the same list in a fresh run, since the added tools lived only in that run's options. Claude Code does this natively: its MCP docs say tool search defers tool definitions so only names and server instructions load at the start (docs only). `Mcp-Name` is not a budget tool: it is an HTTP header that mirrors the called tool for routers and WAFs (see the tools lesson).

### A server dies mid-conversation

The lab killed the tickets HTTP process (`Process.Kill`) and, separately, made the stdio server exit during a call. First what an agent built on plain `McpClientTool`s sees:

```text
http alive      : saw: tickets matching a
http killed     : saw: EXCEPTION HttpRequestException: Connection refused (127.0.0.1:6421); call 2 still advertises 40 tickets tools
http restarted  : saw: tickets matching a          (same client, new process)
stdio crash call: saw: bye              (the process exited 100 ms after answering)
files.Completion: StdioClientCompletionDetails, Exception=IOException: MCP server process exited unexpectedly
stdio after exit: saw: EXCEPTION IOException: MCP server process exited unexpectedly
```

The agent did not crash: `FunctionInvokingChatClient` turns the exception into a `FunctionResultContent` with `Exception` set (the default does not rethrow), so the model sees a failure and the 40 dead tools stay in its list, inviting retries. An HTTP client in stateless mode recovered by itself when the server came back, because every request is independent; a stdio client does not: `McpClient.Completion` completes with the exit details and every later call throws. The degradation strategy of the hub (code below) wraps each tool: on `HttpRequestException`, `IOException` or a completed `Completion` it marks the server down, removes its tools from the live options and returns text the model can use:

```text
  [hub] tickets: down (HttpRequestException), tools removed
model call 1: 40 tickets tools, 40 files tools
model call 2: 0 tickets tools, 40 files tools
tool results the model saw: The 'tickets' server is unavailable. Its tools were removed from this conversation; use another source. || contents of policy.txt
next run offers: 0 tickets tools
reconnect: True, next run offers 40 tickets tools
```

The conversation continued with the files server, and reconnecting was a dispose plus a new `McpClient.CreateAsync` (`ReconnectAsync`). Claude Code documents its own policy (docs only): a dropped remote server is retried up to five times with exponential backoff starting at one second, and a stdio server that exits is marked failed until you reconnect it.

### tools/list: the SDK does not cache, a hub can

The previous lessons measured `ttlMs` and `cacheScope` on the wire. The 2.4.0 client reads them (`ListToolsResult.TimeToLive`) but does not act on them: five `ListToolsAsync()` calls sent five `tools/list` requests. The hub caches per server, following the spec (fresh while `now < received + ttlMs`; `ttlMs` 0 or absent means stale; a notification invalidates):

```csharp
public async Task<List<McpClientTool>> ToolsAsync(S s)
{
    if (!s.Stale && Now() < s.Expires) return s.Tools;             // fresh: no request
    var found = new List<Tool>(); string? cursor = null; TimeSpan? ttl = null;
    do { var r = await s.Client!.ListToolsAsync(new ListToolsRequestParams { Cursor = cursor });
         found.AddRange(r.Tools); ttl = r.TimeToLive; cursor = r.NextCursor; } while (cursor is not null);
    s.Stale = false; s.Tools = [.. found.Select(t => new McpClientTool(s.Client!, t))];
    s.Expires = ttl is { } t0 && t0 > TimeSpan.Zero ? Now() + t0 : DateTimeOffset.MinValue;
    ...   // then the pin check of the security lesson
}
// on connect: client.RegisterNotificationHandler(NotificationMethods.ToolListChangedNotification, (_, _) => { s.Stale = true; ... });
```

The tickets server kept the default `ttlMs: 0`; the wiki server added `ListToolsResult.TimeToLive = 2 s` in an `AddListToolsFilter`:

```text
tickets ttl=0  wiki ttl=2000
5 VisibleAsync calls: tools/list sent tickets +5 (ttl 0), wiki +0 (ttl 2000)
raw ListToolsAsync x5: tools/list sent +5
after 2.2 s: wiki tools/list +1 (ttl expired)
server rewrote 'search' silently; hub within ttl still says: 'Searches the internal wiki.' (+0 requests)
  [hub] wiki: tools/list pin 1B61B9C29D24 != approved E25724BCAE93: tools hidden until re-approved
after ttl: description now 'Searches the internal wiki. (v2)', quarantined=True, wiki tools offered=0
```

The cache saves the 40-tool list (about 20 KB) on every turn, and its price is staleness: a silent change inside the TTL is invisible, which the spec accepts ("a freshness hint, not a guarantee"). The pin from the security lesson turned the change into a quarantine instead of an unreviewed update; `Approve("wiki")` re-pinned and the 40 tools came back. With `list_changed` the server can tell you sooner: a lab tool rewrote a description and sent the notification, `Stale` became true within 300 ms, and the next `VisibleAsync()` inside the TTL fetched at once (`tools/list +1`) and quarantined again. So `ttlMs` is the fallback and `list_changed` the fast path. `cacheScope: "private"` (the default) means the copy must not cross authorization contexts: keep one cache per user token, not one per process, when your host serves several users.

### Approval by policy and limits on the loop

`ApprovalRequiredAIFunction` (namespace `Microsoft.Extensions.AI`; the agents lesson used it) wraps any `AIFunction`. The hub takes a wrap callback, and the policy reads each tool's annotation:

```csharp
AIFunction Policy(McpClientTool t, AIFunction f) =>
    t.ProtocolTool.Annotations?.ReadOnlyHint == true ? f : new ApprovalRequiredAIFunction(f);   // no annotation = ask
var tools = await hub.VisibleAsync(wrap: Policy);
```

```text
80 tools: 56 auto, 24 need approval
  tickets_get_ticket     auto
  tickets_create_ticket  approval
  tickets_close_ticket   approval
  wiki_delete_page       approval
  wiki_legacy_sync       approval        (no annotations at all)
run 1: model calls=1, approval request for tickets_close_ticket, server tools/call +0
run 2 (approved): model calls=2, server tools/call +1, text='ok'
```

The unannotated `wiki_legacy_sync` needs approval, matching the spec defaults (an unannotated tool is destructive and open-world). The run stops with a `ToolApprovalRequestContent` before anything reaches the server (`tools/call +0`) and `req.CreateResponse(true)` in a second run on the same session executes it. This is the policy "readOnly runs, the rest asks", and it is only as honest as the server: the tools lesson showed a server that declares `readOnlyHint` and mutates state, so for servers you do not own, approve everything or pin the annotations in the host's own allow-list instead of reading them from the wire. The Agent Framework approval page also documents `UseToolApproval` rules kept in the session (docs only here). A last limit is the loop itself: `FunctionInvokingChatClient.MaximumIterationsPerRequest = 3` stopped a model that asked for `tickets_status` forever after 4 model calls and 3 server calls. Add a token or turn budget per user in the host as well.

### How real hosts configure many servers (docs only)

Not run here, and nothing in the machine's own configuration was touched. Read from the vendors' pages on 2026-11-19:

| Host | File and scope | Notes |
| --- | --- | --- |
| VS Code, Copilot harness | `.mcp.json` at the workspace root, or `~/.copilot/mcp-config.json` (user, shared with Copilot CLI), top-level `mcpServers` | the workspace-root file rejects `${...}` expressions; `inputs` and `envFile` are editor-only fields |
| VS Code, Local harness (deprecated, removal announced for February 2027) | `.vscode/mcp.json` or the profile `mcp.json`, top-level `servers`, optional `inputs` with `${input:id}` | `"env": {"API_KEY": "${input:perplexity-key}"}` prompts once and hides the value |
| Copilot CLI | `~/.copilot/mcp-config.json`, `copilot mcp add NAME -- COMMAND ARGS` | same `mcpServers` format |
| Claude Code | `local` (default, private, in `~/.claude.json` per project), `project` (`.mcp.json`, shared, needs approval) and `user` (`~/.claude.json`, all projects) | the same name in several scopes connects once, highest precedence wins, entries are not merged; `${VAR}` and `${VAR:-default}` expand in `.mcp.json` |
| Claude Desktop | `claude_desktop_config.json` under `~/Library/Application Support/Claude/` (macOS) | `mcpServers` with `command` and `args` |

Two notes. The VS Code reference now calls `.vscode/mcp.json` and the profile `mcp.json` the format of the deprecated Local harness and points new setups at the `mcpServers` files, so an older tutorial may describe the deprecated format (book versus today). And a shared project file is an attack surface: every teammate's host will start whatever command it lists, which is why Claude Code asks for approval and VS Code shows a trust prompt.

### The gateway pattern

A gateway is one MCP server in front of several, so a host has one entry in its configuration. The lab built one with the SDK: it connects to tickets and wiki as a client and re-exposes each tool under a prefix.

```text
gateway tools=80 tokens=8376
tickets_close_ticket annotations through gateway: destructive=True readOnly=False
call via gateway: tickets matching refund; backend tools/call +1
```

It works in about a dozen lines, and it also shows the cost: the host still sees 80 tools and 8,376 tokens (the gateway does not shrink the context by itself), and it copies annotations from the backends, so a poisoned backend description now arrives with the gateway's name on it. What a gateway can add is the policy in one place: allow-lists, token exchange to the backends, audit and rate limits (docs only: API gateways such as YARP or Azure API Management). Do not ship the lab's dozen lines; they pass requests without any identity handling.

### Problem map

| Problem | Symptom (measured) | Mitigation |
| --- | --- | --- |
| Same tool name on two servers | agent: `Duplicate tool name 'search'` before the first call; plain MEAI: the first in the list silently wins | `WithName` prefix or `DelegatingAIFunction`; allow-list on `server:name` |
| Context bloat | 120 tools = 12,584 tokens per model call | per-agent allow-list (1.5 percent), one server per task, a find-tools tool |
| Server down in a conversation | exception inside `FunctionResultContent`, dead tools stay listed, stdio never recovers | wrap tools, remove them from the live options, tell the model, reconnect with a new `McpClient` |
| Repeated `tools/list` | 5 calls, 5 requests (SDK has no cache) | cache by `ttlMs`, invalidate on `list_changed` |
| Definition change inside the TTL | stale description for up to `ttlMs` | pin the hash, quarantine on mismatch, keep TTLs short |
| Dangerous tool runs alone | `delete` tools execute from one model reply | `ApprovalRequiredAIFunction` by policy, ask when the annotation is missing |
| Runaway loop | model repeats a call | `MaximumIterationsPerRequest`, token budget |

## Trade-offs

- **Prefix by server vs short names.** `tickets_search` removes the collision and tells the model the scope, at the price of a few tokens per tool and names that differ from the server's documentation; keep the prefix in the host and the server unchanged.
- **Allow-list vs convenience.** A small list is cheapest and safest, but every new server tool needs a decision. A find-tools tool keeps the catalog reachable at the cost of one more model round trip.
- **Cache vs freshness.** Honoring `ttlMs` saves requests on every turn; a long TTL hides a rug pull (the 2 s TTL hid a rewrite until it expired). Pair it with `list_changed` and the pin.
- **Per-call approval vs flow.** Approving every write is safe and tiring; auto-approving `readOnlyHint` is smooth and trusts the server's word. Decide per server trust level.
- **Gateway vs direct.** One entry and one policy point, but a new component to run, secure and scale, and it can hide which backend a tool came from.
- **Own hub vs the host's built-in.** Hosts like VS Code and Claude Code already do tool search, trust prompts and reconnection; write your own hub only when you embed agents in your own product.

## Documentation Links

- [Using MCP tools with Agents, Microsoft Agent Framework, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools) (doc)
- [Tool approval, Microsoft Agent Framework, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval) (doc)
- [Get started with .NET AI and the Model Context Protocol, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/get-started-mcp) (doc)
- [Caching, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) (doc)
- [Tools, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
- [Use MCP servers in VS Code, Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) (doc)
- [MCP configuration reference, Visual Studio Code](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) (doc)
- [Adding MCP servers for Copilot CLI, GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) (doc)
- [Connect Claude Code to tools via MCP, Claude Code Docs](https://code.claude.com/docs/en/mcp) (doc)
- [Connect to local MCP servers, modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/connect-local-servers) (doc)
