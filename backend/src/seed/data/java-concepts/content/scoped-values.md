---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

For twenty years the only way to hand a value to code deep in a call stack without threading it through every method signature was `ThreadLocal` — a per-thread mutable slot that any code holding the key can overwrite with `set()`, and that leaks unless every path that writes it also calls `remove()` in a `finally`. `ScopedValue` (`java.lang.ScopedValue`), finalized in Java 25 by JEP 506, replaces that slot with an immutable binding whose lifetime is the *dynamic extent* of a lambda: `ScopedValue.where(KEY, value).run(() -> ...)` makes `KEY.get()` return `value` for every frame called from that lambda — including threads forked inside it — and unbinds it the instant `run()` returns. There is no `set()`, so nothing downstream can mutate the context out from under its caller, and there is no `remove()` to forget, so there is nothing to leak. This is a stable, production-ready API, not a preview one.

## Use Cases

- Carrying request-scoped context — request ID, authenticated user, tenant, trace/span identifiers, locale — from an inbound handler down to a repository or logger many frames away, without adding a `RequestContext ctx` parameter to every method in between.
- Running that same pattern on a server that reuses pooled platform threads, where a `ThreadLocal` left behind by one request is visible to the *next* request served by the same thread — a correctness bug on top of the memory leak.
- Running it on virtual threads at the scale they are built for: a million in-flight requests means a million threads, and a per-thread `ThreadLocal` copy per thread is a million copies of that context; a `ScopedValue` binding is designed for exactly this fan-out.
- Propagating context into forked subtasks of a `StructuredTaskScope` with zero plumbing — the child sees the parent's binding automatically, no `InheritableThreadLocal` and no manual copy at the fork site.
- Enforcing that a piece of context is *only* readable where it makes sense: outside the binding, `get()` throws rather than quietly returning a stale value from a previous request.

## Deep Dive

### Declaring a scoped value: it is a key, not a container

```java
public class Server {
    // static final — one shared key for the whole program
    static final ScopedValue<String> CURRENT_USER = ScopedValue.newInstance();
    static final ScopedValue<String> REQUEST_ID   = ScopedValue.newInstance();
}
```

`newInstance()` does not create a slot holding anything. The `ScopedValue` object is a *key* — the value it maps to depends entirely on which binding is active on the current thread at the moment `get()` runs. That is why the idiomatic declaration is `static final` and package/class-level: the same key object has to be visible to the code that binds it and to the code far below that reads it. Making it an instance field, or creating a new one per request, defeats the whole mechanism — the reader would need a reference to *that* instance, which is the parameter-threading problem the class exists to solve.

### Binding with `run()` and `call()`

```java
// run() — no result
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());   // "alice"
    processRequest();                          // any depth below also sees "alice"
});

System.out.println(CURRENT_USER.isBound());    // false — binding is gone
```

`where(key, value)` returns a `ScopedValue.Carrier`: an immutable description of "this key bound to this value", which has not taken effect yet. Nothing is bound until you invoke an operation on the carrier. `run(Runnable)` executes the lambda with the binding in place and returns `void`; `call(...)` does the same but returns the lambda's result and may propagate checked exceptions:

```java
String greeting = ScopedValue.where(CURRENT_USER, "bob").call(() -> {
    return "Hello, " + CURRENT_USER.get();     // "Hello, bob"
});
```

The binding's lifetime is exactly the execution of that lambda — its *dynamic extent*, meaning every method it calls, and every method those call, on this thread. When the lambda returns (normally or by throwing), the binding is torn down by the runtime. There is no code path that can skip that teardown.

### Nested rebinding shadows, it does not mutate

There is no `CURRENT_USER.set(...)`. The only way to change what a key resolves to is to open a *new* scope that binds it again; that inner binding shadows the outer one for its own extent, and the outer value comes back automatically:

```java
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());       // before: "alice"

    ScopedValue.where(CURRENT_USER, "admin").run(() -> {
        System.out.println(CURRENT_USER.get());   // during: "admin"
        escalatedOperation();                      // sees "admin"
    });

    System.out.println(CURRENT_USER.get());       // after:  "alice" — restored
});
```

This is the structural difference from `ThreadLocal`. A rebinding is visible only *downward*, into the nested lambda; it can never be visible *upward* to the code that opened the outer scope. A callee cannot corrupt its caller's view of the context, because rebinding is scoped by the language construct rather than by discipline.

### Safe access: `isBound()`, `orElse()`, `orElseThrow()`

Calling `get()` with no binding active is a hard failure:

```java
static final ScopedValue<String> TENANT = ScopedValue.newInstance();

TENANT.get();   // NoSuchElementException — nothing is bound on this thread
```

For code that can legitimately run both inside and outside a binding (a logger, a metrics interceptor, a utility called from both a request path and a startup path), use one of the safe accessors instead:

```java
if (TENANT.isBound()) {
    log("tenant=" + TENANT.get());
}

String tenant  = TENANT.orElse("default");
String tenant2 = TENANT.orElseThrow(() -> new IllegalStateException("no tenant bound"));
```

