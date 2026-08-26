---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

The sibling concept "P vs. NP: Recognizing When a Problem Is Probably Hard" stops at the definitions — what P and NP mean, what a polynomial-time reduction is, what makes a problem NP-complete, and what to do in practice once you suspect a problem is. This concept picks up exactly there and answers the next question: **how does anybody actually prove a new problem is NP-complete?** Cormen et al. answer it in two parts. Section 34.4 establishes Lemma 34.8 and the four-step recipe that turns "reduce every language in NP to L" into the far more tractable "reduce *one* known NP-complete language to L," then applies that recipe twice to get from `CIRCUIT-SAT` down to `SAT` and then to `3-CNF-SAT`. Section 34.5 runs the recipe five more times to build a catalog — `CLIQUE`, `VERTEX-COVER`, `HAM-CYCLE`, `TSP`, and `SUBSET-SUM` — and closes with a set of general reduction strategies and pitfalls. Everything below comes from those two sections.

## Use Cases

- Proving a problem in your own domain is NP-hard so you can stop searching for an exact polynomial-time algorithm with justification, rather than a hunch — the four-step recipe of Lemma 34.8 is the entire proof obligation, and it is short.
- Choosing which known NP-complete problem to reduce *from*: the source's Section 34.5.6 gives concrete guidance (3-CNF satisfiability when crossing domains, vertex-cover when you must select a subset without regard to order, hamiltonian-cycle or hamiltonian-path when ordering matters).
- Reading an NP-completeness proof in a paper and being able to check it: is the reduction in the right direction, is the "if and only if" argued in both directions, and is the transformation itself polynomial-time?
- Recognizing the gadget technique — a fixed subgraph or fixed set of numbers wired in so that only a few configurations are possible — which is the reusable engineering idea behind the harder reductions in the catalog.

## Deep Dive

### Lemma 34.8: reduce from one known problem, not from all of NP

The proof that `CIRCUIT-SAT` is NP-complete (Theorem 34.7, in the previous section) did the hard thing directly: it showed `L ≤p CIRCUIT-SAT` for *every* language `L ∈ NP`. Nobody ever wants to do that again. Lemma 34.8 makes sure nobody has to:

> **Lemma 34.8** — If `L` is a language such that `L' ≤p L` for some `L' ∈ NPC`, then `L` is NP-hard. If, in addition, `L ∈ NP`, then `L ∈ NPC`.

The proof is three lines of transitivity: since `L'` is NP-complete, every `L'' ∈ NP` satisfies `L'' ≤p L'`; by supposition `L' ≤p L`; so by transitivity `L'' ≤p L` for every `L'' ∈ NP`, which is the definition of NP-hard. In other words, **by reducing one known NP-complete language to `L`, you implicitly reduce every language in NP to `L`.**

That gives the recipe the rest of the chapter runs over and over:

1. Prove `L ∈ NP`.
2. Prove that `L` is NP-hard:
   - a. Select a known NP-complete language `L'`.
   - b. Describe an algorithm computing a function `f` that maps every instance `x` of `L'` to an instance `f(x)` of `L`.
   - c. Prove that `x ∈ L'` if and only if `f(x) ∈ L`, for all `x`.
   - d. Prove that the algorithm computing `f` runs in polynomial time.

Step 1 is usually a paragraph (exhibit a certificate and check it). Steps 2b-2d are the real work. And the recipe compounds: as the catalog of known NP-complete problems grows, so does the set of languages you are allowed to reduce *from*, which is why later proofs in the chapter are often easier than earlier ones.

Figure 34.13 in the source lays out the dependency structure of every proof in Sections 34.4 and 34.5. Each arrow is one theorem — a reduction from the problem at the tail to the problem at the head — and everything ultimately roots at `CIRCUIT-SAT`:

