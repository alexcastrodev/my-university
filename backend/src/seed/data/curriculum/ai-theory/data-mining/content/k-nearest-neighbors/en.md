---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the k-NN rule for classification and regression.
- Resolve distance ties and vote ties, including vote ties at odd $k$.
- Choose $k$ by cross-validation, with the scaler inside the folds.
- State the Cover and Hart bound and the condition for distance concentration with their hypotheses, measure both, and break each one.
- Decide from measurements when a tree index beats a linear scan.

## Context & Motivation

`similarity-and-distance-measures` defined the distances. k-NN is the plainest way to use one: to predict for a new point, find the closest training points and let them answer. In the terms of `the-supervised-unsupervised-and-reinforcement-taxonomy` this is supervised learning, for classification and regression. Its $k$ counts labeled neighbors, unrelated to the $k$ of `k-means-clustering`, a number of clusters.

k-NN is **lazy**: fitting only stores the data, and the work moves to prediction time.

## Core Theory

### The rule

Take training pairs $(x_1,y_1),\dots,(x_n,y_n)$, a distance $d$ (Euclidean here), and a query $q$. Let $N_k(q)$ be the indices of the $k$ closest training points. Then

$$\hat y_{\text{class}}(q)=\arg\max_c\sum_{i\in N_k(q)}w_i\,\mathbf 1[y_i=c],\qquad \hat y_{\text{reg}}(q)=\frac{\sum_{i\in N_k(q)}w_iy_i}{\sum_{i\in N_k(q)}w_i}.$$

Uniform voting uses $w_i=1$. Distance weighting uses $w_i=1/d(q,x_i)$, which is `weights="distance"` in scikit-learn. A training point at distance 0 would divide by zero, so scikit-learn then gives weight 1 to the zero-distance neighbors and 0 to the others. A linear scan costs $O(nd)$ per query for $n$ points in $d$ dimensions, and all $n$ points stay in memory.

### Ties are part of the algorithm

The formula leaves two ties undefined.

- **Distance tie.** $N_k(q)$ is not unique when the $k$-th and $(k+1)$-th distances are equal. The scikit-learn guide warns that the result then depends on the order of the training data.
- **Vote tie.** The $\arg\max$ is not unique. With two classes and uniform weights an odd $k$ rules this out, because two counts with an odd sum differ. With three classes it does not: $k=3$ can split 1-1-1 and $k=5$ can split 2-2-1.

scikit-learn resolves a uniform vote tie by taking the first class in sorted label order.

### Choosing k

With $k=1$ the prediction follows each training point, so training accuracy is 1 unless identical points carry different labels. With $k=n$ and uniform weights every query gets the same answer, the majority class or the global mean. This is `the-bias-variance-tradeoff`: small $k$ has low bias and high variance, large $k$ the reverse. Training accuracy cannot choose $k$, so `cross-validation` does, with the scaler refit inside each fold, as `data-preprocessing-missing-values-scaling-discretization` requires.

### The Cover and Hart bound

Let $R^*$ be the Bayes risk, the lowest error any rule can reach knowing the true distribution. Let $R(n)$ be the expected error of 1-NN with $n$ training pairs and $R=\lim_{n\to\infty}R(n)$.

**Theorem (Cover and Hart, 1967).** Assume that:

1. the training pairs and the test pair are independent and identically distributed;
2. $x$ takes values in a separable metric space;
3. the $M$ class densities are such that, with probability one, $x$ is a continuity point of all of them or a point of nonzero probability;
4. the loss is 0-1, with $k=1$ fixed as $n\to\infty$.

Then

$$R^*\le R\le R^*\Big(2-\frac{M}{M-1}R^*\Big),$$

which for $M=2$ reads $R\le 2R^*(1-R^*)$, and these bounds are as tight as possible for this class of distributions. The result is about the limit: it gives no rate and says nothing about finite $n$. For fixed odd $k$ with two classes, the paper's tight upper bounds decrease with $k$ toward $R^*$.

### Distance concentration, and its condition

Fix the number $n$ of data points, and let a parameter $m$, usually the dimension, index a sequence of distributions. For each $m$, the data points $P_{m,1},\dots,P_{m,n}$ are drawn independently from one distribution $F_m$, and the query $Q_m$ is drawn independently of them, from a distribution that may differ. Let $d_m$ be a nonnegative function of a data point and a query. Call $\text{DMIN}_m$ and $\text{DMAX}_m$ the distances from the query to its nearest and farthest data points.

