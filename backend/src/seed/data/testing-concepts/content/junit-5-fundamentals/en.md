---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

JUnit 5 is a `test lifecycle framework`: it creates a fresh test instance per method, runs setup and teardown around it in a fixed order, and evaluates `assertions` and `assumptions` about the outcome. `@ParameterizedTest`, `@RepeatedTest`, and `@Nested` extend that basic model to cover many inputs, repeated runs, and grouped sub-scenarios without duplicating test code.

## Use Cases

- Grouping setup/teardown around every test method with `@BeforeEach`/`@AfterEach`, and once per class with `@BeforeAll`/`@AfterAll`.
- Failing fast on a wrong value with `assertEquals`/`assertTrue`, or grouping several related checks with `assertAll` so every one of them is evaluated and reported even if one fails.
- Skipping a test at runtime — rather than failing it — when a precondition isn't met, via `assumeTrue`/`assumeFalse`.
- Running the same test logic against many inputs with `@ParameterizedTest` and a source like `@ValueSource` or `@CsvSource`, instead of copy-pasting near-identical `@Test` methods.
- Re-running the same test a fixed number of times with `@RepeatedTest`, to surface flakiness in code that involves randomness or timing.
- Organizing related tests into a nested class hierarchy with `@Nested`, so setup can be scoped to a sub-scenario.
- Giving a human-readable name to a test class or method with `@DisplayName`, shown by IDEs and build reports instead of the raw method name.

## Deep Dive

### The test lifecycle

Every test class follows the same fixed order: `@BeforeAll` once, then for each `@Test` method a fresh instance's `@BeforeEach` → the test → `@AfterEach`, then `@AfterAll` once at the end.

```java
class SUTTest {
    private static ResourceForAllTests resourceForAllTests;
    private SUT systemUnderTest;

    @BeforeAll
    static void setUpClass() {
        resourceForAllTests = new ResourceForAllTests("shared resource");
    }

    @BeforeEach
    void setUp() {
        systemUnderTest = new SUT("fresh per test");
    }

    @Test
    void testRegularWork() {
        assertTrue(systemUnderTest.canReceiveRegularWork());
    }

    @AfterEach
    void tearDown() {
        systemUnderTest.close();
    }

    @AfterAll
    static void tearDownClass() {
        resourceForAllTests.close();
    }
}
```

`@BeforeAll`/`@AfterAll` methods must be `static` unless the class is annotated `@TestInstance(Lifecycle.PER_CLASS)`, because by default JUnit creates a **new test instance per test method** — there's no instance yet when `@BeforeAll` would run against it.

### Assertions vs. assumptions

`Assertions` methods fail the test immediately when the check doesn't hold; `assertAll` groups several assertions so every one of them runs and is reported, even if earlier ones already failed:

```java
@Test
void accountInvariants() {
    Account account = new Account("1", 100);
    assertAll("account",
        () -> assertEquals("1", account.getId()),
        () -> assertTrue(account.getBalance() > 0),
        () -> assertThrows(IllegalArgumentException.class,
                () -> account.withdraw(-1))
    );
}
```

`Assumptions` look similar but mean something different: when an assumption fails, the test is **aborted** (reported as skipped), not failed — useful for preconditions the test doesn't own, like "only run this when a config value is present":

```java
@Test
void onlyRunsWithApiKeyConfigured() {
    assumeTrue(System.getenv("API_KEY") != null);
    // ... test that needs the API key
}
```

### Nested and tagged tests

`@Nested` groups tests around a sub-scenario, letting an inner class have its own `@BeforeEach` that composes with the outer one's:

```java
class AccountTest {
    Account account;

    @BeforeEach
    void createAccount() {
        account = new Account("1", 100);
    }

    @Nested
    class WhenBalanceIsPositive {
        @Test
        void canWithdraw() {
            account.withdraw(50);
            assertEquals(50, account.getBalance());
        }
    }
}
```

`@Tag("slow")` on a class or method lets a build select or exclude subsets of tests (e.g., `mvn test -Dgroups=slow`) without changing test code, and `@Disabled("reason")` turns a test off while recording why, instead of commenting it out.

### Parameterized and repeated tests

`@ParameterizedTest` runs one test method once per source value, avoiding near-duplicate `@Test` methods:

```java
@ParameterizedTest
@ValueSource(strings = {"", "  ", "\t"})
void blankStringsAreInvalid(String input) {
    assertTrue(input.isBlank());
}

@ParameterizedTest
@CsvSource({"1,1,2", "2,3,5", "-1,1,0"})
void addsTwoNumbers(int a, int b, int expected) {
    assertEquals(expected, a + b);
}
```

`@RepeatedTest(n)` instead re-runs the same test `n` times with no varying input, injecting a `RepetitionInfo` if the method needs to know which repetition it's on:

```java
@RepeatedTest(5)
void repeatedWithInfo(RepetitionInfo info) {
    System.out.println("Run " + info.getCurrentRepetition() + " of " + info.getTotalRepetitions());
}
```

### Dynamic tests

`@TestFactory` generates test cases at runtime instead of declaring each one at compile time — useful when the set of cases comes from data rather than from the source code itself:

```java
@TestFactory
Stream<DynamicTest> dynamicTestsForSquares() {
    return IntStream.rangeClosed(1, 3)
        .mapToObj(n -> DynamicTest.dynamicTest(
            "square of " + n,
            () -> assertEquals(n * n, square(n))));
}
```

## Trade-offs

- **`@BeforeAll` requires `static` (or `PER_CLASS` lifecycle)** — because a new test instance is created per test method by default, an instance field isn't visible yet when the (default, per-class) setup method would need to run:

```java
class Broken {
    Resource r; // instance field

    @BeforeAll
    void setUp() { r = new Resource(); } // error: @BeforeAll method must be static
}
```

- **Assumptions skip, assertions fail** — mixing them up changes what a red build vs. a skipped test actually means, and CI dashboards treat the two very differently:

```java
assumeTrue(false); // test reported as ABORTED/skipped, not failed
assertTrue(false); // test reported as FAILED
```

- **Parameterized tests trade readability for coverage** — one method covering ten inputs is less code than ten near-identical `@Test` methods, but a failure message now has to include which input failed, and debugging means finding the right row in the source, not the right method name.
- **Dynamic tests aren't statically discoverable** — because `@TestFactory` generates `DynamicTest`s at runtime, IDEs can't list them ahead of a run the way they list `@Test` methods, which makes "run just this one case" workflows clunkier.

## Documentation Links

- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) — doc
- [JUnit 5 Jupiter API — Assertions](https://junit.org/junit5/docs/current/api/org.junit.jupiter.api/org/junit/jupiter/api/Assertions.html) — doc
- [JUnit in Action, 3rd Ed. — Ch. 2, "Exploring core JUnit," pp. 15–46 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
