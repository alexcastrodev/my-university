---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Every object reference in Java has a *strength* that tells the garbage collector how eagerly it may reclaim the referent. A plain (strong) reference forbids collection outright — as long as one exists, the object is unreachable to the GC's scythe. `java.lang.ref` adds three weaker levels — soft, weak, and phantom — each relaxing that guarantee a bit more, letting code observe or influence collection instead of just preventing it. This concept covers what each level actually guarantees, how `ReferenceQueue` notifies code when a reference has been cleared or enqueued, and how `Cleaner` — the modern replacement for `Object.finalize()` — builds deterministic native-resource cleanup on top of `PhantomReference`.

## Use Cases

- Building a memory-sensitive cache that holds onto values as long as there's spare heap, but lets the JVM reclaim them instead of throwing `OutOfMemoryError` — the job of `SoftReference`.
- Keying a map by an object without that key itself keeping the object alive — `WeakHashMap`, used for canonicalizing metadata or per-object properties that should vanish when the object does.
- Unregistering listeners/observers automatically when the observed object is garbage-collected, instead of relying on every caller to call `removeListener` correctly.
- Knowing for certain when an object has been finalized and its memory reclaimed, in order to release an associated native resource (a file handle, off-heap buffer, socket) — the job of `PhantomReference` plus `ReferenceQueue`.
- Replacing `Object.finalize()` — deprecated for removal since Java 18 (JEP 421) — with `java.lang.ref.Cleaner` for resource cleanup that doesn't resurrect objects or run on an unpredictable thread.

## Deep Dive

### The reference strength hierarchy

The GC decides what to reclaim based on the *strongest* reference chain reaching an object, from strongest to weakest:

```java
Object strong = new Object();               // strong: never collected while reachable
SoftReference<Object> soft = new SoftReference<>(new Object());   // collected only under memory pressure
WeakReference<Object> weak = new WeakReference<>(new Object());   // collected at the next GC cycle
PhantomReference<Object> phantom =
        new PhantomReference<>(new Object(), new ReferenceQueue<>()); // never reachable via get()
```

- **Strong** (the default, ordinary variable/field assignment): the object is never eligible for collection while any strong reference to it exists.
- **Soft**: the object is eligible for collection, but the JVM is only *supposed* to clear soft references when it needs the memory — in practice, right before it would otherwise throw `OutOfMemoryError`.
- **Weak**: the object is eligible for collection as soon as no strong references to it remain; `get()` returns `null` the moment the GC has decided to clear it, which can be as early as the next collection cycle.
- **Phantom**: `get()` always returns `null` — a phantom reference never lets code get the object back. It only exists to be enqueued into a `ReferenceQueue` after the object has already been finalized and its memory reclaimed.

All three types live in `java.lang.ref` and extend the abstract class `Reference<T>`.

### WeakReference: cleared as soon as no strong reference remains

```java
Object target = new Object();
WeakReference<Object> ref = new WeakReference<>(target);

System.out.println(ref.get()); // the Object instance — still strongly reachable via `target`

target = null;      // drop the only strong reference
System.gc();         // a *request* to the JVM, never a guarantee it runs or collects this object

System.out.println(ref.get()); // very likely null now, but not contractually guaranteed by this call alone
```

Clearing happens *before* finalization — a `WeakReference` never delays or observes an object's finalization the way a phantom reference does; by the time `get()` starts returning `null`, the referent is simply gone from this reference's point of view. `System.gc()` is documented only as a suggestion that the JVM run garbage collection; it is never a guarantee, so relying on it in production code (rather than in a scratch demonstration like this one) is unsound.

### WeakHashMap: keys that don't keep themselves alive

`WeakHashMap` wraps each key in a `WeakReference`. Once nothing outside the map holds a strong reference to a key, that entry becomes eligible for automatic removal:

```java
Map<Object, String> registry = new WeakHashMap<>();

Object key = new Object();
registry.put(key, "metadata");
System.out.println(registry.size()); // 1

key = null;          // drop the only external strong reference to the key
System.gc();          // suggestion only — not guaranteed to run or to collect the entry immediately

// After the GC reclaims the key, the entry is removed from the map on a
// subsequent access/cleanup pass — size may already reflect it, or may
// still show 1 until the map's internal bookkeeping catches up.
System.out.println(registry.size());
```

This is the classic fix for listener/observer registries: a normal `HashMap<Listener, Data>` keeps every registered listener alive forever, even after the caller that registered it has no other reference to it. `WeakHashMap` lets a forgotten listener disappear along with its registration instead of leaking memory for the life of the process.

### SoftReference: cleared only under memory pressure, guaranteed before OOM

```java
SoftReference<byte[]> cached = new SoftReference<>(new byte[64 * 1024 * 1024]);

byte[] data = cached.get();
if (data == null) {
    // was cleared — the JVM needed the memory; recompute or reload
    data = reload();
    cached = new SoftReference<>(data);
}
```

Unlike `WeakReference`, the JVM does not clear soft references opportunistically at the next collection — the specification requires that *all* soft references be cleared before the JVM throws `OutOfMemoryError` for lack of heap. That makes `SoftReference` a reasonable building block for a memory-sensitive cache: entries survive as long as there's spare heap, and get reclaimed automatically instead of the application crashing with `OutOfMemoryError` — but there's still no guarantee about exactly *when* within that pressure window a given entry gets cleared, so it isn't a substitute for an eviction policy that needs predictable timing (an LRU cache with a fixed size, for instance).

### PhantomReference: get() always null, enqueued only after finalization

```java
ReferenceQueue<Resource> queue = new ReferenceQueue<>();
Resource resource = new Resource();
PhantomReference<Resource> phantom = new PhantomReference<>(resource, queue);

System.out.println(phantom.get()); // always null — phantom references never return the referent

resource = null;
System.gc(); // suggestion only

Reference<? extends Resource> enqueued = queue.remove(); // blocks until the JVM enqueues it
System.out.println(enqueued == phantom); // true, once it happens
```

`get()` on a `PhantomReference` returns `null` unconditionally — it is not a way to retrieve the object, only a way to be told, via the queue, that the object has already been finalized and its memory reclaimed. This is what makes phantom references suitable for reliably triggering native-resource cleanup: by the time the reference is enqueued, the Java object is truly gone, so there's no risk of resurrecting it or of running cleanup code that races with code still using the object.

### ReferenceQueue: registering and polling

Any `Reference` (soft, weak, or phantom) can be associated with a `ReferenceQueue` at construction time. The JVM appends the reference to that queue when it clears (soft/weak) or would clear (phantom) the referent:

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
WeakReference<Object> ref = new WeakReference<>(new Object(), queue);

// Non-blocking: returns null immediately if nothing has been enqueued yet.
Reference<?> polled = queue.poll();

// Blocking: waits until a reference is enqueued, or the timeout elapses.
Reference<?> removed = queue.remove(5000);
```

`poll()` is the right choice inside a periodic cleanup loop (e.g., checking once per housekeeping cycle without blocking that thread); `remove()` — with or without a timeout — is the right choice for a dedicated cleanup thread that has nothing else to do but wait for enqueue events.

### Cleaner: the modern, deterministic replacement for finalize()

`Object.finalize()` was deprecated for removal in Java 9 and formally marked **deprecated for removal** by JEP 421 (Java 18) because of well-documented problems: finalizers run on an unpredictable, JVM-chosen thread, may never run at all, can resurrect the object by re-establishing a strong reference to it, and a slow finalizer can stall the finalization of every other object queued behind it. `java.lang.ref.Cleaner`, added in Java 9, replaces it by wrapping a `PhantomReference`-based mechanism behind a small, safe API:

```java
import java.lang.ref.Cleaner;

