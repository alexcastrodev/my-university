---
version: 1.0
updatedAt: 2026-08-01
---
## Objective

A plain `JOIN` only returns rows that match on both sides — but two everyday
problems need the opposite or an extension of that: finding rows that have
*no* match at all (an anti-join), and adding optional data to a query that
already returns the right rows, without losing any of them just because the
extra data doesn't exist for every row. Both are solved with the same tool —
`LEFT [OUTER] JOIN` — used in two different ways.

## Use Cases

- Finding every department with zero employees, to flag it for review or
  closure, without hand-listing department numbers.
- Auditing which parent rows across two related tables never got a matching
  child row — orphaned reference data, expired accounts with no renewal,
  products with no orders.
- Adding a "date of last bonus" column to an existing, already-correct
  employee report, without turning it into an inner join that silently drops
  every employee who's never received a bonus.

## Deep Dive

### Finding rows with no match: the anti-join

```sql
select d.*
  from dept d
  left outer join emp e
    on (d.deptno = e.deptno)
 where e.deptno is null
```

An inner join on `deptno` would only return departments that *have* at least
one employee. Flipping it to a `LEFT JOIN` keeps every `dept` row regardless
of a match, filling in `NULL` for `emp` columns where none exists — filtering
afterward for `e.deptno IS NULL` keeps only the departments that never
matched. This pattern is called an anti-join: outer join, then discard
everything that *did* match.

The book's recipe 3.4 (`NOT EXISTS` with a correlated subquery) solves the
exact same problem from a different angle — it never produces the
matched/unmatched superset at all, it just asks "does at least one match
exist?" per outer row. Both return identical results here; which one to use
is often a readability question rather than a performance one, though see
the Trade-offs below for where that's not quite the whole story.

### Adding optional data without losing rows

Starting from a query that's already correct — every employee with their
department's location:

```sql
select e.ename, d.loc
  from emp e, dept d
 where e.deptno = d.deptno
```

Naively joining in a bonus table would lose every employee without a bonus,
because an inner join only keeps matched rows:

```sql
-- WRONG: silently drops employees with no bonus row
select e.ename, d.loc, eb.received
  from emp e, dept d, emp_bonus eb
 where e.deptno = d.deptno
   and e.empno = eb.empno
```

The fix is the same `LEFT JOIN` mechanism, just for the opposite purpose this
time — keep every row from the already-correct query, and let the added
table contribute `NULL` where it has nothing to add:

```sql
select e.ename, d.loc, eb.received
  from emp e join dept d
    on (e.deptno = d.deptno)
  left join emp_bonus eb
    on (e.empno = eb.empno)
 order by 2
```

### The scalar-subquery alternative

A subquery placed directly in the `SELECT` list is a second way to bolt on
optional data without touching the join that already produces the correct
row set:

```sql
select e.ename, d.loc,
       (select eb.received
          from emp_bonus eb
         where eb.empno = e.empno) as received
  from emp e, dept d
 where e.deptno = d.deptno
 order by 2
```

This form is convenient specifically because it requires zero changes to an
existing, already-working `FROM`/`WHERE` — but the subquery must return at
most one row per outer row (a true scalar value); a subquery returning more
than one row raises a runtime error on every mainstream database.

## Trade-offs

- **Anti-join (`LEFT JOIN` + `IS NULL`) and `NOT EXISTS` are two spellings of
  the same idea, and both MySQL and PostgreSQL recognize it — but not
  identically.** MySQL's own reference manual confirms that when the `IS
  NULL` test targets a column declared `NOT NULL`, "MySQL stops searching for
  more rows (for a particular key combination) after it has found one row
  that matches the `LEFT JOIN` condition" — a real short-circuit, not a naive
  join-then-filter (visible in `EXPLAIN` output as `Using where; Not
  exists`). That said, independent benchmarks on MySQL still generally show
  `NOT EXISTS`/`NOT IN` holding up better than `LEFT JOIN`/`IS NULL` once the
  compared column is nullable or lacks a supporting index — the anti-join
  form is the recipe's tool of choice specifically because it returns actual
  columns from the non-matching side (like `dept.*` above), not because it's
  guaranteed faster than `NOT EXISTS` in every case.
- **The `IS NULL` filter must target a column that's genuinely `NOT NULL` on
  the inner table** (or a composite/primary key) — filtering on a column that
  can itself legitimately be `NULL` in real matched rows silently discards
  correct matches along with the true non-matches. This is the anti-join's
  sharp edge: it looks like a small addition to an outer join, but picking
  the wrong column changes the meaning of the whole query.
- **A scalar subquery in the `SELECT` list changes nothing about the
  surrounding query's correctness, which is exactly its appeal and its
  limit.** It's the least invasive way to add one optional value to an
  already-correct report, but it doesn't generalize — needing two or three
  optional columns from the same or different tables is more naturally a
  `LEFT JOIN` per table than a stack of scalar subqueries.
- **Book vs. today:** PostgreSQL's planner has steadily gotten better at
  recognizing more `LEFT JOIN`/`NOT IN` shapes as efficient anti-joins over
  successive major versions, with PostgreSQL 19 (currently in beta at time of
  writing) continuing that trend — worth re-checking `EXPLAIN` output on a
  current PostgreSQL version rather than assuming an older version's plan
  shape still applies.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 3, "Working with Multiple Tables", recipes 3.5-3.6, p. 40-43 — doc
- [MySQL Reference Manual — Outer Join Optimization](https://dev.mysql.com/doc/refman/8.4/en/outer-join-optimization.html) — doc
- [PostgreSQL Documentation — Explicit Joins (LEFT/RIGHT/FULL JOIN)](https://www.postgresql.org/docs/current/queries-table-expressions.html) — doc
- [SQL Server Documentation — Subqueries (scalar subqueries in the SELECT list)](https://learn.microsoft.com/en-us/sql/relational-databases/performance/subqueries) — doc
