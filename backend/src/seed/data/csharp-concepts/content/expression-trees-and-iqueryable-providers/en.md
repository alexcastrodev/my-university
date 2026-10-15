---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The same lambda, `o => o.Total > 100`, can compile to two very different
things. Assigned to a `Func<Order, bool>`, it becomes IL that the JIT runs.
Assigned to an `Expression<Func<Order, bool>>`, it becomes a data structure that
describes the code, which a library can read, rewrite, and translate into SQL
or anything else. `IQueryable<T>` is built on that second form: every operator
you chain adds a node to a tree, and a provider decides what to do with the
tree when you finally ask for results. This concept explains what an
expression tree contains, what the compiler refuses to put in one, how
`Queryable` and `IQueryProvider` cooperate, why a captured variable becomes a
SQL parameter, and how to build filters at run time without losing
translation or the query cache.

## Use Cases

- A search screen with optional filters that must still run as one SQL query.
- Combining two predicates with OR, which chaining `Where` cannot do.
- Understanding why `Where(o => IsBig(o))` fails in EF Core even though the
  method is trivial.
- Generating a query from user-chosen columns without string concatenation.
- Writing or debugging a library that inspects lambdas, such as a mapper or a
  validation framework.

## Deep Dive

### Code as data

The compiler turns a lambda assigned to `Expression<TDelegate>` into calls to
the `System.Linq.Expressions.Expression` factory methods. The result is a tree
you can walk:

```csharp
Func<Order, bool> f = o => o.Total > 100;
Expression<Func<Order, bool>> e = o => o.Total > 100;

Console.WriteLine(f.Method.Name);   // <<Main>$>b__0_0: a compiled method
Console.WriteLine(e);               // o => (o.Total > 100)
Console.WriteLine(e.Body.NodeType); // GreaterThan
var bin = (BinaryExpression)e.Body;
Console.WriteLine($"{bin.Left} | {bin.Right} | {bin.Right.Type}");
// o.Total | 100 | System.Decimal  (the compiler already converted 100 to decimal)

Func<Order, bool> compiled = e.Compile();   // turns the tree into a delegate
```

`Compile()` is how a tree becomes runnable again. It generates code at run time,
and it is not cheap: on the machine used for this concept, 1,000 calls to
`Compile()` took 143 ms, while one million calls to the resulting delegate took
4 ms. Compile once and cache the delegate.

The same tree can be built by hand, which is what dynamic query builders do:

```csharp
var p = Expression.Parameter(typeof(Order), "o");
var body = Expression.GreaterThan(
    Expression.Property(p, nameof(Order.Total)),
    Expression.Constant(100m));
var byHand = Expression.Lambda<Func<Order, bool>>(body, p);
Console.WriteLine(byHand);   // o => (o.Total > 100)
```

### What cannot be an expression tree

The expression tree API dates from C# 3, and the compiler only converts
constructs that have a node type in it. Much of the syntax added since then is
rejected at compile time, verified with the .NET 10 SDK:

```csharp
Expression<Func<Order, bool>> e1 = o => { return o.Total > 100; };
// CS0834: A lambda expression with a statement body cannot be converted to an expression tree
Expression<Func<Order, int?>> e2 = o => o.Customer?.Length;
// CS8072: An expression tree lambda may not contain a null propagating operator.
Expression<Func<Order, bool>> e3 = o => o is { Total: > 100 };
// CS8122: An expression tree may not contain an 'is' pattern-matching operator.
Expression<Func<Order, decimal>> e4 = o => o.Total switch { > 100 => 1m, _ => 0m };
// CS8514: An expression tree may not contain a switch expression.
Expression<Func<Order, (int, string)>> e5 = o => (o.Id, o.Customer);
// CS8143: An expression tree may not contain a tuple literal.
```

Calling a local function inside one fails too (CS8110). That is why EF Core
queries are written with `? :`, `==`, and anonymous types instead of the
pattern matching you use everywhere else.

### How `IQueryable` builds the tree

