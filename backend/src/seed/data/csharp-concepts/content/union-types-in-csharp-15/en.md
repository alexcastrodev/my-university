---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A `union` declaration, new in C# 15, names a type whose value is exactly one of a
closed list of case types: `union Pet(Cat, Dog, Bird);`. The compiler gives it an
implicit conversion from each case type and knows the list, so a `switch` that
handles every case type is exhaustive without a `_` arm, and a missing one is a
warning. Before C# 15 the same idea took an abstract base class, a marker
interface, or a library such as OneOf. This concept covers what the declaration
generates, how patterns read a union, what `default` does, the diagnostics, the
hand-written union that avoids boxing, System.Text.Json support, and what happens
on older target frameworks. Everything was compiled and run on the 11.0.100 SDK.

## Use Cases

- A method result that is one of several unrelated types, such as a payment that
  is `Approved`, `Declined` or `Pending`, where the caller must handle each.
- Message or command dispatch over a fixed set of types that share no base class
  and that you may not control.
- Replacing a hand-rolled `Result<T>` or a OneOf generic with a type the compiler
  checks (see `result-types-versus-exceptions`).
- A JSON body that can be a number or a string, mapped to one C# type.

## Deep Dive

### What a declaration generates

```csharp
public record class Cat(string Name);
public record class Dog(string Name);
public record class Bird(string Name);
public union Pet(Cat, Dog, Bird);
```

Reflection on a union confirms the shape. `typeof(Pet).IsValueType` is `true`,
the type carries `UnionAttribute` and implements `IUnion`, and it has one public
constructor per case type plus a `Value` property of type `object?`. Case types
can be classes, structs, interfaces, nullable types, type parameters or other
unions (`union Option<T>(None, Some<T>)` is legal). A union is not a record: it
adds no equality, cloning or deconstruction, and it adds no data of its own. It
only composes types that already exist.

```csharp
Pet p = new Dog("Rex");        // implicit conversion calls the Dog constructor
Console.WriteLine(p.Value);    // Dog { Name = Rex }
```

When a case type is a value type, the value is boxed into the `object?`:
`union IntOrString(int, string)` stores the `int` as a boxed object, and
`IntOrString x = 42; x.Value.GetType()` prints `System.Int32` read back from that
object. If two case types could both accept the source value, the compiler picks
the best conversion by the usual rules: with `union U(int, long)`, `U u = 5;`
stores an `Int32` and `U v = 5L;` stores an `Int64`. When neither is better, it is
an error: `union U(IFormattable, IComparable)` with `U u = 5;` is
`CS0457: Ambiguous user defined conversions`.

A declaration may have a body with methods and computed properties, but not
instance fields, auto-properties or field-like events (`CS9373`), and not an
explicit public constructor with one parameter, because the compiler reserves
those as creation members (`CS9374`).

### Patterns test the contents

The most important rule: on a union, a type or declaration pattern tests the
**contents**, not the union value. `Dog d` asks whether `Value` is a `Dog`.

```csharp
string name = p switch
{
    Dog d => d.Name,
    Cat c => c.Name,
    Bird b => b.Name,
};
```

A recursive pattern with a type (`Dog { Name: "Rex" }`) tests the contents and
then looks inside the `Dog`. A recursive pattern without a type uses the union's
own members, a `var` or discard pattern captures the union itself, and `null`
tests the contents. That is why `p is Pet` does not compile (`CS8121`): none of
the case types is `Pet`. And for the default value, the two natural tests
disagree:

```csharp
Pet empty = default;
Console.WriteLine(empty is not null);  // False: the contents are null
Console.WriteLine(empty is { });       // True: the union struct itself exists
```

Use `is not null` for "has a value", and a `null` arm in a switch.

### Exhaustiveness and the default value

Handling every case type needs no discard. Leaving one out gives the warning you
already know from enums, with the missing case named:

```csharp
Console.WriteLine(p switch { Dog d => 1, Cat c => 2 });
// warning CS8509: ... the pattern 'Bird' is not covered.
```

A discard or `var` arm hides that warning for the day someone adds a fourth case
type, so prefer a `null` arm when you need to handle empty contents. Null is
where unions have a gap: `default(Pet)` and any array element or field of type
`Pet` that was never assigned hold a null `Value`. For `Pet`, whose case types
are all non-nullable, the compiler tracks the contents as "not null", so omitting
the `null` arm gives no warning, and the switch throws at runtime:

```csharp
Pet p = default;
p switch { Dog d => 1, Cat c => 2, Bird b => 3 };
// SwitchExpressionException: Non-exhaustive switch expression failed to match
// its input. Unmatched value was Pet.
```

With a nullable case type, `union NP(Cat?, Dog)`, the contents are "maybe null"
and omitting the `null` arm is `CS8655`, a warning that the lab turns into an
error. The rule of thumb: handle `null` whenever a default value can reach the
switch, which is always for struct unions in arrays and fields.

### A union as a hand-written type, without boxing

The generated union is always a struct and always boxes value-type cases. When
that matters, write the union yourself. A type is a union type if it has
`[Union]`, one public constructor per case type (single parameter), and a public
`Value` property of type `object?`. The optional **non-boxing access pattern** adds
`HasValue` and a `TryGetValue(out T)` per case type, and then the compiler matches
types through `TryGetValue` instead of reading `Value`:

```csharp
[System.Runtime.CompilerServices.Union]
public struct IntOrText : System.Runtime.CompilerServices.IUnion
{
    private readonly int _int;
    private readonly string? _text;
    private readonly byte _tag; // 0 = none, 1 = int, 2 = text

    public IntOrText(int value) { _int = value; _tag = 1; }
    public IntOrText(string? value) { if (value is not null) { _text = value; _tag = 2; } }

    public object? Value => _tag switch { 1 => _int, 2 => _text, _ => null };
    public bool HasValue => _tag != 0;
    public bool TryGetValue(out int value) { value = _int; return _tag == 1; }
    public bool TryGetValue(out string value) { value = _text!; return _tag == 2; }
}
```

In the lab, a `switch` over a thousand of these (`int i => i, string s => s.Length,
null => 0`) allocated 0 bytes after warm-up, measured with
`GC.GetAllocatedBytesForCurrentThread`. The contract for a custom union: `Value`
returns `null` or one of the case types, a value built from a case type reports
that type, and `HasValue` and `TryGetValue` agree with `Value`. The compiler
trusts you on these. The same attribute also allows class-based unions, and a
nested `IUnionMembers` interface (a "union member provider") when constructors
must stay private; both are described in the language reference.

### System.Text.Json

The .NET 11 serializer treats a `union` declaration as a union contract. It writes
the case value with no envelope, and reads it back by the JSON token type:

```csharp
IntOrString n = 42, s = "hi";
JsonSerializer.Serialize(n);                     // 42
JsonSerializer.Serialize(s);                     // "hi"
JsonSerializer.Deserialize<IntOrString>("7");    // Value is the int 7
JsonSerializer.Serialize<IntOrString>(default);  // null
JsonSerializer.Deserialize<IntOrString>("true"); // JsonException: no case type fits
```

The limit is cases that share a JSON shape. `Pet` has three object-shaped cases,
so `JsonSerializer.Deserialize<Pet>("{\"Name\":\"R\"}")` throws
`JsonException: JSON value type 'Object' is ambiguous for union type 'Pet' because
multiple case types can use this value type. Specify a custom type classifier to
support deserialization.` A `TypeClassifier` on `[JsonUnion]` is how you resolve
it; for new contracts with several object-shaped cases, a `closed` hierarchy with
a discriminator is usually the better fit (see
`closed-classes-and-exhaustive-hierarchies`). I did not run the ASP.NET Core
integration; the ASP.NET team's post says unions work as bodies in Minimal APIs,
MVC and SignalR, but not in query strings, routes, headers or forms.

