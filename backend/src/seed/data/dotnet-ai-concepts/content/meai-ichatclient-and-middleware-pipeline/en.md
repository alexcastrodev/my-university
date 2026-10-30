---
version: 1.0
updatedAt: 2026-10-29
---
## Objective

`Microsoft.Extensions.AI` (MEAI) is the layer every lesson of this track sits
on. `Microsoft.Extensions.AI.Abstractions` defines `IChatClient`, one interface
with two calls that provider packages implement; `Microsoft.Extensions.AI` adds
the `ChatClientBuilder` pipeline of logging, caching, tool invocation and
telemetry around any `IChatClient`. This lesson calls a local Ollama model
through it, reads the response, proves the pipeline order, measures a cache
hit, registers clients in DI, swaps in a scripted fake and records the exact
failures. Versions: `Microsoft.Extensions.AI` and `.Abstractions` 10.11.0,
`OllamaSharp` 5.5.0, `Microsoft.Extensions.Caching.Memory` 10.0.14, Ollama
0.40.12 with `qwen3:4b-instruct`, .NET 10.

## Use Cases

- Code against `IChatClient`, so the provider (Ollama locally, a cloud model in
  production) is a registration detail.
- Logging, caching or telemetry for every model call, added in one place.
- Unit tests with a scripted `IChatClient` fake: no network, fixed answers.
- Streaming a reply to a UI and still getting one `ChatResponse` with usage.

## Deep Dive

### One call, and what comes back

`OllamaApiClient` (OllamaSharp) implements `IChatClient`. A string becomes one
user `ChatMessage`; `ChatOptions` carries the common knobs as typed properties:

```csharp
IChatClient client = new OllamaApiClient(new Uri("http://localhost:11434"), "qwen3:4b-instruct");
ChatResponse r = await client.GetResponseAsync(
    "Name the capital of France in one word.",
    new ChatOptions { Temperature = 0, Seed = 42 });
```

```text
Messages.Count = 1 (assistant, TextContent)   Text = Paris
Usage = in 17, out 2, total 19                FinishReason = stop
ModelId = qwen3:4b-instruct                   ConversationId = null
ResponseId = 2026-10-29T21:10:23.870667Z
```

Same answer and counts in 3 of 3 runs; `Usage` matches the raw `/api/chat`
reply (`prompt_eval_count` 17, `eval_count` 2). The docs note a response can
hold several messages (a tool loop adds some), the last being the answer.
OllamaSharp fills `ResponseId` with a timestamp.

### Streaming, and folding updates back

`GetStreamingResponseAsync` takes the same inputs and returns
`IAsyncEnumerable<ChatResponseUpdate>`:

```csharp
List<ChatResponseUpdate> updates = [];
await foreach (var u in client.GetStreamingResponseAsync("Count from 1 to 10, separated by spaces.", options))
    updates.Add(u);                      // a UI would print u.Text here
ChatResponse r = updates.ToChatResponse();   // or .ToChatResponseAsync() on the stream
```

```text
updates = 21, first update: Text='1' Role=assistant
updates carrying UsageContent = 1, last FinishReason = stop
ToChatResponse: Messages=1 Text='1 2 3 4 5 6 7 8 9 10' Usage in 21 out 21 Finish=stop
```

Identical in 3 of 3 runs. Usage arrives once, as a `UsageContent` item, and
`ToChatResponse` moves it into `ChatResponse.Usage`; code that prints `u.Text`
and drops the updates loses the token counts.

### The client does not remember

`IChatClient` keeps no conversation. A recording `DelegatingChatClient` that
prints what it forwards shows what reaches Ollama:

```csharp
List<ChatMessage> history = [new(ChatRole.System, "Answer in one short sentence."), new(ChatRole.User, "My name is Ana.")];
ChatResponse r1 = await client.GetResponseAsync(history, options);
await client.GetResponseAsync("What is my name?", options);   // a new list
history.AddMessages(r1);                                       // append the reply
history.Add(new(ChatRole.User, "What is my name?"));
await client.GetResponseAsync(history, options);
```

```text
sent 2: system: Answer in one short sentence. | user: My name is Ana.
sent 1: user: What is my name?
without history: I don't know your name. ...
sent 4: system: Answer in one short sentence. | user: My name is Ana. | assistant: Hello Ana! How can I assist you today? | user: What is my name?
with history: Your name is Ana.
```

The name was known only on the 4-message call, in 3 of 3 runs. For stateful
services the docs describe another mode: set `ChatOptions.ConversationId` (or
copy `ChatResponse.ConversationId` from the last turn) and send only the new
messages. Ollama is stateless: `ConversationId` came back `null` every time,
and `ConversationId = "conv-123"` plus the question alone got the same "I don't
know your name". The history is yours to keep and resend, and each turn pays
input tokens for all of it.

### The pipeline and its order

`ChatClientBuilder` wraps a client in layers (`DelegatingChatClient`s or
delegates passed to `Use`). Three that record entry and exit, around a fake:

```csharp
IChatClient client = new ChatClientBuilder(fake)
    .Use(inner => new Tracer(inner, "A", log))      // DelegatingChatClient that
    .Use(inner => new Tracer(inner, "B", log))      // overrides GetResponseAsync only
    .Use(async (messages, options, next, ct) =>     // one delegate for both calls
    {
        log.Add("C enter");
        await next(messages, options, ct);
        log.Add("C exit");
    })
    .Build();
```

```text
A enter -> B enter -> C enter -> C exit -> B exit -> A exit
Tracer > Tracer > AnonymousDelegatingChatClient > ScriptedChatClient
stream: C enter -> C exit
```

