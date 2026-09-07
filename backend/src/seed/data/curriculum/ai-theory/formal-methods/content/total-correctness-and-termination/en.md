---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Total Correctness and Termination in a formal-verification workflow.
- Explain how adding termination to partial-correctness proofs changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

Partial correctness proves that terminating executions end well; total correctness also proves that execution really does terminate.

The Halting Problem says there can be no complete automatic termination checker for all programs. Practical proof therefore relies on variants, ranking functions, and restricted program forms.

This concept makes that computability boundary concrete inside ordinary while loops.

## Core Theory

### Partial versus total correctness

- Partial correctness: if the command terminates, the postcondition holds.
- Termination: the command cannot run forever from states satisfying the precondition.
- Total correctness is the conjunction of both.

### Variants

- A variant is a nonnegative measure that decreases on every loop iteration.
- For integer loops, a natural-number expression such as n - i is common.
- The measure must be bounded below so it cannot decrease forever.

### Ranking functions

- A ranking function maps program states into a well-founded order.
- Every transition in the loop must strictly decrease the ranking.
- Well-foundedness rules out infinite descending chains.

### Undecidability boundary

- Some loops terminate for subtle reasons.
- Some loops terminate only under number-theoretic assumptions.
- No general algorithm can always decide termination for arbitrary programs and inputs.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Countdown loop

- Program:
- while x > 0 do x := x - 1
- Precondition: x ≥ 0.
- Variant: x.
- Each iteration starts with x > 0 and decreases x by one.
- Because x remains a nonnegative integer, the loop terminates.

### A partial-correctness trap

- Program:
- while true do skip
- Postcondition: x = x.
- Partial correctness holds for any precondition because there is no terminating bad final state.
- Total correctness fails because the loop never terminates.
- This is why termination is not a detail.

### Euclidean-style descent

- In algorithms that repeatedly replace a larger value by a smaller remainder, a variant can be the second argument or the sum of both arguments.
- The proof must show strict decrease on every iteration.
- It must also show the measure never leaves the well-founded domain.
- Both facts are required.

## Common Misconceptions & Pitfalls

- **Assuming** an apparently decreasing variable is always nonnegative.
- **Proving** the postcondition and forgetting termination.
- **Using** a variant that sometimes stays the same.
- **Expecting** tools to discover termination arguments for arbitrary loops.

## Summary

Total correctness adds a termination proof to partial correctness, usually by showing a well-founded measure decreases on every loop iteration.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
