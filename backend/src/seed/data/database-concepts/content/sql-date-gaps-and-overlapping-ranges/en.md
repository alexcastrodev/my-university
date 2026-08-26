---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Three questions that look unrelated turn out to be the same shape of problem:
how long until the *next* event in a sequence, which dates are *missing* from
a sequence that should be continuous, and which rows' date ranges *overlap*
each other. All three stop treating a date as a single point and start
treating it as one end of an interval — the gap between this row and the
next, the hole between two rows that should be adjacent, the collision
between two spans that should be disjoint. Answering them needs the same
three tools every time: a window function to reach the neighbouring row, a
generated calendar to supply the rows the data doesn't have, and a
range-comparison predicate to decide whether two intervals touch. This is
the date-flavoured warm-up for the general gaps-and-islands technique — the
same reasoning applied to any ordered value, not just dates — covered
elsewhere in this collection.

## Use Cases

- Measuring the gap between consecutive events per entity: days between a
  customer's orders, hours between two sensor readings, weeks between an
  employee's hire date and the next hire in the company.
- Filling in a report so every day, week, or month shows a row even when no
  data exists for that period — a `COUNT` of zero has to come from a
  generated calendar, because a `GROUP BY` over the fact table can only
  produce rows for periods that already have data.
- Detecting scheduling conflicts: double-booked meeting rooms, overlapping
  employee shifts, a project that starts before the previous one finishes,
  two rate cards that claim the same effective-date window.
- Validating imported interval data before it reaches production — finding
  rows whose validity periods collide with an existing row's.
- Building "days since last activity" or "time to next renewal" columns
  without a correlated subquery per row.

## Deep Dive

### The gap to the next record: `LEAD` over an ordered window

The book's recipe 8.7 asks: for every employee in `DEPTNO 10`, how many days
passed between their hire date and the *next* hire in the company (any
department)? Before window functions this needed a correlated scalar
subquery — "the smallest `HIREDATE` greater than mine". `LEAD` says it
directly:

```sql
-- PostgreSQL: date - date yields an integer number of days
select x.ename, x.hiredate, x.next_hd,
       x.next_hd - x.hiredate as diff
  from (
select e.deptno, e.ename, e.hiredate,
       lead(hiredate) over (order by hiredate) as next_hd
  from emp e
       ) x
 where x.deptno = 10;
```

The inline view is **not** cosmetic. Window functions are evaluated after
`WHERE`, so pushing `deptno = 10` down into the subquery changes the answer:
`LEAD` would then only see department 10's rows and report the next hire
*within* the department, not the next hire overall. Filter outside the
window, always.

Only the subtraction differs across engines — the `LEAD` call is identical:

```sql
-- MySQL: datediff(later, earlier) returns days
       datediff(x.next_hd, x.hiredate) as diff

-- SQL Server: unit comes first
       datediff(day, x.hiredate, x.next_hd) as diff
```

The trap the book spends most of the recipe on is **duplicate ordering
keys**. `LEAD` moves one *row* forward, not one *distinct value* forward, so
five employees hired on the same day each see a `next_hd` equal to their own
`hiredate` and report a gap of zero:

```sql
-- wrong when hiredate has duplicates: four of the five rows get diff = 0
select ename, hiredate,
       lead(hiredate) over (order by hiredate) - hiredate as diff
  from emp
 where deptno = 10;
```

The book's fix computes how far ahead the next distinct date is and passes
that as `LEAD`'s offset argument — `count(*)` per date group minus the row's
rank within the group, plus one:

```sql
select ename, hiredate, next_hd,
       next_hd - hiredate as diff
  from (
select ename, hiredate,
       lead(hiredate, cnt - rn + 1) over (order by hiredate) as next_hd
  from (
select ename, hiredate,
       count(*)      over (partition by hiredate)                 as cnt,
       row_number()  over (partition by hiredate order by empno)  as rn
  from emp
 where deptno = 10
       ) counted
       ) offsets;
```

