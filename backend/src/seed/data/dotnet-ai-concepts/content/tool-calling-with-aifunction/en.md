---
version: 1.0
updatedAt: 2026-10-30
---
## Objective

Tool calling lets a model ask the application to run code: the request carries
tool descriptions, the model answers with a function call instead of text, the
app runs it and sends the result back. In Microsoft.Extensions.AI the unit is
`AIFunction`: `AIFunctionFactory.Create` turns a .NET method into one,
`ChatOptions.Tools` sends it, and `FunctionInvokingChatClient`
(`UseFunctionInvocation()`) runs the loop. This lesson prints the generated
schema, writes the loop by hand, and measures the automatic loop's limits,
errors, approvals and token cost with `qwen3:4b-instruct` on Ollama (3 runs
each) and a scripted fake `IChatClient` for the deterministic mechanics.
Versions: `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama
0.40.12, .NET 10.

## Use Cases

- Answering from live data (stock, orders, weather) that the model cannot know.
- Letting a model act (open a ticket, send mail) behind validation and approval.
- Reusing one `AIFunction` list across chat clients, MCP servers and agents.
- Testing the loop with a scripted client: fixed calls, no model.

## Deep Dive

### From a method to an AIFunction

`AIFunctionFactory.Create` reads the method name, `[Description]` on the method
and its parameters, and the parameter types:

```csharp
[Description("Gets the forecast for a location.")]
public static string GetForecast([Description("Where")] Location location, DateOnly date,
    DateTime? notAfter, Unit unit, [Description("How many days, 1 to 7")] int days,
    int? maxResults, bool includeWind = false) => ...;
record Location(string City, string? Country);   enum Unit { Celsius, Fahrenheit }

AIFunction f = AIFunctionFactory.Create(WeatherTools.GetForecast);   // print f.JsonSchema
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

Only the parameter with a default is optional. A nullable type without one
stays required: invoking without `notAfter` threw `ArgumentException: The
arguments dictionary is missing a value for the required parameter 'notAfter'`.
"1 to 7" is prose; nothing enforces it. A lambda got the name `_Main_b_0_6` and
an empty description, so name lambdas: `Create(delegate, "GetTime", "...")`.

`AIFunctionFactoryOptions` sets `Name`, `Description` and `SerializerOptions`.
The default, `AIJsonUtilities.DefaultOptions`, is camelCase with
`JsonStringEnumConverter`. With a plain `JsonSerializerOptions` the record's
properties became `City`/`Country`, `unit` became `{"type":"integer"}`, and the
camelCase argument `{"city":"Lisbon"}` bound silently to `Location { City = ,
Country = }`, no error. Schema and binding must share the same options.

### What reaches Ollama, and ToolMode

A recording `HttpMessageHandler` under `OllamaApiClient` showed each tool in
the `/api/chat` body as `{"type":"function","function":{"name":...,
"description":...,"parameters":<schema>}}`, plus `"additionalProperties":false`.
`ChatOptions.ToolMode` is `Auto`, `RequireAny`, `None` or
`RequireSpecific("name")`. OllamaSharp 5.5.0 ignores it: all five produced the
same body, both tools included, no field for the mode. With `None`, "What is
the weather in Lisbon?" still called `GetWeather` in 3 of 3 runs; with
`RequireAny`, "Say hello" got plain text. `FunctionInvokingChatClient` passes
it through untouched. To withhold tools, leave them out of `Tools`.

### The loop by hand

The call arrives as `FunctionCallContent`; the result goes back as
`FunctionResultContent` with the same `CallId` in a `ChatRole.Tool` message:

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

Same list in 3 of 3 runs except the `CallId`: raw Ollama returned a
32-character id, OllamaSharp exposed a new 8-hex one of its own.

### UseFunctionInvocation

`new ChatClientBuilder(ollama).UseFunctionInvocation().Build()` runs that loop.
A counting layer below it saw 2 model calls per question; the `ChatResponse`
held the 3 new messages (call, result, answer) and `Usage` summed both calls
(in 170 + 231 = 401). "Compare the weather in Lisbon and Porto" gave two calls
in one turn, both results in one tool message, still 2 model calls (3 of 3).
Defaults: `MaximumIterationsPerRequest` 40, `MaximumConsecutiveErrorsPerRequest`
3, `AllowConcurrentInvocation`, `IncludeDetailedErrors` and
`TerminateOnUnknownCalls` false.

The Learn page says the client "supports parallel function calling
automatically": it accepts several calls per turn, but runs them one after the
other. A fake returning two calls to a 300 ms tool took about 600 ms (Porto
started when Lisbon ended); with `AllowConcurrentInvocation = true` both
started at 0 ms and it took about 300 ms.

### When the loop goes wrong (scripted fake)

With a fake that always answers with a call and `MaximumIterationsPerRequest =
3`, the fake was called 4 times (tools sent: 1, 1, 1, 0), the tool ran 3 times,
and nothing threw: after the limit the client asks once more without tools and
returns what comes back, here 7 messages ending in an unanswered
`FunctionCall GetWeather` with `FinishReason` null. Check for that.

