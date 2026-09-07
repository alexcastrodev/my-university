---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Distinguish partial correctness from total correctness precisely, and state total correctness as their conjunction.
- Define a variant (ranking function) and explain why it must be both nonnegative and strictly decreasing.
- Explain why well-foundedness, not mere decrease, is what actually rules out infinite descent.
- Connect the impossibility of a universal termination checker to the Halting Problem already proved in Computability and Complexity.
- Prove total correctness for a small loop by combining a partial-correctness proof with an explicit variant.

## Context & Motivation

Every Hoare-logic proof built so far in this discipline — the assignment and sequence rules, the while rule with its loop invariant — has proved partial correctness: *if* the command terminates, the postcondition holds. That "if" has been doing quiet, load-bearing work throughout, most visibly in `the-hoare-triple`'s observation that a nonterminating command makes any partial-correctness triple about it vacuously true. Total correctness is what removes the "if" by proving termination as a separate, additional obligation, so that the final guarantee becomes unconditional: the command terminates, *and* when it does, the postcondition holds.

The reason this concept sits here, after loop invariants rather than folded into them, is that termination is genuinely a different kind of claim requiring a genuinely different proof technique — a loop invariant, no matter how carefully chosen, says nothing by itself about how many more iterations remain, only that whatever iterations do happen preserve a certain fact. Proving termination requires measuring *progress* toward the end of the loop, which is a new idea, not a refinement of the invariant idea.

And the Halting Problem, proved in full in Computability and Complexity, is not a distant abstraction here — it is the exact reason total-correctness proofs cannot be produced by a fully automatic, universally applicable procedure. No algorithm can decide, for every program and every input, whether that program halts; consequently, no algorithm can be relied on to always find (or even always verify) a termination argument for an arbitrary loop. This concept makes that computability boundary concrete inside the most ordinary piece of syntax in this discipline — the `while` loop — rather than leaving it as a fact about Turing machines that seems to live somewhere else.

## Core Theory

### Partial versus total correctness

Partial correctness, exactly as `the-hoare-triple` defined it, states: if `C` terminates when started in a state satisfying `P`, the resulting state satisfies `Q`. Termination, considered as its own separate property, states: `C` cannot run forever when started from a state satisfying `P` — every execution from such a state eventually reaches a final state, full stop, with no "if" attached. Total correctness is defined as the conjunction of both: `C`, started from `P`, is guaranteed both to terminate and to satisfy `Q` once it does. This is a genuinely stronger claim than partial correctness alone, and the gap between them is not academic — a proof of only partial correctness for a safety-critical control loop, for instance, would leave open the possibility that the loop simply never returns control at all, which is very often just as serious a failure as returning the wrong answer.

### Variants

A variant (sometimes called a ranking function, treated as the same idea below) is a numeric measure computed from the program's state, required to satisfy two properties simultaneously: it must be bounded below by some fixed value — conventionally, nonnegative, so bounded below by zero — and it must strictly decrease on every single execution of the loop body. For loops over integers, a natural and extremely common choice of variant is an expression like `n - i`, which decreases by exactly one on each iteration of a counter-driven loop and reaches zero exactly when the loop's natural stopping condition is met. The lower bound is not a minor technical footnote; it is what makes "strictly decreasing" actually force termination rather than merely force change — a value that decreases forever without ever hitting a floor (arbitrarily large negative numbers, for instance) could in principle decrease on every step of an infinitely long execution, which would prove nothing about termination at all.

### Ranking functions

Stated more generally, a ranking function maps program states into a well-founded order — an order in which no infinite strictly-descending chain of elements exists at all. The natural numbers under their usual ordering are the paradigm example of a well-founded order: starting from any natural number and repeatedly decreasing, the sequence must reach zero and stop after finitely many steps, because there is no infinite descending chain of natural numbers to descend along forever. Every transition through the loop must strictly decrease the ranking function's value, and because the underlying order is well-founded, an infinite sequence of such strict decreases is mathematically impossible — which is exactly the argument that forces the loop to terminate after only finitely many iterations. This is the precise reason well-foundedness, and not merely "decreasing," is the property doing the actual work: plenty of orders (the integers without a lower bound, for instance, or the rational numbers between 0 and 1 under ordinary subtraction) permit infinite strictly-decreasing sequences, and a ranking function into such an order would prove nothing about termination no matter how convincingly it seemed to "decrease."

### Undecidability boundary

