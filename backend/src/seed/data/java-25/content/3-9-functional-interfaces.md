# Functional Interfaces

---

## Definition

A **functional interface** has exactly one abstract method (SAM — Single Abstract Method). `default`, `static`, and `private` methods do not count:

```java
@FunctionalInterface
public interface Transformer {
    String transform(String input);          // the one abstract method
    default String transformUpper(String s) { return transform(s).toUpperCase(); }
}
```

`@FunctionalInterface` is optional but recommended — the compiler enforces the SAM contract.

---

## Lambda Expressions

A lambda is a concise implementation of a functional interface:

```java
Transformer shout = s -> s.toUpperCase() + "!";
System.out.println(shout.transform("hello")); // "HELLO!"
```

Syntax variants:

```java
// single parameter, expression body
Runnable r = () -> System.out.println("hi");

// one parameter, no parens needed
Consumer<String> print = s -> System.out.println(s);

// multiple parameters
BinaryOperator<Integer> add = (a, b) -> a + b;

// block body with return
Function<Integer, String> label = n -> {
    if (n == 1) return "one";
    return "other";
};
```

---

## Method References

A shorthand for a lambda that simply calls an existing method:

| Kind | Syntax | Lambda equivalent |
|------|--------|------------------|
| Static | `ClassName::staticMethod` | `x -> ClassName.staticMethod(x)` |
| Instance (bound) | `instance::method` | `x -> instance.method(x)` |
| Instance (unbound) | `ClassName::instanceMethod` | `(obj, x) -> obj.method(x)` |
| Constructor | `ClassName::new` | `x -> new ClassName(x)` |

```java
List<String> names = List.of("Bob", "Alice", "Carol");

// unbound instance — String::compareToIgnoreCase(String other)
names.stream().sorted(String::compareToIgnoreCase).forEach(System.out::println);
//                    unbound instance               bound instance
```

---

## Built-in Functional Interfaces (java.util.function)

| Interface | Abstract method | Use |
|-----------|----------------|-----|
| `Supplier<T>` | `T get()` | Produce a value |
| `Consumer<T>` | `void accept(T)` | Consume a value |
| `BiConsumer<T,U>` | `void accept(T,U)` | Consume two values |
| `Function<T,R>` | `R apply(T)` | Transform T → R |
| `BiFunction<T,U,R>` | `R apply(T,U)` | Transform T,U → R |
| `UnaryOperator<T>` | `T apply(T)` | Transform T → T |
| `BinaryOperator<T>` | `T apply(T,T)` | Combine two T → T |
| `Predicate<T>` | `boolean test(T)` | Test a condition |
| `BiPredicate<T,U>` | `boolean test(T,U)` | Test two values |

Primitive specialisations avoid boxing overhead:

```java
IntSupplier   // int get()
IntConsumer   // void accept(int)
IntFunction<R> // R apply(int)
IntUnaryOperator // int applyAsInt(int)
IntPredicate  // boolean test(int)
// similarly for Long, Double
```

---

## Composing Functions

Built-in interfaces provide default methods for chaining:

```java
Function<String, String> trim  = String::trim;
Function<String, String> upper = String::toUpperCase;

Function<String, String> trimThenUpper = trim.andThen(upper);
System.out.println(trimThenUpper.apply("  hello  ")); // "HELLO"

Predicate<String> notNull  = s -> s != null;
Predicate<String> notBlank = s -> !s.isBlank();
Predicate<String> valid    = notNull.and(notBlank);
```

---

## Lambdas and Variable Capture

Lambdas can capture local variables from the enclosing scope if they are **effectively final**:

```java
String prefix = "Hello";          // effectively final — never reassigned
Consumer<String> greeter = name -> System.out.println(prefix + ", " + name);
// prefix = "Hi";  // would cause compile error — captured variable must be effectively final
```

Instance fields and `static` fields can always be accessed (mutated or not).

---

## Key Rules

| Rule | Detail |
|------|--------|
| SAM | Exactly one abstract method; `default`/`static` do not count |
| `@FunctionalInterface` | Compile-time enforcement; not required |
| Effectively final | Captured local variable never reassigned after declaration |
| Method reference | Shorthand — same rules as the equivalent lambda |
