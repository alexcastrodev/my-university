---
version: 1.0
updatedAt: 2026-11-05
---
## Learning Objectives

- Define the chromatic number $\chi(G)$ and prove $\omega(G)\le\chi(G)\le\Delta(G)+1$, with graphs where each bound is far off.
- State Brooks' theorem with its hypotheses and show a failure when one is dropped.
- Show that greedy coloring depends on the vertex order, and test 2-colorability in linear time.
- Sketch the short five color proof and state the four color theorem with its proof history precisely.
- Place 3-colorability among the NP-complete problems.

## Context & Motivation

Scheduling exams so no student has two at once and assigning frequencies so overlapping radio stations differ are the same problem: put conflicting items in a graph and give adjacent vertices different labels, called colors, using as few as possible.

`planar-graphs` stated the four color theorem without proof and derived the key fact behind it: every simple planar graph has a vertex of degree at most 5. This lesson proves five colors from that fact and explains why four was so much harder.

## Core Theory

### Proper colorings and the chromatic number

A **proper coloring** with $k$ colors is a map $c:V\to\{1,\dots,k\}$ with $c(u)\neq c(v)$ for every edge $uv$. $G$ is **$k$-colorable** if one exists, and the **chromatic number** $\chi(G)$ is the least such $k$. Color classes are independent sets. Loops make coloring impossible and parallel edges change nothing, so graphs here are simple. Basic values: $\chi(K_n)=n$, an even cycle has $\chi=2$, an odd cycle has $\chi=3$.

Coloring splits along the structure of `graph-connectivity-cut-vertices-and-bridges`. $\chi(G)$ is the maximum of $\chi$ over the components, and if $G$ is the union of $G_1$ and $G_2$ sharing only a cut vertex $v$, then $\chi(G)=\max(\chi(G_1),\chi(G_2))$: color each part optimally, then rename the colors of $G_2$ so that $v$ gets the same color in both. The running graph of that lesson thus has $\chi=3$, from its triangle.

### The clique lower bound

A **clique** is a set of pairwise adjacent vertices, and $\omega(G)$ is the size of the largest. Clique vertices need distinct colors, so $\omega(G)\le\chi(G)$. The gap can be large: the Grötzsch graph (11 vertices, 20 edges, no triangle) has $\omega=2$ and $\chi=4$, and Erdős proved in 1959 that for every $k$ some graph has no cycle of length at most $k$ and $\chi>k$ (Diestel, Theorem 5.2.5).

### The greedy upper bound

**Greedy coloring**: fix an order $v_1,\dots,v_n$ and give each $v_i$ the smallest color not used by its already colored neighbors. When $v_i$ is reached, at most $\Delta(G)$ neighbors are colored, so one of $\Delta+1$ colors is free:

$$\chi(G)\le\Delta(G)+1\quad\text{for every graph, with any order.}$$

Equality holds for complete graphs and odd cycles. Only *earlier* neighbors count, so the **smallest-last** order (put a minimum-degree vertex last, delete it, repeat) helps; Diestel's Proposition 5.2.2 shows it gives $\chi(G)\le\max_{H\subseteq G}\delta(H)+1$. Since every subgraph of a simple planar graph has a vertex of degree at most 5, planar graphs are 6-colorable.

### Brooks' theorem

**Theorem (Brooks 1941).** Let $G$ be connected. If $G$ is neither a complete graph nor an odd cycle, then $\chi(G)\le\Delta(G)$.

So the greedy bound $\Delta+1$ is attained, among connected graphs, only by complete graphs and odd cycles. Each hypothesis matters:

- **Complete:** $K_4$ has $\Delta=3$ and $\chi=4$.
- **Odd cycle:** $C_5$ has $\Delta=2$ and $\chi=3$.
- **Connected:** the disjoint union of $K_4$ and $C_4$ is neither complete nor an odd cycle, has $\Delta=3$, and $\chi=4$. Apply the theorem per component.

