---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

Two closely related problems come up in almost every day-to-day SQL task: capping
how many rows a query returns, and capping it *after* shuffling row order so
successive runs return a different sample. Every major database solves both, but —
unlike most SQL — there's no single syntax that works everywhere.

## Use Cases

- Paginating a UI list or API response without loading an entire table into memory.
- Quickly eyeballing a handful of rows from a large table while debugging, without
  waiting for a full result set.
- Picking a random sample of rows for a demo, seed data, or a spot-check that isn't
  biased toward whatever order the table happens to store rows in.
- Avoiding the classic mistake of trying to grab "just the 5th row" with an equality
  filter on a row-numbering function instead of understanding how that function is
  actually evaluated.

## Deep Dive

### Capping row count: LIMIT, TOP, and the ANSI standard

PostgreSQL and MySQL share the same keyword:

```sql
select * from emp limit 5;
```

SQL Server puts the cap in the SELECT list instead:

```sql
select top 5 * from emp;
```

Both PostgreSQL and SQL Server (2012+) also support the ANSI SQL:2008 standard
form, which reads the same on both:

```sql
select * from emp order by empno fetch first 5 rows only;
```

MySQL does **not** support this ANSI form at all — `LIMIT` is the only option there,
so `FETCH FIRST` isn't a safe portable choice across all three databases despite being
"the standard." In practice, `LIMIT` and `TOP` remain what people actually write day
to day; `OFFSET...FETCH` mostly shows up in generated pagination code, or when
`WITH TIES` behavior is specifically needed.

> Oracle takes a genuinely different approach: `WHERE ROWNUM <= 5` works, but
> `WHERE ROWNUM = 5` never returns a row. ROWNUM is assigned *as each row is
> fetched* — row one is numbered 1, checked against the condition, and only then is
> the next row fetched and numbered. Asking for `ROWNUM = 5` means every row
> before the fifth gets discarded (never satisfying `= 5`), so a "row five" that was
> renumbered "row one" for comparison purposes never arrives. It's a sharp
> illustration of *when* a numbering function gets evaluated relative to the rows
> flowing through a query — the same category of surprise as evaluation order
  between `WHERE` and column aliases.

### Randomizing before limiting

The pattern is the same everywhere: sort by a random value, then cap the result.

```sql
-- PostgreSQL
select ename, job from emp order by random() limit 5;

-- MySQL
select ename, job from emp order by rand() limit 5;

-- SQL Server
select top 5 ename, job from emp order by newid();
```

A numeric constant in `ORDER BY` sorts by column position; a function call in
`ORDER BY` sorts by that function's *result*, re-evaluated per row — which is exactly
what turns a deterministic query into a randomized one here.

### Why this doesn't scale, and what replaces it for large tables

`ORDER BY random()`/`rand()` has to evaluate the random function for every row,
then fully sort the entire result set, before it can hand back even 5 rows — a full
table scan plus an O(n log n) sort, no matter how small `n` is. `TABLESAMPLE` avoids
both, by sampling at the storage level instead of the row level:

```sql
-- PostgreSQL: true random sample (still scans every row, but no sort)
select * from emp tablesample bernoulli(10);

-- PostgreSQL: faster, block-level sample (less statistically random)
select * from emp tablesample system(10);

-- SQL Server: block/page-level sample
select * from emp tablesample system (10 percent);
```

MySQL has no `TABLESAMPLE` equivalent — `ORDER BY rand() LIMIT n` (or a
workaround sampling by a random primary-key range) remains the only option there,
a real portability gap to know about before assuming a sampling technique carries
across engines.

## Trade-offs

- **`LIMIT`/`TOP` are what people actually write; `OFFSET...FETCH` is the portable
  form that isn't actually portable everywhere.** It works on PostgreSQL and SQL
  Server but not MySQL — "ANSI standard" doesn't mean "supported by every
  database still in wide use."
- **`ORDER BY random()`/`rand()` trades simplicity for cost at scale.** It's one line
  and works identically in spirit across databases, but a full scan-and-sort on a
  large table is real, measurable overhead — `TABLESAMPLE` is the fix, when the
  database supports it.
- **`TABLESAMPLE SYSTEM` is faster than `BERNOULLI` for exactly the reason it's
  less statistically random** — it samples whole storage blocks instead of
  individual rows, so rows within a sampled block aren't independently chosen.
  Reach for `SYSTEM` when "roughly N% of the table, fast" is good enough;
  `BERNOULLI` when the sample actually needs to be unbiased at the row level.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 1, "Retrieving Records", recipes 1.9 "Limiting the Number of Rows Returned" and 1.10 "Returning n Random Records from a Table", p. 8-11 — doc
- [PostgreSQL Documentation — SELECT (LIMIT/OFFSET, FETCH, TABLESAMPLE)](https://www.postgresql.org/docs/current/sql-select.html) — doc
- [PostgreSQL Documentation — Table Sampling Methods (BERNOULLI, SYSTEM)](https://www.postgresql.org/docs/current/tablesample-method.html) — doc
- [MySQL Reference Manual — SELECT Statement (LIMIT only, no FETCH/TABLESAMPLE)](https://dev.mysql.com/doc/refman/8.0/en/select.html) — doc
- [SQL Server Documentation — ORDER BY (OFFSET/FETCH)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql) — doc
- [SQL Server Documentation — FROM clause (TABLESAMPLE)](https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql) — doc
