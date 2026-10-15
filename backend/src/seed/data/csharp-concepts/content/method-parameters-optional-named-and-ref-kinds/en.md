---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A method signature is a contract with two sides, and C# moves some of the work
to the caller's side at compile time. Optional parameters are filled in by the
caller's compiler, so changing a default does not reach code that was already
compiled. Overload resolution picks a method by comparing conversions, with
tie-breakers that surprise people. And the ref kinds (`ref`, `out`, `in`,
`ref readonly`) decide whether the callee sees a copy, a writable alias, or a
read-only alias, with hidden defensive copies when a struct is not `readonly`.
This concept covers those rules with experiments, including a real binary
break and the IL that explains it.

## Use Cases

- Adding a parameter to a public method without breaking existing callers.
- Making a call with several booleans or numbers readable at the call site.
- Choosing between overloads and optional parameters when designing an API.
- Passing large structs without copying them, and without letting the callee
  modify them.
- Returning more than one value from a `TryX` style method.

## Deep Dive

### Optional parameters are baked into the caller

A parameter with a default value (`int timeoutSeconds = 30`) is marked
`[opt]` in metadata and its default is stored as a constant. When a caller
omits the argument, the caller's compiler reads that constant and emits it
into the call. The callee never "applies" the default at run time. That leads
to a binary break, which this experiment reproduces with a class library and
a console app that references the compiled DLL:

```csharp
// Lib v1 (v2 only changes the default to 5)
public static string Get(string url, int timeoutSeconds = 30) => $"GET {url} with timeout {timeoutSeconds}s";
// App
Console.WriteLine(Lib.Http.Get("/orders"));
```

```text
v1 lib, app built against v1:          GET /orders with timeout 30s
v2 lib dropped in, app NOT rebuilt:    GET /orders with timeout 30s
app rebuilt against v2:                GET /orders with timeout 5s
```

The IL of the rebuilt app, read with `ilspycmd -il`, shows why: the argument
is a literal in the caller, and the library only carries metadata.

```text
// App.dll, <Main>$
IL_0000: ldstr "/orders"
IL_0005: ldc.i4.5
IL_0006: call string [Lib]Lib.Http::Get(string, int32)

// Lib.dll, Get
[opt] int32 timeoutSeconds
.param [2] = int32(5)
```

So a default value is part of the public contract, just like a `const`. In a
library that others compile against, treat changing it as a breaking change,
or use an overload whose body supplies the value, which is resolved at run
time.

### Named arguments

Named arguments let the call site say what each value means and skip optional
parameters in the middle. Since C# 7.2 a named argument can also appear before
positional ones, as long as it is in its correct position:

```csharp
static void Send(string to, string subject = "(none)", string body = "") => ...

Send(to: "ana", body: "hi");             // to=ana subject=(none) body=hi
Send("ana", subject: "re", "hello");     // to=ana subject=re body=hello
```

The parameter names become part of the contract too: renaming a parameter
breaks every caller that used the name, at compile time.

### Overload resolution in practice

The compiler collects the applicable candidates and picks the one whose
parameter types are the best conversion for each argument. A few results from
the same run:

```csharp
static void Show(long x)   { }
static void Show(double x) { }
Show(5);     // Show(long): int -> long is better than int -> double
Show(5f);    // Show(double): the only candidate that accepts a float

static void Pick(int a) { }
static void Pick(int a, int b = 0) { }
Pick(1);     // Pick(int): on a tie, the candidate with no omitted optionals wins
Pick(1, 2);  // Pick(int, int = 0)

static void Box(object? o) { }
static void Box(string? s) { }
Box(null);   // Box(string): string converts to object, so it is more specific

static void Sum(params int[] xs) { }
static void Sum(params ReadOnlySpan<int> xs) { }
Sum(1, 2, 3); // Sum(params ReadOnlySpan<int>)
```

