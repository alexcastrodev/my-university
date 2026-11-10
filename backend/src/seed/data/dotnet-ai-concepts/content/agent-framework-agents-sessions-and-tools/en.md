---
version: 1.0
updatedAt: 2026-10-30
---
## Objective

Microsoft Agent Framework (`Microsoft.Agents.AI`) puts an agent on top of an
`IChatClient`: instructions, name and description, tools whose loop it runs,
a session that keeps the conversation, middleware, and context providers that
add memory before each run. Since the agent wraps an `IChatClient`, all of it
can be measured: this lesson runs `qwen3:4b-instruct` on Ollama (3 runs per
claim) and a scripted fake `IChatClient` that records every request. Versions:
`Microsoft.Agents.AI` and `.Abstractions` 1.26.0 (stable),
`Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama 0.40.12, .NET 10.

## Use Cases

- A support or ops assistant that keeps a conversation across HTTP requests.
- Tools and approvals configured once on the agent, not on every call.
- A router agent that delegates to specialist agents exposed as tools.
- Injecting user memory or retrieved facts before each run, in one place.

## Deep Dive

### The smallest agent and AgentResponse

`AsAIAgent` on any `IChatClient` returns a `ChatClientAgent` (an `AIAgent`):

```csharp
AIAgent agent = new OllamaApiClient(uri, "qwen3:4b-instruct")
    .AsAIAgent(instructions: "Answer in one short sentence.", name: "Helper");
AgentResponse r = await agent.RunAsync("Name the capital of France in one word.",
    options: new ChatClientAgentRunOptions(new ChatOptions { Temperature = 0, Seed = 42 }));
```

```text
type=ChatClientAgent name=Helper   AgentId=b49d9b73f94e4850b68a64168130d6c5
Messages=1 Text=Paris. Usage in 28 out 3 Finish=stop ToString=Paris.
stream: updates=10 first='1' ToAgentResponse Text='1 2 3 4 5' Usage in 31 out 10
```

Same in 3 of 3 runs. `AgentResponse` mirrors `ChatResponse` and adds
`AgentId` (random per instance); `RunStreamingAsync` yields
`AgentResponseUpdate`s that `ToAgentResponse()` folds back, usage included.

### The session: what turn 2 sends

Two turns on a `ChatClientAgentSession`, against a fake that records its input:

```csharp
AIAgent agent = fake.AsAIAgent(instructions: "Be brief.");
AgentSession session = await agent.CreateSessionAsync();
await agent.RunAsync("My name is Ana.", session);
await agent.RunAsync("What is my name?", session);
```

```text
call 1: 1 message,  Instructions=Be brief.  user: My name is Ana.
call 2: 3 messages, Instructions=Be brief.  user: My name is Ana. | assistant: reply 1 | user: What is my name?
in session: 4 messages          without a session, call 2 sent 1 message
fake returning ConversationId="conv-1": call 2 sent 1 message + ConversationId, local history 0
```

The agent resends the whole history every turn (growing input tokens), as in
the `IChatClient` lesson. Instructions go in `ChatOptions.Instructions`, never
into the history, which lives in the session's `StateBag` (default
`InMemoryChatHistoryProvider`). Given a `ConversationId`, the agent keeps only
the id and sends only the new message; Ollama returns none. The docs warn that
service ids are scoped to the API key, not to your end user.

### Serialize, then continue in another process

```csharp
JsonElement json = await agent.SerializeSessionAsync(session);    // process 1
File.WriteAllText(path, json.GetRawText());
AgentSession restored = await agent.DeserializeSessionAsync(      // process 2, new agent
    JsonDocument.Parse(File.ReadAllText(path)).RootElement);
