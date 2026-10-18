---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Pattern matching lets a single expression ask "what is this value?" and branch
on the answer: its runtime type, whether it equals a constant, which range it
falls in, or a logical combination of those. The same patterns work in `is`,
in the `switch` statement, and in the `switch` expression. What makes them
more than syntax is the compiler's analysis: it knows when a `switch`
expression leaves values unhandled, when an arm can never be reached, and when
an `is` test is always or never true, and it compiles the arms into a decision
tree instead of a list of `if`s. This concept covers the type, constant,
relational, logical, `var`, and discard patterns, `when` guards, exhaustiveness
and subsumption with the real compiler messages, and what the generated code
looks like. Property, positional, and list patterns are the next concept.

## Use Cases

- Mapping an enum or a status code to a value in one expression, with the
  compiler pointing out the case you forgot.
- Classifying numbers into ranges (tax brackets, HTTP status families, grades)
  without chains of `if`/`else if`.
- Handling an `object` or a base type that can hold several concrete types,
  such as a message from a queue or a JSON node.
- Replacing `x != null && x is Foo` and casts with a single `x is Foo foo`.

## Deep Dive

### The catalog

```csharp
static string Describe(object? o) => o switch
{
    null => "null constant",                       // constant pattern
    0 => "zero",                                    // constant pattern (int)
    int n and > 0 => $"positive int {n}",           // declaration + relational, combined with and
    int => "other int",                             // type pattern (C# 9)
    string { Length: 0 } => "empty string",         // type + property pattern
    string s => $"string of {s.Length}",            // declaration pattern
    char c and (>= 'a' and <= 'z') => $"lowercase {c}",
    long or short => "long or short",               // or of two type patterns
    _ => $"something else ({o.GetType().Name})",    // discard
};

Describe(42);        // positive int 42
Describe(-3);        // other int
Describe("");        // empty string
Describe('x');       // lowercase x
Describe(7L);        // long or short
Describe(new[] {1}); // something else (Int32[])
```

A few rules are worth knowing precisely:

- **Type and declaration patterns never match `null`.** `maybe is string` is
  `false` for a null `string?`. They match the runtime type through identity,
  inheritance, interface implementation, boxing or unboxing, and a `Nullable<T>`
  with a value (`int? ni = 5; ni is int x` gives `x = 5`). They ignore
  user-defined conversions.
- **`var` patterns match everything, including `null`.** `maybe is var v` is
  `true` even when `maybe` is `null`. Use it to capture an intermediate value,
  not to test anything.
- **Constant patterns** accept numeric, `char`, `string`, `bool`, enum, and
  `const` values, and `null`. `x is null` never calls a user-defined `==`, which
  is why it is preferred over `x == null`.
- **Relational patterns** (`<`, `<=`, `>`, `>=`) take a constant of numeric,
  `char`, or enum type. They do not match `null`, and they do not match `NaN`,
  which must be handled with the constant pattern `double.NaN`.

### Logical patterns and precedence

`not` binds tighter than `and`, which binds tighter than `or`. That makes one
mistake very easy to write:

```csharp
static bool WrongNotLower(char c) => c is not >= 'a' and <= 'z';   // (not >= 'a') and <= 'z'
static bool RightNotLower(char c) => c is not (>= 'a' and <= 'z');

WrongNotLower('~');   // False: '~' is above 'z', so "<= 'z'" fails
RightNotLower('~');   // True
```

The compiler does not catch every variant. `n is not 1 or 2` means
`(not 1) or 2`, so the `2` is redundant and the expression is just
`n is not 1`, yet the .NET 10.0.100 SDK builds it without a warning. When in
doubt, add parentheses.

### `when` guards

A guard adds an arbitrary boolean condition after a pattern. It runs only when
the pattern already matched, and it is the only place for checks that patterns
cannot express, such as comparing two captured values or calling a method:

```csharp
double d when double.IsFinite(d) => $"finite double {d}",
```

The price is that the compiler cannot reason about guards. They do not count
toward exhaustiveness, as the next section shows.

