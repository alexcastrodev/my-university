---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A `GROUP BY` collapses rows into one row per group — but a report usually wants
more than that: the per-group numbers *and* the totals those numbers roll up
into, in one result set. The `GROUP BY` extensions `ROLLUP`, `CUBE`, and
`GROUPING SETS` produce those extra summary rows (the standard calls them
*super-aggregate* rows) without a single self-join or `UNION ALL`, ranging from
"add one grand-total row at the bottom" to "give me a subtotal for every
combination of my grouping columns." Because every super-aggregate row marks its
un-grouped columns with `NULL`, the last piece of the puzzle is the `GROUPING()`
function: the only reliable way to tell "this `NULL` means *all departments*"
apart from "this `NULL` is a real `NULL` in the data."

## Use Cases

- A sales report with a subtotal per region and a single grand-total row at the
  bottom, produced by one query instead of a query plus a footer computed in the
  application.
- A full cross-tabulation — subtotals by product, by region, by quarter, and by
  every combination of the three — feeding a pivot-table-style export or an OLAP
  cube-lite dashboard.
- Filtering a `ROLLUP`/`CUBE` result down to just the detail rows (or just the
  subtotal rows) so application code can render the two differently, without
  guessing from `NULL`s.
- Replacing a hand-written `UNION ALL` of three or four near-identical aggregate
  queries — the engine scans the table once instead of once per branch.

## Deep Dive

### Simple subtotals: `ROLLUP` and a grand-total row

Start with the ordinary aggregate — total salary per job:

```sql
select job, sum(sal) as sal
  from emp
 group by job;

JOB          SAL
---------  -----
ANALYST     6000
CLERK       4150
MANAGER     8275
PRESIDENT   5000
SALESMAN    5600
```

`ROLLUP(job)` adds one more row: the aggregate with `job` removed from the
grouping entirely, i.e. the grand total.

```sql
select job, sum(sal) as sal
  from emp
 group by rollup(job);

JOB          SAL
---------  -----
ANALYST     6000
CLERK       4150
MANAGER     8275
PRESIDENT   5000
SALESMAN    5600
           29025    -- job is NULL: the ROLLUP row
```

`GROUP BY ROLLUP(job)` is the ISO spelling and runs unmodified on **PostgreSQL**
(9.5+) and **SQL Server** (2008+, compatibility level 100 or higher). MySQL got
there by a different route: the historical MySQL syntax is the trailing modifier
`GROUP BY job WITH ROLLUP`, and the standard `GROUP BY ROLLUP(job)` form is
documented from MySQL 8.4 onward — the 8.0 manual still shows only `WITH ROLLUP`.

```sql
-- MySQL 8.0: only this spelling
select job, sum(sal) as sal from emp group by job with rollup;

-- MySQL 8.4+: the ISO spelling also works
select job, sum(sal) as sal from emp group by rollup(job);
```

The book labels the total row with `COALESCE(job,'TOTAL')`. That works, but it is
the wrong tool — see the `GROUPING()` section below for why, and for the version
that stays correct when `job` itself is nullable:

```sql
select case when grouping(job) = 1 then 'TOTAL' else job end as job,
       sum(sal) as sal
  from emp
 group by rollup(job);
```

With more than one column, `ROLLUP` is *hierarchical* — it walks right to left,
dropping one column at a time. `ROLLUP(deptno, job)` produces exactly four
grouping sets: `(deptno, job)`, `(deptno)`, `()` — nine detail rows, three
per-department subtotals, one grand total. There is deliberately **no** subtotal
by `job` alone; column order is meaningful, which is what makes `ROLLUP` the
right fit for a genuine hierarchy (year > quarter > month, region > territory).

### Every combination at once: `CUBE`, and `GROUPING SETS` when you want control

When the columns aren't a hierarchy — `deptno` and `job` are independent
dimensions — you want the full power set. That is `CUBE`:

```sql
select deptno, job, sum(sal) as sal
  from emp
 group by cube(deptno, job);
```

`CUBE(deptno, job)` expands to the grouping sets `(deptno, job)`, `(deptno)`,
`(job)`, `()` — 2^n sets for n columns. Nine detail rows, three subtotals by
department, five subtotals by job, one grand total: eighteen rows from one scan.

`GROUPING SETS` is the same machinery with the expansion written out by hand,
which makes it the precise tool rather than the blunt one:

```sql
-- identical to CUBE(deptno, job)
 group by grouping sets ((deptno, job), (deptno), (job), ());

-- same, minus the grand total
 group by grouping sets ((deptno, job), (deptno), (job));

-- subtotals by job only — no per-department rollup, but keep the grand total
 group by grouping sets ((deptno, job), (job), ());
```

`ROLLUP` and `CUBE` are, formally, nothing but shorthand for particular
`GROUPING SETS` lists. Reach for `GROUPING SETS` the moment you want a report
that isn't exactly "hierarchy" or "everything."

