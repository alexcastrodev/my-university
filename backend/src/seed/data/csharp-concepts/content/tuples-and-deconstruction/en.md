---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A tuple is the cheapest way to return two or three values from a method:
`(int Min, int Max) MinMax(...)`. Behind the syntax is `System.ValueTuple`, a
mutable struct whose element names exist only in the compiler, which has
consequences for reflection, JSON, equality and dictionary keys. Deconstruction
is the other half: `var (min, max) = MinMax(...)` works on tuples and on any
type with a `Deconstruct` method. This concept shows what a tuple is at run
time, where the names go, how equality really works, the deconstruction forms,
the legacy `System.Tuple`, and the line where a record is the better choice.
Positional patterns, which also call `Deconstruct`, are in
`property-positional-and-list-patterns`.

## Use Cases

- Returning several values from a private or internal method without an
  `out` parameter or a one-off class.
- Composite dictionary keys such as `(string City, int Year)`.
- Swapping two variables, or splitting a `KeyValuePair` in a `foreach`.
- Making your own types deconstructible, including types you do not own.
- Deciding when a tuple in a signature should become a record.

## Deep Dive

Output is from .NET 10 (SDK 10.0.100) on arm64.

### What a tuple is at run time

```csharp
(string Name, int Age) p = ("Ana", 30);

p.GetType()             // System.ValueTuple`2[System.String,System.Int32]
p.GetType().IsValueType // True
p.Name == p.Item1       // True: Name is a compile-time alias for Item1
p.ToString()            // (Ana, 30)
typeof((string, int)).GetFields()      // Item1, Item2
typeof((string, int)).GetProperties()  // (none)
```

The documentation spells it out: tuple types are value types and the elements
are public fields, so tuples are mutable value types. `t.X = 10` compiles and
changes the local, and copying a tuple copies its values:

```csharp
var s1 = (A: 1, B: 2);
var s2 = s1;
s2.A = 99;            // s1 = (1, 2), s2 = (99, 2)
```

Mutation through an indexer fails for the same reason as with any struct: a
`List<T>` indexer returns a copy, so `list[0].X = 5` gives CS1612 ("Cannot
modify the return value of 'List<(int X, int Y)>.this[int]' because it is not a
variable"). An array element is a variable, so `arr[0].X = 5` works.

Above seven elements the compiler nests: `(1, 2, 3, 4, 5, 6, 7, 8, 9)` is a
`ValueTuple`8` whose last field `Rest` holds a `ValueTuple`2`. `big.Item9`
still reads as `9`: the IL is `ldfld Rest` followed by `ldfld Item2`.

`ValueTuple` is declared with `LayoutKind.Auto` (read via reflection:
`typeof(ValueTuple<,>).StructLayoutAttribute.Value` is `Auto`), so the runtime
may reorder fields: `Unsafe.SizeOf<(byte, long)>()` is 16 and
`Unsafe.SizeOf<(int, int)>()` is 8. Do not use a tuple where a fixed memory
layout matters (interop, `MemoryMarshal` casts).

### Where the names go

Element names are a compiler feature. The documentation says the compiler
replaces them with the default names, so they are not available at run time.
For a method signature, the names survive only as an attribute the compiler
reads back when another project calls the method:

```csharp
static (int Min, int Max) MinMax(int[] values) => (values.Min(), values.Max());

var m = typeof(Api).GetMethod("MinMax")!;
m.ReturnType                                   // System.ValueTuple`2[System.Int32,System.Int32]
m.ReturnParameter.GetCustomAttribute<TupleElementNamesAttribute>()!.TransformNames
                                               // Min, Max
```

Anything that works by reflection sees `Item1` and `Item2`. System.Text.Json
serializes public properties by default and a tuple has none:

```csharp
JsonSerializer.Serialize(MinMax([3, 1, 4]))                                       // {}
JsonSerializer.Serialize(MinMax([3, 1, 4]), new JsonSerializerOptions { IncludeFields = true })
                                                                                  // {"Item1":1,"Item2":4}
```

Neither output is what an API client expects (`{"min":1,"max":4}`), which is
the strongest reason never to return a tuple from an HTTP endpoint.

Names can also be inferred from the variables that build the tuple (C# 7.1):
`var t = (name, age);` gives `t.name` and `t.age`. Assigning a tuple literal
with names that disagree with the target is legal and the names are dropped,
with a warning:

```csharp
(int A, int B) t = (B: 1, A: 2);
// warning CS8123: The tuple element name 'B' is ignored because a different name
// or no name is specified by the target type '(int A, int B)'.
// t.A = 1, t.B = 2   (position wins, not the name)
```

Since C# 12, a `using` alias can name a tuple type:
`using Point = (int X, int Y);`. The documentation is explicit that an alias
creates a synonym, not a new type: `Point` is still
`ValueTuple<int, int>`, and any `(int, int)` converts to it. For type safety,
the same page recommends a positional record.

### Equality: `==` versus `Equals`

`==` and `!=` on tuples (C# 7.3) are compiled element by element, by
position, ignoring names, and with the usual conversions per element.
`Equals` is the `ValueTuple` method, which requires the same tuple type:

```csharp
(int, string) a = (1, "x");
(long, string) b = (1L, "x");
a == b                      // True: 1 == 1L after conversion
a.Equals(b)                 // False: ValueTuple<int,string> vs ValueTuple<long,string>

