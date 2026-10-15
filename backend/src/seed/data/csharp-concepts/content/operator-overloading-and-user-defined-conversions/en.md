---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Operators let a type read like a built-in one: `price * quantity`, `a + b`,
`start < end`. In C# they are ordinary static methods with special names, and
the language adds a few rules on top: some operators must come in pairs, a
`checked` variant can exist next to the normal one, conversions can be
implicit or explicit, and, new in C# 14, compound assignment (`+=`) and
increment (`++`) can be declared as instance methods that mutate in place. That
last feature changes what `x += y` means for a reference type, and it is the
part most worth understanding before using it. This concept covers the
declaration rules, user-defined conversions, checked operators, the C# 14
compound assignment and instance increment operators, and the guidelines that
keep operators from surprising callers.

## Use Cases

- Value objects with arithmetic: `Money`, `Vector2`, `Fraction`.
- Domain types that wrap a primitive with a conversion: `Digit` to `byte`.
- Large mutable numeric types (buffers, tensors, big integers) where `x += y`
  should update in place instead of allocating a new result.
- Generic math: types that implement `IAdditionOperators<,,>` and friends so
  generic algorithms can use `+` on them.

## Deep Dive

### Operators are static methods

```csharp
readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money l, Money r)
    {
        if (l.Currency != r.Currency)
            throw new InvalidOperationException($"{l.Currency} vs {r.Currency}");
        return l with { Amount = l.Amount + r.Amount };
    }
    public static Money operator *(Money m, decimal k) => m with { Amount = m.Amount * k };
}

var a = new Money(10m, "EUR");
var b = new Money(2.5m, "EUR");
a + b;                              // 12.5 EUR
a * 3;                              // 30 EUR
a + new Money(1, "USD");            // InvalidOperationException: EUR vs USD
2m * a;                             // CS0019: only Money * decimal was declared
```

The compiler turns `a + b` into a call to `op_Addition(a, b)`. The rules for
the classic operators: `public static`, at least one parameter of the
containing type (CS0558 when `public static` is missing), and operand order
matters, so `decimal * Money` needs its own declaration. Operators declared on
a struct are lifted automatically to `Nullable<T>`: with `Money? none = null`,
`none + a` is `null`, not an exception.

Not overloadable: `&&` and `||` (derived from `&`, `|`, `true`, `false`),
indexing (write an indexer), `=`, `.`, `?.`, `??`, `..`, and the keyword
operators such as `is`, `as`, and `new`.

### Pairs the compiler enforces

Comparison operators come in pairs: `==` with `!=`, `<` with `>`, `<=` with
`>=`.

```csharp
class A { public static bool operator <(A l, A r) => true; }
// error CS0216: The operator 'A.operator <(A, A)' requires a matching operator '>' to also be defined

class B { /* == and != only */ }
// warning CS0660: 'B' defines operator == or operator != but does not override Object.Equals(object o)
// warning CS0661: ... does not override Object.GetHashCode()
```

The warnings matter: `==` that disagrees with `Equals` breaks dictionaries and
LINQ. A record or record struct generates `==`, `!=`, `Equals`, and
`GetHashCode` together and does not let you declare `==` yourself; the full
equality story is in Struct and Record Equality.

### User-defined conversions

```csharp
readonly struct Digit
{
    private readonly byte value;
    public Digit(byte v) => value = v <= 9 ? v : throw new ArgumentOutOfRangeException(nameof(v));
    public static implicit operator byte(Digit d) => d.value;    // always safe
    public static explicit operator Digit(byte b) => new(b);     // can throw
}

var d = new Digit(7);
byte by = d;                 // 7: implicit
int i = d;                   // 7: user-defined to byte, then standard byte to int
Digit back = (Digit)by;      // 7: explicit cast required
(Digit)(byte)12;             // ArgumentOutOfRangeException

object o = d;
o is byte;                   // False: is/as ignore user-defined conversions
(byte)o;                     // InvalidCastException: this is an unbox, not the operator
```

The documentation states the rule plainly: built-in implicit conversions never
throw and never lose information, and user-defined implicit conversions should
behave the same way; a conversion that can throw or lose data must be
explicit. Conversions are resolved at compile time from the static types, so
once a value is typed as `object` (or an interface, or a generic `T`), the
operator is not even considered. Conversions to or from an interface (CS0552)
or a base type, `object` included (CS0553), cannot be declared at all.

### Checked operators (C# 11)

`checked` and `unchecked` contexts used to affect only built-in arithmetic. A
type can now provide both behaviors:

```csharp
readonly record struct Meters(int Value)
{
    public static Meters operator +(Meters l, Meters r) => new(l.Value + r.Value);
    public static Meters operator checked +(Meters l, Meters r) => new(checked(l.Value + r.Value));
}

var big = new Meters(int.MaxValue);
unchecked(big + new Meters(1));   // Meters { Value = -2147483648 }
checked(big + new Meters(1));     // OverflowException
```

