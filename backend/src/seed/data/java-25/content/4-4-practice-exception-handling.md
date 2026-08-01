# Practice: Exception Handling

> Five exercises covering what the slides in this module introduced —
> `finally` overriding a `return`, `finally` swallowing an exception,
> try-with-resources close order and suppressed exceptions, the implicitly
> final multi-catch variable, and custom checked-exception constructor
> chaining. Try to answer before opening each explanation.

---

## Exercise 1 — `return` in `try` vs. `return` in `finally`

```java
static int compute() {
    try {
        return 10;
    } finally {
        return 20;
    }
}

public static void main(String[] args) {
    System.out.println(compute());
}
```

What's printed?

<details>
<summary>Answer</summary>

```
20
```

The `try` block's `return 10;` schedules `10` as the return value, but
before the method actually returns, `finally` must run. Since `finally`
itself contains a `return` statement, that `return` **completes abruptly
and overrides** the pending return — the method returns `20` instead. The
`try` block's return value is discarded entirely; it's as if `return 10;`
never happened.

This is exactly the "Return in try/catch vs finally" rule from the
slides: when both a `try`/`catch` and `finally` contain a `return`, the
`finally` return always wins. (The same override happens if `finally`
contains a `throw` — it replaces a pending return too.)

</details>

---

## Exercise 2 — An exception thrown in `finally`

```java
static void risky() {
    try {
        throw new RuntimeException("original");
    } finally {
        throw new IllegalStateException("from finally");
    }
}

public static void main(String[] args) {
    try {
        risky();
    } catch (Exception e) {
        System.out.println(e.getClass().getSimpleName());
        System.out.println(e.getMessage());
    }
}
```

What's printed? What happened to the `RuntimeException`?

<details>
<summary>Answer</summary>

```
IllegalStateException
from finally
```

The `try` block completes abruptly by throwing `RuntimeException("original")`.
Before that exception can propagate, `finally` runs — and `finally` itself
completes abruptly by throwing `IllegalStateException("from finally")`.
Per the rule "if `finally` itself throws, the original exception is
suppressed (lost)," the `finally` block's abrupt completion **replaces**
the try block's abrupt completion outright. The `RuntimeException` is not
attached anywhere, not chained as a cause, not recoverable — it simply
vanishes. Only the `IllegalStateException` propagates out of `risky()`
and is what the `catch` block sees.

This is a good contrast with Exercise 3: a plain `finally` block that
throws *discards* the original exception, whereas try-with-resources
(covered next) *preserves* the original and attaches the secondary one as
suppressed instead. That difference — silent data loss vs. a recoverable
suppressed exception — is exactly why try-with-resources is preferred for
cleanup code that itself might throw.

</details>

---

## Exercise 3 — try-with-resources: close order and suppressed exceptions

```java
class ResourceA implements AutoCloseable {
    public void close() {
        System.out.println("Closing A");
    }
}

class ResourceB implements AutoCloseable {
    public void close() {
        throw new IllegalStateException("close B failed");
    }
}

public static void main(String[] args) {
    try (ResourceA a = new ResourceA(); ResourceB b = new ResourceB()) {
        throw new RuntimeException("body failed");
    } catch (RuntimeException e) {
        System.out.println("Caught: " + e.getMessage());
        for (Throwable t : e.getSuppressed()) {
            System.out.println("Suppressed: " + t.getMessage());
        }
    }
}
```

What's printed, in order?

<details>
<summary>Answer</summary>

```
Closing A
Caught: body failed
Suppressed: close B failed
```

Two things happen here, both governed by try-with-resources rules from
the slides:

1. **Close order is the reverse of declaration order.** `a` was declared
   first and `b` second, so on the way out the JVM closes `b` first, then
   `a`. That's why `b.close()` (which just throws, printing nothing) runs
   before `a.close()` (which prints `"Closing A"`).

