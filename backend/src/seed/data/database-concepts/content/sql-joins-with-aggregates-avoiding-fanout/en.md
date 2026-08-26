---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

Joining two tables before aggregating can silently multiply the rows being summed
or counted — not because the join is wrong, but because a one-to-many relationship
(one employee, several bonus records) makes each "one" row appear once per matching
"many" row. The join itself is correct; the aggregate computed on top of it is not,
because it's summing a value that got duplicated as a side effect of the join,
without any error or warning that this happened.

## Use Cases

- Computing a total (salary, revenue, order amount) from a table that also needs
  to be joined to a second table for a *different* aggregate (bonuses, line items,
  tags) — a case where one side of the join has multiple matching rows per key.
- Auditing an existing report or dashboard query that returns a suspiciously large
  total when compared against a direct, single-table sum of the same column.
- Choosing between fixing the duplication with `DISTINCT`, restructuring the query
  to aggregate before joining, or reaching for a window function, based on which
  database is in use and how large the tables are.

## Deep Dive

### The problem: a one-to-many join duplicates rows before the aggregate runs

`EMP_BONUS` can hold more than one bonus row per employee — `MILLER` (empno 7934)
has two:

```sql
select * from emp_bonus;

EMPNO RECEIVED          TYPE
----- ----------- ----------
 7934 17-MAR-2005          1
 7934 15-FEB-2005          2
 7839 15-FEB-2005          3
 7782 15-FEB-2005          1
```

Joining `EMP` to `EMP_BONUS` to compute each employee's bonus amount is correct on
its own — each row now shows one (employee, bonus) pairing:

```sql
select e.ename, e.sal
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10;

ENAME             SAL
---------- ----------
CLARK            2450
KING             5000
MILLER           1300
MILLER           1300
```

`MILLER` now appears twice — once per bonus row — and with it, `MILLER`'s salary
appears twice too. Wrapping this in a naive `SUM`:

```sql
select deptno,
       sum(sal) as total_sal,
       sum(bonus) as total_bonus
  from ( /* the join above, with a bonus column added */ ) x
 group by deptno;

DEPTNO   TOTAL_SAL         TOTAL_BONUS
------ -----------         -----------
    10       10050                2135
```

`TOTAL_BONUS` (2135) is correct — each bonus really is a distinct amount that
should be summed once. `TOTAL_SAL` (10050) is wrong: the real sum of department
10's salaries is 8750, confirmed directly against `EMP` with no join at all:

```sql
select sum(sal) from emp where deptno = 10;
-- 8750
```

`MILLER`'s 1300 salary got counted twice, once per bonus row, inflating the total
by exactly `MILLER`'s salary.

### Fix 1: SUM(DISTINCT ...) — works everywhere

The most direct fix: since the duplication is *exact* (the same salary value
repeated per bonus row), summing only the distinct values undoes it:

```sql
select deptno,
       sum(distinct sal) as total_sal,
       sum(bonus) as total_bonus
  from (
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3
               end as bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10
       ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750        2135
```

`sum(bonus)` stays a plain (non-distinct) sum, because each bonus amount is
already unique per row — only `sal`, the column duplicated by the join, needs
`DISTINCT`. This works on every mainstream engine, but only as long as two
distinct employees never legitimately share the exact same salary value within
the same group — a coincidence that would make `SUM(DISTINCT ...)` silently drop
one of them.

### Fix 2: pre-aggregate before the join

The more robust fix restructures the query so the vulnerable `SUM(sal)` runs
*before* the join ever introduces duplicates — compute department 10's total
salary once, directly from `EMP`, then join that single pre-computed row to
`EMP`/`EMP_BONUS` for the bonus total:

```sql
select d.deptno,
       d.total_sal,
       sum(e.sal * case when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) as total_bonus
  from emp e,
       emp_bonus eb,
       (
select deptno, sum(sal) as total_sal
  from emp
 where deptno = 10
 group by deptno
       ) d
 where e.deptno = d.deptno
   and e.empno = eb.empno
 group by d.deptno, d.total_sal;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750        2135
```

This works on every DBMS and, unlike `SUM(DISTINCT ...)`, doesn't depend on the
duplicated values happening to be distinguishable from genuinely-different rows
that share the same value — the salary total is correct by construction, because
it was never joined against `EMP_BONUS` in the first place.

### Fix 3: window functions (DB2, Oracle, SQL Server)

These three platforms support both fixes above, plus a third: computing each sum
as a window function partitioned by department, directly against the joined rows,
then collapsing the duplicates with an outer `DISTINCT`:

```sql
select distinct deptno, total_sal, total_bonus
  from (
select e.empno, e.ename,
       sum(distinct e.sal) over
           (partition by e.deptno) as total_sal,
       e.deptno,
       sum(e.sal * case when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) over
           (partition by deptno) as total_bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10
       ) x;
```

Each `SUM ... OVER (PARTITION BY deptno)` computes its total across the whole
department-10 partition, attaching the same total to every row in that partition
(so `MILLER`'s two rows both show `total_sal = 8750`, `total_bonus = 2135`); the
outer `SELECT DISTINCT` then collapses the repeated per-row totals down to one row
per department.

## Trade-offs

- **`SUM(DISTINCT ...)` is the least invasive fix, but it's a coincidence-dependent
  one.** It happens to work here because the duplication is exact — the same
  salary value repeated by the join. If two different employees in the same group
  genuinely earned the identical salary, `SUM(DISTINCT sal)` would only count that
  salary once for *both* of them, silently under-counting the total. Reach for it
  when the duplicated column's values are effectively unique per row in the
  group; don't reach for it as a default habit.
- **Pre-aggregating before the join is more code, but it's correct regardless of
  coincidental value collisions**, and it's also frequently faster: the database
  computes the salary sum from a small pre-aggregated row set instead of first
  materializing every (employee × bonus) pairing and discarding duplicates
  afterward. For anything beyond a quick one-off query, this is the fix that
  scales and stays correct.
- **The window-function form is DB2/Oracle/SQL Server-only, not a portable
  choice.** Both PostgreSQL and MySQL support window functions broadly (have
  for years), but neither supports `DISTINCT` inside a window aggregate function
  — `SUM(DISTINCT col) OVER (...)` — so this specific form of the recipe's third
  solution has no equivalent on those two engines; the `DISTINCT`-in-subquery or
  pre-aggregate-before-join fixes are the only portable options there.
- **Book vs. today: this vendor split is still accurate, not something that
  changed.** PostgreSQL's own mailing list has an open, never-merged patch
  proposal (from 2020) to add `DISTINCT` support inside window aggregate
  functions; MySQL's current reference manual likewise still documents
  `DISTINCT` as unsupported inside window functions. Confirmed via both
  projects' current documentation/mailing-list record — this is a case of "still
  true today," not a stale claim to correct.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.9, p. 52-56 — doc
- [PostgreSQL Documentation — Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html) — doc
- [MySQL Reference Manual — Window Function Concepts and Syntax](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html) — doc
- [Microsoft Learn — OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) — doc
