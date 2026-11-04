---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Rewrite $f(x) = 0$ as $x = g(x)$ in more than one way, and run the iteration $x_{n+1} = g(x_n)$.
- State the contraction theorem with all its hypotheses, prove convergence with the Mean Value Theorem, and show by example what each hypothesis contributes.
- Predict the linear rate $\lvert g'(r)\rvert$ and measure it, and classify a fixed point as attracting, repelling, or undecided.
- Explain why rewriting the same equation changes the outcome, and use relaxation to repair a failing iteration.
- Turn a step size into an error estimate, and recognize the point where rounding stops the iteration.

## Context & Motivation

`bisection-and-convergence-rate` buys one bit per evaluation and asks only for a sign change, and that sign test has no direct analogue for a system of equations. A broader pattern underlies much of iterative computing: turn the problem into $x = g(x)$ and apply $g$ repeatedly. `newtons-method` is one such $g$. `iterative-methods-jacobi-and-gauss-seidel` applies the pattern to linear systems. The update in `value-iteration-and-policy-iteration` is another: with discount $\gamma < 1$, the Bellman update is a contraction by factor $\gamma$ in the maximum norm, which is why the values settle.

The whole subject turns on one number. Near a solution, $g$ behaves like a line of slope $g'(r)$, and each step multiplies the error by that slope. Slope below $1$ in size means convergence, above $1$ means escape, and the slope depends on how the equation was written, not only on which equation it is.

## Core Theory

### From roots to fixed points

A **fixed point** of $g$ is a number $r$ with $g(r) = r$. Graphically it is a crossing of $y = g(x)$ with $y = x$. Any equation $f(x) = 0$ can be written this way, for example as $g(x) = x - \lambda f(x)$ with $\lambda \ne 0$, whose fixed points are exactly the roots of $f$. Other rearrangements are possible too, and they may change the domain.

### The contraction theorem

Let $g$ be continuous on $[a, b]$ and differentiable on $(a, b)$.

**Existence.** If $g$ maps $[a, b]$ into itself, $g$ has a fixed point there. Let $h(x) = g(x) - x$. Then $h(a) \ge 0$ and $h(b) \le 0$, and the Intermediate Value Theorem applies.

**Uniqueness and convergence.** If also $\lvert g'(x)\rvert \le L < 1$ on $(a, b)$, the fixed point $r$ is unique and every $x_0 \in [a, b]$ gives a sequence with

$$\lvert x_n - r\rvert \le L^n\lvert x_0 - r\rvert, \qquad \lvert x_n - r\rvert \le \frac{L^n}{1-L}\lvert x_1 - x_0\rvert, \qquad \lvert x_n - r\rvert \le \frac{L}{1-L}\lvert x_n - x_{n-1}\rvert.$$

The proof is the Mean Value Theorem (`the-mean-value-theorem-and-monotonicity`): $\lvert x_{n+1} - r\rvert = \lvert g(x_n) - g(r)\rvert = \lvert g'(\xi_n)\rvert\,\lvert x_n - r\rvert \le L\lvert x_n - r\rvert$, and the mapping hypothesis keeps every $x_n$ in the interval. The other two bounds follow from the triangle inequality.

Dropping a hypothesis costs something specific:

- **Continuity.** $g(x) = 1$ for $x \le \tfrac12$ and $g(x) = 0$ for $x > \tfrac12$ maps $[0, 1]$ into itself and has no fixed point. From $x_0 = 0.3$ the iterates alternate between $1$ and $0$.
- **Mapping into the interval.** $g(x) = \tfrac12 x + 2$ on $[0, 1]$ has $\lvert g'\rvert = \tfrac12$ and no fixed point there, because its fixed point $4$ lies outside.
- **A slope bound.** $g(x) = x^2$ on $[0, 1]$ maps the interval into itself, but $g'$ reaches $2$, and both $0$ and $1$ are fixed, so uniqueness is gone.
- **A uniform $L < 1$.** On a bounded $[a, b]$, asking only $\lvert g'(x)\rvert < 1$ at each point still gives uniqueness and convergence. What disappears is the rate $L^n$. $g(x) = \sin x$ on $[0, 1]$ has $g'(x) = \cos x < 1$ on $(0, 1)$, but $\cos x \to 1$ at $0$, so no $L$ works, and from $x_0 = 1$ it reaches only $x_{10^6} = 1.73\times10^{-3}$, tracking $\sqrt{3/n}$. On an unbounded interval even existence can fail. $g(x) = x + 1/x$ on $[1, \infty)$ maps the interval into itself with $0 \le g'(x) < 1$ and has no fixed point. From $x_0 = 1$, $x_{10000} = 141.44$, tracking $\sqrt{2n} = 141.42$.
- **Differentiability.** This one is a convenience. The proof uses only $\lvert g(x) - g(y)\rvert \le L\lvert x - y\rvert$, which $g(x) = \lvert x\rvert/2$ on $[-1, 1]$ satisfies with $L = \tfrac12$ despite the corner at $0$.
- **Global versus local.** $g(x) = x^2$ has an attracting fixed point at $0$ and a repelling one at $1$. From $x_0 = 0.9$ the iterates reach $1.9\times10^{-12}$ in 8 steps. From $x_0 = 1.1$ they reach $3.9\times10^{10}$.

### Behavior near a fixed point

If $g'$ is continuous near $r$ and $\lvert g'(r)\rvert < 1$, then some interval around $r$ satisfies the theorem, so the iteration converges for $x_0$ close enough. If in addition $g'(r) \ne 0$ and no iterate lands on $r$, then

$$\frac{\lvert x_{n+1} - r\rvert}{\lvert x_n - r\rvert} \longrightarrow \lvert g'(r)\rvert.$$

Convergence is linear with rate $\rho = \lvert g'(r)\rvert$, giving $\log_2(1/\rho)$ bits per iteration. Per evaluation, that beats bisection's one bit only when $\rho < \tfrac12$. Positive slope approaches from one side, and negative slope alternates around $r$. The other cases:

- $\lvert g'(r)\rvert > 1$: repelling. The sequence cannot converge to $r$ unless it lands on it exactly. It need not blow up: $g(x) = 3.2x(1-x)$ has $r = 0.6875$ with $g'(r) = -1.2$, and iterates from $0.3$ settle into the 2-cycle $0.5130, 0.7995$.
- $\lvert g'(r)\rvert = 1$: this test decides nothing. $\sin x$ converges to $0$ very slowly, while $x + x^3$ escapes from $0$ (from $x_0 = 0.1$ it passes $10^6$ at step 57).
- $g'(r) = 0$ with $g''$ continuous: at least second order, $e_{n+1} \approx \tfrac12\lvert g''(r)\rvert e_n^2$.

### Rewriting and relaxation

Two rearrangements of one equation share roots but generally not slopes. If $g$ has an inverse near $r$, then $g^{-1}$ has the same fixed point with slope $1/g'(r)$, so inverting swaps attracting and repelling. **Relaxation** adjusts the slope directly:

$$g_\omega(x) = (1-\omega)x + \omega\, g(x), \qquad \omega \ne 0,$$

