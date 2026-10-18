---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the four attributes Khorikov uses to judge *any* automated test — protection against regressions, resistance to refactoring, fast feedback, and maintainability — and why no test can maximize all four at once, which is the real reason "just write more tests" isn't a complete testing strategy.

## Use Cases

- Explaining, precisely, *why* a test suite that passes 100% of the time but still lets bugs through isn't actually protecting anyone.
- Diagnosing a test suite that turns red on every refactor even when nothing is actually broken, and naming what's wrong with it (a resistance-to-refactoring problem, not a bug in the code).
- Deciding where a new test should sit on the unit/integration/end-to-end spectrum by reasoning about which of the four attributes that layer is best suited to provide.

## Deep Dive

### Pillar 1: Protection against regressions

A test's ability to catch a real bug depends on three things: how much code runs during the test, how complex that code is, and how significant it is to the business domain. A one-line property getter has almost nowhere for a bug to hide — testing it protects against almost nothing. Complex business logic is the opposite: there's real room for a mistake, and a bug there is expensive, so a test that exercises it is worth far more than the getter test, even though both are "a test."

### Pillar 2: Resistance to refactoring — and the false positive

Refactoring means changing code without changing its observable behavior — renaming a method, extracting a class. A **false positive** is a test that fails during a refactor even though nothing actually broke. The book's own field story: a team's tests kept turning red on every attempt to clean up old code — some failures were real, most weren't — until developers stopped trusting the suite entirely and started disabling failing tests reflexively. The next time a test *correctly* caught a real bug, it got disabled right along with the noise, and the bug shipped.

The root cause of false positives is always the same: **the test is coupled to implementation details instead of observable behavior.** A test that asserts on *how* the code did something (which private method got called, in what order) breaks the moment that "how" changes, even when the *what* — the actual result — is still correct.

### Pillar 3: Fast feedback

How quickly a test tells you something is wrong. A test suite that takes an hour to run gets run once a day; one that takes ten seconds gets run on every save. This isn't just convenience — a slow suite changes *when* you find out about a problem, and the cost of fixing a bug grows the longer it sits undiscovered.

### Pillar 4: Maintainability

How expensive the test is to understand and to keep working — how hard it is to read, and how much it costs to update every time the surrounding code legitimately changes. A test with many collaborators to set up and tear down costs more to maintain than one with none, independent of what it's actually verifying.

## Trade-offs

- **No test can maximize all four attributes — the first three are mutually exclusive** — you can't max out protection against regressions, resistance to refactoring, *and* fast feedback simultaneously; every test sacrifices some of one to get more of the other two. This isn't a flaw to engineer around, it's a structural fact about testing that shapes the whole test pyramid.
- **End-to-end tests max out protection + resistance, sacrifice speed** — they exercise the most code (including third-party libraries and infrastructure) and, because they only check externally observable behavior, they're nearly immune to false positives. The cost: they're slow, so a suite that's *only* end-to-end tests can't give fast feedback, and few teams can afford to run it constantly.
- **Trivial tests max out resistance + speed, sacrifice protection** — a test asserting a getter returns what was just set runs instantly and essentially never gives a false positive, but it's not protecting against anything either, since there's no real room in that code for a bug to hide:

  ```java
  @Test
  void setterStoresName() {
      User user = new User();
      user.setName("John Smith");
      assertEquals("John Smith", user.getName());  // fast, stable, protects against ~nothing
  }
  ```
- **Brittle tests max out protection + speed, sacrifice resistance** — a fast unit test that asserts heavily on implementation details (exact mock call sequences, internal state) can genuinely catch regressions quickly, but it also fails constantly on legitimate refactors, which is exactly the false-positive trap the field story above describes.
- **A test that scores zero on any single attribute is worthless, not merely weaker** — because the four attributes combine multiplicatively rather than additively, a test with great protection and speed but zero resistance to refactoring isn't "pretty good" — it actively erodes trust in the whole suite, which is worse than not having the test at all.

## Lab

In this lab you get the `Invoice` class **already built and working** and a test class with methods that fail on purpose. There is no production code to write: your job is to write tests that each target one of the article's four pillars (protection against regressions, resistance to refactoring, fast feedback and maintainability). The core idea is to feel that every test asked for here could "just pass" if written carelessly, and that what matters is HOW you assert, not only WHAT you assert.

**The scenario**

An invoice sums line items and applies a bulk discount.

- `LineItem`: a record with `name`, `quantity` and `unitPrice`. `lineTotal()` is price times quantity.
- `Invoice`: `total()` sums the items, applies a 10% discount once the subtotal reaches 100.00 (inclusive) and rounds to 2 places. `itemCount()` just delegates to `items.size()`.
- The summing of the items happens in a **private** `computeSubtotal()` method, on purpose: your test has to go through `total()`.
- `InvoiceTest`: each method carries a TODO naming the pillar it must demonstrate.

**What you will do, step by step**

1. **Protect against regressions (TODO-00).** Build an `Invoice` with a single `LineItem("Widget", 3, new BigDecimal("40.00"))`, a subtotal of 120.00, above the threshold. Check that `total()` equals a HARDCODED `BigDecimal("108.00")` that you computed by hand. If you re-derived the expected value with `Invoice`'s own formula, the test would copy the bug along and catch nothing.
2. **The boundary just below the threshold (TODO-01).** A single item of exactly 99.99, just under 100.00. `total()` must be `BigDecimal("99.99")`, with no discount.
3. **Resist refactoring (TODO-02).** Use THREE items that sum to EXACTLY 100.00 (for example 50.00 + 30.00 + 20.00, quantity 1 each) and check that `total()` is `BigDecimal("90.00")`. Assert ONLY through `total()`: do not reference `computeSubtotal()` and do not add a getter for the subtotal. That way the test keeps passing if the private method is renamed, inlined or rewritten.
4. **Keep it cheap (TODO-03).** An `Invoice` built from `List.of()` and `total()` equal to `BigDecimal("0.00")`, with no setup beyond the empty list. This is the kind of test that stays easy to read and to maintain as the class grows.

**How you know you are done**

`mvn test` is all green. You can explain which pillar each test earns and which one it gives up, and why the test in step 3 would survive a rewrite of `computeSubtotal()` while a test that depended on it would break.

**Optional challenges**

- **TODO-04:** write a test for `itemCount()` with any three items and compare how little it protects against regressions next to TODO-00, even though it is just as fast and just as resistant to refactoring.

**Prerequisites:** JUnit 5 fundamentals (`@Test`, `assertEquals`) and reading `Invoice` and `LineItem` in `src/main/java`, noting that the summing happens in a private method.

**How to run it:** clone the repository, go into `testing-concepts/four-pillars-of-a-good-unit-test` and run `mvn test` (or, from the root, `mvn -pl testing-concepts/four-pillars-of-a-good-unit-test test`). The test methods start with `fail("TODO-NN: not implemented yet")`, so the red tests are your checklist.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020) — Chapter 4 "The Four Pillars of a Good Unit Test", pp. 67-86 — book
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) — doc
