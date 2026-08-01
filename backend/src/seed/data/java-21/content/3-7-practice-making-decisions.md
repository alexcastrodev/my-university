# Practice: Making Decisions

> Five exercises covering what the slides in this module introduced —
> flow scoping of `instanceof` pattern variables through negation and `||`,
> exhaustiveness of guarded patterns (`when`) in `switch`, `null` handling
> in pattern-matching `switch`, fall-through in a traditional `switch`
> statement, and labeled `continue` in nested loops. Try to answer before
> opening each explanation.

---

## Exercise 1 — Pattern variable scope through negation and `||`

```java
static String classify(Object obj) {
    if (!(obj instanceof String s) || s.isEmpty()) {
        return "not a string, or empty";
    }
    return "string: " + s.toUpperCase();
}
```

Does this compile? If so, what does `classify("hi")`, `classify("")`, and
`classify(42)` each return?

<details>
<summary>Answer</summary>

**It compiles**, and:

- `classify("hi")` → `"string: HI"`
- `classify("")` → `"not a string, or empty"`
- `classify(42)` → `"not a string, or empty"`

The module's slides show that `s instanceof Rectangle r || r.length() > 0`
does **not** compile, because the right side of `||` can run even when
`r` was never assigned (the left side was `false`). Here the situation is
flipped by the `!`: the pattern variable `s` from
`!(obj instanceof String s)` is definitely assigned exactly when that
negated test is `false` — i.e., when `obj` actually **is** a `String`.
Since the right operand of `||` only executes when the left operand is
`false`, by the time `s.isEmpty()` runs, `obj instanceof String s` is
known to have succeeded and `s` is guaranteed assigned. The compiler's
flow analysis tracks this "definitely assigned when false" state through
the `!`, so the code is legal.

Tracing the three calls: for `"hi"`, `obj instanceof String s` is `true`,
so `!(...)` is `false`; the `||` then evaluates `s.isEmpty()`, which is
`false` for `"hi"` — the whole condition is `false`, so execution falls
through to the second `return`, printing `"string: HI"`. For `""`, the
same path is taken but `s.isEmpty()` is `true`, so the condition is
`true` and the first `return` fires. For `42`, `obj instanceof String s`
is `false` immediately, so `!(...)` is `true` and `||` short-circuits
without ever touching `s` — the first `return` fires without evaluating
`s.isEmpty()` at all.

Because the `if` always returns when its condition is `true`, `s` is also
definitely assigned after the `if` block (on the path that falls through
to `return "string: " + s.toUpperCase();`), which is why the second line
compiles too.

</details>

---

## Exercise 2 — Guarded patterns and exhaustiveness

```java
sealed interface Vehicle permits Car, Truck {}
record Car(int seats) implements Vehicle {}
record Truck(double payloadTons) implements Vehicle {}

static String classify(Vehicle v) {
    return switch (v) {
        case Car c when c.seats() > 4 -> "large car";
        case Truck t -> "truck";
    };
}
```

Does this compile?

<details>
<summary>Answer</summary>

**No — it fails to compile** because the `switch` expression is not
exhaustive.

`Vehicle` is a sealed interface with exactly two permitted implementers,
`Car` and `Truck`, so in principle every possible value is either a `Car`
or a `Truck`. But `case Car c when c.seats() > 4` is a **guarded**
pattern — the compiler makes no attempt to reason about whether the
`when` condition is always true. A guarded pattern is never treated as
covering its type for exhaustiveness purposes, no matter how the guard
is written. So as far as the exhaustiveness checker is concerned, `Car`
is only *partially* handled: a `Car` with `seats() <= 4` (e.g.
`new Car(2)`) matches neither the guarded `Car` label nor any other
label, and there's no `default` to catch it.

