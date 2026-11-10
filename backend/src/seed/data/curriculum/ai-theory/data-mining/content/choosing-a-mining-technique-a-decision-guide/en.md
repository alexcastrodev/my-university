---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Turn a question into a mining task by naming the decision, the unit of analysis, and whether a target exists.
- Choose a technique within a task from the properties of the data, using the measured failures of each method.
- Write down, before running anything, the result that would invalidate the conclusion.
- Build a reference for what chance produces, for rules and for clusters, and say what that reference keeps and what it destroys.
- Recognize when a question belongs to a SQL query or to supervised learning rather than to mining.

## Context & Motivation

Most techniques in this discipline produce output on data that holds no pattern: k-means returns $k$ groups whenever the data has at least $k$ distinct points, LOF scores every row, and Apriori lists whatever clears the threshold. Earlier lessons measured what that means. Lift reached 13.99 on independent items in `association-rules-support-confidence-lift`, noise had a best $k$ in `cluster-validation`, a topic-free corpus reached silhouette 0.540 in `a-text-clustering-pipeline-end-to-end`, and in `the-kdd-process-and-the-data-mining-task-taxonomy` the best of 1000 noise columns scored 0.67 where it was found and 0.40 outside.

So choosing a technique has two halves. One is matching the method to the question and the data. The other is deciding in advance what would show the output to be empty. This guide covers both. It does not teach the methods again: each row points to the lesson that does, and `choosing-and-validating-a-model-a-decision-guide` is the counterpart for supervised models.

## Core Theory

### Four questions before any technique

1. **What decision changes with the answer?** If no action depends on the result, nothing tells you when the analysis is finished.
2. **What is the unit?** A customer, a visit, a session, a document. The unit sets the grain of the table (`data-warehouses-data-marts-and-olap`) and what "similar" or "together" can mean. Items bought in one visit and items bought by one customer over a year are different baskets, and they give different rules.
3. **Is there a target?** If rows have a known label that new rows should receive, the problem is supervised. Go to `choosing-and-validating-a-model-a-decision-guide`, with `k-nearest-neighbors` as a baseline.
4. **What would this look like if nothing were there?** Answer this before the run. Afterwards, any output is easy to explain.

A question with a known shape, such as revenue per region last quarter, is a query and not a mining task: `GROUP BY` answers it exactly.

### From the question to the task

| Question | Task | Start with | Invalidated by |
|---|---|---|---|
| Which label or value will a new row have? | Classification, regression | `k-nearest-neighbors`, `choosing-and-validating-a-model-a-decision-guide` | Held-out score no better than a simple baseline |
| Which items occur together? | Association | `frequent-itemsets-and-the-apriori-algorithm`, `fp-growth`, `association-rules-support-confidence-lift` | Lift near 1 on held-out baskets, or as many rules on shuffled baskets |
| Do these rows form groups? | Clustering | The next table | A score no better than data without groups, or different groups on a second sample |
| Which rows do not fit? | Anomaly detection | `outlier-detection-quartiles-distance-based-density-based` | Planted cases ranked low, or flagged rows that inspection finds ordinary |

Text is a kind of data and not another task: `text-mining-bag-of-words-and-tf-idf` turns documents into vectors, and the same rows then apply, as in `a-text-clustering-pipeline-end-to-end`. Every row also depends on the preparation in `data-preprocessing-missing-values-scaling-discretization` and on a measure from `similarity-and-distance-measures`. A distance taken by default is still a decision.

### Choosing a clustering method

| Method | You supply | Finds | Breaks on | Cost |
|---|---|---|---|---|
| k-means (`k-means-clustering`) | $k$ | Compact groups | Elongated or nested shapes | One pass over the data per iteration |
| Ward (`hierarchical-clustering`) | Euclidean data, a cut | Compact groups, every $k$ at once | The same shapes, and merges cannot be undone | The $\Theta(n^2)$ distance matrix usually sets the limit |
| Single linkage (`hierarchical-clustering`) | A distance, a cut | Chains and arbitrary shapes | Bridges and stray points | Quadratic time |
| DBSCAN (`density-based-clustering-with-dbscan`) | `Eps`, `MinPts` | Arbitrary shapes, plus noise | Dense groups closer together than the `Eps` a sparse group needs | Quadratic worst case for the original algorithm |

### Choosing an outlier rule

Start from what "does not fit" means. The quartile rule looks at one column at a time: it is cheap and easy to explain, and it cannot see a row whose values are normal separately and rare together. Distance-based rules see whole rows but use one global scale. LOF compares a point with its own neighbors and has no universal threshold. Whether a flagged row is an error or the finding depends on where the data came from, not on the score.

### Apriori or FP-Growth

With the same threshold both return the same itemsets, so this choice changes the cost and not the answer. Timings in `fp-growth` split both ways, so measure on the data and implementation at hand. The threshold is the choice that changes the answer, as Example 2 shows.

### How much data

