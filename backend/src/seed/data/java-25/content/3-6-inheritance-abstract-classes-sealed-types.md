---
version: 1.0
updatedAt: 2026-05-26
---
# Inheritance, Abstract Classes, and Sealed Types

---

## Inheritance

A subclass inherits non-private fields and methods from its superclass:

```java
public class Animal {
    protected String name;
    public void breathe() { System.out.println("breathing"); }
}

public class Dog extends Animal {
    public void bark() { System.out.println("woof"); }
}

Dog d = new Dog();
d.breathe();  // inherited
d.bark();     // own method
```

- Java supports **single inheritance** for classes (one direct superclass).
- Every class implicitly extends `Object` if no `extends` clause is written.
- `final` classes cannot be subclassed.

---

## Abstract Classes

An abstract class cannot be instantiated directly. It may contain a mix of abstract and concrete methods:

```java
public abstract class Shape {
    protected String color;

    public abstract double area();   // subclass must implement

    public void describe() {         // concrete — inherited as-is
        System.out.println("A " + color + " shape with area " + area());
    }
}

public class Circle extends Shape {
    private double radius;
    Circle(double r) { this.radius = r; }

    @Override
    public double area() { return Math.PI * radius * radius; }
}
```

- If a concrete subclass does not implement all abstract methods, it must also be declared `abstract`.
- Abstract classes can have constructors (called via `super()`).

---

## Sealed Classes (Java 17, finalized)

A **sealed** class restricts which classes may extend it:

```java
public sealed class Shape permits Circle, Rectangle, Triangle { }

public final class Circle    extends Shape { }
public final class Rectangle extends Shape { }
public non-sealed class Triangle extends Shape { }  // open for further extension
```

### Permitted Subclass Rules

Each permitted subclass must be one of:
- `final` — cannot be extended further
- `sealed` — restricted extension
- `non-sealed` — unrestricted extension (reopens the hierarchy)

Permitted subclasses must be in the same package (or module).

### Sealed Interfaces

```java
public sealed interface Expr permits Num, Add, Mul { }

public record Num(int value) implements Expr { }
public record Add(Expr left, Expr right) implements Expr { }
public record Mul(Expr left, Expr right) implements Expr { }
```

### Exhaustive switch with Sealed Types

The compiler knows all subtypes, so `switch` expressions need no `default`:

```java
double eval(Expr e) {
    return switch (e) {
        case Num n       -> n.value();
        case Add a       -> eval(a.left()) + eval(a.right());
        case Mul m       -> eval(m.left()) * eval(m.right());
    };
}
```

---

## Comparison

| Feature | Abstract class | Sealed class |
|---------|---------------|-------------|
| Purpose | Partial implementation | Restricted hierarchy |
| Instantiation | No | No (unless a concrete subclass) |
| Subclass count | Unlimited | Limited to `permits` list |
| Exhaustive switch | No | Yes |
| Can have fields | Yes | Yes |
| Can have constructors | Yes | Yes |

---

## Key Rules

| Rule | Detail |
|------|--------|
| `extends` | Single class only; optional |
| Abstract method | No body; subclass must implement or stay abstract |
| `sealed` | Requires `permits` clause (or all permitted classes in same file) |
| `non-sealed` | Breaks the seal — anyone can extend that subclass |
| `final` + `abstract` | Compile error — contradictory |
