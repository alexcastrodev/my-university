---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Once test fixtures start taking up real space, there are two ways to reuse the setup code between tests — but only one of them, private factory methods, avoids coupling tests to each other. Parameterized tests solve a different, related problem (too many near-identical tests) and come with their own readability trade-off. Both are compounded by the choice of assertion style, where a fluent assertion library restructures assertions to read as plain English instead of `expected, actual` argument-order trivia.

## Use Cases

- Deciding whether shared setup logic belongs in a `@BeforeEach` method, a JUnit `@ExtendWith`-injected shared base, or a plain private factory method on the test class.
- Collapsing four near-identical tests that only differ by one input value into a single `@ParameterizedTest`, without losing the ability to tell which case is which when one fails.
- Choosing between `@ValueSource`/`@CsvSource` and `@MethodSource` when a parameterized test's input can't be expressed as a compile-time constant.
- Replacing a wall of `assertEquals(expected, actual)` calls with AssertJ's `assertThat(actual).isEqualTo(expected)` chain to fix the perennial expected/actual argument-order mistake.

## Deep Dive

### Constructor-based fixture reuse: convenient, but an anti-pattern

```java
class CustomerTests {
    private Store store;
    private Customer sut;

    @BeforeEach
    void setUp() {
        store = new Store();
        store.addInventory(Product.SHAMPOO, 10);
        sut = new Customer();
    }

    @Test
    void purchaseSucceedsWhenEnoughInventory() {
        boolean success = sut.purchase(store, Product.SHAMPOO, 5);
        assertThat(success).isTrue();
        assertThat(store.getInventory(Product.SHAMPOO)).isEqualTo(5);
    }
}
```

This looks like the idiomatic use of `@BeforeEach`, but Khorikov calls it out as the *wrong* way to reuse fixtures, for two specific reasons:

1. **It couples tests to each other.** `store` and `sut` become shared state — changing the quantity in `addInventory` to fix or adjust one test silently changes the starting conditions for every other test in the class, producing failures unrelated to whatever you actually meant to change.
2. **It hurts readability.** A test method with no visible arrange section forces you to jump to `setUp()` to understand what's actually being tested, even when the setup is trivial — you can no longer tell, just by reading the test, whether something more is being configured there.

### The better way: private factory methods

```java
class CustomerTests {
    @Test
    void purchaseSucceedsWhenEnoughInventory() {
        Store store = createStoreWithInventory(Product.SHAMPOO, 10);
        Customer sut = createCustomer();

        boolean success = sut.purchase(store, Product.SHAMPOO, 5);

        assertThat(success).isTrue();
        assertThat(store.getInventory(Product.SHAMPOO)).isEqualTo(5);
    }

    private Store createStoreWithInventory(Product product, int quantity) {
        Store store = new Store();
        store.addInventory(product, quantity);
        return store;
    }

    private Customer createCustomer() {
        return new Customer();
    }
}
```

This is the **Object Mother** pattern: a method (or class) whose job is producing ready-to-use test fixtures. It shortens the test the same way the constructor did, but each test states explicitly what it needs (`createStoreWithInventory(Product.SHAMPOO, 10)`), keeping tests decoupled and self-explanatory without re-reading the method body. The related **Test Data Builder** pattern achieves the same goal through a fluent builder interface instead of a plain method call; it reads slightly better but costs more boilerplate to write — default to Object Mother-style factory methods unless the number of optional parameters makes a builder clearly worth it.

**The one legitimate exception**: a fixture genuinely needed by every (or almost every) test — most commonly a database connection in integration tests — can live in a shared base class's constructor/`@BeforeEach`, since there's no meaningful "what does this test need" question left to ask for something every test needs identically. Put it in a common base test class, not duplicated per test class.

### Parameterized tests: trading test count for per-case readability

```java
@ParameterizedTest
@CsvSource({
    "-1, false",
    "0, false",
    "1, false",
    "2, true"
})
void canDetectAnInvalidDeliveryDate(int daysFromNow, boolean expected) {
    DeliveryService sut = new DeliveryService();
    Delivery delivery = new Delivery(LocalDate.now().plusDays(daysFromNow));

    boolean isValid = sut.isDeliveryValid(delivery);

    assertThat(isValid).isEqualTo(expected);
}
```

Four separate, plainly-named tests collapse into one parameterized test — at the cost of a name generic enough to cover every case, which makes it harder to tell *what specifically* each row is testing without reading the row itself. As a rule of thumb: combine positive and negative cases in one parameterized test only when the input values make it self-evident which case is which; otherwise extract the positive case into its own descriptively-named test and keep only the negative cases parameterized. If the behavior is complicated enough that no naming scheme reads clearly, skip parameterization entirely and write one test per case.

`@CsvSource`/`@ValueSource` only accept values the compiler can treat as constants — a computed value like `LocalDate.now().plusDays(n)` can't go directly into the annotation. `@MethodSource` is the escape hatch: point it at a static method that builds and returns the actual argument list at runtime, exactly analogous to the book's `[MemberData]`.

```java
@ParameterizedTest
@MethodSource("deliveryDates")
void canDetectAnInvalidDeliveryDate(LocalDate deliveryDate, boolean expected) { ... }

static Stream<Arguments> deliveryDates() {
    return Stream.of(
        Arguments.of(LocalDate.now().minusDays(1), false),
        Arguments.of(LocalDate.now(), false),
        Arguments.of(LocalDate.now().plusDays(1), false),
        Arguments.of(LocalDate.now().plusDays(2), true)
    );
}
```

### Assertion libraries and the story pattern

```java
// Positional, easy to get expected/actual backwards:
assertEquals(30, result);

// Fluent, reads as [subject] [action] [object]:
assertThat(result).isEqualTo(30);
```

AssertJ is the Java ecosystem's counterpart to the book's Fluent Assertions (.NET) — same motivation: `assertThat(result).isEqualTo(30)` reads as a small English sentence ("result is equal to 30") the way `assertEquals(30, result)`'s positional `expected, actual` argument order doesn't, and it's an easy source of a silently-wrong test if the two get swapped. Beyond readability, AssertJ's chainable assertions on collections, exceptions, and dates cut down significantly on assertion boilerplate versus plain JUnit `Assertions`. The only real cost is one more test-scoped dependency — never shipped to production, so a low-stakes addition.

## Trade-offs

- **Factory methods only stay decoupled if they're written generically** — a factory method with the target values hard-coded inside it (instead of taken as parameters) silently reintroduces the same cross-test coupling the constructor approach had, just moved into a differently-named method.
- **Parameterized tests trade test count for per-row clarity** — collapsing everything into one generically-named parameterized test can make a failure report tell you *that* something broke without telling you *what*, without reading the failing row's actual values.
- **A shared fixture in a base class is only safe when every subclass genuinely needs it identically** — the same "every test needs this exact thing" bar that justifies a database connection in an integration-test base class does not extend to fixtures only some tests use, which belong back in per-test factory methods.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 3 "The anatomy of a unit test", Sections 3.3, 3.5-3.6, pp. 50-63 — book
- [JUnit 5 User Guide — Parameterized Tests](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests) — doc
- [AssertJ — Fluent assertions for Java](https://assertj.github.io/doc/) — doc
