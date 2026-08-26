---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Take an ordered sequence of numbers that *should* be continuous — serial
numbers, invoice ids, project ids, day offsets — and that isn't. The rows
split into **islands** (runs of consecutive values) separated by **gaps** (the
values nobody inserted). Asking "which runs are contiguous?", "where does each
run start and end?", and "which values are missing?" are three phrasings of the
same question, and the answer to all three comes from one idea: derive a
*group key* that stays constant for every row inside a run and changes at every
boundary. The mirror-image problem — you need the dense sequence and no table
contains it — is a row generator, and it turns out to be the tool that lets you
answer the gaps half of the question by anti-join. This concept covers the
generic, purely numeric form; the date-flavoured instance of exactly the same
pattern (`LEAD`-based date gaps, filling in missing calendar periods,
overlapping date ranges) is covered in
[Date Gaps, Missing Dates, and Overlapping Ranges](sql-date-gaps-and-overlapping-ranges).

## Use Cases

- Finding contiguous blocks of free serial numbers, ticket numbers, or
  inventory ids so a batch allocation can hand out one unbroken range instead
  of scattered singles.
- Detecting streaks: consecutive login days per user, consecutive attendance
  records, consecutive winning games, consecutive readings above a threshold —
  anything where "how long did it last, uninterrupted" matters more than the
  raw count.
- Reporting which ids are *missing* from a sequence that should be dense —
  auditing an invoice or check-number series for holes that indicate a lost,
  voided, or never-imported record.
- Generating a dense id/number sequence on demand for a lookup table, a pivot,
  a test-data seed, or a parameter to string-parsing logic, without creating
  and maintaining a physical numbers table.
- Compressing a per-row result into a per-range one: turning ten thousand
  consecutive rows into "20001–30000", which is both smaller to transmit and
  the shape a human actually wants to read.

## Deep Dive

### Locating the islands

Start with a sequence that has holes in it:

```sql
create table inventory (serial_no integer);

insert into inventory values (1), (2), (3), (5), (6), (7), (8), (12), (20), (21);
```

Four islands (`1–3`, `5–8`, `12`, `20–21`) and three gaps (`4`, `9–11`,
`13–19`). The book's recipe 10.1 reaches for `LEAD` to look at the next row
without a self-join, and keeps rows whose successor is exactly one greater:

```sql
select serial_no
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no
  from inventory
       ) t
 where next_no = serial_no + 1;
--  1, 2, 5, 6, 7, 20
```

The inline view is mandatory, not stylistic: window functions are evaluated
after `WHERE`, so filtering in the same query block would apply `LEAD` to
whatever survived the filter. But look at the output — `3`, `8`, and `21` are
gone. Each is the *last* member of an island, and the "my successor is +1" test
can never be true for a last member. This is precisely the caveat the book
raises about `PROJ_ID 4`, and its fix is to add `LAG` and accept a row that is
consecutive in either direction:

```sql
select serial_no
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no,
        lag(serial_no) over (order by serial_no) as prior_no
  from inventory
       ) t
 where next_no  = serial_no + 1
    or prior_no = serial_no - 1;
--  1, 2, 3, 5, 6, 7, 8, 20, 21   (12 excluded: an island of one)
```

Both forms answer "which rows sit in a run", but neither tells you *which* run
a row belongs to — and that's the question everything downstream needs. The
technique that does is the one the book only gets to indirectly in the next
recipe: subtract a dense counter from the value.

```sql
select serial_no,
       row_number() over (order by serial_no)             as rn,
       serial_no - row_number() over (order by serial_no) as grp
  from inventory;

--  serial_no | rn | grp
--  ----------+----+-----
--          1 |  1 |   0
--          2 |  2 |   0
--          3 |  3 |   0
--          5 |  4 |   1
--          6 |  5 |   1
--          7 |  6 |   1
--          8 |  7 |   1
--         12 |  8 |   4
--         20 |  9 |  11
--         21 | 10 |  11
```

