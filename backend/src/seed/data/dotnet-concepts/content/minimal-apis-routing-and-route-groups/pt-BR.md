---
version: 1.0
updatedAt: 2026-10-05
title: "Minimal APIs: Roteamento e Route Groups"
summary: Como uma URL vira uma chamada de handler (templates e binding), rotas nomeadas com CreatedAtRoute, route groups e como tirar os endpoints do Program.cs.
---
## Objective

Uma minimal API é uma aplicação ASP.NET Core cujos endpoints são delegates
simples mapeados para uma rota, sem uma classe de controller no meio. A
aplicação inteira começa no `Program.cs`: um builder registra os serviços,
`Build()` produz o `WebApplication`, e o código depois dele descreve o pipeline
de requisição e os endpoints. O objetivo é saber como uma URL vira uma chamada
de handler (templates de rota e binding de parâmetros), como nomear e agrupar
rotas para que continuem fáceis de manter, e como mover os endpoints para fora
do `Program.cs` antes que ele vire um arquivo de mil linhas.

## Use Cases

- Construir uma API REST pequena (um CRUD sobre um recurso) com o mínimo de
  cerimônia que o framework permite.
- Dividir uma API que cresce por recurso, com um método de extensão e um route
  group por recurso, em vez de um `Program.cs` gigante.
- Devolver um header `Location` que aponta para o endpoint que lê o recurso
  recém-criado, sem fixar a URL no código.
- Aplicar uma política (autorização, uma tag, um filtro) a todos os endpoints
  de um recurso num lugar só.

## Deep Dive

### Duas fases num arquivo

O `Program.cs` tem duas seções separadas por `Build()`. Antes dele você
configura o que a app *tem* (serviços, configuração, logging); depois, o que a
app *faz* com cada requisição:

```csharp
var builder = WebApplication.CreateBuilder(args);   // fase 1: serviços
builder.Services.AddValidation();

var app = builder.Build();                           // fase 2: pipeline

app.MapGet("/", () => "Hello World!");
app.Run();
```

`CreateBuilder` já liga o Kestrel, a configuração vinda de JSON e variáveis de
ambiente e o logging. `Build()` congela a coleção de serviços: registrar um
serviço depois dele é tarde demais.

### Como uma URL chega ao handler: templates e binding

`MapGet`, `MapPost`, `MapPut` e `MapDelete` recebem um template de rota e um
delegate. Os parâmetros do delegate são ligados por convenção, sem atributos
nos casos comuns:

```csharp
app.MapGet("/games/{id}", (int id) => ...);            // valor da rota
app.MapGet("/games", (string? genre, int page = 1) => ...); // query string
app.MapPost("/games", (CreateGameDto dto) => ...);     // corpo JSON
app.MapGet("/games", (GameStoreContext db) => ...);    // serviço registrado
```

As regras, na ordem em que o framework as aplica:

1. Um nome que aparece no template da rota é ligado a partir da rota.
2. Um tipo simples (`int`, `string`, `Guid`, `DateOnly`) que não está no
   template é ligado a partir da query string.
3. Um tipo registrado no container é injetado.
4. Qualquer outro tipo complexo é ligado a partir do corpo JSON, mas só para
   verbos que aceitam corpo (`POST`, `PUT`, `PATCH`).

Falhas de conversão respondem por você. Com `"/games/{id}"` e um `int id`, uma
requisição para `/games/abc` devolve `400 Bad Request`. Um parâmetro obrigatório
sem valor (`(int page)` e nenhum `?page=`) também é `400`. Se você quer que um
valor que não casa pareça uma rota inexistente, adicione uma constraint ao
template: `"/games/{id:int}"` faz `/games/abc` virar `404`.

### Rotas nomeadas e `CreatedAtRoute`

Uma rota pode ter um nome, e outro código pode pedir ao framework que monte a
URL dela. É assim que um `POST` aponta o cliente para o novo recurso:

```csharp
const string GetGameEndpointName = "GetGame";

group.MapGet("/{id}", GetGame).WithName(GetGameEndpointName);

group.MapPost("/", async (CreateGameDto dto, GameStoreContext db) =>
{
    // ... cria o jogo ...
    return Results.CreatedAtRoute(
        GetGameEndpointName, new { id = game.Id }, details);
});
```

