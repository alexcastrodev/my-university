---
version: 1.0
updatedAt: 2026-10-30
title: "Microsoft Agent Framework: Agentes, Sessões e Ferramentas"
summary: AsAIAgent e ChatClientAgent, RunAsync e RunStreamingAsync com AgentResponse, o histórico que a sessão reenvia a cada turno, ConversationId de serviços com estado, serializar a sessão e continuar em outro processo, a perda de mensagens com execuções concorrentes, ferramentas e aprovação no agente, um agente como ferramenta de outro, middleware de execução e de função, context providers que acumulam mensagens no histórico, saída estruturada e OpenTelemetry.
---
## Objective

O Microsoft Agent Framework (`Microsoft.Agents.AI`) coloca um agente sobre um
`IChatClient`: instruções, nome e descrição, ferramentas cujo loop ele executa,
uma sessão que guarda a conversa, middleware e context providers que adicionam
memória antes de cada execução. Como o agente envolve um `IChatClient`, tudo
pode ser medido: a lição roda `qwen3:4b-instruct` no Ollama (3 execuções por
afirmação) e um `IChatClient` fake roteirizado que registra cada requisição.
Versões: `Microsoft.Agents.AI` e `.Abstractions` 1.26.0 (estável),
`Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama 0.40.12, .NET 10.

## Use Cases

- Um assistente de suporte ou operações que mantém a conversa entre requisições HTTP.
- Ferramentas e aprovações configuradas uma vez no agente, não em cada chamada.
- Um agente roteador que delega a agentes especialistas expostos como ferramentas.
- Injetar memória do usuário ou fatos recuperados antes de cada execução, num só lugar.

## Deep Dive

### O menor agente e o AgentResponse

`AsAIAgent` em qualquer `IChatClient` devolve um `ChatClientAgent` (um `AIAgent`):

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

Igual em 3 de 3 execuções. `AgentResponse` espelha `ChatResponse` e acrescenta
`AgentId` (aleatório por instância); `RunStreamingAsync` produz
`AgentResponseUpdate`s que `ToAgentResponse()` junta de volta, com o usage.

### A sessão: o que o turno 2 envia

Dois turnos numa `ChatClientAgentSession`, contra um fake que registra a entrada:

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

O agente reenvia o histórico inteiro a cada turno (tokens de entrada crescendo),
como na lição de `IChatClient`. As instruções vão em `ChatOptions.Instructions`,
nunca no histórico, que fica no `StateBag` da sessão (o padrão é
`InMemoryChatHistoryProvider`). Recebendo um `ConversationId`, o agente guarda
só o id e envia só a mensagem nova; o Ollama não devolve nenhum. A documentação
avisa que ids de serviço valem por chave de API, não por usuário final.

### Serializar e continuar em outro processo

```csharp
JsonElement json = await agent.SerializeSessionAsync(session);    // processo 1
File.WriteAllText(path, json.GetRawText());
AgentSession restored = await agent.DeserializeSessionAsync(      // processo 2, agente novo
    JsonDocument.Parse(File.ReadAllText(path)).RootElement);
