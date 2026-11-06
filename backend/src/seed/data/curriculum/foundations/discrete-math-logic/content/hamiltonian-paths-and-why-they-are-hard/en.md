---
version: 1.0
updatedAt: 2026-11-05
---
## Learning Objectives

- Define Hamiltonian paths and cycles and contrast them with the Euler trails and circuits of `euler-paths-and-circuits`.
- Explain, with two 3-regular graphs on 10 vertices, why no test based on degrees can decide whether a graph is Hamiltonian, and what NP-completeness adds to that.
- State and prove Ore's theorem, derive Dirac's theorem from it, and show what goes wrong when a hypothesis is missing.
- Recognize Dirac's and Ore's conditions as sufficient but not necessary, using Hamiltonian graphs that violate both.
- Connect Hamiltonian cycles to the traveling salesman problem and count the work of brute force against the Held-Karp dynamic program.

## Context & Motivation

William Rowan Hamilton outlined his icosian game in letters to John T. Graves in late 1856, showed it at the 1857 Dublin meeting of the British Association, and the toy maker Jaques and Son sold it from 1859. The goal was a closed route along the edges of a dodecahedron through each of its 20 corners exactly once. Hamilton was not the first: knight's tours on a chessboard are centuries older, and Thomas Kirkman was studying such cycles on polyhedra at about the same time.

This is Euler's question with vertices in place of edges. Euler's version has a complete answer: a pass over the degrees plus a connectivity check. The vertex version has no such answer, and the reason is not that nobody looked: in 1972 Richard Karp put it on his list of NP-complete problems, so a fast test of any kind would settle P versus NP. The theory offers instead sufficient conditions, which certify some graphs and say nothing about the rest, and exact algorithms that are exponential but far better than trying every order.

## Core Theory

### Definitions, and the contrast with Euler

In a graph on $n$ vertices, a **Hamiltonian path** is a path (no repeated vertex) that visits every vertex. A **Hamiltonian cycle** is a cycle through every vertex, which needs $n\ge3$. A graph with a Hamiltonian cycle is **Hamiltonian**. Graphs here are simple: a cycle on at least 3 vertices never uses a loop or two edges between the same pair, so multigraphs add nothing.

The two properties are independent. The Königsberg multigraph from `euler-paths-and-circuits` has no Euler trail, yet its underlying simple graph has the Hamiltonian cycle $A,B,D,C,A$ (a cycle uses at most one edge of each parallel pair). The **bowtie**, two triangles sharing one vertex, has all degrees even (2, 2, 2, 2, 4) and so has an Euler circuit, but no Hamiltonian cycle: the shared vertex separates the two triangles, and a cycle covering both sides would have to pass through it twice.

This is why Euler's proof does not carry over: an Euler circuit may visit a vertex any number of times, the local constraint is only a parity, and Hierholzer glues closed trails at shared vertices. A Hamiltonian cycle uses exactly two edges per vertex, the choice at one vertex constrains all the others, and gluing at a shared vertex is exactly what is forbidden.

### Why there is no degree test

**Degrees do not determine the answer.** The Petersen graph and the pentagonal prism (two 5-cycles joined by a perfect matching, the circular ladder on 10 vertices) both have 10 vertices and 15 edges, are connected, and every vertex has degree 3. Example 1 counts their Hamiltonian cycles by exhaustive search: the prism has 5, the Petersen graph has none. Any test that looks only at the degree sequence must give both graphs the same answer, so it is wrong on one of them. This argument is unconditional, but it only rules out tests that read degrees.

**No fast test of any kind, unless P = NP.** Deciding whether a graph has a Hamiltonian cycle is in NP: the certificate is the vertex order, and checking it means confirming that each vertex appears once and that $n$ consecutive pairs are edges. In his 1972 paper *Reducibility Among Combinatorial Problems*, Karp proved 21 problems NP-complete by reductions starting from satisfiability; two of them are Directed Hamilton Circuit (reduced from vertex cover) and Undirected Hamilton Circuit (reduced from the directed one). Hamiltonian path is NP-complete as well, through simple reductions between the path and cycle versions. Euler's condition is checked in $O(n+m)$ time. A polynomial-time test for Hamiltonicity, reading degrees or anything else, would put an NP-complete problem in P and give P = NP. So unless P = NP, no characterization is as easy to check as Euler's.

### Ore's theorem and Dirac's theorem

