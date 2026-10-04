---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`async` and `await` look like syntax for "wait without blocking", and most of the
time that mental model is enough. It stops being enough when a request hangs
because someone wrote `.Result`, when an exception vanishes from an `async void`
method, or when a `ValueTask` behaves differently the second time it is awaited.
Each of those follows from how the compiler rewrites an async method into a state
machine, where the continuation runs after an `await`, and what a `Task` actually
represents. This concept covers those mechanics and the rules they imply.

## Use Cases

- Explaining why a controller that calls `.Result` on an async method hangs in
  one host and merely slows down in another.
- Writing a library so that it does not depend on the caller's thread.
- Deciding whether an event handler may be `async void`.
- Choosing between `Task` and `ValueTask` for a method on a hot path.
- Reviewing code that wraps already-asynchronous I/O in `Task.Run`.

## Deep Dive

### What the compiler generates

An `async` method is rewritten into a state machine. Local variables become
fields, each `await` becomes a state, and `MoveNext` resumes the method from
where it left off. A simplified view of what this method turns into:

```csharp
public async Task<int> CountAsync(HttpClient http, string url, CancellationToken ct)
{
    var body = await http.GetStringAsync(url, ct);   // state 0: start the call, register continuation, return
    return body.Length;                              // state 1: MoveNext runs again when the call completes
}

// Conceptually:
// struct CountAsyncStateMachine : IAsyncStateMachine
// {
//     public AsyncTaskMethodBuilder<int> builder;  // owns the returned Task<int>
//     public HttpClient http; public string url; public CancellationToken ct;
//     int state; string body; TaskAwaiter<string> awaiter;
//     public void MoveNext() { /* switch (state) { ... } */ }
// }
```

If the awaited operation has already completed, `await` continues synchronously
and the method never returns to its caller in between. The state machine is a
struct in release builds and is boxed to the heap only when the method really
suspends, which keeps the fast path allocation-light. Starting in .NET 10, the
runtime can take over part of this work as an opt-in experiment, and the rules
below do not change.

### SynchronizationContext and ConfigureAwait

After an `await` completes, the continuation runs where the awaiting code was
captured: on the current `SynchronizationContext` if there is one, otherwise on
the thread pool. UI frameworks (WPF, WinForms, MAUI) and classic ASP.NET have a
context that forces the continuation back to a specific thread. ASP.NET Core
has no `SynchronizationContext`, so continuations run on the thread pool:

```csharp
// In a library, do not force a return to the caller's context.
var data = await store.ReadAsync(ct).ConfigureAwait(false);

// .NET 8 and later: options for special cases.
await task.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing); // observe completion without rethrowing
```

Application code in ASP.NET Core does not need `ConfigureAwait(false)`. Libraries
that may run under a UI context do, so the library does not depend on that thread.

### The `.Result` deadlock

Blocking on a task while holding the context its continuation needs is a deadlock:

```csharp
// UI thread (has a SynchronizationContext):
var text = GetTextAsync().Result;
// GetTextAsync awaits something. Its continuation needs the UI thread to resume.
// The UI thread is blocked in .Result waiting for GetTextAsync. Nobody can proceed.
```

ASP.NET Core does not deadlock this way because it has no such context, but
`.Result` and `.Wait()` still hold a thread for the whole call. Under load that is
thread pool starvation, a slower and harder-to-spot failure. The fix is the same
everywhere: be async all the way up and `await`.

### async void

An `async void` method has no `Task` to return, so the caller cannot await it and
cannot catch its exception. The exception is raised on the captured context, or
on the thread pool where it can crash the process:

```csharp
// Bad: the caller cannot observe a failure.
async void SaveAsync() { await db.SaveChangesAsync(); }

// Right: return Task. async void is for event handlers only.
async Task SaveAsync() { await db.SaveChangesAsync(); }
button.Click += async (s, e) => await SaveAsync(); // the only place async void belongs
```

### ValueTask and its rules

`ValueTask<T>` avoids allocating a `Task` when the result is usually available
synchronously. It comes with restrictions that `Task` does not have:

```csharp
ValueTask<int> vt = cache.GetAsync(key);

var a = await vt;   // fine, once
var b = await vt;   // wrong: a ValueTask must not be awaited more than once

var t = vt.AsTask(); // if you need to await it multiple times or combine it, convert it first
```

Do not await it concurrently, do not read `.Result` or `GetAwaiter().GetResult()`
before it has completed, and do not store it for later. Use `ValueTask` only after
measuring that allocations matter on a path that often completes synchronously.
Everywhere else, `Task` is the right default.

### Task.Run is not a way to make I/O async

`Task.Run` queues work to the thread pool. Wrapping an already-asynchronous call
adds a thread hop and nothing else, and wrapping a blocking call only moves the
blocked thread:

```csharp
// Pointless: GetStringAsync is already asynchronous.
var s = await Task.Run(() => http.GetStringAsync(url));

// Right for CPU-bound work in a UI app: keep the UI thread free.
var result = await Task.Run(() => ComputeExpensiveThing(input));
```

In ASP.NET Core, offloading CPU work with `Task.Run` buys nothing, because the
request already runs on a pool thread.

### async without await

An `async` method with no `await` compiles (with warning CS1998) and runs
synchronously, adding a state machine for nothing. Returning the task directly
removes that cost, but it has one trap, a task returned from inside a `using`:

```csharp
// Not async, but unsafe: db is disposed before the query finishes.
Task<List<Order>> LoadAsync()
{
    using var db = factory.CreateDbContext();
    return db.Orders.ToListAsync();
}

// Safe: await keeps db alive until the work completes.
async Task<List<Order>> LoadAsync()
{
    using var db = factory.CreateDbContext();
    return await db.Orders.ToListAsync();
}
```

## Trade-offs

- **`ConfigureAwait(false)` everywhere is noise in application code.** It makes
  sense in a library with unknown callers, and in an ASP.NET Core app it changes
  nothing observable. Add it by policy per project, not by habit.
- **Exceptions in an un-awaited task disappear.** A call like `_ = DoAsync();`
  swallows its failure silently, so a fire-and-forget needs its own try/catch or
  a durable job.
  ```csharp
  _ = Task.Run(async () => { try { await DoAsync(); } catch (Exception e) { log.LogError(e, "failed"); } });
  ```
- **`ValueTask` trades safety for allocations.** A misuse (awaiting twice) fails
  unpredictably, sometimes only under load, while a `Task` would just work.
- **Eliding async/await changes exception timing.** A method that returns the task
  directly throws argument validation errors when called, while an `async` method
  stores them in the task, so callers see them at the `await`.
- **Async all the way is infectious.** One synchronous API in the middle of an
  async stack pushes people toward `.Result`, which is how the deadlocks and the
  starvation get in. The fix is a new async overload, not a bridge.

## Documentation Links

- [Asynchronous programming with async and await, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/) (doc)
- [Task asynchronous programming model (TAP), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap) (doc)
- [ValueTask<TResult> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1) (doc)
- [ConfigureAwait FAQ, .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [ASP.NET Core best practices, avoid blocking calls, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices#avoid-blocking-calls) (doc)
