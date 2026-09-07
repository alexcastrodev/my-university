---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Read `{P} C {Q}` as a partial-correctness claim about every terminating execution of command `C`, not as a test case or a type annotation.
- Separate the pre-state assertion `P` from the post-state assertion `Q`, and explain precisely what point in execution each one describes.
- Explain why a nonterminating command can make a partial-correctness triple vacuously true, and why that is a feature of the definition rather than a loophole.
- Connect Hoare triples to operational semantics without needing to enumerate every individual execution step by hand.
- Refute an invalid triple with one concrete starting state and its resulting final state, rather than a general argument.

## Context & Motivation

`logic-for-specification-propositional-and-first-order` supplied the language — connectives, predicates, quantifiers — that assertions like `P` and `Q` are written in. Operational semantics, from Programming Languages, separately explains *how* a command steps from one state to the next, one small step at a time. The Hoare triple is the concept that connects these two: it abstracts away from the individual steps of operational semantics and asks a single, higher-level question — given everything that could happen as `C` runs, what relationship is guaranteed to hold between the state it started in and the state it ends in?

It is worth being explicit about what the triple is *not*, because the temptation to misread it runs in several directions at once. It is not a test case, because it makes a claim about every state satisfying `P`, not one specific state. It is not a type annotation, because it says nothing about the shape or type of values, only about logical properties they satisfy. And it is not an operational description of how `C` executes, because it deliberately says nothing about the intermediate states `C` passes through — only about the relationship between the very first state and the very last one, for executions that actually reach a last state at all.

This is exactly where Discrete Math and Logic becomes software reasoning in a fully concrete way: a Hoare triple is proved by logical argument, the same connectives-and-quantifiers argument style already developed there, just now aimed at program states instead of abstract propositions. And Computability and Complexity's warning from earlier in this discipline is not a historical aside here — it is a live constraint: because no complete automatic prover can exist for every possible command and every possible assertion, the proof rules introduced in the next concept, `hoare-logic-rules-of-inference`, are deliberately syntax-directed rather than a search over all possible proofs, trading completeness in the most general case for a proof strategy that actually works in practice on the programs people write.

## Core Theory

### Syntax of the triple

The triple has the fixed shape `{P} C {Q}`, and each of its three components plays a distinct, non-interchangeable role. `P` is the precondition, an assertion over the state in which execution of `C` is about to begin. `C` is the command whose behavior is being characterized — it can be as small as a single assignment or as large as an entire program. `Q` is the postcondition, an assertion over the state that results if and when `C` finishes running. The braces surrounding `P` and `Q` are pure notation borrowed for this purpose — they mark "this is an assertion, not executable code" — and carry no runtime meaning whatsoever; a triple is never executed, only proved or refuted as a mathematical statement about `C`'s behavior. This is an important habit of mind to establish early: seeing `{P} C {Q}` should immediately trigger the question "is this claim true of every state satisfying P," not "what happens if I run this."

### Partial-correctness meaning

The triple `{P} C {Q}` is defined to mean exactly this: if `C` begins execution in a state satisfying `P`, *and* `C` terminates, then the state in which it terminates satisfies `Q`. The clause "and C terminates" is not a footnote or an aside — it is load-bearing, part of the very definition of what the triple asserts, and dropping it silently changes the claim into something stronger and different (total correctness, which `total-correctness-and-termination` treats as its own separate concept requiring its own separate proof). One direct and somewhat counterintuitive consequence of building termination into the definition this way: a triple can be true, and even easy to prove true, purely because `C` never terminates from states satisfying `P` at all — there being no terminating execution to check against `Q`, the universally-quantified claim "every terminating execution satisfies Q" holds vacuously, the same way "every unicorn in this room is purple" is true precisely because there are no unicorns in the room to be any other color. This also means a precondition that happens to be unsatisfiable, or a precondition that describes a false or impossible situation, can make a triple technically true while making it practically useless — a proof of `{false} C {anything}` is valid but says nothing interesting about any real execution, because no state satisfies `false` in the first place.

