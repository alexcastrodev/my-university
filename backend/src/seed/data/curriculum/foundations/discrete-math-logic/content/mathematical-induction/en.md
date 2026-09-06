---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why the well-ordering principle justifies mathematical induction as a valid proof technique, not merely a convenient pattern.
- State a proposition P(n) precisely and identify the base case and inductive step required to prove ∀n ≥ n₀, P(n).
- Construct complete induction proofs for closed-form sum identities, divisibility claims, and inequalities.
- Identify the inductive hypothesis in a proof and distinguish it from the conclusion being proved at each step.
- Diagnose broken "proofs" by induction that violate the base case, the inductive step, or the shrink-forward direction of the argument.

## Context & Motivation

Suppose someone claims that 1 + 2 + 3 + ⋯ + n = n(n+1)/2 for every positive integer n. You could check this for n = 1, n = 2, n = 100 — and it would hold every single time — but no finite amount of checking proves it holds for *every* natural number, because there are infinitely many of them. This is the fundamental problem that mathematical induction solves: it gives a finite argument (typically two short steps) that nonetheless certifies a claim for infinitely many cases at once. Without it, a huge share of the properties computer scientists rely on daily — that a loop invariant holds after every iteration, that a recursive algorithm produces correct output on inputs of every size, that a data structure maintains its shape no matter how many insertions have happened — would have no rigorous justification at all, only "it worked in the examples I tried."

Induction is the workhorse proof technique behind algorithm correctness. When you prove a `for` loop maintains an invariant, you are implicitly running an induction argument: the invariant holding before iteration k plus one step of the loop body implies it holds before iteration k+1, and it started true before the loop began. MIT's 6.042 (Mathematics for Computer Science) introduces induction immediately after establishing the well-ordering principle for exactly this reason — nearly every subsequent topic in the course, from graph properties to recurrence relations to the correctness of recursive algorithms, leans on an inductive argument at some point. The technique also appears constantly outside of proofs about numbers: induction on the structure of a formula, a list, or a tree (covered in a later concept, structural induction) is the same idea applied to objects that are not integers.

The intuition is often described with a row of dominoes: if you can guarantee the first domino falls, and you can guarantee that whenever any domino falls, it knocks over the next one, then you know every domino in the row falls — even if the row is infinitely long and you'll never watch each individual domino topple. What licenses this leap from "the first one falls, and each one knocks over the next" to "they all fall" is not intuition alone; it rests on a genuine axiom about the natural numbers, the well-ordering principle, which says every non-empty set of non-negative integers has a least element. Induction and well-ordering are, in fact, logically equivalent — each can be derived from the other — which is why induction is not just a heuristic pattern but a rigorously justified method of proof.

## Core Theory

### The formal statement of the principle

To prove a statement of the form "∀n ≥ n₀, P(n)" — where P(n) is some proposition depending on the natural number n, and n₀ is the starting point (often 0 or 1) — the **principle of mathematical induction** says it suffices to establish two facts:

1. **Base case:** P(n₀) is true.
2. **Inductive step:** for an arbitrary k ≥ n₀, assuming P(k) is true (the **inductive hypothesis**), prove that P(k+1) is also true.

If both hold, then P(n) is true for every integer n ≥ n₀. Symbolically: [P(n₀) ∧ (∀k ≥ n₀, P(k) → P(k+1))] → ∀n ≥ n₀, P(n).

The inductive step is not circular reasoning, even though it looks like it assumes what it is trying to prove. It proves a *conditional* statement — "if P(k) holds, then P(k+1) holds" — for an arbitrary, unspecified k. Proving a conditional by assuming its hypothesis and deriving its conclusion is ordinary direct proof; nothing about assuming P(k) to derive P(k+1) is asserting P(k) is actually true on its own. The base case is what actually certifies the chain starts; the inductive step only certifies that truth propagates forward once it starts somewhere.

### Why induction is valid: derivation from well-ordering

Suppose, for contradiction, that the base case and inductive step both hold, but ∀n ≥ n₀, P(n) is *false* — meaning some n ≥ n₀ exists with P(n) false. Let S = {n ≥ n₀ : P(n) is false}. By assumption S is non-empty, so by the well-ordering principle S has a least element, call it m. Since P(n₀) is true (the base case), m ≠ n₀, so m > n₀, meaning m − 1 ≥ n₀. Because m is the *least* element of S, m − 1 ∉ S, so P(m − 1) is true. But the inductive step says P(m − 1) → P(m), so P(m) must be true — contradicting m ∈ S. This contradiction shows S must be empty, i.e., P(n) holds for every n ≥ n₀. ∎

