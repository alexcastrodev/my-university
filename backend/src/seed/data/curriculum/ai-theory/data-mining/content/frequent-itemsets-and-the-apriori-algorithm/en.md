---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define an itemset, support count, relative support, and the threshold convention, and convert between the variants that books and libraries use.
- State the anti-monotone property of support with its hypothesis, prove it, and show a measure for which it fails.
- Run Apriori's join, prune, and count steps by hand, reporting candidates generated, pruned, and counted at every level.
- Check a run against a brute-force enumeration and against `mlxtend`.
- Explain what pruning cannot do and what remains exponential.

## Context & Motivation

k-NN in `k-nearest-neighbors` needed labels. Frequent-itemset mining has none: in the terms of `the-supervised-unsupervised-and-reinforcement-taxonomy` it is unsupervised, and there is no training set, test set, or accuracy here. The runs in this lesson are exploratory, and they describe one dataset.

The question is simple to state: which sets of items occur together in many records? The records can be baskets, job postings, or documents. With $m$ distinct items there are $2^m-1$ nonempty candidate sets, so counting them all stops being possible quickly. Apriori, which Zaki and Meira credit to Agrawal and Srikant (1994), rests on one observation that removes most of them without counting them.

## Core Theory

### Items, transactions, and support

Let $I$ be a set of items and let $D$ be a list of $n$ transactions, each a subset of $I$. An **itemset** is a subset $X\subseteq I$, and a $k$-itemset has $k$ items. A transaction **contains** $X$ when $X\subseteq t$.

$$\sigma(X)=\lvert\{t\in D: X\subseteq t\}\rvert,\qquad s(X)=\frac{\sigma(X)}{n}.$$

$\sigma$ is the **support count** and $s$ the **relative support**. $X$ is **frequent** when $\sigma(X)\ge\text{minsup}$.

Check these conventions before comparing numbers:

| Choice | This lesson | Other usage |
|---|---|---|
| Unit of support | count $\sigma$ | Han, Pei and Yin use counts; `mlxtend` takes the fraction $s$ |
| Comparison | $\sigma(X)\ge\text{minsup}$ | Zaki and Meira, the MMDS slides, Han, Pei and Yin, and `mlxtend` all use "at least"; Example 3 shows what a strict $>$ changes |
| Threshold value | minsup $=3$ of $n=10$ | `min_support=0.3` in `mlxtend`, the same rule only because $n=10$ |

### The running dataset

These 10 invented job postings list skills from six tags: D (Docker), G (Go), J (Java), K (Kubernetes), P (Python), S (SQL). The next two lessons, `fp-growth` and `association-rules-support-confidence-lift`, use this same data.

| ID | Items | ID | Items |
|---|---|---|---|
| T1 | D G J K S | T6 | D K S |
| T2 | D J K P S | T7 | D P |
| T3 | D J K S | T8 | D S |
| T4 | D J P | T9 | J K P S |
| T5 | D K S | T10 | J K S |

In what follows, `DKS` abbreviates $\{D,K,S\}$, and minsup is 3.

### Anti-monotonicity of support

**Property.** If $X\subseteq Y$, then $\sigma(Y)\le\sigma(X)$, with both counted over the same $D$.

*Proof.* Every transaction that contains $Y$ also contains $X$, so the set counted for $Y$ is a subset of the set counted for $X$. $\square$

The contrapositive is the working form: if $X$ is infrequent, every superset of $X$ is infrequent. So the frequent itemsets are closed under taking subsets, and a level-wise search may discard a set as soon as one of its subsets is missing. The hypothesis matters: the proof compares counts of containing transactions over one $D$, so it says nothing about a score defined another way, as Example 4 shows.

### Apriori

Keep each itemset's items in sorted order. Let $L_k$ be the frequent $k$-itemsets, and let $C_k$ be the candidates.

