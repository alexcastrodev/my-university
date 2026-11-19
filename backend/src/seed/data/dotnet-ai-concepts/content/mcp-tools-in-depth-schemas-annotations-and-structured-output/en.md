---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A tool is a contract: a name, an `inputSchema` the model fills in, an optional `outputSchema`, hints about its side effects, and a list of content blocks that come back. The introductory MCP lesson covers `[McpServerTool]`, `[Description]` and error handling; this one measures the contract itself on the wire: the JSON Schema the C# SDK generates from a method signature, `structuredContent` read back as a typed value, what the annotations really put in `tools/list`, the five content block types, the order of `tools/list`, `x-mcp-header` and the naming rules. No model is involved: everything below is raw JSON-RPC against a real server. Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0 (one comparison run on 2.3.0), `net10.0`, SDK 10.0.100, spec revision 2026-07-28, Streamable HTTP in stateless mode.

## Use Cases

- Making the generated `inputSchema` precise (enums, ranges, defaults) so models fill arguments correctly.
- Returning a typed record and letting any client deserialize it instead of parsing text.
- Marking read-only and destructive tools so a host can decide what to confirm.
- Returning images, files and links from a tool, and keeping `tools/list` stable for caches.

## Deep Dive

### The server used for every measurement

Tools are plain methods; the SDK builds the schema with `AIJsonUtilities` from the signature.

```csharp
builder.Services.AddMcpServer()
    .WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless)
    .WithTools<SchemaTools>().WithTools<OutputTools>().WithTools<HintTools>()
    .WithTools<ContentTools>().WithTools<HeaderTools>();
app.MapMcp("/mcp"); app.Run("http://127.0.0.1:6040");

public enum Priority { Low, Normal, High }
public record Address([property: Required, StringLength(40, MinimumLength = 2)] string City,
                      [property: RegularExpression(@"^\d{5}$")] string? Zip = null);
public record Forecast(string City, double TempC, string[] Conditions, DateOnly Day);
```

The raw calls below are `curl` POSTs with the three 2026-07-28 headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) and `_meta` carrying the protocol version.

### How the SDK builds the inputSchema

One method with a parameter of each interesting shape, then `tools/list`:

```csharp
[McpServerTool(Name = "describe_all")]
public string DescribeAll(string sku, int quantity, double price, bool gift, Priority priority,
    Address shipTo, string[] tags, List<int> sizes, Dictionary<string, int> limits,
    int? maxItems, string? coupon, DateTimeOffset when, Guid id,
    int pageSize = 20, Priority fallback = Priority.Normal, bool refundable = true,
    [Range(1, 10)] int rating = 5, [StringLength(8, MinimumLength = 3)] string code = "abc",
    [Required] string? mustHave = null,
    IServiceProvider? sp = null, Counter? counter = null, CancellationToken ct = default)
```

```text
quantity   {"type":"integer"}                     price   {"type":"number"}
priority   {"type":"string","enum":["Low","Normal","High"]}
shipTo     {"type":"object","properties":{"city":{"type":"string","minLength":2,"maxLength":40},"zip":{"type":["string","null"],"default":null,"pattern":"^\\d{5}$"}},"required":["city"]}
sizes      {"type":"array","items":{"type":"integer"}}
limits     {"type":"object","additionalProperties":{"type":"integer"}}
maxItems   {"type":["integer","null"]}           when    {"type":"string","format":"date-time"}
id         {"type":"string","format":"uuid"}
pageSize   {"type":"integer","default":20}
fallback   {"type":"string","enum":["Low","Normal","High"],"default":"Normal"}
rating     {"type":"integer","default":5,"minimum":1,"maximum":10}
code       {"type":"string","default":"abc","minLength":3,"maxLength":8}
mustHave   {"type":["string","null"],"default":null}
required   ["sku","quantity","price","gift","priority","shipTo","tags","sizes","limits","maxItems","coupon","when","id","mustHave"]
```

