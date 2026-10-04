---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Two threads that touch the same mutable state without coordination produce bugs
that appear once a week and never under the debugger. C# gives you a ladder of
tools: `lock` for mutual exclusion, `Interlocked` for single atomic operations
without a lock, `ReaderWriterLockSlim` for many readers and rare writers, and
`Monitor.Wait` and `Pulse` for waiting on a condition. Each has a cost and a
failure mode. This concept covers what `lock` really compiles to, the dedicated
`System.Threading.Lock` type, the objects you must never lock on, how
`Interlocked` and compare-and-swap loops work, why you cannot `await` inside a
`lock`, and how lock ordering decides whether you deadlock.

## Use Cases

- Protecting a shared dictionary used as a cache by several request threads.
- Counting requests or bytes from many threads without taking a lock per update.
- A configuration object read on every request and replaced once an hour.
- A producer that must wait until a consumer has freed space in a buffer.
- Moving money between two accounts, each guarded by its own lock, without ever
  freezing the process.

## Deep Dive

### What `lock` compiles to

A `lock` statement is shorthand for acquiring a `Monitor` and releasing it in a
`finally`, so the lock is released even when the body throws:

```csharp
private readonly object _gate = new();
private readonly Dictionary<string, int> _hits = new();

public void Hit(string key)
{
    lock (_gate)
    {
        _hits[key] = _hits.GetValueOrDefault(key) + 1;
    }
}

// Roughly what the compiler emits:
bool taken = false;
try
{
    Monitor.Enter(_gate, ref taken);
    _hits[key] = _hits.GetValueOrDefault(key) + 1;
}
finally
{
    if (taken) Monitor.Exit(_gate);
}
```

The lock is re-entrant: the same thread can take it again without blocking, so
a method that holds the lock can call another method that also locks. Other
threads wait until the owner leaves. Keep the body short and never call code you
do not control (callbacks, virtual methods, events) while holding it.

### `System.Threading.Lock`

Since .NET 9 and C# 13 there is a dedicated lock type. When the target of
`lock` has the static type `Lock`, the compiler uses its own API instead of
`Monitor`, which is cheaper and states the intent in the type:

```csharp
private readonly Lock _gate = new();

public void Hit(string key)
{
    lock (_gate) // compiles to using (_gate.EnterScope()) { ... }
    {
        _hits[key] = _hits.GetValueOrDefault(key) + 1;
    }
}

if (_gate.TryEnter())
{
    try { /* ... */ }
    finally { _gate.Exit(); }
}
```

For new code on .NET 9 and later, including .NET 10, declare the field as `Lock`
rather than `object`. Do not cast it to `object` and lock on that: the compiler
then falls back to `Monitor` semantics, and the compiler warns about it (CS9216). A `Lock` is also re-entrant on the same thread, and every `Enter` needs a matching `Exit`; exiting from a different thread than the one that entered leaves the lock in an undefined state.

### Never lock on something others can reach

Lock on a private object that exists only for locking. These targets break the
isolation, because any other code can lock on the same instance and create a
deadlock you cannot see from your own class:

```csharp
lock (this) { }          // callers can lock on your instance
lock (typeof(Cache)) { } // the Type object is shared process-wide
lock ("cache") { }       // string literals are interned and shared
```

### `Interlocked` and compare-and-swap

For one numeric update, a lock is heavier than needed. `Interlocked` maps to a
single atomic CPU instruction:

```csharp
private long _requests;
public void Count() => Interlocked.Increment(ref _requests);
public long Total => Interlocked.Read(ref _requests);
```

`CompareExchange(ref location, newValue, comparand)` stores `newValue` only if
`location` still equals `comparand`, and always returns the value it saw. A loop
around it builds any lock-free update, such as a running maximum:

```csharp
private int _max;

public void Observe(int value)
{
    int seen = Volatile.Read(ref _max);
    while (value > seen)
    {
        int previous = Interlocked.CompareExchange(ref _max, value, seen);
        if (previous == seen) return; // we won the race
        seen = previous;              // someone else changed it, retry with the new value
    }
}
```

### `ReaderWriterLockSlim`

When reads vastly outnumber writes and each read is not trivial, several
readers can proceed together while a writer gets exclusive access:

```csharp
private readonly ReaderWriterLockSlim _rw = new();
private Config _config = Config.Default;

public Config Read()
{
    _rw.EnterReadLock();
    try { return _config; }
    finally { _rw.ExitReadLock(); }
}

public void Replace(Config next)
{
    _rw.EnterWriteLock();
    try { _config = next; }
    finally { _rw.ExitWriteLock(); }
}
```

`EnterUpgradeableReadLock` lets one thread read and then decide to write without
releasing, and only one thread can hold it at a time. The instance is
`IDisposable`, so dispose it with its owner.

### Why you cannot `await` inside `lock`

```csharp
lock (_gate)
{
    await SaveAsync(); // error CS1996: cannot await in the body of a lock statement
}
```

A `Monitor` is owned by a thread, and an `await` may resume on a different
thread, which could not release a lock it never acquired. For asynchronous
mutual exclusion, use a `SemaphoreSlim` with one slot:

```csharp
private readonly SemaphoreSlim _mutex = new(1, 1);

public async Task SaveOnceAtATimeAsync(CancellationToken ct)
{
    await _mutex.WaitAsync(ct);
    try { await SaveAsync(ct); }
    finally { _mutex.Release(); }
}
```

A `lock` is still fine inside an `async` method as long as no `await` happens
while it is held.

### Lock ordering and deadlock

Two threads deadlock when each holds a lock the other needs. The classic case is
a transfer between two accounts, called in opposite directions at once:

```csharp
// Thread 1: Transfer(a, b)   Thread 2: Transfer(b, a)   -> each holds one lock, waits for the other.
public static void Transfer(Account from, Account to, decimal amount)
{
    var (first, second) = from.Id < to.Id ? (from, to) : (to, from); // one global order
    lock (first.Gate)
    lock (second.Gate)
    {
        from.Balance -= amount;
        to.Balance += amount;
    }
}
```

Acquiring locks in a single agreed order (here by id) removes the cycle.

### Waiting for a condition with `Monitor.Wait` and `Pulse`

`Monitor.Wait` releases the lock and sleeps until another thread calls `Pulse` or
`PulseAll` on the same object. Always wait inside a loop that rechecks the
condition, because a wakeup does not guarantee it is true:

```csharp
lock (_gate)
{
    while (_queue.Count == 0)
        Monitor.Wait(_gate);
    return _queue.Dequeue();
}

// Producer, holding the same lock:
lock (_gate) { _queue.Enqueue(item); Monitor.Pulse(_gate); }
```

For real producer and consumer code, prefer `Channel<T>` or `BlockingCollection<T>`
over hand-written `Wait` and `Pulse`.

## Trade-offs

- **`lock` is simple and correct, and it serializes.** Every thread waits in line,
  so a long critical section becomes the throughput limit of the whole path.
  Keep the body to the shared-state update and do I/O outside it.
  ```csharp
  var snapshot = ComputeSlowResult();   // outside the lock
  lock (_gate) { _cache[key] = snapshot; } // only the shared write inside
  ```
- **`Interlocked` covers one variable, not an invariant.** Two separate atomic
  updates are not atomic together, so a reader can see one changed and not the
  other. When two fields must change together, use a lock or replace one
  immutable object with a single reference swap.
  ```csharp
  Interlocked.Increment(ref _count);
  Interlocked.Add(ref _sum, value); // a reader between these lines sees count and sum out of step
  ```
- **`ReaderWriterLockSlim` is not automatically faster.** It has more overhead
  than `lock`, so for short critical sections or frequent writes a plain `lock`
  wins. It also defaults to no recursion and throws if a thread re-enters.
- **A CAS loop can spin under contention.** Under heavy contention many threads
  retry repeatedly and burn CPU, so measure before replacing a lock with one.
- **`SemaphoreSlim` is not re-entrant.** A method that holds it and calls another
  method that also waits on it blocks forever, unlike `lock`, which lets the same
  thread back in.
- **Fixed lock order needs discipline.** It works only if every code path follows
  it, and it does not help when the second lock is chosen by a callback or a
  virtual call. Keep lock scopes small and avoid calling out while holding one.

## Documentation Links

- [lock statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock) (doc)
- [Lock class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lock) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [Lock statement errors and warnings (CS9216), C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/lock-semantics) (doc)
- [Interlocked class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked) (doc)
- [ReaderWriterLockSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim) (doc)
- [SemaphoreSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim) (doc)
- [Managed threading best practices, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices) (doc)
