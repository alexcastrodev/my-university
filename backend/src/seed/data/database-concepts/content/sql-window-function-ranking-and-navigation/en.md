---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Two window-function families answer the questions a plain `SELECT` can't:
*navigation* and *ranking*. `LEAD` and `LAG` navigate — they reach into a
neighboring row inside an ordered partition and pull its value onto the
current row, either to look ahead at what happens next or to bodily shift a
column up or down by N positions. `RANK`, `DENSE_RANK`, and `ROW_NUMBER`
rank — they assign each row an ordinal position within that same ordered
partition, and the only thing that separates the three is what each one does
when two rows tie. Neither family needs a self-join, a correlated subquery,
or a second pass over the table; both are one ordered scan.

## Use Cases

- Finding a customer's *next* order date (or an employee's next hire date,
  a device's next heartbeat) so the current row can be compared against, or
  annotated with, the event that follows it.
- Shifting a time series up or down by a fixed number of rows to line
  periods up for a period-over-period report — this week's value beside the
  value from four rows back, without a self-join on a computed date key.
- Building "next highest / next lowest" columns that wrap around the ends of
  a result set, so the top row's "forward" value is the bottom row's and
  vice versa.
- Ranking sales reps by revenue where two reps on identical numbers must
  *share* a rank — and the neighboring case where every row must get a
  distinct number regardless, because the ranking feeds pagination or a
  dedupe.
- Top-N reports where "the top 3" has to mean "everyone tied into the top 3
  positions," not "3 rows, pick arbitrarily among the ties."

## Deep Dive

### LEAD: reading a future row's value

The book's recipe 11.7 asks for employees who earn less than the person
hired immediately after them. Without a window function that's a correlated
subquery hunting for the minimum `HIREDATE` greater than the current one;
with `LEAD` it's one column:

```sql
select ename, sal, hiredate,
       lead(sal) over (order by hiredate) as next_sal
  from emp;
```

```
 ename  | sal  |  hiredate  | next_sal
--------+------+------------+----------
 SMITH  |  800 | 1980-12-17 |     1600
 ALLEN  | 1600 | 1981-02-20 |     1250
 WARD   | 1250 | 1981-02-22 |     2975
 ...
 ADAMS  | 1100 | 1983-01-12 |
```

"Future" is whatever `ORDER BY` inside `OVER` says it is — there is no
inherent order in a table, so the ordering *defines* the direction. The
last row has no successor, so `LEAD` returns `NULL`.

Window functions are evaluated after `WHERE`, so the filter can't live in
the same query block:

```sql
-- ERROR:  window functions are not allowed in WHERE
select ename from emp where lead(sal) over (order by hiredate) > sal;
```

Wrap it in an inline view (or CTE) and filter outside — the shape every
engine forces:

```sql
select ename, sal, hiredate
  from (
    select ename, sal, hiredate,
           lead(sal) over (order by hiredate) as next_sal
      from emp
       ) alias
 where sal < next_sal;
```

```
 ename  | sal  |  hiredate
--------+------+------------
 SMITH  |  800 | 1980-12-17
 WARD   | 1250 | 1981-02-22
 MARTIN | 1250 | 1981-09-28
 JAMES  |  950 | 1981-12-03
 MILLER | 1300 | 1982-01-23
```

`LEAD` steps one *row* forward, not one distinct `ORDER BY` value — so ties
in `HIREDATE` make an employee compare against a same-day colleague rather
than the genuinely next hire. The book's fix is a computed offset
(`lead(sal, cnt-rn+1)`), and that offset argument is the least portable
thing in the whole chapter; it's covered in detail, with the exact
PostgreSQL cast error and MySQL's literal-only restriction, in
[SQL: Differences Between Adjacent Rows](/database-concepts/sql-differences-between-adjacent-rows).

### LAG and LEAD as a shift operator

Recipe 11.8 reframes the same two functions: instead of comparing against a
neighbor, *move a column's values* N rows up or down. Order by `SAL` and
each row gets the next-highest and next-lowest salary in the table:

```sql
select ename, sal,
       lead(sal) over (order by sal) as forward,
       lag(sal)  over (order by sal) as rewind
  from emp;
```

The edges come back `NULL` — the lowest salary has nothing behind it, the
highest nothing ahead. The book's requirement is that the result *wrap*, and
`MIN`/`MAX` with an **empty** `OVER ()` (no `PARTITION BY`, no `ORDER BY`,
so the window is the entire result set) supplies the values to wrap to:

```sql
select ename, sal,
       coalesce(lead(sal) over (order by sal), min(sal) over ()) as forward,
       coalesce(lag(sal)  over (order by sal), max(sal) over ()) as rewind
  from emp;
```

