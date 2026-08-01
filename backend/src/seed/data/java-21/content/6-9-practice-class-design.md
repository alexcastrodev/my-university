# Practice: Class Design

> Five exercises covering what the slides in this module introduced —
> static hiding vs. overriding, sealed class constraints, records, enums
> with per-constant bodies, and instantiating abstract classes. Try to
> answer before opening each explanation.

---

## Exercise 1 — Static hiding vs. instance overriding

```java
public class Vehicle {
    public static String category() { return "Vehicle"; }
    public Number topSpeed() { return 100; }
}

public class SportsCar extends Vehicle {
    public static String category() { return "SportsCar"; }
    @Override
    public Integer topSpeed() { return 300; }
}

Vehicle v = new SportsCar();
System.out.println(v.category());
System.out.println(v.topSpeed());
```

`v` is declared as `Vehicle` but actually holds a `SportsCar`. What gets
printed?

<details>
<summary>Answer</summary>

```
Vehicle
300
```

`category()` is `static`, so it's **hidden**, not overridden. Static
method calls are resolved by the variable's **declared (reference) type**
at compile time — `v` is declared `Vehicle`, so `v.category()` always
calls `Vehicle.category()`, regardless of what object `v` actually points
to at runtime.

`topSpeed()` is an instance method, properly overridden (with a covariant
return type — `Integer` is-a `Number`). Instance method calls are resolved
by the **actual runtime type** of the object — dynamic dispatch — so
`v.topSpeed()` calls `SportsCar`'s version and prints `300`.

Same-looking call syntax, completely different resolution rules —
this is exactly why "static methods are hidden, not overridden" matters
in practice, not just as a definition to memorize.

</details>

---

## Exercise 2 — A `permits`-listed class with no modifier

```java
public sealed class Shape permits Circle, Square {}

public final class Circle extends Shape {}

public class Square extends Shape {}
```

Does this compile?

<details>
<summary>Answer</summary>

**No.** Every class named in a `permits` clause must declare itself as
exactly one of `final`, `sealed`, or `non-sealed`. `Circle` does this
correctly (`final`), but `Square` is declared as a plain `class` with none
of the three — that's a compile-time error, not a warning.

Two ways to fix it, depending on intent:

```java
public final class Square extends Shape {}        // closes this branch

public non-sealed class Square extends Shape {}    // reopens it — anyone can extend Square
```

</details>

---

## Exercise 3 — Record identity, equality, and a failing compact constructor

```java
public record Range(int min, int max) {
    Range {
        if (min > max) throw new IllegalArgumentException("min > max");
    }
}

Range a = new Range(1, 5);
Range b = new Range(1, 5);

System.out.println(a.equals(b));
System.out.println(a == b);
System.out.println(a);

Range bad = new Range(5, 1);
```

Predict the three `println` outputs, then explain what happens on the
last line.

<details>
<summary>Answer</summary>

```
true
false
Range[min=1, max=5]
```

...then the last line throws `IllegalArgumentException: min > max`.

`a.equals(b)` is `true` — the compiler-generated `equals()` compares every
component, and both records hold `(1, 5)`. `a == b` is `false` regardless
— they're still two separate objects on the heap; value-equality via
`equals()` never implies reference-equality via `==`. `a`'s auto-generated
`toString()` produces `Range[min=1, max=5]`.

`new Range(5, 1)` runs the compact constructor with `min=5, max=1`. Since
`min > max`, it throws before the components are ever assigned to the
record's fields — the object is never actually constructed.

</details>

---

## Exercise 4 — Enum constants with their own method bodies

```java
public enum Operation {
    PLUS  { public int apply(int a, int b) { return a + b; } },
    TIMES { public int apply(int a, int b) { return a * b; } };

    public abstract int apply(int a, int b);
}

System.out.println(Operation.PLUS.apply(2, 3));
System.out.println(Operation.valueOf("TIMES").apply(2, 3));
Operation custom = new Operation() { public int apply(int a, int b) { return 0; } };
```

Which lines compile, and which one fails?

<details>
<summary>Answer</summary>

The first two `println` calls compile and run fine:
`Operation.PLUS.apply(2, 3)` prints `5`; looking `TIMES` up via
`valueOf("TIMES")` and calling `apply(2, 3)` prints `6`.

The last line **fails to compile.** `PLUS { ... }` and `TIMES { ... }`
inside the enum body are a special enum-only syntax — the compiler
generates an anonymous subclass *for each constant* internally, which is
how each constant can supply its own `apply()` implementation. That
mechanism is only available to the compiler when declaring the constants
themselves. You, as a caller, can never write `new Operation() { ... }` —
enum constructors are implicitly `private`/package-private, and enums can
never be instantiated with `new` from outside the enum declaration, no
matter how it's dressed up with an anonymous body.

</details>

---

## Exercise 5 — Instantiating an abstract class

```java
public abstract class Shape {
    public abstract double area();
}

Shape s = new Shape() {
    @Override
    public double area() { return 0; }
};

Shape direct = new Shape();
```

Which of the two instantiation attempts compiles — one, both, or neither?

<details>
<summary>Answer</summary>

Only the **first** one compiles.

`new Shape() { @Override public double area() { return 0; } }` creates an
**anonymous subclass** of `Shape` that supplies a body for the one
abstract method — that's legal. You're never instantiating `Shape`
itself; you're instantiating a nameless, on-the-spot subclass of it, which
is a perfectly normal (non-abstract) class as far as the compiler is
concerned.

`new Shape()` with no body is a compile-time error — you cannot
instantiate an `abstract` class directly, full stop, because it may have
unimplemented methods (`area()` here has no body at all in `Shape`
itself). The distinction is subtle: it's not "abstract classes can never
be `new`'d," it's "abstract classes can never be `new`'d *without also
providing an implementation* for every abstract method" — which an
anonymous subclass body satisfies and a bare `new Shape()` does not.

</details>
