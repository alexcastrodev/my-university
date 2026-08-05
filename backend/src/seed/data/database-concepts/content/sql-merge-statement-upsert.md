---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`MERGE` is a single statement that conditionally inserts, updates, or deletes
rows in a target table depending on whether a matching row exists in a
source (the "upsert" pattern, extended with an optional delete branch): if a
row in the source matches a row already in the target, update it — and if,
after evaluating that match, some further condition holds, delete it
instead; if no match exists, insert a new row built from the source. The
matching logic is a join between target and source, evaluated with `WHEN
MATCHED` / `WHEN NOT MATCHED` clauses rather than a separate `IF EXISTS`
check plus a hand-written `UPDATE`/`INSERT`/`DELETE`.

## Use Cases

- Syncing a summary or staging table (e.g. `emp_commission`) against a
  source table (`emp`) in one pass: update existing rows, insert new ones,
  and prune rows that no longer meet a business condition — without three
  separate statements racing each other.
- ETL and batch-load jobs that need idempotent "insert-or-update" semantics
  against a target table keyed by a natural or surrogate key.
- Any workflow that today requires an application-level "check, then branch"
  (`SELECT` to see if a row exists, then `UPDATE` or `INSERT`) — collapsing
  that check-then-act race into one atomic statement.

## Deep Dive

### The book's original syntax (a single WHEN MATCHED with UPDATE...DELETE)

The recipe's example against `emp_commission`/`emp` sets every matched row's
commission to 1000, then deletes it if the underlying employee's salary is
under 2000, and inserts unmatched rows outright:

```sql
merge into emp_commission ec
using (select * from emp) emp
   on (ec.empno = emp.empno)
 when matched then
      update set ec.comm = 1000
      delete where (sal < 2000)
 when not matched then
      insert (ec.empno, ec.ename, ec.deptno, ec.comm)
      values (emp.empno, emp.ename, emp.deptno, emp.comm)
```

The book notes MySQL has no `MERGE` at all, but otherwise presents this as
portable across "any RDBMS in this book." That single `WHEN MATCHED` clause
combining an `UPDATE ... DELETE WHERE` in one action is Oracle/DB2 syntax —
as the next two sections show, neither PostgreSQL's nor SQL Server's `MERGE`
accepts that combined form.

### PostgreSQL: native MERGE since PostgreSQL 15 (2022) — but no combined UPDATE...DELETE

PostgreSQL had **no** `MERGE` statement at all when this book's 2nd edition
was published in December 2020 — it shipped for the first time in
PostgreSQL 15 (released October 2022), nearly two years later. The
PostgreSQL 15 release notes list it directly under "Utility Commands": *"Add
SQL MERGE command to adjust one table to match another,"* and describe it as
similar to `INSERT ... ON CONFLICT` but more batch-oriented (able to match
against an arbitrary join condition, not just a unique-key conflict). So the
book's "works on any RDBMS in this book" claim didn't actually hold for
PostgreSQL at the time it was written — there was no PostgreSQL `MERGE` to
run it on.

Now that it exists, PostgreSQL's `MERGE` still rejects the book's one-clause
`UPDATE ... DELETE WHERE` action: per the docs, "for each candidate change
row, the first clause to evaluate as true is executed... no more than one
`WHEN` clause is executed for any candidate change row." The delete
condition has to be its own `WHEN MATCHED` clause, checked *before* the
plain update clause so it wins the row when true:

```sql
merge into emp_commission ec
using emp
   on (ec.empno = emp.empno)
when matched and emp.sal < 2000 then
     delete
when matched then
     update set comm = 1000
when not matched then
     insert (empno, ename, deptno, comm)
     values (emp.empno, emp.ename, emp.deptno, emp.comm);
```

### SQL Server: MERGE has been available since SQL Server 2008 — same two-clause restriction

SQL Server's `MERGE` predates the book by over a decade, and the Microsoft
docs confirm the same limit PostgreSQL has: at most two `WHEN MATCHED`
clauses are allowed, and if there are two, the first must carry an `AND
<condition>` — one clause does the `UPDATE`, the other does the `DELETE`.
There is no way to write `UPDATE ... DELETE WHERE` as a single action, so
the query is structurally identical to the PostgreSQL 15+ version above
(SQL Server additionally requires the statement to end with a semicolon):

