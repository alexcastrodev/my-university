---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn the all-pairs shortest-paths problem — finding the shortest path between *every* pair of vertices in a weighted, directed graph simultaneously, rather than from one fixed source — and the Floyd-Warshall algorithm that solves it in Θ(V³) time. Floyd-Warshall is a dynamic-programming algorithm before it is a graph algorithm: it never traverses the graph in the usual visit-a-node / follow-an-edge sense, it iteratively fills a V×V distance matrix, exactly the "characterize an optimal solution, define it recursively, compute it bottom-up" recipe the Dynamic Programming Fundamentals concept lays out. This concept assumes you already have that DP vocabulary (memoization vs. tabulation, optimal substructure, overlapping subproblems) from that concept and does not re-derive it — the one new idea here is Floyd-Warshall's specific recurrence, which restricts a shortest path's *intermediate vertices* to a growing prefix `{1, ..., k}` of the vertex set instead of restricting edge count or anything graph-traversal-shaped.

## Use Cases

- Precomputing a full distance/routing table once (e.g., for a road network, service mesh, or flight-connection graph) so that any later "shortest path from A to B" query is an O(1) table lookup instead of a fresh search.
- Dense graphs, where edge count E is close to V² — Floyd-Warshall's flat Θ(V³) cost, which doesn't depend on E at all, beats running a single-source algorithm once per vertex.
- Detecting whether a graph has any negative-weight cycle at all, as a byproduct of a single Θ(V³) pass, without needing to know in advance which vertex the cycle touches.
- Computing the *transitive closure* of a directed graph (does any path from `i` to `j` exist, ignoring weights) — CLRS presents this as the same recurrence with logical OR/AND in place of min/+, immediately after Floyd-Warshall in the same chapter section.

## Deep Dive

### All-pairs vs. repeated single-source: why this isn't just "Bellman-Ford in a loop"

Dijkstra's algorithm, Bellman-Ford, and the DAG shortest-path algorithm all solve the **single-source** shortest-paths problem: given one starting vertex `s`, find the shortest path from `s` to every other vertex. A perfectly valid way to get **all-pairs** shortest paths out of any of them is to just run one V times, once with each vertex as the source. Since Floyd-Warshall tolerates negative edge weights (as long as there's no negative cycle), the fair single-source algorithm to compare against is Bellman-Ford, not Dijkstra (which requires non-negative weights). Bellman-Ford runs in O(VE) time per source, so calling it once per vertex costs O(V · VE) = O(V²E) overall. Floyd-Warshall costs O(V³), a bound that doesn't mention E at all.

Setting the two bounds against each other shows exactly where each one wins:

- **Sparse graphs** (`E` close to `V`, e.g. `E = O(V)`): `V²E = O(V³)` — the same order as Floyd-Warshall. Repeated Bellman-Ford is competitive here, and either can be reasonable; Floyd-Warshall usually still wins on constant factors, since its body is three clean nested loops with O(1) work per iteration, versus Bellman-Ford's per-source relaxation bookkeeping repeated V times.
- **Dense graphs** (`E` close to `V²`, i.e., `E = Θ(V²)`): `V²E = O(V⁴)`, which is asymptotically *worse* than Floyd-Warshall's `O(V³)`. This is the regime where Floyd-Warshall's ignorance of `E` stops being a hidden cost and becomes a genuine win — the denser the graph, the further ahead it pulls.

CLRS actually presents Floyd-Warshall as the *second* dynamic-programming solution to all-pairs shortest paths in Chapter 23. Section 23.1 develops one first, using a different subproblem shape: `l_ij^(r)` is the shortest path from `i` to `j` using **at most `r` edges**, computed by a repeated "matrix multiplication" that costs Θ(V⁴) naively (`SLOW-APSP`) or Θ(V³ lg V) with repeated squaring (`FASTER-APSP`). Floyd-Warshall (Section 23.2) improves on both by characterizing the subproblem differently — by restricted *intermediate vertex set* rather than by edge count — which gets the exponent down to a flat 3 with no log factor.

### The DP recurrence: shortest paths restricted to a growing set of intermediate vertices

