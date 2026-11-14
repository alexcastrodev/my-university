---
version: 1.0
updatedAt: 2026-11-14
---
## Objective

Two EF Core 11 features look unrelated and are not. The first is **join
pruning**: when a query joins a table and then never uses a column of it, EF Core
11 removes the join from the SQL. The second is a pair of ways to model a foreign
key **without a database constraint**, for data you import, synchronize or inherit
without integrity guarantees: `ExcludeForeignKeyFromMigrations()` and
`IsConstrained(false)`.

They interact because pruning an `INNER JOIN` is only correct if every row on the
left side has a match on the right, and EF Core takes that guarantee from your
*model*, not from the database. Declare the unconstrained key the wrong way and
the same table answers a query with 2 rows or with 1, depending on how the query is
written. This concept shows both features and that trap with real output.

How it was checked, so you know what each result proves. The comparison of EF Core
10.0.14 against 11.0.0 used SQL Server SQL generated offline with `ToQueryString()`
and `GenerateCreateScript()` (no server). The orphan-row demonstration was
**executed** on SQLite with EF Core 11.0.0 and real rows. Relationship basics are in
`relationships-keys-and-delete-behavior`, and how to read generated SQL is in
`query-translation-and-performance`.

## Use Cases

- A legacy database or a vendor schema where the foreign keys were never created.
- Data that arrives out of order from an import or a synchronization job: orders
  before their customers, children before parents.
- Reading the SQL of a query after the upgrade and wondering where a `JOIN` went.
- Deciding how to declare a relationship the database does not enforce.

## Deep Dive

### What join pruning removes

The model is a shop: an `Order` has a required `Customer` and an optional `Coupon`.

```csharp
public class Order
{
    public int Id { get; set; }
    public decimal Total { get; set; }
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public int? CouponId { get; set; }
    public Coupon? Coupon { get; set; }
}

modelBuilder.Entity<Order>().HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId);
modelBuilder.Entity<Order>().HasOne(o => o.Coupon).WithMany().HasForeignKey(o => o.CouponId);
```

A report query joins all three tables explicitly, and the callers then use
different parts of it:

```csharp
var all = from o in db.Orders
          join c in db.Customers on o.CustomerId equals c.Id
          join cp in db.Coupons on o.CouponId equals cp.Id into cps
          from cp in cps.DefaultIfEmpty()
          select new { o, c, cp };

all.Select(x => new { x.o.Id, x.c.Name, Coupon = x.cp.Code });  // Q1: uses all three
all.Select(x => x.o);                                          // Q2: only the order
all.Select(x => new { x.o.Id, x.c.Name });                     // Q3: order and customer
```

Q1 is the same on both versions. Q2 and Q3 are where they differ (SQL Server,
generated offline, same code):

```sql
-- Q2, EF Core 10.0.14: both joins stay, though no column of them is selected
SELECT [o].[Id], [o].[CouponId], [o].[CustomerId], [o].[Total]
FROM [Orders] AS [o]
INNER JOIN [Customers] AS [c] ON [o].[CustomerId] = [c].[Id]
LEFT JOIN [Coupons] AS [c0] ON [o].[CouponId] = [c0].[Id]

-- Q2, EF Core 11.0.0
SELECT [o].[Id], [o].[CouponId], [o].[CustomerId], [o].[Total]
FROM [Orders] AS [o]

-- Q3, EF Core 11.0.0: the unused coupon join is gone, the customer join stays
SELECT [o].[Id], [c].[Name]
FROM [Orders] AS [o]
INNER JOIN [Customers] AS [c] ON [o].[CustomerId] = [c].[Id]
```

If the optimizer is lucky it would have removed the unused joins itself. Pruning
them in EF means the database never has to find out, which matters when the query
is complicated enough that the optimizer gives up. Navigation properties that you
do not touch were already left out in EF Core 10, and `Select(o => new { o.Id, o.Total })`
was a plain `SELECT` there too. A separate EF Core 11 change removes joins from
split-query Includes (`whats-new-in-ef-core-11`). This one is about explicit joins
and navigations whose columns go unused.

### Why one join goes and the other stays

The two joins have different risks, and EF reasons about them separately:

- A **`LEFT JOIN` to a unique key** can never change the number of rows. Every
  order keeps exactly one row whether or not a coupon matches. It can be dropped
  whenever its columns are unused. Even with no relationship in the model, EF 11
  dropped the coupon join and EF 10 kept it.
- An **`INNER JOIN` can remove rows**: an order with no customer would disappear.
  Dropping it is only correct if no such order exists. EF 11 drops it only when the
  model says so, which means a *required* foreign key that it considers
  constrained. With no relationship in the model, only plain keys and an explicit
  `join`, EF 11 kept the inner join in Q2 and Q3.

