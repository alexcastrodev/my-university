---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Tools are only one of the three things an MCP server offers. This lesson measures the rest on a real server with the
C# SDK: resources (text, binary, templates and the not-found error), prompts with arguments and rich content, argument
completions, cursor pagination, and the change and cache signals (`listChanged`, `ttlMs`, `cacheScope`,
`subscriptions/listen`). Every output below was captured from running code, with no model involved; what was only read
in docs is marked "docs only". Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0, TFM
`net10.0`, SDK 10.0.100, protocol 2026-07-28 (and 2025-11-25 where the two differ).

## Use Cases

- Exposing files, schemas or records as resources a host attaches as context.
- Shipping slash-command style prompt templates with autocompleted arguments.
- Serving a catalog bigger than one page of `tools/list`, `prompts/list` or `resources/list`.
- Telling clients how long a list stays fresh, and when it changed.

## Deep Dive

### Resources: URI, MIME type, text and binary

A resource is identified by a URI and read with `resources/read`. A fixed URI is a direct resource; a URI with
`{parameters}` is a template.

```csharp
[McpServerResourceType]   // registered with .WithResources<LabResources>()
public sealed class LabResources
{
    [McpServerResource(UriTemplate = "docs://readme", Name = "readme", MimeType = "text/markdown")]
    public static string Readme() => "# Orders API\n\nStart here.";
    [McpServerResource(UriTemplate = "logo://png", Name = "logo", MimeType = "image/png")]
    public static BlobResourceContents Logo() => BlobResourceContents.FromBytes(png, "logo://png", "image/png");
    [McpServerResource(UriTemplate = "orders://{orderId}", Name = "order", MimeType = "application/json")]
    public static string Order(int orderId) => ...;   // parameter bound from the URI
}
```

`resources/list` returned only the two fixed URIs and `resources/templates/list` only the templated ones, though all
come from the same attribute:

```text
resource  docs://readme name=readme mime=text/markdown
resource  logo://png name=logo mime=image/png
template  orders://{orderId} name=order mime=application/json      (and stock://{warehouse}/{sku})
```

Text is `text` on the wire (`"text":"# Orders API..."`); binary is base64 in `blob` (a 70 byte PNG here, and the
client exposes it decoded in `DecodedData`):

```text
<-- {"result":{"contents":[{"uri":"logo://png","mimeType":"image/png","blob":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...Jggg=="}],"ttlMs":0,...}   decoded=70 bytes
```

A string return becomes `TextResourceContents` with the attribute's MIME type; for binary return
`BlobResourceContents.FromBytes` (SDK 2.1.0 improved the binary docs). The client calls are `ListResourcesAsync`,
`ListResourceTemplatesAsync` and `ReadResourceAsync(uri)`.

### The not-found error: -32602 now, -32002 before

The 2026-07-28 changelog moved "resource not found" from `-32002` to `-32602` (SEP-2164). The SDK picks the code from
the negotiated version:

```text
negotiated 2026-07-28: read nosuch://x -> -32602 (InvalidParams): Unknown resource URI: 'nosuch://x'
negotiated 2025-11-25: read nosuch://x -> -32002 (ResourceNotFound): Unknown resource URI: 'nosuch://x'
--- a template matches and the handler decides the id does not exist: the code is yours ---
read orders://999 (throw new McpException(...)):               -32603 (InternalError): Order 999 does not exist
read orders://500 (throw McpProtocolException, InvalidParams): -32602 (InvalidParams): Order 500 does not exist
read orders://abc (matches, int.Parse fails):                  -32603 (InternalError): An error occurred.
```

An `McpException` message reaches the client but with `-32603`. The spec says a missing resource MUST be `-32602` and
MUST NOT be an empty `contents`, so throw `new McpProtocolException(msg, McpErrorCode.InvalidParams)`. A malformed
parameter (`abc` for an `int`) became a generic `-32603`: validate it yourself.

### Template parameters and completions

`stock://{warehouse}/{sku}` has two parameters. `[AllowedValues("lisbon", "porto", "faro")]` on `warehouse` makes the
SDK answer `completion/complete` with no handler (docs: handler results first, then matching `AllowedValues`):

```text
--> {"method":"completion/complete","params":{"ref":{"type":"ref/resource","uri":"stock://{warehouse}/{sku}"},"argument":{"name":"warehouse","value":"p"}},...}
<-- {"result":{"completion":{"values":["porto"],"total":1},"resultType":"complete",...},...}
```

For dependent arguments the client sends what the user already filled in `context.arguments`, and a
`WithCompleteHandler` handler (`ctx.Params.Context.Arguments["warehouse"]`) narrows the next list:

