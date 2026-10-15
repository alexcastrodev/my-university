---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An extension method is a static method in a static class whose first
parameter is marked with `this`. Callers write `value.Method()` and the
compiler turns it into `StaticClass.Method(value)`. That small trick is how LINQ
gives every `IEnumerable<T>` dozens of methods and how ASP.NET Core registers
whole features with one `services.AddX()` call. This concept covers the
classic `this` syntax: how the compiler binds a call, why the type's own
members always win, how namespaces decide which extension is found, extensions
over interfaces and generics, `null` receivers, and the fluent style built on
top of them. The C# 14 extension blocks, which add properties, static members
and operators, are the next concept.

## Use Cases

- Adding helpers to types you do not own (`string`, `IEnumerable<T>`,
  `HttpClient`) without wrappers or subclasses.
- Giving every implementation of an interface the same behavior, the way
  `System.Linq` does for `IEnumerable<T>`.
- `IServiceCollection.AddX()` methods that register a feature's services in
  one discoverable call.
- Fluent configuration and builders: `builder.Services.AddA().AddB()`.
- Keeping layer-specific behavior (formatting, mapping) out of a DTO or entity.

## Deep Dive

### What the compiler does with it

```csharp
using System.Reflection;                  // brings CustomAttributeExtensions.IsDefined
using System.Runtime.CompilerServices;

public static class TextExtensions
{
    public static string Shout(this string s) => s.ToUpperInvariant() + "!";
}

"hi".Shout()                   // HI!
TextExtensions.Shout("hi")     // HI!  (the same call, written out)
typeof(TextExtensions).GetMethod("Shout")!.IsDefined(typeof(ExtensionAttribute))  // True
typeof(TextExtensions).IsDefined(typeof(ExtensionAttribute))                      // True
```

The method is an ordinary public static method. `this` makes the compiler mark
the method, its class and the assembly with `[Extension]`, which is how a
compiler finds extension methods in a referenced assembly. The snippet itself
uses one: `IsDefined(Type)` with a single argument is an extension from
`System.Reflection`; without that `using`, the call fails with CS7036 because
the instance overload needs an `inherit` argument. The class must be static,
non-generic and not nested. An extension method sees only the receiver's
accessible members: it does not break encapsulation.

### The type's own members always win

The C# specification says extension methods are tried only "if the normal
processing of the invocation finds no applicable methods". An applicable
instance method wins even when the extension is a better match:

```csharp
public class Printer { public string Print(object o) => "instance(object)"; }
public static class PrinterExtensions
{
    public static string Print(this Printer p, string s) => "extension(string)";
}

new Printer().Print("hi")      // instance(object)
```

The `string` overload is more specific, yet it is never considered, because
`Print(object)` already applies. The consequence for libraries: if a type later
adds a member with your extension's name and a compatible signature, every
call site silently switches to it on the next compile.

### Bound at compile time, by static type

An extension call is resolved like any static call, from the compile-time type
of the receiver. There is no virtual dispatch:

```csharp
public static string Describe(this object o) => "object";
public static string Describe(this string s) => "string";

object o = "text";
o.Describe() + " " + "text".Describe()     // object string

dynamic d = "hi";
d.Shout();   // RuntimeBinderException: 'string' does not contain a definition for 'Shout'
```

The specification states it directly: when the receiver or any argument is
`dynamic`, extension methods do not apply. The receiver also needs an
identity, reference or boxing conversion to the `this` parameter, so numeric
widening does not count:

```csharp
public static long Twice(this long x) => x * 2;
5.Twice();
// error CS1929: 'int' does not contain a definition for 'Twice' and the best
//   extension method overload 'LongExtensions.Twice(long)' requires a receiver of type 'long'
```

### Scope: the closest namespace wins

Extension methods are imported per namespace: `using System.Linq;` brings in
every static class of that namespace. When several match, the compiler walks
outward from the call site, from the innermost namespace declaration to the
compilation unit, and stops at the first level that has candidates. At each
level, extensions declared in that namespace are tried before the ones its
`using` directives import. Three runs with the same `Origin(this object)`
declared in `Lib`, `Other` and `App`:

| Call site | Result |
|---|---|
| inside `namespace App`, `using Lib;` at the top of the file | `App` (own namespace, closer) |
| inside `namespace App.Inner { using Lib; ... }` | `Lib` (the inner `using` is closer than `App`) |
| `using Lib; using Other;` at the same level | error CS0121: The call is ambiguous between 'Lib.LibExtensions.Origin(object)' and 'Other.OtherExtensions.Origin(object)' |

Calling the static method by name (`LibExtensions.Origin(o)`) always resolves
an ambiguity.

### Extending interfaces and generic types

An extension on an interface reaches every implementation, which is the whole
design of LINQ. A generic extension can also carry constraints:

```csharp
public static IEnumerable<T> EveryOther<T>(this IEnumerable<T> source)
{
    ArgumentNullException.ThrowIfNull(source);   // runs at the call
    return Iterate(source);

    static IEnumerable<T> Iterate(IEnumerable<T> s)
    {
        bool take = true;
        foreach (var x in s) { if (take) yield return x; take = !take; }
    }
}

public static bool IsBetween<T>(this T value, T low, T high) where T : IComparable<T>
    => value.CompareTo(low) >= 0 && value.CompareTo(high) <= 0;

new[] { 1, 2, 3, 4, 5 }.EveryOther()          // 1,3,5
new List<string> { "a", "b", "c" }.EveryOther()  // a,c
5.IsBetween(1, 10) + " " + "m".IsBetween("a", "f")   // True False
```

