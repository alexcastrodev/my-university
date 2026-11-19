---
version: 1.0
updatedAt: 2026-11-19
title: "Resources, Prompts, Completions e Paginação no MCP"
summary: Resources (texto, binário em base64, templates de URI e o erro de recurso inexistente, -32602 na spec 2026-07-28 e -32002 antes), prompts com argumentos e conteúdo rico, completions de argumentos e o limite de 100 valores, paginação por cursor, os campos ttlMs e cacheScope (SEP-2549) e subscriptions/listen com o handler opt-in do SDK 2.1.0, tudo medido num servidor real com o SDK C# 2.4.0, sem modelo.
---
## Objective

Tools são só uma das três coisas que um servidor MCP oferece. Esta lição mede o resto num servidor real com o SDK C#: resources (texto,
binário, templates e o erro de inexistente), prompts com argumentos e conteúdo rico, completions de argumentos, paginação por cursor e
os sinais de mudança e de cache (`listChanged`, `ttlMs`, `cacheScope`, `subscriptions/listen`). Todas as saídas abaixo vêm de código
executado, sem modelo; o que só foi lido na documentação está marcado "docs only". Versões: `ModelContextProtocol` e
`ModelContextProtocol.AspNetCore` 2.4.0, TFM `net10.0`, SDK 10.0.100, protocolo 2026-07-28 (e 2025-11-25 onde os dois diferem).

## Use Cases

- Expor arquivos, schemas ou registros como resources que o host anexa como contexto.
- Entregar templates de prompt no estilo slash command, com argumentos autocompletados.
- Servir um catálogo maior que uma página de `tools/list`, `prompts/list` ou `resources/list`.
- Dizer aos clientes por quanto tempo uma lista continua fresca e quando ela mudou.

## Deep Dive

### Resources: URI, MIME type, texto e binário

Um resource é identificado por uma URI e lido com `resources/read`. Uma URI fixa é um resource direto; uma URI com `{parâmetros}` é um
template.

```csharp
[McpServerResourceType]   // registrado com .WithResources<LabResources>()
public sealed class LabResources
{
    [McpServerResource(UriTemplate = "docs://readme", Name = "readme", MimeType = "text/markdown")]
    public static string Readme() => "# Orders API\n\nStart here.";
    [McpServerResource(UriTemplate = "logo://png", Name = "logo", MimeType = "image/png")]
    public static BlobResourceContents Logo() => BlobResourceContents.FromBytes(png, "logo://png", "image/png");
    [McpServerResource(UriTemplate = "orders://{orderId}", Name = "order", MimeType = "application/json")]
    public static string Order(int orderId) => ...;   // parâmetro ligado a partir da URI
}
```

`resources/list` devolveu só as duas URIs fixas e `resources/templates/list` só as com template, embora todas venham do mesmo atributo:

```text
resource  docs://readme name=readme mime=text/markdown
resource  logo://png name=logo mime=image/png
template  orders://{orderId} name=order mime=application/json      (e stock://{warehouse}/{sku})
```

Texto vai em `text` no fio (`"text":"# Orders API..."`); binário vai em base64 no campo `blob` (um PNG de 70 bytes aqui, que o cliente
expõe já decodificado em `DecodedData`):

```text
<-- {"result":{"contents":[{"uri":"logo://png","mimeType":"image/png","blob":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...Jggg=="}],"ttlMs":0,...}   decoded=70 bytes
```

Um retorno string vira `TextResourceContents` com o MIME type do atributo; para binário devolva `BlobResourceContents.FromBytes` (o SDK
2.1.0 melhorou a doc de binários). As chamadas do cliente são `ListResourcesAsync`, `ListResourceTemplatesAsync` e
`ReadResourceAsync(uri)`.

### O erro de inexistente: -32602 agora, -32002 antes

O changelog da 2026-07-28 trocou "resource not found" de `-32002` para `-32602` (SEP-2164). O SDK escolhe o código pela versão
negociada:

