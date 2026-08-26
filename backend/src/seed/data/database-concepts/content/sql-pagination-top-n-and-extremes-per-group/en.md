---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A whole family of "which rows, and how many" problems sits just past a plain
`LIMIT 5`: handing a user page 4 of a result set, sampling a big table by
taking every 100th row, returning "the top five salaries" in a way that
handles ties the way the business actually means, and finding the highest and
lowest value *per group* rather than once across the whole table. All four are
window-function problems at heart — you impose an order, number or rank the
rows under that order, and then filter on the number. This concept assumes the
basic row-capping syntax (`LIMIT`, `TOP`, `FETCH FIRST`) from
[SQL: Limiting and Random Sampling](/database-concepts/sql-limiting-and-random-sampling)
and builds the harder patterns on top of it.

## Use Cases

- Serving paginated API responses or a UI list with Next/Previous buttons,
  where each click is a separate query for a different range of rows.
- Building a "top 3 highest earners per department" or "best-selling product
  per category" report — extremes computed within a group, not globally.
- Spot-checking a large table by pulling every 100th row, so the sample is
  spread evenly across the ordering instead of clustered at the front.
- Producing a leaderboard where ties must share a position ("two people tied
  for 2nd, next is 4th") rather than being silently broken by an arbitrary
  tiebreaker.
- Filtering a result set to the rows that hit a per-partition minimum or
  maximum, without a self-join back onto an aggregate subquery.

## Deep Dive

### Paginating through a result set

SQL has no notion of "first", "next", or "page 3" — those only exist once you
impose an order. The book's portable technique numbers the ordered rows in an
inline view and then filters on that number:

```sql
-- rows 1-5
select sal
  from (
select row_number() over (order by sal) as rn,
       sal
  from emp
       ) x
 where rn between 1 and 5;

-- rows 6-10: same query, different range
 where rn between 6 and 10
```

This runs unchanged on PostgreSQL, MySQL 8.0+, and SQL Server, which is its
main virtue. In practice you'd reach for the native offset syntax instead —
and here the three engines genuinely diverge:

```sql
-- PostgreSQL: both forms work
select sal from emp order by sal limit 5 offset 5;
select sal from emp order by sal offset 5 rows fetch next 5 rows only;

-- MySQL: LIMIT only, in either spelling. Note the two-argument form's
-- argument order is (offset, count) — the reverse of how it reads.
select sal from emp order by sal limit 5, 5;      -- skip 5, take 5
select sal from emp order by sal limit 5 offset 5; -- same thing

-- SQL Server: OFFSET/FETCH is part of the ORDER BY clause
select sal from emp order by sal offset 5 rows fetch next 5 rows only;
```

Three rules that are easy to get wrong:

- **MySQL has no `FETCH FIRST`/`OFFSET ... FETCH` at all.** `LIMIT` is the
  only option, so the ANSI form is not a portable choice across all three.
- **SQL Server's `OFFSET`/`FETCH` is grammatically part of `ORDER BY`** — you
  cannot write `OFFSET` without an `ORDER BY`, and you cannot combine it with
  `TOP` in the same query scope. `FETCH NEXT n ROWS ONLY` on its own still
  needs `ORDER BY ... OFFSET 0 ROWS` in front of it.
- **`ORDER BY` must be on a *unique* key, not just any column.** PostgreSQL's
  manual is blunt about this: the planner takes `LIMIT` into account, so
  different `LIMIT`/`OFFSET` values can produce different plans and therefore
  different row orders. Paginating on `ORDER BY sal` alone, where salaries
  repeat, can show a row twice or skip it entirely across pages. Add a
  tiebreaker: `order by sal, empno`.

PostgreSQL (13+) and SQL Server also differ on tie behavior at the page
boundary. PostgreSQL's `FETCH` accepts `WITH TIES`; SQL Server's
`OFFSET ... FETCH` accepts only `ONLY` (its `WITH TIES` lives on `TOP`), and
MySQL has no equivalent at all:

```sql
-- PostgreSQL 13+: page may return more than 5 rows if the 5th value ties
select sal from emp order by sal fetch first 5 rows with ties;

-- SQL Server: WITH TIES is available on TOP, not on OFFSET/FETCH
select top (5) with ties sal from emp order by sal;
```

### Skipping n rows: sampling every Nth row

This looks like pagination but isn't — the goal is a strided sample across the
whole ordered set, not a contiguous window. Number the rows, then keep the ones
whose number satisfies a modulo condition:

```sql
-- every other employee: 1st, 3rd, 5th, ...
select ename
  from (
select row_number() over (order by ename) rn,
       ename
  from emp
       ) x
 where mod(rn, 2) = 1;
```

`ROW_NUMBER()` is the right function here precisely because it never ties — it
hands out 1..n with no gaps and no repeats, even when the `ORDER BY` column has
duplicate values, so the modulo arithmetic stays exact. `RANK()` would break
this: with two rows tied at rank 3 and nothing at rank 4, a `mod(rn, 2)` filter
would silently drop or double-count rows.

The modulo operator itself is the one vendor difference:

```sql
-- PostgreSQL, MySQL, Oracle: MOD() function (PostgreSQL also has % operator)
where mod(rn, 100) = 1

-- SQL Server: % operator, no MOD() function
where rn % 100 = 1
```

Every 100th row for a spot-check is the same query with a bigger divisor.
Unlike `TABLESAMPLE` or `ORDER BY random()`, this is deterministic and evenly
spread across the ordering — re-running it returns the same rows, which is
what you want when someone has to review the sample and you need it
reproducible.

### Top n records, and what "top n" means when there are ties

The naive `order by sal desc limit 5` answers "give me five rows." That is
often *not* the question. "The top five salaries" usually means five distinct
salary levels, and if two people both earn 3000 they should both appear. The
book's solution uses `DENSE_RANK`:

```sql
select ename, sal
  from (
select ename, sal,
       dense_rank() over (order by sal desc) dr
  from emp
       ) x
 where dr <= 5;
```

The three ranking functions differ only in how they treat ties, and the choice
is the whole decision:

```sql
select ename, sal,
       row_number() over (order by sal desc) as rn,
       rank()       over (order by sal desc) as rnk,
       dense_rank() over (order by sal desc) as dr
  from emp;

-- ENAME    SAL     RN   RNK    DR
-- KING    5000      1     1     1
-- SCOTT   3000      2     2     2
-- FORD    3000      3     2     2      <- tied; RN broke the tie arbitrarily
-- JONES   2975      4     4     3      <- RANK skips 3; DENSE_RANK does not
-- BLAKE   2850      5     5     4
-- CLARK   2450      6     6     5
-- ALLEN   1600      7     7     6
```

- `ROW_NUMBER()` — **exactly n rows, ties broken arbitrarily.** Use when the
  row count is the hard constraint (a fixed-size page, a batch of n). Which of
  SCOTT/FORD gets number 2 is undefined unless you add a tiebreaker to the
  `ORDER BY`.
- `RANK()` — **ties share a rank, and the next rank skips.** Competition
  ranking: two people tied for 2nd means nobody is 3rd. `where rnk <= 5`
  returns at most five *positions* but can return more than five rows.
- `DENSE_RANK()` — **ties share a rank, no gaps.** "Top five distinct salary
  levels", which is what "top five salaries" usually means in a report.

All three are ANSI window functions and work identically on PostgreSQL,
MySQL 8.0+, and SQL Server. The important part is that the filter has to sit
in an outer query or CTE — window functions are evaluated after `WHERE`, so
`where dense_rank() over (...) <= 5` is a syntax error on every engine.

### Highest and lowest values, per group

The book's recipe finds the global extremes by making the min and max visible
on every row via an empty `OVER()` window, then filtering:

```sql
select ename, sal
  from (
select ename, sal,
       min(sal) over () min_sal,
       max(sal) over () max_sal
  from emp
       ) x
 where sal in (min_sal, max_sal);
```

`OVER()` with an empty window means "over the entire result set", so
`min_sal`/`max_sal` are the same 800/5000 on every row — an aggregate that
does not collapse the rows. The interesting generalization is one keyword
away: add `PARTITION BY` and the same query answers "highest and lowest paid
employee **per department**":

```sql
select deptno, ename, sal
  from (
select deptno, ename, sal,
       min(sal) over (partition by deptno) min_sal,
       max(sal) over (partition by deptno) max_sal
  from emp
       ) x
 where sal in (min_sal, max_sal)
 order by deptno, sal;
```

For "top n per group" rather than just the single extreme, partition a ranking
function the same way — this is the pattern behind almost every "top 3 per
category" report:

```sql
-- three highest earners in each department
select deptno, ename, sal
  from (
select deptno, ename, sal,
       dense_rank() over (partition by deptno order by sal desc) dr
  from emp
       ) x
 where dr <= 3
 order by deptno, sal desc;
```

The pre-window-function alternative is a correlated subquery, which still
works everywhere and is worth recognizing in older code:

```sql
select deptno, ename, sal
  from emp e
 where sal = (select max(sal) from emp where deptno = e.deptno)
    or sal = (select min(sal) from emp where deptno = e.deptno);
```

It reads acceptably for the single-extreme case but degrades badly for top-n:
the subquery is re-evaluated per outer row, and extending it to "top 3" means
a counting subquery (`where 3 > (select count(*) from emp e2 where e2.deptno =
e.deptno and e2.sal > e.sal)`) that is far harder to read than the partitioned
`DENSE_RANK`. The window-function form also computes the ranking in a single
pass over the partition rather than once per row.

PostgreSQL offers a fourth option for the single-extreme case specifically —
`DISTINCT ON`, which keeps the first row per group under the given ordering:

```sql
-- PostgreSQL only: highest-paid employee per department
select distinct on (deptno) deptno, ename, sal
  from emp
 order by deptno, sal desc;
```

It is terse and fast, but it caps out at one row per group and does not port
to MySQL or SQL Server.

## Trade-offs

- **`OFFSET` at depth is the classic pagination trap, and it is documented
  behavior, not a bug.** PostgreSQL states it plainly: "the rows skipped by an
  `OFFSET` clause still have to be computed inside the server; therefore a
  large `OFFSET` might be inefficient." `OFFSET 100000 LIMIT 20` reads and
  discards 100,000 rows to return 20 — cost grows linearly with page number,
  so page 1 is instant and page 5,000 times out. The `ROW_NUMBER()`-in-a-
  subquery form has exactly the same problem; numbering the rows still requires
  producing them.
  ```sql
  -- fast; the planner stops after 20 rows
  select * from orders order by id limit 20;
  -- slow; the engine still materializes 100,000 rows it will throw away
  select * from orders order by id offset 100000 limit 20;
  ```
- **Keyset (seek) pagination is the modern answer, at the cost of losing
  random page access.** Instead of counting rows to skip, remember the sort key
  of the last row on the previous page and filter past it — an indexed range
  scan that costs the same on page 1 and page 5,000. This is what Stripe,
  GitHub, and Slack expose as opaque cursors. The price is real: no "jump to
  page 47", no total page count without a separate `COUNT(*)`, and the sort key
  must be unique (or made unique with a tiebreaker), so it fits infinite-scroll
  feeds far better than a numbered pager.
  ```sql
  -- next page after the row (sal=2450, empno=7782)
  select * from emp
   where (sal, empno) > (2450, 7782)
   order by sal, empno
   limit 20;
  ```
- **Offset pagination is not just slow at depth, it is incorrect under
  concurrent writes.** Each page is an independent query; if a row is inserted
  or deleted between requests, the offsets shift and the user sees a row twice
  or never sees it at all. SQL Server's own docs spell out the conditions for
  stable paging — the underlying data must not change, or every page must be
  fetched inside one snapshot/serializable transaction. Keyset pagination is
  immune to the shifting-window problem because it anchors on a value, not a
  position.
- **Picking the wrong ranking function produces a plausible, wrong answer.**
  `ROW_NUMBER()` for a "top 5" report silently drops one of two people earning
  the same salary and nobody notices; `RANK()` leaves gaps that surprise a
  reader expecting 1-2-3; `DENSE_RANK()` can return more than n rows when a
  caller assumed exactly n. None of these error out — the query just answers a
  slightly different question than the one that was asked, so the choice has to
  be made deliberately rather than by habit.
- **The vendor gaps here are narrow but sharp.** MySQL has no `FETCH FIRST`
  and no `WITH TIES`; SQL Server's `OFFSET`/`FETCH` supports only `ONLY` and
  cannot appear without `ORDER BY` or alongside `TOP`; the modulo operator is
  `MOD()` on PostgreSQL/MySQL and `%` on SQL Server; `DISTINCT ON` is
  PostgreSQL-only. Window functions themselves (`ROW_NUMBER`, `RANK`,
  `DENSE_RANK`, `MIN`/`MAX OVER`) are the portable common denominator across
  all three — which is a good argument for the book's inline-view technique
  when a query genuinely has to run everywhere.
- **`ORDER BY` on a non-unique column makes every technique here
  nondeterministic.** Pagination, every-Nth-row sampling, and `ROW_NUMBER()`
  tie-breaking all depend on a total order. If the ordering column has
  duplicates, the engine is free to return them in any order — and is likely to
  choose differently between two executions with different `LIMIT`/`OFFSET`
  values. Always append a unique tiebreaker (`order by sal, empno`), even when
  the extra column is meaningless to the reader.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 11, "Advanced Searching", recipes 11.1, 11.2, 11.5, 11.6, p. 335-345 — doc
- [PostgreSQL Documentation — LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html) — doc
- [MySQL Reference Manual — SELECT Statement (LIMIT offset, count)](https://dev.mysql.com/doc/refman/8.4/en/select.html) — doc
- [SQL Server Documentation — ORDER BY Clause (OFFSET ... FETCH NEXT)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) — doc
