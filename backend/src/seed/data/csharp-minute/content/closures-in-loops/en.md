---
version: 1.0
updatedAt: 2026-09-16
---
## Question

# Why do lambdas in a `for` loop all see the same value?

## Short Answer

Because a lambda captures the **variable**, not its value. A `for` loop declares a single variable `i` for the whole loop, so every lambda shares it and sees its final value. A `foreach` loop, since C# 5, declares a fresh variable per iteration, so it doesn't have this problem.

## What It Is

When a lambda uses a local variable from the enclosing method, the compiler moves that variable into a hidden "closure" class. Both the method and the lambda then read and write the **same field** of that object. That's why a lambda can see changes made after it was created.

In `for (int i = 0; i < 3; i++)`, `i` is declared once, before the first iteration. There's one closure object, one `i`, and by the time the lambdas run, the loop has finished and `i` is `3`.

## A Breaking Change in C# 5

Before C# 5, `foreach` had exactly the same behavior, and it was one of the most reported "bugs" in the language. The C# team made a rare breaking change: in C# 5, the `foreach` iteration variable became **logically scoped inside the loop body**, so each iteration gets its own copy.

They deliberately did **not** change `for`, because its variable is visibly declared and updated outside the body (`i++`), and changing it would have been even more confusing.

## Practical Example

```csharp
var actions = new List<Action>();

for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));
actions.ForEach(a => a());        // prints 333

actions.Clear();
foreach (var n in new[] { 0, 1, 2 })
    actions.Add(() => Console.Write(n));
actions.ForEach(a => a());        // prints 012 (C# 5+)

actions.Clear();
for (int i = 0; i < 3; i++)
{
    int copy = i;                 // a new variable per iteration
    actions.Add(() => Console.Write(copy));
}
actions.ForEach(a => a());        // prints 012
```

## Solution and Conclusion

When a lambda created inside a `for` loop (or inside a `while`, or before an `await`) needs the current value, copy it into a local declared **inside** the loop body. Also remember that captures extend the variable's lifetime and allocate a closure object, so use `static` lambdas when you want the compiler to guarantee nothing is captured.

## References

- [Lambda expressions: capture of outer variables](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions#capture-of-outer-variables-and-variable-scope-in-lambda-expressions) (doc)
- [Iteration statements: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements) (doc)
