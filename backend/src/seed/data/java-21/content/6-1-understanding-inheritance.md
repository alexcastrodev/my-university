# Understanding Inheritance

> Inheritance lets one class acquire the fields and methods of another, enabling code reuse and establishing a type hierarchy that the rest of the language — casting, polymorphism, and pattern matching — depends on.

---

## The IS-A Relationship

Inheritance models an **IS-A** relationship: a `Dog` IS-A `Animal`, a `Savings­Account` IS-A `BankAccount`. This relationship is expressed with the `extends` keyword.

```java
public class Animal {
    private String name;

    public Animal(String name) { this.name = name; }

    public String getName() { return name; }

    public void breathe() { System.out.println("Breathing..."); }
}

public class Dog extends Animal {
    public Dog(String name) { super(name); }

    public void fetch() { System.out.println(getName() + " fetches!"); }
}
```

A `Dog` object can be assigned to an `Animal` reference because every `Dog` IS-A `Animal`:

```java
Animal a = new Dog("Rex");   // valid — IS-A holds
a.breathe();                 // inherited method
```

---

## The `extends` Keyword and Single Inheritance

Java supports **single class inheritance**: a class can extend exactly one direct superclass. Attempting to extend two classes is a compile-time error.

```java
public class A {}
public class B {}

// ERROR: cannot extend multiple classes
public class C extends A, B {}  // compile-time error
```

This limitation avoids the "diamond problem" found in languages with multiple class inheritance. Java resolves the need for multiple behavior sources through *interfaces* (covered in lesson 6-4).

---

## `java.lang.Object` as the Root

Every class that does not explicitly extend another class implicitly extends `java.lang.Object`. This means every Java object inherits core methods:

| Method | Description |
|---|---|
| `toString()` | String representation (default: class name + hash) |
| `equals(Object)` | Object identity by default |
| `hashCode()` | Hash consistent with `equals` |
| `getClass()` | Runtime class of the object |
| `clone()` | Shallow copy (protected) |
| `finalize()` | Deprecated cleanup hook |

```java
public class Point {
    int x, y;
    // implicitly: extends Object
}

Point p = new Point();
System.out.println(p.toString());   // Point@1b6d3586 (default)
System.out.println(p.getClass());   // class Point
```

---

## What Members Are Inherited?

A subclass inherits all **accessible** members of its superclass:

| Member | Inherited? |
|---|---|
| `public` fields and methods | Yes |
| `protected` fields and methods | Yes |
| Package-private (no modifier) | Yes, if same package |
| `private` fields and methods | No — not directly accessible |
| `static` members | Inherited (accessible via subclass name), but not overridden |
| Constructors | No — constructors are never inherited |

```java
public class Vehicle {
    public int speed;
    protected String brand;
    private int serialNumber;   // not accessible in subclass

    public void accelerate() { speed += 10; }
}

public class Car extends Vehicle {
    public void turbo() {
        speed += 50;            // OK — public
        brand = "FastCo";       // OK — protected
        // serialNumber = 1;    // ERROR — private
    }
}
```

---

## Hiding vs. Overriding

These two terms describe what happens when a subclass declares a member with the same signature as a superclass member.

**Overriding** applies to **instance methods**: the subclass version replaces the superclass version for any call made through a reference of the subclass type (dynamic dispatch).

**Hiding** applies to **static methods** and **fields**: the subclass declaration hides the superclass member, but the version called depends on the *reference type*, not the object type (static dispatch).

```java
public class Parent {
    public static void staticMethod() { System.out.println("Parent static"); }
    public void instanceMethod()      { System.out.println("Parent instance"); }
}

public class Child extends Parent {
    public static void staticMethod() { System.out.println("Child static"); }  // HIDES
    @Override
    public void instanceMethod()      { System.out.println("Child instance"); } // OVERRIDES
}

Parent ref = new Child();
ref.staticMethod();    // "Parent static"  — reference type decides (hiding)
ref.instanceMethod();  // "Child instance" — object type decides (overriding)
```

> **Exam tip:** Hidden static methods are resolved at compile time based on the declared reference type. Overridden instance methods are resolved at runtime based on the actual object type.

---

## Key Rules Summary

- Use `extends` for class inheritance; only one superclass allowed.
- All classes ultimately extend `Object`.
- `private` members are not accessible in subclasses (though they are technically inherited storage).
- Static methods are *hidden*, not overridden; instance methods are *overridden*.
- The `@Override` annotation is optional but strongly recommended — the compiler will error if no matching superclass method exists.

---

## References

- [Oracle Docs — Inheritance (Java Tutorial)](https://docs.oracle.com/javase/tutorial/java/IandI/subclasses.html)
- OCP Study Guide, Chapter 6 — Class Design
