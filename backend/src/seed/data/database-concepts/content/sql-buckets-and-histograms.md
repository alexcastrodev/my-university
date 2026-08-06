---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

There are two different questions hiding behind "split this result set into
groups." One fixes the *size* of each bucket — every bucket holds exactly
five rows, and however many buckets that takes is whatever it takes. The
other fixes the *count* of buckets — exactly four buckets, each holding as
close to an equal share of the rows as the data allows. The first is a
`ROW_NUMBER()` divided and rounded up; the second is precisely what
`NTILE(n)` was invented for. Once rows are grouped, the cheapest way to
*look* at the resulting distribution without leaving the SQL prompt is a
text histogram: one row per category with a string of repeated `*`
characters (horizontal), or a pivoted stack of rows where each output row
is one layer of the bars (vertical).

## Use Cases

- Splitting a sorted list into pages of exactly N items for batch
  processing — hand each worker a contiguous block of 500 rows, letting the
  number of blocks fall out of the row count.
- Dividing salaries into exactly 4 quartile buckets (or 10 deciles, or 100
  percentiles) for percentile reporting, where the bucket *count* is the
  fixed part of the requirement and bucket size is whatever the data gives.
- Averaging a metric per bucket to reveal a trend that per-row variability
  hides — the book's own motivation for a predefined bucket count.
- A quick-and-dirty console or log-output histogram of order counts by
  category, in a psql/sqlcmd session or a cron job's stdout, where wiring up
  a real chart is more effort than the question deserves.

## Deep Dive

### Fixed-size buckets: rank, divide, round up

The whole trick is that `ROW_NUMBER()` turns an arbitrary ordering into a
dense 1..N counter, and integer arithmetic on that counter is all a bucket
number ever is. To get groups of five:

```sql
select ceiling(row_number() over (order by empno) / 5.0) as grp,
       empno,
       ename
  from emp
 order by grp, empno;

 GRP  EMPNO  ENAME
 ---  -----  ------
   1   7369  SMITH
   1   7499  ALLEN
   1   7521  WARD
   1   7566  JONES
   1   7654  MARTIN
   2   7698  BLAKE
   ...
   3   7934  MILLER
```

Rows 1-5 divide to `0.2 … 1.0`, all of which ceiling to `1`; rows 6-10
land in `(1, 2]` and ceiling to `2`; the remaining four rows form a short
final bucket. The number of buckets is never stated anywhere in the query —
it's `ceiling(rowcount / 5)`, emergent from the data.

Two portability notes the book flags, both still exactly true:

- **`CEIL` is not universal, `CEILING` is.** PostgreSQL and MySQL accept
  both spellings; SQL Server only has `CEILING`. Writing `CEILING`
  everywhere costs nothing and removes the difference.
- **The `5.0` is load-bearing.** `row_number()` returns `bigint`, and
  `bigint / 5` is *integer* division on all three engines — it truncates,
  so rows 1-4 would land in bucket 0 and the whole numbering shifts. The
  `.0` forces numeric division before `CEILING` sees it.

If you'd rather stay in integer arithmetic and skip the numeric round-trip
entirely, the zero-based form is equivalent and has no decimal literal to
forget:

```sql
select (row_number() over (order by empno) - 1) / 5 + 1 as grp,
       empno, ename
  from emp;
```

### A predefined number of buckets: `NTILE(n)` natively

This is the inverse framing — the bucket count is fixed, the bucket sizes
are whatever falls out — and it needs no arithmetic at all. `NTILE` is a
standard window function and has been present in PostgreSQL, SQL Server,
and MySQL 8.0+ for years; the 2nd edition of the book already gives it as
*the* solution ("simple now that the NTILE function is widely available"),
with no hand-rolled fallback. That assessment has only gotten safer since:

```sql
select ntile(4) over (order by empno) as grp,
       empno,
       ename
  from emp;

 GRP  EMPNO  ENAME
 ---  -----  ------
   1   7369  SMITH
   1   7499  ALLEN
   1   7521  WARD
   1   7566  JONES     -- bucket 1: 4 rows
   2   7654  MARTIN
   ...                 -- bucket 2: 4 rows
   3   7839  KING
   ...                 -- bucket 3: 3 rows
   4   7900  JAMES
   4   7902  FORD
   4   7934  MILLER    -- bucket 4: 3 rows
```

