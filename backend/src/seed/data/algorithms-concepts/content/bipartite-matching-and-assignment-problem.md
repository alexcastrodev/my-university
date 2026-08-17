---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Understand how to find a **maximum matching** in an undirected bipartite graph `G = (V, E)` with `V = L ∪ R` *without* going through a flow network — the augmenting-path formulation Cormen, Leiserson, Rivest, and Stein give in Section 25.1, culminating in the **Hopcroft-Karp algorithm** at `O(√V · E)` — and then how to extend it to weighted edges: the **assignment problem**, where every edge `(l, r)` carries a weight `w(l, r)` and the goal is a *perfect* matching of maximum total weight, solved by the **Hungarian algorithm** in `O(n⁴)` (refinable to `O(n³)`).

Section 25.1 is titled "Maximum bipartite matching (**revisited**)" because CLRS already solved this problem once, in Section 24.3, by reduction to maximum flow — the subject of this collection's *Max-Flow Min-Cut: Augmenting Paths and Ford-Fulkerson* concept. The revisit drops the reduction entirely: no capacities, no source and sink, no residual graph. It works directly on the undirected bipartite graph using *M-augmenting paths* and set symmetric difference, and it is strictly faster than routing the problem through Ford-Fulkerson.

## Use Cases

- Any "pair up two disjoint groups, one partner each" problem where every allowed pairing is equally good and you just want as many pairs as possible — maximum bipartite matching in its plain form.
- The **assignment problem**: the same two groups, but now edge `(l, r)` has a weight `w(l, r)` representing "the utility gained by matching `l` with `r`", and the answer must be a perfect matching maximizing total utility. CLRS positions this as a sibling of the stable-marriage problem (this collection's *The Stable-Marriage Problem and the Gale-Shapley Algorithm* concept): same complete bipartite graph, but each vertex ranking the other side is replaced by numeric edge weights, so "good" means *maximum total value* rather than *stable*.
- Problems that don't literally look like assignment but reduce to it by reshaping the input graph: CLRS's Problem 25-3 asks for maximum-weight matching in a bipartite graph that is **not** complete, the same with zero or negative weights allowed, and **maximum-weight cycle cover** in an arbitrary directed graph (a set of edge-disjoint directed cycles covering each vertex at most once) — all by modifying the input, running the Hungarian algorithm, and then possibly modifying the output.
- Cost minimization rather than utility maximization, and unbalanced sides: Exercises 25.3-6 and 25.3-7 pose exactly these two adaptations (minimize the sum of matched edge weights; handle `|L| ≠ |R|`), so the algorithm is the base case for a family of assignment variants rather than a single rigid procedure.
- Structural existence questions about perfect matchings: Exercise 25.1-5 states **Hall's theorem** — a bipartite graph with `|L| = |R|` has a perfect matching if and only if `|A| ≤ |N(A)|` for every subset `A ⊆ L`, where `N(A)` is the set of vertices adjacent to some member of `A` — and Exercise 25.1-6 uses it to show every `d`-regular bipartite graph contains `d` disjoint perfect matchings.

## Deep Dive

### Matched, maximal, maximum — three words that are not synonyms

A vertex with an incident edge in matching `M` is **matched** under `M`; otherwise it is **unmatched**. A **maximal** matching is one to which no other edge can be added: for every edge `e ∈ E - M`, the set `M ∪ {e}` fails to be a matching. A **maximum** matching is one of largest cardinality.

> A maximum matching is always maximal, but the reverse does not always hold.

That asymmetry is the entire reason augmenting paths exist. A greedy pass produces a maximal matching cheaply, and a maximal matching can be strictly smaller than a maximum one — so the algorithms below need a way to *improve* an existing matching, not merely to keep adding edges to it.

### Alternating paths, augmenting paths, and symmetric difference

Given a matching `M` in an undirected graph `G = (V, E)`:

- An **M-alternating path** is a simple path whose edges alternate between being in `M` and being in `E - M`.
- An **M-augmenting path** (an "augmenting path with respect to `M`") is an M-alternating path whose *first and last* edges belong to `E - M`.

Since an M-augmenting path contains one more edge from `E - M` than from `M`, it must consist of an **odd** number of edges, and both of its endpoints are unmatched under `M`.

The improvement operation is set **symmetric difference**: `X ⊕ Y = (X - Y) ∪ (Y - X)`, the elements in `X` or `Y` but not both — equivalently `(X ∪ Y) - (X ∩ Y)`. The operator is commutative and associative, `X ⊕ X = ∅`, and `X ⊕ ∅ = ∅ ⊕ X = X`, so the empty set is its identity.

**Lemma 25.1.** Let `M` be a matching in any undirected graph `G = (V, E)` and `P` an M-augmenting path. Then `M' = M ⊕ P` is also a matching in `G`, with `|M'| = |M| + 1`.

*Proof sketch.* Let `P` have `q` edges `(v₁,v₂), (v₂,v₃), …, (v_q, v_{q+1})`, of which `⌈q/2⌉` are in `E - M` and `⌊q/2⌋` are in `M`. Because `P` is M-augmenting, `v₁` and `v_{q+1}` are unmatched and all other vertices on `P` are matched. The odd-numbered edges `(v₁,v₂), (v₃,v₄), …` are in `E - M` and the even-numbered ones `(v₂,v₃), (v₄,v₅), …` are in `M`; the symmetric difference simply **reverses those roles**. Every vertex of `P` is matched under `M'`, no vertex or edge outside `P` is touched, and `M'` gains exactly one edge.

**Corollary 25.2.** For **vertex-disjoint** M-augmenting paths `P₁, P₂, …, P_k`, the set `M' = M ⊕ (P₁ ∪ P₂ ∪ ⋯ ∪ P_k)` is a matching with `|M'| = |M| + k`. Vertex-disjointness makes the union equal to `P₁ ⊕ P₂ ⊕ ⋯ ⊕ P_k`, and associativity of `⊕` lets a simple induction apply Lemma 25.1 once per path.

In Java, "flip the path" is the whole of Lemma 25.1 — and it falls out of a recursion's unwinding, which is why the simple algorithm below is so short:

```java
// The simple O(VE) algorithm CLRS describes before introducing Hopcroft-Karp: start with M
// empty, then from each unmatched vertex in L run a search that takes alternating paths until
// it reaches another unmatched vertex, and use the resulting M-augmenting path to grow M by 1.
final class BipartiteMatching {
    private final List<List<Integer>> adjOfL;  // for each l in L, its neighbors in R
    private final int[] matchOfR;              // matchOfR[r] = the l matched to r, or -1
    private boolean[] seenR;

    BipartiteMatching(List<List<Integer>> adjOfL, int sizeOfR) {
        this.adjOfL = adjOfL;
        this.matchOfR = new int[sizeOfR];
        Arrays.fill(matchOfR, -1);
    }

    int maximumMatching() {
        int size = 0;
        for (int l = 0; l < adjOfL.size(); l++) {
            seenR = new boolean[matchOfR.length];
            if (augmentFrom(l)) size++;  // exactly one augmenting path => |M| grows by exactly 1
        }
        return size;                     // no augmenting path from any l => maximum (Corollary 25.4)
    }

    // True if an M-augmenting path starting at l exists. The reassignment of matchOfR happens
    // as the recursion unwinds, so every edge on the path swaps in or out of M at once: M (+) P.
    private boolean augmentFrom(int l) {
        for (int r : adjOfL.get(l)) {   // edge (l, r) in E - M -- the L -> R hop of the path
            if (seenR[r]) continue;
            seenR[r] = true;
            // r unmatched => the augmenting path ends here. Otherwise recurse through the
            // matched edge (r, matchOfR[r]) -- the R -> L hop, which must belong to M.
            if (matchOfR[r] == -1 || augmentFrom(matchOfR[r])) {
                matchOfR[r] = l;
                return true;
            }
        }
        return false;  // no alternating path from l reaches an unmatched vertex in R
    }
}
```

### When to stop: no augmenting path means maximum

**Lemma 25.3.** Let `M` and `M*` be matchings in `G = (V, E)` and consider `G' = (V, E')` with `E' = M ⊕ M*`. Then `G'` is a disjoint union of simple paths, simple cycles, and/or isolated vertices; the edges of each such path or cycle alternate between `M` and `M*`. If `|M*| > |M|`, then `G'` contains at least `|M*| - |M|` vertex-disjoint M-augmenting paths.

*Why.* Every vertex of `G'` has degree 0, 1, or 2, because at most one edge from `M` and at most one from `M*` can be incident on it — so every component is a singleton, an even-length alternating cycle, or an alternating simple path. Each cycle contributes equally many `M` and `M*` edges, so the `|M*| - |M|` surplus of `M*` edges must live in the paths; each surplus path starts and ends with `M*` edges, which makes it M-augmenting. Degree ≤ 2 forces those paths to be vertex-disjoint.

**Corollary 25.4** (due to Berge, and true in non-bipartite graphs too). **`M` is a maximum matching if and only if `G` contains no M-augmenting path.**

Forward direction (contrapositive): if an M-augmenting path `P` exists, `M ⊕ P` is bigger, so `M` was not maximum. Backward direction (contrapositive): if `M` is not maximum, take `M*` maximum in Lemma 25.3; since `|M*| > |M|`, at least one M-augmenting path exists.

This corollary is the stopping condition for everything that follows — it plays exactly the role that "no augmenting path remains in the residual graph" plays for Ford-Fulkerson, but it is proved here from symmetric differences of matchings rather than from the max-flow min-cut theorem.

Corollary 25.4 also hands you the simple algorithm directly, at `O(VE)`:

> Start with the matching `M` empty. Then repeatedly run a variant of either breadth-first search or depth-first search from an unmatched vertex that takes alternating paths until you find another unmatched vertex. Use the resulting M-augmenting path to increase the size of `M` by 1.

### Trace: the simple augmenting-path algorithm on a six-vertex bipartite graph

`L = {l1, l2, l3}`, `R = {r1, r2, r3}`, with edges `(l1,r1)`, `(l1,r2)`, `(l2,r1)`, `(l3,r2)`, `(l3,r3)`. Start from `M = ∅` and search from each unmatched vertex in `L` in turn.

```viz
type: graph
node l1 l1 0 0
node l2 l2 0 1
node l3 l3 0 2
node r1 r1 2 0
node r2 r2 2 1
node r3 r3 2 2
edge l1 r1
edge l1 r2
edge l2 r1
edge l3 r2
edge l3 r3
---
visit l1 | M is empty, so every vertex is unmatched. Search from the unmatched vertex "l1".
traverse l1 r1 | Edge (l1,r1) is in E - M, so it can be the first edge of an M-augmenting path.
visit r1 | "r1" is unmatched, so the single edge P = <(l1,r1)> is already M-augmenting (odd length, both ends unmatched). M (+) P = {(l1,r1)}: |M| = 1.
visit l2 | Next unmatched vertex in L: "l2". Its only neighbor is r1.
traverse l2 r1 | Edge (l2,r1) is in E - M -- the first hop of a new alternating path.
mark r1 | "r1" is matched (to l1), so the path cannot stop here. An alternating path must continue along r1's MATCHED edge.
traverse l1 r1 | The matched edge (r1,l1) in M -- the R to L hop. The path so far alternates: (l2,r1) not in M, then (r1,l1) in M.
visit l1 | Back in L at "l1". The next hop must again come from E - M.
traverse l1 r2 | Edge (l1,r2) is in E - M.
visit r2 | "r2" is unmatched: P = <(l2,r1),(r1,l1),(l1,r2)> is an M-augmenting path with 3 edges. M (+) P drops (l1,r1) and adds (l2,r1) and (l1,r2): |M| = 2.
visit l3 | Last unmatched vertex in L: "l3", with neighbors r2 (matched to l1) and r3.
mark r2 | Try (l3,r2) first. "r2" is matched to l1, so continue along the matched edge (r2,l1).
mark l1 | At "l1" the only other incident edge is (l1,r1), which is in E - M.
mark r1 | "r1" is matched to l2, so the alternating path must continue along (r1,l2).
mark l2 | "l2" has no other incident edge: this branch dead-ends without reaching an unmatched vertex in R. Back up to l3 and try its other edge.
traverse l3 r3 | Edge (l3,r3) is in E - M.
visit r3 | "r3" is unmatched: P = <(l3,r3)> is M-augmenting. M (+) P = {(l2,r1),(l1,r2),(l3,r3)} -- |M| = 3, a perfect matching.
mark l3 | Every vertex in L is now matched, so no search can even start: G contains no M-augmenting path, and by Corollary 25.4 this matching is maximum.
```

Two things the engine cannot express, so read them from the captions instead. First, **highlighted edges accumulate and never un-highlight**: edge `(l1,r1)` is walked in step 2 and joins `M`, but the augmenting path in steps 5-10 flips it back *out* of `M` — the final matching is `{(l2,r1), (l1,r2), (l3,r3)}`, not the four highlighted edges. Second, the failed branch out of `l3` (through `r2`, `l1`, `r1`, `l2`) is shown with `mark` rather than `traverse` precisely because it contributes nothing to the final matching.

Note what step 5-10 accomplishes: `l2`'s only neighbor `r1` was already taken, and a greedy algorithm would simply have left `l2` unmatched at size 2. The augmenting path *reassigns* `r1` from `l1` to `l2` and re-homes `l1` on `r2` in a single flip. That reassignment is the matching analogue of pushing flow along a residual backward edge in Ford-Fulkerson — same "change your mind about an earlier commitment" idea, expressed without any residual graph.

### The Hopcroft-Karp algorithm

Hopcroft-Karp improves the bound from `O(VE)` to `O(√V · E)` by augmenting along *many* vertex-disjoint paths per iteration rather than one:

```
HOPCROFT-KARP(G)
1  M = ∅
2  repeat
3      let P = {P₁, P₂, …, P_k} be a maximal set of vertex-disjoint
           shortest M-augmenting paths
4      M = M ⊕ (P₁ ∪ P₂ ∪ ⋯ ∪ P_k)
5  until P == ∅
6  return M
```

Correctness is immediate: line 4 is Corollary 25.2, and terminating when no M-augmenting path exists is Corollary 25.4. The work is in the running time — line 3 in `O(E)` time, and `O(√V)` iterations of the repeat loop.

**Line 3 in `O(E)` time, in three phases.**

1. **Direct the graph.** Build `G_M = (V, E_M)` from the undirected `G` by orienting each edge according to how an augmenting path would have to use it — an M-augmenting path starts at an unmatched vertex in `L`, takes an odd number of edges, and ends at an unmatched vertex in `R`, with `L → R` hops drawn from `E - M` and `R → L` hops drawn from `M`:

   ```
   E_M = { (l, r) : l ∈ L, r ∈ R, (l, r) ∈ E - M }   (edges from L to R)
       ∪ { (r, l) : r ∈ R, l ∈ L, (l, r) ∈ M }       (edges from R to L)
   ```

   This is a pure re-orientation: `|V_M| = |V|` and `|E_M| = |E|`.

2. **Layer it into a dag `H`.** Run breadth-first search on `G_M` starting from **all** unmatched vertices in `L` at once (in the standard `BFS` procedure, replace the single root `s` by that whole set). Each vertex's attribute `d` is its BFS distance from the nearest unmatched vertex in `L`; the layer a vertex sits in is that distance. Vertices from `L` land in even layers, vertices from `R` in odd layers. Let `q` be the smallest distance of any *unmatched* vertex in `R`; the last layer of `H` holds the `R`-vertices at distance `q`, and every vertex whose distance exceeds `q` is **excluded** from `H`. The edges kept are those between consecutive layers:

   ```
   E_H = { (l, r) ∈ E_M : r.d ≤ q and r.d = l.d + 1 } ∪ { (r, l) ∈ E_M : l.d ≤ q }
   ```

   BFS predecessor attributes `π` are not needed here, since `H` is a dag rather than a tree. Every path in `H` from layer 0 to an unmatched vertex in layer `q` corresponds to a shortest M-augmenting path in `G` (just read the directed edges as undirected), and every shortest M-augmenting path in `G` is present in `H`.

3. **Extract a maximal vertex-disjoint set, from the transpose.** Build `Hᵀ` (reverse every edge; `H` is acyclic, so `Hᵀ` is too). For each unmatched vertex `r` in layer `q`, run a depth-first search from `r` until it either reaches a vertex in layer 0 or exhausts all paths. The DFS needs no discovery/finish times — only predecessor attributes `π`; on reaching layer 0, tracing back along `π` yields an M-augmenting path. **Each vertex is searched from only when it is first discovered in any of these searches**, which is what makes the resulting set of paths vertex-disjoint. If a search from some `r` cannot reach an undiscovered layer-0 vertex through undiscovered vertices, no augmenting path through `r` joins the set.

Total: phase 1 is `O(E)`; phase 2 is `O(V_M + E_M) = O(E)` (assuming every vertex has at least one incident edge, so `|V| = O(E)`), and can stop as soon as the first distance in the BFS queue exceeds `q`; phase 3 is `O(V_H + E_H) = O(E)` by the standard DFS analysis, since no vertex is searched from twice. Line 4 is likewise `O(E)` — just adding and removing the path edges. So each repeat iteration costs `O(E)`.

**Maximal, not maximum, is deliberate.** In CLRS's own worked example, the three DFS searches produce only two vertex-disjoint shortest augmenting paths even though the graph contains three. That is fine: line 3 requires the set to be *maximal* (no further disjoint shortest augmenting path can be added), never *maximum*. Demanding a maximum set would be a harder problem and buys nothing.

**Why `O(√V)` iterations.**

- **Lemma 25.5** — if `q` is the length of a shortest M-augmenting path and `P` is a *maximal* set of vertex-disjoint M-augmenting paths of length `q`, then after `M' = M ⊕ (P₁ ∪ ⋯ ∪ P_k)`, any shortest `M'`-augmenting path has **more than `q`** edges. The proof splits on whether the new path `P` is vertex-disjoint from `P`: if it is, `P` is also an M-augmenting path, so maximality of `P` forces it to be longer than `q`. If it isn't, then with `A = M ⊕ M' ⊕ P`, associativity collapses `A` to `(P₁ ∪ ⋯ ∪ P_k) ⊕ P`; Lemma 25.3 gives `|A| ≥ (k+1)q`, while sharing at least one edge with some `P_i` gives `|A| < kq + |P|` — hence `q < |P|`.
- **Lemma 25.6** — if a shortest M-augmenting path has `q` edges, the maximum matching has size at most `|M| + |V|/(q+1)`. (Lemma 25.3 supplies at least `|M*| - |M|` vertex-disjoint augmenting paths, each with at least `q` edges, hence at least `q+1` vertices; disjointness gives `(|M*| - |M|)(q+1) ≤ |V|`.)
- **Lemma 25.7** — combining them: `q` strictly increases each iteration, so after `⌈√|V|⌉` iterations `q ≥ ⌈√|V|⌉`, and from that point Lemma 25.6 caps the remaining iterations at `⌈√|V|⌉/(⌈√|V|⌉+1) · |V| < √|V|`. Total under `2√|V|`.

**Theorem 25.8.** `HOPCROFT-KARP` runs in `O(√V · E)` time on an undirected bipartite graph.

### The assignment problem

Now add weights instead of ranks. Take a **complete** bipartite graph `G = (V, E)`, `V = L ∪ R`, with `|L| = |R| = n` (so `n²` edges), where each edge `(l, r)` has weight `w(l, r)` representing the utility of matching `l` with `r`. With `w(M) = Σ_{(l,r) ∈ M} w(l, r)`, the **assignment problem** is to find a perfect matching `M*` with

```
w(M*) = max { w(M) : M is a perfect matching }
```

Enumerating all `n!` perfect matchings works and is hopeless. The Hungarian algorithm does it in `O(n⁴)` (Problem 25-2 refines it to `O(n³)`).

### The equality subgraph, and why finding *any* perfect matching in it is enough

The Hungarian algorithm never works on `G` directly. It works on a subgraph called the **equality subgraph**, which changes over time and has the key property that any perfect matching inside it is already an optimal solution.

Give each vertex an attribute `h`, its **label**. `h` is a **feasible vertex labeling** of `G` if

```
l.h + r.h ≥ w(l, r)   for all l ∈ L and r ∈ R
```

One always exists — the **default vertex labeling**:

```
l.h = max { w(l, r) : r ∈ R }   for all l ∈ L      (25.1)
r.h = 0                          for all r ∈ R      (25.2)
```

Given a feasible labeling `h`, the **equality subgraph** `G_h = (V, E_h)` keeps all vertices and the edges whose labels are exactly tight:

```
E_h = { (l, r) ∈ E : l.h + r.h = w(l, r) }
```

**Theorem 25.14.** If the equality subgraph `G_h` of a feasible labeling `h` contains a perfect matching `M*`, then `M*` is an optimal solution to the assignment problem on `G`.

*Proof.* Because every edge of `M*` is tight, `w(M*) = Σ_{(l,r) ∈ M*} (l.h + r.h)`, and because `M*` is perfect this telescopes to `Σ_{l ∈ L} l.h + Σ_{r ∈ R} r.h`. For *any* perfect matching `M`, feasibility gives `w(M) ≤ Σ_{(l,r) ∈ M} (l.h + r.h)`, which telescopes to the same sum. Hence

```
w(M) ≤ Σ_{l ∈ L} l.h + Σ_{r ∈ R} r.h = w(M*)      (25.3)
```

so `M*` is a maximum-weight perfect matching. ∎

Two consequences drive the whole algorithm. First, **which** equality subgraph does not matter — you have free rein to pick one and to *change* which one you use as you go; you only need to find some perfect matching in some equality subgraph. Second, running the second half of the proof with `M` any matching (not necessarily perfect) keeps inequality (25.3) valid: **the weight of any matching is always at most the sum of the vertex labels.** If the labels are the "right" ones, that bound is tight, and a maximum-cardinality matching in the equality subgraph is a maximum-weight perfect matching. The Hungarian algorithm repeatedly modifies both the matching and the labels to reach that state.

### The Hungarian algorithm: four questions

The algorithm starts with any feasible labeling `h` and any matching `M` in `G_h`, then repeatedly finds an M-augmenting path `P` in `G_h` and sets `M = M ⊕ P` (Lemma 25.1, unchanged from Section 25.1) until `M` is perfect. Four questions arise, and the answers are the algorithm:

1. **Which initial labeling?** The default labeling of equations (25.1) and (25.2).
2. **Which initial matching?** Any matching in `G_h`, even the empty one — but a greedy maximal matching works well:

   ```
   GREEDY-BIPARTITE-MATCHING(G)
   1  M = ∅
   2  for each vertex l ∈ L
   3      if l has an unmatched neighbor in R
   4          choose any such unmatched neighbor r ∈ R
   5          M = M ∪ {(l, r)}
   6  return M
   ```

   Exercise 25.3-2 asks you to show this returns a matching at least half the size of a maximum matching.
3. **How to find an M-augmenting path in `G_h`?** Exactly as in Hopcroft-Karp's second phase: build the **directed equality subgraph** `G_{M,h} = (V, E_{M,h})` with `E_{M,h} = { (l,r) : (l,r) ∈ E_h - M }` from `L` to `R`, plus `{ (r,l) : (l,r) ∈ M }` from `R` to `L`, then breadth-first search from all unmatched vertices in `L` at once — stopping the moment it discovers an unmatched vertex in `R`. Any exhaustive graph search would do; BFS is the one CLRS uses. Unlike Hopcroft-Karp's dag `H`, each vertex here needs only *one* predecessor, so the search builds a breadth-first **forest** `F = (V_F, E_F)` whose roots are the unmatched vertices in `L`.
4. **What if the search fails?** Update the labeling to bring at least one new edge into the equality subgraph — the subject of the next subsection.

Note where the failure can happen: whenever the queue empties without finding an augmenting path, **the most recently discovered vertices must belong to `L`**. Why? Discovering an *unmatched* vertex in `R` ends the search successfully, and discovering a *matched* vertex in `R` always leaves an unvisited neighbor in `L` to discover next.

### Relabeling when the search fails

You are free to work with any equality subgraph, so change it "on the fly" — but without undoing work already done. The Hungarian algorithm's relabeling meets three criteria:

1. No edge in the breadth-first forest `F` leaves the directed equality subgraph.
2. No edge in the matching `M` leaves the directed equality subgraph.
3. At least one edge `(l, r)` with `l ∈ L ∩ V_F` and `r ∈ R - V_F` **enters** `E_h`, hence `E_{M,h}` — so at least one vertex in `R` becomes newly discoverable.

Write `F_L = L ∩ V_F` and `F_R = R ∩ V_F`. Compute

```
δ = min { l.h + r.h - w(l, r) : l ∈ F_L and r ∈ R - F_R }        (25.4)
```

— the smallest amount by which an edge leaving `F_L` *missed* being in the current equality subgraph — then relabel:

```
         ⎧ v.h - δ   if v ∈ F_L
v.h' =   ⎨ v.h + δ   if v ∈ F_R                                   (25.5)
         ⎩ v.h       otherwise (v ∈ V - V_F)
```

**Lemma 25.15** proves `h'` is still feasible and satisfies all three criteria.

- *Feasibility.* The only pairs whose label sum decreases are `l ∈ F_L`, `r ∈ R - F_R`, and they drop by exactly `δ`; by (25.4), `l.h - δ + r.h ≥ w(l, r)` for every such pair. All other pairs keep `l.h' + r.h' ≥ l.h + r.h ≥ w(l, r)`.
- *Criterion 1.* For `l ∈ F_L` and `r ∈ F_R`, `δ` is subtracted from one label and added to the other, so `l.h' + r.h' = l.h + r.h` — forest edges stay tight.
- *Criterion 2.* For every matched edge `(l, r) ∈ M`, `l ∈ F_L` **if and only if** `r ∈ F_R` at relabeling time. (If `r ∈ F_R`, dequeuing `r` discovers `l`. If `r ∉ F_R`, then the only edge of `G_{M,h}` entering `l` is `(r, l)`, untaken — and `l` cannot be a root either, since only *unmatched* vertices in `L` are roots.) Both-in and both-out each leave `l.h' + r.h'` unchanged, so matched edges stay tight.
- *Criterion 3.* Take an edge `(l, r) ∉ E_h` achieving the minimum in (25.4). Then `l.h' + r.h' = l.h - δ + r.h = l.h - (l.h + r.h - w(l,r)) + r.h = w(l, r)`, so `(l, r) ∈ E_{h'}`; being outside `E_h` it is not in `M`, so in `E_{M,h'}` it is directed `L → R`.

Some edges may *leave* `E_{M,h}` under `h'` — but by Lemma 25.15 any such edge belonged to neither `M` nor `F` at the time (Exercise 25.3-3 pins them down as `l ∈ L - F_L`, `r ∈ F_R`), so nothing already accomplished is lost. Newly discovered `R` vertices are enqueued, though their distances are not necessarily one more than the most recently discovered `L` vertices — which is precisely why this search keeps a forest with single predecessors and drops the `d` attribute rather than reusing Hopcroft-Karp's layered dag.

```
HUNGARIAN(G)
 1  for each vertex l ∈ L
 2      l.h = max { w(l, r) : r ∈ R }   // from equation (25.1)
 3  for each vertex r ∈ R
 4      r.h = 0                          // from equation (25.2)
 5  let M be any matching in G_h (such as the matching returned by
        GREEDY-BIPARTITE-MATCHING)
 6  from G, M, and h, form the equality subgraph G_h
        and the directed equality subgraph G_{M,h}
 7  while M is not a perfect matching in G_h
 8      P = FIND-AUGMENTING-PATH(G_{M,h})
 9      M = M ⊕ P
10      update the equality subgraph G_h
            and the directed equality subgraph G_{M,h}
11  return M
```

```
FIND-AUGMENTING-PATH(G_{M,h})
 1  Q = ∅
 2  F_L = ∅
 3  F_R = ∅
 4  for each unmatched vertex l ∈ L
 5      l.π = NIL
 6      ENQUEUE(Q, l)
 7      F_L = F_L ∪ {l}      // forest F starts with unmatched vertices in L
 8  repeat
 9      if Q is empty        // ran out of vertices to search from?
10          δ = min { l.h + r.h - w(l, r) : l ∈ F_L and r ∈ R - F_R }
11          for each vertex l ∈ F_L
12              l.h = l.h - δ         // relabel according to equation (25.5)
13          for each vertex r ∈ F_R
14              r.h = r.h + δ         // relabel according to equation (25.5)
15          from G, M, and h, form a new directed equality graph G_{M,h}
16          for each new edge (l, r) in G_{M,h}   // continue search with new edges
17              if r ∉ F_R
18                  r.π = l                       // discover r, add it to F
19                  if r is unmatched
20                      an M-augmenting path has been found (exit the repeat loop)
21                  else ENQUEUE(Q, r)            // can search from r later
22                       F_R = F_R ∪ {r}
23      u = DEQUEUE(Q)                            // search from u
24      for each neighbor v of u in G_{M,h}
25          if v ∈ L
26              v.π = u
27              F_L = F_L ∪ {v}                   // discover v, add it to F
28              ENQUEUE(Q, v)                     // can search from v later
29          elseif v ∉ F_R                        // v ∈ R, do same as lines 18-22
30              v.π = u
31              if v is unmatched
32                  an M-augmenting path has been found (exit the repeat loop)
33              else ENQUEUE(Q, v)
34                   F_R = F_R ∪ {v}
35  until an M-augmenting path has been found
36  using the predecessor attributes π, construct an M-augmenting path P
        by tracing back from the unmatched vertex in R
37  return P
```

Criterion 3 of Lemma 25.15 is what guarantees the queue `Q` is nonempty by line 23 — every relabeling brings in at least one new edge and therefore discovers at least one new vertex in `R`, so the loop cannot spin.

### Worked trace of the Hungarian algorithm

The weights, with `L = {l1, …, l7}`, `R = {r1, …, r7}`, and the default vertex labeling `l.h = max_r w(l, r)`, `r.h = 0`. **Bold** entries are the tight ones (`l.h + r.h = w`) — the edges of the initial equality subgraph `G_h`:

| `l.h` | | `r1` | `r2` | `r3` | `r4` | `r5` | `r6` | `r7` |
|---|---|---|---|---|---|---|---|---|
| | `r.h` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 10 | `l1` | 4 | **10** | **10** | **10** | 2 | 9 | 3 |
| 12 | `l2` | 6 | 8 | 5 | **12** | 9 | 7 | 2 |
| 15 | `l3` | 11 | 9 | 6 | 7 | 9 | 5 | **15** |
| 9 | `l4` | 3 | **9** | 6 | 7 | 5 | 6 | 3 |
| 6 | `l5` | 2 | **6** | 5 | 3 | 2 | 4 | 2 |
| 11 | `l6` | 10 | 8 | **11** | 4 | **11** | 2 | **11** |
| 8 | `l7` | 3 | 4 | 5 | 4 | 3 | 6 | **8** |

`GREEDY-BIPARTITE-MATCHING` on this `G_h` gives `M = {(l1,r2), (l2,r4), (l3,r7), (l6,r3)}` — size 4, maximal but far from perfect. Unmatched: `l4, l5, l7` in `L`; `r1, r5, r6` in `R`. The run then proceeds:

| Step | BFS roots (unmatched in `L`) | What the search does | Outcome |
|---|---|---|---|
| 1 | `l4, l5, l7` | Discovers `r2, r7`; then `l1, l3` via matched edges; then `r3, r4`; then `l6, l2`; then the **unmatched** `r5` | Augmenting path `⟨(l4,r2),(r2,l1),(l1,r3),(r3,l6),(l6,r5)⟩`. `M ⊕ P` gives `{(l4,r2),(l1,r3),(l6,r5),(l2,r4),(l3,r7)}`, size 5 |
| 2 | `l5, l7` | Discovers `r2, r7`, then `l4, l3` — both of which have no outgoing equality edges. **Queue empties** | `F_L = {l5,l7,l4,l3}`, `F_R = {r2,r7}`. `δ = 1`, achieved by `(l5,r3)`: `l5.h + r3.h - w(l5,r3) = 6 + 0 - 5 = 1` |
| 3 | (relabel) | Subtract 1 from `l3, l4, l5, l7`; add 1 to `r2, r7` | `(l1,r2)` and `(l6,r7)` **leave** `G_{M,h}`; `(l5,r3)` **enters**. Labels now `l = 10,12,14,8,5,11,7`, `r = 0,1,0,0,0,0,1` |
| 4 | (search resumes) | `(l5,r3)` joins `F`, `r3` enqueued; search continues through `l1`, then `r4`, then `l2`, which has no outgoing edge. **Queue empties again** | `δ = 1` again, this time achieved by **three** edges: `(l1,r6)`, `(l5,r6)`, `(l7,r6)` |
| 5 | (relabel) | Subtract 1 from `l1, l2, l3, l4, l5, l7`; add 1 to `r2, r3, r4, r7` | `(l6,r3)` leaves; `(l1,r6)`, `(l5,r6)`, `(l7,r6)` enter. Labels now `l = 9,11,13,7,4,11,6`, `r = 0,2,1,1,0,0,2` |
| 6 | (search resumes) | `(l1,r6)` joins `F`; `r6` is **unmatched**, so the search terminates | Augmenting path `⟨(l5,r3),(r3,l1),(l1,r6)⟩`. `M` becomes `{(l4,r2),(l5,r3),(l1,r6),(l2,r4),(l6,r5),(l3,r7)}`, size 6 |
| 7 | `l7` | Search runs until the queue empties after removing `l4` | `δ = 2`, achieved by five edges: `(l2,r5)`, `(l3,r1)`, `(l4,r5)`, `(l5,r1)`, `(l5,r5)` |
| 8 | (relabel) | Subtract 2 from `l1, l2, l3, l4, l5, l7`; add 2 to `r2, r3, r4, r6, r7`. All five edges above enter `G_{M,h}` | Final labels `l = 7,9,11,5,2,11,4`, `r = 0,4,3,3,0,2,4` |
| 9 | (search resumes) | `(l3,r1)` joins `F`; `r1` is **unmatched**, terminating the search | Augmenting path `⟨(l7,r7),(r7,l3),(l3,r1)⟩`. `M` becomes perfect — done |

The final perfect matching is `(l1,r6), (l2,r4), (l3,r1), (l4,r2), (l5,r3), (l6,r5), (l7,r7)`, of weight `9 + 12 + 11 + 9 + 5 + 11 + 8 = 65`, and by Theorem 25.14 it is optimal. Note the check that falls out of the labels: the final labels sum to `(7+9+11+5+2+11+4) + (0+4+3+3+0+2+4) = 49 + 16 = 65` — exactly the matching's weight, as inequality (25.3) demands at optimality.

That equality is not a coincidence. Maximizing the weight of a matching and minimizing the sum of the feasible vertex labels are **duals** of each other, in the same vein as the value of a maximum flow equaling the capacity of a minimum cut. (CLRS explores duality properly in Section 29.3; the Hungarian algorithm is an early example of a primal-dual algorithm.) One small side note from the last step: had `r1` been *matched*, the search would have gone on to add `r5` to the forest, with any of `l2`, `l4`, or `l5` as its parent.

### Running time: `O(n⁴)`, and how to get to `O(n³)`

With `|V| = 2n` and `|E| = n²` in the original complete graph `G`:

- Lines 1-6 and 11 of `HUNGARIAN` take `O(n²)`.
- The while loop of lines 7-10 iterates at most `n` times, since each iteration grows `M` by exactly 1. Line 7 is `O(1)` by testing `|M| < n`, line 9 is `O(n)`, line 10 is `O(n²)`.
- Each call of `FIND-AUGMENTING-PATH` is `O(n³)`. Ignoring the *growth steps* (each execution of lines 10-22), the procedure is a breadth-first search costing `O(V + E) = O(n²)` with `F_L` and `F_R` represented appropriately. At most `n` growth steps can occur per call, since each is guaranteed to discover at least one vertex in `R`, and with at most `n²` edges in `G_{M,h}`, the for loop of lines 16-22 iterates at most `n²` times per call. The bottleneck is lines 10 and 15, each `O(n²)`.

Total: `O(n⁴)`. The two paths to `O(n³)`:

- **Line 15 is unnecessary.** Exercise 25.3-5 asks you to show that `G_{M,h}` need never be explicitly constructed — membership of an edge in `E_{M,h}` can be determined directly — eliminating line 6 of `HUNGARIAN` and line 15 here.
- **Line 10 drops to `O(n)`.** Problem 25-2 introduces, for each `r ∈ R - F_R`, an attribute `r.σ = min { l.h + r.h - w(l, r) : l ∈ F_L }` — how close `r` is to being adjacent to some vertex in `F_L` — initialized to `∞` for all `r ∈ R` before any vertex enters `F_L`. With `σ` maintained, `δ` is computable in `O(n)`, the `σ` values update in `O(n)` after `δ` is known, and updating them all as `F_L` grows costs `O(n²)` per call.

With both changes each `FIND-AUGMENTING-PATH` call is `O(n²)` and the Hungarian algorithm runs in `O(n³)`.

## Trade-offs

- **Reducing to max-flow works but is slower than solving matching natively.** Section 24.3's max-flow reduction (this collection's *Max-Flow Min-Cut* concept) is the pedagogically natural first answer; Section 25.1 exists to give "a more efficient method." Working directly with M-augmenting paths in the undirected graph skips building a flow network, and Hopcroft-Karp's `O(√V · E)` beats what the reduction buys you. The two share the *idea* of augmenting paths, and Exercise 25.1-2 explicitly asks how M-augmenting paths and flow-network augmenting paths are alike and how they differ — but the machinery (residual capacities, source/sink, cancellation) does not carry over.
- **Maximal is cheap, maximum is the goal, and the gap is real.** `GREEDY-BIPARTITE-MATCHING` gives a maximal matching in one pass but is only guaranteed to be at least half the size of a maximum matching (Exercise 25.3-2). Every algorithm here therefore pays for augmenting paths on top of a greedy start — you cannot greedily grow your way to maximum.
- **Hopcroft-Karp asks for a *maximal* set of shortest augmenting paths, deliberately not a maximum one.** CLRS's own example finds 2 disjoint shortest paths where 3 exist, and the `O(√V · E)` bound still holds. Requiring maximum sets would be strictly harder work for no asymptotic gain — a good instance of specifying the weakest property the proof actually needs.
- **`O(√V · E)` is not the last word for sparse graphs.** CLRS notes Madry's `Õ(E^(10/7))`-time algorithm, which is asymptotically faster than Hopcroft-Karp when the graph is sparse. Hopcroft-Karp is the practical, provable default here, not a lower bound.
- **Bipartiteness is what keeps augmenting-path search simple.** Corollary 25.4 (Berge) holds in *non*-bipartite graphs too, but finding the augmenting paths is much more involved there; CLRS points to Edmonds's `O(V⁴)` algorithm as the first polynomial-time general-graph matching algorithm. Reach for these procedures only after confirming your graph really is bipartite.
- **The Hungarian algorithm buys optimality by giving up on a fixed graph.** Its central trick is that the equality subgraph is *not* an input — it is re-chosen whenever the search stalls. That freedom is what makes Theorem 25.14's "any perfect matching in any equality subgraph is optimal" usable, but it also means the algorithm interleaves a graph search with label arithmetic, and correctness rests on Lemma 25.15's three criteria (forest edges and matched edges must survive relabeling). A naive relabeling that breaks either criterion loses previously done work.
- **`O(n⁴)` in the straightforward implementation is mostly avoidable bookkeeping.** The two `O(n²)` bottlenecks per growth step — rebuilding `G_{M,h}` and recomputing `δ` from scratch — are exactly what Exercise 25.3-5 and Problem 25-2 remove, for `O(n³)`. If you implement the pseudocode literally you get the slower bound; the faster one is the same algorithm with `σ` attributes and no explicit `G_{M,h}`.
- **The stated problem is narrower than most real instances, but adaptable.** `HUNGARIAN` assumes a *complete* bipartite graph with `|L| = |R|` and maximization. Exercise 25.3-6 (minimize instead), Exercise 25.3-7 (`|L| ≠ |R|`), and Problem 25-3 (incomplete graphs; zero or negative weights; cycle cover) all handle the gaps by transforming the input and the output rather than by changing the algorithm — so treat those transformations, not a rewrite, as the extension path.
- **Same graph, different definition of "good."** The assignment problem and the stable-marriage problem (this collection's *The Stable-Marriage Problem and the Gale-Shapley Algorithm* concept) both run on a complete bipartite graph with extra per-pair information, but a maximum-weight matching and a stable matching optimize unrelated objectives — total value versus absence of blocking pairs. Neither algorithm's guarantee says anything about the other's criterion; pick the objective before picking the algorithm.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 25.1 "Maximum bipartite matching (revisited)" and Section 25.3 "The Hungarian algorithm for the assignment problem", pp. 705-716, 723-739](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
