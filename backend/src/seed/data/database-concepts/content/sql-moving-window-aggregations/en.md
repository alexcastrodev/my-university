---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Two window-aggregation patterns sit one step past the basics covered in
[Running Totals, Running Products, and Moving Aggregates](sql-running-totals-and-moving-aggregates):
computing several *different* partition-level aggregates side by side in a
single query — each row carrying its own value, its group's total, its
parent group's total, and the grand total as separate columns — and moving
windows whose frame is not a simple trailing "last N rows," but a symmetric
window that reaches forward as well as backward, or a frame measured in
*values* (90 days, 10 dollars) rather than in row counts. The first pattern
is about stacking independent `OVER` clauses; the second is about what
`ROWS`, `RANGE`, and `GROUPS` actually mean once the frame stops being
`UNBOUNDED PRECEDING AND CURRENT ROW`.

## Use Cases

- A report where every detail row shows its own value next to the department
  total, the job-family total, and the company-wide total — three different
  grouping dimensions on one line, with no self-joins.
- Ratio-to-total and share-of-parent columns (`sal / sum(sal) over (partition
  by deptno)`) where the denominator changes per column but the detail rows
  must survive.
- A 7-day *centered* moving average that looks three days back and three days
  forward, rather than the trailing average that lags the trend it is meant
  to describe.
- Smoothing a noisy time series with a wide symmetric window — a 15-point or
  31-point mean over sensor readings, latency samples, or daily conversions —
  where trailing windows would shift every feature to the right.
- Spend-in-the-last-90-days or transactions-within-±1-hour reporting, where
  the window is a span of time and the series has gaps and duplicate
  timestamps, so counting rows gives the wrong answer.

## Deep Dive

### Several partition definitions in one SELECT

Each `OVER` clause in a select list is independent. Nothing forces them to
share a `PARTITION BY`, so a single pass over `emp` can answer three
different grouping questions at once:

```sql
select ename,
       deptno,
       count(*) over (partition by deptno) as deptno_cnt,
       job,
       count(*) over (partition by job)    as job_cnt,
       count(*) over ()                    as total
  from emp;
```

```
ENAME  DEPTNO DEPTNO_CNT JOB        JOB_CNT  TOTAL
------ ------ ---------- --------- -------- ------
MILLER     10          3 CLERK            4     14
CLARK      10          3 MANAGER          3     14
KING       10          3 PRESIDENT        1     14
SCOTT      20          5 ANALYST          2     14
JAMES      30          6 CLERK            4     14
```

`count(*) over ()` — empty parentheses — means "the whole result set,"
a single partition containing every row. This query runs unchanged on
PostgreSQL, MySQL 8.0+, and SQL Server 2012+; multiple `OVER` clauses with
differing partition keys have never been the portability problem in this
recipe.

The load-bearing detail is **when** the window functions run: after `WHERE`,
`GROUP BY`, and `HAVING`, on whatever rows survive. Add a filter and `TOTAL`
stops being the table's row count:

```sql
select ename, count(*) over () as total
  from emp
 where deptno <> 10;   -- total is now 11, not 14
```

The same ordering rule bites from the other direction: a window function's
result cannot be referenced in `WHERE`, because it does not exist yet. The
fix on all three engines is to push the window into an inline view or CTE
and filter outside it — none of PostgreSQL, MySQL, or SQL Server has the
`QUALIFY` clause that some analytics engines offer for exactly this:

```sql
-- won't parse: deptno_cnt doesn't exist at WHERE time
select ename, count(*) over (partition by deptno) as deptno_cnt
  from emp
 where count(*) over (partition by deptno) > 3;

-- the portable form
with counted as (
  select ename, deptno,
         count(*) over (partition by deptno) as deptno_cnt
    from emp
)
select * from counted where deptno_cnt > 3;
```

