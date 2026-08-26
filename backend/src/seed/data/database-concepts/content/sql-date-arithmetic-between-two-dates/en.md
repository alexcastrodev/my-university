---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Date arithmetic has exactly two verbs: **shift** a date by an interval (give me
five days, five months, five years from this date) and **measure** the interval
between two dates at a chosen granularity (how many days, months, years, hours,
seconds apart are these?). Shifting is the easy half — every engine agrees that
adding one month to `2024-03-31` should land on `2024-04-30`, not `2024-05-01`.
Measuring is where the engines genuinely disagree, because "how many months
apart" is not a subtraction: a month is not a fixed number of days, so each
vendor had to pick a rule for partial periods, and they picked different ones.
PostgreSQL returns an exact `interval` and makes you decide how to round it;
MySQL's `TIMESTAMPDIFF` truncates toward zero; SQL Server's `DATEDIFF` counts
**calendar boundaries crossed**, which is neither of the other two and is the
single most common source of off-by-one date bugs in production SQL.

## Use Cases

- Computing a due date, expiry, or retry window N days/months out from a
  known timestamp — invoice terms, subscription renewal, token expiry.
- Calculating someone's age or an employee's tenure in whole years, where
  "has the anniversary actually passed yet?" is the whole question.
- Measuring SLA or turnaround time in hours and minutes between two
  timestamps — ticket opened vs. ticket resolved, order placed vs. shipped.
- Bucketing rows by elapsed time (0-30 days, 31-60, 61+) in an aging report,
  where the bucket boundaries depend on the counting rule you picked.
- Building a "months since signup" cohort column, where a truncating rule
  and a boundary-crossing rule produce different cohorts for the same data.

## Deep Dive

### Adding and subtracting days, months, and years

The book's example takes CLARK's `hiredate` of `09-JUN-2006` and produces six
shifted dates. Every engine can do it; none of them spell it the same way.

**PostgreSQL** — arithmetic operators plus an `interval` literal. Single quotes
around the interval value are required (this is the ISO-standard spelling):

```sql
select hiredate - interval '5 day'   as hd_minus_5d,
       hiredate + interval '5 day'   as hd_plus_5d,
       hiredate - interval '5 month' as hd_minus_5m,
       hiredate + interval '5 month' as hd_plus_5m,
       hiredate - interval '5 year'  as hd_minus_5y,
       hiredate + interval '5 year'  as hd_plus_5y
  from emp
 where deptno = 10;
```

Note a type change the book doesn't dwell on: `date + integer` stays a `date`
(`date '2001-09-28' + 7` → `2001-10-05`), but `date + interval` **promotes to
`timestamp`** (`date '2001-09-28' + interval '1 hour'` → `2001-09-28 01:00:00`).
If a downstream comparison expects a `date`, cast it back.

PostgreSQL 18 added named-function forms, `date_add(timestamptz, interval [, tz])`
and `date_subtract(...)`. The two-argument forms are exactly equivalent to `+`
and `-`; the third argument is the interesting one, because it resolves DST
transitions in a named zone rather than in the session's `TimeZone`:

```sql
-- crosses the Europe/Warsaw DST boundary correctly
select date_add('2021-10-31 00:00:00+02'::timestamptz,
                '1 day'::interval,
                'Europe/Warsaw');   -- 2021-10-31 23:00:00+00, not 22:00
```

**MySQL** — same `INTERVAL` keyword, but the value is **unquoted** for simple
numeric intervals (MySQL deviates from the standard here). Quotes come back for
composite units like `DAY_SECOND`:

```sql
select hiredate - interval 5 day   as hd_minus_5d,
       hiredate + interval 5 month as hd_plus_5m,
       hiredate + interval 5 year  as hd_plus_5y
  from emp
 where deptno = 10;

-- function form, identical semantics
select date_add(hiredate, interval 5 month),
       date_sub(hiredate, interval 5 month)
  from emp;

-- composite interval: quotes required
select date_add('2100-12-31 23:59:59', interval '1 1:1:1' day_second);
```

**SQL Server** — no operators, only `DATEADD(datepart, number, date)`. The
`datepart` is a bare keyword, not a string: `DATEADD('month', 5, hiredate)` is
a syntax error.

```sql
select dateadd(day,   -5, hiredate) as hd_minus_5d,
       dateadd(month, -5, hiredate) as hd_minus_5m,
       dateadd(year,   5, hiredate) as hd_plus_5y
  from emp
 where deptno = 10;
```

