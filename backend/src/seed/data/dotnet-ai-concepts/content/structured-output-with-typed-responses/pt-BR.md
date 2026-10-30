---
version: 1.0
updatedAt: 2026-10-30
title: "Saída Estruturada com Respostas Tipadas"
summary: GetResponseAsync<T> e ChatResponse<T> com Ollama local, o JSON schema gerado pelo MEAI e o corpo HTTP real com o campo format, o embrulho em data para arrays e primitivos, ResponseFormat manual e o bug de JsonSerializerOptions, as falhas exatas vindas de um fake, required e Range depois do parse, retry limitado, nomes de enum, descrições e campos anuláveis medidos, e o custo em tokens do schema.
---
## Objective

Um modelo responde em texto; uma aplicação precisa de um `Ticket`, não de um
parágrafo. `GetResponseAsync<T>` do `Microsoft.Extensions.AI` transforma um
tipo C# em JSON schema, pede ao provedor que o siga e desserializa a resposta
em `ChatResponse<T>`. A lição extrai um record de um email com um modelo local,
mostra o schema e o corpo HTTP, reproduz falhas com um fake roteirizado,
separa parse de validação e mede o efeito de nomes, descrições, anulabilidade
e do schema nas respostas e nos tokens.
Versões: `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama
0.40.12 com `qwen3:4b-instruct` (temperatura 0, seed 42), .NET 10.

## Use Cases

- Extrair campos (cliente, pedido, datas) de emails para um record validado.
- Classificar texto num enum (categoria, prioridade, sentimento).
- Obter uma lista ou um número do modelo sem interpretar prosa.
- Trocar o "responda em JSON" com raspagem de string por uma chamada tipada.

## Deep Dive

### GetResponseAsync<T> num email de suporte

O email: Maria Souza pediu 3 unidades em 2026-10-12 (duas docks USB-C e um
suporte de monitor), pedido ORD-88213, nada chegou no Porto, Portugal, "please
hurry!". O tipo é o pedido; `Result` lança exceção na falha, `TryGetResult`
devolve `false`:

```csharp
public enum Priority { Low, Normal, Urgent }
public record Address(string City, string Country);
[Description("A support ticket extracted from a customer email")]
public record Ticket([property: Description("Customer full name")] string Customer, int Quantity,
    Priority Priority, string? OrderNumber, List<string> Products, Address ShipTo, DateOnly OrderDate);
ChatResponse<Ticket> r = await client.GetResponseAsync<Ticket>(   // client: OllamaApiClient
    "Extract the ticket from this email:\n" + email, new ChatOptions { Temperature = 0, Seed = 42 });
