---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

NULL doesn't behave like a value — you can't test it with `=` or `!=`, and turning it
into something usable takes a dedicated function rather than a comparison. Finding
rows by partial text similarly needs a different operator than equality altogether.
Both come up in nearly every query that touches real-world, incomplete data.

## Use Cases

- Filtering for rows where an optional field was never set (a commission that
  doesn't apply to every employee, a middle name nobody filled in).
- Replacing NULL with a sensible default for display or arithmetic — a NULL
  commission shouldn't break a sum, it should count as zero.
- Free-text or partial matching in a search feature — name contains a substring,
  filename ends in a given extension — without a full-text search engine.

## Deep Dive

### Testing for NULL: IS NULL / IS NOT NULL

```sql
select * from emp where comm is null;
```

NULL is never equal — or unequal — to anything, not even itself. `comm = NULL` and
`comm != NULL` are always unknown, never true, so they silently return nothing
instead of erroring. `IS NULL` / `IS NOT NULL` are the only correct way to test for it.

### Replacing NULL with a default: COALESCE

```sql
select coalesce(comm, 0) from emp;
```

`COALESCE` takes one or more arguments and returns the first non-NULL one — here,
`comm` when it's set, `0` otherwise. The same result is reachable with `CASE`:

```sql
select case when comm is not null then comm else 0 end from emp;
```

but `COALESCE` says the same thing in a fraction of the characters, and — being
ANSI SQL — works identically on PostgreSQL, MySQL, and SQL Server. `COALESCE`
also isn't limited to two arguments: `coalesce(nickname, first_name, 'Unknown')`
returns the first non-NULL value across as many fallbacks as needed.

### Pattern matching with LIKE

```sql
select ename, job
  from emp
 where deptno in (10, 20)
   and (ename like '%I%' or job like '%ER');
```

`%` matches any sequence of characters (including none); `_` matches exactly one
character. Where the `%` goes changes the match: `'ER%'` matches strings
*starting* with "ER", `'%ER'` matches strings *ending* with "ER", and `'%ER%'`
matches "ER" occurring anywhere.

## Trade-offs

- **`LIKE`'s case sensitivity is not the same across databases, and none of it is
  obvious from the query itself.** PostgreSQL's `LIKE` is case-sensitive by default
  (use `ILIKE` there for case-insensitive matching); MySQL and SQL Server are
  case-*insensitive* by default, because their default collations (`utf8mb4_0900_ai_ci`
  on MySQL 8, `SQL_Latin1_General_CP1_CI_AS` on SQL Server — the `_ci`/`CI`
  marking case-insensitive) apply to comparisons generally, not just `LIKE`
  specifically. The same query can behave differently just by running against a
  different database, or a differently-collated column.
- **A trailing wildcard can use an index; a leading one can't — and the fix for that
  isn't equally good everywhere.** `LIKE 'foo%'` can use a standard B-tree index as
  a prefix range scan on all three databases. `LIKE '%foo'` cannot — the database
  has no way to seek to "ends with foo" in a B-tree, so it falls back to scanning
  every row. PostgreSQL has a purpose-built fix: `pg_trgm` trigram indexes
  (`GIN`/`GiST`) genuinely support arbitrary substring/leading-wildcard search.
  MySQL's closest tool, `FULLTEXT` + `MATCH ... AGAINST`, is word/boundary-based,
  not true substring matching — weaker, and community-recommended rather than
  documented as a `LIKE` replacement. SQL Server's Full-Text Search explicitly
  *rejects* leading wildcards (`CONTAINS('*foo')` isn't valid — only `'foo*'` is) —
  there's no good native index-based answer there; real-world workarounds are a
  reversed computed column plus index, or an external search engine.
- **`COALESCE` is portable; the vendor-specific shortcuts aren't just aliases.**
  SQL Server's `ISNULL(a, b)` only ever takes two arguments (unlike `COALESCE`'s
  N), infers its return type from the *first* argument alone — which can silently
  truncate a value if that argument's type is narrower than the second's — and is
  treated as NOT NULL-able, while `COALESCE` follows ordinary type-precedence
  rules and stays nullable if any argument is. Three different behaviors hiding
  behind what looks like a drop-in rename.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 1, "Retrieving Records", recipes 1.11-1.13, p. 11-13 — doc
- [PostgreSQL Documentation — Pattern Matching (LIKE, ILIKE)](https://www.postgresql.org/docs/current/functions-matching.html) — doc
- [PostgreSQL Documentation — pg_trgm (trigram indexes for fast substring search)](https://www.postgresql.org/docs/current/pgtrgm.html) — doc
- [MySQL Reference Manual — Collation and default collations](https://dev.mysql.com/doc/refman/8.0/en/charset-collate.html) — doc
- [SQL Server Documentation — ISNULL (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/isnull-transact-sql) — doc
- [PostgreSQL/ISO SQL — COALESCE](https://www.postgresql.org/docs/current/functions-conditional.html) — doc
