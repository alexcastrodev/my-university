---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Structured concurrency says that if a task splits into concurrent subtasks, they all come back to the same place — the block that started them. `StructuredTaskScope` (JEP 505, **still a preview feature in Java 25**, its *fifth* preview iteration, with a sixth already planned for JDK 26) makes that a language-level shape rather than a convention: a scope is a `try`-with-resources block that owns every task forked inside it, and the closing brace does not run until every subtask has finished or been cancelled. Compare that with the unstructured pattern every Java developer already knows — `executor.submit()` hands you a `Future` that you can return, store in a field, or simply forget about, and the task behind it keeps running long after the method that created it returned. With a scope there is no such escape hatch: "fire and forget" is structurally impossible, sibling tasks are cancelled automatically when one of them fails, and the parent/child relationship shows up as real nesting in a thread dump instead of a flat pool of anonymous threads.

## Use Cases

- Fan-out I/O where you need *all* the answers: calling two or three microservices concurrently, combining their results, and failing the whole operation fast if any one of them fails — without hand-writing the "cancel the others" logic.
- Replacing a hand-rolled `CompletableFuture.allOf()` / `anyOf()` pipeline when what you actually want is short-circuit *cancellation* of the losing branch (a redundant-call/hedged-request pattern), not just discarding its eventual result.
- Adding a deadline to a whole fan-out operation as a property of the scope, instead of threading a timeout through every individual `Future.get(...)` call.
- Making a concurrent operation legible in a thread dump: subtasks appear nested under the scope's owner thread, so a stuck fan-out is diagnosable instead of being a wall of unattributed virtual threads.
- Propagating request context (user, tenant, trace id) into concurrent subtasks — subtasks forked in a scope inherit the caller's `ScopedValue` bindings, so no explicit passing and no `ThreadLocal` cleanup.

## Deep Dive

### The unstructured baseline: `ExecutorService` and `Future` bookkeeping

This is the shape most existing code has. It works, but nothing about it is enforced.

```java
// Unstructured: correct behaviour is entirely up to the author.
Profile loadProfile(long id) throws Exception {
    ExecutorService es = Executors.newVirtualThreadPerTaskExecutor();
    try {
        Future<String>      user   = es.submit(() -> fetchUser(id));
        Future<List<Order>> orders = es.submit(() -> fetchOrders(id));

        String u;
        try {
            u = user.get();               // blocks
        } catch (ExecutionException e) {
            orders.cancel(true);          // hand-written: cancel the sibling
            throw e;
        }

        List<Order> o;
        try {
            o = orders.get();
        } catch (ExecutionException e) {
            // user already finished; nothing to cancel, but if it hadn't...
            throw e;
        }
        return new Profile(u, o);
    } finally {
        es.shutdown();                    // easy to forget
    }
}
```

Three things are pure convention here. The cancel-the-sibling calls are hand-written and easy to get wrong (or to omit for one branch, as above). The `shutdown()` in `finally` is the only thing tying task lifetime to method lifetime — remove it and the tasks outlive the call. And nothing stops a caller from writing `return es.submit(...)` and handing the `Future` out of the method entirely, at which point the task's lifetime is unbounded. See [[concurrency-utilities-executors-and-synchronizers]] for the full `Future`/`CompletableFuture` story this builds on.

### The structured version of the same operation

```java
// preview — requires --enable-preview
import java.util.concurrent.StructuredTaskScope;
import java.util.concurrent.StructuredTaskScope.Subtask;

Profile loadProfile(long id) throws InterruptedException {
    try (var scope = StructuredTaskScope.open()) {
        Subtask<String>      user   = scope.fork(() -> fetchUser(id));
        Subtask<List<Order>> orders = scope.fork(() -> fetchOrders(id));

        scope.join();                      // wait for all; throws if any failed
        return new Profile(user.get(), orders.get());
    }                                      // close() -> cancels any straggler
}
```

Same work, none of the bookkeeping. `StructuredTaskScope.open()` is a **static factory** — the class has no public constructors, which is one of the API changes across preview iterations. `fork()` returns a `Subtask<T>`, *not* a `Future<T>`: it is a plain result holder with no `get()`-blocks-you semantics and no `cancel()`. The blocking happens in exactly one place, `scope.join()`, and the scope's `close()` guarantees that when control leaves the block, nothing forked inside it is still running.

### Completion policies: `Joiner`

The default policy is "wait for all, cancel everything on the first failure". Other policies are selected by passing a `Joiner` to `open()`:

| Factory | Policy |
|---------|--------|
| `StructuredTaskScope.open()` | Wait for all, cancel on failure |
| `StructuredTaskScope.open(Joiner.anySuccessfulResultOrThrow())` | First success wins |
| `StructuredTaskScope.open(Joiner.allSuccessfulOrThrow())` | All must succeed |

With `anySuccessfulResultOrThrow()`, `join()` itself returns the winning value and the losers are cancelled — this is the piece `CompletableFuture.anyOf()` does not give you, since `anyOf()` merely ignores the slower branch while it keeps running:

```java
// preview
String fetchFastest(long id) throws InterruptedException {
    try (var scope = StructuredTaskScope.open(
             StructuredTaskScope.Joiner.<String>anySuccessfulResultOrThrow())) {
        scope.fork(() -> fetchFrom("replica-a", id));
        scope.fork(() -> fetchFrom("replica-b", id));
        return scope.join();               // first success; the loser is cancelled
    }
}
```

`allSuccessfulOrThrow()` makes `join()` return a `Stream<Subtask<T>>` of the completed subtasks, which is convenient for a homogeneous fan-out over a list of inputs.

