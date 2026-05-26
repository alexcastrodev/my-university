# Connecting to a Database

> Establishing a database connection is the first step in any JDBC application. Java provides `DriverManager` for direct connections and `DataSource` for pooled, production-grade connections. Understanding JDBC URL formats and how to manage `Connection` resources is essential for the OCP exam.

---

## JDBC URL Format

Every JDBC connection starts with a **connection URL** that identifies the driver, host, port, and database. The general format is:

```
jdbc:subprotocol:subname
```

| Segment | Description | Example |
|---|---|---|
| `jdbc` | Literal prefix for all JDBC URLs | `jdbc` |
| `subprotocol` | Driver or database type | `mysql`, `postgresql`, `h2`, `oracle` |
| `subname` | Driver-specific location of the database | `//localhost:3306/mydb` |

Common examples:

```
jdbc:mysql://localhost:3306/mydb
jdbc:postgresql://db.example.com:5432/inventory
jdbc:h2:mem:testdb              ← H2 in-memory database (OCP exam favourite)
jdbc:oracle:thin:@localhost:1521:orcl
```

> **Exam tip:** Know that the URL always starts with `jdbc:` and that the driver subprotocol and subname format vary by vendor.

---

## `DriverManager.getConnection()`

`DriverManager` is the traditional way to obtain a `Connection`. It searches the registered drivers and delegates to the one that accepts the supplied URL.

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class ConnectExample {
    public static void main(String[] args) throws SQLException {
        String url  = "jdbc:mysql://localhost:3306/mydb";
        String user = "root";
        String pass = "secret";

        Connection conn = DriverManager.getConnection(url, user, pass);
        System.out.println("Connected: " + conn.getCatalog());
        conn.close();
    }
}
```

Three overloads are available:

| Method | Notes |
|---|---|
| `getConnection(String url)` | URL encodes credentials (e.g., `jdbc:h2:mem:test`) |
| `getConnection(String url, String user, String password)` | Most common form |
| `getConnection(String url, Properties info)` | Passes driver-specific properties |

All three throw `SQLException` if the connection cannot be established.

---

## Always Close Connections: try-with-resources

`Connection` implements `AutoCloseable`, so it must be closed after use to release database resources and return the underlying socket. Use **try-with-resources** — the exam expects this pattern:

```java
String url  = "jdbc:h2:mem:testdb";
String user = "sa";
String pass = "";

try (Connection conn = DriverManager.getConnection(url, user, pass)) {
    // use connection — auto-closed on exit, even if an exception is thrown
    System.out.println("Auto-commit: " + conn.getAutoCommit()); // true by default
} catch (SQLException e) {
    System.err.println("Connection failed: " + e.getMessage());
}
```

Forgetting `close()` causes **connection leaks** — a common source of production outages.

---

## The `Connection` Interface

Once connected, the `Connection` object is your gateway to all JDBC operations:

```java
try (Connection conn = DriverManager.getConnection(url, user, pass)) {
    // Create statements
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM animals WHERE id = ?");
    CallableStatement cs = conn.prepareCall("{call getAnimal(?)}");

    // Transaction control
    conn.setAutoCommit(false);  // start manual transaction
    conn.commit();
    conn.rollback();

    // Metadata
    String catalog = conn.getCatalog();        // current database/schema
    boolean readOnly = conn.isReadOnly();
    DatabaseMetaData meta = conn.getMetaData();
}
```

Key `Connection` methods for the exam:

| Method | Description |
|---|---|
| `prepareStatement(String sql)` | Creates a `PreparedStatement` |
| `prepareCall(String sql)` | Creates a `CallableStatement` |
| `setAutoCommit(boolean)` | Enables/disables auto-commit mode |
| `commit()` | Commits the current transaction |
| `rollback()` | Rolls back the current transaction |
| `close()` | Releases the connection |
| `isClosed()` | Returns `true` if already closed |

---

## `DataSource` vs `DriverManager`

In production systems, `DataSource` is preferred over `DriverManager` because it supports **connection pooling**:

| Feature | `DriverManager` | `DataSource` |
|---|---|---|
| Connection pooling | No | Yes (via pool implementation) |
| Configuration | Hardcoded URL/credentials | External (JNDI, config file) |
| Usage context | Tests, simple scripts | Production applications |
| Typical OCP context | Primary focus | Awareness only |

```java
// DataSource usage (conceptual — actual impl depends on the library)
DataSource ds = // obtained from JNDI or a pool library (HikariCP, c3p0, etc.)
try (Connection conn = ds.getConnection()) {
    // same API as DriverManager connection
}
```

> **Exam tip:** The OCP exam primarily tests `DriverManager`. Know that `DataSource` exists for production use and supports connection pooling, but you are not expected to configure a pool on the exam.

---

## Driver Registration

Modern JDBC drivers (JDBC 4.0+) register themselves automatically via the **Service Provider Interface (SPI)** — you simply add the driver JAR to the classpath and call `DriverManager.getConnection()`. Manual registration with `Class.forName("com.mysql.cj.jdbc.Driver")` is legacy code and no longer required.

```java
// Modern — driver auto-loads from classpath (JDBC 4.0+)
Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/mydb", "root", "pass");

// Legacy — explicit driver loading (not needed in Java 21)
Class.forName("com.mysql.cj.jdbc.Driver");  // no longer required
Connection conn2 = DriverManager.getConnection("jdbc:mysql://localhost:3306/mydb", "root", "pass");
```

---

## Key Rules Summary

- JDBC URL format: `jdbc:subprotocol:subname` — always starts with `jdbc:`.
- `DriverManager.getConnection(url, user, password)` is the standard way to get a `Connection`.
- `Connection` is `AutoCloseable` — always use try-with-resources.
- Auto-commit is `true` by default; set to `false` for manual transaction control.
- `DataSource` supports connection pooling and is preferred in production; the OCP exam focuses on `DriverManager`.
- JDBC 4.0+ drivers register automatically — `Class.forName()` is no longer needed.

---

## References

- [Oracle Docs — DriverManager](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/DriverManager.html)
- [Oracle Docs — Connection](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Connection.html)
- OCP Study Guide, Chapter 15 — JDBC
