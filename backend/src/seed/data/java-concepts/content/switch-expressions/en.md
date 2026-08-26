---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand that the classic `switch` **statement** and the `switch` **expression** (JEP 361, finalized in Java 14) are two different constructs that happen to share the `switch` keyword. The statement is colon-form (`case X:`), falls through from one label into the next unless a `break` stops it, and produces no value. The expression produces a value directly usable in an assignment, a `return`, or an argument position — which forces two properties the statement never had: every path must definitely produce a value, so the compiler rejects a switch expression it cannot prove **exhaustive**, and arrow labels (`case X ->`) run exactly one arm with no fall-through.

This is the mechanical foundation that `pattern-matching` builds on. That concept uses `->` arms and exhaustiveness throughout, but always in service of type and record patterns over sealed hierarchies. Here there are no patterns at all — just the plumbing: arrow arms, `yield`, multi-value labels, and where exhaustiveness is checked, on ordinary `enum`, `String`, and `int` values.

## Use Cases

- Assigning a variable or returning a value from a small fixed set of cases (an `enum`, a handful of `int`/`String` constants) without declaring a mutable local and reassigning it in every branch of a statement switch.
- Removing accidental fall-through bugs from code that used colon form and relied on a human remembering `break` in every branch.
- Mapping several values to one result on a single line — `case SATURDAY, SUNDAY -> "Weekend"` — instead of stacking bare `case` labels that intentionally fall into a shared body.
- Producing a value from an arm that needs more than one statement, via `yield`.

## Deep Dive

### Colon form vs. arrow form

Colon form is the original `switch` statement. Control enters at the matching label and keeps running until a `break` (or the end of the block) stops it — including straight through the *next* label:

```java
static String size(int code) {
    String label = "";
    switch (code) {
        case 1:
            label = "small";   // no break: execution continues into case 2
        case 2:
            label = "medium";
            break;
        default:
            label = "large";
    }
    return label;
}

size(1); // "medium", not "small"
```

That is the classic fall-through bug: nothing in the language flags it, and the result is quietly wrong. Arrow form makes the mistake structurally impossible — only the matched arm runs, and there is no syntax for falling into the next one:

```java
static String size(int code) {
    return switch (code) {
        case 1  -> "small";
        case 2  -> "medium";
        default -> "large";
    };
}

size(1); // "small"
```

Two things are worth separating. Arrow form is a *syntax* choice: `switch (x) { case 1 -> doThing(); }` is still a statement, it just cannot fall through. Being an *expression* is a different property — it means the whole `switch` evaluates to a value, which is what the `return switch (...)` above relies on. Colon form can only ever be a statement; arrow form can be either.

Fall-through is not purely a hazard, though: it is the one thing colon form can express and arrow form cannot. Deliberately letting one case's code run into the next — accumulating work across labels — has no arrow-form equivalent, and that is the migration risk covered under Trade-offs.

### yield: producing a value from a block-bodied arm

`case X -> expr` has an obvious value: `expr`. A block has no such implicit value, so an arm written as `case X -> { ... }` inside a switch *expression* must hand one back explicitly with `yield`:

```java
static int score(String grade) {
    return switch (grade) {
        case "A" -> 4;                       // single expression: its value is the arm's value
        case "B" -> {                        // block: needs an explicit yield
            System.out.println("logging a B");
            int base = 3;
            yield base;
        }
        default -> 0;
    };
}
```

The `"A"` and `"B"` arms produce values the same way from the caller's perspective; only the `"B"` arm needs `yield`, because it is a block. `yield` is required in a block arm of a switch expression and is meaningless in a switch statement (nothing is being produced there).

`yield` is a *contextual* keyword, not a reserved word, so old code that used it as a name still compiles:

```java
static int yield = 5;
static int yield() { return 7; }

System.out.println(yield);        // fine: field named yield
System.out.println(Foo.yield());  // fine, but the call must be qualified
```

Only one narrow spot broke: an *unqualified* call `yield()` is rejected, because it is ambiguous with the statement form. Qualifying it (`this.yield()`, `Foo.yield()`) resolves it.

### Multi-value case labels

One arrow arm can list several comma-separated constants that all map to the same result:

```java
static String kind(Day d) {
    return switch (d) {
        case MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY -> "Weekday";
        case SATURDAY, SUNDAY                             -> "Weekend";
    };
}
```

