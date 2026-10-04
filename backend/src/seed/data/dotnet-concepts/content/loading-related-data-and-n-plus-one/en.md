---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

EF Core does not load related entities unless you ask. How you ask decides
whether a page needs one query, a handful, or hundreds. The classic failure is
N+1: one query for a list, then one more per row to fetch something related.
The opposite failure is a single enormous join that repeats the parent's columns
for every child and multiplies row counts. Knowing `Include`, split queries,
projections, and what lazy loading really does lets you pick the shape on
purpose and prove it by reading the SQL.

## Use Cases

- A list of orders that must show each customer's name without one query per
  row.
- Loading an order with its lines and each line's product in a single use case.
- A report that joins two collections and suddenly returns millions of rows.
- Finding out why an endpoint that was fast in development issues 300 queries
  against the production data.

## Deep Dive

### Eager loading with Include

`Include` and `ThenInclude` add the related data to the same query as joins,
and the result is tracked as a graph:

```csharp
var order = await db.Orders
    .Include(o => o.Lines)
        .ThenInclude(l => l.Product)
    .SingleAsync(o => o.Id == id, ct);
```

Use a filtered include when you need only part of the collection:

```csharp
var orders = await db.Orders
    .Include(o => o.Lines.Where(l => l.Quantity > 10))
    .ToListAsync(ct);
```

### Cartesian explosion and split queries

Including two collections of the same parent in one query joins both, and the
database returns every combination: 10 lines times 10 payments is 100 rows per
order, with the order's own columns repeated on each. `AsSplitQuery` sends one
query per collection instead:

```csharp
var orders = await db.Orders
    .Include(o => o.Lines)
    .Include(o => o.Payments)
    .AsSplitQuery()
    .ToListAsync(ct);
// SELECT ... FROM orders
// SELECT ... FROM lines JOIN orders ...
// SELECT ... FROM payments JOIN orders ...
```

A single query gives one consistent snapshot of the data, and a split query
gives several round trips that can each see different data if rows change in
between. Wrap it in a transaction when that matters, or set
`UseQuerySplittingBehavior` once for the whole context and override with
`AsSingleQuery` where a single query is better.

### N+1 and lazy loading

N+1 happens when code loops over a result and touches a navigation that was not
loaded:

```csharp
var orders = await db.Orders.ToListAsync(ct);          // 1 query
foreach (var o in orders)
    Console.WriteLine(o.Customer.Name);                // +1 query per order, if lazy loading is on
```

With the lazy loading proxies package, each navigation access triggers a hidden
query, which makes this bug invisible in the code. Without lazy loading,
`o.Customer` is simply `null` and you get a different bug. Both are fixed by
deciding what the use case needs and loading it up front, either with `Include`
or, better for reads, with a projection.

### Projections load exactly what you show

A `Select` into a DTO builds a query with only the columns used, needs no
tracking, and makes the join implicit:

```csharp
var rows = await db.Orders
    .Select(o => new OrderListItem(
        o.Id.Value,
        o.Customer.Name,
        o.Lines.Count,
        o.Lines.Sum(l => l.Quantity * l.Price.Amount)))
    .ToListAsync(ct);
```

### Read the SQL

You cannot reason about the number of queries without looking at them.
`ToQueryString()` shows the SQL for a query without running it, and logging
shows the real traffic:

```csharp
Console.WriteLine(db.Orders.Include(o => o.Lines).ToQueryString());

// Or log every command during development:
options.LogTo(Console.WriteLine, LogLevel.Information).EnableSensitiveDataLogging();
```

Add a test that counts the commands for a key endpoint, so a new `foreach` that
causes N+1 fails the build instead of the production database.

## Trade-offs

- **`Include` returns more than you need.** It loads every column of every
  related row, tracks all of it, and still produces a join. For a list screen
  that shows three fields, a projection does the same job with a fraction of the
  data.
- **Split queries trade correctness for size.** Between the first and second
  query another transaction can commit, so the children may not match the parent
  you already read.
  ```csharp
  // Parent read at T1, lines read at T2: an order can appear with lines that were added after T1.
  ```
- **Split queries with paging need a deterministic order.** Each query repeats
  the `Skip` and `Take`, so without an `OrderBy` on a unique key the database may
  pick different parents for each query and the children no longer match the
  page.
  ```csharp
  db.Orders.Include(o => o.Lines).AsSplitQuery()
      .OrderBy(o => o.CreatedAt).ThenBy(o => o.Id) // unique tie-breaker
      .Skip(40).Take(20);
  ```
- **Lazy loading hides N+1 behind property access.** It is convenient for
  small tools and dangerous in request handlers, where one innocent loop turns
  into hundreds of round trips. Prefer explicit loading and keep proxies out of
  domain models, which need virtual members for them to work.
- **Counting queries needs tooling.** The SQL log is noisy and the N+1 is only
  obvious with realistic data volumes, so test with more than three rows.

## Documentation Links

- [Loading related data, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/related-data/) (doc)
- [Single vs. split queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries) (doc)
- [Eager loading of related data, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/related-data/eager) (doc)
- [Efficient querying, EF Core performance, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying) (doc)
