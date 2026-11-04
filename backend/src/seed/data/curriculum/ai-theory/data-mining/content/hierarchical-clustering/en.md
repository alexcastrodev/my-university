---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define single, complete, average, Ward, and centroid linkage by the cluster distance each one minimizes at a merge.
- Run agglomerative clustering by hand on a small dataset, read the dendrogram, and match the merge table from SciPy.
- Say exactly what merge height SciPy reports for Ward, and check it against a sum-of-squares increase computed directly.
- Explain chaining, inversions, and why Ward needs Euclidean distances, each with a run that shows it.
- State the time cost of a hierarchical method together with the algorithm that achieves it, and compare the result with k-means.

## Context & Motivation

`k-means-clustering` asks for $k$ before it starts, and a different $k$ means a new run from new starting centers. Hierarchical clustering produces a nested family of partitions, one for each $k$ from $n$ down to 1, in a single run. Choosing $k$ becomes choosing where to cut a tree. The price is that every merge is permanent, and that "the distance between two clusters" has several definitions that give different trees on the same data. The distance between points comes from `similarity-and-distance-measures`.

## Core Theory

### Agglomerative and divisive

**Agglomerative** clustering starts with $n$ singletons and repeatedly merges the closest pair of clusters, $n-1$ merges in all. **Divisive** clustering starts with everything in one cluster and splits. An exact divisive first step must weigh $2^{n-1}-1$ splits into two nonempty parts (31 for $n=6$), so practical divisive methods use a heuristic. `BisectingKMeans` in scikit-learn, for example, splits one cluster at a time with 2-means. The rest of this lesson is agglomerative.

### Linkage: the distance between clusters

For clusters $A$ and $B$ with centroids $c_A,c_B$ and point distance $d$:

| Linkage | Cluster distance |
|---|---|
| single | $\min_{a\in A,\,b\in B} d(a,b)$ |
| complete | $\max_{a\in A,\,b\in B} d(a,b)$ |
| average (UPGMA) | $\frac{1}{\lvert A\rvert\lvert B\rvert}\sum_{a\in A}\sum_{b\in B} d(a,b)$ |
| centroid (UPGMC) | $\lVert c_A-c_B\rVert_2$ |
| Ward | $\sqrt{\frac{2\lvert A\rvert\lvert B\rvert}{\lvert A\rvert+\lvert B\rvert}}\,\lVert c_A-c_B\rVert_2$ |

Weighted and median linkage also exist, and their values depend on merge order. The Ward row is the form SciPy reports, as written in Müllner (2011). Ward's criterion is to merge the pair that least increases the total within-cluster sum of squares, the same quantity k-means works on. For $\mathrm{SSE}(S)=\sum_{x\in S}\lVert x-c_S\rVert^2$, the increase has a closed form:

$$\Delta(A,B)=\mathrm{SSE}(A\cup B)-\mathrm{SSE}(A)-\mathrm{SSE}(B)=\frac{\lvert A\rvert\lvert B\rvert}{\lvert A\rvert+\lvert B\rvert}\lVert c_A-c_B\rVert^2.$$

So the height in `scipy.cluster.hierarchy.linkage(X, 'ward')` is $\sqrt{2\Delta}$, not $\Delta$. Variants differ here. R's `hclust` has `"ward.D2"`, which squares dissimilarities before updating and matches SciPy, and `"ward.D"`, which does not. Murtagh and Legendre (2014) show that `"ward.D"` implements Ward's criterion only when given squared distances, and that the square root of those heights then equals the `"ward.D2"` heights. scikit-learn's `AgglomerativeClustering(compute_distances=True)` reports the same values as SciPy.

### Reading a dendrogram

Each internal node sits at the height of its merge. Two leaves have a **cophenetic distance** equal to the height of their lowest common node. A horizontal cut at height $t$ gives the partition whose clusters are the subtrees below $t$. Each node's two children can swap freely, so read the height at which two points join, not how near their leaves are drawn.

### When heights never decrease

**Property (Müllner 2011).** If for all disjoint clusters $I,J,K$

$$d(I,J)\le\min\{d(I,K),d(J,K)\}\ \Rightarrow\ d(I,J)\le d(I\cup J,K),$$

then the sequence of merge heights cannot decrease. Single, complete, average, weighted, and Ward satisfy this, and also the stronger **reducibility** property with $\min\{d(I,K),d(J,K)\}\le d(I\cup J,K)$ on the right. Centroid and median linkage do not, and they can produce an **inversion**, a merge lower than the one before it. A dendrogram with an inversion has no consistent horizontal cut. Example 4 shows the condition failing.

### Cost, by algorithm

