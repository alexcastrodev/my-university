---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

LINQ is C#'s answer to the Java Stream API: a set of query operators (`Where`,
`Select`, `OrderBy`, `GroupBy`) over any sequence. What surprises people is not
the operators but when they run. Most LINQ operators are lazy: they build a
pipeline of iterators and do nothing until something enumerates the result. That
one fact explains queries that return stale data, queries that run twice,
exceptions thrown far from the line that caused them, and the difference between
`IEnumerable<T>` and `IQueryable<T>`, where one runs in memory and the other is
translated to SQL by EF Core. This concept covers `yield return`, deferred
execution, multiple enumeration, closures, streaming versus buffering, and the
LINQ operators added in .NET 9.

## Use Cases

- Writing a method that produces a long or infinite sequence without building a
  list in memory.
- Debugging a query whose result changes between two `foreach` loops, or that
  hits the database twice.
- Deciding whether a filter runs in the database or in the application after
  loading the whole table.
- Grouping and counting items without writing the dictionary code by hand.
- Understanding why an `ArgumentNullException` appears at the loop, not at the
  call that passed the `null`.

## Deep Dive

### `yield return` and the iterator state machine

A method that uses `yield return` is not run when you call it. The compiler
rewrites it into a class that implements `IEnumerable<T>` and `IEnumerator<T>`,
with a state field and the method body split at every `yield`. Each `MoveNext()`
runs the code up to the next `yield return`:

```csharp
static IEnumerable<int> Evens(int max)
{
    Console.WriteLine("start");
    for (var i = 0; i <= max; i += 2)
    {
        Console.WriteLine($"yield {i}");
        yield return i;
    }
    Console.WriteLine("end");
}

var seq = Evens(4);            // prints nothing
foreach (var n in seq) { }     // start, yield 0, yield 2, yield 4, end
```

Memory use stays constant: only the current item and the loop variables live in
the iterator. That is what lets you write `while (true) yield return Next();`
and take what you need.

### Deferred execution

`Where`, `Select`, `Take`, `SkipWhile` and most other operators return an
iterator that wraps the previous one. Building the query does no work; the work
happens when something enumerates it, through `foreach`, `ToList()`, `Count()`,
`First()` or `Any()`:

```csharp
var numbers = new List<int> { 1, 2, 3 };
var query = numbers.Where(n => n > 1);   // nothing runs yet

numbers.Add(4);                          // the source changes
Console.WriteLine(string.Join(",", query)); // 2,3,4: the query saw the new item
```

The query is a recipe, not a result. It reads the source at enumeration time,
so it reflects whatever the source contains then.

### Multiple enumeration

Each enumeration of a lazy query runs the whole pipeline again, including its
source. If the source is a database query, an HTTP call, or a method with side
effects, it runs again too:

```csharp
IEnumerable<int> Load()
{
    Console.WriteLine("loading");
    yield return 1;
    yield return 2;
}

var items = Load();
var count = items.Count();   // prints "loading"
var first = items.First();   // prints "loading" again

var snapshot = Load().ToList();   // run once, keep the result
var total = snapshot.Count;       // no reload
```

Materialize with `ToList()` or `ToArray()` when you need the data more than once,
or when you need a snapshot that later changes to the source cannot affect.

### Closures capture variables, not values

A lambda in a query captures the variable, so the value it sees is the one at
enumeration time:

```csharp
var threshold = 1;
var query = numbers.Where(n => n > threshold);

threshold = 3;
Console.WriteLine(string.Join(",", query)); // uses 3, not 1
```

This is a classic source of "the filter ignored my value" bugs when a loop
variable or a field changes between building the query and running it.

### IEnumerable versus IQueryable

`Enumerable` methods take a `Func<T, bool>` and run in memory. `Queryable`
methods take an `Expression<Func<T, bool>>`, which is an expression tree the
provider can inspect and translate, which is how EF Core turns a `Where` into
SQL:

```csharp
IQueryable<Order> q = db.Orders.Where(o => o.Total > 100);      // translated to SQL
IEnumerable<Order> e = db.Orders;                                // the type is now IEnumerable
var wrong = e.Where(o => o.Total > 100).ToList();                // loads every row, filters in memory
```