`orElse` supplies a fallback; `orElseThrow` swaps the generic `NoSuchElementException` for a domain-specific one at the boundary where the failure is actually meaningful. Note the contrast with `ThreadLocal.get()`, which returns `null` (or the `initialValue()`) when unset — a missing binding there is silently indistinguishable from a binding whose value happens to be `null`.

### Binding several keys in one carrier

`Carrier.where(...)` returns a new carrier with the extra binding added, so bindings chain:

```java
static final ScopedValue<String> USER   = ScopedValue.newInstance();
static final ScopedValue<String> LOCALE = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .where(LOCALE, "pt-PT")
           .run(() -> {
               System.out.println(USER.get());     // "alice"
               System.out.println(LOCALE.get());   // "pt-PT"
           });
```

Both bindings share one scope: they take effect together when `run()` starts and are torn down together when it returns. This is the normal way to establish a whole request context in one place, instead of nesting a `run()` per key.

### Inheritance by child threads and `StructuredTaskScope`

A scoped value binding is visible to threads created *inside* its extent, without any `InheritableThreadLocal` equivalent and without copying the value per thread:

```java
static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        var user  = scope.fork(() -> fetchUser(REQUEST_ID.get()));    // sees "req-42"
        var order = scope.fork(() -> fetchOrder(REQUEST_ID.get()));   // sees "req-42"
        scope.join();
        render(user.get(), order.get());
    }
});
```

This is where the two Java 25 concurrency features fit together: `StructuredTaskScope` guarantees the forked subtasks finish before the `try` block exits, which means they are guaranteed to finish *inside* the scoped value's extent — so the binding they read cannot be torn down while they are still running. A plain `Thread.start()` inside the extent inherits the binding too, but nothing forces that thread to end before the scope does; a binding that outlives its structure is exactly what `StructureViolationException` exists to report. The sibling `structured-concurrency` concept covers the scope side of this pairing; note that `StructuredTaskScope` is still a preview API in Java 25 while `ScopedValue` is final.

### How this relates to the memory model

The companion `visibility-and-safe-publication` concept covers what it takes to share mutable state across threads correctly — a happens-before edge via `volatile`, a lock, or a `final` field. `ScopedValue` does not solve that problem; it avoids it. A binding is established before the child task starts and is never written again, so there is no concurrent write for a reader to miss and no reordering to reason about. Two subtasks reading `REQUEST_ID.get()` cannot observe different values, cannot observe a torn value, and need no synchronization — because there is no second write anywhere in the picture. Sharing a *mutable* object through a scoped value puts you right back in the memory model's territory, though: the binding is immutable, the object it points at is whatever you made it.

## Trade-offs

- **The value is readable only inside the dynamic extent that bound it.** You cannot bind once at startup and read anywhere later, the way some `ThreadLocal`-based frameworks are configured; every read has to sit under a `run()`/`call()` on the same thread, and code that ends up outside one fails loudly rather than degrading.

  ```java
  ScopedValue.where(CURRENT_USER, "alice").run(() -> doWork());
  CURRENT_USER.get();   // NoSuchElementException — extent already ended
  ```

- **"Key, not a container" is the mental model shift people trip over.** Developers coming from `ThreadLocal` expect the object itself to hold something and look for a setter; there isn't one, and code written on the wrong assumption tends to create a fresh `ScopedValue` per request, which nothing downstream can read.

- **Immutable and auto-cleaned vs. mutable and manually cleaned.** The `ThreadLocal` idiom pushes the correctness burden onto every call site; the scoped value form makes both properties structural.

  ```java
  // ThreadLocal — any code can set(), and forgetting remove() leaks on a pooled thread
  static final ThreadLocal<String> TL = new ThreadLocal<>();
  TL.set("alice");
  try {
      handle();          // callees may call TL.set(...) and change it for the caller
  } finally {
      TL.remove();       // must not forget this
  }

  // ScopedValue — no set() exists, teardown is not optional
  static final ScopedValue<String> SV = ScopedValue.newInstance();
  ScopedValue.where(SV, "alice").run(() -> handle());
  ```

- **Rebinding costs a scope, not an assignment.** Where `ThreadLocal` lets you swap a value with one statement, changing a scoped value means opening a nested `run()`/`call()` and moving the affected code into it — cleaner to reason about, but a real restructuring cost when it hits code that mutates context in several places.

- **Retrofitting an existing `ThreadLocal`-based stack is not a mechanical rename.** The bind site has to be hoisted to a point that encloses every read — typically a servlet filter or handler wrapper — and any library on the path that reads the old `ThreadLocal` keeps needing it, so mixed setups are common during migration.

- **Interop with frameworks and thread pools you don't control.** A task handed to an executor you did not create runs on a thread outside your extent, so the binding does not follow it; the value has to be captured explicitly and rebound inside the task if it needs to cross that boundary.

## Documentation Links

- [JEP 506 — Scoped Values](https://openjdk.org/jeps/506) — doc
- [ScopedValue — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) — doc
