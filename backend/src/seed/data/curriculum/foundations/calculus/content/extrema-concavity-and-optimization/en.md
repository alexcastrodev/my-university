---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define absolute and local extrema, state the Extreme Value Theorem with its hypotheses, and give examples where dropping a hypothesis destroys the conclusion.
- Find critical points and explain why a critical point is a candidate, not a verdict.
- Locate the absolute extrema of a continuous function on a closed interval, including the endpoints.
- Classify critical points with the first and second derivative tests, and recognize the case where the second derivative test says nothing.
- Read concavity and inflection points from the sign of $f''$, and set up and solve an optimization word problem with the correct domain.

## Context & Motivation

Training a model, tuning a cache size, choosing a block length for a data structure, and sizing a container are all the same question: which input makes some quantity as small or as large as possible? Single-variable calculus gives a complete method. Differentiate, find where the slope vanishes or fails to exist, and compare. The same pattern generalizes: `gradients-extending-derivatives-to-several-variables` sets the gradient to zero in many variables, and `critical-points-and-the-second-derivative-test` handles the classification step with a matrix of second derivatives.

This lesson builds on `the-mean-value-theorem-and-monotonicity`: the first derivative test is that lesson's sign-of-the-derivative result applied on both sides of a point, and the second derivative test is the same result applied to $f'$. The care this subject demands lies in the details: which points must be examined, which tests apply, and which domain the problem actually lives on.

## Core Theory

### Extrema and the Extreme Value Theorem

A value $f(c)$ is an **absolute maximum** on a set $D$ if $f(c) \ge f(x)$ for every $x \in D$, and a **local maximum** if that inequality holds for all $x$ in some open interval around $c$. Minima are defined with the inequality reversed.

**Extreme Value Theorem.** If $f$ is continuous on a closed, bounded interval $[a, b]$, then $f$ attains an absolute maximum and an absolute minimum on $[a, b]$.

Both hypotheses are needed. The function $f(x) = x$ on the open interval $(0, 1)$ is continuous but has neither a maximum nor a minimum, since values get arbitrarily close to $1$ and $0$ without reaching them. On the closed interval $[0, 1]$ define $f(x) = x$ for $x < 1$ and $f(1) = 0$. It is not continuous at $1$, the values approach $1$ but never reach it, and there is no maximum. The theorem guarantees existence; it does not say where the extremum is.

### Critical points

By Fermat's observation from the previous lesson, if $f$ has a local extremum at an interior point $c$ and $f'(c)$ exists, then $f'(c) = 0$. A **critical point** is an interior point $c$ of the domain where $f'(c) = 0$ or $f'(c)$ does not exist. Every interior local extremum is at a critical point. The converse is false: $f(x) = x^3$ has $f'(0) = 0$ but no extremum.

### The closed interval method

For $f$ continuous on $[a, b]$:

1. Find all critical points in $(a, b)$.
2. Evaluate $f$ at each critical point and at $a$ and $b$.
3. The largest value is the absolute maximum and the smallest is the absolute minimum.

The Extreme Value Theorem guarantees the extrema exist, and Fermat guarantees that any not at an endpoint is at a critical point. This is why the endpoints are on the list: an extremum can sit where the derivative is nowhere near zero.

### First and second derivative tests

**First derivative test.** Let $c$ be a critical point and $f$ continuous at $c$, and suppose $f'$ has a constant sign on each side of $c$. If $f'$ changes from negative to positive at $c$, $f(c)$ is a local minimum. If it changes from positive to negative, a local maximum. If $f'$ keeps the same sign on both sides, there is no extremum. This follows from the monotonicity results of the previous lesson on each side of $c$, and it works even when $f'(c)$ does not exist. If $f'$ changes sign infinitely often near $c$, the test does not apply (Example 2).

**Second derivative test.** Suppose $f'(c) = 0$ and $f''$ exists near $c$ and is continuous at $c$. If $f''(c) > 0$, $f$ has a local minimum at $c$; if $f''(c) < 0$, a local maximum. If $f''(c) = 0$, the test is **inconclusive**: any of the three outcomes can occur, as Example 2 shows. The test also requires $f'(c)$ to exist and equal zero, so it cannot classify a corner or a cusp.

### Concavity and inflection points

If $f'' > 0$ on an interval, then $f'$ is increasing there (previous lesson, applied to $f'$), so the slopes grow from left to right and the graph bends upward: $f$ is **concave up**. If $f'' < 0$, $f$ is **concave down**. An **inflection point** is a point where $f$ is continuous and the concavity changes. At such a point either $f''(c) = 0$ or $f''(c)$ does not exist, but neither condition is sufficient by itself. The sign of $f''$ must actually change.