The one rule all three share is **end-of-month clamping**. Adding a month
never rolls into the following month:

```sql
-- PostgreSQL
select date '2024-03-31' + interval '1 month';   -- 2024-04-30
-- MySQL
select date_add('2024-03-31', interval 1 month); -- 2024-04-30
-- SQL Server
select dateadd(month, 1, '2024-03-31');          -- 2024-04-30
```

Which means month arithmetic is **not reversible**: `2024-03-31 + 1 month
- 1 month` gives `2024-03-30`, not `2024-03-31`, on every engine. Never
round-trip a date through month addition and expect to land where you started.

### Days between two dates

The book's shape — two inline views pulling WARD's and ALLEN's `hiredate`,
Cartesian-joined because both are guaranteed single-row — is still fine, but
the subtraction itself is where the engines split.

**PostgreSQL** subtracts dates directly and gets back a plain `integer`:

```sql
select ward_hd - allen_hd as days
  from (select hiredate as ward_hd  from emp where ename = 'WARD')  x,
       (select hiredate as allen_hd from emp where ename = 'ALLEN') y;
```

But `date - date` → `integer` only holds for the `date` type. Subtract two
`timestamp`s and you get an `interval`, not a number:

```sql
select timestamp '2001-09-29 03:00' - timestamp '2001-07-27 12:00';
-- interval: 63 days 15:00:00     <- not the integer 63
```

That distinction bites when a column silently changes from `date` to
`timestamp` in a migration: the query keeps parsing, but a comparison like
`... - ... > 30` now compares an interval to an integer and errors, or worse,
a downstream cast changes the rounding.

**MySQL** — `DATEDIFF(expr1, expr2)` returns `expr1 - expr2` in days, and
**uses only the date parts**, discarding the time entirely:

```sql
select datediff('2007-12-31 23:59:59', '2007-12-30');  -- 1
```

One second short of two full days, and it still reports `1`, because it is
counting midnights, not 24-hour periods. Note the argument order is
later-date-first — the opposite of SQL Server's.

**SQL Server** — `DATEDIFF(day, startdate, enddate)`, start date first:

```sql
select datediff(day, allen_hd, ward_hd) as days
  from (select max(case when ename = 'WARD'  then hiredate end) as ward_hd,
               max(case when ename = 'ALLEN' then hiredate end) as allen_hd
          from emp) x;
```

Same midnight-counting behavior: `datediff(day, '2024-01-01 23:59', '2024-01-02 00:01')`
is `1`, for two minutes of elapsed time.

### Months and years between two dates: not a subtraction

The book's own example is the warning: the earliest `hiredate` in `EMP` is
`17-DEC-1980`, the latest `12-JAN-1983`. Subtract the years and you get 3.
The actual distance is about 25 months — a bit over 2 years. Whatever rule you
use has to handle that partial period deliberately.

**SQL Server's `DATEDIFF` counts calendar boundaries crossed, not elapsed
units.** This is the documented behavior, verbatim: "returns the count (as a
signed integer value) of the specified datepart boundaries crossed between the
specified startdate and enddate." Two adjacent instants a tenth of a
microsecond apart return `1` for every single datepart, because they straddle
every boundary at once:

```sql
select datediff(year,  '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
select datediff(month, '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
select datediff(day,   '2005-12-31 23:59:59.9999999', '2006-01-01 00:00:00.0000000'); -- 1
```

Applied to age, this is the classic production bug:

```sql
-- born 2000-06-15, today is 2024-06-14: the birthday has NOT happened yet
select datediff(year, '2000-06-15', '2024-06-14');  -- 24  (WRONG as an age)
```

It returns 24 because 24 January-1st boundaries were crossed. The person is
23. The standard correction subtracts one when the anniversary hasn't landed:

```sql
select datediff(year, @dob, @today)
     - case when dateadd(year, datediff(year, @dob, @today), @dob) > @today
            then 1 else 0 end as age_in_whole_years;
```

**MySQL's `TIMESTAMPDIFF(unit, from, to)` truncates toward zero**, so it gets
age right for free. Watch the argument order: it returns `datetime_expr2 -
datetime_expr1`, the reverse of `DATEDIFF`'s in the same dialect.

```sql
select timestampdiff(year,  '2000-06-15', '2024-06-14');  -- 23  (correct age)
select timestampdiff(month, '1980-12-17', '1983-01-12');  -- 24
select timestampdiff(month, '2003-02-01', '2003-05-01');  -- 3
```

