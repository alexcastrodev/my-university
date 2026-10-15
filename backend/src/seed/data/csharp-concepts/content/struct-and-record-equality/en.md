---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

"Are these two equal?" has a different default answer for each kind of C# type.
A class compares references, a plain struct compares fields through reflection
but has no `==`, a record compares fields and has `==`, a tuple compares
element by element, and an array compares references even when its contents
match. This concept puts those defaults side by side, shows where each one goes
wrong (a struct hash that ignores fields, a record with a list that is never
equal, a class hierarchy that breaks symmetry), and how to implement value
equality correctly when the default is not enough. The general
`Equals`/`GetHashCode` contract and the mutable key bug are in Dictionary,
HashSet, and Equality; what a record generates is in Records and with
Expressions.

## Use Cases

- Value objects (`Money`, `DateRange`, `Coordinate`) that must compare by
  content and work as dictionary keys.
- Small structs used in hot paths or as keys, where boxing equality is a cost.
- Records holding collections, such as an order with lines or a DTO with tags,
  that should compare by contents.
- Comparing arrays, tuples, and composite keys in tests and caches.

## Deep Dive

### The defaults, measured

| Kind | `a == b` | `a.Equals(b)` | Hash |
|---|---|---|---|
| class | reference | reference | per object |
| plain struct | CS0019, no operator | field by field via `ValueType.Equals` | `ValueType.GetHashCode`, weak |
| `record` / `record struct` | field by field | field by field | combines all fields |
| tuple | element by element | element by element | combines all elements |
| array | reference | reference | per object |

```csharp
int[] a = [1, 2, 3]; int[] b = [1, 2, 3];
a == b;                                                    // False
a.SequenceEqual(b);                                        // True
StructuralComparisons.StructuralEqualityComparer.Equals(a, b); // True, hashes match too

var t1 = (Id: 1, Name: "a"); var t2 = (Key: 1, Label: "a");
t1 == t2;                       // True: names are ignored, positions matter
(1, 2L) == (1L, 2);             // True: elements convert like in ordinary ==
(1, new List<int> { 1 }) == (1, new List<int> { 1 });   // False: List compares references
```

