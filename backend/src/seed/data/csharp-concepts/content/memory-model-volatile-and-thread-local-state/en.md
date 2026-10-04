---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Two threads reading and writing the same field are not guaranteed to see each
other's writes in the order the source code suggests. The compiler, the JIT,
and the CPU may reorder operations, and a value written by one thread may sit in
a register or cache the other thread never looks at. This concept covers the
rules that decide what one thread can observe of another: what `volatile` and
`Volatile.Read` and `Volatile.Write` guarantee and what they do not, how to
publish a shared object once (double-checked locking done right, or `Lazy<T>`
instead), what `Interlocked` adds, and how to keep state per thread
(`[ThreadStatic]`, `ThreadLocal<T>`) or per logical flow of control
(`AsyncLocal<T>`) without leaking it between requests.

## Use Cases

- A background loop that must stop when another thread sets a `_stop` flag.
- A lazily created singleton, such as a parsed configuration or a compiled
  regex, that many threads ask for at startup.
- A counter updated from many threads without taking a lock.
- A correlation id that every log line in a request should carry, without
  passing it through each method.
- A bug that never reproduces on a developer's x64 laptop and shows up on an
  ARM64 server.

## Deep Dive

### Why one thread may not see another's write

This loop can run forever in an optimized build, because nothing tells the
compiler that `_stop` can change underneath it, so it may read the field once
and keep the value in a register:

```csharp
private bool _stop;

void Worker()
{
    while (!_stop) { /* work */ } // the JIT may hoist the read of _stop out of the loop
}

void Stop() => _stop = true;    // another thread
```

The .NET memory model is permissive: reads and writes may be reordered as long
as a single thread cannot tell the difference. The documentation says only that
compilers and processors may reorder memory operations. In practice x64 hardware
is fairly strict, so some reorderings never happen there and hide bugs, while
ARM64 is weaker and the same code can misbehave on it. A test that passes on x64 proves less than it
appears to.

### volatile, Volatile.Read, and Volatile.Write

Marking the field `volatile` makes every read an acquire and every write a
release. A read with acquire semantics cannot be moved after later reads and
writes, and a write with release semantics cannot be moved before earlier reads
and writes. The loop above becomes correct:

```csharp
private volatile bool _stop;
```

`Volatile.Read` and `Volatile.Write` apply the same rule to one access instead
of every access to the field, which suits a field that is usually touched under
a lock and only occasionally read without one:

```csharp
// Publish: everything written before the release is visible to a reader that sees the flag.
_config = BuildConfig();
Volatile.Write(ref _ready, true);

// Consume
if (Volatile.Read(ref _ready))
    Use(_config);
```

What `volatile` does not give you: atomic read-modify-write (`_count++` is still a
read, an add, and a write), and ordering of a write followed by a read of a
different variable. Acquire and release together still allow that pair to be
swapped, which is exactly what breaks Dekker-style "I set my flag, then check
yours" algorithms. Nor does `volatile` guarantee that a read sees the latest value
written by another processor, or a single total order of volatile writes as seen by
all threads. The documentation cautions that `volatile` is often misused and points
to `Interlocked`, `lock` and higher-level primitives as the safer default. With
`Volatile.Read` and `Volatile.Write` the guarantee covers one access at a time, so
every access to the field must go through them to synchronize it.

### Publishing once: double-checked locking or Lazy

Creating a shared object on first use needs three things at once: only one
instance, no lock on the fast path, and other threads seeing a fully built
object. The hand-written version works only with a `volatile` field:

```csharp
private static volatile Settings? _settings;
private static readonly object _gate = new();

static Settings Get()
{
    var s = _settings;
    if (s is not null) return s;       // fast path, no lock
    lock (_gate)
    {
        return _settings ??= Load();   // second check under the lock
    }
}
```

Without `volatile`, a reader could see the reference before the constructor's
writes (on a weak memory model), and use a half-built object. `Lazy<T>` does all
of this for you, and `LazyThreadSafetyMode` states the trade you want:

```csharp
private static readonly Lazy<Settings> _settings =
    new(Load, LazyThreadSafetyMode.ExecutionAndPublication); // the default: one factory call, others wait

// PublicationOnly: several threads may run the factory, the first result wins, and an
// exception is not cached. None: no thread safety at all, for single-threaded use.
```

For a field that already exists on a type, `LazyInitializer.EnsureInitialized`
avoids allocating a `Lazy<T>` per instance:

```csharp
private Settings? _settings;
Settings Settings => LazyInitializer.EnsureInitialized(ref _settings, Load);
```

### Interlocked and fences

`Interlocked.Increment`, `Exchange`, and `CompareExchange` are atomic
read-modify-write operations. On current runtimes they also act as full memory
barriers, so nothing moves across them in either direction, although the
`Interlocked` documentation does not promise this and offers `MemoryBarrier()` for
an explicit fence. That makes them the right tool for a
shared counter or a flag claimed by exactly one thread:

```csharp
Interlocked.Increment(ref _requests);

if (Interlocked.CompareExchange(ref _started, 1, 0) == 0)
    Start(); // only the thread that swapped 0 to 1 gets here
```

`Thread.MemoryBarrier()` is a standalone full fence. Reach for it only when you
are building a lock-free structure and can state which reordering you are
preventing. A `lock` statement already gives acquire on entry and release on
exit, so data guarded by a lock needs no `volatile`.

### Per-thread and per-flow state

Three tools hold a value that differs by context, and they answer different
questions:

```csharp
[ThreadStatic] private static int t_depth;              // one value per OS thread, no initializer per thread
private static readonly ThreadLocal<Random> s_rng =
    new(() => new Random());                            // one value per thread, lazily created, IDisposable
private static readonly AsyncLocal<string?> s_correlationId = new(); // one value per logical async flow
```

`[ThreadStatic]` is the cheapest and has a trap: an initializer such as
`= 5` runs only for the first thread that touches the field, and every other
thread starts at the default. `ThreadLocal<T>` takes a factory that runs once per
thread. `AsyncLocal<T>` follows the `ExecutionContext`, so its value flows
through `await` even when the continuation runs on another thread, and a
`Task.Run` or `ThreadPool.QueueUserWorkItem` started from that flow inherits a
copy. In practice a change made inside an async callee is not visible to its caller after the call returns, because the caller's context is restored (the official pages do not state this; it is observed behavior, so verify it with a small test).

```csharp
s_correlationId.Value = "req-42";
await DoWorkAsync();        // still "req-42" inside, even if it resumes on another thread
```

## Trade-offs

- **`volatile` fixes visibility, not atomicity.** It is the right tool for a flag
  written by one thread and read by others, and the wrong one for a counter.
  ```csharp
  private volatile int _count;
  _count++;                    // lost updates under contention
  Interlocked.Increment(ref _count); // correct
  ```
- **Hand-written double-checked locking is easy to break.** Dropping the
  `volatile`, reading the field twice instead of copying it to a local, or
  returning the field outside the lock each reopen a race that testing on x64
  rarely finds. `Lazy<T>` and `LazyInitializer` are the lower-risk default.
- **`Lazy<T>` caches a failure.** In the default mode, if the factory throws, the
  exception is stored and rethrown on every access, so a transient error becomes
  permanent. `PublicationOnly` retries but may run the factory more than once, so
  the factory must be safe to repeat.
- **Thread-bound state breaks across `await`.** After an `await`, the code can
  resume on a different thread, so a `[ThreadStatic]` or `ThreadLocal<T>` value
  set before it is gone, or worse, belongs to an unrelated request on a pooled
  thread. For request-scoped data, use `AsyncLocal<T>` or an explicit parameter.
  ```csharp
  t_userId = 7;
  await Task.Delay(1);
  Console.WriteLine(t_userId); // may print 0, or another request's value
  ```
- **`AsyncLocal<T>` is implicit state.** A value that flows invisibly through
  every call is hard to trace, and it is copied into each new flow, so large
  objects held in it are held longer than expected. Prefer passing the value as a
  parameter when the call chain is short, and keep `AsyncLocal<T>` for ambient
  data such as a trace or correlation id.
- **`ThreadLocal<T>` needs disposal.** A long-lived `ThreadLocal<T>` created per
  object keeps per-thread slots alive until it is disposed, and with
  `trackAllValues: true` it keeps every thread's value reachable.

## Documentation Links

- [volatile keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/volatile) (doc)
- [Volatile class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.volatile) (doc)
- [Lazy initialization, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/performance/lazy-initialization) (doc)
- [LazyThreadSafetyMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lazythreadsafetymode) (doc)
- [Interlocked class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked) (doc)
- [ThreadLocal<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadlocal-1) (doc)
- [AsyncLocal<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.asynclocal-1) (doc)
- [ThreadStaticAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threadstaticattribute) (doc)
