---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain the expressiveness limit of propositional logic that motivates first-order logic: no way to talk about objects, relations, and generalizations without writing a separate proposition for every individual case.
- Identify the building blocks of first-order logic: constants, variables, predicates, functions, and the universal (∀) and existential (∃) quantifiers, already covered as pure mathematics.
- Translate an English sentence into a well-formed first-order-logic sentence, and vice versa.
- Explain what it means for a single FOL sentence to be equivalent to infinitely many propositional facts.
- Distinguish first-order logic's added expressiveness from what it still cannot represent (higher-order relations over relations themselves, handled by richer logics not covered here).

## Context & Motivation

Propositional logic, covered in the previous two concepts, can represent and reason about individual, named facts — $P1$, $P2$, $L$ — but it has no way to talk about *objects* and the *relations* between them in general. To say "every student who studies passes" in propositional logic, an agent would need a separate proposition symbol, and a separate implication, for every single student that could possibly exist — `StudiesAlice → PassesAlice`, `StudiesBob → PassesBob`, and so on, forever, one sentence per individual, with the underlying pattern ("studying causes passing," for anyone) nowhere represented explicitly at all.

**First-order logic (FOL)** fixes exactly this. Predicates and quantifiers — the same ∀, ∃, ¬, ∧, ∨, → notation and the same rules for negating quantified statements already covered as pure discrete mathematics — let a single FOL sentence, `∀x (Studies(x) → Passes(x))`, stand for every one of those infinitely many propositional facts at once. This is the actual reason first-order logic, not propositional logic, is the basis for essentially every serious knowledge-representation system in AI: real domains are full of general rules that apply to unboundedly many objects, and only a logic with objects and quantifiers can state such a rule once instead of once per object.

## Core Theory

### The building blocks of first-order logic

- **Constants** name specific objects (`Alice`, `2`, `RegionWA`).
- **Variables** (`x`, `y`) stand for an unspecified object, to be bound by a quantifier.
- **Predicates** express properties of, or relations between, objects, and return true or false (`Studies(x)`, `Adjacent(WA, NT)`, `GreaterThan(x, y)`).
- **Functions** map objects to objects rather than to true/false (`FatherOf(x)`, `Plus(x, y)`) — a function's value is itself an object that can be an argument to a predicate.
- **The universal quantifier (∀)**: `∀x P(x)` asserts $P$ holds for every object in the domain of discourse.
- **The existential quantifier (∃)**: `∃x P(x)` asserts $P$ holds for at least one object in the domain.

These are exactly the same quantifiers and the same negation rules — $\neg \forall x\, P(x) \equiv \exists x\, \neg P(x)$, and $\neg \exists x\, P(x) \equiv \forall x\, \neg P(x)$ — already covered as pure mathematics; nothing about their logical behavior changes when they are put to use representing an agent's knowledge rather than a mathematical claim.

### One FOL sentence, infinitely many propositional facts

Consider `∀x (Studies(x) → Passes(x))`. For a domain of discourse containing objects $Alice, Bob, Carol, \ldots$, this single sentence is logically equivalent to the (potentially infinite) conjunction:

```text
(Studies(Alice) → Passes(Alice)) ∧
(Studies(Bob)   → Passes(Bob))   ∧
(Studies(Carol) → Passes(Carol)) ∧
  ...
```

This is the precise sense in which FOL is more expressive than propositional logic for this kind of statement: propositional logic can only ever write down a fixed, finite set of such facts by hand; FOL's quantifier expresses the *pattern* itself, correctly covering every object in the domain, including ones not yet named or even known to exist when the sentence was written.

### What FOL still does not represent

First-order logic quantifies over objects, not over relations or properties themselves — it cannot directly express a statement like "for every property $P$, if $P$ holds for all birds then..." (quantifying over predicates, not just objects). Statements of that shape require a **second-order** or higher-order logic, which is a genuinely more expressive (and computationally much harder to reason about) formalism, not covered in this discipline. In practice, the vast majority of knowledge-representation tasks in AI — the ones this discipline and its immediate successors deal with — are handled adequately by first-order logic; the jump to higher-order logic is a specialized tool for a narrower set of problems.

## Worked Examples

### Example 1: translating English to FOL

```text
English: "Every student who studies passes."
FOL:     ∀x (Student(x) ∧ Studies(x) → Passes(x))

English: "Some student has never failed a course."
FOL:     ∃x (Student(x) ∧ ¬(∃y (Course(y) ∧ Failed(x, y))))

English: "Alice's advisor is a professor."
FOL:     Professor(AdvisorOf(Alice))
         (AdvisorOf is a function — mapping a student to their advisor,
          a specific object, which the predicate Professor then checks)
```

