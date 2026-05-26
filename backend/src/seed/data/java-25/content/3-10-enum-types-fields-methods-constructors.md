# Enum Types with Fields, Methods, and Constructors

---

## Basic Enum

An `enum` defines a fixed set of named constants:

```java
public enum Day {
    MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY
}

Day today = Day.WEDNESDAY;
System.out.println(today);          // "WEDNESDAY"
System.out.println(today.name());   // "WEDNESDAY"
System.out.println(today.ordinal()); // 2  (zero-based index)
```

---

## Enum in switch

```java
Day day = Day.SATURDAY;

String type = switch (day) {
    case SATURDAY, SUNDAY -> "Weekend";
    default               -> "Weekday";
};
```

---

## Fields and Constructors

Each constant can carry associated data. The constructor is always `private` (implicit):

```java
public enum Planet {
    MERCURY(3.303e+23, 2.4397e6),
    VENUS  (4.869e+24, 6.0518e6),
    EARTH  (5.976e+24, 6.37814e6);

    private final double mass;    // kg
    private final double radius;  // m

    Planet(double mass, double radius) {   // implicitly private
        this.mass   = mass;
        this.radius = radius;
    }

    public double surfaceGravity() {
        final double G = 6.67300E-11;
        return G * mass / (radius * radius);
    }
}

System.out.println(Planet.EARTH.surfaceGravity());  // ~9.80
```

---

## Abstract Methods per Constant

Each constant can override an abstract method differently:

```java
public enum Operation {
    PLUS   { @Override public int apply(int x, int y) { return x + y; } },
    MINUS  { @Override public int apply(int x, int y) { return x - y; } },
    TIMES  { @Override public int apply(int x, int y) { return x * y; } };

    public abstract int apply(int x, int y);
}

System.out.println(Operation.PLUS.apply(3, 4));   // 7
System.out.println(Operation.TIMES.apply(3, 4));  // 12
```

---

## Built-in Enum Methods

| Method | Description |
|--------|-------------|
| `name()` | Returns the constant name as a `String` |
| `ordinal()` | Returns the zero-based position |
| `toString()` | Same as `name()` by default; overridable |
| `valueOf(String)` | Returns the constant with that name (throws `IllegalArgumentException`) |
| `values()` | Returns an array of all constants in declaration order |
| `compareTo(E)` | Compares by ordinal |

```java
for (Day d : Day.values()) {
    System.out.println(d.ordinal() + ": " + d.name());
}

Day d = Day.valueOf("FRIDAY");   // Day.FRIDAY
```

---

## Implementing Interfaces

Enums can implement interfaces:

```java
public interface Printable {
    void print();
}

public enum Season implements Printable {
    SPRING, SUMMER, AUTUMN, WINTER;

    @Override
    public void print() {
        System.out.println("Season: " + name());
    }
}
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| Extends | Enums implicitly extend `java.lang.Enum` — cannot extend anything else |
| Implements | Can implement interfaces |
| Constructor | Always `private` — cannot call `new` |
| `abstract` method | Each constant must provide an implementation |
| `switch` exhaustiveness | Compiler can verify if all constants are covered (with sealed-like analysis) |
| `EnumSet` / `EnumMap` | Efficient collection types for enums |

---

## EnumSet and EnumMap

```java
EnumSet<Day> weekend = EnumSet.of(Day.SATURDAY, Day.SUNDAY);
EnumSet<Day> weekdays = EnumSet.complementOf(weekend);

EnumMap<Day, String> schedule = new EnumMap<>(Day.class);
schedule.put(Day.MONDAY, "Team standup");
```
