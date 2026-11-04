---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the MCAR, MAR, and MNAR definitions and how they differ from Rubin's 1976 wording.
- Say what observed data can and cannot show about the mechanism, and measure the bias of each treatment under each mechanism.
- Apply min-max, z-score, and robust scaling, and discretize by width and by frequency, naming the variants that change the numbers.
- Measure the leakage from fitting a step on the whole dataset, and say when it is large.

## Context & Motivation

`the-kdd-process-and-the-data-mining-task-taxonomy` showed one placeholder value undoing a regression. This lesson is step 3 of that process. The right treatment of a missing value depends on why it is missing, and scaling and binning have variants that change the output. All of these steps learn from data, so they meet the rule of `training-test-and-validation-splits`: what is measured on held-out data must not have been used in fitting. This lesson extends that rule to the preprocessing.

## Core Theory

### Why values are missing

Let $Y$ be the full data, split into observed $Y_{obs}$ and missing $Y_{mis}$, and let $R$ record which entries were observed. In the form used by most later authors:

$$\begin{aligned}
\text{MCAR:}\quad & P(R\mid Y_{obs},Y_{mis})=P(R)\\
\text{MAR:}\quad & P(R\mid Y_{obs},Y_{mis})=P(R\mid Y_{obs})\\
\text{MNAR:}\quad & P(R\mid Y_{obs},Y_{mis})\ \text{still depends on }Y_{mis}
\end{aligned}$$

Under **MCAR**, missingness has nothing to do with the data: a logger drops records on a random schedule. Under **MAR**, it depends only on recorded values: older people skip an income question more often, and age is recorded. Under **MNAR**, it depends on the unrecorded value itself even after accounting for what is recorded: high earners hide their income. The mechanism is also relative to the columns held: recording a variable that explains the missingness can turn MNAR into MAR.

**Variant warning.** Rubin (1976) introduced "missing at random" and "observed at random", and did not use the term MCAR. Seaman et al. (2013) quote his sentence: "The missing data are missing at random if for each possible value of the parameter φ, the conditional probability of the observed pattern of missing data, given the missing data and the value of the observed data, is the same for all possible values of the missing data". That concerns the realized pattern under a hypothesized model. Most later authors mean a stronger condition, over all patterns and values, which Seaman et al. call "everywhere MAR", and the formulas above are read that way. The practical result, in the abstract of Rubin's report: for Bayesian inference, the missingness process can generally be ignored if and only if the data are MAR and the parameters "independent".

### What observed data can and cannot say

- **It can reject MCAR.** Under MCAR, rows with and without a missing entry differ only by chance on observed columns, so a clear difference refutes it.
- **It cannot confirm MCAR.** A test that finds no difference may just be looking at the wrong column (Example 1).
- **It cannot separate MAR from MNAR.** Molenberghs et al. (2008) show that "each MNAR model fit to a set of observed data can be reproduced exactly by an MAR counterpart", while the pair gives different predictions for the unobserved values.

So the choice rests on knowledge from outside the observed table: a follow-up sample of non-responders, how the data was collected (a sensor with a known ceiling), or a sensitivity analysis under several assumed departures from MAR. A fitted MNAR model does not settle it, because its form is itself an unverifiable assumption.

### Treatments

- **Complete-case analysis** drops rows. It can bias a mean, but that depends on the target: when missingness depends only on a predictor, the regression slope survives (Example 1).
- **Mean imputation** preserves the observed mean, cannot raise the spread, and lowered the correlation in every run of Example 1.
- **Regression imputation** fills in $\hat y(x)$. It recovers the mean under MAR when the predictor is in the model, but the filled values sit on the line, so correlation rises above the truth. Adding a residual draw (stochastic regression imputation) restores the spread under MAR, not under MNAR (Example 1: 8.90 against a true 10.79).
- **Multiple imputation** repeats the draw several times, redrawing the regression parameters as well as the residual, and pools the results, so that uncertainty about the filled values reaches the final standard errors. Repeating only the residual draw still understates that uncertainty (Van Buuren, section 3.2).

### Scaling

