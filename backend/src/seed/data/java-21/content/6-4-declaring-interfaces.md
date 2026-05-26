# Declaring Interfaces

> An interface defines a contract: a set of method signatures (and optionally default behavior) that any implementing class must honor. Interfaces are the primary tool for achieving multiple-type inheritance in Java.

---

## Interface Syntax

```java
public interface Flyable {
    // implicitly: public static final
    double MAX_ALTITUDE = 40_000.0;

    // implicitly: public abstract
    void fly();
    void land();
}
```

Key rules:
- All fields in an interface are implicitly `public static final`.
- All methods declared without a body are implicitly `public abstract`.
- An interface cannot be instantiated directly.

---

## Abstract Methods

Abstract methods define the contract. Any non-abstract implementing class must provide a body.

```java
public interface Printable {
    void print();              // public abstract — implied
    String getContent();       // public abstract — implied
}

public class Document implements Printable {
    private String text;

    public Document(String text) { this.text = text; }

    @Override public void print()          { System.out.println(text); }
    @Override public String getContent()   { return text; }
}
```

---

## Default Methods

Introduced in Java 8, `default` methods have a body and are inherited by implementing classes. They allow interfaces to evolve without breaking existing implementations.

```java
public interface Logger {
    void log(String message);

    default void logInfo(String message) {
        log("[INFO] " + message);
    }

    default void logError(String message) {
        log("[ERROR] " + message);
    }
}
```

A class may override a default method, or call the interface's version via `InterfaceName.super.method()`:

```java
public class TimestampLogger implements Logger {
    @Override
    public void log(String message) { System.out.println(System.currentTimeMillis() + " " + message); }

    @Override
    public void logInfo(String message) {
        Logger.super.logInfo("[TS] " + message);  // call interface default
    }
}
```

---

## Static Methods

Interface `static` methods belong to the interface type itself and are **not** inherited by implementing classes or subinterfaces. They are called via the interface name.

```java
public interface MathOps {
    static int add(int a, int b) { return a + b; }
    static int multiply(int a, int b) { return a * b; }
}

int sum = MathOps.add(3, 4);   // 7
```

---

## Private Methods (Java 9+)

`private` methods in interfaces reduce code duplication among default or static methods. They are not visible to implementing classes.

```java
public interface Validator {
    boolean validate(String input);

    default boolean validateAndLog(String input) {
        boolean result = validate(input);
        logResult(input, result);   // private helper
        return result;
    }

    private void logResult(String input, boolean result) {
        System.out.println("Validated '" + input + "': " + result);
    }
}
```

---

## Interface Constants

Fields declared in interfaces are always `public static final`, even without those modifiers:

```java
public interface HttpStatus {
    int OK        = 200;   // public static final int OK = 200
    int NOT_FOUND = 404;
    int ERROR     = 500;
}
```

Avoid overusing interface constants — prefer `enum` types for related named values.

---

## Implementing Interfaces

A class uses the `implements` keyword. A class may implement **multiple interfaces** (comma-separated):

```java
public interface Serializable {}
public interface Cloneable {}
public interface Drawable {
    void draw();
}

public class Icon implements Drawable, Serializable, Cloneable {
    @Override
    public void draw() { System.out.println("Drawing icon"); }
}
```

An interface can extend multiple interfaces using `extends`:

```java
public interface Shape extends Drawable, Printable {
    double area();
}
```

---

## Resolving Default Method Conflicts

When a class implements two interfaces that both declare a default method with the same signature, the class **must** override the method:

```java
public interface A { default void greet() { System.out.println("Hello from A"); } }
public interface B { default void greet() { System.out.println("Hello from B"); } }

public class C implements A, B {
    @Override
    public void greet() {
        A.super.greet();   // explicitly choose A's version
    }
}
```

---

## Interface Method Summary

| Method Type | Modifier | Inherited? | Body? |
|---|---|---|---|
| Abstract | `public abstract` (implicit) | Yes (must implement) | No |
| Default | `public default` | Yes (may override) | Yes |
| Static | `public static` | No | Yes |
| Private | `private` | No | Yes |
| Private static | `private static` | No | Yes |

---

## References

- [Oracle Docs — Interfaces (Java Tutorial)](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html)
- [JEP 238 — Private Interface Methods (Java 9)](https://openjdk.org/jeps/238)
- OCP Study Guide, Chapter 6 — Class Design
