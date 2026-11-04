---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define a power series centered at $a$ and state the trichotomy for its convergence: only at $a$, on a symmetric interval around $a$, or everywhere.
- Compute the radius of convergence with the ratio or root test, and then test both endpoints separately with the tests from `convergence-tests`.
- Explain why a power series equals its "closed form" only inside the interval of convergence, even when the closed form is defined farther out.
- State when term-by-term differentiation and integration are valid, and show how the endpoint behavior can change.
- Read the radius as the exponential growth rate of the coefficients, and get it from the denominator of a generating function such as the Fibonacci one.

## Context & Motivation

A power series is a series with a variable in it:

$$\sum_{n=0}^{\infty} c_n (x-a)^n = c_0 + c_1(x-a) + c_2(x-a)^2 + \cdots$$

For each fixed $x$ this is an ordinary series of numbers, so the tests from `convergence-tests` apply. The new question is for which $x$ the series converges, because the answer defines the domain of a new function $f(x)$. Polynomials are the case where only finitely many $c_n$ are nonzero; a power series is "a polynomial of infinite degree", and many of the functions that matter in practice, such as $e^x$, $\sin x$, and $\ln(1+x)$, can be written this way. The next lesson, `taylor-and-maclaurin-series-with-error-bounds`, shows how to find the coefficients and how accurate a truncation is.

Power series matter in computing in two ways. Numerically, a truncated power series is one kind of polynomial approximation (Chebyshev, minimax, and interpolation polynomials are others), and for it the interval of convergence decides where the approximation can be trusted. Combinatorially, a sequence $c_n$ can be packaged as a generating function $\sum c_n x^n$. The radius of convergence of that function then reports how fast $c_n$ grows. For a linear recurrence the generating function is a rational function, and its radius comes from the roots of the denominator.

## Core Theory

### The convergence trichotomy

For a power series $\sum c_n (x-a)^n$, exactly one of the following holds:

1. It converges only at $x = a$ (radius $R = 0$).
2. It converges absolutely for every real $x$ (radius $R = \infty$).
3. There is a number $0 < R < \infty$ such that it converges absolutely for $\lvert x - a\rvert < R$ and diverges for $\lvert x - a\rvert > R$.

The set of $x$ where it converges is the **interval of convergence**: $(a-R, a+R)$ plus possibly one or both endpoints. The theorem is silent about the endpoints $x = a \pm R$. They have to be checked one at a time, and all four combinations occur.

### Computing the radius

Apply the ratio test to the terms of the series in $x$, not just to the coefficients. If $\lim \lvert c_{n+1}/c_n\rvert = \rho$ exists, then the terms have ratio $\rho\,\lvert x-a\rvert$, which is below $1$ exactly when $\lvert x-a\rvert < 1/\rho$, so $R = 1/\rho$ (with $R = \infty$ for $\rho = 0$ and $R = 0$ for $\rho = \infty$). The root test gives the general formula, which always applies:

$$R = \frac{1}{\limsup_{n\to\infty} \lvert c_n\rvert^{1/n}}$$

Applying the ratio test to the coefficients silently fails when infinitely many $c_n$ are zero, for instance for $\sum x^{2n+1}/(2n+1)$, where $c_{2n} = 0$. In that case, run the ratio test on the full terms, as Example 2 does.

### The endpoints

At $x = a \pm R$ the ratio and root tests give $L = 1$ and are inconclusive. Substitute the endpoint to get an ordinary series and use the divergence test, comparison, the integral test, or the alternating series test. For example, $\sum x^n$ has $R=1$ and diverges at both endpoints (the terms do not tend to $0$); $\sum x^n/n$ converges at $-1$ and diverges at $1$; $\sum x^n/n^2$ converges at both.

### A power series is a function only on its interval

Within the interval of convergence, $f(x) = \sum c_n (x-a)^n$ is a function. The geometric series is the model: $\sum_{n\ge0} x^n = \frac{1}{1-x}$ for $\lvert x\rvert < 1$. The right-hand side is defined for every $x \ne 1$, but at $x = -3$ the series is $1 - 3 + 9 - 27 + \cdots$, which diverges, even though $\frac1{1-(-3)} = \frac14$. The equality holds on the interval of convergence and nowhere else.

### Differentiating and integrating term by term

Suppose $f(x) = \sum c_n (x-a)^n$ has radius $R > 0$. Then, **for $\lvert x-a\rvert < R$ (the open interval)**, $f$ is differentiable, and

$$f'(x) = \sum_{n\ge 1} n c_n (x-a)^{n-1}, \qquad \int f(x)\,dx = C + \sum_{n\ge0} \frac{c_n}{n+1}(x-a)^{n+1}.$$

Both new series have the same radius $R$. The endpoints can change, because the factors $n$ and $1/(n+1)$ change how fast the terms decay. A power series is special here: for a general series of functions, differentiating term by term is not allowed. For $\sum \sin(nx)/n^2$, which converges for every $x$ by comparison with $\sum 1/n^2$, the differentiated series $\sum \cos(nx)/n$ is the harmonic series at $x = 0$ and diverges.

