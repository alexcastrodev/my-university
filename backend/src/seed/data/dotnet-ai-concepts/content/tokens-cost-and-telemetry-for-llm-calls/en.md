---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Every call to a language model is billed, limited and slowed down by tokens,
and the number you can compute before the call is not the number the model
reports after it. This lesson measures both against a local Ollama model:
`UsageDetails` on the `ChatResponse`, counting with `Microsoft.ML.Tokenizers`
and how far it is from the model's own count, turning tokens into money as a
`decimal` calculation with prices as configuration, the spans and metrics that
`UseOpenTelemetry` emits (with their real names), what `UseDistributedCache`
does to the tokens you meter, and the context window. Versions:
`Microsoft.Extensions.AI` 10.11.0, `Microsoft.ML.Tokenizers` 3.0.0 with
`Microsoft.ML.Tokenizers.Data.O200kBase` 3.0.0, `OllamaSharp` 5.5.0, Ollama
0.40.13 with `qwen3:4b-instruct`, .NET 10. Prices in the examples are made-up
round numbers, not any provider's price list.

## Use Cases

- Budgeting and alerting on tokens per feature, per user or per model.
- Rejecting or trimming a prompt before it reaches a model that would refuse it.
- A latency and token dashboard fed by standard metrics instead of hand-written
  logging.
- Knowing whether a response cache really saves money, and not counting the
  tokens it saved twice.

## Deep Dive

### What the model reports: UsageDetails

`ChatResponse.Usage` is a `UsageDetails`: `InputTokenCount`, `OutputTokenCount`,
`TotalTokenCount`, `CachedInputTokenCount`, `ReasoningTokenCount` and an
`AdditionalCounts` dictionary, all nullable. Three prompts on Ollama, default
options:

```text
"Name the capital of France in one word."                    in=17  out=2    total=19
"Olá, tudo bem? Quanto custa uma chamada ao modelo?"          in=24  out=214  total=238
"public static int Sum(int a, int b) => a + b;"              in=23  out=401  total=424
AdditionalCounts = null on all three
```

The same counts came back on every run. Ollama fills input, output and total;
cached and reasoning counts stay `null`, so code summing them must treat `null`
as "not reported", not as zero tokens. Note the output column: a short prompt
can produce 400 tokens, and providers often price output tokens above input
ones, so the answer length, not the question, can drive the bill. In a stream the usage
arrives once as a `UsageContent` item, and `ToChatResponse()` moves it into
`Usage` (previous lesson).

### Counting before you send: Microsoft.ML.Tokenizers

`TiktokenTokenizer` counts tokens locally, with no model and no network:

```csharp
Tokenizer tok = TiktokenTokenizer.CreateForModel("gpt-4o");        // needs ...Data.O200kBase
int n = tok.CountTokens("Name the capital of France in one word.");
int cut = tok.GetIndexByTokenCount(text, 5, out _, out int count);  // char index after 5 tokens
```

```text
"Name the capital of France in one word."   tiktoken 9    Ollama in=17
"Olá, tudo bem? Quanto custa uma chamada…"  tiktoken 12   Ollama in=24
"public static int Sum(int a, int b) …"     tiktoken 15   Ollama in=23
400 words "word1 word2 ..."                  tiktoken 800  Ollama in=1504
GetIndexByTokenCount(text, 5) = 14 -> "Olá, tudo bem?"     GetIndexByTokenCountFromEnd(text, 5) = 27
same Portuguese sentence: o200k = 12 tokens, cl100k = 16 tokens
```

The tokenizer is not the model's: `qwen3` has its own vocabulary, and Ollama also
counts the chat template. Tiny prompts show the template: `"a"` and `"Hello"`
each reported `in=9`, `"Hello world"` `in=10`, and adding the system message
"Be brief." (3 tiktoken tokens) moved `"a"` from 9 to 17. About 8 tokens of
overhead per request plus about 5 per extra message, then a vocabulary
difference on top: the 400-word text was 1.9 times larger for the model. A
different tiktoken vocabulary changes the count too (12 against 16). Use the
tokenizer for budgets, margins and trimming (`GetIndexByTokenCount` cuts text
at a token boundary); use `Usage` for the truth after the call.

