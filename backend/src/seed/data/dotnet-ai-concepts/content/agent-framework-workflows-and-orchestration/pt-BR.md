---
version: 1.0
updatedAt: 2026-11-12
title: "Microsoft Agent Framework: Workflows e Orquestração"
summary: WorkflowBuilder, executors e supersteps, arestas condicionais e switch (o que some em silêncio), fan-out com barreira, executors compartilhados e IResettableExecutor, checkpoints e retomada em outro processo, e os padrões sequential, concurrent, handoff e group chat rodados com qwen3 no Ollama, com Magentic só pela documentação.
---
## Objective

Um agente responde a um pedido. Um workflow no Microsoft Agent Framework é a
camada acima: um grafo de executors ligados por arestas, executado em
supersteps, com checkpoints que permitem a um processo novo continuar depois de
uma falha. Alguns executors são código comum, outros envolvem um agente, e o
framework traz quatro formas multiagente (sequential, concurrent, handoff,
group chat) montadas sobre esse mesmo grafo. Esta lição roda tudo:
executors determinísticos para o grafo e os checkpoints, e `qwen3:4b-instruct`
em um Ollama local para as quatro orquestrações (3 execuções por afirmação).
Versões: `Microsoft.Agents.AI.Workflows` 1.28.0 e
`Microsoft.Agents.AI.Workflows.Generators` 1.28.0, ambos estáveis no NuGet
(publicados em 2026-11-06, sem sufixo de prerelease), `Microsoft.Agents.AI`
1.28.0, `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama 0.40.13,
.NET 10.

## Use Cases

- Um pipeline com ramos (triagem, cobrança, técnico) em que o modelo é só um
  passo entre código normal, e o caminho é explícito e testável.
- Um trabalho longo que precisa sobreviver a uma falha e continuar do último
  passo concluído.
- Vários agentes especialistas (redator e depois editor, otimista e cético em
  paralelo, um roteador que passa a pergunta ao especialista certo).
- Testes da própria orquestração, com executors que não precisam de modelo.

## Deep Dive

### Executors, arestas e supersteps

Um executor deriva de `Executor`, é `partial` e marca seus handlers com
`[MessageHandler]`; um source generator escreve o protocolo. Um workflow é um
`WorkflowBuilder` com um executor inicial, arestas e os executors cuja saída
chega ao chamador:

```csharp
var up = new Upper(); var rev = new Reverse();
var wf = new WorkflowBuilder(up).AddEdge(up, rev).WithOutputFrom(rev).Build();
await using Run run = await InProcessExecution.RunAsync(wf, "hello");
```

```text
WorkflowStartedEvent
step 0 started
invoked Upper with hello
completed Upper -> HELLO
step 0 completed
step 1 started
invoked Reverse with HELLO
OUTPUT OLLEH
completed Reverse ->
step 1 completed
```

Cada superstep executa os executors que têm uma mensagem esperando, e as
mensagens que eles enviam são entregues no próximo. Duas armadilhas apareceram
no caminho. Sem o pacote `Microsoft.Agents.AI.Workflows.Generators` o executor
não compila (`'Upper' does not implement inherited abstract member
'Executor.ConfigureProtocol(ProtocolBuilder)'`). E emitir um tipo que o executor
não declarou falha em tempo de execução, não de build:

```text
ExecutorFailedEvent: System.InvalidOperationException: Cannot output object of type String. Expecting one of [].
```

A correção é `[YieldsOutput(typeof(string))]` na classe (ou `Yield = [...]` no
handler); `[SendsMessage(typeof(T))]` faz o mesmo para `SendMessageAsync`. Um
valor retornado é enviado automaticamente.

### Arestas condicionais e switch

`AddEdge<T>(origem, destino, condição)` só passa a mensagem quando a condição é
verdadeira. `AddSwitch` roteia para o primeiro caso que casa, ou para um
default:

```csharp
builder.AddSwitch(intake, s => s
    .AddCase<Ticket>(t => t!.Category == "billing", bill)
    .AddCase<Ticket>(t => t!.Category == "technical", tech)
    .WithDefault(other));
