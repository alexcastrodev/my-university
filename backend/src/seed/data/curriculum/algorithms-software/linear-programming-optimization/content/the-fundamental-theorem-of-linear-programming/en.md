---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- State the Fundamental Theorem of Linear Programming precisely: if a linear program has an optimal solution, at least one optimal solution occurs at a vertex of the feasible region.
- Prove the theorem for the case of a bounded feasible region, using convexity and the linearity of the objective function.
- Define a vertex algebraically, not just visually: a feasible point where enough constraints are simultaneously tight (satisfied with equality) to pin down a single point.
- Explain why this theorem is what turns solving a linear program from an infinite search into a finite one, in principle, even before any specific algorithm is introduced.
- Connect the theorem's algebraic characterization of a vertex to the "basic feasible solution" vocabulary the simplex method uses.

## Context & Motivation

The previous concept showed, by direct example, that a linear program's optimum always seemed to land on a vertex of the feasible region, never strictly inside it. That observation, demonstrated on two specific examples, is promoted here to a fully general, proven theorem, one that holds for every linear program with any number of variables and constraints whatsoever, not just the two-variable pictures a graph can show. This theorem is the single load-bearing fact underneath everything the rest of this track builds: without it, "search the feasible region for the best point" would mean searching an infinite continuum of possibilities; with it, the search provably collapses to a finite (if potentially large) list of candidate vertices, which is exactly what makes a systematic algorithm like simplex, the next concept, possible at all.

## Core Theory

### The theorem, stated precisely

**Fundamental Theorem of Linear Programming.** Consider a linear program whose feasible region is nonempty and bounded. Then an optimal solution exists, and at least one optimal solution occurs at a vertex of the feasible region.

The qualifier "at least one" matters: when the objective happens to be parallel to one of the region's edges (or, in higher dimensions, an entire face), every point along that edge or face achieves the same optimal value, including its endpoint vertices, so the optimum is not necessarily unique, but a vertex-located optimum is always among the optima that exist.

### Proof, for a bounded feasible region

Let `P` be the feasible region (a bounded convex polytope, established in the previous concept), and let `x*` be a point in `P` achieving the maximum objective value `z* = cᵀx*`. Suppose, for contradiction, that `x*` is *not* a vertex of `P`. Then, by the definition of a vertex (a point that cannot be written as a genuine average of two *other* distinct points of `P`), `x*` can be expressed as `x* = λx₁ + (1-λ)x₂` for two distinct points `x₁, x₂ ∈ P` and some `0 < λ < 1`.

By linearity of the objective: `cᵀx* = λ(cᵀx₁) + (1-λ)(cᵀx₂)`. Since `cᵀx*` is the *maximum* value over all of `P`, both `cᵀx₁ ≤ cᵀx*` and `cᵀx₂ ≤ cᵀx*` must hold (they are themselves feasible points, so neither can exceed the maximum). But a weighted average of two quantities, each at most `cᵀx*`, can equal `cᵀx*` exactly only if *both* quantities equal `cᵀx*` exactly (if either were strictly less, the weighted average would be strictly less too, a direct consequence of `λ` and `1-λ` both being strictly positive). So `cᵀx₁ = cᵀx₂ = cᵀx* = z*`: both `x₁` and `x₂` are themselves optimal.

This shows that whenever a maximum is achieved at a non-vertex point, it is *also* achieved at other points, and this argument can be applied again to `x₁` (or `x₂`) if either of those is itself not a vertex, repeating the same decomposition. Because `P` has only finitely many vertices (a consequence of it being a polytope, an intersection of finitely many half-spaces), this process cannot continue forever without eventually reaching a point that genuinely cannot be decomposed further, which is precisely the definition of a vertex. That vertex is optimal, proving the theorem.

### A vertex, characterized algebraically

The geometric picture (a "corner" where edges meet) has an exact algebraic counterpart that generalizes cleanly beyond two dimensions, and that the next concept's simplex method operates on directly: for a linear program in `n` variables with `m` constraints (after adding slack variables to turn every inequality into an equality, a mechanical step this concept anticipates and the next concept performs explicitly), a **vertex** corresponds to a solution where at least `n` of the `m + n` total variables (original plus slack) are set to exactly `0`, with the remaining variables' values pinned down uniquely by the `m` equality constraints. This is exactly what "enough constraints are simultaneously tight" means algebraically: setting `n` variables to `0` is equivalent to making `n` of the original inequality constraints (or nonnegativity restrictions) bind with equality, and a system of `m` equations in `m` remaining unknowns has, generically, exactly one solution, precisely a single point, a vertex.

### Why this makes the search finite

A polytope defined by `m` constraints in `n` dimensions has at most `C(m+n, n)` vertices (choosing which `n` variables to set to zero, out of `m+n` total, an upper bound since not every such choice yields a feasible point), a finite number, however large, for any *fixed* problem size. The Fundamental Theorem's guarantee, an optimum exists at a vertex, therefore reduces solving a linear program, in principle, to computing the objective at every one of these finitely many candidate points and taking the best. This is not yet an efficient algorithm (checking every vertex directly is itself exponentially slow for large problems, since the vertex count itself can grow combinatorially), but it is the crucial reduction from an uncountably infinite search space to a finite, well-defined combinatorial one, exactly the reduction the next concept's simplex method exploits with a far smarter search strategy than checking every vertex exhaustively.