A tool throwing `InvalidOperationException("Database password expired for
Lisbon")` gives the model:

```text
IncludeDetailedErrors=False: FunctionResult "Error: Function failed."
IncludeDetailedErrors=True:  FunctionResult "Error: Function failed. Exception: Database password expired for Lisbon"
```

The default hides internals from the model and so from the user; return your
own short message instead of enabling it. With a model that keeps calling the
failing tool, `MaximumConsecutiveErrorsPerRequest = 2` rethrew the tool's own
`InvalidOperationException` after 3 fake calls; `0` rethrew after the first.

```text
// unknown names and bad arguments, IncludeDetailedErrors = true
"DeleteEverything": "Error: Requested function "DeleteEverything" not found."   loop continues
TerminateOnUnknownCalls=true: loop stops, the FunctionCallContent is returned to the caller
days = "three": "Error: Function failed. Exception: Object of type 'System.String' cannot be converted to type 'System.Int32'."
days missing:   "Error: Function failed. Exception: The arguments dictionary is missing a value for the required parameter 'days'. (Parameter 'arguments')"
extra "country": ignored, tool ran      days = "2": converted, tool ran
```

qwen3:4b-instruct never sent a wrong type in 3 runs of several prompts. What
repeated, 3 of 3: "Weather forecast for Lisbon." produced
`GetForecastDays({"city":"Lisbon","days":5})`, a value nobody gave. Learn
warns that "models might hallucinate arguments"; no schema catches that, so
make such a parameter optional with a default, or have the tool ask.

### FunctionInvoker and validation in the tool

`FunctionInvoker` wraps every invocation; its `FunctionInvocationContext` has
`Function`, `Arguments`, `CallContent`, `Iteration`, `FunctionCallIndex` and
`FunctionCount` (logged below), enough for auditing and authorization:

```csharp
.UseFunctionInvocation(configure: f => f.FunctionInvoker = async (ctx, ct) =>
    ctx.Function.Name == "DeleteAccount" ? "Not allowed: the current user lacks the admin role."
        : await ctx.Function.InvokeAsync(ctx.Arguments, ct))
```

```text
ctx: GetWeather call 1/2 iteration 0 id=a; DeleteAccount call 2/2 iteration 0 id=b
tool: FunctionResult id=a "Lisbon: 18 C, light rain" + FunctionResult id=b "Not allowed: ..."
```

Arguments come from the model, so treat them like an HTTP body. `Transfer`
checks `to` against `^ACC-[0-9]{1,10}$` and `amount` against 0 to 1000 before
any side effect, and returns a sentence the model can use:

```text
fake, to="'; DROP TABLE x;--" -> "Rejected: 'to' must match ACC-<digits>."   side effects = 0
qwen3, "Transfer 5000 euros to account ACC-42." -> Transfer({"to":"ACC-42","amount":5000})
  -> "Rejected: amount must be between 0.01 and 1000 euros." -> "The transfer was rejected because ..."
```

The real model relayed the rejection in 3 of 3 runs. A side-effect tool also
needs idempotency: the `CallId` changes on every call, so deduplicating needs a
business key (an order id argument), not the call id.

### Approval: ApprovalRequiredAIFunction

In 10.11.0 the contents are `ToolApprovalRequestContent`/`...ResponseContent`
(no `FunctionApprovalRequestContent`). A wrapped function stops the loop:

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

The model never sees the approval contents, only the call and its result.

### Token cost of tool definitions

"Say hello in one word." with 0, 1, 5 and 20 tools (two parameters, one-line
description each) gave `Usage.InputTokenCount` 14, 172, 476 and 1638, identical
in 3 of 3 runs: about 80 tokens of fixed overhead plus about 77 per tool, paid
on every model call of the loop. This matches the Learn page: tool descriptions
count against the token limit, so send only the tools the conversation needs.

## Trade-offs

- **ToolMode is a request, not a guarantee.** OllamaSharp drops it; enforce
  "no tools" by not sending any.
- **AIFunction is the shared currency.** `McpClientTool` (MCP C# SDK) derives
  from `AIFunction`, so MCP tools join the same `Tools` list (MCP lesson); the
  API docs of `ChatClientAgent` (Microsoft.Agents.AI 1.26.0) show it taking an
  `IList<AITool>`, the same list (Agent Framework lesson).
- **Approval is cooperative.** `ApprovalRequiredAIFunction` only marks the
  function (the API docs say the invoker must obtain approval); calling
  `InvokeAsync` on it directly ran the transfer with no approval at all.

## Documentation Links

- [AI tool calling, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/calling-tools) (doc)
- [Use the IChatClient interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) (doc)
- [Invoke .NET functions using an AI model, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/use-function-calling) (doc)
- [Access data in AI functions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/how-to/access-data-in-functions) (doc)
- [Microsoft.Extensions.AI README, dotnet/extensions on GitHub](https://github.com/dotnet/extensions/blob/main/src/Libraries/Microsoft.Extensions.AI/README.md) (doc)
