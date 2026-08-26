---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

Recipe 3.9 covers a join that duplicates a summed value when the joined table has
*more than one* matching row. This recipe covers the opposite shape of the same
underlying fan-out problem: an inner join that **drops** rows entirely, because
the joined table has **no** matching row at all for some keys. Summing salaries
after inner-joining employees to their bonuses silently excludes every employee
who never received a bonus — not because the sum is wrong about the rows it saw,
but because it never saw the missing rows in the first place.

## Use Cases

- Computing a department- or company-wide total (salaries, revenue, order value)
  that must include every row from the primary table, even when a second,
  joined table (bonuses, discounts, referrals) has no matching row for some of
  them.
- Auditing a report where a "total" looks suspiciously *low* compared to a
  direct sum of the primary table alone — the outer-join counterpart to recipe
  3.9's suspiciously *high* total.
- Choosing between an outer join with a NULL-aware `CASE` and a pre-aggregate
  restructuring, depending on whether the query needs to stay portable across
  DB2/MySQL/PostgreSQL/SQL Server or can rely on window functions.

## Deep Dive

### The problem: an inner join silently drops unmatched rows

Where recipe 3.9's `EMP_BONUS` had two bonus rows for the same employee
(`MILLER`), this recipe's version only has bonus rows for `MILLER` at all —
every other employee in department 10 has none:

```sql
select * from emp_bonus;

EMPNO RECEIVED          TYPE
----- ----------- ----------
 7934 17-MAR-2005          1
 7934 15-FEB-2005          2
```

An inner join between `EMP` and `EMP_BONUS` only returns rows for employees
who actually appear in `EMP_BONUS` — which here means only `MILLER`:

```sql
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3 end as bonus
  from emp e, emp_bonus eb
 where e.empno = eb.empno
   and e.deptno = 10;

EMPNO ENAME             SAL     DEPTNO      BONUS
----- ---------- ---------- ---------- ----------
 7934 MILLER           1300         10        130
 7934 MILLER           1300         10        260
```

Summing `sal` over this result only sums `MILLER`'s salary — twice, for the
same reason as recipe 3.9 — while `CLARK` and `KING`, who have no bonus rows
at all, never appear in the joined result and contribute nothing to the sum:

```sql
select deptno,
       sum(sal) as total_sal,
       sum(bonus) as total_bonus
  from ( /* the join above */ ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      2600         390
```

The target result — every department-10 employee's salary counted exactly
once, and the correct total bonus — is `TOTAL_SAL = 8750`, not `2600`.

### Fix 1: outer join + NULL-aware CASE, then SUM(DISTINCT ...)

Switching the inner join to a `LEFT OUTER JOIN` keeps every `EMP` row
regardless of whether `EMP_BONUS` has a match; the `CASE` expression then
needs one more branch to handle the resulting `NULL` on `eb.type`:

```sql
select deptno,
       sum(distinct sal) as total_sal,
       sum(bonus) as total_bonus
  from (
select e.empno, e.ename, e.sal, e.deptno,
       e.sal * case when eb.type is null then 0
                    when eb.type = 1 then .1
                    when eb.type = 2 then .2
                    else .3 end as bonus
  from emp e left outer join emp_bonus eb
    on (e.empno = eb.empno)
 where e.deptno = 10
       ) x
 group by deptno;

DEPTNO TOTAL_SAL TOTAL_BONUS
------ --------- -----------
    10      8750         390
```

The new `when eb.type is null then 0` branch is the entire difference from
recipe 3.9's `CASE` expression: an employee with no bonus contributes `0` to
`total_bonus`, which has no effect on the sum, instead of disappearing from
the result set the way an inner join would drop them. `SUM(DISTINCT sal)`
still does the same job as in recipe 3.9 — undoing the duplication for
`MILLER`'s two bonus rows.

### Fix 2: the same window-function form, extended with the NULL branch

DB2, MySQL, PostgreSQL, and SQL Server all accept the equivalent window-
function rewrite, again just adding the `is null` branch to the existing
`CASE`:

```sql
select distinct deptno, total_sal, total_bonus
  from (
select e.empno, e.ename,
       sum(distinct e.sal) over
           (partition by e.deptno) as total_sal,
       e.deptno,
       sum(e.sal * case when eb.type is null then 0
                        when eb.type = 1 then .1
                        when eb.type = 2 then .2
                        else .3 end) over
           (partition by deptno) as total_bonus
  from emp e left outer join emp_bonus eb
    on (e.empno = eb.empno)
 where e.deptno = 10
       ) x;
```

### Fix 3: pre-aggregate before the join, no outer join needed

The alternative from recipe 3.9 — compute the salary sum first, from `EMP`
alone, before any join happens — sidesteps the missing-row problem
entirely, because the salary total was never joined against `EMP_BONUS` in
the first place:

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
    10      8750         390
```

Because `total_bonus` here is still computed from an *inner* join between
`emp`/`emp_bonus`, this form only sums bonuses for employees who actually
have one — which is correct, since an employee with no bonus should
contribute nothing to `total_bonus` either way. No `is null`/`CASE`
adjustment is needed on this path at all, and this query runs unmodified on
every mainstream DBMS.

## Trade-offs

- **The fix for this recipe is a strict superset of recipe 3.9's fix, not a
  different technique.** Switching `INNER JOIN`/comma-join to
  `LEFT OUTER JOIN` and adding one `WHEN ... IS NULL THEN 0` branch to an
  existing `CASE` expression is the entire delta — the `SUM(DISTINCT ...)`
  and window-function mechanics are identical to the prior recipe.
- **Forgetting the `IS NULL` branch after switching to an outer join is a
  realistic, silent mistake.** An outer join alone reintroduces the missing
  rows with `NULL` in the joined columns — but a `CASE` expression written
  for the inner-join case (recipe 3.9's version, with no `IS NULL` branch)
  falls through to whatever the final `ELSE` happens to compute for a `NULL`
  `eb.type`, producing a wrong, non-obviously-wrong bonus value instead of
  an error.
- **Pre-aggregating before the join is, again, the option least dependent on
  the shape of the join.** It doesn't need an outer join, a `DISTINCT`, or a
  `NULL`-handling branch at all for the salary side — it's the same
  advantage recipe 3.9 already highlighted, just more pronounced here
  because the outer-join fix genuinely requires editing the `CASE`
  expression, where pre-aggregating requires no edit to the bonus-side logic.
- **Book vs. today: the window-function `DISTINCT` support gap is unchanged,
  still confirmed current.** As with recipe 3.9, neither PostgreSQL nor
  MySQL supports `DISTINCT` inside a window aggregate function
  (`SUM(DISTINCT col) OVER (...)`) — PostgreSQL has an unmerged, in-progress
  patch series (last active discussion in the PostgreSQL hackers mailing
  list, still open as of 2026) to add this, and MySQL's current reference
  manual continues to document it as unsupported. This is the same
  DB2/Oracle/SQL Server-only caveat already noted for recipe 3.9's window
  function, applying identically here — not a new finding, a confirmation
  that nothing changed between the two recipes' research.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.10, p. 57-59 — doc
- [PostgreSQL Documentation — Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html) — doc
- [PostgreSQL mailing list — DISTINCT support inside window aggregate functions (WIP patch, still unmerged)](https://www.postgresql.org/message-id/CAN1Pwonf4waD+PWkEFK8ANLua8fPjZ4DmV+hixO62+LiR8gwaA@mail.gmail.com) — doc
- [MySQL Reference Manual — Window Function Concepts and Syntax](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html) — doc