Diestel credits Lovász (1973) with a proof that runs greedy coloring on a carefully chosen order.

### Order matters

For every graph some order makes greedy use exactly $\chi(G)$ colors: list the vertices class by class from an optimal coloring. A vertex of class $i$ has no earlier neighbor in its own class, and earlier neighbors from classes $1,\dots,i-1$ hold colors at most $i-1$ (by induction), so it receives a color at most $i$. Finding that order is as hard as finding the coloring, and a bad order can be arbitrarily worse (Example 2).

### Two colors: bipartite graphs

A graph with at least one edge has $\chi=2$ exactly when it is bipartite, and Lehman, Leighton and Meyer prove that a graph is 2-colorable if and only if it has no odd cycle. The test runs in $O(V+E)$: in each component, color a vertex by the parity of its BFS distance from a start vertex. If an edge joins two vertices of the same color, the two BFS paths to its ends plus that edge form a closed walk of odd length, which contains an odd cycle. The Princeton `Bipartite.java` does the same with DFS.

### Five colors with a short proof

**Theorem.** Every planar graph is 5-colorable.

The proof in Lehman, Leighton and Meyer is a strong induction on the number of vertices, using that deleting a vertex or merging two adjacent vertices keeps a graph planar. Take a vertex $g$ of degree at most 5, from the `planar-graphs` lemma.

- If $\deg g<5$, color $G-g$ by induction; $g$ sees at most four colors, so a fifth is free.
- If $\deg g=5$, two neighbors $n_1,n_2$ are non-adjacent, since five pairwise adjacent neighbors would form $K_5$, which is not planar. Merge $n_1$, $g$ and $n_2$ into one vertex, which keeps the graph planar and removes two vertices. Color the smaller graph by induction, give $n_1$ and $n_2$ the merged vertex's color, and $g$'s five neighbors now use at most four colors, so $g$ takes the fifth.

