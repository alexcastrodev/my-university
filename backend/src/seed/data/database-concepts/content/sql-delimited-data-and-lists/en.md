---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Delimited data is a two-directions problem, and both directions show up
constantly. One way: you have many rows and need them collapsed into a single
comma-separated string per group — a report column, an email recipient list, a
tag summary. The other way: you have a single string like
`'7654,7698,7782,7788'` and need it back as rows, so it can feed an `IN` list
or be joined against a real table. SQL has no automatic coercion between these
forms — a comma inside quotes is just a character, and the engine will never
guess it means "list". Every DBMS now ships purpose-built functions for both
directions, but the function names, their argument order, and whether they
exist at all still differ enough that the *idiom* is per-vendor even when the
*idea* is universal.

## Use Cases

- Building a comma-separated summary column for a report — every employee name
  per department on one line, every tag per article, every email address per
  city — without pushing the concatenation into application code.
- Accepting a multi-value filter from a UI or an API as one delimited string
  (a checkbox group serialized to `"10,20,30"`) and turning it into rows to
  join against, instead of building a dynamic SQL `IN` list by string
  concatenation.
- Reading one field out of a legacy column that stores a delimited record —
  the third segment of a `region,site,rack` location code, the second name in
  a `first,middle,last` blob — without splitting the whole thing apart.
- Exploding a denormalized `tags` column into rows so it can be grouped,
  counted, or filtered like normal relational data.

## Deep Dive

### Aggregating rows into a delimited list

Turning this:

```
DEPTNO EMPS
------ ----------
    10 CLARK
    10 KING
    10 MILLER
    20 SMITH
    20 ADAMS
```

into this:

```
DEPTNO EMPS
------ ------------------------------------
    10 CLARK,KING,MILLER
    20 SMITH,JONES,SCOTT,ADAMS,FORD
```

is an aggregate function, exactly like `SUM` or `COUNT` — it collapses a group
of rows into one value, so it needs a `GROUP BY`.

**PostgreSQL** — `string_agg(value, delimiter)`, with the sort supplied as an
aggregate `ORDER BY` inside the parentheses:

```sql
select deptno,
       string_agg(ename, ',' order by empno) as emps
  from emp
 group by deptno;
```

**MySQL** — `GROUP_CONCAT`, which predates the standard and has its own
grammar: the delimiter arrives via a `SEPARATOR` keyword, not a second
argument, and `DISTINCT` and `ORDER BY` are both built into the call:

```sql
select deptno,
       group_concat(ename order by empno separator ',') as emps
  from emp
 group by deptno;
```

**SQL Server 2017+** — `STRING_AGG(expression, separator)`, but the sort is a
`WITHIN GROUP (ORDER BY ...)` clause *outside* the parentheses, matching how
T-SQL spells ordered-set aggregates generally:

```sql
select deptno,
       string_agg(ename, ',') within group (order by empno) as emps
  from emp
 group by deptno;
```

Three engines, three different places to put the ordering. This is worth
being pedantic about because the book's own solution for this recipe is not
runnable as printed on any of them — it writes
`string_agg(ename order by empno separator, ',')` for PostgreSQL and SQL
Server (mixing MySQL's `SEPARATOR` keyword into a function that has no such
keyword, plus a stray comma), and `group_concat(ename order by empno
separator, ',')` for MySQL (same stray comma). The prose around it is right;
the syntax is a typesetting casualty. Use the three forms above.

**Before SQL Server 2017** there was no aggregate at all, and the standard
workaround was the `FOR XML PATH('')` trick — build a subquery that emits
`,value` fragments, let the XML serializer concatenate them, then chop the
leading delimiter off with `STUFF`:

```sql
select d.deptno,
       stuff((select ',' + e.ename
                from emp e
               where e.deptno = d.deptno
               order by e.empno
                 for xml path(''), type).value('.', 'nvarchar(max)'),
             1, 1, '') as emps
  from dept d;
```

The `, type).value('.', 'nvarchar(max)')` part is not decoration — without it
the XML serializer escapes `&`, `<`, and `>` into `&amp;`, `&lt;`, `&gt;`, so
any data containing those characters comes back corrupted. That subtlety is
the single best argument for treating `FOR XML PATH` as legacy: it is a string
function implemented by accident on top of an XML serializer, and it inherits
XML's escaping rules whether you want them or not. On SQL Server 2017 and
later, there is no reason to write it.

> The SQL:2016 standard name for this is `LISTAGG`, which is what Db2 and
> Oracle both implement (Oracle since 11g Release 2 — which also means the
> book's Oracle solution, a `SYS_CONNECT_BY_PATH` hierarchical-query trick,
> was already a decade obsolete when the second edition was printed).
> PostgreSQL, MySQL, and SQL Server all went their own way instead, so
> "the standard function" is not the portable one here.

### Splitting a delimited list into rows

The inverse. The book frames the problem precisely: this fails,

```sql
select ename, sal, deptno
  from emp
 where empno in ( '7654,7698,7782,7788' );
```