Tuple `==` (C# 7.3) evaluates every element on both sides first, then compares
pairs in order and stops at the first mismatch. Members are compared with their
own equality, which is why a tuple, record, or struct holding a `List<T>` or an
array is never equal to a copy.

### Plain structs: correct, slow, and a weak hash

A struct without overrides gets `ValueType.Equals`, which calls `Equals` on each
field, so even string fields compare by content:

```csharp
struct Name(string first, int n) { public string First = first; public int N = n; }

new Name("ana", 1).Equals(new Name(string.Concat("an", "a"), 1));  // True
new Name("x", 1).GetHashCode() == new Name("x", 2).GetHashCode();   // True: N was ignored
```

The second line is the trap. The documentation of `ValueType.GetHashCode` says
only that "one or more fields" are used and that the result is "not likely to
be suitable for use as a key in a hash table". In this run, a struct with a
reference field hashed on the string alone, so every key with the same `First`
lands in the same bucket. Floating-point fields are fine on .NET 10:
`0.0` and `-0.0` compared equal and `NaN` equaled `NaN`, the same as
`double.Equals`.

The other costs: `a == b` does not compile until you declare the operator, and
`EqualityComparer<Pair>.Default` turned out to be an `ObjectEqualityComparer`,
which goes through `Equals(object)` and boxes (Value Types, Reference Types and
Boxing measured 48 bytes per `Equals` call on such a struct). A struct that
implements `IEquatable<T>` gets the `GenericEqualityComparer` instead.

### Implementing equality on a struct

When a struct cannot be a `record struct`, implement the full set:

```csharp
readonly struct Money(decimal amount, string currency) : IEquatable<Money>
{
    public decimal Amount { get; } = amount;
    public string Currency { get; } = currency;

    public bool Equals(Money other) => Amount == other.Amount && Currency == other.Currency;
    public override bool Equals(object? obj) => obj is Money m && Equals(m);
    public override int GetHashCode() => HashCode.Combine(Amount, Currency);
    public static bool operator ==(Money l, Money r) => l.Equals(r);
    public static bool operator !=(Money l, Money r) => !l.Equals(r);
}

new Money(10m, "EUR") == new Money(10.00m, "EUR");   // True, and the hashes match
```

`HashCode.Combine` mixes up to eight values; for more, or for a sequence, use a
`HashCode` instance with `Add` and `ToHashCode`. Equal values must produce equal
hashes, and the hash must use the same notion of equality as `Equals`: here
`decimal` treats `10m` and `10.00m` as equal and hashes them alike, even though
they print differently (`10` and `10.00`). If you compared strings
case-insensitively in `Equals`, the hash would need the same comparer
(`hash.Add(name, StringComparer.OrdinalIgnoreCase)`). `HashCode` uses a random
seed per process, so its results must never be persisted or sent elsewhere.

A `readonly record struct Money(decimal Amount, string Currency)` generates all
of the above in one line, which is why the documentation recommends records
whenever the type can be one.

### Customizing record equality

Record equality uses each member's own `Equals`, so a collection member breaks
it. Replace the generated `Equals(T)` and `GetHashCode`; the generated `==`,
`!=`, and `Equals(object)` call yours:

```csharp
sealed record Order(string Id, IReadOnlyList<string> Lines)
{
    public bool Equals(Order? other) =>
        other is not null && Id == other.Id && Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var h = new HashCode();
        h.Add(Id);
        foreach (var l in Lines) h.Add(l);
        return h.ToHashCode();
    }
}

new Order("A", ["x", "y"]) == new Order("A", ["x", "y"]);   // True
new HashSet<Order> { o1 }.Contains(o2);                      // True
// record PlainOrder(string Id, List<string> Lines): the same comparison is False
```

The compiler guards the shape:

- In a record that is not sealed, `Equals(T)` must be `virtual`: CS8872
  ("must allow overriding because the containing record is not sealed").
- `Equals` without `GetHashCode` is warning CS8851.
- Declaring `==` or `!=` yourself is CS0111: the record already defines
  `op_Equality`.

Sealing the record is the simplest choice. For an unsealed record, equality
already checks `EqualityContract`, so a derived record never equals its base.

### Class hierarchies

A class that is not a record and is not sealed needs two things to keep
`Equals` symmetric: a `virtual` typed `Equals`, and a runtime type check.

```csharp
class Shape(string color) : IEquatable<Shape>
{
    public string Color { get; } = color;
    public override bool Equals(object? obj) => Equals(obj as Shape);
    public virtual bool Equals(Shape? other) =>
        other is not null && GetType() == other.GetType() && Color == other.Color;
    public override int GetHashCode() => HashCode.Combine(GetType(), Color);
}
class Circle(string color, double r) : Shape(color)
{
    public double R { get; } = r;
    public override bool Equals(Shape? other) => other is Circle c && base.Equals(c) && R == c.R;
    public override int GetHashCode() => HashCode.Combine(GetType(), Color, R);
}

Shape c = new Circle("red", 5); Shape s = new Shape("red");
c.Equals(s); s.Equals(c);    // False False: symmetric
```

Without the `GetType()` check, `s.Equals(c)` would compare only colors and
return true while `c.Equals(s)` returns false. This is what a record's
`EqualityContract` does for you; for a non-record class, sealing it removes the
problem entirely.

### Choosing the comparison at the call site

Equality is also something the caller can choose without changing the type:

- `ReferenceEquals(x, y)` for identity; it is always `false` for value types,
  because each argument is boxed separately.
- `a.SequenceEqual(b)` and `StructuralComparisons.StructuralEqualityComparer`
  for arrays and lists.
- An `IEqualityComparer<T>` passed to a dictionary, a set, or LINQ, when one
  type needs different equalities in different places (covered in Dictionary,
  HashSet, and Equality).

## Trade-offs

- **Records give correct equality for free, but shallow.** Collection members
  compare by reference until you override `Equals(T)` and `GetHashCode`.
- **Plain struct equality works but is not a key.** It boxes through
  `ObjectEqualityComparer` and its hash can ignore fields:
  ```csharp
  new Name("x", 1).GetHashCode() == new Name("x", 2).GetHashCode();   // True
  ```
  Use a `record struct` or implement `IEquatable<T>` for anything hashed.
- **Hand-written equality has five members to keep in sync.** `Equals(T)`,
  `Equals(object)`, `GetHashCode`, `==`, and `!=`. Missing one compiles, with at
  most a warning.
- **Value equality on mutable types is fragile.** If fields change after the
  object is in a set or used as a key, lookups fail; keep equality-defining
  members immutable.
- **Unsealed hierarchies cost symmetry.** Without a runtime type check, base
  and derived instances compare differently depending on which side calls.
  Prefer sealed types or records.
- **Structural comparison of collections is O(n).** `SequenceEqual` in
  `Equals` and a loop in `GetHashCode` make every dictionary lookup proportional
  to the collection size; cache the hash for large immutable collections.

## Documentation Links

- [C# equality comparisons, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/expressions/equality) (doc)
- [Equality operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/equality-operators) (doc)
- [ValueType.GetHashCode method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.gethashcode) (doc)
- [Tuple types: tuple equality, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples#tuple-equality) (doc)
- [HashCode struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.hashcode) (doc)