The vocabulary data lives in separate packages. Asking for the `gpt-4` name
(cl100k) without `Microsoft.ML.Tokenizers.Data.Cl100kBase` threw
`InvalidOperationException: The tokenizer data file Microsoft.ML.Tokenizers.Data.Cl100kBase.dll
could not be loaded. Please reference the package Microsoft.ML.Tokenizers.Data.Cl100kBase in your project.`
The `gpt-4o` name needs the `O200kBase` package the same way.

### From tokens to money

Cost is arithmetic over `UsageDetails`. Keep the prices out of the code, they
change and differ per model:

```csharp
public sealed record ModelPrice(decimal InputPerMillionTokens, decimal OutputPerMillionTokens);

public static decimal Estimate(UsageDetails? u, ModelPrice p) =>
    u is null ? 0m
    : ((u.InputTokenCount ?? 0) * p.InputPerMillionTokens + (u.OutputTokenCount ?? 0) * p.OutputPerMillionTokens) / 1_000_000m;
```

With a made-up `ModelPrice(3m, 15m)`, 1000 input and 500 output tokens cost
`0.0105`; the lab's tests pin this. Use `decimal`: `double` accumulates binary
error in sums that must be reconciled with an invoice. Bind `ModelPrice` from
configuration (a dictionary by model id, matched against `ChatResponse.ModelId`)
and treat the result as an estimate: providers bill by their own rules, and
this Ollama model costs no money at all, so the same code there prices a model
you would run in the cloud, or reports zero.

### What UseOpenTelemetry emits

```csharp
IChatClient c = new ChatClientBuilder(ollama)
    .UseOpenTelemetry(sourceName: "lab.llm", configure: o => o.EnableSensitiveData = false)
    .Build();
```

The decorator creates an `ActivitySource` and a `Meter`, both named by
`sourceName`. Without an OpenTelemetry SDK nothing leaves the process, but a
`MeterListener` and an `ActivityListener` see everything, which is how this
lesson (and the lab) read it. Instruments of the meter after one streaming and
one non-streaming call:

```text
gen_ai.client.token.usage                    {token}   histogram   tags: gen_ai.token.type = input | output
gen_ai.client.operation.duration             s         histogram
gen_ai.client.operation.time_to_first_chunk  s         histogram   (streaming only)
gen_ai.client.operation.time_per_output_chunk s        histogram   (streaming only)
```

Non-streaming call: `token.usage = 17` (`input`), `= 2` (`output`),
`operation.duration = 2.490` on the first call of that run and between 0.02 and
0.09 once warm. Every measurement carries the tags `gen_ai.operation.name=chat`,
`gen_ai.request.model`, `gen_ai.provider.name=ollama`, `server.address`,
`server.port` and `gen_ai.response.model`. Each streamed update added a
`time_per_output_chunk` of about 0.01 s. The span:

```text
activity name = "chat qwen3:4b-instruct"   kind = Client
gen_ai.operation.name=chat  gen_ai.request.model=qwen3:4b-instruct  gen_ai.provider.name=ollama
server.address=localhost  server.port=11434  gen_ai.request.seed=42  gen_ai.request.temperature=0
gen_ai.response.finish_reasons=["stop"]  gen_ai.response.id=...  gen_ai.response.model=qwen3:4b-instruct
gen_ai.usage.input_tokens=17  gen_ai.usage.output_tokens=2
```

A streaming span adds `gen_ai.request.stream=True` and
`gen_ai.response.time_to_first_chunk`. A failure (port 11999 closed) set the
status to `Error` with the description `Connection refused (localhost:11999)`,
the tag `error.type=System.Net.Http.HttpRequestException`, and recorded the
`operation.duration` with the same `error.type` tag. The underlying
`HttpClient` has its own `System.Net.Http` span and `http.client.request.duration`
metric, a separate layer.