That second rule is what the next section is about.

### Declaring a foreign key the database does not enforce

There are two APIs, in different packages, with different meanings:

```csharp
// Relational: the migration does not create the FOREIGN KEY constraint.
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId)
    .ExcludeForeignKeyFromMigrations();

// Core: the relationship is not constrained at all.
modelBuilder.Entity<Order>()
    .HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId)
    .IsConstrained(false);
```

Both produce the same schema. No `FOREIGN KEY`, and the index on the foreign key
column is still created:

```sql
CREATE INDEX "IX_Orders_CustomerId" ON "Orders" ("CustomerId");
```

`ExcludeForeignKeyFromMigrations` is described on the EF Core 11 "what's new" page:
the relationship stays fully supported for queries and change tracking, and only the
constraint is suppressed. `IsConstrained` is a public member of the core package
(`IForeignKey.IsConstrained` and the builder method), and I did not find it on that
page, so check the foreign-key documentation for its current description.

### The same data, different answers

Here is the experiment that separates them, executed on SQLite with EF Core 11.0.0.
The table has two orders. Order 1 belongs to customer 1, who exists. Order 2 has
`CustomerId = 99`, and customer 99 does not exist: an orphan. Each row below is a new
database created with `EnsureCreated` for that model.

| Model | Orphan insert | `join` then `Select(o)` | `Include(Customer)` | `Count()` |
|---|---|---|---|---|
| Default (constraint created) | rejected: `FOREIGN KEY constraint failed` | 1 (no join in SQL) | not run | not run |
| `ExcludeForeignKeyFromMigrations()` | accepted | **2** (join pruned) | **1** (`INNER JOIN`) | 2 |
| `IsConstrained(false)` | accepted | **1** (`INNER JOIN` kept) | **2** (`LEFT JOIN`) | 2 |
| No relationship, plain `join` | accepted | 1 (`INNER JOIN` kept) | not applicable | not applicable |

With `ExcludeForeignKeyFromMigrations`, the model still says "this foreign key is
required and its principal exists". EF believes that and removes the inner join, so
the query that never reads `Customer` returns the orphan, while `Include(Customer)`,
which needs the customer's columns, keeps the `INNER JOIN` and silently drops it.
`Count()` is 2 and `Where(o => o.Customer != null).Count()` is 1, from the same
database. Nothing throws. Three correct-looking queries disagree.

With `IsConstrained(false)` EF does not assume the principal exists. The explicit join
stays and filters the orphan out, `Include` becomes a `LEFT JOIN`, and the orphan
comes back with `Customer == null` even though the property is declared as
non-nullable (`Customer = null!`). That is the honest model for data that may be
dirty, and the cost moves to your code: any place that trusts `order.Customer` has to
cope with `null` now.

The choice follows from who guarantees the integrity:

- **Something else guarantees it**, for example a DBA created the constraint outside
  migrations, or the other table lives in a database that migrations do not manage:
  use `ExcludeForeignKeyFromMigrations()`. The model is right that rows match.
- **Nothing guarantees it**, as with an import that can run in any order: use
  `IsConstrained(false)`, and write queries that expect an orphan.

## Trade-offs

- **A constraint is also an optimization hint.** It protects the data and it lets EF
  produce shorter SQL. Giving it up buys you freedom in loading order and costs both.
- **Pruning is free only on clean data.** With constraints enforced, every pruned
  query returns exactly what the unpruned one did. If your data already has orphans
  behind a relationship that EF believes in, upgrading to 11 can change row counts
  without an error. Look for orphans before the upgrade
  (`WHERE NOT EXISTS (SELECT 1 FROM Customers c WHERE c.Id = o.CustomerId)`).
- **`ExcludeForeignKeyFromMigrations` on dirty data is a trap.** It reads like
  "no constraint" and means "no constraint, and trust me". The table above is the
  result when the trust is misplaced.
- **`IsConstrained(false)` moves work into your code.** Navigation properties that
  were never null can now be null, so the compiler's nullability annotations stop
  being a guarantee for that relationship.
- **Test with an orphan fixture.** One row with a dangling key in a test database
  would have shown the difference between these two options before production did.
- **SQL Server output here is offline.** The comparison of EF 10 and 11 proves the
  generated SQL, and the row counts come from the SQLite run. Check the plan on your
  own server before counting on a speed-up from fewer joins.

## Documentation Links

- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
- [Foreign and principal keys in relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships/foreign-and-principal-keys) (doc)
- [Relationships, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/relationships) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
