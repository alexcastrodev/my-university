---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

A LINQ query only runs in the database if every method inside it has a known SQL
translation. Most do, because EF Core maps a large set of `string`, `Math` and
`DateTime` members for each provider. For the rest, EF Core offers `EF.Functions`,
a catalogue of methods that exist only to be turned into SQL (`Like`, `Random`,
`Collate`, `DateDiffDay` and so on), and a way to map your own methods to database
functions. This concept explains how that translation works, runs the common
functions on SQLite to see the SQL and the surprises (case sensitivity, wildcards in
user input), and shows how to tell portable translation from provider-specific
translation before it bites in production.

## Use Cases

- A search box that should match part of a product name.
- A quiz or sampling feature that needs a few random rows.
- A report that needs `DATEDIFF` or full-text search, which LINQ has no operator for.
- Moving a code base from SQLite in tests to SQL Server or PostgreSQL in production
  and wanting to know which queries will change behavior.

## Deep Dive

### A method with no body

`EF.Functions` returns a `DbFunctions` instance, and the methods hanging off it are
extension methods that only a database provider can interpret. They are not
implemented in .NET. The official remarks for `Like` and `Random` state that there is
no in-memory implementation and that the call throws if the query switches to
client evaluation. I reproduced it by calling `EF.Functions.Like` after
`AsEnumerable()`:

```
InvalidOperationException: The 'Like' method is not supported because the query has
switched to client-evaluation. ...
```

This is a useful mental model. A query is translated as far as EF Core can go. A
method it does not recognize inside `Where` makes the whole query fail with `could
not be translated`. The same unknown method in the last `Select` is allowed, because
the database can return the plain columns and .NET applies the method afterwards:

```csharp
db.Products.Where(p => Helpers.Slug(p.Name) == "chai")   // throws: not translatable
db.Products.Select(p => Helpers.Slug(p.Name))            // SQL selects only "Name"
```

The second query logged `SELECT "p"."Name" FROM "Products" AS "p"`, then ran `Slug` on
each value in memory. That works, but it moves the filtering cost into your process,
so it is worth noticing when it happens.

### LIKE and the other ways to match text

All data below comes from a SQLite database with a product named `Chai`. The same
question, written five ways, gives different answers:

```csharp
Where(p => p.Name == "CHAI")                              // no row
Where(p => EF.Functions.Like(p.Name, "CHAI"))             // Chai
Where(p => p.Name.Contains("HAI"))                        // no row
Where(p => p.Name.StartsWith("CH"))                       // Chai, Chef Anton's ...
Where(p => EF.Functions.Collate(p.Name, "NOCASE") == "chai")  // Chai
```
```sql
WHERE "p"."Name" = 'CHAI'
WHERE "p"."Name" LIKE 'CHAI'
WHERE instr("p"."Name", 'HAI') > 0
WHERE "p"."Name" LIKE 'CH%'
WHERE "p"."Name" COLLATE NOCASE = 'chai'
```

On SQLite `==` and `Contains` (translated to `instr`) are case-sensitive, while `LIKE`
and `StartsWith` (translated to `LIKE 'CH%'`) are case-insensitive, but only for ASCII:
`Like(p.Name, "GUMBÄR%")` did not match `Gumbär Gummibärchen`. The `Like` API remarks
say the same thing in general terms: case sensitivity depends on the database
configuration. On SQL Server the outcome depends on the column collation, and
PostgreSQL's `LIKE` is case-sensitive, which is why the Npgsql provider adds
`EF.Functions.ILike`. A test suite on SQLite therefore proves little about string
matching on another engine. When you need a case rule independent of defaults, state
it: `EF.Functions.Collate(...)` or an explicit `ToLower()` comparison.

### Wildcards in user input

`Like` takes a pattern, and the characters `%`, `_`, `[`, `]` and `^` may act as
wildcards (the exact set varies by database). If the pattern comes from a user, the
user controls the wildcards. This is not SQL injection, because the value still travels
as a parameter (`LIKE @Format`), but it changes the result:

```csharp
var input = "50%";
Where(p => EF.Functions.Like(p.Name, $"%{input}%"))
// @Format '%50%%'  =>  "50% Off Tea" and "500 Tea Bags"
```

The percent sign matched the second row. Escape the input and pass an escape
character:

```csharp
var escaped = input.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
Where(p => EF.Functions.Like(p.Name, $"%{escaped}%", "\\"))
// @Format '%50\%%' ESCAPE '\'  =>  "50% Off Tea"
```

An input of `_` behaved the same way: `Tea{u}X` with `u = "_"` matched both `Tea_X` and
`TeaZX`. The pattern shape also matters for speed. On most engines a pattern with a
leading wildcard (`%che%`) cannot use an ordinary index, while a prefix pattern
(`che%`) can, so a "contains" search over a large table usually needs full-text
search instead.

