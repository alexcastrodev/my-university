---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the minimum spanning tree (MST) problem — given a connected, undirected, edge-weighted graph, find the subset of edges that connects every vertex at the lowest possible total weight, forming a tree (exactly V-1 edges, no cycles) rather than an arbitrary connected subgraph — and the single idea, the cut property, that both classical MST algorithms (Prim's and Kruskal's) rely on to prove they're correct.

## Use Cases

- Network design: wiring a building, laying fiber, or routing power/water lines to connect every point at minimum material cost.
- Clustering: running Kruskal's partway and stopping K-1 edges early splits the graph into K natural clusters (single-linkage clustering) — the union-find components the algorithm was already tracking *are* the clusters.
- A building block for approximation algorithms on harder problems — the classic 2-approximation for metric TSP, and Steiner-tree approximations, both start by computing an MST.

## Deep Dive

### The MST problem and the cut property

A spanning tree of a connected graph is a connected acyclic subgraph that touches every vertex — which forces it to have exactly V-1 edges (one more edge would close a cycle, one fewer would disconnect it). A **minimum spanning tree** is a spanning tree whose total edge weight is no larger than that of any other spanning tree.

A **cut** is a partition of the graph's vertices into two nonempty sets. A **crossing edge** connects a vertex in one set to a vertex in the other. Take this small 6-vertex, 9-edge graph:

```
A-B 4   A-C 2   B-C 1
B-D 5   C-D 8   C-E 9
D-E 3   D-F 6   E-F 7
```

Cut `{A, B, C}` vs. `{D, E, F}` has three crossing edges: `B-D` (5), `C-D` (8), `C-E` (9). The minimum-weight one is `B-D` (5).

**Cut property.** For any cut of an edge-weighted graph, the minimum-weight crossing edge is in *some* minimum spanning tree of the graph (Sedgewick & Wayne's Proposition J; Cormen et al.'s Theorem 21.1, phrased there as: a *light* edge crossing a cut that respects a partial MST-in-progress `A` is always safe to add to `A`). The proof is a cut-and-paste exchange argument: suppose an MST `T` does *not* contain the minimum crossing edge `e`. Adding `e` to `T` creates a cycle, and that cycle must contain at least one other edge `f` that also crosses the same cut (since the cycle has to cross back). Because `e` is the minimum-weight crossing edge, `weight(e) <= weight(f)`. Swapping `f` out for `e` produces another spanning tree with total weight no greater than `T`'s — so a tree omitting the minimum crossing edge was never strictly better, and can always be replaced by one that includes it.

This one fact is what both algorithms below exploit, just by choosing *which* cut to look at differently: Prim's always uses the cut between "vertices in the tree so far" and "vertices not yet in the tree"; Kruskal's uses, implicitly, the cut between each edge's two endpoints' current components.

### Prim's algorithm