Findings: an enum becomes a string schema with its member names, not numbers; a parameter with a default value drops out of `required` and gets `default`; `int?` and `string?` become `["integer","null"]` but stay required when they have no default (nullable is not optional); `[Range]` and `[StringLength]` become `minimum`, `maximum`, `minLength`, `maxLength`; `[Required]` on a record property puts `city` in the nested `required`, and on the parameter `mustHave` it kept the parameter in `required` even though it has a default (the type stays `["string","null"]`, so it is required but may be null). `IServiceProvider`, `Counter` (a registered service) and `CancellationToken` are not in the schema. `[Description]` on a parameter appears as `description` (id 6 shows it). A method without parameters gives `{"type":"object","properties":{}}`; the spec recommends `"additionalProperties": false` for that case, and the SDK does not emit it.

The schema is advertisement only. `[Range]` is not enforced:

```text
validated {"rating":99,"code":"toolongvalue"}  ->  "rating=99 code=toolongvalue"   (schema said max 10 and maxLength 4)
validated {"rating":"x","code":"ab"}           ->  isError, "An error occurred invoking 'validated'."
validated {"code":"ab"}                        ->  isError, same generic text (missing required rating)
validated {"rating":1,"code":"ab","extra":1}   ->  accepted, extra property ignored
```

The XML docs of `McpServerToolAttribute` say it plainly: data annotations influence the schema but are not enforced at runtime, so validate inside the method. A wrong type or a missing argument is a binding failure that comes back as the generic `isError`, not as a JSON-RPC `-32602`, and the model gets no hint about what to fix unless you throw `McpException` yourself.

### $ref, $defs and any 2020-12 keyword

SEP-2106 in the 2026-07-28 changelog loosened `inputSchema` and `outputSchema` to any JSON Schema 2020-12 keyword, and added rules for `$ref`: an implementation MUST NOT dereference a `$ref` that resolves to a network URI by default, and SHOULD bound composition keywords (`anyOf`, `oneOf`, `allOf`, `if/then/else`, `$defs`) against denial of service.

Generated schemas inline repeated types: `from` and `to` in a tool taking two `Address` parameters carry two full copies. Only recursion produces a reference, `{"$ref":"#/properties/tree"}` for `Node(string Label, List<Node> Children)`. A hand-written schema passes through unchanged, `$schema`, `$defs`, `$ref`, `oneOf`, `if/then` included (an `AIFunction` with a custom `JsonSchema`, listed as is, input and output). The SDK does not validate arguments against it either: `{"price":{"amount":-5,"currency":"GBP"},"payment":"card"}` violated `exclusiveMinimum`, the `enum` and the `then` clause, and the call ran. Treat the schema as documentation for the model and enforce rules in code. A tuple return gave a useless output schema, `{"type":"object"}`: return a named record.

### outputSchema and structuredContent

`UseStructuredContent = true` advertises an output schema built from the return type and fills `structuredContent`:

```csharp
[McpServerTool(Name = "forecast", UseStructuredContent = true)]
public Forecast GetForecast(string city) => new(city, 21.5, ["sunny", "windy"], new DateOnly(2026, 11, 19));
```

```text
"outputSchema":{"type":"object","properties":{"city":{"type":"string"},"tempC":{"type":"number"},"conditions":{"type":"array","items":{"type":"string"}},"day":{"type":"string","format":"date"}},"required":["city","tempC","conditions","day"]}
tools/call -> {"result":{"content":[{"type":"text","text":"{\"city\":\"Berlin\",\"tempC\":21.5,...}"}],
  "structuredContent":{"city":"Berlin","tempC":21.5,"conditions":["sunny","windy"],"day":"2026-11-19"},"resultType":"complete",...}}
```

The text block is the same JSON serialized, as the spec asks for backward compatibility. The same record without `UseStructuredContent` (`forecast_plain`) sent only the text block and no schema. The C# client reads the value from `CallToolResult.StructuredContent` (a `JsonElement?`):

