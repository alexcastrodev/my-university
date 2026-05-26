# Recognizing Exception Classes

> The OCP exam expects you to recognize common exception class names, know whether each is checked or unchecked, and understand the conditions that cause them.

---

## Common Checked Exceptions

Checked exceptions extend `Exception` (but not `RuntimeException`). The compiler requires every calling method to either catch them or declare them with `throws`.

| Class | Package | Typical Cause |
|---|---|---|
| `IOException` | `java.io` | General I/O failure (reading/writing streams, files) |
| `FileNotFoundException` | `java.io` | Attempt to open a file that does not exist |
| `SQLException` | `java.sql` | Database access error or invalid SQL |
| `ParseException` | `java.text` | Failure to parse a string into a date/number |
| `CloneNotSupportedException` | `java.lang` | `clone()` called on object that does not implement `Cloneable` |

```java
import java.io.*;

public void loadConfig(String path) throws IOException {
    // FileNotFoundException is a subclass of IOException
    FileReader reader = new FileReader(path);   // throws FileNotFoundException
    int ch;
    while ((ch = reader.read()) != -1) {        // throws IOException
        System.out.print((char) ch);
    }
    reader.close();
}
```

---

## Common Unchecked Exceptions (RuntimeException subclasses)

No `throws` declaration is required, but these will crash a program if not handled.

| Class | Typical Cause |
|---|---|
| `NullPointerException` | Calling a method or accessing a field on a `null` reference |
| `ArrayIndexOutOfBoundsException` | Accessing an array element at an index < 0 or >= length |
| `StringIndexOutOfBoundsException` | `charAt()` or `substring()` called with an invalid index |
| `ClassCastException` | Casting an object to an incompatible type |
| `ArithmeticException` | Illegal arithmetic operation, most commonly integer division by zero |
| `NumberFormatException` | Parsing a string that does not represent a valid number |
| `IllegalArgumentException` | Method receives an argument that violates its contract |
| `IllegalStateException` | Method called at an inappropriate time (object in wrong state) |

```java
// NullPointerException
String s = null;
s.length();   // throws NullPointerException

// ArrayIndexOutOfBoundsException
int[] arr = new int[3];
arr[5] = 10;  // throws ArrayIndexOutOfBoundsException

// ClassCastException
Object obj = "hello";
Integer i = (Integer) obj;   // throws ClassCastException

// ArithmeticException
int result = 10 / 0;   // throws ArithmeticException: / by zero

// NumberFormatException — subclass of IllegalArgumentException
int n = Integer.parseInt("abc");   // throws NumberFormatException

// IllegalArgumentException
public void setAge(int age) {
    if (age < 0) throw new IllegalArgumentException("Age cannot be negative");
}

// IllegalStateException
Iterator<String> it = list.iterator();
it.remove();   // throws IllegalStateException if next() not called first
```

---

## Error Classes

`Error` subclasses represent severe JVM-level problems. Application code should **not** attempt to catch or recover from them.

| Class | Typical Cause |
|---|---|
| `OutOfMemoryError` | JVM cannot allocate memory for a new object |
| `StackOverflowError` | Infinite or excessively deep recursion exhausts the call stack |
| `VirtualMachineError` | General JVM internal error (parent of the above two) |

```java
// StackOverflowError — infinite recursion
public void recurse() {
    recurse();   // eventually throws StackOverflowError
}

// OutOfMemoryError — allocating more memory than the heap allows
int[] huge = new int[Integer.MAX_VALUE];   // throws OutOfMemoryError
```

> **Exam tip:** `StackOverflowError` and `OutOfMemoryError` are `Error` subclasses, not `Exception` subclasses. A `catch (Exception e)` block will **not** catch them.

---

## Exception Hierarchy Quick Reference

```
Throwable
├── Error (unchecked, do not catch)
│   ├── OutOfMemoryError
│   └── StackOverflowError
└── Exception
    ├── IOException  (checked)
    │   └── FileNotFoundException  (checked)
    ├── SQLException  (checked)
    ├── ParseException  (checked)
    └── RuntimeException  (unchecked)
        ├── NullPointerException
        ├── ArrayIndexOutOfBoundsException
        ├── ClassCastException
        ├── ArithmeticException
        ├── NumberFormatException
        │     (extends IllegalArgumentException)
        ├── IllegalArgumentException
        └── IllegalStateException
```

---

## Key Rules Summary

- Checked exceptions (`IOException`, `SQLException`, etc.) require `throws` declarations or `catch` blocks.
- `NullPointerException`, `ClassCastException`, and `ArrayIndexOutOfBoundsException` are the most frequently seen unchecked exceptions on the exam.
- `NumberFormatException` is a subclass of `IllegalArgumentException`.
- `FileNotFoundException` is a subclass of `IOException` — catching `IOException` also catches `FileNotFoundException`.
- `Error` subclasses (`OutOfMemoryError`, `StackOverflowError`) are neither checked exceptions nor `RuntimeException`s — they sit in a completely separate branch.

---

## References

- [Oracle Docs — java.lang Exception Classes](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/package-summary.html)
- OCP Study Guide, Chapter 11 — Exceptions and Localization
