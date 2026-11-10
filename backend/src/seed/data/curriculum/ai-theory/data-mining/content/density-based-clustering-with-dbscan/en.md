---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the definitions of core, border, and noise points, and say whether `MinPts` counts the point itself in the original paper and in scikit-learn.
- Trace DBSCAN by hand on a small set and match `sklearn.cluster.DBSCAN`.
- Show which parts of the output depend on visit order and which do not.
- Choose `eps` from a sorted k-distance plot without the off-by-one error.
- Say precisely what is and is not known about DBSCAN's running time.
- State when clusters of different density defeat a single `eps`, and show that different density alone does not.

## Context & Motivation

`k-means-clustering` assigns each point to its nearest center, so its clusters are convex cells. `gaussian-mixture-models-and-the-em-algorithm` allows elongated shapes but still fits one Gaussian per cluster. Both give every point a place, softly in the mixture case, so neither can say "this point belongs to nothing". `hierarchical-clustering` showed single linkage following connected shapes, and also following any thin bridge. DBSCAN, from Ester, Kriegel, Sander, and Xu (1996), keeps the idea of connection and adds a density requirement: a cluster grows only through points with enough neighbors. The number of clusters is not an input, and points in sparse regions are labeled noise.

## Core Theory

### Definitions, and the counting convention

Fix `Eps` and `MinPts`. Ester et al. define the neighborhood of $p$ in database $D$ as

$$N_{Eps}(p)=\{q\in D\mid \mathrm{dist}(p,q)\le Eps\}.$$

Since $\mathrm{dist}(p,p)=0$, **$p$ belongs to its own neighborhood**. A point is **core** if $\lvert N_{Eps}(p)\rvert\ge MinPts$. Scikit-learn matches this: `min_samples` "includes the point itself", the test is `>=`, and distances exactly equal to `eps` count. Gan and Tao (2015) state the same convention. A text that counts only other points has a `MinPts` one lower for the same clusters.

- $p$ is **directly density-reachable** from $q$ if $p\in N_{Eps}(q)$ and $q$ is core.
- $p$ is **density-reachable** from $q$ if a chain $q=p_1,\dots,p_n=p$ exists with each step direct. All points of the chain except possibly the last are core, so this relation is not symmetric.
- $p$ and $q$ are **density-connected** if both are density-reachable from some point $o$.
- A **cluster** is a nonempty set $C$ that is maximal (if $p\in C$ and $q$ is density-reachable from $p$, then $q\in C$) and connected (all pairs in $C$ are density-connected).
- **Noise** is every point in no cluster. A **border** point is in a cluster but is not core.

**Property (Ester et al., Lemmas 1 and 2).** If $p$ is core, the set of points density-reachable from $p$ is a cluster, and every cluster equals that set for any of its core points. The hypothesis matters: start from a border point and nothing is reachable, so the same procedure returns no cluster.

### The algorithm

For each unclassified point, query its neighborhood. If it is not core, mark it noise for now, since it may become a border point later. If it is core, open a cluster and expand from its neighbors: every one that is core adds its own neighbors. There are at most $n$ region queries.

### What depends on visit order

Core status comes from counts and noise from membership in no cluster, so neither depends on order, and by the property above neither does the grouping of core points. The exception is a border point within `Eps` of core points from two clusters. By the definitions it belongs to both. Ester et al. assign it to the cluster discovered first and call these situations rare. Gan and Tao's formulation lets the clusters overlap at such points. `sklearn.cluster.DBSCAN` returns one label per point, so its answer depends on row order.

### Choosing the parameters

Ester et al. plot the distance from each point to its $k$-th nearest neighbor, sorted in descending order, take the `Eps` at the first "valley", and fix `MinPts` to 4 for 2-dimensional data, reporting that larger $k$ changed the plot little in their experiments. They leave the threshold to a person.

Watch the offsets. Their $k$-dist excludes $p$, so a point with $k$-dist at most `Eps` has at least $k+1$ points in its neighborhood. In scikit-learn, `NearestNeighbors(n_neighbors=m).fit(X).kneighbors(X)` includes each point as its own first neighbor, and the last column is the exact threshold for `min_samples=m`: a point is core exactly when that value is at most `eps`. Calling `kneighbors()` with no argument excludes self and gives the distance one neighbor further out.

### When one density threshold fails

DBSCAN uses one `Eps` and one `MinPts` for all clusters. Ester et al. state the constraint: two sets having at least the density of the thinnest cluster are separated only if their distance is larger than `Eps`. Let $e$ be the smallest `Eps` that connects the sparsest cluster, and $g$ the smallest gap between two clusters that must stay apart.

**Condition.** One setting can recover all the clusters only if $e<g$. Different density alone is therefore not the failure, which comes when the sparse cluster needs an `Eps` of at least the gap between two other clusters. Example 4 runs both cases.

The density hypothesis matters. In Example 2, count the point at 2 in the left cluster: its gap to the right cluster is 1, equal to `eps`, and the clusters still stay apart, because that point is not core.

