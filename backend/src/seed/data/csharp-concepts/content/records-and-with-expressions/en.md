---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A record is a class or struct for which the compiler writes the boring parts:
properties from a positional parameter list, value-based equality, a readable
`ToString`, deconstruction, and support for `with` expressions. The convenience
is real, but every one of those features is ordinary generated code with
specific rules, and the surprises (a `with` copy that shares a list, two records
that are not equal after a JSON round trip, a cached property that goes stale)
all come from not knowing what was generated. This concept reads the IL of a
record to list exactly what the compiler adds, compares `record class`,
`record struct`, and `readonly record struct`, shows that `with` is a shallow
copy, and covers inheritance and where records fit (DTOs, JSON) and where they
do not (EF Core entities).

## Use Cases

- DTOs and API contracts: request and response shapes that are pure data.
- Value objects in a domain model, such as `Money(decimal Amount, string Currency)`.
- Messages and events passed between components, compared and logged by value.
- Small composite keys for dictionaries, as a `readonly record struct`.
- Producing a modified copy of configuration or state without mutating the original.

## Deep Dive

### What the compiler generates for a record class

Take one line:

```csharp
public record Person(string Name, int Age, List<string> Tags);
```

Listing the declared members with reflection, and reading the IL with
`ilspycmd -il`, shows everything that line produced:

