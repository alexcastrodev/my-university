# Returning an Optional

> **OCP Exam Topic** — Use `Optional<T>` to represent values that may or may not be present and avoid `NullPointerException`. Covered in Chapter 8 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## What Is Optional?

`Optional<T>` (in `java.util`) is a container object that either holds a non-null value or is empty. It makes the possibility of "no value" explicit in a method's return type, encouraging callers to handle the absent case rather than assuming a result is always present.

```java
import java.util.Optional;

// returns empty when not found — caller must handle it
public Optional<String> findUsername(int id) {
    if (id == 1) return Optional.of("alice");
    return Optional.empty();
}
```

---

## Creating an Optional

| Factory Method | Description |
|---|---|
| `Optional.of(value)` | Creates an Optional with the given non-null value; throws `NullPointerException` if value is `null` |
| `Optional.ofNullable(value)` | Creates an Optional with the value if non-null, or empty if null |
| `Optional.empty()` | Creates an empty Optional |

```java
Optional<String> present  = Optional.of("Java");
Optional<String> nullable = Optional.ofNullable(null);  // empty
Optional<String> empty    = Optional.empty();

// Optional.of(null) throws NullPointerException immediately
```

---

## Checking Presence

| Method | Description |
|---|---|
| `isPresent()` | Returns `true` if a value is present |
| `isEmpty()` | Returns `true` if no value is present (Java 11+) |

```java
Optional<String> opt = Optional.of("Hello");

if (opt.isPresent()) {
    System.out.println(opt.get()); // Hello
}
```

---

## Retrieving the Value

| Method | Description |
|---|---|
| `get()` | Returns the value; throws `NoSuchElementException` if empty |
| `orElse(other)` | Returns the value if present, otherwise returns `other` |
| `orElseGet(supplier)` | Returns the value if present, otherwise calls `supplier.get()` |
| `orElseThrow()` | Returns the value or throws `NoSuchElementException` |
| `orElseThrow(exceptionSupplier)` | Returns the value or throws the supplied exception |

```java
Optional<String> name = Optional.empty();

String result1 = name.orElse("Unknown");           // "Unknown"
String result2 = name.orElseGet(() -> "Generated"); // "Generated"
// name.get(); // throws NoSuchElementException — avoid calling get() without checking
```

```java
Optional<String> name = Optional.of("Alice");
String upper = name.orElseThrow(); // "Alice" — safe because value is present
```

**Prefer `orElse` / `orElseGet` over `get()`** — calling `get()` without first checking `isPresent()` defeats the purpose of Optional.

---

## Executing Code When Value Is Present

| Method | Description |
|---|---|
| `ifPresent(consumer)` | Calls the consumer if value is present; does nothing if empty |
| `ifPresentOrElse(consumer, runnable)` | Calls consumer if present, runs runnable if empty (Java 9+) |

```java
Optional<String> opt = Optional.of("OCP");

opt.ifPresent(s -> System.out.println("Found: " + s)); // Found: OCP

Optional.empty().ifPresentOrElse(
    s -> System.out.println("Found: " + s),
    () -> System.out.println("Nothing found")           // Nothing found
);
```

---

## Transforming an Optional

These methods apply a function to the contained value and return a new Optional.

| Method | Description |
|---|---|
| `map(function)` | Transforms the value if present; returns empty if the Optional is empty or the function returns null |
| `filter(predicate)` | Returns the Optional unchanged if the predicate passes; returns empty otherwise |
| `flatMap(function)` | Like `map`, but the function returns an `Optional` (avoids nested `Optional<Optional<T>>`) |

```java
Optional<String> opt = Optional.of("  hello  ");

Optional<String> trimmed  = opt.map(String::strip);           // Optional["hello"]
Optional<String> upper    = opt.map(String::strip).map(String::toUpperCase); // Optional["HELLO"]
Optional<String> filtered = opt.map(String::strip)
                               .filter(s -> s.length() > 3);  // Optional["hello"]
Optional<String> empty    = opt.filter(s -> s.isBlank());     // Optional.empty
```

`flatMap` example:

```java
Optional<String> findCity(String code) {
    return code.equals("NY") ? Optional.of("New York") : Optional.empty();
}

Optional<String> code = Optional.of("NY");
Optional<String> city = code.flatMap(this::findCity); // Optional["New York"]
```

---

## Optional and Streams

`Optional` integrates with the Stream API. `Optional.stream()` (Java 9+) returns a stream of zero or one element:

```java
Optional<String> opt = Optional.of("Java");
opt.stream().forEach(System.out::println); // Java
```

This is useful when combining Optionals with `Stream.flatMap`.

---

## Key Points to Remember

- `Optional.of(value)` — non-null value required; throws NPE for null.
- `Optional.ofNullable(value)` — safe for null; returns empty Optional if null.
- `Optional.empty()` — creates an empty Optional.
- Avoid calling `get()` without first verifying `isPresent()` — use `orElse`, `orElseGet`, or `orElseThrow` instead.
- `ifPresent` executes a `Consumer` only when a value is present.
- `map` transforms the value; `filter` conditionally keeps it; `flatMap` is used when the mapping function itself returns an Optional.
- Optional is intended as a method return type, not as a field type or method parameter type.
