---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

The Gang of Four patterns came from C++ and Smalltalk, with no delegates,
records, pattern matching or DI container. Several are now a language feature
or a one-liner, so "I would use a Visitor" is often the wrong code review
answer. This concept rewrites four patterns in the C# of today and measures
what each costs: Strategy (an interface, a `Func<>`, keyed services), Decorator
(by hand, in the built-in container, with Scrutor), State (an `enum` and a
`switch`, records, or classes) and Visitor (double dispatch against a `switch`
over a closed hierarchy), then the closed set of cases they rely on: a union,
or its record-based simulation. Everything ran on `net10.0`; the C# 15 parts are
"docs only" here (the SDK is 10.0.100) and measured in their own concepts.

Versions: .NET SDK 10.0.100 (runtime 10.0.0), TFM `net10.0`, C# 14,
`Microsoft.Extensions.DependencyInjection` 10.0.0, `Scrutor` 7.0.0, `xunit` 2.9.3.

## Use Cases

- Answering "implement Strategy, Decorator, State or Visitor in C#" in an interview.
- Reviewing legacy `IFooVisitor` code, or adding logging or caching in the container.

## Deep Dive

### Book versus today

The book presents patterns as answers to what the language lacked. In 1996
Peter Norvig counted 16 of the 23 patterns as "invisible or simpler" in Lisp
or Dylan, with Strategy and Visitor under
"first-class functions" (his slides say "Visitor pattern serves only to get
around restriction", in a list of what C++ class-based design forces on you).
C# has since gained delegates, records, `switch` patterns and a container, so
the same reasoning applies: the patterns still name real problems, but need less
code. Timings are `Stopwatch` medians of 5 runs of 10 to 100 million iterations
in Release: good for ratios, not a BenchmarkDotNet result.

### Strategy: a delegate, an interface, or a key

The problem: swap an algorithm without an `if` chain. When the strategy is one
method, a `Func<decimal, decimal>` constructor parameter is the lean version:
`new CheckoutFunc(p => p / 2).Total(100m)` returned `50`. An interface earns
its place with several members, state or a name to log. The call cost is the
same: 3.40 ns through a `static` lambda and 3.46 ns through an interface (both
with a `decimal` multiply), 0 bytes. The trap is a capturing lambda built per
call: 10.02 ns and 96 bytes.

With DI (see `/dotnet-concepts/dependency-injection-and-service-lifetimes`),
.NET 8 keyed services pick an implementation by name, so you do not inject a
collection and filter it:

```csharp
services.AddKeyedSingleton<IDiscount, NoDiscount>("none");
services.AddKeyedSingleton<IDiscount, Vip>("vip");
public sealed class Checkout([FromKeyedServices("vip")] IDiscount discount) { /* ... */ }
```

`Checkout.Total(100m)` returned `90.0`. With plain registrations,
`IEnumerable<IDiscount>` held 2 items and `GetRequiredService<IDiscount>()`
returned the last one. An unknown key threw `InvalidOperationException:
No keyed service for type 'IDiscount' using key type 'System.String' has been
registered.` Resolving by key cost 10.21 ns against 9.71 ns for a plain lookup,
so resolve once and keep the instance. The container does not inject a `Func<T>`
for you: the guidelines list `Func<T>` support among what it does not offer.

### Decorator: composition, then the container

The problem: add behavior around a service without editing it or inheriting.
By hand it is plain composition, `new LoggingOrders(new CachingOrders(new
Orders()), log)`. In the container there are three routes, all run:

1. **A factory:** `AddSingleton<IOrders>(sp => new LoggingOrders(new
   CachingOrders(sp.GetRequiredService<Orders>()), log))`: no package, but you
   wire the chain.
2. **A keyed inner service:** register the real one under a key and the
   decorator unkeyed, asking for the key in its constructor:

```csharp
services.AddKeyedSingleton<IOrders, Orders>("inner");
services.AddSingleton<IOrders, KeyedLogging>();  // ctor: [FromKeyedServices("inner")] IOrders inner
```

   `Get(3)` logged `keyed get 3`: the built-in way, one key per layer.
3. **Scrutor:** `Microsoft.Extensions.DependencyInjection` has no `Decorate`
   method: `services.Decorate<I, Dec>()` without the package is `CS1061:
   'ServiceCollection' does not contain a definition for 'Decorate'`. Scrutor
   7.0.0 (the latest on NuGet when I checked, with a `net10.0` target) adds it:

```csharp
services.AddSingleton<IOrders, Orders>();
services.Decorate<IOrders, CachingOrders>();
services.Decorate<IOrders>((inner, sp) => new LoggingOrders(inner, log));
```

The last `Decorate` is the outermost: `GetRequiredService<IOrders>()` returned a
`LoggingOrders`, and two `Get(1)` calls logged `get 1` twice (the outer layer
sees every call, the cache only the first). The descriptors show the inner
registrations moved under generated keys (`IOrders+<guid>+Decorated`), so
Scrutor 7 builds on keyed services. The lifetime is kept: a scoped service
stayed one instance per scope. `Decorate` for a type never registered threw
`DecorationException: Could not find any registered services for type
'IOrders'.`, so call it after the registration.

Three pass-through decorators cost 2.13 ns per call against 0.45 ns for none,
0 bytes allocated (the JIT probably optimized the bare call heavily, which I did
not inspect: read it as a ratio). `BufferedStream` is a framework decorator (see
`stream-class-hierarchy-and-decorators`), and ASP.NET Core middleware already
wraps every request, so request logging belongs there.

### State: an enum, records, or classes

The problem: behavior depends on a state and only some transitions are legal.
The lean version is an `enum` and a `switch` over the (state, event) tuple:

```csharp
public static OrderState Next(OrderState s, OrderEvent e) => (s, e) switch
{
    (OrderState.Pending, OrderEvent.Pay)    => OrderState.Paid,
    (OrderState.Paid, OrderEvent.Ship)      => OrderState.Shipped,
    (OrderState.Pending, OrderEvent.Cancel) => OrderState.Cancelled,
    (OrderState.Paid, OrderEvent.Cancel)    => OrderState.Cancelled,
    _ => throw new InvalidOperationException($"{e} is not allowed in {s}"),
};
```

`Pending` with `Pay` then `Ship` gave `Shipped`, and `Next(Shipped, Cancel)`
threw `Cancel is not allowed in Shipped`. It ran at 0.52 ns with 0 bytes, and the
state is a plain value for a column or a JSON field. When each state carries its
own data, use one record per state and return the next one:

```csharp
public abstract record Doc { private Doc() { }
    public sealed record Draft(string Text) : Doc;
    public sealed record InReview(string Text, string Reviewer) : Doc;
    public Doc Submit(string reviewer) => this switch
    {
        Draft d => new InReview(d.Text, reviewer),
        _ => throw new InvalidOperationException($"cannot submit {GetType().Name}"),
    };
}
```

`Submit` printed `InReview { Text = hello, Reviewer = ana }`, and a second submit
threw `cannot submit InReview`. A `Draft` has no reviewer field, so that illegal
state cannot exist, for an allocation per transition: 3.36 ns and 32 bytes. The
GoF version (a class per state behind an interface, singleton instances)
measured 1.42 ns and 0 bytes, and pays off when each state has several
behaviors. A tuple `switch` with no `_` arm warns `CS8509` and names the gap
(`the pattern '(S.A, E.Y)' is not covered`), and an `enum` switch also warns
`CS8524` for unnamed values (`(S)3`), so a throwing discard arm is common.

### Visitor: double dispatch versus a switch

The problem: add operations over a hierarchy without editing every class. The
classic answer is double dispatch: each node has `Accept(visitor)` and calls
`visitor.Visit(this)`, so the runtime type picks the overload:

```csharp
// IShapeVisitor<T> has Visit(Shape.Circle) and Visit(Shape.Rect); every node has
// public override T Accept<T>(IShapeVisitor<T> v) => v.Visit(this);
public static double Area(Shape s) => s switch
{
    Shape.Circle c => Math.PI * c.R * c.R,
    Shape.Rect r   => r.W * r.H,
    _ => throw new UnreachableException(),
};
```

Both gave `3.142, 6.000`. `Accept` (a generic virtual method plus an interface
call) took 2.69 ns, the `switch` 0.83 ns, both 0 bytes. The operation lives in
one method, with no interface and no `Accept` on every node. What the visitor
still gives on `net10.0` is a compile error when a node is added: with a
`Triangle`, `class Area : IShapeVisitor<double>` fails with `CS0535: 'Area'
does not implement interface member`. The `switch` with the `_` arm printed no
diagnostic and sends the `Triangle` to the `throw` at runtime; without the `_`
arm it warns `CS8509 ... the pattern '_' is not covered`, because C# 14 cannot
know the hierarchy is closed. Keep a visitor when it gives you the traversal:
`ExpressionVisitor` "is designed to be inherited to create more specialized
classes whose functionality requires traversing, examining or copying an
expression tree" (see `expression-trees-and-iqueryable-providers`).

### A closed set of cases: simulate today, union and closed in C# 15

Visitor and State want the compiler to know every case. Today you simulate it:
an abstract record with a `private` constructor and the cases nested inside, as
`Shape` and `Doc` above. Only nested types can call the private
constructor: `record Evil : Shape;` outside is `CS0122: 'Shape.Shape()' is
inaccessible due to its protection level`. The `switch` still needs its `_` arm.

C# 15 (shipped with the .NET 11 SDK, per the C# 15 page) adds two ways to get
exhaustiveness (docs only here, run in the linked concepts):

```csharp
closed record class Shape;                 // direct subclasses must live in this assembly
public union Pet(Cat, Dog, Bird);          // a value that is exactly one of these types
```

On this machine both are syntax errors under C# 14: `union Pet(Cat, Dog)` gave
`CS1001: Identifier expected` and `CS8803`, and `closed record class` gave
`CS1002: ; expected`. See `union-types-in-csharp-15` and
`closed-classes-and-exhaustive-hierarchies`. The csharplang proposal describes
unions as type unions, not tagged ones: a discriminated union uses fresh type
declarations as the case types, or a closed hierarchy. A separate
discriminated-union proposal folder exists and the C# 15 page does not list it,
so I treat it as not shipped. With either feature the `switch` loses its `_`
arm, and a new case becomes a warning at every `switch`, the property the
visitor gave you by erroring (see `result-types-versus-exceptions`).

### A test for each

```csharp
[Fact] public void Strategy_comes_from_the_key() => Assert.Equal(90m,
    new ServiceCollection().AddKeyedSingleton<IDiscount, Vip>("vip")
        .AddTransient<Checkout>().BuildServiceProvider()
        .GetRequiredService<Checkout>().Total(100m));
```

Seven xunit tests passed: Strategy by key and by delegate, the `Decorate` order,
two legal transitions, one illegal (`Assert.Throws`), visitor equals switch.

### Classic pattern, C# today, when not to use it

| Classic pattern | Equivalent in C# today | When NOT to use it |
|---|---|---|
| Strategy | `Func<>`, or an interface picked by a keyed service | One call site with one algorithm: an `if` is clearer |
| Decorator | Composition, a keyed inner service or Scrutor `Decorate` | Per-request HTTP concerns: use middleware |
| State | `enum` plus `switch` on (state, event); records if states carry data | Two states and one flag: a `bool` is enough |
| Visitor | `switch` over a closed hierarchy of records | You need a traversal that rebuilds a tree (`ExpressionVisitor`) |
| Union (sum type) | Private-constructor record hierarchy; `union` or `closed` in C# 15 (docs only) | An open set that plugins extend |

## Trade-offs

- **Less ceremony, less naming.** A `Func<>` or a `switch` replaces an interface
  and N classes at the same 3.4 ns, but a lambda has no name in logs and no
  place for state or a lifetime.
- **Compile-time safety moves.** The visitor errors when a node is added; the
  `switch` only warns, or is silent behind a `_ => throw` arm. Turn `CS8509`
  into an error, or wait for `closed`.
- **Keyed services are strings in disguise.** `"vip"` is not checked at compile
  time (an unknown key threw at resolution), so use constants as keys. Scrutor
  is a dependency for one method: the keyed route needs none, but it keeps
  the lifetime and reads better with several layers.
- **Records for states allocate** (32 bytes per transition measured): use an
  `enum` in a hot loop. A `net10.0` library keeps the simulation, since C# 15
  features need .NET 11.

## Documentation Links

- [Dependency injection overview (keyed services), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview) (doc)
- [Dependency injection guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines) (doc)
- [Scrutor, assembly scanning and decoration, GitHub](https://github.com/khellang/Scrutor) (doc)
- [ASP.NET Core middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/) (doc)
- [ExpressionVisitor, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.expressions.expressionvisitor) (doc)
- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-15.0/unions.md) (doc)
- [Closed hierarchies proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-15.0/closed-hierarchies.md) (doc)
- [Design Patterns in Dynamic Languages, Peter Norvig](https://norvig.com/design-patterns/) (doc)
