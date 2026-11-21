---
version: 1.0
updatedAt: 2026-11-21
---
## Objective

Two official MCP extensions put more than text in front of the user. MCP Apps (`io.modelcontextprotocol/ui`) lets a tool
point at an HTML page (`ui://` resource) that the host renders in a sandboxed iframe next to the conversation. Skills
(`io.modelcontextprotocol/skills`) lets a server publish Agent Skills (a `SKILL.md` plus files) that a host can discover
and load. The backlog said "only when they stabilize", so this lesson checks the state today in the source and measures
the C# packages without a host: the server, the client, the JSON-RPC on the wire, negotiation, where the CSP travels,
the new case-sensitive property names, and Skills integrity checks. What needs a real host (iframe, `postMessage`, the
`ui/` methods) is docs only. Versions: `ModelContextProtocol`, `ModelContextProtocol.AspNetCore`,
`ModelContextProtocol.Extensions.Apps` and `ModelContextProtocol.Extensions.Skills` 2.4.0 (newest on NuGet on 2026-11-21;
2.3.0 for the case comparison), spec 2026-07-28, ext-apps spec 2026-01-26, TFM `net10.0` with SDK 10.0.100 and `net11.0`
with SDK 11.0.100 (runtime 11.0.0), Apple M4 Max (no timings taken).

## Use Cases

- A tool whose answer is better as a dashboard, form or chart than as text, in hosts that render MCP Apps.
- Shipping the workflow instructions (a restock policy, a review checklist) with the server that owns the data.
- Deciding whether to build on these packages now, given their stability marks.
- Serving hosts that do and do not support the extension from one server.

## Deep Dive

### The real state today (what the backlog got wrong)

| Piece | State in the source on 2026-11-21 |
| --- | --- |
| MCP Apps protocol | Stable: the ext-apps spec 2026-01-26 says `Status: Stable`, and the extensions overview lists "MCP Apps: Stable" |
| `ModelContextProtocol.Extensions.Apps` | Version 2.4.0, a normal (not prerelease) version since 2.0.0 (2026-07-28), but every public type is `[Experimental("MCPEXP003")]` |
| Skills protocol | Beta ("Beta, destination not yet stated"); SEP-2640 is Final, the extension specification is `specification/beta/skills.mdx` |
| `ModelContextProtocol.Extensions.Skills` | Exists only as 2.4.0 (2026-11-07), every public API `[Experimental("MCPEXP005")]`, depends on `ModelContextProtocol [2.4.0]` (exact) |

Corrections: the backlog's "Apps v2.0.0" is only its first non-preview version (2.0.0-preview.1 on 2026-06-26 had it
already, 2.0.0 on 2026-07-28); the current one is 2.4.0. The 2.0.0 notes removed `[Experimental]` from Tasks and MRTR but
not from Apps. So "stable" is true of the protocol and false of the C# API: using either package without suppressing
the diagnostic does not compile.

```text
Program.cs(4,16): error MCPEXP003: 'ModelContextProtocol.Extensions.Apps.McpUiToolMeta' is for evaluation purposes only and is subject to change or removal in future updates. Suppress this diagnostic to proceed. (https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md#mcpexp003)
Program.cs(6,11): error MCPEXP005: 'ModelContextProtocol.Extensions.Skills.McpServerSkillPackage' is for evaluation purposes only ...
```

