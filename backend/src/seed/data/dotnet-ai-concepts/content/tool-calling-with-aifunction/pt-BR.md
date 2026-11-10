---
version: 1.0
updatedAt: 2026-10-30
title: "Chamada de Ferramentas com AIFunction"
summary: AIFunctionFactory.Create e o JSON schema gerado, ChatOptions.Tools e ToolMode ignorado pelo OllamaSharp, o loop manual com FunctionCallContent e FunctionResultContent, UseFunctionInvocation com contagem de chamadas, limites de iteração e de erros, IncludeDetailedErrors, AllowConcurrentInvocation, FunctionInvoker, ferramentas desconhecidas, argumentos inválidos, aprovação com ApprovalRequiredAIFunction, validação dentro da ferramenta e o custo em tokens das definições.
---
## Objective

Tool calling deixa o modelo pedir à aplicação que execute código: a requisição
descreve as ferramentas, o modelo responde com uma chamada de função em vez de
texto, a aplicação executa e devolve o resultado. No Microsoft.Extensions.AI a
unidade é `AIFunction`: `AIFunctionFactory.Create` cria uma a partir de um
método, `ChatOptions.Tools` a envia e `FunctionInvokingChatClient`
(`UseFunctionInvocation()`) roda o loop. A lição imprime o schema, escreve o
loop à mão e mede limites, erros, aprovações e tokens com `qwen3:4b-instruct`
no Ollama (3 execuções cada) e um `IChatClient` fake para a parte
determinística. Versões: `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp`
5.5.0, Ollama 0.40.12, .NET 10.

## Use Cases

- Responder com dados vivos (estoque, pedidos, clima) que o modelo não conhece.
- Deixar o modelo agir (abrir chamado, enviar e-mail) com validação e aprovação.
- Reusar uma lista de `AIFunction` em chat clients, servidores MCP e agentes.
- Testar o loop com um client roteirizado: chamadas fixas, sem modelo.

## Deep Dive

### De um método para uma AIFunction

`AIFunctionFactory.Create` lê o nome do método, o `[Description]` do método e
dos parâmetros, e os tipos dos parâmetros:

```csharp
[Description("Gets the forecast for a location.")]
public static string GetForecast([Description("Where")] Location location, DateOnly date,
    DateTime? notAfter, Unit unit, [Description("How many days, 1 to 7")] int days,
    int? maxResults, bool includeWind = false) => ...;
record Location(string City, string? Country);   enum Unit { Celsius, Fahrenheit }

AIFunction f = AIFunctionFactory.Create(WeatherTools.GetForecast);   // imprime f.JsonSchema
```

```text
"location":    {"description":"Where","type":"object","properties":{"city":{"type":"string"},
                "country":{"type":["string","null"]}},"required":["city","country"]}
"date": {"type":"string","format":"date"}   "notAfter": {"type":["string","null"],"format":"date-time"}
"unit": {"type":"string","enum":["Celsius","Fahrenheit"]}   "maxResults": {"type":["integer","null"]}
"days": {"description":"How many days, 1 to 7","type":"integer"}
"includeWind": {"type":"boolean","default":false}
"required": ["location","date","notAfter","unit","days","maxResults"]
```

Só o parâmetro com valor padrão é opcional. Um tipo anulável sem padrão continua
obrigatório: invocar sem `notAfter` lançou `ArgumentException: The arguments
dictionary is missing a value for the required parameter 'notAfter'`. "1 to 7"
é só texto; nada impõe. Uma lambda ganhou o nome `_Main_b_0_6` e descrição
vazia, então dê nome às lambdas: `Create(delegate, "GetTime", "...")`.

`AIFunctionFactoryOptions` define `Name`, `Description` e `SerializerOptions`.
O padrão, `AIJsonUtilities.DefaultOptions`, usa camelCase e
`JsonStringEnumConverter`. Com um `JsonSerializerOptions` simples, as
propriedades do record viraram `City`/`Country`, `unit` virou
`{"type":"integer"}`, e o argumento camelCase `{"city":"Lisbon"}` virou em
silêncio `Location { City = , Country = }`, sem erro. Schema e binding precisam
das mesmas opções.

### O que chega ao Ollama, e ToolMode

Um `HttpMessageHandler` gravador sob o `OllamaApiClient` mostrou cada ferramenta
no corpo de `/api/chat` como `{"type":"function","function":{"name":...,
"description":...,"parameters":<schema>}}`, mais `"additionalProperties":false`.
`ChatOptions.ToolMode` é `Auto`, `RequireAny`, `None` ou
`RequireSpecific("name")`. O OllamaSharp 5.5.0 ignora: os cinco geraram o mesmo
corpo, com as duas ferramentas e nenhum campo para o modo. Com `None`, "What is
the weather in Lisbon?" ainda chamou `GetWeather` em 3 de 3 execuções; com
`RequireAny`, "Say hello" recebeu texto puro. O `FunctionInvokingChatClient`
repassa o valor intacto. Para negar ferramentas, deixe-as fora de `Tools`.

