---
version: 1.0
updatedAt: 2026-10-15
title: "Result Types versus Exceções"
summary: Quando lançar exceção, quando usar Try e quando retornar um Result, a partir do tipo de falha; um Result<T> mínimo com as armadilhas de quem escreve o próprio (default como sucesso), composição com Bind, custo medido, tradução para ProblemDetails no HTTP e como ficam OneOf e ErrorOr.
---
## Objective

O C# tem um único jeito embutido de reportar falha: lançar exceção. A BCL
acrescenta um segundo para falhas baratas e esperadas (`TryParse`,
`TryGetValue`). Muitas aplicações acrescentam um terceiro: um método que
retorna ou um valor ou um objeto de erro, geralmente chamado `Result<T>`. Este
conceito compara os três nos eixos que decidem a escolha (quais falhas são
esperadas, o que o chamador é obrigado a ver, custo, composição, diagnóstico),
monta um `Result<T>` pequeno com as armadilhas que um tipo feito à mão tem,
traduz o resultado para `ProblemDetails` no HTTP e mostra como ficam duas
bibliotecas populares (OneOf e ErrorOr). A mecânica de `throw` e `catch` está
em `exceptions-try-catch-filters-and-finally`, guard clauses em
`guard-clauses-throwing-and-rethrowing`, e o padrão `Try` em
`parsing-tryparse-and-the-try-pattern`.

## Use Cases

- Decidir como um serviço de aplicação informa "não encontrado", "entrada
  inválida" e "conflito" ao chamador.
- Traduzir falhas de domínio para status HTTP sem um handler global de
  exceções cheio de casos especiais.
- Encadear vários passos que podem falhar (validar, carregar, conferir,
  salvar) sem `if` aninhado.
- Revisar um pull request que adiciona um tipo `Result<T>` ou uma biblioteca
  para isso.

## Deep Dive

Saída do .NET 10 (SDK 10.0.100) em arm64. Bibliotecas: OneOf 3.0.271 e
ErrorOr 2.1.1, do NuGet.

### Três tipos de falha

A decisão começa pelo tipo de falha, não por preferência de estilo:

| Tipo | Exemplo | Mecanismo usual |
|---|---|---|
| Erro de uso (bug) | argumento nulo, quantidade negativa vinda do código | exceção (família `ArgumentException`) |
| Resultado esperado | produto não encontrado, estoque insuficiente, campo inválido | método `Try`, retorno anulável ou result type |
| Falha do ambiente | banco fora do ar, disco cheio, timeout | exceção |

Erro de uso deve falhar alto, com stack trace, e ser corrigido. Falha do
ambiente quase nunca pode ser tratada pelo chamador imediato, e a exceção leva
a falha até um lugar que pode (uma política de retry, um handler global). A
linha do meio é onde a escolha existe de verdade: a falha faz parte do
negócio, o chamador precisa decidir o que fazer, e ela acontece com
frequência.

As Framework Design Guidelines (uma reimpressão de 2008, marcada como
possivelmente desatualizada) dizem "DO NOT return error codes" e "DO report
execution failures by throwing exceptions", e na mesma página "DO NOT use
exceptions for the normal flow of control, if possible", recomendando os
padrões tester-doer e Try. Essas regras foram escritas para APIs de framework
reutilizáveis. Dentro de uma aplicação, a página atual de boas práticas também
sugere retornar `null` ou `default` nos casos de erro comuns. Um result type é
a versão mais rica desse conselho: um valor de retorno que também diz o
motivo.

### Um `Result<T>` mínimo

```csharp
enum ErrorKind { Validation, NotFound, Conflict }

sealed record Error(ErrorKind Kind, string Code, string Message)
{
    public static Error Validation(string code, string msg) => new(ErrorKind.Validation, code, msg);
    public static Error NotFound(string code, string msg) => new(ErrorKind.NotFound, code, msg);
    public static Error Conflict(string code, string msg) => new(ErrorKind.Conflict, code, msg);
}

readonly struct Result<T>
{
    static readonly Error Unset = new(ErrorKind.Validation, "result.default", "default(Result<T>) has no value");
    readonly T _value;
    readonly Error? _error;
    readonly bool _ok;                         // false em default(Result<T>)

    Result(T value) { _value = value; _ok = true; }
    Result(Error error) { _value = default!; _error = error; }

    public bool IsSuccess => _ok;
    public bool IsFailure => !_ok;
    public Error? Error => _ok ? null : _error ?? Unset;
    public T Value => _ok ? _value : throw new InvalidOperationException($"no value: {Error!.Code}");

    public static Result<T> Ok(T value) => new(value);
    public static Result<T> Fail(Error error) => new(error);
    public static implicit operator Result<T>(T value) => new(value);
    public static implicit operator Result<T>(Error error) => new(error);

    public Result<U> Bind<U>(Func<T, Result<U>> next) => _ok ? next(_value) : Error!;
    public Result<U> Map<U>(Func<T, U> f) => _ok ? f(_value) : Error!;
    public R Match<R>(Func<T, R> ok, Func<Error, R> fail) => _ok ? ok(_value) : fail(Error!);
}
```

