---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Unpivoting — the book calls it "reverse pivoting" — is the inverse of
[Pivoting Rows to Columns](sql-pivoting-rows-to-columns): instead of spreading
one column's distinct values across new columns, you collapse several columns
that all mean the same *kind* of thing (`Q1`, `Q2`, `Q3`, `Q4`; `sales_2023`,
`sales_2024`; `emp1`…`emp5`) back down into one value column plus one label
column, producing more rows and fewer columns. You need it whenever the source
data stores what should be row-values as separate columns — a spreadsheet
import, a denormalized reporting table, a wide extract from someone else's
system. The shape you're heading toward is the "long"/"tidy" one: one row per
(entity, label, value) triple, which is what `GROUP BY`, window functions, and
every charting library actually want to consume.

## Use Cases

- Normalizing a wide `Q1,Q2,Q3,Q4` spreadsheet import into one row per
  quarter, so the quarter becomes a value you can filter, group, and order by
  instead of a column name baked into the schema.
- Turning a table with a separate column per year (`revenue_2022`,
  `revenue_2023`, `revenue_2024`) into a proper `year` column, so a chart's
  x-axis has something to bind to and adding 2025 is an `INSERT` rather than
  an `ALTER TABLE`.
- Preparing wide data for a tool that expects long/tidy format — BI tools,
  pandas/R pipelines, and time-series stores all assume one observation per
  row.
- Collapsing several attribute columns of one entity into a single-column
  "label sheet" or vertical listing for a printed report — the book's recipe
  12.4, stacking `ENAME`/`JOB`/`SAL` on top of each other with a blank line
  between employees.

## Deep Dive

### The book's technique: Cartesian product plus CASE

The book doesn't reach for `UNION ALL` at all. Given a "wide" one-row result —
here a view built from recipe 12.1's pivot:

```sql
create view emp_cnts as
select sum(case when deptno = 10 then 1 else 0 end) as deptno_10,
       sum(case when deptno = 20 then 1 else 0 end) as deptno_20,
       sum(case when deptno = 30 then 1 else 0 end) as deptno_30
  from emp;

-- DEPTNO_10  DEPTNO_20  DEPTNO_30
-- ---------- ---------- ----------
--          3          5          6
```

the recipe multiplies that single row against a table expression with at least
as many rows as there are columns to transpose, then uses `CASE` to pick the
right column per generated row:

```sql
select dept.deptno,
       case dept.deptno
            when 10 then emp_cnts.deptno_10
            when 20 then emp_cnts.deptno_20
            when 30 then emp_cnts.deptno_30
       end as counts_by_dept
  from emp_cnts
  cross join (select deptno from dept where deptno <= 30) dept;

-- DEPTNO  COUNTS_BY_DEPT
-- ------  --------------
--     10               3
--     20               5
--     30               6
```

The mechanic is worth internalizing because it's the same one every unpivot
uses under a different syntax: **you must manufacture N rows per input row,
where N is the number of columns being transposed.** The `CROSS JOIN` is the
row multiplier; the `CASE` is the column selector. Note the hard constraint
this implies — you have to know N in advance, and the row-source you cross
join against has to have at least N rows. That is not a book-era artifact:
every non-dynamic unpivot on every engine still requires the column list to be
written out literally.

Recipe 12.4 is the same trick pushed further — collapse *all* columns into one
output column. The book generates the row multiplier with a recursive CTE and
numbers the copies with `ROW_NUMBER()`:

```sql
with recursive four_rows (id) as (
  select 1
  union all
  select id + 1 from four_rows where id < 4
),
x_tab (ename, job, sal, rn) as (
  select e.ename, e.job, e.sal,
         row_number() over (partition by e.empno order by e.empno)
    from emp e
    join four_rows on 1 = 1
)
select case rn
         when 1 then ename
         when 2 then job
         when 3 then cast(sal as char(4))
       end as emps
  from x_tab;
```

The fourth row per employee has no `CASE` branch, so it falls through to
`NULL` — that's the deliberate blank separator line between employees. The
`CAST` on `SAL` is not optional: `CASE` unifies all its branches to one type,
so a numeric branch next to two string branches is a type error unless you
convert it. The recursive CTE needs the `RECURSIVE` keyword on PostgreSQL and
MySQL; SQL Server omits it.

### UNION ALL, and the LATERAL + VALUES form that replaces it

