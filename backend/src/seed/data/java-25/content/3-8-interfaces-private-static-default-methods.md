# Interfaces: private, static, and default Methods

---

## Interface Basics

An interface defines a contract — a set of method signatures that implementing classes must fulfil:

```java
public interface Drawable {
    void draw();          // implicitly public abstract
    double area();
}

public class Circle implements Drawable {
    private double radius;
    Circle(double r) { this.radius = r; }

    @Override public void draw()    { System.out.println("Drawing circle"); }
    @Override public double area()  { return Math.PI * radius * radius; }
}
```

- All non-`default`, non-`static`, non-`private` methods are implicitly `public abstract`.
- Fields are implicitly `public static final`.
- A class can implement multiple interfaces.

---

## default Methods

A `default` method has a body and is inherited by all implementing classes. It can be overridden:

```java
public interface Greetable {
    String getName();

    default String greet() {                   // concrete method in interface
        return "Hello, " + getName() + "!";
    }
}

public class Person implements Greetable {
    private String name;
    Person(String name) { this.name = name; }

    @Override public String getName() { return name; }
    // greet() is inherited — no need to override unless customising
}
```

### Diamond Problem

When two interfaces define the same `default` method, the class must override it:

```java
interface A { default void hello() { System.out.println("A"); } }
interface B { default void hello() { System.out.println("B"); } }

class C implements A, B {
    @Override
    public void hello() {
        A.super.hello();   // explicitly choose A's version
    }
}
```

---

## static Methods

Interface `static` methods belong to the interface, not to implementing classes. They are called via the interface name:

```java
public interface Validator {
    boolean isValid(String input);

    static Validator notNull() {           // factory helper
        return input -> input != null;
    }
}

Validator v = Validator.notNull();
```

> Static interface methods are **not** inherited by implementing classes or subinterfaces.

---

## private Methods (Java 9+)

`private` methods share logic between `default` or `static` methods within the interface without exposing it:

```java
public interface Logger {
    default void logInfo(String msg)  { log("INFO", msg); }
    default void logError(String msg) { log("ERROR", msg); }

    private void log(String level, String msg) {   // shared helper
        System.out.println("[" + level + "] " + msg);
    }
}
```

`private static` is also allowed for helpers shared between `static` methods.

---

## Method Summary

| Method type | Body | Inherited? | Override? | Call via |
|-------------|------|-----------|-----------|---------|
| Abstract | No | Yes (must implement) | Required | Instance |
| `default` | Yes | Yes | Optional | Instance |
| `static` | Yes | No | No (hidden) | `InterfaceName.method()` |
| `private` | Yes | No | No | Within interface only |
| `private static` | Yes | No | No | Within interface only |

---

## Interface vs Abstract Class

| | Interface | Abstract class |
|-|-----------|---------------|
| Multiple inheritance | Yes (implements many) | No (extends one) |
| State (instance fields) | No | Yes |
| Constructors | No | Yes |
| Access modifiers for methods | `public` or `private` | Any |
| `default` methods | Yes | N/A (just concrete) |

---

## Functional Interfaces

An interface with exactly one abstract method is a **functional interface** — usable as a lambda target. See lesson 3-9.

```java
@FunctionalInterface
public interface Transformer {
    String transform(String input);
    // default and static methods do not count toward the one-abstract-method rule
}
```
