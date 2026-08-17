---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Continuing from the sibling `approximation-algorithms-vertex-cover` concept's coverage of Sections 35.1-35.2 — which establishes what an approximation ratio *is* and why NP-hardness forces you to settle for one — this concept picks up the same chapter at Section 35.3 and covers the next two design techniques Cormen et al. present. First, `GREEDY-SET-COVER` for the **set-covering problem**: a plain "take whatever set covers the most still-uncovered elements" loop that is *not* a constant-factor approximation like the previous two algorithms, but a `O(lg |X|)`-approximation — a ratio that grows with the instance, yet grows slowly enough to stay useful. Second, the two techniques of Section 35.4: **randomization**, where the approximation ratio is defined over the *expected* cost of a randomized algorithm (illustrated by an 8/7-approximation for MAX-3-CNF satisfiability that is literally just coin flips), and **linear programming**, where you relax a 0-1 integer program into a real-valued linear program you can actually solve in polynomial time, then *round* the fractional answer back into a legal solution. The chapter's third remaining technique — the fully polynomial-time approximation scheme built from list trimming — is a genuinely different animal and lives in the sibling `subset-sum-approximation-scheme` concept.

## Use Cases

- Modeling any "cover all the requirements with as few resources as possible" allocation problem as set covering. The source's own example: `X` is a set of skills needed to solve a problem, each available person is the subset of skills they have, and you want the smallest committee such that every requisite skill is held by at least one member.
- Accepting a logarithmic rather than constant approximation ratio when no constant-factor algorithm is available. The source is explicit that the vertex-cover algorithm of Section 35.1 does *not* transfer to set covering even though set covering's decision version generalizes vertex cover, so the greedy heuristic with its `O(lg |X|)` ratio is what you get.
- Reasoning about randomized algorithms that return *approximate* answers, not just exact ones: a randomized `ρ(n)`-approximation algorithm bounds the ratio between the **expected** cost of its output and the optimal cost, so it is the same definition as the deterministic one with an expectation wrapped around the cost.
- Approximating **minimum-weight** vertex cover, where each vertex carries a positive weight and the goal is minimum total weight. The unweighted `APPROX-VERTEX-COVER` from the sibling concept is explicitly unsuitable here — the source notes its output "could be far from optimal for the weighted problem" — so LP relaxation plus rounding is the tool that recovers a 2-approximation.
- Reaching for LP relaxation whenever you can write your problem as a 0-1 integer program: dropping the integrality constraint gives a lower bound on the optimum that is *computable* in polynomial time, which is exactly the "cheap lower bound" ingredient the chapter's proof methodology needs.

## Deep Dive

### GREEDY-SET-COVER: repeatedly take the set covering the most uncovered elements

An instance `(X, F)` of the set-covering problem is a finite set `X` plus a family `F` of subsets of `X` such that every element of `X` belongs to at least one subset in `F` (that is, `X` is the union of all sets in `F`). A subfamily `C ⊆ F` **covers** a set `U` when `U` is contained in the union of the sets in `C`; the problem is to find a minimum-size subfamily `C ⊆ F` whose union is all of `X`. "Size" here means the **number of sets** in `C`, not the number of individual elements — counting elements would be pointless, since any covering subfamily necessarily contains all `|X|` of them.

```java
// Faithful translation of GREEDY-SET-COVER(X, F) (CLRS, Section 35.3).
// Returns a subfamily of F whose union is X.
List<Set<Integer>> greedySetCover(Set<Integer> x, List<Set<Integer>> f) {
    Set<Integer> u = new HashSet<>(x);          // line 1: U0 = X (uncovered elements)
    List<Set<Integer>> c = new ArrayList<>();   // line 2: C = {}

    while (!u.isEmpty()) {                      // line 4
        Set<Integer> best = null;               // line 5: select S in F maximizing |S ∩ Ui|
        int bestGain = -1;
        for (Set<Integer> s : f) {
            int gain = 0;
            for (int e : s) if (u.contains(e)) gain++;
            if (gain > bestGain) { bestGain = gain; best = s; }  // ties broken arbitrarily
        }

        u.removeAll(best);                      // line 6: U(i+1) = Ui - S
        c.add(best);                            // line 7: C = C ∪ {S}
    }
    return c;                                   // line 9
}
```

