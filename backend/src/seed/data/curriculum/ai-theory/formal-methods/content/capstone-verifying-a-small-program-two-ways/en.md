---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Verify one small program deductively, using Hoare logic and a loop invariant, for every mathematically valid input at once.
- Verify the same program's requirement by finite-state exploration, casting it as a transition system and a temporal-logic property.
- Explain precisely what each method actually establishes, and what scope-limiting assumption each one depends on that the other does not.
- Identify, from the discipline's Halting-Problem and Rice's-Theorem boundary, why neither method is a free substitute for the other.
- Choose, for a new verification problem, which of the two styles fits its shape better, and justify the choice explicitly.

## Context & Motivation

Every concept in this discipline has built toward one of two families of technique: the symbolic, compositional style of Hoare logic — triples, inference rules, loop invariants, weakest preconditions, total correctness — and the exhaustive, finite-state style of model checking — transition systems, Kripke structures, LTL and CTL, explicit and symbolic exploration. This capstone puts both families to work on the exact same small program and the exact same underlying requirement, so the difference between them stops being an abstract methodological point and becomes something concrete: two different proofs, of the same fact, built by genuinely different means, each with its own scope and its own price.

The point of doing this is emphatically not to crown one method the winner. It is to make the tradeoff between them fully visible by holding the program and the requirement fixed while the *method* varies: a Hoare-logic proof buys a guarantee that holds for literally every mathematically valid input, at the cost of requiring a human to find the right invariant; a model-checking proof buys full automation once the model and property are set up, at the cost of only covering the specific, finite range of inputs the model was built to represent. Every specification-writing habit from `specifications-preconditions-postconditions-invariants` and `logic-for-specification-propositional-and-first-order`, and every honest scope-statement discipline from `the-limits-of-verification`, is what makes it possible to say, precisely, which of these two guarantees has actually been earned by which proof — and that precision is the entire point of this capstone.

## Core Theory

### The program and the requirement

The program under verification computes the sum of the integers from `0` up to `n - 1` — the same small loop already introduced in `loop-invariants-and-the-while-rule`, deliberately reused here so that its Hoare-logic proof can be relied on rather than re-derived from nothing:

```text
i := 0;
s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

The precondition is `n ≥ 0`; the requirement being verified, in both methods below, is the closed-form identity `2*s = n*(n - 1)` once the loop finishes. For the Hoare-logic method, `n` is treated as an arbitrary mathematical integer satisfying only the precondition — the proof, once complete, covers every such `n` simultaneously, with no upper limit at all. For the model-checking method, `n` is deliberately bounded to a small finite range, since a finite-state exploration can only ever explore a finite state space — this bound is not a simplification chosen for convenience in this capstone alone; it is the exact same scope-limiting move `state-space-explosion-and-symbolic-model-checking` and `the-limits-of-verification` already flagged as an unavoidable, honest cost of exhaustive finite-state search.

### Plan for the deductive proof

The Hoare-logic proof plan follows exactly the structure `loop-invariants-and-the-while-rule` established: initialize the counter and accumulator to zero, adopt the invariant `0 ≤ i ≤ n ∧ 2*s = i*(i - 1)`, and discharge the while rule's three obligations — initialization, preservation, exit — to establish partial correctness. Because the capstone is meant to close out the Hoare-logic cluster fully rather than leave it at partial correctness, this proof additionally adds the termination half from `total-correctness-and-termination`: a variant `n - i`, nonnegative and strictly decreasing on every iteration, which upgrades the result from "if the loop terminates, the postcondition holds" to the unconditional "the loop terminates, and the postcondition holds" — total correctness, for every mathematically valid `n ≥ 0` at once.

### Plan for the model-checking proof

The model-checking plan takes the opposite path: rather than reasoning symbolically over an unbounded domain, it fixes a small concrete bound — `0 ≤ n ≤ 3` — and builds an explicit transition system whose states record the current values of `n`, `i`, `s`, and a program-counter position marking which line of the loop is about to execute, following exactly the state-representation style `transition-systems-and-kripke-structures` introduced for modeling program fragments. The requirement is then restated as a temporal-logic property over this transition system — not merely "the terminal state satisfies the postcondition," but a genuine CTL statement using the operators from `ctl-and-branching-time-logic`: `AG (at_exit → 2*s = n*(n-1))`, read as "on every path, whenever the program counter reaches the loop's exit point, the closed-form identity holds." Because this program is entirely sequential, with no genuine nondeterminism anywhere in it, every state actually has exactly one successor, so the "on every path" quantifier here ranges over a single deterministic path per value of `n` — but phrasing the property with the full CTL machinery, rather than as an informal "check the final state," is deliberate: it is exactly the same property-writing discipline `logic-for-specification-propositional-and-first-order` and `ctl-and-branching-time-logic` established, and it generalizes immediately, with no change in shape, to a version of this same program with genuine nondeterministic scheduling added.

### Comparison

The two proofs earn genuinely different things, and stating the difference precisely is the entire payoff of doing both. The Hoare proof covers every `n ≥ 0` — an infinite domain — in a single finite argument, but it required a human to find the right invariant, exactly the creative step `loop-invariants-and-the-while-rule` identified as the real difficulty of loop proofs, and its correctness rests on trusting the symbolic arithmetic manipulations as sound derivations. The model-checking proof is, once the model and the CTL property are set up, fully automatic — no invariant to discover, no arithmetic to simplify by hand — but it only covers the finite bound `0 ≤ n ≤ 3` that was chosen in advance, and extending its guarantee to every `n` would require either an explicit inductive argument bridging the bound to the general case, or accepting the bounded result as bounded evidence rather than an unbounded proof, exactly the distinction `the-limits-of-verification`'s bounded-checker discussion insisted on. Both proofs, despite these very different costs, depend on the identical underlying specification — the same precondition and the same postcondition — which is exactly what makes them comparable at all rather than two unrelated exercises that happen to share a program.

## Worked Examples

### The program, restated

```text
i := 0;
s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

