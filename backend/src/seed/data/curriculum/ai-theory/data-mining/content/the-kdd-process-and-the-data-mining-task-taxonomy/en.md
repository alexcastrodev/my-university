---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Separate KDD, the whole process, from data mining, one step inside it, and state what "valid", "novel", "useful", and "understandable" ask of a pattern.
- Walk the nine KDD steps on a small table and show a later step sending the work back to an earlier one.
- Sort a task into classification, regression, clustering, association, or anomaly detection from the question asked, and find where this curriculum covers it.
- Compare this five-task list with the six-method list of Fayyad et al. and explain why task lists differ between sources.
- Show with a seeded run that a high score on the searched data does not make a pattern valid.

## Context & Motivation

`the-supervised-unsupervised-and-reinforcement-taxonomy` sorted learning problems by the feedback available. This discipline asks a neighboring question: how does a table become something a person can act on, and what could go wrong on the way? Most of that risk sits outside the algorithm. A wrong code in a column, a question matched to the wrong task, or a pattern found by trying a thousand candidates can all produce a clean-looking result.

Fayyad, Piatetsky-Shapiro, and Smyth laid out this view in 1996. This lesson uses their vocabulary to frame the discipline and to locate each task in the curriculum. Later lessons supply the algorithms.

## Core Theory

### KDD is the process, data mining is one step

The 1996 article defines: "KDD is the nontrivial process of identifying valid, novel, potentially useful, and ultimately understandable patterns in data". Each word has a gloss in the article:

- **Nontrivial**: some search or inference is involved. Computing a predefined quantity, such as an average, does not count.
- **Valid**: the pattern holds "on new data with some degree of certainty".
- **Novel**: new to the system at least, and preferably to the user.
- **Potentially useful**: it leads to some benefit to the user or task.
- **Understandable**: if not immediately, then after some postprocessing.

**Data mining** is narrower: the step that applies discovery algorithms to enumerate patterns under practical computing limits. The article also defines **knowledge** modestly, as a pattern that exceeds an interestingness threshold chosen by the user, and it says this is no attempt at a philosophical definition. The bar is set by the application, not by the algorithm.

### The nine steps

The numbering is the article's, the wording here is a summary:

| Step | Work | Picked up in |
|---|---|---|
| 1 | Understand the domain and the goal | every project |
| 2 | Create the target data set | `data-warehouses-data-marts-and-olap` |
| 3 | Clean and preprocess, including missing fields | `data-preprocessing-missing-values-scaling-discretization` |
| 4 | Reduce and project: choose useful features | `principal-component-analysis` |
| 5 | Match the goal to a mining method | `choosing-a-mining-technique-a-decision-guide` |
| 6 | Choose the algorithm and the models to search | the method lessons below |
| 7 | Mine: search for patterns | the method lessons below |
| 8 | Interpret, possibly returning to any of steps 1 to 7 | `cluster-validation`, `evaluation-metrics-precision-recall-and-roc` |
| 9 | Act: use, embed, or report the knowledge, and resolve conflicts with what was believed before | outside the algorithm |

Figure 1 of the article draws five stages as a forward chain with dashed return arrows, and the text warns that it omits "the potential multitude of iterations and loops": the process "can involve significant iteration and can contain loops between any two steps". It also says that, although most earlier work focused on step 7, "the other steps are as important (and probably more so) for the successful application of KDD in practice". That sentence is the article's judgment, not a measurement.

### Five tasks, and how to tell them apart

The article splits discovery goals into **prediction** of unknown values and **description** of patterns for people, and warns that the boundary is not sharp. This discipline works with five tasks:

| Task | Question | Target column? | First check of validity | In this curriculum |
|---|---|---|---|---|
| Classification | Which predefined class? | yes, categorical | held-out accuracy, precision and recall | `logistic-regression-and-decision-boundaries`, `decision-trees`, `k-nearest-neighbors` |
| Regression | What number? | yes, numeric | held-out error | `linear-regression-as-least-squares` |
| Clustering | Which groups exist? | no | internal indices, stability, domain reading | `k-means-clustering`, `hierarchical-clustering`, `density-based-clustering-with-dbscan`, `cluster-validation` |
| Association | What occurs together? | no | support, confidence, and lift on new transactions | `frequent-itemsets-and-the-apriori-algorithm`, `fp-growth`, `association-rules-support-confidence-lift` |
| Anomaly detection | Which rows do not fit? | usually no | inspection of what is flagged | `outlier-detection-quartiles-distance-based-density-based` |

