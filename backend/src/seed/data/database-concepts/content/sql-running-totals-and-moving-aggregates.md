---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A whole family of numeric-reporting problems reduces to the same sentence:
"walk an ordered series and accumulate as you go." A running total accumulates
by addition, a running product by multiplication, a moving average accumulates
over a *sliding* window instead of an ever-growing one, and a resettable
balance accumulates until some condition tells it to start over. All four are
the same window-function shape — `<aggregate>() OVER (PARTITION BY ... ORDER BY
... <frame>)` — with a different aggregate, a different frame, or a different
partition key. Learn the shape once and the four recipes stop being four
recipes.

## Use Cases

- Cumulative revenue-to-date, headcount-to-date, or inventory-position
  reporting, where each row must show the total *through* that row rather than
  the grand total.
- Compound growth over an ordered series — cumulative return on a chain of
  daily growth factors, or cumulative defect-survival probability across
  process stages — where the accumulator multiplies instead of adds.
- Smoothing a noisy daily metric (sales, error rate, latency) with a moving
  average so a trend is visible through day-of-week and collection-artifact
  volatility.
- A running total that resets per fiscal period, per customer, or per
  contract — an account balance that restarts each statement cycle, or a
  cumulative usage counter that zeroes at each billing boundary.
- A running total whose *sign* depends on another column: a credit-card
  balance where purchases add and payments subtract.

## Deep Dive

### 7.6 — Running total: `SUM() OVER (ORDER BY ...)`

The second edition of the book leads with the window-function form directly,
and there is nothing left to modernize about it. This runs unchanged on
PostgreSQL, MySQL 8.0+, and SQL Server 2012+:

```sql
select ename, sal,
       sum(sal) over (order by sal, empno) as running_total
  from emp
 order by sal;
```

The detail worth internalizing is *why* `empno` is in the `ORDER BY`. With
`order by sal` alone, rows that tie on `sal` are **peers**, and the default
frame for an ordered window is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT
ROW` — which, in `RANGE` mode, includes every peer of the current row. Tied
salaries therefore get summed together and both tied rows show the same,
jumped-ahead total:

```sql
select empno, sal,
       sum(sal) over (order by sal, empno) as running_total1,  -- correct
       sum(sal) over (order by sal)        as running_total2   -- peers collapse
  from emp
 order by sal;
