---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the role of Theorem Proving and Proof Assistants in a formal-verification workflow.
- Explain how building machine-checked proofs with human guidance changes a vague correctness claim into a precise mathematical obligation.
- Connect the concept back to propositional logic, first-order predicates, or induction from Discrete Math and Logic.
- Identify where automation is sound, where it is incomplete, and where a human-supplied specification or invariant is required.
- Work through a small program or transition-system example without relying on unstated assumptions.

## Context & Motivation

Automated solvers are strongest when obligations fall inside well-engineered decidable fragments. Proof assistants address the larger space by letting humans write the proof while the machine checks every step.

Software Foundations exemplifies this style: definitions, programs, theorems, and proofs live in one formal environment.

The connection to type checking is deep because Curry-Howard reads propositions as types and proofs as programs inhabiting those types.

## Core Theory

### Interactive theorem proving

- The user states definitions and theorems.
- The assistant checks each proof step against a small trusted kernel.
- Automation helps with routine goals but does not replace proof design.

### Curry-Howard

- A proposition corresponds to a type.
- A proof corresponds to a term of that type.
- Checking a proof resembles type checking a program.
- This is why proof assistants and programming-language theory are tightly linked.

### Program verification in assistants

- Programs can be modeled as functions, relations, or commands with Hoare rules.
- Theorems state their correctness.
- Loop invariants and lemmas become explicit proof artifacts.

### Trust base

- The kernel, parser, libraries, extraction mechanism, and model assumptions all matter.
- A small kernel reduces the most critical trusted code.
- Machine-checked does not mean assumption-free.

### Verification workflow checklist

- Name the program variables or model state components.
- State the precondition, invariant, temporal property, or theorem before starting the proof.
- Decide whether the claim is about one final state, all reachable states, or entire execution traces.
- Record the execution model: mathematical integers, bit-vectors, nondeterministic scheduling, finite bounds, or abstract transitions.
- Generate the local proof obligations or state-space search target.
- Inspect counterexamples as structured evidence, not just failure messages.

## Worked Examples

### Proof as a checked object

- Claim: appending an empty list does not change a list.
- A proof assistant requires induction on the list structure.
- Base case: empty list.
- Step case: preserve the head and apply the induction hypothesis to the tail.
- The machine checks that no case is skipped.

### Hoare proof in a library

- Define commands and states.
- Define `{P} C {Q}` semantically.
- Prove assignment, sequence, and while rules once.
- Use those rules to verify individual programs.
- The rules themselves become trusted theorems, not informal diagrams.

### Progress and preservation echo

- A type-safety proof has progress and preservation lemmas.
- Each lemma is stated and checked in the assistant.
- The final theorem combines them.
- This mirrors program-correctness proofs that combine local lemmas into a global guarantee.

## Common Misconceptions & Pitfalls

- **Thinking** proof assistants automatically find the whole proof.
- **Ignoring** the assumptions imported from libraries or models.
- **Equating** type checking with full functional correctness.
- **Writing** definitions that are convenient to prove but do not match the intended system.

## Summary

Proof assistants support formal verification beyond push-button automation by checking human-guided proofs as precise, reusable mathematical artifacts.

## Documentation Links

- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
