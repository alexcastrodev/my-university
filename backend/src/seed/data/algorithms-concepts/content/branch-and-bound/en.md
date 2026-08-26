---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand Branch and Bound as the standard exact technique for integer and combinatorial optimization problems where dynamic programming's overlapping-subproblems structure doesn't apply, but exhaustive enumeration is too slow: instead of checking every candidate solution one at a time, Branch and Bound organizes the whole solution space into a tree of subproblems, and uses a cheap-to-compute *bound* on each subtree to discard — prune — entire branches without ever inspecting a single solution inside them.

## Use Cases

- Solving Integer Linear Programs (ILP/PLI) exactly, where all or some decision variables must take integer values — project selection, facility location, task scheduling, and any allocation problem where a fractional answer (`2.25` trucks, `3.75` machines) has no real-world meaning.
- 0-1 (binary) integer programming specifically — knapsack-style selection problems where each item is either fully taken or not, and DP's `O(nW)` table becomes impractical once the capacity `W` is large (the sibling `knapsack-01-vs-fractional` concept's pseudo-polynomial DP is one alternative; Branch and Bound is the other, and the one that generalizes to constraints DP's table can't easily express).
- Combinatorial optimization problems in general (bin packing, the traveling salesman problem, set covering) where no polynomial-time exact algorithm is known, but a good bounding function still lets a solver skip the overwhelming majority of the search space in practice.
- Any situation where you need a *proof* of optimality, not just a good answer — Branch and Bound terminates having actually verified no better solution exists anywhere in the space, which a heuristic or metaheuristic search cannot claim.

## Deep Dive

### Why exhaustive search is not an option

A Branch and Bound problem starts life as an Integer Linear Program:

```
max   c^T x
s.t.  A x <= b
      x in Z^n   (some or all variables restricted to integers)
```

The tempting first idea — enumerate every integer point in the feasible region, evaluate the objective at each, keep the best — fails purely on the arithmetic of counting. Suppose all `n` decision variables are binary (0 or 1): the number of candidate assignments is `2^n`. For `n = 50`, that is already more than `10^15` combinations — far beyond what any exhaustive check can get through, even though 50 binary decision variables is a perfectly ordinary problem size in practice, not an extreme one. The real difficulty isn't the number of constraints or variables directly; it's that the feasible region of an integer program is a discrete lattice of points instead of the continuous, convex polytope a plain linear program enjoys, and convexity is exactly what lets a plain LP be solved in polynomial time. Integer programming in general is NP-hard: an efficient (polynomial-time) algorithm for the general case would imply P = NP. The goal, then, isn't to shrink the search space in advance — it's to avoid explicitly visiting the parts of it that provably cannot contain the optimum. That idea is called **implicit enumeration**, and Branch and Bound is its most widely used form.

### The LP relaxation: a bound for free

The key tool that makes implicit enumeration possible is the **LP relaxation** — take the integer program and simply drop the integrality restriction, leaving an ordinary linear program over the same objective and constraints:

```
max   c^T x
s.t.  A x <= b
      x in R^n     (relaxed: real-valued now, not integer)
```

