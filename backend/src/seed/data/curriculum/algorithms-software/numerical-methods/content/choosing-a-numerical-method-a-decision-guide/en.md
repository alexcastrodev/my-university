---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Decide whether a problem can be solved accurately at all, before choosing an algorithm.
- Pick a sensible first method for root finding, linear systems, fitting, integration, and differential equations.
- State what would make you switch away from that first choice.
- Read a failure from its symptoms: a small residual with a wrong answer, a stalled error, a lower order than promised, a solver taking tiny steps.

## Context & Motivation

Sixteen lessons in this discipline each studied one method and how it breaks. Real work starts from the other end. You have a problem, a library offers several routines, and something comes back that looks like a number. The useful skill is choosing a reasonable first method and recognizing when the output should not be trusted.

Two habits run through the discipline. Measure instead of assuming: the lessons here print errors, rates, and counts instead of asserting them. And separate the problem from the algorithm: `conditioning-and-numerical-stability` shows that some inaccuracy belongs to the question, and no algorithm can remove it.

## Core Theory

### Three questions before any method

**Is the problem well conditioned?** The rule of thumb from `the-matrix-condition-number` is that a condition number $\kappa$ can cost up to about $\log_{10}\kappa$ decimal digits of the roughly 16 that float64 holds. That is a ceiling and not a prediction, and a badly scaled matrix can show a huge $\kappa$ and lose nothing, so equilibrate first. When $\kappa$ is near $10^{16}$ on a well-scaled problem, changing the algorithm will not help, and you have to change the formulation or the data.

**What does the function offer?** A bracket, a derivative, smoothness, or only a black box that is expensive to call. Higher order is available only when the smoothness it assumes is there, and speed per iteration is not speed per evaluation, as `secant-method-and-order-of-convergence` shows.

**How large is it, and what structure does it have?** Dense or sparse, symmetric or not, one right-hand side or many. Structure often changes the answer more than the choice of algorithm family does.

### A first choice for each task

| Task | Start with | Switch when |
|---|---|---|
| Root of one function | `brentq` on a bracket | No bracket but a good derivative: Newton |
| Dense linear system | LU with partial pivoting | Symmetric positive definite: Cholesky |
| Large sparse system | Sparse direct solver | Memory or fill-in is the limit: iterative, with a preconditioner |
| Noisy data | Least squares by QR or `lstsq` | Outliers dominate: a robust loss |
| Exact, smooth data | Cubic spline | You choose the nodes: Chebyshev |
| Definite integral | `quad` | Known singularity or jump: split there, or pass `points` |
| Differential equation | `solve_ivp` with `RK45` and a stated `rtol` | Tiny steps on a slowly varying solution: `Radau` or `BDF` |

These are defaults, not rules. Each row is the place to start measuring.

### Reading a failure

| Symptom | Likely cause | Check |
|---|---|---|
| Small residual, wrong answer | Ill-conditioning | Compute $\kappa$ |
| Error falls, then stops or rises | Rounding floor | Compare the step with $\sqrt{\varepsilon}$ or $\varepsilon$ |
| Order lower than promised | Missing smoothness | Inspect the function, and split at the kink |
| Newton's error ratio near a constant | Multiple root | Print the ratios |
| Interpolant swings between points | Equispaced nodes, or noise | Try a spline, or a low-degree fit |
| Explicit solver crawls on a slow solution | Stiffness | Try an implicit method, and compare |
| Solver reports success, answer is off | Tolerance too loose | Tighten `rtol`, and compare |

## Worked Examples

Each example ran in NumPy 2.1.3 and SciPy 1.15.3, and the comparisons of counts are what matter. Random data uses `default_rng(0)` in Example 2 and `default_rng(1)` in Example 3, which fits with `Chebyshev.fit`.

### Example 1: a root, and the cost of speed

Find the root of $f(x)=x^3-2x-5$ near $2.0946$. There is a bracket, since $f(2)=-1$ and $f(3)=16$, and there is a derivative.

```text
Newton from x = 2.0
step  x                    error
0     2.0                  9.46e-02
1     2.1                  5.45e-03
2     2.094568121104185    1.66e-05
3     2.094551481698199    1.56e-10
4     2.0945514815423265   0.0

Newton: 5 evaluations of f and 4 of f'
brentq on [2, 3], xtol 1e-12: 8 evaluations of f
```

Newton roughly doubles the correct digits at each step, and it used 5 calls of $f$ against 8, at the price of 4 calls of $f'$. The counts are close because this is a cubic with a good start. The reason `brentq` is the default is safety: it needs no derivative, and it cannot leave the bracket. Newton earns its place when a derivative is cheap and a good start is known, as in the inner loop of an implicit solver.

### Example 2: when the problem is the problem

Solve $Ax=b$ with exact solution $x=(1,\dots,1)$ and two matrices of size 12, using `numpy.linalg.solve` on both.

```text
matrix             kappa      relative residual   relative error
Hilbert            1.7e+16    1.1e-16             0.25
Gaussian random    1.5e+02    2.2e-16             1.1e-14
```

