---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Explain why a `≥` or `=` constraint breaks the simplex method's usual "start at the origin" trick, even after algebraically converting `≥` to `≤`.
- Introduce artificial variables to construct an easy, if fictitious, starting basic feasible solution for any linear program, regardless of constraint direction.
- Execute the two-phase method in full: a Phase 1 sub-problem that drives every artificial variable to zero, followed by a Phase 2 that optimizes the real objective from the feasible vertex Phase 1 found.
- State, at a conceptual level, the alternative Big-M method, and explain the practical trade-off between the two approaches.
- Recognize when Phase 1 alone already lands on the real problem's optimal vertex, and verify that outcome directly rather than assuming more work remains.

## Context & Motivation

The simplex method, as built two concepts ago, leaned on one convenient fact: setting every original variable to `0` and reading the slack variables directly off the right-hand sides gives an immediate, always-feasible starting vertex, as long as every constraint is a `≤` with a nonnegative right-hand side. Real problems are not always so accommodating. The diet-planning problem introduced in this track's first concept has *minimum* nutritional requirements, `≥` constraints, and converting `≥` to `≤` by negation (the mechanical rule from that same concept) turns a positive right-hand side negative, which makes the "set slacks equal to the right-hand side" starting point infeasible on the spot (a negative slack violates the nonnegativity every simplex variable must obey). This concept builds the fix: a way of manufacturing a valid starting vertex for *any* linear program, whatever its constraints' directions, by temporarily introducing variables that exist purely to make that first step possible.

## Core Theory

### Why `≥` and `=` constraints break the easy start

Consider `x₁ + 3x₂ ≥ 15`. Subtracting a nonnegative **surplus variable** `e` (the natural counterpart to a slack, now measuring how much the left side *exceeds* the requirement rather than how much room is left) turns this into an equation: `x₁ + 3x₂ - e = 15`. Setting `x₁ = x₂ = 0` forces `e = -15`, violating `e ≥ 0` immediately. The obvious starting point is simply not feasible, and no amount of algebraic rearrangement of this one constraint alone fixes that; a genuinely different starting vertex is needed, and finding one is not always obvious by inspection once several constraints of this kind interact.

### Artificial variables: a fictitious but easy starting point

The fix is to add a further nonnegative **artificial variable** `a` on top of the surplus variable: `x₁ + 3x₂ - e + a = 15`. Now setting `x₁ = x₂ = e = 0` and `a = 15` satisfies the equation with every variable nonnegative, an immediately feasible (if fictitious) starting point. Every `≥` constraint gets its own artificial variable this way (and every `=` constraint gets one too, directly, since it has no slack or surplus of its own to begin with). The word "fictitious" matters: a solution with `a > 0` is not a solution to the *original* problem at all, it satisfies the modified equation only because `a` is silently absorbing the gap; the entire point of what follows is to drive every artificial variable back down to exactly `0` before trusting any answer.

### Phase 1: minimizing the artificials to find a real feasible vertex

