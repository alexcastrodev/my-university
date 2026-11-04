---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define an improper integral over an unbounded interval, and over an interval where the integrand blows up, as a limit of ordinary integrals, and say when it converges or diverges.
- Classify $\int_1^\infty x^{-p}\,dx$ and $\int_0^1 x^{-p}\,dx$ for every real $p$ (the $p$-test) and compute their values when they converge.
- Apply the comparison theorem with all of its hypotheses to decide convergence without finding an antiderivative.
- Recognize the two classic traps: using the Fundamental Theorem of Calculus across a singularity, and letting a symmetric limit hide a divergence.
- Explain why "a density has total area 1" is an improper integral over the whole line, and why a density can integrate to 1 while its mean does not exist.

## Context & Motivation

The definite integral you built from Riemann sums (`the-definite-integral-and-riemann-sums`) and evaluated with antiderivatives (`the-fundamental-theorem-of-calculus`) was defined for a function on a closed, bounded interval $[a, b]$, and the Fundamental Theorem needs the function to be continuous on all of it. Two situations break those assumptions and both are everywhere in practice: an interval that never ends, such as the tail of a distribution, and an integrand that shoots off to infinity at an endpoint. The area in question may still be a perfectly good finite number, so the work is to say precisely when, and how to compute it.

The lesson `continuous-random-variables-and-pdfs` introduced a probability density as a non-negative curve with total area 1, and checked that condition with rectangles and triangles over a bounded interval. Densities that matter in practice, the exponential and the normal among them, have curved shapes and tails that stay positive forever, so the "total area" is the area under an infinite tail. That area is a limit, and it is exactly what this lesson makes precise. The same machinery decides whether a mean or a variance exists, which is a real question for heavy-tailed quantities.

## Core Theory

### Type I: an unbounded interval

If $f$ is continuous on $[a, \infty)$, define

$$\int_a^\infty f(x)\,dx = \lim_{b\to\infty} \int_a^b f(x)\,dx$$

The integral **converges** if this limit exists and is a finite number, and **diverges** otherwise (the limit is $\pm\infty$, or does not exist). The case $(-\infty, b]$ is the mirror image. For the whole line, pick any $c$ and require both halves to converge on their own:

$$\int_{-\infty}^{\infty} f(x)\,dx = \int_{-\infty}^{c} f(x)\,dx + \int_{c}^{\infty} f(x)\,dx$$

If either half diverges, the whole integral diverges. The choice of $c$ does not change the answer.

### Type II: an integrand that blows up

If $f$ is continuous on $(a, b]$ but unbounded near $a$, define

$$\int_a^b f(x)\,dx = \lim_{t\to a^+} \int_t^b f(x)\,dx$$

and treat a blow-up at the right end the same way. If the bad point $c$ lies strictly inside $(a, b)$, split at $c$ and require both pieces to converge separately. A function that merely has a removable gap, such as $\sin x / x$ at $0$, does not make the integral improper, because the function extends to a continuous one.

### The $p$-test

For $p \neq 1$ the antiderivative of $x^{-p}$ is $x^{1-p}/(1-p)$, so $\int_1^b x^{-p}\,dx = (b^{1-p} - 1)/(1-p)$. As $b \to \infty$ the power $b^{1-p}$ tends to $0$ when $p > 1$ and to $\infty$ when $p < 1$. For $p = 1$ the integral is $\ln b \to \infty$. On the other end, $\int_t^1 x^{-p}\,dx$ is handled the same way with $t \to 0^+$. The results:

- $\int_1^\infty x^{-p}\,dx$ converges exactly when $p > 1$, and then equals $\dfrac{1}{p-1}$.
- $\int_0^1 x^{-p}\,dx$ converges exactly when $p < 1$, and then equals $\dfrac{1}{1-p}$.

The borderline $p = 1$ diverges in both cases. The tail wants a fast decay (large $p$), the singularity wants a mild blow-up (small $p$).

### The comparison theorem

Suppose $f$ and $g$ are continuous on $[a, \infty)$ and $0 \le f(x) \le g(x)$ for every $x \ge a$. Then:

- if $\int_a^\infty g$ converges, so does $\int_a^\infty f$, and $\int_a^\infty f \le \int_a^\infty g$;
- if $\int_a^\infty f$ diverges, so does $\int_a^\infty g$.

The reason is short. Because $f \ge 0$, the function $b \mapsto \int_a^b f$ never decreases, and because $f \le g$ it is capped by $\int_a^\infty g$. A non-decreasing quantity with an upper bound has a limit (the sequence version of this fact is the subject of `sequences-and-convergence`). The theorem says nothing when the smaller integral converges or the larger one diverges. It also fails without the hypothesis $f \ge 0$: with $f(x) = -1$ and $g(x) = 1/x^2$ we have $f \le g$ and $\int_1^\infty g = 1$, yet $\int_1^b f = -(b-1) \to -\infty$.