`IQueryable<T>` has three members: `ElementType`, `Expression` (the tree so
far), and `Provider`. `Queryable.Where` does not filter anything. Its body in
the .NET 10 source wraps the current tree in a call node and hands it to the
provider:

```csharp
return source.Provider.CreateQuery<TSource>(
    Expression.Call(null, /* Queryable.Where */ ...,
        source.Expression, Expression.Quote(predicate)));
```

Operators that return a value, such as `Count`, call `Provider.Execute<int>`
with the same kind of tree, and enumerating the query calls `GetEnumerator`.
A small provider that logs and delegates to the in-memory one makes the
protocol visible:

```csharp
var q = new LoggingQueryable<Order>(data.AsQueryable());
var big = q.Where(o => o.Total > 100).OrderBy(o => o.Customer);
// CreateQuery: Where
// CreateQuery: OrderBy
Console.WriteLine(big.Count());
// Execute: Order[].Where(o => (o.Total > 100)).OrderBy(o => o.Customer).Count()
foreach (var o in big) { }
// enumerate: Order[].Where(o => (o.Total > 100)).OrderBy(o => o.Customer)

class LoggingProvider(IQueryProvider inner) : IQueryProvider
{
    public IQueryable<TElement> CreateQuery<TElement>(Expression expression)
    {
        Console.WriteLine($"CreateQuery: {((MethodCallExpression)expression).Method.Name}");
        return new LoggingQueryable<TElement>(inner.CreateQuery<TElement>(expression));
    }
    public TResult Execute<TResult>(Expression expression)
    {
        Console.WriteLine($"Execute: {expression}");
        return inner.Execute<TResult>(expression);
    }
    // non-generic members omitted
}
```

`LoggingQueryable<T>` is a plain class that implements `IOrderedQueryable<T>`,
returns the inner `Expression`, and logs in `GetEnumerator`. EF Core's
`DbSet<T>` follows the same protocol; its provider translates the whole tree
to SQL at `Execute` or enumeration time.

### Why some C# never reaches SQL

A provider receives the tree, not your IL. A call to your own method appears as
a `MethodCallExpression` holding a `MethodInfo`: a name and a signature, with no
body the provider could inspect. EF Core knows a fixed list of methods
(`string.StartsWith`, `Contains` on a collection, `EF.Functions.Like`, and so
on) and cannot translate anything else in a filter:

```csharp
db.Orders.Where(o => Rules.IsBig(o));                // InvalidOperationException: could not be translated
db.Orders.Select(o => Rules.Label(o.Total));         // works: SELECT "o"."Total", Label runs in .NET
```

The final projection is the one place where EF Core runs .NET code on the
results. Where translation stops and how to cross into memory deliberately
with `AsEnumerable` are covered in the EF Core query translation concept.

### Captured variables become parameters

A captured local is not a constant in the tree. The compiler stores it in a
closure object, and the tree holds a field access on that object:

```csharp
var min = 100;
db.Orders.Where(o => o.Total > min).Expression;
// [EntityQueryRootExpression].Where(o => (o.Total > value(Program+<>c__DisplayClass0_0).min))
```

Before translating, EF Core runs a visitor (`ExpressionTreeFuncletizer` in the
EF Core 10 source) that evaluates every subtree that does not depend on the
database. Captured variables become SQL parameters, and subtrees without them
become constants:

```sql
-- o.Total > min
WHERE "o"."Total" > @min
-- o.Total > 100
WHERE "o"."Total" > 100
```

This matters for caching. EF Core caches the translation per tree shape, and
the database caches plans per SQL text. A tree built by hand with
`Expression.Constant(min)` produces `> 100`, then `> 200`, a new query for every
value. To get a parameter in a hand-built tree, take the body of a lambda that
captures the value:

```csharp
Expression<Func<int>> holder = () => min;
var pred = Expression.Lambda<Func<Order, bool>>(
    Expression.GreaterThan(Expression.Property(p, "Total"), holder.Body), p);
// WHERE "o"."Total" > @min
```