A resposta é `201 Created` com um header `Location: http://host/games/1` e o
recurso criado no corpo. O objeto anônimo fornece os valores da rota, então a
URL continua certa se você renomear o caminho depois. Mantenha o nome numa
constante: uma string digitada errada falha em runtime, não em compilação.

### Route groups

`MapGroup` dá a um conjunto de endpoints um prefixo comum e um ponto comum de
configuração. Dentro do grupo, as rotas são relativas ao prefixo:

```csharp
var group = app.MapGroup("/games").WithTags("Games");

group.MapGet("/", GetGames);          // GET    /games
group.MapGet("/{id}", GetGame);       // GET    /games/{id}
group.MapPost("/", CreateGame);       // POST   /games
group.MapPut("/{id}", UpdateGame);    // PUT    /games/{id}
group.MapDelete("/{id}", DeleteGame); // DELETE /games/{id}
```

Tudo o que você encadeia no grupo vale para todos os endpoints dele:
`RequireAuthorization()`, `WithTags(...)`, `AddEndpointFilter(...)`,
`ProducesProblem(...)`. Grupos podem ser aninhados (`/api` contendo `/games`), e
o prefixo é escrito uma vez, então não diverge entre cinco cópias.

### Tirando os endpoints do `Program.cs`

O passo seguinte comum é uma classe estática por recurso, com um método de
extensão em `IEndpointRouteBuilder`. Receber a interface em vez de
`WebApplication` faz o método funcionar também dentro de outro grupo ou de um
módulo (veja os próximos conceitos), e não só na app:

```csharp
public static class GamesEndpoints
{
    const string GetGameEndpointName = "GetGame";

    public static IEndpointRouteBuilder MapGamesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/games").WithTags("Games");

        group.MapGet("/", GetGames);
        group.MapGet("/{id}", GetGame).WithName(GetGameEndpointName);
        // ...
        return app;
    }

    static async Task<IResult> GetGame(int id, GameStoreContext db) { /* ... */ }
}
```

Handlers declarados como métodos estáticos mantêm o método de mapeamento curto
e podem ser testados como qualquer outro método. O `Program.cs` volta a ser uma
lista de chamadas: `app.MapGamesEndpoints(); app.MapGenresEndpoints();`.

### Onde o binding surpreende

- **Um tipo complexo num `GET`.** `app.MapGet("/x", (Dto d) => d)` compila e a
  app sobe. A primeira requisição falha com `500` e
  `InvalidOperationException: Body was inferred but the method does not allow
  inferred body parameters`. Leia o filtro da query com `[AsParameters]` ou
  passe para `POST`.
- **Um serviço que nunca foi registrado.** O parâmetro passa a ser tratado como
  parâmetro de corpo, então o erro que você vê é de binding de corpo, não de
  serviço ausente.
- **Ordem de registro não é ordem de casamento.** As rotas casam pela
  especificidade do template, não pela ordem das chamadas `Map*`, então
  `/games/{id}` e `/games/search` não se escondem uma à outra.

## Trade-offs

- **Nenhuma estrutura imposta.** Controllers dão a todo time as mesmas pastas e
  nomes. Minimal APIs dão liberdade, o que significa que a disciplina (um
  arquivo por recurso, handlers estáticos, grupos) é sua para manter.
- **Lambdas crescem.** Uma lambda de vinte linhas dentro de `MapPost` esconde a
  rota e dificulta a leitura do arquivo. Passando de poucas linhas, extraia um
  método estático nomeado.
  ```csharp
  group.MapPost("/", CreateGame); // lê como um índice
  ```
- **Binding por convenção é compacto e implícito.** `(CreateGameDto dto)` não
  precisa de `[FromBody]`, o que é bom até um refactor mudar de onde um
  parâmetro vem. Use atributos explícitos (`[FromQuery]`, `[FromBody]`,
  `[FromServices]`) nas fronteiras que importam.
- **Filtros são por endpoint, não um pipeline visível.** Filtros de endpoint
  rodam na ordem em que foram adicionados, em volta do handler. Bastam para
  validação e logging, mas comportamento transversal a tudo costuma pertencer a
  um middleware.
- **Sem reflection não é custo zero.** Minimal APIs montam o delegate da
  requisição no primeiro uso de cada endpoint. Para serverless e Native AOT
  existe um gerador separado de request delegates, com seus próprios limites
  sobre o binding suportado.

## Documentation Links

- [Minimal APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) (doc)
- [Route handlers in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Routing in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
