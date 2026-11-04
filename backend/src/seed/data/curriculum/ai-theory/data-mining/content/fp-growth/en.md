---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Build an FP-tree and its header table by hand from one fixed item order with a stated tie break.
- Mine the tree through conditional pattern bases and explain why each frequent itemset is found exactly once.
- Show on a small dataset that FP-Growth, Apriori, brute force, and `mlxtend` return the same set.
- State what bounds the size of the tree and what does not, and say when the tree stops compressing.
- Separate algorithm from implementation in a timing comparison.

## Context & Motivation

`frequent-itemsets-and-the-apriori-algorithm` left two costs in Apriori: one pass over the data per level, and a candidate set that can be large long before the output is. FP-Growth (Han, Pei and Yin, 2000) removes candidate generation. It scans the data twice to build a prefix tree, then grows patterns by recursion on that tree. This lesson uses that lesson's 10 job postings, minsup 3, and its notation $\sigma$ for support counts. The mining is exploratory, with no training or test split.

## Core Theory

### The FP-tree

An **FP-tree** has a null root, and each other node stores an item, a count, and a **node-link** to the next node with the same item. The **header table** has one entry per frequent item, pointing to the first node of that item's linked list. Construction takes two scans:

1. Scan once, count the items, drop the infrequent ones, and fix a global order.
2. Scan again. Sort each transaction's frequent items by that order and insert the sorted list from the root. Shared prefixes reuse nodes and add to their counts, and a new suffix creates new nodes.

A node's count is the number of transactions whose sorted list passes through it.

### The order, and its tie break

The paper orders items by descending support and lists ties in its example without a stated rule. This lesson fixes the rule: **descending $\sigma$, ties broken alphabetically**. The rule has to be explicit because a different tie break gives a different tree. Correctness needs one order per tree: every path of a tree, conditional trees included, follows the same order. A conditional tree may use its own order, as the Variant below shows, provided the recursion takes that tree's items from its bottom up.

The descending order is a heuristic for sharing, since frequent items near the root are more likely to fall on common prefixes. It is not a guarantee of the smallest tree. For transactions `abc`, `bc`, `a`, `acd`, `cd`, `acd` with minsup 1, the support order c, a, d, b gives 7 nodes, while c, d, b, a gives 6.

### Size of the tree

**Lemma 2.2 of the paper.** Not counting the root, the number of nodes is at most the total occurrences of frequent items in the database, and the height is at most the largest number of frequent items in one transaction.

Each transaction adds at most one node per frequent item, which gives both bounds. So the tree is never exponential in the data, and in that narrow sense it is safe. The bound counts nodes, not bytes, and a node is much larger than an entry in a transaction list. It also says nothing about the recursion that follows.

### Mining: conditional pattern bases

Take the items from the bottom of the order up. For an item $i$:

1. Follow its node-links. For each node, the path from the root down to its parent, with the node's count, is one entry of the **conditional pattern base** of $i$.
2. Count items in the base, with those counts as weights, and keep the ones reaching minsup. Build a **conditional FP-tree** from them.
3. Report $\{i\}$ with its support, then recurse on the conditional tree, with $i$ attached to everything found.

**Fragment growth (Lemma 3.1).** If $\alpha$ is an itemset and $B$ its conditional pattern base, and $\beta$ is an itemset in $B$, then $\sigma_D(\alpha\cup\beta)=\sigma_B(\beta)$. This follows because $B$ collects exactly the occurrences of $\alpha$ with the items above it. Consequently $\alpha\cup\beta$ is frequent in $D$ exactly when $\beta$ is frequent in $B$.

With one global order, each frequent itemset is reported once: its last item in that order selects the first recursion branch, and the next-to-last the second, and so on. The paper also has a shortcut that enumerates a single-path tree directly (Lemma 3.2). The trace below does not use it, so every step appears.

Nothing is generated and tested, but the work has moved rather than vanished: if $2^m-1$ itemsets are frequent, the recursion still has to report them all.

**Variant.** This lesson keeps the global order inside conditional trees. `mlxtend` re-ranks each conditional tree by its local counts. The trees differ and the mined set does not.

## Worked Examples

### Example 1: building the tree

The item counts are D 8, S 8, K 7, J 6, P 4, and G 1. G is dropped. D and S tie, and the alphabetical rule puts D first, so the order is **D, S, K, J, P**. Sorted lists:

```text
T1  D S K J      T6   D S K
T2  D S K J P    T7   D P
T3  D S K J      T8   D S
T4  D J P        T9   S K J P
T5  D S K        T10  S K J
```

Inserting these in order gives the tree and header table:

```text
root
|-- D:8
|   |-- S:6
|   |   `-- K:5
|   |       `-- J:3
|   |           `-- P:1
|   |-- J:1
|   |   `-- P:1
|   `-- P:1
`-- S:2
    `-- K:2
        `-- J:2
            `-- P:1

item  support  node-link chain (node counts)
D     8        8
S     8        6, 2
K     7        5, 2
J     6        3, 1, 2
P     4        1, 1, 1, 1
```

The counts along each chain sum to the item's support, which is a quick check. There are 12 nodes for 33 occurrences of frequent items, a ratio of 2.75.

The tie break changes the tree. With S before D, the root has `S:8` and `D:2` as children, still with 12 nodes on this data. The ascending order P, J, K, D, S gives 18 nodes. Over all 120 orders of the five items, node counts run from 12 to 18, and the support-descending orders reach the minimum here. As the abc example shows, that outcome is not guaranteed.

### Example 2: mining the tree

Bottom-up, with minsup 3:

```text
suffix  sigma  conditional pattern base          items kept     found next
P       4      DSKJ:1  DJ:1  D:1  SKJ:1          D:3 J:3        JP, DP
JP      3      D:2                               none (D:2)     nothing
DP      3      empty                                            nothing
J       6      DSK:3  D:1  SK:2                  D:4 S:5 K:5    JK, JS, DJ
JK      5      DS:3  S:2                         D:3 S:5        JKS, DJK
JKS     5      D:3                               D:3            DJKS
DJKS    3      empty                                            nothing
DJK     3      empty                                            nothing
JS      5      D:3                               D:3            DJS
DJS     3      empty                                            nothing
DJ      4      empty                                            nothing
K       7      DS:5  S:2                         D:5 S:7        KS, DK
KS      7      D:5                               D:5            DKS
DKS     5      empty                                            nothing
DK      5      empty                                            nothing
S       8      D:6                               D:6            DS
DS      6      empty                                            nothing
D       8      empty                                            nothing
```

Each of the 18 rows reports one itemset. Row JP is where Apriori's DJP shows up: in the base of JP, D has count 2, so DJP stops there. Apriori generated that candidate and counted it in a pass, whereas here it is a sum over one short list. The first row also shows `P`'s base holds K:2 and S:2, which fall below 3. These are the infrequent KP and PS from the Apriori run.

### Example 3: the same set

FP-Growth above, Apriori, a brute-force scan of the 63 subsets, and `mlxtend.frequent_patterns.fpgrowth(df, min_support=0.3)` from version 0.25.0 all return the same 18 itemsets with the same counts. On these data `mlxtend` ranks S above D, so it breaks the tie the other way and builds a different tree with the same output. A tie break affects the tree and never the answer.

### Example 4: timing on named datasets

Four files from the FIMI repository, unfiltered: `chess` (3,196 transactions, 75 items, 37 per transaction), `connect` (67,557, 129, 43), `mushroom` (8,124, 119, 23), and `T10I4D100K` (100,000, 870, about 10). Both functions come from `mlxtend` 0.25.0, on Python 3.13.5 and NumPy 2.5.4 on an Apple M1 Pro, with a dense boolean DataFrame. Each entry is the median of 3 fresh processes, excluding load time. Each row returned identical itemsets from both functions. The last two columns are counts, independent of machine and library: "counted" is Apriori's candidates with supports computed, and "ratio" is defined in Example 5.

```text
dataset      minsup  itemsets  apriori s  fpgrowth s  counted  ratio
chess        0.90    622       0.009      0.018       747      245
chess        0.85    2669      0.024      0.028       2892     141
chess        0.80    8227      0.088      0.054       8632     79
chess        0.75    20993     0.273      0.109       21736    35
connect      0.95    2201      0.194      0.370       2453     8053
connect      0.90    27127     3.179      0.490       27522    6142
mushroom     0.30    2735      0.041      0.053       3150     68
T10I4D100K   0.02    155       2.123      0.810       12805    2.11
T10I4D100K   0.01    385       17.130     1.614       70996    1.55
T10I4D100K   0.005   1073      40.193     2.107       162690   1.45
```

Apriori won 4 of the 10 rows, all on dense files with under 3,000 itemsets, where candidates are few, although the `chess` margins are only milliseconds. FP-Growth won the rest, by 19 times at the last row, and its lead grew as support fell on `chess` and `T10I4D100K`. The result is about these implementations too: `mlxtend`'s Apriori generates candidates in pure Python and counts them with NumPy column arithmetic, and its `fpgrowth` is a pure Python tree, so another pair of implementations would shift these numbers. The paper reported FP-Growth about an order of magnitude faster than Apriori on large databases, using its synthetic sets T25:I10:D10K and T25:I20:D100K and its own C++ code on a 450 MHz Pentium PC. That is a different measurement from this table, and the two should not be read as one result.

### Example 5: when the tree stops compressing

Define the **ratio** as occurrences of frequent items divided by tree nodes, using the order of Example 1 with ties broken by item id. The last column reverses that order.

```text
dataset      minsup  occurrences  nodes    ratio    nodes, ascending order
connect      0.50    2219609      5715     388.38   49471
chess        0.75    66700        1898     35.14    4748
retail       0.01    236563       31035    7.62     56531
retail       0.005   327499       106286   3.08     173049
T10I4D100K   0.02    482909       229245   2.11     246108
T10I4D100K   0.005   936679       646062   1.45     702753
```

`retail` is the FIMI file with 88,162 transactions and 16,470 items, not timed above. The paper gives Connect-4 at 50% as a showcase, with 2,219,609 occurrences and 13,449 nodes, a ratio of 165.04. The FIMI `connect` file, with the same 67,557 transactions, gives the same occurrence count but 5,715 nodes in a support-descending tree. No ties occur among its 38 frequent items, and a direct count of distinct prefixes confirms that number. The cause of the gap is not known, since the paper gives no code, and with no ties the order here is forced. Both results show compression by two orders of magnitude.

The tree stops compressing when transactions share few prefixes: many items, short transactions, and a low threshold. The authors note it themselves: "for databases with mostly short transactions, the reduction ratio is not that high." On `T10I4D100K` at 0.005 there are 69 nodes for every 100 occurrences. A node holds at least an item, a count, a node-link, and a parent pointer, against one integer for an occurrence in a flat list, so, as an inference from those fields rather than a result of the paper, a ratio below about 4 means the tree uses more memory than the list it replaces.

Compression and speed are separate questions. `chess` at 0.90 has ratio 245 and Apriori won, while `T10I4D100K` at 0.005 has ratio 1.45 and FP-Growth won by 19 times. The two tally nearly the same pairs: 160,648 of the 161,596 frequent-item pairs co-occur at least once, and the first level of FP-Growth's recursion keeps a count for exactly those. As an inference from these counts, the difference is the cost of a tally: a pair of 100,000-row columns for Apriori, against 4.1 million increments in total along the tree's paths. Memory is part of that number too. `mlxtend` evaluates all 161,596 pairs in one `np.all(X[:, combin], axis=2)`, about 32 GB of boolean data on the 16 GB M1 Pro. At minsup 0.02 the same expression needs 2.4 GB by that count, and the process peaked at 2.7 GB. So the 17 s and 40 s rows include memory pressure, and the 19 times is specific to this run. If the tree does not fit in memory, the paper's own answer is to partition the database, and `mining-at-scale-from-mapreduce-to-spark` picks this up.

## Common Misconceptions & Pitfalls

- **"FP-Growth always beats Apriori."** It lost 4 of 10 rows in Example 4, with these implementations.
- **"The tree is always small."** At `T10I4D100K` 0.005 it has 646,062 nodes for 936,679 occurrences.
- **"Good compression means FP-Growth will be faster."** Example 5 shows the opposite pairing.
- **"Ties in the order can be ignored."** They change the tree, and a worked trace with no rule cannot be reproduced. They do not change the mined set.
- **"No candidates means polynomial time."** The output can have $2^m-1$ itemsets, and the recursion must report each one.

## Summary

FP-Growth stores the frequent part of each transaction in a prefix tree built in two scans, using one fixed item order, here descending support with alphabetical ties. It then mines bottom-up through conditional pattern bases, relying on the fact that the support of $\alpha\cup\beta$ in the database equals the support of $\beta$ in the base of $\alpha$. On the running data it found the same 18 itemsets as Apriori, brute force, and `mlxtend`, from a 12-node tree. Tree size is bounded by the occurrences of frequent items, and sparse data get nearer to that bound: 69% of it on `T10I4D100K` at 0.005, against about 0.26% on `connect` at 0.50, with thresholds that differ. Timings on named datasets split both ways, and compression did not predict the winner, so the comparison has to be measured on the data and the implementation at hand.

## Documentation Links

- [Han, Pei and Yin (2000), Mining Frequent Patterns without Candidate Generation](https://hanj.cs.illinois.edu/pdf/sigmod00.pdf): FP-tree definition, lemmas, FP-growth, the Connect-4 figures, and the performance study.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 8](https://dataminingbook.info/book_html/chap8/book.html): FP-tree construction and the FPGrowth projection method.
- [mlxtend, fpgrowth](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/fpgrowth/): the function used in Examples 3 and 4.
- [mlxtend, apriori](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/apriori/): the function compared in Example 4.
- [Frequent Itemset Mining Dataset Repository](https://fimi.uantwerpen.be/data/): the `chess`, `connect`, `mushroom`, `retail`, and `T10I4D100K` files.
