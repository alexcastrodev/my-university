# Working with Enums (Advanced)

> Enums in Java are full classes — they can carry state, implement interfaces, define abstract methods, and participate in switch expressions. This lesson goes beyond the basics to cover the patterns the OCP exam tests.

---

## Enums with Abstract Methods

Each constant can override an abstract method declared in the enum body, giving every constant its own behaviour:

```java
public enum Operation {
    ADD {
        @Override
        public double apply(double x, double y) { return x + y; }
    },
    SUBTRACT {
        @Override
        public double apply(double x, double y) { return x - y; }
    },
    MULTIPLY {
        @Override
        public double apply(double x, double y) { return x * y; }
    };

    public abstract double apply(double x, double y);
}

Operation.ADD.apply(3, 2);       // 5.0
Operation.SUBTRACT.apply(3, 2); // 1.0
```

Each constant is an **anonymous subclass** of the enum. Because `apply` is abstract, the compiler ensures every constant provides an implementation — a missed constant is a compile error.

---

## Enums Implementing Interfaces

An enum can implement one or more interfaces. Each constant then fulfills that contract:

```java
public interface Describable {
    String describe();
}

public enum Planet implements Describable {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS  (4.869e+24, 6.0518e6),
    EARTH  (5.976e+24, 6.37814e6);

    private final double mass;   // kg
    private final double radius; // metres

    Planet(double mass, double radius) {
        this.mass   = mass;
        this.radius = radius;
    }

    static final double G = 6.67300E-11;

    public double surfaceGravity() {
        return G * mass / (radius * radius);
    }

    @Override
    public String describe() {
        return name() + " — gravity: " + String.format("%.2f", surfaceGravity());
    }
}
```

---

## Enums in Switch Expressions

Enums pair naturally with switch expressions. Java 21 requires no `default` when all constants are covered (exhaustiveness):

```java
public enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

String type = switch (day) {
    case MON, TUE, WED, THU, FRI -> "Weekday";
    case SAT, SUN                 -> "Weekend";
};
// No default needed — all 7 constants are covered
```

Adding a new constant to the enum without updating the switch causes a compile-time warning and a runtime `MatchException` if the switch is exhaustive (no `default`). This is intentional — it forces you to handle new cases.

---

## EnumSet

`EnumSet` is a high-performance `Set` implementation backed by a bit vector. It is ideal whenever you need a set of enum constants.

```java
import java.util.EnumSet;

EnumSet<Day> weekend   = EnumSet.of(Day.SAT, Day.SUN);
EnumSet<Day> weekdays  = EnumSet.complementOf(weekend);
EnumSet<Day> allDays   = EnumSet.allOf(Day.class);
EnumSet<Day> noDay     = EnumSet.noneOf(Day.class);
EnumSet<Day> monToWed  = EnumSet.range(Day.MON, Day.WED); // MON, TUE, WED

weekend.contains(Day.SAT); // true
```

| Factory | Description |
|---|---|
| `EnumSet.of(e1, e2, ...)` | Set of specified constants |
| `EnumSet.allOf(E.class)` | All constants |
| `EnumSet.noneOf(E.class)` | Empty set for that enum |
| `EnumSet.range(from, to)` | Constants from `from` to `to` inclusive (ordinal order) |
| `EnumSet.complementOf(set)` | All constants **not** in `set` |

**Note:** `EnumSet` is not thread-safe. Use `Collections.synchronizedSet(EnumSet.of(...))` when needed.

---

## EnumMap

`EnumMap` is a `Map` implementation where keys are enum constants. Internally it uses an array indexed by ordinal, making it faster and more memory-efficient than `HashMap`.

```java
import java.util.EnumMap;

EnumMap<Day, String> schedule = new EnumMap<>(Day.class);
schedule.put(Day.MON, "Team standup");
schedule.put(Day.FRI, "Code review");

schedule.get(Day.MON); // "Team standup"
schedule.getOrDefault(Day.WED, "Free"); // "Free"
```

Keys in an `EnumMap` iterate in **declaration order** (ordinal order) — not insertion order.

---

## Enum Utility Methods

Every enum automatically inherits these useful methods:

```java
Day d = Day.valueOf("MON");   // parses string → constant; throws IllegalArgumentException if not found
Day[] all = Day.values();      // returns a new array each call
int ord = Day.WED.ordinal();   // 2 (zero-based)
String nm = Day.FRI.name();    // "FRI" — always the declared identifier
```

> Avoid relying on `ordinal()` for persistent storage — inserting a new constant changes ordinals of all subsequent constants.

---

## Key Rules to Remember

- Enum constants with body are anonymous subclasses of their enum; abstract methods force all constants to implement
- An enum can implement interfaces but cannot extend any class (it already extends `java.lang.Enum`)
- Switch expressions over enums are exhaustive when all constants are listed — no `default` required
- `EnumSet` and `EnumMap` are faster than general-purpose alternatives and should be preferred for enum-keyed collections
- `values()` creates a new array on every call — cache it if performance matters
- `ordinal()` is fragile — prefer named constants or explicit fields for stable identifiers

---

## References

- [Enum (Java 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Enum.html)
- [EnumSet (Java 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/EnumSet.html)
- [EnumMap (Java 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/EnumMap.html)