The first `Use` is the outermost layer: it sees the request first and the
response last, and `Build()` returns it. The last line is the trap:
`DelegatingChatClient` forwards every method it does not override, so `A` and
`B` were skipped by the streaming call. Override both methods, or use the
shared-delegate `Use` overload, which ran for both.

`UseLogging` wrote `GetResponseAsync invoked.` and `... completed.` at `Debug`,
the same events with full messages and response as JSON at `Trace`, and nothing
at `Information`. `UseFunctionInvocation` adds the tool-calling loop (next
lesson). `UseOpenTelemetry`, the docs say, emits spans and metrics following the
OpenTelemetry GenAI semantic conventions (measured in the telemetry lesson).

### Response caching with UseDistributedCache

`UseDistributedCache` stores responses in any `IDistributedCache`. With an
in-memory cache and a fake that counts calls:

```csharp
IDistributedCache cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
IChatClient client = new ChatClientBuilder(fake).UseDistributedCache(cache).Build();
```

```text
fake calls after 2 identical = 1; same instance=False
after same text, different Temperature = 2; after different casing = 3
after 2 identical streams = 4; non-streaming after streaming same text = 5
```

The key covers messages and options: another temperature or one capital letter
misses, streaming and non-streaming entries are separate, and a hit is a
deserialized copy. In front of Ollama two identical calls reached the model
once, and the cached copy still reported `out 3` tokens: `Usage` is cached too,
so a dashboard summing it counts tokens nobody paid for.

Order matters here too: with `.UseDistributedCache().UseLogging()` two identical
calls logged once; with `.UseLogging()` first, twice. Keep what must see every
request outside the cache, and what costs money inside it.

### DI, metadata and swapping the provider

`AddChatClient` registers the pipeline and returns the builder;
`AddKeyedChatClient` does the same under a key:

```csharp
services.AddDistributedMemoryCache();
services.AddChatClient(new OllamaApiClient(ollamaUri, "qwen3:4b-instruct"))
    .UseDistributedCache()                 // IDistributedCache from DI
    .UseLogging();                         // ILoggerFactory from DI
services.AddKeyedChatClient("fake", new ScriptedChatClient("from the fake"));
```

```text
IChatClient key=(none) lifetime=Singleton
IChatClient key=fake lifetime=Singleton
main = DistributedCachingChatClient, same instance on 2nd resolve = True
metadata: Provider=ollama Uri=http://localhost:11434/ DefaultModel=qwen3:4b-instruct
GetService<OllamaApiClient> through pipeline = OllamaApiClient
fake metadata = null
ollama: 'Hello!' (ModelId=qwen3:4b-instruct, out tokens=3)
fake: 'from the fake' (ModelId=null, out tokens=null)
```

Both are singletons, so a layer must not capture a scoped service.
`GetService<ChatClientMetadata>()` on the outermost client reached the
provider's metadata; the fake offers none. The point of the interface: one
method taking `IChatClient` (system "Reply with one word.", user "Say hello.",
temperature 0) ran against both registrations (last two lines). The Ollama
line repeated in 3 of 3 runs. A provider may report no model id or
usage, so code reading them must tolerate `null`.

### Failure modes

```text
closed port 11999:    System.Net.Http.HttpRequestException: Connection refused (localhost:11999)
                      inner: System.Net.Sockets.SocketException: Connection refused
unknown model:        System.Net.Http.HttpRequestException: Response status code does not indicate success: 404 (Not Found).
cancelled before:     System.Threading.Tasks.TaskCanceledException: A task was canceled.
cancelled 300 ms in:  System.Threading.Tasks.TaskCanceledException: The operation was canceled.
cancelled mid-stream: no exception: loop ended after 5 updates, aggregated Text='1 2 3' FinishReason=null Usage=null
```

Two surprise people. Ollama's body for an unknown model says
`{"error":"model 'no-such-model:1b' not found"}`, but OllamaSharp 5.5.0 throws a
bare 404 without it. And a mid-stream cancel did not throw in 3 of 3 runs: the
`await foreach` just ended, so a partial answer looks complete unless the code
checks `FinishReason` (null here, `stop` on a real end) or the token.

## Trade-offs

- **Abstraction versus provider features.** `ChatOptions` types what most
  providers share; `AdditionalProperties`, `RawRepresentationFactory` and
  `RawRepresentation` reach the rest, and tie the code to one provider again.
- **Stateless history costs tokens.** Resending history works everywhere, but
  input tokens grow every turn. The docs list chat reducers
  (`MessageCountingChatReducer`, `SummarizingChatReducer`) as experimental.
- **Cache hits look like real calls.** The exact-match key makes hits rare for
  free text, and a hit returns the original `Usage`. Cache deterministic
  prompts (classification, extraction at temperature 0), not chat.
- **Cancellation is provider-specific.** What a cancelled stream does depends on
  the implementation; treat a `null` `FinishReason` as a partial answer.
- **Earlier versus today.** `Microsoft.Extensions.AI.Ollama` (last 9.7.0-preview)
  is deprecated on NuGet in favor of OllamaSharp. The docs say `IChatClient` and
  `IEmbeddingGenerator` were extracted from Semantic Kernel; new code uses MEAI.

## Documentation Links

- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Microsoft.Extensions.AI libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/microsoft-extensions-ai) (doc)
- [.NET + AI ecosystem tools and SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/dotnet-ai-ecosystem) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
- [OllamaSharp, GitHub](https://github.com/awaescher/OllamaSharp) (doc)
- [Microsoft.Extensions.AI.Ollama (deprecated), NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Ollama) (doc)
