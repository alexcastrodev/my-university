---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand depth-first search (DFS): a graph traversal that pushes as deep as possible along one branch before backtracking, using a stack — almost always the recursive call stack itself, no explicit stack data structure required. Where breadth-first search's queue-driven order makes it the tool for shortest paths, DFS's recursive, backtracking structure makes it the natural tool for questions about a graph's *composition*: how many pieces is it made of, does it contain a cycle, and in what order do its dependencies resolve.

## Use Cases

- Finding the connected components of a graph in one linear pass — a single DFS call per unvisited vertex marks exactly one component (flood-fill in image processing, reachability analysis in a network, clustering in a social graph).
- Detecting whether a graph contains a cycle — a DFS that ever re-encounters an ancestor still on the call stack has found a back edge, which is proof of a cycle (deadlock detection in a resource-allocation graph, validating a dependency graph has no circular requirement).
- Producing the vertex order that topological sort is built from — running DFS on a directed acyclic graph and reading vertices off in reverse order of their finish time gives a valid topological order (task scheduling, course-prerequisite ordering, build-dependency resolution).

## Deep Dive

### The recursive formulation: the call stack replaces BFS's explicit queue

Sedgewick and Wayne's warmup `DepthFirstSearch` is the whole algorithm in a few lines: mark the current vertex, then recurse into every unmarked neighbor. There is no queue, no explicit stack — the sequence of pending "vertices not yet fully explored" lives entirely in the parameters and return addresses of the currently-suspended recursive calls:

```java
public class DepthFirstSearch {
    private final boolean[] marked;
    private int count;

    public DepthFirstSearch(Graph g, int s) {
        marked = new boolean[g.vertexCount()];
        dfs(g, s);
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        count++;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w);   // the call stack IS the "to-explore" stack
            }
        }
    }

    public boolean isMarked(int w) { return marked[w]; }
    public int count() { return count; }
}
```

Compare this to the sibling BFS concept's `bfs()` loop: BFS pulls the *least* recently discovered vertex off an explicit `Queue`, so it finishes an entire distance-ring before starting the next one. DFS, by contrast, always continues down the *most* recently discovered, still-unexplored edge — which is exactly what happens automatically when `dfs(g, w)` is called before the current invocation's `for` loop moves on. Swap the recursion for an explicit `Deque` used as a LIFO stack and you get the same visitation behavior without relying on the JVM's own call stack; the recursive form is simply the common case because it needs no extra bookkeeping at all.

### Connected components via repeated DFS