Fourteen rows into four buckets doesn't divide evenly, and the distribution
rule is worth knowing precisely because it is *not* random. SQL Server
documents it in full: "If the number of rows in a partition isn't divisible
by *integer_expression*, this causes groups of two sizes that differ by one
member. Larger groups come before smaller groups in the order specified by
the `OVER` clause." PostgreSQL words it as "dividing the partition as
equally as possible," and MySQL doesn't spell it out in prose at all — but
all three implement the same rule, and the book's own output confirms it:
buckets 1 and 2 get four rows, buckets 3 and 4 get three.

The consequence: bucket sizes never differ by more than one, and the extra
rows always go to the *front*. If your ordering is `ORDER BY sal DESC`,
that means the top quartile is the one that gets padded.

One vendor difference in the argument itself: SQL Server accepts any
`int`/`bigint` *expression*, including a variable, so `NTILE(@n)` works.
MySQL restricts `N` to a literal constant, a `?` parameter marker, a
user-defined variable, or a stored-routine local variable — and
`NTILE(NULL)` is rejected outright rather than returning `NULL`.

```sql
-- the practical quartile query
select deptno,
       ntile(4) over (order by sal desc) as sal_quartile,
       ename, sal
  from emp;
```

### Horizontal histograms: `COUNT(*)` piped into a string repeater

A horizontal histogram is a `GROUP BY` whose aggregate is fed to a
string-repetition function instead of being printed as a number. Each
category is one row, and the bar grows left to right:

```sql
-- PostgreSQL
select deptno,
       repeat('*', count(*)::int) as cnt
  from emp
 group by deptno
 order by deptno;

 DEPTNO  CNT
 ------  ------
     10  ***
     20  *****
     30  ******
```

The function name is the only thing that changes per engine:

```sql
-- MySQL
select deptno, repeat('*', count(*)) as cnt
  from emp group by deptno;

-- SQL Server
select deptno, replicate('*', count(*)) as cnt
  from emp group by deptno;

-- the book's LPAD variant, portable to PostgreSQL/MySQL/Oracle
select deptno, lpad('*', count(*)::int, '*') as cnt
  from emp group by deptno;
```

That `::int` cast in the PostgreSQL versions is not cosmetic, and the
book's warning about it is still current. `count(*)` returns `bigint`,
`repeat` and `lpad` are declared as `repeat(text, integer)` and
`lpad(text, integer [, text])`, and PostgreSQL's `bigint → integer` cast is
*assignment-only*, not implicit — so function resolution simply fails:

```
ERROR:  function repeat(unknown, bigint) does not exist
HINT:   No function matches the given name and argument types.
```

MySQL and SQL Server both coerce the count silently, so this is a
PostgreSQL-only papercut.

