---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Pivoting is the operation of taking values that live *down* a column — one row
per department, per quarter, per job title — and turning them into columns
*across* a single row. It's the shape every spreadsheet-style report wants and
the shape almost no normalized table stores. The portable technique is
conditional aggregation: a `CASE` expression inside an aggregate function acts
as a per-column filter, and the aggregate collapses the resulting sparse rows
into dense ones. Vendors do offer native syntax — SQL Server has a `PIVOT`
operator, PostgreSQL has `crosstab()` behind the `tablefunc` extension, MySQL
has nothing at all — but none of them removes the fundamental constraint that
makes the whole thing awkward (you must name the output columns at query-compile
time), so the portable `CASE`+aggregate form is usually the right default.

## Use Cases

- A sales-by-quarter report: one row per year, with `Q1`/`Q2`/`Q3`/`Q4` as
  columns instead of four rows per year.
- A headcount summary: one row per department, with a column for each job
  title's count — the classic cross-tabulation.
- Reshaping an EAV / key-value table (`entity`, `attribute`, `value`) back into
  a wide, one-column-per-attribute result for display.
- Any "long to wide" transformation feeding a dashboard, a CSV export, or a
  charting library that expects one series per column.

## Deep Dive

### Pivoting into one row per group

Start from the unpivoted aggregate — the number of employees per department:

```sql
select deptno, count(*) as cnt
  from emp
 group by deptno;

 DEPTNO   CNT
 ------ -----
     10     3
     20     5
     30     6
```

The target is one row, three columns. The mechanic is a `CASE` expression that
emits `1` for the department it belongs to and `0` otherwise, wrapped in `SUM`:

```sql
select sum(case when deptno = 10 then 1 else 0 end) as deptno_10,
       sum(case when deptno = 20 then 1 else 0 end) as deptno_20,
       sum(case when deptno = 30 then 1 else 0 end) as deptno_30
  from emp;

 DEPTNO_10  DEPTNO_20  DEPTNO_30
 ---------  ---------  ---------
         3          5          6
```

Peeling the aggregate off makes the "rows to columns" step visible on its own —
each `CASE` is a flag saying which column this row belongs in:

```sql
select deptno,
       case when deptno = 10 then 1 else 0 end as deptno_10,
       case when deptno = 20 then 1 else 0 end as deptno_20,
       case when deptno = 30 then 1 else 0 end as deptno_30
  from emp
 order by 1;

 DEPTNO  DEPTNO_10  DEPTNO_20  DEPTNO_30
 ------  ---------  ---------  ---------
     10          1          0          0
     10          1          0          0
     ...
     30          0          0          1
```

