---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the bracketing guarantee of bisection with its hypotheses, and say what it does not promise.
- Compute the exact iteration count for a tolerance, distinguish iterations from function evaluations, and check the count against `scipy.optimize.bisect`.
- Measure bisection's convergence, and explain why the bracket width halves exactly while the error does not.
- Choose among width, relative width, residual and iteration-cap stopping tests, and say what each one certifies.
- Predict the attainable accuracy from conditioning, and recognize where rounding ends convergence.

## Context & Motivation

`guess-and-check-and-bisection-search` builds the loop, and `continuity-and-the-intermediate-value-theorem` explains why a root is inside the bracket, shows a sign change at a pole, and traces how doubles run out. Neither answers the questions an engineer asks of a numerical method. How many iterations does a tolerance cost, exactly? What does the stopping test actually certify? How accurate can the answer be, given the conditioning from `conditioning-and-numerical-stability`?

The running example is the **internal rate of return** (IRR), the function behind the spreadsheet of the same name. Cash flows $c_0, \ldots, c_N$ at years $0, \ldots, N$ have net present value $\operatorname{NPV}(r) = \sum_t c_t (1+r)^{-t}$, and the IRR is a root of it. In general there is no closed form. Bisection is slow, but it asks only for a sign change, which is why solvers such as Brent's keep it as a safety net.

## Core Theory

### The method and its guarantee

**Hypotheses.** $f$ is continuous on $[a, b]$, and $f(a)$ and $f(b)$ are nonzero with opposite signs.

**Method.** Set $[a_0, b_0] = [a, b]$. For $n \ge 1$ let $m_n$ be the midpoint of $[a_{n-1}, b_{n-1}]$. If $f(m_n) = 0$, stop. Otherwise $[a_n, b_n]$ is the half whose endpoints have opposite signs.

**Conclusion.** The Intermediate Value Theorem places a root in every bracket. The nested brackets shrink to one point $r$, and continuity forces $f(r) = 0$. For every $n$,

$$b_n - a_n = \frac{b-a}{2^n}, \qquad \lvert m_n - r\rvert \le \frac{b-a}{2^n}.$$

Each iteration costs one evaluation of $f$ and needs no derivative. The guarantee does not say the root is unique, nor which root is found.

### Counting iterations

The bracket width reaches a tolerance $\tau$ at the smallest $n$ with $(b-a)2^{-n} \le \tau$:

$$n = \left\lceil \log_2\frac{b-a}{\tau} \right\rceil.$$

This count is unusual among numerical methods: it does not depend on $f$, except that an exact hit $f(m_n) = 0$ ends the run early. Function evaluations number $n + 2$, because the two endpoints are checked first. Each decimal digit costs $\log_2 10 \approx 3.32$ iterations.

### Linear convergence, stated carefully

A sequence with errors $e_n$ converges **linearly** with rate $0 < \rho < 1$ when $e_{n+1}/e_n$ tends to $\rho$. The bound $E_n = (b-a)2^{-n}$ satisfies $E_{n+1} = E_n/2$ exactly. The true error $e_n = \lvert m_n - r\rvert$ in general does not, because a midpoint can land close to $r$ by luck and the next one farther away. So rate $\tfrac12$ describes the bound that dominates the error, one binary digit per iteration on average, and not a ratio observed at each step. `secant-method-and-order-of-convergence` makes order of convergence formal.

### Stopping criteria

| Test | Certifies | Weakness |
|---|---|---|
| Width: $b - a \le \tau$ | $r$ within $\tau$, if the signs are right | Means little if $r$ is much smaller than $\tau$; may never end if $\tau$ is below the float spacing at $r$ |
| Relative width: $b - a \le \tau\lvert m\rvert$ | Digits of $r$ | Cannot be met when $r = 0$ |
| Residual: $\lvert f(m)\rvert \le \tau$ | $m$ is an exact root of $f - f(m)$ | Depends on the units of $f$ |
| Iteration cap | The loop ends | Nothing about accuracy |

Real code combines them. `scipy.optimize.bisect` takes `xtol`, `rtol` and `maxiter`, with defaults $2\times10^{-12}$, $4\epsilon$ and $100$, and documents the result as satisfying `np.isclose(x, x0, atol=xtol, rtol=rtol)`. Its default `xtol` is an absolute test: on $f(x) = x - 10^{-12}$ over $[0, 1]$ it reports success at $1.8\times10^{-12}$, an 82 percent relative error, while `xtol=1e-20` gives $1.0000000028\times10^{-12}$ in 67 iterations.

### Residual, width and conditioning

Width bounds the forward error. The residual is the backward error: $m$ solves $f(x) - f(m) = 0$ exactly. For a simple root ($f'(r) \ne 0$ with $f'$ continuous nearby), first-order expansion links them, $\lvert m - r\rvert \approx \lvert f(m)\rvert/\lvert f'(r)\rvert$, so $1/\lvert f'(r)\rvert$ is the absolute condition number of the root.

