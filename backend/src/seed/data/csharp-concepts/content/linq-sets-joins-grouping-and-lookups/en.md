---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Set operators, joins, and grouping are the LINQ operators that look most like
SQL, and the ones whose in-memory behavior differs most from what SQL taught
you. `Except` removes duplicates you never asked it to remove, `Join` silently
drops rows whose key is `null`, `GroupBy` recomputes everything every time you
enumerate it, and until .NET 10 a left join needed three operators in a
specific arrangement. This concept covers set semantics and the `By` variants,
the four join shapes including the `LeftJoin` and `RightJoin` operators added
in .NET 10, the difference between `GroupBy` and `ToLookup`, and how EF Core
translates each of them.

## Use Cases

- Listing every customer with their orders, including customers with no orders,
  in one readable query.
- Removing duplicate records by a business key such as an email address, not by
  object identity.
- Building an index of products by category once and answering many lookups
  from it.
- Finding which items of an import file are not yet in the database.
- Knowing which of these operations EF Core turns into SQL and which it
  rejects.

## Deep Dive

### Sets are sets, even when the input is a bag

`Distinct`, `Union`, `Intersect`, and `Except` treat their result as a set:
duplicates never come out, even duplicates that were only in the first
sequence. `Concat` is the bag (multiset) operation that keeps everything:

```csharp
int[] a = [3, 1, 3, 2, 1];
int[] b = [2, 4, 2];

a.Distinct();     // 3,1,2
a.Union(b);       // 3,1,2,4
a.Concat(b);      // 3,1,3,2,1,2,4,2
a.Intersect(b);   // 2
a.Except(b);      // 3,1: the second 3 and the second 1 are gone too
```

In the current implementation the output keeps first-occurrence order, but the
documentation for `Distinct` says the result sequence is unordered. Add an
`OrderBy` when order matters instead of relying on the implementation.

Equality comes from `EqualityComparer<T>.Default`: value equality for records
and primitives, reference equality for ordinary classes. Two `new C("x")`
objects of a plain class are two distinct items. Pass an
`IEqualityComparer<T>` to change the rule, for example
`names.Distinct(StringComparer.OrdinalIgnoreCase)`.

### The `By` variants compare by a key

Since .NET 6, `DistinctBy`, `UnionBy`, `IntersectBy`, and `ExceptBy` compare a
projected key and return the original items. The first item for each key wins.
`ExceptBy` and `IntersectBy` take a sequence of keys as the second argument,
not a sequence of items, which is exactly what you have when the other side is
a list of IDs:

```csharp
var people = new[] { new P("Ana", "Rio"), new P("Bia", "SP"), new P("Caio", "Rio") };

people.DistinctBy(p => p.City);                 // Ana, Bia: Caio loses to Ana
people.ExceptBy(new[] { "SP" }, p => p.City);   // Ana: Caio is dropped as a duplicate city
```

The second line shows the set rule again: `ExceptBy` also removes items whose
key already appeared, so it is not a plain "filter out these keys". If you want
to keep duplicates, write `Where(p => !banned.Contains(p.City))` with a
`HashSet`.

### Inner join, group join, and the old left join

`Join` is an inner join. Internally it reads the whole inner sequence into a
hash lookup first, then streams the outer sequence and yields one result per
matching pair, so outer order is preserved and the inner side is buffered:

```csharp
var customers = new[] { new Cu(1, "Ana"), new Cu(2, "Bia"), new Cu(3, "Caio") };
var orders = new[] { new O(10, 1, 50m), new O(11, 1, 150m), new O(12, 2, 80m), new O(13, 9, 5m) };

customers.Join(orders, c => c.Id, o => o.CustomerId, (c, o) => $"{c.Name}:{o.Id}");
// Ana:10, Ana:11, Bia:12  (Caio and order 13 have no partner)

customers.GroupJoin(orders, c => c.Id, o => o.CustomerId, (c, os) => $"{c.Name}:{os.Count()}");
// Ana:2, Bia:1, Caio:0   (one result per outer item, with its matches)
```

`GroupJoin` is the hierarchical join: every outer item appears once, with a
possibly empty collection of matches. Before .NET 10, a flat left outer join was
built from it by flattening each group with `DefaultIfEmpty`, which in query
syntax reads as `join ... into` followed by a second `from`:

```csharp
var left = from c in customers
           join o in orders on c.Id equals o.CustomerId into os
           from o in os.DefaultIfEmpty()
           select $"{c.Name}:{o?.Id.ToString() ?? "none"}";
// Ana:10, Ana:11, Bia:12, Caio:none
```

### `LeftJoin` and `RightJoin` in .NET 10

