# Extending Classes

> Extending a class means building on an existing type. This lesson covers `super`, method overriding rules, covariant return types, and the use of `final` and `abstract` to control what subclasses can or must do.

---

## Calling the Superclass Constructor with `super()`

When a subclass is instantiated, the superclass constructor must run first. If the superclass has no no-arg constructor, the subclass **must** explicitly call `super(...)` as the first statement in its constructor.

```java
public class Animal {
    private String name;
    public Animal(String name) { this.name = name; }
    public String getName()    { return name; }
}

public class Dog extends Animal {
    private String breed;

    public Dog(String name, String breed) {
        super(name);          // must be first statement
        this.breed = breed;
    }
}
```

If you do not write `super(...)` and the superclass has a no-arg constructor, the compiler inserts `super()` automatically.

---

## The `super` Keyword

`super` refers to the **superclass** portion of the current object. It is used to:

1. Call a superclass constructor: `super(args)` — must be first statement.
2. Access a superclass method that has been overridden: `super.method()`.
3. Access a superclass field that has been hidden: `super.field`.

```java
public class Shape {
    public String describe() { return "Shape"; }
}

public class Circle extends Shape {
    private double radius;

    public Circle(double radius) { this.radius = radius; }

    @Override
    public String describe() {
        return super.describe() + " -> Circle(r=" + radius + ")";
    }
}
```

---

## Overriding Instance Methods

A subclass **overrides** an inherited method by declaring a method with the same name, same parameter list, and a compatible return type. Rules:

- Access modifier must be **the same or wider** (never more restrictive).
- Return type must be the **same or a covariant subtype**.
- Checked exceptions in `throws` may only be narrowed or removed.
- Static methods are **hidden**, not overridden.
- `private` and `final` methods cannot be overridden.

```java
public class Vehicle {
    public Number getSpeed() { return 0; }
}

public class Car extends Vehicle {
    @Override
    public Integer getSpeed() { return 120; }  // Integer IS-A Number (covariant)
}
```

### The `@Override` Annotation

`@Override` is optional but strongly recommended. The compiler will raise an error if the annotated method does not actually override a superclass or interface method — catching typos immediately.

```java
public class Animal {
    public void makeSound() { System.out.println("..."); }
}

public class Cat extends Animal {
    @Override
    public void makeSound() { System.out.println("Meow"); }  // correct

    @Override
    public void makeSoudn() {}  // compile-time ERROR — typo caught!
}
```

---

## Covariant Return Types

A method override may return a **subtype** of the original return type. This is called a *covariant return type*.

```java
public class AnimalFactory {
    public Animal create() { return new Animal("generic"); }
}

public class DogFactory extends AnimalFactory {
    @Override
    public Dog create() { return new Dog("Buddy", "Labrador"); }  // Dog extends Animal
}
```

Covariant return types apply only to **object types**; primitive return types must match exactly.

---

## `final` Methods and Classes

### `final` Method

A `final` method cannot be overridden by any subclass. Use it to lock down critical behavior.

```java
public class Template {
    public final void run() {   // cannot be overridden
        setup();
        execute();
        teardown();
    }
    protected void setup()    {}
    protected void execute()  {}
    protected void teardown() {}
}
```

### `final` Class

A `final` class cannot be extended at all. `java.lang.String` and `java.lang.Integer` are classic examples.

```java
public final class ImmutablePoint {
    private final int x, y;
    public ImmutablePoint(int x, int y) { this.x = x; this.y = y; }
    public int getX() { return x; }
    public int getY() { return y; }
}

// ERROR: cannot extend final class
public class MutablePoint extends ImmutablePoint {}  // compile-time error
```

---

## Abstract Classes

An **abstract class** cannot be instantiated directly. It exists to be extended. Abstract methods declare a signature without a body; subclasses must provide an implementation (unless they are also abstract).

```java
public abstract class Shape {
    protected String color;

    public Shape(String color) { this.color = color; }

    // abstract — subclasses must implement
    public abstract double area();

    // concrete — inherited as-is
    public String describe() {
        return color + " shape with area " + area();
    }
}

public class Rectangle extends Shape {
    private double w, h;

    public Rectangle(String color, double w, double h) {
        super(color);
        this.w = w; this.h = h;
    }

    @Override
    public double area() { return w * h; }
}
```

| Rule | Detail |
|---|---|
| Abstract class instantiation | `new Shape()` — compile-time error |
| Abstract method body | Not allowed — no `{}` |
| Non-abstract subclass | Must implement **all** abstract methods |
| Abstract + final | Invalid combination — contradictory |
| Abstract + abstract method | Same class or a further abstract subclass |

---

## Quick Reference

| Keyword | Effect |
|---|---|
| `super(args)` | Call superclass constructor (first statement only) |
| `super.method()` | Invoke superclass version of an overridden method |
| `@Override` | Compiler-verified override annotation |
| `final` method | Cannot be overridden |
| `final` class | Cannot be extended |
| `abstract` class | Cannot be instantiated; may contain abstract methods |
| `abstract` method | No body; subclasses must implement |

---

## References

- [Oracle Docs — Overriding and Hiding Methods](https://docs.oracle.com/javase/tutorial/java/IandI/override.html)
- [Oracle Docs — Abstract Methods and Classes](https://docs.oracle.com/javase/tutorial/java/IandI/abstract.html)
- OCP Study Guide, Chapter 6 — Class Design
