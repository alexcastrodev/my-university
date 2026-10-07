---
version: 1.0
updatedAt: 2026-10-07
---
## Question

# What does the `field` keyword do in a property?

## Short Answer

Since C# 14, `field` inside a property accessor refers to the **backing field the compiler generates for you**. You can add validation or side effects to one accessor and keep the other one automatic, without declaring a private field by hand.

## What It Is

Auto-properties (`{ get; set; }`) are great until you need one tiny bit of logic, like trimming a string or rejecting `null`. Until C# 13, that single line of logic forced you to give up the auto-property: declare a private field, write both accessors by hand, and keep the field and the property in sync.

C# 14 (shipped with .NET 10) adds the contextual keyword `field`. Inside a `get`, `set` or `init` accessor, `field` is the compiler-synthesized backing field. You write only the accessor that needs logic, and the other one can stay as a plain `get;` or `set;`.

## Why It Matters

The backing field is now **scoped to the property**. Nothing else in the class can touch it by accident, so the invariant you put in the setter cannot be bypassed by a method that writes the field directly. That's a guarantee the old "private field + property" pattern never gave you.

It also works with lazy initialization and with `init` accessors, and field initializers still work: `= "default"` initializes the synthesized field.

## Practical Example

```csharp
public class Customer
{
    // Before C# 14
    private string _name = "";
    public string OldName
    {
        get => _name;
        set => _name = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
    }

    // C# 14
    public string Name
    {
        get;
        set => field = value?.Trim() ?? throw new ArgumentNullException(nameof(value));
    } = "";

    // Lazy initialization with no extra field
    public List<string> Tags => field ??= new List<string>();
}
```

## Solution and Conclusion

Reach for `field` whenever an auto-property needs a small amount of logic in one accessor. One gotcha: `field` is a contextual keyword, so if your class already has a member literally called `field`, inside an accessor the keyword wins. Use `this.field` or `@field` to refer to the member. The compiler warns you about this case.

## References

- [The field keyword: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) (doc)
- [What's new in C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
