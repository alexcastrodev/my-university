---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define preconditions, postconditions, representation invariants, and loop invariants as predicates over states.
- Separate caller obligations from implementation promises in a software contract.
- Judge whether a specification is too weak, too strong, or too implementation-specific.
- Use invariants to express facts that must survive internal steps, not just hold at the end.
- Connect specification writing to the predicate logic already developed in Discrete Math and Logic.

## Context & Motivation

Testing practice already used expected outputs. Formal methods generalize that habit into contracts precise enough for a proof engine, solver, or human proof to check.

A precondition says what may be assumed before execution; a postcondition says what must be true after execution; an invariant says what remains true through a region of computation. Without these, “correct” is only a compliment, not a theorem.

The computability boundary matters here too: because a tool cannot infer every semantic intention automatically, useful verification begins with humans stating the right predicates.

## Core Theory

### States and predicates

- A state maps program variables to values.
- A predicate over states is a true-or-false assertion such as n ≥ 0 ∧ i ≤ n.
- Specifications are predicates over many possible states, not examples of one state.
- The same predicate can be true before one command and false after another.

### Preconditions

- A precondition records what the caller must establish before calling or executing code.
- A weak precondition accepts more callers but can make proof harder.
- A strong precondition can make proof easy while making the operation less useful.
- Missing preconditions often appear as division by zero, array bounds failures, or invalid protocol states.

### Postconditions

- A postcondition records what the command promises if it returns normally.
- Good postconditions express externally visible behavior, not private implementation details.
- For sorting, “output is sorted and is a permutation of input” is stronger and more useful than “the first element is small”.
- For security, “secret never appears on the public channel” is a trace property, not just a final-state condition.

### Invariants

- A loop invariant must hold before the loop guard and after every body execution.
- A representation invariant must hold before and after every public operation of an abstract data type.
- A protocol invariant must hold in every reachable state of a transition system.
- Invariants are how local reasoning scales to unbounded repetition or many operations.

## Worked Examples

### Integer division contract

- Procedure: div(n, d).
- Necessary precondition: d ≠ 0.
- If exact division is intended, one postcondition is result * d = n.
- If truncating division is intended, the contract must instead mention quotient, remainder, and bounds on the remainder.
- The phrase “divide n by d” is not precise enough to verify.

### Stack representation invariant

- Representation: array data and integer top.
- Invariant: 0 ≤ top ≤ capacity.
- Push precondition: top < capacity.
- Push postcondition: top increases by one and the new element is at the old top position.
- Pop precondition: top > 0.
- Every operation must preserve 0 ≤ top ≤ capacity.

### Strengthening a weak postcondition

- Weak postcondition for absolute value: result ≥ 0.
- Problem: a function that always returns 0 satisfies it but is not absolute value.
- Better postcondition: result ≥ 0 ∧ (result = x ∨ result = -x).
- That relates output to input and rules out the constant-zero implementation for most inputs.

## Common Misconceptions & Pitfalls

- **Writing** examples when a universal predicate is needed.
- **Making** the precondition so strong that almost no caller may use the operation.
- **Letting** the postcondition mention private implementation details clients should not depend on.
- **Calling** the loop guard an invariant; the guard and invariant play different roles.
- **Omitting** frame conditions, so it is unclear which variables must not change.

## Summary

Specifications are the contract layer of formal verification: preconditions state assumptions, postconditions state promises, and invariants state facts preserved across internal computation.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
