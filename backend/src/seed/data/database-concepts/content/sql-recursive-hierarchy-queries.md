---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A self-referencing table — `emp.mgr` pointing at `emp.empno`, a category's
`parent_id` pointing at another category — encodes a hierarchy of *unknown*
depth. A fixed chain of self-joins (see
[Hierarchical Parent-Child Relationships](sql-hierarchical-parent-child-relationships))
handles the shallow, known-depth case: one join per level, three joins for
three levels. It cannot handle "walk down until there's nothing left," because
the number of joins would have to be written before you know how deep the data
goes. The recursive CTE does exactly that: an **anchor member** picks the
starting rows, a **recursive member** joins the CTE back to the base table to
find one level's worth of children, and the engine re-runs the recursive member
against each new batch of rows until it returns none.

## Use Cases

- Rendering a full org chart — every employee, indented under their manager,
  for a hierarchy that is four levels deep today and six next quarter, with no
  query change.
- Finding every employee who reports up through a given manager, directly or
  indirectly, for a permissions check or a "whose budget does this hit" report.
- Categorizing a product-category tree into **leaf** categories (which are the
  only ones allowed to hold products) versus **branch** categories (which exist
  only to organize other categories), so the UI knows which nodes are
  selectable.
- Exploding a bill of materials: given an assembly, list every component and
  sub-component at any depth beneath it.
- Auditing a hierarchy for orphans and multiple roots before a migration —
  rows whose parent no longer exists, or a tree that turns out to have three
  roots instead of one.

## Deep Dive

### A hierarchical view of the whole table

The book's `EMP` table is the canonical shape: `empno` is the key, `mgr` points
at another row's `empno`, and the root (KING) has `mgr IS NULL`.

```sql
create table emp (
  empno integer primary key,
  ename varchar(10),
  mgr   integer references emp(empno)
);
```

Recipe 13.3 builds the full tree by anchoring on the root and concatenating
each employee's name onto their manager's path:

```sql
-- PostgreSQL
with recursive x (ename, empno) as (
  select cast(ename as varchar(100)), empno
    from emp
   where mgr is null                       -- anchor member: the root row(s)
  union all
  select cast(x.ename || ' - ' || e.ename as varchar(100)), e.empno
    from emp e, x                          -- recursive member: one level down
   where e.mgr = x.empno
)
select ename as emp_tree
  from x
 order by 1;
```

```
EMP_TREE
------------------------------
KING
KING - BLAKE
KING - BLAKE - ALLEN
KING - CLARK
KING - CLARK - MILLER
KING - JONES
KING - JONES - FORD
KING - JONES - FORD - SMITH
```

The three engines differ only in string concatenation and one keyword:

```sql
-- MySQL 8+: RECURSIVE is mandatory, and || is not concatenation by default
with recursive x (ename, empno) as (
  select cast(ename as char(100)), empno from emp where mgr is null
  union all
  select cast(concat(x.ename, ' - ', e.ename) as char(100)), e.empno
    from emp e, x where e.mgr = x.empno
)
select ename as emp_tree from x order by 1;
```

```sql
-- SQL Server: no RECURSIVE keyword at all, + for concatenation
with x (ename, empno) as (
  select cast(ename as varchar(100)), empno from emp where mgr is null
  union all
  select cast(x.ename + ' - ' + e.ename as varchar(100)), e.empno
    from emp e, x where e.mgr = x.empno
)
select ename as emp_tree from x order by 1;
```

Forgetting `RECURSIVE` on MySQL doesn't produce a helpful message — the CTE
name simply isn't in scope inside its own definition, so you get
`ERROR 1146 (42S02): Table 'x' doesn't exist`. T-SQL, by contrast, infers
recursion from the CTE referencing itself; `WITH RECURSIVE` is not valid
syntax there at all.

Carrying an explicit `depth` column is usually worth more than the
concatenated path, because it lets you indent, filter to N levels, or spot a
runaway recursion:

```sql
with recursive x (empno, ename, depth) as (
  select empno, ename, 0
    from emp
   where mgr is null
  union all
  select e.empno, e.ename, x.depth + 1
    from emp e, x
   where e.mgr = x.empno
)
select repeat('  ', depth) || ename as emp_tree, depth
  from x;
```

### Anchoring the recursion at one specific node

Recipe 13.4 is the same machine with a different anchor: instead of "start at
the root," start at one named row and walk *down* from there. Everything the
recursion reaches is a descendant of that row.

```sql
with recursive x (ename, empno) as (
  select ename, empno
    from emp
   where ename = 'JONES'                   -- anchor: the one node we care about
  union all
  select e.ename, e.empno
    from emp e, x
   where x.empno = e.mgr                   -- e is a child of something in x
)
select ename
  from x;
```