The residuals are equally tiny, so the solver did its job on both. The Hilbert error is 25% because $\kappa\approx10^{16}$ leaves almost no correct digits. A small residual means the answer solves a nearby problem, as `conditioning-and-numerical-stability` explains. Whether that answer is close to the true one depends on $\kappa$.

### Example 3: fit or interpolate

Take 11 equispaced samples of $\sin x$ on $[0,\pi]$ with Gaussian noise of standard deviation $0.02$, and compare against the true $\sin x$ on a fine grid.

```text
                     error at the samples   max error against sin x
Degree 10 through    1.6e-15                0.121
Degree 3 fit         not zero by design     0.036
```

The interpolant matches every sample and is more than three times worse against the truth, because it fits the noise too. With noisy data the target is the underlying function, not the points. See `least-squares-curve-fitting`.

### Example 4: what an integrator pays for, and what it can miss

These are `quad` on $[0,1]$ with default tolerances.

```text
integrand                        evaluations   estimate   true error
e^x                              21            1.9e-14    2.2e-16
sqrt(x)                          231           7.4e-16    2.2e-16
jump at 1/sqrt(2)                1071          1.4e-08    5.2e-10
jump at 0.334349                 189           7.4e-16    1.0e-03
jump at 0.334349, with points    42            7.4e-15    0.0
```

Smooth integrands are cheap, and a singular derivative or a jump costs far more, because the routine has to find the trouble by bisecting. The fourth row is the one to remember. The routine returns exactly what it returns for a jump at $1/3$, because its samples cannot tell the two apart, so the answer is off by $10^{-3}$ while the estimate says $7\times10^{-16}$, with no warning. Passing the location with `points` fixes it. That only helps with features you know about: `error-orders-and-adaptive-quadrature` shows `quad` missing a narrow spike even with `points`.

### Example 5: tiny steps on a smooth solution

Solve $y'=-1000\,(y-\cos t)-\sin t$ with $y(0)=1$ on $[0,1]$. The solution is simply $\cos t$. With `rtol=1e-6` and `atol=1e-8`:

```text
method   steps   f calls   error at t=1
RK45     358     2156      2.6e-07
Radau    10      85        7.9e-10
BDF      24      58        3.0e-09
```

The calls were counted with a wrapper, because `nfev` leaves a few out for implicit methods. The solution varies slowly, so 358 steps cannot be about accuracy. The explicit method is held back by stability, which is the mark of stiffness described in `eulers-method-and-local-vs-global-error`. The implicit methods take far fewer steps here, although each one is more work on a large system, since each step solves a linear system.

### Example 6: a rate that gives the cause away

Newton on $g(x)=(x-1)^2(x+2)$ from $x=2$ converges to the double root $1$:

```text
step    error       ratio to previous
4       7.96e-02    0.512
6       2.03e-02    0.503
9       2.55e-03    0.500
```

A ratio settling at $0.5$ is linear convergence, not the quadratic rate `newtons-method` promises for a simple root. That number names the cause, since a root of multiplicity $m$ gives a ratio of $1-\frac1m$. Doubling the step to $x-2\,g(x)/g'(x)$ restores fast convergence, with the error at $6.7\times10^{-14}$ after four steps. Printing the ratios took one line.

## Common Misconceptions & Pitfalls

- **"A small residual means an accurate answer."** Example 2 has a residual of $10^{-16}$ and an error of 25%.
- **"Higher order is always better."** Order is an asymptotic claim under smoothness assumptions. On $\sqrt{x}$ a high-order rule loses its order, and Example 1 shows order 2 gaining little over a safer method on a small problem.
- **"Fitting every point is the most accurate choice."** With noise it is not, as Example 3 shows.
- **"The library handled it."** Libraries report an error estimate, not the error. Example 4 shows one wrong by twelve orders of magnitude with no warning, so check a case with a known answer.
- **"More steps always mean more accuracy."** Below a certain step, rounding takes over, as `sources-of-error-truncation-rounding-propagation` shows.
- **"Iteration beats factorization on sparse systems."** Not automatically. `iterative-methods-jacobi-and-gauss-seidel` measures a sparse direct solver winning clearly on a 2D problem.

## Summary

Ask first whether the problem is well conditioned, then what the function offers and how the data is structured. Start from a robust default: `brentq`, LU, `lstsq`, a spline, `quad`, `RK45` with a stated tolerance. Keep the condition for leaving it in mind. Read failures from their symptoms, and let measured rates and counts name the cause, because a printed error ratio is usually faster than an argument. A method is only trustworthy in a setting where you checked it against something you know.

## Documentation Links

- [Driscoll and Braun: Fundamentals of Numerical Computation](https://fncbook.com/): open textbook covering every task in this guide.
- [Goldberg (1991): What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): the reference for rounding and float64.
- [SciPy documentation: scipy.optimize.brentq](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html): the bracketing root finder in Example 1.
- [SciPy documentation: scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): the adaptive integrator in Example 4, including `points`.
- [SciPy documentation: scipy.integrate.solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html): the solvers in Example 5.
- [NumPy documentation: numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html): least squares through the SVD.