> PostgreSQL 14+ also accepts `GROUP BY DISTINCT ROLLUP(a, b), ROLLUP(a, c)`,
> which collapses grouping sets that the expansion would otherwise emit twice.
> SQL Server's `GROUP BY DISTINCT` is restricted to plain column lists — it
> cannot be combined with `GROUPING SETS`, `ROLLUP`, or `CUBE`, and duplicate
> grouping sets there really do produce duplicate rows (`GROUP BY ((), CUBE(a,b))`
> returns two grand-total rows).

**This is where MySQL still genuinely can't follow, and it is not a book-era
artifact.** The MySQL 9.7 reference manual documents exactly one `GROUP BY`
modifier — `ROLLUP`. There is no `CUBE` and no `GROUPING SETS` in MySQL Server,
today. The single narrow exception is the managed **MySQL HeatWave** service,
where `CUBE` is documented as "Available in MySQL HeatWave only" and
`GROUPING SETS` as "Available as of MySQL 9.6.0 only on MySQL HeatWave" — and
even there, a `GROUPING SETS` query errors out unless the data is actually loaded
into the HeatWave cluster. On stock MySQL the book's fallback is still the
answer: one `GROUP BY` per grouping set, stitched together with `UNION ALL`.

```sql
-- MySQL Server: the CUBE query, spelled out
  select deptno, job, 'TOTAL BY DEPT AND JOB' as category, sum(sal) as sal
    from emp group by deptno, job
   union all
  select null, job, 'TOTAL BY JOB', sum(sal)   from emp group by job
   union all
  select deptno, null, 'TOTAL BY DEPT', sum(sal) from emp group by deptno
   union all
  select null, null, 'GRAND TOTAL FOR TABLE', sum(sal) from emp;
```

Four branches means four passes over `emp`, versus one for `CUBE` — the
portability cost here is real work, not just extra typing. Note also that MySQL's
`WITH ROLLUP` covers the *hierarchical* case fine, so a plain "subtotals plus
grand total" report is portable across all three engines; only the
all-combinations case forces the `UNION ALL` rewrite.

### Telling subtotal rows from detail rows: `GROUPING()`

Every super-aggregate row carries `NULL` in the columns that were rolled away.
So does any detail row whose grouping column is genuinely `NULL` in the data.
`GROUPING(col)` disambiguates: it returns `1` when the `NULL` in `col` was
manufactured by `ROLLUP`/`CUBE`/`GROUPING SETS`, and `0` otherwise.

```sql
select deptno, job, sum(sal) as sal,
       grouping(deptno) as deptno_subtotal,
       grouping(job)    as job_subtotal
  from emp
 group by cube(deptno, job)
 order by 4, 5;

DEPTNO JOB           SAL DEPTNO_SUBTOTAL JOB_SUBTOTAL
------ --------- ------- --------------- ------------
    10 CLERK        1300               0            0   -- detail
    10 MANAGER      2450               0            0   -- detail
    ...
    10              8750               0            1   -- subtotal by DEPTNO
    20             10875               0            1
    30              9400               0            1
       CLERK        4150               1            0   -- subtotal by JOB
       ANALYST      6000               1            0
       ...
                   29025               1            1   -- grand total
```

That pair of flags is exactly what "identify the rows that are not subtotals"
needs — detail rows are the ones where every flag is `0`:

```sql
-- detail rows only, out of a CUBE result
select deptno, job, sum(sal) as sal
  from emp
 group by cube(deptno, job)
having grouping(deptno) = 0
   and grouping(job) = 0;
```

It must be `HAVING`, never `WHERE`. The super-aggregate rows do not exist yet
when `WHERE` runs — MySQL's manual states the constraint bluntly: *"you can test
them as NULL values only in the select list or HAVING clause. You cannot test
them as NULL values in join conditions or the WHERE clause."* The same ordering
applies on PostgreSQL and SQL Server.

For labeling, the two flags combine into a bitmask, with the leftmost argument as
the most significant bit. **PostgreSQL** and **MySQL** overload `GROUPING()`
itself to take a column list:

```sql
select deptno, job,
       case grouping(deptno, job)
            when 0 then 'TOTAL BY DEPT AND JOB'
            when 1 then 'TOTAL BY DEPT'        -- job rolled up
            when 2 then 'TOTAL BY JOB'         -- deptno rolled up
            when 3 then 'GRAND TOTAL FOR TABLE'
       end as category,
       sum(sal) as sal
  from emp
 group by cube(deptno, job)
 order by grouping(job), grouping(deptno);
```

**SQL Server** splits the two: `GROUPING()` accepts exactly one column, and the
multi-column bitmask is a separate function, `GROUPING_ID()`:

```sql
select deptno, job,
       case grouping_id(deptno, job)
            when 0 then 'TOTAL BY DEPT AND JOB'
            when 1 then 'TOTAL BY DEPT'
            when 2 then 'TOTAL BY JOB'
            when 3 then 'GRAND TOTAL FOR TABLE'
       end as category,
       sum(sal) as sal
  from emp
 group by cube(deptno, job);
```

Either way, the book's per-vendor `CAST(grouping(x) AS CHAR(1)) || ...` string
concatenation — `||` on Oracle, `+` on SQL Server, `concat()` on PostgreSQL — is
obsolete. The bitmask is an integer; compare it as one.

Two more things the book predates. MySQL, which the 2020 text describes as
supporting neither `CUBE` nor `GROUPING`, has had `GROUPING()` since **MySQL
8.0.1** (and permits it in `ORDER BY` since 8.0.12) — so the `COALESCE`
workaround the book prescribes for MySQL is no longer required:

```sql
-- MySQL 8.0.1+
select case when grouping(job) = 1 then 'TOTAL' else job end as job,
       sum(sal) as sal
  from emp
 group by job with rollup;
```

And on SQL Server, the `GROUP BY deptno, job WITH CUBE` syntax the book uses is
now explicitly flagged by Microsoft as non-ISO-compliant and retained "for
backward compatibility only" — new code should use `GROUP BY CUBE(deptno, job)`.

## Trade-offs

- **`ROLLUP` is linear, `CUBE` is exponential — and engines enforce a ceiling.**
  `ROLLUP` over n columns yields n+1 grouping sets; `CUBE` yields 2^n. SQL Server
  caps a `ROLLUP`/`CUBE`/`GROUPING SETS` clause at 32 expressions and **4,096
  grouping sets total**, so `CUBE(a1, ..., a13)` fails outright at 8,192 sets.
  Cubing "just one more dimension" doubles both the work and the row count;
  `GROUPING SETS` with the handful of combinations anyone will actually read is
  usually the better answer.
- **MySQL's missing `CUBE`/`GROUPING SETS` is a live portability gap, not a
  historical footnote.** Six years after the book, MySQL Server 9.7 still
  documents `ROLLUP` as its only `GROUP BY` modifier; `CUBE` and (as of 9.6.0)
  `GROUPING SETS` exist only in the managed HeatWave service. Any all-combinations
  report that has to run on stock MySQL needs the `UNION ALL` rewrite — with one
  table scan per branch instead of one for the whole query.
- **`COALESCE` to label total rows is a bug waiting for a nullable column.**
  `COALESCE(job,'TOTAL')` cannot distinguish the `ROLLUP` row from an employee
  whose `job` is genuinely `NULL`; both get labeled `TOTAL` and their salaries
  read as a total that isn't one. `GROUPING(job) = 1` is the only test that
  answers the question actually being asked.
  ```sql
  -- lies if any emp row has job IS NULL
  select coalesce(job,'TOTAL') as job, sum(sal) from emp group by rollup(job);
  ```
- **`GROUPING()` lives in `SELECT`/`HAVING`/`ORDER BY` and nowhere else.**
  Super-aggregate rows are materialized after `WHERE` has already run, so
  filtering them requires `HAVING` (or wrapping the whole query in a derived
  table). Reaching for `WHERE job IS NOT NULL` to drop total rows both fails to
  compile the intent and silently removes legitimate detail rows.
- **The multi-column bitmask is spelled differently on SQL Server.**
  PostgreSQL and MySQL let `GROUPING(a, b)` return a combined bitmask; T-SQL's
  `GROUPING()` is strictly single-column and the bitmask lives in `GROUPING_ID()`.
  The single-column `GROUPING(col) = 1` test is portable across all three; the
  `CASE` over a bitmask is not, and needs a one-word edit per engine.
- **One result set now mixes two granularities, and downstream code has to
  care.** A `ROLLUP` result is no longer a clean relation of comparable rows —
  re-aggregating it, joining it, or piping it into a chart without filtering on
  `GROUPING()` double-counts every value. `GROUP BY` also imposes no ordering, so
  the "grand total at the bottom" layout only happens if you write the
  `ORDER BY` (typically `ORDER BY GROUPING(...)`) that puts it there.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 12, "Reporting and Reshaping", recipes 12.12, 12.13, 12.14, p. 397-412 — doc
- [PostgreSQL Documentation — GROUPING SETS, CUBE, and ROLLUP](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUPING-SETS) — doc
- [MySQL Reference Manual — GROUP BY Modifiers (WITH ROLLUP, GROUPING())](https://dev.mysql.com/doc/refman/8.4/en/group-by-modifiers.html) — doc
- [MySQL HeatWave User Guide — GROUP BY Modifiers (CUBE and GROUPING SETS, HeatWave only)](https://dev.mysql.com/doc/heatwave/en/mys-hw-group-by-modifiers.html) — doc
- [Microsoft Learn — GROUP BY (Transact-SQL): ROLLUP, CUBE, GROUPING SETS](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-group-by-transact-sql) — doc
