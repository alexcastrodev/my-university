---
version: 1.0
updatedAt: 2026-11-14
---
## Objective

EF Core 10 could compute the distance between two vectors in a query. EF Core 11
adds the other half of vector search on SQL Server 2025: creating a vector index
from a migration, searching it with `VectorSearch()` and `WithApproximate()`, and
not loading the embedding column every time you load the entity. Together they
turn "order every row by distance" into "ask the index for the nearest few".

This concept covers the model, the two kinds of search (exact and approximate),
the warning EF raises when you forget the index, filtering, hybrid search with
full-text, and the limits. Every snippet was compiled and run against EF Core
11.0.0 on .NET 11.0.100. The SQL for SQL Server was generated offline with
`ToQueryString()` and `GenerateCreateScript()`, with no server and no data. That
proves what EF Core generates and not that a server accepts or ranks it well, and
it says nothing about recall. Anything that comes only from the documentation is
said to be so. `ef-core-functions-and-database-specific-translation` is the place
for `EF.Functions` in general, and `embeddings-and-vector-search-with-vectordata`
covers producing the embeddings.

## Use Cases

- Semantic search over articles, tickets or documents: "find the rows whose
  meaning is closest to this question".
- Retrieval for a RAG pipeline that already keeps its data in SQL Server, without
  a second database for the vectors.
- Combining similarity with ordinary columns, such as "similar, and published
  after January 1st 2026".
- Choosing between an exact search, which is always right and gets slower with the
  table, and an approximate one, which is fast and can miss a true neighbor.

## Deep Dive

### The model: a vector column and a vector index

An embedding is a `SqlVector<float>` (namespace `Microsoft.Data.SqlTypes`) mapped
to a `vector(n)` column. The dimension is not optional: without it model building
fails with `Vector property 'Article.Embedding' was not configured with the number
of dimensions. Set the column type to 'vector(x)'...`.

```csharp
public class Article
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime PublishedOn { get; set; }
    public SqlVector<float> Embedding { get; set; }
}

protected override void OnModelCreating(ModelBuilder b)
{
    b.Entity<Article>().Property(a => a.Embedding).HasColumnType("vector(1536)");

    b.Entity<Article>()
        .HasVectorIndex(a => a.Embedding, "IX_Articles_Embedding")
        .HasMetric("cosine")
        .HasType("DiskANN");
}
```

```sql
CREATE TABLE [Articles] (
    [Id] int NOT NULL IDENTITY,
    [Title] nvarchar(max) NOT NULL,
    [PublishedOn] datetime2 NOT NULL,
    [Embedding] vector(3) NOT NULL,
    CONSTRAINT [PK_Articles] PRIMARY KEY ([Id])
);
CREATE VECTOR INDEX [IX_Articles_Embedding] ON [Articles]([Embedding])
    WITH (METRIC = 'cosine', TYPE = 'DiskANN');
```

(The run above used `vector(3)` to keep the output short. Use the dimension of your
embedding model in real code.) Three details that were checked:

- The second argument of `HasVectorIndex` is the **index name**. The preview
  documentation shows `HasVectorIndex(b => b.Embedding, "cosine")`, and on 11.0.0
  that fails at model building with `Vector index ''cosine'' on entity type
  'Article' must specify a similarity metric. Call 'HasMetric' on the vector index
  builder.` The metric goes in `HasMetric`.
- `HasMetric` is required. `HasType` is not: without it the DDL simply has no
  `TYPE` clause and the server picks its default.
- `HasVectorIndex`, `VectorSearch` and `WithApproximate` are experimental APIs.
  The compiler reports **EF9105** until you suppress it
  (`<NoWarn>$(NoWarn);EF9105</NoWarn>` or a `#pragma`). That is a promise that
  they can still change, so keep the calls in one repository class.

### Exact search: VectorDistance

The EF Core 10 way still works and is still exact. It sorts by a scalar function,
so the server computes the distance for every row:

```csharp
var q = new SqlVector<float>(embeddingFromYourModel);

var nearest = await db.Articles
    .OrderBy(a => EF.Functions.VectorDistance("cosine", a.Embedding, q))
    .Take(5)
    .ToListAsync();
```

```sql
SELECT TOP(@p) [a].[Id], [a].[PublishedOn], [a].[Title]
FROM [Articles] AS [a]
ORDER BY VECTOR_DISTANCE('cosine', [a].[Embedding], @q)
```

