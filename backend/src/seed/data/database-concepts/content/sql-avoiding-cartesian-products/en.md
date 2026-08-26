---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

A Cartesian product happens when a query's `FROM` clause pairs every row of one
table with every row of another, because no condition ever narrows the pairing
down to matching rows. SQL doesn't refuse to run such a query — it just returns
the full cross product, silently, which is what makes this mistake dangerous: the
query executes without error and returns *plausible-looking* rows, just far more
of them (and far wrong) than intended.

## Use Cases

- Diagnosing a query that returns "too many rows" or duplicated values per
  logical entity — the classic symptom of a Cartesian product hiding inside an
  otherwise-reasonable-looking multi-table query.
- Reviewing or writing any query with more than one table in the `FROM` clause,
  to check that every table is actually joined to something instead of just
  listed.
- Deliberately using a Cartesian product (`CROSS JOIN`) for what it's
  legitimately good at — pivoting/transposing a result set, generating a
  sequence of numbers or dates, or emulating a fixed-count loop.

## Deep Dive

### The mistake: filtering one table but never joining the other

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = 10
```

This looks reasonable — it filters `emp` down to department 10 — but it never
relates `dept` back to `emp` at all. Every row of `dept` gets paired with every
qualifying row of `emp`:

```
ENAME        LOC
----------   -------------
CLARK        NEW YORK
CLARK        DALLAS
CLARK        CHICAGO
CLARK        BOSTON
KING         NEW YORK
KING         DALLAS
KING         CHICAGO
KING         BOSTON
MILLER       NEW YORK
MILLER       DALLAS
MILLER       CHICAGO
MILLER       BOSTON
```

Only the `NEW YORK` rows are correct — department 10 is actually located in New
York, so `CLARK`/`KING`/`MILLER` paired with Dallas, Chicago, or Boston are
fabricated combinations that happen to look like real query output.

### The fix: an explicit join condition between every pair of tables

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = 10
   and d.deptno = e.deptno
```

Adding `d.deptno = e.deptno` restricts each `emp` row to pairing with only the
one matching `dept` row, instead of all of them:

```
ENAME        LOC
----------   ---------
CLARK        NEW YORK
KING         NEW YORK
MILLER       NEW YORK
```

### Why it happens: row count is the product of the two cardinalities

`emp` filtered to department 10 yields 3 rows; `dept` with no filter at all
yields all 4 rows. With no join condition connecting them, the query returns
every possible pairing: 3 × 4 = 12 rows — exactly what the broken query above
produced. This is mechanical, not a coincidence: an *n*-table `FROM` clause with
no relating condition between two of those tables always returns the product of
their row counts, however large that happens to be.

### The n−1 rule as a starting checklist

With `n` tables in the `FROM` clause, `n − 1` is the *minimum* number of join
conditions needed to connect every table to at least one other — a 3-table query
needs at least 2 join conditions, a 4-table query at least 3, and so on. It's a
floor, not a guarantee: depending on the actual keys and relationships involved,
a query can need more than `n − 1` conditions to be fully correct (e.g., a
association/junction table needs its own separate condition to each side it
relates). Treat `n − 1` as the minimum sanity check when reviewing a multi-table
query, not as proof the query is right.

## Trade-offs

- **A Cartesian product is a silent failure, not a loud one.** The query is
  syntactically valid and executes successfully — there's no error to catch it,
  only a row count and result shape that look wrong on inspection. This is
  exactly why it's worth deliberately counting join conditions against table
  count (`n − 1`) rather than assuming "it ran, so it's right."
- **Cartesian products are a real, useful tool when used on purpose** — pivoting
  or transposing a result set, generating a sequence of values, or emulating a
  fixed-count loop are all legitimate uses of an intentional cross join. The
  danger is specifically the *accidental*, unintended case shown above, not the
  operation itself.
- **Old-style comma joins in the `FROM` clause put the entire correctness burden
  on the `WHERE` clause, with nothing to catch an omission.** Both this book's
  broken and fixed queries use `FROM emp e, dept d` — the only thing separating
  the Cartesian-product bug from the correct query is one line inside `WHERE`
  that's easy to lose during later edits (a refactor, a copy-paste, a merge).
  Current SQL style guidance across PostgreSQL, MySQL, and SQL Server recommends
  the ANSI-92 explicit `JOIN ... ON` syntax instead, specifically because a
  missing `ON` clause is a **syntax error** the engine refuses to run, rather
  than a silently-accepted Cartesian product:
  ```sql
  -- old style: a missing/deleted WHERE condition silently cross-joins
  select e.ename, d.loc from emp e, dept d where e.deptno = 10;

  -- ANSI style: omitting ON is a parse error, not a silent bug
  select e.ename, d.loc
    from emp e
    join dept d on d.deptno = e.deptno
   where e.deptno = 10;
  ```
  This isn't a book-vs-today correction so much as a book-vs-current-best-
  -practice note — the book's comma-join examples were already old-style syntax
  when the book was written; explicit `JOIN`/`ON` has been the SQL-92 standard
  and the generally recommended style for decades, and this recipe is a
  concrete illustration of exactly the failure mode that style avoids.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.8, p. 51 — doc
- [PostgreSQL Documentation — 7.2.1. Joined Tables (CROSS JOIN vs. old-style comma FROM)](https://www.postgresql.org/docs/current/queries-table-expressions.html) — doc
- [MySQL Reference Manual — JOIN Clause](https://dev.mysql.com/doc/refman/8.0/en/join.html) — doc
- [Microsoft Learn — FROM (Transact-SQL), joined tables](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql) — doc