The costs at scale are memory for counters and passes over the data (`mining-at-scale-from-mapreduce-to-spark`). A sample is enough when the pattern sought is common, and it can lose a rare pattern entirely, so rare itemsets and rare events need the full data. Move to a cluster when the data or the counters no longer fit on one machine. A cluster changes cost and failure modes; it does not make a result valid, and the tests in this guide still apply.

### What a reference keeps and what it destroys

A reference is a version of the data with the claimed structure removed and the rest kept. Choosing what to keep is the hard part.

- **Rules:** shuffle each item column on its own. This keeps every item's frequency and destroys co-occurrence. It also changes basket sizes. Swap randomization keeps both the row and the column totals (Zaki and Meira, chapter 12).
- **Clusters:** draw from a Gaussian with the mean and covariance of the data. This keeps correlation and destroys groups.
- **Text:** a control corpus with no topics, as in `a-text-clustering-pipeline-end-to-end`.
- **Outliers:** plant cases of the kind you care about and check their rank. This says nothing about other kinds.

Passing a reference removes one explanation, chance under that model. It does not show that the pattern is useful or causal.

## Worked Examples

All runs use scikit-learn 1.9.1, mlxtend 0.25.0, and NumPy 2.5.4.

### Example 1: one question, three shapes

Three datasets of 600 points, each z-scored: `make_blobs(600, centers=3, cluster_std=0.6, random_state=7)`; `make_moons(600, noise=0.05, random_state=7)`; and `make_blobs([300, 300], centers=[[0, 0], [6, 0]], cluster_std=[0.3, 1.8], random_state=7)`. k-means (`n_init=10`, `random_state=7`) and both linkages receive the true $k$. DBSCAN uses `eps=0.3`, `min_samples=5` on all three. The table shows ARI against the generating labels.

```text
                 k-means    Ward   single   DBSCAN
blobs              1.000   1.000    1.000    1.000
moons              0.489   0.522    1.000    1.000
two densities      0.902   0.973    0.000    0.892
```

No column wins every row. Single linkage is perfect on moons and scores 0.000 on two densities, where its cut splits one stray point from the other 599. DBSCAN's 0.892 comes from 37 points of the diffuse blob marked as noise, which ARI counts as a third label; on the other 563 points its ARI is 1.000. The table flatters every method with a $k$ or an `eps` that a real analysis would have to find, and ARI exists here only because the labels were generated. That is the purpose of the table: it records which method fits which shape, so the shape of the data has to be examined first.

### Example 2: twelve rules, one fact

```python
rng = numpy.random.default_rng(7)
n, p = 2000, [.30, .15, .35, .25, .40, .20, .30, .25]    # items A to H
T = rng.random((n, 8)) < p
T[:, 1] = numpy.where(T[:, 0], rng.random(n) < .70, rng.random(n) < .10)
```

Only one dependence exists: B follows A. Rules were mined with `apriori` on the first 1000 baskets, keeping confidence at least 0.3 and lift at least 1.2. A rule holds if its lift is at least 1.2 on the last 1000 baskets. The last column mines 200 shuffles of the training baskets, with seeds 1000 to 1199, at the same thresholds.

```text
         all     rules with A and B     other rules      rules on shuffled
minsup  rules     count      hold       count   hold      median    max
 0.05     12        12         12           0      0          0       7
 0.02     31        27         26           4      0         13      44
 0.01     94        63         57          31      2       45.5     143
```

At 0.05 every rule holds, with lift from 2.23 to 2.72 in training and 2.35 to 2.88 outside it, and all twelve state the same fact: rules such as $\{B,C\}\to A$ are A and B plus an independent item. Count facts, not rules. Lowering the threshold to 0.01 multiplied the rules by about 8 and added no fact, since the generator holds no other dependence. At that threshold, baskets with no dependence at all give a median of 45.5 rules. Held-out data and shuffling answer different questions: the first asks whether a rule persists, and the second asks how many rules these thresholds produce from chance. One shuffle reached 7 rules at 0.05, so a median of 0 is not a guarantee.

### Example 3: a reference for clusters

Take the blobs of Example 1. With k-means as in Example 1, build one copy with each column shuffled and one draw from a Gaussian with the same mean and covariance, both from `default_rng(7)`, in that order. Stability is the median and minimum ARI, over seeds $s=0,\dots,49$, between k-means fitted on two random halves, each predicting all 600 rows, with `default_rng(s)` splitting the rows and `random_state=s` in k-means.

```text
                        silhouette at k                     stability, k=3
                      2      3      4      5      6         median     min
data                0.769  0.755  0.682  0.618  0.497        1.000   1.000
columns shuffled    0.460  0.552  0.627  0.634  0.647        0.992   0.765
Gaussian            0.523  0.473  0.442  0.430  0.407        0.786   0.329
```

Over 100 Gaussian draws, seeded 0 to 99, silhouette at $k=3$ ran from 0.445 to 0.516, far below the 0.755 of the data. That is the test passing.

