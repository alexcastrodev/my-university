# Introducing Relational Databases and SQL

> A relational database organizes data into tables of rows and columns. JDBC is the standard Java API for communicating with any relational database using SQL. Understanding the relational model and basic SQL syntax is the starting point for every database-driven Java application on the OCP exam.

---

## The Relational Model

A **relational database** stores data in one or more **tables** (also called *relations*). Each table has a fixed set of named **columns** (attributes), and each data entry is a **row** (tuple).

```
Table: animals
+----+----------+---------+
| id | name     | species |
+----+----------+---------+
|  1 | Fluffy   | Cat     |
|  2 | Buddy    | Dog     |
|  3 | Tweety   | Bird    |
+----+----------+---------+
```

### Key concepts

| Term | Description |
|---|---|
| **Table** | A named collection of rows sharing the same columns |
| **Column** | A named, typed attribute of a table |
| **Row** | A single record in a table |
| **Primary Key** | A column (or group of columns) whose value uniquely identifies each row |
| **Foreign Key** | A column whose values reference the primary key of another table |
| **Schema** | The logical structure that describes all tables and their relationships |

A **primary key** enforces uniqueness and prevents duplicate rows. In the example above, `id` is the primary key — no two animals share the same `id` value.

---

## SQL Sublanguages

SQL (Structured Query Language) is split into two main categories that the OCP exam tests:

| Sublanguage | Purpose | Common Statements |
|---|---|---|
| **DDL** — Data Definition Language | Creates and modifies the structure of database objects | `CREATE`, `ALTER`, `DROP` |
| **DML** — Data Manipulation Language | Reads and modifies the data stored in tables | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

---

## DDL — Creating a Table

```sql
CREATE TABLE animals (
    id      INT         PRIMARY KEY,
    name    VARCHAR(50) NOT NULL,
    species VARCHAR(50) NOT NULL
);
```

`DROP TABLE animals;` removes the table and all its data permanently.

---

## DML — Querying Data

**SELECT** retrieves rows from one or more tables:

```sql
-- All columns, all rows
SELECT * FROM animals;

-- Specific columns
SELECT name, species FROM animals;

-- Filtered rows
SELECT name FROM animals WHERE species = 'Dog';

-- Sorted results
SELECT * FROM animals ORDER BY name ASC;
```

**INSERT** adds a new row:

```sql
INSERT INTO animals (id, name, species) VALUES (4, 'Nemo', 'Fish');
```

**UPDATE** modifies existing rows:

```sql
UPDATE animals SET species = 'Goldfish' WHERE id = 4;
```

**DELETE** removes rows:

```sql
DELETE FROM animals WHERE id = 4;
```

> **Exam tip:** `DELETE FROM animals;` with no `WHERE` clause deletes *all* rows but preserves the table structure. `DROP TABLE animals;` removes the table entirely.

---

## JDBC: Java's Database API

**JDBC** (Java Database Connectivity) is the standard Java API for executing SQL against any relational database. It lives in the `java.sql` package and is part of the Java SE platform — no third-party library is required for the API itself.

The four core JDBC interfaces are:

| Interface | Role |
|---|---|
| `Connection` | Represents a live session with the database |
| `PreparedStatement` | A precompiled SQL statement with optional parameters |
| `CallableStatement` | Executes stored procedures |
| `ResultSet` | A cursor over the rows returned by a query |

Each database vendor supplies a **JDBC driver** — a concrete implementation of these interfaces that handles the actual network communication. Common drivers:

- H2 (in-memory, used heavily in tests and OCP examples)
- PostgreSQL (`org.postgresql.Driver`)
- MySQL (`com.mysql.cj.jdbc.Driver`)

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.PreparedStatement;
```

All meaningful JDBC operations declare or handle `java.sql.SQLException`, which is a **checked exception**.

---

## Key Rules Summary

- A table is a set of rows; each row has the same columns.
- A primary key uniquely identifies every row in a table.
- DDL (`CREATE`, `ALTER`, `DROP`) changes structure; DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) changes data.
- JDBC is in `java.sql`; every JDBC operation can throw the checked `SQLException`.
- The vendor-supplied JDBC driver provides the concrete implementations of `Connection`, `PreparedStatement`, and `ResultSet`.

---

## References

- [Oracle Docs — JDBC Overview](https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/package-summary.html)
- OCP Study Guide, Chapter 15 — JDBC