### What failure actually does

```java
// preview
try (var scope = StructuredTaskScope.open()) {
    Subtask<String>      user   = scope.fork(() -> fetchUser(id));          // slow, 5s
    Subtask<List<Order>> orders = scope.fork(() -> { throw new IOException("orders down"); });

    scope.join();                          // returns after ~0s, not 5s
    return new Profile(user.get(), orders.get());   // never reached
} catch (StructuredTaskScope.FailedException e) {
    // e.getCause() is the IOException thrown by the orders subtask
    throw new ProfileUnavailableException(e.getCause());
}
```

The moment `orders` throws, the scope cancels `user` — its thread is interrupted, and `join()` returns immediately instead of waiting out the slow call. `join()` then throws `FailedException` wrapping the original exception. This is what the earlier `ExecutorService` version needed explicit `cancel(true)` calls to approximate, and it applies to every subtask, not just the ones you remembered to write a `catch` for.

Reading a `Subtask` at the wrong time is a hard error rather than a silent block:

```java
// preview
try (var scope = StructuredTaskScope.open()) {
    Subtask<String> user = scope.fork(() -> fetchUser(id));
    String s = user.get();                 // IllegalStateException — join() not called yet
    scope.join();
}
```

### Configuration: deadlines, thread factory, and `ScopedValue` inheritance

A second `open()` overload takes a configuration function, so a timeout belongs to the whole operation instead of each individual call:

```java
// preview
try (var scope = StructuredTaskScope.open(
         StructuredTaskScope.Joiner.<Void>awaitAllSuccessfulOrThrow(),
         cf -> cf.withName("load-profile")
                 .withTimeout(Duration.ofSeconds(2)))) {
    scope.fork(() -> { audit(id); return null; });
    scope.fork(() -> { warmCache(id); return null; });
    scope.join();                          // TimeoutException after 2s; both cancelled
}
```

`withName(...)` is what makes the scope identifiable in a thread dump, with its subtasks nested underneath it. Subtasks also inherit the owner's `ScopedValue` bindings (`ScopedValue` itself is a *final*, non-preview feature as of Java 25), so request context flows into the fan-out without being passed explicitly:

```java
// preview (the scope; ScopedValue itself is standard in 25)
private static final ScopedValue<String> TENANT = ScopedValue.newInstance();

ScopedValue.where(TENANT, "acme").run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        scope.fork(() -> {
            TENANT.get();                  // "acme" — inherited from the scope owner
            return fetchUser(id);
        });
        scope.join();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
});
```

### Compiling and running it

Preview features are off by default and are not binary-compatible across releases, so both `javac` and `java` need the flag, plus an explicit release:

```bash
javac --release 25 --enable-preview Profile.java
java  --enable-preview Profile
```

Without it, compilation fails outright:

```text
error: StructuredTaskScope is a preview API and is disabled by default.
  (use --enable-preview to enable preview APIs)
```

## Trade-offs

- **It is still preview in Java 25, and the API has genuinely changed shape five times** — code written against an earlier preview does not compile against Java 25. The old `ShutdownOnFailure` subclass and public constructors are gone, replaced by static factories and `Joiner`; treat any pre-25 tutorial as wrong, not merely dated.
```java
// Pre-Java-25 preview shape — does not compile on 25
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) { // error: cannot find symbol
    scope.join();
    scope.throwIfFailed();                                      // error: cannot find symbol
}
```
- **Every compile *and* every run needs `--enable-preview`** — that flag has to reach your build tool, your test runner, your IDE, and your production launch command, and a class file compiled with preview features refuses to load on any other JDK version. That is a real deployment constraint, not a checkbox.
```text
java.lang.UnsupportedClassVersionError: Preview features are not enabled for Profile
  (class file version 69.65535). Try running with '--enable-preview'
```
- **Designed around virtual threads, but it does not require them** — the default thread factory creates one virtual thread per subtask, which is the intended pairing with [[thread-model-legacy-vs-virtual-threads]]; you *can* fork platform threads instead, but then the "one cheap thread per task" economics that make fan-out free go away, and a large fan-out becomes an OS-thread problem again.
```java
// preview — platform threads in a scope: legal, but against the design intent
try (var scope = StructuredTaskScope.open(
         StructuredTaskScope.Joiner.<Void>awaitAllSuccessfulOrThrow(),
         cf -> cf.withThreadFactory(Thread.ofPlatform().factory()))) {
    scope.fork(() -> { work(); return null; });
    scope.join();
}
```
- **"No task can outlive its scope" is a limitation as much as a feature** — if you genuinely need fire-and-forget background work that continues after the current request returns, a scope is the wrong tool by construction: `close()` will block until it finishes or cancel it. A plain `ExecutorService` with a lifetime tied to the application, not the call, is still the answer there.
```java
// A Subtask handed out of the scope is useless afterwards
Subtask<String> escaped;
try (var scope = StructuredTaskScope.open()) {
    escaped = scope.fork(() -> fetchUser(id));
    scope.join();
}                                          // close() ends the task's life here
escaped.get();                             // IllegalStateException — scope is closed
```
- **The blocking-`join()` style reads unfamiliar to teams fluent in `CompletableFuture` chains** — structured concurrency deliberately puts the wait back in the caller (cheap, because the caller is usually a virtual thread) instead of composing callbacks, and code review habits built around non-blocking pipelines tend to flag it as a regression at first.

## Documentation Links

- [JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505) — doc
- [StructuredTaskScope — Java SE 25 API docs (preview)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) — doc
- [JEP 506: Scoped Values](https://openjdk.org/jeps/506) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
