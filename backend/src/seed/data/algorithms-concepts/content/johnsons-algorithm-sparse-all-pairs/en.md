---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn Johnson's algorithm, the third and final all-pairs shortest-paths algorithm in this module. It solves exactly the same problem the sibling Floyd-Warshall concept solves — shortest paths between *every* pair of vertices in a weighted, directed graph — but reaches it by a completely different route: instead of a new dynamic-programming recurrence, Johnson's algorithm composes the sibling Bellman-Ford and Dijkstra concepts' own algorithms as literal subroutines, with one numeric transformation, called reweighting, stitched in between them. Reweighting replaces every edge weight with a new, provably nonnegative weight, computed once from a single auxiliary Bellman-Ford run, chosen so that shortest paths under the new weights are exactly the shortest paths under the old ones — only their numeric length shifts, by a constant that depends solely on the two endpoints. That guarantee is what makes it legal to run Dijkstra, which the sibling Dijkstra concept shows strictly requires non-negative weights, once from every vertex, even though the original graph may have had negative edges. For sparse graphs the result beats Floyd-Warshall's flat O(V³); exactly when it stops paying off is this concept's other main thread.

## Use Cases

- All-pairs shortest-path precomputation on genuinely sparse networks — road maps constrained to real adjacency, service-mesh topologies, sparse flight-route graphs — where V is large enough that Floyd-Warshall's O(V³) matrix pass is wasteful, since Johnson's cost scales with the actual edge count E instead of the full V² pair space.
- An all-pairs version of the arbitrage-detection use case the sibling Bellman-Ford concept introduces for a single source: converting every currency-pair exchange rate to `-ln(rate)` can produce negative edges, and Johnson's algorithm gives the shortest (most-profitable) conversion path between *every* pair of currencies at once, with the Bellman-Ford pass doing double duty as a free negative-cycle (arbitrage-opportunity) detector across the whole market graph, not just from one starting currency.
- Sparse weighted graphs where edge weights can legitimately be negative (discount edges, rebate edges, slack values) but the graph is known to have no negative cycle, and an application needs a full distance table rather than repeated single-source queries — the same "precompute once, query O(1) forever" motivation the sibling Floyd-Warshall concept's Use Cases give, just for the sparse regime where that algorithm's flat O(V³) stops being competitive.
- As the canonical worked example of reweighting with vertex potentials: shifting every edge weight by `h(u) - h(v)` to force non-negativity while preserving shortest-path structure is the same trick that reappears, under the name "potentials," in some min-cost-flow implementations — Johnson's algorithm is where it is first learned in its cleanest form.

## Deep Dive

### The problem, and when Johnson's O(V² lg V + VE) actually wins

The problem is identical to the sibling Floyd-Warshall concept's: given a weighted, directed graph, find `δ(u, v)` for every pair of vertices `u, v`, tolerating negative edges as long as there is no negative-weight cycle. Floyd-Warshall solves it with a flat `Θ(V³)` triple loop that never looks at `E`. Johnson's algorithm takes a different approach entirely: reweight every edge to be nonnegative (below), then run Dijkstra once from every vertex on the reweighted graph. With a Fibonacci-heap-backed priority queue, a single Dijkstra run costs `O(E + V lg V)`; running it `V` times costs `O(VE + V² lg V)`. Adding the `O(VE)` cost of the one auxiliary Bellman-Ford run that reweighting requires doesn't change the order — `VE` is already present — so the whole algorithm runs in:

```
O(V² lg V + VE)
```

Setting this against Floyd-Warshall's `O(V³)` shows precisely where each one wins, the same crossover analysis the sibling Floyd-Warshall concept runs for repeated Bellman-Ford:

- **Sparse graphs** (`E` close to `V`, e.g. `E = O(V)`): `V² lg V + VE = V² lg V + V² = O(V² lg V)`. Since `lg V` is asymptotically smaller than `V`, `V² lg V` is `o(V³)` — strictly smaller than Floyd-Warshall's bound for large `V`. Johnson's algorithm wins outright here, and the gap widens as `V` grows.
- **Dense graphs** (`E` close to `V²`, i.e. `E = Θ(V²)`): `V² lg V + VE = V² lg V + V³ = O(V³)` — `V³` now dominates the `V² lg V` term, so Johnson's bound collapses to the *same* order as Floyd-Warshall. The advantage is gone, not reversed; at that point Floyd-Warshall's three clean nested loops with O(1) work per iteration typically win on constant factors, exactly the reasoning the sibling Floyd-Warshall concept gives for why it beats V-times-Bellman-Ford once graphs approach dense.

That headline bound assumes a Fibonacci heap, which this module's own Dijkstra concept doesn't implement — it uses a binary-heap-backed indexed priority queue instead, with its own `O((V + E) lg V)` per-run bound. Swapping that implementation in changes the total to `O(VE lg V)` (CLRS states this bound directly for the binary-heap case), which is still asymptotically faster than Floyd-Warshall on sparse graphs (`E = O(V)` gives `O(V² lg V)`, same conclusion as above) but *loses outright*, not just ties, on dense graphs: `E = Θ(V²)` gives `O(V³ lg V)`, strictly worse than Floyd-Warshall's `O(V³)` by the extra `lg V` factor. The practical, binary-heap version of Johnson's algorithm is therefore a genuinely sparse-graph-only tool; only the theoretical Fibonacci-heap version merely ties Floyd-Warshall once the graph is dense.

### Why you can't run Dijkstra directly, and the reweighting technique

The sibling Dijkstra concept's own minimal counterexample — `S -> A (3)`, `S -> B (2)`, `A -> B (-2)` — is exactly the failure Johnson's algorithm has to eliminate before Dijkstra can run at all. Dijkstra finalizes `B` at `2` before ever discovering the path `S -> A -> B` costs only `1`, because a negative edge let a later relaxation beat an already-finalized distance. Running Dijkstra `V` times directly on a graph that might contain such an edge would just reproduce that wrong answer `V` times over — negative edges have to be dealt with *before* Dijkstra ever runs, not worked around by running it more often.

Reweighting deals with them by building an auxiliary graph `G' = (V', E')`, adding one new vertex `s` connected to every original vertex by a zero-weight edge, then running Bellman-Ford once from `s`:

```java
// G' = G plus a new source s with a zero-weight edge to every vertex.
// Returns h[v] = delta(s, v) for every v, or null if G has a negative-weight cycle.
double[] computeReweighting(int V, List<Edge> edges) {
    double[] h = new double[V + 1];           // h[V] represents the added source s
    Arrays.fill(h, Double.POSITIVE_INFINITY);
    h[V] = 0.0;                               // distTo[s] = 0

    List<Edge> augmented = new ArrayList<>(edges);
    for (int v = 0; v < V; v++) {
        augmented.add(new Edge(V, v, 0.0));   // s -> v, weight 0, for every v
    }

    for (int pass = 0; pass < V; pass++) {    // |V'| - 1 = (V + 1) - 1 = V rounds
        for (Edge e : augmented) {
            if (h[e.to()] > h[e.from()] + e.weight()) {
                h[e.to()] = h[e.from()] + e.weight();
            }
        }
    }
    for (Edge e : augmented) {                // bonus round -- sibling Bellman-Ford concept's own
        if (h[e.to()] > h[e.from()] + e.weight()) {
            return null;                      // negative-weight cycle: Johnson's algorithm reports failure
        }
    }
    return h;                                  // h[v] = delta(s, v) for v in 0..V-1
}
```

