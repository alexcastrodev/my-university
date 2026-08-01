# Practice: Beyond Classes

> Five exercises covering what the slides in this module introduced —
> interface default method conflict resolution, enums with per-constant
> abstract methods, exhaustive switches over sealed hierarchies, record
> constructor delegation rules, and inner vs. static nested class access.
> Try to answer before opening each explanation.

---

## Exercise 1 — Diamond of default methods

```java
interface Left {
    default String id() { return "L"; }
}

interface Right {
    default String id() { return "R"; }
}

class Combo implements Left, Right {
}
```

Does `class Combo` compile? If not, what's the minimal fix?

<details>
<summary>Answer</summary>

**No, it does not compile.** The compiler reports something like *"class
Combo inherits unrelated defaults for id() from types Left and Right"*.

Java resolves conflicting default methods with two automatic rules:

1. **A class method wins over any default method** — doesn't apply here,
   `Combo` declares no `id()` of its own.
2. **The more specific interface wins** — only applies when one interface
   *extends* the other. `Left` and `Right` are unrelated siblings, so
   neither is "more specific."

Since neither rule resolves the conflict, the compiler refuses to guess
and forces you to override `id()` explicitly:

```java
class Combo implements Left, Right {
    @Override
    public String id() {
        return Left.super.id() + Right.super.id(); // "LR"
    }
}
```

The `InterfaceName.super.method()` syntax is the only way to invoke a
*specific* interface's default implementation once you're forced to
override — a plain `super.id()` doesn't work here because `Combo` has no
superclass providing `id()`.

</details>

---

## Exercise 2 — Enum constants with their own method bodies, iterated via `EnumMap`

```java
enum Operation {
    ADD {
        @Override public int apply(int a, int b) { return a + b; }
    },
    MULTIPLY {
        @Override public int apply(int a, int b) { return a * b; }
    };

    public abstract int apply(int a, int b);
}

EnumMap<Operation, String> labels = new EnumMap<>(Operation.class);
labels.put(Operation.MULTIPLY, "times");
labels.put(Operation.ADD, "plus");

for (Operation op : labels.keySet()) {
    System.out.println(op + " -> " + op.apply(2, 3));
}
```

What's printed, and in what order?

<details>
<summary>Answer</summary>

```
ADD -> 5
MULTIPLY -> 6
```

Two separate rules combine here:

**Dispatch to the constant's own body.** Because `apply` is declared
`abstract` in the enum, each constant with a `{ ... }` body compiles to an
anonymous subclass of `Operation` that supplies its own override. Calling
`op.apply(2, 3)` dispatches virtually to whichever constant `op` actually
is — `ADD.apply(2, 3)` runs the `a + b` body (`5`), `MULTIPLY.apply(2, 3)`
runs the `a * b` body (`6`).

**Iteration order.** `labels` was populated `MULTIPLY` first, then `ADD`
— but `EnumMap` **ignores insertion order entirely**. It's backed by an
array indexed by the key enum's `ordinal()`, so it always iterates keys
in **declaration order**: `ADD` (ordinal 0) before `MULTIPLY` (ordinal
1), regardless of which one was `put` first.

</details>

---

## Exercise 3 — Exhaustive switch over a sealed hierarchy with a `non-sealed` branch

```java
sealed interface Shape permits Circle, Square, Other {}

record Circle(double radius) implements Shape {}
record Square(double side)   implements Shape {}
non-sealed class Other       implements Shape {}

class BigOther extends Other {}

static String describe(Shape s) {
    return switch (s) {
        case Circle c when c.radius() > 5 -> "big circle";
        case Circle c                      -> "small circle";
        case Square sq                     -> "square";
        case Other o                       -> "other";
    };
}

System.out.println(describe(new BigOther()));
```

Does `describe` compile without a `default` branch? And what does the last line print?

<details>
<summary>Answer</summary>

**Yes, it compiles**, and the last line prints `other`.