Prompts and answers are not recorded by default. With
`EnableSensitiveData = true` the span also carried `gen_ai.input.messages` and
`gen_ai.output.messages` as JSON, and, in this run, the provider's extra
response properties (`load_duration`, `total_duration`, `prompt_eval_duration`,
`eval_duration`) as tags. Treat that as personal data: prompts contain what
users typed. To ship the data, register the names with an OpenTelemetry SDK
(`AddSource("lab.llm")` and `AddMeter("lab.llm")`, per the OpenTelemetry .NET
docs; not run here). The names follow the OpenTelemetry GenAI semantic
conventions, which the docs for the extension point to.

### The cache, and whose tokens you count

`UseDistributedCache` returns a stored response for an identical request, and
the stored response still has its `Usage`. Five identical calls through it
reached the model once:

```text
model calls = 1
naive sum of response.Usage:  in = 85, out = 10  -> 0.000405 at ModelPrice(3, 15)
tokens really spent:          in = 17, out = 2   -> 0.000081
```

Anything that sums `response.Usage` outside the cache overstates the cost five
times here. Telemetry has the same trap, and the position of the layers decides
it. With `UseOpenTelemetry` outside the cache, the hit still emitted
`token.usage` 17 and 2 again (and a span, with `operation.duration` 0.002 s
against 0.087 s for the miss): 2 spans and 4 token measurements for 1 model
call. With the cache outside and `UseOpenTelemetry` inside, there was 1 span and
2 measurements. Rule: a layer that counts what the user asked goes outside the
cache, a layer that counts what was paid for goes inside it. The lab builds
`cache -> OpenTelemetry -> UsageMeter -> model`, so a hit reaches neither the
meter nor the metrics, and the hit still returns a `Usage`.

### The context window

Two numbers matter: the model's maximum (`/api/show` reported
`qwen3.context_length = 262144`) and the context the server allocates, which
here defaulted to 4096 tokens. A prompt of 60905 tokens failed:

```text
OllamaSharp.Models.Exceptions.OllamaException: request (60905 tokens) exceeds the available context size (4096 tokens), try increasing it
```

The context holds the prompt and the answer, so the budget is window minus the
room kept for output. `num_ctx` is an Ollama option, reached through the raw
request (`ChatOptions.RawRepresentationFactory`, returning an OllamaSharp
`ChatRequest` with `Options = new RequestOptions { NumCtx = ... }`). A prompt the
model counted as 1504 tokens failed at `num_ctx` 512 and 1024 with the same
message, and ran at 2048 and 4096 (`in=1504 out=5 finish=length` with
`MaxOutputTokens = 5`). Here the server refused; the embeddings lesson found
silent truncation in another path, so check what your provider does. A
`ContextGuard` built on the tokenizer, as in the lab, drops the oldest
non-system messages until the estimate fits, and with the 8-plus-5 tokens of
template overhead above it must keep a margin. Every turn of a stateless chat
resends the whole history, and tool definitions are sent every request too (tool
calling lesson): both eat the same window.

## Trade-offs

- **Estimate before, truth after.** A local tokenizer gives a budget, never an
  exact count for another vendor's model. Keep a margin and let `Usage` correct
  the books.
- **Metering position decides the numbers.** The same cache produced 1 or 2
  spans for one model call depending on layer order. Decide whether a number
  means "requested" or "paid".
- **Sensitive data in telemetry.** Prompt and answer capture is off for a
  reason. If you turn it on, put it behind a flag, sampling and retention rules.
- **Prices rot.** Prices belong in configuration with a date. A hard-coded rate
  turns into a silently wrong report.
- **Cached tokens are not free tokens in the books.** Cache hits keep their
  `Usage`. Subtract them, or meter below the cache.
- **Earlier versus today.** The GenAI semantic conventions are still evolving,
  so tag and instrument names can change between package versions. Pin the
  version of `Microsoft.Extensions.AI` and re-check names when you upgrade.

## Documentation Links

- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [UsageDetails class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.ai.usagedetails) (doc)
- [Understanding tokens, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/understanding-tokens) (doc)
- [Microsoft.ML.Tokenizers, NuGet](https://www.nuget.org/packages/Microsoft.ML.Tokenizers) (doc)
- [Semantic conventions for generative AI metrics, OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) (doc)
- [Semantic conventions for generative AI spans, OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) (doc)
- [Collect metrics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/metrics-collection) (doc)
- [Context length, Ollama docs](https://docs.ollama.com/context-length) (doc)
