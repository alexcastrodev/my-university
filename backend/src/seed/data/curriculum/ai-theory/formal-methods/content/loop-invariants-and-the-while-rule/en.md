---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- State the while rule and explain each of its three proof obligations: initialization, preservation, and exit.
- Explain precisely why a loop invariant plays the same logical role as an induction hypothesis.
- Construct a loop invariant for a small numeric loop by working backward from the desired postcondition.
- Diagnose an invariant that is too weak to imply the postcondition at loop exit, and strengthen it correctly.
- Carry out a complete worked proof of a summing loop, discharging all three obligations explicitly.

## Context & Motivation

`hoare-logic-rules-of-inference` gave syntax-directed rules for assignment, sequence, and conditionals — every construct in a simple imperative language except the one that actually makes reasoning hard: the loop. A loop can run zero times, one time, or an unbounded number of times depending on the input, and testing can only ever observe a finite handful of those possible iteration counts. A proof, by contrast, has to say something true no matter how many times the loop body actually executes, and it has to do so without unfolding the loop into an infinite, unbounded case analysis.

The loop invariant is the single assertion that makes this possible, and the analogy to mathematical induction from Discrete Math and Logic is not a loose metaphor — it is the exact same logical structure, applied to program execution instead of natural numbers. An induction proof establishes a base case and an inductive step, then concludes the property holds for every natural number without ever having checked each one individually; a loop-invariant proof establishes that the invariant holds before the loop starts and survives every execution of the body, then concludes it holds no matter how many iterations actually ran, without ever having traced through a specific iteration count. This concept is also where `proving-greedy-optimality-activity-selection`'s style of exchange-argument and inductive reasoning about algorithms and this discipline's Hoare-logic proofs turn out to be doing structurally the same kind of work, just phrased in different vocabularies for different purposes.

It is worth being direct about where the real difficulty lives here, because it is easy to underestimate on first exposure: once the right invariant is in hand, applying the while rule to it is close to mechanical. The actual challenge — the part that requires genuine insight rather than rule-following — is finding an invariant that is simultaneously weak enough to be provably preserved by the loop body and strong enough, once the loop guard finally becomes false, to imply the postcondition the whole proof is aiming at.

## Core Theory

### The three obligations

Proving a loop correct with an invariant `I`, guard `B`, and body `C` requires discharging exactly three separate obligations, each with a distinct role. Initialization requires that `I` holds the very first time the guard is checked, before the loop body has run even once — this is the base case of the induction. Preservation requires that, assuming both `I` and the guard `B` hold just before one execution of the body, `I` holds again immediately after that execution — this is the inductive step, and it must be proved for one arbitrary iteration, not separately for the first, second, and so on. Exit requires that once the loop finally terminates — meaning `I` still holds but the guard `B` has become false — the conjunction `I ∧ ¬B` is strong enough to imply the postcondition the proof is ultimately trying to establish. All three obligations must be discharged; a proof that only handles preservation but forgets initialization, for instance, has proved that the invariant is self-sustaining without ever proving it actually gets started.

### While rule

Formally, the while rule has the shape:

```text
{I ∧ B} C {I}
------------------------------
{I} while B do C {I ∧ ¬B}
```

Read top to bottom: if the single premise above the line — that the body `C`, run from a state satisfying both the invariant and the guard, re-establishes the invariant — can be proved, then the conclusion below the line follows for the loop as a whole: starting from a state satisfying `I`, the entire loop (however many iterations it actually takes) ends in a state satisfying `I ∧ ¬B`. Notice what this rule does *not* require: it never asks for a proof about "the state after 5 iterations" or "the state after k iterations" for any specific or symbolic `k` — the premise is a single triple about one arbitrary pass through the body, and the rule licenses concluding something about arbitrarily many passes from that one triple alone. This is exactly the same move mathematical induction makes: prove one step works in general, get every iteration count for free.

### Induction connection

Making the correspondence with induction fully explicit: initialization is the base case, establishing the property holds at the starting point before any inductive steps have been taken. Preservation is the induction step, establishing that the property survives one more application of whatever the inductive process is — one more natural number in ordinary induction, one more pass through the loop body here. The number of loop iterations a particular execution actually performs is arbitrary and unknown in advance — it depends on the input — but the proof itself is entirely finite, consisting of exactly these two fixed obligations (plus exit), regardless of whether the loop, on some particular run, executes three times or three million times. This is precisely the payoff that makes loop invariants worth the effort of finding: a finite proof effort buys a guarantee about an unboundedly variable amount of runtime behavior.

