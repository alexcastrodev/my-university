---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

LINQ covers most queries, and `FromSql` is the escape hatch for the rest. But
`FromSql` only returns entities, and many raw queries do not return entities:
a report that joins three tables, a list of ids, a row count, the output of a
view. This concept covers the other half of raw SQL in EF Core 10: `SqlQuery<T>`
for types that are not in the model, `ExecuteSql` for commands, and keyless
entity types for views and for queries that belong in the model. Every behavior
below was run on SQLite; the parameterization rules of `FromSql` and
`FromSqlRaw` are in the query translation concept and are not repeated.

## Use Cases

- A report row (`ProductName`, `CategoryName`, `Price`) that joins tables and
  matches no entity.
- Reading from a database view that the database team owns.
- A table with no primary key, such as a log, that you only read.
- A hot query that LINQ translates badly, written by hand but still composed with
  `Where` and `OrderBy`.
- A bulk statement that has no EF Core API.

## Deep Dive

### Entities with FromSql, and what it wraps

The model for the examples is `Product` (with a global filter on `IsDeleted`) and
`Category`. `FromSql` starts a query from a `DbSet` and treats your SQL as a
subquery that LINQ can compose over:

```csharp
var q = db.Products.FromSql($"SELECT * FROM Products WHERE Price > {min}")
    .Where(p => p.Name != "x").OrderBy(p => p.Name);
```
```sql
SELECT "p"."Id", "p"."CategoryId", "p"."IsDeleted", "p"."Name", "p"."Price"
FROM (
    SELECT * FROM Products WHERE Price > @p0
) AS "p"
WHERE NOT ("p"."IsDeleted") AND "p"."Name" <> 'x'
ORDER BY "p"."Name"
```

Three consequences are visible in that output. The global query filter is added
outside your SQL, so a hand-written `SELECT *` still hides deleted rows. Your SQL
must be valid inside parentheses: a trailing semicolon works for a plain `ToList()`
but any composed operator, even `Count()`, failed with `near ";": syntax error`.
And `FromSql` is an extension on `DbSet<T>` only; it does not compile after a
`Where`. Entities need every mapped column: `SELECT Id FROM Categories` failed
with "The required column 'Name' was not present in the results". The column names
must be the mapped ones, not the property names, which matters on a legacy database
with `HasColumnName`. `Include` works after `FromSql`: `.Include(p => p.Category)`
returned "Dune in Books".

### SqlQuery for types outside the model

`db.Database.SqlQuery<T>` returns an `IQueryable<T>` for a type EF Core knows
nothing about. For a scalar it reads the first column:

```csharp
var names = db.Database.SqlQuery<string>($"SELECT Name FROM Products ORDER BY Id").ToList();
```

Composing LINQ on top needs one rule: the column must be called `Value`, because
EF Core references it from the SQL it adds. Without the alias SQLite said
`no such column: s.Value`; with it:

```csharp
db.Database.SqlQuery<int>($"SELECT Id AS Value FROM Products").Where(i => i > 1)
```
```sql
SELECT "s"."Value"
FROM (
    SELECT Id AS Value FROM Products
) AS "s"
WHERE "s"."Value" > 1
```

For rows, give it any class or record with matching properties; it does not need
a table, a key or a registration:

```csharp
public class ProductRow { public string ProductName { get; set; } = ""; public string CategoryName { get; set; } = ""; public double Price { get; set; } }
public record CatCount(string Name, int Total);

db.Database.SqlQuery<ProductRow>($"""
    SELECT p.Name AS ProductName, c.Name AS CategoryName, p.Price
    FROM Products p JOIN Categories c ON c.Id = p.CategoryId
    WHERE p.IsDeleted = 0
    """).ToList();
```

The join returned the rows, the positional record `CatCount` was populated through
its constructor, and `ChangeTracker.Entries().Count()` stayed at 0: nothing is
tracked. If the type has a property that is not in the result, the call fails with
"The required column 'Other' was not present in the results". The reverse, a column
with no matching property, was silently ignored in my run (4 rows came back), so
a typo in a column alias can go unnoticed until the property is read as null or
zero.

`SqlQuery` starts from `db.Database`, not from a `DbSet`, so no global query filter
applies. The same `SELECT Name FROM Products` returned `Dune,Emma,Lego,Old` through
`SqlQuery<string>` and `Dune,Emma,Lego` through `FromSql`, because `Old` is
soft-deleted. Reports written with `SqlQuery` have to repeat the tenant and
soft-delete conditions by hand.

