---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`AVG` and `SUM` are the only measures of central tendency SQL gives you for
free, and both are the wrong tool the moment the data is skewed: a single
5000 salary drags the mean of a fourteen-person department somewhere no
actual employee sits. The mode (the most frequently occurring value), the
median (the middle value of an ordered set), and the median absolute
deviation (MAD, the median of each value's distance from the median) are the
robust alternatives — and none of them can be written as a plain aggregate
call in portable SQL. Mode needs `GROUP BY` plus a ranking step; median needs
an ordered-set aggregate that only some vendors ship; MAD is the median
technique applied twice, stacked through CTEs.

## Use Cases

- Finding the most common order size, basket count, or subscription tier —
  the value a business actually sees most often, which the mean will happily
  report as 3.7 items.
- Computing a median salary, median price, or median response time that
  doesn't move when a handful of extreme values enter the dataset, unlike a
  mean that a single outlier can shift by an order of magnitude.
- Reporting p50/p95/p99 latencies from a metrics table, where the same
  percentile machinery that produces the median produces the tail numbers.
- Flagging anomalous transaction amounts for fraud or data-quality review
  with a MAD-based threshold, instead of a standard-deviation threshold that
  the very outliers you're hunting have already inflated.
- Screening imported sensor or meter readings for collection errors before
  they reach a report, without first having to assume the data is normally
  distributed.

## Deep Dive

### Mode: `GROUP BY` + `COUNT`, then rank the counts

The mode of the salaries in `DEPTNO 20` — `800, 1100, 2975, 3000, 3000` — is
`3000`. Counting occurrences is the easy half:

```sql
select sal, count(*) as cnt
  from emp
 where deptno = 20
 group by sal;
```

The hard half is "keep only the rows with the highest count, *all* of them."
`ORDER BY cnt DESC LIMIT 1` gets that wrong the instant two values tie for
most-frequent — it silently returns one of them. `DENSE_RANK` is the portable
fix, because it assigns the same rank to tied counts:

```sql
select sal
  from (
        select sal,
               dense_rank() over (order by cnt desc) as rnk
          from (
                select sal, count(*) as cnt
                  from emp
                 where deptno = 20
                 group by sal
               ) x
       ) y
 where rnk = 1;
```

The inner query produces `(3000, 2)`, `(800, 1)`, `(1100, 1)`, `(2975, 1)`;
`DENSE_RANK` labels `3000` as rank 1 and everything else as rank 2; the outer
filter keeps rank 1. If `800` also appeared twice, both `800` and `3000` come
back — which is correct, since a dataset genuinely can have more than one
mode. This runs unmodified on PostgreSQL, MySQL, and SQL Server.

**PostgreSQL** is the only one of the three with a native mode, as an
ordered-set aggregate:

```sql
select mode() within group (order by sal)
  from emp
 where deptno = 20;
```

Read the documentation before reaching for it: `mode()` computes the most
frequent value, "arbitrarily choosing the first one if there are multiple
equally-frequent values." It is a one-liner that answers a slightly different
question than the `DENSE_RANK` query — one mode, always, ties discarded.

**SQL Server** has no `mode()`, but `TOP ... WITH TIES` expresses the
tie-preserving intent directly and reads better than the nested ranking:

```sql
select top 1 with ties sal, count(*) as cnt
  from emp
 where deptno = 20
 group by sal
 order by count(*) desc;
```

**MySQL** has neither — `LIMIT 1` has no `WITH TIES` variant, so the
`DENSE_RANK` form above is the idiom.

### Median: `PERCENTILE_CONT(0.5)`, or a window-function workaround

The median is by definition the 50th percentile, so vendors that implement
the SQL standard's inverse distribution functions give it to you directly.

**PostgreSQL** treats `percentile_cont` as an ordered-set *aggregate* — no
`OVER` clause, and it composes with `GROUP BY` like any other aggregate:

```sql
select percentile_cont(0.5) within group (order by sal) as median_sal
  from emp
 where deptno = 20;                       -- 2975

select deptno,
       percentile_cont(0.5) within group (order by sal) as median_sal
  from emp
 group by deptno;                         -- one median per department
```

PostgreSQL also ships `percentile_disc(0.5)`, which returns the first value
whose position in the ordering reaches the fraction — an actual row value,
never an interpolation.

**SQL Server** spells the same function as an analytic function: it *requires*
`OVER()` and returns the median repeated on every row, which is why the
`DISTINCT` below isn't decoration:

```sql
select distinct percentile_cont(0.5) within group (order by sal) over () as median_sal
  from emp
 where deptno = 20;
```

Since SQL Server 2022 there is also `APPROX_PERCENTILE_CONT`, which *is* a
true aggregate — no `OVER`, usable with `GROUP BY`, backed by a KLL sketch
with a documented error bound of up to 1.33%:

```sql
select deptno,
       approx_percentile_cont(0.5) within group (order by sal) as approx_median
  from emp
 group by deptno;
```

**MySQL** is the outlier, and this is the part of the recipe worth checking
rather than assuming. The book was written in 2020 and states plainly that
MySQL has no `PERCENTILE_CONT`. Six years on, that is *still* true: the
current MySQL 9.x reference manual lists exactly nineteen aggregate functions
— `AVG`, `COUNT`, `MIN`, `MAX`, `SUM`, the `STDDEV_*`/`VAR_*` family, the
bitwise and JSON aggregates — with no `MEDIAN`, no `PERCENTILE_CONT`, no
`PERCENTILE_DISC`, and no `WITHIN GROUP` syntax at all. The window function
list is equally unchanged: `CUME_DIST`, `DENSE_RANK`, `NTILE`,
`PERCENT_RANK`, `RANK`, `ROW_NUMBER`, the value functions — and nothing
inverse-distribution. The feature request has been open on the MySQL bug
tracker since 2018. MariaDB has had `MEDIAN` and `PERCENTILE_CONT` since
10.3; MySQL proper has not followed.

So MySQL needs a workaround. The book builds one from `CUME_DIST` plus a
`UNION` that averages the closest value on each side of the 0.5 boundary:

```sql
with rank_tab (sal, rank_sal) as (
  select sal, cume_dist() over (order by sal)
    from emp
   where deptno = 20
),
inter as (
  select sal, rank_sal from rank_tab where rank_sal >= 0.5
  union
  select sal, rank_sal from rank_tab where rank_sal <= 0.5
)
select avg(sal) as median_sal
  from inter;
```

A tighter formulation of the same idea uses `ROW_NUMBER` and a windowed
`COUNT(*)` to address the middle position(s) arithmetically, which avoids the
`UNION` and handles odd and even row counts in one expression:

```sql
with ordered as (
  select sal,
         row_number() over (order by sal) as rn,
         count(*)     over ()             as n
    from emp
   where deptno = 20
)
select avg(sal) as median_sal
  from ordered
 where rn in (floor((n + 1) / 2), ceil((n + 1) / 2));
```

With `n = 5`, `(n+1)/2` is `3`, so `floor` and `ceil` both select row 3 and
`AVG` averages a single value with itself — `2975`. With an even `n`, they
select the two middle rows and `AVG` interpolates between them, matching
`PERCENTILE_CONT` semantics. The CTE is not optional in either form: neither
`CUME_DIST` nor `ROW_NUMBER` may appear in a `WHERE` clause, so the window
function has to be materialized one level down before it can be filtered on.

### MAD: the median technique, applied twice

The standard-deviation approach to outlier detection — flag anything more than
three σ from the mean — has a circularity problem the book calls out
explicitly: it assumes a normal distribution, and both the mean and σ are
themselves computed from the data including the outliers, so a single extreme
value inflates the very threshold meant to catch it. The median absolute
deviation is the nonparametric alternative:

1. Compute the median of the values.
2. Compute each value's absolute deviation from that median.
3. Compute the median *of those deviations* — that is the MAD.
4. Score each value as `|value − median| / MAD` and flag scores above ~3.

Because every step is a median, no single extreme value can move the
threshold. On the full `EMP` table the median salary is `1550` and the MAD is
`675`; `KING`'s `5000` scores `3450 / 675 ≈ 5.1` and is the only row above 3
— which fits, since `KING` is the president.

**PostgreSQL**, where `percentile_cont` is an aggregate, chains cleanly
through CTEs:

```sql
with med as (
  select percentile_cont(0.5) within group (order by sal) as median_sal
    from emp
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
mad as (
  select percentile_cont(0.5) within group (order by deviation) as mad
    from dev
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

**SQL Server** is the same shape, with `over ()` and `distinct` on each
percentile step because the analytic form returns one row per input row:

```sql
with med as (
  select distinct percentile_cont(0.5) within group (order by sal) over () as median_sal
    from emp
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
mad as (
  select distinct percentile_cont(0.5) within group (order by deviation) over () as mad
    from dev
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

On SQL Server 2022+, swapping both `percentile_cont(...) over ()` calls for
`approx_percentile_cont(...)` removes the `distinct`/`over ()` ceremony
entirely, at the cost of an approximate answer.

**MySQL** pays for the missing function twice, since both medians have to be
rebuilt from window functions:

```sql
with ordered as (
  select sal,
         row_number() over (order by sal) as rn,
         count(*)     over ()             as n
    from emp
),
med as (
  select avg(sal) as median_sal
    from ordered
   where rn in (floor((n + 1) / 2), ceil((n + 1) / 2))
),
dev as (
  select e.ename, e.sal, abs(e.sal - m.median_sal) as deviation
    from emp e cross join med m
),
dev_ordered as (
  select deviation,
         row_number() over (order by deviation) as rn,
         count(*)     over ()                   as n
    from dev
),
mad as (
  select avg(deviation) as mad
    from dev_ordered
   where rn in (floor((n + 1) / 2), ceil((n + 1) / 2))
)
select d.ename, d.sal, d.deviation / m.mad as mad_score
  from dev d cross join mad m
 where d.deviation / m.mad > 3;
```

> One correction worth carrying forward: the book's final `SELECT` in recipe
> 7.16 reads `abs(sal - MAD) / MAD`, comparing each salary to the *deviation*
> statistic rather than to the median. The MAD score is `|value − median| /
> MAD`, i.e. the already-computed `deviation` divided by the MAD — which is
> what the queries above use. On the `EMP` data the printed formula happens to
> flag the same row, but it is measuring the wrong distance, and on data where
> the median and the MAD differ more it will not agree.

## Trade-offs

- **A dataset can have more than one mode, and every convenient shortcut
  throws the extras away.** `DENSE_RANK ... WHERE rnk = 1` and SQL Server's
  `TOP 1 WITH TIES` both return every tied value; PostgreSQL's `mode()` and a
  plain `ORDER BY cnt DESC LIMIT 1` both return exactly one, chosen
  arbitrarily. Decide which behaviour the report actually wants before
  choosing the syntax — the two queries look interchangeable and are not.
  ```sql
  -- returns ONE value even when two salaries tie for most frequent
  select mode() within group (order by sal) from emp where deptno = 20;
  ```
- **`PERCENTILE_CONT` interpolates; `PERCENTILE_DISC` returns a real row
  value.** For an even-sized set, `percentile_cont(0.5)` averages the two
  middle values and can produce a number that appears nowhere in the table —
  fine for a median salary, wrong if the column is an id, a discrete tier, or
  anything where "a value that exists" is part of the contract. Reach for
  `percentile_disc` when the answer has to be an actual observation.
- **MAD's scale factor is a choice, not a constant handed to you.** The raw
  `|x − median| / MAD` ratio used above is not on the same scale as a z-score;
  the conventional bridge is to multiply MAD by `1.4826`, which makes it a
  consistent estimator of σ for normally distributed data, or to use the
  Iglewicz–Hoaglin modified z-score `0.6745 · (x − median) / MAD` with a
  threshold of `3.5`. Different sources use different constants and different
  cutoffs, so "three deviations" means nothing unless the scaling is stated
  alongside it.
- **MAD degenerates when more than half the values are identical.** If over
  50% of rows share one value, the median of the deviations is `0`, and every
  MAD score becomes a division by zero rather than an outlier verdict. Low
  cardinality columns, heavily defaulted columns, and small groups all hit
  this — guard the divisor or fall back to an interquartile-range method.
- **MySQL's missing median is a real, still-open portability gap, not a
  book-era artifact.** It is tempting to assume the 2020 text is simply out of
  date here — it isn't. MySQL 9.x still ships no `MEDIAN`, no
  `PERCENTILE_CONT`, and no `WITHIN GROUP` syntax, so any median or percentile
  logic meant to run on both MySQL and PostgreSQL/SQL Server either carries
  two query texts or standardizes on the slower, wordier window-function form
  everywhere. MariaDB, notably, closed this gap years ago.
- **Two medians means two full sorts.** Every `PERCENTILE_CONT` call and every
  `ROW_NUMBER() OVER (ORDER BY ...)` orders the whole input, and the MAD
  recipe does it twice over what is effectively the same rowset plus a
  `CROSS JOIN` in between. On large tables this is materially more expensive
  than `AVG`/`STDDEV`, which stream in one pass — SQL Server's
  `APPROX_PERCENTILE_CONT` exists precisely to trade a bounded error for that
  cost, and is worth considering once the table stops being small.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 7, "Working with Numbers", recipes 7.9, 7.10, 7.16, p. 182-187, 197-201 — doc
- [PostgreSQL Documentation — Aggregate Functions (ordered-set aggregates: mode, percentile_cont, percentile_disc)](https://www.postgresql.org/docs/current/functions-aggregate.html) — doc
- [Microsoft Learn — PERCENTILE_CONT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/percentile-cont-transact-sql) — doc
- [MySQL Reference Manual — Aggregate Functions (still no MEDIAN or PERCENTILE_CONT as of 9.x)](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html) — doc