```

```text
process 1: "My name is Ana and I live in Porto." -> Hello Ana, it's nice to meet you! ...
saved 414 chars: {"stateBag":{"InMemoryChatHistoryProvider":{"messages":[{"role":"user",...
process 2: "What is my name and where do I live?" -> Your name is Ana, and you live in Porto.
```

Mesma resposta em 3 de 3 execuções. O JSON guarda as mensagens, mas não as
instruções nem as ferramentas (são do agente: restaure com a mesma
configuração). A página de sessão mostra `agent.SerializeSession(session)`; a
1.26.0 só tem `SerializeSessionAsync`.

### Uma sessão, duas execuções concorrentes

Duas chamadas `RunAsync` na mesma sessão ao mesmo tempo, com um fake de 200 ms:

```text
call 2 sent: first | reply 1 | B          call 3 sent: first | reply 1 | A
history after: 5: first | reply 1 | A | B | reply 2              (13 of 20 runs)
history after: 6: first | reply 1 | B | reply 3 | A | reply 2    (7 of 20 runs)
```

Nada lançou exceção, nenhuma execução viu a mensagem da outra, e em 13 de 20
uma resposta sumiu. Serialize as requisições por conversa (um lock por sessão).

### Ferramentas e aprovação: o agente roda o loop

`tools:` (ou `ChatOptions.Tools`) recebe as `AIFunction`s da lição de tool calling:

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

O qwen3 repetiu essas linhas em 3 de 3 execuções (entrada 378 ou 379). O agente
adiciona seu próprio `FunctionInvokingChatClient` (`GetService` o achou); com
`UseProvidedChatClientAsIs = true` não adiciona nada, e um pipeline próprio
precisa de `UseFunctionInvocation()`. Uma `ApprovalRequiredAIFunction` interrompe
a execução, e `req.CreateResponse(true)` volta como nova execução na mesma sessão:

```text
r1: fake calls=1 tool runs=0  ToolApprovalRequest Transfer({"to":"ACC-42","amount":250})
r2: fake calls=2 tool runs=1  FunctionResult "Transferred 250 to ACC-42."   history: 6
```

O modelo viu só chamada e resultado. `UseToolApproval(...)` também compila; a
documentação da API descreve regras de "não perguntar de novo" na sessão.

### Um agente como ferramenta

`AsAIFunction()` transforma um agente numa `AIFunction` com uma string `query`:

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

Idêntico em 3 de 3 execuções (entrada do pai de 435 a 437). Nome e descrição
são o prompt de roteamento; conte tokens por client. A documentação da API diz
que cada chamada ganha uma sessão nova, a menos que se passe uma a `AsAIFunction`.

### Middleware: execução e chamada de função

`AsBuilder()` adiciona camadas no nível do agente: uma sobrecarga envolve a
execução, outra cada chamada de função (segundo a documentação, só em agentes
que usam `FunctionInvokingChatClient`, como o `ChatClientAgent`):

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

O delegate compartilhado rodou também no streaming, mas a documentação diz que
ele não pode substituir a saída (`Use(runFunc:, runStreamingFunc:)` pode).

### Context providers

Um `AIContextProvider` devolve um `AIContext` (instruções, mensagens, tools)
antes de cada execução, registrado em `ChatClientAgentOptions.AIContextProviders`:

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

Mensagens injetadas são gravadas (a documentação da API: "may become permanent
additions"), e um fato injetado a cada turno se acumula. A correção: um
`InMemoryChatHistoryProvider` cujo `StorageInputRequestMessageFilter` mantém só
mensagens `AgentRequestMessageSourceType.External`. `TextSearchProvider` (RAG) e
`ChatHistoryMemoryProvider` (memória vetorial) também vêm no pacote (não rodados).

### Saída estruturada e telemetria

`RunAsync<City>("Porto is a city in Portugal with about 250000 inhabitants.")`
devolveu `Result = City { Name = Porto, Country = Portugal, Population =
250000 }` em 3 de 3 execuções (detalhes na lição de saída estruturada).
`AsBuilder().UseOpenTelemetry("my-agents")` adiciona spans (lição de telemetria).

## Trade-offs

- **O histórico local é seu para guardar.** `SerializeSessionAsync` gera um JSON
  por conversa, que cresce a cada turno e não aceita execuções concorrentes. No
  serviço o estado muda de lugar, mas os ids precisam ser ligados ao usuário.
- **Só documentação, não rodado aqui.** Hospedagem no Foundry, A2A, agentes
  duráveis no Azure Functions (o anúncio da 1.0, de 3 de abril de 2026, lista
  agentes hospedados como preview) e provedores de nuvem; `.A2A`, `.Hosting` e
  `.DurableTask` de `Microsoft.Agents.AI` só existem como prerelease no NuGet.
- **Antes versus hoje.** A visão geral chama o Agent Framework de sucessor direto
  do Semantic Kernel e do AutoGen; o guia de migração mapeia `ChatCompletionAgent`
  para `ChatClientAgent`, `AgentThread` para `AgentSession`, `InvokeAsync` para
  `RunAsync` e plugins de `KernelFunction` para `AIFunction`.

## Documentation Links

- [Microsoft Agent Framework Overview, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/overview/) (doc)
- [Session, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/session) (doc)
- [Agent Middleware, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/middleware/) (doc)
- [Context Providers, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/context-providers) (doc)
- [Tools Overview, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/) (doc)
- [Semantic Kernel to Microsoft Agent Framework Migration Guide, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel/) (doc)
