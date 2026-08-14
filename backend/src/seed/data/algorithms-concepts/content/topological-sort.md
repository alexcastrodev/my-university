---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand topological sort: given a directed acyclic graph (DAG), produce a linear ordering of its vertices such that every directed edge points from a vertex earlier in the ordering to one later in it. This is not "sorting" in the comparison sense — there is no key being compared — it is a *linearization* of a precedence relation: if edge `u -> v` means "u must happen before v," a topological order is any sequence that respects every one of those constraints simultaneously. As the sibling depth-first-search concept covers, DFS already gives us discovery/finish times and a way to detect cycles via back edges; topological sort turns out to be nothing more than DFS finish times read off in reverse.

## Use Cases

- **Build systems and package managers** — a target/package that depends on another must be built/installed after it; topological order on the dependency graph is exactly a valid build order (Maven's reactor build order, `npm`/`pnpm` workspace build order, `make`'s target graph).
- **Course scheduling** — Sedgewick and Wayne's own running example: an edge `prerequisite -> course` means the prerequisite must be taken first, and a topological order is a semester-by-semester plan that never schedules a course before its prerequisite.
- **Spreadsheet cell recalculation** — a formula cell that references another cell must be recomputed after the cell it reads from; topological order on the "reads-from" graph gives a recalculation order that never uses a stale value.

## Deep Dive

### The problem, and why it requires a DAG

Cormen et al. state the requirement plainly: topological sorting is defined only on directed graphs that are acyclic — no linear ordering is possible when a directed graph contains a cycle. The reason is a direct contradiction: if `A` must come before `B`, `B` before `C`, and `C` before `A`, no placement of the three on a line can satisfy all three constraints at once. Sedgewick and Wayne's Proposition E states the converse too: a digraph has a topological order **if and only if** it is a DAG.

That "if and only if" is why cycle detection is the mandatory first step before attempting a topological sort at all. As the sibling DFS concept covers, an *undirected* DFS classifies edge `(u, v)` as a **back edge** exactly when `v` is gray — an ancestor of `u` still on the call stack — and a back edge is proof of a cycle. The directed case works identically, just with `onStack[]` replacing the "not my parent" check the undirected `Cycle` class used, since a digraph has no symmetric parent edge to exclude:

```java
public class DirectedCycle {
    private final boolean[] marked;
    private final boolean[] onStack;   // vertices on the current recursive call stack
    private boolean hasCycle;

    public DirectedCycle(Digraph g) {
        marked = new boolean[g.vertexCount()];
        onStack = new boolean[g.vertexCount()];
        for (int v = 0; v < g.vertexCount(); v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        onStack[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) {
                dfs(g, w);
            } else if (onStack[w]) {
                hasCycle = true;   // w is an ancestor still on the stack -- a back edge
            }
        }
        onStack[v] = false;   // done with v -- it leaves the current path
    }

    public boolean hasCycle() { return hasCycle; }
}
```

This is CLRS's Lemma 20.11 in code: a directed graph is acyclic if and only if a DFS of it yields no back edges. In practice, cycle detection and topological sort go hand in hand — Sedgewick and Wayne describe a three-step process for scheduling applications: specify the tasks and constraints, run `DirectedCycle` to find and remove any cycles (a real cycle usually means a modeling mistake), and only then run topological sort on the now-acyclic graph.

### The reverse-postorder algorithm: DFS plus O(1) bookkeeping

CLRS's `TOPOLOGICAL-SORT` is three lines: run DFS to compute finish times, and as each vertex finishes, insert it onto the *front* of a linked list. That "insert at the front on finish" is precisely what pushing onto a stack does, so the Java version is a thin wrapper around the same `dfs()` the sibling concept already established — the only addition is one `push` call after the recursive loop:

```java
public class TopologicalOrder {
    private final boolean[] marked;
    private final Deque<Integer> reversePostorder;   // built directly in topological order

    // assumes g is a DAG -- verified separately, e.g. via DirectedCycle.hasCycle()
    public TopologicalOrder(Digraph g) {
        marked = new boolean[g.vertexCount()];
        reversePostorder = new ArrayDeque<>();
        for (int v = 0; v < g.vertexCount(); v++) {
            if (!marked[v]) dfs(g, v);
        }
    }

    private void dfs(Digraph g, int v) {
        marked[v] = true;
        for (int w : g.adjacentTo(v)) {
            if (!marked[w]) dfs(g, w);
        }
        reversePostorder.push(v);   // v just finished -- push onto the front, CLRS style
    }

    public Iterable<Integer> order() { return reversePostorder; }
}
```

Nothing here is new machinery: it is exactly the `DepthFirstTimes.dfs()` from the sibling concept, minus the discovery/finish clock, plus a single `push(v)` where that clock would have recorded `finish[v]`. Sedgewick and Wayne's own `DepthFirstOrder` class makes the same point by building all three DFS orderings — preorder, postorder, and reverse postorder — side by side from one traversal, differing only in *when* each vertex is recorded (before the recursive calls, after them into a queue, or after them onto a stack) and *which* data structure holds it.

### Why reverse finish time is always a valid topological order

This is the one fact the whole algorithm rests on, and CLRS's Theorem 20.12 proves it precisely. Consider any edge `u -> v` in a DAG, at the moment DFS explores it during `dfs(u)`. As the sibling DFS concept's edge classification covers, `v`'s color at that instant determines the edge type — and `v` **cannot be gray**: gray would mean `v` is an ancestor of `u` still on the call stack, making `u -> v` a back edge, which Lemma 20.11 rules out in a DAG. That leaves exactly two possibilities:

- **`v` is white** (undiscovered). The edge `u -> v` causes DFS to recurse into `v`, making it a descendant of `u`. `dfs(v)` — and everything reachable from `v` — must finish before `dfs(u)` can return, so `v.finish < u.finish`.
- **`v` is black** (already finished). Its finish time was set before `dfs(u)` even examined the edge, so trivially `v.finish < u.finish`.

Either way, for **every** edge `u -> v` in the DAG, `v` finishes before `u` does. Sorting vertices by *decreasing* finish time — i.e., reverse postorder — therefore always places `u` before `v` for every edge, which is exactly the definition of a topological order. Sedgewick and Wayne's Proposition F states the same result from the other direction (in terms of pre/postorder rather than raw timestamps), and both books note the proof only works because a DAG can never produce the "gray" case — a cyclic graph would let some edge violate it.

Watching this play out on a small course-prerequisite DAG makes the finish-time bookkeeping concrete. Seven courses, seven prerequisite edges, DFS started from vertex 0 with the outer loop visiting unmarked vertices in id order and each vertex's adjacency list in edge-declaration order:

```viz
type: graph
node 0 Calc 1 0
node 3 DataSt 4 0
node 1 LinAlg 0 1
node 2 Discr 2 1
node 4 Algo 3 2
node 5 DB 2 2
node 6 ML 0 3
edge 0 1 directed
edge 0 2 directed
edge 1 6 directed
edge 2 4 directed
edge 2 5 directed
edge 3 4 directed
edge 4 6 directed
---
traverse 0 1 | dfs(0) starts (outer loop's first unmarked vertex); its first neighbor "LinAlg" (1) is unmarked -- tree edge 0->1.
traverse 1 6 | dfs(1) examines its only neighbor "ML" (6) -- unmarked -- tree edge 1->6.
visit 6 | dfs(6) has no outgoing edges, so it finishes immediately. "ML" is the FIRST vertex to finish.
visit 1 | Back in dfs(1): no neighbors remain, so it finishes now that dfs(6) has returned. "LinAlg" finishes second.
traverse 0 2 | Back in dfs(0): its second neighbor "Discr" (2) is still unmarked -- tree edge 0->2.
traverse 2 4 | dfs(2) examines its first neighbor "Algo" (4) -- unmarked -- tree edge 2->4.
mark 6 | dfs(4) examines its only neighbor "ML" (6) -- already black (finished) -- not a tree edge, just a check.
visit 4 | dfs(4) has no more neighbors, so it finishes. "Algo" finishes third.
traverse 2 5 | Back in dfs(2): its second neighbor "DB" (5) is unmarked -- tree edge 2->5.
visit 5 | dfs(5) has no outgoing edges, so it finishes immediately. "DB" finishes fourth.
visit 2 | Back in dfs(2): no neighbors remain, so it finishes. "Discr" finishes fifth.
visit 0 | Back in dfs(0): no neighbors remain, so it finishes, completing the first DFS tree. "Calc" finishes sixth.
mark 3 | The outer loop advances to the next unmarked vertex: "DataSt" (3) has no incoming edges, so it starts a second, independent DFS call.
mark 4 | dfs(3) examines its only neighbor "Algo" (4) -- already black (finished) -- not a tree edge, just a check.
visit 3 | dfs(3) has no more neighbors, so it finishes immediately. "DataSt" finishes seventh, completing the sweep.
```