When the same specification is repeated across several columns, the `WINDOW`
clause names it once. PostgreSQL has had it for years, MySQL since 8.0, and
SQL Server since **2022 (16.x)** — and only at database compatibility level
160 or higher, which is the one deployment caveat worth remembering:

```sql
select ename, deptno, job,
       count(*) over d as deptno_cnt,
       sum(sal)  over d as deptno_sal,
       count(*) over j as job_cnt,
       count(*) over () as total
  from emp
window d as (partition by deptno),
       j as (partition by job);
```

This is deliberately *not* `GROUP BY ... WITH ROLLUP` or `GROUPING SETS`.
Those produce extra summary rows and collapse the detail; the window form
keeps every detail row and hangs the aggregates off it as columns. Choose by
output shape: rollup for a report with subtotal lines, windows for a report
where each line needs its own context.

### Frames that look forward, and frames measured in values

The sibling concept covers `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` — a
trailing window. Two extensions matter.

**Symmetric frames.** A frame end may be `n FOLLOWING`, which makes a
centered moving average a one-line change:

```sql
-- 7-day centered mean: 3 back, current, 3 forward
select date1, sales,
       avg(sales) over (order by date1
                        rows between 3 preceding and 3 following) as centered_avg
  from sales;
```

This is standard `ROWS` framing and works identically on PostgreSQL, MySQL
8.0+, and SQL Server 2012+ — Microsoft's own `OVER` documentation uses
`ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING` as its canonical example. The
frame may even sit entirely on one side of the current row (`ROWS BETWEEN 7
PRECEDING AND 4 PRECEDING`); the only structural rules are that the start
cannot be `UNBOUNDED FOLLOWING`, the end cannot be `UNBOUNDED PRECEDING`,
and the end may not precede the start in the option list.

At the series edges the frame is *partial*, not `NULL`: the first row of the
example above averages four values (itself plus three ahead), not seven. If
a full window is required, gate on the frame's own row count:

```sql
select date1, sales,
       case when count(*) over w = 7 then avg(sales) over w end as centered_avg
  from sales
window w as (order by date1 rows between 3 preceding and 3 following);
```

**Value-bounded frames.** The book's spending-pattern recipe asks for the sum
of salaries of everyone hired within the previous 90 *days* — a span of time,
not a count of rows. That is `RANGE` with an offset, and it is where the
book's vendor matrix has aged:

```sql
-- PostgreSQL 11+
select hiredate, sal,
       sum(sal) over (order by hiredate
                      range between interval '90 days' preceding
                                and current row) as spending_pattern
  from emp;
```

```sql
-- MySQL 8.0+
select hiredate, sal,
       sum(sal) over (order by hiredate
                      range between interval 90 day preceding
                                and current row) as spending_pattern
  from emp;
```

The book routes **PostgreSQL** to a scalar subquery here, on the grounds that
it had no offset `RANGE`. That was already stale in print: PostgreSQL **11**
(October 2018) implemented the full SQL:2011 frame syntax — offset `RANGE`,
the `GROUPS` frame mode, and `EXCLUDE` — roughly two years before the second
edition shipped. Any PostgreSQL in support today has it.

**SQL Server** is the one where the book's advice still stands, and not by
accident. T-SQL's documented limitation is unambiguous, and still present in
the SQL Server 2025 documentation: *"You can't use `RANGE` with `<unsigned
value specification> PRECEDING` or `<unsigned value specification>
FOLLOWING`."* `RANGE` on SQL Server accepts only `UNBOUNDED PRECEDING`,
`CURRENT ROW`, and `UNBOUNDED FOLLOWING`. So a 90-day window needs the
correlated subquery (or the equivalent self-join) the book gives:

```sql
-- SQL Server: no offset RANGE, so the frame moves into a predicate
select e.hiredate,
       e.sal,
       (select sum(d.sal)
          from emp d
         where d.hiredate between dateadd(day, -90, e.hiredate)
                              and e.hiredate) as spending_pattern
  from emp e
 order by 1;