**Theorem (Ore, 1960).** Let $G$ be a simple graph with $n\ge3$ vertices such that $\deg(u)+\deg(v)\ge n$ for every pair of distinct non-adjacent vertices $u,v$. Then $G$ is Hamiltonian.

*Proof.* Suppose $G$ satisfies the condition but is not Hamiltonian. Add edges one at a time as long as the graph stays non-Hamiltonian, until no more can be added; call the result $H$. Adding edges only raises degrees, so $H$ still satisfies the condition. $H$ is not complete, because $K_n$ is Hamiltonian for $n\ge3$. Pick non-adjacent $x,y$ in $H$. Adding $xy$ creates a Hamiltonian cycle, which must use $xy$, so $H$ has a Hamiltonian path $x=v_1,v_2,\dots,v_n=y$.

Let $S=\{i: xv_{i+1}\in E(H)\}$ and $T=\{i: v_iy\in E(H)\}$. Both are subsets of $\{1,\dots,n-1\}$, with $\lvert S\rvert=\deg(x)$ and $\lvert T\rvert=\deg(y)$. Since $\deg(x)+\deg(y)\ge n>n-1$, some index $i$ lies in both. Then

$$v_1,v_2,\dots,v_i,\ v_n,v_{n-1},\dots,v_{i+1},\ v_1$$

is a Hamiltonian cycle in $H$: it uses the edges $v_iv_n$ and $v_{i+1}v_1$ and otherwise follows the path. That contradicts the choice of $H$. ∎

**Theorem (Dirac, 1952).** Every simple graph with $n\ge3$ vertices and minimum degree $\delta(G)\ge n/2$ is Hamiltonian.

*Proof.* Any two vertices have degree sum at least $n/2+n/2=n$, so Ore's condition holds. ∎ Diestel proves it directly from a longest path.

**When a hypothesis is missing, the conclusion can fail.**

- *$n\ge3$:* $K_2$ has $\delta=1=n/2$ and no cycle at all.
- *The bound $n/2$:* for odd $n$, take two copies of $K_{(n+1)/2}$ sharing one vertex. Then $\delta=(n-1)/2$, just below $n/2$, and the shared vertex separates the graph, so there is no Hamiltonian cycle. For $n=5$ this is the bowtie, whose non-adjacent pairs have degree sum $4=n-1$; for $n=7$ it is two $K_4$ sharing a vertex, with $\delta=3$. $K_{2,3}$, with $\delta=2$ and degree sum 4 on its non-adjacent pairs of degree-2 vertices, is not Hamiltonian either.

**Sufficient, not necessary.** The cycle $C_n$ with $n\ge5$ is Hamiltonian, yet $\delta=2<n/2$ and its non-adjacent pairs have degree sum $4<n$. Hamilton's own dodecahedron violates both conditions badly (degree 3 everywhere, $n=20$) and has 30 Hamiltonian cycles, a count computed in Example 2. Both theorems certify dense graphs; sparse Hamiltonian graphs slip past them.

### Hamiltonian cycles and the traveling salesman problem

The **traveling salesman problem** (TSP) gives a complete graph with edge weights and asks for a Hamiltonian cycle of minimum total weight. Hamiltonian cycle reduces to it: give weight 1 to the edges of $G$ and 2 to the missing pairs, and $G$ is Hamiltonian exactly when the optimum tour costs $n$. `the-traveling-salesman-problem-a-case-study-in-np-hardness` carries out that reduction in full.

**Brute force.** Fix vertex 0 as the start. Each of the $(n-1)!$ orders of the other vertices gives a tour, and each tour appears twice (once per direction), so there are $(n-1)!/2$ tours. Summing a tour's $n$ weights takes $n-1$ additions.

**Held-Karp.** Proposed independently in 1962 by Bellman and by Held and Karp, it solves subproblems instead of tours. For a set $S$ of vertices not containing 0 and some $e\in S$, let $g(S,e)$ be the cheapest path that starts at 0, visits exactly the vertices of $S$, and ends at $e$. Then

$$g(\{e\},e)=d(0,e),\qquad g(S,e)=\min_{p\in S\setminus\{e\}}\big(g(S\setminus\{e\},p)+d(p,e)\big),$$

