---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Compute support, confidence, and lift of a rule, and name the variants of these measures in books and libraries.
- Prove that lift is symmetric and confidence is not, and show both on data.
- State exactly the case in which confidence is anti-monotone, and show what happens outside it.
- Generate rules from frequent itemsets with confidence pruning, and check them against `mlxtend`.
- Show a rule with high confidence and lift below 1, and a high lift produced by noise.

## Context & Motivation

`frequent-itemsets-and-the-apriori-algorithm` and `fp-growth` produced the same 18 frequent itemsets from 10 invented job postings, at minsup 3. An itemset says that items occur together. A rule says more: among the records with $X$, how often does $Y$ appear, and is that more than $Y$ appears anyway? This lesson uses the same data. The mining is exploratory, with no training or test split, so a rule describes these 10 rows and no more. It describes co-occurrence, and no rule here says that one skill leads to another.

The single-item counts are D 8, S 8, K 7, J 6, P 4, G 1, with $n=10$.

## Core Theory

### Definitions

A rule $X\to Y$ has nonempty, disjoint $X$ and $Y$. With $\sigma$ the support count, $s=\sigma/n$, and $XY$ short for $X\cup Y$:

$$\text{support}(X\to Y)=s(XY),\qquad \text{conf}(X\to Y)=\frac{\sigma(XY)}{\sigma(X)},\qquad \text{lift}(X\to Y)=\frac{\text{conf}(X\to Y)}{s(Y)}=\frac{s(XY)}{s(X)\,s(Y)}.$$

Confidence is the sample estimate of $P(Y\mid X)$. Lift compares it with the base rate $s(Y)$. Lift 1 means $s(XY)=s(X)s(Y)$, what independence would give in this sample. Above 1, $X$ and $Y$ co-occur more than that, and below 1, less.

The names vary, so compare formulas rather than words:

| Name | Formula | Where |
|---|---|---|
| support of a rule | $s(XY)$ | Zaki and Meira, the `support` column of `mlxtend`, and this lesson |
| support of a rule | $s(X)$, the left side only | Mining of Massive Datasets slides |
| interest | $\text{conf}(I\to j)-s(j)$, a difference (the slides' worked example reports its absolute value) | Mining of Massive Datasets slides |
| lift | $\text{conf}/s(Y)$, a ratio | Zaki and Meira, `mlxtend` |
| leverage | $s(XY)-s(X)s(Y)$ | Zaki and Meira, `mlxtend` |

For $D\to S$ below, these give an interest of $-0.05$, a lift of $0.9375$, and a leverage of $-0.04$. All three put the rule below the base rate, on different scales.

### Symmetry

With support taken as $s(XY)$, support and lift do not depend on the direction, because $s(XY)$ and $s(X)s(Y)$ are unchanged by swapping $X$ and $Y$. Lift therefore cannot say which way a rule "points". Confidence does depend on direction:

$$\frac{\text{conf}(X\to Y)}{\text{conf}(Y\to X)}=\frac{\sigma(Y)}{\sigma(X)}.$$

Lift also has a ceiling. Since $s(XY)\le\min(s(X),s(Y))$, we get $\text{lift}\le1/\max(s(X),s(Y))$. A consequent with $s(Y)=0.8$ can never have lift above 1.25, so lift values for rules on items of different frequency are not on equal footing.

### Where confidence is anti-monotone

Support is anti-monotone over itemsets. Confidence is not, and it should not be pruned as if it were. The usable property has a narrow form.

**Property.** Fix one itemset $Z$, and take nonempty sets $X'\subset X\subset Z$. Then

$$\text{conf}(X'\to Z\setminus X')\le\text{conf}(X\to Z\setminus X).$$

*Proof.* Both confidences have numerator $\sigma(Z)$. Since $X'\subset X$, anti-monotonicity of support gives $\sigma(X')\ge\sigma(X)$, so the first fraction has the larger denominator. $\square$

In words: **moving items from the antecedent to the consequent, inside one fixed itemset, cannot raise confidence.** The hypothesis is that $Z$ stays the same, which keeps the numerator fixed.

