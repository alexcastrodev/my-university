---
version: 1.0
updatedAt: 2026-11-19
title: "GraphQL com Hot Chocolate"
summary: Um servidor Hot Chocolate 16.7.6 em net10.0 medido de ponta a ponta, com schema code-first e source generators, o problema N+1 contado em SQL com 1, 10 e 100 pais e a correção com DataLoader, filtros, ordenação e projeção em SQL, paginação por cursor contra offset, subscriptions por WebSocket e SSE, limites de profundidade e custo, introspecção, persisted operations, erros parciais contra status HTTP, autorização, GraphQL contra Minimal APIs em bytes e requisições, e o estado de manutenção e a licença do projeto.
---
## Objective

GraphQL expõe um único endpoint cujos clientes pedem exatamente os campos de que precisam, e o Hot Chocolate é o servidor .NET que
mapeia tipos C# e resolvers para esse schema. Esta lição é medida num servidor de verdade: como o schema é hospedado, quanto o
problema N+1 custa em comandos SQL com e sem DataLoader, no que viram filtros, ordenação, projeção e cursores, quanto uma consulta
hostil pode custar e quais limites a barram, como os erros se mapeiam para HTTP e como ele se compara a uma Minimal API em bytes e
requisições. Versões: `HotChocolate.AspNetCore`, `.Data`, `.Data.EntityFramework`, `.AspNetCore.Authorization`,
`.PersistedOperations.InMemory`, `.PersistedOperations.FileSystem` e `.Types.Analyzers` 16.7.6 (última estável no NuGet em
2026-11-19; existem previews 16.8.0), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15 (o restore avisa NU1903 da biblioteca nativa
do SQLite, irrelevante aqui), `net10.0`, SDK 10.0.100.

## Use Cases

- Um cliente que precisa de campos diferentes por tela, sobre o mesmo domínio, sem um endpoint por tela.
- Atualizações ao vivo (subscriptions) ao lado de queries e mutations no mesmo schema.
- Decidir, com números, se GraphQL ou uma Minimal API serve melhor para uma API.

## Deep Dive

### Hospedando um schema code-first

O Hot Chocolate 16 usa source generators: uma classe `partial` com `[QueryType]` entra no tipo `Query`, e uma extensão gerada
registra todas essas classes do assembly.

```csharp
builder.Services.AddGraphQLServer().AddApiTypes()      // gerado, com o nome do assembly
    .AddFiltering().AddSorting().AddProjections().AddPagingArguments()
    .AddAuthorization().AddInMemorySubscriptions();
app.UseWebSockets(); app.UseAuthentication(); app.UseAuthorization();
app.MapGraphQL();                                       // POST/GET /graphql, WebSocket, SSE

namespace Catalog;                                      // não é opcional, veja abaixo
[QueryType] public static partial class Query          // GetAuthorsAsync vira o campo `authors`
{ public static async Task<List<Author>> GetAuthorsAsync(int? take, CatalogContext db, CancellationToken ct) => ...; }
```

`AddGraphQLServer()` em `IServiceCollection` e `AddGraphQL()` no web builder existem na 16.7.6. `[assembly:
HotChocolate.Module("Catalog")]` renomeou o método gerado para `AddCatalog()`. Três armadilhas, todas encontradas aqui. Tipos no
namespace global fizeram o gerador emitir `<global namespace>` e o build falhou (CS0116, CS0825). Misturar `[UsePaging]` com
`[UseConnection]` falha na partida com `The name PageInfo was already registered by another type`. E expor a entidade do EF como
está expõe tudo (`Book.description`, `authorId`, filtros em `description`), com uma pegadinha: uma navigation property não
carregada é `null`: `{ book(id:1){ author{ name } } }` devolveu `HC0018 Cannot return null for non-nullable field` e
`"book":null`. A correção é um resolver para `author` (abaixo) ou uma projeção.

### Queries, mutations e subscriptions