```
ENAME
----------
JONES
SCOTT
ADAMS
FORD
SMITH
```

Note the join direction — it is the *only* thing separating "all descendants"
from "all ancestors":

```sql
-- descendants of JONES: children of rows already in x
where x.empno = e.mgr

-- ancestors of MILLER: the manager of rows already in x
where x.mgr = e.empno
```

The anchor row is included in the result, which is almost always what you
want for an access-control check ("can this manager see this record?") but
needs an explicit `where depth > 0` when the question is strictly "who
reports *to* JONES."

### Classifying rows as leaf, branch, or root

Recipe 13.5 needs no recursion at all — a node's type is decided entirely by
its immediate neighbours. A **leaf** has no children, a **root** has no
parent, a **branch** has both. The book expresses this with three correlated
scalar subqueries, wrapping each `count(*)` in `sign()` so the result is a
0/1 flag rather than a raw count:

```sql
select e.ename,
       (select sign(count(*)) from emp d
         where 0 = (select count(*) from emp f
                     where f.mgr = e.empno))       as is_leaf,
       (select sign(count(*)) from emp d
         where d.mgr = e.empno
           and e.mgr is not null)                  as is_branch,
       (select sign(count(*)) from emp d
         where d.empno = e.empno
           and d.mgr is null)                      as is_root
  from emp e
 order by 4 desc, 3 desc;
```

`sign()` is doing real work there: without it, `is_leaf` would return 14 (the
row count of `EMP`) instead of 1. The modern form drops the counting entirely
and says what it means with `EXISTS`, which also lets the engine stop at the
first matching child instead of counting all of them:

```sql
select e.ename,
       case when not exists (select 1 from emp c where c.mgr = e.empno)
            then 1 else 0 end                                as is_leaf,
       case when exists (select 1 from emp c where c.mgr = e.empno)
             and e.mgr is not null
            then 1 else 0 end                                as is_branch,
       case when e.mgr is null then 1 else 0 end             as is_root
  from emp e
 order by is_root desc, is_branch desc;
```

A single `case` expression is often more useful than three flags, since the
three states are mutually exclusive:

```sql
select ename,
       case when mgr is null then 'root'
            when not exists (select 1 from emp c where c.mgr = emp.empno)
                 then 'leaf'
            else 'branch'
       end as node_type
  from emp;
```

All of this assumes a **tree hierarchy**, where a root is marked by
`mgr IS NULL`. The book calls out the alternative explicitly: a *recursive
hierarchy* makes the root self-referencing (KING's `mgr` is KING's own
`empno`). That model breaks both the `is_root` test and every recursive CTE
above — the root becomes its own child and the recursion never terminates.
Use `NULL` for roots unless something outside your control forces otherwise.

### Recursion depth limits are a per-vendor default, not a SQL rule

This is the part of hierarchical querying that bites in production, and the
three engines disagree completely:

| Engine | Default limit | Override | Error on breach |
| --- | --- | --- | --- |
| PostgreSQL | none | `statement_timeout` / `LIMIT` | runs until memory or timeout |
| MySQL 8+ | `cte_max_recursion_depth` = 1000 | `SET SESSION`, `SET_VAR` hint | `ERROR 3636` |
| SQL Server | `MAXRECURSION` = 100 | `OPTION (MAXRECURSION n)` | `Msg 530` |

**SQL Server's 100 is the one that surprises people**, because it is low
enough for a genuine, non-buggy hierarchy to hit it — a deep category tree, a
folder structure, or a BOM explosion. The statement doesn't return partial
results with a warning; it errors out:

```
Msg 530, Level 16, State 1
The statement terminated. The maximum recursion 100 has been exhausted
before statement completion.
```

The fix is a query hint on the outermost statement, with `0` meaning no limit
(and therefore no safety net):

```sql
with x (empno, ename, depth) as ( /* ... */ )
select * from x
option (maxrecursion 1000);   -- 0..32767; 0 disables the limit entirely
```

**MySQL's 1000** exists for the same reason but is far less likely to trip on
real data, so when it does fire it usually means a cycle rather than a deep
tree:

```
ERROR 3636 (HY000): Recursive query aborted after 1001 iterations.
Try increasing @@cte_max_recursion_depth to a larger value.
```

```sql
set session cte_max_recursion_depth = 100000;
-- or, per statement, without touching session state:
select /*+ SET_VAR(cte_max_recursion_depth = 1M) */ * from x;
```

**PostgreSQL has no depth limit at all** — which is the most permissive
default and also the most dangerous one, since a cyclic `parent_id` produces a
query that consumes memory and temp space until `statement_timeout` kills it.
PostgreSQL's answer since **version 14** is the SQL-standard `CYCLE` clause,
which tracks visited keys and stops the recursion when it sees one twice:

```sql
with recursive x (empno, ename, mgr) as (
  select empno, ename, mgr from emp where mgr is null
  union all
  select e.empno, e.ename, e.mgr from emp e, x where e.mgr = x.empno
) cycle empno set is_cycle using path
select empno, ename, is_cycle from x;
```

The companion `SEARCH DEPTH FIRST BY ... SET ordercol` / `SEARCH BREADTH
FIRST BY ...` clause, added in the same release, replaces the hand-rolled
`depth` counter and path-string sort. Neither `CYCLE` nor `SEARCH` exists in
MySQL or SQL Server — there, cycle protection is the depth limit plus a
manual visited-set column.

Also worth knowing before writing the recursive member: both MySQL and SQL
Server forbid `DISTINCT`, `GROUP BY`, and aggregates inside it (MySQL adds
window functions and `ORDER BY`; SQL Server adds `TOP`, `HAVING`, subqueries,
and outer joins). "Aggregate the tree as you walk it" is not an option on
either — aggregate the CTE's output in the outer query instead.

## Trade-offs

- **The depth limit that fires in production is almost never the one you
  tested against.** SQL Server's default `MAXRECURSION 100` is low enough for
  real data to exceed it, and it fails the whole statement rather than
  truncating — a category tree that grows one level past 100 turns a working
  report into `Msg 530`. MySQL's 1000 and PostgreSQL's absence of a limit mean
  the same query, ported unchanged, has three different failure modes. Set the
  limit explicitly for anything running against a hierarchy you don't control
  the depth of.
  ```sql
  select * from x option (maxrecursion 0);   -- unlimited: no error, no safety net
  ```
- **A cycle in the self-reference turns a recursive CTE into an infinite
  loop.** Nothing in the schema prevents `A.parent = B` and `B.parent = A`
  unless you have added a constraint or trigger to stop it, and one bad
  `UPDATE` is enough. PostgreSQL's `CYCLE` clause (14+) handles this properly;
  MySQL and SQL Server rely on the depth limit as an accidental circuit
  breaker, which means the symptom is an unhelpful "max recursion exhausted"
  error rather than "your data has a loop."
- **Recursive CTEs re-walk the tree on every query, and that cost is
  per-read.** For a read-heavy hierarchy — a category menu rendered on every
  page load, a permissions check on every request — a materialized closure
  table (one row per ancestor/descendant pair) or a materialized path column
  turns the traversal into a single indexed lookup. The trade is write
  amplification and the maintenance burden of keeping the denormalized
  structure correct when nodes move; recursion is the right default until
  read volume proves otherwise.
- **Leaf/branch/root classification doesn't need recursion, and writing it
  recursively is a real performance mistake.** Node type depends only on
  immediate neighbours, so `EXISTS` against the same table answers it in one
  pass. The book's `sign(count(*))` form is correct but counts every child
  before collapsing to 0/1; `EXISTS` short-circuits on the first match.
  ```sql
  -- counts all children just to learn "at least one"
  (select sign(count(*)) from emp d where d.mgr = e.empno)
  -- stops at the first child
  case when exists (select 1 from emp d where d.mgr = e.empno) then 1 else 0 end
  ```
- **The concatenated path column silently truncates.** Casting to
  `varchar(100)` in the anchor fixes the column width for the entire
  recursion, so a deep branch produces a path that is cut off rather than an
  error on most configurations — and the truncation looks like a legitimate
  shorter path. Size the cast for the deepest branch you can plausibly have,
  or carry `empno` arrays / a separate `depth` column instead of leaning on a
  formatted string.
- **The recursive member is the most restricted place in SQL.** No `DISTINCT`,
  no `GROUP BY`, no aggregates on MySQL or SQL Server; MySQL also bars window
  functions and `ORDER BY`, SQL Server also bars `TOP`, `HAVING`, subqueries,
  and outer joins. Anything analytical has to happen in the outer query over
  the CTE's full output, which means a "sum the subtree as I descend" instinct
  from procedural code has to be restructured into "materialize the subtree,
  then aggregate."

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 13, "Hierarchical Queries", recipes 13.3, 13.4, 13.5, p. 444-458 — doc
- [PostgreSQL Documentation — WITH Queries (Common Table Expressions), including SEARCH and CYCLE](https://www.postgresql.org/docs/current/queries-with.html) — doc
- [MySQL Reference Manual — WITH (Common Table Expressions) and cte_max_recursion_depth](https://dev.mysql.com/doc/refman/8.4/en/with.html) — doc
- [Microsoft Learn — WITH common_table_expression (Transact-SQL), recursive CTE guidelines and MAXRECURSION](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql) — doc
