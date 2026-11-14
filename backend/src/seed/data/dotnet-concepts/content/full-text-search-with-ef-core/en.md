---
version: 1.0
updatedAt: 2026-11-14
---
## Objective

`Where(a => a.Body.Contains("framework"))` becomes `LIKE '%framework%'`. That
scans the table, ignores word forms and gives you no order of relevance. Full-text
search is the database feature built for that job, and EF Core 11 makes the SQL
Server side of it much more usable: the catalog and the index can live in the
model and be created by migrations, and the table-valued functions `FREETEXTTABLE`
and `CONTAINSTABLE` return a rank you can sort by.

This concept shows the same feature on three engines, because the code is not
portable between them: SQL Server (EF Core 11), PostgreSQL (the Npgsql provider)
and SQLite (FTS5 through raw SQL). Which parts were run matters, so here it is.
The SQLite section was **executed** on EF Core 11.0.0 with real rows. The SQL
Server and PostgreSQL SQL was **generated offline** (`ToQueryString()` and
`GenerateCreateScript()`, no server), which proves what EF generates and not what
a server returns. The PostgreSQL run used the Npgsql 11.0.0-rc.3 build, the newest
on NuGet on November 14, 2026. The general `EF.Functions` rules are in
`ef-core-functions-and-database-specific-translation`.

## Use Cases

- A search box over articles, tickets, products or documents where "framework"
  should also find "Frameworks".
- Showing the best matches first, with a score to sort by.
- Prefix search, exact phrases and "this word but not that one".
- Combining the exact words (full-text) with the meaning (vectors) in one query,
  see `ef-core-vector-search-with-sql-server-2025`.

## Deep Dive

### SQL Server: the catalog and the index belong in the model

Until EF Core 10 the full-text catalog and index were hand-written SQL in a
migration. EF Core 11 models them:

```csharp
modelBuilder.HasFullTextCatalog("ftCatalog");

modelBuilder.Entity<Article>()
    .HasFullTextIndex(a => new { a.Title, a.Body })
    .UseKeyIndex("PK_Articles")
    .UseCatalog("ftCatalog");
```

```sql
CREATE FULLTEXT CATALOG [ftCatalog];

CREATE FULLTEXT INDEX ON [Articles]([Title], [Body])
    KEY INDEX [PK_Articles] ON [ftCatalog];
```

Two things came out of running it on 11.0.0:

- `UseKeyIndex` is required. Without it model building fails with `Full-text
  index '{'Title'}' on entity type 'Article' does not have a KEY INDEX
  configured. SQL Server requires a KEY INDEX for every full-text index.` Per the
  SQL Server documentation the key index must be a unique, single-column,
  non-nullable index, and the primary key is the usual choice.
- **The columns turn into `nvarchar(450)`.** `Title` and `Body` are `nvarchar(max)`
  by default, and as soon as they are in the full-text index the generated DDL
  says `nvarchar(450)`. That is the SQL Server convention for any indexed string
  property (a plain `HasIndex(x => x.Title)` does the same). For a title it is
  harmless. For an article body it is a silent 450-character limit. Say what you
  mean:

```csharp
e.Property(a => a.Body).HasColumnType("nvarchar(max)");
```

With that line the DDL keeps `nvarchar(max)` and the same `CREATE FULLTEXT INDEX`.
The SQL Server Full-Text Search component also has to be installed on the server,
and its availability varies by edition and hosting, so check yours.

### SQL Server: predicates that filter

`EF.Functions.FreeText` and `EF.Functions.Contains` have existed for a long time.
They return a Boolean for `Where`:

```csharp
db.Articles.Where(a => EF.Functions.FreeText(a.Title, "entity framework"));
db.Articles.Where(a => EF.Functions.Contains(a.Title, "\"entity*\" AND \"core\""));
```

```sql
WHERE FREETEXT([a].[Title], N'entity framework')
WHERE CONTAINS([a].[Title], N'"entity*" AND "core"')
```

`FreeText` takes plain words and lets the engine expand them into word forms.
`Contains` takes a search condition with its own syntax: quoted phrases,
`AND`/`OR`/`NOT`, and `*` for a prefix. Neither gives you a score, so you cannot
sort by relevance with them.

### SQL Server: ranking with FreeTextTable and ContainsTable

The new functions are table-valued: they return rows of key and rank, and you
join them back to your table.