Uma mutation chama `ITopicEventSender.SendAsync("OnBookAdded", book, ct)` depois do `SaveChangesAsync`, e um método com
`[SubscriptionType]` `[Subscribe] Book OnBookAdded([EventMessage] Book book) => book` o recebe. Um cliente WebSocket (`graphql-transport-ws`) assinou `onBookAdded { id title author { name } }`; depois de 20 mutations todos os
eventos chegaram, com mediana de 1,1 ms entre enviar a mutation e receber o push (máximo 17,7 ms). Com `Accept: text/event-stream`
a mesma subscription devolveu `event: next` e `data: {"data":{"onBookAdded":{"title":"sse"}}}`. O provider em memória cobre um
único servidor; providers Redis, NATS e Postgres são só doc.

### O problema N+1, medido

Autores com 5 livros cada e 3 reviews por livro, query `authors { name books { title reviews { stars } } }`. Um
`DbCommandInterceptor` conta os comandos SQL. O resolver ingênuo consulta por pai; o DataLoader agrupa por nível:

| Autores | SQL ingênuo | SQL DataLoader | Mediana ms ingênuo | Mediana ms DataLoader |
| --- | --- | --- | --- | --- |
| 1 | 7 | 3 | 2 | 2 |
| 10 | 61 | 3 | 16 | 5 |
| 100 | 601 | 3 | 133 | 55 |

A contagem ingênua é exatamente 1 + N + 5N e os 3 do DataLoader ficam constantes (`WHERE "b"."AuthorId" IN (@authorIds1,
@authorIds2)` no lugar de um `= @author_Id` por autor). O banco é um arquivo SQLite local; com um banco a 1 ms de distância, 601
idas e vindas somam cerca de 600 ms (conta, não medição).

```csharp
// classe [ObjectType<Author>]: GetBooksAsync([Parent] Author a, IBooksByAuthorDataLoader l, ct) => await l.LoadAsync(a.Id, ct) ?? [];
internal static class Loaders
{
    [DataLoader]   // group: uma chave, vários valores (ILookup)
    public static async Task<ILookup<int, Book>> GetBooksByAuthorAsync(IReadOnlyList<int> authorIds, CatalogContext db, CancellationToken ct)
        => (await db.Books.Where(b => authorIds.Contains(b.AuthorId)).ToListAsync(ct)).ToLookup(b => b.AuthorId);

    [DataLoader]   // batch: uma chave, um valor (Dictionary)
    public static async Task<Dictionary<int, Author>> GetAuthorByIdAsync(IReadOnlyList<int> ids, CatalogContext db, CancellationToken ct)
        => await db.Authors.Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
}
```

O gerador cria `IBooksByAuthorDataLoader` e `IAuthorByIdDataLoader` a partir dos nomes dos métodos. Uma chave sem valor: um autor
sem livros devolveu `{"id":101,"books":[]}`, mas um batch loader sobre `Dictionary<int, Review[]>` chamado com `LoadRequiredAsync`
transformou um livro sem reviews em `Unexpected Execution Error` e `"book":null`; use `LoadAsync(...) ?? []`. Um resolver que
recebe um `DbContext` ganha uma instância própria, então 601 consultas paralelas não geraram o erro "second operation" (doc:
queries usam um contexto por resolver, mutations compartilham o da requisição).

### Projeções, filtros e ordenação

`[UseFiltering]` e `[UseSorting]` geram os argumentos `where` e `order` a partir do tipo C# e os aplicam ao `IQueryable`.

```csharp
[UseProjection] [UseFiltering] [UseSorting]
public static IQueryable<Book> GetAllBooks(CatalogContext db) => db.Books;
// GetAllBooksFull: o mesmo com só [UseFiltering] [UseSorting] (sem projeção)
```

```text
allBooks(where:{price:{gt:90}}, order:[{title:DESC}]) { title }
  SELECT "b"."Title" FROM "Books" AS "b" WHERE "b"."Price" > @p ORDER BY "b"."Title" DESC
allBooksFull (mesmos argumentos)
  SELECT "b"."Id", "b"."AuthorId", "b"."Description", "b"."Price", "b"."Title" FROM "Books" ...
where:{author:{name:{contains:"007"}}, reviews:{some:{stars:{gte:5}}}}
  SELECT "b"."Title" FROM "Books" AS "b" INNER JOIN "Authors" AS "a" ON ... WHERE instr("a"."Name", @p) > 0
  AND EXISTS (SELECT 1 FROM "Reviews" AS "r" WHERE ... "r"."Stars" >= @p1)
```