### How to find invariants

There is no fully mechanical algorithm for finding a good invariant — this is the genuine skill this concept is teaching — but a few reliable heuristics narrow the search substantially. A productive starting point is to look at the desired postcondition and ask how to *weaken* it into a statement that can plausibly be true partway through the loop, not just at the very end — the postcondition is, in a sense, "what the invariant looks like once the guard has also become false," so working backward from it is rarely wasted effort. Almost every loop over an array or a counted range needs an explicit bound as part of its invariant, such as `0 ≤ i ≤ n`, because without stating the bound explicitly, the exit obligation typically cannot pin down the exact value a counter variable ends at. Beyond bounds, the invariant typically needs to state the precise relationship between whatever has been accumulated so far and the portion of the input processed so far — this is usually the substantive mathematical content of the invariant, and getting it exactly right (not almost right) is what the worked example below demonstrates concretely. Finally, a good invariant should avoid asserting anything the loop body does not actually preserve — an invariant that happens to be true of the specific run someone has in mind but that the body doesn't actually guarantee in general will fail the preservation obligation the moment it's checked rigorously.

## Worked Examples

### Summing numbers: setting up the proof

Consider the following loop, intended to compute the sum of the integers from `0` up to `n - 1`:

```text
i := 0; s := 0;
while i < n do
    s := s + i;
    i := i + 1
```

The precondition is `n ≥ 0`, and the desired postcondition is the closed-form identity `2*s = n*(n - 1)` — the familiar sum `0 + 1 + ... + (n-1) = n(n-1)/2`, restated without division to keep the arithmetic entirely in integers. Following the guidance above, the invariant is built by combining a bound on the loop counter with a relationship between the accumulated sum and the portion of the range processed so far. The invariant chosen is:

```text
I: 0 ≤ i ≤ n ∧ 2*s = i*(i - 1)
```

The second conjunct says exactly what should be true partway through: after `i` iterations, `s` holds the sum `0 + 1 + ... + (i - 1)`, whose closed form is `i*(i-1)/2`, restated as `2*s = i*(i-1)` to avoid division. This invariant is precisely the postcondition's shape, but with `i` standing in for `n` — a direct instance of the "weaken the postcondition so it holds partway through" heuristic.

### Summing numbers: the three obligations, discharged

**Initialization.** Before the loop's guard is checked for the first time, the two prior assignments have set `i := 0` and `s := 0`. Substituting these into the invariant: `0 ≤ 0 ≤ n` holds because the precondition already guarantees `n ≥ 0`, and `2*0 = 0*(0-1)` simplifies to `0 = 0`, which holds unconditionally. Both conjuncts of `I` hold, so initialization is established.

**Preservation.** Assume `I` holds — that is, `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` — and assume the guard `i < n` also holds, exactly the state the loop body executes from. The body runs `s := s + i` followed by `i := i + 1`. Let `s'` and `i'` denote the values immediately after the body finishes, so `s' = s + i` and `i' = i + 1`. The goal is to show `I` holds again with these new values: `0 ≤ i' ≤ n ∧ 2*s' = i'*(i'-1)`. The bound holds because `i < n` (the guard) together with `i ≤ n` (from `I`) gives `i' = i + 1 ≤ n`, and `i' ≥ 0` trivially since `i ≥ 0`. For the arithmetic conjunct, compute `2*s' = 2*(s + i) = 2*s + 2*i`, and by the assumed invariant `2*s = i*(i-1)`, this becomes `i*(i-1) + 2*i = i*i - i + 2*i = i*i + i = i*(i+1) = (i+1)*((i+1)-1) = i'*(i'-1)`, exactly matching what needed to be shown. Preservation is established for one arbitrary pass through the body, which — by the while rule — is all that is ever required, regardless of how many total passes a given run of the loop performs.

**Exit.** When the loop finally terminates, `I` still holds but the guard has become false, so `¬(i < n)` holds, meaning `i ≥ n`. Combined with the bound `i ≤ n` from `I`, this pins `i` down exactly: `i = n`. Substituting `i = n` into the arithmetic conjunct `2*s = i*(i-1)` gives exactly `2*s = n*(n-1)` — precisely the desired postcondition, with no further argument needed. All three obligations having been discharged, the while rule concludes the full triple: `{n ≥ 0} program {2*s = n*(n-1)}`.

