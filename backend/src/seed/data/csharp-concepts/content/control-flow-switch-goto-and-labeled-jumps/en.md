---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

C# has four ways to leave the current line of execution without returning:
`break`, `continue`, `goto` and (inside a `switch` statement) `goto case`. This
concept covers the `switch` **statement** and its no-fall-through rule, `goto case`
and `goto default`, `goto` with a label, and the C# 15 labeled `break` and
`continue`, which let a nested statement leave or continue an outer loop without a
flag variable or a `goto`. Labeled `break` and `continue` are a stable feature in
C# 15 (the 11.0.100 SDK, no `LangVersion` preview needed). The `switch`
expression and patterns are in `type-constant-and-relational-patterns`; here the
subject is the statement and the jumps. Every error code and output below was
compiled on the 11.0.100 SDK.

## Use Cases

- Leaving two or three nested loops as soon as a search succeeds.
- Skipping to the next row (or the next file, or the next record) from inside an
  inner loop.
- A `switch` where one case deliberately continues into another, for example
  tiers or permission levels that include the lower ones.
- A `while` loop whose body is a `switch` that must be able to continue or stop
  the loop, not only the switch.
- Reading code review comments such as "replace this flag with a label" and
  deciding whether the label is clearer.

## Deep Dive

### The `switch` statement and the end of fall-through

In a `switch` statement every section must end in a statement that does not reach
the next label: `break`, `return`, `throw`, `continue` or a `goto`. If a section
falls off its end, the compiler refuses:

```csharp
switch (n)
{
    case 1:
        Console.WriteLine("one");
    case 2:               // error CS0163: Control cannot fall through from one case label ('case 1:')
        Console.WriteLine("two");
        break;
}
```

The last section has the same rule, reported as `CS8070`. Stacking labels with no
statements between them is allowed, because there is no code to fall through:

```csharp
case 0:
case -1:
    text = "none";
    break;
```

Other checks come from the same analysis: a repeated constant is `CS0152`, and a
`goto case 5;` to a label that does not exist is `CS0159: No such label 'case 5:'
within the scope of the goto statement`. A `when` clause works in a statement
too (`case int n when n > 10:`), and a `case` can be a pattern, so a switch
statement shares the pattern syntax with the expression.

### `goto case` and `goto default`

Where you want C-style continuation, you say so:

```csharp
static string Tier(int n)
{
    string r = "";
    switch (n)
    {
        case 3: r += "gold ";   goto case 2;
        case 2: r += "silver "; goto case 1;
        case 1: r += "bronze";  break;
        case 0:
        case -1: r = "none";    break;
        default: r = "?";       break;
    }
    return r;
}
// 3: "gold silver bronze", 2: "silver bronze", 1: "bronze", 0: "none", 9: "?"
```

`goto default;` jumps to the default section, which is useful when a pattern case
(`case int:`) decides that it does not handle its input after all. With
`F(50)`, `F(1)`, `F("x")` and `F(2.5)` on a switch with `case int n when n > 10`,
`case int: goto default;`, `case string s` and `default`, the results are
`big`, `other`, `s:x` and `other`. When the continuation is really a lookup,
a `switch` **expression** usually reads better, because it has no jumps at all:
`k switch { 3 => "gold silver bronze", 2 => "silver bronze", _ => "?" }`.

### `goto` with a label

`goto label;` jumps to a labeled statement in the same method, in the same or an
enclosing block. It cannot jump into a block:

```csharp
goto inside;
{
    inside: Console.WriteLine();   // error CS0159: No such label 'inside'
}
```

A label never used is `CS0164` (a warning), a duplicate is `CS0140`, and a missing
one is `CS0159`. The classic legitimate uses are small: a retry written as a
backward jump (a loop is usually clearer), and, before C# 15, leaving nested
loops:

```csharp
int found = -1;
for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++)
        if (i * j == 2) { found = i * 10 + j; goto done; }
done:
Console.WriteLine(found);   // 12
```

That one is what labeled `break` replaced in most code. Prefer it now unless the
jump goes somewhere that is not a loop exit.

### Labeled `break` and `continue` (C# 15)

A label before a loop (`for`, `foreach`, `while`) or a `switch` can be the
target of `break` or `continue` from anywhere inside it:

```csharp
int visited = 0;
int[][] grid = [[1, 0, 1], [2, 3, 9], [4, 5, 6]];
outer:
for (int r = 0; r < grid.Length; r++)
{
    for (int c = 0; c < grid[r].Length; c++)
    {
        visited++;
        if (grid[r][c] == 0) continue outer;   // next row
        if (grid[r][c] == 3) break outer;      // leave both loops
    }
}
// visited is 4
```

