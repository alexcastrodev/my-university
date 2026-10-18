---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Since C# 3, extension methods let you add instance-looking methods to a type
you do not own, through a static method whose first parameter carries `this`.
C# 14 generalizes the idea with extension blocks: `extension(Type receiver)
{ ... }` inside a static class can declare instance methods, instance
properties, static methods, static properties and operators, all of which
callers use as if the type had declared them. This concept shows each member
kind running on the .NET 10 SDK, generic blocks, `null` and `ref` receivers,
what the compiler emits in metadata (read with ilspy), a binary compatibility
test between the old and new syntax, how ambiguity is resolved, and what the
feature does not allow, with the real compiler errors.

## Use Cases

- `sequence.IsEmpty` as a property on every `IEnumerable<T>`, instead of a
  method that pretends to be a property.
- "Static factories" on types you do not control, such as `Money.Zero`, and
  helpers on static classes such as `Math`.
- Operators for a third-party type, for example `+` to concatenate sequences.
- Moving a library's `this` extension methods to the new syntax without
  breaking compiled callers.
- Grouping all extensions for one receiver in one block instead of repeating
  `this IEnumerable<T> source` on every method.

## Deep Dive

### The block and the member kinds

An extension block lives in a top-level, non-generic static class. Its
parameter is the receiver, and its name is in scope for every instance member:

```csharp
public static class SequenceExtensions
{
    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty => !source.Any();                                    // instance property
        public string JoinWith(string separator) => string.Join(separator, source); // instance method
        public IEnumerable<TResult> MapTo<TResult>(Func<T, TResult> map) => source.Select(map);
        public static IEnumerable<T> operator +(IEnumerable<T> left, IEnumerable<T> right) => left.Concat(right);
    }

    extension(IEnumerable<int>)                    // no name: static members only
    {
        public static IEnumerable<int> Sequence(int start, int count) => Enumerable.Range(start, count);
    }
}

public static class MathExtensions
{
    extension(Math)                                // a static class can be extended with static members
    {
        public static double Remap(double v, double fromLo, double fromHi, double toLo, double toHi)
            => toLo + (v - fromLo) * (toHi - toLo) / (fromHi - fromLo);
    }
}

public static class MoneyExtensions
{
    extension(Money m)
    {
        public static Money Zero => new(0);
        public static Money operator *(Money left, int factor) => new(left.Amount * factor);
    }
}
```

The calls, with the output of `dotnet run` on SDK 10.0.100:

```csharp
int[] empty = [];
List<string> names = ["ana", "bia"];
Console.WriteLine($"{empty.IsEmpty} {names.IsEmpty} {names.JoinWith(" + ")}"); // True False ana + bia
Console.WriteLine(string.Join(",", IEnumerable<int>.Sequence(1, 3)));       // 1,2,3
Console.WriteLine(Math.Remap(5, 0, 10, 0, 100));                             // 50
Console.WriteLine(Money.Zero);                                               // Money { Amount = 0 }
Console.WriteLine(string.Join(",", names + ["caio"]));                       // ana,bia,caio
Console.WriteLine(new Money(10) * 3);                                        // Money { Amount = 30 }
Console.WriteLine(string.Join(",", names.MapTo(s => s.Length)));             // 3,3
```

Type parameters follow one rule from the reference docs: put a type parameter
on the block when the receiver uses it (`extension<T>(IEnumerable<T>)`), on
the member when only the member uses it (`MapTo<TResult>`), never on both.

### Receivers: `null` and `ref`

Instance extension members are static calls underneath, so a `null` receiver
does not throw by itself, exactly like classic extension methods. For value
types, the receiver can be passed by reference:

```csharp
public static class TextExtensions
{
    extension(string? text) { public bool IsBlank => string.IsNullOrWhiteSpace(text); }
}
public static class RefExtensions
{
    extension(ref int value) { public void Increment() => value++; }
}

string? missing = null;
Console.WriteLine(missing.IsBlank);   // True
int counter = 41;
counter.Increment();
Console.WriteLine(counter);           // 42
```

`extension(ref string s)` is rejected with error CS9300 "The 'ref' receiver
parameter of an extension block must be a value type or a generic type
constrained to struct".

### What the compiler emits

Decompiling the class above with `ilspycmd -lv CSharp1` (trimmed, nullable
attributes removed, bodies condensed) shows two layers:

```csharp
[Extension]
public static class SequenceExtensions
{
    [SpecialName][Extension]
    public sealed class <G>$E09FCB5EB13C1AE2FC524F6744DE5322<$T0>        // grouping type
    {
        [SpecialName]
        public static class <M>$28EDA03CA84F5B82CE261A172FD7A22C           // marker type
        {
            public static void <Extension>$(IEnumerable<$T0> source) { }   // encodes the receiver
        }
        [ExtensionMarker("<M>$28EDA03CA84F5B82CE261A172FD7A22C")]
        public bool IsEmpty { get { throw null; } }                         // skeleton, no body
        [ExtensionMarker("<M>$28EDA03CA84F5B82CE261A172FD7A22C")]
        public string JoinWith(string separator) { throw null; }
    }