### The missing bound, and why it matters

To see concretely why the bound `0 ≤ i ≤ n` earns its place in the invariant rather than being decorative, consider dropping it and working with the weaker candidate invariant `2*s = i*(i-1)` alone. Initialization and preservation both still go through exactly as before, since neither step above actually used the bound in its arithmetic. But the exit obligation now fails to reach the postcondition: from `¬(i < n)` alone, all that follows is `i ≥ n`, not `i = n` — and without knowing `i` equals `n` exactly, the arithmetic identity `2*s = i*(i-1)` says something true about `i`, but not the specific postcondition `2*s = n*(n-1)` that was actually wanted. The arithmetic relation, though true, was too weak on its own to finish the proof; the bound `i ≤ n` is exactly the missing piece that, combined with `i ≥ n` from the false guard, pins `i` down to the single value `n` the postcondition needs.

### The zero-iterations case

A correct invariant must also handle the loop running zero times, since nothing in the precondition `n ≥ 0` rules out `n = 0`. If `n = 0`, the guard `i < n` is `0 < 0`, false immediately, so the loop body never executes at all. In this case, only initialization matters: with `i = 0` and `s = 0`, the invariant `0 ≤ 0 ≤ 0` and `2*0 = 0*(0-1) = 0` both hold, exactly as verified generally above. Exit then applies directly with `i = n = 0`, giving `2*s = 0*(0-1) = 0`, matching `s = 0` exactly. Nothing special had to be added to the proof to handle this case — a correctly-stated invariant covers zero iterations automatically, as a byproduct of initialization alone, without any separate argument. An invariant that required a special case for zero iterations would be a sign that something about it was stated too narrowly.

## Common Misconceptions & Pitfalls

- **Inventing an invariant that is only actually true at loop exit.** A candidate assertion that happens to match the postcondition exactly but that the loop body cannot be shown to preserve at every intermediate iteration is not a usable invariant — it may describe the *destination* correctly without describing anything true along the way, and the preservation obligation will fail the moment it's checked honestly.
- **Forgetting bounds on counters.** As the missing-bound example demonstrates concretely, an arithmetic relationship between accumulated variables can be perfectly true and still be too weak, on its own, to pin down the exact final value a counter reaches — the bound is very often exactly what the exit obligation needs and the arithmetic relation alone cannot supply.
- **Proving preservation but never checking initialization.** A proof that only shows the invariant survives the loop body has shown the invariant is self-sustaining, not that it ever actually holds — this is the loop-proof equivalent of proving an induction's step case while never establishing the base case, and it leaves the entire argument logically incomplete no matter how carefully the step case was done.
- **Assuming a loop runs at least once.** Some invariants are chosen in a way that silently relies on the body having executed at least one time — the zero-iterations worked example above exists specifically to make this failure mode concrete; a correct invariant handles `n = 0` (or whatever the zero-iteration case is for a given loop) as a free consequence of initialization, not as a special case requiring separate handling.
- **Treating invariant discovery as a mechanical, rule-following step.** Once an invariant is proposed, checking the three obligations against it is close to mechanical, syntax-directed work; finding the invariant in the first place is usually the actual creative and difficult part of a loop proof, and it is exactly the step no purely mechanical procedure can be relied on to perform in general — this is precisely why automated tools, covered later in this discipline, so often ask a human to supply the invariant rather than attempting to infer it from scratch.

## Summary

A loop invariant is an induction hypothesis for programs, and the while rule turns the three obligations of initialization, preservation, and exit into a complete, finite proof that covers every possible iteration count a loop might actually run for. The full worked example — summing the integers from `0` to `n-1` with invariant `0 ≤ i ≤ n ∧ 2*s = i*(i-1)` — showed all three obligations discharged explicitly, showed exactly how an arithmetic relationship alone can be too weak without an accompanying bound, and showed that a correctly-stated invariant handles the zero-iterations case automatically. Because the real difficulty lies in finding the right invariant rather than in mechanically checking it once found, this concept is the bridge between Hoare logic's syntax-directed rules for straight-line code and the genuinely creative reasoning that `weakest-preconditions` and, later, automated verification-condition generation still ultimately depend on a human to supply.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [Pierce et al. — Software Foundations](https://softwarefoundations.cis.upenn.edu/) — machine-checked development of logic, Hoare logic, and proof-assistant style.