```

```text
Billing: Billing handled 'Wrong invoice'
Technical: Technical handled 'Login error 500'
General: General handled 'Say hi'
```

Com uma única aresta condicional e sem default, um ticket que não casa com nada
é descartado: `'Say hi': events=5 outputs=0 status=Idle`, sem erro. O mesmo
silêncio vale para tipos: uma aresta de um executor de `int` para um handler que
recebe `Ticket` compilou e montou, e a execução terminou com zero saídas. O que
o `Build()` verifica: um executor que nenhuma aresta alcança
(`unreachable executors: Cube`) e duas instâncias diferentes com o mesmo id
(`an executor with the same ID but different instance is already bound`).

### Fan-out e a barreira

`AddFanOutEdge(source, [square, cube])` envia a mesma mensagem aos dois, e
`AddFanInBarrierEdge([square, cube], join)` segura o join até os dois
terminarem. A barreira não entrega uma lista:

```text
step 1: invoked Square, invoked Cube
step 2: invoked Join, OUTPUT join got 9 | invoked Join, OUTPUT join got 27
```

O join rodou uma vez por mensagem, no mesmo superstep, depois dos dois ramos.
Um handler de join para `List<int>` nunca rodou e nada reclamou, então o join
conta as mensagens por conta própria (o lab faz isso).

### Executors compartilhados e reset

Executors guardam estado de instância, e um `Workflow` montado com instâncias
pode rodar de novo. Um executor `Counter` que soma um a cada execução respondeu
`1`, `2`, `3` em três execuções do mesmo workflow. A interface
`IResettableExecutor` (`ResetAsync`) é a cura, com uma pegadinha: assim que um
executor do grafo a implementa, toda instância compartilhada precisa
implementar, ou a segunda execução lança `Cannot reuse Workflow with shared
Executor instances that do not implement IResettableExecutor.` Com zero
executors resetáveis não há erro, e o estado vaza.

### Checkpoints e retomada

Passe um `CheckpointManager` e um checkpoint é salvo ao fim de cada superstep.
Um executor em laço que soma os passos 1, 2, 3... em um total e envia a si
mesmo o próximo passo, com uma falha injetada no passo 5, guarda o estado em
`OnCheckpointingAsync` e o lê em `OnCheckpointRestoredAsync`:

```csharp
var mgr = CheckpointManager.CreateJson(new FileSystemJsonCheckpointStore(new DirectoryInfo(dir)));
await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, 1, mgr);
```

```text
process 1:  step 1 total 1 ... step 4 total 10   superstep done (4 checkpoints)
            error crash at step 5
process 2:  resuming from 45cdde1e...
            step 5 total 15, step 6 total 21, step 7 total 28, step 8 total 36
            output 36
```

O processo 2 é um processo .NET novo: montou um workflow novo e chamou
`GetLatestCheckpointAsync(sessionId)` e `ResumeStreamingAsync`. Só do passo 5 em
diante rodou de novo, e o total continuou de 10. O store gravou um arquivo JSON
por checkpoint mais o `index.jsonl`; o último arquivo guarda a mensagem na fila
(`5`) e `"Loop||total": 10`. O passo que falhou não tem checkpoint, então faça
os handlers poderem rodar de novo sem dano. O store de arquivos trava o
diretório: um segundo `FileSystemJsonCheckpointStore` na mesma pasta lançou `is
already in use by another process` até o primeiro ser descartado.

O workflow reconstruído precisa manter os mesmos ids de executor. Com agentes, o
id deriva do `Name` e do `Id` do agente: um Writer reconstruído com outro `Id`
deu `InvalidDataException: The specified checkpoint is not compatible with the
workflow associated with this runner.` Dê a cada agente um
`ChatClientAgentOptions.Id` fixo.

### Agentes como executors

O `AgentWorkflowBuilder` monta as quatro formas a partir de `AIAgent`s (o
`AsAIAgent` da lição anterior). Aqui, `Temperature = 0`, `Seed = 42` e um `Id`
estável por agente (os ids dos executors ficam como `Writer_writer`). Você envia
as mensagens e um `TurnToken`, depois lê os eventos:

```csharp
await using StreamingRun run = await InProcessExecution.RunStreamingAsync(wf, new List<ChatMessage> { new(ChatRole.User, input) });
await run.TrySendMessageAsync(new TurnToken(emitEvents: true));
await foreach (WorkflowEvent e in run.WatchStreamAsync()) { /* AgentResponseUpdateEvent, WorkflowOutputEvent */ }
```

### Sequential

`BuildSequential(writer, editor)` entrega a cada agente a conversa até ali:

```text
[Writer_writer] Porto is a vibrant Portuguese city renowned for its historic architecture, scenic riverside views, and world-famous port wine.
[Editor_editor] Porto: history, views, port wine
output: 3 messages (user, Writer, Editor)   model calls=2
```

Igual em 3 de 3 execuções. Retomando um pipeline com checkpoints (3
checkpoints): a partir do primeiro rodou 1 chamada ao modelo; a partir do
segundo, 0 e a saída ainda foi entregue.

### Concurrent

`BuildConcurrent([optimist, skeptic])` envia a mesma entrada aos dois e agrega a
última mensagem de cada um (um agregador próprio é um argumento opcional):

```text
output: 2 messages
  assistant Optimist: It simplifies management and reduces complexity by centralizing operations in one location.
  assistant Skeptic: Risk: Increased vulnerability to regional disruptions, ...