```viz
type: graph
node circuit CIRCUIT-SAT 1 0
node sat SAT 1 1
node cnf 3-CNF-SAT 1 2
node clique CLIQUE 0 3
node subset SUBSET-SUM 2 3
node vc VERTEX-COVER 0 4
node ham HAM-CYCLE 0 5
node tsp TSP 0 6
edge circuit sat directed
edge sat cnf directed
edge cnf clique directed
edge cnf subset directed
edge clique vc directed
edge vc ham directed
edge ham tsp directed
---
visit circuit | Theorem 34.7 (previous section): CIRCUIT-SAT is proved NP-complete directly, by reducing every language in NP to it. It is the root -- every other proof below reuses it through Lemma 34.8.
traverse circuit sat | Theorem 34.9: CIRCUIT-SAT <=p SAT. One variable per wire, one clause per gate.
visit sat | SAT is NP-complete -- the first problem ever shown to be, historically.
traverse sat cnf | Theorem 34.10: SAT <=p 3-CNF-SAT, in three steps (parse tree, truth tables, padding to exactly three literals).
visit cnf | 3-CNF-SAT is NP-complete. Its rigid structure makes it the preferred problem to reduce FROM.
traverse cnf clique | Theorem 34.11: 3-CNF-SAT <=p CLIQUE. A triple of vertices per clause; edges only between consistent literals in different triples.
visit clique | CLIQUE is NP-complete -- a logic problem has crossed over into graph theory.
traverse clique vc | Theorem 34.12: CLIQUE <=p VERTEX-COVER, via the complement graph, with the cover target set to (number of vertices) minus k.
visit vc | VERTEX-COVER is NP-complete.
traverse vc ham | Theorem 34.13: VERTEX-COVER <=p HAM-CYCLE, using a 12-vertex, 14-edge gadget per edge plus k selector vertices.
visit ham | HAM-CYCLE is NP-complete.
traverse ham tsp | Theorem 34.14: HAM-CYCLE <=p TSP. Complete the graph, cost 0 for real edges and 1 for the rest, target cost 0.
visit tsp | TSP is NP-complete -- the easiest reduction in the chapter.
traverse cnf subset | Theorem 34.15: 3-CNF-SAT <=p SUBSET-SUM, crossing from logic into arithmetic via base-10 digit columns.
visit subset | SUBSET-SUM is NP-complete. Note this branches off 3-CNF-SAT, not off the graph chain.
```

### Formula satisfiability: CIRCUIT-SAT ≤p SAT

`SAT` takes a boolean formula `φ` built from `n` boolean variables, `m` boolean connectives (any one- or two-input boolean function: `∧`, `∨`, `¬`, `→`, `↔`), and parentheses, and asks whether some truth assignment makes it evaluate to 1. The source's example is `φ = ((x1 → x2) ∨ ¬((¬x1 ↔ x3) ∨ x4)) ∧ ¬x2`, satisfied by `⟨x1 = 0, x2 = 0, x3 = 1, x4 = 1⟩`. The naive algorithm checks all `2^n` assignments — superpolynomial in the length of `⟨φ⟩` when that length is polynomial in `n`.

**Theorem 34.9: `SAT` is NP-complete.** Membership in NP is immediate: the certificate is a satisfying assignment, and the verifier substitutes values and evaluates the expression in polynomial time. NP-hardness comes from `CIRCUIT-SAT ≤p SAT`.

The obvious reduction — walk the circuit from its output gate and inductively write out a formula for each gate's inputs — **is not polynomial**. Gates whose output wire has fan-out of 2 or more produce shared subformulas that get duplicated, and the formula can grow exponentially (Exercise 34.4-1 asks you to build such a circuit). The fix is the trick that recurs throughout the chapter: **name the intermediate values instead of inlining them.**

- Give the formula `φ` one variable `xi` for each *wire* of the circuit `C`.
- For each gate, emit a small `↔` clause with the gate's output variable on the left and the gate's function applied to its input variables on the right. For the circuit's output AND gate in the source's Figure 34.10, that clause is `x10 ↔ (x7 ∧ x8 ∧ x9)`.
- Let `φ` be the AND of the circuit-output variable with the conjunction of all gate clauses. For the figure's circuit: `φ = x10 ∧ (x4 ↔ ¬x3) ∧ (x5 ↔ (x1 ∨ x2)) ∧ (x6 ↔ ¬x4) ∧ (x7 ↔ (x1 ∧ x2 ∧ x4)) ∧ (x8 ↔ (x5 ∨ x6)) ∧ (x9 ↔ (x6 ∨ x7)) ∧ (x10 ↔ (x7 ∧ x8 ∧ x9))`.