Reading the `visit` steps above in order gives the finish sequence `ML, LinAlg, Algo, DB, Discr, Calc, DataSt`. Reversing it gives `DataSt, Calc, Discr, DB, Algo, LinAlg, ML` — and checking every one of the graph's 7 edges (`Calc->LinAlg`, `Calc->Discr`, `LinAlg->ML`, `Discr->Algo`, `Discr->DB`, `DataSt->Algo`, `Algo->ML`) confirms each source appears before its target in that reversed order, exactly as Theorem 20.12 guarantees.

### Running time and where this shows up in practice

`TOPOLOGICAL-SORT` runs in Θ(V + E) time — the same bound as DFS itself, since the only addition to plain DFS is a single O(1) `push` per vertex when it finishes. Sedgewick and Wayne phrase the same fact slightly differently: their `Topological` client runs one DFS-based `DirectedCycle` pass to confirm the graph is acyclic and a second `DepthFirstOrder` pass to compute the ordering, so their stated bound is "time proportional to `V + E`" for two traversals rather than one — still linear, just with a constant-factor difference depending on whether cycle-checking is counted separately.

This linear bound is exactly why topological sort scales to real dependency graphs with no special-casing: a build system's target graph, a package manager's dependency graph, or a spreadsheet's cell-reference graph can all have thousands of vertices and edges, and a single linear DFS pass is enough to produce a build order, an install order, or a recalculation order that never uses something before it is ready.

## Trade-offs

- **Θ(V + E) time, identical to DFS** — topological sort adds no asymptotic cost over the traversal it's built on; the entire algorithm is DFS with one extra `push` per vertex at finish time, per CLRS's proof.
- **Only meaningful on a DAG, and the algorithm above does not check this itself** — `TopologicalOrder` as written will happily run on a cyclic graph and produce *some* reverse-postorder sequence, but it will not be a valid topological order (some edge is guaranteed to violate it, since the Theorem 20.12 argument depends on the "no gray `v`" case that only a DAG guarantees). Cycle detection via `DirectedCycle` — or Sedgewick and Wayne's own `Topological.isDAG()`, which returns `false` when its internal cycle check fails — has to run first.
- **DFS-based reverse postorder is not the only algorithm, and not the only valid ordering.** Sedgewick and Wayne mention an alternative, more intuitive approach: repeatedly find and remove a vertex with in-degree 0 (Kahn's algorithm, CLRS Exercise 20.4-5), which trades DFS's recursion for an explicit in-degree array and a queue of "ready" vertices — and detects cycles as a side effect (if the queue empties before every vertex is removed, a cycle remains). Neither algorithm produces *the* topological order — a DAG generally has many valid linearizations, and DFS reverse postorder is simply one of them, determined by traversal order and adjacency-list order.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 4.2 "Directed Graphs", topological sort ("Depth-first orders and topological sort"), pp. 575-584 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 20.4 "Topological sort", pp. 573-576 — book
- [Princeton Algorithms, 4th Ed. — Topological.java (companion site)](https://algs4.cs.princeton.edu/42digraph/Topological.java.html) — doc
