---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the maximum-flow problem — given a directed graph where each edge has a capacity, plus a source `s` and a sink `t`, find the largest possible rate of flow from `s` to `t` without exceeding any edge's capacity — and the Ford-Fulkerson method that solves it: repeatedly find an *augmenting path* in a *residual graph* and push more flow along it, until the max-flow min-cut theorem's stopping condition (no augmenting path left) certifies the flow found is provably maximum.

## Use Cases

- Reducing other combinatorial problems to a single max-flow computation: bipartite matching (the subject of Cormen et al.'s very next section, 24.3), image segmentation, baseball-elimination, and airline crew scheduling all reduce to "build the right flow network, then run Ford-Fulkerson."
- Literal capacity planning: finding the true throughput limit of a pipeline, road network, or distribution system where every link has a fixed capacity — the original motivating scenario for both source books.
- Finding the bottleneck, not just the number: the minimum cut that comes out of the same computation identifies exactly which edges to widen to raise overall throughput — max-flow and min-cut are two views of one answer, not two separate algorithms.

## Deep Dive

### The flow network model and the maximum-flow problem

A **flow network** is a directed graph in which every edge `(u, v)` has a nonnegative capacity `c(u, v)`, plus two distinguished vertices: a source `s` and a sink `t`. An **st-flow** assigns a nonnegative flow `f(u, v)` to every edge, subject to two rules (Cormen et al., Section 24.1):

- **Capacity constraint** — `0 <= f(u, v) <= c(u, v)` for every edge: a flow can't be negative and can't exceed the edge's capacity.
- **Flow conservation** — for every vertex except `s` and `t`, total inflow equals total outflow: nothing accumulates or is manufactured at an intermediate vertex.

The **value** of a flow is the net flow out of the source (equivalently, by conservation, the net flow into the sink — Sedgewick & Wayne's Proposition E and its corollary prove the two are always equal). The **maximum-flow problem** is: find an st-flow with the largest possible value.

Here is a small concrete network — six vertices, source `0`, sink `5` — used throughout the rest of this concept (it's Sedgewick & Wayne's own `tinyFN.txt` example):

```
0->1  capacity 2       0->2  capacity 3
1->3  capacity 3       1->4  capacity 1
2->3  capacity 1       2->4  capacity 1
3->5  capacity 2       4->5  capacity 3
```

The source's total outgoing capacity is `2 + 3 = 5`; the sink's total incoming capacity is `2 + 3 = 5`. Those numbers only bound the answer from above — as the worked trace below shows, the true maximum flow here is `4`, not `5`, because of a narrower bottleneck deeper in the network.

### Augmenting paths and the residual graph — why the backward edge is not optional

Ford and Fulkerson's method (1962) is genuinely simple to state:

> Start with zero flow everywhere. While there is an **augmenting path** — a path from `s` to `t` along which more flow can still be pushed — push as much additional flow as that path's bottleneck allows. Stop when no augmenting path remains.

The part that's easy to get wrong is what counts as "a path along which more flow can still be pushed." It is *not* just paths with spare forward capacity. Given a flow `f`, the **residual graph** `Gf` has, for every original edge `u -> v` with capacity `c` and current flow `f`:

- a **forward residual edge** `u -> v` with residual capacity `c - f`, present whenever `f < c` (unused capacity — pushing flow here adds to `f(u, v)`);
- a **backward residual edge** `v -> u` with residual capacity `f`, present whenever `f > 0` (flow already committed — pushing flow here *subtracts* from `f(u, v)`, i.e., "changes the algorithm's mind" about a unit of flow it already assigned).

An augmenting path is simply any `s -> t` path in this residual graph. CLRS calls pushing flow along a backward residual edge *cancellation*: if 5 units currently flow `u -> v` and a later augmenting path routes 2 units back along `v -> u`, the net effect is the same as if only 3 units had ever been sent `u -> v` — the backward edge lets the algorithm undo part of an earlier, now-suboptimal commitment instead of being stuck with it.

**Why this isn't optional — a worked example.** Run a *forward-only* (no backward edges) version of the algorithm on the six-vertex network above, source `0`, sink `5`:

1. Path `0 -> 1 -> 3 -> 5`: bottleneck = `min(2, 3, 2) = 2`. Push 2. Flow value: `2`.
2. Path `0 -> 2 -> 4 -> 5`: bottleneck = `min(3, 1, 3) = 1`. Push 1. Flow value: `3`.

At this point, edge `0->1` is full (`2/2`) and edge `3->5` is full (`2/2`). Checking every remaining *forward* edge from `0`: `0->2` still has 2 units of spare capacity, leading to `2 -> 3` (1 unit spare) — but `3`'s only outgoing edge, `3->5`, is already full. Every other forward route from `0` is blocked the same way. A forward-only search finds **no more augmenting paths** and incorrectly reports a maxflow of `3`.

But `1->3` currently carries flow (`2` units) — so the *residual* graph has a backward edge `3 -> 1` with residual capacity `2`, which a forward-only search never considers. Using it:

3. Path `0 -> 2 -> 3 -> (residual) 1 -> 4 -> 5`: forward `0->2` (2 spare) and `2->3` (1 spare), then backward `3->1` (undoes 1 of the 2 units on `1->3`, freeing capacity for `1` to send flow elsewhere), then forward `1->4` (1 spare) and `4->5` (2 spare). Bottleneck = `min(2, 1, 2, 1, 2) = 1`. Push 1. Flow value: `4`.

This is the true maximum flow, and it was only reachable by pushing flow backward against a previous commitment. The backward edge is what makes the augmenting-path idea correct in general, not merely a performance tweak.

### The max-flow min-cut theorem, traced to convergence

A **cut** in a flow network is a partition of the vertices into two sets, `S` containing `s` and `T` containing `t`. Its **capacity** is the sum of the capacities of edges crossing *from* `S` *to* `T` (edges crossing the other way don't count toward capacity — only toward flow, which is what makes the theorem work; Cormen et al., Section 24.2). A **minimum cut** is an `S`/`T` partition of smallest possible capacity.

**Max-flow min-cut theorem** (Sedgewick & Wayne's Proposition F; CLRS's Theorem 24.6). For any flow `f`, these three statements are equivalent:

1. There is a cut whose capacity equals the value of `f`.
2. `f` is a maximum flow.
3. There is no augmenting path with respect to `f` in the residual graph.

The proof of (3) => (1) is constructive, and it's exactly what identifies the minimum cut once Ford-Fulkerson stops: let `S` be every vertex still reachable from `s` in the residual graph when no augmenting path remains, and `T` be the rest. `t` must be in `T` (otherwise there'd be an augmenting path). Every edge crossing `S -> T` must be **saturated** (full — otherwise it would still have forward residual capacity, putting its `T`-side endpoint in `S`), and every edge crossing `T -> S` must be **empty** (otherwise its residual backward edge would extend `S`). So the flow across this cut equals its capacity, and by the max-flow value being equal to the flow across *any* cut (Proposition E / Lemma 24.4), that capacity is both a valid flow value and an upper bound on every possible flow — which forces it to be the maximum.

**Full trace on the six-vertex network**, using breadth-first search to pick the *shortest* augmenting path each time (the Edmonds-Karp rule, discussed next):

```viz
type: graph
node 0 0 0 1
node 1 1 1 0
node 2 2 1 2
node 3 3 2 0
node 4 4 2 2
node 5 5 3 1
edge 0 1 directed
edge 0 2 directed
edge 1 3 directed
edge 1 4 directed
edge 2 3 directed
edge 2 4 directed
edge 3 5 directed
edge 4 5 directed
---
visit 0 | Start Ford-Fulkerson at source "0": flow 0 on every edge.
traverse 0 1 | Path 1: forward edge 0->1, residual capacity 2.
visit 1 | BFS reaches "1".
traverse 1 3 | Forward edge 1->3, residual capacity 3.
visit 3 | BFS reaches "3".
traverse 3 5 | Forward edge 3->5, residual capacity 2 -- sink reached.
visit 5 | Bottleneck = min(2, 3, 2) = 2. Push 2 along 0->1->3->5. Flow value: 2.
traverse 0 2 | Path 2: forward edge 0->2, residual capacity 3.
visit 2 | BFS reaches "2".
traverse 2 4 | Forward edge 2->4, residual capacity 1.
visit 4 | BFS reaches "4".
traverse 4 5 | Forward edge 4->5, residual capacity 3 -- sink reached.
visit 5 | Bottleneck = min(3, 1, 3) = 1. Push 1 along 0->2->4->5. Flow value: 3.
visit 2 | Path 3 begins again from "0" through 0->2 (2 units of residual capacity left).
traverse 2 3 | Forward edge 2->3, residual capacity 1.
mark 3 | At "3", both forward edges are full -- the only move left is the RESIDUAL backward edge 3->1, undoing 1 of the 2 units already on 1->3. This engine only draws declared forward edges, so the reverse hop is called out here instead of traced as a line.
mark 1 | The backward hop lands back on "1" with 1 unit of give-back capacity used (residual capacity of 3->1 equals the 2 units currently flowing 1->3).
traverse 1 4 | From "1", forward edge 1->4, residual capacity 1.
traverse 4 5 | Forward edge 4->5, residual capacity 2 -- sink reached again.
visit 5 | Bottleneck = min(2, 1, 2, 1, 2) = 1. Push 1 along 0->2->3->(residual)1->4->5. Flow value: 4.
mark 0 | No augmenting path remains. Residual-graph reachability from "0" now stops at just {0, 2}.
mark 2 | "2" is the last reachable vertex -- both its forward edges (2->3, 2->4) are saturated and it has no other residual exit. S = {0, 2}, T = {1, 3, 4, 5} is a minimum cut.
```

The viz shows *which* vertices and edges each augmenting-path search touches — it has no notion of a numeric flow value updating, so here is the same trace's actual per-edge accounting:

| Edge | Capacity | After path 1 (`0→1→3→5`, +2) | After path 2 (`0→2→4→5`, +1) | After path 3 (`0→2→3→₍res₎1→4→5`, +1) |
|---|---|---|---|---|
| `0→1` | 2 | 2 | 2 | **2 (saturated)** |
| `0→2` | 3 | 0 | 1 | 2 |
| `1→3` | 3 | 2 | 2 | 1 |
| `1→4` | 1 | 0 | 0 | **1 (saturated)** |
| `2→3` | 1 | 0 | 0 | **1 (saturated)** |
| `2→4` | 1 | 0 | 1 | **1 (saturated)** |
| `3→5` | 2 | 2 | 2 | **2 (saturated)** |
| `4→5` | 3 | 0 | 1 | 2 |
| **Flow value** | | **2** | **3** | **4** |

The minimum cut found is `S = {0, 2}`, `T = {1, 3, 4, 5}`. Its crossing edges are `0->1` (capacity 2), `2->3` (capacity 1), and `2->4` (capacity 1) — every one of them already shown saturated in the table above, exactly as the theorem's proof requires. Total cut capacity `2 + 1 + 1 = 4` matches the maximum flow value found: this equality *is* the certificate that `4` is truly optimal, not just the best this particular sequence of paths happened to find.

A Java reconstruction (adapted from Sedgewick & Wayne's `FlowEdge`/`FordFulkerson`, Algorithm 6.14), using the CLRS `residualCapacity`/BFS structure. Each `FlowEdge` must be added to *both* its endpoints' adjacency lists, so the search can traverse it forward or backward:

```java
final class FlowEdge {
    private final int from, to;
    private final double capacity;
    private double flow;

    FlowEdge(int from, int to, double capacity) {
        this.from = from;
        this.to = to;
        this.capacity = capacity;
    }

    int from() { return from; }
    int to() { return to; }

    int other(int vertex) {
        if (vertex == from) return to;
        if (vertex == to) return from;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    // Forward (toward `to`): unused capacity, c - f. Backward (toward `from`): flow already committed, f.
    double residualCapacityTo(int vertex) {
        if (vertex == to) return capacity - flow;
        if (vertex == from) return flow;
        throw new IllegalArgumentException("not an endpoint of this edge");
    }

    void addResidualFlowTo(int vertex, double delta) {
        if (vertex == to) flow += delta;        // forward hop: commit more flow
        else if (vertex == from) flow -= delta;  // backward hop: cancel committed flow
        else throw new IllegalArgumentException("not an endpoint of this edge");
    }
}

final class FordFulkerson {
    private final boolean[] marked;   // reachable from s in the residual graph -- the S side of the min cut
    private final FlowEdge[] edgeTo;  // last edge on the current augmenting path
    private double value;

    FordFulkerson(Map<Integer, List<FlowEdge>> adj, int s, int t, int vertexCount) {
        marked = new boolean[vertexCount];
        edgeTo = new FlowEdge[vertexCount];
        while (hasAugmentingPath(adj, s, t, vertexCount)) {
            double bottleneck = Double.POSITIVE_INFINITY;
            for (int v = t; v != s; v = edgeTo[v].other(v))
                bottleneck = Math.min(bottleneck, edgeTo[v].residualCapacityTo(v));
            for (int v = t; v != s; v = edgeTo[v].other(v))
                edgeTo[v].addResidualFlowTo(v, bottleneck);
            value += bottleneck;
        }
    }

    // BFS in the residual graph, shortest path in edge count -- the Edmonds-Karp rule.
    private boolean hasAugmentingPath(Map<Integer, List<FlowEdge>> adj, int s, int t, int vertexCount) {
        Arrays.fill(marked, false);
        Queue<Integer> queue = new ArrayDeque<>();
        marked[s] = true;
        queue.add(s);
        while (!queue.isEmpty()) {
            int v = queue.poll();
            for (FlowEdge e : adj.get(v)) {
                int w = e.other(v);
                if (e.residualCapacityTo(w) > 0 && !marked[w]) {
                    edgeTo[w] = e;
                    marked[w] = true;
                    queue.add(w);
                }
            }
        }
        return marked[t];
    }

    double value() { return value; }
    boolean inCut(int v) { return marked[v]; }  // true for exactly the min cut's S side, after the final call
}
```

`inCut(v)` reuses the exact same `marked[]` array the termination check just computed — the minimum cut isn't a separate computation bolted on afterward, it's a by-product of the same residual-graph reachability check that decided to stop.

### Running time: Edmonds-Karp's O(VE²) versus an adversarial pitfall

Ford-Fulkerson's generic method (CLRS's `FORD-FULKERSON-METHOD`) never specifies *how* to pick the augmenting path — and that choice controls the running time, sometimes dramatically:

- **Edmonds-Karp (1972): always pick the shortest augmenting path**, measured in edge count, found via BFS in the residual graph — exactly the `hasAugmentingPath` method above. This guarantees O(VE) augmentations, each costing O(E) to find via BFS, for a total bound of **O(VE²)** — polynomial, and independent of the capacity values entirely.
- **Arbitrary or DFS-chosen paths can be far slower, depending on the actual capacities.** A classic adversarial network makes this concrete: vertices `s, a, b, t`, with edges `s->a` (capacity 1000), `s->b` (capacity 1000), `a->b` (capacity 1), `a->t` (capacity 1000), `b->t` (capacity 1000). The true maximum flow is `2000`, reachable in exactly 2 augmenting paths (`s->a->t` and `s->b->t`, avoiding `a->b` entirely). But a DFS that happens to alternate between `s->a->b->t` and `s->b->a->t` (the second using `a->b`'s residual backward edge `b->a`) can only push **1 unit per path**, because `a->b` — capacity 1 — sits on every path it picks. That takes **2000 augmenting paths** to reach the same answer 2 iterations would have found.

For integer capacities, Ford-Fulkerson always terminates and finds the true maxflow no matter which path is chosen (each augmentation strictly increases the integer-valued flow by at least 1 — CLRS's integrality corollary) — but "always terminates" says nothing about *how fast*. The adversarial example above is the standard illustration that a correct algorithm's iteration count can depend on input magnitude, not just input size, when the path-selection rule is left unconstrained; Edmonds-Karp's shortest-path rule is precisely the fix that removes that dependency.

## Trade-offs

- **The residual graph's backward edges are required for correctness, not an optimization** — a forward-only version of the algorithm can get stuck at a strictly suboptimal flow (the worked example above stalls at `3` instead of the true `4`), because it has no way to reconsider flow it already committed to an edge.
- **Arbitrary/DFS augmenting-path choice can make running time depend on capacity values, not just graph size** — the `s,a,b,t` adversarial network above needs 2000 iterations under a bad choice versus 2 under a good one; prefer BFS (Edmonds-Karp, O(VE²)) as the default unless there's a specific reason to choose paths differently.
- **The minimum cut is a free by-product, not a separate algorithm** — the same `marked[]`/residual-reachability check that decides Ford-Fulkerson should stop is exactly the partition the max-flow min-cut theorem promises is a minimum cut; expose it (`inCut(v)`) rather than recomputing it.
- **With irrational capacities, an unconstrained choice of augmenting paths isn't even guaranteed to converge** (Sedgewick & Wayne note this explicitly) — another reason the shortest-augmenting-path rule is the sensible default rather than "any path will do" taken literally.
- **A maximum flow's edge-by-edge values need not be unique, even though the value is** — different augmenting-path orders can commit flow to different edges while reaching the same total (this concept's own trace would look different starting from `0->2->4->5` first), so don't assume a specific per-edge flow assignment is "the" answer unless the problem asks for one specific flow, not just the value.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — "Network-Flow Algorithms" (Ford-Fulkerson algorithm, residual networks, maxflow-mincut theorem), pp. 888-899 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 24 "Maximum Flow," Section 24.2 "The Ford-Fulkerson method," pp. 676-696 — doc
- [Princeton Algorithms, 4th Ed. — Maximum Flow (companion site)](https://algs4.cs.princeton.edu/64maxflow/) — doc
