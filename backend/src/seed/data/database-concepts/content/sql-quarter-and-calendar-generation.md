---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Sometimes the dates you need to query don't exist anywhere in the database. No
table stores "every day of 2026," and no table stores "the four quarter
boundaries of the current fiscal year" — yet a calendar grid, a gap-free daily
report, or a quarterly rollup all need those dates to exist *as rows* before
they can be grouped, joined, or pivoted. Generating a synthetic date series is
the technique for manufacturing exactly those rows: pick an anchor date, produce
N successive values from it, and turn each one into a real `DATE` the rest of
the query can work with. Every engine can do it; what differs is whether the
row-generator is a built-in function or something you have to build by hand out
of recursion.

## Use Cases

- Rendering a desk-calendar UI (seven columns across, one row per week) straight
  out of a single query, instead of generating the grid in application code.
- Joining against every date in a period so that *missing* days show up as rows
  with `0` rather than vanishing — the gap-detection pattern a `GROUP BY` over
  the fact table alone can never produce.
- Building fiscal-quarter reporting boundaries from the year alone, so quarter
  start/end dates aren't hardcoded per year in a config file or a `CASE`
  expression that has to be edited every January.
- Resolving a compact period key (`20263` meaning "2026 Q3") into the actual
  half-open date range a `WHERE` clause can use.
- Producing a driving table of dates for a backfill or replay job, one row per
  day to be reprocessed.

## Deep Dive

### Generating a calendar

The whole recipe is two steps: return one row per day in the month, then pivot
on day-of-week with `MAX(CASE ...)` grouped by week number. Step one is where
the engines diverge.

**PostgreSQL** has had `generate_series` as a native set-returning function
since long before the book was written, and it's still the cleanest row
generator of the three:

```sql
select d::date
  from generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') as g(d);
```

There is no `generate_series(date, date, interval)` overload — the `date`
arguments are implicitly cast to `timestamp`, so the function returns
`timestamp` values and the `::date` cast on the way out is doing real work, not
cosmetics. Pivoted into a calendar grid for the current month:

```sql
select to_char(d, 'IW') as wk,
       max(case extract(isodow from d) when 1 then to_char(d, 'DD') end) as mo,
       max(case extract(isodow from d) when 2 then to_char(d, 'DD') end) as tu,
       max(case extract(isodow from d) when 3 then to_char(d, 'DD') end) as we,
       max(case extract(isodow from d) when 4 then to_char(d, 'DD') end) as th,
       max(case extract(isodow from d) when 5 then to_char(d, 'DD') end) as fr,
       max(case extract(isodow from d) when 6 then to_char(d, 'DD') end) as sa,
       max(case extract(isodow from d) when 7 then to_char(d, 'DD') end) as su
  from generate_series(date_trunc('month', current_date),
                       date_trunc('month', current_date) + interval '1 month' - interval '1 day',
                       interval '1 day') as g(d)
 group by wk
 order by wk;
```

```
 wk | mo | tu | we | th | fr | sa | su
----+----+----+----+----+----+----+----
 31 |    |    |    |    |    | 01 | 02
 32 | 03 | 04 | 05 | 06 | 07 | 08 | 09
 33 | 10 | 11 | 12 | 13 | 14 | 15 | 16
 ...
```