### Exhaustiveness

A `switch` expression must produce a value for every input. When the compiler
can find an input that no arm handles, it warns and shows an example. These are
the messages from the .NET 10.0.100 SDK:

```csharp
n switch { < 0 => "negative", 0 => "zero" }
// warning CS8509: The switch expression does not handle all possible values of its
// input type (it is not exhaustive). For example, the pattern '1' is not covered.

c switch { Color.Red => "red", Color.Green => "green", Color.Blue => "blue" }
// warning CS8524: ... involving an unnamed enum value. For example, the pattern
// '(Color)3' is not covered.

s switch { string text => text }          // s is string?
// warning CS8655: The switch expression does not handle some null inputs
// (it is not exhaustive). For example, the pattern 'null' is not covered.

n switch { var x when x >= 0 => "non-negative", var x when x < 0 => "negative" }
// warning CS8846: ... For example, the pattern '_' is not covered. However, a
// pattern with a 'when' clause might successfully match this value.
```

The enum case surprises people: an enum is just an integer, so `(Color)42` is a
legal value. If the warning is ignored and such a value arrives, the runtime
throws:

```csharp
Name((Color)42);
// SwitchExpressionException: Non-exhaustive switch expression failed to match its input.
// Unmatched value was 42.
```

Class hierarchies get no help in C# 14. Even with an `abstract` base and two
`sealed` subclasses, both handled, the compiler still reports CS8509 with the
pattern `'_'`, because another assembly could add a subclass. The documentation
for C# 15, which is still in preview, describes `closed` classes that change
this; in C# 14 you need a discard arm. A `bool` switch with `true` and `false`
arms, on the other hand, is exhaustive and compiles silently.

### Subsumption: arms that can never run

Arms are tried in text order, so an arm whose values were all handled earlier
is dead code. The compiler makes that an error, not a warning:

```csharp
n switch { > 0 => "positive", > 10 => "big", _ => "other" }
// error CS8510: The pattern is unreachable. It has already been handled by a
// previous arm of the switch expression or it is impossible to match.

o switch { string s => s, "hello" => "greeting", _ => "other" }   // same CS8510

switch (n) { case > 0: break; case 5: break; }
// error CS8120: The switch case is unreachable. It has already been handled by a
// previous case or it is impossible to match.
```

