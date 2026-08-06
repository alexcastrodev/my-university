---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Deleting records referenced from another table means the rows to remove aren't
identified by anything inside the target table itself — they're identified by
their relationship to rows in a *second* table. "Delete every employee who
works in a department that has had three or more accidents" can't be answered
by any predicate over `EMP` alone: the qualifying set lives in
`DEPT_ACCIDENTS`, and the `DELETE` has to reach across to it. That reach is
what makes this a distinct problem from a plain `DELETE ... WHERE` — you need
a subquery, a join, or a vendor-specific multi-table `DELETE` form, and each
of those three carries different portability and NULL-handling behaviour.

## Use Cases

- Manual cascading cleanup when no foreign key with `ON DELETE CASCADE`
  exists — purging child rows tied to a parent record you're about to remove,
  or that was deleted long ago by a process that didn't cascade.
- Purging rows tied to a deprecated, closed, or blacklisted parent: employees
  in shut-down departments, orders for discontinued products, sessions
  belonging to deactivated accounts.
- Applying a rule that only a *derived* fact can express — "departments with
  ≥ 3 accidents", "customers with more than N chargebacks" — where the
  qualifying set comes out of an aggregate over the referencing table.
- Orphan cleanup, the inverse case: deleting rows in a child table whose
  parent no longer exists in the reference table (`NOT IN` / `NOT EXISTS`).
- Deleting rows staged in a work/queue table after a downstream job has
  recorded them as processed in a second table.

## Deep Dive

### The `IN` subquery: portable, and correct on all three engines

Given a table recording one row per accident per department:

```sql
create table dept_accidents
( deptno        integer,
  accident_name varchar(20) );

insert into dept_accidents values (10,'BROKEN FOOT');
insert into dept_accidents values (10,'FLESH WOUND');
insert into dept_accidents values (20,'FIRE');
insert into dept_accidents values (20,'FIRE');
insert into dept_accidents values (20,'FLOOD');
insert into dept_accidents values (30,'BRUISED GLUTE');
```

the qualifying departments come from an aggregate over that table:

```sql
select deptno
  from dept_accidents
 group by deptno
having count(*) >= 3;

-- DEPTNO
-- ------
--     20
```

and the `DELETE` feeds that result into an `IN` predicate:

```sql
delete from emp
 where deptno in ( select deptno
                     from dept_accidents
                    group by deptno
                   having count(*) >= 3 );
```

This runs unmodified on PostgreSQL, MySQL, and SQL Server. Crucially — unlike
the same-table `DELETE` in the duplicate-removal recipe — the subquery reads
from a *different* table than the one being deleted from, so MySQL's error
1093 (`Can't specify target table ... for update in FROM clause`) never fires.
MySQL only forbids selecting from the delete target inside a subquery; reading
`dept_accidents` while deleting from `emp` is perfectly legal. Microsoft's own
docs label this shape the "SQL-2003 Standard subquery" solution, and it is
still the most portable way to write the statement today.

### The correlated form: `EXISTS`

The same delete expressed as a correlated `EXISTS` — the subquery runs once
per candidate row and only its *existence*, not its value, matters:

```sql
delete from emp e
 where exists ( select 1
                  from dept_accidents da
                 where da.deptno = e.deptno
                 group by da.deptno
                having count(*) >= 3 );
```

or, with a correlated scalar aggregate instead of `GROUP BY`/`HAVING`:

```sql
delete from emp e
 where ( select count(*)
           from dept_accidents da
          where da.deptno = e.deptno ) >= 3;
```

Both run on all three engines. For the *positive* case (`IN` / `EXISTS`) the
two forms are semantically identical and every modern optimizer flattens them
into the same semi-join, so the choice is stylistic. It stops being stylistic
the moment the predicate is negated — see below.

### The inverse case: `NOT IN` is where NULLs bite

Deleting rows *not* referenced by the second table — orphan cleanup — looks
symmetric but isn't:

```sql
-- deletes NOTHING if dept_accidents.deptno contains even one NULL
delete from emp
 where deptno not in (select deptno from dept_accidents);
```

If the subquery yields a `NULL`, `x NOT IN (...)` evaluates to `NULL` rather
than `TRUE` for every row, and the statement silently deletes zero rows
without raising an error. PostgreSQL documents the rule explicitly: "if the
left-hand expression yields null, or if there are no equal right-hand values
and at least one right-hand row yields null, the result of the `NOT IN`
construct will be null, not true." The same three-valued logic applies on
MySQL and SQL Server. `NOT EXISTS` has no such trap — it tests row existence,
not value equality, and an all-`NULL` match simply doesn't exist:

```sql
delete from emp e
 where not exists ( select 1
                      from dept_accidents da
                     where da.deptno = e.deptno );
```

Reach for `NOT EXISTS` by default on the negated case. The positive `IN` form
in the book's recipe is safe precisely because `IN` returning `NULL` behaves
like `FALSE` for a `WHERE` clause — the row just isn't deleted, which is the
conservative outcome. Negation inverts that safety.

