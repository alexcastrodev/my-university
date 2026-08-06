---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Real columns are frequently dirtier than their declared type suggests: a
`varchar` that holds `"AUD$1,200"`, a legacy code column where `"CL10AR"`
packs a name and a department number into one value, a CSV import that
arrived with stray commas and currency markers baked into the digits.
Before any of that can take part in a numeric or business computation it has
to be *cleaned* (strip the characters that don't belong), *split* (pull the
numeric part away from the character part), and *validated* (prove the
remaining text is actually castable). SQL's classic answer to all three is
the same two functions — `TRANSLATE` and `REPLACE` — used as a
character-mapping trick; the modern answer, on most engines, is a regular
expression.

## Use Cases

- Validating user- or partner-submitted text before a `CAST` to `numeric`,
  so a single bad row doesn't abort the whole statement.
- Cleaning imported data with stray formatting characters — thousands
  separators, currency symbols, non-breaking spaces — out of what should be
  a plain quantity.
- Splitting a legacy `"SKU123"` / `"CL10AR"` style code into its character
  and numeric components when the source system never separated them.
- Escaping or removing delimiter characters (commas, quotes) from a text
  field before exporting it to CSV.
- Filtering a mixed column down to just the rows that contain a number at
  all, ahead of a numeric aggregate.

## Deep Dive

### Removing unwanted characters from a string

The book's problem: strip all vowels from `ENAME`, and all zeros from `SAL`.
`REPLACE` handles the zeros directly — one character, one call. The vowels
are the interesting case, because `REPLACE` only removes *one* search string
per call. The book's trick is to first collapse all five vowels into a
single arbitrary sentinel character with `TRANSLATE`, then `REPLACE` that one
sentinel away:

```sql
-- the book's technique (PostgreSQL / SQL Server / Oracle / DB2)
select ename,
       replace(translate(ename,'AEIOU','aaaaa'),'a','') as stripped1,
       sal,
       replace(cast(sal as char(4)),'0','')             as stripped2
  from emp;
```

MySQL has no `TRANSLATE` at all — not in 8.4, not in 9.x — so the book falls
back to five nested `REPLACE` calls:

```sql
-- MySQL, the book's version
select ename,
       replace(replace(replace(replace(replace(
         ename,'A',''),'E',''),'I',''),'O',''),'U','') as stripped1,
       sal,
       replace(sal,0,'')                               as stripped2
  from emp;
```

**PostgreSQL makes the `REPLACE` wrapper unnecessary.** Its `translate()` is
documented as: "If *from* is longer than *to*, occurrences of the extra
characters in *from* are deleted." So a `to` argument of `''` deletes every
character in `from` outright — the sentinel round-trip is pure ceremony
here:

```sql
-- PostgreSQL: one call, no sentinel
select translate(ename,'AEIOU','') as stripped1 from emp;
select translate('12345','143','ax');   -- 'a2x5' — the '3' is simply deleted
```

**SQL Server's `TRANSLATE` cannot do this.** It was added in SQL Server 2017
(the book's own recipe 6.13 claims it isn't supported, which was already
stale on publication), but T-SQL requires the two lists to match: "`TRANSLATE`
will return an error if *characters* and *translations* expressions have
different lengths." On SQL Server the book's `REPLACE(TRANSLATE(...))`
two-step is not convoluted — it's mandatory.

The regex form is the one that reads the same everywhere it exists, and it
scales to *classes* of characters rather than an enumerated list:

```sql
-- PostgreSQL (the 'g' flag replaces all matches, not just the first)
select regexp_replace(ename, '[AEIOU]', '', 'g') as stripped1,
       regexp_replace(sal::text, '[^0-9]', '', 'g') as digits_only
  from emp;

-- MySQL 8.0.4+ (REGEXP_REPLACE replaces all occurrences by default)
select regexp_replace(ename, '[AEIOU]', '') as stripped1 from emp;

-- SQL Server 2025 (17.x) and Azure SQL — RE2-based, new in this release
select regexp_replace(ename, '[AEIOU]', '') as stripped1 from emp;
```

Before SQL Server 2025 there is no native regex at all: the options were a
CLR assembly, or `LIKE` with bracket classes in a `WHILE` loop — which is
precisely why the `TRANSLATE`/`REPLACE` idiom survived so long in T-SQL
codebases.

### Separating numeric and character parts

Given a single column packing both, e.g. `SMITH800`, the book extracts each
side by running the same collapse-then-remove trick twice, in opposite
directions:

```sql
-- PostgreSQL, the book's solution
select replace(
         translate(data,'0123456789','0000000000'),'0','')   as ename,
       cast(
         replace(
           translate(lower(data),
                     'abcdefghijklmnopqrstuvwxyz',
                     rpad('z',26,'z')),'z','') as integer)   as sal
  from (select ename || sal as data from emp) x;
```