Why not four colors? The same trick handles $\deg g\le4$ with four colors, but a planar graph may have every degree equal to 5 (Example 4). At degree 5 the neighbors may use all four colors even after one merge, and the argument would need two merges at once, which nothing guarantees. Kempe's 1879 attempt at four colors failed at this degree-5 case, in a step that swaps colors along two-colored chains: swapping one chain can scramble another, which Kempe missed (Gonthier's account). Heawood found the error in 1890 and turned the argument into a proof of five colors (Diestel's notes).

### The four color theorem

**Theorem.** Every planar graph is 4-colorable. For maps: the regions of a map can be colored with four colors so that regions sharing a boundary segment (not just a point) differ, provided each region is one connected piece. Regions in several pieces can require more colors.

The proof history, from the open accounts listed below:

- Francis Guthrie raised the question in 1852. Kempe's 1879 proof was wrong (Heawood, 1890).
- Kenneth Appel and Wolfgang Haken announced a proof in 1976 and published it in 1977 in two parts in the Illinois Journal of Mathematics, the second with Koch. The method: exhibit an **unavoidable** set of configurations (one of them must appear in any minimal counterexample, shown by "discharging") and prove each one **reducible** (it cannot appear in a minimal counterexample). Reducibility was checked by computer, over more than a thousand configurations, and the unavoidability part, done by hand, was itself large; Gonthier describes it as 10,000 cases, difficult to verify, in which several small errors were found.
- Robertson, Sanders, Seymour and Thomas gave a new proof, published in 1997 after an announcement in 1996, with 633 reducible configurations and 32 discharging rules. Reducibility still needs a computer. Their method also yields a quadratic-time algorithm to 4-color a planar graph.
- Georges Gonthier wrote a formal proof checked by the Coq proof assistant, following Robertson et al. and covering both the mathematical and the computational parts, as his report linked below describes. What remains to trust is general-purpose software and hardware, not programs written for this theorem.

### Why computing the chromatic number is hard

- **2 colors:** linear time, by the bipartite test.
- **3 colors:** deciding 3-colorability is NP-complete, and Lehman, Leighton and Meyer note that this remains true for planar graphs. A proposed coloring is checked edge by edge, which is why `np-completeness-and-cook-levin` lists 3-colorability among the problems in NP; hardness comes from a reduction in the style of `proving-np-completeness-via-reduction`.
- **$k\ge3$ colors:** also NP-complete. Adding $k-3$ new vertices, adjacent to each other and to every old vertex, turns a 3-coloring question into a $k$-coloring question.
- **Planar, 4 colors:** always yes, and a coloring is found in polynomial time.

So computing $\chi$ is NP-hard; brute force over $3^n$ assignments is already $3^{30}\approx2.06\times10^{14}$ at $n=30$.

## Worked Examples

### Example 1: the bounds on nine graphs

$\chi$ was computed by exhaustive backtracking, $\omega$ from the maximal cliques (networkx 3.4.2). The last column is Brooks' bound when its hypotheses hold.

| graph | $n$ | $m$ | $\omega$ | $\chi$ | $\Delta+1$ | Brooks |
|---|---|---|---|---|---|---|
| $K_4$ | 4 | 6 | 4 | 4 | 4 | complete |
| $C_5$ | 5 | 5 | 2 | 3 | 3 | odd cycle |
| $C_6$ | 6 | 6 | 2 | 2 | 3 | $\le2$ |
| star $K_{1,6}$ | 7 | 6 | 2 | 2 | 7 | $\le6$ |
| $K_{3,3}$ | 6 | 9 | 2 | 2 | 4 | $\le3$ |
| wheel (hub + $C_5$) | 6 | 10 | 3 | 4 | 6 | $\le5$ |
| Petersen | 10 | 15 | 2 | 3 | 4 | $\le3$ |
| Grötzsch | 11 | 20 | 2 | 4 | 6 | $\le5$ |
| icosahedron | 12 | 30 | 3 | 4 | 6 | $\le5$ |

The star shows how loose $\Delta+1$ can be (7 against 2), the Grötzsch graph how loose $\omega$ can be (2 against 4). The planar wheel and icosahedron need four colors, so four cannot be improved to three.

### Example 2: greedy order on a path and a crown

On the path $1$-$2$-$3$-$4$, the order $1,2,3,4$ gives colors $1,2,1,2$. The order $1,4,2,3$ gives $1$ and $4$ color 1, $2$ color 2, and then $3$ sees colors 2 and 1, so it takes color 3: three colors on a bipartite graph.

The **crown graph** on $a_1,\dots,a_n,b_1,\dots,b_n$ has an edge $a_ib_j$ for every $i\neq j$. It is bipartite. With $n=4$ (12 edges) and the order $a_1,b_1,a_2,b_2,a_3,b_3,a_4,b_4$, each pair $a_i,b_i$ is non-adjacent but sees every earlier color, so greedy gives $a_i$ and $b_i$ color $i$ and uses 4 colors. The order $a_1,\dots,a_4,b_1,\dots,b_4$ uses 2. Over all $8!=40{,}320$ orders, 30,240 give 2 colors, 7,200 give 3 and 2,880 give 4. With $n$ pairs the bad order uses $n$ colors (an exercise in Diestel). networkx's `greedy_color` strategies `largest_first`, `smallest_last` and `DSATUR` used 2 colors on the crowns with $n=3,4,5$, but no polynomial-time ordering rule is optimal on every graph unless P = NP.

### Example 3: the 2-coloring test on $C_5$

Label the cycle $0$-$1$-$2$-$3$-$4$-$0$ and run BFS from $0$ with color 0. Vertices $1$ and $4$ get color 1; then $2$ (from $1$) and $3$ (from $4$) get color 0. The edge $2$-$3$ joins two vertices of color 0. The BFS paths $0,1,2$ and $0,4,3$ plus that edge form the closed walk $0,1,2,3,4,0$ of length 5, an odd cycle, which certifies that no 2-coloring exists.

### Example 4: the five color step on the icosahedron

The icosahedron is planar with every vertex of degree exactly 5, so the low-degree lemma is tight and the proof must use its second case. In networkx's labeling, vertex $0$ has neighbors $1,5,7,8,11$, which induce a 5-cycle; the non-adjacent pairs are $\{1,7\},\{1,11\},\{5,7\},\{5,8\},\{8,11\}$. Merging $1$, $0$ and $7$ gives a graph with 10 vertices that `check_planarity` confirms is planar and whose chromatic number is 4. Giving $1$ and $7$ the merged color leaves vertex $0$ facing at most four colors, so a fifth is free. (The icosahedron itself has $\chi=4$; smallest-last greedy found a 4-coloring.)

## Common Misconceptions & Pitfalls

- **"Greedy coloring finds $\chi$."** It depends on the order: 3 colors on a path, 4 on a bipartite crown (Example 2).
- **"$\chi\le\Delta$ for every graph."** Brooks needs connected, not complete and not an odd cycle; $K_4$, $C_5$ and $K_4\cup C_4$ break it.
- **"Every planar graph needs four colors."** At most four. Trees with an edge need two; the theorem bounds the maximum.
- **"The four color theorem is just a computer search."** The computer checks the reducibility of a finite set of configurations chosen by a mathematical argument, and the whole proof has since been checked formally in Coq.
- **"Planar graphs are 4-colorable, so 3-coloring them is easy."** Deciding planar 3-colorability is NP-complete.
- **"A compiler computes $\chi$ of the interference graph."** `register-allocation-via-graph-coloring` colors with $K$ colors, one per machine register, using a removal order and spilling a value to memory when no safe node remains.

## Summary

$\chi(G)$ is the fewest colors that give adjacent vertices different colors, and it splits over components and cut vertices. Cliques give $\omega\le\chi$, greedy coloring gives $\chi\le\Delta+1$ in any order, and both can be far from $\chi$. Brooks lowers the upper bound to $\Delta$ for connected graphs that are neither complete nor odd cycles. Greedy depends on the order: some order is optimal, a bad one uses $n$ colors on a bipartite graph. Two colors suffice exactly when there is no odd cycle, testable in linear time. Planar graphs are 5-colorable by a short induction; four colors took Appel and Haken's computer-assisted proof, the shorter proof of Robertson, Sanders, Seymour and Thomas, and Gonthier's formal verification. Deciding 3-colorability is NP-complete even for planar graphs, so computing $\chi$ is NP-hard. `register-allocation-via-graph-coloring` applies coloring with a fixed number of registers.

## Documentation Links

- [Lehman, Leighton and Meyer, Mathematics for Computer Science](https://people.csail.mit.edu/meyer/mcs.pdf): Sections 11.7 and 11.9.2 on coloring, the degree bound and 2-colorability, and Section 12.6 with the five color proof.
- [Diestel, Graph Theory, Chapter 5 (free preview)](https://www.math.uni-hamburg.de/home/diestel/books/graph.theory/preview/Ch5.pdf): the five color theorem, greedy coloring, Brooks' theorem, and notes on the four color history.
- [Robin Thomas, The Four Color Theorem](https://thomas.math.gatech.edu/FC/fourcolor.html): history, the 1997 proof with 633 configurations and 32 discharging rules, and the quadratic algorithm.
- [Gonthier, A computer-checked proof of the Four Color Theorem](https://inria.hal.science/hal-04034866/document): the Coq formalization, with an account of Kempe's argument and of the earlier proofs.
- [rocq-community, fourcolor](https://github.com/rocq-community/fourcolor): the maintained formal proof and its related publications.
- [Sedgewick and Wayne, Algorithms, 4.1 Undirected Graphs](https://algs4.cs.princeton.edu/41graph/): two-colorability by depth-first search in linear time.
- [NetworkX, greedy_color](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.coloring.greedy_color.html): the greedy strategies used in Example 2.
