---
version: 1.0
updatedAt: 2026-10-15
title: "Binding de Parâmetros e Endpoint Filters"
summary: A ordem em que o framework decide de onde vem cada parâmetro, códigos de falha, [AsParameters], TryParse e BindAsync customizados, formulários com antiforgery e AddEndpointFilter.
---
## Objective

Um handler de minimal API é um delegate comum, e o framework monta a cola que
preenche cada parâmetro a partir da requisição. Essa cola tem uma precedência
fixa, um conjunto fixo de códigos de falha e três pontos de extensão: o seu
próprio `TryParse`, o seu próprio `BindAsync` e os endpoint filters que embrulham
o handler. O conceito de roteamento mostrou os casos do dia a dia. Este trata
das bordas: o que acontece quando um valor não converte, quando um tipo precisa
ler dois lugares ao mesmo tempo, quando um formulário exige antiforgery e quando
uma regra deve rodar antes do handler para um endpoint ou para um grupo inteiro.

## Use Cases

- Aceitar um valor de domínio na URL (`/map?p=12.3,10.1`, um `Money`, um
  `OrderId`) sem fazer parse de string dentro de cada handler.
- Reduzir um handler de seis parâmetros a um único tipo `[AsParameters]`.
- Montar um valor a partir de vários lugares, como um tenant lido de um header
  com fallback na query string.
- Tratar o post de um formulário HTML, com ou sem arquivo, de forma segura.
- Aplicar uma regra (normalizar, rejeitar, logar) em volta de muitos handlers
  sem mexer neles.

## Deep Dive

### A ordem que o framework tenta

Segundo a documentação, a origem de um parâmetro é decidida nesta ordem: um
atributo `[From*]` explícito; depois os tipos especiais (`HttpContext`,
`HttpRequest`, `CancellationToken`, `ClaimsPrincipal`, `IFormFile`, `Stream`...);
depois um tipo com `BindAsync` estático; depois `string` ou um tipo com
`TryParse` estático (route se o nome está no template, senão query string); depois
um serviço registrado no container; e só então o body JSON. Os dois últimos são
os que mais importam: a checagem de serviço vem antes do body, e o body é o
fallback para tudo que sobrou, o que explica a surpresa mais abaixo.

Rodei tudo no SDK 10.0.100 (file-based apps, `curl` contra o Kestrel). Os
códigos de falha foram:

```text
GET  /items/abc?p=2        ([FromRoute] int id)         -> 400
GET  /items/7              (int obrigatório ausente)     -> 400
GET  /map?p=12.3           (TryParse devolve false)      -> 400
GET  /who                  (BindAsync devolve null)      -> 400
GET  /who  X-Caller: boom  (BindAsync lança exceção)     -> 500
POST /post-body  text/plain                              -> 415
POST /post-body  {bad                                    -> 400
POST /post-unreg (serviço nunca registrado, sem body)    -> 400
POST /post-unreg {} (mesmo caso, body "{}")              -> 200 "handler ran"
```

As duas últimas linhas são a armadilha. Um serviço que você esqueceu de
registrar não é reportado como serviço ausente: o parâmetro cai para o body. Sem
body você recebe um `400` confuso. Com um body JSON, mesmo `{}`, o framework cria
uma instância vazia e o handler roda com um objeto inútil. Registre o serviço e
marque o parâmetro com `[FromServices]`: com o atributo, a mesma requisição
falhou com `No service for type 'Svc' has been registered` (um `500`) em vez de
ligar um body vazio.

### Uma assinatura ruim derruba o app inteiro

O conceito de roteamento menciona que um tipo complexo num `GET` falha com
`Body was inferred but the method does not allow inferred body parameters`. Dois
detalhes de quando rodei. `GET`, `HEAD`, `OPTIONS` e `DELETE` nunca inferem body,
mas `[FromBody]` neles é permitido. E a falha não é local: os endpoints são
construídos juntos na primeira requisição, então com um handler ruim entre três,
`/healthy` e até um `/nope` sem rota responderam `500`:

```csharp
app.MapGet("/healthy", () => "I am fine");
app.MapGet("/bad", (Filter f) => f);               // body inferido num GET
```

```text
GET /healthy -> 500    GET /nope -> 500     (log: InvalidOperationException, Body was inferred ...)
```