The cost belongs to an algorithm, not to "hierarchical clustering". All of these start from a stored dissimilarity matrix with $\Theta(n^2)$ entries.

| Algorithm | Linkages | Time |
|---|---|---|
| primitive: search all pairs at each merge | any | $\Theta(n^3)$ |
| MST-based | single | $\Theta(n^2)$ |
| nearest-neighbor chain | complete, average, weighted, Ward | $\Theta(n^2)$ |
| generic with a priority queue | any, including centroid and median | best case $\Theta(n^2)$, worst-case bound $O(n^3)$ |

These figures are from Müllner (2011). The nearest-neighbor chain relies on reducibility, so centroid and median cannot use it: of the fast algorithms, only the generic one handles them. SciPy's documentation lists $O(n^2)$ for its MST and nearest-neighbor-chain code, $O(n^3)$ for a naive algorithm on centroid and median, and $O(n^2)$ memory for all of them.

## Worked Examples

### Example 1: four linkages on six points

Take points on a line, with all runs in SciPy 1.18:

```text
A=0  B=1  C=3  D=7  E=8.5  F=14.5
```

Two pairs of distances tie (6 and 7.5), but no merge decision depends on them. The first two merges are the same everywhere: $AB$ at 1, then $DE$ at 1.5. Then $C$ joins $AB$, with $d(C,AB)$ equal to 2 for single, 3 for complete, and 2.5 for average. The output:

```text
merge   single          complete        average          Ward
1       A+B      1.0    A+B      1.0    A+B       1.0    A+B       1.0
2       D+E      1.5    D+E      1.5    D+E       1.5    D+E       1.5
3       C+AB     2.0    C+AB     3.0    C+AB      2.5    C+AB      2.8868
4       DE+ABC   4.0    F+DE     7.5    DE+ABC    6.4167 F+DE      7.7942
5       F+rest   6.0    ABC+DEF 14.5    F+rest   10.6    ABC+DEF  15.0111
k=2     ABCDE | F       ABC | DEF       ABCDE | F        ABC | DEF
```

Check one average height: $d(DE,ABC)=(7+6+4+8.5+7.5+5.5)/6=38.5/6=6.4167$. Cutting the complete tree at $t=5$ gives $ABC\mid DE\mid F$, and at $t=2$ it gives $AB\mid C\mid DE\mid F$. In that tree the cophenetic distance of $A$ and $E$ is 14.5, far above their distance of 8.5.

### Example 2: the Ward height is $\sqrt{2\Delta}$

For each Ward merge above, compute the SSE of the merged cluster directly and subtract:

```text
merge    SSE(union)  Delta      sqrt(2 Delta)  scipy height  running SSE
A+B        0.5         0.5        1.0           1.0            0.5
D+E        1.125       1.125      1.5           1.5            1.625
C+AB       4.6667      4.1667     2.8868        2.8868         5.7917
F+DE      31.5        30.375      7.7942        7.7942        36.1667
ABC+DEF  148.8333    112.6667    15.0111       15.0111       148.8333
```

Every height matches, and the deltas add up to the total SSE of the six points, 148.8333. So `Z[:,2]**2/2` summed up to any merge gives the within-cluster SSE of that cut. A Lance-Williams update as in `"ward.D"`, run on squared distances, gives $1,\ 2.25,\ 8.3333,\ 60.75,\ 225.3333$, whose square roots are the SciPy heights. On unsquared distances it gives $1,\ 1.5,\ 3,\ 8.5,\ 19$, which match neither.

### Example 3: single-link chaining

Build 29 points: two $3\times3$ unit grids, blob $L$ at $x\in\{0,1,2\}$ and blob $R$ at $x\in\{12,13,14\}$, with $y\in\{0,1,2\}$; ten bridge points at $y=1$ spaced 0.9 apart from $x=2.9$ to $x=11$; and a straggler at $(-1.5,1)$. Cut each tree at $k=2$:

```text
linkage    with bridge: sizes    L and R together?   without bridge: sizes
single     28 + 1                yes                 9 + 10
complete   13 + 16               no                  9 + 10
average    13 + 16               no                  9 + 10
Ward       13 + 16               no                  9 + 10
```

Without the bridge every linkage separates the blobs, and single linkage has its top merge at 10. Ten points in a row drop that merge to 1, because single linkage looks only at the closest pair, so a chain of short steps joins distant groups. The only thing left for $k=2$ to cut off is the straggler, at height 1.5. The other linkages keep the blobs apart and split the bridge 6 and 4. Chaining is a flaw only if the goal is compact groups: `density-based-clustering-with-dbscan` keeps the idea of following connected points and adds a density requirement. Many heights here tie at 1.0, so `fcluster(Z, 3, 'maxclust')` on the single-link tree returns 2 clusters, not 3: it will not split inside a tie.