## Worked Examples

### Example 1: absolute extrema on a closed interval

Find the absolute extrema of $f(x) = x^3 - 3x$ on $[-2, 3]$. The function is a polynomial, so it is continuous and the method applies. Since $f'(x) = 3x^2 - 3 = 3(x - 1)(x + 1)$, the critical points are $x = \pm 1$, both inside the interval. Evaluating:

```text
x     = -2   -1    1    3
f(x)  = -2    2   -2   18
```

The absolute maximum is $18$ at the endpoint $x = 3$, where $f'(3) = 24 \ne 0$. The absolute minimum is $-2$, attained at two different points, $x = -2$ and $x = 1$. The value $f(-1) = 2$ is a local maximum only. The second derivative $f''(x) = 6x$ confirms it: $f''(-1) = -6 < 0$ (local maximum) and $f''(1) = 6 > 0$ (local minimum). Since $f''$ changes sign at $x = 0$, there is an inflection point at $(0, 0)$, with $f$ concave down to its left and concave up to its right.

### Example 2: when the tests go silent

Five functions, all with a critical point at $x = 0$.

- $x^4$: $f'(0) = 0$ and $f''(0) = 0$. Local and absolute minimum.
- $-x^4$: $f'(0) = 0$ and $f''(0) = 0$. Local and absolute maximum.
- $x^3$: $f'(0) = 0$ and $f''(0) = 0$. No extremum.
- $x^{2/3}$: neither $f'(0)$ nor $f''(0)$ exists. Absolute minimum.
- $x^2\left(2 + \sin\frac1x\right)$ with $f(0) = 0$: $f'(0) = 0$, and $f''(0)$ does not exist. Strict absolute minimum.

Here $x^{2/3}$ means $(\sqrt[3]{x})^2$, and $x^{-1/3}$ and $x^{-5/3}$ below mean $1/\sqrt[3]{x}$ and $1/(\sqrt[3]{x})^5$: the real-root reading, defined for negative $x$. In code use `numpy.cbrt`, since `numpy.power(-1.0, 2/3)` is `nan`.

The second derivative test is silent on the first three functions, since $f''(0) = 0$ each time. The first derivative test settles them: for $x^4$, $f' = 4x^3$ is negative then positive; for $-x^4$ the reverse; for $x^3$, $f' = 3x^2$ is positive on both sides. For $x^{2/3}$, $f'(x) = \frac23 x^{-1/3}$ is negative for $x < 0$ and positive for $x > 0$, so the first derivative test finds a minimum at a cusp, where the second derivative test cannot even be stated.

The fifth function defeats both tests. Since $f(x) \ge x^2 > 0 = f(0)$ for $x \ne 0$, the minimum is clear. But $f'(0) = \lim_{h \to 0} h\left(2 + \sin\frac1h\right) = 0$, while for $x \ne 0$, $f'(x) = 2x\left(2 + \sin\frac1x\right) - \cos\frac1x$, which equals $4x - 1 < 0$ at $x = \frac{1}{2\pi k}$ and $4x + 1 > 0$ at $x = \frac{1}{(2k+1)\pi}$ for every large integer $k$. So $f'$ changes sign infinitely often near $0$ (no sign pattern for the first derivative test), and $f'(h)/h$ has no limit, so $f''(0)$ does not exist. Only a direct comparison of values settles it.

Concavity has matching traps. For $x^4$, $f''(0) = 0$ but $f'' = 12x^2 \ge 0$ on both sides, so there is no inflection point at $0$. For $f(x) = \sqrt[3]{x}$, $f''(x) = -\frac29 x^{-5/3}$ does not exist at $0$, and it is positive for $x < 0$ and negative for $x > 0$, so there is an inflection point exactly where $f''$ is undefined.

### Example 3: an optimization problem on an open domain

A cylindrical can must hold $1000\ \text{cm}^3$. What radius minimizes the surface area? With radius $r$ and height $h$, volume gives $h = \frac{1000}{\pi r^2}$, and the area of the two ends plus the side is

$$S(r) = 2\pi r^2 + 2\pi r h = 2\pi r^2 + \frac{2000}{r}, \qquad r > 0.$$

