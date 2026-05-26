# Creating Classes

> A well-structured class declaration controls visibility, initialization order, and the relationship between objects and their data. This lesson covers class syntax, constructors, `this`, and instance initializers.

---

## Class Declaration Syntax

The full syntax for a top-level class is:

```
[access_modifier] [non-access_modifiers] class ClassName [extends SuperClass] [implements Interfaces] {
    // fields, constructors, methods, nested types
}
```

```java
public final class BankAccount {
    // ...
}
```

**Access modifiers for top-level classes:**

| Modifier | Meaning |
|---|---|
| `public` | Visible everywhere |
| *(none)* | Package-private — visible only within same package |

`protected` and `private` are **not** valid for top-level classes (only for nested classes).

---

## Default Constructor

If you declare **no constructor**, the compiler inserts a **default (no-argument) constructor** automatically:

```java
public class Box {
    int width;
    // compiler inserts: public Box() {}
}

Box b = new Box();   // OK — uses default constructor
```

As soon as you declare *any* constructor, the compiler no longer inserts a default one. If you still need a no-arg constructor, you must write it explicitly.

```java
public class Box {
    int width;
    public Box(int width) { this.width = width; }
    // new Box() now causes a compile-time error — no-arg constructor gone
}
```

---

## Explicit Constructors

Constructors have no return type and must match the class name exactly:

```java
public class Point {
    private final int x;
    private final int y;

    // explicit no-arg constructor
    public Point() {
        this(0, 0);   // delegates to two-arg constructor
    }

    // two-arg constructor
    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public int getX() { return x; }
    public int getY() { return y; }
}
```

---

## Constructor Chaining with `this()`

One constructor can call another constructor in the **same class** using `this(...)`. The call must be the **first statement** in the constructor body.

```java
public class Color {
    private int r, g, b, alpha;

    public Color(int r, int g, int b) {
        this(r, g, b, 255);           // calls 4-arg constructor
    }

    public Color(int r, int g, int b, int alpha) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.alpha = alpha;
    }
}
```

Cyclic constructor chains are a compile-time error:

```java
// ERROR — infinite loop at compile time
public Foo() { this(1); }
public Foo(int x) { this(); }
```

---

## The `this` Keyword

`this` refers to the **current instance**. It is used to:

1. Distinguish instance fields from constructor/method parameters with the same name.
2. Pass the current object as an argument.
3. Call another constructor in the same class (`this(...)`).

```java
public class Circle {
    private double radius;

    public Circle(double radius) {
        this.radius = radius;   // 1 — disambiguate
    }

    public Circle copy() {
        return new Circle(this.radius);  // explicit, same as radius
    }

    public void register(Registry reg) {
        reg.add(this);   // 2 — pass current instance
    }
}
```

`this` cannot be used in `static` contexts — there is no current instance in a static method.

---

## Instance Initializers

An **instance initializer** is a block of code inside the class body (but outside any method or constructor) that runs every time an instance is created, before the constructor body.

```java
public class Counter {
    private int count;
    private long createdAt;

    {   // instance initializer
        createdAt = System.currentTimeMillis();
        System.out.println("Initializer ran");
    }

    public Counter() {
        count = 0;
    }

    public Counter(int start) {
        count = start;
    }
}
```

**Initialization order:**

1. Static fields / static initializers (in declaration order, once per class load)
2. Instance fields and instance initializers (in declaration order)
3. Constructor body

```java
public class Demo {
    int a = 10;              // 1st
    { a += 5; }              // 2nd — a is now 15
    public Demo() { a += 1; } // 3rd — a is now 16
}
```

> **Exam tip:** Instance initializers are uncommon in production code but appear on the exam. Remember they run *before* the constructor body but *after* fields declared above them are initialized.

---

## Quick Reference

| Concept | Key Rule |
|---|---|
| Default constructor | Added only if *no* constructor is declared |
| `this(...)` call | Must be the very first statement in a constructor |
| `this` keyword | Not valid in static methods |
| Instance initializer | Runs before constructor body, in declaration order |
| No return type | Constructors never have a return type (not even `void`) |

---

## References

- [Oracle Docs — Providing Constructors for Your Classes](https://docs.oracle.com/javase/tutorial/java/javaOO/constructors.html)
- OCP Study Guide, Chapter 6 — Class Design
