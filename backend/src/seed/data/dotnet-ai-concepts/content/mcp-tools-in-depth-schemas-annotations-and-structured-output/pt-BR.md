---
version: 1.0
updatedAt: 2026-11-19
title: "Tools MCP a Fundo: Schemas, Annotations e Saída Estruturada"
summary: O contrato de uma tool MCP medido no fio com o SDK C# 2.4.0, sem modelo. O inputSchema gerado a partir da assinatura (enum, nullable, defaults, DataAnnotations que não são validadas), $ref e qualquer keyword de JSON Schema 2020-12, outputSchema e structuredContent lidos como tipo pelo cliente, annotations como dicas não confiáveis, os cinco tipos de bloco de conteúdo, a ordem de tools/list e o cache, x-mcp-header com validação de -32020 e as regras de nome de tool.
---
## Objective

Uma tool é um contrato: um nome, um `inputSchema` que o modelo preenche, um `outputSchema` opcional, dicas sobre efeitos colaterais e uma lista de blocos de conteúdo na resposta. A lição introdutória de MCP cobre `[McpServerTool]`, `[Description]` e tratamento de erros; esta mede o próprio contrato no fio: o JSON Schema que o SDK C# gera a partir da assinatura do método, o `structuredContent` lido de volta como valor tipado, o que as annotations realmente colocam em `tools/list`, os cinco tipos de bloco de conteúdo, a ordem de `tools/list`, o `x-mcp-header` e as regras de nome. Não há modelo: tudo abaixo é JSON-RPC cru contra um servidor real. Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0 (uma comparação na 2.3.0), `net10.0`, SDK 10.0.100, revisão 2026-07-28 da spec, Streamable HTTP em modo stateless.

## Use Cases

- Deixar o `inputSchema` gerado preciso (enums, faixas, defaults) para o modelo preencher os argumentos certo.
- Devolver um record tipado e deixar qualquer cliente desserializar em vez de interpretar texto.
- Marcar tools somente leitura e destrutivas para o host decidir o que confirmar.
- Devolver imagens, arquivos e links de uma tool, e manter `tools/list` estável para caches.

## Deep Dive

### O servidor usado em todas as medições

As tools são métodos comuns; o SDK monta o schema com `AIJsonUtilities` a partir da assinatura.

```csharp
builder.Services.AddMcpServer()
    .WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless)
    .WithTools<SchemaTools>().WithTools<OutputTools>().WithTools<HintTools>()
    .WithTools<ContentTools>().WithTools<HeaderTools>();
app.MapMcp("/mcp"); app.Run("http://127.0.0.1:6040");

public enum Priority { Low, Normal, High }
public record Address([property: Required, StringLength(40, MinimumLength = 2)] string City,
                      [property: RegularExpression(@"^\d{5}$")] string? Zip = null);
public record Forecast(string City, double TempC, string[] Conditions, DateOnly Day);
```

As chamadas cruas abaixo são POSTs de `curl` com os três headers da 2026-07-28 (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) e `_meta` com a versão do protocolo.

### Como o SDK monta o inputSchema

Um método com um parâmetro de cada forma interessante, depois `tools/list`:

```csharp
[McpServerTool(Name = "describe_all")]
public string DescribeAll(string sku, int quantity, double price, bool gift, Priority priority,
    Address shipTo, string[] tags, List<int> sizes, Dictionary<string, int> limits,
    int? maxItems, string? coupon, DateTimeOffset when, Guid id,
    int pageSize = 20, Priority fallback = Priority.Normal, bool refundable = true,
    [Range(1, 10)] int rating = 5, [StringLength(8, MinimumLength = 3)] string code = "abc",
    [Required] string? mustHave = null,
    IServiceProvider? sp = null, Counter? counter = null, CancellationToken ct = default)
```

```text
quantity   {"type":"integer"}                     price   {"type":"number"}
priority   {"type":"string","enum":["Low","Normal","High"]}
shipTo     {"type":"object","properties":{"city":{"type":"string","minLength":2,"maxLength":40},"zip":{"type":["string","null"],"default":null,"pattern":"^\\d{5}$"}},"required":["city"]}
sizes      {"type":"array","items":{"type":"integer"}}
limits     {"type":"object","additionalProperties":{"type":"integer"}}
maxItems   {"type":["integer","null"]}           when    {"type":"string","format":"date-time"}
id         {"type":"string","format":"uuid"}
pageSize   {"type":"integer","default":20}
fallback   {"type":"string","enum":["Low","Normal","High"],"default":"Normal"}
rating     {"type":"integer","default":5,"minimum":1,"maximum":10}
code       {"type":"string","default":"abc","minLength":3,"maxLength":8}
mustHave   {"type":["string","null"],"default":null}
required   ["sku","quantity","price","gift","priority","shipTo","tags","sizes","limits","maxItems","coupon","when","id","mustHave"]
```

