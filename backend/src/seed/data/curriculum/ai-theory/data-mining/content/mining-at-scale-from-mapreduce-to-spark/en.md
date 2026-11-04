---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Count MapReduce rounds and Spark jobs for A-Priori, SON, PFP, and k-means, and read a job count correctly.
- Implement SON on Spark, prove it has no false negatives, and show the proof failing without its hypothesis.
- Keep SON and PFP apart: one splits the baskets, the other splits the search space.
- Describe what MLlib's `FPGrowth` and `KMeans` run, and what local mode cannot measure.

## Context & Motivation

`frequent-itemsets-and-the-apriori-algorithm`, `fp-growth`, and `k-means-clustering` assume the data fit on one machine. One thing that breaks is memory: Mining of Massive Datasets (MMDS) gives $2n^2$ bytes for a triangular array of pair counts over $n$ items, at 4 bytes per count, so a million items need about 2 TB before any pruning. The other is passes: running time is proportional to the passes times the size of the file.

`the-mapreduce-programming-model` runs one pass on many machines, and `mapreduce-fault-tolerance-locality-and-stragglers` shows how it survives failures. This lesson counts the passes each algorithm needs, and asks what changes when passes share memory.

## Core Theory

### Rounds, jobs, and stages

A **MapReduce round** is one job in the sense of `the-mapreduce-programming-model`: map, shuffle, reduce, output to the file system. A **Spark job** is a unit of work that an action submits, usually one per action, although some submit more (`takeSample` counts first and then samples). A job splits into **stages** at each shuffle. So one round usually corresponds to a job of two stages, and a `count` with no shuffle is a job of one stage.

### Spark's in-memory model

Zaharia et al. (2012) state the problem: in most frameworks of that time, "the only way to reuse data between computations (e.g., between two MapReduce jobs) is to write it to an external stable storage system". An RDD is a partitioned collection built by coarse-grained transformations. Spark records them as **lineage**, so a lost partition is recomputed from its parents, the same idea as re-running a map task from its input split, extended across a chain of steps. `cache()` keeps a computed RDD in memory for later jobs.

**Book vs today.** That paper's speedups belong to its setup: Hadoop 0.20.2, 100 GB, 2012. After the first iteration on 100 machines, Spark was 25.3 times faster than Hadoop on logistic regression, and on k-means, where computation dominates iteration time, 1.9 to 3.2 times.

### SON: split the baskets

MMDS names SON after Savasere, Omiecinski, and Navathe, and gives its two-pass MapReduce form. A chunk holding fraction $p$ of the baskets is mined in memory at threshold $ps$. The union of the local results is the **candidate set**, and a second pass counts every candidate over all baskets.

**Theorem (no false negatives).** Let the chunks partition the baskets, let chunk $i$ have threshold $t_i$ with $\sum_i t_i\le s$, and let each chunk be mined completely. Then every itemset with total count at least $s$ is a candidate.

*Proof.* If $I$ is not a candidate, then $c_i<t_i$ in each chunk, so $\sum_i c_i<\sum_i t_i\le s$. $\square$

The first pass can produce false positives, which is the reason for the second. Example 1 breaks the threshold hypothesis.

### PFP: split the search space

PFP (Li et al., 2008) divides the mining work, not the baskets, in three MapReduce phases. The first counts items and produces the frequency-sorted F-list, and the items are then divided into groups on one computer. In the second, with each basket in F-list order, as in Figure 1 of the paper, the mapper emits to each group present the prefix ending at that group's rightmost item. Each reducer builds an FP-tree and grows only the patterns of its own items, keeping the $K$ most supported. The third phase aggregates them into a top $K$ per item.

**Why no verification pass is needed.** A pattern belongs to the group of its rarest item $x$, the suffix. Every basket containing the pattern sends to that group a prefix reaching at least $x$, which keeps all of the pattern's items, so the count found there is the true count. The hypothesis is one global item order, which is why counting must finish first.

| | SON | PFP |
|---|---|---|
| What is split | baskets into chunks | search space into item groups |
| Threshold in a task | lowered to $ps$ | the global $s$ in Spark; the paper's reducer keeps a top $K$ |
| What a task returns | candidates, possibly false | final patterns with final counts |
| Verification pass | required | none |
| MapReduce rounds | 2 | 3 in the paper |

