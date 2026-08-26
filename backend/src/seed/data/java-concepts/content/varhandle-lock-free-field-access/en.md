---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`VarHandle` (JEP 193, added in Java 9) gives a program atomic and volatile access to an *ordinary* variable — an instance field, a static field, or an array element — without wrapping that variable in a class like `AtomicInteger`. The field stays a plain `int`, `long`, or object reference; what changes is that reads and writes to it can go through a `VarHandle` instead of the `.`/`=` operators, at whichever memory-ordering strength the call site chooses. The companion concept `java-memory-model-and-happens-before` defines the happens-before relation and the volatile variable rule formally — this concept is about the API that lets code invoke those same guarantees, plus two intermediate strengths the language keyword `volatile` cannot express on its own. `method-handles-and-runtime-class-generation` covers `MethodHandle`, a *different* API for invoking methods and constructors; `VarHandle` is its sibling for variables, sharing the same `java.lang.invoke.MethodHandles.Lookup` machinery for access checking.

## Use Cases

- Making a single hot field atomically incrementable (a request counter, a sequence generator) without paying for an `AtomicInteger` object and the extra indirection of reading through it.
- Writing infrastructure code — a cache, a connection pool, a lock-free queue — that needs `compareAndSet` on a field that must otherwise stay a plain type for serialization, JIT inlining, or memory-layout reasons.
- Choosing a weaker-than-`volatile` ordering (`acquire`/`release` or `opaque`) on a field that is read far more often than it's written, where full volatile semantics cost more visibility guarantee than the algorithm actually needs.
- Retrofitting atomic access onto a field in a class that isn't yours to change into an `AtomicInteger` field — the `VarHandle` is external to the field's declaration.
- Reading how the JDK's own `java.util.concurrent` classes moved off `sun.misc.Unsafe` and onto `VarHandle` as the supported low-level primitive.

## Deep Dive

### What `VarHandle` replaces: a wrapper object per variable

Before `VarHandle`, atomic access to a plain field meant either `synchronized`, or swapping the field's *type* for `AtomicInteger`/`AtomicLong`/`AtomicReference` — which changes every read site (`counter.get()` instead of `counter`) and adds one object and one indirection per variable:

```java
class RequestCounter {
    private final AtomicInteger count = new AtomicInteger();

    void recordRequest() {
        count.incrementAndGet();
    }
}
```

A `VarHandle` targets the field itself rather than replacing it, so the field stays a plain `int` — readable directly, exactly as fast as any other field access — and the atomic operation is invoked only where it's actually needed:

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

class RequestCounter {
    private int count;   // still an ordinary int field