Drop it and the conclusion goes. Compare $X\to Y$ with $X\cup W\to Y$ for a fixed $Y$: the itemsets differ, numerator and denominator both shrink, and confidence can go either way. Example 3 shows both directions. (Growing only the consequent, with $X$ fixed, also cannot raise confidence, because only the numerator shrinks. That is plain support anti-monotonicity, comparing rules from different itemsets, and it is not what prunes rule generation within $Z$.) Zaki and Meira also note that lift is not downward closed.

### Generating rules

Zaki and Meira and the MMDS slides split the problem in two: find the frequent itemsets, then derive rules. For each frequent $Z$ with $\lvert Z\rvert\ge2$, every nonempty proper subset $X$ gives a rule $X\to Z\setminus X$, so $Z$ has $2^{\lvert Z\rvert}-2$ candidate rules. Its support already meets the threshold, so only confidence needs testing, and $\sigma(X)$ is already stored, since every subset of a frequent itemset is frequent. No pass over the data is needed.

The property gives the pruning, in the form Zaki and Meira's Algorithm 8.6 uses: try large antecedents first, and if $X\to Z\setminus X$ fails minconf, skip every antecedent $W\subset X$. What it saves is lookups, not scans.

## Worked Examples

### Example 1: the rules of the running data

The 18 frequent itemsets include 13 of size at least 2, namely 8 pairs, 4 triples, and DJKS, which give $8\cdot2+4\cdot6+14=54$ rules. A selection, from a script:

```text
rule      s(XY)  s(X)  s(Y)  conf    lift
K -> S    0.7    0.7   0.8   1.000   1.250
S -> K    0.7    0.8   0.7   0.875   1.250
JS -> K   0.5    0.5   0.7   1.000   1.429
J -> K    0.5    0.6   0.7   0.833   1.190
P -> J    0.3    0.4   0.6   0.750   1.250
P -> D    0.3    0.4   0.8   0.750   0.938
D -> S    0.6    0.8   0.8   0.750   0.938
S -> D    0.6    0.8   0.8   0.750   0.938
DK -> J   0.3    0.5   0.6   0.600   1.000
D -> J    0.4    0.8   0.6   0.500   0.833
```

`mlxtend` 0.25.0 gives the same 54 rules with equal confidence and lift, from `association_rules(frequent, metric="confidence", min_threshold=0.0, num_itemsets=10)` on the `apriori` output at `min_support=0.3`.

The first two rows show the asymmetry. $K\to S$ has confidence 1, because all 7 Kubernetes postings list SQL, while $S\to K$ has $7/8$. The ratio is $8/7=\sigma(S)/\sigma(K)$, and lift is 1.25 both ways. That 1.25 is also the ceiling for this consequent, since $s(S)=0.8$.

### Example 2: high confidence, lift below 1

$D\to S$ looks strong: 75% of postings with Docker list SQL. But 80% of all postings list SQL. So among Docker postings SQL is less common than it is overall:

$$\text{lift}(D\to S)=\frac{0.75}{0.8}=0.9375.$$

Confidence alone would keep this rule at any minconf up to 0.75. A single antecedent shows the point even more directly: $P\to J$ and $P\to D$ both have confidence 0.75, with lift 1.25 and 0.9375. The first runs above its base rate of 0.6, the second below its base rate of 0.8. Of the 24 rules with confidence at least 0.7, 6 have lift below 1.

Keep the sample size in view. With 10 rows these are descriptions, not findings. Even the perfect rule $K\to S$ has a one-sided hypergeometric p-value of $8/120=0.067$ against independence with these margins.

### Example 3: the restricted property, and outside it

Inside the fixed itemset $Z=$ DJKS, with $\sigma(Z)=3$, moving items to the right can only lower confidence:

```text
rule        sigma(Z)/sigma(X)   conf
DJK -> S    3/3                 1.000
DJ  -> KS   3/4                 0.750
D   -> JKS  3/8                 0.375
```

Outside it, take the fixed consequent S and grow the antecedent, so that $Z$ changes:

```text
rule      sigma(XY)/sigma(X)   conf    lift
D  -> S   6/8                  0.750   0.938
DK -> S   5/5                  1.000   1.250
DP -> S   1/3                  0.333   0.417
```

Adding K raises confidence and adding P lowers it, so failing minconf at $D\to S$ says nothing about $DK\to S$. Lift moves the same way here, and it crosses 1 at $DK\to S$.