The docs also describe nested `[ComplexType]` classes inside `SqlQuery` results
(columns named `Address_City`). In my run on 10.0.13 that failed with "appears to
be a navigation to another entity type", so I would not rely on it yet.

### ExecuteSql for commands

`ExecuteSql` runs a statement that returns no rows and gives back the affected
count; interpolated values become parameters like in `FromSql`:

```csharp
var n = db.Database.ExecuteSql($"UPDATE Products SET Price = Price * 1.1 WHERE CategoryId = {cat.Id}");
// n == 2
```

Prefer `ExecuteUpdate` or `ExecuteDelete` when LINQ can express the change, because
they stay typed. `ExecuteSql` is for what LINQ cannot say, and for DDL such as the
`CREATE VIEW` the next section needs.

### Views and queries as keyless entities

When the same raw query is used again and again, put it in the model as a keyless
entity type. A view is the common case:

```csharp
b.Entity<CategoryStat>().HasNoKey().ToView("v_category_stats");
```
```sql
SELECT "v"."AvgPrice", "v"."CategoryId", "v"."CategoryName", "v"."ProductCount"
FROM "v_category_stats" AS "v"
WHERE "v"."ProductCount" > 1
```

Now `db.CategoryStats.Where(...)` composes as it does for any entity, and the
results are not tracked. `db.CategoryStats.Add(...)` followed by `SaveChanges`
throws "Unable to track an instance of type 'CategoryStat' because it does not
have a primary key", which is the design: keyless types are read-only. Mapping
with `ToView` also keeps the type out of the schema: `EnsureCreated` created
`Categories` and `Products` and no table for the view. The view itself is yours to
create, in a migration with `migrationBuilder.Sql(...)`. A table without a primary
key is mapped the same way with `HasNoKey().ToTable(...)`.

A keyless type can also be defined by a query in the model:

```csharp
b.Entity<ExpensiveItem>().HasNoKey().ToSqlQuery("SELECT Name, Price FROM Products WHERE Price > 25");
```

There is a trap. With `ToSqlQuery` alone, the create script generated by EF Core
10.0.13 still contained a `CREATE TABLE` for the keyless type (a one-property
`Item` type produced `CREATE TABLE "Items" ("Name" TEXT NOT NULL)`), because the
default table mapping stayed. Adding `.ToTable((string?)null)` removed it, and
`EnsureCreated` created no table for `ExpensiveItem`. Check the migration of any
type mapped this way before it reaches a real database.

### Stored procedures

SQLite has no stored procedures, so this part is from the documentation and was not
run here. `FromSql($"EXECUTE dbo.GetMostPopularBlogs")` works for procedures that
return entity columns, but SQL Server cannot compose over a procedure call; add
`AsEnumerable()` or `AsAsyncEnumerable()` right after `FromSql` so EF Core does not
try to wrap it in a subquery. A procedure that returns a custom shape goes through
`SqlQuery<T>` the same way.

## Trade-offs

- **Raw SQL is a contract with the schema that nothing checks.** A renamed column
  fails at runtime, on the first execution. Keep the queries next to tests that run
  against the real provider.
  ```csharp
  db.Database.SqlQuery<ProductRow>($"SELECT ...").ToList(); // test it once per query
  ```
- **`SqlQuery` skips global filters.** It is the right tool for reports, and the
  wrong one for anything that must respect soft delete or tenancy unless you add
  the condition yourself.
- **Keyless types are read-only on purpose.** No tracking, no `SaveChanges`, no
  relationships where they are the principal. Use them for reading and keep
  writes on real entities.
- **Views move logic out of the app.** The database team can change a view without
  a release, and your model finds out at runtime. In EF Core a `ToView` type is
  not part of the schema it creates, so the view's definition needs its own
  migration.
- **Provider specific SQL.** The `Value` alias rule is the same on every provider,
  but the rest of the text is dialect. A model tested only on SQLite does not prove the SQL Server
  or PostgreSQL version.

## Documentation Links

- [SQL queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/sql-queries) (doc)
- [Keyless entity types, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/keyless-entity-types) (doc)
- [What's new in EF Core 8, raw SQL queries for unmapped types, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/whatsnew#raw-sql-queries-for-unmapped-types) (doc)
- [Entity types, view mapping, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/entity-types#view-mapping) (doc)
- [Managing migrations, arbitrary changes via raw SQL, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing#arbitrary-changes-via-raw-sql) (doc)