The book predates leaning on this: its DB2/MySQL solution hand-rolls the
calculation from `YEAR()` and `MONTH()` parts, which reproduces SQL Server's
boundary-counting semantics rather than truncation:

```sql
-- book's arithmetic: (1983-1980)*12 + (1 - 12) = 25 -- counts month boundaries
select (year(max_hd) - year(min_hd)) * 12
     + (month(max_hd) - month(min_hd)) as mnth
  from (select min(hiredate) as min_hd, max(hiredate) as max_hd from emp) x;
```

Note the two answers differ: `25` from the boundary formula, `24` from
`TIMESTAMPDIFF`. Neither is wrong — they answer different questions ("how many
month boundaries" vs. "how many whole months elapsed"). Pick one on purpose.

**PostgreSQL has no `months_between`**; it has `age(timestamp, timestamp)`,
which returns a *symbolic* interval decomposed into years, months, and days
rather than a flat day count:

```sql
select age(timestamp '2001-04-10', timestamp '1957-06-13');
-- 43 years 9 mons 27 days
```

From there, extract what you need:

```sql
select extract(year from age(max_hd, min_hd)) * 12
     + extract(month from age(max_hd, min_hd)) as months,
       extract(year from age(max_hd, min_hd))  as whole_years
  from (select min(hiredate) as min_hd, max(hiredate) as max_hd from emp) x;
-- months = 24, whole_years = 2   <- truncating, like TIMESTAMPDIFF
```

`age()` truncates the same way `TIMESTAMPDIFF` does, so `extract(year from
age(dob, now()))` is a correct age with no correction term. One subtlety: the
partial-month component uses the month length of the **earlier** date, so
`age('2004-06-01', '2004-04-30')` is `1 mon 1 day` (April has 30 days), not
`1 mon 2 days`.

### Seconds, minutes, and hours between two dates

The book's approach is "find the days, then multiply by 24, 1440, 86400."
That works only when both values are pure dates with no time component — which
is exactly the assumption its `EMP` table makes, and exactly the assumption
that fails on real timestamp data. Two of the book's own listings in this
recipe are also transcription-damaged: the MySQL solution uses SQL Server's
three-argument `datediff(day, allen_hd, ward_hd)` (MySQL's takes two), and the
SQL Server solution writes a nonexistent four-argument
`datediff(day, allen_hd, ward_hd, hour)`. The correct forms:

**SQL Server** — the unit is the *first* argument, and that's the whole
mechanism; there is no multiplication step:

```sql
select datediff(hour,   allen_hd, ward_hd) as hr,
       datediff(minute, allen_hd, ward_hd) as mi,
       datediff(second, allen_hd, ward_hd) as sec
  from (select max(case when ename = 'WARD'  then hiredate end) as ward_hd,
               max(case when ename = 'ALLEN' then hiredate end) as allen_hd
          from emp) x;
```

Boundary counting applies to sub-day units too: `datediff(hour, '10:59:59',
'11:00:00')` is `1` for one second of elapsed time. And `DATEDIFF` returns an
`int`, which **overflows and raises an error** on long spans — the documented
ceilings are roughly 68 years for `second` and just under 25 days for
`millisecond`. Use `DATEDIFF_BIG` (returns `bigint`) whenever the unit is
`second` or finer and the span isn't tightly bounded:

```sql
select datediff_big(millisecond, '1970-01-01', sysdatetime());
```

**MySQL** — `TIMESTAMPDIFF` again, and unlike `DATEDIFF` it *does* respect the
time component:

```sql
select timestampdiff(hour,   t_open, t_closed) as hr,
       timestampdiff(minute, t_open, t_closed) as mi,
       timestampdiff(second, t_open, t_closed) as sec
  from tickets;

select timestampdiff(minute, '2003-02-01', '2003-05-01 12:05:55');  -- 128885
```

**PostgreSQL** — subtract the timestamps to get an `interval`, then pull total
seconds out with `extract(epoch from ...)` and divide. `epoch` on an interval
is the interval's **total** seconds, so this is exact, not boundary-counted:

```sql
select extract(epoch from (t_closed - t_open))          as sec,
       extract(epoch from (t_closed - t_open)) / 60     as mi,
       extract(epoch from (t_closed - t_open)) / 3600   as hr
  from tickets;
```

That yields fractional hours (`2.5` for two and a half hours), which is usually
what an SLA report actually wants; `floor()` or `trunc()` if you need whole
units. If the columns are `date`, not `timestamp`, subtraction gives an integer
day count instead and the book's `* 24 / * 1440 / * 86400` multiplication is
the right move — cast to `timestamp` first if you want sub-day resolution:

```sql
select extract(epoch from (hiredate2::timestamp - hiredate1::timestamp)) / 3600 as hr;
```

For presentation rather than math, `justify_hours()` and `justify_interval()`
normalize an interval into readable units (`justify_hours(interval '50 hours
10 minutes')` → `2 days 02:10:00`) — useful in output, never in a comparison,
since justification assumes 24-hour days and 30-day months.

## Trade-offs

- **Boundary counting vs. truncation is a semantic choice, not an
  implementation detail.** SQL Server's `DATEDIFF` counts calendar boundaries
  crossed; MySQL's `TIMESTAMPDIFF` and PostgreSQL's `age()` truncate elapsed
  whole units. Porting a query between them by mechanical find-and-replace
  changes the answer, silently, and usually only for rows near a boundary —
  which means it passes every test written with round dates.
  ```sql
  -- same question, two engines, different answers
  -- SQL Server: datediff(year, '2000-06-15', '2024-06-14')      -> 24
  -- MySQL:      timestampdiff(year, '2000-06-15', '2024-06-14') -> 23
  ```
- **"Days between" almost never means 24-hour periods.** MySQL's `DATEDIFF`
  discards time parts outright and SQL Server's `DATEDIFF(day, ...)` counts
  midnights; only PostgreSQL's `timestamp - timestamp` gives you true elapsed
  time, and it hands back an `interval` rather than a number, forcing you to
  say what you meant. Whichever engine you're on, decide explicitly whether
  "3 days" means three midnights or seventy-two hours before writing the
  comparison.
- **Month arithmetic is lossy and non-reversible on every engine.**
  End-of-month clamping is universal and correct, but it means adding then
  subtracting a month doesn't return the original date. Any scheduler that
  advances a recurring date by repeated `+ 1 month` from the *previous*
  computed value will drift a billing date off the 31st permanently; anchor
  each occurrence to the original date instead.
  ```sql
  select date '2024-01-31' + interval '1 month' + interval '1 month';
  -- 2024-03-29, not 2024-03-31
  ```
- **`DATEDIFF`'s `int` return type is a real ceiling, not a theoretical one.**
  Counting `second` between two dates overflows past roughly 68 years and
  `millisecond` past 25 days, and SQL Server raises an error rather than
  wrapping. Any millisecond-granularity duration over an unbounded range needs
  `DATEDIFF_BIG`; PostgreSQL's `extract(epoch from ...)` returns `numeric` and
  has no comparable cliff.
- **The book's "days × 24 × 1440 × 86400" pattern assumes pure `DATE`
  columns.** It's exactly right for the `EMP` table it was written against and
  exactly wrong for `timestamp`/`datetime2` data, where it throws away the time
  component before multiplying. Modern engines all offer a direct
  unit-parameterized function (`DATEDIFF(hour, ...)`, `TIMESTAMPDIFF(HOUR, ...)`,
  `extract(epoch from ...) / 3600`) — reach for those instead of scaling a day
  count by hand.
- **Time zones and DST turn "add one day" into two different answers.**
  Adding `interval '1 day'` to a `timestamptz` across a DST transition shifts
  the wall-clock time; adding `interval '24 hours'` doesn't. PostgreSQL 18's
  `date_add(ts, interval, 'Europe/Warsaw')` exists precisely so you can name
  the zone the adjustment should be resolved in — a distinction the book,
  working in `DATE`-only examples, never has to make.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 8, "Date Arithmetic", recipes 8.1, 8.2, 8.4, 8.5, p. 205-220 — doc
- [PostgreSQL Documentation — Date/Time Functions and Operators (interval arithmetic, age(), EXTRACT, date_add)](https://www.postgresql.org/docs/current/functions-datetime.html) — doc
- [MySQL Reference Manual — Date and Time Functions (DATE_ADD, DATEDIFF, TIMESTAMPDIFF)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) — doc
- [Microsoft Learn — DATEDIFF (Transact-SQL): datepart boundaries crossed](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-transact-sql) — doc
- [Microsoft Learn — DATEADD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/dateadd-transact-sql) — doc
- [Microsoft Learn — DATEDIFF_BIG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-big-transact-sql) — doc