```csharp
var results = await db.Articles
    .FreeTextTable<Article, int>("entity framework", a => a.Title)
    .Join(db.Articles, f => f.Key, a => a.Id, (f, a) => new { a.Title, f.Rank })
    .OrderByDescending(x => x.Rank)
    .ToListAsync();
```

```sql
SELECT [a0].[Title], [f].[RANK] AS [Rank]
FROM FREETEXTTABLE([Articles], [Title], @p) AS [f]
INNER JOIN [Articles] AS [a0] ON [f].[KEY] = [a0].[Id]
ORDER BY [f].[RANK] DESC
```

`ContainsTable<Article, int>(searchCondition, column, language, topN)` has the
same shape, with the `"entity*" AND "core"` syntax. The optional arguments are
the column (`null` searches all indexed columns and emits `*`), a language term
and a `topN` that SQL Server applies inside the function:

```csharp
db.Articles.FreeTextTable<Article, int>("entity framework", null, "English", 5)
```

```sql
FROM FREETEXTTABLE([Articles], *, @p, LANGUAGE N'English', @p1) AS [f]
```

The result type is `FullTextSearchResult<TKey>`, a struct with exactly `Key` and
`Rank` (an `int`). It does not carry the entity. The EF Core 11 documentation
sample reads `r.Value` from it, and that does not compile on 11.0.0, so the join
back by key shown above is the working form. The key type has to be written out
(`<Article, int>`), because the compiler cannot infer it.

### PostgreSQL: a tsvector column and a GIN index

Npgsql models full-text search as a generated `tsvector` column, an index on it,
and query operators:

```csharp
modelBuilder.Entity<Article>()
    .HasGeneratedTsVectorColumn(a => a.SearchVector, "english", a => new { a.Title, a.Body })
    .HasIndex(a => a.SearchVector).HasMethod("GIN");

var q = EF.Functions.WebSearchToTsQuery("english", "entity framework -dapper");
db.Articles.Where(a => a.SearchVector.Matches(q))
           .OrderByDescending(a => a.SearchVector.Rank(q));
```

```sql
"SearchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "Title" || ' ' || "Body")) STORED NOT NULL
CREATE INDEX "IX_Articles_SearchVector" ON "Articles" USING GIN ("SearchVector");

WHERE a."SearchVector" @@ websearch_to_tsquery('english', 'entity framework -dapper')
ORDER BY ts_rank(a."SearchVector", websearch_to_tsquery('english', 'entity framework -dapper')) DESC
```

`websearch_to_tsquery` accepts the syntax people type in a search box (quoted
phrases, `-word`) and, per the PostgreSQL documentation, does not raise syntax
errors, which makes it the safest entry point for user text. The
language ('english') decides the stemming and the stop words, and it has to match
the language of the content. Everything here is offline SQL.

### SQLite: FTS5, with a virtual table and raw SQL

SQLite has no EF mapping for full-text search, but the engine has FTS5 built in. EF
Core's part is to run your SQL. The table is an *external content* FTS5 table
that points at `Articles`, kept in step by three triggers (the one for updates
deletes the old row from the index and inserts the new one):

```sql
CREATE VIRTUAL TABLE ArticlesFts USING fts5(
    Title, Body, content='Articles', content_rowid='Id',
    tokenize='unicode61 remove_diacritics 2');

CREATE TRIGGER Articles_ai AFTER INSERT ON Articles BEGIN
  INSERT INTO ArticlesFts(rowid, Title, Body) VALUES (new.Id, new.Title, new.Body);
END;
CREATE TRIGGER Articles_ad AFTER DELETE ON Articles BEGIN
  INSERT INTO ArticlesFts(ArticlesFts, rowid, Title, Body)
  VALUES ('delete', old.Id, old.Title, old.Body);
END;
-- Articles_au (AFTER UPDATE): the same 'delete' row, then the new INSERT
```

In a real project that SQL goes in a migration with `migrationBuilder.Sql(...)`,
because the model never sees `ArticlesFts`. (This run created it with
`ExecuteSql` after `EnsureCreated`.) The query is `SqlQuery<T>` over a join,
ordered by `bm25`:

```csharp
public record Hit(int Id, string Title, double Score);

var hits = db.Database.SqlQuery<Hit>($"""
    SELECT a.Id AS Id, a.Title AS Title, -bm25(ArticlesFts, 10.0, 1.0) AS Score
    FROM ArticlesFts
    JOIN Articles AS a ON a.Id = ArticlesFts.rowid
    WHERE ArticlesFts MATCH {match}
    ORDER BY bm25(ArticlesFts, 10.0, 1.0)
    """).ToList();
```