### What MLlib runs

**FPGrowth.** The Spark guide says: "PFP distributes the work of growing FP-trees based on the suffixes of transactions". The Spark 4.3.0 source differs from the paper: a group is the item's rank modulo the number of partitions, a pattern is kept when its suffix item belongs to the partition, and there is no top-$K$ heap and no aggregating round. All patterns reaching $\lceil\text{minSupport}\cdot n\rceil$ come back.

**KMeans.** The Spark guide says: "The MLlib implementation includes a parallelized variant of the k-means++ method called kmeans||." Each Lloyd iteration is one shuffle. k-means++ needs $k$ passes, one per center. Bahmani et al. (2012) instead sample each point with probability $\ell\,d^2(x,C)/\phi_X(C)$, with $\phi_X(C)$ the total cost under the current centers, adding about $\ell$ centers per round, and then recluster the weighted centers down to $k$. Their guarantee takes $O(\log\psi)$ rounds, with $\psi$ the initial cost, and they report that a few suffice in practice. Spark's defaults differ: in 4.3.0, `initSteps` is 2, $\ell$ is $2k$, and the reclustering is a weighted k-means++ on the driver.

### Book vs today: Apache Mahout

Mahout's earlier code, in the words of its site, is the "Mahout Classic (Samsara and MapReduce) codebase", which "is in maintenance mode". As of November 2026, the site says the project's work "centers on quantum machine learning in Python", its blog announced QuMat v0.6.0 in June 2026, and the Apache Attic does not list it. A book presenting Mahout as a MapReduce mining library describes that earlier code.

## Worked Examples

Everything ran on Spark 4.3.0 with default settings in `local[4]`, on Java 21 and Python 3.13.5.

### Example 1: SON on Spark, and breaking it

Twelve baskets in two chunks of six, global threshold $s=4$, so each chunk uses 2:

```python
import itertools
from collections import Counter
from operator import add
from pyspark.sql import SparkSession

spark = SparkSession.builder.master("local[4]").getOrCreate()
sc = spark.sparkContext
B = [["bread", "eggs", "tea"], ["coffee", "sugar"], ["bread", "milk", "sugar"],
     ["bread", "coffee", "tea"], ["bread", "coffee", "tea"], ["coffee", "sugar"],
     ["eggs", "coffee", "sugar"], ["bread", "eggs", "coffee", "tea"], ["milk", "tea"],
     ["milk", "sugar"], ["bread", "coffee", "tea"], ["eggs", "coffee", "tea"]]

def frequent(baskets, t):
    baskets = [set(b) for b in baskets]
    counts = Counter(i for b in baskets for i in b)
    level, out = {(i,): c for i, c in counts.items() if c >= t}, {}
    while level:
        out.update(level)
        items = sorted({i for c in level for i in c})
        k = len(next(iter(level))) + 1
        cands = [c for c in itertools.combinations(items, k)
                 if all(x in level for x in itertools.combinations(c, k - 1))]
        level = {c: n for c in cands if (n := sum(set(c) <= b for b in baskets)) >= t}
    return out

def son(rdd, n, s):
    def local(chunk):
        chunk = list(chunk)
        return frequent(chunk, len(chunk) * s / n).keys()
    cand = rdd.mapPartitions(local).distinct().collect()
    pairs = rdd.flatMap(lambda b: [(c, 1) for c in cand if set(b).issuperset(c)])
    return cand, pairs.reduceByKey(add).filter(lambda kv: kv[1] >= s).collectAsMap()

sc.setJobGroup("son", "")
cand, final = son(sc.parallelize(B, 2), 12, 4)
print(len(sc.statusTracker().getJobIdsForGroup("son")), len(cand), len(final),
      final == frequent(B, 4))
```

```text
2 14 9 True
```

That is 2 jobs (4 stages), 14 candidates, and 9 frequent itemsets, equal to exact mining. One of the 5 false positives is `milk`, with count 2 in the second chunk and total count 3.

**Thresholds that sum above $s$.** Keep 4 in each chunk, so they sum to 8. The candidates shrink to 3, and 6 of the 9 frequent itemsets are lost, among them `eggs`, with counts 1 and 3 in the two chunks. No second pass recovers what the first never proposed.