O app sobe sem reclamar em `Production`, então um smoke test que chame qualquer
endpoint uma vez, por exemplo com `WebApplicationFactory`, pega isso no CI.

### Origens explícitas e `[AsParameters]`

Vale escrever atributos onde um refactor poderia mudar a origem em silêncio. Um
header pode ligar direto a um número ou a um array, e chaves repetidas na query
ligam a arrays:

```csharp
app.MapGet("/arr", (int[] ids, string[] tags, [FromHeader(Name = "X-Nums")] int[] nums) => ...);
// GET /arr?ids=1&ids=2&tags=a&tags=b  X-Nums: 3, 4   -> ids=[1,2] tags=[a,b] nums=[3,4]
// GET /arr?ids=1&ids=x                               -> 400
// GET /arr                                           -> 200, os três vazios
```

Repare na última linha: um array ausente vem vazio, não é erro, enquanto um
`int` ausente é `400`. `[AsParameters]` expande um tipo nos parâmetros do seu
construtor, cada um ligado pelas regras normais, inclusive serviços e o
cancellation token:

```csharp
app.MapGet("/search/{category}", ([AsParameters] SearchRequest r) => r.ToString());

record SearchRequest([FromRoute] string Category, [FromQuery] int Page,
    [FromHeader(Name = "X-Tenant")] string Tenant, Clock Clock, CancellationToken Ct);
// GET /search/books?page=3  X-Tenant: acme -> Category = books, Page = 3, Tenant = acme
// GET /search/books                        -> 400
```

É uma expansão plana, não um model binding recursivo: tipos complexos
aninhados não são percorridos. A documentação observa que um struct pode ser mais
barato que um record aqui.

### Binding customizado: `TryParse`, `BindAsync`, `IBindableFromHttpContext`

Para um valor que vem de uma única string (route, query ou header), adicione um
`TryParse` estático. A forma com dois argumentos recebe um `IFormatProvider`, que
na minha execução foi a cultura invariante, então o parse não depende do locale
do servidor:

```csharp
readonly record struct Point(double X, double Y)
{
    public static bool TryParse(string? s, IFormatProvider? fp, out Point r) { /* split, double.TryParse(..., InvariantCulture) */ }
}
app.MapGet("/map", (Point p) => FormattableString.Invariant($"Point: {p.X}, {p.Y}"));
// GET /map?p=12.3,10.1 -> Point: 12.3, 10.1      GET /map -> 400     GET /map-opt?p=bad -> 400
```

