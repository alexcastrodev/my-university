---
version: 1.0
updatedAt: 2026-11-19
title: "Consumindo Vários Servidores MCP em Agentes e Hosts"
summary: O lado do host de N servidores MCP, medido sem LLM com o SDK C# 2.4.0, Microsoft.Extensions.AI e o Agent Framework 1.28.0. O que o agente recebe de três servidores, a colisão de nomes (o agente lança exceção, o MEAI puro escolhe um) e as correções por prefixo, DelegatingAIFunction e allow-list, o orçamento de contexto em tokens (12.584 por chamada contra 190), um servidor que cai no meio da conversa, cache de tools/list por ttlMs com list_changed, aprovação por annotation com ApprovalRequiredAIFunction e como VS Code, Copilot CLI e Claude Code configuram servidores (só documentação).
---
## Objective

Um servidor MCP por agente é a demonstração. Um host de verdade conecta vários ao mesmo tempo, e os problemas estão do lado do host: dois servidores trazem uma tool chamada `search`, três servidores com 40 tools cada colocam 12 mil tokens na frente do modelo a cada chamada, um servidor morre no meio da conversa, o `tools/list` é buscado de novo e de novo, e algumas tools nunca deveriam rodar sem uma pessoa. As lições anteriores cobrem o servidor, o cliente e as ameaças de segurança; esta mede o host: um hub de tools para N servidores, montado sobre `McpClient`, `McpClientTool` e um agente do Agent Framework. Nenhum LLM é usado: o modelo é um `IChatClient` roteirizado que registra exatamente o que recebe, como na lição de agentes. O laboratório tem um servidor stdio e dois servidores Streamable HTTP (40 tools cada, com `search` e `status` presentes nos três). Os arquivos de configuração dos hosts reais (VS Code, Copilot CLI, Claude Code) e o padrão de gateway são só documentação. Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0, `Microsoft.Agents.AI` 1.28.0 (o teste de colisão também rodou na 1.26.0), `Microsoft.Extensions.AI` 10.11.0, `Microsoft.ML.Tokenizers` 3.0.0 com `Microsoft.ML.Tokenizers.Data.O200kBase` 3.0.0, TFM `net10.0`, SDK .NET 10.0.100, spec 2026-07-28.

## Use Cases

- Um assistente interno que precisa de tickets, wiki e arquivos, cada um de um time diferente.
- Escolher quais das 120 tools um agente realmente recebe e quanto isso custa por turno.
- Sobreviver a um servidor MCP que caiu ou reiniciou sem encerrar a conversa.
- Decidir quais chamadas de tool rodam sozinhas e quais esperam uma pessoa.

## Deep Dive

### O que o agente recebe de três servidores

`ListToolsAsync()` devolve `McpClientTool`s, que são `AIFunction`s, então a página "Using MCP tools with Agents" do Agent Framework só os espalha em `tools:`. Três servidores, 40 tools cada:

```csharp
await using var files   = await McpClient.CreateAsync(new StdioClientTransport(new() { Name = "files", Command = "dotnet", Arguments = [dll, "stdio", "files"] }));
await using var tickets = await McpClient.CreateAsync(new HttpClientTransport(new() { Endpoint = new Uri("http://127.0.0.1:6421/mcp") }));
await using var wiki    = await McpClient.CreateAsync(new HttpClientTransport(new() { Endpoint = new Uri("http://127.0.0.1:6422/mcp") }));
List<McpClientTool> all = [.. await files.ListToolsAsync(), .. await tickets.ListToolsAsync(), .. await wiki.ListToolsAsync()];
AIAgent agent = model.AsAIAgent(instructions: "Use the tools.", tools: [.. all.Cast<AITool>()]);
```

Cada cliente é criado uma vez e mantido (o `await using` o descarta no fim do host, e a página do Learn diz o mesmo). Os duplicados são `search`, `status` e dois hooks do laboratório, cada um x3, e a requisição do modelo é uma lista plana: nada em `ChatOptions.Tools` diz qual servidor é dono de uma tool.