```text
negotiated 2026-07-28: read nosuch://x -> -32602 (InvalidParams): Unknown resource URI: 'nosuch://x'
negotiated 2025-11-25: read nosuch://x -> -32002 (ResourceNotFound): Unknown resource URI: 'nosuch://x'
--- o template casa e o handler decide que o id não existe: o código é seu ---
read orders://999 (throw new McpException(...)):               -32603 (InternalError): Order 999 does not exist
read orders://500 (throw McpProtocolException, InvalidParams): -32602 (InvalidParams): Order 500 does not exist
read orders://abc (matches, int.Parse fails):                  -32603 (InternalError): An error occurred.
```

As duas primeiras linhas cobrem uma URI que não casa com nada. Quando o template casa e o handler decide que o id não existe, o código
é seu. Uma `McpException` entrega a mensagem ao cliente, mas com `-32603`. A spec diz que um resource inexistente DEVE ser `-32602` e
NÃO DEVE ser um `contents` vazio, então lance `new McpProtocolException(msg, McpErrorCode.InvalidParams)`. Um parâmetro malformado
(`abc` para um `int`) virou um `-32603` genérico: valide você mesmo.

### Parâmetros de template e completions

`stock://{warehouse}/{sku}` tem dois parâmetros. `[AllowedValues("lisbon", "porto", "faro")]` em `warehouse` faz o SDK responder
`completion/complete` sem handler nenhum (docs: primeiro os resultados do handler, depois os `AllowedValues` que casam):

```text
--> {"method":"completion/complete","params":{"ref":{"type":"ref/resource","uri":"stock://{warehouse}/{sku}"},"argument":{"name":"warehouse","value":"p"}},...}
<-- {"result":{"completion":{"values":["porto"],"total":1},"resultType":"complete",...},...}
```

Para argumentos dependentes o cliente manda o que o usuário já preencheu em `context.arguments`, e um handler `WithCompleteHandler`
(`ctx.Params.Context.Arguments["warehouse"]`) estreita a próxima lista:

```text
--> {"method":"completion/complete","params":{"ref":{...},"argument":{"name":"sku","value":"SKU-"},"context":{"arguments":{"warehouse":"lisbon"}}},"id":4,...}
<-- {"result":{"completion":{"values":["SKU-L1","SKU-L2","SKU-L3"],"total":3,"hasMore":false},...},"id":4,...}
```

A chamada do cliente é `client.CompleteAsync(new PromptReference { Name = "code_review" }, "language", "p")` (devolveu `["python"]`),
ou a sobrecarga com `CompleteRequestParams` quando você precisa de `Context`. `hasMore` veio ausente na resposta do `[AllowedValues]` e
`false` na do handler: trate ausente como "não há mais".

A spec diz no máximo 100 valores por resposta, e o SDK não corta:

```text
orderId='' -> values=250 total=250 hasMore=False    (o handler devolve todos os ids de 1 a 250)
orderId='' -> values=100 total=250 hasMore=True     (handler: Take(100), HasMore = all.Count > 100)
```

Limite no handler e informe `Total` e `HasMore`; conforme o usuário digita, a lista encolhe, que é a paginação das completions.

### Prompts: argumentos, papéis e conteúdo rico

Um prompt é um template escolhido pelo usuário (pense em slash command). Devolva `ChatMessage` para texto e imagem, e `PromptMessage`
quando precisar de um resource embutido:

```csharp
[McpServerPrompt(Name = "code_review")]
public static IEnumerable<ChatMessage> CodeReview([AllowedValues("csharp", "python", "go")] string language, string code) =>
[ new(ChatRole.User, $"Please review this {language} code:\n{code}"), new(ChatRole.Assistant, "I will check correctness first, then style.") ];
// review_order devolve itens PromptMessage: um TextContentBlock, um EmbeddedResourceBlock { Resource = new TextResourceContents { ... } }
// e um ResourceLinkBlock; analyze_chart devolve uma ChatMessage com [new TextContent(q), new DataContent(png, "image/png")]
```

`prompts/list` traz os argumentos (`required: true` para parâmetros simples) e `prompts/get` devolve as mensagens. O que
`GetPromptAsync` entregou ao cliente:

```text
prompt code_review: language*, code*
  [code_review] User: text "Please review this csharp code:\nvar x = 1;"
  [code_review] Assistant: text "I will check correctness first, then style."
  [analyze_chart] User: image image/png (70 bytes)
  [review_order] User: resource orders://7 application/json
  [review_order] User: resource_link docs://readme
```

