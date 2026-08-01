# Practice: JDBC

> Five exercises covering what the slides in this module introduced —
> try-with-resources and the closing order of `Connection`/`Statement`/
> `ResultSet`, `PreparedStatement` parameter binding versus raw `Statement`
> concatenation, `ResultSet` cursor rules, `CallableStatement` OUT parameter
> registration, and manual transaction control. Try to answer before opening
> each explanation.

---

## Exercise 1 — Closing order in a multi-resource try-with-resources

```java
try (Connection conn = DriverManager.getConnection(url, user, pass);
     PreparedStatement ps = conn.prepareStatement("SELECT * FROM animals");
     ResultSet rs = ps.executeQuery()) {

    while (rs.next()) {
        System.out.println(rs.getString("name"));
    }
}
```

In what order are `conn`, `ps`, and `rs` closed when the try block exits?
Does the order in which they're declared matter here?

<details>
<summary>Answer</summary>

They are closed in **reverse declaration order**: `rs.close()` first, then
`ps.close()`, then `conn.close()`.

`Connection`, `PreparedStatement` (via its parent `Statement`), and
`ResultSet` are all `AutoCloseable` (each `close()` is declared to throw
`SQLException`). A try-with-resources statement always closes the
resources it declares in the **reverse order of their declaration**,
regardless of resource type — that's a general Java rule, not
JDBC-specific.

The order matters a lot here because of the dependency chain: `rs` was
produced by `ps`, and `ps` was produced by `conn`. Closing in reverse
declaration order naturally closes the *dependent* resource before the
resource it depends on — you'd never want `conn` to close while `ps` (and
transitively `rs`) is still open. Had you declared them in the opposite
order (`rs`, then `ps`, then `conn`), the try-with-resources block simply
wouldn't compile as written, since `ps` and `conn` must already be in
scope for `rs`'s and `ps`'s initializers to reference them — declaration
order is forced by the data dependencies, and close order is always the
mirror image of it.

As a side note, closing `ps` also cascades to close any `ResultSet` it
produced, per the JDBC spec. That's harmless here since `rs.close()` had
already run first — `ResultSet.close()`, like most JDBC `close()` methods,
is safe to call on an already-closed resource and does not throw.

</details>

---

## Exercise 2 — Parameter indexing and `Statement` vs `PreparedStatement`

```java
String userInput = "Otto"; // imagine this came from a web form
Statement rawStmt = conn.createStatement();
ResultSet r1 = rawStmt.executeQuery(
    "SELECT * FROM animals WHERE name = '" + userInput + "'");

String sql = "INSERT INTO animals (id, name, species) VALUES (?, ?, ?)";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setInt(0, 100);
ps.setString(1, "Otto");
ps.setString(2, "Otter");
ps.executeUpdate();
```

Two problems here — one about safety, one about compiling/running
correctly. What are they?

<details>
<summary>Answer</summary>

**Problem 1 — SQL injection via `Statement`.** `rawStmt.executeQuery(...)`
builds the query by concatenating `userInput` directly into the SQL text.
If `userInput` were something like `x' OR '1'='1`, the resulting string
changes the *meaning* of the query, not just its data — that's SQL
injection. `Statement` has no concept of parameters; whatever string you
hand it is executed verbatim. This code compiles and "works" for normal
input, but it's unsafe by construction.

**Problem 2 — wrong parameter index.** `PreparedStatement` placeholders
(`?`) are indexed **starting at 1**, matching their left-to-right position
in the SQL text — the first `?` is index 1, not 0. `ps.setInt(0, 100)`
uses index `0`, which is out of range for a statement with parameters
1–3; a compliant driver throws `SQLException` (invalid parameter index)
here. This code compiles fine (indices are plain `int` arguments, not
checked by the compiler) but fails at the point `setInt(0, ...)` runs. And
even setting that aside, the code only ever binds indices 1 and 2 — index
3 (`species`) is never set at all, so `executeUpdate()` would also fail
with "parameter not set" once the indexing bug is fixed.

The safe, correct version binds all three placeholders starting at 1:

```java
ps.setInt(1, 100);
ps.setString(2, "Otto");
ps.setString(3, "Otter");
```

Because `PreparedStatement` always treats bound values as *data*, never as
SQL syntax, the equivalent parameterized query is immune to the injection
problem in `rawStmt` above — that's the core safety argument for
preferring `PreparedStatement` over `Statement` whenever a value comes
from outside the program.

</details>

---

## Exercise 3 — `ResultSet` cursor position before `next()`

