# Designing Methods

> **OCP Exam Topic** — Understand method structure and design, including access modifiers, optional specifiers, return types, method names, parameters, exception lists, and overloading. Covered in Chapter 5 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Method Declaration Anatomy

Every method declaration follows the same structure:

```
[access modifier] [optional specifiers] returnType methodName(parameterList) [throws exceptionList] { body }
```

Only the return type, method name, and parentheses are strictly required. Everything else is optional depending on the context:

```java
public static final int add(int a, int b) throws ArithmeticException {
    return a + b;
}
```

Breaking this down component by component:

| Component | Example | Required? |
|---|---|---|
| Access modifier | `public` | No (defaults to package-private) |
| Optional specifiers | `static`, `final`, `abstract` | No |
| Return type | `int`, `void`, `String` | Yes |
| Method name | `add` | Yes |
| Parameter list | `(int a, int b)` | Yes (can be empty `()`) |
| Exception list | `throws ArithmeticException` | No |
| Body | `{ return a + b; }` | Yes (except for `abstract`) |

---

## Return Types

The return type declares what value the method produces. Every non-`void` method **must** return a compatible value on every possible code path.

```java
// Returns an int
int square(int n) {
    return n * n;
}

// Returns nothing
void printHello() {
    System.out.println("Hello");
    // no return statement required
}

// Compile error: missing return on one path
int absolute(int n) {
    if (n >= 0) return n;
    // compiler complains: no return for negative n
}
```

A `return` statement in a `void` method is legal but must have no value:

```java
void check(int n) {
    if (n < 0) return;   // early exit — OK
    System.out.println(n);
}
```

---

## Optional Specifiers

Several keywords can appear between the access modifier and the return type:

| Specifier | Meaning |
|---|---|
| `static` | Belongs to the class, not an instance |
| `final` | Cannot be overridden in a subclass |
| `abstract` | Has no body; subclass must implement |
| `synchronized` | Thread-safe; only one thread at a time |
| `native` | Implemented in platform-native code |
| `strictfp` | Uses strict floating-point arithmetic |

Multiple specifiers are allowed and their order relative to each other does not matter (though they must all appear before the return type):

```java
// Both are valid declarations
public static final int MAX = 100;
static public final int MAX = 100;  // also compiles
```

---

## Method Overloading

Overloading lets you define multiple methods with the **same name** but **different parameter lists** in the same class. The compiler selects the correct version at compile time based on the argument types.

Rules for valid overloading:
- The parameter list must differ (type, number, or order of types).
- Return type alone is **not** enough to distinguish overloads.
- Access modifier differences alone are **not** enough.

```java
class Calculator {
    int add(int a, int b)       { return a + b; }
    double add(double a, double b) { return a + b; }
    int add(int a, int b, int c) { return a + b + c; }

    // Compile error — same erasure as the first method
    // double add(int a, int b)  { return a + b; }
}
```

When no exact match exists, Java promotes smaller types to larger types (`byte` → `short` → `int` → `long` → `float` → `double`) before looking for an autoboxed or varargs match:

```java
void print(long n)   { System.out.println("long: " + n); }
void print(double n) { System.out.println("double: " + n); }

print(5);      // calls print(long n) — int promoted to long first
print(5.0f);   // calls print(double n) — float promoted to double
```

---

## Method Naming Rules

Method names follow the same rules as variable identifiers:
- Must start with a letter, `$`, or `_`.
- Cannot be a Java reserved keyword.
- By convention, method names start with a **lowercase verb** in camelCase (`calculateTotal`, `isValid`, `getName`).

---

## Key Points to Remember

- The only required components of a method declaration are the **return type**, **method name**, and **parentheses**.
- Every code path in a non-`void` method must return a compatible value.
- `void` methods may use a bare `return;` to exit early.
- Overloaded methods share a name but must differ in their **parameter list**.
- Return type and access modifier alone are **insufficient** to distinguish overloads.
- Java promotes primitive types when resolving overloaded calls (widening before boxing before varargs).
