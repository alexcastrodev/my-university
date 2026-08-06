---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

The `test pyramid` is a strategy for *how many* tests of each kind to write. Software tests form a hierarchy — unit at the bottom, then integration, then system, then acceptance at the top — and the pyramid shape prescribes their proportions: **many** fast, cheap unit tests at the base and progressively **fewer** slow, expensive tests toward the top. The goal is to catch most defects at the cheapest level while still verifying, with a handful of higher tests, that the whole system works. Each level maps to a tool: JUnit 5 + Mockito for units, JUnit 5 (often with Spring) for integration, Selenium for system/UI, Cucumber for acceptance.

## Use Cases

- Deciding the mix of tests for a project — writing the bulk at the unit level and only a few end-to-end tests, rather than the reverse.
- Diagnosing a test suite that's slow and flaky (usually an inverted pyramid — too many UI/E2E tests, too few unit tests).
- Choosing the right level for a given check: business rule → unit; component interaction → integration; user journey → acceptance.
- Structuring a new codebase's tests so the fast feedback loop (units) stays fast and the slow suite (E2E) stays small.
- Deciding *what* to test at the unit level: business logic, bad inputs, boundaries, invariants, and regressions.

## Deep Dive

### The four levels, bottom to top

From cheapest/most-numerous to most-expensive/fewest (the levels themselves are defined in the "Software Testing Principles" concept):

```
        ▲  Acceptance   — does it satisfy the end user? (Cucumber scenarios)
       ▲▲  System       — whole system vs. spec, no code knowledge (Selenium/UI)
      ▲▲▲  Integration  — verified units combined and tested together (JUnit 5 + Spring)
     ▲▲▲▲  Unit         — each class/method in isolation (JUnit 5 + Mockito)
```

Low-level tests are detailed and fast; high-level tests are abstract, closer to the user, and slower. The pyramid says: push testing *down* — prefer a unit test to an integration test, and an integration test to an end-to-end test, whenever a level can give you the same confidence.

### What to test (the unit-level checklist)

At the base, the book enumerates what deserves a test. A single value object shows several at once:

```java
@Test
void rejectsNegativeSeatCount() {                 // bad input value
    assertThrows(RuntimeException.class, () -> new Flight("AA1", -5));
}

@Test
void acceptsBoundaryValues() {                     // boundary conditions
    assertEquals(0, new Flight("AA1", 0).getPassengers().size()); // min: empty flight
}

@Test
void identifierCannotChangeToInvalid() {           // invariant
    Passenger p = new Passenger("900-45-6789", "Mike", "US");
    assertThrows(RuntimeException.class, () -> p.setIdentifier("bad"));
}
```

The checklist: **business logic**, **bad input values**, **boundary conditions** (min/max/empty/full), **unexpected conditions**, **invariants** (values that must not change), and **regressions** (a test per fixed bug so it can't return).

### Mapping tools onto the levels

The pyramid is built with the tools from across the book, each at its level:

```
Unit         JUnit 5 + Mockito     — isolate a class, mock its collaborators
Integration  JUnit 5 (+ Spring)    — load real collaborators together (@SpringBootTest, DB)
System       Selenium WebDriver    — drive the running UI end to end
Acceptance   Cucumber (Gherkin)    — verify business scenarios in stakeholder language
```

A healthy suite runs the wide unit base on every change (seconds), and the narrow top (Selenium/Cucumber) less often (minutes) — the shape keeps fast feedback fast.

## Trade-offs

- **Inverting the pyramid ("ice-cream cone") wrecks feedback** — many slow UI/E2E tests over a thin unit base gives a suite that's slow, brittle, and flaky, because every small change reruns expensive, environment-dependent tests:

```
  ▼▼▼▼  many E2E/UI   ← slow, flaky, expensive
   ▼▼   some integration
    ▼   few unit      ← anti-pattern: push tests DOWN instead
```

- **Unit tests are fast but blind to integration** — a class can pass every unit test and still fail wired to its real collaborators (wrong SQL, misconfigured bean), which is exactly what the (fewer) integration tests exist to catch.
- **End-to-end tests give the most confidence and the most pain** — they exercise the real system as a user would, but they're slow, need a full environment, and fail for non-code reasons (timing, network, test data), so you want few of them, targeting critical journeys.
- **The proportions are heuristics, not laws** — "how many" depends on the system (a UI-heavy app needs more system tests than a pure library); the pyramid is a bias toward cheap tests, not a fixed ratio to enforce mechanically.

## Documentation Links

- [The Practical Test Pyramid — Martin Fowler / Ham Vocke](https://martinfowler.com/articles/practical-test-pyramid.html) — doc
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) — doc
- [JUnit in Action, 3rd Ed. — Ch. 22, "Implementing a test pyramid strategy with JUnit 5," pp. 471–491 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
