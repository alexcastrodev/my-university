---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Gradient descent is a general method for finding a local minimum of a continuous function f : R^n -> R. Instead of solving for a minimum analytically, you start at some point and repeatedly take small steps in the direction that decreases f the fastest, based on the function's gradient, until you settle near a low point.

This concept comes from Chapter 33, "Machine-Learning Algorithms," a genuinely new chapter added in the 4th edition of Cormen, Leiserson, Rivest, and Stein's *Introduction to Algorithms*. It is worth being upfront that this is new territory for the textbook rather than a decades-old staple like sorting or graph search. That said, the material itself is squarely algorithmic: an iterative update rule, a step-size parameter, a convergence analysis with a provable error bound, and an honest discussion of when the method does and does not find the best possible answer. This entry sticks to that algorithmic core — the update rule, step size, convergence behavior, and the local-vs-global-minimum distinction — rather than turning into a general machine-learning primer.

The motivating example the source uses throughout is line fitting: given a set of points, find the line that best fits them by minimizing some function of the distances between the points and the line (for instance, the sum of squared distances). When that objective and its constraints are linear, it's a linear-programming problem (Chapter 29); gradient descent is for the more general case where the objective is a continuous but not necessarily linear function.

## Use Cases

- Fitting a line (or, more generally, a linear function) to a set of data points by minimizing an error measure such as the sum of squared distances — a least-squares fit.
- Approximately solving a system of linear equations Ax = b when A is large, as a faster alternative to Gaussian elimination's Θ(n^3) running time.
- Linear regression: computing a set of weights that best predict a numeric label from a set of input attributes, by minimizing a least-squares loss function.
- Any optimization problem where the objective is a continuous, differentiable function that is not linear (so linear programming doesn't apply) but is convex, and where you're willing to accept an approximate minimizer in exchange for speed.

## Deep Dive

### The iterative update rule

Imagine standing in a landscape of hills and valleys and wanting to reach a low point as quickly as possible: you survey the terrain, move a short distance in the steepest downhill direction, then stop and reevaluate, because the terrain — and therefore the best direction — has changed. Repeating this until every direction leads uphill lands you at a local minimum.

Formalizing "steepest downhill direction" requires the gradient. For f : R^n -> R, the gradient (∇f)(x) is the n-vector of partial derivatives (∂f/∂x1, ∂f/∂x2, ..., ∂f/∂xn). Informally, the gradient points in the direction the function increases fastest, and its magnitude reflects how fast. Gradient descent's key step is to move in the direction *opposite* the gradient, by a distance influenced by the gradient's magnitude.

```
GRADIENT-DESCENT(f, x(0), α, T)
1  sum = 0                          // n-dimensional vector, initially all 0
2  for t = 0 to T - 1
3      sum = sum + x(t)             // add each of n dimensions into sum
4      x(t+1) = x(t) - α · (∇f)(x(t))
5  x-avg = sum / T                  // divide each of n dimensions by T
6  return x-avg
```

The inputs are the function f, an initial point x(0) in R^n, a fixed step-size multiplier α > 0, and a number of steps T. Each iteration computes the gradient at the current point and moves distance α in the opposite direction, so f(x(t+1)) <= f(x(t)) — each step is monotonically non-increasing in the function value. The dominant cost per iteration is computing the gradient, whose complexity depends entirely on f and can sometimes be expensive.

Rather than returning the final point x(T), the algorithm returns x-avg, the average of all the points visited except the last. It might seem more natural to return x(T) directly — and in practice you sometimes would prefer that — but the version analyzed in the source uses x-avg because its convergence proof reasons about the average.

### Step size, local minima, and convergence

Consider the one-dimensional case, f : R -> R, where the gradient is just the ordinary derivative f'(x). Starting at x(0), the derivative f'(x(0)) has a negative slope, so a *small* step from x(0) in the direction of increasing x produces a point x' with f(x') < f(x(0)) — progress. But too large a step overshoots to a point x'' where f(x'') > f(x(0)) — worse than where you started. Restricting to small downhill steps eventually gets you close to a point that gives a local minimum, but starting from x(0) and only ever taking small downhill steps gives gradient descent no chance of reaching the true global minimizer if it lies on the far side of a hill.

Two observations follow: gradient descent converges toward a local minimum, not necessarily a global one; and how fast it converges depends on properties of the function, the starting point, and the step size.

For convex functions, however, every local minimum is also a global minimum, which is what makes gradient descent useful as a *general* optimization tool rather than just a local search. (f is convex if for all x, y and all 0 <= λ <= 1, f(λx + (1-λ)y) <= λf(x) + (1-λ)f(y).) On a convex function, each iteration moves opposite the gradient by a distance proportional to the gradient's magnitude; as iterations proceed, the gradient shrinks, so the step size shrinks too, and the distance to the optimal point x* decreases with each step.

The formal convergence result (Theorem 33.8) bounds how close x-avg gets to the true minimum after T iterations. Define:

