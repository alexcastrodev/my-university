---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The previous concept explained how the runtime finds a handler. This one is
about the other end: deciding when a method should throw, how to write the
checks at the top of a method so they are short and produce good messages, and
how to rethrow without destroying the information a stack trace carries. It
covers usage errors versus execution errors, the `ThrowIf` helper family,
`CallerArgumentExpression` for your own guards, why throw helpers make the hot
path faster (shown in JIT output), `[DoesNotReturn]` and the nullable analysis,
the async trap where a guard does not throw at the call, and `throw;` versus
`throw ex;` versus wrapping.

## Use Cases

- Rejecting a `null`, empty, negative, or out-of-range argument in one line with
  a message that names the exact expression.
- Writing a reusable guard for a domain rule that reports which argument broke
  it.
- Keeping a small, frequently called method inlinable even though it validates
  its input.
- Adding context to a low-level failure without losing the original cause.
- Making an async API fail at the call site instead of at the `await`.

## Deep Dive

### Usage errors and execution errors

Two kinds of failure deserve different treatment. A **usage error** is a bug in
the caller: passing `null` where a value is required, an index past the end,
calling `Read` on a disposed stream. The exception (`ArgumentException`,
`ArgumentNullException`, `ArgumentOutOfRangeException`,
`InvalidOperationException`, `ObjectDisposedException`) exists to be seen by a
developer and fixed in the code, not caught and handled. An **execution error**
comes from the world: a missing file, a dropped connection, a timeout. Those
(`IOException`, `HttpRequestException`, `TimeoutException`) are the ones a
program catches, at the level that can retry, fall back, or report.

