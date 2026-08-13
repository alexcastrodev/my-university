---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Recognize a handful of related unit testing anti-patterns — testing private methods, exposing private state, leaking domain knowledge into a test's arrange step, polluting production code with test-only switches, mocking concrete classes, and calling `Clock.systemDefaultZone()` (or `new Date()`) directly inside business logic — and see why each one traces back to the same root cause Khorikov names in Chapter 11: coupling a test to an implementation detail instead of to observable behavior.

## Use Cases

- Deciding what to do when a private method feels "too complex to leave untested" — extract it into its own class with a public API, rather than exposing it or reflecting into it.
- Reviewing a test that reimplements the production calculation to compute its own "expected" value, and replacing it with a hardcoded, independently-verified expectation.
- Spotting a boolean constructor flag like `isTestEnvironment` in production code and refactoring it to an interface with a real implementation and a test-only fake.
- Making a time-dependent method (an expiration check, an approval timestamp) deterministically testable by injecting `java.time.Clock` instead of calling `Clock.systemDefaultZone().instant()` inline.

## Deep Dive

### Testing private methods and exposing private state

Both anti-patterns share the same illegal move: reaching past a class's public API to touch something it deliberately keeps hidden. The fix for both is the same, too — look at what the *public* API actually needs to guarantee, and test that.

Take a private method that has grown complex enough to feel like it needs its own tests:

```java
public class Order {
    private final Customer customer;
    private final List<Product> products;

    public String generateDescription() {
        return "Customer name: " + customer.getName()
            + ", total number of products: " + products.size()
            + ", total price: " + getPrice();
    }

    // Complex business logic, buried behind a private method
    private BigDecimal getPrice() {
        BigDecimal basePrice = /* computed from products */ BigDecimal.ZERO;
        BigDecimal discounts = /* computed from customer */ BigDecimal.ZERO;
        BigDecimal taxes = /* computed from products */ BigDecimal.ZERO;
        return basePrice.subtract(discounts).add(taxes);
    }
}
```

Making `getPrice()` package-private just so a test can call it directly would couple the test to an implementation detail — exactly the mock/stub-vs-observable-behavior problem covered in `observable-behavior-and-mock-fragility`. The complexity of `getPrice()` isn't a testing problem, it's a design smell: a missing abstraction. Extract it into its own class with its own legitimate public method:

```java
public class Order {
    private final Customer customer;
    private final List<Product> products;

    public String generateDescription() {
        PriceCalculator calc = new PriceCalculator();
        return "Customer name: " + customer.getName()
            + ", total number of products: " + products.size()
            + ", total price: " + calc.calculate(customer, products);
    }
}

public class PriceCalculator {
    public BigDecimal calculate(Customer customer, List<Product> products) {
        BigDecimal basePrice = /* computed from products */ BigDecimal.ZERO;
        BigDecimal discounts = /* computed from customer */ BigDecimal.ZERO;
        BigDecimal taxes = /* computed from products */ BigDecimal.ZERO;
        return basePrice.subtract(discounts).add(taxes);
    }
}
```

`PriceCalculator.calculate()` is now legitimately public, has no hidden inputs or outputs, and can be tested directly with plain input/output assertions — no reflection, no widened visibility on `Order`.

Exposing private *state* fails the same way. A `Customer` that promotes itself to a preferred tier:

```java
public class Customer {
    private CustomerStatus status = CustomerStatus.REGULAR; // private state

    public void promote() {
        status = CustomerStatus.PREFERRED;
    }

    public BigDecimal getDiscount() {
        return status == CustomerStatus.PREFERRED
            ? new BigDecimal("0.05")
            : BigDecimal.ZERO;
    }
}
```

The temptation is to make `status` package-private (or add a `getStatus()`) purely so a test can confirm `promote()` worked. But the production code never reads `status` from outside the class — only `getDiscount()` does, and that's already public. The test should assert what the *caller* actually observes:

```java
@Test
void promotingGrantsFivePercentDiscount() {
    Customer customer = new Customer();
    assertEquals(BigDecimal.ZERO, customer.getDiscount());

    customer.promote();

    assertEquals(new BigDecimal("0.05"), customer.getDiscount());
}
```

If a future caller genuinely needs the raw status, expose it then — at which point it has become real observable behavior, not a testing back door.

### Leaking domain knowledge to tests

This anti-pattern shows up as a test that doesn't hardcode an expected value but *recomputes* it using the same logic as the production code:

```java
@Test
void addingTwoNumbers() {
    int value1 = 1;
    int value2 = 3;
    int expected = value1 + value2; // leaked domain knowledge

    int actual = Calculator.add(value1, value2);

    assertEquals(expected, actual);
}
```

It looks harmless for addition, but the same pattern on a real pricing or tax algorithm means the test's "arrange" step is a copy-paste of the production algorithm. If that algorithm has a bug, the copy in the test has the *same* bug, and the assertion still passes — the test has zero chance of catching the very error it exists to catch. This is the same failure mode as the false positives from `four-pillars-of-a-good-unit-test`, just introduced through duplicated logic instead of mocked implementation details.

The fix: hardcode expected values that were worked out independently of the SUT (by hand, by a domain expert, or from a trusted legacy implementation), not by calling the same code path:

```java
@ParameterizedTest
@CsvSource({
    "1, 3, 4",
    "11, 33, 44",
    "100, 500, 600"
})
void addingTwoNumbers(int value1, int value2, int expected) {
    int actual = Calculator.add(value1, value2);
    assertEquals(expected, actual);
}
```