| Name | Formula | Result on the data it was fit on |
|---|---|---|
| Min-max | $x'=(x-x_{min})/(x_{max}-x_{min})$ | exactly $[0,1]$ |
| Z-score | $z=(x-\bar x)/s$ | mean 0, $s$ of 1 |
| Robust | $r=(x-\mathrm{median})/\mathrm{IQR}$ | median 0, IQR of 1 |

Three variants matter. `StandardScaler` divides by the population standard deviation (`ddof=0`), while `pandas.Series.std` uses $n-1$. `RobustScaler` takes NumPy's linear quartiles, one rule of several. And the last column has hypotheses. It holds only on the fitting data, so a new value can leave $[0,1]$. A divisor can also be zero: on a constant column for all three, and for robust scaling on any column with an IQR of 0, such as `1 1 1 1 9`. scikit-learn then divides by 1, so a constant column returns zeros and the IQR of 1 does not hold.

All three are affine (a shift and a rescale), so a skewed column stays skewed. Distance-based methods are sensitive to scale, so the choice matters (see `similarity-and-distance-measures`). A decision tree is not, since rescaling a column moves its thresholds without changing the partition of the rows.

### Discretization

**Equal-width** binning cuts the range into $k$ intervals of width $(x_{max}-x_{min})/k$, so one outlier stretches the bins. **Equal-frequency** binning cuts at quantiles, so ties can make equal counts impossible. **Supervised** binning picks cuts using the target, so it is a target-aware step in the sense of the next section. Edges depend on conventions (Example 4).

### Leakage

The rule: anything that learns from data is fit on the training portion only and then applied to the rest. In cross-validation this means fitting inside each fold, which `make_pipeline(SimpleImputer(), StandardScaler(), model)` under `cross_val_score` does automatically. Example 5 measures the size of the error. Examples 1 to 4 are exploratory, with no model being evaluated, so they fit on everything they see.

## Worked Examples

### Example 1: three mechanisms, measured

Take $n=100{,}000$ and `rng = numpy.random.default_rng(42)`. Draw in this order `age = rng.normal(45, 12, n)`, `e = rng.normal(0, 8, n)`, `u = rng.random(n)`, and set `income = 20 + 0.6 * age + e`. An income is missing when `u < p`, with the same `u` for all rows below and $\sigma$ the logistic function. Truth: mean 46.99, standard deviation 10.79, correlation with age 0.669.

```text
mechanism  p                       missing  complete-case  regression   slope on   age gap     Welch
                                            mean           imputation   complete   (mis - obs) p
MCAR       0.4                     0.400    47.05          47.03        0.599       -0.07      0.36
MAR        sigma((age-45)/6-0.5)   0.422    43.30          47.03        0.602      +14.69      <1e-300
MNAR       sigma((income-47)/5-.5) 0.429    41.23          43.19        0.457      +10.02      <1e-300
MNAR-e     sigma(e/4-0.5)          0.426    42.84          42.83        0.601       -0.04      0.57
```

Regression imputation uses age. The MAR row is off by 3.69 with complete cases and recovers with regression, and its complete-case slope, 0.602, stays at the true 0.6. The MNAR row improves only partly. In the last row, age is unrelated to the missingness, so the Welch test on age finds nothing ($p=0.57$) and imputing from age does nothing, yet the mean is off by 4.15. Spread and correlation after imputing:

```text
                      truth   MCAR    MAR     MNAR    MNAR-e
SD, mean imputation   10.79   8.36    7.56    6.51    7.37
SD, stochastic        10.79   10.78   10.80   8.90    9.71
corr, mean imputation 0.669   0.519   0.362   0.405   0.568
corr, regression      0.669   0.758   0.765   0.722   0.828
```

The stochastic residuals are `default_rng(7).normal(0, s, n)`, with $s$ the standard deviation of the complete-case residuals, drawn for all rows and added only where income is missing, with the generator restarted for each mechanism.

### Example 2: same observed data, different answer

Let $X\in\{0,1\}$ always be observed, and $Y\in\{0,1\}$ be sometimes missing. This is everything the data can show:

```text
       P(Y=0, observed)   P(Y=1, observed)   P(Y missing)
X=0    0.30               0.10               0.10
X=1    0.15               0.15               0.20
```

The table does not say how the "missing" mass divides between $Y=0$ and $Y=1$. Two choices, in exact arithmetic:

```text
                                       Model A (MAR)    Model B (MNAR)
P(Y=1 | X, missing)                    0.25, 0.50       0.80, 0.80
P(observed | X=0, Y=0)                 0.8              15/16 = 0.9375
P(observed | X=0, Y=1)                 0.8              5/9 = 0.5556
P(observed | X=1, Y=0)                 0.6              15/19 = 0.7895
P(observed | X=1, Y=1)                 0.6              15/31 = 0.4839
P(Y=1)                                 0.375            0.49
```

For Model B, $P(Y=1)=0.10+0.10(0.8)+0.15+0.20(0.8)=0.49$. Both models reproduce every cell of the observed table, so no test on that table can choose between them.

### Example 3: one column, three scalings

The column is `2, 4, 4, 5, 7, 9, 100`, with mean 18.714, $s=33.251$ (`ddof=0`) or $35.915$ (`ddof=1`), median 5, and linear quartiles 4 and 8.

```text
x             2       4       4       5       7       9       100
min-max       0.000   0.020   0.020   0.031   0.051   0.071   1.000
z, ddof=0    -0.503  -0.443  -0.443  -0.412  -0.352  -0.292   2.445
z, ddof=1    -0.465  -0.410  -0.410  -0.382  -0.326  -0.270   2.263
robust       -0.75   -0.25   -0.25    0.00    0.50    1.00    23.75
```

By hand, $(9-2)/98=0.071$ and $(100-5)/4=23.75$. The outlier squeezes six values into $[0,0.071]$ under min-max, and robust scaling keeps them apart. Fit min-max on the first six values only and then transform new values: 100 becomes 14.0 and 1 becomes $-0.143$, both outside $[0,1]$. Quartile rules also differ: on this column $Q_3$ is 8 (`linear`), 7 (`lower`), 9 (`higher`), or 8.67 (`median_unbiased`).

### Example 4: the same bins are not the same

Ages `18 22 22 22 25 30 31 35 40 42 44 47 52 58 90`, three bins. The width is $(90-18)/3=24$, so an inner edge falls exactly on 42.

```text
method                                edges                      counts   bin of 42
pandas.cut                            17.928, 42, 66, 90         10 4 1   0
KBinsDiscretizer uniform              18, 42, 66, 90             9 5 1    1
pandas.qcut                           18, 28.33, 42.67, 90       5 5 5    1
KBinsDiscretizer quantile avg. i-CDF  18, 30, 44, 90             5 5 5    1
```

`pandas.cut` closes bins on the right, while `KBinsDiscretizer` closes them on the left, so the same edge sends 42 to different bins. `pandas.cut` also lowers the first edge by 0.1% of the range to include 18. One value, 90, leaves the top equal-width bin nearly empty. The `KBinsDiscretizer` quantile line uses the default `"averaged_inverted_cdf"` of scikit-learn 1.9.1, and `quantile_method="linear"` gives the `qcut` edges.

Ties break equal frequency. For `1 1 1 1 1 1 2 3 4 5`, the three-bin edges are 1, 1, 2, 5. `pandas.qcut` raises `ValueError: Bin edges must be unique` unless given `duplicates="drop"`, and `KBinsDiscretizer` drops the empty bin. Both then return two bins, but the closed side moves the value 2: `pandas.qcut` gives counts 7 and 3, and `KBinsDiscretizer` with its default gives 6 and 4. With `quantile_method="linear"` it reports 7 and 3, only because rounding leaves the edge at 2.000000000000001.

### Example 5: how large is the leak?

Each row fits the step on all the data, then runs 5-fold cross-validation on the model alone ("fit on all"), and compares this with the pipeline, averaged over seeds 0 to 199, with `default_rng(s)` for data and `KFold(5, shuffle=True, random_state=s)`. The first two rows use `Z = rng.normal(size=(n + 20000, 10))`, `y = (Z[:, 0] + Z[:, 1] + rng.normal(size=n + 20000) > 0)`, and `X = Z * numpy.geomspace(1, 1000, 10)`, with the extra 20,000 rows measuring true accuracy. Missing cells are `rng.random(X.shape) < 0.3`, drawn after `y`. In the last three rows the columns are drawn first, `rng.integers(0, 100, n)` for the categories or `rng.normal(size=(n, p))` for the numeric columns, and then `y = rng.integers(0, 2, n)`, which is pure noise, so the true accuracy is 0.5. `SelectKBest` uses its default `f_classif`. Target-mean encoding replaces a category by its training mean of `y`, and an unseen category by the overall mean. Logit is `LogisticRegression(max_iter=1000)`.

