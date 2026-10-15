---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Access modifiers decide who is allowed to compile a reference to a type or a
member, and C# gives you more of them than most languages: six levels for members, two
of them written with a pair of keywords, plus `file` for types. The defaults matter as much as
the keywords, because a type with no modifier is `internal` and a member with no
modifier is `private`. This concept covers the accessibility rules for types and
members, the two combined modifiers (`protected internal` and `private
protected`) that people mix up, the surprising `protected` rule that blocks
access through a base-typed reference, `InternalsVisibleTo` for tests, the
`file` modifier, and the five members every class inherits from `System.Object`.

## Use Cases

- Keeping a class library's implementation types `internal` so that only a small
  public surface becomes an API you must support.
- Letting a unit-test project reach `internal` types without making them public.
- Choosing between `protected internal` and `private protected` when designing a
  base class for subclassing inside and outside the assembly.
- Hiding a source-generator helper type so it cannot collide with a type of the
  same name in another file.

## Deep Dive

### Type accessibility

A type declared directly in a namespace can be `public` or `internal`, and
`internal` is the default when you write nothing. A nested type can use any
member modifier and defaults to `private`. Putting `private` or `protected` on a
top-level type is an error (CS1527). Interfaces and delegates declared in a
namespace also default to `internal`, but interface members are `public` by
default, because the whole point of an interface is to be called from outside.

The rule that keeps the system consistent: a member cannot be more accessible
than the types in its signature. The compiler rejects it:

```csharp
internal class Helper { }

public class Exposes
{
    public Helper Make() => new Helper();   // error CS0050: return type 'Helper' is less accessible than method 'Exposes.Make()'
    public void Take(Helper h) { }          // error CS0051: parameter type 'Helper' is less accessible than method 'Exposes.Take(Helper)'
    class Nested { }                        // private by default
    public Nested Leak() => new Nested();   // error CS0050 again
}
```

Treat `internal` as the starting point for every type and promote to `public`
only when another assembly truly needs it. A `public` member on an `internal`
type is fine: its effective accessibility is the smaller of the two.

### Member accessibility

For members of a class there are six levels, and the two combined ones are
easy to swap:

| Modifier | Who can use it |
|---|---|
| `private` (the default) | the declaring type only |
| `protected` | the declaring type and derived types, in any assembly |
| `internal` | any code in the same assembly |
| `protected internal` | derived types **or** code in the same assembly (union) |
| `private protected` | derived types **and** in the same assembly (intersection) |
| `public` | everyone |

`private` is per type, not per instance: a method can read the private field of
another instance of the same class. Structs allow only `public`, `internal`, and
`private`. The difference between the two combined modifiers shows up only when a
second assembly subclasses your type. With these members in a library:

```csharp
// Lib.dll
public class Account
{
    protected string Owner = "alice";
    internal int AuditId = 7;
    protected internal string Tag = "t";
    private protected string Secret = "s";
}
```

a subclass in another assembly sees the following:

```csharp
// App.exe, references Lib
class Mine : Account
{
    public string Show(Mine m, Account other)
        => Owner + Tag + m.Owner      // fine: protected and protected internal via a derived-typed reference
         + other.Owner                // error CS1540
         + Secret;                    // error CS0103: the name 'Secret' does not exist in the current context
}
```

`Secret` is not even found, because `private protected` is invisible outside the
assembly, subclass or not. A plain `new Account().Tag` from App is error CS0122
(inaccessible), and `AuditId` is error CS1061 (the member does not exist as far
as App is concerned).

The error on `other.Owner` is the `protected` rule people trip over. Access
through `protected` is allowed only via a reference whose static type is the
accessing class or one derived from it. A `Mine` method can read `m.Owner`, but
not `other.Owner` where `other` is declared as `Account`, because that object
might be a different subclass whose protected state `Mine` has no business
touching. The same restriction applies inside the library when the accessing
class is a subclass, which is how this snippet fails with CS1540 even in the
same assembly:

```csharp
public class Savings : Account
{
    public string PeekOther(Account a) => a.Owner;  // error CS1540: the qualifier must be of type 'Savings'
}
```

### Friend assemblies with InternalsVisibleTo

`internal` stops at the assembly boundary, and tests live in another assembly.
`InternalsVisibleTo` opens a hole for exactly the assemblies you name. In an
SDK-style project it is an MSBuild item, with no attribute file to maintain:

```xml
<ItemGroup>
  <InternalsVisibleTo Include="Lib.Tests" />
</ItemGroup>
```

