# Working with Enums

> An `enum` is a special class that represents a fixed set of named constants. Enums are type-safe, support methods and fields, and integrate cleanly with `switch` expressions.

---

## Basic Enum Declaration

```java
public enum Season {
    SPRING, SUMMER, FALL, WINTER
}
```

Each constant (e.g., `SPRING`) is a `public static final` instance of the `Season` type. Enums implicitly extend `java.lang.Enum` — you cannot extend another class. They can implement interfaces.

```java
Season s = Season.SUMMER;
System.out.println(s);   // SUMMER  (toString() returns the name)
```

---

## Built-in Enum Methods

Every enum inherits the following from `java.lang.Enum`:

| Method | Returns | Description |
|---|---|---|
| `name()` | `String` | The constant's declared name |
| `ordinal()` | `int` | Zero-based declaration position |
| `toString()` | `String` | Same as `name()` by default |
| `compareTo(E)` | `int` | Compares by ordinal |
| `equals(Object)` | `boolean` | Identity comparison |

The compiler also generates two **static** methods:

| Method | Description |
|---|---|
| `values()` | Returns an array of all constants in declaration order |
| `valueOf(String)` | Returns the constant with that exact name (throws `IllegalArgumentException` if not found) |

```java
for (Season s : Season.values()) {
    System.out.println(s.ordinal() + ": " + s.name());
}
// 0: SPRING
// 1: SUMMER
// 2: FALL
// 3: WINTER

Season s = Season.valueOf("FALL");   // Season.FALL
```

---

## Enums in `switch`

Enums work naturally with both traditional `switch` statements and modern `switch` expressions. Use the constant name directly (without the type):

```java
Season season = Season.WINTER;

// switch expression (Java 14+)
String description = switch (season) {
    case SPRING -> "Warm and rainy";
    case SUMMER -> "Hot and sunny";
    case FALL   -> "Cool and windy";
    case WINTER -> "Cold and snowy";
};
System.out.println(description);   // Cold and snowy
```

Because `Season` has exactly four constants, the compiler can verify exhaustiveness without `default`.

---

## Enum Fields, Methods, and Constructors

Enums can carry fields and behavior. The constructor is called for each constant at class-loading time and must be `private` or package-private (never `public` or `protected`).

```java
public enum Planet {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS  (4.869e+24, 6.0518e6),
    EARTH  (5.976e+24, 6.37814e6),
    MARS   (6.421e+23, 3.3972e6);

    private final double mass;     // in kilograms
    private final double radius;   // in meters

    Planet(double mass, double radius) {   // implicitly private
        this.mass   = mass;
        this.radius = radius;
    }

    static final double G = 6.67300E-11;

    public double surfaceGravity() {
        return G * mass / (radius * radius);
    }

    public double surfaceWeight(double otherMass) {
        return otherMass * surfaceGravity();
    }
}

double earthWeight = 75.0;
double mass = earthWeight / Planet.EARTH.surfaceGravity();

for (Planet p : Planet.values()) {
    System.out.printf("Weight on %s is %.2f%n", p, p.surfaceWeight(mass));
}
```

---

## Abstract Methods in Enums

An enum may declare an `abstract` method, requiring each constant to provide its own implementation via an anonymous class body:

```java
public enum Operation {
    PLUS("+") {
        @Override public double apply(double x, double y) { return x + y; }
    },
    MINUS("-") {
        @Override public double apply(double x, double y) { return x - y; }
    },
    TIMES("*") {
        @Override public double apply(double x, double y) { return x * y; }
    },
    DIVIDE("/") {
        @Override public double apply(double x, double y) { return x / y; }
    };

    private final String symbol;
    Operation(String symbol) { this.symbol = symbol; }

    public abstract double apply(double x, double y);

    @Override public String toString() { return symbol; }
}

System.out.println(Operation.PLUS.apply(3, 4));    // 7.0
System.out.println(Operation.TIMES.apply(3, 4));   // 12.0
```

---

## Enum Implementing an Interface

```java
public interface Describable {
    String getDescription();
}

public enum Status implements Describable {
    ACTIVE   { @Override public String getDescription() { return "Currently active";  } },
    INACTIVE { @Override public String getDescription() { return "No longer active";  } },
    PENDING  { @Override public String getDescription() { return "Awaiting activation"; } };
}
```

---

## Key Rules

| Rule | Detail |
|---|---|
| Implicit superclass | All enums extend `java.lang.Enum` |
| Cannot extend | Another class (already extends `Enum`) |
| Can implement | One or more interfaces |
| Constructor visibility | `private` or package-private only |
| Semicolon | Required after constants if fields/methods follow |
| `new Season()` | Compile-time error — enums cannot be instantiated with `new` |

---

## References

- [Oracle Docs — Enum Types](https://docs.oracle.com/javase/tutorial/java/javaOO/enum.html)
- OCP Study Guide, Chapter 6 — Class Design
