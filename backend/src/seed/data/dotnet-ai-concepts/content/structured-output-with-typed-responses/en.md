---
version: 1.0
updatedAt: 2026-10-30
---
## Objective

A model answers in text; an application needs a `Ticket`, not a paragraph.
`GetResponseAsync<T>` in `Microsoft.Extensions.AI` turns a C# type into a JSON
schema, asks the provider to follow it and deserializes the reply into
`ChatResponse<T>`. This lesson extracts a record from an email with a local
model, shows the schema and HTTP body, reproduces failures with a scripted fake,
separates parsing from validation, and measures what names, descriptions,
nullability and the schema do to answers and tokens.
Versions: `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama
0.40.12 with `qwen3:4b-instruct` (temperature 0, seed 42), .NET 10.

## Use Cases

- Extracting fields (customer, order, dates) from emails into a validated record.
- Classifying text into an enum (category, priority, sentiment).
- Getting a list or a number from a model without parsing prose.
- Replacing string scraping of "reply in JSON" prompts with a typed call.

## Deep Dive

### GetResponseAsync<T> on a support email

The email: Maria Souza ordered 3 units on 2026-10-12 (two USB-C docks and a
monitor stand), order ORD-88213, nothing arrived in Porto, Portugal, "please
hurry!". The type is the request; `Result` throws on failure, `TryGetResult`
returns `false`:

```csharp
public enum Priority { Low, Normal, Urgent }
public record Address(string City, string Country);
[Description("A support ticket extracted from a customer email")]
public record Ticket([property: Description("Customer full name")] string Customer, int Quantity,
    Priority Priority, string? OrderNumber, List<string> Products, Address ShipTo, DateOnly OrderDate);
ChatResponse<Ticket> r = await client.GetResponseAsync<Ticket>(   // client: OllamaApiClient
    "Extract the ticket from this email:\n" + email, new ChatOptions { Temperature = 0, Seed = 42 });
