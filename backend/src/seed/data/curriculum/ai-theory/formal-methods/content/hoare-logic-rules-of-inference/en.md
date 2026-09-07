---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Hoare Logic: Rules of Inference in a formal-verification workflow.
- Explain how deriving program proofs with syntax-directed rules changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

The triple is only useful if there is a disciplined way to prove it. Hoare’s insight was that each programming construct should come with a proof rule.

The resulting proofs are syntax-directed: an assignment is handled by the assignment rule, a sequence by splitting at the middle assertion, and a conditional by checking both branches.

This is the first place the course feels like a calculus rather than a collection of examples.

## Core Theory

### Assignment rule

- To prove a postcondition after x := E, make the precondition be the postcondition with E substituted for x.
- This rule is backward-looking: it asks what had to be true before the assignment so Q is true after it.
- It avoids executing the assignment on every possible state.

### Sequence rule

- To prove `{P} C1; C2 {R}`, find a middle assertion Q.
- Prove `{P} C1 {Q}` and `{Q} C2 {R}`.
- The art is choosing Q so the two smaller proofs meet.

### Conditional rule

- The then branch gets the precondition P ∧ guard.
- The else branch gets P ∧ ¬ guard.
- Both branches must establish the same postcondition.

### Consequence rule

- If P is strong enough to imply P1, and Q1 is strong enough to imply Q, a proven triple `{P1} C {Q1}` can be adapted.
- This is where ordinary logical entailment enters every program proof.
- Most verification conditions are consequence obligations.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Assignment inference rule

```text
Q[E/x]
----------------
{Q[E/x]} x := E {Q}
```
- Read Q[E/x] as “replace x in Q by E”.
- For Q: x > 5 and command x := y + 1, the required precondition is y + 1 > 5.

### Sequence proof sketch

- Program:
- x := x + 1; y := x
- Goal:
- {x = 0} program {y = 1}
- Middle assertion after first command: x = 1.
- First triple: {x = 0} x := x + 1 {x = 1}.
- Second triple: {x = 1} y := x {y = 1}.

### Conditional proof sketch

- Program:
- if x ≥ 0 then y := x else y := -x
- Goal postcondition: y ≥ 0.
- Then branch assumes x ≥ 0 and assigns y := x.
- Else branch assumes x < 0 and assigns y := -x.
- Both establish y ≥ 0, so the whole conditional does.

## Common Misconceptions & Pitfalls

- **Using** the assignment rule forward and accidentally referring to the new value where the old value is required.
- **Choosing** a middle assertion for sequencing that is too weak for the second command.
- **Checking** only the branch that seems likely to execute.
- **Forgetting** the consequence rule and trying to force every assertion to match syntactically.

## Summary

Hoare rules make verification compositional: each command form contributes a local proof obligation, and ordinary logical implication connects the pieces.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