Quando o valor precisa da requisição inteira, implemente `BindAsync(HttpContext)`
no tipo, ou `IBindableFromHttpContext<T>` (static abstract, C# 11), que também
recebe o `ParameterInfo`. Devolver `null` vira `400`, mas lançar exceção vira
`500`, então valide e devolva `null` em vez de lançar. Qualquer que seja a
escolha, o resultado de um binder customizado é checado *antes* do handler, e o
handler pode confiar nele.

### Formulários e antiforgery

`[FromForm]` liga dados `application/x-www-form-urlencoded` e multipart, e a
documentação diz que os parâmetros ligados com `[FromForm]` incluem um token
antiforgery validado no processamento. Com `AddAntiforgery()` e
`UseAntiforgery()` configurados, um post sem token foi rejeitado:

```text
POST /form  name=ana&age=30                           -> 400   (sem token)
POST /form  idem, cookie + __RequestVerificationToken -> 200   name=ana age=30
POST /form  age=abc (com token)                       -> 400
POST /form  Content-Type: application/json            -> 415
```

O token vem de `IAntiforgery.GetAndStoreTokens(context)` quando você renderiza a
página. `.DisableAntiforgery()` desliga a checagem por endpoint (certo para uma
API chamada por cliente que não é navegador e tem autenticação própria, errado
para um formulário autenticado por cookie). Novidade do .NET 10, segundo as
release notes: quando `[FromForm]` liga um tipo complexo, uma string vazia para
um value type anulável vira `null` em vez de falha de parse. Confirmei que
`DueDate=` resulta em `due=null` num record `TodoForm`, enquanto um parâmetro
solto `[FromForm] DateOnly? due` ainda respondeu `400` para o mesmo valor vazio,
então não generalize.

### Endpoint filters: embrulhando o handler

`AddEndpointFilter` recebe um `EndpointFilterInvocationContext` e o próximo
delegate. Os filtros rodam first-in, first-out na ida e na ordem inversa na
volta, e um filtro adicionado a um `MapGroup` é o mais externo: o trace de um
endpoint de grupo com dois filtros foi `group> f1> f2> handler`. Retornar sem
chamar `next` faz curto-circuito, e o que você retorna vira a resposta:

```csharp
app.MapPost("/args", (int id, Clock clock, CreateDto dto) => ...)
   .AddEndpointFilter(async (ctx, next) =>
   {
       var dto = ctx.GetArgument<CreateDto>(2);          // o índice conta serviços também
       return dto.Name.Contains('<') ? Results.Problem("bad chars", statusCode: 422)
                                     : await next(ctx);
   });
```

`ctx.Arguments` listou `Int32, Clock, CreateDto`: o índice segue a assinatura do
handler, serviços incluídos. Pedir o índice errado lançou `InvalidCastException`
e respondeu `500`, e é por isso que uma filter factory é mais segura.
`AddEndpointFilterFactory` roda uma vez por endpoint, quando ele é construído, e
recebe o `MethodInfo`, então pode localizar o parâmetro pelo tipo e devolver
`next` intacto quando o handler não tem esse parâmetro. Uma classe que implementa
`IEndpointFilter` (`AddEndpointFilter<T>()`) é construída por requisição, com
injeção no construtor, serviços scoped inclusive, e não precisa de registro.

Três comportamentos que valem conhecer. Um valor de route ou query que falha na
conversão (ou está ausente) ainda executa o filtro, com o valor default
(`arg0=0`), e o `400` é aplicado depois; um body JSON que não faz parse responde
`400` sem executar o filtro. Logo, um filtro nunca deve assumir que um argumento
é não nulo. Segundo, com `AddValidation()` um DTO que viola as annotations
retornou `400` e o meu filtro customizado não rodou, então seus filtros só veem
entrada válida. Isso vale apenas para tipos descobertos: o mesmo record
declarado `internal` retornou `200` com o body inválido, como o conceito de
validação avisa, então mantenha os DTOs de request `public`. Terceiro, um filtro
pode traduzir exceções: envolver `next` num `try` e devolver
`TypedResults.NotFound(...)` para uma `KeyNotFoundException` transformou um throw
em `404`. Depois de `next`, o valor é o retorno bruto do handler: um `String`
para uma lambda que devolve texto, `Ok<string>` para `TypedResults.Ok`.

## Trade-offs

- **O binding por convenção é compacto e silencioso.** Um registro esquecido ou
  um parâmetro movido muda a origem sem erro de compilação. Use `[FromServices]`
  e `[FromBody]` onde errar é caro e mantenha um teste por endpoint.
  ```csharp
  app.MapPost("/orders", ([FromBody] CreateOrder dto, [FromServices] IOrderService svc) => ...);
  ```
- **`TryParse` dá um `400` seco.** Não há mensagem nem nome de campo. Se o
  cliente precisa de um motivo, ligue uma `string` e faça o parse num filtro, e
  assim você controla o corpo do problema.
- **`BindAsync` esconde I/O dentro de um parâmetro.** É prático para tenant ou
  caller, mas uma assinatura que lê três headers através de um tipo é mais difícil
  de ver no documento OpenAPI do que três parâmetros explícitos.
- **`GetArgument` por índice é frágil.** Reordenar os parâmetros do handler quebra
  o filtro em runtime. Prefira uma factory que ache o parâmetro pelo tipo, ou um
  tipo `[AsParameters]` cuja posição nunca muda.
- **Filtros são por endpoint; middleware é global.** O filtro enxerga argumentos
  e resultados tipados, o middleware só enxerga o `HttpContext`. Use middleware
  para regras do host inteiro e filtros para regras que dependem das entradas de
  um handler.
- **Desligar o antiforgery é uma decisão de segurança, não uma conveniência.** É
  aceitável numa API autenticada por token e uma porta aberta num formulário HTML
  autenticado por cookie.

## Documentation Links

- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
- [Antiforgery with Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery) (doc)
- [What's new in ASP.NET Core 10, Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Route handlers in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