The size is now linear in the circuit, so the construction is polynomial. The equivalence is the easy direction in both senses: a satisfying assignment for `C` gives every wire a well-defined value with output 1, so every clause and hence `φ` evaluates to 1; and an assignment satisfying `φ` forces the wire values to be consistent with the gates and the output to be 1, so `C` is satisfiable.

### 3-CNF-SAT: manufacturing a restricted problem worth reducing from

Reducing *from* `SAT` is painful, because a reduction algorithm must handle arbitrarily shaped input formulas. It is far easier to reduce from a **restricted** language — as long as the restriction does not accidentally make the language polynomial-time solvable. `3-CNF-SAT` is that language. A *literal* is a variable or its negation; a *clause* is an OR of literals; a formula is in *conjunctive normal form* (CNF) if it is an AND of clauses, and in *3-CNF* if every clause has **exactly three distinct literals**.

**Theorem 34.10: `3-CNF-SAT` is NP-complete.** Membership in NP reuses the `SAT` argument verbatim. NP-hardness is `SAT ≤p 3-CNF-SAT`, in three steps, each moving the formula closer to 3-CNF:

1. **Parse tree, then name the nodes.** Build a binary parse tree for `φ` with literals as leaves and connectives as internal nodes (use associativity to fully parenthesize so every internal node has one or two children). The tree is essentially a circuit, so apply the Theorem 34.9 trick again: introduce a variable `yi` per internal node and rewrite `φ` as the AND of the root variable with a conjunction of `↔` clauses describing each node. For `φ = ((x1 → x2) ∨ ¬((¬x1 ↔ x3) ∨ x4)) ∧ ¬x2`, this yields `φ' = y1 ∧ (y1 ↔ (y2 ∧ ¬x2)) ∧ (y2 ↔ (y3 ∨ y4)) ∧ (y3 ↔ (x1 → x2)) ∧ (y4 ↔ ¬y5) ∧ (y5 ↔ (y6 ∨ x4)) ∧ (y6 ↔ (¬x1 ↔ x3))`. Each clause now has at most three literals, but is not yet an OR of them.
2. **Truth-table each clause into CNF.** Every clause `φ'i` has at most three variables, so its truth table has at most `2³ = 8` rows. Take the rows evaluating to 0, build a DNF (an OR of ANDs) equivalent to `¬φ'i`, then negate it and apply DeMorgan's laws (`¬(a ∧ b) = ¬a ∨ ¬b`, `¬(a ∨ b) = ¬a ∧ ¬b`) to get a CNF `φ''i`. The source works this through for `φ'1 = (y1 ↔ (y2 ∧ ¬x2))`, whose four 0-rows give a DNF for the negation, which converts to `φ''1 = (¬y1 ∨ ¬y2 ∨ ¬x2) ∧ (¬y1 ∨ y2 ∨ ¬x2) ∧ (¬y1 ∨ y2 ∨ x2) ∧ (y1 ∨ ¬y2 ∨ x2)`. The conjunction of all `φ''i` is a CNF formula `φ''` equivalent to `φ'`, still with at most three literals per clause.
3. **Pad every clause to exactly three distinct literals.** Using two auxiliary variables `p` and `q`, for each clause `Ci` of `φ''`: if it already has three distinct literals, keep it; if it has exactly two, `Ci = (l1 ∨ l2)`, emit `(l1 ∨ l2 ∨ p) ∧ (l1 ∨ l2 ∨ ¬p)`; if it has one literal `l`, emit `(l ∨ p ∨ q) ∧ (l ∨ p ∨ ¬q) ∧ (l ∨ ¬p ∨ q) ∧ (l ∨ ¬p ∨ ¬q)`. Whatever `p` and `q` are set to, exactly one of the emitted clauses reduces to the original and the rest evaluate to 1, which is the identity for AND.

Polynomial size falls out of counting: step 1 adds at most one variable and one clause per connective in `φ`; step 2 turns each clause into at most 8 clauses (the truth table has at most 8 rows); step 3 turns each clause into at most 4. Note also Exercise 34.4-3's warning — you cannot skip straight to the truth-table step on the whole formula `φ`, because that table has `2^n` rows and the reduction stops being polynomial. Nearby, Exercise 34.4-7 points out the boundary: `2-CNF-SAT`, with exactly two literals per clause, is in **P**.

