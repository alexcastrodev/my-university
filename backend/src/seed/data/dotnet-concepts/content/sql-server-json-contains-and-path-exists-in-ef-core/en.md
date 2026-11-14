---
version: 1.0
updatedAt: 2026-11-14
---
## Objective

EF Core has stored collections as JSON for several versions: a `List<string> Tags`
becomes one column holding `["ef-core","sql"]`, and a complex type can live in a
JSON column too. Querying them used to mean `OPENJSON`, which expands the whole
array into rows to answer "is this value in there?". SQL Server 2025 added
`JSON_CONTAINS`, and EF Core 11 uses it in two ways: automatically, for the LINQ
`Contains` you already write, and explicitly, through `EF.Functions.JsonContains`
and `EF.Functions.JsonPathExists`.

The part that decides whether you benefit is not the function, it is *when* EF
chooses it. This concept shows the exact conditions, found by generating the SQL
for each variation on EF Core 11.0.0. All SQL here was generated offline with
`ToQueryString()`, with no server, so it proves the translation and says nothing
about speed or about what a server returns. The storage side (JSON columns, complex
types, JSON indexes) is in `json-columns-and-complex-types`.

## Use Cases

- Filtering rows by a tag, role or permission kept in a JSON array.
- Asking whether an optional property exists in a JSON document.
- Querying a JSON document mapped to a complex type.
- Writing a JSON filter that the SQL Server 2025 JSON index can serve.

## Deep Dive

### Contains on a JSON collection, before and after

The model is an ordinary one. `Tags` and `Scores` are primitive collections, and
`Contact` is a complex type mapped to a JSON column:

```csharp
public class Blog
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<string> Tags { get; set; } = new();
    public List<int> Scores { get; set; } = new();
    public string? JsonData { get; set; }
    public Contact Contact { get; set; } = new();
}
public class Contact { public string City { get; set; } = ""; public List<string> Phones { get; set; } = new(); }

modelBuilder.Entity<Blog>().ComplexProperty(b => b.Contact, c => c.ToJson());
```

The same query is translated by the SQL Server compatibility level you configure.
At 160, which is the default of EF Core 11:

```csharp
db.Blogs.Where(b => b.Tags.Contains("ef-core"));
```

```sql
WHERE N'ef-core' IN (
    SELECT [t].[value]
    FROM OPENJSON([b].[Tags]) WITH ([value] nvarchar(max) '$') AS [t]
)
```

At 170, which is SQL Server 2025 (`o.UseSqlServer(cs, s => s.UseCompatibilityLevel(170))`):

```sql
WHERE JSON_CONTAINS([b].[Tags], N'ef-core') = 1
```

The same switch applies to `List<int>` (`JSON_CONTAINS([b].[Scores], 5) = 1`) and to a
collection inside a JSON complex type:

```sql
-- compat 160
WHERE N'123' IN (SELECT [p].[value] FROM OPENJSON(JSON_QUERY([b].[Contact], '$.Phones')) WITH ([value] nvarchar(max) '$') AS [p])
-- compat 170
WHERE JSON_CONTAINS(JSON_QUERY([b].[Contact], '$.Phones'), N'123') = 1
```

The new form does not unpack the array, and the documentation notes that it can use
a JSON index when one exists. Whether the optimizer does is a question for the
query plan on a real server, which an offline run cannot answer.

### The catch: a parameter keeps the old translation

`JSON_CONTAINS` cannot search for a SQL `NULL`. So EF uses it only when it can tell
that the value being searched, or the elements of the collection, cannot be null.
Everything else falls back to `OPENJSON`. At compat level 170 each variation gave:

| The search value | Translation |
|---|---|
| a constant: `Tags.Contains("ef-core")` | `JSON_CONTAINS` |
| a local variable: `Tags.Contains(tag)` | `OPENJSON` |
| a required column: `Tags.Contains(b.Name)` | `JSON_CONTAINS([b].[Tags], [b].[Name]) = 1` |
| a nullable column: `Tags.Contains(b.Nick)` | `OPENJSON` |
| a constant on `List<string?>` | `JSON_CONTAINS` |
| `MaybeTags.Contains(null)` | `EXISTS (... OPENJSON ... WHERE [m].[value] IS NULL)` |

