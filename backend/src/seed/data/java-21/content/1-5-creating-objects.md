# Creating Objects

> **OCP Exam Topic** — Understand how to instantiate objects using constructors, how reference variables work, and what `null` means. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## The new Keyword

Objects are created with the `new` keyword, which:

1. Allocates memory on the **heap** for the new object.
2. Calls a **constructor** to initialise the object's state.
3. Returns a **reference** to the object.

```java
Animal a = new Animal();
//     ^       ^
//     |       constructor call
//     reference variable (lives on stack)
```

---

## Constructors

A constructor has the same name as the class and **no return type**. It runs automatically when `new` is used.

```java
public class Animal {
    String name;
    int age;

    // No-argument constructor
    public Animal() {
        name = "Unknown";
        age  = 0;
    }

    // Parameterised constructor
    public Animal(String name, int age) {
        this.name = name;
        this.age  = age;
    }
}
```

```java
Animal a1 = new Animal();            // calls no-arg constructor
Animal a2 = new Animal("Rex", 3);   // calls parameterised constructor
```

### Default Constructor

If you declare **no constructor at all**, the compiler provides a **default no-argument constructor**:

```java
public class Box { }

// Compiler generates:
// public Box() { }

Box b = new Box();  // valid
```

Once you declare any constructor, the compiler no longer provides the default. Calling `new Box()` when only a parameterised constructor exists is a compile error.

---

## The this Reference

Inside a constructor or method, `this` refers to the **current object**:

```java
public class Point {
    int x;
    int y;

    public Point(int x, int y) {
        this.x = x;   // field = parameter
        this.y = y;
    }
}
```

`this` is needed when a parameter name shadows a field name. Without `this`, the assignment would be `x = x` (parameter to itself — useless).

### Constructor Chaining with this()

One constructor can call another constructor in the same class using `this(...)`. It must be the **first statement** in the constructor body:

```java
public class Animal {
    String name;
    int age;

    public Animal(String name) {
        this(name, 0);   // calls Animal(String, int)
    }

    public Animal(String name, int age) {
        this.name = name;
        this.age  = age;
    }
}
```

---

## Reference Variables

A **reference variable** stores the memory address of an object, not the object itself. Multiple reference variables can point to the same object:

```java
Animal a = new Animal("Rex", 3);
Animal b = a;          // b and a point to the SAME object

b.name = "Buddy";
System.out.println(a.name);  // prints "Buddy" — same object
```

This is different from primitive variables, which store their value directly.

---

## null

`null` is a special literal that means a reference variable points to **no object**:

```java
Animal a = null;   // a holds no reference

// Calling a method on null throws NullPointerException
a.bark();          // NullPointerException at runtime
```

### null and Default Values

Object fields (reference types) default to `null` if not explicitly assigned:

```java
public class Person {
    String name;   // defaults to null
    int age;       // defaults to 0
}
```

Local variables have **no default** — using an unassigned local variable is a compile error.

---

## Object Identity vs Equality

Two references can point to objects that have the same content but are separate instances:

```java
Animal a1 = new Animal("Rex", 3);
Animal a2 = new Animal("Rex", 3);

System.out.println(a1 == a2);       // false — different objects (different addresses)
System.out.println(a1.equals(a2));  // depends on equals() implementation
```

`==` on reference types checks **identity** (same object). `.equals()` checks logical **equality** (same content, if overridden).

---

## Object Initialisation Order

When `new` is used, initialisation happens in this order:

1. Fields receive their **default values** (`null`, `0`, `false`, etc.)
2. **Field initialisers** run (e.g., `int x = 5;`)
3. The **constructor body** runs

```java
public class Counter {
    int count = 10;   // field initialiser — runs before constructor body

    public Counter() {
        System.out.println(count);   // prints 10
        count = 20;
    }
}
```

---

## Key Points to Remember

- `new` allocates heap memory, calls a constructor, and returns a reference.
- If no constructor is declared, the compiler provides a default no-arg constructor.
- Once any constructor is declared, the default no-arg constructor is **not** provided.
- `this` refers to the current object; `this(...)` chains to another constructor and must be the first statement.
- A reference variable holds an address, not the object itself — multiple references can share one object.
- `null` means no object; calling a method on `null` throws `NullPointerException`.
- `==` compares references (identity); `.equals()` compares content.