### Colisão de nomes: o agente lança exceção, o MEAI puro escolhe um

O modelo roteirizado pede `search`:

```text
agent (Agent Framework 1.28.0): InvalidOperationException: Duplicate tool name 'search'. Tool names must be unique. (model requests: 0)
agent (Agent Framework 1.26.0): InvalidOperationException: Duplicate tool name 'search'. Tool names must be unique. (model requests: 0)
plain FunctionInvokingChatClient, files first: tool said: files matching refund  [120 tools sent]
plain FunctionInvokingChatClient, wiki first : tool said: wiki pages matching refund  [120 tools sent]
```

O agente falha antes da primeira chamada ao modelo (a pilha passa por `ApprovalRequirement.GetApprovalNotRequiredToolNames` no pipeline do próprio agente), então o erro é barulhento. Sem o agente, o `FunctionInvokingChatClient` aceita a lista: a primeira função com aquele nome vence, e qual é a primeira depende da ordem do seu `Concat`. As três declarações vão como estão, só a descrição difere (`Searches support tickets by text.` contra `Searches the internal wiki.`), então um modelo que as vê não consegue dizer qual servidor escolheu. Como um provedor real reage a nomes duplicados não foi medido aqui (exige um endpoint de verdade); não conte com isso.

### Corrigindo: prefixo, wrapper, allow-list

`McpClientTool.WithName` muda só o nome que o modelo vê; o XML doc diz que o servidor continua sendo chamado com o nome original. Um `DelegatingAIFunction` faz o mesmo para qualquer `AIFunction`:

```csharp
var prefixed = by.SelectMany(kv => kv.Value.Select(t => t.WithName($"{kv.Key}_{t.Name}")));
sealed class Renamed(AIFunction inner, string name) : DelegatingAIFunction(inner) { public override string Name => name; }
```

```text
duplicates left: 0 of 120     {"name":"tickets_search","description":"Searches support tickets by text.",...}
agent asks tickets_search: tool said: tickets matching refund  [120 tools sent]
agent asks wiki_search   : tool said: wiki pages matching refund  [120 tools sent]
server received tools/call: tickets 1, wiki 2
```

Cada chamada chegou ao servidor certo (os contadores incluem a execução anterior "wiki first", por isso a wiki mostra dois). O prefixo também ajuda o modelo: `tickets_search` diz o que ele pesquisa. A allow-list é a terceira correção e a mais barata: manter `files:read_file`, `tickets:search`, `tickets:get_ticket`, `wiki:get_page` e o agente vê 4 tools (`read_file, search, get_ticket, get_page`), então não sobra nada para colidir. Repare que a allow-list confere `servidor:nome`, não o nome solto. O guia de tools da spec sugere o mesmo prefixo para agregadores e diz que `serverInfo.name` não é único, então escolha o prefixo você mesmo em vez de confiar no servidor.

### O orçamento de contexto: tokens por tool, por turno

As definições das tools são reenviadas a cada chamada ao modelo, como o histórico. Contando o que o adaptador de um provedor serializa (nome, descrição, JSON Schema) com `TiktokenTokenizer.CreateForModel("gpt-4o")` (o200k; outro modelo tokeniza diferente, então leia como estimativa, e caracteres/4 aparece para comparar):

```text
server   tools  chars  tokens(o200k)  chars/4   tokens/tool
files       40  19789      4185       4947      104.6
tickets     40  19514      4155       4878      103.9
wiki        40  19282      4123       4820      103.1
all        120  59345     12584      14836      104.9
tool definitions resent on every model call: 1 call 12584, 10 calls 125840, 20 calls 251680
```

As tools são sintéticas mas realistas (uma frase de descrição, parâmetros tipados com `[Description]`), cerca de 105 tokens cada; servidores reais variam muito, e descrições longas custam mais. Caracteres/4 superestimou em 18 por cento aqui. Estratégias, medidas nas mesmas 120 tools:

```text
strategy                                  tools  tokens  vs all
everything                                 120   12584  100.0%
read-only annotation only                   85    9449   75.1%
one server for the task (tickets)           40    4195   33.3%
allow-list for this agent                    4     190    1.5%
```

Filtrar por `readOnlyHint` remove só 25 por cento e confia numa dica que o servidor controla (veja a lição de segurança), então use como conveniência, não como plano de orçamento. A allow-list por agente é a forte. A quarta estratégia é uma tool "find tools": o agente começa com uma função e as tools que ela encontra entram em `ChatOptions.Tools` pelo resto da execução (`FunctionInvokingChatClient.CurrentContext` dá acesso às opções vivas):

```text
model call 1: tools [find_tools] = 61 tokens
model call 2: tools [find_tools, tickets_close_ticket] = 114 tokens
model call 3: tools [find_tools, tickets_close_ticket] = 114 tokens
second agent run, first model call sees: [find_tools]
```

Em vez de 12.584 tokens por chamada, 61 e depois 114. O custo é uma ida e volta extra ao modelo, um modelo que precisa pedir bem (busca por palavra-chave no laboratório; um real usaria embeddings, veja a lição de busca vetorial) e a mesma lista numa execução nova, já que as tools adicionadas viveram só nas opções daquela execução. O Claude Code faz isso nativamente: a documentação de MCP dele diz que a busca de tools adia as definições, e só nomes e instruções do servidor carregam no início (só documentação). `Mcp-Name` não é ferramenta de orçamento: é um header HTTP que espelha a tool chamada para roteadores e WAFs (veja a lição de tools).

### Um servidor morre no meio da conversa

O laboratório matou o processo HTTP de tickets (`Process.Kill`) e, separadamente, fez o servidor stdio sair durante uma chamada. Primeiro, o que vê um agente montado com `McpClientTool`s puras:

```text
http alive      : saw: tickets matching a
http killed     : saw: EXCEPTION HttpRequestException: Connection refused (127.0.0.1:6421); call 2 still advertises 40 tickets tools
http restarted  : saw: tickets matching a          (same client, new process)
stdio crash call: saw: bye              (the process exited 100 ms after answering)
files.Completion: StdioClientCompletionDetails, Exception=IOException: MCP server process exited unexpectedly
stdio after exit: saw: EXCEPTION IOException: MCP server process exited unexpectedly
```

O agente não quebrou: o `FunctionInvokingChatClient` transforma a exceção num `FunctionResultContent` com `Exception` preenchido (o padrão não relança), então o modelo vê uma falha e as 40 tools mortas continuam na lista, convidando a novas tentativas. Um cliente HTTP em modo stateless se recuperou sozinho quando o servidor voltou, porque cada requisição é independente; um cliente stdio não: `McpClient.Completion` completa com os detalhes da saída e toda chamada seguinte lança. A estratégia de degradação do hub (código abaixo) embrulha cada tool: diante de `HttpRequestException`, `IOException` ou um `Completion` concluído, marca o servidor como fora, remove as tools dele das opções vivas e devolve um texto que o modelo consegue usar:

```text
  [hub] tickets: down (HttpRequestException), tools removed
model call 1: 40 tickets tools, 40 files tools
model call 2: 0 tickets tools, 40 files tools
tool results the model saw: The 'tickets' server is unavailable. Its tools were removed from this conversation; use another source. || contents of policy.txt
next run offers: 0 tickets tools
reconnect: True, next run offers 40 tickets tools
```

A conversa continuou com o servidor de arquivos, e reconectar foi um dispose mais um novo `McpClient.CreateAsync` (`ReconnectAsync`). O Claude Code documenta a política dele (só documentação): um servidor remoto que cai é retentado até cinco vezes com backoff exponencial a partir de um segundo, e um servidor stdio que sai fica marcado como falho até você reconectá-lo.

### tools/list: o SDK não faz cache, um hub pode

