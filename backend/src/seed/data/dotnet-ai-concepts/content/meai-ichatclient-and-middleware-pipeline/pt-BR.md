---
version: 1.0
updatedAt: 2026-10-29
title: "Microsoft.Extensions.AI: IChatClient e o Pipeline de Middleware"
summary: IChatClient, ChatMessage e ChatOptions, GetResponseAsync versus streaming com ToChatResponse, o formato do ChatResponse com Usage real do Ollama, histórico sem estado versus ConversationId, a ordem do ChatClientBuilder provada com um DelegatingChatClient, UseLogging e UseDistributedCache medidos, AddChatClient e AddKeyedChatClient no DI, GetService e ChatClientMetadata, troca de provedor por um fake e as falhas exatas do OllamaSharp.
---
## Objective

`Microsoft.Extensions.AI` (MEAI) é a base de toda esta trilha.
`Microsoft.Extensions.AI.Abstractions` define `IChatClient`, uma interface com
duas chamadas que os provedores implementam; `Microsoft.Extensions.AI` adiciona
o pipeline do `ChatClientBuilder` (logging, cache, ferramentas, telemetria) em
volta de qualquer `IChatClient`. A lição chama um modelo local do Ollama, lê a
resposta, prova a ordem do pipeline, mede um acerto de cache, registra clientes
no DI, troca o provedor por um fake e registra as falhas exatas.
Versões: `Microsoft.Extensions.AI` e `.Abstractions` 10.11.0, `OllamaSharp`
5.5.0, `Microsoft.Extensions.Caching.Memory` 10.0.14, Ollama 0.40.12 com
`qwen3:4b-instruct`, .NET 10.

## Use Cases

- Programar contra `IChatClient`, para que o provedor (Ollama local, um modelo
  na nuvem em produção) seja um detalhe de registro.
- Logging, cache ou telemetria em toda chamada ao modelo, num lugar só.
- Testes unitários com um `IChatClient` fake: sem rede, respostas fixas.
- Fazer streaming da resposta para a UI e ainda obter um `ChatResponse` com uso.

## Deep Dive

### Uma chamada, e o que volta

`OllamaApiClient` (OllamaSharp) implementa `IChatClient`. Uma string vira uma
`ChatMessage` de usuário; `ChatOptions` traz os ajustes comuns tipados:

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

Mesma resposta e contagens em 3 de 3 execuções; `Usage` bate com a resposta
crua de `/api/chat` (`prompt_eval_count` 17, `eval_count` 2). A documentação
diz que uma resposta pode ter várias mensagens (um loop de ferramentas adiciona
algumas), a última sendo a final. `ResponseId` vem como timestamp.

### Streaming, e juntar as atualizações de volta

`GetStreamingResponseAsync` recebe as mesmas entradas e devolve
`IAsyncEnumerable<ChatResponseUpdate>`:

```csharp
List<ChatResponseUpdate> updates = [];
await foreach (var u in client.GetStreamingResponseAsync("Count from 1 to 10, separated by spaces.", options))
    updates.Add(u);                      // uma UI imprimiria u.Text aqui
ChatResponse r = updates.ToChatResponse();   // ou .ToChatResponseAsync() no stream
```

```text
updates = 21, first update: Text='1' Role=assistant
updates carrying UsageContent = 1, last FinishReason = stop
ToChatResponse: Messages=1 Text='1 2 3 4 5 6 7 8 9 10' Usage in 21 out 21 Finish=stop
```

Idêntico em 3 de 3 execuções. O uso chega uma vez, como um item
`UsageContent`, e `ToChatResponse` o move para `ChatResponse.Usage`; código que
imprime `u.Text` e descarta as atualizações perde as contagens de tokens.

### O cliente não lembra

`IChatClient` não guarda conversa. Um `DelegatingChatClient` que imprime o que
repassa mostra o que chega ao Ollama:

