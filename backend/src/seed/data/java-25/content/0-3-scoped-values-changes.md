---
version: 1.0
updatedAt: 2026-05-28
---
# Scoped Values — Delta from Java 21 to Java 25 (JEP 506)

> **JEP 506** — finalized in Java 25. See [openjdk.org/jeps/506](https://openjdk.org/jeps/506).

---

## What changed since Java 21

In Java 21, `ScopedValue` existed as a **preview** API (JEP 446). The 21 exam still tested `ThreadLocal` as the canonical way to share data across a call chain. In Java 25, `ScopedValue` is **final** and lives in `java.lang` (not behind `--enable-preview`).

Preview history:

| Release | JEP | Status |
|---------|-----|--------|
| Java 20 | [429](https://openjdk.org/jeps/429) | Incubator (`jdk.incubator.concurrent`) |
| Java 21 | [446](https://openjdk.org/jeps/446) | First preview, moved to `java.lang` |
| Java 22 | [464](https://openjdk.org/jeps/464) | Second preview |
| Java 23 | [481](https://openjdk.org/jeps/481) | Third preview |
| Java 25 | [506](https://openjdk.org/jeps/506) | Final |

API drift across previews:

- The 20 incubator used `ScopedValue.where(K,V).where(K2,V2).run(...)` returning a `Carrier`. That fluent style survives unchanged in 25.
- The `callWhere` / `runWhere` static helpers added in JEP 464 were **removed** before final — the OCP 25 exam only tests the `Carrier`-based form.
- `ScopedValue.getWhere(...)` was removed in JEP 481.
- `ScopedValue.call(...)` now throws `StructureViolationException` (not the preview `IllegalStateException`) when the surrounding structured scope is malformed.

---

## Why ThreadLocal is wrong for virtual threads

```java
// Old style — every virtual thread allocates its own slot in the thread-local map.
static final ThreadLocal<User> CURRENT = new ThreadLocal<>();
```

With millions of virtual threads this costs memory per thread and forces inheritance via `InheritableThreadLocal`. Worse, any code in scope can mutate the slot via `set(...)`, so the value is not actually a constant for the dynamic extent.

`ScopedValue` is **immutable**, **bounded** by a syntactic scope, and **read-only fast** (a small fixed cache plus a thread-local pointer to the active binding stack — no per-thread allocation).

---

## Declaration and binding

```java
public final class Server {
    static final ScopedValue<Principal> PRINCIPAL = ScopedValue.newInstance();

    void handle(Request req) throws Exception {
        ScopedValue.where(PRINCIPAL, authenticate(req))
                   .run(() -> dispatch(req));
    }

    void dispatch(Request req) {
        Principal p = PRINCIPAL.get();    // bound here
        // ...
    }
}
```

- `newInstance()` produces an unbound key. Keys are typically `static final`.
- `where(K, V)` returns a `ScopedValue.Carrier`. The carrier is reusable and immutable.
- `.run(Runnable)` executes the action with the binding visible; `.call(Callable)` returns a result and may throw a checked exception.
- Outside the carrier’s `run`/`call`, `PRINCIPAL.isBound()` is `false` and `PRINCIPAL.get()` throws `NoSuchElementException`.

```java
String name = PRINCIPAL.isBound() ? PRINCIPAL.get().name()
                                  : PRINCIPAL.orElse(GUEST).name();
```

`orElse(T)` and `orElseThrow(Supplier)` avoid the unbound exception path.

---

## Rebinding via nested where

```java
ScopedValue.where(LOCALE, Locale.US).run(() -> {
    assert LOCALE.get() == Locale.US;
    ScopedValue.where(LOCALE, Locale.GERMANY).run(() -> {
        assert LOCALE.get() == Locale.GERMANY;  // shadowed, not mutated
    });
    assert LOCALE.get() == Locale.US;           // outer binding restored
});
```

There is no `set(...)`. A nested `where` shadows the outer binding for the duration of the inner `run`/`call`; the outer binding is unaffected.

---

## Multiple bindings in one carrier

```java
ScopedValue.where(USER, alice)
           .where(REQUEST_ID, "r-42")
           .run(() -> handle());
```

A single carrier can hold any number of bindings. Each `where(...)` returns a new carrier without modifying the previous one (the type is immutable).

---

## Integration with StructuredTaskScope

`ScopedValue` bindings are **inherited** by child tasks forked inside a `StructuredTaskScope`, automatically and without copying:

```java
ScopedValue.where(REQUEST_ID, "r-42").run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        var a = scope.fork(() -> callA());   // sees REQUEST_ID = "r-42"
        var b = scope.fork(() -> callB());   // sees REQUEST_ID = "r-42"
        scope.join();
    }
});
```

This is the inverse of `ThreadLocal`: bindings are inherited *because* the scope is structured, and they go out of scope precisely when the scope closes. A child cannot leak a binding back to the parent because the child has no way to rebind it for the parent.

---

## Exam-relevant rules

| Rule | Detail |
|------|--------|
| Package | `java.lang.ScopedValue` (not `java.util.concurrent`) |
| Construction | `ScopedValue.newInstance()` — no public constructor |
| Mutation | None. `set` does not exist. Rebind by nesting `where(...).run(...)`. |
| `get()` when unbound | Throws `NoSuchElementException` |
| Safe read | `isBound()`, `orElse(T)`, `orElseThrow(Supplier)` |
| Carrier | Returned by `where(K,V)`; immutable; supports chained `.where(...)` |
| Action types | `.run(Runnable)` returns `void`; `.call(Callable<T>)` returns `T` and may throw checked exceptions |
| Inheritance | Automatic across `StructuredTaskScope.fork(...)`; no `Inheritable*` variant needed |
| Structured violation | `StructureViolationException` if the binding outlives the scope |
| Typical declaration | `static final ScopedValue<X> KEY = ScopedValue.newInstance();` |

---

## See also

- [[8-4-scoped-values]] — base course lesson on Scoped Values.
- Javadoc: [ScopedValue](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html).
