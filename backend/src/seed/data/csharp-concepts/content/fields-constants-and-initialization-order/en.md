---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A field is the only place an object actually stores state, and C# gives it four
different lifetimes of "being set": a `const` baked into the compiled caller, a
`static readonly` set once per type, a `readonly` set once per object, and a
`required` member that the caller must set. The order in which these run
(field initializers, base constructor, constructor body) is not obvious, and it
differs from Java in one important way. This concept walks through the exact
instance and static initialization order with real output, the virtual call in a
constructor trap, why a `const` can go stale across assemblies, what
`beforefieldinit` changes about static initialization, and how `required` and
`SetsRequiredMembers` fit in.

## Use Cases

- Debugging a `NullReferenceException` or a half-initialized object seen from an
  overridden method called by a base constructor.
- Deciding between `const` and `static readonly` for a value published from a
  class library.
- Making sure a one-time setup (a lookup table, a registry) runs exactly once
  and at a predictable moment.
- Forcing callers to supply mandatory data without a constructor with ten
  parameters.

## Deep Dive

### Instance initialization order

Creating an object runs, in this order: the field initializers of the most
derived class, then the field initializers of each base class going up, then the
constructor bodies going back down, base first. Both constructors and
initializers appear in this trace:

```csharp
class Base
{
    private readonly string _baseField = Log("Base field initializer");
    public Base() { Log("Base constructor body"); Describe(); }
    protected virtual void Describe() => Log("Base.Describe");
    protected static string Log(string m) { Console.WriteLine(m); return m; }
}

class Derived : Base
{
    private string _name = Log("Derived field initializer (_name)");
    private string? _late;

    public Derived() : this(0) => Log("Derived() body");
    public Derived(int n) { Log("Derived(int) body"); _late = "set in ctor"; }

    protected override void Describe()
        => Log($"Derived.Describe: _name='{_name}', _late={(_late is null ? "null" : _late)}");
}

var d = new Derived();
```

```
Derived field initializer (_name)
Base field initializer
Base constructor body
Derived.Describe: _name='Derived field initializer (_name)', _late=null
Derived(int) body
Derived() body
```

Three things stand out. First, the derived field initializers run before the base
constructor, so C# differs from Java, where field initializers of a subclass run
after `super(...)` returns. Second, the call `Describe()` in the base constructor
dispatches to the **override**, which runs while the derived constructor body has
not started: `_name` is already set (its initializer ran) but `_late` is still
`null`, even though the field is assigned in every constructor. Third, with
constructor chaining through `this(...)`, the field initializers run once, in
the constructor that does not chain, and the bodies then run innermost first.

Calling a virtual member from a constructor is legal and almost always a bug. If
the base class needs a hook after construction, use a factory method or an
explicit `Initialize()` call, and keep constructors free of virtual calls (the
analyzer CA2214 reports it).

### Instance fields: default values and readonly

Every field has a default value (`0`, `false`, `null`) before any code runs, and
a field initializer or constructor assignment overrides it. A field initializer
cannot use `this`, so it cannot read another instance member (error CS0236).

`readonly` allows assignment only in a field initializer or in a constructor of
the same type; anywhere else is error CS0191. It is a shallow guarantee: a
`readonly List<int>` cannot be pointed at another list, but its contents can
change.

### const versus static readonly

`const` is a compile-time constant limited to primitives, `string`, enums, and
`null` (`const decimal` works, `const DateTime` is error CS0283). The compiler
copies the value into every place that uses it. That is the catch when the
constant comes from another assembly:

```csharp
// Lib: public const int MaxConst = 10;  public static readonly int MaxReadonly = 10;
// App prints both:               const=10 static readonly=10

// Change both to 20, rebuild only Lib, copy the new Lib.dll next to the old App.dll:
// const=10 static readonly=20
```

