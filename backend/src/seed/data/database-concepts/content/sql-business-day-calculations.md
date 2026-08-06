---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Two related questions turn out to be the same problem wearing different hats:
"how many working days are there between these two dates?" and "how many
Mondays fall in this year?" Both are a *count of days matching a predicate
within a date range*, and both need the same missing ingredient — a way to
produce one row per calendar day between a start and an end, so the predicate
has something to filter. Neither `DATEDIFF` nor any date-subtraction operator
gives you that; they collapse a range to a single number and throw away the
individual days. The book solves it with a physical pivot table (`T500`, 500
rows of integers) joined against the date range; modern engines can generate
the rows on the fly, but each one does it differently, and SQL Server layers a
locale-dependent weekday-numbering trap on top.

## Use Cases

- SLA and turnaround calculations: "this ticket is due five business days from
  when it was opened" or "how many working days did this order actually take",
  where Saturday and Sunday must not count against the clock.
- Payroll, timesheet, and scheduling reports that need the number of working
  days in a pay period or month, typically excluding both weekends and a
  company holiday list.
- Staffing and capacity reports that count occurrences of one specific weekday
  — how many Saturdays fall in Q3, how many Mondays a store is open this year
  — where the answer varies between 52 and 53 depending on the year and the
  weekday.
- Sanity-checking a date dimension or calendar table before a BI load: an
  independently computed weekday tally per year is a cheap way to prove the
  dimension has no missing or duplicated days.

## Deep Dive

### Business days between two dates

The book's shape is two steps: build one row per day in the range, then `SUM` a
`CASE` that scores each day 1 or 0. The row source is table `T500` — a pivot
table holding the integers 1 through 500 — joined without a predicate so its
`ID` column becomes an offset added to the earlier date:

```sql
-- book's PostgreSQL solution, business days between JONES and BLAKE hiredates
select sum(case when trim(to_char(jones_hd+t500.id-1,'DAY'))
                  in ( 'SATURDAY','SUNDAY' )
                then 0 else 1
           end) as days
  from (
select max(case when ename = 'BLAKE' then hiredate end) as blake_hd,
       max(case when ename = 'JONES' then hiredate end) as jones_hd
  from emp
 where ename in ( 'BLAKE','JONES' )
       ) x,
       t500
 where t500.id <= blake_hd-jones_hd+1;
```

Two details in there are easy to skim past. The `MAX` in the inline view is not
an aggregate in any meaningful sense — it exists purely to collapse the two
rows (`BLAKE` with a `NULL` `jones_hd`, `JONES` with a `NULL` `blake_hd`) into
one row with both dates populated, which is what lets the outer query subtract
them. And the `+1`/`-1` pair is the inclusivity fix: `T500.ID` starts at 1, so
the offset must be `id-1` for the range to include the start date, and the
bound must be `blake_hd-jones_hd+1` for it to include the end date. With
JONES hired 2006-04-02 (a Sunday) and BLAKE 2006-05-01 (a Monday), that's 30
calendar days, 9 of them weekend days, so **21** business days.

Today, PostgreSQL generates the rows itself and expresses the weekend test as
day-of-week arithmetic rather than string matching:

```sql
-- PostgreSQL: generate_series as the row source, isodow as the predicate
select count(*) as business_days
  from (
select max(hiredate) filter (where ename = 'BLAKE') as blake_hd,
       max(hiredate) filter (where ename = 'JONES') as jones_hd
  from emp
 where ename in ('BLAKE','JONES')
       ) x
 cross join lateral generate_series(x.jones_hd, x.blake_hd, interval '1 day') as d
 where extract(isodow from d) < 6;   -- 1=Mon .. 7=Sun, so 6 and 7 are the weekend
```

`generate_series` has **no native `date` variant** — the documented signatures
are integer, bigint, numeric, `timestamp`, and `timestamptz`. Passing two dates
resolves to the `timestamp` overload via implicit cast, so `d` comes back as a
`timestamp`; add `::date` if the consumer needs a real date. `isodow` is the
right extract field here because it numbers Monday 1 through Sunday 7, making
"weekend" a single `>= 6` test. Plain `dow` numbers Sunday 0 through Saturday
6, and the docs warn explicitly that `to_char(..., 'D')`'s numbering matches
*neither* — it runs Sunday 1 to Saturday 7. Only `to_char(..., 'ID')` lines up
with `extract(isodow ...)`.