### CLIQUE: crossing from logic into graphs

A *clique* in an undirected graph `G = (V, E)` is a subset `V' ⊆ V` in which every pair of vertices is joined by an edge — a complete subgraph. The decision problem is `CLIQUE = {⟨G, k⟩ : G contains a clique of size k}`. The naive algorithm enumerates all `k`-subsets of `V` and checks each, running in `Θ(k² · C(|V|, k))` — polynomial when `k` is constant, superpolynomial when `k` is near `|V|/2`.

**Theorem 34.11: `CLIQUE` is NP-complete.** For NP, the certificate is the vertex set `V'` itself, verified by checking that `(u, v) ∈ E` for each pair `u, v ∈ V'`. NP-hardness is `3-CNF-SAT ≤p CLIQUE`, which is surprising on its face — logical formulas seem to have little to do with graphs — and is the archetype of a cross-domain reduction.

Given `φ = C1 ∧ C2 ∧ ... ∧ Ck` in 3-CNF, where clause `Cr = (l1r ∨ l2r ∨ l3r)`:

```java
// Faithful translation of the construction in the proof of Theorem 34.11.
// A vertex per literal-occurrence; k triples in all, one per clause.
// Edge (v_i^r, v_j^s) exists iff the occurrences are in DIFFERENT clauses
// AND the literals are consistent (neither is the negation of the other).
Graph buildCliqueInstance(List<Clause> clauses) {
    Graph g = new Graph();
    for (int r = 0; r < clauses.size(); r++) {
        for (int i = 0; i < 3; i++) {
            g.addVertex(vertexId(r, i));          // v_i^r, labeled by literal l_i^r
        }
    }
    for (int r = 0; r < clauses.size(); r++) {
        for (int s = r + 1; s < clauses.size(); s++) {   // r != s: different triples only
            for (int i = 0; i < 3; i++) {
                for (int j = 0; j < 3; j++) {
                    Literal a = clauses.get(r).literal(i);
                    Literal b = clauses.get(s).literal(j);
                    if (!a.isNegationOf(b)) {              // consistent literals
                        g.addEdge(vertexId(r, i), vertexId(s, j));
                    }
                }
            }
        }
    }
    return g;   // the CLIQUE instance is <g, k>, where k = number of clauses
}
```

The construction is clearly polynomial. The equivalence, `φ` satisfiable iff `G` has a clique of size `k`:

- **Forward.** A satisfying assignment makes at least one literal true in every clause `Cr`; pick one such true literal per clause, giving `k` vertices. Any two of them lie in different triples and are both assigned 1, so neither can be the complement of the other — by construction the edge between them exists. Those `k` vertices form a clique.
- **Backward.** A clique `V'` of size `k` contains exactly one vertex per triple, since no edges join vertices within a triple. Assign 1 to each corresponding literal. Because `G` has no edges between inconsistent literals, no variable and its negation both get 1, so the assignment is consistent, and every clause has a true literal. Variables not represented in the clique can be set arbitrarily.

The source pauses here on a subtlety worth internalizing. The reduction only ever produces graphs of a special shape (vertices in triples, no intra-triple edges), so it seems to prove NP-hardness only for that restricted family. That is fine, and it *does* establish NP-hardness for general graphs: a polynomial-time algorithm for `CLIQUE` on general graphs would also solve these restricted ones. The **opposite** move — reducing only specially structured instances of `3-CNF-SAT` to general `CLIQUE` instances — would not suffice, because those special `3-CNF-SAT` instances might be easy. A second subtlety: the reduction consumes the *instance* `φ`, never a *solution* to it. A reduction that needed to know whether `φ` is satisfiable would be worthless, since deciding that in polynomial time is exactly what nobody knows how to do.

### VERTEX-COVER: the complement-graph reduction

A *vertex cover* of `G = (V, E)` is a subset `V' ⊆ V` such that every edge `(u, v) ∈ E` has `u ∈ V'` or `v ∈ V'` (or both). The language is `VERTEX-COVER = {⟨G, k⟩ : G has a vertex cover of size k}`.

