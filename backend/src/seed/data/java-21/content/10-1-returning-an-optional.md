# Returning an Optional

> `Optional<T>` is a container that may or may not hold a non-null value. In the context of streams, it is the return type of several terminal operations that cannot guarantee a result exists.

---

## Why Optional?

Before `Optional`, methods that might find nothing returned `null`, forcing callers to remember to null-check. Forgetting caused `NullPointerException` at runtime. `Optional` makes the possibility of absence **explicit in the type signature**.

```java
// Old style — caller might forget the null check
String findFirst(List<String> list) { ... }

// New style — absence is explicit
Optional<String> findFirst(List<String> list) { ... }
```

---

## Stream Terminal Operations That Return Optional

Several terminal operations on `Stream<T>` return `Optional<T>` because the stream may be empty:

| Operation | Description |
|---|---|
| `findFirst()` | First element in encounter order, or empty |
| `findAny()` | Any element (useful in parallel streams), or empty |
| `min(Comparator)` | Smallest element according to comparator, or empty |
| `max(Comparator)` | Largest element according to comparator, or empty |
| `reduce(BinaryOperator)` | Single-argument reduce (no identity), or empty |

```java
List<String> names = List.of("Alice", "Bob", "Charlie");

Optional<String> first = names.stream().findFirst();
// Optional[Alice]

Optional<String> shortest = names.stream()
    .min(Comparator.comparingInt(String::length));
// Optional[Bob]

Optional<String> longest = names.stream()
    .max(Comparator.comparingInt(String::length));
// Optional[Charlie]
```

---

## Creating an Optional Directly

| Factory Method | Result |
|---|---|
| `Optional.of(value)` | Non-empty; throws `NullPointerException` if value is null |
| `Optional.ofNullable(value)` | Non-empty if value is non-null, empty otherwise |
| `Optional.empty()` | Always empty |

```java
Optional<String> opt1 = Optional.of("hello");         // Optional[hello]
Optional<String> opt2 = Optional.ofNullable(null);    // Optional.empty
Optional<String> opt3 = Optional.empty();             // Optional.empty
```

---

## Extracting the Value

| Method | Behaviour when empty |
|---|---|
| `get()` | Throws `NoSuchElementException` |
| `orElse(T other)` | Returns `other` |
| `orElseGet(Supplier<T>)` | Calls the supplier |
| `orElseThrow()` | Throws `NoSuchElementException` |
| `orElseThrow(Supplier<X>)` | Throws the supplied exception |

```java
Optional<String> opt = Optional.empty();

String a = opt.orElse("default");                          // "default"
String b = opt.orElseGet(() -> computeDefault());          // lazily computed
String c = opt.orElseThrow(() -> new IllegalStateException("no value"));
```

> **Exam tip:** `orElse(other)` always evaluates `other`, even when a value is present. `orElseGet(supplier)` only calls the supplier when the Optional is empty — prefer it when the fallback is expensive to compute.

---

## Checking and Conditionally Acting

```java
Optional<String> opt = Optional.of("Java");

opt.isPresent();   // true
opt.isEmpty();     // false  (Java 11+)

opt.ifPresent(s -> System.out.println(s.toUpperCase()));  // JAVA

opt.ifPresentOrElse(
    s -> System.out.println("Found: " + s),
    () -> System.out.println("Nothing here")
);
```

---

## Chaining Optional Operations

`Optional` supports functional-style chaining similar to streams.

| Method | Purpose |
|---|---|
| `map(Function)` | Transforms the value if present; returns `Optional` of result |
| `flatMap(Function)` | Like `map`, but the function already returns `Optional` |
| `filter(Predicate)` | Returns empty if predicate fails |

```java
Optional<String> city = Optional.of("  São Paulo  ")
    .map(String::trim)
    .filter(s -> !s.isEmpty());

System.out.println(city.orElse("unknown")); // São Paulo
```

`flatMap` is essential when the mapping function itself returns an `Optional`:

```java
Optional<User> user = findUser(42);

Optional<String> email = user.flatMap(User::getEmail);
// avoids Optional<Optional<String>>
```

---

## Optional.stream()

Since Java 9, `Optional` has a `stream()` method that returns a `Stream` of either zero or one element. This is useful when combining Optionals with stream pipelines.

```java
List<Optional<String>> opts = List.of(
    Optional.of("Alice"),
    Optional.empty(),
    Optional.of("Bob")
);

List<String> names = opts.stream()
    .flatMap(Optional::stream)   // keeps only present values
    .toList();

System.out.println(names); // [Alice, Bob]
```

This is cleaner than `filter(Optional::isPresent).map(Optional::get)`.

---

## What Optional Is Not

- Do **not** use `Optional` as a field type — it is not `Serializable`.
- Do **not** use `Optional` as a method parameter — use overloading instead.
- Do **not** use `Optional` for primitive-heavy code — prefer `OptionalInt`, `OptionalLong`, `OptionalDouble`.

---

## Key Rules Summary

- `findFirst()`, `findAny()`, `min()`, `max()`, and single-argument `reduce()` return `Optional`.
- Always handle the empty case — never call `get()` without first checking `isPresent()`.
- `map`, `flatMap`, and `filter` let you chain logic without explicit null checks.
- `Optional.stream()` bridges `Optional` and `Stream` pipelines cleanly.

---

## References

- [Oracle Docs — Optional](https://docs.oracle.com/en/java/docs/api/java.base/java/util/Optional.html)
- OCP Study Guide, Chapter 10 — Streams
