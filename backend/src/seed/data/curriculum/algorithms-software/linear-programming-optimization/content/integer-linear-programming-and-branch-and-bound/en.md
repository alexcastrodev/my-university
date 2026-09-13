---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Define integer linear programming (ILP): a linear program with the added requirement that some or all variables take integer values.
- Define the LP relaxation of an ILP, and explain why its optimal value is always at least as good as the ILP's own optimal value for a maximization problem.
- Explain, with a concrete counterexample, why naively rounding an LP relaxation's optimal solution can give a suboptimal, or even infeasible, answer.
- Execute the branch-and-bound algorithm in full: solve the relaxation, branch on a fractional variable into two subproblems, and prune any subproblem whose relaxation bound cannot beat the best integer solution already found.
- Connect branch-and-bound to the 0/1 Knapsack dynamic-programming solution already covered elsewhere in this curriculum, as two different exact approaches to a similar family of integer optimization problems.

## Context & Motivation

Every linear program solved so far in this track has allowed its variables to take any real, fractional value: `2.7857` tables, `0.357` chairs, values that were entirely sensible for the specific worked examples chosen, but that are simply meaningless for a genuinely large class of real problems, deciding whether to build a factory (yes or no, not `0.6` of a factory), how many trucks to dispatch (a whole number), or which of a set of projects to fund (each fully in or fully out). **Integer linear programming** adds exactly one requirement to everything built so far: some or all decision variables must take integer values. This single addition, deceptively small on the page, changes everything about how the problem must be solved: the elegant guarantee from several concepts ago, that an optimum always sits at a vertex of a convex region, no longer directly delivers an integer-valued answer, because a polytope's vertices are not generally integer points at all. This concept builds the standard general-purpose method for solving integer linear programs exactly despite that fact: **branch and bound**.

## Core Theory

### The LP relaxation, and why it always gives an optimistic bound

Given an integer linear program, its **LP relaxation** is the identical problem with the integrality requirement simply dropped, solved as an ordinary linear program by everything already built in this track. For a maximization problem, the relaxation's optimal value is always **at least as good as** the ILP's own optimal value, since every integer-feasible solution is automatically also relaxation-feasible (integers are a subset of the reals), so the relaxation searches over a strictly larger set of candidates and can only do as well or better. This one-directional guarantee, relaxation value ≥ true integer value, is the foundation branch and bound is built on: it turns the relaxation's optimal value into a computable **upper bound** on the answer being searched for.

### Why naive rounding does not work

A tempting shortcut, solve the relaxation, then round its fractional optimal solution to the nearest integers, fails for a structural reason worth stating precisely: rounding does not account for how the constraints interact, a rounded point can violate a constraint the fractional point satisfied exactly (an infeasible rounding), or, even when it happens to remain feasible, it is not guaranteed to be anywhere near the *best* integer point available, since the true integer optimum can sit at a completely different, non-adjacent integer point the rounding procedure never considers at all.

### Branch and bound, stated as an algorithm

**Branch and bound** systematically searches the space of integer solutions without ever having to enumerate all of them individually, using the LP relaxation's bound to prune away entire regions of that space at once:

1. **Solve the LP relaxation** of the current subproblem (initially, the entire original problem). If its solution happens to already be integer-valued, it is a valid candidate for the true optimum, record it if it is the best integer solution found so far (the current **incumbent**), and this subproblem needs no further exploration.
2. **If the relaxation's solution is fractional** in some variable `xⱼ`, **branch**: create two new subproblems, identical to the current one except one adds the constraint `xⱼ ≤ ⌊value⌋` (rounding that variable's fractional value down) and the other adds `xⱼ ≥ ⌈value⌋` (rounding it up), covering every integer possibility for `xⱼ` between them while excluding the fractional value itself.
3. **Bound and prune.** Before fully exploring a subproblem, compare its own relaxation's optimal value against the current incumbent's value. If the subproblem's relaxation bound cannot possibly beat the incumbent (for a maximization problem, if the relaxation's value is no better than the incumbent's), that entire subproblem, and everything it could ever branch into, is discarded without further exploration, since no integer solution inside it could possibly improve on what has already been found.
4. **Repeat** until every subproblem has either yielded an integer solution or been pruned; the best integer solution found across the entire search is the true optimum.

### Connection to dynamic programming

This curriculum's algorithms discipline already solved one specific, famous integer optimization problem, 0/1 Knapsack, using dynamic programming: filling a table of subproblem answers indexed by item count and remaining capacity. Branch and bound is a genuinely different, more general approach to the same broad family of integer optimization problems: rather than a fixed table indexed by a problem-specific structure, it searches a tree of LP relaxations, pruned by bounds, applicable to essentially any integer linear program regardless of its specific combinatorial shape, at the cost of no longer having dynamic programming's guaranteed polynomial-time table size for problems (like 0/1 Knapsack) where that specific structure happens to apply.

## Worked Examples

### Example 1: full branch and bound, including a naive-rounding pitfall