**Theorem (Beyer et al., 1999).** Under these assumptions, if for some constant $0<p<\infty$

$$\lim_{m\to\infty}\operatorname{var}\left(\frac{d_m(P_{m,1},Q_m)^p}{E\big[d_m(P_{m,1},Q_m)^p\big]}\right)=0,$$

then for every $\varepsilon>0$, $\lim_{m\to\infty}P\big[\text{DMAX}_m\le(1+\varepsilon)\,\text{DMIN}_m\big]=1$.

The paper states, leaving the analysis to its technical report, that the condition holds for IID coordinates with finite moments up to order $\lceil 2p\rceil$ under an $L_p$ metric and for some correlated workloads, and that it fails when all dimensions are copies of one another. Its two-degrees-of-freedom workload does not satisfy it either. The theorem gives no rate, the authors found the effect at as few as 10 to 15 dimensions, and they conclude that a workload should be checked by sampling.

### Index structures

A **k-d tree** splits the data on one coordinate at a time. A **ball tree** nests hyperspheres, so its pruning uses the triangle inequality and no axis-aligned splits. Both are exact: a query skips any region farther away than the current $k$-th best distance. The scikit-learn guide gives brute force as $O[DN]$ and the k-d tree as about $O[D\log N]$ below roughly 20 dimensions, rising toward $O[DN]$ above that, and `algorithm="auto"` picks brute force above 15 dimensions, among other conditions. The link to concentration is an inference: when every distance is close to the $k$-th best, few regions can be skipped.

Approximate methods, such as HNSW graphs, give up exactness for speed, and Beyer et al. warn that approximation can make the instability worse.

## Worked Examples

### Example 1: ties, by hand and in scikit-learn

The query is $q=(0,0)$, with seven training points:

| Point | $x$ | Label | Target | $d(q,x)$ |
|---|---|---|---|---|
| P1 | (1, 0) | B | 10 | 1 |
| P2 | (0, 2) | C | 20 | 2 |
| P3 | (-3, 0) | A | 30 | 3 |
| P4 | (0, -3) | B | 40 | 3 |
| P5 | (4, 3) | A | 50 | 5 |
| P6 | (5, -1) | C | 60 | 5.099 |
| P7 | (-4, 4) | C | 70 | 5.657 |

For $k=3$, P3 and P4 tie for third place. `KNeighborsClassifier` (scikit-learn 1.9.1), with `algorithm="brute"` and with `"kd_tree"`, gives:

```text
row order         k  weights    neighbors         prediction
P3 before P4      3  uniform    P1 P2 P3          A   (votes 1-1-1, first label)
P4 before P3      3  uniform    P1 P2 P4          B   (votes B 2, C 1)
P3 before P4      3  distance   P1 P2 P3          B   (B 1.000, C 0.500, A 0.333)
P4 before P3      3  distance   P1 P2 P4          B   (B 1.333, C 0.500)
either            5  uniform    P1 to P5          A   (votes 2-2-1, first label)
either            7  uniform    all               C   (votes C 3, A 2, B 2)
```

Swapping two rows changed the class at $k=3$, and both vote ties happened at odd $k$. Here the tied point that comes first was kept, but that is an outcome and not a rule: an internal selection routine decides. Over all 5,040 row orders with float coordinates, the earlier row was kept in 4,500 by brute force and the k-d tree. With integer coordinates brute force takes another code path and kept it in 3,720.

Regression with $k=3$ in the first row order gives $(10+20+30)/3=20$ with uniform weights and $(10+10+10)/(1+\tfrac12+\tfrac13)=16.36$ with distance weights.

### Example 2: choosing k on Wine

`sklearn.datasets.load_wine` has 178 rows, 13 features, and 3 classes. Hold out 25% with `train_test_split(..., stratify=y, random_state=0)`, then run `StratifiedKFold(5, shuffle=True, random_state=0)` on the other 133 rows. The scaled columns use a `StandardScaler` plus k-NN in one pipeline:

```text
k    train acc (scaled)   CV acc (scaled)    CV acc (raw features)
1    1.000                0.918 +- 0.049     0.758
3    0.947                0.933 +- 0.049     0.728
5    0.977                0.955 +- 0.043     0.713
15   0.962                0.955 +- 0.044     0.751
51   0.962                0.970 +- 0.028     0.714
101  0.617                0.399 +- 0.019     0.445
```

Without scaling, `proline` (standard deviation 314) sets the distances. Each fold trains on about 106 rows, so $k=101$ is near the majority-vote end and collapses. Among these six values the best mean is at $k=51$, though the gap to $k=5$ is smaller than one standard deviation across folds. A sweep of $k=1$ to 105 ties $k=38$ with $k=51$ at 0.9701 and puts $k=27$ at 0.9698, so the data do not pin down $k$ sharply. The selected $k=51$ scored 0.956 on the 45 held-out rows, used once, as `cross-validation` requires.

Fitting the scaler on all 133 rows before the folds left five of these rows unchanged and moved $k=3$ from 0.933 to 0.925. Across $k=1$ to 105 it changed the mean at 61 values, up at 42 and down at 19, by as much as 0.030. The leak can be invisible at one $k$ and not at another, so the pipeline stays.

### Example 3: the bound on a distribution with known answers

Cover and Hart's example has two equally likely classes with densities $2x$ and $2(1-x)$ on $[0,1]$, so $x$ is uniform and $P(\text{class }1\mid x)=x$. Then $R^*=\int_0^1\min(x,1-x)\,dx=\tfrac14$, the limit is $R=\int_0^12x(1-x)\,dx=\tfrac13$, and the bound is $2\cdot\tfrac14\cdot\tfrac34=\tfrac38$. For odd $k$ the limit is a binomial vote at each $x$, integrated numerically. Simulating with `numpy.random.default_rng(0)` restarted for each $n$, drawing $x$ and then labels with `rng.uniform(0, 1, n) < x`, for $n$ training pairs and then 200,000 test pairs, one draw shared by all $k$:

```text
k     exact limit   n=100,000   n=2,000,000
1     0.3333        0.3336      0.3322
3     0.3000        0.2986      0.3006
5     0.2857        0.2848      0.2849
51    0.2547        0.2540      0.2563
201   0.2512        0.2503      0.2527
```

1-NN settles at 0.333, between 0.25 and 0.375, and larger $k$ moves toward $R^*$.

### Example 4: remove a hypothesis

**Finite $n$ in more dimensions.** Take two equally likely classes, $x$ Gaussian with identity covariance, and class means differing only in coordinate 1, at $-1$ and $+1$. The other coordinates are noise, so $d$ does not change $R^*=\Phi(-1)=0.1587$. The bound is 0.2670, and the 1-NN limit, by numerical integration, is 0.2248. Error of 1-NN, with `default_rng(0)` restarted for each cell and 20,000 test points:

```text
d    n=100   n=1,000  n=10,000  n=100,000
1    0.225   0.219    0.232     0.223
20   0.313   0.279    0.280     0.263
```

At $d=20$ the error is above the bound up to $n=10{,}000$ and still well above the limit at $n=100{,}000$.

**Pairs not identically distributed.** Let $x$ be uniform on $[0,1]$ with true label $\mathbf 1[x>0.5]$, so $R^*=0$ and the bound says $R=0$. Flip 20% of the training labels and keep test labels clean. With $n=10^6$, `default_rng(0)`, and 200,000 test points, the error was 0.202 for $k=1$, 0.058 for $k=5$, and 0 for $k=101$. Training and test pairs no longer share a distribution, so the guarantee is gone and 1-NN copies the noise.

### Example 5: measuring concentration, and breaking it

Use $n=1000$ data points, 200 queries, Euclidean distance, and `numpy.random.default_rng(0)` restarted for each cell. *Uniform* is IID uniform coordinates. *Plane* is Beyer's two-degrees-of-freedom workload, $X_i=a_iU_1+b_iU_2$, where $a_i,b_i$ are constants in $(-1,1)$, here drawn uniformly once per cell, and $U_1,U_2$ are uniform on $(0,1)$ for each point. *Cauchy* is IID standard Cauchy coordinates, with no finite mean or variance. *Clustered* has 10 uniform centers, Gaussian noise of standard deviation 0.01, and each query inside a cluster. Cells show the mean of DMAX/DMIN and, in parentheses, the sample $\operatorname{var}(d^2/E[d^2])$:

```text
m      uniform        plane          Cauchy          clustered
2      92.5 (0.71)    113.3 (1.09)   12961 (92)      1019 (0.81)
10     3.86 (0.14)    94.7 (0.72)    1297 (498)      77.9 (0.32)
20     2.41 (0.07)    91.4 (0.73)    2544 (661)      54.0 (0.19)
100    1.43 (0.014)   97.9 (0.77)    986 (118)       36.0 (0.12)
1000   1.12 (0.0014)  96.2 (0.69)    318 (109)       31.3 (0.11)
```

Only *uniform* matches the theorem's limit. At $m=100$, 189 of its 200 queries had DMAX within 1.5 times DMIN, and at $m=1000$ all did. *Plane* does not change with $m$, because its intrinsic dimension stays 2. *Cauchy* shows that IID alone is not enough: the moment assumption is missing, one huge coordinate dominates each distance, and the ratio stays in the hundreds. *Clustered* keeps its contrast because the query's cluster is much closer than the rest.

Concentration is also not classification failure. With 1000 points, labels from `rng.integers(0, 2, n)`, two unit-variance Gaussian dimensions with class means 4 apart on the first, `default_rng(0)` restarted for each run, and 5-NN under `StratifiedKFold(5, shuffle=True, random_state=0)`, accuracy was 0.969. Adding 998 standard Gaussian noise features took it to 0.754. Embedding the two dimensions in 1000 by an orthonormal map kept 0.969, since distances do not change.

### Example 6: when an index helps

Take 100,000 uniform points from `default_rng(0)`, $k=5$, `leaf_size=40`, and 300 single queries, with `OMP_NUM_THREADS=1` on an Apple M1 Pro, Python call overhead included. The table shows distance calls divided by $n$, from `get_n_calls()`, then microseconds per query. The ball tree's count includes one distance per visited node, which is why it passes 1: at $d=50$ it visits all 100,000 points and all 4,095 nodes.

```text
d     kd calls/n   ball calls/n   kd us   ball us   brute us
2     0.0009       0.0029         31      33        887
5     0.0058       0.0285         35      48        981
10    0.0588       0.2439         125     252       1109
20    0.9147       1.0408         2722    2283      1495
50    1.0000       1.0410         8740    8071      2281
```

At $d=20$ both trees visit nearly every point and lose to the scan. Dimension alone does not decide this: 100,000 points from a 2-dimensional square, embedded in 50 dimensions by a random orthonormal map (the $Q$ of a QR factorization of a Gaussian matrix), gave 0.0011 k-d tree calls per point, 42 microseconds, against 2307 for brute force.

## Common Misconceptions & Pitfalls

- **"An odd $k$ prevents ties."** Only vote ties, and only for two classes with uniform votes. Distance ties remain at any $k$.
- **"1-NN is at most twice as bad as the best classifier."** That holds in the limit, under the hypotheses. Example 4 shows finite data above the bound.
- **"Nearest neighbor is meaningless in high dimensions."** That needs the condition. *Plane* and *clustered* keep their contrast at $m=1000$.

## Summary

k-NN stores the data and answers from the $k$ closest points, and its ties need a stated rule. $k$ is a bias-variance choice made by cross-validation. Cover and Hart bound the limiting 1-NN error by at most $2R^*$ under their hypotheses, with no statement about finite $n$. Beyer et al. show distances concentrate when their relative variance vanishes, which holds for uniform data and fails for low-dimensional or moment-free data. Trees help at low intrinsic dimension, so measure the contrast.

## Documentation Links

- [Cover and Hart (1967), Nearest Neighbor Pattern Classification](https://isl.stanford.edu/~cover/papers/transIT/0021cove.pdf): the bound, its hypotheses, and the triangle-density example.
- [Beyer et al. (1999), When Is "Nearest Neighbor" Meaningful?](https://members.loria.fr/MOBerger/Enseignement/Master2/Exposes/beyer.pdf): the instability theorem, workloads, and experiments.
- [scikit-learn, Nearest Neighbors user guide](https://scikit-learn.org/stable/modules/neighbors.html): algorithms, trees, and complexity.
- [Malkov and Yashunin, Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320): approximate nearest neighbor search on graphs.