This derivation is worth internalizing because it shows induction is not a separate leap of faith bolted onto well-ordering — it is a direct logical consequence of it. Anywhere the natural numbers are well-ordered (no infinite descending chain of non-negative integers), induction is available as a proof tool.

### The domino chain, visualized

```mermaid
flowchart LR
    B["P(0) true\n(base case)"] -->|"step: P(0) → P(1)"| S1["P(1) true"]
    S1 -->|"step: P(1) → P(2)"| S2["P(2) true"]
    S2 -->|"step: P(2) → P(3)"| S3["P(3) true"]
    S3 -->|"..."| Sn["P(n) true for all n"]
```

Each arrow is a single instance of the inductive step, proved once, generically, for an arbitrary k — the diagram is not n separate proofs, it is one proof of "P(k) → P(k+1)" that, combined with the base case, licenses the entire infinite chain.

### Common shapes of P(n): sums, divisibility, inequalities

Three families of statements recur constantly in induction practice, and each requires slightly different inductive-step algebra:

- **Closed-form sums**, e.g. 1 + 2 + ⋯ + n = n(n+1)/2. The inductive step adds the (k+1)-th term to both sides of the inductive hypothesis and simplifies to match the closed form at k+1.
- **Divisibility claims**, e.g. "7ⁿ − 1 is divisible by 6 for all n ≥ 0." The inductive step typically rewrites 7^(k+1) − 1 in terms of 7ᵏ − 1 (which is divisible by 6, by hypothesis) plus a term that is also divisible by 6.
- **Inequalities**, e.g. "2ⁿ > n for all n ≥ 1" or "n! > 2ⁿ for all n ≥ 4." The inductive step usually multiplies or adds a controlled quantity to both sides of the hypothesis and then argues the resulting inequality is at least as strong as required.

## Worked Examples

### Example 1 — the sum formula 1 + 2 + ⋯ + n = n(n+1)/2

**Claim:** for all integers n ≥ 1, 1 + 2 + ⋯ + n = n(n+1)/2.

Let P(n) be the proposition "1 + 2 + ⋯ + n = n(n+1)/2."

**Base case (n = 1):** the left side is just 1. The right side is 1(1+1)/2 = 2/2 = 1. Both sides equal 1, so P(1) holds.

**Inductive step:** assume P(k) holds for some arbitrary k ≥ 1, i.e., assume 1 + 2 + ⋯ + k = k(k+1)/2 (the inductive hypothesis). We must show P(k+1): 1 + 2 + ⋯ + k + (k+1) = (k+1)(k+2)/2.

Starting from the left side of P(k+1) and using the inductive hypothesis to replace the first k terms:

1 + 2 + ⋯ + k + (k+1) = [k(k+1)/2] + (k+1)   (by the inductive hypothesis)
&nbsp;&nbsp;&nbsp;&nbsp;= (k+1)[k/2 + 1]
&nbsp;&nbsp;&nbsp;&nbsp;= (k+1)(k+2)/2

This matches the right side of P(k+1) exactly, so P(k) → P(k+1) holds. By induction, P(n) holds for all n ≥ 1. ∎

### Example 2 — divisibility: 3 | (n³ − n) for all n ≥ 0

**Claim:** for every non-negative integer n, 3 divides n³ − n.

Let P(n) be "3 | (n³ − n)."

**Base case (n = 0):** 0³ − 0 = 0, and 3 | 0 (since 0 = 3 × 0). So P(0) holds.

**Inductive step:** assume P(k): 3 | (k³ − k), meaning k³ − k = 3m for some integer m. We must show P(k+1): 3 | [(k+1)³ − (k+1)].

Expand (k+1)³ − (k+1) = k³ + 3k² + 3k + 1 − k − 1 = (k³ − k) + 3k² + 3k = 3m + 3k² + 3k = 3(m + k² + k).

Since m + k² + k is an integer, (k+1)³ − (k+1) is 3 times an integer, so 3 | [(k+1)³ − (k+1)]. Thus P(k) → P(k+1). By induction, P(n) holds for all n ≥ 0. ∎

The key algebraic move — rewriting the (k+1) case as "the k case, plus something else divisible by 3" — is the template for essentially every divisibility induction: isolate the inductive hypothesis as a subterm, then show the remainder shares the same divisor.

### Example 3 — the inequality 2ⁿ > n for all n ≥ 1

**Claim:** for every integer n ≥ 1, 2ⁿ > n.

