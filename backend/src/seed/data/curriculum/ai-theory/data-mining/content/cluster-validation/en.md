---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Separate internal validation (no labels) from external validation (labels available), and say what each one can establish.
- Compute the silhouette by hand, including its valid range of $k$ and the convention for singletons, and match scikit-learn.
- Compute the Davies-Bouldin index by hand in the variant scikit-learn uses.
- Compute the adjusted Rand index by pair counting, state the permutation model behind it, and show that it can be negative.
- Show with runs that silhouette can prefer a wrong answer, and that pure noise still yields a best $k$.

## Context & Motivation

`k-means-clustering` picks $k$ with an elbow on the total within-cluster distance. `hierarchical-clustering` leaves $k$ to a cut. `density-based-clustering-with-dbscan` leaves it to `eps`. Each one will return labels on any input (DBSCAN's may be all noise), so a question remains: does this partition reflect structure, or did the algorithm impose it? Validation indices give numbers for that question, but each number encodes an assumption about what a good cluster looks like. The inertia used for the elbow illustrates the limit: it falls as $k$ grows even on structureless data (Example 5).

All examples here are exploratory, with no train and test split: the indices score the same data that was clustered. External labels are used only for scoring, never for fitting.

## Core Theory

### Internal indices

Internal indices use only the data and the partition.

**Silhouette** (Rousseeuw 1987). For point $i$ in cluster $C$ with $\lvert C\rvert\ge2$, let $a(i)$ be its mean distance to the *other* points of $C$, and $b(i)$ the smallest, over the other clusters, of its mean distance to that cluster's points:

$$s(i)=\frac{b(i)-a(i)}{\max\{a(i),b(i)\}}.$$

Under the usual distance assumptions, with $a(i),b(i)$ not both 0, $-1\le s(i)\le1$. Near 1 means well inside its cluster, near 0 means on a boundary, and negative means closer on average to another cluster. The score is the mean of $s(i)$ over points, which differs from the mean of per-cluster means.

*Range.* The index needs $2\le k\le n-1$. With $k=1$, $b(i)$ has no other cluster to use. With $k=n$, every point is a singleton and nothing is measured. scikit-learn raises `ValueError` in both cases.

*Singletons.* For a point alone in its cluster, $a(i)$ is undefined, and the convention is $s(i)=0$. scikit-learn implements exactly that.

**Davies-Bouldin**, scikit-learn's variant. With centroid $c_i$ and $S_i$ the mean Euclidean distance of cluster $i$'s points to $c_i$,

$$R_{ij}=\frac{S_i+S_j}{\lVert c_i-c_j\rVert},\qquad DB=\frac1k\sum_{i=1}^k\max_{j\ne i}R_{ij}.$$

Lower is better, and 0 is the minimum. It relies on centroids, so it inherits their geometry.

### External indices

Given a reference partition $U$ and a clustering $V$, count pairs of points. With contingency entries $n_{ij}$, row sums $a_i$, and column sums $b_j$, define

$$\text{Index}=\sum_{ij}\binom{n_{ij}}{2},\quad A=\sum_i\binom{a_i}{2},\quad B=\sum_j\binom{b_j}{2}.$$

The **Rand index** is the fraction of pairs on which $U$ and $V$ agree. Its weakness is a high baseline: unrelated partitions score well above 0 (Example 3). The **adjusted Rand index** of Hubert and Arabie (1985) subtracts the value expected by chance:

$$\mathrm{ARI}=\frac{\text{Index}-\mathbb E[\text{Index}]}{\tfrac12(A+B)-\mathbb E[\text{Index}]},\qquad \mathbb E[\text{Index}]=\frac{AB}{\binom n2}.$$

**The chance model.** The expectation assumes the permutation model: partitions drawn at random with the number of clusters and the cluster sizes held fixed, which gives a generalized hypergeometric distribution for the table (Vinh et al. 2010). Under it, ARI has expected value 0 and is at most 1, reaching 1 for identical partitions. Nothing makes 0 a lower bound: agreement below chance gives a **negative** ARI.

The zero expectation describes a single random draw with the cluster sizes fixed. Choose the best of many, and the hypothesis fails (Example 3).

ARI also treats whatever labels it receives as clusters, including DBSCAN's `-1`. Example 4 of `density-based-clustering-with-dbscan` showed that effect.

### Choosing $k$

The common recipe runs a clustering for each $k$ and takes the best index. That answers "which $k$ does this index like on this algorithm's output", which is narrower than "how many groups exist". Three checks help: compare against a null reference (Example 5), inspect the clusters themselves, and test whether a different algorithm agrees.

## Worked Examples

### Example 1: silhouette and Davies-Bouldin by hand

Points on a line: $0,1,2\mid6,7\mid12$, three clusters.

```text
x     a      b      s
0     1.5    6.5    0.7692
1     1.0    5.5    0.8182
2     1.5    4.5    0.6667
6     1.0    5.0    0.8000
7     1.0    5.0    0.8000
12    -      -      0  (singleton)
```

For $x=0$: $a=(1+2)/2=1.5$, $b=\min\{(6+7)/2,\ 12\}=6.5$, so $s=5/6.5$. The mean over points is $0.6423$, and `silhouette_score` agrees. The mean of per-cluster means would be $0.5171$. All-one-label and all-different labels both raise `ValueError: Number of labels is ... Valid values are 2 to n_samples - 1 (inclusive)`.

For Davies-Bouldin, centroids are $1,\ 6.5,\ 12$ and $S=(0.6667,\ 0.5,\ 0)$. Then $R_{12}=1.1667/5.5=0.2121$, $R_{13}=0.6667/11=0.0606$, $R_{23}=0.5/5.5=0.0909$. The maxima per cluster are $0.2121,\ 0.2121,\ 0.0909$, whose mean is $0.1717$, equal to `davies_bouldin_score`.

### Example 2: ARI by pair counting, and a negative value

Let $U=$ `0000111122` and $V=$ `0001111222`.

$$\begin{pmatrix}3&1&0\\0&3&1\\0&0&2\end{pmatrix}$$

$\text{Index}=3+3+1=7$. Row sizes $4,4,2$ give $A=13$, and column sizes $3,4,3$ give $B=12$. With $\binom{10}{2}=45$, the expectation is $13\cdot12/45=3.4667$, so

$$\mathrm{ARI}=\frac{7-3.4667}{12.5-3.4667}=0.3911,$$

and `adjusted_rand_score` agrees, while the Rand index is $0.7556$.

For $U=$ `0011` and $V=$ `0101`, every table entry is 1, so $\text{Index}=0$, $A=B=2$, the expectation is $4/6$, and $\mathrm{ARI}=(0-\tfrac23)/(2-\tfrac23)=-0.5$. The two partitions disagree more than the model expects.

### Example 3: the chance baseline, by simulation

Take 10 clusters of 10 points each, as `labels = numpy.repeat(numpy.arange(10), 10)`, and compare `labels` with `rng.permutation(labels)` 1000 times, from one `rng = numpy.random.default_rng(0)`.

```text
mean Rand index  0.8347
mean ARI         0.0001   (sd 0.0142, min -0.0364, max 0.0467)
```

A Rand index of 0.83 here carries no information, because the pairs in different clusters dominate. Now select. For sizes $10,5,5$ ($n=20$), `default_rng(0)` again gives a mean ARI of $0.0009$ over 1000 permutations, and the best of them reaches $0.4855$. A single high score picked from many tries is not evidence.

### Example 4: silhouette prefers the wrong answer

Use the two moons, `make_moons(n_samples=400, noise=0.05, random_state=0)`, and `KMeans(k, n_init=10, random_state=0)`.

```text
partition            silhouette   Davies-Bouldin   ARI vs moons
true moons           0.3310       1.1600           1.0000
k-means, k=2         0.4900       0.7803           0.2738
k-means, k=3         0.4297       0.8829           0.2854
k-means, k=6         0.5089       0.6102           0.2836
k-means, k=8         0.5327       0.5473           0.2478
k-means, k=10        0.5205       0.5490           0.1989
```

The true partition scores worst on both internal indices, and $k=8$ scores best on both. They reward compact, separated convex blobs, and a moon is neither compact nor convex: its two tips are far apart, so $a(i)$ is large. DBSCAN recovers these moons exactly, and silhouette would rank that result below k-means.

The geometry can break an index outright. For `make_circles(n_samples=400, factor=0.5, noise=0.03, random_state=0)`, the true partition has silhouette $0.1135$ and Davies-Bouldin $796.3$: the two rings share nearly the same centroid, so the denominator $\lVert c_i-c_j\rVert$ nearly vanishes. K-means with $k=2$ has silhouette $0.3531$ and ARI $-0.0025$, a negative value that says it did no better than chance.

Noise labels create another trap. `silhouette_score` treats `-1` as a cluster. For `DBSCAN(eps=0.08, min_samples=4)` on the moons, with 21 noise points, it gives $0.2291$ with noise included and $0.2771$ with noise removed. Say which one you report.

### Example 5: noise still has a best $k$

Draw 300 uniform points in the unit square with `numpy.random.default_rng(7).random((300, 2))`, and run `KMeans(k, n_init=10, random_state=0)`. There are no clusters.

```text
k    silhouette   Davies-Bouldin   inertia
2    0.3689       1.127            29.05
3    0.3858       0.853            18.48
4    0.4042       0.783            11.96
5    0.3944       0.827             9.77
6    0.3867       0.809             8.34
8    0.3625       0.833             5.90
10   0.3662       0.793             4.69
```

Taken at face value, this says $k=4$. Inertia falls at every step, and the optimal inertia can only fall as $k$ grows, on any data. A null reference gives the number its scale. Over 100 such uniform datasets drawn in turn from one `default_rng(8)`, each searched over $k=2,\dots,10$ with the cheaper `KMeans(k, n_init=3, random_state=0)`, the best silhouette had a median of $0.414$ and a 95th percentile of $0.437$, and $k=4$ won 66 times (63 to 67 under four other `random_state` choices), so a square seems to favor four cells. The dataset above, rerun with those same settings, peaks at $0.4039$ at $k=4$, so its score is ordinary for noise. For contrast, three blobs from `make_blobs(n_samples=300, centers=3, cluster_std=0.8, random_state=0)`, rescaled to the unit square with `minmax_scale` and clustered with `KMeans(3, n_init=10, random_state=0)`, reach $0.5568$, above that range. This reference is one choice among several: uniform on a box is a specific null, and data with correlated features need a matching one.

## Common Misconceptions & Pitfalls

- **"A high silhouette proves the clusters are real."** Example 5 gives 0.40 on noise. The value needs a reference.
- **"ARI of 0 is the worst score."** It is the chance level, and negative values exist.
- **"Random labels give a Rand index near 0."** They give about 0.83 in Example 3.
- **"Internal indices are neutral."** Silhouette and Davies-Bouldin score distance-based compactness, which suits k-means-like shapes.
- **"External labels are the truth."** They are one partition. A clustering that disagrees may have found other structure, or none.

## Summary

Internal indices score a partition against a geometric notion of compactness and separation. Silhouette needs $2\le k\le n-1$ and sets $s(i)=0$ for singletons, and scikit-learn's Davies-Bouldin uses centroids and mean distances. External indices need a reference, and ARI corrects the Rand index under the permutation model, with expected value 0, a maximum of 1, and possible negative values. Non-convex clusters can make the true partition look worst, and noise always has a best $k$, so a validation number means little without a reference for what chance produces.

## Documentation Links

- [scikit-learn: clustering performance evaluation](https://scikit-learn.org/stable/modules/clustering.html): user guide for the Rand index, ARI, silhouette, and Davies-Bouldin, with their references.
- [scikit-learn: silhouette_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.silhouette_score.html): the implementation and its valid label range.
- [Vinh, Epps, and Bailey (2010): Information Theoretic Measures for Clusterings Comparison](https://jmlr.csail.mit.edu/papers/volume11/vinh10a/vinh10a.pdf): pair-counting measures, the ARI, and the permutation model used for correction by chance.
- [Wikipedia: Silhouette (clustering)](https://en.wikipedia.org/wiki/Silhouette_%28clustering%29): the definition, including the case of clusters of size 1.