### Densities, normalization, and moments

A density $f$ on the line must satisfy $f \ge 0$ and $\int_{-\infty}^{\infty} f = 1$, now read as a pair of improper integrals. The normal density from `the-normal-distribution` is stated there without derivation, and its constant is exactly what this integral requires: $\int_{-\infty}^{\infty} e^{-x^2/2}\,dx = \sqrt{2\pi}$, so dividing by $\sqrt{2\pi}$ (and rescaling by $\sigma$) gives total area 1. There is no elementary antiderivative of $e^{-x^2/2}$, so this value comes from a different argument, while convergence alone follows from comparison: for $x \ge 1$, $x^2/2 \ge x/2$, so $0 < e^{-x^2/2} \le e^{-x/2}$, and $\int_1^\infty e^{-x/2}\,dx = 2e^{-1/2}$ is finite (Example 3 does the same for $e^{-x^2}$).

The mean of a continuous random variable is $\int x f(x)\,dx$, another improper integral. Normalization does not guarantee that it converges, and Example 4 shows densities where it fails.

## Worked Examples

### Example 1: the $p$-integrals with numbers

Compute $\int_1^b x^{-2}\,dx = 1 - 1/b$ and $\int_1^b x^{-1}\,dx = \ln b$ for growing $b$:

```text
b          int_1^b x^-2    int_1^b x^-1    int_1^b x^(-1/2)
10         0.9             2.3026          4.3246
100        0.99            4.6052          18.0
1000       0.999           6.9078          61.2456
1000000    0.999999        13.8155         1998.0
```

The first column settles at $1$, so $\int_1^\infty x^{-2}\,dx = 1$. The other two keep growing without bound, so $\int_1^\infty x^{-1}\,dx$ and $\int_1^\infty x^{-1/2}\,dx$ diverge. Note how slow $\ln b$ is: it needs $b = 10^6$ to reach about $13.8$. A table of values can suggest divergence but the formula is what proves it.

Near zero the roles reverse. $\int_t^1 x^{-1/2}\,dx = 2 - 2\sqrt{t}$, which tends to $2$ as $t \to 0^+$, so $\int_0^1 x^{-1/2}\,dx = 2$ even though the integrand is unbounded. But $\int_t^1 x^{-1}\,dx = -\ln t$ grows without bound, so $\int_0^1 x^{-1}\,dx$ diverges.

### Example 2: two traps

**Across a singularity.** Consider $\int_{-1}^{1} x^{-2}\,dx$. The antiderivative $-1/x$ gives $(-1/1) - (-1/(-1)) = -2$, a negative answer for a positive integrand, which already signals a mistake. The function $x^{-2}$ is not continuous at $0$, so the Fundamental Theorem does not apply on $[-1, 1]$. Splitting at $0$ gives $\int_t^1 x^{-2}\,dx = 1/t - 1$, which is $9, 99, 999$ for $t = 0.1, 0.01, 0.001$ and tends to $\infty$. The integral diverges to $+\infty$.

**A symmetric limit.** For $f(x) = x$, the symmetric limit is $\lim_{R\to\infty} \int_{-R}^{R} x\,dx = 0$. But $\int_0^R x\,dx = R^2/2 \to \infty$, so $\int_{-\infty}^{\infty} x\,dx$ diverges. Cutting the line at $-R$ and $2R$ instead gives $\int_{-R}^{2R} x\,dx = 3R^2/2$, a different "answer". When the two halves are not each convergent, the value depends on how the cuts are taken, so no value is assigned.

### Example 3: comparison in both directions

**Convergence.** For $x \ge 1$ we have $x^2 \ge x$, hence $0 < e^{-x^2} \le e^{-x}$. Since $\int_1^\infty e^{-x}\,dx = e^{-1} \approx 0.3679$ converges, $\int_1^\infty e^{-x^2}\,dx$ converges and is at most $0.3679$. Numerical integration gives $0.1394$, consistent with the bound. Together with the part over $[0, 1]$, which is an ordinary integral, and symmetry, this gives convergence on the whole line.

**Divergence.** For $x \ge 1$, $(2 + \sin x)/x \ge 1/x > 0$. Because $\int_1^\infty x^{-1}\,dx$ diverges, so does $\int_1^\infty (2+\sin x)/x\,dx$. The partial integrals confirm it:

```text
b          int_1^b (2+sin x)/x     lower bound ln b
100        9.83                    4.61
10000      19.05                   9.21
1000000    28.26                   13.82
```

The oscillation of $\sin x$ does not rescue convergence: the bound $2 + \sin x \ge 1$ keeps the integrand above a divergent integral.

### Example 4: densities, tails, and missing means

