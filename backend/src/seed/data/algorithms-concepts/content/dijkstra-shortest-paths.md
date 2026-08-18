---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand Dijkstra's algorithm as the direct answer to the question breadth-first search's own Trade-offs leave open: BFS finds a shortest path only by counting hops, because a plain FIFO queue treats every edge as costing the same "1 hop." Dijkstra's algorithm keeps BFS's overall shape — grow outward from the source, one vertex at a time, never revisiting a finalized vertex — but replaces the FIFO queue with a priority queue ordered by cumulative distance, because edges now carry different weights and "explore in discovery order" no longer means "explore in distance order." That single substitution is the entire generalization.

## Use Cases

- Road-network and GPS routing where roads have different travel times or lengths — the shortest *path* is rarely the one with the fewest turns.
- Network routing protocols (link-state routing, e.g. OSPF) computing least-cost paths where "cost" is a configured link weight, not hop count.
- Any weighted-graph "cheapest way from A to B" problem: flight-itinerary pricing, currency-arbitrage-free-shortest-cost graphs, game AI pathfinding with variable terrain cost.
- The structural sibling of Prim's minimum-spanning-tree algorithm: both grow a structure one vertex at a time using a priority queue, but Dijkstra optimizes distance-from-source while Prim optimizes total tree weight, and their relaxation rules differ accordingly.

## Deep Dive

### Relaxation: the one operation every shortest-path algorithm shares

Before Dijkstra's specific strategy, there is a single primitive operation that Dijkstra, Bellman-Ford, and DAG shortest paths all call, unchanged, to make progress. For an edge `u -> v` with weight `w`, relaxation asks: "does going through `u` beat the best path to `v` found so far?"

```java
void relax(int u, int v, double weight,
            double[] distTo, int[] edgeTo, IndexMinPQ<Double> pq) {
    if (distTo[v] > distTo[u] + weight) {
        distTo[v] = distTo[u] + weight;
        edgeTo[v] = u;
        if (pq.contains(v)) pq.decreaseKey(v, distTo[v]);
        else                pq.insert(v, distTo[v]);
    }
}
```

CLRS's `RELAX(u, v, w)` pseudocode is the same three lines with `v.d` in place of `distTo[v]` and `v.π` in place of `edgeTo[v]`: if `v.d > u.d + w(u, v)`, set `v.d = u.d + w(u, v)` and `v.π = u`. Every shortest-path algorithm in this family — Dijkstra, Bellman-Ford, and the linear-time DAG algorithm — does nothing but call this same procedure, initialize `distTo[source] = 0` and everything else to infinity, and then differ only in **how many times** and **in what order** they relax edges: Dijkstra relaxes each edge exactly once, in an order chosen by a priority queue; Bellman-Ford relaxes every edge `V - 1` times, in any order, which is what lets it tolerate negative weights; the DAG algorithm relaxes edges once each, in topological order. This concept covers only the Dijkstra ordering.

### Dijkstra's greedy strategy: always finalize the closest unfinalized vertex

Dijkstra's algorithm maintains a priority queue of vertices keyed by their current tentative distance (`distTo[]`), and repeats one step: extract the minimum-distance vertex not yet finalized, relax all its outgoing edges, and mark it finalized. Once a vertex is finalized, its distance is guaranteed correct and is never touched again.

```java
distTo[source] = 0.0;
pq.insert(source, 0.0);
while (!pq.isEmpty()) {
    int u = pq.delMin();          // the closest not-yet-finalized vertex
    for (Edge e : adjacent(u)) {
        relax(e.from(), e.to(), e.weight(), distTo, edgeTo, pq);
    }
    // u's distTo[] value is now final — no future relaxation can improve it
}
```