### Combining power series

Sums and constant multiples are termwise, and the result converges at least where both do inside the open intervals, so the radius is at least the smaller of the two radii. A product is computed with the Cauchy product, $\sum_n \big(\sum_{k=0}^n a_k b_{n-k}\big) x^n$, and the product has radius at least the smaller of the two radii. Convergence at an endpoint is not inherited: $a_n = (-1)^n/\sqrt{n+1}$ gives a series that converges at $x=1$, but the Cauchy square has coefficients of magnitude $\sum_{k=0}^n 1/\sqrt{(k+1)(n-k+1)}$, which is $2.29$ at $n=10$, $2.85$ at $n=100$, and $3.05$ at $n=1000$ (tending to $\pi$), so the product diverges at $x=1$. Substituting $x \mapsto x^2$ or $x \mapsto 2x$ into a series changes the interval accordingly: $\sum (2x)^n$ converges for $\lvert x\rvert < \tfrac12$. The coefficients of a power series are determined by the function: $c_n = f^{(n)}(a)/n!$ (this follows by differentiating term by term and evaluating at $a$), which is the starting point of the next lesson.

## Worked Examples

### Example 1: a shifted center and one-sided endpoints

Find the interval of convergence of $\sum_{n\ge1} \dfrac{(-1)^n (x+3)^n}{\sqrt n\,4^n}$. The ratio of consecutive terms has absolute value $\frac{\lvert x+3\rvert}{4}\sqrt{\frac{n}{n+1}} \to \frac{\lvert x+3\rvert}{4}$ (the root test gives the same $\tfrac14$ for the coefficients), so $R = 4$ and the open interval is $(-7, 1)$, centered at $-3$.

At $x = 1$ the series is $\sum (-1)^n/\sqrt n$, which converges by the alternating series test (its sum is about $-0.605$). At $x = -7$ it is $\sum 1/\sqrt n$, a $p$-series with $p=\tfrac12$, which diverges (its partial sums are $18.6$, $198.5$, and $1998.5$ after $10^2$, $10^4$, and $10^6$ terms). The interval of convergence is $(-7, 1]$. Outside it, at $x=2$ the terms $(5/4)^n/\sqrt n$ in absolute value grow without bound, so the divergence test applies.

### Example 2: converging at both endpoints, and the arctangent

Consider $\sum_{n\ge0} (-1)^n \dfrac{x^{2n+1}}{2n+1}$. Half the coefficients are zero, so run the ratio test on the terms: $\left\lvert \frac{x^{2n+3}/(2n+3)}{x^{2n+1}/(2n+1)}\right\rvert \to x^2$, which is below $1$ for $\lvert x\rvert<1$, so $R = 1$.

