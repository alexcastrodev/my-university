---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define `wp(C, Q)` as the weakest assertion `P` for which `{P} C {Q}` is a valid partial-correctness triple.
- Explain precisely why "weakest" means least restrictive, not easiest to state or easiest to prove.
- Compute weakest preconditions for assignment, sequence, and conditional commands using calculational, syntax-directed rules.
- Explain why general loops resist an exact syntactic weakest precondition, and why tools substitute a supplied invariant instead.
- Carry out a complete backward calculation of a weakest precondition through a short sequence of statements.

## Context & Motivation

`hoare-logic-rules-of-inference` proved triples forward, in the sense that each rule takes an already-known precondition and derives a postcondition, or checks a proposed postcondition against a proposed precondition. Weakest preconditions run the same machinery in the opposite direction: start from a *desired* postcondition — the property the code is supposed to establish — and calculate exactly what must have been true beforehand for that postcondition to be guaranteed. This reversal turns out to be enormously useful in practice, because it is precisely how automated verifiers work: given a program annotated with a target postcondition (and, for loops, a supplied invariant), a weakest-precondition calculator walks backward through the code, generating a single logical formula — the verification condition — whose validity is exactly equivalent to the program meeting its specification.

The word "weakest" is doing real, precise technical work here and deserves to be taken literally rather than read as a vague synonym for "minimal" or "simplest." Among all the assertions `P` for which `{P} C {Q}` holds, the weakest one is the *least restrictive* — the one satisfied by the largest possible set of states — because it excludes only the states that genuinely have to be excluded for the postcondition to be guaranteed, and no more. This matters practically: a stronger-than-necessary precondition silently rejects legitimate callers who would actually have been fine, while the weakest precondition accepts every caller that could possibly work, which is exactly the property that makes it the right target for an automated tool trying not to reject valid programs unnecessarily.

## Core Theory

### Definition

`wp(C, Q)` denotes the weakest assertion `P` such that the triple `{P} C {Q}` is valid, restricted to terminating executions of `C` — this qualifier matters, and total-correctness weakest preconditions, which additionally require termination, are treated as a distinct and stronger notion once `total-correctness-and-termination` introduces them. Any assertion stronger than `wp(C, Q)` — that is, any assertion implying it — also makes `{P} C {Q}` valid, simply because a stronger precondition only ever rules out states that a weaker one already handled correctly; it never invalidates a triple that was already true. The practical payoff of computing the *weakest* one specifically, rather than some sufficient-but-stronger precondition, is that for the straight-line fragment of a programming language — assignments, sequences, and conditionals without loops — `wp` can be computed exactly and mechanically, syntax by syntax, with no creative insight required at all; this is in sharp contrast to loop invariants, which usually do require insight, as the loop case below makes explicit.

### Assignment

For an assignment `x := E`, the weakest precondition for postcondition `Q` is obtained by substituting `E` for every occurrence of `x` in `Q`: `wp(x := E, Q) = Q[E/x]`. This is not a new idea introduced for the first time here — it is exactly the same substitution the Hoare-logic assignment rule already used, simply relabeled as a function computing a precondition from a postcondition rather than as an inference-rule premise. The substitution is evaluated with respect to the *old* state, the one that existed just before the assignment ran — a detail easy to state but easy to get backward in practice, and flagged explicitly among the misconceptions below because getting the direction of substitution wrong is one of the most common early errors in applying this rule.

### Sequence and conditionals

For two commands run in sequence, the weakest precondition composes by nesting: `wp(C1; C2, Q) = wp(C1, wp(C2, Q))`. Reading this from the inside out makes the calculation concrete: first compute the weakest precondition `C2` needs in order to reach `Q`, then treat *that* result as the target postcondition for `C1`, and compute `C1`'s weakest precondition for reaching it. This nesting is what makes weakest-precondition calculation for a whole sequence of statements a single mechanical, right-to-left sweep rather than requiring any guess about an intermediate assertion — in contrast to the Hoare-logic sequence rule, which required *choosing* a middle assertion, `wp` computes that middle assertion automatically as a byproduct of the calculation, with no choice left open. For a conditional, the weakest precondition combines both branches into a single formula: the precondition must guarantee that whichever branch actually executes, that branch's own weakest precondition for `Q` is satisfied — concretely, `(guard → wp(C1, Q)) ∧ (¬guard → wp(C2, Q))`, requiring the `then`-branch's precondition whenever the guard holds and the `else`-branch's precondition whenever it doesn't.

### Loops

Straight-line code has an exact, purely syntactic weakest precondition because a fixed program text corresponds to a fixed, finite calculation. A general `while` loop breaks this cleanly: expressing its exact weakest precondition in ordinary first-order arithmetic would, in general, require expressing "the postcondition holds after however many iterations this particular execution happens to take," and for an unbounded, input-dependent iteration count, that statement is not always expressible as a finite first-order formula at all. This is not a gap that better engineering closes — it is a direct manifestation of the same undecidability boundary that has run through this discipline since `testing-shows-presence-proof-shows-absence`. Practical tools respond by not attempting to compute an exact `wp` for a loop automatically; instead, they ask the human author to supply a loop invariant (exactly the invariant introduced in `loop-invariants-and-the-while-rule`), and the tool then generates the initialization, preservation, and exit obligations as verification conditions built *around* that supplied invariant, discharging each one — often automatically, via the SMT solvers covered later in this discipline — rather than computing `wp` for the loop directly.