### Running time: claim, correction, reply

Ester et al. claim an *average* run time of $O(n\log n)$, under the assumption that neighborhoods are small compared with the data space, so that one R*-tree query costs $O(\log n)$ on average.

- Gan and Tao (2015), following Gunawan (2013), call the bound a mis-claim: $n$ range queries cost $O(n^2)$ in the worst case, and if all points lie within `Eps` of each other the output of those queries alone is quadratic.
- For $d=2$ they credit Gunawan (2013) with a genuine $O(n\log n)$ algorithm. For $d\ge3$ they prove a conditional lower bound: $\Omega(n^{4/3})$ unless USEC ($d=3,4$) or Hopcroft's problem ($d\ge5$) can be solved in $o(n^{4/3})$. They also give $\rho$-approximate DBSCAN, with $O(n)$ expected time for fixed $d$ and constant $\rho$.
- Schubert et al. (2017), a reply whose authors include all four original authors, argue in their abstract that the criticism belongs to the assumption about index performance, not to the algorithm. They also report that the 2015 methods do not appear to offer practical benefits when parameters are well chosen.

The original algorithm is therefore quadratic in the worst case, and fast runs need an index that works and an `eps` that keeps neighborhoods small. Ester et al.'s own benchmark on geographic point data went from 3.1 s at 1252 points to 41.7 s at 12512, a factor of 13.5 for ten times the data. Scikit-learn's documentation adds a separate warning: its implementation stores all neighborhoods, so its memory can reach $O(n^2)$ when `eps` is large and `min_samples` low.

## Worked Examples

### Example 1: by hand, with `Eps=1.5`, `MinPts=4`

```text
A(0,0)  B(1,0)  C(0,1)  D(1,1)  E(2,1)  F(4,1)
G(6,0)  H(7,0)  I(6,1)  J(7,1)  K(11,4)
```

The nonzero distances that matter are 1 and $\sqrt2$, then 2, so no distance equals `Eps`. Neighborhood counts, self included:

```text
point  neighborhood  count  role
A      A B C D       4      core
B      A B C D E     5      core
C      A B C D       4      core
D      A B C D E     5      core
E      B D E         3      border (of B and D)
F      F             1      noise
G-J    G H I J       4      core
K      K             1      noise
```

Visiting from $A$: $A$ is core, so the cluster takes $A,B,C,D$, then $B$ adds $E$. $E$ is not core and adds nothing. $F$ is noise. $G$ is core and gives the second cluster. $K$ is noise. `DBSCAN(eps=1.5, min_samples=4)` returns `[0 0 0 0 0 -1 1 1 1 1 -1]`.

The convention changes the answer. With `min_samples=5`, the reading "4 neighbors besides itself", the core set shrinks to $B,D$ and the group $G,H,I,J$ becomes noise: `[0 0 0 0 0 -1 -1 -1 -1 -1 -1]`.

The offset too: $A$ is core at 1.5, and `kneighbors(X)` with 4 gives it 1.4142. The self-excluded `kneighbors()` gives 2.2361, which would wrongly suggest that $A$ is not core.

### Example 2: a border point that changes owner

Eleven points on a line: $0,0.25,0.5,0.75,1$, then $2$, then $3,3.25,3.5,3.75,4$, with `eps=1`, `min_samples=4`. Counts are `5 5 5 5 6 3 6 5 5 5 5`, so the point at 2 is border, within reach of the core points at 1 and 3.

```text
row order        cluster of the point at 2    core points
as listed        left                         10
reversed         right                        10
```

Over 1000 row orders `rng.permutation(11)` from one `rng = numpy.random.default_rng(0)`, it joined the left cluster 504 times and the right 496 times. The core set stayed the same in all of them, since it depends only on counts.

### Example 3: non-convex clusters

Use `make_moons(n_samples=400, noise=0.05, random_state=0)`, with `MinPts=4`. The self-excluded 4-dist has a 99th percentile of 0.136 and a maximum of 0.151, with no isolated tail, so a value near 0.15 is the natural pick. This is the paper's recipe, one neighbor further out than needed: the exact column for `min_samples=4` from the section above has a maximum of 0.140, so 0.15 is a safe value rather than the exact one.

```text
eps     clusters  noise  ARI
0.05       34      125   0.034
0.10        3        3   0.920
0.15        2        0   1.000
0.30        2        0   1.000
0.50        1        0   0.000

KMeans(2, n_init=10, random_state=0)                ARI 0.274
GaussianMixture(2, n_init=5, random_state=0), full  ARI 0.503
```

ARI is defined in `cluster-validation`, and 1 means the true moons exactly. DBSCAN never sees the labels, which only score this exploratory run.

### Example 4: a sparse cluster and a small gap defeat one `eps`