    public static bool get_IsEmpty<T>(IEnumerable<T> source) => !Enumerable.Any(source);  // implementation
    [Extension]
    public static string JoinWith<T>(IEnumerable<T> source, string separator) => string.Join(separator, source);
    public static IEnumerable<int> Sequence(int start, int count) => Enumerable.Range(start, count);
}
```

The nested types are metadata for compilers: they describe each block (the
feature spec says their content-based names stay stable across recompilation
and reordering) and carry skeleton members whose bodies only `throw`. The real
code is in ordinary static implementation methods on the outer class: the
receiver becomes the first parameter, the block's type parameters are
prepended, and a property becomes `get_IsEmpty`. Call sites go straight to
them:

```text
IL_000b: call bool SequenceExtensions::get_IsEmpty<int32>(class System.Collections.Generic.IEnumerable`1<!!0>)
IL_001a: call string SequenceExtensions::JoinWith<int32>(class System.Collections.Generic.IEnumerable`1<!!0>, string)
```

An instance method in a block is emitted with `[Extension]`, the same shape as
a classic extension method; properties and static members are not. Because
the implementation methods are public static methods, you can always call
them by name: `SequenceExtensions.get_IsEmpty(names)` returned `False`.

### Binary compatibility, tested

The reference docs say both syntaxes generate the same IL for extension
methods and that converting is binary and source compatible. The experiment:
a class library `TextLib` v1 with `public static string Shout(this string s)`
and `IsBlank(this string? s)`, a console app built against it, then v2 of the
library rewritten with extension blocks and copied over the app's output
without rebuilding the app:

```text
# v1, app built against it
HI! (v1, this syntax)
True
# v2 copied over, app not rebuilt
HI! (v2, extension block)
True
# v3 (IsBlank() became a property) copied over
Unhandled exception. System.MissingMethodException: Method not found: 'Boolean TextLib.TextExt.IsBlank(System.String)'.
```

Converting methods to methods is safe. Converting a method into a property is
not, because the implementation becomes `get_IsBlank`: that is a new API, and
callers compiled against the old one break at run time.

### Resolution and ambiguity

A member the type declares always wins. With `Box.Label` and `Box.Describe()`
declared on the class and also as extension members, `box.Label` and
`box.Describe()` printed "instance property instance method". Between
extensions, the rules are the classic ones: candidates come from static classes
in scope through `using`. When two of them match equally:

```csharp
o.Hello();     // error CS0121: The call is ambiguous between the following methods or properties:
               //   'E1.extension(object).Hello()' and 'E2.extension(object).Hello()'
_ = o.Answer;  // error CS9286: 'object' does not contain a definition for 'Answer' and no accessible
               //   extension member 'Answer' for receiver of type 'object' could be found ...