The checked form requires the regular one (otherwise CS9025), and it is allowed
on unary `++ -- -`, binary `+ - * /`, explicit conversions, and in C# 14 on
`+= -= *= /=`. The `checked` modifier does not make the body checked; write
`checked(...)` inside, as above. Project-wide checking
(`CheckForOverflowUnderflow`) and built-in overflow are covered in Numeric
Conversions, Rounding and Overflow.

### C# 14: compound assignment as an instance operator

Before C# 14, `x += y` was always `x = x + y`: the binary operator produced a
new value and the variable was reassigned. Now a type can declare the compound
form directly, as a `public`, non-static, `void` method with one parameter:

```csharp
class Buffer
{
    public static int PlusCalls;
    private readonly StringBuilder sb = new();

    public static Buffer operator +(Buffer b, string s)
    { PlusCalls++; var n = new Buffer(); n.sb.Append(b.sb).Append(s); return n; }

    public void operator +=(string s) => sb.Append(s);    // mutates this
}

var buf = new Buffer();
var alias = buf;
buf += "abc";
buf += "de";
// buf=abcde alias=abcde same=True plusCalls=0
var r = buf += "!";        // r is the same instance as buf
```

When the left side is a variable (a local, a field, an array element) and the
type declares a matching `+=`, the instance operator wins and `+` is never
called. That is the performance win the feature specification describes for
large types: no new instance, no copy. It is also a semantic change for
reference types. With only a static `+`, the same code leaves `alias` untouched:

```csharp
var imm = new ImmutableBuffer("x");   // only static operator +
var immAlias = imm;
imm += "y";
// imm=xy immAlias=x
```

Callers who learned that `+=` on a reference creates a new object now get
in-place mutation visible through every alias. Document it, and reserve it for
types that are mutable by design.

A property is not a variable, so it falls back to the binary operator and the
setter:

```csharp
holder.Buf += "p";   // calls static +, then set_Buf: a new instance, plusCalls=1
holder.Only += 1;    // only an instance += exists: CS0019
```

Because they are instance members, these operators accept `virtual`,
`abstract`, `override`, `new`, and (on structs) `readonly`: a `virtual +=`
overridden in `Derived` ran the override through a `Base` variable. On a struct, `acc += 5` on a local mutates the local
in place (two calls gave `Total` 12). The language does not check that `+` and
`+=` agree; that is on you.

### C# 14: instance ++ and --

`++` and `--` can be instance `void` operators with no parameters. Which one
runs depends on whether the result is used:

```csharp
class Counter
{
    public int Value;
    public static Counter operator ++(Counter c) => new Counter { Value = c.Value + 1 };
    public void operator ++() => Value++;
}

c++; ++c;            // statements: instance operator, Value 2, static never called
var old = c++;       // result used: static operator, old=2, c=3, different objects
```

A postfix `x++` whose value is used must return the value before the
increment, which a mutating reference type cannot produce, so the compiler uses
the static operator there; with only an instance `++` that line is CS0023.

### Operators in generic code

Generic math (C# 11) lets interfaces declare `static abstract` operators, and
`System.Numerics` exposes them (`IAdditionOperators<,,>`,
`IAdditiveIdentity<,>`, and many more). Implement them and generic algorithms
can use `+` on your type:

```csharp
static T Sum<T>(T[] xs) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T s = T.AdditiveIdentity;
    foreach (var x in xs) s += x;
    return s;
}
Sum([new Meters(1), new Meters(2), new Meters(3)]);   // Meters { Value = 6 }
```

Constraints and static abstract members are covered in Generics: Constraints
and Variance.

## Trade-offs

- **Readable math, hidden calls.** `a + b` hides a method that can allocate or
  throw. Keep operators cheap, total where possible, and consistent with the
  named methods (`Add`, `Multiply`) that languages without operators will call.
- **Surprise is the main risk.** An operator must do what the symbol means for
  numbers. `+` on `Money` with different currencies should throw, not convert
  silently, and `+` should never mutate an operand.
- **Implicit conversions spread.** Every implicit conversion widens overload
  resolution and can make calls ambiguous or pick an unexpected overload. Make
  anything that can fail or lose precision explicit.
- **Compound assignment operators change aliasing.** In-place `+=` on a class
  is visible through every reference:
  ```csharp
  var alias = buf; buf += "x";   // alias sees "x" too
  ```
  Use them for mutable, performance-sensitive types, and keep immutable types
  on the static operator.
- **Two code paths to keep in sync.** `+` and `+=`, `++` static and instance,
  checked and unchecked: the compiler checks presence, never consistency. Test
  both paths with the same inputs.
- **Equality operators come with a contract.** `==` without `Equals` and
  `GetHashCode` compiles with warnings and breaks hashing; prefer records.

## Documentation Links

- [Operator overloading, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/operator-overloading) (doc)
- [User-defined explicit and implicit conversion operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/user-defined-conversion-operators) (doc)
- [Arithmetic operators: user-defined checked operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators#user-defined-checked-operators) (doc)
- [User-defined compound assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/user-defined-compound-assignment) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Generic math, .NET fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
