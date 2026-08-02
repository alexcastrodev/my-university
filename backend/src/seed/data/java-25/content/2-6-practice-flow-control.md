# Practice: Flow Control

> Five exercises covering what the slides in this module introduced —
> dangling-`else` resolution in brace-less `if/else` chains, the
> guaranteed-at-least-once semantics of `do-while`, `yield` combined with
> fall-through in a colon-syntax `switch` expression, record deconstruction
> patterns with sealed-type exhaustiveness, and how a plain `break` versus a
> labeled `break` behaves when a `switch` is nested inside a loop. Try to
> answer before opening each explanation.

---

## Exercise 1 — Dangling `else` in a brace-less `if`

```java
public class Test {
    public static void main(String[] args) {
        int x = 10;

        if (x > 5)
            if (x > 20)
                System.out.println("A");
            else
                System.out.println("B");
        System.out.println("C");
    }
}
```

What's printed?

<details>
<summary>Answer</summary>

```
B
C
```

Neither `if` here has braces, so each `if`/`else` body is exactly the one
statement that follows it. The slides' rule is: **an `else` matches the
nearest preceding unmatched `if`.** Working from the innermost `if`
outward, `else` binds to `if (x > 20)`, not to `if (x > 5)` — even though
indentation in the source makes it *look* like it might belong to the
outer one.

Tracing execution with `x = 10`: `x > 5` is `true`, so the outer `if`'s
single-statement body executes, which is the entire inner
`if (x > 20) ... else ...`. `x > 20` is `false` for `x = 10`, so control
goes to the `else` branch and prints `"B"`. There is no `else` attached
to the outer `if (x > 5)` — the inner `if/else` *is* its whole body — so
after that nested statement finishes, execution simply continues to the
next statement in `main`, `System.out.println("C")`, which always runs
regardless of `x`. Hence `B` then `C`.

If the intent was for `else` to pair with `x > 5` instead, braces would
be required: `if (x > 5) { if (x > 20) ... } else ...`.

</details>

---

## Exercise 2 — `do-while` executes the body before testing

```java
public class Test {
    public static void main(String[] args) {
        int limit = 0;
        int attempts = 0;

        do {
            attempts++;
        } while (attempts < limit);

        System.out.println(attempts);
    }
}
```

What's printed, given that `limit` is `0` — meaning the loop's condition
is already `false` before the loop ever runs?

<details>
<summary>Answer</summary>

```
1
```

Unlike `for` and `while`, which check their condition **before** the
first execution of the body, `do-while` checks its condition **after**
running the body — so the body is guaranteed to execute at least once,
no matter what the condition evaluates to on that first check.

Here `attempts` starts at `0`. The loop body runs unconditionally the
first time, incrementing `attempts` to `1`. *Only then* is
`attempts < limit` (i.e., `1 < 0`) evaluated, which is `false`, so the
loop exits immediately after that single iteration. If this had been
written as a `while (attempts < limit) { attempts++; }` loop instead,
the condition (`0 < 0`, `false`) would be checked first and the body
would never run at all, leaving `attempts` at `0`.

Separately, note the syntax: a `do-while` loop's closing
`while (condition)` **must** be followed by a semicolon —
`} while (attempts < limit);` — which is easy to forget since neither
`for` nor a brace-bodied `while` loop ends that way. Omitting it here
would be a compile-time error.

</details>

---

## Exercise 3 — `yield` and fall-through in a colon-syntax `switch` expression

```java
public class Test {
    public static void main(String[] args) {
        int code = 2;

        int result = switch (code) {
            case 1:
                yield 100;
            case 2:
            case 3:
                yield 200;
            default:
                yield -1;
        };

        System.out.println(result);
    }
}
```

What's printed?

<details>
<summary>Answer</summary>

```
200
```

This is a `switch` **expression** written with the traditional colon
syntax rather than arrows, so each branch must produce its value with
`yield` (a bare `case ...:` block cannot just fall off the end the way a
`switch` statement can — `yield` is what supplies the expression's
result).