Notice the pattern from discrete math directly at work: a universally quantified sentence about "every X" is standardly written as an implication ($\forall x\, P(x) \to Q(x)$, not $\forall x\, P(x) \wedge Q(x)$, a common and easy-to-make translation error — the second form would incorrectly assert that *every* object in the domain is both a student and a passer, rather than restricting the claim to just the students).

### Example 2: the common quantifier-connective pairing mistake

```text
Intended meaning: "All ravens are black."
Correct FOL:      ∀x (Raven(x) → Black(x))
Incorrect FOL:     ∀x (Raven(x) ∧ Black(x))    ← asserts every single object
                                                   in the domain is BOTH a
                                                   raven AND black — almost
                                                   certainly false and not
                                                   what was intended

Intended meaning: "Some bird cannot fly."
Correct FOL:      ∃x (Bird(x) ∧ ¬Flies(x))
Incorrect FOL:     ∃x (Bird(x) → ¬Flies(x))     ← this is TRUE as long as
                                                    even one non-bird object
                                                    exists in the domain
                                                    (since the implication
                                                    is vacuously true for
                                                    any x that isn't a
                                                    bird), regardless of
                                                    whether any actual bird
                                                    can't fly
```

This exact ∀-uses-→ / ∃-uses-∧ pairing convention (rather than the reverse) is the standard, correct idiom precisely because a universal claim should be vacuously satisfied by objects outside its intended scope, while an existential claim needs to positively assert both properties hold together for at least one specific object.

### Example 3: applying the already-covered quantifier negation rule to a FOL sentence

```text
Original: ∀x (Student(x) → Studies(x))    ("every student studies")

Negation, step by step (¬∀x P(x) ≡ ∃x ¬P(x)):
  ¬∀x (Student(x) → Studies(x))
≡ ∃x ¬(Student(x) → Studies(x))
≡ ∃x ¬(¬Student(x) ∨ Studies(x))          [P→Q ≡ ¬P∨Q]
≡ ∃x (Student(x) ∧ ¬Studies(x))            [De Morgan's law]

Final: "there exists a student who does not study" — exactly the intuitive
negation of "every student studies," derived mechanically using nothing but
the quantifier-negation rule and De Morgan's law already covered as pure logic.
```

## Common Misconceptions & Pitfalls

- **"∀x (P(x) ∧ Q(x)) means the same thing as 'every P is Q.'"** As Example 2 shows, this incorrectly claims every object in the entire domain has both properties; "every P is Q" is correctly written with an implication, ∀x (P(x) → Q(x)), restricting the claim to just the objects satisfying P.
- **"∃x (P(x) → Q(x)) is a meaningful way to say 'some P is Q.'"** As Example 2 shows, this is vacuously true whenever the domain contains any object that simply isn't P, regardless of whether the intended relationship between P and Q holds anywhere; "some P is Q" needs a conjunction, ∃x (P(x) ∧ Q(x)).
- **"A function in FOL is the same kind of thing as a predicate."** A predicate returns true or false and can stand alone as (part of) a sentence; a function returns an object and can only appear as an argument to a predicate or another function — `FatherOf(Alice)` is not itself true or false, but `Professor(FatherOf(Alice))` is.
- **"FOL can express any pattern a human might want to state generally."** FOL quantifies over objects, not over predicates or relations themselves; genuinely second-order statements ("for every property...") are outside what first-order logic, as covered here, can directly express.

## Summary

First-order logic adds constants, variables, predicates, functions, and the universal/existential quantifiers already covered as pure discrete mathematics to propositional logic's connectives, letting a single sentence stand for a general pattern true of every (or some) object in a domain, rather than requiring a separate propositional fact per object. The standard idiom pairs ∀ with → and ∃ with ∧, precisely to avoid the vacuous-truth and over-generalization traps illustrated above, and the same quantifier-negation rules and De Morgan's laws already covered apply unchanged to FOL sentences. This added expressiveness — infinitely many facts expressed by one general rule — is exactly why FOL, not propositional logic, is the standard basis for knowledge representation in AI; the next concept covers how inference (unification and resolution) actually operates over sentences written in this richer language.

## Documentation Links

- [Russell & Norvig — Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html) — the canonical treatment of first-order logic's syntax and its added expressiveness over propositional logic.
- [UC Berkeley CS188 — Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/) — course covering first-order logic as the standard richer knowledge-representation formalism built on propositional logic's foundations.