keeps the fixed points and has $g_\omega'(r) = 1 - \omega + \omega g'(r)$, which vanishes at $\omega = 1/(1 - g'(r))$ when $g'(r) \ne 1$.

### Stopping and rounding

Near $r$, linearizing gives

$$\lvert x_{n+1} - r\rvert \approx \frac{\lvert g'(r)\rvert}{\lvert 1 - g'(r)\rvert}\,\lvert x_{n+1} - x_n\rvert.$$

A slope near $+1$ makes that factor large, so a small step does not mean a small error, while a slope near $-1$ makes it about $\tfrac12$. The ratio of successive steps estimates the slope. Noise of size $\delta$ in evaluating $g$ shifts the fixed point by about $\delta/\lvert 1 - g'(r)\rvert$, which is the conditioning of the fixed-point problem.

## Worked Examples

### Example 1: one equation, three iterations

Solve $x = e^{-x}$, with root $r = 0.5671432904$.

**(a) $g_1(x) = e^{-x}$.** It maps $[0.4, 0.7]$ into $[0.4966, 0.6703]$, with $\lvert g_1'\rvert \le 0.6703$ there, so the theorem applies. The predicted rate is $\lvert g_1'(r)\rvert = r = 0.5671$. From $x_0 = 0.5$:

```text
n    x_n                  e_n        e_n/e_(n-1)
0    0.5                  6.71e-02
1    0.6065306597126334   3.94e-02   0.5866
2    0.545239211892605    2.19e-02   0.5561
5    0.5711721489772151   4.03e-03   0.5692
10   0.5669072129354714   2.36e-04   0.5670
20   0.5671424775509449   8.13e-07   0.5671
30   0.5671432876111684   2.80e-09   0.5671
50   0.5671432904097508   3.31e-14   0.5663
62   0.5671432904097838   3.29e-17
```

The error first drops below $10^{-10}$ at $n = 36$, as $\ln(10^{-10}/0.0671)/\ln 0.5671 = 35.8$ predicts. At $n = 62$ the iterate stops changing. The rate $0.5671$ is $0.82$ bits per iteration against bisection's $1$, and here the two come out about even: bisection on $[0, 1]$ reaches width $10^{-10}$ in 34 iterations plus 2 endpoint evaluations, from a wider start. The stopping quantities differ, so this comparison is only rough. In float32 the iteration never settles on one value: from $x_{25}$ on it alternates between the adjacent floats $0.56714332$ and $0.56714326$, with error about $3\times10^{-8}$.

**(b) $g_2(x) = -\ln x$.** This is the inverse of $g_1$, with slope $-1/r = -1.7632$, and it needs $x > 0$. From $0.5$ it gives $0.6931$, $0.3665$, $1.0037$, $-0.0037$, and the next step leaves the domain. Starting much closer, at $0.5671$, the error $4.3\times10^{-5}$ grows by a measured $1.763$ per step, and $x_{18} = -0.40$ fails the same way.

**(c) Relaxed $g_2$.** Take $\omega = 1/(1 + 1/r) = 0.36190$, so that $g_\omega'(r) = 0$. The errors are $6.71\times10^{-2}$, $2.76\times10^{-3}$, $4.26\times10^{-6}$, $1.02\times10^{-11}$, $3.29\times10^{-17}$. The ratios $e_{n+1}/e_n^2$ are $0.611$, $0.561$, $0.563$, against $\tfrac12 g_\omega''(r) = \omega/(2r^2) = 0.5626$. Choosing $\omega$ this way requires knowing $r$. With $\omega = 0.5$ the slope is $-0.38$, and the same iteration is merely linear. Recomputing $\omega$ from the current $x$ at each step gives Newton's method on $x + \ln x$, the subject of `newtons-method`.

### Example 2: Kepler's equation

The position of a body on an elliptical orbit comes from $E - e\sin E = M$, with eccentricity $0 \le e < 1$ and mean anomaly $M$. Take $g(E) = M + e\sin E$. It maps $[M-e, M+e]$ into itself, and $\lvert g'(E)\rvert = \lvert e\cos E\rvert \le e$, so the theorem applies with $L = e$ from $E_0 = M$.

```text
e      M     E*         g'(E*)    measured rate   iterations to 1e-10   a priori bound
0.1    1.0   1.088598   +0.0464   0.0464          7                     9
0.5    1.0   1.498701   +0.0360   0.0360          8                     33
0.9    1.0   1.862087   -0.2585   0.2585          17                    238
0.97   0.2   1.033148   +0.4968   0.4968          36                    818
```

The a priori bound is the smallest $n$ with $e^n\lvert x_1 - x_0\rvert/(1-e) \le 10^{-10}$. It holds in every row and is badly pessimistic for large $e$, because $L = e$ is the worst slope anywhere, while the rate depends on the slope at the root. A run of `scipy.optimize.brentq` on $[0, \pi]$ agrees with each $E^*$ to better than $4\times10^{-13}$.

### Example 3: a small step, a large error

Take $e = 0.999$ and $M = 0.002$, so $E^* = 0.22045$ and $g'(E^*) = 0.97482$. Stopping when the step falls below $10^{-8}$ ends at $n = 573$ with step $9.91\times10^{-9}$ and true error $3.84\times10^{-7}$, which is 39 times the step. The factor from theory is $0.97482/0.02518 = 38.7$. Using the ratio of the last two steps as an estimate $\hat L$, the value $\hat L/(1-\hat L)$ times the step gives $3.84\times10^{-7}$, so the iteration itself supplied a sound estimate.

Run on, the iterate stops changing at $n = 1371$ with error $4.1\times10^{-16}$. For $e = 0.1$, $M = 1$ it stops at $n = 12$ with error $4.3\times10^{-17}$. The amplification $1/\lvert 1 - g'(r)\rvert$ is $39.7$ in the first case and $1.05$ in the second.

## Common Misconceptions & Pitfalls

- **"Any rearrangement works, since the roots are the same."** Example 1 has one that converges, one that fails, and one that is quadratic.
- **"$\lvert g'(r)\rvert < 1$ means convergence from anywhere."** It is a local statement, as $x^2$ from $1.1$ shows. Global convergence needs the full theorem.
- **"$\lvert g'\rvert < 1$ everywhere guarantees a fixed point."** On an unbounded interval it does not: $x + 1/x$ on $[1, \infty)$ has none. On a bounded $[a, b]$ the fixed point comes from continuity and the mapping condition, not from the slope.
- **"A small step means a small error."** With $g(x) = \sin x$ from $x_0 = 1$, after $10^6$ steps the step is $8.7\times10^{-10}$ and the error is $1.7\times10^{-3}$. Slope $1$ at the root leaves no finite factor between them.
- **"Failing to converge means diverging."** The logistic map above stays bounded in a 2-cycle.
- **"Stop when `x_new == x`."** The float32 run in Example 1 alternates forever and would never stop. Use a tolerance and an iteration cap.
- **"`scipy.optimize.fixed_point` runs this lesson's iteration."** Its default `method='del2'` uses Steffensen's method with Aitken acceleration. The plain loop is `method='iteration'`.

## Summary

Fixed-point iteration rewrites $f(x) = 0$ as $x = g(x)$ and repeats $x_{n+1} = g(x_n)$. If $g$ is continuous on $[a, b]$, maps it into itself, and satisfies $\lvert g'\rvert \le L < 1$, then the fixed point is unique, every start in the interval converges, and the error shrinks at least like $L^n$. Near a fixed point the observed rate tends to $\lvert g'(r)\rvert$, so a slope below $\tfrac12$ in size beats bisection, slope $0$ gives second order, slope above $1$ repels, and slope exactly $1$ needs a closer look. The slope belongs to the rewriting, which is why inverting or relaxing $g$ can change failure into fast convergence. The error is about $\lvert g'\rvert/\lvert 1 - g'\rvert$ times the step, which matters when the slope is near $+1$, and rounding stops the iteration near $\delta/\lvert 1 - g'(r)\rvert$.

## Documentation Links

- [Fundamentals of Numerical Computation, 4.2 Fixed-point iteration](https://fncbook.com/fixed-point): the iteration, series analysis of the error, the linear rate, and contraction mappings.
- [Fundamentals of Numerical Computation, 4.1 The rootfinding problem](https://fncbook.com/rootproblem): Kepler's equation in context, and conditioning of a root.
- [SciPy documentation, scipy.optimize.fixed_point](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.fixed_point.html): the `del2` and `iteration` methods and their parameters.
- [SciPy documentation, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): the bracketing solver used as an independent check.
