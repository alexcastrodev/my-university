# try/catch/finally Blocks

---

## Basic Structure

```java
try {
    // code that may throw
} catch (ExceptionType e) {
    // handle the exception
} finally {
    // always executes — with or without an exception
}
```

All three sections are optional individually, but `try` must be paired with at least one `catch` or `finally`.

---

## Exception Hierarchy

```
Throwable
├── Error              (not meant to be caught — JVM errors)
└── Exception
    ├── RuntimeException  (unchecked — compiler does not require handling)
    │   ├── NullPointerException
    │   ├── ArrayIndexOutOfBoundsException
    │   ├── ClassCastException
    │   ├── ArithmeticException
    │   └── IllegalArgumentException
    └── (checked exceptions — must be declared or caught)
        ├── IOException
        ├── SQLException
        └── ...
```

---

## Checked vs Unchecked

| | Checked | Unchecked |
|-|---------|----------|
| Extends | `Exception` (not `RuntimeException`) | `RuntimeException` or `Error` |
| Compiler requires | `catch` or `throws` declaration | Nothing |
| Examples | `IOException`, `SQLException` | `NPE`, `ClassCastException` |

```java
// checked — must handle or declare
void readFile(String path) throws IOException {
    Files.readString(Path.of(path));
}

// unchecked — optional handling
int divide(int a, int b) {
    return a / b;   // may throw ArithmeticException
}
```

---

## Multiple catch Blocks

The JVM matches the **first** catch that is compatible — order matters:

```java
try {
    process();
} catch (FileNotFoundException e) {   // more specific first
    System.out.println("File not found: " + e.getMessage());
} catch (IOException e) {             // more general second
    System.out.println("IO error");
} catch (Exception e) {               // catch-all last
    System.out.println("Unexpected: " + e);
}
```

Putting a supertype before a subtype causes a **compile error** — the subtype catch is unreachable.

---

## finally Block

`finally` always runs — even if the `try` block returns or throws:

```java
Connection conn = null;
try {
    conn = openConnection();
    conn.execute(sql);
    return true;
} catch (SQLException e) {
    log(e);
    return false;
} finally {
    if (conn != null) conn.close();   // runs before the return exits
}
```

**Exception in finally:** If `finally` itself throws, the original exception is suppressed (lost). Prefer `try-with-resources` for cleanup.

---

## Return in try/catch vs finally

When both `try`/`catch` and `finally` contain a `return`, the `finally` return wins:

```java
int test() {
    try {
        return 1;
    } finally {
        return 2;   // this return overrides — method returns 2
    }
}
```

---

## Printing Exception Info

| Method | Output |
|--------|--------|
| `e.getMessage()` | Short description |
| `e.toString()` | Class name + message |
| `e.printStackTrace()` | Full stack trace to stderr |

---

## Key Rules

| Rule | Detail |
|------|--------|
| `catch` order | Subtype before supertype |
| `finally` execution | Always — even after `return` or `throw` |
| Checked exceptions | Must be caught or declared with `throws` |
| `Error` | Technically catchable but generally should not be |
| Rethrowing | `throw e;` inside a catch rethrows the same exception |
