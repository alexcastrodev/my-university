---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Learn the modeling skill that Cormen et al. call "perhaps the most important aspect of linear programming": recognizing when a problem can be written as a **linear program** — maximize or minimize a linear objective subject to a finite set of linear constraints — and then writing it down in standard form. Then learn **duality**: the mechanical recipe that turns a maximization LP into a minimization LP with the same optimal value, and why that gives you a *certificate* that a solution is optimal rather than merely the best one your solver happened to find. This concept deliberately stops where the 4th edition itself stops: it does **not** teach the simplex algorithm. The book's preface says it removed the detailed presentation of simplex "as it was math heavy without really conveying many algorithmic ideas," and Section 29.1 says outright that the known LP algorithms "are all too complicated to show here." What you get instead — and what this concept covers — is formulation, the geometric intuition for why an optimum sits at a vertex, and the duality theory.

## Use Cases

- Turning a resource-allocation problem that has no textbook algorithm — an airline scheduling flight crews under FAA hour limits, an oil company choosing drilling sites under a fixed budget — into an LP and handing it to an off-the-shelf solver. The source's framing is blunt: once you cast a problem as a polynomial-sized linear program, you can solve it in polynomial time, and several LP software packages will do it for you.
- Modeling *variants* of graph problems you already know how to solve, where the variant breaks the specialized algorithm. Adding a per-edge cost and a fixed flow demand to max-flow gives minimum-cost flow; splitting the flow into several commodities sharing one network gives multicommodity flow — for which, the source notes, the only known polynomial-time algorithm is "express it as an LP and solve the LP."
- Proving a solution optimal by exhibiting a dual solution with the same objective value — the same move as exhibiting a cut whose capacity equals a flow's value in the sibling Max-Flow Min-Cut concept, which CLRS explicitly presents as the motivating example of duality.
- Knowing when the LP framing *stops* helping: adding "and all variables must be integers" turns it into an **integer linear program**, and just finding a feasible solution to that is NP-hard (Exercise 34.5-3), which ties directly into the sibling P vs. NP and reducibility concept.

## Deep Dive

### Standard form: what a linear program actually is

Given real coefficients `a_1 … a_n` and variables `x_1 … x_n`, a **linear function** is `f(x_1, …, x_n) = a_1·x_1 + a_2·x_2 + … + a_n·x_n`. Setting a linear function equal to a real number `b` gives a **linear equality**; requiring it to be `<= b` or `>= b` gives a **linear inequality**; both are **linear constraints**. Strict inequalities (`<`, `>`) are not allowed. A linear-programming problem is then: minimize or maximize a linear function subject to a finite set of linear constraints.

By convention a maximization LP is written in **standard form**: find `x_1 … x_n` that

- **maximize** `sum over j of c_j·x_j`  (the **objective function**)
- **subject to** `sum over j of a_ij·x_j <= b_i` for `i = 1 … m`
- and `x_j >= 0` for `j = 1 … n`  (the **nonnegativity constraints**)

or compactly, with an `m × n` matrix `A = (a_ij)`, an `m`-vector `b`, and `n`-vectors `c` and `x`: **maximize `cᵀx` subject to `Ax <= b`, `x >= 0`**. That's the whole input format, and it's small enough to model directly:

```java
// Standard form (CLRS 29.14-29.16): maximize c'x subject to Ax <= b, x >= 0.
// a is m x n, b has length m, c has length n.
record StandardFormLp(double[][] a, double[] b, double[] c) {

    /** The objective value of a particular setting of the variables (CLRS writes it x-bar). */
    double objectiveValue(double[] x) {
        double total = 0;
        for (int j = 0; j < c.length; j++) total += c[j] * x[j];
        return total;
    }

    /** Feasible = satisfies every constraint, including nonnegativity. Otherwise infeasible. */
    boolean isFeasible(double[] x) {
        for (double xj : x) {
            if (xj < 0) return false;                       // nonnegativity constraints
        }
        for (int i = 0; i < b.length; i++) {
            double lhs = 0;
            for (int j = 0; j < c.length; j++) lhs += a[i][j] * x[j];
            if (lhs > b[i]) return false;                   // constraint i violated
        }
        return true;
    }
}
```