```csharp
CallToolResult r = await client.CallToolAsync("forecast", new() { ["city"] = "Berlin" });
Forecast f = r.StructuredContent!.Value.Deserialize<Forecast>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
```

Under 2026-07-28 the output schema can be any schema and `structuredContent` any JSON value, with no `{"result": ...}` wrapper (the SDK docs say so):

```text
temperature (int)        outputSchema {"type":"integer"}   structuredContent 72 (ValueKind Number)
forecast_list (List<T>)  outputSchema {"type":"array","items":{...}}   structuredContent [ {...}, {...} ]
```

The same tools called by a client pinned to `ProtocolVersion = "2025-11-25"` get the old envelope: `{"result":72}` with `{"type":"object","properties":{"result":{"type":"integer"}},"required":["result"]}`. One server serves both, and a client must read the value according to the schema it received, not assume a shape. `McpClientTool.ReturnJsonSchema` exposes it.

What the SDK does not do is check the output. `forecast_liar` advertises `Forecast` through `OutputSchemaType` but returns `{"city":"Rome","tempC":"hot"}`: the server sent it, the client returned it with `IsError` null, and only `Deserialize<Forecast>` failed: `JsonException: The JSON value could not be converted to Forecast. Path: $.tempC`. The spec says servers MUST conform and clients SHOULD validate, so a client that cares should validate with its own JSON Schema library. Other cases: a `Forecast?` returning `null` produced `content: []` and no `structuredContent`; a thrown `McpException` produced `isError: true` with the text and no `structuredContent`. Do not confuse this with the LLM feature also called structured output (see `structured-output-with-typed-responses`): the spec states `structuredContent` is unrelated to schema-constrained model generation.

### Annotations: hints, not guarantees

```csharp
[McpServerTool(Name = "lookup", Title = "Look up an order", ReadOnly = true, OpenWorld = false)]
[McpServerTool(Name = "cancel_order", Destructive = true, Idempotent = true, OpenWorld = false)]
[McpServerTool(Name = "append_note", Destructive = false)]
[McpServerTool(Name = "liar_readonly", ReadOnly = true)]   // increments a counter
```

```text
unannotated   (no title, no annotations)
lookup        title "Look up an order", annotations {"title":"Look up an order","openWorldHint":false,"readOnlyHint":true}
cancel_order  annotations {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false}
append_note   annotations {"destructiveHint":false}
liar_readonly annotations {"readOnlyHint":true}
```

Only what you set is sent; the C# properties return the spec defaults when unset but the wire omits them, so a client sees `null` and applies the spec defaults itself: `readOnlyHint` false, `destructiveHint` true, `idempotentHint` false, `openWorldHint` true (so an unannotated tool is, by the spec, destructive and open-world). `destructiveHint` and `idempotentHint` only mean something when `readOnlyHint` is false. `Title` is copied both to the tool and to `annotations.title`.

`liar_readonly` declared `readOnlyHint: true` and, called twice, answered `counter is now 1` and `counter is now 2`: nothing stops a server from lying. The spec says clients MUST treat annotations as untrusted unless they come from a trusted server and should never base tool-use decisions on annotations from untrusted servers. Use them for UI hints (a confirmation dialog, a badge); the security consequences (tool poisoning, rug pulls) belong to the MCP security lesson.

### The five content block types on the wire

```csharp
public ImageContentBlock GetImage() => ImageContentBlock.FromBytes(png, "image/png");
public AudioContentBlock GetAudio() => AudioContentBlock.FromBytes(bytes, "audio/wav");
public EmbeddedResourceBlock GetDoc() => new() { Resource = new TextResourceContents { Uri = "docs://readme", MimeType = "text/plain", Text = "..." } };
public EmbeddedResourceBlock GetBlob() => new() { Resource = BlobResourceContents.FromBytes(pdf, "docs://manual.pdf", "application/pdf") };
public ResourceLinkBlock GetLink() => new() { Uri = "file:///reports/q3.csv", Name = "q3.csv", Description = "Quarterly report", MimeType = "text/csv" };
```