```

`WARD` and `MARTIN` both earn 1250; in `running_total2` they both read 5350
instead of 4100 and 5350. Two fixes exist, and they are not equivalent:

```sql
-- fix A (the book's): make the ORDER BY unique, so no two rows are peers
sum(sal) over (order by sal, empno)

-- fix B: keep the ordering, change the frame to physical rows
sum(sal) over (order by sal rows between unbounded preceding and current row)
```

Fix A is the one to prefer, because it also makes the *output order*
deterministic. Fix B produces a strictly-increasing total but leaves which tied
row comes first up to the engine, so the same query can hand back different
per-row values on different runs.

### 7.7 — Running product: the aggregate that doesn't exist

There is no `PRODUCT()` window aggregate in PostgreSQL, MySQL, or SQL Server —
not in 2020 when the book was written, and not today. The standard trick is to
move the problem into log space, where multiplication becomes addition, run the
`SUM` window there, and exponentiate back:

```sql
-- PostgreSQL / MySQL
select empno, ename, sal,
       exp(sum(ln(sal)) over (order by sal, empno)) as running_prod
  from emp
 where deptno = 10;
```

```sql
-- SQL Server: no LN function; LOG(x) with one argument IS the natural log
select empno, ename, sal,
       exp(sum(log(sal)) over (order by sal, empno)) as running_prod
  from emp
 where deptno = 10;
```

This works because `x * y = exp(ln(x) + ln(y))`, and it inherits every
property of the running total from recipe 7.6 — same `ORDER BY` tiebreaker
rule, same frame defaults.

It also inherits `ln`'s domain: **the logarithm of zero or a negative number is
undefined**, and each engine reacts differently to it. PostgreSQL raises
`ERROR: cannot take logarithm of zero` (or `of a negative number`) and the
query dies. SQL Server raises a domain error. MySQL is the dangerous one —
`LN(0)` and `LN(-2)` return `NULL` with only a warning, which propagates
through the `SUM` and turns every subsequent row of the running product into
`NULL` without anything looking like a failure.

If the series can contain zeros but no negatives, the documented workaround is
to shift the input, since `ln(1) = 0` is the multiplicative identity in log
space:

```sql
select exp(sum(ln(sal + 1)) over (order by sal, empno)) as shifted_prod
  from emp;
```

Note that this changes the answer — it is a product of `x+1`, not of `x` — so
it is only valid when the shift is part of the domain model (growth factors,
survival rates), not a numeric patch. If the series genuinely contains
negatives, log space is off the table; handle the sign separately (track the
parity of the negative count and take `abs()` inside the `ln`) or fall back to
a recursive CTE that multiplies row by row:

```sql
with recursive rp (empno, sal, rn, running_prod) as (
  select empno, sal, rn, sal
    from (select empno, sal, row_number() over (order by sal, empno) as rn
            from emp where deptno = 10) t
   where rn = 1
  union all
  select t.empno, t.sal, t.rn, rp.running_prod * t.sal
    from (select empno, sal, row_number() over (order by sal, empno) as rn
            from emp where deptno = 10) t
    join rp on t.rn = rp.rn + 1
)
select empno, sal, running_prod from rp order by rn;
```

The recursive form is correct for zeros and negatives, and considerably slower
— it forces row-at-a-time evaluation where `exp(sum(ln(...)))` is a single
window pass. SQL Server uses the same query with `with` instead of
`with recursive`.

### 7.8 — Smoothing: a sliding frame, not a chain of `LAG`s

The book builds its three-point moving average out of `LAG` calls added
together and divided by three:

```sql
-- the book's form
select date1, sales,
       (sales
        + lag(sales, 1) over (order by date1)
        + lag(sales, 2) over (order by date1)) / 3 as moving_average
  from sales;
```

This works, and its weighted variant (multiply each lag by a coefficient,
divide by the sum of coefficients) is genuinely the reason to reach for `LAG`.
But for an *unweighted* moving average it is the long way around, and the book
itself nods at the alternative — "you can also use a partition with average."
That alternative is an explicit `ROWS` frame, supported identically on
PostgreSQL, MySQL 8.0+, and SQL Server 2012+:

```sql
select date1, sales,
       avg(sales) over (order by date1
                        rows between 2 preceding and current row) as moving_average
  from sales;
```

Three differences matter. First, widening the window from three points to
seven is a one-character edit (`6 preceding`) instead of adding four more `LAG`
terms. Second, the `LAG` form returns `NULL` for the first two rows, because
`NULL + 647 + 561` is `NULL`; the `AVG` frame form averages whatever rows exist
in the frame, so row 1 returns 647 and row 2 returns 604 — a partial window
rather than a hole. Neither is "right," but they are different answers and the
choice should be deliberate. If a strict `NULL` until the window is full is
what you want, say so:

```sql
select date1, sales,
       case when count(*) over (order by date1 rows between 2 preceding and current row) = 3
            then avg(sales) over (order by date1 rows between 2 preceding and current row)
       end as moving_average
  from sales;
```

Third — and this is the recurring footgun — writing `rows` here is mandatory,
not stylistic. `range between 2 preceding and current row` means something
entirely different (a two-*unit* value window over `date1`), and on SQL Server
it does not even parse: T-SQL permits numeric offsets with `ROWS` only, never
with `RANGE`. PostgreSQL and MySQL both accept offset `RANGE` frames, which
makes an accidental `RANGE` a silently-wrong result there rather than a syntax
error.

### 7.15 — Changing values inside a running total

The book's version of "modify the running total based on another column" puts a
`CASE` expression *inside* the aggregate, so the sign of each contribution is
decided per row before it ever reaches the `SUM`. Given a view `V` of credit
card transactions where `trx` is `'PR'` (purchase) or `'PY'` (payment):

```sql
select case when trx = 'PY' then 'PAYMENT' else 'PURCHASE' end as trx_type,
       amt,
       sum(case when trx = 'PY' then -amt else amt end)
         over (order by id, amt) as balance
  from V;
```

```
TRX_TYPE     AMT   BALANCE
PURCHASE     100       100
PURCHASE     100       200
PAYMENT       50       150
PURCHASE     100       250
PAYMENT      200        50
PAYMENT       50         0
```

Nothing about the window changed — it is still recipe 7.6's `SUM() OVER (ORDER
BY ...)`. Only the *expression being accumulated* changed. That is the general
lever: any conditional logic you can write in a `CASE` can be folded into the
accumulator.

The related problem — a running total that **resets** rather than reverses — is
solved a level up, in the `PARTITION BY` rather than the aggregate expression.
The technique is to compute a group key that increments on every reset, using a
running total of the reset flag, then partition the real running total by it:

```sql
with grouped as (
  select id, amt, flag,
         sum(case when flag = 'RESET' then 1 else 0 end)
           over (order by id rows between unbounded preceding and current row) as grp
    from txn
)
select id, amt, flag, grp,
       sum(amt) over (partition by grp order by id) as running_total
  from grouped;
```

Two stacked window functions: the inner one turns "a flag that fires
occasionally" into "a group number that increments at each firing," and the
outer one restarts its accumulation at each new group number. When the reset
boundary is derivable from the data rather than flagged — reset per month, per
customer — no inner window is needed at all, because the partition key already
exists:

```sql
-- resets at each month boundary
select date1, sales,
       sum(sales) over (partition by date_trunc('month', date1) order by date1)
         as month_to_date
  from sales;
```

The `date_trunc` call is PostgreSQL; MySQL writes `date_format(date1, '%Y-%m')`
and SQL Server `datefromparts(year(date1), month(date1), 1)`. The window syntax
around it is identical on all three.

## Trade-offs

- **`EXP(SUM(LN(x)))` is not a running product — it is a running product for
  strictly-positive inputs.** Zeros and negatives are outside the logarithm's
  domain, and the three engines disagree on how loudly they say so: PostgreSQL
  and SQL Server raise an error, MySQL returns `NULL` with a warning that
  poisons every downstream row silently. On MySQL the failure mode is a report
  full of `NULL`s that a nightly job will happily deliver.
  ```sql
  -- MySQL: no error, just NULL from this row onward
  select exp(sum(ln(v)) over (order by id)) from (select 1 id, 0 v) t;
  ```
- **The default frame is `RANGE`, not `ROWS`, and that difference only shows up
  when the data has ties.** `SUM(x) OVER (ORDER BY d)` includes all peers of
  the current row, so a running total over a non-unique ordering column jumps
  ahead at every tie. The bug is invisible in test data with distinct values
  and appears the first time production has two rows on the same day — put a
  unique tiebreaker in the `ORDER BY` and the question disappears entirely.
- **Writing `RANGE` where you meant `ROWS` fails differently per vendor.** SQL
  Server rejects numeric offsets with `RANGE` at parse time, so the mistake is
  caught; PostgreSQL and MySQL both accept offset `RANGE` frames and will
  happily compute a value-window average where a row-window average was
  intended. The engine that is stricter is the one that helps you here.
- **The reset-group partition key is elegant and genuinely hard to read.** Two
  stacked window functions where the inner `SUM` counts flag transitions to
  manufacture a group number is a well-known idiom that nobody guesses on first
  reading — it needs a comment or a well-named CTE (`grouped`, `reset_groups`)
  every single time. Compared with a procedural loop it is dramatically faster
  and dramatically less obvious.
- **A partial window and a `NULL` window are different answers to
  "smoothing."** An `AVG` over `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`
  averages one row on row 1 and two on row 2, while the `LAG`-chain form
  returns `NULL` until three values exist. Neither is wrong, but a chart built
  on the first silently begins with a noisier, differently-computed point —
  decide explicitly rather than inheriting whichever your idiom happens to give.
- **Window functions need a sort, and the sort is the cost.** Every running
  total is a `PARTITION BY`-then-`ORDER BY` sort over the input; when it spills
  to disk, that dominates the query. All three vendors solve it the same way —
  an index whose leading key columns match the `PARTITION BY` columns followed
  by the `ORDER BY` columns, in that order, letting the engine read the rows
  pre-sorted instead of sorting them.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 7, "Working with Numbers", recipes 7.6, 7.7, 7.8, 7.15, p. 178-182, 196-197 — doc
- [PostgreSQL Documentation — Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html) — doc
- [MySQL Reference Manual — Window Function Frame Specification](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html) — doc
- [Microsoft Learn — OVER Clause (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) — doc