Prim's grows a single tree from an arbitrary starting vertex. At each step it adds the minimum-weight edge connecting a vertex already in the tree to a vertex that isn't — repeatedly re-applying the cut property to the cut `(tree vertices, non-tree vertices)`. The "lazy" implementation (Sedgewick & Wayne's `LazyPrimMST`) keeps every edge leaving the tree on a priority queue and lets stale, both-ends-already-in-tree edges sit there until they're popped and discarded:

```java
final class Edge implements Comparable<Edge> {
    private final int v, w;
    private final double weight;

    Edge(int v, int w, double weight) {
        this.v = v;
        this.w = w;
        this.weight = weight;
    }

    double weight() { return weight; }
    int either() { return v; }

    int other(int vertex) {
        if (vertex == v) return w;
        if (vertex == w) return v;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    public int compareTo(Edge that) { return Double.compare(this.weight, that.weight); }
}

final class LazyPrimMST {
    private final boolean[] marked;
    private final PriorityQueue<Edge> pq = new PriorityQueue<>();
    private final List<Edge> mstEdges = new ArrayList<>();

    LazyPrimMST(Map<Integer, List<Edge>> adj, int source, int vertexCount) {
        marked = new boolean[vertexCount];
        visit(adj, source);
        while (!pq.isEmpty()) {
            Edge e = pq.poll();
            int v = e.either(), w = e.other(v);
            if (marked[v] && marked[w]) continue;   // both ends already in the tree -- stale, discard
            mstEdges.add(e);
            if (!marked[v]) visit(adj, v);
            if (!marked[w]) visit(adj, w);
        }
    }

    private void visit(Map<Integer, List<Edge>> adj, int v) {
        marked[v] = true;
        for (Edge e : adj.get(v))
            if (!marked[e.other(v)]) pq.offer(e);   // enqueue every edge leaving the new tree vertex
    }
}
```

`PriorityQueue<Edge>` here is Java's ordinary binary-heap-backed priority queue — the mechanics of how `offer`/`poll` keep the minimum at the top are exactly what this module's binary heaps concept covers; the interesting part of Prim's isn't the heap, it's *what* gets pushed and *when*.

Tracing `LazyPrimMST` starting at `A` on the graph above (each step pops the true minimum crossing edge, since with only 6 vertices no stale entries happen to reach the front first):

```viz
type: graph
node A A 1 0
node B B 0 1
node C C 1 1
node D D 2 1
node E E 1 2
node F F 2 2
edge A B
edge A C
edge B C
edge B D
edge C D
edge C E
edge D E
edge D F
edge E F
---
visit A | Start the tree at "A" (arbitrary root) -- mark it.
traverse A C | Cheapest edge leaving the tree: A-C, weight 2 -- pull it off the PQ.
visit C | "C" joins the tree; its incident edges (C-D 8, C-E 9) enter the PQ.
traverse C B | Cheapest crossing edge now: B-C, weight 1.
visit B | "B" joins the tree; B-D (5) enters the PQ. A-B is now stale (both ends in tree).
traverse B D | Cheapest crossing edge now: B-D, weight 5.
visit D | "D" joins the tree; D-E (3), D-F (6) enter the PQ. C-D is now stale.
traverse D E | Cheapest crossing edge now: D-E, weight 3.
visit E | "E" joins the tree; E-F (7) enters the PQ. C-E is now stale.
traverse D F | Cheapest remaining crossing edge: D-F, weight 6.
visit F | "F" joins the tree. 5 edges added, total weight 2+1+5+3+6 = 17. MST complete.
```

### Kruskal's algorithm

Kruskal's ignores tree structure entirely: sort *all* edges by weight ascending, then walk the sorted list, greedily adding each edge to a growing forest unless its two endpoints are already connected within that forest (which would close a cycle). "Are these two endpoints already connected?" is exactly the query a disjoint-set (union-find) structure answers in near-constant time — this module's sibling Union-Find / Disjoint Sets concept builds that structure up from quick-find through weighted quick-union with path compression; Kruskal's is the canonical reason it exists.

```java
final class KruskalMST {
    private final List<Edge> mstEdges = new ArrayList<>();

    KruskalMST(List<Edge> edges, int vertexCount) {
        List<Edge> sorted = new ArrayList<>(edges);
        sorted.sort(Comparator.naturalOrder());   // O(E log E) -- the algorithm's bottleneck

        UF uf = new UF(vertexCount);               // weighted union-find with path compression
        for (Edge e : sorted) {
            if (mstEdges.size() == vertexCount - 1) break;   // V-1 edges found, MST is complete
            int v = e.either(), w = e.other(v);
            if (uf.connected(v, w)) continue;                 // would close a cycle -- skip it
            uf.union(v, w);
            mstEdges.add(e);
        }
    }

    List<Edge> edges() { return mstEdges; }
}
```

Tracing `KruskalMST` on the same graph (`UF` starts with all 6 vertices in their own singleton component):

| Edge | Weight | `uf.connected(v, w)`? | Action | Running total |
|---|---|---|---|---|
| B-C | 1 | no | add, union(B, C) | 1 |
| A-C | 2 | no | add, union(A, C) | 3 |
| D-E | 3 | no | add, union(D, E) | 6 |
| A-B | 4 | **yes** — A and B both already in `{A, B, C}` | skip, would close a cycle | 6 |
| B-D | 5 | no | add, union(B, D) — merges `{A,B,C}` and `{D,E}` | 11 |
| D-F | 6 | no | add, union(D, F) | 17 |

The loop stops here — `mstEdges.size() == vertexCount - 1 == 5` — without ever looking at `E-F` (7), `C-D` (8), or `C-E` (9). The five accepted edges are exactly the same set Prim's found (`B-C`, `A-C`, `D-E`, `B-D`, `D-F`), same total weight 17, as the cut property guarantees for a graph with all-distinct edge weights.

### When to prefer each

Sedgewick & Wayne's own performance table (Section 4.3) summarizes the asymptotics directly, for a graph with V vertices and E edges:

| Algorithm | Extra space | Worst-case time |
|---|---|---|
| Lazy Prim's | O(E) | O(E log E) |
| Eager Prim's (index priority queue) | O(V) | O(E log V) |
| Kruskal's | O(E) | O(E log E) |

Because `E <= V^2` always, `log E = O(log V)` regardless of graph density, so neither algorithm has a strictly better *asymptotic* exponent than the other in general — the real difference is in what work each one is forced to do upfront and how much space it needs:

- **Dense graphs (E close to V^2) favor Prim's.** Kruskal's must sort the *entire* edge list before touching union-find, and for a dense graph that's a large upfront cost even though only V-1 of those E edges end up in the MST. Eager Prim's never needs the full edge list sorted — it discovers each next cheapest edge incrementally from an adjacency-list-driven priority queue keyed by vertices (only O(V) entries), so it does less total work and uses less memory when E is quadratic in V.
- **Sparse graphs (E close to V) — or edges that already arrive sorted or as a stream — favor Kruskal's.** With E proportional to V, the O(E log E) sort is cheap to begin with, and if the input is already sorted (or edges arrive incrementally in sorted order, e.g., from an external merge), Kruskal's skips the sort step entirely and its cost collapses toward the near-linear cost of the union-find operations alone.
- **Kruskal's produces a reusable byproduct.** The union-find structure it builds along the way is directly useful for other purposes (e.g., single-linkage clustering); Prim's index priority queue over vertices has no comparable secondary use.

## Trade-offs

- **Both algorithms work correctly with zero or negative edge weights** — unlike Dijkstra's shortest-path algorithm, nothing in the cut property's proof assumes positive weights; MST algorithms only ever compare edges to each other, never to a running distance total.
- **A unique MST is only guaranteed when all edge weights are distinct** — with tied weights, the cut-property proof's key step (the swapped-in edge is *strictly* lighter) no longer forces a unique answer, and multiple minimum-weight spanning trees can exist; both algorithms still return *a* correct MST without any modification.
- **Kruskal's needs an efficient "are these two vertices already connected?" check on every edge it considers; Prim's does not** — Prim's only ever asks "is this one vertex already marked," a plain boolean-array lookup, while Kruskal's connectivity check across the whole growing forest is exactly what union-find (see the sibling Union-Find / Disjoint Sets concept) is built for.
- **Kruskal's is generally slower than Prim's in practice despite matching big-O** — Cormen and Sedgewick & Wayne both note it has to perform a `connected()` check for essentially every edge in addition to the same priority-queue-style work Prim's does, so real-world constant factors tend to favor Prim's even on graphs where the asymptotics tie.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.3 "Minimum Spanning Trees," pp. 604-629 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 21 "Minimum Spanning Trees," pp. 585-601 — doc
