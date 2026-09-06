---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain what clustering asks for, given only unlabeled data: grouping points so that points within a group are more similar than points across groups.
- State the k-means algorithm precisely: initialize k centers, then alternate between assigning points and recomputing centers.
- Trace, by hand, several iterations of k-means on a small 2D dataset until convergence.
- Explain why k-means is not guaranteed to find the globally best clustering, and why the number of clusters k must be chosen in advance.

## Context & Motivation

Every model covered so far in this discipline has been supervised — trained on data where each example already carries a known label or target value. K-means clustering is this discipline's first genuinely unsupervised algorithm: given only raw feature vectors with no labels at all, it asks the model to discover a grouping structure on its own. This is a real shift in what "learning" even means: there is no ground truth to check a clustering assignment against, only an internal notion of what makes a good grouping (points close to their own cluster's center, far from other clusters' centers).

## Core Theory

### The algorithm

K-means groups `N` points into `k` clusters (`k` chosen in advance) by the following iterative procedure:

1. **Initialize**: pick `k` initial cluster centers (commonly, `k` random points from the dataset).
2. **Assign**: assign every point to its nearest center (by Euclidean distance).
3. **Update**: recompute each center as the mean of all points currently assigned to it.
4. **Repeat** steps 2–3 until assignments stop changing (convergence).

### Why this converges

Each iteration of k-means can only decrease (or leave unchanged) the total within-cluster sum of squared distances from points to their assigned center — the assignment step assigns each point to its closest current center (which cannot increase this total), and the update step recomputes each center as the mean of its assigned points, which is provably the single point minimizing total squared distance to that specific set of points (cannot increase this total either). Since this total is bounded below by zero and never increases, the algorithm is guaranteed to converge to a stable assignment — though not necessarily the global optimum.

### Why the result depends on initialization, and how to pick k

Because k-means only ever decreases the objective from its current state, it can converge to a **local optimum** — a different random initialization of the starting centers can lead to a different final clustering, some better than others. In practice, k-means is run multiple times from different random initializations, and the run with the lowest final total distance is kept. Choosing `k` itself is a separate problem: a common heuristic, the "elbow method," plots the total within-cluster distance against increasing `k` and looks for the point where adding more clusters stops meaningfully reducing that total — a diminishing-returns judgment call, not an exact computation.

## Worked Examples

### Example 1: Tracing k-means to convergence on 6 points

Points: `A=(1,1), B=(1,2), C=(2,1), D=(8,8), E=(8,9), F=(9,8)`, with `k=2`, initial centers `c₁=(1,1)` (=A), `c₂=(9,8)` (=F).

```text
Iteration 1 — Assign:
  A,B,C are closest to c₁=(1,1)  →  cluster 1
  D,E,F are closest to c₂=(9,8)  →  cluster 2
Update:
  c₁ = mean(A,B,C) = ((1+1+2)/3, (1+2+1)/3) = (1.33, 1.33)
  c₂ = mean(D,E,F) = ((8+8+9)/3, (8+9+8)/3) = (8.33, 8.33)

Iteration 2 — Assign:
  Every point's nearest center is unchanged (A,B,C still nearest c₁; D,E,F still nearest c₂)
  → assignments identical to iteration 1 → CONVERGED
```

Two iterations reach a stable, sensible clustering — the two visually obvious groups (near the origin, and near (8,8)) are exactly recovered.

### Example 2: A case where k-means gets stuck at a poor local optimum

Suppose instead both initial centers happen to land inside the same visually obvious group (e.g., `c₁=(1,1)`, `c₂=(1,2)`, both near the A/B/C cluster). The assignment step might split the A/B/C group between the two centers while lumping D, E, F all with whichever center they're each closer to — producing a clustering that does not match the visually obvious two-group structure at all, and further iterations, starting from this poor initialization, may never recover it. This is exactly why running k-means from several different random initializations and keeping the best result is standard practice, not an optional refinement.

## Common Misconceptions & Pitfalls

- **"K-means always finds the best possible clustering."** It is only guaranteed to converge to *a* local optimum, and as Example 2 shows, poor initialization can produce a clearly suboptimal result — multiple random restarts are the standard, necessary mitigation.
- **"K-means can figure out the right number of clusters on its own."** `k` must be chosen before running the algorithm; k-means will produce exactly `k` clusters regardless of whether the data naturally has that many groups, forcing a split or merge that doesn't reflect genuine structure if `k` is chosen poorly.
- **"Since there's no ground truth, any clustering result is equally valid."** While there is no single "correct" answer the way there is for supervised classification, the algorithm's own internal objective (total within-cluster distance) still gives an objective, comparable score across different runs or different `k` values, even without external labels.

## Summary

K-means clusters unlabeled data into `k` groups by alternately assigning each point to its nearest current center and recomputing each center as the mean of its assigned points, provably converging because each step can only decrease the total within-cluster distance. It is not guaranteed to reach the global optimum — different random initializations can converge to different, sometimes poor, local optima — and the number of clusters `k` must be chosen in advance, typically via a diminishing-returns heuristic. This is the first genuinely unsupervised algorithm in this discipline, evaluated by an internal objective rather than any external ground truth.

## Documentation Links

- [Stanford CS229 — Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html) — lists k-means as the entry point to this course's unsupervised learning unit.
- [James, Witten, Hastie & Tibshirani — An Introduction to Statistical Learning](https://www.statlearning.com/) — Chapter 10 (Unsupervised Learning) covers k-means alongside the elbow-method heuristic for choosing k.
