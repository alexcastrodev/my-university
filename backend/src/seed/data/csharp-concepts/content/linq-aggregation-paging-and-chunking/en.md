---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Aggregation operators collapse a sequence into one value, and partitioning
operators cut a slice out of it. Both look trivial until the sequence is empty,
the numbers overflow, the source is lazy, or the query runs in a database. This
concept covers what each aggregate does with an empty input, the accumulator
behind `Sum`, `Aggregate`, `MinBy` and `MaxBy`, why `Any()` beats
`Count() > 0`, `Skip`, `Take` and `Take(Range)`, `Chunk`, and how paging
behaves in memory and through EF Core. The operator map is in LINQ: Operator
Families and Query Syntax; this concept is about the edge cases.

## Use Cases

- Computing a total or an average from data that can legitimately be empty
  (a new customer with no orders).
- Finding the cheapest product, not just the cheapest price.
- Asking "is there at least one?" against a large or remote source.
- Splitting work into batches of 500 for a bulk API.
- Returning page 3 of a sorted list from memory or from SQL.

## Deep Dive

### Empty sequences: which aggregates throw

The rule depends on whether the result type can represent "nothing":

| Call on an empty sequence | Result |
|---|---|
| `int[].Sum()` | `0` |
| `int[].Average()`, `.Min()`, `.Max()` | `InvalidOperationException: Sequence contains no elements` |
| `int?[].Average()`, `.Max()` | `null` |
| `string[].Max()` | `null` |
| `int[].Aggregate((a, b) => a + b)` | `InvalidOperationException` |
| `int[].Aggregate(0, (a, b) => a + b)` | `0` (the seed) |
| `int[].MinBy(x => x)` | `InvalidOperationException` |
| `string[].MinBy(s => s.Length)` | `null` |

A value type such as `int` cannot be `null`, so `Average`, `Min`, `Max`, and
`MinBy` throw; a nullable or reference element type returns `null`. If an
empty input is normal for your data, project to a nullable type
(`orders.Average(o => (decimal?)o.Total)`) or check with `Any()` first.

### `Sum`: the accumulator and overflow

`Sum` over `int` and `long` runs in a checked context, so
`new[] { int.MaxValue, 1 }.Sum()` throws `OverflowException` instead of
wrapping; `Sum(x => (long)x)` returns `2147483648`. The details of checked
arithmetic are in Numeric Conversions, Rounding and Overflow.

The accumulator type matters for floating point too. The runtime source shows
`Sum(IEnumerable<float>)` accumulating in `double` and casting back at the end,
so it is more accurate than a naive loop:

```csharp
float[] f = { 16777216f, 1f, 1f };
f.Sum();                                    // 16777218
float s = 0; foreach (var v in f) s += v;   // 16777216: each +1 is lost
new[] { 0.1, 0.2, 0.3 }.Sum();              // 0.6000000000000001
new[] { 0.1m, 0.2m, 0.3m }.Sum();           // 0.6
```

Money belongs in `decimal`; `double` sums carry binary rounding.

### `Aggregate`, `MinBy` and `MaxBy`

`Aggregate` is the general fold. The overload with a seed, a step, and a
result selector computes several things in one pass:

```csharp
var people = new[] { ("Ana", 31), ("Bia", 25), ("Caio", 25), ("Duda", 40) };

double avgAge = people.Aggregate(
    seed: (Count: 0, Total: 0),
    func: (acc, p) => (acc.Count + 1, acc.Total + p.Item2),
    resultSelector: acc => (double)acc.Total / acc.Count);   // 30.25

people.MinBy(p => p.Item2);   // (Bia, 25): the element, first one on a tie
people.MaxBy(p => p.Item2);   // (Duda, 40)
```

`MinBy` and `MaxBy` (added in .NET 6, with `Chunk`, `Take(Range)` and
`TryGetNonEnumeratedCount`) return the element that has the extreme key.
Before them the idiom was `OrderBy(p => p.Age).First()`, which reads as a sort
but, as Writing LINQ Operators and How LINQ Is Implemented shows, LINQ
already turns into a single scan. `MinBy` says what you mean and does not
depend on that optimization.

### `Count` versus `Any`

On a lazy source, `Count()` has to walk the whole sequence, while `Any()` stops
at the first element:

```csharp
int pulled = 0;
IEnumerable<int> Counted() { for (int i = 0; i < 1_000_000; i++) { pulled++; yield return i; } }

_ = Counted().Count() > 0;        // pulled 1,000,000
_ = Counted().Any();              // pulled 1
_ = Counted().Any(x => x > 10);   // pulled 12
```

On a `List<T>` or an array the gap disappears, because `Count()` reads the
`Count` property. Through EF Core 10 against SQLite, `Any(o => o.Total > 100)`
became `SELECT EXISTS (SELECT 1 ... WHERE ...)` and
`Count(o => o.Total > 100) > 0` became `SELECT COUNT(*) ...`, which counts
every matching row.

### `Skip`, `Take` and `Take(Range)`

`Skip` and `Take` never throw for out-of-range counts: a negative count is
treated as zero, and asking for more than exists returns what exists.
`Take(Range)` takes a slice, including indexes from the end:

```csharp
var r = Enumerable.Range(1, 10);
r.Take(2..5);         // 3,4,5
r.Take(^3..);         // 8,9,10
r.Take(..^7);         // 1,2,3
r.Take(8..20);        // 9,10
r.Skip(-5).Take(2);   // 1,2
r.TakeLast(2);        // 9,10
```

### `Chunk`

`Chunk(n)` splits a sequence into arrays of `n`, with a shorter last one:

```csharp
foreach (int[] batch in Enumerable.Range(1, 10).Chunk(4))
    Console.WriteLine(string.Join(",", batch));   // 1,2,3,4 / 5,6,7,8 / 9,10
// Chunk(0) throws ArgumentOutOfRangeException
```

Each chunk is a new array, so batching costs one allocation per batch; that
is usually fine for I/O-sized batches and wasteful for tiny ones.

### Paging in memory and in the database

Paging a lazy source with `Skip(page * size).Take(size)` restarts the source
for every page. Paging 10,000 generated items in pages of 100 pulled 515,000
items with `Skip`/`Take` (each page re-reads everything before it, plus a
final empty page) and 10,000 with `Chunk(100)`. For one pass over all pages,
use `Chunk`; for random access to page 37, materialize first.

Against a database, `Skip` and `Take` translate to `LIMIT` and `OFFSET`. EF
Core 10 logged `RowLimitingOperationWithoutOrderByWarning` when the query had
no `OrderBy`, because SQL does not promise a row order without one. Several
in-memory operators do not translate: with EF Core 10.0.0 and SQLite,
`Take(5..10)`, `MaxBy`, and `Chunk` all failed with "could not be translated".
`Average` over an empty table threw "Nullable object must have a value", while
`Average(o => (double?)o.Total)` returned `null`. `Sum` became
`COALESCE(SUM(...), 0.0)` and returned zero. Large offsets also get slower
page by page; keyset pagination, covered in Query Translation and Performance
in EF Core, avoids that.

## Trade-offs

- **Throwing versus nullable aggregates.** Throwing on an empty sequence
  catches a bug when data should exist; a nullable projection is right when
  "no data" is a valid state. Decide per call instead of wrapping everything
  in `try`.
  ```csharp
  decimal? avg = orders.Average(o => (decimal?)o.Total);   // null for a new customer
  ```
- **`Aggregate` versus several aggregates.** One fold walks the source once,
  which matters for a lazy or expensive source; separate `Sum` and `Count`
  calls are easier to read and fine for an in-memory list.
- **`MinBy` versus `OrderBy().First()`.** `MinBy` states intent and does not
  depend on an optimization, but EF Core 10 does not translate it; in a query
  that must run in SQL, `OrderBy(...).FirstOrDefault()` is the form that
  translates.
- **`Chunk` versus offset paging.** `Chunk` reads a lazy source once but only
  moves forward; `Skip`/`Take` gives random access to any page and re-reads the
  prefix every time.
- **Offset versus keyset paging in SQL.** Offset supports "go to page N" and
  slows down on deep pages; keyset stays fast but only supports next and
  previous.

## Documentation Links

- [Partitioning data, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/partitioning-data) (doc)
- [Enumerable.Aggregate method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.aggregate) (doc)
- [Enumerable.MinBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.minby) (doc)
- [Enumerable.Chunk method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.chunk) (doc)
- [Enumerable.Take method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.take) (doc)
- [What's new in .NET 6: new LINQ APIs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-6#new-linq-apis) (doc)
- [Pagination, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/pagination) (doc)
