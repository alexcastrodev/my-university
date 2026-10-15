---
version: 1.0
updatedAt: 2026-10-15
title: "ProblemDetails e Tratamento Global de Exceções"
summary: O documento problem+json da RFC 9457, AddProblemDetails com UseStatusCodePages e UseExceptionHandler, IExceptionHandler, CustomizeProblemDetails e como não vazar detalhes.
---
## Objective

Toda API falha, e a pergunta é se o cliente consegue interpretar a falha. O
ASP.NET Core entrega as peças para um formato de erro legível por máquina, o
documento `application/problem+json` da RFC 9457, mas elas ficam em três
lugares e cada uma é opcional: um serviço que monta o documento
(`AddProblemDetails`), middlewares que decidem quando pedi-lo
(`UseExceptionHandler`, `UseStatusCodePages`) e um gancho que mapeia os seus
tipos de exceção para respostas (`IExceptionHandler`). O conceito de REST
apresentou as duas primeiras linhas. Este trata de ligar tudo para que um `404`,
uma falha de validação e uma exceção não tratada tenham a mesma cara, e das
maneiras pelas quais a configuração faz menos do que você espera sem avisar.

## Use Cases

- Dar ao front end um único parser para todo erro que a API produz.
- Mapear exceções de domínio (`GameNotFoundException`) para `404` ou `409` numa
  classe só, em vez de um `try/catch` em cada handler.
- Acrescentar um campo de correlação ou o path da requisição em todo corpo de
  erro.
- Garantir que uma connection string dentro da mensagem de uma exceção nunca
  chegue ao cliente.
- Transformar o timeout de uma dependência em `503` com o header `Retry-After`.

## Deep Dive

### O documento e quem o escreve

A RFC 9457 (que torna a RFC 7807 obsoleta) define `type`, `title`, `status`,
`detail` e `instance`, e permite membros de extensão. `ProblemDetails` é esse
tipo no ASP.NET Core, e `IProblemDetailsService` é o serviço que o serializa.
`AddProblemDetails()` registra o serviço padrão e nada mais. Rodei o mesmo app
(SDK 10.0.100, Kestrel, `curl`) com configurações diferentes, e o corpo de
`GET /nope` (rota inexistente) mudou assim:

```text
só AddProblemDetails()              404, corpo vazio
+ UseStatusCodePages()              404, application/problem+json
                                    {"type":".../rfc9110#section-15.5.5","title":"Not Found","status":404,"traceId":"00-..."}
```

Ou seja, registrar o serviço não basta: para respostas que não são exceções,
nada pede que ele escreva até o `UseStatusCodePages()` entrar no pipeline. O
mesmo app confirmou a outra metade. Um endpoint que devolve `Results.NotFound()`
ou `Results.BadRequest()` produz corpo vazio até as status code pages estarem no
pipeline, enquanto `Results.Problem(...)` e `Results.ValidationProblem(...)` são
escritos diretamente e já trazem o `traceId` quando o serviço está registrado.
Repare que no .NET 10 o `type` aponta para seções da RFC 9110, uma por status
code.

Exceções são o segundo caminho. Só com status code pages, `GET /boom` (um
handler que lança exceção) ainda devolveu um `500` sem corpo, porque esse
middleware só olha respostas e a exceção passa direto por ele. Adicionar
`UseExceptionHandler()` sem argumentos, válido quando problem details está
registrado, produziu:

```csharp
builder.Services.AddProblemDetails();
var app = builder.Build();
app.UseExceptionHandler();   // exceção -> 500 problem+json, sem stack, sem mensagem
app.UseStatusCodePages();    // 4xx/5xx vazio -> problem+json
```

```text
GET /boom -> 500 application/problem+json
{"type":".../rfc9110#section-15.6.1","title":"An error occurred while processing your request.","status":500,"traceId":"..."}
```

Sem esse fallback, `UseExceptionHandler()` sem path e sem `AddProblemDetails`
lança exceção na inicialização, segundo a documentação.

### A negociação de conteúdo pode pular você em silêncio

O writer padrão só responde quando o header `Accept` permite JSON. Na minha
execução, `Accept: application/problem+json` e `*/*` receberam o documento,
enquanto `Accept: text/html` e `application/xml` em `/boom` receberam um `500`
com corpo vazio, e um `404` com `text/html` recebeu texto puro
(`Status Code: 404; Not Found`) das status code pages. Um navegador abrindo a URL
da API é o caso comum, então teste os erros com os headers que seus clientes
reais enviam e adicione um fallback se quiser um único corpo para todos.

### `IExceptionHandler`: um lugar para as exceções conhecidas

Registre handlers com `AddExceptionHandler<T>()`. Eles são singletons, rodam na
ordem de registro, e cada um devolve `true` para dizer "tratei, pare" ou `false`
para passar a exceção adiante. Só são chamados se `UseExceptionHandler` estiver
no pipeline. O handler deve escrever a resposta inteira; pedir ao
`IProblemDetailsService` que faça isso mantém o formato consistente:

```csharp
class DomainExceptionHandler(IProblemDetailsService pds) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        (int status, string title) = ex switch
        {
            ArgumentException      => (400, "Invalid request"),
            GameNotFoundException  => (404, "Game not found"),
            _                      => (0, "")
        };
        if (status == 0) return false;               // não é meu, próximo handler
        ctx.Response.StatusCode = status;
        return await pds.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx, Exception = ex,
            ProblemDetails = { Status = status, Title = title, Detail = ex.Message }
        });
    }
}
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
```

Resultados observados, com um segundo handler para `TimeoutException`
registrado depois dele:

```text
GET /arg     -> 400 {"title":"Invalid request","detail":"name is required",...}
GET /nf      -> 404 {"title":"Game not found","detail":"Game 42 not found",...}
GET /timeout -> 503 Retry-After: 5  {"title":"Service temporarily unavailable",...}
GET /boom    -> 500 {"title":"An error occurred while processing your request.",...}   (ninguém assumiu)
```

Um handler que devolve `true` sem escrever nada deixa a resposta vazia: na minha
execução, `GET /silent` voltou `500` sem corpo. Uma resposta que já começou
também não pode ser substituída: um handler que escreveu `partial...`, deu
flush e depois lançou exceção terminou em `200` com esse texto, e o log disse
`The response has already started, the error handler will not be executed`.

### `CustomizeProblemDetails` e `instance`

`AddProblemDetails(o => o.CustomizeProblemDetails = ctx => ...)` roda para todo
documento que o serviço escreve, seja qual for a origem: exceção, status code
page, `Results.Problem`, até o 400 do `AddValidation`. Isso o torna o lugar para
campos que pertencem a todos os erros:

```csharp
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Instance ??= ctx.HttpContext.Request.Path;
    ctx.ProblemDetails.Extensions["service"] = "games-api";
});
```

Depois disso, o `400` de um DTO inválido, o `404` de `/nf` e o `500` de `/boom`
traziam `"instance":"/..."` e `"service":"games-api"`. O contexto também expõe
`ctx.Exception` quando existe uma.

### Não vazar detalhes

São dois vazamentos distintos. O primeiro é o corpo: `ex.Message` pode conter
uma connection string, um pedaço de SQL ou um caminho de arquivo. Na execução,
`/boom` lançou `secret: Server=db;Password=hunter2` e o cliente viu só o título
genérico, porque o exception handler padrão não escreve `detail`. O vazamento
aparece quando *você* copia `ex.Message` para `Detail`, como o handler de
`ArgumentException` acima faz de propósito: aquela mensagem foi escrita para
quem chama. O handler de timeout omitiu `Detail` exatamente por isso. Devolva
mensagens apenas de tipos de exceção que são seus e que foram escritos para
clientes.

O segundo é a Developer Exception Page, que mostra stack traces, headers e
cookies e precisa ficar restrita a `Development`. O `WebApplication` a habilita
sozinho nesse ambiente, então o que protege a produção é o `UseExceptionHandler`.

Uma mudança menos visível do .NET 10: o middleware do exception handler não
escreve mais diagnósticos (a linha `fail:` no log) para exceções que um
`IExceptionHandler` tratou. Meu log mostrou só o `/boom` não tratado; `/arg`,
`/nf` e `/timeout` ficaram em silêncio. Configurar
`SuppressDiagnosticsCallback = _ => false` em `ExceptionHandlerOptions` trouxe
todos de volta. O silêncio é certo para exceções de domínio esperadas e errado
para um timeout sobre o qual você quer alerta, então faça o log dentro do
handler quando importar.

## Trade-offs

- **Um handler global esconde o fluxo de controle.** Exceção virando `404`
  significa que um `throw` distante decide o status code. Lançar exceção para
  resultados esperados é mais lento que devolver um resultado, então mantenha
  `Results.NotFound()` para o caminho comum e o handler para o resto.
  ```csharp
  return game is null ? TypedResults.NotFound() : TypedResults.Ok(game);   // sem exceção
  ```
- **Um formato para todo erro exige todos os caminhos ligados.** Status code
  pages, exception handler e validação têm cada um a sua chave; esqueça uma e
  aquele erro vem vazio ou com outro formato. Adicione um teste que provoque um
  `404`, um `400` e um throw e verifique `application/problem+json`.
- **`Detail` é um contrato.** Colocar `ex.Message` nele amarra os clientes ao
  texto das suas exceções e arrisca vazamento. Um `type` estável mais um
  `title` curto é no que o cliente deve se basear.
- **A ordem dos handlers importa.** O primeiro que devolve `true` vence, então
  um handler amplo registrado cedo esconde os específicos.
- **A negociação de conteúdo é uma armadilha.** Uma requisição com
  `Accept: text/html` não recebe o documento JSON. Se navegadores acessam a API,
  decida o que eles devem ver.

## Documentation Links

- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [Handle errors in ASP.NET Core, IExceptionHandler, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling) (doc)
- [IExceptionHandler interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.diagnostics.iexceptionhandler) (doc)
- [IProblemDetailsService interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.iproblemdetailsservice) (doc)
- [Problem Details for HTTP APIs, RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (doc)
