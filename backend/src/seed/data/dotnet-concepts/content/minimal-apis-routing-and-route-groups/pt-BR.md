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

## Lab

Neste lab você recebe uma API de jogos que sobe, mas não mapeia nenhum endpoint: `MapGamesEndpoints` existe e está vazio, e o `Program` o chama direto na raiz. O seu trabalho é construir os endpoints um por vez, cada um exercitando uma fonte de binding diferente, e agrupá-los numa route group. A ideia central é sentir como o Minimal API decide de onde vem cada parâmetro (rota, query, body, serviço), como um nome de rota permite que um `201` aponte para o recurso criado, e como um grupo compartilha prefixo e metadados.

**O cenário**

Uma loja de jogos com um `GameStore` em memória que já começa com três jogos. Os testes sobem a API em memória com `WebApplicationFactory<Program>` e verificam o espaço de URLs, os valores ligados e os metadados que o grupo anexa.

- `Program.cs`: registra o `GameStore` como singleton e chama `app.MapGamesEndpoints()`.
- `GamesEndpoints.cs`: a extensão de `IEndpointRouteBuilder` onde ficam os endpoints, cada TODO com a regra em comentário.
- `GameStore.cs`: `Game`, `CreateGameRequest` e o store, com `Add`, `Search` e `Count`.

**O que você vai fazer, passo a passo**

1. **Prefixar tudo com `/api` (TODO-00).** Em `Program.cs`, mapeie os endpoints de jogos dentro de uma route group `/api`, sem mexer nos caminhos dentro de `GamesEndpoints`. Depois disso `/games` na raiz deve dar 404.
2. **Criar o grupo `/games` (TODO-01).** Em `GamesEndpoints`, crie um grupo para `/games` com a tag `Games`. Todos os endpoints abaixo são mapeados nele, com caminhos relativos.
3. **Ligar a query string (TODO-02).** `GET /` recebe `genre` (opcional) e `page` (padrão 1) e devolve `Results.Ok(new { genre, page })`.
4. **Ligar o id da rota (TODO-03).** `GET /{id}` com restrição de inteiro, para que `/games/abc` seja 404 e não 400. Devolva `Results.Ok(new { kind = "byId", id })` e dê à rota o nome `GetGameEndpointName`.
5. **Fazer o literal vencer o parâmetro (TODO-04).** `GET /search` liga `q` da query e usa `GameStore.Search`, devolvendo `Results.Ok(new { kind = "search", results })`. Garanta que `/{id}` não o engula.
6. **Injetar um serviço (TODO-05).** `GET /count` recebe o `GameStore` do container e devolve `Results.Ok(new { total = store.Count })`.
7. **Criar com Location (TODO-06).** `POST /` recebe um `CreateGameRequest` do body, adiciona ao store e responde 201 com um header `Location` que aponta para a rota nomeada.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar de onde vem cada parâmetro de cada handler, por que `/api/games/abc` dá 404 e por que o `Location` do `201` é montado a partir do nome da rota e não de uma string escrita à mão.

**Desafios opcionais**

- **TODO-07:** tire a restrição `:int` de `/{id}` e peça `/api/games/abc`. Que status você recebe e por que é diferente de 404?
- **TODO-08:** troque o handler de `count` por um `GET` com parâmetro de tipo complexo e chame. Leia a exceção e explique por que o app subiu normalmente.

**Pré-requisitos:** lambdas e métodos de extensão em C#, verbos e status codes HTTP e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O app compila no estado inicial, e os testes falham até você mapear cada endpoint seguindo os comentários TODO.

## Documentation Links

- [Minimal APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) (doc)
- [Route handlers in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Parameter binding in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Routing in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