```text
[{"type":"image","data":"iVBORw0KGgo...","mimeType":"image/png"}]
[{"type":"audio","data":"AQIDBA==","mimeType":"audio/wav"}]
[{"type":"resource","resource":{"uri":"docs://readme","mimeType":"text/plain","text":"Reservations expire after 24 hours."}}]
[{"type":"resource","resource":{"uri":"docs://manual.pdf","mimeType":"application/pdf","blob":"JVBERg=="}}]
[{"type":"resource_link","uri":"file:///reports/q3.csv","name":"q3.csv","description":"Quarterly report","mimeType":"text/csv"}]
```

Binary payloads are base64 in `data` or `blob`; the client exposes `DecodedData`. An embedded resource carries the content inside the result; a resource link only points to it, and the spec says linked resources are not guaranteed to appear in `resources/list`. Returning `IEnumerable<ContentBlock>` gives several blocks in one result (`text`, `image`, `resource_link`). Any block can carry `annotations` with `audience`, `priority` and `lastModified`: the 2.3.0 server sent `"annotations":{"audience":["user","assistant"],"priority":0.7,"lastModified":"2026-11-01T10:00:00+00:00"}`, but on 2.4.0 every result with an annotated block failed with `-32603 An error occurred.` and a server-side `InvalidOperationException: Cannot insert the values of 'TypeInfoResolver' or 'TypeInfoResolverChain' ...` in `ContentBlock.Converter.CreateNestedOptions`. That is open issue 2012 in the SDK repository (P2, found on 2026-11-18, I did not find a 2.4.x fix): until it ships, do not set `Annotations` on content blocks in 2.4.0.

### Order of tools/list and caching

The spec says servers SHOULD return tools in a deterministic order, to let clients cache the list and to raise LLM prompt cache hit rates, since the tool list sits at the start of the model prompt. The SDK keeps insertion order: `McpServerPrimitiveCollection` yields tools in the order they were added, and `WithTools<T>()` adds the type's methods in the order reflection returns them (declaration order in practice, not a documented guarantee). Three restarts of the server produced the same `tools/list` (same SHA-256 of the JSON, 27 tools). A removed and re-added tool moves to the end:

```text
registered      : zeta,alpha,mid
alpha re-added  : zeta,mid,alpha
```

So dynamic add/remove (and `listChanged`) reorders the prefix of the prompt and invalidates a prompt cache from that point on. Registration order is your contract: put stable tools first. The same result carries the new cache fields: `"ttlMs":0,"cacheScope":"private"` by default (conservative: do not cache). A `AddListToolsFilter` that set `TimeToLive = 5 minutes` and `CacheScope.Public` produced `"ttlMs":300000,"cacheScope":"public"` on the wire.

### x-mcp-header: parameters mirrored to HTTP headers

SEP-2243 lets a tool mark a primitive parameter so the client copies it into `Mcp-Param-{Name}`, letting load balancers and WAFs route without parsing the body. The SDK supports it with `[McpHeader("Region")]` on a parameter:

```csharp
public string ExecuteSql([McpHeader("Region")] string region, [McpHeader("Shard")] int shard,
                         [McpHeader("Dry-Run")] bool dryRun, string query)
```

The schema got `"region":{"description":"Target region","type":"string","x-mcp-header":"Region"}` (and `"shard"`, `"dryRun"` the same way), and the C# client added the headers by itself:

```text
Mcp-Method=tools/call Mcp-Name=execute_sql Mcp-Param-Region=us-west1 Mcp-Param-Shard=7 Mcp-Param-Dry-Run=true
Mcp-Method=tools/call Mcp-Name=execute_sql Mcp-Param-Region==?base64?c8Ojby1wYXVsbw==?= ...   (value "são-paulo")
```

