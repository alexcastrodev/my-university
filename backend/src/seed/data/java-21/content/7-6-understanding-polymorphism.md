# Understanding Polymorphism

> Polymorphism — "many forms" — is the mechanism by which a single reference type can refer to objects of different concrete types, and method calls resolve to the correct implementation at runtime. It underpins every flexible, extensible Java design.

---

## Reference Type vs Object Type

In Java these two concepts are independent:

```java
Animal a = new Dog(); // reference type: Animal | object type: Dog
```

| Concept | Determined at | Governs |
|---|---|---|
| **Reference type** | Compile time | Which members are visible / callable |
| **Object type** (runtime type) | Runtime | Which method body actually executes |

```java
class Animal {
    public String speak() { return "..."; }
    public String breathe() { return "oxygen"; }
}

class Dog extends Animal {
    @Override
    public String speak() { return "Woof"; }
    public String fetch()  { return "ball"; }
}

Animal a = new Dog();
a.speak();   // "Woof" — runtime dispatch to Dog.speak()
a.breathe(); // "oxygen" — Animal.breathe(), not overridden
// a.fetch(); // Compile error — fetch() not on Animal reference
```

---

## Virtual Method Dispatch

Java uses **virtual dispatch** for every non-`static`, non-`private`, non-`final` instance method. The JVM looks up the method in the actual object's class at runtime:

```java
class Shape {
    public double area() { return 0; }
}

class Circle extends Shape {
    private final double radius;
    Circle(double r) { this.radius = r; }

    @Override
    public double area() { return Math.PI * radius * radius; }
}

class Square extends Shape {
    private final double side;
    Square(double s) { this.side = s; }

    @Override
    public double area() { return side * side; }
}

List<Shape> shapes = List.of(new Circle(3), new Square(4));
for (Shape s : shapes) {
    System.out.println(s.area()); // dispatches to Circle or Square at runtime
}
// 28.274... then 16.0
```

**What is NOT virtual:**
- `static` methods — resolved by reference type at compile time (hiding, not overriding)
- `private` methods — not part of the polymorphic contract
- Fields — always resolved by reference type (field hiding)

---

## Casting

A **widening cast** (subtype → supertype) is implicit and always safe:

```java
Dog d = new Dog();
Animal a = d;      // widening — no cast syntax needed
```

A **narrowing cast** (supertype → subtype) requires explicit syntax and may throw `ClassCastException` at runtime:

```java
Animal a = new Dog();
Dog d    = (Dog) a;     // OK — runtime type is actually Dog

Animal a2 = new Cat();
Dog d2    = (Dog) a2;   // ClassCastException at runtime!
```

The compiler checks that the cast is at least possible given the reference types. It does **not** guarantee success at runtime.

---

## instanceof Before Casting

Always guard a narrowing cast with `instanceof` to prevent `ClassCastException`:

### Traditional guard

```java
if (a instanceof Dog) {
    Dog d = (Dog) a;
    d.fetch();
}
```

### Pattern matching (Java 16+, finalized in Java 21)

```java
if (a instanceof Dog d) {
    d.fetch(); // d is bound and already of type Dog
}
```

Pattern matching eliminates the explicit cast and the possibility of a stale type name mismatch.

---

## ClassCastException

`ClassCastException` is an unchecked exception thrown when an illegal narrowing cast is attempted at runtime:

```java
Object obj = Integer.valueOf(42);
String s = (String) obj; // ClassCastException: Integer cannot be cast to String
```

Common causes on the OCP exam:

```java
// 1. Unrelated types
Number n = new Integer(1);
String s = (String) n;  // ClassCastException

// 2. Sibling types through a common parent
Animal a = new Cat();
Dog d = (Dog) a;        // ClassCastException — Cat is not a Dog

// 3. Stored as a wider type, cast to wrong narrower type
List<Object> list = new ArrayList<>();
list.add("hello");
list.add(42);
String s = (String) list.get(1); // ClassCastException — element is Integer
```

---

## Duck Typing via Interfaces

Java uses **nominal typing** — a type must explicitly declare that it implements an interface. However, using interface references achieves the same decoupling that duck typing provides in dynamic languages: callers depend on the interface, not the concrete class.

```java
public interface Flyable {
    void fly();
}

class Bird implements Flyable {
    @Override public void fly() { System.out.println("Bird flying"); }
}

class Airplane implements Flyable {
    @Override public void fly() { System.out.println("Airplane flying"); }
}

class Drone implements Flyable {
    @Override public void fly() { System.out.println("Drone flying"); }
}

static void takeOff(Flyable f) {
    f.fly(); // works for any Flyable — the exact type does not matter
}

takeOff(new Bird());
takeOff(new Airplane());
takeOff(new Drone());
```

The method `takeOff` does not know or care what concrete type `f` is — it only knows `f` can `fly()`. This is the core benefit of programming to an interface.

---

## Polymorphism and Overloading vs Overriding

These two concepts are frequently confused on the exam:

| | Overriding | Overloading |
|---|---|---|
| Determined at | Runtime | Compile time |
| Signature | Same name, same parameter types | Same name, different parameter types |
| Return type | Same (or covariant) | Can differ |
| Annotation | `@Override` | Not applicable |
| Dispatch mechanism | Virtual dispatch | Static resolution |

```java
class Printer {
    void print(Animal a)  { System.out.println("Animal"); }  // overload 1
    void print(Dog d)     { System.out.println("Dog"); }     // overload 2
}

Animal a = new Dog();
new Printer().print(a); // "Animal" — overload resolved at compile time by reference type
```

The overload is chosen based on the **reference type** (`Animal`), even though the object is a `Dog`.

---

## Key Rules to Remember

- Virtual dispatch resolves method bodies at **runtime** based on the object type
- Fields and `static` methods are resolved at **compile time** based on the reference type
- Widening casts are implicit and safe; narrowing casts require explicit syntax and can throw `ClassCastException`
- Always use `instanceof` (preferably with pattern matching) before narrowing
- Programming to interfaces enables polymorphism without tight coupling to concrete classes
- Overloading resolution is compile-time (reference type wins); overriding resolution is runtime (object type wins)

---

## References

- [Oracle Tutorial — Polymorphism](https://docs.oracle.com/javase/tutorial/java/IandI/polymorphism.html)
- [ClassCastException (Java 21 API)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/ClassCastException.html)
- [JEP 394: Pattern Matching for instanceof](https://openjdk.org/jeps/394)
