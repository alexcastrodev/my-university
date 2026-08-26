---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Knowing the syntax of `try`/`catch`/`throw` doesn't tell you when an exception is the right tool, or what kind of exception to design. Two decisions sit above the mechanics: whether a failure should be modeled as an exception at all rather than as ordinary logic, and — once you've decided a new exception type is warranted — whether it should be checked (the compiler forces every caller to confront it) or unchecked (a `RuntimeException` nobody is required to catch). Both are API-design calls with real consequences for how pleasant, or painful, your code is to call.

## Use Cases

- Deciding whether a state-dependent operation (one that can only succeed under certain conditions) should throw on failure, or expose a state-testing check the caller can consult first.
- Defining a new exception type for a library or module boundary and needing a rule for checked vs. unchecked, rather than picking one by habit.
- Reviewing an existing API where every call site wraps a method in a `try`/`catch` that does nothing useful, to decide whether the checked exception should be removed.
- Designing recoverable failure paths (retryable I/O, insufficient funds, invalid user input) versus non-recoverable ones (a violated method precondition, a bug).

## Deep Dive

### Exceptions are for exceptional conditions, not control flow

Exceptions look like ordinary control flow — a `throw` transfers control just like a `return` or `break` — but a JVM does not optimize the exception path the way it optimizes normal branches, and constructing a `Throwable` captures a stack trace, which costs real time. A now-classic anti-pattern exploits (and abuses) this shape: using an out-of-bounds exception to terminate a loop instead of testing the bound directly.

```java
// Anti-pattern — do not do this.
int i = 0;
try {
  while (true) {
    process(items[i++]);
  }
} catch (ArrayIndexOutOfBoundsException e) {
  // "normal" loop termination
}
```

against the idiom every Java developer recognizes on sight:

```java
for (int i = 0; i < items.length; i++) {
  process(items[i]);
}
```

The exception-based version is not just harder to read — it is measurably slower, since the `try` block inhibits JVM optimizations available to plain loops, and the exception path itself is not built for speed. Worse, it is not even reliably correct: if `process` itself contains a bug that throws an unrelated `ArrayIndexOutOfBoundsException` (say, from indexing into a *different* array inside that call), the `catch` swallows it and misreports it as ordinary loop termination. A plain bound check can never confuse a real bug with a normal exit; the exception-based version can, silently.

The same principle shapes API design, not just loop idioms: a well-designed API should not force its callers to use exceptions for ordinary, expected outcomes. `Iterator` is the standard example — `hasNext()` is a state-testing method that lets a caller check whether `next()` is safe to call, so the normal iteration idiom never needs a `try`/`catch`:

```java
Iterator<String> it = list.iterator();
while (it.hasNext()) {
  String s = it.next();
  // ...
}
```

Without `hasNext()`, callers would be stuck catching `NoSuchElementException` just to detect the end of a collection — exactly the abuse shown above, baked into an API instead of a loop. When you're designing a method that can only be safely called in certain states, prefer exposing a state-testing method (or returning a sentinel/`Optional`) over making failure the only way to find out.

### Choosing checked vs. unchecked when you define a new exception type

Java gives you two real choices for a new exception type: subclass `Exception` (checked — the compiler requires every caller to catch it or declare it) or subclass `RuntimeException` (unchecked — the compiler enforces nothing). The design test is simple: **can the caller reasonably be expected to recover from this condition?** If yes, checked; if the condition signals a bug — a violated precondition, invalid internal state — unchecked.

A checked exception for a condition the caller can act on:

```java
public class InsufficientFundsException extends Exception {
  private final BigDecimal shortfall;

  public InsufficientFundsException(BigDecimal shortfall) {
    super("Short by " + shortfall);
    this.shortfall = shortfall;
  }

  public BigDecimal getShortfall() {
    return shortfall;
  }
}

public void withdraw(BigDecimal amount) throws InsufficientFundsException {
  if (amount.compareTo(balance) > 0) {
    throw new InsufficientFundsException(amount.subtract(balance));
  }
  balance = balance.subtract(amount);
}
```

The caller has a real recovery path — prompt for a smaller amount, offer a top-up — and the checked exception's `getShortfall()` accessor gives it the data to do so. Forcing every caller to at least acknowledge this outcome is a feature, not friction, because ignoring it silently would be a real bug.

An unchecked exception for a precondition violation — a programming error, not a business outcome:

```java
public void withdraw(BigDecimal amount) {
  if (amount.signum() < 0) {
    throw new IllegalArgumentException("amount must not be negative: " + amount);
  }
  // ...
}
```