.NET 10 adds `LeftJoin` and `RightJoin` to both `Enumerable` and `Queryable`.
They take the same arguments as `Join`, and the side that may be missing
arrives as `default` (so `null` for reference types) in the result selector:

```csharp
customers.LeftJoin(orders, c => c.Id, o => o.CustomerId,
    (c, o) => $"{c.Name}:{o?.Id.ToString() ?? "none"}");
// Ana:10, Ana:11, Bia:12, Caio:none

customers.RightJoin(orders, c => c.Id, o => o.CustomerId,
    (c, o) => $"{c?.Name ?? "?"}:{o.Id}");
// Ana:10, Ana:11, Bia:12, ?:13
```

There is no query-syntax keyword for them yet, so they are written as method
calls, and there is still no `FullJoin`; a full outer join is a left join
concatenated with the unmatched rows of a right join.

### Null keys never match

The join operators skip items whose key is `null`. The .NET source builds the
inner lookup with an explicit `key is not null` check, so two `null` keys do not
match each other, the same as `NULL = NULL` in SQL:

```csharp
var l = new[] { new K("a", null), new K("b", "x") };
var r = new[] { new K("c", null), new K("d", "x") };

l.Join(r, x => x.Key, y => y.Key, (x, y) => x.N + y.N);               // bd
l.LeftJoin(r, x => x.Key, y => y.Key, (x, y) => x.N + (y?.N ?? "-")); // a-, bd
l.GroupBy(x => x.Key);                                                // groups null and "x"
```

`GroupBy` and `ToLookup`, on the other hand, do form a group for the `null` key.

### `GroupBy` versus `ToLookup`

Both return groups of `IGrouping<TKey, TElement>`. `GroupBy` is lazy: it
builds its groups when enumerated, and again on every enumeration. `ToLookup`
builds an `ILookup<TKey, TElement>` immediately and keeps it:

```csharp
var src = new List<string> { "apple", "avocado", "banana" };
var grouped = src.GroupBy(s => s[0]);
var lookup = src.ToLookup(s => s[0]);
src.Add("blueberry");

grouped.Select(g => $"{g.Key}={g.Count()}");  // a=2 b=2: regrouped from the current list
lookup.Select(g => $"{g.Key}={g.Count()}");   // a=2 b=1: a snapshot
lookup['z'].Count();                          // 0: a missing key gives an empty sequence
```

A lookup is the right structure for "many values per key, read many times",
and unlike `ToDictionary` it accepts duplicate keys (`ToDictionary` throws
`ArgumentException` on the second order of customer 1). Groups come out in the
order their first key appeared, and items inside a group keep source order;
both are documented guarantees for LINQ to Objects.

### What EF Core does with them

Running the operators against SQLite with EF Core 10 and printing the SQL with
`ToQueryString()`:

```csharp
db.Customers.LeftJoin(db.Orders, c => c.Id, o => o.CustomerId,
    (c, o) => new { c.Name, Total = (decimal?)o!.Total });
// SELECT "c"."Name", "o"."Total" FROM "Customers" AS "c"
// LEFT JOIN "Orders" AS "o" ON "c"."Id" = "o"."CustomerId"

db.Orders.GroupBy(o => o.CustomerId)
    .Select(g => new { g.Key, Sum = g.Sum(o => o.Total), Count = g.Count() });
// ... GROUP BY "o"."CustomerId"

db.Orders.GroupBy(o => o.CustomerId).ToList();
// SELECT ... FROM "Orders" AS "o" ORDER BY "o"."CustomerId"  (grouped in .NET)

db.Customers.DistinctBy(c => c.Name).ToList();
// InvalidOperationException: The LINQ expression ... could not be translated
```

`RightJoin` becomes `RIGHT JOIN`, `Union` becomes `UNION`, and `Distinct` over a
projection becomes `SELECT DISTINCT`. A `GroupBy` followed by aggregates is real
SQL grouping, while a `GroupBy` that returns the groups themselves loads every
row ordered by the key and groups in memory. The `By` set operators were not
translated in this test.

## Trade-offs

- **`LeftJoin` reads better and needs .NET 10.** Libraries that target older
  frameworks or `netstandard2.0` still need the `GroupJoin` plus
  `DefaultIfEmpty` form, and the `!` in `o!.Total` inside an EF Core projection
  is only there to quiet the nullable analysis; the SQL handles the `NULL`.
- **Joins buffer the inner sequence.** Put the smaller sequence on the inner
  side, and never use an infinite or very large stream there.