2. **The body already threw — so `b`'s close-exception becomes suppressed,
   not primary.** The `try` body throws `RuntimeException("body failed")`
   first, making it the *primary* exception for this try statement. When
   `b.close()` subsequently throws `IllegalStateException("close B
   failed")` while a primary exception already exists, the JVM does not
   discard either one and does not let the close exception replace the
   primary (that only happens with a plain `finally`, see Exercise 2).
   Instead it calls `primary.addSuppressed(closeException)`, so the
   `IllegalStateException` is attached to the `RuntimeException` and
   retrievable via `getSuppressed()`. `a.close()` then runs normally and
   completes without incident, so it contributes nothing to the
   suppressed list.

The `catch` block therefore receives the original `RuntimeException`
(`"body failed"`) as `e`, with one entry in `e.getSuppressed()` — the
`IllegalStateException` from closing `b`.

</details>

---

## Exercise 4 — Reassigning a multi-catch variable

```java
void process() throws IOException, SQLException {
    try {
        performIO();
    } catch (IOException | SQLException e) {
        e = new IOException("wrapped: " + e.getMessage());
        throw e;
    }
}
```

Does this compile?

<details>
<summary>Answer</summary>

**No — compile error** on the line `e = new IOException(...);`.

In a multi-catch block (`catch (TypeA | TypeB e)`), the caught variable
`e` is **implicitly final**, even though the `final` keyword isn't
written. This is a language rule specific to multi-catch — a single-type
`catch (IOException e)` parameter can be freely reassigned inside its
block, but the moment you join two types with `|`, the compiler forbids
reassigning the variable at all, regardless of whether the new value's
type (`IOException`, one of the two caught types) would otherwise be
compatible.

The fix is to introduce a new variable instead of reassigning `e`:

```java
catch (IOException | SQLException e) {
    IOException wrapped = new IOException("wrapped: " + e.getMessage());
    throw wrapped;
}
```

(Separately, note that `IOException | SQLException` is legal here because
neither is a subtype of the other — had one of the catch types been a
subtype of the other, like `IOException | FileNotFoundException`, that
would be its own, different compile error: an unreachable/redundant
alternative.)

</details>

---

## Exercise 5 — Custom checked exception: constructor chaining and cause

```java
class InsufficientFundsException extends Exception {
    public InsufficientFundsException(String message, Throwable cause) {
        super(message, cause);
    }
}

static void withdraw(double amount, double balance) throws InsufficientFundsException {
    try {
        if (amount > balance) {
            throw new ArithmeticException("amount exceeds balance");
        }
    } catch (ArithmeticException e) {
        throw new InsufficientFundsException("Withdrawal failed", e);
    }
}

public static void main(String[] args) {
    try {
        withdraw(500, 100);
    } catch (InsufficientFundsException e) {
        System.out.println(e.getMessage());
        System.out.println(e.getCause().getClass().getSimpleName());
        System.out.println(e.getCause().getMessage());
    }
}
```

What's printed? Why is `throws InsufficientFundsException` required on
`withdraw`'s signature?

<details>
<summary>Answer</summary>

```
Withdrawal failed
ArithmeticException
amount exceeds balance
```

`InsufficientFundsException` extends `Exception` directly (not
`RuntimeException`), which makes it a **checked** exception. Its
constructor doesn't set the message and cause itself — it chains to
`Throwable`'s two-argument constructor via `super(message, cause)`, which
is what makes both `getMessage()` (`"Withdrawal failed"`) and
`getCause()` (the original `ArithmeticException` instance) available
afterward. `getCause().getMessage()` reaches through to the wrapped
exception's own message, `"amount exceeds balance"`.

Because `InsufficientFundsException` is checked, the compiler enforces
the handle-or-declare rule: any method whose body can throw it — here,
`withdraw`, via `throw new InsufficientFundsException(...)` — must either
catch it or declare it with `throws`. Since `withdraw` doesn't catch it,
`throws InsufficientFundsException` on the method signature is mandatory;
omitting it is a compile error. This is the same reason `main` is
required to wrap its call to `withdraw` in a `try`/`catch` (or declare
`throws` itself) — an unchecked exception like the inner
`ArithmeticException` would not have imposed that requirement.

</details>
