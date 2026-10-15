---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

`System.Linq.Enumerable` has well over fifty operators, and most people learn
them one at a time from autocomplete. It pays to see them as a handful of
families instead: once you know that `Single` is an element operator and `Any`
is a quantifier, you know how each behaves on an empty sequence before you read
the docs. The second half of the picture is query syntax. `from ... where ...
select` is not a separate engine; the compiler rewrites it into ordinary method
calls by name, and knowing that rewrite explains `let`, `into`, and why some
operators only exist as methods. This concept maps the operator families,
shows the lowering of query syntax, and covers ordering in detail: stable sort,
`ThenBy`, `Order()`, and culture-sensitive string comparison. Deferred
execution, streaming versus buffering, and the .NET 9 operators are covered in
the prerequisite concept and are not repeated here.

## Use Cases

- Choosing between `First`, `Single`, and their `OrDefault` versions based on
  what the data guarantees, not on which one compiled first.
- Reading a query written in query syntax and knowing exactly which methods it
  calls, which matters when it runs against EF Core.
- Sorting by several keys without the second `OrderBy` silently discarding the
  first.
- Getting the same sort order on a developer laptop and in a container whose
  culture is different.
- Extracting the items of one type from a heterogeneous list without a cast
  exception.

## Deep Dive

### The operator families

Grouping the operators by what they return explains most of their behavior:

| Family | Operators | Returns |
|---|---|---|
| Restriction | `Where`, `OfType` | fewer items, same shape |
| Projection | `Select`, `SelectMany`, `Cast`, `Zip` | same or more items, new shape |
| Partitioning | `Take`, `Skip`, `TakeWhile`, `SkipWhile`, `TakeLast`, `Chunk` | a slice |
| Ordering | `OrderBy`, `ThenBy`, `Order`, `Reverse` (and `Descending` forms) | same items, new order |
| Sets | `Distinct`, `Union`, `Intersect`, `Except` (and `By` forms) | items without duplicates |
| Grouping and joins | `GroupBy`, `Join`, `GroupJoin`, `LeftJoin`, `RightJoin`, `ToLookup` | combined or nested items |
| Element | `First`, `Last`, `Single`, `ElementAt` (and `OrDefault` forms) | one item |
| Quantifiers | `Any`, `All`, `Contains`, `SequenceEqual` | `bool` |
| Aggregation | `Count`, `Sum`, `Min`, `Max`, `Average`, `Aggregate`, `MinBy`, `MaxBy` | one value |
| Conversion | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`, `AsEnumerable` | a collection or a retyped sequence |
| Generation | `Enumerable.Range`, `Repeat`, `Empty` | a new sequence |

Operators that return a sequence are lazy; the ones that return a single value
or a collection run the query on the spot. Sets, joins, and grouping have their
own concept, and aggregation and paging have another.

### Element operators and empty sequences

The element family is where the choice carries meaning. `First` says "there is
at least one", `Single` says "there is exactly one" and checks it, and the
`OrDefault` versions say "zero is a normal answer":

```csharp
int[] empty = [];
Console.WriteLine(empty.FirstOrDefault(-1));   // -1: the .NET 6 overload picks the default
new[] { 1, 2 }.Single();                       // InvalidOperationException: Sequence contains more than one element
Console.WriteLine(empty.All(x => x > 100));    // True: nothing contradicts the predicate
```

`Single` has to read past the first match to prove there is no second one, so
it costs more than `First` and turns a data bug into an exception at the right
place. `All` on an empty sequence is `true` (vacuous truth), so a check such as
"all items are in stock" usually needs `Any()` as well.

### Query syntax is a rewrite into method calls

The compiler translates a query expression into method calls by name, and only
then does overload resolution. You can watch the rewrite by running the query
over `AsQueryable()`, which records the calls as an expression tree instead of
executing them:

```csharp
string[] words = ["apple", "fig", "banana", "kiwi", "cherry"];
var q = from w in words.AsQueryable()
        where w.Length > 3
        select w;
Console.WriteLine(q.Expression);
// System.String[].Where(w => (w.Length > 3))
```

The `select w` disappeared: a select that returns the range variable unchanged
is dropped when another clause already produced the sequence. Other clauses map
just as directly: `orderby a, b descending` becomes
`OrderBy(...).ThenByDescending(...)`, `group w by w.Length` becomes
`GroupBy(w => w.Length)`, a second `from` becomes `SelectMany`, and
`join ... on ... equals` becomes `Join`.

Because the rewrite is by name, any type with suitable `Where` and `Select`
methods works with query syntax, even one that is not a sequence:

```csharp
var box = new Box<int>(20);
var r = from x in box where x > 10 select x * 2;
Console.WriteLine(r.Value);   // prints "Box.Where", "Box.Select", then 40

class Box<T>(T value)
{
    public T Value => value;
    public Box<T> Where(Func<T, bool> p) { Console.WriteLine("Box.Where"); return p(Value) ? this : new Box<T>(default!); }
    public Box<U> Select<U>(Func<T, U> f) { Console.WriteLine("Box.Select"); return new Box<U>(f(Value)); }
}
```

This is the "query expression pattern" from the C# specification, and it is how
libraries for parsers or option types reuse the syntax.

### `let`, `into`, and transparent identifiers

`let` introduces a value computed once per item. There is no `Let` method, so
the compiler packs the original item and the new value into an anonymous type
and carries that object through the rest of the query:

```csharp
var q = from w in words.AsQueryable()
        let len = w.Length
        where len > 3
        orderby len descending, w
        select new { w, len };
