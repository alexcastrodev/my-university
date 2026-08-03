---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

A single outer join already solves "show me every row from one table, matched
against the other where possible" — but it only protects *one* side. Left-
joining `DEPT` to `EMP` keeps every department, including ones with no
employees, but an employee that somehow has no department still gets silently
dropped, because the join is only outer on one side. Returning the missing rows
from *both* tables in the same result set needs a genuinely different
mechanism: a full outer join.

## Use Cases

- Auditing referential integrity between two tables in both directions at
  once — parent rows with no children, and orphaned child rows with no
  parent — in a single query instead of two separate ones.
- Building a combined report that must show every department (even empty
  ones) and every employee (even one with no assigned department, a data
  quality issue worth surfacing rather than hiding).
- Reconciling two datasets that are supposed to line up — a source system and
  a downstream copy — where "missing from either side" is itself the thing
  being investigated.

## Deep Dive

### Why a single-sided outer join isn't enough

A `LEFT OUTER JOIN` from `DEPT` to `EMP` keeps every department, including the
one with no employees at all:

```sql
select d.deptno, d.dname, e.ename
  from dept d left outer join emp e
    on (d.deptno = e.deptno)

   DEPTNO DNAME          ENAME
--------- -------------- ----------
       20 RESEARCH       SMITH
       30 SALES          ALLEN
       ...
       40 OPERATIONS
```

`OPERATIONS` (department 40) appears with no `ENAME`, exactly as intended —
but this join says nothing about an employee who might exist with *no*
department at all. Flipping to a `RIGHT OUTER JOIN` fixes that half of the
problem but breaks the other: it recovers a deliberately inserted
no-department employee (`YODA`), but `OPERATIONS` disappears from the result,
because the join is now only outer-protecting `EMP`'s side. Neither single
join, on its own, can protect both tables' unmatched rows in the same query.

### DB2, MySQL, PostgreSQL, SQL Server: FULL OUTER JOIN — or a UNION workaround

The explicit `FULL OUTER JOIN` keyword returns unmatched rows from both sides
in one query:

```sql
select d.deptno, d.dname, e.ename
  from dept d full outer join emp e
    on (d.deptno = e.deptno)
```

`OPERATIONS` (unmatched on the `DEPT` side) and `YODA` (unmatched on the `EMP`
side) both appear in the same result set, alongside every normally-matched
row. MySQL is the one mainstream engine here with no native `FULL OUTER JOIN`
— the book's fallback unions a `RIGHT OUTER JOIN` with a `LEFT OUTER JOIN` to
get the same combined result:

```sql
select d.deptno, d.dname, e.ename
  from dept d right outer join emp e
    on (d.deptno = e.deptno)
union
select d.deptno, d.dname, e.ename
  from dept d left outer join emp e
    on (d.deptno = e.deptno)
```

Plain `UNION` (not `UNION ALL`) is what makes this correct rather than
duplicating every normally-matched row: rows that match on both sides appear
identically in both halves of the union, and `UNION`'s built-in
deduplication collapses each pair back down to one row.

### Oracle: ANSI FULL OUTER JOIN, or the proprietary (+) syntax via UNION

Oracle accepts either of the solutions above directly. It also has its own
proprietary outer-join marker, `(+)`, attached to the column on the side that
should be padded with `NULL`s when unmatched — but `(+)` has no full-outer
equivalent on its own, so reaching for it here means the same union-of-two-
outer-joins pattern MySQL needs, just spelled with `(+)` instead of
`LEFT`/`RIGHT OUTER JOIN`:

```sql
select d.deptno, d.dname, e.ename
  from dept d, emp e
 where d.deptno = e.deptno(+)
union
select d.deptno, d.dname, e.ename
  from dept d, emp e
 where d.deptno(+) = e.deptno
```

### What a full outer join is doing underneath

A full outer join is exactly the union the fallback solutions spell out
explicitly: run the left outer join, run the right outer join, union the two
result sets together. The left-joined query keeps every `DEPT` row (including
unmatched `OPERATIONS`); the right-joined query keeps every `EMP` row
(including unmatched `YODA`); every normally-matched row appears in both
halves and gets deduplicated by the union. `FULL OUTER JOIN` is a shorthand
for that combination, not a fundamentally different join algorithm.

## Trade-offs

- **A full outer join (or its union-based equivalent) can only be as correct
  as the join condition itself.** A loose or incorrect `ON` condition still
  produces wrong pairings on both sides simultaneously — protecting against
  missing rows doesn't protect against a join key that's wrong to begin with.
- **The union-based fallback costs a sort/dedup pass that a native
  `FULL OUTER JOIN` doesn't necessarily need.** `UNION` (not `UNION ALL`) has
  to compare every row from both halves to remove duplicates; on large
  tables, this is real overhead a database's native full-outer-join
  implementation can often avoid by tracking matched/unmatched rows directly
  during a single pass instead.
- **MySQL still has no native `FULL OUTER JOIN` — this isn't dated advice
  from 2020, it's still the current state.** Confirmed against MySQL's
  current reference documentation: the `JOIN` clause page lists inner and
  left/right outer joins, with no `FULL [OUTER] JOIN` keyword. The book's
  union-of-two-outer-joins workaround for MySQL remains the only option
  there, not a historical artifact later superseded by a native keyword.
- **Book vs. today (a simplification the book itself leaves on the table,
  not something that changed since): Oracle's `(+)` syntax needing the same
  union workaround as MySQL is a real limitation of `(+)`, but Oracle has
  supported the plain ANSI `FULL OUTER JOIN` keyword directly since Oracle
  9i (2001) — a fact the book's own text acknowledges ("Oracle users can
  still use either of the preceding solutions") without stating why anyone
  would prefer `(+)` here at all.** Since `(+)` offers no advantage over
  ANSI syntax for this specific case — and actively needs a two-query union
  where `FULL OUTER JOIN` needs one — there's little reason for an Oracle
  query to ever use the `(+)`-based version of this particular recipe;
  Oracle's own SQL language reference documents `FULL OUTER JOIN` as
  standard ANSI join syntax, available identically to DB2/PostgreSQL/SQL
  Server.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipe 3.11, p. 60-63 — doc
- [PostgreSQL Documentation — Joined Tables (FULL [OUTER] JOIN)](https://www.postgresql.org/docs/current/queries-table-expressions.html) — doc
- [MySQL Reference Manual — JOIN Clause (no native FULL OUTER JOIN)](https://dev.mysql.com/doc/refman/8.0/en/join.html) — doc
- [Oracle Database SQL Language Reference — Joins (ANSI outer join syntax since Oracle 9i)](https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/SELECT.html) — doc