Três decisões neste código são fáceis de errar:

- **`default` não pode ser sucesso.** A primeira versão desta struct calculava
  `IsSuccess => Error is null`. Aí `Result<int> d = default;` reportava
  `IsSuccess=True` com `Value` 0, um sucesso que ninguém produziu. Com a flag
  explícita `_ok`, `default` é falha: `IsSuccess=False`,
  `Error=result.default`, e `d.Value` lança
  `InvalidOperationException: no value: result.default`. (Uma `class` evita o
  `default`, mas aloca a cada sucesso.)
- **`Value` numa falha lança exceção.** Ler o valor sem conferir é bug, então
  é exceção, igual a `Nullable<T>.Value`.
- **Conversões implícitas deixam a chamada curta.** `return qty;` e
  `return Error.NotFound(...);` compilam para `Result<int>`, e um `?:` com um
  ramo de cada tipo é tipado pelo destino.

### Compondo passos

`Bind` roda o próximo passo só se o anterior deu certo, então a cadeia para na
primeira falha sem nenhum `if`:

```csharp
Result<int> ValidateQty(int qty) => qty > 0 ? qty : Error.Validation("qty.invalid", "quantity must be positive");
Result<int> FindStock(string sku) => catalog.TryGetValue(sku, out var s) ? s : Error.NotFound("product.missing", $"no product {sku}");

Result<int> PlaceOrder(string sku, int qty) =>
    ValidateQty(qty)
        .Bind(q => FindStock(sku)
        .Bind(stock => stock >= q ? Result<int>.Ok(stock - q)
                                  : Error.Conflict("stock.short", $"only {stock} {sku} left")));

// catalog: apple = 5, pear = 0
PlaceOrder("apple", 2)   // ok, 3 left
PlaceOrder("apple", 0)   // Validation qty.invalid: quantity must be positive
PlaceOrder("kiwi", 1)    // NotFound product.missing: no product kiwi
PlaceOrder("pear", 1)    // Conflict stock.short: only 0 pear left
```

A versão com exceções é mais curta de escrever: três `throw` e nenhum tipo
embrulhando. O que ela perde é a assinatura. `int PlaceOrderEx(string, int)`
não diz que pode falhar de três jeitos de negócio; o chamador descobre pela
documentação ou em produção. Com `Result<int>`, o compilador obriga o chamador
a desembrulhar. Ele não obriga o chamador a olhar: um `Result` descartado
compila sem aviso, enquanto uma exceção ignorada ainda interrompe o fluxo.

Código assíncrono adiciona uma camada: o passo retorna `Task<Result<T>>`, e
cada `await` precisa ser seguido da checagem de sucesso, então os helpers se
multiplicam (`BindAsync`, `MapAsync`). Costuma ser aí que o time parte para
uma biblioteca.

### Quanto custa

Build Release, 100.000 chamadas que falham todas com "não encontrado":

```text
exceptions (throw + catch KeyNotFoundException)   221 ms    248 bytes per failure
Result<int>                                          6 ms    288 bytes per failure
```

O caminho com exceção custou cerca de 2,2 microssegundos por falha, entre 35
e 100 vezes mais lento que o caminho do `Result` nas execuções (o laço do
`Result` mediu de 2 a 6 ms). A diferença é de tempo, não de memória: o
caminho do `Result` alocou um pouco mais (o objeto `Error`, a mensagem
interpolada e as closures das lambdas). A página das guidelines dá o limite a
partir do qual isso pesa: "Throw rates above 100 per second are likely to
noticeably impact the performance of most applications." Um endpoint de login
que recusa senha errada ou uma importação que pula linhas inválidas chega lá
fácil.

### Results na fronteira HTTP

Um result type compensa quando a camada de API o traduz num lugar só. O tipo
de erro vira o status code, e o corpo é um `ProblemDetails`:

```csharp
static IResult ToHttp<T>(Result<T> result) => result.Match(
    value => Results.Ok(value),
    error => Results.Problem(
        statusCode: error.Kind switch
        {
            ErrorKind.Validation => StatusCodes.Status400BadRequest,
            ErrorKind.NotFound => StatusCodes.Status404NotFound,
            ErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status500InternalServerError,
        },
        title: error.Code,
        detail: error.Message));

app.MapPost("/orders/{sku}/{qty:int}", (string sku, int qty) => ToHttp(Reserve(sku, qty)));
```

