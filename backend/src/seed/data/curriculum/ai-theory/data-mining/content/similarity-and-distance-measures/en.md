---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the four axioms of a metric, and say which common measures satisfy them.
- Show a triangle-inequality counterexample for cosine distance, squared Euclidean distance, and Minkowski distance with $p<1$.
- Choose between Jaccard, simple matching, Hamming, and cosine for binary and text data, and show how the choice changes the result.
- Read the conventions of SciPy and scikit-learn, which differ from textbooks and from each other.
- Show with a run that the units, the scaling, and the value of $p$ each change which neighbor is nearest.
- Explain why a non-metric can be a fine ranking and a broken basis for pruning.

## Context & Motivation

Nearest neighbors, hierarchical clustering, DBSCAN, and outlier scores all start from one choice: what "close" means. `the-dot-product-and-vector-norms` gave the Euclidean norm and the angle between vectors. This lesson asks which measures behave like distances, what breaks when they do not, and how much the answer depends on decisions made before any algorithm runs. `data-preprocessing-missing-values-scaling-discretization` gave the scaling formulas, and here they change results.

## Core Theory

### What makes a metric

A **metric** on a set is a function $d$ with, for all $x,y,z$:

$$\begin{aligned}
&d(x,y)\ge0, \qquad d(x,y)=0\iff x=y,\\
&d(x,y)=d(y,x), \qquad d(x,y)\le d(x,z)+d(z,y).
\end{aligned}$$

The last is the **triangle inequality**: a detour through $z$ cannot be shorter. It is what lets an algorithm skip work. If $d(q,z)$ and $d(z,x)$ are known, then $\lvert d(q,z)-d(z,x)\rvert$ is a lower bound on $d(q,x)$, so once that bound reaches the best distance found so far, $x$ may be discarded without computing $d(q,x)$. Ball trees and pivot-based search rest on this bound.

### Numeric data: the Minkowski family

$$d_p(x,y)=\Big(\sum_{i=1}^n\lvert x_i-y_i\rvert^p\Big)^{1/p}$$

With $p=1$ this is Manhattan distance, with $p=2$ Euclidean, and in the limit $p\to\infty$ it is Chebyshev, $\max_i\lvert x_i-y_i\rvert$.

**Property.** For $p\ge1$, $d_p$ is a metric on $\mathbb R^n$; the triangle inequality is Minkowski's inequality. The hypothesis matters. For $0<p<1$ and $n\ge2$ the triangle inequality fails, since the unit ball is no longer convex (Example 1). MMDS writes "for any constant $r$" when defining the $L_r$-norm, without this condition, so read it with $r\ge1$ in mind. Squaring also breaks the property: squared Euclidean distance is not a metric, although it gives the same ranking of neighbors as Euclidean. `k-means-clustering` minimizes squared distances, and that is fine, because an objective does not need to be a metric.

### Sets and binary vectors

For two binary vectors, let $m_{11}$ count positions where both have 1, $m_{10}$ and $m_{01}$ the disagreements, and $m_{00}$ positions where both have 0.

$$J=\frac{m_{11}}{m_{11}+m_{10}+m_{01}},\qquad \mathrm{SMC}=\frac{m_{11}+m_{00}}{n},\qquad H=m_{10}+m_{01}$$

**Jaccard similarity** $J$ is $\lvert A\cap B\rvert/\lvert A\cup B\rvert$ on sets, and ignores shared absences. **Jaccard distance** $1-J$ is a metric on finite sets, with $d(\emptyset,\emptyset)=0$ by convention, since $J$ is 0/0 there. MMDS proves the triangle inequality using minhash: $1-J$ is the probability that a random minhash separates the two sets. **Simple matching** counts shared absences as agreement. **Hamming distance** $H$ counts differing positions, and is a metric on strings of equal length; it is not defined for unequal lengths.

### Cosine: two different "cosine distances"

Cosine similarity is $\cos(x,y)=x\cdot y/(\lVert x\rVert\lVert y\rVert)$, defined for nonzero vectors. Two distances carry the name:

- **$1-\cos(x,y)$**: the form in SciPy and scikit-learn. It is not a metric.
- **The angle $\arccos(\cos(x,y))$**: the form in MMDS, which calls it the cosine distance. It satisfies the triangle inequality. MMDS says it does "not distinguish between a vector and a multiple of that vector", which the second axiom requires: on raw vectors the angle is zero for $x\ne y$ when one is a positive multiple of the other. So the metric lives on directions, or equivalently on unit vectors.

A sentence saying "cosine distance is a metric" and one saying it is not can both be right, with different definitions.

### Summary of the status

| Measure | Domain | Metric? | Reason |
|---|---|---|---|
| Euclidean, Manhattan, Chebyshev | $\mathbb R^n$ | yes | Minkowski's inequality, $p\ge1$ |
| Minkowski, $0<p<1$ | $\mathbb R^n$, $n\ge2$ | no | triangle fails, Example 1 |
| Squared Euclidean | $\mathbb R^n$ | no | triangle fails, Example 1 |
| Jaccard distance | finite sets | yes | minhash argument in MMDS |
| Hamming | equal-length strings | yes | a changed position is needed at each step |
| $1-\cos$ | nonzero vectors | no | triangle fails; also $d=0$ for $x\ne y$ |
| Angle | directions | yes | composition of rotations in MMDS |

### Library conventions

Run on SciPy 1.18.1 and scikit-learn 1.9.1:

```text
call                                   result    note
scipy hamming([1,0,1,1], [1,1,0,1])    0.5       a fraction, not the count 2
scipy jaccard([0,0,0], [0,0,0])        0.0       defined as zero for two zero vectors
scipy jaccard([1,2,0], [1,3,0])        0.0       inputs read as booleans (SciPy 1.15+; 0.5 before that)
scipy cosine([0,0], [1,1])             nan       zero vector
sklearn cosine_distances, same input   1.0       a zero vector gets similarity 0
```

## Worked Examples

Wherever a nearest neighbor is named below, the distances compared have no tie, so no tie rule is involved.

### Example 1: three counterexamples

Each was computed with `scipy.spatial.distance`. Violating the triangle inequality means the middle point gives a shorter route.

```text
measure            x       z       y       d(x,z)   d(z,y)   sum      d(x,y)
1 - cos            (1,0)   (1,1)   (0,1)   0.2929   0.2929   0.5858   1.0000
squared Euclidean  (0)     (1)     (2)     1        1        2        4
Minkowski p=0.5    (0,0)   (1,0)   (1,1)   1        1        2        4
```

By hand: for the first, $1-1/\sqrt2=0.2929$. For the third, $(\sqrt1+\sqrt1)^2=4$. The same three points show the fix for cosine: the angles are $45^\circ$, $45^\circ$, and $90^\circ$, and $45+45\ge90$ holds with equality. $1-\cos$ also fails the identity axiom: $d((1,2),(2,4))=0$ for two different vectors.

### Example 2: a random check, which is no proof

Take `rng = numpy.random.default_rng(0)`, draw `X = rng.normal(size=(20000, 3, 5))` (20,000 triples of 5-dimensional points), then `B = rng.integers(0, 2, (20000, 3, 20)).astype(bool)`. A violation is $d(a,b)>d(a,c)+d(c,b)+10^{-12}$.

```text
measure            violations out of 20000
Euclidean          0
Manhattan          0
Chebyshev          0
Minkowski p=3      0
angle              0
Hamming (on B)     0
Jaccard (on B)     0
squared Euclidean  2538
1 - cos            1617
Minkowski p=0.5    451
```

Zero violations prove nothing, and that is why the metric column rests on arguments for all points and not on samples. For the angle, MMDS itself says the triangle inequality "is best argued by physical reasoning". A single violation does disprove the property, and the non-metrics fail often, not only on constructed points.

### Example 3: $p$ changes the nearest neighbor

Query at the origin, $A=(3,3)$, $B=(4.5,0)$:

```text
p        0.5      1      2       4       infinity
d(A)     12.00    6.00   4.24    3.57    3.00
d(B)     4.50     4.50   4.50    4.50    4.50
nearest  B        B      A       A       A
```