This relaxation has one property that does all the work: every integer-feasible solution to the original problem is automatically feasible for the relaxation too (it's simply the special case where the real-valued solution happens to be integer), so the relaxation's optimal value can never be *worse* than the integer program's optimal value. For a maximization problem:

```
Z*_ILP <= Z*_LP
```

The relaxation's optimum is therefore a valid **upper bound** on the best integer solution achievable — and it's a bound you get "for free," since the relaxation is an ordinary LP, solvable efficiently (see the sibling `simplex-tabular-method` concept for how). If that upper bound ever drops at or below a value you can already achieve with a known integer solution, there is no need to look any further in that part of the tree — nothing there can possibly beat what you already have.

### The three mechanisms: branching, bounding, pruning

Branch and Bound combines exactly three operations, repeated until no work is left:

1. **Branching** — pick a subproblem whose LP relaxation gave a *fractional* value for some integer-restricted variable `x_i = v` (not a whole number), and split it into two new subproblems by adding a constraint that forces `x_i` to one side or the other of that fractional value: `x_i <= floor(v)` in one branch, `x_i >= ceil(v)` in the other. Every integer point that was feasible for the parent subproblem satisfies exactly one of these two new constraints, so branching never discards a legitimate candidate solution — it only partitions the search space into two smaller, disjoint pieces.
2. **Bounding** — solve each new subproblem's own LP relaxation to get its own upper bound.
3. **Pruning** — compare that bound against `Z*`, the value of the best integer-feasible solution found anywhere in the search *so far* (the **incumbent**). If the subproblem's upper bound is no better than the incumbent, discard the entire subproblem — every integer solution inside it is guaranteed no better than what's already in hand, so there is nothing to gain by exploring it further.

A subproblem's exploration also ends, without any pruning needed, whenever its own relaxation turns out to already be integer-valued (it's a legitimate candidate — compare it against the incumbent and possibly replace it) or infeasible (nothing there to find at all, discard outright). Only a subproblem whose relaxation is both fractional *and* whose bound still beats the incumbent needs to be branched further.

### A fully worked example, traced by hand

Consider maximizing `Z = 5x1 + 8x2` subject to `x1 + x2 <= 6`, `5x1 + 9x2 <= 45`, with `x1, x2` restricted to non-negative integers.

**Root.** The LP relaxation (dropping integrality) has its optimum at the intersection of the two constraints: `x1 = 2.25`, `x2 = 3.75`, `Z = 41.25`. Both variables are fractional; branch on `x2` (the choice here is arbitrary when more than one variable is fractional — either would do): `x2 <= 3` (subproblem S1) or `x2 >= 4` (subproblem S2). Every integer point that was feasible at the root satisfies one of these two, so nothing is lost by splitting.

- **S1** (`x2 <= 3`): relaxation optimum is `x1 = 3, x2 = 3`, `Z = 39` — already integer. This is the first integer-feasible solution found anywhere in the search, so it immediately becomes the **incumbent**: `Z* = 39`. No further branching is needed on S1 — its own relaxation is already the best anything inside it could be.
- **S2** (`x2 >= 4`): relaxation optimum is `x1 = 1.8, x2 = 4`, `Z = 41`. Fractional, and `41 > 39` — still promising, so S2 needs further branching, on `x1`: `x1 <= 1` (S3) or `x1 >= 2` (S4).
  - **S4** (`x1 >= 2`, inherited `x2 >= 4`): combining `x1 >= 2` and `x2 >= 4` with the constraint `x1 + x2 <= 6` forces `x1 + x2 >= 6`, so the only candidate point is `(2, 4)` — but `5(2) + 9(4) = 46 > 45` violates the second constraint. **Infeasible.** Discarded outright — there was never anything here to find.
  - **S3** (`x1 <= 1`, inherited `x2 >= 4`): relaxation optimum is `x1 = 1, x2 = 40/9 ≈ 4.44`, `Z ≈ 40.56`. Still fractional (`x2`), and `40.56 > 39` — still worth exploring, branch again on `x2`: `x2 <= 4` (S5) or `x2 >= 5` (S6).
    - **S5** (`x2 <= 4`, inherited `x1 <= 1`): relaxation optimum is `x1 = 1, x2 = 4`, `Z = 37` — integer, so it's a legitimate candidate. But `37 < Z* = 39` — it cannot beat the incumbent already in hand. **Pruned by bound**, even though its own solution was integer: an integer answer that's worse than what you already have still gets discarded.
    - **S6** (`x2 >= 5`, inherited `x1 <= 1`): combined with `x1 + x2 <= 6` and `x1 <= 1`, the only feasible integer candidate is `x1 = 0, x2 = 5` (checking `5(0) + 9(5) = 45 <= 45` confirms feasibility) — relaxation optimum here **is** `(0, 5)`, `Z = 40`. Integer, and `40 > 39` — this becomes the **new incumbent**, `Z* = 40`, superseding S1.

