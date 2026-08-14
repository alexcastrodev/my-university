---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the *dynamic connectivity* problem — given a stream of "connect p to q" operations, answer "are p and q connected?" queries efficiently — and trace the union-find data structure through four successive refinements (quick-find, quick-union, weighted quick-union, weighted quick-union with path compression) that take it from O(n) per union down to amortized O(α(n)), effectively constant time for any n that could exist in practice.

## Use Cases

- Network and social-graph connectivity: "can site p reach site q through existing connections?" without recomputing the whole graph on every query.
- Kruskal's minimum-spanning-tree algorithm uses union-find to detect, in near-constant time, whether adding an edge would create a cycle.
- Image processing / percolation: grouping adjacent pixels or sites into connected regions (Sedgewick & Wayne's motivating example is literally percolation in physical chemistry).
- Compiler and language tooling: the earliest documented use (FORTRAN) was determining whether two declared variable names are equivalent references — an equivalence-class problem, exactly what union-find solves.

## Deep Dive

### The dynamic connectivity problem and quick-find

Sedgewick & Wayne frame the problem as reading a sequence of integer pairs `p q`, where "p is connected to q" is an equivalence relation (reflexive, symmetric, transitive), and filtering out pairs that are already implied by earlier ones. They specify the API as `UF(int N)`, `union(p, q)`, `find(p)`, `connected(p, q)`, `count()` — with `connected(p, q)` implemented everywhere as simply `find(p) == find(q)`.

The first implementation, **quick-find**, keeps a site-indexed array `id[]` where `id[i]` is always the *canonical* component identifier for site `i` — every site sharing a component has the same `id[]` value:

```java
public class QuickFindUF {
    private int[] id;

    public QuickFindUF(int n) {
        id = new int[n];
        for (int i = 0; i < n; i++) id[i] = i;
    }

    public int find(int p) { return id[p]; }

    public void union(int p, int q) {
        int pID = find(p);
        int qID = find(q);
        if (pID == qID) return;
        for (int i = 0; i < id.length; i++)
            if (id[i] == pID) id[i] = qID;
    }
}
```

`find` is a single array read — O(1). But `union` has to rewrite *every* entry currently tagged `pID` to `qID`, an O(n) scan of the whole array regardless of how small the two components are. Sedgewick & Wayne's Proposition F pins the cost at "between N+3 and 2N+1 array accesses" per merging union, and note that reducing a graph of N sites to one component requires at least N-1 unions — driving total cost toward Θ(N²). Their conclusion is blunt: quick-find "cannot feasibly solve" large dynamic-connectivity problems.

### Quick-union — and how a chain forms

**Quick-union** reinterprets the same array: `id[i]` is no longer a canonical id, it's a *parent pointer*. Each site links to another site in its component (possibly itself); `find` walks parent pointers up to a root — a site that is its own parent:

```java
public class QuickUnionUF {
    private int[] parent;

    public QuickUnionUF(int n) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
    }

    public int find(int p) {
        while (p != parent[p]) p = parent[p];
        return p;
    }

    public void union(int p, int q) {
        int rootP = find(p);
        int rootQ = find(q);
        if (rootP == rootQ) return;
        parent[rootP] = rootQ;
    }
}
```

`union` is now cheap — one root lookup on each side plus a single pointer rewrite. But nothing stops the resulting forest from growing tall and skinny, because the root being relinked is chosen arbitrarily (always `rootP`'s root, hanging under `rootQ`'s root). Sedgewick & Wayne construct exactly this worst case: feed in the pairs `0-1`, `0-2`, `0-3`, ... in order. Tracing the array by hand shows the chain build up:

```
union(0, 1): parent = [1, 1, 2, 3, 4]   // 0 -> 1
union(0, 2): parent = [1, 2, 2, 3, 4]   // find(0) walks 0->1, roots at 1; parent[1] = 2
union(0, 3): parent = [1, 2, 3, 3, 4]   // find(0) walks 0->1->2, roots at 2; parent[2] = 3
union(0, 4): parent = [1, 2, 3, 4, 4]   // find(0) walks 0->1->2->3, roots at 3; parent[3] = 4
```

After N-1 such unions the tree has height N-1 — site 0 is now N-1 hops from the root. Every subsequent `find(0)` costs O(N). The book's Proposition G makes this precise: `find` costs "1 plus twice the depth" of the node, so a sequence like this drives total cost to Θ(N²) in the worst case — no better than quick-find, just with the expense moved from `union` into `find`.

### Weighted quick-union by size

The fix Sedgewick & Wayne call **weighted quick-union**: track the size of each tree, and when unioning, always attach the *smaller* tree's root under the *larger* tree's root, rather than picking arbitrarily:

```java
public class WeightedQuickUnionUF {
    private int[] parent;
    private int[] size;
    private int count;

    public WeightedQuickUnionUF(int n) {
        count = n;
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
    }

    public int find(int p) {
        while (p != parent[p]) p = parent[p];
        return p;
    }

    public void union(int p, int q) {
        int rootP = find(p);
        int rootQ = find(q);
        if (rootP == rootQ) return;
        if (size[rootP] < size[rootQ]) { parent[rootP] = rootQ; size[rootQ] += size[rootP]; }
        else                            { parent[rootQ] = rootP; size[rootP] += size[rootQ]; }
        count--;
    }
}
```

Only the `union` method changed — `find` is identical to plain quick-union — yet this small change caps the height provably. The intuition behind Sedgewick & Wayne's Proposition H: every time a node's depth increases by 1 (because its tree got attached under another), the tree it now belongs to has at least *doubled* in size (since it was, by construction, no bigger than the tree it merged with). A tree can only double in size lg N times before it holds all N sites, so no node can ever end up deeper than lg N. That caps every `find`, `union`, and `connected` call at O(log N) in the worst case — a guarantee plain quick-union never had. Cormen's structurally identical heuristic on a linked-list representation (the "weighted-union heuristic," Theorem 19.1) proves the same doubling argument formally: a sequence of m operations, n of them `MAKE-SET`, costs O(m + n lg n).

### Path compression — flattening the tree during find

The final optimization stacks directly on top of weighted union: while `find` is already walking up to the root, make every node it passes through point *directly* to the root, flattening the tree for every future `find` on that path. Sedgewick & Wayne describe it as approximating quick-find's O(1) lookup without quick-find's O(n) union cost. A compact two-pass implementation:

```java
public int find(int p) {
    int root = p;
    while (root != parent[root]) root = parent[root];   // pass 1: locate the root
    while (p != root) {                                  // pass 2: flatten the path
        int next = parent[p];
        parent[p] = root;
        p = next;
    }
    return root;
}
```

Cormen presents the same idea recursively on the "union by rank" variant (rank is an upper bound on height, tracked instead of size, but the same "attach the shallower tree under the taller one" spirit):

```java
private int findSet(int x) {
    if (x != parent[x]) {
        parent[x] = findSet(parent[x]);   // path compression on the way back up
    }
    return parent[x];
}
```

The effect on a chain, before and after a single `find` call:

```
Before find(0):
index:   0  1  2  3  4
parent:  1  2  3  4  4     // 0 -> 1 -> 2 -> 3 -> 4 (root)

find(0) walks the chain to root 4, then relinks every node it visited:

After find(0):
index:   0  1  2  3  4
parent:  4  4  4  4  4     // every node points directly to the root
```

Every future `find` on 0, 1, 2, or 3 is now a single array access. Combined with weighted union, Cormen's Section 19.4 proves this yields worst-case running time **O(m·α(n))** for a sequence of m operations on n elements, where α is the inverse Ackermann function — a function that grows so slowly that α(n) ≤ 4 for any n up to roughly the number of atoms in the observable universe. Sedgewick & Wayne's own performance table states the same result more informally: weighted quick-union with path compression costs "very, very nearly, but not quite 1" array access per operation, amortized. Practically: for any n you could ever actually run this on, path compression plus weighted union is O(1) per operation.

## Trade-offs

- **Quick-find and plain quick-union are pedagogical stepping stones, not production choices** — quick-find is only competitive when `find`/`connected` calls vastly outnumber `union` calls (rare), and plain quick-union has no worst-case guarantee at all; Sedgewick & Wayne present both purely to motivate why weighting matters.
- **Weighting supplies the *worst-case* guarantee; path compression alone does not** — Cormen is explicit that union by rank *or* path compression alone each improve on the naive forest, but it's the *combination* that yields the O(m·α(n)) bound; skipping weighting and relying only on path compression leaves a theoretically weaker (though still very good) bound.
- **No algorithm can guarantee true worst-case O(1) per operation** — Sedgewick & Wayne note that under the general "cell-probe" model of computation, no union-find algorithm can guarantee amortized constant time for every operation; weighted quick-union with path compression is essentially the practical ceiling, not a proof that O(1) worst-case is achievable.
- **The JDK has no built-in union-find class** — unlike `TreeMap`/`TreeSet` riding on a red-black tree, there's no `java.util.UnionFind`; you implement the ~15-line array-backed structure yourself whenever an algorithm (Kruskal's MST, connected-components, cycle detection) needs it.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 1.5 "Case Study: Union-Find", pp. 216-231 — doc
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 19 "Data Structures for Disjoint Sets", Sections 19.1-19.4, pp. 520-533 — doc
- [Princeton Algorithms, 4th Ed. — Union-Find (companion site, with UF.java source)](https://algs4.cs.princeton.edu/15uf/) — doc
- [Disjoint-set data structure — Wikipedia](https://en.wikipedia.org/wiki/Disjoint-set_data_structure) — doc