### Join-based `DELETE`: three vendors, three different syntaxes

Every engine offers a join form as an alternative to the subquery, and no two
of them spell it the same way. The aggregate has to move into a derived table,
because `HAVING` can't live in a join condition:

**PostgreSQL** — `USING` introduces the extra relation; the join predicate
goes in `WHERE`:

```sql
delete from emp
      using ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) risky
      where emp.deptno = risky.deptno;
```

**SQL Server** — a second `FROM` clause, a T-SQL extension. The target table
is named once as the delete target and again (aliased) in the join:

```sql
delete e
  from emp as e
 inner join ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) as risky
    on e.deptno = risky.deptno;
```

**MySQL** — the multiple-table `DELETE`, where the tables to delete *from* are
listed before `FROM` and the join lives after it:

```sql
delete emp
  from emp
 inner join ( select deptno
                from dept_accidents
               group by deptno
              having count(*) >= 3 ) risky
    on emp.deptno = risky.deptno;
```

MySQL also accepts a `USING` spelling — and it is a false friend. Unlike
PostgreSQL's, MySQL's `USING` requires the target table to *also* appear in
the table references:

```sql
-- MySQL: target repeated after USING
delete from emp using emp inner join dept_accidents da on da.deptno = emp.deptno;

-- PostgreSQL: target must NOT be repeated after USING
delete from emp using dept_accidents da where da.deptno = emp.deptno;
```

Copying a `DELETE ... USING` between the two engines produces either a syntax
error or, worse on PostgreSQL, an accidental self-join. PostgreSQL's manual
states the rule directly: do not repeat the target table as a `from_item`
unless you actually want a self-join.

## Trade-offs

- **`IN` is safe here; `NOT IN` is the one to avoid.** The book's positive
  `IN` form degrades gracefully when the subquery contains `NULL`s — the row
  simply isn't deleted. Invert the predicate and the same `NULL` turns the
  whole statement into a no-op that reports success. Use `NOT EXISTS` for
  every anti-join delete, or at minimum add `where deptno is not null` inside
  the subquery.
  ```sql
  -- reports "0 rows deleted", raises nothing, and is almost never what was meant
  delete from emp where deptno not in (select deptno from dept_accidents);
  ```
- **`EXISTS` versus `IN` is a readability call, not a performance one.**
  Modern PostgreSQL, MySQL, and SQL Server optimizers all rewrite both into a
  semi-join, so the folk rule that one is inherently faster no longer holds.
  Pick `IN` when the qualifying set is a standalone query worth reading on its
  own (as the aggregate here is), and `EXISTS` when the correlation to the
  outer row is the point.
- **Join forms can be faster, but they're the least portable thing in the
  chapter.** PostgreSQL's `USING`, SQL Server's second `FROM`, and MySQL's
  multiple-table `DELETE` are three mutually incompatible vendor extensions
  for one idea — PostgreSQL's own docs flag `USING` as a non-standard
  extension, and Microsoft's flag the second `FROM` the same way. The
  subquery form is the only shape that survives a database migration
  untouched.
- **Join fan-out is harmless for `DELETE`, unlike for `UPDATE`.** Department
  20 has three accident rows, so joining `emp` directly to `dept_accidents`
  matches each employee three times. A `DELETE` still removes each row exactly
  once, so the duplicate matches cost work but not correctness — the same
  fan-out in an `UPDATE ... FROM` would apply a non-deterministically chosen
  one of the matching rows instead.
- **MySQL's multiple-table `DELETE` gives up `ORDER BY` and `LIMIT`.** Both
  clauses are documented as single-table-only, so the common "delete in
  batches of 10,000" pattern can't be expressed in the join form — batching a
  cross-table delete on MySQL means going back to the subquery form with a
  `LIMIT`ed inner query.
- **Preview before you delete.** Every technique above is trivially converted
  to a `SELECT` by swapping the leading clause, and the qualifying set is
  usually small enough to eyeball. Running `select * from emp where deptno in
  (...)` first costs one round trip and is the only real safety net, since
  none of these engines can undo a committed `DELETE`.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 4, "Inserting, Updating, and Deleting", recipe 4.17, p. 87-89 — doc
- [PostgreSQL Documentation — DELETE (USING clause, self-join warning, standard compatibility)](https://www.postgresql.org/docs/current/sql-delete.html) — doc
- [PostgreSQL Documentation — Subquery Expressions (IN / NOT IN null semantics)](https://www.postgresql.org/docs/current/functions-subquery.html) — doc
- [MySQL Reference Manual — DELETE Statement (multiple-table syntax, ORDER BY/LIMIT restriction)](https://dev.mysql.com/doc/refman/8.4/en/delete.html) — doc
- [Microsoft Learn — DELETE (Transact-SQL) (FROM table_source extension vs. ISO subquery)](https://learn.microsoft.com/en-us/sql/t-sql/statements/delete-transact-sql) — doc