`App` still prints the old `const` because `10` was compiled into its own IL. A
`static readonly` is read from the field at run time, so it follows the library
update. Use `const` for values that can never change (`Math.PI`, days in a
week), and `static readonly` for anything a future release might change, such as
a limit or a default timeout.

### Static initialization and beforefieldinit

Static field initializers run once per type, textually in order, then the static
constructor body. Whether that happens "right at first use" or "some time
before first use" depends on whether the class declares a static constructor.
Without one, the compiler marks the type `beforefieldinit`, which lets the
runtime run the initializers earlier or lazily; with an explicit static
constructor the type is not marked, and initialization happens exactly before
the first access to any static member or the first instance creation.

```csharp
using System.Reflection;

class WithStaticCtor
{
    public static readonly int Value = Log.Value("WithStaticCtor field initializer");
    static WithStaticCtor() => Console.WriteLine("  [init] WithStaticCtor static constructor");
}
class WithInitializer
{
    public static readonly int Value = Log.Value("WithInitializer field initializer");
}

typeof(WithInitializer).Attributes.HasFlag(TypeAttributes.BeforeFieldInit); // True
typeof(WithStaticCtor).Attributes.HasFlag(TypeAttributes.BeforeFieldInit);  // False

Console.WriteLine(WithStaticCtor.Value);
//   [init] WithStaticCtor field initializer
//   [init] WithStaticCtor static constructor
// 1
```

In this run the lazy type also initialized at first access, but only the
precise one has that guarantee. If the order of side effects matters, add an
empty static constructor, or better, avoid side effects in static initializers.

Two more facts about statics. Each closed generic type has its own statics:
`Counter<int>.Next()` twice then `Counter<string>.Next()` prints `1 2 1`. And a
type initializer that throws leaves the type unusable: the first access throws
`TypeInitializationException` wrapping the real exception, and so does every
later access, because the runtime does not retry.

### required members and SetsRequiredMembers

