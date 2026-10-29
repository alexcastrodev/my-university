---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Sorting in .NET rests on one contract: a comparison returns a negative number,
zero or a positive number. `IComparable<T>` puts it on the type, `IComparer<T>`
and `Comparison<T>` put it outside, and `Comparer<T>.Default` picks one when
you pass nothing. Breaking it rarely fails loudly: a comparer that disagrees
with `Equals` merges items in a `SortedSet<T>`, `List<T>.Sort` reorders equal
keys, and `BinarySearch` on unsorted data returns a wrong index. This concept
shows each on .NET 10 / C# 14, plus nulls, the exceptions, multi-key ordering,
`NaN`, `DateTimeOffset`, spans and the measured cost of each comparer style.

## Use Cases

- A natural order for a value type like `Money`, so `Sort()` needs no argument.
- Sorting one entity several ways (by name, by date) without changing the type.
- Keeping a list sorted and inserting with `BinarySearch` instead of re-sorting.
- Diagnosing "the sort moved my rows" or "the set lost an item" bugs.

## Deep Dive

### The sign contract and the three shapes

The docs define only the sign, and implementations return other magnitudes:
test `< 0`, never `== -1`, and use `CompareTo`, not subtraction (it overflows):

```csharp
"a".CompareTo("b"); string.CompareOrdinal("a", "c"); ((byte)1).CompareTo((byte)9); // -1 -2 -8
int[] xs = [5, int.MinValue, -3, int.MaxValue, 0];
Array.Sort(xs, (a, b) => a - b);           // 5, 2147483647, -2147483648, -3, 0
Array.Sort(xs, (a, b) => a.CompareTo(b));  // -2147483648, -3, 0, 5, 2147483647
readonly record struct Money(decimal Amount) : IComparable<Money>
{ public int CompareTo(Money other) => Amount.CompareTo(other.Amount); }
people.Sort(new ByAge());                                // a class implementing IComparer<Person>
people.Sort((a, b) => b.Name.CompareTo(a.Name));         // a Comparison<Person> lambda
var byAgeDesc = Comparer<Person>.Create((a, b) => b.Age.CompareTo(a.Age)); // lambda to IComparer
```