### Connection to operational semantics

Small-step operational semantics, from Programming Languages, gives a precise rule for each individual transition a command can make — one state stepping to the next, one syntactic construct at a time. Hoare logic sits one level of abstraction above that: instead of reasoning about individual steps, it supplies compositional proof rules for entire commands, built directly out of their syntactic structure — an assignment gets one rule, a sequence of two commands gets another, and so on, as `hoare-logic-rules-of-inference` develops in full. The bridge between these two levels is a soundness theorem: every triple that can be derived using Hoare's proof rules is guaranteed to be true according to the underlying small-step operational semantics. This soundness guarantee is what licenses working entirely at the level of triples and proof rules, following the syntax of the program, rather than having to unfold and check every possible sequence of individual execution steps by hand — a real practical necessity, since even a short loop can have an execution trace of unbounded length once it's allowed to run for enough iterations.

### Counterexamples

A triple `{P} C {Q}` is false exactly when there exists at least one terminating execution of `C` that starts in a state satisfying `P` and ends in a state that does not satisfy `Q`. The key word is "one" — refuting a universally-quantified claim never requires surveying every possible starting state, because a single counterexample is logically sufficient to falsify a claim of the form "for every state satisfying P, ...". This mirrors exactly the asymmetry between testing and proof from `testing-shows-presence-proof-shows-absence`: one failing test refutes a universal correctness claim, and one counterexample state refutes an invalid triple, for the identical logical reason. In practice, a concrete counterexample — a specific starting state and the specific final state it leads to — is very often easier for a human to understand and act on than the record of a failed attempt at a symbolic proof, because a counterexample is something you can plug in and watch fail, rather than an abstract gap in an argument. This is precisely why well-engineered verification tools go out of their way to report concrete counterexamples whenever a proof attempt fails, rather than simply reporting "unprovable" and leaving the user to guess why.

## Worked Examples

### Assignment triple

Consider the triple:

```text
{x ≥ 0} y := x + 1 {y > 0}
```

To verify this, trace what the assignment does to the state and then check the postcondition against that resulting state. After `y := x + 1` executes, the variable `y` holds exactly the value that `x` had immediately before the assignment, plus one — call that old value `x₀`, so the state right after the assignment has `y = x₀ + 1`. The precondition guarantees `x₀ ≥ 0`. From there the argument is pure arithmetic: adding one to any nonnegative integer produces a strictly positive integer, so `x₀ + 1 > 0`, which is exactly `y > 0`. Because assignment always terminates immediately — there is no way for a single assignment statement to loop forever — this triple is in fact total, not merely partial, for this one command; the distinction between partial and total correctness only becomes substantive once loops or recursion enter the picture, as `total-correctness-and-termination` will develop.

### Invalid triple

Now consider the claimed triple:

```text
{x ≥ 0} y := x - 1 {y ≥ 0}
```

This looks superficially plausible — subtracting one from a nonnegative number "should" often still be nonnegative — which is exactly why it's worth walking through carefully rather than accepting the pattern-match. To refute it, the strategy from the Core Theory section applies directly: find one concrete state satisfying the precondition for which the postcondition fails after execution. Choose the initial state `x = 0`. This state satisfies the precondition `x ≥ 0` (zero is nonnegative). Executing `y := x - 1` from this state sets `y = 0 - 1 = -1`. Now check the postcondition against this resulting state: is `-1 ≥ 0`? No. The postcondition fails, so this single execution — starting in a `P`-satisfying state, terminating (assignments always terminate), and ending in a state violating `Q` — is exactly the kind of counterexample the Core Theory section described as logically sufficient. No further cases need to be checked, and no argument about "most" values of `x` is relevant here: this one witness at `x = 0` is enough to make the universally-quantified triple false, in exactly the same way one failing test refutes a universal correctness claim. What this reveals about the flaw in the original claim: the postcondition `y ≥ 0` implicitly needed `x ≥ 1`, not merely `x ≥ 0`, to survive the subtraction — the precondition as stated was one unit too weak for the postcondition it was paired with, and the boundary case `x = 0` is exactly where that gap becomes visible.

