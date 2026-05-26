# Method Overriding and Polymorphism

---

## Method Overriding

A subclass provides its own implementation of an inherited method:

```java
public class Animal {
    public String sound() { return "..."; }
}

public class Dog extends Animal {
    @Override
    public String sound() { return "woof"; }
}

public class Cat extends Animal {
    @Override
    public String sound() { return "meow"; }
}
```

### Rules for Overriding

| Rule | Detail |
|------|--------|
| Signature | Must match exactly (name + parameter types) |
| Return type | Same type or a **covariant** (more specific) subtype |
| Access modifier | Same or **wider** (cannot reduce visibility) |
| Checked exceptions | Cannot declare new or broader checked exceptions |
| `static` methods | Cannot override — only **hide** |
| `private` methods | Cannot override — invisible to subclass |
| `final` methods | Cannot override |

```java
class Base {
    public Object getValue() { return "base"; }
}

class Sub extends Base {
    @Override
    public String getValue() { return "sub"; }  // covariant — String is an Object
}
```

---

## @Override Annotation

Always use `@Override` — it causes a compile error if the method does not actually override anything (catches typos):

```java
@Override
public String tostring() { }   // COMPILE ERROR — no such method in Object
```

---

## Polymorphism

The actual method called is determined at **runtime** by the object's real type, not the reference type:

```java
Animal a = new Dog();
System.out.println(a.sound());  // "woof" — Dog's implementation

Animal b = new Cat();
System.out.println(b.sound());  // "meow" — Cat's implementation
```

This is **dynamic dispatch** (virtual method invocation).

---

## Casting

```java
Animal a = new Dog();
Dog d = (Dog) a;       // explicit downcast — safe here
d.fetch();

Animal x = new Cat();
Dog d2 = (Dog) x;      // ClassCastException at runtime!
```

Use `instanceof` before downcasting:

```java
if (a instanceof Dog d) {
    d.fetch();   // pattern matching — no explicit cast needed
}
```

---

## Hiding vs Overriding

| | Instance method | Static method | Field |
|-|----------------|--------------|-------|
| Subclass redefinition | **Override** — runtime polymorphism | **Hide** — compile-time resolution | **Hide** — reference type decides |

```java
class Parent {
    static void greet() { System.out.println("Parent"); }
}
class Child extends Parent {
    static void greet() { System.out.println("Child"); }  // hides, does not override
}

Parent p = new Child();
p.greet();        // "Parent" — static, resolved by reference type
((Child) p).greet(); // "Child"
```

---

## Calling super

A subclass can invoke the overridden version:

```java
public class Dog extends Animal {
    @Override
    public String sound() {
        return super.sound() + " woof";   // calls Animal.sound()
    }
}
```

---

## Polymorphism with Abstract Classes and Interfaces

```java
List<Shape> shapes = List.of(new Circle(5), new Rectangle(3, 4));

for (Shape s : shapes) {
    System.out.println(s.area());  // Circle.area() or Rectangle.area() at runtime
}
```

The reference type (`Shape`) determines which methods are available at compile time; the object type determines which implementation runs.
