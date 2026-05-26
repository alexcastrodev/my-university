# Calling a CallableStatement

> `CallableStatement` executes stored procedures defined inside the database. It supports IN parameters (input values), OUT parameters (return values), and INOUT parameters (both). The OCP exam tests the syntax for calling stored procedures and how to register and retrieve OUT parameter values.

---

## What Is a Stored Procedure?

A **stored procedure** is a named block of SQL (and procedural logic) that lives inside the database server. Calling it from Java avoids repeatedly sending complex SQL over the network and can encapsulate business logic in the database layer.

Example stored procedure (SQL, not Java — defined on the database side):

```sql
-- Procedure with one IN parameter
CREATE PROCEDURE get_animal(IN animal_id INT)
BEGIN
    SELECT name, species FROM animals WHERE id = animal_id;
END;

-- Procedure with one OUT parameter
CREATE PROCEDURE count_animals(OUT total INT)
BEGIN
    SELECT COUNT(*) INTO total FROM animals;
END;

-- Procedure with INOUT parameter
CREATE PROCEDURE double_value(INOUT val INT)
BEGIN
    SET val = val * 2;
END;
```

---

## Creating a `CallableStatement`

Use `Connection.prepareCall(String sql)` with the JDBC stored procedure escape syntax:

```
{call procedureName(param1, param2, ...)}
```

```java
// No parameters
CallableStatement cs = conn.prepareCall("{call refresh_cache()}");

// With parameters (? placeholders, same as PreparedStatement)
CallableStatement cs = conn.prepareCall("{call get_animal(?)}");

// With return value (function, not procedure)
CallableStatement cs = conn.prepareCall("{? = call get_count()}");
```

The braces `{}` and the `call` keyword are required — they form the **JDBC escape syntax** that the driver translates to the database-specific call format.

---

## IN Parameters

IN parameters pass values from Java into the stored procedure. They are set the same way as `PreparedStatement` parameters using `setXxx(index, value)`:

```java
CallableStatement cs = conn.prepareCall("{call get_animal(?)}");
cs.setInt(1, 42);    // pass animal id = 42 as IN parameter
cs.execute();

try (ResultSet rs = cs.getResultSet()) {
    while (rs.next()) {
        System.out.println(rs.getString("name"));
    }
}
```

---

## OUT Parameters

OUT parameters return values from the stored procedure back to Java. You must **register** them before execution with `registerOutParameter(index, java.sql.Types.XYZ)`, then retrieve the value after `execute()`:

```java
CallableStatement cs = conn.prepareCall("{call count_animals(?)}");

// Register the OUT parameter — must be done BEFORE execute()
cs.registerOutParameter(1, java.sql.Types.INTEGER);

cs.execute();

// Retrieve the OUT value AFTER execute()
int count = cs.getInt(1);
System.out.println("Total animals: " + count);
```

> **Exam tip:** You must call `registerOutParameter()` before `execute()`. Forgetting this step causes a `SQLException`.

Common `java.sql.Types` constants used with `registerOutParameter`:

| Constant | Java type returned |
|---|---|
| `Types.INTEGER` | `getInt()` |
| `Types.BIGINT` | `getLong()` |
| `Types.DOUBLE` | `getDouble()` |
| `Types.VARCHAR` | `getString()` |
| `Types.BOOLEAN` | `getBoolean()` |
| `Types.DATE` | `getDate()` |
| `Types.TIMESTAMP` | `getTimestamp()` |

---

## INOUT Parameters

An INOUT parameter serves as both input and output. You must **set** the value with `setXxx()` **and** register it with `registerOutParameter()`:

```java
CallableStatement cs = conn.prepareCall("{call double_value(?)}");

// INOUT: set the input value AND register as output
cs.setInt(1, 5);                              // set input
cs.registerOutParameter(1, java.sql.Types.INTEGER);  // register as output

cs.execute();

int result = cs.getInt(1);  // retrieve the output value
System.out.println("Doubled: " + result);  // 10
```

---

## Multiple Parameters: IN, OUT, and INOUT Together

```java
// Procedure: transfer_funds(IN from_acct INT, IN to_acct INT,
//                           IN amount DOUBLE, OUT new_balance DOUBLE)
CallableStatement cs = conn.prepareCall("{call transfer_funds(?, ?, ?, ?)}");

cs.setInt(1, 1001);       // IN: source account
cs.setInt(2, 1002);       // IN: destination account
cs.setDouble(3, 250.00);  // IN: transfer amount
cs.registerOutParameter(4, java.sql.Types.DOUBLE);  // OUT: new balance

cs.execute();

double newBalance = cs.getDouble(4);
System.out.printf("New balance: %.2f%n", newBalance);
```

---

## Executing a `CallableStatement`

`CallableStatement` extends `PreparedStatement`, so the same execute methods apply:

| Method | Returns | Use when |
|---|---|---|
| `execute()` | `boolean` | Most common for stored procedures |
| `executeQuery()` | `ResultSet` | Procedure returns a result set |
| `executeUpdate()` | `int` | Procedure performs DML only |

`execute()` is the typical choice because stored procedures can return result sets, update counts, or both.

```java
cs.execute();

// Check if a ResultSet was returned
if (cs.getMoreResults()) {
    ResultSet rs = cs.getResultSet();
    // process results
}
```

---

## Parameter Summary Table

| Parameter Type | setXxx | registerOutParameter | Retrieve after execute |
|---|---|---|---|
| IN | Yes | No | No |
| OUT | No | Yes | Yes |
| INOUT | Yes | Yes | Yes |

---

## Key Rules Summary

- Use `connection.prepareCall("{call procName(?,?)}")` to create a `CallableStatement`.
- IN parameters: set with `setXxx()` before `execute()`.
- OUT parameters: register with `registerOutParameter(index, Types.XYZ)` before `execute()`, retrieve with `getXxx()` after.
- INOUT parameters: both set AND register; retrieve after `execute()`.
- `execute()` is the typical method to call stored procedures.
- `CallableStatement` extends `PreparedStatement` — all `setXxx` methods are available.

---

## References

- [Oracle Docs — CallableStatement](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/CallableStatement.html)
- OCP Study Guide, Chapter 15 — JDBC
