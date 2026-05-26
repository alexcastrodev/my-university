# Applying the static Keyword

> **OCP Exam Topic** — Understand static fields, static methods, static initializer blocks, and static imports. Covered in Chapter 5 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What static Means

The `static` keyword marks a member as belonging to the **class itself** rather than to any individual instance. Static members are shared across all instances and exist for the lifetime of the class.

---

## Static Fields

A static field is a single variable shared by all instances of the class.

```java
public class Counter {
    private static int count = 0;   // one copy, shared by all instances

    public Counter() {
        count++;
    }

    public static int getCount() {
        return count;
    }
}

Counter a = new Counter();
Counter b = new Counter();
Counter c = new Counter();
System.out.println(Counter.getCount()); // 3
```

Because `count` is static, every `new Counter()` increments the same variable regardless of which instance is created.

---

## Static Methods

Static methods belong to the class, not to an instance. They are called on the class name and cannot use instance fields or the `this` keyword.

```java
public class MathHelper {
    public static int square(int n) {
        return n * n;
    }
}

System.out.println(MathHelper.square(5)); // 25
```

**Rules for static methods:**
- They can access only other static members directly.
- They cannot access instance fields or call instance methods without an object reference.
- They cannot use `this` or `super`.

```java
public class Example {
    private int instanceVal = 10;
    private static int staticVal = 20;

    public static void show() {
        System.out.println(staticVal);   // OK
        // System.out.println(instanceVal); // compile error
    }
}
```

---

## Static Initializer Blocks

A static initializer block runs **once** when the class is first loaded by the JVM. It is useful for complex initialization of static fields that cannot be done with a simple assignment.

```java
public class Config {
    public static final String DEFAULT_HOST;
    public static final int DEFAULT_PORT;

    static {
        DEFAULT_HOST = System.getProperty("app.host", "localhost");
        DEFAULT_PORT = Integer.parseInt(System.getProperty("app.port", "8080"));
        System.out.println("Config initialized");
    }
}
```

Multiple static blocks in the same class execute top to bottom in declaration order.

---

## Accessing Static Members via Class Name

The correct way to call a static member is through the **class name**:

```java
Math.abs(-5);          // correct
Math.PI;               // correct
```

Java permits calling static members via an instance reference, but this is misleading because the instance is irrelevant — the compiler resolves it to the class anyway.

```java
Counter c = new Counter();
c.getCount();           // compiles, but misleading — avoid this
Counter.getCount();     // preferred — makes static nature clear
```

On the OCP exam, watch for code that calls a static method on a `null` reference — this does **not** throw a `NullPointerException` because no instance is involved:

```java
Counter c = null;
System.out.println(c.getCount()); // compiles and runs — prints the static value
```

---

## Static Imports

The `import static` statement imports individual static members or all static members of a class so they can be used without the class name qualifier.

```java
import static java.lang.Math.PI;
import static java.lang.Math.sqrt;

public class Circle {
    public double area(double radius) {
        return PI * radius * radius;
    }

    public double hypotenuse(double a, double b) {
        return sqrt(a * a + b * b);
    }
}
```

Importing all static members with a wildcard:

```java
import static java.lang.Math.*;

double result = pow(2, 10); // no Math. prefix needed
```

**Caution:** static imports that shadow other names or create ambiguity are a compile error. Prefer importing specific members over using wildcards in production code.

---

## Common Pitfalls

| Pitfall | Explanation |
|---|---|
| Calling static via instance reference | Compiles but hides the static nature; avoid it |
| Using `this` in a static method | Compile error — no instance context |
| Accessing instance field in static method | Compile error — static method has no `this` |
| Ambiguous static import | Compile error when two imported classes have the same static member name |

---

## Key Points to Remember

- `static` members belong to the **class**, not to instances; they are shared across all objects.
- Static methods cannot access instance fields or use `this`/`super` without an object reference.
- Static initializer blocks run once when the class is loaded; multiple blocks execute in order.
- Access static members through the **class name**, not an instance reference.
- `import static` lets you use static members without the class name prefix; wildcards are allowed but can create ambiguity.
- Calling a static method via a `null` reference does not throw `NullPointerException`.
