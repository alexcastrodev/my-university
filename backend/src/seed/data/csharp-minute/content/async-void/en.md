---
version: 1.0
updatedAt: 2026-09-30
---
## Question

# Why should you avoid `async void`?

## Short Answer

Because an `async void` method gives its caller **nothing to observe**: no `Task` to await, no way to know when it finished, and no way to catch its exceptions. An unhandled exception inside it can take down the whole process.

## What It Is

An `async Task` method returns a `Task` that represents the whole operation. If the method throws, the exception is stored inside that task and rethrown when someone awaits it.

An `async void` method has no task to store the exception in. So the exception is raised directly on the `SynchronizationContext` that was active when the method started. In a UI app, that's the UI thread's unhandled-exception handler. In a console app or ASP.NET Core, there is no context, so the exception is thrown on a thread pool thread, and an unhandled exception there **terminates the process**.

## Why It Hurts

- `try/catch` around the call does not catch anything: the method returns at its first `await`, long before the exception happens.
- The caller cannot wait for completion, so tests finish before the work does, and shutdown can cut the work in half.
- Composition is impossible: you can't `Task.WhenAll` a bunch of `async void` calls.

## Practical Example

```csharp
async void SaveAndForget()
{
    await Task.Delay(100);
    throw new InvalidOperationException("boom");
}

try
{
    SaveAndForget();   // returns immediately at the first await
}
catch (InvalidOperationException)
{
    // never reached: the exception escapes later, on another thread
}

// The fix: return Task and await it
async Task SaveAsync()
{
    await Task.Delay(100);
    throw new InvalidOperationException("boom");
}

try { await SaveAsync(); }
catch (InvalidOperationException) { /* caught as expected */ }
```

## Solution and Conclusion

Always return `Task` (or `Task<T>` / `ValueTask`) from async methods. The **only** legitimate use of `async void` is an event handler, because the event signature requires `void`. Even then, wrap the body in a `try/catch` so a failure is logged instead of crashing the app. Also watch for lambdas: passing an async lambda to a parameter of type `Action` silently creates an `async void`.

## References

- [Async return types: void return type](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-return-types#void-return-type) (doc)
- [Async/Await: Best Practices in Asynchronous Programming](https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming) (doc)
