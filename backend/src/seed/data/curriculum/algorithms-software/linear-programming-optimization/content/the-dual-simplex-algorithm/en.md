---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Recognize a dual-feasible, primal-infeasible tableau: every coefficient in the objective row is nonnegative, but at least one right-hand side is negative.
- State the dual simplex algorithm's entering and leaving variable rules, and explain why they are, structurally, a mirror image of ordinary (primal) simplex's rules.
- Execute the dual simplex algorithm on a concrete tableau, restoring primal feasibility while never losing dual feasibility along the way.
- Explain the algorithm's most common practical use: re-optimizing an already-solved linear program after a new constraint is added, without restarting the search from scratch.
- Verify, on a worked example, that dual simplex reaches the identical optimal value ordinary simplex would reach starting over from the beginning.

## Context & Motivation

Ordinary simplex, as built several concepts ago in this track, starts from a primal-feasible tableau (every right-hand side nonnegative) that is typically far from optimal (the objective row has negative coefficients), and works toward optimality one pivot at a time while never sacrificing feasibility. This concept builds the mirror image of that process: the **dual simplex algorithm** starts from a tableau that is already **dual feasible** (the objective row already has no negative coefficients, the optimality condition ordinary simplex works toward) but is **primal infeasible** (some right-hand side is negative, violating a basic variable's nonnegativity), and works toward primal feasibility one pivot at a time while never sacrificing dual feasibility. This exact situation, dual-feasible but primal-infeasible, arises naturally and often in practice: adding one new constraint to an already-solved linear program typically leaves the old optimal tableau's objective row untouched (still dual feasible) while introducing a new row that the old solution violates (primal infeasible), and re-optimizing from that starting point directly is dramatically cheaper than solving the augmented problem again from the origin.

## Core Theory

### The mirror-image algorithm

Where ordinary simplex picks an **entering** variable first (most negative objective-row coefficient) and then a **leaving** variable via a ratio test on the entering column, dual simplex reverses the order entirely:

1. **Leaving variable first.** Choose the row whose right-hand side is most negative (the most infeasible basic variable); that row's basic variable leaves.
2. **Entering variable second, via a reversed ratio test.** Among the columns with a *negative* coefficient in the leaving row (a column with a nonnegative coefficient there cannot restore feasibility without breaking dual feasibility elsewhere, and is excluded from consideration entirely), choose the one minimizing the ratio (objective-row coefficient) divided by (the absolute value of that column's coefficient in the leaving row). This ratio, computed only over negative-coefficient columns, is the exact structural mirror of ordinary simplex's ratio test over positive-coefficient columns.
3. **Pivot exactly as before**, Gauss-Jordan elimination around the chosen entry, and repeat until every right-hand side is nonnegative (primal feasibility restored), at which point, since dual feasibility was maintained at every step along the way, the current tableau is immediately optimal for the augmented problem, with no further work needed.

### Why this is the natural tool for re-optimization

The single most common practical scenario for dual simplex is exactly the one this concept's worked example builds: a linear program has already been solved to optimality by ordinary simplex, and then a new constraint is added (a tightened resource limit discovered after the fact, a new regulatory restriction, a "what if we also required..." scenario). The previous optimal tableau's objective row, expressed in terms of the *same* basic variables, is completely unaffected by adding one new row, it is still dual feasible. But the new row, expressed in terms of that same basis, may well have a negative right-hand side (exactly when the old optimal solution violates the new constraint), making the augmented tableau primal infeasible. Restarting ordinary simplex completely from the origin would throw away everything already computed; dual simplex instead repairs *only* the new infeasibility directly, typically in far fewer pivots than a full restart would need.

## Worked Examples

### Example 1: re-optimizing the workshop LP after adding a new constraint `x₁ ≤ 2`

**Problem:** This track's earlier concepts solved `maximize 70x₁ + 90x₂` subject to `x₁+x₂≤10`, `x₁+3x₂≤24`, reaching the optimal tableau `x₁ + 1.5s₁ - 0.5s₂ = 3` (row 1), `x₂ - 0.5s₁ + 0.5s₂ = 7` (row 2), `z + 60s₁ + 10s₂ = 840` (objective), with `x₁=3, x₂=7`. Suppose a new constraint, `x₁ ≤ 2`, is added. Re-optimize using dual simplex, starting from this existing tableau rather than from scratch.

**Building the new row, in terms of the current basis.** Substituting `x₁ = 3 - 1.5s₁ + 0.5s₂` (from row 1) into the new constraint `x₁ ≤ 2` gives `3 - 1.5s₁ + 0.5s₂ ≤ 2`, i.e. `-1.5s₁ + 0.5s₂ ≤ -1`, and adding a slack `s₃`: **row 3:** `-1.5s₁ + 0.5s₂ + s₃ = -1`. This row's basic variable is `s₃ = -1`, primal infeasible (violates `s₃ ≥ 0`), while the objective row `z+60s₁+10s₂=840` remains entirely unchanged, still dual feasible (no negative coefficients).

**Dual simplex, leaving variable:** Only row 3 has a negative right-hand side (`-1`), so `s₃` leaves.

**Dual simplex, entering variable:** In row 3, the coefficients are `s₁: -1.5`, `s₂: +0.5` (`s₃`'s own coefficient, `+1`, is excluded as the leaving variable's own column). Only `s₁` has a negative coefficient, so it is the only candidate and enters directly (with only one eligible column, the ratio test has nothing to compare against).

**Pivoting on row 3's `s₁` coefficient (`-1.5`):** Dividing row 3 by `-1.5` gives `s₁ - (1/3)s₂ - (2/3)s₃ = 2/3`. Eliminating `s₁` from row 1 (`row1 - 1.5×row3new`) gives `x₁ + s₃ = 2`. Eliminating `s₁` from row 2 (`row2 + 0.5×row3new`) gives `x₂ + (1/3)s₂ - (1/3)s₃ = 22/3`. Eliminating `s₁` from the objective row (`obj - 60×row3new`) gives `z + 30s₂ + 40s₃ = 800`.

**Result:** Every right-hand side (`2`, `22/3`, `2/3`) is now nonnegative, primal feasibility is restored, and the objective row (`z+30s₂+40s₃=800`) still has no negative coefficients, so this is immediately optimal: `x₁=2`, `x₂=22/3`, value `800`, reached in exactly **one** dual simplex pivot starting from the old optimal tableau.

**Independent verification:** With `x₁` capped at `2`, the remaining constraints on `x₂` are `x₂ ≤ 10-2=8` (from the first) and `3x₂ ≤ 24-2=22`, i.e. `x₂ ≤ 22/3≈7.33` (from the second, the binding one). Objective at `x₁=2, x₂=22/3`: `70(2)+90(22/3) = 140+660=800`, exactly matching the dual simplex result, confirming the answer independently without needing to re-run ordinary simplex on the augmented problem from the origin at all.

## Common Misconceptions & Pitfalls

- **"Dual simplex solves the dual linear program."** It solves the *primal* problem (the same variables, `x₁` and `x₂`, appear in the final answer), it is called "dual" simplex because it maintains dual feasibility as its invariant throughout, exactly mirroring how ordinary ("primal") simplex maintains primal feasibility as its own invariant; neither name refers to which problem, primal or dual, is ultimately being solved.
- **"Any column with a negative coefficient in the leaving row is an equally valid entering-variable choice."** Core Theory's ratio test (minimizing the objective-row coefficient divided by the absolute value of the leaving row's coefficient, among negative-coefficient columns only) is not arbitrary, choosing incorrectly among multiple negative-coefficient candidates can reintroduce a negative coefficient into the objective row, breaking the dual feasibility the algorithm is specifically built to preserve at every step.
- **"Re-solving from scratch and using dual simplex to re-optimize after a new constraint always give different answers, since they start from different points."** Example 1's result (`x₁=2, x₂=22/3`, value `800`) is verified independently by direct substitution, confirming it is the actual optimum of the augmented problem; dual simplex reaches the identical correct answer ordinary simplex would eventually reach restarting from the origin, simply in far fewer steps by reusing the previous solution's work.
- **"Dual simplex is only a theoretical curiosity, since ordinary simplex could always just be rerun from scratch instead."** Example 1 needed exactly one pivot to re-optimize after a new constraint; rerunning ordinary simplex on the augmented problem from the origin would not necessarily be nearly as fast, this efficient re-optimization capability is precisely why dual simplex is standard machinery in real solvers handling sensitivity analysis and iterative model refinement, not merely a mirror-image exercise.

## Summary

Dual simplex starts from a tableau that is dual feasible (no negative objective-row coefficients) but primal infeasible (some negative right-hand side), and restores primal feasibility one pivot at a time while never breaking dual feasibility, the exact structural mirror of ordinary simplex's own process. Its leaving variable is the most infeasible row (most negative right-hand side); its entering variable is chosen, among that row's negative-coefficient columns only, by a reversed ratio test. This situation, dual feasible but primal infeasible, arises naturally whenever a new constraint is added to an already-optimal linear program, exactly the scenario Example 1 works through in full: adding `x₁≤2` to the workshop LP's optimal tableau needed exactly one dual simplex pivot to reach the new optimum, `x₁=2, x₂=22/3` at value `800`, independently verified by direct substitution, without ever restarting the search from the origin. The next concept turns to a different kind of extension entirely: linear programs whose variables are required to take integer values, and the branch-and-bound method built to handle them.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [Dantzig, G. B. (1963). Linear Programming and Extensions. Princeton University Press.](https://press.princeton.edu/books/paperback/9780691059136/linear-programming-and-extensions): book
