---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Almost every date-based report is built out of four primitives: *is this year a
leap year*, *how many days does this year have*, *what is the year/month/hour
of this timestamp*, and *where does this month start and end*. None of them are
hard, but none of them are portable either — each engine spells them with a
different function, and the shortest correct answer on one vendor is a
three-level nested subquery on another. This concept decomposes a date into
those calendar-aware pieces and shows which of the book's manual techniques
have since been replaced by a dedicated built-in.

## Use Cases

- Validating that a date of birth or effective date doesn't land on February 29
  in a year that has no February 29 — a constructed-date check that behaves
  differently (error vs. `NULL`) on every engine.
- Computing a daily or annualized rate where the denominator is days-in-year:
  365 in most years, 366 in a leap year, and getting it wrong quietly skews
  every interest, accrual, or run-rate figure by ~0.27%.
- Generating month-start and month-end boundaries for a reporting period —
  invoicing cycles, monthly rollups, "as of end of month" snapshots.
- Extracting just the year, month, or hour out of a timestamp to `GROUP BY` it,
  without dragging the full timestamp's precision into the grouping key.
- Bucketing event timestamps into calendar periods (`date_trunc`, `DATETRUNC`)
  so a time series can be aggregated per day/month without string formatting.

## Deep Dive

### Testing for a leap year

The book's technique is elegant and vendor-neutral in spirit: build February
of the target year, ask for its last day, and check whether it's the 29th. The
implementations diverge wildly. Oracle and MySQL get it in one function call;
PostgreSQL, in the book, needs `generate_series` to enumerate February and take
a `MAX`; DB2 needs a recursive `WITH`.

Today, PostgreSQL doesn't need the enumeration — `date_trunc` plus interval
arithmetic gets to the last day of February directly:

```sql
-- PostgreSQL: last day of February for the current year
select extract(day from
         date_trunc('year', current_date) + interval '2 month' - interval '1 day'
       ) = 29 as is_leap_year;
```

MySQL keeps the book's `LAST_DAY()` solution, but without the triple
`DATE_ADD` scaffolding used to reach February 1st:

```sql
-- MySQL
select day(last_day(concat(year(curdate()), '-02-01'))) = 29 as is_leap_year;
```

SQL Server got `EOMONTH()` in 2012 and `DATEFROMPARTS()` in the same release,
which together replace the book's string-concatenation trick entirely:

```sql
-- SQL Server 2012+
select case when day(eomonth(datefromparts(year(getdate()), 2, 1))) = 29
            then 1 else 0 end as is_leap_year;
```

**One correction to the book's SQL Server solution.** The book writes:

```sql
select coalesce(day(cast(concat(year(getdate()), '-02-29') as date)), 28);
```

with the explanation that if the year isn't a leap year, "there is no date
2019-02-29 … it will return NULL." That is not what SQL Server does. A plain
`CAST` of an invalid date string raises `Msg 241, Conversion failed when
converting date and/or time from character string` — the statement fails, and
`COALESCE` never runs. The version that behaves as described needs `TRY_CAST`
(also SQL Server 2012), which is precisely the function that returns `NULL`
instead of erroring on a failed conversion:

```sql
select coalesce(day(try_cast(concat(year(getdate()), '-02-29') as date)), 28);
```

And the genuinely portable version doesn't construct a date at all — it just
does modulo arithmetic on the year, which is the leap-year rule verbatim and
runs unmodified on all three engines:

```sql
-- PostgreSQL / MySQL / SQL Server, unchanged
select (y % 4 = 0 and y % 100 <> 0) or y % 400 = 0 as is_leap_year
  from (select 2100 as y) t;   -- 2100 is NOT a leap year: divisible by 100, not by 400
```

The century rule is the part the "check February" trick gets right for free and
hand-rolled `% 4` checks get wrong — 1900 and 2100 are not leap years, 2000 is.

### Counting the days in a year

The book builds this directly on the leap-year idea: the number of days in a
year is the first day of the next year minus the first day of this one. That
still works everywhere, and on PostgreSQL date subtraction yields an integer
day count directly:

```sql
-- PostgreSQL: date - date returns integer days
select (date_trunc('year', current_date) + interval '1 year')::date
     -  date_trunc('year', current_date)::date as days_in_year;
```

```sql
-- MySQL
select datediff(curr_year + interval 1 year, curr_year) as days_in_year
  from (select makedate(year(curdate()), 1) as curr_year) x;
```

```sql
-- SQL Server
select datediff(day, curr_year, dateadd(year, 1, curr_year)) as days_in_year
  from (select datefromparts(year(getdate()), 1, 1) as curr_year) x;
```

