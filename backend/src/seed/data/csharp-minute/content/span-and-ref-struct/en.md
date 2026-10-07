---
version: 1.0
updatedAt: 2026-10-05
---
## Question

# Why can a `Span<T>` never live on the heap?

## Short Answer

Because `Span<T>` is a `ref struct`: it can hold a reference that points **into the middle** of an array, a `stackalloc` buffer or native memory. The runtime can only track that kind of reference safely while it stays on the stack, so the compiler forbids anything that could move a span to the heap.

## What It Is

A `Span<T>` is a view over a contiguous block of memory: a reference to the first element plus a length. Slicing a span creates a new view over the same memory, **without copying and without allocating**. That's why `"hello world".AsSpan(6)` is free, while `"hello world".Substring(6)` allocates a new string.

The interesting part is where that memory can come from: a managed array, a string, a buffer created with `stackalloc`, or unmanaged memory. A reference into the interior of an object (a "byref") is something the garbage collector handles only for stack locations. It cannot exist as a field inside a heap object.

## The Rules

To keep that guarantee, a `ref struct` like `Span<T>`:

- cannot be a field of a class or of a regular struct;
- cannot be boxed, so it cannot be converted to `object` or (before C# 13) to an interface;
- cannot be captured by a lambda or a local function;
- cannot be alive across an `await` or a `yield return`. Since C# 13 you may declare it in an `async` method or an iterator, but its lifetime must not cross a suspension point.

If you need to store a buffer view in a field or keep it across an `await`, use `Memory<T>`, which is a regular struct, and call `.Span` when you actually process the data.

## Practical Example

```csharp
static int SumDigits(ReadOnlySpan<char> text)
{
    int sum = 0;
    foreach (char c in text)
        if (char.IsDigit(c)) sum += c - '0';
    return sum;
}

string input = "order-2026-10-05";
int total = SumDigits(input.AsSpan(6));   // no substring allocated

Span<byte> buffer = stackalloc byte[128]; // lives on the stack, no GC involved

class Holder
{
    // Span<byte> _buffer;  // error CS8345: field cannot be of a ref struct type
    Memory<byte> _buffer;   // fine
}
```

## Solution and Conclusion

Use `Span<T>` / `ReadOnlySpan<T>` for synchronous, hot code paths that slice and parse data without allocating. When the data must outlive the current stack frame (a field, an `async` method, a callback), switch to `Memory<T>` and only take a span at the point where you work on it.

## References

- [ref struct types: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
- [Span<T> struct: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.span-1) (doc)
- [Memory<T> and Span<T> usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
