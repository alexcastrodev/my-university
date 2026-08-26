---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Deleting duplicate records means: for each group of rows that share the same
value in some column (a `NAME`, an email, a natural key that was never made
unique), arbitrarily keep exactly one row and remove the rest. "Arbitrarily"
matters here — the rows in a duplicate group are indistinguishable by the
column that defines the duplicate, so any tiebreaker column (typically the
primary key) is used only to pick *which* one survives, not because one row
is more "correct" than another.

## Use Cases

- Cleaning up rows imported twice by a batch job, a retried API call, or a
  CSV load that ran without a uniqueness check.
- Deduplicating a table before adding a `UNIQUE` constraint or index that the
  existing data would otherwise violate.
- One-off data-quality maintenance: collapsing near-identical rows down to a
  single canonical one per group ahead of a migration or a report.

## Deep Dive

### The classic technique: keep the row with the smallest id

Given a `dupes` table where several rows share the same `name`:

```sql
create table dupes (id integer, name varchar(10));

insert into dupes values (1, 'NAPOLEON');
insert into dupes values (2, 'DYNAMITE');
insert into dupes values (3, 'DYNAMITE');
insert into dupes values (4, 'SHE SELLS');
insert into dupes values (5, 'SEA SHELLS');
insert into dupes values (6, 'SEA SHELLS');
insert into dupes values (7, 'SEA SHELLS');
```

the book's approach groups by the duplicate-defining column, picks the
minimum `id` per group to retain, and deletes everything else:

```sql
delete from dupes
 where id not in ( select min(id)
                      from dupes
                     group by name );
```

This runs as-is on PostgreSQL and SQL Server — both allow a `DELETE`'s
subquery to reference the same table being deleted from. It does **not** run
on MySQL, which rejects it with error 1093, `Can't specify target table
'dupes' for update in FROM clause` — MySQL still refuses, today, to let a
`DELETE`'s subquery read directly from the table it's deleting from.

### MySQL's same-table restriction and the derived-table workaround

The book's fix wraps the offending subquery in an extra derived table:

```sql
delete from dupes
 where id not in
       ( select min(id)
           from (select id, name from dupes) tmp
          group by name );
```

MySQL's optimizer materializes the inner `(select id, name from dupes) tmp`
into a throwaway result set before the outer `DELETE` runs, so by the time
`MIN(id)` groups it, it's no longer "the same table" as far as the
same-table check is concerned — it's an anonymous derived result. This is
still exactly how MySQL behaves as of 8.4/9.x: the restriction on
referencing the delete target inside a plain subquery hasn't been lifted,
and the derived-table wrap is still the documented way around it (MySQL's
own manual additionally suggests a swap-table approach — build a filtered
copy with `INSERT ... SELECT`, then `RENAME TABLE` it into place — as an
alternative for very large deletes on InnoDB tables).

One thing that *has* changed since the book: MySQL 8.0 added support for a
`WITH` clause ahead of `DELETE`, so a CTE can supply values to a `DELETE`
statement. That doesn't remove the same-table restriction, though — see the
next section.

### A more portable alternative: `ROW_NUMBER()` over a CTE

A newer, arguably more readable technique replaces `MIN(id) NOT IN` with a
`ROW_NUMBER()` window function partitioned by the duplicate-defining column:
row `1` in each partition is the one to keep, everything numbered higher is
a duplicate to delete. All three engines support window functions and CTEs
today, but each has a different rule for how far a `DELETE` can reach into
a CTE that's built on the same table:

**PostgreSQL** — a CTE isn't itself an updatable relation, so `DELETE` still
needs a `USING` clause to join back to it:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from dupes
      using ranked
      where dupes.id = ranked.id
        and ranked.rn > 1;
```

**SQL Server** — uniquely among the three, a CTE built directly on the
target table can be deleted from *directly*, because the window function is
evaluated inside the CTE, not inside the `DELETE` itself:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from ranked where rn > 1;
```

**MySQL** — CTEs used by a `DELETE` are materialized before the statement
runs, so referencing the target table *inside* the CTE's definition is fine.
What's still not allowed is deleting directly from a CTE that carries a
window function's result, because the SQL standard's restriction on window
functions applies here too: they may appear in a subquery a `DELETE` reads
from, but not in the rows a `DELETE`/`UPDATE` is actually modifying. So
MySQL needs the `IN` form, one layer removed from the CTE:

```sql
with ranked as (
  select id, row_number() over (partition by name order by id) as rn
    from dupes
)
delete from dupes
      where id in (select id from ranked where rn > 1);
```

The `ROW_NUMBER()` version reads the same way on all three engines (a
window function computing "which copy is this" per group), which makes it
easier to carry a mental model between PostgreSQL, MySQL, and SQL Server
than memorizing each engine's own quirks around `MIN(id) NOT IN` — the
book's technique remains completely valid, but the CTE form is the one
worth reaching for first today.

## Trade-offs

- **`NOT IN` silently deletes nothing if the subquery ever returns a
  `NULL`.** `x NOT IN (a, NULL)` evaluates to `UNKNOWN`, not `TRUE`, for
  every row — so if `MIN(id)` could ever produce a `NULL` (an `id` column
  that allows `NULL`s, or a more complex subquery that happens to include
  one), the whole `DELETE` quietly deletes zero rows instead of erroring.
  `NOT EXISTS`/anti-join forms and the `ROW_NUMBER()` approach don't have
  this trap, because they never compare against a set that could contain a
  `NULL`.
  ```sql
  -- if any id in the derived set is NULL, this deletes nothing at all
  delete from dupes where id not in (select min(id) from dupes group by name);
  ```
- **"Which row survives" is arbitrary by design, but the tiebreaker column
  still has to exist and be deterministic.** Both techniques key off `id`
  (via `MIN(id)` or `ORDER BY id` inside `ROW_NUMBER()`) specifically
  because `id` is guaranteed unique — grouping/partitioning by `name` alone
  can't tell two duplicate rows apart, so *some* other column has to break
  the tie, or the choice of which copy to keep becomes genuinely
  non-deterministic across runs.
- **The MySQL derived-table workaround is a real, still-necessary
  restriction, not a book-era artifact.** It's tempting to assume a
  same-table subquery restriction like this would have been lifted in the
  ten-plus years since MySQL first documented it, but it hasn't — MySQL
  8.4/9.x still raises error 1093 on the book's original one-subquery form,
  and still needs either the extra derived-table wrap or the `IN (SELECT
  ... FROM cte)` form shown above.
- **Portability comes at the cost of a small syntax difference per engine.**
  The `ROW_NUMBER()` technique reads identically across PostgreSQL, MySQL,
  and SQL Server at the CTE level, but the actual `DELETE` statement's shape
  still differs (`USING` vs. direct `DELETE FROM cte` vs. `WHERE id IN
  (...)`) — there's no single query that runs unmodified on all three, only
  a shared mental model for building the right one per engine.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 4, "Inserting, Updating, and Deleting", recipe 4.16, p. 85-87 — doc
- [PostgreSQL Documentation — DELETE (USING clause)](https://www.postgresql.org/docs/current/sql-delete.html) — doc
- [MySQL Reference Manual — DELETE Statement (same-table subquery restriction, WITH clause support)](https://dev.mysql.com/doc/refman/8.4/en/delete.html) — doc
- [MySQL Reference Manual — Window Function Restrictions](https://dev.mysql.com/doc/refman/8.4/en/window-function-restrictions.html) — doc
- [Microsoft Learn — WITH common_table_expression (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/with-common-table-expression-transact-sql) — doc
