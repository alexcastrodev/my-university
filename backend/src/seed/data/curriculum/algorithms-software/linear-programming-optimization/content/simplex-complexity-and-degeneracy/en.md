---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Define a degenerate basic feasible solution: one where a basic variable takes the value zero, caused by a tie in the ratio test.
- Construct a concrete degenerate pivot, and explain why a degenerate pivot can leave the objective value completely unchanged.
- State Bland's rule (break every tie by preferring the lowest-indexed variable) and explain, at a conceptual level, why it provably prevents cycling.
- State the Klee-Minty result: the simplex method's standard entering-variable rule visits all `2ⁿ` vertices of a specifically constructed `n`-dimensional polytope in the worst case, so simplex is not a worst-case polynomial-time algorithm.
- Distinguish "simplex is not worst-case polynomial" from "linear programming is not polynomial-time solvable," and name the alternative approach that closes that gap.

## Context & Motivation

Every simplex run traced so far in this track terminated quickly, in two or three clean pivots, each one strictly improving the objective. That good behavior is typical in practice, but it is not guaranteed, and understanding exactly where and why it can fail is essential before trusting simplex as a black box on a genuinely large or adversarially structured problem. Two distinct issues are worth separating carefully: **degeneracy**, a specific tableau state that can (rarely) cause the algorithm to stall or even loop forever without a safeguard, and **worst-case exponential behavior**, a deeper fact about the standard entering-variable rule's theoretical limits, discovered by Klee and Minty in 1972, that reshaped how the entire field understood the gap between an algorithm's typical, practical speed and its provable, worst-case guarantee, the same distinction this curriculum's algorithms discipline drew between Ford-Fulkerson's arbitrary-path worst case and Edmonds-Karp's provably bounded one.

## Core Theory

### Degeneracy: a tie in the ratio test

A **degenerate** basic feasible solution is one in which some basic variable's value is exactly `0`. This arises directly from a **tie in the ratio test**: when two or more rows achieve the same minimum ratio, only one of them is chosen as the leaving variable's row, but the *other* tied row's basic variable is then driven to exactly `0` on the very next pivot anyway, without the objective actually improving on that particular step. A pivot that produces no change in the objective value at all is called a **degenerate pivot**.

Degeneracy by itself is not a bug or an error, it is a perfectly legitimate tableau state (it simply means more constraints are tight at the current vertex than the minimum number needed to pin it down, exactly the situation the previous concepts' vertex characterization allows: "at least `n` tight constraints," not "exactly `n`"). The concern is what degeneracy can, in rare and specifically constructable cases, lead to: a sequence of degenerate pivots that revisits the same basic feasible solution more than once, an infinite loop called **cycling**, which would mean the algorithm never terminates at all.

### Bland's rule: preventing cycling with a simple tie-break

**Bland's rule** (Robert Bland, 1977) fixes this with a single, easy-to-state discipline: whenever a choice must be made, either among several candidate entering variables with equally negative objective-row coefficients, or among several tied rows in the ratio test, always choose the variable with the **lowest index** (assuming variables are numbered once, consistently, at the start). This rule can be proven to guarantee simplex terminates in a finite number of pivots, no cycling, ever, regardless of how ties happen to fall, though the proof of that guarantee is a careful, technical argument beyond what this concept reproduces in full; the practically important takeaway is that a documented, simple, and provably correct fix exists, and is what real implementations fall back on whenever degeneracy threatens to become cycling (though in practice, cycling is rare enough that many implementations use a faster tie-breaking heuristic most of the time, and only switch to Bland's rule if an unusually long run is detected).

### The Klee-Minty result: worst-case exponential behavior

A far deeper concern than degeneracy is this: even when every pivot strictly improves the objective (no ties, no degeneracy at all), how many pivots might simplex need in the *worst case*, over all possible problems of a given size? Victor Klee and George Minty answered this in 1972 with a specifically constructed family of linear programs, informally known as **Klee-Minty cubes**: an `n`-dimensional polytope, a slightly "twisted" version of an ordinary hypercube, with exactly `2ⁿ` vertices, built so that Dantzig's standard entering-variable rule (most negative coefficient) visits **every single one** of those `2ⁿ` vertices before reaching the optimum, one pivot at a time. For `n = 20` variables, this is over a million pivots; the number of pivots needed grows *exponentially* in the number of variables, not polynomially. This single, carefully engineered family of examples proves, rigorously, that the standard simplex method is **not a worst-case polynomial-time algorithm**, an important and historically surprising result, since simplex had already been used successfully in practice for over two decades by the time this worst case was published.

