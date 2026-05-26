# Scoped Values — Now Final (JEP 487)

> `ScopedValue<T>` is an immutable, structured alternative to `ThreadLocal` for sharing data within a bounded scope. It incubated in Java 20, previewed in Java 21 (JEP 446), and became a finalized standard API in Java 25 (JEP 487). This lesson covers the API, how scoped values are bound and read, their interaction with structured concurrency, and the key differences from `ThreadLocal`.

---

## Evolution of `ScopedValue`

| Java Version | Status | JEP |
|---|---|---|
| Java 20 | Incubator (`jdk.incubator.concurrent`) | JEP 429 |
| Java 21 | Preview (`java.lang.ScopedValue`) | JEP 446 |
| Java 22 | Second preview | JEP 464 |
| Java 25 | **Final** — standard API | JEP 487 |

---

## The Problem with `ThreadLocal`

`ThreadLocal` has several well-known problems:

- **Mutable**: any code that holds the `ThreadLocal` reference can call `set()` at any time, making reasoning about data flow hard.
- **No automatic cleanup**: values accumulate in thread-local storage unless `remove()` is explicitly called, causing memory leaks in thread pools.
- **Inheritance is expensive**: child threads that inherit thread-local values (via `InheritableThreadLocal`) copy the entire set of values at thread creation.

```java
// ThreadLocal — mutable, leak-prone
static final ThreadLocal<String> USER = new ThreadLocal<>();

void process() {
    USER.set("alice");
    callHelper();         // helper can read AND overwrite USER
    USER.remove();        // must remember to clean up
}
```

---

## Creating a `ScopedValue`

A `ScopedValue` is declared as a `static final` field — typically in the class that establishes the scope:

```java
import java.lang.ScopedValue;

public class RequestHandler {
    // Declare — never holds a value until explicitly bound
    static final ScopedValue<String> CURRENT_USER = ScopedValue.newInstance();
}
```

---

## Binding a `ScopedValue`

A `ScopedValue` is **immutable once bound**. Binding uses `ScopedValue.where(sv, value)` followed by `.run(task)` or `.call(task)`:

```java
ScopedValue.where(CURRENT_USER, "alice")
           .run(() -> {
               // Inside this scope, CURRENT_USER.get() == "alice"
               processRequest();
           });
// Outside the scope, CURRENT_USER has no binding
```

```java
// .call() for tasks that return a value or throw a checked exception
String result = ScopedValue.where(CURRENT_USER, "bob")
                           .call(() -> fetchUserData());  // throws checked exceptions
```

| Method | Returns | Use when |
|---|---|---|
| `.run(Runnable)` | `void` | Task does not return a value |
| `.call(Callable<T>)` | `T` | Task returns a value |

---

## Reading a `ScopedValue`

Inside the bound scope, call `sv.get()` to retrieve the current value:

```java
void processRequest() {
    String user = CURRENT_USER.get();   // "alice"
    System.out.println("Processing for: " + user);
    // CURRENT_USER is readable anywhere in this call stack, within the scope
    auditLog(user);
}

void auditLog(String user) {
    // CURRENT_USER still readable here — same scope
    System.out.println("Audit: " + CURRENT_USER.get());
}
```

Calling `get()` outside a binding throws `NoSuchElementException`. Use `isBound()` to check first:

```java
if (CURRENT_USER.isBound()) {
    System.out.println(CURRENT_USER.get());
}
```

---

## Nested Scopes (Re-Binding)

An inner binding shadows the outer one within its scope:

```java
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());  // "alice"

    ScopedValue.where(CURRENT_USER, "admin").run(() -> {
        System.out.println(CURRENT_USER.get());  // "admin" — inner binding
    });

    System.out.println(CURRENT_USER.get());  // "alice" — outer binding restored
});
```

---

## Structured Concurrency and Inheritance

Child threads created within a `StructuredTaskScope` **automatically inherit** the scoped values of the parent thread, with no copy overhead:

```java
import java.util.concurrent.StructuredTaskScope;

ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        scope.fork(() -> {
            // Child thread inherits CURRENT_USER == "alice"
            System.out.println("Child sees: " + CURRENT_USER.get());
            return null;
        });
        scope.join();
    }
});
```

Child threads read the value but **cannot change it** — immutability is preserved.

---

## `ScopedValue` vs `ThreadLocal`

| Feature | `ThreadLocal` | `ScopedValue` |
|---|---|---|
| Mutability | Mutable (`set()` at any time) | Immutable once bound |
| Cleanup | Manual (`remove()`) | Automatic at scope exit |
| Inheritance to child threads | Copy on thread creation (expensive) | Inherited automatically in StructuredTaskScope |
| Lifetime | Until `remove()` or thread death | Exactly the duration of `.run()`/`.call()` |
| Security / reasoning | Hard — any code can overwrite | Easier — value fixed for scope duration |
| Use case | Legacy thread-per-request, request context | Structured concurrency, immutable per-request data |

---

## Chaining Multiple Bindings

Multiple scoped values can be bound in one call:

```java
static final ScopedValue<String> USER    = ScopedValue.newInstance();
static final ScopedValue<Integer> TENANT = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .where(TENANT, 42)
           .run(() -> {
               System.out.println(USER.get());    // "alice"
               System.out.println(TENANT.get());  // 42
           });
```

---

## Key Rules Summary

- `ScopedValue<T>` is finalized in Java 25 (JEP 487); it was preview in Java 21 (JEP 446).
- Declare with `ScopedValue.newInstance()` as a `static final` field.
- Bind with `ScopedValue.where(sv, value).run(task)` or `.call(task)`.
- Read inside the scope with `sv.get()`; `NoSuchElementException` if not bound.
- Values are **immutable** within a scope — no `set()` method exists.
- Cleanup is **automatic** at scope exit — no `remove()` needed.
- Child threads in `StructuredTaskScope` inherit scoped values without copying.
- Prefer `ScopedValue` over `ThreadLocal` in new structured-concurrency code.

---

## References

- [JEP 487 — Scoped Values (Final)](https://openjdk.org/jeps/487)
- [JEP 446 — Scoped Values (Preview, Java 21)](https://openjdk.org/jeps/446)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