The fix is to add an unguarded fallback for `Car` (and order it after
the guarded one, since guarded labels don't dominate anything):

```java
case Car c when c.seats() > 4 -> "large car";
case Car c                    -> "car";
case Truck t                  -> "truck";
```

With that unguarded `case Car c` present, every `Car` is covered by one
of the two `Car` labels and every `Truck` by the `Truck` label, so the
switch becomes exhaustive and compiles without needing a `default`.

</details>

---

## Exercise 3 — `null` and pattern-matching `switch`

```java
static String describe(Object obj) {
    return switch (obj) {
        case Integer i -> "int:" + i;
        case String s  -> "str:" + s;
        case Object o  -> "other:" + o;
    };
}

public static void main(String[] args) {
    System.out.println(describe(42));
    System.out.println(describe(null));
}
```

Does this compile, and what happens when each line runs?

<details>
<summary>Answer</summary>

**It compiles.** `case Object o` is a total pattern for the selector's
declared type `Object` — it matches every non-null reference — so the
switch is exhaustive without needing an explicit `default`.

- `describe(42)` prints `int:42` — `42` is autoboxed to `Integer`, which
  matches the first label.
- `describe(null)` **throws `NullPointerException` at runtime.**

Even though `case Object o` looks like it should catch "anything else,"
pattern-matching `switch` never matches `null` against a type pattern —
not even against `Object`. The slides call this out explicitly: you must
add an explicit `case null` label to handle a `null` selector. Since none
of the three labels here is `case null`, and there's no `default`
either, a `null` selector falls through with nothing to match — exactly
like a classic (pre-Java-21) `switch` on a `null` reference — and the
JVM throws `NullPointerException`. Adding `case null -> "null";` (or
`case null, default -> ...`) would let the second call return normally
instead.

</details>

---

## Exercise 4 — Fall-through in a traditional `switch` statement

```java
static void printDay(int day) {
    switch (day) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
            System.out.println("Weekday");
            break;
        case 6:
        case 7:
            System.out.println("Weekend");
            break;
        default:
            System.out.println("Invalid");
    }
}

public static void main(String[] args) {
    printDay(3);
    printDay(6);

    int x = 2;
    switch (x) {
        case 1:
            System.out.println("one");
        case 2:
            System.out.println("two");
        case 3:
            System.out.println("three");
            break;
        case 4:
            System.out.println("four");
    }
}
```

What's printed, in order?

<details>
<summary>Answer</summary>

```
Weekday
Weekend
two
three
```

`printDay(3)`: case labels `1` through `5` are "stacked" with no
statements between them, so matching any of `1`–`5` falls straight
through to the shared body — `"Weekday"` — where the `break` stops
execution before `case 6`.

`printDay(6)`: same idea for the `6`/`7` group — prints `"Weekend"`,
then `break`.

The last `switch(x)` with `x = 2` demonstrates real fall-through: control
jumps directly to the matching label `case 2:` — the `case 1:` body
(`"one"`) is **never reached**, because a traditional `switch` jumps to
the matched label, it does not start from the top. From `case 2:`,
execution prints `"two"`, and because there is **no `break`** after it,
control falls through into `case 3:`'s body and prints `"three"` as
well. The `break` after `"three"` then stops execution before `case 4:`
is reached, so `"four"` never prints.

</details>

---

## Exercise 5 — Labeled `continue` in a nested loop

```java
public static void main(String[] args) {
    outer:
    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) {
            if (j == i) {
                continue outer;
            }
            System.out.println(i + "-" + j);
        }
    }
}
```

What's printed?

<details>
<summary>Answer</summary>

```
1-0
2-0
2-1
```

`continue outer` skips the rest of the **inner** loop's current iteration
and advances the **outer** (labeled) loop directly to its next
iteration — it does not just move to the next `j`, it abandons the inner
loop entirely for that pass and goes straight to the outer loop's update
expression (`i++`) followed by its condition check.

- `i = 0`: `j = 0` → `j == i` (`0 == 0`) is `true` immediately, so
  `continue outer` fires before anything prints. No output for `i = 0`.
- `i = 1`: `j = 0` → `0 == 1` is `false`, prints `1-0`. `j = 1` →
  `1 == 1` is `true`, `continue outer` fires — the inner loop never
  reaches `j = 2`.
- `i = 2`: `j = 0` → `0 == 2` is `false`, prints `2-0`. `j = 1` →
  `1 == 2` is `false`, prints `2-1`. `j = 2` → `2 == 2` is `true`,
  `continue outer` fires, `i` becomes `3`, and the outer loop's
  condition `i < 3` is now `false`, so the whole loop ends.

Without the label, an unlabeled `continue` inside the inner loop would
only skip to the inner loop's next `j` — it would never affect `i` — so
the output would be very different (every `i-j` pair except where
`j == i` would print). The label is what lets `continue` reach past the
inner loop to control the outer one.

</details>