Let P(n) be "2ⁿ > n."

**Base case (n = 1):** 2¹ = 2 > 1. P(1) holds.

**Inductive step:** assume P(k): 2ᵏ > k, for some arbitrary k ≥ 1. We must show P(k+1): 2^(k+1) > k+1.

2^(k+1) = 2 · 2ᵏ > 2k (by the inductive hypothesis, multiplying both sides by 2, which preserves the inequality since 2 > 0).

It remains to show 2k ≥ k + 1 for k ≥ 1, which rearranges to k ≥ 1 — true by assumption. Chaining the two inequalities: 2^(k+1) > 2k ≥ k + 1, so 2^(k+1) > k + 1, establishing P(k+1). By induction, 2ⁿ > n for all n ≥ 1. ∎

This example illustrates a frequent pattern in inequality inductions: the inductive hypothesis gets you most of the way (2^(k+1) > 2k), and a small separate algebraic fact (2k ≥ k+1 for k ≥ 1) closes the remaining gap to the target bound.

## Common Misconceptions & Pitfalls

- **"The inductive step assumes what you're trying to prove, so it's circular."** It assumes P(k) for one arbitrary, fixed k to prove the conditional P(k) → P(k+1) — a single instance of direct proof. It never assumes ∀n, P(n), which is the actual conclusion. The base case, separately, is what actually certifies truth starts somewhere; without it the inductive step alone proves nothing (an unbroken chain of falling dominoes still requires someone to push the first one).
- **"Skipping the base case is fine if the inductive step is airtight."** Consider the false claim "n = n + 1 for all n" with a (deliberately fake) "inductive step": if k = k + 1, then adding 1 to both sides gives k + 1 = k + 2, so P(k) → P(k+1) — this step is vacuously valid, since P(k) is never actually true, so the implication holds trivially. Without a true base case, this "step" proves nothing, illustrating why the base case is not optional formality — it's what stops any inductive step, however slick, from certifying nonsense.
- **"You can pick any base case, as long as one exists."** If the claim is only true for n ≥ 4 (e.g., "n! > 2ⁿ for n ≥ 4" — false at n = 0, 1, 2, 3, where 2ⁿ ≥ n!), the base case must be n₀ = 4, not n₀ = 0. Checking the wrong starting point either produces a false base case (invalidating the whole proof) or silently proves a weaker, unintended statement.
- **"The inductive hypothesis needs to be re-derived from scratch at each step."** Students sometimes try to prove P(k+1) directly, ignoring P(k) entirely, effectively redoing a full proof at every level and abandoning the machinery induction offers. The entire efficiency of induction comes from *reusing* the assumed truth of P(k) as a stepping stone — if your inductive step doesn't reference the inductive hypothesis anywhere in its derivation, something has gone wrong (either the step is doing unnecessary extra work, or worse, it's a disguised, invalid direct proof of P(k+1) that happens not to need P(k) at all, meaning your "induction" was never really induction).
- **"Checking a few cases (n = 1, 2, 3) is basically as good as an inductive proof."** No finite verification, however extensive, rules out failure at some later n. A famous cautionary example: Euler's conjecture that a certain polynomial n² − n + 41 produces primes for many small n (true for n = 0 through 40) fails at n = 41 — showing that pattern-matching on small cases, without a genuine inductive argument, can mislead arbitrarily far before breaking.

## Summary

Mathematical induction proves ∀n ≥ n₀, P(n) by establishing a base case P(n₀) and an inductive step showing P(k) → P(k+1) for arbitrary k ≥ n₀ — two finite arguments that together certify infinitely many cases. The technique is not an independent axiom but a direct logical consequence of the well-ordering principle: if the conclusion failed for some n, the least such failing n would contradict the inductive step. The inductive step is ordinary direct proof of a conditional, never circular, and the base case is what anchors the entire chain rather than a formality to skip. Sum identities, divisibility claims, and inequalities are the three most common shapes of P(n) encountered in practice, each with characteristic inductive-step algebra — isolating the inductive hypothesis as a subterm and showing the remainder satisfies the needed property. Getting the base case wrong, omitting it, or writing an inductive step that never actually uses the inductive hypothesis are the most common ways an induction proof silently breaks.

## Documentation Links

- [MIT 6.042J — Syllabus (OCW)](https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/pages/syllabus/) — doc
- [Lehman, Leighton & Meyer — Mathematics for Computer Science (full text)](https://people.csail.mit.edu/meyer/mcs.pdf) — doc