The **two-phase method** handles this directly, as a linear program of its own: **Phase 1** solves a sub-problem, minimize the sum of every artificial variable, subject to the same constraints (each augmented with its surplus and artificial variable) and nonnegativity. This sub-problem always has an easy starting vertex (every artificial variable at its own equation's right-hand side, exactly as constructed above), so ordinary simplex, exactly as built in the previous concept, can solve it directly. Two outcomes are possible:

- **Phase 1's optimal value is `0`.** Every artificial variable has been driven down to exactly `0`, meaning the basic feasible solution simplex arrived at (with the artificial columns now dropped or ignored) is a genuine feasible vertex of the *original* problem, ready to serve as the starting point for **Phase 2**: re-solve using the real objective, starting from exactly this vertex, continuing with ordinary simplex pivots until real optimality is reached.
- **Phase 1's optimal value is strictly positive.** No assignment of the original variables can satisfy every constraint simultaneously without some artificial variable propping things up; the original problem is genuinely **infeasible**, and Phase 2 never runs at all, this is exactly how simplex detects and reports infeasibility rather than searching forever for a vertex that does not exist.

### The Big-M alternative, briefly

A second, older technique, the **Big-M method**, folds both phases into a single run: instead of a separate Phase 1 objective, the artificial variables are added directly to the *real* objective with an enormous penalty coefficient `M` (conceptually, a number large enough to guarantee simplex will always prefer driving any artificial variable to `0` over keeping it positive, however that trades off against the real objective's own terms). This avoids ever needing a literal second phase, at the cost of introducing a symbolic (or awkwardly large numeric) constant `M` into every calculation, and some risk of numerical instability in an actual computer implementation if `M` is chosen too large or too small relative to the problem's own coefficients. The two-phase method, used throughout this concept's worked example, avoids that awkwardness entirely by keeping the two objectives fully separate, and is generally the more commonly taught and more numerically reliable of the two in practice.

## Worked Examples

### Example 1: solving the diet-planning problem by the two-phase method, in full

**Problem:** Solve `minimize 2x₁ + 3x₂` subject to `4x₁ + 2x₂ ≥ 20`, `x₁ + 3x₂ ≥ 15`, `x₁, x₂ ≥ 0` (this track's first concept's diet problem) using the two-phase method.

**Setup.** Subtracting surplus and adding artificial variables: `4x₁ + 2x₂ - e₁ + a₁ = 20`, `x₁ + 3x₂ - e₂ + a₂ = 15`. Starting point: `a₁ = 20`, `a₂ = 15`, everything else `0`.

**Phase 1 objective.** Minimizing `a₁ + a₂` is equivalent to maximizing `z' = -a₁ - a₂`. Substituting `a₁ = 20 - 4x₁ - 2x₂ + e₁` and `a₂ = 15 - x₁ - 3x₂ + e₂` gives `z' = -35 + 5x₁ + 5x₂ - e₁ - e₂`, so the Phase 1 tableau's objective row reads `z' - 5x₁ - 5x₂ + e₁ + e₂ = -35`.

**Phase 1, iteration 1:** Both `x₁` and `x₂` have coefficient `-5`; choose `x₁` to enter. Ratio test: row 1, `20/4 = 5`; row 2, `15/1 = 15`. Row 1 wins, `a₁` leaves. Pivoting on row 1's `x₁` coefficient (4) and eliminating `x₁` from row 2 and the objective row gives, after the arithmetic: row 1 becomes `x₁ + 0.5x₂ - 0.25e₁ + 0.25a₁ = 5`; row 2 becomes `2.5x₂ + 0.25e₁ - e₂ - 0.25a₁ + a₂ = 10`; the objective row becomes `z' - 2.5x₂ - 0.25e₁ + e₂ + 1.25a₁ = -10`.

**Phase 1, iteration 2:** `-2.5` (for `x₂`) is the only negative coefficient remaining, so `x₂` enters. Ratio test: row 1, `5 / 0.5 = 10`; row 2, `10 / 2.5 = 4`. Row 2 wins, `a₂` leaves. Pivoting on row 2's `x₂` coefficient (2.5): row 2 becomes `x₂ + 0.1e₁ - 0.4e₂ - 0.1a₁ + 0.4a₂ = 4`. Eliminating `x₂` from row 1 gives `x₁ - 0.3e₁ + 0.2e₂ + 0.3a₁ - 0.2a₂ = 3`. Eliminating `x₂` from the objective row gives `z' + a₁ + a₂ = 0`.

**Phase 1 result:** The objective row `z' + a₁ + a₂ = 0` has no negative coefficients, so Phase 1 terminates with `z' = 0`, meaning `a₁ = a₂ = 0` (Phase 1's minimum value of `0`, confirming feasibility). The basic feasible solution reached is `x₁ = 3`, `x₂ = 4`, `e₁ = e₂ = 0` (both original constraints tight, matching the intersection vertex this track's graphical method would also find).

**Phase 2 setup.** Drop the artificial variables entirely and substitute the *real* objective, `minimize 2x₁ + 3x₂`, i.e. `maximize z = -2x₁ - 3x₂`, using Phase 1's final rows (`x₁ = 3 + 0.3e₁ - 0.2e₂`, `x₂ = 4 - 0.1e₁ + 0.4e₂`): `z = -2(3 + 0.3e₁ - 0.2e₂) - 3(4 - 0.1e₁ + 0.4e₂) = -18 - 0.3e₁ - 0.8e₂`, giving the objective row `z + 0.3e₁ + 0.8e₂ = -18`.

**Phase 2 result:** Both literal coefficients in this row, `+0.3` and `+0.8`, are already nonnegative, no negative coefficient remains, so Phase 2 requires zero further pivots: the vertex Phase 1 found is *already* optimal for the real objective. The final answer: `x₁ = 3`, `x₂ = 4`, minimum cost `2(3) + 3(4) = 18`, exactly matching the vertex `(3,4)` this track's own vertex-by-vertex check would find (evaluating `2x₁+3x₂` at the region's three finite vertices `(0,10)`, `(3,4)`, `(15,0)` gives `30`, `18`, `30` respectively, confirming `(3,4)` is indeed the minimum).

## Common Misconceptions & Pitfalls

- **"Phase 2 always needs at least one pivot, since Phase 1 only solved a different (artificial) objective."** Example 1 shows Phase 1's final vertex can coincide exactly with the real problem's optimum, verified directly by checking the recomputed real-objective row already has no negative coefficients; when this happens, Phase 2 correctly terminates immediately, this is a valid outcome to recognize and confirm, not a sign that a step was skipped by mistake.
- **"Artificial variables are a legitimate part of the final answer, and their value should be reported."** Artificial variables exist solely to construct a starting point for Phase 1 and are dropped entirely once Phase 1 confirms feasibility (`z' = 0`); a nonzero artificial variable in the *final* Phase 2 tableau would indicate infeasibility was not actually resolved, not a valid part of the solution.
- **"If Phase 1's optimal value is very small but not exactly zero, the problem is 'almost' feasible and can be treated as solved."** Phase 1's minimum must be exactly `0` for the original constraints to be genuinely satisfiable; any strictly positive minimum, however small, means no combination of the original variables satisfies every constraint simultaneously, a hard infeasibility, not a rounding-tolerant approximation.
- **"The Big-M method and the two-phase method can give different final answers for the same problem."** Both are exact, equivalent techniques for handling artificial variables, correctly implemented, they arrive at the identical optimal solution and value; they differ only in mechanism (one penalty-based single run, one two-stage run) and in numerical practicality, never in the underlying answer.

## Summary

A `≥` or `=` constraint denies simplex its usual free starting vertex, since converting `≥` to `≤` by negation turns a positive right-hand side negative, making the origin infeasible on the spot. Artificial variables fix this by construction, one added per `≥` or `=` constraint, giving an immediately feasible (if fictitious) starting point for a Phase 1 sub-problem that minimizes their sum; reaching Phase 1's minimum of exactly `0` certifies a genuine feasible vertex of the real problem, from which Phase 2 optimizes the real objective using ordinary simplex pivots, while a strictly positive Phase 1 minimum certifies the original problem is infeasible outright. Example 1's full two-phase trace on the diet-planning problem reaches `x₁ = 3, x₂ = 4` at cost `18`, with Phase 1 alone landing exactly on the real optimum, confirmed directly rather than assumed, so Phase 2 needed zero further pivots. The Big-M method achieves the identical result by folding both objectives into one penalty-weighted run instead, a mechanical alternative rather than a different answer. The next concept turns to what happens when the simplex method's clean, always-terminating picture breaks down, or appears to, and what that reveals about the algorithm's actual worst-case behavior.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
