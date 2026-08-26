---
version: 1.0
updatedAt: 2026-07-31
---
## Objective

Combining two SELECT statements vertically — stacking one rowset directly
atop another, rather than joining them side by side — is one of SQL's four
set operations. `UNION ALL` and `UNION` are the everyday tools; `INTERSECT`
and `EXCEPT` round out the family for "what's common" and "what's different"
questions. All four behave nearly identically across PostgreSQL, MySQL, and
SQL Server today — but that wasn't true as recently as 2022.

## Use Cases

- Combining rows from structurally different tables into one report — e.g.
  employee names and department names in a single "directory" column, as
  in the book's own example.
- Merging results from a UNION of similar tables (an archive table plus a
  live table, or same-shaped tables partitioned across regions/tenants)
  into one query.
- Building a "changed rows" or "missing rows" report between two datasets
  without writing a join — `INTERSECT`/`EXCEPT` say directly what a
  correlated subquery or anti-join would otherwise have to spell out.
- Deduplicating the combination of two queries as a side effect of `UNION`,
  instead of adding an explicit `DISTINCT`.

## Deep Dive

### Stacking rowsets with UNION ALL

```sql
select ename as ename_and_dname, deptno
  from emp
 where deptno = 10
union all
select dname, deptno
  from dept;
```

`UNION ALL` appends the second query's rows straight onto the first's. As
with every set operation, the two SELECT lists must match in **number of
columns** and have **compatible data types** column-for-column — that rule
is identical on PostgreSQL, MySQL, and SQL Server, and each engine rejects
a mismatched query at parse time rather than silently truncating or
padding it. Result column names come from the first SELECT.

### UNION deduplicates — and pays for it with a sort or hash

```sql
select deptno from emp
union
select deptno from dept;
```

`UNION` is `UNION ALL` plus duplicate elimination — equivalent to wrapping
the `UNION ALL` result in an outer `SELECT DISTINCT`:

```sql
select distinct deptno
  from (
        select deptno from emp
        union all
        select deptno from dept
       ) combined;
```

Removing duplicates isn't free: the engine has to sort or hash the entire
combined result set to find them, on all three databases. `UNION ALL`
skips that step entirely. The rule of thumb the book states plainly still
holds today: don't reach for `UNION` (or `DISTINCT`) unless duplicates are
actually possible and actually unwanted — reach for `UNION ALL` by default.

### The wider family: INTERSECT and EXCEPT

`INTERSECT` returns rows common to both queries; `EXCEPT` returns rows in
the first query but not the second — both apply the same column-count/type
rules as `UNION`, and both deduplicate by default:

```sql
-- rows in both EMP and V (recipe 3.3's INTERSECT alternative to a multi-column join)
select ename, job, sal from emp
intersect
select ename, job, sal from v;

-- departments with no employees (recipe 3.4)
select deptno from dept
except
select deptno from emp;
```

> Oracle uses different vocabulary for the same operator: `MINUS` instead
> of `EXCEPT`. It's the same set-difference semantics under another name —
> a reminder that "the SQL standard operator" and "the operator every
> vendor spells the same way" aren't the same claim.

### MySQL's 2022 catch-up: INTERSECT and EXCEPT didn't exist before 8.0.31

This is the one place the book's own MySQL solutions reveal their age.
Recipe 3.3 gives MySQL a multi-column `JOIN` as the *only* way to find
common rows, and recipe 3.4 gives it a `NOT IN` subquery as the *only* way
to find a set difference — explicitly because, in 2020, MySQL had no
`INTERSECT` or `EXCEPT` at all. That gap closed in **MySQL 8.0.31 (GA
2022-10-11)**, which added both operators with the same `[ALL | DISTINCT]`
modifiers `UNION` already had:

```sql
-- MySQL 8.0.31+: no longer needs the join/subquery workaround
select ename, job, sal from emp
intersect
select ename, job, sal from v;

table dept except table emp;   -- MySQL also allows bare TABLE t syntax
```

The book's join/subquery patterns aren't wrong today — they still work —
but they're no longer the *only* option, and reading MySQL code or
tutorials written before late 2022 that lean on those patterns should be
read as "written for a MySQL that couldn't do this any other way," not as
a stylistic choice.

### SQL Server's remaining gap: no ALL variant for EXCEPT/INTERSECT

Where PostgreSQL and modern MySQL both support `INTERSECT ALL` and
`EXCEPT ALL` (keeping row multiplicity instead of collapsing to distinct
rows), SQL Server's `EXCEPT`/`INTERSECT` syntax has **no `ALL` keyword at
all** — only `UNION` gets the `ALL`/no-`ALL` choice in T-SQL. Needing
"set difference with duplicates retained per multiplicity" on SQL Server
means rolling it by hand (typically `ROW_NUMBER()` partitioned per value,
compared across both sides) — a real, still-current portability gap
between SQL Server and the other two.

### Precedence: the one thing all three agree on

`INTERSECT` binds tighter than `UNION`/`EXCEPT` on PostgreSQL, MySQL, and
SQL Server alike — `a UNION b INTERSECT c` is always `a UNION (b INTERSECT c)`
on all three. `UNION` and `EXCEPT` themselves evaluate left to right. This
is a rare case where the three engines agree exactly, but it's still worth
parenthesizing explicitly in mixed set-operation queries — relying on
memorized precedence rules in a four-line query is the kind of thing that
reads wrong to the next person even when it evaluates right.

## Trade-offs

- **`UNION ALL` should be the default; `UNION` is a deliberate, costed
  choice.** The dedup step is a real sort/hash over the whole combined
  result on every engine — reach for `UNION` only when duplicates are
  actually possible in the data and actually unwanted in the output.
- **Column-list mismatches fail loudly, not silently, everywhere.** Wrong
  column count or incompatible types across the two SELECTs is a
  parse-time error on PostgreSQL, MySQL, and SQL Server alike — there's no
  vendor where a shape mismatch gets padded or coerced into something that
  quietly returns wrong data.
- **MySQL's `INTERSECT`/`EXCEPT` gap is closed, but only since October
  2022 (8.0.31).** Code, tutorials, and — notably — this very book's own
  MySQL solutions predating that release fall back to joins and `NOT IN`
  subqueries not by preference but because there was no operator to use;
  don't read those workarounds as the modern idiom.
- **SQL Server's missing `EXCEPT ALL`/`INTERSECT ALL` is the one genuine
  feature gap left standing.** PostgreSQL and current MySQL both support
  multiplicity-preserving set difference/intersection natively; SQL Server
  requires a hand-rolled `ROW_NUMBER()`-based workaround for the same
  result — this is not a book-vs-today issue, just a real, current
  T-SQL limitation.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.1 "Stacking One Rowset atop Another", p. 29-31 — doc
- [PostgreSQL Documentation — Combining Queries (UNION, INTERSECT, EXCEPT)](https://www.postgresql.org/docs/current/queries-union.html) — doc
- [MySQL Reference Manual — UNION Clause](https://dev.mysql.com/doc/refman/8.0/en/union.html) — doc
- [MySQL Reference Manual — Set Operations (INTERSECT, EXCEPT, since 8.0.31)](https://dev.mysql.com/doc/refman/8.0/en/set-operations.html) — doc
- [SQL Server Documentation — Set Operators: UNION (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql) — doc