    private static final VarHandle COUNT;
    static {
        try {
            COUNT = MethodHandles.lookup()
                    .findVarHandle(RequestCounter.class, "count", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    void recordRequest() {
        COUNT.getAndAdd(this, 1);
    }

    int currentCount() {
        return count;   // ordinary field read still works
    }
}
```

### Obtaining a handle: `findVarHandle` and lookup access

`MethodHandles.Lookup.findVarHandle` resolves a `VarHandle` for one named field, given its declaring class and declared type — the same `Lookup` object used for `MethodHandle` resolution in `method-handles-and-runtime-class-generation`, and it obeys the identical access rule: the `Lookup` must have been created with visibility into that field. A `Lookup` obtained by calling `MethodHandles.lookup()` *inside* `RequestCounter` can see `count` because it's private but in the same class; a `Lookup` from outside cannot:

```java
class Vault {
    private int code = 42;
}

// From inside Vault itself, a plain lookup sees the private field:
VarHandle vh = MethodHandles.lookup()
        .findVarHandle(Vault.class, "code", int.class);   // works — called from Vault

// From an unrelated class, the same call fails:
MethodHandles.lookup().findVarHandle(Vault.class, "code", int.class);
// java.lang.IllegalAccessException: field Vault.code is not accessible from class Outsider
```

Reaching a private field from outside its class needs `MethodHandles.privateLookupIn` first — the same bridge documented for `MethodHandle` — which only succeeds if the target's module opens the package to the caller's module. `findVarHandle` throws checked `NoSuchFieldException` or `IllegalAccessException` at lookup time, so resolving the handle once into a `static final VarHandle` (as above) is both the idiomatic and the only sane place to handle that exception.

### Plain access: `get`/`set` behave like ordinary field access

`VarHandle.get`/`.set` carry **no** ordering guarantee beyond what an ordinary field read/write already has — no happens-before edge is created, and the compiler/JIT/CPU remain free to reorder or cache the access exactly as described for unsynchronized fields in `java-memory-model-and-happens-before`:

```java
int v = (int) COUNT.get(this);     // equivalent to: int v = this.count;
COUNT.set(this, 7);                // equivalent to: this.count = 7;
```

These modes exist mainly for symmetry and for cases where a field must be accessed reflectively through a handle (a generic serializer, for instance) but no ordering is needed — they buy nothing over `this.count` when a direct field reference is available.

### `getVolatile`/`setVolatile`: the volatile variable rule, on demand

`getVolatile` and `setVolatile` give the field the exact semantics a `volatile` modifier would — the JMM's volatile variable rule from JLS §17.4.5 applies: a `setVolatile` write happens-before every later `getVolatile` read of that same variable, without declaring the field `volatile` in source:

```java
private boolean ready;   // not declared volatile

private static final VarHandle READY;
static {
    try {
        READY = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "ready", boolean.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

void publish() {
    // ordinary writes here happen-before the volatile write below, by program order + transitivity
    READY.setVolatile(this, true);
}

void consume() {
    if ((boolean) READY.getVolatile(this)) {
        // guaranteed to see everything publish() wrote before setVolatile
    }
}
```

This is the useful trick a `volatile` keyword cannot offer on its own: the field can be *plain* most of the time (fast, unordered access via `.ready`) and *volatile* only at the specific call sites that need the ordering, chosen per access rather than per declaration.

### `getAcquire`/`setRelease`: ordered, but weaker than volatile

Acquire/release is a strength strictly between plain and volatile. A `setRelease` write is guaranteed to happen-before a later `getAcquire` read of the *same* variable — enough to publish data safely through that one field, the same publish/consume shape as the volatile example above — but, unlike `setVolatile`/`getVolatile`, acquire/release does not participate in the total order the JMM gives *all* volatile accesses collectively. In practice this makes it cheaper on hardware with weaker memory ordering, at the cost of a guarantee most call sites never actually needed:

```java
void publish() {
    // writes before this happen-before a getAcquire read that observes `true`
    READY.setRelease(this, true);
}

void consume() {
    if ((boolean) READY.getAcquire(this)) {
        // sees everything written before setRelease — same publish guarantee, weaker global ordering
    }
}
```

### `getOpaque`/`setOpaque`: ordering per variable only

Opaque is weaker still: it guarantees only that accesses to *that one variable* are not reordered with each other (a property sometimes called coherence) — it establishes no happens-before edge to any *other* variable at all. Where the volatile and acquire/release examples above let a reader safely observe unrelated writes that happened earlier in the writer, opaque gives none of that:

```java
private static final VarHandle SEQUENCE;
static {
    try {
        SEQUENCE = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "sequence", long.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

void bumpSequence() {
    long next = (long) SEQUENCE.getOpaque(this) + 1;
    SEQUENCE.setOpaque(this, next);   // ordered relative to other accesses of `sequence` only
}
```

Opaque is the mode to reach for when a value only needs to be internally consistent with itself (a monotonically observed counter, a generation stamp) and nothing else depends on ordering against it.

### Atomic compound operations on a plain field

`compareAndSet`, `getAndAdd`, and `getAndSet` perform the same read-modify-write atomically that `AtomicInteger` offers — but directly on the plain `int` field, through the handle:

```java
private int count;

private static final VarHandle COUNT;
static {
    try {
        COUNT = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "count", int.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

boolean tryResetIfExhausted(int limit) {
    return COUNT.compareAndSet(this, limit, 0);   // atomic: only resets if count == limit
}

int nextSequenceValue() {
    return (int) COUNT.getAndAdd(this, 1);         // atomic increment, returns the pre-increment value
}

int replaceCount(int newValue) {
    return (int) COUNT.getAndSet(this, newValue);  // atomic swap, returns the previous value
}
```

`count` here is never wrapped — `this.count` is still a legal, direct plain read anywhere else in the class; the atomicity is a property of the specific call through `COUNT`, not of the field's declared type.

### Array elements: `arrayElementVarHandle`

The same mechanism extends to array elements, which is where `AtomicInteger`/`AtomicLong` have no direct equivalent short of `AtomicIntegerArray`/`AtomicLongArray` — `MethodHandles.arrayElementVarHandle` produces a handle whose accessor methods take the array plus an index:

```java
VarHandle intArrayHandle = MethodHandles.arrayElementVarHandle(int[].class);

int[] slots = new int[16];
intArrayHandle.setVolatile(slots, 3, 42);
int v = (int) intArrayHandle.getVolatile(slots, 3);

boolean claimed = intArrayHandle.compareAndSet(slots, 3, 42, 0);   // atomic CAS on slots[3]
```

One handle serves every index of every `int[]` — it is not per-array or per-slot, which is why it can be resolved once and reused across every array of that component type.

## Trade-offs

- **`VarHandle` avoids the wrapper object, but it is a lower-level, more verbose API than `AtomicInteger`/`AtomicLong`** — obtaining a handle takes a `Lookup`, a field name, a type, and a checked-exception-throwing call, versus `new AtomicInteger()`. It is the primitive infrastructure code (much of `java.util.concurrent` itself, which the JDK rewrote from `sun.misc.Unsafe` onto `VarHandle`) is built from, not the first tool to reach for in ordinary application code where `AtomicInteger` already reads clearly.
- **Choosing the wrong access mode is a silent correctness bug, not a compile error.** `get`/`set`, `getOpaque`/`setOpaque`, `getAcquire`/`setRelease`, and `getVolatile`/`setVolatile` all compile identically; picking `get` where `getVolatile` was needed produces code that runs correctly in testing and fails under real concurrent scheduling, exactly like the missing-`volatile` double-checked-locking trap in `java-memory-model-and-happens-before`.
- **Signature mismatches surface at runtime, not compile time**, because `VarHandle` accessors are signature-polymorphic like `MethodHandle.invoke`:
  ```java
  boolean b = COUNT.compareAndSet(this, "5", 10);
  // WrongMethodTypeException: expected (RequestCounter,int,int)boolean
  //   but found (RequestCounter,String,int)boolean
  ```
- **`findVarHandle` obeys the same module-access wall as `MethodHandle` lookups** — resolving a handle for a field in a class whose package is not opened to the caller's module throws `IllegalAccessException` (or `InaccessibleObjectException` via the reflective path), with the same `--add-opens` fix living outside the source rather than in it.
- **A `VarHandle` is resolved once and reused, not recreated per call** — resolving it inside a hot method instead of caching it as a `static final` field pays lookup cost on every invocation, the same performance pitfall `method-handles-and-runtime-class-generation` documents for `MethodHandle`.

## Documentation Links

- [VarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html) — doc
- [MethodHandles.Lookup.findVarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.Lookup.html#findVarHandle(java.lang.Class,java.lang.String,java.lang.Class)) — doc
- [MethodHandles.arrayElementVarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.html#arrayElementVarHandle(java.lang.Class)) — doc
- [JEP 193: Variable Handles](https://openjdk.org/jeps/193) — doc