There is nothing a caller can meaningfully "recover" from here — passing a negative amount is a bug in the caller's own code, and the fix is to change that code, not to catch an exception at run time. Making this checked would force every call site to wrap a call in `try`/`catch` for a condition that should never happen if the caller is correct. `IllegalArgumentException`, `IllegalStateException`, and `NullPointerException` are the standard unchecked types the JDK itself uses for exactly this purpose — reach for them (or a `RuntimeException` subclass of your own) before inventing a checked exception for a bug condition. When it's genuinely unclear whether a failure is recoverable, default to unchecked: an unnecessary checked exception has a real cost, covered next.

### Why an unnecessary checked exception is worse than none

A checked exception is a mandate: every caller must handle it or propagate it. That's valuable when there's something useful to do in response — it's a tax with no return when there isn't. A litmus test for whether a checked exception is pulling its weight: imagine the best `catch` block a caller could realistically write. If it looks like this,

```java
try {
  configLoader.reload();
} catch (ConfigReloadException e) {
  throw new AssertionError("can't happen", e); // caller has no real recovery
}
```

or this,

```java
try {
  configLoader.reload();
} catch (ConfigReloadException e) {
  e.printStackTrace(); // oh well
}
```

the checked exception isn't buying safety, it's buying boilerplate — every call site either fabricates a "can't happen" wrapper or quietly discards the failure, which is worse than not forcing a `catch` at all. Two better designs exist depending on whether the failure is really exceptional:

Redesigned with an unchecked exception, when reload failures really are a bug/environment problem the caller can't act on per-call:

```java
public void reload() {
  if (!configFile.exists()) {
    throw new ConfigReloadException("missing config file: " + configFile);
  }
  // ...
}
// ConfigReloadException extends RuntimeException — no throws clause,
// no forced catch; callers that can meaningfully react still may.
```

Or, when there are genuinely two ordinary outcomes rather than one ordinary and one exceptional, skip the exception entirely and return an `Optional`:

```java
public Optional<Config> tryReload() {
  if (!configFile.exists()) {
    return Optional.empty();
  }
  return Optional.of(parse(configFile));
}

// call site reads as plain control flow, no try/catch anywhere
tryReload().ifPresentOrElse(
    this::applyConfig,
    () -> log.warn("no config file, keeping previous settings")
);
```

Both alternatives remove the forced `try`/`catch` from every call site while still surfacing the failure to callers that actually want to check for it — the `Optional`-returning form is strictly a better fit than either checked or unchecked when "missing config" is a normal, expected outcome rather than a bug or a rare failure.

## Trade-offs

- **A checked exception is a promise the caller can act on — make sure that's true before adding one.** Before subclassing `Exception`, write out the best realistic `catch` block for it; if it can only rethrow, log-and-exit, or assert "can't happen," the condition probably belongs on an unchecked type instead.
- **State-testing methods avoid exceptions entirely for expected outcomes, but only when state can't change between the check and the call.** `hasNext()`/`next()` works because nothing external mutates the iterator between the two calls in single-threaded use; under concurrent access without external synchronization, the state could change between the check and the action, so a distinguished return value (or catching the exception) is the only safe option:
  ```java
  // unsafe under concurrent access: state may change between the two calls
  if (queue.hasNext()) {
    Item i = queue.next(); // could still throw if another thread drained it
  }
  ```
- **Unchecked exceptions trade compile-time enforcement for a lighter API — and that trade isn't reversible casually.** Once callers rely on a method *not* forcing a `catch`, later turning that exception checked breaks every one of those call sites at compile time; deciding checked-vs-unchecked is easiest to get right the first time a new exception type is introduced.
- **A single checked exception on an otherwise `try`-free method costs more than the same exception on a method that already has others.** If a method throws two checked exceptions, the caller is already in a `try` block for the first one, and the second only adds a `catch`; if it's the only one, the checked exception alone forces the caller to wrap an otherwise straight-line call — worth weighing when a method throws exactly one checked type.
- **`Optional` communicates "no result" cleanly, but it isn't a drop-in exception replacement when failure needs an explanation.** `Optional.empty()` carries no information about *why* — no shortfall amount, no error code — so it fits a genuinely binary present/absent outcome, not a failure a caller needs to diagnose or display.

## Documentation Links

- [Exception (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Exception.html) — doc
- [RuntimeException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html) — doc
- [Optional (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) — doc
- [Iterator (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) — doc
- [Unchecked Exceptions — The Controversy — The Java Tutorials](https://docs.oracle.com/javase/tutorial/essential/exceptions/runtime.html) — doc