That offset arithmetic works on all three engines — MySQL requires `N` to be
a literal, a parameter marker, or a variable, so `lead(hiredate, cnt-rn+1)`
is one of the few places its rules are stricter than PostgreSQL's and SQL
Server's, which accept an arbitrary expression. A more portable phrasing
sidesteps the offset entirely by leading over the *distinct* dates and
joining back:

```sql
with distinct_days as (
  select hiredate,
         lead(hiredate) over (order by hiredate) as next_hd
    from (select distinct hiredate from emp where deptno = 10) d
)
select e.ename, e.hiredate, d.next_hd, d.next_hd - e.hiredate as diff
  from emp e
  join distinct_days d on d.hiredate = e.hiredate
 where e.deptno = 10;
```

`LEAD`/`LAG` themselves are settled ground: PostgreSQL, MySQL 8.0+, and SQL
Server 2012+ all implement `LEAD(expr, offset, default) OVER (PARTITION BY
… ORDER BY …)` identically. The one live difference is null treatment —
PostgreSQL 16+ and SQL Server 2022+ support `IGNORE NULLS`, MySQL parses it
and then raises an error, so only `RESPECT NULLS` (the default) is portable.

### Filling in missing dates: generate a calendar, then outer join

You cannot `GROUP BY` your way to a row that has no data. Recipe 9.10's
question — employees hired per month from 2000 to 2003, including the months
with zero hires — needs the twelve months of each year to come from
somewhere other than `EMP`. Generate them, then `LEFT JOIN`:

```sql
-- PostgreSQL: generate_series does the calendar in one line
select g.mth::date, count(e.hiredate) as num_hired
  from generate_series(
         date_trunc('year',  (select min(hiredate) from emp)),
         date_trunc('year',  (select max(hiredate) from emp)) + interval '11 months',
         interval '1 month'
       ) as g(mth)
  left join emp e
    on date_trunc('month', e.hiredate) = g.mth
 group by g.mth
 order by g.mth;
```

Note the outer join's `COUNT(e.hiredate)`, not `COUNT(*)`: on a month with no
hires the outer join produces one row of nulls, and `COUNT(*)` would count it
as 1. Counting a column from the *outer-joined* side is what turns a
no-match row into a zero.

MySQL has no set-returning function, so the recursive CTE the book uses is
still the answer there today:

```sql
-- MySQL 8.0+: recursive CTE builds the month list
with recursive months (mth, end_date) as (
  select date_sub(min(hiredate), interval dayofyear(min(hiredate)) - 1 day),
         date_add(date_sub(max(hiredate), interval dayofyear(max(hiredate)) - 1 day),
                  interval 1 year)
    from emp
  union all
  select date_add(mth, interval 1 month), end_date
    from months
   where date_add(mth, interval 1 month) < end_date
)
select m.mth, count(e.hiredate) as num_hired
  from months m
  left join emp e
    on extract(year_month from m.mth) = extract(year_month from e.hiredate)
 group by m.mth
 order by m.mth;
```

SQL Server 2022 added `GENERATE_SERIES`, but it generates **numbers only** —
the date variant has to be built by adding the generated integer as an
interval:

```sql
-- SQL Server 2022+ (compatibility level 160): numeric series + DATEADD
declare @start date = (select dateadd(year, datediff(year, 0, min(hiredate)), 0) from emp);
declare @months int = (select datediff(month, min(hiredate), max(hiredate)) + 1 from emp);

select dateadd(month, g.value, @start) as mth,
       count(e.hiredate)               as num_hired
  from generate_series(0, @months - 1) as g
  left join emp e
    on datefromparts(year(e.hiredate), month(e.hiredate), 1)
     = dateadd(month, g.value, @start)
 group by dateadd(month, g.value, @start)
 order by 1;
```

Below SQL Server 2022, or below compatibility level 160, the recursive CTE
from the book is still the portable fallback. A persisted calendar/dimension
table is the third option and often the right one in a warehouse: it can be
indexed, joined cheaply, and carry extra columns (fiscal period, holiday
flags) that no generator produces.

### Overlapping date ranges: the self-join condition, and PostgreSQL's native ranges

