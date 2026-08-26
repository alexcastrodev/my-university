---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand breadth-first search (BFS): a graph traversal that visits vertices in order of distance from a source — one edge away, then two edges away, then three — which makes it the standard way to find a shortest path (fewest edges) in an unweighted graph, something depth-first search can't guarantee at all.

## Use Cases

- Finding the shortest path (fewest hops) between two vertices in an unweighted graph — a social network's "degrees of separation," a word-ladder puzzle, a maze's shortest exit route.
- The traversal building block other algorithms reuse directly: Prim's minimum-spanning-tree algorithm and Dijkstra's shortest-path algorithm both generalize BFS's core idea (explore the closest unexplored thing next).
- Level-order processing of any graph or tree-shaped structure — anywhere "everything at distance k before anything at distance k+1" matters.

## Deep Dive

### A queue instead of a stack is the entire difference from DFS

Depth-first search explores as deep as possible before backtracking, using a stack (explicit or the call stack via recursion) — of the passages not yet explored, it always continues down the *most recently* found one. BFS asks the opposite question: of the passages not yet explored, continue down the *least recently* found one — which just means swapping the stack for a FIFO queue. That single change is what forces the exploration order into "everything at distance 1, then everything at distance 2, ..." instead of DFS's unpredictable-relative-to-distance order.

### The core loop

Sedgewick and Wayne's `bfs()` maintains a queue of discovered-but-not-yet-expanded vertices:

```
put the source vertex on the queue, mark it
while the queue is not empty:
    remove the next vertex v from the queue
    for each unmarked vertex w adjacent to v:
        mark w, set edgeTo[w] = v, put w on the queue
```

CLRS's `BFS` pseudocode expresses the same loop with a three-color scheme instead of a boolean `marked[]` array: every vertex starts **white** (undiscovered); the moment it's first reached it turns **gray** (on the frontier, sitting in the queue) and gets a `d` (distance) and `π` (parent) recorded; once all of its neighbors have been examined it turns **black** (fully processed, behind the frontier). Different vocabulary, identical algorithm — `marked[]`/`edgeTo[]` and white-gray-black/`d`/`π` are the same bookkeeping under two names.

### Watch it happen: BFS from vertex 0

Sedgewick's own worked example graph (`tinyG.txt`, vertices 0-5) — watch the queue-driven traversal discover every vertex in order of distance from 0, building the shortest-path tree (blue edges) as it goes:

```viz
type: graph
node 0 0 2 0
node 1 1 3 1
node 2 2 1 1
node 5 5 2 1
node 3 3 1 2
node 4 4 2 2
edge 0 2
edge 0 1
edge 0 5
edge 1 2
edge 2 3
edge 2 4
edge 3 5
edge 3 4
---
visit 0 | Dequeue "0" (the source) -- mark it visited.
traverse 0 2 | Discover "2" via "0" -- enqueue it, tree edge set.
traverse 0 1 | Discover "1" via "0" -- enqueue it.
traverse 0 5 | Discover "5" via "0" -- enqueue it.
visit 2 | Dequeue "2" -- "0" and "1" already marked; "3" and "4" are new.
traverse 2 3 | Discover "3" via "2".
traverse 2 4 | Discover "4" via "2".
visit 1 | Dequeue "1" -- both neighbors ("0", "2") already marked, nothing new.
visit 5 | Dequeue "5" -- both neighbors ("3", "0") already marked, nothing new.
visit 3 | Dequeue "3" -- all neighbors already marked.
visit 4 | Dequeue "4" -- all neighbors already marked. BFS complete.
```

The visit order — 0, 2, 1, 5, 3, 4 — is exactly the order the book's own trace produces, and the blue tree edges (0-2, 0-1, 0-5, 2-3, 2-4) are the shortest-path tree: the unique path from 0 to any vertex following only blue edges is a shortest path to it in the original graph.

## Trade-offs

- **O(V + E) time — linear in the graph's size, not a hidden cost** — CLRS proves this directly from the algorithm's structure: initialization is O(V), and because each vertex is enqueued (and its adjacency list scanned) exactly once, the total work across the whole run is O(V + E), not O(V²) or worse.
- **BFS finds *a* shortest path only when every edge has the same weight** — it counts edges, not weighted distances; a path with more hops but lower total weight would be missed entirely. Dijkstra's algorithm is what generalizes this idea to weighted graphs.
- **Memory cost is proportional to the widest frontier, not the deepest path** — BFS's queue can hold every vertex at the current distance simultaneously, which for a wide, shallow graph (a densely connected social network, for instance) can use significantly more memory at its peak than DFS's stack, which only ever holds one root-to-current-node path at a time.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.1 "Undirected Graphs", "Breadth-first search", pp. 538-541 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 20 "Elementary Graph Algorithms", Section 20.2, pp. 554-561 — book
- [Princeton Algorithms, 4th Ed. — Undirected Graphs (companion site)](https://algs4.cs.princeton.edu/41graph/) — doc