### Conditional absolute value

Consider the command:

```text
if x ≥ 0 then y := x else y := -x
```

with the goal of proving `{true} command {y ≥ 0}` — a triple with the trivial precondition `true`, meaning the claim should hold from *every* possible starting state, with no restriction at all. Because the command branches, the proof naturally splits into two cases, one for each branch, and both must independently establish the same postcondition. In the `then` branch, the guard `x ≥ 0` is known to hold (that's why this branch was taken), and the assignment `y := x` sets `y` equal to `x`; since `x ≥ 0` in this branch, the resulting `y ≥ 0` follows immediately. In the `else` branch, the guard is false, so `x < 0` is known to hold instead, and the assignment `y := -x` sets `y` equal to the negation of `x`; negating a strictly negative number produces a strictly positive one, so `y > 0`, which certainly satisfies `y ≥ 0` as well. Both branches, under their own respective (and mutually exclusive) assumptions about `x`, independently arrive at the same postcondition — and because the two branches' guards are exhaustive and mutually exclusive, every possible starting state falls into exactly one of the two cases just checked, which is precisely why proving both branches separately is sufficient to prove the triple for every starting state, with no gap between them. This case-split structure — split on the guard, prove each branch under its own assumption, confirm the split was exhaustive — is exactly the shape the conditional rule in `hoare-logic-rules-of-inference` will formalize as a reusable, syntax-directed proof rule.

## Common Misconceptions & Pitfalls

- **Reading a Hoare triple as a termination guarantee.** `{P} C {Q}` says nothing at all about whether `C` terminates — it says only that *if* `C` terminates from a `P`-satisfying state, the result satisfies `Q`. A command that never terminates from any state satisfying `P` makes the triple vacuously true, which is a legitimate and sometimes useful fact about the definition, not a bug in it; total correctness is a strictly stronger, separately-proved claim.
- **Forgetting that `P` and `Q` refer to different states.** `P` describes the state immediately before `C` runs; `Q` describes the state immediately after `C` finishes. A variable's value in `P` and the *same* variable's value in `Q` can be completely different — as the assignment example shows, `x` in the precondition and `y` in the postcondition are related through the old value of `x`, not through some shared, unchanging value across the whole triple.
- **Treating a true triple as proof of an unstated requirement.** A triple only proves exactly what its postcondition says — proving `{x ≥ 0} y := x + 1 {y > 0}` says nothing about whether `y`'s new value is useful, expected by some other part of the program, or consistent with any requirement that was never written into `Q` in the first place.
- **Using one example state as if it established a universal claim.** This is the mirror image of the counterexample technique used above to *refute* a triple: one satisfying state can never *prove* a triple true, because the claim is universally quantified over every state satisfying `P`, and one witness only ever demonstrates that the claim isn't violated at that particular point.
- **Ignoring false or impossible preconditions.** A precondition that can never actually be satisfied by any real state (such as `false`, or a contradictory conjunction like `x > 0 ∧ x < 0`) makes any triple built on it vacuously true, exactly as a nonterminating command does — this is technically sound but practically empty, and a proof that leans on an unsatisfiable precondition to make its job easy has not actually established anything useful about real executions.

## Summary

A Hoare triple `{P} C {Q}` is a partial-correctness theorem about a command: assuming precondition `P` holds in the starting state, every execution of `C` that actually terminates ends in a state satisfying postcondition `Q` — with no claim at all about executions that don't terminate, and no claim about anything beyond the single before-and-after relationship the postcondition states. It sits one level of abstraction above operational semantics, related to it by a soundness guarantee that lets proofs follow the syntactic structure of `C` rather than every individual small-step transition, and it is refuted, exactly like a universal correctness claim in testing, by a single concrete counterexample state rather than by a general argument. Everything the rest of the Hoare-logic cluster in this discipline builds — compositional inference rules, loop invariants, weakest preconditions, total correctness — is built directly on top of this one triple as its central, unifying judgment.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
