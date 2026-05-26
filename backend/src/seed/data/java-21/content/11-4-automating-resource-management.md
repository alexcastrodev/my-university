# Automating Resource Management

> Try-with-resources guarantees that I/O streams, database connections, and other closeable resources are always released — even when exceptions occur — without writing complex `finally` logic.

---

## The Problem with Manual Cleanup

Before try-with-resources, resource cleanup required a nested `finally` block that was verbose and error-prone:

```java
// Old style — fragile
FileReader reader = null;
try {
    reader = new FileReader("data.txt");
    // use reader...
} catch (IOException e) {
    e.printStackTrace();
} finally {
    if (reader != null) {
        try {
            reader.close();   // close() can itself throw
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

---

## The AutoCloseable Interface

Try-with-resources works with any class that implements `java.lang.AutoCloseable`:

```java
public interface AutoCloseable {
    void close() throws Exception;
}
```

`java.io.Closeable` (used by all I/O streams) extends `AutoCloseable`, so every stream, reader, writer, and connection in the standard library is already compatible.

You can make your own resources compatible by implementing `AutoCloseable`:

```java
public class DatabaseConnection implements AutoCloseable {
    public DatabaseConnection(String url) {
        System.out.println("Opening connection to " + url);
    }

    public void query(String sql) {
        System.out.println("Executing: " + sql);
    }

    @Override
    public void close() {
        System.out.println("Closing connection");
    }
}
```

---

## Try-with-Resources Syntax

Declare resources inside the parentheses after `try`. Each resource variable is implicitly `final`.

```java
// Single resource
try (FileReader reader = new FileReader("data.txt")) {
    int ch;
    while ((ch = reader.read()) != -1) {
        System.out.print((char) ch);
    }
} catch (IOException e) {
    e.printStackTrace();
}
// reader.close() is called automatically here
```

Multiple resources can be declared, separated by semicolons:

```java
try (FileReader in  = new FileReader("input.txt");
     FileWriter out = new FileWriter("output.txt")) {
    int ch;
    while ((ch = in.read()) != -1) {
        out.write(ch);
    }
} catch (IOException e) {
    e.printStackTrace();
}
```

---

## Close Order — Reverse Declaration Order

Resources are closed in the **reverse of the order they were declared**. This mirrors a stack: the last resource opened is the first to be closed.

```java
try (A a = new A();   // opened first
     B b = new B();   // opened second
     C c = new C()) { // opened third
    // use a, b, c
}
// close order: C → B → A
```

```java
public class Resource implements AutoCloseable {
    private final String name;
    Resource(String name) { this.name = name; System.out.println("Opening " + name); }

    @Override
    public void close() { System.out.println("Closing " + name); }
}

try (Resource r1 = new Resource("R1");
     Resource r2 = new Resource("R2");
     Resource r3 = new Resource("R3")) {
    System.out.println("Using resources");
}
// Output:
// Opening R1
// Opening R2
// Opening R3
// Using resources
// Closing R3
// Closing R2
// Closing R1
```

---

## Suppressed Exceptions in Try-with-Resources

When the `try` body throws an exception *and* `close()` also throws, Java automatically attaches the `close()` exception as a **suppressed exception** on the primary exception. The primary exception from the `try` body propagates; nothing is lost.

```java
public class FailingResource implements AutoCloseable {
    @Override
    public void close() throws Exception {
        throw new Exception("close failed");
    }
}

try (FailingResource r = new FailingResource()) {
    throw new RuntimeException("body failed");   // primary exception
} catch (Exception e) {
    System.out.println("Primary: " + e.getMessage());       // "body failed"
    System.out.println("Suppressed: " +
        e.getSuppressed()[0].getMessage());                  // "close failed"
}
```

This is the key advantage over manual `finally` blocks, which would silently swallow the original exception.

---

## catch and finally with Try-with-Resources

A try-with-resources statement can still have `catch` and `finally` blocks. The resources are closed **before** any `catch` or `finally` block runs:

```java
try (Connection conn = DriverManager.getConnection(url)) {
    conn.createStatement().execute(sql);
} catch (SQLException e) {
    System.out.println("SQL error: " + e.getMessage());
    // conn is already closed at this point
} finally {
    System.out.println("Always runs last");
}
```

---

## Key Rules Summary

- Any class implementing `AutoCloseable` can be used in try-with-resources.
- Resource variables declared in the `try` header are implicitly `final`.
- Resources close in reverse declaration order.
- If both the `try` body and `close()` throw, `close()`'s exception is attached as a suppressed exception on the primary — it is not lost.
- `catch` and `finally` blocks execute *after* resources are closed.

---

## References

- [Oracle Docs — The try-with-resources Statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