The vocabulary that goes with it, all from Section 29.1:

- A setting of the variables that satisfies every constraint is a **feasible solution**; one that violates at least one constraint is **infeasible**.
- The set of all points satisfying all constraints is the **feasible region**.
- A feasible solution whose objective value is maximum over all feasible solutions is an **optimal solution**, and that value is the **optimal objective value**.
- An LP with no feasible solutions at all is **infeasible**; one with feasible solutions but no finite optimal objective value is **unbounded** (and so is its feasible region). The converse doesn't hold: Exercise 29.1-5 asks you to build an LP whose feasible region is unbounded but whose optimal objective value is finite.

Standard form is a convention, not a restriction. Real problems arrive with equality constraints, `>=` constraints, variables allowed to go negative, or a minimization objective; the source leaves the conversions as exercises rather than working them (29.1-6: turn an equality into a pair of inequalities, and turn a `<=` inequality into an equality by introducing a nonnegative slack variable `s`; 29.1-7: turn a minimization into an equivalent maximization).

### Why the optimum sits at a vertex — the two-variable picture

This is the one worked algorithmic illustration Section 29.1 gives, and it is explicitly labeled as intuition rather than as an algorithm: "Although this example does not immediately generalize to an efficient algorithm for larger problems, it introduces some important concepts."

The example LP (29.17-29.21):

| | |
|---|---|
| maximize | `x_1 + x_2` |
| subject to | `4·x_1 - x_2 <= 8` |
| | `2·x_1 + x_2 <= 10` |
| | `5·x_1 - 2·x_2 >= -2` |
| | `x_1, x_2 >= 0` |

Each constraint is a half-plane; their intersection is the feasible region, which is **convex** (for any two points in it, the whole segment between them is in it too). It contains infinitely many points, so "evaluate the objective at every feasible point" is a non-starter — you need a way to find the maximum without enumerating.

In two dimensions you can do it graphically. The set of points where `x_1 + x_2 = z` is a line of slope `-1`; `z = 0` is that line through the origin, and increasing `z` slides the line outward. The intersection of the line with the feasible region is exactly the set of feasible solutions of objective value `z`, so the answer is the largest `z` whose line still touches the region. CLRS's Figure 29.2(b) draws `z = 0`, `z = 4`, and `z = 8`, and the last one touches the region at a single point: **`x_1 = 2`, `x_2 = 6`, objective value `8`** — a *vertex* of the feasible region. (Check: `4·2 - 6 = 2 <= 8`; `2·2 + 6 = 10`, tight; `5·2 - 2·6 = -2`, tight — the optimum is where constraints 29.19 and 29.20 meet.)

That the optimum lands on a vertex is not luck. The largest `z` whose line meets the region must meet it on the *boundary*, and that intersection is either a single vertex (one optimal solution) or a line segment (in which case every point of the segment ties, including both endpoints — which are vertices). Either way there is an optimal solution at a vertex.

The same intuition carries up: with three variables each constraint is a half-space, the objective's level set is a plane, and pushing that plane away from the origin along the objective's normal finds increasing objective values. With `n` variables each constraint is a half-space in `n`-dimensional space, the feasible region formed by intersecting them is called a **simplex**, the objective's level set is a hyperplane, and by convexity an optimal solution still occurs at a vertex.

That vertex fact is the entire algorithmic idea the chapter conveys about **simplex**: it starts at some vertex of the simplex and iterates, each iteration moving along an edge to a neighboring vertex whose objective value is no smaller (usually larger), stopping at a local maximum — a vertex all of whose neighbors are worse. Because the region is convex and the objective is linear, that local optimum is a global optimum. **That is all the mechanism the source gives.** There is no pivoting rule, no tableau, no `SIMPLEX` pseudocode, and no worked pivot sequence in this edition — the chapter defers the *proof* that the returned vertex is optimal to duality in Section 29.3, and defers the algorithms themselves to the chapter notes.

