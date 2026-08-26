---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand Bellman-Ford as the general-case answer to the constraint the sibling Dijkstra concept establishes: Dijkstra's greedy finalize-the-closest-vertex strategy is only correct when every edge weight is non-negative. Bellman-Ford drops that requirement entirely — it works on any graph, with any mix of positive and negative weights, as long as no cycle reachable from the source has a negative total weight. It buys that generality by giving up Dijkstra's clever ordering: instead of a priority queue picking the next vertex to finalize, Bellman-Ford just relaxes *every* edge in the graph, `V - 1` times, and proves that brute force is enough.

## Use Cases

- Any weighted graph where negative weights are possible and you can't rule them out up front — Dijkstra's non-negative assumption isn't a minor inconvenience here, it's disqualifying.
- Distance-vector routing protocols (e.g. RIP) that propagate cost updates hop-by-hop without any global ordering guarantee — the algorithm's "relax everything, repeat" structure is exactly what a distributed protocol with no topological view of the network can implement.
- Arbitrage detection in currency-exchange markets: replacing each conversion rate `x` with the edge weight `-ln(x)` turns "is there a sequence of trades that returns more currency than you started with" into "is there a negative cycle reachable from the source" — a direct application of Bellman-Ford's negative-cycle detection, not just its shortest-path output.
- Constraint graphs with cycles (so the linear-time DAG shortest-path algorithm doesn't apply) where edge weights represent slack or lag values that can legitimately be negative, e.g. certain scheduling and difference-constraint systems.

## Deep Dive

### The general problem, and why a negative cycle breaks "shortest path"

The three shortest-path algorithms in this module form a ladder of decreasing restriction: the DAG algorithm needs a topological order (no cycles at all, but weights can be anything); Dijkstra needs no negative weights (cycles are fine); Bellman-Ford needs neither — any graph, any weights — with exactly one caveat: no **negative cycle** reachable from the source.

A negative cycle is a cycle whose edge weights sum to less than zero. Take a minimal example:

```
X -> Y (1)
Y -> X (-3)
```

The cycle `X -> Y -> X` costs `1 + (-3) = -2`. Walking it once from `X` back to `X` costs `-2`; walking it twice costs `-4`; walking it `k` times costs `-2k`. Once a path can reach `X`, it can loop through this cycle as many times as it likes before continuing on, so the "shortest path" to anything reachable through the cycle isn't just hard to compute — it's undefined, because there is no minimum: for any proposed shortest distance, one more trip around the cycle beats it.

This is a different, deeper failure than the one the sibling Dijkstra concept's counterexample demonstrates. That counterexample (`S -> A (3)`, `S -> B (2)`, `A -> B (-2)`) has a single negative edge and no cycle at all — the shortest path from `S` to `B` is still perfectly well-defined (it's `1`, via `S -> A -> B`), Dijkstra's greedy strategy is just wrong about it because it finalizes `B` too early. A negative cycle is worse: it's not that some particular algorithm's strategy needs fixing, it's that the quantity "shortest path" stops existing. Bellman-Ford's job is therefore twofold: compute correct distances when no negative cycle is reachable from the source, and reliably report when one is.

### The core algorithm: relax every edge, V - 1 times

Bellman-Ford reuses the same `relax()` primitive the sibling Dijkstra concept introduces — "does going through `u` beat the best path to `v` found so far?" — but drops the priority queue entirely, since there's no ordering to maintain:

```java
void relax(int u, int v, double weight, double[] distTo, int[] edgeTo) {
    if (distTo[v] > distTo[u] + weight) {
        distTo[v] = distTo[u] + weight;
        edgeTo[v] = u;
    }
}
```

The algorithm itself is just: initialize, then relax every edge in the graph, in any order, `V - 1` times over.

```java
double[] distTo = new double[V];
int[] edgeTo = new int[V];
Arrays.fill(distTo, Double.POSITIVE_INFINITY);
distTo[source] = 0.0;

for (int pass = 0; pass < V - 1; pass++) {
    for (Edge e : allEdges) {
        relax(e.from(), e.to(), e.weight(), distTo, edgeTo);
    }
}
```

CLRS's `BELLMAN-FORD(G, w, s)` is the same two nested loops (`for i = 1 to |V| - 1`, `for each edge (u, v)`, `RELAX(u, v, w)`), followed by one more pass used for negative-cycle detection, covered below.