```text
step, then model             data                                fit on all  pipeline  truth   gap (SE)
z-score, 5-NN                n=100, 10 columns                   0.677       0.677     0.683   +0.0002 (0.0013)
mean imputation, z, 5-NN     same, 30% of cells missing, MCAR    0.610       0.612     0.619   -0.0022 (0.0019)
target-mean encoding, logit  n=1000, 100 categories, noise y     0.621       0.502     0.500   +0.1197 (0.0012)
SelectKBest(10), logit       n=1000, 100 columns, noise y        0.562       0.501     0.500   +0.0616 (0.0013)
SelectKBest(20), logit       n=100, 1000 columns, noise y        0.823       0.497     0.500   +0.3259 (0.0043)
```

The first two gaps are within two standard errors of zero: here, with random folds, no leak from scaling or mean imputation could be detected. Those steps estimate at most two numbers per column and never read `y`. The pipeline scores sit below the truth for a different reason: it trains on 80 rows, not 100.

The other three steps read `y`, so test labels shape the features, and on pure noise the whole gap is leakage: from 0.06 to 0.33 here. The last row is a stress case with far more columns than rows, not a typical result. A pipeline adds one line of code and removes the question. All folds here were random, so the table says nothing about time-ordered data.

## Common Misconceptions & Pitfalls

- **"MAR means the values are missing at random."** MAR allows strong dependence on recorded columns: the age gap in Example 1 was 14.69 years.
- **"No difference between groups means MCAR."** The MNAR-e row passed with $p=0.57$ and a mean off by 4.15.
- **"Mean imputation is harmless because the mean stays."** Under MCAR it cut the correlation from 0.669 to 0.519.

## Summary

Missingness depends on nothing (MCAR), on recorded values (MAR), or on the missing values themselves (MNAR). Observed data can refute MCAR, cannot confirm it, and cannot separate MAR from MNAR. Regression imputation recovered a mean under MAR and not under MNAR, and mean imputation shrank spread in every run. The scalers are affine and promise their ranges only on the fitting data, and bins differ between libraries. Fit every step on training data only, above all steps that read the target: the gap was 0.0002 for scaling and up to 0.33 for feature selection on noise.

## Documentation Links

- [Seaman et al. (2013), What Is Meant by "Missing at Random"?](https://arxiv.org/pdf/1306.2812): Rubin's sentence, and realized and everywhere MAR.
- [Rubin, Inference and Missing Data (ETS record, 1975)](https://www.ets.org/research/policy_research_reports/publications/report/1975/hrri.html): the abstract of the report version of the 1976 paper.
- [Molenberghs et al. (2008), Every missingness not at random model has a missingness at random counterpart with equal fit](https://researchonline.lshtm.ac.uk/id/eprint/7959): record and abstract.
- [Van Buuren, Flexible Imputation of Missing Data, section 1.2](https://stefvanbuuren.name/fimd/sec-MCAR.html): the three mechanisms in plain terms.
- [Van Buuren, section 3.2](https://stefvanbuuren.name/fimd/sec-linearnormal.html): stochastic regression imputation and parameter draws compared.
- [Van Buuren, section 3.8](https://stefvanbuuren.name/fimd/sec-nonignorable.html): nonignorable data and sensitivity analysis.
- [scikit-learn, Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html): leakage during preprocessing, and pipelines.
- [scikit-learn, Preprocessing data](https://scikit-learn.org/stable/modules/preprocessing.html): the scalers.
- [scikit-learn, KBinsDiscretizer](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.KBinsDiscretizer.html): binning strategies and quantile methods.
- [pandas, pandas.cut](https://pandas.pydata.org/docs/reference/api/pandas.cut.html): right-closed bins and the range extension.
- [pandas, pandas.qcut](https://pandas.pydata.org/docs/reference/api/pandas.qcut.html): quantile bins and duplicate edges.
