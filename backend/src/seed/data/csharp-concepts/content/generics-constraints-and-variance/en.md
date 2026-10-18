---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Generics let one piece of code work with many types without giving up type
safety or paying for boxing. In .NET they are reified: the type arguments exist
at run time, `typeof(T)` works, and the runtime decides how much native code to
share between instantiations. This concept covers why generics replaced the
`object`-based collections, the constraint list from `class` to
`allows ref struct` (C# 13), how the runtime specializes code for value types
and shares it for reference types, how a constraint avoids boxing on interface
calls, covariance and contravariance with `out` and `in`, why arrays are
covariant in an unsafe way, and generic attributes (C# 11).

## Use Cases

- A `Max<T>` or `Cache<TKey, TValue>` written once and used for `int`, `string`
  and your own types.
- Accepting an `IEnumerable<Animal>` and receiving a `List<Dog>` without copying.
- Passing a general `Action<object>` logger where an `Action<string>` is expected.
- A per-type static cache (`Counter<T>.Hits`) that needs no dictionary.
- `[ValidateWith<EmailRule>]` instead of `[ValidateWith(typeof(EmailRule))]`.

## Deep Dive

### What generics fixed: boxing and casts

`ArrayList` and `Hashtable` store `object`, so every value type is boxed on the
way in and cast on the way out. Measured with
`GC.GetAllocatedBytesForCurrentThread` on .NET 10.0.0 (Apple M4, arm64,
Release), adding 100,000 `int`s to pre-sized collections:

```csharp
var legacy = new ArrayList(N);
for (int i = 0; i < N; i++) legacy.Add(i);  // 2401488 bytes allocated
var generic = new List<int>(N);
for (int i = 0; i < N; i++) generic.Add(i); // 0 bytes allocated
```

That is 24 bytes per boxed `int` on this 64-bit runtime, and garbage for the GC
to collect. A generic collection also catches `list.Add("oops")` at compile time
instead of failing at the cast.

### Reified generics

Unlike Java, where type arguments are erased, .NET keeps them:

```csharp
Console.WriteLine(typeof(List<int>) == typeof(List<string>)); // False
Console.WriteLine(new List<string>().GetType());  // System.Collections.Generic.List`1[System.String]
static string Describe<T>() => $"{typeof(T).Name}:{default(T)?.ToString() ?? "null"}";
// Describe<int>() -> "Int32:0", Describe<string>() -> "String:null"

Counter<int>.Hits++; Counter<int>.Hits++; Counter<string>.Hits++;
Console.WriteLine($"{Counter<int>.Hits} {Counter<string>.Hits}"); // 2 1
static class Counter<T> { public static int Hits; }
```

Each closed type has its own static fields, which is a cheap per-type cache.
`default(T)` is `0` for numbers and `null` for references.

### Constraints

A constraint tells the compiler what it may assume about `T`, and it rejects
type arguments that do not fit:

```csharp
static T Max<T>(IEnumerable<T> items) where T : IComparable<T>
{
    using var e = items.GetEnumerator();
    if (!e.MoveNext()) throw new InvalidOperationException("empty");
    T best = e.Current;
    while (e.MoveNext()) if (e.Current.CompareTo(best) > 0) best = e.Current;
    return best;
}
static T Create<T>() where T : class, new() => new T();
static int ByteCount<T>(T value) where T : unmanaged
    => MemoryMarshal.AsBytes(new ReadOnlySpan<T>(in value)).Length; // ByteCount(42L) -> 8
static string NameOf<T>(T value) where T : allows ref struct => typeof(T).Name;
// NameOf("hello".AsSpan()) -> "ReadOnlySpan`1"
```

| Constraint | Means |
|---|---|
| `class` / `class?` | reference type (non-nullable / nullable) |
| `struct` | non-nullable value type; implies `new()` |
| `notnull` | any non-nullable type, value or reference |
| `unmanaged` | value type with no references at any depth; implies `struct` |
| `new()` | public parameterless constructor; must come last |
| `BaseClass`, `IInterface` | must derive from or implement it |
| `allows ref struct` | C# 13 anti-constraint: `Span<T>` and other ref structs are accepted |

Violations are compile errors, for example:

```text
error CS0310: 'string' must be a non-abstract type with a public parameterless constructor ... 'Create<T>()'
error CS8377: The type 'string' must be a non-nullable value type, along with all fields at any level of nesting ... 'ByteCount<T>(T)'
error CS9244: The type 'ReadOnlySpan<char>' may not be a ref struct ... (same NameOf without allows ref struct)
```

### How the runtime shares code

The C# guide on generics at run time says the runtime creates a specialized
version for each value type used as a type argument, and one shared version for
all reference types, because every reference has the same size. You can watch it
happen. Asking the JIT for its compilation summary (`DOTNET_JitDisasmSummary=1`)
while calling a generic `Identity<T>` with `int`, `long`, `string` and `object`
listed exactly three compilations:

```text
Program:<<Main>$>g__Identity|0_2[int](int)
Program:<<Main>$>g__Identity|0_2[long](long)
Program:<<Main>$>g__Identity|0_2[System.__Canon](System.__Canon)
```

`__Canon` is the runtime's placeholder for "any reference type": `string` and
`object` ran the same machine code. The consequence is that value-type
instantiations get code tuned for their exact layout, at the price of one copy
per value type, while reference-type instantiations cost no extra code but must
look up type-specific details at run time when the code needs them.

### Constraints avoid boxing on interface calls

Passing an `int` as `IComparable<int>` boxes it. Calling the same method through
a constrained type parameter does not, because the code is specialized for
`int`:

```csharp
static int ViaInterface(IComparable<int> value, int other) => value.CompareTo(other);
static int ViaConstraint<T>(T value, T other) where T : IComparable<T> => value.CompareTo(other);
// 10,000 calls each, measured three times:
// interface 240000 bytes, constraint 0 bytes
```

Same environment as above. When you write an API that takes structs, prefer
`void M<T>(T x) where T : IFoo` over `void M(IFoo x)`.

### Variance: `out` and `in`

Variance lets a generic interface or delegate convert along the inheritance of
its type argument, but only when that is safe:

```csharp
IEnumerable<string> names = ["ana", "bia"];
IEnumerable<object> objects = names;      // covariance: IEnumerable<out T>

Action<object> logAny = o => Console.WriteLine($"log {o}");
Action<string> logText = logAny;          // contravariance: Action<in T>

IProducer<Dog> kennel = new Kennel();
IProducer<Animal> shelter = kennel;       // your own covariant interface

interface IProducer<out T> { T Next(); }
class Animal;
class Dog : Animal;
class Kennel : IProducer<Dog> { public Dog Next() => new(); }
```

`out T` means `T` only comes out (return values), so a producer of `Dog` is a
producer of `Animal`. `in T` means `T` only goes in (parameters), so something
that accepts any `object` accepts a `string`; `IComparer<in T>` works the same
way. The compiler enforces it: `interface IBad<out T> { void Put(T item); }`
fails with CS1961 ("must be contravariantly valid").

Three limits:

```csharp
List<object> a = new List<string>();     // CS0029: classes are never variant
IEnumerable<object> b = new List<int>(); // CS0266: variance only for reference types
```

Variance is declared only on interfaces and delegates, and the official docs
state it applies only to reference type arguments, since a boxed `int` is a
different representation, not just a different static type.

### Arrays: covariance that can throw

Arrays of reference types are covariant too, and the C# docs call it out as not
type safe: the compiler accepts the conversion, so the check moves to run time:

```csharp
object[] boxes = new string[1];
boxes[0] = 42; // ArrayTypeMismatchException
```

`IReadOnlyList<T>` and `IEnumerable<T>` give you covariance that cannot fail,
because they have no way to store an element.

### Generic attributes (C# 11)

```csharp
[ValidateWith<EmailRule>] public string Email { get; set; } = "";

sealed class ValidateWithAttribute<TRule> : Attribute where TRule : IRule, new();
```

The constraint now checks at compile time what `typeof(EmailRule)` used to leave
to reflection. The type argument must be fully known: an attribute cannot use a
type parameter of the enclosing type.

## Trade-offs

- **Value-type instantiations multiply code.** Each struct you plug in compiles
  a new copy, which is the price of no boxing: in the experiment above `int` and
  `long` were two separate JIT compilations of the same method, so many struct
  instantiations mean more JIT work at startup.
- **Shared code for references has to look things up.** Since one `__Canon`
  version serves every reference type, anything type-specific (`typeof(T)`,
  `new T()`, static fields of `Generic<T>`) cannot be baked into it and is
  resolved at run time. Measure before assuming it costs the same as in a
  value-type instantiation.
- **Constraints are a public contract.** Adding one later breaks callers whose
  types do not satisfy it; removing one can break code inside the method.
  ```csharp
  public static T Parse<T>(string s) where T : IParsable<T> => T.Parse(s, null); // hard to loosen later
  ```
- **Variance only works for interfaces and delegates.** If your API returns
  `List<Dog>`, callers cannot treat it as `List<Animal>`; return
  `IReadOnlyList<Dog>` and they can.
- **Covariant arrays are a legacy trap.** Prefer `IReadOnlyList<T>` parameters
  over `object[]` or `Base[]` when you only read.
- **Generic is not always simpler.** A method that only ever handles one type,
  or that switches on `typeof(T)`, is clearer as overloads.

## Lab

In this lab you get generic methods **with the constraints removed**, a stubbed `TypeCounter<T>` and interfaces without variance, together with ready xUnit tests. Your job is to implement the methods, add the right constraints and mark the interfaces as covariant or contravariant. The core idea is to see that a constraint is not decoration: it unlocks operations (`CompareTo`, `new T()`, `MemoryMarshal.AsBytes`), generics are reified at run time, calling an interface member through a constrained type parameter avoids boxing, and variance decides which assignments between constructed types are valid.

**The scenario**

Three files in `src/GenericsLab`.

- `Generics.cs`: five generic methods (`Max<T>`, `Create<T>`, `ByteCount<T>`, `Describe<T>`, `CompareViaConstraint<T>`) plus `CompareViaInterface`, which is already written and serves as the comparison, and `TypeCounter<T>`, which keeps state per closed type.
- `Variance.cs`: the classes `Animal` and `Dog`, the interfaces `IProducer<T>` and `IConsumer<T>` without variance, and the implementations `Kennel` (produces `Dog`) and `AnimalLog` (consumes `Animal`).
- `GenericsTests.cs`: the tests. Several use reflection to check the constraint or the variance flag, because a missing constraint is a compile-time property and cannot be proven any other way. Two tests measure allocated bytes to prove that a constrained call does not box.

**What you will do, step by step**

1. **Constrain to compare (TODO-00).** In `Max<T>`, return the largest item and throw `InvalidOperationException` if the sequence is empty. Constrain `T` to `IComparable<T>` to call `CompareTo` without a cast.
2. **Constrain to instantiate (TODO-01).** In `Create<T>`, return a `new T()`. The compiler only allows this with `class, new()`.
3. **Constrain to `unmanaged` (TODO-02).** In `ByteCount<T>`, reinterpret the value as a one-element `ReadOnlySpan<T>` (`new ReadOnlySpan<T>(in value)`) and use `MemoryMarshal.AsBytes`. That only compiles when `T` is `unmanaged`.
4. **Use reification (TODO-03 and TODO-04).** In `Describe<T>`, return `"<type name>:<default>"` (`"Int32:0"`, `"String:null"`) with `typeof(T)` and `default(T)`. In `TypeCounter<T>.Increment`, count one hit: each `TypeCounter<X>` has its own static state, so `int` and `string` do not share `Hits`.
5. **Compare without boxing (TODO-05).** In `CompareViaConstraint<T>`, make the same comparison as `CompareViaInterface`, but through a type parameter constrained to `IComparable<T>`, so an `int` is never boxed. The test requires zero allocated bytes over 10 thousand calls.
6. **Variance (TODO-06 and TODO-07).** Mark `IProducer<T>` as covariant (`out T`) and `IConsumer<T>` as contravariant (`in T`), so a producer of `Dog` works as a producer of `Animal`, and a consumer of `Animal` works as a consumer of `Dog`.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `List<Dog>` is not a `List<Animal>` while `IProducer<Dog>` is an `IProducer<Animal>`, and why `CompareViaInterface` allocates and `CompareViaConstraint` does not.

**Optional challenges**

These two have no stub or test, so you write both.

- **TODO-08:** add `Generics.NameOf<T>(T value)`, which returns `typeof(T).Name` and accepts `ReadOnlySpan<char>` by using the C# 13 `allows ref struct` anti-constraint.
- **TODO-09:** try `object[] boxes = new string[1]; boxes[0] = 42;` and read the exception. Why does `IReadOnlyList<object>` not have this problem?

**Prerequisites:** C# interfaces and inheritance, value types versus reference types and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The stubbed methods throw `NotImplementedException`, and the missing constraints and variance show up as red reflection tests, with the `TODO-NN` comments explaining each one.

## Documentation Links

- [Generic classes and methods, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/generics) (doc)
- [Constraints on type parameters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/constraints-on-type-parameters) (doc)
- [Generics in the runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/generics/generics-in-the-run-time) (doc)
- [Covariance and contravariance in generics, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance) (doc)
- [Covariance and contravariance, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/covariance-contravariance/) (doc)
- [What's new in C# 13 (allows ref struct), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [C# version history, C# 11 (generic attributes), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [Generics and attributes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/generics-and-attributes) (doc)