**MySQL** is where the book shows its age most clearly. In 2020 the usual advice
was a pivot/numbers helper table (the book's own `T500`), because MySQL had no
row generator at all. MySQL 8.0 added recursive CTEs, and today the MySQL manual
itself documents the date-series recursion as the canonical way to fill date
holes:

```sql
with recursive cal (dy) as (
  select date_sub(current_date, interval dayofmonth(current_date) - 1 day)
  union all
  select dy + interval 1 day
    from cal
   where dy + interval 1 day <= last_day(current_date)
)
select weekofyear(dy) as wk,
       max(case weekday(dy) when 0 then dayofmonth(dy) end) as mo,
       max(case weekday(dy) when 1 then dayofmonth(dy) end) as tu,
       max(case weekday(dy) when 2 then dayofmonth(dy) end) as we,
       max(case weekday(dy) when 3 then dayofmonth(dy) end) as th,
       max(case weekday(dy) when 4 then dayofmonth(dy) end) as fr,
       max(case weekday(dy) when 5 then dayofmonth(dy) end) as sa,
       max(case weekday(dy) when 6 then dayofmonth(dy) end) as su
  from cal
 group by wk
 order by wk;
```

The `T500`-style helper table is no longer required for this. It's still a
legitimate choice — see Trade-offs — but it's no longer the *only* option, and
MySQL code written before 8.0 that reaches for a numbers table should be read as
"written for a MySQL that had nothing else," not as a deliberate design.

**SQL Server** got a native `GENERATE_SERIES` in SQL Server 2022 (16.x) — but
read the signature carefully, because it does not close the same gap PostgreSQL's
does:

```sql
GENERATE_SERIES ( start , stop [ , step ] )
```

`start`, `stop`, and `step` are `tinyint`/`smallint`/`int`/`bigint`/`decimal`/
`numeric`. **There is no date overload.** It generates numbers; turning those
numbers into dates is still on you, via `DATEADD` over an anchor:

```sql
-- SQL Server 2022+ (requires compatibility level 160, or the
-- ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS database-scoped configuration)
select cast(dateadd(day, value, datetrunc(month, getdate())) as date) as dy
  from generate_series(0, datediff(day, datetrunc(month, getdate()),
                                        eomonth(getdate())));
```

On SQL Server 2019 and earlier, the book's recursive `WITH` is still the answer —
with one addition the book doesn't need at month scale but which matters the
moment you widen the range:

```sql
with cal (dy) as (
  select datetrunc(month, cast(getdate() as date))
  union all
  select dateadd(day, 1, dy)
    from cal
   where dateadd(day, 1, dy) <= eomonth(getdate())
)
select * from cal
option (maxrecursion 0);
```

### Quarter boundaries for a whole year

The book's structure — recursively add three months to January 1st, four times,
then subtract a day to land on each quarter's end — is sound but does by hand
what a series generator does for free. All four quarters, PostgreSQL:

```sql
select extract(quarter from q)::int                        as qtr,
       q::date                                             as q_start,
       (q + interval '3 months' - interval '1 day')::date   as q_end
  from generate_series(date_trunc('year', current_date),
                       date_trunc('year', current_date) + interval '9 months',
                       interval '3 months') as g(q);
```

```
 qtr |  q_start   |   q_end
-----+------------+------------
   1 | 2026-01-01 | 2026-03-31
   2 | 2026-04-01 | 2026-06-30
   3 | 2026-07-01 | 2026-09-30
   4 | 2026-10-01 | 2026-12-31
```

SQL Server 2022 collapses the same thing into a numeric series plus `DATEADD` —
and `DATETRUNC`, also new in 2022, supplies the `quarter` datepart directly
rather than requiring month arithmetic:

```sql
declare @yr date = datetrunc(year, cast(getdate() as date));

select value + 1                                              as qtr,
       dateadd(quarter, value, @yr)                           as q_start,
       dateadd(day, -1, dateadd(quarter, value + 1, @yr))     as q_end
  from generate_series(0, 3);
```

MySQL has no `DATE_TRUNC`, so the year anchor comes from `MAKEDATE`, and the
four rows come from a trivial counting CTE rather than from date recursion —
generate the *ordinals*, derive the dates:

```sql
with recursive q (n) as (
  select 0
  union all
  select n + 1 from q where n < 3
)
select n + 1                                                                   as qtr,
       makedate(year(current_date), 1) + interval n quarter                    as q_start,
       makedate(year(current_date), 1) + interval (n + 1) quarter
                                       - interval 1 day                        as q_end
  from q;
```

Counting `0..3` and mapping ordinals to dates is more robust than recursing on
the dates themselves: the recursive branch's type is plainly `INT`, so there's no
chance of the `UNION ALL` branches disagreeing on type — a failure mode the book
explicitly warns about for its PostgreSQL solution, where adding an `interval` to
a `date` yields a `timestamp` and breaks the CTE unless you `CAST` it back.

### Quarter boundaries for one given quarter

The inverse problem: given `20263` (four-digit year, one-digit quarter), return
that quarter's start and end. The book's key insight still holds — `yrq % 10`
extracts the quarter and integer-dividing by 10 extracts the year — but the book
routes it through `SUBSTR` and string concatenation to rebuild a date, which is
worth dropping. Every engine now has a "build a date from integer parts"
function, so the whole round-trip through text disappears:

**PostgreSQL** — `make_date(year, month, day)`:

```sql
select yrq,
       q_start,
       (q_start + interval '3 months' - interval '1 day')::date as q_end
  from (
select yrq,
       make_date(yrq / 10, (yrq % 10) * 3 - 2, 1) as q_start
  from (values (20261), (20262), (20263), (20264)) as v(yrq)
       ) x;
```

`yrq / 10` is integer division on an `integer` column, so `20263 / 10` is `2026`,
and `(20263 % 10) * 3 - 2` is `7` — the first month of Q3.

**SQL Server** — `DATEFROMPARTS` plus `EOMONTH`:

```sql
select yrq,
       datefromparts(yrq / 10, (yrq % 10) * 3 - 2, 1)          as q_start,
       eomonth(datefromparts(yrq / 10, (yrq % 10) * 3, 1))     as q_end
  from (values (20261), (20262), (20263), (20264)) as v(yrq);
```

This is strictly better than the book's T-SQL solution, which built the date by
concatenating `'2026' + '-' + '9' + '-1'` and casting the string to `datetime` —
string-to-date casts are sensitive to `SET DATEFORMAT` and the login's language,
so the same query can resolve to a different date on a different connection.
`DATEFROMPARTS` takes integers and has no locale surface at all.

**MySQL** — `MAKEDATE` plus `INTERVAL ... QUARTER`, using `DIV` for integer
division:

```sql
select yrq,
       makedate(yrq div 10, 1) + interval (yrq mod 10 - 1) quarter        as q_start,
       makedate(yrq div 10, 1) + interval (yrq mod 10) quarter
                               - interval 1 day                           as q_end
  from (select 20261 as yrq union all select 20262
        union all select 20263 union all select 20264) x;
```

Note that all three derive `q_end` by adding a full quarter and subtracting one
day, never by hardcoding "31 March / 30 June / 30 September / 31 December." That
matters less for quarters than for months (quarter lengths are fixed apart from
leap years shifting Q1 by a day), but the habit is the point: derive the boundary
from the arithmetic, so leap years and any future calendar edge case handle
themselves.

## Trade-offs

- **Recursion limits are a real ceiling, and both engines that need recursion
  have a low one.** SQL Server's default `MAXRECURSION` is **100** (settable
  `0`–`32767`, where `0` means unlimited); MySQL's `cte_max_recursion_depth`
  defaults to **1000**. The book's recipes generate at most 31 rows, so neither
  limit is visible there — but the moment you widen the same query from a month
  to a year, SQL Server fails outright and rolls the statement back rather than
  returning partial rows.
  ```sql
  -- 365 iterations against a default limit of 100: error, no rows
  with cal (dy) as (
    select cast('2026-01-01' as date)
    union all
    select dateadd(day, 1, dy) from cal where dy < '2026-12-31'
  )
  select count(*) from cal;              -- add: option (maxrecursion 0)
  ```