What the source does state about the algorithm landscape:

- **Simplex** is the most commonly deployed method and often solves general LPs quickly in practice, but on carefully contrived inputs it can require exponential time (the chapter notes credit Klee and Minty with an instance forcing `2^n - 1` iterations).
- **Ellipsoid algorithms** were the first polynomial-time method for LP (Khachian, 1979) but run slowly in practice.
- **Interior-point methods** are also polynomial-time. Where simplex walks the *exterior* of the feasible region, keeping a vertex at every iteration, interior-point methods move through the *interior* — intermediate solutions are feasible but not vertices, though the final solution is a vertex. On large inputs they can match or beat simplex.
- Any LP algorithm must also detect the LPs with no solution and the LPs with no finite optimal solution.
- **General LP is solvable in polynomial time. Integer LP is not known to be** — Exercise 34.5-3 shows that merely finding a feasible solution to an integer linear program is NP-hard.

### Formulating problems as linear programs

Section 29.2 is the heart of the chapter, and it is all modeling. Note the notation shift: LPs use subscripted variables rather than the attribute notation of Part VI, so the shortest-path estimate for vertex `v` is `d_v` (not `v.d`) and the flow from `u` to `v` is `f_uv` (not `(u,v).f`), while inputs keep their usual names `w(u,v)` and `c(u,v)`.

**Single-pair shortest path.** Given a weighted directed graph, source `s`, and destination `t`, the triangle inequality gives `d_v <= d_u + w(u,v)` for every edge `(u,v)`, and the source starts at `d_s = 0`:

- **maximize** `d_t`
- **subject to** `d_v <= d_u + w(u,v)` for each edge `(u,v)` in `E`
- `d_s = 0`

The surprise is the *maximize*. Minimizing would be wrong: with nonnegative edge weights, setting every `d_v = 0` satisfies every constraint and would be "optimal" without solving anything. The shortest-path solution sets each `d_v` to the minimum of `d_u + w(u,v)` over incoming edges, i.e. `d_v` is the *largest* value that is still `<=` all of those bounds — so pushing the estimates up as far as the constraints allow is exactly right, and maximizing `d_t` achieves it. The LP has `|V|` variables and `|E| + 1` constraints. (Extending it to single-source shortest paths for all `v` is Exercise 29.2-2.)

Generating those constraints from a graph is mechanical, which is the point — modeling is the work, solving is a library call:

```java
// Builds the constraint list for the single-pair shortest-path LP (CLRS 29.22-29.24).
// One inequality d_v - d_u <= w(u,v) per edge, plus d_s = 0; objective is "maximize d_t".
// Rows are indexed by vertex id, one variable d_v per vertex.
List<double[]> shortestPathConstraintRows(List<Edge> edges, int vertexCount) {
    List<double[]> rows = new ArrayList<>();
    for (Edge e : edges) {
        double[] row = new double[vertexCount + 1]; // last cell holds the right-hand side b_i
        row[e.to()]   = 1;                          //  d_v
        row[e.from()] = -1;                         // -d_u
        row[vertexCount] = e.weight();              // <= w(u,v)
        rows.add(row);
    }
    return rows; // d_s = 0 is added separately as an equality constraint
}
```

**Maximum flow.** The capacity constraint and flow conservation are already linear, and a flow's value is a linear function, so max-flow transcribes directly (assuming `c(u,v) = 0` for non-edges and no antiparallel edges):

- **maximize** `sum over v of f_sv  -  sum over v of f_vs`  (flow out of the source minus flow into it)
- **subject to** `f_uv <= c(u,v)` for each `u, v` in `V`
- `sum over v of f_vu = sum over v of f_uv` for each `u` in `V - {s, t}`  (conservation)
- `f_uv >= 0` for each `u, v` in `V`