As lições anteriores mediram `ttlMs` e `cacheScope` no fio. O cliente 2.4.0 os lê (`ListToolsResult.TimeToLive`) mas não age sobre eles: cinco chamadas a `ListToolsAsync()` enviaram cinco requisições `tools/list`. O hub faz cache por servidor, seguindo a spec (fresco enquanto `now < recebido + ttlMs`; `ttlMs` 0 ou ausente significa vencido; uma notificação invalida):

```csharp
public async Task<List<McpClientTool>> ToolsAsync(S s)
{
    if (!s.Stale && Now() < s.Expires) return s.Tools;             // fresh: no request
    var found = new List<Tool>(); string? cursor = null; TimeSpan? ttl = null;
    do { var r = await s.Client!.ListToolsAsync(new ListToolsRequestParams { Cursor = cursor });
         found.AddRange(r.Tools); ttl = r.TimeToLive; cursor = r.NextCursor; } while (cursor is not null);
    s.Stale = false; s.Tools = [.. found.Select(t => new McpClientTool(s.Client!, t))];
    s.Expires = ttl is { } t0 && t0 > TimeSpan.Zero ? Now() + t0 : DateTimeOffset.MinValue;
    ...   // then the pin check of the security lesson
}
// on connect: client.RegisterNotificationHandler(NotificationMethods.ToolListChangedNotification, (_, _) => { s.Stale = true; ... });
```

O servidor de tickets manteve o `ttlMs: 0` padrão; o da wiki definiu `ListToolsResult.TimeToLive = 2 s` num `AddListToolsFilter`:

```text
tickets ttl=0  wiki ttl=2000
5 VisibleAsync calls: tools/list sent tickets +5 (ttl 0), wiki +0 (ttl 2000)
raw ListToolsAsync x5: tools/list sent +5
after 2.2 s: wiki tools/list +1 (ttl expired)
server rewrote 'search' silently; hub within ttl still says: 'Searches the internal wiki.' (+0 requests)
  [hub] wiki: tools/list pin 1B61B9C29D24 != approved E25724BCAE93: tools hidden until re-approved
after ttl: description now 'Searches the internal wiki. (v2)', quarantined=True, wiki tools offered=0
```

O cache economiza a lista de 40 tools (cerca de 20 KB) a cada turno, e o preço é a defasagem: uma mudança silenciosa dentro do TTL fica invisível, o que a spec aceita ("uma dica de frescor, não uma garantia"). O pin da lição de segurança transformou a mudança numa quarentena em vez de uma atualização sem revisão; `Approve("wiki")` fixou de novo e as 40 tools voltaram. Com `list_changed` o servidor avisa antes: uma tool do laboratório reescreveu uma descrição e enviou a notificação, `Stale` virou verdadeiro em menos de 300 ms, e o próximo `VisibleAsync()` dentro do TTL buscou na hora (`tools/list +1`) e pôs em quarentena de novo. Então `ttlMs` é o plano de reserva e `list_changed` o caminho rápido. `cacheScope: "private"` (o padrão) significa que a cópia não pode cruzar contextos de autorização: mantenha um cache por token de usuário, não um por processo, quando o host atende vários usuários.

### Aprovação por política e limites no loop

`ApprovalRequiredAIFunction` (namespace `Microsoft.Extensions.AI`; a lição de agentes a usou) embrulha qualquer `AIFunction`. O hub recebe um callback de wrap, e a política lê a annotation de cada tool:

```csharp
AIFunction Policy(McpClientTool t, AIFunction f) =>
    t.ProtocolTool.Annotations?.ReadOnlyHint == true ? f : new ApprovalRequiredAIFunction(f);   // no annotation = ask
var tools = await hub.VisibleAsync(wrap: Policy);
```