### Reconciling theory and practice

The Klee-Minty result does not mean simplex is slow in practice, and real-world experience overwhelmingly confirms it is not: on essentially every problem encountered outside specifically adversarial constructions like the Klee-Minty cube itself, simplex terminates in a small number of pivots, typically growing only modestly (often reported as roughly linear or low-polynomial) with the problem's size. The rigorous explanation for this gap between worst-case theory and typical practice is **smoothed analysis** (Spielman and Teng, 2004): even if an input is adversarially chosen, a small random perturbation of its data (modeling the small, unavoidable imprecision or "noise" present in almost any real numeric input) makes simplex's *expected* running time polynomial, a mathematically rigorous bridge between the pessimistic worst-case bound the Klee-Minty cube establishes and the optimistic practical behavior every real use of simplex actually exhibits.

### Simplex's worst case does not mean linear programming itself is hard

It is essential to separate two different claims. "Simplex, with the standard entering-variable rule, is not worst-case polynomial" is a fact about *one specific algorithm*. It is not a fact about the *problem* of linear programming itself: **linear programming is, in fact, solvable in worst-case polynomial time**, by a genuinely different family of algorithms called **interior-point methods** (Leonid Khachiyan's ellipsoid method, 1979, was the first to establish this in principle, though impractically slow; Narendra Karmarkar's 1984 algorithm was the first practical interior-point method, competitive with simplex in real use). These methods do not walk vertex to vertex along the polytope's boundary at all, instead moving through the polytope's *interior*, and their worst-case polynomial guarantee closes the gap Klee and Minty's result opened: linear programming as a *problem* is easy in the same worst-case sense as, say, Edmonds-Karp's max-flow guarantee, even though simplex, the specific *algorithm* this track has built in detail because of its geometric clarity and continued practical dominance, is not.

## Worked Examples

### Example 1: constructing and tracing a concrete degenerate pivot

**Problem:** Solve `maximize x₁ + x₂` subject to `x₁ ≤ 4`, `x₂ ≤ 4`, `x₁ + x₂ ≤ 8`, `x₁, x₂ ≥ 0` (a redundant third constraint, since the first two already force `x₁+x₂ ≤ 8` everywhere in their box, touching that bound only at the single corner `(4,4)`), and identify exactly where degeneracy appears.

**Setup:** `x₁+s₁=4`, `x₂+s₂=4`, `x₁+x₂+s₃=8`, objective row `z - x₁ - x₂ = 0`.

**Iteration 1:** `x₁` and `x₂` tie at `-1`; choose `x₁`. Ratio test: row 1, `4/1=4`; row 3, `8/1=4`, another tie (row 2 has no `x₁`, skipped). Choosing row 1 (`s₁` leaves): pivoting (row 1 already normalized) eliminates `x₁` from row 3 (`row3 - row1`): `x₂ - s₁ + s₃ = 4`. Eliminating `x₁` from the objective row: `z - x₂ + s₁ = 4`. Current solution: `x₁=4, s₂=4, s₃=4, x₂=s₁=0`, `z=4`.

**Iteration 2, the degenerate pivot:** `x₂` is the only negative coefficient (`-1`), so it enters. Ratio test: row 2, `4/1=4`; row 3 (now `x₂-s₁+s₃=4`), `4/1=4`, tied again. Choosing row 2 (`s₂` leaves): eliminating `x₂` from row 3 (`row3 - row2`) gives `-s₁ - s₂ + s₃ = 0`, so `s₃`'s row now reads `s₃ = s₁ + s₂`, meaning `s₃ = 0` with `s₁=s₂=0` still nonbasic. `s₃`, though still technically basic, has value `0`, exactly the degeneracy this concept defines. Eliminating `x₂` from the objective row: `z + s₁ + s₂ = 8`.

