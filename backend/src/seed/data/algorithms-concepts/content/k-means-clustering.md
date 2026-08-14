---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Understand the k-means clustering problem and Lloyd's procedure for solving it: given a set S of n points in R^d and a target number of clusters k, find k center points that minimize the sum of squared distances from each point to its nearest center. This is a new topic for the platform in more than one sense — it comes from Chapter 33, "Machine-Learning Algorithms," which CLRS added entirely in its 4th edition, and it's the platform's first foray into ML-adjacent algorithmic content. The technical core stays strictly algorithmic, though: k-means itself is NP-hard, so Lloyd's procedure is a local-search heuristic — it iterates "assign points to nearest center, then recompute centers as centroids" until nothing changes, and it provably terminates and never increases the objective, but it only guarantees a local minimum, not the global one.

## Use Cases

- Grouping data points by similarity as a preprocessing step to discover structure — CLRS's own examples are clustering celestial stars by temperature/size/spectral characteristics, and clustering fragments of recorded speech to reveal the set of accents present.
- Vector quantization for lossy compression: reducing the number of distinct colors needed to represent a photograph so it can be encoded with far fewer bits per pixel.
- Any setting where you have n examples with the same set of attributes and want to partition them into k disjoint groups of mutually similar examples, with no polynomial-time exact algorithm required (a locally-optimal clustering is acceptable).

## Deep Dive

### Feature vectors and the dissimilarity measure

Each of the n examples is represented as a d-dimensional feature vector x = (x1, x2, ..., xd), a point in R^d. Rather than defining similarity directly, CLRS defines its opposite — the dissimilarity δ(x, y) between two points, taken as the squared Euclidean distance:

```java
// δ(x, y) = ||x - y||^2 = sum over a=1..d of (x[a] - y[a])^2
static double dissimilarity(double[] x, double[] y) {
    double sum = 0.0;
    for (int a = 0; a < x.length; a++) {
        double diff = x[a] - y[a];
        sum += diff * diff;
    }
    return sum;
}
```

The choice of squared Euclidean distance (equation 33.1) is not required — it is a conventional, mathematically convenient choice, and other dissimilarity measures (like plain, non-squared distance) are possible. Before clustering, attribute values are usually scaled or normalized so no single attribute dominates the others — for example, a linear transform mapping the minimum value of an attribute to 0 and the maximum to 1, or scaling so each attribute has mean 0 and unit variance. This matters because raw attribute scales can differ wildly: CLRS's own example is latitude (ranging -90 to +90) versus longitude (ranging -180 to +180), a factor-of-2 difference, and it notes that attributes like grade-point average versus family income could differ far more.

### The k-means objective, and why it's only solvable to a local optimum

A k-clustering of S is a decomposition into k disjoint subsets (clusters) ⟨S(1), S(2), ..., S(k)⟩, defined by a sequence of k centers C = ⟨c(1), ..., c(k)⟩ via the *nearest-center rule*: a point x belongs to cluster S(ℓ) only if δ(x, c(ℓ)) is the minimum dissimilarity to any of the k centers (ties broken arbitrarily, but never reassigning a point unless its new center is *strictly* closer than its old one). The k-means problem asks for the sequence of centers C that minimizes

```
f(S, C) = sum over x in S of min{ δ(x, c(j)) : 1 <= j <= k }
        = sum over l=1..k, sum over x in S(l) of δ(x, c(l))          (equation 33.2)
```

Is there a polynomial-time algorithm for k-means? Probably not — the problem is NP-hard. So instead of the global minimum, Lloyd's procedure finds a *local* minimum, characterized by two necessary (but not sufficient) properties:

- **Optimal center for a given cluster (Theorem 33.1).** For a fixed nonempty cluster S(ℓ), the unique center c(ℓ) minimizing the sum of squared distances of its points is the *centroid* (mean) of the cluster — for each attribute a, c(ℓ)_a = (1 / |S(ℓ)|) * sum over x in S(ℓ) of x_a. The proof differentiates the convex quadratic in c(ℓ)_a and sets it to zero, which lands exactly on the average.
- **Optimal clusters for given centers (Theorem 33.2).** Given a fixed sequence of k centers, the clustering that minimizes the objective is exactly the one produced by the nearest-center rule — assigning each point to the cluster whose center is nearest to it. The proof is immediate: each point contributes to the sum exactly once, through whichever cluster it's assigned to, so assigning it to its nearest center minimizes its own contribution.

### Lloyd's procedure: alternate the two optimal steps until nothing changes

Lloyd's procedure just iterates the two operations above — assign points to clusters via the nearest-center rule, then recompute each center as its cluster's centroid — until the assignment stops changing:

```java
// Lloyd's procedure, following CLRS's four numbered steps.
// Input: S, a set of points in R^d; k, the number of clusters.
// Output: a k-clustering of S and its k centers.
double[][] centers = pickKRandomPointsFrom(S);   // step 1: initial centers, k random points of S
int[] assignment = new int[S.length];            // every point starts in cluster 0

while (true) {
    // step 2: assign each point to the cluster with the nearest center
    // (never reassign unless the new center is *strictly* closer than the old one)
    boolean changed = reassignByNearestCenter(S, centers, assignment);

    // step 3: stop if step 2 made no changes
    if (!changed) {
        return new Clustering(assignment, centers);
    }

    // step 4: recompute each center as the centroid of its cluster
    // (the zero vector if a cluster is empty), then go back to step 2
    centers = recomputeCentroids(S, assignment, k);
}
```