The same analysis runs on `is`: `n is > 5 and < 3` is error CS8518 ("An
expression of type 'int' can never match the provided pattern"), and `n is int`
on an `int` is warning CS0183 ("The given expression is always of the provided
('int') type").

### What the compiler generates

Arms are not compiled as a sequence of `if` statements. Roslyn builds a decision
graph that shares tests between arms and orders them for speed. Disassembling a
Release build shows:

- **Dense integer constants** (`0 => ..., 1 => ..., 4 => ...`) become a single
  IL `switch` instruction, a jump table.
- **Relational ranges** (`< 0`, `< 10`, `< 100`, `_`) become a binary search:
  the first comparison in the IL is against `10`, the middle boundary, not
  against `0`, the first arm.
- **String constants** are dispatched by `Length` with an IL `switch`, then by a
  character at a chosen position, and only then confirmed with `string ==`.
  For seven HTTP verbs, no hash is computed at all.
- **Type patterns** become `isinst`, and two arms on the same type
  (`string s when s.Length > 3` and `string`) share one `isinst string`.

The practical consequence: arm order matters for which result you get, but you
do not need to reorder arms for speed. Write them in the order that reads best
and lets the subsumption check protect you.

## Trade-offs

- **A discard arm silences the exhaustiveness check forever.** `_ => throw`
  makes today's code safe, but when someone adds `Color.Yellow` the compiler
  stays quiet. For enums you own, prefer listing every member and accepting
  CS8524, or throw with the value so the failure is obvious.
  ```csharp
  _ => throw new ArgumentOutOfRangeException(nameof(c), c, "Unknown color"),
  ```
- **Guards defeat the analysis.** Every `when` is opaque to exhaustiveness and
  subsumption. Express the condition as a pattern (`> 0` instead of
  `when x > 0`) whenever it is possible.
- **`switch` on types is not polymorphism.** A type switch puts the behavior
  next to the caller, which is good for closed sets you control (messages,
  results) and bad when new types appear often: every switch must change. A
  virtual method keeps the behavior with the type.
- **Precedence of `not`, `and`, `or` is easy to misread,** and not every mistake
  produces a diagnostic. Parenthesize anything with `not` and a combinator.
- **`NaN` and `null` fall through relational arms.** `< 0` and `>= 0` together
  do not cover a `double`. Add `double.NaN` and `null` arms explicitly when the
  input type allows them.

## Lab

In this lab you get the static class `Patterns` with six **stubbed** methods that throw `NotImplementedException`, plus ready xUnit tests that cover the edges. Your job is to implement them by replacing `if`/`else` chains with pattern matching: type, constant, relational, logical (`and`, `or`, `not`) and tuple patterns, and switch expressions. The core idea is to see what "exhaustive" means in practice: the compiler warns when a case is missing, but a value outside the enum can still blow up at runtime.

**The scenario**

Six small everyday decisions (describe a value, grade a score, check a weekday, check a letter, price a ticket, advance a traffic light), all in `Patterns.cs`, together with the enum `Light { Red, Yellow, Green }`.

- `Describe(object?)`: `null`, negative, zero and positive integers, empty or non-empty text, `bool` and "other".
- `Grade(int)`: a score from 0 to 100 as A, B, C or F.
- `IsWeekday(DayOfWeek)` and `IsAsciiLetter(char)`: predicates written as a single `is` pattern.
- `TicketPrice(int, bool)`: price by age and membership.
- `Next(Light)`: the next traffic light state.

In `PatternTests.cs`, the `[InlineData]` rows include the boundaries (89 and 90, 12 and 13, 64 and 65) and an undefined enum value, `(Light)99`.

**What you will do, step by step**

1. **One switch for many patterns (TODO-00).** In `Describe`, use a switch expression with type, constant and relational patterns (`null`, `int and < 0`, `0`, `""`, `string`, `bool` and the rest). The order of the arms matters.
2. **Relational ranges (TODO-01).** In `Grade`, use `< 0 or > 100` to throw `ArgumentOutOfRangeException` and `>= 90`, `>= 80`, `>= 70` for the grades, with `F` for the rest.
3. **Logical patterns (TODO-02 and TODO-03).** In `IsWeekday`, write a single `is not (... or ...)`. In `IsAsciiLetter`, combine ranges with `and`/`or` and mind the parentheses: `and` binds tighter than `or`.
4. **Tuple pattern (TODO-04).** In `TicketPrice`, switch on `(age, isMember)`. Arms are tested top to bottom: a negative age throws, below 3 pays 0, below 13 pays 5, 65 and above pays 7, and everyone else pays 8 (members) or 10.
5. **Exhaustiveness and its runtime cost (TODO-05).** In `Next`, list the three enum members with **no** discard arm. The compiler only warns when a member is missing, and `(Light)99` throws `SwitchExpressionException` at runtime.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why the order of the arms matters in `TicketPrice`, and why the `(Light)99` test expects an exception instead of a compile-time warning.

**Optional challenges**

- **TODO-06:** add an arm to `Describe` that the compiler flags as unreachable (for example `int` before `int and < 0`) and read the error.
- **TODO-07:** rewrite `TicketPrice` with a `when` clause instead of a tuple pattern and compare readability.

**Prerequisites:** `switch` statements, the `is` operator and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Every stubbed method throws `NotImplementedException` and its comment lists the expected cases, so red tests are your checklist.

## Documentation Links

- [Patterns, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns) (doc)
- [switch expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/switch-expression) (doc)
- [Pattern matching overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/pattern-matching) (doc)
- [Selection statements: if and switch, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/selection-statements) (doc)
- [Errors and warnings for pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/pattern-matching-warnings) (doc)
- [SwitchExpressionException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.switchexpressionexception) (doc)
