# try-with-resources

---

## Motivation

Before Java 7, closing resources required verbose `finally` blocks prone to bugs:

```java
InputStream in = null;
try {
    in = new FileInputStream("file.txt");
    // use in
} finally {
    if (in != null) in.close();   // close() itself could throw!
}
```

---

## try-with-resources Syntax

Resources declared in the `try(...)` header are automatically closed when the block exits — whether normally or with an exception:

```java
try (InputStream in = new FileInputStream("file.txt")) {
    // use in
}   // in.close() called automatically here
```

Multiple resources — closed in **reverse** declaration order:

```java
try (
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement(sql)
) {
    ps.execute();
}   // ps closed first, then conn
```

---

## AutoCloseable

Any class whose `close()` method should be called automatically must implement `AutoCloseable` (or its subinterface `Closeable`):

```java
public class Timer implements AutoCloseable {
    private final long start = System.currentTimeMillis();

    @Override
    public void close() {
        System.out.println("Elapsed: " + (System.currentTimeMillis() - start) + "ms");
    }
}

try (var t = new Timer()) {
    doWork();
}   // prints elapsed time automatically
```

`Closeable` (used by I/O classes) is a subinterface of `AutoCloseable` that restricts `close()` to throwing only `IOException`.

---

## Suppressed Exceptions

If the `try` body throws and `close()` also throws, the close exception is **suppressed** — attached to the primary exception rather than replacing it:

```java
try (var r = new BrokenResource()) {
    throw new RuntimeException("primary");
    // r.close() also throws — suppressed, not lost
}
```

```java
try {
    // ...
} catch (Exception e) {
    for (Throwable suppressed : e.getSuppressed()) {
        System.out.println("Suppressed: " + suppressed);
    }
}
```

This is the opposite of `finally` — in `finally`, the secondary exception wins and the primary is lost.

---

## Effectively Final Resources (Java 9+)

A variable declared before the `try` can be used as a resource if it is effectively final:

```java
var conn = dataSource.getConnection();
try (conn) {                // valid — conn is effectively final
    conn.execute(sql);
}
```

---

## Combining with catch and finally

`catch` and `finally` can be added after the resource list. Resources are closed **before** `catch` runs:

```java
try (var reader = Files.newBufferedReader(path)) {
    process(reader);
} catch (IOException e) {
    System.err.println("Failed: " + e.getMessage());
} finally {
    System.out.println("Done");
}
// Close order: reader → catch (if needed) → finally
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `AutoCloseable` | Required to use in try-with-resources |
| Close order | Reverse declaration order |
| Suppressed exceptions | Close exceptions attached to primary, not lost |
| Effectively final | Pre-declared resources allowed since Java 9 |
| `null` resource | If a resource variable is `null`, `close()` is not called (no NPE) |