The obvious modern spelling stacks one `SELECT` per source column:

```sql
create table quarterly_sales (
  region text, q1 numeric, q2 numeric, q3 numeric, q4 numeric
);
insert into quarterly_sales values ('NORTH', 100, 120, 90, 140),
                                   ('SOUTH',  80,  95, 110, null);

select region, 'Q1' as quarter, q1 as amount from quarterly_sales
union all
select region, 'Q2', q2 from quarterly_sales
union all
select region, 'Q3', q3 from quarterly_sales
union all
select region, 'Q4', q4 from quarterly_sales
order by region, quarter;
```

This is correct and portable everywhere, but it reads the base table once per
branch. PostgreSQL's plan says so plainly:

```
Append
  ->  Seq Scan on quarterly_sales
  ->  Seq Scan on quarterly_sales quarterly_sales_1
  ->  Seq Scan on quarterly_sales quarterly_sales_2
  ->  Seq Scan on quarterly_sales quarterly_sales_3
```

Four scans for four columns. Since PostgreSQL 9.3, `LATERAL` gives a strictly
better shape: put the column-to-row mapping in an inline `VALUES` list that
references the outer row, and the table is scanned once.

```sql
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  cross join lateral (values ('Q1', qs.q1),
                             ('Q2', qs.q2),
                             ('Q3', qs.q3),
                             ('Q4', qs.q4)) as v(quarter, amount)
 order by qs.region, v.quarter;

-- region | quarter | amount
-- -------+---------+--------
-- NORTH  | Q1      |    100
-- NORTH  | Q2      |    120
-- NORTH  | Q3      |     90
-- NORTH  | Q4      |    140
-- SOUTH  | Q1      |     80
-- SOUTH  | Q2      |     95
-- SOUTH  | Q3      |    110
-- SOUTH  | Q4      |
```

```
Nested Loop
  ->  Seq Scan on quarterly_sales qs
  ->  Values Scan on "*VALUES*"
```

One scan, one values scan, and the query text lists each column exactly once
instead of repeating the whole `FROM`/`WHERE` per branch. The `LATERAL`
keyword is mandatory here — without it the `VALUES` list can't see `qs`:

```
ERROR:  invalid reference to FROM-clause entry for table "qs"
HINT:  To reference that table, you must mark this subquery with LATERAL.
```

The same shape is available on MySQL: lateral derived tables landed in **MySQL
8.0.14**, and the table value constructor is spelled `VALUES ROW(...)` there.
Both of these run on MySQL 8.4:

```sql
-- MySQL 8.0.19+ : VALUES ROW() table value constructor
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  join lateral (values row('Q1', qs.q1), row('Q2', qs.q2)) as v(quarter, amount);

-- MySQL 8.0.14+ : LATERAL over a UNION ALL, one scan of quarterly_sales
select qs.region, v.quarter, v.amount
  from quarterly_sales qs
  join lateral (          select 'Q1' as quarter, qs.q1 as amount
                union all select 'Q2', qs.q2
                union all select 'Q3', qs.q3
                union all select 'Q4', qs.q4) as v;
```

The book's recipe 12.4 collapses nicely into this form too — the recursive CTE
that manufactured four rows becomes a four-element `VALUES` list, and the
`ROW_NUMBER()`/`CASE` pair disappears entirely:

```sql
select e.empno, v.ord, v.emps
  from emp e
  cross join lateral (values (1, e.ename),
                             (2, e.job),
                             (3, e.sal::text),
                             (4, null)) as v(ord, emps)
 where e.deptno = 10
 order by e.empno, v.ord;
```

The explicit `(4, null)` row is the blank separator, stated directly instead of
implied by a missing `CASE` branch.

### SQL Server's native UNPIVOT

SQL Server is the one engine of the three with a first-class operator for
this, and it has had it since SQL Server 2005:

```sql
select VendorID, Employee, Orders
  from ( select VendorID, Emp1, Emp2, Emp3, Emp4, Emp5 from pvt ) p
 unpivot ( Orders for Employee in (Emp1, Emp2, Emp3, Emp4, Emp5) ) as unpvt;

-- VendorID  Employee  Orders
-- --------- --------- ------
--        1  Emp1           4
--        1  Emp2           3
--        1  Emp3           5
-- ...
```

