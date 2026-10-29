---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

`System.Reflection` reads assembly metadata at run time: list an object's
properties, call a method chosen by name, read a private field, build `List<T>`
for a `T` known only at run time. Serializers, DI containers and test runners
were built on it. Its costs are easy to miss: lookups that silently return
nothing because of the wrong `BindingFlags`, wrapped exceptions, boxing, and
code the trimmer and Native AOT cannot see. This concept covers the API on
.NET 10 / C# 14, its measured cost, its replacements, and trimming.

## Use Cases

- A plugin loader, test runner or mapper that discovers unknown types.
- Reading or setting a private field in a test, or to work around a library.
- Replacing a hot `PropertyInfo.GetValue` with a delegate or `[UnsafeAccessor]`.
- Preparing code for `PublishTrimmed` or `PublishAot` (IL2xxx and IL3050).

## Deep Dive

### Getting a Type

`typeof(T)` is resolved at compile time, `obj.GetType()` returns the run-time
type (and throws `NullReferenceException` on `null`), and `Type.GetType(string)`
parses a name at run time:

```csharp
Animal a = new Dog(); Console.WriteLine($"{typeof(Animal)} {a.GetType()}");  // Animal Dog
Console.WriteLine(typeof(Dog).AssemblyQualifiedName);
// Dog, Basics, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null
Type.GetType("Dog");                                       // found: current assembly
Type.GetType("System.Text.Json.JsonSerializer");           // null
Type.GetType("System.Text.Json.JsonSerializer, System.Text.Json");  // found
Type.GetType("System.Text.Json.JsonSerializer", throwOnError: true);
// TypeLoadException: Could not resolve type 'System.Text.Json.JsonSerializer'
// in assembly 'Basics, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null'.
```

As the docs say, a bare namespace-qualified name only finds types in the calling
assembly or `System.Private.CoreLib` (`"System.Int32"` resolved); otherwise add
the assembly name. Nested types use `+` (`"Outer.Inner"` returned `null`).

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
typeof(Dog).GetMethod("Speak");
// AmbiguousMatchException: Ambiguous match found for 'Dog System.String Speak()'.
typeof(Dog).GetMethod("Speak", [typeof(int)]);        // System.String Speak(Int32)
```

`Instance` alone matches nothing: add `Public`, `NonPublic` or both. Inherited
statics need `FlattenHierarchy`, and the docs say even then only public and
protected ones come back (the base's `private static` field never appeared).
Private members of a base class show up only on the base type itself. Pass
parameter types for overloads; names are case-sensitive without `IgnoreCase`.
On order, the API docs say "starting with .NET 7, the ordering is deterministic
based upon the metadata ordering in the assembly" (undefined before);
`class Order3 { Z; A; M(); B }` gave `Z, A, B`. Sort explicitly anyway.

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
boom.Invoke(null, null);  // TargetInvocationException: Exception has been thrown by
                          // the target of an invocation. (InnerException: boom inside)
boom.Invoke(null, BindingFlags.DoNotWrapExceptions, null, null, null);
// InvalidOperationException: boom inside   (no wrapper)
```

`ref` and `out` go through the argument array (the parameter type shows as
`System.Int32&`). Call mistakes throw directly (`TargetParameterCountException:
Parameter count mismatch.`; `TargetException: Non-static method requires a
target.` for a `null` instance), but an exception *inside* the target is
wrapped, also from a constructor under `Activator.CreateInstance` or a getter
under `GetValue`. `BindingFlags.DoNotWrapExceptions` works on .NET 10.

### Generics, assignability, nullability, GetTypes

```csharp
var closed = typeof(Dictionary<,>).MakeGenericType(typeof(string), typeof(int));
Console.WriteLine(closed);   // System.Collections.Generic.Dictionary`2[System.String,System.Int32]
// IsGenericTypeDefinition: True for Dictionary<,>; closed.GetGenericArguments(): String, Int32
Activator.CreateInstance(typeof(Dictionary<,>));
// ArgumentException: Cannot create an instance of ...Dictionary`2[TKey,TValue]
// because Type.ContainsGenericParameters is true.
typeof(Calc).GetMethod("Describe")!.MakeGenericMethod(typeof(int)).Invoke(null, [5]);
// "Int32:5" (static string Describe<T>(T v))