because the `IN` list contains exactly one element — a string — and `EMPNO` is
numeric. SQL cannot see the commas as structure. The string has to become
rows first.

**SQL Server 2016+** — `STRING_SPLIT` is a table-valued function; use it in
`FROM`, or `CROSS APPLY` it to split a column value per row:

```sql
-- filter by a list, without building dynamic SQL
select e.ename, e.sal, e.deptno
  from emp e
  join string_split('7654,7698,7782,7788', ',') s
    on e.empno = cast(s.value as int);

-- explode a delimited column, one row per token
select p.productid, p.name, s.value as tag
  from product p
 cross apply string_split(p.tags, ',') s
 where rtrim(s.value) <> '';
```

Two constraints to know: `STRING_SPLIT` requires database compatibility level
130 or higher (unless `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS` is set), and
the separator must be a *single character* — it will not split on `'~@~'`.

**PostgreSQL** — two spellings, both native. `unnest(string_to_array(...))`
works on every supported version; `string_to_table(...)` is the direct
set-returning form, added in PostgreSQL 14:

```sql
-- classic: array, then unnest
select e.ename, e.sal, e.deptno
  from emp e
  join unnest(string_to_array('7654,7698,7782,7788', ',')) as t(empno)
    on e.empno = t.empno::int;

-- PostgreSQL 14+: skip the array entirely
select * from string_to_table('7654,7698,7782,7788', ',') as t(empno);
```

For the specific case of "filter by this list", PostgreSQL has a shorter form
that skips the join altogether — `= ANY(array)` — which is what most
PostgreSQL drivers generate for a parameterized list anyway:

```sql
select ename, sal, deptno
  from emp
 where empno = any(string_to_array('7654,7698,7782,7788', ',')::int[]);
```

**MySQL** — the one genuine gap. There is still no native split function in
MySQL 8.4 or 9.x; `SUBSTRING_INDEX` extracts *one* token, not a table. The two
working approaches are a recursive CTE (MySQL 8.0+) that peels one token per
iteration:

```sql
with recursive split (rest, tok) as (
  select concat('7654,7698,7782,7788', ','), ''
  union all
  select substring(rest, instr(rest, ',') + 1),
         substring_index(rest, ',', 1)
    from split
   where rest <> ''
)
select cast(tok as unsigned) as empno
  from split
 where tok <> '';
```

or the `JSON_TABLE` trick — rewrite the delimited string as a JSON array and
let the JSON parser do the splitting, which is usually faster and always
shorter:

```sql
select j.tok
  from json_table(
         concat('["', replace('CLARK,KING,MILLER', ',', '","'), '"]'),
         '$[*]' columns (tok varchar(50) path '$')
       ) as j;
```

The `JSON_TABLE` version breaks if a token contains a `"` or `\`, so it is a
trick, not a general-purpose splitter — but for the overwhelmingly common case
of numeric ids or simple identifiers it is the pragmatic choice.

All of these replace the book's per-vendor "walk the string" machinery — the
`(select id as pos from t10) iter` pivot tables cross-joined against the
string, with `SUBSTR`/`INSTR`/`CHARINDEX` arithmetic to carve out each token.
Those solutions still run, and they are worth reading once to understand what
the built-ins do. But they require a numbers table sized to the longest
possible list, and none of them are what you should write in 2026.

### Extracting the nth delimited substring

Sometimes you don't want all the tokens, just one — the second name out of
`'mo,larry,curly'`. Here the vendors diverge most.

**PostgreSQL** — `split_part` does exactly this and nothing else, which makes
it the cleanest of the three:

```sql
select split_part(name, ',', 2) as sub from v;
--  larry
--  gina
```

Since PostgreSQL 14, `n` may be negative to count from the end, which is the
easy way to grab a trailing segment of unknown length:

```sql
select split_part('abc,def,ghi,jkl', ',', -2);  -- ghi
```

**MySQL** — no `split_part`, but the nested-`SUBSTRING_INDEX` idiom is the
canonical substitute and reads fine once you've seen it. The inner call keeps
everything left of the nth delimiter; the outer call keeps everything right of
the *last* delimiter in that result:

```sql
select substring_index(substring_index(name, ',', 2), ',', -1) as sub
  from v;
```

Trace it on `'mo,larry,curly'`: the inner call returns `'mo,larry'`, the outer
call takes everything after its final comma, giving `'larry'`.

**SQL Server 2022+** — `STRING_SPLIT`'s third argument, `enable_ordinal`,
adds an `ordinal` column with the 1-based position of each token, which turns
"nth substring" into a `WHERE` clause:

```sql
select v.name, s.value as sub
  from v
 cross apply string_split(v.name, ',', 1) as s
 where s.ordinal = 2;
