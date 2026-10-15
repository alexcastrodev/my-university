---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Most C# operators do what they look like, but a few of them carry rules that
decide whether code runs at all. `&&` and `||` skip their right operand, `&`
and `|` do not. `?.` turns an `int` into an `int?` and silently stops a whole
chain. `??` binds more loosely than `+`. C# 14 adds one more member to this
family: `?.` and `?[]` are now allowed on the left side of an assignment, so
`customer?.Name = value` writes only when `customer` exists and does not even
evaluate `value` when it does not. This concept explains how these operators
evaluate, what the new null-conditional assignment accepts and rejects (with
the real compiler errors), what the compiler emits for it, and how it interacts
with nullable reference types.

## Use Cases

- Replacing `if (x is not null) x.Prop = value;` with a single statement when
  "no receiver, nothing to do" is the intended behavior.
- Subscribing to an event on an object that might not exist yet:
  `button?.Clicked += OnClick;`.
- Supplying defaults: `name ?? "anonymous"`, lazy initialization with
  `cache ??= Load()`, and argument checks with `?? throw`.
- Reading a deep property path that may be broken at any level without a
  ladder of null checks.
- Deciding between `&&` and `&` when the right operand has a side effect.

## Deep Dive

### Short-circuit versus eager logical operators

On `bool` operands, `&&` and `||` are conditional: the right side runs only if
the left side has not already decided the result. `&`, `|`, and `^` always
evaluate both operands. On integers, `&`, `|`, and `^` are bitwise operators
instead.

```csharp
int calls = 0;
bool Check(bool v) { calls++; return v; }

bool a = Check(false) && Check(true);   // a = False, calls = 1
calls = 0;
bool b = Check(false) & Check(true);    // b = False, calls = 2
bool c = true ^ true;                   // False: exclusive OR
```

The eager forms are rarely what you want in a condition, but they are the
honest choice when both calls must happen (for example, validating two fields
and reporting both errors).

### The null-aware family: `?.`, `?[]`, `??`, `??=`

`a?.x` evaluates `a` once. If it is `null`, the result is `null` and the rest
of the chain is skipped; otherwise it behaves like `a.x`. Two consequences
follow. First, a value-type member becomes nullable: `name?.Length` is an
`int?`. Second, comparisons on that `int?` are lifted, and any comparison with
`null` is `false`, which reads wrong in both directions:

```csharp
int[]? numbers = null;
Console.WriteLine(numbers?.Length < 2);          // False
Console.WriteLine(numbers?.Length >= 2);         // False
Console.WriteLine((numbers?.Length ?? 0) < 2);   // True: say what null means
```

Short-circuiting covers the whole chain of member and element accesses, but
parentheses end it. `o?.Customer.Name` is `null` when `o` is `null`, while
`(o?.Customer).Name` throws `NullReferenceException`, because the parenthesized
part is a finished value that the outer `.Name` dereferences.

`??` returns its left operand unless it is `null`. Its precedence is lower than
arithmetic, which is a classic misread:

```csharp
int? y = 5;
Console.WriteLine(y ?? 0 + 10);    // 5, parsed as y ?? (0 + 10)
Console.WriteLine((y ?? 0) + 10);  // 15
```

`??=` assigns only when the left side is `null`, and `?? throw` turns a missing
value into an exception in one expression. Because `?.` reads the receiver
exactly once, `Handler?.Invoke(...)` is the standard thread-safe way to raise an
event: a concurrent unsubscribe cannot make the copy it already read `null`.

### Null-conditional assignment (C# 14)

Before C# 14, `?.` and `?[]` could only read. Now they can be the target of
`=` and of every compound assignment, including `??=`. The key rule, stated in
the language reference and the feature specification, is that the right side
is evaluated only when the receiver is not `null`. This program shows it with
a counter:

```csharp
int calls = 0;
int Next() { calls++; return 42; }

Customer? none = null;
Customer some = new() { Name = "Ana" };

none?.Age = Next();       // calls = 0: Next() never ran
some?.Age = Next();       // Age = 42, calls = 1
some?.Age += 1;           // compound assignment: Age = 43
none?.Age += Next();      // still calls = 1
some?.Nickname ??= "Aninha";
some?.Nickname ??= "ignored";   // Nickname stays "Aninha"

int[]? arr = null;
arr?[0] = Next();                       // element access works too
Dictionary<string, int>? dict = new();
dict?["a"] = 1;                         // and indexers

Order? order = new() { Customer = null };
order?.Customer?.Name = "nobody";       // chain stops at the null Customer

Button? button = new();
button?.Clicked += () => Console.WriteLine("clicked");   // event subscription
```