- **SQL Server 2022's `GENERATE_SERIES` narrows the gap with PostgreSQL but
  doesn't close it.** It is numeric-only — no date overload exists — so every
  date series still goes through a `DATEADD` wrapper over an anchor date, and it
  additionally requires database compatibility level 160 (or the
  `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS` scoped configuration). An upgraded
  instance left at a lower compat level simply reports the function as not found.
- **PostgreSQL's date series silently returns `timestamp`, not `date`.** Passing
  `date` arguments resolves to the `timestamp` overload, so results carry a time
  component; forget the `::date` and you get midnight-stamped timestamps that
  compare and join against a `date` column through an implicit cast on every row.
  The recursive-CTE form has the sharper version of the same problem — `date +
  interval` yields `timestamp`, so the two `UNION ALL` branches disagree on type
  and the CTE fails to build unless the recursive branch is cast back.
  ```sql
  select pg_typeof(d) from generate_series(date '2026-01-01', date '2026-01-02',
                                           interval '1 day') as g(d);
  -- timestamp without time zone
  ```
- **Generating dates on the fly buys convenience and gives up the optimizer's
  help.** A set-returning function or recursive CTE has no statistics, no
  indexes, and a fixed default cardinality estimate, so a large generated series
  joined against a fact table can produce a badly shaped plan. A persisted
  calendar/`dim_date` table is unglamorous but has real statistics, can be
  indexed, and — decisively — has somewhere to put the attributes arithmetic
  cannot derive: public holidays, trading days, a fiscal year that doesn't start
  in January, retail 4-4-5 periods. Derive when the calendar is purely
  arithmetic; materialize the moment business rules enter it.
- **The `YYYYQ` modulo trick is coupled to the input format, with no validation
  built in.** `yrq % 10` and `yrq / 10` are only correct because the year is
  exactly four digits and the quarter exactly one; feed the same expression a
  `YYYYMM` value like `202609` and it computes year 20260, quarter 9, month 25 —
  which errors on some engines and, worse, silently rolls forward into another
  year on others. Nothing in the query rejects a quarter of `0`, `5`, or `9`, so
  a `CHECK` constraint or an explicit guard belongs wherever these keys enter the
  system.
- **The calendar pivot is presentation logic living in SQL, and week numbering
  isn't portable.** `MAX(CASE ...)` grouped by week produces a grid, but each
  engine names the week differently — PostgreSQL's `IW`/`isodow` are ISO-8601
  (Monday-first), MySQL's `WEEKOFYEAR`/`WEEKDAY` follow their own conventions,
  and T-SQL's `datepart(week, ...)` and `DATETRUNC(week, ...)` both bend to the
  session's `@@DATEFIRST`. A grid that renders correctly on one engine can shift
  by a row on another with no error raised.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 9, "Date Manipulation", recipes 9.7, 9.8, 9.9, p. 268-293 — doc
- [PostgreSQL Documentation — Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html) — doc
- [MySQL Reference Manual — WITH (Common Table Expressions), recursive date series and cte_max_recursion_depth](https://dev.mysql.com/doc/refman/8.4/en/with.html) — doc
- [Microsoft Learn — GENERATE_SERIES (Transact-SQL), SQL Server 2022+](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) — doc
