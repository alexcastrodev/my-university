---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`LIKE 'A%'` answers "does this string start with A" and stops there. Two
questions it can't answer come up constantly in real data work: *how many
times* does a character or substring occur inside a value, and *which rows
fail* to match an expected shape. The first is classically solved without any
regex at all — measure the string, strip the thing you're counting, measure
again, and divide by the search string's length. The second is the negative
match: `NOT LIKE`, `!~`, `NOT REGEXP`, or the `TRANSLATE` trick of deleting
every allowed character and asking whether anything is left over. Both are
string problems where the portable answer and the modern per-vendor answer
have drifted apart since the book was written.

## Use Cases

- Data-quality sweeps: flagging product codes, SKUs, or postal codes that
  contain a character outside the allowed set, before they reach a report.
- Validating a fixed-shape delimited string by counting its delimiters — a
  `10,CLARK,MANAGER` record with anything other than two commas is malformed
  regardless of what the fields contain.
- Finding badly formatted structured text in a free-form column: phone
  numbers, IDs, or dates typed by hand into a comment field.
- Input validation inside a `CHECK` constraint or a pre-insert query, so a
  value that doesn't match the expected pattern never lands in the table.
- Auditing an imported column for stray whitespace, control characters, or
  non-ASCII bytes by counting how many characters fall outside a whitelist.

## Deep Dive

### Counting occurrences of a character or substring

The book's technique needs nothing but `LENGTH` and `REPLACE`: take the
original length, subtract the length of the string with the target removed,
and the difference is how many characters vanished.

```sql
select (length('10,CLARK,MANAGER') -
        length(replace('10,CLARK,MANAGER', ',', ''))) / length(',') as cnt;
-- cnt = 2
```

The division by `length(',')` looks redundant for a single character, and
that's exactly why it gets dropped and exactly why it matters. Remove it and
a multi-character search string counts *characters removed*, not
*occurrences*:

```sql
select (length('HELLO HELLO') - length(replace('HELLO HELLO','LL',''))) / length('LL')
         as correct_cnt,
       (length('HELLO HELLO') - length(replace('HELLO HELLO','LL','')))
         as incorrect_cnt;

-- correct_cnt  incorrect_cnt
-- -----------  -------------
--           2              4
```

On SQL Server the function is `LEN`, not `LENGTH`; everything else is
identical:

```sql
select (len('10,CLARK,MANAGER') -
        len(replace('10,CLARK,MANAGER', ',', ''))) / len(',') as cnt;
```

**What has changed:** two of the three engines now ship a native counter.
PostgreSQL 15 (2022) added `regexp_count()` alongside `regexp_like()`,
`regexp_instr()`, and `regexp_substr()`, explicitly "for compatibility with
other relational systems" — it's PostgreSQL's spelling of the SQL standard's
`OCCURRENCES_REGEX`:

```sql
-- PostgreSQL 15+
select regexp_count('10,CLARK,MANAGER', ',');      -- 2
select regexp_count('HELLO HELLO', 'LL');          -- 2, no division needed
select regexp_count('ABCABCAXYaxy', 'A.', 1, 'i'); -- 4 (start position, then flags)
```

SQL Server 2025 (17.x) added `REGEXP_COUNT` too, along with the rest of the
`REGEXP_*` family — available on Azure SQL Database, Azure SQL Managed
Instance, and SQL database in Fabric as well, and gated behind database
compatibility level 170:

```sql
-- SQL Server 2025 / Azure SQL, compat level 170+
select REGEXP_COUNT('10,CLARK,MANAGER', ',');      -- 2
```

MySQL is the holdout. It has had ICU-backed regex since 8.0.4 —
`REGEXP_LIKE()`, `REGEXP_INSTR()`, `REGEXP_REPLACE()`, `REGEXP_SUBSTR()` —
but **no `REGEXP_COUNT`**, and that's still true through the 9.x manual. The
length-difference trick is not a legacy idiom on MySQL; it's the answer,
just with `REGEXP_REPLACE` swapped in when the thing being counted is a
pattern rather than a literal:

```sql
-- MySQL 8.0.4+: count digits in a column, no REGEXP_COUNT available
select txt,
       char_length(txt) - char_length(regexp_replace(txt, '[0-9]', '')) as digit_cnt
  from t;
```

Note `char_length`, not `length` — see the trade-offs.

### Negative pattern matching: finding what doesn't fit