The variable row is the one that matters in practice. A search box, an API
parameter or a method argument all reach EF as a parameter whose value is only
known when the query runs, so the query is translated once for every possible value
and `NULL` is one of them. Declaring the variable as a non-nullable `string` did not
change that, and wrapping it in `EF.Constant(tag)` embedded the literal but still
produced `OPENJSON`. So the "free" upgrade covers constants and required columns,
and not the typical user-supplied value. For that case there is a way out.

### EF.Functions.JsonContains

When you call the function yourself, you choose the form and EF does not second-guess
the nullability:

```csharp
// a value at a path
db.Blogs.Where(b => EF.Functions.JsonContains(b.JsonData!, 8, "$.Rating") == 1);

// a parameter against a primitive collection, which Contains would not translate
db.Blogs.Where(b => EF.Functions.JsonContains(b.Tags, tag) == 1);
```

```sql
WHERE JSON_CONTAINS([b].[JsonData], 8, N'$.Rating') = 1
WHERE JSON_CONTAINS([b].[Tags], @tag) = 1
```

The arguments are the JSON, the value to look for, an optional path (`"$.Rating"`)
and an optional search mode, passed through as an `int?` (`..., N'$.tag', 1)`). The
function returns an `int`, so the comparison with `1` is yours to write. Three
things from running it:

- It is an **experimental** API. The compiler reports **EF9106** until you
  suppress it, which is a warning that the signature can change.
- It is **not gated by the compatibility level**. At level 160 EF generated
  `JSON_CONTAINS` all the same, so against a server older than 2025 the query
  compiles and then fails at run time.
- Because `JSON_CONTAINS` does not find `NULL`, a call that passes a `null` value
  does not mean "contains a null". Handle that case in your own code.

### EF.Functions.JsonPathExists

`JsonPathExists` asks whether a path is present in a JSON document, which is a
different question from whether the value at that path is something specific:

```csharp
db.Blogs.Where(b => EF.Functions.JsonPathExists(b.JsonData!, "$.OptionalInt"));
db.Blogs.Where(b => EF.Functions.JsonPathExists(b.Contact, "$.City"));
```

```sql
WHERE JSON_PATH_EXISTS([b].[JsonData], N'$.OptionalInt') = 1
WHERE JSON_PATH_EXISTS([b].[Contact], N'$.City') = 1
```

It returns a `bool`, so no `== 1`, and it accepts a string column holding JSON as
well as a complex type mapped to JSON. It is not marked experimental: the same
project compiled without suppressing any diagnostic when only `JsonPathExists` was
used. `JSON_PATH_EXISTS` has been in SQL Server since 2022, according to the
documentation, so it works at the default level. How a JSON `null` at the path is
treated is a SQL Server detail to read in its documentation, and it was not run
here.

## Trade-offs

- **The compatibility level is your promise about the server.** EF cannot detect the
  version. Set 170 only when every environment runs SQL Server 2025 or Azure SQL
  with the feature, including the CI database. A wrong level breaks at run time or
  silently keeps the slower SQL. Pin it explicitly, as the upgrade concept advises.
- **Most of the gain needs a constant or a required column.** For a user-supplied
  value you choose between `OPENJSON` (portable, any value) and an explicit
  `JsonContains` (shorter SQL, experimental API, your own null handling). Measure
  with a JSON index in place before deciding that it matters.
- **Two translations can disagree about `NULL`.** `Contains(null)` goes through
  `OPENJSON` and finds JSON nulls, while `JSON_CONTAINS` cannot. That is why EF
  refuses the fast path when it is unsure, and why a hand-written call needs care.
- **A JSON array is still not a join table.** For a hot filter on "rows that have
  tag X" over a large table, a child table with an ordinary index remains the most
  predictable design. `JSON_CONTAINS` with a JSON index narrows the gap, but it is a
  new SQL Server 2025 feature and the index is a recent addition to EF.
- **Offline SQL proves translation, not speed.** Check the plan and the timing on a
  real SQL Server 2025 before you move a query to the new form.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [JSON_CONTAINS, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/json-contains-transact-sql) (doc)
- [JSON_PATH_EXISTS, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/functions/json-path-exists-transact-sql) (doc)
- [CREATE JSON INDEX, Transact-SQL, Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-json-index-transact-sql) (doc)
- [Complex types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/complex-types) (doc)
