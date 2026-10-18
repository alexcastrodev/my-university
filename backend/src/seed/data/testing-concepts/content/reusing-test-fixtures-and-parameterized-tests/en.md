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

## Lab

In this lab you get `Order` and `Inventory` **already built and working**. Your job is to test them by applying two ideas from the article: reuse fixtures through private factory methods instead of shared `@BeforeEach` fields, and collapse near-identical boundary tests into `@ParameterizedTest`s. The core idea is to feel why a mutable `Inventory` cannot be a field of the test class, and when `@CsvSource` is enough and when only `@MethodSource` works.

**The scenario**

An order consumes stock and carries two pure business rules.

- `Inventory`: stock per SKU, mutable on purpose (`addStock`, `quantityOf`, `remove`). `remove` returns `false` and leaves stock untouched when there are not enough units, never decrementing halfway.
- `Order.place(sku, quantity)`: returns the result of the inventory's `remove`.
- `Order.shippingFeeCents(total)`: free shipping (0) from 5000, 499 from 2000 up to below 5000, and 999 below that.
- `Order.isWithinReturnWindow(purchaseDate, today)`: returns allowed up to 30 days after the purchase, inclusive.
- `OrderTest`: has NO `@BeforeEach` and no shared `Inventory`/`Order` fields, on purpose. A shared field would let one test's `place()` change the starting stock for every other test.

**What you will do, step by step**

1. **Write the factory (TODO-00).** In `createInventoryWithStock(sku, quantity)`, create a new `Inventory`, call `addStock(sku, quantity)` once and return it. This is the Object Mother pattern: each test calls the factory and gets its own object.
2. **An order that succeeds (TODO-01).** With `createInventoryWithStock("SKU-1", 10)`, build `new Order(inventory)`, call `place("SKU-1", 5)`, check `true` and that `inventory.quantityOf("SKU-1")` is now 5.
3. **An order that fails (TODO-02).** With only 3 units, `place("SKU-1", 5)` returns `false` and the stock is still 3: a rejected order must not decrement partially. This is a brand new `Inventory`, unaffected by the previous test.
4. **Shipping fee tiers (TODO-03).** Add a `@CsvSource` with `orderTotalCents, expectedFeeCents` rows that pin down the tiers, covering the value just below and the exact value of each boundary (1999 and 2000, 4999 and 5000).
5. **Return window (TODO-04 and TODO-05).** Add `@MethodSource("returnWindowCases")` to the test and implement `returnWindowCases()` returning a `Stream<Arguments>` of `(purchaseDate, today, expected)` triples built from `LocalDate.now()`: 30 days after the purchase (inside, `true`), 31 days after (outside, `false`) and on the purchase date itself (`true`). Since arithmetic on `LocalDate.now()` is not a compile-time constant, `@CsvSource` or `@ValueSource` will not do here.

**How you know you are done**

`mvn test` is all green. You can explain what would go wrong if `Inventory` were a shared field and why the return window test needs `@MethodSource`.

**Optional challenges**

- **TODO-06:** rewrite the asserts of `placeSucceedsWhenEnoughInventory` with AssertJ's fluent `assertThat(...).isEqualTo(...)` and `isTrue()` instead of `assertEquals`/`assertTrue`, and compare how the "subject, action, object" phrasing reads against the positional expected/actual arguments.

**Prerequisites:** JUnit 5 fundamentals (`@Test`, `@ParameterizedTest`, `assertEquals`) and reading `Order` and `Inventory` in `src/main/java`.

**How to run it:** clone the repository, go into `testing-concepts/reusing-test-fixtures-and-parameterized-tests` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/reusing-test-fixtures-and-parameterized-tests test`). The factory and `returnWindowCases()` throw `UnsupportedOperationException` and the other tests start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 3 "The anatomy of a unit test", Sections 3.3, 3.5-3.6, pp. 50-63 — book
- [JUnit 5 User Guide — Parameterized Tests](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parameterized-tests) — doc
- [AssertJ — Fluent assertions for Java](https://assertj.github.io/doc/) — doc