The test is the question, not the table. In terms of `the-supervised-unsupervised-and-reinforcement-taxonomy`, the first two are supervised and clustering is unsupervised. That lesson does not name association or anomaly detection, which in their usual form also take no target column. With trustworthy anomaly labels, the task becomes an imbalanced classification. Reinforcement learning is absent from the list because mining starts from data already collected, not from an agent that acts to obtain it.

**Sources differ, and this list is a choice.** Fayyad et al. present six primary methods: classification, regression, clustering, summarization, dependency modeling, and change and deviation detection. Association has no heading of its own there: the article cites "Fast Discovery of Association Rules" under summarization, as a source for summary rules. Anomaly detection is closest to their change and deviation detection, whose wording concerns changes from previous or normative values. Neither list is a proved partition of the field.

**Book vs today.** The 1996 process ends at acting on the knowledge. CRISP-DM, an industry methodology whose first version was presented in March 1999, has six phases: business understanding, data understanding, data preparation, modeling, evaluation, and deployment. Current practice puts far more weight on what follows deployment. Google Cloud's MLOps guide (last reviewed 2024-08-28) says that "models can decay in more ways than conventional software systems", so data statistics and live performance are tracked after release. The 1996 loop still fits, but now it keeps running after release.

## Worked Examples

### Example 1: one table, five questions

Twelve customers, with visits per month, monthly spend in dollars, whether they churned, and one basket:

```text
id   visits spend churned basket
c01  12     310   0       bread milk butter
c02  10     280   0       bread butter
c03  11     295   0       bread butter eggs
c04  9      260   0       milk eggs
c05  13     330   0       bread milk butter
c06  8      240   1       bread butter
c07  3      90    1       milk
c08  2      70    1       eggs
c09  4      110   1       bread
c10  3      95    0       milk eggs
c11  2      60    1       bread milk
c12  4      9999  1       eggs
```

Five questions, run with scikit-learn 1.9.1 and NumPy. The logistic model is `make_pipeline(StandardScaler(), LogisticRegression())` with default settings, so the z-score is fit inside each leave-one-out fold. K-means reads both numeric columns after a z-score on all rows, which is exploratory, with `n_init=10` and `random_state=0`. The IQR fence is $Q_1-1.5\,\mathrm{IQR}$ to $Q_3+1.5\,\mathrm{IQR}$, with NumPy's default linear quartiles.

```text
task            method                     result
classification  logistic, leave-one-out    9 of 12 correct
regression      spend ~ visits, OLS        spend = 1805.34 - 117.59 visits, R^2 = 0.030
clustering      k-means, k = 2             cluster sizes 11 and 1
association     bread -> butter, counted   support 5/12, confidence 5/7, lift 1.71
anomaly         IQR fence on spend         Q1 93.75, Q3 298.75, fences -213.75 and 606.25, flags c12
```

Lift here is $\frac{5/12}{(7/12)(5/12)}=\frac{12}{7}=1.71$: bread and butter occur together more often than independence would predict in these rows. With twelve rows every number is an illustration, not evidence.

### Example 2: step 8 sends the work back to step 3

Reading the results is step 8, and they look wrong. Spend falls as visits rise, the clusters are one customer against the rest, and $R^2$ is near zero. The flagged row explains all three: 9999 is not a spend but a placeholder for "unknown". That judgment comes from knowing how the data was recorded (step 1), not from the fence, which only says the value is unusual.

Back at step 3, the value is marked missing and c12 leaves the tasks that read spend. Everything downstream runs again:

```text
task            before (12 rows)                      after (11 rows with a real spend)
classification  9 of 12 correct                       9 of 11 correct (errors: c06, c10)
regression      spend = 1805.34 - 117.59 visits       spend = 18.01 + 25.22 visits
                R^2 = 0.030, LOOCV MAE 1697.1         R^2 = 0.989, LOOCV MAE 10.6
clustering      sizes 11, 1                           sizes 6 (c01-c06), 5 (c07-c11)
anomaly         c12 flagged                           nothing flagged (fences -200, 580)
association     unchanged: it never reads spend and keeps all 12 baskets
```