`foreach` works the same way (a `continue rows;` over nested `foreach` loops
counted 8 cells in the same grid, because each 0 skips the rest of its row). A
`switch` can be labeled too, which matters inside a loop, because a plain `break`
in a switch section only leaves the switch:

```csharp
int i = 0;
loop:
while (i < 10)
{
    i++;
    sw:
    switch (i)
    {
        case 2: continue loop;   // next iteration of the while
        case 4: break sw;        // leave the switch, then print
        case 6: break loop;      // leave the while
        default: break;
    }
    Console.WriteLine($"after switch i={i}");
}
// prints for i = 1, 3, 4, 5; ends with i 6
```

The rules, from the errors the compiler gave:

| Code | Case |
|---|---|
| `CS9393` | `break nope;` with no enclosing loop or switch with that label |
| `CS9393` | the label is on an `if` or a block, not on a loop or switch |
| `CS9393` | the jump is inside a local function and the label is outside it |
| `CS1632` | the jump is inside a lambda: control cannot leave an anonymous method |
| `CS0140` | two labels with the same name in one method |
| `CS0164` | warning: a label that nothing refers to |
| `CS9327` | the project is on `LangVersion` 14 |

It is a compiler-only feature, like `with(...)` in
`collection-expressions-spread-and-with-arguments`: the emitted IL is ordinary
branches, so it compiles for older target frameworks with `LangVersion` 15 on the
SDK 11. The overview is in `whats-new-in-csharp-15`.

### Choosing: label, flag, local function or exception

The same "leave two loops" problem has four solutions:

- **A flag** (`bool found`) tested in each loop condition. It works everywhere,
  but it adds state, and a missed test keeps the inner loop running.
- **A local function** that `return`s. Often the best: the search becomes a named
  method that returns the result, with no jump at all (see
  `local-functions-lambdas-and-closures`).
- **A label** (`break outer;`). Short and visible, good when the loops are in one
  method and the exit is a pure jump.
- **An exception.** Never for control flow in the normal path (see
  `exceptions-try-catch-filters-and-finally`).

A useful test: if the code after the loops needs the position you found, return it
from a method. If it only needs to know that the loop ended, a label is enough.

## Trade-offs

- **Jumps hide the shape of the loop.** A `continue outer;` three levels deep is
  easy to misread. Keep the labeled loops short, name the label for what it
  iterates (`rows`, `files`), and extract the inner part if it grows.
- **A label has to be used.** An unreferenced label is `CS0164`. Treat the
  warning as a sign that a refactor left dead structure.
- **Labels stop at method boundaries.** A lambda or local function cannot jump to
  a label outside itself (`CS1632`, `CS9393`), so moving a loop body into one can
  break a `continue outer`.
- **`goto case` chains grow.** It is legal and explicit, but a long chain of them
  is a state machine in disguise. If cases are values to look up, use a
  `switch` expression.
- **C# 15 needed.** Projects on the SDK 10 get `CS9327` for labeled jumps. Until
  every build is on the SDK 11, the flag or the local function is the portable
  choice.
- **`break` inside `switch` is not `break` of the loop.** The most common bug in
  loops with a switch is writing `break` and expecting the loop to stop. Label
  the loop.

## Lab

Write five small routines that need jumps a plain `break` or `continue` cannot express: a switch statement with `goto case`, a retry with a label and `goto`, a grid search that leaves two loops, a row scan with a labeled `continue`, and a command loop with a switch inside.

**The scenario**

One library project (`Flow.cs`) and a test project. The starter has `NotImplementedException` stubs and comments describing each routine.

**What you will do, step by step**

1. **goto case (TODO-00).** `Flow.Tier`: `3` also earns the lower tiers.
2. **goto label (TODO-01).** `Flow.Retry` with a backward jump.
3. **break with label (TODO-02).** `Flow.FindFirst` leaves both loops and counts the visited cells.
4. **continue with label (TODO-03).** `Flow.CountOpenCells` skips the rest of a row after a 0.
5. **Label around a switch (TODO-04).** `Flow.RunCommands`: `continue loop;` and `break loop;` from inside the switch.

**How you know you are done**

`dotnet test` is green with 14 tests. You should be able to explain why a plain `break` would not stop the loop in TODO-04.

**Optional challenges**

- Rewrite TODO-02 with a flag and with a local function, and compare the three.
- Reproduce `CS9393`, `CS0140` and `CS1632`, and `CS9327` with `LangVersion` 14.

**Prerequisites:** loops, `switch` statements and the .NET 11 SDK (the projects target `net11.0`).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed method throws `NotImplementedException`, so red tests are your checklist.

## Documentation Links

- [Jump statements, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/jump-statements) (doc)
- [The switch statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/selection-statements#the-switch-statement) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
