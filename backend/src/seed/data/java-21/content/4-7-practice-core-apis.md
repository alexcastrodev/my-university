# Practice: Core APIs

> Five exercises covering what the slides in this module introduced —
> the string pool and `==` vs `equals()`, `StringBuilder` chaining and
> mutation, array defaults and jagged arrays, `Math` rounding/overflow
> edge cases, and `LocalDate`/`Period` arithmetic with immutability. Try
> to answer before opening each explanation.

---

## Exercise 1 — String pool and reference equality

```java
String a = "Java";
String b = "Java";
String c = new String("Java");
String d = c.intern();

System.out.println(a == b);
System.out.println(a == c);
System.out.println(a == d);
System.out.println(c == d);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
true
false
true
false
```

`a` and `b` are both string literals with the same content, so both are
resolved to the **same reference** in the string pool at class-load time
— `a == b` is `true`.

`c` is created with `new String("Java")`, which **always allocates a new
object on the heap**, deliberately bypassing the pool even though the
content is identical — `a == c` is `false`. Only `equals()` would report
these as equal by content.

`c.intern()` looks up (or adds) `"Java"` in the string pool and returns
**that pooled reference** — which is the exact same reference `a` and `b`
already point to. So `a == d` is `true`.

`c == d`, however, is `false`: `c` still refers to the original heap
object created by `new String(...)`; `intern()` did not modify `c` in
place (`String` is immutable, and `intern()` returns a new reference
rather than mutating the receiver) — it only returned a *different*
reference that happens to equal `a`. `c` itself never changes.

</details>

---

## Exercise 2 — StringBuilder chaining and in-place mutation

```java
StringBuilder sb = new StringBuilder("Hello");
sb.append(" World").reverse().insert(0, ">>> ");

System.out.println(sb);
System.out.println(sb.length());
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
>>> dlroW olleH
15
```

Every mutating `StringBuilder` method (`append`, `reverse`, `insert`,
`delete`, `replace`, ...) returns `this` — the **same** object, modified
in place — so the chain `sb.append(...).reverse().insert(...)` performs
three mutations on the one `StringBuilder` referenced by `sb`, and you
never need to reassign `sb` for the changes to stick. This is the
opposite of `String`, where every "modifying" call actually returns a
brand-new object and the original is untouched unless you capture the
return value.

Tracing step by step:
1. `sb` starts as `"Hello"`.
2. `.append(" World")` → buffer becomes `"Hello World"` (11 characters).
3. `.reverse()` reverses the entire buffer in place → `"dlroW olleH"`.
4. `.insert(0, ">>> ")` inserts 4 characters *before* index 0 (the
   current first character), shifting everything else right →
   `">>> dlroW olleH"`.

Since `sb` was mutated directly (not reassigned), printing `sb` shows the
final state: `">>> dlroW olleH"`. Its length is `4 + 11 = 15` characters.

</details>

---

## Exercise 3 — Array defaults and jagged arrays

```java
int[][] grid = new int[3][];
grid[0] = new int[2];
grid[1] = new int[]{5, 5};

System.out.println(grid[0][0]);
System.out.println(grid.length);
System.out.println(grid[2]);
System.out.println(grid[2][0]);
```

What happens on each line?

<details>
<summary>Answer</summary>

```
0
3
null
Exception in thread "main" java.lang.NullPointerException
```

`new int[3][]` creates only the **outer** array — 3 slots that each hold
a reference to an `int[]`, all initialized to their default value,
`null`, since no rows have been assigned yet. This is a jagged array:
each row must be assigned separately.

`grid[0] = new int[2]` assigns a genuine 2-element `int` array to row 0.
Numeric array elements default to `0`, so `grid[0][0]` prints `0`.

`grid.length` is the length of the **outer** array — it's fixed at `3`
the moment `new int[3][]` runs and has nothing to do with whether the
individual rows have been populated. So it prints `3` even though row 2
was never assigned.

`grid[2]` was never assigned a row, so it still holds its default value,
`null`; printing it prints the string `"null"`.

`grid[2][0]` then tries to index **into** that `null` reference —
`grid[2]` evaluates to `null`, and `null[0]` throws a
`NullPointerException` at runtime. This is a classic multidimensional-array
trap: declaring `new int[3][]` only allocates the outer dimension, and
accessing an unassigned row's elements fails, not at compile time, but
with an `NPE` at runtime.

</details>

---

## Exercise 4 — Math rounding and overflow

```java
System.out.println(Math.round(-2.5));
System.out.println(Math.round(2.5));
System.out.println(Math.ceil(-3.5));
System.out.println(Math.floor(-3.5));
System.out.println(Math.abs(Integer.MIN_VALUE));
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
-2
3
-3.0
-4.0
-2147483648
```

`Math.round(double)` is defined as `floor(x + 0.5)` — it always rounds
**toward positive infinity** on a tie, not "away from zero." For
`-2.5`: `-2.5 + 0.5 = -2.0`, and `floor(-2.0)` is `-2.0`, so the result is
`-2` — not `-3`, which is the common mistake. For `2.5`: `2.5 + 0.5 =
3.0`, so the result is `3`.

`Math.ceil` rounds toward **positive infinity** and always returns a
`double`. `-3.5` rounded toward positive infinity is `-3.0` (closer to
positive infinity than `-4.0` is).

`Math.floor` rounds toward **negative infinity**, also returning a
`double`. `-3.5` rounded toward negative infinity is `-4.0`.

`Math.abs(Integer.MIN_VALUE)` is the classic overflow trap: `int` is a
two's-complement type whose range is `-2147483648` to `2147483647` — the
negative range holds one more value than the positive range. The
mathematically correct absolute value, `2147483648`, does not fit in an
`int`, so it silently **overflows and wraps back around** to
`-2147483648`. `Math.abs()` never throws for this case — it just returns
a value that is still negative, which is easy to miss if you assume
`abs()` always returns a non-negative result.

</details>

---

## Exercise 5 — LocalDate arithmetic, chaining, and immutability

```java
LocalDate start = LocalDate.of(2024, 3, 10);
LocalDate end = start.plusMonths(2).plusDays(5);
start.plusYears(1);

Period between = Period.between(start, end);

System.out.println(start);
System.out.println(end);
System.out.println(between);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
2024-03-10
2024-05-15
P2M5D
```

`LocalDate` is immutable, exactly like `String` — every "modifying"
method returns a **new** `LocalDate` instead of changing the receiver.
`start.plusYears(1)` computes a new date one year later, but since its
return value is never assigned to anything, that computed date is simply
discarded and `start` itself is completely unaffected — it still prints
`2024-03-10`.

`start.plusMonths(2).plusDays(5)` works because each call returns a new
object that the next call in the chain operates on: `plusMonths(2)`
produces `2024-05-10` (a new, separate `LocalDate`), and `.plusDays(5)`
is then called on *that* new object, producing `2024-05-15`, which is
what gets assigned to `end`. Unlike the `StringBuilder` chain in Exercise
2, this chain never mutates `start` — it can't, because `LocalDate` has
no mutating methods at all.

`Period.between(start, end)` computes the calendar-based difference from
`2024-03-10` to `2024-05-15`: 2 whole months takes `2024-03-10` to
`2024-05-10`, leaving 5 remaining days to reach `2024-05-15`, so the
period is 0 years, 2 months, 5 days. `Period`'s `toString()` omits any
zero components — the year component is dropped and only the non-zero
parts are shown — producing `P2M5D` rather than `P0Y2M5D`.

</details>
