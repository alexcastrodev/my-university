# Applying Access Modifiers

> **OCP Exam Topic** — Understand the four access levels in Java — `private`, package-private (default), `protected`, and `public` — and where each permits access. Covered in Chapter 5 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## The Four Access Levels

Java provides four access modifiers that control which code can see a class, field, constructor, or method. From most restrictive to least restrictive:

| Modifier | Keyword | Accessible From |
|---|---|---|
| Private | `private` | Same class only |
| Package-private | *(no keyword)* | Same class + same package |
| Protected | `protected` | Same class + same package + subclasses |
| Public | `public` | Everywhere |

---

## Private Access

`private` members are visible only within the class in which they are declared. No other class — not even a subclass or a class in the same package — can access them directly.

```java
class BankAccount {
    private double balance;   // only BankAccount methods can read/write this

    private void validate() { }   // helper; not part of the public API
}

class Auditor {
    void check(BankAccount acct) {
        // compile error — balance is private
        // System.out.println(acct.balance);
    }
}
```

Use `private` for implementation details you want to hide from all external code.

---

## Package-Private (Default) Access

When no access modifier is written, the member has **package-private** access (also called *default access*). It is accessible to any class within the **same package** but invisible outside the package — even to subclasses in different packages.

```java
// com/example/reporting/Report.java
package com.example.reporting;

class Report {
    String title;     // package-private field

    void generate() { }  // package-private method
}

// com/example/reporting/Printer.java  (same package)
package com.example.reporting;

class Printer {
    void print(Report r) {
        System.out.println(r.title);   // OK — same package
        r.generate();                  // OK — same package
    }
}
```

```java
// com/other/Client.java  (different package)
package com.other;

import com.example.reporting.Report;  // compile error: Report is not public
```

---

## Protected Access

`protected` extends package-private access by also allowing **subclasses** to access the member, even if the subclass is in a different package. The access through the subclass reference must be to the subclass's own inherited version of the member.

```java
// com/example/shapes/Shape.java
package com.example.shapes;

public class Shape {
    protected int sides;

    protected void draw() {
        System.out.println("Drawing a shape");
    }
}

// com/example/graphics/Circle.java  (different package, but subclass)
package com.example.graphics;

import com.example.shapes.Shape;

public class Circle extends Shape {
    void render() {
        sides = 0;     // OK — inherited protected field, accessed via this
        draw();        // OK — inherited protected method
    }

    void inspect(Shape s) {
        // compile error — s is a Shape reference, not a Circle
        // s.sides = 0;
    }
}
```

The key distinction: a subclass in another package can access protected members through its own type, but **not** through a plain parent-type reference.

---

## Public Access

`public` members are accessible from **any class** in any package. They form the visible API of a class.

```java
public class Greeter {
    public String createGreeting(String name) {
        return "Hello, " + name + "!";
    }
}

// Anywhere in the application
Greeter g = new Greeter();
System.out.println(g.createGreeting("Alice"));  // Hello, Alice!
```

---

## Access Modifier Summary Table

| | Same Class | Same Package | Subclass (different package) | Other Package |
|---|:---:|:---:|:---:|:---:|
| `private` | Yes | No | No | No |
| package-private | Yes | Yes | No | No |
| `protected` | Yes | Yes | Yes* | No |
| `public` | Yes | Yes | Yes | Yes |

*Via the subclass's own inherited reference only.

---

## Applying Modifiers to Top-Level Classes

Top-level classes (not nested) may only be `public` or package-private. Using `private` or `protected` on a top-level class is a compile error.

```java
public class Visible { }       // OK — usable from other packages
class Hidden { }               // OK — usable only within this package
// private class Forbidden { } // compile error
```

---

## Key Points to Remember

- **`private`** — same class only; strongest restriction.
- **Package-private** (no keyword) — same class and same package; default when nothing is written.
- **`protected`** — same class, same package, and subclasses; a subclass in another package accesses through its own inherited reference, not through a parent-type variable.
- **`public`** — no restrictions; accessible everywhere.
- Top-level classes can only be `public` or package-private; `private` and `protected` are not valid for top-level classes.
