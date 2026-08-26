---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

The P vs NP and reducibility concept ends on a practical punchline: most of the optimization problems that show up in scheduling, routing, and resource allocation are NP-hard, so there is almost certainly no polynomial-time algorithm that finds the *exact* optimum. Approximation algorithms are the disciplined response to that punchline — instead of giving up on efficiency or falling back to an unbounded heuristic, they trade optimality for a **provable, bounded ratio** between the returned solution's value and the true optimum's value, while still running in polynomial time. This concept covers the two flagship examples Cormen et al. use to introduce that idea in Chapter 35: `APPROX-VERTEX-COVER`, a clean 2-approximation for the NP-complete vertex-cover problem, and `APPROX-TSP-TOUR`, a 2-approximation for the traveling-salesperson problem that only works when the edge costs obey the triangle inequality — and the theorem explaining why that restriction is not optional.

## Use Cases

- Reaching for `APPROX-VERTEX-COVER` whenever you need *a* vertex cover with a provable quality guarantee in polynomial time, rather than searching for an exact optimal cover — which is NP-complete, as established by the sibling P vs NP and reducibility concept.
- Recognizing the general proof methodology — find a lower bound on the optimum using a cheaper relaxed structure (a maximal matching for vertex cover, a minimum spanning tree for TSP), then bound the algorithm's output against that lower bound — since the source explicitly notes "we will use this methodology in later sections as well."
- Checking whether your edge-cost function satisfies the triangle inequality (as ordinary Euclidean distance between points in the plane does) before reaching for `APPROX-TSP-TOUR`: the 2-approximation guarantee only holds under that assumption.
- Recognizing when to stop looking for *any* ratio-bounded polynomial-time approximation at all: for the general traveling-salesperson problem without the triangle inequality, Theorem 35.3 proves no such algorithm exists for any constant ratio unless P = NP.

## Deep Dive

### APPROX-VERTEX-COVER: pick an edge, cover both endpoints, repeat

```java
// Faithful translation of APPROX-VERTEX-COVER(G) (CLRS, Section 35.1).
// remaining models E' as adjacency sets so an edge and everything incident
// to its endpoints can be dropped in O(1) amortized per removed edge,
// giving the O(V + E) running time the source claims.
Set<Integer> approxVertexCover(Map<Integer, Set<Integer>> adjacency) {
    Map<Integer, Set<Integer>> remaining = deepCopy(adjacency); // line 2: E' = G.E
    Set<Integer> cover = new HashSet<>();                       // line 1: C = {}

    while (hasAnyEdge(remaining)) {                             // line 3
        int u = anyVertexWithEdge(remaining);                   // line 4
        int v = remaining.get(u).iterator().next();

        cover.add(u);                                           // line 5
        cover.add(v);

        removeAllIncidentEdges(remaining, u);                   // line 6
        removeAllIncidentEdges(remaining, v);
    }
    return cover;                                                // line 7
}
```

A vertex cover of an undirected graph `G = (V, E)` is a subset `V' ⊆ V` such that every edge `(u, v) ∈ E` has at least one endpoint in `V'`. The vertex-cover problem asks for a minimum-size such subset; that decision problem is NP-complete, and nobody knows a polynomial-time algorithm that finds an *optimal* cover. `APPROX-VERTEX-COVER` sidesteps that by returning a cover that is guaranteed to be **at most twice** the size of an optimal one, in `O(V + E)` time using adjacency lists.

The example graph below traces the algorithm on a 6-vertex path `a-b-c-d-e-f` (edges `a-b, b-c, c-d, d-e, e-f`). Because the engine's edges are fixed once drawn (they cannot be visually deleted), each step's caption narrates which edges line 6 removes from `E'` — the persistent `visit` marks track membership in `C`, and `traverse` highlights the edge picked at line 4:

```viz
type: graph
node a a 0 0
node b b 1 0
node c c 2 0
node d d 3 0
node e e 4 0
node f f 5 0
edge a b
edge b c
edge c d
edge d e
edge e f
---
traverse a b | Line 4: pick arbitrary edge (a, b) from E'.
visit a | Line 5: C = C ∪ {a}.
visit b | Line 5: C = C ∪ {b}. Line 6 now removes (a,b) and (b,c) from E' -- both are incident to a or b.
traverse c d | E' now holds only {(c,d), (d,e), (e,f)}. Line 4: pick edge (c, d).
visit c | Line 5: C = C ∪ {c}.
visit d | Line 5: C = C ∪ {d}. Line 6 removes (c,d) and (d,e) from E'.
traverse e f | Only (e,f) remains in E'. Line 4: pick it.
visit e | Line 5: C = C ∪ {e}.
visit f | Line 5: C = C ∪ {f}. Line 6 removes (e,f); E' is empty, so the while loop (line 3) ends.
```

`APPROX-VERTEX-COVER` returns `C = {a, b, c, d, e, f}` — all six vertices — while an optimal cover for this path is `{b, d, f}`, size 3. So here the algorithm returns exactly twice the optimum, which is the worst case Theorem 35.1 allows. The source's own Figure 35.1 runs the same algorithm on a different 7-vertex, 8-edge graph and reports the same shape of result: the algorithm picks edges `(b,c)`, `(e,f)`, and `(d,g)` in turn, returning `C = {b, c, d, e, f, g}` (size 6), against an optimal cover `{b, d, e}` (size 3) — again exactly a factor of 2.

### Why the ratio is exactly 2: the maximal matching lower bound

Theorem 35.1 states that `APPROX-VERTEX-COVER` is a polynomial-time 2-approximation algorithm. The proof does not need to know the size of an optimal cover `C*` — it only needs a *lower bound* on it, obtained cheaply:

- Let `A` be the set of edges picked by line 4 across all iterations. No two edges in `A` share an endpoint: once an edge is picked, line 6 deletes every other edge incident on its endpoints from `E'`, so `A` is a matching — in fact a *maximal* matching in `G` (Exercise 35.1-2).
- Any vertex cover — in particular an optimal one, `C*` — must include at least one endpoint of every edge in `A`, and since no two edges in `A` share an endpoint, no single vertex of `C*` can cover two of them. That gives the lower bound `|C*| ≥ |A|`.
- Each iteration of the loop adds exactly 2 new vertices to `C` (both endpoints of the picked edge, neither of which was already in `C`), so `|C| = 2|A|` exactly.
- Combining: `|C| = 2|A| ≤ 2|C*|`.

That last step is the whole proof: the algorithm's output is pinned to twice a *lower bound* on the optimum, and the lower bound comes for free from the fact that the picked edges never overlap. The source calls out this exact pattern — bound the algorithm against a cheap lower-bound structure rather than the (unknown) exact optimum — as a methodology reused throughout the rest of the chapter.

### APPROX-TSP-TOUR: build an MST, then walk it

```java
// Faithful translation of APPROX-TSP-TOUR(G, c) (CLRS, Section 35.2.1).
// Only valid when c satisfies the triangle inequality: c(u,w) <= c(u,v) + c(v,w).
List<Integer> approxTspTour(Graph g, CostFunction c, int root) {
    Tree mst = mstPrim(g, c, root);          // line 2: minimum spanning tree from root r

    List<Integer> tour = new ArrayList<>();
    preorderWalk(mst, root, tour::add);       // line 3: list each vertex when first visited

    return tour;                              // line 4: the hamiltonian cycle H
}
```

The input is a complete undirected graph `G = (V, E)` with a nonnegative integer cost `c(u, v)` on every edge, and the goal is the minimum-cost hamiltonian cycle (tour). `APPROX-TSP-TOUR` selects a root `r`, computes a minimum spanning tree `T` of `G` from `r` via `MST-PRIM`, then returns the tour given by a **preorder walk** of `T` (each vertex listed the first time it is encountered). With a simple `MST-PRIM` implementation the running time is `Θ(V²)`.

Theorem 35.2: when the cost function satisfies the triangle inequality, `APPROX-TSP-TOUR` is a polynomial-time 2-approximation. The proof reuses the same "cheap lower bound" methodology as vertex cover:

- Deleting any edge from an optimal tour `H*` yields a spanning tree, and costs are nonnegative, so the MST's weight lower-bounds the optimal tour: `c(T) ≤ c(H*)`.
- A **full walk** `W` of `T` (visiting a vertex again every time the walk returns to it after a subtree) traverses every tree edge exactly twice, so `c(W) = 2·c(T) ≤ 2·c(H*)`.
- `W` is not itself a tour (it revisits vertices), but the triangle inequality guarantees that deleting a repeated visit to a vertex — going directly from its predecessor to its successor in the walk — never increases cost. Removing every repeat visit from `W` leaves exactly the preorder-walk ordering, i.e. the tour `H` that the algorithm returns, so `c(H) ≤ c(W)`.
- Combining: `c(H) ≤ c(W) ≤ 2·c(H*)`.

The source's own worked example (Figure 35.2) grows an MST from a root `a` over 8 points on a grid, whose full walk is `a, b, c, b, h, b, a, d, e, f, e, g, e, d, a`; collapsing repeat visits gives the preorder tour `a, b, c, h, d, e, f, g`, with cost about 19.074, against an optimal tour of cost about 14.715 — well within the factor-of-2 bound.

### Why no approximation exists without the triangle inequality

Theorem 35.3: if `P ≠ NP`, then for **any** constant `ρ ≥ 1` there is no polynomial-time `ρ`-approximation algorithm for the general traveling-salesperson problem (no triangle-inequality assumption). The proof is a reduction from the NP-complete hamiltonian-cycle problem, and it is the general template the chapter uses for proving *no* good approximation exists:

- Given a graph `G = (V, E)` (a hamiltonian-cycle instance), build the complete graph `G' = (V, E')` with cost function `c(u, v) = 1` if `(u, v) ∈ E`, and `c(u, v) = ρ|V| + 1` otherwise.
- If `G` has a hamiltonian cycle, `(G', c)` has a tour of cost exactly `|V|`. If `G` has no hamiltonian cycle, every tour of `G'` must use at least one non-edge, costing at least `(ρ|V| + 1) + (|V| - 1) = ρ|V| + |V| > ρ|V|`.
- That gap — `|V|` versus more than `ρ|V|` — is bigger than the ratio `ρ` a hypothesized `ρ`-approximation algorithm `A` is allowed to miss by. So `A` run on `(G', c)` must return the cost-`|V|` tour whenever one exists, and can never return one when it doesn't — which means `A` decides hamiltonian-cycle in polynomial time, contradicting its NP-completeness unless `P = NP`.

Since the traveling-salesperson problem stays NP-complete even *with* the triangle inequality (Exercise 35.2-2), the practical reading is: check whether your cost function satisfies the triangle inequality before investing in a TSP approximation. If it does, `APPROX-TSP-TOUR` gives a genuine, provable factor of 2. If it doesn't, no constant-ratio polynomial-time approximation exists at all, unless P = NP.

## Trade-offs

- **Arbitrary edge choice, not greedy-by-degree** — `APPROX-VERTEX-COVER`'s power comes from picking *any* uncovered edge and taking both endpoints, which is what makes the matching argument work. The source's own Exercise 35.1-3 points out that the seemingly smarter heuristic of repeatedly removing the highest-degree vertex does **not** guarantee a ratio of 2 — the simple algorithm beats the intuitively-greedy one.
- **The vertex-cover bound is tight, not just an upper estimate** — the proof shows `|C| = 2|A|` exactly, not merely `≤`, so on inputs like the path example above (or the source's own Figure 35.1) the algorithm really does return double the optimum, not just "up to" double.
- **APPROX-TSP-TOUR's guarantee is conditional on the triangle inequality** — without it, Theorem 35.3 rules out *any* constant-ratio polynomial-time approximation unless P = NP, so the 2-approximation only ever applies to a restricted (if common, e.g. Euclidean-distance) class of instances.
- **A provable ratio is not the same as the best practical algorithm** — the source explicitly notes that despite its clean 2-approximation ratio, `APPROX-TSP-TOUR` "is usually not the best practical choice for this problem," and that other approximation algorithms typically perform much better in practice, without giving up the polynomial-time guarantee.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 35 "Approximation Algorithms", Sections 35.1-35.2, pp. 1106-1114](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
