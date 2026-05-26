# Lambda Expressions and Functional Interfaces

---

## What Is a Lambda?

A lambda expression is a concise, anonymous implementation of a functional interface — an interface with exactly one abstract method (SAM):

```java
// anonymous class
Runnable r1 = new Runnable() {
    @Override public void run() { System.out.println("hello"); }
};

// equivalent lambda
Runnable r2 = () -> System.out.println("hello");
```

---

## Lambda Syntax

```
(parameters) -> expression
(parameters) -> { statements; }
```

| Form | Example |
|------|---------|
| No parameters | `() -> 42` |
| One parameter (parens optional) | `x -> x * 2` |
| Multiple parameters | `(a, b) -> a + b` |
| Block body | `(x) -> { int r = x * 2; return r; }` |
| Explicit types | `(int x, int y) -> x + y` |

> When using a block body, `return` is required to produce a value.

---

## Target Typing

The compiler infers the functional interface from context (the *target type*):

```java
Predicate<String>  p = s -> s.length() > 3;
Function<String,Integer> f = s -> s.length();
Comparator<String> c = (a, b) -> a.compareTo(b);
```

The same lambda body can satisfy different functional interfaces depending on the target type.

---

## Variable Capture

Lambdas can read local variables from the enclosing scope if those variables are **effectively final** (never reassigned after initialisation):

```java
String prefix = "Hello";
Consumer<String> greet = name -> System.out.println(prefix + ", " + name);
// prefix = "Hi";  // would cause a compile error
```

Instance fields and static fields can always be accessed and mutated.

---

## Method References

Shorthand for a lambda that delegates to an existing method:

| Kind | Syntax | Equivalent lambda |
|------|--------|--------------------|
| Static | `Math::abs` | `x -> Math.abs(x)` |
| Bound instance | `"hello"::toUpperCase` | `() -> "hello".toUpperCase()` |
| Unbound instance | `String::toUpperCase` | `s -> s.toUpperCase()` |
| Constructor | `ArrayList::new` | `() -> new ArrayList<>()` |

```java
List<String> names = List.of("Charlie", "Alice", "Bob");

// unbound instance method
names.stream().sorted(String::compareTo).forEach(System.out::println);
//                    unbound               bound instance
```

---

## Built-in Functional Interfaces (`java.util.function`)

| Interface | Method | Description |
|-----------|--------|-------------|
| `Supplier<T>` | `T get()` | Provides a value |
| `Consumer<T>` | `void accept(T)` | Consumes a value |
| `BiConsumer<T,U>` | `void accept(T,U)` | Consumes two values |
| `Function<T,R>` | `R apply(T)` | Maps T → R |
| `BiFunction<T,U,R>` | `R apply(T,U)` | Maps T,U → R |
| `UnaryOperator<T>` | `T apply(T)` | Maps T → T |
| `BinaryOperator<T>` | `T apply(T,T)` | Combines T,T → T |
| `Predicate<T>` | `boolean test(T)` | Tests a condition |
| `BiPredicate<T,U>` | `boolean test(T,U)` | Tests two values |

Primitive specialisations avoid autoboxing: `IntSupplier`, `IntConsumer`, `IntFunction<R>`, `IntUnaryOperator`, `IntPredicate`, etc.

---

## Composing Functions

Default methods let you chain functional interfaces:

```java
Function<String, String> trim  = String::trim;
Function<String, String> upper = String::toUpperCase;
Function<String, String> clean = trim.andThen(upper);

clean.apply("  hello  ");   // "HELLO"

Predicate<String> nonNull  = s -> s != null;
Predicate<String> nonBlank = s -> !s.isBlank();
Predicate<String> valid    = nonNull.and(nonBlank);
Predicate<String> invalid  = valid.negate();
```

---

## Key Rules

| Rule | Detail |
|------|--------|
| SAM | Exactly one abstract method; `default`/`static`/`private` don't count |
| `@FunctionalInterface` | Optional annotation; compiler enforces SAM |
| Effectively final | Captured local variable never reassigned |
| `this` inside lambda | Refers to the enclosing class, not the lambda itself |