Number the vertices `1, 2, ..., n`. For a simple path `p = <v1, v2, ..., vl>`, an **intermediate vertex** is any vertex of `p` other than the endpoints `v1` and `vl` — precisely `{v2, ..., v(l-1)}`. Endpoints are never counted as intermediate, even if they happen to also appear elsewhere in the vertex numbering.

Define `d[i][j]^(k)` as the weight of a shortest path from vertex `i` to vertex `j` where every intermediate vertex on that path is drawn from the set `{1, ..., k}`. The base case, `k = 0`, allows no intermediate vertices at all, so the only paths available are the direct edge (or no edge):

```
d[i][j]^(0) = w(i, j)   // the direct edge weight, 0 if i == j, ∞ if no edge (i, j)
```

For `k >= 1`, take a shortest path `p` from `i` to `j` whose intermediates are drawn from `{1, ..., k}`, and ask whether `k` itself is one of those intermediates:

- **`k` is not an intermediate vertex of `p`** — then every intermediate of `p` is already drawn from the smaller set `{1, ..., k-1}`, so this case contributes nothing new: `d[i][j]^(k-1)`.
- **`k` is an intermediate vertex of `p`** — decompose `p` into an `i -> k` segment and a `k -> j` segment. Because subpaths of shortest paths are themselves shortest paths (the same optimal-substructure argument used throughout Chapter 22/23), and `k` cannot be an intermediate of either segment without making `p` revisit `k`, both segments have all their own intermediates drawn from the strictly smaller set `{1, ..., k-1}`. That segment pair is exactly `d[i][k]^(k-1) + d[k][j]^(k-1)`.

Taking the better of the two cases gives the Floyd-Warshall recurrence:

```
d[i][j]^(k) = min( d[i][j]^(k-1),  d[i][k]^(k-1) + d[k][j]^(k-1) )
```

By the time `k = n`, every vertex is a legal intermediate, so `d[i][j]^(n)` is the true shortest-path weight `δ(i, j)` for every pair — the algorithm computes all of them together, one full matrix at a time, for `k = 1, 2, ..., n`.

### The algorithm, in-place matrix update, and a worked example

Because `d^(k)` only ever depends on `d^(k-1)`, there is no need to keep `n` separate matrices around — a single 2D array can be updated in place, dropping the naive Θ(n³) *space* down to Θ(n²). This works because overwriting row `k` or column `k` during iteration `k` doesn't corrupt anything: `d[i][k]` and `d[k][j]` are unaffected by using `k` as their own intermediate (`d[k][k] = 0` in the absence of a negative cycle, so `d[i][k] + d[k][k] = d[i][k]`, no change). CLRS makes this the basis of exercise 23.2-4, which drops the superscripts from the pseudocode entirely and confirms the simplified, in-place version is still correct — that's the version worth actually writing:

```java
static final int INF = Integer.MAX_VALUE / 2; // avoid overflow when adding two "infinities"

static int[][] floydWarshall(int[][] w, int n) {
    int[][] d = new int[n][n];
    for (int i = 0; i < n; i++) {
        d[i] = w[i].clone();
    }
    for (int k = 0; k < n; k++) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (d[i][k] + d[k][j] < d[i][j]) {
                    d[i][j] = d[i][k] + d[k][j];
                }
            }
        }
    }
    return d; // d[i][j] is now the shortest-path weight from i to j
}
```

Three nested loops, each running `n` times, O(1) work in the innermost body — Θ(V³) total, exactly as the triple loop shape suggests, and no elaborate data structure involved.

Trace it on a small 4-vertex directed graph (vertices numbered 1-4, `∞` meaning no direct edge):

```
1 -> 2 (weight 3)      3 -> 2 (weight 4)
1 -> 3 (weight 8)      4 -> 1 (weight 2)
2 -> 4 (weight 1)      4 -> 3 (weight 5)
```

`d^(0)`, the direct-edge matrix (row = `i`, column = `j`):

| d⁽⁰⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | ∞ |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | ∞ |
| **4** | 2 | ∞ | 5 | 0 |