Both are errors, not warnings. Suppress only in the project that uses them (`<NoWarn>$(NoWarn);MCPEXP003;MCPEXP005</NoWarn>`).
The SDK's own page says the diagnostic lets you "avoid accidentally depending on experimental features" and advises
against using these APIs "in production scenarios". Under the extension lifecycle (SEP-3392) a Beta extension may change, "with breaking changes
expected to be rare"; Stable changes only with a new core protocol revision. Extensions are "always disabled by default".
Negotiation and the other extensions are in [MCP Authorization Extensions](/dotnet-ai-concepts/mcp-authorization-extensions)
and [MCP Tasks Extension](/dotnet-ai-concepts/mcp-tasks-extension-for-long-running-tools); basics in
[MCP Servers and Clients with the C# SDK](/dotnet-ai-concepts/mcp-servers-and-clients-with-the-csharp-sdk).

### The lab: one server, tools with `_meta.ui`, a `ui://` resource

```csharp
builder.Services.AddMcpServer(o => o.ServerInfo = new() { Name = "inventory-app", Version = "1.0.0" })
    .WithHttpTransport()                              // stateless by default
    .WithTools<InventoryTools>().WithResources<InventoryResources>()
    .WithMcpApps()                                    // advertises the extension and applies [McpAppUi]
    .WithSkillsFromSubdirectories(Path.Combine(AppContext.BaseDirectory, "Skills"));

[McpServerTool(Name = "show_stock"), McpAppUi(ResourceUri = "ui://inventory/dashboard.html")]
public static string ShowStock(McpServer server, string sku)
{
    var ui = McpApps.GetUiCapability(server.ClientCapabilities);   // null when the client did not declare it
    return ui is null ? $"{sku}: 12 units (text only)" : $"{sku}: 12 units (UI, mimeTypes=[{string.Join(",", ui.MimeTypes ?? [])}])";
}
// refresh_stock:  [McpAppUi(ResourceUri = ..., Visibility = [McpUiToolVisibility.App])]    (button handler)
// stock_summary:  [McpAppUi(ResourceUri = ..., Visibility = [McpUiToolVisibility.Model])]
```

The resource uses the MIME type `McpApps.HtmlMimeType` (`text/html;profile=mcp-app`). The client declares the extension
as a `JsonObject` in `McpClientOptions.Capabilities.Extensions`; passing a typed `McpUiClientCapabilities` there threw
`NotSupportedException: JsonTypeInfo metadata for type 'McpUiClientCapabilities' was not provided`, so serialize it
with `McpApps.SerializerOptions` first.

### On the wire: the server announces, the client declares per request

With the 2026-07-28 protocol there is no handshake. The server announces the extension in `server/discover`, the client
declares it in the `_meta` of every request (abbreviated):

```text
--> server/discover  {"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}}
<-- {"capabilities":{"resources":{},"tools":{},"extensions":{"io.modelcontextprotocol/skills":{},"io.modelcontextprotocol/ui":{}}},"ttlMs":0,"cacheScope":"private","resultType":"complete",...}
<-- tools/list: {"name":"show_stock",...,"_meta":{"ui":{"resourceUri":"ui://inventory/dashboard.html"}}},
                {"name":"refresh_stock",...,"_meta":{"ui":{"resourceUri":"ui://inventory/dashboard.html","visibility":["app"]}}},
                {"name":"plain_tool",...}      (no _meta)
<-- resources/list: {"name":"inventory_dashboard","uri":"ui://inventory/dashboard.html","mimeType":"text/html;profile=mcp-app","_meta":{"ui":{"prefersBorder":true}}}
```

What a client without the extension sees, measured:

| Case | Result |
| --- | --- |
| Default client, no declaration | `server/discover` still lists `io.modelcontextprotocol/ui`; `tools/list` and `resources/list` carry the same `_meta.ui`; `show_stock` returns `12 units (client did not declare MCP Apps, text only)` |
| Client declares the extension | same listings; `show_stock` returns `... mimeTypes=[text/html;profile=mcp-app]` |
| Server without `.WithMcpApps()` | no extension in `capabilities`, no `_meta` on any tool: `[McpAppUi]` is ignored silently |
| Client pinned to 2025-11-25, stateless server | `initialize` carried the declaration, but `show_stock` still answered text only: each stateless POST is isolated |
| Same pinned client, `SessionMode = StatefulForInitializeClients` | `show_stock` sees `mimeTypes=[text/html;profile=mcp-app]` |

So the server does not hide anything from a client that did not declare the extension; only your own code decides
(`GetUiCapability`), and the extensions overview gives the same advice: "a server offering UI-enhanced tools should still return
meaningful text content". The spec's `initialize`-based form for older protocol versions only works where the server
keeps the session. Session modes: [MCP Servers and Clients with the C# SDK](/dotnet-ai-concepts/mcp-servers-and-clients-with-the-csharp-sdk).

### Where the CSP travels, and two traps in the 2.4.0 helpers

The spec puts the CSP, permissions and `prefersBorder` in `_meta.ui` of the resource content returned by
`resources/read` (`contents[0]._meta.ui`). Three measured facts:

```text
read ui://inventory/dashboard.html  -> contents[0]._meta = {"ui":{"csp":{"connectDomains":["https://api.example.com"],"baseUris":["https://cdn.example.com"]},"permissions":{"allow":["camera"]},"prefersBorder":true}}
list ui://inventory/sample-style.html -> _meta = {"ui":"{"csp":{"connectDomains":[...]},"prefersBorder":true}"}
read ui://inventory/sample-style.html -> no _meta at all
```

1. `[McpMeta("ui", """{...}""")]`, the form used by the `WeatherAppServer` sample in the 2.4.0 repository, stores the JSON
   as a string (note the `"`), and `[McpMeta]` is not copied into `resources/read` (its own doc says so). The
   object form is `[McpMeta("ui", JsonValue = """{...}""")]` for the listing, and the CSP must be built on the returned
   `TextResourceContents.Meta`, as the first line does with `McpUiResourceMeta` and `McpApps.SerializerOptions`.
2. The typed classes do not match the spec 2026-01-26 keys: `McpUiResourceCsp.BaseUris` serializes as `baseUris` (spec:
   `baseUriDomains`) and `McpUiResourcePermissions.Allow` as `{"allow":["camera"]}` (spec: `{"camera":{}}`). A host that
   follows the spec ignores both. Write those two keys as raw JSON until the SDK catches up.

### Visibility is the host's job, and the case-sensitive names

`visibility: ["app"]` hides a tool from the model, but the C# server still returns `refresh_stock` in `tools/list` to
every client (wire above). The spec puts the filtering on the host ("MUST NOT include tools in the agent's tool list")
and on `tools/call` from the app ("MUST reject" tools without `app`). A non-Apps client calling an app-only tool is not
blocked by the SDK, so keep such tools harmless and authorized like any other (see
[MCP Security](/dotnet-ai-concepts/mcp-security-tool-poisoning-confused-deputy-and-least-privilege)).

2.4.0 ("Match protocol property names case-sensitively", #1934) changed `McpApps.SerializerOptions`. The same program
against 2.3.0 and 2.4.0:

| Input | 2.3.0 | 2.4.0 |
| --- | --- | --- |
| `McpUiToolMeta` `{"ResourceUri":"ui://x/y.html"}` | `ResourceUri = ui://x/y.html` | `(null)` |
| `McpUiToolMeta` `{"RESOURCEURI":...}` | bound | `(null)` |
| both spellings, wrong first or last | the last one wins | the canonical `resourceUri` wins |
| `McpUiClientCapabilities` `{"MimeTypes":[...]}` | bound | `MimeTypes = (null)` |
| `GetUiCapability` with `{"MimeTypes":[...]}` | capability, `MimeTypes=(null)` | same (it was already case-sensitive) |
| core `Tool` `{"Name":...}` with `McpJsonUtilities.DefaultOptions` | bound | bound (unchanged) |

Over the wire, a raw request declaring `"MimeTypes"` made `show_stock` report `client declared MCP Apps, mimeTypes=[]`:
the capability exists, the list is empty, and a server that requires `text/html;profile=mcp-app` would fall back to
text. Impact: code that deserialized hand-cased or PascalCase JSON through `McpApps.SerializerOptions` silently gets
nulls, with no exception. Serialize and read with the correct camelCase and no one notices.

### Skills: list, get, verified reads

`WithSkillsFromSubdirectories` turns each folder with a `SKILL.md` into a skill (the sample layout of the Agent Skills
spec). The client side:

```csharp
if (!client.ServerCapabilities.SupportsSkills()) return;            // declared in server/discover
foreach (var s in await client.ListSkillsAsync()) { /* s.Uri, s.Frontmatter, s.Resources.Entries */ }
Skill skill = await client.GetSkillAsync("skill://inventory-restock/SKILL.md");
ReadResourceResult md = await client.ReadSkillResourceAsync(skill, skill.Uri);   // checks size and SHA-256
```

```text
skill skill://inventory-restock/SKILL.md frontmatter={"name":"inventory-restock","description":"Plan a restock for a SKU using the warehouse policy."} files=SKILL.md:194B,references/policy.md:82B
skill skill://stock-report/SKILL.md ... files=SKILL.md:160B
<-- skills/list  {"skills":[{"uri":"skill://inventory-restock/SKILL.md","frontmatter":{...},"resources":[{"uri":"skill://inventory-restock/SKILL.md","digest":"sha256:d62178b3...2593","size":194},{"uri":".../references/policy.md","digest":"sha256:09540...3791","size":82}]}],"resultType":"complete","ttlMs":0,"cacheScope":"private"}
<-- skills/get   {"error":{"code":-32602,"message":"No skill is served at 'skill://nope/SKILL.md'."}}
unlisted file: InvalidDataException: 'skill://inventory-restock/not-in-manifest.md' is not listed in the manifest ... refresh the entry with skills/get before reading it.
```

The files are ordinary resources: `resources/list` also showed the three `skill://` files next to the `ui://` ones, so
a client that lists resources sees them without the extension. The integrity rule is on the host: it must verify each
file against the manifest. A server whose entry promised one digest and served other bytes (same size, `# Harmless`
turned into `# Harmful!`):

```text
plain resources/read, bytes served: 64 (no check at all)
verified read: InvalidDataException: The content of 'skill://tampered/SKILL.md' has digest 'sha256:d519...18b3', but its manifest entry declares 'sha256:3c1b...667d'.
```

With a different size the message is `is 99 bytes, but its manifest entry declares 64 bytes`. The check only exists if the
host calls `ReadSkillResourceAsync` (or `SkillVerifier`); `ReadResourceAsync` reads the tampered bytes. The spec and SDK
docs add that digests are unsigned and come from the same server (consistency, not trust), that persisted approval must
bind to the manifest, that frontmatter such as `allowed-tools` must not widen permissions for MCP-origin skills without
approval, and that skill text is a prompt-injection surface (see the poisoning lesson linked above). Not implemented in
the package: `resources/directory/read`.

### Docs only: what a host does

None of this was run with a host. The spec describes the flow: the host preloads the `ui://` resource named in
`_meta.ui.resourceUri`, renders it in a sandboxed iframe (the recommended web design is a double iframe with a sandbox
proxy), builds the CSP from the declared domains (default `connect-src 'none'`, `default-src 'none'`, inline script and
style allowed, no `unsafe-eval`), and talks to the app through `postMessage` with a JSON-RPC dialect (`ui/initialize` and
other `ui/` methods; the app can call tools the host allows). `domain` asks for a stable sandbox origin and its format is
host-specific. Not measured here: rendering, `postMessage`, CSP enforcement, display modes, host theming variables.

### Who uses it (sources, 2026-11-21)

- Apps hosts: the MCP site lists Claude (web and Desktop), VS Code GitHub Copilot, Microsoft 365 Copilot, Goose,
  Postman and MCPJam; the community-maintained client matrix adds ChatGPT, Cursor, Archestra.AI, PostHog Code, Kiro Crew
  and Glean, and MCP Inspector as partial. VS Code's own page still labels it "Interactive results (Experimental)".
  The spec credits MCP-UI and OpenAI's Apps SDK (launched November 2025) as the origin, so ChatGPT-style widgets were
  the practice before the standard (book vs today: older posts describe `ui://` through `_meta["ui/resourceUri"]`,
  which the spec calls deprecated, use `_meta.ui.resourceUri`).
- Skills: the matrix marks MCPJam, Glean and the `mcpc` CLI as supporting it, and ChatGPT, fast-agent and MCP
  Inspector as partial; Claude Code is not marked. The overview says "SDK and host support is still being implemented".
  NuGet totals on 2026-11-21 (CI restores included): 144,868 downloads for Apps, 1,940 for Skills.
- Servers: the repository ships `WeatherAppServer`, `SkillsServer` and `SkillsClient`; ext-apps ships examples in
  TypeScript (maps, PDF viewer, dashboards). No .NET third-party Apps server was checked.

### net10.0 against net11.0

`apps`, `apps ui`, the raw request and `skills` runs were repeated on `net11.0` (SDK 11.0.100, runtime 11.0.0): the output
was byte-identical to `net10.0`, and the packages restore from their `net10.0` assets.

## Trade-offs

- **Stable protocol, experimental package.** Build on Apps only if you can absorb API breaks and keep the diagnostic
  suppression local; keep the raw JSON (`_meta.ui`) as the contract, it is what hosts read. Skills is Beta in both
  places and its package has a single release, pinned to exactly `ModelContextProtocol 2.4.0`.
- **Always keep a text answer.** Most clients have no iframe; `GetUiCapability` plus text content is the whole fallback.
- **Do not trust the typed CSP helpers blindly.** Check `baseUriDomains` and `permissions` against the spec, and put the
  CSP in the `resources/read` contents.
- **A UI is code that runs next to the user.** The sandbox and CSP protect the host, not your data: declare the fewest
  `connectDomains`, and authorize app-only tools as callable by anyone.
- **Skills are instructions, not code, but they steer a model.** Verify with `ReadSkillResourceAsync`, bind approvals to
  the manifest, tag the origin server, and skip skills with `"dynamic"` resources when you cannot verify them.
- **Case matters now.** Upgrading to 2.4.0 can turn PascalCase input into nulls silently; add a test that round-trips
  your `_meta.ui` JSON.

## Documentation Links

- [MCP Apps overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/apps/overview) (doc)
- [MCP Apps specification 2026-01-26 (SEP-1865), GitHub](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) (doc)
- [Skills over MCP overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/skills/overview) (doc)
- [Skills extension specification (beta), GitHub](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/beta/skills.mdx) (doc)
- [Extensions overview and stages, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/overview) (doc)
- [Extension support matrix, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/client-matrix) (doc)
- [SEP-3392: Extension Lifecycle, modelcontextprotocol.io](https://modelcontextprotocol.io/seps/3392-extension-lifecycle) (doc)
- [List of diagnostics (MCPEXP003, MCPEXP005), MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md) (doc)
- [MCP Apps in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/apps/apps.md) (doc)
- [MCP C# SDK 2.4.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.4.0) (doc)
- [Use MCP servers in VS Code, Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) (doc)
