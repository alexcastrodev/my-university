---
version: 1.0
updatedAt: 2026-11-19
title: "Migração do MCP: do SDK 1.x e da Spec 2025-11-25 para o SDK 2.x"
summary: Um servidor e um cliente MCP em C# compilados no SDK 1.4.2 e migrados para o 2.4.0, com os erros reais do compilador (Tasks, ServerInfo anulável, avisos MCP9005 a MCP9007), a comparação da API pública por reflexão, a matriz medida servidor x cliente em stdio e HTTP, as mudanças que não quebram a compilação (HTTP stateless por padrão, structured content, código de erro), o roteiro de migração, o template que ainda gera 1.x e a tabela final de risco.
---
## Objective

Migrar um servidor ou cliente MCP em C# do SDK 1.x para o 2.x são duas migrações
ao mesmo tempo: uma de código-fonte (poucos erros de compilação, quase todos de
Tasks) e uma de protocolo (o novo padrão fala a spec 2026-07-28, stateless, sem
handshake), enquanto parte dos seus usuários ainda roda clientes que só falam
2025-11-25. Esta lição compila um servidor e um cliente no 1.4.2, atualiza para o
2.4.0 e mostra a saída real do compilador, compara a API pública dos dois pacotes
por reflexão e mede cada combinação servidor x cliente em stdio e HTTP: o que é
negociado, o que ainda funciona e o que muda sem erro de compilação. Nenhum modelo
é usado. Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 1.4.2
(última 1.x, 2026-11-03) e 2.4.0 (2026-11-07), `ModelContextProtocol.Extensions.Tasks`
2.4.0, comparação de API com `System.Reflection.MetadataLoadContext` 10.0.0, TFM
`net10.0`, SDK 10.0.100, spec 2025-11-25 contra 2026-07-28.

## Use Cases

- Um servidor publicado que outras pessoas rodam, atualizado sem quebrar os hosts delas.
- Um cliente (um agente, um job de CI) que fala com servidores que você não controla.
- Ler um tutorial antigo ou a saída do `dotnet new mcpserver` e saber o que trocar.
- Decidir quando um cliente legado deixa de justificar a compatibilidade com 2025-11-25.

## Deep Dive

### O que o compilador diz: 1.4.2 para 2.4.0

O servidor e o cliente de exemplo usam o que projetos 1.x usam: transportes stdio e
HTTP, uma tool, `McpClient.CreateAsync`, `ServerInfo`, `RootsHandler`,
`SamplingHandler`, `SetLoggingLevelAsync`, `AsClientLoggerProvider` e as Tasks
experimentais (`TaskStore`, `TaskSupport`, `CallToolAsTaskAsync`). No 1.4.2 só compila
com `<NoWarn>MCPEXP001</NoWarn>`, porque as Tasks eram experimentais. O mesmo código
no 2.4.0, mudando só a versão:

```text
Server/Program.cs(13,36): error CS1061: 'McpServerOptions' does not contain a definition for 'TaskStore'
Server/Program.cs(13,52): error CS0246: The type or namespace name 'InMemoryMcpTaskStore' could not be found
Server/Program.cs(70,42): error CS0246: The type or namespace name 'TaskSupport' could not be found
Server/Program.cs(70,56): error CS0103: The name 'ToolTaskSupport' does not exist in the current context
Client/Program.cs(27,175): error CS1061: 'ServerCapabilities' does not contain a definition for 'Tasks'
Client/Program.cs(40,118): error CS0246: The type or namespace name 'McpTaskMetadata' could not be found
Client/Program.cs(40,26): error CS1061: 'McpClient' does not contain a definition for 'CallToolAsTaskAsync'
Client/Program.cs(41,29): error CS1061: 'McpClient' does not contain a definition for 'PollTaskUntilCompleteAsync'
Client/Program.cs(26,75): warning CS8602: Dereference of a possibly null reference.   (client.ServerInfo.Name)
```

Todo erro é de Tasks. O resto compilou, com 17 avisos `MCP9005` (Roots, Sampling,
Logging, nas próximas seções). A correção inteira é um pacote, um `using` e outro formato:

```csharp
// csproj: <PackageReference Include="ModelContextProtocol.Extensions.Tasks" Version="2.4.0" />
using ModelContextProtocol.Extensions.Tasks;
var store = new InMemoryMcpTaskStore();                       // antes: options.TaskStore = new ...
builder.Services.AddMcpServer().WithHttpTransport().WithTools<LabTools>().WithTasks(store);
[McpServerTool(Name = "slow_report")]                          // antes: TaskSupport = ToolTaskSupport.Optional
var r = await client.CallToolWithPollingAsync(new CallToolRequestParams { Name = "slow_report", Arguments = args });
bool tasks = client.ServerCapabilities.Extensions?.ContainsKey(TasksProtocol.ExtensionId) is true;
Console.WriteLine(client.ServerInfo?.Name ?? "(no serverInfo)");   // 2.3.0: anulável
```

Depois disso servidor e cliente compilaram com 0 erros. As novas Tasks são outro
protocolo (sem `tasks/list`, sem `tasks/result`; detalhes no concept "MCP Tasks
Extension for Long-Running Tools"), então é reescrever o ponto de chamada, não renomear.

### IMcpClient e McpClientFactory: o backlog estava errado

Muitos guias de migração listam `IMcpClient` e `McpClientFactory` como removidos no
2.0. Um projeto de uma linha com `IMcpClient c = await McpClientFactory.CreateAsync(...)`,
compilado em cada versão, diz outra coisa:

```text
0.4.0-preview.3   Build succeeded
0.5.0-preview.1 .. 2.4.0   CS0246 'IMcpClient' could not be found ; CS0103 'McpClientFactory' does not exist
qualificado como ModelContextProtocol.Client.IMcpClient (1.4.2):  CS0234 ... does not exist in the namespace
```

Eles sumiram na 0.5.0-preview.1, então a linha 1.0 nunca os teve: código escrito para
0.x quebra ao encontrar a 1.x, não a 2.x. A API da 1.x e da 2.x é `McpClient` (classe
abstrata) e `McpClient.CreateAsync`; o mesmo vale para `McpServer`.

### A API pública, comparada por reflexão

Um script carregou os dois `ModelContextProtocol.Core.dll` com `MetadataLoadContext`
e comparou tipos e membros (públicos, declarados; 1.4.2 contra 2.4.0):

```text
tipos: 242 -> 243     removidos 26 (todos de Tasks: McpTask, IMcpTaskStore, InMemoryMcpTaskStore, ToolExecution, ...)
                      novos 27 (InputRequiredException, InputRequest/Response, DiscoverResult, CacheScope, MetaKeys, McpHeaderAttribute, ...)
                      agora [Obsolete] 27 (CreateMessageRequestParams, ListRootsRequestParams, LoggingLevel, SamplingMessage, ...)
membros removidos: McpClientOptions.TaskStore, SendTaskStatusNotifications, CallToolRequestParams.Task, CallToolResult.Task,
                   ClientCapabilities.Tasks, ServerCapabilities.Tasks, Tool.Execution, McpServerToolAttribute.TaskSupport
membros novos:     RequestParams.InputResponses/RequestState, Result.ResultType, McpServer.IsMrtrSupported,
                   McpClientOptions.DiscoverProbeTimeout/TimeProvider/InitializeMeta, ListToolsResult.TimeToLive/CacheScope,
                   HttpServerTransportOptions.SessionMode (ModelContextProtocol.AspNetCore)
ModelContextProtocol.dll e .AspNetCore.dll: nenhum tipo removido
```

Nada foi renomeado: só as Tasks saíram do Core e o resto é aditivo ou `[Obsolete]`. O
`McpClient.ServerInfo` tem o mesmo tipo CLR; a mudança é só a nulabilidade (notas da 2.3.0).

### Depreciado, ainda compila: MCP9005, MCP9006, MCP9007

A SEP-2577 deprecia Roots, Sampling e Logging. A 2.x os mantém para conexões que
negociam 2025-11-25 e os marca `[Obsolete]` com `MCP9005`:

```text
warning MCP9005: 'McpServer.RequestRootsAsync(...)' is obsolete: 'The Roots feature is deprecated as of specification version 2026-07-28 ...'
warning MCP9005: 'McpServer.SampleAsync(...)' / 'ClientCapabilities.Sampling' / 'McpClientHandlers.RootsHandler' / 'McpClient.SetLoggingLevelAsync(...)'
warning MCP9006: 'HttpServerTransportOptions.IdleTimeout' is obsolete: 'Stateful Streamable HTTP mode is a back-compat-only escape hatch ...'   (também MaxIdleSessionCount)
warning MCP9007: 'ClientOAuthOptions.AuthorizationRedirectDelegate' is obsolete: '... cannot provide the RFC 9207 issuer ...'
```

O `MCP9006` aparece nas opções só de modo stateful (`IdleTimeout`, `MaxIdleSessionCount`;
`SessionMigrationHandler`, `EventStreamStore` e `PerSessionExecutionContext` também são
`[Obsolete]` pela comparação), não em `Stateless`. O `MCP9007` pede a troca para
`ClientOAuthOptions.AuthorizationCallbackHandler` (veja o concept "MCP Authorization Flow:
401, Discovery and Token Validation"). Suprima o `MCP9005` temporariamente enquanto houver
clientes antigos. As migrações estão no concept "MCP Multi Round-Trip Requests and
Elicitation": parâmetros de tool no lugar de Roots, seu próprio `IChatClient` no lugar de
Sampling, stderr ou OpenTelemetry no lugar de Logging.

### A matriz: servidor x cliente, medida

As mesmas tools em todas as rodadas. Servidor é 1.4.2 ou 2.4.0, cliente idem; "pin" é
`McpClientOptions.ProtocolVersion`. Resultados em stdio e em HTTP com cada padrão:

| Servidor | Cliente | Negociado | `get_stock` | O resto |
| --- | --- | --- | --- | --- |
| 1.4.2 | 1.4.2 | 2025-11-25 | ok | roots, sampling, logging e Tasks 1.x funcionam |
| 1.4.2 | 2.4.0 | 2025-11-25 em 73 a 217 ms | ok | `server/discover` rejeitado rápido, cai no fallback; Roots, Sampling e Logging funcionam; `CallToolWithPollingAsync` vira chamada bloqueante |
| 1.4.2 | 2.4.0 pin 2026-07-28 | nenhum | n/a | `McpException: The server does not support the requested protocol version` |
| 2.4.0 stdio | 1.4.2 | 2025-11-25 | ok | tudo funciona, menos Tasks 1.x |
| 2.4.0 stdio | 2.4.0 | 2026-07-28 | ok | sem capability `logging`; `setLevel` falha; sem sessão |
| 2.4.0 HTTP padrão | 1.4.2 | 2025-11-25, sem sessão | ok | `who_am_i` não vê o nome do cliente; roots e sampling falham |
| 2.4.0 HTTP padrão | 2.4.0 | 2026-07-28, sem sessão | ok | `setLevel` é um 404 `-32601`; roots e sampling falham |
| 2.4.0 HTTP padrão | 2.4.0 pin 2025-11-25 | 2025-11-25, sem sessão | ok | igual ao cliente 1.4.2 |
| 2.4.0 HTTP padrão | 1.4.2 pin 2026-07-28 | nenhum | n/a | `McpProtocolException`: "not available through the initialize handshake" em 79 ms |
| 2.4.0 `Stateful` | 1.4.2 / 2.4.0 | 2025-11-25 com `Mcp-Session-Id` | ok | o cliente 2.4.0 sofre downgrade; tudo funciona |
| 2.4.0 `StatefulForInitializeClients` | 1.4.2 | 2025-11-25 com sessão | ok | roots, sampling e logging funcionam |
| 2.4.0 `StatefulForInitializeClients` | 2.4.0 | 2026-07-28, sem sessão | ok | mesmos limites do stateless |
| 2.4.0 `StatefulForInitializeClients` | 2.4.0 pin 2025-11-25 | 2025-11-25 com sessão | ok | roots, sampling e logging funcionam |

O mesmo teste de pin em stdio, cliente 1.4.2 fixado em 2026-07-28 contra servidor 2.4.0,
falhou depois de 5252 ms com o mesmo erro (causa não investigada; em HTTP foram 79 ms). O
`DiscoverProbeTimeout` de 5 segundos é o custo de um servidor que não responde
`server/discover` de jeito nenhum, medido nos concepts "MCP Servers and Clients with the C#
SDK" e "Testing MCP Servers in Process and with the Inspector". Um servidor 1.x responde
com erro na hora, por isso as primeiras linhas conectam rápido. Um cliente 1.4.2 com Tasks
contra qualquer servidor 2.4.0 lança `NullReferenceException` em `CallToolAsTaskAsync` (o
ponto de chamada recebeu um resultado simples): as Tasks v1 e v2 não interoperam, e as
notas do SDK dizem o mesmo.

### O que muda e continua compilando (a parte perigosa)

Tudo abaixo foi medido com o mesmo código e só a versão do pacote trocada.

**O HTTP padrão agora é stateless.** A 1.x servia sessões por padrão (`Mcp-Session-Id`
emitido, `who_am_i` via `client=Client sampling=True roots=True`). A 2.4.0 não cria
sessão; as mesmas tools lançam `InvalidOperationException: Roots are not supported in
stateless mode.` e `Sampling is not supported in stateless mode.`, que o cliente vê como
`IsError` com texto genérico. Um servidor 1.x com `Stateless = true` se comporta igual,
então a correção é no servidor: `Stateless = false` ou `SessionMode =
HttpServerSessionMode.StatefulForInitializeClients` para os clientes legados, e
`InputRequiredException` para os novos.

**Structured content.** `[McpServerTool(UseStructuredContent = true)]` num método que
devolve `int`: a 1.4.2 enviou `structuredContent: {"result":72}`; a 2.4.0 enviou `72` a um
cliente 2026-07-28 e continuou enviando `{"result":72}` a um cliente fixado em 2025-11-25.

**Resource inexistente.** A mesma URI ausente é `-32002` (`ResourceNotFound`) para um
cliente 2025-11-25 e `-32602` (`InvalidParams`) para um 2026-07-28, então um `catch` em
`McpErrorCode.ResourceNotFound` para de casar só por atualizar o cliente.

**Ordem das tools.** O `tools/list` agora segue a ordem de registro (2.3.0): a 1.4.2 listou
`who_am_i, answer, ...`, a 2.4.0 `get_stock, who_am_i, ...`. Reaprove os snapshots.

**Logging.** O `logging/setLevel` não existe na 2026-07-28: em stdio dá
`McpProtocolException` ("not available on protocol version '2026-07-28'"), em HTTP um 404.
`McpServer.AsClientLoggerProvider()` ainda devolveu "logged", mas a notificação não chegou
ao cliente em HTTP stateless.

**ServerInfo.** Na 2026-07-28 o `McpClient.ServerInfo` é `null` se o servidor omite a identidade
opcional (notas da 2.3.0, só docs; o sinal de compilação é o `CS8602`). É autodeclarado,
não use para decidir nada.

**Sem mudança.** O cancelamento pelo token do cliente funcionou igual em todas as
combinações (HTTP): parou em 1,5 s e o servidor registrou `WAIT cancelled`.

### Ordem da migração

1. **Inventário.** `grep` por `TaskStore`, `TaskSupport`, `RootsHandler`, `SamplingHandler`,
   `SetLoggingLevelAsync`, `AsClientLoggerProvider`, `ServerInfo`, `Stateless`, `IdleTimeout`,
   `AuthorizationRedirectDelegate`, e liste quais clientes chamam o seu servidor.
2. **Pin.** Fixe `Version` exata e, nos clientes, `ProtocolVersion = "2025-11-25"` se os
   servidores que eles chamam ainda não foram atualizados.
3. **Atualize o pacote** primeiro no servidor, depois nos clientes que o chamam.
4. **Corrija a compilação** (Tasks) e leia os avisos; deixe o `MCP9005` visível.
5. **Testes de contrato com os dois protocolos:** um cliente de teste fixado em 2025-11-25 e
   outro padrão, contra o mesmo servidor, verificando a tabela acima para as suas tools
   (veja "Testing MCP Servers in Process and with the Inspector").
6. **Escolha o modo de sessão** (`StatefulForInitializeClients` enquanto existirem legados).
7. **Remova as APIs depreciadas**, depois tire o pin e o modo de compatibilidade quando os
   logs não mostrarem `initialize` de 2025-11-25 por um release ou dois.

Um cliente legado em produção só funciona contra um servidor 2.4.0 se o servidor responder
`initialize` para ele: o HTTP padrão serve tools, e o `StatefulForInitializeClients` também
roots, sampling e logging. Se ele não puder ser atualizado e precisar de Tasks, mantenha-o
num endpoint 1.x, porque as duas Tasks não interoperam.

### O template ainda gera 1.x

O NuGet lista `Microsoft.McpServer.ProjectTemplates` 1.2.1 como a mais recente, e os projetos
dela referenciam `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 1.2.0 (extraído
do pacote). Um servidor novo do `dotnet new mcpserver` começa na linha 2025-11-25; suba os
dois pacotes e rode o build antes de publicar (veja "Packaging and Publishing an MCP Server").

### Tabela de mudanças

| Mudança | Sintoma | Correção | Risco |
| --- | --- | --- | --- |
| Tasks movidas para `Extensions.Tasks` | CS1061, CS0246 em `TaskStore`, `McpTaskMetadata`, `CallToolAsTaskAsync` | pacote, `WithTasks(store)`, `CallToolWithPollingAsync` | Baixo, barulhento |
| `IMcpClient`, `McpClientFactory` | CS0246, CS0103, CS0234 | `McpClient.CreateAsync` | Nenhum na 2.x (sumiram na 0.5) |
| Roots, Sampling, Logging | avisos MCP9005 | parâmetros de tool, `IChatClient` próprio, stderr ou OpenTelemetry | Médio, é silencioso |
| HTTP stateless por padrão | roots e sampling com `IsError`, sem sessão | `SessionMode` ou `InputRequiredException` | Alto, sem erro de compilação |
| `ServerInfo` anulável | CS8602 | `ServerInfo?.Name ?? ...` | Baixo |
| Structured content `72` | clientes que leem `result` falham | ler pelo schema anunciado | Médio |
| Not-found `-32602` | `catch` em `-32002` não casa | tratar os dois códigos | Médio |
| Ordem das tools | diff de snapshot | reaprovar | Baixo |
| Versões de Tasks misturadas | `NullReferenceException`, chamada bloqueante | um protocolo de Tasks por endpoint | Alto com clientes legados |
| `AuthorizationRedirectDelegate`, opções stateful | MCP9007, MCP9006 | `AuthorizationCallbackHandler`, `SessionMode` | Baixo |

## Trade-offs

- **Atualizar agora ou esperar.** A 2.x recebe as correções (2.3.1 e 1.4.2 endureceram
  sessões; a 1.4.2 é só de segurança), mas um padrão novo quebra usuários antes de você
  notar. Atualize o servidor primeiro, com modo de compatibilidade, depois os clientes.
- **Fixar o cliente.** `ProtocolVersion = "2025-11-25"` dá previsibilidade contra servidores
  antigos e mantém os recursos depreciados, sem nunca usar MRTR ou Tasks.
- **Endpoint híbrido.** `StatefulForInitializeClients` atende as duas gerações na mesma URL,
  mas exige sticky sessions para a metade legada; dois endpoints dobram a operação.
- **Suprimir o MCP9005.** Só como decisão datada e com dono: a spec permite remover após
  doze meses.

## Documentation Links

- [MCP C# SDK 2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [MCP C# SDK 2.3.0 release notes (ServerInfo nullable), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.3.0) (doc)
- [MCP C# SDK 1.4.2 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v1.4.2) (doc)
- [C# SDK versioning and breaking changes, csharp.sdk.modelcontextprotocol.io](https://csharp.sdk.modelcontextprotocol.io/versioning.html) (doc)
- [List of diagnostics (MCP9005, MCP9006, MCP9007), GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Deprecated features, MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/deprecated) (doc)
- [ModelContextProtocol package, NuGet](https://www.nuget.org/packages/ModelContextProtocol) (doc)
- [Create a minimal MCP server using C# and publish to NuGet, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/build-mcp-server) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