**Why `V - 1` rounds are guaranteed enough.** In a graph with no negative cycle, every shortest path is simple — it never revisits a vertex, since revisiting one would mean going around some cycle, and a non-negative cycle can only be removed from the path without increasing its cost. A simple path over `V` vertices has at most `V - 1` edges. Sedgewick and Wayne's Proposition X proves the rest by induction on the pass number `i`: after the `i`th pass, `distTo[]` is correct for `v_i`, the vertex reached after `i` edges along any particular shortest path `v_0 -> v_1 -> ... -> v_k` (`v_0` being the source) — because that pass is guaranteed to relax edge `(v_{i-1}, v_i)` among everything else it relaxes, and `distTo[v_{i-1}]` is already correct by the inductive hypothesis. CLRS's Lemma 22.2 states the same fact via its "path-relaxation property": since a shortest path has at most `V - 1` edges, and each of the `V - 1` passes relaxes every edge, by the time all `V - 1` passes are done, every edge on every shortest path has been relaxed in the correct left-to-right order at least once — even though the algorithm never knew in advance what that order was. That's the whole trick: Dijkstra and the DAG algorithm each compute an ordering up front (by priority queue or topological sort) and relax each edge exactly once, in that order; Bellman-Ford doesn't bother computing an order at all, and instead just relaxes everything enough times that the correct order is guaranteed to be embedded somewhere in the repetition. Each pass can only improve or leave unchanged any `distTo[]` value — relaxation never worsens an estimate — so nothing computed in an earlier pass is ever invalidated by a later one.

### Worked trace: reusing the sibling's negative-edge trap, extended

Extend the sibling Dijkstra concept's counterexample graph — `S -> A (3)`, `S -> B (2)`, `A -> B (-2)` — with two more vertices continuing the same path, so there's a genuine 5-vertex graph to trace:

```
S -> A (3)      B -> C (4)
S -> B (2)      C -> D (-1)
A -> B (-2)
```

`V = 5`, so `V - 1 = 4` passes are guaranteed sufficient. True shortest distances from `S`: `A = 3`, `B = min(2, 3 - 2) = 1` (the same trap as the sibling concept — the direct edge `S -> B` looks cheaper than it is), `C = 1 + 4 = 5`, `D = 5 - 1 = 4`.

**Why this is a table, not a `type: graph` viz.** A genuine attempt at the graph engine's `visit`/`traverse`/`mark` steps was made first, but Bellman-Ford's defining structure — relax *every* edge on *every* pass, regardless of whether the previous pass touched it — doesn't map cleanly onto those three commands. Unlike Dijkstra or BFS, where every `traverse` step corresponds to a real, permanent tree edge discovered exactly once, most of Bellman-Ford's relaxation attempts in a small trace are no-ops that don't change any distance (relaxing `C -> D` while `distTo[C]` is still infinite, for instance). Representing every attempted relaxation as a `traverse` step would misuse the engine's semantics (it documents `traverseEdge` as marking a tree edge) on calls that aren't tree edges at all, and skipping the no-op attempts would misrepresent the algorithm's actual "relax everything, every time" behavior — the exact detail this trace needs to show. A distance table after each pass, in the style of Sedgewick's own Figure and CLRS's Figure 22.4, states the truth plainly instead.

To make the multi-pass requirement visible rather than accidental, relax the edges in an order that runs *against* the shortest path's direction: `C -> D`, `B -> C`, `A -> B`, `S -> B`, `S -> A`.

| Pass | distTo(S) | distTo(A) | distTo(B) | distTo(C) | distTo(D) |
|------|-----------|-----------|-----------|-----------|-----------|
| 0 (init) | 0 | ∞ | ∞ | ∞ | ∞ |
| 1 | 0 | 3 | 2 | ∞ | ∞ |
| 2 | 0 | 3 | 1 | 6 | ∞ |
| 3 | 0 | 3 | 1 | 5 | 5 |
| 4 | 0 | 3 | 1 | 5 | 4 |

