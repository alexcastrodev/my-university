---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Formulate the maximum flow problem as a linear program: a linear objective over per-edge flow variables, subject to capacity inequalities and flow-conservation equalities.
- State the extended duality rule this formulation requires: an equality constraint's dual variable is unrestricted in sign ("free"), not required to be nonnegative like an inequality constraint's dual variable.
- Construct the max-flow linear program's dual, and interpret its variables as a fractional relaxation of an s-t cut: a vertex "potential" for every vertex and an "edge cost" for every edge.
- Verify, on the exact network this curriculum's algorithms discipline already solved by Ford-Fulkerson, that the known minimum cut's indicator values satisfy the dual exactly, with dual objective value equal to the already-known maximum flow value.
- Explain why this gives a second, completely independent proof of the max-flow min-cut theorem, one grounded in linear programming duality rather than the residual-graph argument this curriculum used previously.

## Context & Motivation

This track opened by building linear programming as a general modeling language, and the previous several concepts developed its two deepest structural results: the simplex method's mechanical guarantee of an optimal vertex, and the primal-dual relationship's guarantee that a linear program's optimal value always equals its dual's optimal value exactly. This closing concept turns those results back onto a problem this curriculum already solved by an entirely different route: the algorithms discipline's network flow topic proved, via Ford-Fulkerson's residual graphs and a constructive argument about reachable vertex sets, that a network's maximum flow value always equals its minimum cut's capacity exactly. This concept reveals that same fact as a direct, unavoidable *consequence* of the strong duality theorem proved two concepts ago, once the max-flow problem is correctly written down as a linear program, a genuinely different proof of a theorem this curriculum has now established twice, by two structurally unrelated arguments arriving at the identical result.

## Core Theory

### The max-flow linear program

Recall a flow network's two defining conditions from this curriculum's network flow concept: a capacity constraint on every edge, `0 ≤ f(u,v) ≤ c(u,v)`, and a conservation equality at every vertex other than the source `s` and sink `t`, `sum of f(u,v) over u = sum of f(v,w) over w`. Both conditions are already linear, so the maximum flow problem is already, without any translation needed, a linear program: **maximize** `sum of f(s,v) over v`, subject to every edge's capacity constraint and every intermediate vertex's conservation equality.

### The extended duality rule: equality constraints get a free dual variable

This linear program has a constraint type this track's duality recipe (two concepts ago) did not cover: an *equality*, not an inequality. The rule extends cleanly, and can be derived directly from what is already known: an equality `aᵀx = b` is equivalent to the pair `aᵀx ≤ b` and `aᵀx ≥ b` (a fact from this track's very first concept), which, converted to two `≤` constraints, contributes *two* nonnegative dual variables, say `p ≥ 0` and `q ≥ 0`. Everywhere these two variables appear in the dual, they appear only as the combination `p - q`, since one constraint entered with a `+` sign and the other with a `-` sign after the conversion. Because `p` and `q` each range independently over every nonnegative real number, their difference `p - q` ranges over **every real number**, positive, negative, or zero, entirely unrestricted. So: **an equality constraint's dual variable is free (unrestricted in sign)**, exactly the one adjustment needed to extend this track's duality recipe to the max-flow linear program's conservation equalities.

### Constructing the dual: potentials and edge costs

Applying the (now extended) recipe: one dual variable per primal constraint. Every edge's capacity constraint gets a dual variable `y(u,v) ≥ 0` (an ordinary inequality, ordinary nonnegative dual variable). Every intermediate vertex's conservation equality gets a **free** dual variable `z(v)` (a **potential**, by the rule just derived). Fixing `z(s) = 1` and `z(t) = 0` (a normalization needed since the source and sink have no conservation constraint of their own to contribute a dual variable, and without pinning these two down the whole dual would trivially minimize to `0` by setting every potential equal), the dual works out to:

```
minimize   sum of c(u,v) · y(u,v), over every edge
subject to y(u,v) ≥ z(u) - z(v), for every edge (u,v)
           y(u,v) ≥ 0
           z(s) = 1, z(t) = 0
```

