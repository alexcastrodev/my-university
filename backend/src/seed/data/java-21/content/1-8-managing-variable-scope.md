# Managing Variable Scope

> **OCP Exam Topic** — Understand local scope (method/block), instance scope, and class (static) scope. Know the rules for shadowing and when a variable is accessible. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What is Scope?

**Scope** defines the region of code where a variable is accessible. Once execution leaves that region, the variable is no longer reachable and (for locals) eligible to be reclaimed.

Java has three main scopes:

| Scope | Where Declared | Accessible From |
|---|---|---|
| **Local** | Method body, constructor, or block | Only within that method/block, from the declaration point to the closing `}` |
| **Instance** | Class body, no `static` modifier | Any non-static method or block within the class (via `this`), and externally per access modifier |
| **Class (static)** | Class body, with `static` modifier | Any method within the class (including static methods), and externally per access modifier |

---

## Local Scope

A local variable comes into existence when its declaration is executed and ceases to exist when the enclosing block ends.

```java
void greet() {
    String message = "Hello";    // message is in scope from here...
    System.out.println(message);
}                                // ...until here — message is gone
// System.out.println(message); // compile error — not in scope
```

**Block scope** works the same way inside `if`, `for`, `while`, and `try` blocks:

```java
if (true) {
    int x = 10;
    System.out.println(x); // fine
}
// System.out.println(x);  // compile error — x out of scope
```

A variable declared in the initializer of a `for` loop is scoped to the loop (header + body):

```java
for (int i = 0; i < 5; i++) {
    System.out.println(i);
}
// System.out.println(i);  // compile error
```

---

## Instance Scope

Instance variables are declared directly inside a class but outside any method. They exist for the lifetime of the object and are accessible from any instance method using their name (or `this.name` to disambiguate):

```java
public class Rectangle {
    int width;    // instance variable
    int height;   // instance variable

    int area() {
        return width * height;   // accessed without qualifier — same instance
    }

    void setWidth(int width) {
        this.width = width;      // this.width = instance variable; width = local parameter
    }
}
```

---

## Class (Static) Scope

Static variables are shared across all instances. They are accessible from static and instance methods alike:

```java
public class AppConfig {
    static String environment = "production";  // class variable

    static void printEnv() {
        System.out.println(environment);       // direct access in static context
    }

    void show() {
        System.out.println(environment);       // also accessible from instance methods
    }
}
```

> Static methods cannot access instance variables or call instance methods directly — there is no implicit `this`.

---

## Scope Rules in Nested Blocks

Variables declared in an outer block are accessible in inner blocks. Variables declared in an inner block are not accessible in the outer block.

```java
void example() {
    int outer = 1;

    {
        int inner = 2;
        System.out.println(outer);  // fine — outer is in scope
        System.out.println(inner);  // fine
    }

    System.out.println(outer);      // fine — still in scope
    // System.out.println(inner);   // compile error — inner is out of scope
}
```

---

## Shadowing

**Shadowing** occurs when a local variable (or parameter) has the same name as an instance variable. The local variable hides (shadows) the instance variable within its scope.

```java
public class Circle {
    double radius = 5.0;    // instance variable

    void setRadius(double radius) {        // parameter shadows instance variable
        System.out.println(radius);        // prints the parameter, not 5.0
        System.out.println(this.radius);   // this.radius accesses the instance variable
        this.radius = radius;              // assigns parameter to instance variable
    }
}
```

A local variable **cannot shadow another local variable** in the same method — you cannot redeclare a variable that is already in scope:

```java
void example() {
    int x = 1;
    // int x = 2;  // compile error — x already declared in this scope
}
```

However, a variable in an inner block can shadow a variable in an outer block in some languages; in Java this is a **compile error for local variables**:

```java
void example() {
    int x = 1;
    {
        // int x = 2;  // compile error — x already visible in enclosing scope
    }
}
```

---

## Scope and Method Parameters

Method parameters follow the same local scope rules. They are in scope for the entire method body and cannot be redeclared inside the method:

```java
void process(String value) {      // value is a local parameter
    System.out.println(value);
    // String value = "other";    // compile error — already declared
}
```

---

## Summary Table

```java
public class ScopeDemo {
    static int classVar = 10;     // class scope — accessible from any method
    int instanceVar = 20;         // instance scope — accessible from instance methods

    void method(int param) {       // param: local scope (whole method)
        int localVar = 30;         // local scope (from declaration to closing })

        if (localVar > 0) {
            int blockVar = 40;     // local scope (only inside this if block)
            System.out.println(classVar);    // ok
            System.out.println(instanceVar); // ok
            System.out.println(param);       // ok
            System.out.println(localVar);    // ok
            System.out.println(blockVar);    // ok
        }
        // blockVar not accessible here
    }

    static void staticMethod() {
        System.out.println(classVar);     // ok — static context can access static vars
        // System.out.println(instanceVar); // compile error — no instance available
    }
}
```

---

## Key Points to Remember

- Local variables are in scope from their declaration to the closing `}` of the block they were declared in.
- Instance variables are in scope throughout instance methods; use `this.` to distinguish them from shadowing locals.
- Static variables are in scope throughout the class; static methods cannot access instance variables.
- Java does **not** allow a local variable to shadow another local variable in the same or an enclosing local scope — this is a compile error.
- Parameters are local variables scoped to the entire method body.

---

## References

- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 1
- [Java Language Specification §6.3 — Scope of a Declaration](https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.3)