After `k = 1` (paths may now route through vertex 1 — e.g. `4 -> 1 -> 2` beats the missing direct `4 -> 2` edge):

| d⁽¹⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | ∞ |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | ∞ |
| **4** | 2 | 5 | 5 | 0 |

After `k = 2` (routing through vertex 2 — e.g. `1 -> 2 -> 4` beats the missing direct `1 -> 4` edge):

| d⁽²⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

After `k = 3` (routing through vertex 3 helps no pair here — `3` has only one outgoing edge, to `2`, and every route through it is already beaten, so the matrix is unchanged):

| d⁽³⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | ∞ | 0 | ∞ | 1 |
| **3** | ∞ | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

After `k = 4` (final matrix — routing through vertex 4 finally connects `2` and `3` back to `1`, e.g. `2 -> 4 -> 1` and `3 -> 2 -> 4 -> 1`):

| d⁽⁴⁾ | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| **1** | 0 | 3 | 8 | 4 |
| **2** | 3 | 0 | 6 | 1 |
| **3** | 7 | 4 | 0 | 5 |
| **4** | 2 | 5 | 5 | 0 |

`d[3][1] = 7` reads as the path `3 -> 2 -> 4 -> 1` (`4 + 1 + 2 = 7`) — cheaper than any path that skips vertex 4, since `3` has no other way back toward `1`. `d[2][3] = 6` reads as `2 -> 4 -> 3` (`1 + 5 = 6`), found only once vertex 4 became an available intermediate at `k = 4`.

### Negative cycles and reconstructing the actual path

Like Bellman-Ford, Floyd-Warshall handles negative-weight *edges* correctly, but it breaks down — produces a meaningless result — if the graph has a negative-weight **cycle**: with a negative cycle reachable between some pair, there is no well-defined shortest simple path (you can keep looping to drive the weight arbitrarily low), which contradicts the finite-path assumption the whole `d[i][j]^(k)` recurrence relies on.

Detecting a negative cycle from the finished matrix is cheap and needs no extra pass: every `d[i][i]` starts at `0` (the empty path from `i` to itself), so if any diagonal entry `d[i][i]` comes out **negative** after the algorithm runs, it means there is a path from `i` back to `i` with negative total weight — a negative cycle through `i`.

Recovering the actual shortest *paths*, not just their weights, needs one more piece of bookkeeping: a predecessor matrix `Π`, updated by the same triple loop alongside `D`, where `π[i][j]` records the predecessor of `j` on the current best `i -> j` path; walking `π` backward from `j` to `i` after the algorithm finishes prints the path itself (CLRS Section 23.2, "Constructing a shortest path").

## Trade-offs

- **Flat O(V³) vs. density-dependent O(V²E)** — Floyd-Warshall's cost never looks at `E`, which is a liability on sparse graphs (you pay for all `V²` pairs even if most are unreachable) but becomes a decisive advantage as the graph approaches dense (`E → V²`), where V-times-Bellman-Ford's `O(V²E)` degrades toward `O(V⁴)`.
- **Θ(V²) space no matter how sparse the graph is** — because the algorithm operates on a dense distance matrix rather than an adjacency list, it always pays `V²` memory, even for a graph with only `O(V)` edges; a single-source algorithm running off an adjacency list would use far less space per run on a sparse graph.
- **Negative edges are fine, negative cycles are not — and the algorithm doesn't warn you by itself** — it silently produces a matrix that looks like an answer even when a negative cycle makes the "shortest path" concept undefined; checking the diagonal for a negative entry afterward is a required, separate step, not something the triple loop does for you.
- **Weights only vs. weights and paths** — the code above returns only `d[i][j]` values; recovering actual routes costs another Θ(V²) predecessor matrix `Π` maintained in lockstep, the same "how much vs. how" trade-off the Dynamic Programming Fundamentals concept flags for rod cutting's `s[]` array — easy to bolt on, easy to forget if the requirement quietly needs the path itself.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 23.1 "Shortest paths and matrix multiplication", pp. 648-654 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 23.2 "The Floyd-Warshall algorithm", pp. 655-662 — book
- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