### Interpreting the dual as a relaxed cut

This dual is a **fractional relaxation of the minimum cut problem**. Assign every vertex a potential `z(v) ∈ {0, 1}` (with `z(s)=1`, `z(t)=0` as required), interpreted as "which side of a cut this vertex is on" (`1` for the source's side `S`, `0` for the sink's side `T`). For an edge `(u,v)`, the constraint `y(u,v) ≥ z(u)-z(v)` forces `y(u,v) ≥ 1` exactly when `z(u)=1` and `z(v)=0`, that is, exactly when the edge crosses from `S` to `T`, and forces nothing beyond `y(u,v) ≥ 0` otherwise. Minimizing `sum c(u,v)·y(u,v)` then drives `y(u,v)` down to exactly `0` on every non-crossing edge and exactly `1` on every crossing edge, making the dual objective exactly `capacity(S,T)`, the crossing edges' total capacity, precisely this curriculum's own definition of a cut's capacity. (It is a known, citable structural fact, following from the total unimodularity of a flow network's constraint matrix, that this dual linear program always has an optimal solution with every `z(v)` and `y(u,v)` taking an integer, in fact `0`-or-`1`, value, so the true dual optimum is always achieved by some genuine cut, not merely approached by a fractional compromise between cuts.)

### The theorem, now as a corollary of strong duality

Strong duality (two concepts ago) says the max-flow linear program's optimal value exactly equals its dual's optimal value. The dual's optimal value, given the integrality fact just cited, is exactly the minimum-capacity cut's capacity. Therefore: **maximum flow value = minimum cut capacity**, the max-flow min-cut theorem, now derived as a direct consequence of linear programming's own strong duality theorem, a genuinely different proof route from Ford-Fulkerson's residual-graph argument this curriculum used to establish the identical result.

## Worked Examples

### Example 1: verifying the dual on the exact network this curriculum already solved

**Problem:** This curriculum's algorithms discipline solved the flow network `s→A:16, s→B:13, A→B:10, A→C:12, B→A:4, B→D:14, C→D:9, C→t:7, D→t:20`, finding a maximum flow of value `26` and a minimum cut `S={s,A,B}`, `T={C,D,t}` with crossing edges `A→C` (capacity `12`) and `B→D` (capacity `14`). Construct the corresponding dual solution and verify its objective value matches `26` exactly.

**Setting potentials from the cut:** `z(s)=z(A)=z(B)=1` (the `S` side), `z(C)=z(D)=z(t)=0` (the `T` side).

**Checking every edge's constraint `y(u,v) ≥ z(u)-z(v)`, setting `y` to the minimum allowed value:** `s→A`: `z(s)-z(A)=0`, `y=0`. `s→B`: `0`, `y=0`. `A→B`: `1-1=0`, `y=0`. `A→C`: `1-0=1`, `y=1`. `B→A`: `1-1=0`, `y=0`. `B→D`: `1-0=1`, `y=1`. `C→D`: `0-0=0`, `y=0`. `C→t`: `0`, `y=0`. `D→t`: `0`, `y=0`.

**Computing the dual objective:** `sum c(u,v)·y(u,v) = c(A,C)·1 + c(B,D)·1 = 12 + 14 = 26`, every other term contributing `0` since its `y` is `0`. This matches the maximum flow value `26` exactly, confirming strong duality concretely: the potentials derived directly from the already-known minimum cut give a dual-feasible solution whose objective exactly equals the primal optimum, exactly as the theorem this concept derives predicts.

### Example 2: a non-minimum cut gives a valid but looser (non-tight) bound

**Problem:** Using the same network, set potentials for the cut `S={s}` alone (every other vertex, including `A` and `B`, on the `T` side), and compute the resulting dual objective, comparing it to the true optimum of `26`.

**Setting potentials:** `z(s)=1`, every other vertex `z=0`.