```sql
merge into emp_commission as ec
using emp
   on (ec.empno = emp.empno)
when matched and emp.sal < 2000 then
     delete
when matched then
     update set comm = 1000
when not matched then
     insert (empno, ename, deptno, comm)
     values (emp.empno, emp.ename, emp.deptno, emp.comm);
```

### MySQL: no MERGE — INSERT ... ON DUPLICATE KEY UPDATE handles only the insert-or-update half

MySQL still has no `MERGE` statement, in any current version (8.4/9.x). Its
idiomatic upsert is `INSERT ... ON DUPLICATE KEY UPDATE`, which relies on a
`UNIQUE`/`PRIMARY KEY` violation — not a join condition — to decide whether
to insert or update:

```sql
insert into emp_commission (empno, ename, deptno, comm)
select empno, ename, deptno, 1000
  from emp
on duplicate key update comm = 1000;
```

This requires `emp_commission.empno` to actually carry a `UNIQUE` or
`PRIMARY KEY` constraint — without one, MySQL has no violation to detect and
every row is inserted as new. It also has no delete branch: the book's
"delete if salary was under 2000" step needs a second, separate statement
run afterward:

```sql
delete ec
  from emp_commission ec
  join emp on emp.empno = ec.empno
 where emp.sal < 2000;
```

## Trade-offs

- **Neither PostgreSQL's nor SQL Server's `MERGE` accepts the book's
  single-clause `UPDATE ... DELETE WHERE` action.** Both require the delete
  condition to be its own `WHEN MATCHED AND ... THEN DELETE` clause,
  evaluated ahead of the plain `WHEN MATCHED THEN UPDATE` clause so it can
  claim the row first — the book's combined form is Oracle/DB2 syntax, not
  a lowest-common-denominator across engines.
  ```sql
  -- rejected on PostgreSQL and SQL Server: DELETE cannot follow UPDATE in one WHEN MATCHED
  when matched then
       update set comm = 1000
       delete where (sal < 2000)
  ```
- **MySQL's upsert can insert-or-update, but never delete, in the same
  statement.** `INSERT ... ON DUPLICATE KEY UPDATE` has no delete branch at
  all, so replicating the book's third step (delete rows whose salary fell
  under 2000) needs a second, separate `DELETE` statement — two statements
  that are only atomic together if explicitly wrapped in a transaction,
  unlike the other two engines' single-statement `MERGE`.
- **The book's "works on any RDBMS in this book" portability claim didn't
  hold for PostgreSQL at the time of publication.** PostgreSQL had no
  `MERGE` statement until version 15, released in October 2022 — almost two
  years after this 2nd edition (December 2020) went to print. Anyone
  running this recipe against a PostgreSQL 12/13/14 server, as the era's
  companion *PostgreSQL 12 High Availability Cookbook* would have targeted,
  would have gotten a syntax error, not a working `MERGE`.
- **`MERGE`'s join-based matching is more general than `ON CONFLICT`/`ON
  DUPLICATE KEY UPDATE`, but that generality isn't free.** PostgreSQL's own
  release notes describe `MERGE` as similar to `INSERT ... ON CONFLICT` but
  "more batch-oriented" — for a simple single-key upsert with no delete
  branch, `ON CONFLICT` (PostgreSQL) or `ON DUPLICATE KEY UPDATE` (MySQL)
  is usually the simpler, more idiomatic choice; `MERGE` earns its
  complexity when the matching logic is a real join or a delete branch is
  needed, as in this recipe.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 4, "Inserting, Updating, and Deleting", recipe 4.11 "Merging Records", p. 80-82 — doc
- [PostgreSQL Documentation — MERGE](https://www.postgresql.org/docs/current/sql-merge.html) — doc
- [PostgreSQL 15 Release Notes — Add SQL MERGE command](https://www.postgresql.org/docs/15/release-15.html) — doc
- [MySQL Reference Manual — INSERT ... ON DUPLICATE KEY UPDATE Statement](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html) — doc
- [Microsoft Learn — MERGE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/merge-transact-sql) — doc
