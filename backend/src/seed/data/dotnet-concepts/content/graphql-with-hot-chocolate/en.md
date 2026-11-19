---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

GraphQL serves one endpoint whose clients ask for exactly the fields they need, and Hot Chocolate is the .NET server that maps
C# types and resolvers to that schema. This lesson is measured on a real server: how the schema is hosted, what the N+1
problem costs in SQL statements with and without a DataLoader, what filtering, sorting, projection and cursors turn into, how
much a hostile query can cost and which limits stop it, how errors map to HTTP, and how it compares with a Minimal API in
bytes and requests. Versions: `HotChocolate.AspNetCore`, `.Data`, `.Data.EntityFramework`, `.AspNetCore.Authorization`,
`.PersistedOperations.InMemory`, `.PersistedOperations.FileSystem` and `.Types.Analyzers` 16.7.6 (latest stable on NuGet on
2026-11-19; 16.8.0 previews exist), `Microsoft.EntityFrameworkCore.Sqlite` 10.0.15 (restore warns NU1903 for the bundled
SQLite native library, irrelevant here), `net10.0`, SDK 10.0.100.

## Use Cases

- A client that needs different field sets per screen from the same domain, without one endpoint per screen.
- Live updates (subscriptions) next to queries and mutations on the same schema.
- Deciding, with numbers, whether GraphQL or a Minimal API fits a given API.

## Deep Dive

### Hosting a code-first schema

Hot Chocolate 16 is source-generated: a `partial` class with `[QueryType]` joins the `Query` type, and a generated extension
registers every such class in the assembly.

```csharp
builder.Services.AddGraphQLServer().AddApiTypes()      // generated, named after the assembly
    .AddFiltering().AddSorting().AddProjections().AddPagingArguments()
    .AddAuthorization().AddInMemorySubscriptions();
app.UseWebSockets(); app.UseAuthentication(); app.UseAuthorization();
app.MapGraphQL();                                       // POST/GET /graphql, WebSocket, SSE

namespace Catalog;                                      // not optional, see below
[QueryType] public static partial class Query          // GetAuthorsAsync becomes the field `authors`
{ public static async Task<List<Author>> GetAuthorsAsync(int? take, CatalogContext db, CancellationToken ct) => ...; }
```

`AddGraphQLServer()` on `IServiceCollection` and `AddGraphQL()` on the web builder both exist in 16.7.6.
`[assembly: HotChocolate.Module("Catalog")]` renamed the generated method to `AddCatalog()`. Three gotchas, all hit here.
Types in the global namespace made the generator emit `<global namespace>` and the build failed (CS0116, CS0825). Mixing
`[UsePaging]` with `[UseConnection]` fails at startup with `The name PageInfo was already registered by another type`. And an
EF entity exposed as-is exposes everything (`Book.description`, `authorId`, filters on `description`), with a trap: a
navigation property that was not loaded is `null`: `{ book(id:1){ author{ name } } }` returned `HC0018 Cannot return null for
non-nullable field` and `"book":null`. The fix is a resolver for `author` (below) or a projection.

### Queries, mutations and subscriptions

A mutation calls `ITopicEventSender.SendAsync("OnBookAdded", book, ct)` after `SaveChangesAsync`, and a
`[SubscriptionType]` method `[Subscribe] Book OnBookAdded([EventMessage] Book book) => book` receives it.

A WebSocket client (`graphql-transport-ws`) subscribed to `onBookAdded { id title author { name } }`; after 20 mutations every
event had arrived, with a median of 1.1 ms from sending the mutation to receiving the push (max 17.7 ms). Over
`Accept: text/event-stream` the same subscription returned `event: next` and `data: {"data":{"onBookAdded":{"title":"sse"}}}`.
The in-memory provider covers one server; Redis, NATS and Postgres providers are docs only.

### The N+1 problem, measured

Authors with 5 books each and 3 reviews per book, query `authors { name books { title reviews { stars } } }`. A
`DbCommandInterceptor` counts SQL statements. The naive resolver queries per parent; the DataLoader batches per level:

| Authors | SQL naive | SQL DataLoader | Median ms naive | Median ms DataLoader |
| --- | --- | --- | --- | --- |
| 1 | 7 | 3 | 2 | 2 |
| 10 | 61 | 3 | 16 | 5 |
| 100 | 601 | 3 | 133 | 55 |

