---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement Dijkstra's algorithm end-to-end in Python, from a weighted adjacency-list graph to a finished `dist`/`parent` result, backed by a real binary heap.
- Represent a weighted directed graph as an adjacency list and adapt the algorithm's I/O to that representation cleanly.
- Trace the implementation's execution by hand on a graph small enough to verify every intermediate heap state and relaxation.
- Validate the implementation's output against an independently hand-computed shortest-path answer, and design at least one edge-case test (an unreachable vertex, a self-loop) that a correct implementation must still handle.
- Identify, in running code, exactly where the O((V + E) log V) bound comes from — which lines cost O(log V) and how many times each runs.

## Context & Motivation

Dijkstra's algorithm — the greedy strategy of always finalizing the not-yet-settled vertex with the smallest tentative distance, and why a binary heap is exactly the right tool to answer "which vertex is that" in O(log V) — was already proved correct and analyzed in full in [Dijkstra's Algorithm](../../../algorithms/content/dijkstras-algorithm/en.md). This lab does not re-derive any of that theory. It takes the algorithm as already understood and builds it: a real graph represented in code, a real priority queue, and a real trace checked line-by-line against numbers computed independently by hand. The gap this lab closes is the one every algorithms course leaves open after a whiteboard proof — pseudocode compiles into nothing, and the specific way a graph gets represented, a heap gets queried, and a "distance so far" gets updated all involve small decisions a proof never has to make.

## Core Theory

The two facts this lab leans on without re-proving: (1) the greedy extraction order is correct only because every edge weight is non-negative, and (2) a binary heap turns "find the not-yet-finalized vertex with the smallest tentative distance" from an O(V) scan into an O(log V) `heappop`, which is what gives the whole algorithm its O((V + E) log V) running time. Python's `heapq` module is used here as the heap — it is a genuine, production-grade binary heap (the same array-backed, sift-up/sift-down structure already covered in [Heap Insert and Extract-Max/Min](../../../../data-structures-ii/content/heap-insert-and-extract/en.md)), not a toy stand-in, so nothing about the running-time analysis changes by using it instead of a hand-rolled heap class.

One representational decision matters enough to state explicitly before the code: this implementation uses **lazy deletion** rather than a decrease-key operation. When a shorter path to an already-queued vertex is found, a brand-new `(distance, vertex)` pair is pushed rather than updating the old entry in place — `heapq` has no built-in decrease-key, and implementing one correctly requires tracking each vertex's array index, extra bookkeeping that buys nothing asymptotically. The cost is that stale, superseded entries accumulate in the heap; the fix is a single `if u in finalized: continue` check when an entry is popped, discarding stale pops in O(1). This does not change the O((V + E) log V) bound: each vertex triggers at most one push per edge relaxation, so the heap never holds more than O(E) entries total.

## Worked Examples

### The graph and the API

```python
import heapq

# Weighted directed graph, adjacency list: adj[u] = [(v, weight), ...]
adj = {
    'A': [('B', 4), ('C', 1)],
    'B': [('D', 1), ('E', 7)],
    'C': [('B', 2), ('D', 5)],
    'D': [('E', 3)],
    'E': [],
    'F': [('A', 1)],   # F has an outgoing edge but nothing reaches F — checks unreachability
}

def dijkstra(adj, source):
    """
    Returns (dist, parent):
      dist[v]   = shortest distance from source to v (absent if v unreachable)
      parent[v] = predecessor of v on a shortest path (None for source)
    Precondition: every edge weight in adj is >= 0.
    """
    dist = {source: 0}
    parent = {source: None}
    finalized = set()
    heap = [(0, source)]

    while heap:
        d, u = heapq.heappop(heap)
        if u in finalized:
            continue                       # stale entry, discard in O(1)
        finalized.add(u)

        for v, weight in adj.get(u, []):
            if weight < 0:
                raise ValueError(f"negative edge weight on ({u}, {v})")
            if v in finalized:
                continue
            candidate = dist[u] + weight
            if candidate < dist.get(v, float('inf')):
                dist[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate, v))

    return dist, parent
```

The API deliberately mirrors what a caller actually needs: `dist` for the numbers, `parent` for reconstructing the actual path (not just its length), and a vertex simply absent from `dist` if the source cannot reach it — no sentinel `float('inf')` leaking into the returned structure, since a real caller almost always wants "is it reachable at all" as a plain `in` check.

```python
def reconstruct_path(parent, target):
    if target not in parent:
        return None                        # unreachable
    path = []
    while target is not None:
        path.append(target)
        target = parent[target]
    return list(reversed(path))
```

