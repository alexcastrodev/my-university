---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

Knowing two tables (or a table and a view meant to reproduce it) have the "same
data" means more than matching row counts — it means every row, including its
number of duplicates, matches on both sides. A plain row-count check can pass
while the actual data differs (ten rows on each side can still be ten
*different* rows), and a naive `UNION`-based comparison silently collapses
duplicates, hiding cardinality mismatches. The fix is a **symmetric set
difference**: find what's in table A but not in B, combine it with what's in B
but not in A, and if that combined result is empty, the tables are identical;
otherwise, exactly the differing rows come back, ready to inspect.

## Use Cases

- Verifying that a reporting/staging copy of a table produced by an ETL job or
  replication step still matches the source exactly, after a run.
- Confirming a view, CTE, or refactored query reproduces an existing table's
  rows one-for-one, including how many times each row appears.
- Regression-testing a rewritten query against the query it's meant to
  replace: same result set, not just a similar-looking one.
- Catching duplicate rows introduced by a bad `UNION ALL` or a join that
  fanned out — a plain row-count or `UNION`-based diff would miss this because
  it can't tell "10 distinct rows" from "10 rows where one appears three
  times."

## Deep Dive

### Step zero: a cheap cardinality sanity check with UNION

Before comparing full row contents, a trivial `UNION` of the two row counts is
a fast way to *disprove* equality, on any DBMS:

```sql
select count(*) from emp
union
select count(*) from dept

COUNT(*)
--------
       4
      14
```

`UNION` removes duplicates, so if the two tables had the same cardinality this
would return exactly one row. Two rows back means the tables already differ —
no need to run the more expensive full comparison. But the reverse doesn't
hold: matching cardinality does *not* prove the tables hold the same data.

### PostgreSQL: symmetric difference with EXCEPT

Given a view `V` meant to mirror table `EMP` (built here from two halves via
`UNION ALL`, including a deliberately duplicated row for `WARD` to prove the
technique also catches duplicates, not just missing/extra rows):

```sql
create view V as
select * from emp where deptno != 10
 union all
select * from emp where ename = 'WARD';
```

Compare it to `EMP` by finding rows in `V` not in `EMP`, and rows in `EMP` not
in `V`, then `UNION ALL` the two halves together. `GROUP BY` + `COUNT(*)`
folds the row's own multiplicity into what's compared, so a duplicate becomes
part of the difference, not something `EXCEPT` (which is duplicate-eliminating
by default) quietly throws away:

```sql
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  except
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
union all
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  except
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
```

Running just the first half (`V EXCEPT EMP`) in isolation returns exactly one
row: `WARD`'s row with `cnt = 2`, because `V` has it twice and `EMP` has it
once — the mismatch is in the *count*, not the values. The second half (`EMP
EXCEPT V`) returns every department-10 employee plus `WARD` with `cnt = 1`,
because `EMP` has those rows and `V` (built with `deptno != 10`) doesn't. An
empty combined result means the two sides are identical, cardinality and all.

### Oracle: the same idea with MINUS

Oracle's `MINUS` is the same operator under a different name — same
`GROUP BY`/`COUNT(*)` shape, same symmetric `UNION ALL` of both directions:

```sql
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  minus
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
union all
(
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from emp
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
  minus
  select empno, ename, job, mgr, hiredate, sal, comm, deptno,
         count(*) as cnt
    from V
   group by empno, ename, job, mgr, hiredate, sal, comm, deptno
)
```

### Where EXCEPT/MINUS aren't available: correlated NOT EXISTS

The book presents this as the MySQL/SQL Server fallback for engines with no
set-difference operator at all: build the same per-row `cnt` in an inline
view on each side, then use a correlated `NOT EXISTS` to find rows on one side
with no matching row (all columns *and* `cnt`) on the other, `UNION ALL`
both directions:

```sql
select *
  from (
       select e.empno, e.ename, e.job, e.mgr, e.hiredate,
              e.sal, e.comm, e.deptno, count(*) as cnt
         from emp e
        group by empno, ename, job, mgr, hiredate, sal, comm, deptno
       ) e
 where not exists (
       select null
         from (
              select v.empno, v.ename, v.job, v.mgr, v.hiredate,
                     v.sal, v.comm, v.deptno, count(*) as cnt
                from v
               group by empno, ename, job, mgr, hiredate, sal, comm, deptno
              ) v
        where v.empno   = e.empno   and v.ename = e.ename
          and v.job     = e.job     and v.hiredate = e.hiredate
          and v.sal     = e.sal     and v.deptno = e.deptno
          and v.cnt     = e.cnt
          and coalesce(v.mgr, 0)  = coalesce(e.mgr, 0)
          and coalesce(v.comm, 0) = coalesce(e.comm, 0)
       )
union all
select *
  from (
       select v.empno, v.ename, v.job, v.mgr, v.hiredate,
              v.sal, v.comm, v.deptno, count(*) as cnt
         from v
        group by empno, ename, job, mgr, hiredate, sal, comm, deptno
       ) v
 where not exists (
       select null
         from (
              select e.empno, e.ename, e.job, e.mgr, e.hiredate,
                     e.sal, e.comm, e.deptno, count(*) as cnt
                from emp e
               group by empno, ename, job, mgr, hiredate, sal, comm, deptno
              ) e
        where e.empno   = v.empno   and e.ename = v.ename
          and e.job     = v.job     and e.hiredate = v.hiredate
          and e.sal     = v.sal     and e.deptno = v.deptno
          and e.cnt     = v.cnt
          and coalesce(e.mgr, 0)  = coalesce(v.mgr, 0)
          and coalesce(e.comm, 0) = coalesce(v.comm, 0)
       )
```