`Comparer<T>.Create` serves APIs that only take an `IComparer<T>`. The default
is ``GenericComparer`1`` for `int` and `Person`, ``NullableComparer`1`` for
`int?` and ``ObjectComparer`1`` for a class that implements nothing.

### Nulls and types with no order

The default comparer handles nulls before calling your code (the `IComparer<T>`
docs: null is less than any non-null reference). A lambda gets no such help,
and a type with no `IComparable` fails at the first comparison:

```csharp
var list = new List<Person?> { new("Caio", 30), null, new("Ana", 25), null };
list.Sort();                                   // null, null, Ana(25), Caio(30)
list.Sort((a, b) => a!.Age.CompareTo(b!.Age));
// InvalidOperationException: Failed to compare two elements in the array.
//   InnerException: NullReferenceException
new List<Plain> { new(1), new(2) }.Sort();     // same for Array.Sort and OrderBy(p => p)
// InvalidOperationException: Failed to compare two elements in the array.
//   InnerException: ArgumentException: At least one object must implement IComparable.
new SortedSet<Plain> { new(1), new(2) };       // the ArgumentException, not wrapped
```

A one-element list sorts without error. Records get equality but no ordering:
`record Rec(int X)` and `record struct RS(int X)` throw the same from `Sort()`.
Generic code asks for `IComparable<T>` (or the generic math
`IComparisonOperators<T, T, bool>` for `<`), so with `Max<T>` constrained
`where T : IComparable<T>` the compiler reports the gap:

```text
r1 < r2        error CS0019: Operator '<' cannot be applied to operands of type 'Rec' and 'Rec'
Max([r1, r2])  error CS0311: ... no implicit reference conversion from 'Rec' to 'System.IComparable<Rec>'.
Max([s1, s2])  error CS0315: ... no boxing conversion from 'RS' to 'System.IComparable<RS>'.
```

### A comparer that breaks the rules

A value must equal itself and a pair must always get the same answer. Three
broken comparisons on 10, 100 and 10,000 ints gave:

```text
(a, b) => 1       no exception at any size, output not sorted
(a, b) => -1      n=10 not sorted; n=100 and n=10000 throw
random -1/0/1     n=10 and n=100 not sorted; n=10000 throws
ArgumentException: Unable to sort because the IComparer.Compare() method returns
inconsistent results. Either a value does not compare equal to itself, or one value
repeatedly compared to another value yields different results.
IComparer: 'System.Comparison`1[System.Int32]'.
```

The exception (no inner exception) is a lucky detection, not a guarantee. A
realistic way to get there is comparing doubles with operators, which are all
`false` for `NaN`, while `double.CompareTo` puts `NaN` below every value:

```csharp
double[] v = [3, double.NaN, 1, 2];
Array.Sort(v, (x, y) => x < y ? -1 : x > y ? 1 : 0);  // 3 NaN 1 2: nothing moved
Array.Sort(v);                                         // NaN 1 2 3
```

### CompareTo, Equals and the sorted collections

Sorted collections find duplicates with the comparer alone, so a `CompareTo`
that returns 0 for objects `Equals` calls different loses data:

```csharp
sealed record Emp(string Name, int Age) : IComparable<Emp>     // CompareTo ignores Name
{ public int CompareTo(Emp? o) => o is null ? 1 : Age.CompareTo(o.Age); }
var ana = new Emp("Ana", 30); var bia = new Emp("Bia", 30);   // CompareTo 0, Equals False
var set = new SortedSet<Emp> { ana, bia, new("Caio", 25) };    // Count 2 (HashSet: 3)
var dict = new SortedDictionary<Emp, int> { [ana] = 1, [bia] = 2 };  // Count 1: Ana(30) = 2
dict.Add(new Emp("X", 30), 3);
// ArgumentException: An item with the same key has already been added. Key: [X(30), 3]
var desc = new SortedSet<int>(Comparer<int>.Create((x, y) => y.CompareTo(x))) { 5, 1, 9 };
// 9, 5, 1 and Min = 9: Min and Max follow the comparer
```

`BinarySearch(bia)` on the sorted list `Caio, Ana, Bia, Duda` returned 1
(`Ana`), while `IndexOf(bia)` (which uses `Equals`) returned 2. Make the order
total (add `Name` as a tiebreaker) or keep it in a named `IComparer<T>`.
`SortedDictionary` and `SortedList` take a comparer too: with
`OrdinalIgnoreCase`, setting "B" updated the key "b".

### Stability and multi-key ordering

The `List<T>.Sort` docs: "performs an unstable sort; that is, if two elements
are equal, their order might not be preserved" (introsort, with insertion sort
for partitions of 16 or fewer). Orders with ids 0..39, `Priority = Id % 3`:

```csharp
list.Sort((x, y) => x.Priority.CompareTo(y.Priority));  // Array.Sort: the same
// priority 0 ids: 0,36,33,30,27,24,21,18,15,12,39,9,3,6
orders.OrderBy(o => o.Priority);                        // documented as stable
// priority 0 ids: 0,3,6,9,12,15,18,21,24,27,30,33,36,39
```

Up to 16 items it looked stable; the first reordering came at n = 17, so small
unit tests miss it. A stable in-place sort needs the original index as the last
key (or a LINQ sort copied back). For several keys a comparer chain printed the
same as `ThenBy`: the chain sorts in place and is reusable by `SortedSet<T>`,
`ThenBy` allocates but is stable (see LINQ Operator Families and Query Syntax):

```csharp
indexed.Sort((x, y) => x.o.Priority != y.o.Priority                  // (o, i) pairs
    ? x.o.Priority.CompareTo(y.o.Priority) : x.i.CompareTo(y.i));   // stable
staff.Sort(Comparer<Person>.Create((x, y) => y.Age != x.Age
    ? y.Age.CompareTo(x.Age) : StringComparer.Ordinal.Compare(x.Name, y.Name)));