A projeção lê uma coluna em vez de cinco, pulando o `Description` de 400 caracteres. Toda propriedade virou campo de filtro e de
ordenação, relações incluídas, então o cliente pode escrever um join ou um `contains` sem índice. `[UseProjection]` ainda funciona
na 16.7.6; a doc prefere `QueryContext<T>` (próxima seção) e diz que os dois não combinam (analyzer HC0099, só doc).

### Paginação: connection por cursor contra offset

```csharp
[UseConnection(IncludeTotalCount = true)] [UseFiltering] [UseSorting]
public static async Task<PageConnection<Book>> GetBooksCtxAsync(PagingArguments paging, QueryContext<Book> query,
    CatalogContext db, CancellationToken ct)
    => await db.Books.With(query, s => s.AddAscending(b => b.Id)).ToPageAsync(paging, ct);
```

`QueryContext<T>` carrega projeção, filtro e ordenação, e `With` os aplica na ordem. Um único comando serviu a página, o
`totalCount` (uma subconsulta escalar) e só as colunas selecionadas. O cursor é o base64 da chave de ordenação (`e30z` decodifica
para `{}3`), opaco mas não secreto. Com `order: [{price: DESC}]` e `after`, o SQL foi `WHERE "b"."Price" < @value OR ("b"."Price" =
@value AND "b"."Id" > @value2) ORDER BY "b"."Price" DESC, "b"."Id" LIMIT @p`.

O desempate `AddAscending(b => b.Id)` importa. Minha primeira versão só incluía o `Id` quando a ordenação estava vazia; a condição
virou `Price < @value` e percorrer 500 livros em páginas de 50 devolveu 475 linhas distintas. Com o desempate: 500 de 500. O
tamanho da página tem teto: `first: 100` falhou com `HC0051` (máximo 50), e sem `first` vieram 10 linhas.

Offset contra cursor em 200.000 livros (SQLite, HTTP e GraphQL incluídos), medianas: `skip: 0` 463 us, `skip: 190000` 12.655 us,
cursor depois da linha 190000 410 us. O offset lê e descarta 190.000 linhas; o cursor faz seek em `WHERE "b"."Id" > @value`. A versão 16.7.6 não tem `[UseOffsetPaging]`
(não compila), então a paginação por offset é escrita à mão com `Skip` e `Take`. Cursores relativos para barras de página são só doc.

### Limites contra consultas caras

Um `IQueryable` exposto mais aninhamento deixa o cliente multiplicar trabalho. Com `gql.AddMaxExecutionDepthRule(4)`, que conta
cada nível e o campo folha, `{ authors(take:1) { books { author { books { author { name } } } } } }` recebeu HTTP 400 e `The
GraphQL document has an execution depth of 6 which exceeds the max allowed execution depth of 4.`

Sem chamada nenhuma, uma query aninhando `books { author {` quatro vezes falhou com `HC0087` (profundidade de ciclo de
coordenada, limite 3), em Production e em Development. A análise de custo também vem ligada (`MaxFieldCost` 1000, `MaxTypeCost` 10.000) e o header
`GraphQL-Cost: validate` informa sem executar. Pela doc, um campo com resolver pesa 10, multiplicado pelo tamanho da lista:

```text
booksCtx(first:50) { nodes { title author { name } } }          field 511    type 102
authors(take:100)  { books { reviews { stars } } }  (sem anotação) field 30  type 4
o mesmo, com [ListSize] em authors, books e reviews             field 51010  type 105101
authors(take:3)    { books { reviews { stars } } }  (anotado)   field 1540   type 3154
```