```csharp
List<ChatMessage> history = [new(ChatRole.System, "Answer in one short sentence."), new(ChatRole.User, "My name is Ana.")];
ChatResponse r1 = await client.GetResponseAsync(history, options);
await client.GetResponseAsync("What is my name?", options);   // uma lista nova
history.AddMessages(r1);                                       // anexa a resposta
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

O nome só foi lembrado na chamada com 4 mensagens, em 3 de 3 execuções. Para
serviços com estado, a documentação descreve outro modo: definir
`ChatOptions.ConversationId` (ou copiar `ChatResponse.ConversationId`) e enviar
só as mensagens novas. O Ollama não guarda estado: `ConversationId` voltou
`null` sempre, e `"conv-123"` com só a pergunta recebeu o mesmo "I don't know
your name". O histórico é seu, e cada turno paga tokens de entrada por ele.

### O pipeline e sua ordem

`ChatClientBuilder` envolve um cliente em camadas (`DelegatingChatClient`s ou
delegates passados a `Use`). Três que registram entrada e saída, sobre um fake:

```csharp
IChatClient client = new ChatClientBuilder(fake)
    .Use(inner => new Tracer(inner, "A", log))      // DelegatingChatClient que
    .Use(inner => new Tracer(inner, "B", log))      // sobrescreve só GetResponseAsync
    .Use(async (messages, options, next, ct) =>     // um delegate para as duas chamadas
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

O primeiro `Use` é a camada mais externa: vê a requisição primeiro e a resposta
por último, e é o que `Build()` devolve. A última linha é a armadilha:
`DelegatingChatClient` repassa todo método que não sobrescreve, então `A` e `B`
foram pulados na chamada de streaming. Sobrescreva os dois métodos, ou use a
sobrecarga de `Use` com delegate compartilhado, que rodou nos dois.

`UseLogging` escreveu `GetResponseAsync invoked.` e `... completed.` em `Debug`,
os mesmos eventos com mensagens e resposta em JSON em `Trace`, e nada em
`Information`. `UseFunctionInvocation` adiciona o loop de ferramentas (próxima
lição). `UseOpenTelemetry`, segundo a documentação, emite spans e métricas nas
convenções GenAI do OpenTelemetry (medidas na lição de telemetria).

### Cache de respostas com UseDistributedCache

`UseDistributedCache` guarda respostas em qualquer `IDistributedCache`. Com um
cache em memória e um fake que conta chamadas:

```csharp
IDistributedCache cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
IChatClient client = new ChatClientBuilder(fake).UseDistributedCache(cache).Build();
```

```text
fake calls after 2 identical = 1; same instance=False
after same text, different Temperature = 2; after different casing = 3
after 2 identical streams = 4; non-streaming after streaming same text = 5
```

A chave cobre mensagens e opções: outra temperatura ou uma maiúscula é miss,
streaming e sem streaming têm entradas separadas, e um acerto é uma cópia
desserializada. Na frente do Ollama, duas chamadas idênticas chegaram ao modelo
uma vez, e a cópia ainda informou `out 3` tokens: `Usage` vai junto para o
cache, então um painel que o soma conta tokens que ninguém pagou.

A ordem importa aqui também: com `.UseDistributedCache().UseLogging()` duas
chamadas idênticas geraram log uma vez; com `.UseLogging()` primeiro, duas.
Deixe fora do cache o que precisa ver toda requisição, e dentro o que custa.

### DI, metadados e troca de provedor

`AddChatClient` registra o pipeline e devolve o builder; `AddKeyedChatClient`
faz o mesmo sob uma chave:

```csharp
services.AddDistributedMemoryCache();
services.AddChatClient(new OllamaApiClient(ollamaUri, "qwen3:4b-instruct"))
    .UseDistributedCache()                 // IDistributedCache vindo do DI
    .UseLogging();                         // ILoggerFactory vindo do DI
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

Os dois são singletons, então uma camada não pode capturar um serviço scoped.
`GetService<ChatClientMetadata>()` no cliente externo alcançou os metadados do
provedor; o fake não tem. O motivo da interface: um método que recebe
`IChatClient` (system "Reply with one word.", user "Say hello.", temperatura 0)
rodou contra os dois registros (duas últimas linhas), e a linha do Ollama se
repetiu em 3 de 3 execuções. Um provedor pode não informar model id nem uso:
tolere `null`.

### Modos de falha

```text
closed port 11999:    System.Net.Http.HttpRequestException: Connection refused (localhost:11999)
                      inner: System.Net.Sockets.SocketException: Connection refused
unknown model:        System.Net.Http.HttpRequestException: Response status code does not indicate success: 404 (Not Found).
cancelled before:     System.Threading.Tasks.TaskCanceledException: A task was canceled.
cancelled 300 ms in:  System.Threading.Tasks.TaskCanceledException: The operation was canceled.
cancelled mid-stream: no exception: loop ended after 5 updates, aggregated Text='1 2 3' FinishReason=null Usage=null
```

Dois surpreendem. Para modelo desconhecido o Ollama responde
`{"error":"model 'no-such-model:1b' not found"}`, mas o OllamaSharp 5.5.0 lança
um 404 sem esse texto. E cancelar no meio do stream não lançou exceção em 3 de 3
execuções: o `await foreach` só terminou, e a resposta parcial parece completa
se o código não conferir `FinishReason` (null aqui, `stop` num fim real).

## Trade-offs

- **Abstração versus recursos do provedor.** `ChatOptions` tipa o que os
  provedores compartilham; `AdditionalProperties`, `RawRepresentationFactory` e
  `RawRepresentation` alcançam o resto e prendem o código a um provedor.
- **Histórico sem estado custa tokens.** Reenviar funciona em qualquer provedor,
  mas a entrada cresce a cada turno. A documentação lista redutores
  (`MessageCountingChatReducer`, `SummarizingChatReducer`) como experimentais.
- **Acerto de cache parece chamada real.** A chave exata torna acertos raros em
  texto livre, e um acerto devolve o `Usage` original. Faça cache de prompts
  determinísticos (classificação, extração com temperatura 0), não de chat.
- **Cancelamento depende do provedor.** O que um stream cancelado faz depende da
  implementação; trate `FinishReason` `null` como resposta parcial.
- **Antes versus hoje.** `Microsoft.Extensions.AI.Ollama` (última 9.7.0-preview)
  está deprecated no NuGet em favor do OllamaSharp. A documentação diz que
  `IChatClient` e `IEmbeddingGenerator` saíram do Semantic Kernel; use o MEAI.

## Documentation Links

- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Microsoft.Extensions.AI libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/microsoft-extensions-ai) (doc)
- [.NET + AI ecosystem tools and SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/dotnet-ai-ecosystem) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
- [OllamaSharp, GitHub](https://github.com/awaescher/OllamaSharp) (doc)
- [Microsoft.Extensions.AI.Ollama (deprecated), NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Ollama) (doc)
