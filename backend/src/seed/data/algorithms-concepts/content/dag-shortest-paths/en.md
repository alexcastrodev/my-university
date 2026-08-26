---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the DAG-specific shortcut to the shortest-paths problem that the sibling Dijkstra concept leaves on the table. Relaxation (see that concept) is still the only operation doing any real work here, but a directed acyclic graph's defining property — no cycles, ever — lets you throw away Dijkstra's priority queue entirely. Process every vertex exactly once, in topological order (see the sibling topological-sort concept for how that order is produced), relaxing each vertex's outgoing edges as you go, and you're done: no greedy "always expand the closest unfinalized vertex" choice, no O(log V) heap operation per edge — and, because that greedy choice was the *only* reason Dijkstra needed non-negative weights, no restriction on the sign of the weights either.

## Use Cases

- Critical path method (CPM) / PERT chart project scheduling — the minimum possible completion time for a project is the length of the *longest* path from a start milestone to a finish milestone in a task-dependency DAG. It's the same algorithm covered here with the relaxation inequality flipped to maximize (see Trade-offs).
- Build systems and task schedulers (a Makefile-style dependency DAG) computing the earliest each target can start once every prerequisite has finished — a "lag" or "lead" edge weight can be negative without breaking anything.
- Any weighted DAG that's already been topologically sorted for another reason (e.g. after running the sibling topological-sort concept to order dependencies or detect a cycle) — this shortest-path pass is essentially free to add on top, since the expensive part (the sort) is already paid for.
- Instruction/data-flow scheduling within a compiler's basic block, where operation dependencies form a DAG and edge weights can represent negative scheduling slack without needing a different algorithm.

## Deep Dive

### Why processing in topological order alone guarantees correctness