- **Set operators deduplicate the first input too.** Use `Where` with a
  `HashSet` when you need to subtract without collapsing duplicates.
  ```csharp
  var ids = new HashSet<int>(blocked);
  var kept = orders.Where(o => !ids.Contains(o.CustomerId));  // keeps every order
  ```
- **`GroupBy` repeats its work and `ToLookup` freezes it.** Enumerating a
  `GroupBy` twice regroups the source; a lookup goes stale when the source
  changes. Pick based on whether you want live data or a snapshot.
- **Final `GroupBy` in EF Core is not SQL grouping.** It streams the whole
  filtered table to the application. Group in SQL by projecting aggregates, or
  fetch the rows and group them yourself where that is clearly intended.
- **Result order from a database join is undefined.** In the run above the two
  orders of Ana came back as 150 then 50; add `OrderBy` before relying on it.

## Lab

In this lab you get `Queries`, a static class with **six empty methods** over `Customer` and `Order`. Your job is to use `Join`, `GroupJoin`, the .NET 10 `LeftJoin`, `ToLookup`, `ExceptBy` and `GroupBy` on in-memory data and observe what each one keeps or drops. The core idea is that the join "flavors" only differ when there is edge-case data, and the lab data was built for exactly that.

**The scenario**

Customers and orders in memory. One order has no customer (`CustomerId` is `null`) and one customer has no orders, and that is what makes the joins behave differently.

- `Models.cs`: `Customer(Id, Name, Email)` and `Order(Id, int? CustomerId, Total)`.
- `Queries.InnerJoin`, `LeftJoin` and `CountOrders`: the three ways to combine customers and orders.
- `Queries.OrdersByCustomer`: an `ILookup` per customer.
- `Queries.NewCustomers`: set subtraction by email.
- `Queries.TotalPerCustomer`: a sum per customer.

**What you will do, step by step**

1. **Inner join (TODO-00).** `InnerJoin` returns one row per matching (customer, order) pair, using `Join`. Customers without orders and orders without a customer do not appear. `Customer.Id` is an `int` and `Order.CustomerId` is an `int?`: the two key selectors must have the same type, so cast one.
2. **Left join (TODO-01).** `LeftJoin` is like the previous one, but customers without orders appear once with a `null` total. Use the .NET 10 `LeftJoin` operator, with `customers` as the left side; the result selector receives a `null` order when there is no match.
3. **Count with GroupJoin (TODO-02).** `CountOrders` returns one row per customer with the number of orders, zero included. `GroupJoin` never drops a left element.
4. **Immediate lookup (TODO-03).** `OrdersByCustomer` builds a lookup keyed by `CustomerId` with `ToLookup`. Unlike `GroupBy`, `ToLookup` runs now: later changes to the source list do not show up, and asking for a missing key returns an empty sequence instead of throwing.
5. **Subtract sets (TODO-04).** `NewCustomers` returns the customers from `incoming` whose `Email` is not in `known`, compared ignoring case, with no duplicate emails in the result. Use `ExceptBy`, which is already a set operation and removes duplicates, instead of building a `HashSet` by hand.
6. **Group and materialize (TODO-05).** `TotalPerCustomer` sums the totals per customer with `GroupBy`, skipping orders without a customer and sorting by id. `GroupBy` is deferred: return a materialized list.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why the order with a null `CustomerId` disappears from both the inner join and the left join, why "Caio" shows up with a null total only in the left join, and why the lookup does not see an order added later.

**Optional challenges**

- **TODO-06:** implement `LeftJoin` again with `GroupJoin`, `SelectMany` and `DefaultIfEmpty`, the pre-.NET 10 way, and compare the code.
- **TODO-07:** replace `ToLookup` with `GroupBy(...).ToDictionary(...)` and note what happens on a missing key.

**Prerequisites:** LINQ basics (`Where`, `Select`), tuples and records, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment with the hint, so the red tests are your checklist.

## Documentation Links

- [Set operations, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/set-operations) (doc)
- [Join operations, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/join-operations) (doc)
- [Grouping data, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/grouping-data) (doc)
- [Enumerable.LeftJoin method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.leftjoin) (doc)
- [Enumerable.ToLookup method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.tolookup) (doc)
- [What's new in EF Core 10, LeftJoin and RightJoin, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew#support-for-the-net-10-leftjoin-and-rightjoin-operators) (doc)
- [Complex query operators, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/complex-query-operators) (doc)
- [Lookup.CreateForJoin skips null keys, dotnet/runtime source (release/10.0)](https://github.com/dotnet/runtime/blob/591ede817344fa749dd1af56d7e73b356da3e71a/src/libraries/System.Linq/src/System/Linq/Lookup.cs#L111-L124) (doc)