That split answers "where do I catch?". Usage errors propagate to the top-level
handler (an ASP.NET Core error middleware, a worker's loop) where they are
logged as bugs. Execution errors are caught at a boundary that has enough
context to act: the repository that can retry, the endpoint that can return a
503. Catching in every method adds noise and usually swallows information.

Some types are reserved for the runtime. Never throw `NullReferenceException`,
`IndexOutOfRangeException`, `AccessViolationException`, or
`StackOverflowException` yourself (code analysis rule CA2201), and do not throw
the bare `Exception` or `SystemException`, which no caller can catch
selectively.

### The `ThrowIf` family

Guard clauses used to be four lines each. The BCL now has static helpers that
check and throw:

| Helper | Since |
|---|---|
| `ArgumentNullException.ThrowIfNull` | .NET 6 |
| `ArgumentException.ThrowIfNullOrEmpty` | .NET 7 |
| `ObjectDisposedException.ThrowIf` | .NET 7 |
| `ArgumentException.ThrowIfNullOrWhiteSpace` | .NET 8 |
| `ArgumentOutOfRangeException.ThrowIfNegative`, `ThrowIfZero`, `ThrowIfNegativeOrZero`, `ThrowIfEqual`, `ThrowIfNotEqual`, `ThrowIfLessThan`, `ThrowIfGreaterThan`, `ThrowIfLessThanOrEqual`, `ThrowIfGreaterThanOrEqual` | .NET 8 |

The range helpers are generic: `ThrowIfNegative` and `ThrowIfZero` accept any
`INumberBase<T>`, and the comparison ones (`ThrowIfLessThan`,
`ThrowIfGreaterThan`, ...) any `IComparable<T>`, so they also work for
`DateTime` and your own comparable types. None of them asks for the parameter
name, yet the messages contain the whole expression (invariant culture):

```csharp
static void Place(Order order)
{
    ArgumentNullException.ThrowIfNull(order);
    ArgumentNullException.ThrowIfNull(order.Customer);
    ArgumentException.ThrowIfNullOrWhiteSpace(order.Customer.Email);
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(order.Quantity);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(order.Discount, 0.5m);
}
// Value cannot be null. (Parameter 'order.Customer')
// The value cannot be an empty string or composed entirely of whitespace. (Parameter 'order.Customer.Email')
// order.Quantity ('0') must be a non-negative and non-zero value. (Parameter 'order.Quantity')
// Actual value was 0.
// order.Discount ('0.7') must be less than or equal to '0.5'. (Parameter 'order.Discount')
// Actual value was 0.7.
```

The analyzers CA1510 to CA1513 point at hand-written checks that one of these
helpers can replace.

### `CallerArgumentExpression` for your own guards

The trick behind those messages is a C# 10 attribute. A parameter marked
`[CallerArgumentExpression(nameof(value))]` receives, at compile time, the
source text of the argument passed for `value`. The parameter must be optional,
and the compiler fills it in when the caller omits it:

```csharp
static T NotDefault<T>([NotNull] T? value,
    [CallerArgumentExpression(nameof(value))] string? expr = null)
{
    if (value is null || EqualityComparer<T>.Default.Equals(value, default!))
        throw new ArgumentException($"'{expr}' must not be null or default.", expr);
    return value;
}

var id = Guid.Empty;
NotDefault(id);   // ArgumentException: 'id' must not be null or default. (Parameter 'id')
```

`[NotNull]` tells the nullable analysis that, if the method returns, `value`
was not `null`, so callers do not need a `!` afterwards.

### `throw` expressions

Since C# 7.0, `throw` can be an expression, which keeps simple guards inside
an assignment or a conditional:

```csharp
_name = name ?? throw new ArgumentNullException(nameof(name));
string first = args.Length > 0 ? args[0] : throw new ArgumentException("No arguments.");
```

### Throw helpers and inlining

A `throw new X($"...")` is a lot of IL: building the message, calling the
constructor, the `throw` itself. That code lives in the method even though it
almost never runs, and it makes the method bigger to inline. Moving it to a
separate method marked `[DoesNotReturn]` shrinks the caller:

```csharp
static int GetInline(int[] a, int i)
{
    if ((uint)i >= (uint)a.Length)
        throw new ArgumentOutOfRangeException(nameof(i), i, $"Index must be below {a.Length}.");
    return a[i];
}

static int GetHelper(int[] a, int i)
{
    if ((uint)i >= (uint)a.Length) ThrowIndex(i, a.Length);
    return a[i];
}

[DoesNotReturn]
static void ThrowIndex(int i, int length) =>
    throw new ArgumentOutOfRangeException(nameof(i), i, $"Index must be below {length}.");
```

With optimizations on, `GetInline` is 78 bytes of IL and `GetHelper` 19. The JIT
output for a caller that uses each twice (.NET 10, arm64, tiered compilation
off so the first compile is fully optimized) shows the difference: the caller of
`GetInline` makes two real calls to it, while the caller of `GetHelper` has the
bounds checks and loads inlined, and the two calls to `ThrowIndex` sit in
separate blocks at the end, each followed by `brk #0`, because the JIT knows
they never return. This is the pattern the BCL uses in `ThrowHelper` classes.
It matters for small methods on hot paths; for an ordinary service method, a
plain `throw` is fine.

### `[DoesNotReturn]` and the nullable analysis

The attribute also informs the compiler. Without it, a helper that always
throws looks like any other call:

```csharp
static int LenA(string? s)
{
    if (s is null) FailPlain(nameof(s));
    return s.Length;   // warning CS8602: Dereference of a possibly null reference.
}

static int LenB(string? s)
{
    if (s is null) Fail(nameof(s));   // Fail is [DoesNotReturn]
    return s.Length;   // no warning
}
```

### Guards in async methods and iterators

An `async` method stores every exception in the returned `Task`, including the
ones from its first line. The guard runs, but the caller sees nothing until it
awaits:

```csharp
static async Task SaveAsync(string path)
{
    ArgumentNullException.ThrowIfNull(path);
    await Task.Delay(10);
}

Task t1 = SaveAsync(null!);   // no exception here; t1.Status is Faulted
```

To fail at the call, split the method: a non-async outer method validates and
returns the task of an async local function.

```csharp
static Task SaveEagerAsync(string path)
{
    ArgumentNullException.ThrowIfNull(path);   // throws at the call
    return Core();

    async Task Core() => await Task.Delay(10);
}
```

Iterator methods have the same problem for the same reason (the body does not
run until enumeration), as the LINQ deferred execution concept shows; the fix
is the same split.

### `throw;`, `throw ex;`, and wrapping

Inside a `catch`, three ways to let the failure continue give three different
stack traces. Run against the same failing `int.Parse` two calls deep:

```csharp
catch (Exception) { throw; }
//   at System.Int32.Parse(String s)
//   at Program.<<Main>$>g__Parse|0_5(String s)
//   at Program.<<Main>$>g__Load|0_4()
//   at ... (the method with the catch)

catch (Exception ex) { throw ex; }
//   at ... (the method with the catch)        <- Parse and Load are gone

catch (Exception ex) { throw new InvalidOperationException("Loading settings failed.", ex); }
//   InvalidOperationException
//   ---> System.FormatException: The input string 'x' was not in a correct format.
//   at System.Int32.Parse(String s) ... (full original trace)
//   --- End of inner exception stack trace ---
```

`throw ex;` resets the trace to the current method, which is almost never what
you want (analyzer CA2200 flags it). `throw;` keeps it. Wrapping is right when
you add meaning ("loading settings failed") at a layer boundary, as long as the
original goes in as `innerException`. To rethrow outside the `catch` block, use
`ExceptionDispatchInfo`, covered in the previous concept.

## Trade-offs

- **Guard every public entry, not every private line.** Public and protected
  members validate; private helpers called only from validated code can trust
  their inputs. Double validation costs reading time more than CPU time.
- **Specific exceptions beat clever messages.** A caller can filter on
  `ArgumentOutOfRangeException`; it cannot filter on a sentence.
- **Wrapping adds context and depth.** Each layer that wraps makes logs longer.
  Wrap where the meaning changes (infrastructure to domain), not at every call.
  ```csharp
  catch (IOException ex) { throw new SettingsUnavailableException("Settings file is unavailable.", ex); }
  ```
- **Throw helpers trade readability for speed.** A `ThrowHelper` class pays off
  in libraries and hot paths; in application code, the plain `throw` reads
  better.
- **Guards check arguments, not business outcomes.** "Insufficient funds" is an
  expected result of a valid call, a candidate for a result type or a domain
  exception, not for `ArgumentException`.

## Documentation Links

- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [Exception-handling statements: throw, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) (doc)
- [Tracking caller information: CallerArgumentExpression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/caller-information) (doc)
- [ArgumentOutOfRangeException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.argumentoutofrangeexception) (doc)
- [Attributes for null-state static analysis, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis) (doc)
- [CA2200: Rethrow to preserve stack details, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200) (doc)
