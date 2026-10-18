---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An exception in .NET is not a jump to the nearest `catch`. The runtime first
walks up the stack looking for a handler, running `when` filters along the way,
and only after it has found one does it unwind the stack and run the `finally`
blocks in between. That two-pass model explains why filters see the original
stack, why logging in a filter is better than catch-and-rethrow, and why a
`finally` is guaranteed in some situations and not in others. This concept
covers `try`/`catch`/`finally` with that model in mind, what a `throw` really
costs (measured on .NET 8 and .NET 10), `AggregateException`,
`ExceptionDispatchInfo`, the process-wide handlers, and how to design a custom
exception type today.

## Use Cases

- Catching only the failures you can fix (a malformed input, a timeout) and
  letting everything else reach a higher level that knows more.
- Logging an exception with its full context without catching it.
- Releasing a lock, a file, or a "busy" flag no matter how a block exits.
- Reading the real error out of a `Task` that failed, or out of several tasks
  that failed together.
- Installing a last-resort handler that records crashes before the process
  ends.

## Deep Dive

### The two-pass model

When an exception is thrown, the runtime does a first pass up the call stack.
For each `try` it finds, it checks the `catch` clauses in order, and for a
clause with `when`, it runs the filter right there, while every frame below is
still intact. Only when a clause accepts the exception does the second pass
begin: frames are unwound, inner `finally` blocks run, and then the `catch`
body runs. The order is visible:

```csharp
static void Inner()
{
    try { throw new InvalidOperationException("boom"); }
    finally { Console.WriteLine("inner finally"); }
}

try { Inner(); }
catch (Exception e) when (Log("outer filter runs"))
{
    Console.WriteLine($"outer catch: {e.Message}");
}
// outer filter runs
// inner finally
// outer catch: boom
```

Two consequences matter in practice. First, a filter that returns `false`
leaves the exception untouched, so `catch (Exception e) when (LogAndSkip(e))`
records the error and lets it continue to the real handler, with no rethrow
and no change to the stack trace. Second, a filter must not fail: if the filter
expression itself throws, that exception is swallowed and the filter counts as
`false`, so a bug in the filter silently turns into "not handled here".

### Ordering and specific catches

The runtime tests `catch` clauses top to bottom and runs at most one. The
compiler rejects an unreachable clause: `catch (Exception)` followed by
`catch (FormatException)` is error CS0160 "A previous catch clause already
catches all exceptions of this or of a super type". Filters let the same type
appear more than once, as long as the clause without a filter comes last:

```csharp
foreach (var input in new[] { "$12", "abc", "99999999999" })
{
    try { Console.WriteLine(int.Parse(input)); }
    catch (FormatException) when (input.Contains('$')) { Console.WriteLine($"{input}: drop the currency symbol"); }
    catch (FormatException) { Console.WriteLine($"{input}: not a number"); }
    catch (OverflowException) { Console.WriteLine($"{input}: out of range"); }
}
// $12: drop the currency symbol
// abc: not a number
// 99999999999: out of range
```

The `StackTrace` of a caught exception lists the frames between the `throw` and
the frame that caught it, not the whole call stack. It is filled as the
exception travels, which is why rethrowing changes it (the next concept,
on guard clauses and rethrowing, covers `throw;` versus `throw ex;`).

### What `finally` guarantees, and what it does not

A `finally` runs when control leaves the `try` normally, through `return`,
`break`, `continue`, or `goto`, or because an exception propagates and some
outer frame handles it. A `return` value is computed before the `finally`
runs, so changing the local afterwards does not change the result:

```csharp
static int F()
{
    int x = 1;
    try { return x; }
    finally { x = 2; Console.WriteLine("finally ran, x = 2"); }
}
// finally ran, x = 2
// 1
```

The `using` statement is the same mechanism: the compiler lowers it into a
`try`/`finally` that calls `Dispose`.

The guarantee stops where the process stops. Each case below was run on
.NET 10 (macOS arm64):

| Situation | `finally` ran? |
|---|---|
| `Environment.FailFast("...")` inside `try` | no, the process ends at once (exit code 134) |
| Stack overflow inside `try` | no, "Stack overflow." and the process ends; it cannot be caught |
| `Environment.Exit(3)` inside `try` | no, though `AppDomain.ProcessExit` handlers did run |
| Unhandled exception (nothing catches it) | yes on this run, after the "Unhandled exception" message |

The last row is the trap. The C# reference says that whether `finally` runs
depends on whether the operating system triggers an unwind, so for an
unhandled exception it is not a promise. Never put the only copy of important
state, such as flushing a log, in a `finally` that depends on an exception
being caught.

### What a `throw` costs

A stopwatch loop of 200,000 iterations after warm-up, optimized build, on an Apple
M4 Max (macOS 27, arm64), same code on two runtimes:

| Operation | .NET 8.0.22 | .NET 10.0.0 |
|---|---|---|
| `int.TryParse("abc")` failing | 35 ns | 35 ns |
| `throw` and `catch` in the same method | about 18,000 ns | about 2,250 ns |
| `throw` 10 frames deep, then `catch` | about 22,400 ns | about 3,860 ns |
| `int.Parse("abc")` plus `catch` | about 18,450 ns | about 2,670 ns |

The jump comes from .NET 9, where CoreCLR switched to an exception handling
implementation based on the NativeAOT model (Microsoft reports 2 to 4 times
faster in its own micro-benchmarks; on this machine the gap was about 6 to 8
times). Even so, a failed `TryParse` is still 60 to 80 times cheaper than a
thrown and caught exception, and the cost grows with the number of frames
unwound. Exceptions are fine for failures; they are the wrong tool for an
expected outcome inside a loop.

### `AggregateException` and tasks

A `Task` stores its failure as an `AggregateException`, because several things
can fail at once. Blocking APIs (`Wait`, `WaitAll`, `.Result`) throw that
wrapper; `await` and `GetAwaiter().GetResult()` unwrap it and throw the first
inner exception:

```csharp
var t1 = Task.Run(() => throw new InvalidOperationException("A"));
var t2 = Task.Run(() => throw new ArgumentException("B"));

try { Task.WaitAll(t1, t2); }
catch (AggregateException ae) { /* ae.InnerExceptions.Count == 2: A, B */ }

var all = Task.WhenAll(t1, t2);
try { await all; }
catch (Exception e) { /* InvalidOperationException 'A'; all.Exception has 2 */ }
```

After an `await` of `WhenAll`, read `all.Exception.InnerExceptions` if you need
every failure. `ae.Handle(predicate)` marks some inner exceptions as handled
and rethrows a new `AggregateException` with the rest, and `Flatten()` merges
nested aggregates.

### `ExceptionDispatchInfo`: rethrow somewhere else

Sometimes the exception is caught in one place and must be rethrown later, on
another frame or thread. `ExceptionDispatchInfo.Capture(ex)` stores it, and
`Throw()` rethrows it with the original frames kept and the new rethrow site
appended. In the run below, the trace shows `Int32.Parse` and the original
call on line 6, plus the `Throw()` on line 9:

```csharp
ExceptionDispatchInfo? captured = null;
try { Parse("x"); }                                         // line 6
catch (FormatException ex) { captured = ExceptionDispatchInfo.Capture(ex); }

try { captured!.Throw(); }                                  // line 9
catch (FormatException ex) { Console.WriteLine(ex.StackTrace); }
// at System.Number.ThrowFormatException[TChar](ReadOnlySpan`1 value)
// at System.Int32.Parse(String s)
// at Program.<<Main>$>g__Parse|0_4(String s)
// at Program.<Main>$(String[] args) ... line 6   (original call)
// at Program.<Main>$(String[] args) ... line 9   (the rethrow)
```

This is what `await` uses internally to make an async failure look like a
normal one.

### Process-wide handlers

- `AppDomain.CurrentDomain.UnhandledException` is a notification, not a
  handler: it fires for an exception no frame caught, on any thread, and the
  process still terminates (`IsTerminating` was `True`). Use it to log.
- `TaskScheduler.UnobservedTaskException` fires when a faulted task that nobody
  awaited or inspected is finalized by the GC. By default it does not crash
  the process, which is exactly why fire-and-forget failures disappear
  silently. In the test, the event fired only after `GC.Collect()` and
  `WaitForPendingFinalizers()`.
- `ExceptionHandling.SetUnhandledExceptionHandler` (new in .NET 10) installs
  one handler that can return `true` to treat the exception as handled. Thrown
  on a worker thread, an `InvalidOperationException` accepted by the handler
  let `Main` continue; a `FormatException` it rejected went on to
  `AppDomain.UnhandledException` and ended the process. It can be set once and
  is meant for hosts such as REPLs and plug-in runners.

### Designing a custom exception

Derive from the closest meaningful base (`InvalidOperationException`,
`ArgumentException`), keep the standard constructors, and add the data a
handler needs as properties, so filters can use it:

```csharp
public sealed class InsufficientFundsException : InvalidOperationException
{
    public decimal Shortfall { get; }
    public InsufficientFundsException() { }
    public InsufficientFundsException(string message) : base(message) { }
    public InsufficientFundsException(string message, Exception inner) : base(message, inner) { }
    public InsufficientFundsException(decimal shortfall)
        : base($"Insufficient funds: missing {shortfall}") => Shortfall = shortfall;
}