typeof(Animal).IsAssignableFrom(typeof(Dog));                       // True
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<string>)); // True (covariance)
typeof(IEnumerable<object>).IsAssignableFrom(typeof(List<int>));    // False (value type)
typeof(IEnumerable<>).IsAssignableFrom(typeof(List<int>));          // False (open type)
```

`IsAssignableFrom` reads from the target's side (`IsAssignableTo` reads the
other way) and ignores numeric conversions (`long` from `int`: `False`). For an
open generic, search `GetInterfaces()` by `GetGenericTypeDefinition()`.
Nullable annotations are not part of the `Type` (`string?` is `System.String`);
`new NullabilityInfoContext().Create(prop)` reads them: `ReadState` was
`Nullable` for `string? Nick`, `NotNull` for `string Name`, and `Nullable` in
`GenericTypeArguments[0]` of `List<string?>`.

Scanning an assembly fails as a whole when one type cannot load. With `LibA.dll`
holding `Fine`, `Derived : LibB.BaseThing` and `AlsoFine`, and `LibB.dll`
deleted, `asm.GetTypes()` threw `ReflectionTypeLoadException` ("Unable to load
one or more of the requested types."), its `Types` held `Fine, AlsoFine, null`
and `LoaderExceptions[0]` said "Could not load file or assembly 'LibB, ...'".
Keep the non-null `ex.Types`, log `LoaderExceptions`; `GetExportedTypes()` just
threw `FileNotFoundException`.

### What it costs

BenchmarkDotNet 0.15.8, `ShortRunJob`, Apple M4 Max, 1,000 reads per invocation:

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
with the type. Build delegates once and cache them (the expression trees
concept measured `Compile()` itself as expensive).

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
Generic targets need a generic accessor class with matching type parameters.
`Constructor` and `StaticField` kinds worked too; a field accessor also ran
under Native AOT.

### Trimming and Native AOT

Publishing a small app with `-p:PublishTrimmed=true`, and with
`-p:PublishAot=true` (it worked with the installed Xcode toolchain: a 2 MB
binary), flagged what the analyzer could not follow: IL2057 on
`Type.GetType(args[0])`, IL2026 on `JsonSerializer.Serialize`, and:

```text
Program.cs(10,13): warning IL2075: 'this' argument does not satisfy 'DynamicallyAccessedMemberTypes.PublicProperties'
  in call to 'System.Type.GetProperties()'. The return value of method 'System.Object.GetType()' does not have ...
```

AOT added IL3050 ("...has 'RequiresDynamicCodeAttribute' can break functionality
when AOT compiling") on `JsonSerializer.Serialize` and `MakeGenericType`. The
warnings were real. In both binaries
``Type.GetType("System.Collections.Generic.PriorityQueue`2, System.Collections")``
returned `null` (the untrimmed build found it), `JsonSerializer.Serialize`
threw `InvalidOperationException: Reflection-based serialization has been
disabled for this application.`, and under AOT
`Activator.CreateInstance(typeof(List<>).MakeGenericType(typeof(Guid)))` threw
``NotSupportedException: 'System.Collections.Generic.List`1[System.Guid]' is
missing native code or metadata.`` (`typeof(int)` worked). The app's own types
survived, so a lookup can pass locally and fail on a library type. A `Type`
parameter annotated `[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)]`
makes the trimmer keep those members, and its `GetMethod` call raised no
warning. The AOT-safe fix moves the work to compile time: source generators and
`System.Text.Json` source generation (`[JsonSerializable]` worked natively).

## Trade-offs

- **Flexibility costs compile-time checking.** Member names are strings; use
  `nameof` where you can, and write full `BindingFlags` combinations.
- **Cache, then delegate.** Cached delegates are near direct calls; `GetValue`
  boxes value types. `UnsafeAccessor` is fastest and breaks on a rename.
- **Reflection and trimming pull apart.** Annotate with `DynamicallyAccessedMembers`,
  mark the rest `RequiresUnreferencedCode`; for AOT, prefer a source generator.

## Documentation Links

- [Reflection in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/reflection/overview) (doc)
- [Attributes and reflection (C#), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/) (doc)
- [BindingFlags enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.bindingflags?view=net-10.0) (doc)
- [Type.GetProperties method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.type.getproperties?view=net-10.0) (doc)
- [UnsafeAccessorAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafeaccessorattribute?view=net-10.0) (doc)
- [Prepare .NET libraries for trimming, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) (doc)