```text
--> {"method":"completion/complete","params":{"ref":{...},"argument":{"name":"sku","value":"SKU-"},"context":{"arguments":{"warehouse":"lisbon"}}},"id":4,...}
<-- {"result":{"completion":{"values":["SKU-L1","SKU-L2","SKU-L3"],"total":3,"hasMore":false},...},"id":4,...}
```

The client call is `client.CompleteAsync(new PromptReference { Name = "code_review" }, "language", "p")` (returned
`["python"]`), or the `CompleteRequestParams` overload when you need `Context`. `hasMore` was absent on the
`[AllowedValues]` answer and `false` on the handler's: treat missing as "no more".

The spec says at most 100 values per response, and the SDK does not cut:

```text
orderId='' -> values=250 total=250 hasMore=False    (handler returns every id from 1 to 250)
orderId='' -> values=100 total=250 hasMore=True     (handler: Take(100), HasMore = all.Count > 100)
```

Cap in the handler and report `Total` and `HasMore`; as the user types, the list shrinks, which is the pagination of
completions.

### Prompts: arguments, roles and rich content

A prompt is a user-selected template (think slash command). Return `ChatMessage` for text and images, `PromptMessage`
when you need an embedded resource:

```csharp
[McpServerPrompt(Name = "code_review")]
public static IEnumerable<ChatMessage> CodeReview([AllowedValues("csharp", "python", "go")] string language, string code) =>
[ new(ChatRole.User, $"Please review this {language} code:\n{code}"), new(ChatRole.Assistant, "I will check correctness first, then style.") ];
// review_order returns PromptMessage items: a TextContentBlock, an EmbeddedResourceBlock { Resource = new TextResourceContents { ... } }
// and a ResourceLinkBlock; analyze_chart returns a ChatMessage with [new TextContent(q), new DataContent(png, "image/png")]
```

`prompts/list` carries the arguments (`required: true` for plain parameters) and `prompts/get` returns the messages.
What `GetPromptAsync` gave the client:

```text
prompt code_review: language*, code*
  [code_review] User: text "Please review this csharp code:\nvar x = 1;"
  [code_review] Assistant: text "I will check correctness first, then style."
  [analyze_chart] User: image image/png (70 bytes)
  [review_order] User: resource orders://7 application/json
  [review_order] User: resource_link docs://readme
```

A host hands this to a model with `GetPromptResult.ToChatMessages()`. Measured: text and the embedded text resource
became `TextContent`, the image became `DataContent(image/png)`, and the `resource_link` message became a message with
zero contents, so a host that needs the linked data must call `resources/read`.

Errors: an unknown prompt gave `-32602` (`Unknown prompt: 'nosuch_prompt'`), but a missing required argument gave a
generic `-32603` (`An error occurred.`) although the spec says SHOULD be `-32602`. `[AllowedValues]` is only a
completion hint: `language=cobol` was accepted, so validate in the method body.

### Pagination: the cursor is opaque

The four list methods return an optional `nextCursor`; the client sends it back as `params.cursor`, and absence means
the end (an empty string is still a cursor). The server chooses the page size. With 120 tools in the collection the
SDK sent everything at once: `ListToolsAsync()` made 1 `tools/list` request, a 12,074 character response with no
cursor.

To paginate, replace the handler with `WithListToolsHandler`, slice the list by the cursor (here a base64 offset; any
opaque string works) and return `NextCursor` (null on the last page). With 50 per page:

```text
ListToolsAsync(): 122 tools in 3 tools/list request(s)
  page 1: 52 tools, nextCursor="NTA="
  page 2: 50 tools, nextCursor="MTAw"
  page 3: 20 tools, nextCursor=null
ListPromptsAsync(): 73 prompts in 2 requests; ListResourcesAsync(): 132 resources in 3
```

`ListToolsAsync()` follows the cursors and returns the whole list; `ListToolsAsync(new ListToolsRequestParams { Cursor
= c })` returns one page (`result.NextCursor`). Two gotchas: tools added with `WithTools<T>()` are appended only when
the request has no cursor, so page 1 had 52. And with `cursor=garbage`, the SDK's collection handler returned an empty
page (`{"tools":[],"ttlMs":0,...}`), while my custom handler threw and the client saw `-32602 Invalid cursor`. The
spec says invalid cursors SHOULD be `-32602`, so validate in your handlers.

### Cache hints: ttlMs and cacheScope

The 2026-07-28 spec requires `ttlMs` and `cacheScope` on `server/discover`, the four list results and `resources/read`
(SEP-2549). Set nothing and the SDK fills the safest values (`"ttlMs":0,"cacheScope":"private"`, seen above). To
publish real hints, set `result.TimeToLive` and `result.CacheScope` in a request filter (`AddListToolsFilter`,
`AddReadResourceFilter`) or a custom handler:

```text
defaults:         tools/list ttl=00:00:00 scope=Private   (also prompts, resources, templates, read)
with the filters: tools/list ttl=00:05:00 scope=Public    resources/read docs://readme ttl=00:01:00 scope=Public
                  resources/read orders://7 ttl=00:00:00 scope=Private
```

`public` lets a shared proxy serve one answer to everyone, so per-user data must be `private`, and the spec says not
to use `cacheScope` instead of access control. The client did not cache: three `ListToolsAsync()` calls sent three
requests, so honoring `ttlMs` is the host's job. Each page is cached on its own. For ASP.NET Core readers, `ttlMs` is
`max-age` and `cacheScope` is `public` or `private`.

### Change notifications: listChanged and subscriptions/listen

`resources/subscribe` and the HTTP GET stream are gone in 2026-07-28. A client opens one `subscriptions/listen`
request with a filter (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`),
gets `notifications/subscriptions/acknowledged` first, then only what it asked for, each tagged
`_meta."io.modelcontextprotocol/subscriptionId"`. Over stdio, with the default handler, a tool added at runtime (the
client sent `subscriptions/listen` with `SendRequestAsync`; the SDK has no typed client method for it):

```text
SubscribeToResourceAsync on 2026-07-28: -32601 (MethodNotFound): The method 'resources/subscribe' is not available on protocol version '2026-07-28'. Use 'subscriptions/listen' with 'resourceSubscriptions' instead.
== listen with all four filters
   notifications/subscriptions/acknowledged {"notifications":{"toolsListChanged":true,"promptsListChanged":true,"resourcesListChanged":true,"resourceSubscriptions":["docs://readme"]},"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
   notifications/tools/list_changed {"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
```

Without a `subscriptions/listen`, the 2026-07-28 client received no `tools/list_changed`, while a client pinned to
2025-11-25 had `resources/subscribe` accepted and `tools/list_changed` broadcast with no id. The built-in handler fans
out only the three list-changed kinds; `resources/updated` is yours to send (my tool called `SendNotificationAsync`
and it reached the client untagged, whatever the filter).

Stateless HTTP is the hard case. The built-in handler acknowledges with an empty filter and completes at once,
`server/discover` does not advertise `listChanged`, and the old method is a 404:

```text
data: {"method":"notifications/subscriptions/acknowledged","params":{"notifications":{},...},...}   then at once {"result":{"resultType":"complete"},"id":1,...}
resources/subscribe over HTTP: 404 {"error":{"code":-32601,"message":"Method 'resources/subscribe' is not available on protocol version '2026-07-28'."}}
```

The opt-in from SDK 2.1.0 is `WithSubscriptionsListenHandler`, a full replacement: it must send one acknowledgement
first, tag each notification with the request id, stay alive until cancelled, and you must set the capabilities
yourself. With a small in-memory bus behind it, the stateless server pushed on a held-open POST:

```text
notifications/subscriptions/acknowledged {"notifications":{"toolsListChanged":true,"resourceSubscriptions":["docs://readme"]},"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
notifications/tools/list_changed {"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
notifications/resources/updated {"uri":"docs://readme","_meta":{"io.modelcontextprotocol/subscriptionId":2}}
```

An update to `docs://other` was dropped by my handler's filter. The bus is in-process, so scaling out needs a shared
channel (Redis, a broker). SDK 2.4.0 also cancels a listen request when the transport stops delivering.

### Tool, resource or prompt?

| | Who decides | Typical content | Side effects |
| --- | --- | --- | --- |
| Tool | The model (model-controlled) | An action or computation | Allowed, needs approval |
| Resource | The application (application-driven) | Data attached as context, by URI | None |
| Prompt | The user (slash command) | A message template with arguments | None |

## Trade-offs

- **Resource or tool for read-only data.** A resource gets MIME types, cache hints and host UI, but many hosts do not
  let the model fetch it alone; a tool is always reachable. Offering both costs a duplicate description.
- **Pagination versus one big list.** 120 tools went out in 12 KB, fine until the list grows, and each description is
  context the model pays for. Paginating means writing the list handler and validating cursors.
- **Long `ttlMs`.** Five minutes saves requests but a changed or poisoned tool description stays trusted until it
  ends. Pair it with `listChanged` so a notification invalidates the cache.
- **Owning the listen stream.** The default delivers nothing on stateless HTTP; the custom handler works but you carry
  fan-out and capabilities.

## Documentation Links

- [Resources, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) (doc)
- [Prompts, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts) (doc)
- [Completion, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion) (doc)
- [Pagination, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination) (doc)
- [Caching, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) (doc)
- [Subscriptions, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [MCP C# SDK 2.1.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.1.0) (doc)