### Trace against a hand-computed answer

Running `dijkstra(adj, 'A')`: by the same relaxation sequence already traced in [Dijkstra's Algorithm](../../../algorithms/content/dijkstras-algorithm/en.md) — extract A (0), relax to B (4) and C (1); extract C (1), relax B down to 3, D to 6; extract B (3), relax D down to 4, E to 10; extract D (4), relax E down to 7; extract E (7) — the implementation above must produce exactly:

```python
dist, parent = dijkstra(adj, 'A')
assert dist == {'A': 0, 'C': 1, 'B': 3, 'D': 4, 'E': 7}
assert reconstruct_path(parent, 'E') == ['A', 'C', 'B', 'D', 'E']
```

Hand-checking `E`'s path independently: A→C (1) + C→B (2) + B→D (1) + D→E (3) = 7, matching `dist['E']` exactly and confirming the path reconstruction, not just the distance, is correct.

### Test cases a correct implementation must pass

```python
# 1. Source with no outgoing edges reaches only itself.
d, p = dijkstra({'X': []}, 'X')
assert d == {'X': 0}

# 2. An unreachable vertex is simply absent from dist.
d, p = dijkstra(adj, 'A')
assert 'F' not in d          # nothing in this graph reaches F

# 3. A graph with a cheaper indirect route beats a more expensive direct edge.
adj2 = {'A': [('B', 10), ('C', 1)], 'C': [('B', 1)], 'B': []}
d, p = dijkstra(adj2, 'A')
assert d['B'] == 2            # A->C->B (1+1), not the direct A->B (10)

# 4. Negative weight is rejected rather than silently mishandled.
try:
    dijkstra({'A': [('B', -1)], 'B': []}, 'A')
    assert False, "should have raised"
except ValueError:
    pass
```

Test 3 is the one worth taking seriously: it is easy to write an implementation that happens to produce correct output on a graph where the shortest path is also the fewest-edges path, while silently being wrong about weights. A test where the shortest path takes *more* hops than a direct edge is what actually exercises relaxation.

## Common Misconceptions & Pitfalls

- **"Since Python's `heapq` has no decrease-key, this implementation is broken."** It is not — lazy deletion (pushing a new, better entry and discarding the old one as stale when it's eventually popped) is a standard, correct technique, not a workaround for a missing feature. The `if u in finalized: continue` check is the entire fix, and it costs at most one extra O(log V) pop per stale entry, which does not change the asymptotic bound.
- **"`heapq.heappush` needs a custom comparator to sort by distance."** Tuples compare element-by-element in Python, so `(distance, vertex)` pairs already sort by distance first — no comparator needed, as long as the distance is always the first element of the tuple. A subtle trap: if two entries have equal distance, Python falls back to comparing the second element (`vertex`), which fails if vertices aren't natively comparable (e.g., custom objects) — using a tie-breaking counter or a comparable key avoids a `TypeError` in that case.
- **"Marking a vertex finalized when it's *pushed* onto the heap, not when it's *popped*."** This is a real, easy-to-write bug: it discards the guarantee that finalization happens in increasing order of true distance, and produces wrong distances on any graph where a vertex is discovered more than once before its final, shortest value is known (exactly the B vertex in the traced example, discovered first at distance 4, corrected to 3 before ever being finalized).
- **"Forgetting to check `finalized` before relaxing outgoing edges from a stale pop."** Without the `if u in finalized: continue` guard immediately after popping, a stale entry re-finalizes an already-settled vertex and re-relaxes its edges — usually harmless in terms of final correctness (relaxation only ever improves or leaves distances unchanged) but wastes work and can double-count entries in `finalized`, breaking the "each vertex finalized exactly once" invariant the running-time analysis depends on.
- **"Testing only on graphs where BFS (fewest edges) and Dijkstra (least weight) happen to agree."** Test case 3 above exists precisely because an implementation with a subtle bug — e.g., accidentally relaxing by edge count instead of accumulated weight — can pass every test on an unweighted-looking graph and still be wrong.

## Summary

This lab implemented Dijkstra's algorithm exactly as already proved correct and analyzed in the referenced theory concept, using Python's `heapq` as a real binary min-heap with lazy deletion to handle the absence of decrease-key, and validated the result two ways: tracing the implementation's output against a hand-computed shortest-path answer on the same graph used in the theory concept, and a small suite of edge-case tests (unreachable vertices, an indirect route beating a direct edge, rejected negative weights) chosen specifically to catch bugs that a fewest-edges-only test graph would let slip through.

## Documentation Links

- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
