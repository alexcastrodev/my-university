# Working with a PreparedStatement

> `PreparedStatement` is the correct way to execute parameterized SQL in Java. It prevents SQL injection, improves performance through precompilation, and is the primary JDBC API tested on the OCP exam. This lesson covers creation, parameter binding, execution, and batch updates.

---

## `Statement` vs `PreparedStatement`

The `Statement` interface executes a raw SQL string directly. While simple, it is **vulnerable to SQL injection**:

```java
// DANGEROUS — never do this with user input
String name = userInput; // attacker enters: ' OR '1'='1
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE name = '" + name + "'");
```

`PreparedStatement` uses **`?` placeholders** and binds values separately, eliminating injection risks:

```java
// SAFE — parameters are escaped by the driver
PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE name = ?");
ps.setString(1, userInput);  // always treated as data, never as SQL
ResultSet rs = ps.executeQuery();
```

Additional advantages of `PreparedStatement`:

| Feature | `Statement` | `PreparedStatement` |
|---|---|---|
| SQL injection safe | No | Yes |
| Precompiled by DB | No | Yes |
| Reusable with different params | No | Yes |
| Readable with placeholders | No | Yes |

---

## Creating a `PreparedStatement`

Use `Connection.prepareStatement(String sql)`. The `?` characters are positional placeholders — **1-based indexing**:

```java
String sql = "INSERT INTO animals (id, name, species) VALUES (?, ?, ?)";
PreparedStatement ps = conn.prepareStatement(sql);
```

Always use try-with-resources to ensure the statement is closed:

```java
String sql = "SELECT id, name FROM animals WHERE species = ?";
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setString(1, "Cat");
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            System.out.println(rs.getInt("id") + " " + rs.getString("name"));
        }
    }
}
```

---

## Binding Parameters

Parameters are bound using typed `setXxx(int parameterIndex, value)` methods. The index starts at **1**, not 0.

```java
PreparedStatement ps = conn.prepareStatement(
    "INSERT INTO animals (id, name, weight, active) VALUES (?, ?, ?, ?)");

ps.setInt(1, 10);            // int / INTEGER
ps.setString(2, "Parrot");   // String / VARCHAR, CHAR
ps.setDouble(3, 0.45);       // double / DOUBLE, FLOAT
ps.setBoolean(4, true);      // boolean / BOOLEAN, BIT
```

Common `setXxx` methods:

| Method | SQL Type |
|---|---|
| `setInt(index, int)` | `INTEGER` |
| `setLong(index, long)` | `BIGINT` |
| `setDouble(index, double)` | `DOUBLE` |
| `setString(index, String)` | `VARCHAR`, `CHAR` |
| `setBoolean(index, boolean)` | `BOOLEAN` |
| `setDate(index, java.sql.Date)` | `DATE` |
| `setTimestamp(index, Timestamp)` | `TIMESTAMP` |
| `setNull(index, java.sql.Types.XYZ)` | Sets SQL `NULL` for any type |

### Setting SQL NULL

```java
// Set parameter 3 to NULL for a DOUBLE column
ps.setNull(3, java.sql.Types.DOUBLE);
```

> **Exam tip:** Use `setNull(index, sqlType)` to pass a SQL `NULL`. Passing a Java `null` to `setString` also works for most drivers, but `setNull` is the explicit, portable approach.

---

## Executing Statements

Two execute methods return different results depending on the SQL type:

### `executeQuery()` — for SELECT

Returns a `ResultSet`. Use when your SQL returns rows.

```java
PreparedStatement ps = conn.prepareStatement("SELECT * FROM animals WHERE id = ?");
ps.setInt(1, 5);
ResultSet rs = ps.executeQuery();  // always returns ResultSet (never null)
```

### `executeUpdate()` — for INSERT, UPDATE, DELETE, DDL

Returns an `int` representing the number of rows affected.

```java
PreparedStatement ps = conn.prepareStatement(
    "UPDATE animals SET species = ? WHERE id = ?");
ps.setString(1, "Goldfish");
ps.setInt(2, 3);
int rowsAffected = ps.executeUpdate();  // e.g., 1
System.out.println("Rows updated: " + rowsAffected);
```

### `execute()` — generic

Returns `true` if the first result is a `ResultSet`, `false` if it is an update count. Rarely used directly on the exam.

| Method | Returns | Use for |
|---|---|---|
| `executeQuery()` | `ResultSet` | `SELECT` |
| `executeUpdate()` | `int` (row count) | `INSERT`, `UPDATE`, `DELETE`, DDL |
| `execute()` | `boolean` | Unknown or mixed SQL |

---

## Reusing a `PreparedStatement`

A `PreparedStatement` can be executed multiple times with different parameters. Call `clearParameters()` if needed between executions:

```java
PreparedStatement ps = conn.prepareStatement(
    "INSERT INTO animals (id, name) VALUES (?, ?)");

ps.setInt(1, 1);
ps.setString(2, "Fluffy");
ps.executeUpdate();  // insert row 1

ps.setInt(1, 2);
ps.setString(2, "Buddy");
ps.executeUpdate();  // insert row 2
```

---

## Batch Updates

Batch updates group multiple DML operations into a single round-trip to the database, reducing network overhead significantly.

```java
PreparedStatement ps = conn.prepareStatement(
    "INSERT INTO animals (id, name, species) VALUES (?, ?, ?)");

ps.setInt(1, 10); ps.setString(2, "Leo");   ps.setString(3, "Lion");
ps.addBatch();   // stage first row

ps.setInt(1, 11); ps.setString(2, "Zara");  ps.setString(3, "Zebra");
ps.addBatch();   // stage second row

ps.setInt(1, 12); ps.setString(2, "Ellie"); ps.setString(3, "Elephant");
ps.addBatch();   // stage third row

int[] results = ps.executeBatch();  // execute all staged operations
// results[0], results[1], results[2] — rows affected per statement

ps.clearBatch(); // optional: clear staged operations
```

| Method | Description |
|---|---|
| `addBatch()` | Stages the current parameters as one batch entry |
| `executeBatch()` | Sends all staged operations; returns `int[]` of row counts |
| `clearBatch()` | Removes all staged operations without executing |

> **Exam tip:** `executeBatch()` returns an `int[]`, not a single `int`. Each element corresponds to one `addBatch()` call.

---

## Key Rules Summary

- `PreparedStatement` uses `?` placeholders — parameter indexes start at **1**.
- Bind values with `setString`, `setInt`, `setDouble`, `setNull`, etc.
- `executeQuery()` returns a `ResultSet`; use it for `SELECT`.
- `executeUpdate()` returns an `int` (rows affected); use it for `INSERT`, `UPDATE`, `DELETE`.
- Batch updates: `addBatch()` stages, `executeBatch()` fires, `clearBatch()` resets.
- Always close `PreparedStatement` with try-with-resources.

---

## References

- [Oracle Docs — PreparedStatement](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/PreparedStatement.html)
- OCP Study Guide, Chapter 15 — JDBC