Then $S'(r) = 4\pi r - \frac{2000}{r^2} = 0$ gives $r^3 = \frac{500}{\pi}$, so $r = \left(\frac{500}{\pi}\right)^{1/3} \approx 5.419$ cm. The domain $(0, \infty)$ has no endpoints to compare, so we need an argument that this critical point is the minimum. Here $S''(r) = 4\pi + \frac{4000}{r^3} > 0$ for every $r > 0$, so $S'$ is increasing. With $S'(r^*) = 0$ at $r^* \approx 5.419$, this means $S' < 0$ on all of $(0, r^*)$ and $S' > 0$ on all of $(r^*, \infty)$. By the monotonicity results of the previous lesson, $S$ is decreasing up to $r^*$ and increasing after it, so $S(r^*)$ is the absolute minimum. A numerical check agrees:

```text
r = 4.0   S = 600.53
r = 5.0   S = 557.08
r = 5.419 S = 553.58   (minimum)
r = 6.0   S = 559.53
r = 7.0   S = 593.59
```

At the optimum $h = \frac{1000}{\pi r^2} \approx 10.839 = 2r$: the best can is as tall as it is wide.

### Example 4: choosing a block size

Jump search over $n$ sorted items skips ahead in blocks of $b$ and then scans inside one block. A simple cost model counts about $\frac nb$ jumps plus up to $b$ steps inside a block: $C(b) = \frac nb + b$. This is a model of the operation count, not an exact comparison count. Take $n = 10\,000$ and the closed interval $1 \le b \le n$, so the closed interval method applies. $C'(b) = -\frac{n}{b^2} + 1 = 0$ gives $b = \sqrt n = 100$, with $C(100) = 200$. The endpoints give $C(1) = C(10\,000) = 10\,001$. The minimum $2\sqrt n$ is why this strategy is $O(\sqrt n)$. In practice $b$ must be an integer, so for non-square $n$ you compare the two integers beside $\sqrt n$.

## Common Misconceptions & Pitfalls

- **"Critical point means extremum."** It means candidate. $x^3$ at $0$ is a critical point with no extremum.
- **"$f''(c) = 0$ means an inflection point."** $x^4$ refutes it. An inflection point requires $f''$ to change sign.
- **"The second derivative test always decides."** When $f''(c) = 0$ it is silent, and it cannot be applied where $f'(c)$ does not exist. Fall back on the first derivative test, and if $f'$ has no sign pattern near $c$, compare values directly (Example 2).
- **Forgetting the endpoints.** In Example 1 the maximum is at $x = 3$, where the derivative is $24$.
- **Confusing local with absolute.** In Example 1, $f(-1) = 2$ is a local maximum but far from the largest value.
- **Skipping the domain.** A formula for $S(r)$ is meaningless for $r \le 0$, and an optimization on an open or unbounded domain needs an argument, such as the sign of $S'$ or the behavior as $r \to 0^+$ and $r \to \infty$, because the Extreme Value Theorem does not apply.

## Summary

An absolute extremum of a continuous function on a closed bounded interval always exists. It occurs at an endpoint or at an interior critical point, where $f' = 0$ or $f'$ does not exist. A critical point is only a candidate: $x^3$ has one and no extremum. The first derivative test classifies it by the sign change of $f'$ and works even at a cusp, as long as $f'$ has a constant sign on each side. The second derivative test is quicker when $f''(c) \ne 0$ and silent when $f''(c) = 0$, as with $x^4$, $-x^4$, and $x^3$. Concavity follows the sign of $f''$, and an inflection point needs a sign change, not just $f'' = 0$. Optimization is modeling plus this method: write one variable's formula, fix the domain, find the candidates, compare them, and justify the winner. The next lesson, `lhopitals-rule`, uses derivatives for a different job, resolving limits that the limit laws cannot.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.3: Maxima and Minima](https://openstax.org/books/calculus-volume-1/pages/4-3-maxima-and-minima): absolute and local extrema, the Extreme Value Theorem, Fermat's theorem, critical points, and the closed interval method.
- [OpenStax Calculus Volume 1, 4.5: Derivatives and the Shape of a Graph](https://openstax.org/books/calculus-volume-1/pages/4-5-derivatives-and-the-shape-of-a-graph): the first and second derivative tests, concavity, and inflection points.
- [OpenStax Calculus Volume 1, 4.7: Applied Optimization Problems](https://openstax.org/books/calculus-volume-1/pages/4-7-applied-optimization-problems): a general strategy for translating word problems into one-variable optimization.
- [MIT OCW 18.01SC, Unit 2, Part B: Optimization, Related Rates and Newton's Method](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-b-optimization-related-rates-and-newtons-method/): lecture sessions on optimization problems.