`bm25` returns a negative number where lower is better, so the query sorts
ascending and negates it for display. The two weights make a hit in `Title` count
ten times a hit in `Body`. With 44 articles in the table (four real ones and 40
filler rows), the run printed:

| `MATCH` | Result (score) |
|---|---|
| `entity framework` | 1 "Entity Framework Core 11" (11.058), 3 "Dapper versus EF Core" (5.962) |
| `entit*` (prefix) | the same two rows, 1 first |
| `"entity framework"` (phrase) | the same two rows |
| `core NOT dapper` | only 1 |
| `title:core` (one column) | 3 (5.620), 1 (5.529) |
| `configuracao` | "Configuração do banco" (6.679), thanks to `remove_diacritics` |

Four behaviors to know before shipping:

- **The triggers are not optional.** An external-content table does not follow the
  table it points at. Counting hits directly on the virtual table
  (`SELECT count(*) FROM ArticlesFts WHERE ArticlesFts MATCH 'pasta'`), an
  `ExecuteDelete` of the article took the count from 1 to 0 with the delete
  trigger in place, and from 1 to **1** without it. The stale entry stays in the
  index, and the `JOIN` back to `Articles` is what hides it from the query above.
  Bulk operations such as `ExecuteDelete` and `ExecuteUpdate` skip the change
  tracker, but not database triggers, which is why triggers are the right layer.

- **Tiny tables score zero.** In the first run the table had only four rows, every
  term appeared in half of them, and every `bm25` score printed `0.000`. Scores
  need a corpus. The ordering above appeared only after the filler rows.
- **`MATCH` has its own syntax, and bad input throws.** Passing `entity AND` from
  a search box raised `SqliteException: SQLite Error 1: 'fts5: syntax error near
  ""'`. The fix that was tested is to turn user text into a phrase by wrapping it
  in double quotes and doubling any inner quote:
  `static string Quote(string s) => "\"" + s.Replace("\"", "\"\"") + "\"";`.
  `Quote("entity AND")` returned no rows and no exception, and a hostile input
  (`a" OR "b`) became the harmless phrase `"a"" OR ""b"`. The price is that users
  lose operators and prefixes unless you add them yourself.
- **It is not `LIKE`.** `EF.Functions.Like(a.Body, "%framework%")` matched one row
  by raw substring in `Body`, with no ranking and no index. FTS5 matched two rows
  because it searched `Title` and `Body` and tokenized the words.

SQL Server has the same kind of trap. `CONTAINS` expects a valid search condition
and fails on a malformed one, while `FREETEXT` is more forgiving. That comes from
the SQL Server documentation and was not run here.

## Trade-offs

- **Three engines, three APIs.** Nothing in this concept is portable. A feature
  that must run on SQL Server and PostgreSQL needs an interface of your own with
  two implementations, or a search service outside the database.
- **The index is not instant everywhere.** SQL Server populates a full-text index
  with its own process, so a row inserted a moment ago may not be searchable
  immediately (documented SQL Server behavior, not run here). Triggers and
  generated columns, as in the SQLite and PostgreSQL examples, keep the index
  transactional with the write.
- **Language is part of the index.** Stemming and stop words depend on the
  language you configure. A Portuguese catalog searched with English settings
  works badly in ways that look like "search is flaky".
- **Scores are not comparable.** SQL Server's rank, PostgreSQL's `ts_rank` and
  SQLite's `bm25` use different scales, so a threshold such as "rank above 50" is
  meaningful on one engine only. Sort by them, do not hard-code them.
- **`nvarchar(450)` can truncate or reject data.** Review the DDL of any entity
  you add to a full-text index.
- **When the database is not enough.** Typo tolerance, facets and synonyms across
  millions of documents are what dedicated engines such as Meilisearch or
  Elasticsearch are for, at the cost of a second copy of the data to keep in sync
  (`full-text-and-vector-search-indexes` in the system design track compares the
  two approaches).

## Documentation Links

- [Full-text search, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/full-text-search) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [FREETEXTTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/freetexttable-transact-sql) (doc)
- [CONTAINSTABLE, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/containstable-transact-sql) (doc)
- [Full-text search, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/mapping/full-text-search.html) (doc)
- [SQLite FTS5 extension](https://www.sqlite.org/fts5.html) (doc)