The naive count is exactly 1 + N + 5N and the DataLoader's 3 stays flat (`WHERE "b"."AuthorId" IN (@authorIds1, @authorIds2)`
instead of one `= @author_Id` per author). The database is a local SQLite file; with one 1 ms away, 601 round trips add about
600 ms (arithmetic, not measured).

```csharp
// [ObjectType<Author>] class: GetBooksAsync([Parent] Author a, IBooksByAuthorDataLoader l, ct) => await l.LoadAsync(a.Id, ct) ?? [];
internal static class Loaders
{
    [DataLoader]   // group: one key, many values (ILookup)
    public static async Task<ILookup<int, Book>> GetBooksByAuthorAsync(IReadOnlyList<int> authorIds, CatalogContext db, CancellationToken ct)
        => (await db.Books.Where(b => authorIds.Contains(b.AuthorId)).ToListAsync(ct)).ToLookup(b => b.AuthorId);

    [DataLoader]   // batch: one key, one value (Dictionary)
    public static async Task<Dictionary<int, Author>> GetAuthorByIdAsync(IReadOnlyList<int> ids, CatalogContext db, CancellationToken ct)
        => await db.Authors.Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
}
```

The generator creates `IBooksByAuthorDataLoader` and `IAuthorByIdDataLoader` from the method names. A key with no value: an
author without books returned `{"id":101,"books":[]}`, but a batch loader over `Dictionary<int, Review[]>` called with
`LoadRequiredAsync` turned a book without reviews into `Unexpected Execution Error` and `"book":null`; use
`LoadAsync(...) ?? []`. A resolver that takes a `DbContext` gets its own instance, so 601 parallel queries raised no "second
operation" error (docs: queries get one context per resolver, mutations share the request's).

### Projections, filtering and sorting

`[UseFiltering]` and `[UseSorting]` generate `where` and `order` arguments from the C# type and apply them to the `IQueryable`.

```csharp
[UseProjection] [UseFiltering] [UseSorting]
public static IQueryable<Book> GetAllBooks(CatalogContext db) => db.Books;
// GetAllBooksFull: the same with [UseFiltering] [UseSorting] only (no projection)
```

```text
allBooks(where:{price:{gt:90}}, order:[{title:DESC}]) { title }
  SELECT "b"."Title" FROM "Books" AS "b" WHERE "b"."Price" > @p ORDER BY "b"."Title" DESC
allBooksFull (same arguments)
  SELECT "b"."Id", "b"."AuthorId", "b"."Description", "b"."Price", "b"."Title" FROM "Books" ...
where:{author:{name:{contains:"007"}}, reviews:{some:{stars:{gte:5}}}}
  SELECT "b"."Title" FROM "Books" AS "b" INNER JOIN "Authors" AS "a" ON ... WHERE instr("a"."Name", @p) > 0
  AND EXISTS (SELECT 1 FROM "Reviews" AS "r" WHERE ... "r"."Stars" >= @p1)
```

Projection reads one column instead of five, skipping the 400 character `Description`. Every property became a filter and sort
field, relations included, so a client can write a join or an unindexed `contains`. `[UseProjection]` still works in 16.7.6;
the docs prefer `QueryContext<T>` (next section) and say the two cannot be combined (analyzer HC0099, docs only).

### Pagination: cursor connection against offset

```csharp
[UseConnection(IncludeTotalCount = true)] [UseFiltering] [UseSorting]
public static async Task<PageConnection<Book>> GetBooksCtxAsync(PagingArguments paging, QueryContext<Book> query,
    CatalogContext db, CancellationToken ct)
    => await db.Books.With(query, s => s.AddAscending(b => b.Id)).ToPageAsync(paging, ct);
```

`QueryContext<T>` carries projection, filter and sort, and `With` applies them in order. One statement served the page, the
`totalCount` (a scalar subquery) and only the selected columns. The cursor is base64 of the sort key (`e30z` decodes to `{}3`),
opaque but not secret. With `order: [{price: DESC}]` and `after`, the SQL was `WHERE "b"."Price" < @value OR ("b"."Price" =
@value AND "b"."Id" > @value2) ORDER BY "b"."Price" DESC, "b"."Id" LIMIT @p`.

