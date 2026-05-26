# Encapsulating Data

> **OCP Exam Topic** — Apply encapsulation using private fields, public getters/setters, and JavaBeans naming conventions. Covered in Chapter 5 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is Encapsulation?

Encapsulation bundles data (fields) and the code that operates on that data (methods) into a single unit, while restricting direct access to the data from outside the class. The goal is to hide internal state and require all interactions to go through a controlled interface.

The standard Java pattern for encapsulation:

1. Declare fields `private`.
2. Provide `public` getter and setter methods to read and write those fields.

---

## Private Fields and Public Accessors

```java
public class Person {
    private String name;
    private int age;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getAge() {
        return age;
    }

    public void setAge(int age) {
        if (age < 0) throw new IllegalArgumentException("Age cannot be negative");
        this.age = age;
    }
}
```

The setter for `age` validates the input before applying it — something impossible when the field is public and written to directly.

---

## JavaBeans Naming Conventions

The **JavaBeans** specification defines naming rules that many frameworks (Spring, JPA, Hibernate, CDI) rely on to discover getters and setters via reflection.

| Member Type | Convention | Example |
|---|---|---|
| Getter for non-boolean | `get` + capitalized field name | `getName()` |
| Getter for boolean | `is` + capitalized field name | `isActive()` |
| Setter | `set` + capitalized field name | `setName(String name)` |

```java
public class Account {
    private String owner;
    private boolean active;
    private double balance;

    // getters
    public String getOwner()   { return owner; }
    public boolean isActive()  { return active; }   // "is" prefix for boolean
    public double getBalance() { return balance; }

    // setters
    public void setOwner(String owner)     { this.owner = owner; }
    public void setActive(boolean active)  { this.active = active; }
    public void setBalance(double balance) { this.balance = balance; }
}
```

**Exam note:** A boolean getter named `getActive()` is valid Java but does **not** follow the JavaBeans convention. The OCP exam tests whether you recognize the `is` prefix for boolean getters.

---

## Benefits of Encapsulation

**Validation** — Setters can enforce business rules before changing state:

```java
public void setBalance(double balance) {
    if (balance < 0) throw new IllegalArgumentException("Balance cannot be negative");
    this.balance = balance;
}
```

**Read-only fields** — Omit the setter to make a field read-only from outside the class:

```java
public class ImmutablePoint {
    private final int x;
    private final int y;

    public ImmutablePoint(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int getX() { return x; }
    public int getY() { return y; }
    // no setX / setY — callers cannot modify x or y
}
```

**Flexibility to change internals** — You can change how data is stored without breaking callers, because they only depend on the method signatures, not the field names.

---

## Immutable Classes Pattern

An immutable class has no setters, declares all fields `final`, and ensures that mutable objects referenced by its fields cannot be modified externally. Java's own `String` and `LocalDate` follow this pattern.

```java
public final class Money {
    private final int cents;

    public Money(int cents) {
        if (cents < 0) throw new IllegalArgumentException("Cannot be negative");
        this.cents = cents;
    }

    public int getCents() { return cents; }

    public Money add(Money other) {
        return new Money(this.cents + other.cents); // returns new instance
    }

    @Override
    public String toString() {
        return "$" + cents / 100 + "." + String.format("%02d", cents % 100);
    }
}

Money price  = new Money(999);
Money taxed  = price.add(new Money(80));
System.out.println(taxed); // $10.79
```

Rules for building an immutable class:

- Declare the class `final` (prevents subclasses from breaking immutability).
- Declare all fields `private final`.
- Initialize all fields in the constructor.
- Provide no setters.
- Return copies of mutable fields from getters (defensive copying).

---

## Common Mistakes

```java
// Mistake 1 — wrong prefix for boolean getter
public boolean getEnabled() { return enabled; } // valid Java but not JavaBeans-compliant

// Mistake 2 — setter returns a value (violates JavaBeans convention)
public int setAge(int age) { this.age = age; return age; } // setter must return void

// Mistake 3 — public field (breaks encapsulation)
public String name; // any class can read or write name without validation
```

---

## Key Points to Remember

- Declare fields `private` and expose them through `public` getter/setter methods.
- Follow JavaBeans naming: `getX()` for non-boolean, `isX()` for boolean, `setX(value)` for mutators.
- Setters must return `void`; getters must return the field type.
- Omitting a setter makes the property effectively read-only to external callers.
- Immutable classes combine `private final` fields, constructor initialization, no setters, and a `final` class declaration.
- Encapsulation allows validation, controlled change, and the freedom to refactor internals without breaking the public API.
