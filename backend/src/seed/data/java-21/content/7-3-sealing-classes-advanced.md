# Sealing Classes (Advanced)

> **JEP 409** — finalized in Java 17, available in Java 21. Sealed types let you define a **closed type hierarchy** whose members are known at compile time, enabling exhaustive pattern matching and precise API design.

---

## Sealed Interfaces

A sealed class or interface restricts which other types may extend or implement it using the `permits` clause:

```java
public sealed interface Shape
        permits Circle, Rectangle, Triangle {}

public record Circle(double radius)    implements Shape {}
public record Rectangle(double w, double h) implements Shape {}
public final class Triangle            implements Shape {
    private final double base, height;
    public Triangle(double base, double height) {
        this.base = base; this.height = height;
    }
    public double area() { return 0.5 * base * height; }
}
```

Every type listed in `permits` must be:
- In the same package (or same module if using modules)
- Declared as `final`, `sealed`, or `non-sealed`

| Modifier on permitted type | Meaning |
|---|---|
| `final` | No further extension allowed |
| `sealed` | Extends the closed hierarchy — must have its own `permits` |
| `non-sealed` | Re-opens the hierarchy — anyone may extend this type |

---

## Records with Sealed Interfaces

Records are implicitly `final`, so they satisfy the sealed hierarchy requirement without an explicit `final` modifier. This makes records the most concise way to create leaf nodes in a sealed hierarchy:

```java
public sealed interface Expr permits Num, Add, Mul {}

public record Num(int value)      implements Expr {}
public record Add(Expr l, Expr r) implements Expr {}
public record Mul(Expr l, Expr r) implements Expr {}
```

This pattern — sometimes called an **algebraic data type** — is common in interpreters and DSLs.

---

## Complex Permit Hierarchies

Hierarchies can have multiple levels. Each node is either `final`, `sealed`, or `non-sealed`:

```java
public sealed interface Vehicle permits Car, Truck, SpecialVehicle {}

public sealed interface Car permits Sedan, SUV permits Car {}
public final class Sedan    implements Car {}
public final class SUV      implements Car {}

public final class Truck    implements Vehicle {}

public non-sealed class SpecialVehicle implements Vehicle {}
// Now any class may extend SpecialVehicle — the hierarchy is open here
class AmbulanceVehicle extends SpecialVehicle {}
```

The `permits` clause can be omitted when all permitted subtypes are declared in the **same compilation unit** (same source file), and the compiler infers them:

```java
// Everything in one file — no explicit permits needed
public sealed interface Result {
    record Ok(String value)  implements Result {}
    record Err(String msg)   implements Result {}
}
```

---

## Exhaustive Pattern Matching with Sealed Types

Because the compiler knows every permitted subtype, a switch over a sealed type is **exhaustive** when all subtypes are covered — no `default` is needed:

```java
static double area(Shape shape) {
    return switch (shape) {
        case Circle c       -> Math.PI * c.radius() * c.radius();
        case Rectangle r    -> r.w() * r.h();
        case Triangle t     -> t.area();
        // No default — compiler guarantees exhaustiveness
    };
}
```

If a new `permits` subtype is added to `Shape`, the switch becomes a **compile-time error** — the compiler tells you exactly where to add handling. This is the key design advantage of sealed types over open hierarchies.

### Guarded patterns with `when`

```java
static String classify(Shape shape) {
    return switch (shape) {
        case Circle c when c.radius() > 10 -> "Large circle";
        case Circle c                       -> "Small circle";
        case Rectangle r when r.w() == r.h() -> "Square";
        case Rectangle r                    -> "Rectangle";
        case Triangle t                     -> "Triangle";
    };
}
```

---

## Sealed Interfaces vs Enums

Both restrict the set of possible types, but they have different capabilities:

| | Sealed interface | Enum |
|---|---|---|
| Permitted types | Classes / records / interfaces | Constants only |
| Each type holds different state | Yes | Shared fields only |
| Instances creatable at runtime | Yes (via `new`) | No (fixed set of singletons) |
| Pattern matching | Full type patterns + guards | Constant patterns |
| Best for | Heterogeneous value types, ADTs | Fixed sets of named constants |

---

## Key Rules to Remember

- `sealed` restricts subtyping; every permitted subtype must be `final`, `sealed`, or `non-sealed`
- Records are implicitly `final` — they are the natural leaf type in a sealed hierarchy
- The `permits` clause can be omitted when all subtypes are in the same source file
- A sealed type hierarchy enables exhaustive switch — adding a new subtype breaks existing switches at compile time
- `non-sealed` re-opens the hierarchy at that point; use with caution since exhaustiveness is lost for that branch
- Sealed interfaces may have `default` and `static` methods just like regular interfaces

---

## References

- [JEP 409: Sealed Classes](https://openjdk.org/jeps/409)
- [Oracle Docs — Sealed Classes and Interfaces (Java 21)](https://docs.oracle.com/en/java/javase/21/language/sealed-classes-and-interfaces.html)
- [Pattern Matching for switch (JEP 441)](https://openjdk.org/jeps/441)
