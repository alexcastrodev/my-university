---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Assemble TF-IDF, truncated SVD, normalization, and k-means into one scikit-learn `Pipeline`, and reproduce its output from a seeded corpus.
- State why `TruncatedSVD` on TF-IDF differs from the PCA of `principal-component-analysis`, and measure the difference.
- Report the adjusted Rand index against known labels, check it by hand from the contingency table, and read the top terms of each cluster.
- Say what a good score does not prove, using a corpus with no topics at all as the control.

## Context & Motivation

`text-mining-bag-of-words-and-tf-idf` produced document vectors, `k-means-clustering` groups vectors, and `cluster-validation` scores groupings. This lesson joins them on a corpus the reader can regenerate exactly, because a clustering result that cannot be rerun cannot be questioned.

The labels below exist only because the corpus is synthetic: they let the run be graded. Real text clustering is exploratory and has no such labels, so the second half of this lesson asks what a run like this would and would not establish.

## Core Theory

### The four steps, and why in this order

1. **TF-IDF** turns documents into sparse, L2-normalized rows, in scikit-learn's default variant.
2. **Truncated SVD** projects them onto $c$ directions.
3. **Normalizer** rescales each projected row to unit length.
4. **k-means** clusters the rows.

Step 3 exists because of this identity: for unit vectors,

$$\lVert u-v\rVert^2=\lVert u\rVert^2+\lVert v\rVert^2-2\,u\cdot v=2-2\cos(u,v),$$

so Euclidean distance between unit vectors is a function of cosine alone. The hypothesis is unit length, and the projection destroys it: TF-IDF rows have norm 1, and in the run below the projected rows range from 0.443 to 0.922. Normalizing restores the identity between documents. It does not hold exactly against the centroids, which are means of unit vectors and had norms from 0.756 to 0.798 here, so this is close to clustering by cosine and is not spherical k-means.

### What truncated SVD computes, and what it does not

Write $X=U\Sigma V^T$. Keeping the top $c$ singular values gives $X_c=U_c\Sigma_cV_c^T$, and by the Eckart-Young theorem $X_c$ has the lowest Frobenius error among matrices of rank at most $c$. Each document's new coordinates are the row of $U_c\Sigma_c$.

**TruncatedSVD on TF-IDF does not center the data.** PCA, as `principal-component-analysis` defines it, takes eigenvectors of the covariance matrix, and covariance is measured around the mean. So PCA is the SVD of $X-\bar x$, where $\bar x$ is the mean row, while `TruncatedSVD` is the SVD of $X$ itself. The scikit-learn reference says: "Contrary to PCA, this estimator does not center the data before computing the singular value decomposition." The reason is sparsity. Subtracting $\bar x$ explicitly writes a nonzero value into every zero entry, which would make the matrix dense. Some solvers avoid that by centering implicitly, as `PCA` with `svd_solver="arpack"` does on sparse input, while `TruncatedSVD` skips centering altogether.

Skipping the mean has a visible consequence. The total energy splits as

$$\lVert X\rVert_F^2=n\lVert\bar x\rVert^2+\lVert X-\bar x\rVert_F^2,$$

and $\bar x$ is not small when every entry of $X$ is nonnegative. By Perron-Frobenius applied to $X^TX$, the top right singular vector of a nonnegative matrix can be chosen with all entries nonnegative, so it has no opposite signs with which to contrast topics. It tends to spend itself on the mean direction, and Example 4 measures how closely.

### Everything learned goes inside one Pipeline

Vocabulary, idf, the singular vectors, and the centroids are all learned from data. In one `Pipeline`, `pipe.fit(train)` learns them from training documents and `pipe.predict(test)` only applies them. Fitting the vectorizer before splitting would leak test df into the training vectors. For a purely exploratory clustering of one fixed corpus there is no test set, and fitting on everything is normal, as long as the report says so.

## Worked Examples

### Example 1: the full run

This script is complete. It ran on Python 3.13.5 with scikit-learn 1.9.1 and NumPy 2.5.4. Each topic has its word list, some words are shared on purpose (`bank`, `trade`, `fish`, `rain`, `season`), and each token comes from the topic with probability 0.35, otherwise from a common list:

```python
import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import Normalizer

TOPICS = {
    "finance": "bank loan credit rate market stock bond fund price trade".split(),
    "rivers":  "bank river water flood stream fish boat rain delta trade".split(),
    "sports":  "match team goal coach league score player season fan trade".split(),
    "cooking": "recipe oven flour butter salt sauce pan rain season fish".split(),
}
COMMON = "report new year people time local day week city group".split()

def make_corpus(n_per_topic=100, seed=42, p_topic=0.35):
    rng = np.random.default_rng(seed)
    docs, labels = [], []
    for label, words in enumerate(TOPICS.values()):
        for _ in range(n_per_topic):
            n = rng.integers(6, 15)
            picks = [rng.choice(words) if rng.random() < p_topic else rng.choice(COMMON)
                     for _ in range(n)]
            docs.append(" ".join(picks))
            labels.append(label)
    return docs, np.array(labels)

docs, y = make_corpus()
train, test, y_train, y_test = train_test_split(
    docs, y, test_size=0.25, stratify=y, random_state=0)

pipe = Pipeline([
    ("tfidf", TfidfVectorizer()),
    ("svd", TruncatedSVD(n_components=10, random_state=0)),
    ("norm", Normalizer(copy=False)),
    ("km", KMeans(n_clusters=4, n_init=10, random_state=0)),
])
pipe.fit(train)
pred = pipe.named_steps["km"].labels_

print("first doc:", docs[0])
print("ARI train:", round(adjusted_rand_score(y_train, pred), 3))
print("ARI test: ", round(adjusted_rand_score(y_test, pipe.predict(test)), 3))

terms = pipe.named_steps["tfidf"].get_feature_names_out()
centers = pipe.named_steps["svd"].inverse_transform(pipe.named_steps["km"].cluster_centers_)
for c, row in enumerate(centers):
    top = terms[np.argsort(row)[::-1][:6]]
    print(f"cluster {c} size {(pred == c).sum()}:", " ".join(top))
for c, row in enumerate(centers - centers.mean(axis=0)):
    top = terms[np.argsort(row)[::-1][:6]]
    print(f"cluster {c} minus mean:", " ".join(top))
```

```text
first doc: week report bond week week price
ARI train: 0.886
ARI test:  0.87
cluster 0 size 70: credit new week bond time price
cluster 1 size 85: new flood local trade year people
cluster 2 size 70: week group coach day match city
cluster 3 size 75: salt year flour report new city
cluster 0 minus mean: credit bond price loan stock market
cluster 1 minus mean: flood water delta stream fish boat
cluster 2 minus mean: coach match team fan score player
cluster 3 minus mean: salt flour sauce pan butter oven
```

If the first line differs on another machine, the corpus differs too. NumPy promises the same stream for the same seed only on the same build and machine, so another version may change the digits below.

### Example 2: the ARI, by hand

The training contingency table, topics in rows and clusters in columns (300 documents):

```text
          c0   c1   c2   c3
finance   69    6    0    0
rivers     1   74    0    0
sports     0    4   70    1
cooking    0    1    0   74
```

In the pair-counting form of `cluster-validation`, $\text{Index}=\sum_{ij}\binom{n_{ij}}{2}=10184$, $A=\sum_i\binom{a_i}{2}=11100$, $B=\sum_j\binom{b_j}{2}=11175$, $\binom{300}{2}=44850$, and $\mathbb E[\text{Index}]=AB/44850=2765.72$. Then

$$\mathrm{ARI}=\frac{10184-2765.72}{\tfrac12(11100+11175)-2765.72}=0.886,$$

which matches `adjusted_rand_score`. The held-out documents (25 per topic) give 0.870 with the same formula. Most errors flow into cluster 1, the rivers cluster, which has 85 documents for 75 true ones. The word lists fit this only in part: rivers shares `bank` and `trade` with finance (6 documents moved), `trade` with sports (4), and `fish` and `rain` with cooking (1). Shared words alone do not explain the counts.

