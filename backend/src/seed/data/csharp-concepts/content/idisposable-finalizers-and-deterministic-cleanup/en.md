---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The garbage collector reclaims memory, and only memory. File handles, sockets,
database connections, locks, timers, and event subscriptions need someone to
release them at a known moment, and that is the job of `IDisposable`. This
concept covers `using` statements and declarations, `await using` and
`IAsyncDisposable`, the dispose pattern and when it is needed, what a finalizer
really costs, why `SafeHandle` replaces almost every finalizer, and how the
dependency injection container disposes services, all measured on .NET 10.

## Use Cases

- Making sure a file or connection is closed even when an exception is thrown
  halfway through.
- Writing a class that owns a `Stream`, an `HttpClient` handler, or a timer.
- Wrapping a native handle from a P/Invoke call so it is released once and only
  once.
- Explaining why memory keeps growing in a service that resolves disposable
  transients from the root provider.
- Choosing between `Dispose` and `DisposeAsync` for a type that flushes data
  over the network.

## Deep Dive

### `using` statements and declarations

The `using` statement compiles to `try`/`finally` that calls `Dispose`. The
`using` declaration (C# 8) drops the braces and disposes at the end of the
enclosing scope; several declarations are disposed in reverse order, and a
`null` resource is simply skipped:

```csharp
try
{
    using var a = new Res("a");
    using var b = new Res("b");
    using Res? none = null;          // allowed: nothing to dispose
    throw new InvalidOperationException("boom");
}
catch (InvalidOperationException e) { Console.WriteLine($"caught {e.Message}"); }
// dispose b
// dispose a
// caught boom

sealed class Res(string name) : IDisposable
{
    public void Dispose() => Console.WriteLine($"dispose {name}");
}
```

The variable is read-only, so it cannot be reassigned to something that would
escape disposal. A declaration lives until the end of its block, which is
often the end of the method; when a resource should be released earlier, the
braced form says so. C# 8 also allows `using` on a `ref struct` that only has
an accessible, parameterless `void Dispose()` method, because a `ref struct`
could not implement interfaces before C# 13.

### `await using` and `IAsyncDisposable`

Types whose cleanup does I/O (flushing a buffered stream, sending a close
frame) implement `IAsyncDisposable`, and `await using` awaits their
`DisposeAsync`:

```csharp
await using (var r = new AsyncRes()) { }   // DisposeAsync ran

using (var r = new AsyncRes()) { }
// error CS8418: 'AsyncRes': type used in a using statement must implement
// 'System.IDisposable'. Did you mean 'await using' rather than 'using'?

sealed class AsyncRes : IAsyncDisposable
{
    public async ValueTask DisposeAsync() { await Task.Yield(); Console.WriteLine("DisposeAsync ran"); }
}
```

A type that implements both lets the caller choose; the async-streams concept
shows `await foreach` calling `DisposeAsync` on its enumerator the same way.

### The dispose pattern, and when you need it

Most disposable classes own other managed disposables and nothing native. For
them the guidance is short: seal the class and forward `Dispose` to what you
own.

```csharp
public sealed class ReportWriter(string path) : IDisposable
{
    private readonly StreamWriter _writer = new(path);
    private bool _disposed;

    public void Write(string line)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _writer.WriteLine(line);
    }

    public void Dispose()
    {
        if (_disposed) return;          // idempotent: a second call does nothing
        _disposed = true;
        _writer.Dispose();
    }
}
```

The full pattern exists for classes that can be inherited: a public
non-virtual `Dispose()` that calls `Dispose(true)` and then
`GC.SuppressFinalize(this)`, plus a `protected virtual Dispose(bool disposing)`
that derived classes override and chain to `base.Dispose(disposing)`. The
`disposing` flag is `false` only when a finalizer calls it, and that path must
not touch other managed objects, because the order of finalization is not
deterministic. A finalizer is only needed if the class itself holds a raw
unmanaged resource, which the documentation calls a highly advanced scenario.

Ownership decides who disposes. A class that creates a disposable owns it; a
class that receives one (from a constructor argument or from DI) usually does
not and must not dispose it. Stream decorators make that choice explicit with
`leaveOpen`, as Stream Class Hierarchy and Decorators shows.

### Finalizers are a safety net with a price

A finalizer (`~Type()`) runs on the finalizer thread some time after the
object becomes unreachable. Allocating one million small objects and forcing
a collection at the end measured, on .NET 10 Release:

| Objects | Time | Extra collections | Finalized |
|---|---|---|---|
| plain class | 7 ms | none | 0 |
| class with a finalizer | 89 to 151 ms | 3 gen0, 1 gen1 | 1,000,000 |
| finalizer, `GC.SuppressFinalize` in the loop | 25 ms | 3 gen0 | 0 |

Every object with a finalizer is registered at allocation, which is why even
the suppressed version costs more. An unreachable finalizable object also
survives its first collection: it waits on the finalization queue, its
finalizer runs, and only a later collection frees the memory:

```csharp
var wr = new WeakReference(new WithFinalizer(), trackResurrection: true);
GC.Collect();                     // queued for finalization: wr.IsAlive == true
GC.WaitForPendingFinalizers();    // the finalizer has certainly run now
GC.Collect();                     // wr.IsAlive == false: memory reclaimed
```

Do not rely on finalizers at shutdown. .NET 5 and later do not run finalizers
when the process exits; a program that created a finalizable object and
returned from `Main` printed nothing from the finalizer, while an
`AppDomain.ProcessExit` handler did run. Cleanup that must happen on exit goes
through `Dispose` called from such a handler or from the host.

### `SafeHandle` instead of your own finalizer

`SafeHandle` wraps an `IntPtr` and already has the finalizer, the
release-once guarantee, and the thread safety. You override `IsInvalid` and
`ReleaseHandle`:

```csharp
sealed class NativeBuffer : SafeHandle
{
    private NativeBuffer() : base(IntPtr.Zero, ownsHandle: true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;

    public static NativeBuffer Allocate(int bytes)
    {
        var h = new NativeBuffer();
        h.SetHandle(Marshal.AllocHGlobal(bytes));
        return h;
    }

    protected override bool ReleaseHandle() { Marshal.FreeHGlobal(handle); return true; }
}
```

When the caller forgot to dispose one, `ReleaseHandle` still ran after
`GC.Collect()` and `GC.WaitForPendingFinalizers()`. The class that holds the
`NativeBuffer` then needs only the simple sealed `Dispose` above, with no
finalizer of its own. `SafeFileHandle`, `SafeWaitHandle`, and the other
built-in handles already follow this design.

### Disposal in the DI container

`Microsoft.Extensions.DependencyInjection` disposes the services it creates:
transient and scoped ones when their scope ends, singletons when the root
provider is disposed. An instance you pass in yourself
(`AddSingleton(new Foo())`) is never disposed by the container. Two traps
appeared in a test with version 10.0.0:

- Resolving a transient `IDisposable` 1,000 times from the root provider kept
  all 1,000 instances alive after a full GC, because the container tracks them
  for disposal; they were disposed only when the root provider was. The
  documentation lists this as a memory leak anti-pattern.
- A scoped service that implements only `IAsyncDisposable`, inside a scope
  disposed with a plain `using`, threw `InvalidOperationException: 'OnlyAsync'
  type only implements IAsyncDisposable. Use DisposeAsync to dispose the
  container.` `CreateAsyncScope()` with `await using` fixed it.

Lifetimes themselves are covered in Dependency Injection and Service
Lifetimes.

## Trade-offs

- **`using` declaration versus `using` block.** The declaration is shorter, but
  it holds the resource until the end of the scope; a lock or a connection held
  through a slow tail of the method is a real cost.
  ```csharp
  using var conn = Open();
  var rows = Query(conn);
  Render(rows);                // conn is still open here
  ```
- **Finalizer versus no finalizer.** A finalizer catches a forgotten `Dispose`
  for raw handles, at the price of slower allocation, an extra collection
  before the memory returns, and no guarantee at process exit. `SafeHandle`
  gives the same safety net without writing one.
- **Sealed versus inheritable disposables.** Sealing removes the
  `Dispose(bool)` ceremony; an unsealed public class has to provide it so
  derived classes can add cleanup correctly.
- **Sync versus async disposal.** Implementing only `IAsyncDisposable` forces
  every caller, including DI scopes, to use `await using`; implementing both
  is friendlier but means maintaining two paths.
- **Letting the container dispose.** DI disposal is automatic and correct for
  scoped work, but disposable transients resolved from the root live until
  shutdown; resolve them inside a scope or create them with a factory you
  dispose yourself.

## Documentation Links

- [Implement a Dispose method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose) (doc)
- [Implement a DisposeAsync method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync) (doc)
- [using statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using) (doc)
- [Finalizers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/finalizers) (doc)
- [SafeHandle class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle) (doc)
- [Dependency injection guidelines: disposal of services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines#disposal-of-services) (doc)