## Worked Examples

### Single assignment

Command: `x := x + 1`. Desired postcondition: `x > 10`. Applying the assignment rule directly: substitute `x + 1` for `x` in the postcondition, giving `wp(x := x+1, x > 10) = (x + 1) > 10`. This simplifies, by ordinary arithmetic, to `x > 9`. So any state with `x > 9` beforehand — and, importantly, *only* such states — is exactly enough to guarantee `x > 10` afterward; a state with `x = 9` would give `x = 10` after the assignment, which fails the strict inequality, confirming that `x > 9` really is the boundary, not merely a safe overestimate of it.

### Sequence calculation

Command: `x := x + 1; y := 2*x`. Desired postcondition: `y > 20`. Following the nested definition `wp(C1; C2, Q) = wp(C1, wp(C2, Q))`, the calculation proceeds strictly right to left, one statement at a time, exactly like an algebraic derivation:

```text
wp(y := 2*x, y > 20)          =  2*x > 20
wp(x := x + 1, 2*x > 20)      =  2*(x + 1) > 20
```

The first line applies the assignment rule to the second (rightmost) statement, substituting `2*x` for `y` in the postcondition. The second line then treats `2*x > 20` as the new target postcondition and applies the assignment rule again, this time to the first statement, substituting `x + 1` for `x`. Simplifying `2*(x + 1) > 20` by ordinary algebra gives `2*x + 2 > 20`, hence `2*x > 18`, hence `x > 9`. So `wp(x := x + 1; y := 2*x, y > 20) = x > 9`, computed as a single calculational chain with no guessed intermediate assertion at any point — the entire middle assertion `2*x > 20` fell out of the mechanical substitution rather than requiring the kind of choice the Hoare-logic sequence rule demanded.

### Conditional calculation

Command: `if x ≥ 0 then y := x else y := -x`. Desired postcondition: `y ≥ 0`. Each branch's own weakest precondition is computed first, independently, by the assignment rule: the `then` branch needs `wp(y := x, y ≥ 0) = x ≥ 0`; the `else` branch needs `wp(y := -x, y ≥ 0) = -x ≥ 0`, which simplifies to `x ≤ 0`. Combining both branches via the conditional formula: `(x ≥ 0 → x ≥ 0) ∧ (x < 0 → x ≤ 0)`. Both implications are logically trivial once stated this way — the first has an identical antecedent and consequent, and the second's antecedent already implies its consequent directly — so the whole conjunction simplifies, via the consequence rule's ordinary logical reasoning, to `true`: the command establishes `y ≥ 0` no matter what value `x` starts with, requiring no precondition on `x` at all. This matches, from the opposite calculational direction, exactly what the case-split proof in `the-hoare-triple` and `hoare-logic-rules-of-inference` already established for this same command by direct case analysis — a useful cross-check that the two proof styles agree.

## Common Misconceptions & Pitfalls

- **Calling a sufficient precondition "the weakest one" without checking whether it excludes unnecessary states.** A precondition that makes a triple valid is not automatically the weakest such precondition — as the single-assignment example shows, `x > 100` would also make `{x > 100} x := x+1 {x > 10}` valid, but it needlessly excludes states like `x = 20` that the true weakest precondition `x > 9` correctly admits; "sufficient" and "weakest" are different claims, and only the calculational procedure above, not a plausible-looking guess, actually computes the latter.
- **Substituting after an assignment in the wrong direction.** As with the ordinary Hoare-logic assignment rule, the substitution in `wp(x := E, Q) = Q[E/x]` replaces `x` in the *postcondition* to produce the *precondition* — reversing this and substituting into the precondition to "predict" the postcondition computes something else entirely, and is one of the most common ways this calculation goes wrong for someone applying it for the first time.
- **Expecting an exact, syntactic weakest precondition for an arbitrary loop without a supplied invariant.** As the Core Theory section explains, this is not a missing feature of any particular tool — it runs directly into the same undecidability that rules out a universal verifier, and every real weakest-precondition-based tool asks for a human-supplied invariant for exactly this reason, generating verification conditions around it rather than attempting to derive it.
- **Forgetting that arithmetic simplification is a genuine part of the result, not an optional afterthought.** The raw output of the substitution rules — `2*(x+1) > 20` in the sequence example, for instance — is logically correct but often unreadable or hard to feed to a downstream solver until it is simplified using ordinary algebraic identities; skipping this step doesn't make the calculation wrong, but it makes the result far harder to use or verify by inspection.

## Summary

Weakest preconditions run Hoare-logic reasoning backward: starting from a desired postcondition, `wp(C, Q)` calculates the least restrictive condition that must have held beforehand, computed exactly and mechanically for assignment, sequence, and conditional commands via syntax-directed substitution rules, as the sequence-calculation worked example demonstrated end to end. Loops are the one construct where this exact calculation breaks down, for the same undecidability reasons that have run through this discipline from the start, which is why practical tools substitute a human-supplied loop invariant and generate verification conditions around it instead of attempting to derive `wp` for the loop automatically. This calculational, backward style is precisely the technique that verification-condition generators — the automated front end to the SAT and SMT solvers covered later in this discipline — are built on.

## Documentation Links

- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