MySQL has no `generate_series` at all, so the row source is a recursive CTE
(available since 8.0):

```sql
-- MySQL 8.0+: recursive CTE as the row source
with recursive cal (d, stop_at) as (
  select date '2006-04-02', date '2006-05-01'
  union all
  select d + interval 1 day, stop_at from cal where d + interval 1 day <= stop_at
)
select count(*) as business_days
  from cal
 where weekday(d) < 5;   -- WEEKDAY: 0=Mon .. 6=Sun
```

Prefer `WEEKDAY()` over `DAYNAME()` here. `WEEKDAY()` returns a fixed
0-is-Monday index that no session setting can move; `DAYNAME()` returns a
string whose language is controlled by the `lc_time_names` system variable, so
the book's `date_format(..., '%a') in ('Sat','Sun')` test silently stops
matching anything the moment the server runs under a non-English locale.
`DAYOFWEEK()` is a third numbering — 1 for Sunday through 7 for Saturday,
following the ODBC convention — so all three MySQL weekday functions disagree
with each other by design. Also note `cte_max_recursion_depth`, which
"[b]y default [...] has a value of 1000, causing the CTE to terminate when it
recurses past 1000 levels" — fine for a few years of days, a hard stop for a
decade.

SQL Server gained a `GENERATE_SERIES` in 2022 (16.x), but it is **numeric
only** — `tinyint` through `numeric`, no date type — so it feeds `DATEADD`
rather than emitting dates directly. It also "requires the compatibility level
to be at least 160", which is a real deployment gotcha on databases upgraded
in place from an older version:

```sql
-- SQL Server 2022+ (compat level 160): numeric series + DATEADD
declare @s date = '2006-04-02', @e date = '2006-05-01';

select count(*) as business_days
  from generate_series(0, datediff(day, @s, @e)) as gs
 cross apply (select dateadd(day, gs.value, @s) as d) x
 where datediff(day, '19000101', x.d) % 7 < 5;   -- 1900-01-01 was a Monday
```

Pre-2022 (and the book's own solution) it is a recursive CTE instead, which
needs `OPTION (MAXRECURSION 366)` because "[t]he server-wide default is 100" —
enough for a three-month range, silently fatal for a year.

The weekend predicate above deliberately avoids `DATEPART(weekday, ...)`. See
the next section for why.

Excluding holidays doesn't change the structure at all; it adds an anti-join
against a `holidays` table, which is the whole reason the book suggests
creating one:

```sql
select count(*) as business_days
  from generate_series('2006-04-02'::date, '2006-05-01'::date, interval '1 day') as d
 where extract(isodow from d) < 6
   and not exists (select 1 from holidays h where h.holiday_date = d::date);
```

Finally, if the range is huge and you only need weekends excluded (no
holidays), you can skip the row source entirely. In T-SQL the idiomatic
closed form is:

```sql
declare @s date = '2006-04-02', @e date = '2006-05-01';

select (datediff(day, @s, @e) + 1)
     - (datediff(week, @s, @e) * 2)
     - (case when datename(weekday, @s) = 'Sunday'   then 1 else 0 end)
     - (case when datename(weekday, @e) = 'Saturday' then 1 else 0 end);  -- 21
```

This works because of a documented guarantee that is easy to miss: "Specifying
SET DATEFIRST has no effect on DATEDIFF. DATEDIFF always uses Sunday as the
first day of the week to ensure the function is deterministic." `DATEDIFF(week,
...)` therefore counts Saturday-to-Sunday boundaries no matter what the session
is set to — it is the one weekday-aware T-SQL function immune to the problem
described next. The two `DATENAME` corrections, however, are not immune: they
are string comparisons against a localized name and should be rewritten as
`DATEDIFF(day, '19000101', @s) % 7` tests before shipping to a multi-language
server.

### Counting weekday occurrences in a year

Same machinery, different `GROUP BY`. Generate every day in the year, resolve
each to a weekday, tally:

```sql
-- PostgreSQL: how many of each weekday in the current year
select to_char(d, 'FMDay') as weekday, count(*)
  from generate_series(date_trunc('year', current_date),
                       date_trunc('year', current_date) + interval '1 year' - interval '1 day',
                       interval '1 day') as d
 group by 1, extract(isodow from d)
 order by extract(isodow from d);