"x".Trimmed(); // error CS0121: ... 'Modern.extension(string).Trimmed()' and 'Classic.Trimmed(string)'
```

The property case is worth remembering: an ambiguous extension property is
reported as "not found", not as ambiguous. The last line shows a classic
`this` method and a block method competing on equal terms. To disambiguate,
call the implementation method through its class: `E1.Hello(o)` printed
"E1.Hello" and `E2.get_Answer(o)` printed `2`.

### What is not allowed

Extension members have no storage. In C# 14 these were rejected (SDK
10.0.100):

| Declaration in a block | Result |
|---|---|
| field, auto-property `{ get; set; }`, event, indexer | error CS9282: This member is not allowed in an extension block |
| `init` accessor | error CS9304: cannot declare init-only accessors in an extension block |
| `virtual` member | error CS0106: The modifier 'virtual' is not valid for this item |
| instance member with an unnamed receiver | error CS9303: cannot declare instance members in an extension block with an unnamed receiver parameter |

The reference docs list extension indexers as a C# 15 addition, which matches
the CS9282 above. If you need per-object state, the BCL's
`ConditionalWeakTable<TKey, TValue>` can attach it without keeping objects
alive, but a property that hides a table lookup surprises readers. Two version
details: with `LangVersion` 13 a block does not even parse (you get syntax
errors such as CS1513 "} expected" and CS1001 "Identifier expected", not a
"feature not available" message), and C# 14 made `extension` a contextual keyword, so a
type named `extension` is now error CS9306 "Types and aliases cannot be named
'extension'".

## Trade-offs

- **Discoverability.** Extension members only exist where their namespace is
  imported, and a reader cannot tell from `x.IsEmpty` whether the type owns it.
  Keep them in a clearly named namespace.
- **Properties should stay cheap.** `IsEmpty` above calls `Any()`, which
  starts an enumeration; on a lazy LINQ query that starts executing it.
- **Method to property is a breaking change.** Method to block method is not;
  verified above.
  ```csharp
  public bool IsBlank() => ...;   // v2: compatible with v1
  public bool IsBlank => ...;     // v3: MissingMethodException for old callers
  ```
- **The type can take your name later.** If the library adds a real
  `IsEmpty`, it silently wins over your extension, which is fine only if both
  mean the same thing.
- **No state, no polymorphism.** Extensions cannot be virtual or store data;
  when you need either, wrap the type or derive from it.

## Lab

In this lab you get `Extensions.cs` with the **C# 14 extension blocks** already declared, but every member returns a placeholder value (`false`, `""`, `[]`, `new(-1)` or nothing). Your job is to replace each placeholder with the real logic, so callers can write `names.IsEmpty`, `Money.Zero` or `counter.Increment()` as if the types themselves declared those members. The core idea is to see that an `extension` block adds properties, static members and even `null` or `ref` receivers to types you do not control.

**The scenario**

You extend types that are not yours (`IEnumerable<T>`, `string?`, `int`) and a type from the lab itself (`Money`), without touching them.

- `Money.cs`: `record Money(int Amount)`, the type that gets a static member.
- `Extensions.cs`, `SequenceExtensions`: a generic `extension<T>(IEnumerable<T> source)` block with `IsEmpty` and `JoinWith`, and an `extension(IEnumerable<int>)` block for static members.
- `MoneyExtensions`: an `extension(Money)` block with the static property `Zero`.
- `TextExtensions`: a block with a `string?` receiver and `IsBlank`.
- `RefExtensions`: a block with a `ref int` receiver and `Increment`.

An extension member is a static call underneath, and one of the tests calls `SequenceExtensions.JoinWith(names, ",")` directly through the class.

**What you will do, step by step**

1. **Instance property and method (TODO-00 and TODO-01).** In the generic block, make `IsEmpty` be `true` when the sequence has no elements (use `source.Any()`) and `JoinWith(separator)` join the elements with `string.Join`.
2. **Static members on outside types (TODO-02).** In the `extension(IEnumerable<int>)` block, `Sequence(start, count)` returns `count` consecutive integers beginning at `start` (`Enumerable.Range`). In `MoneyExtensions`, `Zero` is a static extension property returning `new Money(0)`.
3. **Accept a null receiver (TODO-03).** `IsBlank` is `true` for null, empty and white space. The receiver may be null: since it is a static call underneath, the member does not throw by itself.
4. **Receiver by ref (TODO-04).** `Increment` adds one to the caller's variable, because the receiver is passed by `ref`.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `null.IsBlank` works without a `NullReferenceException`, and why `counter.Increment()` changes the original variable.

**Optional challenges**

These three have no ready-made test, so you check them yourself by calling the code.

- **TODO-05:** add `operator +` on `IEnumerable<T>`, so `names + others` concatenates the two sequences.
- **TODO-06:** create `MathExtensions` with `extension(Math)` and a static method `Remap(double v, double fromLo, double fromHi, double toLo, double toHi)` that maps `v` linearly between the two ranges, so `Math.Remap(5, 0, 10, 0, 100)` is 50.
- **TODO-07:** add `operator *(Money left, int factor)` to `MoneyExtensions`, so `new Money(10) * 3` is `Money(30)`.

**Prerequisites:** classic extension methods (`this` parameter), generics and `IEnumerable<T>`, and a .NET 10 SDK (C# 14).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The project already compiles, so what is left shows up as red tests and as the `TODO-NN` comments next to each placeholder.

## Documentation Links

- [What's new in C# 14: extension members, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Extension member declarations (extension keyword), C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/extension) (doc)
- [Extension members, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods) (doc)
- [Extension members, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/extensions) (doc)
- [ExtensionMarkerAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.extensionmarkerattribute) (doc)
- [C# compiler breaking changes since C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2010) (doc)
- [ConditionalWeakTable class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.conditionalweaktable-2) (doc)