model calls=2
```

A saída agregada foi idêntica em 3 de 3 execuções; as atualizações em streaming
chegaram com o Skeptic primeiro em 1 de 3. Nunca dependa da ordem do stream.

### Handoff

Um agente roteador e especialistas, com as direções explícitas:

```csharp
var wf = AgentWorkflowBuilder.CreateHandoffBuilderWith(triage)
    .WithHandoffs(triage, [math, hist]).WithHandoffs([math, hist], triage).Build();
```

```text
user : What is 12 times 12?
assistant Triage:  [call handoff_to_1]
tool Triage:  [result Transferred.]
assistant MathAgent: 144                              model calls=2
```

O handoff é uma chamada de ferramenta. O nome dela é o índice (base 1) do
destino (`handoff_to_1` para math, `handoff_to_2` para history), não o nome do
agente. O Triage não produziu texto próprio. Idêntico em 3 de 3 execuções nas
duas perguntas (história: `handoff_to_2` e depois a resposta).
`EnableReturnToPrevious`, `WithAutonomousMode` e `WithTerminationCondition`
existem (não rodados).

### Group chat

Um gerente escolhe o próximo a falar. O `RoundRobinGroupChatManager` reveza e
para em `MaximumIterationCount`:

```text
[Writer] Stay hydrated, sustainably.
[Critic] The slogan "Stay hydrated, sustainably" is clear and positive, but it slightly oversimplifies ...
[Writer] Drink well, leave less.
[Critic] "Drink well, leave less" is catchy and memorable, but it risks sounding vague ...
output: 5 messages   model calls=4
```

Igual em 3 de 3 execuções. Derive de `GroupChatManager` para escolher os falantes
e decidir o término você mesmo.

### Magentic (só documentação, experimental)

O `MagenticWorkflowBuilder` (namespace `Microsoft.Agents.AI.Workflows.Specialized.Magentic`)
tem um agente gerente que planeja, mantém um progress ledger e escolhe os
participantes, com `WithMaxRounds`, `WithMaxStalls`, `WithMaxResets` e uma
aprovação do plano que vem ligada por padrão no .NET. A documentação marca os
tipos como experimentais (`#pragma warning disable MAAIW001`) e o exemplo usa
Foundry. Não rodei; a documentação diz que não foi testado fora do desenho
original do Magentic-One.

## Trade-offs

- **Grafo explícito versus um laço em código.** Um workflow dá arestas
  testáveis, eventos, supersteps e checkpoints, e cobra as armadilhas acima:
  descartes silenciosos para condições e tipos sem correspondência, um protocolo
  que você precisa declarar, regras de reset para executors compartilhados.
- **Checkpoints são estado confiável.** O store é uma fronteira de confiança (a
  documentação diz para nunca carregar checkpoints de fonte não confiável), o
  passo que falhou não é salvo, e workflows reconstruídos precisam dos mesmos
  ids de executor.
- **Quatro formas, um modelo pequeno.** Cada handoff ou turno de group chat é
  mais uma chamada ao modelo com a conversa crescendo. Um modelo de 4B deu conta
  desses prompts minúsculos, mas a qualidade do roteamento com muitos
  especialistas não é mostrada aqui.
- **Só documentação, não rodado aqui.** Magentic, requisições de human-in-the-loop,
  workflows declarativos (`Microsoft.Agents.AI.Workflows.Declarative.Foundry` está
  em 1.5.0-rc1 no NuGet) e workflows como agentes.

## Documentation Links

- [Workflow concepts, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/) (doc)
- [Executors, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/executors) (doc)
- [Edges, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/edges) (doc)
- [Checkpoints and resuming, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) (doc)
- [Workflow orchestrations, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/) (doc)
- [Magentic orchestration, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic) (doc)