`REPEAT`/`REPLICATE` say what they mean; `LPAD` only produces a bar because
the pad character and the seed character happen to be the same `*`, which
is a small pun rather than intent. Reach for `REPEAT`/`REPLICATE` first.
Two edge cases worth knowing when the count can be zero or negative
(possible once you're summing a signed column rather than counting rows):
MySQL's `REPEAT` returns an empty string for `count < 1`, while SQL
Server's `REPLICATE` returns `NULL` for a negative argument.

### Vertical histograms: `ROW_NUMBER()` + `MAX()` pivot, and the NULL-ordering trap

Turning the bars 90 degrees means each output row is one *layer* across all
categories, so the technique is a pivot. `ROW_NUMBER()` partitioned by
category numbers each `*` within its bar; `MAX()` grouped by that number
collapses the sparse per-category columns into a single row per layer:

```sql
select max(deptno_10) as d10,
       max(deptno_20) as d20,
       max(deptno_30) as d30
  from (
        select row_number() over (partition by deptno order by empno) as rn,
               case when deptno = 10 then '*' end as deptno_10,
               case when deptno = 20 then '*' end as deptno_20,
               case when deptno = 30 then '*' end as deptno_30
          from emp
       ) x
 group by rn
 order by 1 desc, 2 desc, 3 desc;

 D10  D20  D30
 ---  ---  ---
            *
       *    *
       *    *
  *    *    *
  *    *    *
  *    *    *
```

The inner query produces one row per employee with a `*` in exactly one of
the three columns and `NULL` in the other two. Grouping by `rn` puts layer
1 of all three departments on one row, layer 2 on the next, and so on;
`MAX()` picks the non-`NULL` value out of each column because `MAX` ignores
`NULL`s.

**The `ORDER BY` direction is engine-dependent, and this is the one thing
that will silently render your chart upside down.** A vertical bar has to
have its blanks (`NULL`s) at the *top* to look like it grows from the
bottom, which means the sort has to put `NULL`s first:

- **PostgreSQL** (and Oracle) sort `NULL`s *last* in `ASC`, so `DESC` is
  required — as written above.
- **SQL Server and MySQL** sort `NULL`s *first* in `ASC`, so those engines
  want plain `order by 1, 2, 3`. This is exactly the book's parenthetical
  "SQL Server users should not use `DESC`."

PostgreSQL lets you stop guessing by stating it outright, which is what you
want in a query that someone else will read:

```sql
-- PostgreSQL: intent is explicit, no reliance on the engine's default
 order by 1 nulls first, 2 nulls first, 3 nulls first;
```

MySQL and SQL Server have no `NULLS FIRST`/`NULLS LAST` clause in `ORDER
BY` at all, so on those engines the default really is the mechanism, and
the workaround when you need the other direction is an expression like
`ORDER BY (d10 IS NULL) DESC` (MySQL) or `ORDER BY CASE WHEN d10 IS NULL
THEN 0 ELSE 1 END` (SQL Server).

Note also that the category columns are hardcoded — `deptno_10`,
`deptno_20`, `deptno_30`. A vertical histogram's *shape* depends on the
number of distinct categories, and a SQL statement's column list is fixed
at parse time, so there is no way to make this adapt to new departments
without generating the SQL. That limitation is structural, not a gap in any
particular engine.

## Trade-offs

- **`NTILE` guarantees bucket count, not bucket equality — and the
  imbalance is front-loaded.** When rows don't divide evenly, buckets differ
  in size by exactly one and the larger ones come first in `OVER` order. For
  14 rows in 4 buckets that's a harmless 4/4/3/3, but for 5 rows in 4
  buckets it's 2/1/1/1 — bucket 1 holds twice what bucket 4 does. Any
  reporting that compares bucket *totals* rather than bucket *averages* will
  read that skew as a real signal when it's an artifact of the row count.
- **`NTILE` also splits ties across bucket boundaries.** It numbers by
  position, not by value, so two rows with identical `sal` can land in
  different quartiles depending only on how the `ORDER BY` broke the tie.
  If your requirement is genuinely "everyone with the same salary gets the
  same bucket," `NTILE` is the wrong function and you want
  `PERCENT_RANK()`/`CUME_DIST()` with explicit range boundaries instead.
- **Fixed-size vs. fixed-count is a real modelling decision, not a syntax
  preference.** Batch/pagination work wants fixed *size* (a worker's memory
  budget is per-block, and a variable block count is fine); statistical
  reporting wants fixed *count* (quartiles have to be quarters, and a
  variable number of quartiles is nonsense). Picking the wrong framing
  produces a query that works and answers the wrong question.
- **Horizontal histograms read better; vertical ones fit more categories
  badly.** A horizontal bar has effectively unlimited length — a
  20,000-count bar just needs a scaling divisor — and adding a category is
  one more row. A vertical histogram is capped by terminal height for the
  tallest bar *and* by the hardcoded column list for the number of
  categories, and it needs a pivot plus a per-engine `NULL`-ordering rule to
  boot. Vertical looks more like a chart; horizontal is the one you should
  reach for by default.
- **Beyond a quick debug query, a real charting tool wins on every axis.**
  A text histogram has no axis labels, no scale, no way to represent a count
  that exceeds the terminal width without silently misleading, and it's
  built from a fixed-width-font assumption that breaks the moment the output
  lands in a web page or a proportional-font email. It earns its place in a
  psql session, a cron job's log, or a Slack code block — as soon as the
  output has a human audience that will look at it twice, the counts belong
  in a real chart and the SQL should just return numbers.
- **The vertical pivot's column list can't be data-driven.** Adding a
  department means editing the query — the number of `CASE` columns is fixed
  at parse time. PostgreSQL's `crosstab()` (from the `tablefunc` extension)
  moves the pivot into a function but still requires you to declare the
  output column list, so it changes where the hardcoding lives without
  removing it.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 12, "Reporting and Reshaping", recipes 12.7, 12.8, 12.9, 12.10, p. 386-394 — doc
- [PostgreSQL Documentation — Window Functions (`ntile`)](https://www.postgresql.org/docs/current/functions-window.html) — doc
- [PostgreSQL Documentation — String Functions (`repeat`, `lpad`)](https://www.postgresql.org/docs/current/functions-string.html) — doc
- [MySQL Reference Manual — Window Function Descriptions (`NTILE`)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) — doc
- [MySQL Reference Manual — String Functions (`REPEAT`, `LPAD`)](https://dev.mysql.com/doc/refman/8.4/en/string-functions.html) — doc
- [SQL Server Documentation — NTILE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/ntile-transact-sql) — doc
- [SQL Server Documentation — REPLICATE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/replicate-transact-sql) — doc
