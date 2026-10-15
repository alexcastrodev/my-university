---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Lambdas and local functions look like small syntax features, but the compiler
does real work behind them: it moves captured variables into a generated class
or struct, rewrites every use of those variables, and decides whether a
delegate can be cached or has to be allocated on every call. This concept
reads that lowering in the IL, measures what each form allocates, and covers
the newer lambda features: natural types and explicit return types (C# 10),
default parameter values (C# 12), and parameter modifiers without explicit
types (C# 14). It ends with when to choose a local function over a lambda.

## Use Cases

- Writing a helper that only one method needs, without widening the class.
- Passing behavior to LINQ, events, or callbacks without allocating on a hot
  path.
- Validating arguments eagerly in an iterator or async method, with the real
  work in a local function.
- Declaring a lambda with `var` and a default argument, or a lambda for a
  delegate with `out` parameters, without spelling every type.
- Diagnosing a memory leak that a long-lived delegate keeps alive.

## Deep Dive

### What the compiler generates

Take three ways of applying a factor to a list:

```csharp
public static int Capturing(int[] items, int factor)
{
    Func<int, int> scale = x => x * factor;        // captures 'factor'
    ...
}
public static int NonCapturing(int[] items)
{
    Func<int, int> twice = x => x * 2;             // captures nothing
    ...
}
public static int LocalFunction(int[] items, int factor)
{
    ...
    int Scale(int x) => x * factor;                // captures, never becomes a delegate
}
```

Decompiling the compiled DLL with `ilspycmd -lv CSharp1` (a C# 1 view that
cannot express lambdas, so it shows the lowered code) gives, trimmed:

```csharp
private sealed class <>c__DisplayClass0_0         // the closure for Capturing
{
    public int factor;
    internal int <Capturing>b__0(int x) => x * factor;
}

private sealed class <>c                          // non-capturing lambdas
{
    public static readonly <>c <>9 = new <>c();
    public static Func<int, int> <>9__1_0;        // cached delegate
    internal int <NonCapturing>b__1_0(int x) => x * 2;
}

private struct <>c__DisplayClass2_0               // a struct, for the local function
{
    public int factor;
}

public static int Capturing(int[] items, int factor)
{
    <>c__DisplayClass0_0 obj = new <>c__DisplayClass0_0();
    obj.factor = factor;
    Func<int, int> func = new Func<int, int>(obj.<Capturing>b__0);
    ...
}

public static int NonCapturing(int[] items)
{
    Func<int, int> func = <>c.<>9__1_0 ?? (<>c.<>9__1_0 = new Func<int, int>(<>c.<>9.<NonCapturing>b__1_0));
    ...
}

public static int LocalFunction(int[] items, int factor)
{
    <>c__DisplayClass2_0 obj = default;
    obj.factor = factor;
    ... num += <LocalFunction>g__Scale|2_0(x, ref obj);
}
```

The IL of `Capturing` confirms two allocations before any work happens:

```text
IL_0000: newobj instance void Demo/'<>c__DisplayClass0_0'::.ctor()
IL_0008: stfld int32 Demo/'<>c__DisplayClass0_0'::factor
IL_000e: ldftn instance int32 Demo/'<>c__DisplayClass0_0'::'<Capturing>b__0'(int32)
IL_0014: newobj instance void class System.Func`2<int32, int32>::.ctor(object, native int)
```

Three facts come out of this. A captured variable is no longer a local: it is a
field of the display class, and every read and write in the method goes
through that field, which is why closures see later changes (the LINQ deferred
execution concept shows the bug this causes). A lambda that captures nothing
becomes an instance method on a singleton, and its delegate is created once and
cached in a static field. A local function that is only called directly gets
its captures in a struct passed by `ref`, so nothing goes to the heap.

### Measured allocations

`GC.GetAllocatedBytesForCurrentThread()` around 1,000 calls of each method
(.NET 10, arm64, after one warm-up call):

| Form | Bytes per call |
|---|---|
| lambda capturing a local | 88 (display class plus delegate) |
| lambda capturing nothing | 0 (cached delegate) |
| local function capturing | 0 (struct closure on the stack) |
| implicit conversion of a static method group, `Func<int, int> f = Double;` | 0 |
| explicit `new Func<int, int>(Double)` | 64 |

The method group row is a C# 11 change: the compiler now caches the delegate
for a static method group, as it does for non-capturing lambdas. Writing
`new Func<...>(...)` explicitly opts out of the cache.

### The allocation happens where the scope starts

The display class is created when the scope of the captured variable is
entered, not when the lambda runs. For a parameter, that is the start of the
method:

```csharp
static int Sum(int[] items, int factor)
{
    if (items.Length == 0) return 0;               // the fast path still pays
    return items.Select(x => x * factor).Sum();
}
// Sum([], 3) allocates 24 bytes per call
```

When the fast path matters, move the capturing code into a separate method
or a local function, so the closure is only built on the path that uses it.

### One closure per scope, shared by all lambdas

All lambdas in the same scope share one display class. A short-lived lambda
and a long-lived one therefore keep each other's captures alive:

```csharp
public static Func<int> Make(byte[] big, int small)
{
    Func<int> a = () => big.Length;     // used once, here
    Console.WriteLine(a());
    return () => small;                 // returned and stored
}
// lowered: one <>c__DisplayClass0_0 with fields 'big' and 'small'
```

The returned delegate only reads `small`, but it holds the display class, which
holds `big`. This is a classic source of leaks in event handlers and caches.

### `static` lambdas and local functions

Adding `static` (lambdas since C# 9, local functions since C# 8) forbids
captures, so an accidental allocation becomes a compile error:

```csharp
int factor = 3;
Func<int, int> f1 = static x => x * factor;
// error CS8820: A static anonymous function cannot contain a reference to 'factor'.
static int StaticLocal(int x) => x * factor;
// error CS8421: A static local function cannot contain a reference to 'factor'.
```

Use `static` on lambdas in hot paths and in libraries; pass the needed state
through an overload that takes a `state` argument when the API offers one.

### Lambda types, return types, and defaults

Since C# 10 a lambda has a natural type when its parameter types are known, so
`var` works. C# 10 also allows an explicit return type, and C# 12 allows
default parameter values, in which case the natural type is a compiler
synthesized delegate instead of `Func`:

```csharp
var square = (int x) => x * x;               // Func`2
var choose = object (bool b) => b ? 1 : "one";
var inc = (int x, int by = 1) => x + by;     // <>f__AnonymousDelegate0`3
Console.WriteLine($"{inc(5)} {inc(5, 10)}"); // 6 15

var g = int.Parse;   // error CS8917: The delegate type could not be inferred.
```

An overloaded method group like `int.Parse` has no single natural type, so
`var` needs a lambda or an explicit delegate type there.

### Parameter modifiers without types (C# 14)

Before C# 14, a lambda parameter with `ref`, `out`, `in`, `ref readonly`, or
`scoped` forced explicit types on every parameter. C# 14 lets the modifier
stand alone, with the types inferred from the target delegate:

```csharp
delegate bool TryParse<T>(string text, out T result);
delegate void RefAction<T>(ref T value);

TryParse<int> p = (text, out result) => int.TryParse(text, out result);
RefAction<int> twice = (ref x) => x *= 2;
// p("17", out var v) is true, v = 17; twice(ref n) turns 21 into 42
```

With `LangVersion` 13 the same lines fail with error CS9260 "Feature 'simple
lambda parameter modifiers' is not available in C# 13.0". The `params`
modifier is the exception: `(params xs) => ...` is still error CS9272, it needs
an explicit type.

### Local functions or lambdas

A local function can be generic, recursive, an iterator or `async`, can be
called before its declaration, and can have attributes (C# 9). It cannot be
overloaded: two local functions with the same name in one method are error
CS0128. Its main practical advantage is the struct closure: as long as it is
only called, never converted to a delegate, capturing costs nothing on the
heap. The documentation adds a second condition: none of its captured
variables may also be captured by a lambda that does become a delegate,
because then both share the class closure. The guard pattern from the
previous concepts uses exactly this: a public method validates eagerly and
returns the result of an async or iterator local function.

Captured loop variables follow the same "variables, not values" rule shown in
the LINQ deferred execution concept: a `foreach` variable is a fresh variable
per iteration (the lambdas return 0, 1, 2), while a `for` counter is one
variable shared by every lambda created in the loop (3, 3, 3).

## Trade-offs

- **Lambdas are concise; local functions are cheaper when they stay local.**
  Converting a local function to a delegate (passing it to `Select`) brings
  back the class closure and the allocation.
- **Captures hide state.** A lambda that captures five variables is a class
  with five fields that nobody declared. Pass values as parameters when the
  closure would be large or long-lived.
- **`static` lambdas trade convenience for guarantees.** They force state to
  be passed explicitly, which is more code and no hidden allocation.
  ```csharp
  cache.GetOrAdd(key, static (k, arg) => Load(k, arg), factor);
  ```
- **Shared display classes extend lifetimes.** A delegate stored in an event
  or a static field keeps every variable captured by any lambda in its scope.
- **Type inference has edges.** Overloaded method groups have no natural type,
  and `params` still needs explicit lambda parameter types even in C# 14.

## Documentation Links

- [Lambda expressions and anonymous functions, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions) (doc)
- [Local functions, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/local-functions) (doc)
- [What's new in C# 14: simple lambda parameters with modifiers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Simple lambda parameters with modifiers, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/simple-lambda-parameters-with-modifiers) (doc)
- [Lambda improvements, C# 10 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-10.0/lambda-improvements) (doc)
- [C# language version history, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
