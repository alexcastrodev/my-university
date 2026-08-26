---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`0.1 + 0.2` does not equal `0.3` on almost any computer, and the reason is not
a rounding bug in the addition — it's that `float`/`double` represent numbers
in base 2, and most decimal fractions (`0.1`, `0.2`, `0.3`, `0.7`) have no
finite binary expansion, the same way `1/3` has no finite decimal expansion.
The value actually stored is the nearest representable approximation, so any
column or variable typed as `float8`/`double precision` is already lying by a
few units in the seventeenth decimal place before a single calculation runs.
For money this stops being a curiosity: a stored total of `108.80` can
silently be `108.80000000000001` internally, and `WHERE total = 108.80` can
miss the row it's looking for. The fix isn't "round harder" — rounding at
every step of a large aggregation introduces the same biased decision
thousands of times over — it's picking a representation that's exact to begin
with: `NUMERIC`/`DECIMAL` in the database, integer minor units (cents), or
`BigDecimal` in application code, instead of a binary float pretending to be
decimal.

## Use Cases

- Storing or comparing monetary totals in a database column, where
  `WHERE total = 108.80` needs to actually match the row that displays as
  `108.80`.
- Summing thousands of line items (invoices, order totals, ledger entries)
  where *when* rounding happens — once at the end versus once per row —
  changes the final total by real money.
- Choosing a schema type for a price/amount column: `NUMERIC(10,2)`, an
  integer cents column, or (the wrong choice) `FLOAT`/`DOUBLE PRECISION`.
- Integrating with a payment or billing API, most of which speak integer
  minor units (cents, pence) on the wire specifically to sidestep this
  problem.
- Explaining an "off by a cent" discrepancy between a total your code
  computed and a total a bank, invoice, or spreadsheet reports back.

## Deep Dive

### Why `0.1` has no exact binary representation

A `float`/`double` is a sum of powers of two. Some decimals happen to be exact
in binary because they're built from negative powers of two:

```text
0.5   = 1/2   = 0.1₂
0.25  = 1/4   = 0.01₂
0.125 = 1/8   = 0.001₂
```

But `0.1` is `1/10`, and `10` is not a power of two — so, just like `1/3` in
decimal produces an endless `0.3333...`, `1/10` in binary produces an endless
repeating fraction:

```text
0.1 (decimal) ≈ 0.0001100110011001100110011... (binary, repeating)
```

A `double` has 52 bits of mantissa, so this repeating pattern gets cut off and
rounded to the nearest representable value. The number actually stored for
the literal `0.1` is:

```text
0.1000000000000000055511151231257827021181583404541015625
```

not `0.1`. It only *displays* as `0.1` because the printing routine rounds
back to the shortest decimal that reads the same. This is a property of IEEE
754 binary floating point itself — it holds identically whether the `0.1` is
a Python `float`, a PostgreSQL `float8`, a Java `double`, or a JavaScript
`number`, because all four use the same binary64 format.

### Watch it happen: adding two approximations, not two decimals

`0.1 + 0.2` doesn't add the decimals `0.1` and `0.2` — it adds whatever
binary64 actually stored for each of them, and *that* sum is what gets
printed:

```viz
type: moves
mark 0 | "0.1" is stored as 0.1000000000000000055511151231257827021181583404541015625 — the nearest binary64 value, not the exact decimal.
mark 1 | "0.2" is stored as 0.200000000000000011102230246251565404236316680908203125 — also not exact.
mark 2 | Adding the two stored approximations gives 0.3000000000000000444089209850062616169452667236328125, which prints as 0.30000000000000004 — not 0.3.
---
0.1
0.2
sum
```

The arithmetic performed no rounding error of its own; both inputs were
already off before the `+` ran, and adding two slightly-wrong numbers cannot
produce an exactly-right one.

### "Round at the end" beats "round every step" — but isn't a universal rule

A tempting fix is to round after every calculation:

```js
(0.1 + 0.2).toFixed(2) // "0.30"
```

`toFixed` rounds the already-imprecise value in memory — it doesn't recover
the original decimal, so it can still land wrong on values exactly on a
rounding boundary. Worse is rounding at *every intermediate step* of a large
aggregation. Given 10,000 rows each valued `10.004`:

```text
value → round to 2 places → sum      -- 10,000 independent rounding decisions
sum all values → round once          -- 1 rounding decision
```