Read it inside-out. `translate(data,'0123456789','0000000000')` maps every
digit to `0`, giving `SMITH000`; `replace(...,'0','')` then deletes all of
them, leaving `SMITH`. The other direction maps all 26 letters to `z`
(`zzzzz800`), then deletes the `z`s, leaving `800` to cast. It works, and
its intent is genuinely hard to read at a glance.

Both halves collapse to a single regex call and one obvious pattern:

```sql
-- PostgreSQL
select regexp_replace(data, '[0-9]',  '', 'g')            as ename,
       regexp_replace(data, '[^0-9]', '', 'g')::integer   as sal
  from (select ename || sal as data from emp) x;

-- MySQL 8.0.4+ — the same query, and MySQL has no TRANSLATE alternative
select regexp_replace(data, '[0-9]',  '') as ename,
       cast(regexp_replace(data, '[^0-9]', '') as unsigned) as sal
  from (select concat(ename, sal) as data from emp) x;
```

The MySQL comparison is the sharpest one. The book's MySQL solution for this
problem class is a *cross join against a pivot table of integers*, walking
the string one character at a time and reassembling the digits with
`GROUP_CONCAT` — a row per character, then a group-by. `REGEXP_REPLACE`,
available since MySQL 8.0.4, replaces the entire construction with one
expression.

Note also that `[0-9]` and `[^0-9]` are complements of each other, so the
"split" is exact by construction — the two `TRANSLATE` pipelines have no such
guarantee, and the letter list has to be spelled out (and lower-cased first)
to be complete.

### Detecting strings that can be treated as numbers

The book's recipe 6.13 filters a mixed column down to rows containing at
least one digit, then extracts those digits. The gate is a `TRANSLATE` +
`strpos` probe:

```sql
-- PostgreSQL, the book's predicate
select mixed
  from v
 where strpos(translate(mixed,'0123456789','9999999999'), '9') > 0;
```

Map every digit to `9`, then ask whether a `9` appears anywhere. Modern
PostgreSQL says the same thing with the `~` operator, and gets a real
anchored *validity* test — not just "contains a digit" — for the same effort:

```sql
select mixed from v where mixed ~ '[0-9]';        -- contains a digit
select mixed from v where mixed ~ '^[0-9]+$';     -- is entirely digits
select mixed from v where regexp_like(mixed, '^-?[0-9]+(\.[0-9]+)?$');
```

`regexp_like()` (alongside `regexp_count()`, `regexp_instr()`, and
`regexp_substr()`) arrived in PostgreSQL 15; `~`, `!~`, and
`regexp_replace()` have been there far longer, so the operator form is the
portable-across-PG-versions choice.

Beware what the book's recipe actually returns, though: it strips *all*
non-digits and concatenates whatever is left, so `CL10AR` yields `10` — and,
as the book itself warns, `99Gennick87` yields `9987`. That is digit
harvesting, not validation. If the question is "can I `CAST` this?", the two
are not the same test:

```sql
-- PostgreSQL 16+: the direct answer, range check included
select mixed,
       pg_input_is_valid(mixed, 'integer') as castable
  from v;

select pg_input_is_valid('42',           'integer');  -- t
select pg_input_is_valid('42000000000',  'integer');  -- f — matches ^[0-9]+$, still not an integer
```

`pg_input_is_valid(string, type)` (with its companion
`pg_input_error_info()`, both added in PostgreSQL 16) asks the type's own
input function whether the value parses, so it catches overflow, scale, and
format in one call — something no regex can do, because `^[0-9]+$` happily
accepts a twenty-digit string that `integer` cannot hold.

**SQL Server** has offered `ISNUMERIC` since forever, and it is the classic
trap. Its own documentation states it "returns `1` for some characters that
aren't numbers, such as plus (`+`), minus (`-`), and valid currency symbols
such as the dollar sign (`$`)" — and it answers for *any* numeric type,
including `money` and `float`, so `'1e5'` and `'$1'` both pass while a later
`CAST` to `int` still fails. The correct modern T-SQL guard is `TRY_CAST` /
`TRY_CONVERT`, which returns `NULL` instead of raising:

```sql
-- unreliable
select mixed from v where isnumeric(mixed) = 1;

-- the actual question: does this cast?
select mixed, try_cast(mixed as int) as as_int
  from v
 where try_cast(mixed as int) is not null;

-- SQL Server 2025 (17.x), compatibility level 170+ for REGEXP_LIKE
select mixed from v where regexp_like(mixed, '^[0-9]+$');
```

**MySQL** has no `TRY_CAST` equivalent, and its implicit conversion is
lenient rather than loud — a plain `SELECT` truncates and warns instead of
failing, so bad data slips through silently:

```sql
select cast('12abc' as unsigned);   -- 12, plus warning 1292 'Truncated incorrect ... value'
select cast('abc'   as unsigned);   -- 0,  plus the same warning
```