```text
POST /orders/apple/2  -> 200  3
POST /orders/kiwi/1   -> 404  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"product.missing","status":404,"detail":"no product kiwi"}
POST /orders/apple/9  -> 409  {"type":"...#section-15.5.10","title":"stock.short","status":409,"detail":"only 5 left"}
POST /orders/apple/0  -> 400  {"type":"...#section-15.5.1","title":"qty.invalid","status":400,"detail":"quantity must be positive"}
```

A alternativa é lançar exceções de domínio e convertê-las num
`IExceptionHandler` (veja `problem-details-and-global-exception-handling`). Os
dois funcionam; o handler global deixa os casos de uso livres do tipo
embrulhado, e o result deixa as falhas esperadas fora do caminho de exceção e
visíveis na assinatura do caso de uso (`clean-architecture-in-four-projects`
usa um result por caso de uso com um enum de status, uma variante mais leve da
mesma ideia).

O switch acima precisa do braço `_`. O C# ainda não tem tipo união fechado:
até um record abstrato com construtor privado e dois records selados aninhados
dá CS8509 ("The switch expression does not handle all possible values of its
input type") quando os dois subtipos são tratados, porque o compilador não
considera a hierarquia fechada.

### OneOf e ErrorOr

Dois pacotes do NuGet cobrem quase tudo que os times escrevem à mão.

OneOf modela "um destes tipos". A falha é um tipo, e o `Match` recebe uma
lambda por caso:

```csharp
OneOf<int, NotFound> Find(string sku) => stock.TryGetValue(sku, out var s) ? s : new NotFound();

Find("apple").Match(s => $"{s} in stock", _ => "not found")   // 5 in stock
Find("kiwi").Match(s => $"{s} in stock", _ => "not found")    // not found
```

ErrorOr modela "um valor ou uma lista de erros", com tipos de erro
predefinidos e `Then` para encadear:

```csharp
ErrorOr<int> Find(string sku) => stock.TryGetValue(sku, out var s) ? s : Error.NotFound("product.missing", $"no product {sku}");
ErrorOr<int> Reserve(string sku, int qty) =>
    Find(sku).Then(s => s >= qty ? (ErrorOr<int>)(s - qty) : Error.Conflict("stock.short", $"only {s} left"));

Reserve("apple", 2)   // 3 left, IsError=False
Reserve("apple", 9)   // Conflict stock.short: only 5 left, IsError=True
Reserve("kiwi", 1)    // NotFound product.missing: no product kiwi, IsError=True
```

## Trade-offs

- **Visibilidade versus cerimônia.** Um retorno `Result<T>` documenta as
  falhas esperadas na assinatura e obriga o chamador a desembrulhar. Toda
  camada passa a carregar o tipo, inclusive caminhos que na prática não
  falham.
- **Exceção guarda o stack trace; result guarda o fluxo.** Um record `Error`
  não tem stack trace nem inner exception, então result é o veículo errado
  para uma falha inesperada que alguém vai ter que depurar. Nunca capture
  `Exception` só para transformar em `Result`.
- **Velocidade só importa com taxa alta de falha.** 2 microssegundos por
  `throw` é irrelevante para um "não encontrado" raro e real para um endpoint
  de validação sob carga. Meça a taxa de falha antes de reescrever por
  desempenho.
- **Feito à mão versus biblioteca.** Um `Result<T>` de 40 linhas é fácil de
  manter, mas fácil de errar sutilmente (`default` como sucesso, sem helpers
  assíncronos). Uma biblioteca traz combinadores testados e uma dependência
  que toda camada do projeto passa a referenciar.
- **Um result pode ser ignorado em silêncio.** Chamar `Save(order);` e
  descartar o `Result` retornado compila. Uma exceção não é ignorada por
  acidente. Code review, ou um analyzer que o time adicionar, precisa cobrir
  isso.
- **Misturar estilos é o risco real.** Uma base em que alguns casos de uso
  lançam `NotFoundException` e outros retornam `Error.NotFound` precisa de
  duas traduções na fronteira. Escolha uma convenção por camada e deixe
  escrito.

## Documentation Links

- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [Exception throwing, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exception-throwing) (doc)
- [Exceptions and performance, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions-and-performance) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [Results.Problem method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.results.problem) (doc)
- [OneOf on GitHub](https://github.com/mcintyre321/OneOf) (doc)
- [ErrorOr on GitHub](https://github.com/amantinband/error-or) (doc)
