# Encapsulating Data with Records (Advanced)

> Records, finalized in **Java 16 (JEP 395)** and fully supported in Java 21, generate boilerplate automatically. This lesson covers the customisation points, generic records, interface implementation, and serialization behaviour tested on the OCP exam.

---

## The Canonical Constructor

The **canonical constructor** has one parameter for each record component, in declaration order. The compiler generates it automatically, but you can override it to add validation or normalization.

### Explicit canonical constructor

```java
public record Range(int min, int max) {
    public Range(int min, int max) {         // same signature as components
        if (min > max)
            throw new IllegalArgumentException(
                "min must be <= max, got: " + min + " > " + max);
        this.min = min;
        this.max = max;
    }
}
```

### Compact canonical constructor (preferred for validation)

The compact form omits the parameter list — the compiler fills in the assignments automatically after the body runs:

```java
public record Range(int min, int max) {
    public Range {                           // no parameter list
        if (min > max)
            throw new IllegalArgumentException(
                "min must be <= max, got: " + min + " > " + max);
        // min and max are assigned automatically after this block
    }
}
```

> In the compact form, the parameters are the component names (`min`, `max`) and you may reassign them before the implicit `this.min = min` step, for example to normalize data: `min = Math.max(0, min);`

---

## Custom Constructors

A record may define additional constructors, but they must delegate to the canonical constructor as their first statement:

```java
public record Point(double x, double y) {
    // Convenience constructor — origin
    public Point() {
        this(0.0, 0.0);    // delegates to canonical
    }
}
```

---

## Additional Methods

Records can define instance methods, static methods, and static fields. They **cannot** define instance fields beyond the declared components:

```java
public record Circle(double radius) {
    // Static constant — allowed
    public static final double PI = Math.PI;

    // Instance method
    public double area() {
        return PI * radius * radius;
    }

    // Static factory
    public static Circle unit() {
        return new Circle(1.0);
    }

    // Override the generated accessor
    @Override
    public double radius() {
        return Math.abs(radius); // normalize negative input
    }
}
```

---

## Generic Records

Records support type parameters, making them useful for generic data containers:

```java
public record Pair<A, B>(A first, B second) {
    public Pair<B, A> swap() {
        return new Pair<>(second, first);
    }
}

Pair<String, Integer> p = new Pair<>("hello", 42);
Pair<Integer, String> q = p.swap(); // (42, "hello")
```

```java
public record Result<T>(T value, String error) {
    public boolean isSuccess() { return error == null; }

    public static <T> Result<T> ok(T value) {
        return new Result<>(value, null);
    }

    public static <T> Result<T> fail(String error) {
        return new Result<>(null, error);
    }
}
```

---

## Records Implementing Interfaces

Records are `final` and already extend `java.lang.Record`, but they can implement any number of interfaces:

```java
public interface Printable {
    void print();
}

public interface Measurable {
    double measure();
}

public record Rectangle(double width, double height)
        implements Printable, Measurable {

    @Override
    public void print() {
        System.out.printf("Rectangle(%s x %s)%n", width, height);
    }

    @Override
    public double measure() {
        return width * height; // area
    }
}
```

Records also work seamlessly with sealed interfaces (see lesson 7-3):

```java
public sealed interface Shape permits Circle, Rectangle {}
public record Circle(double radius)      implements Shape {}
public record Rectangle(double w, double h) implements Shape {}
```

---

## Serialization

Records implement `java.io.Serializable` when you declare `implements Serializable`:

```java
public record Employee(String name, int id)
        implements java.io.Serializable {}
```

Serialization of records uses the canonical constructor for **deserialization** — meaning validation in the canonical constructor is always re-run when the record is read back. This is safer than class-based serialization, which can bypass constructors entirely.

| Behaviour | Regular class serialization | Record serialization |
|---|---|---|
| `serialVersionUID` | Recommended to declare explicitly | Not used — structural compatibility is checked differently |
| Object creation on read | Bypasses constructors | Always calls canonical constructor |
| Validation on read | Must use `readObject` | Automatic — canonical constructor runs |

---

## What You Cannot Do with Records

| Restriction | Reason |
|---|---|
| `extends AnotherClass` | Records already extend `java.lang.Record` |
| Declare instance fields outside components | All state must be captured in components |
| Make a record `abstract` | Records are implicitly `final` |
| Override `equals`, `hashCode`, `toString` with incompatible behaviour | Allowed technically but strongly discouraged |

---

## Key Rules to Remember

- The compact canonical constructor is the recommended way to add validation; assignments happen automatically after the block
- Additional constructors must delegate to the canonical constructor via `this(...)`
- Records can define instance methods, static methods, and static fields; no extra instance fields
- Generic records work exactly like generic classes
- Records implementing `Serializable` use the canonical constructor on deserialization — validation is enforced
- Records are `final` and cannot extend other classes, but can implement any interfaces

---

## References

- [JEP 395: Records](https://openjdk.org/jeps/395)
- [Oracle Docs — Records (Java 21)](https://docs.oracle.com/en/java/javase/21/language/records.html)
- [Record (Java 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Record.html)
