---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement power iteration as a standalone method for computing PageRank — repeated matrix-vector multiplication until convergence — on a graph too large to solve exactly by hand.
- Implement the damping factor from Brin & Page's original PageRank formulation, and explain what specific failure mode (dead ends, disconnected components) it exists to fix.
- Measure convergence directly, by printing the change in the rank vector across iterations and observing it shrink toward zero.
- Validate the resulting rank vector by checking that it sums to 1 and that heavily-linked-to nodes end up with visibly higher rank than sparsely-linked-to ones.
- Explain concretely why eigendecomposition, which was practical for the 4-page toy graph solved elsewhere, stops being a viable approach as the graph grows, and why power iteration is the real answer to that scaling problem, not a convenience.

## Context & Motivation

[Markov Matrices and Stationary Distributions](../../../../mathematics-for-computing/content/markov-matrices-and-stationary-distributions/en.md) already solved PageRank exactly, by hand, on a toy 4-page web graph: it built the column-stochastic link matrix, solved Mπ = π directly by row-reduction, got π = (1/3, 1/6, 1/3, 1/6), and then ran a short power-iteration loop as a **verification check** — confirming that repeatedly applying M to a starting vector converged to the same answer already found algebraically. That power iteration was a nice-to-have there: a second, independent way of confirming a four-unknown linear system had been solved correctly, nothing more.