`ROW_NUMBER()` always increases by exactly one. Inside an island `serial_no`
also increases by exactly one, so the difference is constant; at a gap of size
*n* the value jumps ahead of the counter and the difference increases by *n*.
The actual number in `grp` is meaningless — only its constancy matters. It is a
group key, and `GROUP BY` takes it from there. `ROW_NUMBER() OVER (ORDER BY …)`
is available on PostgreSQL (since 8.4), MySQL 8.0+, and SQL Server 2012+ with
identical syntax and semantics, so this expression is portable verbatim.

### Reporting just the boundaries

Once every row carries a group key, collapsing each island to its endpoints is
an aggregate:

```sql
select min(serial_no) as island_start,
       max(serial_no) as island_end,
       count(*)       as len
  from (
select serial_no,
       serial_no - row_number() over (order by serial_no) as grp
  from inventory
       ) t
 group by grp
 order by island_start;

--  island_start | island_end | len
--  -------------+------------+-----
--             1 |          3 |   3
--             5 |          8 |   4
--            12 |         12 |   1
--            20 |         21 |   2
```

Note that `12` appears as a one-row island rather than disappearing — which is
exactly the semantic shift recipe 10.3 calls out: a row that is part of no run
is still the beginning and the end of its own range.

The book's own solution to 10.3 uses a different, more general grouping key:
`LAG` to compare against the previous row, a `CASE` that emits `1` at every
boundary and `0` otherwise, and a running `SUM` over those flags. Written for a
numeric sequence:

```sql
select grp, min(serial_no) as island_start, max(serial_no) as island_end
  from (
select serial_no,
       sum(flag) over (order by serial_no
                       rows between unbounded preceding and current row) as grp
  from (
select serial_no,
       case when lag(serial_no) over (order by serial_no) = serial_no - 1
            then 0 else 1
       end as flag
  from inventory
       ) flagged
       ) grouped
 group by grp
 order by grp;
```

This is worth learning even though it is longer, because the boundary test
lives in one isolated `CASE` expression. Swap `= serial_no - 1` for anything
else — `>= serial_no - 5` for "within five", `= proj_start` for the book's
project-chaining version, `> current_ts - interval '30 minutes'` for
sessionization — and the rest of the query is unchanged. The
`ROW_NUMBER()`-minus-value trick has "consecutive means exactly +1" baked into
its arithmetic and cannot be generalised that way.

The explicit `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` is not
decoration either. PostgreSQL, MySQL, and SQL Server all default to
`RANGE UNBOUNDED PRECEDING` — equivalently `RANGE BETWEEN UNBOUNDED PRECEDING
AND CURRENT ROW` — when an `ORDER BY` is present and no frame is given, and in
`RANGE` mode `CURRENT ROW` means "the last *peer* of the current row", every
row the `ORDER BY` sorts as equivalent. On a distinct ordering column the two
frames agree; on one with ties, `RANGE` gives every tied row the same running
total and quietly merges what should have been separate boundaries. Spell out
`ROWS` in a running-total-as-group-key and the question never arises.

The gaps themselves fall out of the same `LEAD` view — every place the next
value skips ahead is a hole, and its bounds are the two values on either side:

```sql
select serial_no + 1 as gap_start,
       next_no - 1   as gap_end
  from (
select serial_no,
       lead(serial_no) over (order by serial_no) as next_no
  from inventory
       ) t
 where next_no > serial_no + 1;

--  gap_start | gap_end
--  ----------+---------
--          4 |       4
--          9 |      11
--         13 |      19
```

This reports gaps *between* existing rows only. Holes before the first row or
after the last one aren't visible to `LEAD`, because the sequence's intended
bounds aren't in the data — they have to be supplied, which is the next
sub-topic.

### Generating a numeric sequence

The book frames recipe 10.5 as a "row source generator" and gives a different
solution per vendor, because in 2020 only PostgreSQL had a built-in. That is
still mostly true, but SQL Server has since joined it.