```text
80 tools: 56 auto, 24 need approval
  tickets_get_ticket     auto
  tickets_create_ticket  approval
  tickets_close_ticket   approval
  wiki_delete_page       approval
  wiki_legacy_sync       approval        (no annotations at all)
run 1: model calls=1, approval request for tickets_close_ticket, server tools/call +0
run 2 (approved): model calls=2, server tools/call +1, text='ok'
```

A `wiki_legacy_sync`, sem annotation, exige aprovação, de acordo com os padrões da spec (uma tool sem annotation é destrutiva e de mundo aberto). A execução para com um `ToolApprovalRequestContent` antes de qualquer coisa chegar ao servidor (`tools/call +0`) e `req.CreateResponse(true)` numa segunda execução na mesma sessão a executa. É a política "readOnly roda, o resto pergunta", e vale tanto quanto a honestidade do servidor: a lição de tools mostrou um servidor que declara `readOnlyHint` e muda estado, então para servidores que você não controla, aprove tudo ou fixe as annotations na allow-list do próprio host em vez de lê-las do fio. A página de aprovação do Agent Framework também documenta regras do `UseToolApproval` guardadas na sessão (só documentação aqui). Um último limite é o próprio loop: `FunctionInvokingChatClient.MaximumIterationsPerRequest = 3` parou um modelo que pedia `tickets_status` para sempre depois de 4 chamadas ao modelo e 3 ao servidor. Adicione também um orçamento de tokens ou de turnos por usuário no host.

### Como os hosts reais configuram vários servidores (só documentação)

Nada disso rodou aqui, e nenhuma configuração da própria máquina foi tocada. Lido nas páginas dos fornecedores em 2026-11-19:

| Host | Arquivo e escopo | Observações |
| --- | --- | --- |
| VS Code, harness Copilot | `.mcp.json` na raiz do workspace, ou `~/.copilot/mcp-config.json` (usuário, compartilhado com o Copilot CLI), `mcpServers` no topo | o arquivo da raiz rejeita expressões `${...}`; `inputs` e `envFile` são campos só do editor |
| VS Code, harness Local (depreciado, remoção anunciada para fevereiro de 2027) | `.vscode/mcp.json` ou o `mcp.json` do perfil, `servers` no topo, `inputs` opcional com `${input:id}` | `"env": {"API_KEY": "${input:perplexity-key}"}` pergunta uma vez e esconde o valor |
| Copilot CLI | `~/.copilot/mcp-config.json`, `copilot mcp add NOME -- COMANDO ARGS` | mesmo formato `mcpServers` |
| Claude Code | `local` (padrão, privado, em `~/.claude.json` por projeto), `project` (`.mcp.json`, compartilhado, exige aprovação) e `user` (`~/.claude.json`, todos os projetos) | o mesmo nome em vários escopos conecta uma vez, vence a maior precedência, as entradas não são mescladas; `${VAR}` e `${VAR:-padrão}` expandem no `.mcp.json` |
| Claude Desktop | `claude_desktop_config.json` em `~/Library/Application Support/Claude/` (macOS) | `mcpServers` com `command` e `args` |

Duas notas. A referência do VS Code agora chama `.vscode/mcp.json` e o `mcp.json` do perfil de formato do harness Local depreciado e aponta as configurações novas para os arquivos `mcpServers`, então um tutorial antigo pode descrever o formato depreciado (livro versus hoje). E um arquivo de projeto compartilhado é superfície de ataque: o host de cada colega vai iniciar qualquer comando listado nele, e por isso o Claude Code pede aprovação e o VS Code mostra um aviso de confiança.

### O padrão de gateway

Um gateway é um servidor MCP na frente de vários, para que o host tenha uma única entrada na configuração. O laboratório montou um com o SDK: ele se conecta a tickets e wiki como cliente e reexpõe cada tool sob um prefixo.

```text
gateway tools=80 tokens=8376
tickets_close_ticket annotations through gateway: destructive=True readOnly=False
call via gateway: tickets matching refund; backend tools/call +1
```