Non-ASCII values travel as `=?base64?...?=`. The server validates the headers against the body (spec: 400 and `-32020`, `HeaderMismatch`). Raw POSTs without a client:

```text
correct Mcp-Param-* headers  -> HTTP 200
no Mcp-Param-* headers       -> HTTP 400 {"error":{"code":-32020,"message":"Missing required Mcp-Param-Region header for parameter 'region' annotated with x-mcp-header."}}
Mcp-Param-Region: eu-central1 -> HTTP 400 -32020 "Header mismatch: Mcp-Param-Region header value does not match body argument 'region'."
Mcp-Name: other               -> HTTP 400 -32020 "Header mismatch: Mcp-Name header value 'other' does not match body value 'execute_sql'."
```

At registration time the SDK rejects invalid use: `[McpHeader]` on a `double` or `string[]` throws `InvalidOperationException` ("Only string, integer, and boolean types"), a duplicate name ignoring case (`Region` and `region`) throws, and the attribute constructor throws `ArgumentException` for a name with `:` or a space; `long` is accepted. The spec says clients may ignore the annotation on stdio, and warns against mirroring secrets, since intermediaries see headers. Only the 2026-07-28 protocol validates them; a 2025-11-25 client has no such rule (SDK docs, docs only: I measured with the default version).

### Tool names

The spec says tool names SHOULD be 1 to 128 characters, case-sensitive, using only `A-Z a-z 0-9 _ - .`. The SDK does not leave it at SHOULD: creating a tool throws `ArgumentException: The tool name '...' is invalid. Tool names must match the regular expression '^[A-Za-z0-9_.-]{1,128}\z'`. Measured: `bad name!`, a 129-character name, `café` and the empty string were all refused (the last at startup), `dots.and-dashes_ok` was accepted. A server that aggregates tools from several servers must still handle collisions: the spec suggests prefixing with a server identifier and says `serverInfo.name` is not unique.

## Trade-offs

- **Generated schema vs hand-written.** The signature gives a correct, free schema, but it is only advertisement. A hand-written `$defs` schema can express `oneOf` or `if/then`, and still nothing checks the arguments: re-validate in the method (`McpException` with a message the model can act on).
- **`UseStructuredContent` vs text only.** Typed output saves every client from parsing text and documents the shape, at the cost of a schema a client may enforce and a server that never checks itself. Non-object outputs need clients on 2026-07-28; older ones get the `result` envelope.
- **Annotations vs real controls.** `readOnlyHint` helps a host skip a confirmation, but only from a server you trust. For tools you do not own, keep allow-lists and approval (see the C# SDK lesson) instead of trusting the hints.
- **Embedded resource vs resource link.** Embedding ships the bytes in every result (cost in tokens and bandwidth); a link is small but needs a second `resources/read`, and the target may not be listed.
- **Dynamic tool lists vs prompt caching.** Adding tools at runtime is flexible but moves the cache boundary; prefer a stable, ordered core set.
- **`x-mcp-header` vs body only.** Headers allow routing by region or tenant without parsing JSON, but the value is visible to every proxy and must match the body or the call fails with `-32020`.

## Documentation Links

- [Tools, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (doc)
- [Specification changelog 2026-07-28 (SEP-2106, SEP-2243, tools/list ordering), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Basic protocol and JSON Schema usage, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic) (doc)
- [Streamable HTTP and custom headers from tool parameters, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (doc)
- [Schema reference (ToolAnnotations), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/schema) (doc)
- [Tools, MCP C# SDK concepts](https://csharp.sdk.modelcontextprotocol.io/concepts/tools/tools.html) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
- [Issue 2012: annotated content blocks fail in 2.4.0, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/issues/2012) (doc)
- [JSON Schema 2020-12 core, json-schema.org](https://json-schema.org/draft/2020-12/json-schema-core) (doc)
