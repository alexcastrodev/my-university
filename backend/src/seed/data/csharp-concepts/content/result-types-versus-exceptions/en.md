---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

C# has one built-in way to report failure: throw. The BCL adds a second for
cheap, expected failures (`TryParse`, `TryGetValue`). Many application
codebases add a third: a method that returns either a value or an error
object, usually called `Result<T>`. This concept compares the three on the
axes that decide the choice (which failures are expected, what the caller is
forced to see, cost, composition, diagnostics), builds a small `Result<T>`
with the traps a hand-written one has, maps it to HTTP `ProblemDetails`, and
shows what two popular libraries (OneOf and ErrorOr) look like. The mechanics
of `throw` and `catch` are in `exceptions-try-catch-filters-and-finally`, guard
clauses in `guard-clauses-throwing-and-rethrowing`, and the `Try` pattern in
`parsing-tryparse-and-the-try-pattern`.

## Use Cases

- Deciding how an application service reports "not found", "invalid input" and
  "conflict" to its caller.
- Mapping domain failures to HTTP status codes without a global exception
  handler full of special cases.
- Chaining several steps that can each fail (validate, load, check, save)
  without nested `if` blocks.
- Reviewing a pull request that adds a `Result<T>` type or a library for it.

## Deep Dive

Output is from .NET 10 (SDK 10.0.100) on arm64. Libraries: OneOf 3.0.271 and
ErrorOr 2.1.1 from NuGet.

### Three kinds of failure

The decision starts with the kind of failure, not with a style preference:

| Kind | Example | Usual mechanism |
|---|---|---|
| Usage error (a bug) | null argument, negative quantity from code | exception (`ArgumentException` family) |
| Expected outcome | product not found, stock too low, invalid form field | `Try` method, nullable return, or a result type |
| Environment failure | database down, disk full, timeout | exception |

Usage errors should fail loudly, with a stack trace, and be fixed.
Environment failures usually cannot be handled by the immediate caller, and
the exception carries them up to a place that can (a retry policy, a global
handler). The middle row is where the choice is real: the failure is part of
the business, the caller must decide what to do, and it happens often.

The Framework Design Guidelines (a 2008 reprint, marked as possibly out of
date) say "DO NOT return error codes" and "DO report execution failures by
throwing exceptions", and in the same page "DO NOT use exceptions for the
normal flow of control, if possible", recommending the tester-doer and Try
patterns. Those rules were written for reusable framework APIs. Inside an
application, the current best practices page also suggests returning `null` or
`default` for common error cases. A result type is the richer version of that
advice: a return value that also says why.

### A minimal `Result<T>`

```csharp
enum ErrorKind { Validation, NotFound, Conflict }

sealed record Error(ErrorKind Kind, string Code, string Message)
{
    public static Error Validation(string code, string msg) => new(ErrorKind.Validation, code, msg);
    public static Error NotFound(string code, string msg) => new(ErrorKind.NotFound, code, msg);
    public static Error Conflict(string code, string msg) => new(ErrorKind.Conflict, code, msg);
}

readonly struct Result<T>
{
    static readonly Error Unset = new(ErrorKind.Validation, "result.default", "default(Result<T>) has no value");
    readonly T _value;
    readonly Error? _error;
    readonly bool _ok;                         // false in default(Result<T>)

    Result(T value) { _value = value; _ok = true; }
    Result(Error error) { _value = default!; _error = error; }

    public bool IsSuccess => _ok;
    public bool IsFailure => !_ok;
    public Error? Error => _ok ? null : _error ?? Unset;
    public T Value => _ok ? _value : throw new InvalidOperationException($"no value: {Error!.Code}");

    public static Result<T> Ok(T value) => new(value);
    public static Result<T> Fail(Error error) => new(error);
    public static implicit operator Result<T>(T value) => new(value);
    public static implicit operator Result<T>(Error error) => new(error);

    public Result<U> Bind<U>(Func<T, Result<U>> next) => _ok ? next(_value) : Error!;
    public Result<U> Map<U>(Func<T, U> f) => _ok ? f(_value) : Error!;
    public R Match<R>(Func<T, R> ok, Func<Error, R> fail) => _ok ? ok(_value) : fail(Error!);
}
```