A cluster can come back empty from step 4, especially when many input points are identical, in which case its center is set to the zero vector. Lloyd's procedure is guaranteed to terminate: by Theorem 33.1, recomputing centers as centroids can never increase f(S, C), and a point is only ever reassigned when doing so strictly decreases f(S, C). So every iteration except the last strictly decreases the objective, and because there are only finitely many possible k-clusterings of S (at most k^n of them), the procedure cannot loop forever. In practice, running it until it would need k^n iterations is impractical, so it's common to stop once the percentage decrease in f(S, C) from the latest iteration falls below a threshold — and, since Lloyd's procedure only guarantees a local optimum, a common strategy for finding a *good* clustering is to run it several times from different random initial centers and keep the best result.

One iteration costs O(dkn) time to assign points to clusters via the nearest-center rule (each of n points compared against k centers, each comparison costing O(d)), and O(dn) time to recompute centers as centroids (each point contributes to exactly one cluster's running sum). So the overall running time, across T iterations, is O(Tdkn).

### Worked example: vector quantization for photo compression

CLRS applies Lloyd's procedure to *vector quantization*: reducing the number of distinct colors needed to represent a photograph so it compresses more (albeit lossily). The example photo is 700 pixels wide by 500 pixels high — 350,000 pixels total — each originally encoded as a 24-bit RGB triple (three 8-bit values), giving an initial space of up to 2^24 possible colors per pixel (the actual photo has 79,083 distinct colors, since many pixels repeat). Here, the "points" being clustered are the pixel colors themselves, each a point in the 3-dimensional space of RGB values. Running Lloyd's procedure compresses the picture down to a space of only k distinct colors — the book shows results for k = 4, 16, 64, and 256 — where those k values *are* the cluster centers. Each pixel can then be represented with only ⌈lg k⌉ bits instead of 24: 2 bits for k = 4, 4 bits for k = 16, 6 bits for k = 64, 8 bits for k = 256. An auxiliary table, the "palette," accompanies the compressed image, holding the k 24-bit cluster centers, and is used to map each pixel's compressed value back to a 24-bit RGB color on decompression. The book reports the objective value f and iteration count Lloyd's procedure took to converge at each k: f ≈ 1.29×10^9 in 31 iterations for k = 4, f ≈ 3.31×10^8 in 36 iterations for k = 16, f ≈ 5.50×10^7 in 59 iterations for k = 64, and f ≈ 1.52×10^7 in 104 iterations for k = 256 — the objective shrinking as k grows, at the cost of more iterations to converge and more bits per pixel.

CLRS also runs a second, non-photo example: clustering n = 49 points (the capitals of the 48 lower US states plus the District of Columbia, each with latitude and longitude as its two attributes) into k = 4 clusters, starting from the capitals of Arkansas, Kansas, Louisiana, and Tennessee as the initial centers. The objective f drops from 3659.13 in the initial clustering, through the iterations, down to 1395.73, where it stays unchanged between the 10th and 11th iterations — at which point Lloyd's procedure terminates.

### The general machine-learning framework Lloyd's procedure illustrates

CLRS frames k-means as an instance of a pattern common to many machine-learning algorithms: first, define a hypothesis space as a sequence of parameters θ, where each θ picks out a specific hypothesis h_θ (for k-means, θ is the dk-dimensional vector of the k cluster centers, and h_θ is "group each point with whichever cluster center is closest to it"); second, define a measure f(E, θ) of how poorly h_θ fits the training data E, where smaller is better (for k-means, this is just f(S, C) from equation 33.2); third, use an optimization procedure to find a θ* that (at least locally) minimizes f(E, θ*) — for k-means, that optimization procedure is Lloyd's procedure itself, and θ* is the sequence of centers C it returns.

## Trade-offs

- **Local optimum only, no global guarantee** — k-means (finding the C that globally minimizes f(S, C)) is NP-hard, so Lloyd's procedure settles for a local minimum: each cluster has an optimal (centroid) center, and each point sits in its nearest cluster — necessary but not sufficient conditions for the true global optimum. The book's own way of dealing with this is to run Lloyd's procedure multiple times from different random initial centers and keep whichever run produces the lowest f.
- **k must be given, not discovered** — CLRS presumes k is supplied as input; it notes some variants of the clustering problem instead derive k from the procedure itself, but that variant isn't what Lloyd's procedure here solves.
- **The k^n worst-case iteration bound is impractical, so real runs use an early-stop threshold** — the termination proof only guarantees the procedure stops within at most k^n iterations (the number of possible k-clusterings of n points), which would be impractical if actually reached; in practice, runs are cut off once the percentage decrease in f(S, C) between iterations drops below a threshold.
- **Dissimilarity measure and attribute scaling are judgment calls, not fixed by the algorithm** — squared Euclidean distance is conventional and mathematically convenient (it's what makes the centroid the provably optimal center, per Theorem 33.1), but CLRS is explicit that it's an arbitrary choice — e.g., using plain (non-squared) distance is equally legitimate for a problem like the state-capitals example. Similarly, whether and how to normalize attributes (min-max to [0,1] vs. mean-0/unit-variance) is left to the practitioner, and skipping it when attributes have very different scales lets one attribute dominate the dissimilarity computation.
- **Empty clusters are a real possibility** — if many input points are identical (or, more generally, if a center ends up nearest to no point), step 4 sets that cluster's center to the zero vector rather than leaving it undefined; this is expected behavior, not a bug to guard against.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 33.1 "Clustering", pp. 1005-1014](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
