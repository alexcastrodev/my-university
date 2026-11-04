---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the divergence, integral, comparison, limit comparison, alternating series, ratio, and root tests with all of their hypotheses, and say what each one concludes in each case.
- Recognize when a test is inconclusive, and name a series on each side of the boundary that proves it (for example $\sum 1/n$ and $\sum 1/n^2$ for the ratio test).
- Show on a concrete series why dropping one hypothesis (positivity, monotonicity, a limit that actually exists) can make a test give the wrong answer.
- Distinguish absolute from conditional convergence, and explain why rearranging a conditionally convergent series can change its sum.
- Use the integral test and the alternating series test to bound the error left after $N$ terms, and choose a test for a given series.

## Context & Motivation

Most infinite series have no closed form for their partial sums. The geometric series and telescoping sums from `infinite-series-and-partial-sums` are the exceptions, so the usual question is not "what is the sum?" but "does it converge at all?". The tests in this lesson answer that question without computing the sum, and for the ones that give error bounds they also say how far a truncated sum can be from the true value.

The question matters in computing because a program can only add finitely many terms, and a partial sum alone does not settle convergence. The series $\sum_{n\ge 2} 1/(n\ln n)$ diverges, yet its partial sum up to $n = 10^7$ is only about $3.57$. Looking at the numbers would suggest a limit that does not exist. Convergence tests are the argument that replaces the numerical guess.

Series also show up inside algorithm analysis. The expected cost of quicksort involves the harmonic numbers $H_n = \sum_{k=1}^n 1/k$, whose growth like $\ln n$ comes from the integral test. The linear-time bound for building a binary heap reduces to $\sum_{h\ge 1} h/2^h$, a series the ratio test accepts and whose sum is exactly $2$.

## Core Theory

Throughout, $S_N = \sum_{n=1}^{N} a_n$ is the partial sum and $R_N = S - S_N$ is the remainder when the series converges to $S$.

### The divergence test

If $\sum a_n$ converges, then $a_n \to 0$. Equivalently: if $a_n$ does not tend to $0$ (including when the limit does not exist), the series diverges. The test can only prove divergence. The harmonic series $\sum 1/n$ has $a_n \to 0$ and still diverges, so $a_n \to 0$ is inconclusive.

### The integral test

Hypotheses: $f$ is continuous, positive, and decreasing on $[N, \infty)$, and $a_n = f(n)$ for $n \ge N$. Conclusion: $\sum_{n\ge N} a_n$ and $\int_N^\infty f(x)\,dx$ either both converge or both diverge. When they converge, the remainder is trapped between two integrals:

$$\int_{N+1}^{\infty} f(x)\,dx \;\le\; R_N \;\le\; \int_{N}^{\infty} f(x)\,dx$$

For $p$-series, $\int_1^\infty x^{-p}\,dx$ converges exactly when $p > 1$, so $\sum 1/n^p$ converges exactly when $p > 1$. The hypotheses are not decoration. Take $f(x) = \sin^2(\pi x)$: it is continuous and nonnegative, but not decreasing. Then $a_n = \sin^2(\pi n) = 0$ for every integer $n$, so the series converges to $0$, while $\int_1^M \sin^2(\pi x)\,dx = (M-1)/2$ for integer $M$, which grows without bound. The two behave differently because monotonicity is missing.

### Comparison tests

Direct comparison. Hypothesis: $0 \le a_n \le b_n$ for all $n \ge N$. If $\sum b_n$ converges, so does $\sum a_n$; if $\sum a_n$ diverges, so does $\sum b_n$. The other two directions say nothing: knowing that a small series converges or that a big series diverges tells you nothing about the other one. Nonnegativity is essential: $a_n = -1 \le 1/n^2$ holds for all $n$ and $\sum 1/n^2$ converges, but $\sum(-1)$ diverges.

Limit comparison. Hypothesis: $a_n > 0$ and $b_n > 0$, and $L = \lim a_n/b_n$ exists with $0 < L < \infty$. Conclusion: both series converge or both diverge. If $L = 0$, only "$\sum b_n$ converges implies $\sum a_n$ converges" survives; if $L = \infty$, only "$\sum b_n$ diverges implies $\sum a_n$ diverges" survives. With $b_n = 1/n$ and $a_n = 1/n^2$ we get $L = 0$ and $\sum b_n$ diverges, so nothing follows, and indeed $\sum a_n$ converges. Swap the roles to get $L = \infty$ with the same moral.

### The alternating series test

Hypotheses: the series is $\sum (-1)^n b_n$ with $b_n \ge 0$, $b_n$ is decreasing (at least from some index $n_0$ on), and $b_n \to 0$. Conclusion: the series converges, and the remainder satisfies $\lvert R_N \rvert \le b_{N+1}$ for every $N$ with $N+1 \ge n_0$, that is, once the monotonicity has started. All three conditions are needed. Without $b_n \to 0$ the divergence test kills the series. Without monotonicity the conclusion can fail even when $b_n \to 0$ (see Example 4).

### The ratio and root tests