O host passa isso ao modelo com `GetPromptResult.ToChatMessages()`. Medido: o texto e o resource de texto embutido viraram
`TextContent`, a imagem virou `DataContent(image/png)` e a mensagem `resource_link` virou uma mensagem com zero conteúdos, então um
host que precise do dado apontado tem que chamar `resources/read`.

Erros: um prompt desconhecido deu `-32602` (`Unknown prompt: 'nosuch_prompt'`), mas um argumento obrigatório ausente deu um `-32603`
genérico (`An error occurred.`), embora a spec diga que DEVERIA ser `-32602`. `[AllowedValues]` é só uma dica de completion:
`language=cobol` foi aceito, então valide no corpo do método.

### Paginação: o cursor é opaco

Os quatro métodos de lista devolvem um `nextCursor` opcional; o cliente o devolve como `params.cursor`, e a ausência significa o fim
(string vazia ainda é um cursor). O servidor escolhe o tamanho da página. Com 120 tools na coleção o SDK mandou tudo de uma vez:
`ListToolsAsync()` fez 1 request `tools/list`, uma resposta de 12.074 caracteres sem cursor.

Para paginar, troque o handler com `WithListToolsHandler`, fatie a lista pelo cursor (aqui um offset em base64; qualquer string opaca
serve) e devolva `NextCursor` (null na última página). Com 50 por página:

```text
ListToolsAsync(): 122 tools in 3 tools/list request(s)
  page 1: 52 tools, nextCursor="NTA="
  page 2: 50 tools, nextCursor="MTAw"
  page 3: 20 tools, nextCursor=null
ListPromptsAsync(): 73 prompts in 2 requests; ListResourcesAsync(): 132 resources in 3
```

`ListToolsAsync()` segue os cursores e devolve a lista inteira; `ListToolsAsync(new ListToolsRequestParams { Cursor = c })` devolve uma
página (`result.NextCursor`). Duas armadilhas: tools registradas com `WithTools<T>()` só são anexadas quando a request não tem cursor,
por isso a página 1 teve 52. E com `cursor=garbage` o handler de coleção do SDK devolveu uma página vazia
(`{"tools":[],"ttlMs":0,...}`), enquanto meu handler próprio lançou erro e o cliente viu `-32602 Invalid cursor`. A spec diz que cursor
inválido DEVERIA ser `-32602`, então valide nos seus handlers.

### Dicas de cache: ttlMs e cacheScope

A spec 2026-07-28 exige `ttlMs` e `cacheScope` em `server/discover`, nos quatro resultados de lista e em `resources/read` (SEP-2549).
Sem configurar nada, o SDK preenche os valores mais seguros (`"ttlMs":0,"cacheScope":"private"`, vistos acima). Para publicar dicas
reais, defina `result.TimeToLive` e `result.CacheScope` num filtro de request (`AddListToolsFilter`, `AddReadResourceFilter`) ou num
handler próprio:

```text
padrão:           tools/list ttl=00:00:00 scope=Private   (idem prompts, resources, templates, read)
com os filtros:   tools/list ttl=00:05:00 scope=Public    resources/read docs://readme ttl=00:01:00 scope=Public
                  resources/read orders://7 ttl=00:00:00 scope=Private
```

`public` deixa um proxy compartilhado servir uma resposta a todos, então dado por usuário tem que ser `private`, e a spec manda não
usar `cacheScope` no lugar de controle de acesso. O cliente não fez cache: três chamadas a `ListToolsAsync()` mandaram três requests,
então respeitar o `ttlMs` é trabalho do host. Cada página é cacheada à parte. Para quem vem do ASP.NET Core, `ttlMs` é o `max-age` e
`cacheScope` é `public` ou `private`.

### Notificações de mudança: listChanged e subscriptions/listen

`resources/subscribe` e o stream HTTP GET acabaram na 2026-07-28. O cliente abre uma request `subscriptions/listen` com um filtro
(`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`), recebe antes
`notifications/subscriptions/acknowledged` e depois só o que pediu, cada notificação marcada com
`_meta."io.modelcontextprotocol/subscriptionId"`. Em stdio, com o handler padrão, uma tool adicionada em runtime (o cliente mandou
`subscriptions/listen` com `SendRequestAsync`; o SDK não tem método tipado de cliente para isso):