The loop counter `i` in the book's pseudocode exists only so the analysis can name the successive uncovered sets `U0, U1, U2, ...`; the algorithm itself just shrinks one working set. `U0` starts as all of `X`, line 5 is the greedy decision (pick a subset covering as many *still-uncovered* elements as possible, breaking ties arbitrarily), and line 6 deletes those newly covered elements from the uncovered set.

The trace below runs `GREEDY-SET-COVER` on the instance from the source's own Exercise 35.3-1: each of the ten words `arid, dash, drain, heard, lost, nose, shun, slate, snare, thread` is treated as its set of letters, so `X` is the 12 distinct letters `{a, r, i, d, s, h, n, e, l, o, t, u}`. Ties in line 5 are broken in favor of the word that appears first in the dictionary. Each token is one element of `X`, and an element is removed from the row at the moment line 6 drops it from the uncovered set:

```viz
type: moves
remove t | Iteration 1, line 5: "thread" = {t,h,r,e,a,d} covers 6 of the 12 uncovered letters, more than any other word ("drain", "heard", "slate", "snare" cover 5). C = {thread}.
remove h | Line 6 removes all six of thread's letters from U0: t, h, ...
remove r | ... r, ...
remove e | ... e, ...
remove a | ... a, ...
remove d | ... and d. U1 = {i, s, n, l, o, u}, six letters still uncovered.
remove l | Iteration 2, line 5: "lost", "nose" and "shun" each cover 3 of U1; the tie goes to "lost" (first in the dictionary), covering {l, o, s}. C = {thread, lost}.
remove o | Line 6 removes o ...
remove s | ... and s. U2 = {i, n, u}.
remove i | Iteration 3, line 5: "drain" and "shun" each cover 2 of U2; the tie goes to "drain", covering {i, n}. C = {thread, lost, drain}. Line 6 removes i ...
remove n | ... and n. U3 = {u}.
remove u | Iteration 4, line 5: only "shun" contains u, so it is the maximizer. C = {thread, lost, drain, shun}. U4 is empty, so the while loop of line 4 ends.
---
a
r
i
d
s
h
n
e
l
o
t
u
```

The greedy cover here has size 4. It happens to be optimal on this instance — `u` occurs only in `shun`, so every cover must contain `shun`, and no two remaining words together cover the leftover letters `{a, r, i, d, e, l, o, t}` — but that is a property of this instance, not a guarantee. The source's own Figure 35.3 shows an instance of 12 points and six sets where the minimum cover has size 3 while `GREEDY-SET-COVER` returns size 4: it picks `S1`, `S4`, `S5` and then either `S3` or `S6`, whereas the optimal cover is `{S3, S4, S5}`.

### Why the greedy ratio is O(lg |X|)

**Theorem 35.4**: `GREEDY-SET-COVER` is a polynomial-time `O(lg |X|)`-approximation algorithm.

The running-time half is quick: the loop runs at most `min(|X|, |F|)` times and each body costs `O(|X|·|F|)`, for `O(|X|·|F|·(|X| + |F|))` overall — polynomial in the input size. (Exercise 35.3-3 asks for an implementation running in time proportional to the total size of all the sets.)

The ratio half is the interesting part, and it follows the same "bound the algorithm against a cheap lower bound" methodology the sibling concept describes:

- Let `C*` be an optimal cover and `k = |C*|`. Every intermediate uncovered set `Ui` is a subset of `X`, so `C*` covers it too — meaning the instance `(Ui, F)` has an optimal cover of size at most `k`.
- If `k` sets suffice to cover `Ui`, then by pigeonhole at least one of them covers at least `|Ui| / k` of its elements. Line 5 picks the set covering the *most* uncovered elements, so it covers at least that many, giving the shrink recurrence `|U(i+1)| ≤ |Ui| − |Ui| / k = |Ui|·(1 − 1/k)`.
- Iterating that recurrence from `|U0| = |X|` gives `|Ui| ≤ |X|·(1 − 1/k)^i`.
- The algorithm stops when `|Ui| < 1`. Using `1 + x ≤ e^x` with `x = −1/k`, we get `(1 − 1/k)^k ≤ 1/e`, so after `i = ck` iterations the bound becomes `|X|·e^(−c)`. Requiring `|X|·e^(−c) < 1` gives `c > ln |X|`, so `c = ⌈ln |X|⌉` suffices.
- The number of iterations equals `|C|`, so `|C| ≤ ck = |C*|·⌈ln |X|⌉`.