There's a shorter formulation the book doesn't use: December 31st's day-of-year
*is* the number of days in the year, so one extraction answers the question
without any date subtraction:

```sql
select extract(doy from make_date(extract(year from current_date)::int, 12, 31));  -- PostgreSQL
select dayofyear(concat(year(curdate()), '-12-31'));                               -- MySQL
select datepart(dayofyear, datefromparts(year(getdate()), 12, 31));                -- SQL Server
```

Both forms return 365 or 366. Which you prefer is mostly taste; the subtraction
form generalizes to "days between any two anniversaries," the day-of-year form
is a single function call.

### Extracting units of time

The book's own framing here has held up: "most vendors have now adopted the
ANSI standard function for extracting parts of dates, `EXTRACT`, although SQL
Server is an exception." That is still exactly true in 2026 — T-SQL has no
`EXTRACT`, and `DATEPART` remains the way.

```sql
-- PostgreSQL and MySQL: ANSI EXTRACT
select extract(year   from current_timestamp) as yr,
       extract(month  from current_timestamp) as mth,
       extract(day    from current_timestamp) as dy,
       extract(hour   from current_timestamp) as hr,
       extract(minute from current_timestamp) as min,
       extract(second from current_timestamp) as sec;
```

```sql
-- SQL Server: DATEPART, plus the YEAR/MONTH/DAY shorthands
select datepart(year,   getdate()) as yr,
       datepart(month,  getdate()) as mth,
       datepart(day,    getdate()) as dy,
       datepart(hour,   getdate()) as hr,
       datepart(minute, getdate()) as min,
       datepart(second, getdate()) as sec;
```

Two things worth knowing that the book's `TO_CHAR`/`DATE_FORMAT` solutions
sidestep:

**PostgreSQL changed `EXTRACT`'s return type in version 14.** It used to return
`double precision`; it now returns `numeric`, which removes the loss-of-precision
problems that used to hit `extract(epoch from ...)` on large values. The old
behavior is still reachable through `date_part()`, which is the same operation
under an Ingres-era name and still returns `double precision`:

```sql
select pg_typeof(extract(year from current_date));   -- numeric   (PG 14+)
select pg_typeof(date_part('year', current_date));   -- double precision
```

PG 14 also made `EXTRACT` on a `date` *error* for time-only fields rather than
silently returning zero.

**MySQL's `EXTRACT` accepts composite units** that no other engine has —
`YEAR_MONTH`, `DAY_MINUTE`, and friends — which pack multiple fields into a
single number:

```sql
select extract(year_month from '2019-07-02 01:02:03');  -- 201907
select extract(day_minute from '2019-07-02 01:02:03');  -- 20102
```

Convenient, and completely non-portable. The book uses `DATE_FORMAT` for MySQL
(`'%k'`, `'%i'`, `'%s'`, …), which returns *strings*, not numbers — the recipe's
stated goal is "results returned as numbers," and `EXTRACT` delivers that
directly without a wrapping cast.

For grouping, prefer truncation over extraction when you want a period key
rather than a scalar component — `date_trunc` (PostgreSQL) and `DATETRUNC`
(SQL Server 2022+) keep the result a date/timestamp, so it sorts and ranges
correctly:

```sql
select date_trunc('month', order_date) as mth, sum(amount)   -- PostgreSQL
  from orders group by 1 order by 1;

select datetrunc(month, order_date) as mth, sum(amount)      -- SQL Server 2022+
  from orders group by datetrunc(month, order_date) order by 1;
```

Grouping on `extract(year …), extract(month …)` gives you two integer columns
that need reassembling and sort correctly only if you list both in the right
order; a truncated date is one column that already sorts chronologically.

### First and last days of a month

This is where the book's manual arithmetic has aged most. Its SQL Server
solution is the clearest example:

```sql
-- the book's SQL Server last-day-of-month
select dateadd(day,
               -day(dateadd(month, 1, getdate())),
               dateadd(month, 1, getdate())) as lastday;
```

Since SQL Server 2012, that entire expression is one function call, with an
optional month offset built in:

```sql
select eomonth(getdate())      as lastday,      -- end of this month
       eomonth(getdate(), -1)  as prev_lastday, -- end of last month
       eomonth(getdate(),  1)  as next_lastday; -- end of next month
```

And since SQL Server 2022, the first day is `DATETRUNC` rather than the
`DATEADD(day, -DAY(...) + 1, ...)` dance:

```sql
select datetrunc(month, getdate()) as firstday,   -- 2022 (16.x)+
       eomonth(getdate())          as lastday;    -- 2012 (11.x)+
```

MySQL's `LAST_DAY()` is what the book already uses and remains the right answer;
only the first-day half is worth simplifying:

```sql
select curdate() - interval (day(curdate()) - 1) day as firstday,
       last_day(curdate())                           as lastday;
```

PostgreSQL is the outlier: it has **no** last-day-of-month built-in, so the
book's `date_trunc` + `interval '1 month' - interval '1 day'` is still the
idiomatic form, and there is nothing newer to replace it with:

```sql
select firstday,
       (firstday + interval '1 month' - interval '1 day')::date as lastday
  from (select date_trunc('month', current_date)::date as firstday) x;
```

**Use these boundaries as a half-open range, not a `BETWEEN`.** `EOMONTH`
returns a `date` — midnight on the last day — so filtering a `datetime2` column
with `BETWEEN firstday AND eomonth(...)` silently drops every row timestamped
after 00:00:00 on the 31st. The same trap applies to the PostgreSQL and MySQL
last-day values against a `timestamp`/`DATETIME` column:

```sql
-- WRONG for timestamp columns: loses most of the last day
where order_ts between datetrunc(month, @d) and eomonth(@d)

-- RIGHT: half-open interval, no last-day calculation needed at all
where order_ts >= datetrunc(month, @d)
  and order_ts <  dateadd(month, 1, datetrunc(month, @d))
```

Note that the correct version doesn't need a last-day function at all — the
"month boundaries" problem often dissolves into "first day of this month, first
day of next month," which every engine computes with truncation plus one
interval add.

## Trade-offs

- **A dedicated built-in beats the arithmetic, but changes the return type.**
  `EOMONTH()` collapses the book's four-function T-SQL expression into one call,
  and it returns `date` — the time-of-day component of the input is gone.
  Oracle's `LAST_DAY` preserves time of day; SQL Server's `EOMONTH` does not.
  If the surrounding code compares against a `datetime2` column, that difference
  is the difference between a correct filter and a silently truncated one.
  ```sql
  select eomonth(cast('2024-02-05 13:45:00' as datetime2));  -- 2024-02-29 (a date, 00:00:00)
  ```
- **`EXTRACT` is the ANSI spelling and still isn't universal.** PostgreSQL and
  MySQL both implement it; SQL Server has never had it and still doesn't, so any
  query meant to run on all three needs `DATEPART` in the T-SQL branch. The
  book's observation on this point has not gone stale in six years, and there's
  no sign it will.
- **PostgreSQL 14 changed `EXTRACT`'s return type from `double precision` to
  `numeric`.** This is a real behavior change, not a documentation tweak — code
  that fed `extract(epoch from …)` into float-typed columns, or relied on
  floating-point division semantics downstream, behaves differently across the
  upgrade boundary. `date_part()` is the escape hatch that keeps the old type.
  ```sql
  select pg_typeof(extract(epoch from now()));      -- numeric on PG 14+, float8 before
  ```
- **Constructing a date from a string is the fragile half of the leap-year
  trick, and every engine fails it differently.** SQL Server's `CAST` raises
  Msg 241 and aborts the statement; `TRY_CAST` returns `NULL`; MySQL returns
  `NULL` with a warning; PostgreSQL raises a "date field value out of range"
  error. The book's SQL Server recipe assumes the `NULL` behavior from a plain
  `CAST` and is wrong on that point. Prefer `DATEFROMPARTS`/`MAKEDATE`/
  `make_date` when the parts are known-valid, and modulo arithmetic when the
  question is really "is this year a leap year."
- **Month boundaries computed as `first…last` invite a `BETWEEN` bug the
  half-open form can't have.** A last-day value is midnight on that day, so
  `BETWEEN` against any column carrying a time component drops up to 24 hours of
  data with no error and no warning. Computing "first day of next month" instead
  of "last day of this month" is both less code and immune to the problem.
- **Truncation and extraction are not interchangeable for grouping.**
  `EXTRACT` returns a bare number that loses which year a month belongs to
  unless you also group by year; `date_trunc`/`DATETRUNC` returns a real
  date/timestamp that sorts chronologically and joins against a calendar table.
  Reach for extraction when you want a scalar component, truncation when you
  want a period key.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 9, "Date Manipulation", recipes 9.1, 9.2, 9.3, 9.4, p. 240-255 — doc
- [PostgreSQL Documentation — Date/Time Functions and Operators (EXTRACT, date_trunc, make_date)](https://www.postgresql.org/docs/current/functions-datetime.html) — doc
- [MySQL Reference Manual — Date and Time Functions (EXTRACT, LAST_DAY, DAYOFYEAR)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) — doc
- [Microsoft Learn — DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) — doc
- [Microsoft Learn — EOMONTH (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/eomonth-transact-sql) — doc
