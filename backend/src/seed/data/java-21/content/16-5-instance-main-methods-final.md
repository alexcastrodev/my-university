# Instance main Methods — Now Final (JEP 495)

> Java has always required `public static void main(String[] args)` as the program entry point. JEP 495, finalized in Java 25, enables simpler launch protocols: instance `main()` methods, static `main()` without `String[]`, and other reduced-ceremony variants. This lesson covers all valid forms and the selection priority order.

---

## The Java 21 Entry Point

In Java 21, the only valid program entry point was the traditional signature:

```java
// Java 21 — only valid form
public class App {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

All four modifiers — `public`, `static`, `void`, and `String[]` — were mandatory. Any deviation caused the JVM to throw an error at launch.

---

## Java 25: Simplified Entry Points (JEP 495)

Java 25 finalizes a **selection protocol** with multiple valid `main` forms. The JVM looks for a `main` method in the launched class and selects the "best" match according to a priority order.

### Valid Entry Point Forms (in priority order)

```java
// Priority 1 (highest): Traditional — static, public, with String[]
public static void main(String[] args) { ... }

// Priority 2: static, with String[], but not public
static void main(String[] args) { ... }

// Priority 3: static, public, without String[]
public static void main() { ... }

// Priority 4: static, without public or String[]
static void main() { ... }

// Priority 5: instance (non-static), public, with String[]
public void main(String[] args) { ... }

// Priority 6: instance, with String[], not public
void main(String[] args) { ... }

// Priority 7: instance, public, without String[]
public void main() { ... }

// Priority 8 (lowest priority): instance, not public, without String[]
void main() { ... }
```

The JVM selects the **highest-priority** `main` it finds. If multiple forms are present, the one with the highest priority wins.

---

## Example: Instance main

```java
// Java 25 — instance main, no String[] required
class Greeter {
    String greeting = "Hello";

    void main() {
        System.out.println(greeting + " from an instance main!");
    }
}
```

```sh
java Greeter.java   // Java 25 launches this using the instance main
```

When an instance `main()` is used, the JVM automatically instantiates the class using its **no-arg constructor** (explicit or implicit) before calling `main()`.

```java
class Server {
    int port;

    Server() {
        this.port = 8080;  // constructor runs before main()
    }

    void main() {
        System.out.println("Starting on port " + port);
    }
}
```

---

## Example: Static main Without `String[]`

```java
// Java 25 — static, no String[] needed
public class Config {
    public static void main() {
        System.out.println("Configuring...");
    }
}
```

---

## Example: Priority Wins

When multiple forms coexist, the highest-priority one is selected:

```java
// Java 25 — both forms present; priority 1 wins
public class MultiMain {
    public static void main(String[] args) {   // priority 1 — selected
        System.out.println("Traditional main");
    }

    void main() {                               // priority 8 — ignored
        System.out.println("Instance main");
    }
}
```

> **Exam tip:** The traditional `public static void main(String[] args)` has the highest priority and always wins when present. Simplified forms are only used when the traditional form is absent.

---

## `args` in Instance Main

When an instance `main` takes `String[] args`, the command-line arguments are passed:

```java
class Echo {
    void main(String[] args) {
        for (String arg : args) {
            System.out.println(arg);
        }
    }
}
```

```sh
java Echo.java hello world
# Output:
# hello
# world
```

When `main()` has no `String[]` parameter, command-line arguments are simply not passed to the method (they are still available via system properties if needed).

---

## Interaction with Implicit Classes (JEP 512)

Instance main methods are the natural entry point for **implicit classes** (compact source files). The synthesized implicit class uses `void main()` or `void main(String[])`:

```java
// Compact.java — implicit class with instance main
void main() {
    System.out.println("No class declaration, no static, no String[]");
}
```

```sh
java Compact.java
```

---

## Summary of All Valid Forms

| Form | Static | Public | Has args | Priority |
|---|---|---|---|---|
| `public static void main(String[] args)` | Yes | Yes | Yes | 1 (highest) |
| `static void main(String[] args)` | Yes | No | Yes | 2 |
| `public static void main()` | Yes | Yes | No | 3 |
| `static void main()` | Yes | No | No | 4 |
| `public void main(String[] args)` | No | Yes | Yes | 5 |
| `void main(String[] args)` | No | No | Yes | 6 |
| `public void main()` | No | Yes | No | 7 |
| `void main()` | No | No | No | 8 (lowest) |

---

## Key Rules Summary

- Java 25 (JEP 495) finalizes support for eight valid `main` entry point forms.
- The traditional `public static void main(String[] args)` has highest priority and always wins when present.
- Instance `main()` methods require the class to have a no-arg constructor — the JVM instantiates the class before calling `main()`.
- Without `String[]`, command-line arguments are simply not passed to the method.
- Simplified forms are most useful in implicit class files and scripting contexts.

---

## References

- [JEP 495 — Instance main Methods](https://openjdk.org/jeps/495)
- OCP Study Guide (Java 25 edition), Chapter 16 — What's New in Java 25
