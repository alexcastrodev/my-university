---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

A `record` is a compiler-generated, immutable data carrier — declare the components once and get a constructor, accessors, `equals`, `hashCode`, and `toString` for free. A `sealed` class or interface restricts which other types may extend or implement it. Neither needs the other, but together they let you model a fixed, closed set of alternatives — the closest thing Java has to an algebraic data type — where the compiler, not a code review, enforces that the set never grows by accident.

## Use Cases

- Aggregating a handful of immutable values (a coordinate pair, a money amount plus currency, a min/max range) into a real type instead of a `Map<String, Object>` or a parallel set of arrays.
- Modeling a fixed set of outcomes — a `Result` that is either a `Success` or a `Failure`, a `Shape` that is only ever a `Circle`, `Square`, or `Triangle` — and having the compiler flag any code that forgets to handle one of them.
- Validating or normalizing the values a data carrier is allowed to hold, at the moment it's constructed, without hand-writing a constructor's full parameter list.
- Publishing a library type whose implementations you want to control completely, while still leaving room for a specific implementation to remain open for extension.

## Deep Dive

### Records: the compiler writes the boilerplate

```java
record Point(int x, int y) {}

Point p = new Point(3, 4);
p.x();          // 3 — accessor named after the component, not getX()
p.equals(new Point(3, 4));  // true — structural equality
p.toString();   // "Point[x=3, y=4]"
```

Declaring `record Point(int x, int y) {}` generates: a `private final` field per component, public accessors named exactly like the components, a canonical constructor whose parameter list matches the components in order, and `equals`/`hashCode`/`toString` implementations based on all components. A record is implicitly `final` — it cannot be extended — and it cannot itself `extend` another class (it implicitly extends `java.lang.Record`, not something you can substitute).

### Compact constructors: validate without repeating the parameter list

```java
record Range(int min, int max) {
    Range {  // compact constructor — no parameter list, no explicit assignment
        if (min > max) {
            throw new IllegalArgumentException("min must be <= max");
        }
    }
}
```

A compact constructor implicitly has the same parameters as the record's components. Whatever you do to them inside the block — validate, normalize, `trim()` a string — happens before they're assigned to the fields at the end of the block; you don't (and can't) assign the fields yourself. This is the idiomatic place to reject bad data, since it runs for every construction path, including deserialization frameworks that call the canonical constructor.

### Non-canonical constructors must delegate

```java
record Employee(String name, int idNum) {
    static final int PENDING_ID = -1;

    Employee(String name) {          // non-canonical: must call another constructor via this(...)
        this(name, PENDING_ID);
    }
}
```

Any additional constructor must call the canonical constructor (directly or transitively) via `this(...)` as its first statement — it can't assign the fields itself. This guarantees every object of the record type goes through the same validation/normalization logic, no matter which constructor created it.

### Sealed types: closing the set of subtypes

```java
sealed interface Shape permits Circle, Square, Triangle {}

record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
record Triangle(double base, double height) implements Shape {}
```

Every class named in a `permits` clause must directly extend/implement the sealed type, and every one of them must itself be declared `final`, `sealed`, or `non-sealed` — there's no fourth, unrestricted option. `non-sealed` is the deliberate escape hatch: it reopens exactly that one branch of the hierarchy to arbitrary subclassing while every other branch stays closed. If every permitted subtype lives in the same file as the sealed type (and has default/package access), the `permits` clause can be omitted — the compiler infers it from what's declared alongside it.

### Sealed interface + record implementations: the idiomatic pairing

Combining the two gives you a hierarchy that is both closed (nothing outside `permits` can appear) and exhaustively destructurable — a `switch` over a sealed type's permitted subtypes can be exhaustive without a `default` branch, because the compiler can prove every case is covered. How to actually match and destructure that hierarchy with `switch`/`instanceof` patterns is its own concept — see `pattern-matching` — this one is about the modeling side: designing the closed shape those patterns then consume.

## Trade-offs

- **A record's immutability is shallow.** The record's own reference to a component can't change after construction, but if that component is itself a mutable object, nothing stops you from mutating what it points to.
  ```java
  record Team(String name, List<String> members) {}
  var t = new Team("Blue", new ArrayList<>(List.of("Ana")));
  t.members().add("Bo");   // compiles fine — the List itself is still mutable
  ```
