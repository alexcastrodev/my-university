---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Model Checking: Exhaustive State-Space Exploration in a formal-verification workflow.
- Explain how checking finite models by exhaustive reachability search changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

Once a finite transition system and temporal property are available, model checking turns verification into graph search.

Unlike testing, the search is exhaustive over the modeled reachable states, not sampled over hand-picked executions.

SPIN’s on-the-fly LTL checking illustrates the practical value: counterexamples are generated as traces that engineers can inspect.

## Core Theory

### Explicit-state exploration

- Start from the initial states.
- Repeatedly visit successors.
- Record visited states to avoid infinite revisiting of cycles.
- Check bad-state or automaton-product conditions during the search.

### Safety checking

- For AG ¬bad or □ ¬bad, search for reachable states labeled bad.
- If one is found, reconstruct the predecessor chain as a counterexample.
- If exploration finishes with no bad state, the finite model satisfies the safety property.

### Liveness checking

- Liveness requires reasoning about cycles.
- A counterexample often reaches a loop that avoids the desired event forever.
- Nested depth-first search is a classic explicit-state technique for this.

### On-the-fly checking

- The checker need not build the whole graph before finding a bug.
- It can generate successors as needed.
- This is crucial when the complete state space is much larger than the part containing a counterexample.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Reachable error

- Initial: Idle.
- Transitions: Idle → Busy, Busy → Error, Busy → Idle.
- Property: never Error.
- Search visits Idle, then Busy, then Error.
- The counterexample trace is Idle, Busy, Error.

### Two-process mutual exclusion

- State records each process location: Outside, Waiting, Critical.
- Bad state: both locations are Critical.
- The model checker explores all interleavings of process steps.
- If no bad state is reachable, mutual exclusion holds for the finite abstraction.

### Liveness lasso

- Trace prefix: Idle, Requested.
- Loop: Requested, Waiting, Requested, Waiting.
- Acknowledged never appears in the loop.
- This lasso refutes “every request is eventually acknowledged”.

## Common Misconceptions & Pitfalls

- **Calling** a random simulation run model checking.
- **Forgetting** to include environment transitions.
- **Checking** only safety when the requirement is liveness.
- **Assuming** no counterexample in a bounded search proves the unbounded property.

## Summary

Explicit-state model checking exhaustively explores the reachable graph of a finite model, proving properties or returning concrete counterexample traces.

## Documentation Links

- [SPIN — On-the-Fly LTL Model Checking](https://spinroot.com/spin/whatispin.html) — overview of SPIN and on-the-fly LTL model checking in practice.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
