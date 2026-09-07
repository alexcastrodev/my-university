---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Translate informal requirements into propositional and first-order assertions over program states.
- Use connectives ¬, ∧, ∨, →, and ↔ to combine smaller claims precisely.
- Use bounded quantifiers to specify arrays, heaps, and collections without ambiguity.
- Distinguish satisfiability, validity, and entailment in verification obligations.
- Recognize when logical expressiveness helps specification but makes automation harder.

## Context & Motivation

Before Hoare triples can be proved or model-checking properties can be evaluated, assertions such as x ≥ 0, sorted(a), and “every request is eventually acknowledged” must be written precisely.

Propositional logic handles Boolean structure; first-order logic adds variables, predicates, functions, and quantifiers. The concepts are familiar from Discrete Math and Logic, but the interpretation is now over program states and executions.

The connection to Computability and Complexity is already visible: richer formulas say more, but a tool that could decide every semantic formula about every program would contradict the undecidability results already proved.

## Core Theory

### Assertions over states

- An assertion is evaluated in a particular state.
- The assertion x < y may be true in one state and false in another.
- Verification rules transform assertions as commands transform states.
- A state assertion should mention only the variables and model components it needs.

### Propositional structure

- Conjunction P ∧ Q requires both claims.
- Disjunction P ∨ Q allows either claim.
- Implication P → Q is the shape of many proof obligations.
- Equivalence P ↔ Q supports rewriting and simplification.

### First-order predicates

- Predicates name properties of values, such as sorted(a, n) or owns(user, file).
- Universal quantifiers express “all relevant elements”.
- Existential quantifiers express “there is a witness”.
- Bounds must be explicit so the formula ranges over the intended domain.

### Entailment and satisfiability

- P ⊨ Q means every state satisfying P also satisfies Q.
- A formula is satisfiable when at least one state makes it true.
- A formula is valid when every state makes it true.
- Many verifiers prove P ⊨ Q by showing P ∧ ¬Q is unsatisfiable.

## Worked Examples

### A propositional obligation

- Known assertion: x ≥ 5.
- Needed assertion: x > 0.
- Every state satisfying x ≥ 5 also satisfies x > 0.
- So the entailment holds.
- This is the logical work behind a consequence step in Hoare logic.

### A sortedness predicate

- For an array a of length n, one specification is:
```text
∀ i. ∀ j. 0 ≤ i ≤ j < n → a[i] ≤ a[j]
```
- The quantifiers range over indices.
- The bound 0 ≤ i ≤ j < n prevents out-of-range references.
- The implication says only valid index pairs matter.

### Negating a safety property

- Safety claim: every reachable state satisfies balance ≥ 0.
- Negated search condition: some reachable state satisfies balance < 0.
- A model checker or solver often looks for the negation.
- A found witness is a counterexample, not just a failed proof attempt.

## Common Misconceptions & Pitfalls

- **Using** implication as if it meant time or causation.
- **Forgetting** the state in which an assertion is evaluated.
- **Writing** an existential claim when the requirement is universal.
- **Leaving** array and heap quantifier bounds implicit.
- **Confusing** satisfiable with valid.

## Summary

Logic gives specifications their precision: connectives structure claims, predicates describe states, quantifiers range over values, and entailment turns those formulas into verification obligations.

## Documentation Links

- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
