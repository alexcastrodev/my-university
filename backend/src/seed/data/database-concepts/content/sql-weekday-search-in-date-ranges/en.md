---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Two closely related questions come up constantly once dates enter a schema:
"give me every Friday in 2026" and "give me the first Monday and the last
Friday of this month." The first is a filter over a generated date series;
the second is pure arithmetic off the first and last days of the month. Both
reduce to the same primitive — reliably asking a date "which day of the week
are you?" — and that primitive is, across PostgreSQL, MySQL, and SQL Server,
one of the least portable things in all of SQL. Day 1 is Sunday in some
functions, Monday in others, and in T-SQL it depends on a *session setting*.
Get the numbering wrong and the query returns a perfectly plausible, entirely
wrong set of dates, silently.

## Use Cases

- Scheduling recurring weekly events — materializing every Tuesday for the
  rest of the year to seed a standup calendar, a cleanup job, or a
  reservation grid.
- Computing US-style holiday rules defined as "the Nth weekday of a month":
  Thanksgiving is the fourth Thursday of November, Labor Day the first Monday
  of September, Memorial Day the last Monday of May. None of these are fixed
  dates; all of them are this recipe.
- Payroll and billing cutoffs expressed as "the last Friday of the month" or
  "the second Wednesday" — business calendars almost never use day-of-month
  numbers for these because they'd drift onto weekends.
- Bucketing a report by weekday ("how do Monday orders compare to Friday
  orders?") where the bucket key has to survive being computed on a different
  engine than the one the dashboard was written against.
- Filling calendar gaps: generating a dense date spine so that weeks with no
  activity still appear as zero rows rather than vanishing from a chart.

## Deep Dive

### Every occurrence of a weekday in a year

The book's approach on every vendor is the same: recursively generate all 365
(or 366) days of the year with a `WITH RECURSIVE` clause, then filter down to
the weekday you want. That still works, but on PostgreSQL and SQL Server 2022+
there are now set-returning functions that make the recursion unnecessary.

**PostgreSQL** — `generate_series` accepts timestamps with an `interval` step,
so the date spine is one function call:

```sql
select gs::date as dy
  from generate_series(date '2026-01-01',
                       date '2026-12-31',
                       interval '1 day') as gs
 where extract(isodow from gs) = 5;   -- ISODOW: 1 = Monday ... 7 = Sunday
```

Better still: don't generate 365 rows to throw 313 of them away. Land on the
first Friday, then step by seven days:

```sql
select gs::date as dy
  from generate_series(
         -- first Friday on or after Jan 1
         date '2026-01-01'
           + ((5 - extract(isodow from date '2026-01-01')::int + 7) % 7),
         date '2026-12-31',
         interval '7 days') as gs;
```

2026-01-01 is a Thursday (`ISODOW` 4), so the offset is `(5 - 4 + 7) % 7 = 1`
and the series starts on 2026-01-02 — the first Friday of the year. That
`(target - current + 7) % 7` expression is the whole recipe in one line, and
it reappears verbatim in the month version below.

**MySQL** — no `generate_series`, so the recursive CTE from the book is still
the idiomatic answer (MySQL 8.0+):

```sql
with recursive cal (dy) as (
  select date '2026-01-01'
  union all
  select dy + interval 1 day from cal where dy < date '2026-12-31'
)
select dy from cal where weekday(dy) = 4;   -- WEEKDAY: 0 = Monday ... 6 = Sunday
```

365 recursion levels fits under `cte_max_recursion_depth`, whose default is
**1000** — but a multi-year spine does not, and MySQL terminates the CTE
rather than returning a truncated result. Raise it per session when the range
is wider than about three years:

```sql
set session cte_max_recursion_depth = 10000;
```

**SQL Server** — 2022 (16.x) added `GENERATE_SERIES`, but it only produces
**numbers**, not dates (`tinyint` through `numeric`; there is no date
overload). The date spine is a numeric series fed into `DATEADD`:

```sql
declare @start date = '20260101', @end date = '20261231';

select dateadd(day, value, @start) as dy
  from generate_series(0, datediff(day, @start, @end))
 where datediff(day, '19000101', dateadd(day, value, @start)) % 7 = 4;
```

`GENERATE_SERIES` requires database compatibility level 160 or higher. On
anything older, the book's recursive CTE still applies — and note it needs
`option (maxrecursion 400)`, because T-SQL's default recursion limit is 100
and 365 iterations blows straight through it with error 530.

That `datediff(day, '19000101', d) % 7` in the filter is not an arbitrary
trick: 1900-01-01 is SQL Server's day zero *and* a Monday, so counting days
from it modulo 7 yields a Monday-based 0–6 weekday that no session setting can
perturb. Which brings us to the gotcha.

### Gotcha: every vendor numbers weekdays differently, and MySQL disagrees with itself

This is not a footnote. Here is what each function returns for the *same*
Friday:

| Expression | Sun | Mon | Tue | Wed | Thu | **Fri** | Sat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL `extract(dow from d)` | 0 | 1 | 2 | 3 | 4 | **5** | 6 |
| PostgreSQL `extract(isodow from d)` | 7 | 1 | 2 | 3 | 4 | **5** | 6 |
| PostgreSQL `to_char(d, 'D')` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| MySQL `dayofweek(d)` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| MySQL `weekday(d)` | 6 | 0 | 1 | 2 | 3 | **4** | 5 |
| SQL Server `datepart(weekday, d)`, `@@DATEFIRST = 7` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| SQL Server `datepart(weekday, d)`, `@@DATEFIRST = 1` | 7 | 1 | 2 | 3 | 4 | **5** | 6 |

Five distinct integers mean "Friday" depending on which line you're on. Three
things make this worse than a lookup-table problem:

**1. PostgreSQL's own two conventions disagree, and the book gets caught by
it.** `EXTRACT` and `to_char` use different numbering — the PostgreSQL manual
says so outright: *"Note that extract's day of the week numbering differs from
that of the to_char(..., 'D') function."* Recipe 9.5's PostgreSQL solution
filters on `cast(extract(dow from dy) as integer) = 6` and describes the
result as Fridays, but `DOW` 6 is **Saturday** — the `= 6` comes from
`to_char`'s numbering while the code calls `EXTRACT`. (Recipe 9.6's PostgreSQL
solution, one page later, correctly uses `to_char(dy,'d')` with Monday as 2.)
The query runs, returns 52 rows, and every single one is the wrong day. That
is precisely the failure mode this whole section is about: nothing errors.

