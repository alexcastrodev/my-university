---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A primary constructor (C# 12) puts the constructor parameters on the type
declaration itself: `public class OrderService(IRepo repo, ILogger<OrderService> log)`.
The syntax is the same one records have used since C# 9, but the meaning is
different, and that difference is where the bugs live. In a class or struct the
parameters do **not** become properties. They are parameters that stay in scope
across the whole type body, and when a member uses one, the compiler quietly
turns it into a hidden, **mutable** field. This concept shows what the compiler
generates (read from the IL), when a field is created and when it is not, the two
"double storage" warnings, how to get `readonly` and argument validation back,
and the rules for structs and other constructors.

## Use Cases

- Services that receive their dependencies through dependency injection and
  only call them, which is the case where primary constructors read best.
- Small types whose properties are computed once from constructor arguments.
- Derived classes that only forward arguments to a base constructor.
- Reviewing code where a parameter is used both to initialize a property and
  inside a method, which creates two copies that can drift apart.

## Deep Dive

### Parameters, not members

The parameters are in scope in initializers, in every instance member, and in
the `base(...)` argument list, but they are not members of the type:
`this.name` is error CS1061 (`'NotMember' does not contain a definition for
'name'`). They also cannot be used from static members (CS9105), and a parameter
nobody reads produces warning CS9113 (`Parameter 'name' is unread`).

Every other constructor must chain to the primary one, directly or through
another constructor, so the parameters are always assigned:

```csharp
public class OtherCtor(string name)
{
    public OtherCtor() { }
    // error CS8862: A constructor declared in a type with parameter list must have 'this' constructor initializer.
}
```

The fix is `public OtherCtor() : this("default") { }`. For a class, the presence
of a primary constructor also removes the implicit parameterless constructor.

### When the compiler creates a field

The compiler stores a parameter only if an instance member needs it later. If
the parameter is used only in initializers or in the base call, nothing is
stored. Reflection over three types shows the difference:

```csharp
public class Greeter(string name)
{
    public string Greet() => $"Hello, {name}";
    public void Rename(string newName) => name = newName;   // allowed
}

public class Box(int width, int height)
{
    public int Area { get; } = width * height;             // initializer only
}

// Greeter: <name>P (initonly=False)
// Box: <Area>k__BackingField (initonly=True)
```

`Greeter` gained a private field named `<name>P`, an unspeakable name like the
`k__BackingField` of auto-properties. `Box` has no field for `width` or
`height`: they lived only for the duration of the constructor.

The IL produced by `ilspycmd -il` for `Greeter` makes the lowering concrete:

```text
.field private string '<name>P'

.method public hidebysig specialname rtspecialname instance void .ctor (string name)
{
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: stfld string Greeter::'<name>P'
    IL_0007: ldarg.0
    IL_0008: call instance void [System.Runtime]System.Object::.ctor()
    IL_000e: ret
}

.method public hidebysig instance string Greet ()
{
    IL_0000: ldstr "Hello, "
    IL_0005: ldarg.0
    IL_0006: ldfld string Greeter::'<name>P'
    ...
}
```

Three facts come out of it. The field has no `initonly` flag, so it is mutable,
and `Rename` really did change what `Greet` prints (`Hello, Ana`, then `Hello,
Bia`). The capture is stored **before** the base constructor call, the same
place field initializers run (see Fields, Constants and Initialization Order).
And every use in a member becomes `ldfld` on `this`, so a lambda that uses the
parameter captures `this`, not a copy of the value.

### The two double-storage warnings

Because initialization and capture are different mechanisms, using the same
parameter for both creates two independent copies:

```csharp
public class Account(string owner)
{
    public string Owner { get; } = owner;                 // copy 1: backing field
    public string Describe() => $"owner is {owner}";      // copy 2: <owner>P
    public void Rename(string n) => owner = n;
}
// warning CS9124: Parameter 'string owner' is captured into the state of the enclosing
// type and its value is also used to initialize a field, property, or event.
// After Rename("bia"): Owner=ana, Describe=owner is bia
```

The second warning appears in hierarchies, when a derived class passes a
parameter to the base and also uses it:

```csharp
public class BankAccount(string id, string owner)
{
    public string Owner { get; set; } = owner;
}
public class Savings(string id, string owner) : BankAccount(id, owner)
{
    public override string ToString() => $"{id}/{owner}";
}
// warning CS9107: Parameter 'string owner' is captured into the state of the enclosing
// type and its value is also passed to the base constructor. The value might be
// captured by the base class as well.
// After s.Owner = "changed": base Owner=changed, derived ToString=A-1/ana
```

In both cases the fix is to pick one source of truth: read the property
(`Owner`) inside members instead of the parameter.

### Getting readonly back

Primary constructor parameters in a class cannot be marked `readonly`:
`class C(readonly string x)` fails with CS9190 (`'readonly' modifier must be
specified after 'ref'`), because the parser reads it as a misplaced `ref
readonly` modifier. The idiom is to declare a field with the same name and initialize it from the
parameter. Inside the initializer, `name` means the parameter; inside members,
the field shadows it, so no `<name>P` capture happens:

```csharp
public class Service(string name)
{
    private readonly string name = name.Trim();
    public string Show() => name;                 // the readonly field
}
// fields: name initonly=True
```

Many teams prefer an underscore field (`private readonly IRepo _repo = repo;`)
so that a stray use of `repo` in a member is visible in review and triggers
CS9124 if both are used.

### Validating arguments

There is no constructor body to put guard clauses in, so validation goes in an
initializer, which runs during construction:

```csharp
public class OrderService(IRepo repo)
{
    private readonly IRepo _repo = repo ?? throw new ArgumentNullException(nameof(repo));
}

public class LazyCheck(IRepo repo)
{
    public string Use() => repo.Load();
}
// new OrderService(null!)  -> ArgumentNullException, ParamName "repo"
// new LazyCheck(null!)     -> constructed fine; Use() -> NullReferenceException
```

When a parameter is only captured, a bad argument is not detected at
construction time but at first use, far from the caller that passed it. If you
need several statements of validation or logging, write an ordinary
constructor.

### Structs and readonly structs

In a struct, the implicit parameterless constructor still exists, and `default`
or `new S()` without an explicit parameterless constructor gives zeroed
parameters. An explicit parameterless constructor must chain to the primary one:

```csharp
public struct Counter(int start)
{
    public Counter() : this(1) { }
    public int Value => start;
    public void Increment() => start++;
}
// new Counter(10) after two Increment(): 12
// default(Counter).Value: 0
// new Counter().Value: 1
```

In a `readonly struct` the captured parameters are read-only: `x++` in a member
is error CS9114 (`A primary constructor parameter of a readonly type cannot be
assigned to`). Parameters passed by `ref`, `in`, or `out` can be used in
initializers but never captured: using one in an instance member is CS9109.

### Compared with records

`record Person(string Name)` uses the same parameter list but generates a public
`Name { get; init; }` property, plus equality, `ToString`, and `Deconstruct`.
`class Person(string name)` generates none of that. Choose a record when the
parameters are the public data of the type; choose a class primary constructor
when they are private dependencies. Records are covered in Records and with
Expressions.

## Trade-offs

- **Concise DI, mutable state.** A service like `class Handler(IRepo repo)`
  loses ten lines of field and constructor boilerplate, but any method can now
  write `repo = null`. Accept that for small services, or add a `readonly` field
  where the dependency must not change.
- **Two copies are easy to create.** Treat CS9124 and CS9107 as errors; they
  always point to state that can diverge.
  ```xml
  <WarningsAsErrors>CS9124;CS9107</WarningsAsErrors>
  ```
- **Validation moves to initializers or disappears.** A parameter that is only
  captured is never checked at construction time. Validate in an initializer
  or use a regular constructor.
- **No constructor body.** Logging, multi-step setup, or ordering logic needs a
  normal constructor, and other constructors can only add code after chaining
  with `this(...)`.
- **Parameter names become part of the type body.** Renaming a parameter
  renames a variable used across every member, and named arguments at call
  sites (`new Greeter(name: "Ana")`) depend on it too.

## Lab

In this lab you get `Models.cs` with types written using primary constructors that **already compile** but hide traps, plus ready xUnit tests that fail until you fix them. Your job is to edit those types. The core idea is to understand what a primary constructor parameter really is in a class or struct: a hidden, captured and **mutable** field, not a property. That explains why state can drift apart, why there is no automatic validation and why a zeroed struct skips the constructor.

**The scenario**

Several small types in `Models.cs`, each with a problem to solve. The compiler already warns (CS9124 and CS9107) about two of them: those warnings point at state that can drift apart.

- `Account(string owner)`: stores `owner` twice, in `Owner` and in a hidden mutable field used by `Describe()` and `Rename()`.
- `OrderService(IRepo repo)`: uses `repo` directly, unvalidated and not readonly.
- `Counter(int start)`: a `struct` whose `Value` reads the captured parameter.
- `BankAccount` and `Savings`: `Savings` passes `id` and `owner` to the base and also captures them.
- `Coordinates` and `Service`: the two types used by the optional challenges.

The `DefaultStructHasZeroedParameters` test already passes and only documents the fact that `default(Counter)` does not go through the constructor.

**What you will do, step by step**

1. **A single source of truth (TODO-00).** In `Account`, make `Owner` `{ get; private set; }`, assign it in `Rename()` and read `Owner` (not the parameter) in `Describe()`. The parameter is then no longer captured.
2. **Readonly and validation (TODO-01).** In `OrderService`, store the parameter in a readonly `_repo` field, throw `ArgumentNullException(nameof(repo))` in the initializer when it is null and use `_repo` in `Load()`. The test checks the parameter name and, through reflection, that the field is `IsInitOnly`.
3. **A parameterless constructor on a struct (TODO-02).** In `Counter`, `new Counter().Value` is 0 today, the zeroed parameter. Declare a parameterless constructor that chains to the primary one with `this(1)`.
4. **Stop capturing what the base already stores (TODO-03).** In `Savings`, `ToString()` uses the captured parameters and goes stale when `Owner` changes. Use the inherited `Id` and `Owner` properties instead.

**How you know you are done**

`dotnet test` is all green and the CS9124 and CS9107 warnings are gone. You should be able to explain why `Counter` lets `Increment()` change the parameter and why `default(Counter).Value` is still 0.

**Optional challenges**

- **TODO-04:** turn `Coordinates` into a positional record `Coordinates(int X, int Y)`, to get `X`, `Y` and value equality.
- **TODO-05:** in `Service`, declare `private readonly string name = name.Trim();`, so the member sees the readonly field (which shadows the parameter) and `Show()` returns the trimmed text.

Neither has a test, so check them yourself.

**Prerequisites:** C# classes, structs and constructors, dependency injection basics and the .NET 10 SDK (C# 14).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The code compiles from the start (look at the compiler warnings), and red tests show what is left. The `TODO-NN` comments in `Models.cs` explain what to change in each type.

## Documentation Links

- [Instance constructors, primary constructors section, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors#primary-constructors) (doc)
- [Declare primary constructors for classes and structs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/primary-constructors) (doc)
- [What's new in C# 12, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
- [Structure types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [ILSpy command-line decompiler (ilspycmd), GitHub](https://github.com/icsharpcode/ILSpy/tree/master/ICSharpCode.ILSpyCmd) (doc)