### Example 3: reading the top terms

The raw centroids in the output are hard to read: `new`, `week`, `city`, and other common words crowd the lists. Back-projection through $V_c$ returns a centroid in term space, and because nothing was centered, that centroid still contains the corpus mean. Common words are 63.8% of the 3973 tokens of the corpus, so they rank high in every centroid.

Subtracting the mean of the four centroids leaves what separates the clusters. The four lists then read as finance, rivers, sports, and cooking, and each of their top six terms comes from the matching word list. This is a reading aid and does not change the clusters.

### Example 4: truncated SVD against PCA, on this matrix

Training matrix: 300 documents, 44 terms, 2340 nonzero entries (density 0.177).

```text
top right singular vector, sign fixed         0 negative entries of 44
cosine(SVD1, mean row)                        0.9983
SVD1 share of ||X||_F^2 (sigma_1^2 / total)   0.2258
n ||mean||^2 share of ||X||_F^2               0.2148
cosine(PCA1, SVD1)                            0.0307
cosine(PCA1, SVD2)                            0.9991
cosine(PCA2, SVD3)                            0.9969
nonzero entries after centering               13200 of 13200
```

The first SVD axis is the mean direction, in effect, and PCA's first axis matches the second SVD axis. So $c=10$ here buys about nine directions of between-document contrast.

One check confirms that centering is the difference that matters. `TruncatedSVD` with `algorithm="arpack"` run on the centered dense matrix returns the singular values of `PCA`: 3.970334, 3.886058, 3.520336, 3.227739 in both.

### Example 5: which steps earned their place

Test ARI on seed 42, then the mean over corpus seeds 0 to 9, with the same split and the same k-means settings:

```text
pipeline                   seed 42   mean of seeds 0-9
counts                     0.018     0.005
counts + L2                0.058     0.000
TF-IDF, norm=None          0.735     0.795
TF-IDF, L2                 0.864     0.897
TF-IDF, SVD 10             0.771     0.905
TF-IDF, SVD 10, L2         0.870     0.905
```

Idf is the step that matters: without it the common tokens dominate, and normalizing counts does not help. Normalizer looks worth 0.10 on seed 42 and worth nothing on average, which is a warning about reading one seed. SVD adds about 0.01 to the mean here, and a 44-term vocabulary gives it little to compress, so this run does not show its value on real vocabularies. For the full pipeline, across those ten corpora, training ARI ran from 0.854 to 0.965 and test ARI from 0.819 to 0.947. On corpus 42, ten `random_state` values (0 to 9) for SVD and k-means gave a training ARI of 0.886 or 0.887 and a test ARI of 0.870 every time.

The number of components matters up to a point. Test ARI by $c$ on seed 42: 0.316 for 2, 0.613 for 3, 0.794 for 5, 0.870 for 10, 0.815 for 20. The ten-seed means are 0.329, 0.700, 0.867, 0.905, 0.899, so the drop at 20 belongs to this one split, and from about $c=8$ the curve is flat. With $c=2$, one axis is the mean, so four topics have one contrast axis to share. Picking $c$ from this row uses labels and the test set, which `training-test-and-validation-splits` forbids, and $c=10$ is this row's maximum. The fairer estimate of the method is the ten-seed mean of 0.905, since those corpora played no part in choosing $c$.

The score also depends on how the corpus was set. With `p_topic` at 0.25, 0.35, and 0.50, seed 42 gives test ARI 0.524, 0.870, and 0.947. The ARI measures the difficulty of the generator as much as the pipeline.

### Example 6: a corpus with no topics

Pool all topic words into one list and regenerate, so every document comes from the same distribution:

```python
pooled = sum(TOPICS.values(), [])
TOPICS.clear()
TOPICS["all"] = pooled
noise, _ = make_corpus(n_per_topic=400)
```

The same pipeline, on the 300 training documents of the topic corpus and on the 400 noise documents, with silhouette measured in the reduced normalized space (`pipe[:-1].transform`) and in the TF-IDF space:

```text
corpus   c    silhouette, reduced   silhouette, TF-IDF   ARI vs topics
topics   2    0.556                 0.032                0.324
noise    2    0.540                 0.007                no labels
topics   10   0.222                 0.085                0.886
noise    10   0.096                 0.032                no labels
```

Noise at $c=2$ scores 0.540, more than twice the 0.222 of the pipeline that recovered the topics. The cause is the pipeline itself. Normalizing two-dimensional rows puts every point on a circle, and because the mean axis takes one dimension, all noise documents land on an arc of 98 degrees, which k-means slices neatly. Silhouette then measures the geometry that the pipeline created. In the TF-IDF space the same labels score 0.007.

Noise clusters also come with stories. At $c=2$, subtracting the mean gives lists like `group city bond time week market` and `local day rain fan year new`, and a hopeful reader could name them.

What separates the two corpora is the control, not the score. At $c=10$, silhouette on the topic corpus peaks at $k=4$ (0.222, against 0.183 at $k=3$ and 0.201 at $k=5$), while on noise it drifts from 0.091 at $k=2$ to 0.112 at $k=8$ with no peak. Running the same pipeline on a corpus with the structure removed is a cheap test.

**What this result would not prove.**

- That the method works on real text. The topics were planted, and an ARI of 0.886 says the pipeline recovers them at this mix of words.
- That the four clusters are the truth about a corpus. ARI measures agreement with one partition, and other valid partitions exist.
- That $k=4$ would be found unaided. It was given here, from the generator.
- That a cluster explains anything. Top terms describe co-occurrence, with no causal reading.
- That 0.870 is the expected score. It is one split of one corpus.

## Common Misconceptions & Pitfalls

- **"TruncatedSVD on TF-IDF is PCA."** It does not center. In Example 4 its first axis was the mean direction, with cosine 0.9983, and PCA's first axis was its second.
- **"Top terms of a centroid are what the cluster is about."** Raw centroids repeat the corpus mean. Compare with the other centroids.
- **"A high silhouette means real clusters."** Noise scored 0.540 at $c=2$. Compute it against a control, and in the original space as well.
- **"A low silhouette means no structure."** The pipeline with ARI 0.886 scored 0.222.

## Summary

One `Pipeline` fits TF-IDF, `TruncatedSVD`, `Normalizer`, and `KMeans` on training documents. On a seeded corpus of 400 documents and four planted topics it reached ARI 0.886 on training and 0.870 on held-out documents, with a ten-seed mean test ARI of 0.905. `TruncatedSVD` does not center, so its first axis lay on the mean direction (cosine 0.9983) and PCA's first axis matched its second (0.9991). Subtracting the mean of the centroids reveals the topics. Idf did most of the work here. On topic-free text the same pipeline reached silhouette 0.540 at $c=2$ with term lists that read like topics, which is why a control corpus belongs in a report of this kind.

## Documentation Links

- [scikit-learn, TruncatedSVD](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.TruncatedSVD.html): the estimator, the note on not centering, and its two solvers.
- [scikit-learn, PCA](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.PCA.html): the centered counterpart used for comparison, with the solvers that accept sparse input.
- [scikit-learn, Clustering text documents using k-means](https://scikit-learn.org/stable/auto_examples/text/plot_document_clustering.html): the library's own LSA and k-means pipeline on a public dataset.
- [scikit-learn, Pipeline](https://scikit-learn.org/stable/modules/generated/sklearn.pipeline.Pipeline.html): chaining transformers and a final estimator so that all are fit together.
- [scikit-learn, adjusted_rand_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.adjusted_rand_score.html): the metric checked by hand in Example 2.
- [IIR 18.3, Low-rank approximations (archived copy)](https://web.archive.org/web/20250320044806/https://nlp.stanford.edu/IR-book/html/htmledition/low-rank-approximations-1.html): the Eckart-Young theorem in the SVD setting.
- [NumPy, Compatibility policy for random](https://numpy.org/doc/stable/reference/random/compatibility.html): the conditions under which a seed reproduces a stream.
