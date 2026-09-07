---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Loop Invariants and the While Rule in a formal-verification workflow.
- Explain how finding and using the assertion preserved by a loop changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

Loops are where testing and proof diverge most visibly. A test observes a few iteration counts; a proof must cover zero, one, and every larger number of iterations.

The invariant is the finite summary that makes this possible, exactly mirroring induction from Discrete Math.

The challenge is not applying the while rule once the invariant is known; the challenge is finding an invariant strong enough to imply the desired postcondition at loop exit.

## Core Theory

### The three obligations

- Initialization: the invariant holds before the first guard check.
- Preservation: assuming the invariant and guard before the body, the invariant holds after the body.
- Exit: invariant plus false guard implies the desired postcondition.

### While rule

```text
{I ∧ B} C {I}
- ------------------------------
- {I} while B do C {I ∧ ¬B}
```
- I is the invariant.
- B is the guard.
- C is the body.

### Induction connection

- Initialization is the base case.
- Preservation is the induction step.
- The number of loop iterations is arbitrary, but the proof is finite.

### How to find invariants

- Start from the postcondition and weaken it so it can hold before the loop finishes.
- Include bounds such as 0 ≤ i ≤ n.
- Include relationships between accumulated variables and the processed prefix.
- Avoid mentioning facts that the body does not preserve.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Summing numbers

- Program:
- i := 0; s := 0;
- while i < n do s := s + i; i := i + 1
- Postcondition: 2*s = n*(n - 1).
- Invariant: 0 ≤ i ≤ n ∧ 2*s = i*(i - 1).
- At exit, i ≥ n and i ≤ n, so i = n.
- Substitute i = n into the invariant to get the postcondition.

### Finding the missing bound

- Candidate invariant: 2*s = i*(i - 1).
- Problem: at exit we know ¬(i < n), so i ≥ n, but not i = n.
- Add bound i ≤ n.
- Now exit gives i = n.
- The arithmetic relation alone was true but too weak.

### Loop with zero iterations

- If n = 0, the sum loop body never runs.
- The invariant must still hold after initialization.
- With i = 0 and s = 0, 0 ≤ i ≤ n and 2*s = i*(i - 1) both hold.
- A correct invariant covers zero iterations automatically.

## Common Misconceptions & Pitfalls

- **Inventing** an invariant that is really only true at loop exit.
- **Forgetting** bounds on counters.
- **Proving** preservation but not initialization.
- **Assuming** a loop runs at least once.
- **Treating** invariant discovery as mechanical when it often requires the main human insight.

## Summary

Loop invariants are induction hypotheses for programs: prove they hold initially, survive each body execution, and combine with loop exit to yield the postcondition.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