A linha sem anotação é a armadilha: `take: Int` não é argumento de paginação, então 100 x 5 x 3 objetos custaram 30. Depois de
anotar `authors` com `[ListSize(AssumedSize = 100, SlicingArguments = ["take"])]`, `books` com `[ListSize(AssumedSize = 50)]` e
`reviews` com `[ListSize(AssumedSize = 20)]`, o limite padrão a rejeita com `HC0047`. A estimativa é uma suposição: `authors(take:
3)` devolve 45 reviews mas custa 1540 e também é rejeitada. O timeout de 30 s e o portão de 64 execuções são padrões da doc, não
exercitados aqui.

### Introspecção e persisted operations

Em ambiente Production o servidor já recusava introspecção (`HC0046`, HTTP 400, enquanto `{ __typename }` funcionava); com
`ASPNETCORE_ENVIRONMENT=Development` ela respondia. A doc mostra `.AllowIntrospection(false)` no builder, que não compila na
16.7.6 (CS1061); `.DisableIntrospection()` compila. Isso não esconde nada: `/graphql/schema.graphql` devolveu 200 em Production.

Trusted documents (`UsePersistedOperationPipeline`, um storage de arquivos, `OnlyAllowPersistedDocuments = true`) são o controle
forte para os seus próprios clientes. O arquivo se chama pelo MD5 do documento em hexadecimal:

```text
{"query":"{ authors(take:2) { name } }"}   400 HC0067 Only persisted operations are allowed.
{"id":"f3a5024e30cb5496490d22f20b641c19"}  200 {"data":{"authors":[{"name":"Author 001"},...
{"id":"86UCTjDLVJZJDSLyC2QcGQ=="} (base64) 400 HC0012 The operation ID has an invalid format.
```

Automatic persisted queries (`UseAutomaticPersistedOperationPipeline`) só economizam banda, não restringem nada: só o hash deu
`PersistedQueryNotFound` (400), hash mais query executou com `"persisted":true`, e depois só o hash funcionou. Uma query diferente
reivindicando o hash guardado executou com `"persisted":false` e deixou a guardada intacta. O hash do exemplo da doc é base64; a
16.7.6 esperava hexadecimal. Para um documento de 41 bytes a requisição com id teve 42 bytes: a economia exige documentos grandes.

### Erros parciais contra status HTTP

A resposta traz `data` e `errors`, e o status HTTP segue o media type que o cliente aceita:

| Falha | Sem `Accept` | `application/json` | `application/graphql-response+json` |
| --- | --- | --- | --- |
| sintaxe, campo inexistente, variável inválida | 400 | 200 | 400 |
| regra de custo, profundidade, ciclo ou introspecção | 400 | 200 | 400 |
| um resolver lança exceção | 200 | 200 | 200 |
| `[Authorize]` falha | 200 | 200 | 200 |

Um campo anulável que lança vira `null` e o resto sobrevive (`"data":{"book":{"title":"Book 001-2","isbn":null}}` com
`Unexpected Execution Error` em `["book","isbn"]`). Um campo não nulo que lança (`stock: Int!`) anula o pai anulável mais próximo:
`"data":{"book":null}`. As mensagens de exceção são mascaradas. Como uma falha costuma ser 200, monitores que olham o status a
perdem: conte também os `errors`. O batching de requisições vem desligado (`HC0009` em `[{...},{...}]`).

### Autorização

`[HotChocolate.Authorization.Authorize(Policy = "Admin")]` protege um campo; `AddAuthorization()` é necessário na coleção de
serviços e no builder do GraphQL. Sem header veio `AUTH_NOT_AUTHENTICATED`; o usuário `alice` no campo com policy recebeu
`AUTH_NOT_AUTHORIZED`; `root` recebeu `{"me":"root","adminStats":500}`. Tudo HTTP 200. O `[Authorize]` do ASP.NET Core é o atributo
errado e o analyzer da v16 o rejeita no build (`HC0106`). `MapGraphQL().RequireAuthorization()` protege o endpoint: uma requisição
anônima recebeu 401, `schema.graphql` incluído.

### GraphQL contra REST e Minimal APIs

Os mesmos 20 livros com título, preço e nome do autor, depois um autor com livros e reviews, contra endpoints REST genéricos que
devolvem entidades, um endpoint `/api/book-cards` sob medida e uma query GraphQL:

```text
20 livros + nome do autor  REST devolvendo entidades  5 requisições  10.128 bytes  5 SQL
                           REST endpoint sob medida   1 requisição    1.201 bytes  1 SQL
                           GraphQL                    1 requisição    1.657 bytes  2 SQL (+76 bytes enviados)
autor + livros + reviews   REST por recurso           7 requisições   3.261 bytes  7 SQL
                           GraphQL                    1 requisição      734 bytes  3 SQL
```

O `Description` de 400 caracteres explica os 10 KB (texto repetido, então o gzip esconde quase tudo). Um endpoint sob medida
venceu o GraphQL em bytes (o aninhamento repete o autor) e em latência (mediana de 325 us contra 1.239 us em loopback). O GraphQL
ganha quando muitas telas precisam de formatos diferentes; o preço é a maquinaria desta lição. Veja [Minimal APIs](minimal-apis-routing-and-route-groups)
e [output caching](output-caching-and-http-caching).

### Estado do projeto (conferido em 2026-11-19)

O repositório `ChilliCream/graphql-platform` é MIT, com 5.767 estrelas, 480 issues abertas, um commit no mesmo dia, a 16.7.6 em
2026-11-17 e previews 16.8.0 a cada poucos dias; as linhas 15.1, 14.3 e 13.9 ainda receberam patches em 2026-11-10. Os commits são
concentrados (3.021 do maior contribuidor, 1.083 do seguinte). Os pacotes do servidor dizem `MIT`, mas o `HotChocolate.AspNetCore`
depende do `ChilliCream.Nitro.App` 32.0.2, a IDE embutida, sob a ChilliCream License 1.0 (livre de royalties, sem contornar as
funções de chave de licença, não é licença OSI). "ChilliCream" é marca registrada, e a doc menciona telemetria do Nitro com a
chave `DisableTelemetry` (só doc). Leia a licença antes de publicar.

Só doc, não executado: Fusion (`HotChocolate.Fusion.AspNetCore`, um gateway sobre vários serviços GraphQL, veja [API gateway](/system-design/system-design-concepts/api-gateway)), Apollo Federation, o cliente Strawberry Shake, `@defer`.

## Trade-offs

- **GraphQL vs Minimal APIs.** Um endpoint tipado e formatos escolhidos pelo cliente, ao preço de controle de custo, vigilância
  contra N+1 e um 200 que pode conter erros. Um conjunto estável de telas sai mais barato como alguns endpoints sob medida.
- **`IQueryable` exposto vs resolvers explícitos.** `[UseFiltering]` entrega rápido, mas transforma a entidade numa linguagem de
  consulta, com joins e `contains`. Declare tipos de filtro para os campos que você indexa.
- **Análise de custo exige anotação.** Sem `[ListSize]` ela subconta (30 em vez de 51.010); com ele, superconta.
- **Cursor vs offset.** Cursores exigem ordenação única e não pulam para a página 40 sem cursores relativos; offset é lento fundo.
- **API pública vs privada.** Pública: custo, profundidade, timeout e teto de página. Privada: trusted documents.
- **Saúde da biblioteca.** Releases MIT rápidos, um mantenedor dominante, um pacote de IDE que não é MIT e erros do gerador em
  arquivos gerados: fixe versões e leia cada página de migração.

## Documentation Links

- [DataLoader, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/fetching-data/batching/dataloader) (doc)
- [Projections, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/fetching-data/projections) (doc)
- [Pagination, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/fetching-data/pagination) (doc)
- [Subscriptions, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/defining-a-schema/subscriptions) (doc)
- [Cost analysis, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/security/cost-analysis) (doc)
- [Authorization, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/security/authorization) (doc)
- [Persisted operations, ChilliCream](https://chillicream.com/docs/hotchocolate/v16/performance/trusted-documents) (doc)
- [ChilliCream License 1.0, ChilliCream](https://chillicream.com/licensing/chillicream-license) (doc)
- [Hot Chocolate repository, GitHub](https://github.com/ChilliCream/graphql-platform) (doc)