For any edge `u -> v` in a DAG, topological order places `u` before `v` — that is the defining guarantee of a topological order (see the sibling topological-sort concept for how it's computed via reverse DFS finish-time). Walk through what that guarantee buys a single linear pass that relaxes each vertex's outgoing edges as it reaches that vertex:

By the time the pass reaches vertex `v` and is about to relax `v`'s own outgoing edges, **every** edge that points *into* `v` — every edge `w -> v` for some `w` — has already been relaxed, because every such `w` was necessarily processed earlier in the pass (topological order guarantees `w` precedes `v` whenever the edge `w -> v` exists). Relaxation is the only operation in this whole family of algorithms that can ever lower a `distTo[]` value, and every edge that could possibly lower `distTo[v]` has already fired by the time you reach `v`. So `distTo[v]` cannot change again after this point: it already equals the true shortest-path weight before you ever touch `v` to relax its own outgoing edges.

CLRS's Theorem 22.5 states this as the path-relaxation property applied along a topological order: take any shortest path `p = v0(=s), v1, ..., vk(=v)`. Because topological order processes `v0` before `v1` before `v2` ... before `vk` (each consecutive pair on `p` is itself an edge, hence ordered by the topological sort), the algorithm relaxes edge `(v0,v1)` before `(v1,v2)` before ... before `(vk-1,vk)` — relaxing a path's edges in exactly the path's own order is precisely what the path-relaxation property needs to conclude `vk.d = δ(s, vk)` at termination.

Contrast this with Dijkstra's correctness proof (see the sibling concept): Dijkstra has to argue inductively that greedily finalizing the minimum-distance frontier vertex is *safe*, and that argument only works because weights are non-negative — a not-yet-processed vertex can never beat an already-finalized distance only because edges can't be negative. The DAG algorithm's proof above never mentions weight sign at all; it relies solely on the topological ordering guarantee. That is the entire reason it tolerates negative edges: nothing in the correctness argument ever needed them to be non-negative.

### The algorithm: topological sort, then one linear relaxation pass

```java
public class AcyclicSP {
    private DirectedEdge[] edgeTo;
    private double[] distTo;

    public AcyclicSP(EdgeWeightedDigraph G, int s) {
        edgeTo = new DirectedEdge[G.V()];
        distTo = new double[G.V()];
        for (int v = 0; v < G.V(); v++) {
            distTo[v] = Double.POSITIVE_INFINITY;
        }
        distTo[s] = 0.0;

        // The sibling topological-sort concept produces this order via reverse
        // DFS finish-time; this algorithm only ever consumes it.
        Topological topological = new Topological(G);
        for (int v : topological.order()) {
            relax(G, v);
        }
    }

    private void relax(EdgeWeightedDigraph G, int v) {
        for (DirectedEdge e : G.adj(v)) {
            int w = e.to();
            if (distTo[w] > distTo[v] + e.weight()) {
                distTo[w] = distTo[v] + e.weight();
                edgeTo[w] = e;
            }
        }
    }

    public double distTo(int v) { return distTo[v]; }
}
```

Compare this to Dijkstra's driver loop in the sibling concept: there is no priority queue field anywhere in this class, no `delMin()`, no `decreaseKey()` — `relax` is called exactly once per vertex, in the fixed order `topological.order()` hands over, and every edge in the graph gets relaxed exactly once, total, across the whole run.

### Trace: a small weighted DAG with a negative edge

Six vertices, nine directed edges, one of them negative (`A -> B`, weight `-4`):

```
S -> A (5)      A -> B (-4)     B -> D (7)      C -> T (2)
S -> B (2)      A -> C (3)      C -> D (1)      D -> T (4)
                B -> C (6)
```

`S, A, B, C, D, T` is the (only) valid topological order for this graph — every edge above points from an earlier vertex in that list to a later one. Hand-verifying the shortest distances first: the cheapest way to `B` is not the direct edge `S -> B` (weight 2) but `S -> A -> B` (`5 + (-4) = 1`), and the cheapest way to `T` is `S -> A -> B -> C -> T` (`5 - 4 + 6 + 2 = 9`), beating every other `S`-to-`T` route (`S -> A -> C -> T = 10`, `S -> B -> C -> T = 10`, `S -> A -> B -> D -> T = 12`). Note this is exactly the shape of trouble the sibling Dijkstra concept's negative-weight counterexample warns about — `A -> B` makes a path through `A` cheaper than the direct edge into `B` — except here it causes no problem at all, because nothing gets "finalized" out of order in the first place; the pass just relaxes edges in a fixed sequence regardless of what any distance looks like at the time.

```viz
type: graph
node S S 0 1
node A A 1 0
node B B 1 2
node C C 2 1
node D D 3 0
node T T 4 1
edge S A directed
edge S B directed
edge A B directed
edge A C directed
edge B C directed
edge B D directed
edge C D directed
edge C T directed
edge D T directed
---
visit S | Topological order starts here: distTo[S] = 0, everything else infinity.
traverse S A | Relax S→A: distTo[A] = 0 + 5 = 5.
traverse S B | Relax S→B: distTo[B] = 0 + 2 = 2.
visit A | distTo[A] = 5 is already final -- no earlier vertex has an edge into A.
traverse A B | Relax A→B: 5 + (-4) = 1 < 2 -- the negative edge lowers distTo[B] to 1, no priority queue involved.
traverse A C | Relax A→C: 5 + 3 = 8, so distTo[C] = 8.
visit B | distTo[B] = 1 is final -- both edges into B (S→B, A→B) were already relaxed above.
traverse B C | Relax B→C: 1 + 6 = 7 < 8 -- distTo[C] improves to 7.
traverse B D | Relax B→D: 1 + 7 = 8, so distTo[D] = 8.
visit C | distTo[C] = 7 is final -- both edges into C (A→C, B→C) were already relaxed.
traverse C D | Relax C→D: 7 + 1 = 8 -- ties the existing 8, no improvement.
traverse C T | Relax C→T: 7 + 2 = 9, so distTo[T] = 9.
visit D | distTo[D] = 8 is final -- both edges into D (B→D, C→D) were already relaxed.
traverse D T | Relax D→T: 8 + 4 = 12 -- worse than the existing 9, no improvement.
visit T | distTo[T] = 9 is final. T has no outgoing edges -- one linear pass, and every distance is done.
```

Final distances from `S`: `A=5, B=1, C=7, D=8, T=9` — matching the hand-verified values above, computed with zero comparisons against a priority-queue minimum, just one straight-line pass through the topological order.

### Running time: O(V + E), strictly better than Dijkstra's O(E log V)

Three pieces, each linear: topological sort takes `Θ(V + E)` time (the sibling concept's own bound, via a DFS that visits every vertex and scans every edge list once); initializing `distTo[]`/`edgeTo[]` is `Θ(V)`; and the main loop makes one iteration per vertex, and across all iterations the inner loop relaxes each edge exactly once, so — by the same aggregate-analysis argument CLRS uses for Theorem 22.5's running-time claim — the whole pass costs `Θ(E)`. Total: `Θ(V + E)`.

Compare that to Dijkstra's `O((V + E) log V)` with a binary-heap-backed priority queue (see the sibling concept's Trade-offs): Dijkstra pays `O(log V)` for every `delMin()` and every `decreaseKey()`/`insert()`, because a heap is the price of letting the algorithm dynamically pick "which vertex is closest right now" out of an arbitrary graph. A DAG doesn't need that question answered at all — the topological order fixes the entire processing sequence in advance, in time linear in the graph's size, so there's no per-edge heap overhead left to pay. Sedgewick and Wayne make the comparison directly: the topological-sort-based method is faster than Dijkstra's algorithm "by a factor proportional to the cost of the priority-queue operations in Dijkstra's algorithm" — i.e., by roughly the `log V` factor.

That same removal of the priority queue is exactly why negative weights stop being a problem. Dijkstra's correctness proof needs "no unprocessed vertex can ever beat an already-finalized distance," and that claim is only true when weights can't be negative (the sibling concept's counterexample shows precisely how it breaks). The DAG algorithm's correctness proof, above, never invokes weight sign anywhere — it only uses "every edge into `v` was relaxed before `v` is reached," a fact that topological order guarantees regardless of what the weights are. This safety net exists only because a DAG has no cycles at all: a negative-weight *cycle* would make "shortest path" ill-defined (you could loop around it forever, driving the total lower every time), but a DAG can't contain one by definition, so the question never comes up. General digraphs with both negative weights and possible cycles need a different algorithm — Bellman-Ford — specifically to detect that ill-posed case.

## Trade-offs

- **Requires the graph to be genuinely acyclic — not a relaxed constraint, a hard precondition.** One cycle anywhere and the whole argument in the Deep Dive collapses, because "every edge into `v` was already relaxed before `v` is reached" stops being true. Graphs that may contain cycles (with or without negative weights) need Bellman-Ford instead, which is a different algorithm, not a variant of this one.
- **Topological sort is mandatory preprocessing, not an optional speedup.** If it's already being computed for another reason — cycle detection, build-order resolution, see the sibling topological-sort concept — this shortest-path pass is nearly free to add afterward. If it isn't, the sort still costs only `Θ(V + E)`, so the combined pipeline stays linear overall.
- **Longest paths (critical path / PERT analysis) is a direct corollary, not a separate algorithm.** Copy `AcyclicSP`, initialize `distTo[]` to `Double.NEGATIVE_INFINITY` instead of positive infinity, and flip the relaxation inequality from `>` to `<`. Sedgewick and Wayne's own `AcyclicLP` is exactly that two-line change, and it's what the critical path method uses directly for project-scheduling analysis: the length of the longest path from a project's start to its finish is the minimum feasible completion time.
- **Space is O(V)** — the same `distTo[]`/`edgeTo[]` pair Dijkstra and Bellman-Ford both use, but with no priority queue to size at all, since nothing is ever inserted into or extracted from one.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.4 "Shortest Paths", "Shortest paths in edge-weighted DAGs" (Algorithm 4.10) and "Longest paths" (Proposition T), pp. 658-663 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 22.2 "Single-source shortest paths in directed acyclic graphs", pp. 616-619 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