This also sets the accuracy floor. If computed values of $f$ carry noise of size $\delta$, signs are trustworthy only where $\lvert f\rvert > \delta$, so near a simple root the zone of doubt has half-width about $\delta/\lvert f'(r)\rvert$. Inside it the bracket keeps halving around a computed sign change, and its width no longer measures the error.

## Worked Examples

### Example 1: an IRR to $10^{-8}$

Take cash flows $-1000, 300, 420, 680$. $\operatorname{NPV}$ is continuous on $(-1, \infty)$, with $\operatorname{NPV}(0) = 400$ and $\operatorname{NPV}(1) = -660$. Substituting $v = 1/(1+r)$ gives a cubic with one sign change in its coefficients, so by Descartes' rule there is exactly one root with $r > -1$: $r = 0.16340560068899$. For $\tau = 10^{-8}$, $n = \lceil\log_2 10^8\rceil = 27$. The run, with the bound $2^{-n}$ beside the true error:

```text
n    m_n          f(m_n)      e_n        2^-n       e_n/e_(n-1)
1    0.5          -4.12e+02   3.37e-01   5.00e-01
2    0.25         -1.43e+02   8.66e-02   2.50e-01   0.26
3    0.125        +7.61e+01   3.84e-02   1.25e-01   0.44
4    0.1875       -4.35e+01   2.41e-02   6.25e-02   0.63
5    0.15625      +1.35e+01   7.16e-03   3.13e-02   0.30
6    0.171875     -1.56e+01   8.47e-03   1.56e-02   1.18
7    0.1640625    -1.23e+00   6.57e-04   7.81e-03   0.08
8    0.16015625   +6.10e+00   3.25e-03   3.91e-03   4.95
...
26   0.16340561   -2.13e-05   1.14e-08   1.49e-08   0.43
27   0.16340560   -7.42e-06   3.97e-09   7.45e-09   0.35
```

The bound holds at every row. The error rises in 7 of the 26 transitions, and yet the fitted slope of $\log_2 e_n$ against $n$ is $-0.993$, and the geometric mean of the ratios is $0.496$. The method spent 29 evaluations. `scipy.optimize.bisect(npv, 0, 1, xtol=1e-8)` reports 27 iterations and 29 function calls and returns the same $m_{27}$. With the same `xtol`, `scipy.optimize.brentq` uses 9 calls and lands within $1.0\times10^{-11}$ of $r$.

### Example 2: the residual test depends on units

Express the same cash flows at different scales and stop on $\lvert f(m)\rvert < 0.01$, or on width $10^{-8}$:

```text
scale of cash flows   iterations, residual test   error in r   iterations, width test
0.001                 7                           6.57e-04     27
1                     16                          7.71e-07     27
1000                  24                          3.48e-09     27
1000000               36                          1.15e-12     27
```

The same rate of return, the same test, and an error that changes by eight orders of magnitude. The width test does not notice the scale. At scale $1$, $\lvert f'(r)\rvert = 1868.6$, and the stopping residual $0.00144$ predicts an error of $7.7\times10^{-7}$, matching the table. A residual test is right when $f$ itself has meaning, as in "the books balance within $0.01$", and wrong as a proxy for digits of $r$.

### Example 3: where convergence stops

Run the IRR to the end of the floats, stopping when the midpoint equals an endpoint:

```text
format    halvings   final width   true error
float64   55         2.8e-17       5.4e-17
float32   26         1.5e-08       3.5e-09
```

The count is 55 and not 53, as it is for the root near $0.74$ in `continuity-and-the-intermediate-value-theorem`, because near $0.163$ the double spacing is $2^{-55}$. In general the count is about $\log_2((b-a)/\text{spacing at } r)$. In float64 the true error is twice the final width, so $r$ lies outside the final bracket. This is the noise floor at work: on the 801 consecutive doubles centered on $r$ the computed NPV is off by up to $3.0\times10^{-13}$, which over $1868.6$ gives a zone of $1.6\times10^{-16}$, a few float spacings, and inside it computed signs can be wrong. These results depend on how NPV is written. The table evaluates it term by term, and in float64 Horner's rule in $1/(1+r)$ hits an exact `0.0` after 46 iterations instead, with error $5.7\times10^{-17}$.

Now take an ill-conditioned root. $(x-1)^7$ has $f'(1) = 0$, and its expanded form is evaluated by Horner's rule:

```text
bracket        midpoints  final width   result       true error
[0.8, 1.1]     7          4.7e-03       0.99453125   5.5e-03
[0.9, 1.4]     15         3.1e-05       0.99248352   7.5e-03
[0.7, 1.2]     21         4.8e-07       0.99500604   5.0e-03
[0.95, 1.02]   47         1.1e-15       1.00734781   7.3e-03
```

