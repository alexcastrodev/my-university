---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Every .NET assembly carries metadata that describes its types and members, and
`System.Reflection` reads it at run time: list the properties of an object,
call a method chosen by name, read a private field, build `List<T>` for a `T`
known only at run time. Serializers, DI containers, test runners and ORMs were
built on it. It also has costs that are easy to miss: lookups that silently
return nothing because of the wrong `BindingFlags`, exceptions wrapped in
`TargetInvocationException`, boxing on every call, and code the trimmer and
Native AOT cannot see. This concept covers the API on .NET 10 / C# 14, measures
it against a direct call, a cached delegate, a compiled expression and
`[UnsafeAccessor]`, and shows what breaks once an app is trimmed.

## Use Cases

- A plugin loader, test runner or mapper that discovers types and members it
  was not compiled against.
- Reading or setting a private field in a test, or to work around a library.
- Turning a slow `PropertyInfo.GetValue` hot path into a cached delegate or an
  `[UnsafeAccessor]` call.
- Preparing code for `PublishTrimmed` or `PublishAot`, where every IL2xxx or
  IL3050 warning points at reflection that may break.

## Deep Dive

### Getting a Type

`typeof(T)` is resolved at compile time, `obj.GetType()` returns the run-time
type (and throws `NullReferenceException` on `null`), and `Type.GetType(string)`
parses a name at run time:

```csharp
Animal a = new Dog();
Console.WriteLine($"{typeof(Animal)} {a.GetType()}");    // Animal Dog
Console.WriteLine(typeof(Dog).AssemblyQualifiedName);
// Dog, Basics, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null
Type.GetType("Dog");                                       // found: current assembly
Type.GetType("System.Text.Json.JsonSerializer");           // null
Type.GetType("System.Text.Json.JsonSerializer, System.Text.Json");  // found
Type.GetType("System.Text.Json.JsonSerializer", throwOnError: true);
// TypeLoadException: Could not resolve type 'System.Text.Json.JsonSerializer'
// in assembly 't, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null'.
```

The docs say a namespace-qualified name is enough only for types in the calling
assembly or in `System.Private.CoreLib` (`"System.Int32"` resolved), which is
what happened. Otherwise add the assembly name after a comma. Nested types use
`+`: `"Outer+Inner"` resolved, `"Outer.Inner"` returned `null`.

### Discovery and the BindingFlags traps

`GetProperties()`, `GetFields()`, `GetMethods()`, `GetConstructors()` and
`GetMembers()` without arguments use `Public | Instance | Static`. Passing flags
replaces that default; it does not add to it:

```csharp
typeof(Dog).GetProperties();                          // Name, Species, Sound
typeof(Dog).GetProperties(BindingFlags.Instance);     // (empty)
typeof(Dog).GetProperties(BindingFlags.Public | BindingFlags.Instance
                          | BindingFlags.DeclaredOnly);   // Name
typeof(Dog).GetFields(BindingFlags.NonPublic | BindingFlags.Instance);
// <Name>k__BackingField, <Age>k__BackingField, <Secret>k__BackingField
typeof(Dog).GetFields();                              // Id, Kind (no Animal.Population)
typeof(Dog).GetFields(BindingFlags.Public | BindingFlags.Static
                      | BindingFlags.FlattenHierarchy);   // Kind, Population
typeof(Dog).GetMethods().Length;                      // 12, with GetType, Equals...
typeof(Dog).GetMethod("Speak");
// AmbiguousMatchException: Ambiguous match found for 'Dog System.String Speak()'.
typeof(Dog).GetMethod("Speak", [typeof(int)]);        // System.String Speak(Int32)
```