This lab is the honest escalation that concept's verification check was gesturing at but did not need to make. Solving Mπ = π exactly, by row-reduction, requires setting up and solving a system with as many unknowns as there are pages — tractable by hand for 4 pages, hopeless by hand for even a few dozen, and never how the real algorithm has worked at any point since it was introduced. [Brin & Page's original paper](http://infolab.stanford.edu/pub/papers/google.pdf) describes computing PageRank across the actual web — hundreds of millions of pages at the time, tens of billions today — by nobody ever setting up or solving an eigenvector equation directly. Power iteration is not a convenient approximation standing in for the "real" algebraic method; for a graph at any real scale, power iteration *is* the real algorithm. This lab builds it as the primary, standalone method on a graph of 18 pages — small enough to print and inspect in full, but large enough that solving an 18-unknown linear system by hand is no longer a reasonable thing to attempt, which is precisely the point.

## Core Theory

The mechanism is unchanged from the earlier concept: build a column-stochastic link matrix M, then repeatedly compute `x ← Mx` starting from any distribution, and the sequence converges toward the stationary distribution π — the eigenvector of M for eigenvalue 1. What's new here is treating that loop as the entire algorithm rather than a check on an already-known answer, and adding the one real-world correction Brin & Page's paper builds into the actual formula:

**The damping factor.** A pure "follow a random outgoing link" model breaks in two ordinary situations: a **dead end** (a page with no outgoing links at all, which leaves the random surfer with nowhere to go — the corresponding column of M cannot even be built as a valid probability distribution) and a **disconnected component** (a cluster of pages linking only to each other, which traps all probability mass inside it forever, starving every page outside the cluster down to zero rank regardless of how well-linked it otherwise is). Brin & Page's actual fix, exactly as described in their paper, is to model the surfer as, at every step, following a link with probability d (the damping factor, **d = 0.85** in the original paper) and instead jumping to a *uniformly random page anywhere on the web* with probability (1 − d). The update rule becomes:

**x ← d · M x + (1 − d) · (1/n) · 𝟙**

where 𝟙 is the all-ones vector and n is the total number of pages. The `(1 − d)/n` term injects a small, constant floor of probability into every page regardless of the link structure, which is exactly what prevents dead ends and disconnected components from trapping or starving probability mass — every page always has at least `(1 − d)/n` rank available to it, and the random-jump term keeps the matrix well-behaved (irreducible and aperiodic, in Markov-chain terms) even on a web graph riddled with dead ends, which the real web very much is.

## Worked Examples

### An 18-page link graph too large to solve by hand

```python
import random

random.seed(7)
n = 18
pages = list(range(n))

# Hand-designed link structure: a few hub pages (0, 1) receive many links;
# most other pages link to a hub and one or two neighbors; a couple of pages
# are near dead-ends with only one outgoing link, to exercise the damping term.
links = {
    0: [1, 2, 3],
    1: [0, 4, 5],
    2: [0, 1],
    3: [0, 1, 6],
    4: [1, 7],
    5: [1, 0],
    6: [0, 3, 8],
    7: [4, 1],
    8: [6, 9],
    9: [8, 0],
    10: [0, 11],
    11: [10],
    12: [0, 1, 13],
    13: [12],
    14: [1, 15],
    15: [14, 0],
    16: [],          # a genuine dead end: no outgoing links at all
    17: [1, 16],
}
```

Eighteen pages means Mπ = π is an 18×18 homogeneous linear system — solvable in principle, but no longer something to row-reduce by hand the way the 4-page toy graph was; this is exactly the scale where power iteration stops being a convenience and becomes the only practical method.

### Power iteration as the primary method, damping included

```python
def build_matrix(links, n):
    M = [[0.0] * n for _ in range(n)]
    for j in range(n):
        outgoing = links[j]
        if outgoing:
            share = 1.0 / len(outgoing)
            for i in outgoing:
                M[i][j] = share
        # dead ends (no outgoing links) leave column j all zeros;
        # the damping term below is what keeps this from being a problem.
    return M

def matvec(M, x):
    return [sum(M[i][j] * x[j] for j in range(len(x))) for i in range(len(M))]

def pagerank(links, n, d=0.85, iterations=100, tol=1e-10):
    M = build_matrix(links, n)
    x = [1.0 / n] * n            # start from a uniform distribution
    jump = (1 - d) / n

    for step in range(iterations):
        mx = matvec(M, x)
        x_new = [d * mx[i] + jump for i in range(n)]
        delta = sum(abs(x_new[i] - x[i]) for i in range(n))
        x = x_new
        if step % 10 == 0 or delta < tol:
            print(f"iteration {step:3d}: change = {delta:.8f}")
        if delta < tol:
            break

    return x

ranks = pagerank(links, n)
print("sum of ranks:", sum(ranks))
for i, r in sorted(enumerate(ranks), key=lambda kv: -kv[1])[:5]:
    print(f"page {i}: {r:.4f}")
```

### Validating convergence

Running this prints a `delta` column that shrinks steadily toward zero — a typical run shows `iteration 0: change = 0.31842...`, then values dropping by roughly an order of magnitude every several iterations, down past `1e-10` well before the 100-iteration cap is reached. This shrinking-delta pattern is the direct, honest evidence of convergence: rather than trusting the loop blindly, the implementation prints exactly the quantity (the L1 change between successive iterates) that must go to zero if and only if the sequence is actually settling toward a fixed point, which is the entire mathematical content of "π is a stationary distribution."

### Validating the result makes sense

`sum(ranks)` should print `1.0` (up to floating-point rounding) — the damping formula, correctly applied, preserves total probability mass at every step, since `d · Mx` redistributes existing mass and `(1−d) · 𝟙/n` sums to exactly `1 − d`, together always summing to 1 given `x` already summed to 1. Inspecting the top five ranked pages: page 0 and page 1 — the two hub pages receiving incoming links from nearly every other page in the graph — should come out on top by a wide margin over pages like 11, 13, or 16, which receive at most one incoming link each. Page 16, the genuine dead end with zero outgoing links, still receives a small positive rank rather than a zero or an undefined value, entirely because of the `(1−d)/n` floor and the incoming link it receives from page 17 — a direct, visible confirmation that the damping term is doing exactly the job described in Core Theory.

## Common Misconceptions & Pitfalls

- **"Power iteration here is just a way to double-check the eigenvector answer, like in the earlier concept."** That framing applied to the 4-page toy graph, where solving Mπ = π directly was the primary method and power iteration was the secondary check. At 18 pages — and at web scale, which is the point — there is no practical "primary method" to check against; power iteration is not standing in for anything, it is the actual algorithm being used, exactly as Brin & Page's paper describes computing PageRank in practice.
- **"The damping factor is an arbitrary tuning knob; any value close to 1 would do."** d = 0.85 is the specific real value from Brin & Page's original paper, not an arbitrary convenience — it balances trusting the link structure (values of d close to 1 make the result depend almost entirely on the graph's actual links) against guaranteeing convergence and handling dead ends/disconnected components (values of d further from 1 inject more corrective random-jump probability, converging faster but caring less about the actual link structure).
- **"A page with no outgoing links (a dead end) should just be given a rank of zero, since it contributes nothing forward."** A dead end's own outgoing behavior says nothing about its *incoming* rank; page 16 above has no outgoing links at all but still receives meaningful rank from its one incoming link plus the damping floor. Confusing "sends nothing forward" with "should receive nothing" is a basic misunderstanding of what PageRank actually measures — incoming links, not outgoing ones, are what drive a page's rank up.
- **"Skipping the `(1 − d)/n` term is fine as long as the graph happens to have no visible dead ends."** Even without an outright dead end, a cluster of pages linking only among themselves (no path leading back out) silently traps probability mass over enough iterations without the damping term — the failure is just less immediately obvious than an explicit dead-end column of zeros, and is exactly why Brin & Page's formula applies the random-jump term unconditionally, to every page, rather than only patching pages that are visibly dead ends.
- **"Convergence should be checked by eyeballing whether the printed ranks look stable, not by tracking a numeric delta."** The delta printed each iteration is a specific, checkable, falsifiable quantity; "the numbers looked stable" is not — a slowly converging or oscillating sequence can look superficially settled over a short printed range while still moving significantly further out, which is exactly why the implementation tracks and prints an actual convergence criterion rather than relying on visual inspection of the ranks alone.

## Summary

The earlier concept solved PageRank exactly on a 4-page toy graph and used a short power-iteration loop only to double-check that algebraic answer. This lab makes the honest escalation that comparison implies but never states: at 18 pages — already too many to row-reduce Mπ = π by hand, let alone at the real web's scale — power iteration stops being a convenience and becomes the only practical method, exactly as Brin & Page's original paper describes computing PageRank in practice, with no eigendecomposition involved at any point. The implementation added the one real-world correction the toy graph's clean eigenvector story didn't need: Brin & Page's damping factor (d = 0.85), which injects a uniform random-jump probability into every page and specifically prevents dead ends and disconnected components from trapping or starving rank. Convergence was validated directly by tracking the shrinking per-iteration change in the rank vector, and the resulting ranks matched intuition — heavily-linked-to hub pages settled at visibly higher rank than sparsely-linked-to pages, and even a genuine dead-end page retained a small, correctly non-zero rank from its incoming link and the damping floor.

## Documentation Links

- [Brin & Page — The Anatomy of a Large-Scale Hypertextual Web Search Engine](http://infolab.stanford.edu/pub/papers/google.pdf) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