Funciona em cerca de uma dúzia de linhas, e também mostra o custo: o host continua vendo 80 tools e 8.376 tokens (o gateway sozinho não encolhe o contexto), e ele copia as annotations dos backends, então uma descrição envenenada num backend agora chega com o nome do gateway. O que um gateway pode acrescentar é a política num lugar só: allow-lists, troca de token para os backends, auditoria e limites de taxa (só documentação: gateways de API como YARP ou Azure API Management). Não leve a dúzia de linhas do laboratório para produção; elas repassam requisições sem tratar identidade.

### Mapa de problemas

| Problema | Sintoma (medido) | Mitigação |
| --- | --- | --- |
| Mesmo nome de tool em dois servidores | agente: `Duplicate tool name 'search'` antes da primeira chamada; MEAI puro: o primeiro da lista vence em silêncio | prefixo com `WithName` ou `DelegatingAIFunction`; allow-list em `servidor:nome` |
| Contexto inchado | 120 tools = 12.584 tokens por chamada ao modelo | allow-list por agente (1,5 por cento), um servidor por tarefa, tool de busca de tools |
| Servidor fora no meio da conversa | exceção dentro do `FunctionResultContent`, tools mortas continuam listadas, stdio nunca se recupera | embrulhar as tools, removê-las das opções vivas, avisar o modelo, reconectar com um novo `McpClient` |
| `tools/list` repetido | 5 chamadas, 5 requisições (o SDK não tem cache) | cache por `ttlMs`, invalidar com `list_changed` |
| Definição muda dentro do TTL | descrição velha por até `ttlMs` | fixar o hash, pôr em quarentena na divergência, TTLs curtos |
| Tool perigosa roda sozinha | tools `delete` executam a partir de uma resposta do modelo | `ApprovalRequiredAIFunction` por política, perguntar quando falta a annotation |
| Loop descontrolado | o modelo repete uma chamada | `MaximumIterationsPerRequest`, orçamento de tokens |

## Trade-offs

- **Prefixo por servidor vs nomes curtos.** `tickets_search` remove a colisão e diz o escopo ao modelo, ao preço de alguns tokens por tool e de nomes diferentes dos da documentação do servidor; mantenha o prefixo no host e o servidor intacto.
- **Allow-list vs conveniência.** Uma lista pequena é a mais barata e segura, mas cada tool nova de um servidor exige uma decisão. Uma tool de busca mantém o catálogo alcançável ao custo de mais uma ida e volta ao modelo.
- **Cache vs frescor.** Respeitar `ttlMs` economiza requisições a cada turno; um TTL longo esconde um rug pull (o TTL de 2 s escondeu uma reescrita até vencer). Combine com `list_changed` e o pin.
- **Aprovação por chamada vs fluxo.** Aprovar toda escrita é seguro e cansativo; aprovar sozinho o `readOnlyHint` é fluido e confia na palavra do servidor. Decida por nível de confiança do servidor.
- **Gateway vs direto.** Uma entrada e um ponto de política, mas é mais um componente para rodar, proteger e escalar, e ele pode esconder de qual backend veio uma tool.
- **Hub próprio vs o do host.** Hosts como VS Code e Claude Code já fazem busca de tools, avisos de confiança e reconexão; escreva um hub seu só quando você embute agentes no seu próprio produto.

## Documentation Links

- [Using MCP tools with Agents, Microsoft Agent Framework, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/local-mcp-tools) (doc)
- [Tool approval, Microsoft Agent Framework, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval) (doc)
- [Get started with .NET AI and the Model Context Protocol, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/get-started-mcp) (doc)
- [Caching, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) (doc)
- [Tools, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
- [Use MCP servers in VS Code, Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) (doc)
- [MCP configuration reference, Visual Studio Code](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) (doc)
- [Adding MCP servers for Copilot CLI, GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) (doc)
- [Connect Claude Code to tools via MCP, Claude Code Docs](https://code.claude.com/docs/en/mcp) (doc)
- [Connect to local MCP servers, modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/connect-local-servers) (doc)