public class NativeResource implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    // State captured by the cleanup action must NOT hold a reference to `this` —
    // that would keep the resource reachable and defeat the whole mechanism.
    private static class State implements Runnable {
        private long nativeHandle;

        State(long nativeHandle) {
            this.nativeHandle = nativeHandle;
        }

        @Override
        public void run() {
            // release the native handle here
            System.out.println("Releasing native handle " + nativeHandle);
        }
    }

    private final State state;
    private final Cleaner.Cleanable cleanable;

    public NativeResource(long nativeHandle) {
        this.state = new State(nativeHandle);
        this.cleanable = CLEANER.register(this, state);
    }

    @Override
    public void close() {
        cleanable.clean(); // explicit, deterministic cleanup — runs the action immediately
    }
}
```

`Cleaner.register(this, state)` internally creates a `PhantomReference` to `this` on a `ReferenceQueue` the `Cleaner` manages, with a dedicated thread polling that queue and invoking `state.run()` once the object becomes phantom-reachable — i.e., after it's been finalized (skipped, since there's no `finalize()` here) and is otherwise unreachable. Calling `cleanable.clean()` explicitly (from `close()`) runs the same action immediately and marks it done, so the background thread's eventual GC-triggered cleanup becomes a no-op safety net rather than the primary mechanism. `try-with-resources` on `NativeResource` is still the primary cleanup path; the `Cleaner` only guards against a caller who forgets to call `close()`.

## Trade-offs

- **`System.gc()` is a request, never a guarantee.** Every demonstration above depends on the JVM actually running a collection after `System.gc()`, which the specification explicitly does not promise — production code must never depend on a specific reference being cleared by a specific point in time.
  ```java
  System.gc(); // JVM may ignore this call entirely
  ```
- **Weak references can vanish faster than expected.** Because a `WeakReference` is cleared as soon as no strong reference remains, a value that's only reachable weakly can disappear between one statement and the next if a GC cycle happens to run in between — code that reads `get()` must always handle a `null` result, even right after confirming it was non-null.
  ```java
  if (weakRef.get() != null) {
      // GC could still clear it here, before the next line runs
      use(weakRef.get()); // must re-check for null
  }
  ```
- **`SoftReference` caches trade predictability for automatic sizing.** They avoid manual eviction logic and avoid `OutOfMemoryError` from an unbounded cache, but offer no control over exactly when or in what order entries are cleared — a cache with strict latency or size requirements still needs an explicit bounded/LRU structure instead.
- **`PhantomReference` cannot resurrect or inspect the object.** `get()` always returns `null`, so it is useless for anything except *noticing* collection — any actual cleanup state (like a native handle) must be stored separately, in the object passed to `Cleaner.register()` or held alongside the `PhantomReference`, never recovered from the reference itself.
- **`Cleaner`/phantom-based cleanup is a safety net, not a substitute for explicit resource management.** The cleanup thread only runs after the object is already unreachable and a GC cycle happens to occur — there is no bound on how long that takes, so relying on it alone (instead of `try-with-resources`/`close()`) can leave native resources held far longer than necessary.
- **`Object.finalize()` is deprecated for removal (JEP 421, Java 18).** Code still overriding it should migrate to `Cleaner`, which doesn't allow resurrection and runs cleanup on a dedicated thread rather than an unspecified finalizer thread.

## Documentation Links

- [Reference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Reference.html) — doc
- [WeakReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html) — doc
- [SoftReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/SoftReference.html) — doc
- [PhantomReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/PhantomReference.html) — doc
- [ReferenceQueue — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/ReferenceQueue.html) — doc
- [Cleaner — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Cleaner.html) — doc
- [WeakHashMap — java.util](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/WeakHashMap.html) — doc
- [JEP 421: Deprecate Finalization for Removal](https://openjdk.org/jeps/421) — doc