`required` (C# 11) makes the compiler force every object initializer to set the
member:

```csharp
class Person
{
    public required string Name { get; init; }
    public required int Born { get; init; }
    public Person() { }

    [SetsRequiredMembers]
    public Person(string name, int born) { Name = name; Born = born; }
}

var a = new Person { Name = "Ana", Born = 1990 };   // ok
var b = new Person("Bia", 1985);                    // ok: the attribute vouches for the ctor
var c = new Person { Name = "Cris" };
// error CS9035: Required member 'Person.Born' must be set in the object initializer or attribute constructor.
```

`required` also applies to fields, and it is inherited: a subclass that adds its
own `required` member creates a type whose initializers must set the base members
too. `[SetsRequiredMembers]` turns the check off for that constructor, so the
compiler trusts you: nothing verifies that the constructor really assigns them.
Reflection, deserializers, and `Activator.CreateInstance` do not run the check,
because it exists only at the call site.

## Trade-offs

- **`const` is fastest and the easiest to get stale.** Inlining removes a field
  read, and it also removes your ability to patch the value by shipping only the
  library. Public constants are a versioning commitment.
  ```csharp
  public const int MaxRetries = 3;                  // consumers keep 3 until recompiled
  public static readonly int MaxRetries = 3;        // consumers see the new value
  ```
- **Initializers are concise and invisible.** A field initializer runs before the
  base constructor, so it cannot use constructor parameters. Anything that depends
  on arguments belongs in the constructor body.
- **Virtual calls in constructors observe a partly built object.** Derived fields
  with initializers are ready, those set in the constructor body are not. Seal the
  class, avoid the call, or move the work to a factory.
- **A static constructor buys predictable timing and costs a check.** The type
  loses `beforefieldinit`, so the JIT may emit a cheap initialization check at
  every static access in code that was compiled before the type initialized. It
  is rarely measurable, but it is not free in tight loops.
- **A throwing static initializer is permanent.** One failed load of a config file
  in a static field disables the type for the lifetime of the process. Prefer
  `Lazy<T>` created with `LazyThreadSafetyMode.PublicationOnly` for work that can
  fail, since that mode does not cache an exception.
- **`required` moves the check to the call site only.** It does not protect
  against deserializers or reflection, and `[SetsRequiredMembers]` is an
  unchecked promise. Use it for construction ergonomics, not as a validation
  guarantee.

## Lab

In this lab you get `Models.cs` with small types that **already compile**, each one exposing an initialization rule, plus ready xUnit tests that fail until you apply the rule. Your job is to edit those types. The core idea is to observe the exact order in which C# initializes an object and to choose the right kind of field (`const`, `static readonly`, `required`) for each job. Some tests use reflection to inspect the compiled shape of the type, because the rule is a property of the IL, not of the runtime output.

**The scenario**

Five small types, one per rule.

- `Base` and `Derived`: the `Base` constructor calls a virtual method, and `Derived` has a field with an initializer (`_name`) and another only assigned in the constructor body (`_late`).
- `Limits`: two configuration values, `MaxRetries` and `Timeout`, both currently mutable `static` fields.
- `Precise` and `Relaxed`: two types with a `static readonly`, one without a static constructor (already marked `beforefieldinit`) and one that you adjust.
- `Person`: `Name` and `Born` with `init`, an empty constructor and another that assigns everything.

Notice there is no `NotImplementedException` here: the code runs, but the tests stay red until you do each TODO.

**What you will do, step by step**

1. **A virtual call in the constructor (TODO-00).** In `Base`, call `Describe()` in the constructor and store the result in `SeenByBase`. In `Derived`, override it to return `$"name={_name};late={_late ?? "null"}"`. The field initializer runs **before** the base constructor, but the assignment in the body runs **after** it, and that is what the test shows: `name=initialized;late=null`.
2. **`const` versus `static readonly` (TODO-01).** In `Limits`, make `MaxRetries` a `const`, since it never changes. Make `Timeout` `static readonly`: a `const` would be copied into every compiled caller and would not reflect a new version of the library.
3. **Lose `beforefieldinit` (TODO-02).** In `Precise`, add an empty static constructor. The compiler then stops marking the type as `beforefieldinit`, which changes when static initialization runs. `Relaxed` stays as the comparison.
4. **`required` members (TODO-03).** In `Person`, mark `Name` and `Born` as `required`, so object initializers are forced to set them. The `(name, born)` constructor assigns everything, so put `[SetsRequiredMembers]` on it for the compiler to accept `new Person("Bia", 1985)`.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `_late` shows up as `null` to `Base`, and why a public `const` in a library is a compatibility decision and not just a matter of style.

**Optional challenges**

- **TODO-04:** in `Counter<T>`, keep the count in a static field of the generic type itself, so `Counter<int>.Next()`, `Counter<int>.Next()` and `Counter<string>.Next()` return 1, 2, 1. Today it uses the shared field of `Shared`. There is no test for this challenge, so check it yourself.
- **TODO-05:** in `Settings`, chain the constructors with `this(...)`: `()` uses `"localhost"` and 5432, `(host)` uses 5432, and only `(host, port)` assigns the properties and validates (a blank host throws `ArgumentException`, a port less than or equal to 0 throws `ArgumentOutOfRangeException`). Also untested.

**Prerequisites:** C# classes, constructors and inheritance, `const`, `readonly` and `static`, and the .NET 10 SDK (C# 14).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Red tests tell you which rules are not applied yet, and the `TODO-NN` comments in `Models.cs` explain what to change in each type.

## Documentation Links

- [Instance constructors, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors) (doc)
- [Static constructors, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors) (doc)
- [Constants, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/constants) (doc)
- [readonly keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly) (doc)
- [required modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/required) (doc)
- [SetsRequiredMembersAttribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.codeanalysis.setsrequiredmembersattribute) (doc)
- [TypeInitializationException, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.typeinitializationexception) (doc)