**Theorem 34.12: `VERTEX-COVER` is NP-complete.** For NP, the certificate is the cover `V'`; the verifier checks `|V'| = k` and then, for each edge `(u, v) ∈ E`, that `u ∈ V'` or `v ∈ V'`. NP-hardness is `CLIQUE ≤p VERTEX-COVER`, and it is beautifully short. Define the **complement** of `G = (V, E)` as `Ḡ = (V, Ē)` where `Ē = {(u, v) : u, v ∈ V, u ≠ v, and (u, v) ∉ E}` — exactly the edges `G` lacks. The reduction maps the `CLIQUE` instance `⟨G, k⟩` to the `VERTEX-COVER` instance `⟨Ḡ, |V| − k⟩`, computable in polynomial time. Then:

- **Forward.** If `G` has a clique `V'` with `|V'| = k`, take any edge `(u, v) ∈ Ē`. Then `(u, v) ∉ E`, so `u` and `v` cannot both be in `V'` (every pair in a clique is joined in `E`), so at least one of them is in `V − V'`. Every edge of `Ē` is therefore covered by `V − V'`, a set of size `|V| − k`.
- **Backward.** If `Ḡ` has a vertex cover `V'` of size `|V| − k`, then for all `u, v ∈ V`, `(u, v) ∈ Ē` implies `u ∈ V'` or `v ∈ V'`. The contrapositive says: if `u ∉ V'` and `v ∉ V'`, then `(u, v) ∈ E`. So `V − V'` is a clique, of size `|V| − |V'| = k`.

The source immediately adds the practical footnote that motivates the sibling concept "Approximation Algorithms: Vertex Cover & TSP": because `VERTEX-COVER` is NP-complete we do not expect an exact polynomial-time algorithm, but Section 35.1 gives a polynomial-time approximation algorithm whose cover is at most twice the minimum size. NP-completeness is a reason to change tactics, not to give up.

### HAM-CYCLE: the gadget reduction

**Theorem 34.13: `HAM-CYCLE` is NP-complete.** Membership in NP: the certificate is the sequence of `|V|` vertices forming the cycle, and the verifier checks that it contains each vertex exactly once and that consecutive vertices (including last-to-first) are joined by edges. NP-hardness is `VERTEX-COVER ≤p HAM-CYCLE`, by far the most intricate proof in the chapter, and the source's showcase for **gadgets** — a piece of graph that enforces certain properties by restricting how a cycle can pass through it.

Given `G = (V, E)` and integer `k` (assuming without loss of generality that `G` has no isolated vertices and `k ≤ |V|`), construct `G' = (V', E')`:

- **One gadget per edge.** For each `(u, v) ∈ E`, `G'` contains a copy of the gadget, denoted `W_uv`, whose 12 vertices are written `[u, v, i]` and `[v, u, i]` for `1 ≤ i ≤ 6`, and which contains 14 edges. Crucially, **only** `[u, v, 1]`, `[u, v, 6]`, `[v, u, 1]`, and `[v, u, 6]` have edges leading outside the gadget. That restriction is what makes the gadget work: any hamiltonian cycle of `G'` must traverse `W_uv` in one of exactly three ways — enter at `[u, v, 1]` and exit at `[u, v, 6]` covering either all 12 vertices or just `[u, v, 1..6]` (in which case the cycle must re-enter later to cover `[v, u, 1..6]`), or symmetrically entering at `[v, u, 1]`. No other all-12-vertex traversal is possible; in particular you cannot form two vertex-disjoint paths, one from `[u, v, 1]` to `[v, u, 6]` and the other from `[v, u, 1]` to `[u, v, 6]`, whose union covers the gadget.
- **Path edges per vertex.** Order the neighbors of each `u ∈ V` arbitrarily as `u⁽¹⁾, ..., u⁽ᵈᵉᵍʳᵉᵉ⁽ᵘ⁾⁾`, and add the edges `{([u, u⁽ⁱ⁾, 6], [u, u⁽ⁱ⁺¹⁾, 1]) : 1 ≤ i ≤ degree(u) − 1}`. These string together all gadgets for edges incident on `u` into one path. The intuition: if `u` is in the vertex cover, this path "covers" all of `u`'s gadgets — taking all 12 vertices of a gadget when only `u` is in the cover, or just 6 when both endpoints are.
- **Selector vertices.** Add `s1, ..., sk` and join every selector to the first and last vertex of each of those per-vertex paths: `{(sj, [u, u⁽¹⁾, 1])}` and `{(sj, [u, u⁽ᵈᵉᵍʳᵉᵉ⁽ᵘ⁾⁾, 6])}` for all `u ∈ V`, `1 ≤ j ≤ k`. The `k` selectors are what pick out the `k` cover vertices.