```text
Constructor  public             .ctor(String, Int32, List`1)     primary constructor
Constructor  protected          .ctor(Person)                     copy constructor
Method       public virtual     Person <Clone>$()                 used by 'with'
Property                        Type EqualityContract             (protected virtual getter)
Method       public virtual     Boolean Equals(Object)
Method       public virtual     Boolean Equals(Person)            IEquatable<Person>
Method       public virtual     Int32 GetHashCode()
Method       public static      Boolean op_Equality / op_Inequality
Method       protected virtual  Boolean PrintMembers(StringBuilder)
Method       public virtual     String ToString()
Method       public             Void Deconstruct(out String, out Int32, out List`1)
Properties   Name, Age, Tags with get and init (setter has modreq IsExternalInit)
Fields       <Name>k__BackingField ... all 'initonly'
```

The interesting bodies, simplified from the IL:

- **`EqualityContract`** returns `typeof(Person)` (`ldtoken Person`). It exists
  so equality can compare runtime types in a hierarchy.
- **`Equals(Person other)`** returns true for the same reference, false for
  `null`, then compares `EqualityContract`, then each backing field with
  `EqualityComparer<T>.Default.Equals`. **Fields, not properties**, and with the
  default comparer of each field's type.
- **`GetHashCode`** combines `EqualityContract` and every field's hash with a
  multiply by `-1521134295` and add.
- **`ToString`** writes the type name and `" { "`, calls `PrintMembers`, and
  closes with `}`. `PrintMembers` appends `Name = value` for each public field
  and property, and starts with `RuntimeHelpers.EnsureSufficientExecutionStack()`
  so a cyclic graph fails with `InsufficientExecutionStackException` instead of
  crashing the process.
- **`<Clone>$`** is `newobj Person::.ctor(Person)`, and the copy constructor
  copies each field with `ldfld`/`stfld`. That is the definition of a shallow copy.

You cannot override the clone method or declare a member named `Clone`
(CS8859). You can write the copy constructor, `Equals(Person)`, `GetHashCode`,
`PrintMembers`, or `ToString` yourself, and the compiler then skips its version.

### with expressions and shallow copies

A `with` expression compiles to "clone, then call the init setters on the
clone":

```text
IL_003a: ldloc.0
IL_003b: callvirt instance class Person Person::'<Clone>$'()
IL_0040: dup
IL_0041: ldc.i4.s 31
IL_0043: callvirt instance void modreq(IsExternalInit) Person::set_Age(int32)
```

Because the copy is field by field, reference-type members are shared:

```csharp
var a = new Person("Ana", 30, ["admin"]);
var b = a with { Age = 31 };
b.Tags.Add("billing");

ReferenceEquals(a.Tags, b.Tags);        // True: both now contain "billing"
a == (a with { });                      // True
ReferenceEquals(a, a with { });         // False: always a new instance
```

When a deep copy matters, write the copy constructor; `with` will use it:

```csharp
public record Order(string Id, List<string> Lines)
{
    protected Order(Order original)
    {
        Id = original.Id;
        Lines = [.. original.Lines];
    }
}
// order with { Id = "A-2" }, then copy.Lines.Add("y"):
// order lines=1, copy lines=2
```

Since C# 10, `with` also works on any struct and on anonymous types; for those
there is no clone method, the value is simply copied and the setters run.

### The cached computed property trap

`with` copies fields and then runs only the setters you name. Anything computed
in an initializer is copied from the original, not recomputed:

```csharp
public record Circle(double Radius)
{
    public double AreaCached { get; } = Math.PI * Radius * Radius;  // computed once
    public double Area => Math.PI * Radius * Radius;                // computed on read
}
var c2 = new Circle(1) with { Radius = 10 };
// c2.Radius=10, c2.AreaCached=3.14 (stale), c2.Area=314.16
```

Compute derived values on access, or use a class.

### record class, record struct, readonly record struct

| | `record` / `record class` | `record struct` | `readonly record struct` |
|---|---|---|---|
| Kind | reference type | value type | value type |
| Positional properties | `get; init;` | `get; set;` | `get; init;` |
| `EqualityContract` | yes | no | no |
| `with` | `<Clone>$` + setters | copy + setters | copy + setters |
| Inheritance | records only | none | none |

The mutable default of `record struct` surprises people:

```csharp
public record struct MutablePoint(int X, int Y);
var p = new MutablePoint(1, 2);
var q = p with { X = 10 };
p.Y = 99;
// p = MutablePoint { X = 1, Y = 99 }, q = MutablePoint { X = 10, Y = 2 }
```

Prefer `readonly record struct` for small values and dictionary keys. Its
equality is generated per field, which avoids the slow reflection path of
`ValueType.Equals` on ordinary structs. Keys, hashing, and why a record with a
`List<T>` makes a poor key are covered in Dictionary, HashSet, and Equality.

### Inheritance

A record can inherit only from another record (`record FromClass : Base` is
CS8864) and a class cannot inherit from a record (CS8865). Equality uses the
runtime type through `EqualityContract`, so different subtypes with the same
data are not equal, and `with` keeps the runtime type even through a base-typed
variable:

```csharp
public abstract record Person2(string Name);
public record Teacher(string Name, int Grade) : Person2(Name);
public record Student(string Name, int Grade) : Person2(Name);

Person2 t = new Teacher("Nancy", 3);
Person2 s = new Student("Nancy", 3);
t == s;                         // False
Person2 t2 = t with { Name = "Bob" };
// t2 is Teacher: Teacher { Name = Bob, Grade = 3 }
```

Through a `Person2` variable you can set only `Person2` properties in `with`,
but the derived ones are still copied.

### Records as DTOs and with JSON

System.Text.Json binds positional records through the primary constructor, so a
record round-trips without a parameterless constructor:

```csharp
var json = JsonSerializer.Serialize(a);
// {"Name":"Ana","Age":30,"Tags":["admin","billing"]}
var back = JsonSerializer.Deserialize<Person>(json)!;
back == a;   // False
```

The `False` is the shallow equality again: `Tags` is a new `List<string>`, and
`List<T>` compares by reference. A DTO that must compare equal after
deserialization needs value-comparable members (strings, numbers, nested
records) or a custom `Equals`. The API side of this is covered in DTOs and the
API Contract.

EF Core is the opposite case. The official records documentation states that
records are not appropriate as entity types, because EF Core relies on
reference identity to track one instance per entity, and immutable entities
cannot be updated the usual way. Use classes for entities and records for what
crosses the boundary.

## Trade-offs

- **Value equality is shallow.** Collections inside a record compare by
  reference, so equal-looking records can be unequal:
  ```csharp
  new Person("A", 1, ["x"]) == new Person("A", 1, ["x"]);   // False
  ```
  Use immutable collections with value semantics you control, or override
  `Equals`.
- **`with` is cheap to write and easy to misuse.** It shares mutable state and
  copies stale cached values. Keep records' members immutable and derived values
  computed on access.
- **`init` is not deep immutability.** A record of `List<T>` is still mutable
  through the list.
- **Generated members are public API.** Adding a positional parameter changes
  the constructor, `Deconstruct`, `ToString` output, and equality, which can
  break callers and log parsers.
- **Record class equality checks the runtime type first.** Every `Equals` reads
  `EqualityContract` on both sides (the IL uses `callvirt`), and in a hierarchy
  two subtypes with identical data are never equal. Seal records that are not
  meant to be extended so no one adds a subtype that changes equality.
- **Not for entities.** EF Core tracking needs reference identity; records fit
  DTOs, messages, and value objects better.

## Documentation Links

- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Create record types, tutorial, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/records) (doc)
- [with expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/with-expression) (doc)
- [The history of C# (records in C# 9, record structs and with on structs in C# 10), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [Use immutable types and properties with System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/immutability) (doc)
