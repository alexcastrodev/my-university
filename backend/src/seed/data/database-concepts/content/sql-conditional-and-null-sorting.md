---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

`ORDER BY column` only gets you so far. Two problems need more: sorting NULLs to
a specific place independent of how non-NULL values sort, and sorting by a key that
depends on another column's value (sort salespeople by commission, everyone else
by salary). Both are solved by putting an *expression*, not a bare column name, in
`ORDER BY` — though which databases need that expression at all differs more than
you'd expect.

## Use Cases

- Displaying missing values consistently last (or first) in a UI list, independent of
  how the non-NULL values happen to sort.
- Building a report where the sort key itself depends on a row's category — order
  by commission for salespeople, by salary for everyone else, in one query.
- Writing a portable `ORDER BY` that needs to behave the same on PostgreSQL,
  MySQL, and SQL Server without three different code paths.

## Deep Dive

### Native NULLS FIRST/LAST — only one of the three actually has it

```sql
-- PostgreSQL
select ename, sal, comm from emp order by comm nulls last;
select ename, sal, comm from emp order by comm nulls first;
```

PostgreSQL has supported `NULLS FIRST`/`NULLS LAST` directly in `ORDER BY` since
version **8.3, released in 2008** — over a decade before this book's 2020 edition.
MySQL and SQL Server have never had equivalent native syntax; both still require a
workaround today.

### The portable workaround: a CASE-flag column

Works on every database, including PostgreSQL (where it's just unnecessary given
the native syntax above):

```sql
select ename, sal, comm
  from (
select ename, sal, comm,
       case when comm is null then 0 else 1 end as is_null
  from emp
       ) x
 order by is_null desc, comm;   -- non-NULL comm ascending, NULLs last
```

Swap `is_null desc` for `is_null` (no `desc`) to put NULLs first instead; swap `comm`
for `comm desc` to reverse the non-NULL ordering independently of where NULLs
land. The flag column controls NULL placement; the second sort key controls
everything else, and the two are independent of each other.

### MySQL's shortcut: exploiting boolean coercion

MySQL evaluates `comm IS NULL` to `1` (true) or `0` (false), which sorts directly
without needing a full `CASE`:

```sql
select ename, sal, comm from emp order by comm is null, comm;   -- NULLs last
select ename, sal, comm from emp order by comm is null desc, comm;  -- NULLs first
```

Shorter than the portable `CASE` form, but it leans on an implicit boolean-to-integer
coercion that isn't obvious to someone unfamiliar with the idiom — worth a comment
where it's used.

### Sorting by a data-dependent key

The same "expression instead of column name" idea sorts by different columns per
row:

```sql
select ename, sal, job, comm
  from emp
 order by case when job = 'SALESMAN' then comm else sal end;
```

Salespeople sort by `comm`; everyone else sorts by `sal` — one `ORDER BY`, one
query, no post-processing or client-side re-sorting.

## Trade-offs

- **The book treats PostgreSQL as needing the same NULL-sorting workaround as
  MySQL and SQL Server — that's not a "things changed since 2020" gap, it's simply
  inaccurate.** PostgreSQL has had native `NULLS FIRST`/`LAST` since 2008, over a
  decade before this book's second edition. Using the portable `CASE` workaround
  on PostgreSQL still works, but it's unnecessary verbosity for a problem the
  database already solves natively — reach for `NULLS FIRST`/`LAST` there instead.
- **A `CASE` expression in `ORDER BY` obscures intent at a glance.** `order by sal`
  tells a reader exactly what's happening; `order by case when job = 'SALESMAN'
  then comm else sal end` requires mentally evaluating the expression per row
  before the sort key is even clear — worth a comment explaining *why* the sort key
  varies, not just what the `CASE` does.
- **MySQL's `col IS NULL, col` idiom is concise specifically because it's clever** —
  the same trade-off as any one-liner that relies on an implicit type coercion: fast
  to write, easy to misread for someone who hasn't seen the trick before.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 2, "Sorting Query Results", recipes 2.5-2.6, p. 21-27 — doc
- [PostgreSQL Documentation — ORDER BY Clause (NULLS FIRST/LAST, added in 8.3)](https://www.postgresql.org/docs/current/queries-order.html) — doc
- [MySQL Reference Manual — Working with NULL Values](https://dev.mysql.com/doc/refman/8.4/en/null-values.html) — doc
- [SQL Server Documentation — ORDER BY Clause (no native NULLS FIRST/LAST; CASE-based conditional sort example)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) — doc