### Older target frameworks

A `union` needs `UnionAttribute` and `IUnion` from `System.Runtime.CompilerServices`,
and the .NET 11 runtime ships them. On `net10.0` the same declaration is
`CS0518: Predefined type 'System.Runtime.CompilerServices.IUnion' is not defined`
plus `CS0656` for the attribute constructor. Declaring both types in your project
(an attribute class that allows classes and structs, and `interface IUnion { object? Value { get; } }`)
made it compile on `net10.0`; I compiled that but did not run it on a .NET 10
runtime. On C# 14 (`LangVersion` 14) there is no workaround: `union` is a syntax
error. Whether the serializer recognizes a polyfilled attribute is something to
test before you rely on it.

## Trade-offs

- **Boxing for value-type cases.** The generated struct stores an `object?`, so
  `union IntOrString(int, string)` allocates for every `int`. For hot paths
  write the union by hand with `TryGetValue`, or use a class hierarchy.
- **`default` is a hole.** A struct union that was never assigned holds `null` and
  can slip past the compiler. Always add a `null` arm.
- **Adding a case type is a breaking change for consumers.** Every `switch` over
  a public union becomes non-exhaustive (warning CS8509) when you add a case. That
  is why a union is for sets you own and can version.
- **Unions versus a closed hierarchy.** Unions group types that need no common
  base, including ones you do not own (`int`, `string`). A `closed` class makes a
  hierarchy exhaustive when you do own the base. Use the union for the first
  case and the hierarchy for the second.
- **Unions versus exceptions and `Try` methods.** A union result is explicit but
  makes callers write a `switch`. Use it where failure is an expected outcome,
  not for programming errors.
- **Ecosystem coverage.** System.Text.Json knows unions in .NET 11. For an ORM, a
  database driver or a mapper, check support before putting a union in a model.

## Lab

In this lab you work with a payment gateway that answers `Approved`, `Declined` or `Pending`. The union declarations are given; your job is the code that uses them, plus a hand-written union. The `src` project turns CS8509 and CS8655 into errors, so a missing case type does not compile.

**The scenario**

`Payments.cs` has `Payments.Describe`, `DescribeSafe`, `ToJson` and `FromJson`, and the struct `IntOrText` with four stubbed members. The tests use `default(PaymentResult)`, an `int` case and a `string` case, and measure allocations.

**What you will do, step by step**

1. **Exhaustive switch (TODO-00).** In `Describe`, one arm per case type and no `_`. A `default` value must throw `SwitchExpressionException`, and the test checks it.
2. **The default value (TODO-01).** In `DescribeSafe`, add `null => "no result"`.
3. **JSON (TODO-02).** Implement `ToJson` and `FromJson` for `IntOrString`: the case is written without an envelope and `true` throws `JsonException`.
4. **No boxing (TODO-03).** In `IntOrText`, implement `Value`, `HasValue` and both `TryGetValue` methods. The test expects 0 allocated bytes when summing a thousand values.

**How you know you are done**

`dotnet test` is green with 12 tests. You should be able to say why `Describe(default)` throws while `DescribeSafe(default)` does not, and why `IntOrString` allocates and `IntOrText` does not.

**Optional challenges**

- Remove the `Pending` arm from `Describe` and read the CS8509 message.
- Break `TryGetValue(out int)` on purpose and see which test notices.

**Prerequisites:** `switch` expressions, records and the .NET 11 SDK (the projects target `net11.0`).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed member throws `NotImplementedException`, so red tests are your checklist.

## Documentation Links

- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [Unions, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/unions) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions and closed hierarchies in ASP.NET Core, .NET Blog](https://devblogs.microsoft.com/dotnet/unions-and-closed-hierarchies-in-aspnetcore/) (doc)
- [Errors and warnings for pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/pattern-matching-warnings) (doc)