Ratio test. Hypothesis: $a_n \ne 0$ eventually and $L = \lim \lvert a_{n+1}/a_n \rvert$ exists (possibly $\infty$). If $L < 1$ the series converges absolutely; if $L > 1$ (or $L = \infty$) it diverges; if $L = 1$ the test is inconclusive.

Root test. Hypothesis: $L = \limsup \lvert a_n \rvert^{1/n}$, which always exists in $[0,\infty]$. The three cases are the same as for the ratio test, and again $L = 1$ is inconclusive. Whenever the ratio limit exists, the root limit exists and equals it, so the root test is never weaker; it also handles series where the ratio has no limit.

Both tests are blind at $L = 1$ because a limit below $1$ means geometric decay, and $L = 1$ covers every decay slower than any geometric rate. That includes polynomial decay, but also $e^{-\sqrt n}$ (faster than any polynomial, yet $L=1$) and $1/\ln n$ (slower than any polynomial). For $\sum 1/n$ and $\sum 1/n^2$ the ratio tends to $1$ in both cases, yet one diverges and the other converges.

### Absolute and conditional convergence

If $\sum \lvert a_n \rvert$ converges, then $\sum a_n$ converges (absolute convergence implies convergence). The converse fails: $\sum (-1)^{n+1}/n$ converges by the alternating series test, but $\sum 1/n$ diverges, so the convergence is only conditional.

The distinction has teeth. If a series converges absolutely, every rearrangement has the same sum. If it converges only conditionally, Riemann's rearrangement theorem says rearrangements can be made to sum to any real number, or to diverge. Addition of infinitely many terms is not commutative.

### Choosing a test

| Look for | Try |
| --- | --- |
| $a_n \not\to 0$ is plausible | divergence test first |
| factorials, exponentials, or n-th powers | ratio test, or root test for n-th powers |
| rational or algebraic in n | limit comparison with a p-series |
| $f(n)$ with an easy antiderivative (logs, $1/(x\ln x)$) | integral test |
| signs alternate | alternating series test; then check $\sum \lvert a_n \rvert$ |
| ratio or root test gives 1 | comparison or integral test |

## Worked Examples

### Example 1: the ratio test, and a sum that is exactly 2

For $\sum_{n\ge1} n/2^n$, the ratio is $\frac{(n+1)/2^{n+1}}{n/2^n} = \frac{n+1}{2n} \to \tfrac12 < 1$, so the series converges. Its sum is $2$. The partial sums $S_5 = 1.78125$, $S_{10} = 1.98828\ldots$, and $S_{20} = 1.99998\ldots$ approach it quickly, as a ratio of $\tfrac12$ predicts. This is the series behind the linear-time heap build.

### Example 2: limit comparison

For $\sum (n+1)/(n^3+5)$, compare with $b_n = 1/n^2$. Then $a_n/b_n = n^2(n+1)/(n^3+5) \to 1$, a finite positive limit, and $\sum 1/n^2$ converges, so the series converges. A numerical check agrees with the limit: the ratio is $1.0945$ at $n=10$, $1.0100$ at $n=100$, and $1.0010$ at $n=1000$. The series sums to about $1.0039$.

### Example 3: the integral test and its error bound

For $\sum 1/n^2$, take $f(x) = 1/x^2$, which is continuous, positive, and decreasing on $[1,\infty)$. After $N = 10$ terms, $S_{10} = 1.549768$, and the remainder bound gives $S_{10} + \tfrac1{11} \le S \le S_{10} + \tfrac1{10}$, that is, $1.6407 \le S \le 1.6498$. The true sum is $\pi^2/6 = 1.644934$, inside the window. To guarantee an error below $10^{-3}$ using only the upper bound, take $N = 1000$; the actual error there is $0.0009995$, just below the guarantee.

### Example 4: the alternating series test, and what happens without monotonicity

The alternating harmonic series $\sum (-1)^{n+1}/n$ meets all three hypotheses with $b_n = 1/n$, and it converges to $\ln 2 = 0.693147$. The bound $\lvert R_N\rvert \le 1/(N+1)$ is honest but conservative: for $N = 999$ it promises $0.001$, while the actual error is $0.0005$. The bound needs $999$ terms to guarantee $0.001$, while the actual error first drops to $0.001$ near $N=500$. The slow convergence is the point: a single digit of accuracy per tenfold increase in terms.

Now take $\sum_{n\ge2} \dfrac{(-1)^n}{\sqrt n + (-1)^n}$ (it starts at $n=2$ because the $n=1$ denominator is $0$). Here $b_n = 1/(\sqrt n + (-1)^n) \to 0$, but $b_2 = 0.414$ and $b_3 = 1.366$, so $b_n$ is not decreasing. The test does not apply, and the series diverges: rationalizing the denominator splits the term into $(-1)^n\sqrt n/(n-1) - 1/(n-1)$. The first part converges by the alternating test and the second is a harmonic tail. The partial sums behave like $-\ln N$: $-4.21$ at $N=10^2$, $-8.87$ at $N=10^4$, and $-13.48$ at $N=10^6$, against $-4.61$, $-9.21$, and $-13.82$ for $-\ln N$ (the difference settles near $0.34$). Dropping one hypothesis flipped the conclusion.