Console.WriteLine(q.Expression);
// System.String[].Select(w => new <>f__AnonymousType0`2(w = w, len = w.Length))
//   .Where(<>h__TransparentIdentifier0 => (<>h__TransparentIdentifier0.len > 3))
//   .OrderByDescending(<>h__TransparentIdentifier0 => <>h__TransparentIdentifier0.len)
//   .ThenBy(<>h__TransparentIdentifier0 => <>h__TransparentIdentifier0.w)
//   .Select(<>h__TransparentIdentifier0 => new <>f__AnonymousType0`2(...))
```

That compiler-generated parameter is a transparent identifier: in your source
you still write `len` and `w`, and the compiler rewrites them to member accesses
on the hidden object. Each `let` adds one more layer, which is an extra
allocation per item in memory and an extra projection a database provider has
to understand.

`into` ends one query and starts another over its result, which is how you
filter after grouping:

```csharp
var lengths = from w in words
              group w by w.Length into g
              where g.Count() > 1
              select g.Key;          // 6 (banana and cherry)
```

Operators without a clause (`Count`, `Distinct`, `Take`, `First`, `Sum`) are
called by wrapping the query in parentheses, so most real code mixes both
styles.

### Ordering: stable, composable, and culture-aware

`OrderBy` is documented as a stable sort: items with equal keys keep their
original relative order. A second `OrderBy`, however, starts a new primary
ordering and the first one only survives as a side effect of that stability:

```csharp
var people = new[] { ("Ana", 30), ("Bia", 25), ("Caio", 30), ("Duda", 25) };

people.OrderBy(p => p.Item2);
// (Bia, 25), (Duda, 25), (Ana, 30), (Caio, 30)

people.OrderBy(p => p.Item2).OrderBy(p => p.Item1.Length);
// (Bia, 25), (Ana, 30), (Duda, 25), (Caio, 30): sorted by name length only

people.OrderBy(p => p.Item1.Length).ThenBy(p => p.Item2);
// same result, but the intent is explicit and does not depend on stability
```

Use `ThenBy` for secondary keys. On `IQueryable`, stability is not guaranteed
at all: SQL `ORDER BY` returns ties in any order unless you add a unique column
as the last key.

.NET 7 added `Order()` and `OrderDescending()` for sorting by the item itself.
They use `Comparer<T>.Default`, which fails at run time for types that do not
implement `IComparable`, and for strings it compares using the current culture:

```csharp
string[] names = ["b", "a", "B", "A", "é", "e"];
CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
names.Order();                          // a A b B e é
names.Order(StringComparer.Ordinal);    // A B a b e é

new[] { new object(), new object() }.Order().ToList();
// InvalidOperationException: Failed to compare two elements in the array.
```

Pass `StringComparer.Ordinal` (or `OrdinalIgnoreCase`) when the order is
consumed by code, such as keys, file names, or deterministic output, and keep
culture-aware order for text shown to people.

### `OfType` versus `Cast`

Both turn a non-generic or loosely typed sequence into a typed one. `OfType<T>`
filters, `Cast<T>` asserts:

```csharp
object[] mixed = [1, "two", 3, null!, 4L];
mixed.OfType<int>();   // 1, 3: strings, null and the long are skipped
mixed.Cast<int>();     // InvalidCastException when it reaches "two"
```

`Cast<int>` unboxes, so a boxed `long` is not converted to an `int` even though
the value fits.

## Trade-offs

- **Query syntax reads well for joins and `let`, and poorly for everything
  else.** It has no clause for `Count`, `Take`, or `Distinct`, so a query often
  ends up half in each style. Pick one style per query where you can.
- **`let` allocates.** Each `let` wraps the current item in a new anonymous
  object. In a hot in-memory loop, a single `Select` into a tuple or a local
  function is cheaper.
- **`Single` is safer and slower than `First`.** It reads at least one extra
  item to prove uniqueness, which on a database becomes `TOP(2)` or
  `LIMIT 2`.
  ```csharp
  users.Single(u => u.Email == email);  // throws if the "unique" email is duplicated
  ```
- **Default string ordering depends on the machine.** The same `Order()` call
  can sort differently under another culture or ICU version, so sorted output
  in tests or file names should use an ordinal comparer.
- **`OfType` hides data problems.** It silently drops items of the wrong type,
  which is right for a mixed collection and wrong when every item was supposed
  to be a `T`; use `Cast` when an unexpected type is a bug.

## Documentation Links

- [Standard query operators overview, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/) (doc)
- [Write LINQ queries (query syntax versus method syntax), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/write-linq-queries) (doc)
- [Query expressions, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1223-query-expressions) (doc)
- [Enumerable.OrderBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby) (doc)
- [Enumerable.Order method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.order) (doc)
- [let clause, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/let-clause) (doc)