**Result:** Objective row `z + s₁ + s₂ = 8` has no negative coefficients, optimal at `x₁=4, x₂=4`, `z=8`, correctly matching the corner where the redundant third constraint touches. The degeneracy (`s₃=0` while still basic) did not cause cycling here, this particular problem happens to terminate cleanly in exactly 2 pivots despite the tie, illustrating that degeneracy is a real, identifiable tableau condition, not automatically a symptom of a stuck or broken algorithm.

### Example 2: sizing the Klee-Minty worst case concretely

**Problem:** For a Klee-Minty cube with `n = 30` variables, compare the number of pivots the standard entering-variable rule might need in the worst case against the number of vertices a `30`-dimensional ordinary hypercube-like polytope has.

**Calculation:** The Klee-Minty result gives a worst case of `2ⁿ = 2³⁰ = 1,073,741,824`, over one billion pivots, for a problem with only `30` decision variables, a strikingly small problem size for such an enormous worst-case pivot count. This is the concrete scale of the gap smoothed analysis explains away for real, non-adversarially-constructed problems: a problem this small is solved by simplex in practice using a number of pivots typically in the tens or low hundreds, not anywhere close to a billion.

## Common Misconceptions & Pitfalls

- **"Degeneracy means the algorithm has failed or gotten stuck."** Example 1 shows a genuinely degenerate pivot (`s₃=0` while basic) that still terminates correctly at the true optimum in exactly 2 pivots; degeneracy is a tableau state, not a failure, and only becomes a problem if it specifically leads to cycling, a rare, separate, and separately-preventable phenomenon (via Bland's rule).
- **"Since Klee-Minty proved simplex takes exponential time, using simplex on any real problem is a bad idea."** Example 2's billion-pivot worst case, for a mere 30-variable problem, is precisely the kind of adversarially engineered scenario that essentially never arises from real modeling; smoothed analysis gives a rigorous, not merely anecdotal, explanation for why simplex remains a fast, reliable, and still widely used choice in practice.
- **"Linear programming itself is an exponential-time problem, since its most famous algorithm is."** This conflates a specific algorithm's worst case with the problem's inherent difficulty; interior-point methods (Khachiyan's ellipsoid method, and practically, Karmarkar's algorithm) solve linear programming in worst-case polynomial time, so the *problem* of linear programming is efficiently solvable in the strict complexity-theoretic sense, even though the *simplex algorithm specifically* is not.
- **"Bland's rule should be used on every single pivot, in every implementation, to be safe."** Bland's rule guarantees termination but is typically slower in practice than simpler tie-breaking heuristics on the vast majority of real, non-degenerate or mildly-degenerate problems; most production implementations use a faster heuristic by default and reserve Bland's rule (or a similar anti-cycling safeguard) specifically for situations where an unusually long run signals cycling might actually be occurring.

## Summary

A degenerate basic feasible solution has a basic variable at value `0`, arising from a tie in the ratio test, as Example 1 constructs concretely and traces through to a correct (if degenerate) optimum; degeneracy alone is not a failure, but it can, in specifically constructed rare cases, lead to cycling, an infinite loop Bland's rule (always break ties by lowest variable index) provably prevents. Separately and more deeply, Klee and Minty's 1972 result shows the standard entering-variable rule can require `2ⁿ` pivots in the worst case, visiting every vertex of a specifically twisted `n`-dimensional polytope, proving simplex is not a worst-case polynomial-time algorithm, a fact smoothed analysis (Spielman and Teng, 2004) reconciles with simplex's overwhelmingly good practical performance by showing a small random perturbation of any input makes its expected running time polynomial. Crucially, this worst case belongs to the simplex *algorithm*, not to linear programming as a *problem*: interior-point methods solve linear programming in genuine worst-case polynomial time, closing the gap Klee and Minty's construction opened, even as simplex, for its geometric clarity, typical speed, and decades of continued practical dominance, remains the method this track has built in the fullest detail. The next concept turns to a genuinely different, and deeply informative, question about every linear program: its dual.

## Documentation Links

- [Spielman, D. A., & Teng, S.-H. (2004). "Smoothed Analysis of Algorithms." Journal of the ACM.](https://dl.acm.org/doi/10.1145/990308.990310): paper
- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