Recipe 9.13 wants every case of an employee starting a project before
finishing another. Two ranges overlap when each starts before the other
ends — but the book writes an intentionally *asymmetric* form:

```sql
-- book's form: b starts inside a's window
select a.empno, a.ename,
       'project ' || b.proj_id || ' overlaps project ' || a.proj_id as msg
  from emp_project a
  join emp_project b
    on a.empno = b.empno
   and a.proj_id != b.proj_id
 where b.proj_start >= a.proj_start
   and b.proj_start <= a.proj_end;
```

This is complete and self-deduplicating: for any two overlapping ranges, the
later-starting one's `proj_start` necessarily falls inside the earlier one's
window, so each colliding pair is reported exactly once — and the message
naturally reads "the new one overlaps the old one". Only the concatenation
changes per vendor (`concat(...)` on MySQL, `+` on SQL Server, where the
integer `proj_id` also needs an explicit `cast(... as varchar)` because `+`
on mixed types is arithmetic, not concatenation).

The symmetric textbook condition finds the same pairs but reports each twice
unless you add a tiebreaker:

```sql
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno
   and a.proj_id < b.proj_id          -- the dedup half of the condition
 where a.proj_start <= b.proj_end
   and b.proj_start <= a.proj_end;
```

PostgreSQL is the outlier here, and in two ways. First, the SQL-standard
`OVERLAPS` predicate, which it implements and MySQL and SQL Server do not:

```sql
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno and a.proj_id < b.proj_id
 where (a.proj_start, a.proj_end) overlaps (b.proj_start, b.proj_end);
```

`OVERLAPS` uses **half-open** semantics — `start <= t < end` — so two ranges
that merely touch at an endpoint do *not* overlap. That is a genuine
behavioural difference from the book's `<=` condition, not a stylistic one.
Project 7 runs 22-JUN to 25-JUN and project 10 runs 25-JUN to 28-JUN; the
book's inclusive comparison reports them as overlapping, `OVERLAPS` does not:

```sql
select (date '2005-06-22', date '2005-06-25')
       overlaps (date '2005-06-25', date '2005-06-28');   -- false
```

Second, PostgreSQL has real range types — `daterange`, `tsrange`,
`tstzrange`, plus their multirange counterparts — with `&&` as the overlap
operator and explicit bound inclusivity in the constructor:

```sql
-- '[]' = both bounds inclusive, matching the book's semantics exactly
select a.proj_id, b.proj_id
  from emp_project a
  join emp_project b
    on a.empno = b.empno and a.proj_id < b.proj_id
 where daterange(a.proj_start, a.proj_end, '[]')
    && daterange(b.proj_start, b.proj_end, '[]');

select daterange(date '2005-06-22', date '2005-06-25', '[]')
    && daterange(date '2005-06-25', date '2005-06-28', '[]');   -- true
```

The bound notation is the point: `'[]'` reproduces the book's inclusive
comparison, `'[)'` reproduces `OVERLAPS`. The ambiguity that the manual
`start1 <= end2` form leaves implicit becomes a declared part of the value.

And once ranges are a stored type rather than two loose columns, PostgreSQL
can *prevent* overlaps instead of detecting them after the fact, with a
GiST-backed exclusion constraint:

```sql
create extension if not exists btree_gist;

create table room_reservation (
  room   text,
  during tsrange,
  exclude using gist (room with =, during with &&)
);

insert into room_reservation values ('123A', '[2010-01-01 14:00, 2010-01-01 15:00)');
insert into room_reservation values ('123A', '[2010-01-01 14:30, 2010-01-01 15:30)');
-- ERROR: conflicting key value violates exclusion constraint
--        "room_reservation_room_during_excl"
```

PostgreSQL 18 wraps the same machinery in SQL:2011 temporal syntax — a
primary key whose last column is checked for overlap rather than equality,
which compiles down to exactly the exclusion constraint above:

```sql
create table room_reservation (
  room   text,
  during daterange,
  primary key (room, during without overlaps)
);
```

MySQL and SQL Server have no equivalent of any of this — no range type, no
`&&`, no `OVERLAPS` predicate, no exclusion constraint. Enforcing
non-overlap there means a trigger or an application-level check, and
detecting overlap means the book's self-join, which remains exactly as
current on those two engines as it was in 2020.

