---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Every method and constructor has implicit restrictions on the values it accepts — an index must be non-negative, a reference must not be `null`, an amount must be positive. Checking those restrictions at the very top of the method body, before any computation or field assignment happens, is what lets a bad argument fail immediately and clearly instead of corrupting state or surfacing as a confusing error somewhere else entirely. This concept is about *when* and *where* to validate and throw — not the mechanics of `throw`/`throws`/checked-vs-unchecked (see the Exception Handling Fundamentals concept for that).

## Use Cases

- Validating constructor parameters before they're assigned to fields, so an object can never come into existence in a state that violates its own invariants.
- Guarding a public method's arguments with explicit checks (and a documented `@throws`), instead of letting an invalid value flow into the method's logic and fail somewhere unrelated.
- Using `Objects.requireNonNull` with a descriptive message so a `null` argument fails with a pointer to *which* argument, instead of a bare `NullPointerException` later.
- Validating a non-public helper method's preconditions with `assert`, getting a safety net during development at essentially no cost in production.
- Rejecting an out-of-range index or a malformed value at the API boundary, instead of computing silently wrong output.

## Deep Dive

### Fail fast at the top of the method

A method that stores a caller-supplied value without checking it doesn't avoid the problem — it just moves the failure somewhere else, later, and disconnects it from its actual cause. Here's a factory method that wraps an `int[]` in a `List` view but never checks the array it's handed:

```java
static List<Integer> intArrayAsList(int[] a) {
    // 'a' is captured for later use — never validated here
    return new AbstractList<Integer>() {
        public Integer get(int i) { return a[i]; }
        public int size()         { return a.length; }
    };
}
```

```java
List<Integer> view = intArrayAsList(null);   // compiles, returns a perfectly normal-looking List
// ... view gets passed to another layer, stored in a field, returned from a getter ...
int first = view.get(0);   // NullPointerException — but the real mistake happened far away, at the intArrayAsList call
```

The exception is real, but by the time it's thrown, the stack trace points at `get(0)`, not at the caller who passed `null` in the first place — tracking down the actual bug means walking backward through everything that touched `view` in between. Checking the parameter at the top of the method fixes exactly this:

```java
static List<Integer> intArrayAsList(int[] a) {
    Objects.requireNonNull(a, "a must not be null");
    return new AbstractList<Integer>() {
        public Integer get(int i) { return a[i]; }
        public int size()         { return a.length; }
    };
}
```

Now `intArrayAsList(null)` throws immediately, at the actual mistake, with a message naming the actual parameter. This is also why constructor parameters deserve special attention: a constructor that skips validation and stores a bad value doesn't just risk one bad call — it lets an object exist that violates its own invariants for its entire lifetime, so *every* later method call on it is now suspect. And it isn't only about exceptions — a method that never validates can just as easily return normally with a silently wrong result, which is worse: nothing crashes, so nothing points at the bug at all.

### Objects.requireNonNull and picking the right exception type

`Objects.requireNonNull` is the standard, one-line way to null-check a parameter and fail with a clear message rather than a bare `NullPointerException` from whatever line happens to dereference it first:

```java
public final class Order {
    private final Customer customer;
    private final List<LineItem> items;

    public Order(Customer customer, List<LineItem> items) {
        this.customer = Objects.requireNonNull(customer, "customer must not be null");
        this.items = Objects.requireNonNull(items,
                () -> "items must not be null for customer " + customer.id());
    }
}
```

The overload taking a `String` builds the message eagerly; the overload taking a `Supplier<String>` only calls it if the check actually fails, which matters when building the message itself isn't free (here, `customer.id()` only runs on the failure path — and only after the `customer` check already passed).

Not every bad argument is a `null`, so the exception type should match the kind of violation:

```java
public void withdraw(long amountCents) {
    if (amountCents <= 0)
        throw new IllegalArgumentException("amountCents must be positive: " + amountCents);
    if (amountCents > balanceCents)
        throw new IllegalArgumentException("insufficient funds: balance=" + balanceCents + ", requested=" + amountCents);
    balanceCents -= amountCents;
}
```

For a bad index specifically, `IndexOutOfBoundsException` is the conventional choice — and `Objects.checkIndex(int index, int length)` does the range check for you, throwing it automatically when `index < 0` or `index >= length`:

```java
public char charAt(String s, int index) {
    Objects.checkIndex(index, s.length());   // throws IndexOutOfBoundsException if out of range
    return s.charAt(index);
}
```