$d_p(A)=3\cdot2^{1/p}$, so they cross where $2^{1/p}=1.5$, at $p=1.71$. Low $p$ penalizes spreading a difference over several coordinates, and high $p$ cares only about the largest one.

### Example 4: binary data and shared absences

In a catalog of 1000 items, $A=\{1,2\}$, $B=\{1,2,3\}$, and $C=\{4,5\}$:

```text
pair   m11 m10 m01 m00   Jaccard   SMC     cosine   Hamming   scipy hamming
A,B    2   0   1   997   0.667     0.999   0.816    1         0.001
A,C    0   2   2   996   0.000     0.996   0.000    4         0.004
```

Simple matching rates $A$ and $C$ at 0.996, although they share no item, because almost all items are absent from both. For sparse data where a 1 is the rare event, such as baskets or documents, Jaccard or cosine fit better. SMC suits data where both values carry information.

### Example 5: cosine and document length

With term counts $q=(2,1,0)$, $d_1=(20,10,0)$, and $d_2=(1,2,1)$, $d_1$ is $q$ repeated ten times:

```text
           Euclidean   1 - cos
q to d1    20.12       0.0000
q to d2    1.73        0.2697
```

Euclidean picks $d_2$ and cosine picks $d_1$. Length is what separates them: for text, a longer document is usually not a different topic, which is why `text-mining-bag-of-words-and-tf-idf` uses cosine. On unit vectors the two views agree, since $\lVert u-v\rVert^2=2(1-\cos(u,v))$: here $2(0.2697)=0.5394$ equals the squared distance between the normalized vectors. So Euclidean distance on unit vectors, $\sqrt{2(1-\cos)}$, ranks exactly like $1-\cos$ and is a true metric.

### Example 6: scaling changes the nearest neighbor

Five reference customers and a query:

```text
row    age   income
A      31    58000
B      62    52500
C      45    90000
D      25    30000
E      55    70000
Q      30    52000
```

By hand, in raw units, $d(Q,B)=\sqrt{32^2+500^2}=501.02$ and $d(Q,A)=\sqrt{1^2+6000^2}=6000.00$. Each scaler below was fit on the five reference rows only, not on the query, with z-score means $(43.6, 60100)$ and standard deviations $(13.966, 19800)$.

```text
scaling              order of neighbors with distances
raw units            B 501.02, A 6000.00, E 18000.02, D 22000.00, C 38000.00
income in thousands  A 6.08, D 22.56, E 30.81, B 32.00, C 40.85
z-score              A 0.311, D 1.167, E 2.008, C 2.199, B 2.291
min-max              A 0.104, D 0.391, E 0.739, C 0.752, B 0.865
```

In raw units the nearest customer to a 30-year-old is 62 years old, because a dollar outweighs a year. Changing the income unit alone reverses this: distance is not invariant to units, so "raw" is also a decision. When a scaler is used inside a model, fit it on the training data only.

Scalers can also disagree with each other. For reference rows $(19,7)$, $(0,7)$, $(16,7)$, $(15,10)$, $(42,11)$ and query $(6,19)$, z-score picks $(15,10)$ at 5.205 over $(42,11)$ at 5.306, while min-max picks $(42,11)$ at 2.176 over $(15,10)$ at 2.260. The outlier 42 stretches the min-max range more than the standard deviation.

Scaling is not automatically right, because it gives every column equal weight. Take `rng = numpy.random.default_rng(0)`, $n=2000$, `x = rng.normal(0, s, n)`, `y = x > 0`, flip `y` where `rng.random(n) < 0.1`, and add `rng.normal(0, t, (n, 3))` as three noise columns. With 5-NN, the first 1000 rows for training, and the z-score fit on them, test accuracy on the other 1000 rows is:

```text
signal column     noise columns      raw     z-score
s = 1000          t = 0.01           0.898   0.852
s = 0.01          t = 1000           0.508   0.852
```

When noise happens to have the small scale, z-scoring promotes it and accuracy falls. When noise has the large scale, z-scoring rescues the signal. In both, the choice encodes a claim about which columns matter.