In colon form the same grouping required stacking bare labels and leaning on fall-through to reach one shared body:

```java
switch (d) {
    case SATURDAY:
    case SUNDAY:
        return "Weekend";
    default:
        return "Weekday";
}
```

Multi-value labels say directly what the stacked-label idiom said indirectly, and they work in colon form too — the comma list is a label feature, not an arrow feature.

### Exhaustiveness is a switch-*expression* requirement

A switch expression must produce a value for every possible input, so the compiler checks coverage. Over an `enum` with a case for every constant, that check passes with no `default` at all:

```java
enum Day { MONDAY, SATURDAY, SUNDAY }

static String kind(Day d) {
    return switch (d) {         // compiles: all three constants covered, no default needed
        case MONDAY   -> "Weekday";
        case SATURDAY -> "Weekend";
        case SUNDAY   -> "Weekend";
    };
}
```

The identical `switch` used as a *statement* has no such requirement, because a statement produces nothing — an uncovered value is simply a no-op:

```java
static void report(Day d) {
    switch (d) {                // compiles fine, even though SATURDAY and SUNDAY are unhandled
        case MONDAY -> System.out.println("Weekday");
    }
}

report(Day.SUNDAY);             // prints nothing at all, no error
```

That silent no-op is exactly what turning the switch into an expression buys you protection from.

Over a type whose values the compiler cannot enumerate — a plain `int`, `String`, `long`, or any non-sealed reference type — exhaustiveness is unprovable, so a `default` arm is mandatory:

```java
static String name(int i) {
    return switch (i) {         // error: the switch expression does not cover all possible input values
        case 1 -> "one";
        case 2 -> "two";
    };
}
```

Adding `default -> "many";` fixes it. Only `enum` selectors (and, per the next paragraph, sealed ones) can skip `default`.

### The parallel with sealed types

The same exhaustiveness machinery has a second source of proof: when the selector is a `sealed` type and the case labels are type or record patterns covering every permitted subtype, the compiler can prove coverage without a `default`, just as it does for a complete enum. That is `pattern-matching`'s subject — the mechanics on this page (arrow arms, `yield`, the expression/statement split) are what it is layered on top of.

## Trade-offs

- **One label style per switch block** — colon-form and arrow-form labels cannot be mixed in the same `switch`. There is no gradual, case-by-case migration; converting a switch means converting all of it at once:

```java
switch (i) {
    case 1: System.out.println("one"); break;
    case 2 -> System.out.println("two");   // error: different case kinds used in the switch
}
```

- **Losing fall-through is a real behavior change, not just a syntax change** — a mechanical port that swaps `:`/`break` for `->` case by case silently breaks any logic that *intended* to fall through, because the shared code that used to run for both labels now runs for only one. That logic has to be rewritten as a multi-value label (`case 1, 2 -> ...`) or duplicated into both arms; the compiler will not point at what you dropped, since the result is still valid code.

- **`yield` binds to the innermost enclosing switch expression** — in nested switches the inner `yield` produces the inner switch's value, and there is no way to yield past it to the outer one; the outer arm needs its own `yield`. The one place this is unambiguous is a lambda inside an arm: a lambda body is not part of the switch, so `yield` there is a compile error (`yield outside of switch expression`) rather than a silent surprise. Still, deeply nested switch expressions read poorly — extracting the inner one into a method is usually clearer than relying on the reader tracking which switch a `yield` belongs to.

- **An exhaustive enum switch can go stale between compilations** — the "no `default` needed" guarantee is checked at compile time against the enum as it existed *then*. Add a constant, recompile only the enum, and the already-compiled switch is no longer exhaustive. It does not silently return a wrong value: the class file keeps a synthetic no-match branch that throws (on JDK 21+ a `java.lang.MatchException`; older releases threw `IncompatibleClassChangeError` here, so the exact type is not something to code against). This is the enum analogue of the sealed-hierarchy recompilation hazard, and the fix is the same — recompile everything that switches over the enum, which turns the runtime failure back into a compile error demanding the new case:

```java
enum Day { MONDAY, SATURDAY }            // kind() compiled against this
enum Day { MONDAY, SATURDAY, SUNDAY }    // enum recompiled alone
kind(Day.SUNDAY);                        // MatchException at runtime
```

## Documentation Links

- [JEP 361: Switch Expressions](https://openjdk.org/jeps/361) — doc
- [The switch Statement — Java SE Tutorials](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/switch.html) — doc