The shuffled row would have misled. It scores 0.647 at $k=6$ with stability 1.000 at that $k$ (minimum 0.989), because the first column has three separate modes and the second has two, and shuffling keeps both. The result is a $3\times2$ grid of six groups, with the silhouette peak exactly at six. A column shuffle therefore tests for structure beyond the marginals, not for structure at all.

Two more readings. The Gaussian row has stability 0.786, because a partition of one ellipse repeats well, so a stable partition need not be a real one. And silhouette prefers $k=2$ on the data, 0.769 against 0.755, while ARI is 0.571 at $k=2$ and 1.000 at $k=3$. The reference says that groups exist. It does not choose $k$.

### Example 4: outliers that no column shows

Take 990 rows with `rng = numpy.random.default_rng(7)`, `z = rng.normal(size=(990, 2))`, first column $z_1$, and second column $0.98z_1+\sqrt{1-0.98^2}\,z_2$. Plant 10 rows off the diagonal: $(\pm1.5,\mp1.5)$, $(\pm1,\mp1)$, $(\pm2,\mp1)$, $(\pm1.5,\mp0.5)$, $(\pm0.5,\mp1.5)$.

```text
quartile rule, per column, NumPy default quartiles, fences near -2.6 and 2.6
    flagged 7 rows, 0 of them planted
LOF, 20 neighbors
    all 10 planted rows in the top 10
    lowest planted 5.94, highest normal 3.91, median normal 1.02
```

Each planted value is ordinary in its own column, and only the combination is rare, so a per-column rule cannot find it. The test covers one kind of anomaly: planted rows that sit far from the diagonal say nothing about a tight fraud ring inside the normal region.

### Example 5: one decision from start to finish

A support team has 80,000 free-text tickets, no categories, and asks what to automate first.

1. **Decision:** which category gets an automated answer. **Unit:** the ticket.
2. **Target:** none yet, since no categories exist, so this is not classification.
3. **Technique:** text vectors and clustering, as in `a-text-clustering-pipeline-end-to-end`, fitted on one month of tickets.
4. **Invalidation, written first:** a control corpus scores the same; clusters fitted on the next month do not match; or a person reading 30 tickets per cluster cannot name it.
5. **Next step:** once people have named the categories, labels exist and the problem has become supervised. The loop of `the-kdd-process-and-the-data-mining-task-taxonomy` returns to its start with a different task.

The technique was the smallest of these choices. The size of the category, which is what the decision depends on, also has to be counted, and a cluster's size is only an estimate of it.

## Common Misconceptions & Pitfalls

- **"The highest score picks the method."** An internal index rewards its own notion of a cluster, and in `cluster-validation` non-convex clusters could make the true partition look worst. In Example 3 the best silhouette chose the wrong $k$.
- **"More rules mean more knowledge."** In Example 2 the count rose from 12 to 94 with one fact in the data: 63 rules restate it and 31 have nothing behind them. Report the facts, and report what the same thresholds produce on shuffled data.
- **"A stable clustering is a real clustering."** One Gaussian reached a median stability of 0.786 in Example 3.
- **"Any shuffle is a null."** A reference keeps what it keeps. Shuffling columns kept the modes of Example 3 and built a grid of false groups.
- **"Passing the test proves the pattern matters."** A reference rules out one model of chance. Rules and clusters describe co-occurrence in the data mined, and a causal claim needs a design that can support it.
- **"Large data should go to a cluster first."** Many of the choices here can be made on a sample, with exact counts afterwards. A cluster answers the same question at a different cost.

## Summary

Choose in order: the decision, the unit, whether a target exists, and what emptiness would look like. A query answers known questions and supervised learning answers labeled ones. Association, clustering, and anomaly detection cover the rest, and text enters through vectors. No clustering method won every shape in Example 1. Twelve rules carried one fact in Example 2, and lowering the threshold added restatements of that fact plus rules that chance also produces, and no new fact. In Example 3 the data beat its Gaussian reference, while a column shuffle would have reported six false groups, so a reference must be chosen for what it destroys. In Example 4 no per-column rule could see what LOF found. Passing such a test removes one explanation and leaves the decision to the person who asked the question.

## Documentation Links

- [Fayyad, Piatetsky-Shapiro, and Smyth (1996), From Data Mining to Knowledge Discovery in Databases](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1230): the process view and the requirement that patterns stay valid on new data.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 12](https://dataminingbook.info/book_html/chap12/book.html): pattern and rule assessment, permutation tests over a whole set of patterns, and swap randomization.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 17](https://dataminingbook.info/book_html/chap17/book.html): clustering validation, stability, and clustering tendency.
- [scikit-learn: comparing clustering algorithms on toy datasets](https://scikit-learn.org/stable/auto_examples/cluster/plot_cluster_comparison.html): the behavior of many clusterers across shapes.
- [scikit-learn: clustering user guide](https://scikit-learn.org/stable/modules/clustering.html): an overview of methods with their parameters and scalability.
- [mlxtend, association_rules](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/): the rule metrics used in Example 2.
