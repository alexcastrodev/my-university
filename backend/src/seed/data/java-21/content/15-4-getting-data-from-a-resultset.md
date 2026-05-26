# Getting Data from a ResultSet

> `ResultSet` is a cursor over the rows returned by a SQL query. The OCP exam tests iteration, typed accessor methods, 1-based column indexing, SQL NULL detection, and the different ResultSet types and their scrollability.

---

## Iterating a `ResultSet`

A freshly obtained `ResultSet` cursor is positioned **before the first row**. Call `next()` to advance it one row at a time. `next()` returns `true` while there are more rows and `false` when the cursor moves past the last row.

```java
String sql = "SELECT id, name, species FROM animals";
try (PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        int    id      = rs.getInt("id");
        String name    = rs.getString("name");
        String species = rs.getString("species");
        System.out.printf("%d: %s (%s)%n", id, name, species);
    }
}
```

> **Exam tip:** Calling `rs.getInt(1)` (or any getter) before the first `rs.next()` throws a `SQLException`. Always advance the cursor first.

---

## Accessing Column Values

Each row's values are read via typed `getXxx()` methods. Columns can be addressed by **column name** (a `String`) or by **column index** (an `int` starting at **1**).

```java
while (rs.next()) {
    // By column name (preferred for readability)
    int    id      = rs.getInt("id");
    String name    = rs.getString("name");
    double weight  = rs.getDouble("weight");
    boolean active = rs.getBoolean("active");

    // By column index (1-based)
    int    id2     = rs.getInt(1);
    String name2   = rs.getString(2);
    double weight2 = rs.getDouble(3);
}
```

Common getter methods:

| Method | Java Type | SQL Types |
|---|---|---|
| `getInt(col)` | `int` | `INTEGER`, `SMALLINT` |
| `getLong(col)` | `long` | `BIGINT` |
| `getDouble(col)` | `double` | `DOUBLE`, `FLOAT`, `REAL` |
| `getString(col)` | `String` | `VARCHAR`, `CHAR`, `TEXT` |
| `getBoolean(col)` | `boolean` | `BOOLEAN`, `BIT` |
| `getDate(col)` | `java.sql.Date` | `DATE` |
| `getTimestamp(col)` | `java.sql.Timestamp` | `TIMESTAMP` |
| `getObject(col)` | `Object` | Any type |

> **Exam tip:** Column indexes are **1-based** in JDBC — `getInt(1)` is the first column. This differs from arrays and most Java collections.

---

## Detecting SQL NULL with `wasNull()`

Java primitive types cannot represent SQL `NULL`. When a SQL `NULL` column is fetched via a primitive getter (e.g., `getInt`), JDBC returns **0** (or `false` for booleans). To distinguish a real zero from a `NULL`, call `wasNull()` immediately after the getter:

```java
while (rs.next()) {
    double weight = rs.getDouble("weight");  // returns 0.0 if NULL
    if (rs.wasNull()) {
        System.out.println("Weight is NULL");
    } else {
        System.out.println("Weight: " + weight);
    }
}
```

`wasNull()` reports the nullness of the **most recently read column**. For object types like `getString`, `wasNull()` is less necessary because the method returns Java `null` directly.

```java
String notes = rs.getString("notes");  // returns null if SQL NULL
if (notes == null) {
    System.out.println("No notes");
}
// wasNull() also works here
boolean isNull = rs.wasNull();
```

---

## `ResultSet` Metadata

`ResultSetMetaData` describes the columns of a `ResultSet` at runtime — useful when the query structure is not known at compile time:

```java
ResultSetMetaData meta = rs.getMetaData();
int colCount = meta.getColumnCount();
for (int i = 1; i <= colCount; i++) {
    System.out.println(meta.getColumnName(i) + " : " + meta.getColumnTypeName(i));
}
```

---

## `ResultSet` Types

When creating a `PreparedStatement`, you can specify the **type** and **concurrency** of the `ResultSet` it produces:

```java
PreparedStatement ps = conn.prepareStatement(
    sql,
    ResultSet.TYPE_SCROLL_INSENSITIVE,  // type
    ResultSet.CONCUR_READ_ONLY          // concurrency
);
```

### Type Constants

| Constant | Scrollable | Reflects DB Changes |
|---|---|---|
| `TYPE_FORWARD_ONLY` | No (default) | No |
| `TYPE_SCROLL_INSENSITIVE` | Yes | No (snapshot) |
| `TYPE_SCROLL_SENSITIVE` | Yes | Yes (live view) |

`TYPE_FORWARD_ONLY` is the default. `TYPE_SCROLL_INSENSITIVE` is the most commonly tested scrollable type on the exam.

### Concurrency Constants

| Constant | Description |
|---|---|
| `CONCUR_READ_ONLY` | Cannot update rows via `ResultSet` (default) |
| `CONCUR_UPDATABLE` | Allows updating rows via `ResultSet` methods |

---

## Absolute and Relative Positioning

Scrollable `ResultSet` types support movement beyond `next()`:

```java
// These only work with TYPE_SCROLL_INSENSITIVE or TYPE_SCROLL_SENSITIVE

rs.first();           // move to first row
rs.last();            // move to last row
rs.beforeFirst();     // move before first row (initial position)
rs.afterLast();       // move after last row

rs.absolute(3);       // move to row 3 (1-based); negative counts from end
rs.relative(2);       // move forward 2 rows from current position
rs.relative(-1);      // move backward 1 row

rs.previous();        // move to previous row (returns false if before first)
```

```java
// Check position
rs.isFirst();         // true if on first row
rs.isLast();          // true if on last row
rs.isBeforeFirst();   // true if before first row
rs.isAfterLast();     // true if after last row
int row = rs.getRow(); // current row number (1-based), 0 if before first or after last
```

> **Exam tip:** Calling `absolute()`, `relative()`, or `previous()` on a `TYPE_FORWARD_ONLY` `ResultSet` throws a `SQLException`.

---

## Closing a `ResultSet`

`ResultSet` is `AutoCloseable`. It is automatically closed when the producing `PreparedStatement` is closed or re-executed. Use explicit try-with-resources for early release:

```java
try (PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        // process
    }
} // rs and ps both closed here
```

---

## Key Rules Summary

- `ResultSet` cursor starts before the first row — call `next()` before reading any data.
- Column indexes start at **1** (not 0).
- Primitive getters (e.g., `getInt`) return 0/false for SQL `NULL`; call `wasNull()` to distinguish.
- `getString` returns Java `null` for SQL `NULL`.
- Default `ResultSet` type is `TYPE_FORWARD_ONLY` — only `next()` is allowed.
- Scrollable types (`TYPE_SCROLL_INSENSITIVE`, `TYPE_SCROLL_SENSITIVE`) support `absolute()`, `relative()`, `previous()`, etc.
- Always close `ResultSet` and `PreparedStatement` with try-with-resources.

---

## References

- [Oracle Docs — ResultSet](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/ResultSet.html)
- OCP Study Guide, Chapter 15 — JDBC