From one `rng = numpy.random.default_rng(42)`, draw 150 points from each of three spherical Gaussians, in this order, with `rng.normal(center, sigma, (150, 2))`: $A$ at $(0,0)$ and $B$ at $(1.2,0)$ with $\sigma=0.15$, and $C$ at $(6,6)$ with $\sigma=1$. Scan `eps` from 0.05 to 2.00 in steps of 0.01, with `min_samples=5`.

```text
eps    clusters  A,B separate?  pieces of C  C noise  ARI
0.13      2      yes            0            150      0.967
0.33      9      yes            7             46      0.812
0.34      6      no             5             46      0.405
0.57      2      no             1             14      0.528
```

The closest points of $A$ and $B$ are 0.333 apart, so they separate only below that, as Ester et al. predict for sets closer than `Eps`. $C$ becomes a single piece only from 0.57 on, although its largest piece already holds 102 of its 150 points at 0.36. While $A$ and $B$ stay separate, that piece has at most 65 points, so no `eps` in the scan does both. The first row is the trap: its ARI of 0.967 comes from all of $C$ labeled noise, and ARI treats the noise label as one more cluster. Ester et al. note the merging problem and suggest a recursive run with a higher `MinPts`. A hierarchical density method handles this data: `HDBSCAN(min_cluster_size=20)` finds 3 clusters with 1 noise point, ARI 0.99.

The density difference is not what breaks this run. Keep the same draws, and translate $B$ along the $x$ axis so that its center is at $(s,0)$. Rerun the scan and keep the values of `eps` where $A$ and $B$ are one cluster each, and $C$ is one piece with at least 130 points:

```text
s      gap A-B   working eps     noise at the ends   ARI at the ends
1.20   0.333     none
1.44   0.567     none
1.45   0.577     0.57            14                  0.957
1.50   0.627     0.57 to 0.62    14 to 8             0.957 to 0.974
2.00   1.124     0.57 to 1.12    14 to 1             0.957 to 0.997
12.0   11.12     0.57 to 2.00    14 to 0             0.957 to 1.000
```

Here $e=0.57$, and the window runs from $e$ to just under the gap (the scan stops at 2.00), so it opens exactly when $g>e$. The densities are the same in every row. Removing $B$ altogether also works: $A$ and $C$ alone give 2 clusters at `eps=0.57`, with 14 noise points, all in $C$, and ARI 0.915.

### Example 5: what a large `eps` costs

Draw $n$ uniform points in the unit square with one generator, `rng = numpy.random.default_rng(1)` and then `rng.random((n, 2))` for $n=2000,4000,8000$ in turn, without reseeding. Count the total points returned by all $n$ queries, self included:

```text
n       eps=0.01   eps=0.1     eps=1.5
2000      3204     116284      4000000
4000      8996     463632     16000000
8000     28178    1861904     64000000
```

At `eps=1.5` every query returns all $n$ points, so the output is exactly $n^2$ no matter which index is used. At `eps=0.1`, doubling $n$ quadruples the output, because a fixed `eps` over denser data means bigger neighborhoods. The small `eps` only delays this: its mean neighborhood grows from 1.6 to 3.5 points across the table, close to $1+(n-1)\pi\,\mathrm{eps}^2$.

## Common Misconceptions & Pitfalls

- **"DBSCAN is $O(n\log n)$."** That is the paper's average case, with a working index and small neighborhoods.
- **"Border points make DBSCAN random."** Core points and noise are fixed by the data. A shared border point's cluster depends on row order, not on chance: the same order gives the same labels.
- **"Noise means outlier."** Noise depends on `eps` and `MinPts`: in Example 4 a real blob becomes noise. `outlier-detection-quartiles-distance-based-density-based` treats outliers directly.

## Summary

DBSCAN grows clusters through core points, those with at least `MinPts` points within `Eps`, counting themselves, in both the paper and scikit-learn. Core points and noise are independent of visit order, while a border point shared by two clusters is not. Clusters can have any shape, but one density threshold fails when a sparse cluster needs an `eps` larger than the gap between two dense clusters. The $O(n\log n)$ figure is an average under an index assumption: the worst case for the original algorithm is quadratic, $d=2$ has a true $O(n\log n)$ algorithm, and $d\ge3$ has a conditional $\Omega(n^{4/3})$ bound.

## Documentation Links

- [Ester et al. (1996): A Density-Based Algorithm for Discovering Clusters](https://cdn.aaai.org/KDD/1996/KDD96-037.pdf): the definitions, algorithm, k-dist heuristic, and the average-case claim.
- [Gan and Tao (2015): DBSCAN Revisited](https://www.cse.cuhk.edu.hk/~taoyf/paper/sigmod15-dbscan.pdf): the worst-case analysis, the conditional lower bound, and approximate DBSCAN.
- [Schubert: list of ACM papers with authorized access](https://www.vitavonni.de/research/acm.html): the author's free ACM links, including DBSCAN Revisited, Revisited (Schubert et al. 2017).
- [scikit-learn: DBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.DBSCAN.html): parameters, the counting convention, and the memory note.
- [scikit-learn: HDBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html): the hierarchical density method used in Example 4.