```

```text
process 1: "My name is Ana and I live in Porto." -> Hello Ana, it's nice to meet you! ...
saved 414 chars: {"stateBag":{"InMemoryChatHistoryProvider":{"messages":[{"role":"user",...
process 2: "What is my name and where do I live?" -> Your name is Ana, and you live in Porto.
```

Same answer in 3 of 3 runs. The JSON holds messages but no instructions or
tools (they belong to the agent: restore with the same configuration). The
session page shows `agent.SerializeSession(session)`; 1.26.0 has only
`SerializeSessionAsync`.

### One session, two concurrent runs

Two `RunAsync` calls on the same session at once, with a 200 ms fake:

```text
call 2 sent: first | reply 1 | B          call 3 sent: first | reply 1 | A
history after: 5: first | reply 1 | A | B | reply 2              (13 of 20 runs)
history after: 6: first | reply 1 | B | reply 3 | A | reply 2    (7 of 20 runs)
```

Nothing threw, neither run saw the other's message, and in 13 of 20 runs a
reply vanished. Serialize requests per conversation (a per-session lock).

### Tools and approval: the agent runs the loop

`tools:` (or `ChatOptions.Tools`) takes the tool-calling lesson's `AIFunction`s:

```csharp
AIAgent agent = client.AsAIAgent(instructions: "Answer in one sentence.",
    tools: [AIFunctionFactory.Create(Tools.GetWeather)]);
```

```text
fake:  calls=2 tool runs=1 response messages=3, session history 4
qwen3: model calls=2 tool runs=1 Usage in 378 out 36
  FunctionCall GetWeather({"city":"Lisbon"}) -> "Lisbon: 18 C, light rain"
  assistant: The weather in Lisbon is 18°C with light rain.
UseProvidedChatClientAsIs=true: fake calls=1 tool runs=0, the FunctionCall is returned
```

The qwen3 lines repeated in 3 of 3 runs (input 378 or 379). The agent adds its
own `FunctionInvokingChatClient` (`GetService` found it); with
`UseProvidedChatClientAsIs = true` it adds nothing, so a custom pipeline needs
`UseFunctionInvocation()`. An `ApprovalRequiredAIFunction` stops the run, and
`req.CreateResponse(true)` goes back as a new run on the same session:

```text
r1: fake calls=1 tool runs=0  ToolApprovalRequest Transfer({"to":"ACC-42","amount":250})
r2: fake calls=2 tool runs=1  FunctionResult "Transferred 250 to ACC-42."   history: 6
```

The model saw only call and result. `UseToolApproval(...)` compiles too; its
API docs describe "don't ask again" rules kept in the session.

### An agent as a tool

`AsAIFunction()` turns an agent into an `AIFunction` with one `query` string:

```csharp
AIAgent specialist = specClient.AsAIAgent(name: "CurrencyExpert",
    description: "Converts amounts between EUR and USD.",
    instructions: "You convert currencies. Use exactly 1 EUR = 1.10 USD. Answer with the number only.");
AIAgent parent = parentClient.AsAIAgent(tools: [specialist.AsAIFunction()], instructions: "... call CurrencyExpert ...");
```

```text
parent model calls=2 specialist model calls=1
  FunctionCall CurrencyExpert({"query":"200 euros to us dollars"}) -> FunctionResult "220"
  assistant: 200 euros is equivalent to 220 US dollars.
parent Usage in 435 = its own two calls; the specialist's 43 input tokens are not in it
```

Identical in 3 of 3 runs (parent input 435 to 437). Name and description are
the routing prompt; count tokens per client. The API docs say each call gets a
new session unless one is passed to `AsAIFunction`.

### Middleware: run and function calling

`AsBuilder()` adds agent-level layers: one overload wraps the run, another
each function call (the docs say: only on agents that use
`FunctionInvokingChatClient`, such as `ChatClientAgent`):

```csharp
AIAgent agent = inner.AsBuilder()
    .Use(async (msgs, session, options, next, ct) =>
        { log.Add("run enter"); await next(msgs, session, options, ct); log.Add("run exit"); })
    .Use(async (agent, ctx, next, ct) => ctx.Function.Name == "DeleteAccount"
        ? "Blocked by policy: DeleteAccount needs a human." : await next(ctx, ct))
    .Build();
```

```text
run enter -> function GetWeather -> function DeleteAccount -> run exit
DeleteAccount runs=0 GetWeather runs=1   streaming run: run enter -> run exit
tool: FunctionResult "Lisbon: 18 C, light rain" + FunctionResult "Blocked by policy: ..."
```

The shared delegate ran for streaming too, but the docs say it cannot replace
the output (`Use(runFunc:, runStreamingFunc:)` can).

### Context providers

An `AIContextProvider` returns an `AIContext` (instructions, messages, tools)
before each run; attach it through `ChatClientAgentOptions.AIContextProviders`:

```csharp
sealed class CustomerContext : AIContextProvider
{
    protected override ValueTask<AIContext> ProvideAIContextAsync(InvokingContext c, CancellationToken ct = default)
        => ValueTask.FromResult(new AIContext { Instructions = "The customer is on the Premium plan.",
            Messages = [new ChatMessage(ChatRole.User, "Memory: the customer lives in Porto.")] });
}
```

```text
call 1: Instructions=Be brief.\nThe customer is on the Premium plan.
        user: Which plan am I on? | user: Memory: the customer lives in Porto.
call 2: user: Which plan am I on? | user: Memory: ... | assistant: reply 1 | user: And my city? | user: Memory: ...
history: 6 (memory line stored twice)    with the filter below: 4
```

Injected messages are stored (the API docs: they "may become permanent
additions"), so a fact injected every turn piles up. The fix: an
`InMemoryChatHistoryProvider` whose `StorageInputRequestMessageFilter` keeps
only `AgentRequestMessageSourceType.External` messages. `TextSearchProvider`
(RAG) and `ChatHistoryMemoryProvider` (vector memory) also ship (not run).

### Structured output and telemetry

`RunAsync<City>("Porto is a city in Portugal with about 250000 inhabitants.")`
returned `Result = City { Name = Porto, Country = Portugal, Population =
250000 }` in 3 of 3 runs (details in the structured output lesson).
`AsBuilder().UseOpenTelemetry("my-agents")` adds agent spans (telemetry lesson).

## Trade-offs

- **Local history is yours to store.** `SerializeSessionAsync` gives JSON to
  save per conversation; it grows every turn and is not safe for concurrent
  runs. Service history moves the state, but its ids need user scoping.
- **Docs only, not run here.** Foundry hosting, A2A, durable agents on Azure
  Functions (the April 3, 2026 1.0 announcement lists hosted agents as preview)
  and cloud providers; `Microsoft.Agents.AI.A2A`, `.Hosting`, `.DurableTask`
  are prerelease only on NuGet.
- **Earlier versus today.** The overview calls Agent Framework the direct
  successor of Semantic Kernel and AutoGen; the migration guide maps
  `ChatCompletionAgent` to `ChatClientAgent`, `AgentThread` to `AgentSession`,
  `InvokeAsync` to `RunAsync` and `KernelFunction` plugins to `AIFunction`.

## Documentation Links

- [Microsoft Agent Framework Overview, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/overview/) (doc)
- [Session, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/session) (doc)
- [Agent Middleware, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/middleware/) (doc)
- [Context Providers, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/context-providers) (doc)
- [Tools Overview, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/) (doc)
- [Semantic Kernel to Microsoft Agent Framework Migration Guide, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel/) (doc)
