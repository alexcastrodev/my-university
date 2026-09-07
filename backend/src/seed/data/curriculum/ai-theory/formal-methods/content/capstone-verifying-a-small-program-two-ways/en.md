---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Capstone: Verifying a Small Program Two Ways in a formal-verification workflow.
- Explain how combining Hoare logic and model checking on one example changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

The capstone puts the discipline’s two main styles side by side. One proof uses Hoare logic and a loop invariant; the other uses finite-state exploration of a bounded model.

The point is not that one method wins universally. The point is that each method gives a different kind of confidence under different assumptions.

The same specification language from the beginning now anchors both approaches.

## Core Theory

### Program and requirement

- Program: compute the sum of integers from 0 up to n - 1.
- Precondition: n ≥ 0.
- Postcondition: 2*s = n*(n - 1).
- For Hoare logic, n is an arbitrary mathematical integer satisfying the precondition.
- For model checking, n is bounded to a small finite range.

### Hoare proof plan

- Initialize i and s to zero.
- Use invariant 0 ≤ i ≤ n ∧ 2*s = i*(i - 1).
- Prove initialization, preservation, and exit.
- Add a termination variant n - i for total correctness.

### Model-checking plan

- Choose a bound such as 0 ≤ n ≤ 3.
- Make states record n, i, s, and program counter.
- Explore every reachable state.
- Check that every terminal state satisfies the postcondition.

### Comparison

- Hoare proof covers all n but needs an invariant and arithmetic proof.
- Model checking is automatic after modeling but covers only the finite bound unless generalized.
- Both depend on the same intended specification.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### The program

```text
i := 0;
s := 0;
while i < n do
    s := s + i;
    i := i + 1
```
- Desired final relation: 2*s = n*(n - 1).

### Hoare invariant proof

- Initialization: i = 0 and s = 0, so 2*s = 0 and i*(i - 1) = 0.
- Preservation: assume 2*s = i*(i - 1) and i < n.
- After s := s + i, the new sum is s + i.
- After i := i + 1, the needed relation is 2*(s + i) = (i + 1)*i.
- This follows from 2*s = i*(i - 1).
- Exit: invariant and ¬(i < n) give i = n, so the postcondition follows.

### Finite model-checking view

- For n = 3, reachable loop-head states include:
- (i=0, s=0)
- (i=1, s=0)
- (i=2, s=1)
- (i=3, s=3)
- The terminal state satisfies 2*s = 6 and n*(n - 1) = 6.
- The checker repeats this exploration for every bounded n.

## Common Misconceptions & Pitfalls

- **Claiming** the bounded model check proves all n without an induction argument.
- **Forgetting** termination in the Hoare proof.
- **Using** different specifications for the two methods.
- **Treating** the invariant as obvious instead of proving preservation.

## Summary

The capstone verifies one summation program deductively for arbitrary n and exhaustively for bounded n, exposing the complementary strengths of Hoare logic and model checking.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [SPIN — On-the-Fly LTL Model Checking](https://spinroot.com/spin/whatispin.html) — overview of SPIN and on-the-fly LTL model checking in practice.