**Why extracting the minimum guarantees correctness.** When `u` comes off the queue with the smallest tentative distance, every other vertex still in the queue has a tentative distance `>= distTo[u]`. Because all weights are non-negative, any path from the source to `u` that runs through one of those not-yet-processed vertices `x` would already have to cover at least `distTo[x] >= distTo[u]` just to reach `x` — and then it would need to travel further still to reach `u`, since weights can't be negative to shrink that remaining distance. So no path through an unprocessed vertex can ever beat `distTo[u]`. CLRS's Theorem 22.6 proves this formally by induction on the finalized set `S`; the one-sentence version above is the same argument.

**Worked trace.** Source `A`, directed weighted edges:

```
A -> B (4)      C -> B (2)      B -> D (1)
A -> C (1)      C -> D (5)      B -> E (7)
                                D -> E (3)
```

| Step | Vertex extracted (finalized) | dist(A) | dist(B) | dist(C) | dist(D) | dist(E) |
|------|-------------------------------|---------|---------|---------|---------|---------|
| 0    | — (init)                      | 0       | ∞       | ∞       | ∞       | ∞       |
| 1    | A                             | 0       | 4       | 1       | ∞       | ∞       |
| 2    | C                             | 0       | 3       | 1       | 6       | ∞       |
| 3    | B                             | 0       | 3       | 1       | 4       | 10      |
| 4    | D                             | 0       | 3       | 1       | 4       | 7       |
| 5    | E                             | 0       | 3       | 1       | 4       | 7       |

Trace this by hand to see relaxation and the greedy choice interact: extracting `A` relaxes `A->B` (4) and `A->C` (1). The queue's minimum is now `C` (1), not `B` — so `C` is finalized next, and relaxing `C->B` finds `1 + 2 = 3 < 4`, lowering `B`'s tentative distance before `B` is ever finalized. That reordering is exactly what a FIFO queue *couldn't* do: BFS would have finalized `B` right after `A` (discovery order), locking in the wrong value.

### Watch it happen: the same trace, as a shortest-path tree

Each `traverse` below fires only once a vertex's `edgeTo[]` is *final* — the edge recorded at the moment that vertex is dequeued and finalized, not every relaxation attempt along the way. `B` is a `mark`ed twice before it's ever `traverse`d: first tentatively via `A->B` (4), then again via `C->B` (3) — only the second, better edge becomes part of the tree, which is exactly the reordering the trace above describes in words.

```viz
type: graph
node A A 0 1
node C C 1 0
node B B 1 2
node D D 2 1
node E E 3 1
edge A B directed
edge A C directed
edge C B directed
edge C D directed
edge B D directed
edge B E directed
edge D E directed
---
visit A | Dequeue "A" (dist 0, the source) -- finalized.
mark B | Relax A→B: dist(B) tentatively 4.
mark C | Relax A→C: dist(C) tentatively 1.
visit C | Dequeue "C" (dist 1) -- closer than B, so it finalizes first.
traverse A C | Tree edge: A→C is C's final shortest-path edge.
mark B | Relax C→B: 1 + 2 = 3 < 4 -- B's tentative distance improves before B is ever finalized.
mark D | Relax C→D: 1 + 5 = 6 tentatively.
visit B | Dequeue "B" (dist 3) -- finalized.
traverse C B | Tree edge: C→B, not A→B -- the earlier relaxation never became final.
mark D | Relax B→D: 3 + 1 = 4 < 6 -- improves again.
mark E | Relax B→E: 3 + 7 = 10 tentatively.
visit D | Dequeue "D" (dist 4) -- finalized.
traverse B D | Tree edge: B→D is D's final shortest-path edge.
mark E | Relax D→E: 4 + 3 = 7 < 10 -- improves.
visit E | Dequeue "E" (dist 7) -- finalized. Dijkstra complete.
traverse D E | Tree edge: D→E is E's final shortest-path edge.
```

### Why non-negative weights are non-negotiable

Dijkstra's correctness argument above depends entirely on "no path through an unprocessed vertex can beat the just-finalized distance," and that step relies on weights never being negative — a negative edge can make a longer-looking path shorter later, after the algorithm has already committed to a smaller vertex's distance. Here is a minimal, hand-verified counterexample:

```
S -> A (3)
S -> B (2)
A -> B (-2)
```

The true shortest distance from `S` to `B` is `min(2, 3 + (-2)) = 1`, via `S -> A -> B`. Running Dijkstra:

1. Extract `S` (0). Relax `S->A`: `distTo[A] = 3`. Relax `S->B`: `distTo[B] = 2`. Queue: `{A: 3, B: 2}`.
2. Extract the minimum, `B` (2) — it looks closer than `A`, so it's **finalized** at `distTo[B] = 2`.
3. Extract `A` (3), finalized at `distTo[A] = 3`. Relax `A->B`: `3 + (-2) = 1 < 2` — but `B` is already finalized and out of the queue, so standard Dijkstra never revisits it. `distTo[B]` stays `2`.

Dijkstra reports `distTo[B] = 2`; the actual shortest distance is `1`. The algorithm is wrong because it finalized `B` before discovering that a path through `A` — which only *looked* farther away — was actually shorter once its negative edge was accounted for. This is precisely the scenario Sedgewick and Wayne flag when they note that Dijkstra's algorithm "requires that weights be positive (or zero)": negative weights need Bellman-Ford instead, which keeps relaxing every edge for `V - 1` rounds specifically so a late-discovered negative edge still gets a chance to lower an earlier distance.

### The connection back to BFS

Set every edge weight to `1` and Dijkstra's behavior collapses into BFS's exactly. After the source is finalized at distance `0`, every neighbor gets tentative distance `1`; the priority queue's minimum is `1`, and every vertex at that distance comes off before any vertex at distance `2` can be reached (since reaching distance `2` requires first relaxing through a distance-`1` vertex). A priority queue that only ever holds two, then three, consecutive integer values, extracted in non-decreasing order, produces exactly the same "everything at distance k before anything at distance k+1" schedule a FIFO queue gives for free — it's just enforcing that schedule through explicit priorities instead of insertion order. CLRS makes the same point directly: "you can think of Dijkstra's algorithm as generalizing breadth-first search to weighted graphs" — a wave still emanates from the source, but the time for the wave to cross an edge is the edge's weight rather than a fixed unit.

## Trade-offs

- **O((V + E) log V) time with a binary-heap-backed indexed priority queue** — the same bound, for the same structural reason, as Prim's minimum-spanning-tree algorithm: both call `delMin()` once per vertex and `decreaseKey()`/`insert()` at most once per edge, and both pay `O(log V)` per priority-queue operation because of the underlying binary heap (see the sibling binary-heaps-and-heapsort concept for why that bound holds).
- **Correctness strictly requires non-negative edge weights** — there is no partial-credit version of this constraint; a single negative edge can make an already-finalized distance wrong, as shown above. Graphs with negative weights need Bellman-Ford (or Dijkstra after a Johnson's-algorithm-style reweighting pass).
- **Eager vs. lazy implementation is a real design choice** — the version above is "eager": it uses an index-aware priority queue that supports `decreaseKey()`, so each vertex occupies at most one priority-queue slot at a time. A "lazy" version simply re-inserts a vertex with its new, lower key on every improving relaxation and lets stale, larger-keyed entries for the same vertex sit in the queue to be skipped later — simpler to implement, but the queue can grow to `O(E)` entries instead of `O(V)`.
- **Extra space is O(V)** (eager version) — one `distTo[]` and one `edgeTo[]` entry per vertex, plus a priority queue that never holds more than `V` vertices at once.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.4 "Shortest Paths", "Dijkstra's algorithm", pp. 652-657 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 22 "Single-Source Shortest Paths" (Relaxation, pp. 609-611) and Section 22.3 "Dijkstra's Algorithm", pp. 620-624 — book
- [Princeton Algorithms, 4th Ed. — Shortest Paths (companion site)](https://algs4.cs.princeton.edu/44sp/) — doc
- [Introduction to Algorithms, 4th Edition (MIT Press)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