```

Substituting `ROWS BETWEEN 90 PRECEDING AND CURRENT ROW` is not a fix — it
means "the last 90 rows," which for a hire-date series with gaps and
duplicate dates is a different question with a different answer. `RANGE`
also treats peers as one unit: the two employees hired on 03-DEC-2011 both
report the same 11700, because `CURRENT ROW` in `RANGE` mode means "all rows
sharing my ordering value."

The third frame mode, `GROUPS`, counts *peer groups* rather than rows or
values — "this row's peer group plus the two before it," which is the right
tool for "three distinct dates back" over a series with several rows per
date. PostgreSQL supports it; MySQL 8.4 and SQL Server 2025 still do not,
and there is no short rewrite — emulating it means `dense_rank()` in a
subquery and then a `ROWS`- or `RANGE`-framed window over that rank.

## Trade-offs

- **Every distinct window specification is potentially its own sort.** Window
  functions sharing an identical `PARTITION BY`/`ORDER BY` are guaranteed to
  see the same row ordering and are computed in one pass; specifications that
  differ may each require an additional sort step. A select list with
  `partition by deptno`, `partition by job`, and `over ()` is convenient but
  is not free — it is three window definitions, and the plan will show it.
  An index whose leading columns match `PARTITION BY` then `ORDER BY` removes
  one of those sorts, never all of them.
- **Window functions run after `WHERE`, which changes the "grand total" and
  blocks filtering on the result.** `count(*) over ()` counts the rows that
  survived the predicates, not the rows in the table — a report filtered to
  one region silently reports that region's count as the company total. And
  because the value does not exist at `WHERE` time, filtering on it requires
  a CTE or inline view on all three engines; there is no `QUALIFY` in
  PostgreSQL, MySQL, or SQL Server to shorten it.
- **`RANGE` with an offset is portable across PostgreSQL and MySQL but flatly
  unavailable on SQL Server.** This is a genuine, current T-SQL limitation
  rather than a book-era artifact: offset `PRECEDING`/`FOLLOWING` is valid
  only with `ROWS`, so any time-span window on SQL Server falls back to a
  correlated subquery or self-join — a per-row scan where the other two
  engines do a single ordered pass.
- **Symmetric frames leak the future, which is a correctness question, not a
  style one.** A centered moving average at day *t* is computed from days
  *t+1*..*t+3*, so it cannot be produced in real time, and using it as a
  feature in a forecasting model is lookahead bias in its purest form. It is
  the right choice for retrospective charts and the wrong choice for anything
  that will later be evaluated against data it has already seen.
- **Partial frames at the edges are quiet, not loud.** A `ROWS BETWEEN 3
  PRECEDING AND 3 FOLLOWING` average returns a value on the very first row —
  averaged over four points instead of seven — so the head and tail of a
  smoothed series are systematically noisier than the middle without anything
  marking them. Gating on `count(*) over w` makes the incomplete windows
  `NULL` and explicit.
- **`ROWS`, `RANGE`, and `GROUPS` answer three different questions and only
  one of them is about row counts.** On a series with gaps or duplicate
  ordering values the three give different results, and the mistake is silent
  on PostgreSQL and MySQL, where all three parse. Ask which unit the business
  question is in — rows, values, or distinct values — before writing the
  frame, because the query will run either way.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 12, "Reporting and Reshaping", recipes 12.18, 12.19, p. 420-429 — doc
- [PostgreSQL Documentation — Window Function Calls (frame_clause: ROWS, RANGE, GROUPS, EXCLUDE)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS) — doc
- [MySQL Reference Manual — Window Function Frame Specification](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html) — doc
- [Microsoft Learn — OVER Clause (Transact-SQL): ROWS or RANGE and its limitations](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) — doc
- [Microsoft Learn — WINDOW clause (Transact-SQL), SQL Server 2022+](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-window-transact-sql) — doc
