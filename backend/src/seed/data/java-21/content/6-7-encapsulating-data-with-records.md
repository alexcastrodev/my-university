# Encapsulating Data with Records

> **OCP Exam Topic** — Declare and use records, understand auto-generated members, compact constructors, and record limitations. Covered in Chapter 6 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Record?

A **record** (introduced as a standard feature in Java 16) is a special kind of class designed to be a transparent, immutable carrier of data. Instead of writing a class with private fields, a constructor, getters, `equals`, `hashCode`, and `toString` by hand, you declare a record and the compiler generates all of this automatically.

---

## Record Declaration Syntax

```java
public record Point(int x, int y) { }
```

The `(int x, int y)` part is called the **record header** (or component list). Each component becomes:

- A `private final` field.
- A public **accessor method** with the same name as the component (not `getX()` — just `x()`).

```java
Point p = new Point(3, 7);
System.out.println(p.x());      // 3
System.out.println(p.y());      // 7
System.out.println(p);          // Point[x=3, y=7]
```

---

## Auto-Generated Members

For a record `record Person(String name, int age)`, the compiler automatically generates:

| Member | Generated Form |
|---|---|
| Constructor | `public Person(String name, int age)` |
| Accessor for `name` | `public String name()` |
| Accessor for `age` | `public int age()` |
| `equals` | Compares all components |
| `hashCode` | Based on all components |
| `toString` | `Person[name=Alice, age=30]` |

```java
record Person(String name, int age) { }

Person a = new Person("Alice", 30);
Person b = new Person("Alice", 30);

System.out.println(a.equals(b));    // true
System.out.println(a.hashCode() == b.hashCode()); // true
System.out.println(a);              // Person[name=Alice, age=30]
```

---

## Compact Constructors

Records support a **compact constructor** — a constructor with no parameter list that validates or transforms the components before they are assigned to the fields. The compiler assigns the (possibly modified) components to the fields after the compact constructor body completes.

```java
public record Range(int min, int max) {
    Range {   // no parameter list — uses the record components directly
        if (min > max) throw new IllegalArgumentException("min > max");
    }
}

Range r = new Range(1, 10);  // OK
Range bad = new Range(10, 1); // throws IllegalArgumentException
```

You can also normalize values inside the compact constructor:

```java
public record Name(String first, String last) {
    Name {
        first = first.strip();
        last  = last.strip();
    }
}
```

---

## Customizing Records

You can add:

- **Instance methods** (but not instance fields beyond the components).
- **Static fields and static methods**.
- **Additional constructors** (they must delegate to the canonical constructor).
- **Overridden auto-generated methods** (`equals`, `hashCode`, `toString`, or individual accessors).

```java
public record Circle(double radius) {
    // static field
    public static final double PI = Math.PI;

    // custom instance method
    public double area() {
        return PI * radius * radius;
    }

    // overriding the generated toString
    @Override
    public String toString() {
        return "Circle with radius " + radius;
    }
}
```

---

## Records Implementing Interfaces

Records can implement interfaces but cannot extend any class (they implicitly extend `java.lang.Record`).

```java
public interface Describable {
    String describe();
}

public record Product(String name, double price) implements Describable {
    @Override
    public String describe() {
        return name + " costs $" + price;
    }
}

Describable d = new Product("Widget", 9.99);
System.out.println(d.describe()); // Widget costs $9.99
```

---

## Record Limitations

| Limitation | Explanation |
|---|---|
| Cannot use `extends` | Records implicitly extend `java.lang.Record`; no other superclass allowed |
| Always `final` | You cannot subclass a record |
| No instance fields outside header | Instance fields beyond components are not permitted |
| Components are `private final` | Records are inherently immutable; no setters are generated |
| Cannot be `abstract` | Records must be instantiable |

```java
// compile errors:
// record Bad(int x) extends SomeClass { }  // cannot extend
// abstract record Bad(int x) { }            // cannot be abstract

public record Point(int x, int y) {
    // private int z;  // compile error — instance field not a component
    private static int count = 0; // OK — static fields are allowed
}
```

---

## Key Points to Remember

- A record is a `final` class that implicitly extends `java.lang.Record`.
- The record header defines components; each becomes a `private final` field plus a public accessor method named after the component (not a traditional getter with `get` prefix).
- The compiler auto-generates a canonical constructor, all accessor methods, `equals`, `hashCode`, and `toString`.
- Compact constructors validate or transform components; no parameter list is written; fields are assigned after the body.
- Records can implement interfaces, add static fields, static methods, and instance methods, and override generated methods.
- Records cannot extend classes, cannot be subclassed, and cannot declare instance fields outside the component list.
