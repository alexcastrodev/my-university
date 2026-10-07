---
version: 1.0
updatedAt: 2026-09-18
---
## Question

# What happens when an `int` overflows in C#?

## Short Answer

By default, **nothing visible**: it silently wraps around. `int.MaxValue + 1` becomes `int.MinValue`. You only get an `OverflowException` inside a `checked` context, or if the whole project is compiled with overflow checking turned on.

## What It Is

Integer arithmetic in C# runs in an `unchecked` context unless you say otherwise. The CPU simply keeps the low 32 (or 64) bits of the result, which, in two's complement, flips a large positive number into a large negative one.

There is one exception: **constant expressions** are always checked at compile time. `int x = int.MaxValue + 1;` doesn't compile (error CS0220), which can give the false impression that overflow is always detected.

## Not Every Type Behaves the Same

- `int`, `long`, `byte`... wrap silently (unchecked) or throw `OverflowException` (checked).
- `decimal` **always** throws `OverflowException`, checked or not.
- `float` and `double` never throw: they go to `PositiveInfinity` / `NegativeInfinity`.
- Integer division by zero always throws `DivideByZeroException`, regardless of the context.

## Practical Example

```csharp
int max = int.MaxValue;

int wrapped = max + 1;                 // -2147483648, no error

int safe = checked(max + 1);           // OverflowException

checked
{
    long total = 0;
    foreach (var amount in amounts)
        total += amount;               // every operation in the block is checked
}

decimal big = decimal.MaxValue;
big += 1;                              // OverflowException, always

double d = double.MaxValue * 2;        // PositiveInfinity
```

## Solution and Conclusion

Wherever an overflow would be a bug (money, counters, sizes, indices computed from user input), wrap the arithmetic in `checked`, or enable `<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>` in debug builds to catch problems early. Use explicit `unchecked` for code that intentionally relies on wrapping, like hash code calculations.

## References

- [checked and unchecked statements: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked) (doc)
- [CheckForOverflowUnderflow compiler option](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language#checkforoverflowunderflow) (doc)
