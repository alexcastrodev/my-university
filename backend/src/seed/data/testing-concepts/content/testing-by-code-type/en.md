---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand Khorikov's four-quadrant map of production code — by complexity/domain significance and by number of collaborators — and why it tells you exactly where to invest unit-testing effort, where not to bother, and what to do with the code that's genuinely hard to test.

## Use Cases

- Deciding whether a class deserves a thorough unit test, a light integration test, or no dedicated test at all.
- Explaining why "just add more unit tests" doesn't fix a codebase where the hard-to-test classes are the ones causing pain.
- Refactoring a class that mixes business logic with database/HTTP calls into something that's actually cheap to test.

## Deep Dive

### Two axes: complexity/domain significance, and collaborator count

Every piece of production code can be placed on two independent axes. **Complexity or domain significance** — measured loosely by cyclomatic complexity (branching points) plus how directly the code serves the business domain rather than being plumbing. **Number of collaborators** — how many mutable or out-of-process dependencies a class needs to be exercised at all; immutable values don't count, but every mock or fake you have to wire up does.

### The four quadrants

```
                    Domain model,        Overcomplicated
                    algorithms                  code
Complexity/
domain
significance
                    Trivial code          Controllers

                              Number of collaborators →
```

- **Domain model and algorithms** (high significance, few collaborators) — the sweet spot. High-value tests, and cheap ones: the logic is worth protecting, and there's little to set up.
- **Trivial code** (low significance, few collaborators) — one-line properties, parameterless constructors. Testing it isn't wrong, it's just close to worthless — there's nowhere for a bug to hide.
- **Controllers** (low significance, many collaborators) — code that coordinates other components (domain classes, external systems) without doing complex work itself. Worth covering briefly with a small number of integration tests, not an exhaustive unit suite.
- **Overcomplicated code** (high significance, many collaborators) — the dangerous quadrant: important enough that it can't go untested, but expensive to unit test because of everything it has to coordinate. This is where most of the pain in "hard to unit test" codebases actually lives.

### The fix for overcomplicated code: split it

The rule of thumb: **the more important or complex the code, the fewer collaborators it should have.** Overcomplicated code got that way by mixing business logic (which belongs in the domain-model quadrant) with coordination of collaborators (which belongs in the controller quadrant) in the same class. Splitting those two responsibilities apart — pulling the actual decision-making into a collaborator-free domain method, and leaving only orchestration in a thin controller — moves both halves into cheaper-to-test quadrants instead of leaving one expensive, risky blob in the top-right. This split is exactly what the **Humble Object pattern** formalizes: isolate the hard-to-test dependency (a framework call, I/O, threading) behind a thin, deliberately "humble" layer that does nothing but coordinate, so the logic worth testing never has to touch that dependency directly.

## Trade-offs

- **Unit testing the domain-model quadrant gives the best return on effort** — valuable because the logic matters, cheap because there's little to set up; this is where a unit test suite should concentrate its density.
- **Testing trivial code isn't wrong, it's just not worth prioritizing** — a suite chasing 100% coverage will end up with a pile of tests here that add close to zero protection while still costing maintenance time on every unrelated change to that class's shape.
- **Controllers are integration-tested, not unit-tested exhaustively** — since a controller's whole job is coordinating collaborators, a unit test of it in isolation (mocking everything) mostly just re-describes the coordination logic itself; a smaller number of integration tests against real (or close-to-real) collaborators verifies the thing that actually matters — that the coordination works.
- **Overcomplicated code is a signal to refactor, not a signal to write a bigger test** — throwing more mocks and setup at a class in the top-right quadrant treats the symptom; splitting it via the Humble Object pattern into an algorithm piece and a controller piece is what actually reduces both risk and test cost, and it's the harder, more valuable fix.
- **100% coverage was never the goal** — a test suite where every test adds real value, concentrated in the domain-model quadrant, beats a suite that's larger but padded with trivial-quadrant tests contributing close to nothing.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020) — Chapter 7 "Refactoring Toward Valuable Unit Tests", "Identifying the Code to Refactor", pp. 152-155 — book
- Gerard Meszaros, *xUnit Test Patterns: Refactoring Test Code* (Addison-Wesley, 2007) — origin of the Humble Object pattern — book
