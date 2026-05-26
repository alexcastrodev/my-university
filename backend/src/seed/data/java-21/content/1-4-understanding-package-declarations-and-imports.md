# Understanding Package Declarations and Imports

> **OCP Exam Topic** — Understand how packages organise classes and how `import` statements make them accessible. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Package?

A **package** is a namespace that groups related classes and interfaces. Packages serve two purposes:

1. **Organisation** — related types live together (`java.util`, `java.io`, etc.)
2. **Access control** — package-private members are accessible only within the same package

Package names use lowercase letters and follow a reverse-domain convention:

```
com.example.myapp
org.springframework.core
java.util
```

---

## The package Statement

If a class belongs to a package, the `package` statement must be the **first non-comment line** in the file:

```java
package com.example.animals;

public class Dog {
    public void bark() {
        System.out.println("Woof!");
    }
}
```

Rules:

- There can be **at most one** `package` statement per file.
- If omitted, the class belongs to the **unnamed (default) package**.
- The directory structure must mirror the package name: `com/example/animals/Dog.java`.

### Unnamed Package

Classes without a package declaration belong to the unnamed default package. They cannot be imported by classes in named packages. The OCP exam typically avoids the default package in multi-class examples.

---

## The import Statement

To use a class from another package, you either use its **fully qualified name** or import it:

```java
// Option 1: fully qualified name every time
java.util.ArrayList<String> list = new java.util.ArrayList<>();

// Option 2: import once, use the simple name
import java.util.ArrayList;

ArrayList<String> list = new ArrayList<>();
```

Import statements go **after** the `package` statement and **before** the class declaration.

---

## Wildcard Imports

A wildcard `*` imports all **top-level** classes in a package:

```java
import java.util.*;   // imports ArrayList, HashMap, List, etc.
```

Important restrictions:

- The wildcard imports only classes **directly** in that package — it does **not** import sub-packages.
- `import java.util.*` does **not** import `java.util.concurrent.CopyOnWriteArrayList`.
- Wildcard imports do **not** slow down execution; the compiler resolves them at compile time.
- You cannot use `import java.*;` to import everything under `java`.

---

## Automatic Imports

Two things are always available without an explicit import:

1. **`java.lang`** — `String`, `System`, `Math`, `Object`, `Integer`, etc. are always implicitly imported.
2. **Classes in the same package** — no import needed for classes in the same package.

```java
// No import needed — String and System are in java.lang
public class Greeting {
    public static void main(String[] args) {
        String message = "Hello";
        System.out.println(message);
    }
}
```

---

## Naming Conflicts

When two packages contain a class with the same simple name, you must disambiguate:

```java
import java.util.Date;
import java.sql.Date;   // compile error — both are named Date
```

Resolution strategies:

```java
// Option 1: import one and use the fully qualified name for the other
import java.util.Date;

Date d1 = new Date();                     // java.util.Date
java.sql.Date d2 = new java.sql.Date(0);  // fully qualified

// Option 2: use fully qualified names for both (no imports)
java.util.Date d1 = new java.util.Date();
java.sql.Date d2 = new java.sql.Date(0);
```

The OCP exam frequently tests this scenario. Remember: **explicit import wins over wildcard**, but **two explicit imports of the same simple name is always a compile error**.

---

## Static Imports

`import static` allows you to import static members (fields and methods) so they can be used without the class name:

```java
import static java.lang.Math.PI;
import static java.lang.Math.sqrt;

double circumference = 2 * PI * radius;
double hypotenuse    = sqrt(a * a + b * b);
```

Wildcard static import is also valid:

```java
import static java.lang.Math.*;
```

---

## Order of Top-Level Elements

The exam tests that you know the required order:

```java
package com.example;          // 1. package (optional, at most one)

import java.util.List;        // 2. import statements (optional, any number)
import java.util.ArrayList;

public class MyClass {        // 3. class declaration
    // ...
}
```

Placing a `package` statement after an `import`, or an `import` inside a class body, is a **compile error**.

---

## Key Points to Remember

- The `package` statement is first; `import` statements are second; the class declaration is third.
- Classes without a `package` statement belong to the unnamed default package.
- Wildcard `*` imports all top-level classes in a package but **not** sub-packages.
- `java.lang` is always imported automatically.
- Classes in the same package do not need an import statement.
- Two explicit imports for the same simple name from different packages is a compile error — use a fully qualified name for one of them.
- `import static` brings static members into scope without requiring the class name.
