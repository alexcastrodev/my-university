---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

`partial` lets one type live in several source files, and since C# 13 and C# 14
it also lets a single member be split into a declaration in one place and an
implementation in another. The reason this matters today is not designer files
but source generators: `[GeneratedRegex]`, `[LoggerMessage]`, and
`[LibraryImport]` all work by asking you to write a `partial` signature and
letting the compiler fill in the body. This concept covers how partial type
declarations merge, the two kinds of partial methods, partial properties and
indexers (C# 13), partial constructors and events (C# 14), the exact compiler
errors for each rule, and the contract between your code and a generator.

## Use Cases

- Splitting a large class so that hand-written and generated code live in
  different files.
- Replacing a runtime `Regex` or reflection-based logging with compile-time
  generated code, without changing the call sites.
- Giving a generator a stable place to put a constructor or an event
  implementation that you declare yourself.
- Reading the error messages when a generator and your declaration disagree.

## Deep Dive

### How partial type declarations merge

Every declaration of the type must carry `partial`, and the compiler combines
them into one type. A missing modifier on any part is error CS0260. Accessibility
must agree when it is written (CS0262), while some modifiers combine: if one part
says `sealed`, the whole type is sealed, and base types and interfaces are the
union across parts.

```csharp
partial class Order : IDisposable { public void Dispose() { } }
sealed partial class Order : Base, IComparable { public int CompareTo(object? o) => 0; }

typeof(Order).IsSealed;                                  // True
typeof(Order).GetInterfaces().Select(i => i.Name);       // IDisposable, IComparable
typeof(Order).BaseType;                                  // Base
```

All parts must be compiled together into the same assembly. `partial` is also
allowed on structs, interfaces, and records, but not on enums or delegates.
Partial types add no runtime meaning: after compilation there is one type, and
the parts are gone.

### Partial methods: the legacy form and the extended form

The original form (C# 3) is built for optional hooks. It must return `void`, has
no `out` parameters, and has no accessibility modifier (it is implicitly
private). If no part implements it, the compiler removes the call, **including
the evaluation of its arguments**:

```csharp
sealed partial class Order
{
    partial void OnSaving(string detail);          // never implemented
    public void Save()
    {
        OnSaving(Expensive());                     // call and argument both removed
        Console.WriteLine("saved");
    }
    static string Expensive() { Console.WriteLine("Expensive() ran"); return "x"; }
}
// new Order().Save() prints only: saved
```

Since C# 9 a partial method with any accessibility modifier, a non-`void` return
type, or an `out` parameter is an **extended** partial method. It has no
"optional" escape hatch: the implementation is mandatory, otherwise the compiler
reports error CS8795 (`Partial method 'A1.Name()' must have an implementation
part because it has accessibility modifiers`). The two declarations must also
agree on accessibility (CS8799). This is the form generators use.

### Partial properties and indexers (C# 13)

A partial property has a defining declaration, written like an auto-property,
and an implementing declaration with real accessor bodies. Indexers follow the
same rule. Signatures must match.

```csharp
public partial class Widget
{
    public partial string Title { get; set; }       // defining
    public partial int this[int i] { get; }
}

public partial class Widget
{
    private string _title = "";
    private int _size = 3;
    public partial string Title { get => _title; set => _title = value.Trim(); }
    public partial int this[int i] => i * _size;
}
```

The implementing declaration cannot itself be an auto-property, because it would
look like a second defining declaration: that is error CS9250 (`A partial
property may not have multiple defining declarations, and cannot be an
auto-property`). A defining declaration without an implementation is CS9248. In
C# 14 the implementing declaration can use the `field` keyword, so an
implementation such as `get => field; set => field = value;` compiled in the
experiment without a manual backing field.

### Partial constructors and events (C# 14)

C# 14 completes the set. Both follow the same one-defining, one-implementing
shape, and the official notes add two rules:

- Only the **implementing** declaration of a constructor can have an initializer
  (`: this(...)` or `: base(...)`), and only one part of the type may declare a
  primary constructor.
- The defining declaration of an event is field-like (`public partial event
  Action<string> Changed;`) and the implementing one must provide `add` and
  `remove` accessors.

```csharp
public partial class Widget
{
    public partial Widget(int size);                       // defining
    public partial event Action<string> Changed;           // defining
}

public partial class Widget
{
    private int _size;
    private Action<string>? _changed;

    public partial Widget(int size) { _size = size; }       // implementing, may add : this(...)

    public partial event Action<string> Changed
    {
        add => _changed += value;
        remove => _changed -= value;
    }
}
```

These compiled and ran on SDK 10.0.100 with the default language version. The
errors in the experiments name the rule that was broken: a defining declaration
with no implementation gives CS9275 (`Partial member 'A9.A9(int)' must have an
implementation part`), two defining declarations give CS9277, and a second
implementing body gives CS9278. A constructor body written in the defining
declaration counts as the implementation, which is why putting `: this()` there
fails with CS9276 or CS9278 instead of a friendly message.

### The contract with source generators

A generator cannot edit your file, so it adds a second part of your class.
You write the signature, the generator writes the body, and the partial rules
above are the glue. Three built-in generators show the pattern, each with its
output:

```csharp
public static partial class Matcher
{
    [GeneratedRegex(@"\d+")]
    public static partial Regex Digits();          // method form (.NET 7)

    [GeneratedRegex(@"\d+")]
    public static partial Regex DigitsProp { get; } // property form (partial properties)
}

public partial class Service(ILogger<Service> logger)
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Started job {Id}")]
    private partial void Started(int id);
}

internal static partial class Native
{
    [LibraryImport("libc", EntryPoint = "getpid")]
    internal static partial int GetPid();          // needs <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
}
```

`Matcher.Digits().Match("abc 123 def").Value` returns `123`, the log call prints
`Started job 7`, and `GetPid()` matches `Environment.ProcessId`. Setting
`<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>` writes the
generated parts to disk, and they show the glue clearly: the Regex part is a
`partial class Matcher` whose `Digits()` returns a cached instance of a
generated `Regex` subclass; the logging part is another `partial class Service`
that uses the `logger` primary constructor parameter declared in **your** part,
checks `IsEnabled`, and calls a static `LoggerMessage.Define` callback.

One trap: set `CompilerGeneratedFilesOutputPath` to a folder under `obj/`. If you
point it at a folder in the project root, the next build includes those files as
normal sources and fails with errors such as CS0757 and CS0102 (the generated
code now exists twice).

## Trade-offs

- **A partial class spreads one design over several files.** It is good for
  generated code and tedious for people: to read the constructors you must open
  every part. Keep hand-written types in one file unless a generator forces a
  split.
- **Legacy partial methods vanish silently.** A typo in the implementing name
  produces a second, unrelated method, and the hook never runs, with no error.
  Prefer the extended form, where the compiler demands an implementation.
  ```csharp
  partial void OnSaving(string d);       // implemented as OnSavng(...) later: no error
  ```
- **Removed calls skip side effects.** In the legacy form the argument
  expression is not evaluated either, so `OnSaving(Expensive())` is free when
  nothing implements it, and a bug if `Expensive()` also did something you
  relied on.
- **Generators need a partial shell, and every containing type is part of it.**
  `[GeneratedRegex]` on a method inside a class, or a nested class, that is not
  `partial` fails with CS0260, because the generated part is a `partial`
  declaration of that type. The upside is a typed API and no regex construction
  cost at startup; the cost is generated code that is invisible in code review.
  ```csharp
  public class NotPartial { [GeneratedRegex(@"\d+")] public static partial Regex Digits(); }
  // error CS0260: Missing partial modifier on declaration of type 'NotPartial'
  ```
- **The newer members need a newer compiler.** Partial properties and indexers
  need C# 13, and partial constructors and events need C# 14 (SDK 10). A
  contributor building with an older SDK cannot compile those files at all, so
  adopt them when the whole team and the CI image have moved.
- **Generated files are a debugging surface, not source.** Never edit
  them: the next build overwrites the file. Read them through
  `EmitCompilerGeneratedFiles` when a signature mismatch error looks
  mysterious.

## Lab

In this lab you get a set of types split across several `Type.Part.cs` files, with the defining declarations already written and the implementing parts **stubbed** (they throw `NotImplementedException`), plus ready xUnit tests. Your job is to fill in the implementations. The core idea is to understand the contract between hand-written code and the other half of a partial type, which is exactly what happens when a source generator emits code for your class.

**The scenario**

Each type illustrates one rule of partial types and members, under `src/PartialLab`.

- `Order.cs` and `Order.Comparison.cs`: the two parts of `Order`. Modifiers and interfaces are merged across parts.
- `Quiet.cs`, `Loud.cs` and `Loud.Hooks.cs`: the "legacy" partial method (`partial void`). In `Quiet` nobody implements it, in `Loud` there is an implementation.
- `Widget.cs`, `Widget.Members.cs` and `Widget.Lifecycle.cs`: the defining declarations (partial constructor, property, indexer, event and method) and the two implementing parts.
- `Greeter.cs` and `Greeter.Generated.cs`: `Greeter.Generated.cs` **simulates** what a source generator would emit. No generator package is used, and you **must not edit** that file. It calls `Prefix`, which your part has to provide.

**What you will do, step by step**

1. **Merge modifiers and interfaces (TODO-00).** In `Order.Comparison.cs`, add `sealed` on this second part only (not in `Order.cs`) and implement `CompareTo` comparing by `Total`, with `null` sorting first (return 1). The test checks that `Order` is sealed, derives from `Entity` and implements `IComparable<Order>`.
2. **Hooks that vanish and hooks that exist (TODO-01).** In `Quiet.Save`, call `OnSaving(Expensive())` and return `"saved"`: since the hook has no implementation, the compiler removes the call and its argument, so `Expensive()` never runs. In `Loud.Hooks.cs`, implement the hook by adding `"saving:<detail>"` to `Log`.
3. **Partial property, indexer and method (TODO-02).** In `Widget.Members.cs`, implement `Title` (the getter returns the stored value and the setter stores the trimmed value), the indexer (returns `i` times the widget size) and `Describe` (`"<Title>:<this[1]>"`). The implementing property **cannot** be an auto-property (error CS9250).
4. **Partial constructor and event (TODO-03).** In `Widget.Lifecycle.cs`, make the constructor throw `ArgumentOutOfRangeException` for a zero or negative size and store `_size`. Implement the event with `add` and `remove` over `_changed`, and `RaiseChanged` invoking the handlers, if any.
5. **Honor the generator contract (TODO-04).** In `Greeter.cs`, make `Prefix` expose the primary constructor parameter, and `GreetAll` join the `Greet` results of all names separated by a single space.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `Expensive()` does not run in `Quiet`, and what `Greeter` must provide so the "generated" half compiles.

**Optional challenges**

- **TODO-05:** rewrite the `Title` implementation using the C# 14 `field` keyword instead of the `_title` field. Does the property still compile as an implementing declaration?
- **TODO-06:** add a second implementing body for `Describe` in another file, or remove the implementation of `Describe`. Read the compiler error code and match it with the rule in the concept.

**Prerequisites:** C# classes, properties and events, primary constructors and the .NET 10 SDK (C# 14).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The stubbed parts throw `NotImplementedException` and carry `TODO-NN` comments, so red tests are your checklist.

## Documentation Links

- [partial type, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-type) (doc)
- [partial member, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [.NET regular expression source generators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [P/Invoke source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) (doc)