No open subproblem remains: S1 was closed (integer solution, though later superseded), S4 was closed (infeasible), S5 was closed (pruned by bound), S6 was closed (integer, and the new incumbent). Since nothing is left to explore, the incumbent is provably optimal:

```
x1* = 0,   x2* = 5,   Z* = 40
```

Branch and Bound didn't just find this — it *proved* it, by accounting for every point in the original feasible region as belonging to some subproblem that was either resolved directly or shown incapable of beating 40.

### Watch it happen: the search tree, pruned live

```viz
type: tree
insert root R | Root LP relaxation: x1=2.25, x2=3.75, Z=41.25 -- fractional, branch on x2.
insert S1 S1 parent=root side=left | Branch: x2<=3.
insert S2 S2 parent=root side=right | Branch: x2>=4.
mark S1 | S1's relaxation: x1=3, x2=3, Z=39 -- already integer!
recolor S1 best | First incumbent found: Z*=39.
mark S2 | S2's relaxation: x1=1.8, x2=4, Z=41 -- fractional, but 41 > 39, still promising. Branch on x1.
insert S3 S3 parent=S2 side=left | Branch: x1<=1.
insert S4 S4 parent=S2 side=right | Branch: x1>=2.
mark S4 | x1>=2 and x2>=4 force 5(2)+9(4)=46 > 45 -- infeasible.
recolor S4 pruned | Discarded: no feasible point exists in this subtree.
mark S3 | S3's relaxation: x1=1, x2≈4.44, Z≈40.56 -- fractional, 40.56 > 39, still promising. Branch on x2.
insert S5 S5 parent=S3 side=left | Branch: x2<=4.
insert S6 S6 parent=S3 side=right | Branch: x2>=5.
mark S5 | S5's relaxation: x1=1, x2=4, Z=37 -- integer, but 37 < current incumbent 39.
recolor S5 pruned | Discarded by bound: cannot beat the incumbent, even though its own solution is integer.
mark S6 | S6's relaxation: x1=0, x2=5, Z=40 -- integer, and 40 > 39.
recolor S6 best | New incumbent: Z*=40, superseding S1.
recolor S1 pruned | No longer the incumbent -- closed off, superseded by S6.
```

Only `root`, `S2`, and `S3` never get a persistent color: they were branched, not resolved directly, so their role in the final proof is "split into the subtrees that actually settled the question," not "produced or ruled out a candidate."

### Search strategy: which open subproblem to explore next

The algorithm above never specified an order for visiting open subproblems, because Branch and Bound's correctness doesn't depend on it — only its speed does. Two standard strategies:

- **Depth-first (LIFO / stack-based).** Always branch on the most recently created subproblem first, diving deep before backtracking. This finds *some* integer-feasible incumbent quickly (useful, since a tighter incumbent prunes more of the rest of the tree sooner), and uses memory proportional to the tree's depth rather than its breadth.
- **Best-bound-first (priority-queue-based).** Always branch on whichever open subproblem currently has the best (least-pruned) relaxation bound, regardless of where it sits in the tree. This tends to find the true optimum with fewer total subproblems explored, since it chases the most promising region first — but it can hold many more open subproblems in memory at once than a depth-first stack.

Neither strategy changes what the final answer is; both eventually resolve or prune every subproblem the same way the worked example did above. They only change how quickly a tight incumbent shows up, and therefore how many branches get pruned before ever being fully explored.

### Specializing to 0-1 (binary) integer programming