`Orders` is the *value column* (where the cell values land), `Employee` is the
*pivot column* (where the source column **names** land), and the `IN (...)`
list is the set of columns being transposed. Two behaviors are worth knowing
before you use it:

- **`UNPIVOT` drops NULLs.** Microsoft's own documentation says it outright:
  "`NULL` values in the input of `UNPIVOT` disappear in the output." A row
  whose `Q4` is `NULL` simply produces no `Q4` row. The `UNION ALL` and
  `LATERAL` forms above keep it (note `SOUTH | Q4 |` with an empty amount in
  the PostgreSQL output). If you want the row preserved on SQL Server, wrap
  the value in `ISNULL(...)`/`COALESCE(...)` inside the source subquery.
- **The pivot column is `nvarchar(128)`.** Because it carries column
  *identifiers* (type `sysname`), the label column comes out as
  `nvarchar(128)` whether you want that or not — Fabric Data Warehouse
  doesn't even accept that type in a `CREATE TABLE AS`, so a `CAST` is
  required there.

Neither PostgreSQL nor MySQL has an `UNPIVOT` operator, in any current
version. MySQL 8.4 answers the syntax with a flat parse error:

```
ERROR 1064 (42000): You have an error in your SQL syntax; check the manual ...
near '(amount for quarter in (q1,q2)) u'
```

There is no pending PostgreSQL feature for it either — `CROSS JOIN LATERAL
(VALUES ...)` is the idiom, and it is the one PostgreSQL's own community and
migration guides point Oracle/SQL Server users at.

## Trade-offs

- **`UNION ALL` re-reads the source once per column; `LATERAL` reads it
  once.** With four columns that's a 4× difference in scans on the same data,
  and it grows linearly with the column count. On a small denormalized report
  table nobody will notice; on a wide fact table with a dozen year-columns and
  a filter that isn't index-covered, it's the whole cost of the query. The
  plans above show it explicitly — `Append` over N `Seq Scan`s versus a single
  `Seq Scan` feeding a `Values Scan`.
- **Every branch of the unpivot must unify to one data type, and the engine
  will not do it for you.** The value column has exactly one type, so mixing a
  `text` column and a `numeric` column in the same list is an error, not a
  coercion — which is precisely why the book writes `cast(sal as char(4))`:
  ```sql
  -- PostgreSQL, mixing a text column and a numeric column in one VALUES list
  cross join lateral (values ('region', qs.region), ('q1', qs.q1)) as v(attr, val)
  -- ERROR: VALUES types text and numeric cannot be matched
  ```
  Casting to text to make it compile is the usual fix, but it means the value
  column is no longer sortable or comparable as a number downstream.
- **SQL Server's `UNPIVOT` silently discards NULL inputs; the portable forms
  don't.** This is a genuine semantic difference, not a syntax preference — a
  row that exists in a `UNION ALL`/`LATERAL` result is simply absent from an
  `UNPIVOT` result. If downstream code counts rows, joins on the label column,
  or expects a fixed four-rows-per-region shape, migrating between the two
  spellings changes the answer.
- **The column list is always static, on every engine.** You have to name each
  column being transposed in the query text, so adding a `Q5` means editing
  every unpivot query that touches the table. Dynamic column sets require
  building the SQL string at runtime (or, on PostgreSQL, going through
  JSON — `jsonb_each` over `to_jsonb(t)` unpivots whatever columns happen to
  exist). This constraint is exactly why the *forward* pivot is the operation
  worth avoiding in the first place: data stored long doesn't need unpivoting.
- **The book's `CROSS JOIN` + `CASE` technique still works everywhere, but
  it's the most fragile of the three.** It couples correctness to an unrelated
  table's cardinality (`dept` happens to have enough rows), it re-derives the
  row multiplier by hand, and a missing `WHEN` branch fails as a silent `NULL`
  rather than an error. Reach for `LATERAL` first, `UNION ALL` when you need
  the SQL to run on anything older, and the `CROSS JOIN`/`CASE` form only when
  you're reading code that already uses it.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 12, "Reporting and Reshaping", recipes 12.3, 12.4, p. 377-382 — doc
- [Microsoft Learn — Using PIVOT and UNPIVOT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-using-pivot-and-unpivot) — doc
- [PostgreSQL Documentation — LATERAL Subqueries](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL) — doc
- [MySQL Reference Manual — Lateral Derived Tables (8.0.14+)](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html) — doc