### Example 5: when the ratio test says nothing and the root test decides

Let $a_n = 2^{-(n + (-1)^n)}$, with terms $1, \tfrac18, \tfrac14, \tfrac1{32}, \tfrac1{16}, \ldots$. The ratios $a_{n+1}/a_n$ alternate between $\tfrac18$ and $2$, so the limit does not exist and the ratio test as stated does not apply. (Even the limsup/liminf version of the test is inconclusive: it needs $\limsup < 1$ to converge or $\liminf > 1$ to diverge, and here $\limsup = 2$ and $\liminf = \tfrac18$.) The root test gives $\lvert a_n\rvert^{1/n} = 2^{-1-(-1)^n/n} \to \tfrac12 < 1$, so the series converges, and it sums to exactly $\tfrac32$.

### Example 6: a conditionally convergent series rearranged

Take the alternating harmonic series and reorder it as two positive terms followed by one negative one: $1 + \tfrac13 - \tfrac12 + \tfrac15 + \tfrac17 - \tfrac14 + \cdots$. It uses exactly the same terms, but its sum is $\tfrac32\ln 2 \approx 1.03972$ instead of $\ln 2 \approx 0.69315$. A script summing the first million groups of this ordering gives $1.0397205$.

### Example 7: when partial sums mislead

$\sum_{n\ge2} 1/(n\ln n)$: with $f(x) = 1/(x\ln x)$, $\int_2^\infty f = \lim_{M\to\infty}\ln\ln M - \ln\ln 2 = \infty$, so the series diverges, and so does the sum up to $N$, which tracks $\ln\ln N$ plus a constant. At $N = 10^7$, $\ln\ln N = 2.78$ and the partial sum is $3.57$. In contrast, $\sum 1/(n\ln^2 n)$ converges (the integral is $1/\ln 2$ from $x=2$), and its sum is $2.1097$ (computed with an Euler-Maclaurin tail; the convergence is so slow that the partial sum at $N=10^7$ is only $2.0477$). A ratio test is useless for both, because the ratio of consecutive terms tends to $1$.

## Common Misconceptions & Pitfalls

- **"If $a_n \to 0$, the series converges."** Only the converse holds. The harmonic series is the standard counterexample, and $1/(n\ln n)$ shows how slowly the divergence can show up.
- **"The ratio test gave $L=1$, so the series diverges (or converges)."** At $L=1$ the test says nothing. Switch to comparison or the integral test.
- **"Comparison goes either way."** A series smaller than a divergent one, or larger than a convergent one, tells you nothing. Check the direction, and check that all terms are nonnegative.
- **"Alternating signs with $b_n \to 0$ is enough."** Monotonicity is a hypothesis. Example 4 diverges despite $b_n \to 0$.
- **"A partial sum that has stopped changing means convergence."** Partial sums of divergent series can move by less than any displayed precision for a long time.
- **"Rearranging terms is harmless."** It is harmless only for absolutely convergent series.

## Summary

The divergence test only detects divergence. The integral, comparison, limit comparison, ratio, and root tests apply to series whose terms are (eventually) positive or considered in absolute value. The integral test decides whenever its hypotheses hold, the comparison tests say nothing when the inequality points the wrong way (or when $L=0$ or $L=\infty$), and the ratio and root tests say nothing at $L=1$. The alternating series test needs $b_n$ decreasing to $0$, and then gives both convergence and the bound $\lvert R_N \rvert \le b_{N+1}$; the integral test gives two-sided remainder bounds. Absolute convergence is the safe case: it implies convergence and allows free rearrangement, while conditional convergence does not. The next lesson, `power-series-and-the-radius-of-convergence`, applies the ratio and root tests to series with a variable $x$, where they decide an interval of convergence and the endpoints are settled with the other tests from this lesson.

## Documentation Links

- [OpenStax Calculus Volume 2, 5.3 The Divergence and Integral Tests](https://openstax.org/books/calculus-volume-2/pages/5-3-the-divergence-and-integral-tests): divergence test, integral test, $p$-series, and remainder estimates.
- [OpenStax Calculus Volume 2, 5.4 Comparison Tests](https://openstax.org/books/calculus-volume-2/pages/5-4-comparison-tests): direct and limit comparison, with examples.
- [OpenStax Calculus Volume 2, 5.5 Alternating Series](https://openstax.org/books/calculus-volume-2/pages/5-5-alternating-series): alternating series test, remainder bound, absolute and conditional convergence.
- [OpenStax Calculus Volume 2, 5.6 Ratio and Root Tests](https://openstax.org/books/calculus-volume-2/pages/5-6-ratio-and-root-tests): ratio and root tests and a strategy for choosing among the tests.
- [MIT OpenCourseWare 18.01SC, Session 95: Series Comparison](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-95-series-comparison/): comparing series with integrals and with known series.