var t1 = (A: 5, B: 10);
var t2 = (B: 5, A: 10);
t1 == t2                    // True: names are ignored, positions compared
```

The documentation adds that every element of both sides is evaluated before
the comparison, which then short-circuits on the first difference.

`Equals` and `GetHashCode` combine the elements with
`EqualityComparer<T>.Default`, so a tuple is a correct composite key without
writing a type:

```csharp
var visits = new Dictionary<(string City, int Year), int> { [("Lisbon", 2026)] = 7 };
visits[("Lisbon", 2026)]    // 7
```

Each element must itself have value equality for this to hold. A tuple that
contains a `List<T>` compares the list by reference:
`(1, list).Equals((1, new List<int> { 1 }))` is `False` even with the same
contents (`dictionary-hashset-and-equality` covers the rules).

### Deconstruction

```csharp
var (lo, hi) = MinMax([5, 2, 9]);      // lo = 2, hi = 9
(x, y) = (y, x);                        // swap without a temporary
(existing, var fresh) = (7, 8);         // C# 10: assign and declare in one deconstruction
var (_, onlyHi) = MinMax([1, 2]);       // discard what you do not need

foreach (var (k, v) in dictionary)      // KeyValuePair has a Deconstruct method
    Console.WriteLine($"{k}={v}");
```

Any type becomes deconstructible with a `void Deconstruct` method that
returns each component through an `out` parameter. Overloads must differ in
the number of `out` parameters, or the call is ambiguous. It can be an
instance method, or an extension method for types you cannot change:

```csharp
class Person(string first, string last)
{
    public void Deconstruct(out string First, out string Last) { First = first; Last = last; }
}

static class UriExt
{
    public static void Deconstruct(this Uri u, out string host, out int port) { host = u.Host; port = u.Port; }
}

var (first, last) = new Person("Ada", "Lovelace");          // Ada Lovelace
var (host, port) = new Uri("https://example.com:8443/x");   // example.com 8443
```

Positional records generate `Deconstruct` from their primary constructor
(`records-and-with-expressions` shows the generated member), so
`var (name, age) = new Rec("Cy", 40);` works with no code.

### `System.Tuple`, the legacy one

`Tuple.Create("Ana", 30)` builds a `System.Tuple<string, int>`, which is a
class, immutable, with `Item1`/`Item2` properties instead of fields. It
predates the tuple syntax, has no element names and allocates on every
creation. It still appears in older APIs; `ToValueTuple()` converts it, and new
code has no reason to create one.

## Trade-offs

- **Tuple versus record for return values.** A tuple costs nothing to
  declare and nothing to allocate. A record has a name, survives reflection
  and JSON, and can hold validation and behavior. The documentation's advice
  fits: tuples for loosely related data, a class or struct (a record) in
  public APIs.
- **Tuple versus `out` parameters.** A tuple return composes with `var`
  and deconstruction and works in `async` methods, where `out` is not allowed
  (CS1988).
  `TryX(out T)` stays better when the method answers a yes/no question first
  (`method-parameters-optional-named-and-ref-kinds` compares them).
- **Composite key as a tuple or as a type.** `(string, int)` is a correct
  dictionary key immediately. A `readonly record struct` gives the same
  equality plus a name the rest of the code can search for, which matters once
  the key is used in more than one class.
- **Names give a false sense of safety.** `(int Min, int Max)` and
  `(int Width, int Height)` are the same type and convert silently in either
  direction. If mixing them up would be a bug, the data deserves its own
  type.
- **Mutable fields.** Changing `t.X` is convenient in a local, but a tuple
  in a `readonly` field (CS1648) or behind a `List<T>` indexer (CS1612)
  cannot be changed in place. Treat tuples as values and assign a new one.

## Documentation Links

- [Tuple types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples) (doc)
- [Deconstructing tuples and other types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/deconstruct) (doc)
- [Choosing between anonymous and tuple types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/choosing-between-anonymous-and-tuple) (doc)
- [TupleElementNamesAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.tupleelementnamesattribute) (doc)
- [ValueTuple struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetuple) (doc)
- [The history of C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