**Problem:** Solve `maximize x₁ + x₂` subject to `2x₁ + 4x₂ ≤ 7`, `5x₁ + 3x₂ ≤ 15`, `x₁, x₂ ≥ 0` and integer, using branch and bound.

**Root relaxation.** Solving the LP relaxation (dropping integrality) by finding all vertices: `(0,0)` value `0`; `(3,0)` (from `5x₁≤15`, checking `2(3)=6≤7` ✓) value `3`; `(0,1.75)` (from `4x₂≤7`, checking `3(1.75)=5.25≤15` ✓) value `1.75`; and the intersection of the two constraint lines, solving `2x₁+4x₂=7` and `5x₁+3x₂=15` simultaneously gives `x₁≈2.786, x₂≈0.357`, value `≈3.143`, the largest of the four, so this is the relaxation's optimum.

**The rounding pitfall.** Naively rounding `(2.786, 0.357)` down to `(2, 0)` gives a feasible point (`2(2)+4(0)=4≤7` ✓, `5(2)+3(0)=10≤15` ✓) with value `2`, strictly worse than the true integer optimum this example finds below (`3`), a concrete demonstration that rounding a fractional LP-optimal solution is not a reliable substitute for solving the integer program properly.

**Branching on `x₁` (fractional at `≈2.786`).** **Branch B (`x₁ ≥ 3`):** combined with `5x₁+3x₂≤15` and `x₂≥0`, `x₁` cannot exceed `3` at all (any `x₁>3` would force `x₂<0`), so this branch's feasible region collapses to the single point `(3,0)`, already integer, value `3`. This becomes the new incumbent.

**Branch A (`x₁ ≤ 2`):** solving this subproblem's relaxation, the best point is `(2, 0.75)` (`x₁` at its new cap `2`, and `4x₂≤7-4=3` giving `x₂≤0.75`, checked against `5(2)+3(0.75)=12.25≤15` ✓), value `2.75`.

**Pruning branch A.** Branch A's relaxation bound, `2.75`, is worse than the incumbent's value, `3` (found from branch B), so no integer solution inside branch A could possibly beat `3`; branch A is pruned without any further branching.

**Result.** The search terminates with the incumbent from branch B as the true optimum: `(x₁,x₂)=(3,0)`, value `3`, found by exploring only two subproblems beyond the root, not by enumerating every integer point in the feasible region individually.

## Common Misconceptions & Pitfalls

- **"Rounding the LP relaxation's optimal solution to the nearest integers is a reasonable approximation."** Example 1's rounded point `(2,0)` achieves only `2`, while the true integer optimum is `3`, a meaningful, non-trivial gap on a genuinely small example; rounding can be arbitrarily far from optimal (or infeasible entirely) on other problems, which is exactly why branch and bound exists as an exact method rather than a rounding heuristic being considered sufficient.
- **"Branching always requires exploring both new subproblems fully."** Example 1 explored branch B's relaxation and found it already integer, then explored branch A's relaxation and pruned it immediately based on its bound alone, without ever branching further inside branch A at all; pruning by bound is what keeps branch and bound from degenerating into exhaustive enumeration of every integer point.
- **"The LP relaxation's optimal value is only a loose, not-very-useful estimate of the integer optimum."** The relaxation's value, `≈3.143` at the root, was tight enough to immediately prune an entire subtree (branch A, bounded at `2.75`) using only one comparison against the incumbent; the relaxation bound is doing real, load-bearing work in cutting down the search, not merely providing a vague sense of scale.
- **"Branch and bound and the 0/1 Knapsack dynamic programming solution are competing techniques, and one is simply better than the other."** They are different tools with different trade-offs: dynamic programming exploits Knapsack's specific subproblem structure for a guaranteed running time, while branch and bound applies to essentially any integer linear program at all, at the cost of no general running-time guarantee; the right tool depends on whether a problem has the specific structure dynamic programming can exploit.

## Summary

An integer linear program adds the requirement that some or all variables take integer values, and its LP relaxation (the same problem with that requirement dropped) always gives an optimistic bound, at least as good as the true integer optimum for a maximization problem, because integer solutions are a subset of the relaxation's own feasible set. Naive rounding of the relaxation's fractional optimum is not a reliable substitute, Example 1 shows a rounded answer of `2` where the true optimum is `3`. Branch and bound solves the integer program exactly instead: solve the relaxation, branch on a fractional variable into a "round down" and "round up" subproblem, and prune any subproblem whose own relaxation bound cannot beat the best integer solution already found, exactly the process Example 1 completes in two branches (one immediately integer, becoming the incumbent; the other pruned by its own worse bound) rather than an exhaustive search over every integer point. This general method complements, rather than replaces, dynamic programming's exact solution to specific integer optimization problems like 0/1 Knapsack, applicable even when a problem lacks the specific overlapping-subproblem structure dynamic programming requires. The final concept in this track closes the loop back to earlier material in this curriculum, connecting linear programming duality directly to the max-flow min-cut theorem this curriculum's algorithms discipline already proved by an entirely different route.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [ACM/IEEE CS2013 - Algorithms and Complexity Knowledge Area](https://csed.acm.org/cs2013-version/): doc
