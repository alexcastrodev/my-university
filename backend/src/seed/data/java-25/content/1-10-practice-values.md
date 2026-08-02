# Practice: Values

> Five exercises covering what this module introduced — text block
> incidental-whitespace stripping, `Integer`/`Long` wrapper caching and
> autoboxing, `Duration` vs. `Period` vs. `Instant`, time-zone conversion
> across a DST fall-back overlap, and compound-assignment narrowing mixed
> with ternary numeric promotion. Try to answer before opening each
> explanation.

---

## Exercise 1 — Text block incidental whitespace

```java
public class Report {
    void print() {
        String block = """
            Title
              Section
            End
            """;
        System.out.print(block);
    }
}
```

Exactly what does `System.out.print(block)` output? Be precise about the
leading spaces (if any) on each line.

<details>
<summary>Answer</summary>

```
Title
  Section
End
```

(with a trailing newline after `End`, and no blank line after that.)

The compiler determines **incidental whitespace** by scanning every
content line *and* the line containing the closing `"""` delimiter, even
though that closing-delimiter line has nothing on it but leading spaces.
It finds the **minimum indentation** among all of those lines and strips
exactly that many leading spaces from every line — relative indentation
beyond the minimum is preserved.

Here `"Title"` and `"End"` sit at 12 leading spaces, `"Section"` sits at
14, and the closing `"""` sits at 12 spaces as well. The minimum across
`{12, 14, 12, 12}` is **12**, so 12 spaces are stripped from every line:

- `"Title"` → 0 leading spaces → `Title`
- `"  Section"` → 2 leading spaces remain (14 − 12) → `  Section`
- `"End"` → 0 leading spaces → `End`
- the closing-delimiter line → becomes empty, contributing only the
  final line terminator

After stripping incidental whitespace the compiler also strips any
*trailing* whitespace from each line (none exists here) and normalizes
all line terminators to `\n`. The resulting string is
`"Title\n  Section\nEnd\n"`. Since the text block's own trailing `\n` is
already the last character, `print()` (not `println()`) needs nothing
extra — the output ends cleanly after `End` with no extra blank line.

If the closing `"""` had instead been placed at column 0 (no leading
spaces), the minimum indentation would drop to 0 and none of the leading
spaces on `Title`/`Section`/`End` would be stripped at all — that is the
technique the slide describes for preserving all leading whitespace.

</details>

---

## Exercise 2 — Wrapper caching and autoboxing

```java
Integer a = 100;
Integer b = 100;
Integer c = 200;
Integer d = 200;

Integer e = Integer.valueOf(127);
Integer f = 127;

Long g = 100L;
Long h = 100L;

System.out.println(a == b);
System.out.println(c == d);
System.out.println(e == f);
System.out.println(c.equals(d));
System.out.println(g == h);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
true
false
true
true
true
```

Autoboxing an `int` literal into an `Integer` compiles to a call to
`Integer.valueOf(int)`, and `Integer.valueOf` **caches and reuses**
wrapper instances for values in the range **-128 to 127**. `a` and `b`
are both `100`, which is inside that range, so both autoboxing
operations return the *same* cached `Integer` object — `a == b` is
`true`.

`c` and `d` are both `200`, which is **outside** the cache range. Every
autobox of a value outside the cache range allocates a **brand-new**
`Integer` object, so `c` and `d` reference two distinct objects even
though their content is identical — `c == d` is `false`. Their content
is still equal, though: `c.equals(d)` compares values, not references,
and correctly reports `true`.

`e` is created with an explicit `Integer.valueOf(127)` call; `f` is
created by autoboxing the literal `127`, which the compiler also
compiles down to `Integer.valueOf(127)`. Both go through the identical
cache lookup for `127` (inside the -128..127 range), so both expressions
return the same cached instance — `e == f` is `true`.

`Long` caches the same range, **-128 to 127**, for the exact same reason
(so that common small values shared across autoboxing don't need fresh
allocations). `g` and `h` are both `100L`, inside that range, so
`g == h` is also `true`.

This is the classic wrapper-caching trap: `==` on wrapper types happens
to "work" for small values purely because of caching, which lures
developers into relying on it — but it silently breaks the moment a
value like `200` is used instead of `100`. `.equals()` is the only
reliable way to compare wrapper values.

</details>

---

## Exercise 3 — Duration, Period, and Instant

```java
Instant start = Instant.parse("2025-01-01T00:00:00Z");
Instant end   = Instant.parse("2025-01-01T01:59:59Z");

System.out.println(start.until(end, ChronoUnit.HOURS));
System.out.println(start.until(end, ChronoUnit.MINUTES));

LocalDate date   = LocalDate.of(2025, 6, 15);
LocalDate result = date.plus(Duration.ofDays(1));
System.out.println(result);
```

Does this compile? What happens when it runs?

<details>
<summary>Answer</summary>

It compiles — `LocalDate.plus(TemporalAmount)` accepts *any*
`TemporalAmount`, including a `Duration`, at compile time. But it fails
at **runtime** on the last statement. The output is:

```
1
119
```

