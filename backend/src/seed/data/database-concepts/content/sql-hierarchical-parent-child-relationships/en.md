---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

The simplest form of hierarchical data isn't a separate tree table — it's a single
table with a self-referencing foreign key: `emp.mgr` holds an `empno` value that
points at another row of `emp`. Every manager is also an employee, so the whole
hierarchy lives in one table and the "parent" of any row is found by following
`mgr` back to `empno`. Querying that relationship means joining the table to
*itself*: one self-join expresses one level of hierarchy (employee → manager),
two self-joins express two levels (employee → manager → manager's manager), and
so on — the number of joins is fixed at write time and hard-codes the depth the
query can see. That works cleanly when you know the depth and it's small. For
hierarchies of arbitrary or unknown depth, the fixed self-join chain stops
scaling and the recursive-CTE technique in
[Recursive Hierarchy Queries and Tree Traversal](sql-recursive-hierarchy-queries)
is the right tool instead.

## Use Cases

- A basic org chart: list every employee alongside the name of their direct
  manager, rendered as "FORD works for JONES".
- A two-level org chart: employee → manager → director, where you want all three
  names on one row for a report or an export.
- A category tree with a known, shallow shape — `category.parent_id` where the
  taxonomy is fixed at two levels (department → sub-department) and the depth
  won't change.
- Any lookup where a row must be displayed together with its parent's attributes
  (a comment plus the comment it replies to, an order line plus its parent
  order revision) and only one hop is ever needed.

## Deep Dive

### One self-join for one level

The `emp` table stores the hierarchy in two columns: `empno` identifies the
employee, `mgr` holds their manager's `empno`.

```sql
select empno, mgr
  from emp
 order by 2;

     EMPNO        MGR
---------- ----------
      7788       7566
      7902       7566
      7499       7698
      ...
      7369       7902
      7839              -- KING, the root: no manager, MGR is NULL
```

To get each employee's manager's *name*, join `emp` to a second copy of itself
and match the child's `mgr` against the parent's `empno`:

```sql
select a.ename || ' works for ' || b.ename as emps_and_mgrs
  from emp a, emp b
 where a.mgr = b.empno;

EMPS_AND_MGRS
------------------------------
FORD works for JONES
SCOTT works for JONES
JAMES works for BLAKE
...
SMITH works for FORD
```

Mechanically this is a Cartesian product filtered down: `from emp a, emp b`
produces every `empno`/`empno` combination, and `where a.mgr = b.empno` keeps
only the pairs where `b` really is `a`'s manager. Writing it as an explicit
`JOIN` is the same query and reads better:

```sql
select a.ename as employee, b.ename as manager
  from emp a
  join emp b on a.mgr = b.empno;
```

Only the string-concatenation operator differs across vendors — the self-join
itself is identical everywhere: `||` on PostgreSQL, `concat(...)` on MySQL, `+`
on SQL Server.

```sql
-- MySQL
select concat(a.ename, ' works for ', b.ename) as emps_and_mgrs
  from emp a join emp b on a.mgr = b.empno;

-- SQL Server
select a.ename + ' works for ' + b.ename as emps_and_mgrs
  from emp a join emp b on a.mgr = b.empno;
```

There is one trap worth naming: an inner join **drops the root**. `KING` has
`mgr IS NULL`, and `NULL = b.empno` is never true, so `KING` never appears in
the result above. Keeping the root means an outer join:

```sql
select a.ename as employee, b.ename as manager
  from emp a
  left join emp b on a.mgr = b.empno;

ENAME      MGR
---------- ----------
FORD       JONES
...
SMITH      FORD
KING                    -- root now present, manager NULL
```

A scalar subquery is an equivalent formulation and has the same NULL-preserving
behavior as the left join, which sometimes makes it the more intuitive way to
read the relationship:

```sql
select a.ename,
       (select b.ename from emp b where b.empno = a.mgr) as mgr
  from emp a;
```

### Two self-joins for two levels

Each additional level of hierarchy costs one more copy of the table in the
`FROM` clause and one more join predicate. Employee `MILLER` works for `CLARK`,
who works for `KING` — three tiers, so three aliases and two joins:

```sql
select a.ename as leaf,
       b.ename as branch,
       c.ename as root
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
 where a.ename = 'MILLER';

LEAF     BRANCH   ROOT
-------- -------- --------
MILLER   CLARK    KING
```

Formatted as the book's single-column path:

```sql
select a.ename || '-->' || b.ename || '-->' || c.ename
       as leaf___branch___root
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
 where a.ename = 'MILLER';

LEAF___BRANCH___ROOT
---------------------
MILLER-->CLARK-->KING
```

The pattern is completely regular, and that regularity is exactly the problem.
A third level is a fourth alias and a third join:

```sql
select a.ename, b.ename, c.ename, d.ename
  from emp a
  join emp b on a.mgr = b.empno
  join emp c on b.mgr = c.empno
  join emp d on c.mgr = d.empno;
```

Two things degrade at once. First, the join chain grows linearly with depth —
`n` levels means `n-1` joins, `n` aliases, and `n` columns to project, all
typed out by hand. Second, and worse, the inner joins **silently filter**: the
four-alias query above returns only employees who have a full four-deep chain
of managers above them, so `MILLER` (only three deep) disappears entirely.
Making shallower branches survive means switching every join to `LEFT JOIN` and
then coalescing over the possibly-`NULL` columns, which is where readability
falls off a cliff:

```sql
select a.ename,
       coalesce(d.ename, c.ename, b.ename, a.ename) as topmost_known
  from emp a
  left join emp b on a.mgr = b.empno
  left join emp c on b.mgr = c.empno
  left join emp d on c.mgr = d.empno;
```

Past two or three levels the self-join chain is answering the wrong question:
it can only express a hierarchy whose depth is a compile-time constant, and
real trees rarely are. That is precisely the gap recursive CTEs close — a
`WITH RECURSIVE` query walks from a starting row up (or down) the hierarchy
until it runs out of parents, with no join count baked into the text. See
[Recursive Hierarchy Queries and Tree Traversal](sql-recursive-hierarchy-queries)
for that technique and for the leaf/branch/root classification that falls out
of it.

## Trade-offs

- **Simple and fast for shallow, fixed-depth hierarchies — useless for variable
  depth.** A one- or two-level self-join is an ordinary join: the planner sees
  it as such, an index on `empno` (usually the primary key) makes the lookup a
  cheap index probe per row, and there's no recursion machinery involved. But
  the depth is hard-coded in the query text, so a hierarchy that might be two
  levels for one row and six for another cannot be expressed at all.
- **Inner joins silently drop rows that don't reach the required depth.** This
  is the failure mode that bites in production, because it produces a *smaller
  correct-looking result* rather than an error: a three-alias query returns
  nothing for an employee whose manager has no manager, and the root of the
  tree vanishes from a one-level join because `mgr IS NULL` never matches.
  `LEFT JOIN` fixes it, at the cost of every parent column becoming nullable
  and every downstream expression needing `COALESCE`.
- **Readability degrades with each join level.** One self-join reads fine, two
  is still followable, three is a wall of single-letter aliases where
  `c.mgr = d.empno` carries no hint about which tier it represents. There's no
  syntax to make `a`/`b`/`c`/`d` self-documenting beyond renaming them
  (`employee`, `manager`, `director`), which helps but doesn't stop the query
  from growing linearly.
- **The syntax is genuinely stable — the judgment call is what changed.** A
  self-join is just a join with two aliases over the same table; PostgreSQL,
  MySQL, and SQL Server have all supported it unchanged for decades, and
  nothing in the book's 13.1/13.2 solutions is deprecated. What has changed
  since the first edition is the alternative: recursive CTEs are now available
  in every major engine (MySQL got them in 8.0), so "chain more self-joins"
  is a deliberate choice for known-shallow data rather than the only option
  for deeper trees.
- **Only the concatenation operator is a portability concern.** `||` vs.
  `CONCAT()` vs. `+` differ across vendors, but that's a string-formatting
  detail layered on top — the join itself ports verbatim. Selecting the parent
  columns separately instead of concatenating them sidesteps the difference
  entirely and keeps the query engine-agnostic.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 13, "Hierarchical Queries", recipes 13.1, 13.2, p. 436-444 — doc
- [PostgreSQL Documentation — Joins Between Tables (self-join with table aliases)](https://www.postgresql.org/docs/current/tutorial-join.html) — doc
- [MySQL Reference Manual — JOIN Clause](https://dev.mysql.com/doc/refman/8.4/en/join.html) — doc
