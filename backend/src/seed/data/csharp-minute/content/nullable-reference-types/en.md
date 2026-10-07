---
version: 1.0
updatedAt: 2026-09-21
---
## Question

# Does `string?` change anything at runtime?

## Short Answer

No. For reference types, `string?` and `string` are the **same runtime type**, `System.String`. The `?` is an annotation for the compiler's static analysis, stored as metadata attributes. Nothing stops a `null` from reaching a `string` parameter at runtime.

## What It Is

Nullable reference types (enabled by default in new projects since .NET 6, via `<Nullable>enable</Nullable>`) let you declare intent: `string` means "should never be null", `string?` means "may be null". The compiler then tracks the null state of every variable through your code and warns when you dereference something that might be null, or assign `null` to a non-nullable.

The result is compiled into `[Nullable]` and `[NullableContext]` attributes so other assemblies can read your annotations. But the IL types are unchanged.

## The Contrast with `int?`

This is easy to confuse, because the syntax is identical:

- `int?` is **`Nullable<int>`**, a different struct with a `HasValue` flag. It really exists at runtime.
- `string?` is **just `string`** plus a compile-time hint.

So nullable reference types are warnings, not guarantees. Reflection, deserializers, older libraries without annotations, or the `!` (null-forgiving) operator can all put a `null` where the compiler thinks there is none.

## Practical Example

```csharp
#nullable enable

string Greet(string name) => $"Hello, {name.ToUpper()}";

string? maybe = null;
Greet(maybe);    // warning CS8604: possible null reference argument
Greet(maybe!);   // no warning, but NullReferenceException at runtime

// Same runtime type:
string? a = "x";
string b = "y";
Console.WriteLine(a.GetType() == b.GetType());  // True: both are System.String

// Public APIs still need runtime checks
public void Register(string name)
{
    ArgumentNullException.ThrowIfNull(name); // callers may have nullable disabled
}
```

## Solution and Conclusion

Treat nullable reference types as a powerful linter, and make it strict with `<WarningsAsErrors>nullable</WarningsAsErrors>`. Use `!` only when you know something the compiler can't see. At public boundaries (public APIs, deserialized input), keep real runtime checks like `ArgumentNullException.ThrowIfNull`.

## References

- [Nullable reference types: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references) (doc)
- [Null-forgiving operator: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-forgiving) (doc)