**Order.** False positives depend on the chunks. The same baskets give 14 candidates as listed, 15 with `sorted(B)`, and 17 with `random.Random(1).sample(B, 12)`, all exact. Random order did not help here, so these runs show only that the count moves with the chunks.

### Example 2: PFP by hand, on the same baskets

The F-list is `coffee 8, tea 7, bread 6, sugar 5, eggs 4`, and `milk` falls out at 3. These counts have no ties. With two partitions, rank modulo 2 gives group 0 = `coffee, bread, eggs` and group 1 = `tea, sugar`. The basket `bread eggs coffee tea` sorts to `coffee tea bread eggs`. Scanning from the right, `eggs` opens group 0 with the whole basket, and `tea` opens group 1 with `coffee tea`.

All baskets yield 10 conditional baskets for group 0 and 12 for group 1, so the 30 filtered items become 46 shipped items. Each group mines at threshold 4 and keeps a pattern only when its rarest item is in the group:

```text
group 0: finds 8, keeps 6  bread 6, coffee 8, eggs 4, bread coffee 4,
                           bread tea 5, bread coffee tea 4
group 1: finds 4, keeps 3  sugar 5, tea 7, coffee tea 5
```

The union has 9 patterns, none repeated, and every count is final, with no second pass. This Python replay, `frequent(B, 4)`, and `pyspark.ml.fpm.FPGrowth(minSupport=4/12, numPartitions=2)` return the same itemsets and counts.

**Hypothesis.** Skip the sort, and the replay returns 7 of 9: `bread tea` and `bread coffee tea` vanish, because a basket written `bread coffee tea` puts `tea` last, and the prefix for `bread`'s group stops short.

### Example 3: rounds and jobs

Jobs come from `sc.statusTracker().getJobIdsForGroup`. The MapReduce column follows each algorithm's definition, since no Hadoop job ran. The first three rows use the 12 baskets in 2 partitions, with FPGrowth reading `sc.parallelize([(b,) for b in B], 2).toDF(["items"])`. The last two use the points of Example 4 on `sc.parallelize(lines, 4)`, with `seed=1` for KMeans:

```text
algorithm           MapReduce rounds    Spark jobs   stages run
A-Priori on RDDs    3 (one per level)   3            6
SON on RDDs         2                   2            4
FPGrowth            3 in the paper      4            6
Lloyd on RDDs       5 (one per iter)    5            10
KMeans (k-means||)  not defined here    20           30
```

- **A-Priori.** Level 2 counts 10 candidates and keeps 3, level 3 counts 1 and keeps it, and level 4 has no candidates, so no job runs.
- **FPGrowth.** `fit` shows 3 jobs: two bookkeeping `count` calls and item counting. The fourth, tree building, runs only when `freqItemsets` is read. So 2 jobs are the algorithm's rounds.
- **KMeans.** The 20 jobs are 2 from the DataFrame layer for the solver choice, 2 from one `takeSample` call, 2 steps of `sum` plus `collect`, 1 `countByValue` for the weights, 9 Lloyd iterations, and 2 from the DataFrame layer for the summary.

### Example 4: caching, parallel k-means, and layouts

Four Gaussian blobs:

```python
import numpy as np

rng = np.random.default_rng(11)
true_c = np.array([[0, 0], [6, 0], [0, 6], [6, 6]], float)
lab = rng.integers(0, 4, 20000)
X = true_c[lab] + rng.normal(size=(20000, 2))
lines = [f"{a:.6f},{b:.6f}" for a, b in X]
```

Hand-written Lloyd on `sc.parallelize(lines, 4)`, parsing each line in a `map`, starts from the first four points and stops when no center moves more than $10^{-4}$. An accumulator counts parse calls, and no task re-ran:

```text
           iterations   jobs   records parsed
no cache   5            5      100000  (5 x n)
.cache()   5            5       20000  (1 x n)
```

A NumPy Lloyd from the same start gives the same 5 iterations and centers. Without `cache()`, each job recomputes its input, the shape of a chain of MapReduce jobs rereading the file.

`KMeans(k=4, seed=s)` for $s$ from 1 to 10, on cached DataFrames of the same points (`rows` holds them parsed). The seed selects points by position, so row placement changes the run:

```text
layout                                 k-means||            random
                                       iters  mean jobs     iters  mean jobs
sc.parallelize(lines, 4), parsed       3-9    15.3          4-13   13.0
createDataFrame(rows).repartition(4)   3-4    14.8          6-18   14.8
createDataFrame(rows).coalesce(1)      3-4    12.8          4-18   12.1
sc.parallelize(rows, 8)                3-10   15.4          5-16   14.1
```

`createDataFrame(rows)` alone, with 4 partitions, repeats the first row. All 100 fits, counting both modes and that fifth layout, reached cost 39770.13, the same as `sklearn.cluster.KMeans(n_clusters=4, n_init=10, random_state=0)`.

On every layout k-means|| had the narrower range of iterations and the lower mean, from 3.8 to 4.4 against 7.0 to 8.8. Its mean jobs were never lower, though: level with random on one layout, above it on the others, because initialization costs 5 extra jobs. On four separated blobs both reach the same cost, so these runs show no gain in quality.

**Hypothesis.** With the 30 points `[0., 5., 10.] * 10` and $k=4$, seeds 1 to 40, k-means|| returned 3 centers every time, and random returned 3 on 24 seeds and 2 on 16, because a sample of four points can miss a value. The value of $k$ is a request, not a guarantee.

**What local mode does not show.** `local[4]` is four threads in one JVM. Shuffles never cross a network and no machine can fail, so a wall-clock time here says nothing about cluster speedup, and none is given. The counts carry over.

## Common Misconceptions & Pitfalls

- **"SON and PFP are two versions of the same thing."** SON splits baskets and verifies candidates in a second pass. PFP splits the search space and verifies nothing.
- **"Lower the threshold by any amount and SON stays exact."** The guarantee needs thresholds summing to at most $s$. Thresholds that were not scaled down lost 6 of 9 itemsets.

## Summary

At scale the costs are memory for counters and passes over the data. A-Priori takes one round per level. SON takes two, with no false negatives when thresholds sum to at most $s$. PFP splits the search by suffix item under one global order, so each group returns final counts: three phases in the paper, two shuffling rounds in Spark. Lloyd takes one round per iteration, and `cache()` cut parsed records from 5 times to 1 times $n$. Spark's KMeans uses k-means|| with 2 steps by default, which kept iterations in a narrower range than random initialization on every layout tried, while its mean job count ranged from level with random to 2.3 above it. Local mode validates counts, not cluster speedup.

## Documentation Links

- [Mining of Massive Datasets, chapter 6 (archived copy)](https://web.archive.org/web/20241120025442/http://infolab.stanford.edu/~ullman/mmds/ch6.pdf): A-Priori passes, memory for counts, and the SON algorithm with its MapReduce form.
- [Li et al. (2008): PFP, Parallel FP-Growth for Query Recommendation](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/34668.pdf): group-dependent shards and the three phases.
- [Bahmani et al. (2012): Scalable K-Means++](https://theory.stanford.edu/~sergei/papers/vldb12-kmpar.pdf): the k-means|| algorithm and its guarantee.
- [Zaharia et al. (2012): Resilient Distributed Datasets](https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf): RDDs, lineage, and measurements against Hadoop.
- [Spark, Frequent Pattern Mining](https://spark.apache.org/docs/latest/ml-frequent-pattern-mining.html): `FPGrowth` and its parameters.
- [Spark, Clustering](https://spark.apache.org/docs/latest/ml-clustering.html): `KMeans` and k-means||.
- [Spark source, mllib FPGrowth.scala at v4.3.0](https://github.com/apache/spark/blob/v4.3.0/mllib/src/main/scala/org/apache/spark/mllib/fpm/FPGrowth.scala): item ranks and the suffix filter.
- [Spark source, mllib KMeans.scala at v4.3.0](https://github.com/apache/spark/blob/v4.3.0/mllib/src/main/scala/org/apache/spark/mllib/clustering/KMeans.scala): the k-means|| steps.
- [Apache Mahout](https://mahout.apache.org/): the project's statement of its focus and of the status of Mahout Classic.
- [Apache Mahout blog](https://mahout.apache.org/blog): recent release posts.
- [Apache Attic](https://attic.apache.org/): the list of retired Apache projects.