The split between the public method and a local iterator is deliberate: an
iterator body runs only when enumeration starts, so a guard inside it would
fire late. The iterators concept explains that deferral.

### `null` receivers

Because the call is static, a `null` receiver does not throw at the call
site. What happens next depends on the method:

```csharp
public static bool IsBlank(this string? s) => string.IsNullOrWhiteSpace(s);

string? missing = null;
missing.IsBlank()               // True
missing!.Shout()                // NullReferenceException, thrown inside Shout
int[]? none = null;
none!.Where(x => x > 0)         // ArgumentNullException (source)
none!.EveryOther()              // ArgumentNullException (source)
```

Pick one contract per method: either accept `null` on purpose and say so with
a nullable parameter (`string?`), or reject it with
`ArgumentNullException.ThrowIfNull`, as LINQ does. A
`NullReferenceException` from inside your helper is the worst of both.

For value types, `this ref int x` passes the receiver by reference, so
`n.Bump()` turned 41 into 42; without `ref` the method works on a copy. The
docs restrict `ref` receivers to value types and generic types constrained to
`struct`.

### Fluent APIs

A fluent API returns something you can keep calling on. There are two kinds,
and they fail differently:

```csharp
var sb = new StringBuilder();
ReferenceEquals(sb.Append("a"), sb)          // True: mutable, returns itself

public sealed record Order(IReadOnlyList<string> Items)
{
    public static Order Empty { get; } = new([]);
    public Order WithItem(string item) => this with { Items = [.. Items, item] };
}
Order.Empty.WithItem("book").WithItem("pen")  // book+pen: immutable, returns a new value
var copy = Order.Empty;
copy.WithItem("lost");                        // result ignored
copy.Items.Count                              // 0
```

A mutating builder is cheap but shared state leaks if two callers hold it. An
immutable one is safe to share, and the classic bug is dropping the returned
value.

Extension methods give fluency to types you do not own. The ASP.NET Core docs
describe the convention: a single `Add{GROUP NAME}` method per feature, in the
`Microsoft.Extensions.DependencyInjection` namespace so it shows up wherever
`IServiceCollection` is used, returning the collection for chaining:

```csharp
namespace Microsoft.Extensions.DependencyInjection
{
    using Microsoft.Extensions.DependencyInjection.Extensions;

    public static class ClockServiceCollectionExtensions
    {
        public static IServiceCollection AddClock(this IServiceCollection services)
        {
            ArgumentNullException.ThrowIfNull(services);
            services.TryAddSingleton<IClock, SystemClock>();
            return services;
        }
        // AddGreeter(this IServiceCollection, Action<GreeterOptions>) registers two services
    }
}

var services = new ServiceCollection().AddClock().AddClock().AddGreeter(o => o.Prefix = "Hi");
services.Count                                                   // 3
services.BuildServiceProvider().GetRequiredService<Greeter>().Greet("Ana")  // Hi Ana
```

`TryAddSingleton` makes `AddClock` idempotent: calling it twice registered one
clock. The lifetimes themselves are the subject of the dependency injection
concept in the .NET track.

### A classic trap: `Reverse`

`List<T>` has an instance `void Reverse()`, so `list.Reverse()` reverses in
place and `var r = list.Reverse();` fails with CS0815 "Cannot assign void to an
implicitly-typed variable"; LINQ's `Reverse` is
reached with `list.AsEnumerable().Reverse()`. For arrays, the C# 14 breaking
changes page explains that the new span conversions could make `array.Reverse()`
bind to the in-place `MemoryExtensions.Reverse`, and that `net10.0` avoids it
with an `Enumerable.Reverse(this T[])` overload. On .NET 10 `arr.Reverse()`
returned a `ReverseIterator` and left the array untouched.

## Trade-offs

- **Discoverability versus surprise.** Readers cannot tell from `x.Foo()`
  whether `Foo` belongs to the type. Put extensions in a namespace named after
  what they extend and keep them few.
- **Fragile to upstream changes.** A new instance member with the same name
  silently replaces your extension at the next compile, and a new extension in
  another imported namespace can turn a working call into CS0121.
- **No polymorphism.** Overloads are picked by static type, so an extension
  cannot replace a `virtual` method.
  ```csharp
  object o = "text";
  o.Describe();   // "object", even though o holds a string
  ```
- **Extensions on `object` or `T` without constraints pollute IntelliSense
  everywhere.** Prefer the narrowest receiver type.
- **Not a substitute for owning the code.** The docs prefer changing the type
  or deriving from it when you can, and advise library authors not to use
  extension methods to avoid a version bump.

## Documentation Links

- [Extension members, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods) (doc)
- [How to implement and call a custom extension method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/how-to-implement-and-call-a-custom-extension-method) (doc)
- [Extension method invocations, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#128103-extension-method-invocations) (doc)
- [Dependency injection in ASP.NET Core: register groups of services with extension methods, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection#register-groups-of-services-with-extension-methods) (doc)
- [C# compiler breaking changes since C# 13 (Enumerable.Reverse), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2010) (doc)
- [ExtensionAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.extensionattribute) (doc)