staff.OrderByDescending(p => p.Age).ThenBy(p => p.Name, StringComparer.Ordinal);
// both: Ana(30), Bia(30), Caio(30), Duda(25), ana(25)
```

### BinarySearch and the bitwise complement

A hit returns the index. A miss returns a negative number whose complement
(`~`) is the index of the next larger element, or `Count` if there is none:

```csharp
var sorted = new List<int> { 10, 20, 30, 40 };
sorted.BinarySearch(30);   // 2
sorted.BinarySearch(25);   // -3, ~(-3) = 2: before 30
sorted.BinarySearch(5);    // -1, ~(-1) = 0: before everything
sorted.BinarySearch(50);   // -5, ~(-5) = 4: after the end
int r = sorted.BinarySearch(25); if (r < 0) sorted.Insert(~r, 25);   // 10,20,25,30,40
new List<int> { 40, 10, 30, 20, 50 }.BinarySearch(10);   // -1, though 10 is at index 1
Array.BinarySearch([1, 2, 2, 2, 2, 2, 3], 2);            // 3: any duplicate may come back
```

Search with the sort's comparer: in `apple, Banana, cherry` sorted with
`OrdinalIgnoreCase`, `"BANANA"` was at 1 with it and -3 with the default.

### Strings, doubles and DateTimeOffset

Ten strings sorted with each comparer, culture en-US, ICU on macOS:

```text
Ordinal                                  10 9 A B Z _x a b e é
OrdinalIgnoreCase                        10 9 a A b B e Z _x é
CurrentCulture, InvariantCulture, none   _x 10 9 a A b B e é Z
```

The default is cultural (under sv-SE a plain `Sort()` put `ä` after `z`), and
"10" precedes "9" in all (see the strings concept). Doubles and dates:

```csharp
double.NaN.CompareTo(double.NegativeInfinity);  // -1, while NaN < -Infinity is False
double.NaN.CompareTo(double.NaN);               // 0,  while NaN == NaN is False
(-0.0).CompareTo(0.0);                          // 0:  sorted zeros came out as 0 -0 0 -0
var utc = new DateTimeOffset(2026, 10, 28, 12, 0, 0, TimeSpan.Zero);
var brt = new DateTimeOffset(2026, 10, 28, 9, 0, 0, TimeSpan.FromHours(-3));
Console.WriteLine($"{utc.CompareTo(brt)} {utc == brt} {utc.EqualsExact(brt)}"); // 0 True False
// sorting orders by instant; OrderBy(d => d.DateTime) by clock reading instead
```

### Spans, key/item arrays and what each style costs

`MemoryExtensions.Sort` sorts a slice in place: `big.AsSpan(1, 3).Sort()` turned
`50,40,30,20,10` into `50,20,30,40,10`. `Array.Sort(keys, items)` moves a second
array in step: keys `3,1,2` with items `c,a,b` became `1,2,3` and `a,b,c`.

Sorting 1,000,000 random ints and 1,000,000 two-int structs (by key), Release
build, 5 warmups then the median of 15 runs, Apple Silicon, .NET 10.0.0, with
other processes on the machine (allow about 10%):

| Sort | int[] | struct[] |
|---|---|---|
| `Array.Sort(a)` (default or `IComparable<T>`) | about 49 ms | about 51 ms |
| `Array.Sort(a, Comparison<T> lambda)` | about 55 ms | about 59 ms |
| `Array.Sort(a, IComparer<T> class)` | about 77 ms | about 87 ms |
| `span.Sort(structComparer)` | about 85 ms | about 94 ms |
| `Order().ToArray()` / `Array.Sort(keys, items)` | about 49 ms | about 50 ms |
| `OrderBy(...).ToArray()` | about 106 ms | about 107 ms |

The default was fastest, also with `Comparer<int>.Default` passed (about 49 ms).
A lambda cost about 12 to 16% more, a comparer class more still, and a struct
comparer gained nothing: the runtime source of `Span.Sort<T, TComparer>` says
"value-type comparer will be boxed". `OrderBy` cost about twice the in-place
sort, while `Order()` on `int` matched `Array.Sort`.

## Trade-offs

- **A natural order is a promise to every caller.** Keep it to one obvious,
  total order consistent with `Equals`; anything else is a named `IComparer<T>`.
- **In-place sorts are fast and unstable.** They reordered ties from 17 items
  up. Use `OrderBy`/`ThenBy` or an index tiebreaker when ties must keep order.
- **A broken comparer may not throw.** The "inconsistent results" exception is
  occasional; `(a, b) => 1` produced unsorted output with no error, and operator
  comparisons on `double` break on `NaN`.
- **Sorted collections deduplicate by the comparer, not `Equals`.** A comparer
  that ignores a field merges set items and overwrites dictionary values.
- **`BinarySearch` trusts you.** Badly sorted input gives a wrong index, silently.
- **Struct comparers do not pay off.** `Span.Sort` boxes them; a lambda was faster.

## Documentation Links

- [IComparable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icomparable-1) (doc)
- [IComparer<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.icomparer-1) (doc)
- [List<T>.Sort method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.sort) (doc)
- [Array.Sort method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.array.sort) (doc)
- [Enumerable.OrderBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby) (doc)
- [Comparisons and sorts within collections, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/comparisons-and-sorts-within-collections) (doc)