The simplest form of the problem is "which rows contain a character outside
the allowed set." There are two ways to phrase it, and they are not
equivalent:

```sql
-- PostgreSQL: "contains at least one non-digit"
select code from t where code ~ '[^0-9]';

-- PostgreSQL: "is not entirely digits" — also true for the empty string
select code from t where code !~ '^[0-9]+$';
```

The first requires a bad character to exist; the second flags `''` as well,
because an empty string has no digits to anchor against. Pick deliberately.
The same pair in MySQL, where `REGEXP`/`RLIKE`/`REGEXP_LIKE()` are synonyms
and `NOT REGEXP` is the negation:

```sql
-- MySQL 8.0.4+
select code from t where code regexp '[^0-9]';
select code from t where code not regexp '^[0-9]+$';
select code from t where regexp_like(code, '[^0-9]');   -- same thing, function form
```

SQL Server is the interesting case, and the answer depends on the version.
Through SQL Server 2022 there is **no native regex at all** — the options
were `LIKE`, a SQLCLR assembly, or hand-rolled string surgery. What saves
`LIKE` here is that T-SQL's `LIKE` is the only one of the three that supports
character classes, including negated ones:

```sql
-- SQL Server, any version: character-class wildcards inside LIKE
select code from t where code like '%[^0-9]%';   -- contains a non-digit
select code from t where code not like '%[^0-9]%'; -- all digits
```

That `[^...]` wildcard has no equivalent in PostgreSQL's or MySQL's `LIKE`
(PostgreSQL offers `SIMILAR TO` as a halfway house). It is genuinely useful,
but it caps out fast: `LIKE` has no quantifiers, no alternation, and no way
to say "three digits, then a separator, then three digits."

**What has changed:** SQL Server 2025 closed the gap. `REGEXP_LIKE`,
`REGEXP_REPLACE`, `REGEXP_SUBSTR`, `REGEXP_INSTR`, `REGEXP_COUNT`,
`REGEXP_MATCHES`, and `REGEXP_SPLIT_TO_TABLE` all exist now, built on
Google's RE2 library:

```sql
-- SQL Server 2025+, compat level 170
select code from t where REGEXP_LIKE(code, '[^0-9]') = 1;
```

The `TRANSLATE`-based technique sits between the two worlds: strip every
allowed character and check whether anything survives. PostgreSQL's
`TRANSLATE` deletes characters when the `to` string is shorter than the
`from` string, so the whitelist collapses to nothing:

```sql
-- PostgreSQL: anything left after deleting all digits is an illegal character
select code from t where translate(code, '0123456789', '') <> '';
```

SQL Server has had `TRANSLATE` since 2017, but it **errors if the two
character lists differ in length**, so the deletion has to happen in a second
pass:

```sql
-- SQL Server 2017+: map digits to spaces, then strip the spaces
select code from t
 where replace(translate(code, '0123456789', '          '), ' ', '') <> '';
```

MySQL has no `TRANSLATE` at all — the equivalent is a stack of nested
`REPLACE` calls, one per character, which is exactly the point at which you
give up and use `REGEXP`.

The book's full recipe 6.17 is the sophisticated version of the same shape:
define pattern A for "things that look like a phone number," define pattern B
for "correctly formatted phone numbers," blank out every B-match, and see
whether any A-matches remain.

```sql
-- PostgreSQL 15+ runs this essentially as printed
select emp_id, text
  from employee_comment
 where regexp_like(text, '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}')
   and regexp_like(
         regexp_replace(text, '[0-9]{3}([-. ])[0-9]{3}\1[0-9]{4}', '***'),
         '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}');
```

Pattern B's `\1` is a backreference: whatever separator `([-. ])` captured
must reappear, so `989-387-4321` is good and `989-387.5359` is not. MySQL
runs this too, with the backslash doubled because MySQL string literals treat
`\` as an escape character (`'...\\1...'`).

SQL Server 2025 **cannot** run it. RE2 is a linear-time automaton engine and
by design supports neither backreferences nor lookaround. Pattern B has to be
rewritten as explicit alternation, one branch per separator:

```sql
-- SQL Server 2025: no \1 available, enumerate the separators instead
select emp_id, text
  from employee_comment
 where REGEXP_LIKE(text, '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}') = 1
   and REGEXP_LIKE(
         REGEXP_REPLACE(text,
           '[0-9]{3}-[0-9]{3}-[0-9]{4}|[0-9]{3}\.[0-9]{3}\.[0-9]{4}|[0-9]{3} [0-9]{3} [0-9]{4}',
           '***'),
         '[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}') = 1;
