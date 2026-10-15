---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A property looks like a field at the call site and runs like a pair of methods
underneath. For years that left a gap: an auto-property (`{ get; set; }`) gives
you no place for logic, and the moment you need one line of validation you have
to declare a private field, name it, and write both accessors by hand. C# 14
closes that gap with the `field` contextual keyword, which lets an accessor body
reach the compiler-generated backing field directly. This concept explains what
the compiler generates for a property, how `init` accessors restrict writes, and
the exact rules of `field`: where it is a keyword, what happens to existing
members named `field`, field-targeted attributes, nullable analysis, and partial
properties.

## Use Cases

- Adding validation or normalization to an existing auto-property without
  introducing a named backing field that the rest of the class can bypass.
- Lazily computing an expensive value once, in a single expression.
- View models that raise change notifications only when a value actually changes.
- Immutable-after-construction objects built with object initializers (`init`).
- Upgrading an older code base to C# 14 when it already has a member called `field`.

## Deep Dive

### What a property compiles to

A property `Email` becomes two methods, `get_Email` and `set_Email` (or an
`init` variant), plus metadata that ties them together. An auto-property also
gets a private field named `<Email>k__BackingField`. The angle brackets are not
legal in C#, which is how the compiler guarantees that no source code can touch
the field by name. Reflection shows it:

```csharp
class User
{
    [field: Display(Name = "backing")]
    public string Email { get; init => field = value.Trim().ToLowerInvariant(); } = "";
}

foreach (var f in typeof(User).GetFields(BindingFlags.Instance | BindingFlags.NonPublic))
    Console.WriteLine($"{f.Name} initonly={f.IsInitOnly} attrs=...");
// <Email>k__BackingField initonly=True attrs=CompilerGeneratedAttribute,DebuggerBrowsableAttribute,DisplayAttribute
```

The `field` keyword does not change this shape: a property that uses `field` gets
the same kind of hidden backing field as an auto-property. Only the accessor
bodies differ.

### init accessors