When every decision variable is restricted to `{0, 1}` rather than the general integers, the same three mechanisms apply with one simplification: a fractional relaxation value `x_i = v` (with `0 < v < 1`) branches into exactly `x_i = 0` and `x_i = 1` — there is no "which integer to round toward" ambiguity the way there is for a general integer variable, since 0 and 1 are the only two integers in range at all. This is the branch-and-bound treatment of the 0-1 knapsack problem and other binary selection problems: the LP relaxation (allowing each `x_i` to be any value in `[0, 1]`, not just 0 or 1) gives the bound, and rounding a fractional `x_i` toward 0 or 1 is exactly the split point for that variable's two branches.

### Generic pseudocode

```java
class Subproblem {
    // additional constraints layered on top of the original problem
    List<Constraint> extraConstraints;
}

double bestZ = Double.NEGATIVE_INFINITY;   // Z*: incumbent value, -infinity until one is found
int[] bestSolution = null;

Deque<Subproblem> open = new ArrayDeque<>();  // stack (DFS) or PriorityQueue (best-bound) -- same algorithm either way
open.push(new Subproblem(/* the original problem, no extra constraints yet */));

while (!open.isEmpty()) {
    Subproblem sub = open.pop();
    LPResult relaxed = solveLPRelaxation(sub);          // e.g. via simplex -- see simplex-tabular-method

    if (!relaxed.feasible) continue;                     // pruned: infeasible, nothing here
    if (relaxed.objectiveValue <= bestZ) continue;        // pruned: bound can't beat the incumbent

    if (relaxed.isInteger()) {
        bestZ = relaxed.objectiveValue;                   // resolved: a legitimate, better candidate
        bestSolution = relaxed.solution;
        continue;
    }

    int branchVar = relaxed.pickFractionalVariable();     // still fractional -- must branch further
    double v = relaxed.valueOf(branchVar);
    open.push(sub.withExtraConstraint(branchVar, "<=", Math.floor(v)));
    open.push(sub.withExtraConstraint(branchVar, ">=", Math.ceil(v)));
}
// bestSolution / bestZ is now provably optimal -- every subproblem was resolved or pruned.
```

## Trade-offs

- **Exact, and self-certifying — at the cost of worst-case exponential blowup.** Unlike a heuristic, Branch and Bound terminates having proven no better solution exists; but the search tree can still grow exponentially in the worst case, since pruning is only ever as effective as the bounding function is tight. A loose LP relaxation (one whose optimum sits far from the nearest integer point) prunes almost nothing, and the algorithm degenerates toward the exhaustive enumeration it was designed to avoid.
- **The order subproblems are explored in changes performance, never correctness.** Depth-first finds an incumbent fast and uses little memory; best-bound-first tends to need fewer total subproblems but can hold far more of them open in memory simultaneously. Neither strategy skips the proof step the other performs — both end with every region of the original feasible space accounted for.
- **A subproblem can be pruned for three entirely different reasons, and conflating them is a common mistake**: infeasibility (nothing there at all), an integer solution that's simply worse than the current incumbent (a legitimate candidate, just not the best one — S5 in the worked example above), and a fractional bound that's already no better than the incumbent (pruned without ever even knowing whether an integer solution exists in there). Only the third case is "pruning" in the sense of skipping work that might otherwise have been necessary; the other two are just normal termination conditions.
- **Rounding the LP relaxation's answer is not a substitute for Branch and Bound.** The root relaxation above gives `x1 = 2.25, x2 = 3.75`; naively rounding to `(2, 4)` is exactly subproblem S4 — infeasible. The true optimum, `(0, 5)`, isn't even close to the rounded guess in either coordinate, which is precisely why systematic branching (not ad hoc rounding) is required once integrality actually matters.

## Documentation Links

- [Hamdy A. Taha, *Operations Research: An Introduction*, 10th Edition (Pearson, 2017) — Chapter on Integer Linear Programming (Branch and Bound and 0-1 implicit enumeration)](https://www.pearson.com/en-us/subject-catalog/p/operations-research-an-introduction/P200000003528/9780137526567) — book
- [Branch and bound — Wikipedia](https://en.wikipedia.org/wiki/Branch_and_bound) — doc