```sql
-- book's 9.5 filter — returns Saturdays, not Fridays
select gs::date from generate_series(date '2026-01-01', date '2026-12-31',
                                     interval '1 day') gs
 where extract(dow from gs) = 6;   -- 6 = Saturday under DOW

-- what was meant
 where extract(dow from gs) = 5;   -- or: extract(isodow from gs) = 5
```

**2. MySQL's two weekday functions don't agree with each other.**
`DAYOFWEEK()` returns *"1 = Sunday, 2 = Monday, …, 7 = Saturday"* — the ODBC
convention. `WEEKDAY()` returns *"0 = Monday, 1 = Tuesday, … 6 = Sunday."*
Same engine, same table, adjacent lines in the manual, different zero point
*and* a different base:

```sql
select dayofweek('2026-01-02'),   -- 6
       weekday('2026-01-02');     -- 4   -- both are Friday
```

Any code that mixes the two — or that was copy-pasted from a snippet using the
other one — is off by exactly two days' worth of numbering with no diagnostic.

**3. SQL Server's answer depends on session state, not on the date.**
`DATEPART(weekday, …)` is documented as depending on `SET DATEFIRST`, and its
return value additionally *"depends on the language environment set by using
SET LANGUAGE, and by the … default language … of the login."* The default is
7 (Sunday first) for `us_english`; most European language settings default to
1 (Monday first). So the identical query returns different integers for two
users connected to the same database:

```sql
set datefirst 7;  select datepart(weekday, '20260102');  -- 6 (Friday)
set datefirst 1;  select datepart(weekday, '20260102');  -- 5 (Friday)
```

The fix is to normalize rather than to trust the raw value. Either anchor to a
known Monday, or fold `@@DATEFIRST` back out of the result to get an ISO
1–7 weekday:

```sql
-- ISO weekday (1 = Monday ... 7 = Sunday), immune to DATEFIRST
select ((@@datefirst + datepart(weekday, d) - 2) % 7) + 1 as iso_dow from t;

-- or the anchor form: 0 = Monday ... 6 = Sunday, no session state at all
select datediff(day, '19000101', d) % 7 as mon_dow from t;
```

Note also that `SET DATEFIRST` is session-scoped like every `SET` statement,
so a connection pool that hands out a session where some earlier code ran
`SET DATEFIRST 1` will quietly change the meaning of a hardcoded `= 6`.
Microsoft's own carve-out is telling: `DATEDIFF` deliberately ignores
`DATEFIRST` and always treats Sunday as the first day of the week
*"to ensure the function is deterministic."* `DATEPART(weekday, …)` gets no
such guarantee.