```
 ename  | sal  | forward | rewind
--------+------+---------+--------
 SMITH  |  800 |     950 |   5000   <- rewind wrapped to MAX
 JAMES  |  950 |    1100 |    800
 ADAMS  | 1100 |    1250 |    950
 WARD   | 1250 |    1250 |   1100
 ...
 FORD   | 3000 |    3000 |   2975
 SCOTT  | 3000 |    5000 |   3000
 KING   | 5000 |     800 |   3000   <- forward wrapped to MIN
```

The shift distance is the second argument, and it doesn't have to be 1 —
"three rows forward, five rows back" is just `lead(sal,3)` and `lag(sal,5)`:

```sql
select ename, sal,
       lead(sal,3) over (order by sal) as forward,
       lag(sal,5)  over (order by sal) as rewind
  from emp;
```

Now the first *five* rows have a `NULL` `rewind` and the last three a `NULL`
`forward` — the further you shift, the wider the `NULL` band at the edge.
There is a third argument for exactly this, a default to substitute instead
of `NULL`, supported on PostgreSQL, MySQL 8+, and SQL Server alike:

```sql
select ename, sal,
       lead(sal, 1, 0) over (order by sal) as next_sal   -- 0, not NULL, at the end
  from emp;
```

Prefer the third argument to a wrapping `COALESCE` when the fallback is a
constant; reach for `COALESCE` (as the book does) when the fallback is
itself a computed value like `min(sal) over ()`. One thing the third
argument does *not* do is skip `NULL`s already present in the data — that's
`IGNORE NULLS`, and its vendor support is a gap of its own, covered in the
adjacent-rows concept above.

### RANK vs DENSE_RANK vs ROW_NUMBER: three answers to a tie

All three take an ordered partition and hand out integers. They are
identical until two rows tie, and then they diverge in ways that change
query *results*, not just cosmetics:

```sql
select sal,
       rank()       over w as rnk,
       dense_rank() over w as dns,
       row_number() over w as rn
  from emp
window w as (order by sal);
```

```
 sal  | rnk | dns | rn
------+-----+-----+----
  800 |   1 |   1 |  1
  950 |   2 |   2 |  2
 1100 |   3 |   3 |  3
 1250 |   4 |   4 |  4     <- tie
 1250 |   4 |   4 |  5     <- tie
 1300 |   6 |   5 |  6     <- RANK skips 5, DENSE_RANK doesn't
 1500 |   7 |   6 |  7
 1600 |   8 |   7 |  8
 2450 |   9 |   8 |  9
 2850 |  10 |   9 | 10
 2975 |  11 |  10 | 11
 3000 |  12 |  11 | 12    <- tie
 3000 |  12 |  11 | 13    <- tie
 5000 |  14 |  12 | 14
```