A single DFS from an unvisited vertex marks every vertex reachable from it — nothing more, nothing less (Sedgewick and Wayne's Proposition A). That is precisely the definition of one connected component. Repeating "start a DFS from any still-unmarked vertex" until every vertex is marked therefore finds *all* of a graph's components, one DFS call per component, with a running component id assigned along the way:

```java
public class ConnectedComponents {
    private final boolean[] marked;
    private final int[] id;   // id[v] = index of the component containing v
    private int count;

    public ConnectedComponents(Graph g) {
        marked = new boolean[g.vertexCount()];
        id = new int[g.vertexCount()];
        for (int s = 0; s < g.vertexCount(); s++) {
            if (!marked[s]) {
                dfs(g, s);
                count++;
            }
        }
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        id[v] = count;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
    }

    public boolean connected(int v, int w) { return id[v] == id[w]; }
    public int count() { return count; }
}
```

Worked example — a 7-vertex graph with edges `0-1`, `1-2`, `0-2` (a triangle), `3-4`, and `5-6`, adjacency lists sorted ascending:

```text
s=0  unmarked -> dfs(0): marks 0 (id=0)
       -> dfs(1): marks 1 (id=0)   [0's first unmarked neighbor]
            -> dfs(2): marks 2 (id=0)   [1's unmarked neighbor]
                 2's neighbors 0,1 both marked -> return
            1's remaining neighbor 2 already marked -> return
       0's remaining neighbor 2 already marked -> return
     component 0 done: {0, 1, 2} -- count becomes 1

s=1  marked, skip
s=2  marked, skip

s=3  unmarked -> dfs(3): marks 3 (id=1)
       -> dfs(4): marks 4 (id=1)
            4's neighbor 3 already marked -> return
     component 1 done: {3, 4} -- count becomes 2

s=4  marked, skip

s=5  unmarked -> dfs(5): marks 5 (id=2)
       -> dfs(6): marks 6 (id=2)
            6's neighbor 5 already marked -> return
     component 2 done: {5, 6} -- count becomes 3

Result: 3 components -- {0,1,2}, {3,4}, {5,6}
```

Nothing about this loop is DFS-specific in principle — any traversal that fully marks everything reachable from a source before moving on would work — but the recursive `dfs()` makes the "mark everything reachable, then move to the next unmarked vertex" idiom a two-line addition to the warmup search. BFS's queue-based loop can be adapted to do the same outer loop, but it is DFS's connected-components application that Sedgewick and Wayne present first, precisely because the recursive structure makes the reasoning ("every marked vertex is connected to the source, and no unmarked vertex can be") so direct.

### Discovery and finish times: the parenthesis structure

CLRS's `DFS-VISIT` timestamps every vertex twice: `v.d` (discovery time) when the vertex is first reached and grayed, and `v.f` (finish time) when its entire adjacency list has been examined and it is blackened. A global clock increments on every discovery and every finish, so with `V` vertices the timestamps run from `1` to `2V`:

```java
public class DepthFirstTimes {
    private final boolean[] marked;
    private final int[] discovery;
    private final int[] finish;
    private int clock;

    public DepthFirstTimes(Graph g) {
        int n = g.vertexCount();
        marked = new boolean[n];
        discovery = new int[n];
        finish = new int[n];
        for (int v = 0; v < n; v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Graph g, int v) {
        marked[v] = true;
        discovery[v] = ++clock;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
        finish[v] = ++clock;   // every descendant has been fully explored
    }
}
```

Run this on the same 6-vertex graph used in the viz trace below (edges `0-2`, `0-1`, `0-5`, `1-2`, `2-3`, `2-4`, `3-5`, `3-4`, adjacency lists in edge-declaration order), hand-tracing the recursion exactly as Sedgewick and Wayne's own book trace does for this graph:

| vertex | discovery | finish |
|---|---|---|
| 0 | 1 | 12 |
| 2 | 2 | 11 |
| 1 | 3 | 4 |
| 3 | 5 | 10 |
| 5 | 6 | 7 |
| 4 | 8 | 9 |

CLRS's Parenthesis Theorem (20.7) says that for any two vertices, their `[d, f]` intervals are either completely nested or completely disjoint — never partially overlapping. Reading the table as intervals confirms it: `[1,12]` (vertex 0) contains `[2,11]` (vertex 2), which contains both `[3,4]` (vertex 1) and `[5,10]` (vertex 3); `[5,10]` in turn contains both `[6,7]` (vertex 5) and `[8,9]` (vertex 4). The two sibling pairs — `[3,4]` versus `[5,10]`, and `[6,7]` versus `[8,9]` — are disjoint, exactly as the theorem predicts for vertices where neither is a descendant of the other. Nesting means "descendant in the DFS tree"; disjointness means "unrelated branches" — and that single fact is the formal basis for classifying every edge DFS encounters.

### Edge classification: tree, back, forward, cross — and why back edges mean a cycle

When DFS explores an edge `(u, v)`, the color of `v` at that moment tells you what kind of edge it is: **white** means `v` is undiscovered, so `(u, v)` becomes a **tree edge**; **gray** means `v` is an ancestor of `u` still on the call stack, so `(u, v)` is a **back edge**; **black** means `v` is already finished, so `(u, v)` is a **forward** or **cross** edge. On the worked graph above, the classification is:

- **Tree edges** (5, matching the 5 recursive calls that discovered a new vertex): `0-2`, `2-1`, `2-3`, `3-5`, `3-4`.
- **Back edges** (3, the remaining edges): `1-0` (found while `0` was still gray, i.e. an ancestor), `5-0`, `4-2`.

CLRS's Theorem 20.10 states that an *undirected* graph's DFS only ever produces tree and back edges — forward and cross edges are only possible in directed graphs, because in an undirected graph the first exploration of edge `(u, v)` always happens while at least one endpoint is still gray, forcing the edge to be classified as tree or back on that first encounter. That is exactly why every one of the 8 edges above lands in one of those two buckets with none left over.

Back edges are the reason DFS is the standard way to detect a cycle: a back edge `(u, v)` exists precisely when `v` is an ancestor of `u` on the current DFS path, which means the tree path from `v` down to `u` plus the edge back from `u` to `v` forms a cycle. Sedgewick and Wayne's `Cycle` class checks exactly this, tracking the edge just arrived from (`u`) so it doesn't mistake the trivial "walk back along the same undirected edge" for a cycle:

```java
public class Cycle {
    private final boolean[] marked;
    private boolean hasCycle;

    public Cycle(Graph g) {
        marked = new boolean[g.vertexCount()];
        for (int s = 0; s < g.vertexCount(); s++) {
            if (!marked[s]) dfs(g, s, s);
        }
    }

    private void dfs(Graph g, int v, int parent) {
        marked[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w, v);
            } else if (w != parent) {
                hasCycle = true;   // reached a marked vertex that isn't the parent -- a back edge
            }
        }
    }

    public boolean hasCycle() { return hasCycle; }
}
```

Edge classification also underlies topological sorting: for a directed acyclic graph, running DFS to completion and then reading vertices off in **reverse order of finish time** produces a valid topological order — every edge `u -> v` has `u.f > v.f`, so listing vertices from highest finish time to lowest guarantees every vertex appears before everything it points to. CLRS proves this in Section 20.4; it isn't implemented here since topological sort is its own concept, but the finish-time bookkeeping above is exactly the mechanism it relies on.

### Watch it happen: DFS from vertex 0 (same graph as the BFS trace)

Same graph, same source, same adjacency order as the sibling BFS concept's trace — so the visit order below can be compared directly against BFS's `0, 2, 1, 5, 3, 4`:

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
visit 0 | Call dfs(0) -- mark "0" visited, the root of the DFS tree.
traverse 0 2 | "2" is first on 0's adjacency list and unmarked -- recurse into dfs(2): tree edge.
visit 2 | dfs(2) marks "2" visited.
traverse 2 1 | "0" on 2's list is already marked (skip); "1" is next and unmarked -- recurse into dfs(1): tree edge.
visit 1 | dfs(1) marks "1" visited -- both its neighbors ("0","2") are already marked, so it returns immediately (back edges).
traverse 2 3 | Backtrack to dfs(2)'s loop; "3" is the next unmarked neighbor -- recurse into dfs(3): tree edge.
visit 3 | dfs(3) marks "3" visited.
traverse 3 5 | "5" is first on 3's adjacency list and unmarked -- recurse into dfs(5): tree edge.
visit 5 | dfs(5) marks "5" visited -- both its neighbors ("3","0") are already marked, so it returns immediately (back edges).
traverse 3 4 | Backtrack to dfs(3)'s loop; "4" is the next unmarked neighbor -- recurse into dfs(4): tree edge.
visit 4 | dfs(4) marks "4" visited -- both its neighbors ("3","2") already marked. Backtracking now unwinds all the way to dfs(0); nothing left unmarked. DFS complete.
```

The visit order — 0, 2, 1, 3, 5, 4 — matches Sedgewick and Wayne's own hand trace of this exact graph, and it differs from BFS's 0, 2, 1, 5, 3, 4 at exactly the point you'd expect: DFS commits to vertex 3's whole subtree (discovering 3, then 5, then 4) before ever coming back for anything BFS would have queued earlier, while BFS finishes the entire distance-1 ring (2, 1, 5) before touching distance 2 at all.

## Trade-offs

- **O(V + E) time — the same bound as BFS, for the same underlying reason.** CLRS's aggregate analysis applies here as it did for BFS: `DFS-VISIT` is called exactly once per vertex (since the first thing it does is paint the vertex gray, guaranteeing it never runs twice on the same vertex), and each vertex's adjacency list is scanned exactly once across the whole run, so total work is Θ(V + E).
- **Recursive DFS risks a stack overflow that BFS's explicit queue never risks.** Call-stack depth grows with path depth, not with the number of vertices explored so far — a long, thin graph (a 200,000-vertex linked-list-shaped path, say) can blow a JVM thread's default stack before DFS ever backtracks. An explicit-stack, non-recursive rewrite of DFS avoids this at the cost of manually managing the "which neighbor was I about to check" position that recursion tracks for free.
- **DFS gives no shortest-path guarantee whatsoever.** As Sedgewick and Wayne put it, DFS paths "tend to be long and winding" — a path DFS happens to find from source to target can be far longer than necessary, because DFS commits to whichever unexplored edge it saw most recently rather than the one closest to the source. If shortest path is the actual goal, BFS (unweighted) or Dijkstra's algorithm (weighted) is the right traversal, not DFS.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.1 "Undirected Graphs", "Depth-first search" and "Connected components", pp. 530-537, 543-547 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 20 "Elementary Graph Algorithms", Section 20.3 "Depth-first search", pp. 563-572 — book
- [Princeton Algorithms, 4th Ed. — Undirected Graphs (companion site)](https://algs4.cs.princeton.edu/41graph/) — doc