Desired final relation, in both methods: `2*s = n*(n - 1)`.

### Method one: the complete Hoare-logic proof

The invariant is `I: 0 ≤ i ≤ n ∧ 2*s = i*(i - 1)`, exactly as `loop-invariants-and-the-while-rule` established. **Initialization**: after `i := 0; s := 0` runs, `0 ≤ 0 ≤ n` holds because the precondition guarantees `n ≥ 0`, and `2*0 = 0*(0-1)` simplifies to `0 = 0`, which holds unconditionally — the invariant holds before the loop body runs even once. **Preservation**: assume `I` and the guard `i < n` hold; the body sets `i' = i + 1` and `s' = s + i`. The bound survives because `i < n` together with `i ≤ n` gives `i' = i + 1 ≤ n`. The arithmetic conjunct survives by direct calculation: `2*s' = 2*(s+i) = 2*s + 2*i = i*(i-1) + 2*i` (using the assumed invariant) `= i² + i = i*(i+1) = i'*(i'-1)`, exactly matching what preservation requires. **Exit**: once the guard fails, `i ≥ n`, and combined with `i ≤ n` from `I`, this forces `i = n` exactly; substituting into the arithmetic conjunct gives `2*s = n*(n-1)`, precisely the desired postcondition. **Termination**: take the variant `n - i`. It is nonnegative throughout, since `I` maintains `i ≤ n`, and it strictly decreases by exactly one on every iteration, since the body increments `i` by one while `n` never changes — a nonnegative integer, strictly decreasing on every step, cannot decrease forever, so the loop terminates after exactly `n` iterations. Combining partial correctness (from the invariant) with termination (from the variant) yields total correctness: for every `n ≥ 0`, the loop terminates and `2*s = n*(n-1)` holds — one finite proof, covering infinitely many values of `n` at once, with no upper bound anywhere in the argument.

### Method two: the model-checking view

Restrict attention to `0 ≤ n ≤ 3`, and build the transition system whose states are tuples `(pc, n, i, s)`, where `pc` marks the program-counter position (`loop-head`, `body`, or `exit`). For a fixed `n = 3`, the reachable sequence of `(i, s)` pairs at the loop head, followed step by step, is: `(i=0, s=0)`, then `(i=1, s=0)` (after the first body execution: `s := s+0=0`, `i := 0+1=1`), then `(i=2, s=1)` (after the second: `s := 0+1=1`, `i := 1+1=2`), then `(i=3, s=3)` (after the third: `s := 1+2=3`, `i := 2+1=3`) — at which point the guard `i < n` fails (`3 < 3` is false) and the program reaches `pc = exit`. Checking the CTL property `AG (at_exit → 2*s = n*(n-1))` against this path: the only state where `at_exit` holds is `(i=3, s=3)`, and there, `2*s = 6` and `n*(n-1) = 3*2 = 6` — the property holds at the one state where its antecedent is satisfied, and since the path is deterministic and finite, checking this one state suffices to confirm `AG` holds along the entire path for `n = 3`. The model checker repeats this same exhaustive check — build the sequence of reachable states, verify the property at every state where the antecedent applies — independently for `n = 0`, `n = 1`, and `n = 2`, and confirms the property holds for each of the four values inside the chosen bound, without ever invoking an invariant or a symbolic arithmetic argument; every one of the four checks is a concrete, finite computation over concrete numbers.