Three decisions in this code are easy to get wrong:

- **`default` must not be a success.** The first version of this struct
  computed `IsSuccess => Error is null`. Then `Result<int> d = default;`
  reported `IsSuccess=True` with `Value` 0, a success nobody produced. With an
  explicit `_ok` flag, `default` is a failure: `IsSuccess=False`,
  `Error=result.default`, and `d.Value` throws
  `InvalidOperationException: no value: result.default`. (A `class` avoids
  `default` but allocates on every success.)
- **`Value` on a failure throws.** Reading the value without checking is a
  bug, so it is an exception, exactly like `Nullable<T>.Value`.
- **Implicit conversions keep call sites short.** `return qty;` and
  `return Error.NotFound(...);` both compile to a `Result<int>`, and a
  conditional `?:` with one branch of each kind is target-typed to it.

### Composing steps

`Bind` runs the next step only when the previous one succeeded, so a chain
stops at the first failure without any `if`:

```csharp
Result<int> ValidateQty(int qty) => qty > 0 ? qty : Error.Validation("qty.invalid", "quantity must be positive");
Result<int> FindStock(string sku) => catalog.TryGetValue(sku, out var s) ? s : Error.NotFound("product.missing", $"no product {sku}");

Result<int> PlaceOrder(string sku, int qty) =>
    ValidateQty(qty)
        .Bind(q => FindStock(sku)
        .Bind(stock => stock >= q ? Result<int>.Ok(stock - q)
                                  : Error.Conflict("stock.short", $"only {stock} {sku} left")));

// catalog: apple = 5, pear = 0
PlaceOrder("apple", 2)   // ok, 3 left
PlaceOrder("apple", 0)   // Validation qty.invalid: quantity must be positive
PlaceOrder("kiwi", 1)    // NotFound product.missing: no product kiwi
PlaceOrder("pear", 1)    // Conflict stock.short: only 0 pear left
```

The exception version is shorter to write: three `throw` statements and no
wrapper type. What it loses is the signature. `int PlaceOrderEx(string, int)`
does not say that it can fail in three business ways; the caller learns it
from documentation or from production. With `Result<int>`, the compiler forces
the caller to unwrap. It does not force the caller to look: a discarded
`Result` compiles without a warning, while a discarded exception still stops
the flow.

Async code adds a layer: a step returns `Task<Result<T>>`, and each `await`
must be followed by the success check, so helpers multiply (`BindAsync`,
`MapAsync`). That is the moment teams usually reach for a library.

### What it costs

Release build, 100,000 calls that all fail with "not found":

```text
exceptions (throw + catch KeyNotFoundException)   221 ms    248 bytes per failure
Result<int>                                          6 ms    288 bytes per failure
```

The exception path cost about 2.2 microseconds per failure, between 35 and 100
times slower than the `Result` path across runs (the `Result` loop measured
2 to 6 ms). The gap is in time, not memory: the `Result` path allocated a
little more (the `Error` object, the interpolated message and the lambdas'
closures). The guideline page puts the threshold where it starts to matter:
"Throw rates above 100 per second are likely to noticeably impact the
performance of most applications." A login endpoint that rejects bad passwords
or an import that skips invalid rows can reach that easily.

### Results at the HTTP boundary

A result type pays off when the API layer translates it in one place. The
error kind becomes the status code, and the body is a `ProblemDetails`:

```csharp
static IResult ToHttp<T>(Result<T> result) => result.Match(
    value => Results.Ok(value),
    error => Results.Problem(
        statusCode: error.Kind switch
        {
            ErrorKind.Validation => StatusCodes.Status400BadRequest,
            ErrorKind.NotFound => StatusCodes.Status404NotFound,
            ErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status500InternalServerError,
        },
        title: error.Code,
        detail: error.Message));

app.MapPost("/orders/{sku}/{qty:int}", (string sku, int qty) => ToHttp(Reserve(sku, qty)));
```

