# Writing Simple Lambdas

> **OCP Exam Topic** — Write and use lambda expressions. Covered in Chapter 8 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Lambda?

A **lambda expression** is an anonymous block of code that can be passed around and executed later. Think of it as a concise way to implement a **functional interface** — an interface with exactly one abstract method — without writing a full anonymous class.

```java
// Anonymous class (verbose)
Runnable r1 = new Runnable() {
    @Override
    public void run() {
        System.out.println("Running");
    }
};

// Lambda (concise)
Runnable r2 = () -> System.out.println("Running");
```

Both `r1` and `r2` are valid `Runnable` implementations. The lambda on the right is the preferred modern style.

---

## Lambda Syntax

The general form is:

```
(parameters) -> body
```

| Part | Description |
|---|---|
| `(parameters)` | Zero or more parameters; parentheses required when zero or two+ parameters |
| `->` | Arrow token (required) |
| `body` | A single expression **or** a block `{ }` |

### Single-Expression Body

When the body is a single expression, no braces or `return` statement are needed — the expression value is returned automatically.

```java
// No parameters
Runnable greet = () -> System.out.println("Hello");

// One parameter — parentheses optional for single param
Comparator<String> byLength = (a, b) -> a.length() - b.length();
```

### Multi-Statement Body

When you need more than one statement, wrap the body in braces. A `return` statement is required if the abstract method has a non-void return type.

```java
Comparator<String> detailed = (a, b) -> {
    int lengthDiff = a.length() - b.length();
    if (lengthDiff != 0) return lengthDiff;
    return a.compareTo(b);
};
```

---

## Type Inference

Java infers parameter types from the target functional interface. You can omit them when the context is clear.

```java
// Explicit types
Comparator<String> c1 = (String a, String b) -> a.compareTo(b);

// Inferred types (preferred)
Comparator<String> c2 = (a, b) -> a.compareTo(b);
```

You must either declare types for **all** parameters or omit them for **all** parameters — you cannot mix.

```java
// Does NOT compile — mixing declared and inferred
Comparator<String> bad = (String a, b) -> a.compareTo(b);
```

### Omitting Parentheses

Parentheses around a single parameter may be omitted **only** when the type is inferred:

```java
// Both are valid
java.util.function.Predicate<String> p1 = s -> s.isEmpty();
java.util.function.Predicate<String> p2 = (s) -> s.isEmpty();

// Explicit type requires parentheses
java.util.function.Predicate<String> p3 = (String s) -> s.isEmpty();
```

---

## Accessing Variables

Lambdas can read variables from the enclosing scope, but those variables must be **effectively final** — assigned exactly once and never reassigned.

```java
String prefix = "Hello";   // effectively final

java.util.function.Consumer<String> greet = name -> System.out.println(prefix + ", " + name);
greet.accept("Alice");     // prints "Hello, Alice"
```

Attempting to modify `prefix` after it is captured causes a compile error:

```java
String prefix = "Hello";
prefix = "Hi";             // prefix is no longer effectively final

// Does NOT compile
java.util.function.Consumer<String> greet = name -> System.out.println(prefix + ", " + name);
```

Instance variables and static variables do **not** need to be effectively final — they can be read and written freely inside a lambda.

---

## Lambda as a Functional Interface Implementation

A lambda expression is always the implementation of exactly one abstract method. The target type determines which functional interface is used.

```java
interface Transformer {
    String transform(String input);
}

Transformer upper = s -> s.toUpperCase();
System.out.println(upper.transform("java")); // "JAVA"
```

The same lambda body can satisfy different functional interfaces as long as the abstract method signatures are compatible:

```java
java.util.function.Function<String, String> fn  = s -> s.toUpperCase();
java.util.function.UnaryOperator<String>    op  = s -> s.toUpperCase();
Transformer                                 tr  = s -> s.toUpperCase();
```

All three variables hold equivalent behaviour.

---

## Key Points to Remember

- Lambda syntax: `(params) -> body` or `(params) -> { statements; }`.
- The arrow `->` is always required.
- Single-expression bodies return implicitly; block bodies require an explicit `return`.
- Parameter types are inferred from the target functional interface; omit or include them consistently.
- Parentheses around a single inferred parameter are optional.
- Captured local variables must be **effectively final**.
- A lambda is always the implementation of a functional interface's single abstract method.
