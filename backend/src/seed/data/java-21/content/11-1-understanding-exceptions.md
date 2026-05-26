# Understanding Exceptions

> Exceptions are Java's mechanism for signaling and handling abnormal conditions. Understanding the hierarchy, the difference between checked and unchecked exceptions, and how the call stack unwinds is essential for the OCP exam and for writing robust applications.

---

## The Throwable Hierarchy

Every exception in Java is an object. The root of the exception hierarchy is `java.lang.Throwable`, which has two direct subclasses:

```
java.lang.Throwable
├── java.lang.Error
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   └── ... (other errors)
└── java.lang.Exception
    ├── IOException
    ├── SQLException
    ├── RuntimeException
    │   ├── NullPointerException
    │   ├── ArrayIndexOutOfBoundsException
    │   ├── ClassCastException
    │   └── ... (other unchecked)
    └── ... (other checked exceptions)
```

- **`Error`** — Serious problems that a well-written application should not attempt to catch. They indicate JVM-level failures (e.g., running out of heap memory).
- **`Exception`** — Conditions that a reasonable application might want to catch and recover from.
- **`RuntimeException`** — A subclass of `Exception` representing programming mistakes (e.g., null dereference). These are *unchecked*.

---

## Checked vs. Unchecked Exceptions

The most important distinction for the exam is **checked** vs. **unchecked**.

| Category | Which classes? | Must be declared or caught? |
|---|---|---|
| Checked | `Exception` and its subclasses, **excluding** `RuntimeException` | Yes — compile-time enforcement |
| Unchecked | `RuntimeException` and its subclasses | No |
| Error | `Error` and its subclasses | No (and should not be caught) |

```java
// Checked — compiler forces you to handle or declare it
public void readFile(String path) throws IOException {
    // IOException is checked; caller must deal with it
    Files.readAllBytes(Path.of(path));
}

// Unchecked — no declaration required
public int divide(int a, int b) {
    return a / b;   // ArithmeticException possible; no throws clause needed
}
```

> **Rule of thumb:** If the exception is something the caller can reasonably anticipate and recover from (bad file path, network issue), use a checked exception. If it represents a programming bug (null reference, bad index), use an unchecked exception.

---

## When to Use Each

| Situation | Recommended type |
|---|---|
| External resource failure (file, DB, network) | Checked exception |
| Caller passes invalid arguments | `IllegalArgumentException` (unchecked) |
| Object in wrong state for the operation | `IllegalStateException` (unchecked) |
| Truly unrecoverable JVM problem | `Error` (never thrown by application code) |

---

## Exception Propagation and the Call Stack

When an exception is thrown, the JVM looks for an appropriate `catch` block in the **current method**. If none is found, the method terminates abnormally and the exception propagates up the call stack to the caller. This continues until either a matching `catch` is found or the thread terminates.

```java
public static void main(String[] args) {
    first();
}

static void first() {
    second();
}

static void second() {
    throw new RuntimeException("Something went wrong");
    // propagates: second → first → main → thread terminates
}
```

The output includes a **stack trace** that shows the call chain in reverse order — the most recently called method appears at the top:

```
Exception in thread "main" java.lang.RuntimeException: Something went wrong
    at Second.second(Demo.java:12)
    at Second.first(Demo.java:8)
    at Second.main(Demo.java:4)
```

Reading a stack trace top-to-bottom tells you where the exception originated and the path it traveled through the call stack.

---

## Creating Custom Exceptions

You can extend any exception class to create your own:

```java
// Checked custom exception
public class InsufficientFundsException extends Exception {
    public InsufficientFundsException(String message) {
        super(message);
    }
}

// Unchecked custom exception
public class InvalidAccountException extends RuntimeException {
    public InvalidAccountException(String message) {
        super(message);
    }
}
```

Extend `Exception` for checked and `RuntimeException` for unchecked. Extending `Error` is almost never appropriate in application code.

---

## Key Rules Summary

- `Throwable` is the root; `Error` and `Exception` are its two branches.
- `RuntimeException` (and subclasses) = unchecked; everything else under `Exception` = checked.
- Checked exceptions must appear in a `throws` clause or be caught — the compiler enforces this.
- Exceptions propagate up the call stack until caught or the program terminates.
- Custom exceptions should extend `Exception` (checked) or `RuntimeException` (unchecked).

---

## References

- [Oracle Docs — Exceptions (Java Tutorial)](https://docs.oracle.com/javase/tutorial/essential/exceptions/index.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
