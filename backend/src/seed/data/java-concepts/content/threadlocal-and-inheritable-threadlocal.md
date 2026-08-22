---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`ThreadLocal<T>` (`java.lang.ThreadLocal`) provides a variable that is isolated per thread: every thread that calls `get()` or `set()` on the same `ThreadLocal` instance sees and mutates its own independent copy, invisible to every other thread. It is declared once, shared, and idiomatically `static final` — the instance itself never holds a value; it is a key that each thread resolves against its own private storage. That per-thread isolation is exactly what makes it dangerous to leave behind: on a pooled thread that outlives any single task, a value set and never removed keeps living in that thread's storage indefinitely. `ScopedValue` (see the `scoped-values` concept) was finalized in Java 25 specifically to replace the common request-context use case with an immutable, auto-cleaned alternative — but `ThreadLocal` and its subclass `InheritableThreadLocal` remain in wide use across the ecosystem (logging MDCs, JDBC connection binding, security contexts) and are worth understanding on their own terms.

## Use Cases

- Carrying a piece of per-thread context — a request-correlation ID, the current transaction, a `SimpleDateFormat` instance — down through code that doesn't take it as a parameter.
- Backing logging frameworks' diagnostic context (SLF4J/Logback's MDC is thread-local under the hood; see the `logging-in-java` concept for the MDC API itself) so a log line emitted deep in a call stack can still carry the request ID set at the entry point.
- Giving each thread its own non-thread-safe helper object (formatters, random-number generators, buffers) instead of synchronizing access to one shared instance.
- Propagating a value automatically to worker threads spawned by a parent, via `InheritableThreadLocal`, without passing it through every constructor and method call on the way.

## Deep Dive

### Declaring and using a ThreadLocal: one instance, many independent copies

```java
public class RequestContext {
    // static final — one shared key for the whole program
    static final ThreadLocal<String> CURRENT_USER = ThreadLocal.withInitial(() -> "anonymous");
}

// Thread A
RequestContext.CURRENT_USER.set("alice");
System.out.println(RequestContext.CURRENT_USER.get());   // "alice"

// Thread B, running concurrently
System.out.println(RequestContext.CURRENT_USER.get());   // "anonymous" — its own copy, untouched by Thread A
```

Both threads call `get()`/`set()` on the exact same `CURRENT_USER` object, yet never observe each other's value. `withInitial(Supplier<T>)` supplies the value a thread sees the first time it calls `get()` without having called `set()` first; plain `new ThreadLocal<>()` defaults that first read to `null` instead.

### The mechanism: each Thread owns a ThreadLocalMap, keyed by the ThreadLocal itself

The isolation isn't magic — it's a hash map. Every `Thread` object carries an internal `ThreadLocalMap` field. Calling `threadLocal.set(value)` doesn't store anything inside the `ThreadLocal` instance; it looks up `Thread.currentThread()`'s own map and stores the value there, keyed by the `ThreadLocal` instance itself (via `System.identityHashCode`, not `equals`/`hashCode`):

```java
// conceptually, what set() does:
Thread t = Thread.currentThread();
t.threadLocalMap.put(this /* the ThreadLocal instance */, value);

// and what get() does:
Thread t = Thread.currentThread();
Object value = t.threadLocalMap.get(this);
```

This is why one shared `static final ThreadLocal` never collides across threads: there is exactly one map per thread, and the `ThreadLocal` instance is only ever a lookup key into whichever thread's map happens to be asking. Different threads, different maps, same key object — no shared mutable cell anywhere.

### The memory leak: pooled threads never let go of what they held

An `ExecutorService` reuses the same fixed set of threads across many tasks — a thread never dies between tasks, so its `ThreadLocalMap` never gets garbage collected between tasks either. A value set with `set()` and never removed with `remove()` stays attached to that pooled thread, invisible and unused, until something else overwrites it or the thread itself eventually terminates:

```java
static final ThreadLocal<byte[]> BUFFER = new ThreadLocal<>();

ExecutorService pool = Executors.newFixedThreadPool(4);

for (int i = 0; i < 1000; i++) {
    pool.submit(() -> {
        BUFFER.set(new byte[1_000_000]);   // 1 MB, "just for this task"
        process(BUFFER.get());
        // no remove() — the array stays reachable via the pooled thread's
        // ThreadLocalMap long after this task returns
    });
}
```