Watch how each pass finalizes one more vertex along the shortest path `S -> A -> B -> C -> D`, exactly as Proposition X and Lemma 22.2 predict: pass 1 gets `A` right (1 edge away); pass 2 corrects `B` from its premature `2` down to the true `1` once `A -> B`'s negative weight is relaxed (2 edges away); pass 3 gets `C` right (3 edges away); pass 4 gets `D` right (4 edges away). This adversarial edge order — deliberately relaxing `C -> D` before the distance to `C` is even known — is close to the worst case for how many passes are needed; a friendlier order (e.g. `S -> A`, `S -> B`, `A -> B`, `B -> C`, `C -> D`) would have produced every correct distance in a single pass here, but Bellman-Ford can't assume it will be handed a friendly order, which is exactly why it commits to `V - 1` passes regardless.

### Bonus: detecting a negative cycle with one more pass, and the queue-based speedup

Since a legitimate shortest path never needs more than `V - 1` edges when no negative cycle is reachable from the source, running one *more* — the `V`th — round of relaxation after the normal `V - 1` gives a free correctness check: if any `distTo[]` value still improves on that extra round, the only possible explanation is a cycle that keeps paying off every time it's traversed, i.e. a negative cycle. CLRS's `BELLMAN-FORD` pseudocode implements exactly this: after the `V - 1` passes, it loops over every edge `(u, v)` once more and returns `FALSE` the moment it finds `v.d > u.d + w(u, v)` still true; if it gets through that final loop with no such edge, it returns `TRUE`, having also produced correct shortest-path distances for everything reachable from the source.

Sedgewick and Wayne's own implementation, `BellmanFordSP`, reaches the same guarantee through a different mechanism suited to their queue-based variant (below): rather than a clean extra pass over all edges, it periodically inspects the `edgeTo[]` predecessor array for a cycle — if the array of "last edge on the shortest path to `v`" ever contains a cycle, that cycle must be negative, because a vertex can only be revisited in `edgeTo[]` if the path back around to it got strictly shorter each time.

**The queue-based optimization (SPFA-style).** The naive version above relaxes all `E` edges on every one of the `V - 1` passes, even when most of those relaxations are guaranteed no-ops (as the worked trace's table shows directly — plenty of cells simply don't change between passes). Sedgewick and Wayne's queue-based `BellmanFordSP` observes that an edge `u -> v` can only possibly improve `distTo[v]` if `distTo[u]` changed in the previous pass, so it keeps a FIFO queue of "vertices whose distance just changed" and only re-relaxes edges leaving those vertices, skipping everything else. This is the same idea widely known outside Sedgewick's book as SPFA (Shortest Path Faster Algorithm). It's a substantial practical speedup — Sedgewick and Wayne report their 250-vertex example converging in 14 passes instead of the full `V`, with fewer distance comparisons than Dijkstra needed on the same graph — but the worst-case bound is unchanged: an adversarial graph can still force it through close to `V` full rounds, so it remains `O(VE)` in the worst case even though it's frequently much faster in practice.

## Trade-offs

- **O(VE) running time** — `V - 1` passes (or, with the bonus round, `V`), each relaxing all `E` edges: Sedgewick and Wayne state it directly as time proportional to `EV`; CLRS derives `O(V^2 + VE)` from `Θ(V)` initialization plus `Θ(V + E)` per pass, which collapses to the familiar `O(VE)` whenever `E = Ω(V)`, the common case. That's markedly slower than Dijkstra's `O(E log V)` or the DAG algorithm's `O(V + E)` — the price paid for not requiring non-negative weights or acyclicity.
- **O(V) extra space** — one `distTo[]` and one `edgeTo[]` entry per vertex, the same footprint as Dijkstra and the DAG algorithm; no priority queue is needed at all.
- **Negative-cycle detection is a first-class, built-in feature, not an afterthought** — the bonus `V`th pass (or Sedgewick and Wayne's `edgeTo[]`-cycle check) makes Bellman-Ford the only one of the three shortest-path algorithms in this module that can even be run safely without first knowing whether the graph qualifies. Dijkstra, by contrast, doesn't check anything — handed a negative edge, it silently produces a wrong `distTo[]` value, as the sibling concept's counterexample shows.
- **The queue-based (SPFA-style) variant is usually much faster, but its worst case is identical to the naive version** — `O(VE)` in the worst case either way, so it's a practical optimization, not a different complexity class; don't rely on it for a worst-case guarantee the way Dijkstra's binary-heap bound can be relied on.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.4 "Shortest Paths", the Bellman-Ford algorithm (Proposition X through negative-cycle detection), pp. 671-679 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 22.1 "The Bellman-Ford Algorithm", pp. 612-616 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