The first form makes the same directional decision 10,000 times, which can
accumulate into a real, systematic drift; the second makes it once. This is
not a universal rule — fiscal and accounting rules sometimes *require*
rounding at specific intermediate steps — but rounding or truncating
arbitrarily at every step, with no rule driving it, accumulates bias for no
reason. Truncation makes this worse than rounding: truncating `10.009` to two
places gives `10.00`, while rounding gives `10.01` — repeated thousands of
times, truncation biases the total downward in a way rounding does not.

### Strings preserve digits but aren't a numeric model

Storing `"108.80"` as text preserves the exact characters, but the moment
code needs to do arithmetic on it, it has to be parsed back into a number:

```js
Number("108.80") // 108.8 — a float again, same problem as before
```

A string is fine for transport or display; it isn't a substitute for a
numeric type that supports addition, comparison, and rounding rules.

### Integer minor units: money as a plain integer

Instead of storing `10.99`, store `1099` (cents) and do every operation as
integer arithmetic:

```text
  1099   (10.99)
+  550   ( 5.50)
------
  1649   (16.49)
```

There is no `0.1 + 0.2` here — just integers, which is why payment APIs
(Stripe, most banking rails) transact in minor units on the wire. Two things
this doesn't solve for free: currencies don't all use two decimal places
(JPY has zero, some currencies use three), and division doesn't distribute
cleanly — `1099 / 3` is not an integer number of cents, so the code still has
to decide how to allocate the remainder (e.g. give the extra cent to the
first or last share).

### `NUMERIC`/`DECIMAL` in PostgreSQL, and `BigDecimal` in Java

`NUMERIC(precision, scale)` stores an exact decimal value, not a binary
approximation:

```sql
create table invoice (
  id     bigserial primary key,
  total  numeric(10, 2) not null
);

insert into invoice (total) values (108.80);
select total = 108.80 from invoice; -- true, exactly
```

`FLOAT`/`DOUBLE PRECISION` in the same table would carry the same binary64
imprecision described above straight into SQL comparisons.

Java's `double` has the identical problem, and `BigDecimal` is the
equivalent fix — but only when constructed correctly. `new BigDecimal(double)`
converts from the `double`'s *actual stored binary value*, reproducing the
imprecision instead of curing it:

```java
new BigDecimal(0.1);
// 0.1000000000000000055511151231257827021181583404541015625

new BigDecimal("0.1");     // exact — parses the decimal text directly
BigDecimal.valueOf(0.1);   // exact — routes through Double.toString() first
```

The rule of thumb: build `BigDecimal` from a `String` or an integer minor
unit, never from a `double` literal that already lost precision before
`BigDecimal` ever saw it.

### The correction that matters: the math is right, the representation is approximate

"`19.90 × 100` doesn't give exactly `1990`" is easy to state sloppily.
Mathematically, `19.90 × 100 = 1990.00`, exactly. The problem shows up only
once `19.90` is represented as a `double`:

```text
19.90 (double) ≈ 19.899999999999998578914528479799628257751464843750
19.90 * 100    ≈ 1989.9999999999998
```

The multiplication is correct arithmetic on an already-approximate input. The
representation is what's approximate — not the math.

## Trade-offs

- **`float`/`double` are fast and compact, but never exact for money** — most
  decimal fractions have no finite binary form, so equality comparisons and
  running totals silently drift.
  ```js
  0.1 + 0.2 === 0.3 // false
  ```
- **Strings are exact to look at, but not a numeric model** — every
  arithmetic operation requires parsing back into a number, which reintroduces
  the float problem it was meant to avoid.
- **Integer minor units are exact and fast, but push unit and rounding
  discipline onto every piece of code that touches the value** — a currency
  with a different number of decimal places, or a division that doesn't
  divide evenly, both require an explicit decision the integer type itself
  won't make for you.
- **`NUMERIC`/`DECIMAL` (and `BigDecimal` in application code) give exact
  decimal arithmetic end-to-end, at the cost of speed and explicit rounding
  decisions** — `BigDecimal.divide` throws `ArithmeticException` on a
  non-terminating decimal expansion unless a `RoundingMode` (or scale) is
  supplied, which is the type forcing you to make the same rounding decision
  a `float` would have silently botched for you.
  ```java
  new BigDecimal("10").divide(new BigDecimal("3")); // ArithmeticException: Non-terminating decimal expansion
  ```

## Documentation Links

- [PostgreSQL Documentation — Numeric Types (numeric, decimal, real, double precision)](https://www.postgresql.org/docs/current/datatype-numeric.html) — doc
- [Java SE 25 API — BigDecimal](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) — doc
- [David Goldberg, "What Every Computer Scientist Should Know About Floating-Point Arithmetic" (hosted by Oracle)](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html) — doc
- [MDN — Number.prototype.toFixed()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed) — doc
