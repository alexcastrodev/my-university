---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A whole family of everyday reporting questions reduces to the same shape:
look at a row, then look at its *neighbor* inside an ordered partition. "How
much less does this employee earn than the one hired right after them in the
same department?" is a subtraction between adjacent rows. "What was the last
known status before this row, which doesn't have one?" is the same lookup
with the difference thrown away and the neighbor's value kept. Both are
solved by the window functions `LEAD`, `LAG`, `FIRST_VALUE`, and
`LAST_VALUE` — no self-join, no correlated subquery, one pass over an
ordered partition.

## Use Cases

- Computing the salary or price gap between a row and the next one in the
  same group — the book's own example: each employee's `SAL` minus the
  `SAL` of the colleague hired immediately after them, per department.
- Period-over-period deltas in a report: this month's revenue minus last
  month's, this quarter's headcount minus the previous quarter's, all
  partitioned by region or product.
- Carrying a "last known" value forward across sparse rows — a status
  column, a price, a configuration flag that's only written when it
  *changes*, leaving `NULL` on every row in between.
- Filling zeros (rather than gaps) into a report's range, where the missing
  thing is an entire *row*, not just a value in a row.
- Flagging discontinuities: comparing `LAG(end_date)` to the current
  `start_date` to detect where a consecutive range breaks.

## Deep Dive

### Adjacent-row differences with LEAD and LAG

`LEAD` looks forward, `LAG` looks backward, both within the `PARTITION BY`
group and along the `ORDER BY` sequence. The book's recipe 10.2 wants, per
department, each employee's salary minus the salary of the next employee
hired:

```sql
with next_sal_tab (deptno, ename, sal, hiredate, next_sal) as (
  select deptno, ename, sal, hiredate,
         lead(sal) over (partition by deptno order by hiredate) as next_sal
    from emp
)
select deptno, ename, sal, hiredate,
       coalesce(cast(sal - next_sal as char), 'N/A') as diff
  from next_sal_tab;
```

The last-hired employee in each department has no "next" row, so `LEAD`
returns `NULL` and `COALESCE` substitutes `'N/A'`. This exact query runs on
PostgreSQL, MySQL 8+, and SQL Server (modulo the `cast(... as char)`
spelling — `varchar` on SQL Server, `char` on MySQL, `text`/`varchar` on
PostgreSQL).

Note that `LEAD`/`LAG` are evaluated *after* `FROM` and `WHERE`. A window
function can't be referenced in the same query block's `WHERE` clause, which
is why the pattern is always "compute the neighbor in an inline view or CTE,
filter in the outer query" — every engine enforces this.

The interesting part is the book's "what if there are duplicates" caveat.
`LEAD` looks ahead exactly one *row*, not one distinct `ORDER BY` value —
so five employees sharing a `HIREDATE` end up comparing themselves to each
other instead of to the genuinely next-hired person. The book's fix is a
computed offset: count the duplicates, rank within them, and tell `LEAD`
how far to jump.

```sql
select deptno, ename, sal, hiredate,
       lead(sal, cnt - rn + 1) over (partition by deptno
                                         order by hiredate) as next_sal
  from (
    select deptno, ename, sal, hiredate,
           count(*)      over (partition by deptno, hiredate) as cnt,
           row_number()  over (partition by deptno, hiredate
                                   order by sal) as rn
      from emp
       ) x;
```

This is the line that doesn't travel. **The offset argument is where the
three engines genuinely disagree:**

- **SQL Server** is the permissive one — the docs say plainly that *offset*
  "can be a column, subquery, or other expression that evaluates to a
  positive integer," and Microsoft's own reference even demonstrates
  `LAG(2*c, b*(SELECT MIN(b) FROM T), -c/2.0)`. The book's `cnt - rn + 1`
  works verbatim.
- **PostgreSQL** accepts a per-row expression too, but the signature is
  `lead(anyelement, integer)` — and `count(*) over (...)` returns `bigint`.
  On PostgreSQL 18 the book's expression fails resolution outright:

  ```
  ERROR:  function lead(integer, bigint) does not exist
  HINT:  No function matches the given name and argument types.
         You might need to add explicit type casts.
  ```

  An explicit cast fixes it, and the computed offset then works exactly as
  intended: `lead(sal, (cnt - rn + 1)::int) over (...)`.
- **MySQL 8+** rejects it at parse time, and no cast helps. The manual is
  unambiguous: `N` "must be a literal nonnegative integer," and the only
  permitted forms are an unsigned integer literal, a `?` placeholder, a
  user-defined variable, or a stored-routine local variable. A column
  reference is not on that list. On MySQL the duplicate-handling variant
  has to be restructured — typically by aggregating each `HIREDATE` group
  down to one row first, then applying a plain `LEAD(sal)` over the
  collapsed set, or by joining against a `MIN(hiredate) > current` subquery.

### Filling gaps: carry the last known value forward

Recipe 10.4 fills in missing *rows* — years with no hires — by generating
the full range of years and outer-joining the counts onto it, with
`COALESCE(cnt, 0)` turning the misses into zeros. That structure is still
correct today, and PostgreSQL's `generate_series` (and a recursive CTE
elsewhere) makes the "supply the full range" half trivial.

The sibling problem is subtler: the rows *exist*, but a column is `NULL` on
most of them because the value is only recorded when it changes. Filling
those in means carrying the last non-`NULL` value forward:

```sql
create table reading (id integer, status varchar(10));

insert into reading values (1, 'OK'), (2, null), (3, null),
                           (4, 'FAIL'), (5, null), (6, 'OK');
```

Where `IGNORE NULLS` is available, this is a one-liner — `LAST_VALUE` with
the default frame (`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`)
already means "everything up to and including me," so ignoring nulls
leaves exactly the last known value:

```sql
-- SQL Server 2022 (16.x) and later, Azure SQL Database / MI / Edge
select id, status,
       last_value(status) ignore nulls over (order by id) as carried
  from reading;
```

**`IGNORE NULLS` support is the real vendor gap here, and it is not
closing.** SQL Server only got it in **2022 (16.x)** — for `LAG`, `LEAD`,
`FIRST_VALUE`, and `LAST_VALUE` alike (with a follow-up correctness fix in
CU4). MySQL *parses* the `null_treatment` clause but implements only
`RESPECT NULLS`; writing `IGNORE NULLS` raises an error rather than being
silently ignored. PostgreSQL doesn't implement the clause at all — as of
PostgreSQL 18 it's still a plain syntax error:

```
ERROR:  syntax error at or near "nulls"
LINE 1: select lag(sal) ignore nulls over (order by hiredate) ...
```

and the PostgreSQL manual states outright that the standard's
`RESPECT NULLS`/`IGNORE NULLS` option "is not implemented in PostgreSQL:
the behavior is always the same as the standard's default."

The portable substitute is a **counted-group carry-forward**: a running
`COUNT` of the non-`NULL` column increments only on rows that *have* a
value, so it acts as a group id where every gap belongs to the last
populated row above it. Group by that, then take `FIRST_VALUE`:

```sql
select id, status,
       first_value(status) over (partition by grp order by id) as carried
  from (
    select id, status,
           count(status) over (order by id) as grp
      from reading
       ) t;
```

```
 id | status | carried
----+--------+---------
  1 | OK     | OK
  2 |        | OK
  3 |        | OK
  4 | FAIL   | FAIL
  5 |        | FAIL
  6 | OK     | OK
```

This runs unchanged on PostgreSQL, MySQL 8+, and SQL Server, and it relies
on nothing more exotic than `COUNT`'s standard behavior of skipping `NULL`s.

One tempting shortcut that is *wrong*: reaching for an aggregate over the
running frame, e.g. `max(status) over (order by id rows between unbounded
preceding and current row)`. That returns the largest value seen so far, not
the most recent one — on the data above it yields `OK` for every single row,
including row 4 and 5 where the real answer is `FAIL`. The counted-group
trick is the one that actually means "last," not "biggest."

## Trade-offs

- **`LEAD`/`LAG` step by row position, not by distinct ordering value.**
  This is the trap the book spends most of recipe 10.2 on, and it's easy to
  miss because tidy sample data rarely has ties. If the `ORDER BY` column
  has duplicates, "the next row" is one of the tied peers, not the next
  genuinely-different value — and the query returns a plausible-looking
  wrong number rather than an error.
- **The computed-offset fix for ties is the least portable thing in the
  chapter.** SQL Server takes an arbitrary expression, PostgreSQL takes one
  with an explicit `::int` cast, MySQL takes only a literal or a variable.
  A query written around a computed `LEAD` offset is effectively
  single-vendor code, and on MySQL it needs a structurally different
  solution rather than a syntax tweak.
- **`IGNORE NULLS` reads beautifully and is available on exactly one of the
  three engines.** SQL Server 2022+ has it; MySQL errors on it; PostgreSQL
  won't parse it. The counted-group `FIRST_VALUE` pattern is more code and
  reads less obviously, but it's the version you can actually put in a
  codebase that targets more than one database.
- **`LAST_VALUE`'s default frame surprises people, in both directions.**
  The default is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, so
  `LAST_VALUE` means "the value at *my* row," not "the value at the end of
  the partition" — which is exactly what you want for carry-forward, and
  exactly not what you want when you're reaching for a partition maximum.
  For the latter you must spell out `RANGE BETWEEN CURRENT ROW AND
  UNBOUNDED FOLLOWING` (or use `FIRST_VALUE` with a reversed `ORDER BY`).
- **Filling missing *rows* and filling missing *values* look alike but need
  different machinery.** No window function can invent a row that isn't in
  the table — a year with zero hires needs a generated range and an outer
  join (recipe 10.4's actual structure). Window functions only help once a
  row exists and a column in it is empty. Diagnosing which of the two you
  have is the first step, not an implementation detail.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 10, "Working with Ranges", recipes 10.2, 10.4, p. 317-323, 326-330 — doc
- [PostgreSQL Documentation — Window Functions (lag, lead, first_value, last_value; RESPECT/IGNORE NULLS not implemented)](https://www.postgresql.org/docs/current/functions-window.html) — doc
- [MySQL Reference Manual — Window Function Descriptions (LAG/LEAD literal offset, null_treatment restrictions)](https://dev.mysql.com/doc/refman/8.4/en/window-function-descriptions.html) — doc
- [Microsoft Learn — LAG (Transact-SQL): expression offsets and IGNORE NULLS (SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/lag-transact-sql) — doc
- [Microsoft Learn — LAST_VALUE (Transact-SQL): IGNORE NULLS and default frame behavior](https://learn.microsoft.com/en-us/sql/t-sql/functions/last-value-transact-sql) — doc