Read the last row: 14 employees, and the top salary is simultaneously
"rank 14" (`RANK` — it's the 14th row, two ties consumed two numbers each),
"rank 12" (`DENSE_RANK` — there are 12 distinct salaries) and "row 14"
(`ROW_NUMBER`). The book's recipe 11.9 wants ties to share a number *without*
gaps, which is precisely `DENSE_RANK`.

The practical consequence shows up when you filter on the rank. "Top 2
salaries" with `RANK` returns three employees, because the two on 3000 are
genuinely tied for second:

```sql
select ename, sal
  from (select ename, sal, rank() over (order by sal desc) as rnk from emp) t
 where rnk <= 2;
```

```
 ename | sal
-------+------
 KING  | 5000
 FORD  | 3000
 SCOTT | 3000
```

The same query with `ROW_NUMBER` returns two rows and silently drops one of
the tied employees — which one depends on the plan:

```sql
select ename, sal
  from (select ename, sal, row_number() over (order by sal desc) as rn from emp) t
 where rn <= 2;
```

```
 ename | sal
-------+------
 KING  | 5000
 FORD  | 3000
```

Both queries are correct; they answer different questions. `RANK`/`DENSE_RANK`
answer "which positions," `ROW_NUMBER` answers "give me exactly N rows."

**Support and syntax across the three engines.** All five functions —
`LEAD`, `LAG`, `RANK`, `DENSE_RANK`, `ROW_NUMBER` — plus `NTILE`,
`PERCENT_RANK` and `CUME_DIST` exist today on PostgreSQL (window functions
since 8.4, 2009), MySQL (8.0, 2018) and SQL Server (the `RANK` family since
2005, `LAG`/`LEAD` since 2012). That universality is recent enough to matter
when reading older code: a pre-8.0 MySQL had none of them, which is why
MySQL examples from that era rank with self-joins or user variables. Two
syntax differences survive:

```sql
-- ORDER BY inside OVER: optional on PostgreSQL/MySQL (and meaningless without it),
-- REQUIRED on SQL Server for ranking functions and for LAG/LEAD.
select ename, row_number() over () from emp;   -- runs on PostgreSQL, nondeterministic
```

```sql
-- A frame clause on a ranking function: PostgreSQL parses and ignores it;
-- T-SQL's grammar for RANK/DENSE_RANK/ROW_NUMBER has no ROWS/RANGE at all.
select rank() over (order by sal rows between 1 preceding and current row) from emp;
```

## Trade-offs

- **`RANK` leaves gaps, `DENSE_RANK` doesn't, `ROW_NUMBER` breaks ties
  arbitrarily — and the choice changes the row count of a filtered query.**
  On salaries `5000, 3000, 3000, 2975` ordered descending, `RANK` gives
  `1, 2, 2, 4` (position 3 is consumed by the tie), `DENSE_RANK` gives
  `1, 2, 2, 3`, and `ROW_NUMBER` gives `1, 2, 3, 4`. Filter `rank <= 2` and
  three employees come back; filter `row_number() <= 2` and one of the tied
  3000-earners is dropped with no indication it happened. Pick `RANK` for
  "positions, gaps are meaningful," `DENSE_RANK` for "distinct levels,"
  `ROW_NUMBER` only when you genuinely want exactly N rows.
  ```sql
  where rnk <= 2   -- KING 5000, FORD 3000, SCOTT 3000  (3 rows)
  where rn  <= 2   -- KING 5000, FORD 3000              (2 rows, SCOTT silently gone)
  ```
- **`ROW_NUMBER` over a non-unique `ORDER BY` is nondeterministic across
  executions.** Microsoft states it outright: there is no guarantee that
  rows get the same `ROW_NUMBER` on each run unless the partition and
  ordering columns are unique, and the docs' own advice is to reach for
  `RANK`/`DENSE_RANK` when they aren't. A pagination or dedupe query keyed
  on `ROW_NUMBER()` with a non-unique sort key can return the same row twice
  across two pages, or skip one, after nothing more than a plan change — add
  a unique tiebreaker column (typically the primary key) to the `OVER`
  clause's `ORDER BY` rather than relying on incidental stability.
- **`LEAD`/`LAG` move by row position, so the ordering column's ties leak
  into the answer.** `lead(sal) over (order by hiredate)` compares an
  employee against whoever happens to sort next among same-day hires, not
  against the next distinct hire date — a plausible-looking wrong number
  rather than an error. The computed-offset fix (`lead(sal, cnt-rn+1)`) is
  the standard remedy and is effectively single-vendor code; see the
  adjacent-rows concept for the PostgreSQL cast requirement and MySQL's
  literal-only offset restriction.
- **Edge `NULL`s from `LEAD`/`LAG` are load-bearing and must be handled
  deliberately.** Every `lead(x, n)` leaves `n` rows at the end of each
  partition with `NULL`, and every `lag(x, n)` leaves `n` at the start — so
  shifting by 5 blanks five rows, not one. Feeding those into arithmetic
  yields `NULL`, and into a comparison yields `UNKNOWN`, which a `WHERE`
  treats as false: `where sal < next_sal` quietly excludes the final row
  rather than erroring. Use the third argument for a constant fallback or
  `COALESCE` with a computed one (`min(sal) over ()`), but decide — don't
  inherit the `NULL` by accident.
- **Ranking is not free: it's a sort per distinct `OVER` clause.** Each
  distinct `PARTITION BY`/`ORDER BY` combination in a query is its own sort
  (or index scan, if a matching index exists) over the input; three ranking
  functions sharing one window cost one sort, three functions with three
  different windows cost three. PostgreSQL and MySQL both let a named
  `WINDOW w AS (...)` clause be reused across select-list items — worth
  doing for readability as much as for the optimizer's benefit, and on
  SQL Server the equivalent lever is an index whose key columns match
  `PARTITION BY` followed by `ORDER BY`.
- **Portability is good but not total, and the differences are in the
  `OVER` clause, not the functions.** SQL Server requires `ORDER BY` inside
  `OVER` for every ranking function and for `LAG`/`LEAD`, where PostgreSQL
  and MySQL accept `row_number() over ()` and hand back a nondeterministic
  sequence. A frame clause on a ranking function parses and is ignored on
  PostgreSQL, while T-SQL's grammar has no `ROWS`/`RANGE` for those
  functions at all. Neither difference bites often — but both bite at
  migration time rather than at review time.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 11, "Advanced Searching", recipes 11.7, 11.8, 11.9, p. 345-351 — doc
- [PostgreSQL Documentation — Window Functions (row_number, rank, dense_rank, lag, lead)](https://www.postgresql.org/docs/current/functions-window.html) — doc
- [MySQL Reference Manual — Window Function Descriptions (LAG/LEAD offsets, RANK/DENSE_RANK/ROW_NUMBER)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) — doc
- [Microsoft Learn — ROW_NUMBER (Transact-SQL): required ORDER BY and tie nondeterminism](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql) — doc
- [Microsoft Learn — OVER Clause (Transact-SQL): ranking functions can't accept ROWS or RANGE](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) — doc