Some loops terminate for reasons that are genuinely subtle rather than obviously arithmetic — a variant might need to be a nontrivial combination of several program variables, or might depend on facts that are themselves hard-won number-theoretic results rather than elementary arithmetic (the Collatz conjecture's famous "3n+1" iteration is the standard illustration of a loop whose termination for every starting value is, at the time of writing, not even known to be true, let alone provable by any currently known variant). This is not a curiosity at the margins of the theory; it is a direct, concrete instance of the general undecidability boundary already established: no general algorithm can always decide termination for arbitrary programs and arbitrary inputs, because such an algorithm would solve the Halting Problem, which is proved impossible. Every practical termination checker therefore works within some restricted, decidable fragment — accepting simple syntactic patterns of decrease automatically, and falling back on a human-supplied variant, exactly the same division of labor `weakest-preconditions` already established for loop invariants, whenever the pattern falls outside what the automated fragment covers.

## Worked Examples

### Countdown loop

Consider the loop `while x > 0 do x := x - 1`, with precondition `x ≥ 0`. Take the variant to be `x` itself. Each iteration of the loop begins, by the guard, with `x > 0`, so `x` is a positive integer at the start of every iteration that actually runs; the body then decreases it by exactly one. Because `x` remains a nonnegative integer throughout — it starts nonnegative by the precondition, and it is only ever decreased while strictly positive, never allowed to go negative by the guard itself cutting off the loop once `x` reaches zero — the sequence of values `x` takes on is a strictly decreasing sequence of natural numbers. Natural numbers under their usual order are well-founded, so no such sequence can continue forever; the loop must terminate after exactly `x`'s initial value many iterations.

### A partial-correctness trap

Consider `while true do skip`, with the postcondition `x = x` (a tautology, chosen deliberately to make the point starkly). Partial correctness holds trivially and for a somewhat unsettling reason: because the guard `true` never becomes false, there is no terminating execution from *any* precondition whatsoever, and the universally-quantified claim "every terminating execution satisfies the postcondition" is vacuously true precisely because its domain of quantification — the set of terminating executions — is empty. Total correctness, by contrast, fails outright and for the most direct possible reason: the loop provably never terminates from any starting state, so the termination half of total correctness's conjunction is simply false, no matter how trivially true the postcondition would have been had the loop ever finished. This example exists specifically to make vivid why termination is not a minor detail to be assumed away — a program that is "partially correct" in this vacuous sense provides zero actual assurance about anything a real caller would care about.

### Euclidean-style descent

Algorithms that repeatedly replace a pair of values with a smaller pair — the Euclidean algorithm for greatest common divisor being the canonical example, replacing `(a, b)` with `(b, a mod b)` on each step — typically admit a variant built from a combination of the arguments rather than from either one alone, such as the second argument, or the sum of both arguments, depending on exactly how the recurrence is structured. Proving termination for such a loop requires two things, and both are genuinely necessary, not merely two ways of stating the same fact: first, that the chosen measure strictly decreases on every iteration (not merely on average, or eventually — every single iteration), and second, that the measure never leaves the well-founded domain it was assumed to live in (staying a nonnegative integer throughout, for instance, rather than momentarily becoming negative or non-integral partway through some edge case). Omitting either half of this leaves a genuine gap: a measure that decreases but occasionally leaves the well-founded domain could, in principle, still permit an infinite descending sequence within some other part of its range.

## Common Misconceptions & Pitfalls

- **Assuming an apparently decreasing variable is always nonnegative without checking.** A quantity that decreases by a fixed amount each iteration but is never checked against a lower bound can, over enough iterations, cross into negative territory (or otherwise leave whatever well-founded domain was assumed) — at which point "it decreases" no longer implies "it must reach a fixed floor and stop," because the domain has quietly changed underneath the argument.
- **Proving the postcondition and forgetting termination entirely.** This is the exact trap the `while true do skip` example was built to expose: a syntactically valid, even easy, partial-correctness proof can coexist with a loop that never terminates at all, and nothing about a partial-correctness proof, by itself, rules this out — total correctness requires the separate variant argument on top.
- **Using a variant that sometimes stays the same rather than strictly decreasing.** A measure that is merely non-increasing (allowed to stay flat on some iterations) does not by itself rule out an infinite loop that keeps the measure at the same value forever; the variant must strictly decrease on *every* iteration of the loop body, with no exceptions, for the well-foundedness argument to actually force termination.
- **Expecting automated tools to discover termination arguments for arbitrary loops.** As the undecidability boundary makes precise, no tool can be relied on to find (or even verify, in full generality) a termination argument for every possible loop — practical tools handle common syntactic patterns automatically and otherwise ask a human to supply the variant, exactly mirroring how loop invariants are handled for partial correctness.

## Summary

Total correctness strengthens partial correctness by adding an independent proof of termination, most commonly established by exhibiting a variant — a measure into a well-founded order, bounded below and strictly decreasing on every iteration — which rules out infinite execution because no infinite strictly-descending chain can exist in a well-founded domain. The countdown-loop and Euclidean-descent examples showed this argument carried out concretely, while the `while true do skip` example showed exactly how partial correctness alone can mislead by holding vacuously even for a loop that never terminates at all. Because no algorithm can decide termination for arbitrary programs — a direct consequence of the Halting Problem already proved in Computability and Complexity — variants, like loop invariants before them, remain a place where automated tools request human insight rather than promising to supply it automatically.

## Documentation Links

- [Hoare — An Axiomatic Basis for Computer Programming (1969)](https://www.cs.cmu.edu/~crary/819-f09/Hoare69.pdf) — the original axiomatic-programming paper behind Hoare triples and inference rules.
- [CMU 15-414 — Automated Program Verification](https://www.cs.cmu.edu/~15414/) — course home for automated program verification, SMT, and verification-condition generation.