```

This is the one place the book's solution should be treated as actively wrong
rather than merely dated. Its SQL Server answer for this recipe wraps
`STRING_AGG` around the whole view to mash *both* rows into a single string,
then splits that — because `STRING_SPLIT` without `enable_ordinal` has no
position column and can only take one value at a time. That both destroys the
per-row grouping and depends on split order, which Microsoft explicitly does
not guarantee: "the output rows might be in any order." `CROSS APPLY` plus
`ordinal` is the correct shape.

On SQL Server 2019 and earlier, where `enable_ordinal` doesn't exist, the
positional arithmetic is unavoidable — appending a trailing delimiter so the
last token has a terminator to find:

```sql
select name,
       substring(name,
                 charindex(',', name) + 1,
                 charindex(',', name + ',', charindex(',', name) + 1)
                   - charindex(',', name) - 1) as sub
  from v;
```

That is fine for a fixed, small `n`. It does not generalize to "the nth token"
with `n` as a parameter, which is exactly why the ordinal column was added.

## Trade-offs

- **MySQL truncates the aggregate silently; SQL Server errors; PostgreSQL
  doesn't care.** `GROUP_CONCAT` respects `group_concat_max_len`, whose
  default is **1024 bytes** — exceed it and the result is quietly cut off,
  producing a string that looks valid and is wrong. SQL Server takes the
  opposite approach: `STRING_AGG` returns `nvarchar(4000)`/`varchar(8000)`
  unless the input is already a MAX type, and overflowing raises error 9829,
  "STRING_AGG aggregation result exceeded the limit of 8000 bytes" — loud, but
  it means you must remember `convert(nvarchar(max), col)` for any list that
  might get long. PostgreSQL's `text` has no practical ceiling here. Of the
  three failure modes, MySQL's is the dangerous one because nothing tells you.
  ```sql
  -- MySQL: raise it per session, or accept truncation at 1024 bytes
  set session group_concat_max_len = 1048576;
  -- SQL Server: convert first, or hit error 9829
  select string_agg(convert(nvarchar(max), ename), ',') from emp;
  ```
- **Split order is not guaranteed, so "the nth token" needs an explicit
  ordinal — not a row order you happened to observe.** Microsoft states
  outright that `STRING_SPLIT` output "might be in any order"; PostgreSQL's
  `unnest` happens to preserve array order but you should still write
  `WITH ORDINALITY` if position matters, because that makes the dependency
  visible instead of implicit. The same applies in the other direction: a
  `string_agg`/`GROUP_CONCAT` without an explicit `ORDER BY` produces a string
  whose element order can change between executions, plan shapes, or after a
  parallelism change — and a report column that reorders itself between runs
  is a bug report waiting to happen.
  ```sql
  -- position is data, so ask for it
  select tok, n
    from unnest(string_to_array('a,b,c', ',')) with ordinality as t(tok, n);
  ```
- **Splitting a stored delimited column defeats every index on it.** Using
  these functions on a *parameter* is fine and often optimal — it replaces the
  real antipattern of concatenating a dynamic SQL `IN` list. Using them on a
  *column*, though, means every query that filters by a token has to split
  every row first: no index on a `tags varchar(400)` column can help answer
  "which products are tagged `bike`". If that query runs often, the delimited
  column is a normalization problem to fix with a junction table, not a string
  problem to optimize.
- **There is no portable spelling — only a portable idea.** Every direction of
  this problem needs a different function name, argument order, and clause
  position on each of the three engines, and MySQL still has no native
  table-valued split at all in 9.x, so its answer is structurally different
  (a recursive CTE or a JSON round-trip) rather than just differently named.
  Code that must run on more than one engine should push this logic behind a
  query-per-dialect boundary rather than hunting for a common subset.
- **Empty and NULL tokens behave differently everywhere, and the differences
  are silent.** `string_agg` and `GROUP_CONCAT` both skip NULL inputs entirely
  — including the separator — so a group of five rows with two NULLs yields
  three elements, not five with gaps. `STRING_SPLIT` *keeps* zero-length
  substrings when delimiters are adjacent, which is why the Microsoft examples
  all carry a `WHERE rtrim(value) <> ''`. `split_part` returns an empty string,
  not NULL, for an out-of-range `n`. None of these raise anything; they just
  change your row counts.
  ```sql
  -- SQL Server: 'a,,b' yields three rows, one of them empty
  select value from string_split('a,,b', ',');
  ```

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 6, "Working with Strings", recipes 6.10, 6.11, 6.14, p. 132-136, 153-160 — doc
- [PostgreSQL Documentation — Aggregate Functions (string_agg)](https://www.postgresql.org/docs/current/functions-aggregate.html) — doc
- [PostgreSQL Documentation — String Functions and Operators (split_part, string_to_array, string_to_table)](https://www.postgresql.org/docs/current/functions-string.html) — doc
- [MySQL Reference Manual — Aggregate Function Descriptions (GROUP_CONCAT, group_concat_max_len)](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html) — doc
- [Microsoft Learn — STRING_AGG (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql) — doc
- [Microsoft Learn — STRING_SPLIT (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-split-transact-sql) — doc
</content>
</invoke>