Now a bug in `Calculator.add()` has nowhere to hide — the expectation didn't come from the same place the bug would.

### Code pollution and mocking concrete classes

Two smaller anti-patterns, same underlying rule: keep test-only concerns out of the production class, and depend on interfaces rather than concrete implementations wherever a test needs to substitute behavior.

**Code pollution** is a production class carrying a flag or branch that exists purely to behave differently under test:

```java
public class Logger {
    private final boolean isTestEnvironment; // exists only for tests

    public Logger(boolean isTestEnvironment) {
        this.isTestEnvironment = isTestEnvironment;
    }

    public void log(String text) {
        if (isTestEnvironment) return; // exists only for tests
        /* write to file */
    }
}
```

Introduce an interface instead, and let the test substitute a no-op implementation — the same stub/fake distinction covered in `test-doubles-stubs-and-mocking`:

```java
public interface Logger {
    void log(String text);
}

public class FileLogger implements Logger {          // production
    public void log(String text) { /* write to file */ }
}

public class FakeLogger implements Logger {          // test code only
    public void log(String text) { /* no-op */ }
}
```

`Controller` now depends on `Logger` the interface, never on the concrete `FileLogger`, and carries no knowledge that tests exist at all.

**Mocking concrete classes** is the same discipline from the mock's side. A mocking framework can technically create a mock of a concrete class and stub only part of it (Mockito's `CALLS_REAL_METHODS` behaves this way), but doing so usually signals that the class is doing two jobs at once — talking to an out-of-process dependency *and* holding domain logic:

```java
public class StatisticsCalculator {
    public Stats calculate(int customerId) {
        List<DeliveryRecord> records = getDeliveries(customerId); // I/O
        return new Stats(sumWeight(records), sumCost(records));   // logic
    }

    public List<DeliveryRecord> getDeliveries(int customerId) {
        /* call an out-of-process dependency */
        return List.of();
    }
}
```

Splitting the gateway from the calculation removes the need to mock a concrete class at all — the gateway becomes an interface, and the calculator becomes a pure function you can test with plain values:

```java
public interface DeliveryGateway {
    List<DeliveryRecord> getDeliveries(int customerId);
}

public class StatisticsCalculator {
    public Stats calculate(List<DeliveryRecord> records) {
        return new Stats(sumWeight(records), sumCost(records));
    }
}
```

### Working with time

Code that calls the system clock directly can't be tested deterministically — the value read during "act" and the value computed for "assert" are never guaranteed to match:

```java
public class Inquiry {
    public void approve() {
        this.approvedAt = Clock.systemDefaultZone().instant(); // untestable
        this.approved = true;
    }
}
```

Java's `java.time.Clock` exists to make this an explicit, injectable dependency instead of an ambient call. Production wires the real system clock; a test wires a fixed one:

```java
public class Inquiry {
    private boolean approved;
    private Instant approvedAt;

    public void approve(Clock clock) {
        this.approvedAt = Instant.now(clock);
        this.approved = true;
    }
}
```

```java
@Test
void approvingRecordsTheFixedInstant() {
    Instant fixed = Instant.parse("2020-01-01T00:00:00Z");
    Clock testClock = Clock.fixed(fixed, ZoneOffset.UTC);

    Inquiry inquiry = new Inquiry();
    inquiry.approve(testClock);

    assertEquals(fixed, inquiry.getApprovedAt());
}
```

```java
// production wiring — a normal @Bean, no test concept involved
Clock systemClock() {
    return Clock.systemDefaultZone();
}
```

`Clock.fixed(...)` gives every assertion the same known instant the "act" step used, so the test is deterministic without ever touching a static, ambient time source.

## Trade-offs

- **A private method that "needs its own tests" is a missing-abstraction signal, not a testing gap** — extracting it into its own class with a public API (the `PriceCalculator` example above) gives you a legitimate seam to test, instead of exposing an implementation detail or reaching for reflection.
- **State that no caller observes shouldn't be observed by a test either** — before widening a field's visibility for a test's sake, check whether any production caller actually reads it; if none does, assert on what callers *do* observe (`getDiscount()`), not on the private field itself.
- **Hardcode expected values, don't recompute them** — a test that reimplements the SUT's formula to derive "expected" will pass even when that formula is wrong, because the bug gets duplicated into the test. Precalculate expectations independently (by hand, with a domain expert, or from a trusted legacy run).
- **Interfaces over booleans for test-only branching** — a `isTestEnvironment` flag adds a runtime branch that can be hit by accident in production; an interface with a real implementation and a test fake adds no such surface area, since interfaces can't have bugs of their own.
- **Mocking a concrete class to preserve part of it usually means the class has two responsibilities** — splitting the I/O (a gateway interface) from the domain logic (a plain calculator) removes the need to partially stub a concrete class at all, and each half becomes independently, fully testable.
- **Inject time, don't call it** — `Clock.fixed(...)` in tests and `Clock.systemDefaultZone()` in production give the exact same seam that `DateTimeProvider`-style abstractions solve in other languages, without adding any ambient/static state shared across tests.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 11 "Unit testing anti-patterns", pp. 259-273
- [java.time.Clock — Java SE Platform API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Clock.html)
- [Mockito — CALLS_REAL_METHODS / partial mocking](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html)