and the optimum is $\min_{e\neq0}\big(g(V\setminus\{0\},e)+d(e,0)\big)$. Only where the path ends matters, not its order inside $S$, and that is the whole saving. There are $(n-1)2^{n-2}$ values $g(S,e)$; a set of size $s$ costs $s-1$ additions per end vertex, and summing $\binom{n-1}{s}s(s-1)$ over $s$ gives $(n-1)(n-2)2^{n-3}$, plus $n-1$ for the final step. That is $\Theta(n^22^n)$ time and $\Theta(n2^n)$ memory. Replacing "min of sums" by "or of ands" decides Hamiltonicity in the same $O(n^22^n)$ time.

## Worked Examples

### Example 1: same degrees, different answers

```python
import itertools, networkx as nx

def hamiltonian_cycles(G):
    first, *rest = sorted(G)
    count = 0
    for order in itertools.permutations(rest):
        if order[0] > order[-1]:          # each cycle appears twice, once per direction
            continue
        cycle = (first, *order, first)
        count += all(G.has_edge(a, b) for a, b in zip(cycle, cycle[1:]))
    return count

for name, G in [("prism", nx.circular_ladder_graph(5)), ("Petersen", nx.petersen_graph())]:
    degrees = sorted({d for _, d in G.degree()})
    print(name, G.number_of_nodes(), G.number_of_edges(), degrees, hamiltonian_cycles(G))
# prism 10 15 [3] 5
# Petersen 10 15 [3] 0
```

### Example 2: testing Ore and Dirac

Here $\sigma$ is the smallest degree sum over non-adjacent pairs, so Ore's condition is $\sigma\ge n$ and Dirac's is $\delta\ge n/2$. "Hamiltonian" comes from exhaustive search, and for the dodecahedron from a subset dynamic program that counts paths with the Held-Karp recurrence.

| Graph | $n$ | $\delta$ | $\sigma$ | Dirac | Ore | Hamiltonian cycles |
|---|---|---|---|---|---|---|
| $K_4$ on $1,2,3,4$ plus vertex 5 joined to 3 and 4 | 5 | 2 | 5 | no | yes | 2 |
| bowtie | 5 | 2 | 4 | no | no | 0 |
| $K_{2,3}$ | 5 | 2 | 4 | no | no | 0 |
| $C_6$ | 6 | 2 | 4 | no | no | 1 |
| $K_{3,3}$ | 6 | 3 | 6 | yes | yes | 6 |
| dodecahedron | 20 | 3 | 6 | no | no | 30 |

The first row is where Ore beats Dirac: vertex 5 has degree $2<5/2$, but its only non-adjacent partners, 1 and 2, have degree 3, so both sums are $3+2=5=n$. One of its two cycles is $5,3,1,2,4,5$.

How much do the conditions cover? The networkx graph atlas lists every graph up to 7 vertices, and the same search over the connected ones gives:

| $n$ | connected graphs | Hamiltonian | satisfy Ore | satisfy Dirac |
|---|---|---|---|---|
| 5 | 21 | 8 | 5 | 3 |
| 6 | 112 | 48 | 21 | 19 |
| 7 | 853 | 383 | 68 | 29 |

At $n=7$, Ore certifies 68 of the 383 Hamiltonian graphs and Dirac 29. Every graph that satisfies a condition is Hamiltonian, as the theorems promise, and for $n=6$ and $n=7$ most Hamiltonian graphs satisfy neither.

### Example 3: brute force against Held-Karp, counted

```python
from itertools import combinations, permutations

def held_karp(d):
    n = len(d)
    g = {(1 << k, k): d[0][k] for k in range(1, n)}        # paths 0 -> k
    for size in range(2, n):
        for S in combinations(range(1, n), size):
            mask = sum(1 << k for k in S)
            for e in S:
                prev = mask ^ (1 << e)
                g[(mask, e)] = min(g[(prev, p)] + d[p][e] for p in S if p != e)
    full = (1 << n) - 2                                     # every vertex except 0
    return min(g[(full, e)] + d[e][0] for e in range(1, n))

def brute_force(d):
    def length(order):
        tour = (0, *order, 0)
        return sum(d[a][b] for a, b in zip(tour, tour[1:]))
    return min(length(p) for p in permutations(range(1, len(d))) if p[0] < p[-1])
```

For each $n$ from 4 to 10, take $n$ points from `numpy.random.default_rng(n).random((n, 2))` with Euclidean distances. Both functions return the same optimum on all seven instances. Counting additions with a counter in each loop (and $n-1$ per brute-force tour) matches the formulas exactly:

| $n$ | tours $(n-1)!/2$ | brute-force additions | Held-Karp values $g(S,e)$ | Held-Karp additions |
|---|---|---|---|---|
| 4 | 3 | 9 | 12 | 15 |
| 5 | 12 | 48 | 32 | 52 |
| 6 | 60 | 300 | 80 | 165 |
| 8 | 2520 | 17640 | 448 | 1351 |
| 10 | 181440 | 1632960 | 2304 | 9225 |

Both columns count the same operation, adding an edge weight to a partial sum; comparisons and subset enumeration are left out of both. Brute force does fewer additions up to $n=5$, and Held-Karp wins from $n=6$ on. From the formulas, at $n=20$ brute force needs $1.16\times10^{18}$ additions and Held-Karp $4.48\times10^{7}$; at $n=30$ the figures are $1.28\times10^{32}$ and $1.09\times10^{11}$. At $n=30$ Held-Karp also stores $7.8\times10^{9}$ values, about 62 GB at 8 bytes each: memory runs out before time does.

## Common Misconceptions & Pitfalls

- **"The graph fails Dirac and Ore, so it is not Hamiltonian."** Both are one-way certificates. $C_6$ and the dodecahedron fail both and are Hamiltonian.
- **"Connected with minimum degree 2 is enough."** The bowtie and the Petersen graph are connected, have minimum degree at least 2, and have no Hamiltonian cycle.
- **"NP-complete means unsolvable."** It means no polynomial-time algorithm is known. Held-Karp solves 20 vertices exactly with $4.48\times10^{7}$ additions.
- **"Held-Karp is polynomial."** $n^22^n$ is exponential; it beats $(n-1)!$, not $n^3$.
- **"A Hamiltonian path gives a Hamiltonian cycle."** A path graph has a Hamiltonian path and no cycle at all.

## Summary

Hamiltonian cycles and Euler circuits are independent properties, and only the second is governed by a local parity condition. No degree test exists: the prism and the Petersen graph share every degree and differ in the answer, and since Karp (1972) put Hamilton circuit among the NP-complete problems, any polynomial-time test would imply P = NP. Ore's theorem (non-adjacent degree sums at least $n$, with $n\ge3$) and its corollary, Dirac's theorem (minimum degree at least $n/2$), guarantee a Hamiltonian cycle, and two cliques sharing a vertex show the guarantee failing just below the bound. They are sufficient, not necessary: at $n=7$ they certify 68 and 29 of the 383 Hamiltonian graphs. For the TSP, Held-Karp replaces brute force's $(n-1)!/2$ tours with $(n-1)(n-2)2^{n-3}+(n-1)$ additions: better from $n=6$ on, still exponential.

## Documentation Links

- [Diestel, Graph Theory (6th ed.), Chapter 10 free preview](https://www.math.uni-hamburg.de/home/diestel/books/graph.theory/preview/Ch10.pdf): Dirac's theorem with proof, the example showing the bound is sharp, and notes on NP-hardness.
- [Wikipedia, Hamiltonian path](https://en.wikipedia.org/wiki/Hamiltonian_path): definitions and the theorems of Dirac, Ore, and Bondy-Chvátal.
- [Wikipedia, Ore's theorem](https://en.wikipedia.org/wiki/Ore%27s_theorem): the statement, a proof, and the 1960 source.
- [Wikipedia, Icosian game](https://en.wikipedia.org/wiki/Icosian_game): Hamilton's game and its dates.
- [Wikipedia, Karp's 21 NP-complete problems](https://en.wikipedia.org/wiki/Karp%27s_21_NP-complete_problems): Karp's 1972 list, including Hamilton circuit.
- [Erickson, Algorithms, Chapter 12: NP-Hardness](https://jeffe.cs.illinois.edu/teaching/algorithms/book/12-nphard.pdf): reductions proving Hamiltonian cycle NP-hard, and the step to the traveling salesman problem.
- [Wikipedia, Held-Karp algorithm](https://en.wikipedia.org/wiki/Held%E2%80%93Karp_algorithm): the recurrence, its 1962 origins, and its time and memory bounds.
- [Levin, Discrete Mathematics: An Open Introduction, Euler Paths and Circuits](https://discrete.openmathbooks.org/dmoi3/sec_paths.html): Hamilton paths and the lack of a simple test.