This one Bellman-Ford run does double duty. First, it computes `h(v) = δ(s, v)`, the shortest-path distance from the added source to every vertex — the quantity reweighting needs. Second, its bonus final pass is exactly the sibling Bellman-Ford concept's own negative-cycle-detection mechanism: since no edge enters `s`, `G'` has a negative cycle if and only if `G` does, so this single check covers the whole original graph. If it fires, Johnson's algorithm halts and reports failure immediately — all-pairs shortest paths are undefined when a negative cycle exists, the same reason the sibling Floyd-Warshall concept's diagonal check exists, except Johnson's algorithm refuses to even start rather than silently returning a matrix that looks like an answer.

With `h(v)` in hand, every edge gets a new weight:

```java
double reweight(Edge e, double[] h) {
    return e.weight() + h[e.from()] - h[e.to()];   // w'(u, v) = w(u, v) + h(u) - h(v)
}
```

### Why reweighting is correct: nonnegative weights and preserved shortest paths

Two facts have to hold for `w'(u, v) = w(u, v) + h(u) - h(v)` to be a legal input to Dijkstra and to still answer the original question. Both follow from `h(v) = δ(s, v)` being genuine shortest-path distances.

**Fact 1 — every new weight is nonnegative.** `computeReweighting`'s bonus pass above is exactly a check that no edge `(u, v)` can still relax `h`, i.e. `h(v) <= h(u) + w(u, v)` holds for every edge once Bellman-Ford has converged — this is the same relaxation invariant the sibling Dijkstra and Bellman-Ford concepts' `relax()` routines exist to enforce, just examined at the end instead of during a call. Rearranging that inequality:

```
h(v) <= h(u) + w(u, v)
0    <= w(u, v) + h(u) - h(v)
0    <= w'(u, v)
```