```

`FM` matters. Without it, `'Day'` and `'DAY'` are "blank-padded to 9 chars", so
`'Monday   '` and `'Friday   '` come back with trailing spaces — which is
exactly why the book wraps its `to_char(..., 'DAY')` in `trim()`. `FM`
"suppresses leading zeroes and trailing blanks", doing the same job inside the
format string. Grouping by `extract(isodow from d)` alongside the label keeps
the output in weekday order instead of alphabetical, and would keep working if
someone switched the label to `TM`-prefixed localized names.

MySQL, again, recurses:

```sql
with recursive cal (d) as (
  select makedate(year(curdate()), 1)
  union all
  select d + interval 1 day from cal
   where year(d + interval 1 day) = year(curdate())
)
select weekday(d) as dow_mon0, dayname(d) as weekday, count(*)
  from cal
 group by weekday(d), dayname(d)
 order by weekday(d);
```

And SQL Server, either with `GENERATE_SERIES` on 2022+ or the book's recursive
CTE with an explicit `MAXRECURSION` bump:

```sql
-- SQL Server 2022+
declare @jan1 date = datefromparts(year(getdate()), 1, 1);

select datename(weekday, dateadd(day, gs.value, @jan1)) as weekday,
       count(*)
  from generate_series(0, datediff(day, @jan1, dateadd(year, 1, @jan1)) - 1) as gs
 group by datename(weekday, dateadd(day, gs.value, @jan1))
 order by min(datediff(day, '19000101', dateadd(day, gs.value, @jan1)) % 7);
```

For 2026 that returns 53 Thursdays and 52 of everything else — 2026 starts on a
Thursday and is not a leap year, so exactly one weekday gets the 53rd slot. A
leap year starting on a weekend gets two weekdays with 53.

**The `@@DATEFIRST` trap.** `DATEPART(weekday, ...)` — the `dw` datepart the
book uses — is not a fixed numbering. The documentation is unambiguous: "For a
**week** (**wk**, **ww**) or **weekday** (**dw**) *datepart*, the `DATEPART`
return value depends on the value set by SET DATEFIRST." The same date returns
seven different weekday numbers depending on the session:

```sql
-- 1999-01-01 was a Friday
set datefirst 7;  select datepart(dw, '1999-01-01');  -- 6  (Sunday-first, US English default)
set datefirst 1;  select datepart(dw, '1999-01-01');  -- 5  (Monday-first, ISO)
set datefirst 3;  select datepart(dw, '1999-01-01');  -- 3  (Wednesday-first)
```

`SET DATEFIRST` defaults to `7` (Sunday) for U.S. English, but the effective
default comes from the login's language — so `where datepart(dw, order_date)
in (1, 7)` is code that means "weekend" on your laptop and something else on a
server whose default language is set differently. Read the current value with
`@@DATEFIRST` if you need to know. `DATENAME(weekday, ...)` sidesteps the
numbering but swaps in a worse problem: its return value "depends on the
language environment set by using SET LANGUAGE", so it emits `'Samstag'` or
`'sábado'` under a non-English login and every string comparison against
`'Saturday'` quietly returns zero rows.

The portable fix is to anchor the arithmetic to a known date instead of trusting
session state — `DATEDIFF(day, '19000101', d) % 7` yields 0 for Monday through 6
for Sunday on every SQL Server on earth, because 1900-01-01 was a Monday and
`DATEDIFF` is contractually deterministic:

```sql
select case datediff(day, '19000101', order_date) % 7
         when 5 then 'Saturday' when 6 then 'Sunday' else 'Weekday'
       end
  from orders;
```

**Counting one specific weekday without generating any rows.** If the question
is only "how many Saturdays fall in this quarter", the answer is closed-form
arithmetic over the range length and the start day's ISO number:

```sql
-- PostgreSQL: occurrences of ISO weekday :k (1=Mon .. 7=Sun) in [:s, :e]
select (( :e::date - :s::date ) + 1) / 7
     + case when (( :e::date - :s::date ) + 1) % 7
               > (7 + :k - extract(isodow from :s::date)::int) % 7
            then 1 else 0
       end;
