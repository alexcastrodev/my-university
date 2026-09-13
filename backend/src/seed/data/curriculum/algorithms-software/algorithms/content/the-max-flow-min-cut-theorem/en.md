---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Define an s-t cut precisely: a partition of the vertices into two sets, one containing the source and the other the sink, and define its capacity as the total capacity of edges crossing from the source's side to the sink's side.
- Prove weak duality: the value of any valid flow is at most the capacity of any s-t cut, with no exceptions.
- State the max-flow min-cut theorem: the maximum flow value equals the minimum cut capacity, and explain why this is a genuine equality, not just weak duality's inequality.
- Prove that Ford-Fulkerson's termination condition (no augmenting path) is exactly equivalent to having found both a maximum flow and a minimum cut simultaneously.
- Use the theorem to certify that a given flow is maximum without needing to search for a better one.

## Context & Motivation

The previous concept ended on an observation that looked suspiciously like a coincidence: a flow of value 26 was found, and a cut with capacity exactly 26 was also found, at the exact moment the algorithm ran out of augmenting paths. This concept proves that it was never a coincidence at all. The relationship between flow value and cut capacity is one of the cleanest and most useful duality results in all of combinatorial optimization: the largest possible flow through a network is always *exactly* equal to the smallest possible capacity of any cut separating source from sink, not merely bounded by it. This is the max-flow min-cut theorem, and it does double duty: it explains precisely why Ford-Fulkerson's simple termination rule (stop when no augmenting path exists) is actually correct, and it hands over a practical certificate, a matching cut, that lets anyone verify a claimed maximum flow is genuinely maximum without having to trust the algorithm that produced it or search further themselves.

## Core Theory

### Defining an s-t cut and its capacity

An **s-t cut** is a partition of the vertex set `V` into two disjoint sets `S` and `T`, with `s ∈ S` and `t ∈ T`. The **capacity** of a cut is the sum of the capacities of every edge that crosses *from* `S` *to* `T` (edges from `T` back to `S` are not counted, only the direction from the source's side toward the sink's side):

```
capacity(S, T) = sum of c(u, v), over every edge (u, v) with u ∈ S and v ∈ T
```

Intuitively, a cut represents a way of splitting the network into "the source's side" and "the sink's side," and its capacity is the total carrying capacity of every link that goes the "correct" direction across that split, from the source's side toward the sink's.

### Weak duality: flow value never exceeds any cut's capacity

**Claim:** For any valid flow `f` and any s-t cut `(S, T)`, `|f| ≤ capacity(S, T)`.

**Why.** Every unit of flow leaving `s` must, by flow conservation at every intermediate vertex, eventually cross from `S` to `T` somewhere (it cannot get stuck inside `S` forever without violating conservation at some vertex, and it cannot reach `t`, which lives in `T`, without crossing at least once). More precisely, the flow's value equals the net flow crossing the cut: (flow on edges from `S` to `T`) minus (flow on edges from `T` back to `S`). The first quantity is at most `capacity(S, T)` (a flow can never exceed an edge's capacity), and the second quantity is at least 0 (flow values are never negative), so:

```
|f| = (flow S→T) - (flow T→S) ≤ (flow S→T) ≤ capacity(S, T)
```

This single inequality already has an immediate, useful consequence, stated as the next fact.

### The max-flow min-cut theorem

**Theorem.** In any flow network, the value of a maximum flow equals the capacity of a minimum s-t cut.

Weak duality alone only proves `max flow ≤ min cut` (every flow is bounded by every cut, so in particular the best flow is bounded by the best cut). The genuinely deep part of this theorem is the reverse direction, that this bound is always *achieved exactly*, with no gap, and the proof runs directly through Ford-Fulkerson's own termination condition.

**Proof sketch, via Ford-Fulkerson's stopping point.** Run Ford-Fulkerson until it terminates (no augmenting path from `s` to `t` remains in the residual graph `G_f`). Let `S` be the set of vertices reachable from `s` in `G_f` at that point, and let `T = V - S` be everything else. Since no augmenting path exists, `t` is not reachable from `s`, so `t ∈ T`, confirming `(S, T)` really is a valid s-t cut. Now examine every original edge `(u, v)` with `u ∈ S` and `v ∈ T`: it must be fully saturated, `f(u, v) = c(u, v)`, because if it weren't, its forward residual edge would have positive capacity, making `v` reachable from `s` (via `u`), contradicting `v ∈ T`. Symmetrically, every original edge `(v, u)` with `v ∈ T` and `u ∈ S` must carry exactly zero flow, `f(v, u) = 0`, because if it carried any positive flow, its backward residual edge `(u, v)` would have positive capacity, again making `v` reachable from `s`, the same contradiction. Combining both facts: the flow crossing from `S` to `T` equals `capacity(S, T)` exactly (every crossing edge is fully saturated), and the flow crossing back from `T` to `S` is exactly 0 (every such edge is empty), so `|f| = capacity(S, T) - 0 = capacity(S, T)`. The flow Ford-Fulkerson terminates with has a value that exactly equals the capacity of this specific cut. Since weak duality already showed no flow can exceed any cut's capacity, this flow, matching a cut exactly, must be maximum, and this cut, matched by a flow exactly, must be minimum.

### The three-way equivalence

The proof above establishes something stronger than just the theorem's headline equality; it shows three statements about a flow `f` are all exactly equivalent to one another:

1. `f` is a maximum flow.
2. `f`'s residual graph `G_f` has no augmenting path from `s` to `t`.
3. `|f| = capacity(S, T)` for some s-t cut `(S, T)` (namely, the one formed by `S = ` vertices reachable from `s` in `G_f`).

This equivalence is what makes Ford-Fulkerson's simple stopping rule ("halt when no augmenting path exists") correct, not merely a plausible-sounding heuristic: statement 2, the algorithm's actual termination condition, is provably identical to statement 1, the actual goal.

## Worked Examples

### Example 1: using the cut from the previous concept to certify a flow as maximum, without further search

**Problem:** The previous concept's Ford-Fulkerson run terminated with a flow of value 26 and identified the cut `S = {s, A, B}`, `T = {C, D, t}`. Use weak duality alone (not the full termination argument) to certify, independently, that 26 is truly the maximum possible flow.

**Certification.** `capacity(S, T)` = capacity of every edge from `S` to `T` = `c(A, C) + c(B, D) = 12 + 14 = 26` (no other edges cross from `S` to `T`: `A→B` and `B→A` stay within `S`, `C→D` stays within `T`, `C→t` and `D→t` stay within `T`). By weak duality, *any* valid flow in this network, found by any method whatsoever, must satisfy `|f| ≤ 26`. Since a flow of value 26 was actually exhibited, it must be maximum, full stop, with no need to try additional augmenting paths, additional algorithms, or additional reasoning of any kind. This is the practical payoff of the theorem: a cut of matching capacity is a checkable, independent certificate of optimality.

### Example 2: finding a minimum cut directly, without running Ford-Fulkerson at all

**Problem:** In a small network with `s→a: 5`, `s→b: 3`, `a→t: 2`, `a→b: 4`, `b→t: 6`, identify a cut with small capacity and use weak duality to bound the maximum flow before computing it.

**Candidate cut 1:** `S = {s}`, `T = {a, b, t}`. Crossing edges: `s→a` (5), `s→b` (3). Capacity `= 5 + 3 = 8`.

**Candidate cut 2:** `S = {s, a}`, `T = {b, t}`. Crossing edges: `a→t` (2), `a→b` (4); `s→b` also crosses (3). Capacity `= 2 + 4 + 3 = 9`.

**Candidate cut 3:** `S = {s, a, b}`, `T = {t}`. Crossing edges: `a→t` (2), `b→t` (6). Capacity `= 2 + 6 = 8`.

**Bounding the flow:** By weak duality, the maximum flow is at most the *smallest* of these (and any other) cut's capacity, so `|f| ≤ min(8, 9, 8) = 8`, without having computed a single unit of actual flow yet. Whether 8 is actually achievable (making one of the capacity-8 cuts the true minimum) would still need to be confirmed by exhibiting a flow of value 8, but the upper bound itself required only enumerating a few cuts, a useful sanity check on any flow computation before or after running an actual algorithm.

## Common Misconceptions & Pitfalls

- **"Weak duality and the max-flow min-cut theorem are the same statement."** Weak duality is only the inequality `|f| ≤ capacity(S,T)` for *every* flow and *every* cut, and it holds trivially and easily, as Core Theory's short proof shows. The full theorem is the much stronger claim that the *best* flow and the *best* cut are exactly equal, which requires the additional constructive argument (via Ford-Fulkerson's termination point) that Core Theory works through in full.
- **"Any cut can be used to certify a flow's optimality, not just a minimum one."** Weak duality only certifies optimality when the cut's capacity *equals* the flow's value exactly, as Example 1 shows; a cut with strictly larger capacity than the flow's value proves nothing about optimality on its own (it only confirms the flow doesn't exceed that particular cut, which is far weaker).
- **"Finding the minimum cut requires first finding the maximum flow, so the cut is just a side effect with no independent value."** Example 2 shows cuts can be evaluated and compared directly, independent of running any flow algorithm at all, providing an upper bound on the achievable flow before or without ever computing one; the tight connection Core Theory proves is what makes that upper bound meaningful, not incidental.
- **"The reachable-set cut from Ford-Fulkerson's termination is just one example of a minimum cut; there might be other, smaller ones the algorithm didn't find."** The proof in Core Theory shows this specific reachable-set cut's capacity exactly equals the terminating flow's value, and weak duality already shows no cut can have smaller capacity than any flow's value, so this cut is provably a minimum cut, not merely one candidate among possibly better ones.

## Summary

An s-t cut partitions the network's vertices into a source side `S` and a sink side `T`, with capacity equal to the total capacity of edges crossing from `S` to `T`. Weak duality shows any valid flow's value is bounded above by any cut's capacity, a short argument following directly from capacity constraints and flow conservation. The max-flow min-cut theorem strengthens this to a genuine equality: the maximum flow value exactly equals the minimum cut's capacity, proven constructively by examining Ford-Fulkerson's own termination point, where the set of vertices still reachable from the source in the residual graph defines a cut whose capacity exactly matches the terminating flow's value. This yields a three-way equivalence, maximum flow, no remaining augmenting path, and a matching cut, that both justifies Ford-Fulkerson's simple stopping rule and hands over a practical, independently checkable certificate of optimality, as both worked examples demonstrate. The next concept turns to a genuinely practical question the method itself leaves open: which augmenting path to choose at each step, and what that choice does to the algorithm's actual running time.

## Documentation Links

- [Ford, L. R., & Fulkerson, D. R. (1956). "Maximal Flow Through a Network." Canadian Journal of Mathematics.](https://www.cambridge.org/core/journals/canadian-journal-of-mathematics/article/maximal-flow-through-a-network/): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