```

## Trade-offs

- **The length-difference trick is portable, but it copies every string it
  touches.** `REPLACE` materializes a new value for each row before the
  lengths can be compared, so counting a delimiter across a wide `text`
  column is two full scans of the data plus one allocation per row. A native
  `regexp_count` walks the string once. Neither is sargable — both force a
  full scan regardless of what indexes exist on the column — so the choice is
  purely about per-row cost, not about access path.
- **`LENGTH`, `LEN`, and `CHAR_LENGTH` are three different functions wearing
  similar names, and two of them will silently give a wrong count.** SQL
  Server's `LEN` ignores trailing spaces, which breaks the trick precisely
  when the character being counted *is* a space; MySQL's `LENGTH` returns
  bytes, not characters, which breaks it on any multibyte input.
  ```sql
  -- SQL Server: 'a  b  ' has four spaces, LEN reports two
  select len('a  b  ') - len(replace('a  b  ', ' ', ''));               -- 2  (wrong)
  select datalength('a  b  ') - datalength(replace('a  b  ', ' ', '')); -- 4  (right, varchar)

  -- MySQL: use CHAR_LENGTH, never LENGTH, on utf8mb4 columns
  select length('café'), char_length('café');                           -- 5, 4
  ```
- **A negative match never returns `NULL` rows, which is the opposite of what
  a data-quality query wants.** `NULL NOT LIKE '%x%'` is `UNKNOWN`, not
  `TRUE`, so a "find the malformed values" query silently skips every row
  where the column is `NULL` — the rows most likely to be a problem. Every
  negative-match predicate needs an explicit `OR col IS NULL` unless the
  column is `NOT NULL`.
  ```sql
  select code from t where code not like '%[^0-9]%' or code is null;
  ```
- **SQL Server 2025's regex is not a drop-in for PostgreSQL or MySQL
  patterns.** RE2 trades backreferences and lookaround for a guarantee of
  linear-time matching, so any pattern relying on `\1`, `(?=...)`, or
  `(?<!...)` — including this recipe's own Pattern B — has to be restructured
  into alternation. It also deliberately ignores SQL collations, so
  `REGEXP_LIKE` and `LIKE` can disagree about the same two strings on a
  case-insensitive or accent-insensitive column.
- **"Doesn't match the good pattern" and "matches a bad pattern" are
  different questions, and free-form text is where the difference bites.**
  The book's two-pattern structure exists precisely because a comment field
  contains arbitrary prose: a naive `NOT REGEXP '<good phone number>'` would
  flag every row that merely fails to contain a phone number. Narrowing the
  universe first (pattern A), then subtracting the acceptable cases (pattern
  B), is the part of the recipe that survives every syntax change.
- **Regex support is now the norm, so reaching for it is defensible — but
  version floors are real.** `regexp_count` needs PostgreSQL 15+, the
  `REGEXP_*` functions need MySQL 8.0.4+, and SQL Server needs 2025 with
  compatibility level 170 or Azure SQL. On anything older, the
  `LENGTH`/`REPLACE` and `LIKE '%[^0-9]%'` forms in this recipe are not a
  stylistic fallback; they are the only thing that runs.

## Documentation Links

- Anthony Molinaro and Robert de Graaf, "SQL Cookbook", 2nd Edition (O'Reilly, 2020) — Chapter 6, "Working with Strings", recipes 6.3, 6.17, p. 109-110, 164-167 — doc
- [PostgreSQL Documentation — Pattern Matching (LIKE, SIMILAR TO, POSIX regex, regexp_count)](https://www.postgresql.org/docs/current/functions-matching.html) — doc
- [MySQL Reference Manual — Regular Expressions (REGEXP, RLIKE, REGEXP_LIKE, no REGEXP_COUNT)](https://dev.mysql.com/doc/refman/8.4/en/regexp.html) — doc
- [Microsoft Learn — LIKE (Transact-SQL), including the [ ] and [^] wildcards](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/like-transact-sql) — doc
- [Microsoft Learn — Work with Regular Expressions in SQL Server 2025 (RE2-based REGEXP_* functions)](https://learn.microsoft.com/en-us/sql/relational-databases/regular-expressions/overview) — doc