### First and last occurrence of a weekday in a month

Once the numbering is nailed down, this recipe needs no recursion at all — the
book's DB2 and SQL Server solutions generate every day of the month and take
`MIN`/`MAX` of the flagged rows, but that's a workaround for missing date
functions rather than a necessity today. Two facts do all the work:

- The first *target-weekday* on or after the 1st of the month is
  `first_day + ((target - dow(first_day) + 7) % 7)`.
- The last one is `last_day - ((dow(last_day) - target + 7) % 7)`.

Both use the same modulo-7 "distance to the next/previous weekday" the year
version used. The `+ 7` before the `%` keeps the operand non-negative, which
matters because `%` on negative integers is implementation-defined territory
in MySQL and T-SQL alike.

**PostgreSQL:**

```sql
with bounds as (
  select date_trunc('month', date '2026-08-05')::date as first_day,
         (date_trunc('month', date '2026-08-05')
            + interval '1 month - 1 day')::date        as last_day
)
select first_day + ((1 - extract(isodow from first_day)::int + 7) % 7) as first_monday,
       last_day  - ((extract(isodow from last_day)::int - 5 + 7) % 7)  as last_friday
  from bounds;
--  first_monday | last_friday
-- --------------+-------------
--  2026-08-03   | 2026-08-28
```

August 2026 starts on a Saturday (`ISODOW` 6), so `(1 - 6 + 7) % 7 = 2` puts
the first Monday on the 3rd; it ends on a Monday (`ISODOW` 1), so
`(1 - 5 + 7) % 7 = 3` walks back to Friday the 28th.

**MySQL** — `LAST_DAY()` supplies the month's end directly, and `WEEKDAY()`'s
Monday-zero numbering means the target for Monday is literally `0`:

```sql
select first_day + interval ((0 - weekday(first_day) + 7) % 7) day  as first_monday,
       last_day  - interval ((weekday(last_day) - 4 + 7) % 7) day   as last_friday
  from (select date_sub(date '2026-08-05',
                        interval dayofmonth(date '2026-08-05') - 1 day) as first_day,
               last_day(date '2026-08-05')                             as last_day) b;
```

Compare this with the book's MySQL solution, which nests a `CASE
sign(dayofweek(dy)-2)` three ways to emulate a missing "next day" function.
The modulo form collapses all three branches into one expression — the `% 7`
*is* the sign analysis.

**SQL Server** — `EOMONTH` (2012+) replaces the last-day arithmetic, and
`DATEFROMPARTS` the first-day arithmetic; SQL Server 2022 can use
`DATETRUNC(month, @d)` for the latter. Weekday numbering comes from the
DATEFIRST-immune anchor so nothing depends on session language:

```sql
declare @d date = '2026-08-05';
declare @fd date = datefromparts(year(@d), month(@d), 1);  -- or datetrunc(month, @d)
declare @ld date = eomonth(@d);

select dateadd(day,  (0 - datediff(day, '19000101', @fd) % 7 + 7) % 7, @fd) as first_monday,
       dateadd(day, -((datediff(day, '19000101', @ld) % 7 - 4 + 7) % 7),  @ld) as last_friday;
-- first_monday = 2026-08-03, last_friday = 2026-08-28
```

**Nth weekday, and why holiday rules fall out for free.** The book notes that
adding 7 or 14 days to the first occurrence gives the second and third. That
generalizes: the Nth target weekday of a month is
`first_occurrence + 7 * (n - 1)`. US holiday rules are then one-liners:

```sql
-- US Thanksgiving 2026: fourth Thursday of November
select (dt + ((4 - extract(isodow from dt)::int + 7) % 7) + 7 * (4 - 1))::date
  from (select date '2026-11-01' as dt) t;
-- 2026-11-26

-- US Labor Day 2026: first Monday of September
select (dt + ((1 - extract(isodow from dt)::int + 7) % 7))::date
  from (select date '2026-09-01' as dt) t;
