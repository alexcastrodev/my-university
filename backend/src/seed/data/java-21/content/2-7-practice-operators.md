# Practice: Operators

> Five exercises covering what the slides in this module introduced —
> pre/post-increment evaluation order, the hidden narrowing cast inside
> compound assignment operators, operator precedence across mixed
> arithmetic/comparison/logical expressions, short-circuit vs.
> non-short-circuit logical operators with side effects, and the ternary
> operator's type-promotion rules. Try to answer before opening each
> explanation.

---

## Exercise 1 — Pre/Post-Increment Evaluation Order

```java
int x = 5;
int y = x++ + ++x;
System.out.println(x + " " + y);
```

What's printed?

<details>
<summary>Answer</summary>

```
7 12
```

Java evaluates the operands of `+` **left to right**, and each operand is
fully evaluated (including its side effect) before the next one starts.

- Left operand `x++`: this is **postfix**, so it *yields the current value
  of `x`* — `5` — and only *after* that value is captured does `x` get
  incremented to `6`.
- Right operand `++x`: this is **prefix**, so `x` is incremented *first*
  (from `6` to `7`), and the expression yields the *already-incremented*
  value — `7`.

So the sum is `5 + 7 = 12`, and by the time both increments have applied,
`x` holds `7`. The key distinction: postfix returns the value *before* the
change, prefix returns the value *after* the change — and both changes
happen in strict left-to-right order as Java walks the expression, not
"all at the end."

</details>

---

## Exercise 2 — Compound Assignment and the Hidden Narrowing Cast

```java
byte b = 10;
b += 5;
System.out.println(b);

byte c = 100;
c += 50;
System.out.println(c);
```

Does this compile, and if so, what's printed on each line?

<details>
<summary>Answer</summary>

Both lines compile and print:

```
15
-106
```

A compound assignment operator like `+=` is **not** simple sugar for
`b = b + 5`. Under the hood it performs `b = (byte)(b + 5)` — the compiler
inserts an **implicit narrowing cast** back to the variable's declared
type. That's precisely why `b += 5` compiles while the expanded form
`b = b + 5` would **not**: `b + 5` promotes both operands to `int` (per
Java's binary numeric promotion rules), and you cannot assign an `int` to
a `byte` without an explicit cast — except the compound operator supplies
that cast for you automatically.

For `b`: `10 + 5 = 15`, which fits comfortably in a `byte` (range
`-128..127`), so `b` becomes `15` with no data loss.

For `c`: `100 + 50 = 150` as an `int`, but `150` overflows the `byte`
range. The implicit `(byte)` cast doesn't throw or refuse — it silently
truncates to the low 8 bits and reinterprets the result as signed,
wrapping around: `150 - 256 = -106`. So `c` becomes `-106`, with no
compile error and no runtime exception — the overflow is completely
silent, which is exactly the kind of trap the exam likes to test.

</details>

---

## Exercise 3 — Operator Precedence Across Arithmetic, Comparison, and Logical Operators

```java
int a = 4, b = 2, c = 3;
boolean result = a + b * c > 10 || b == c && a < b;
System.out.println(result);
```

What's printed?

<details>
<summary>Answer</summary>

```
false
```

With no parentheses, precedence forces a specific grouping. From highest
to lowest among the operators used here: `*` binds tighter than binary
`+`, which binds tighter than the relational operators (`<`, `>`), which
bind tighter than the equality operator (`==`), which binds tighter than
`&&`, which binds tighter than `||`. Fully parenthesizing the expression
according to those rules gives:

```java
((a + (b * c)) > 10) || ((b == c) && (a < b))
```

Evaluating left side first: `b * c = 2 * 3 = 6`, then `a + 6 = 4 + 6 = 10`,
then `10 > 10` is `false`.

Evaluating right side: `b == c` → `2 == 3` → `false`. Because `&&` is
short-circuiting and its left operand is already `false`, `a < b`
(`4 < 2`, also `false`) still gets evaluated here since there's no
side-effecting call to skip — the point is the *grouping*, not that
short-circuiting changes this particular result: `false && false = false`.

Finally, `false || false = false`. If you mistakenly evaluated `||`
before `&&`, or comparisons before arithmetic, you'd group the expression
differently and could easily land on `true` — which is exactly why the
exam tests this.

</details>

---

## Exercise 4 — Short-Circuit (`&&`) vs. Non-Short-Circuit (`&`) with Side Effects

```java
int x = 5;
boolean result1 = (x > 10) && (x++ > 0);
System.out.println(x + " " + result1);

int y = 5;
boolean result2 = (y > 10) & (y++ > 0);
System.out.println(y + " " + result2);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
5 false
6 false
```

Both `result1` and `result2` end up `false` — but `x` and `y` end up with
*different* values, which is the whole point of this exercise.

`&&` is **short-circuiting**: if the left operand is already `false`,
Java never evaluates the right operand at all, because the overall result
is already determined. Here `x > 10` is `false` (`5 > 10`), so
`x++ > 0` is **never executed** — its side effect (incrementing `x`) never
happens, and `x` stays `5`.

`&` (the non-short-circuit, bitwise-when-applied-to-booleans-but-still-
logical-AND-on-`boolean` operator) always evaluates **both** operands,
regardless of whether the left one already determines the outcome. Here
`y > 10` is `false`, but `y++ > 0` still runs: it yields the pre-increment
value of `y` (`5`, so `5 > 0` is `true`) and, as a side effect, `y`
becomes `6`. The overall result is `false & true = false` — same boolean
outcome as `result1`, but `y` was mutated while `x` was not.

This is exactly why relying on `&`/`|` for boolean logic with
side-effecting operands is dangerous: it silently executes code that
`&&`/`|| ` would have skipped.

</details>

---

## Exercise 5 — Ternary Operator Type Promotion with Mixed Numeric Types

```java
int score = 7;
double bonus = 2.5;
var result = (score > 5) ? score : bonus;
System.out.println(result);

int number = 66;
char letter = 'A';
var mixed = (score > 100) ? letter : number;
System.out.println(mixed);
```

What's printed on each line?

<details>
<summary>Answer</summary>

```
7.0
66
```

**First expression:** the two branches are `score` (`int`) and `bonus`
(`double`) — different numeric types. Per the ternary operator's type
rules, when the branches don't already share a type, the compiler applies
binary numeric promotion to find a common type: since one operand is
`double`, the *other* operand is promoted to `double`, and that becomes
the type of the whole conditional expression — regardless of which branch
is actually selected at runtime. Even though the condition is `true` and
`score` is the chosen branch, `score` is widened to `7.0`. `var` infers
the ternary's type as `double`, so `println` prints `7.0`, not `7`.

**Second expression:** the branches are `letter` (`char`) and `number`
(`int`). There *is* a special JLS carve-out where a `char`/`byte`/`short`
branch keeps its narrower type if the other branch is a **constant
expression** of type `int` whose value fits — but that exception only
applies to actual constant expressions (literals or `final` variables
initialized with constants). Here `number` is a plain, non-`final` local
variable, so it does **not** qualify as a constant expression, and the
carve-out doesn't apply. Instead, ordinary binary numeric promotion
kicks in: `char` and `int` promote to `int`, making the whole ternary's
type `int`. Since `score > 100` is `false`, the `number` branch (`66`) is
selected — and because the expression's type is `int`, it prints as the
number `66`, not as a character. (Had the `letter` branch been selected
instead, it would *also* print as its numeric code, `65` — not `'A'` —
because the whole expression's static type is `int`, not `char`.)

</details>