```text
SubscribeToResourceAsync on 2026-07-28: -32601 (MethodNotFound): The method 'resources/subscribe' is not available on protocol version '2026-07-28'. Use 'subscriptions/listen' with 'resourceSubscriptions' instead.
== listen with all four filters
   notifications/subscriptions/acknowledged {"notifications":{"toolsListChanged":true,"promptsListChanged":true,"resourcesListChanged":true,"resourceSubscriptions":["docs://readme"]},"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
   notifications/tools/list_changed {"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
```

Sem um `subscriptions/listen`, o cliente 2026-07-28 não recebeu `tools/list_changed`, enquanto um cliente fixado em 2025-11-25 teve o
`resources/subscribe` aceito e o `tools/list_changed` em broadcast sem id. O handler embutido distribui só os três tipos de
list-changed; `resources/updated` é por sua conta (minha tool chamou `SendNotificationAsync` e a notificação chegou sem marca, qualquer
que fosse o filtro).

HTTP stateless é o caso difícil. O handler embutido confirma com filtro vazio e termina na hora, o `server/discover` não anuncia
`listChanged` e o método antigo é um 404:

```text
data: {"method":"notifications/subscriptions/acknowledged","params":{"notifications":{},...},...}   e logo em seguida {"result":{"resultType":"complete"},"id":1,...}
resources/subscribe over HTTP: 404 {"error":{"code":-32601,"message":"Method 'resources/subscribe' is not available on protocol version '2026-07-28'."}}
```

O opt-in do SDK 2.1.0 é `WithSubscriptionsListenHandler`, uma substituição total: ele precisa mandar uma confirmação primeiro, marcar
cada notificação com o id da request, ficar vivo até o cancelamento, e as capabilities você mesmo declara. Com um pequeno barramento em
memória por trás, o servidor stateless empurrou notificações num POST mantido aberto:

```text
notifications/subscriptions/acknowledged {"notifications":{"toolsListChanged":true,"resourceSubscriptions":["docs://readme"]},"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
notifications/tools/list_changed {"_meta":{"io.modelcontextprotocol/subscriptionId":2}}
notifications/resources/updated {"uri":"docs://readme","_meta":{"io.modelcontextprotocol/subscriptionId":2}}
```

Uma atualização de `docs://other` foi descartada pelo filtro do meu handler. O barramento é em processo, então escalar para várias
instâncias exige um canal compartilhado (Redis, um broker). O SDK 2.4.0 também cancela uma request listen quando o transporte para de
entregar.

### Tool, resource ou prompt?

| | Quem decide | Conteúdo típico | Efeitos colaterais |
| --- | --- | --- | --- |
| Tool | O modelo (controlada pelo modelo) | Uma ação ou cálculo | Permitidos, pedem aprovação |
| Resource | A aplicação (dirigido pela aplicação) | Dado anexado como contexto, por URI | Nenhum |
| Prompt | O usuário (slash command) | Um template de mensagem com argumentos | Nenhum |

## Trade-offs

- **Resource ou tool para dado somente leitura.** Um resource ganha MIME type, dicas de cache e UI de anexar no host, mas muitos hosts
  não deixam o modelo buscá-lo sozinho; uma tool é sempre alcançável. Oferecer os dois custa uma descrição duplicada.
- **Paginar ou lista grande.** 120 tools saíram em 12 KB, ok até a lista crescer, e cada descrição é contexto que o modelo paga.
  Paginar significa escrever o handler de lista e validar cursores.
- **`ttlMs` longo.** Cinco minutos poupam requests, mas uma descrição de tool alterada ou envenenada continua confiável até o fim do
  prazo. Combine com `listChanged` para que uma notificação invalide o cache.
- **Ser dono do stream listen.** O padrão não entrega nada em HTTP stateless; o handler próprio funciona, mas você carrega distribuição
  e capabilities.

## Documentation Links

- [Resources, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) (doc)
- [Prompts, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts) (doc)
- [Completion, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion) (doc)
- [Pagination, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination) (doc)
- [Caching, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) (doc)
- [Subscriptions, MCP specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions) (doc)
- [Specification changelog 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [MCP C# SDK 2.1.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.1.0) (doc)