The size is polynomial: `|V'| = 12|E| + k ≤ 12|E| + |V|`, and `|E'| = 14|E| + (2|E| − |V|) + 2k|V| = 16|E| + (2k − 1)|V| ≤ 16|E| + (2|V| − 1)|V|`.

The equivalence argument runs both ways. Given a cover `V* = {u1, ..., uk}`, build the cycle by starting at `s1`, walking the gadget path for `u1`, moving to `s2`, walking `u2`'s gadgets, and so on back to `s1`; each gadget is visited once or twice depending on whether one or both of its endpoints are in `V*`, and since `V*` covers every edge, every gadget vertex is visited. Conversely, given a hamiltonian cycle `C`, define `V* = {u ∈ V : (sj, [u, u⁽¹⁾, 1]) ∈ C for some 1 ≤ j ≤ k}`. The proof first shows `V*` is well defined by partitioning `C` into "cover paths" — maximal paths running from one selector to another without passing through a third — and arguing that each selector has exactly one incident cycle edge of that form. Then each cover path `Pu` covers all gadgets for edges incident on `u`, and every gadget is visited by one or two cover paths, so every edge of `E` is covered by some vertex of `V*`. (Exercise 34.5-9 asks what breaks if `G` does have an isolated vertex.)

### TSP: the easiest reduction in the chapter

In the traveling-salesperson problem the salesperson must tour `n` cities — a hamiltonian cycle on a complete graph — paying a nonnegative integer cost `c(i, j)` per leg, and the decision version asks for a tour of cost at most `k`:

`TSP = {⟨G, c, k⟩ : G = (V, E) is a complete graph, c is a function from V × V → ℕ, k ∈ ℕ, and G has a traveling-salesperson tour with cost at most k}`.

**Theorem 34.14: `TSP` is NP-complete.** The certificate is the sequence of `n` tour vertices; the verifier checks it is a permutation, sums the edge costs, and compares against `k`. NP-hardness is `HAM-CYCLE ≤p TSP`, and it is three lines: given a `HAM-CYCLE` instance `G = (V, E)`, form the complete graph `G' = (V, E')` with `E' = {(i, j) : i, j ∈ V and i ≠ j}` and

```
c(i, j) = 0   if (i, j) ∈ E
c(i, j) = 1   if (i, j) ∉ E
```

and output `⟨G', c, 0⟩`. If `G` has a hamiltonian cycle `H`, every edge of `H` lies in `E` and so costs 0, making `H` a tour of cost 0 in `G'`. Conversely, a tour of cost at most 0 must have cost exactly 0 (costs are 0 or 1), so every edge on it costs 0, so every edge lies in `E` — the tour is a hamiltonian cycle of `G`. Note this is *not* the approximation-flavored TSP of the sibling concept "Approximation Algorithms: Vertex Cover & TSP"; here the cost function is deliberately constructed and no triangle inequality is assumed.

### SUBSET-SUM: crossing into arithmetic with digit columns

The subset-sum problem takes a finite set `S` of positive integers and a target `t > 0`, and asks whether some `S' ⊆ S` sums to exactly `t`: `SUBSET-SUM = {⟨S, t⟩ : there exists a subset S' ⊆ S such that t = Σ_{s ∈ S'} s}`. The standard encoding matters here — input integers are coded in **binary**, which is what keeps the problem from being trivially polynomial in the numeric value of `t` (see Exercise 34.5-4, which asks you to solve it in polynomial time when `t` is given in unary).

**Theorem 34.15: `SUBSET-SUM` is NP-complete.** For NP, the certificate is `S'` and the verifier just adds it up. NP-hardness is `3-CNF-SAT ≤p SUBSET-SUM` — the second cross-domain reduction from 3-CNF, and the one where the gadget is arithmetic rather than structural.

