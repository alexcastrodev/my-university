---
version: 1.0
updatedAt: 2026-09-23
---
## Question

# How do records implement equality?

## Short Answer

The compiler generates **value-based equality** for you: `Equals`, `GetHashCode`, `==` and `!=` compare every field, plus a hidden `EqualityContract` property so that two records of different types are never equal, even with the same values.

## What It Is

A `record` (a class) or `record struct` is a type the compiler fills with boilerplate. For equality, two record instances are equal when:

1. they have the same `EqualityContract` (by default, `typeof` the record's own type), and
2. every field is equal according to `EqualityComparer<T>.Default`.

Since a `record` is still a reference type, `ReferenceEquals(a, b)` keeps telling you whether they are the same object, but `a == b` now means "same values".

## The Shallow Part

The comparison is **field by field, one level deep**. If a field is a `List<T>` or an array, it's compared with that type's own `Equals`, which is reference equality. Two records with lists containing the same items are **not** equal.

The same goes for `with` expressions: they make a shallow copy. The new record shares the same list instance with the original.

## Practical Example

```csharp
public record Point(int X, int Y);
public record ColoredPoint(int X, int Y, string Color) : Point(X, Y);
public record Order(int Id, List<string> Items);

new Point(1, 2) == new Point(1, 2);                  // true
new Point(1, 2) == new ColoredPoint(1, 2, "red");    // false: different EqualityContract

var a = new Order(1, ["book"]);
var b = new Order(1, ["book"]);
a == b;                                              // false: lists compared by reference

var c = a with { Id = 2 };
c.Items.Add("pen");                                  // a.Items also has "pen" now
```

## Solution and Conclusion

Records are ideal for immutable data whose fields are themselves values (numbers, strings, other records). If you need collections inside them, prefer immutable collections and override `Equals(R? other)` and `GetHashCode` when you want sequence equality. And remember that `with` never deep-copies.

## References

- [Records: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Equality comparisons: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/statements-expressions-operators/equality-comparisons) (doc)