The damage was uneven. Regression and clustering changed completely. Classification kept the same two errors on the rows that remain, so it still has nine correct answers, and its rate rose from 0.75 to 0.82 only because c12, which it got wrong, left the table. Association did not move. Dropping c12 is also a decision with its own assumption, which `data-preprocessing-missing-values-scaling-discretization` examines. Whether an extreme value is an error or the finding is the subject of `outlier-detection-quartiles-distance-based-density-based`.

### Example 3: "valid" means on new data

The article warns: "Blind application of data-mining methods (rightly criticized as data dredging in the statistical literature) can be a dangerous activity, easily leading to the discovery of meaningless and invalid patterns." This run shows the effect. Take `rng = numpy.random.default_rng(2026)`, then in this order `y = rng.integers(0, 2, 200)`, `X = rng.integers(0, 2, (200, 1000))`, and `planted = numpy.where(rng.random(200) < 0.75, y, 1 - y)`. The 1000 columns of `X` are noise. The planted column agrees with `y` 75% of the time. The candidate rule for a column predicts `y` from that bit, flipped if that scores better on the first 100 rows. The search uses those 100 rows, and the other 100 are held out.

```text
rule                 accuracy, searched 100 rows   accuracy, held-out 100 rows
planted column       0.76                          0.74
best noise column    0.67                          0.40
```

In the same run, 68 noise columns reached at least 0.60 on the searched rows, and their mean accuracy on held-out rows was 0.498. Over seeds 0 to 99, with `default_rng(seed)` drawing `y` and then 1000 noise columns the same way, the best noise column (ties go to the lowest index) averaged 0.671 on the searched rows (lowest 0.64, highest 0.73) and 0.501 on the held-out rows.

A single noise column has a standard deviation of 0.05 on 100 rows, so 0.67 is about 3.4 standard deviations, ordinary for the best of 1000 tries. This is the many-hypotheses risk of `training-test-and-validation-splits`, now with a search over patterns in place of a search over models. Only the held-out column separates the real pattern from the lucky ones. Here the signal was planted, so the held-out result can be checked against the truth, which real data does not offer.

## Common Misconceptions & Pitfalls

- **"KDD and data mining are synonyms."** Everyday usage often treats them so. In the 1996 article, data mining is step 7 of a nine-step process, and that distinction is called a central point.
- **"The process is a pipeline."** It has loops. Example 2 went from step 8 back to step 3 because of one value.
- **"The task belongs to the data."** Example 1 asked five questions of one table. The question picks the task.
- **"A strong score on the searched data shows a pattern."** The best noise column scored 0.67 and then 0.40 on held-out rows.
- **"Cleaning improves every result."** In Example 2 no classification answer changed on the 11 remaining rows, and association did not change. Cleaning changes what depends on the bad value.
- **"Lift or a cluster explains why."** Lift 1.71 says that bread and butter co-occur in these baskets. Clusters say that customers resemble each other. Neither one says that any variable causes another.
- **"These five tasks are the standard list."** Fayyad et al. give six, under other names. Check what a source means before comparing.

## Summary

KDD is the whole path from data to knowledge, and data mining is its seventh step. Fayyad et al. ask that patterns be valid on new data, novel, potentially useful, and understandable, and they define knowledge relative to thresholds the user sets. The nine steps form a loop rather than a line: in Example 2 one placeholder value undid a regression and a clustering, and interpretation sent the work back to cleaning. The five tasks of this discipline are classification, regression, clustering, association, and anomaly detection, chosen by the question and not by the table, and other sources divide the field differently. A pattern found by search needs new data before it counts: the best of 1000 noise columns scored 0.67 where it was found and 0.40 outside.

## Documentation Links

- [Fayyad, Piatetsky-Shapiro, and Smyth (1996), From Data Mining to Knowledge Discovery in Databases](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1230): the definitions, the nine steps, and the six primary methods.
- [Wikipedia, Cross-industry standard process for data mining](https://en.wikipedia.org/wiki/Cross-industry_standard_process_for_data_mining): the six CRISP-DM phases, the date of its first version, and the iteration between phases.
- [Google Cloud, MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning): what monitoring adds after deployment.
- [NumPy, numpy.percentile](https://numpy.org/doc/stable/reference/generated/numpy.percentile.html): the quartile methods, including the default linear one used here.
- [scikit-learn, Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html): leave-one-out, the splitter used in the run.
