---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Beyond getting transactions right (see the sibling `database-testing-prerequisites-and-transactions` concept), a database integration test suite needs a policy for three more things: how to keep tests from interfering with each other's data, how to keep individual tests short without recoupling them, and — a genuinely opinionated, still-debated call — what parts of the data layer are even worth testing at all.

## Use Cases

- Choosing how to clean up leftover test data between runs, and recognizing why "clean up at the end" is the wrong default even though it seems more natural.
- Deciding whether an in-memory database (H2, SQLite) is an acceptable stand-in for the production database engine in integration tests.
- Shortening a bloated integration test's arrange/act/assert sections without reintroducing the cross-test coupling the constructor-based fixture anti-pattern causes (see `reusing-test-fixtures-and-parameterized-tests`).
- Deciding whether a repository class needs its own dedicated test, separate from the integration tests that already exercise it indirectly.

## Deep Dive

### Run integration tests sequentially, and clean up at the start, not the end

Parallelizing integration tests against a shared database is possible but rarely worth the cost — it demands globally-unique test data (so concurrent tests can't collide on constraints or accidentally read each other's rows) and materially complicates cleanup. It's more practical to run integration tests sequentially in their own test group/tag (JUnit 5's `@Tag` combined with a Maven/Gradle configuration that disables parallel execution for that tag is the direct equivalent of the book's separate xUnit "test collection"), separate from unit tests, which can stay parallel.

Four ways to remove leftover data between runs, ranked:

1. **Restore a database backup before each test** — correctness is trivial, but by far the slowest option; adds up fast across a whole suite.
2. **Clean up at the end of the test** — fast, but skippable: a crashed build, a debugger session stopped mid-test, or any non-graceful exit leaves the data behind to poison the next run.
3. **Wrap the whole test in one uncommitted transaction** — solves the skipped-cleanup problem, but reintroduces exactly the "one shared transaction across sections" mismatch the sibling concept warns against — production doesn't run inside an ambient rolled-back transaction, so this can hide the same class of bug.
4. **Clean up at the start of the test — the recommended default.** Fast, immune to being skipped by a crash (it always runs as part of the *next* test's setup regardless of how the previous one ended), and doesn't distort the transactional behavior under test. Put the deletion script in a shared base class so it runs automatically before every integration test, and delete rows in an order that respects foreign key constraints — write the SQL by hand rather than reaching for a generic dependency-resolving deletion algorithm; it's simpler to read and gives more control. The deletion script must remove only regular data, never reference data, which stays under migration control exclusively. This also removes the need for a separate teardown phase — cleanup becomes part of the *next* test's own arrange step.

### Avoid in-memory databases — and know how Testcontainers changes the calculus

The book argues against swapping SQLite (or another in-memory engine) in for the real database in tests: it's faster and needs no cleanup, but a different vendor means different SQL dialect quirks, different constraint enforcement, different behavior at the edges — exactly where integration tests are supposed to catch real bugs. A test suite that passes against SQLite but would fail against production Postgres is a false negative waiting to surface after deploy. **This part of the advice hasn't changed**: still use the same database vendor in tests as in production (version/edition can differ, the vendor shouldn't).

> **Book vs. today**: the book (2020) is skeptical of running tests against a real database in a container, citing the operational burden — managing images, provisioning one container per test, batching, teardown — and lands on "just give every developer their own persistent local instance." **Testcontainers has since become the standard, widely-adopted answer to exactly this trade-off**: it spins up the real database engine (the actual vendor, not an in-memory substitute) in Docker per test class or suite, and JVM-ecosystem test frameworks (JUnit 5's `@Testcontainers`/`@Container`) now handle the lifecycle management the book was worried about. The book's underlying principle — don't substitute a different database engine for speed — is unchanged and is in fact Testcontainers' whole reason to exist; only the specific "containers are too much operational overhead" conclusion is dated.

### Shortening arrange, act, and assert without recoupling tests

Extract each section's technical (non-business) boilerplate into private methods on the test class, mirroring the Object Mother pattern from the sibling fixture-reuse concept, applied to all three AAA sections instead of just arrange:

```java
// Arrange — Object Mother-style factory:
User user = createUser("user@mycorp.com", UserType.EMPLOYEE);
createCompany("mycorp.com", 1);

// Act — a decorator method that owns opening/closing the EntityManager:
String result = execute(controller -> controller.changeEmail(user.getId(), "new@gmail.com"));

// Assert — a fluent interface over the queried entity:
User userFromDb = queryUser(user.getId());
assertThat(userFromDb).hasEmail("new@gmail.com").hasType(UserType.CUSTOMER);
```

The assert-section fluent interface is a small hand-rolled builder (or an AssertJ custom `Assert` subclass) wrapping the domain object, the same "reads like a sentence" motivation as the sibling concept's `assertThat(...).isEqualTo(...)` point, just extended to a multi-field custom assertion. This does mean the fully-shortened test now opens more separate database sessions than the original (one per factory-method call, plus one for act, plus one for assert) — accept that as a deliberate trade of test execution speed for maintainability; it's a small, local database on a developer machine, and the maintainability win is worth more than the milliseconds. Put factory methods on the test class itself by default; only promote them to a shared helper class once real duplication across test classes justifies it, and never put them in the shared base class reserved for cleanup logic that must run in every test.

### What's actually worth testing at the database layer

**Reads need a much higher bar than writes.** A bad write can corrupt data with knock-on effects across the system (and other systems, if the corrupted data ever left the boundary); a bad read is usually just wrong output, caught and fixed with far less collateral damage. Test only the most complex or important reads and skip the rest — and skip building a domain model for reads at all, since a domain model exists to preserve invariants across *writes*; a read with no encapsulation to protect gets no benefit from one. Prefer plain SQL over an ORM for reads specifically — it's faster (no unnecessary mapping layer) and there's no encapsulation benefit being traded away.

**Don't test repositories directly.** It's tempting — mapping domain objects to and from the database is exactly the kind of place a mistake hides — but a repository sits in the "controller" quadrant of the code-complexity map (talks to an out-of-process dependency, holds little logic of its own; see the sibling `testing-by-code-type` concept), so a dedicated repository test carries full integration-test maintenance cost while mostly re-proving what the broader integration test suite already covers. Extract whatever real mapping complexity a repository has into a separate, pure factory/mapper class and unit test *that* in isolation instead (this was the original CRM example's `UserFactory`/`CompanyFactory`) — though note this separation isn't always possible with a full ORM, since JPA/Hibernate mapping logic is bound to the persistence context itself. Where it isn't possible, accept repository coverage as a side effect of the broader integration tests rather than writing repository tests on purpose.

## Trade-offs

- **Cleaning up at the start rather than the end feels backwards the first time you see it** — the payoff (immunity to a crashed or debugger-interrupted previous run) only becomes visible after the "clean up at the end" version has already bitten someone with contaminated data from a failed run.
- **Testcontainers removes the book's stated *operational* objection to per-test containers, but doesn't remove the execution-time cost** — a full container boot per test class is still slower than a persistent shared local instance; the trade-off shifts from "is this worth the ops burden" (largely resolved) to "is this worth the extra seconds per test run" (still a real, project-specific call).
- **Extracting a repository's mapping logic into a standalone factory class is clean but genuinely impossible with a full ORM** — Hibernate/JPA's entity mapping is inherently coupled to the persistence context, so "test the mapping in isolation" is a guideline to apply where the architecture allows it, not a rule to force everywhere.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020) — Chapter 10 "Testing the database", Sections 10.3-10.5, pp. 243-254 — book
- [Testcontainers for Java](https://java.testcontainers.org/) — doc
- [JUnit 5 User Guide — Parallel Execution](https://junit.org/junit5/docs/current/user-guide/#writing-tests-parallel-execution) — doc
