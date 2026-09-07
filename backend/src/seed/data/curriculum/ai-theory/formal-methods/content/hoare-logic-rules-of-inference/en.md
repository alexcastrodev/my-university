---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- State the assignment, sequence, conditional, and consequence rules of Hoare logic precisely.
- Explain why these rules are syntax-directed — each construct in the programming language gets exactly one matching proof rule.
- Choose a middle assertion for the sequence rule that makes both halves of a proof provable.
- Recognize the consequence rule as the point where ordinary logical entailment, not program syntax, enters every Hoare-logic proof.
- Derive a small program's correctness triple by composing these rules rather than by reasoning about every possible execution trace directly.

## Context & Motivation

`the-hoare-triple` established what `{P} C {Q}` means, but meaning alone doesn't supply a method for proving one true. Hoare's real insight — the one that turns the triple from a definition into a practical proof technique — is that every construct in a simple imperative language can be given its own local proof rule, so that proving a triple about a whole program reduces to combining the proofs of its parts, in a shape that mirrors the program's own syntax rather than requiring a fresh argument invented from scratch for each new program.

This matters because a program's structure is finite and known in advance, while the number of ways it could execute is not — a loop with an unknown number of iterations, or a sequence of many commands, could in principle require reasoning about arbitrarily many distinct execution paths if the alternative were to enumerate them directly. Syntax-directed proof rules sidestep that explosion entirely: an assignment is handled by exactly the assignment rule, a sequence of two commands by splitting the proof at one carefully chosen intermediate assertion, and a conditional by checking both of its branches once each — never by tracing through the concrete states a program passes through on some particular run.

This is the point in the discipline where the material starts to feel like a genuine calculus — a fixed, finite, mechanically applicable set of rules — rather than a loose collection of one-off worked examples, and that shift matters because everything from `loop-invariants-and-the-while-rule` through the automated verification-condition generators covered much later in this discipline is built directly on top of these same four rules, extended and automated but never fundamentally replaced.

## Core Theory

### Assignment rule

The assignment rule is deliberately backward-looking, and understanding why it runs backward is the key to using it correctly. To prove that a postcondition `Q` holds after the assignment `x := E` executes, the rule asks a different question than "what does x become": it asks what had to be true of the state *before* the assignment ran so that, once `x` is replaced everywhere in `Q` by the expression `E`, the resulting condition already held beforehand. Concretely, the required precondition is `Q` with every occurrence of `x` textually replaced by `E`, written `Q[E/x]`. This substitution-based formulation is what lets the rule avoid ever having to simulate the assignment on every possible state it might run from — the precondition is computed once, syntactically, and holds for the assignment's entire (potentially infinite) space of possible starting states simultaneously, rather than being checked state by state.

### Sequence rule

To prove a triple about two commands run one after another, `{P} C1; C2 {R}`, the sequence rule requires finding a single intermediate assertion `Q` that serves as the postcondition of `C1` and, at the very same time, the precondition of `C2`. Once such a `Q` is found, the original problem decomposes cleanly into two smaller, independent problems: prove `{P} C1 {Q}`, and separately prove `{Q} C2 {R}`. If both smaller triples can be proved, the sequence rule licenses combining them into the original triple about `C1; C2` together. The entire craft of applying this rule well lies in choosing `Q` — too weak, and it won't carry enough information forward for `C2`'s proof to reach `R`; too strong, and `C1`'s proof might fail to establish it in the first place. A useful heuristic, developed further in the worked examples below, is to compute forward from `P` through `C1` (what does `C1` guarantee, given `P`) and check that this matches what `C2` needs as its own precondition to reach `R`.

### Conditional rule

A conditional command executes exactly one of two branches, chosen by a runtime guard, and the conditional rule mirrors that structure directly in the proof. The `then` branch is proved under the precondition `P ∧ guard` — the original precondition strengthened with the extra fact that the guard was true, since that's exactly the situation this branch runs in. The `else` branch, symmetrically, is proved under `P ∧ ¬guard`. Both branch proofs are required to reach the *same* postcondition `Q`, and once both have been proved, the conditional rule licenses concluding `{P} if guard then C1 else C2 {Q}` for the whole command. This works because the guard and its negation are exhaustive and mutually exclusive — every state satisfying `P` satisfies either `guard` or `¬guard` and never both — so between the two branch proofs, every possible starting state satisfying `P` has genuinely been accounted for exactly once, with no case left unexamined and no case double-counted.

### Consequence rule

The first three rules are syntax-directed: each one applies to a specific command form and produces or consumes assertions of a specific shape dictated by that command. The consequence rule is different in kind — it doesn't correspond to any command at all, and it is the single place where ordinary logical entailment, rather than program structure, does the work. It says that if a stronger precondition `P` implies some already-proved precondition `P1` (that is, `P ⊨ P1`), and a weaker postcondition `Q1` (already proved to hold) implies the desired postcondition `Q` (that is, `Q1 ⊨ Q`), then a proof of `{P1} C {Q1}` can be adapted into a proof of `{P} C {Q}` without touching `C` or re-examining its execution at all — the adaptation is purely a matter of logical entailment on either side of an already-established triple. In practice, this rule is not a rare special case reserved for edge conditions; it is, in volume, where most of the actual logical work in a realistic Hoare-logic proof lives, because assertions computed mechanically by the other three rules very often need to be massaged — strengthened, weakened, or algebraically simplified — into the exact shape a subsequent step or the final goal requires, and the consequence rule is what licenses making that adjustment.

