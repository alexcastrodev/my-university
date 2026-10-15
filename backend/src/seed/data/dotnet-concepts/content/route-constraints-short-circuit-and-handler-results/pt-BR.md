---
version: 1.0
updatedAt: 2026-10-15
title: "Route Constraints, Short-Circuit e Resultados de Handlers"
summary: Constraints que decidem se a rota casa (404 versus 400), as armadilhas do regex, constraints customizadas, ShortCircuit e MapShortCircuit, e no que o retorno de um handler se transforma.
---
## Objective

Um endpoint de minimal API é decidido em três lugares antes de a sua lógica
importar: o template da rota (com as constraints), se o roteamento deixa o resto
do pipeline rodar, e no que o valor de retorno do handler se transforma. Cada um
tem uma falha silenciosa: uma constraint transforma entrada ruim em `404`, um
short-circuit esconde o endpoint dos seus middlewares, e um `null` retornado vira
`500`. Este conceito mostra cada caso com a resposta que você realmente recebe, e
evita o terreno que os conceitos anteriores já cobrem: falhas básicas de binding
e `TypedResults` como contrato.

## Use Cases

- Distinguir `/games/42` de `/games/zelda` sob o mesmo prefixo sem um `if`.
- Responder health checks, `robots.txt` e `favicon.ico` sem passar por log, rate
  limiting ou autenticação.
- Escolher o tipo de retorno de um handler para que o status, o content type e o
  documento OpenAPI concordem.
- Depurar um endpoint que devolve `404` para uma entrada que você esperava que
  fosse `400`.

## Deep Dive

### Constraints decidem se a rota casa

Uma constraint é a parte depois dos dois pontos em `{id:int}`. Se ela falha, a
rota não casa, então a requisição segue para as outras rotas e, se nenhuma casar,
termina em `404`. O app abaixo (SDK 10.0.100, um projeto comum de `dotnet new
web`) mapeou vários formatos e foi chamado com `curl`:

```csharp
app.MapGet("/i/{id:int}", (int id) => $"int {id}");
app.MapGet("/min/{n:int:min(1)}", (int n) => $"min {n}");
app.MapGet("/opt/{id:int?}", (int? id) => $"opt {(id?.ToString() ?? "none")}");
app.MapGet("/u/{id}", (int id) => $"u {id}");            // sem constraint
app.MapGet("/games/{id:int}", (int id) => $"by id {id}");
app.MapGet("/games/{slug}", (string slug) => $"by slug {slug}");
```

```text
/i/5 -> 200 "int 5"        /i/abc -> 404       /i/1.5 -> 404
/min/3 -> 200              /min/0 -> 404
/opt -> 200 "opt none"     /opt/7 -> 200       /opt/x -> 404
/u/5 -> 200                /u/abc -> 400       (falha no binding, depois do match)
/games/12 -> "by id 12"    /games/zelda -> "by slug zelda"
```

Compare `/i/abc` com `/u/abc`. Com a constraint a resposta é `404`, porque nenhuma
rota casou. Sem ela a rota casa e a falha acontece depois, no binding de
parâmetros, então é `400`. A documentação de roteamento declara a intenção:
constraints servem para desambiguar rotas parecidas, e não devem ser usadas para
validar entrada, já que entrada inválida produziria `404` em vez de `400` com uma
mensagem. As duas últimas linhas mostram o uso legítimo: os dois templates casam
com `/games/12`, e o que tem constraint vence porque um parâmetro com constraint é
mais específico que um sem. Se dois casamentos empatam, o framework lança uma
exceção de match ambíguo em vez de escolher.

Mais formatos da mesma rodada: `alpha` aceitou `abc` e rejeitou `ab1`;
`length(3)` aceitou `abc` e rejeitou `abcd`; `range(1,5)` aceitou `5` e rejeitou
`6`; `bool` aceitou `true` e rejeitou `yes`; `datetime` aceitou `2026-10-15`;
`guid` rejeitou `zzz`. As constraints numéricas e de data usam a cultura
invariante, segundo a documentação.

Um catch-all `{**rest}` capturou `a/b/c` como `rest [a/b/c]`. Chamado como `/file`
sem nada depois, a rota ainda casou (catch-alls podem casar a string vazia), e um
`string rest` não anulável falhou no binding com `400`. Declare o parâmetro como
`string?` quando o caso vazio for legítimo.

### Regex em constraints e suas regras de escape

A constraint de regex é onde os templates ficam difíceis de ler. A documentação
diz que os delimitadores de rota `{`, `}`, `[` e `]` devem ser dobrados dentro da
expressão, e que a barra invertida precisa do escape usual do C#. Observado com o
SDK 10.0.100:

```text
{c:regex(^[a-z]{{2}}$)}          /b/ab -> 200     /b/AB -> 200
{c:regex(^\\d{{3}}$)}            /c/123 -> 200
{c:regex(^[a-z]{{2}}\\d{{3}}$)}  /e/ab123 -> 200  /e/AB123 -> 200  /e/ab12 -> 404
{c:regex(^[[a-z]]{{2}}$)}        /a/ab -> 404     (a forma com colchetes dobrados da doc não casou)
{c:regex(^[[0-9]]{{3}}$)}        /d/123 -> 404
```

