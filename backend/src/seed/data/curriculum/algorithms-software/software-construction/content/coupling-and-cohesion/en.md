---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define coupling and cohesion precisely, and state which direction ("want it low" vs. "want it high") applies to each.
- Identify a "God class" or tangled module as a low-cohesion design, and explain what specifically makes its responsibilities not belong together.
- Identify two modules that reach into each other's internals as a high/tight-coupling design, and explain what breaks because of it.
- Refactor a low-cohesion module into focused, single-responsibility pieces, and refactor tightly coupled modules to interact only through a clean interface.
- Explain why coupling and cohesion are, in effect, information hiding viewed from two different vantage points.

## Context & Motivation

Information hiding established that a module should be organized around a decision worth hiding, with an interface that stays stable while the hidden decision underneath is free to change. Coupling and cohesion are what happens when that principle is turned into something measurable — two dials, both about module boundaries, but pointed in opposite directions. **Coupling** measures how much one module depends on the internal details of another; the goal is to keep it *low*, so that a change inside one module doesn't ripple into others. **Cohesion** measures how tightly a single module's own responsibilities belong together; the goal is to keep it *high*, so that a module can be described, understood, and changed as one coherent thing rather than as an accidental bundle of unrelated concerns.

These two ideas are not independent design goals that happen to be taught side by side — they are the same underlying question asked from two directions. Information hiding asks: is this module's boundary drawn so that a hidden decision can change without external consequence? Cohesion asks that question looking *inward*: does everything inside this one module's boundary actually belong to the same hidden decision, or did unrelated decisions get bundled together by accident? Coupling asks it looking *outward*: does anything outside this module's boundary depend on facts that should have stayed hidden inside it? A module with low cohesion is really several different modules wearing one name tag; a pair of modules with high coupling are really one module's internals smeared across a boundary that was drawn in the wrong place.

This pairing is squarely in the ACM/IEEE Software Engineering knowledge area and MIT's 6.005/6.031 software construction material for a concrete, practical reason: it is the single most reliable diagnostic tool for looking at an unfamiliar codebase and immediately spotting where the pain is going to come from. A class with forty unrelated methods (low cohesion) is a class that will need to change for forty unrelated reasons, and every one of those changes risks breaking the thirty-nine other, unrelated pieces of behavior bundled inside it. Two classes that read each other's private fields directly (high coupling) cannot be tested, deployed, or even understood in isolation from one another — you can never look at just one. Learning to see these two failure shapes, and the refactors that fix each, is the practical payoff of everything this discipline has built up to so far, and it sets up the next two concepts directly: design patterns are largely named recipes for achieving low coupling and high cohesion in specific recurring situations, and SOLID is a set of five concrete techniques aimed at the exact same two dials, specialized to object-oriented design.

## Core Theory

### Cohesion: do a module's own responsibilities belong together?

Cohesion is an *internal* property — it asks whether the things one module does are related to each other by a single, coherent purpose, versus being an arbitrary grab-bag that happens to live in the same file or class. A **highly cohesive** module has one clear reason to change: if its single responsibility needs to be different, that module changes; if some unrelated concern needs to be different, that module is untouched. A **low-cohesion** module — often nicknamed a "God class" or "God object" when the problem is severe — has many unrelated reasons to change, all bundled into one place, so that a request to change how invoices are formatted and a request to change how a database connection is opened both land, confusingly, in the same 2,000-line class.

The practical test for cohesion is Robert C. Martin's Single Responsibility Principle in miniature (formalized fully in the SOLID concept that follows this one): can you describe what this module does in one sentence, without using the word "and" to join two unrelated concerns? "This class validates and persists and emails and logs user registrations" is four responsibilities wearing one name, and it is exactly the shape a cohesion problem takes in practice.

### Coupling: how much does one module depend on another's internals?

Coupling is an *external* property — it asks how much one module knows about, or depends on, the specific internal details of another module, rather than only its public contract. **Low (loose) coupling** means modules interact only through stable, narrow interfaces — exactly what information hiding is meant to produce — so that one module's internal changes never force changes in another. **High (tight) coupling** means modules reach past each other's interfaces: reading each other's private fields, assuming a specific internal data layout, or depending on call-order quirks that were never part of any documented contract.

Tight coupling is expensive in a very specific way: it makes the *unit of change* larger than either module alone. A bug fix or feature request that should have touched one file now requires touching two (or more), in lockstep, because the two were never really independent — they only looked that way in the file tree.