-- s = 2026-07-01, e = 2026-09-30, k = 6  ->  13 Saturdays
```

Integer division gives the whole weeks (each contributing exactly one of every
weekday); the `CASE` decides whether the leftover partial week reaches the
target day. It is O(1) instead of O(days) — and completely opaque compared to a
`generate_series` with a `WHERE` clause, which is the trade-off.

## Trade-offs

- **Row generation is readable and holiday-capable; closed-form arithmetic is
  fast and inflexible.** Enumerating every day costs one row per day, which is
  irrelevant for a quarter and real for a ten-year range evaluated per row of a
  million-row table. The arithmetic forms are O(1) and easily an order of
  magnitude faster in that shape — but they can only express "weekends", not
  "weekends and the twelve dates in our holidays table", because there is no
  formula for an arbitrary list of exceptions.
- **Holidays are why calendar/date-dimension tables refuse to die.** Every
  vendor now has a way to conjure days out of nothing, which removes the
  book's original justification for `T500`. It does not remove the case for a
  real calendar table: once the definition of "business day" includes company
  holidays, regional variations, or half-days, the exception list has to be
  stored somewhere, and at that point joining against a table that already
  carries an `is_business_day` flag beats regenerating and re-filtering the
  range on every query.
- **On SQL Server, weekday numbering is session state, not a constant.**
  `DATEPART(weekday, ...)` shifts with `SET DATEFIRST` and `DATENAME(weekday,
  ...)` shifts with `SET LANGUAGE`, so the natural way to write the predicate is
  also the way that breaks when the code runs under a different login,
  connection pool, or linked server. Anchoring to `DATEDIFF(day, '19000101',
  d) % 7` is uglier and correct everywhere; PostgreSQL's `isodow` and MySQL's
  `WEEKDAY()` are fixed by definition and need no such defense.
- **The row source is still the least portable part of the query.** PostgreSQL
  has `generate_series` (but no `date` overload — it resolves to `timestamp`);
  SQL Server 2022+ has `GENERATE_SERIES` but numeric-only and gated behind
  compatibility level 160, so anything older falls back to a recursive CTE with
  `OPTION (MAXRECURSION n)` because the server-wide default of 100 truncates a
  year without warning; MySQL has only the recursive CTE, capped by
  `cte_max_recursion_depth` at 1000. The `WHERE`/`GROUP BY` half of these
  queries ports cleanly between engines; the `FROM` half never does.
- **Silent truncation is the failure mode to fear, not an error.** The book's
  `T500` caps any range at 500 days, SQL Server's default `MAXRECURSION` caps
  it at 100, and MySQL's caps it at 1000. Two of those three produce a *smaller
  wrong number* rather than an exception (`MAXRECURSION` does raise error 530),
  so a business-day count that quietly stops growing past some range length is
  the bug to watch for when a report that was right for months suddenly isn't.
- **Inclusive-vs-exclusive endpoints deserve a written-down decision.** The
  `+1`/`-1` dance in the book's `WHERE t500.id <= blake_hd-jones_hd+1` exists
  solely to make both endpoints count, and every rewrite of these queries has
  to re-derive it. `DATEDIFF` and date subtraction are both exclusive of one
  end; `generate_series` with matching bounds is inclusive of both. Nothing in
  the SQL will remind you which convention the SLA actually meant.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 8, "Date Arithmetic", recipes 8.3, 8.6, p. 210-215, 220-231 — doc
- [PostgreSQL Documentation — Date/Time Functions and Operators (`extract`, `dow` vs `isodow`)](https://www.postgresql.org/docs/current/functions-datetime.html) — doc
- [PostgreSQL Documentation — Set Returning Functions (`generate_series`)](https://www.postgresql.org/docs/current/functions-srf.html) — doc
- [MySQL Reference Manual — Date and Time Functions (`WEEKDAY`, `DAYOFWEEK`, `DAYNAME`)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html) — doc
- [Microsoft Learn — SET DATEFIRST (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql) — doc
- [Microsoft Learn — DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql) — doc
- [Microsoft Learn — GENERATE_SERIES (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) — doc