The regex guard is therefore not a stylistic preference on MySQL, it's the
mechanism:

```sql
select mixed
  from v
 where regexp_like(mixed, '^-?[0-9]+$');
```

## Trade-offs

- **`TRANSLATE` is portable in name only — every engine's version behaves
  differently at the edges.** PostgreSQL deletes the surplus characters when
  `from` is longer than `to`, so a one-call strip works; SQL Server raises an
  error on mismatched lengths, so the `REPLACE` sentinel step is compulsory;
  MySQL doesn't implement `TRANSLATE` at all. A `TRANSLATE`-based cleaning
  expression cannot be lifted between the three unchanged.
  ```sql
  translate('12345','143','ax')            -- PostgreSQL → 'a2x5'
  TRANSLATE('12345','143','ax')            -- SQL Server → error, lengths differ
  ```
- **Regex is dramatically more readable, but it is not available everywhere
  the book's technique is.** `[^0-9]` states the intent in four characters
  where `REPLACE(TRANSLATE(...))` takes two nested calls and an arbitrary
  sentinel. That readability is only purchasable on PostgreSQL (long
  standing), MySQL 8.0.4+ (ICU-based, replacing the older Henry Spencer
  library), and SQL Server 2025 / Azure SQL (RE2-based, with `REGEXP_LIKE`
  additionally gated on database compatibility level 170). On SQL Server
  2022 and earlier the `TRANSLATE`/`REPLACE` idiom is still the answer, not a
  legacy habit.
- **Enumerated character lists silently miss anything outside ASCII.** The
  book's `'abcdefghijklmnopqrstuvwxyz'` argument covers 26 letters and
  nothing else — `JOSÉ1200`, `MÜLLER300`, or any Cyrillic/CJK name leaves
  residue in the "numeric" half and then breaks the `CAST`. Regex character
  classes (`[[:alpha:]]` in PostgreSQL, `\p{L}` under MySQL's ICU engine)
  are defined over Unicode categories and don't have this blind spot.
- **But Unicode-aware digit classes cut the other way — prefer `[0-9]` over
  `\d` when a `CAST` follows.** Under ICU, `\d` matches the whole Unicode
  `Nd` category, so Arabic-Indic or fullwidth digits pass the "is it a
  number" test and then fail conversion anyway. Spelling the ASCII range
  explicitly keeps the validation predicate and the target type in agreement.
- **A regex validity test is not a type validity test.** `^[0-9]+$` accepts
  `'42000000000'`, which no `integer` column can hold, and rejects `'1e5'` or
  `'1_000'`, which some types do accept. Where the engine offers a
  type-driven check — `pg_input_is_valid()` on PostgreSQL 16+, `TRY_CAST` on
  SQL Server — use it instead of hand-rolling the grammar of the type into a
  pattern; SQL Server's `ISNUMERIC` is the cautionary example of a built-in
  that answers a *different*, looser question than the one you asked.
- **At scale, both approaches scan, and regex costs more per row.**
  `TRANSLATE` is a single linear pass over the string against a character
  map; a regex has to compile a pattern and run a matcher, which is why
  MySQL exposes `regexp_time_limit` and `regexp_stack_limit` to bound it.
  More importantly, neither form is sargable — any `WHERE
  regexp_like(col, ...)` or `WHERE strpos(translate(col, ...), '9') > 0`
  reads every row. If the cleaning predicate runs often, materialize it: a
  generated/computed column, or a PostgreSQL expression index on the cleaned
  value.
  ```sql
  -- PostgreSQL: index the cleaned form once instead of recomputing per query
  create index on v ((regexp_replace(mixed, '[^0-9]', '', 'g')));
  ```

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 6, "Working with Strings", recipes 6.4, 6.5, 6.13, p. 110-116, 147-153 — doc
- [PostgreSQL Documentation — String Functions and Operators (translate, regexp_replace)](https://www.postgresql.org/docs/current/functions-string.html) — doc
- [PostgreSQL Documentation — Pattern Matching (POSIX regular expressions, `~`, regexp_like)](https://www.postgresql.org/docs/current/functions-matching.html) — doc
- [PostgreSQL Documentation — System Information Functions (pg_input_is_valid, pg_input_error_info)](https://www.postgresql.org/docs/current/functions-info.html) — doc
- [MySQL Reference Manual — Regular Expressions (REGEXP_LIKE, REGEXP_REPLACE, ICU engine)](https://dev.mysql.com/doc/refman/8.4/en/regexp.html) — doc
- [Microsoft Learn — TRANSLATE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/translate-transact-sql) — doc
- [Microsoft Learn — ISNUMERIC (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/isnumeric-transact-sql) — doc
- [Microsoft Learn — Regular Expressions Functions (Transact-SQL), SQL Server 2025](https://learn.microsoft.com/en-us/sql/t-sql/functions/regular-expressions-functions-transact-sql) — doc