- **A record can never `extend` a class — sealed *classes* (not sealed interfaces implemented by records) are the tool when you need real inheritance and a closed hierarchy at the same time.**
  ```java
  record Circle(double radius) extends Shape {}  // compile error: no extends clause allowed for records
  ```
- **Sealing a hierarchy is a commitment that ripples outward — adding a permitted subtype forces every exhaustive `switch` over it to be revisited.** That's the point (the compiler won't let a new case go unhandled), but it means a sealed type's `permits` list isn't a decision to make lightly in a large codebase.
  ```java
  // add Triangle to Shape's permits clause, and this switch stops compiling
  // until a `case Triangle` branch is added — even though nothing else changed:
  String describe(Shape s) {
      return switch (s) {
          case Circle c -> "circle";
          case Square sq -> "square";
      };
  }
  ```
- **Record patterns (JDK 21) and unnamed patterns (JDK 21, JEP 456) make destructuring records inside a `switch` noticeably terser than when records first shipped in JDK 16** — e.g., matching `Point(var x, _)` to bind only `x` and discard `y` with `_`. That refinement lives in the mechanics of pattern matching itself, not in what a record or a sealed type *is*, so it's covered in depth by the `pattern-matching` concept rather than here.

## Lab

In this lab you get the sealed interface `PaymentMethod` with three records and the `PaymentMethods` class, all with validations and methods left to write. Your job is to complete the code. The core idea is to see two features working together: the compact constructor, which validates data before it goes into the record's fields, and the sealed hierarchy, which allows an exhaustive `switch` with no `default`.

**The scenario**

Payment methods in a closed, known set.

- `PaymentMethod`: a `sealed interface` that permits exactly `CreditCard`, `BankTransfer` and `DigitalWallet`.
- `CreditCard(number, expiryMonth, expiryYear)`, `BankTransfer(iban)` and `DigitalWallet(provider, accountId)`: the records.
- `PaymentMethods.describe()`: a descriptive text for each method.
- `PaymentMethods.feePercentage()`: the processing fee of each method.

Everything lives in `PaymentMethod.java`. `DigitalWallet` has no validation to write, only the other two records do.

**What you will do, step by step**

1. **Validate the card (TODO-00).** In the compact constructor of `CreditCard`, throw `IllegalArgumentException("number must not be blank")` if the number is null or blank, and `IllegalArgumentException("expiryMonth must be between 1 and 12")` if the month is out of range. Because the code runs before the assignment, an invalid `CreditCard` never exists.
2. **Validate the transfer (TODO-01).** In `BankTransfer`, throw `IllegalArgumentException("iban must not be blank")` for a null or blank IBAN.
3. **Describe (TODO-02).** Write an exhaustive `switch`: `"Credit card ending in "` plus the last 4 digits, `"Bank transfer to "` plus the IBAN and `"Digital wallet via "` plus the provider.
4. **Compute the fee (TODO-03).** Another exhaustive `switch`: `0.029` for the card, `0.0` for the transfer and `0.015` for the digital wallet.

**How you know you are done**

`mvn test` is all green. You should be able to explain what the compiler does if you add a fourth record to `permits` and forget to handle it in the `switch` expressions, and why that is better than a `default`.

**Optional challenges**

- **TODO-04:** implement `isFeeWaived()` with the same kind of exhaustive `switch`, returning `true` only for `BankTransfer`.

**Prerequisites:** basic Java syntax, `switch` expressions and basic exception handling. The project uses Java 21 and Maven.

**How to run it:** clone the repository, go into `java-concepts/records-and-sealed-types` and run `mvn test` (from the root: `mvn -pl java-concepts/records-and-sealed-types test`). The methods start out throwing `UnsupportedOperationException("Not implemented yet.")` and the `TODO-NN` comments explain each step, so the red tests are your checklist.

## Documentation Links

- [Java SE Language Documentation — Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Java SE Language Documentation — Sealed Classes and Interfaces](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html) — doc
- [JEP 395: Records](https://openjdk.org/jeps/395) — doc
- [JEP 409: Sealed Classes](https://openjdk.org/jeps/409) — doc
- [JEP 456: Unnamed Variables & Patterns](https://openjdk.org/jeps/456) — doc