## Worked Examples

### Example 1: verifying the theorem directly on the previous concept's example

**Problem:** For the modified workshop LP from the previous concept (`maximize 70x₁ + 90x₂`, `x₁+x₂≤10`, `x₁+3x₂≤24`, `x₁,x₂≥0`, optimal vertex `(3,7)` at value `840`), confirm `(3,7)` genuinely cannot be written as a non-trivial average of two other distinct feasible points, verifying it is a true vertex, not an interior point masquerading as one.

**Checking:** `(3,7)` lies exactly on both constraint boundaries simultaneously: `x₁+x₂=3+7=10` (tight) and `x₁+3x₂=3+21=24` (tight). With two independent linear equations pinning down both coordinates exactly, there is no direction to perturb `(3,7)` in that keeps both equations satisfied, any nearby feasible point in any direction violates at least one of the two tight constraints. This is exactly the algebraic signature of a vertex: two tight constraints (matching the count needed to pin down a point in two dimensions), leaving no freedom to express it as an average of two distinct feasible points.

### Example 2: applying the proof's decomposition argument to a non-vertex point

**Problem:** On the same feasible region, consider the point `(5, 5)`. Verify it is feasible, show it is not a vertex, and use the theorem's proof technique to find two feasible points averaging to it with matching or higher objective value.

**Feasibility check:** `x₁+x₂=10≤10` ✓ (tight). `x₁+3x₂=5+15=20≤24` ✓ (not tight). So `(5,5)` is feasible, but only *one* constraint is tight (plus neither nonnegativity constraint), one short of the two needed to pin down a vertex in two dimensions, confirming `(5,5)` is not a vertex.

**Decomposition:** Since only `x₁+x₂=10` is tight, `(5,5)` lies along the entire edge of points satisfying `x₁+x₂=10` with `x₁+3x₂≤24`, this edge runs from `(10,0)` (`700`, computed previously) to `(3,7)` (`840`, computed previously). Writing `(5,5)` as a combination of these two endpoints: `(5,5) = λ(10,0) + (1-λ)(3,7)` gives `5 = 10λ + 3(1-λ) = 3 + 7λ`, so `λ = 2/7`. The objective at `(5,5)` is `70(5)+90(5)=350+450=800`, which indeed sits between `700` and `840` as the theorem's proof predicts (a weighted average of the two endpoint values: `(2/7)(700) + (5/7)(840) = 200 + 600 = 800` ✓), and strictly less than the vertex `(3,7)`'s `840`, confirming the non-vertex point is not itself optimal, exactly as the theorem's proof argues must eventually be the case when tracing back from any non-optimal, non-vertex point.

## Common Misconceptions & Pitfalls

- **"The theorem says the optimum is always unique."** It says an optimum always occurs *at* a vertex, not that it occurs *only* there; when the objective is parallel to an edge, every point on that edge, not just its vertex endpoints, achieves the same optimal value, so multiple optima (a whole edge or face of them) can exist simultaneously.
- **"A point where one constraint is tight is a vertex."** Example 2's point `(5,5)` has exactly one tight constraint and is explicitly shown not to be a vertex; a vertex in `n` dimensions generically requires `n` simultaneously tight constraints (or bound variables), not merely one.
- **"This theorem only applies to two-variable problems that can be drawn."** The proof given here uses only convexity and linearity, arguments that make no reference to any specific dimension count at all; the theorem holds with full generality for any number of variables and constraints, which is precisely why it underlies the simplex method's ability to handle problems with thousands of variables, far beyond what any picture could show directly.
- **"If a linear program is unbounded (in the objective, not just the region), the theorem still guarantees a vertex-located optimum."** The theorem as proved here explicitly assumes a bounded feasible region; when the objective is unbounded (a genuine possibility, as the previous concept noted), no optimum exists at all, at a vertex or anywhere else, and the theorem's conclusion simply does not apply to that case, a distinct outcome the next several concepts' algorithms must detect and report rather than search for indefinitely.

## Summary

The Fundamental Theorem of Linear Programming states that whenever a linear program (with a bounded feasible region) has an optimal solution, at least one optimal solution occurs at a vertex, proved by convexity: any non-vertex optimal point can be written as an average of two other feasible points, and linearity forces both of those points to be equally optimal, a decomposition that can be repeated until a genuine vertex, which cannot be decomposed further, is reached. Algebraically, a vertex in `n` dimensions corresponds to a point where `n` constraints (or nonnegativity restrictions) are simultaneously tight, pinning it down uniquely, exactly the "basic feasible solution" vocabulary the next concept's simplex method is built around. This theorem is what turns "search the entire feasible region" into "search a finite list of vertices," a reduction from an uncountable to a combinatorial search space, even though checking every vertex directly remains too slow to be a practical algorithm on its own. The next concept introduces the simplex method: a way of moving from vertex to adjacent vertex, always improving the objective, without ever needing to enumerate every vertex the way a brute-force check would.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Stanford CS261 - Optimization and Algorithmic Paradigms](https://web.stanford.edu/class/cs261/): doc