...followed by an uncaught `java.time.temporal.UnsupportedTemporalTypeException`
thrown from `date.plus(Duration.ofDays(1))`, which terminates the
program before anything from `result` is ever printed.

The gap between `start` and `end` is exactly 1 hour, 59 minutes, and 59
seconds (7199 seconds total). `Instant.until(end, unit)` — like
`ChronoUnit.between()` — counts only **complete** units and **truncates**
toward zero rather than rounding:
- In `ChronoUnit.HOURS`: 7199 seconds ÷ 3600 = 1.999… complete hours →
  truncates to `1`.
- In `ChronoUnit.MINUTES`: 7199 seconds ÷ 60 = 119.98… complete minutes
  → truncates to `119`.

The final statement is the real trap: `Duration` measures seconds and
nanoseconds and is meant to be applied to *time-based* temporals
(`LocalTime`, `LocalDateTime`, `Instant`). `LocalDate` has no time-of-day
component at all, so when `Duration.addTo(...)` tries to add seconds to
a `LocalDate`, the operation is rejected with
`UnsupportedTemporalTypeException` — the exact mirror-image mistake of
applying a `Period` (years/months/days) to a `LocalTime`. Reaching for
`Period.ofDays(1)` instead of `Duration.ofDays(1)` would have worked
fine and produced `2025-06-16`.

</details>

---

## Exercise 4 — DST fall-back overlap

```java
ZoneId ny = ZoneId.of("America/New_York");

ZonedDateTime overlap = LocalDateTime.of(2025, 11, 2, 1, 30).atZone(ny);
ZonedDateTime later   = overlap.withLaterOffsetAtOverlap();

System.out.println(overlap);
System.out.println(later);
System.out.println(overlap.toLocalDateTime().equals(later.toLocalDateTime()));
System.out.println(overlap.toInstant().equals(later.toInstant()));
```

What's printed on each line? (`America/New_York` falls back from EDT to
EST at 2025-11-02 02:00 local time, turning the clock back to 01:00 —
so 01:30 occurs twice that day.)

<details>
<summary>Answer</summary>

```
2025-11-02T01:30-04:00[America/New_York]
2025-11-02T01:30-05:00[America/New_York]
true
false
```

`01:30` on 2025-11-02 in `America/New_York` is ambiguous — it happens
once while still on Eastern Daylight Time (`-04:00`) and again, an hour
of real time later, after the clocks have fallen back to Eastern
Standard Time (`-05:00`). When you construct a `ZonedDateTime` from a
plain `LocalDateTime` that falls in this **overlap**, `atZone()` resolves
it to the **earlier** offset by default — so `overlap` prints with
`-04:00`. Calling `withLaterOffsetAtOverlap()` explicitly moves it to the
same local clock reading but resolved with the **later**, standard-time
offset, `-05:00`.

`overlap.toLocalDateTime()` and `later.toLocalDateTime()` both discard
the offset/zone and return just the wall-clock reading, `2025-11-02T01:30`
in both cases — so they're `.equals()` (`true`). But `toInstant()`
converts each to its actual point on the UTC timeline using its own
offset: `overlap` is `01:30 - (-04:00)` = `05:30Z`, while `later` is
`01:30 - (-05:00)` = `06:30Z`. Those are two different instants exactly
one hour apart, so `overlap.toInstant().equals(later.toInstant())` is
`false`.

This is precisely why the fall-back overlap is dangerous to ignore: two
`ZonedDateTime` values can display the *identical* local date and time
and still refer to two real moments that are an hour apart.

</details>

---

## Exercise 5 — Compound assignment casting and ternary promotion

```java
byte b = 100;
b += 50;
System.out.println(b);

int    i = 10;
double d = 3.0;
System.out.println(true  ? i : d);
System.out.println(false ? i : d);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
-106
10.0
3.0
```

`b += 50` is shorthand for `b = (byte) (b + 50)` — compound assignment
operators carry an **implicit narrowing cast** back to the variable's
declared type, which is exactly why this compiles even though
`b = b + 50` would not (`b + 50` promotes to `int`, and assigning an
`int` to a `byte` without a cast is a compile error). The addition
itself, `100 + 50`, is performed as an `int` and produces `150`, which
is then narrowed back to `byte`. `byte` is an 8-bit two's-complement type
with range -128 to 127, so `150` doesn't fit; only its low 8 bits
survive, which is equivalent to `150 - 256 = -106`.

The two `println` calls both evaluate a ternary expression whose two
branches have different numeric types (`int` and `double`). The Java
Language Specification requires that the *static type* of a conditional
expression like this be the **common promoted type** of both branches —
here, `double` — determined once, at compile time, regardless of which
branch actually runs. That promotion is applied to *whichever* branch is
selected at runtime:
- `true ? i : d` selects `i` (the `int`, value `10`), which then gets
  widened to `double` to match the expression's static type, printing
  `10.0`.
- `false ? i : d` selects `d` directly — it's already a `double` with
  value `3.0` — so it prints `3.0` unchanged.

The trap is assuming both lines print the same thing because "the
expression type is double either way" — the *type* is fixed at compile
time, but the *value* still depends entirely on which branch the
condition picks at runtime.

</details>