Every run stops because Horner returns exactly `0.0`, a rounding coincidence and not a root. That last midpoint ends the run before the bracket is halved, so $n$ midpoints leave a width of about $(b-a)/2^{n-1}$. The last row reports a width near $10^{-15}$ with an error more than $10^{12}$ times larger. On a grid of 600,001 points in $[0.97, 1.03]$ the computed sign flips 73,860 times, between $0.99098$ and $1.00909$. On the 100,000 grid points with $\lvert x-1\rvert < 0.005$ the largest computed $\lvert f\rvert$ is $6.7\times10^{-15}$, all noise, since the true value there is below $7.9\times10^{-17}$. And $\lvert x-1\rvert^7$ equals that at $\lvert x-1\rvert = 0.0094$, which is the predicted zone. `scipy.optimize.bisect` and `brentq` on the last bracket return $1.00731$ and $0.99775$, so a better solver does not help. Bisection on the factored form `(x - 1)**7` returns exactly $1.0$ on all four brackets: the problem was the representation of $f$.

### Example 4: missing hypotheses

*Two roots, no sign change.* Cash flows $-1000, 2300, -1320$ have IRRs of 10 and 20 percent, but $\operatorname{NPV}(0) = -20$ and $\operatorname{NPV}(1) = -180$. `scipy.optimize.bisect` raises `ValueError` on $[0, 1]$. On $[0, 0.15]$ and $[0.15, 1]$ it finds each root. A sign change is sufficient for a root, not necessary, and an even number of roots hides from it.

*A pole.* `scipy.optimize.bisect(math.tan, 1, 2)` reports convergence after 39 iterations at $1.5707963267941$, where $\tan$ equals $1.3\times10^{12}$. Continuity fails, as for $1/x$ in `continuity-and-the-intermediate-value-theorem`, and the width test cannot see that. A check of $\lvert f\rvert$ at the end can.

## Common Misconceptions & Pitfalls

- **"Linear convergence means the error halves each step."** The bound does. In Example 1 the error once grew by a factor of $8.9$, between $n = 16$ and $n = 17$.
- **"Testing `f(a) * f(m) < 0` is the same as comparing signs."** With $f(x) = 10^{-200}(x - 0.3)$ the product underflows to `-0.0`, the test is always false, and the loop converges to $1.0$. Comparing signs directly gives $0.3$.
- **"`(a + b) / 2` is always safe."** It overflows when $a$ and $b$ are huge with the same sign: `1.6e308 + 1.7e308` gives `inf`. `a + (b - a) / 2` fixes that case and fails on the opposite one: with `a = -1.7e308` and `b = 1.7e308`, `b - a` overflows and the result is `inf`, while `(a + b) / 2` gives `0.0`. A bracket that straddles zero is the normal case for a root near $0$, so neither spelling is safe for every bracket at this scale. `a / 2 + b / 2` handles both cases, at the cost of rounding when the endpoints are subnormal.
- **"Width below tolerance means the answer is that good."** Only if the computed signs are right, which Example 3 shows can fail.
- **"A relative test handles every root."** With only a relative test, $f(x) = x$ on $[-1, 2]$ has no exit until the floats run out, after 1076 iterations down through the subnormals to `5e-324`. A root at $0$ needs an absolute floor.
- **"Bisection is obsolete."** SciPy's documentation rates `brentq` generally the best of its rootfinding routines, and describes it as combining bracketing, bisection and inverse quadratic interpolation. Bisection survives inside it, and plain bisection is still a method whose cost can be stated before running it.

## Summary

For continuous $f$ with a sign change on $[a, b]$, bisection keeps a root in a bracket of width $(b-a)2^{-n}$, using one evaluation per iteration, and needs $\lceil\log_2((b-a)/\tau)\rceil$ iterations for width $\tau$ regardless of $f$. The rate $\tfrac12$ belongs to the bound: the true error can rise from one step to the next while averaging one bit per iteration. Width controls forward error, residual controls backward error, and $1/\lvert f'(r)\rvert$ links them near a simple root. Absolute tests fail for tiny roots, relative tests fail at zero, residual tests depend on units, and a cap only ends the loop. Rounding ends convergence at the float spacing for a well-conditioned root, and much earlier for an ill-conditioned one, where bracket width stops measuring error.

## Documentation Links

- [SciPy documentation, scipy.optimize.bisect](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.bisect.html): parameters, default tolerances, and the meaning of `xtol` and `rtol`.
- [SciPy documentation, scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): Brent's method as a bracketing solver.
- [Fundamentals of Numerical Computation, 4.1 The rootfinding problem](https://fncbook.com/rootproblem): conditioning of a root, the residual as backward error, and multiple roots.
- [MIT OpenCourseWare 18.330, Lecture Notes: Nonlinear Equations](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter4/): bisection, its guarantee, and its linear convergence next to faster methods.
- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): underflow, denormalized numbers, and the rounding behind the traps above.