The ratio therefore *grows* with the instance instead of staying constant — but only logarithmically, which is why the source calls the result "nonetheless useful." Exercise 35.3-4 notes a much weaker but trivially true bound for comparison: `|C| ≤ |C*|·max{|S| : S ∈ F}`.

### Randomization: an 8/7-approximation for MAX-3-CNF that is pure coin-flipping

A randomized algorithm is a **randomized `ρ(n)`-approximation algorithm** when, for any input of size `n`, the *expected* cost `C` of the solution it produces is within a factor `ρ(n)` of the optimal cost `C*` — that is, `max(C/C*, C*/C) ≤ ρ(n)`. It is the identical definition to the deterministic ratio, with the algorithm's cost replaced by an expectation.

MAX-3-CNF satisfiability is the optimization version of 3-CNF satisfiability: given a formula in which every clause has exactly three distinct literals, instead of asking whether *all* clauses can be satisfied, return an assignment satisfying **as many clauses as possible**. Assume additionally that no clause contains both a variable and its negation (Exercise 35.4-1 removes this assumption).

```java
// The entire algorithm behind Theorem 35.5 (CLRS, Section 35.4).
boolean[] maxThreeCnfAssignment(int n, Random rnd) {
    boolean[] x = new boolean[n];
    for (int i = 0; i < n; i++) {
        x[i] = rnd.nextBoolean();   // each variable set to 1 with probability 1/2
    }
    return x;
}
```

**Theorem 35.5**: independently setting each variable to 1 with probability 1/2 and to 0 with probability 1/2 is a randomized 8/7-approximation algorithm for MAX-3-CNF satisfiability. The proof is a linearity-of-expectation argument three lines long:

- Define the indicator `Yi = I{clause i is satisfied}`. Because no literal repeats inside a clause and no variable appears alongside its negation, the three literals of a clause are set independently.
- A clause fails only if all three of its literals land on 0, which happens with probability `(1/2)³ = 1/8`. So `Pr{clause i is satisfied} = 7/8` and `E[Yi] = 7/8`.
- Let `Y = Y1 + Y2 + ... + Ym` be the number of satisfied clauses. By linearity of expectation, `E[Y] = 7m/8` — with no independence assumption needed *between* clauses, which is what makes the argument work at all.
- Since `m` (all clauses) upper-bounds the optimum, the ratio is at most `m / (7m/8) = 8/7`.

### Linear programming: relax the integer program, then round at 1/2

The minimum-weight vertex-cover problem takes an undirected graph `G = (V, E)` with a positive weight `w(v)` on each vertex; the weight of a cover is the sum of its vertices' weights, and the goal is a minimum-weight cover. Encode it as a **0-1 integer program**: give each vertex `v` a variable `x(v) ∈ {0, 1}` meaning "v is in the cover," minimize the sum of `w(v)·x(v)` over all vertices, subject to `x(u) + x(v) ≥ 1` for every edge `(u, v)` — the constraint that says at least one endpoint of every edge is picked. With all weights equal to 1 this is exactly the NP-hard vertex-cover optimization problem, so the integer program itself is no easier than what it encodes.

Now drop the integrality constraint `x(v) ∈ {0, 1}` and replace it with `0 ≤ x(v) ≤ 1`. The result is the **linear-programming relaxation**, and it is solvable in polynomial time. Every feasible solution of the integer program is feasible for the relaxation, so the relaxation's optimum is a **lower bound** on the true minimum weight — the cheap lower bound the proof needs. The catch is that its solution `x̄` is fractional and does not name a cover, so the algorithm rounds it:

```java
// Faithful translation of APPROX-MIN-WEIGHT-VC(G, w) (CLRS, Section 35.4).
Set<Integer> approxMinWeightVC(Graph g, Map<Integer, Double> w) {
    Set<Integer> c = new HashSet<>();                    // line 1: C = {}

    // line 2: solve the LP relaxation -- minimize sum of w(v)*x(v)
    // subject to x(u) + x(v) >= 1 for each edge (u,v), and 0 <= x(v) <= 1.
    Map<Integer, Double> xBar = solveLpRelaxation(g, w);

    for (int v : g.vertices()) {                         // line 3
        if (xBar.get(v) >= 0.5) {                        // line 4: round up at 1/2
            c.add(v);                                    // line 5
        }
    }
    return c;                                            // line 6
}
```

**Theorem 35.6**: `APPROX-MIN-WEIGHT-VC` is a polynomial-time 2-approximation algorithm for minimum-weight vertex cover. Both halves of the proof fall out of the rounding threshold:

- **The output really is a cover.** For any edge `(u, v)`, the LP constraint forces `x̄(u) + x̄(v) ≥ 1`, so at least one of the two values is at least 1/2 and therefore at least one endpoint is rounded in. Every edge is covered.
- **The weight is at most twice optimal.** Let `z*` be the optimal LP value and `C*` an optimal cover; since an optimal cover is feasible for the relaxation, `z* ≤ w(C*)`. Restricting the sum defining `z*` to only those vertices with `x̄(v) ≥ 1/2` can only shrink it, and on those vertices `x̄(v) ≥ 1/2`, so `z*` is at least `(1/2)·w(C)`. Chaining the two gives `w(C) ≤ 2z* ≤ 2w(C*)`.

The `x(v) ≤ 1` constraints turn out to be redundant — Exercise 35.4-4 asks you to show that removing them yields an LP whose optimal solutions satisfy `x(v) ≤ 1` anyway.

## Trade-offs

- **A logarithmic ratio is not a constant ratio** — unlike the 2-approximations of the sibling concept, `GREEDY-SET-COVER`'s guarantee degrades as the instance grows: the returned cover may be up to `⌈ln |X|⌉` times the optimum. The source's defence is simply that the logarithm grows slowly enough for the result to remain useful, not that the ratio is tight for any fixed size.
- **Greedy tie-breaking is unconstrained, and that matters** — line 5 picks *any* maximizer, so the algorithm is genuinely nondeterministic in its output. Exercise 35.3-5 asks for a family of `n`-element instances on which the number of distinct solutions `GREEDY-SET-COVER` can return, purely from different tie-breaks, is **exponential** in `n`. All of them satisfy the ratio bound; they are not all the same size.
- **The randomized ratio bounds an expectation, not a run** — a randomized 8/7-approximation says nothing about what any single coin-flip assignment produces; it says the *expected* number of satisfied clauses is `7m/8`. It is nonetheless remarkable how much you get for nothing here: the algorithm never even looks at the formula.
- **LP relaxation buys you a solvable lower bound, but only a fractional one** — solving the relaxation is polynomial-time, yet its answer is not a cover at all until you round it, and rounding is where the factor of 2 is spent. The 1/2 threshold is what simultaneously guarantees feasibility (from the edge constraint) and bounds the loss (each rounded-up variable was already at least half-paid-for in the LP objective).
- **The unweighted algorithm does not carry over** — the source is direct about this: `APPROX-VERTEX-COVER` from Section 35.1, which simply grabs both endpoints of an arbitrary edge, can return a cover far from optimal once vertices carry weights, since a cheap-and-a-cheap pair and a cheap-and-an-expensive pair look identical to it.
- **Section 35.4 is an introduction, not a survey** — the source itself says it "only scratches the surface" of randomization and linear programming as approximation-design techniques, and defers further study to the chapter notes.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 35 "Approximation Algorithms", Section 35.3 "The set-covering problem" and Section 35.4 "Randomization and linear programming", pp. 1115-1124](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
