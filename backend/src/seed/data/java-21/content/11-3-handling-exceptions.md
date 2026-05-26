# Handling Exceptions

> Java's `try/catch/finally` construct gives you precise control over what happens when things go wrong. Knowing the rules for catch ordering, multi-catch syntax, rethrowing, and suppressed exceptions is critical for the exam.

---

## The try/catch/finally Structure

```java
try {
    // code that might throw
} catch (ExceptionTypeA e) {
    // handle ExceptionTypeA
} catch (ExceptionTypeB e) {
    // handle ExceptionTypeB
} finally {
    // always executes — cleanup code goes here
}
```

- The `try` block is required.
- At least one `catch` **or** one `finally` block must follow `try`.
- `finally` always runs — whether the `try` completes normally, an exception is caught, or an uncaught exception propagates up.

```java
public int readValue() {
    try {
        return Integer.parseInt("abc");   // throws NumberFormatException
    } catch (NumberFormatException e) {
        System.out.println("Bad format: " + e.getMessage());
        return -1;
    } finally {
        System.out.println("finally runs no matter what");
    }
}
```

---

## Catch Ordering — Most Specific First

When multiple `catch` blocks are present, they are evaluated **top to bottom**. The first matching block executes; the rest are skipped.

**Rule:** A more specific (child) exception type must appear **before** a more general (parent) type. Placing a parent type first causes a compile-time error for any unreachable child `catch`.

```java
// WRONG — compile-time error: IOException already caught by Exception
try {
    Files.readAllBytes(Path.of("file.txt"));
} catch (Exception e) {         // too broad — catches everything
    System.out.println("Exception");
} catch (IOException e) {       // UNREACHABLE — compile error
    System.out.println("IO error");
}

// CORRECT
try {
    Files.readAllBytes(Path.of("file.txt"));
} catch (FileNotFoundException e) {   // most specific first
    System.out.println("File not found");
} catch (IOException e) {             // less specific second
    System.out.println("IO error");
}
```

---

## Multi-Catch (|)

When two unrelated exceptions should be handled identically, combine them with the pipe operator `|` in a single `catch`:

```java
try {
    String input = getUserInput();
    int value = Integer.parseInt(input);
    int[] data = getArray();
    System.out.println(data[value]);
} catch (NumberFormatException | ArrayIndexOutOfBoundsException e) {
    System.out.println("Invalid input: " + e.getMessage());
}
```

**Multi-catch rules:**
- The exceptions listed must be unrelated (no parent/child relationship between them) — the compiler rejects redundant alternatives.
- The catch variable is implicitly `final`; you cannot reassign `e` inside a multi-catch block.

```java
// WRONG — NullPointerException is not a parent of NumberFormatException
// but if one were a subclass of the other, it would be a compile error
catch (IOException | FileNotFoundException e) { }  // compile error: redundant
```

---

## Rethrowing Exceptions

You can catch an exception and rethrow it, optionally wrapping it in another exception type:

```java
public void process() throws Exception {
    try {
        riskyOperation();
    } catch (IOException e) {
        // wrap in a domain-specific exception
        throw new RuntimeException("Processing failed", e);
    }
}
```

When wrapping, the original exception becomes the **cause** and is accessible via `getCause()`. This preserves the full stack trace.

```java
try {
    process();
} catch (RuntimeException e) {
    System.out.println("Cause: " + e.getCause());  // the original IOException
}
```

---

## Suppressed Exceptions

When an exception is thrown in a `finally` block while another exception is already propagating, the `finally` exception **replaces** the original — the original is lost. This is a common source of bugs.

```java
// The IOException from the try block is LOST
try {
    throw new IOException("original");
} finally {
    throw new RuntimeException("finally exception");  // swallows IOException
}
```

To avoid this, save and add exceptions as **suppressed** on the primary exception:

```java
Exception primary = null;
try {
    throw new IOException("original");
} catch (IOException e) {
    primary = e;
    throw e;
} finally {
    RuntimeException secondary = new RuntimeException("cleanup failed");
    if (primary != null) primary.addSuppressed(secondary);
    // primary still propagates; secondary is attached to it
}
```

Suppressed exceptions are retrieved with `getSuppressed()`:

```java
try {
    riskyWithCleanup();
} catch (Exception e) {
    System.out.println("Primary: " + e.getMessage());
    for (Throwable t : e.getSuppressed()) {
        System.out.println("Suppressed: " + t.getMessage());
    }
}
```

> **Note:** Try-with-resources (lesson 11-4) handles suppressed exceptions automatically — that is its primary advantage over manual `finally` cleanup.

---

## Key Rules Summary

- `try` requires at least one `catch` or `finally`.
- `finally` always executes, even after a `return` in the `try` or `catch` block.
- More specific exception types must appear before more general ones in a catch chain.
- Multi-catch (`|`) requires unrelated exception types and makes the variable effectively `final`.
- Wrapping a caught exception preserves the original as the *cause* via `getCause()`.
- An exception thrown in `finally` suppresses any in-flight exception unless suppression is managed manually.

---

## References

- [Oracle Docs — Catching and Handling Exceptions](https://docs.oracle.com/javase/tutorial/essential/exceptions/handling.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
