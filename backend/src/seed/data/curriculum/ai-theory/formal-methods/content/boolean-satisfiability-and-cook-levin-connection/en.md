---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Boolean Satisfiability and the Cook-Levin Connection in a formal-verification workflow.
- Explain how reducing finite verification questions to Boolean search changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

SAT sits at the meeting point of logic, complexity, and verification. A satisfying assignment is a certificate, and Cook-Levin says Boolean formulas can encode accepting computations.

Formal tools exploit the same idea at engineering scale: finite executions, bit-vector arithmetic, and many control-flow choices can be reduced to Boolean constraints.

The connection to Computability and Complexity is direct: NP is about efficiently checkable certificates, and SAT is the canonical NP-complete problem.

## Core Theory

### SAT

- Input: a Boolean formula.
- Question: is there an assignment of true and false values that makes it true?
- UNSAT means no such assignment exists, often corresponding to a proved absence of counterexamples.

### CNF and clauses

- Many SAT solvers operate on conjunctive normal form.
- A CNF formula is an AND of clauses.
- Each clause is an OR of literals.
- Transformations preserve satisfiability even when they introduce helper variables.

### Cook-Levin intuition

- A bounded computation can be represented as a tableau of time steps and tape or state positions.
- Local consistency constraints ensure each row follows from the previous row.
- A satisfying assignment is exactly an accepting computation history.

### Verification use

- Bounded model checking encodes paths of length k as SAT.
- Bug finding asks whether a bad state is reachable within the bound.
- If the formula is satisfiable, the assignment decodes into a concrete trace.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Small formula

- Formula: (a ∨ b) ∧ (¬a ∨ c).
- Assignment: a = true, b = false, c = true.
- First clause is true because a is true.
- Second clause is true because c is true.
- The formula is satisfiable.

### Reachability as SAT

- State bit s means the system is Busy.
- Initial constraint: s0 = false.
- Transition constraint: s1 = true when start0 = true.
- Bad-state constraint: s1 = true.
- A satisfying assignment with start0 = true is a one-step counterexample.

### UNSAT as proof

- Property: no state is both Locked and Unlocked.
- Constraint: Locked ∧ Unlocked plus invariant Unlocked ↔ ¬Locked.
- No Boolean assignment satisfies both.
- UNSAT proves the bad combination is impossible in the encoded model.

## Common Misconceptions & Pitfalls

- **Thinking** NP means “not polynomial” rather than “certificates checkable in polynomial time”.
- **Confusing** SAT with validity; SAT asks whether some assignment works.
- **Forgetting** that bounded encodings only cover the chosen number of steps.
- **Assuming** a SAT model of machine integers behaves like mathematical integers.

## Summary

SAT reduces finite verification questions to Boolean search; Cook-Levin explains why such encodings are expressive enough to represent bounded computations.

## Documentation Links

- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