`COALESCE` is required on `mgr` and `comm` specifically because those columns
are nullable in `emp`, and SQL's three-valued logic makes `NULL = NULL`
unknown (never true) in a plain equality predicate — without it, two rows
that are genuinely identical, both with a `NULL` commission, would never
match and would show up as a false difference.

### Book vs. today: EXCEPT/MINUS coverage has widened since 2020

Three things have moved since this recipe was written:

- **MySQL added native `EXCEPT`/`INTERSECT` in 8.0.31 (October 2022).** The
  correlated-`NOT EXISTS` fallback the book prescribes for MySQL was the only
  option in 2020; today MySQL 8.0.31+ can run the exact same `EXCEPT` +
  `GROUP BY`/`COUNT(*)` pattern shown above for PostgreSQL, and both
  `INTERSECT`/`EXCEPT` support a `DISTINCT`/`ALL` modifier (default
  `DISTINCT`), same as `UNION`.
- **SQL Server has actually had native `EXCEPT`/`INTERSECT` since SQL Server
  2005** — well before this book's 2020 2nd edition. Grouping SQL Server with
  MySQL under "needs the correlated-subquery workaround" was already
  avoidable at the time of writing; on SQL Server the `EXCEPT`-based query
  (recipe's PostgreSQL/DB2 solution) works as-is, no `NOT EXISTS` needed.
- **Oracle 21c added `MINUS ALL` (and `EXCEPT ALL`/`INTERSECT ALL`** as
  synonyms), letting `MINUS` compare rows as a true multiset directly. On
  Oracle 21c+ and on PostgreSQL (which has supported `EXCEPT ALL` for a long
  time), the manual `GROUP BY ... COUNT(*) as cnt` bookkeeping in the recipe
  above is no longer strictly necessary — `MINUS ALL`/`EXCEPT ALL` already
  treats a duplicated row as a difference in its own right:

  ```sql
  -- Oracle 21c+ / PostgreSQL: cardinality-aware diff without manual COUNT(*)
  (select * from v minus all select * from emp)
  union all
  (select * from emp minus all select * from v)
  ```

  The book's `GROUP BY`/`COUNT(*)` approach still works everywhere and is
  worth knowing regardless, since it's the only option on engines without an
  `ALL` variant of the set-difference operator.

## Trade-offs

- **A `UNION`-based row-count check is a cheap pre-filter, not a proof of
  equality.** It can only disprove sameness (different counts came back); two
  tables with the same count can still hold completely different rows, so it
  is a fast early exit, not a substitute for the full comparison.
- **The recipe's grouping of "MySQL and SQL Server" together was already an
  oversimplification in 2020, not just something time changed.** SQL Server
  has supported `EXCEPT`/`INTERSECT` natively since 2005; only MySQL actually
  needed the correlated-subquery fallback, and only until version 8.0.31
  (2022).
- **The manual `GROUP BY ... COUNT(*) as cnt` step exists purely to make
  `EXCEPT`/`MINUS` (which discard duplicates by default) cardinality-aware.**
  Where an `ALL` variant is available (`EXCEPT ALL` on PostgreSQL, `MINUS ALL`
  on Oracle 21c+), it's redundant — the operator itself already treats input
  as a multiset:
  ```sql
  -- functionally equivalent to the GROUP BY/COUNT(*) version above, on
  -- engines with an ALL variant
  select * from v except all select * from emp;
  ```
- **`COALESCE` on nullable columns is easy to forget and fails silently, not
  loudly** — a mismatched query still runs and returns a result, it just
  quietly treats two rows that only differ in a `NULL` vs `NULL` column as
  different, inflating the diff with false positives instead of raising an
  error.
- **The correlated `NOT EXISTS` fallback is O(n²)-shaped without a supporting
  index** on the full join-key column list, since every outer row re-scans
  the inner derived table; on the engines that still need this form (or on
  any engine, for very large tables) it's worth checking `EXPLAIN` output
  before assuming it scales the same way `EXCEPT`/`MINUS` does.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.7, p. 44-50 — doc
- [MySQL Reference Manual — Set Operations with UNION, INTERSECT, and EXCEPT](https://dev.mysql.com/doc/refman/8.0/en/set-operations.html) — doc
- [Microsoft Learn — EXCEPT and INTERSECT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-except-and-intersect-transact-sql) — doc
- [PostgreSQL Documentation — 7.4. Combining Queries (UNION, INTERSECT, EXCEPT)](https://www.postgresql.org/docs/current/queries-union.html) — doc
- [Oracle Database SQL Language Reference — The UNION [ALL], INTERSECT, MINUS Operators](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/The-UNION-ALL-INTERSECT-MINUS-Operators.html) — doc