**PostgreSQL** — `generate_series` is a set-returning function with the
signature `generate_series(start, stop [, step])` for `integer`, `bigint`, and
`numeric`. `step` defaults to 1, may be negative to count down, and being zero
is an error; if `start > stop` with a positive step (or any argument is `NULL`)
you get zero rows rather than an error:

```sql
select id from generate_series(1, 10) as g(id);         -- 1 … 10
select id from generate_series(10, 30, 5) as g(id);     -- 10, 15, 20, 25, 30
select id from generate_series(10, 1, -1) as g(id);     -- counts down
```

The arguments are ordinary expressions, so the bounds can come from the data —
which is what makes the generator an *answer* to the gaps question rather than
just a curiosity. Anti-join the dense series against the sparse table and the
missing values appear directly, endpoints included:

```sql
select g.id as missing_serial
  from generate_series( (select min(serial_no) from inventory),
                        (select max(serial_no) from inventory) ) as g(id)
 where not exists (select 1 from inventory i where i.serial_no = g.id);
--  4, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19
```

**SQL Server 2022 (16.x)+** — `GENERATE_SERIES(start, stop [, step])` is the
direct equivalent, returning a one-column table whose column is named `value`.
Two caveats the docs are explicit about: it requires database compatibility
level **160** or higher (below that the engine simply reports that the function
doesn't exist, unless the `ALLOW_BUILTIN_TVF_IN_ALL_COMPAT_LEVELS`
database-scoped configuration is on), and `step` defaults to `1` when
`start < stop` but to `-1` when `start > stop` — the opposite of PostgreSQL,
which returns an empty set in that case:

```sql
select value from generate_series(1, 10);
select value from generate_series(1, 50, 5);   -- 1, 6, 11, … 46
```

