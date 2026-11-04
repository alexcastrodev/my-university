---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Turn raw text into a document-term matrix, naming the choice made at each step: tokenization, stop words, stemming.
- Run the Porter stemmer and point to where it conflates unrelated words and where it misses related ones.
- Compute the textbook idf and scikit-learn's smoothed idf with L2 normalization on the same corpus, and explain why the numbers differ.
- Prove that the cosine of L2-normalized vectors equals their dot product, and show what breaks when a hypothesis is missing.
- Fit idf on one set of documents and apply it to new ones without leakage, and handle a document whose vector is zero.

## Context & Motivation

The methods so far in this discipline, from `k-nearest-neighbors` to `outlier-detection-quartiles-distance-based-density-based`, start from rows of numbers. Text does not arrive that way. `similarity-and-distance-measures` covers cosine, and this lesson builds the text vectors it compares.

The construction looks mechanical and is not. Each step is a modeling decision that changes which documents count as similar, and the most famous formula in the area, TF-IDF, has several definitions. In the corpus below, three reasonable pipelines give a different nearest neighbor for the same document. A number quoted as "the TF-IDF" means little until the variant is named.

## Core Theory

### Tokens and stop words

A **token** is a unit the pipeline will count. Tokenization is usually a regular expression, and it has opinions. scikit-learn's default pattern, `(?u)\b\w\w+\b`, keeps runs of two or more word characters, so `a b2 x-ray C++ don't` becomes `['b2', 'ray', 'don']`: the `x` of `x-ray` and the `C` of `C++` are gone.

**Stop words** are very common words removed before counting. Removal is a decision, not a cleanup. The scikit-learn guide warns of "several known issues" in its own `english` list. With that list, "this is good" and "this is not good" both reduce to the single token `good`, so a task that depends on negation loses it.

### Stemming

A **stemmer** chops suffixes by rule. A **lemmatizer** uses a vocabulary and morphology to return the dictionary form. The Porter stemmer (1980), described in Manning, Raghavan and Schütze (IIR) as five phases of word reductions applied in sequence, returns strings that need not be words: `studies` becomes `studi`. NLTK ships three modes, and they disagree on some words. Porter himself recommends against the original 1980 form, per the NLTK documentation, and NLTK's default adds further changes of its own. So a stem table must name the mode.

### Bag of words

After preprocessing, a corpus of $n$ documents over a vocabulary of $m$ terms becomes an $n\times m$ matrix $X$, with $x_{dt}$ the number of times term $t$ occurs in document $d$. The model keeps counts and discards order: "dog bites man" and "man bites dog" get identical vectors and cosine 1. Adding bigrams with `ngram_range=(1, 2)` separates them, and their cosine falls to 0.6, at the price of a larger vocabulary. Most entries of $X$ are zero, which is why these matrices are stored sparse.

### TF-IDF, in the plural

Term frequency alone rewards words that are frequent everywhere. Inverse document frequency scales a term down by how many documents contain it, using $\text{df}(t)$, the number of documents with $t$. The sources differ in the details:

| Source | tf | idf | Length handling |
|---|---|---|---|
| IIR, sections 6.2.1 and 6.2.2 | raw count | $\log(N/\text{df})$, base 10 in its table | none in the weight; cosine divides by the lengths |
| scikit-learn default | raw count | $\ln\frac{1+n}{1+\text{df}}+1$ | L2 norm on each row |
| scikit-learn `smooth_idf=False` | raw count | $\ln\frac{n}{\text{df}}+1$ | L2 norm on each row |
| Leskovec, Rajaraman, Ullman (MMDS), section 1.3.1 | count over the document's maximum count | $\log_2(N/n_i)$ | division by the maximum, inside tf |

The two families behave differently at the extremes. In IIR, a term in every document has idf 0 and vanishes. In scikit-learn, the same term has idf 1 and stays. The scikit-learn guide also calls $\log\frac{n}{1+\text{df}}$ the "standard textbook notation", which is a fifth form and not the one in IIR or MMDS. On a term present in all documents of a four-document corpus it gives $\ln(4/5)=-0.2231$, a negative weight.

The base of the logarithm needs care. In the IIR form, changing base multiplies every weight by one constant, so cosines do not move: base 10 and base 2 give the same values on the corpus below. In the scikit-learn form the added 1 is not scaled, so the base would matter, and the library fixes the natural logarithm.

### Cosine and the dot product

For nonzero vectors, $\cos(u,v)=\dfrac{u\cdot v}{\lVert u\rVert\,\lVert v\rVert}$.

**Property.** If $\lVert u\rVert=\lVert v\rVert=1$, then $\cos(u,v)=u\cdot v$. In general, with $\hat u=u/\lVert u\rVert$ and $\hat v=v/\lVert v\rVert$,

$$\hat u\cdot\hat v=\frac{u\cdot v}{\lVert u\rVert\,\lVert v\rVert}=\cos(u,v),$$

since the dot product is linear in each argument, and $\lVert\hat u\rVert=1$ makes the denominator of $\cos(\hat u,\hat v)$ equal to 1. Scaling a vector by a positive factor leaves its cosine unchanged. Doubling a document, then, changes its counts and not its direction.

Two hypotheses carry this: both vectors are nonzero, and both are unit length. Example 4 shows each one failing. With nonnegative weights the cosine also lies in $[0,1]$, and it is 0 exactly when the documents share no term of positive weight.

## Worked Examples

### Example 1: from sentences to a matrix

Four documents, lowercased, tokenized with `[a-z]+`, with the stop list `the, a, and, of, to, in`, stemmed by NLTK 3.9.1 `PorterStemmer` in its default mode. The corpus is in English because the stemmer is for English:

```text
d1  The cluster stores data and the store holds data logs.
    cluster store data store hold data log
