---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Type, constant, and relational patterns test a single value. The recursive
patterns look inside it: a property pattern tests members, a positional pattern
deconstructs the value and tests each part, and a list pattern tests the
elements of a sequence, with a slice `..` for "any number of elements here".
Because each of them contains nested patterns, they combine into one expression
that describes the shape of data, from `{ Address.City: "Lisbon" }` to
`["move", var x, var y]`. This concept explains what each pattern requires from
the type, which methods the compiler calls (and how often), where slices
allocate, how exhaustiveness works with sequences, and two places where these
patterns earn their keep: command parsers and state machines.

## Use Cases

- Checking a nested condition such as "customer in Portugal with at least one
  order" without a chain of null checks.
- Dispatching on a pair of values, like the current state and an incoming
  trigger, with a tuple `switch`.
- Parsing tokenized input (`args`, `line.Split(' ')`) by shape: a verb, then a
  fixed or variable number of arguments.
- Matching the start and end of a string, array, or span while capturing the
  middle.

## Deep Dive

### Property patterns

A property pattern `{ Member: pattern, ... }` matches when the value is not
`null` and every listed property or field matches its nested pattern. Since
C# 10, the extended form `{ A.B: pattern }` reaches into nested members, and it
is null-safe at every step:

```csharp
record Address(string City, string Country);
record Customer(string Name, Address? Address, int Orders);

var withAddr = new Customer("Ana", new Address("Lisbon", "PT"), 3);
var noAddr   = new Customer("Bia", null, 0);

noAddr   is { Address.City: "Lisbon" };              // False, no NullReferenceException
withAddr is { Address.City: "Lisbon", Orders: > 0 }; // True
withAddr is { Address: { Country: "PT" } };          // True, the pre-C# 10 nested form
```

The empty property pattern `{ }` matches any non-null value, which makes
`maybe is { } nonNull` a compact way to test and capture in one step, and a
property pattern can carry a type and a designation:
`string { Length: > 2 } name`.

### Positional patterns

A positional pattern `(p1, p2, ...)` calls a `Deconstruct` method with the
matching number of `out` parameters and tests each output. Positional records
get `Deconstruct` for free; tuples work directly; any other type can declare
the method. The compiler calls it once per `switch`, not once per arm. With a
counter in `Deconstruct`, this four-arm switch reports a single call:

```csharp
string where = new Point(3, 0) switch
{
    (0, 0) => "origin",
    (_, 0) => "on X axis",
    (0, _) => "on Y axis",
    _ => "elsewhere",
};
// on X axis, Deconstruct calls = 1
```

A mismatched arity fails at compile time: `p is (1, 2, 3)` on a two-member
record gives CS1501 "No overload for method 'Deconstruct' takes 3 arguments"
and CS8129 "No suitable 'Deconstruct' instance or extension method was found".

Positional patterns accept element names (`is (Sum: var sum, Count: > 0)`),
can be prefixed by a type (`Circle(> 1) c`), and also work on a boxed tuple
typed as `object`, through the `ITuple` interface: `object boxed = (1, "x");
boxed is (1, _)` is `True`.

Tuple switches are the natural way to write a state machine. Every transition
is one line, and the discard arm documents what is invalid:

```csharp
static State Next(State state, Trigger t) => (state, t) switch
{
    (State.Closed, Trigger.Open)   => State.Open,
    (State.Open,   Trigger.Close)  => State.Closed,
    (State.Closed, Trigger.Lock)   => State.Locked,
    (State.Locked, Trigger.Unlock) => State.Closed,
    _ => throw new InvalidOperationException($"{t} is not valid in {state}"),
};
// Next(State.Open, Trigger.Lock) throws: "Lock is not valid in Open"
```

### List patterns (C# 11)

A list pattern `[p1, p2, ...]` matches a sequence whose length equals the number
of patterns and whose elements match them in order. The slice pattern `..`
matches zero or more elements, may appear at most once, and can capture what it
matched with `.. var rest`:

```csharp
int[] nums = [1, 2, 3, 4];
nums switch
{
    [] => "empty",
    [var only] => $"one: {only}",
    [var first, .. var rest] => $"first {first}, rest [{string.Join(",", rest)}]",
};
// first 1, rest [2,3,4]

"aBBA" is ['a' or 'A', .. var mid, 'a' or 'A'];   // True, mid = "BB"
```

