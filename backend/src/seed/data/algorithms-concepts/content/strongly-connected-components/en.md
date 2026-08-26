---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand strongly connected components (SCCs): the directed-graph generalization of the sibling DFS concept's connected components. That sibling concept covers *undirected* connectivity, where a single DFS pass per component is enough, because an undirected edge `{u, v}` lets you walk from `u` to `v` and from `v` to `u` using the very same edge. A directed graph offers no such guarantee — an edge `u -> v` says nothing about whether `v` can get back to `u` — so "everything DFS marks starting from `s`" is only the set reachable *from* `s`, not the set that is *mutually* reachable with `s`. Computing that mutual-reachability partition is what strongly connected components does, and because reachability in a directed graph is asymmetric, it takes two DFS passes instead of one.

## Use Cases

- **Preprocessing before running other directed-graph algorithms.** Many algorithms that operate on digraphs start by decomposing into SCCs, run separately on each component, then combine results using the structure of the (always acyclic) component graph that connects them — a pattern Cormen, Leiserson, Rivest, and Stein call out explicitly as the whole reason this section exists.
- **Web and food-web graph analysis.** Sedgewick and Wayne's own running example is a food-web digraph ("mosquito eats grass," "algae feeds worm," and so on); an SCC with more than one vertex there means a real ecological feedback loop, not just a one-way dependency — the same shape of question a link-analysis algorithm asks of a web graph.
- **Circular software-dependency detection.** Model a "depends-on" relationship as a directed edge; the sibling topological-sort concept already requires the graph to be a DAG to produce any ordering at all. Running SCC detection first finds every non-trivial component (more than one vertex) — each one is a genuine circular dependency that has to be broken before a topological order can exist.

## Deep Dive

### What an SCC is, and why a directed graph needs two DFS passes

A strongly connected component of a directed graph `G = (V, E)` is a maximal set of vertices `C ⊆ V` such that for every pair `u, v ∈ C`, both `u` can reach `v` *and* `v` can reach `u` via directed paths. Compare a 3-cycle to a 3-vertex path, both on vertices `{0, 1, 2}`:

```text
Cycle:  0 -> 1 -> 2 -> 0        Path:   0 -> 1 -> 2

Forward reachability from 0 is identical in both graphs: {0, 1, 2}.
But mutual reachability differs completely:
  cycle -> one SCC: {0, 1, 2}   (2 can reach 0, via 2->0)
  path  -> three SCCs: {0}, {1}, {2}   (2 cannot reach 0 -- no edge goes backward)
```

A single DFS from vertex `0` cannot tell these two graphs apart — `marked[]` ends up `{0, 1, 2}` either way, because DFS only ever answers "reachable from the source," never "reachable from *and* to the source." That is exactly the gap the sibling DFS concept's `ConnectedComponents` never has to close: an undirected graph's single-pass reachability set is automatically the mutual-reachability set, since every edge is bidirectional by construction. A directed graph forces the question open, and answering it requires checking reachability in both directions — which is why every correct SCC algorithm, Kosaraju's included, runs DFS twice.

### The graph transpose, and why it has the exact same SCCs

The transpose (or reverse) of `G = (V, E)`, written `G^R` (Sedgewick and Wayne's notation) or `G^T` (Cormen et al.'s), is the same vertex set with every edge's direction flipped: `E^R = {(v, u) : (u, v) ∈ E}`. Given an adjacency-list representation of `G`, building `G^R` takes Θ(V + E) — walk every edge once and add it to the reversed adjacency list of its target:

```java
public Digraph reverse() {
    Digraph reversed = new Digraph(vertexCount());
    for (int v = 0; v < vertexCount(); v++) {
        for (int w : adjacentTo(v)) {
            reversed.addEdge(w, v);   // flip this edge's direction
        }
    }
    return reversed;
}
```

CLRS states the key fact directly: `u` and `v` are reachable from each other in `G` if and only if they are reachable from each other in `G^R` — so `G` and `G^R` have *exactly* the same strongly connected components. The reason is that a directed path is just a sequence of edges walked in order; reversing every edge in the graph and then walking the same sequence *backward* retraces the identical path in the opposite direction. Concretely, take the cycle `0 -> 1 -> 2 -> 0` from above. Reversing every edge gives `1 -> 0`, `2 -> 1`, `0 -> 2` — still a single cycle, just rotating the other way (`0 -> 2 -> 1 -> 0`). Mutual reachability survives intact: in `G`, vertex `0` reaches `1` directly (`0->1`) and `1` reaches `0` the long way (`1->2->0`); in `G^R`, those roles swap — `0` now reaches `1` the long way (`0->2->1`) and `1` reaches `0` directly (`1->0`). The specific forward and backward *paths* traded places, but the fact that both directions exist did not change — which is precisely why the SCC partition itself is untouched by reversal.

### Kosaraju's algorithm

Sedgewick and Wayne's `KosarajuSCC` needs only a few lines added on top of the sibling DFS concept's `ConnectedComponents`, following this three-step recipe:

1. Build `G^R`, then run a DFS over *all* of `G^R` to compute its reverse postorder — the same reverse-postorder-via-stack mechanic the sibling topological-sort concept's `TopologicalOrder` already builds (push each vertex once it finishes), just run here on `G^R` instead of `G`, and on a graph that is allowed to contain cycles.
2. Run DFS on the *original* graph `G`, but drive the constructor's outer loop over unmarked vertices using that reverse-postorder sequence instead of plain numeric order `0, 1, 2, ...`.
3. Every distinct DFS tree produced by a single top-level call to `dfs()` in that second pass is exactly one strongly connected component.

```java
public class KosarajuSCC {
    private final boolean[] marked;
    private final int[] id;      // id[v] = index of the SCC containing v
    private int count;

    public KosarajuSCC(Digraph g) {
        marked = new boolean[g.vertexCount()];
        id = new int[g.vertexCount()];
        DepthFirstOrder order = new DepthFirstOrder(g.reverse());   // DFS on G^R
        for (int s : order.reversePostorder()) {
            if (!marked[s]) {
                dfs(g, s);   // DFS on G, in G^R's reverse-postorder
                count++;
            }
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        id[v] = count;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
    }

    public boolean stronglyConnected(int v, int w) { return id[v] == id[w]; }
    public int id(int v) { return id[v]; }
    public int count() { return count; }
}
```

Aside: CLRS presents essentially the same two-pass idea but in the opposite order relative to which graph each pass runs on. Their `STRONGLY-CONNECTED-COMPONENTS` runs the *ordering* DFS on `G` itself to compute finish times, then runs the *main* DFS on `G^T`, visiting vertices in decreasing finish-time order. Sedgewick and Wayne instead run the ordering DFS on `G^R` and the main DFS on `G`. Swap which graph is "the one being reordered" versus "the one being finally searched" and the two recipes describe the same algorithm — both books' proofs lean on the same underlying fact, that finish order from one graph tells you a safe processing order for the other.

Trace it on a small hand-verified digraph with two real cycles: `0 -> 1 -> 2 -> 0` (one SCC) feeding into `3 -> 4 -> 3` (a second SCC), which feeds into a sink `5` (its own singleton SCC):

**Pass 1 — DFS on `G^R` (the transpose) to compute reverse postorder.** Reversing `0->1, 1->2, 2->0, 2->3, 3->4, 4->3, 4->5` gives `G^R`'s edges `0->2, 1->0, 2->1, 3->2, 3->4, 4->3, 5->4`. The outer loop visits unmarked vertices in plain numeric order `0..5`; `visit` below marks each vertex's *finish*, since finish order is what this pass exists to produce:

```viz
type: graph
node 0 0 0 0
node 1 1 1 0
node 2 2 2 0
node 3 3 0 1
node 4 4 1 1
node 5 5 2 1
edge 0 2 directed
edge 1 0 directed
edge 2 1 directed
edge 3 2 directed
edge 3 4 directed
edge 4 3 directed
edge 5 4 directed
---
traverse 0 2 | dfs(0) starts (outer loop's first unmarked vertex); "2" is unmarked -- tree edge 0->2.
traverse 2 1 | dfs(2)'s neighbor "1" is unmarked -- tree edge 2->1.
mark 0 | dfs(1)'s neighbor "0" is already marked (ancestor, still on the call stack) -- back edge, just a check.
visit 1 | dfs(1) has no more neighbors, so it finishes. "1" is the FIRST vertex to finish.
visit 2 | Back in dfs(2): no neighbors remain, so it finishes now that dfs(1) has returned. "2" finishes second.
visit 0 | Back in dfs(0): no neighbors remain, so it finishes, completing the first tree. "0" finishes third.
mark 2 | Outer loop's next unmarked vertex is "3" -- dfs(3) starts; neighbor "2" is already black (finished) -- not a tree edge, just a check.
traverse 3 4 | dfs(3)'s next neighbor "4" is unmarked -- tree edge 3->4.
mark 3 | dfs(4)'s neighbor "3" is already marked (ancestor, still on the stack) -- back edge, just a check.
visit 4 | dfs(4) has no more neighbors, so it finishes. "4" finishes fourth.
visit 3 | Back in dfs(3): no neighbors remain, so it finishes. "3" finishes fifth.
mark 4 | Outer loop's last unmarked vertex is "5" -- dfs(5) starts; its only neighbor "4" is already black (finished) -- not a tree edge, just a check.
visit 5 | dfs(5) has no more neighbors, so it finishes immediately. "5" finishes sixth, completing the sweep.
```

Reading the finish order off those `visit` steps gives `1, 2, 0, 4, 3, 5`. Reversed, that is the sequence pass 2 must check unmarked vertices in: `5, 3, 4, 0, 2, 1`.

**Pass 2 — DFS on the original `G`, outer loop driven by that reverse-postorder sequence.** `G`'s edges: `0->1, 1->2, 2->0, 2->3, 3->4, 4->3, 4->5`. Here `visit` marks *discovery* (as in the sibling DFS concept's trace), and a final `mark` on each tree's vertices flags the SCC it just completed:

```viz
type: graph
node 0 0 0 0
node 1 1 1 0
node 2 2 2 0
node 3 3 0 1
node 4 4 1 1
node 5 5 2 1
edge 0 1 directed
edge 1 2 directed
edge 2 0 directed
edge 2 3 directed
edge 3 4 directed
edge 4 3 directed
edge 4 5 directed
---
visit 5 | Reverse-postorder's first vertex is "5" -- dfs(5) starts. It has no outgoing edges, so it returns immediately.
mark 5 | dfs(5) reached nothing else -- component {5} is complete: SCC #0.
visit 3 | Next unmarked vertex in the order is "3" -- dfs(3) starts.
traverse 3 4 | 3's only neighbor "4" is unmarked -- tree edge 3->4.
visit 4 | dfs(4) starts.
mark 3 | 4's neighbor "3" is already marked (dfs(3) is still on the stack) -- back edge, confirms 3 and 4 reach each other.
mark 5 | 4's other neighbor "5" is already marked too, but from an earlier tree that already finished -- it is NOT pulled into this tree.
mark 4 | dfs(4) and then dfs(3) return -- component {3, 4} is complete: SCC #1.
visit 0 | Next unmarked vertex in the order is "0" -- dfs(0) starts.
traverse 0 1 | 0's neighbor "1" is unmarked -- tree edge 0->1.
visit 1 | dfs(1) starts.
traverse 1 2 | 1's neighbor "2" is unmarked -- tree edge 1->2.
visit 2 | dfs(2) starts.
mark 0 | 2's neighbor "0" is already marked (ancestor, still on the stack) -- back edge, confirms 0 and 2 reach each other.
mark 3 | 2's other neighbor "3" is already marked too, but from an earlier, already-finished tree -- confirms it is a different component.
mark 2 | dfs(2), dfs(1), and dfs(0) all return in turn -- component {0, 1, 2} is complete: SCC #2. Outer loop has no unmarked vertices left; done.
```

Three DFS trees, three SCCs: `{5}`, `{3, 4}`, `{0, 1, 2}` — matching the graph's two hand-designed cycles plus the singleton sink exactly.

### Why the algorithm is correct, and its running time

The compressed version of Sedgewick and Wayne's Proposition H: the second pass's outer loop always starts a new DFS tree from whichever unmarked vertex has the *latest* finish time left, according to the ordering pass computed on `G^R`. Every vertex mutually reachable with that root gets pulled into its tree (a path-existence argument by contradiction — if some `v` strongly connected to root `s` were missed, `v` would have had to finish before `s` started in the ordering pass, which is only possible if `s` is *also* reachable from `v` in that same pass, meaning `s` would already be marked, contradicting that `dfs(G, s)` ran at all). Just as important, nothing *outside* the current SCC ever gets pulled in by mistake: any vertex `v` that `s` can merely reach — without `v` being able to reach back to `s` — is guaranteed by the reverse-postorder ordering to have already finished (and thus already been marked, in an earlier tree) before the second pass ever starts exploring from `s`. That is the same finish-time bookkeeping the sibling topological-sort concept relies on, just applied to a graph that need not be acyclic: it guarantees a *safe processing order*, not a valid topological order, since a general digraph can have cycles that a DAG cannot.

Running time is O(V + E): building `G^R` is Θ(V + E), the ordering DFS over `G^R` is Θ(V + E), and the main DFS over `G` is Θ(V + E) — three linear-time steps chained together, still linear overall. Sedgewick and Wayne state this directly as Proposition I: preprocessing time and space proportional to `V + E` supports constant-time strong-connectivity queries afterward via `id[v] == id[w]`.

## Trade-offs

- **O(V + E) time, but with real constant-factor overhead a single DFS pass never pays.** Unlike the sibling DFS concept's `ConnectedComponents` (one pass, no extra structure), Kosaraju's algorithm needs a full transpose graph built and held in memory alongside the original, plus two separate DFS traversals — three linear passes instead of one.
- **Simple to code, but the correctness argument is genuinely subtle.** Sedgewick and Wayne call Kosaraju's algorithm "an extreme example of a method that is easy to code but difficult to understand" — the implementation differs from plain connected-components by only a few lines, yet the reason those few lines work relies on the finish-time argument above, not on anything visible in the code itself.
- **Not the only linear-time option.** Tarjan's algorithm (credited in CLRS's chapter notes as the original linear-time SCC algorithm, predating this two-pass approach) computes the same decomposition in a *single* DFS pass using low-link values and an explicit stack, trading Kosaraju's simplicity for more intricate per-vertex bookkeeping and no need to ever materialize the transpose graph.
- **The output feeds directly into the sibling topological-sort concept.** Contracting every SCC down to one vertex always produces an acyclic component graph (CLRS's `G_SCC`) — so once a digraph's SCCs are known, topological sort can order the components themselves, which is exactly the "decompose, then process each component and combine by structure" pattern this section's Use Cases describe.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.2 "Directed Graphs", "Strong components" (Kosaraju's algorithm), pp. 586-591 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 20.5 "Strongly connected components", pp. 577-580 — book
- [Princeton Algorithms, 4th Ed. — KosarajuSCC.java (companion site)](https://algs4.cs.princeton.edu/42digraph/KosarajuSCC.java.html) — doc