`Shape` permits exactly three direct subtypes: `Circle`, `Square`, and
`Other`. The switch covers all three, so the compiler considers it
exhaustive and doesn't require a `default`. The two `Circle` cases
together are exhaustive for `Circle` too — the guarded pattern (`when
c.radius() > 5`) handles the large ones, and the plain `case Circle c`
that follows catches every remaining `Circle` (guards don't count toward
exhaustiveness on their own, but an unconditional pattern of the same
type after it does).

`Other` is declared `non-sealed`, which **reopens** the hierarchy at that
point — any class, including `BigOther` here, may extend it, and the
compiler can no longer enumerate `Other`'s subtypes. That doesn't break
the switch, though: `case Other o` is a *type pattern*, matched by
**assignability**, not exact-class equality. A `BigOther` instance *is-a*
`Other`, so it matches `case Other o` — meaning `describe(new
BigOther())` falls into that branch and prints `"other"`. The hierarchy
being reopened at `Other` only matters if you later needed to
distinguish `Other`'s own subtypes with more specific cases.

</details>

---

## Exercise 4 — Record constructors must delegate to the canonical constructor

```java
public record Range(int min, int max) {
    public Range {
        if (min > max) {
            throw new IllegalArgumentException("min > max");
        }
    }

    public Range(int single) {
        this.min = single;
        this.max = single;
    }
}
```

Does this compile?

<details>
<summary>Answer</summary>

**No.** The one-argument constructor `Range(int single)` is not the
canonical constructor (it doesn't have one parameter per component in
order), so it is a **non-canonical constructor**. Java requires every
non-canonical constructor in a record to invoke the canonical
constructor as its **first statement**, via an explicit `this(...)` call.

Here it instead assigns `this.min` / `this.max` directly — that's only
legal *inside* the canonical constructor itself (compact or explicit
form). A non-canonical constructor is not allowed to touch the record's
components directly at all, delegation is mandatory.

The fix delegates instead:

```java
public Range(int single) {
    this(single, single); // routes through the compact canonical
                           // constructor above, so validation still runs
}
```

With that fix, `new Range(5)` would pass `min=5, max=5` through the
compact canonical constructor's `if (min > max)` check (which passes,
since they're equal) before the components are assigned.

</details>

---

## Exercise 5 — Inner class vs. static nested class: instantiation and access

```java
public class Outer {
    private int value = 100;

    class Inner {
        void show() {
            System.out.println(Outer.this.value);
        }
    }

    static class Nested {
        void show() {
            System.out.println(value); // (1)
        }
    }
}

Outer.Inner in1 = new Outer.Inner();          // (2)
Outer.Inner in2 = new Outer().new Inner();    // (3)
Outer.Nested n  = new Outer.Nested();         // (4)
```

Which line(s) fail to compile?

<details>
<summary>Answer</summary>

**Lines (1) and (2) fail to compile.** (3) and (4) are fine.

**(1)** `Nested` is declared `static`, so it has no implicit link to any
particular `Outer` instance. Inside `Nested.show()`, the bare name
`value` doesn't resolve to anything — `Outer`'s instance field is only
reachable through an actual `Outer` object (e.g. a field of type
`Outer` passed into `Nested`), never directly. A static nested class can
only reach the enclosing class's `static` members without qualification.

**(2)** `Inner` is a non-static inner class — every instance carries a
hidden reference to the `Outer` instance that created it, so you cannot
construct one with a bare `new Outer.Inner()`. It must be created
through an existing `Outer` instance, using the `outerRef.new Inner()`
syntax shown in (3), or with a bare `new Inner()` from *inside* an
instance method of `Outer` itself (where an enclosing instance is
already available).

**(3)** compiles: `new Outer()` creates the enclosing instance, and
`.new Inner()` attaches the new `Inner` to it, giving `show()` a valid
`Outer.this` to resolve `Outer.this.value` to `100`.

**(4)** compiles: `Nested` needs no enclosing instance at all, so
`new Outer.Nested()` is legal on its own.

</details>