The input type must be countable (an accessible `Length` or `Count`) and
indexable (an `int` or `Index` indexer). Capturing a slice also needs a `Range`
indexer or a `Slice(int, int)` method. That rules some types out:

```csharp
IEnumerable<int> e = ...;
e is [1, ..];
// error CS8985: List patterns may not be used for a value of type
// 'IEnumerable<int>'. No suitable 'Length' or 'Count' property was found.

a is [.., 1, ..];
// error CS8980: Slice patterns may only be used once and directly inside a list pattern.

bag is [_, .. var rest];   // Bag has Count and this[int], but no Slice
// error CS1503: Argument 1: cannot convert from 'System.Range' to 'int'
bag is [_, ..];            // compiles: a slice without capture needs no Slice
```

### What slices cost

The generated code first tests the length, then the elements it needs, and
only then produces the slice, by calling a different method per type. A
disassembled Release build of `x is [_, .. var r]` shows:

| Input type | Call that builds `r` | Allocates? |
|---|---|---|
| `int[]` | `RuntimeHelpers.GetSubArray` | yes, a new array |
| `List<int>` | `List<int>.Slice` | yes, a new list |
| `string` | `string.Substring` | yes, a new string |
| `Span<int>` | `Span<int>.Slice` | no, a view |

So `[var head, .. var tail]` recursion over an array copies on every call, the
same quadratic trap as repeated `Substring`. In hot paths, match on a
`ReadOnlySpan<T>` (an array converts implicitly) or discard the slice and index
directly.

### Exhaustiveness with sequences

The compiler reasons about lengths. `a switch { [] => 0, [_] => 1 }` on an
`int[]` produces warning CS8509 with the example pattern `'{ Length: 2 }'`,
while `[]`, `[_]`, and `[_, _, ..]` together compile without a warning, because
they cover every length. The language reference states that list patterns do
not generate the non-exhaustive warning; with the .NET 10.0.100 SDK they do in
this case, so trust the compiler output over that sentence. Subsumption works
too: `[1, 2]` after `[_, ..]` is error CS8510.

### A command parser

Splitting a line and matching on the resulting array gives a readable parser
where the shape of each command is visible at a glance:

```csharp
static string Parse(string line) => line.Split(' ', StringSplitOptions.RemoveEmptyEntries) switch
{
    ["move", var x, var y] when int.TryParse(x, out var dx) && int.TryParse(y, out var dy)
                       => $"move by ({dx}, {dy})",
    ["say", .. var words] => $"say '{string.Join(' ', words)}'",
    ["quit" or "exit"]    => "bye",
    [var cmd, ..]         => $"unknown command '{cmd}'",
    []                    => "empty line",
};
// "move 3 4" -> move by (3, 4)
// "say hello world" -> say 'hello world'
// "jump" -> unknown command 'jump'
```

## Trade-offs

- **Deep patterns can hide intent.** A pattern three levels deep with several
  combinators is hard to review. Extract a named method or property when a
  pattern stops reading like a sentence.
  ```csharp
  static bool IsDomesticBuyer(Customer c) => c is { Address.Country: "PT", Orders: > 0 };
  ```
- **Positional patterns couple callers to member order.** Reordering the
  parameters of a positional record silently changes what `(0, _)` means.
  Property patterns name the members and survive the reorder.
- **Slices allocate on arrays, lists, and strings.** Capturing `.. var rest`
  copies. Use spans or discard the slice in loops and recursion.
- **List patterns need countable, indexable types.** `IEnumerable<T>` and lazy
  LINQ queries cannot be matched; materializing them to match costs a full
  enumeration.
- **`when` guards still escape the analysis.** In the parser above, the `move`
  arm with a guard does not cover `["move", "a", "b"]`; the `[var cmd, ..]` arm
  catches it. Keep a catch-all arm after guarded arms.

## Documentation Links

- [Patterns, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns) (doc)
- [Deconstructing tuples and other types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/deconstruct) (doc)
- [List and slice patterns, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/list-patterns) (doc)
- [Extended property patterns, C# 10 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-10.0/extended-property-patterns) (doc)
- [Tutorial: Build algorithms with pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/build-algorithms-using-pattern-matching) (doc)