The `AddAscending(b => b.Id)` tie-breaker matters. My first version added `Id` only when the sort was empty; the condition
became `Price < @value`, and walking 500 books in pages of 50 returned 475 distinct rows. With the tie-breaker: 500 of 500.
Page size is capped: `first: 100` failed with `HC0051` (maximum 50), and no `first` returned 10 rows.

Offset against cursor on 200,000 books (SQLite, HTTP and GraphQL included), medians: `skip: 0` 463 us, `skip: 190000` 12,655 us,
cursor after row 190000 410 us.

Offset reads and discards 190,000 rows; the cursor seeks `WHERE "b"."Id" > @value`. Version 16.7.6 has no `[UseOffsetPaging]`
(it does not compile), so offset paging is hand written with `Skip` and `Take`. Relative cursors for page bars are docs only.

### Limits against expensive queries

An exposed `IQueryable` plus nesting lets a client multiply work. With `gql.AddMaxExecutionDepthRule(4)`, which counts every
level and the leaf field, `{ authors(take:1) { books { author { books { author { name } } } } } }` got HTTP 400 and `The GraphQL
document has an execution depth of 6 which exceeds the max allowed execution depth of 4.`

With no call at all, a query nesting `books { author {` four times failed with `HC0087` (coordinate cycle depth, limit 3), in
Production and Development. Cost analysis is also on by default (`MaxFieldCost` 1000, `MaxTypeCost` 10,000) and the header
`GraphQL-Cost: validate` reports without executing. By the docs a field with a resolver weighs 10, multiplied by the list size:

```text
booksCtx(first:50) { nodes { title author { name } } }          field 511    type 102
authors(take:100)  { books { reviews { stars } } }  (plain)     field 30     type 4
same, with [ListSize] on authors, books and reviews             field 51010  type 105101
authors(take:3)    { books { reviews { stars } } }  (annotated) field 1540   type 3154
```

The plain line is the trap: `take: Int` is not a paging argument, so 100 x 5 x 3 objects cost 30. After `[ListSize(AssumedSize
= 100, SlicingArguments = ["take"])]` on `authors`, `[ListSize(AssumedSize = 50)]` on `books` and `[ListSize(AssumedSize = 20)]`
on `reviews`, the default limit rejects it with `HC0047`. The estimate is an assumption: `authors(take: 3)` returns 45 reviews
but costs 1540 and is rejected too. The 30 s timeout and the 64-execution gate are defaults from the docs, not exercised.

### Introspection and persisted operations

In a Production environment the server already refused introspection (`HC0046`, HTTP 400, while `{ __typename }` worked);
with `ASPNETCORE_ENVIRONMENT=Development` it answered. The docs show `.AllowIntrospection(false)` on the builder, which does
not compile in 16.7.6 (CS1061); `.DisableIntrospection()` does. It hides nothing: `/graphql/schema.graphql` returned 200 in
Production.

Trusted documents (`UsePersistedOperationPipeline`, a file storage, `OnlyAllowPersistedDocuments = true`) are the strong
control for your own clients. The file is named by the MD5 of the document in hex:

```text
{"query":"{ authors(take:2) { name } }"}   400 HC0067 Only persisted operations are allowed.
{"id":"f3a5024e30cb5496490d22f20b641c19"}  200 {"data":{"authors":[{"name":"Author 001"},...
{"id":"86UCTjDLVJZJDSLyC2QcGQ=="} (base64) 400 HC0012 The operation ID has an invalid format.
```

Automatic persisted queries (`UseAutomaticPersistedOperationPipeline`) only save bandwidth, they restrict nothing: hash only
gave `PersistedQueryNotFound` (400), hash plus query ran with `"persisted":true`, then hash only worked. A different query
claiming the stored hash ran with `"persisted":false` and left the stored one intact. The docs' example hash is base64; 16.7.6
expected hex. For a 41 byte document the id request was 42 bytes: the saving needs large documents.

### Partial errors against HTTP status

The response carries `data` and `errors`, and the HTTP status follows the media type the client accepts:

| Failure | No `Accept` | `application/json` | `application/graphql-response+json` |
| --- | --- | --- | --- |
| syntax, unknown field, bad variable | 400 | 200 | 400 |
| cost, depth, cycle or introspection rule | 400 | 200 | 400 |
| a resolver throws | 200 | 200 | 200 |
| `[Authorize]` fails | 200 | 200 | 200 |

