---
version: 1.0
updatedAt: 2026-10-05
title: "Semântica REST: Status Codes e Idempotência"
summary: O verbo, a URI e o status code como contrato HTTP, quais métodos são seguros ou idempotentes, 404 honesto, DELETE idempotente, TypedResults e ProblemDetails.
---
## Objective

Uma API REST é um contrato escrito em HTTP: o verbo diz o que o cliente quer
fazer, a URI diz sobre qual recurso, e o status code diz o que aconteceu.
Clientes, proxies, lógica de retry e caches agem sobre esses três sinais sem ler
o seu código. O objetivo é escolher o verbo e o status code certos para cada
operação de CRUD no ASP.NET Core, entender quais operações são seguras ou
idempotentes e por que isso importa para retries, e responder a um recurso
ausente com honestidade em vez de devolver `200` com corpo vazio.

## Use Cases

- Implementar criar, ler, atualizar e excluir para um recurso, de modo que um
  cliente HTTP genérico, um navegador e um front end React se comportem
  corretamente.
- Permitir que um cliente repita uma requisição depois de um timeout de rede sem
  criar duplicata nem excluir algo duas vezes.
- Dizer ao front end a diferença entre "o jogo não existe" e "sua requisição
  está malformada", para ele mostrar a mensagem certa.
- Entregar ao cliente a URL de um recurso recém-criado sem que ele precise
  adivinhar o id.

## Deep Dive

### Os quatro verbos e suas garantias

Duas propriedades decidem como um cliente pode tratar um verbo. Um método
**seguro** não altera o estado do servidor. Um método **idempotente** tem o
mesmo efeito no servidor seja enviado uma vez ou várias.

| Verbo | Significado | Seguro | Idempotente |
|---|---|---|---|
| `GET` | ler um recurso ou uma coleção | sim | sim |
| `POST` | criar um recurso numa coleção | não | não |
| `PUT` | substituir o recurso numa URI conhecida | não | sim |
| `DELETE` | remover o recurso | não | sim |

A idempotência é o que torna um retry seguro. Se um `PUT` dá timeout, o cliente
pode enviá-lo de novo e o estado final é o mesmo. Se um `POST` dá timeout,
reenviá-lo pode criar um segundo jogo. Tratar esse caso é o motivo de APIs de
produção adicionarem chaves de idempotência ao `POST`, que é um conceito à parte.

### Status codes de cada operação

```csharp
group.MapGet("/", ...);                          // 200 OK, corpo é a lista (lista vazia continua 200)
group.MapGet("/{id}", ...);                      // 200 OK, ou 404 Not Found
group.MapPost("/", ...);                         // 201 Created + header Location, ou 400
group.MapPut("/{id}", ...);                      // 204 No Content, ou 404, ou 400
group.MapDelete("/{id}", ...);                   // 204 No Content
```

- **`200 OK`** carrega uma representação. **`201 Created`** diz que um recurso
  agora existe e, com o header `Location`, onde lê-lo (veja o conceito de
  roteamento para `CreatedAtRoute`).
- **`204 No Content`** diz que a operação deu certo e não há nada a devolver,
  que é a convenção para `PUT` e `DELETE`.
- **`400 Bad Request`** significa que a requisição em si está errada (JSON
  malformado, validação falhou). **`404 Not Found`** significa que a requisição
  estava certa, mas o recurso não está lá.

### Não encontrado tem que ser 404

O bug de iniciante mais comum é uma leitura que não acha nada e mesmo assim
responde `200`:

```csharp
// Errado: 200 com corpo null para um id que não existe
group.MapGet("/{id}", async (int id, GameStoreContext db) =>
    await db.Games.FindAsync(id));

// Certo: diga a verdade
group.MapGet("/{id}", async (int id, GameStoreContext db) =>
{
    var game = await db.Games.FindAsync(id);
    return game is null ? Results.NotFound() : Results.Ok(game.ToDetailsDto());
});
```

Todo endpoint que busca um recurso por id precisa tomar essa decisão, inclusive
o `PUT`: o `FindAsync` devolve `null`, então responda `404` em vez de
desreferenciá-lo. Se um `PUT` num id inexistente deveria criar o recurso é uma
escolha de design (a especificação HTTP permite). Devolver `404` é a opção mais
conservadora e a que um front end espera quando o id vem de uma lista que ele
acabou de buscar.

### DELETE idempotente: o resultado, não o evento

O `DELETE` é idempotente porque a garantia é sobre o estado final: depois da
chamada, o recurso não existe. Então um segundo `DELETE` do mesmo id não é um
erro, e muitas APIs respondem `204` nas duas vezes:

```csharp
group.MapDelete("/{id}", async (int id, GameStoreContext db) =>
{
    await db.Games.Where(g => g.Id == id).ExecuteDeleteAsync();
    return Results.NoContent();
});
```

`ExecuteDeleteAsync` é uma exclusão em massa: um único comando
`DELETE ... WHERE Id = @id`, sem carregar nada e sem `SaveChanges`. Quando a
linha não existe, ele afeta zero linhas. Responder `404` na segunda chamada
também é defensável (o cliente descobre que o id já tinha sumido), mas faz um
retry parecer uma falha. Escolha uma regra e aplique em todo lugar.

### Typed results tornam o contrato visível

`Results.NotFound()` devolve um `IResult`, então a assinatura do handler não diz
quais respostas são possíveis. `TypedResults` e a união `Results<T1, T2>`
colocam as respostas possíveis no tipo de retorno, e a geração de OpenAPI as lê:

```csharp
group.MapGet("/{id}", async Task<Results<Ok<GameDetailsDto>, NotFound>> (int id, GameStoreContext db) =>
{
    var game = await db.Games.FindAsync(id);
    return game is null ? TypedResults.NotFound() : TypedResults.Ok(game.ToDetailsDto());
});
```

### Erros como `ProblemDetails`

Para o corpo de um erro, prefira o formato padrão `application/problem+json`
(RFC 9457) a uma string ad hoc. Registrar o serviço é só metade do caminho: o
middleware precisa pedir.

```csharp
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();   // exceção não tratada -> 500 problem+json
app.UseStatusCodePages();    // 404/400 sem corpo -> problem+json
```

Sem `UseStatusCodePages()`, `Results.NotFound()` continua respondendo com corpo
vazio, mesmo com `AddProblemDetails()` registrado. Com os dois, o mesmo `404`
carrega `{"title":"Not Found","status":404,"traceId":"..."}`, e
`Results.Problem(...)` monta um explicitamente. O front end passa a tratar todo
erro da API com um único parser.

## Trade-offs

- **`PUT` substitui, não aplica patch.** O corpo precisa trazer todos os campos,
  senão os ausentes são sobrescritos com valores padrão. Para atualizações
  parciais existe o `PATCH`, com regras próprias e mais código.
- **`204` num `DELETE` de recurso ausente esconde informação.** É simples e bom
  para retries, mas o cliente não distingue "eu apaguei" de "nunca existiu". Se
  essa distinção importa, devolva `404` e faça os clientes tratarem como
  sucesso.
- **Um `201` de `POST` não é idempotente.** Duas requisições idênticas criam
  duas linhas. Se um cliente repete depois de um timeout, adicione uma regra de
  unicidade ou uma chave de idempotência; o status code sozinho não protege.
  ```csharp
  // retry do cliente após timeout: dois jogos com o mesmo nome, a menos que você proteja
  POST /games { "name": "Astro Vault", ... }
  ```
- **Exclusão em massa ignora o change tracker.** `ExecuteDeleteAsync` não carrega
  a entidade, então não há eventos do EF Core nem estado rastreado, e uma regra
  de cascade modelada só em C# não roda. Cascades no nível do banco continuam
  valendo.
- **Status code é convenção, não sistema de tipos.** Nada impede um handler de
  devolver `200` para um erro. `TypedResults` e testes que verificam o status
  code são o que mantém o contrato honesto.

## Lab

Neste lab você recebe uma API CRUD de jogos em memória que compila, mas em que todo handler responde `200 OK`, até para um jogo que não existe. O seu trabalho é corrigir cada endpoint para que um cliente HTTP genérico, um proxy que refaz tentativas e um front end possam confiar na resposta. A ideia central é sentir os status codes que os clientes REST esperam: `404` para recurso ausente, `201` com `Location` na criação, `204` em update e delete, e um `DELETE` idempotente.

**O cenário**

Os testes descrevem o contrato, então vale ler os nomes deles primeiro. Eles usam `WebApplicationFactory<Program>` e criam jogos pela própria API.

- `GameStore.cs`: o store em memória (`All`, `Find`, `Add`, `Replace` que devolve `false` se o id não existe, e `Remove`) e os records `Game`, `CreateGameDto` e `UpdateGameDto`.
- `GamesEndpoints.cs`: o grupo `/games` com GET lista, GET por id, POST, PUT e DELETE, todos devolvendo 200 hoje, e a constante `GetGameEndpointName`.
- `Program.cs`: registra o store e chama `MapGamesEndpoints`.

**O que você vai fazer, passo a passo**

1. **Responder 404 para o que não existe (TODO-00).** Em `GET /games/{id}`, devolva `404 Not Found` quando o jogo não existe, e `200` com o jogo quando existe.
2. **Criar com 201 e Location (TODO-01).** Dê ao GET por id o nome de rota `GetGameEndpointName` e faça o `POST /games` responder `201 Created` com `CreatedAtRoute`, apontando o header `Location` para o novo jogo e devolvendo-o no corpo. O cliente deve conseguir seguir o `Location`. Repare que enviar o mesmo POST duas vezes cria dois jogos: o POST não é idempotente.
3. **Atualizar com 404 ou 204 (TODO-02).** Em `PUT /games/{id}`, devolva `404` para um id desconhecido e `204 No Content` depois de substituir o jogo. Repare que o mesmo PUT repetido deixa o mesmo estado: o PUT é idempotente.
4. **Apagar sempre com 204 (TODO-03).** Em `DELETE /games/{id}`, devolva `204 No Content` toda vez, inclusive quando o jogo já tinha sumido. É isso que torna o delete seguro de repetir.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar a diferença de idempotência entre POST, PUT e DELETE, e por que um proxy pode repetir um PUT ou um DELETE mas não um POST sem risco.

**Desafios opcionais**

- **TODO-04:** faça o handler do GET por id devolver `Results<Ok<Game>, NotFound>` com `TypedResults`, para que as respostas possíveis apareçam na assinatura.
- **TODO-05:** registre `AddProblemDetails()`.
- **TODO-06:** adicione `UseExceptionHandler()` e `UseStatusCodePages()`, chame `GET /games/9999` e compare o corpo com e sem os TODO-05 e TODO-06.

**Pré-requisitos:** Minimal APIs e route groups básicos, verbos HTTP e famílias de status code, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O app compila no estado inicial, e os testes de status falham porque tudo responde 200, até você corrigir cada handler seguindo os comentários TODO em `GamesEndpoints.cs`.

## Documentation Links

- [Create responses in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [TypedResults vs Results, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses#typedresults-vs-results) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (doc)
- [Problem Details for HTTP APIs, RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