Also visible in the output: EF Core 10 names the parameter after the argument
(`@Format`), not `@__Format_1` as older logs and books show, because the release
simplified parameter names.

### Random rows

`EF.Functions.Random()` exists since EF Core 6 and returns a double between 0 and 1,
exclusive. On SQLite it became:

```sql
ORDER BY abs(random() / 9.2233720368547799E+18)
LIMIT @p
```

The SQL Server provider page maps it to `RAND()`, and the Npgsql page to `random()`.
Ordering by a random value reads and sorts every row to return a few, so it suits
small tables, tests and sampling, not a hot path on millions of rows. The filter form
`Where(p => EF.Functions.Random() > 0.5)` keeps roughly half of the rows, a different
half on every execution.

### Single, First and the SQL they ask for

The book also covers getting a single entity. Logging the three commands showed the
difference:

```sql
-- Single           ... WHERE "p"."Id" = 1  LIMIT 2
-- First            ... WHERE "p"."Id" = 1  LIMIT 1
-- SingleOrDefault  ... WHERE "p"."Id" = 1  LIMIT 2
```

`Single` asks for two rows so it can detect a duplicate and throw. If you do not need
that guarantee, `First` reads one.

### Portable translation versus provider-specific functions

The provider function pages are the source of truth. A few examples from them: the
SQLite page lists `EF.Functions.Glob`, `Collate` and `Regex.IsMatch` (to `REGEXP`,
which worked in my run); the SQL Server page lists `Contains` and `FreeText`
(full-text search), `DateDiffDay` to `DateDiffYear`, `IsDate`, `IsNumeric` and
`AtTimeZone`; the Cosmos provider has its own set, and there `EF.Functions.Like` is not
translated at all (my other concept shows the failure). Each list grows by version.
EF Core 10 added, for instance, `DateOnly.DayNumber` and microsecond and nanosecond
parts, so check the page for your provider before writing a workaround.

When no translation exists, you have a ladder: rewrite the query with an operator that
translates, map your own method, or write SQL.

```csharp
// map a CLR method to a database built-in function
public static int Instr(string text, string search) => throw new NotSupportedException();
modelBuilder.HasDbFunction(typeof(Db).GetMethod(nameof(Instr))!).HasName("instr").IsBuiltIn();
// Where(p => Db.Instr(p.Name, "Tea") > 0)  =>  WHERE instr("p"."Name", 'Tea') > 0
```

`IsBuiltIn()` matters on SQL Server, which requires user-defined functions to be
schema-qualified and built-in ones not to be. The same mechanism maps your own scalar
function, and a method returning `IQueryable<T>` can map to a table-valued function.
`HasTranslation` lets you build the SQL expression tree yourself, but the
documentation cautions that it is a low-level API tied to the provider.

## Trade-offs

- **A function that translates on one provider may not on another.** Moving tests to a
  different engine than production hides translation gaps, so run the queries that use
  `EF.Functions` against the real engine.
  ```csharp
  EF.Functions.Like(p.Name, "Tea%")   // fine on SQLite and SQL Server, not on Cosmos
  ```
- **LIKE is a pattern language, not a substring test.** Unescaped input changes what
  matches, so escape it or use `Contains` for plain substring searches.
  ```csharp
  EF.Functions.Like(p.Name, $"%{escaped}%", "\\")
  ```
- **Case sensitivity is a database setting.** The same predicate returns different rows
  by collation, so state the rule you want.
  ```csharp
  EF.Functions.Collate(p.Name, "NOCASE") == "chai"   // SQLite
  ```
- **Client evaluation in the last `Select` is silent.** It is correct but moves work
  into memory; inspect the SQL to see what was left out.
- **Provider-specific code locks you in.** `FreeText` or `DateDiffDay` only exists for
  SQL Server, so isolate such queries behind a repository or query class.
- **Random ordering is a full scan.** Fine for a quiz table, wrong for a big one.
- **Not run here.** Only SQLite was executed. The SQL Server, PostgreSQL and Cosmos
  mappings quoted above come from the official provider pages.

## Documentation Links

- [Function mappings, SQLite provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/functions) (doc)
- [Function mappings, SQL Server provider, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sql-server/functions) (doc)
- [User-defined function mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/user-defined-function-mapping) (doc)
- [DbFunctionsExtensions.Like, API reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.dbfunctionsextensions.like) (doc)
- [DbFunctionsExtensions.Random, API reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.dbfunctionsextensions.random) (doc)
- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Translations, Npgsql Entity Framework Core provider](https://www.npgsql.org/efcore/mapping/translations.html) (doc)
