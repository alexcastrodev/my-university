# Using Method References

> **OCP Exam Topic** — Use method references. Covered in Chapter 8 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is a Method Reference?

A **method reference** is a shorthand notation for a lambda that does nothing but call an existing method. When a lambda's body is a single method call and its parameters map directly to that call, the reference form is cleaner and easier to read.

```java
// Lambda
java.util.function.Consumer<String> print1 = s -> System.out.println(s);

// Equivalent method reference
java.util.function.Consumer<String> print2 = System.out::println;
```

The `::` operator separates the class or object from the method name.

---

## The Four Types of Method References

### 1. Static Method Reference

Syntax: `ClassName::staticMethodName`

```java
// Lambda
java.util.function.Function<String, Integer> parse1 = s -> Integer.parseInt(s);

// Method reference
java.util.function.Function<String, Integer> parse2 = Integer::parseInt;

System.out.println(parse2.apply("42")); // 42
```

The lambda parameter `s` becomes the argument to `parseInt` automatically.

### 2. Instance Method on a Particular Object

Syntax: `objectReference::instanceMethodName`

```java
String greeting = "Hello";

// Lambda
java.util.function.Supplier<Integer> len1 = () -> greeting.length();

// Method reference
java.util.function.Supplier<Integer> len2 = greeting::length;

System.out.println(len2.get()); // 5
```

Here the specific instance `greeting` is captured; the method reference always calls the method on that exact object.

### 3. Instance Method on an Arbitrary Object of a Particular Type

Syntax: `ClassName::instanceMethodName`

```java
// Lambda — the first parameter becomes the receiver
java.util.function.Function<String, String> upper1 = s -> s.toUpperCase();

// Method reference
java.util.function.Function<String, String> upper2 = String::toUpperCase;

System.out.println(upper2.apply("java")); // JAVA
```

The first lambda parameter is used as the object on which the method is invoked. Any additional lambda parameters become arguments.

```java
// Two-parameter example
java.util.function.BiPredicate<String, String> startsWith1 = (s, prefix) -> s.startsWith(prefix);
java.util.function.BiPredicate<String, String> startsWith2 = String::startsWith;

System.out.println(startsWith2.test("Hello", "He")); // true
```

### 4. Constructor Reference

Syntax: `ClassName::new`

```java
// Lambda
java.util.function.Supplier<java.util.ArrayList<String>> makeList1 = () -> new java.util.ArrayList<>();

// Constructor reference
java.util.function.Supplier<java.util.ArrayList<String>> makeList2 = java.util.ArrayList::new;

java.util.ArrayList<String> list = makeList2.get();
```

Constructor references also work with `Function` when the constructor takes one argument:

```java
java.util.function.Function<String, StringBuilder> mkSb = StringBuilder::new;
StringBuilder sb = mkSb.apply("initial");
System.out.println(sb); // initial
```

---

## Summary Table

| Type | Syntax | Lambda Equivalent |
|---|---|---|
| Static | `ClassName::staticMethod` | `(args) -> ClassName.staticMethod(args)` |
| Instance on particular object | `obj::instanceMethod` | `(args) -> obj.instanceMethod(args)` |
| Instance on arbitrary object | `ClassName::instanceMethod` | `(obj, args) -> obj.instanceMethod(args)` |
| Constructor | `ClassName::new` | `(args) -> new ClassName(args)` |

---

## Choosing Between Lambda and Method Reference

Use a method reference when:

- The lambda body is **only** a method call with no extra logic.
- The method name communicates intent better than an anonymous body would.

Keep the lambda when:

- There is additional logic inside the body (e.g., an `if` statement or arithmetic).
- Introducing the method reference would make the code harder to read.

```java
// Lambda — extra logic, keep as lambda
java.util.function.Predicate<String> check = s -> s != null && !s.isBlank();

// Method reference — clear and direct
java.util.function.Consumer<Object> print = System.out::println;
```

---

## Exam Traps

- `String::length` is a **type-3** reference (instance on arbitrary object), not static, because `length()` is an instance method.
- If the target functional interface's abstract method has a different number of parameters than expected, the reference will not compile.
- A constructor reference `ClassName::new` selects the constructor whose parameter list matches the functional interface's abstract method.

---

## Key Points to Remember

- Method references use `::` and are always equivalent to a specific lambda form.
- There are four kinds: static, instance on particular object, instance on arbitrary object type, and constructor.
- The compiler resolves which type applies based on whether the left side of `::` is a class or an instance, and whether the method is static or instance.
- Constructor references use `new` as the method name.
- Method references do not work when the lambda body contains additional logic beyond a single method call.