## Trade-offs

- **`LEAD` steps one row, not one distinct value — duplicates silently
  produce a gap of zero.** This is the failure mode most likely to reach
  production unnoticed, because the query returns rows and no error; the
  numbers are just wrong for every duplicated date. Either pass a computed
  offset (`lead(hiredate, cnt-rn+1)`) or lead over a `DISTINCT` subquery and
  join back.
  ```sql
  -- five employees hired the same day: four report diff = 0
  lead(hiredate) over (order by hiredate) - hiredate
  ```
- **Window functions are evaluated after `WHERE`, so the inline view is
  load-bearing.** Moving the filter inside the subquery is a one-line edit
  that quietly changes the question from "next hire in the company" to "next
  hire in this department" — it looks like a simplification and is actually a
  different query.
- **Calendar generation is the least portable step of the three.**
  PostgreSQL's `generate_series` does it in one expression; SQL Server 2022's
  `GENERATE_SERIES` emits numbers only and needs `DATEADD` on top, plus
  compatibility level 160; MySQL has no generator at all and still needs the
  book's recursive CTE, capped by `cte_max_recursion_depth` (default 1000
  levels — enough for a few years of months, not enough for a decade of days
  without raising it).
  ```sql
  set session cte_max_recursion_depth = 5000;  -- ~13 years of daily rows
  ```
- **Inclusive and half-open range semantics disagree on touching endpoints,
  and nothing warns you.** The book's `start <= end` comparison counts a
  range ending 25-JUN and one starting 25-JUN as overlapping; `OVERLAPS` and
  a `'[)'` `daterange` do not. Which is correct depends entirely on whether
  the end date means "the last day included" or "the first day excluded" —
  decide that once, per column, and encode it, because a mixed convention in
  one schema produces off-by-one bugs that only surface on adjacent rows.
- **Self-join overlap detection is quadratic within each partition.** Every
  row is compared against every other row for the same employee, room, or
  resource; with a few projects per employee that is free, with tens of
  thousands of intervals in one partition it is not. PostgreSQL can index the
  comparison with a GiST index on a range column and make `&&` a real index
  scan; MySQL and SQL Server have no indexable overlap operator, so a
  composite index on `(entity, start_date)` plus a bounded time window in the
  `WHERE` clause is the only lever available.
- **Detecting overlaps and preventing them are different problems, and only
  PostgreSQL solves the second declaratively.** An exclusion constraint (or
  PostgreSQL 18's `WITHOUT OVERLAPS` temporal key) rejects the conflicting
  row at insert time, under concurrency, without a race window; the
  application-level `SELECT`-then-`INSERT` check that MySQL and SQL Server
  are limited to has a gap between the check and the write that two
  concurrent sessions will eventually find.
- **The book's asymmetric overlap condition is a feature, not an
  oversight.** `b.proj_start between a.proj_start and a.proj_end` returns one
  row per colliding pair and identifies which range started later, where the
  symmetric `a.start <= b.end and b.start <= a.end` returns both orderings
  and needs an extra `a.id < b.id` predicate to deduplicate. Reach for the
  symmetric form only when you genuinely want the pair in both directions.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 8, "Date Arithmetic", recipe 8.7, p. 231-237; Chapter 9, "Date Manipulation", recipes 9.10, 9.13, p. 293-311 — doc
- [PostgreSQL Documentation — Range Types (daterange, && overlap operator, exclusion constraints)](https://www.postgresql.org/docs/current/rangetypes.html) — doc
- [PostgreSQL Documentation — Date/Time Functions and Operators (OVERLAPS predicate)](https://www.postgresql.org/docs/current/functions-datetime.html) — doc
- [PostgreSQL Documentation — Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html) — doc
- [MySQL Reference Manual — Window Function Descriptions (LEAD, LAG)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) — doc
- [Microsoft Learn — LEAD (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lead-transact-sql) — doc
- [Microsoft Learn — GENERATE_SERIES (Transact-SQL, SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) — doc