As written this has `|V|²` variables and `2|V|² + |V| - 2` constraints, because it carries a variable for every *pair* of vertices, edge or not. The source flags that smaller LPs solve faster and leaves the `O(V + E)`-constraint rewrite as Exercise 29.2-4 — a useful reminder that a correct formulation and an efficient one are different achievements. The sibling Max-Flow Min-Cut concept covers Ford-Fulkerson, and CLRS is explicit that a purpose-built algorithm such as Dijkstra's or Ford-Fulkerson will often beat LP on these problems in both theory and practice.

**Minimum-cost flow.** This is where LP earns its keep. Add a cost `a(u,v)` per edge and a flow demand `d`: send exactly `d` units from `s` to `t` while minimizing total cost `sum over edges of a(u,v)·f_uv`. The LP is the max-flow one with the objective replaced and one constraint added:

- **minimize** `sum over (u,v) in E of a(u,v)·f_uv`
- **subject to** the same capacity and conservation constraints, plus `sum over v of f_sv - sum over v of f_vs = d`, and `f_uv >= 0`

CLRS's Figure 29.3 works a small instance that ships 4 units from `s` to `t` at a minimum total cost of `(2·2) + (5·2) + (3·1) + (7·1) + (1·3) = 27`. (The figure's per-edge capacity and cost labels are too garbled in this extract to reproduce faithfully, so only the totals are quoted here.) Polynomial-time algorithms specific to minimum-cost flow exist but are out of the book's scope; the LP formulation is the tool it hands you.

**Multicommodity flow.** `k` commodities `K_i = (s_i, t_i, d_i)` share one capacitated network; `f_i,uv` is commodity `i`'s flow on `(u,v)` and the **aggregate flow** `f_uv` is the sum over commodities, which is what the capacity applies to. There is no objective at all — the question is only whether such a flow exists — so the LP has a "null" objective, literally **minimize `0`**, subject to aggregate capacity, per-commodity conservation, per-commodity demand, and nonnegativity. **The only known polynomial-time algorithm for this problem is to express it as a linear program and solve it with a polynomial-time LP algorithm.** That single sentence is the strongest case the chapter makes for learning to formulate.