All three — `NullPointerException`, `IllegalArgumentException`, `IndexOutOfBoundsException` — are unchecked, and that's intentional: an invalid argument is normally a programming mistake, not a condition the immediate caller is expected to recover from at run time. Documenting them is still part of the method's contract: a public method's Javadoc should list every validity restriction on its parameters via `@throws`, so the constraint and the failure it produces are visible before anyone reads the implementation:

```java
/**
 * Withdraws the given amount from this account.
 *
 * @param amountCents the amount to withdraw, in cents; must be positive
 * @throws IllegalArgumentException if amountCents is not positive, or exceeds the current balance
 */
public void withdraw(long amountCents) { ... }
```

### assert for internal invariants — and why it's the wrong tool for public parameters

For a non-public method, the caller is your own code, so instead of a full validity check you can state an *assumption* with `assert` and let the JVM verify it during development:

```java
// package-private helper — only called by sort() in this same class
private static void merge(long[] a, int lo, int mid, int hi) {
    assert a != null;
    assert lo >= 0 && lo <= mid && mid <= hi && hi <= a.length;
    // ... perform the merge, trusting these hold ...
}
```

An `assert` is disabled by default: the JVM must be started with `-ea` (or `-enableassertions`) for the condition to actually be evaluated. With assertions disabled, an `assert` statement costs essentially nothing at run time — it degenerates to a single cheap flag check that skips straight past it — which is exactly why it's suited to invariants you want checked hard in development and test, without paying for it in production. When an enabled assertion's condition is `false`, it throws `AssertionError`, not any of the standard validation exceptions.

That difference is exactly why `assert` is the wrong tool for validating a *public* method's parameters. Oracle's own assertions guide states this directly: "do not use assertions for argument checking in public methods." A public method's parameter contract must be enforced whether or not `-ea` was passed — using `assert` there means the check silently vanishes in any deployment that doesn't happen to enable assertions:

```java
// WRONG — a public method whose only protection is an assert
public void setRefreshRate(int rate) {
    assert rate > 0 && rate <= MAX_REFRESH_RATE;   // gone entirely without -ea
    this.rate = rate;
}
```

```java
// RIGHT — enforced unconditionally, and throws the type callers actually expect
public void setRefreshRate(int rate) {
    if (rate <= 0 || rate > MAX_REFRESH_RATE)
        throw new IllegalArgumentException("Illegal rate: " + rate);
    this.rate = rate;
}
```

## Trade-offs

- **Validating everywhere adds boilerplate, and a little run-time cost** — every public entry point now runs extra checks before doing real work. That's a reasonable price for safety at an API boundary, but it's easy to over-apply: re-validating the same already-checked value at every internal layer it passes through just duplicates cost without catching anything new.
- **Some restrictions are cheaper to enforce implicitly than explicitly** — if the computation itself will naturally fail on bad input with an appropriate exception, an explicit pre-check can be redundant work:
  ```java
  List<Object> list = new ArrayList<>(List.of("a", "b", 1)); // 1 isn't Comparable to String
  Collections.sort((List) list); // no pre-check needed — throws ClassCastException naturally, mid-sort
  ```
- **`Objects.requireNonNull`'s `Supplier` overload defers the cost of building the message** — passing a plain `String` builds that message on every call, even the non-null path; a `Supplier<String>` is only invoked when the check actually fails.
  ```java
  Objects.requireNonNull(items, () -> "items must not be null for order " + orderId); // concatenation runs only on failure
  ```
- **`assert` is opt-in, and that opt-in is easy to forget** — because assertions are disabled by default, a team that never runs its test suite with `-ea` gets none of the checking those asserts were meant to provide, with no warning that it's missing.
  ```
  java -ea  -cp out com.example.Main   # assertions run
  java      -cp out com.example.Main   # same code, assertions silently skipped
  ```

## Documentation Links

- [Objects (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Objects.html) — doc
- [IllegalArgumentException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IllegalArgumentException.html) — doc
- [IndexOutOfBoundsException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IndexOutOfBoundsException.html) — doc
- [NullPointerException (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/NullPointerException.html) — doc
- [AssertionError (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AssertionError.html) — doc
- [Chapter 14.10, The assert Statement — The Java Language Specification (SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html) — doc
- [Programming With Assertions — Oracle](https://docs.oracle.com/javase/8/docs/technotes/guides/language/assert.html) — doc
- [JavaDoc Documentation Comment Specification for the Standard Doclet (JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/specs/javadoc/doc-comment-spec.html) — doc