```java
try (ResultSet rs = ps.executeQuery()) {
    int firstTry = rs.getInt("id");   // (A) — before any next()

    while (rs.next()) {
        int id1 = rs.getInt("id");    // (B)
        int id2 = rs.getInt("id");    // (C) — same column, read again
    }
}
```

Which line, if any, throws an exception? Is reading the same column twice
in a row — lines (B) and (C) — a problem?

<details>
<summary>Answer</summary>

Line **(A) throws `SQLException`.**

A freshly obtained `ResultSet` starts with its cursor positioned
**before the first row**. That position doesn't correspond to any actual
row, so calling any `getXxx()` method before the first successful call to
`next()` is invalid — the driver throws `SQLException`. `next()` must be
called first to move the cursor onto row 1, and `next()` returns `true`
only if that move landed on a real row.

Lines **(B) and (C) are both fine.** `getXxx()` methods don't consume or
advance the cursor — they just read whatever value is currently sitting
in that column of the *current* row. There's no restriction against
reading the same column more than once (or reading columns out of order,
or re-reading a column you already read) before the next call to
`next()`. The cursor only moves when you explicitly call a positioning
method like `next()`, `previous()`, or `absolute()`.

</details>

---

## Exercise 4 — `CallableStatement` OUT parameter ordering

```java
CallableStatement cs = conn.prepareCall("{call count_animals(?)}");

cs.execute();
cs.registerOutParameter(1, java.sql.Types.INTEGER);

int total = cs.getInt(1);
```

`count_animals` declares a single `OUT INT` parameter. What's wrong with
this code?

<details>
<summary>Answer</summary>

`registerOutParameter()` is called **after** `execute()`, but the JDBC
contract requires it to be called **before** `execute()`.

Registering an OUT parameter tells the driver "parameter 1 will hold a
result the database writes back, and it should be interpreted as
`INTEGER`" — the driver needs that information *before* it runs the call
so it can correctly bind and later marshal the returned value. Here,
`execute()` runs first with no OUT parameter registered at all, so the
driver has no way to know parameter 1 is an output. The specific failure
mode is implementation-dependent, but the contract violation itself is
exam-relevant: this is a `SQLException`-producing bug, not something that
silently works.

The corrected order matches the slide's pattern — register first, execute
second, retrieve last:

```java
CallableStatement cs = conn.prepareCall("{call count_animals(?)}");
cs.registerOutParameter(1, java.sql.Types.INTEGER);  // before execute()
cs.execute();
int total = cs.getInt(1);                            // after execute()
```

Note also that if `count_animals` had an **IN** parameter instead, you'd
bind it with a `setXxx(index, value)` call — the same methods
`PreparedStatement` uses, since `CallableStatement extends
PreparedStatement`. An **INOUT** parameter needs both: `setXxx()` to
supply the input *and* `registerOutParameter()` to declare it as an
output, both before `execute()`.

</details>

---

## Exercise 5 — Forgetting to commit or roll back

```java
Connection conn = DriverManager.getConnection(url, user, pass);
conn.setAutoCommit(false);

PreparedStatement ps = conn.prepareStatement(
    "UPDATE accounts SET balance = balance - 100 WHERE id = 1");
ps.executeUpdate();

conn.close();  // neither commit() nor rollback() was ever called
```

Does the balance update take effect in the database?

<details>
<summary>Answer</summary>

**No — the change is not committed, and effectively behaves as if rolled
back.**

`Connection`'s auto-commit mode is **`true` by default**, meaning each
statement is normally its own transaction, committed the instant it
finishes executing. Here, `conn.setAutoCommit(false)` turns that off
first, so the subsequent `executeUpdate()` only stages the change as part
of an open, uncommitted transaction — it is *not* written permanently
until something calls `conn.commit()`.

This code never calls `commit()`. It also never calls `rollback()` — it
just closes the connection with the transaction still open. Per the exam
tip from this module: closing a `Connection` while a manual transaction is
still active typically triggers an implicit rollback, discarding the
pending `UPDATE`. The balance is left exactly as it was before this code
ran.

The fix is to explicitly decide the transaction's fate before closing —
typically inside a try/catch so failures roll back and success commits:

```java
try {
    ps.executeUpdate();
    conn.commit();          // make the change permanent
} catch (SQLException e) {
    conn.rollback();        // undo everything since the last commit
} finally {
    conn.close();
}
```

The general rule to take away: once auto-commit is disabled, *nothing* is
durable until `commit()` runs — not executing the statement, not closing
the connection, nothing but an explicit `commit()` call.

</details>
