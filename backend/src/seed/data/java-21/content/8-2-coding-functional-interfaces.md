# Coding Functional Interfaces

> **OCP Exam Topic** — Define and implement functional interfaces. Covered in Chapter 8 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Functional Interface?

A **functional interface** is any interface that contains **exactly one abstract method**. That single abstract method (SAM) is the one a lambda or method reference implements. The number of default or static methods does not matter — only the abstract method count.

```java
@FunctionalInterface
interface Greeter {
    void greet(String name);   // single abstract method
}
```

Usage:

```java
Greeter g = name -> System.out.println("Hello, " + name);
g.greet("Alice"); // Hello, Alice
```

---

## The @FunctionalInterface Annotation

Adding `@FunctionalInterface` to an interface tells the compiler to enforce the SAM rule. If the interface has zero or two or more abstract methods, the code will **not compile**.

```java
@FunctionalInterface
interface Valid {
    int compute(int x);        // OK — one abstract method
}

@FunctionalInterface
interface Invalid {            // compile error — two abstract methods
    int add(int a, int b);
    int subtract(int a, int b);
}
```

The annotation is optional — any interface with exactly one abstract method is technically functional — but it is a best practice and protects you from accidentally adding a second abstract method later.

---

## Default and Static Methods Are Allowed

A functional interface may contain any number of `default` and `static` methods. These do not count toward the SAM requirement.

```java
@FunctionalInterface
interface Validator<T> {
    boolean validate(T value);          // SAM

    default Validator<T> and(Validator<T> other) {
        return value -> this.validate(value) && other.validate(value);
    }

    static <T> Validator<T> alwaysTrue() {
        return value -> true;
    }
}
```

```java
Validator<String> notEmpty  = s -> !s.isEmpty();
Validator<String> notBlank  = s -> !s.isBlank();
Validator<String> combined  = notEmpty.and(notBlank);

System.out.println(combined.validate("hi"));  // true
System.out.println(combined.validate("  ")); // false
```

---

## Overriding Object Methods

Abstract methods that override `Object` public instance methods (such as `toString`, `equals`, `hashCode`) do **not** count as the SAM for functional interface purposes, because every implementation inherits them from `Object`.

```java
@FunctionalInterface
interface Converter<T, R> {
    R convert(T input);      // SAM

    @Override
    String toString();       // does NOT count — overrides Object.toString()
}
```

---

## Generic Functional Interfaces

Functional interfaces can be generic, letting a single definition cover multiple types.

```java
@FunctionalInterface
interface Mapper<T, R> {
    R map(T input);
}
```

```java
Mapper<String, Integer> length = s -> s.length();
Mapper<Integer, String> toHex  = n -> Integer.toHexString(n);

System.out.println(length.map("Java"));   // 4
System.out.println(toHex.map(255));       // ff
```

The type parameters are resolved at the point of assignment from the lambda's target type.

---

## Common Mistakes on the Exam

| Scenario | Compiles? |
|---|---|
| Interface has one abstract method, no `@FunctionalInterface` | Yes — still functional |
| `@FunctionalInterface` on interface with two abstract methods | No |
| `@FunctionalInterface` on interface with one abstract + one default | Yes |
| `@FunctionalInterface` on interface with one abstract + one static | Yes |
| `@FunctionalInterface` on interface that extends another with its own SAM | Depends — total abstract methods must equal 1 |

```java
interface Base {
    void doWork();              // abstract
}

@FunctionalInterface
interface Derived extends Base {
    // inherits doWork() — still only 1 abstract method, valid
}

@FunctionalInterface          // compile error — adds a second abstract method
interface BadDerived extends Base {
    void doMore();
}
```

---

## Defining Your Own vs. Using Built-in Interfaces

Java provides a rich set of built-in functional interfaces in `java.util.function` (covered in lesson 8-4). Before defining a custom functional interface, check whether one of the built-in types already fits your method signature. Custom interfaces are appropriate when:

- You need a more descriptive name for domain clarity.
- The built-in generics cannot express a checked exception that your method must declare.
- You need a primitive-specialised variant not covered by the built-in set.

---

## Key Points to Remember

- A functional interface has **exactly one abstract method** (the SAM).
- `@FunctionalInterface` is optional but strongly recommended — it turns SAM violations into compile errors.
- `default` and `static` methods do not count against the single-abstract-method rule.
- Abstract methods that merely re-declare `Object` public methods also do not count.
- Generic functional interfaces resolve their type parameters from the lambda's assignment context.
- Always prefer the built-in `java.util.function` interfaces before creating a new one.