O que a medição mostrou: um enum vira um schema de string com os nomes dos membros, não números; um parâmetro com valor default sai de `required` e ganha `default`; `int?` e `string?` viram `["integer","null"]`, mas continuam obrigatórios quando não têm default (nullable não é opcional); `[Range]` e `[StringLength]` viram `minimum`, `maximum`, `minLength`, `maxLength`; `[Required]` numa propriedade de record põe `city` no `required` aninhado, e no parâmetro `mustHave` manteve o parâmetro em `required` mesmo com default (o tipo continua `["string","null"]`, então é obrigatório mas pode ser nulo). `IServiceProvider`, `Counter` (um serviço registrado) e `CancellationToken` não entram no schema. O `[Description]` de um parâmetro aparece como `description` (o concept do SDK C# mostra isso). Um método sem parâmetros gera `{"type":"object","properties":{}}`; a spec recomenda `"additionalProperties": false` nesse caso, e o SDK não emite.

O schema é só anúncio. `[Range]` não é imposto:

```text
validated {"rating":99,"code":"toolongvalue"}  ->  "rating=99 code=toolongvalue"   (o schema dizia máximo 10 e maxLength 4)
validated {"rating":"x","code":"ab"}           ->  isError, "An error occurred invoking 'validated'."
validated {"code":"ab"}                        ->  isError, mesmo texto genérico (faltou rating)
validated {"rating":1,"code":"ab","extra":1}   ->  aceito, propriedade extra ignorada
```

O XML doc de `McpServerToolAttribute` diz claramente: data annotations influenciam o schema mas não são impostas em runtime, então valide dentro do método. Tipo errado ou argumento ausente é falha de binding e volta como o `isError` genérico, não como `-32602` do JSON-RPC, e o modelo não recebe pista do que corrigir, a menos que você lance uma `McpException` por conta própria.

### $ref, $defs e qualquer keyword 2020-12

O SEP-2106 do changelog da 2026-07-28 afrouxou `inputSchema` e `outputSchema` para aceitar qualquer keyword de JSON Schema 2020-12 e acrescentou regras para `$ref`: uma implementação NÃO PODE (MUST NOT) dereferenciar por padrão um `$ref` que resolve para uma URI de rede, e DEVERIA (SHOULD) limitar keywords de composição (`anyOf`, `oneOf`, `allOf`, `if/then/else`, `$defs`) contra negação de serviço.

Os schemas gerados repetem tipos inline: `from` e `to` numa tool com dois parâmetros `Address` carregam duas cópias completas. Só a recursão produz referência, `{"$ref":"#/properties/tree"}` para `Node(string Label, List<Node> Children)`. Um schema escrito à mão passa sem alteração, com `$schema`, `$defs`, `$ref`, `oneOf` e `if/then` (uma `AIFunction` com `JsonSchema` próprio, listada como está, na entrada e na saída). O SDK também não valida os argumentos contra ele: `{"price":{"amount":-5,"currency":"GBP"},"payment":"card"}` violou `exclusiveMinimum`, o `enum` e a cláusula `then`, e a chamada executou. Trate o schema como documentação para o modelo e imponha as regras no código. Um retorno em tupla gerou um schema de saída inútil, `{"type":"object"}`: devolva um record nomeado.

### outputSchema e structuredContent

`UseStructuredContent = true` anuncia um schema de saída construído a partir do tipo de retorno e preenche `structuredContent`:

```csharp
[McpServerTool(Name = "forecast", UseStructuredContent = true)]
public Forecast GetForecast(string city) => new(city, 21.5, ["sunny", "windy"], new DateOnly(2026, 11, 19));
```

```text
"outputSchema":{"type":"object","properties":{"city":{"type":"string"},"tempC":{"type":"number"},"conditions":{"type":"array","items":{"type":"string"}},"day":{"type":"string","format":"date"}},"required":["city","tempC","conditions","day"]}
tools/call -> {"result":{"content":[{"type":"text","text":"{\"city\":\"Berlin\",\"tempC\":21.5,...}"}],
  "structuredContent":{"city":"Berlin","tempC":21.5,"conditions":["sunny","windy"],"day":"2026-11-19"},"resultType":"complete",...}}
```

O bloco de texto é o mesmo JSON serializado, como a spec pede por compatibilidade. O mesmo record sem `UseStructuredContent` (`forecast_plain`) mandou só o bloco de texto e nenhum schema. O cliente C# lê o valor em `CallToolResult.StructuredContent` (um `JsonElement?`):

```csharp
CallToolResult r = await client.CallToolAsync("forecast", new() { ["city"] = "Berlin" });
Forecast f = r.StructuredContent!.Value.Deserialize<Forecast>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
```

Na 2026-07-28 o schema de saída pode ser qualquer schema e o `structuredContent` qualquer valor JSON, sem o envelope `{"result": ...}` (a doc do SDK diz isso):

```text
temperature (int)        outputSchema {"type":"integer"}   structuredContent 72 (ValueKind Number)
forecast_list (List<T>)  outputSchema {"type":"array","items":{...}}   structuredContent [ {...}, {...} ]
```

As mesmas tools chamadas por um cliente fixado em `ProtocolVersion = "2025-11-25"` recebem o envelope antigo: `{"result":72}` com `{"type":"object","properties":{"result":{"type":"integer"}},"required":["result"]}`. Um servidor atende os dois, e o cliente precisa ler o valor conforme o schema que recebeu, sem presumir um formato. `McpClientTool.ReturnJsonSchema` o expõe.

O que o SDK não faz é conferir a saída. `forecast_liar` anuncia `Forecast` por `OutputSchemaType`, mas devolve `{"city":"Rome","tempC":"hot"}`: o servidor enviou, o cliente retornou com `IsError` nulo, e só o `Deserialize<Forecast>` falhou: `JsonException: The JSON value could not be converted to Forecast. Path: $.tempC`. A spec diz que servidores DEVEM (MUST) obedecer e clientes DEVERIAM (SHOULD) validar, então um cliente que se importa deve validar com a própria biblioteca de JSON Schema. Outros casos: um `Forecast?` que retorna `null` gerou `content: []` e nenhum `structuredContent`; uma `McpException` lançada gerou `isError: true` com o texto e sem `structuredContent`. Não confunda com o recurso de LLM também chamado de structured output (veja `structured-output-with-typed-responses`): a spec afirma que `structuredContent` não tem relação com geração de modelo restrita por schema.

### Annotations: dicas, não garantias

```csharp
[McpServerTool(Name = "lookup", Title = "Look up an order", ReadOnly = true, OpenWorld = false)]
[McpServerTool(Name = "cancel_order", Destructive = true, Idempotent = true, OpenWorld = false)]
[McpServerTool(Name = "append_note", Destructive = false)]
[McpServerTool(Name = "liar_readonly", ReadOnly = true)]   // incrementa um contador
```

```text
unannotated   (sem title, sem annotations)
lookup        title "Look up an order", annotations {"title":"Look up an order","openWorldHint":false,"readOnlyHint":true}
cancel_order  annotations {"destructiveHint":true,"idempotentHint":true,"openWorldHint":false}
append_note   annotations {"destructiveHint":false}
liar_readonly annotations {"readOnlyHint":true}
```

Só o que você define é enviado; as propriedades C# devolvem os defaults da spec quando não definidas, mas o fio omite, então o cliente vê `null` e aplica os defaults da spec por conta própria: `readOnlyHint` falso, `destructiveHint` verdadeiro, `idempotentHint` falso, `openWorldHint` verdadeiro (ou seja, pela spec uma tool sem annotations é destrutiva e de mundo aberto). `destructiveHint` e `idempotentHint` só significam algo quando `readOnlyHint` é falso. O `Title` é copiado para a tool e para `annotations.title`.

`liar_readonly` declarou `readOnlyHint: true` e, chamada duas vezes, respondeu `counter is now 1` e `counter is now 2`: nada impede um servidor de mentir. A spec diz que clientes DEVEM (MUST) tratar annotations como não confiáveis, a menos que venham de servidores confiáveis, e nunca decidir o uso de uma tool com base em annotations de servidores não confiáveis. Use-as como dica de interface (um diálogo de confirmação, um selo); as consequências de segurança (tool poisoning, rug pull) pertencem à lição de segurança de MCP.

### Os cinco tipos de bloco de conteúdo no fio

```csharp
public ImageContentBlock GetImage() => ImageContentBlock.FromBytes(png, "image/png");
public AudioContentBlock GetAudio() => AudioContentBlock.FromBytes(bytes, "audio/wav");
public EmbeddedResourceBlock GetDoc() => new() { Resource = new TextResourceContents { Uri = "docs://readme", MimeType = "text/plain", Text = "..." } };
public EmbeddedResourceBlock GetBlob() => new() { Resource = BlobResourceContents.FromBytes(pdf, "docs://manual.pdf", "application/pdf") };
public ResourceLinkBlock GetLink() => new() { Uri = "file:///reports/q3.csv", Name = "q3.csv", Description = "Quarterly report", MimeType = "text/csv" };
```

```text
[{"type":"image","data":"iVBORw0KGgo...","mimeType":"image/png"}]
[{"type":"audio","data":"AQIDBA==","mimeType":"audio/wav"}]
[{"type":"resource","resource":{"uri":"docs://readme","mimeType":"text/plain","text":"Reservations expire after 24 hours."}}]
[{"type":"resource","resource":{"uri":"docs://manual.pdf","mimeType":"application/pdf","blob":"JVBERg=="}}]
[{"type":"resource_link","uri":"file:///reports/q3.csv","name":"q3.csv","description":"Quarterly report","mimeType":"text/csv"}]
```

Payloads binários vão em base64 em `data` ou `blob`; o cliente expõe `DecodedData`. Um resource embutido carrega o conteúdo dentro do resultado; um resource link só aponta para ele, e a spec diz que recursos linkados não têm garantia de aparecer em `resources/list`. Devolver `IEnumerable<ContentBlock>` dá vários blocos num resultado (`text`, `image`, `resource_link`). Qualquer bloco pode levar `annotations` com `audience`, `priority` e `lastModified`: o servidor 2.3.0 enviou `"annotations":{"audience":["user","assistant"],"priority":0.7,"lastModified":"2026-11-01T10:00:00+00:00"}`, mas na 2.4.0 todo resultado com bloco anotado falhou com `-32603 An error occurred.` e, no servidor, um `InvalidOperationException: Cannot insert the values of 'TypeInfoResolver' or 'TypeInfoResolverChain' ...` em `ContentBlock.Converter.CreateNestedOptions`. É a issue 2012, aberta no repositório do SDK (P2, reportada em 2026-11-18; não achei correção em 2.4.x): até sair, não defina `Annotations` em blocos de conteúdo na 2.4.0.

### Ordem de tools/list e cache

A spec diz que servidores DEVERIAM (SHOULD) devolver as tools em ordem determinística, para o cliente poder cachear a lista e para aumentar o acerto do prompt cache do LLM, já que a lista de tools fica no começo do prompt do modelo. O SDK mantém a ordem de inserção: `McpServerPrimitiveCollection` entrega as tools na ordem em que foram adicionadas, e `WithTools<T>()` adiciona os métodos do tipo na ordem que a reflexão devolve (ordem de declaração na prática, sem garantia documentada). Três reinícios do servidor produziram o mesmo `tools/list` (mesmo SHA-256 do JSON, 27 tools). Uma tool removida e readicionada vai para o fim:

```text
registered      : zeta,alpha,mid
alpha re-added  : zeta,mid,alpha
```

Então adicionar e remover tools dinamicamente (e `listChanged`) reordena o prefixo do prompt e invalida o prompt cache a partir daquele ponto. A ordem de registro é o seu contrato: ponha as tools estáveis primeiro. O mesmo resultado traz os novos campos de cache: `"ttlMs":0,"cacheScope":"private"` por padrão (conservador: não cacheie). Um `AddListToolsFilter` que definiu `TimeToLive = 5 minutos` e `CacheScope.Public` produziu `"ttlMs":300000,"cacheScope":"public"` no fio.

### x-mcp-header: parâmetros espelhados em headers HTTP

O SEP-2243 deixa uma tool marcar um parâmetro primitivo para o cliente copiá-lo em `Mcp-Param-{Name}`, permitindo que balanceadores e WAFs roteiem sem ler o corpo. O SDK suporta com `[McpHeader("Region")]` num parâmetro:

```csharp
public string ExecuteSql([McpHeader("Region")] string region, [McpHeader("Shard")] int shard,
                         [McpHeader("Dry-Run")] bool dryRun, string query)
```

O schema ganhou `"region":{"description":"Target region","type":"string","x-mcp-header":"Region"}` (e `"shard"`, `"dryRun"` do mesmo jeito), e o cliente C# adicionou os headers sozinho:

```text
Mcp-Method=tools/call Mcp-Name=execute_sql Mcp-Param-Region=us-west1 Mcp-Param-Shard=7 Mcp-Param-Dry-Run=true
Mcp-Method=tools/call Mcp-Name=execute_sql Mcp-Param-Region==?base64?c8Ojby1wYXVsbw==?= ...   (valor "são-paulo")
```

Valores não ASCII viajam como `=?base64?...?=`. O servidor valida os headers contra o corpo (spec: 400 e `-32020`, `HeaderMismatch`). POSTs crus, sem cliente:

```text
Mcp-Param-* corretos          -> HTTP 200
sem nenhum Mcp-Param-*        -> HTTP 400 {"error":{"code":-32020,"message":"Missing required Mcp-Param-Region header for parameter 'region' annotated with x-mcp-header."}}
Mcp-Param-Region: eu-central1 -> HTTP 400 -32020 "Header mismatch: Mcp-Param-Region header value does not match body argument 'region'."
Mcp-Name: other               -> HTTP 400 -32020 "Header mismatch: Mcp-Name header value 'other' does not match body value 'execute_sql'."
```

No registro o SDK rejeita o uso inválido: `[McpHeader]` num `double` ou `string[]` lança `InvalidOperationException` ("Only string, integer, and boolean types"), um nome duplicado ignorando maiúsculas (`Region` e `region`) lança, e o construtor do atributo lança `ArgumentException` para nome com `:` ou espaço; `long` é aceito. A spec diz que clientes podem ignorar a anotação em stdio e alerta para não espelhar segredos, já que intermediários enxergam os headers. Só o protocolo 2026-07-28 valida (doc do SDK, só documentação: medi com a versão padrão).

### Nomes de tool

A spec diz que nomes de tool DEVERIAM (SHOULD) ter de 1 a 128 caracteres, diferenciar maiúsculas e usar só `A-Z a-z 0-9 _ - .`. O SDK não fica no SHOULD: criar uma tool lança `ArgumentException: The tool name '...' is invalid. Tool names must match the regular expression '^[A-Za-z0-9_.-]{1,128}\z'`. Medido: `bad name!`, um nome de 129 caracteres, `café` e a string vazia foram recusados (a última na subida do servidor), `dots.and-dashes_ok` foi aceito. Quem agrega tools de vários servidores ainda precisa tratar colisões: a spec sugere prefixar com um identificador do servidor e diz que `serverInfo.name` não é único.

## Trade-offs

- **Schema gerado vs escrito à mão.** A assinatura dá um schema correto de graça, mas ele é só anúncio. Um schema `$defs` escrito à mão expressa `oneOf` ou `if/then`, e mesmo assim nada confere os argumentos: valide de novo no método (`McpException` com uma mensagem que o modelo consiga usar).
- **`UseStructuredContent` vs só texto.** Saída tipada poupa cada cliente de interpretar texto e documenta o formato, ao custo de um schema que o cliente pode impor e de um servidor que nunca se confere. Saídas que não são objeto exigem clientes na 2026-07-28; os antigos recebem o envelope `result`.
- **Annotations vs controles reais.** `readOnlyHint` ajuda o host a pular uma confirmação, mas só vindo de um servidor confiável. Para tools que você não controla, mantenha allow-list e aprovação (veja a lição do SDK C#) em vez de confiar nas dicas.
- **Resource embutido vs resource link.** Embutir manda os bytes em todo resultado (custo em tokens e banda); o link é pequeno, mas exige um `resources/read` a mais, e o destino pode não estar listado.
- **Lista de tools dinâmica vs prompt caching.** Adicionar tools em runtime é flexível, mas move a fronteira do cache; prefira um núcleo estável e ordenado.
- **`x-mcp-header` vs só corpo.** Headers permitem rotear por região ou tenant sem ler JSON, mas o valor fica visível a todo proxy e precisa bater com o corpo, ou a chamada falha com `-32020`.

## Documentation Links

- [Tools, Model Context Protocol specification 2026-07-28, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (doc)
- [Specification changelog 2026-07-28 (SEP-2106, SEP-2243, ordem de tools/list), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (doc)
- [Basic protocol and JSON Schema usage, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic) (doc)
- [Streamable HTTP and custom headers from tool parameters, modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (doc)
- [Schema reference (ToolAnnotations), modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2026-07-28/schema) (doc)
- [Tools, MCP C# SDK concepts](https://csharp.sdk.modelcontextprotocol.io/concepts/tools/tools.html) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
- [Issue 2012: annotated content blocks fail in 2.4.0, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/issues/2012) (doc)
- [JSON Schema 2020-12 core, json-schema.org](https://json-schema.org/draft/2020-12/json-schema-core) (doc)
