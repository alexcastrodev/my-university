---
version: 1.0
updatedAt: 2026-05-26
---
# Scoped Values — Now Final (JEP 487)

---

## Overview

**Scoped Values** (`java.lang.ScopedValue`) were finalized in **Java 25 (JEP 487)**. They provide a safe, immutable way to share data with a bounded scope across threads — designed as a modern replacement for `ThreadLocal` in virtual-thread and structured-concurrency contexts.

---

## The Problem with ThreadLocal

| Issue | ThreadLocal | ScopedValue |
|-------|-------------|-------------|
| Mutability | Mutable — any code can call `set()` | Immutable within its scope |
| Cleanup | Must call `remove()` to avoid leaks | Automatically cleaned up at scope end |
| Virtual threads | Inherited but still one-per-thread copy | Naturally inherited, no copy needed |
| Structured concurrency | Awkward | First-class support |
| Read performance | Hash-map lookup per thread | Optimized constant-like read |

---

## Declaring a ScopedValue

```java
// Declare as a static final constant — shared key, never set directly
static final ScopedValue<String> CURRENT_USER = ScopedValue.newInstance();
```

---

## Binding and Running

```java
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());   // "alice"
    processRequest();
});

// Outside the scope — isBound() returns false
System.out.println(CURRENT_USER.isBound());   // false
```

`where(key, value)` returns a `ScopedValue.Carrier`. The value is bound only for the duration of `run()` (or `call()` for a result).

---

## call() — Returning a Value

```java
String result = ScopedValue.where(CURRENT_USER, "bob").call(() -> {
    return "Hello, " + CURRENT_USER.get();   // "Hello, bob"
});
```

---

## Nested Scopes — Rebinding

An inner scope can shadow the outer binding. The outer value is restored when the inner scope ends.

```java
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());   // "alice"

    ScopedValue.where(CURRENT_USER, "admin").run(() -> {
        System.out.println(CURRENT_USER.get());   // "admin"
    });

    System.out.println(CURRENT_USER.get());   // "alice" — restored
});
```

---

## Inheritance by Child Threads (Structured Concurrency)

Scoped values are automatically visible to threads forked within the same scope, making them ideal with `StructuredTaskScope`.

```java
static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        scope.fork(() -> {
            System.out.println(REQUEST_ID.get());   // "req-42" — inherited
            return null;
        });
        scope.join().throwIfFailed();
    }
});
```

> **Exam tip:** Child threads in a `StructuredTaskScope` inherit the scoped value automatically. Regular threads started with `Thread.start()` also inherit the binding if started inside the scope.

---

## Comparison: ThreadLocal vs ScopedValue

```java
// ThreadLocal — mutable, requires cleanup
static final ThreadLocal<String> TL = new ThreadLocal<>();
TL.set("value");
try {
    use(TL.get());
} finally {
    TL.remove();   // must not forget this
}

// ScopedValue — immutable, automatic cleanup
static final ScopedValue<String> SV = ScopedValue.newInstance();
ScopedValue.where(SV, "value").run(() -> use(SV.get()));
```

---

## isBound() and orElse()

```java
static final ScopedValue<String> TENANT = ScopedValue.newInstance();

// safe access
String tenant = TENANT.isBound() ? TENANT.get() : "default";

// or use orElse / orElseThrow
String t = TENANT.orElse("default");
String t2 = TENANT.orElseThrow(() -> new IllegalStateException("no tenant"));
```

---

## Multiple Bindings in One Carrier

```java
static final ScopedValue<String> USER   = ScopedValue.newInstance();
static final ScopedValue<String> LOCALE = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .where(LOCALE, "pt-PT")
           .run(() -> {
               System.out.println(USER.get());    // "alice"
               System.out.println(LOCALE.get());  // "pt-PT"
           });
```

---

## Key Rules

- Declare `ScopedValue` as `static final` — it is a key, not a container.
- A scoped value is bound only within the lambda passed to `run()` or `call()`.
- You cannot call `get()` outside a binding scope — throws `NoSuchElementException`.
- Values are immutable within a scope; rebinding in a nested scope does not affect the outer scope.
- Prefer `ScopedValue` over `ThreadLocal` in new code, especially with virtual threads.

---

## References

- [JEP 487 — Scoped Values (Java 25)](https://openjdk.org/jeps/487)
- [Oracle Docs — ScopedValue (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html)