### Dynamic filters

For optional AND filters, the simplest dynamic query is no tree building at
all, because each `Where` on an `IQueryable` composes:

```csharp
IQueryable<Order> query = db.Orders;
if (customer is not null) query = query.Where(o => o.Customer == customer);
if (minTotal is not null) query = query.Where(o => o.Total >= minTotal);
// with only customer set: WHERE "o"."Customer" = @customer
```

OR needs one tree with both conditions. Each lambda has its own parameter
object, so combining their bodies directly would produce a tree with two
different `o`s. An `ExpressionVisitor` rewrites one body to use the other's
parameter:

```csharp
public static Expression<Func<T, bool>> Or<T>(
    this Expression<Func<T, bool>> left, Expression<Func<T, bool>> right)
{
    var param = left.Parameters[0];
    var rightBody = new ReplaceParameter(right.Parameters[0], param).Visit(right.Body);
    return Expression.Lambda<Func<T, bool>>(Expression.OrElse(left.Body, rightBody), param);
}

sealed class ReplaceParameter(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
{
    protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : node;
}

Expression<Func<Order, bool>> a = o => o.Total > 200;
Expression<Func<Order, bool>> b = x => x.Customer == "Ana";
db.Orders.Where(a.Or(b));
// WHERE "o"."Total" > 200 OR "o"."Customer" = 'Ana'
```

`ExpressionVisitor` rebuilds only the nodes that change, so the same pattern
serves for any rewrite: replacing a parameter, renaming a member, or
inlining a constant.

## Trade-offs

- **Expression trees trade language features for portability.** Pattern
  matching, `?.`, switch expressions, and tuples are off the table inside
  them, so query code reads older than the rest of the codebase.
- **`Compile()` is expensive.** Compiling a tree on every call can cost far
  more than the work the delegate does. Cache compiled delegates, keyed by
  whatever makes the tree differ.
- **`Expression.Constant` defeats caches.** A dynamic tree with a constant per
  value recompiles in EF Core and floods the database plan cache, as the EF
  Core performance guide warns. Use a captured variable instead.
- **A provider is a contract you cannot see in the types.** Any
  `IQueryable<T>` accepts any operator at compile time, and only the provider
  decides at run time what it supports, so tests against an in-memory
  `AsQueryable()` can pass while the real provider throws.
  ```csharp
  orders.AsQueryable().Where(o => Rules.IsBig(o)).ToList();  // works in memory
  db.Orders.Where(o => Rules.IsBig(o)).ToList();              // throws in EF Core
  ```
- **Hand-written visitors are code to maintain.** For one or two combinations,
  a visitor is fine; for a full search language, an existing predicate-builder
  library may be cheaper than your own.
- **`AsQueryable` is not trimming- or AOT-friendly.** The SDK warns (IL2026,
  IL3050) that the in-memory provider may need code generated at run time,
  which a Native AOT app cannot do.

## Documentation Links

- [Expression trees, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/) (doc)
- [Build expression trees, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-building) (doc)
- [Translate expression trees (ExpressionVisitor), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/expression-trees-translating) (doc)
- [IQueryProvider interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.iqueryprovider) (doc)
- [How queries work, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/how-query-works) (doc)
- [Advanced performance topics, dynamically-constructed queries, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#dynamically-constructed-queries) (doc)
- [Queryable.Where builds a call node and calls CreateQuery, dotnet/runtime source (release/10.0)](https://github.com/dotnet/runtime/blob/591ede817344fa749dd1af56d7e73b356da3e71a/src/libraries/System.Linq.Queryable/src/System/Linq/Queryable.cs#L48-L58) (doc)
- [ExpressionTreeFuncletizer, dotnet/efcore source (release/10.0)](https://github.com/dotnet/efcore/blob/92ae3223006b08f94e4d30fb3f7e5de622f6833c/src/EFCore/Query/Internal/ExpressionTreeFuncletizer.cs#L12-L23) (doc)