```

```text
Customer = Maria Souza, Quantity = 3, Priority = Urgent, OrderNumber = ORD-88213, OrderDate = 2026-10-12,
Products = [USB-C dock (x2), 27" monitor stand (x1)], ShipTo = Porto/Portugal, usage in=82 out=110
```

Identical in 3 of 3 runs; `ChatResponse<T>` keeps `Text`, `Usage` and `FinishReason`.

### The schema MEAI generates

`ChatResponseFormat.ForJsonSchema<Ticket>()` builds what is sent (abridged):

```text
"description": "A support ticket extracted from a customer email", "type": "object",
"customer":    { "description": "Customer full name", "type": "string" },
"priority":    { "type": "string", "enum": ["Low", "Normal", "Urgent"] },
"orderNumber": { "type": ["string", "null"] },
"shipTo":      { "type": "object", "properties": {...}, "required": ["city", "country"] },
"orderDate":   { "type": "string", "format": "date" },
"required": ["customer","quantity","priority","orderNumber","products","shipTo","orderDate"]
```

`string?` is a union with `null` but stays required; there is no
`additionalProperties`. `AIJsonUtilities.CreateJsonSchema(typeof(Ticket))` gave
the same minus `$schema`. Both use `AIJsonUtilities.DefaultOptions`: camelCase,
`JsonStringEnumConverter`, case-insensitive, numbers readable from strings.

### What OllamaSharp puts on the wire

A `DelegatingHandler` in the `HttpClient` given to `new OllamaApiClient(http,
"qwen3:4b-instruct")` captured the `/api/chat` body: keys `model, messages,
options, format, stream, CustomHeaders`, the schema in `format`, messages
untouched. The Ollama blog says `format` constrains output to the schema. With
`useJsonSchemaResponseFormat: false`, `format` became `"json"` and MEAI added a
user message "Respond with a JSON value conforming to the following schema:"
plus the schema. Same email, `Usage` identical in 3 of 3 runs:

| Request | `format` | in | out |
| --- | --- | --- | --- |
| prompt + "Reply with JSON only." | none | 87 | 106 |
| same + `ResponseFormat = ChatResponseFormat.Json` | `"json"` | 87 | 106 |
| `GetResponseAsync<Ticket>` | schema | 82 | 110 |
| `GetResponseAsync<Ticket>(..., useJsonSchemaResponseFormat: false)` | `"json"`, schema in prompt | 259 | 114 |

The native schema cost no input tokens (the first rows pay 5 for the extra
sentence), the prompt schema 177. Without a schema the JSON took its own shape
(`{"ticket": {"from": ...`). The 82 means the schema was not added as prompt text.

### Arrays and primitives are wrapped in `data`

A non-object `T` is wrapped (a source comment says real providers require an
object root), and so is an enum. A fake or cached reply must keep the wrapper:

```text
GetResponseAsync<string[]>, schema sent:
  {"type":"object","properties":{"data":{"type":"array","items":{"type":"string"}}},"additionalProperties":false,"required":["data"]}
Ollama (3 of 3): { "data": [ "red", "yellow", "blue" ] } -> red|yellow|blue   int: { "data": 8 } -> 8
fake "42" for int: InvalidOperationException: The requested operation requires an element of type 'Object', but the target element has type 'Number'.
```

### ResponseFormat by hand, and the serializer mismatch

`ChatOptions.ResponseFormat` takes `ChatResponseFormat.Text`, `.Json` or
`.ForJsonSchema(...)`. Sending the schema by hand works; reading the reply with
other serializer options is where the bugs are:

```csharp
options.ResponseFormat = ChatResponseFormat.ForJsonSchema<Ticket>();
JsonSerializer.Deserialize<Ticket>((await client.GetResponseAsync(prompt, options)).Text);
// Ticket { Customer = , Quantity = 0, Priority = Low, OrderNumber = , ... OrderDate = 1/1/0001 }
```

No exception, every field default. `JsonSerializerDefaults.Web` threw
`JsonException: The JSON value could not be converted to Ticket. Path:
$.priority`; `AIJsonUtilities.DefaultOptions` read it. Web options passed to
`GetResponseAsync<T>` threw `InvalidOperationException: JsonSerializerOptions
instance must specify a TypeInfoResolver setting before being marked as
read-only.` With a resolver it ran, but without an enum converter the schema
said `"type":"integer"`, the model wrote `"priority": 1` and the urgent email
came back `Normal`, 3 of 3. Start from `new JsonSerializerOptions(AIJsonUtilities.DefaultOptions)`.

### When the text is not the JSON you expected

Replies from a scripted `IChatClient`, so these are deterministic:

```text
reply                                  Try    Result
""                                     false  InvalidOperationException: The response did not contain JSON to be deserialized.
"Sure! Here is the JSON: {...}"        false  JsonException: 'S' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.
"```json\n{...}\n```"                  false  JsonException: '`' is an invalid start of a value. ...
"null"                                 false  InvalidOperationException: The deserialized response is null.
{"label":"positive","score":"four"}    false  JsonException: The JSON value could not be converted to Sentiment. Path: $.score ...
{"label":"positive"}                   true   Score = 0
{"label":"first",...} {"label":"second",...}  true  Label = first
```

10.11.0 strips nothing, so a preamble or Markdown fence breaks parsing. On
Ollama both modes parsed, 3 of 3. `/api/show` lists `thinking`, but
`think: true` (via `AdditionalProperties`) returned only `TextContent`; a fake
with `TextReasoningContent` before the JSON parsed, since `Text` skips it.

### Deserialization is not validation, and a bounded retry

```csharp
public record Order { public required string OrderNumber { get; init; }
                      [Range(1, 100)] public int Quantity { get; init; } }
```

```text
fake {"quantity":250}: JsonException: JSON deserialization for type 'Order' was missing required properties including: 'orderNumber'.
fake {"orderNumber":"ORD-1","quantity":250}: TryValidateObject false, "The field Quantity must be between 1 and 100."
schema: "quantity": {"type":"integer","minimum":1,"maximum":100}, "required": ["orderNumber"]
Ollama, "order ORD-7, we need 250 units.": {"orderNumber":"ORD-7","quantity":25}  (250 without [Range])
```

As `LooseOrder(string OrderNumber, int Quantity)` the first gave `null`, no error.
`[Range]` needs `Validator.TryValidateObject` after parsing; it also became
`minimum`/`maximum`, and Ollama then returned 25 for "250 units" in 3 of 3
runs: valid, and wrong. A bounded retry can feed the error back:

```csharp
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    var response = await client.GetResponseAsync<T>(messages); string error;
    try { T v = response.Result; var errs = new List<ValidationResult>();
          if (Validator.TryValidateObject(v, new(v), errs, true)) return (v, attempt);
          error = string.Join("; ", errs.Select(e => e.ErrorMessage)); }
    catch (Exception e) when (e is JsonException or InvalidOperationException) { error = e.Message; }
    messages.AddMessages(response);
    messages.Add(new(ChatRole.User, $"That answer was rejected: {error} Reply again with corrected JSON."));
}
```

```text
fake "Sorry, here it is: {", then quantity 250, then 25: Quantity = 25, attempts=3, calls=3, last call 5 messages
fake always "nope": result=null attempts=3 calls=3
```

### Names and descriptions are the prompt

Six support messages (two each of billing, shipping, technical), 3 runs, with
records differing only in the enum: `Category { Billing, Shipping, Technical }`,
`Code { C1, C2, C3 }`, and `Code` plus a property `[Description("C1 = billing
or payments, C2 = shipping or delivery, C3 = technical problem with the app")]`:

```text
                          Category   Code   Code + [Description]
native schema (format)      6/6       3/6          3/6
schema in the prompt        6/6       3/6          6/6
```

Identical in all 3 runs. Renamed members cost half the accuracy; the
`[Description]` changed nothing natively and fixed it in prompt mode, matching
the token table. Put meaning in member names, or also in the instructions.

### Nullable versus required for missing facts

"Hi, I'm Joao Lima. My order still hasn't arrived, can you check? Thanks." has
no order number or phone; each row repeated 3 of 3:

```text
                                       string OrderNumber, Phone   string? OrderNumber, Phone
native                                 "Not provided"              "Not provided"
prompt mode                            ""                          null
native + "Use null for anything..."    "null" (a string)           null
```

`string?` alone did not stop the invention natively; with an instruction it
did. Without `?` the model wrote the string `"null"`, which passes `required`.

## Trade-offs

- **Native schema versus schema in the prompt.** On Ollama native was free and
  enforced shape, but hid the descriptions; prompt mode cost 177 tokens. The API
  reference says the native default "might cause an error if the model does not
  support it"; `useJsonSchemaResponseFormat: false` is the fallback.
- **Retries and streaming.** Each retry resends the history. There is no
  streaming `GetResponseAsync<T>`: 10 of 110 updates joined to `{ "customer":
  "Maria Souza",` (not JSON); `new ChatResponse<Ticket>(updates.ToChatResponse(),
  AIJsonUtilities.DefaultOptions).Result` worked after the stream, 3 of 3.
- **Provider strict modes differ.** The Azure OpenAI docs say every field must
  be required and `additionalProperties` false, and list `format`, `minimum`
  and `maximum` as unsupported. `Ticket` lacks `additionalProperties: false` and
  uses `format: date`; how the OpenAI adapter handles that was not tested here.
- **When not to use it.** If the model must decide to act, look something up
  or ask for more data, use tools (Tool Calling with AIFunction). Structured
  output fits extraction and classification into a known shape.

## Documentation Links

- [Quickstart: Request a response with structured output, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/structured-output) (doc)
- [ChatClientStructuredOutputExtensions.GetResponseAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.ai.chatclientstructuredoutputextensions.getresponseasync) (doc)
- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
- [Structured outputs, Ollama Blog](https://ollama.com/blog/structured-outputs) (doc)
- [How to use structured outputs with Azure OpenAI, Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) (doc)