```text
POST /orders/apple/2  -> 200  3
POST /orders/kiwi/1   -> 404  {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"product.missing","status":404,"detail":"no product kiwi"}
POST /orders/apple/9  -> 409  {"type":"...#section-15.5.10","title":"stock.short","status":409,"detail":"only 5 left"}
POST /orders/apple/0  -> 400  {"type":"...#section-15.5.1","title":"qty.invalid","status":400,"detail":"quantity must be positive"}
```

The alternative is to throw domain exceptions and convert them in an
`IExceptionHandler` (see `problem-details-and-global-exception-handling`).
Both work; the global handler keeps use cases free of a wrapper type, and the
result keeps expected failures out of the exception path and visible in the
use case signature (`clean-architecture-in-four-projects` uses a per-use-case
result with a status enum, a lighter variant of the same idea).

The switch above needs the `_` arm. C# has no closed union type yet: even an
abstract record with a private constructor and two sealed nested records gives
CS8509 ("The switch expression does not handle all possible values of its
input type") when both subtypes are matched, because the compiler does not
treat the hierarchy as closed.

### OneOf and ErrorOr

Two NuGet packages cover most of what teams hand-write.

OneOf models "one of these types". The failure is a type, and `Match` takes
one lambda per case:

```csharp
OneOf<int, NotFound> Find(string sku) => stock.TryGetValue(sku, out var s) ? s : new NotFound();

Find("apple").Match(s => $"{s} in stock", _ => "not found")   // 5 in stock
Find("kiwi").Match(s => $"{s} in stock", _ => "not found")    // not found
```

ErrorOr models "a value or a list of errors", with predefined error types and
`Then` for chaining:

```csharp
ErrorOr<int> Find(string sku) => stock.TryGetValue(sku, out var s) ? s : Error.NotFound("product.missing", $"no product {sku}");
ErrorOr<int> Reserve(string sku, int qty) =>
    Find(sku).Then(s => s >= qty ? (ErrorOr<int>)(s - qty) : Error.Conflict("stock.short", $"only {s} left"));

Reserve("apple", 2)   // 3 left, IsError=False
Reserve("apple", 9)   // Conflict stock.short: only 5 left, IsError=True
Reserve("kiwi", 1)    // NotFound product.missing: no product kiwi, IsError=True
```

## Trade-offs

- **Visibility versus ceremony.** A `Result<T>` return type documents
  expected failures in the signature and makes the caller unwrap. Every layer
  then carries the wrapper, including code paths that cannot fail in practice.
- **Exceptions keep the stack trace; results keep the flow.** An `Error`
  record has no stack trace and no inner exception, so a result is the wrong
  carrier for an unexpected failure that someone must debug. Never catch
  `Exception` just to turn it into a `Result`.
- **Speed matters only at high failure rates.** 2 microseconds per throw is
  irrelevant for a rare "not found" and real for a validation endpoint under
  load. Measure the failure rate before rewriting for performance.
- **Hand-written versus library.** A 40-line `Result<T>` is easy to own but
  easy to get subtly wrong (`default` as success, no async helpers). A library
  brings tested combinators and a dependency that every project layer now
  references.
- **A result can be ignored silently.** Calling `Save(order);` and dropping
  the returned `Result` compiles. An exception cannot be ignored by accident.
  Code review, or an analyzer the team adds, has to cover this.
- **Mixing styles is the real risk.** A codebase where some use cases throw
  `NotFoundException` and others return `Error.NotFound` needs two
  translations at the boundary. Pick one convention per layer and write it
  down.

## Documentation Links

- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [Exception throwing, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exception-throwing) (doc)
- [Exceptions and performance, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions-and-performance) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [Results.Problem method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.results.problem) (doc)
- [OneOf on GitHub](https://github.com/mcintyre321/OneOf) (doc)
- [ErrorOr on GitHub](https://github.com/amantinband/error-or) (doc)