d2  Clustering the stored data reveals customer groups.
    cluster store data reveal custom group
d3  Customers of the store buy data plans.
    custom store buy data plan
d4  The store sells data plans and data drives.
    store sell data plan data drive
```

```text
     buy cluster custom data drive group hold log plan reveal sell store
d1     0       1      0    2     0     0    1   1    0      0    0     2
d2     0       1      1    1     0     1    0   0    0      1    0     1
d3     1       0      1    1     0     0    0   0    1      0    0     1
d4     0       0      0    2     1     0    0   0    1      0    1     1
df     1       2      2    4     1     1    1   1    2      1    1     4
```

The matrix has 21 nonzero entries out of 48. `CountVectorizer(token_pattern="[a-z]+")` on the preprocessed strings returns the same rows. The stemmer already left a mark: `customers` became `custom`, and `stored` (the verb) merged with `store` (the shop).

### Example 2: what Porter conflates and what it misses

A run of NLTK 3.9.1 `PorterStemmer()` in the default mode:

```text
over-conflation (unrelated meanings, one stem)
  university universe universal           -> univers
  organization organ organic              -> organ
  general generous generic generate       -> gener
  experiment experience                   -> experi

under-conflation (related words, different stems)
  ran -> ran       run running runs -> run
  mouse -> mous    mice -> mice
  good -> good     better -> better
  matrix -> matrix    matrices -> matric
  analysis -> analysi  analyses -> analys  analyze -> analyz
  europe -> europ     european -> european
