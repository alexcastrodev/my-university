---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Weakest Preconditions in a formal-verification workflow.
- Explain how calculating what must be true before a command changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

Hoare rules can be read backward: start with the desired final assertion and compute what must have been true earlier.

That backward calculation is the weakest-precondition idea. It is the foundation of verification-condition generation in many automated program verifiers.

The word weakest matters: it means the least restrictive condition that still guarantees the postcondition, not the easiest condition to prove.

## Core Theory

### Definition

- wp(C, Q) is the weakest assertion P such that `{P} C {Q}` is valid for terminating executions of C.
- Any stronger assertion also works, but rejects more initial states.
- For straight-line code, wp can often be computed syntactically.

### Assignment

- For x := E, replace x in Q by E.
- This is the same idea as the Hoare assignment rule.
- The replacement talks about the old state before the assignment.

### Sequence and conditionals

- wp(C1; C2, Q) = wp(C1, wp(C2, Q)).
- For a conditional, combine guarded branches.
- The precondition says: if the guard is true then the then-branch precondition must hold, and if false then the else-branch precondition must hold.

### Loops

- General loops do not have a simple exact wp in ordinary first-order arithmetic.
- Tools use supplied invariants to generate obligations instead.
- This is one place undecidability enters practical verification.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Single assignment

- Command: x := x + 1.
- Desired postcondition: x > 10.
- Weakest precondition: x + 1 > 10.
- Simplified: x > 9.
- So any initial state with x > 9 is exactly enough.

### Sequence calculation

- Program: x := x + 1; y := 2*x.
- Postcondition: y > 20.
- Work backward:
- Before y := 2*x, need 2*x > 20.
- Before x := x + 1, need 2*(x + 1) > 20.
- Simplified: x > 9.

### Conditional calculation

- Program: if x ≥ 0 then y := x else y := -x.
- Postcondition: y ≥ 0.
- Then branch precondition: x ≥ 0.
- Else branch precondition: -x ≥ 0, which means x ≤ 0.
- Combined with branch guards, the whole precondition is true.

## Common Misconceptions & Pitfalls

- **Calling** a sufficient precondition the weakest one without checking whether it excludes unnecessary states.
- **Substituting** after an assignment in the wrong direction.
- **Expecting** exact weakest preconditions for arbitrary loops without invariants.
- **Forgetting** that arithmetic simplification is part of making the result readable.

## Summary

Weakest preconditions turn desired postconditions into prior obligations, giving automated verifiers a calculational path from code to logical verification conditions.

## Documentation Links

- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
