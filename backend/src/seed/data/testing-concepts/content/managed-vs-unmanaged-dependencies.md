---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand Khorikov's managed-vs-unmanaged distinction for out-of-process dependencies — the rule that decides whether an integration test should hit a real database or mock a collaborator, and why getting this backwards quietly breaks a test suite's resistance to refactoring.

## Use Cases

- Deciding whether an integration test should spin up a real test database or mock the repository layer.
- Deciding whether to mock an SMTP server or message bus in an integration test, instead of assuming "external system → always mock it."
- Handling a database that started out private to your application but now has a few tables another team's system also reads.

## Deep Dive

### Two kinds of out-of-process dependency

Every out-of-process dependency — database, SMTP server, message bus, third-party API — falls into one of two categories:

- **Managed dependency**: only your application talks to it. A typical database, reachable exclusively through your own API — no external system connects to it directly.
- **Unmanaged dependency**: other applications observe or depend on how you talk to it. An SMTP server, a message bus — sending an email or publishing a message is a side effect visible outside your system, not just an implementation detail of how you happen to store state.

### The rule: real instances for managed, mocks for unmanaged

```
Managed dependency (e.g. your own database)   → use a REAL instance in integration tests
Unmanaged dependency (e.g. SMTP, message bus) → replace with a MOCK in integration tests
```

The reasoning connects directly to the four pillars' resistance-to-refactoring pillar: communication with a managed dependency is an **implementation detail** — nothing outside your application cares how you organize your own database tables, so a test that verifies the database's *final state* survives a refactor like renaming a column or migrating engines. Communication with an unmanaged dependency is **observable behavior** — another system is watching for that email or that message, so a test needs to verify the *interaction itself* stayed the same, which is exactly what a mock's `verify()` is for.

### When a dependency is both: the shared-database case

A common real-world wrinkle: a database that started out fully private gradually gets a handful of tables exposed to another team's system for easier integration. Once that happens, the database is genuinely both managed and unmanaged at once — and the fix is to treat it as two dependencies, not one:

```
Tables visible only to your application  → managed:   test directly, verify final state
Tables visible to external applications  → unmanaged: mock, verify the interaction pattern
```

Those externally visible tables are functioning like a message bus, with rows standing in for messages — and the book is explicit that sharing a database between systems this way is a poor integration pattern to begin with (an API or a real message bus is better), worth calling out as a "we did this because we had to, not because it's the design goal" situation rather than a technique to reach for on purpose.

## Trade-offs

- **Mocking a managed dependency defeats the point of writing the integration test at all** — it directly compromises resistance to refactoring (a database refactor that changes nothing observable can still break a mocked-out test) and reduces the test's protection against regressions to "does the controller call the right repository method," which unit tests already cover more cheaply.
- **If you genuinely can't use a real instance of a managed dependency (e.g. a legacy database blocked by IT policy from any test environment), the book's advice is to skip integration testing there entirely** rather than mock it — an integration test built around a mocked managed dependency provides close to no additional value over the unit test suite it duplicates, while still costing all the plumbing of an integration test.
- **The managed/unmanaged label lives on the dependency's role, not its technology** — a database is usually managed, but the moment any part of it becomes externally observable (shared tables, a legacy system reading from it directly), that part flips to unmanaged, regardless of it still being "just a database" underneath.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020) — Chapter 8 "Why Integration Testing?", "Which Out-of-Process Dependencies to Test Directly", pp. 190-193 — book
