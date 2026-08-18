---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`CompletableFuture<T>` is three things at once. It *is* a `Future<T>`, so it still has `get()` and `cancel()`. It is a **composable pipeline**: `thenApply()`, `thenCompose()`, `thenCombine()`, `exceptionally()` and friends attach work that runs *when* the value arrives, without a thread sitting blocked waiting for it. And — the part the name comes from — it is **completable from the outside**: anyone holding the object can call `complete(value)` or `completeExceptionally(ex)`, whereas a plain `Future` is only ever completed by the task that produced it, from inside the executor. Together those make it a first-class object representing "a value that will exist eventually", one you can transform, combine, and react to as an ordinary variable. The [[concurrency-utilities-executors-and-synchronizers]] concept makes the case for reaching for it over raw `Future`; this one is about the composition mechanics themselves.

## Use Cases

- Fanning out to several *independent* async calls — a user service, a pricing service, an inventory service — and combining their results once all of them finish, via `thenCombine()` for two or `allOf()` for many.
- Chaining a sequence of *dependent* async steps, where each call needs the previous call's result to even know what to request: look up the account id, then fetch that account's orders, then enrich each order. That is `thenCompose()`.
- Attaching error handling as part of the pipeline (`exceptionally()`, `handle()`) instead of wrapping a blocking `get()` in `try`/`catch` — the fallback lives next to the step it protects, and the calling thread never blocks to learn about the failure.
- Starting async work from an otherwise synchronous method without blocking the caller: a Spring MVC controller can `return CompletableFuture<Response>` and the servlet container releases the request thread until the future completes.
- Bridging a callback-based or listener-based API (an old NIO handler, a driver's `onSuccess`/`onError` pair) into something composable, by handing the callback a bare `CompletableFuture` for it to `complete()`.

## Deep Dive

### Creating one: `supplyAsync`, `runAsync`, and manual completion

```java
import java.util.concurrent.*;

// Returns a value. Runs on ForkJoinPool.commonPool() by default.
CompletableFuture<Integer> price = CompletableFuture.supplyAsync(() -> computePrice("SKU-1"));

// No return value — a side effect only.
CompletableFuture<Void> logged = CompletableFuture.runAsync(() -> auditLog("priced SKU-1"));

// Already-known value, no async work at all (useful in tests and cache hits).
CompletableFuture<Integer> cached = CompletableFuture.completedFuture(42);
```

Both `supplyAsync` and `runAsync` take an optional second argument, an `Executor`. **Without it, the work runs on the shared `ForkJoinPool.commonPool()`** — the same pool `parallelStream()` uses (see [[fork-join-framework]]). That default is fine for short, non-blocking transformations and a genuine trap for anything CPU-heavy or blocking:

```java
ExecutorService io = Executors.newFixedThreadPool(16);

// Explicit pool: this call blocks on a socket, and it must not do that on the common pool.
CompletableFuture<String> body = CompletableFuture.supplyAsync(() -> httpGet(url), io);
```

The third creation route is the bare constructor, for bridging an API that only knows how to call you back:

```java
CompletableFuture<Response> bridge(Request req) {
    CompletableFuture<Response> cf = new CompletableFuture<>();
    legacyClient.send(req, new Callback() {
        public void onSuccess(Response r) { cf.complete(r); }            // fulfils it
        public void onFailure(Throwable t) { cf.completeExceptionally(t); } // fails it
    });
    return cf;                       // returned before it has a value
}
```

`complete()` returns `true` if this call is the one that transitioned the future to done, `false` if it was already completed — so the first caller wins and later ones are silently ignored, which is exactly what you want when a callback can fire a success and a timeout race each other.

### `thenApply` and `thenApplyAsync`: transforming the result

`thenApply(Function<T, U>)` produces a new `CompletableFuture<U>` holding the transformed value. Nothing blocks; the function runs later, when the upstream future completes.

```java
CompletableFuture<Integer> cents = CompletableFuture.supplyAsync(() -> fetchPriceString("SKU-1")) // "19.99"
        .thenApply(String::trim)
        .thenApply(s -> s.replace(".", ""))
        .thenApply(Integer::parseInt);   // CompletableFuture<Integer>, still not blocking

int value = cents.join();                // only here does the caller wait
```

The non-`Async` variant runs the function on **whichever thread completed the upstream future** — or on the calling thread, if the future was already complete when `thenApply` was invoked. That is cheap and correct for trivial mapping. When the transformation is real work, use `thenApplyAsync` so it is handed to a pool instead of squatting on someone else's thread:

```java
// Bad: renderPdf() runs on the HTTP client's I/O callback thread, blocking its event loop.
CompletableFuture<byte[]> a = fetchInvoice(id).thenApply(inv -> renderPdf(inv));

// Good: the heavy step is dispatched to a pool chosen for it.
CompletableFuture<byte[]> b = fetchInvoice(id).thenApplyAsync(inv -> renderPdf(inv), renderPool);
```

Every composition method has this pairing: `thenAccept`/`thenAcceptAsync` (consume, return `Void`), `thenRun`/`thenRunAsync` (ignore the value, run a `Runnable`), and so on.

### `thenCompose` vs `thenApply`: the nested-future trap

The distinction is entirely about what your function returns. If it returns a plain value, use `thenApply`. If it returns *another* `CompletableFuture` — because the next step is itself async — `thenApply` wraps that future inside your future and you get a doubly-nested type:

```java
CompletableFuture<Long>    findAccountId(String email) { ... }
CompletableFuture<Account> loadAccount(long id)        { ... }

// Wrong: the function returns CompletableFuture<Account>, so thenApply gives you a future of a future.
CompletableFuture<CompletableFuture<Account>> nested =
        findAccountId(email).thenApply(id -> loadAccount(id));

Account a = nested.join().join();     // two joins — the smell that says you used the wrong method
```

`thenCompose` flattens it — the same relationship `flatMap` has to `map` on a `Stream` or an `Optional`:

```java
// Right: one future, one result type.
CompletableFuture<Account> account =
        findAccountId(email).thenCompose(id -> loadAccount(id));

CompletableFuture<List<Order>> orders =
        findAccountId(email)
            .thenCompose(id -> loadAccount(id))
            .thenCompose(acct -> loadOrders(acct.region(), acct.id()));  // each step needs the last
```

Note that the second `loadOrders` call cannot even be *started* until `loadAccount` finishes — that is the defining property of a `thenCompose` chain, and the reason it is the wrong tool for calls that do not depend on each other.

### `thenCombine`: joining two independent futures

When two calls have no dependency on each other, they should run concurrently and only meet at the end. `thenCombine(other, BiFunction)` does exactly that: both futures are already in flight, and the `BiFunction` runs once both are done.

```java
CompletableFuture<User>  user  = CompletableFuture.supplyAsync(() -> fetchUser(id), io);
CompletableFuture<Quota> quota = CompletableFuture.supplyAsync(() -> fetchQuota(id), io);
// both HTTP calls are already running concurrently at this point

CompletableFuture<Dashboard> dash =
        user.thenCombine(quota, (u, q) -> new Dashboard(u, q));

Dashboard d = dash.join();   // total latency ≈ max(user, quota), not the sum
```

Contrast the two shapes directly:

```java
// Dependent  — sequential by necessity: B needs A's result.       latency = A + B
findAccountId(email).thenCompose(id -> loadAccount(id));

// Independent — concurrent: neither needs the other's result.     latency = max(A, B)
fetchUser(id).thenCombine(fetchQuota(id), Dashboard::new);
```

Using `thenCompose` where `thenCombine` belongs compiles fine and quietly serialises two calls that could have overlapped — a latency bug with no error message.

### `allOf` and the `CompletableFuture<Void>` gotcha

`CompletableFuture.allOf(f1, f2, f3)` completes when every argument has completed. It does **not** hand you the results — its return type is `CompletableFuture<Void>`, because the arguments are `CompletableFuture<?>` of possibly different types and there is nothing sensible to combine them into:

```java
CompletableFuture<String>  a = CompletableFuture.supplyAsync(() -> callA(), io);
CompletableFuture<Integer> b = CompletableFuture.supplyAsync(() -> callB(), io);

CompletableFuture<Void> all = CompletableFuture.allOf(a, b);
// all.join() returns null — the results are still in a and b
```

The idiom is to keep the original references and read them *after* `allOf` completes. Those `join()` calls do not block, because `allOf` only completed once every one of them was already done:

```java
Report report = CompletableFuture.allOf(a, b)
        .thenApply(v -> new Report(a.join(), b.join()))   // safe: a and b are finished
        .join();
```

For a homogeneous fan-out, collect the futures into a list first, then stream over it:

```java
List<CompletableFuture<Price>> futures = skus.stream()
        .map(sku -> CompletableFuture.supplyAsync(() -> fetchPrice(sku), io))
        .toList();                                        // toList() first — all calls now in flight

List<Price> prices = CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
        .thenApply(v -> futures.stream().map(CompletableFuture::join).toList())
        .join();
```

The `.toList()` on the first pipeline is load-bearing: a lazy stream would start each `supplyAsync` only as the terminal operation pulled it, defeating the fan-out.

### `anyOf`: first one wins, at the cost of the type

```java
CompletableFuture<String> replicaA = CompletableFuture.supplyAsync(() -> read("replica-a"), io);
CompletableFuture<String> replicaB = CompletableFuture.supplyAsync(() -> read("replica-b"), io);

CompletableFuture<Object> first = CompletableFuture.anyOf(replicaA, replicaB);
String winner = (String) first.join();   // cast required — anyOf is Object-typed
```

`anyOf` completes with the result of whichever input completes first, success *or* failure — a fast failure beats a slow success. And it only ignores the loser; it does not cancel it, so the slower replica read keeps running to completion in the background.

### Failure: `exceptionally`, `handle`, and `whenComplete`

An exception thrown anywhere in the chain skips every downstream `thenApply`/`thenCompose` and travels to the first handler that can deal with it.

```java
CompletableFuture<Price> priced = CompletableFuture.supplyAsync(() -> fetchPrice(sku), io)
        .exceptionally(ex -> Price.UNKNOWN);   // recover with a fallback; pipeline continues
```

- **`exceptionally(Function<Throwable, T>)`** — runs *only* on failure, returns a replacement value of the same type. The `catch` block of the pipeline.
- **`handle(BiFunction<T, Throwable, U>)`** — runs on *both* paths, receiving `(result, null)` on success and `(null, throwable)` on failure, and returns a new value that may change the type. This is how you implement "whatever happened, produce this" while still seeing which happened.
- **`whenComplete(BiConsumer<T, Throwable>)`** — an observer. It sees the outcome but cannot change it: the value passes through unchanged, and **a failure still propagates downstream** after the consumer runs. The `finally` block of the pipeline.

```java
CompletableFuture<String> result = CompletableFuture.supplyAsync(() -> callService(), io)
        .whenComplete((v, ex) -> metrics.record(ex == null ? "ok" : "fail"))  // observes only
        .handle((v, ex) -> ex == null ? v : "degraded: " + ex.getMessage());  // decides the outcome
```

Swap those two and the behaviour changes materially: after `handle` recovers, `whenComplete` would see a *successful* stage and record `"ok"` for a call that actually failed.

One detail that catches people: the `Throwable` handed to a *downstream* stage is usually a `CompletionException` wrapping the real failure, not the failure itself.

```java
.exceptionally(ex -> {
    // ex is CompletionException; the IOException you threw is one level down
    Throwable cause = (ex instanceof CompletionException ce) ? ce.getCause() : ex;
    log.warn("lookup failed", cause);
    return Price.UNKNOWN;
})
```

Java 9 added two timeout helpers in the same spirit — `orTimeout(2, TimeUnit.SECONDS)` fails the future with a `TimeoutException` if it has not completed in time, and `completeOnTimeout(fallback, 2, TimeUnit.SECONDS)` completes it with a default value instead.

### `get()` vs `join()`

Both wait for the result. They differ only in their exception discipline:

| | throws on failure | checked? |
|---|---|---|
| `get()` | `ExecutionException` (plus `InterruptedException`) | yes |
| `join()` | `CompletionException` | no |

Both wrap the same original exception, reachable via `getCause()`. Because `get()`'s exceptions are checked, it cannot be used inside a lambda that does not declare them — which is every `Stream` operation:

```java
// Does not compile: unhandled ExecutionException / InterruptedException in the lambda.
List<Price> prices = futures.stream().map(CompletableFuture::get).toList();

// Compiles: join() throws only the unchecked CompletionException.
List<Price> prices = futures.stream().map(CompletableFuture::join).toList();
```

That is the whole reason `join()` exists, and why it is the one you reach for inside pipelines. Reserve `get(timeout, unit)` for the case where you genuinely need a bounded wait, since `join()` has no timeout overload.

## Trade-offs

- **The default `commonPool()` is the wrong pool for most real work** — `supplyAsync` without an `Executor` runs on `ForkJoinPool.commonPool()`, which is sized to `availableProcessors() - 1` and shared with every `parallelStream()` in the JVM. A blocking or CPU-saturating task there starves unrelated parallel-stream code, and that code starves yours right back. (On a single-core machine the common pool has zero parallelism and each task gets its own fresh thread instead — different behaviour again, for the same source code.)
  ```java
  // 8 blocking calls on a 4-core box: the common pool has ~3 workers, so they queue,
  // and every parallelStream() elsewhere in the JVM queues behind them too.
  var futures = urls.stream().map(u -> CompletableFuture.supplyAsync(() -> httpGet(u))).toList();

  // Fix: give the blocking work its own executor.
  var futures = urls.stream().map(u -> CompletableFuture.supplyAsync(() -> httpGet(u), io)).toList();
  ```
- **Long chains are genuinely hard to debug, not just verbose** — this is the standard, well-earned criticism of the API. Each stage is a separate lambda invoked from pool internals, so a stack trace shows the framework's plumbing rather than the path your code took, and no single breakpoint sits "inside" the flow. Synchronous code gets a trace that reads like the program; a chained pipeline does not.
  ```text
  java.util.concurrent.CompletionException: java.lang.NumberFormatException: For input string: "n/a"
      at java.base/java.util.concurrent.CompletableFuture.encodeThrowable(...)
      at java.base/java.util.concurrent.CompletableFuture$UniApply.tryFire(...)
      at java.base/java.util.concurrent.CompletableFuture$AsyncSupply.run(...)
      at java.base/java.util.concurrent.ForkJoinTask$RunnableExecuteAction.exec(...)
  Caused by: java.lang.NumberFormatException: For input string: "n/a"
      at PriceService.lambda$quote$3(PriceService.java:41)   <- the only line that is yours
  ```
- **An exception in a chain nobody waits on disappears** — a failed `CompletableFuture` does not print anything, does not reach an `UncaughtExceptionHandler`, and does not fail the JVM. It just sits there holding an exception nobody asked for. Fire-and-forget composition therefore loses failures silently unless you terminate every chain with `join()`/`get()` or an explicit handler.
  ```java
  // Nothing is ever printed; the parse failure is stored in a future no one reads.
  CompletableFuture.supplyAsync(() -> "n/a")
                   .thenApply(Integer::parseInt)
                   .thenAccept(n -> cache.put(sku, n));   // never runs — and never complains

  // Fix: end every chain with a handler (or join it).
  CompletableFuture.supplyAsync(() -> "n/a")
                   .thenApply(Integer::parseInt)
                   .thenAccept(n -> cache.put(sku, n))
                   .exceptionally(ex -> { log.error("warm-up failed", ex); return null; });
  ```
- **`allOf`/`anyOf` lose type information at the API boundary** — `allOf` returns `CompletableFuture<Void>` and `anyOf` returns `CompletableFuture<Object>`, so the type system stops helping precisely where a fan-out is most error-prone. Both need the surrounding idiom (keeping references, or a cast) rather than composing cleanly.
  ```java
  CompletableFuture<String> a = ..., b = ...;
  String s = CompletableFuture.anyOf(a, b).join();     // error: Object cannot be converted to String
  String t = (String) CompletableFuture.anyOf(a, b).join();  // the cast the API forces on you
  ```
- **For fan-out-with-cancellation, `StructuredTaskScope` is now the better-shaped tool** — a scope cancels the losing or sibling branches automatically and ties every subtask's lifetime to the enclosing block, which is exactly what `allOf`/`anyOf` do not do (see [[structured-concurrency]]). `CompletableFuture` remains the right choice where the work is genuinely independent, reactive, or externally completed — a callback bridge, a cache warm-up, a controller returning a future to its container — none of which fit a block-scoped lifetime.

## Documentation Links

- [CompletableFuture — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html) — doc
- [CompletionStage — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletionStage.html) — doc
- [ForkJoinPool.commonPool() — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html#commonPool()) — doc