### O loop à mão

A chamada chega como `FunctionCallContent`; o resultado volta como
`FunctionResultContent` com o mesmo `CallId` numa mensagem `ChatRole.Tool`:

```csharp
List<ChatMessage> messages = [new(ChatRole.User, "What is the weather in Lisbon? Answer in one sentence.")];
while (true)
{
    ChatResponse r = await client.GetResponseAsync(messages, options); messages.AddMessages(r);
    var calls = r.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>().ToList();
    if (calls.Count == 0) break;
    foreach (var fc in calls)
        messages.Add(new(ChatRole.Tool, [new FunctionResultContent(fc.CallId,
            await weather.InvokeAsync(new AIFunctionArguments(fc.Arguments)))]));
}
```

```text
model calls = 2
  [0] user: Text "What is the weather in Lisbon? Answer in one sentence."
  [1] assistant: FunctionCall GetWeather({"city":"Lisbon"}) id=6cd6ff48
  [2] tool: FunctionResult id=6cd6ff48 "Lisbon: 18 C, light rain"
  [3] assistant: Text "The weather in Lisbon is 18 degrees Celsius with light rain."
```

Mesma lista em 3 de 3 execuções, exceto o `CallId`: o Ollama cru devolveu um id
de 32 caracteres, o OllamaSharp expôs um novo, próprio, de 8 hexadecimais.

### UseFunctionInvocation

`new ChatClientBuilder(ollama).UseFunctionInvocation().Build()` roda esse loop.
Uma camada contadora abaixo dele viu 2 chamadas ao modelo por pergunta; o
`ChatResponse` trouxe as 3 mensagens novas e `Usage` somou as duas (in 170 +
231 = 401). "Compare the weather in Lisbon and Porto" gerou duas chamadas num
turno, os resultados numa só mensagem de tool, ainda 2 chamadas (3 de 3).
Padrões: `MaximumIterationsPerRequest` 40, `MaximumConsecutiveErrorsPerRequest`
3, os outros três false.

A página do Learn diz que o client "supports parallel function calling
automatically": ele aceita várias chamadas por turno, mas as executa uma após a
outra. Um fake com duas chamadas a uma ferramenta de 300 ms levou cerca de 600
ms (Porto começou quando Lisbon terminou); com `AllowConcurrentInvocation =
true` as duas começaram em 0 ms e levou cerca de 300 ms.

### Quando o loop dá errado (fake roteirizado)

Com um fake que sempre responde com uma chamada e `MaximumIterationsPerRequest
= 3`, o fake foi chamado 4 vezes (ferramentas enviadas: 1, 1, 1, 0), a
ferramenta rodou 3 vezes e nada foi lançado: após o limite o client pergunta
mais uma vez sem ferramentas e devolve o que vier, aqui 7 mensagens terminando
num `FunctionCall GetWeather` sem resposta e `FinishReason` nulo. Verifique.

Uma ferramenta que lança `InvalidOperationException("Database password expired
for Lisbon")` entrega ao modelo:

```text
IncludeDetailedErrors=False: FunctionResult "Error: Function failed."
IncludeDetailedErrors=True:  FunctionResult "Error: Function failed. Exception: Database password expired for Lisbon"
```

O padrão esconde detalhes internos do modelo e do usuário; devolva sua própria
mensagem curta em vez de ligar a opção. Se o modelo insiste na ferramenta,
`MaximumConsecutiveErrorsPerRequest = 2` relançou a `InvalidOperationException`
da ferramenta após 3 chamadas ao fake; `0`, após a primeira.

```text
// unknown names and bad arguments, IncludeDetailedErrors = true
"DeleteEverything": "Error: Requested function "DeleteEverything" not found."   loop continues
TerminateOnUnknownCalls=true: loop stops, the FunctionCallContent is returned to the caller
days = "three": "Error: Function failed. Exception: Object of type 'System.String' cannot be converted to type 'System.Int32'."
days missing:   "Error: Function failed. Exception: The arguments dictionary is missing a value for the required parameter 'days'. (Parameter 'arguments')"
extra "country": ignored, tool ran      days = "2": converted, tool ran
```

O qwen3:4b-instruct nunca mandou tipo errado em 3 execuções de vários prompts.
O que se repetiu, 3 de 3: "Weather forecast for Lisbon." gerou
`GetForecastDays({"city":"Lisbon","days":5})`, um valor que ninguém deu. O
Learn avisa que "models might hallucinate arguments"; nenhum schema pega isso,
então torne o parâmetro opcional com padrão, ou faça a ferramenta perguntar.

