---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain why many low-degree pieces avoid the oscillation of one high-degree polynomial, and measure the difference on Runge's function.
- Count the conditions that define a cubic spline, and derive the tridiagonal system for its second derivatives.
- Compare natural, clamped and not-a-knot boundaries, and predict the order of each from what it assumes at the ends.
- Implement a cubic spline and check it against `scipy.interpolate.CubicSpline`.
- Recognize where a $C^2$ spline misleads (overshoot, extrapolation, noisy data) and reach for a shape-preserving alternative.

## Context & Motivation

`polynomial-interpolation-lagrange-and-newton` left an open problem: Chebyshev nodes rescue a high-degree polynomial, but real data usually arrives on a grid someone else chose, and there the polynomial diverges. Splines keep the grid and give up the single formula. They use a low-degree polynomial on each interval between nodes and join the pieces smoothly. The degree stays fixed while the number of pieces grows, so accuracy comes from $h$ getting small rather than from the degree getting large, and the effect of one data value fades quickly with distance.

The name comes from the flexible strip draftsmen bent through fixed points. Cubic splines are a common default for smooth curves through data because they are cheap to build, with one tridiagonal solve, and cheap to evaluate.

## Core Theory

### Linear splines

Joining the points with straight segments gives the linear spline. If $f\in C^2[a,b]$ and $h$ is the largest gap between nodes, the error formula for two nodes gives

$$\lvert f(x)-S(x)\rvert \le \frac{h^2}{8}\max_{[a,b]}\lvert f''\rvert,$$

because $\lvert(x-x_i)(x-x_{i+1})\rvert\le h^2/4$ on each interval. The map from data to interpolant has absolute condition number 1 in the max norm: a change of size $\varepsilon$ in the data changes $S$ by exactly $\varepsilon$ in that norm. The price is a corner at every node.

### Counting the conditions of a cubic spline

A **cubic spline** on nodes $x_0<\cdots<x_n$ is a function that is a cubic on each interval, lies in $C^2[x_0,x_n]$, and interpolates the data. With $n$ intervals there are $4n$ coefficients. Matching the data at both ends of each interval gives $2n$ conditions. Continuity of $S'$ and $S''$ at the $n-1$ interior nodes gives $2(n-1)$ more. That is $4n-2$, so exactly two conditions remain free, and they are the boundary conditions.

### The system for the second derivatives

Let $M_i = S''(x_i)$, $h_i = x_{i+1}-x_i$ and $\delta_i = (y_{i+1}-y_i)/h_i$. On each interval $S''$ is linear from $M_i$ to $M_{i+1}$. Integrating twice and imposing the data gives, on $[x_i,x_{i+1}]$,

$$S(x) = \frac{M_i(x_{i+1}-x)^3 + M_{i+1}(x-x_i)^3}{6h_i} + \Big(\frac{y_i}{h_i}-\frac{M_ih_i}{6}\Big)(x_{i+1}-x) + \Big(\frac{y_{i+1}}{h_i}-\frac{M_{i+1}h_i}{6}\Big)(x-x_i).$$

Values and $S''$ now match by construction. Requiring $S'$ to agree from both sides at an interior node gives, for $i=1,\ldots,n-1$,

$$h_{i-1}M_{i-1} + 2(h_{i-1}+h_i)M_i + h_iM_{i+1} = 6(\delta_i-\delta_{i-1}).$$

This system is the reason splines are practical. It is tridiagonal, so it is solved in $O(n)$ operations, not $O(n^3)$. With natural or clamped ends it is strictly diagonally dominant by rows on any mesh, since $2(h_{i-1}+h_i) > h_{i-1}+h_i$, so it is invertible and needs no pivoting (compare `lu-decomposition-and-partial-pivoting` and the dominance condition in `iterative-methods-jacobi-and-gauss-seidel`). On a uniform mesh with natural ends it is $h$ times the matrix with 4 on the diagonal and 1 beside it, whose eigenvalues lie in $(2,6)$, so $\kappa_2<3$: measured $2.81$, $2.998$, $2.99998$ for $n=10,100,1000$. Compare that with the Vandermonde matrices of the previous lesson.