The receiver is evaluated once: `GetCustomer()?.Age += 10` calls
`GetCustomer()` a single time, even though a compound assignment reads and
writes the property.

When the assignment is used as a value, its type is the nullable version of the
assigned type, and it is `null` when nothing was written:

```csharp
int? r1 = none?.Age = 5;   // null
int? r2 = some?.Age = 5;   // 5
```

### What does not compile

The feature keeps `a?.b` as a non-variable: you can assign through it, but not
take a reference to it. These are the errors the .NET 10.0.100 SDK reports:

```csharp
h?.Count++;                       // CS1059: The operand of an increment or decrement
--h?.Count;                       //   operator must be a variable, property or indexer
int.TryParse("1", out h?.Field);  // CS1510: A ref or out value must be an assignable variable
ref int r = ref h?.Field;         // CS1510 (same message)
(h?.Count, h?.Field) = (1, 2);    // CS0131: The left-hand side of an assignment must be
                                  //   a variable, property or indexer
Point p = default;                // Point is a struct
p?.X = 1;                         // CS0023: Operator '?' cannot be applied to operand of type 'Point'
Point? np = null;
np?.X = 1;                        // CS0131: np.Value is a copy, not a variable

static void Use<T>(Box<T>? c, T t)
{
    c?.Value = t;                 // fine as a statement
    (c?.Value = t).ToString();    // CS8978: 'T' cannot be made nullable.
}
```

So: no `++`/`--`, no `ref`/`out`, no deconstruction targets, no value-type
receivers, and an unconstrained generic result cannot be used as a value. With
`<LangVersion>13</LangVersion>` the plain assignment is rejected with CS9260,
"Feature 'null conditional assignment' is not available in C# 13.0".

### What the compiler emits

For a statement, the specification defines `P?.A = B` as
`if (P is not null) P.A = B;` with `P` evaluated once, and the IL matches. This
method:

```csharp
static void Set(Customer? c, int age) => c?.Age = Compute(age);
```

compiles to a test of `c` (`brtrue`) that jumps over the block containing the
call to `Compute` and to `set_Age`. There is no temporary object, no exception
handling, and no cost beyond the branch you would have written by hand. When the
expression is used as a value, the generated code builds a `Nullable<int>`
local, exactly as `(P is null) ? (int?)null : (P.A = B)` would.

### Interaction with nullable reference types

The flow analysis treats a `?.` on a variable as a hint that the variable may be
`null`. If the variable was non-nullable, the next plain dereference warns:

```csharp
static void Rename(Customer customer)          // non-nullable parameter
{
    customer?.Name = "Ana";                     // compiles, no warning
    Console.WriteLine(customer.Name.Length);    // warning CS8602: Dereference of a
}                                               //   possibly null reference.
```

The fix is not to add `!`, but to drop the `?.` where `null` is impossible. The
right side is still checked against the target: `customer?.Name = null` on a
non-nullable `string Name` gives CS8625.

## Trade-offs

- **A silent no-op can hide a bug.** `order?.Status = Shipped` does nothing when
  `order` is `null`, and nothing tells you. Use it only when a missing receiver
  is a normal case; when it is a bug, let the plain `.` throw.
  ```csharp
  order.Status = Status.Shipped;    // a null order is a defect: fail loudly
  ```
- **The right side may never run.** That saves work, but a side effect placed
  there (logging, a counter, `GenerateId()`) disappears with the null receiver.
  Compute it first if it must always happen.
- **`?.` spreads nullability.** Every `?.` on a non-nullable variable tells the
  analyzer it may be `null`, producing CS8602 warnings further down. Use it
  where null is real, not defensively.
- **`??=` is not atomic.** It is a read followed by a write, so two threads can
  both see `null` and both initialize. Use `Lazy<T>` or
  `Interlocked.CompareExchange` for shared state.
  ```csharp
  Interlocked.CompareExchange(ref _cache, Load(), null);
  ```
- **Lifted comparisons and precedence read wrong.** `x?.Length < 2` is `false`
  for `null`, and `a ?? b + c` adds before coalescing. Parenthesize and state
  the default with `??`.
- **`&` and `|` run both sides.** Correct when both side effects must happen,
  surprising everywhere else. Default to `&&` and `||` in conditions.

## Documentation Links

- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Member access and null-conditional operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/member-access-operators) (doc)
- [Null conditional assignment, C# feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/null-conditional-assignment) (doc)
- [?? and ??= operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-coalescing-operator) (doc)
- [Boolean logical operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/boolean-logical-operators) (doc)
- [C# operators and expressions (precedence), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/) (doc)