```

```text
Customer = Maria Souza, Quantity = 3, Priority = Urgent, OrderNumber = ORD-88213, OrderDate = 2026-10-12,
Products = [USB-C dock (x2), 27" monitor stand (x1)], ShipTo = Porto/Portugal, usage in=82 out=110
```

Idêntico em 3 de 3; `ChatResponse<T>` mantém `Text`, `Usage` e `FinishReason`.

### O schema que o MEAI gera

`ChatResponseFormat.ForJsonSchema<Ticket>()` monta o que é enviado (resumido):

```text
"description": "A support ticket extracted from a customer email", "type": "object",
"customer":    { "description": "Customer full name", "type": "string" },
"priority":    { "type": "string", "enum": ["Low", "Normal", "Urgent"] },
"orderNumber": { "type": ["string", "null"] },
"shipTo":      { "type": "object", "properties": {...}, "required": ["city", "country"] },
"orderDate":   { "type": "string", "format": "date" },
"required": ["customer","quantity","priority","orderNumber","products","shipTo","orderDate"]
```

`string?` vira união com `null`, mas segue obrigatório; não há
`additionalProperties`. `AIJsonUtilities.CreateJsonSchema(typeof(Ticket))` deu
o mesmo sem `$schema`. Ambos usam `AIJsonUtilities.DefaultOptions`: camelCase,
`JsonStringEnumConverter`, nomes case-insensitive, números lidos de strings.

### O que o OllamaSharp coloca no fio

Um `DelegatingHandler` no `HttpClient` passado a `new OllamaApiClient(http,
"qwen3:4b-instruct")` capturou o corpo de `/api/chat`: chaves `model, messages,
options, format, stream, CustomHeaders`, schema em `format`, mensagens
intactas. O blog do Ollama diz que `format` restringe a saída ao schema. Com
`useJsonSchemaResponseFormat: false`, `format` virou `"json"` e o MEAI somou
uma mensagem "Respond with a JSON value conforming to the following schema:"
com o schema. Mesmo email, `Usage` idêntico em 3 de 3:

| Pedido | `format` | in | out |
| --- | --- | --- | --- |
| prompt + "Reply with JSON only." | nenhum | 87 | 106 |
| idem + `ResponseFormat = ChatResponseFormat.Json` | `"json"` | 87 | 106 |
| `GetResponseAsync<Ticket>` | schema | 82 | 110 |
| `GetResponseAsync<Ticket>(..., useJsonSchemaResponseFormat: false)` | `"json"`, schema no prompt | 259 | 114 |

O schema nativo não custou tokens de entrada (as primeiras linhas pagam 5 pela
frase extra); no prompt custou 177. Sem schema o JSON veio em formato próprio
(`{"ticket": {"from": ...`). O 82 mostra que o schema não entrou como texto.

### Arrays e primitivos embrulhados em `data`

Um `T` que não é objeto é embrulhado (um comentário no código diz que os
provedores reais exigem objeto na raiz), enum também. Fake ou cache precisa
manter o embrulho:

```text
GetResponseAsync<string[]>, schema sent:
  {"type":"object","properties":{"data":{"type":"array","items":{"type":"string"}}},"additionalProperties":false,"required":["data"]}
Ollama (3 of 3): { "data": [ "red", "yellow", "blue" ] } -> red|yellow|blue   int: { "data": 8 } -> 8
fake "42" for int: InvalidOperationException: The requested operation requires an element of type 'Object', but the target element has type 'Number'.
```

### ResponseFormat à mão, e o descompasso do serializador

`ChatOptions.ResponseFormat` aceita `ChatResponseFormat.Text`, `.Json` ou
`.ForJsonSchema(...)`. Mandar o schema à mão funciona; ler a resposta com outras
opções de serialização é onde moram os bugs:

```csharp
options.ResponseFormat = ChatResponseFormat.ForJsonSchema<Ticket>();
JsonSerializer.Deserialize<Ticket>((await client.GetResponseAsync(prompt, options)).Text);
// Ticket { Customer = , Quantity = 0, Priority = Low, OrderNumber = , ... OrderDate = 1/1/0001 }
```

Nenhuma exceção, todo campo no default. `JsonSerializerDefaults.Web` lançou
`JsonException: The JSON value could not be converted to Ticket. Path:
$.priority`; `AIJsonUtilities.DefaultOptions` leu certo. Opções Web passadas a
`GetResponseAsync<T>` lançaram `InvalidOperationException: JsonSerializerOptions
instance must specify a TypeInfoResolver setting before being marked as
read-only.` Com resolver rodou, mas sem conversor de enum o schema dizia
`"type":"integer"`, o modelo escreveu `"priority": 1` e o email urgente voltou
`Normal`, 3 de 3. Comece de `new JsonSerializerOptions(AIJsonUtilities.DefaultOptions)`.

### Quando o texto não é o JSON esperado

Respostas de um `IChatClient` roteirizado, portanto deterministas:

```text
reply                                  Try    Result
""                                     false  InvalidOperationException: The response did not contain JSON to be deserialized.
"Sure! Here is the JSON: {...}"        false  JsonException: 'S' is an invalid start of a value. Path: $ | LineNumber: 0 | BytePositionInLine: 0.
"```json\n{...}\n```"                  false  JsonException: '`' is an invalid start of a value. ...
"null"                                 false  InvalidOperationException: The deserialized response is null.
{"label":"positive","score":"four"}    false  JsonException: The JSON value could not be converted to Sentiment. Path: $.score ...
{"label":"positive"}                   true   Score = 0
{"label":"first",...} {"label":"second",...}  true  Label = first
```

A 10.11.0 não remove nada: preâmbulo ou cerca de Markdown quebra o parse. No
Ollama os dois modos fizeram parse, 3 de 3. `/api/show` lista `thinking`, mas
`think: true` (via `AdditionalProperties`) devolveu só `TextContent`; um fake
com `TextReasoningContent` antes do JSON fez parse, pois `Text` o ignora.

### Desserializar não é validar, e um retry limitado

```csharp
public record Order { public required string OrderNumber { get; init; }
                      [Range(1, 100)] public int Quantity { get; init; } }
```

```text
fake {"quantity":250}: JsonException: JSON deserialization for type 'Order' was missing required properties including: 'orderNumber'.
fake {"orderNumber":"ORD-1","quantity":250}: TryValidateObject false, "The field Quantity must be between 1 and 100."
schema: "quantity": {"type":"integer","minimum":1,"maximum":100}, "required": ["orderNumber"]
Ollama, "order ORD-7, we need 250 units.": {"orderNumber":"ORD-7","quantity":25}  (250 without [Range])
```

Lida como `LooseOrder(string OrderNumber, int Quantity)`, a primeira deu `null`,
sem erro. `[Range]` exige `Validator.TryValidateObject` depois do parse; ele também
virou `minimum`/`maximum`, e o Ollama então devolveu 25 para "250 units" em 3
de 3: válido, e errado. Um retry limitado pode devolver o erro ao modelo:

```csharp
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    var response = await client.GetResponseAsync<T>(messages); string error;
    try { T v = response.Result; var errs = new List<ValidationResult>();
          if (Validator.TryValidateObject(v, new(v), errs, true)) return (v, attempt);
          error = string.Join("; ", errs.Select(e => e.ErrorMessage)); }
    catch (Exception e) when (e is JsonException or InvalidOperationException) { error = e.Message; }
    messages.AddMessages(response);
    messages.Add(new(ChatRole.User, $"That answer was rejected: {error} Reply again with corrected JSON."));
}
```

```text
fake "Sorry, here it is: {", then quantity 250, then 25: Quantity = 25, attempts=3, calls=3, last call 5 messages
fake always "nope": result=null attempts=3 calls=3
```

### Nomes e descrições são o prompt

Seis mensagens (duas de cada: cobrança, entrega, técnica), 3 execuções, com
records que só diferem no enum: `Category { Billing, Shipping, Technical }`,
`Code { C1, C2, C3 }`, e `Code` com `[Description("C1 = billing or payments,
C2 = shipping or delivery, C3 = technical problem with the app")]`:

```text
                          Category   Code   Code + [Description]
native schema (format)      6/6       3/6          3/6
schema in the prompt        6/6       3/6          6/6
```

Idêntico nas 3 execuções. Renomear os membros custou metade do acerto; o
`[Description]` não mudou nada no nativo e resolveu no modo prompt, como a
tabela de tokens indicava. Ponha o sentido no nome do membro, ou nas instruções.

### Anulável versus obrigatório para fatos ausentes

"Hi, I'm Joao Lima. My order still hasn't arrived, can you check? Thanks." não
tem número de pedido nem telefone; cada linha se repetiu 3 de 3:

```text
                                       string OrderNumber, Phone   string? OrderNumber, Phone
native                                 "Not provided"              "Not provided"
prompt mode                            ""                          null
native + "Use null for anything..."    "null" (a string)           null
```

`string?` sozinho não impediu a invenção no modo nativo; com uma instrução,
impediu. Sem `?` o modelo escreveu a string `"null"`, que passa por `required`.

## Trade-offs

- **Schema nativo versus schema no prompt.** No Ollama o nativo saiu de graça e
  garantiu o formato, mas escondeu as descrições; o modo prompt custou 177
  tokens. A referência da API diz que o default nativo "might cause an error if
  the model does not support it"; `useJsonSchemaResponseFormat: false` é a saída.
- **Retries e streaming.** Cada retry reenvia o histórico. Não há
  `GetResponseAsync<T>` em streaming: 10 de 110 atualizações formavam
  `{ "customer": "Maria Souza",` (não é JSON); `new ChatResponse<Ticket>(updates.ToChatResponse(),
  AIJsonUtilities.DefaultOptions).Result` funcionou após o stream, 3 de 3.
- **Modos strict dos provedores diferem.** A documentação do Azure OpenAI exige
  todo campo obrigatório e `additionalProperties` false, e lista `format`,
  `minimum` e `maximum` como não suportados. `Ticket` não tem
  `additionalProperties: false` e usa `format: date`; como o adaptador OpenAI
  trata isso não foi testado aqui.
- **Quando não usar.** Se o modelo precisa decidir agir, consultar algo ou
  pedir dados, use ferramentas (Tool Calling with AIFunction). Saída
  estruturada serve para extrair e classificar num formato conhecido.

## Documentation Links

- [Quickstart: Request a response with structured output, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/structured-output) (doc)
- [ChatClientStructuredOutputExtensions.GetResponseAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.ai.chatclientstructuredoutputextensions.getresponseasync) (doc)
- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
- [Structured outputs, Ollama Blog](https://ollama.com/blog/structured-outputs) (doc)
- [How to use structured outputs with Azure OpenAI, Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) (doc)