So `w'(u, v) >= 0` for every edge, with equality exactly on the edges that lie on some shortest path from `s` (the edges Bellman-Ford's relaxation left "tight").

**Fact 2 — shortest paths are preserved; only their numeric length shifts by a constant.** For any path `p = <v0, v1, ..., vk>`, sum the new weights along it:

```
w'(p) = sum_{i=1..k} w'(v_{i-1}, v_i)
      = sum_{i=1..k} ( w(v_{i-1}, v_i) + h(v_{i-1}) - h(v_i) )
      = sum_{i=1..k} w(v_{i-1}, v_i)  +  h(v0) - h(vk)      <- telescopes: every interior h(v_i) cancels
      = w(p) + h(v0) - h(vk)
```

Every intermediate `h(v_i)` for `1 <= i <= k-1` appears once with a `+` sign (as `h(v_{i-1})` for the next term) and once with a `-` sign (as `h(v_i)` for the current term), so the whole chain collapses to just the endpoints. That means **every** path from `v0` to `vk` — not just the shortest one — has its weight shifted by the same constant `h(v0) - h(vk)`, which depends only on the two endpoints, never on which path was taken. Adding the same constant to every candidate can't change which one is smallest, so the path that minimizes `w(p)` is the identical path that minimizes `w'(p)`; only the number attached to it differs, by exactly `h(v0) - h(vk)`.

**Hand-verified worked example.** Take a small sparse graph with one negative edge and no cycle at all (trivially no negative cycle):

```
A -> B (3)      B -> D (7)
A -> C (8)      D -> C (2)
A -> D (-4)     B -> C (1)
```

Running `computeReweighting` (Bellman-Ford from the added source `s`, with `s -> A`, `s -> B`, `s -> C`, `s -> D` all weight 0) gives:

| v | h(v) = δ(s, v) | tight incoming edge |
|---|---|---|
| A | 0 | `s -> A` (0) |
| B | 0 | `s -> B` (0) |
| D | -4 | `A -> D`: `h(A) + (-4) = -4` |
| C | -2 | `D -> C`: `h(D) + 2 = -4 + 2 = -2` |

Every other incoming edge is checked and confirmed non-improving — e.g. `h(C) <= h(B) + 1 = 1` and `h(C) <= h(A) + 8 = 8`, both looser than the tight value `-2` — so these four values are genuinely the shortest distances from `s`, not just a feasible guess.

Reweighting every original edge with `w'(u, v) = w(u, v) + h(u) - h(v)`:

| Edge | w(u,v) | h(u) | h(v) | w'(u,v) |
|---|---|---|---|---|
| A -> B | 3 | 0 | 0 | 3 |
| A -> C | 8 | 0 | -2 | 10 |
| A -> D | -4 | 0 | -4 | 0 |
| B -> C | 1 | 0 | -2 | 3 |
| B -> D | 7 | 0 | -4 | 11 |
| D -> C | 2 | -4 | -2 | 0 |

Every `w'` is nonnegative, as Fact 1 guarantees, and the two zeros land exactly on the edges (`A -> D`, `D -> C`) that were tight in the `h` table above — the shortest-path-from-`s` tree.

Checking Fact 2 on two pairs confirms the same path stays shortest, only the number shifts by `h(u) - h(v)`:

- **A to C:** original shortest is `A -> D -> C`, weight `-4 + 2 = -2` (beats the direct edge's `8` and `A -> B -> C`'s `3 + 1 = 4`). Reweighted, that same path costs `0 + 0 = 0`, and no other route beats it (direct `A -> C` is `10`, `A -> B -> C` is `3 + 3 = 6`). Offset: `h(A) - h(C) = 0 - (-2) = 2`, and indeed `-2 + 2 = 0`. ✓
- **B to C:** original shortest is the direct edge `B -> C`, weight `1` (beats `B -> D -> C`'s `7 + 2 = 9`). Reweighted, the direct edge costs `3`, and `B -> D -> C` costs `11 + 0 = 11` — direct still wins. Offset: `h(B) - h(C) = 0 - (-2) = 2`, and `1 + 2 = 3`. ✓

### Running Dijkstra V times, recovering original distances, and total running time

With every weight nonnegative, Dijkstra — unmodified, the sibling Dijkstra concept's own routine — can run once from every vertex. Here is that run from `A` on the reweighted graph above, traced with the `viz` engine: this step, unlike the reweighting arithmetic itself, is a real node/edge traversal, so it fits the engine's `visit`/`traverse` model directly rather than needing a table.

```viz
type: graph
node A A 0 1
node B B 1 0
node D D 1 2
node C C 2 1
edge A B directed
edge A C directed
edge A D directed
edge B C directed
edge B D directed
edge D C directed
---
visit A | Source: distTo'(A) = 0.
traverse A B | Relax A→B: 0 + 3 = 3 -- tentative distTo'(B) = 3.
traverse A C | Relax A→C: 0 + 10 = 10 -- tentative distTo'(C) = 10.
traverse A D | Relax A→D: 0 + 0 = 0 -- tentative distTo'(D) = 0.
visit D | Priority queue minimum is D at 0 (smaller than B's 3 and C's 10) -- extract and finalize: distTo'(D) = 0.
traverse D C | Relax D→C: 0 + 0 = 0 < 10 -- distTo'(C) improves to 0, beating the direct A→C edge entirely.
visit C | Priority queue minimum is now C at 0 -- extract and finalize: distTo'(C) = 0. C has no outgoing edges, nothing left to relax.
visit B | Priority queue minimum is B at 3, its only value -- extract and finalize: distTo'(B) = 3.
traverse B C | Relax B→C: 3 + 3 = 6 -- no improvement, C already finalized at 0.
traverse B D | Relax B→D: 3 + 11 = 14 -- no improvement, D already finalized at 0.
```

Recovering the *original* distances from this run reverses the shift from Fact 2: `δ(u, v) = δ'(u, v) - h(u) + h(v)`, where `δ'` is what Dijkstra just computed on the reweighted graph.

```java
// dist[u][v] = delta(u, v) for every pair, or null if G has a negative-weight cycle.
double[][] johnson(int V, List<Edge> edges) {
    double[] h = computeReweighting(V, edges);
    if (h == null) return null;                       // negative-weight cycle

    List<Edge> reweighted = new ArrayList<>();
    for (Edge e : edges) {
        reweighted.add(new Edge(e.from(), e.to(), reweight(e, h)));
    }

    double[][] dist = new double[V][V];
    for (int u = 0; u < V; u++) {
        double[] distPrime = dijkstra(V, reweighted, u);   // sibling Dijkstra concept's routine, unmodified
        for (int v = 0; v < V; v++) {
            dist[u][v] = distPrime[v] - h[u] + h[v];        // reverse the shift
        }
    }
    return dist;
}
```

For the trace above, source `A`: `δ(A, v) = δ'(A, v) + h(v)` (since `h(A) = 0`). `δ(A, A) = 0 + 0 = 0`; `δ(A, B) = 3 + 0 = 3`; `δ(A, C) = 0 + (-2) = -2`; `δ(A, D) = 0 + (-4) = -4` — matching the original weights exactly (`A -> D` direct is `-4`, `A -> D -> C` gives `-2`, `A -> B` direct is `3` and unbeatable). A full run of Johnson's algorithm repeats this Dijkstra trace three more times, from `B`, `C`, and `D`.

**Total running time.** The reweighting step (`computeReweighting`) is one Bellman-Ford run over `V + 1` vertices and `E + V` edges — still `O(VE)`, the same bound the sibling Bellman-Ford concept gives. The `V` Dijkstra runs dominate: with a Fibonacci heap, each run is `O(E + V lg V)` (a bound this module's own Dijkstra concept doesn't implement, since it uses a binary heap instead), so `V` runs cost `O(VE + V² lg V)`; combined with the `O(VE)` reweighting step, the total is `O(V² lg V + VE)`, the headline bound. Substituting the sibling Dijkstra concept's actual binary-heap-backed implementation instead, each run costs `O((V + E) lg V)`, so `V` runs cost `O(V² lg V + VE lg V)` — for any connected graph (`E = Ω(V)`, the standard assumption the sibling Bellman-Ford concept's own bound also relies on), the `VE lg V` term dominates, giving `O(VE lg V)` overall, matching the practical bound and the sparse-vs-dense crossover discussed above.

## Trade-offs

- **A genuine sparse-graph win, not a universal one** — `O(V² lg V + VE)` (Fibonacci heap) beats Floyd-Warshall's `O(V³)` on sparse graphs but only ties it on dense ones; the practical binary-heap version, `O(VE lg V)`, actually loses outright on dense graphs (`O(V³ lg V)`, strictly worse than `O(V³)`). Reach for Johnson's algorithm specifically because a graph is sparse, not by default.
- **An O(VE) preprocessing pass Floyd-Warshall never pays** — the Bellman-Ford reweighting step runs unconditionally, even in the case where the graph turns out to be dense enough that Johnson's algorithm won't end up winning; that cost is pure overhead in the losing case.
- **More honest negative-cycle handling than Floyd-Warshall's** — the sibling Floyd-Warshall concept's Trade-offs flag that it "silently produces a matrix that looks like an answer" on a negative cycle, requiring a separate diagonal check afterward. Johnson's algorithm can't even get past its own first step without that check (the Bellman-Ford bonus pass): it either returns a genuinely correct matrix or refuses to run at all.
- **Path reconstruction comes free, unlike Floyd-Warshall's bolt-on Π matrix** — each of the `V` Dijkstra runs already builds its own `edgeTo[]` shortest-path tree as a side effect (see the sibling Dijkstra concept), so recovering an actual route, not just its weight, costs nothing extra. Floyd-Warshall needs a whole second `Θ(V²)` predecessor matrix maintained in lockstep to get the same information.
- **Weights only, and only after two other algorithms are already correct** — Johnson's algorithm is not a good place to debug Bellman-Ford or Dijkstra for the first time; it's a composition of both, so a bug in either subroutine surfaces here as a wrong all-pairs answer with an extra layer of arithmetic (the reweighting/un-reweighting shift) to unwind before finding it.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 23, Section 23.3 "Johnson's algorithm for sparse graphs", pp. 662-667 — book
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
