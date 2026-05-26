# Writing a main() Method

> **OCP Exam Topic** — Know the exact signature of the `main()` method entry point and understand how to compile and run a Java application from the command line. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## The Entry Point

When the JVM starts a Java application, it looks for a specific method called `main`. This method is the **entry point** — execution begins here.

```java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

---

## The Required Signature

The exam tests variations of the `main` signature. The canonical form is:

```java
public static void main(String[] args)
```

Each keyword matters:

| Keyword | Why it is required |
|---|---|
| `public` | The JVM must be able to call it from outside the class |
| `static` | The JVM calls it without creating an instance of the class |
| `void` | The JVM ignores any return value; the method must return nothing |
| `String[]` | The parameter receives command-line arguments as an array of strings |
| `args` | The parameter name — `args` is conventional but any valid identifier works |

---

## Valid Variations

The exam includes these variations — all compile and run:

```java
// Standard form
public static void main(String[] args) { }

// varargs form — equivalent to String[]
public static void main(String... args) { }

// Parameter name can be anything
public static void main(String[] arguments) { }

// final is allowed on the parameter
public static void main(final String[] args) { }
```

The following do **not** work as the JVM entry point:

```java
// Missing static — compiles but JVM cannot call it as entry point
public void main(String[] args) { }

// Wrong return type
public static int main(String[] args) { return 0; }

// Wrong parameter type
public static void main(String args) { }
```

---

## Command-Line Arguments

Arguments are passed after the class name on the command line and received in the `args` array:

```bash
java Greeter Alice 42
```

```java
public class Greeter {
    public static void main(String[] args) {
        // args[0] = "Alice"
        // args[1] = "42"
        System.out.println("Hello, " + args[0]);
        int number = Integer.parseInt(args[1]);
        System.out.println("Number: " + number);
    }
}
```

### Important Details

- `args` is **never** `null` — if no arguments are provided the array exists but has length `0`.
- Every argument is received as a `String`, even numeric values. Parsing (e.g., `Integer.parseInt`) is required.
- Accessing `args[0]` when no arguments are passed throws `ArrayIndexOutOfBoundsException` at runtime.

```java
public class SafeGreeter {
    public static void main(String[] args) {
        if (args.length == 0) {
            System.out.println("No arguments provided.");
        } else {
            System.out.println("Hello, " + args[0]);
        }
    }
}
```

---

## Compiling and Running

```bash
# Step 1 — compile
javac HelloWorld.java

# Step 2 — run
java HelloWorld

# Run with arguments
java Greeter Alice 42
```

The class name passed to `java` must be **fully qualified** if it lives in a package:

```bash
# Class com.example.HelloWorld in directory com/example/HelloWorld.class
java -cp out com.example.HelloWorld
```

---

## Multiple Classes in One File

Only one class in a file can be `public`, and that class must match the filename. Other non-public classes can share the file and each gets its own `.class` file after compilation:

```java
// File: Runner.java
public class Runner {
    public static void main(String[] args) {
        Helper h = new Helper();
        h.greet();
    }
}

class Helper {
    void greet() {
        System.out.println("Greetings from Helper!");
    }
}
```

After `javac Runner.java` you get both `Runner.class` and `Helper.class`. Run with `java Runner`.

---

## Instance main Methods (Preview — Not on Exam)

Java 21 introduced **instance main methods** as a preview feature (JEP 445). Because preview features are not tested on the OCP 1Z0-830 exam, the canonical `public static void main(String[] args)` remains the signature you must know.

---

## Key Points to Remember

- The exact signature is `public static void main(String[] args)`.
- `static` is required — the JVM does not instantiate the class to call `main`.
- `String... args` (varargs) is a valid alternative to `String[] args`.
- `args` is never `null`; it is an empty array when no arguments are supplied.
- All command-line arguments arrive as `String` values and must be parsed if numeric use is needed.
- The class name passed to `java` must not include the `.class` extension.