`Instance` alone matches nothing: add `Public`, `NonPublic` or both. Inherited
statics need `FlattenHierarchy`, and the docs say even then only public and
protected ones come back (the base's `private static` field never appeared).
Private members of a base class show up only on the base type itself. Pass
parameter types to disambiguate overloads; add `IgnoreCase` for case-insensitive
names. On order, the API docs say it was undefined up to .NET 6 and "starting
with .NET 7, the ordering is deterministic based upon the metadata ordering in
the assembly"; `class Order3 { Z; A; M(); B }` gave `Z, A, B`. That is not a
promise of declaration order, so sort explicitly when order matters.

### Private members, creating instances, invoking

```csharp
typeof(Animal).GetField("_secret", BindingFlags.NonPublic | BindingFlags.Instance)!
    .SetValue(dog, "changed");                           // private field: works
typeof(Dog).GetField("Id")!.SetValue(dog, 99);           // readonly instance field: works
typeof(Dog).GetProperty("Name")!.SetValue(dog, "Rex2");  // private setter: works
typeof(Cfg).GetField("Limit")!.SetValue(null, 5);        // static readonly
// FieldAccessException: Cannot set initonly static field 'Limit' after type 'Cfg' is initialized.
// (a const field: FieldAccessException: Cannot set a constant field.)

Activator.CreateInstance(typeof(Dog), "Bolt");       // picks Dog(string)
Activator.CreateInstance(typeof(Dog), 5);            // Dog(int) is private
// MissingMethodException: Constructor on type 'Dog' not found.
Activator.CreateInstance(typeof(Dog), BindingFlags.NonPublic | BindingFlags.Instance,
    null, [5], null);                                // works
typeof(Dog).GetConstructor([typeof(string)])!.Invoke(["Ace"]);

object?[] callArgs = [10, null];                     // static bool TryHalf(int n, out int half)
var ok = typeof(Calc).GetMethod("TryHalf")!.Invoke(null, callArgs);
Console.WriteLine($"{ok} {callArgs[1]}");            // True 5: the out value lands in the array

var boom = typeof(Calc).GetMethod("Boom")!;          // throws InvalidOperationException("boom inside")
try { boom.Invoke(null, null); }
catch (TargetInvocationException e) { Console.WriteLine(e.InnerException!.Message); }
// TargetInvocationException: Exception has been thrown by the target of an invocation.
// InnerException: InvalidOperationException: boom inside
boom.Invoke(null, BindingFlags.DoNotWrapExceptions, null, null, null);
// InvalidOperationException: boom inside   (no wrapper)
```

`ref` and `out` go through the argument array (the parameter type shows as
`System.Int32&`), so keep a reference to it. Mistakes in the call itself throw
directly (`TargetParameterCountException: Parameter count mismatch.`, or
`TargetException: Non-static method requires a target.` for a `null` instance),
but an exception thrown *inside* the target is wrapped, also for a throwing
constructor under `Activator.CreateInstance` and a throwing getter under
`GetValue`. `BindingFlags.DoNotWrapExceptions` works on .NET 10 and lets
existing `catch` blocks see the original exception.

### Generics, assignability and nullability

```csharp
var closed = typeof(Dictionary<,>).MakeGenericType(typeof(string), typeof(int));
Console.WriteLine(closed);   // System.Collections.Generic.Dictionary`2[System.String,System.Int32]
// typeof(Dictionary<,>).IsGenericTypeDefinition: True; closed.GetGenericArguments(): String, Int32
Activator.CreateInstance(typeof(Dictionary<,>));
// ArgumentException: Cannot create an instance of ...Dictionary`2[TKey,TValue]
// because Type.ContainsGenericParameters is true.
typeof(Calc).GetMethod("Describe")!.MakeGenericMethod(typeof(int)).Invoke(null, [5]);
// "Int32:5" (static string Describe<T>(T v))

typeof(Animal).IsAssignableFrom(typeof(Dog));                       // True
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<string>)); // True (covariance)
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<int>));    // False (value type)
typeof(IEnumerable<>).IsAssignableFrom(typeof(List<int>));          // False (open type)
typeof(long).IsAssignableFrom(typeof(int));                         // False
```

`IsAssignableFrom` reads from the target's side (`IsAssignableTo` reads the
other way). It ignores numeric conversions, and an open generic never matches:
search `GetInterfaces()` for one whose `GetGenericTypeDefinition()` is
`IEnumerable<>`. Nullable reference annotations are not part of the `Type`
(`string?` is `System.String`); `new NullabilityInfoContext().Create(prop)`
reads them: `ReadState` was `Nullable` for `string? Nick`, `NotNull` for
`string Name`, and `Nullable` in `GenericTypeArguments[0]` of `List<string?>`.

### Assembly.GetTypes and ReflectionTypeLoadException

Scanning an assembly fails as a whole when one type cannot load. With `LibA.dll`
holding `Fine`, `Derived : LibB.BaseThing` and `AlsoFine`, and `LibB.dll`
deleted, `asm.GetTypes()` threw `ReflectionTypeLoadException` ("Unable to load
one or more of the requested types."), its `Types` held `Fine, AlsoFine, null`
and `LoaderExceptions[0]` said "Could not load file or assembly 'LibB, ...'".
Keep the non-null `ex.Types` and log `LoaderExceptions`. `GetExportedTypes()`
gave no partial result: it threw `FileNotFoundException`.

### What it costs

BenchmarkDotNet 0.15.8, `ShortRunJob`, Release, Apple M4 Max, reading an `int`
property 1,000 times per invocation. Only the order of magnitude matters:

| Read of `p.Age` | Per call | Allocated |
|---|---|---|
| direct `p.Age` | about 0.26 ns | 0 |
| `[UnsafeAccessor]` field accessor | about 0.26 ns | 0 |
| cached `Func<Person,int>` from `CreateDelegate` | about 1.3 ns | 0 |
| cached `Expression.Lambda(...).Compile()` | about 1.3 ns | 0 |
| cached `PropertyInfo.GetValue` | about 5.9 ns | 24 B |
| `GetProperty("Age")` on every call, then `GetValue` | about 8.5 ns | 24 B |
| `GetProperties()`: `Person` (2) / `HttpRequestMessage` | about 17 / 43 ns | 40 / 208 B |

A cached `GetValue` cost about 20 times a direct read, and the 24 bytes are the
boxed `int` (a `string` property allocated nothing). Repeating the lookup added
only about 3 ns, but each `GetProperties()` call returns a new array that grows
with the type. Build delegates once and keep them in a static field or a
`ConcurrentDictionary<Type, ...>`; the expression trees concept measured
`Compile()` itself as expensive.

### UnsafeAccessor: private access without reflection

.NET 8 added `[UnsafeAccessor]`: an `extern` method whose body the runtime
generates to reach a member directly. The first parameter is the target type:

```csharp
static class Accessors
{
    [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_balance")]
    public static extern ref decimal Balance(Account a);
    [UnsafeAccessor(UnsafeAccessorKind.Method, Name = "Audit")]   // private method
    public static extern string Audit(Account a, string who);
    [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_balanse")]   // typo
    public static extern ref decimal Wrong(Account a);
}
static class BoxAccessors<T>   // generic targets: since .NET 9
{ [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_value")] public static extern ref T Value(Box<T> b); }
Accessors.Balance(acc) = 500m;                  // writes through the ref
Console.WriteLine(Accessors.Audit(acc, "x"));   // x saw 500
Console.WriteLine(BoxAccessors<int>.Value(new Box<int>(42)));   // 42
Accessors.Wrong(acc);   // MissingFieldException: Field not found: 'Account._balanse'.
```

The typo compiled with no warning and failed only when called; a wrong method
signature gave `MissingMethodException: Method not found: 'Account.Audit'.`.
Generic targets need a generic accessor class whose type parameters match, as
above. The `Constructor` and `StaticField` kinds worked too, and the field
accessor ran unchanged in a Native AOT binary.

### Trimming and Native AOT

Publishing a small app with `-p:PublishTrimmed=true`, and again with
`-p:PublishAot=true` (which worked here with the installed Xcode toolchain and
produced a 2 MB binary), flagged each reflection call the analyzer could not
follow (IL2057 for `Type.GetType(args[0])`, IL2026 for `JsonSerializer`):

```text
Program.cs(10,13): warning IL2075: 'this' argument does not satisfy
  'DynamicallyAccessedMemberTypes.PublicProperties' in call to 'System.Type.GetProperties()'.
  The return value of method 'System.Object.GetType()' does not have matching annotations. ...
```

AOT added IL3050 ("...has 'RequiresDynamicCodeAttribute' can break functionality
when AOT compiling") on `JsonSerializer.Serialize` and `MakeGenericType`. The
warnings were real: in both binaries,
``Type.GetType("System.Collections.Generic.PriorityQueue`2, System.Collections")``
returned `null` (the untrimmed build found it), `JsonSerializer.Serialize`
threw `InvalidOperationException: Reflection-based serialization has been
disabled for this application.`, and under AOT
`Activator.CreateInstance(typeof(List<>).MakeGenericType(typeof(Guid)))` threw
``NotSupportedException: 'System.Collections.Generic.List`1[System.Guid]' is
missing native code or metadata.`` (with `typeof(int)` it worked). Types of the
app's own assembly survived, so a lookup can pass locally and fail only on a
library type. A `Type` parameter annotated with
`[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)]`
makes the trimmer keep those members, and its `GetMethod` call raised no
warning. The AOT-safe replacement moves the work to compile time: source
generators, and `System.Text.Json` source generation (`[JsonSerializable]`
serialized fine in the same native binary).

## Trade-offs

- **Flexibility costs compile-time checking.** Every member name is a string; a
  rename breaks it at run time. Use `nameof` wherever the member is visible.
- **Default flags rarely mean what you want.** Write the full combination
  (`Public | NonPublic | Instance | DeclaredOnly`) and assert on the result.
- **Cache, then delegate.** `CreateDelegate` and compiled expressions are close
  to direct calls once built; `GetValue` boxes every value type.
- **`UnsafeAccessor` is fast and brittle.** A renamed private field breaks it
  only at run time, so test every accessor.
- **Reflection and trimming pull against each other.** Annotate with
  `DynamicallyAccessedMembers`, mark the rest `RequiresUnreferencedCode`, and
  prefer a source generator when AOT is a goal.

## Documentation Links

- [Reflection in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/overview) (doc)
- [Attributes and reflection (C#), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) (doc)
- [BindingFlags enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.bindingflags?view=net-10.0) (doc)
- [Type.GetProperties method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.type.getproperties?view=net-10.0) (doc)
- [UnsafeAccessorAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafeaccessorattribute?view=net-10.0) (doc)
- [Prepare .NET libraries for trimming, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) (doc)
