---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

.NET gives you three common ways to talk to a database, and they are not
alternatives at the same level: they are layers. ADO.NET is the base API that
every relational driver implements. Dapper is a thin set of extension methods
that maps rows to objects on top of it. EF Core is a full ORM (LINQ, change
tracking, migrations, a model) that itself runs through an ADO.NET provider.
This concept runs the same query through all three, shows what each one costs
and buys you, and gives a rule for choosing, including when to use two of them
in the same unit of work. It also covers how EF Core providers are packaged and
versioned, because that decides which databases you can reach, relational or not.

## Use Cases

- Starting a new line-of-business API and deciding whether EF Core is enough or
  whether a hot read path should drop to SQL.
- Adding a reporting query that joins five tables, where hand-written SQL is
  clearer than the LINQ that would produce it.
- Porting a legacy app that still uses Entity Framework 6.
- Writing a small tool or a Native AOT service where startup time and
  reflection matter more than a rich model.

## Deep Dive

### Three layers, one connection

ADO.NET defines the abstract types `DbConnection`, `DbCommand` and
`DbDataReader`, and each driver supplies the concrete ones (`SqliteConnection`,
`NpgsqlConnection`, `SqlConnection`). You write SQL, set parameters, read
columns by ordinal, and own the mapping. Dapper adds methods such as
`QueryAsync<T>` and `ExecuteAsync` to `IDbConnection`, so SQL stays visible but
the mapping to objects is automatic. EF Core's relational providers sit on top
of the same ADO.NET types: when you call `ToListAsync`, EF Core builds a
`DbCommand` and reads a `DbDataReader` just like the first option. That is why
EF Core always pays for the ADO.NET work plus its own. The real question is how
big the extra cost is and what you get for it.

### The same query three ways

One table of 20,000 products in a SQLite file, one query: products of a
category above a price, ordered by price (800 rows). All three return identical
results (`same=True` in the run).

```csharp
// ADO.NET: you write the SQL, the parameters and the mapping.
await using var conn = new SqliteConnection(cs);
await conn.OpenAsync();
await using var cmd = conn.CreateCommand();
cmd.CommandText = "SELECT Id, Name, Price FROM Products WHERE CategoryId = @c AND Price >= @min ORDER BY Price";
cmd.Parameters.AddWithValue("@c", categoryId);
cmd.Parameters.AddWithValue("@min", minPrice);
var list = new List<ProductRow>();
await using var r = await cmd.ExecuteReaderAsync();
while (await r.ReadAsync())
    list.Add(new ProductRow(r.GetInt32(0), r.GetString(1), r.GetDouble(2)));

// Dapper: you write the SQL, the mapping is by column name.
await using var conn = new SqliteConnection(cs);
var rows = await conn.QueryAsync<ProductRow>(
    "SELECT Id, Name, Price FROM Products WHERE CategoryId = @categoryId AND Price >= @minPrice ORDER BY Price",
    new { categoryId, minPrice });

// EF Core: you write LINQ, EF Core writes the SQL.
var rows = await db.Products.AsNoTracking()
    .Where(p => p.CategoryId == categoryId && p.Price >= minPrice)
    .OrderBy(p => p.Price)
    .Select(p => new ProductRow(p.Id, p.Name, p.Price))
    .ToListAsync();
```

`ToQueryString()` on the EF Core query prints the SQL it will send. It is the
same shape as the hand-written one (the `CAST` appears because the row type asks
for a `long` and the entity has an `int`):

```
SELECT CAST("p"."Id" AS INTEGER), "p"."Name", "p"."Price"
FROM "Products" AS "p"
WHERE "p"."CategoryId" = 3 AND "p"."Price" >= 100.0
ORDER BY "p"."Price"
```

Here the two values are inlined because they were `const` locals. A variable
becomes a real parameter (`@variableId`), which I checked by printing both.
Dapper and EF Core both parameterize for you; ADO.NET only does if you use
`Parameters`, never string concatenation.

### What it costs, measured

A crude timing loop (warm-up, then the median of 15 rounds of 200 calls, a new
connection or context per call, no BenchmarkDotNet) on .NET 10.0.0, macOS
27.0.1, Arm64, 14 cores, in-process SQLite file, 800 rows per query. Two full
runs gave the same picture:

```
ADO.NET                    0.38 ms/query
Dapper                     0.45 ms/query
EF Core tracked entities   0.73 ms/query
EF Core NoTracking+Select  0.79 to 0.81 ms/query
```

Read it for its shape, not its digits. Dapper adds a small constant over raw
ADO.NET, EF Core adds roughly 0.35 ms more here, and with an in-process database
there is no network, so this is close to the worst case for EF Core's relative
overhead. On a small result like this one, `AsNoTracking` with a projection was
not faster than tracking; the trade only shows up with more rows or many
repeated entities, so measure your own query before treating it as a rule.

