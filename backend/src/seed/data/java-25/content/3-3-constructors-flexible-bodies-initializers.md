---
version: 1.0
updatedAt: 2026-05-26
---
# Constructors, Flexible Constructor Bodies, and Initializers

---

## Constructors

A constructor initialises a new object. It has the same name as the class and no return type:

```java
public class Dog {
    private String name;
    private int age;

    public Dog(String name, int age) {
        this.name = name;
        this.age  = age;
    }
}
```

If no constructor is declared, the compiler provides a **default no-arg constructor** — but only if no other constructor exists.

---

## Constructor Chaining with this()

One constructor can call another in the same class using `this(...)`. It must be the **first statement**:

```java
public class Dog {
    private String name;
    private int age;

    public Dog(String name) {
        this(name, 0);          // delegates to the two-arg constructor
    }

    public Dog(String name, int age) {
        this.name = name;
        this.age  = age;
    }
}
```

---

## Constructor Chaining with super()

A subclass constructor calls the parent constructor with `super(...)`. It must also be the **first statement**:

```java
public class Animal {
    private String species;
    public Animal(String species) { this.species = species; }
}

public class Dog extends Animal {
    private String name;

    public Dog(String name) {
        super("Canis lupus");   // must be first
        this.name = name;
    }
}
```

If `super()` is not written explicitly, the compiler inserts a call to the no-arg parent constructor. If the parent has no no-arg constructor, a compile error results.

---

## Flexible Constructor Bodies (Java 22+, finalized Java 25)

**JEP 492** — Before the explicit `super()` or `this()` call, statements that do not access the instance being created are now allowed. This enables validation and pre-computation:

```java
public class PositiveNumber {
    private final int value;

    public PositiveNumber(int value) {
        if (value <= 0) throw new IllegalArgumentException("Must be positive");
        super();                // super() is still called, just not first in source
        this.value = value;
    }
}
```

> **Key rule:** Code before `super()`/`this()` must not reference `this` or instance members.

---

## Instance Initializers

A block of code outside any method, executed before the constructor body:

```java
public class Sample {
    private List<String> items;

    {   // instance initializer — runs for every constructor
        items = new ArrayList<>();
        items.add("default");
    }

    public Sample() { }
    public Sample(String extra) { items.add(extra); }
}
```

Execution order per object creation:
1. Static initializers (first time the class loads)
2. Instance initializers (top to bottom)
3. Constructor body

---

## Static Initializers

Run once when the class is first loaded:

```java
public class Config {
    public static final Map<String, String> DEFAULTS;

    static {
        DEFAULTS = new HashMap<>();
        DEFAULTS.put("timeout", "30");
        DEFAULTS.put("retries", "3");
    }
}
```

---

## Execution Order Summary

```java
public class Parent {
    static { System.out.println("Parent static"); }
    { System.out.println("Parent instance"); }
    Parent() { System.out.println("Parent constructor"); }
}

public class Child extends Parent {
    static { System.out.println("Child static"); }
    { System.out.println("Child instance"); }
    Child() { System.out.println("Child constructor"); }
}

new Child();
// Output:
// Parent static
// Child static
// Parent instance
// Parent constructor
// Child instance
// Child constructor
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| `this()` / `super()` | Must be the first statement (pre-JEP 492) |
| Flexible bodies | Statements before `super()`/`this()` cannot touch `this` |
| Default constructor | Added only when no constructor is declared |
| Static initializer | Runs once at class load time |
| Instance initializer | Runs before every constructor body |