## Worked Examples

### Assignment inference rule

Written as an inference rule, the assignment rule has the shape:

```text
Q[E/x]
----------------
{Q[E/x]} x := E {Q}
```

meaning: if the precondition is exactly `Q` with `E` substituted for `x`, the triple `{Q[E/x]} x := E {Q}` is proved automatically, with no further argument needed. As a concrete instance, take the desired postcondition `Q: x > 5` and the command `x := y + 1`. Applying the substitution mechanically — replace every occurrence of `x` in `Q` with the expression `y + 1` — produces the required precondition `y + 1 > 5`. This says exactly what intuition demands: for the postcondition `x > 5` to hold once `x` is set to `y + 1`, it must have been true beforehand that `y + 1` itself exceeded 5, which simplifies (via the consequence rule, invoking ordinary arithmetic) to `y > 4`.

### Sequence proof sketch

Consider the two-command program `x := x + 1; y := x`, with the goal of proving `{x = 0} program {y = 1}`. Applying the sequence rule requires choosing an intermediate assertion that serves as both the postcondition of the first command and the precondition of the second. Working forward from the precondition through the first command: starting from `x = 0`, after `x := x + 1` runs, `x` holds `0 + 1 = 1` — so the natural middle assertion is `x = 1`. This choice is then checked on both sides independently. First triple: `{x = 0} x := x + 1 {x = 1}` — this follows directly from the assignment rule, since substituting `x + 1` for `x` in the postcondition `x = 1` gives the precondition `x + 1 = 1`, which the consequence rule simplifies to `x = 0`, matching exactly. Second triple: `{x = 1} y := x {y = 1}` — again by the assignment rule, substituting `x` for `y` in the postcondition `y = 1` gives the precondition `x = 1`, matching the chosen middle assertion exactly. Both halves check out independently, so the sequence rule licenses combining them into the full triple `{x = 0} program {y = 1}` — and notice that at no point was it necessary to trace through the program's actual runtime behavior; the entire proof was assembled from two applications of the assignment rule plus the bookkeeping of the sequence rule.

### Conditional proof sketch

Return to the conditional command `if x ≥ 0 then y := x else y := -x`, with the goal postcondition `y ≥ 0`, this time organized explicitly as an application of the conditional rule rather than as informal case analysis. The `then` branch is proved under `true ∧ x ≥ 0` (simplifying to `x ≥ 0`): the assignment `y := x` under this assumption needs precondition `x ≥ 0` for postcondition `y ≥ 0` by the assignment rule, which matches the branch assumption exactly. The `else` branch is proved under `true ∧ ¬(x ≥ 0)` (simplifying, via consequence, to `x < 0`): the assignment `y := -x` needs precondition `-x ≥ 0` for postcondition `y ≥ 0` by the assignment rule, and the consequence rule bridges the gap by noting `x < 0 ⊨ -x ≥ 0` (negating a negative number produces a nonnegative one). Both branches, proved independently under their respective, mutually exclusive assumptions, establish the same postcondition `y ≥ 0`, so the conditional rule concludes the full triple for the whole `if` command — a direct, rule-by-rule replay of the reasoning that was done informally, by cases, in `the-hoare-triple`.

## Common Misconceptions & Pitfalls

- **Using the assignment rule forward instead of backward.** A common early mistake is to substitute in the direction "compute the new value of x and plug that into the precondition," rather than the rule's actual direction, which substitutes the assigned expression into the *postcondition* to derive the precondition. Running the substitution the wrong way produces an assertion that accidentally refers to the new value of `x` in a context where the old value was actually required, silently invalidating the proof.
- **Choosing a middle assertion for sequencing that is too weak for the second command.** If the intermediate assertion `Q` chosen for the sequence rule doesn't carry forward enough information — for instance, dropping a bound or a relationship that `C1` actually established — then `{Q} C2 {R}` may turn out to be unprovable even though a stronger, correctly-chosen `Q` would have made both halves provable. Choosing `Q` well is a genuine design step, not a formality.
- **Checking only the branch that seems likely to execute at runtime.** The conditional rule requires *both* branches to be proved, independently, regardless of which one a particular run would actually take — skipping the "unlikely" branch leaves the proof incomplete for exactly the executions that do take it, and defeats the entire point of proving a universal claim over every possible execution.
- **Forgetting the consequence rule and trying to force every assertion to match syntactically.** Assertions produced mechanically by the assignment, sequence, and conditional rules very rarely arrive in exactly the syntactic shape needed for the next step or the final goal; the consequence rule is what licenses the ordinary logical simplification (arithmetic identities, weakening, strengthening) that bridges that gap, and refusing to use it in favor of forcing syntactic matches everywhere makes straightforward proofs needlessly awkward or even impossible to complete.

## Summary

Hoare's four rules — assignment, sequence, conditional, and consequence — make program verification compositional: each syntactic construct in the language contributes its own local proof obligation, computed mechanically from the construct's shape, and ordinary logical entailment (via the consequence rule) is what connects those local obligations into a single proof of the whole program. This syntax-directed structure is exactly what lets a proof of a Hoare triple avoid tracing through a program's actual execution at all, following the program's static structure instead — and it is the foundation that `loop-invariants-and-the-while-rule` extends next, adding the one construct — the loop — that the four rules covered here do not yet handle.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
