---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Read `{P} C {Q}` as a partial-correctness claim about all terminating executions of command C.
- Separate the pre-state assertion P from the post-state assertion Q.
- Explain why a nonterminating command can make a partial-correctness triple vacuously true.
- Connect Hoare triples to operational semantics without enumerating every execution step.
- Refute an invalid triple by giving one concrete starting state and final state.

## Context & Motivation

Operational semantics explains how commands step from state to state. Hoare logic abstracts over those steps and asks which assertions are guaranteed before and after a command.

The triple is not a test case and not a type annotation. It is a theorem-shaped claim about every terminating execution from every state satisfying the precondition.

This is where Discrete Math and Logic becomes software reasoning: a triple is proved by logical argument, while Computability reminds us that no complete automatic prover exists for every possible command and assertion.

## Core Theory

### Syntax of the triple

- The form is `{P} C {Q}`.
- P is the precondition over the initial state.
- C is the command being verified.
- Q is the postcondition over the final state.
- The braces are notation for assertions, not runtime syntax.

### Partial-correctness meaning

- If C starts in a state satisfying P and C terminates, then the final state satisfies Q.
- The condition “if C terminates” is part of the meaning.
- Termination must be proved separately for total correctness.
- A false precondition can make a triple true but useless.

### Connection to operational semantics

- Small-step semantics gives individual transitions.
- Hoare logic gives compositional proof rules for whole commands.
- Soundness says every derivable triple is true for the operational semantics.
- This lets a proof follow program syntax instead of every possible trace.

### Counterexamples

- A triple is false when one terminating execution starts in P and ends outside Q.
- One counterexample state is enough.
- Counterexamples are often easier to understand than failed symbolic proof logs.
- Good verification tools try to report them concretely.

## Worked Examples

### Assignment triple

- Triple:
```text
{x ≥ 0} y := x + 1 {y > 0}
```
- After assignment, y has the old value of x plus one.
- Since old x ≥ 0, new y > 0.
- The command terminates, so this triple is also total for this one command.

### Invalid triple

- Claim:
```text
{x ≥ 0} y := x - 1 {y ≥ 0}
```
- Counterexample initial state: x = 0.
- After assignment, y = -1.
- The postcondition y ≥ 0 is false.
- Therefore the triple is invalid.

### Conditional absolute value

- Command:
```text
if x ≥ 0 then y := x else y := -x
```
- Goal: {true} command {y ≥ 0}.
- Then branch assumes x ≥ 0 and assigns y := x.
- Else branch assumes x < 0 and assigns y := -x.
- Both branches establish y ≥ 0.

## Common Misconceptions & Pitfalls

- **Reading** a Hoare triple as a termination guarantee.
- **Forgetting** that P and Q refer to different states.
- **Treating** a true triple as proof of an unstated requirement.
- **Using** one example state as if it established a universal claim.
- **Ignoring** false or impossible preconditions.

## Summary

A Hoare triple is a partial-correctness theorem about a command: under precondition P, every terminating execution of C ends in a state satisfying Q.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