### Example 4: pruning, counted

Generating rules from all 13 itemsets, largest antecedents first, and skipping the subsets of a failed antecedent:

```text
minconf  rules tested, no pruning   rules tested, pruned   rules kept
0.7      54                         39                     24
0.8      54                         35                     11
0.9      54                         34                     6
```

The rules kept are identical with and without pruning at all three thresholds. The saving here is modest, because most itemsets are small.

### Example 5: when lift misleads

**Lift depends on $n$.** Append rows that contain none of these skills, such as postings for other jobs. Confidence does not change, but lift scales with $n$:

```text
rows added   n     conf(D -> S)   lift(D -> S)   lift(K -> S)
0            10    0.75           0.9375         1.25
10           20    0.75           1.875          2.50
90           100   0.75           9.375          12.50
```

$D\to S$ crossed from below 1 to about 9 with no change to any posting that mentions these skills. So lift is a statement relative to a chosen population, and that population must be stated.

**High lift from noise.** Draw `X = rng.random((1000, 200)) < 0.02` with `rng = numpy.random.default_rng(0)`, so each item is present independently with probability 0.02 and no pair is related by construction. A pair is expected in 0.4 transactions. Of the 19,900 pairs, 147 reach a count of at least 3, and their lifts run from 3.03 to 13.99 with median 6.07. Testing each with a one-sided hypergeometric test, 145 of the 147 fall below $p=0.05$, and the smallest is $1.1\times10^{-4}$. None survives a Bonferroni correction for all 19,900 pairs, whose threshold is $2.5\times10^{-6}$. Their confidence is at most 0.31, so a confidence floor would also remove these, but the lift values alone look like discoveries. A planted pair, items 0 and 1 added to the rows of `rng.choice(1000, 20, replace=False)` from the same generator, reaches lift 18.4 at $p=8\times10^{-25}$ and passes the same correction. Zaki and Meira also warn that rare itemsets can have very high lift in small datasets.

## Common Misconceptions & Pitfalls

- **"High confidence means a strong association."** $D\to S$ has confidence 0.75 and lift below 1. Compare with the base rate.
- **"High lift means a real pattern."** All 147 pairs in Example 5 came from independent items.
- **"Lift gives direction."** It is symmetric. Only confidence differs by direction, and that difference only reflects $\sigma(Y)/\sigma(X)$.
- **"Confidence is anti-monotone like support."** The pruning property needs items moved across one fixed itemset. $DK\to S$ beats $D\to S$.
- **"Rules say why."** $K\to S$ reports that all Kubernetes postings in this table list SQL. It says nothing about one requiring the other, and a shared factor or the way the rows were collected could produce it.
- **"Lift is a property of the two items."** It depends on the rows included, as the appended rows show.

## Summary

Rules come from frequent itemsets: the support of $X\to Y$ is $s(XY)$, confidence is $\sigma(XY)/\sigma(X)$, and lift is confidence over $s(Y)$, with names that vary across sources. Lift and support are symmetric, confidence is not, and lift is capped by $1/\max(s(X),s(Y))$. Confidence does not share support's anti-monotonicity: the case that holds is moving items from antecedent to consequent inside one fixed itemset, which is what allows pruning among the $2^{\lvert Z\rvert}-2$ rules of $Z$. On the job-postings data, $D\to S$ has confidence 0.75 and lift 0.9375, below the base rate. Lift changes with $n$, and it reached 13.99 on independent items, so a rule needs its base rate, its population, and some check against chance. A rule describes co-occurrence in the data mined.

## Documentation Links

- [Zaki and Meira, Data Mining and Machine Learning, chapter 8](https://dataminingbook.info/book_html/chap8/book.html): rule support and confidence, the two-step task, rule generation, and the antecedent pruning of Algorithm 8.6.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 12](https://dataminingbook.info/book_html/chap12/book.html): confidence, lift, leverage, and their limits, including significance testing.
- [Mining of Massive Datasets, frequent itemsets](http://www.mmds.org/mmds/v2.1/ch06-assocrules.pdf): course slides with rule support on the left side, the two steps, interest as a difference, and the confidence observation for rule generation.
- [mlxtend, association_rules](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/): the function and the metrics it reports.