catch (InsufficientFundsException e) when (e.Shortfall > 20) { ... }
// Insufficient funds: missing 30
```

Skip `[Serializable]` and the `(SerializationInfo, StreamingContext)`
constructor: calling the base one now produces warning SYSLIB0051, because
formatter-based serialization is obsolete.

## Trade-offs

- **Catching broadly hides bugs.** `catch (Exception)` deep in the code also
  catches `NullReferenceException` from your own mistakes. Catch specific
  types, or log and rethrow.
- **Filters are powerful but must be trivial.** A filter that throws is
  treated as `false` with no trace of the error, and a filter with side effects
  runs even when a different handler ends up handling the exception.
  ```csharp
  catch (Exception e) when (LogAndSkip(e)) { } // logging only, keep it total
  ```
- **Exceptions are cheaper than before, not cheap.** About 2 microseconds per
  throw on .NET 10 is fine for real failures and wasteful as control flow in a
  hot path; use `TryX` methods there.
- **`finally` is for cleanup, not for durability.** It does not run on
  `FailFast`, stack overflow, or `Environment.Exit`, and it is not promised for
  unhandled exceptions.
- **Global handlers observe, they rarely recover.** Only
  `SetUnhandledExceptionHandler` can keep the process alive, and continuing
  after an unknown failure can leave shared state corrupted.

## Lab

In this lab you get the static class `Handlers` and the exception `OrderRejectedException` **stubbed**, together with xUnit tests that describe the expected behavior. Your job is to implement them. The core idea is to see the two-pass model of exception handling: the runtime first searches for a handler (running the `when` filters) and only then unwinds the stack running the `finally` blocks. That is why a filter runs **before** the inner `finally` blocks, and the tests' log makes it visible.

**The scenario**

Small functions that run a piece of work (`Action`) and handle whatever it throws.

- `Errors.cs`: the `Failure` enum (`None`, `NotFound`, `Io`, `Transient`, `Permanent`, `Unexpected`), the ready-made `RemoteException` (with `StatusCode`) and `OrderRejectedException`, which you complete.
- `Handlers.cs`: `Classify`, `RunWithCleanup`, `ObserveTwoPasses`, `TryCapture` and `CollectMessages`, plus the `Record` helper, which is already written: it adds an entry to the log and returns `true`, ideal for use inside a filter.
- `HandlerTests.cs`: the tests, which check both the result and the order of the log entries.

Note that `OrderRejectedException` compiles as it is (the constructor calls `base(message)`), so it does not throw `NotImplementedException`: it is its test that stays red.

**What you will do, step by step**

1. **Order the catch clauses and filter (TODO-00).** In `Classify`, use several `catch` clauses: `FileNotFoundException` comes before `IOException`, `RemoteException when StatusCode >= 500` becomes `Transient`, any other `RemoteException` becomes `Permanent`, and the rest is `Unexpected`. With no exception, return `None`.
2. **`finally` always runs (TODO-01).** In `RunWithCleanup`, log `start`, run the work and log `cleanup` in a `finally`. Do not catch the exception: it must reach the caller.
3. **See the two passes (TODO-02).** In `ObserveTwoPasses`, put the work in an inner `try/finally` that logs `finally` and, outside it, a `catch (Exception) when (Record(log, "filter"))` that logs `catch`. Run the tests and check the order: `filter`, `finally`, `catch`.
4. **Rethrow without losing the stack (TODO-03).** In `TryCapture`, return `ExceptionDispatchInfo.Capture(exception)` if something is thrown, and `null` otherwise. The test later calls `info.Throw()` and checks that `Boom` still shows up in the stack trace.
5. **Unwrap the `AggregateException` (TODO-04).** In `CollectMessages`, call `Wait()` on the task, and if it faults use `Flatten()` to return the message of every inner exception. A successful task gives an empty list.
6. **A custom exception (TODO-05).** In `OrderRejectedException`, pass the inner exception to the base constructor and store the `orderId` in the `OrderId` property.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why the log ends up as `["filter", "finally", "catch"]` and not `["finally", "filter", "catch"]`, and why `RunWithCleanup` must not have a `catch`.

**Optional challenges**

- **TODO-06:** replace `throw e;` with `throw;` in a `catch` block you write and compare the stack traces. Which frames disappear?
- **TODO-07:** measure with `Stopwatch` how long 100000 throw/catch cycles take versus 100000 `int.TryParse` failures.

**Prerequisites:** basic `try`/`catch`, the exception class hierarchy (`IOException`, `FileNotFoundException`), `Task` basics and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The `Handlers` methods throw `NotImplementedException` until you implement them, and the `TODO-NN` comments explain each one, so red tests are your checklist.

## Documentation Links

- [Exception-handling statements, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) (doc)
- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [What's new in .NET 9 runtime: faster exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/runtime) (doc)
- [ExceptionDispatchInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.exceptionservices.exceptiondispatchinfo) (doc)
- [ExceptionHandling.SetUnhandledExceptionHandler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.exceptionservices.exceptionhandling.setunhandledexceptionhandler) (doc)
- [Exception handling (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/exception-handling-task-parallel-library) (doc)