With only 4 pooled threads, that loop looks like it should hold at most 4 MB at a time — but each of the 4 threads keeps overwriting *its own* map entry on every task it picks up, so the leak here is really "one stale 1 MB array per thread, replaced each run" rather than 1000 accumulating arrays; the danger is sharper when different tasks use *different* `ThreadLocal` keys or conditionally skip the `set()`, leaving old entries with no later write to replace them. Either way, the object is reachable for as long as the thread lives and nothing removes the entry — invisible to the code that submitted the task, and not something a profiler labeled "task X" will point at, because task X has already finished.

The fix is unconditional cleanup in a `finally` block around the code that calls `set()`:

```java
pool.submit(() -> {
    BUFFER.set(new byte[1_000_000]);
    try {
        process(BUFFER.get());
    } finally {
        BUFFER.remove();   // detach from this pooled thread's ThreadLocalMap
    }
});
```

`remove()` deletes the entry from the current thread's map outright — not just resetting it to the initial value — so the referenced object becomes eligible for garbage collection as soon as nothing else holds it, and the next task on that thread starts from a clean slate.

### InheritableThreadLocal: copied at child-creation time, not a live view

`InheritableThreadLocal<T>` extends `ThreadLocal<T>` and adds one behavior: when a thread creates a new `Thread`, the child's `ThreadLocalMap` is initialized with a copy of every `InheritableThreadLocal` value the parent had bound *at that moment*:

```java
static final InheritableThreadLocal<String> TRACE_ID = new InheritableThreadLocal<>();

TRACE_ID.set("trace-abc");

Thread child = new Thread(() -> {
    System.out.println(TRACE_ID.get());   // "trace-abc" — copied when this Thread was created
});
child.start();
```

The copy happens once, inside the parent thread's call to `new Thread(...)` — it is not a live link back to the parent. A value the parent sets *after* the child already exists never reaches that child:

```java
static final InheritableThreadLocal<String> TRACE_ID = new InheritableThreadLocal<>();

TRACE_ID.set("trace-abc");
Thread child = new Thread(() -> {
    sleep(100);
    System.out.println(TRACE_ID.get());   // still "trace-abc" — not the value set below
});
child.start();

TRACE_ID.set("trace-xyz");   // parent's own value changes; child already has its copy
```

Two consequences follow from "copy at creation": a thread pool's worker threads are created once and reused for many tasks, so an `InheritableThreadLocal` bound on the *submitting* thread is copied only into a worker thread's map the first time that worker is spawned — later tasks submitted by other callers do not get a fresh copy, because no new `Thread` is being created per task. And by default the copy is a plain reference copy (`childValue()` returns the parent's value unchanged), so a *mutable* value shared this way is the same object in both parent and child, with no synchronization between them — overriding `childValue(T parentValue)` is how a subclass can deep-copy or transform it instead.

## Trade-offs

- **Leaks on reuse, not on single-shot threads.** A `ThreadLocal` left unset on a `Thread` that runs one task and dies is harmless — the whole `Thread`, map included, becomes garbage. The risk is specific to long-lived worker threads, which is exactly what every executor-backed server uses.
- **`remove()` is the caller's responsibility, every time, on every path.** Nothing enforces it — an exception thrown before `remove()` is reached in un-guarded code skips the cleanup entirely.

  ```java
  BUFFER.set(data);
  process(data);        // throws
  BUFFER.remove();       // never reached — must be in finally
  ```

- **`InheritableThreadLocal` only fires on `new Thread(...)`, not on `ExecutorService.submit(...)` to an already-running pool.** Code that expects context to "just flow" into submitted tasks the way it flows into a manually created child thread will find it silently missing, because the worker thread already existed before the value was set.
- **Stale reads look like correct reads.** `get()` returning `null` or an initial value is indistinguishable from "nothing was ever set on this thread" — a leaked or stale value from a previous task on the same pooled thread returns just as cleanly as a fresh one, with no exception to signal the mistake.
- **`ScopedValue` removes the whole class of leak by construction where it applies** — see the `scoped-values` concept for the immutable, auto-torn-down alternative; it covers request-context propagation and structured-concurrency fan-out, the two cases `ThreadLocal`/`InheritableThreadLocal` are most often reached for today.

## Documentation Links

- [ThreadLocal — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html) — doc
- [InheritableThreadLocal — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html) — doc