1. Count every item and keep $L_1$.
2. **Join.** For $k\ge2$, combine every two members of $L_{k-1}$ that agree on their first $k-2$ items. Each candidate is generated once, because the two differing last items are taken in increasing order.
3. **Prune.** Delete a candidate if any of its $(k-1)$-subsets is not in $L_{k-1}$. This uses no data.
4. **Count.** Make one pass over $D$ and count the surviving candidates.
5. Keep those with $\sigma\ge\text{minsup}$ as $L_k$. Repeat until there is nothing to generate.

The join and prune steps never lose a frequent itemset: every subset of a frequent $k$-itemset is frequent, so its two $(k-1)$-subsets that share the first $k-2$ items are both in $L_{k-1}$ and it is generated, and no subset test can remove it. At $k=2$ the prune step cannot remove anything, because the two singletons of a joined pair are in $L_1$ by construction.

**Book versus today.** The MMDS slides cost A-Priori in passes: baskets sit in flat files on disk, each pass reads them all, and main memory limits how many counts fit. `mlxtend` keeps a boolean matrix in memory and counts a candidate by combining its item columns. The level-wise logic is the same, so they differ in cost and not in the result.

### What stays exponential

Pruning limits candidates relative to what is frequent, and it cannot make the answer small. If one transaction with $m$ items appears minsup times, all $2^m-1$ of its nonempty subsets are frequent and any algorithm must output them. Candidates also grow before the output does: Han, Pei and Yin note that $10^4$ frequent items force more than $10^7$ candidate pairs, since $\binom{10^4}{2}=49{,}995{,}000$. `fp-growth` attacks that cost.

## Worked Examples

### Example 1: a full run

**$k=1$.** Six candidates, all counted:

```text
D 8   G 1   J 6   K 7   P 4   S 8
```

G falls below 3. $L_1=\{D,J,K,P,S\}$.

**$k=2$.** The join gives all $\binom52=10$ pairs, and the prune removes none:

```text
DJ 4   DK 5   DP 3   DS 6   JK 5   JP 3   JS 5   KP 2   KS 7   PS 2
```

KP and PS fall below 3, leaving 8 pairs in $L_2$. Pruning G earlier saved 5 pairs here.

**$k=3$.** The join on $L_2$ generates 9 candidates:

```text
DJK  DJP  DJS  DKP  DKS  DPS  JKP  JKS  JPS
```

Four have a subset missing from $L_2$, and they are pruned without touching the data:

```text
pruned   missing subset
DKP      KP
DPS      PS
JKP      KP
JPS      PS
```

The other five are counted:

```text
DJK 3   DJP 2   DJS 3   DKS 5   JKS 5
```

DJP is the instructive one. All three of its pairs are frequent, yet only T2 and T4 contain all three items. Pruning is a necessary test and not a sufficient one, which is why the counting pass exists.

**$k=4$.** $L_3=\{DJK,DJS,DKS,JKS\}$. Only DJK and DJS share their first two items, which gives `DJKS`. Its four 3-subsets are all in $L_3$, so nothing is pruned, and its count is 3 (T1, T2, T3).

**$k=5$.** $L_4$ has one member, so the join has no pair and the run stops with no fifth pass. The output of the instrumented run:

```text
k   generated  pruned  counted  frequent
1   6          0       6        5
2   10         0       10       8
3   9          4       5        4
4   1          0       1        1
    total counted: 22          total frequent: 18
```

### Example 2: two independent checks

A brute-force loop over all $2^6-1=63$ nonempty subsets, counting each against the 10 transactions, finds 18 itemsets with the same counts. So does `mlxtend` 0.25.0:

```python
import pandas as pd
from mlxtend.frequent_patterns import apriori
from mlxtend.preprocessing import TransactionEncoder

rows = [list(t) for t in ("DGJKS", "DJKPS", "DJKS", "DJP", "DKS",
                          "DKS", "DP", "DS", "JKPS", "JKS")]
te = TransactionEncoder()
df = pd.DataFrame(te.fit_transform(rows), columns=te.columns_)
apriori(df, min_support=0.3, use_colnames=True)
```

Its supports, grouped by size:

```text
size 1: D 0.8, S 0.8, K 0.7, J 0.6, P 0.4
size 2: KS 0.7, DS 0.6, DK 0.5, JK 0.5, JS 0.5, DJ 0.4, DP 0.3, JP 0.3
size 3: DKS 0.5, JKS 0.5, DJK 0.3, DJS 0.3
size 4: DJKS 0.3
```

The three results agree on all 18 itemsets. Apriori counted 22 candidates and brute force counted 63, both in the same unit of one support computation. These counts do not include the cost of generating candidates, and elapsed time is a different question, taken up in `fp-growth`.

### Example 3: how the threshold moves the work

On the same data:

```text
minsup            1    2    3    4    5    6
frequent itemsets 47   25   18   13   11   6
candidates counted 48  28   22   20   14   12
```

The strict comparison matters too. Using $\sigma(X)>3$ in place of $\sigma(X)\ge3$ returns 13 itemsets, the same result as minsup $=4$. On 10 transactions, a one-unit change in the threshold can remove 5 itemsets. No value is right by itself, since minsup is a choice about what to look at.

### Example 4: a measure that breaks the property

Suppose the goal is itemsets that cover many cells of the table. Define the **area** $a(X)=\lvert X\rvert\cdot\sigma(X)$ and ask for $a(X)\ge10$. This looks like a support threshold, but size appears as a factor:

```text
X       sigma(X)  area
D       8         8
DS      6         12
DKS     5         15
DJKS    3         12
```

Area rises and then falls along this chain, so it is neither anti-monotone nor monotone. Every single item has area at most 8, so a level-wise search would stop at $k=1$ and return nothing. Brute force finds 8 itemsets with area at least 10: DK, DS, JK, JS, KS, DKS, JKS, DJKS. The property does not apply, because it is a statement about $\sigma$ and $a$ is another function: it multiplies $\sigma$ by a size that grows with the set. Apriori's pruning is valid only for a measure that cannot grow when the set grows.

## Common Misconceptions & Pitfalls

- **"Pruning decides what is frequent."** It only removes sets that cannot be. DJP passed the prune and failed the count.
- **"The prune step works at every level."** At $k=2$ it cannot remove anything, as Example 1 shows.
- **"Any interestingness score can use Apriori."** Only an anti-monotone one. Example 4 lost all 8 answers.
- **"`min_support=0.3` means three transactions."** It means 30% of whatever $n$ is. The two coincide only at $n=10$.
- **"Frequent means related."** Support counts co-occurrence. S is in 8 of 10 postings, so it pairs with most things. `association-rules-support-confidence-lift` measures this, and neither lesson's numbers are evidence that one skill causes another.
- **"Apriori makes the problem polynomial."** It removes candidates, but the output can still have $2^m-1$ sets.

## Summary

The support of an itemset is the number of transactions containing it, stated as a count or a fraction, and the comparison here is $\ge$, which must be stated because a strict $>$ changes the result. Support is anti-monotone because a superset is contained in fewer transactions, and that lets Apriori generate level $k$ from level $k-1$, prune candidates with a missing subset, and count only the rest in one pass per level. On the 10-posting dataset, with minsup 3, it counted 22 of 63 candidates across four passes and found 18 frequent itemsets, and brute force and `mlxtend` found the same 18. Pruning did not replace counting (DJP), and the method does not extend to a measure such as area, for which anti-monotonicity fails.

## Documentation Links

- [Han, Pei and Yin (2000), Mining Frequent Patterns without Candidate Generation](https://hanj.cs.illinois.edu/pdf/sigmod00.pdf): the cost of candidate generation, with the numbers quoted above.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 8](https://dataminingbook.info/book_html/chap8/book.html): itemset mining, support, Apriori's prefix-based candidate generation with subset pruning, and the credit to Agrawal and Srikant (1994).
- [Mining of Massive Datasets, frequent itemsets](http://www.mmds.org/mmds/v2.1/ch06-assocrules.pdf): course slides on support, monotonicity, A-Priori passes, and data on disk.
- [mlxtend, apriori](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/apriori/): the function, its input format, and `min_support`.
