# Controlling Data with Transactions

> A transaction groups multiple SQL operations into a single atomic unit — either all succeed or all are rolled back. JDBC exposes transaction control through `Connection` methods. The OCP exam tests auto-commit mode, manual commit and rollback, savepoints, and transaction isolation levels and their trade-offs.

---

## What Is a Transaction?

A **transaction** is a sequence of SQL operations that must complete as one atomic unit. The classic example is a bank transfer:

1. Deduct $100 from account A
2. Add $100 to account B

If step 2 fails after step 1 succeeds, the data is corrupt. A transaction ensures both steps either commit together or roll back together.

Transactions are governed by the **ACID** properties:

| Property | Meaning |
|---|---|
| **Atomicity** | All operations succeed or none take effect |
| **Consistency** | The database moves from one valid state to another |
| **Isolation** | Concurrent transactions do not see each other's partial changes |
| **Durability** | Committed changes survive system failures |

---

## Auto-Commit Mode

By default, every SQL statement on a JDBC `Connection` is automatically committed immediately after execution — this is **auto-commit mode** (`true` by default):

```java
// Default behavior — each statement is its own transaction
try (Connection conn = DriverManager.getConnection(url, user, pass)) {
    System.out.println(conn.getAutoCommit()); // true

    PreparedStatement ps = conn.prepareStatement("INSERT INTO animals VALUES (?, ?)");
    ps.setInt(1, 1); ps.setString(2, "Cat");
    ps.executeUpdate();  // committed immediately — cannot be rolled back
}
```

---

## Manual Transaction Control

Disable auto-commit to group operations into a manual transaction:

```java
try (Connection conn = DriverManager.getConnection(url, user, pass)) {
    conn.setAutoCommit(false);  // begin manual transaction

    try {
        PreparedStatement debit = conn.prepareStatement(
            "UPDATE accounts SET balance = balance - ? WHERE id = ?");
        debit.setDouble(1, 100.0);
        debit.setInt(2, 1001);
        debit.executeUpdate();

        PreparedStatement credit = conn.prepareStatement(
            "UPDATE accounts SET balance = balance + ? WHERE id = ?");
        credit.setDouble(1, 100.0);
        credit.setInt(2, 1002);
        credit.executeUpdate();

        conn.commit();   // both updates committed atomically
        System.out.println("Transfer successful");

    } catch (SQLException e) {
        conn.rollback(); // undo all changes if anything went wrong
        System.err.println("Transfer failed, rolled back: " + e.getMessage());
    }
}
```

Key methods:

| Method | Description |
|---|---|
| `setAutoCommit(false)` | Starts a manual transaction boundary |
| `commit()` | Makes all changes since the last commit permanent |
| `rollback()` | Undoes all changes since the last commit |
| `getAutoCommit()` | Returns current auto-commit setting |

> **Exam tip:** Calling `close()` on a `Connection` in manual transaction mode typically triggers an implicit rollback. Always explicitly `commit()` or `rollback()` before closing.

---

## Savepoints

A **savepoint** marks a specific point within a transaction. You can roll back to a savepoint without undoing the entire transaction:

```java
conn.setAutoCommit(false);

// Step 1: insert category
conn.prepareStatement("INSERT INTO categories VALUES (1, 'Mammals')").executeUpdate();

Savepoint sp = conn.setSavepoint("after_category");  // mark savepoint

// Step 2: insert animal (may fail)
try {
    conn.prepareStatement("INSERT INTO animals VALUES (1, 'Tiger', 1)").executeUpdate();
    conn.commit();  // commit everything

} catch (SQLException e) {
    // Roll back only to the savepoint — category insert is preserved
    conn.rollback(sp);
    conn.commit();  // commit the category without the animal
    System.out.println("Animal insert failed; category saved.");
}
```

Savepoint methods:

| Method | Description |
|---|---|
| `setSavepoint()` | Creates an unnamed savepoint |
| `setSavepoint(String name)` | Creates a named savepoint |
| `rollback(Savepoint sp)` | Rolls back to the specified savepoint |
| `releaseSavepoint(Savepoint sp)` | Removes the savepoint (frees resources) |

> **Exam tip:** After rolling back to a savepoint, the transaction is still open — you can still commit or roll back further.

---

## Transaction Isolation Levels

When multiple transactions run concurrently, they can interfere in three ways:

| Problem | Description |
|---|---|
| **Dirty read** | Reading uncommitted data from another transaction |
| **Non-repeatable read** | Same row read twice gives different values because another transaction committed an update between the reads |
| **Phantom read** | Same query run twice returns different rows because another transaction inserted or deleted rows between the reads |

JDBC defines four isolation levels, each trading performance for protection:

| Constant | Dirty Reads | Non-Repeatable Reads | Phantom Reads | Notes |
|---|---|---|---|---|
| `TRANSACTION_READ_UNCOMMITTED` | Possible | Possible | Possible | Fastest; least safe |
| `TRANSACTION_READ_COMMITTED` | Prevented | Possible | Possible | Most databases' default |
| `TRANSACTION_REPEATABLE_READ` | Prevented | Prevented | Possible | Good for reports |
| `TRANSACTION_SERIALIZABLE` | Prevented | Prevented | Prevented | Safest; slowest |

Setting the isolation level:

```java
conn.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
conn.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

Check the current level:

```java
int level = conn.getTransactionIsolation();
// compare with Connection.TRANSACTION_READ_COMMITTED, etc.
```

> **Exam tip:** Higher isolation prevents more anomalies but reduces concurrency and throughput. Know which anomalies each level prevents — this is a common OCP exam question.

---

## Isolation Level Memory Aid

Think of the levels as increasingly strict:

```
READ_UNCOMMITTED  →  READ_COMMITTED  →  REPEATABLE_READ  →  SERIALIZABLE
   (weakest)                                                   (strongest)
```

Each step up adds one more prevention:
- READ_COMMITTED: prevents dirty reads
- REPEATABLE_READ: also prevents non-repeatable reads
- SERIALIZABLE: also prevents phantom reads

---

## Key Rules Summary

- Auto-commit is `true` by default — each statement commits immediately.
- Call `setAutoCommit(false)` to begin manual transaction control.
- Use `commit()` to save changes and `rollback()` to undo them.
- Savepoints allow partial rollbacks within a transaction; always released or consumed by `rollback(savepoint)`.
- Four isolation levels: `READ_UNCOMMITTED`, `READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE`.
- Higher isolation = fewer anomalies but lower concurrency.
- Dirty reads, non-repeatable reads, and phantom reads are the three classic concurrency problems.

---

## References

- [Oracle Docs — Connection (transaction methods)](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Connection.html)
- [Oracle Docs — Savepoint](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Savepoint.html)
- OCP Study Guide, Chapter 15 — JDBC
