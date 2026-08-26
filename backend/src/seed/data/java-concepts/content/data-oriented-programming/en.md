---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Data-Oriented Programming (DOP) is not a new language feature — it's a naming, by Java's own language architect Brian Goetz, of a way to combine three features that already exist (records, sealed types, and pattern matching) into a deliberate modeling discipline. Classic OOP encapsulates state *and* behavior together inside a class; DOP asks you to pull them apart on purpose — model data as plain, transparent, immutable records, and put the logic that acts on that data in separate code that pattern-matches over it. It's not a replacement for OOP any more than functional-style stream pipelines are; it's a different default for the specific problem of modeling a closed set of related shapes of data and processing them exhaustively.

## Use Cases

- Modeling a domain with a small number of related but distinct variants — payment methods, event types, AST nodes, API response shapes — where you want the compiler to guarantee every variant is handled.
- Parsing external input (a request body, a file format, a protocol message) into an explicit, typed shape once at the boundary, instead of passing a loosely-typed `Map` or DTO deeper into the code.
- Any place you're currently writing a `switch` on a `String` "type" field, or an `instanceof` chain with a manual `else` guarding against "some type I forgot" — a sealed hierarchy turns that manual guard into a compile error.
- Billing/ledger/event-sourcing style code, where records like `Order`/`Refund`/`Transaction` are naturally immutable facts rather than mutable entities with methods of their own.
- Interop-heavy code (serialization, persistence, RPC) where a record's fixed, inspectable shape is exactly what a mapping library wants to see.

## Deep Dive

### The core move: seal the shape, keep the data dumb

```java
sealed interface Transaction permits Order, Refund {}

record Order(String product, int quantity, double price) implements Transaction {}
record Refund(String reason, double amount) implements Transaction {}

record Customer(String name, String address, List<Transaction> history) {}
```

Nothing here does anything. `Order` and `Refund` are pure data — no business method lives on either. The behavior lives elsewhere, as a function of the data:

```java
double balanceFor(Customer c) {
    double balance = 0;
    for (Transaction tx : c.history()) {
        balance += switch (tx) {
            case Order(var product, var qty, var price) -> qty * price;
            case Refund(var reason, var amount)          -> -amount;
        };
    }
    return balance;
}
```

`switch` deconstructs each record's components directly in the case label (record patterns), and — because `Transaction` is `sealed` with exactly two permitted implementations — the compiler can prove this `switch` is exhaustive. No `default` branch, and none is needed: add a third `permits` type to `Transaction` tomorrow and this method **fails to compile** until you add a matching `case`, at every single `switch` over `Transaction` in the codebase. That's the actual payoff — the compiler, not a code reviewer, finds every place a new variant needs handling.

### Why separate the data from the operations at all

The instinct DOP pushes back against is: "a `Refund` should have a `.apply(Ledger)` method, that's what OOP is for." Two things go wrong at scale if every record grows its own behavior:

1. **The record stops being reusable across contexts.** A `Refund` used for billing and a `Refund` used for fraud-review logic want different operations on the same data; putting both sets of methods on the record couples two unrelated concerns to one class.
2. **You lose the exhaustiveness guarantee's power.** If `Refund.process()` is one method among many, adding a new `Transaction` subtype means grepping for every class that has a matching method — exactly the "did I handle every case?" problem sealed types + `switch` were meant to solve at compile time, reintroduced by hand.

Goetz's original four-principle framing (2022) was: model the data, the whole data, and nothing but the data; make the data immutable; make illegal states unrepresentable; validate at the boundary. An updated "v1.1" framing (2024), after wider real-world use, reorganized this and swapped "validate at the boundary" for an explicit fourth principle — **separate operations from data** — stated as its own rule rather than a side effect of the others: operations belong in dedicated code, not as instance methods on the record modeling the data.

### Making illegal states unrepresentable

A record with an unconstrained `String` field for "type" is exactly the shape DOP argues against — nothing stops a caller from constructing an `Order` with a negative `quantity`, or a `status` string with a typo. Two mechanisms close that gap:

```java
record Order(String product, int quantity, double price) implements Transaction {
    Order {                                    // compact constructor
        if (quantity <= 0) throw new IllegalArgumentException("quantity must be positive");
        if (price < 0)     throw new IllegalArgumentException("price cannot be negative");
    }
}
```

The compact constructor validates every construction path — there's no second constructor to forget to guard. And the sealed hierarchy itself is the second mechanism: `Transaction` can *only* be `Order` or `Refund`, so "some other, unmodeled transaction kind" isn't a state the type system will let exist at all, as opposed to a `String kind` field that technically accepts anything.

### Where a discriminated union used to need a workaround

Before sealed types + record patterns (Java 21), the same idea existed but needed either a visitor-pattern hierarchy (a lot of boilerplate for a closed set of shapes) or a manually-maintained enum-plus-fields "tagged union" with no compiler help distinguishing which fields are valid for which tag. The `sealed interface` + `record` + exhaustive `switch` combination gives the same guarantee — every case handled, no illegal combination representable — with none of that ceremony, which is the concrete reason this pattern is now the idiomatic default for this kind of modeling rather than a niche technique.

## Trade-offs

- **DOP is a fit for closed, data-shaped problems — not a general OOP replacement.** Code with genuine encapsulated invariants that must be maintained across many mutating operations over an object's lifetime (a connection pool, a cache with eviction policy) is still better served by classes that hide their state and expose behavior — DOP is specifically for the "here's a fixed set of data shapes, process them" problem.
- **Exhaustiveness is only a guarantee while the hierarchy stays `sealed` and in one module/package boundary you control.** It buys you nothing for data shapes that come from a source you don't own (an external API, a plugin system) — those still need a runtime "unknown case" fallback, not a compile-time one.
- **Splitting data from operations can scatter logic that reads better together.** A `Refund` with a validation-heavy interpretation that's genuinely core to what a `Refund` *is* (as opposed to what one particular consumer does with it) may read more clearly as a compact-constructor invariant on the record than as external code — DOP doesn't argue against methods that belong to the data's own definition, only against methods that encode a specific caller's business process.
- **The principle framing itself is still moving.** Goetz's own team revised the four principles once already (2022 → 2024's "v1.1"), which is worth knowing before treating any specific numbered list as the final, canonical statement of the idea rather than the current best articulation of it.
- **Records + sealed types + pattern matching are the prerequisites, not DOP itself** — a codebase that already uses all three individually hasn't automatically "done DOP"; the discipline is choosing to keep the data and the logic separate on purpose, which pattern matching over records enables but doesn't enforce.

## Documentation Links

- [Data Oriented Programming in Java — Brian Goetz, InfoQ](https://www.infoq.com/articles/data-oriented-programming-java/) — doc
- [Data-Oriented Programming in Java, Version 1.1 — Inside.java](https://inside.java/2024/05/23/dop-v1-1-introduction/) — doc
- [Why Update Data-Oriented Programming to Version 1.1? — Inside.java](https://inside.java/2024/06/26/dop-v1-1-why-update/) — doc
- [Separate Operations From Data — Data-Oriented Programming v1.1 — Inside.java](https://inside.java/2024/06/05/dop-v1-1-separate-operations/) — doc
- [JEP 440: Record Patterns](https://openjdk.org/jeps/440) — doc
- [JEP 409: Sealed Classes](https://openjdk.org/jeps/409) — doc