The compile-time type chooses the operator overload. Assign a `DbSet` or an
`IQueryable` to an `IEnumerable<T>` variable, or call `AsEnumerable()`, and
every operator after that runs in the application. Keep the query as
`IQueryable<T>` until the last moment, and call `ToListAsync()` or similar to
run it.

### Streaming versus buffering

Streaming operators yield each item as soon as they have it: `Where`, `Select`,
`Take`, `Skip`, `Concat`. Buffering operators must read the whole source before
they can yield the first item: `OrderBy`, `OrderByDescending`, `GroupBy`,
`Reverse`, and the inner side of `Join`:

```csharp
var firstBig = Huge().Where(x => x > 10).First();     // stops at the first match
var sorted = Huge().OrderBy(x => x).First();          // reads and sorts everything first
```

A buffering operator on an infinite sequence never finishes, and on a big one it
uses memory proportional to the input.

### Operators added in .NET 9

`CountBy`, `AggregateBy` and `Index` remove common boilerplate:

```csharp
var words = new[] { "apple", "avocado", "banana", "blueberry", "cherry" };

foreach (var (letter, count) in words.CountBy(w => w[0]))
    Console.WriteLine($"{letter}: {count}");              // a: 2, b: 2, c: 1

foreach (var (index, word) in words.Index())               // replaces Select((w, i) => (i, w))
    Console.WriteLine($"{index} {word}");

var lengths = words.AggregateBy(w => w[0], seed: 0, (sum, w) => sum + w.Length);
```

### An exception in the middle of the loop

Because the pipeline runs item by item, an exception thrown while computing
item 3 happens after items 1 and 2 were already processed:

```csharp
var results = new[] { "1", "2", "x", "4" }.Select(int.Parse);

foreach (var r in results)       // handles 1 and 2, then FormatException on "x"
    Console.WriteLine(r);
```

The `foreach` disposes the enumerator when it exits, which runs the `finally`
blocks inside any iterator method that was still active. LINQ's own operators
check arguments such as a `null` source immediately, but your own iterator
methods do not: their argument checks run at the first `MoveNext()`. Split the
method into a public one that validates and a private iterator that yields:

```csharp
public static IEnumerable<T> Where2<T>(IEnumerable<T> source, Func<T, bool> pred)
{
    ArgumentNullException.ThrowIfNull(source);   // runs when called
    ArgumentNullException.ThrowIfNull(pred);
    return Iterate(source, pred);

    static IEnumerable<T> Iterate(IEnumerable<T> s, Func<T, bool> p)
    {
        foreach (var x in s) if (p(x)) yield return x;
    }
}
```

## Trade-offs

- **Lazy queries hide cost and side effects.** The line that builds a query is
  cheap, and the line that enumerates it pays for everything.
  ```csharp
  var q = orders.Select(o => Expensive(o));   // free
  var a = q.Count();                           // runs Expensive for every order
  var b = q.ToList();                          // runs it again
  ```
- **`ToList()` fixes that and makes a copy.** It removes repeated work and gives
  a stable snapshot, but it allocates, and it evaluates the whole sequence even
  if you only needed the first few items.
- **A query can outlive the data it reads.** A lazy query that closes over a
  `DbContext` or a stream breaks when it is enumerated after the context is
  disposed.
  ```csharp
  IEnumerable<Order> Get() { using var db = new Db(); return db.Orders.Where(o => o.Open); }
  Get().ToList();   // ObjectDisposedException: the query runs after the using block ended
  ```
- **LINQ allocates.** Each operator allocates an iterator and a delegate, and a
  hot loop over a small array can be several times slower than a `for` loop.
  Measure before rewriting readable code, and prefer LINQ outside the hottest
  paths.
- **`IQueryable` leaks the provider into your signatures.** A repository that
  returns `IQueryable<T>` lets callers add filters that the provider may not be
  able to translate, and those fail at runtime. Returning a materialized list
  or a specific result type keeps the boundary clear.

## Documentation Links

- [Language Integrated Query (LINQ), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/) (doc)
- [yield statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield) (doc)
- [Enumerable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable) (doc)
- [Queryable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.queryable) (doc)
- [Client vs. server evaluation, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/client-eval) (doc)
- [What's new in .NET 9 libraries, LINQ, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/libraries#linq) (doc)