The last case is C# 13 `params` collections, covered in the collection
interfaces concept: when both exist, the span overload wins and avoids the
array allocation. Mixing overloads and optional parameters in the same method
group is what makes resolution hard to predict; pick one style per method
name.

### `ref`, `out`, `in`, and `ref readonly`

By default an argument is passed by value: the callee gets a copy of the
value (for a class, a copy of the reference). The ref kinds pass an alias to
the caller's variable instead:

| Modifier | Callee can read | Callee can write | Caller must pass | Since |
|---|---|---|---|---|
| `ref` | yes | yes | an assigned variable, with `ref` | C# 1 |
| `out` | after assigning | must assign before returning | a variable, with `out` | C# 1 |
| `in` | yes | no | a variable, or any value (a temporary is created) | C# 7.2 |
| `ref readonly` | yes | no | a variable, with `ref` or `in` | C# 12 |

`out` pairs with `out var` declarations and discards: `int.TryParse(s, out _)`
checks a string without keeping the number.

`in` and `ref readonly` both mean "read-only alias", but `in` happily accepts
an rvalue and silently copies it into a temporary, while `ref readonly` asks
for a real variable. The compiler warns when that intent is not met:

```csharp
static void PeekReadonly(ref readonly Counter c) { }
static void PeekValue(ref readonly int v) { }

PeekReadonly(new Counter()); // warning CS9193: Argument 1 should be a variable because it is passed to a 'ref readonly' parameter
int x = 3;
PeekValue(x);                // warning CS9192: Argument 1 should be passed with 'ref' or 'in' keyword
PeekValue(in x);             // fine
```

The reference documentation sums it up: when the API requires the argument to
be passed by reference (it is meant to alias a real location, not a
temporary), choose `ref readonly`; when the goal is only to avoid copying a
large value, `in` is enough. None of the ref kinds can be used in `async` or
iterator methods (errors CS1988 and CS1623): their parameters are hoisted into
a state machine object on the heap, and a reference to a caller's variable
cannot be stored there.

### Defensive copies

A read-only alias to a mutable struct has a problem: calling a method on it
might mutate it. The compiler cannot know whether `Increment()` writes, so it
calls the method on a hidden copy:

```csharp
struct Counter { public int Value; public void Increment() => Value++; }

static void Peek(in Counter c)
{
    c.Increment();                 // compiles, but runs on a copy
    Console.WriteLine(c.Value);    // 1: the value it had before the call
}
```

That is a correctness surprise (the call does nothing) and a performance one
(the copy is exactly what `in` was supposed to avoid). Declaring the struct
`readonly struct`, or marking individual members `readonly`, tells the
compiler no copy is needed. Pass large structs with `in` only when they are
`readonly`.

## Trade-offs

- **Optional parameters versus overloads.** Optionals keep the surface small
  and calls readable, but their values are compiled into callers. Overloads
  carry their defaults inside the library, which is safer for public packages.
  ```csharp
  public static string Get(string url) => Get(url, timeoutSeconds: 30); // default lives here
  public static string Get(string url, int timeoutSeconds) => ...;
  ```
- **Named arguments make parameter names public.** Readable calls, at the cost
  of never renaming a parameter in a published API.
- **`in` is not free.** For small values, passing by value is simpler and just
  as fast (the reference itself notes there is no gain for a single `int`);
  for mutable structs it adds defensive copies.
- **`out` versus a returned tuple or record.** `TryX(out T)` composes with
  `if`; a tuple is clearer when every output always has a value.
- **Boolean parameters hide intent.** `Export(true, false)` needs named
  arguments or, better, an enum or options type.

## Documentation Links

- [Method parameters and modifiers, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters) (doc)
- [Named and optional arguments, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/named-and-optional-arguments) (doc)
- [What's new in C# 12: ref readonly parameters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
- [Structure types: readonly struct, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [Overload resolution, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1264-overload-resolution) (doc)