**Checking constraints:** `s→A`: `1-0=1`, `y=1`. `s→B`: `1-0=1`, `y=1`. Every other edge has both endpoints on the same side (`T`), giving `z(u)-z(v)=0`, so `y=0` for all of them.

**Dual objective:** `c(s,A)·1 + c(s,B)·1 = 16+13=29`.

**Comparison:** `29` is a valid dual-feasible objective value (matching the cut `{s}` versus everything else, capacity `29`), and weak duality (two concepts ago) guarantees it is a genuine upper bound on the maximum flow (`26 ≤ 29` ✓), but it is not *tight*, this cut is not the minimum one, and its capacity strictly exceeds the true optimum. Only the minimum-capacity cut, `S={s,A,B}` in Example 1, achieves the exact equality strong duality guarantees exists.

## Common Misconceptions & Pitfalls

- **"Every valid cut gives a dual solution achieving strong duality's exact equality."** Example 2's cut `{s}` gives a perfectly valid dual-*feasible* solution (weak duality's inequality holds: `26≤29`), but only the *minimum* cut achieves the exact equality Example 1 verifies; strong duality guarantees an optimal dual solution matching the primal exactly, not that every feasible dual solution does.
- **"The free dual variable `z(v)` can be interpreted as a cut assignment even when it takes a fractional value between 0 and 1."** The clean cut interpretation (Core Theory) relies specifically on `z(v)` taking an integer, `0`-or-`1`, value; the cited integrality fact (from the constraint matrix's total unimodularity) is precisely what guarantees an optimal solution with this clean interpretation exists at all, a genuinely nontrivial structural fact about flow networks specifically, not a property every linear program's dual enjoys automatically.
- **"This proof of max-flow min-cut makes the Ford-Fulkerson-based proof from the algorithms discipline redundant or unnecessary."** The two proofs establish the identical theorem through entirely different machinery (residual graphs and reachability versus linear programming duality), and each illuminates a different aspect of why the theorem holds; having two independent, structurally unrelated proofs of the same deep result is a hallmark of a genuinely fundamental fact in combinatorial optimization, not a sign that one proof was unnecessary.
- **"Since the primal (max-flow) linear program has one variable per edge, the dual must also have one variable per edge."** The dual has one variable per *primal constraint*, not per primal variable (the correspondence established several concepts ago): the edges (primal variables) determine the dual's *constraints*, while the primal's *constraints*, capacity per edge and conservation per vertex, determine the dual's *variables*, `y(u,v)` per edge and `z(v)` per vertex respectively.

## Summary

The maximum flow problem is already a linear program: maximize total flow out of the source, subject to per-edge capacity inequalities and per-vertex conservation equalities. Extending this track's duality recipe to handle equality constraints (whose dual variables are free, unrestricted in sign, derived directly from splitting an equality into two opposing inequalities) produces a dual with one potential `z(v)` per vertex and one cost `y(u,v)` per edge, minimizing total weighted edge cost subject to `y(u,v) ≥ z(u)-z(v)`. This dual is exactly a fractional relaxation of the minimum cut problem, and a known integrality fact guarantees its optimum is always achieved by a genuine `0`/`1` cut assignment, so strong duality directly implies maximum flow value equals minimum cut capacity, verified concretely in Example 1 on the exact network this curriculum's algorithms discipline already solved (both sides equal to `26`), with Example 2 showing a non-minimum cut still gives a valid but looser bound (`29`), exactly the weak-duality-versus-strong-duality distinction this track has built throughout. This is the max-flow min-cut theorem's second, entirely independent proof, arrived at through linear programming's own strong duality theorem rather than Ford-Fulkerson's residual-graph argument, closing this track's arc from a single linear inequality all the way back to a landmark result in a completely different corner of this curriculum's algorithms discipline.

## Documentation Links

- [MIT 6.251 - Introduction to Mathematical Programming (OCW)](https://ocw.mit.edu/courses/6-251j-introduction-to-mathematical-programming-fall-2009/): doc
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