The chapter also points at LP appearances elsewhere in the book: systems of difference constraints (Section 22.4) are a special case of LP already seen, and Section 35.4 uses linear programming as a tool to find an approximate solution to a graph problem — the technique that connects LP to the sibling Approximation Algorithms concept. (This extract only names that connection; it doesn't develop it.)

### Duality: the smallest upper bound on the primal

Given a maximization problem, duality gives you a related minimization problem with the same optimal objective value. The original LP is called the **primal**; the derived one is the **dual**.

The construction is mechanical. From the primal `maximize sum_j c_j·x_j subject to sum_j a_ij·x_j <= b_i, x_j >= 0`:

- **minimize** `sum over i of b_i·y_i`
- **subject to** `sum over i of a_ij·y_i >= c_j` for `j = 1 … n`
- `y_i >= 0` for `i = 1 … m`

In words: change maximize to minimize, swap the roles of the objective coefficients and the right-hand sides, and replace each `<=` with `>=`. Each of the `m` primal constraints becomes a dual variable `y_i`; each of the `n` dual constraints corresponds to a primal variable `x_j`. Read off the indices, the constraint matrix is transposed — `a_ij` is summed over `j` in the primal and over `i` in the dual:

```java
// The dual of a standard-form maximization LP (CLRS 29.31-29.36):
// primal  max c'x  s.t. Ax <= b, x >= 0
// dual    min b'y  s.t. A'y >= c, y >= 0
record DualLp(double[][] aTransposed, double[] c, double[] b) { }   // min b'y s.t. A'y >= c, y >= 0

DualLp dualOf(StandardFormLp p) {
    int m = p.b().length, n = p.c().length;
    double[][] at = new double[n][m];
    for (int i = 0; i < m; i++)
        for (int j = 0; j < n; j++)
            at[j][i] = p.a()[i][j];                 // transpose
    return new DualLp(at, p.c(), p.b());            // c becomes the RHS, b becomes the objective
}
```

The source's worked pair (29.37-29.46). Primal:

| | |
|---|---|
| maximize | `3·x_1 + x_2 + 4·x_3` |
| subject to | `x_1 + x_2 + 3·x_3 <= 30` |
| | `2·x_1 + 2·x_2 + 5·x_3 <= 24` |
| | `4·x_1 + x_2 + 2·x_3 <= 36` |
| | `x_1, x_2, x_3 >= 0` |

Its dual:

| | |
|---|---|
| minimize | `30·y_1 + 24·y_2 + 36·y_3` |
| subject to | `y_1 + 2·y_2 + 4·y_3 >= 3` |
| | `y_1 + 2·y_2 + y_3 >= 1` |
| | `3·y_1 + 5·y_2 + 2·y_3 >= 4` |
| | `y_1, y_2, y_3 >= 0` |

**Why those numbers mean something.** Each primal constraint is an upper bound on a combination of the variables, and adding nonnegative multiples of constraints yields another valid constraint. Add the first two primal constraints: `3·x_1 + 3·x_2 + 8·x_3 <= 54`. Compare that with the objective `3·x_1 + x_2 + 4·x_3`: every coefficient on the left is at least the corresponding objective coefficient, and the variables are nonnegative, so

`3·x_1 + x_2 + 4·x_3  <=  3·x_1 + 3·x_2 + 8·x_3  <=  54`

— the primal's optimal value is at most 54, proven by combining two constraints. Generalize: for any nonnegative multipliers `y_1, y_2, y_3`, combining the constraints gives `(y_1 + 2·y_2 + 4·y_3)·x_1 + (y_1 + 2·y_2 + y_3)·x_2 + (3·y_1 + 5·y_2 + 2·y_3)·x_3 <= 30·y_1 + 24·y_2 + 36·y_3`. Whenever each `x_j` coefficient on the left is at least its objective coefficient — which is precisely the dual's three constraints — the right-hand side is a valid upper bound on the primal optimum. The multipliers must be nonnegative or you couldn't combine the inequalities at all, which is where `y >= 0` comes from. And you want the *tightest* such bound, so you minimize `30·y_1 + 24·y_2 + 36·y_3`. **The dual is exactly the problem of finding the smallest provable upper bound on the primal.**

**Weak duality (Lemma 29.1).** For any feasible primal `x̄` and any feasible dual `ȳ`: `sum_j c_j·x̄_j <= sum_i b_i·ȳ_i`. The proof is two substitutions: replace each `c_j` by the larger `sum_i a_ij·ȳ_i` (dual feasibility), swap the order of summation, then replace `sum_j a_ij·x̄_j` by the larger `b_i` (primal feasibility).

**The certificate (Corollary 29.2).** If a feasible primal solution and a feasible dual solution happen to have *equal* objective values, both are optimal. Weak duality caps every primal value by every dual value, so once they meet, neither can improve. This is the practical payoff: you don't need to trust the solver's search, you need a matching pair.

**Strong duality (Theorem 29.4).** If the primal and its dual are both feasible and bounded, then for optimal solutions `x*` and `y*`, `cᵀx* = bᵀy*`. The proof in this section runs by contradiction: let `δ` be the dual's optimal value, form an *augmented primal* that adds the constraint `cᵀx >= δ` (rewritten as `-cᵀx <= -δ` so the whole system is `<=`), and observe that any feasible solution to that augmented system would finish the theorem via weak duality. To show the augmented system is feasible, assume it isn't and apply **Farkas's lemma (Lemma 29.3)** — given `M` and `g`, exactly one of "there exists `v` with `M·v <= g`" or "there exists `w >= 0` with `wᵀM = 0` and `wᵀg < 0`" is true. Infeasibility forces the second alternative, whose `w` splits into a dual-shaped vector and a scalar; the two cases (scalar zero, scalar positive) each construct a *feasible dual solution with objective value strictly below `δ`*, contradicting `δ` being optimal. The chapter leaves the proof of Farkas's lemma itself to Problem 29-4.

**The fundamental theorem (Theorem 29.5).** Any LP in standard form either has an optimal solution with a finite objective value, or is infeasible, or is unbounded — there is no fourth outcome. (Its proof is Exercise 29.3-8.)

**You have already seen duality.** CLRS introduces the whole section by pointing at the max-flow min-cut theorem (Theorem 24.6): given a flow `f`, exhibiting a cut of capacity `|f|` proves `f` is maximum. That is duality's shape exactly — a maximization problem paired with a minimization problem whose optima coincide. The exercises make the correspondence literal: Exercise 29.3-3 asks you to write the dual of the max-flow LP and interpret it as the minimum-cut problem, and Exercise 29.3-6 asks which Chapter 24 result *is* weak duality for max-flow. The sibling Max-Flow Min-Cut concept covers that theorem and its constructive proof in detail; this concept is the general theory it turns out to be an instance of.

Duality also has a boundary worth knowing: Problem 29-3 asks you to show that weak duality still holds for *integer* linear programs, but strong duality does **not** — the primal and dual integer optima can straddle the common LP optimum, `IP <= P = D <= ID`. That gap between an integer program and its LP relaxation is the seam that LP-based approximation algorithms work in.

## Trade-offs

- **A purpose-built algorithm usually beats the LP formulation on problems that have one.** CLRS says so directly: an algorithm designed for a specific problem, such as Dijkstra's for single-source shortest paths, "will often be more efficient than linear programming, both in theory and in practice." LP's real value is on problems with *no* known specialized algorithm (the chapter's politician-budget scenario, minimum-cost flow, multicommodity flow), and on variants where a small change to the problem breaks the specialized algorithm but costs one line in the LP.
- **A correct formulation and an efficient formulation are different things.** The max-flow LP as written carries `|V|²` variables and `2|V|² + |V| - 2` constraints because it allocates a variable per vertex *pair*; Exercise 29.2-4 asks for the `O(V + E)`-constraint version. Since solve time depends on the LP's size, "it's polynomial-sized" is the bar for tractability, not the bar for a good model.
- **Adding integrality destroys the guarantee.** General LP is solvable in polynomial time, but requiring the variables to be integers makes even *finding a feasible solution* NP-hard (Exercise 34.5-3), so there is no known polynomial-time algorithm for integer linear programming. If your model needs "assign whole crews" or "either drill here or don't," you are no longer in the tractable world — see the sibling P vs. NP and reducibility concept for what to do next.
- **Polynomial-time and fast are not the same claim here.** The polynomial-time algorithms are the ellipsoid method (which "runs slowly in practice" and does not appear competitive with simplex) and interior-point methods (competitive, sometimes faster, on large inputs); the algorithm most commonly deployed, simplex, is exponential in the worst case yet performs well in practice. Worst-case complexity is a poor predictor of which LP solver to reach for.
- **Strong duality's guarantee is conditional; weak duality's is not.** Theorem 29.4 requires both the primal and the dual to be feasible and bounded. Weak duality (Lemma 29.1) needs only feasibility on both sides, which is enough for the useful direction: any feasible dual solution is a proven upper bound on the primal optimum, even before you know the optimum. Use it as a stopping criterion and a sanity check on a solver's output.
- **This chapter teaches modeling, not solving — plan accordingly.** The 4th edition removed the detailed simplex presentation on purpose, and Section 29.1 states the LP algorithms are "all too complicated to show here." You can finish this material able to write a correct LP and to certify optimality via duality, but not able to implement a solver; the chapter notes point at dedicated LP books (Chvátal, Gass, Karloff, Schrijver, Vanderbei) for that, and the practical path is a solver library.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 29 "Linear Programming", Sections 29.1-29.3, pp. 853-876](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