### Comparing what was actually proved

Laying the two results side by side makes the tradeoff exact rather than approximate. The Hoare proof establishes `2*s = n*(n-1)` for every integer `n ≥ 0` — infinitely many values, including `n = 1000000`, which no model-checking run in this capstone ever touched directly — using one finite symbolic argument that required discovering the invariant `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` and the variant `n - i` by hand. The model-checking proof establishes the identical relation for exactly the four values `n ∈ {0, 1, 2, 3}`, fully automatically once the model and the CTL property were set up, with zero creative insight required at check time — but it says, by itself, absolutely nothing about `n = 4`, let alone `n = 1000000`, and extending its four-value result to the general case would require exactly the kind of separate inductive argument `the-limits-of-verification`'s bounded-checker discussion warned is not automatically supplied just because a bounded search came back clean. Neither result subsumes the other: the Hoare proof's strength is its unbounded reach, purchased with human effort; the model-checking proof's strength is its effortless automation, purchased with a hard bound on scope.

## Common Misconceptions & Pitfalls

- **Claiming the bounded model-checking result proves the property for all n without a separate inductive argument.** As the side-by-side comparison makes explicit, checking `n ∈ {0,1,2,3}` establishes nothing at all, by itself, about `n = 4` or any larger value — bridging a bounded result to the general case requires an argument of its own, exactly the gap `the-limits-of-verification` and `state-space-explosion-and-symbolic-model-checking` already warned against conflating.
- **Forgetting termination in the Hoare proof and stopping at partial correctness.** As `total-correctness-and-termination` emphasized, a partial-correctness proof alone would leave open the possibility that the loop simply never finishes for some `n` — the variant argument in Method one is not an optional flourish; it is what upgrades the result to the unconditional guarantee the capstone actually claims.
- **Using different, inconsistent specifications for the two methods.** Both proofs in this capstone rely on the identical precondition `n ≥ 0` and the identical postcondition `2*s = n*(n-1)` — if the two methods were checking subtly different requirements, comparing their results (as the side-by-side comparison does) would be meaningless, since they would no longer be two proofs of the same fact.
- **Treating the invariant as too obvious to need a real preservation proof.** The invariant `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` might look self-evidently true once written down, but as `loop-invariants-and-the-while-rule`'s missing-bound example already demonstrated for a closely related invariant, an unchecked assertion that merely looks plausible is not the same as a proved one, and skipping the explicit preservation calculation is exactly how a subtly wrong invariant slips through undetected.

## Summary

This capstone verified one small summation program by two genuinely different, complementary methods: a Hoare-logic proof, using the invariant `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` and the variant `n - i`, that establishes total correctness for every mathematically valid `n ≥ 0` at once through a single finite symbolic argument requiring human-discovered insight; and a model-checking proof, using an explicit transition system and the CTL property `AG (at_exit → 2*s = n*(n-1))`, that establishes the identical relation fully automatically but only for the finite bound `0 ≤ n ≤ 3` chosen in advance. Neither method is strictly superior to the other — each buys a different kind of guarantee at a different kind of cost, exactly the tradeoff `testing-shows-presence-proof-shows-absence` first previewed at the very start of this discipline between different families of evidence, now made fully concrete by applying both families to one shared program and one shared specification. Choosing between them for a new verification problem — infinite domain requiring insight, or finite domain admitting automation — is the practical judgment this entire discipline, from its opening slogan to this closing capstone, has been building toward.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
- [SPIN — On-the-Fly LTL Model Checking](https://spinroot.com/spin/whatispin.html) — overview of SPIN and on-the-fly LTL model checking in practice.