Três lições. Chaves dobradas e `\\d` funcionaram. Os colchetes dobrados que a
documentação mostra não casaram nesta rodada, enquanto a classe com colchete
simples casou, então teste qualquer padrão com classe de caracteres antes de
confiar nele. E o casamento ignora maiúsculas: a documentação diz que o framework
adiciona `RegexOptions.IgnoreCase`, e por isso `AB123` passou por uma classe
`[a-z]`. Ancore com `^` e `$`, ou a expressão casa qualquer substring.

### Constraints customizadas

Uma constraint é uma classe que implementa `IRouteConstraint`. Registre-a por
nome; no .NET 10 o build avisou que o `ConstraintMap` não é amigável a trimming e
sugeriu `SetParameterPolicy`:

```csharp
builder.Services.Configure<RouteOptions>(o => o.SetParameterPolicy<EvenIntConstraint>("evenint"));
app.MapGet("/even/{n:evenint}", (int n) => $"even {n}");   // /even/4 -> 200, /even/3 -> 404
```

A documentação chama constraints customizadas de raramente necessárias e sugere
checar o valor no handler, onde dá para devolver um erro descritivo, antes de
escrever uma.

### Rotas com short-circuit

Normalmente o roteamento seleciona um endpoint e deixa os middlewares seguintes
rodarem antes de o endpoint executar. O `ShortCircuit()` faz o roteamento rodar o
endpoint imediatamente e encerrar a requisição. Um logger de requisições
registrado primeiro anotou todos os caminhos, exceto os que fizeram short-circuit:

```csharp
app.MapGet("/health", () => "ok").ShortCircuit();
app.MapGet("/health204", () => "ignored").ShortCircuit(204);
app.MapShortCircuit(404, "robots.txt", "favicon.ico");
```

```text
/health -> 200 "ok"     /health204 -> 204 (sem corpo)
/robots.txt -> 404      /favicon.ico -> 404       /i/5 -> 200
log do middleware: mw /i/5     (nada para /health, /health204, /robots.txt, /favicon.ico)
```

Com um status, o `ShortCircuit(204)` respondeu `204` sem corpo, e não o texto do
handler. O `MapShortCircuit` recebe prefixos de URL e devolve um convention
builder, então dá para acrescentar um filtro de host. A documentação lista dois
limites: ele não afeta middlewares colocados antes do `UseRouting`, e combiná-lo
com metadata `[Authorize]` ou `[RequireCors]` falha. Isso foi reproduzido: um
endpoint com `.RequireAuthorization().ShortCircuit()` respondeu `500` com
`InvalidOperationException: Endpoint HTTP: GET /sc-auth contains authorization
metadata, but this endpoint is marked with short circuit`. Use só em endpoints que
não precisam de middleware transversal.

### No que o retorno de um handler se transforma

O framework escolhe a resposta pelo formato, em tempo de execução, do valor:

```text
return "plain"                          -> 200 text/plain
return new { a = 1, b = "x" }           -> 200 application/json   {"a":1,"b":"x"}
return 42                               -> 200 application/json   42
return Results.Created("/x/1", obj)     -> 201 application/json
return TypedResults.Accepted("/jobs/9") -> 202, sem corpo (de um handler async)
handler define Response.StatusCode = 418 -> 418, sem corpo
return (string?)null                    -> 500  ArgumentNullException (parâmetro 'text')
```

Repare que `42` é serializado como JSON enquanto `"plain"` é texto. Uma string
`null` é um bug, não um corpo vazio, então retorne `TypedResults.NoContent()` ou
`NotFound()` quando não houver o que enviar. Tipos anônimos e JSON por reflexão
funcionam num projeto comum; um file-based app (`dotnet run file.cs`) é diferente:
o mesmo tipo anônimo falhou lá com `NotSupportedException` (sem metadata JSON para
o tipo anônimo).

Retornar `IResult` (como o `Results.Created`) não diz nada ao framework sobre as
respostas possíveis. Retornar `Results<Ok<string>, NotFound, BadRequest<string>>`
diz: o compilador restringe os ramos a esses três tipos, e o metadata lido pelo
OpenAPI bateu. Listar o `IProducesResponseTypeMetadata` dos endpoints imprimiu
`/r/typed/{id:int} => 200,404,400` para a união e nada para o endpoint com
`IResult`. O conceito anterior de REST mostra o padrão num grupo de CRUD; o ponto
aqui é que o tipo de retorno é um dado que o framework lê, e um `IResult` o
esconde.

## Trade-offs

- **Uma constraint esconde o motivo.** Um `404` para `/orders/abc` não dá ao
  cliente nada para corrigir; faça o binding como `int` simples e devolva `400`
  com mensagem quando o chamador precisar saber.
  ```csharp
  app.MapGet("/orders/{id}", (int id) => ...);      // 400 em /orders/abc, com ProblemDetails se configurado
  ```
- **Regex num template é difícil de ler e de testar.** Prefira uma constraint
  customizada com nome ou validação no handler para qualquer coisa além de um
  formato simples.
- **Short-circuit economiza trabalho e pula garantias.** Sem log, sem headers de
  segurança, sem autenticação; só para endpoints em que isso é aceitável.
- **`IResult` é flexível, `Results<...>` é verificável.** A união custa uma
  assinatura longa e, em troca, os status passam a fazer parte do contrato
  compilado e documentado.
- **A inferência do retorno é cômoda e implícita.** `return 42` é JSON e
  `return "42"` é texto; escreva `TypedResults.Ok(...)` quando o content type
  importar para o cliente.

## Documentation Links

- [Routing in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) (doc)
- [Create responses in Minimal API applications, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Route handler delegates in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Handle errors in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/handle-errors) (doc)