An `init` accessor (C# 9) is a setter that may run only during object
construction: in an object initializer, in a `with` expression, in a constructor
of the type through `this` or `base`, or inside another `init` accessor. Anywhere
else the compiler stops you:

```csharp
var p = new Point { X = 1, Y = 2 };   // ok
p.X = 9;
// error CS8852: Init-only property or indexer 'Point.X' can only be assigned in an
// object initializer, or on 'this' or 'base' in an instance constructor or an 'init' accessor.
```

The guarantee is a compile-time one. The `init` setter is an ordinary method
whose return type carries a required modifier, `IsExternalInit`, that older
compilers refuse to call. Reflection does not care:

```csharp
var setter = typeof(Point).GetProperty("X")!.SetMethod!;
setter.ReturnParameter.GetRequiredCustomModifiers();   // [IsExternalInit]
setter.Invoke(p, [9]);
Console.WriteLine(p.X);                                // 9
```

That is exactly how serializers populate `init` properties, so treat `init` as a
promise about your own code, not as a security boundary. When the property must
be set, combine `init` with `required` (see Fields, Constants and Initialization
Order). `init` is also why the generated field of `User` above is `initonly`.

### The field keyword (C# 14)

Inside a property accessor, `field` refers to the synthesized backing field. You
can mix an automatic accessor with a full one, write both, or use an expression
body:

```csharp
class Temperature
{
    public double Celsius
    {
        get;
        set => field = value >= -273.15
            ? value
            : throw new ArgumentOutOfRangeException(nameof(value), "below absolute zero");
    }
}

class Cache
{
    public string Report => field ??= Build();   // Build() runs once
}
```

Calling `cache.Report` twice printed the `Build()` trace once. Before C# 14 the
same code needed `private double _celsius;`, and every other method of the class
could write `_celsius = -500` and skip the check. With `field`, the storage is
reachable only from the accessors. The DDD concept in dotnet-concepts
(Aggregates, Entities, and Value Objects) uses this to keep aggregate state valid
on every change.

### Initializer versus constructor: which path runs the setter

A property initializer writes the backing field directly, without calling the
setter. Assigning the property in a constructor calls the setter. Both facts came
straight out of the experiment:

```csharp
class ViewModel
{
    public bool Pending { get; private set; }
    public bool IsActive
    {
        get;
        set { if (field == value) return; field = value; Pending = true; }
    } = true;
}
// after ctor: Pending=False, IsActive=True
// after set:  Pending=True,  IsActive=False

class CtorSet
{
    public CtorSet() { Name = "  set in ctor  "; }
    public string Name { get; set => field = value.Trim(); } = "  initializer  ";
}
// new CtorSet().Name == "set in ctor"   (setter ran, value trimmed)
```

The initializer is the way to give a default without triggering side effects; the
constructor is the way to force a default through validation.

### How field binds, and the upgrade break

`field` is a keyword only as a primary expression inside `get`, `set`, and `init`
accessor bodies of properties (including lambdas and local functions nested
there). It is an ordinary identifier everywhere else: in methods, in event
accessors, and in **indexers**, where `get => field` is error CS0103 because no
such name exists.

The break happens in code that already has a member called `field`. In C# 14 an
unqualified `field` inside an accessor now means the backing field, and the
compiler warns:

```csharp
class Legacy
{
    private int field = 100;
    public int Value { get => field; set => field = value; }
    public int Escaped => @field;      // the member
    public int This => this.field;     // the member
}
// warning CS9258: In language version 14.0, the 'field' keyword binds to a synthesized
// backing field for the property. To avoid generating a synthesized backing field, and
// to refer to the existing member, use 'this.field' or '@field' instead.
// After l.Value = 5: Value=5, member field=100
```

The program still compiles and silently uses a new field, so treat CS9258 as an
error during the upgrade. Declaring a local or a lambda parameter named `field`
inside an accessor is a hard error, CS9273; `@field` as the name compiles.
`nameof(field)` is error CS8081 (`Expression does not have a name`), because the
backing field has no source name. In parameter validation use `nameof(value)`.

### Field-targeted attributes

`[field: ...]` puts an attribute on the backing field instead of on the property.
It worked for auto-properties already and now works for any property that uses
`field`, as the `DisplayAttribute` in the reflection output shows. On a property
with no backing field (`public string NoBacking => "computed";`) the SDK 10
compiler does not fail: it reports warning CS0657 and **ignores the attribute**.
The feature specification says this is an error, so trust the compiler and keep
warnings visible.

### Nullable analysis

With nullable reference types on, the compiler decides whether the getter is
*null-resilient*, that is, still returns a non-null value when the field holds
`null`. A lazy getter is, so the field is treated as nullable and the constructor
is not required to assign it. A plain getter is not:

```csharp
public string Lazy => field ??= "computed";                  // no warning
public string Plain { get => field; set => field = value; }  // warning CS9264
public string Trimmed { get; set => field = value.Trim(); }  // warning CS9264
public string Empty { get; set { } }                         // CS8618, and CS9266 on the setter
```

CS9264 reads `Non-nullable property 'Plain' must contain a non-null value when
exiting constructor ... or safely handling the case where 'field' is null in the
'get' accessor`. CS9266 flags a setter that ignores `field` while the other
accessor uses it.

### Partial properties

A partial property (C# 13) can use `field` in its implementing declaration. The
initializer may sit on either part, but not both (CS9263), and the implementing
part cannot be all automatic accessors (CS9250); at least one accessor needs a
body:

```csharp
public partial class Widget
{
    public partial string Title { get; set; } = "  initial  ";
}
public partial class Widget
{
    public partial string Title { get; set => field = value.Trim(); }
}
// new Widget().Title == "  initial  "   (initializer skips the setter)
```

This is the shape source generators prefer: the user writes the declaration and
`[field: ...]` attributes, and the generator writes accessors over `field`.

## Trade-offs

- **`field` keeps storage private to the property.** The benefit is that no
  method can bypass validation. The cost is that the class itself cannot read the
  raw value without going through the getter, so a lazy getter always runs its
  logic.
- **Initializer and constructor behave differently.** Easy to forget in review:
  ```csharp
  public string Name { get; set => field = value.Trim(); } = " x ";  // stays " x "
  ```
- **The C# 14 upgrade can change meaning quietly.** A member named `field`
  keeps compiling with only CS9258. Rename the member or add
  `<WarningsAsErrors>CS9258</WarningsAsErrors>` during migration.
- **`init` is compile-time only.** It blocks your code, not reflection or
  deserializers, and it does not make the object deeply immutable: an `init`
  property of type `List<T>` can still be mutated.
- **Logic in accessors hides cost.** A property read looks free. Keep accessors
  cheap and side-effect free apart from validation and notification, and use a
  method when the work is I/O or can fail for reasons the caller cannot fix.
- **Indexers are excluded.** `field` does not exist in indexer accessors, so an
  indexer still needs an explicit field.

## Documentation Links

- [The field contextual keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) (doc)
- [field keyword feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/field-keyword) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Properties, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/properties) (doc)
- [init keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/init) (doc)