### Streaming and mixing

Buffering 800 rows into a list is fine; a million rows is not. All three can
stream one row at a time (output of the run, five rows):

```csharp
while (await reader.ReadAsync()) { ... }                  // ADO.NET: P1 P2 P3 P4 P5
await foreach (var p in conn.QueryUnbufferedAsync<NameRow>(sql)) { ... } // Dapper
await foreach (var p in db.Products.AsNoTracking().AsAsyncEnumerable()) { ... } // EF Core
```

You rarely need to pick only one. A common design is EF Core for writes and the
simple reads, and a few hand-written queries where LINQ gets in the way. They can
share the connection and the transaction, so the unit of work stays atomic:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
var conn = db.Database.GetDbConnection();
var affected = await conn.ExecuteAsync(
    "UPDATE Products SET Price = Price * 2 WHERE CategoryId = @c",
    new { c = 1 }, tx.GetDbTransaction());      // Dapper inside the EF Core transaction
await tx.RollbackAsync();                        // affected was 5, prices are back to the original
```

`GetDbTransaction` is an extension in `Microsoft.EntityFrameworkCore.Storage`.
If all you need is a raw query into a type that is not an entity, EF Core already
has one: `db.Database.SqlQuery<NameRow>($"SELECT Name FROM Products WHERE Price > {25}")`
(see "Raw SQL, safely" in the query translation concept).

### Providers, versions and legacy EF

An EF Core provider is a NuGet package for one database engine:
`Microsoft.EntityFrameworkCore.SqlServer`, `.Sqlite`, `.InMemory` and `.Cosmos`
come from the EF Core team, while PostgreSQL, MySQL and Oracle come from other
vendors. Non-relational stores have providers too: Cosmos DB from the EF Core
team, and MongoDB from MongoDB itself, both listed for EF Core 8, 9 and 10. The
official list warns that providers usually do not work across major
versions of EF Core, so a third-party provider can lag a release. EF Core 10 was
released in November 2025 as an LTS release supported until November 10, 2028,
and it needs the .NET 10 SDK to build and the .NET 10 runtime to run: it does
not run on earlier .NET versions or on .NET Framework. Entity Framework 6 is
stable but no longer actively developed; the guidance is to keep it when the
data code is stable and port to EF Core when the code is evolving.

### Native AOT changes the choice

A file-based app (`dotnet run app.cs`) enables Native AOT publishing by default
in the .NET 10 SDK. My first run of the Dapper code failed immediately with
`PlatformNotSupportedException: Dynamic code generation is not supported on
this platform`, because Dapper generates its row mappers at runtime; the fix was
`#:property PublishAot=false`. Dapper has a separate build-time generator,
Dapper.AOT, for that case. EF Core's Native AOT and precompiled queries support
is still documented as experimental and not recommended for production, so for a
Native AOT service plain ADO.NET is the option with no caveats.

## Trade-offs

- **EF Core hides the SQL, so you must look at it.** A LINQ query that reads
  well can produce a poor statement. `ToQueryString()` and logging make it
  visible; skipping them is how N+1 and unbounded reads reach production.
  ```csharp
  Console.WriteLine(query.ToQueryString());
  ```
- **Dapper maps by name and by the provider's types.** The first version of my
  `ProductRow` used `int Id` and Dapper threw `A parameterless default
  constructor or one matching signature (System.Int64 Id, System.String Name,
  System.Double Price) is required`, because SQLite returns integers as 64-bit.
  The same code works on a database that returns `int`, which makes this a
  portability trap.
  ```csharp
  record ProductRow(long Id, string Name, double Price); // matches what SQLite returns
  ```
- **ADO.NET has no safety net.** Column ordinals break silently when the SELECT
  list changes, and concatenated SQL is injection. The speed comes from you doing
  the work.
  ```csharp
  r.GetInt32(0) // fails at runtime if someone reorders the columns
  ```
- **Two tools in one request need one connection.** A Dapper call on its own
  connection does not see EF Core's uncommitted changes or its transaction.
  Reuse `db.Database.GetDbConnection()` and pass the transaction, as shown above.
- **Raw SQL ties you to one database.** The hand-written query works on SQLite
  and may need rewriting for PostgreSQL, while the LINQ version is portable
  between relational providers (apart from provider-specific functions).
- **The measured gap is real and small.** A fraction of a millisecond per query
  matters on a path called thousands of times per second and rarely elsewhere.
  Optimize the query and the indexes first.

## Documentation Links

- [Entity Framework Core overview, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/) (doc)
- [Database providers, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/) (doc)
- [Compare EF6 and EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/efcore-and-ef6/) (doc)
- [What's new in EF Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew) (doc)
- [Microsoft.Data.Sqlite overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/) (doc)
- [NativeAOT support and precompiled queries (experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [File-based apps, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [Dapper, GitHub](https://github.com/DapperLib/Dapper) (doc)