### FunctionInvoker e validação na ferramenta

`FunctionInvoker` envolve cada invocação; seu `FunctionInvocationContext` tem
`Function`, `Arguments`, `CallContent`, `Iteration`, `FunctionCallIndex` e
`FunctionCount` (logados abaixo), o bastante para auditoria e autorização:

```csharp
.UseFunctionInvocation(configure: f => f.FunctionInvoker = async (ctx, ct) =>
    ctx.Function.Name == "DeleteAccount" ? "Not allowed: the current user lacks the admin role."
        : await ctx.Function.InvokeAsync(ctx.Arguments, ct))
```

```text
ctx: GetWeather call 1/2 iteration 0 id=a; DeleteAccount call 2/2 iteration 0 id=b
tool: FunctionResult id=a "Lisbon: 18 C, light rain" + FunctionResult id=b "Not allowed: ..."
```

Os argumentos vêm do modelo, então trate-os como um corpo HTTP. `Transfer`
confere `to` contra `^ACC-[0-9]{1,10}$` e `amount` entre 0 e 1000 antes de
qualquer efeito colateral, e devolve uma frase que o modelo consegue usar:

```text
fake, to="'; DROP TABLE x;--" -> "Rejected: 'to' must match ACC-<digits>."   side effects = 0
qwen3, "Transfer 5000 euros to account ACC-42." -> Transfer({"to":"ACC-42","amount":5000})
  -> "Rejected: amount must be between 0.01 and 1000 euros." -> "The transfer was rejected because ..."
```

O modelo real repassou a recusa em 3 de 3 execuções. Ferramenta com efeito
colateral também precisa de idempotência: o `CallId` muda a cada chamada, então
deduplicar exige uma chave de negócio (um id de pedido como argumento).

### Aprovação: ApprovalRequiredAIFunction

Na 10.11.0 os conteúdos são `ToolApprovalRequestContent`/`...ResponseContent`
(não existe `FunctionApprovalRequestContent`). Uma função envolvida para o loop:

```csharp
var transfer = new ApprovalRequiredAIFunction(AIFunctionFactory.Create(WeatherTools.Transfer));
var r1 = await client.GetResponseAsync(history, new() { Tools = [transfer] });
history.AddMessages(r1);
var req = r1.Messages.SelectMany(m => m.Contents).OfType<ToolApprovalRequestContent>().Single();
history.Add(new(ChatRole.User, [req.CreateResponse(approved, approved ? null : "User declined")]));
var r2 = await client.GetResponseAsync(history, new() { Tools = [transfer] });
```

```text
r1: ToolApprovalRequest id=ficc_t1 call=FunctionCall Transfer({"to":"ACC-42","amount":250}) id=t1   tool runs=0
approved, model saw: user | FunctionCall Transfer(...) id=t1 | FunctionResult "Transferred 250 to ACC-42."
declined, model saw: user | FunctionCall Transfer(...) id=t1 | FunctionResult
  "Tool call invocation was rejected by the approver and must not be retried. User declined"
```

O modelo nunca vê os conteúdos de aprovação, só a chamada e seu resultado.

### Custo em tokens das definições

"Say hello in one word." com 0, 1, 5 e 20 ferramentas (dois parâmetros e uma
linha de descrição cada) deu `Usage.InputTokenCount` 14, 172, 476 e 1638,
idêntico em 3 de 3: cerca de 80 tokens fixos mais 77 por ferramenta, pagos em
toda chamada do loop. Bate com o Learn: envie só as ferramentas necessárias.

## Trade-offs

- **ToolMode é um pedido, não uma garantia.** O OllamaSharp o descarta; para
  "sem ferramentas", não envie nenhuma.
- **AIFunction é a moeda comum.** `McpClientTool` (SDK C# do MCP) deriva de
  `AIFunction`, e ferramentas MCP entram na mesma lista `Tools` (lição de MCP);
  a doc da API do `ChatClientAgent` (Microsoft.Agents.AI 1.26.0) mostra que ele
  recebe um `IList<AITool>`, a mesma lista (lição de Agent Framework).
- **Aprovação é cooperativa.** `ApprovalRequiredAIFunction` só marca a função
  (a documentação da API diz que quem invoca deve obter a aprovação); chamar
  `InvokeAsync` nela diretamente executou a transferência sem aprovação nenhuma.

## Documentation Links

- [AI tool calling, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/calling-tools) (doc)
- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Invoke .NET functions using an AI model, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/use-function-calling) (doc)
- [Access data in AI functions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/how-to/access-data-in-functions) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