At $x = \pm1$ the series is $\pm\sum (-1)^n/(2n+1)$, which converges by the alternating series test, so the interval is $[-1,1]$. This series is $\arctan x$. At $x=1$ it gives $\arctan 1 = \pi/4$ (this step needs Abel's theorem: if a power series converges at an endpoint of its interval, the function value there is the limit of the series as $x$ approaches the endpoint from inside). Convergence at the endpoint is slow: the alternating bound $\lvert R_N\rvert \le 1/(2N+3)$ has the right order of magnitude, though the actual error is about half the bound. Summing through $n=10^5$ (that is, $10^5+1$ terms) leaves an error of $2.5\times10^{-6}$ against the bound $5.0\times10^{-6}$, which is why $\pi \approx 4\,(1 - \tfrac13 + \tfrac15 - \cdots)$ is a poor way to compute $\pi$. For $x = 0.5$ the same series gives $\arctan 0.5 = 0.4636476\ldots$ to about twenty digits with 31 terms (through $n=30$).

### Example 3: differentiating changes the endpoint

Let $f(x) = \sum_{n\ge1} x^n/n^2$, with interval $[-1,1]$ (at $x=1$ it is $\pi^2/6$, and at $x=-1$ it is $-\pi^2/12$, both convergent by comparison with $\sum1/n^2$). Differentiating term by term gives $f'(x) = \sum_{n\ge 1} x^{n-1}/n$, with the same radius $1$. At $x = 1$ this is the harmonic series, which diverges; at $x=-1$ it is $\sum(-1)^{n-1}/n = \ln 2$, which converges. The interval shrinks from $[-1,1]$ to $[-1,1)$.

Integrating the geometric series $\sum t^n = \frac1{1-t}$ from $0$ to $x$ gives $-\ln(1-x) = \sum_{n\ge1} x^n/n$ for $\lvert x\rvert<1$, and Abel's theorem extends it to $x=-1$, giving $-\ln 2 = -1 + \tfrac12 - \tfrac13 + \cdots$. As a numeric check, $f'(0.5) = \sum_{n\ge1}(0.5)^{n-1}/n = 1.3862944$, equal to $-\ln(0.5)/0.5$ and to a finite-difference slope of $f$.

### Example 4: the radius as growth rate (Fibonacci)

The Fibonacci numbers $F_0=0, F_1=1, F_2=1, F_3 = 2, \ldots$ satisfy $\sum_{n\ge0} F_n x^n = \dfrac{x}{1-x-x^2}$ near $x=0$ (expanding the right side gives $x + x^2 + 2x^3 + 3x^4 + 5x^5 + 8x^6 + \cdots$). The denominator factors as $1-x-x^2 = (1-\varphi x)(1-\psi x)$ with $\varphi = \frac{1+\sqrt5}{2} = 1.618034$ and $\psi = \frac{1-\sqrt5}{2} = -0.618034$, and partial fractions give

$$\frac{x}{1-x-x^2} = \frac{1}{\sqrt5}\left(\frac{1}{1-\varphi x} - \frac{1}{1-\psi x}\right).$$

Each fraction is a geometric series, convergent for $\lvert \varphi x\rvert < 1$ and $\lvert \psi x\rvert < 1$ respectively. The first one is the binding condition because $\lvert\varphi\rvert > \lvert\psi\rvert$, so $R = 1/\varphi = 0.618034$, the smallest root of the denominator in absolute value (the roots are $0.618$ and $-1.618$). Reading off coefficients gives $F_n = (\varphi^n - \psi^n)/\sqrt5$, so $F_n^{1/n} \to \varphi = 1/R$: the radius and the exponential growth rate are the same fact. The ratio test agrees, since $F_{n+1}/F_n \to \varphi$.

At the endpoints $x = \pm R$ the terms satisfy $\lvert F_n R^n\rvert = \lvert 1 - (\psi/\varphi)^n\rvert/\sqrt5 \to 1/\sqrt5 = 0.4472 \ne 0$, so by the divergence test both endpoints diverge: the interval is the open $(-0.618, 0.618)$. Inside, at $x = \tfrac12$ the series sums to $2$, matching $\frac{0.5}{1-0.5-0.25}$. Outside, at $x = 0.7$, where the formula gives $-3.68$, the partial sums run away: $9.6$ through the $x^{10}$ term, $42$ through $x^{20}$, $553$ through $x^{40}$, and $81{,}061$ through $x^{80}$.

### Example 5: the radius is not about where the function is defined

$\dfrac1{1+x^2} = \sum_{n\ge0}(-1)^n x^{2n}$ has radius $1$, although the function is smooth for every real $x$. At $x = 0.9$ the series converges ($0.5525$, matching $1/1.81$). At $x = 1.1$, where $1/(1+x^2) = 0.4525$, the partial sums are $1.63$, $-2.59$, and $-20.03$ after $5$, $10$, and $20$ terms (through $x^{8}$, $x^{18}$, and $x^{38}$), and they keep growing in magnitude. The obstruction is at $x = \pm i$, two points in the complex plane at distance $1$ from the center, which the real graph never shows. At $x=\pm1$ the terms are $(-1)^n$, which do not tend to $0$, so the divergence test applies.

## Common Misconceptions & Pitfalls

- **"The interval of convergence is $(a-R, a+R)$."** That is the interval where absolute convergence is guaranteed; whether the endpoints belong to it is a separate matter. Each endpoint is a separate question, and the ratio and root tests cannot answer it.
- **"If the function is defined at $x$, its series converges there."** Example 5 and the geometric series both disagree: the series reproduces the function only inside the interval.
- **"Applying the ratio test to the coefficients always works."** It fails when coefficients are zero infinitely often. Use the terms, or the root test formula.
- **"Differentiation preserves the interval."** The radius is preserved; the endpoints may not be (Example 3).
- **"The radius is determined by where the function has a problem on the real line."** Example 5 shows a function that is smooth on the whole line and still has radius $1$.
- **"The radius of a sum is the smaller of the two radii."** It is at least the smaller one, and can be larger: $\sum x^n - \sum x^n$ is identically $0$, with $R=\infty$.

## Summary

A power series $\sum c_n (x-a)^n$ converges on an interval centered at $a$ with radius $R = 1/\limsup\lvert c_n\rvert^{1/n}$. It converges absolutely inside, diverges outside, and each endpoint has to be tested separately (with the divergence, comparison, integral, or alternating series tests), where all four outcomes are possible. A power series equals its associated function only inside the interval. Inside the open interval it can be differentiated and integrated term by term with the same radius, but the endpoint behavior can change. The radius also measures coefficient growth, as the Fibonacci generating function shows, and it can be limited by singularities that live in the complex plane. The next lesson, `taylor-and-maclaurin-series-with-error-bounds`, builds these series from a function's derivatives and quantifies the error of cutting them off.

## Documentation Links

- [OpenStax Calculus Volume 2, 6.1 Power Series and Functions](https://openstax.org/books/calculus-volume-2/pages/6-1-power-series-and-functions): power series, radius and interval of convergence, and the convergence trichotomy.
- [OpenStax Calculus Volume 2, 6.2 Properties of Power Series](https://openstax.org/books/calculus-volume-2/pages/6-2-properties-of-power-series): combining power series and term-by-term differentiation and integration.
- [MIT OpenCourseWare 18.01SC, Session 97: Power Series](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-b-taylor-series/session-97-power-series/): power series as functions and their ranges of convergence.