```

The modes differ on a few words, so a result is reproducible only with the mode named:

```text
word     NLTK_EXTENSIONS   MARTIN_EXTENSIONS   ORIGINAL_ALGORITHM
lying    lie               ly                  ly
dying    die               dy                  dy
skies    sky               ski                 ski
news     news              new                 new
fly      fli               fly                 fly
```

### Example 3: the same corpus under each idf

Here $N=4$. The values come from the formulas, and L2-normalized vectors built from the two scikit-learn columns match `TfidfTransformer` to within $1.2\times10^{-16}$:

```text
df   textbook log10(N/df)   sklearn ln((1+n)/(1+df))+1   sklearn ln(n/df)+1
1    0.6021                 1.9163                       2.3863
2    0.3010                 1.5108                       1.6931
4    0                      1                            1
```

Now document $d_1$, with counts cluster 1, data 2, hold 1, log 1, store 2:

```text
term      textbook tf-idf   sklearn raw tf-idf   sklearn after L2
cluster   0.3010            1.5108               0.3599
data      0                 2.0000               0.4764
hold      0.6021            1.9163               0.4564
log       0.6021            1.9163               0.4564
store     0                 2.0000               0.4764
```

The L2 column is the raw column divided by the norm $\sqrt{1.5108^2+2^2+1.9163^2+1.9163^2+2^2}=4.1984$. Under the textbook form, $d_1$ keeps three coordinates. Under scikit-learn it keeps all five, and `data` outweighs `cluster`, because count 2 times idf 1 beats count 1 times idf 1.5108.

### Example 4: the nearest neighbor depends on the variant

Cosines for each pair, with no ties for a nearest neighbor in any row of the second table. "Unstemmed" keeps the lowercasing and the stop list of Example 1, skips the stemmer, and applies the scikit-learn default weighting:

```text
pair     counts   textbook   sklearn   sklearn no-smooth   unstemmed
d1,d2    0.6155   0.1054     0.4012    0.3329              0.1012
d1,d3    0.5394   0          0.2978    0.2314              0.2235
d1,d4    0.6396   0          0.3737    0.2898              0.3146
d2,d3    0.5477   0.1291     0.3589    0.3037              0.0653
d2,d4    0.4330   0          0.2103    0.1563              0.1169
d3,d4    0.6325   0.1361     0.4317    0.3649              0.4268
```

```text
nearest neighbor of   counts   textbook   sklearn   sklearn no-smooth   unstemmed
d1                    d4       d2         d2        d2                  d4
d2                    d1       d3         d1        d1                  d4
d3                    d4       d4         d4        d4                  d4
d4                    d1       d3         d3        d3                  d3
```

Take $d_2$. Under the textbook form, $d_2$ shares only `cluster` with $d_1$ and only `custom` with $d_3$, both of idf 0.3010, so both numerators are $0.0906$. The denominators decide: $0.9031\times0.9519$ against $0.7374\times0.9519$, which gives 0.1054 and 0.1291, so $d_3$ wins because it is the shorter vector. Under scikit-learn the erased terms return. The numerators become $2.2826+2+2=6.2826$ with $d_1$ and $2.2826+1+1=4.2826$ with $d_3$, and $d_1$ wins. Without stemming, `clustering` no longer matches `cluster`, and $d_2$ moves to $d_4$. Neither answer is the right one in general: with four documents, df is a coarse signal, and these flips show how much the choice weighs when evidence is thin.

**Dot product.** On the L2-normalized scikit-learn matrix, `X @ X.T` reproduces the sklearn column exactly, for instance $0.4012$ for $d_1,d_2$. The two hypotheses fail as follows.

- Vectors not normalized: on the raw scikit-learn weights, the dot product of $d_1$ and $d_2$ is $6.2826$, not a cosine. The cosine of $2d_1$ with the original $d_1$ stays 1, while their raw dot product moves from $17.63$ to $35.25$.
- Zero vector: in Example 5, a document has no weight anywhere, its norm is 0, and the cosine is $0/0$. `cosine_similarity` returns 0 there by convention, and that 0 means "undefined", not "unrelated".

### Example 5: new documents

Fit on $d_1,\dots,d_4$, then only transform, passing each new text through the same preprocessing first:

```text
new text               stems             sklearn vector               cosine with d1..d4
quantum entanglement   quantum entangl   zero vector                  0 0 0 0
data store             data store        data 0.7071, store 0.7071    0.6737 0.3792 0.4420 0.5547
```

Both stems of the first text are out of vocabulary, so the vector is zero. Under the textbook idf, "data store" is also a zero vector, since both of its terms have idf 0, while scikit-learn finds $d_1$ as the closest match.

Idf is learned from data, so it belongs to the training side of `training-test-and-validation-splits`. If "data store" joins the fit as a fifth document, $\text{idf}(\text{cluster})$ moves from 1.5108 to 1.6931, and the vectors of the original documents change because of a document that should be unseen. In an exploratory study with no held-out set there is no leak to speak of, and fitting on every document is a legitimate choice, as long as it is stated.

## Common Misconceptions & Pitfalls

- **"TF-IDF is one formula."** Example 3 shows three sets of idf values on one corpus, and Example 4 shows them disagreeing about a nearest neighbor. Name the variant.
- **"Normalization is part of TF-IDF."** It is a separate step that scikit-learn turns on by default. With `norm=None`, the dot product is no longer a cosine.
- **"A dot product of TF-IDF vectors is a cosine."** Only after L2 normalization, and only for nonzero vectors.
- **"Cosine 0 means the documents are unrelated."** It means no shared term of positive weight. Under the textbook idf, $d_1$ and $d_3$ have cosine 0, and they share `data` and `store`.
- **"A stem is a root word."** `univers` joins three meanings and `matric` is not a word. Inspect the stems of terms that matter to the task.
- **"Removing stop words is always safe."** It removed the negation in "this is not good".
- **"Fit the vectorizer on everything, it is only counting."** It learns the vocabulary and the idf. Fit on training documents.

## Summary

Text becomes numbers through a chain of choices: a token pattern, a stop list, a stemmer in a named mode, and a weighting. The Porter stemmer merges `university` and `universe`, and it leaves `ran` apart from `run`. Bag of words discards order. On a four-document corpus, the idf of a term in every document is 0 in the IIR form and 1 in scikit-learn, and that difference changed the nearest neighbor of $d_2$. L2 normalization makes the dot product equal the cosine, provided the vector is nonzero, and an out-of-vocabulary document is the common way to get a zero vector. Idf is fit on training documents and only applied to new ones. `a-text-clustering-pipeline-end-to-end` takes these vectors into a full clustering run.

## Documentation Links

- [IIR 6.2.1, Inverse document frequency (archived copy)](https://web.archive.org/web/20250124112038/https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html): the definition of df and idf, and the note on the logarithm base.
- [IIR 6.2.2, Tf-idf weighting (archived copy)](https://web.archive.org/web/20250312161632/https://nlp.stanford.edu/IR-book/html/htmledition/tf-idf-weighting-1.html): the tf-idf weight as a product.
- [IIR 6.3.1, Dot products (archived copy)](https://web.archive.org/web/20250306122857/https://nlp.stanford.edu/IR-book/html/htmledition/dot-products-1.html): cosine similarity and length normalization.
- [IIR 2.2.4, Stemming and lemmatization (archived copy)](https://web.archive.org/web/20241229085036/https://nlp.stanford.edu/IR-book/html/htmledition/stemming-and-lemmatization-1.html): the difference between the two, and the phases of Porter's algorithm.
- [Mining of Massive Datasets, chapter 1 (archived copy)](https://web.archive.org/web/20240314014513/http://infolab.stanford.edu/~ullman/mmds/ch1n.pdf): the TF.IDF variant with a max-normalized tf and a base 2 logarithm.
- [scikit-learn, Feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html): token patterns, stop-word warnings, and the exact tf-idf formulas with a numeric example.
- [scikit-learn, TfidfTransformer](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfTransformer.html): the parameters `norm`, `smooth_idf`, and `use_idf`.
- [NLTK, nltk.stem.porter](https://www.nltk.org/api/nltk.stem.porter.html): the three stemmer modes and what each one contains.
- [The Porter Stemming Algorithm](https://tartarus.org/martin/PorterStemmer/): Martin Porter's page for the algorithm and its implementations.
