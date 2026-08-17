---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

The AAA pattern (arrange, act, assert) gives every test a uniform, predictable shape — but Khorikov's chapter goes well past "use three sections": a test with more than one act section is testing more than one behavior and belongs split; an act section longer than one line usually means the SUT's API is leaking an encapsulation gap, not that the test is doing something wrong; and the rigid `MethodUnderTest_Scenario_ExpectedResult` naming convention many teams adopt is actively counterproductive — it optimizes for describing code instead of describing behavior.

## Use Cases

- Reviewing a test with multiple act/assert blocks and recognizing it as an integration test wearing a unit test's clothes (or a sign the unit test needs splitting).
- Spotting a two-line act section in code review and treating it as a hint the production class needs a single method that guarantees both outcomes happen together, not a hint the test needs a comment.
- Renaming a test suite away from `methodName_scenario_result`-style names toward plain-English descriptions a domain expert could read.
- Deciding whether a growing arrange section should move to a private factory method inside the test class or stay inline.

## Deep Dive

### The AAA pattern and its one real exception

```java
@Test
void sumOfTwoNumbers() {
    // Arrange
    double first = 10;
    double second = 20;
    Calculator sut = new Calculator();

    // Act
    double result = sut.sum(first, second);

    // Assert
    assertThat(result).isEqualTo(30);
}
```

Given-When-Then is the same pattern under different names (Given = arrange, When = act, Then = assert) — pick it when the audience includes non-programmers, since it reads more naturally to them; there's no structural difference. Start with arrange in day-to-day work, but when practicing TDD it's fine (even preferable) to write the assert section first, since writing the expectation down is what forces you to think through the behavior before implementing it.

**Never write more than one arrange/act/assert group in a single unit test.** A test with a second act section is verifying two units of behavior, which makes it an integration test by definition (see the sibling `classical-vs-london-schools` concept for what separates the two). Split it into two tests. The one carve-out: a *slow* integration test suite can deliberately chain multiple act/assert groups together to amortize expensive setup — but only when an act step doubles as the arrange for the next one, and only as a performance trade-off for tests that are already slow, never for ordinary unit tests.

**Never write an `if` statement inside a test, in unit tests or integration tests, no exceptions.** Branching in a test is the same signal as a second act section — the test verifies more than one scenario — but unlike multiple AAA blocks, there's no performance trade-off that justifies it here. Split into separate tests instead.

### A multi-line act section is a smell in the production code, not the test

```java
// One-line act — a well-encapsulated API:
boolean success = customer.purchase(store, Product.SHAMPOO, 5);

// Two-line act — a leaking API:
boolean success = customer.purchase(store, Product.SHAMPOO, 5);
store.removeInventory(success, Product.SHAMPOO, 5);
```

The two-line version isn't a test-writing mistake — the test still verifies the same unit of behavior. The problem is that `Customer` requires its caller to remember a second call to keep the store's inventory consistent with the purchase. Forgetting that second call produces an **invariant violation**: a receipt without a matching inventory reduction. The fix belongs in `Customer.purchase()`, not the test — fold the inventory update into the one method so the two outcomes can never happen independently. This guideline applies most strongly to business/domain logic; utility or infrastructure code is more often legitimately multi-step.

### Sizing the other two sections

The arrange section is normally the largest — up to as large as act and assert combined. Past that, extract it into private factory methods on the test class (see the sibling `reusing-test-fixtures-and-parameterized-tests` concept). The assert section can legitimately hold several related assertions — "one assertion per test" is folklore left over from confusing *unit of code* with *unit of behavior* (see `classical-vs-london-schools`); a single behavior can have multiple observable outcomes, and it's correct to check them all in one test. Watch instead for an assert section that keeps growing because it's asserting field-by-field on a returned object — that's usually a sign the object is missing a proper `equals()`, which would let a single assertion replace many.

Most unit tests need no teardown phase at all, because they never touch an out-of-process dependency and so leave nothing to clean up — teardown is integration-test territory (see the sibling `database-testing-lifecycle-and-scope` concept).

### Naming the SUT and separating the sections visually

Name the system under test `sut` in every test, regardless of its real class name — with several collaborators in play, a consistent name for "the thing being tested" removes any ambiguity about who's who.

```java
Calculator sut = new Calculator();
double result = sut.sum(first, second);
```

Separate the three sections either with `// Arrange` / `// Act` / `// Assert` comments or with a single blank line between each. Blank-line separation is the better default for short tests that follow AAA cleanly with no internal grouping needed; keep the comments for larger tests (typical of integration tests) where the arrange section itself needs internal blank lines to group sub-steps, since blank lines alone would then be ambiguous.

### Naming a unit test: reject the rigid convention

```java
// Rigid convention — optimizes for describing code, not behavior:
void isDeliveryValid_invalidDate_returnsFalse() { ... }

// Plain English — optimizes for describing behavior:
void deliveryWithAPastDateIsInvalid() { ... }
```

`[MethodUnderTest]_[Scenario]_[ExpectedResult]` is one of the most common test-naming conventions and, per Khorikov, one of the least helpful — it encourages naming the test after the *code path*, and the repeated method name plus mechanical `Returns...` phrasing reads as noise to anyone who isn't already deep in the implementation. Three concrete guidelines instead:

1. **Don't follow a rigid naming policy.** A complex behavior rarely fits a fixed template — allow full sentences.
2. **Write the name as if explaining the scenario to a domain expert**, not a fellow programmer.
3. **Leave the SUT's method name out of the test name.** You're testing application *behavior*, not a specific method signature — renaming `isDeliveryValid` to `isDeliveryCorrect` shouldn't force every test name to change too. (Exception: pure utility code with no business meaning, where using the method name is fine.)

Worked example, rewriting `isDeliveryValid_invalidDate_returnsFalse` step by step: `deliveryWithInvalidDateShouldBeConsideredInvalid` (plain English, but "considered" and "should be" are filler) → `deliveryWithPastDateIsInvalid` (specific about what "invalid" means, "is" replaces the wishful "should be" — a test states a fact, not a hope) → `deliveryWithAPastDateIsInvalid` (the article reads more naturally). Each step removes noise without losing precision.

## Trade-offs

- **Dropping AAA comments in favor of blank lines only works while the arrange section stays flat** — a large arrange section that itself needs internal grouping loses that structure once the outer `// Arrange` comment is gone; keep the comments in exactly that case rather than applying "always drop them" as a blanket rule.
- **The multiple-AAA-sections exception for slow integration tests is a deliberate performance trade-off, not a template to reuse in unit tests** — applying it there just hides that a unit test is covering more than one behavior.
- **Plain-English test names are harder to keep short and grammatically clean than a template-driven name** — the mechanical convention is easy to generate on autopilot; writing "as if explaining to a domain expert" takes a genuine editing pass, as the five-iteration renaming example shows.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 3 "The anatomy of a unit test", Sections 3.1, 3.4, pp. 41-48, 54-58 — book
- [JUnit 5 User Guide — Writing Tests](https://junit.org/junit5/docs/current/user-guide/#writing-tests) — doc
- [AssertJ — Fluent assertions for Java](https://assertj.github.io/doc/) — doc