- R = the Euclidean distance ||x(0) - x*|| between the starting point and the minimizer,
- L = an upper bound on the gradient's magnitude ||(∇f)(x)|| over all the points the algorithm visits.

With step size α = R / (L·sqrt(T)), the theorem guarantees f(x-avg) - f(x*) <= ε, where ε = RL / sqrt(T). Solving that relationship for T instead gives T = R^2·L^2 / ε^2 — the number of iterations needed depends on the square of R and L and, most importantly, on 1/ε^2. Concretely: to halve the error bound, you need four times as many iterations.

In practice you often don't know R and L exactly, since R depends on knowing x* in the first place. When fixed bounds aren't available, an alternative is *line search*: instead of committing to a fixed step size, search for a step size that achieves a large decrease in f, for example by doubling a small trial step size s until it stops helping, then binary-searching the resulting interval [s, 2s].

### Constrained gradient descent

Sometimes the minimization is subject to an additional requirement that x lie within a closed convex body K (a set where the line segment between any two points in K stays in K, and which contains its limit points). Restricting to this constrained version turns out not to significantly increase the number of iterations needed.

```
GRADIENT-DESCENT-CONSTRAINED(f, x(0), α, T, K)
1  sum = 0
2  for t = 0 to T - 1
3      sum = sum + x(t)
4      x'(t+1) = x(t) - α · (∇f)(x(t))
5      x(t+1) = Π_K(x'(t+1))         // project back onto K
6  x-avg = sum / T
7  return x-avg
```

The one change from the unconstrained version is line 5: after the ordinary gradient step (now landing at an intermediate point x'), project it back onto K if it fell outside. The projection Π_K(x) of a point x onto K is the closest point y in K to x. A key lemma shows that projecting onto K can never move you *farther* from the true minimizer x* than the unprojected point was — so the same convergence bound carries over essentially unchanged (Theorem 33.11): with the same choice of α = R / (L·sqrt(T)), f(x-avg) - f(x*) <= ε = RL / sqrt(T).

### Applications: linear systems and linear regression

**Solving Ax = b.** Gaussian elimination solves a system of n linear equations in Θ(n^3) time, which can be prohibitive for large matrices. As an alternative, note that minimizing f(x) = (1/2)x^T·A·x - b^T·x has gradient Ax - b; setting the gradient to zero and solving gives exactly x = A^-1·b. So when A is positive-semidefinite (making f convex), gradient descent can approximately solve Ax = b by minimizing f — often faster than exact Gaussian elimination when R and L aren't too large.

**Linear regression (least-squares fit).** Given m data points, each an n-dimensional attribute vector x^(i) with a numeric label y^(i), the goal is to find a linear function f(x) = w0 + sum_j(wj·xj) — defined by a weight vector w — that predicts each label as closely as possible. The error for point i is e^(i) = f(x^(i)) - y^(i), and the loss function to minimize is the sum of squared errors, sum_i((f(x^(i)) - y^(i))^2). Because this loss is a sum of squares of linear functions, it's convex, so gradient descent applies directly. The gradient of this loss can be computed in O(nm) time — linear in the size of the input — compared to the matrix-inversion approach of Chapter 28, making gradient descent typically much faster in practice.

Regularization — penalizing overly complex hypotheses to avoid overfitting — can be added as a constraint, e.g. requiring ||w|| <= B for some bound B, which is exactly a constrained-gradient-descent problem. The projection step becomes simple scaling: if the unconstrained update produces w', and ||w'|| > B, scale it down to w'·(B / ||w'||), the closest point on the boundary of the constraint region.

## Trade-offs

- **Local minimum, not guaranteed global** — gradient descent only ever moves downhill from wherever it currently stands, so on a non-convex function it can converge to a local minimum while a better, global minimum sits elsewhere entirely out of reach. On convex functions this isn't an issue, since every local minimum is also global.
- **Step size is a balancing act** — too small a step wastes iterations making tiny progress; too large a step can overshoot the minimum and land somewhere worse than the starting point. The theoretically optimal fixed step size α = R/(L·sqrt(T)) requires knowing R and L in advance, which usually means knowing the answer (or a bound on it) before you start — in practice, line search (doubling a trial step then binary-searching) is often used instead.
- **Iteration count scales with 1/ε^2** — the number of iterations needed to guarantee error at most ε is T = R^2·L^2/ε^2. Because of the square, halving the desired error requires roughly four times as many iterations, not two.
- **Approximate, but often much faster than exact methods** — for solving Ax = b, gradient descent trades the guaranteed exact answer of Θ(n^3) Gaussian elimination for an approximate answer that can be reached faster when R and L are modest. Similarly, computing the least-squares regression gradient costs O(nm) per iteration versus the matrix-inversion approach of exact least-squares.
- **Constraints are nearly free** — adding a convex constraint set K and projecting back onto it after each step (constrained gradient descent) does not asymptotically worsen the convergence bound compared to the unconstrained version, as long as the projection itself is cheap to compute (as it is for a simple norm bound like ||w|| <= B, which is just a rescaling).

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 33.3 "Gradient descent", pp. 1023-1037](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