### Boundary conditions

- **Natural:** $M_0 = M_n = 0$. It needs no extra data, and it asserts that $f$ has no curvature at the ends.
- **Clamped:** $S'(x_0) = s_0$ and $S'(x_n) = s_n$ for given slopes. The added equations are $2h_0M_0 + h_0M_1 = 6(\delta_0-s_0)$ and $h_{n-1}M_{n-1}+2h_{n-1}M_n = 6(s_n-\delta_{n-1})$.
- **Not-a-knot:** $S'''$ is continuous at $x_1$ and $x_{n-1}$, so the first two pieces are one cubic, and likewise the last two. It needs no extra data and is the default in `CubicSpline`.
- **Periodic:** $S'$ and $S''$ match between the two ends, for data with $y_0=y_n$.

**Order.** If $f\in C^4[a,b]$ on a uniform mesh, the not-a-knot spline satisfies $\lVert f-S\rVert_\infty\le Ch^4$ for small enough $h$. Clamped splines with the true slopes reach the same order (Example 4). The natural spline forces $S''=0$ at the ends, so when $f''\ne0$ there it is only $O(h^2)$, and the loss sits at the ends.

### Minimum curvature

Among all $g\in C^2[x_0,x_n]$ that interpolate the data, the natural spline minimizes $\int (g'')^2\,dx$. With both end slopes fixed, the clamped spline minimizes it among interpolants with those slopes. This integral only approximates the bending energy of a physical strip: true curvature is $g''/(1+g'^2)^{3/2}$, so the two agree only for small slopes.

## Worked Examples

### Example 1: a natural spline by hand

Take nodes $0,1,2,3$ with values $1,2,0,1$. Then $h_i=1$ and $\delta = (1,-2,1)$, and with $M_0=M_3=0$ the system is

$$\begin{aligned}4M_1 + M_2 &= 6(-2-1) = -18,\\ M_1 + 4M_2 &= 6(1+2) = 18,\end{aligned}$$

so $M_1=-6$ and $M_2=6$. With $t = x-x_i$, the pieces are

$$\begin{aligned}S_0 &= 1 + 2t - t^3,\\ S_1 &= 2 - t - 3t^2 + 2t^3,\\ S_2 &= -t + 3t^2 - t^3.\end{aligned}$$

At $x=1$: $S_0' = -1 = S_1'$ and $S_0''=-6=S_1''$, but $S_0'''=-6$ and $S_1'''=12$. The third derivative jumps, as it must, or the pieces would be one cubic. The midpoint values are $\tfrac{15}8, 1, \tfrac18$, and `CubicSpline(x, y, bc_type="natural")` returns $1.875, 1, 0.125$ with exactly these coefficients.

The curvature integral $\int_0^3 (S'')^2\,dx$ is $36$ for this spline. It is $81$ for the not-a-knot spline, which on four points is the single cubic through them, and $64.8$ for the spline clamped to zero slope. The natural spline has the smallest, as the theorem requires.

### Example 2: implementation, checked against SciPy

```python
import numpy as np
from scipy.linalg import solve_banded

def moments(t, y, slopes=None):
    """Second derivatives at the knots: natural, or clamped if slopes=(s0, sn)."""
    n, h = len(t) - 1, np.diff(t)
    d = np.diff(y) / h
    up, main, lo, r = np.zeros((4, n + 1))
    main[1:n] = 2 * (h[:-1] + h[1:])
    lo[:n - 1] = h[:-1]
    up[2:] = h[1:]
    r[1:n] = 6 * (d[1:] - d[:-1])
    main[[0, n]] = 1.0
    if slopes is not None:
        main[0], up[1], r[0] = 2 * h[0], h[0], 6 * (d[0] - slopes[0])
        main[n], lo[n - 1], r[n] = 2 * h[-1], h[-1], 6 * (slopes[1] - d[-1])
    return solve_banded((1, 1), np.vstack([up, main, lo]), r)
```

On 40 random nodes in $[-1,1]$ (gaps from $0.0016$ to $0.28$) with $f = 1/(1+25x^2)$, evaluating the piecewise formula above on 20001 points differs from `CubicSpline` by at most $3.3\times10^{-16}$, both for natural ends and for clamped ends with the true slopes.

### Example 3: Runge's function

Max errors for $f(x)=1/(1+25x^2)$ on $[-1,1]$ with $n+1$ nodes, on a grid of 20001 points. All columns but the last use equispaced nodes.

```text
 n   polynomial   linear     cubic not-a-knot   Chebyshev polynomial
10   1.92e+00     6.74e-02   2.20e-02           1.09e-01
20   5.98e+01     4.18e-02   3.18e-03           1.53e-02
40   1.05e+05     1.40e-02   2.78e-04           2.89e-04
80   6.31e+14     3.80e-03   1.61e-05           1.02e-07
```

The polynomial diverges on the same data for which the spline converges. Observed orders of the cubic, from doubling $n$, are $2.79$, $3.52$, $4.11$, then $4.06$ and $4.02$ at $n=160$ and $320$: "order 4" appears only once $h$ resolves the peak of width about $1/5$. Splines are not simply better than Chebyshev interpolation. Up to $n=20$ the spline wins, at $n=40$ they tie, and at $n=80$ the polynomial on chosen nodes is about 160 times better, because this $f$ is analytic and geometric convergence overtakes $h^4$.

The reason for the stability is locality. Set $y=1$ at the central node and $y=0$ at the others, $n=20$, and record the largest value in each interval:

```text
interval from the bump   natural spline   polynomial
1                        1.37e-01         2.65e-01
2                        3.66e-02         2.32e-01
3                        9.81e-03         3.01e-01
5                        7.05e-04         1.25e+00
9                        4.41e-06         1.82e+03
```

Each interval multiplies the spline by a factor of about $0.268 = 2-\sqrt3$, the size of the decaying root of the recurrence $M_{i-1}+4M_i+M_{i+1}=0$. The polynomial grows toward the ends. The Lebesgue constant at $n=20$ is $1.55$ for the natural spline and $1.97$ for not-a-knot, against $1.1\times10^4$ for the polynomial. With $n=40$, adding $10^{-3}$ to the central value changes the spline by $10^{-3}$ and the polynomial by $5.7\times10^{5}$.

### Example 4: the boundary condition sets the order

Max error for $e^x$ on $[0,1]$, where $f''\ne0$ at both ends:

```text
  n   natural    clamped    not-a-knot
 10   1.33e-03   6.96e-07   6.93e-06
 20   3.34e-04   4.39e-08   4.56e-07
 40   8.34e-05   2.75e-09   2.92e-08
 80   2.09e-05   1.73e-10   1.85e-09
160   5.21e-06   1.08e-11   1.17e-10
ord   2.00       4.00       3.99
```

The natural error sits next to the right end, at $x=0.990$ for $n=40$, where the false assumption $S''=0$ costs most. On $\sin x$ over $[0,\pi]$, where $f''$ really is $0$ at both ends, the natural spline recovers order $4.00$. Here the clamped error times $n^4/e$ is $0.0026$, close to $1/384$, for this $f$. The linear spline's bound $h^2e/8$ is nearly attained: $8.289\times10^{-7}$ measured against $8.296\times10^{-7}$ at $n=640$.

### Example 5: when $f$ is not smooth

For $\sqrt x$ on $[0,1]$, $f'$ is unbounded at $0$, so the hypothesis $f\in C^4$ fails.

```text
  n   uniform linear   uniform cubic   graded cubic, x_i = (i/n)^4
 20   5.59e-02         3.94e-02        7.20e-03
 80   2.80e-02         1.97e-02        4.50e-04
320   1.40e-02         9.85e-03        2.81e-05
```

On a uniform mesh both orders fall to $0.50$, and the extra degree buys almost nothing. Splines accept any mesh, so nodes can be moved toward the singularity, which gives order $2.00$ with the same node count.

### Example 6: overshoot and extrapolation

Take data $0$ at $x=0,\ldots,5$ and $1$ at $x=6,\ldots,10$. `CubicSpline` ranges from $-0.108$ to $1.108$. Smoothness forces it past the data. Now take an illustrative latency distribution, with $x=1,2,5,10,20,50,100,200,500$ ms and cumulative fractions $0.10, 0.40, 0.70, 0.85, 0.92, 0.97, 0.99, 0.995, 0.999$. On this uneven grid the cubic reaches $1.041$ near $388$ ms, an impossible probability, and decreases on about a third of the range. `PchipInterpolator` stays monotone, between $0.1$ and $0.999$, at the cost of being only $C^1$.

Outside the data a spline is just its last cubic, and `CubicSpline` extrapolates by default. For $\sin 2\pi x$ on 11 nodes in $[0,1]$, the value at $x=1.2$ is $1.18$ against $0.95$, and at $x=2$ it is $-18.6$ against $0$. Pass `extrapolate=False` to get `nan` there.

## Common Misconceptions & Pitfalls

- **"Splines never oscillate."** They avoid Runge's growth, not overshoot: Example 6 overshoots by about $11\%$ of the step.
- **"The natural spline is the most natural choice."** The name refers to the condition, not to accuracy. It is order 2 unless $f''$ vanishes at the ends (Example 4).
- **"`bc_type='clamped'` means the slopes are matched."** In SciPy that string means zero slope at both ends. On $e^x$ with $n=40$ it gives error $0.0116$, against $2.75\times10^{-9}$ for `bc_type=((1, 1.0), (1, np.e))`.
- **"An interpolating spline removes noise."** It passes through every data point, noise included. For noisy data use a fit: see `least-squares-curve-fitting`, or `scipy.interpolate.make_smoothing_spline`.
- **"Splines always beat global polynomials."** On smooth functions with chosen nodes, Chebyshev interpolation wins eventually (Example 3).
- **"Book vs today."** Older code uses `scipy.interpolate.interp1d`, which SciPy now calls legacy. New code should use `CubicSpline`, `PchipInterpolator` or `make_interp_spline`. With the default boundary, `make_interp_spline(t, y, k=3)` agrees with `CubicSpline` to $6.7\times10^{-16}$ on the step data of Example 6.

## Summary

A cubic spline has $4n$ coefficients and $4n-2$ matching conditions, so two boundary conditions complete it. The second derivatives solve a tridiagonal, strictly diagonally dominant system in $O(n)$, with $\kappa_2<3$ on a uniform natural mesh. For $f\in C^4$, not-a-knot and clamped splines reach order 4, and natural ones fall to order 2 unless $f''$ vanishes at the ends. On Runge's function the error goes from $2.2\times10^{-2}$ to $1.6\times10^{-5}$ between $n=10$ and $n=80$ while the equispaced polynomial explodes, because a spline's response to one value is multiplied by a factor of $0.268$ per interval. Cubic splines still overshoot and extrapolate badly: use a monotone interpolant such as PCHIP when shape matters, and a fit when the data is noisy.

## Documentation Links

- [Fundamentals of Numerical Computation, 5.2 Piecewise linear interpolation](https://fncbook.com/pwlin/): hat functions and the conditioning result for linear interpolation.
- [Fundamentals of Numerical Computation, 5.3 Cubic splines](https://fncbook.com/splines/): the smoothness conditions, end conditions and the fourth-order theorem for not-a-knot splines.
- [MIT OpenCourseWare 18.330, Chapter 3: Interpolation](https://ocw.mit.edu/courses/18-330-introduction-to-numerical-analysis-spring-2012/resources/mit18_330s12_chapter3/): piecewise interpolation and the system for a natural spline's second derivatives.
- [SciPy: CubicSpline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.CubicSpline.html): boundary options, including the meaning of `'clamped'`, and the default not-a-knot.
- [SciPy: PchipInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html): the shape-preserving $C^1$ interpolant.
- [SciPy: interp1d](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.interp1d.html): the legacy interface and its replacement note.
- [SciPy: make_interp_spline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_interp_spline.html): B-spline interpolation of a chosen degree.
- [SciPy: make_smoothing_spline](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.make_smoothing_spline.html): a smoothing spline for noisy data.
