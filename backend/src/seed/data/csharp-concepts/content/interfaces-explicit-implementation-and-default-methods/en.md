---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An interface is a contract: a type that implements it promises to have certain
members, and code that depends on the interface can work with any of those
types, classes and structs alike. Modern C# interfaces carry more than
signatures. They can hide a member behind explicit implementation, ship a
default body (C# 8), and require static members such as factories and operators
(C# 11). This concept covers implicit versus explicit implementation and when
explicit is the only option, default interface methods and the diamond they can
create, `static abstract` and `static virtual` members at an introductory level,
and the comparison trio every data type meets sooner or later: `IComparable<T>`,
`IComparer<T>` and `IEquatable<T>`. The choice between an interface and an
abstract class is covered in the inheritance concept.

## Use Cases

- A class that is both a writer and a connection, where `Close` means a
  different thing for each.
- Implementing `IEnumerable<T>` without exposing the weakly typed
  non-generic `GetEnumerator` on the public surface.
- Adding a convenience method to a published interface without breaking every
  existing implementation.
- A generic `ParseAll<T>` that needs to call `T.Parse` on the type itself, not
  on an instance.
- Making a value type sortable with `Array.Sort` and usable as a `HashSet` key
  without surprises.

## Deep Dive

### Implicit and explicit implementation

A public member with the right signature implements the interface member
implicitly, and callers can reach it through the class or the interface.
An explicit implementation names the interface and is reachable only through
an interface-typed reference:

```csharp
var file = new LogFile();
((IWriter)file).Close();     // flush buffer
((IConnection)file).Close(); // drop socket
// file.Close();             // error CS1061: 'LogFile' does not contain a definition for 'Close'

interface IWriter { void Close(); }
interface IConnection { void Close(); }

sealed class LogFile : IWriter, IConnection
{
    void IWriter.Close() => Console.WriteLine("flush buffer");
    void IConnection.Close() => Console.WriteLine("drop socket");
}
```

Explicit implementation is required when two interfaces declare the same
signature with different meanings, or when two members differ only in return
type, which is exactly the case of `IEnumerable<T>`: the generic and the
non-generic `GetEnumerator()` take no parameters and return different types.
The usual pattern is to implement the generic one publicly and forward the old
one explicitly:

```csharp
sealed class Names(string[] items) : IEnumerable<string>
{
    public IEnumerator<string> GetEnumerator() => ((IEnumerable<string>)items).GetEnumerator();
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}
```

It is also a way to keep a member off the public API when it only makes sense to
code that already treats the object as the interface. Explicit members cannot
have an access modifier and cannot be `virtual`; a subclass that needs to change
them re-implements the interface.

### Default interface methods (C# 8)

An interface member can have a body. Classes that do not implement the member
get the default; classes that do implement it replace it:

```csharp
ILogger log = new Plain();
log.Info("started");                  // INFO started
ILogger custom = new Prefixed();
custom.Info("started");               // [info] STARTED

interface ILogger
{
    void Write(string level, string message);
    void Info(string message) => Write("INFO", message); // added in v2
}
class Plain : ILogger
{
    public void Write(string level, string message) => Console.WriteLine($"{level} {message}");
}
class Prefixed : ILogger
{
    public void Write(string level, string message) => Console.WriteLine($"[{level}] {message}");
    public void Info(string message) => Write("info", message.ToUpperInvariant());
}
```

Three things surprise people. First, the default is not inherited as a class
member: `new Plain().Info("x")` fails with CS1061, so you must call it through
the interface. Second, default bodies need runtime support that arrived in
.NET Core 3.0, which is why .NET Framework cannot use them. Third, the main
motivation is versioning: the Framework Design Guidelines still say not to add
members to a shipped interface, and a default body is what makes adding one
non-breaking for existing implementers.

Interfaces still cannot hold instance state. A property declared in an
interface without a body is abstract, not an auto-property, because there is no
field to put the value in.

### The diamond

If two interfaces derived from the same base both supply a body for the same
member, a class that implements both has no single answer, and the compiler
refuses:

```csharp
interface IShape { string Name() => "shape"; }
interface IRounded : IShape { string IShape.Name() => "rounded"; }
interface IFramed : IShape { string IShape.Name() => "framed"; }

class Square : IRounded, IFramed { }
// error CS8705: Interface member 'IShape.Name()' does not have a most specific implementation.
// Neither 'IRounded.IShape.Name()', nor 'IFramed.IShape.Name()' are most specific.
```

The fix is to implement the member in the class, which is always the most
specific. Unlike multiple class inheritance in C++, there is no state that
could be duplicated, only an ambiguity in which body to run, and C# turns that
into a compile error instead of a rule you must memorize.

### `static abstract` and `static virtual` members (C# 11)

An interface can require a static member. The implementing type provides it,
and generic code calls it through the type parameter:

```csharp
using System.Globalization;

Console.WriteLine(ParseAll<Celsius>(["21", "30"]).Sum(c => c.Value)); // 51
Console.WriteLine(Describe<Celsius>());                              // unit=C

static List<T> ParseAll<T>(string[] raw) where T : IParseableUnit<T>
    => raw.Select(T.Parse).ToList();
static string Describe<T>() where T : IParseableUnit<T> => $"unit={T.Unit}";

interface IParseableUnit<TSelf> where TSelf : IParseableUnit<TSelf>
{
    static abstract TSelf Parse(string text);
    static virtual string Unit => "?";   // has a default
}
readonly record struct Celsius(double Value) : IParseableUnit<Celsius>
{
    public static Celsius Parse(string text) => new(double.Parse(text, CultureInfo.InvariantCulture));
    public static string Unit => "C";
}
```

The `TSelf : IParseableUnit<TSelf>` constraint is the self-referencing pattern
the BCL uses everywhere (`IParsable<TSelf>`, `INumber<TSelf>`). The official
reference stresses that these calls have no runtime dispatch like instance
virtual methods: they resolve through the type the generic code was given, not
through an object's runtime type. This feature is what makes generic math
possible; that topic gets its own concept.

### `IComparable<T>`, `IComparer<T>` and `IEquatable<T>`

`IComparable<T>` gives a type its natural order. `IComparer<T>` is an order
defined outside the type, so one type can be sorted in many ways.
`IEquatable<T>` gives a strongly typed `Equals`:

```csharp
SemVer[] versions = [new(2, 0), new(1, 10), new(1, 2)];
Array.Sort(versions);                                          // 1.2, 1.10, 2.0
Array.Sort(versions, Comparer<SemVer>.Create((a, b) => a.Minor.CompareTo(b.Minor)));
                                                               // 2.0, 1.2, 1.10
var set = new HashSet<SemVer> { new(1, 2), new(1, 2) };       // Count: 1

readonly struct SemVer(int major, int minor) : IComparable<SemVer>, IEquatable<SemVer>
{
    public int Major => major;
    public int Minor => minor;
    public int CompareTo(SemVer other) =>
        Major != other.Major ? Major.CompareTo(other.Major) : Minor.CompareTo(other.Minor);
    public bool Equals(SemVer other) => Major == other.Major && Minor == other.Minor;
    public override bool Equals(object? obj) => obj is SemVer v && Equals(v);
    public override int GetHashCode() => HashCode.Combine(Major, Minor);
    public override string ToString() => $"{Major}.{Minor}";
}
```

`EqualityComparer<T>.Default`, used by `HashSet<T>` and `Dictionary<TKey,TValue>`,
checks whether `T` implements `IEquatable<T>` and uses it when it does (for this
struct it returned a `GenericEqualityComparer<SemVer>`); otherwise it falls
back to `object.Equals`. Implementing `IEquatable<T>` therefore obliges you to
override `Equals(object)` and `GetHashCode` consistently, or different
collections will disagree.

## Trade-offs

- **Explicit implementation hides members from your own users.** It is right for
  name clashes and legacy members, but a member people need should not require
  a cast to find.
  ```csharp
  ((IConnection)file).Close(); // fine for a rare clash, annoying for a daily call
  ```
- **Default methods version interfaces, they do not replace base classes.** No
  state, no constructors, and callers must hold the interface type to see the
  default. Keep defaults small and written in terms of the abstract members.
- **Adding a default body can still change behavior.** An existing class that
  happened to have a public method with the same signature silently becomes the
  implementation.
  ```csharp
  class Old : ILogger
  {
      public void Write(string level, string message) { }
      public void Info(string message) { } // older, unrelated method: now it is ILogger.Info
  }
  ```
- **`static abstract` limits how the interface is used.** It is a constraint for
  generic code, not a polymorphic type you pass around, and it pulls in the
  self-referencing generic pattern that is harder to read.
- **`IComparable<T>` fixes one order for everybody.** If there is no obvious
  natural order, do not implement it; pass an `IComparer<T>` where you sort.
- **`Array.Sort` is not stable.** The documentation says elements that compare
  equal may come out in any order, which matters as soon as a custom comparer
  looks at only part of the value. Use `OrderBy` (stable) when the original
  order of ties matters.
  ```csharp
  var sorted = versions.OrderBy(v => v.Minor).ToArray(); // ties keep their input order
  ```

## Lab

In this lab you get types that implement common interfaces but with the bodies **missing** (they throw `NotImplementedException`), plus ready xUnit tests. Your job is to fill them in. The core idea is to master what interfaces allow: implementing the comparison interfaces, resolving two interfaces that declare the same member, writing an interface method with a default body and hiding a member behind an explicit implementation. Several tests use reflection to confirm that a member is **not** public on the class, something you cannot prove by calling it.

**The scenario**

Two files in `src/InterfacesLab`.

- `Person.cs`: `Person(name, age)` declares `IComparable<Person>` and `IEquatable<Person>`, and `PersonByNameComparer` is an alternative ordering.
- `Members.cs`: the interfaces `IDrawable` and `IWeapon`, both with `Draw()`, and the `Cowboy` class that implements both. Also `ILogger` (with `Log` and `Info`), `ListLogger` and `Playlist`, which implements `IEnumerable<string>`.

Notice the shape tests: `typeof(Cowboy).GetMethod("Draw")` must be `null`, `ListLogger` must not have `Info`, and `Playlist` must have a single public `GetEnumerator`, the generic one.

**What you will do, step by step**

1. **Natural order (TODO-00).** In `Person.CompareTo`, order by `Age` and then by `Name` with `string.CompareOrdinal`. Any instance sorts after `null`.
2. **Alternative order (TODO-01).** In `PersonByNameComparer`, compare by `Name` ignoring case. `null` sorts first, and two `null` values are equal.
3. **Two explicit implementations (TODO-02).** In `Cowboy`, replace the public `Draw` with `IDrawable.Draw` (returning `"draws a picture"`) and `IWeapon.Draw` (returning `"draws a gun"`). The class must not keep a public `Draw`.
4. **Consistent equality (TODO-03).** In `Person.Equals(Person?)`, two people are equal when the age matches and the name matches ignoring case. Also override `Equals(object?)` and `GetHashCode` under the same rule, so equal people have the same hash and fit in a `HashSet<Person>` without duplicating.
5. **Default interface method (TODO-04).** In `ILogger.Info`, write a body that calls `Log` with `"INFO: "` followed by the message, so implementers only have to write `Log`. Note that `ListLogger` does not inherit `Info` as a class member: you only reach it through the interface.
6. **Explicit non-generic enumerator (TODO-05).** In `Playlist`, make `IEnumerable.GetEnumerator` forward to the generic `GetEnumerator`. Being explicit, it stays off the public surface.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why calling `Draw` requires a cast to the interface, and why `Equals` and `GetHashCode` must agree.

**Optional challenges**

These two have no stub or test, so you write both.

- **TODO-06:** add `IUnit` with `static abstract string Symbol { get; }`, two structs that implement it and `Units.Describe<T>(double)` that returns, for example, `"5 m"`.
- **TODO-07:** add `ILeft` and `IRight`, both with a default `Name`, and a class `Both` that implements both and resolves the conflict with explicit implementations.

**Prerequisites:** C# interfaces and classes, sorting and equality in .NET (`List<T>.Sort`, `HashSet<T>`) and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The missing parts throw `NotImplementedException` and carry `TODO-NN` comments, so red tests are your checklist.

## Documentation Links

- [interface keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) (doc)
- [Explicit interface implementation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/interfaces/explicit-interface-implementation) (doc)
- [Tutorial: Update interfaces with default interface methods, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/default-interface-methods-versions) (doc)
- [Tutorial: Explore static virtual members in interfaces, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/static-virtual-interface-members) (doc)
- [Interface design, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/interface) (doc)
- [EqualityComparer<T>.Default, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.equalitycomparer-1.default) (doc)
- [IComparable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icomparable-1) (doc)
- [IComparer<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.icomparer-1) (doc)
- [IEquatable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iequatable-1) (doc)