Colon-style `case` labels still group the same way they do in a
`switch` *statement*: `case 2:` has no statements of its own before
`case 3:`, so matching `case 2` "falls through" the empty label straight
into the shared body under `case 3:`, which executes `yield 200`.
Crucially, `yield` — like `break` in a statement — immediately exits the
`switch` construct once it runs, so there's no risk of continuing on
into `default` after `yield 200` fires. It just means the *label
matching* still follows stacked-label fall-through rules even though the
*body* uses `yield` instead of `break`.

With `code = 2`, execution lands on the stacked `case 2:`/`case 3:`
group and yields `200`. The `case 1:` branch (`yield 100`) is never
reached because matching jumps directly to the matched label, not the
top of the switch, and `default` is never reached because the `case 3:`
group's `yield` already exited the expression.

</details>

---

## Exercise 4 — Record deconstruction patterns and sealed exhaustiveness

```java
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}

public class Test {
    static String classify(Shape s) {
        return switch (s) {
            case Circle(double r) when r > 10 -> "big circle";
            case Circle c                     -> "circle";
            case Square(double side)          -> "square";
        };
    }

    public static void main(String[] args) {
        System.out.println(classify(new Circle(15)));
    }
}
```

Does this compile without a `default` branch, and what's printed?

<details>
<summary>Answer</summary>

**It compiles, and prints `big circle`.**

`Shape` is a `sealed interface` that permits exactly two implementers,
`Circle` and `Square`, so the compiler can verify exhaustiveness by
checking that every permitted subtype is covered — no `default` clause
is required, exactly as the slides describe for sealed hierarchies.

Coverage here comes from three labels: `case Circle(double r) when r > 10`
is a **record deconstruction pattern** (it matches a `Circle` and binds
its `radius` component directly to `r`) combined with a guard, so on its
own it does *not* count toward exhaustiveness — guarded patterns never
do. But the very next label, `case Circle c`, is an unguarded pattern
that matches *every* `Circle`, so between the two of them all `Circle`
values are covered. `case Square(double side)` — another record
deconstruction pattern — covers every `Square`. With both permitted
subtypes fully accounted for, the switch is exhaustive.

Ordering also matters here for reachability, not just style: the guarded
`Circle(double r) when r > 10` label is placed *before* the unguarded
`Circle c` label. Guarded patterns don't dominate anything, so this
order is required — if `case Circle c` came first, it would match every
`Circle` unconditionally and the guarded label after it would be
unreachable, which the compiler rejects as dominated code.

Tracing `classify(new Circle(15))`: it matches `Circle(double r)`,
binding `r = 15.0`; the guard `r > 10` is `true`, so this label matches
and yields `"big circle"`. The `Circle c` and `Square(double side)`
labels are never reached for this call.

</details>

---

## Exercise 5 — `break` inside a `switch` nested in a loop

```java
public class Test {
    public static void main(String[] args) {
        search:
        for (int i = 0; i < 3; i++) {
            switch (i) {
                case 1:
                    break search;
                default:
                    System.out.println("i=" + i);
            }
        }
        System.out.println("done");
    }
}
```

What's printed? Would the output differ if `break search;` were replaced
with a plain `break;`?

<details>
<summary>Answer</summary>

With the labeled `break search;` as written:

```
i=0
done
```

A `break` (or `continue`) with no label only ever targets the
**innermost** enclosing construct that can accept it — for a plain
`break`, that would be the `switch` itself, since `switch` is a valid
`break` target on its own. A *labeled* `break`, however, targets
whichever labeled statement its label names, even if that means jumping
out past an enclosing `switch` and terminating the loop around it
entirely.

Tracing execution: `i = 0` hits `default`, prints `"i=0"`. `i = 1` hits
`case 1`, and `break search` fires — since `search:` labels the `for`
loop (not the switch), this terminates the **for loop itself**
immediately, not just the switch statement. `i` never reaches `2`.
Control resumes after the loop, printing `"done"`.

If `break search;` were replaced with a plain `break;`, the output would
be different: `break` with no label exits only the nearest enclosing
`switch`/loop capable of receiving it, which here is the `switch`
statement, not the `for` loop. The `for` loop would be completely
unaffected by that `break` and would continue on to `i = 2`. The output
would then be:

```
i=0
i=2
done
```

(`i = 1` still prints nothing either way, since `case 1` never reaches
its own `System.out.println` — it hits `break` before that.)

</details>