### Example 4: an inversion in centroid linkage

Three points: $(0,0)$, $(1,0)$, $(0.5,0.9)$. The first two are at distance 1 and each is $1.0296$ from the third. They merge at height 1, and their centroid $(0.5,0)$ is only $0.9$ from the third point:

```text
method     heights        is_monotonic
centroid   1.0   0.9      False
median     1.0   0.9      False
average    1.0   1.0296   True
Ward       1.0   1.0392   True
```

The hypothesis fails here: $d(I,J)=1$ is below both other distances, yet $d(I\cup J,K)=0.9<1$. The parent node sits under its child, and `fcluster(Z, 0.95, 'distance')` returns three singletons although a node exists at 0.9.

### Example 5: Ward needs Euclidean distances

Ward's update formula assumes Euclidean input, because the closed form for $\Delta$ does. SciPy refuses `linkage(X, 'ward', metric='cityblock')`, and scikit-learn raises `ValueError` for `metric='manhattan'`. A precomputed condensed matrix is not checked. On $(0,0),(1,3),(4,1),(5,5),(9,2),(10,7)$:

```text
input                 merge 2      merge 3       heights                         sqrt(2 Delta) of those merges
Euclidean             {3rd}+{1,2}  {4th}+{5th}   3.16 4.08 5.00 5.32 12.40       3.16 4.08 5.00 5.32 12.40
Manhattan, as matrix  {3rd}+{4th}  {5th}+{6th}   4.00 5.00 6.00 8.51 15.84       3.16 4.12 5.10 6.04 12.01
```

The Manhattan run returns a tree with no warning, but its heights are not SSE increases of anything, and its merges differ.

### Example 6: greedy merges against k-means

On $2,5,7,16,26,34,38$, Ward's $k=2$ cut is $\{2,5,7\}\mid\{16,26,34,38\}$ with SSE 295.67. Brute force over all 63 splits gives $\{2,5,7,16\}\mid\{26,34,38\}$ with SSE 183.67. The cause is one early merge. With clusters $\{2,5,7\},\{16\},\{26\},\{34,38\}$, joining 16 and 26 costs $\Delta=50$, less than 26 with $\{34,38\}$ (66.67) or 16 with $\{2,5,7\}$ (96.33). That merge is never undone. `KMeans(2, n_init=10, random_state=0)` reaches 183.67, and on this data so does k-means started from the Ward centroids, in 2 iterations.

## Common Misconceptions & Pitfalls

- **"Heights always grow up the tree."** That holds only under the condition above. Centroid and median can invert.
- **"A dendrogram is unique."** Ties make it depend on input order. For $0,1,2$ with complete linkage, SciPy gives $\{0,1\}\mid\{2\}$, and for the same points listed as $2,1,0$ it gives $\{1,2\}\mid\{0\}$.
- **"Hierarchical clustering needs no decision about $k$."** The tree defers the decision to the cut. `cluster-validation` takes that up.

## Summary

Agglomerative clustering makes $n-1$ irreversible merges, and the linkage defines "closest". Single follows chains, complete and Ward prefer compact groups, and centroid can invert. SciPy's Ward height is $\sqrt{2\Delta}$, which requires Euclidean input and differs from other tools' scales. Time is $\Theta(n^2)$ with the MST and nearest-neighbor-chain algorithms, and the $\Theta(n^2)$ matrix usually sets the limit. Compared with k-means, the method gives every $k$ at once with no random start, but a greedy cut can have a much worse SSE than the optimum.

## Documentation Links

- [Müllner (2011): Modern hierarchical, agglomerative clustering algorithms](https://arxiv.org/abs/1109.2378): update formulas, reducibility, inversions, and the complexity of each algorithm.
- [Murtagh and Legendre (2011, published 2014): Ward's Hierarchical Clustering Method: Clustering Criterion and Agglomerative Algorithm](https://arxiv.org/abs/1111.6285): the two Ward implementations and what each requires as input.
- [SciPy: scipy.cluster.hierarchy.linkage](https://docs.scipy.org/doc/scipy/reference/generated/scipy.cluster.hierarchy.linkage.html): linkage definitions, the output matrix, complexity notes, and the Euclidean requirement.
- [R: hclust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/hclust.html): the `ward.D` and `ward.D2` options and non-monotone methods.
- [scikit-learn: AgglomerativeClustering](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.AgglomerativeClustering.html): the implementation and its Ward metric restriction.
- [scikit-learn: BisectingKMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.BisectingKMeans.html): a divisive method based on repeated 2-means.