-- 2026-09-07
```

The one caveat: "Nth" and "last" are not interchangeable. Memorial Day is the
*last* Monday of May, not the fourth — May 2026 has five Mondays, so
`first_monday + 21` gives the 25th only by coincidence of that year's layout,
while `last_day - ((dow(last_day) - 1 + 7) % 7)` is correct every year. Any
month can hold four or five of a given weekday; compute "last" from the end of
the month, never as "the fourth."

## Trade-offs

- **The weekday-numbering trap is the single largest risk in this recipe, and
  it fails silently.** A wrong integer constant doesn't raise an error — it
  returns the right *count* of rows on the wrong day, which survives code
  review, unit tests that only check row counts, and often production until
  someone notices the "Friday" report landing on Saturday. The book's own
  PostgreSQL 9.5 solution demonstrates exactly this: `extract(dow ...) = 6`
  where `5` was meant. Prefer conventions that are self-documenting
  (`ISODOW`, or a normalized expression) over bare magic numbers, and never
  copy a weekday constant between engines.
  ```sql
  -- same weekday, five different "correct" constants
  extract(dow   from d) = 5   -- PostgreSQL
  extract(isodow from d) = 5  -- PostgreSQL, ISO
  dayofweek(d) = 6            -- MySQL
  weekday(d)   = 4            -- MySQL, same engine, different answer
  datepart(weekday, d) = 6    -- SQL Server, only while @@DATEFIRST = 7
  ```
- **Session-dependent weekday values make T-SQL queries non-portable across
  *connections*, not just across vendors.** `DATEPART(weekday, …)` reads
  `@@DATEFIRST`, which is session-scoped and derived from the login's default
  language; a pooled connection that inherited `SET DATEFIRST 1` changes the
  meaning of a hardcoded constant with no signal. Normalizing via
  `((@@datefirst + datepart(weekday, d) - 2) % 7) + 1`, or sidestepping the
  setting entirely with `datediff(day, '19000101', d) % 7`, costs one extra
  expression and removes an entire class of environment-dependent bug.
- **Generating a full date spine and filtering is simpler to read but does
  ~7× the work of stepping by seven days.** `generate_series(..., interval '1
  day')` plus a `WHERE` on the weekday materializes 365 rows to keep 52; the
  offset-then-step-by-7 form materializes exactly 52. For a one-off query the
  difference is noise, but inside a correlated subquery, a view joined per
  row, or a multi-year range, it stops being noise — and on MySQL the dense
  form additionally has to stay under `cte_max_recursion_depth` (default
  1000), which a spine longer than about three years exceeds.
- **Recursive-CTE date generation carries per-engine recursion limits that the
  book's solutions have to work around explicitly.** SQL Server's default
  `MAXRECURSION` is 100, so the book's own 9.5 solution ends with `option
  (maxrecursion 400)` — omit it and a full-year spine dies with error 530
  partway through. MySQL's `cte_max_recursion_depth` is a system variable, not
  a query hint, so the workaround has to be a separate `SET SESSION` statement
  the application must remember to issue. These are real operational
  differences, not stylistic ones.
- **"Last occurrence" and "Nth occurrence" are different computations and must
  not be conflated.** A month contains four or five of any given weekday
  depending on its length and start day, so the last Monday is sometimes the
  fourth and sometimes the fifth. The book's `first_monday + 28 or + 21`
  `CASE` handles this by checking whether +28 overflows the month; computing
  from `LAST_DAY`/`EOMONTH` backwards is shorter, has no branch, and is
  correct by construction. Reserve `first + 7 * (n - 1)` for rules genuinely
  phrased as "the Nth" (Thanksgiving), and end-of-month arithmetic for rules
  phrased as "the last" (Memorial Day, month-end payroll cutoffs).
- **Modern date functions have eliminated most of the book's scaffolding, but
  not uniformly.** PostgreSQL's `generate_series` over timestamps, SQL
  Server's `EOMONTH`/`DATEFROMPARTS`/`DATETRUNC`, and MySQL's `LAST_DAY` each
  replace several lines of the 2020 solutions — yet SQL Server's
  `GENERATE_SERIES` is numeric-only and needs compatibility level 160, and
  MySQL still has no series generator at all. The techniques converge on a
  shared mental model (find a boundary, apply modulo-7 arithmetic) while the
  syntax stubbornly doesn't.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 9, "Date Manipulation", recipes 9.5, 9.6, p. 255-268 — doc
- [PostgreSQL Documentation — Date/Time Functions and Operators (EXTRACT: dow, isodow)](https://www.postgresql.org/docs/current/functions-datetime.html) — doc
- [MySQL Reference Manual — Date and Time Functions (DAYOFWEEK, WEEKDAY)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) — doc
- [Microsoft Learn — DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) — doc
- [Microsoft Learn — SET DATEFIRST (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql) — doc
