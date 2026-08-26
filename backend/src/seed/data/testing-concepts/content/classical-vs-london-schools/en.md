---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the classical (Detroit) and London (mockist) schools of unit testing — two genuinely different definitions of "isolation" that lead to opposite answers about what a unit is and which dependencies should be replaced with test doubles.

## Use Cases

- Deciding whether a class's real collaborators should be used as-is in a test, or replaced with mocks, when the class itself has no database/network dependency.
- Explaining why two experienced developers can disagree sharply about whether a given test is "really" a unit test.
- Recognizing a dependency on the current date/time or a random number generator as something worth isolating even though it isn't a database call.

## Deep Dive

### Same three-word definition, different reading of "isolated"

Every definition of a unit test agrees on three attributes: it verifies a small piece of code, it runs fast, and it does so in an *isolated* manner. The first two are uncontroversial. The third is where the classical and London schools genuinely disagree, and that single disagreement is the root of everything else that differs between them.

### The London take: isolate the system under test from its collaborators

The London school reads isolation as: replace every one of a class's dependencies — everything but immutable values — with a test double, so a test failure can only mean one thing: the system under test itself is broken, never one of its neighbors. This also lets you test a class without having to construct its entire object graph, which matters once a codebase has enough interconnected classes that instantiating the "real" version of everything becomes impractical.

### The classical take: isolate tests from each other, not classes from their collaborators

The classical school reads isolation differently: it's the *tests* that need to run in isolation from one another (so test order and parallelism never affect results), not the class under test from its real collaborators. Under this view, using a class's actual dependencies is fine — as long as those dependencies are fast, deterministic, and don't leak state between test runs. A unit, under this school, doesn't have to mean one class; it can be a class or a small cluster of collaborating classes tested together.

```
                  Isolation of...          A unit is...              Uses test doubles for...
London school     Units (the SUT)          A single class            All but immutable dependencies
Classical school  Unit tests (from each other)  A class or a cluster  Shared dependencies only
```

### What actually needs a test double: shared and volatile dependencies

The classical school doesn't avoid test doubles — it just narrows *which* dependencies need one, using two properties:

- **Shared dependency**: something whose state one test can leave behind for another test to accidentally see — a database, the file system, any out-of-process resource. This is the actual reason to isolate it: not "it's external," but "it can make tests interfere with each other."
- **Volatile dependency**: something nondeterministic — a random number generator, a clock/current-time provider — because a test built on a value that changes every run can't reliably assert anything.

A database dependency is typically both shared *and* volatile. The file system is shared (tests using it can collide) but not volatile (it behaves the same way every run). A random number generator is volatile but, given a fresh instance per test, not necessarily shared. Immutable, in-process values (like a `Product` value object) satisfy neither property and don't need a double under either school — this is also the one point of overlap: even the London school allows using real objects as-is when they're immutable.

## Trade-offs

- **London-style isolation gives an unambiguous failure signal, at the cost of testing less real integration** — mock every collaborator and a red test can only mean the SUT is broken, but that same isolation means the test never verifies the SUT actually cooperates correctly with its real dependencies.
- **Classical-style tests exercise more real code, at the cost of a slower, sometimes less precise failure signal** — using real collaborators gives more confidence that the whole cluster of classes actually works together, but a failure could originate in any of them, not just the one you're nominally testing.
- **Neither school treats every dependency the same way** — both schools exempt immutable values from needing a double at all; the real disagreement is about *mutable, in-process* dependencies, where London replaces them and classical doesn't, not about whether a database call belongs in a unit test (both schools agree it doesn't).
- **The book's own stated preference is classical** — not because London is wrong, but because over-isolating with mocks (see the four pillars' "resistance to refactoring" pillar) tends to couple tests to implementation details more than the classical style does, which is the deeper reason this choice matters beyond taste.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020) — Chapter 2 "What Is a Unit Test?", pp. 20-36 — book
- Kent Beck, *Test-Driven Development: By Example* (Addison-Wesley, 2002) — canonical classical-school reference — book
- Steve Freeman & Nat Pryce, *Growing Object-Oriented Software, Guided by Tests* (Addison-Wesley, 2009) — canonical London-school reference — book
