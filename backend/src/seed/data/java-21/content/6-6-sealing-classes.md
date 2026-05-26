# Sealing Classes

> **JEP 409** — finalized in Java 17. Sealed classes and interfaces restrict which other classes or interfaces may extend or implement them, giving the compiler a closed, exhaustive type hierarchy.

---

## Why Sealed Classes?

Before sealed classes, a class was either `final` (no subclasses allowed) or open to any subclass anywhere. There was no middle ground. Sealed classes introduce a third option: *a fixed, known set of permitted subtypes*.

This is valuable for:

- **Domain modeling** — a `Shape` can only be `Circle`, `Rectangle`, or `Triangle`.
- **Pattern matching** — the compiler can verify switch exhaustiveness over a sealed hierarchy without a `default` branch.
- **API safety** — library authors control the hierarchy without making it final.

---

## `sealed` and `permits`

Use the `sealed` modifier on a class or interface, followed by a `permits` clause listing all allowed direct subtypes:

```java
public sealed class Shape permits Circle, Rectangle, Triangle {}
```

Each permitted subclass must be in the same package (or same module if using modules) and must be compiled together with the sealed class.

---

## Subclass Constraints

Every class named in the `permits` clause **must** choose one of three modifiers:

| Modifier | Meaning |
|---|---|
| `final` | Cannot be extended further |
| `sealed` | Can be extended, but only by its own `permits` list |
| `non-sealed` | Reopens the hierarchy — anyone can extend |

```java
public sealed class Shape permits Circle, Rectangle, Triangle {}

public final class Circle extends Shape {
    private final double radius;
    public Circle(double radius) { this.radius = radius; }
    public double radius() { return radius; }
}

public sealed class Rectangle extends Shape permits Square {
    private final double width, height;
    public Rectangle(double width, double height) {
        this.width = width; this.height = height;
    }
    public double width()  { return width; }
    public double height() { return height; }
}

public final class Square extends Rectangle {
    public Square(double side) { super(side, side); }
}

public non-sealed class Triangle extends Shape {
    // anyone may now extend Triangle
}
```

Forgetting to add `final`, `sealed`, or `non-sealed` to a permitted subclass is a **compile-time error**.

---

## Sealed Interfaces

Interfaces can also be sealed. Permitted subtypes may be classes, abstract classes, or other interfaces:

```java
public sealed interface Expr permits Num, Add, Mul {}

public record Num(int value)           implements Expr {}
public record Add(Expr left, Expr right) implements Expr {}
public record Mul(Expr left, Expr right) implements Expr {}
```

Records are implicitly `final`, so they satisfy the subclass constraint automatically.

---

## Interaction with Pattern Matching in `switch`

The primary payoff of sealed hierarchies is exhaustive `switch` expressions without a `default` branch:

```java
public sealed interface Shape permits Circle, Rectangle, Triangle {}
public record Circle(double radius)           implements Shape {}
public record Rectangle(double w, double h)  implements Shape {}
public record Triangle(double base, double h) implements Shape {}

static double area(Shape shape) {
    return switch (shape) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.w() * r.h();
        case Triangle t  -> 0.5 * t.base() * t.h();
        // no default needed — compiler sees the sealed hierarchy is covered
    };
}
```

If you add a new permitted subtype to `Shape`, the compiler immediately flags every non-exhaustive `switch` as an error — making the codebase safe to evolve.

---

## `permits` Clause Can Be Omitted

If all permitted subclasses are in the **same compilation unit** (same source file), the `permits` clause is inferred automatically:

```java
// SingleFile.java
public sealed class Vehicle {}
final class Car extends Vehicle {}
final class Truck extends Vehicle {}
// permits inferred: Car, Truck
```

---

## Rules Summary

| Rule | Detail |
|---|---|
| `sealed` keyword | Placed before `class` or `interface` |
| `permits` clause | Lists all allowed direct subtypes |
| Subclass location | Same package (or module) as sealed class |
| Subclass obligation | Must be `final`, `sealed`, or `non-sealed` |
| Records | Implicitly `final` — satisfy constraint automatically |
| `non-sealed` | Breaks the seal — anyone may extend that branch |
| Exhaustive switch | Compiler verifies without `default` when hierarchy is sealed |

---

## Common Exam Traps

- A class listed in `permits` that is **not** a direct subclass fails to compile.
- A permitted subclass that is missing `final`/`sealed`/`non-sealed` fails to compile.
- `non-sealed` is valid Java syntax (a keyword with a hyphen); writing `nonsealed` without the hyphen is a compile-time error.
- Sealed classes can be `abstract`.

---

## References

- [JEP 409: Sealed Classes (Java 17)](https://openjdk.org/jeps/409)
- [Oracle Docs — Sealed Classes and Interfaces](https://docs.oracle.com/en/java/javase/21/language/sealed-classes-and-interfaces.html)
- OCP Study Guide, Chapter 6 — Class Design
