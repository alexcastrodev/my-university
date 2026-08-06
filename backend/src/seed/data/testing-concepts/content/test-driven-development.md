---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`Test-driven development` (TDD) inverts the usual order of work: instead of `[code, test]`, you work `[test, code, refactor]`, repeating in a short cycle. You write a **failing** test that expresses what the code should do, write the **smallest** amount of code that makes it pass, then **refactor** to improve the structure while the test keeps you safe. Attributed to Kent Beck, TDD aims for "clean code that works": the test drives the design, becomes the first client of the API, and doubles as living documentation.

## Use Cases

- Adding a new feature by first writing a test that specifies it, so the code you write is driven by a concrete, checkable goal.
- Covering existing/legacy code with characterization tests before changing it, so a refactor can't silently break behavior.
- Designing an API from the caller's perspective — writing the test first forces you to use the method before you implement it.
- Building a regression safety net so that later refactoring (or a bug fix) can't reintroduce a defect without a red test.
- Producing executable documentation: the tests describe, in code, exactly what each unit is supposed to do.

## Deep Dive

### The red-green-refactor cycle

TDD is a loop of three short steps:

```
1. RED     — write a test for behavior that doesn't exist yet; run it; watch it fail.
2. GREEN   — write the minimum code to make that test pass; run it; watch it pass.
3. REFACTOR— improve the code's structure without changing behavior; tests stay green.
```

The failing test comes *first* — it proves the test can fail (so a later pass is meaningful) and pins down the requirement before any implementation exists.

### Red: write the failing test first

For the flight-management rules (any passenger may join an economy flight), the test is written before `EconomyFlight` behaves correctly:

```java
@Test
void testEconomyFlightRegularPassenger() {
    Flight economyFlight = new EconomyFlight("1");
    Passenger passenger = new Passenger("Mike", false); // not VIP

    assertEquals("1", economyFlight.getId());
    assertTrue(economyFlight.addPassenger(passenger));   // fails: not implemented yet
    assertEquals(1, economyFlight.getPassengersSet().size());
    assertTrue(economyFlight.removePassenger(passenger));
}
```

### Green: the smallest code that passes

Implement just enough to turn the test green — no speculative extra behavior:

```java
public boolean addPassenger(Passenger passenger) {
    return passengersSet.add(passenger);   // minimal: economy accepts anyone
}
```

### Refactor: improve structure, keep tests green

Once tests pass, restructure safely. The book starts with a single `Flight` class that switches on a `flightType` string, then refactors to polymorphism — an abstract `Flight` with `EconomyFlight`/`BusinessFlight` subclasses — running the tests after each step to confirm behavior is unchanged:

```java
// before: decisions driven by a type flag
public boolean addPassenger(Passenger p) {
    if (flightType.equals("Economy")) { return passengers.add(p); }
    else if (flightType.equals("Business")) { if (p.isVip()) return passengers.add(p); return false; }
    throw new RuntimeException("Unknown type");
}

// after: each subclass owns its rule; no type flag, no branching
public class BusinessFlight extends Flight {
    @Override public boolean addPassenger(Passenger p) {
        return p.isVip() && passengers.add(p);
    }
}
```

Because the tests already exist and stay green, the refactor is safe — that safety is exactly what makes aggressive refactoring possible.

## Trade-offs

- **Discipline and up-front time vs. fewer defects and living docs** — writing the test first feels slower per feature, and the payoff (bugs caught early, a refactor-enabling safety net, executable documentation) is real but deferred, so TDD is a hard sell under short-term pressure.
- **Tests can over-couple to implementation** — a test that asserts on internal steps rather than observable behavior breaks on every refactor, defeating the point; TDD tests should assert *what* the unit does, not *how*:

```java
assertTrue(economyFlight.addPassenger(passenger)); // behavior — survives refactoring
// vs. asserting an internal call/order — brittle, breaks when internals change
```

- **TDD only covers the bottom of the pyramid** — it drives unit-level design but doesn't replace integration, system, or acceptance tests; green unit tests say nothing about whether components work together (see the test-pyramid concept).
- **Poor fit for exploratory/spike work** — when you don't yet know the design or the API, writing tests first can lock in a shape you'll throw away; spikes are often better done code-first, then re-approached with TDD once the direction is clear.

## Documentation Links

- [Test-Driven Development — Martin Fowler](https://martinfowler.com/bliki/TestDrivenDevelopment.html) — doc
- [JUnit 5 User Guide — Writing Tests](https://docs.junit.org/current/user-guide/#writing-tests) — doc
- [JUnit in Action, 3rd Ed. — Ch. 20, "Test-driven development with JUnit 5," pp. 405–436 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) — doc
