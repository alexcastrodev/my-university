---
version: 1.0
updatedAt: 2026-09-28
---
## Question

# What does `yield return` compile into?

## Short Answer

Into a **state machine class**. The compiler rewrites your method into a hidden type that implements `IEnumerable<T>` and `IEnumerator<T>`, and every `yield return` becomes a point where `MoveNext()` saves its position and returns `true`.

## What It Is

When a method contains `yield return`, its body no longer runs when you call it. Calling it just creates the state machine object. The code only starts executing on the first `MoveNext()`, runs until the next `yield return`, stores the current value and the current "state" (which `yield` it stopped at, plus the values of your local variables, now turned into fields), and returns.

That design is what makes iterators **lazy**: you can describe an infinite sequence and only pay for the elements someone actually consumes.

## The Surprises

Lazy execution has two side effects that catch people:

1. **Argument validation is deferred.** A `throw` at the top of the iterator won't happen when the method is called, only when someone starts enumerating, possibly far away in the code.
2. **Every enumeration runs the code again.** Enumerating the same `IEnumerable<T>` twice (for example, calling `.Count()` and then `foreach`) executes the whole body twice, including any database or file access inside it.

## Practical Example

```csharp
static IEnumerable<int> Countdown(int from)
{
    if (from < 0) throw new ArgumentOutOfRangeException(nameof(from));
    for (int i = from; i >= 0; i--)
        yield return i;
}

var seq = Countdown(-1);      // no exception yet!
foreach (var n in seq) { }    // ArgumentOutOfRangeException thrown here

// Validate eagerly, iterate lazily
static IEnumerable<int> SafeCountdown(int from)
{
    ArgumentOutOfRangeException.ThrowIfNegative(from); // runs at call time
    return Iterate();

    IEnumerable<int> Iterate()
    {
        for (int i = from; i >= 0; i--)
            yield return i;
    }
}
```

## Solution and Conclusion

Use iterators when laziness is what you want: streaming, pipelines, potentially large or infinite sequences. Split validation into a non-iterator wrapper with a local iterator function, and materialize with `.ToList()` when you need to enumerate the result more than once.

## References

- [yield statement: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield) (doc)
- [Iterators: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/iterators) (doc)