With that item in Lib.csproj naming the App project, `new Account().AuditId`
(`internal`) and `Helper.Hi()` (an `internal` type) compile in App and print `7`
and `hi`. The friend counts as "the same assembly" for the `internal` half of
every combined modifier, so a subclass in the friend can even use a `private
protected` member, while plain `private` stays closed. Signed assemblies must
name the friend with its public key.

### The file modifier

`file` (C# 11) restricts a top-level type to the source file that declares it. It
cannot be combined with another access modifier, and it applies to types only.
Two files can each declare a `file class Gen`, and they do not collide:

```csharp
// FileA.cs
file class Gen { public static string Who() => "A"; }
public static class UseA { public static string Run() => Gen.Who(); }

// FileB.cs
file class Gen { public static string Who() => "B"; }
public static class UseB { public static string Run() => Gen.Who(); }

// elsewhere: UseA.Run() + UseB.Run() prints "AB", and writing Gen.Who()
// fails with error CS0103: The name 'Gen' does not exist in the current context
```

The feature was built for source generators that emit helper types next to user
code without worrying about name clashes. In application code it is rarely
needed.

### Accessibility is a compile-time fence

Accessibility is enforced by the compiler, not by the runtime. Reflection ignores
it, which is how serializers and DI containers reach private constructors:

```csharp
var field = typeof(Account).GetField("_balance",
    BindingFlags.NonPublic | BindingFlags.Instance);
Console.WriteLine(field?.GetValue(account));   // 0, a private field read from outside
```

Use access modifiers to communicate design intent and to catch mistakes at build
time. Do not use them as a security boundary.

### What every class inherits from System.Object

Every class derives from `System.Object`, directly or not, and so do structs
(through `System.ValueType`). Interfaces have no base type. Five instance members
and one static helper define the baseline behavior (there is also a `protected`
finalizer hook, `Finalize`, which you never call directly):

- `ToString()` returns the type's full name by default. Override it for
  logging and debugging output.
- `Equals(object)` and `GetHashCode()` default to reference identity for
  classes. They must be overridden together, as covered in the dictionary and
  equality concept.
- `GetType()` returns the runtime `Type` and cannot be overridden.
- `MemberwiseClone()` is `protected`, so only the type itself (or a subclass) can
  call it. It copies the object's fields bit by bit.
- `ReferenceEquals(a, b)` is static and always compares identity.

```csharp
class Point
{
    public int X;
    public List<int> Y = [];
    public Point Clone() => (Point)MemberwiseClone();
}

var a = new Point { X = 1, Y = [1] };
var b = a.Clone();
Console.WriteLine(a);                          // Point
Console.WriteLine(a.Equals(b));                // False, different instances
Console.WriteLine(ReferenceEquals(a.Y, b.Y));  // True, the clone is shallow
```

The shallow copy is the part that bites: the clone and the original share the
same `List<int>`, so adding to one changes the other. If you need a deep copy,
write the copy explicitly, as the Java comparison in the related concepts also
warns about `clone()`.

## Trade-offs

- **`internal` by default shrinks the API but makes testing need a hole.** The
  smaller public surface is a promise you do not have to keep, and the price is
  adding `InternalsVisibleTo` for the test project.
  ```xml
  <InternalsVisibleTo Include="Orders.Core.Tests" />
  ```
- **`InternalsVisibleTo` couples assemblies.** A friend assembly can call
  anything `internal`, so refactoring that code now breaks the friend. Keep the
  list to test projects.
- **`protected` exposes more than it seems.** Every protected member is part of
  the contract with every subclass, in every assembly, forever. A `protected
  internal` field is widely visible. When in doubt, prefer `private protected`
  or `internal` for members meant only for your own hierarchy.
- **`public` on a field removes your ability to change it later.** Replacing a
  public field with a property is a binary-breaking change for compiled
  consumers, even though the C# source looks the same. Expose a property from the
  start (see the properties concept).
- **Reflection and serialization pierce access modifiers.** Making a setter
  `private` does not stop a serializer from calling it. Validation that matters
  must live in code paths that every writer goes through.

## Documentation Links

- [Access modifiers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/access-modifiers) (doc)
- [file keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/file) (doc)
- [protected keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/protected) (doc)
- [private protected keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/private-protected) (doc)
- [Friend assemblies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/friend) (doc)
- [Object class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object) (doc)
- [Compiler Error CS1540, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs1540) (doc)