Given a 3-CNF formula `φ` over variables `x1, ..., xn` with clauses `C1, ..., Ck`, and two harmless simplifying assumptions (no clause contains both a variable and its negation, since such a clause is always satisfied; every variable appears in at least one clause), construct base-10 numbers with `n + k` digits. The most significant `n` digit positions are labeled by variables and the least significant `k` by clauses:

```java
// Faithful translation of the number construction in the proof of Theorem 34.15.
// Each number has n + k base-10 digits: n variable columns, then k clause columns.
// Target: 1 in every variable column, 4 in every clause column.
List<BigInteger> buildSubsetSumInstance(int n, List<Clause> clauses) {
    int k = clauses.size();
    List<BigInteger> S = new ArrayList<>();

    for (int i = 0; i < n; i++) {
        int[] v  = new int[n + k];   // chosen when x_i = 1
        int[] vp = new int[n + k];   // v'_i, chosen when x_i = 0
        v[i] = 1;                    // the digit labeled by x_i
        vp[i] = 1;
        for (int j = 0; j < k; j++) {
            if (clauses.get(j).contains(positive(i))) v[n + j] = 1;
            if (clauses.get(j).contains(negated(i)))  vp[n + j] = 1;
        }
        S.add(toNumber(v));
        S.add(toNumber(vp));
    }
    for (int j = 0; j < k; j++) {    // slack "gadgets": one 1 and one 2 per clause column
        int[] s  = new int[n + k];
        int[] sp = new int[n + k];
        s[n + j] = 1;
        sp[n + j] = 2;
        S.add(toNumber(s));
        S.add(toNumber(sp));
    }
    return S;   // target t has 1 in each of the n variable digits, 4 in each of the k clause digits
}
```

The base is the whole trick. The greatest possible sum in any one digit position is **6** — at most three 1s from `vi`/`v'i` values (a clause has three literals) plus 1 and 2 from the two slack values — so in base 10 **no carries can occur** between digit positions, and each column can be reasoned about independently. The source's footnote notes any base `b ≥ 7` works equally well.

Uniqueness of the values holds too: for `ℓ ≠ i`, no `vℓ` or `v'ℓ` can match `vi` or `v'i` in the top `n` digits, and `vi` cannot equal `v'i` in the bottom `k` digits — that would require `xi` and `¬xi` to appear in exactly the same clauses, which the simplifying assumptions rule out.

The reduction is polynomial: `S` has `2n + 2k` values of `n + k` digits each, and `t` has `n + k` digits produced in constant time apiece. The equivalence:

- **Forward.** From a satisfying assignment, include `vi` in `S'` when `xi = 1` and `v'i` when `xi = 0` — exactly the numbers corresponding to true literals. Each variable column then sums to 1, matching `t`. Each clause column receives 1, 2, or 3 from the chosen `v` values (however many of its literals are true), so adding the appropriate nonempty subset of the slack pair `{sj, s'j}` — worth 1, 2, or 3 together — brings every clause column to exactly 4. With no carries, the total is `t`.
- **Backward.** A subset summing to `t` must contain exactly one of `vi`, `v'i` for each `i`, or the variable columns would not sum to 1; read that as the assignment. Since the two slack values contribute at most 3 to a clause column but the target is 4, at least one chosen `v` value must have a 1 in that column — meaning the corresponding literal appears in that clause and is assigned 1. Every clause is therefore satisfied.