The transposition is already done at that point; `SUM` only collapses the
column of flags into a single number. Adding `group by deptno` back produces a
diagonal matrix (department 10's count in `deptno_10`, zeros elsewhere) —
dropping the `GROUP BY` entirely is what fuses the diagonal into one row.

There's a second form worth knowing, because it generalizes better: aggregate
first in an inline view, then use `MAX ... else null` purely to squash `NULL`s
out of the way.

```sql
select max(case when deptno = 10 then empcount else null end) as deptno_10,
       max(case when deptno = 20 then empcount else null end) as deptno_20,
       max(case when deptno = 30 then empcount else null end) as deptno_30
  from (
        select deptno, count(*) as empcount
          from emp
         group by deptno
       ) x;
```

Here `MIN` would work equally well — with exactly one non-`NULL` value per
group, the choice of aggregate is arbitrary. That "aggregate as a `NULL`
remover" idea is the load-bearing trick in the multi-row case below.

PostgreSQL (9.4+) offers a cleaner spelling of the same thing via the SQL
standard `FILTER` clause, which moves the condition out of the value expression
and into the aggregate itself:

```sql
-- PostgreSQL: FILTER (WHERE ...) instead of CASE inside the aggregate
select count(*) filter (where deptno = 10) as deptno_10,
       count(*) filter (where deptno = 20) as deptno_20,
       count(*) filter (where deptno = 30) as deptno_30
  from emp;
```

`FILTER` is standard SQL but not widely implemented — PostgreSQL and SQLite have
it; MySQL and SQL Server do not, so `CASE` inside the aggregate remains the
portable spelling.

**SQL Server's native `PIVOT` operator.** T-SQL is the one mainstream engine
with a dedicated relational operator for this. It sits in the `FROM` clause,
takes an aggregate and a `FOR <column> IN (<value list>)`:

```sql
select 'headcount' as metric, [10], [20], [30]
  from (
        select deptno, empno
          from emp
       ) as src
 pivot (
        count(empno) for deptno in ([10], [20], [30])
       ) as pvt;
```

Note what `IN ([10], [20], [30])` is: the same hardcoded value list as the three
`CASE` expressions, just written once instead of three times. `PIVOT` is
syntactic sugar over conditional aggregation, not a more capable operation —
Microsoft's own docs frame it exactly that way ("easier and more readable than
... a complex series of `SELECT...CASE` statements"). Two behaviors to keep in
mind: any column not named in the subquery or the `PIVOT` clause is implicitly
grouped by, which is why the inline `select deptno, empno` is deliberately
narrow; and `NULL`s in the value column are ignored by the aggregate.

**PostgreSQL's `crosstab()`.** PostgreSQL has no `PIVOT` keyword. It ships a
`crosstab()` set-returning function in the `tablefunc` contrib module instead:

```sql
create extension tablefunc;   -- trusted extension: no superuser needed

select *
  from crosstab(
         'select ''headcount''::text, deptno, count(*)::int
            from emp
           group by deptno
           order by 1, 2',
         'select unnest(array[10, 20, 30])'
       ) as ct(metric text, deptno_10 int, deptno_20 int, deptno_30 int);
```

The two-argument form takes a *source* query returning `row_name, category,
value` (in that order, ordered by `1`) and a *category* query listing the
columns. The output column list still has to be spelled out in the `AS ct(...)`
clause — the function returns `setof record`, so PostgreSQL cannot infer the
shape. The SQL is passed as a **string literal**, which means no plan reuse, no
parameter binding, and errors surface at runtime rather than parse time. For
three columns, the `CASE`/`FILTER` version is plainly better; `crosstab()` earns
its keep mainly when the category query is doing real work (a
`generate_series(1,12)` for months, say) and when the input is genuinely sparse.

**MySQL** has no equivalent to either. Conditional aggregation is the only
option, on 8.x and 9.x alike.

### Pivoting into a fixed number of rows

The previous technique collapses everything to one row, which is exactly wrong
when the pivoted values aren't aggregates but a list. Consider laying out
employees under a column per job:

```
CLERKS  ANALYSTS  MGRS    PREZ  SALES
------  --------  -----   ----  ------
MILLER  FORD      CLARK   KING  TURNER
JAMES   SCOTT     BLAKE         MARTIN
ADAMS             JONES         WARD
SMITH                           ALLEN
```

Reaching for the one-row technique here fails, and fails quietly:

```sql
select max(case when job = 'CLERK'     then ename else null end) as clerks,
       max(case when job = 'ANALYST'   then ename else null end) as analysts,
       max(case when job = 'MANAGER'   then ename else null end) as mgrs,
       max(case when job = 'PRESIDENT' then ename else null end) as prez,
       max(case when job = 'SALESMAN'  then ename else null end) as sales
  from emp;

 CLERKS  ANALYSTS  MGRS   PREZ  SALES
 ------  --------  -----  ----  -----
 SMITH   SCOTT     JONES  KING  WARD
```

One row, and thirteen of fourteen employees silently gone. `MAX` did its job —
it's just that "its job" was picking a single name per column, when what was
wanted was "remove the `NULL`s without dropping anything."

The fix is to give the aggregate something to group by that makes every
`JOB`/`ENAME` pair unique. `ROW_NUMBER()` partitioned by the pivot column
supplies exactly that:

```sql
select job,
       ename,
       row_number() over (partition by job order by ename) as rn
  from emp;

 JOB        ENAME    RN
 ---------  ------   --
 ANALYST    FORD      1
 ANALYST    SCOTT     2
 CLERK      ADAMS     1
 CLERK      JAMES     2
 CLERK      MILLER    3
 CLERK      SMITH     4
 MANAGER    BLAKE     1
 ...
```

`rn` is the output row a value belongs to; the `CASE` picks the output column.
Group by `rn` and each `MAX` now sees exactly one non-`NULL` value per group, so
it removes `NULL`s instead of discarding data:

```sql
select max(case when job = 'CLERK'     then ename else null end) as clerks,
       max(case when job = 'ANALYST'   then ename else null end) as analysts,
       max(case when job = 'MANAGER'   then ename else null end) as mgrs,
       max(case when job = 'PRESIDENT' then ename else null end) as prez,
       max(case when job = 'SALESMAN'  then ename else null end) as sales
  from (
        select job,
               ename,
               row_number() over (partition by job order by ename) as rn
          from emp
       ) x
 group by rn;

 CLERKS  ANALYSTS  MGRS   PREZ  SALES
 ------  --------  -----  ----  ------
 MILLER  FORD      CLARK  KING  TURNER
 JAMES   SCOTT     BLAKE        MARTIN
 ADAMS             JONES        WARD
 SMITH                          ALLEN
```

The row count of the output is the largest partition size — four, because
`CLERK` and `SALESMAN` each have four members. Using `MIN` instead of `MAX`
gives an identical result; with one value per group the choice is arbitrary.

The far more common shape of this problem is a real grouping key rather than a
synthetic row number — a sales report with one row per year and one column per
quarter. Then the `GROUP BY` is the key itself and no window function is needed:

```sql
select extract(year from order_date) as yr,
       sum(case when extract(quarter from order_date) = 1 then amount else 0 end) as q1,
       sum(case when extract(quarter from order_date) = 2 then amount else 0 end) as q2,
       sum(case when extract(quarter from order_date) = 3 then amount else 0 end) as q3,
       sum(case when extract(quarter from order_date) = 4 then amount else 0 end) as q4
  from orders
 group by extract(year from order_date)
 order by yr;
```

That is the same one-row recipe with a `GROUP BY` restored — the grouping column
decides how many rows come out, and the `CASE` expressions decide the columns.
SQL Server's `PIVOT` expresses this variant natively too, since any column left
in the subquery and not consumed by the `PIVOT` clause becomes an implicit
grouping column:

```sql
select yr, [1] as q1, [2] as q2, [3] as q3, [4] as q4
  from (
        select year(order_date) as yr,
               datepart(quarter, order_date) as qtr,
               amount
          from orders
       ) as src
 pivot (
        sum(amount) for qtr in ([1], [2], [3], [4])
       ) as pvt
 order by yr;
```

What `PIVOT` cannot do is the `ROW_NUMBER()` case above — pivoting a *list* of
values rather than an aggregate of them. There, `ROW_NUMBER()` still has to be
computed in the inner query before `PIVOT` can group on it, at which point the
conditional-aggregation form is no longer meaningfully longer.

## Trade-offs

- **The column list must be known when the query is written.** Every technique
  here — `CASE`, `FILTER`, `PIVOT`, `crosstab()` — requires enumerating the
  pivot values literally. SQL's result shape is fixed at parse time, so a query
  cannot grow a column because a new department appeared. Producing a genuinely
  dynamic pivot means generating the SQL text (in the application, or in
  dynamic SQL with `sp_executesql`) and re-preparing it, with all the injection
  and plan-cache consequences that implies.
- **`PIVOT` is SQL-Server-only sugar, not extra capability.** It compiles to the
  same conditional aggregation and still needs the literal `IN (...)` list, so
  adopting it buys readability at the cost of portability. It also has quiet
  edges: unlisted columns in the source subquery become implicit `GROUP BY`
  keys, so a stray `select *` in the inner query silently changes the grouping
  and therefore the results.
- **`crosstab()` costs an extension and gives up static checking.** It needs
  `CREATE EXTENSION tablefunc`, which is a deployment decision on managed
  Postgres, and it takes its query as a string literal — no parameter binding,
  no plan reuse, syntax errors at runtime. The output column list still has to
  be declared in the `AS ct(...)` clause, so it doesn't even buy freedom from
  naming the columns.
- **Wide pivots scale badly in query text and in cost.** Twelve months, fifty
  states, or a hundred product SKUs means that many `CASE` expressions in the
  select list, each evaluated per input row. The pivot is usually cheaper done
  in the application or reporting layer past a certain width, and the SQL
  becomes unreviewable long before it becomes slow.
- **`MAX`/`MIN` as a `NULL`-remover silently drops data if the grouping key is
  wrong.** The failure mode in the multi-row recipe returns a plausible-looking
  single row rather than an error — the query is valid, just missing most of the
  data. Any pivot that isn't aggregating a genuine measure needs a grouping key
  that makes each cell unique, and it's worth asserting the output row count
  matches the largest partition rather than trusting it.
- **`SUM(CASE ... else 0)` and `MAX(CASE ... else null)` produce different
  empty cells.** The first yields `0` where no row matched, the second yields
  `NULL`. For a counts report `0` is right; for a "no data collected" cell
  `NULL` is right, and collapsing the distinction is a common reporting bug.
  SQL Server's `PIVOT` always yields `NULL` for empty cells, so an explicit
  `COALESCE` in the outer select list is needed to match the `else 0` behavior.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 12, "Reporting and Reshaping", recipes 12.1, 12.2, p. 369-377 — doc
- [Microsoft Learn — Using PIVOT and UNPIVOT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-using-pivot-and-unpivot) — doc
- [PostgreSQL Documentation — tablefunc (crosstab)](https://www.postgresql.org/docs/current/tablefunc.html) — doc
- [PostgreSQL Documentation — Aggregate Expressions (FILTER clause)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES) — doc