**MySQL** — still no generator function in 8.4 or 9.x, so the book's recursive
CTE is the current answer, not a legacy one. It is also the most portable
option, running unchanged on PostgreSQL and (minus the `RECURSIVE` keyword,
which T-SQL doesn't use) on SQL Server:

```sql
with recursive x (id) as (
  select 1
  union all
  select id + 1
    from x
   where id + 1 <= 10
)
select id from x;
```

Recursion is not free, and MySQL caps it: `cte_max_recursion_depth` defaults to
**1000**, and exceeding it aborts the query with `ERROR 3636 (HY000): Recursive
query aborted after 1001 iterations`. Raising it is a session setting, but for
large fixed-size generators a set-based cross join of a digits list is faster
and has no depth limit at all — this is the "pivot table" the book keeps
referring to, built inline instead of stored:

```sql
with digits (d) as (
  select 0 union all select 1 union all select 2 union all select 3 union all
  select 4 union all select 5 union all select 6 union all select 7 union all
  select 8 union all select 9
)
select d3.d * 100 + d2.d * 10 + d1.d + 1 as id
  from digits d1
 cross join digits d2
 cross join digits d3
 order by id;              -- 1 … 1000, no recursion involved
```

Each extra `cross join digits` multiplies the row count by ten, so three joins
give a thousand rows, five give a hundred thousand. Bound the output with a
`WHERE` on the computed expression rather than generating more than you need.

## Trade-offs

- **The `ROW_NUMBER()` trick hard-codes "consecutive means exactly +1".** It is
  the shortest correct answer for a dense integer sequence and the wrong tool
  the moment adjacency is defined by anything else — a chained
  `end = next start`, a tolerance window, a session timeout. Those need the
  `LAG` + `CASE` + running-`SUM` form, where the definition of a boundary is
  one editable expression instead of an arithmetic identity.
  ```sql
  -- adjacency as a swappable predicate, not baked into subtraction
  case when lag(ts) over (order by ts) > ts - interval '30 minutes'
       then 0 else 1 end
  ```
- **Duplicates silently shatter islands under `ROW_NUMBER()`.** Two rows with
  the same value get different row numbers, so their group keys differ and one
  island is reported as two. `DENSE_RANK()` gives tied values the same counter
  and restores the invariant — but only if the duplicates are genuinely
  intended; if they are not, deduplicate first rather than papering over them.
  ```sql
  serial_no - dense_rank() over (order by serial_no) as grp
  ```
- **On MySQL the subtraction is order-sensitive and fails at runtime, not at
  parse time.** `ROW_NUMBER()` yields an unsigned integer, and MySQL's rule is
  that subtraction with an unsigned operand produces an unsigned result — so
  the moment the difference would go negative you get
  `ERROR 1690 (22003): BIGINT UNSIGNED value is out of range`. Writing the
  operands in the other order, or grouping ids that start at zero or below, is
  enough to trigger it. Cast explicitly rather than relying on which way round
  you happened to type it.
  ```sql
  -- blows up on MySQL as soon as row_number() exceeds serial_no
  row_number() over (order by serial_no) - serial_no
  -- portable
  cast(row_number() over (order by serial_no) as signed) - serial_no
  ```
- **The default window frame is `RANGE`, and `RANGE` merges peers.** All three
  engines default to `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` when
  `ORDER BY` is present without a frame clause, and `CURRENT ROW` there means
  the current row's *last peer*. A running-total group key over a column with
  ties therefore assigns the same group to rows that should have started a new
  one — a wrong answer with no error. `ROWS` costs four extra words and removes
  the entire class of bug.
  ```sql
  sum(flag) over (order by serial_no
                  rows between unbounded preceding and current row)
  ```
- **Generating the sequence is the least portable step, and the constraints are
  real rather than historical.** PostgreSQL's `generate_series` is one
  expression; SQL Server's `GENERATE_SERIES` needs 2022 plus compatibility
  level 160; MySQL has nothing and needs a recursive CTE bounded by
  `cte_max_recursion_depth` (default 1000). Portability here means either
  writing the recursive CTE everywhere and giving up the concise form, or
  branching per engine.
  ```sql
  set session cte_max_recursion_depth = 100000;  -- MySQL, before a large generator
  ```
- **Filtering with `LEAD` alone quietly drops each island's last row.** The
  "next value is +1" predicate is never true for the final member of a run, so
  the naive recipe returns islands one row short and singleton islands not at
  all. Whether that's a bug or the requirement is a genuine judgment call — the
  book's own `PROJ_ID 4` discussion exists precisely because both readings are
  defensible — but it should be a decision, not an accident.
- **Ranges compress output, and compression loses row-level columns.**
  Collapsing to `MIN`/`MAX` per group turns ten thousand rows into one, which
  is the whole point, but any per-row attribute that varies inside the island
  has to be aggregated or dropped. Decide up front whether the consumer wants
  the range or the rows; producing both means running the grouping twice or
  keeping the group key on the detail rows and joining back.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 10, "Working with Ranges", recipes 10.1, 10.3, 10.5, p. 313-317, 323-333 — doc
- [PostgreSQL Documentation — Set Returning Functions (generate_series)](https://www.postgresql.org/docs/current/functions-srf.html) — doc
- [PostgreSQL Documentation — Window Function Calls (default RANGE frame, peer rows)](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS) — doc
- [MySQL Reference Manual — WITH (Common Table Expressions, recursion and cte_max_recursion_depth)](https://dev.mysql.com/doc/refman/8.4/en/with.html) — doc
- [MySQL Reference Manual — Out-of-Range and Overflow Handling (unsigned subtraction)](https://dev.mysql.com/doc/refman/8.4/en/out-of-range-and-overflow.html) — doc
- [Microsoft Learn — GENERATE_SERIES (Transact-SQL, SQL Server 2022+)](https://learn.microsoft.com/en-us/sql/t-sql/functions/generate-series-transact-sql) — doc
- [Microsoft Learn — OVER Clause (Transact-SQL, ROWS/RANGE default frame)](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql) — doc