The source's Figure 34.19 works a full example with `n = 3`, `k = 4`, producing `S = {1001001, 1000110, 100001, 101110, 10011, 11100, 1000, 2000, 100, 200, 10, 20, 1, 2}` and `t = 1114444`, where the subset `{v'1, v'2, v3}` plus slacks `s1, s'1, s'2, s3, s4, s'4` hits the target, corresponding to the satisfying assignment `⟨x1 = 0, x2 = 0, x3 = 1⟩`.

### Reduction strategies and pitfalls (Section 34.5.6)

No single strategy covers every problem — some reductions are three lines (`HAM-CYCLE` to `TSP`) and some fill five pages (`VERTEX-COVER` to `HAM-CYCLE`). The source closes with a checklist:

- **Do not get the direction backward.** To show `Y` is NP-complete you must reduce a known NP-complete `X` **to** `Y`, so that a solver for `Y` yields a solver for `X`. Reducing `Y` to `X` proves nothing about `Y`'s hardness.
- **NP-hard is not NP-complete.** Reducing a known NP-complete `X` to `Y` proves only that `Y` is NP-hard. You still owe the proof that `Y ∈ NP`, by showing a certificate for `Y` can be verified in polynomial time.
- **Go from general to specific.** You must handle *any* input to `X`, but you are free to produce inputs to `Y` with whatever special structure you like — the 3-CNF-to-subset-sum reduction only ever emits `2n + 2k` integers of one particular shape, and that is fine.
- **Reduce from the problem with more structure.** It is almost always easier to reduce from `3-CNF-SAT` than from `SAT`, because 3-CNF formulas are rigid while boolean formulas are arbitrary; likewise easier from `HAM-CYCLE` than from `TSP`, since hamiltonian cycle is effectively TSP restricted to 0/1 edge weights.
- **Look for special cases.** If NP-hard `X` is a special case of `Y`, then `Y` is NP-hard too, since a polynomial-time solver for the more general `Y` solves `X` for free. The source's example: set-partition (Exercise 34.5-5) is the 0-1 knapsack decision problem with each item's value equal to its weight and both `W` and `V` set to half the total.
- **Pick a problem from a related domain** — vertex-cover came from clique, hamiltonian-cycle from vertex-cover, TSP from hamiltonian-cycle, all undirected-graph problems. When you must cross domains, `3-CNF-SAT` is usually the right source. Within graph problems: use vertex-cover when you must select part of the graph without regard to ordering, and hamiltonian-cycle or hamiltonian-path when ordering matters.
- **Make big rewards and big penalties.** The `HAM-CYCLE`-to-`TSP` reduction rewarded using real edges with cost 0. Equivalently it could have penalized fake edges with infinite cost — with real edges at weight `W` the tour target becomes `W · |V|`. Penalties are a way to encode hard requirements.
- **Design gadgets.** A gadget is any component that enforces a property. They can be elaborate, like the 12-vertex subgraph in the hamiltonian-cycle reduction, or trivial, like the slack values `sj` and `s'j` that let each clause column reach exactly 4 in the subset-sum reduction.

## Trade-offs

- **The recipe is cheap, but only because someone paid for `CIRCUIT-SAT` once.** Every proof in this catalog is a two-page argument instead of a machine-encoding argument, and that entirely rests on Theorem 34.7 having done the direct reduction from all of NP. Lemma 34.8 buys leverage, not a free lunch — pick the wrong base problem and step 2b can still be intractable to write.
- **Proving NP-hardness is a worst-case statement about a *family*, not a verdict on your instances.** The `CLIQUE` proof only produces graphs whose vertices come in disjoint triples; that suffices for the general claim, but it is a reminder that NP-completeness says a *general* polynomial-time algorithm is unlikely. Your production inputs may live in an easy restricted class — the same reason `2-CNF-SAT` is in P while `3-CNF-SAT` is NP-complete.
- **Gadget reductions are correct but not constructive in a useful way.** The `VERTEX-COVER`-to-`HAM-CYCLE` construction blows a graph with `|E|` edges up to `12|E| + k` vertices and `16|E| + (2k − 1)|V|` edges. That is polynomial and therefore fine for the theory, but nobody actually solves vertex cover by routing it through a hamiltonian-cycle solver — reductions are proof devices first, algorithms a distant second.
- **The encoding is part of the problem statement.** `SUBSET-SUM` is NP-complete under the standard binary encoding of its integers; Exercise 34.5-4 observes it becomes polynomial-time solvable when the target `t` is written in unary. If you ever "prove" something about a numeric problem's hardness, check which encoding you assumed before believing the result.
- **NP-completeness closes one door and opens several.** Immediately after proving `VERTEX-COVER` NP-complete, the source points at Section 35.1's 2-approximation — the subject of the sibling concept "Approximation Algorithms: Vertex Cover & TSP". A completed hardness proof is the *start* of the engineering conversation about approximation, special cases, and heuristics, not the end of it.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 34 "NP-Completeness", Sections 34.4-34.5, pp. 1072-1098](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
