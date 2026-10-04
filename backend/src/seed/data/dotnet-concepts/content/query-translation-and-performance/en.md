---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

A LINQ query in EF Core is an expression tree that the provider translates into
SQL. What you write is not what runs: part of it becomes SQL, part may run in
.NET, and some of it cannot be translated at all. Performance problems come
from the gap between the two, from per-query overhead, and from using the
change tracker for work the database can do in one statement. This concept
covers where translation stops, how to cut overhead, how to update and delete in
bulk, how to write raw SQL without opening an injection hole, and how to page
without the cost of a growing offset.

## Use Cases

- A `Where` that calls a custom C# method and throws "could not be translated"
  in production, not in the unit test.
- A hot endpoint that runs the same query thousands of times per second.
- Closing every expired session with one statement instead of loading and
  deleting them one by one.
- A search screen that needs a query EF Core cannot express, so it uses raw SQL.
- An infinite-scroll feed that gets slower the further the user scrolls.

## Deep Dive

### Where translation stops

Operators EF Core knows become SQL. Anything else in the filter or ordering
throws, instead of silently loading the table and filtering in memory (the old
behavior before EF Core 3.0). The one place client evaluation is still allowed is the
final projection:

```csharp
// Translated: StartsWith, Length, Contains on a parameter list.
var ok = await db.Customers.Where(c => c.Name.StartsWith("A")).ToListAsync(ct);

// Throws: IsVip is a C# method the provider cannot turn into SQL.
var bad = await db.Customers.Where(c => IsVip(c)).ToListAsync(ct);

// Allowed: the projection runs in .NET after the rows arrive.
var names = await db.Customers.Select(c => Format(c.Name)).ToListAsync(ct);
```

If you must run something in memory, cross the boundary explicitly with
`AsEnumerable` after you have filtered in SQL, so you know exactly how many rows
cross it:

```csharp
var vips = db.Customers
    .Where(c => c.CreatedAt > cutoff) // SQL
    .AsEnumerable()                   // boundary: rows are streamed to .NET from here
    .Where(IsVip)                     // in memory
    .ToList();
```

### Compiled queries

EF Core caches the translation of each query shape, but every execution still
walks the expression tree to find parameters and the cache entry. For a hot
path, `EF.CompileAsyncQuery` does that work once:

```csharp
private static readonly Func<OrdersDbContext, int, CancellationToken, Task<Order?>> GetByNumber =
    EF.CompileAsyncQuery((OrdersDbContext db, int number, CancellationToken ct) =>
        db.Orders.SingleOrDefault(o => o.Number == number));

var order = await GetByNumber(db, number, ct);
```

Measure first. The gain is real only for very frequent, simple queries, the
documentation limits compiled-query parameters to simple scalars (which is why
the parameter here is an `int` and not a strongly-typed ID), and it
makes the code harder to read.

### Bulk updates and deletes

`ExecuteUpdateAsync` and `ExecuteDeleteAsync` send one `UPDATE` or `DELETE` with
the filter in the `WHERE`, without loading entities or tracking anything:

```csharp
await db.Sessions
    .Where(s => s.ExpiresAt < now)
    .ExecuteDeleteAsync(ct);

await db.Products
    .Where(p => p.CategoryId == categoryId)
    .ExecuteUpdateAsync(s => s.SetProperty(p => p.Price, p => p.Price * 1.1m), ct);
```

They run immediately, each in its own transaction unless you opened one, and
they bypass the change tracker, so a tracked entity already in memory keeps its
old values. EF Core 10 lets the update take an ordinary lambda, which makes
conditional `SetProperty` calls much easier to compose than building an
expression tree by hand.

### Raw SQL, safely

`FromSql` takes an interpolated string and turns every interpolated value into a
parameter, so it is safe. `FromSqlRaw` takes a plain string and runs it as given,
so concatenating user input into it is SQL injection:

```csharp
// Safe: {term} becomes a parameter.
var rows = await db.Products
    .FromSql($"SELECT * FROM products WHERE name ILIKE {term}")
    .ToListAsync(ct);

// Dangerous: the string is concatenated before EF Core sees it.
var evil = await db.Products
    .FromSqlRaw("SELECT * FROM products WHERE name ILIKE '" + term + "'")
    .ToListAsync(ct);
```

Since EF Core 10, an analyzer warns when you concatenate strings inside a raw SQL
method like `FromSqlRaw`.

### Keyset pagination

`Skip(n)` makes the database read and discard `n` rows, so page 500 costs far
more than page 1. Keyset pagination remembers the last key seen (here the pair `CreatedAt` and a unique `Number`) and asks for
what comes after it, which an index can answer directly:

```csharp
var page = await db.Orders
    .Where(o => o.CreatedAt < lastCreatedAt
             || (o.CreatedAt == lastCreatedAt && o.Number < lastNumber))
    .OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Number)
    .Take(20)
    .ToListAsync(ct);
```

## Trade-offs

- **`AsEnumerable` too early loads the table.** Putting it before the `Where`
  streams every row to .NET and filters there.
  ```csharp
  db.Customers.AsEnumerable().Where(c => c.Name.StartsWith("A")); // every row crosses the wire
  ```
- **Bulk operations skip the domain model.** `ExecuteUpdate` does not run
  aggregate methods, interceptors that look at tracked entities, or concurrency
  checks, so rules that live in the aggregate are not applied.
- **Bulk operations leave stale tracked entities.** An entity loaded before the
  call still shows the old value, and a later `SaveChanges` can write it back.
- **Offset paging is simple and gets slower.** It supports "jump to page 37",
  which keyset paging cannot, so keyset fits feeds and exports, not numbered
  pagination.
- **Raw SQL ties the query to one database.** Composing LINQ over it also needs
  a composable `SELECT`: EF Core wraps your SQL as a subquery, so a stored
  procedure call, a trailing semicolon, or (on SQL Server) an `ORDER BY` without
  `TOP` or `OFFSET` breaks the composed query. After a stored procedure, call
  `AsEnumerable` or `AsAsyncEnumerable` right after `FromSql`. Keep raw SQL for
  the cases LINQ cannot express.

## Documentation Links

- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [ExecuteUpdate and ExecuteDelete, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [SQL queries, FromSql and FromSqlRaw, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/sql-queries) (doc)
- [Pagination, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/pagination) (doc)
- [What is new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