`ToQueryString()` prints the parameter `@q` as the CLR type name
(`Microsoft.Data.SqlTypes.SqlVector`1[System.Single]`), which is a limit of that
method. The real command sends a vector. Notice that the vector index is not
involved: this is a scan, and it is the right tool for a few thousand rows, for
tests, and as the ground truth when you measure an approximate search.

### Approximate search: VectorSearch, Take and WithApproximate

`VectorSearch` is a table-valued function over the `DbSet`. It returns
`VectorSearchResult<T>`, a struct with the entity in `Value` and the distance in
`Distance`. Adding `Take(n).WithApproximate()` tells SQL Server to use the index:

```csharp
var hits = await db.Articles
    .VectorSearch(a => a.Embedding, q, "cosine")
    .OrderBy(r => r.Distance)
    .Take(5)
    .WithApproximate()
    .Select(r => new { r.Value.Title, r.Distance })
    .ToListAsync();
```

```sql
SELECT TOP(@p1) WITH APPROXIMATE [a].[Id], [a].[PublishedOn], [a].[Title], [v].[Distance]
FROM VECTOR_SEARCH(
    TABLE = [Articles] AS [a],
    COLUMN = [Embedding],
    SIMILAR_TO = @p,
    METRIC = 'cosine'
) AS [v]
ORDER BY [v].[Distance]
```

Without `WithApproximate()` the same query has `SELECT TOP(@p1)` and runs as an
exact brute-force search over the same function. The rules EF enforces, each seen
as an `InvalidOperationException` on 11.0.0:

- `VectorSearch` exists only on a `DbSet<T>`, so it has to be the first operator of
  the query. Filters come after it and refer to the entity as `r.Value`.
- `WithApproximate()` must come after `Take()`: `WithApproximate() must be called
  after Take() to specify the number of results.`
- `Skip(5).Take(5).WithApproximate()` is rejected (`Use Take().WithApproximate().Skip()
  instead, or remove Skip()`). The accepted order wraps the approximate query in a
  subselect and applies `OFFSET` outside it, so paging is a window over the top
  `n`, not a deeper search.

### The warning for forgetting the index

Because the exact form compiles and returns correct rows, the mistake is easy to
make and slow to notice. EF logs a warning for it:

```text
warn: SqlServerEventId.VectorSearchWithoutApproximateIndexWarning[30006] (Microsoft.EntityFrameworkCore.Query)
      The query uses 'VectorSearch' on property 'Embedding' of entity type 'Article',
      but 'WithApproximate()' was not specified. The query will perform an exact
      brute-force search instead of using a vector index. Call 'WithApproximate()'
      after 'Take()' to use the vector index for better performance.
```

The warning exists only when the model declares a vector index on that column.
With no `HasVectorIndex` in the model, nothing is logged, because there is no
index the query could have used. If you do want brute force somewhere, ignore the
event; if you never do, make it an error and your tests will catch the missing
call:

```csharp
options.ConfigureWarnings(w => w.Throw(SqlServerEventId.VectorSearchWithoutApproximateIndexWarning));
// InvalidOperationException: An error was generated for warning
// 'Microsoft.EntityFrameworkCore.Query.VectorSearchWithoutApproximateIndexWarning': ...
```

`Throw` was run on 11.0.0 and fails as shown. The event lives in
`Microsoft.EntityFrameworkCore.Diagnostics`.

### Combining similarity with ordinary filters

Filters go after `VectorSearch`, on `r.Value`:

```csharp
db.Articles
    .VectorSearch(a => a.Embedding, q, "cosine")
    .Where(r => r.Value.PublishedOn >= new DateTime(2026, 1, 1))
    .OrderBy(r => r.Distance)
    .Take(5)
    .WithApproximate();
```

EF puts the `WHERE` in the same `SELECT` as `TOP(@p1) WITH APPROXIMATE`:

```sql
SELECT TOP(@p1) WITH APPROXIMATE ... FROM VECTOR_SEARCH(...) AS [v]
WHERE [a].[PublishedOn] >= '2026-01-01T00:00:00.0000000'
ORDER BY [v].[Distance]
```

What SQL Server does with that is not something an offline run can show: whether
the predicate narrows the candidates before the index is searched or trims the
nearest `n` afterwards decides whether you can get fewer than `n` rows back. The
SQL Server documentation for `VECTOR_SEARCH` is the authority. Test it with a very
selective filter on your data and count the rows.

### Hybrid search: full-text plus vector

Vector search finds meaning, and full-text search finds the exact words, so
combining them covers both. The shape is the one from the EF Core 11 documentation:
take the top `k` of each list, `FullJoin` them so a row that only one side found
still survives, and compute a combined score. This version compiles and
translates on 11.0.0 (the full-text half is in `full-text-search-with-ef-core`):

```csharp
int k = 60;
var results = db.Articles
    .FreeTextTable<Article, int>("entity framework", null, null, k)
    .Join(db.Articles, f => f.Key, a => a.Id, (f, a) => new { Article = a, f.Rank })
    .FullJoin(
        db.Articles.VectorSearch(a => a.Embedding, q, "cosine")
            .OrderBy(r => r.Distance).Take(k).WithApproximate(),
        f => f.Article.Id,
        v => v.Value.Id,
        (f, v) => new
        {
            Article = f != null ? f.Article : v.Value,
            FullTextRank = f == null ? null : (int?)f.Rank,
            VectorDistance = v.Value == null ? null : (double?)v.Distance
        })
    .Select(x => new
    {
        x.Article.Title,
        Score = (x.FullTextRank == null ? 0.0 : 1.0 / (k + x.FullTextRank.Value))
              + (x.VectorDistance == null ? 0.0 : 1.0 / (k + x.VectorDistance.Value))
    })
    .OrderByDescending(x => x.Score)
    .Take(10);
```

The SQL is one statement, with the full-text function on the left and the
approximate search as a derived table on the right:

```sql
FROM FREETEXTTABLE([Articles], *, @p, @p1) AS [f]
INNER JOIN [Articles] AS [a0] ON [f].[KEY] = [a0].[Id]
FULL JOIN (
    SELECT TOP(@p3) WITH APPROXIMATE [a1].[Id], ..., [v].[Distance]
    FROM VECTOR_SEARCH(TABLE = [Articles] AS [a1], COLUMN = [Embedding],
        SIMILAR_TO = @p2, METRIC = 'cosine') AS [v]
    ORDER BY [v].[Distance]
) AS [v0] ON [a0].[Id] = [v0].[Id]
```

Two corrections to the documentation sample, found by compiling it. The line
`vs == null` does not compile because `VectorSearchResult<T>` is a struct (error
CS0019), so the test above is `v.Value == null`. And `FreeTextTable` here needs its
key type spelled out (`<Article, int>`), because the compiler cannot infer it.

The score is your decision. The documentation names the idea reciprocal rank
fusion, which is defined over the **position** of a row in each list (1, 2, 3).
The sample feeds in the full-text rank score and the vector distance instead, so
what it computes is a blend heuristic and not the textbook formula. The two
numbers also run in opposite directions (a higher full-text rank is better, a
higher distance is worse). Pick a combination, then judge it with queries whose
right answers you know.

### The embedding is no longer loaded with the entity

EF Core 11 leaves `SqlVector<T>` columns out of the `SELECT` when it materializes
an entity:

```csharp
db.Articles.OrderBy(a => a.Title).ToList();
// SELECT [a].[Id], [a].[PublishedOn], [a].[Title] FROM [Articles] AS [a] ORDER BY [a].[Title]

db.Articles.Select(a => new { a.Id, a.Embedding }).ToList();
// SELECT [a].[Id], [a].[Embedding] FROM [Articles] AS [a]
```

A 1,536-float embedding is about 6 KB, so a page of 50 articles stops dragging
300 KB of numbers you never read. The documentation reports a nine-fold speedup
against a local database and about twenty-two-fold against a remote Azure SQL
database on its benchmark (documentation figures, not measured here). The column
still works in `WHERE`, `ORDER BY`, `VectorDistance` and `VectorSearch`. The thing
to remember is the other side: an entity loaded this way has `Embedding` at its
default value, which means "not loaded" and not "empty in the database". To read
the vector, project it explicitly.

## Trade-offs

- **Exact against approximate.** Exact is always right and costs time in proportion
  to the table. Approximate is fast and may skip a true nearest neighbor. To know
  how often, run the same questions both ways and compare the top `n`. EF will not
  tell you.
- **Experimental on both sides.** The documentation marks `VECTOR_SEARCH` and vector
  indexes as experimental in SQL Server, and EF marks its API with EF9105. Plan
  for a rename, hide the calls in one place, and check the preview requirements of
  your SQL Server edition in the server documentation.
- **The schema is tied to the embedding model.** `vector(1536)` is a decision
  about one model. Changing to a model with other dimensions means a new column
  and a new index, and re-embedding the whole table.
- **Only SQL Server 2025 and Azure SQL.** `VectorSearch` and `HasVectorIndex` are
  SQL Server provider extensions. A model that uses them does not run on SQLite,
  and PostgreSQL has a different route (pgvector through the Npgsql provider,
  not covered here).
- **Offline SQL is not relevance.** `ToQueryString()` proves the translation. Only
  a real server with real embeddings proves that the results are good.
- **A hybrid score is a product decision.** The two rankings do not share a scale,
  so any formula that merges them has to be tuned and tested like any other
  relevance setting.

## Documentation Links

- [Vector search, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/vector-search) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [VECTOR_SEARCH, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/vector-search-transact-sql) (doc)
- [CREATE VECTOR INDEX, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-vector-index-transact-sql) (doc)
- [FREETEXTTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/freetexttable-transact-sql) (doc)