**Exponential.** For rate $\lambda > 0$, $f(x) = \lambda e^{-\lambda x}$ on $x \ge 0$ has $\int_0^b f = 1 - e^{-\lambda b} \to 1$, so the total area is $1$, and $P(X > t) = \int_t^\infty f = e^{-\lambda t}$. With $\lambda = 2$ and $t = 1.5$ this is $e^{-3} \approx 0.0498$.

**Pareto.** For $\alpha > 0$, $f(x) = \alpha x^{-\alpha-1}$ on $x \ge 1$ integrates to $1$ by the $p$-test with $p = \alpha + 1$. The mean is $\int_1^\infty x \cdot \alpha x^{-\alpha-1}\,dx = \alpha \int_1^\infty x^{-\alpha}\,dx$, which converges only for $\alpha > 1$, with value $\alpha/(\alpha-1)$. For $\alpha = 3$ the mean is $1.5$ and for $\alpha = 1.5$ it is $3$. For $\alpha = 1$ the density is valid but $\int_1^b x \cdot x^{-2}\,dx = \ln b$ for $b = 10^2, 10^4, 10^6$ is $4.61, 9.21, 13.82$ and never levels off: the mean does not exist.

**Cauchy.** The density $1/(\pi(1+x^2))$ has $\int_{-\infty}^{\infty} f = 1$, but $\int_0^b x f\,dx = \ln(1+b^2)/(2\pi)$ takes the values $0.73, 2.20, 4.40$ at $b = 10, 10^3, 10^6$ and diverges. By symmetry the left half diverges to $-\infty$, so the mean does not exist, even though the symmetric limit would suggest $0$ (the trap from Example 2).

**Unbounded height.** The density $1/(\pi\sqrt{x(1-x)})$ on $(0, 1)$ has total area $1$ as a Type II integral at both ends, yet $f(10^{-4}) \approx 31.8$ and $f$ is unbounded. The remark in `continuous-random-variables-and-pdfs` that a density's height can exceed $1$ is therefore not a small effect: there is no upper bound at all.

## Common Misconceptions & Pitfalls

- **"If $f(x) \to 0$ then $\int_a^\infty f$ converges."** The function $1/x$ tends to $0$ and its integral diverges. The rate matters, which is why the $p$-test has a threshold at $p = 1$.
- **"If $\int_a^\infty f$ converges then $f(x) \to 0$."** True when $f$ is non-negative and non-increasing, but false in general, even for non-negative continuous $f$. Place a triangular spike of height $n$ and base width $2/n^3$ around each integer $n \ge 2$. Its area is $\tfrac12 \cdot \tfrac{2}{n^3} \cdot n = 1/n^2$, and the total area is the series $\sum_{n\ge 2} 1/n^2 = \pi^2/6 - 1 \approx 0.645$ (series are the topic of `infinite-series-and-partial-sums`). The integral converges while $f$ keeps returning to height $n$.
- **"Apply the antiderivative anyway, the answer is a number."** Across a discontinuity inside the interval the Fundamental Theorem does not apply, and the formal answer can even have the wrong sign (Example 2).
- **"A symmetric interval means the answer is $0$ for an odd function."** Only when each half converges. Otherwise $\infty - \infty$ is not a number.
- **"Comparison works with any inequality."** It needs $0 \le f \le g$ on the whole tail, continuity, and the correct direction: a convergent upper bound forces convergence, a divergent lower bound forces divergence, and the other two combinations prove nothing.
- **"A density that integrates to $1$ has a mean."** Example 4 gives the Pareto density with $\alpha = 1$ and the Cauchy density, where the mean integral diverges.

## Summary

An improper integral replaces an endpoint at infinity, or a point where the integrand blows up, by a limit of ordinary integrals, and it converges only when that limit is finite. For a doubly infinite interval or an interior singularity, each piece must converge separately. The $p$-test is the benchmark: $\int_1^\infty x^{-p}\,dx$ converges exactly when $p > 1$ (value $1/(p-1)$), while $\int_0^1 x^{-p}\,dx$ converges exactly when $p < 1$ (value $1/(1-p)$). The comparison theorem decides convergence for non-negative continuous integrands by trapping them against a $p$-integral. These tools turn "the total area under a density is 1" into a checkable statement about a limit, and they show that moments such as the mean can fail to exist even for a valid density. The next lesson, `sequences-and-convergence`, applies the same limit idea to lists of numbers instead of areas.

## Documentation Links

- [OpenStax Calculus Volume 2: 3.7 Improper Integrals](https://openstax.org/books/calculus-volume-2/pages/3-7-improper-integrals): infinite intervals, infinite discontinuities, and the comparison theorem with worked problems.
- [Active Calculus: 6.5 Improper integrals](https://activecalculus.org/single/sec-6-5-improper.html): improper integrals through guided activities, including convergence and divergence of typical examples.
- [MIT OCW 18.01SC: Unit 5, Exploring the Infinite](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/): the sessions on improper integrals, integral comparison, and singularities, with notes and videos.