### Example 7: a non-metric breaks pruning

Take `rng = numpy.random.default_rng(0)` and normalize to unit length `D = rng.normal(size=(2000, 8))`, then `Q = rng.normal(size=(1000, 8))`, then a pivot `p = rng.normal(size=8)`. For each query, visit items in increasing order of the bound $\lvert d(q,p)-d(x,p)\rvert$, and stop once the bound reaches the best distance found. The true neighbor is the item with the largest dot product.

```text
distance   wrong neighbor (of 1000 queries)   distances computed per query (of 2000)
1 - cos    402                                332
angle      0                                  1113
```

The non-metric search looks three times cheaper and returns the wrong answer 40% of the time, since its "bound" is not a bound. The angle pays for correctness. Libraries guard against this. In scikit-learn 1.9.1, `BallTree(X, metric="cosine")` raises `ValueError`, and `NearestNeighbors(metric="cosine")` falls back to brute force, as does `p=0.5`, with the warning "Mind that for 0 < p < 1, Minkowski metrics are not distance metrics".

## Common Misconceptions & Pitfalls

- **"Cosine distance is a metric" or "is not."** Say which one. $1-\cos$ is not, and the angle is, on directions.
- **"A non-metric is useless."** As a ranking, $1-\cos$ is fine, and squared Euclidean orders neighbors exactly as Euclidean does. What fails is any step relying on the triangle inequality, as in Example 7.
- **"Minkowski distance works for any $p$."** The formula computes for any $p>0$. The metric properties need $p\ge1$.
- **"Scaling is always right."** Example 6 shows it dropping accuracy from 0.898 to 0.852.
- **"Unscaled data is neutral."** Unscaled data weights columns by their units. Changing dollars to thousands swapped the nearest neighbor.
- **"Similarity of 0.996 means similar."** Simple matching gave that to two baskets with nothing in common.
- **"A library's name matches the textbook's."** SciPy's Hamming is a fraction, and since SciPy 1.15 its Jaccard reads integers as booleans.

## Summary

A metric is nonnegative, zero only for identical points, symmetric, and obeys the triangle inequality. Minkowski distance with $p\ge1$, Jaccard distance on sets, Hamming on equal-length strings, and the angle on directions are metrics. $1-\cos$, squared Euclidean, and Minkowski with $p<1$ are not, each with a three-point counterexample. "Cosine distance" names two measures, so check the definition before calling it a metric. The choice of measure and scale changes results: $p$ swapped a neighbor at 1.71, simple matching scored disjoint baskets at 0.996, and changing income to thousands replaced a 62-year-old neighbor with a 31-year-old. Scaling is a claim about which columns matter, and it can help or hurt. A non-metric can rank well, but triangle-based pruning on $1-\cos$ returned the wrong neighbor on 402 of 1000 queries. Euclidean distance on unit vectors gives the same ranking with a true metric.

## Documentation Links

- [Leskovec, Rajaraman, and Ullman, Mining of Massive Datasets, chapter 3 (archived copy)](https://web.archive.org/web/2023/http://infolab.stanford.edu/~ullman/mmds/ch3n.pdf): section 3.5 on distance axioms, $L_r$-norms, and Jaccard, cosine, and Hamming distance.
- [SciPy, scipy.spatial.distance.cosine](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.cosine.html): the $1-\cos$ definition.
- [SciPy, scipy.spatial.distance.jaccard](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.jaccard.html): boolean inputs and the all-zero convention.
- [SciPy, scipy.spatial.distance.hamming](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.hamming.html): the fraction of disagreeing positions.
- [SciPy, scipy.spatial.distance.minkowski](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.minkowski.html): the $p$-norm distance.
- [scikit-learn, cosine_distances](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.pairwise.cosine_distances.html): the pairwise definition as one minus cosine similarity.
- [scikit-learn, BallTree](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.BallTree.html): the tree index and its valid metrics.
- [scikit-learn, NearestNeighbors](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.NearestNeighbors.html): how metric and algorithm are chosen.
- [scikit-learn, StandardScaler](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html): the scaler used in Example 6.