A nullable field that throws becomes `null` and the rest survives (`"data":{"book":{"title":"Book 001-2","isbn":null}}` with
`Unexpected Execution Error` at `["book","isbn"]`). A throwing non-null field (`stock: Int!`) nulls the nearest nullable
parent: `"data":{"book":null}`. Exception messages are masked. Since a failure is often a 200, monitors that watch the status
miss it: count `errors` too. Request batching is off by default (`HC0009` on `[{...},{...}]`).

### Authorization

`[HotChocolate.Authorization.Authorize(Policy = "Admin")]` guards a field; `AddAuthorization()` is needed on both the
service collection and the GraphQL builder. No header gave `AUTH_NOT_AUTHENTICATED`; user `alice` on the policy field gave `AUTH_NOT_AUTHORIZED`; `root` got `{"me":"root","adminStats":500}`.
All HTTP 200. The ASP.NET Core `[Authorize]` is the wrong attribute and the v16 analyzer rejects it at build (`HC0106`).
`MapGraphQL().RequireAuthorization()` gates the endpoint: an anonymous request got 401, `schema.graphql` included.

### GraphQL against REST and Minimal APIs

The same 20 books with title, price and author name, then one author with books and reviews, against generic REST endpoints
that return entities, a tailored `/api/book-cards` endpoint and one GraphQL query:

```text
20 books + author name   REST returning entities  5 requests  10,128 bytes  5 SQL
                         REST tailored endpoint   1 request    1,201 bytes   1 SQL
                         GraphQL                  1 request    1,657 bytes   2 SQL (+76 bytes sent)
author + books + reviews REST per resource        7 requests   3,261 bytes   7 SQL
                         GraphQL                  1 request      734 bytes   3 SQL
```

The 400 character `Description` explains the 10 KB (repeated text, so gzip hides most of it). A tailored endpoint beat GraphQL
in bytes (nesting repeats the author) and latency (median 325 us against 1,239 us on loopback). GraphQL wins when many screens
need different shapes; its price is this lesson's machinery. See [Minimal APIs](minimal-apis-routing-and-route-groups) and
[output caching](output-caching-and-http-caching).

### State of the project (checked 2026-11-19)

The `ChilliCream/graphql-platform` repository is MIT, with 5,767 stars, 480 open issues, a commit on that same day, 16.7.6 on
2026-11-17 and 16.8.0 previews every few days; 15.1, 14.3 and 13.9 still got patches on 2026-11-10. Commits are concentrated (3,021 from the top
contributor, 1,083 from the next). The server packages say `MIT`, but `HotChocolate.AspNetCore` depends on
`ChilliCream.Nitro.App` 32.0.2, the bundled IDE, under the ChilliCream License 1.0 (royalty-free, no circumventing license-key
features, not an OSI license). "ChilliCream" is a registered trademark, and the docs mention Nitro telemetry with a
`DisableTelemetry` switch (docs only). Read the license before shipping.

Docs only, not run: Fusion (`HotChocolate.Fusion.AspNetCore`, a gateway over several GraphQL services, see
[API gateway](/system-design/system-design-concepts/api-gateway)), Apollo Federation, the Strawberry Shake client, `@defer`.

## Trade-offs

- **GraphQL vs Minimal APIs.** One typed endpoint and client-chosen shapes, at the price of cost control, N+1 vigilance and a 200
  that can hold errors. A stable set of screens is cheaper as a few tailored endpoints.
- **Exposed `IQueryable` vs explicit resolvers.** `[UseFiltering]` ships fast but turns the entity into a query language, joins
  and `contains` included. Declare filter types for the fields you index.
- **Cost analysis needs annotation.** Without `[ListSize]` it undercounts (30 instead of 51,010); with it, it overcounts.
- **Cursor vs offset.** Cursors need a unique sort and cannot jump to page 40 without relative cursors; offset is slow deep.
- **Public vs private API.** Public: cost, depth, timeout and page caps. Private: trusted documents.
- **Library health.** Fast MIT releases, one dominant maintainer, a non-MIT IDE package and generator errors in generated
  files: pin versions and read each migration page.

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