```mermaid
graph LR
    subgraph "Tightly coupled (before)"
        A1["OrderProcessor"] -->|reads order._items directly| B1["Order<br/>(internal list exposed)"]
        A1 -->|writes order._total directly| B1
    end
    subgraph "Loosely coupled (after)"
        A2["OrderProcessor"] -->|calls order.total()| B2["Order<br/>(internals hidden)"]
        A2 -->|calls order.add_item(x)| B2
    end
```

On the left, `OrderProcessor` depends on exactly how `Order` stores its items and total — any internal change to `Order` risks breaking `OrderProcessor`. On the right, `OrderProcessor` depends only on `Order`'s public operations; `Order`'s internals can change freely.

### The relationship between the two, and why both matter together

High cohesion and low coupling tend to reinforce each other, and this is not a coincidence. A module built around one clear responsibility naturally has a small, focused public interface (because there's only one coherent thing to expose), which makes it easy for other modules to depend on that interface loosely. Conversely, a low-cohesion "God class" tends to accumulate tight coupling as a side effect: because it does many unrelated things, many unrelated other modules end up depending on many unrelated *parts* of it, and untangling any one dependency means understanding the whole sprawling class first.

It is possible, though less common, to have high cohesion with poor interface design (a module that does one thing but exposes its internals carelessly), or low cohesion with technically narrow interfaces (a God class that happens to expose few methods, each of which does five unrelated things internally). The two are correlated design smells, not logically identical, which is exactly why software engineering treats them as two separate, named dials rather than collapsing them into one.

### Measuring informally: the questions to ask

There is no single automated score that fully captures either property, but both admit reliable informal tests. For cohesion: list everything a module does, and ask whether removing any one item would also remove the reason the others are grouped together — if not, they don't belong together. For coupling: ask, for two modules A and B, whether A could be replaced by a different implementation without B's code changing at all — if B's code would need to change, A and B are coupled at exactly the point that would need to change.

## Worked Examples

### Example 1 — A God class refactored into cohesive pieces

**Problem:** A `UserRegistration` class validates input, persists a new user to a database, sends a welcome email, and logs the event — four unrelated responsibilities in one class.

```python
# --- Before: low cohesion, one class, four unrelated jobs ---
class UserRegistration:
    def register(self, email, password):
        # responsibility 1: validation
        if "@" not in email or len(password) < 8:
            raise ValueError("invalid input")
        # responsibility 2: persistence
        db_connection = open_db_connection()
        db_connection.execute("INSERT INTO users VALUES (?, ?)", (email, password))
        # responsibility 3: notification
        send_email(email, subject="Welcome!", body="Thanks for joining.")
        # responsibility 4: logging
        write_log(f"registered new user {email}")


# --- After: four cohesive, single-responsibility collaborators ---
class RegistrationValidator:
    def validate(self, email, password):
        if "@" not in email or len(password) < 8:
            raise ValueError("invalid input")

class UserRepository:
    def save(self, email, password):
        db_connection = open_db_connection()
        db_connection.execute("INSERT INTO users VALUES (?, ?)", (email, password))

class WelcomeNotifier:
    def notify(self, email):
        send_email(email, subject="Welcome!", body="Thanks for joining.")

class RegistrationLogger:
    def log_registration(self, email):
        write_log(f"registered new user {email}")

class UserRegistration:
    def __init__(self, validator, repository, notifier, logger):
        self._validator = validator
        self._repository = repository
        self._notifier = notifier
        self._logger = logger

    def register(self, email, password):
        self._validator.validate(email, password)
        self._repository.save(email, password)
        self._notifier.notify(email)
        self._logger.log_registration(email)
```

**Reasoning.** Each of the four "after" classes has exactly one reason to change: a new password rule changes only `RegistrationValidator`; switching databases changes only `UserRepository`; changing the email provider changes only `WelcomeNotifier`. The "before" version bundled all four reasons-to-change into one class, so any of those four unrelated changes risked touching (and breaking) the other three concerns living in the same method. The refactored `UserRegistration` is now a thin coordinator with high cohesion of its own — its one responsibility is orchestrating the registration *sequence*, not performing any of the four jobs itself.

### Example 2 — Tightly coupled modules refactored to a clean interface

**Problem:** `OrderProcessor` computes a discount by reading `Order`'s internal list of items directly and mutating its internal total field directly.

```python
# --- Before: tight coupling, reaches into Order's internals ---
class Order:
    def __init__(self):
        self._items = []      # meant to be internal
        self._total = 0       # meant to be internal

class OrderProcessor:
    def apply_discount(self, order, percent):
        order._total = sum(item.price for item in order._items)   # reads internals
        order._total *= (1 - percent / 100)                        # writes internals


# --- After: loose coupling, interacts only through Order's interface ---
class Order:
    def __init__(self):
        self._items = []
        self._total = 0

    def add_item(self, item):
        self._items.append(item)
        self._total += item.price

    def total(self):
        return self._total

    def apply_discount(self, percent):
        self._total *= (1 - percent / 100)

class OrderProcessor:
    def apply_discount(self, order, percent):
        order.apply_discount(percent)   # delegates; no internals touched
```

**Reasoning.** In the "before" version, `OrderProcessor` assumes `Order` stores items in a list named `_items` and a running total in `_total` — if `Order` is later changed to compute totals lazily, or to store items in a dict keyed by SKU, `OrderProcessor` breaks even though nothing about "applying a discount" conceptually changed. In the "after" version, the discount logic moves *into* `Order`, which is where the knowledge of `_total`'s representation already lives; `OrderProcessor` calls one method and knows nothing about how `Order` stores anything. This is the coupling-and-cohesion refactor working together: `Order` gained a bit of cohesion (discount logic belongs with the total it modifies) precisely by removing a coupling problem (an outside class manipulating its internals).

### Example 3 — Testing the "would B need to change" question

**Problem:** Two designs for computing shipping cost: (A) `ShippingCalculator` reads `order.items` and manually sums weights inline; (B) `ShippingCalculator` calls `order.total_weight()`.

```python
# Design A
class ShippingCalculator:
    def cost(self, order):
        weight = sum(i.weight for i in order.items)   # assumes order.items exists and is iterable
        return weight * 0.5

# Design B
class ShippingCalculator:
    def cost(self, order):
        return order.total_weight() * 0.5              # asks Order for the fact it needs
```

**Reasoning.** Apply the coupling test from Core Theory: if `Order`'s internal storage changes (say, items become a dict keyed by product ID instead of a list), Design A's `ShippingCalculator` must change too, because it directly assumed an iterable named `items`. Design B's `ShippingCalculator` needs no change at all — `Order` is free to recompute `total_weight()` however it likes internally. Design A is coupled to a representation detail it never actually needed; Design B depends only on the one fact (`total_weight`) it truly requires, which is the essence of keeping coupling low: depend on the smallest, most stable fact you actually need, never on how that fact happens to be stored today.

## Common Misconceptions & Pitfalls

- **"Fewer classes always means better design."** Cramming four responsibilities into one class to "reduce the number of files" is precisely how a God class forms — cohesion is about whether responsibilities belong together conceptually, not about minimizing a file count. Example 1's "after" version has more classes and is the better design.
- **"Coupling is bad, full stop, so modules should never depend on each other."** Some coupling is unavoidable and even desirable — every module depends on *something*. The goal is low coupling through a stable interface, not zero coupling; `OrderProcessor` in Example 2 still depends on `Order`, just on its public contract rather than its private fields.
- **"If two classes are physically in the same file or package, they must be tightly coupled."** Coupling is about dependence on internal details, not about physical proximity or organization — two classes in the same file can interact purely through public methods (loosely coupled), while two classes in entirely separate packages can reach into each other's private state over a network call (tightly coupled despite being "far apart").
- **"A getter method automatically fixes coupling."** A getter that returns a mutable internal reference (as covered in the information-hiding concept) still leaks the representation and still creates tight coupling — the caller can mutate what it got back, and now depends on that returned object's internal type just as much as if it had reached in directly. Only a getter that returns a value, a copy, or a genuinely read-only view actually reduces coupling.

## Summary

Coupling measures how much one module depends on another's internal details (want it low); cohesion measures how tightly a single module's own responsibilities belong together (want it high). Both are the information-hiding principle applied at the module-boundary level — cohesion asks whether everything inside a boundary genuinely belongs to one hidden decision, coupling asks whether anything outside a boundary depends on facts that were supposed to stay hidden inside it. A "God class" bundling unrelated responsibilities is the classic low-cohesion failure, fixed by splitting it into focused, single-responsibility collaborators, as in the `UserRegistration` example. Two modules reading and writing each other's private fields is the classic tight-coupling failure, fixed by moving logic to wherever the relevant data already lives and interacting only through a narrow public interface, as in the `Order`/`OrderProcessor` example. These two dials are the direct groundwork for design patterns (named recipes for hitting both dials well in recurring situations) and for SOLID (five concrete techniques aimed at exactly these two properties in object-oriented designs).

## Documentation Links

- [ACM/IEEE CS2013 — Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/) — doc
- [MIT 6.031/6.005 — Course Home (OCW)](https://ocw.mit.edu/courses/6-005-software-construction-spring-2016/) — doc
